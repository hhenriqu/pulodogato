-- =====================================================
-- Teste da conta fixa e da prevista divididas com uma conexao (075)
-- =====================================================
-- O pedido do Helio (27/10/2026): a conta lancada entre conexoes aparece para
-- quem recebe como receita prevista e para quem paga como despesa prevista,
-- todo mes. Prova:
--
--   1. a conta prevista dividida com a Lais gera "A receber de Lais" para o
--      Helio e "Pagamento a Helio" para a Lais, pela parte, no vencimento, cada
--      uma visivel so para o dono e com a outra pessoa em `contraparte_id`;
--   2. so se divide com conexao aceita, e nunca consigo mesmo;
--   3. mudar o valor, a data ou a parte refaz as contas; pular, cancelar,
--      tirar a pessoa ou apagar a conta tira as contas; pagar a conta mantem;
--   4. a sessao do app nao cria, nao apaga e nao muda o valor da conta gerada,
--      mas paga; e a conta gerada paga nao e refeita em silencio;
--   5. a despesa fixa: cada ocorrencia herda a parte da regra, e mudar ou
--      tirar a parte da regra muda so as ocorrencias em aberto de hoje em
--      diante;
--   6. conta de grupo e receita prevista nao geram conta;
--   7. a conta da divisao do lancamento (070) tambem ganha `contraparte_id`.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 075:
--   psql "$DB_URL" -f database/tests/075_conta_dividida_com_conexao_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_erro_com(label TEXT, sql TEXT, trecho TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(trecho IN SQLSTATE || ' ' || SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FALHA: % -> barrado, mas por outro motivo: %', label, SQLERRM;
    END IF;
    RAISE NOTICE 'ok: % (barrado: %)', label, left(SQLERRM, 80);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o comando PASSOU e deveria ter sido barrado', label;
END $$;

-- As contas geradas pela conta prevista `p`, do usuario da sessao, numa linha.
-- Por EXECUTE: num banco sem a 075 a coluna nao existe, e a suite fica
-- vermelha numa assercao, nao num erro de coluna.
CREATE OR REPLACE FUNCTION pg_temp.tem_o_elo()
RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'scheduled_transactions'
                    AND column_name = 'scheduled_split_id');
$$;

CREATE OR REPLACE FUNCTION pg_temp.contas(p_prevista uuid)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v TEXT;
BEGIN
  IF NOT pg_temp.tem_o_elo() THEN
    RETURN NULL;
  END IF;
  EXECUTE $q$
    SELECT string_agg(
             st.transaction_type::text || '/' || st.amount::text || '/' ||
             st.due_date::text || '/' || st.status::text || '/' || st.description,
             ' | ' ORDER BY st.transaction_type)
      FROM public.scheduled_transactions st
      JOIN public.scheduled_splits ss ON ss.id = st.scheduled_split_id
     WHERE ss.scheduled_transaction_id = $1
       AND st.user_id = auth.uid()$q$
    INTO v USING p_prevista;
  RETURN v;
END $$;

-- Quantas contas geradas a conta prevista tem, dos dois lados (sem sessao).
CREATE OR REPLACE FUNCTION pg_temp.quantas(p_prevista uuid)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v BIGINT;
BEGIN
  IF NOT pg_temp.tem_o_elo() THEN
    RETURN 0;
  END IF;
  EXECUTE $q$SELECT count(*) FROM public.scheduled_transactions st
              JOIN public.scheduled_splits ss ON ss.id = st.scheduled_split_id
             WHERE ss.scheduled_transaction_id = $1$q$
    INTO v USING p_prevista;
  RETURN v;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
--   Helio a1, Lais b1 (conexao aceita), Leticia e1 (sem conexao com o Helio)
--   contas: Helio corrente c1; Lais corrente c2
--   grupo Casa d1, os dois membros
--   servico  8730cd96-d656-4c48-863e-673e1016a832  (personal_finance)
--   Moradia  b61d7949-2abc-430d-9bd0-02a146c1d9d8  (despesa, do seed)
INSERT INTO auth.users (id, email) VALUES
  ('a0750000-0000-0000-0000-0000000000a1', 'helio@conexao.local'),
  ('a0750000-0000-0000-0000-0000000000b1', 'lais@conexao.local'),
  ('a0750000-0000-0000-0000-0000000000e1', 'leticia@conexao.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a0750000-0000-0000-0000-0000000000a1', 'Helio', FALSE),
  ('a0750000-0000-0000-0000-0000000000b1', 'Lais', FALSE),
  ('a0750000-0000-0000-0000-0000000000e1', 'Leticia', FALSE);

INSERT INTO public.user_connections (requester_id, requested_id, status, responded_at) VALUES
  ('a0750000-0000-0000-0000-0000000000a1', 'a0750000-0000-0000-0000-0000000000b1', 'accepted', now());

INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  ('a0750000-0000-0000-0000-0000000000c1', 'a0750000-0000-0000-0000-0000000000a1', 'Corrente do Helio', 'checking'),
  ('a0750000-0000-0000-0000-0000000000c2', 'a0750000-0000-0000-0000-0000000000b1', 'Corrente da Lais', 'checking');

INSERT INTO public.expense_groups (id, name, created_by, group_code) VALUES
  ('a0750000-0000-0000-0000-0000000000d1', 'Casa', 'a0750000-0000-0000-0000-0000000000a1', 'CONE75');
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('a0750000-0000-0000-0000-0000000000d1', 'a0750000-0000-0000-0000-0000000000b1', 'member', 'active');

-- =====================================================
-- SECAO 1: a conta prevista dividida gera as duas contas
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0750000-0000-0000-0000-0000000000a1';
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, account_id, description, amount, due_date, transaction_type)
VALUES ('a0750000-0000-0000-0000-000000000011', 'a0750000-0000-0000-0000-0000000000a1',
        'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'a0750000-0000-0000-0000-0000000000c1',
        'Luz', 150.00, DATE '2099-03-15', 'expense');
INSERT INTO public.scheduled_splits (id, scheduled_transaction_id, participant_id, percentage)
VALUES ('a0750000-0000-0000-0000-000000000051', 'a0750000-0000-0000-0000-000000000011',
        'a0750000-0000-0000-0000-0000000000b1', 50);

SELECT pg_temp.expect_text('Helio: A receber de Lais, R$ 75, no vencimento da conta',
  pg_temp.contas('a0750000-0000-0000-0000-000000000011'),
  'income/75.00/2099-03-15/pending/A receber de Lais — Luz');
SELECT pg_temp.expect_text('Helio: a conta dele continua inteira, R$ 150',
  (SELECT amount::text FROM public.scheduled_transactions
    WHERE id = 'a0750000-0000-0000-0000-000000000011'), '150.00');
SELECT pg_temp.expect_text('Helio: a contraparte da conta gerada e a Lais',
  (SELECT contraparte_id::text FROM public.scheduled_transactions
    WHERE user_id = auth.uid() AND scheduled_split_id IS NOT NULL),
  'a0750000-0000-0000-0000-0000000000b1');
SELECT pg_temp.expect_text('Helio: a conta a receber cai na conta corrente da conta prevista',
  (SELECT account_id::text FROM public.scheduled_transactions
    WHERE user_id = auth.uid() AND scheduled_split_id IS NOT NULL),
  'a0750000-0000-0000-0000-0000000000c1');
SELECT pg_temp.expect_erro_com('Helio nao divide com quem nao e conexao',
  $$INSERT INTO public.scheduled_splits (scheduled_transaction_id, participant_id, percentage)
    VALUES ('a0750000-0000-0000-0000-000000000011', 'a0750000-0000-0000-0000-0000000000e1', 10)$$,
  'row-level security');
SELECT pg_temp.expect_erro_com('nem consigo mesmo',
  $$INSERT INTO public.scheduled_splits (scheduled_transaction_id, participant_id, percentage)
    VALUES ('a0750000-0000-0000-0000-000000000011', 'a0750000-0000-0000-0000-0000000000a1', 10)$$,
  'row-level security');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0750000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_text('Lais: Pagamento a Helio, R$ 75, no vencimento',
  pg_temp.contas('a0750000-0000-0000-0000-000000000011'),
  'expense/75.00/2099-03-15/pending/Pagamento a Helio — Luz');
SELECT pg_temp.expect_text('Lais: a conta dela e despesa prevista comum na view efetiva',
  (SELECT direction::text || '/' || my_status
     FROM public.scheduled_transactions_effective
    WHERE user_id = auth.uid() AND description = 'Pagamento a Helio — Luz'),
  'expense/pending');
SELECT pg_temp.expect_text('Lais: a contraparte da conta dela e o Helio',
  (SELECT contraparte_id::text FROM public.scheduled_transactions
    WHERE user_id = auth.uid() AND scheduled_split_id IS NOT NULL),
  'a0750000-0000-0000-0000-0000000000a1');
SELECT pg_temp.expect('Lais: le a propria parte',
  (SELECT count(*) FROM public.scheduled_splits
    WHERE id = 'a0750000-0000-0000-0000-000000000051'), 1);
SELECT pg_temp.expect('Lais: nao le a conta prevista do Helio',
  (SELECT count(*) FROM public.scheduled_transactions
    WHERE id = 'a0750000-0000-0000-0000-000000000011'), 0);
-- A policy de escrita e so do dono: o UPDATE dela nao acha a linha.
UPDATE public.scheduled_splits SET percentage = 1
 WHERE id = 'a0750000-0000-0000-0000-000000000051';
SELECT pg_temp.expect_text('Lais: nao muda a parte dela',
  (SELECT percentage::text FROM public.scheduled_splits
    WHERE id = 'a0750000-0000-0000-0000-000000000051'), '50.00');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0750000-0000-0000-0000-0000000000e1';
SELECT pg_temp.expect('Leticia: nao le a parte de ninguem',
  (SELECT count(*) FROM public.scheduled_splits), 0);
RESET ROLE;

-- =====================================================
-- SECAO 2: mudar a conta prevista refaz as contas
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0750000-0000-0000-0000-0000000000a1';
UPDATE public.scheduled_transactions SET amount = 200.00, due_date = DATE '2099-03-20'
 WHERE id = 'a0750000-0000-0000-0000-000000000011';
SELECT pg_temp.expect_text('novo valor e nova data refazem a conta do Helio',
  pg_temp.contas('a0750000-0000-0000-0000-000000000011'),
  'income/100.00/2099-03-20/pending/A receber de Lais — Luz');
UPDATE public.scheduled_splits SET percentage = 25
 WHERE id = 'a0750000-0000-0000-0000-000000000051';
SELECT pg_temp.expect_text('nova parte refaz a conta do Helio',
  pg_temp.contas('a0750000-0000-0000-0000-000000000011'),
  'income/50.00/2099-03-20/pending/A receber de Lais — Luz');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0750000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_text('e a da Lais acompanha',
  pg_temp.contas('a0750000-0000-0000-0000-000000000011'),
  'expense/50.00/2099-03-20/pending/Pagamento a Helio — Luz');
RESET ROLE;

-- =====================================================
-- SECAO 3: a sessao do app nao mexe no dinheiro da conta gerada
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0750000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_erro_com('Lais nao baixa o valor da conta dela',
  $$UPDATE public.scheduled_transactions SET amount = 0.01
     WHERE user_id = auth.uid() AND scheduled_split_id IS NOT NULL$$,
  'muda pela conta dividida');
SELECT pg_temp.expect_erro_com('nem apaga a conta',
  $$DELETE FROM public.scheduled_transactions
     WHERE user_id = auth.uid() AND scheduled_split_id IS NOT NULL$$,
  'sai junto com a conta dividida');
SELECT pg_temp.expect_erro_com('nem cria uma conta gerada na mao',
  $$INSERT INTO public.scheduled_transactions
      (user_id, category_id, description, amount, due_date, transaction_type, scheduled_split_id)
    VALUES ('a0750000-0000-0000-0000-0000000000b1', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
            'x', 1, DATE '2099-03-20', 'expense', 'a0750000-0000-0000-0000-000000000051')$$,
  'so nasce da conta dividida');

-- A Lais paga a parte dela pela baixa de sempre.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type)
VALUES ('a0750000-0000-0000-0000-0000000000f1', 'a0750000-0000-0000-0000-0000000000b1',
        '8730cd96-d656-4c48-863e-673e1016a832', '546f8740-14f1-42bd-a202-870f0f444874',
        'a0750000-0000-0000-0000-0000000000c2', 'Pagamento a Helio — Luz', -50.00,
        DATE '2099-03-20', 'expense');
UPDATE public.scheduled_transactions
   SET status = 'paid', paid_date = DATE '2099-03-20',
       transaction_id = 'a0750000-0000-0000-0000-0000000000f1'
 WHERE user_id = auth.uid() AND scheduled_split_id IS NOT NULL;
SELECT pg_temp.expect_text('Lais: a conta dela esta paga',
  pg_temp.contas('a0750000-0000-0000-0000-000000000011'),
  'expense/50.00/2099-03-20/paid/Pagamento a Helio — Luz');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0750000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_erro_com('com um lado pago, o Helio nao muda o valor da conta',
  $$UPDATE public.scheduled_transactions SET amount = 300.00
     WHERE id = 'a0750000-0000-0000-0000-000000000011'$$,
  'PDG02');
SELECT pg_temp.expect_erro_com('nem pula a conta',
  $$UPDATE public.scheduled_transactions SET status = 'skipped'
     WHERE id = 'a0750000-0000-0000-0000-000000000011'$$,
  'PDG02');
SELECT pg_temp.expect_erro_com('nem tira a Lais',
  $$DELETE FROM public.scheduled_splits
     WHERE id = 'a0750000-0000-0000-0000-000000000051'$$,
  'PDG02');
UPDATE public.scheduled_transactions SET notes = 'conta de marco'
 WHERE id = 'a0750000-0000-0000-0000-000000000011';
SELECT pg_temp.expect('o que nao mexe em dinheiro passa',
  (SELECT count(*) FROM public.scheduled_transactions
    WHERE id = 'a0750000-0000-0000-0000-000000000011' AND notes = 'conta de marco'), 1);
SELECT pg_temp.expect_text('e a conta dele continua em aberto: pagar um lado nao quita o outro',
  pg_temp.contas('a0750000-0000-0000-0000-000000000011'),
  'income/50.00/2099-03-20/pending/A receber de Lais — Luz');
RESET ROLE;

-- =====================================================
-- SECAO 4: pular, cancelar, tirar a pessoa e apagar
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0750000-0000-0000-0000-0000000000a1';
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, description, amount, due_date, transaction_type)
VALUES
  ('a0750000-0000-0000-0000-000000000012', 'a0750000-0000-0000-0000-0000000000a1',
   'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'Internet', 100.00, DATE '2099-04-05', 'expense'),
  ('a0750000-0000-0000-0000-000000000013', 'a0750000-0000-0000-0000-0000000000a1',
   'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'Gas', 80.00, DATE '2099-04-06', 'expense'),
  ('a0750000-0000-0000-0000-000000000014', 'a0750000-0000-0000-0000-0000000000a1',
   'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'Agua', 60.00, DATE '2099-04-07', 'expense');
INSERT INTO public.scheduled_splits (scheduled_transaction_id, participant_id, percentage) VALUES
  ('a0750000-0000-0000-0000-000000000012', 'a0750000-0000-0000-0000-0000000000b1', 50),
  ('a0750000-0000-0000-0000-000000000013', 'a0750000-0000-0000-0000-0000000000b1', 50),
  ('a0750000-0000-0000-0000-000000000014', 'a0750000-0000-0000-0000-0000000000b1', 50);

UPDATE public.scheduled_transactions SET status = 'skipped'
 WHERE id = 'a0750000-0000-0000-0000-000000000012';
UPDATE public.scheduled_transactions SET status = 'pending'
 WHERE id = 'a0750000-0000-0000-0000-000000000012';
UPDATE public.scheduled_transactions SET status = 'cancelled'
 WHERE id = 'a0750000-0000-0000-0000-000000000012';
DELETE FROM public.scheduled_splits
 WHERE scheduled_transaction_id = 'a0750000-0000-0000-0000-000000000013';
DELETE FROM public.scheduled_transactions
 WHERE id = 'a0750000-0000-0000-0000-000000000014';
RESET ROLE;

SELECT pg_temp.expect('cancelar a conta tira as duas contas geradas',
  pg_temp.quantas('a0750000-0000-0000-0000-000000000012'), 0);
SELECT pg_temp.expect('tirar a pessoa tira as duas',
  pg_temp.quantas('a0750000-0000-0000-0000-000000000013'), 0);
SELECT pg_temp.expect('apagar a conta prevista nao deixa conta gerada orfa',
  (SELECT count(*) FROM public.scheduled_transactions
    WHERE description IN ('A receber de Lais — Agua', 'Pagamento a Helio — Agua')), 0);

-- Pagar a conta prevista mantem as contas geradas.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0750000-0000-0000-0000-0000000000a1';
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, description, amount, due_date, transaction_type)
VALUES ('a0750000-0000-0000-0000-000000000015', 'a0750000-0000-0000-0000-0000000000a1',
        'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'Condominio', 300.00, DATE '2099-04-08', 'expense');
INSERT INTO public.scheduled_splits (scheduled_transaction_id, participant_id, percentage)
VALUES ('a0750000-0000-0000-0000-000000000015', 'a0750000-0000-0000-0000-0000000000b1', 50);
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type)
VALUES ('a0750000-0000-0000-0000-0000000000f2', 'a0750000-0000-0000-0000-0000000000a1',
        '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
        'a0750000-0000-0000-0000-0000000000c1', 'Condominio', -300.00, DATE '2099-04-08', 'expense');
UPDATE public.scheduled_transactions
   SET status = 'paid', paid_date = DATE '2099-04-08',
       transaction_id = 'a0750000-0000-0000-0000-0000000000f2'
 WHERE id = 'a0750000-0000-0000-0000-000000000015';
SELECT pg_temp.expect_text('pagar a conta prevista mantem o a receber do Helio',
  pg_temp.contas('a0750000-0000-0000-0000-000000000015'),
  'income/150.00/2099-04-08/pending/A receber de Lais — Condominio');
RESET ROLE;

-- =====================================================
-- SECAO 5: a despesa fixa
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0750000-0000-0000-0000-0000000000a1';
INSERT INTO public.recurring_rules
  (id, user_id, category_id, account_id, description, amount, transaction_type,
   frequency, due_day, start_date)
VALUES ('a0750000-0000-0000-0000-000000000031', 'a0750000-0000-0000-0000-0000000000a1',
        'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'a0750000-0000-0000-0000-0000000000c1',
        'Aluguel', 2000.00, 'expense', 'monthly', 10, DATE '2000-01-01');
-- Uma ocorrencia vencida e em aberto, que ja existia antes da parte.
INSERT INTO public.scheduled_transactions
  (id, user_id, recurring_rule_id, category_id, description, amount, due_date)
VALUES ('a0750000-0000-0000-0000-000000000040', 'a0750000-0000-0000-0000-0000000000a1',
        'a0750000-0000-0000-0000-000000000031', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
        'Aluguel', 2000.00, DATE '2000-01-10');
INSERT INTO public.recurring_rule_splits (id, recurring_rule_id, participant_id, percentage)
VALUES ('a0750000-0000-0000-0000-000000000061', 'a0750000-0000-0000-0000-000000000031',
        'a0750000-0000-0000-0000-0000000000b1', 40);
SELECT pg_temp.expect_erro_com('na regra tambem so com conexao aceita',
  $$INSERT INTO public.recurring_rule_splits (recurring_rule_id, participant_id, percentage)
    VALUES ('a0750000-0000-0000-0000-000000000031', 'a0750000-0000-0000-0000-0000000000e1', 10)$$,
  'row-level security');

-- A agenda materializa duas ocorrencias futuras (o upsert do app, sem tipo).
INSERT INTO public.scheduled_transactions
  (id, user_id, recurring_rule_id, category_id, description, amount, due_date)
VALUES
  ('a0750000-0000-0000-0000-000000000041', 'a0750000-0000-0000-0000-0000000000a1',
   'a0750000-0000-0000-0000-000000000031', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'Aluguel', 2000.00, DATE '2099-05-10'),
  ('a0750000-0000-0000-0000-000000000042', 'a0750000-0000-0000-0000-0000000000a1',
   'a0750000-0000-0000-0000-000000000031', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'Aluguel', 2000.00, DATE '2099-06-10');
SELECT pg_temp.expect_text('a ocorrencia de maio herda a parte: A receber de Lais R$ 800',
  pg_temp.contas('a0750000-0000-0000-0000-000000000041'),
  'income/800.00/2099-05-10/pending/A receber de Lais — Aluguel');
SELECT pg_temp.expect_text('e a de junho tambem',
  pg_temp.contas('a0750000-0000-0000-0000-000000000042'),
  'income/800.00/2099-06-10/pending/A receber de Lais — Aluguel');
SELECT pg_temp.expect('a vencida que ja existia nao ganha parte',
  pg_temp.quantas('a0750000-0000-0000-0000-000000000040'), 0);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0750000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_text('Lais: Pagamento a Helio R$ 800 em maio',
  pg_temp.contas('a0750000-0000-0000-0000-000000000041'),
  'expense/800.00/2099-05-10/pending/Pagamento a Helio — Aluguel');
SELECT pg_temp.expect('Lais: le a parte da regra',
  (SELECT count(*) FROM public.recurring_rule_splits
    WHERE id = 'a0750000-0000-0000-0000-000000000061'), 1);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0750000-0000-0000-0000-0000000000a1';
UPDATE public.recurring_rule_splits SET percentage = 50
 WHERE id = 'a0750000-0000-0000-0000-000000000061';
SELECT pg_temp.expect_text('mudar a parte da regra muda a ocorrencia futura',
  pg_temp.contas('a0750000-0000-0000-0000-000000000042'),
  'income/1000.00/2099-06-10/pending/A receber de Lais — Aluguel');
UPDATE public.scheduled_transactions SET amount = 2200.00
 WHERE recurring_rule_id = 'a0750000-0000-0000-0000-000000000031'
   AND due_date >= DATE '2099-01-01';
SELECT pg_temp.expect_text('o aluguel que sobe muda a parte sem regravar nada',
  pg_temp.contas('a0750000-0000-0000-0000-000000000042'),
  'income/1100.00/2099-06-10/pending/A receber de Lais — Aluguel');
DELETE FROM public.recurring_rule_splits
 WHERE id = 'a0750000-0000-0000-0000-000000000061';
RESET ROLE;
SELECT pg_temp.expect('tirar a pessoa da regra tira as contas das ocorrencias futuras',
  pg_temp.quantas('a0750000-0000-0000-0000-000000000041')
  + pg_temp.quantas('a0750000-0000-0000-0000-000000000042'), 0);

-- =====================================================
-- SECAO 6: conta de grupo e receita nao geram conta
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0750000-0000-0000-0000-0000000000a1';
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, group_id, description, amount, due_date, transaction_type)
VALUES ('a0750000-0000-0000-0000-000000000016', 'a0750000-0000-0000-0000-0000000000a1',
        'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'a0750000-0000-0000-0000-0000000000d1',
        'Mercado do grupo', 500.00, DATE '2099-04-09', 'expense');
INSERT INTO public.scheduled_splits (scheduled_transaction_id, participant_id, percentage)
VALUES ('a0750000-0000-0000-0000-000000000016', 'a0750000-0000-0000-0000-0000000000b1', 50);
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, description, amount, due_date, transaction_type)
VALUES ('a0750000-0000-0000-0000-000000000017', 'a0750000-0000-0000-0000-0000000000a1',
        'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'Salario', 5000.00, DATE '2099-04-09', 'income');
INSERT INTO public.scheduled_splits (scheduled_transaction_id, participant_id, percentage)
VALUES ('a0750000-0000-0000-0000-000000000017', 'a0750000-0000-0000-0000-0000000000b1', 50);
RESET ROLE;
SELECT pg_temp.expect('conta de grupo dividida com pessoa nao gera conta (vale o grupo)',
  pg_temp.quantas('a0750000-0000-0000-0000-000000000016'), 0);
SELECT pg_temp.expect('receita prevista nao gera conta',
  pg_temp.quantas('a0750000-0000-0000-0000-000000000017'), 0);

-- =====================================================
-- SECAO 7: a conta da divisao do lancamento (070) tambem tem contraparte
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0750000-0000-0000-0000-0000000000b1';
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type)
VALUES ('a0750000-0000-0000-0000-0000000000f3', 'a0750000-0000-0000-0000-0000000000b1',
        '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
        'a0750000-0000-0000-0000-0000000000c2', 'Agropecuaria', -79.86, DATE '2099-04-10', 'expense');
INSERT INTO public.expense_splits (transaction_id, participant_id, percentage, amount, status)
VALUES ('a0750000-0000-0000-0000-0000000000f3', 'a0750000-0000-0000-0000-0000000000a1', 90, 0, 'pending');
SELECT pg_temp.expect_text('Lais: o A receber de Helio da 070 aponta para o Helio',
  (SELECT contraparte_id::text FROM public.scheduled_transactions
    WHERE user_id = auth.uid() AND expense_split_id IS NOT NULL),
  'a0750000-0000-0000-0000-0000000000a1');
INSERT INTO public.scheduled_transactions
  (user_id, category_id, description, amount, due_date, transaction_type, contraparte_id)
VALUES ('a0750000-0000-0000-0000-0000000000b1', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
        'Comum', 10, DATE '2099-04-11', 'expense', 'a0750000-0000-0000-0000-0000000000a1');
SELECT pg_temp.expect('Lais: a sessao nao inventa contraparte numa conta comum',
  (SELECT count(*) FROM public.scheduled_transactions
    WHERE user_id = auth.uid() AND description = 'Comum' AND contraparte_id IS NOT NULL), 0);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0750000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_text('Helio: o Pagamento a Lais da 070 aponta para a Lais',
  (SELECT contraparte_id::text FROM public.scheduled_transactions
    WHERE user_id = auth.uid() AND expense_split_id IS NOT NULL),
  'a0750000-0000-0000-0000-0000000000b1');
SELECT pg_temp.expect('Helio: tudo o que esta registrado com a Lais, pela contraparte',
  (SELECT count(*) FROM public.scheduled_transactions
    WHERE user_id = auth.uid()
      AND contraparte_id = 'a0750000-0000-0000-0000-0000000000b1'), 3);
RESET ROLE;

-- =====================================================
-- SECAO 8: as funcoes nao sao chamaveis pela API
-- =====================================================
SELECT pg_temp.expect('authenticated nao executa refazer_contas_da_prevista_dividida',
  (SELECT CASE WHEN has_function_privilege('authenticated',
     'public.refazer_contas_da_prevista_dividida(uuid)', 'EXECUTE') THEN 1 ELSE 0 END), 0);
SELECT pg_temp.expect('anon nao le as partes',
  (SELECT CASE WHEN has_table_privilege('anon', 'public.scheduled_splits', 'SELECT')
                 OR has_table_privilege('anon', 'public.recurring_rule_splits', 'SELECT')
               THEN 1 ELSE 0 END), 0);

ROLLBACK;
