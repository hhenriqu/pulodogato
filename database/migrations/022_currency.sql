-- 022_currency.sql
--
-- HMO-171, partes 2 e 3: moeda por conta, moeda por lancamento, e resultado
-- separado por moeda.
--
-- As duas decisoes do Helio na issue (interaction respondida em 2026-09-29):
--
--   "os-dois"    -- a CONTA define a moeda padrao dela, e o LANCAMENTO pode
--                   sobrepor. Por isso ha coluna nos dois lugares, e nao num so.
--   "ficam-brl"  -- lancamento que ja existe continua em BRL. A moeda oficial
--                   vale para o que for criado a partir de agora. E por isso que
--                   a coluna nasce NOT NULL DEFAULT 'BRL': o backfill do
--                   historico e exatamente o default, nao ha reescrita de
--                   historico, e nao existe linha sem moeda em nenhum momento.
--
-- ===========================================================================
-- O PERIGO QUE ESTA MIGRATION EXISTE PARA FECHAR
-- ===========================================================================
-- Guardar a moeda e a parte facil. O risco mora nas views de relatorio do 008,
-- que somam `amount` sem saber de moeda:
--
--   SUM(ABS(amount)) FILTER (WHERE transaction_type = 'expense')
--
-- No mundo de uma moeda isso e o gasto do mes. No minuto em que existir um
-- lancamento em dolar, esse mesmo SUM soma 1000 reais com 180 dolares e devolve
-- 1180 -- um numero que nao esta em moeda nenhuma, com cara de total. Nao ha
-- erro, nao ha NULL, nao ha nada para um teste de "a consulta funciona" pegar:
-- o fluxo de caixa simplesmente passa a mentir, e para MAIS, que e o lado do
-- qual ninguem reclama.
--
-- Nao existe conversao possivel aqui: o app nao tem cotacao de cambio, e o
-- pedido da issue e justamente MOSTRAR SEPARADO em vez de converter. Entao a
-- moeda entra no GRAO das tres views. Cada linha passa a ser de uma unica
-- moeda, e todo numero que sai delas esta em exatamente uma moeda -- o que era
-- verdade por acidente antes, e passa a ser verdade por construcao.
--
-- POR QUE A COLUNA `currency` VAI NO FIM DA LISTA DAS VIEWS
-- ---------------------------------------------------------
-- `CREATE OR REPLACE VIEW` so aceita colunas NOVAS no fim; mudar a posicao de
-- uma existente exige DROP. E `DROP ... CASCADE` aqui levaria as tres views
-- juntas mais os GRANTs e o `security_invoker` de cada uma, e um CASCADE derruba
-- tambem o que eu nao listei. Fica no fim de proposito: e feio e e reversivel.
--
-- POR QUE `planned_vs_actual` MUDA SEM TER PEDIDO NADA
-- ---------------------------------------------------
-- Ela le `monthly_cash_flow` por `LEFT JOIN LATERAL` sem agregado e sem LIMIT.
-- Enquanto a view tinha uma linha por mes, isso devolvia uma linha. Com a moeda
-- no grao passa a devolver UMA POR MOEDA, e o LATERAL multiplica a linha de
-- `chaves`: o previsto x realizado do mes apareceria duas vezes, cada uma com o
-- previsto inteiro repetido, e o estouro de orcamento dobraria. Por isso a moeda
-- entra no grao dela tambem, e o LATERAL passa a casar por moeda.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. O catalogo de moedas, em SQL
-- ---------------------------------------------------------------------------
-- A fonte de verdade e `MOEDAS` em lib/dinheiro.ts -- e ela que decide simbolo e
-- numero de casas, e e ela que o `<select>` oferece. Esta lista e a mesma, do
-- lado do banco, para que um INSERT com moeda que o app nao conhece seja
-- recusado em vez de virar uma linha que nenhuma tela sabe formatar
-- (`moedaPorCodigo` cai no padrao, ou seja: um lancamento em CZK apareceria como
-- reais, silenciosamente).
--
-- Duas copias da mesma lista sao duas listas diferentes no primeiro dia em que
-- alguem acrescentar uma moeda. Quem protege daqui em diante e o ultimo caso de
-- `scripts/test-dinheiro.mjs`: ele le ESTE arquivo, acha os tres CHECK e compara
-- codigo por codigo com `MOEDAS`. Fica vermelho nas duas direcoes -- moeda que
-- sobra no SQL e moeda que sobra no TypeScript.
--
-- Ele mora naquela suite, e nao num teste de banco, porque o workflow `dinheiro`
-- roda em todo PR sem filtro de path: a divergencia aparece no mesmo PR que a
-- causa. O db-verify e filtrado por `database/**` e nao veria um PR que so mexe
-- em lib/dinheiro.ts.

-- O CHECK de cada tabela vem logo DEPOIS do respectivo ADD COLUMN, nunca antes:
-- um CHECK sobre coluna que ainda nao existe reprova a migration inteira
-- ("column \"currency\" does not exist"), e como tudo aqui esta num BEGIN, o
-- lote inteiro volta atras -- o modo mais barato de nao aplicar nada e achar que
-- aplicou.

-- ---------------------------------------------------------------------------
-- 2. Moeda da conta  (o padrao que os lancamentos dela herdam)
-- ---------------------------------------------------------------------------

ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL';

COMMENT ON COLUMN public.financial_accounts.currency IS
  'Moeda desta conta (ISO 4217). E o padrao sugerido a cada lancamento dela; o lancamento pode sobrepor. Toda conta que ja existia e BRL.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'financial_accounts_currency_check'
  ) THEN
    ALTER TABLE public.financial_accounts
      ADD CONSTRAINT financial_accounts_currency_check
      CHECK (currency IN ('BRL','USD','EUR','GBP','CHF','CAD','AUD','ARS','CLP','UYU','PYG','JPY','CNY'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Moeda do lancamento  (a que vale para o dinheiro)
-- ---------------------------------------------------------------------------
-- Esta e a coluna que manda. A da conta e sugestao; esta e o que o relatorio
-- soma. Ter as duas e o que a resposta "os-dois" pede, e a razao de o
-- lancamento nao ler a moeda da conta por JOIN na hora do relatorio: uma conta
-- que troca de moeda reescreveria a moeda de todo lancamento passado dela.

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL';

COMMENT ON COLUMN public.financial_transactions.currency IS
  'Moeda deste lancamento (ISO 4217). Sobrepoe a moeda da conta. E a coluna que as views de relatorio agrupam -- nunca somar amount de moedas diferentes.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_currency_check'
  ) THEN
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_currency_check
      CHECK (currency IN ('BRL','USD','EUR','GBP','CHF','CAD','AUD','ARS','CLP','UYU','PYG','JPY','CNY'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Moeda da conta prevista
-- ---------------------------------------------------------------------------
-- `scheduled_transactions` entra junto porque `planned_vs_actual` cruza os dois
-- lados por mes. Sem moeda no previsto, o realizado em dolar nao teria previsto
-- com que casar e apareceria como "gastou 180 sem ter previsto nada" -- um
-- estouro de 100% inventado pela ausencia da coluna, nao por gasto nenhum.

ALTER TABLE public.scheduled_transactions
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL';

COMMENT ON COLUMN public.scheduled_transactions.currency IS
  'Moeda desta conta prevista (ISO 4217). Herdada da conta na criacao. Casa com financial_transactions.currency no previsto x realizado.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_transactions_currency_check'
  ) THEN
    ALTER TABLE public.scheduled_transactions
      ADD CONSTRAINT scheduled_transactions_currency_check
      CHECK (currency IN ('BRL','USD','EUR','GBP','CHF','CAD','AUD','ARS','CLP','UYU','PYG','JPY','CNY'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. As views de relatorio, com a moeda no grao
-- ---------------------------------------------------------------------------
-- O resto de cada view e identico ao 008 de proposito: o ABS() com filtro por
-- `transaction_type` (despesa e gravada negativa, e um SUM cru devolveria -800
-- para quem gastou 800), o `transfer` de fora, o grao por (user_id, group_id).
-- A unica diferenca e a moeda -- reescrever mais do que isso aqui seria mudar
-- dois numeros ao mesmo tempo e nao saber qual deles quebrou.

CREATE OR REPLACE VIEW public.category_monthly_totals AS
  SELECT
    t.user_id,
    t.group_id,
    date_trunc('month', t.transaction_date)::date AS month,
    t.category_id,
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'expense'), 0)::numeric(15,2) AS expense,
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'income'), 0)::numeric(15,2) AS income,
    (COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'income'), 0)
     - COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'expense'), 0))::numeric(15,2) AS net,
    COUNT(*) FILTER (WHERE t.transaction_type IN ('expense', 'income')) AS transaction_count,
    t.currency
  FROM public.financial_transactions t
  WHERE t.transaction_type IN ('expense', 'income')
  GROUP BY t.user_id, t.group_id, date_trunc('month', t.transaction_date)::date, t.category_id, t.currency;

COMMENT ON VIEW public.category_monthly_totals IS
  'Entrada e saida por categoria, mes e MOEDA. Ignora transfer. Cada linha esta em uma moeda so: somar linhas de moedas diferentes nao da numero nenhum.';

CREATE OR REPLACE VIEW public.monthly_cash_flow AS
  SELECT
    c.user_id,
    c.group_id,
    c.month,
    SUM(c.income)::numeric(15,2) AS income,
    SUM(c.expense)::numeric(15,2) AS expense,
    SUM(c.net)::numeric(15,2) AS net,
    SUM(c.transaction_count) AS transaction_count,
    c.currency
  FROM public.category_monthly_totals c
  GROUP BY c.user_id, c.group_id, c.month, c.currency;

COMMENT ON VIEW public.monthly_cash_flow IS
  'Entrada, saida e resultado por mes e MOEDA. Rollup de category_monthly_totals para nao ter duas versoes do mesmo numero. Um mes com duas moedas tem DUAS linhas -- quem le precisa agrupar, nao somar.';

-- `planned_vs_actual`: a moeda entra nas chaves e nos dois LATERAL.
--
-- O `IS NOT DISTINCT FROM` do group_id continua sendo o que faz o lado pessoal
-- casar (group_id e NULL na maioria das linhas, e `NULL = NULL` e NULL, nao
-- verdadeiro -- com `=` a tela mostraria previsto e realizado em meses
-- separados, cada um com o outro lado zerado). A moeda e NOT NULL nas duas
-- tabelas, entao ela pode casar por `=` mesmo; usa `IS NOT DISTINCT FROM` por
-- simetria com a linha de cima, que custa nada e nao convida ninguem a
-- perguntar por que os dois criterios ao lado sao diferentes.
CREATE OR REPLACE VIEW public.planned_vs_actual AS
  WITH chaves AS (
    SELECT s.user_id, s.group_id, date_trunc('month', s.due_date)::date AS month, s.currency
    FROM public.scheduled_transactions s
    UNION
    SELECT t.user_id, t.group_id, date_trunc('month', t.transaction_date)::date AS month, t.currency
    FROM public.financial_transactions t
    WHERE t.transaction_type IN ('expense', 'income')
  )
  SELECT
    k.user_id,
    k.group_id,
    k.month,
    COALESCE(p.planned_expense, 0)::numeric(15,2) AS planned_expense,
    COALESCE(p.planned_income, 0)::numeric(15,2)  AS planned_income,
    COALESCE(a.income, 0)::numeric(15,2)  AS actual_income,
    COALESCE(a.expense, 0)::numeric(15,2) AS actual_expense,
    -- positivo = gastou mais do que tinha previsto
    (COALESCE(a.expense, 0) - COALESCE(p.planned_expense, 0))::numeric(15,2) AS expense_variance,
    COALESCE(p.pending_count, 0) AS pending_count,
    COALESCE(p.overdue_count, 0) AS overdue_count,
    k.currency
  FROM chaves k
  LEFT JOIN LATERAL (
    SELECT
      SUM(s.amount) FILTER (WHERE COALESCE(r.transaction_type, 'expense') = 'expense') AS planned_expense,
      SUM(s.amount) FILTER (WHERE COALESCE(r.transaction_type, 'expense') = 'income')  AS planned_income,
      COUNT(*) FILTER (WHERE s.status = 'pending') AS pending_count,
      COUNT(*) FILTER (WHERE s.status = 'pending' AND s.due_date < CURRENT_DATE) AS overdue_count
    FROM public.scheduled_transactions s
    LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id
    WHERE s.user_id = k.user_id
      AND s.group_id IS NOT DISTINCT FROM k.group_id
      AND date_trunc('month', s.due_date)::date = k.month
      AND s.currency IS NOT DISTINCT FROM k.currency
      -- cancelada nunca foi previsao de verdade
      AND s.status <> 'cancelled'
  ) AS p ON TRUE
  LEFT JOIN LATERAL (
    SELECT f.income, f.expense
    FROM public.monthly_cash_flow f
    WHERE f.user_id = k.user_id
      AND f.group_id IS NOT DISTINCT FROM k.group_id
      AND f.month = k.month
      AND f.currency IS NOT DISTINCT FROM k.currency
  ) AS a ON TRUE;

COMMENT ON VIEW public.planned_vs_actual IS
  'Previsto x realizado por mes e MOEDA. O LATERAL casa a moeda tambem: sem isso um mes com duas moedas duplicaria a linha e repetiria o previsto inteiro em cada uma.';

-- ---------------------------------------------------------------------------
-- 6. security_invoker, de novo, nas tres
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` preserva as reloptions da view, entao em teoria o
-- `security_invoker` do 008 continua valendo. Esta secao existe porque "em
-- teoria" e o que separa esta migration de um vazamento de dado entre usuarios:
-- sem `security_invoker`, a view roda com os direitos do DONO, a RLS de
-- `financial_transactions` nao se aplica, e `monthly_cash_flow` devolve a renda
-- e o gasto mensal de TODOS os usuarios do app para qualquer um logado. Repetir
-- o ALTER e barato; descobrir que a preservacao nao valia, nao.

ALTER VIEW public.category_monthly_totals SET (security_invoker = true);
ALTER VIEW public.monthly_cash_flow SET (security_invoker = true);
ALTER VIEW public.planned_vs_actual SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 7. GRANTs
-- ---------------------------------------------------------------------------
-- Mesma razao da secao 6: o 008 ja concedeu, e `CREATE OR REPLACE` preserva.
-- Idempotente e barato.

REVOKE ALL ON public.category_monthly_totals FROM anon;
REVOKE ALL ON public.monthly_cash_flow FROM anon;
REVOKE ALL ON public.planned_vs_actual FROM anon;

GRANT SELECT ON public.category_monthly_totals TO authenticated;
GRANT SELECT ON public.monthly_cash_flow TO authenticated;
GRANT SELECT ON public.planned_vs_actual TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Indice para a leitura por moeda
-- ---------------------------------------------------------------------------
-- As views agrupam por (user_id, transaction_date, currency). O indice existente
-- e por (user_id, transaction_date); a moeda no fim evita reler a linha para
-- descobrir a moeda no agrupamento.
--
-- Indice CHEIO, sem predicado: um indice parcial nao serve de arbitro de
-- ON CONFLICT (o `onConflict` do supabase-js nao manda o predicado), e embora
-- ninguem faca upsert nesta tabela hoje, um indice parcial aqui seria uma
-- armadilha guardada para quem fizer.

CREATE INDEX IF NOT EXISTS idx_financial_transactions_user_date_currency
  ON public.financial_transactions (user_id, transaction_date, currency);

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('022', '022_currency',
        'Moeda por conta e por lancamento, e moeda no grao das views de relatorio - HMO-171', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
