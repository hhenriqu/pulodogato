-- =====================================================
-- Teste de isolamento de RLS
-- =====================================================
-- Responde a pergunta do escopo da HMO-117: "um usuario consegue ler dados de
-- outro?". Cria dois usuarios, popula dados de cada um, e assume a identidade
-- de cada um via `request.jwt.claim.sub` (o mesmo claim que auth.uid() le).
--
-- Rodar num banco limpo, depois de 001_baseline.sql e 002_rls_lockdown.sql:
--   psql "$DB_URL" -f database/tests/rls_isolation_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

-- Usuario A e B
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@test.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Usuario A', FALSE),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Usuario B', FALSE);

INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Conta A', 'checking'),
  ('b0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000002', 'Conta B', 'checking');

-- service_id e category_id sao NOT NULL em producao. O baseline reconstruido
-- pela API PostgREST tinha as duas como nulavel, e este fixture nascera sem
-- elas; o baseline extraido por pg_dump (2026-09-21) reintroduziu a
-- constraint e o INSERT passou a falhar. Os UUIDs abaixo sao os do seed de
-- referencia, que o 001_baseline.sql carrega.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, amount, transaction_date, description) VALUES
  ('a0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 100.00, '2026-01-01', 'Segredo do A'),
  ('b0000000-0000-0000-0000-0000000000b2', 'bbbbbbbb-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1',
   '8730cd96-d656-4c48-863e-673e1016a832', 'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 200.00, '2026-01-01', 'Segredo do B');

-- Grupo privado so do A.
-- O membro admin NAO e inserido aqui: o trigger add_group_creator_trigger faz
-- isso sozinho. O baseline antigo nao tinha trigger nenhum, entao este teste
-- inseria a mao; com o baseline extraido por pg_dump o INSERT manual passou a
-- colidir com unique_user_per_group. A assercao logo abaixo cobre o trigger.
INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('a0000000-0000-0000-0000-0000000000a3', 'Grupo do A', 'aaaaaaaa-0000-0000-0000-000000000001');

CREATE OR REPLACE FUNCTION pg_temp.expect(label TEXT, got BIGINT, want BIGINT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- O trigger add_group_creator_trigger entrou no versionamento junto com o
-- baseline extraido por pg_dump. Sem ele o criador do grupo fica de fora de
-- group_members e perde o proprio grupo na tela seguinte -- e, como as
-- policies de grupo do 002 passam por is_group_member(), perde tambem o
-- acesso via RLS. Vale uma assercao propria.
SELECT pg_temp.expect('trigger poe o criador como admin do grupo',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = 'a0000000-0000-0000-0000-0000000000a3'
      AND user_id  = 'aaaaaaaa-0000-0000-0000-000000000001'
      AND role     = 'admin'
      AND status   = 'active'), 1);

-- =====================================================
-- Vira o usuario B
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';

SELECT pg_temp.expect('B ve as proprias contas',
  (SELECT count(*) FROM public.financial_accounts), 1);

SELECT pg_temp.expect('B NAO ve a conta do A',
  (SELECT count(*) FROM public.financial_accounts
   WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0);

SELECT pg_temp.expect('B NAO ve transacao do A',
  (SELECT count(*) FROM public.financial_transactions
   WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0);

SELECT pg_temp.expect('B NAO ve o grupo privado do A',
  (SELECT count(*) FROM public.expense_groups), 0);

SELECT pg_temp.expect('B NAO ve os membros do grupo do A',
  (SELECT count(*) FROM public.group_members
   WHERE group_id = 'a0000000-0000-0000-0000-0000000000a3'), 0);

SELECT pg_temp.expect('B NAO ve o perfil privado do A',
  (SELECT count(*) FROM public.profiles
   WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0);

-- Escrita cruzada tem que falhar
DO $$
BEGIN
  UPDATE public.financial_accounts SET name = 'invadido'
    WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  IF FOUND THEN
    RAISE EXCEPTION 'FALHA: B conseguiu alterar a conta do A';
  END IF;
  RAISE NOTICE 'ok: B nao consegue alterar conta do A';

  DELETE FROM public.financial_transactions
    WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  IF FOUND THEN
    RAISE EXCEPTION 'FALHA: B conseguiu apagar transacao do A';
  END IF;
  RAISE NOTICE 'ok: B nao consegue apagar transacao do A';
END $$;

-- B nao pode forjar transacao em nome do A
DO $$
BEGIN
  INSERT INTO public.financial_transactions (user_id, amount, transaction_date)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 1, '2026-01-01');
  RAISE EXCEPTION 'FALHA: B inseriu transacao em nome do A';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: B bloqueado ao inserir em nome do A';
END $$;

-- B nao pode entrar sozinho no grupo do A, mesmo sabendo o UUID do grupo.
-- Sem esta garantia, qualquer um que descubra o group_id vira membro e passa a
-- ler as transacoes do grupo.
DO $$
BEGIN
  INSERT INTO public.group_members (group_id, user_id, role, status)
  VALUES ('a0000000-0000-0000-0000-0000000000a3',
          'bbbbbbbb-0000-0000-0000-000000000002', 'admin', 'active');
  RAISE EXCEPTION 'FALHA: B entrou no grupo do A sem convite';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: B bloqueado ao se inserir no grupo do A sem convite';
END $$;

RESET ROLE;

-- =====================================================
-- O caminho legitimo continua funcionando
-- =====================================================
-- (1) com convite pendente, B entra
-- invite_method e invite_target sao NOT NULL em producao, e invite_method tem
-- CHECK em ('email','phone','code','request'). As duas colunas faltavam no
-- baseline reconstruido pela API, entao este fixture nascera sem elas.
INSERT INTO public.group_invitations
  (group_id, invited_user_id, invited_by, invite_method, invite_target, status, expires_at)
VALUES ('a0000000-0000-0000-0000-0000000000a3',
        'bbbbbbbb-0000-0000-0000-000000000002',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'email', 'b@test.local',
        'pending', NOW() + INTERVAL '7 days');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';

INSERT INTO public.group_members (group_id, user_id, role, status)
VALUES ('a0000000-0000-0000-0000-0000000000a3',
        'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'active');

SELECT pg_temp.expect('B entra no grupo com convite pendente',
  (SELECT count(*) FROM public.group_members
   WHERE group_id = 'a0000000-0000-0000-0000-0000000000a3'
     AND user_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 1);

SELECT pg_temp.expect('agora B ve o grupo do A',
  (SELECT count(*) FROM public.expense_groups
   WHERE id = 'a0000000-0000-0000-0000-0000000000a3'), 1);

-- ...mas continua sem ver as transacoes PESSOAIS do A
SELECT pg_temp.expect('B, ja membro, NAO ve transacao pessoal do A',
  (SELECT count(*) FROM public.financial_transactions
   WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0);

RESET ROLE;

-- (2) entrar pelo codigo, via RPC
UPDATE public.expense_groups SET group_code = 'ABC123'
  WHERE id = 'a0000000-0000-0000-0000-0000000000a3';
DELETE FROM public.group_members
  WHERE user_id = 'bbbbbbbb-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';

SELECT pg_temp.expect('join_group_by_code aceita o codigo (case-insensitive)',
  (SELECT count(*) FROM public.join_group_by_code('abc123')), 1);

RESET ROLE;

-- Grupo privado (group_type default) => entra como 'pending', nao 'active'
SELECT pg_temp.expect('B entrou como pending em grupo privado',
  (SELECT count(*) FROM public.group_members
   WHERE group_id = 'a0000000-0000-0000-0000-0000000000a3'
     AND user_id = 'bbbbbbbb-0000-0000-0000-000000000002'
     AND status = 'pending'), 1);

-- e como pending ainda NAO enxerga o grupo
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
SELECT pg_temp.expect('B pending ainda NAO ve o grupo',
  (SELECT count(*) FROM public.expense_groups), 0);
RESET ROLE;

-- codigo errado nao entra
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
DO $$
BEGIN
  PERFORM public.join_group_by_code('ZZZZZZ');
  RAISE EXCEPTION 'FALHA: codigo invalido foi aceito';
EXCEPTION
  WHEN no_data_found THEN
    RAISE NOTICE 'ok: codigo invalido rejeitado';
END $$;
RESET ROLE;

-- =====================================================
-- Anonimo nao ve nada, exceto as tabelas de referencia
-- =====================================================
SET LOCAL ROLE anon;

DO $$
DECLARE n BIGINT;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.profiles;
    IF n > 0 THEN RAISE EXCEPTION 'FALHA: anon leu % perfis', n; END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon sem privilegio em profiles';
  END;

  BEGIN
    SELECT count(*) INTO n FROM public.financial_transactions;
    IF n > 0 THEN RAISE EXCEPTION 'FALHA: anon leu % transacoes', n; END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: anon sem privilegio em financial_transactions';
  END;
END $$;

SELECT pg_temp.expect('anon ainda le as categorias de referencia',
  (SELECT count(*) FROM public.transaction_categories), 12);

RESET ROLE;

ROLLBACK;
