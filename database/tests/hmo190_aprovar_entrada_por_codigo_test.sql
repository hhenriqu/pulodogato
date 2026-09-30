-- =====================================================
-- HMO-190: entrar no grupo pelo codigo e ser aprovado
-- =====================================================
-- O relato: o convidado digitou o codigo do grupo privado e o grupo nunca
-- apareceu para ele. A causa nao era o codigo: `join_group_by_code` grava
-- `pending` em grupo privado, e NAO existia caminho nenhum para tirar dali --
-- nem a tela do admin mostrava o pedido (o GET filtrava status = 'active'),
-- nem havia rota de aprovacao. O pedido ficava preso para sempre.
--
-- Este teste fixa o contrato de que as duas rotas novas dependem:
--   1. entrada por codigo em grupo privado nasce `pending` (e invisivel);
--   2. o ADMIN enxerga a linha pendente (senao nao ha o que aprovar);
--   3. o ADMIN consegue promove-la a `active` pela RLS;
--   4. so entao o convidado ve o grupo;
--   5. um membro comum NAO consegue aprovar ninguem.
--
-- Rodar num banco limpo, depois de 001_baseline.sql e 002_rls_lockdown.sql:
--   psql "$DB_URL" -f database/tests/hmo190_aprovar_entrada_por_codigo_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
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

-- DONA = admin do grupo; NOVA = quem digita o codigo; OUTRA = membro comum.
INSERT INTO auth.users (id, email) VALUES
  ('d0d0d0d0-0000-0000-0000-000000000001', 'dona@test.local'),
  ('a0a0a0a0-0000-0000-0000-000000000002', 'nova@test.local'),
  ('c0c0c0c0-0000-0000-0000-000000000003', 'outra@test.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d0d0d0d0-0000-0000-0000-000000000001', 'Dona do grupo', FALSE),
  ('a0a0a0a0-0000-0000-0000-000000000002', 'Convidada', FALSE),
  ('c0c0c0c0-0000-0000-0000-000000000003', 'Membro comum', FALSE);

-- Grupo PRIVADO (o default de expense_groups.group_type, e o caso do relato).
-- O trigger add_group_creator_trigger poe a dona como admin ativa sozinho.
INSERT INTO public.expense_groups (id, name, group_code, group_type, created_by)
VALUES ('60000000-0000-0000-0000-0000000000a3', 'Casa', '3103F9', 'private',
        'd0d0d0d0-0000-0000-0000-000000000001');

INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('60000000-0000-0000-0000-0000000000a3', 'c0c0c0c0-0000-0000-0000-000000000003',
   'member', 'active');

SELECT pg_temp.expect('o grupo nasce privado com a dona como admin ativa',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = '60000000-0000-0000-0000-0000000000a3'
      AND user_id  = 'd0d0d0d0-0000-0000-0000-000000000001'
      AND role = 'admin' AND status = 'active'), 1);

-- =====================================================
-- (1) A convidada entra pelo codigo: nasce `pending`
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0a0a0a0-0000-0000-0000-000000000002';

SELECT pg_temp.expect('o codigo em minuscula tambem entra (a RPC faz UPPER)',
  (SELECT count(*) FROM public.join_group_by_code('3103f9')
    WHERE member_status = 'pending'), 1);

-- Este e o sintoma que o usuario relatou, e ele e CORRETO: pendente nao e
-- membro, entao a RLS esconde o grupo. O defeito estava na ponta do admin.
SELECT pg_temp.expect('a convidada pendente NAO ve o grupo',
  (SELECT count(*) FROM public.expense_groups
    WHERE id = '60000000-0000-0000-0000-0000000000a3'), 0);

RESET ROLE;

-- =====================================================
-- (2) O ADMIN enxerga a linha pendente
-- =====================================================
-- E disto que o GET /api/expense-groups/[groupId] depende ao trocar
-- .eq(status,'active') por .in(status,['active','pending']): se a RLS
-- escondesse a linha, a tela de aprovacao nasceria vazia.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd0d0d0d0-0000-0000-0000-000000000001';

SELECT pg_temp.expect('o admin ve o pedido de entrada',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = '60000000-0000-0000-0000-0000000000a3'
      AND user_id  = 'a0a0a0a0-0000-0000-0000-000000000002'
      AND status   = 'pending'), 1);

-- =====================================================
-- (3) O ADMIN aprova: pending -> active
-- =====================================================
-- Mesma escrita que a rota .../members/[memberId]/approve faz, inclusive o
-- filtro por status = 'pending' que impede reativar quem foi removido.
UPDATE public.group_members SET status = 'active'
  WHERE group_id = '60000000-0000-0000-0000-0000000000a3'
    AND user_id  = 'a0a0a0a0-0000-0000-0000-000000000002'
    AND status   = 'pending';

SELECT pg_temp.expect('a aprovacao do admin gravou de verdade',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = '60000000-0000-0000-0000-0000000000a3'
      AND user_id  = 'a0a0a0a0-0000-0000-0000-000000000002'
      AND status   = 'active'), 1);

RESET ROLE;

-- =====================================================
-- (4) So agora a convidada ve o grupo
-- =====================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0a0a0a0-0000-0000-0000-000000000002';

SELECT pg_temp.expect('depois de aprovada, a convidada ve o grupo',
  (SELECT count(*) FROM public.expense_groups
    WHERE id = '60000000-0000-0000-0000-0000000000a3'), 1);

RESET ROLE;

-- =====================================================
-- (5) Membro comum NAO aprova ninguem
-- =====================================================
-- A rota checa role='admin' na aplicacao; esta assercao prova que a RLS
-- tambem segura, entao um POST direto na API nao contorna a checagem.
-- Uma terceira pessoa pede para entrar, e o membro comum tenta aprovar.
INSERT INTO auth.users (id, email)
  VALUES ('e0e0e0e0-0000-0000-0000-000000000004', 'terceira@test.local');
INSERT INTO public.profiles (id, full_name, is_public)
  VALUES ('e0e0e0e0-0000-0000-0000-000000000004', 'Terceira', FALSE);
INSERT INTO public.group_members (group_id, user_id, role, status)
  VALUES ('60000000-0000-0000-0000-0000000000a3',
          'e0e0e0e0-0000-0000-0000-000000000004', 'member', 'pending');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'c0c0c0c0-0000-0000-0000-000000000003';

UPDATE public.group_members SET status = 'active'
  WHERE group_id = '60000000-0000-0000-0000-0000000000a3'
    AND user_id  = 'e0e0e0e0-0000-0000-0000-000000000004'
    AND status   = 'pending';

RESET ROLE;

SELECT pg_temp.expect('membro comum NAO conseguiu aprovar',
  (SELECT count(*) FROM public.group_members
    WHERE group_id = '60000000-0000-0000-0000-0000000000a3'
      AND user_id  = 'e0e0e0e0-0000-0000-0000-000000000004'
      AND status   = 'active'), 0);

ROLLBACK;
