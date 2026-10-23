-- =====================================================
-- Teste da divisao com pessoa no lancamento (070)
-- =====================================================
-- O exemplo da RN020.5 (a Lais paga R$ 79,86 e divide 90% com o Helio)
-- atravessando o banco, e prova:
--
--   1. o lancamento dividido gera as duas contas: "A receber de Helio" para a
--      Lais e "Pagamento a Lais" para o Helio, de R$ 71,87, vencendo na data
--      do lancamento, cada uma visivel so para o dono;
--   2. a parte do Helio nao entra mais por `group_share_entries` (a perna de
--      pessoa da 066 saiu), e antes da baixa o Resultado dele e zero;
--   3. quitadas pela baixa comum, o Resultado da Lais e -R$ 7,99 e o do Helio
--      e -R$ 71,87;
--   4. editar o valor, a data, a descricao ou a parte refaz as contas; tirar a
--      pessoa, recusar a divisao, pôr o lancamento num grupo ou apaga-lo tira
--      as contas;
--   5. a conta paga nao e refeita em silencio: mudar o dinheiro ou apagar o
--      lancamento e recusado, e o que nao mexe em dinheiro passa;
--   6. a sessao do app nao cria, nao apaga e nao muda o valor de uma conta da
--      divisao, mas paga;
--   7. a despesa de grupo, e a divisao com ela mesma, nao geram conta;
--   8. em moeda estrangeira a conta sai em reais, pela cotacao do lancamento;
--   9. a conta de quem pagou no cartao cai na conta corrente dele.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 070:
--   psql "$DB_URL" -f database/tests/070_divisao_com_pessoa_no_lancamento_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_erro_com(label TEXT, sql TEXT, trecho TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    -- Recusa pelo motivo ERRADO e falha: uma policy que barrasse tudo deixaria
    -- estes casos verdes sem medir a trava.
    -- O SQLSTATE vai na frente: a tela traduz a recusa da divisao paga pelo
    -- codigo (PDG02), entao o codigo tambem e assercao.
    IF position(trecho IN SQLSTATE || ' ' || SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FALHA: % -> barrado, mas por outro motivo: %', label, SQLERRM;
    END IF;
    RAISE NOTICE 'ok: % (barrado: %)', label, left(SQLERRM, 80);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o comando PASSOU e deveria ter sido barrado', label;
END $$;

-- As contas da divisao do usuario da sessao, numa linha legivel.
--
-- Por EXECUTE, e com a coluna conferida antes: num banco parado na 069 a
-- coluna `expense_split_id` nao existe, e a suite tem de ficar vermelha numa
-- assercao que diz o que falta ("esperado income/71.87/..., obtido <NULL>"),
-- e nao num erro de coluna.
CREATE OR REPLACE FUNCTION pg_temp.tem_o_elo()
RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'scheduled_transactions'
                    AND column_name = 'expense_split_id');
$$;

CREATE OR REPLACE FUNCTION pg_temp.contas(p_split uuid)
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
     WHERE st.expense_split_id = $1
       AND st.user_id = auth.uid()$q$
    INTO v USING p_split;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.quantas(p_split uuid)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v BIGINT;
BEGIN
  IF NOT pg_temp.tem_o_elo() THEN
    RETURN 0;
  END IF;
  EXECUTE $q$SELECT count(*) FROM public.scheduled_transactions st
              WHERE st.expense_split_id = $1$q$
    INTO v USING p_split;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.resultado(p_mes date)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT COALESCE(SUM(f.income) - SUM(f.expense), 0)
            FROM public.personal_monthly_cash_flow f
           WHERE f.user_id = auth.uid() AND f.month = p_mes);
END $$;

-- =====================================================
-- Fixture
-- =====================================================
--   Helio a1, Lais b1
--   contas: Helio corrente h1; Lais corrente l1 e cartao l2
--   grupo Casa d1 (sem dia de fechamento), os dois membros
--   servico  8730cd96-d656-4c48-863e-673e1016a832  (personal_finance)
--   Moradia  b61d7949-2abc-430d-9bd0-02a146c1d9d8  (despesa, do seed)
INSERT INTO auth.users (id, email) VALUES
  ('a0700000-0000-0000-0000-0000000000a1', 'helio@divisao.local'),
  ('a0700000-0000-0000-0000-0000000000b1', 'lais@divisao.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a0700000-0000-0000-0000-0000000000a1', 'Helio', FALSE),
  ('a0700000-0000-0000-0000-0000000000b1', 'Lais', FALSE);

INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  ('a0700000-0000-0000-0000-0000000000c1', 'a0700000-0000-0000-0000-0000000000a1', 'Corrente do Helio', 'checking'),
  ('a0700000-0000-0000-0000-0000000000c2', 'a0700000-0000-0000-0000-0000000000b1', 'Corrente da Lais', 'checking'),
  ('a0700000-0000-0000-0000-0000000000c3', 'a0700000-0000-0000-0000-0000000000b1', 'Cartao da Lais', 'credit_card');

INSERT INTO public.expense_groups (id, name, created_by, group_code) VALUES
  ('a0700000-0000-0000-0000-0000000000d1', 'Casa', 'a0700000-0000-0000-0000-0000000000b1', 'DIVI70');
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('a0700000-0000-0000-0000-0000000000d1', 'a0700000-0000-0000-0000-0000000000a1', 'member', 'active');

-- =====================================================
-- SECAO 1: o lancamento dividido gera as duas contas
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0700000-0000-0000-0000-0000000000b1';
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0700000-0000-0000-0000-0000000000f1', 'a0700000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0700000-0000-0000-0000-0000000000c2', 'Agropecuaria', -79.86, DATE '2026-10-20', 'expense');
INSERT INTO public.expense_splits (id, transaction_id, participant_id, percentage, amount, status)
VALUES ('a0700000-0000-0000-0000-000000000051', 'a0700000-0000-0000-0000-0000000000f1',
        'a0700000-0000-0000-0000-0000000000a1', 90, 0, 'pending');

SELECT pg_temp.expect_text('Lais: A receber de Helio, R$ 71,87, vencendo no dia do lancamento',
  pg_temp.contas('a0700000-0000-0000-0000-000000000051'),
  'income/71.87/2026-10-20/pending/A receber de Helio — Agropecuaria');
SELECT pg_temp.expect_text('Lais: a conta dela cai na corrente dela, que pagou a despesa',
  (SELECT account_id::text FROM public.scheduled_transactions
    WHERE expense_split_id = 'a0700000-0000-0000-0000-000000000051'),
  'a0700000-0000-0000-0000-0000000000c2');
SELECT pg_temp.expect('Lais: le so a conta dela das duas',
  pg_temp.quantas('a0700000-0000-0000-0000-000000000051'), 1);
SELECT pg_temp.expect_text('Lais: a conta e receita prevista comum na view efetiva',
  (SELECT direction::text || '/' || my_status
     FROM public.scheduled_transactions_effective
    WHERE user_id = auth.uid() AND description LIKE 'A receber de Helio%'),
  'income/pending');
SELECT pg_temp.expect_num('Lais: antes da baixa o Resultado de outubro e a despesa inteira',
  pg_temp.resultado(DATE '2026-10-01'), -79.86);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0700000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_text('Helio: Pagamento a Lais, R$ 71,87, vencendo no dia do lancamento',
  pg_temp.contas('a0700000-0000-0000-0000-000000000051'),
  'expense/71.87/2026-10-20/pending/Pagamento a Lais — Agropecuaria');
SELECT pg_temp.expect_text('Helio: a conta dele cai na corrente dele',
  (SELECT account_id::text FROM public.scheduled_transactions
    WHERE expense_split_id = 'a0700000-0000-0000-0000-000000000051'),
  'a0700000-0000-0000-0000-0000000000c1');
SELECT pg_temp.expect_text('Helio: a categoria da conta e Pagamento a pessoa, e ele a le',
  (SELECT c.name FROM public.scheduled_transactions st
     JOIN public.transaction_categories c ON c.id = st.category_id
    WHERE st.expense_split_id = 'a0700000-0000-0000-0000-000000000051'),
  'Pagamento a pessoa');

-- =====================================================
-- SECAO 2: a perna de pessoa da 066 saiu
-- =====================================================
SELECT pg_temp.expect('Helio: nenhuma parte de divisao com pessoa em group_share_entries',
  (SELECT count(*) FROM public.group_share_entries
    WHERE user_id = auth.uid() AND group_id IS NULL), 0);
SELECT pg_temp.expect_num('Helio: antes da baixa o Resultado de outubro e zero',
  pg_temp.resultado(DATE '2026-10-01'), 0);
RESET ROLE;

SELECT pg_temp.expect('a funcao da perna de pessoa da 066 saiu',
  (SELECT count(*) FROM pg_proc WHERE proname = 'minhas_partes_de_divisao_com_pessoa'), 0);

-- =====================================================
-- SECAO 3: a sessao do app nao mexe no dinheiro da conta da divisao
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0700000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_erro_com('Helio nao baixa o valor da conta dele',
  $$UPDATE public.scheduled_transactions SET amount = 0.01
     WHERE expense_split_id = 'a0700000-0000-0000-0000-000000000051'$$,
  'muda pelo lancamento');
SELECT pg_temp.expect_erro_com('nem muda o vencimento',
  $$UPDATE public.scheduled_transactions SET due_date = DATE '2027-01-01'
     WHERE expense_split_id = 'a0700000-0000-0000-0000-000000000051'$$,
  'muda pelo lancamento');
SELECT pg_temp.expect_erro_com('nem apaga a conta',
  $$DELETE FROM public.scheduled_transactions
     WHERE expense_split_id = 'a0700000-0000-0000-0000-000000000051'$$,
  'sai junto com a divisao');
SELECT pg_temp.expect_erro_com('nem cria uma conta de divisao na mao',
  $$INSERT INTO public.scheduled_transactions
      (user_id, category_id, description, amount, due_date, transaction_type, expense_split_id)
    VALUES ('a0700000-0000-0000-0000-0000000000a1', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
            'x', 1, DATE '2026-10-20', 'expense', 'a0700000-0000-0000-0000-000000000051')$$,
  'so nasce do lancamento');
RESET ROLE;

-- Uma conta comum do Helio: ela nao vira conta da divisao, e a trava nao a
-- alcanca.
INSERT INTO public.scheduled_transactions
  (id, user_id, category_id, description, amount, due_date, transaction_type)
VALUES ('a0700000-0000-0000-0000-000000000061', 'a0700000-0000-0000-0000-0000000000a1',
        'b61d7949-2abc-430d-9bd0-02a146c1d9d8', 'Luz', 100.00, DATE '2026-10-25', 'expense');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0700000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_erro_com('Helio nao pendura a conta comum dele na divisao',
  $$UPDATE public.scheduled_transactions SET expense_split_id = 'a0700000-0000-0000-0000-000000000051'
     WHERE id = 'a0700000-0000-0000-0000-000000000061'$$,
  'so nasce do lancamento');
UPDATE public.scheduled_transactions SET amount = 120.00
 WHERE id = 'a0700000-0000-0000-0000-000000000061';
SELECT pg_temp.expect_num('controle: a conta comum continua editavel',
  (SELECT amount FROM public.scheduled_transactions WHERE id = 'a0700000-0000-0000-0000-000000000061'),
  120.00);
RESET ROLE;

-- =====================================================
-- SECAO 4: editar o lancamento refaz as contas, em aberto
-- =====================================================
-- Uma segunda divisao, so para as edicoes, para o exemplo da PRD ficar intacto.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0700000-0000-0000-0000-0000000000b1';
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0700000-0000-0000-0000-0000000000f2', 'a0700000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0700000-0000-0000-0000-0000000000c3', 'Jantar', -200.00, DATE '2026-10-05', 'expense');
INSERT INTO public.expense_splits (id, transaction_id, participant_id, percentage, amount, status)
VALUES ('a0700000-0000-0000-0000-000000000052', 'a0700000-0000-0000-0000-0000000000f2',
        'a0700000-0000-0000-0000-0000000000a1', 50, 0, 'pending');

SELECT pg_temp.expect_text('Lais pagou no cartao: o A receber dela cai na corrente, nao no cartao',
  (SELECT account_id::text FROM public.scheduled_transactions
    WHERE expense_split_id = 'a0700000-0000-0000-0000-000000000052'),
  'a0700000-0000-0000-0000-0000000000c2');

UPDATE public.financial_transactions
   SET amount = -300.00, transaction_date = DATE '2026-10-07', description = 'Jantar de aniversario'
 WHERE id = 'a0700000-0000-0000-0000-0000000000f2';
SELECT pg_temp.expect_text('Lais: valor, data e descricao novos refazem a conta dela',
  pg_temp.contas('a0700000-0000-0000-0000-000000000052'),
  'income/150.00/2026-10-07/pending/A receber de Helio — Jantar de aniversario');

UPDATE public.expense_splits SET percentage = 40
 WHERE id = 'a0700000-0000-0000-0000-000000000052';
SELECT pg_temp.expect_text('Lais: a parte nova refaz a conta dela',
  pg_temp.contas('a0700000-0000-0000-0000-000000000052'),
  'income/120.00/2026-10-07/pending/A receber de Helio — Jantar de aniversario');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0700000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_text('Helio: a conta dele acompanha as duas edicoes',
  pg_temp.contas('a0700000-0000-0000-0000-000000000052'),
  'expense/120.00/2026-10-07/pending/Pagamento a Lais — Jantar de aniversario');

-- O Helio recusa a divisao: as duas contas saem.
UPDATE public.expense_splits SET status = 'rejected'
 WHERE id = 'a0700000-0000-0000-0000-000000000052';
RESET ROLE;
SELECT pg_temp.expect('a divisao recusada nao tem conta nenhuma',
  pg_temp.quantas('a0700000-0000-0000-0000-000000000052'), 0);

-- De volta a pendente, as contas voltam; apagado o lancamento, elas saem com ele.
UPDATE public.expense_splits SET status = 'pending'
 WHERE id = 'a0700000-0000-0000-0000-000000000052';
SELECT pg_temp.expect('a divisao de volta tem as duas contas',
  pg_temp.quantas('a0700000-0000-0000-0000-000000000052'), 2);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0700000-0000-0000-0000-0000000000b1';
DELETE FROM public.financial_transactions WHERE id = 'a0700000-0000-0000-0000-0000000000f2';
RESET ROLE;
SELECT pg_temp.expect('apagar o lancamento apaga as duas contas',
  (SELECT count(*) FROM public.scheduled_transactions
    WHERE description LIKE '%Jantar de aniversario'), 0);

-- Posto num grupo, o lancamento perde as contas (RN020.4: com grupo vale so o
-- grupo).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0700000-0000-0000-0000-0000000000b1';
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0700000-0000-0000-0000-0000000000f7', 'a0700000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0700000-0000-0000-0000-0000000000c2', 'Gas', -120.00, DATE '2026-09-11', 'expense');
INSERT INTO public.expense_splits (id, transaction_id, participant_id, percentage, amount, status)
VALUES ('a0700000-0000-0000-0000-000000000057', 'a0700000-0000-0000-0000-0000000000f7',
        'a0700000-0000-0000-0000-0000000000a1', 50, 0, 'pending');
RESET ROLE;
SELECT pg_temp.expect('sem grupo, o Gas tem as duas contas',
  pg_temp.quantas('a0700000-0000-0000-0000-000000000057'), 2);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0700000-0000-0000-0000-0000000000b1';
UPDATE public.financial_transactions SET group_id = 'a0700000-0000-0000-0000-0000000000d1'
 WHERE id = 'a0700000-0000-0000-0000-0000000000f7';
RESET ROLE;
SELECT pg_temp.expect('posto no grupo, o Gas perde as contas da pessoa',
  pg_temp.quantas('a0700000-0000-0000-0000-000000000057'), 0);

-- =====================================================
-- SECAO 5: as duas baixas, e o Resultado do exemplo da PRD
-- =====================================================
-- A baixa comum (/api/scheduled-transactions/[id]/pay): o lancamento na conta
-- do dono, com a categoria da conta, e a conta paga apontando para ele.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0700000-0000-0000-0000-0000000000a1';
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type)
SELECT 'a0700000-0000-0000-0000-0000000000e1', st.user_id,
       '8730cd96-d656-4c48-863e-673e1016a832', st.category_id, st.account_id,
       st.description, -st.amount, DATE '2026-10-22', 'expense'
  FROM public.scheduled_transactions st
 WHERE st.expense_split_id = 'a0700000-0000-0000-0000-000000000051';
UPDATE public.scheduled_transactions
   SET status = 'paid', paid_date = DATE '2026-10-22',
       transaction_id = 'a0700000-0000-0000-0000-0000000000e1'
 WHERE expense_split_id = 'a0700000-0000-0000-0000-000000000051';
SELECT pg_temp.expect_num('Helio: pago, o Resultado de outubro e -R$ 71,87',
  pg_temp.resultado(DATE '2026-10-01'), -71.87);
SELECT pg_temp.expect('Helio: e a conta saiu do previsto',
  (SELECT count(*) FROM public.scheduled_transactions_effective
    WHERE user_id = auth.uid() AND description LIKE 'Pagamento a Lais%'
      AND my_status = 'pending'), 0);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0700000-0000-0000-0000-0000000000b1';
-- A baixa do Helio nao quita a conta da Lais: cada lado lanca o proprio dinheiro.
SELECT pg_temp.expect_text('Lais: a conta dela continua em aberto depois da baixa do Helio',
  (SELECT status::text FROM public.scheduled_transactions
    WHERE expense_split_id = 'a0700000-0000-0000-0000-000000000051'),
  'pending');
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type)
SELECT 'a0700000-0000-0000-0000-0000000000e2', st.user_id,
       '8730cd96-d656-4c48-863e-673e1016a832', st.category_id, st.account_id,
       st.description, st.amount, DATE '2026-10-22', 'income'
  FROM public.scheduled_transactions st
 WHERE st.expense_split_id = 'a0700000-0000-0000-0000-000000000051';
UPDATE public.scheduled_transactions
   SET status = 'paid', paid_date = DATE '2026-10-22',
       transaction_id = 'a0700000-0000-0000-0000-0000000000e2'
 WHERE expense_split_id = 'a0700000-0000-0000-0000-000000000051';
SELECT pg_temp.expect_num('Lais: recebido, o Resultado de outubro e -R$ 7,99',
  pg_temp.resultado(DATE '2026-10-01'), -7.99);
SELECT pg_temp.expect_num('Lais: a receita e a da categoria Recebimento de pessoa',
  (SELECT SUM(t.income) FROM public.personal_category_monthly_totals t
     JOIN public.transaction_categories c ON c.id = t.category_id
    WHERE t.user_id = auth.uid() AND t.month = DATE '2026-10-01'
      AND c.name = 'Recebimento de pessoa'), 71.87);

-- =====================================================
-- SECAO 6: a conta paga nao e refeita em silencio
-- =====================================================
SELECT pg_temp.expect_erro_com('Lais nao muda o valor do lancamento ja acertado',
  $$UPDATE public.financial_transactions SET amount = -100.00
     WHERE id = 'a0700000-0000-0000-0000-0000000000f1'$$,
  'PDG02 Esta divisao ja foi paga');
SELECT pg_temp.expect_erro_com('nem a parte',
  $$UPDATE public.expense_splits SET percentage = 50
     WHERE id = 'a0700000-0000-0000-0000-000000000051'$$,
  'PDG02 Esta divisao ja foi paga');
SELECT pg_temp.expect_erro_com('nem tira o Helio da divisao',
  $$DELETE FROM public.expense_splits WHERE id = 'a0700000-0000-0000-0000-000000000051'$$,
  'PDG02 Esta divisao ja foi paga');
SELECT pg_temp.expect_erro_com('nem apaga o lancamento',
  $$DELETE FROM public.financial_transactions WHERE id = 'a0700000-0000-0000-0000-0000000000f1'$$,
  'PDG02 Esta divisao ja foi paga');
-- O que nao mexe em dinheiro passa, e a conta paga fica como estava.
UPDATE public.financial_transactions SET description = 'Agropecuaria do sitio'
 WHERE id = 'a0700000-0000-0000-0000-0000000000f1';
SELECT pg_temp.expect_text('Lais: a descricao nova passa, e a conta paga nao muda',
  pg_temp.contas('a0700000-0000-0000-0000-000000000051'),
  'income/71.87/2026-10-20/paid/A receber de Helio — Agropecuaria');
RESET ROLE;

-- =====================================================
-- SECAO 7: o que nao gera conta
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0700000-0000-0000-0000-0000000000b1';
-- Despesa de grupo com uma divisao com pessoa por cima: vale so o grupo.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, group_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0700000-0000-0000-0000-0000000000f3', 'a0700000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0700000-0000-0000-0000-0000000000c2', 'a0700000-0000-0000-0000-0000000000d1',
   'Feira', -60.00, DATE '2026-10-08', 'expense');
INSERT INTO public.expense_splits (id, transaction_id, participant_id, percentage, amount, status)
VALUES ('a0700000-0000-0000-0000-000000000053', 'a0700000-0000-0000-0000-0000000000f3',
        'a0700000-0000-0000-0000-0000000000a1', 50, 0, 'pending');
-- A divisao com ela mesma.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0700000-0000-0000-0000-0000000000f4', 'a0700000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0700000-0000-0000-0000-0000000000c2', 'Padaria', -10.00, DATE '2026-10-09', 'expense');
INSERT INTO public.expense_splits (id, transaction_id, participant_id, percentage, amount, status)
VALUES ('a0700000-0000-0000-0000-000000000054', 'a0700000-0000-0000-0000-0000000000f4',
        'a0700000-0000-0000-0000-0000000000b1', 50, 0, 'pending');
RESET ROLE;
SELECT pg_temp.expect('a despesa de grupo nao gera conta de pessoa',
  pg_temp.quantas('a0700000-0000-0000-0000-000000000053'), 0);
SELECT pg_temp.expect('a divisao com ela mesma nao gera conta',
  pg_temp.quantas('a0700000-0000-0000-0000-000000000054'), 0);

-- =====================================================
-- SECAO 8: em moeda estrangeira a conta sai em reais
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0700000-0000-0000-0000-0000000000b1';
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, currency, exchange_rate,
   transaction_date, transaction_type)
VALUES
  ('a0700000-0000-0000-0000-0000000000f5', 'a0700000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0700000-0000-0000-0000-0000000000c2', 'Museu', -10.00, 'USD', 5.1234,
   DATE '2026-10-10', 'expense');
INSERT INTO public.expense_splits (id, transaction_id, participant_id, percentage, amount, status)
VALUES ('a0700000-0000-0000-0000-000000000055', 'a0700000-0000-0000-0000-0000000000f5',
        'a0700000-0000-0000-0000-0000000000a1', 50, 0, 'pending');
SELECT pg_temp.expect_text('Lais: US$ 10 a 5,1234, metade: R$ 25,62 em BRL',
  (SELECT amount::text || '/' || currency
     FROM public.scheduled_transactions
    WHERE expense_split_id = 'a0700000-0000-0000-0000-000000000055'),
  '25.62/BRL');
RESET ROLE;

-- =====================================================
-- SECAO 9: a divisao de antes da 070 ganha as contas
-- =====================================================
-- A SECAO 7 da migration chama a mesma funcao para cada divisao que ja existe.
-- Aqui a divisao nasce com o trigger desligado (o estado de antes da colagem),
-- e a chamada da colagem cria as contas.
ALTER TABLE public.expense_splits DISABLE TRIGGER expense_splits_refaz_contas;
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type)
VALUES
  ('a0700000-0000-0000-0000-0000000000f6', 'a0700000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b61d7949-2abc-430d-9bd0-02a146c1d9d8',
   'a0700000-0000-0000-0000-0000000000c2', 'Racao', -40.00, DATE '2026-09-30', 'expense');
INSERT INTO public.expense_splits (id, transaction_id, participant_id, percentage, amount, status)
VALUES ('a0700000-0000-0000-0000-000000000056', 'a0700000-0000-0000-0000-0000000000f6',
        'a0700000-0000-0000-0000-0000000000a1', 25, 0, 'approved');
ALTER TABLE public.expense_splits ENABLE TRIGGER expense_splits_refaz_contas;
SELECT pg_temp.expect('antes da colagem a divisao antiga nao tem conta',
  pg_temp.quantas('a0700000-0000-0000-0000-000000000056'), 0);
SELECT public.refazer_contas_da_divisao('a0700000-0000-0000-0000-000000000056');
SELECT pg_temp.expect('a colagem cria as duas contas da divisao antiga',
  pg_temp.quantas('a0700000-0000-0000-0000-000000000056'), 2);
SELECT public.refazer_contas_da_divisao('a0700000-0000-0000-0000-000000000056');
SELECT pg_temp.expect('e colar de novo nao duplica',
  pg_temp.quantas('a0700000-0000-0000-0000-000000000056'), 2);

-- =====================================================
-- SECAO 10: as funcoes nao sao chamaveis pela API
-- =====================================================
SELECT pg_temp.expect('authenticated nao executa refazer_contas_da_divisao',
  (SELECT CASE WHEN has_function_privilege('authenticated',
     'public.refazer_contas_da_divisao(uuid)', 'EXECUTE') THEN 1 ELSE 0 END), 0);
SELECT pg_temp.expect('anon nao executa refazer_contas_da_divisao',
  (SELECT CASE WHEN has_function_privilege('anon',
     'public.refazer_contas_da_divisao(uuid)', 'EXECUTE') THEN 1 ELSE 0 END), 0);
SELECT pg_temp.expect('group_share_entries continua security_invoker',
  (SELECT count(*) FROM pg_class
    WHERE oid = 'public.group_share_entries'::regclass
      AND reloptions @> ARRAY['security_invoker=true']), 1);

ROLLBACK;
