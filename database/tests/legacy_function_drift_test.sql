-- =====================================================
-- PULODOGATO - TESTE DE DERIVA DE FUNCOES LEGADAS
-- =====================================================
-- Gerado em: 2026-09-21
--
-- O QUE ESTE TESTE PROVA
-- ----------------------
-- Em 2026-09-21 a primeira tentativa de aplicar o 002 em producao parou aqui:
--
--   ERROR: 42725: function public.is_group_member(uuid) is not unique
--   HINT:  Could not choose a best candidate function.
--
-- Producao tinha uma `is_group_member` de outra safra, com um parametro a mais
-- e DEFAULT. CREATE OR REPLACE so substitui a funcao de assinatura identica,
-- entao a antiga sobreviveu ao lado da nova e toda chamada de um argumento nas
-- policies ficou com dois candidatos.
--
-- Deixar a antiga viva tambem nao resolveria: e SECURITY DEFINER com regra de
-- visibilidade propria - a versao plantada abaixo, por exemplo, ignora
-- `status`, entao trataria convidado pendente como membro de fato e vazaria as
-- transacoes do grupo para quem ainda nao entrou.
--
-- Este teste planta a deriva e exige que o 002 termine com uma unica definicao
-- de cada auxiliar: a deste repositorio.
--
-- COMO RODAR (ordem importa - este arquivo espera 001 ja aplicado e 002 NAO):
--   psql -f database/tests/00_supabase_shim.sql
--   psql -f database/migrations/001_baseline.sql
--   psql -f database/tests/legacy_function_drift_test.sql
-- =====================================================

\set ON_ERROR_STOP on

-- ---------- 1. Simular a producao com deriva ----------
-- Assinatura diferente da canonica em duas frentes: parametro extra com
-- DEFAULT (o que cria a ambiguidade) e ausencia do filtro por `status`.
CREATE OR REPLACE FUNCTION public.is_group_member(group_id UUID, user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $legado$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = is_group_member.group_id
      AND gm.user_id = is_group_member.user_id
  );
$legado$;

-- Policy legada que depende da funcao legada. E o que torna a ordem das secoes
-- do 002 obrigatoria: sem dropar a policy antes, o DROP FUNCTION falha com
-- "other objects depend on it".
ALTER TABLE public.group_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for group members" ON public.group_transactions
  FOR SELECT TO authenticated USING (public.is_group_member(group_id));

DO $$
BEGIN
  RAISE NOTICE 'estado simulado: % definicoes de is_group_member',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'is_group_member');
END $$;

-- ---------- 2. Aplicar o 002 por cima ----------
\ir ../migrations/002_rls_lockdown.sql

-- ---------- 3. Assercoes ----------
DO $$
DECLARE
  r          RECORD;
  assinatura TEXT;
BEGIN
  -- 3.1 uma unica definicao por auxiliar, com a assinatura deste repositorio
  FOR r IN
    SELECT unnest(ARRAY[
      'is_group_member', 'is_group_admin',
      'owns_group_member', 'has_pending_invitation'
    ]) AS nome
  LOOP
    SELECT string_agg(p.oid::regprocedure::TEXT, ' | ' ORDER BY p.oid::regprocedure::TEXT)
      INTO assinatura
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = r.nome;

    IF assinatura IS DISTINCT FROM r.nome || '(uuid)' THEN
      RAISE EXCEPTION 'FALHA: % ficou com [%] - esperado apenas %(uuid)',
        r.nome, assinatura, r.nome;
    END IF;
  END LOOP;
  RAISE NOTICE 'ok: auxiliares com definicao unica (a versao legada foi removida)';

  -- 3.2 anon nao executa as auxiliares (sao SECURITY DEFINER: leem
  -- group_members ignorando RLS). authenticated precisa executar, porque as
  -- policies da SECAO 4 as chamam em nome dele.
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('is_group_member', 'is_group_admin', 'owns_group_member',
                         'has_pending_invitation', 'join_group_by_code')
  LOOP
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FALHA: anon pode executar %', r.proname;
    END IF;
    IF NOT has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FALHA: authenticated NAO pode executar % - as policies vao recusar tudo', r.proname;
    END IF;
  END LOOP;
  RAISE NOTICE 'ok: EXECUTE fechado para anon e aberto para authenticated';

  -- 3.3 a policy legada que dependia da funcao legada tem que ter sumido
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public'
                AND policyname = 'Enable read for group members') THEN
    RAISE EXCEPTION 'FALHA: policy legada sobreviveu ao 002';
  END IF;
  RAISE NOTICE 'ok: policy legada dependente removida';
END $$;

-- 3.4 prova funcional: a semantica que vale e a da versao canonica.
-- B tem linha em group_members com status 'pending'. A versao legada dizia
-- "membro" (nao olhava status) e liberaria as transacoes do grupo.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@teste.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@teste.local', 'Conta A'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@teste.local', 'Conta B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Conta A', 'checking');

INSERT INTO public.financial_transactions (id, user_id, account_id, amount, transaction_date, description) VALUES
  ('a0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-0000000000a1', 100.00, '2026-01-01', 'Racha do A');

INSERT INTO public.expense_groups (id, name, created_by) VALUES
  ('a0000000-0000-0000-0000-0000000000a3', 'Grupo do A', 'aaaaaaaa-0000-0000-0000-000000000001');

INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('a0000000-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-000000000001', 'admin', 'active'),
  ('a0000000-0000-0000-0000-0000000000a3', 'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'pending');

INSERT INTO public.group_transactions (group_id, transaction_id, created_by) VALUES
  ('a0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000000a2',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- Personificacao como no legacy_policy_drift_test.sql: SET LOCAL dentro de uma
-- transacao aberta depois do \ir (o 002 traz BEGIN/COMMIT proprios).
BEGIN;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';

DO $$
DECLARE
  vistas INT;
BEGIN
  SELECT count(*) INTO vistas FROM public.group_transactions;
  IF vistas <> 0 THEN
    RAISE EXCEPTION 'FALHA: B (pending) leu % transacao(oes) do grupo', vistas;
  END IF;
  RAISE NOTICE 'ok: convidado pendente NAO le as transacoes do grupo (0)';
END $$;

ROLLBACK;

-- E o membro ativo continua enxergando o proprio grupo (a funcao nova nao pode
-- ter fechado demais).
BEGIN;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

DO $$
DECLARE
  vistas INT;
BEGIN
  SELECT count(*) INTO vistas FROM public.group_transactions;
  IF vistas <> 1 THEN
    RAISE EXCEPTION 'FALHA: membro ativo leu % transacao(oes), esperado 1', vistas;
  END IF;
  RAISE NOTICE 'ok: membro ativo continua lendo as transacoes do grupo (1)';
END $$;

ROLLBACK;

SELECT 'legacy_function_drift_test: todas as assercoes passaram' AS resultado;
