-- =====================================================
-- Teste da parte recebida de divisao com pessoa (066)
-- =====================================================
-- O caso de producao em miniatura: a Lais lanca R$ 100,00 PESSOAL (sem grupo)
-- e divide com o Helio, 90%. Prova:
--
--   1. o Helio le a parte dele em `group_share_entries` (R$ 90,00, sem grupo,
--      paguei_eu falso, pago_por = Lais, com a descricao) e ela entra no
--      realizado dele (`personal_monthly_cash_flow`);
--   2. a Lais continua vendo os R$ 100,00 inteiros (HMO-258: INTEIRO quando eu
--      paguei) e nao ganha linha de parte dela mesma;
--   3. RLS: a Leticia, terceira pessoa, nao le a parte do Helio; o Helio nao
--      passa a ler a linha de `financial_transactions` da Lais; anon nao
--      executa a funcao;
--   4. nenhuma parte entra duas vezes: despesa de GRUPO com `expense_splits`
--      pendurado so entra pela perna do grupo; rateio recusado nao entra.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 066:
--   psql "$DB_URL" -f database/tests/066_parte_recebida_de_divisao_com_pessoa_test.sql
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

-- =====================================================
-- Fixture
-- =====================================================
--   servico     8730cd96-d656-4c48-863e-673e1016a832  (personal_finance)
--   categoria   b9db286c-ce4f-4fbe-b0bf-f3133185f90f  (despesa, do seed)
--   Helio a1, Lais b1, Leticia c1
INSERT INTO auth.users (id, email) VALUES
  ('a0660000-0000-0000-0000-0000000000a1', 'helio@pessoa.local'),
  ('a0660000-0000-0000-0000-0000000000b1', 'lais@pessoa.local'),
  ('a0660000-0000-0000-0000-0000000000c1', 'leticia@pessoa.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a0660000-0000-0000-0000-0000000000a1', 'Helio', FALSE),
  ('a0660000-0000-0000-0000-0000000000b1', 'Lais', FALSE),
  ('a0660000-0000-0000-0000-0000000000c1', 'Leticia', FALSE);

-- A Agropecuaria: despesa PESSOAL da Lais, dividida com o Helio em 90%.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0660000-0000-0000-0000-0000000000f1', 'a0660000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'Agropecuaria', -100.00, DATE '2026-10-22', 'expense');

INSERT INTO public.expense_splits (transaction_id, participant_id, percentage, amount, status)
VALUES ('a0660000-0000-0000-0000-0000000000f1', 'a0660000-0000-0000-0000-0000000000a1', 90, 90.00, 'pending');

-- Uma divisao RECUSADA pela Leticia, noutra despesa da Lais: nao pode entrar.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0660000-0000-0000-0000-0000000000f2', 'a0660000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'Farmacia', -40.00, DATE '2026-10-22', 'expense');

INSERT INTO public.expense_splits (transaction_id, participant_id, percentage, amount, status)
VALUES ('a0660000-0000-0000-0000-0000000000f2', 'a0660000-0000-0000-0000-0000000000c1', 50, 20.00, 'rejected');

-- Uma despesa de GRUPO (Helio + Lais) que tambem tem `expense_splits`
-- pendurado: a parte da Lais so pode entrar pela perna do grupo.
INSERT INTO public.expense_groups (id, name, created_by, group_code) VALUES
  ('a0660000-0000-0000-0000-0000000000d1', 'Par', 'a0660000-0000-0000-0000-0000000000a1', 'PES066');
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('a0660000-0000-0000-0000-0000000000d1', 'a0660000-0000-0000-0000-0000000000b1', 'member', 'active');

INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, group_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0660000-0000-0000-0000-0000000000f3', 'a0660000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'a0660000-0000-0000-0000-0000000000d1', 'Mercado do par', -60.00, DATE '2026-10-21', 'expense');

INSERT INTO public.expense_splits (transaction_id, participant_id, percentage, amount, status)
VALUES ('a0660000-0000-0000-0000-0000000000f3', 'a0660000-0000-0000-0000-0000000000b1', 50, 30.00, 'pending');

-- =====================================================
-- SECAO 1: o Helio recebe a parte
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0660000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect('o Helio tem UMA parte de pessoa',
  (SELECT count(*) FROM public.group_share_entries
    WHERE user_id = 'a0660000-0000-0000-0000-0000000000a1' AND group_id IS NULL), 1);

SELECT pg_temp.expect_num('a parte e R$ 90,00',
  (SELECT amount FROM public.group_share_entries
    WHERE transaction_id = 'a0660000-0000-0000-0000-0000000000f1'), 90.00);

SELECT pg_temp.expect_text('pago_por e a Lais',
  (SELECT pago_por::text FROM public.group_share_entries
    WHERE transaction_id = 'a0660000-0000-0000-0000-0000000000f1'),
  'a0660000-0000-0000-0000-0000000000b1');

SELECT pg_temp.expect_text('a descricao vem junto',
  (SELECT descricao FROM public.group_share_entries
    WHERE transaction_id = 'a0660000-0000-0000-0000-0000000000f1'), 'Agropecuaria');

SELECT pg_temp.expect_text('paguei_eu e falso',
  (SELECT paguei_eu::text FROM public.group_share_entries
    WHERE transaction_id = 'a0660000-0000-0000-0000-0000000000f1'), 'false');

-- O realizado do Helio em outubro: a parte de pessoa (90) mais a despesa de
-- grupo que ELE pagou, inteira (60) -- e nada da recusada.
SELECT pg_temp.expect_num('o realizado do Helio soma a parte recebida',
  (SELECT sum(expense) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a0660000-0000-0000-0000-0000000000a1' AND month = DATE '2026-10-01'), 150.00);

-- A RLS de lancamentos NAO abriu: a linha da Lais continua invisivel para ele.
SELECT pg_temp.expect('o Helio nao le o lancamento da Lais',
  (SELECT count(*) FROM public.financial_transactions
    WHERE id = 'a0660000-0000-0000-0000-0000000000f1'), 0);

RESET ROLE;

-- =====================================================
-- SECAO 2: a Lais, que pagou
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0660000-0000-0000-0000-0000000000b1';

SELECT pg_temp.expect('a Lais nao ganha parte de pessoa da propria despesa',
  (SELECT count(*) FROM public.group_share_entries
    WHERE user_id = 'a0660000-0000-0000-0000-0000000000b1' AND group_id IS NULL), 0);

-- A parte dela no mercado do par entra UMA vez, pela perna do grupo.
SELECT pg_temp.expect('o mercado do par entra uma vez para a Lais',
  (SELECT count(*) FROM public.group_share_entries
    WHERE user_id = 'a0660000-0000-0000-0000-0000000000b1'
      AND transaction_id = 'a0660000-0000-0000-0000-0000000000f3'), 1);

-- 100 (Agropecuaria, inteira) + 40 (Farmacia) + 30 (parte do mercado do par).
SELECT pg_temp.expect_num('o realizado da Lais: o que ela pagou inteiro + a parte do grupo',
  (SELECT sum(expense) FROM public.personal_monthly_cash_flow
    WHERE user_id = 'a0660000-0000-0000-0000-0000000000b1' AND month = DATE '2026-10-01'), 170.00);

RESET ROLE;

-- =====================================================
-- SECAO 3: a Leticia nao le a parte de ninguem
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0660000-0000-0000-0000-0000000000c1';

SELECT pg_temp.expect('a Leticia nao le a parte do Helio',
  (SELECT count(*) FROM public.group_share_entries
    WHERE transaction_id = 'a0660000-0000-0000-0000-0000000000f1'), 0);

SELECT pg_temp.expect('a recusada nao entra para a Leticia',
  (SELECT count(*) FROM public.group_share_entries
    WHERE transaction_id = 'a0660000-0000-0000-0000-0000000000f2'), 0);

SELECT pg_temp.expect('a funcao so devolve as partes de quem chama',
  (SELECT count(*) FROM public.minhas_partes_de_divisao_com_pessoa()), 0);

RESET ROLE;

-- =====================================================
-- SECAO 4: anon e o catalogo
-- =====================================================
SELECT pg_temp.expect('anon nao executa a funcao',
  (SELECT count(*) FROM (SELECT 1 WHERE has_function_privilege(
     'anon', 'public.minhas_partes_de_divisao_com_pessoa()', 'EXECUTE')) x), 0);

SELECT pg_temp.expect('a view continua security_invoker',
  (SELECT count(*) FROM pg_class
    WHERE oid = 'public.group_share_entries'::regclass
      AND reloptions @> ARRAY['security_invoker=true']), 1);

ROLLBACK;
