-- =====================================================
-- PULODOGATO -- VALIDACAO PASSO 6: metas e relatorios (008)
-- =====================================================
-- GERADO por scripts/gen-validation-bundle.mjs. Nao edite este arquivo:
-- a fonte e database/migrations/*.sql e database/tests/rls_isolation_test.sql.
--
-- Rode DEPOIS do 01_migrations.sql, no mesmo projeto descartavel.
--
-- Confere o que o 008 sozinho nao prova. A assercao central e de novo o SINAL:
-- despesa e gravada NEGATIVA neste banco, e um SUM cru nas views de relatorio
-- devolveria gasto negativo -- a tela desenharia a barra para baixo e diria
-- "voce economizou" onde houve gasto. Mesma familia do erro que quase passou no
-- 006.
--
-- Confere tambem que o progresso da meta sai dos APORTES e nao do saldo da conta
-- (o saldo derivou ate o 007 entrar), que a meta sem prazo nao inventa um ritmo
-- mensal, que transferencia entre contas proprias nao vira receita nem despesa no
-- fluxo de caixa mas CONTA no patrimonio, que o previsto x realizado casa o mes
-- pessoal (onde group_id e NULL dos dois lados, e NULL = NULL nao casa), que o
-- patrimonio reconstruido de tras para frente fecha com o saldo de hoje, e que um
-- usuario nao enxerga a renda, o gasto nem o patrimonio de outro. Tudo dentro de
-- BEGIN/ROLLBACK.
--
-- O QUE ESPERAR: uma unica linha "METAS E RELATORIOS: TUDO OK".
-- =====================================================

-- =====================================================
-- Teste das metas e dos relatorios (008)
-- =====================================================
-- Responde o que o 008 sozinho nao prova:
--   1. o progresso da meta soma os aportes CERTOS -- e so eles;
--   2. um usuario enxerga a meta de outro? o fluxo de caixa de outro? o
--      PATRIMONIO de outro? (as cinco views sao security_invoker);
--   3. o SINAL: despesa e gravada negativa, e um SUM cru devolveria gasto
--      negativo -- o mesmo erro que quase passou na Fase 2;
--   4. 'transfer' nao e nem entrada nem saida no fluxo de caixa, mas E
--      movimento de patrimonio;
--   5. previsto x realizado casa o mes pessoal, onde group_id e NULL dos dois
--      lados -- `NULL = NULL` nao casa e a tela mostraria previsto sem
--      realizado;
--   6. o patrimonio reconstruido de tras para frente fecha com o saldo de hoje;
--   7. a meta de grupo e compartilhada, mas so quem criou pode editar.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 007 -> 008:
--   psql "$DB_URL" -f database/tests/goals_reports_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect(label TEXT, got BIGINT, want BIGINT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_num(label TEXT, got NUMERIC, want NUMERIC)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_text(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
-- Dois usuarios, um grupo em que os dois estao, e um mes de movimento cujo
-- resultado da para conferir de cabeca.
--
-- Os UUIDs de servico e categoria sao os do seed de referencia que o
-- 001_baseline.sql carrega, escritos por extenso pelo mesmo motivo dos testes
-- do 005 e do 006: o bundle do SQL Editor so traduz o \set ON_ERROR_STOP.
--   servico    8730cd96-d656-4c48-863e-673e1016a832  (personal_finance)
--   Alimentacao b9db286c-ce4f-4fbe-b0bf-f3133185f90f  (despesa)
--   Transporte  49d97f81-6f07-4e6d-9822-75167b8426b2  (despesa)
--   Salario     d93a6d01-3b70-4c54-af08-e8b56b09fb9e  (receita)

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'a@goals.local'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1', 'b@goals.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'Usuario A', FALSE),
  ('bbbbbbbb-0000-0000-0000-0000000000b1', 'Usuario B', FALSE);

-- Conta corrente e poupanca do A. O saldo comeca em zero e so os triggers o
-- movem, para que a SECAO 6 possa conferir a reconstrucao do patrimonio contra
-- um numero que o banco calculou sozinho.
INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('a0000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'Corrente A', 'checking', 0),
  ('a0000000-0000-0000-0000-0000000000f2', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'Poupanca A', 'savings', 0),
  ('b0000000-0000-0000-0000-0000000000f3', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'Corrente B', 'checking', 0);

INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('a0000000-0000-0000-0000-0000000000f4', 'Viagem', 'aaaaaaaa-0000-0000-0000-0000000000a1');

INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('a0000000-0000-0000-0000-0000000000f4', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'member', 'active');

-- ---------------------------------------------------------------
-- Movimento do mes corrente, na conta corrente do A:
--   receita  5.000  (salario, gravada POSITIVA)
--   despesa    800  (alimentacao, gravada NEGATIVA)
--   despesa    200  (transporte, gravada NEGATIVA)
--   transfer 1.000  (corrente -> poupanca: sai -1.000 e entra +1.000)
--
-- Fluxo de caixa esperado: entrada 5.000, saida 1.000, resultado 4.000.
-- A transferencia NAO pode aparecer em nenhuma das duas colunas.
-- Patrimonio: 5.000 - 800 - 200 - 1.000 + 1.000 = 4.000.
-- ---------------------------------------------------------------
INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1', '8730cd96-d656-4c48-863e-673e1016a832',
   'd93a6d01-3b70-4c54-af08-e8b56b09fb9e', 'a0000000-0000-0000-0000-0000000000f1',
   'Salario', 5000.00, date_trunc('month', CURRENT_DATE)::date, 'income'),
  ('aaaaaaaa-0000-0000-0000-0000000000a1', '8730cd96-d656-4c48-863e-673e1016a832',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0000000-0000-0000-0000-0000000000f1',
   'Mercado', -800.00, date_trunc('month', CURRENT_DATE)::date, 'expense'),
  ('aaaaaaaa-0000-0000-0000-0000000000a1', '8730cd96-d656-4c48-863e-673e1016a832',
   '49d97f81-6f07-4e6d-9822-75167b8426b2', 'a0000000-0000-0000-0000-0000000000f1',
   'Onibus', -200.00, date_trunc('month', CURRENT_DATE)::date, 'expense'),
  -- as duas pernas da transferencia
  ('aaaaaaaa-0000-0000-0000-0000000000a1', '8730cd96-d656-4c48-863e-673e1016a832',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0000000-0000-0000-0000-0000000000f1',
   'Para a poupanca', -1000.00, date_trunc('month', CURRENT_DATE)::date, 'transfer'),
  ('aaaaaaaa-0000-0000-0000-0000000000a1', '8730cd96-d656-4c48-863e-673e1016a832',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0000000-0000-0000-0000-0000000000f2',
   'Da corrente', 1000.00, date_trunc('month', CURRENT_DATE)::date, 'transfer');

-- Mes ANTERIOR, so uma despesa de 500, para a SECAO 6 ter dois pontos na curva.
INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1', '8730cd96-d656-4c48-863e-673e1016a832',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0000000-0000-0000-0000-0000000000f1',
   'Mercado do mes passado', -500.00,
   (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date, 'expense');

-- Despesa do B, para provar que nada cruza usuario.
INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type) VALUES
  ('bbbbbbbb-0000-0000-0000-0000000000b1', '8730cd96-d656-4c48-863e-673e1016a832',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'b0000000-0000-0000-0000-0000000000f3',
   'Mercado do B', -77.00, date_trunc('month', CURRENT_DATE)::date, 'expense');

-- =====================================================
-- SECAO 1: o progresso da meta
-- =====================================================
-- Meta de 15.000 com prazo daqui a 10 meses; o A aporta 2.000 + 500.
INSERT INTO public.financial_goals (id, user_id, title, target_amount, target_date, account_id) VALUES
  ('a0000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-0000000000a1',
   'Reserva de emergencia', 15000.00,
   (date_trunc('month', CURRENT_DATE) + INTERVAL '10 months')::date,
   'a0000000-0000-0000-0000-0000000000f2');

-- Meta do B, na mesma conta-alvo? Nao: conta e do A. Mas serve para provar
-- isolamento de leitura.
INSERT INTO public.financial_goals (id, user_id, title, target_amount) VALUES
  ('b0000000-0000-0000-0000-000000000102', 'bbbbbbbb-0000-0000-0000-0000000000b1',
   'Meta secreta do B', 9999.00);

INSERT INTO public.goal_contributions (goal_id, user_id, amount, contributed_at) VALUES
  ('a0000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-0000000000a1', 2000.00, CURRENT_DATE),
  ('a0000000-0000-0000-0000-000000000101', 'aaaaaaaa-0000-0000-0000-0000000000a1',  500.00, CURRENT_DATE);

-- Aporte na meta do B: nao pode contaminar a do A.
INSERT INTO public.goal_contributions (goal_id, user_id, amount) VALUES
  ('b0000000-0000-0000-0000-000000000102', 'bbbbbbbb-0000-0000-0000-0000000000b1', 4444.00);

DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.goal_progress WHERE id = 'a0000000-0000-0000-0000-000000000101';

  PERFORM pg_temp.expect_num('meta: juntado', r.saved, 2500.00);
  PERFORM pg_temp.expect_num('meta: falta', r.remaining, 12500.00);
  PERFORM pg_temp.expect_num('meta: fracao', r.progress_ratio, ROUND(2500.00 / 15000.00, 4));
  PERFORM pg_temp.expect('meta: numero de aportes', r.contribution_count, 2);
  PERFORM pg_temp.expect('meta: meses ate o prazo', r.months_left::BIGINT, 10);
  -- 12.500 / 10 = 1.250 por mes
  PERFORM pg_temp.expect_num('meta: ritmo mensal necessario', r.monthly_required, 1250.00);
  PERFORM pg_temp.expect_text('meta: estado', r.progress_status, 'on_track');
END $$;

-- O aporte NAO pode mexer no saldo da conta: a meta so anota onde o dinheiro
-- esta. Se algum dia alguem ligar goal_contributions a um trigger de saldo,
-- esta assercao acusa -- seria dinheiro aparecendo do nada na conta.
DO $$
BEGIN
  PERFORM pg_temp.expect_num(
    'aporte nao mexe no saldo da poupanca',
    (SELECT current_balance FROM public.financial_accounts
      WHERE id = 'a0000000-0000-0000-0000-0000000000f2'),
    1000.00);  -- so a perna da transferencia
END $$;

-- Meta sem prazo: months_left e monthly_required tem que ser NULL, e nao zero.
-- Zero faria a tela escrever "voce precisa juntar R$ 0,00 por mes", que e falso
-- e nao alarma ninguem.
DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.goal_progress WHERE id = 'b0000000-0000-0000-0000-000000000102';
  IF r.months_left IS NOT NULL OR r.monthly_required IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: meta sem prazo devolveu ritmo mensal (% / %)',
      r.months_left, r.monthly_required;
  END IF;
  RAISE NOTICE 'ok: meta sem prazo nao inventa ritmo mensal';
END $$;

-- Meta alcancada: 'reached' sozinho, sem ninguem marcar na mao, e `remaining`
-- nunca negativo.
INSERT INTO public.financial_goals (id, user_id, title, target_amount) VALUES
  ('a0000000-0000-0000-0000-000000000103', 'aaaaaaaa-0000-0000-0000-0000000000a1',
   'Ja alcancada', 100.00);
INSERT INTO public.goal_contributions (goal_id, user_id, amount) VALUES
  ('a0000000-0000-0000-0000-000000000103', 'aaaaaaaa-0000-0000-0000-0000000000a1', 130.00);

DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.goal_progress WHERE id = 'a0000000-0000-0000-0000-000000000103';
  PERFORM pg_temp.expect_text('meta estourada: estado', r.progress_status, 'reached');
  PERFORM pg_temp.expect_num('meta estourada: falta nunca e negativo', r.remaining, 0.00);
END $$;

-- Meta vencida sem ter chegado la: 'overdue'.
INSERT INTO public.financial_goals (id, user_id, title, target_amount, target_date) VALUES
  ('a0000000-0000-0000-0000-000000000104', 'aaaaaaaa-0000-0000-0000-0000000000a1',
   'Passou do prazo', 1000.00, (CURRENT_DATE - INTERVAL '40 days')::date);

DO $$
BEGIN
  PERFORM pg_temp.expect_text('meta vencida: estado',
    (SELECT progress_status FROM public.goal_progress
      WHERE id = 'a0000000-0000-0000-0000-000000000104'), 'overdue');
END $$;

-- Prazo NESTE mes com meta nao alcancada: months_left = 0. A divisao por
-- GREATEST(months_left, 1) existe so para este caso -- sem ela a view estoura
-- com divisao por zero e a tela de metas inteira volta 500, justamente no mes
-- do vencimento.
INSERT INTO public.financial_goals (id, user_id, title, target_amount, target_date) VALUES
  ('a0000000-0000-0000-0000-000000000105', 'aaaaaaaa-0000-0000-0000-0000000000a1',
   'Vence este mes', 600.00, (date_trunc('month', CURRENT_DATE) + INTERVAL '3 days')::date);

DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.goal_progress WHERE id = 'a0000000-0000-0000-0000-000000000105';
  PERFORM pg_temp.expect('prazo neste mes: meses restantes', r.months_left::BIGINT, 0);
  PERFORM pg_temp.expect_num('prazo neste mes: nao divide por zero', r.monthly_required, 600.00);
END $$;

-- =====================================================
-- SECAO 2: o SINAL do gasto por categoria
-- =====================================================
-- A assercao que mais importa do arquivo, e a mesma que quase passou na Fase 2:
-- despesa e gravada NEGATIVA. Um SUM(amount) cru devolveria -800, e a tela
-- desenharia uma barra para baixo, um total de gastos negativo e um "voce
-- economizou" onde houve gasto.
DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.category_monthly_totals
   WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
     AND group_id IS NULL
     AND month = date_trunc('month', CURRENT_DATE)::date
     AND category_id = 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f';

  -- 800 POSITIVO. A transferencia de 1.000 esta na MESMA categoria de
  -- proposito: se a view olhasse o sinal em vez do tipo, ela entraria aqui.
  PERFORM pg_temp.expect_num('categoria: gasto em alimentacao e positivo', r.expense, 800.00);
  PERFORM pg_temp.expect_num('categoria: sem receita em alimentacao', r.income, 0.00);
  PERFORM pg_temp.expect('categoria: transfer nao conta como lancamento', r.transaction_count, 1);
END $$;

-- CONTROLE NEGATIVO do sinal: uma view igual, mas com SUM(amount) cru. Se ela
-- devolver o mesmo numero que a de verdade, o ABS() nao esta fazendo nada e o
-- teste acima nao prova coisa alguma.
DO $$
DECLARE v_cru NUMERIC;
BEGIN
  SELECT SUM(t.amount) INTO v_cru
    FROM public.financial_transactions t
   WHERE t.user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
     AND t.transaction_type = 'expense'
     AND t.category_id = 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f'
     AND date_trunc('month', t.transaction_date)::date = date_trunc('month', CURRENT_DATE)::date;

  IF v_cru >= 0 THEN
    RAISE EXCEPTION 'FALHA (controle negativo): a fixture nao grava despesa negativa (SUM cru = %). Sem isso o teste do sinal nao prova nada.', v_cru;
  END IF;
  RAISE NOTICE 'ok: controle negativo do sinal (SUM cru daria %)', v_cru;
END $$;

-- =====================================================
-- SECAO 3: o fluxo de caixa, e a transferencia que nao e nem entrada nem saida
-- =====================================================
DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.monthly_cash_flow
   WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
     AND group_id IS NULL
     AND month = date_trunc('month', CURRENT_DATE)::date;

  PERFORM pg_temp.expect_num('fluxo: entrada', r.income, 5000.00);
  -- 800 + 200. Se transfer entrasse, dariam 1.800 de saida (ou 2.800 contando
  -- as duas pernas) e o mes fecharia com resultado errado.
  PERFORM pg_temp.expect_num('fluxo: saida sem a transferencia', r.expense, 1000.00);
  PERFORM pg_temp.expect_num('fluxo: resultado', r.net, 4000.00);
END $$;

-- E o rollup tem que bater com a soma das categorias, senao as duas telas
-- (fluxo e categorias) mostrariam totais diferentes para o mesmo mes.
DO $$
BEGIN
  PERFORM pg_temp.expect_num(
    'fluxo: rollup bate com a soma das categorias',
    (SELECT SUM(c.expense) FROM public.category_monthly_totals c
      WHERE c.user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
        AND c.group_id IS NULL
        AND c.month = date_trunc('month', CURRENT_DATE)::date),
    (SELECT f.expense FROM public.monthly_cash_flow f
      WHERE f.user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
        AND f.group_id IS NULL
        AND f.month = date_trunc('month', CURRENT_DATE)::date));
END $$;

-- =====================================================
-- SECAO 4: previsto x realizado, e o group_id NULL
-- =====================================================
-- Agenda do mes corrente: aluguel de 2.000 (despesa, por regra) e um freela de
-- 300 previsto como receita.
INSERT INTO public.recurring_rules
  (id, user_id, category_id, description, amount, transaction_type, frequency, due_day) VALUES
  ('a0000000-0000-0000-0000-000000000201', 'aaaaaaaa-0000-0000-0000-0000000000a1',
   'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'Aluguel', 2000.00, 'expense', 'monthly', 10),
  ('a0000000-0000-0000-0000-000000000202', 'aaaaaaaa-0000-0000-0000-0000000000a1',
   'bdb788d6-f1fa-48d0-94ee-b97beca29064', 'Freela', 300.00, 'income', 'monthly', 20);

INSERT INTO public.scheduled_transactions
  (user_id, recurring_rule_id, category_id, description, amount, due_date, status) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000201',
   'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'Aluguel', 2000.00,
   (date_trunc('month', CURRENT_DATE) + INTERVAL '9 days')::date, 'pending'),
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000202',
   'bdb788d6-f1fa-48d0-94ee-b97beca29064', 'Freela', 300.00,
   (date_trunc('month', CURRENT_DATE) + INTERVAL '19 days')::date, 'pending'),
  -- Cancelada: nunca foi previsao de verdade e nao pode entrar no previsto.
  -- Em outro dia do mesmo mes porque o 005 tem indice unico em
  -- (recurring_rule_id, due_date) -- a mesma regra nao vence duas vezes no
  -- mesmo dia, nem para cancelar.
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000201',
   'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'Aluguel cancelado', 7777.00,
   (date_trunc('month', CURRENT_DATE) + INTERVAL '11 days')::date, 'cancelled'),
  -- avulsa, sem regra: o tipo cai no default 'expense', espelhando a rota de baixa
  ('aaaaaaaa-0000-0000-0000-0000000000a1', NULL,
   '49d97f81-6f07-4e6d-9822-75167b8426b2', 'IPVA avulso', 450.00,
   (date_trunc('month', CURRENT_DATE) + INTERVAL '15 days')::date, 'pending');

DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.planned_vs_actual
   WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
     AND group_id IS NULL
     AND month = date_trunc('month', CURRENT_DATE)::date;

  IF r IS NULL THEN
    RAISE EXCEPTION 'FALHA: previsto x realizado nao devolveu o mes pessoal. E o sintoma do JOIN com `=` em group_id NULL.';
  END IF;

  -- 2.000 (aluguel) + 450 (avulsa, default expense). Os 7.777 cancelados fora.
  PERFORM pg_temp.expect_num('previsto: despesa', r.planned_expense, 2450.00);
  PERFORM pg_temp.expect_num('previsto: receita', r.planned_income, 300.00);

  -- ESTA e a assercao do NULL: previsto e realizado tem que vir na MESMA linha.
  -- Com `s.group_id = k.group_id` em vez de IS NOT DISTINCT FROM, os dois
  -- lados zeram e a tela diz que o usuario nao realizou nada do que planejou.
  PERFORM pg_temp.expect_num('realizado na mesma linha do previsto: despesa', r.actual_expense, 1000.00);
  PERFORM pg_temp.expect_num('realizado na mesma linha do previsto: receita', r.actual_income, 5000.00);

  -- gastou 1.000 do que previu 2.450: 1.450 abaixo do previsto
  PERFORM pg_temp.expect_num('variacao (negativa = gastou menos)', r.expense_variance, -1450.00);
  PERFORM pg_temp.expect('previsto: pendentes', r.pending_count, 3);
END $$;

-- CONTROLE NEGATIVO do NULL: `=` contra IS NOT DISTINCT FROM, no mesmo dado.
-- Se os dois derem o mesmo resultado, a fixture nao exercita o caso e a
-- assercao acima nao prova nada.
DO $$
DECLARE v_igual BIGINT; v_distinct BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_igual
    FROM public.scheduled_transactions s
   WHERE s.user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
     AND s.group_id = NULL::uuid;   -- sempre NULL, nunca verdadeiro

  SELECT COUNT(*) INTO v_distinct
    FROM public.scheduled_transactions s
   WHERE s.user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
     AND s.group_id IS NOT DISTINCT FROM NULL::uuid;

  IF v_igual = v_distinct THEN
    RAISE EXCEPTION 'FALHA (controle negativo): `=` e IS NOT DISTINCT FROM deram o mesmo (% e %). A fixture nao tem linha com group_id NULL.', v_igual, v_distinct;
  END IF;
  RAISE NOTICE 'ok: controle negativo do NULL (com `=` casariam % linhas, com IS NOT DISTINCT FROM casam %)', v_igual, v_distinct;
END $$;

-- =====================================================
-- SECAO 5: a meta de grupo
-- =====================================================
INSERT INTO public.financial_goals (id, user_id, group_id, title, target_amount) VALUES
  ('a0000000-0000-0000-0000-000000000301', 'aaaaaaaa-0000-0000-0000-0000000000a1',
   'a0000000-0000-0000-0000-0000000000f4', 'Passagens da viagem', 4000.00);

INSERT INTO public.goal_contributions (goal_id, user_id, amount) VALUES
  ('a0000000-0000-0000-0000-000000000301', 'aaaaaaaa-0000-0000-0000-0000000000a1', 1200.00),
  ('a0000000-0000-0000-0000-000000000301', 'bbbbbbbb-0000-0000-0000-0000000000b1',  800.00);

DO $$
BEGIN
  PERFORM pg_temp.expect_num('meta de grupo: soma os aportes dos dois membros',
    (SELECT saved FROM public.goal_progress WHERE id = 'a0000000-0000-0000-0000-000000000301'),
    2000.00);
END $$;

-- =====================================================
-- SECAO 6: o patrimonio reconstruido
-- =====================================================
-- O saldo de hoje foi calculado pelos triggers a partir das transacoes da
-- fixture; a view anda para tras a partir dele. As duas contas do fim tem que
-- fechar, senao a curva mente sobre o nivel.
DO $$
DECLARE v_hoje NUMERIC; r RECORD;
BEGIN
  SELECT SUM(current_balance) INTO v_hoje
    FROM public.financial_accounts
   WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1';

  -- 5.000 - 800 - 200 - 1.000 + 1.000 - 500 (mes passado) = 3.500
  PERFORM pg_temp.expect_num('patrimonio: saldo de hoje pelos triggers', v_hoje, 3500.00);

  SELECT * INTO r FROM public.net_worth_history
   WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
     AND month = date_trunc('month', CURRENT_DATE)::date;

  -- o ultimo ponto da curva E o saldo de hoje
  PERFORM pg_temp.expect_num('patrimonio: o mes corrente fecha com o saldo de hoje', r.net_worth, v_hoje);
  -- variacao do mes: +5.000 -800 -200 -1.000 +1.000 = +4.000. A transferencia
  -- ENTRA aqui, as DUAS pernas, que se anulam -- porque o trigger de saldo mexe
  -- em qualquer tipo. Ignorar transfer tiraria so uma das pernas da soma (a
  -- view nao sabe parear as duas) e a conta de tras para frente deixaria de
  -- fechar com o saldo de hoje, exatamente para quem usa poupanca.
  PERFORM pg_temp.expect_num('patrimonio: variacao do mes', r.net_change, 4000.00);

  SELECT * INTO r FROM public.net_worth_history
   WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
     AND month = (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date;

  -- 3.500 de hoje menos os 4.000 que se moveram depois = -500 no fim do mes
  -- passado, que e o unico movimento daquele mes (a despesa de 500) partindo
  -- de zero. E o fechamento do arco: andar para tras chega no mesmo lugar que
  -- somar para frente.
  PERFORM pg_temp.expect_num('patrimonio: mes anterior anda para tras certo', r.net_worth, -500.00);
  PERFORM pg_temp.expect_num('patrimonio: variacao do mes anterior', r.net_change, -500.00);
END $$;

-- =====================================================
-- SECAO 7: RLS -- o B nao pode ver a vida do A
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-0000000000b1';

DO $$
BEGIN
  -- a meta pessoal do A
  PERFORM pg_temp.expect('B nao ve a meta pessoal do A',
    (SELECT COUNT(*) FROM public.financial_goals
      WHERE id = 'a0000000-0000-0000-0000-000000000101'), 0);

  PERFORM pg_temp.expect('B nao ve os aportes da meta pessoal do A',
    (SELECT COUNT(*) FROM public.goal_contributions gc
      WHERE gc.goal_id = 'a0000000-0000-0000-0000-000000000101'), 0);

  -- a meta de GRUPO ele ve: os dois estao na viagem
  PERFORM pg_temp.expect('B ve a meta do grupo em que esta',
    (SELECT COUNT(*) FROM public.financial_goals
      WHERE id = 'a0000000-0000-0000-0000-000000000301'), 1);

  -- ...e ve os aportes dela, inclusive os do A: e o ponto de uma meta coletiva
  PERFORM pg_temp.expect('B ve quanto cada um aportou na meta do grupo',
    (SELECT COUNT(*) FROM public.goal_contributions
      WHERE goal_id = 'a0000000-0000-0000-0000-000000000301'), 2);

  -- ESTAS sao as assercoes de security_invoker. Sem ele, as views rodam com o
  -- privilegio do dono e devolvem a renda, o gasto e o PATRIMONIO de todos os
  -- usuarios do sistema para qualquer um que esteja logado.
  PERFORM pg_temp.expect('B nao ve o fluxo de caixa pessoal do A',
    (SELECT COUNT(*) FROM public.monthly_cash_flow
      WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' AND group_id IS NULL), 0);

  PERFORM pg_temp.expect('B nao ve o patrimonio do A',
    (SELECT COUNT(*) FROM public.net_worth_history
      WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'), 0);

  PERFORM pg_temp.expect('B nao ve o previsto x realizado do A',
    (SELECT COUNT(*) FROM public.planned_vs_actual
      WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' AND group_id IS NULL), 0);

  PERFORM pg_temp.expect('B nao ve o gasto por categoria do A',
    (SELECT COUNT(*) FROM public.category_monthly_totals
      WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' AND group_id IS NULL), 0);

  -- mas ve o proprio
  PERFORM pg_temp.expect('B ve o proprio fluxo de caixa',
    (SELECT COUNT(*) FROM public.monthly_cash_flow
      WHERE user_id = 'bbbbbbbb-0000-0000-0000-0000000000b1'), 1);
END $$;

-- Editar a meta do grupo e so de quem criou: o UPDATE do B nao pode pegar
-- nenhuma linha (a RLS filtra em silencio, sem erro -- por isso a assercao e
-- sobre a linha NAO ter mudado).
DO $$
BEGIN
  UPDATE public.financial_goals SET target_amount = 1.00
   WHERE id = 'a0000000-0000-0000-0000-000000000301';
  RAISE NOTICE 'ok: UPDATE do B na meta do grupo nao levantou erro (a RLS filtra)';
END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

DO $$
BEGIN
  PERFORM pg_temp.expect_num('B nao conseguiu mudar o alvo da meta do grupo',
    (SELECT target_amount FROM public.financial_goals
      WHERE id = 'a0000000-0000-0000-0000-000000000301'), 4000.00);
END $$;

-- =====================================================
-- SECAO 8: anon nao pode tocar em nada disto
-- =====================================================
-- A chave anon vai embutida no bundle JS publico.
SET LOCAL ROLE anon;

DO $$
DECLARE v_obj TEXT;
BEGIN
  FOREACH v_obj IN ARRAY ARRAY['financial_goals', 'goal_contributions', 'goal_progress',
                               'category_monthly_totals', 'monthly_cash_flow',
                               'planned_vs_actual', 'net_worth_history']
  LOOP
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', v_obj);
      RAISE EXCEPTION 'FALHA: anon conseguiu ler public.%', v_obj;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'ok: anon sem privilegio em public.%', v_obj;
    END;
  END LOOP;
END $$;

RESET ROLE;

-- =====================================================
-- SECAO 9: CONTROLE NEGATIVO de security_invoker
-- =====================================================
-- Prova que as assercoes da SECAO 7 medem alguma coisa: tirando o
-- security_invoker de monthly_cash_flow, o B passa a enxergar o fluxo de caixa
-- do A. Se ele NAO passar, e porque a SECAO 7 estava verde por outro motivo
-- (view vazia, fixture errada) e nao por causa da flag.
ALTER VIEW public.monthly_cash_flow SET (security_invoker = false);
ALTER VIEW public.category_monthly_totals SET (security_invoker = false);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-0000000000b1';

DO $$
DECLARE v_vazou BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_vazou FROM public.monthly_cash_flow
   WHERE user_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' AND group_id IS NULL;

  IF v_vazou = 0 THEN
    RAISE EXCEPTION 'FALHA (controle negativo): sem security_invoker o B continuou sem ver o fluxo do A. A assercao da SECAO 7 nao esta medindo a flag.';
  END IF;
  RAISE NOTICE 'ok: controle negativo de security_invoker (sem a flag vazariam % linhas)', v_vazou;
END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

ALTER VIEW public.monthly_cash_flow SET (security_invoker = true);
ALTER VIEW public.category_monthly_totals SET (security_invoker = true);

-- =====================================================
-- Fim
-- =====================================================
DO $$ BEGIN RAISE NOTICE '=== metas e relatorios: todas as assercoes passaram ==='; END $$;

ROLLBACK;

-- Se esta linha aparecer, nenhuma assercao acima abortou o lote: o teste passou.
-- Ela roda DEPOIS do ROLLBACK, ou seja, fora da transacao que foi desfeita.
SELECT 'METAS E RELATORIOS: TUDO OK -- progresso, sinal do gasto, previsto x realizado e patrimonio conferidos' AS resultado;
