-- =====================================================
-- HMO-125 - PROVA DE EXECUCAO DO 003
-- =====================================================
-- O HMO-123 provou a cadeia por catalogo (pg_proc / pg_policies), nao por
-- execucao: o papel `paperclip_ro` e so-leitura, nao da para rodar um INSERT
-- de teste em producao.
--
-- Este script fecha essa lacuna no projeto de validacao, onde existe o papel
-- `postgres`. Ele roda os dois fluxos quebrados como `authenticated` de
-- verdade -- primeiro com as funcoes em SECURITY INVOKER (o estado que esta
-- em producao hoje), depois em SECURITY DEFINER (o que o 003 faz).
--
-- Tudo acontece dentro de UMA transacao que termina em ROLLBACK. DDL no
-- Postgres e transacional, entao nem os ALTER FUNCTION nem as linhas de
-- fixture sobrevivem: o banco de validacao fica exatamente como estava.
--
-- Os ALTER de ida sao desfeitos por um ALTER de volta explicito, e nao por
-- ROLLBACK TO SAVEPOINT, porque o savepoint tambem apagaria as linhas de
-- resultado gravadas pelo proprio teste.
--
-- Uso:  psql "$VALIDATION_DB_URL" -f scripts/hmo125-prove-003.sql

\pset pager off
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE results (
  seq      int,
  cenario  text,
  estado   text,
  esperado text,
  obtido   text,
  detalhe  text
) ON COMMIT DROP;

-- ---------------------------------------------------------------
-- Fixture. Criada como `postgres` (BYPASSRLS) de proposito: o que
-- esta sob teste e a escrita do trigger, nao a montagem do cenario.
-- ---------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hmo125-a@test.invalid'),
       ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hmo125-b@test.invalid'),
       ('cccccccc-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hmo125-own@test.invalid'),
       ('dddddddd-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hmo125-part@test.invalid');

-- Os dois usuarios do cenario 2 ja precisam de profile pronto.
INSERT INTO profiles (id, email, full_name)
VALUES ('cccccccc-0000-4000-8000-000000000003', 'hmo125-own@test.invalid',  'Dono da despesa'),
       ('dddddddd-0000-4000-8000-000000000004', 'hmo125-part@test.invalid', 'Participante');

CREATE TEMP TABLE fixture ON COMMIT DROP AS
SELECT (SELECT id FROM financial_services LIMIT 1)                      AS service_id,
       (SELECT id FROM transaction_categories WHERE is_expense LIMIT 1) AS category_id,
       gen_random_uuid()                                                AS tx_id,
       gen_random_uuid()                                                AS split_1;

-- Despesa PESSOAL (sem group_id) do usuario `own`, dividida com `part`.
INSERT INTO financial_transactions (id, user_id, service_id, category_id, description, amount, transaction_date, is_shared)
SELECT tx_id, 'cccccccc-0000-4000-8000-000000000003', service_id, category_id,
       'HMO-125 despesa compartilhada', 100.00, CURRENT_DATE, true
FROM fixture;

INSERT INTO expense_splits (id, transaction_id, participant_id, percentage, amount, status)
SELECT split_1, tx_id, 'dddddddd-0000-4000-8000-000000000004', 50.00, 50.00, 'pending' FROM fixture;

-- Os blocos de teste rodam como `authenticated` e precisam gravar o que
-- observaram. Isto e instrumentacao do teste, nao parte do cenario.
GRANT SELECT, INSERT ON results TO authenticated;
GRANT SELECT ON fixture TO authenticated;

-- ===============================================================
-- CENARIO 1 - CADASTRO  (profiles -> create_free_subscription)
-- ===============================================================

-- ---- 1A: estado de producao hoje (SECURITY INVOKER) ----
ALTER FUNCTION public.create_free_subscription() SECURITY INVOKER;

DO $$
DECLARE uid uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', uid, 'role', 'authenticated')::text, true);

  INSERT INTO profiles (id, email, full_name) VALUES (uid, 'hmo125-a@test.invalid', 'Usuario A');

  INSERT INTO results VALUES (1, 'cadastro', 'SECURITY INVOKER (producao hoje)',
    'falha', 'passou', 'cadastro concluiu -- nao reproduziu a quebra');
EXCEPTION WHEN others THEN
  INSERT INTO results VALUES (1, 'cadastro', 'SECURITY INVOKER (producao hoje)',
    'falha', 'falhou', SQLSTATE || ': ' || SQLERRM);
END $$;
RESET ROLE;

-- ---- 1B: com o 003 aplicado (SECURITY DEFINER) ----
ALTER FUNCTION public.create_free_subscription()
  SECURITY DEFINER SET search_path = public, pg_temp;

DO $$
DECLARE uid uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', uid, 'role', 'authenticated')::text, true);

  INSERT INTO profiles (id, email, full_name) VALUES (uid, 'hmo125-b@test.invalid', 'Usuario B');

  INSERT INTO results VALUES (2, 'cadastro', 'SECURITY DEFINER (com o 003)',
    'passa', 'passou', 'insert em profiles aceito');
EXCEPTION WHEN others THEN
  INSERT INTO results VALUES (2, 'cadastro', 'SECURITY DEFINER (com o 003)',
    'passa', 'falhou', SQLSTATE || ': ' || SQLERRM);
END $$;
RESET ROLE;

-- As linhas derivadas tem que existir de verdade, nao so "nao deu erro".
INSERT INTO results
SELECT 3, 'cadastro', 'SECURITY DEFINER (com o 003)', 'linhas derivadas criadas',
       CASE WHEN subs = 1 AND lim = 1 THEN 'ok' ELSE 'faltando' END,
       'user_subscriptions=' || subs || ' user_usage_limits=' || lim || ' plano=' || COALESCE(plano, 'n/a')
FROM (
  SELECT (SELECT count(*)   FROM user_subscriptions WHERE user_id = 'bbbbbbbb-0000-4000-8000-000000000002') AS subs,
         (SELECT count(*)   FROM user_usage_limits  WHERE user_id = 'bbbbbbbb-0000-4000-8000-000000000002') AS lim,
         (SELECT plan::text FROM user_subscriptions WHERE user_id = 'bbbbbbbb-0000-4000-8000-000000000002') AS plano
) q;

-- ===============================================================
-- CENARIO 2 - APROVAR DIVISAO  (expense_splits -> update_user_balances)
-- ===============================================================
-- O participante aprova a propria divisao, que e o que
-- app/api/personal-finance/splits/route.ts:173 faz com o JWT do usuario.

-- ---- 2A: estado de producao hoje (SECURITY INVOKER) ----
ALTER FUNCTION public.update_user_balances() SECURITY INVOKER;

DO $$
DECLARE uid uuid := 'dddddddd-0000-4000-8000-000000000004';
        sid uuid := (SELECT split_1 FROM fixture);
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', uid, 'role', 'authenticated')::text, true);

  UPDATE expense_splits SET status = 'approved', approved_at = NOW() WHERE id = sid;

  INSERT INTO results VALUES (4, 'aprovar divisao', 'SECURITY INVOKER (producao hoje)',
    'falha', 'passou', 'aprovacao concluiu -- nao reproduziu a quebra');
EXCEPTION WHEN others THEN
  INSERT INTO results VALUES (4, 'aprovar divisao', 'SECURITY INVOKER (producao hoje)',
    'falha', 'falhou', SQLSTATE || ': ' || SQLERRM);
END $$;
RESET ROLE;

-- ---- 2B: com o 003 aplicado, e SO o 003 ----
ALTER FUNCTION public.update_user_balances()
  SECURITY DEFINER SET search_path = public, pg_temp;

DO $$
DECLARE uid uuid := 'dddddddd-0000-4000-8000-000000000004';
        sid uuid := (SELECT split_1 FROM fixture);
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', uid, 'role', 'authenticated')::text, true);

  UPDATE expense_splits SET status = 'approved', approved_at = NOW() WHERE id = sid;

  INSERT INTO results VALUES (5, 'aprovar divisao', 'SECURITY DEFINER so nas 3 do 003',
    'passa', 'passou', 'update em expense_splits aceito');
EXCEPTION WHEN others THEN
  INSERT INTO results VALUES (5, 'aprovar divisao', 'SECURITY DEFINER so nas 3 do 003',
    'passa', 'falhou', SQLSTATE || ': ' || SQLERRM);
END $$;
RESET ROLE;

-- ---- 2C: o 003 mais `calculate_split_amount` ----
-- `calculate_split_amount` e um BEFORE UPDATE na mesma tabela e tambem e
-- SECURITY INVOKER. Ele le `financial_transactions` para recalcular o valor,
-- mas o participante nao enxerga a despesa PESSOAL do dono pela policy de
-- SELECT. O SELECT ... INTO nao acha linha, deixa NEW.amount NULL e a
-- aprovacao morre no NOT NULL -- depois do 003 e por outro motivo.
ALTER FUNCTION public.calculate_split_amount()
  SECURITY DEFINER SET search_path = public, pg_temp;

DO $$
DECLARE uid uuid := 'dddddddd-0000-4000-8000-000000000004';
        sid uuid := (SELECT split_1 FROM fixture);
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', uid, 'role', 'authenticated')::text, true);

  UPDATE expense_splits SET status = 'approved', approved_at = NOW() WHERE id = sid;

  INSERT INTO results VALUES (6, 'aprovar divisao', '003 + calculate_split_amount',
    'passa', 'passou', 'update em expense_splits aceito');
EXCEPTION WHEN others THEN
  INSERT INTO results VALUES (6, 'aprovar divisao', '003 + calculate_split_amount',
    'passa', 'falhou', SQLSTATE || ': ' || SQLERRM);
END $$;
RESET ROLE;

INSERT INTO results
SELECT 7, 'aprovar divisao', '003 + calculate_split_amount', 'saldo lancado',
       CASE WHEN cnt = 1 THEN 'ok' ELSE 'faltando' END,
       'user_balances=' || cnt || ' amount=' || COALESCE(amt::text, 'n/a')
FROM (
  SELECT count(*) AS cnt, max(amount) AS amt FROM user_balances
   WHERE creditor_id = 'cccccccc-0000-4000-8000-000000000003'
     AND debtor_id   = 'dddddddd-0000-4000-8000-000000000004'
) q;

-- ===============================================================
-- CENARIO 4 - REJEITAR DIVISAO: A PERDA SILENCIOSA DE VERDADE
-- ===============================================================
-- O caminho de rejeicao de update_user_balances faz UPDATE e DELETE em
-- user_balances. Diferente das outras tabelas derivadas, `authenticated` TEM
-- os grants de UPDATE/DELETE em user_balances -- falta so a policy. Sob RLS
-- isso nao da erro: afeta zero linhas. O saldo fica inflado e ninguem ve.

-- Uma segunda divisao, ja aprovada pelo `postgres`, para ter saldo em pe.
INSERT INTO expense_splits (id, transaction_id, participant_id, percentage, amount, status, approved_at)
SELECT gen_random_uuid(), tx_id, 'bbbbbbbb-0000-4000-8000-000000000002', 50.00, 50.00, 'approved', NOW()
FROM fixture;

-- ---- 4A: rejeicao com update_user_balances em SECURITY INVOKER ----
ALTER FUNCTION public.update_user_balances() SECURITY INVOKER;

DO $$
DECLARE uid uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
        sid uuid;
        saldo numeric;
BEGIN
  SELECT id INTO sid FROM expense_splits WHERE participant_id = uid;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', uid, 'role', 'authenticated')::text, true);

  UPDATE expense_splits SET status = 'rejected' WHERE id = sid;

  EXECUTE 'RESET ROLE';
  SELECT amount INTO saldo FROM user_balances
   WHERE creditor_id = 'cccccccc-0000-4000-8000-000000000003' AND debtor_id = uid;

  INSERT INTO results VALUES (9, 'rejeitar divisao', 'SECURITY INVOKER (producao hoje)',
    'saldo zerado', CASE WHEN saldo IS NULL THEN 'zerado' ELSE 'ainda ' || saldo END,
    'rejeicao NAO deu erro, mas o saldo nao foi estornado -- corrupcao silenciosa');
EXCEPTION WHEN others THEN
  INSERT INTO results VALUES (9, 'rejeitar divisao', 'SECURITY INVOKER (producao hoje)',
    'saldo zerado', 'erro', SQLSTATE || ': ' || SQLERRM);
END $$;
RESET ROLE;

-- ---- 4B: a mesma rejeicao com o 003 ----
ALTER FUNCTION public.update_user_balances()
  SECURITY DEFINER SET search_path = public, pg_temp;

DO $$
DECLARE uid uuid := 'dddddddd-0000-4000-8000-000000000004';
        sid uuid := (SELECT split_1 FROM fixture);
        saldo numeric;
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', uid, 'role', 'authenticated')::text, true);

  UPDATE expense_splits SET status = 'rejected' WHERE id = sid;

  EXECUTE 'RESET ROLE';
  SELECT amount INTO saldo FROM user_balances
   WHERE creditor_id = 'cccccccc-0000-4000-8000-000000000003' AND debtor_id = uid;

  INSERT INTO results VALUES (10, 'rejeitar divisao', 'SECURITY DEFINER (com o 003)',
    'saldo zerado', CASE WHEN saldo IS NULL THEN 'zerado' ELSE 'ainda ' || saldo END,
    'estorno aplicado e linha removida');
EXCEPTION WHEN others THEN
  INSERT INTO results VALUES (10, 'rejeitar divisao', 'SECURITY DEFINER (com o 003)',
    'saldo zerado', 'erro', SQLSTATE || ': ' || SQLERRM);
END $$;
RESET ROLE;

-- ===============================================================
-- CENARIO 3 - GRANT vs POLICY
-- ===============================================================
-- update_usage_limits_on_plan_change faz UPDATE em user_usage_limits, que so
-- tem policy de SELECT. Sob RLS um UPDATE sem policy nao levanta erro: ele
-- so nao acha linha nenhuma. Aqui a diferenca aparece como numero de linhas
-- afetadas, nao como excecao -- por isso este e o mais perigoso dos tres.
DO $$
DECLARE afetadas int;
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'bbbbbbbb-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);

  UPDATE user_usage_limits SET max_transactions = 999
   WHERE user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  GET DIAGNOSTICS afetadas = ROW_COUNT;

  INSERT INTO results VALUES (8, 'troca de plano (latente)', 'RLS so com policy de SELECT',
    '0 linhas e nenhum erro', afetadas || ' linhas, sem erro',
    'UPDATE bloqueado pela RLS nao da erro -- os limites ficariam errados em silencio');
EXCEPTION WHEN others THEN
  INSERT INTO results VALUES (8, 'troca de plano (latente)', 'RLS so com policy de SELECT',
    '0 linhas e nenhum erro', 'erro', SQLSTATE || ': ' || SQLERRM);
END $$;
RESET ROLE;

-- ===============================================================
-- RESULTADO
-- ===============================================================
SELECT seq, cenario, estado, esperado, obtido, detalhe FROM results ORDER BY seq;

-- Nada aqui e para durar.
ROLLBACK;

-- Confere, ja fora da transacao, que o banco de validacao ficou intacto.
SELECT p.proname, p.prosecdef AS security_definer, p.proconfig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('create_free_subscription', 'update_user_balances',
                     'update_usage_limits_on_plan_change', 'calculate_split_amount')
 ORDER BY 1;

SELECT count(*) AS usuarios_de_teste_restantes FROM auth.users WHERE email LIKE 'hmo125-%@test.invalid';
