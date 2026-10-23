-- ===========================================================================
-- 070 -- A DIVISAO COM PESSOA FECHA NO LANCAMENTO (RN020, fase 5 do modelo novo)
-- ===========================================================================
-- Metade de BANCO da divisao com pessoa no modelo novo das movimentacoes (PRD
-- 2.1, RN020, decisao D4). A divisao com pessoa funciona como um grupo de duas
-- pessoas, sem periodo: ela fecha no proprio lancamento.
--
--   * quem pagou continua contando a despesa INTEIRA, pela perna pessoal (046);
--   * quem pagou ganha uma conta prevista "A receber de <pessoa>" (receita) pela
--     parte do outro;
--   * o outro ganha uma conta prevista "Pagamento a <pessoa>" (despesa) do
--     mesmo valor;
--   * as duas vencem na data do lancamento.
--
-- Exemplo da RN020.5: a Lais pagou R$ 79,86 e dividiu 90% com o Helio. Ela fica
-- com a despesa de R$ 79,86 e "A receber de Helio" de R$ 71,87; ele fica com
-- "Pagamento a Lais" de R$ 71,87. Quitadas as duas, o Resultado dela e
-- -R$ 7,99 e o dele e -R$ 71,87.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
--   SECAO 1  preflight
--   SECAO 2  as duas categorias reservadas das contas da divisao
--   SECAO 3  `scheduled_transactions.expense_split_id`, o elo da conta com a
--            divisao
--   SECAO 4  a trava da conta da divisao
--   SECAO 5  `refazer_contas_da_divisao` e os triggers que a chamam: nascer,
--            editar e apagar o lancamento ou a divisao
--   SECAO 6  `group_share_entries` perde a perna de pessoa da 066
--   SECAO 7  as contas das divisoes que ja existem
--
-- CADA LADO QUITA A PROPRIA CONTA, PELA BAIXA DE SEMPRE
-- ----------------------------------------------------
-- A conta da divisao e uma conta prevista comum do dono dela: ela aparece na
-- agenda, entra no previsto enquanto esta em aberto e sai dele quando e paga.
-- Quem deve paga a dele com o "Pagar" da agenda, e a baixa lanca a despesa na
-- conta dele (categoria "Pagamento a pessoa"). Quem pagou recebe a dele com o
-- "Receber", e a baixa lanca a receita na conta dela ("Recebimento de pessoa").
-- O lado realizado de cada conta e o lancamento que a baixa cria, como em toda
-- conta prevista do app -- nao ha view nova para somar.
--
-- A baixa de um lado nao quita o outro, de proposito: cada lado lanca o proprio
-- dinheiro na propria conta, e nenhum lancamento nasce na conta de outra pessoa
-- (a objecao 1 da 007). E o que o acerto do grupo ja faz com a perna da
-- contraparte.
--
-- A conta nasce apontando para uma conta corrente do dono (a da despesa, para
-- quem pagou, quando ela nao e cartao). Quem pagou por outra conta lanca o
-- dinheiro na conta certa e usa o "Ja lancei: vincular" da agenda.
--
-- POR QUE A PERNA DE PESSOA DA 066 SAI (SECAO 6)
-- ----------------------------------------------
-- A 066 levava a parte do Helio para o realizado dele por `group_share_entries`,
-- no dia da despesa da Lais. Com a conta "Pagamento a Lais" a mesma parte
-- entraria de novo pela baixa. A divida passa a ser a conta, e a parte deixa
-- de ser linha da view.
--
-- O PASSO HUMANO
-- --------------
-- Colar no SQL Editor do Supabase depois do merge, DEPOIS da 069.
-- Re-executavel. Ela cria as contas das divisoes que ja existem (SECAO 7):
-- quem dividiu antes da 070 passa a ver as duas contas em aberto, vencidas na
-- data do lancamento, e as quita pela agenda.
-- ===========================================================================

BEGIN;

-- ===========================================================================
-- SECAO 1: PREFLIGHT
-- ===========================================================================
DO $$
DECLARE
  v_faltando text := '';
BEGIN
  IF to_regclass('public.expense_splits') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.expense_splits (vem do 001)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'financial_transactions'
       AND column_name = 'exchange_rate'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna financial_transactions.exchange_rate (vem da 026)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'group_share_entries'
       AND column_name = 'valor_total'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna valor_total em public.group_share_entries (vem da 066)';
  END IF;

  IF to_regclass('public.group_closing_entries') IS NULL THEN
    v_faltando := v_faltando || E'\n  - view public.group_closing_entries (vem da 069)';
  END IF;

  IF v_faltando <> '' THEN
    RAISE EXCEPTION E'070 nao pode ser aplicado neste banco. Faltando:%\n\nRode 001 -> ... -> 069 antes.', v_faltando;
  END IF;
END $$;

-- ===========================================================================
-- SECAO 2: AS CATEGORIAS RESERVADAS DAS CONTAS DA DIVISAO
-- ===========================================================================
-- Pelo mesmo motivo das duas da 067: `scheduled_transactions.category_id` e NOT
-- NULL, e a conta da divisao nao e de nenhuma categoria de consumo. A baixa
-- copia a categoria da conta para o lancamento, e e por ela que o relatorio por
-- categoria mostra "Pagamento a pessoa" e "Recebimento de pessoa". Inativas para
-- nao aparecerem nos seletores.
INSERT INTO public.transaction_categories
  (id, service_id, name, description, icon, color_hex, is_expense, is_active)
SELECT
  '546f8740-14f1-42bd-a202-870f0f444874',
  '8730cd96-d656-4c48-863e-673e1016a832',
  'Pagamento a pessoa',
  'Reservada para a conta que a divisão com pessoa gera para quem deve. Não aparece nos seletores.',
  'user',
  '#6B7280',
  TRUE,
  FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM public.transaction_categories
   WHERE service_id = '8730cd96-d656-4c48-863e-673e1016a832'
     AND name = 'Pagamento a pessoa'
);

INSERT INTO public.transaction_categories
  (id, service_id, name, description, icon, color_hex, is_expense, is_active)
SELECT
  '6c2e165e-a0ef-4a1a-90fb-c607b4e872e0',
  '8730cd96-d656-4c48-863e-673e1016a832',
  'Recebimento de pessoa',
  'Reservada para a conta que a divisão com pessoa gera para quem pagou. Não aparece nos seletores.',
  'user',
  '#6B7280',
  FALSE,
  FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM public.transaction_categories
   WHERE service_id = '8730cd96-d656-4c48-863e-673e1016a832'
     AND name = 'Recebimento de pessoa'
);

-- A policy das ativas nao alcanca estas duas. Sem esta, a conta e o lancamento
-- da baixa chegam na agenda e na lista com a categoria nula no embed.
DROP POLICY IF EXISTS transaction_categories_read_reservada_da_pessoa
  ON public.transaction_categories;
CREATE POLICY transaction_categories_read_reservada_da_pessoa
  ON public.transaction_categories
  FOR SELECT TO authenticated
  USING (
    is_active = FALSE
    AND id IN ('546f8740-14f1-42bd-a202-870f0f444874',
               '6c2e165e-a0ef-4a1a-90fb-c607b4e872e0')
  );

-- ===========================================================================
-- SECAO 3: O ELO DA CONTA COM A DIVISAO
-- ===========================================================================
-- ON DELETE CASCADE: a divisao que sai leva as duas contas (RN020.3). Quem
-- apaga a divisao na sessao do app passa antes pelo trigger da SECAO 5, que
-- recusa a divisao ja paga e apaga as contas com a trava desligada.
ALTER TABLE public.scheduled_transactions
  ADD COLUMN IF NOT EXISTS expense_split_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'scheduled_transactions_expense_split_id_fkey'
  ) THEN
    ALTER TABLE public.scheduled_transactions
      ADD CONSTRAINT scheduled_transactions_expense_split_id_fkey
      FOREIGN KEY (expense_split_id)
      REFERENCES public.expense_splits(id) ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON COLUMN public.scheduled_transactions.expense_split_id IS
  'A divisao com pessoa que gerou esta conta (070, RN020): A receber de <pessoa> para quem pagou, Pagamento a <pessoa> para quem deve. Valor, tipo, dono, vencimento, descricao e categoria vem do lancamento e ficam travados por scheduled_transactions_trava_da_divisao; a baixa e livre.';

-- Uma conta por pessoa por divisao: quem pagou tem a receber, o outro tem a
-- pagar, e cada um e UM numero.
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_transactions_expense_split_user_key
  ON public.scheduled_transactions (expense_split_id, user_id)
  WHERE expense_split_id IS NOT NULL;

-- ===========================================================================
-- SECAO 4: A TRAVA DA CONTA DA DIVISAO
-- ===========================================================================
-- O molde e o da 067. A conta e do dono, e a policy de UPDATE do 005 deixa o
-- dono mexer em tudo na linha dele -- inclusive baixar "Pagamento a Lais" de
-- R$ 71,87 para R$ 0,01. Entao, na sessao do app:
--
--   * nao nasce conta com `expense_split_id`: ela so nasce da divisao;
--   * nao muda valor, tipo, dono, vencimento, moeda, grupo, descricao,
--     categoria nem o elo de uma conta da divisao. Quem muda isso e o
--     lancamento (RN020.3);
--   * a conta da divisao nao se apaga sozinha: ela sai com a divisao;
--   * a baixa (status, paid_date, transaction_id) e a conta de onde sai o
--     dinheiro (account_id) continuam livres -- e por elas que a conta e paga.
--
-- Passam direto: `auth.uid() IS NULL` (cron, colagem) e a escrita de
-- `refazer_contas_da_divisao`, reconhecida por `pulodogato.contas_da_divisao =
-- 'on'` (set_config local da transacao, desligado ao final -- o PostgREST nao
-- expoe `set_config`).
CREATE OR REPLACE FUNCTION public.scheduled_transactions_trava_da_divisao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR current_setting('pulodogato.contas_da_divisao', true) = 'on'
  THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.expense_split_id IS NOT NULL THEN
      RAISE EXCEPTION 'Conta da divisao com pessoa sai junto com a divisao: edite ou apague o lancamento (RN020.3)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.expense_split_id IS NOT NULL THEN
      RAISE EXCEPTION 'Conta da divisao com pessoa so nasce do lancamento dividido'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.expense_split_id IS NULL THEN
    IF NEW.expense_split_id IS NOT NULL THEN
      RAISE EXCEPTION 'Conta da divisao com pessoa so nasce do lancamento dividido'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.expense_split_id       IS DISTINCT FROM OLD.expense_split_id
     OR NEW.amount              IS DISTINCT FROM OLD.amount
     OR NEW.transaction_type    IS DISTINCT FROM OLD.transaction_type
     OR NEW.user_id             IS DISTINCT FROM OLD.user_id
     OR NEW.due_date            IS DISTINCT FROM OLD.due_date
     OR NEW.currency            IS DISTINCT FROM OLD.currency
     OR NEW.group_id            IS DISTINCT FROM OLD.group_id
     OR NEW.recurring_rule_id   IS DISTINCT FROM OLD.recurring_rule_id
     OR NEW.description         IS DISTINCT FROM OLD.description
     OR NEW.category_id         IS DISTINCT FROM OLD.category_id
  THEN
    RAISE EXCEPTION 'Conta da divisao com pessoa muda pelo lancamento: edite o valor ou a parte no lancamento (RN020.3)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.scheduled_transactions_trava_da_divisao() IS
  'Prende a conta gerada pela divisao com pessoa (070, RN020.3). Sessao do app nao cria conta com expense_split_id, nao a apaga e nao muda valor, tipo, dono, vencimento, moeda, grupo, descricao, categoria nem o elo; a baixa e a conta de pagamento continuam livres. Passam direto: auth.uid() IS NULL e a escrita de refazer_contas_da_divisao (pulodogato.contas_da_divisao = on).';

DROP TRIGGER IF EXISTS scheduled_transactions_trava_da_divisao ON public.scheduled_transactions;
CREATE TRIGGER scheduled_transactions_trava_da_divisao
  BEFORE INSERT OR UPDATE OR DELETE ON public.scheduled_transactions
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_transactions_trava_da_divisao();

REVOKE ALL ON FUNCTION public.scheduled_transactions_trava_da_divisao() FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- SECAO 5: AS DUAS CONTAS, REFEITAS A PARTIR DO LANCAMENTO
-- ===========================================================================
-- `refazer_contas_da_divisao(divisao)` le a divisao e o lancamento e deixa as
-- contas da divisao iguais ao que eles dizem hoje:
--
--   * a divisao vale quando o lancamento e despesa SEM grupo (RN020.4: com
--     grupo, vale so o grupo), quem divide nao e quem pagou, e a divisao nao
--     foi recusada nem expirou;
--   * o valor e a parte em reais: |amount| x cotacao x percentual, ao centavo.
--     E a conta de `calculate_split_amount` (001) com a cotacao da 026, porque
--     a conta prevista e so em BRL (034);
--   * as duas vencem na data do lancamento (D4).
--
-- A conta em aberto e atualizada no lugar (o id nao muda, e quem a abriu na
-- agenda continua nela). A conta que sobra -- a divisao recusada, o
-- lancamento que ganhou grupo -- sai.
--
-- A CONTA PAGA NAO E REFEITA EM SILENCIO (RN020.3)
-- -----------------------------------------------
-- Se uma das duas ja foi paga e o lancamento passou a dizer outro valor, outra
-- data, outra pessoa ou nada, a funcao RECUSA. Refazer em silencio deixaria a
-- baixa de R$ 71,87 debaixo de uma divida de R$ 50, e ninguem saberia de onde
-- veio a diferenca. Quem precisa mudar desfaz a baixa antes. O que nao mexe em
-- dinheiro (a descricao do lancamento) passa sem tocar na conta paga.
CREATE OR REPLACE FUNCTION public.refazer_contas_da_divisao(p_split_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  es public.expense_splits%ROWTYPE;
  t  public.financial_transactions%ROWTYPE;
  v_vale boolean := false;
  v_valor numeric(15,2);
  v_nome_pagador text;
  v_nome_participante text;
  v_detalhe text;
  v_lado record;
  v_conta public.scheduled_transactions%ROWTYPE;
BEGIN
  SELECT * INTO es FROM public.expense_splits WHERE id = p_split_id;
  IF FOUND THEN
    SELECT * INTO t FROM public.financial_transactions WHERE id = es.transaction_id;
    v_vale := FOUND
      AND t.group_id IS NULL
      AND t.transaction_type = 'expense'
      AND t.user_id <> es.participant_id
      AND es.status NOT IN ('rejected', 'expired');
  END IF;

  IF v_vale THEN
    v_valor := round(abs(t.amount) * COALESCE(t.exchange_rate, 1) * es.percentage / 100, 2);
    v_vale := v_valor > 0;
  END IF;

  -- A conta paga que o lancamento ja nao sustenta.
  IF EXISTS (
    SELECT 1 FROM public.scheduled_transactions st
     WHERE st.expense_split_id = p_split_id
       AND st.status = 'paid'
       AND NOT (
         v_vale
         AND st.amount = v_valor
         AND st.due_date = t.transaction_date
         AND (
           (st.user_id = t.user_id AND st.transaction_type = 'income')
           OR (st.user_id = es.participant_id AND st.transaction_type = 'expense')
         )
       )
  ) THEN
    RAISE EXCEPTION 'Esta divisao ja foi paga por um dos lados: desfaca a baixa na agenda antes de mudar o valor, a data, a pessoa ou apagar o lancamento (RN020.3)'
      USING ERRCODE = 'PDG02';
  END IF;

  PERFORM set_config('pulodogato.contas_da_divisao', 'on', true);

  -- O que sobra sai. A conta paga que sobreviveu ao teste acima e uma das duas
  -- que continuam valendo, entao nunca chega aqui.
  DELETE FROM public.scheduled_transactions st
   WHERE st.expense_split_id = p_split_id
     AND (
       NOT v_vale
       OR NOT (
         (st.user_id = t.user_id AND st.transaction_type = 'income')
         OR (st.user_id = es.participant_id AND st.transaction_type = 'expense')
       )
     );

  IF NOT v_vale THEN
    PERFORM set_config('pulodogato.contas_da_divisao', '', true);
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.nickname), ''), 'sua conexão')
    INTO v_nome_pagador
    FROM public.profiles p WHERE p.id = t.user_id;
  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.nickname), ''), 'sua conexão')
    INTO v_nome_participante
    FROM public.profiles p WHERE p.id = es.participant_id;
  v_nome_pagador := COALESCE(v_nome_pagador, 'sua conexão');
  v_nome_participante := COALESCE(v_nome_participante, 'sua conexão');
  v_detalhe := CASE WHEN NULLIF(btrim(t.description), '') IS NULL THEN ''
                    ELSE ' — ' || btrim(t.description) END;

  FOR v_lado IN
    SELECT t.user_id AS user_id,
           'income'::public.transaction_financial_type AS tipo,
           '6c2e165e-a0ef-4a1a-90fb-c607b4e872e0'::uuid AS categoria,
           'A receber de ' || v_nome_participante || v_detalhe AS descricao,
           t.account_id AS conta_preferida
    UNION ALL
    SELECT es.participant_id,
           'expense'::public.transaction_financial_type,
           '546f8740-14f1-42bd-a202-870f0f444874'::uuid,
           'Pagamento a ' || v_nome_pagador || v_detalhe,
           NULL::uuid
  LOOP
    SELECT * INTO v_conta
      FROM public.scheduled_transactions st
     WHERE st.expense_split_id = p_split_id
       AND st.user_id = v_lado.user_id
     FOR UPDATE;

    IF FOUND THEN
      IF v_conta.status <> 'paid' THEN
        UPDATE public.scheduled_transactions
           SET amount = v_valor,
               due_date = t.transaction_date,
               description = v_lado.descricao,
               category_id = v_lado.categoria
         WHERE id = v_conta.id
           AND (amount, due_date, description, category_id)
               IS DISTINCT FROM (v_valor, t.transaction_date, v_lado.descricao, v_lado.categoria);
      END IF;
    ELSE
      INSERT INTO public.scheduled_transactions
        (user_id, category_id, account_id, description, amount, due_date, status,
         transaction_type, currency, expense_split_id)
      VALUES (
        v_lado.user_id,
        v_lado.categoria,
        -- A conta de onde sai (ou onde entra) o dinheiro: a da despesa para
        -- quem pagou, quando ela nao e cartao, senao a primeira conta
        -- corrente ativa do dono. Ninguem escolhe conta de outra pessoa.
        (SELECT a.id FROM public.financial_accounts a
          WHERE a.user_id = v_lado.user_id
            AND a.is_active IS NOT FALSE
            AND a.account_type IN ('checking', 'digital', 'savings', 'cash')
          ORDER BY (a.id = v_lado.conta_preferida) IS TRUE DESC,
                   CASE a.account_type WHEN 'checking' THEN 0 WHEN 'digital' THEN 1
                                       WHEN 'savings' THEN 2 ELSE 3 END,
                   (a.include_in_total IS FALSE),
                   a.created_at, a.id
          LIMIT 1),
        v_lado.descricao,
        v_valor,
        t.transaction_date,
        'pending',
        v_lado.tipo,
        'BRL',
        p_split_id
      );
    END IF;
  END LOOP;

  PERFORM set_config('pulodogato.contas_da_divisao', '', true);
END $$;

COMMENT ON FUNCTION public.refazer_contas_da_divisao(uuid) IS
  'Deixa as contas da divisao com pessoa iguais ao lancamento (070, RN020): A receber de <pessoa> para quem pagou e Pagamento a <pessoa> para quem deve, pela parte em reais, vencendo na data do lancamento. Lancamento com grupo, divisao recusada/expirada ou de quem pagou com ele mesmo nao tem conta. A conta em aberto e atualizada no lugar; a paga nao e refeita, e a funcao recusa a mudanca que a contradiria. Chamada so pelos triggers.';

REVOKE ALL ON FUNCTION public.refazer_contas_da_divisao(uuid) FROM PUBLIC, anon, authenticated;

-- A divisao nasce ou muda: as contas acompanham.
CREATE OR REPLACE FUNCTION public.expense_splits_refaz_contas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.refazer_contas_da_divisao(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS expense_splits_refaz_contas ON public.expense_splits;
CREATE TRIGGER expense_splits_refaz_contas
  AFTER INSERT OR UPDATE ON public.expense_splits
  FOR EACH ROW EXECUTE FUNCTION public.expense_splits_refaz_contas();

-- A divisao sai: as contas saem com ela, menos quando uma ja foi paga. BEFORE,
-- para recusar antes de a linha sumir, e para apagar as contas com a trava
-- desligada antes de o CASCADE da SECAO 3 tenta-lo na sessao de quem apagou.
-- Apagar o lancamento passa por aqui tambem: o CASCADE de
-- `expense_splits.transaction_id` (001) apaga a divisao.
CREATE OR REPLACE FUNCTION public.expense_splits_apaga_contas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.scheduled_transactions st
     WHERE st.expense_split_id = OLD.id AND st.status = 'paid'
  ) THEN
    RAISE EXCEPTION 'Esta divisao ja foi paga por um dos lados: desfaca a baixa na agenda antes de apagar o lancamento ou tirar a pessoa da divisao (RN020.3)'
      USING ERRCODE = 'PDG02';
  END IF;

  PERFORM set_config('pulodogato.contas_da_divisao', 'on', true);
  DELETE FROM public.scheduled_transactions WHERE expense_split_id = OLD.id;
  PERFORM set_config('pulodogato.contas_da_divisao', '', true);
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS expense_splits_apaga_contas ON public.expense_splits;
CREATE TRIGGER expense_splits_apaga_contas
  BEFORE DELETE ON public.expense_splits
  FOR EACH ROW EXECUTE FUNCTION public.expense_splits_apaga_contas();

-- O lancamento muda: o valor, a cotacao, a data, a descricao, o tipo ou o
-- grupo refazem as contas de cada divisao dele. `expense_splits.amount` nao e
-- recalculado aqui (o `calculate_split_amount` do 001 so roda quando a divisao
-- muda): a conta sai do lancamento, e nao daquela coluna.
CREATE OR REPLACE FUNCTION public.financial_transactions_refaz_contas_da_divisao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_split uuid;
BEGIN
  FOR v_split IN
    SELECT es.id FROM public.expense_splits es WHERE es.transaction_id = NEW.id
  LOOP
    PERFORM public.refazer_contas_da_divisao(v_split);
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS financial_transactions_refaz_contas_da_divisao ON public.financial_transactions;
CREATE TRIGGER financial_transactions_refaz_contas_da_divisao
  AFTER UPDATE ON public.financial_transactions
  FOR EACH ROW
  WHEN (
    NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate
    OR NEW.transaction_date IS DISTINCT FROM OLD.transaction_date
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.transaction_type IS DISTINCT FROM OLD.transaction_type
    OR NEW.group_id IS DISTINCT FROM OLD.group_id
  )
  EXECUTE FUNCTION public.financial_transactions_refaz_contas_da_divisao();

REVOKE ALL ON FUNCTION public.expense_splits_refaz_contas() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expense_splits_apaga_contas() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_transactions_refaz_contas_da_divisao() FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- SECAO 6: group_share_entries SEM A PERNA DE PESSOA
-- ===========================================================================
-- A perna do grupo e o corpo da 069 sem mudanca nenhuma. A perna da pessoa
-- (066) sai: a parte de quem deve passa a ser a conta "Pagamento a <pessoa>".
CREATE OR REPLACE VIEW public.group_share_entries AS
  SELECT
    es.id                                             AS id,
    em.user_id                                        AS user_id,
    gt.group_id                                       AS group_id,
    t.id                                              AS transaction_id,
    t.transaction_date                                AS transaction_date,
    date_trunc('month', t.transaction_date)::date     AS month,
    t.category_id                                     AS category_id,
    t.transaction_type                                AS transaction_type,
    t.currency                                        AS currency,
    es.amount                                         AS amount,
    es.status                                         AS split_status,
    (t.user_id = em.user_id)                          AS paguei_eu,
    t.user_id                                         AS pago_por,
    t.description                                     AS descricao,
    t.amount                                          AS valor_total
  FROM public.group_expense_splits es
  JOIN public.group_members em        ON em.id = es.member_id
  JOIN public.group_transactions gt   ON gt.id = es.group_transaction_id
  JOIN public.financial_transactions t ON t.id = gt.transaction_id
  WHERE es.status NOT IN ('rejected', 'expired')
    AND t.transaction_type = 'expense'
    -- 069 (RN018.9): no grupo que fecha, e na despesa que ja entrou num
    -- fechamento, so fica a linha de quem pagou.
    AND (
      t.user_id = em.user_id
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.expense_groups g
           WHERE g.id = gt.group_id
             AND g.closing_day IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.group_closing_items i
           WHERE i.transaction_id = t.id
        )
      )
    );

COMMENT ON VIEW public.group_share_entries IS
  'A minha parte do que foi dividido NUM GRUPO, uma linha por parte (033): group_expense_splits, todos os membros -- quem le PRECISA filtrar user_id. No grupo com dia de fechamento, e na despesa que ja entrou num fechamento, so fica a linha de quem PAGOU: a parte de quem nao pagou sai do Resultado e o que ele deve entra pela conta do fechamento (069, RN018.9). A divisao com pessoa nao esta aqui desde a 070: a parte de quem deve e a conta Pagamento a <pessoa> (RN020). Exclui rateio rejected/expired e o que nao e expense. pago_por/descricao/valor_total sao de quem pagou, para a lista nao depender de ler a despesa dele.';

-- `CREATE OR REPLACE VIEW` apaga os reloptions (ver o cabecalho da 064).
ALTER VIEW public.group_share_entries SET (security_invoker = true);
REVOKE ALL ON public.group_share_entries FROM anon;
GRANT SELECT ON public.group_share_entries TO authenticated;

-- A view nao a chama mais. Sem leitor, a funcao DEFINER da 066 so seria uma
-- segunda porta para a mesma parte.
DROP FUNCTION IF EXISTS public.minhas_partes_de_divisao_com_pessoa();

-- ===========================================================================
-- SECAO 7: AS CONTAS DAS DIVISOES QUE JA EXISTEM
-- ===========================================================================
-- Toda divisao valida ganha as duas contas, em aberto, vencidas na data do
-- lancamento. Na segunda colagem a funcao nao muda nada: as contas ja estao
-- iguais ao lancamento.
DO $$
DECLARE
  v_split uuid;
BEGIN
  FOR v_split IN SELECT es.id FROM public.expense_splits es ORDER BY es.created_at, es.id
  LOOP
    PERFORM public.refazer_contas_da_divisao(v_split);
  END LOOP;
END $$;

COMMIT;
