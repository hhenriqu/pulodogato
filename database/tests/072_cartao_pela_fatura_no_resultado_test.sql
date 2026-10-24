-- =====================================================
-- Teste do cartao pela fatura no Resultado (072)
-- =====================================================
-- O cartao do Helio atravessando o banco, e prova:
--
--   1. a compra no cartao nao entra no Resultado no mes da compra, e o que
--      ele lancou fora do cartao continua entrando;
--   2. a fatura em aberto nao entra no Resultado;
--   3. a fatura paga entra no mes do VENCIMENTO, mesmo paga no mes anterior,
--      aberta nas categorias das compras, com o estorno abatendo e a linha
--      fora dos totais fora;
--   4. as duas pernas do pagamento continuam fora, e pagar um valor diferente
--      do total nao muda a despesa;
--   5. a fatura da compra feita depois do fechamento e a do mes seguinte;
--   6. duas contas com a mesma chave contam a fatura uma vez, e a chave em
--      maiusculas tambem casa;
--   7. desfazer a baixa tira a fatura do Resultado;
--   8. cada um ve so a propria fatura, e `anon` nao le nada;
--   9. o painel do grupo (`category_monthly_totals`) nao muda.
--
-- Rodar num banco com 001 -> ... -> 072:
--   psql "$DB_URL" -f database/migrations/072_cartao_pela_fatura_no_resultado.sql
--   psql "$DB_URL" -f database/tests/072_cartao_pela_fatura_no_resultado_test.sql
--
-- Qualquer FALHA lanca excecao e aborta. Tudo roda numa transacao com ROLLBACK.
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

CREATE OR REPLACE FUNCTION pg_temp.expect_text(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- O Resultado do mes de quem esta logado: Receitas - Despesas.
CREATE OR REPLACE FUNCTION pg_temp.resultado(p_mes DATE)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT COALESCE(SUM(f.income) - SUM(f.expense), 0)
            FROM public.personal_monthly_cash_flow f
           WHERE f.user_id = auth.uid() AND f.month = p_mes);
END $$;

-- As Despesas de uma categoria no mes, para quem esta logado.
CREATE OR REPLACE FUNCTION pg_temp.despesa(p_mes DATE, p_categoria UUID)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT COALESCE(SUM(t.expense), 0)
            FROM public.personal_category_monthly_totals t
           WHERE t.user_id = auth.uid() AND t.month = p_mes
             AND t.category_id = p_categoria);
END $$;

-- A leitura da view nova passa por EXECUTE, e com a relacao conferida antes:
-- num banco parado na 071 a view nao existe, e a suite tem de ficar vermelha
-- numa assercao que diz o que falta, e nao num erro de relacao.
CREATE OR REPLACE FUNCTION pg_temp.linhas_pagas(p_filtro TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v TEXT;
BEGIN
  IF to_regclass('public.card_invoice_paid_entries') IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format(
    'SELECT COALESCE(string_agg(e.description || ''/'' || e.invoice_amount || ''/'' || e.due_date || ''/'' || e.month || ''/'' || e.paid_date || ''/'' || e.include_in_total,
                                '' | '' ORDER BY e.transaction_date, e.description), '''')
       FROM public.card_invoice_paid_entries e WHERE %s', p_filtro)
    INTO v;
  RETURN v;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
--   Helio a1, Lais b1, Leticia e1
--   Helio: corrente c1; cartao c2 (fecha dia 28, vence dia 5)
--   Lais: cartao c3 (fecha dia 28, vence dia 5) e corrente c4
--
--   Outubro, no cartao do Helio (fatura de outubro, vence em 05/11):
--     10/10  Mercado            R$ 300  Alimentacao
--     12/10  Presente           R$  50  Alimentacao, FORA DOS TOTAIS
--     15/10  Farmacia           R$  90  Saude
--     20/10  Estorno do mercado R$  40  Alimentacao (income)
--     22/10  Estorno do Uber    R$  30  Transporte (income), sem compra
--   29/10, no cartao do Helio:   Livraria R$ 120 Educacao (fatura de novembro)
--   05/10, na corrente do Helio: Feira R$ 200 Alimentacao
--
--   A fatura de outubro soma 300 + 50 + 90 - 40 - 30 = R$ 370 no banco, e
--   R$ 320 no Resultado (sem os R$ 50 fora dos totais).
INSERT INTO auth.users (id, email) VALUES
  ('a0720000-0000-0000-0000-0000000000a1', 'helio@cartao72.local'),
  ('a0720000-0000-0000-0000-0000000000b1', 'lais@cartao72.local'),
  ('a0720000-0000-0000-0000-0000000000e1', 'leticia@cartao72.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a0720000-0000-0000-0000-0000000000a1', 'Helio', FALSE),
  ('a0720000-0000-0000-0000-0000000000b1', 'Lais', FALSE),
  ('a0720000-0000-0000-0000-0000000000e1', 'Leticia', FALSE);

INSERT INTO public.financial_accounts (id, user_id, name, account_type, closing_day, due_day) VALUES
  ('a0720000-0000-0000-0000-0000000000c1', 'a0720000-0000-0000-0000-0000000000a1', 'Corrente do Helio', 'checking', NULL, NULL),
  ('a0720000-0000-0000-0000-0000000000c2', 'a0720000-0000-0000-0000-0000000000a1', 'Cartao do Helio', 'credit_card', 28, 5),
  ('a0720000-0000-0000-0000-0000000000c3', 'a0720000-0000-0000-0000-0000000000b1', 'Cartao da Lais', 'credit_card', 28, 5),
  ('a0720000-0000-0000-0000-0000000000c4', 'a0720000-0000-0000-0000-0000000000b1', 'Corrente da Lais', 'checking', NULL, NULL);

INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, include_in_total)
VALUES
  ('a0720000-0000-0000-0000-000000000f01', 'a0720000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'a0720000-0000-0000-0000-0000000000c2', 'Mercado', -300.00, DATE '2026-10-10', 'expense', TRUE),
  ('a0720000-0000-0000-0000-000000000f02', 'a0720000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'a0720000-0000-0000-0000-0000000000c2', 'Presente', -50.00, DATE '2026-10-12', 'expense', FALSE),
  ('a0720000-0000-0000-0000-000000000f03', 'a0720000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'c962941b-1aa5-4ae9-9103-d3e5ab8c98e5',
   'a0720000-0000-0000-0000-0000000000c2', 'Farmacia', -90.00, DATE '2026-10-15', 'expense', TRUE),
  ('a0720000-0000-0000-0000-000000000f04', 'a0720000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'a0720000-0000-0000-0000-0000000000c2', 'Estorno do mercado', 40.00, DATE '2026-10-20', 'income', TRUE),
  ('a0720000-0000-0000-0000-000000000f05', 'a0720000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', '49d97f81-6f07-4e6d-9822-75167b8426b2',
   'a0720000-0000-0000-0000-0000000000c2', 'Estorno do Uber', 30.00, DATE '2026-10-22', 'income', TRUE),
  ('a0720000-0000-0000-0000-000000000f06', 'a0720000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', '7802239b-2617-4dc7-a79b-4830bcbda3b0',
   'a0720000-0000-0000-0000-0000000000c2', 'Livraria', -120.00, DATE '2026-10-29', 'expense', TRUE),
  ('a0720000-0000-0000-0000-000000000f07', 'a0720000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'a0720000-0000-0000-0000-0000000000c1', 'Feira', -200.00, DATE '2026-10-05', 'expense', TRUE),
  -- A Lais tem uma compra no cartao dela, na fatura de outubro.
  ('a0720000-0000-0000-0000-000000000f08', 'a0720000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'a0720000-0000-0000-0000-0000000000c3', 'Padaria', -25.00, DATE '2026-10-08', 'expense', TRUE);

-- A fatura de outubro do Helio fechada, como o fechamento a grava: a conta a
-- pagar com a chave canonica, vencendo em 05/11. E a da Lais, tambem fechada.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, description, amount, due_date, status, notes)
VALUES
  ('a0720000-0000-0000-0000-000000000d01', 'a0720000-0000-0000-0000-0000000000a1',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0720000-0000-0000-0000-0000000000c2',
   'Fatura Cartao do Helio - 10/2026', 370.00, DATE '2026-11-05', 'pending',
   'fatura:2026-10-01:a0720000-0000-0000-0000-0000000000c2'),
  ('a0720000-0000-0000-0000-000000000d02', 'a0720000-0000-0000-0000-0000000000b1',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0720000-0000-0000-0000-0000000000c3',
   'Fatura Cartao da Lais - 10/2026', 25.00, DATE '2026-11-05', 'pending',
   'fatura:2026-10-01:a0720000-0000-0000-0000-0000000000c3');

-- A Lais ja pagou a dela, em 03/11. So a perna de saida: a de entrada nao muda
-- nada que este teste mede.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, notes)
VALUES
  ('a0720000-0000-0000-0000-000000000f13', 'a0720000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', '3f2d1c4a-9b6e-4d80-a1f5-2c7e8b30d941',
   'a0720000-0000-0000-0000-0000000000c4', 'Fatura Cartao da Lais - 10/2026', -25.00,
   DATE '2026-11-03', 'transfer', 'fatura:2026-10-01:a0720000-0000-0000-0000-0000000000c3');
UPDATE public.scheduled_transactions
   SET status = 'paid', paid_date = DATE '2026-11-03',
       transaction_id = 'a0720000-0000-0000-0000-000000000f13'
 WHERE id = 'a0720000-0000-0000-0000-000000000d02';

-- =====================================================
-- SECAO 1: a compra no cartao fica fora do mes da compra
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0720000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_num('o Resultado de outubro do Helio nao tem o cartao, so a feira na corrente',
  pg_temp.resultado(DATE '2026-10-01'), -200.00);
SELECT pg_temp.expect_num('Alimentacao de outubro e so a feira',
  pg_temp.despesa(DATE '2026-10-01', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f'), 200.00);
SELECT pg_temp.expect_num('o estorno no cartao nao e Receita de outubro',
  (SELECT COALESCE(SUM(f.income), 0) FROM public.personal_monthly_cash_flow f
    WHERE f.user_id = auth.uid() AND f.month = DATE '2026-10-01'), 0);
SELECT pg_temp.expect('outubro conta so a feira como lancamento',
  (SELECT SUM(f.transaction_count)::bigint FROM public.personal_monthly_cash_flow f
    WHERE f.user_id = auth.uid() AND f.month = DATE '2026-10-01'), 1);

-- =====================================================
-- SECAO 2: a fatura em aberto nao entra
-- =====================================================
SELECT pg_temp.expect_text('a fatura em aberto nao tem linha paga',
  pg_temp.linhas_pagas('e.user_id = auth.uid()'), '');
SELECT pg_temp.expect_num('o Resultado de novembro, com a fatura em aberto, e zero',
  pg_temp.resultado(DATE '2026-11-01'), 0);
RESET ROLE;

-- =====================================================
-- SECAO 3: a fatura paga entra no mes do vencimento
-- =====================================================
-- O Helio paga em 30/10, adiantado, R$ 400: mais do que os R$ 370 da fatura.
-- A baixa grava as duas pernas `transfer` com a chave, como
-- app/api/scheduled-transactions/[id]/pay/route.ts.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, notes)
VALUES
  ('a0720000-0000-0000-0000-000000000f11', 'a0720000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', '3f2d1c4a-9b6e-4d80-a1f5-2c7e8b30d941',
   'a0720000-0000-0000-0000-0000000000c1', 'Fatura Cartao do Helio - 10/2026', -400.00,
   DATE '2026-10-30', 'transfer', 'fatura:2026-10-01:a0720000-0000-0000-0000-0000000000c2');
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, notes, counterpart_transaction_id)
VALUES
  ('a0720000-0000-0000-0000-000000000f12', 'a0720000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', '3f2d1c4a-9b6e-4d80-a1f5-2c7e8b30d941',
   'a0720000-0000-0000-0000-0000000000c2', 'Pagamento — Fatura Cartao do Helio - 10/2026', 400.00,
   DATE '2026-10-30', 'transfer', 'fatura:2026-10-01:a0720000-0000-0000-0000-0000000000c2',
   'a0720000-0000-0000-0000-000000000f11');
UPDATE public.scheduled_transactions
   SET status = 'paid', paid_date = DATE '2026-10-30',
       transaction_id = 'a0720000-0000-0000-0000-000000000f11'
 WHERE id = 'a0720000-0000-0000-0000-000000000d01';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0720000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect_text('as cinco linhas da fatura de outubro, com o vencimento e a baixa',
  pg_temp.linhas_pagas('e.user_id = auth.uid()'),
  'Mercado/300.00/2026-11-05/2026-11-01/2026-10-30/true'
  || ' | Presente/50.00/2026-11-05/2026-11-01/2026-10-30/false'
  || ' | Farmacia/90.00/2026-11-05/2026-11-01/2026-10-30/true'
  || ' | Estorno do mercado/-40.00/2026-11-05/2026-11-01/2026-10-30/true'
  || ' | Estorno do Uber/-30.00/2026-11-05/2026-11-01/2026-10-30/true');
SELECT pg_temp.expect_num('paga em 30/10, a fatura nao entra em outubro',
  pg_temp.resultado(DATE '2026-10-01'), -200.00);
SELECT pg_temp.expect_num('ela entra em novembro, pelas linhas que contam: 300 + 90 - 40 - 30',
  pg_temp.resultado(DATE '2026-11-01'), -320.00);
SELECT pg_temp.expect_num('Alimentacao de novembro: o mercado menos o estorno, sem o presente',
  pg_temp.despesa(DATE '2026-11-01', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f'), 260.00);
SELECT pg_temp.expect_num('Saude de novembro: a farmacia',
  pg_temp.despesa(DATE '2026-11-01', 'c962941b-1aa5-4ae9-9103-d3e5ab8c98e5'), 90.00);
SELECT pg_temp.expect_num('Transporte de novembro: o estorno sem compra abate, e fica negativo',
  pg_temp.despesa(DATE '2026-11-01', '49d97f81-6f07-4e6d-9822-75167b8426b2'), -30.00);
SELECT pg_temp.expect_text('novembro e todo Despesa, e as categorias fecham com a fatura',
  (SELECT f.income || ' / ' || f.expense || ' / ' || f.net || ' / ' || f.transaction_count
     FROM public.personal_monthly_cash_flow f
    WHERE f.user_id = auth.uid() AND f.month = DATE '2026-11-01'),
  '0.00 / 320.00 / -320.00 / 4');

-- =====================================================
-- SECAO 4: as pernas do pagamento continuam fora
-- =====================================================
SELECT pg_temp.expect_num('as duas pernas de R$ 400 nao entram em outubro',
  (SELECT COALESCE(SUM(f.expense), 0) FROM public.personal_monthly_cash_flow f
    WHERE f.user_id = auth.uid() AND f.month = DATE '2026-10-01'), 200.00);
SELECT pg_temp.expect_num('pagar R$ 400 de uma fatura de R$ 370 nao muda a despesa de novembro',
  (SELECT f.expense FROM public.personal_monthly_cash_flow f
    WHERE f.user_id = auth.uid() AND f.month = DATE '2026-11-01'), 320.00);

-- =====================================================
-- SECAO 5: a compra depois do fechamento e da fatura seguinte
-- =====================================================
SELECT pg_temp.expect_text('a livraria de 29/10 nao e da fatura de outubro',
  pg_temp.linhas_pagas('e.user_id = auth.uid() AND e.description = ''Livraria'''), '');
SELECT pg_temp.expect_num('e a fatura de novembro, em aberto, nao entra em dezembro',
  pg_temp.resultado(DATE '2026-12-01'), 0);
RESET ROLE;

-- =====================================================
-- SECAO 6: uma fatura, uma vez
-- =====================================================
-- Uma segunda conta paga com a mesma chave, em maiusculas e vencendo depois.
-- A tabela nao impede, e a fatura nao pode contar duas vezes: vale a que
-- vence antes.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, description, amount, due_date, status, paid_date,
   transaction_id, notes)
VALUES
  ('a0720000-0000-0000-0000-000000000d03', 'a0720000-0000-0000-0000-0000000000a1',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0720000-0000-0000-0000-0000000000c2',
   'Fatura repetida', 370.00, DATE '2026-12-10', 'paid', DATE '2026-12-10',
   'a0720000-0000-0000-0000-000000000f11',
   'FATURA:2026-10-01:A0720000-0000-0000-0000-0000000000C2');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0720000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_num('com duas contas pagas, novembro continua com a fatura uma vez',
  pg_temp.resultado(DATE '2026-11-01'), -320.00);
SELECT pg_temp.expect_num('e dezembro nao ganha a repetida',
  pg_temp.resultado(DATE '2026-12-01'), 0);
RESET ROLE;

-- A chave em maiusculas casa sozinha: apagada a primeira conta, a fatura vai
-- para o vencimento da segunda.
UPDATE public.scheduled_transactions SET status = 'pending', paid_date = NULL, transaction_id = NULL
 WHERE id = 'a0720000-0000-0000-0000-000000000d01';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0720000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_num('a chave em maiusculas tambem e a fatura: dezembro tem os R$ 320',
  pg_temp.resultado(DATE '2026-12-01'), -320.00);
RESET ROLE;

-- =====================================================
-- SECAO 7: desfazer a baixa tira a fatura do Resultado
-- =====================================================
DELETE FROM public.scheduled_transactions WHERE id = 'a0720000-0000-0000-0000-000000000d03';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0720000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_num('com a baixa desfeita, novembro volta a zero',
  pg_temp.resultado(DATE '2026-11-01'), 0);
SELECT pg_temp.expect_num('e dezembro tambem',
  pg_temp.resultado(DATE '2026-12-01'), 0);
RESET ROLE;

UPDATE public.scheduled_transactions
   SET status = 'paid', paid_date = DATE '2026-10-30',
       transaction_id = 'a0720000-0000-0000-0000-000000000f11'
 WHERE id = 'a0720000-0000-0000-0000-000000000d01';

-- =====================================================
-- SECAO 8: cada um ve so a propria fatura
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0720000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_text('a Lais ve so a fatura dela',
  pg_temp.linhas_pagas('TRUE'),
  'Padaria/25.00/2026-11-05/2026-11-01/2026-11-03/true');
SELECT pg_temp.expect_num('o Resultado de novembro da Lais e a padaria',
  pg_temp.resultado(DATE '2026-11-01'), -25.00);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0720000-0000-0000-0000-0000000000e1';
SELECT pg_temp.expect_text('a Leticia nao ve fatura nenhuma',
  pg_temp.linhas_pagas('TRUE'), '');
RESET ROLE;

SELECT pg_temp.expect_text('anon nao le a view',
  (SELECT CASE WHEN has_table_privilege('anon', 'public.card_invoice_paid_entries', 'SELECT')
               THEN 'le' ELSE 'nao le' END),
  'nao le');

SELECT pg_temp.expect_text('as duas views sao security_invoker',
  (SELECT string_agg(c.relname || '=' || COALESCE(array_to_string(c.reloptions, ','), ''), ' ' ORDER BY c.relname)
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('card_invoice_paid_entries', 'personal_category_monthly_totals')),
  'card_invoice_paid_entries=security_invoker=true personal_category_monthly_totals=security_invoker=true');

-- =====================================================
-- SECAO 9: o painel do grupo nao muda
-- =====================================================
SELECT pg_temp.expect_num('category_monthly_totals continua com a compra no mes da compra',
  (SELECT SUM(c.expense) FROM public.category_monthly_totals c
    WHERE c.user_id = 'a0720000-0000-0000-0000-0000000000a1' AND c.month = DATE '2026-10-01'),
  710.00);
SELECT pg_temp.expect_num('e o total da fatura no banco continua com a linha desmarcada',
  (SELECT SUM(l.invoice_amount) FROM public.card_invoice_lines l
    WHERE l.account_id = 'a0720000-0000-0000-0000-0000000000c2'
      AND l.invoice_month = DATE '2026-10-01'),
  370.00);

ROLLBACK;
