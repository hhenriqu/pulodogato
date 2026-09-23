-- =====================================================
-- PULODOGATO -- VALIDACAO PASSO 3: contas previstas e gastos fixos (005)
-- =====================================================
-- GERADO por scripts/gen-validation-bundle.mjs. Nao edite este arquivo:
-- a fonte e database/migrations/*.sql e database/tests/rls_isolation_test.sql.
--
-- Rode DEPOIS do 01_migrations.sql, no mesmo projeto descartavel.
--
-- Confere o que o 005 sozinho nao prova: que um usuario nao ve a agenda de contas
-- do outro, que a view scheduled_transactions_effective respeita a RLS da tabela
-- base (view comum rodaria com o privilegio do dono e devolveria a agenda inteira)
-- e que o banco recusa conta marcada como paga sem transacao e ocorrencia
-- duplicada da mesma regra. Tudo dentro de BEGIN/ROLLBACK.
--
-- O QUE ESPERAR: uma unica linha "CONTAS PREVISTAS: TUDO OK".
-- =====================================================

-- =====================================================
-- Teste das contas previstas e gastos fixos (005)
-- =====================================================
-- Responde tres perguntas que o 005 sozinho nao prova:
--   1. um usuario enxerga a agenda de contas de outro?
--   2. a view scheduled_transactions_effective respeita a RLS da tabela base?
--   3. as invariantes de dinheiro (paga sem transacao, ocorrencia duplicada)
--      sao recusadas pelo banco, e nao apenas pelo app?
--
-- Rodar num banco limpo, depois de 001 -> 002 -> 003 -> 004 -> 005:
--   psql "$DB_URL" -f database/tests/scheduled_rls_test.sql
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

-- =====================================================
-- Fixture
-- =====================================================
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a0', 'a@sched.local'),
  ('bbbbbbbb-0000-0000-0000-0000000000b0', 'b@sched.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a0', 'Usuario A', FALSE),
  ('bbbbbbbb-0000-0000-0000-0000000000b0', 'Usuario B', FALSE);

INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  ('a0000000-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000a0', 'Conta A', 'checking');

-- Grupo da viagem: o trigger add_group_creator poe o A como admin; o B entra
-- como membro ativo (inserido aqui como superusuario, o caminho do convite ja
-- e coberto pelo rls_isolation_test).
INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('a0000000-0000-0000-0000-0000000000c2', 'Viagem Chile', 'aaaaaaaa-0000-0000-0000-0000000000a0');

INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('a0000000-0000-0000-0000-0000000000c2', 'bbbbbbbb-0000-0000-0000-0000000000b0', 'member', 'active');

-- b9db286c-... e a categoria do seed de referencia que o 001_baseline.sql
-- carrega (a mesma usada pelo rls_isolation_test). Repetida por extenso em vez
-- de um \set porque o bundle do SQL Editor so traduz o \set ON_ERROR_STOP.

-- Gasto fixo pessoal do A: aluguel, todo dia 10.
INSERT INTO public.recurring_rules
  (id, user_id, category_id, account_id, description, amount, frequency, due_day)
VALUES
  ('a0000000-0000-0000-0000-0000000000c3', 'aaaaaaaa-0000-0000-0000-0000000000a0',
   'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0000000-0000-0000-0000-0000000000c1',
   'Aluguel', 2500.00, 'monthly', 10);

-- Duas ocorrencias pessoais: uma vencida, uma futura.
INSERT INTO public.scheduled_transactions
  (id, user_id, recurring_rule_id, category_id, account_id, description, amount, due_date)
VALUES
  ('a0000000-0000-0000-0000-0000000000c4', 'aaaaaaaa-0000-0000-0000-0000000000a0',
   'a0000000-0000-0000-0000-0000000000c3', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0000000-0000-0000-0000-0000000000c1',
   'Aluguel', 2500.00, CURRENT_DATE - 5),
  ('a0000000-0000-0000-0000-0000000000c5', 'aaaaaaaa-0000-0000-0000-0000000000a0',
   'a0000000-0000-0000-0000-0000000000c3', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a0000000-0000-0000-0000-0000000000c1',
   'Aluguel', 2500.00, CURRENT_DATE + 25);

-- Uma conta prevista do grupo da viagem, criada pelo A.
INSERT INTO public.scheduled_transactions
  (id, user_id, group_id, category_id, description, amount, due_date)
VALUES
  ('a0000000-0000-0000-0000-0000000000c6', 'aaaaaaaa-0000-0000-0000-0000000000a0',
   'a0000000-0000-0000-0000-0000000000c2', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'Hotel Santiago', 1800.00, CURRENT_DATE + 10);

-- =====================================================
-- 1. Invariantes de dinheiro, conferidas pelo banco
-- =====================================================
-- 'paid' sem transacao real e o estado que faz a mesma despesa ser contada
-- duas vezes (uma prevista, uma realizada) ou nenhuma. O app nunca deveria
-- gravar assim; a constraint existe para quando ele gravar.
DO $$
BEGIN
  UPDATE public.scheduled_transactions
     SET status = 'paid', paid_date = CURRENT_DATE
   WHERE id = 'a0000000-0000-0000-0000-0000000000c4';
  RAISE EXCEPTION 'FALHA: aceitou marcar como paga sem transaction_id';
EXCEPTION
  WHEN check_violation THEN
    RAISE NOTICE 'ok: paga sem transacao recusada pelo banco';
END $$;

-- A geracao de ocorrencias roda toda vez que a tela abre. Sem o indice unico,
-- abrir a tela duas vezes duplicaria o aluguel de outubro.
DO $$
BEGIN
  INSERT INTO public.scheduled_transactions
    (user_id, recurring_rule_id, category_id, description, amount, due_date)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a0',
          'a0000000-0000-0000-0000-0000000000c3',
          'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
          'Aluguel', 2500.00, CURRENT_DATE - 5);
  RAISE EXCEPTION 'FALHA: a mesma regra materializou o mesmo vencimento duas vezes';
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'ok: ocorrencia duplicada da mesma regra recusada';
END $$;

-- Lancamento avulso (sem regra) pode repetir no mesmo dia: duas contas de luz
-- no mesmo vencimento sao legitimas. O indice parcial existe para nao proibir.
INSERT INTO public.scheduled_transactions
  (user_id, category_id, description, amount, due_date)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000a0', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
        'Avulsa 1', 10.00, CURRENT_DATE + 1),
       ('aaaaaaaa-0000-0000-0000-0000000000a0', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
        'Avulsa 2', 20.00, CURRENT_DATE + 1);

SELECT pg_temp.expect('avulsas no mesmo dia sao permitidas',
  (SELECT count(*) FROM public.scheduled_transactions
    WHERE recurring_rule_id IS NULL AND due_date = CURRENT_DATE + 1), 2);

-- =====================================================
-- 2. O status vencido e calculado, nunca gravado
-- =====================================================
SELECT pg_temp.expect('nenhuma linha guarda o status overdue',
  (SELECT count(*) FROM public.scheduled_transactions WHERE status = 'overdue'), 0);

SELECT pg_temp.expect('a view aponta a vencida',
  (SELECT count(*) FROM public.scheduled_transactions_effective
    WHERE effective_status = 'overdue'), 1);

SELECT pg_temp.expect('days_until_due negativo na vencida',
  (SELECT days_until_due FROM public.scheduled_transactions_effective
    WHERE id = 'a0000000-0000-0000-0000-0000000000c4')::BIGINT, -5);

-- =====================================================
-- 3. Isolamento: o B nao enxerga a agenda pessoal do A
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-0000000000b0';

SELECT pg_temp.expect('B NAO ve o gasto fixo do A',
  (SELECT count(*) FROM public.recurring_rules), 0);

SELECT pg_temp.expect('B NAO ve as contas pessoais do A',
  (SELECT count(*) FROM public.scheduled_transactions
    WHERE group_id IS NULL), 0);

-- ...mas ve a conta do grupo de que participa. Sem isso, a viagem em grupo
-- nao funciona: so quem cadastrou enxergaria o hotel a pagar.
SELECT pg_temp.expect('B ve a conta prevista do grupo',
  (SELECT count(*) FROM public.scheduled_transactions
    WHERE id = 'a0000000-0000-0000-0000-0000000000c6'), 1);

-- A view e o furo classico: view comum roda com o privilegio do dono e
-- devolveria a agenda inteira. O SET (security_invoker = true) do 005 e o que
-- impede isso, e este e o assert que prova.
SELECT pg_temp.expect('a view nao vaza a agenda do A para o B',
  (SELECT count(*) FROM public.scheduled_transactions_effective), 1);

DO $$
BEGIN
  UPDATE public.scheduled_transactions SET amount = 1
   WHERE id = 'a0000000-0000-0000-0000-0000000000c4';
  IF FOUND THEN
    RAISE EXCEPTION 'FALHA: B alterou a conta prevista do A';
  END IF;
  RAISE NOTICE 'ok: B nao altera conta prevista do A';

  -- Nem a do grupo, que ele so pode LER: quem cadastrou e o dono da linha.
  UPDATE public.scheduled_transactions SET amount = 1
   WHERE id = 'a0000000-0000-0000-0000-0000000000c6';
  IF FOUND THEN
    RAISE EXCEPTION 'FALHA: B alterou a conta do grupo cadastrada pelo A';
  END IF;
  RAISE NOTICE 'ok: B le a conta do grupo mas nao a altera';
END $$;

DO $$
BEGIN
  INSERT INTO public.recurring_rules
    (user_id, category_id, description, amount)
  VALUES ('aaaaaaaa-0000-0000-0000-0000000000a0',
          'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'Forjado', 1.00);
  RAISE EXCEPTION 'FALHA: B criou gasto fixo em nome do A';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: B bloqueado ao criar gasto fixo em nome do A';
END $$;

RESET ROLE;

-- =====================================================
-- 4. anon nao toca em nada disso
-- =====================================================
-- A chave anon vai embutida no bundle JS publico. O 002 rodou
-- GRANT ... ON ALL TABLES antes destas tabelas existirem, e ALL TABLES nao
-- alcanca o futuro -- e por isso que a SECAO 7 do 005 refaz os grants, e este
-- assert e o que provaria a falta deles.
SET LOCAL ROLE anon;

DO $$
BEGIN
  PERFORM 1 FROM public.scheduled_transactions;
  RAISE EXCEPTION 'FALHA: anon leu as contas previstas';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon sem privilegio em scheduled_transactions';
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.recurring_rules;
  RAISE EXCEPTION 'FALHA: anon leu os gastos fixos';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon sem privilegio em recurring_rules';
END $$;

DO $$
BEGIN
  PERFORM 1 FROM public.scheduled_transactions_effective;
  RAISE EXCEPTION 'FALHA: anon leu a view de contas previstas';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon sem privilegio na view';
END $$;

RESET ROLE;

ROLLBACK;

-- Se esta linha aparecer, nenhuma assercao acima abortou o lote: o teste passou.
-- Ela roda DEPOIS do ROLLBACK, ou seja, fora da transacao que foi desfeita.
SELECT 'CONTAS PREVISTAS: TUDO OK -- isolamento, view e invariantes de dinheiro conferidos' AS resultado;
