-- =====================================================
-- Teste dos juros do MyBank no Resultado (071)
-- =====================================================
-- O emprestimo do Helio para a Lais atravessando o banco, e prova:
--
--   1. a parcela paga antes da 071 ganhou o juro na colagem (a fixture
--      071_parcela_paga_antes_da_071.sql), e a que esta em aberto nao;
--   2. o juro de cada parcela e o rateio da serie que a confirmacao usa: os
--      numeros abaixo sao os que `rateioDoPagamentoDaParcela`
--      (lib/emprestimo-do-mybank.ts) devolve para as mesmas series, e a suite
--      Node `test:juros-do-mybank` afirma os mesmos do lado do JavaScript;
--   3. a baixa grava o juro, e ninguem o escreve na mao: nem quem emprestou,
--      nem quem pegou, nem um INSERT;
--   4. o juro pago fica: o ajuste das parcelas que faltam muda o juro da serie,
--      e nao o da parcela ja paga;
--   5. cada um ve so os proprios emprestimos, e o juro pago e linha so de quem
--      pegou;
--   6. o Resultado: quem pegou tem so o juro em Despesas, quem emprestou tem
--      so o juro em Receitas, e o principal nao entra em nenhum dos dois;
--   7. o emprestimo a si mesmo e o sem juro nao poem nada no Resultado.
--
-- Rodar num banco com 001 -> ... -> 070, a fixture e a 071:
--   psql "$DB_URL" -f database/tests/071_parcela_paga_antes_da_071.sql
--   psql "$DB_URL" -f database/migrations/071_juros_do_mybank_no_resultado.sql
--   psql "$DB_URL" -f database/tests/071_juros_do_mybank_no_resultado_test.sql
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

-- As leituras passam por EXECUTE, e com a relacao conferida antes: num banco
-- parado na 070 a coluna e as views nao existem, e a suite tem de ficar
-- vermelha numa assercao que diz o que falta ("esperado 50.00, obtido
-- <NULL>"), e nao num erro de relacao.
CREATE OR REPLACE FUNCTION pg_temp.tem_a_071()
RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'mybank_installments'
                    AND column_name = 'interest_paid')
     AND to_regclass('public.mybank_installment_interest') IS NOT NULL
     AND to_regclass('public.mybank_interest_entries') IS NOT NULL;
$$;

-- O juro gravado de uma parcela.
CREATE OR REPLACE FUNCTION pg_temp.juro_gravado(p_parcela uuid)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
DECLARE
  v NUMERIC;
BEGIN
  IF NOT pg_temp.tem_a_071() THEN
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT interest_paid FROM public.mybank_installments WHERE id = $1'
    INTO v USING p_parcela;
  RETURN v;
END $$;

-- O juro de cada parcela de um emprestimo, na ordem, numa linha legivel.
CREATE OR REPLACE FUNCTION pg_temp.juros(p_emprestimo uuid, p_coluna text DEFAULT 'interest_amount')
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v TEXT;
BEGIN
  IF NOT pg_temp.tem_a_071() THEN
    RETURN NULL;
  END IF;
  EXECUTE format(
    'SELECT string_agg(COALESCE(%I::text, ''nulo''), '','' ORDER BY installment_number)
       FROM public.mybank_installment_interest WHERE loan_id = $1', p_coluna)
    INTO v USING p_emprestimo;
  RETURN v;
END $$;

-- Quantas linhas a sessao ve numa das duas views.
CREATE OR REPLACE FUNCTION pg_temp.linhas(p_view text)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v BIGINT;
BEGIN
  IF NOT pg_temp.tem_a_071() THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT count(*) FROM public.%I', p_view) INTO v;
  RETURN v;
END $$;

-- O juro pago da sessao, numa linha legivel.
CREATE OR REPLACE FUNCTION pg_temp.juros_pagos()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v TEXT;
BEGIN
  IF NOT pg_temp.tem_a_071() THEN
    RETURN NULL;
  END IF;
  EXECUTE $q$
    SELECT string_agg(
             j.transaction_type || '/' || j.amount::text || '/' ||
             j.transaction_date::text || '/' || j.descricao,
             ' | ' ORDER BY j.transaction_date, j.descricao)
      FROM public.mybank_interest_entries j
     WHERE j.user_id = auth.uid()$q$
    INTO v;
  RETURN v;
END $$;

-- Quantas linhas um UPDATE alcancou. A recusa do juro escrito na mao so
-- prova o trigger se a escrita chegou na linha: um UPDATE que a policy
-- filtrasse deixaria o juro intacto pelo motivo errado.
CREATE OR REPLACE FUNCTION pg_temp.alcancou(p_sql text)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v BIGINT;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.despesas(p_mes date)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT COALESCE(SUM(f.expense), 0)
            FROM public.personal_monthly_cash_flow f
           WHERE f.user_id = auth.uid() AND f.month = p_mes);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.receitas(p_mes date)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT COALESCE(SUM(f.income), 0)
            FROM public.personal_monthly_cash_flow f
           WHERE f.user_id = auth.uid() AND f.month = p_mes);
END $$;

-- =====================================================
-- Fixture desta suite (a da colagem esta em 071_parcela_paga_antes_da_071.sql)
-- =====================================================
--   Helio a1 (investimento c1), Lais b1, Leticia e1 (sem emprestimo)
--   d01  Moto: R$ 1.000 em 2x de R$ 550, a 1 paga antes da 071
--   d02  R$ 1.000 em 3x (366,67 + 366,67 + 366,66): o centavo na ultima
--   d03  R$ 600 em 2x de R$ 300: sem juro
--   d04  R$ 0,11 em 4x de R$ 0,03 + R$ 0,01: a ultima nao cabe a sobra
--   d05  o Helio para ele mesmo, R$ 100 em 2x de R$ 55
INSERT INTO public.mybank_loans
  (id, lender_user_id, lender_account_id, borrower_user_id,
   description, principal, installment_count, first_due_date, interest_rate)
VALUES
  ('a0710000-0000-0000-0000-000000000d02', 'a0710000-0000-0000-0000-0000000000a1',
   'a0710000-0000-0000-0000-0000000000c1', 'a0710000-0000-0000-0000-0000000000b1',
   'Notebook', 1000.00, 3, DATE '2026-11-10', 0.1),
  ('a0710000-0000-0000-0000-000000000d03', 'a0710000-0000-0000-0000-0000000000a1',
   'a0710000-0000-0000-0000-0000000000c1', 'a0710000-0000-0000-0000-0000000000b1',
   'Geladeira', 600.00, 2, DATE '2026-11-10', 0),
  ('a0710000-0000-0000-0000-000000000d04', 'a0710000-0000-0000-0000-0000000000a1',
   'a0710000-0000-0000-0000-0000000000c1', 'a0710000-0000-0000-0000-0000000000b1',
   'Centavos', 0.11, 5, DATE '2026-11-10', 0.2),
  ('a0710000-0000-0000-0000-000000000d05', 'a0710000-0000-0000-0000-0000000000a1',
   'a0710000-0000-0000-0000-0000000000c1', 'a0710000-0000-0000-0000-0000000000a1',
   'Reforma', 100.00, 2, DATE '2026-11-10', 0.1);

INSERT INTO public.mybank_installments
  (id, loan_id, installment_number, installment_total, amount, due_date)
VALUES
  ('a0710000-0000-0000-0000-000000000e21', 'a0710000-0000-0000-0000-000000000d02', 1, 3, 366.67, DATE '2026-11-10'),
  ('a0710000-0000-0000-0000-000000000e22', 'a0710000-0000-0000-0000-000000000d02', 2, 3, 366.67, DATE '2026-12-10'),
  ('a0710000-0000-0000-0000-000000000e23', 'a0710000-0000-0000-0000-000000000d02', 3, 3, 366.66, DATE '2027-01-10'),
  ('a0710000-0000-0000-0000-000000000e31', 'a0710000-0000-0000-0000-000000000d03', 1, 2, 300.00, DATE '2026-11-10'),
  ('a0710000-0000-0000-0000-000000000e32', 'a0710000-0000-0000-0000-000000000d03', 2, 2, 300.00, DATE '2026-12-10'),
  ('a0710000-0000-0000-0000-000000000e41', 'a0710000-0000-0000-0000-000000000d04', 1, 5, 0.03, DATE '2026-11-10'),
  ('a0710000-0000-0000-0000-000000000e42', 'a0710000-0000-0000-0000-000000000d04', 2, 5, 0.03, DATE '2026-12-10'),
  ('a0710000-0000-0000-0000-000000000e43', 'a0710000-0000-0000-0000-000000000d04', 3, 5, 0.03, DATE '2027-01-10'),
  ('a0710000-0000-0000-0000-000000000e44', 'a0710000-0000-0000-0000-000000000d04', 4, 5, 0.03, DATE '2027-02-10'),
  ('a0710000-0000-0000-0000-000000000e45', 'a0710000-0000-0000-0000-000000000d04', 5, 5, 0.01, DATE '2027-03-10'),
  ('a0710000-0000-0000-0000-000000000e51', 'a0710000-0000-0000-0000-000000000d05', 1, 2, 55.00, DATE '2026-11-10'),
  ('a0710000-0000-0000-0000-000000000e52', 'a0710000-0000-0000-0000-000000000d05', 2, 2, 55.00, DATE '2026-12-10');

-- =====================================================
-- SECAO 1: a parcela paga antes da 071 ganhou o juro na colagem
-- =====================================================
SELECT pg_temp.expect_num('a parcela 1/2 da Moto, paga antes da 071, tem o juro de R$ 50 gravado',
  pg_temp.juro_gravado('a0710000-0000-0000-0000-000000000e01'), 50.00);
SELECT pg_temp.expect_num('a parcela 2/2, em aberto, nao tem juro gravado',
  pg_temp.juro_gravado('a0710000-0000-0000-0000-000000000e02'), NULL);
SELECT pg_temp.expect_text('as duas parcelas da Moto: o juro de cada uma e R$ 50',
  pg_temp.juros('a0710000-0000-0000-0000-000000000d01'), '50.00,50.00');
SELECT pg_temp.expect_text('e o principal de cada uma e R$ 500',
  pg_temp.juros('a0710000-0000-0000-0000-000000000d01', 'principal_by_series'), '500.00,500.00');

-- =====================================================
-- SECAO 2: o rateio e o da confirmacao
-- =====================================================
SELECT pg_temp.expect_text('3x de R$ 366,67/366,67/366,66 sobre R$ 1.000: a ultima fecha a soma',
  pg_temp.juros('a0710000-0000-0000-0000-000000000d02'), '33.33,33.33,33.34');
SELECT pg_temp.expect_text('o principal das tres fecha os R$ 1.000',
  pg_temp.juros('a0710000-0000-0000-0000-000000000d02', 'principal_by_series'), '333.34,333.34,333.32');
SELECT pg_temp.expect_text('sem juro na serie, o juro de cada parcela e zero',
  pg_temp.juros('a0710000-0000-0000-0000-000000000d03'), '0.00,0.00');
SELECT pg_temp.expect_text('a ultima parcela nao cabe a sobra: o juro da serie inteira e nulo, como a rota recusa',
  pg_temp.juros('a0710000-0000-0000-0000-000000000d04'), 'nulo,nulo,nulo,nulo,nulo');

-- =====================================================
-- SECAO 3: a baixa grava o juro, e ninguem o escreve na mao
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0710000-0000-0000-0000-0000000000a1';
UPDATE public.mybank_installments
   SET status = 'paid', paid_date = DATE '2026-11-12'
 WHERE id = 'a0710000-0000-0000-0000-000000000e21';
SELECT pg_temp.expect_num('Helio confirma a 1/3 do Notebook: o juro gravado e R$ 33,33',
  pg_temp.juro_gravado('a0710000-0000-0000-0000-000000000e21'), 33.33);

SELECT pg_temp.expect('Helio grava R$ 999 de juro na mao na parcela paga: a escrita alcanca a linha',
  pg_temp.alcancou($$UPDATE public.mybank_installments SET interest_paid = 999
                      WHERE id = 'a0710000-0000-0000-0000-000000000e21'$$), 1);
SELECT pg_temp.expect_num('e o juro continua R$ 33,33',
  pg_temp.juro_gravado('a0710000-0000-0000-0000-000000000e21'), 33.33);

SELECT pg_temp.expect('Helio grava juro numa parcela em aberto: a escrita alcanca a linha',
  pg_temp.alcancou($$UPDATE public.mybank_installments SET interest_paid = 999
                      WHERE id = 'a0710000-0000-0000-0000-000000000e22'$$), 1);
SELECT pg_temp.expect_num('e o juro continua nulo',
  pg_temp.juro_gravado('a0710000-0000-0000-0000-000000000e22'), NULL);

INSERT INTO public.mybank_installments
  (id, loan_id, installment_number, installment_total, amount, due_date, status, paid_date, interest_paid)
VALUES
  ('a0710000-0000-0000-0000-000000000e33', 'a0710000-0000-0000-0000-000000000d03', 3, 3, 1.00,
   DATE '2027-01-10', 'paid', DATE '2026-11-12', 999);
SELECT pg_temp.expect_num('um INSERT com o juro preenchido: o juro gravado e nulo',
  pg_temp.juro_gravado('a0710000-0000-0000-0000-000000000e33'), NULL);
RESET ROLE;
-- A parcela paga nao se apaga pela sessao (053); quem a tira e a suite.
DELETE FROM public.mybank_installments WHERE id = 'a0710000-0000-0000-0000-000000000e33';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0710000-0000-0000-0000-0000000000b1';
UPDATE public.mybank_installments
   SET status = 'reported', reported_at = now(), interest_paid = 999
 WHERE id = 'a0710000-0000-0000-0000-000000000e22';
SELECT pg_temp.expect_text('Lais avisa que pagou a 2/3 e manda juro junto: o aviso passa',
  (SELECT status FROM public.mybank_installments WHERE id = 'a0710000-0000-0000-0000-000000000e22'),
  'reported');
SELECT pg_temp.expect_num('e o juro dela nao foi gravado',
  pg_temp.juro_gravado('a0710000-0000-0000-0000-000000000e22'), NULL);
RESET ROLE;

-- =====================================================
-- SECAO 4: o juro pago fica quando a serie muda
-- =====================================================
-- O ajuste repassa o que falta nas parcelas em aberto: aqui a 3/3 sobe
-- R$ 100. A soma da serie muda, e com ela o rateio de hoje.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0710000-0000-0000-0000-0000000000a1';
UPDATE public.mybank_installments
   SET amount = 466.66
 WHERE id = 'a0710000-0000-0000-0000-000000000e23';
SELECT pg_temp.expect_text('depois do ajuste, o rateio de hoje da 1/3 mudou',
  split_part(pg_temp.juros('a0710000-0000-0000-0000-000000000d02', 'interest_by_series'), ',', 1),
  '61.11');
SELECT pg_temp.expect_text('e o juro que conta continua o gravado na baixa',
  split_part(pg_temp.juros('a0710000-0000-0000-0000-000000000d02'), ',', 1),
  '33.33');
UPDATE public.mybank_installments
   SET amount = 366.66
 WHERE id = 'a0710000-0000-0000-0000-000000000e23';
RESET ROLE;

-- =====================================================
-- SECAO 5: cada um ve so os proprios emprestimos
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0710000-0000-0000-0000-0000000000e1';
SELECT pg_temp.expect('Leticia nao ve parcela nenhuma',
  pg_temp.linhas('mybank_installment_interest'), 0);
SELECT pg_temp.expect('nem juro pago nenhum',
  pg_temp.linhas('mybank_interest_entries'), 0);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0710000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect('Lais ve as parcelas dos quatro emprestimos que pegou',
  pg_temp.linhas('mybank_installment_interest'), 12);
SELECT pg_temp.expect_text('Lais: o juro pago dela e a 1/2 da Moto e a 1/3 do Notebook, na data da baixa',
  pg_temp.juros_pagos(),
  'expense/50.00/2026-09-10/Juros: Moto (1/2) | expense/33.33/2026-11-12/Juros: Notebook (1/3)');
SELECT pg_temp.expect_text('Lais le o nome da categoria reservada',
  (SELECT string_agg(DISTINCT c.name, ',')
     FROM public.mybank_interest_entries j
     JOIN public.transaction_categories c ON c.id = j.category_id
    WHERE j.user_id = auth.uid()),
  'Juros do MyBank');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0710000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect('Helio ve as parcelas dos cinco emprestimos dele, o dele para ele mesmo incluso',
  pg_temp.linhas('mybank_installment_interest'), 14);
SELECT pg_temp.expect('Helio emprestou: o juro pago nao e linha dele',
  pg_temp.linhas('mybank_interest_entries'), 0);
RESET ROLE;

-- =====================================================
-- SECAO 6: so o juro entra no Resultado, dos dois lados
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0710000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_num('Lais, setembro: R$ 50 de despesa, o juro da 1/2, e nao a parcela de R$ 550',
  pg_temp.despesas(DATE '2026-09-01'), 50.00);
SELECT pg_temp.expect_num('Lais, novembro: R$ 33,33 de despesa, o juro da 1/3',
  pg_temp.despesas(DATE '2026-11-01'), 33.33);
SELECT pg_temp.expect_text('Lais: o juro entra no relatorio por categoria',
  (SELECT c.name || '/' || t.expense::text
     FROM public.personal_category_monthly_totals t
     JOIN public.transaction_categories c ON c.id = t.category_id
    WHERE t.user_id = auth.uid() AND t.month = DATE '2026-09-01'),
  'Juros do MyBank/50.00');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0710000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_num('Helio, setembro: R$ 50 de receita, a perna de juro da confirmacao',
  pg_temp.receitas(DATE '2026-09-01'), 50.00);
SELECT pg_temp.expect_num('e nenhuma despesa: os R$ 500 de principal sao transferencia',
  pg_temp.despesas(DATE '2026-09-01'), 0);
RESET ROLE;

-- =====================================================
-- SECAO 7: o emprestimo a si mesmo e o sem juro nao poem nada no Resultado
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0710000-0000-0000-0000-0000000000a1';
UPDATE public.mybank_installments
   SET status = 'paid', paid_date = DATE '2026-12-05'
 WHERE id IN ('a0710000-0000-0000-0000-000000000e51',
              'a0710000-0000-0000-0000-000000000e31');
SELECT pg_temp.expect_num('a parcela do Helio para ele mesmo tem o juro gravado (R$ 5)',
  pg_temp.juro_gravado('a0710000-0000-0000-0000-000000000e51'), 5.00);
SELECT pg_temp.expect('mas nao vira juro pago de ninguem',
  pg_temp.linhas('mybank_interest_entries'), 0);
SELECT pg_temp.expect_num('e o Resultado de dezembro do Helio nao tem despesa',
  pg_temp.despesas(DATE '2026-12-01'), 0);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0710000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_num('a parcela sem juro paga em dezembro nao entra nas Despesas da Lais',
  pg_temp.despesas(DATE '2026-12-01'), 0);
RESET ROLE;

ROLLBACK;
