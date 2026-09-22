-- =====================================================
-- Teste do orcamento e da fatura de cartao (006)
-- =====================================================
-- Responde o que o 006 sozinho nao prova:
--   1. o consumo do teto soma as transacoes CERTAS -- e so elas;
--   2. um usuario enxerga o orcamento de outro? e a fatura de outro?
--   3. as duas views respeitam a RLS das tabelas base (security_invoker);
--   4. o indice unico impede dois tetos para a mesma categoria no mesmo mes,
--      sem confundir o teto pessoal com o do grupo;
--   5. a aritmetica da fatura acerta os meses curtos e a virada de ano.
--
-- Rodar num banco limpo, depois de 001 -> 002 -> 003 -> 004 -> 005 -> 006:
--   psql "$DB_URL" -f database/tests/budget_invoice_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
-- =====================================================

\set ON_ERROR_STOP on

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

CREATE OR REPLACE FUNCTION pg_temp.expect_date(label TEXT, got DATE, want DATE)
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
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a0', 'a@budget.local'),
  ('bbbbbbbb-0000-0000-0000-0000000000b0', 'b@budget.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a0', 'Usuario A', FALSE),
  ('bbbbbbbb-0000-0000-0000-0000000000b0', 'Usuario B', FALSE);

-- Conta corrente do A e o cartao dele: fecha dia 28, vence dia 5 (do mes
-- seguinte, porque 5 < 28).
INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, closing_day, due_day) VALUES
  ('a0000000-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-0000000000a0',
   'Conta A', 'checking', NULL, NULL),
  ('a0000000-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-0000000000a0',
   'Cartao A', 'credit_card', 28, 5);

-- Cartao do B, para provar que a view de faturas nao cruza usuarios.
INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, closing_day, due_day) VALUES
  ('b0000000-0000-0000-0000-0000000000d3', 'bbbbbbbb-0000-0000-0000-0000000000b0',
   'Cartao B', 'credit_card', 10, 20);

INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('a0000000-0000-0000-0000-0000000000d4', 'Casa', 'aaaaaaaa-0000-0000-0000-0000000000a0');

INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('a0000000-0000-0000-0000-0000000000d4', 'bbbbbbbb-0000-0000-0000-0000000000b0', 'member', 'active');

-- Os UUIDs de servico e categoria sao os do seed de referencia que o
-- 001_baseline.sql carrega, escritos por extenso pelo mesmo motivo do teste do
-- 005: o bundle do SQL Editor so traduz o \set ON_ERROR_STOP.
--   servico   8730cd96-d656-4c48-863e-673e1016a832  (personal_finance)
--   categoria b9db286c-ce4f-4fbe-b0bf-f3133185f90f

-- Teto pessoal do A: R$ 1.000 na categoria, neste mes.
INSERT INTO public.budgets (id, user_id, category_id, month, amount_limit) VALUES
  ('a0000000-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-0000000000a0',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', date_trunc('month', CURRENT_DATE)::date, 1000.00);

-- Teto da casa: R$ 2.000 na mesma categoria e no mesmo mes. Tem que conviver
-- com o pessoal -- sao dois bolsos diferentes.
INSERT INTO public.budgets (id, user_id, group_id, category_id, month, amount_limit) VALUES
  ('a0000000-0000-0000-0000-0000000000e2', 'aaaaaaaa-0000-0000-0000-0000000000a0',
   'a0000000-0000-0000-0000-0000000000d4',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', date_trunc('month', CURRENT_DATE)::date, 2000.00);

-- Lancamentos do mes corrente. O dia 5 existe em todo mes, entao nenhum destes
-- escorrega para fora da janela do orcamento.
--
-- ATENCAO AO SINAL: despesa entra NEGATIVA neste banco. E a convencao que
-- lib/services/scheduled.ts:valorComSinal grava (`-Math.abs`) e que o trigger
-- update_account_balance assume ao somar NEW.amount no saldo. A fixture tem
-- que falar a mesma lingua da producao -- com valores positivos aqui, um
-- SUM(t.amount) cru na view passaria neste teste e devolveria consumo
-- negativo no app, onde o alerta de estouro nunca dispararia.
INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, group_id, description, amount,
   transaction_date, transaction_type)
VALUES
  -- pessoal do A: 300 + 500 = 800  (80% de 1000 -> alerta)
  ('aaaaaaaa-0000-0000-0000-0000000000a0', '8730cd96-d656-4c48-863e-673e1016a832',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0000000-0000-0000-0000-0000000000d1', NULL,
   'Mercado 1', -300.00, date_trunc('month', CURRENT_DATE)::date + 4, 'expense'),
  ('aaaaaaaa-0000-0000-0000-0000000000a0', '8730cd96-d656-4c48-863e-673e1016a832',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0000000-0000-0000-0000-0000000000d1', NULL,
   'Mercado 2', -500.00, date_trunc('month', CURRENT_DATE)::date + 5, 'expense'),
  -- da casa (group_id preenchido): 900. NAO pode entrar no teto pessoal.
  ('aaaaaaaa-0000-0000-0000-0000000000a0', '8730cd96-d656-4c48-863e-673e1016a832',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0000000-0000-0000-0000-0000000000d1',
   'a0000000-0000-0000-0000-0000000000d4',
   'Mercado da casa', -900.00, date_trunc('month', CURRENT_DATE)::date + 6, 'expense'),
  -- do B, na casa: 200. Entra no teto do grupo, nao no pessoal do A.
  ('bbbbbbbb-0000-0000-0000-0000000000b0', '8730cd96-d656-4c48-863e-673e1016a832',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', NULL, 'a0000000-0000-0000-0000-0000000000d4',
   'Feira do B', -200.00, date_trunc('month', CURRENT_DATE)::date + 7, 'expense'),
  -- receita na mesma categoria: nao devolve espaco no teto.
  ('aaaaaaaa-0000-0000-0000-0000000000a0', '8730cd96-d656-4c48-863e-673e1016a832',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0000000-0000-0000-0000-0000000000d1', NULL,
   'Estorno mercado', 400.00, date_trunc('month', CURRENT_DATE)::date + 8, 'income'),
  -- mes passado, mesma categoria: fora da janela.
  ('aaaaaaaa-0000-0000-0000-0000000000a0', '8730cd96-d656-4c48-863e-673e1016a832',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0000000-0000-0000-0000-0000000000d1', NULL,
   'Mercado do mes passado', -999.00,
   (date_trunc('month', CURRENT_DATE) - INTERVAL '1 day')::date, 'expense');

-- =====================================================
-- 1. O consumo soma as transacoes certas
-- =====================================================
-- Este e o coracao da Fase 2: se a soma pegar a linha errada, o app acusa
-- estouro que nao houve (ou cala um que houve).
SELECT pg_temp.expect_num('teto pessoal consumiu 800 (nao pegou grupo, receita nem mes passado)',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'a0000000-0000-0000-0000-0000000000e1'), 800.00);

SELECT pg_temp.expect_num('teto pessoal em alerta aos 80%',
  (SELECT consumed_ratio FROM public.budget_consumption
    WHERE id = 'a0000000-0000-0000-0000-0000000000e1'), 0.8000);

SELECT pg_temp.expect('status do teto pessoal e alert',
  (SELECT count(*) FROM public.budget_consumption
    WHERE id = 'a0000000-0000-0000-0000-0000000000e1' AND consumption_status = 'alert'), 1);

-- O teto do grupo soma o gasto de TODOS os membros: 900 do A + 200 do B.
SELECT pg_temp.expect_num('teto da casa soma os dois membros',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'a0000000-0000-0000-0000-0000000000e2'), 1100.00);

SELECT pg_temp.expect_num('o que resta no teto da casa',
  (SELECT remaining FROM public.budget_consumption
    WHERE id = 'a0000000-0000-0000-0000-0000000000e2'), 900.00);

-- Estourar de verdade tem que virar 'exceeded'.
UPDATE public.budgets SET amount_limit = 700.00
 WHERE id = 'a0000000-0000-0000-0000-0000000000e1';

SELECT pg_temp.expect('teto pessoal estourado vira exceeded',
  (SELECT count(*) FROM public.budget_consumption
    WHERE id = 'a0000000-0000-0000-0000-0000000000e1' AND consumption_status = 'exceeded'), 1);

SELECT pg_temp.expect_num('remaining fica negativo quando estoura',
  (SELECT remaining FROM public.budget_consumption
    WHERE id = 'a0000000-0000-0000-0000-0000000000e1'), -100.00);

UPDATE public.budgets SET amount_limit = 1000.00
 WHERE id = 'a0000000-0000-0000-0000-0000000000e1';

-- Teto sem nenhum gasto nao pode sumir da lista nem virar NULL: e o caso do
-- LEFT JOIN LATERAL, e um INNER JOIN aqui esconderia justamente o orcamento
-- recem-criado -- o mes que vem, ainda sem gasto nenhum.
INSERT INTO public.budgets (id, user_id, category_id, month, amount_limit) VALUES
  ('a0000000-0000-0000-0000-0000000000e4', 'aaaaaaaa-0000-0000-0000-0000000000a0',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date, 500.00);

SELECT pg_temp.expect_num('teto sem gasto mostra 0, nao NULL',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'a0000000-0000-0000-0000-0000000000e4'), 0.00);

SELECT pg_temp.expect('teto sem gasto tem status ok',
  (SELECT count(*) FROM public.budget_consumption
    WHERE id = 'a0000000-0000-0000-0000-0000000000e4' AND consumption_status = 'ok'), 1);

-- =====================================================
-- 2. Um teto por categoria por mes -- pessoal e grupo separados
-- =====================================================
DO $$
BEGIN
  INSERT INTO public.budgets (user_id, category_id, month, amount_limit)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a0',
          'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
          date_trunc('month', CURRENT_DATE)::date, 123.00);
  RAISE EXCEPTION 'FALHA: aceitou dois tetos pessoais na mesma categoria e mes';
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'ok: teto pessoal duplicado recusado';
END $$;

DO $$
BEGIN
  INSERT INTO public.budgets (user_id, group_id, category_id, month, amount_limit)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a0',
          'a0000000-0000-0000-0000-0000000000d4',
          'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
          date_trunc('month', CURRENT_DATE)::date, 123.00);
  RAISE EXCEPTION 'FALHA: aceitou dois tetos de grupo na mesma categoria e mes';
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'ok: teto de grupo duplicado recusado';
END $$;

-- O pessoal e o do grupo ja convivem (os dois foram inseridos na fixture).
SELECT pg_temp.expect('teto pessoal e teto de grupo convivem na mesma categoria/mes',
  (SELECT count(*) FROM public.budgets
    WHERE category_id = 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f'
      AND month = date_trunc('month', CURRENT_DATE)::date), 2);

-- month tem que ser dia 1: sem o CHECK, "fevereiro dia 3" e "fevereiro dia 7"
-- seriam dois tetos distintos e o indice unico nao veria problema nenhum.
DO $$
BEGIN
  INSERT INTO public.budgets (user_id, category_id, month, amount_limit)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a0',
          'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
          (date_trunc('month', CURRENT_DATE) + INTERVAL '2 month 3 days')::date, 50.00);
  RAISE EXCEPTION 'FALHA: aceitou month fora do dia 1';
EXCEPTION
  WHEN check_violation THEN
    RAISE NOTICE 'ok: month fora do dia 1 recusado';
END $$;

-- =====================================================
-- 3. Fatura de cartao: em que fatura a compra cai
-- =====================================================
-- Fecha dia 28. A compra do dia 28 ainda e da fatura do mes; a do dia 29 ja e
-- da seguinte. Errar essa borda por um dia joga a compra para o mes errado.
SELECT pg_temp.expect_date('compra no dia do fechamento fica no mes',
  public.card_invoice_month('2026-03-28', 28), '2026-03-01');

SELECT pg_temp.expect_date('compra no dia seguinte ao fechamento vai para o mes que vem',
  public.card_invoice_month('2026-03-29', 28), '2026-04-01');

-- Dezembro: a fatura vira o ano. Um date_trunc + 1 month resolve, um
-- EXTRACT(MONTH)+1 daria 13.
SELECT pg_temp.expect_date('compra de 30/12 cai na fatura de janeiro',
  public.card_invoice_month('2026-12-30', 28), '2027-01-01');

-- Fechamento dia 31 em fevereiro: o dia 31 nao existe. Sem o clamp, NENHUMA
-- compra de fevereiro fecharia e todas escorregariam para marco.
SELECT pg_temp.expect_date('fechamento 31 em fevereiro fecha no ultimo dia',
  public.card_invoice_month('2026-02-28', 31), '2026-02-01');

SELECT pg_temp.expect_date('fechamento 31 em ano bissexto',
  public.card_invoice_month('2024-02-29', 31), '2024-02-01');

-- Cartao sem fechamento configurado: a compra e da fatura do proprio mes.
SELECT pg_temp.expect_date('sem closing_day, fatura do proprio mes',
  public.card_invoice_month('2026-05-20', NULL), '2026-05-01');

-- Vencimento: 5 < 28, entao a fatura de marco vence em 05/04.
SELECT pg_temp.expect_date('vence no mes seguinte quando due_day < closing_day',
  public.card_invoice_due_date('2026-03-01', 28, 5), '2026-04-05');

-- 20 > 10: a fatura de marco vence no proprio marco.
SELECT pg_temp.expect_date('vence no proprio mes quando due_day > closing_day',
  public.card_invoice_due_date('2026-03-01', 10, 20), '2026-03-20');

-- Vencimento dia 31 em mes curto tem o mesmo problema do fechamento.
SELECT pg_temp.expect_date('vencimento 31 clampa em fevereiro',
  public.card_invoice_due_date('2026-02-01', 10, 31), '2026-02-28');

SELECT pg_temp.expect_date('vencimento 31 clampa em abril',
  public.card_invoice_due_date('2026-04-01', 10, 31), '2026-04-30');

-- =====================================================
-- 4. card_invoice_lines: quais lancamentos entram
-- =====================================================
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
VALUES
  -- no cartao do A, antes do fechamento
  ('a0000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000a0',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'a0000000-0000-0000-0000-0000000000d2', 'Compra 27/03', -100.00, '2026-03-27', 'expense'),
  -- no cartao do A, depois do fechamento -> fatura de abril
  ('a0000000-0000-0000-0000-0000000000f2', 'aaaaaaaa-0000-0000-0000-0000000000a0',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'a0000000-0000-0000-0000-0000000000d2', 'Compra 29/03', -250.00, '2026-03-29', 'expense'),
  -- estorno no cartao, dentro da fatura de marco: tem que ABATER o total
  ('a0000000-0000-0000-0000-0000000000f5', 'aaaaaaaa-0000-0000-0000-0000000000a0',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'a0000000-0000-0000-0000-0000000000d2', 'Estorno de compra', 30.00, '2026-03-20', 'income'),
  -- na conta corrente: NAO e cartao, nao pode aparecer na view
  ('a0000000-0000-0000-0000-0000000000f3', 'aaaaaaaa-0000-0000-0000-0000000000a0',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'a0000000-0000-0000-0000-0000000000d1', 'Boleto na conta', -77.00, '2026-03-27', 'expense'),
  -- no cartao do B
  ('b0000000-0000-0000-0000-0000000000f4', 'bbbbbbbb-0000-0000-0000-0000000000b0',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'b0000000-0000-0000-0000-0000000000d3', 'Compra do B', -60.00, '2026-03-05', 'expense');

SELECT pg_temp.expect('lancamento de conta corrente fica fora da view de faturas',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE transaction_id = 'a0000000-0000-0000-0000-0000000000f3'), 0);

SELECT pg_temp.expect_date('a compra de 27/03 caiu na fatura de marco',
  (SELECT invoice_month FROM public.card_invoice_lines
    WHERE transaction_id = 'a0000000-0000-0000-0000-0000000000f1'), '2026-03-01');

SELECT pg_temp.expect_date('a compra de 29/03 caiu na fatura de abril',
  (SELECT invoice_month FROM public.card_invoice_lines
    WHERE transaction_id = 'a0000000-0000-0000-0000-0000000000f2'), '2026-04-01');

SELECT pg_temp.expect_date('a fatura de marco do cartao A vence em 05/04',
  (SELECT invoice_due_date FROM public.card_invoice_lines
    WHERE transaction_id = 'a0000000-0000-0000-0000-0000000000f1'), '2026-04-05');

-- O total da fatura e SUM(invoice_amount): compra de 100 menos estorno de 30.
-- Somar `amount` cru daria -70 (fatura negativa) e somar ABS daria 130 -- o
-- estorno AUMENTANDO o que se deve, que e o erro silencioso a evitar.
SELECT pg_temp.expect_num('total da fatura de marco: a compra soma, o estorno abate',
  (SELECT COALESCE(SUM(invoice_amount), 0) FROM public.card_invoice_lines
    WHERE account_id = 'a0000000-0000-0000-0000-0000000000d2'
      AND invoice_month = '2026-03-01'), 70.00);

SELECT pg_temp.expect_num('a compra de 100 aparece positiva na fatura',
  (SELECT invoice_amount FROM public.card_invoice_lines
    WHERE transaction_id = 'a0000000-0000-0000-0000-0000000000f1'), 100.00);

SELECT pg_temp.expect_num('o estorno aparece negativo na fatura',
  (SELECT invoice_amount FROM public.card_invoice_lines
    WHERE transaction_id = 'a0000000-0000-0000-0000-0000000000f5'), -30.00);

-- =====================================================
-- 5. Isolamento entre usuarios
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-0000000000b0';

SELECT pg_temp.expect('B NAO ve o teto pessoal do A',
  (SELECT count(*) FROM public.budgets WHERE group_id IS NULL), 0);

-- ...mas ve o teto da casa, senao o orcamento compartilhado nao serve para nada.
SELECT pg_temp.expect('B ve o teto da casa',
  (SELECT count(*) FROM public.budgets
    WHERE id = 'a0000000-0000-0000-0000-0000000000e2'), 1);

-- O furo classico: view sem security_invoker roda com o privilegio do dono e
-- devolveria todos os orcamentos. Estes dois asserts sao o que prova o
-- ALTER VIEW da SECAO 7 do 006.
SELECT pg_temp.expect('budget_consumption nao vaza o teto do A para o B',
  (SELECT count(*) FROM public.budget_consumption), 1);

SELECT pg_temp.expect('card_invoice_lines so mostra o cartao do proprio B',
  (SELECT count(*) FROM public.card_invoice_lines), 1);

SELECT pg_temp.expect('e e mesmo a compra do B',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE transaction_id = 'b0000000-0000-0000-0000-0000000000f4'), 1);

-- Ler o teto do grupo nao e poder mexer nele: o dono da linha e quem cadastrou.
DO $$
BEGIN
  UPDATE public.budgets SET amount_limit = 1
   WHERE id = 'a0000000-0000-0000-0000-0000000000e2';
  IF FOUND THEN
    RAISE EXCEPTION 'FALHA: B alterou o teto da casa cadastrado pelo A';
  END IF;
  RAISE NOTICE 'ok: B le o teto do grupo mas nao o altera';
END $$;

DO $$
BEGIN
  INSERT INTO public.budgets (user_id, category_id, month, amount_limit)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a0',
          'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
          (date_trunc('month', CURRENT_DATE) + INTERVAL '3 month')::date, 10.00);
  RAISE EXCEPTION 'FALHA: B criou orcamento em nome do A';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: B bloqueado ao criar orcamento em nome do A';
END $$;

RESET ROLE;

-- =====================================================
-- 6. anon nao toca em nada disso
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes destes objetos existirem, e ALL
-- TABLES nao alcanca o futuro: a SECAO 7 do 006 refaz os grants, e estes
-- asserts sao o que provaria a falta deles.
SET LOCAL ROLE anon;

DO $$
BEGIN
  PERFORM 1 FROM public.budgets;
  RAISE EXCEPTION 'FALHA: anon leu os orcamentos';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon sem privilegio em budgets';
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.budget_consumption;
  RAISE EXCEPTION 'FALHA: anon leu a view de consumo';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon sem privilegio em budget_consumption';
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.card_invoice_lines;
  RAISE EXCEPTION 'FALHA: anon leu as faturas de cartao';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon sem privilegio em card_invoice_lines';
END $$;

-- As funcoes retornam `date`, nao `trigger`: o PostgREST as expoe como RPC.
-- Sem o REVOKE nominal da SECAO 7 (revogar de PUBLIC nao desfaz o grant
-- explicito que o Supabase da a anon), /rest/v1/rpc/card_invoice_month fica
-- chamavel com a chave que vai no bundle JS publico.
DO $$
BEGIN
  PERFORM public.card_invoice_month('2026-03-29', 28);
  RAISE EXCEPTION 'FALHA: anon executou card_invoice_month';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon sem privilegio em card_invoice_month';
END $$;

DO $$
BEGIN
  PERFORM public.card_invoice_due_date('2026-03-01', 28, 5);
  RAISE EXCEPTION 'FALHA: anon executou card_invoice_due_date';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon sem privilegio em card_invoice_due_date';
END $$;

RESET ROLE;

ROLLBACK;
