-- =====================================================
-- HMO-125 - VARREDURA DOS TRIGGERS RESTANTES
-- =====================================================
-- O 003 corrige tres funcoes. Esta varredura responde a pergunta que faltava:
-- as OUTRAS funcoes de trigger em SECURITY INVOKER tambem quebram sob a RLS
-- do 002? Testa os fluxos de grupo ponta a ponta como `authenticated`.
--
-- Roda inteiro dentro de uma transacao que termina em ROLLBACK.
--
-- Uso:  psql "$VALIDATION_DB_URL" -f scripts/hmo125-audit-triggers.sql

\pset pager off
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE r (seq int, fluxo text, estado text, obtido text, detalhe text) ON COMMIT DROP;

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('eeeeeeee-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hmo125-g@test.invalid');
INSERT INTO profiles (id, email, full_name)
VALUES ('eeeeeeee-0000-4000-8000-000000000005','hmo125-g@test.invalid','Criador');

INSERT INTO financial_accounts (id, user_id, name, account_type)
VALUES ('ffffffff-0000-4000-8000-000000000006','eeeeeeee-0000-4000-8000-000000000005','Conta teste','checking');

CREATE TEMP TABLE fx ON COMMIT DROP AS
SELECT (SELECT id FROM financial_services LIMIT 1)                      AS service_id,
       (SELECT id FROM transaction_categories WHERE is_expense LIMIT 1) AS category_id;

GRANT SELECT, INSERT ON r TO authenticated;
GRANT SELECT ON fx TO authenticated;

-- O fluxo de grupo so comeca se der para criar o grupo, entao `add_group_creator`
-- entra ja corrigido -- e o que a 004 vai fazer.
ALTER FUNCTION public.add_group_creator() SECURITY DEFINER SET search_path = public, pg_temp;

-- ---- fluxo 1: criar grupo (set_group_code + add_group_creator) ----
DO $$
DECLARE uid uuid := 'eeeeeeee-0000-4000-8000-000000000005';
        gid uuid;
        membros int;
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, true);

  INSERT INTO expense_groups (name, created_by) VALUES ('HMO-125 grupo', uid) RETURNING id INTO gid;
  SELECT count(*) INTO membros FROM group_members WHERE group_id = gid;

  INSERT INTO r VALUES (1, 'criar grupo', 'add_group_creator DEFINER', 'passou',
    'group_members criados = ' || membros);
EXCEPTION WHEN others THEN
  INSERT INTO r VALUES (1, 'criar grupo', 'add_group_creator DEFINER', 'falhou', SQLSTATE||': '||SQLERRM);
END $$;
RESET ROLE;

-- ---- fluxo 2: despesa de grupo, com os triggers de grupo em INVOKER ----
-- Dispara auto_create_group_transaction + sync_transaction_with_group ->
-- group_transactions e group_expense_splits -> calculate_equal_split.
DO $$
DECLARE uid uuid := 'eeeeeeee-0000-4000-8000-000000000005';
        gid uuid;
        gt int; ges int;
BEGIN
  SELECT id INTO gid FROM expense_groups WHERE created_by = uid LIMIT 1;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, true);

  INSERT INTO financial_transactions (user_id, service_id, category_id, description, amount, transaction_date, group_id, account_id)
  SELECT uid, service_id, category_id, 'HMO-125 despesa de grupo', -90.00, CURRENT_DATE, gid,
         'ffffffff-0000-4000-8000-000000000006'
  FROM fx;

  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO gt  FROM group_transactions WHERE group_id = gid;
  SELECT count(*) INTO ges FROM group_expense_splits ges2
    JOIN group_transactions gt2 ON gt2.id = ges2.group_transaction_id WHERE gt2.group_id = gid;

  INSERT INTO r VALUES (2, 'despesa de grupo', 'triggers de grupo em INVOKER (producao hoje)', 'passou',
    'group_transactions=' || gt || ' group_expense_splits=' || ges);
EXCEPTION WHEN others THEN
  INSERT INTO r VALUES (2, 'despesa de grupo', 'triggers de grupo em INVOKER (producao hoje)', 'falhou', SQLSTATE||': '||SQLERRM);
END $$;
RESET ROLE;

-- ---- fluxo 3: saldo da conta (update_account_balance) ----
INSERT INTO r
SELECT 3, 'saldo da conta', 'update_account_balance INVOKER',
       CASE WHEN current_balance = -90.00 THEN 'passou' ELSE 'divergente' END,
       'current_balance = ' || current_balance || ' (esperado -90.00)'
FROM financial_accounts WHERE id = 'ffffffff-0000-4000-8000-000000000006';

SELECT seq, fluxo, estado, obtido, detalhe FROM r ORDER BY seq;

ROLLBACK;

-- Confere que o banco de validacao ficou intacto.
SELECT proname, prosecdef AS security_definer FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND proname IN ('add_group_creator','calculate_split_amount');
SELECT count(*) AS contas_de_teste_restantes FROM financial_accounts WHERE name = 'Conta teste';
