-- ===========================================================================
-- 067 -- O FECHAMENTO DO GRUPO POR PERIODO (RN018, fase 2 do modelo novo)
-- ===========================================================================
-- Metade de BANCO da fase 2 de "o modelo das movimentacoes" (PRD 2.1, RN018).
-- O grupo ganha um DIA DE FECHAMENTO. No dia, o saldo de cada membro no periodo
-- vira uma conta prevista PESSOAL: "Pagamento ao grupo" para quem deve,
-- "A receber do grupo" para quem tem a receber. A metade de app e o calculo em
-- lib/fechamento-por-periodo.ts e o cron em app/api/cron/group-closings.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
--   SECAO 1  preflight
--   SECAO 2  `expense_groups.closing_day` (1 a 28, NULL = o grupo nao fecha)
--   SECAO 3  as duas categorias reservadas das contas geradas
--   SECAO 4  `group_closings`: um fechamento por grupo e periodo
--   SECAO 5  `group_closing_items`: o que entrou em cada fechamento
--   SECAO 6  `scheduled_transactions.group_closing_id` e a trava da conta gerada
--   SECAO 7  `registrar_fechamento_do_grupo`: a escrita, numa transacao so
--   SECAO 8  RLS e grants
--   SECAO 9  `cron_runs` aceita o job `group-closings`
--
-- POR QUE O ITEM FECHADO GANHA UMA LINHA PROPRIA (SECAO 5)
-- --------------------------------------------------------
-- A regra que mais pode dar errado aqui e contar a mesma despesa em DOIS
-- fechamentos. "A despesa entra no periodo da sua data" nao basta, porque a
-- RN018.3 manda a despesa lancada com data de um periodo JA fechado para o
-- PROXIMO fechamento -- entao o criterio de entrada e "ainda nao fechada", e
-- isso precisa estar gravado em algum lugar. Uma coluna em `group_transactions`
-- seria editavel pela policy de UPDATE dos membros (002:547), e um membro que
-- apagasse a marca faria a despesa entrar de novo. A tabela propria nao tem
-- policy de escrita nenhuma para `authenticated`, e os dois indices unicos
-- (despesa e acerto) fazem o banco recusar o mesmo item em dois fechamentos.
--
-- POR QUE A CONTA GERADA NAO LEVA `group_id`
-- -----------------------------------------
-- `scheduled_transactions.group_id` quer dizer "conta DO GRUPO": ela entra na
-- aba de previstas do grupo, no fechamento mensal (HMO-245), no `my_status` da
-- 055. A conta do fechamento e do MEMBRO -- e a divida dele com o grupo, nao uma
-- conta que o grupo divide. Com `group_id` ela entraria no proximo fechamento
-- como despesa do grupo. O elo dela e `group_closing_id`.
--
-- POR QUE O CRON NAO ESTA NO vercel.json AINDA
-- -------------------------------------------
-- Ate a fase 4, a parte de cada membro continua contando no realizado pelo
-- rateio (033/046). Gerar "Pagamento ao grupo" antes disso conta a divida DUAS
-- vezes para quem deve. Esta migration e a rota existem; o agendamento entra
-- junto com a leitura nova.
--
-- O PASSO HUMANO
-- --------------
-- Colar no SQL Editor do Supabase depois do merge. E ADITIVA (uma coluna em
-- duas tabelas, duas tabelas novas, duas categorias, uma funcao e um trigger) e
-- re-executavel. Nenhum codigo em producao le nada disto antes do merge.
-- ===========================================================================

-- ===========================================================================
-- SECAO 1: PREFLIGHT
-- ===========================================================================
DO $$
DECLARE
  v_faltando text := '';
BEGIN
  IF to_regclass('public.expense_groups') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.expense_groups (vem do 001)';
  END IF;

  IF to_regclass('public.group_transactions') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.group_transactions (vem do 001)';
  END IF;

  IF to_regclass('public.group_settlements') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.group_settlements (vem do 007)';
  END IF;

  IF to_regclass('public.scheduled_transactions') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.scheduled_transactions (vem do 005)';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'scheduled_transactions'
       AND column_name  = 'transaction_type'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna scheduled_transactions.transaction_type (vem do 027)';
  END IF;

  IF to_regprocedure('public.is_group_member(uuid)') IS NULL THEN
    v_faltando := v_faltando || E'\n  - funcao public.is_group_member(uuid) (vem do 002)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.financial_services
     WHERE id = '8730cd96-d656-4c48-863e-673e1016a832'
  ) THEN
    v_faltando := v_faltando || E'\n  - servico personal_finance 8730cd96-... (vem do seed do 001)';
  END IF;

  IF v_faltando <> '' THEN
    RAISE EXCEPTION E'067 nao pode ser aplicado neste banco. Faltando:%\n\nRode 001 -> ... -> 066 antes.', v_faltando;
  END IF;
END $$;

-- ===========================================================================
-- SECAO 2: O DIA DE FECHAMENTO
-- ===========================================================================
-- De 1 a 28 porque todo mes tem dia 28: um fechamento no dia 31 nao aconteceria
-- em fevereiro, e "o ultimo dia do mes" seria uma segunda regra para a mesma
-- coluna. NULL e o estado de todo grupo que existe hoje, e quer dizer "este
-- grupo nao fecha": o cron passa direto por ele.
ALTER TABLE public.expense_groups
  ADD COLUMN IF NOT EXISTS closing_day smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expense_groups_closing_day_check'
  ) THEN
    ALTER TABLE public.expense_groups
      ADD CONSTRAINT expense_groups_closing_day_check
      CHECK (closing_day IS NULL OR closing_day BETWEEN 1 AND 28);
  END IF;
END $$;

COMMENT ON COLUMN public.expense_groups.closing_day IS
  'Dia do mes (1 a 28) em que o periodo do grupo fecha e o saldo de cada membro vira conta a pagar ou a receber (RN018, 067). NULL = o grupo nao fecha.';

-- ===========================================================================
-- SECAO 3: AS CATEGORIAS RESERVADAS DAS CONTAS GERADAS
-- ===========================================================================
-- `scheduled_transactions.category_id` e NOT NULL (005), e a conta gerada nao
-- e de nenhuma categoria de consumo: e a divida com o grupo. As duas nascem
-- inativas, como a de transferencia (023), para nao aparecerem nos seletores; a
-- fase 4 classifica "Despesas · grupo" e "Receitas · grupo" por elas. O
-- `WHERE NOT EXISTS` olha (service_id, name), que e a UNIQUE da tabela, pelo
-- mesmo motivo da 023: e o que torna a re-execucao inofensiva.
INSERT INTO public.transaction_categories
  (id, service_id, name, description, icon, color_hex, is_expense, is_active)
SELECT
  '2d0cd129-b5a6-400f-b3b4-702c72ced10e',
  '8730cd96-d656-4c48-863e-673e1016a832',
  'Pagamento a grupo',
  'Reservada para a conta que o fechamento do grupo gera para quem deve. Não aparece nos seletores.',
  'users',
  '#6B7280',
  TRUE,
  FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM public.transaction_categories
   WHERE service_id = '8730cd96-d656-4c48-863e-673e1016a832'
     AND name = 'Pagamento a grupo'
);

INSERT INTO public.transaction_categories
  (id, service_id, name, description, icon, color_hex, is_expense, is_active)
SELECT
  'f17cbc31-ce0d-4ee8-aa0c-1541736e4ad5',
  '8730cd96-d656-4c48-863e-673e1016a832',
  'Recebimento de grupo',
  'Reservada para a conta que o fechamento do grupo gera para quem tem a receber. Não aparece nos seletores.',
  'users',
  '#6B7280',
  FALSE,
  FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM public.transaction_categories
   WHERE service_id = '8730cd96-d656-4c48-863e-673e1016a832'
     AND name = 'Recebimento de grupo'
);

-- A policy de leitura das ativas (`is_active = TRUE`) nao alcanca estas duas,
-- e a da 023 so libera a de transferencia, pelo nome. Sem esta, a conta gerada
-- chega na agenda com a categoria nula no embed.
DROP POLICY IF EXISTS transaction_categories_read_reservada_do_grupo
  ON public.transaction_categories;
CREATE POLICY transaction_categories_read_reservada_do_grupo
  ON public.transaction_categories
  FOR SELECT TO authenticated
  USING (
    is_active = FALSE
    AND id IN ('2d0cd129-b5a6-400f-b3b4-702c72ced10e',
               'f17cbc31-ce0d-4ee8-aa0c-1541736e4ad5')
  );

-- ===========================================================================
-- SECAO 4: group_closings -- UM FECHAMENTO POR GRUPO E PERIODO
-- ===========================================================================
-- A UNIQUE (group_id, period_end) e a garantia da RN018.6: o cron pode rodar
-- duas vezes no mesmo dia (a Vercel tem tolerancia de +-59 min, RN015.3, e um
-- reenvio manual e possivel), e a segunda execucao encontra o periodo fechado.
--
-- `members` e a FOTO do fechamento, por membro: o % que valeu, o que pagou, os
-- acertos, a responsabilidade e o saldo. Mudar o % depois nao reabre o periodo
-- (RN018.6), entao o numero que valeu tem de ficar gravado aqui, e nao ser
-- recalculado a partir da configuracao de hoje.
CREATE TABLE IF NOT EXISTS public.group_closings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    -- BRL, a soma das despesas do periodo.
    total numeric(15,2) NOT NULL,
    members jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT group_closings_pkey PRIMARY KEY (id),
    CONSTRAINT group_closings_group_id_fkey FOREIGN KEY (group_id)
      REFERENCES public.expense_groups(id) ON DELETE CASCADE,
    CONSTRAINT group_closings_period_check CHECK (period_start <= period_end),
    CONSTRAINT group_closings_total_check CHECK (total >= (0)::numeric),
    CONSTRAINT group_closings_group_period_key UNIQUE (group_id, period_end)
);

COMMENT ON TABLE public.group_closings IS
  'Um fechamento de periodo de um grupo (RN018, 067). UNIQUE (group_id, period_end): o mesmo periodo nao fecha duas vezes. members e a foto por membro (percentual, pago, acertos, responsabilidade, saldo) que valeu no dia; mudar o % depois nao reabre o periodo. Escrita so por registrar_fechamento_do_grupo.';

-- ===========================================================================
-- SECAO 5: group_closing_items -- O QUE ENTROU EM CADA FECHAMENTO
-- ===========================================================================
-- Duas especies de item:
--
--   despesa  uma despesa REALIZADA do grupo (`group_transactions`). A conta
--            prevista entra quando e paga, pela transacao que a baixa cria
--            (RN018.3) -- entao ela nunca e item por si.
--   acerto   um `group_settlements` registrado sem conta gerada, o acerto de
--            antes da fase 3 (RN018.11). Sem ele, quem ja pagou a Lais pelo
--            Pix receberia a mesma divida de novo na conta do fechamento.
--
-- Os ids sao ON DELETE SET NULL, e o valor, a data e as pessoas ficam gravados
-- no item: apagar a despesa depois do fechamento nao reabre o periodo, e o
-- fechamento continua sabendo dizer o que somou.
CREATE TABLE IF NOT EXISTS public.group_closing_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    closing_id uuid NOT NULL,
    group_id uuid NOT NULL,
    kind text NOT NULL,
    transaction_id uuid,
    settlement_id uuid,
    -- despesa: quem pagou. acerto: quem mandou o dinheiro.
    from_user_id uuid NOT NULL,
    -- acerto: quem recebeu. despesa: NULL.
    to_user_id uuid,
    -- BRL, sempre positivo.
    amount numeric(15,2) NOT NULL,
    item_date date NOT NULL,
    description text,
    CONSTRAINT group_closing_items_pkey PRIMARY KEY (id),
    CONSTRAINT group_closing_items_closing_id_fkey FOREIGN KEY (closing_id)
      REFERENCES public.group_closings(id) ON DELETE CASCADE,
    CONSTRAINT group_closing_items_group_id_fkey FOREIGN KEY (group_id)
      REFERENCES public.expense_groups(id) ON DELETE CASCADE,
    CONSTRAINT group_closing_items_transaction_id_fkey FOREIGN KEY (transaction_id)
      REFERENCES public.financial_transactions(id) ON DELETE SET NULL,
    CONSTRAINT group_closing_items_settlement_id_fkey FOREIGN KEY (settlement_id)
      REFERENCES public.group_settlements(id) ON DELETE SET NULL,
    CONSTRAINT group_closing_items_kind_check CHECK (kind IN ('despesa', 'acerto')),
    CONSTRAINT group_closing_items_amount_check CHECK (amount > (0)::numeric),
    CONSTRAINT group_closing_items_partes_check CHECK (
      (kind = 'despesa' AND to_user_id IS NULL AND settlement_id IS NULL)
      OR (kind = 'acerto' AND to_user_id IS NOT NULL AND transaction_id IS NULL
          AND to_user_id <> from_user_id)
    )
);

COMMENT ON TABLE public.group_closing_items IS
  'O que entrou em cada fechamento de grupo (067): despesa realizada do grupo ou acerto antigo (sem conta gerada). Os indices unicos por transaction_id e por settlement_id fazem o banco recusar o mesmo item em dois fechamentos. Escrita so por registrar_fechamento_do_grupo.';

CREATE UNIQUE INDEX IF NOT EXISTS group_closing_items_transaction_key
  ON public.group_closing_items (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS group_closing_items_settlement_key
  ON public.group_closing_items (settlement_id) WHERE settlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_group_closing_items_closing
  ON public.group_closing_items (closing_id);
CREATE INDEX IF NOT EXISTS idx_group_closing_items_group
  ON public.group_closing_items (group_id);

-- ===========================================================================
-- SECAO 6: A CONTA GERADA E A TRAVA DELA
-- ===========================================================================
ALTER TABLE public.scheduled_transactions
  ADD COLUMN IF NOT EXISTS group_closing_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'scheduled_transactions_group_closing_id_fkey'
  ) THEN
    ALTER TABLE public.scheduled_transactions
      ADD CONSTRAINT scheduled_transactions_group_closing_id_fkey
      FOREIGN KEY (group_closing_id)
      REFERENCES public.group_closings(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.scheduled_transactions.group_closing_id IS
  'O fechamento de grupo que gerou esta conta (067): Pagamento ao grupo ou A receber do grupo. Conta gerada nao leva group_id -- ela e do membro, nao uma conta que o grupo divide. Valor, tipo, dono e vencimento ficam travados por scheduled_transactions_trava_do_fechamento.';

-- Uma conta por membro por fechamento: o saldo de um membro e UM numero.
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_transactions_group_closing_user_key
  ON public.scheduled_transactions (group_closing_id, user_id)
  WHERE group_closing_id IS NOT NULL;

-- A TRAVA. Policy de UPDATE nao compara NEW com OLD, e a do 005 deixa o dono
-- mexer em tudo na linha dele -- inclusive baixar a propria divida de R$ 400
-- para R$ 0,01. O molde e o da 053 (`mybank_installments_trava_do_devedor`):
--
--   * `auth.uid() IS NULL` passa direto. E a sessao que nao e do app: o cron
--     com service_role, a colagem no SQL Editor, a propria funcao da SECAO 7.
--   * sessao do app NAO cria conta com `group_closing_id`: o elo so nasce no
--     fechamento.
--   * sessao do app NAO muda valor, tipo, dono, vencimento, moeda, grupo nem o
--     elo de uma conta gerada. A baixa (status, paid_date, transaction_id) e a
--     conta de onde sai o dinheiro (account_id) continuam livres -- e por elas
--     que a conta e paga.
--
-- O elo pode cair para NULL quando o FECHAMENTO deixou de existir: e o ON
-- DELETE SET NULL acima, disparado por quem apagou o grupo. A FK roda o UPDATE
-- na sessao de quem apagou, entao sem esta excecao apagar um grupo com
-- fechamento seria recusado pela trava.
CREATE OR REPLACE FUNCTION public.scheduled_transactions_trava_do_fechamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.group_closing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Conta de fechamento de grupo so nasce no fechamento'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.group_closing_id IS NULL THEN
    IF NEW.group_closing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Conta de fechamento de grupo so nasce no fechamento'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.group_closing_id IS DISTINCT FROM OLD.group_closing_id
     AND NOT (
       NEW.group_closing_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.group_closings c
                        WHERE c.id = OLD.group_closing_id)
     )
  THEN
    RAISE EXCEPTION 'O elo da conta com o fechamento do grupo nao se edita'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.amount                 IS DISTINCT FROM OLD.amount
     OR NEW.transaction_type    IS DISTINCT FROM OLD.transaction_type
     OR NEW.user_id             IS DISTINCT FROM OLD.user_id
     OR NEW.due_date            IS DISTINCT FROM OLD.due_date
     OR NEW.currency            IS DISTINCT FROM OLD.currency
     OR NEW.group_id            IS DISTINCT FROM OLD.group_id
     OR NEW.recurring_rule_id   IS DISTINCT FROM OLD.recurring_rule_id
  THEN
    RAISE EXCEPTION 'Conta gerada pelo fechamento do grupo nao muda de valor, tipo, dono nem vencimento (RN018.12)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.scheduled_transactions_trava_do_fechamento() IS
  'Prende a conta gerada pelo fechamento do grupo (067, RN018.12). Sessao do app nao cria conta com group_closing_id e nao muda valor, tipo, dono, vencimento, moeda, grupo nem o elo de uma conta gerada; a baixa e a conta de pagamento continuam livres. auth.uid() IS NULL passa direto (cron, colagem, a funcao do fechamento). O elo cai para NULL so quando o fechamento deixou de existir (ON DELETE SET NULL).';

DROP TRIGGER IF EXISTS scheduled_transactions_trava_do_fechamento ON public.scheduled_transactions;
CREATE TRIGGER scheduled_transactions_trava_do_fechamento
  BEFORE INSERT OR UPDATE ON public.scheduled_transactions
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_transactions_trava_do_fechamento();

-- ===========================================================================
-- SECAO 7: A ESCRITA DO FECHAMENTO, NUMA TRANSACAO SO
-- ===========================================================================
-- O calculo e de lib/fechamento-por-periodo.ts (o rateio por maior-resto, o
-- mesmo de `ratearPorPeso`), e o cron manda o resultado pronto em `p_fechamento`:
--
--   { "total": 2000.00,
--     "membros": [ { "user_id", "percentual", "pago", "acertos",
--                    "responsabilidade", "saldo" }, ... ],
--     "itens":   [ { "kind", "transaction_id", "settlement_id", "from_user_id",
--                    "to_user_id", "amount", "item_date", "description" }, ... ],
--     "contas":  [ { "user_id", "tipo": "expense"|"income", "valor" }, ... ] }
--
-- Com o supabase-js nao existe transacao de varias instrucoes, e um fechamento
-- gravado pela metade e o pior estado possivel: o periodo marcado como fechado
-- sem as contas, e nada que o reabra. Aqui sao tres INSERTs numa funcao, e
-- qualquer erro desfaz os tres.
--
-- O BANCO CONFERE A CONTA QUE RECEBE
-- ----------------------------------
-- O rateio e do TypeScript, mas as somas que ele tem de respeitar sao
-- conferidas aqui, porque um erro nelas e dinheiro inventado que ninguem ve:
--
--   1. todo item e deste grupo, tem data ate o fim do periodo, e as pessoas
--      dele sao as da despesa ou do acerto de verdade;
--   2. `total` e a soma das despesas;
--   3. por membro: `pago` e a soma das despesas dele, `acertos` e o que ele
--      mandou menos o que recebeu, e `saldo = pago + acertos - responsabilidade`;
--   4. a soma das responsabilidades e o total;
--   5. cada saldo diferente de zero tem a SUA conta, do tipo e valor certos, e
--      nao ha conta sem saldo. Junto com 3 e 4, isso faz os saldos somarem zero;
--   6. todo mundo que aparece num item esta na foto dos membros.
--
-- O periodo ja fechado devolve NULL e nao grava nada: e o que torna o cron
-- re-executavel.
--
-- So `service_role` executa. Um membro que chamasse esta funcao pela API
-- escolheria o valor da divida dos outros.
CREATE OR REPLACE FUNCTION public.registrar_fechamento_do_grupo(
  p_group_id uuid,
  p_period_start date,
  p_period_end date,
  p_fechamento jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nome text;
  v_closing_id uuid;
  v_total numeric(15,2);
  v_erro text;
BEGIN
  SELECT g.name INTO v_nome FROM public.expense_groups g WHERE g.id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fechamento: o grupo % nao existe', p_group_id;
  END IF;

  v_total := (p_fechamento->>'total')::numeric(15,2);

  INSERT INTO public.group_closings (group_id, period_start, period_end, total, members)
  VALUES (p_group_id, p_period_start, p_period_end, v_total,
          COALESCE(p_fechamento->'membros', '[]'::jsonb))
  ON CONFLICT (group_id, period_end) DO NOTHING
  RETURNING id INTO v_closing_id;

  IF v_closing_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.group_closing_items
    (closing_id, group_id, kind, transaction_id, settlement_id,
     from_user_id, to_user_id, amount, item_date, description)
  SELECT v_closing_id, p_group_id, i.kind, i.transaction_id, i.settlement_id,
         i.from_user_id, i.to_user_id, i.amount, i.item_date, i.description
    FROM jsonb_to_recordset(COALESCE(p_fechamento->'itens', '[]'::jsonb)) AS i(
      kind text, transaction_id uuid, settlement_id uuid, from_user_id uuid,
      to_user_id uuid, amount numeric(15,2), item_date date, description text);

  -- 1. o item e deste grupo, do periodo, e das pessoas certas
  SELECT format('item %s nao confere com o grupo, o periodo ou as pessoas', i.id)
    INTO v_erro
    FROM public.group_closing_items i
   WHERE i.closing_id = v_closing_id
     AND (
       i.item_date > p_period_end
       OR (i.kind = 'despesa' AND NOT EXISTS (
             SELECT 1
               FROM public.group_transactions gt
               JOIN public.financial_transactions t ON t.id = gt.transaction_id
              WHERE gt.transaction_id = i.transaction_id
                AND gt.group_id = p_group_id
                AND t.user_id = i.from_user_id))
       OR (i.kind = 'acerto' AND NOT EXISTS (
             SELECT 1 FROM public.group_settlements s
              WHERE s.id = i.settlement_id
                AND s.group_id = p_group_id
                AND s.from_user_id = i.from_user_id
                AND s.to_user_id = i.to_user_id))
     )
   LIMIT 1;
  IF v_erro IS NOT NULL THEN
    RAISE EXCEPTION 'Fechamento: %', v_erro;
  END IF;

  -- 2. o total
  IF v_total IS DISTINCT FROM (
    SELECT COALESCE(SUM(i.amount), 0) FROM public.group_closing_items i
     WHERE i.closing_id = v_closing_id AND i.kind = 'despesa'
  ) THEN
    RAISE EXCEPTION 'Fechamento: o total % nao e a soma das despesas', v_total;
  END IF;

  -- 3, 4 e 6. a foto dos membros
  WITH m AS (
    SELECT * FROM jsonb_to_recordset(COALESCE(p_fechamento->'membros', '[]'::jsonb))
      AS x(user_id uuid, percentual numeric, pago numeric(15,2),
           acertos numeric(15,2), responsabilidade numeric(15,2),
           saldo numeric(15,2))
  ), it AS (
    SELECT * FROM public.group_closing_items WHERE closing_id = v_closing_id
  )
  SELECT CASE
    WHEN (SELECT count(*) FROM m) <> (SELECT count(DISTINCT user_id) FROM m)
      THEN 'membro repetido na foto'
    WHEN EXISTS (
      SELECT 1 FROM it
       WHERE it.from_user_id NOT IN (SELECT user_id FROM m)
          OR (it.to_user_id IS NOT NULL AND it.to_user_id NOT IN (SELECT user_id FROM m)))
      THEN 'item de alguem que nao esta na foto dos membros'
    WHEN EXISTS (
      SELECT 1 FROM m
       WHERE m.pago IS DISTINCT FROM (
               SELECT COALESCE(SUM(it.amount), 0) FROM it
                WHERE it.kind = 'despesa' AND it.from_user_id = m.user_id)
          OR m.acertos IS DISTINCT FROM (
               (SELECT COALESCE(SUM(it.amount), 0) FROM it
                 WHERE it.kind = 'acerto' AND it.from_user_id = m.user_id)
             - (SELECT COALESCE(SUM(it.amount), 0) FROM it
                 WHERE it.kind = 'acerto' AND it.to_user_id = m.user_id))
          OR m.saldo IS DISTINCT FROM (m.pago + m.acertos - m.responsabilidade)
          OR m.responsabilidade < 0)
      THEN 'pago, acertos ou saldo de um membro nao confere com os itens'
    WHEN v_total IS DISTINCT FROM (SELECT COALESCE(SUM(responsabilidade), 0) FROM m)
      THEN 'a soma das responsabilidades nao e o total'
  END
  INTO v_erro;
  IF v_erro IS NOT NULL THEN
    RAISE EXCEPTION 'Fechamento: %', v_erro;
  END IF;

  -- 5. as contas
  WITH m AS (
    SELECT * FROM jsonb_to_recordset(COALESCE(p_fechamento->'membros', '[]'::jsonb))
      AS x(user_id uuid, saldo numeric(15,2))
  ), c AS (
    SELECT * FROM jsonb_to_recordset(COALESCE(p_fechamento->'contas', '[]'::jsonb))
      AS x(user_id uuid, tipo text, valor numeric(15,2))
  ), esperado AS (
    SELECT user_id,
           CASE WHEN saldo < 0 THEN 'expense' ELSE 'income' END AS tipo,
           abs(saldo) AS valor
      FROM m WHERE saldo <> 0
  )
  SELECT CASE
    WHEN EXISTS (SELECT user_id, tipo, valor FROM esperado
                 EXCEPT ALL SELECT user_id, tipo, valor FROM c)
      OR EXISTS (SELECT user_id, tipo, valor FROM c
                 EXCEPT ALL SELECT user_id, tipo, valor FROM esperado)
    THEN 'as contas nao sao os saldos dos membros'
  END
  INTO v_erro;
  IF v_erro IS NOT NULL THEN
    RAISE EXCEPTION 'Fechamento: %', v_erro;
  END IF;

  INSERT INTO public.scheduled_transactions
    (user_id, category_id, description, amount, due_date, status,
     transaction_type, currency, group_closing_id)
  SELECT c.user_id,
         CASE c.tipo WHEN 'expense' THEN '2d0cd129-b5a6-400f-b3b4-702c72ced10e'::uuid
                     ELSE 'f17cbc31-ce0d-4ee8-aa0c-1541736e4ad5'::uuid END,
         CASE c.tipo WHEN 'expense' THEN 'Pagamento ao grupo ' || v_nome
                     ELSE 'A receber do grupo ' || v_nome END,
         c.valor,
         p_period_end,
         'pending',
         c.tipo::public.transaction_financial_type,
         'BRL',
         v_closing_id
    FROM jsonb_to_recordset(COALESCE(p_fechamento->'contas', '[]'::jsonb))
      AS c(user_id uuid, tipo text, valor numeric(15,2));

  RETURN v_closing_id;
END $$;

COMMENT ON FUNCTION public.registrar_fechamento_do_grupo(uuid, date, date, jsonb) IS
  'Grava um fechamento de grupo numa transacao so (067): o fechamento, os itens e as contas Pagamento ao grupo / A receber do grupo, com vencimento no fim do periodo (RN018.5). Confere as somas que o calculo de lib/fechamento-por-periodo.ts tem de respeitar e recusa o fechamento inteiro se uma falhar. Periodo ja fechado devolve NULL sem gravar nada. So service_role executa.';

REVOKE ALL ON FUNCTION public.registrar_fechamento_do_grupo(uuid, date, date, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_fechamento_do_grupo(uuid, date, date, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.registrar_fechamento_do_grupo(uuid, date, date, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_fechamento_do_grupo(uuid, date, date, jsonb) TO service_role;

-- ===========================================================================
-- SECAO 8: RLS E GRANTS DAS DUAS TABELAS
-- ===========================================================================
-- Membro do grupo LE o fechamento e os itens. Ninguem do app escreve: nao ha
-- policy de INSERT, UPDATE nem DELETE, e o GRANT e so de SELECT.
ALTER TABLE public.group_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_closing_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS group_closings_select ON public.group_closings;
CREATE POLICY group_closings_select ON public.group_closings
  FOR SELECT TO authenticated
  USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS group_closing_items_select ON public.group_closing_items;
CREATE POLICY group_closing_items_select ON public.group_closing_items
  FOR SELECT TO authenticated
  USING (public.is_group_member(group_id));

REVOKE ALL ON public.group_closings FROM anon;
REVOKE ALL ON public.group_closing_items FROM anon;
REVOKE ALL ON public.group_closings FROM authenticated;
REVOKE ALL ON public.group_closing_items FROM authenticated;
GRANT SELECT ON public.group_closings TO authenticated;
GRANT SELECT ON public.group_closing_items TO authenticated;
GRANT ALL ON public.group_closings TO service_role;
GRANT ALL ON public.group_closing_items TO service_role;

-- ===========================================================================
-- SECAO 9: O LIVRO-RAZAO DOS CRONS ACEITA O JOB NOVO
-- ===========================================================================
-- O CHECK da 019 lista os jobs pelo nome, e o cron do fechamento grava em
-- `cron_runs` como `group-closings`. Sem isto a PRIMEIRA execucao dele
-- terminaria sem registro -- `gravarLinha` engole o erro para nao derrubar a
-- resposta --, e a auditoria leria "nunca rodou". Refeito com a lista inteira,
-- porque CHECK nao se edita.
DO $$
BEGIN
  IF to_regclass('public.cron_runs') IS NOT NULL THEN
    ALTER TABLE public.cron_runs DROP CONSTRAINT IF EXISTS cron_runs_job_check;
    ALTER TABLE public.cron_runs
      ADD CONSTRAINT cron_runs_job_check
      CHECK (job IN (
        'recurrence-scan',
        'recurrence-alerts',
        'bill-alerts',
        'monthly-summary',
        'group-closings'
      ));
  END IF;
END $$;
