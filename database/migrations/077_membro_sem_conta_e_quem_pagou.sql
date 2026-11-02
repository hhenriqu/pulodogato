-- 077_membro_sem_conta_e_quem_pagou.sql
--
-- O churrasco sem cadastro (item 4 de docs/MAPA-DO-PROJETO.md, "Facilitar o
-- churrasco"; RN025 na PRD). Duas barreiras caem:
--
--   1. MEMBRO SEM CONTA. O amigo que nao vai instalar o app entra no grupo so
--      com o nome. `group_members.user_id` passa a aceitar NULL e a linha ganha
--      `display_name`. Ele divide as despesas (recebe a parte dele em
--      `group_expense_splits`, pelo `member_id`), aparece no saldo e no acerto.
--      E o MESMO membro que a visao da casa usa para o dependente sem login
--      (078, outra entrega): os nomes `display_name` e
--      `group_members_quem_e_check` foram combinados entre as duas, e a 078
--      repete esses passos de forma idempotente.
--
--   2. DESPESA PAGA POR OUTRA PESSOA. O organizador registra "o Joao pagou o
--      carvao". Ate aqui o pagador era sempre quem lancava
--      (`financial_transactions.user_id`), e a despesa morava numa conta
--      pessoal dele. A despesa paga por outro membro mora SO no grupo: uma
--      linha de `group_transactions` sem `transaction_id`, com valor, data,
--      descricao, moeda e `paid_by_member_id`. Nao entra na conta nem no
--      Resultado pessoal de ninguem -- o dinheiro nao saiu de conta cadastrada
--      no app -- e conta inteira no saldo do grupo.
--
-- O QUE FICA DE FORA, DE PROPOSITO (v1)
-- -------------------------------------
--   * Grupo com dia de fechamento (RN018, a casa que fecha todo mes). O
--     fechamento (`lib/fechamento-do-grupo.ts`, 067) gera uma conta a pagar ou a
--     receber POR USUARIO e le so `financial_transactions`. Um membro sem conta
--     nao tem onde receber essa conta, e a despesa so do grupo nao estaria no
--     fechamento. Em vez de deixar o cron do fechamento quebrar (ou fechar um
--     valor errado), as duas coisas sao recusadas com SQLSTATE PDG77 nesse
--     grupo, e ligar o dia de fechamento num grupo que ja as tem tambem.
--   * A parte de quem tem conta numa despesa paga por outro nao entra no
--     Resultado pessoal (`group_share_entries` continua lendo so despesa com
--     lancamento). Ela aparece no saldo do grupo e sai no acerto.
--   * Editar valor, pagador ou moeda da despesa so do grupo: apague e lance de
--     novo (trava na SECAO 4). Descricao e data podem mudar.
--   * Reivindicar o membro sem conta quando o amigo criar conta: proxima
--     entrega (o `group_members_guard` da 040 congela `user_id`).
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
--   SECAO 1  preflight
--   SECAO 2  group_members: user_id opcional, display_name, CHECKs
--   SECAO 3  a trava do fechamento (PDG77)
--   SECAO 4  group_transactions: a despesa so do grupo e quem pagou
--   SECAO 5  o rateio le o valor da despesa so do grupo
--   SECAO 6  lancar_despesa_paga_por_membro(): a unica porta de escrita
--   SECAO 7  group_settlements: o acerto com quem nao tem conta
--   SECAO 8  group_member_balances pelo membro, e nao pelo usuario
--   SECAO 9  bill_alerts nao avisa quem nao tem conta
--   SECAO 10 prova
--
-- Idempotente: pode ser colada duas vezes. Cola como lote unico no SQL Editor
-- (nenhum meta-comando de psql aqui).

BEGIN;

-- ===========================================================================
-- SECAO 1: preflight
-- ===========================================================================
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expense_groups'
       AND column_name = 'group_kind'
  ) THEN
    problemas := problemas || E'\n  - expense_groups.group_kind nao existe (076)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'group_settlements'
       AND column_name = 'exchange_rate'
  ) THEN
    problemas := problemas || E'\n  - group_settlements.exchange_rate nao existe (026)';
  END IF;
  IF to_regprocedure('public.refazer_rateio_do_grupo(uuid, uuid, numeric)') IS NULL THEN
    problemas := problemas || E'\n  - funcao refazer_rateio_do_grupo nao existe (024/042)';
  END IF;
  IF to_regclass('public.group_closings') IS NULL THEN
    problemas := problemas || E'\n  - tabela group_closings nao existe (067)';
  END IF;
  IF to_regclass('public.bill_alerts') IS NULL THEN
    problemas := problemas || E'\n  - view bill_alerts nao existe (009/057)';
  END IF;
  IF problemas <> '' THEN
    RAISE EXCEPTION 'A migration 077 nao pode ser aplicada neste banco:%', problemas;
  END IF;
END $$;

-- ===========================================================================
-- SECAO 2: group_members -- o membro sem conta
-- ===========================================================================
-- Os tres passos combinados com a 078 (mesmos nomes, mesma forma):
ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.group_members ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.group_members DROP CONSTRAINT IF EXISTS group_members_quem_e_check;
ALTER TABLE public.group_members
  ADD CONSTRAINT group_members_quem_e_check
  CHECK (user_id IS NOT NULL OR length(btrim(display_name)) > 0);

COMMENT ON COLUMN public.group_members.display_name IS
  'O nome de quem participa SEM CONTA no app (077): o amigo do churrasco, o dependente da casa. Obrigatorio quando user_id e nulo (group_members_quem_e_check). Para quem tem conta, o nome vem de profiles.';

-- Um nome cabe numa linha da tela.
ALTER TABLE public.group_members DROP CONSTRAINT IF EXISTS group_members_display_name_tamanho_check;
ALTER TABLE public.group_members
  ADD CONSTRAINT group_members_display_name_tamanho_check
  CHECK (display_name IS NULL OR char_length(display_name) <= 80);

-- Quem nao tem conta nao faz login, entao nao administra nada. Um admin sem
-- conta seria um grupo sem ninguem para aprovar entrada.
ALTER TABLE public.group_members DROP CONSTRAINT IF EXISTS group_members_sem_conta_nao_e_admin_check;
ALTER TABLE public.group_members
  ADD CONSTRAINT group_members_sem_conta_nao_e_admin_check
  CHECK (user_id IS NOT NULL OR role = 'member');

-- `unique_user_per_group (group_id, user_id)` continua valendo para quem tem
-- conta: NULL nao colide com NULL, entao varios membros sem conta cabem no
-- mesmo grupo.
--
-- O alvo das FKs compostas das SECOES 4 e 7: "o membro e DESTE grupo" vira
-- regra do banco, e nao um IF que cada escrita tem que lembrar. `id` ja e a
-- chave primaria, entao o par e unico por construcao.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'group_members_group_id_id_key'
       AND conrelid = 'public.group_members'::regclass
  ) THEN
    ALTER TABLE public.group_members
      ADD CONSTRAINT group_members_group_id_id_key UNIQUE (group_id, id);
  END IF;
END $$;

-- ===========================================================================
-- SECAO 3: a trava do fechamento (PDG77)
-- ===========================================================================
-- Ver o cabecalho. Tres portas, uma regra: grupo com `closing_day` nao tem
-- membro sem conta ativo nem despesa so do grupo.
CREATE OR REPLACE FUNCTION public.group_members_sem_conta_fora_do_fechamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS NULL AND NEW.status = 'active' AND EXISTS (
       SELECT 1 FROM public.expense_groups g
        WHERE g.id = NEW.group_id AND g.closing_day IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Este grupo fecha num dia do mes, e o fechamento gera uma conta para cada pessoa com conta no app. Quem nao tem conta ainda nao entra num grupo que fecha: tire o dia de fechamento ou convide a pessoa por email.'
      USING ERRCODE = 'PDG77';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_group_members_sem_conta_fora_do_fechamento ON public.group_members;
CREATE TRIGGER trg_group_members_sem_conta_fora_do_fechamento
  BEFORE INSERT OR UPDATE OF user_id, status, group_id ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.group_members_sem_conta_fora_do_fechamento();

CREATE OR REPLACE FUNCTION public.expense_groups_fechamento_sem_membro_sem_conta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.closing_day IS NOT NULL AND OLD.closing_day IS NULL THEN
    IF EXISTS (
         SELECT 1 FROM public.group_members gm
          WHERE gm.group_id = NEW.id AND gm.user_id IS NULL AND gm.status = 'active'
       ) THEN
      RAISE EXCEPTION 'Este grupo tem participante sem conta no app, e o fechamento do mes gera uma conta para cada pessoa com conta. Remova o participante sem conta antes de ligar o dia de fechamento.'
        USING ERRCODE = 'PDG77';
    END IF;
    IF EXISTS (
         SELECT 1 FROM public.group_transactions gt
          WHERE gt.group_id = NEW.id AND gt.transaction_id IS NULL
       ) THEN
      RAISE EXCEPTION 'Este grupo tem despesa paga por outra pessoa (lancada so no grupo), e o fechamento do mes so le despesa lancada numa conta. Acerte e apague essas despesas antes de ligar o dia de fechamento.'
        USING ERRCODE = 'PDG77';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_groups_fechamento_sem_membro_sem_conta ON public.expense_groups;
CREATE TRIGGER trg_expense_groups_fechamento_sem_membro_sem_conta
  BEFORE UPDATE OF closing_day ON public.expense_groups
  FOR EACH ROW EXECUTE FUNCTION public.expense_groups_fechamento_sem_membro_sem_conta();

REVOKE ALL ON FUNCTION public.group_members_sem_conta_fora_do_fechamento() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expense_groups_fechamento_sem_membro_sem_conta() FROM PUBLIC;

-- ===========================================================================
-- SECAO 4: group_transactions -- a despesa so do grupo e quem pagou
-- ===========================================================================
ALTER TABLE public.group_transactions ALTER COLUMN transaction_id DROP NOT NULL;
ALTER TABLE public.group_transactions
  ADD COLUMN IF NOT EXISTS paid_by_member_id uuid,
  ADD COLUMN IF NOT EXISTS amount numeric(15,2),
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS expense_date date,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,8);

COMMENT ON COLUMN public.group_transactions.paid_by_member_id IS
  'Quem pagou a despesa SO DO GRUPO (077): a linha de group_members, com ou sem conta. NULL na despesa com lancamento, em que quem pagou e financial_transactions.user_id.';
COMMENT ON COLUMN public.group_transactions.amount IS
  'Valor positivo da despesa so do grupo (077), na moeda de `currency`. NULL na despesa com lancamento (o valor e o de financial_transactions).';

-- O membro que pagou e DESTE grupo (FK composta sobre a SECAO 2). Sem ON
-- DELETE: apagar o membro que pagou levaria a despesa junto, e o saldo dos
-- outros mudaria sozinho. A rota de remover recusa membro com historico.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'group_transactions_paid_by_member_fkey'
       AND conrelid = 'public.group_transactions'::regclass
  ) THEN
    ALTER TABLE public.group_transactions
      ADD CONSTRAINT group_transactions_paid_by_member_fkey
      FOREIGN KEY (group_id, paid_by_member_id)
      REFERENCES public.group_members (group_id, id);
  END IF;
END $$;

-- As duas formas da linha, e nenhuma terceira.
ALTER TABLE public.group_transactions DROP CONSTRAINT IF EXISTS group_transactions_origem_check;
ALTER TABLE public.group_transactions
  ADD CONSTRAINT group_transactions_origem_check CHECK (
    (transaction_id IS NOT NULL
      AND paid_by_member_id IS NULL AND amount IS NULL AND description IS NULL
      AND expense_date IS NULL AND currency IS NULL AND exchange_rate IS NULL)
    OR
    (transaction_id IS NULL
      AND paid_by_member_id IS NOT NULL
      AND amount > 0
      AND length(btrim(description)) > 0
      AND expense_date IS NOT NULL
      AND currency IS NOT NULL
      AND exchange_rate > 0
      -- a mesma regra da 026 para o lancamento: real nao leva cotacao.
      AND ((currency = 'BRL') = (exchange_rate = 1)))
  );

CREATE INDEX IF NOT EXISTS idx_group_transactions_paid_by_member
  ON public.group_transactions (paid_by_member_id)
  WHERE paid_by_member_id IS NOT NULL;

-- A despesa so do grupo nasce SO pela funcao da SECAO 6, que escreve a linha e
-- as partes juntas. Um INSERT direto sem partes faria o pagador "ter pago"
-- sem ninguem dever, e o acerto sugerido cobraria os outros por nada.
DROP POLICY IF EXISTS group_transactions_insert ON public.group_transactions;
CREATE POLICY group_transactions_insert ON public.group_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.is_group_member(group_id)
    AND transaction_id IS NOT NULL
  );

-- Valor, pagador e moeda da despesa so do grupo nao mudam por UPDATE: as
-- partes foram calculadas sobre eles. Descricao e data mudam.
CREATE OR REPLACE FUNCTION public.group_transactions_trava_da_despesa_so_do_grupo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.transaction_id IS NULL AND (
       NEW.transaction_id    IS DISTINCT FROM OLD.transaction_id
       OR NEW.group_id       IS DISTINCT FROM OLD.group_id
       OR NEW.paid_by_member_id IS DISTINCT FROM OLD.paid_by_member_id
       OR NEW.amount         IS DISTINCT FROM OLD.amount
       OR NEW.currency       IS DISTINCT FROM OLD.currency
       OR NEW.exchange_rate  IS DISTINCT FROM OLD.exchange_rate
     ) THEN
    RAISE EXCEPTION 'O valor, a moeda e quem pagou uma despesa lancada so no grupo nao mudam: a divisao foi feita sobre eles. Apague a despesa e lance de novo.'
      USING ERRCODE = 'PDG77';
  END IF;
  IF OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS NULL THEN
    RAISE EXCEPTION 'Uma despesa com lancamento nao vira despesa so do grupo.'
      USING ERRCODE = 'PDG77';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_group_transactions_trava_da_despesa_so_do_grupo ON public.group_transactions;
CREATE TRIGGER trg_group_transactions_trava_da_despesa_so_do_grupo
  BEFORE UPDATE ON public.group_transactions
  FOR EACH ROW EXECUTE FUNCTION public.group_transactions_trava_da_despesa_so_do_grupo();

-- ===========================================================================
-- SECAO 5: o rateio le o valor da despesa so do grupo
-- ===========================================================================
-- `calculate_equal_split` (007) e `recalcular_partes_pendentes` (024) liam o
-- total so de `financial_transactions`, por INNER JOIN. Reproduzidas inteiras
-- (CREATE OR REPLACE troca o corpo todo); o que muda e o LEFT JOIN e o
-- COALESCE do total, marcados com "077". Para a despesa com lancamento o
-- numero e o mesmo de antes.
CREATE OR REPLACE FUNCTION public.calculate_equal_split() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_split_type TEXT;
    v_total_cents BIGINT;
    v_n INTEGER;
    v_rank INTEGER;
    v_base BIGINT;
    v_resto BIGINT;
BEGIN
    SELECT gt.split_type INTO v_split_type
      FROM public.group_transactions gt
     WHERE gt.id = NEW.group_transaction_id;

    IF v_split_type IS NOT NULL AND v_split_type <> 'equal' THEN
        RETURN NEW;
    END IF;

    -- 077: a despesa so do grupo tem o valor na propria linha.
    SELECT ROUND(COALESCE(ABS(ft.amount), gt.amount) * 100)::bigint INTO v_total_cents
      FROM public.group_transactions gt
      LEFT JOIN public.financial_transactions ft ON ft.id = gt.transaction_id
     WHERE gt.id = NEW.group_transaction_id;

    IF v_total_cents IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT count(*) INTO v_n
      FROM public.group_members gm
      JOIN public.group_transactions gt ON gt.group_id = gm.group_id
     WHERE gt.id = NEW.group_transaction_id
       AND gm.status = 'active';

    IF v_n IS NULL OR v_n = 0 THEN
        RETURN NEW;
    END IF;

    SELECT posicao INTO v_rank
      FROM (
        SELECT gm.id, row_number() OVER (ORDER BY gm.id) - 1 AS posicao
          FROM public.group_members gm
          JOIN public.group_transactions gt ON gt.group_id = gm.group_id
         WHERE gt.id = NEW.group_transaction_id
           AND gm.status = 'active'
      ) AS r
     WHERE r.id = NEW.member_id;

    IF v_rank IS NULL THEN
        RETURN NEW;
    END IF;

    v_base  := v_total_cents / v_n;
    v_resto := v_total_cents - (v_base * v_n);

    NEW.amount := ((v_base + CASE WHEN v_rank < v_resto THEN 1 ELSE 0 END)::numeric) / 100;
    NEW.percentage := GREATEST(ROUND(100.0 / v_n, 2), 0.01);

    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.calculate_equal_split() IS
  'Rateio igualitario em centavos inteiros (maior resto), somando exatamente o valor da despesa -- do lancamento ou, na despesa so do grupo (077), da propria linha. Nao toca em rateio custom/percentage/proporcional.';

CREATE OR REPLACE FUNCTION public.recalcular_partes_pendentes(p_group_transaction_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_split_type TEXT;
  v_total NUMERIC;
  v_partes INTEGER := 0;
BEGIN
  -- 077: LEFT JOIN + COALESCE, para a despesa so do grupo.
  SELECT gt.split_type, COALESCE(ABS(ft.amount), gt.amount)
    INTO v_split_type, v_total
    FROM public.group_transactions gt
    LEFT JOIN public.financial_transactions ft ON ft.id = gt.transaction_id
   WHERE gt.id = p_group_transaction_id;

  IF v_total IS NULL THEN
    RETURN 0;
  END IF;

  IF v_split_type = 'equal' THEN
    DELETE FROM public.group_expense_splits
     WHERE group_transaction_id = p_group_transaction_id
       AND status = 'pending';

    INSERT INTO public.group_expense_splits
      (group_transaction_id, member_id, percentage, amount, status)
    SELECT p_group_transaction_id, gm.id, 100, 0, 'pending'
      FROM public.group_members gm
      JOIN public.group_transactions gt ON gt.group_id = gm.group_id
     WHERE gt.id = p_group_transaction_id
       AND gm.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM public.group_expense_splits es
          WHERE es.group_transaction_id = p_group_transaction_id
            AND es.member_id = gm.id
       );

    GET DIAGNOSTICS v_partes = ROW_COUNT;
  ELSE
    UPDATE public.group_expense_splits es
       SET amount = ROUND(v_total * (es.percentage / 100.0), 2),
           updated_at = now()
     WHERE es.group_transaction_id = p_group_transaction_id
       AND es.status = 'pending';

    GET DIAGNOSTICS v_partes = ROW_COUNT;
  END IF;

  RETURN v_partes;
END;
$$;
COMMENT ON FUNCTION public.recalcular_partes_pendentes(uuid) IS
  'Refaz as partes pendentes de uma divisao sobre o valor atual da despesa (do lancamento ou, desde a 077, da despesa so do grupo). Igualitaria: apaga e reinsere, para o calculate_equal_split fazer a conta em centavos. Combinada: reescala pela porcentagem gravada. Nao toca em parte aprovada, recusada ou expirada.';

-- CREATE OR REPLACE preserva os privilegios, mas a 024 fechou esta funcao e o
-- custo de repetir e zero.
REVOKE EXECUTE ON FUNCTION public.recalcular_partes_pendentes(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.recalcular_partes_pendentes(uuid) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.recalcular_partes_pendentes(uuid) FROM authenticated';
  END IF;
END $$;

-- ===========================================================================
-- SECAO 6: lancar_despesa_paga_por_membro()
-- ===========================================================================
-- A unica porta de escrita da despesa so do grupo (a policy da SECAO 4 fecha o
-- INSERT direto). Escreve a linha e as partes na mesma transacao, pela MESMA
-- regra do rateio do lancamento (042): peso de `group_members.percentage`
-- quando o grupo configurou divisao, partes iguais quando a soma e zero.
--
-- Quem chama tem que ser membro ATIVO e com conta (e o `auth.uid()`); quem
-- pagou pode ser qualquer membro ativo, com ou sem conta, inclusive quem chama.
CREATE OR REPLACE FUNCTION public.lancar_despesa_paga_por_membro(
  p_group_id uuid,
  p_paid_by_member_id uuid,
  p_amount numeric,
  p_description text,
  p_expense_date date DEFAULT CURRENT_DATE,
  p_currency text DEFAULT 'BRL',
  p_exchange_rate numeric DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_grupo public.expense_groups%ROWTYPE;
  v_gt uuid;
  v_valor numeric(15,2);
  v_moeda text := upper(btrim(COALESCE(p_currency, 'BRL')));
  v_taxa numeric := COALESCE(p_exchange_rate, 1);
  v_soma_pesos BIGINT;
  v_total_cents BIGINT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Entre no app para lancar a despesa.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_grupo FROM public.expense_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grupo nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = p_group_id AND gm.user_id = v_uid AND gm.status = 'active'
     ) THEN
    RAISE EXCEPTION 'So quem participa do grupo lanca despesa nele.' USING ERRCODE = '42501';
  END IF;

  IF v_grupo.archived_at IS NOT NULL OR v_grupo.is_active IS FALSE THEN
    RAISE EXCEPTION 'O grupo esta arquivado: restaure para lancar despesa.' USING ERRCODE = 'PDG77';
  END IF;

  IF v_grupo.closing_day IS NOT NULL THEN
    RAISE EXCEPTION 'Este grupo fecha num dia do mes, e o fechamento so le despesa lancada numa conta. Aqui, quem pagou lanca a despesa na conta dele.'
      USING ERRCODE = 'PDG77';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM public.group_members gm
        WHERE gm.id = p_paid_by_member_id AND gm.group_id = p_group_id AND gm.status = 'active'
     ) THEN
    RAISE EXCEPTION 'Quem pagou precisa ser um participante ativo do grupo.' USING ERRCODE = '22023';
  END IF;

  v_valor := round(abs(COALESCE(p_amount, 0)), 2);
  IF v_valor <= 0 THEN
    RAISE EXCEPTION 'O valor da despesa tem que ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  IF length(btrim(COALESCE(p_description, ''))) = 0 THEN
    RAISE EXCEPTION 'Diga o que foi pago (a descricao esta vazia).' USING ERRCODE = '22023';
  END IF;

  IF v_moeda = 'BRL' THEN
    v_taxa := 1;
  ELSIF NOT (v_taxa > 0) OR v_taxa = 1 THEN
    RAISE EXCEPTION 'Informe a cotacao do dia da compra para uma despesa em %.', v_moeda
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(ROUND(COALESCE(gm.percentage, 0) * 100)::bigint), 0)
    INTO v_soma_pesos
    FROM public.group_members gm
   WHERE gm.group_id = p_group_id
     AND gm.status = 'active';

  INSERT INTO public.group_transactions
    (group_id, transaction_id, split_type, created_by,
     paid_by_member_id, amount, description, expense_date, currency, exchange_rate)
  VALUES
    (p_group_id, NULL, CASE WHEN v_soma_pesos > 0 THEN 'percentage' ELSE 'equal' END, v_uid,
     p_paid_by_member_id, v_valor, btrim(p_description), COALESCE(p_expense_date, CURRENT_DATE),
     v_moeda, v_taxa)
  RETURNING id INTO v_gt;

  IF v_soma_pesos > 0 THEN
    -- O mesmo maior resto em centavos da 042 (`refazer_rateio_do_grupo`).
    v_total_cents := ROUND(v_valor * 100)::bigint;

    INSERT INTO public.group_expense_splits
      (group_transaction_id, member_id, percentage, amount, status)
    WITH ativos AS (
      SELECT gm.id AS member_id,
             ROUND(COALESCE(gm.percentage, 0) * 100)::bigint AS peso
        FROM public.group_members gm
       WHERE gm.group_id = p_group_id
         AND gm.status = 'active'
    ),
    bruto AS (
      SELECT a.member_id,
             a.peso,
             (v_total_cents * a.peso) / v_soma_pesos AS base_cents,
             (v_total_cents * a.peso) - ((v_total_cents * a.peso) / v_soma_pesos) * v_soma_pesos AS resto
        FROM ativos a
    ),
    com_ordem AS (
      SELECT b.*,
             row_number() OVER (ORDER BY b.resto DESC, b.member_id) AS ordem,
             v_total_cents - SUM(b.base_cents) OVER () AS sobra
        FROM bruto b
    )
    SELECT v_gt,
           c.member_id,
           LEAST(GREATEST(ROUND(c.peso * 100.0 / v_soma_pesos, 2), 0.01), 100),
           (c.base_cents + CASE WHEN c.ordem <= c.sobra THEN 1 ELSE 0 END)::numeric / 100,
           'pending'
      FROM com_ordem c;
  ELSE
    -- Partes de fachada: o `calculate_equal_split` (SECAO 5) faz a conta.
    INSERT INTO public.group_expense_splits
      (group_transaction_id, member_id, percentage, amount, status)
    SELECT v_gt, gm.id, 100, 0, 'pending'
      FROM public.group_members gm
     WHERE gm.group_id = p_group_id
       AND gm.status = 'active';
  END IF;

  RETURN v_gt;
END;
$$;

COMMENT ON FUNCTION public.lancar_despesa_paga_por_membro(uuid, uuid, numeric, text, date, text, numeric) IS
  'Lanca uma despesa SO NO GRUPO, paga por outro membro (com ou sem conta), e divide pela regra do grupo (peso de percentage, ou partes iguais). Nao cria lancamento em conta nenhuma. Recusa (PDG77) grupo arquivado ou com dia de fechamento. Devolve o id de group_transactions (077).';

REVOKE ALL ON FUNCTION public.lancar_despesa_paga_por_membro(uuid, uuid, numeric, text, date, text, numeric) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.lancar_despesa_paga_por_membro(uuid, uuid, numeric, text, date, text, numeric) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.lancar_despesa_paga_por_membro(uuid, uuid, numeric, text, date, text, numeric) TO authenticated';
  END IF;
END $$;

-- ===========================================================================
-- SECAO 7: group_settlements -- o acerto com quem nao tem conta
-- ===========================================================================
-- O acerto passa a apontar tambem para a LINHA do membro. `from_user_id` e
-- `to_user_id` ficam (o fechamento, a baixa da 068 e as telas leem por eles) e
-- passam a aceitar NULL: e o lado de quem nao tem conta.
ALTER TABLE public.group_settlements
  ADD COLUMN IF NOT EXISTS from_member_id uuid,
  ADD COLUMN IF NOT EXISTS to_member_id uuid;
ALTER TABLE public.group_settlements ALTER COLUMN from_user_id DROP NOT NULL;
ALTER TABLE public.group_settlements ALTER COLUMN to_user_id DROP NOT NULL;

COMMENT ON COLUMN public.group_settlements.from_member_id IS
  'Quem PAGOU, pela linha de group_members (077). Preenchida pelo trigger a partir de from_user_id quando a pessoa tem conta; e a unica identidade de quem nao tem.';
COMMENT ON COLUMN public.group_settlements.to_member_id IS
  'Quem RECEBEU, pela linha de group_members (077). Ver from_member_id.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'group_settlements_from_member_fkey'
       AND conrelid = 'public.group_settlements'::regclass
  ) THEN
    ALTER TABLE public.group_settlements
      ADD CONSTRAINT group_settlements_from_member_fkey
      FOREIGN KEY (group_id, from_member_id) REFERENCES public.group_members (group_id, id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'group_settlements_to_member_fkey'
       AND conrelid = 'public.group_settlements'::regclass
  ) THEN
    ALTER TABLE public.group_settlements
      ADD CONSTRAINT group_settlements_to_member_fkey
      FOREIGN KEY (group_id, to_member_id) REFERENCES public.group_members (group_id, id);
  END IF;
END $$;

-- Backfill: o acerto antigo ganha a linha do membro. Acerto de quem ja saiu e
-- teve a linha apagada fica com o lado nulo -- o user_id continua dizendo quem.
UPDATE public.group_settlements gs
   SET from_member_id = gm.id
  FROM public.group_members gm
 WHERE gs.from_member_id IS NULL
   AND gm.group_id = gs.group_id
   AND gm.user_id = gs.from_user_id;

UPDATE public.group_settlements gs
   SET to_member_id = gm.id
  FROM public.group_members gm
 WHERE gs.to_member_id IS NULL
   AND gm.group_id = gs.group_id
   AND gm.user_id = gs.to_user_id;

ALTER TABLE public.group_settlements DROP CONSTRAINT IF EXISTS group_settlements_de_quem_check;
ALTER TABLE public.group_settlements
  ADD CONSTRAINT group_settlements_de_quem_check
  CHECK (from_user_id IS NOT NULL OR from_member_id IS NOT NULL);
ALTER TABLE public.group_settlements DROP CONSTRAINT IF EXISTS group_settlements_para_quem_check;
ALTER TABLE public.group_settlements
  ADD CONSTRAINT group_settlements_para_quem_check
  CHECK (to_user_id IS NOT NULL OR to_member_id IS NOT NULL);
-- `parties_differ` (007) compara os user_id; este compara as linhas. `<>` e
-- nao `IS DISTINCT FROM` de proposito: com um lado nulo, quem decide e o outro.
ALTER TABLE public.group_settlements DROP CONSTRAINT IF EXISTS group_settlements_membros_diferentes_check;
ALTER TABLE public.group_settlements
  ADD CONSTRAINT group_settlements_membros_diferentes_check
  CHECK (from_member_id <> to_member_id);

-- Os dois jeitos de dizer quem e (o usuario e a linha) ficam coerentes: o lado
-- que veio preenche o outro, e os dois discordando e recusado. Roda ANTES da
-- RLS (WITH CHECK e avaliado depois dos triggers BEFORE), entao a policy abaixo
-- ja ve as duas colunas.
CREATE OR REPLACE FUNCTION public.group_settlements_partes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_achou boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Mudou a pessoa pelo user_id e deixou a linha velha: a linha segue.
    IF NEW.from_user_id IS DISTINCT FROM OLD.from_user_id
       AND NEW.from_member_id IS NOT DISTINCT FROM OLD.from_member_id THEN
      NEW.from_member_id := NULL;
    END IF;
    IF NEW.to_user_id IS DISTINCT FROM OLD.to_user_id
       AND NEW.to_member_id IS NOT DISTINCT FROM OLD.to_member_id THEN
      NEW.to_member_id := NULL;
    END IF;
  END IF;

  -- quem pagou
  IF NEW.from_member_id IS NOT NULL THEN
    SELECT gm.user_id, true INTO v_user, v_achou
      FROM public.group_members gm
     WHERE gm.id = NEW.from_member_id AND gm.group_id = NEW.group_id;
    IF v_achou THEN
      IF NEW.from_user_id IS NULL THEN
        NEW.from_user_id := v_user;
      ELSIF NEW.from_user_id IS DISTINCT FROM v_user THEN
        RAISE EXCEPTION 'from_user_id e from_member_id apontam para pessoas diferentes'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSIF NEW.from_user_id IS NOT NULL THEN
    SELECT gm.id INTO NEW.from_member_id
      FROM public.group_members gm
     WHERE gm.group_id = NEW.group_id AND gm.user_id = NEW.from_user_id;
  END IF;

  v_achou := NULL;
  v_user := NULL;

  -- quem recebeu
  IF NEW.to_member_id IS NOT NULL THEN
    SELECT gm.user_id, true INTO v_user, v_achou
      FROM public.group_members gm
     WHERE gm.id = NEW.to_member_id AND gm.group_id = NEW.group_id;
    IF v_achou THEN
      IF NEW.to_user_id IS NULL THEN
        NEW.to_user_id := v_user;
      ELSIF NEW.to_user_id IS DISTINCT FROM v_user THEN
        RAISE EXCEPTION 'to_user_id e to_member_id apontam para pessoas diferentes'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSIF NEW.to_user_id IS NOT NULL THEN
    SELECT gm.id INTO NEW.to_member_id
      FROM public.group_members gm
     WHERE gm.group_id = NEW.group_id AND gm.user_id = NEW.to_user_id;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.group_settlements_partes() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_group_settlements_partes ON public.group_settlements;
CREATE TRIGGER trg_group_settlements_partes
  BEFORE INSERT OR UPDATE ON public.group_settlements
  FOR EACH ROW EXECUTE FUNCTION public.group_settlements_partes();

-- RLS. A regra da 007 continua: quem registra e uma das partes. Ela ganha UMA
-- excecao, porque quem nao tem conta nao registra nada: o ADMIN registra o
-- acerto entre dois participantes SEM CONTA ("o Joao pagou o Pedro"). Entre
-- duas pessoas com conta, ou entre uma com conta e outra sem, continua sendo
-- a pessoa com conta quem registra -- o admin nao perdoa divida alheia.
DROP POLICY IF EXISTS group_settlements_insert ON public.group_settlements;
CREATE POLICY group_settlements_insert ON public.group_settlements
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.is_group_member(group_id)
    AND (
      from_user_id = auth.uid()
      OR to_user_id = auth.uid()
      OR (public.is_group_admin(group_id)
          AND from_user_id IS NULL AND to_user_id IS NULL
          AND from_member_id IS NOT NULL AND to_member_id IS NOT NULL)
    )
  );

DROP POLICY IF EXISTS group_settlements_update ON public.group_settlements;
CREATE POLICY group_settlements_update ON public.group_settlements
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND public.is_group_member(group_id))
  WITH CHECK (
    created_by = auth.uid()
    AND (
      from_user_id = auth.uid()
      OR to_user_id = auth.uid()
      OR (public.is_group_admin(group_id)
          AND from_user_id IS NULL AND to_user_id IS NULL
          AND from_member_id IS NOT NULL AND to_member_id IS NOT NULL)
    )
  );

-- ===========================================================================
-- SECAO 8: group_member_balances pelo MEMBRO
-- ===========================================================================
-- A 007/026 casava tudo por `user_id`, e `NULL = NULL` nao casa: o membro sem
-- conta teria saldo zero devendo metade do churrasco. Agora:
--   * pago   = lancamentos dele (como antes) + despesas so do grupo em que ele
--              e o `paid_by_member_id`;
--   * devido = as partes dele pelo `member_id` (o mesmo conjunto de antes para
--              quem tem conta: um usuario tem uma linha por grupo);
--   * acertos pela linha do membro, caindo no user_id no acerto antigo cuja
--              linha nao existe mais.
-- Colunas na MESMA ordem; `display_name` entra no fim (CREATE OR REPLACE VIEW
-- so aceita coluna nova no fim).
CREATE OR REPLACE VIEW public.group_member_balances AS
  SELECT
    m.group_id,
    m.user_id,
    m.id                                        AS member_id,
    COALESCE(p.paid, 0)::numeric(15,2)          AS total_paid,
    COALESCE(o.owed, 0)::numeric(15,2)          AS total_owed,
    COALESCE(s.paid_out, 0)::numeric(15,2)      AS settlements_paid,
    COALESCE(s.received, 0)::numeric(15,2)      AS settlements_received,
    (COALESCE(p.paid, 0)
     - COALESCE(o.owed, 0)
     + COALESCE(s.paid_out, 0)
     - COALESCE(s.received, 0))::numeric(15,2)  AS net_balance,
    COALESCE(p.paid_count, 0)                   AS paid_count,
    COALESCE(o.owed_count, 0)                   AS owed_count,
    'BRL'::text                                 AS amount_currency,
    eg.currency                                 AS group_currency,
    m.display_name                              AS display_name
  FROM public.group_members m
  JOIN public.expense_groups eg ON eg.id = m.group_id

  -- o que este membro pagou pelo grupo
  LEFT JOIN LATERAL (
    SELECT SUM(x.valor) AS paid, COUNT(*) AS paid_count
      FROM (
        SELECT ABS(t.amount) * t.exchange_rate AS valor
          FROM public.group_transactions gt
          JOIN public.financial_transactions t ON t.id = gt.transaction_id
         WHERE gt.group_id = m.group_id
           AND t.user_id = m.user_id
           AND t.transaction_type = 'expense'
        UNION ALL
        SELECT gt.amount * gt.exchange_rate
          FROM public.group_transactions gt
         WHERE gt.group_id = m.group_id
           AND gt.transaction_id IS NULL
           AND gt.paid_by_member_id = m.id
      ) AS x
  ) AS p ON TRUE

  -- a parte que cabe a ele nas despesas do grupo, na cotacao da despesa
  LEFT JOIN LATERAL (
    SELECT SUM(es.amount * COALESCE(t.exchange_rate, gt.exchange_rate)) AS owed,
           COUNT(*) AS owed_count
    FROM public.group_expense_splits es
    JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    LEFT JOIN public.financial_transactions t ON t.id = gt.transaction_id
    WHERE gt.group_id = m.group_id
      AND es.member_id = m.id
      AND es.status NOT IN ('rejected', 'expired')
      -- o lancamento que a RLS esconde continua fora, como no INNER JOIN de antes
      AND (t.id IS NOT NULL OR gt.transaction_id IS NULL)
  ) AS o ON TRUE

  -- os acertos ja registrados, nas duas direcoes, na cotacao do dia do pagamento
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN gs.from_member_id = m.id
                 OR (gs.from_member_id IS NULL AND gs.from_user_id = m.user_id)
               THEN gs.amount * gs.exchange_rate ELSE 0 END) AS paid_out,
      SUM(CASE WHEN gs.to_member_id = m.id
                 OR (gs.to_member_id IS NULL AND gs.to_user_id = m.user_id)
               THEN gs.amount * gs.exchange_rate ELSE 0 END) AS received
    FROM public.group_settlements gs
    WHERE gs.group_id = m.group_id
      AND (gs.from_member_id = m.id OR gs.to_member_id = m.id
           OR (gs.from_member_id IS NULL AND gs.from_user_id = m.user_id)
           OR (gs.to_member_id IS NULL AND gs.to_user_id = m.user_id))
  ) AS s ON TRUE

  WHERE m.status = 'active';

COMMENT ON VIEW public.group_member_balances IS
  'Saldo de cada membro ativo, com ou sem conta (077), sempre em BRL (coluna amount_currency): pago - devido + acertos pagos - acertos recebidos, cada parcela convertida pela cotacao congelada da propria linha. Pago inclui a despesa so do grupo em que ele e paid_by_member_id; devido e acertos casam pela linha do membro. user_id nulo = membro sem conta, com o nome em display_name. Negativo = deve. group_currency e a moeda da viagem, para a tela apresentar.';

-- `CREATE OR REPLACE VIEW` apaga os reloptions (ver o cabecalho da 064).
ALTER VIEW public.group_member_balances SET (security_invoker = true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.group_member_balances FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON public.group_member_balances TO authenticated';
  END IF;
END $$;

-- ===========================================================================
-- SECAO 9: bill_alerts nao avisa quem nao tem conta
-- ===========================================================================
-- A 057 manda o aviso da conta de grupo para cada membro ATIVO. O membro sem
-- conta renderia uma linha com `user_id` NULL, que o cron grava em
-- `bill_notifications.user_id`. O corpo e o da 057 sem os comentarios; o que
-- muda e a linha marcada com "077".
CREATE OR REPLACE VIEW public.bill_alerts AS
  SELECT
    s.id AS scheduled_transaction_id,
    d.user_id,
    s.group_id,
    s.account_id,
    s.description,
    s.amount,
    s.due_date,
    (s.due_date - CURRENT_DATE) AS days_until,
    CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END AS kind,
    COALESCE(p.days_before, 3) AS days_before,
    s.direction AS transaction_type,
    EXISTS (
      SELECT 1 FROM public.bill_notifications n
      WHERE n.scheduled_transaction_id = s.id
        AND n.user_id = d.user_id
        AND n.kind = (CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END)
        AND n.reference_date = s.due_date
    ) AS already_notified,
    COALESCE(p.notify_email, true) AS notify_email
  FROM public.scheduled_transactions_effective s
  CROSS JOIN LATERAL (
    SELECT s.user_id AS user_id
    UNION
    SELECT gm.user_id
      FROM public.group_members gm
     WHERE s.group_id IS NOT NULL
       AND gm.group_id = s.group_id
       AND gm.status = 'active'
       AND gm.user_id IS NOT NULL  -- 077: quem nao tem conta nao recebe aviso
  ) d
  LEFT JOIN public.notification_preferences p ON p.user_id = d.user_id
  WHERE s.status = 'pending'
    AND (
      (s.due_date < CURRENT_DATE AND COALESCE(p.notify_overdue, true))
      OR (s.due_date >= CURRENT_DATE
          AND COALESCE(p.notify_due_soon, true)
          AND s.due_date - CURRENT_DATE <= COALESCE(p.days_before, 3))
    );

ALTER VIEW public.bill_alerts SET (security_invoker = true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.bill_alerts FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON public.bill_alerts TO authenticated';
  END IF;
END $$;

-- ===========================================================================
-- SECAO 10: prova
-- ===========================================================================
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'group_members'
       AND column_name = 'user_id' AND is_nullable = 'NO'
  ) THEN
    problemas := problemas || E'\n  - group_members.user_id continua NOT NULL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_members_quem_e_check') THEN
    problemas := problemas || E'\n  - falta group_members_quem_e_check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_transactions_origem_check') THEN
    problemas := problemas || E'\n  - falta group_transactions_origem_check';
  END IF;
  IF to_regprocedure('public.lancar_despesa_paga_por_membro(uuid, uuid, numeric, text, date, text, numeric)') IS NULL THEN
    problemas := problemas || E'\n  - falta lancar_despesa_paga_por_membro';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
     WHERE c.oid = 'public.group_member_balances'::regclass
       AND 'security_invoker=true' = ANY (COALESCE(c.reloptions, '{}'))
  ) THEN
    problemas := problemas || E'\n  - group_member_balances perdeu o security_invoker';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
     WHERE c.oid = 'public.bill_alerts'::regclass
       AND 'security_invoker=true' = ANY (COALESCE(c.reloptions, '{}'))
  ) THEN
    problemas := problemas || E'\n  - bill_alerts perdeu o security_invoker';
  END IF;
  IF problemas <> '' THEN
    RAISE EXCEPTION '077 aplicada pela metade:%', problemas;
  END IF;
END $$;

COMMIT;
