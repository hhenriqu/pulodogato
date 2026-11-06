-- =====================================================
-- Teste do vencimento da fatura em dia util (082)
-- =====================================================
-- Roda no db-verify, na POSICAO dela da cadeia -- contra o banco que
-- 001 -> ... -> 082 constroem do zero.
--
-- As datas esperadas foram conferidas no app Minhas Financas em 06/11/2026,
-- nos cartoes do Helio:
--   * C6 Helio (fecha 14, vence 20, dia util ligado): 20/11/2026 (sexta,
--     Consciencia Negra) -> 23/11; 20/12/2026 (domingo) -> 21/12;
--     20/02/2027 (sabado) -> 22/02;
--   * Riachuelo (fecha 7, vence 13, ligado): 13/02/2027 (sabado) -> 15/02;
--   * C6 Leticia e BRB (desligado): ficam em 20/11 e 15/11.
--
-- OS DEFEITOS QUE ESTE ARQUIVO EXISTE PARA PRENDER
-- -------------------------------------------------
--   * Pascoa errada: Carnaval, Sexta-feira Santa e Corpus Christi andam junto
--     e o vencimento cai num dia sem banco sem erro nenhum (SECAO 1);
--   * o 20/11 antes de 2024, quando ainda nao era feriado nacional (SECAO 2);
--   * a funcao de tres argumentos mudando: ela e o dia NOMINAL, o que a tela
--     mostra riscado (SECAO 3);
--   * a opcao do cartao ignorada pela view (SECAO 4);
--   * o UPDATE da SECAO 4 da migration mexendo no que nao devia: fatura paga,
--     fatura de cartao desligado, conta prevista que nao e fatura (SECAO 5);
--   * e o `security_invoker` que o `CREATE OR REPLACE VIEW` apaga (SECAO 6).
--
-- Rodar num banco limpo, depois de 001 -> ... -> 082:
--   psql "$DB_URL" -f database/tests/082_vencimento_da_fatura_em_dia_util_test.sql
--
-- Qualquer FALHA lanca excecao e aborta. Roda num BEGIN com ROLLBACK.
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

CREATE OR REPLACE FUNCTION pg_temp.expect_date(label TEXT, got DATE, want DATE)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- =====================================================
-- SECAO 1: a Pascoa
-- =====================================================
SELECT pg_temp.expect_date('Pascoa 2025', public.pascoa(2025), DATE '2025-04-20');
SELECT pg_temp.expect_date('Pascoa 2026', public.pascoa(2026), DATE '2026-04-05');
SELECT pg_temp.expect_date('Pascoa 2027', public.pascoa(2027), DATE '2027-03-28');
SELECT pg_temp.expect_date('Pascoa 2038 (a mais tardia do seculo)', public.pascoa(2038), DATE '2038-04-25');

-- =====================================================
-- SECAO 2: feriados e proximo dia util
-- =====================================================
SELECT pg_temp.expect('fixos, moveis e o 20/11 de 2024 em diante sao feriado',
  (SELECT count(*) FROM (VALUES
     (DATE '2026-01-01'), (DATE '2026-02-16'), (DATE '2026-02-17'),
     (DATE '2026-04-03'), (DATE '2026-04-21'), (DATE '2026-05-01'),
     (DATE '2026-06-04'), (DATE '2026-09-07'), (DATE '2026-10-12'),
     (DATE '2026-11-02'), (DATE '2026-11-15'), (DATE '2026-11-20'),
     (DATE '2026-12-25'), (DATE '2024-11-20')) v(d)
    WHERE public.feriado_bancario(d)), 14);

SELECT pg_temp.expect('dia comum, quarta de cinzas e 20/11/2023 nao sao feriado',
  (SELECT count(*) FROM (VALUES
     (DATE '2026-11-19'), (DATE '2026-02-18'), (DATE '2023-11-20'),
     (DATE '2026-12-24'), (DATE '2026-12-31')) v(d)
    WHERE public.feriado_bancario(d)), 0);

SELECT pg_temp.expect_date('dia util fica onde esta',
  public.proximo_dia_util(DATE '2026-11-24'), DATE '2026-11-24');
SELECT pg_temp.expect_date('sexta feriado + fim de semana -> segunda',
  public.proximo_dia_util(DATE '2026-11-20'), DATE '2026-11-23');
SELECT pg_temp.expect_date('segunda de Carnaval -> quarta de cinzas',
  public.proximo_dia_util(DATE '2027-02-08'), DATE '2027-02-10');
SELECT pg_temp.expect_date('Sexta-feira Santa -> segunda',
  public.proximo_dia_util(DATE '2027-03-26'), DATE '2027-03-29');
SELECT pg_temp.expect_date('Corpus Christi (quinta) -> sexta',
  public.proximo_dia_util(DATE '2027-05-27'), DATE '2027-05-28');
SELECT pg_temp.expect_date('NULL fica NULL',
  public.proximo_dia_util(NULL), NULL);

-- =====================================================
-- SECAO 3: as duas funcoes de vencimento
-- =====================================================
SELECT pg_temp.expect_date('C6 Helio, novembro: 20 (feriado) -> 23',
  public.card_invoice_due_date(DATE '2026-11-01', 14, 20, TRUE), DATE '2026-11-23');
SELECT pg_temp.expect_date('C6 Helio, dezembro: 20 (domingo) -> 21',
  public.card_invoice_due_date(DATE '2026-12-01', 14, 20, TRUE), DATE '2026-12-21');
SELECT pg_temp.expect_date('C6 Helio, fevereiro: 20 (sabado) -> 22',
  public.card_invoice_due_date(DATE '2027-02-01', 14, 20, TRUE), DATE '2027-02-22');
SELECT pg_temp.expect_date('Riachuelo, fevereiro: 13 (sabado) -> 15',
  public.card_invoice_due_date(DATE '2027-02-01', 7, 13, TRUE), DATE '2027-02-15');
SELECT pg_temp.expect_date('Itau, novembro: 24 (terca) nao anda',
  public.card_invoice_due_date(DATE '2026-11-01', 17, 24, TRUE), DATE '2026-11-24');
SELECT pg_temp.expect_date('vence antes de fechar e anda de mes: 31/01/2027 (domingo) -> 01/02',
  public.card_invoice_due_date(DATE '2027-01-01', 28, 31, TRUE), DATE '2027-02-01');
SELECT pg_temp.expect_date('C6 Leticia (desligado) fica no feriado',
  public.card_invoice_due_date(DATE '2026-11-01', 14, 20, FALSE), DATE '2026-11-20');
SELECT pg_temp.expect_date('a de tres argumentos continua o dia nominal',
  public.card_invoice_due_date(DATE '2026-11-01', 14, 20), DATE '2026-11-20');
SELECT pg_temp.expect_date('sem due_day continua NULL',
  public.card_invoice_due_date(DATE '2026-11-01', 14, NULL, TRUE), NULL);

-- =====================================================
-- Fixture: um dono, dois cartoes iguais menos a opcao
-- =====================================================
INSERT INTO auth.users (id, email) VALUES
  ('d8200000-0000-0000-0000-0000000000c1', 'cris-082@teste.local'),
  ('d8200000-0000-0000-0000-0000000000d1', 'davi-082@teste.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d8200000-0000-0000-0000-0000000000c1', 'Cris 082', FALSE),
  ('d8200000-0000-0000-0000-0000000000d1', 'Davi 082', FALSE);

INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, current_balance, closing_day, due_day)
VALUES
  ('a8200000-0000-0000-0000-0000000000c1', 'd8200000-0000-0000-0000-0000000000c1',
   'Cartao dia util', 'credit_card', 0, 14, 20),
  ('a8200000-0000-0000-0000-0000000000d1', 'd8200000-0000-0000-0000-0000000000d1',
   'Cartao do Davi', 'credit_card', 0, 14, 20);

INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, current_balance, closing_day, due_day,
   vencimento_em_dia_util)
VALUES
  ('a8200000-0000-0000-0000-0000000000c2', 'd8200000-0000-0000-0000-0000000000c1',
   'Cartao dia fixo', 'credit_card', 0, 14, 20, FALSE);

SELECT pg_temp.expect('cartao novo nasce com o vencimento em dia util',
  (SELECT count(*) FROM public.financial_accounts
    WHERE id = 'a8200000-0000-0000-0000-0000000000c1' AND vencimento_em_dia_util), 1);

INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
VALUES
  ('b8200000-0000-0000-0000-000000000001', 'd8200000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a8200000-0000-0000-0000-0000000000c1', 'Mercado dia util', -100.00,
   DATE '2026-11-06', 'expense'),
  ('b8200000-0000-0000-0000-000000000002', 'd8200000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a8200000-0000-0000-0000-0000000000c2', 'Mercado dia fixo', -100.00,
   DATE '2026-11-06', 'expense'),
  ('b8200000-0000-0000-0000-000000000003', 'd8200000-0000-0000-0000-0000000000d1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a8200000-0000-0000-0000-0000000000d1', 'Pneu do Davi', -100.00,
   DATE '2026-11-06', 'expense');

-- =====================================================
-- SECAO 4: a view respeita a opcao do cartao
-- =====================================================
SELECT pg_temp.expect_date('na view, o cartao ligado vence 23/11',
  (SELECT invoice_due_date FROM public.card_invoice_lines
    WHERE transaction_id = 'b8200000-0000-0000-0000-000000000001'), DATE '2026-11-23');
SELECT pg_temp.expect_date('na view, o cartao desligado vence 20/11',
  (SELECT invoice_due_date FROM public.card_invoice_lines
    WHERE transaction_id = 'b8200000-0000-0000-0000-000000000002'), DATE '2026-11-20');
SELECT pg_temp.expect_date('o mes da fatura nao muda: novembro',
  (SELECT invoice_month FROM public.card_invoice_lines
    WHERE transaction_id = 'b8200000-0000-0000-0000-000000000001'), DATE '2026-11-01');

-- =====================================================
-- SECAO 5: as faturas fechadas que ainda vao vencer
-- =====================================================
-- Datas em 2099 para o teste nao envelhecer: a SECAO 4 da migration so mexe
-- no que vence de hoje em diante. 15/11/2099 e domingo e feriado.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, description, amount, due_date, status, notes)
VALUES
  -- fatura pendente do cartao ligado: anda
  ('c8200000-0000-0000-0000-000000000001', 'd8200000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   NULL, 'Fatura dia util', 100, DATE '2099-11-15', 'pending',
   'fatura:2099-11-01:a8200000-0000-0000-0000-0000000000c1'),
  -- fatura pendente do cartao desligado: fica
  ('c8200000-0000-0000-0000-000000000002', 'd8200000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   NULL, 'Fatura dia fixo', 100, DATE '2099-11-15', 'pending',
   'fatura:2099-11-01:a8200000-0000-0000-0000-0000000000c2'),
  -- conta prevista comum no mesmo domingo: nao e fatura, fica
  ('c8200000-0000-0000-0000-000000000003', 'd8200000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   NULL, 'Aluguel', 100, DATE '2099-11-15', 'pending', 'fatura do aluguel'),
  -- fatura pulada: fica
  ('c8200000-0000-0000-0000-000000000004', 'd8200000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   NULL, 'Fatura pulada', 100, DATE '2099-11-15', 'skipped',
   'fatura:2099-10-01:a8200000-0000-0000-0000-0000000000c1');

\ir ../migrations/082_vencimento_da_fatura_em_dia_util.sql

SELECT pg_temp.expect_date('fatura pendente do cartao ligado anda para segunda',
  (SELECT due_date FROM public.scheduled_transactions
    WHERE id = 'c8200000-0000-0000-0000-000000000001'), DATE '2099-11-16');
SELECT pg_temp.expect_date('fatura do cartao desligado fica',
  (SELECT due_date FROM public.scheduled_transactions
    WHERE id = 'c8200000-0000-0000-0000-000000000002'), DATE '2099-11-15');
SELECT pg_temp.expect_date('conta prevista que nao e fatura fica',
  (SELECT due_date FROM public.scheduled_transactions
    WHERE id = 'c8200000-0000-0000-0000-000000000003'), DATE '2099-11-15');
SELECT pg_temp.expect_date('fatura pulada fica',
  (SELECT due_date FROM public.scheduled_transactions
    WHERE id = 'c8200000-0000-0000-0000-000000000004'), DATE '2099-11-15');

-- =====================================================
-- SECAO 6: a view continua security_invoker DEPOIS do REPLACE
-- =====================================================
SELECT pg_temp.expect('card_invoice_lines tem security_invoker depois da 082',
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'card_invoice_lines'
      AND EXISTS (SELECT 1 FROM unnest(coalesce(c.reloptions, '{}')) AS o(opt)
                   WHERE o.opt ILIKE 'security_invoker=%true%')), 1);

SELECT pg_temp.expect('anon nao tem privilegio sobre card_invoice_lines',
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'card_invoice_lines'
      AND grantee = 'anon'), 0);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd8200000-0000-0000-0000-0000000000c1';

SELECT pg_temp.expect('a Cris ve as duas compras dela',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE description LIKE 'Mercado dia %'), 2);
SELECT pg_temp.expect('a Cris NAO ve o pneu do Davi',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE description = 'Pneu do Davi'), 0);
SELECT pg_temp.expect_date('a Cris chama a RPC de quatro argumentos',
  public.card_invoice_due_date(DATE '2026-11-01', 14, 20, TRUE), DATE '2026-11-23');

RESET ROLE;

-- =====================================================
ROLLBACK;
