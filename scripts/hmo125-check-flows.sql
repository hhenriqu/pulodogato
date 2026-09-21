-- =====================================================
-- HMO-125 - OS TRES FLUXOS DE USUARIO, COMO `authenticated`
-- =====================================================
-- Nao toca em privilegio nenhum: so exercita os fluxos no estado em que o
-- banco estiver. Serve para rodar ANTES e DEPOIS do 003 + 004 e comparar.
--
-- Roda dentro de uma transacao que termina em ROLLBACK -- nao deixa residuo.
--
-- Uso:  psql "$VALIDATION_DB_URL" -f scripts/hmo125-check-flows.sql

\pset pager off
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE r (seq int, fluxo text, resultado text, detalhe text) ON COMMIT DROP;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
 ('11111111-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hmo125-f1@test.invalid'),
 ('22222222-0000-4000-8000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hmo125-f2@test.invalid'),
 ('33333333-0000-4000-8000-00000000000c','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hmo125-f3@test.invalid');

-- dono e participante ja existem; o fluxo 1 cria o seu proprio profile
INSERT INTO profiles (id, email, full_name) VALUES
 ('22222222-0000-4000-8000-00000000000b','hmo125-f2@test.invalid','Dono'),
 ('33333333-0000-4000-8000-00000000000c','hmo125-f3@test.invalid','Participante');

CREATE TEMP TABLE fx ON COMMIT DROP AS
SELECT (SELECT id FROM financial_services LIMIT 1)                      AS service_id,
       (SELECT id FROM transaction_categories WHERE is_expense LIMIT 1) AS category_id,
       gen_random_uuid()                                                AS tx_id,
       gen_random_uuid()                                                AS split_id;

INSERT INTO financial_transactions (id, user_id, service_id, category_id, description, amount, transaction_date, is_shared)
SELECT tx_id, '22222222-0000-4000-8000-00000000000b', service_id, category_id,
       'HMO-125 despesa pessoal compartilhada', 100.00, CURRENT_DATE, true FROM fx;

INSERT INTO expense_splits (id, transaction_id, participant_id, percentage, amount, status)
SELECT split_id, tx_id, '33333333-0000-4000-8000-00000000000c', 50.00, 50.00, 'pending' FROM fx;

GRANT SELECT, INSERT ON r TO authenticated;
GRANT SELECT ON fx TO authenticated;

-- ---- FLUXO 1: cadastro (useAuth.ts:101 -> insert em profiles) ----
DO $$
DECLARE uid uuid := '11111111-0000-4000-8000-00000000000a'; subs int; lim int;
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, true);
  INSERT INTO profiles (id, email, full_name) VALUES (uid,'hmo125-f1@test.invalid','Novo usuario');
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO subs FROM user_subscriptions WHERE user_id = uid;
  SELECT count(*) INTO lim  FROM user_usage_limits  WHERE user_id = uid;
  INSERT INTO r VALUES (1,'cadastro de usuario','OK',
    'profile + user_subscriptions='||subs||' + user_usage_limits='||lim);
EXCEPTION WHEN others THEN
  INSERT INTO r VALUES (1,'cadastro de usuario','QUEBRADO', SQLSTATE||': '||SQLERRM);
END $$;
RESET ROLE;

-- ---- FLUXO 2: aprovar divisao (splits/route.ts:173) ----
DO $$
DECLARE uid uuid := '33333333-0000-4000-8000-00000000000c'; sid uuid := (SELECT split_id FROM fx); saldo numeric;
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, true);
  UPDATE expense_splits SET status='approved', approved_at=NOW() WHERE id = sid;
  EXECUTE 'RESET ROLE';
  SELECT amount INTO saldo FROM user_balances
   WHERE creditor_id='22222222-0000-4000-8000-00000000000b' AND debtor_id=uid;
  INSERT INTO r VALUES (2,'aprovar divisao','OK','saldo lancado = '||COALESCE(saldo::text,'NENHUM'));
EXCEPTION WHEN others THEN
  INSERT INTO r VALUES (2,'aprovar divisao','QUEBRADO', SQLSTATE||': '||SQLERRM);
END $$;
RESET ROLE;

-- ---- FLUXO 3: criar grupo de despesa ----
DO $$
DECLARE uid uuid := '22222222-0000-4000-8000-00000000000b'; gid uuid; membros int;
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, true);
  INSERT INTO expense_groups (name, created_by) VALUES ('HMO-125 grupo', uid) RETURNING id INTO gid;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO membros FROM group_members WHERE group_id = gid;
  INSERT INTO r VALUES (3,'criar grupo de despesa','OK','group_members criados = '||membros);
EXCEPTION WHEN others THEN
  INSERT INTO r VALUES (3,'criar grupo de despesa','QUEBRADO', SQLSTATE||': '||SQLERRM);
END $$;
RESET ROLE;

SELECT seq, fluxo, resultado, detalhe FROM r ORDER BY seq;

ROLLBACK;
