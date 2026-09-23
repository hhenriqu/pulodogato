-- =====================================================
-- PULODOGATO - ORCAMENTO POR CATEGORIA E FATURA DE CARTAO
-- =====================================================
-- Migration: 006_budgets_and_card_invoices
-- Gerado em: 2026-09-22  (HMO-137, Fase 2 da evolucao do produto)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.budgets                 teto de gasto por categoria e por mes
--   public.budget_consumption      quanto ja foi gasto de cada teto (view)
--   financial_accounts.closing_day dia do fechamento da fatura
--   financial_accounts.due_day     dia do vencimento da fatura
--   public.card_invoice_month()    em que fatura cai uma compra
--   public.card_invoice_lines      cada compra no cartao com a fatura dela (view)
--
-- ORCAMENTO: POR QUE UMA LINHA POR MES
-- ------------------------------------
-- A alternativa seria uma linha por categoria com validade aberta ("R$ 800 de
-- mercado, a partir de marco"). Fica mais enxuto e e pior: o teto de dezembro
-- nao pode ser diferente sem fechar o periodo e abrir outro, e qualquer
-- correcao no valor reescreve o julgamento de todos os meses passados -- "voce
-- estourou o mercado em agosto" mudaria de resposta hoje.
--
-- Uma linha por (categoria, mes) e o mesmo desenho que o 005 usou para regra x
-- ocorrencia, e pela mesma razao: o passado nao pode se mexer. O custo e ter
-- que criar as linhas do mes seguinte; `carry_forward` marca quais o app
-- recria, em lib/services/budget.ts, e o indice unico abaixo torna isso
-- idempotente igual a agenda da Fase 1.
--
-- CONSUMO NAO E COLUNA
-- --------------------
-- `spent` sai da soma de financial_transactions na hora da leitura. Guardar o
-- consumido exigiria trigger em financial_transactions -- exatamente a familia
-- de trigger que as migrations 003 e 004 existiram para consertar, e desta vez
-- sobre a tabela de dinheiro. Editar uma transacao de mes passado tambem teria
-- que reabrir o orcamento daquele mes. A soma na leitura nao tem esse problema.
--
-- FATURA DE CARTAO: O QUE ESTE ARQUIVO **NAO** FAZ
-- ------------------------------------------------
-- Nao mexe em current_balance nem no trigger update_account_balance. O saldo de
-- cartao continua sendo calculado exatamente como hoje. A fatura aqui e uma
-- LEITURA (em que fatura a compra do dia 28 caiu) mais duas colunas de
-- configuracao. Fechar a fatura como conta a pagar reusa scheduled_transactions
-- da Fase 1 e acontece no app, nao no banco.
--
-- Essa foi uma decisao de risco deliberada: o plano da HMO-137 marcou a fatura
-- como a mudanca mais perigosa da Fase 2 justamente por encostar no saldo
-- mantido por trigger. Ela nao encosta.
--
-- COMO RODAR
-- ----------
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/006_budgets_and_card_invoices.sql
--
-- Aplicar depois de 001 -> 002 -> 003 -> 004 -> 005. O preflight abaixo aborta
-- a transacao inteira se faltar qualquer pre-requisito, listando tudo de uma
-- vez -- o Postgres reporta um erro por vez e cada ida e volta com producao
-- custa um dia.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: O ARQUIVO CABE NESTE BANCO?
-- =====================================================
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(DISTINCT msg, E'\n' ORDER BY msg) INTO v_faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.' || quote_ident(r.tabela)) IS NULL
               THEN format('  - tabela public.%s nao existe', r.tabela)
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || quote_ident(r.tabela))
                      AND a.attname = r.coluna
                      AND a.attnum > 0
                      AND NOT a.attisdropped)
               THEN format('  - coluna public.%s.%s nao existe', r.tabela, r.coluna)
           END AS msg
    FROM (VALUES
      ('financial_accounts', 'account_type'),
      ('transaction_categories', 'id'),
      ('financial_transactions', 'transaction_date'),
      ('financial_transactions', 'transaction_type'),
      ('financial_transactions', 'group_id'),
      ('expense_groups', 'id'),
      ('schema_migrations', 'version'),
      -- a Fase 2 fecha a fatura como conta prevista: sem o 005 isso nao existe
      ('scheduled_transactions', 'due_date')
    ) AS r(tabela, coluna)

    UNION ALL
    SELECT format('  - tipo public.%s nao existe', t.nome)
    FROM (VALUES ('transaction_financial_type'), ('account_type')) AS t(nome)
    WHERE to_regtype('public.' || t.nome) IS NULL

    UNION ALL
    SELECT format('  - funcao public.%s nao existe', f.nome)
    FROM (VALUES
      ('update_updated_at_column()'),
      ('is_group_member(uuid)')
    ) AS f(nome)
    WHERE to_regprocedure('public.' || f.nome) IS NULL

    UNION ALL
    SELECT format('  - role %s nao existe', r.rolname)
    FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname = r.rolname)

    UNION ALL
    -- 'credit_card' tem que ser um valor do enum account_type, senao a view de
    -- faturas filtra por um rotulo que nunca casa e sai sempre vazia -- sem
    -- erro nenhum, que e o pior jeito de descobrir.
    SELECT '  - o enum public.account_type nao tem o valor ''credit_card'''
    WHERE to_regtype('public.account_type') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_enum e
        WHERE e.enumtypid = 'public.account_type'::regtype
          AND e.enumlabel = 'credit_card')
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'006 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> 002 -> 003 -> 004 -> 005 antes.', v_faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: budgets  (teto por categoria e mes)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.budgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    category_id uuid NOT NULL,
    -- teto da casa/viagem: o consumo passa a somar o gasto do grupo inteiro,
    -- nao so o de quem cadastrou. NULL = orcamento pessoal.
    group_id uuid,
    -- sempre o dia 1: o mes e a unidade do orcamento, e gravar dia 1 deixa o
    -- indice unico e o BETWEEN da view sem caso especial.
    month date NOT NULL,
    amount_limit numeric(15,2) NOT NULL,
    -- fracao do teto que ja acende o alerta amarelo. 0.8 = avisa aos 80%.
    alert_threshold numeric(4,3) NOT NULL DEFAULT 0.800,
    -- o app recria esta linha no mes seguinte. Ficar false e o jeito de dizer
    -- "isto era so de dezembro".
    carry_forward boolean NOT NULL DEFAULT true,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT budgets_pkey PRIMARY KEY (id),
    CONSTRAINT budgets_amount_check CHECK (amount_limit > (0)::numeric),
    CONSTRAINT budgets_threshold_check CHECK (alert_threshold > (0)::numeric AND alert_threshold <= (1)::numeric),
    -- a unica forma de month nao ser dia 1 e alguem escrever direto no SQL
    -- Editor; a partir dai o indice unico deixa de impedir o teto duplicado.
    CONSTRAINT budgets_month_is_first_day CHECK (month = date_trunc('month', month)::date),
    CONSTRAINT budgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT budgets_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.transaction_categories(id),
    CONSTRAINT budgets_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.expense_groups(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.budgets IS
  'Teto de gasto por categoria e mes. Uma linha por (usuario, categoria, grupo, mes).';
COMMENT ON COLUMN public.budgets.month IS
  'Primeiro dia do mes orcado. O CHECK garante isso.';
COMMENT ON COLUMN public.budgets.carry_forward IS
  'Se true, lib/services/budget.ts recria a linha no mes seguinte.';

-- Um teto por categoria por mes -- e aqui o 006 faz o CONTRARIO do 005 de
-- proposito, entao vale dizer por que.
--
-- O 005 evitou indice parcial porque o ON CONFLICT que o PostgREST monta nao
-- consegue inferir um indice com predicado (42P10). Um indice comum sobre
-- (user_id, category_id, group_id, month) resolveria isso aqui tambem -- e
-- estaria errado: em Postgres dois NULL nunca colidem num indice unico, entao
-- ele deixaria passar DOIS orcamentos pessoais da mesma categoria no mesmo
-- mes, que e justamente o que ele deveria impedir.
--
-- Entao os dois indices sao parciais, a constraint fica correta, e quem paga a
-- conta e o app: repetirOrcamentos() em lib/services/budget.ts le o mes
-- destino e insere so o que falta, em vez de usar upsert. Corrida continua
-- coberta -- o indice devolve 23505 e a rota trata como "ja estava la".
CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_pessoal_unico
  ON public.budgets (user_id, category_id, month)
  WHERE group_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_grupo_unico
  ON public.budgets (group_id, category_id, month)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_budgets_user_month ON public.budgets (user_id, month DESC);

DROP TRIGGER IF EXISTS update_budgets_updated_at ON public.budgets;
CREATE TRIGGER update_budgets_updated_at
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- SECAO 2: fatura de cartao - configuracao
-- =====================================================
-- ADD COLUMN IF NOT EXISTS para o arquivo continuar re-executavel.
ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS closing_day integer,
  ADD COLUMN IF NOT EXISTS due_day integer;

COMMENT ON COLUMN public.financial_accounts.closing_day IS
  'Dia do fechamento da fatura (cartao). Compra depois dele cai na fatura seguinte.';
COMMENT ON COLUMN public.financial_accounts.due_day IS
  'Dia do vencimento da fatura (cartao). Pode ser menor que closing_day: vence no mes seguinte.';

-- Os CHECK nao entram com IF NOT EXISTS (nao existe); o DO deixa re-executavel.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.financial_accounts'::regclass
                    AND conname = 'financial_accounts_closing_day_check') THEN
    ALTER TABLE public.financial_accounts
      ADD CONSTRAINT financial_accounts_closing_day_check
      CHECK (closing_day IS NULL OR (closing_day >= 1 AND closing_day <= 31));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.financial_accounts'::regclass
                    AND conname = 'financial_accounts_due_day_check') THEN
    ALTER TABLE public.financial_accounts
      ADD CONSTRAINT financial_accounts_due_day_check
      CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 31));
  END IF;
END $$;

-- =====================================================
-- SECAO 3: em que fatura cai uma compra
-- =====================================================
-- A regra do mercado (Nubank, Itau, Mobills): compra ATE o dia do fechamento
-- entra na fatura do proprio mes; depois dele, na do mes seguinte.
--
-- Fechamento dia 31 em fevereiro: o dia 31 nao existe, entao "ate o
-- fechamento" precisa virar "ate o ultimo dia do mes" -- sem o LEAST abaixo,
-- nenhuma compra de fevereiro fecharia e todas escorregariam para marco.
--
-- IMMUTABLE porque depende so dos argumentos: e o que permite indexar a
-- expressao depois, se a view ficar pesada.
CREATE OR REPLACE FUNCTION public.card_invoice_month(
  p_transaction_date date,
  p_closing_day integer
) RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    -- cartao sem fechamento configurado: a compra e da fatura do proprio mes.
    WHEN p_closing_day IS NULL THEN date_trunc('month', p_transaction_date)::date
    WHEN EXTRACT(DAY FROM p_transaction_date) <= LEAST(
           p_closing_day,
           EXTRACT(DAY FROM (date_trunc('month', p_transaction_date)
                             + INTERVAL '1 month - 1 day'))::integer)
      THEN date_trunc('month', p_transaction_date)::date
    ELSE (date_trunc('month', p_transaction_date) + INTERVAL '1 month')::date
  END;
$$;

COMMENT ON FUNCTION public.card_invoice_month(date, integer) IS
  'Primeiro dia do mes da fatura em que a compra cai. Fonte unica desta regra.';

-- Vencimento da fatura: due_day do mes da fatura, ou do mes seguinte quando o
-- vencimento vem antes do fechamento (fecha dia 28, vence dia 5). Clampa o dia
-- ao ultimo do mes pelo mesmo motivo do LEAST acima.
CREATE OR REPLACE FUNCTION public.card_invoice_due_date(
  p_invoice_month date,
  p_closing_day integer,
  p_due_day integer
) RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE WHEN p_due_day IS NULL THEN NULL ELSE
    (base + (LEAST(
       p_due_day,
       EXTRACT(DAY FROM (base + INTERVAL '1 month - 1 day'))::integer
     ) - 1) * INTERVAL '1 day')::date
  END
  FROM (
    SELECT CASE
             WHEN p_closing_day IS NOT NULL AND p_due_day <= p_closing_day
               THEN (date_trunc('month', p_invoice_month) + INTERVAL '1 month')
             ELSE date_trunc('month', p_invoice_month)
           END AS base
  ) AS b;
$$;

COMMENT ON FUNCTION public.card_invoice_due_date(date, integer, integer) IS
  'Data de vencimento da fatura daquele mes. NULL quando o cartao nao tem due_day.';

-- =====================================================
-- SECAO 4: card_invoice_lines  (cada compra com a fatura dela)
-- =====================================================
-- Nao e tabela: a fatura e uma pergunta sobre lancamentos que ja existem. Uma
-- tabela precisaria ser mantida em sincronia a cada edicao de transacao -- de
-- novo, trigger sobre a tabela de dinheiro.
CREATE OR REPLACE VIEW public.card_invoice_lines AS
  SELECT
    t.id                AS transaction_id,
    t.user_id,
    t.account_id,
    a.name              AS account_name,
    a.closing_day,
    a.due_day,
    t.category_id,
    t.description,
    t.amount,
    -- O total da fatura e SUM(invoice_amount), nao SUM(amount).
    -- Despesa e gravada negativa e estorno/pagamento positivo (ver a nota de
    -- sinal na SECAO 5), entao inverter o sinal aqui faz a compra somar e o
    -- estorno abater, que e exatamente o que a fatura deve mostrar. Somar
    -- amount cru daria a fatura com o sinal trocado; somar ABS faria o estorno
    -- AUMENTAR o que se deve.
    (-t.amount) AS invoice_amount,
    t.transaction_date,
    t.transaction_type,
    t.group_id,
    public.card_invoice_month(t.transaction_date, a.closing_day) AS invoice_month,
    public.card_invoice_due_date(
      public.card_invoice_month(t.transaction_date, a.closing_day),
      a.closing_day, a.due_day)                                  AS invoice_due_date
  FROM public.financial_transactions t
  JOIN public.financial_accounts a ON a.id = t.account_id
  WHERE a.account_type = 'credit_card'
    -- estorno e pagamento da fatura nao sao compra; entram como income na
    -- conta do cartao e abatem o total.
    AND t.transaction_type IN ('expense', 'income');

COMMENT ON VIEW public.card_invoice_lines IS
  'Lancamentos de cartao com o mes e o vencimento da fatura em que caem.';

-- =====================================================
-- SECAO 5: budget_consumption  (quanto ja foi gasto de cada teto)
-- =====================================================
-- `spent` soma as despesas da categoria no mes. Tres decisoes:
--
-- 1) orcamento de grupo soma o gasto de TODOS os membros (t.group_id = b.group_id);
--    orcamento pessoal soma so o do dono E ignora o que ja esta rateado num
--    grupo -- senao a despesa da viagem consumiria os dois tetos.
-- 2) so 'expense'. Um estorno lancado como income da categoria nao devolve
--    espaco no teto; para isso o caminho e corrigir a despesa.
-- 3) **ABS(t.amount)**, e esta e a linha que mais importa. Neste banco despesa
--    e gravada NEGATIVA: lib/services/scheduled.ts:valorComSinal faz
--    `-Math.abs(amount)`, e o trigger update_account_balance soma NEW.amount
--    direto no saldo. Um SUM(t.amount) cru devolveria -800 para quem gastou
--    800: o consumo ficaria negativo, consumed_ratio negativo, e o status
--    seria 'ok' para sempre -- o alerta de estouro simplesmente nunca
--    dispararia, sem erro nenhum aparecer. O resto do app ja le assim
--    (Math.abs em balances, transfers e split-suggestions).
CREATE OR REPLACE VIEW public.budget_consumption AS
  SELECT
    b.id,
    b.user_id,
    b.category_id,
    b.group_id,
    b.month,
    b.amount_limit,
    b.alert_threshold,
    b.carry_forward,
    b.notes,
    b.created_at,
    b.updated_at,
    COALESCE(g.spent, 0)::numeric(15,2) AS spent,
    (b.amount_limit - COALESCE(g.spent, 0))::numeric(15,2) AS remaining,
    -- percentual com 4 casas; a tela arredonda. Divisao sem risco de zero: o
    -- CHECK garante amount_limit > 0.
    ROUND(COALESCE(g.spent, 0) / b.amount_limit, 4) AS consumed_ratio,
    CASE
      WHEN COALESCE(g.spent, 0) >= b.amount_limit THEN 'exceeded'
      WHEN COALESCE(g.spent, 0) >= b.amount_limit * b.alert_threshold THEN 'alert'
      ELSE 'ok'
    END AS consumption_status
  FROM public.budgets b
  LEFT JOIN LATERAL (
    SELECT SUM(ABS(t.amount)) AS spent
    FROM public.financial_transactions t
    WHERE t.category_id = b.category_id
      AND t.transaction_type = 'expense'
      AND t.transaction_date >= b.month
      AND t.transaction_date < (b.month + INTERVAL '1 month')::date
      AND CASE
            WHEN b.group_id IS NOT NULL THEN t.group_id = b.group_id
            ELSE t.user_id = b.user_id AND t.group_id IS NULL
          END
  ) AS g ON TRUE;

COMMENT ON VIEW public.budget_consumption IS
  'budgets com o consumido, o que resta e o status (ok/alert/exceeded) calculados na leitura.';

-- =====================================================
-- SECAO 6: RLS
-- =====================================================
-- Mesmo desenho do 002 e do 005: nega por padrao, libera o dono e - nas linhas
-- de grupo - os membros. Sem policy para anon: a chave anon vai no bundle
-- publico.
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budgets_select ON public.budgets;
CREATE POLICY budgets_select ON public.budgets
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (group_id IS NOT NULL AND public.is_group_member(group_id))
  );

DROP POLICY IF EXISTS budgets_insert ON public.budgets;
CREATE POLICY budgets_insert ON public.budgets
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS budgets_update ON public.budgets;
CREATE POLICY budgets_update ON public.budgets
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS budgets_delete ON public.budgets;
CREATE POLICY budgets_delete ON public.budgets
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =====================================================
-- SECAO 7: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes destes objetos existirem, e ALL
-- TABLES nao alcanca o futuro.
REVOKE ALL ON public.budgets FROM anon;
REVOKE ALL ON public.budget_consumption FROM anon;
REVOKE ALL ON public.card_invoice_lines FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO authenticated;
GRANT SELECT ON public.budget_consumption TO authenticated;
GRANT SELECT ON public.card_invoice_lines TO authenticated;

-- Sem security_invoker a view roda com o privilegio do dono e a RLS da tabela
-- base nao vale: budget_consumption devolveria o orcamento de todo mundo, e
-- card_invoice_lines a fatura de todo mundo, para qualquer usuario logado.
-- Mesma pegadinha da SECAO 7 do 005.
ALTER VIEW public.budget_consumption SET (security_invoker = true);
ALTER VIEW public.card_invoice_lines SET (security_invoker = true);

-- As funcoes sao IMMUTABLE e so fazem aritmetica de data; nao leem tabela e
-- por isso nao precisam de SECURITY DEFINER (o oposto do caso das 003/004).
--
-- Fechar a execucao para anon exige DOIS revokes, e cada um sozinho e um
-- falso negativo:
--
--   PUBLIC  - o Postgres concede EXECUTE a PUBLIC em toda funcao nova, e anon
--             faz parte de PUBLIC. Este e o vazamento num banco cru.
--   anon    - o Supabase concede EXECUTE a anon/authenticated/service_role
--             EXPLICITAMENTE, via ALTER DEFAULT PRIVILEGES na criacao da
--             funcao. Revogar de PUBLIC nao encosta num grant explicito: o
--             proacl continua com `anon=X/postgres`. Este e o vazamento em
--             producao, e foi o erro que as 003/004 cometeram -- la ficou
--             inofensivo so porque aquelas funcoes retornam `trigger`, que o
--             PostgREST nao expoe como RPC.
--
-- Estas duas retornam `date`: sem as quatro linhas abaixo,
-- /rest/v1/rpc/card_invoice_month fica chamavel com a chave que vai no bundle
-- JS publico. O teste database/tests/budget_invoice_test.sql cobre os dois
-- caminhos -- foi ele que pegou a falta do revoke de PUBLIC.
REVOKE EXECUTE ON FUNCTION public.card_invoice_month(date, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.card_invoice_due_date(date, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.card_invoice_month(date, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.card_invoice_due_date(date, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.card_invoice_month(date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.card_invoice_due_date(date, integer, integer) TO authenticated;

-- =====================================================
-- SECAO 8: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('006', '006_budgets_and_card_invoices',
        'Orcamento por categoria (budgets) e fatura de cartao (colunas + views) - HMO-137 Fase 2', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
