-- =====================================================
-- Teste do vinculo da prevista a um lancamento existente (065)
-- =====================================================
-- O caso de producao, em miniatura: o Helio lanca o aluguel do grupo Casa A MAO
-- e depois vincula a conta prevista do mesmo aluguel a esse lancamento (o que a
-- rota `POST /api/scheduled-transactions/{id}/vincular` grava). Prova:
--
--   1. o vinculo e o UPDATE que a rota faz, pela RLS do dono, e o check do 005
--      aceita (`paid` + `paid_date` + `transaction_id`);
--   2. a Lais, membro do grupo, le a linha com `status = 'paid'` -- a coluna que
--      /api/dashboard/previsao passou a filtrar para a prevista de grupo de
--      outro dono sair do previsto dela -- e com `my_status` ainda `pending`,
--      que e o motivo de o filtro por `my_status` sozinho nao bastar;
--   3. apagar o lancamento vinculado devolve a prevista para `pending`, sem
--      erro de constraint (o trigger da 065);
--   4. a perna de transferencia continua recusada como antes da 065: o estorno
--      dela e o DELETE de /pay, que desfaz as duas pernas;
--   5. o DELETE de quem nao e dono do lancamento nao toca a prevista de outro.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 065:
--   psql "$DB_URL" -f database/tests/065_vinculo_da_prevista_ao_lancamento_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_text(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_erro(label TEXT, sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ok: % (barrado: %)', label, left(SQLERRM, 60);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o comando PASSOU e deveria ter sido barrado', label;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
--   servico     8730cd96-d656-4c48-863e-673e1016a832  (personal_finance)
--   Moradia     b9db286c-ce4f-4fbe-b0bf-f3133185f90f  (despesa, do seed)
INSERT INTO auth.users (id, email) VALUES
  ('a0650000-0000-0000-0000-0000000000a1', 'helio@vinculo.local'),
  ('a0650000-0000-0000-0000-0000000000b1', 'lais@vinculo.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a0650000-0000-0000-0000-0000000000a1', 'Helio', FALSE),
  ('a0650000-0000-0000-0000-0000000000b1', 'Lais', FALSE);

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance) VALUES
  ('a0650000-0000-0000-0000-0000000000c1', 'a0650000-0000-0000-0000-0000000000a1', 'Corrente Helio', 'checking', 0),
  ('a0650000-0000-0000-0000-0000000000c2', 'a0650000-0000-0000-0000-0000000000a1', 'Poupanca Helio', 'savings', 0);

-- O criador entra sozinho como admin (trigger do 001); a Lais entra a mao.
INSERT INTO public.expense_groups (id, name, created_by, group_code) VALUES
  ('a0650000-0000-0000-0000-0000000000d1', 'Casa', 'a0650000-0000-0000-0000-0000000000a1', 'VINC65');

INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('a0650000-0000-0000-0000-0000000000d1', 'a0650000-0000-0000-0000-0000000000b1', 'member', 'active');

-- A prevista do aluguel do grupo, do Helio, vencendo 10/10.
INSERT INTO public.scheduled_transactions
  (id, user_id, group_id, category_id, description, amount, due_date)
VALUES
  ('a0650000-0000-0000-0000-0000000000e1', 'a0650000-0000-0000-0000-0000000000a1',
   'a0650000-0000-0000-0000-0000000000d1', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'Aluguel', 2000.00, DATE '2026-10-10');

-- O aluguel lancado A MAO em 09/10, pelo caminho do POST de lancamentos.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, group_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0650000-0000-0000-0000-0000000000f1', 'a0650000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'a0650000-0000-0000-0000-0000000000c1', 'a0650000-0000-0000-0000-0000000000d1',
   'Aluguel', -2000.00, DATE '2026-10-09', 'expense');

-- =====================================================
-- SECAO 1: o vinculo, pela RLS do dono
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0650000-0000-0000-0000-0000000000a1';

UPDATE public.scheduled_transactions
   SET status = 'paid',
       paid_date = DATE '2026-10-09',
       transaction_id = 'a0650000-0000-0000-0000-0000000000f1'
 WHERE id = 'a0650000-0000-0000-0000-0000000000e1'
   AND user_id = 'a0650000-0000-0000-0000-0000000000a1';

DO $$ BEGIN PERFORM pg_temp.expect_text('o dono vincula: a prevista fica paga',
  (SELECT status::text FROM public.scheduled_transactions
    WHERE id = 'a0650000-0000-0000-0000-0000000000e1'), 'paid'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_text('o dono le my_status paga',
  (SELECT my_status FROM public.scheduled_transactions_effective
    WHERE id = 'a0650000-0000-0000-0000-0000000000e1'), 'paid'); END $$;

-- =====================================================
-- SECAO 2: o que a Lais le da mesma linha
-- =====================================================
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0650000-0000-0000-0000-0000000000b1';

-- `status` e o do dono: e por ele que o previsto da Lais deixa de contar a
-- linha, porque a parte dela ja entrou no realizado pelo rateio do lancamento.
DO $$ BEGIN PERFORM pg_temp.expect_text('a Lais le o status do dono: paga',
  (SELECT status::text FROM public.scheduled_transactions_effective
    WHERE id = 'a0650000-0000-0000-0000-0000000000e1'), 'paid'); END $$;

-- `my_status` continua pendente (055: linha ausente em group_bill_payments vale
-- pending). Filtrar SO por ele manteria a prevista no previsto da Lais -- a
-- despesa contada duas vezes.
DO $$ BEGIN PERFORM pg_temp.expect_text('a Lais le my_status ainda pendente',
  (SELECT my_status FROM public.scheduled_transactions_effective
    WHERE id = 'a0650000-0000-0000-0000-0000000000e1'), 'pending'); END $$;

-- A parte dela no realizado existe: e o outro lado da conta que nao pode somar
-- de novo no previsto.
DO $$ BEGIN PERFORM pg_temp.expect('a parte da Lais esta no realizado',
  (SELECT COUNT(*) FROM public.group_share_entries
    WHERE transaction_id = 'a0650000-0000-0000-0000-0000000000f1'
      AND user_id = 'a0650000-0000-0000-0000-0000000000b1'), 1); END $$;

-- A Lais nao apaga o lancamento do Helio (a RLS filtra, 0 linha) e a prevista
-- dele continua paga.
DELETE FROM public.financial_transactions WHERE id = 'a0650000-0000-0000-0000-0000000000f1';

RESET ROLE;

DO $$ BEGIN PERFORM pg_temp.expect_text('o DELETE da Lais nao solta a prevista do Helio',
  (SELECT status::text FROM public.scheduled_transactions
    WHERE id = 'a0650000-0000-0000-0000-0000000000e1'), 'paid'); END $$;

-- =====================================================
-- SECAO 3: apagar o lancamento vinculado devolve a prevista
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0650000-0000-0000-0000-0000000000a1';

DELETE FROM public.financial_transactions WHERE id = 'a0650000-0000-0000-0000-0000000000f1';

RESET ROLE;

DO $$ BEGIN PERFORM pg_temp.expect('o lancamento saiu',
  (SELECT COUNT(*) FROM public.financial_transactions
    WHERE id = 'a0650000-0000-0000-0000-0000000000f1'), 0); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_text('a prevista voltou para pending',
  (SELECT status::text FROM public.scheduled_transactions
    WHERE id = 'a0650000-0000-0000-0000-0000000000e1'), 'pending'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect('e voltou sem data e sem lancamento',
  (SELECT COUNT(*) FROM public.scheduled_transactions
    WHERE id = 'a0650000-0000-0000-0000-0000000000e1'
      AND paid_date IS NULL AND transaction_id IS NULL), 1); END $$;

-- =====================================================
-- SECAO 4: a perna de transferencia continua recusada
-- =====================================================
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, description, amount, due_date)
VALUES
  ('a0650000-0000-0000-0000-0000000000e2', 'a0650000-0000-0000-0000-0000000000a1',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0650000-0000-0000-0000-0000000000c1',
   'Reserva', 500.00, DATE '2026-10-15');

INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0650000-0000-0000-0000-0000000000f2', 'a0650000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
   'a0650000-0000-0000-0000-0000000000c1', 'Reserva', -500.00, DATE '2026-10-15', 'transfer');

UPDATE public.scheduled_transactions
   SET status = 'paid', paid_date = DATE '2026-10-15',
       transaction_id = 'a0650000-0000-0000-0000-0000000000f2'
 WHERE id = 'a0650000-0000-0000-0000-0000000000e2';

DO $$ BEGIN PERFORM pg_temp.expect_erro('apagar SO a perna de transferencia continua barrado', $q$
  DELETE FROM public.financial_transactions WHERE id = 'a0650000-0000-0000-0000-0000000000f2'
$q$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_text('e a prevista da transferencia continua paga',
  (SELECT status::text FROM public.scheduled_transactions
    WHERE id = 'a0650000-0000-0000-0000-0000000000e2'), 'paid'); END $$;

-- =====================================================
-- SECAO 5: o trigger existe e e o da 065
-- =====================================================
DO $$ BEGIN PERFORM pg_temp.expect('trigger BEFORE DELETE instalado',
  (SELECT COUNT(*) FROM pg_trigger
    WHERE tgname = 'release_scheduled_transaction'
      AND tgrelid = 'public.financial_transactions'::regclass
      AND NOT tgisinternal), 1); END $$;

ROLLBACK;
