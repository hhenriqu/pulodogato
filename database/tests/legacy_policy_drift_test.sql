-- =====================================================
-- PULODOGATO - TESTE DE DERIVA DE POLICIES LEGADAS
-- =====================================================
-- Gerado em: 2026-09-19
--
-- O QUE ESTE TESTE PROVA
-- ----------------------
-- O rls_isolation_test.sql roda num banco limpo, onde as unicas policies sao
-- as que o 002 cria. Producao nao e assim: ela pode ter policy criada pelo
-- painel do Supabase, com outro nome, que o `DROP POLICY IF EXISTS` nominal do
-- 002 nunca alcancaria.
--
-- Policies permissivas se somam por OR. Uma unica policy sobrevivente com
-- USING (true) em `authenticated` mantem todo usuario logado lendo os dados de
-- todo mundo - com RLS ligada, com o 002 aplicado, e com a auditoria anonima
-- de scripts/extract-schema.mjs --audit passando verde, porque ela testa sem
-- login e nunca exercita esse caminho.
--
-- Este teste planta exatamente essa policy antes do 002 e exige que ela suma.
--
-- COMO RODAR (ordem importa - este arquivo espera 001 ja aplicado e 002 NAO):
--   psql -f database/tests/00_supabase_shim.sql
--   psql -f database/migrations/001_baseline.sql
--   psql -f database/tests/legacy_policy_drift_test.sql
-- =====================================================

\set ON_ERROR_STOP on

-- ---------- 1. Simular a producao com deriva ----------
-- Nomes copiados do que o painel do Supabase gera por padrao.
ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON public.financial_accounts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable insert for authenticated users only" ON public.financial_accounts
  FOR INSERT TO authenticated WITH CHECK (true);

-- Uma tabela criada direto em producao, fora do 001_baseline.sql: e o caso que
-- a lista fixa de ALTER TABLE da SECAO 3 deixava passar.
CREATE TABLE IF NOT EXISTS public.tabela_fora_do_baseline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  segredo TEXT
);

DO $$
BEGIN
  RAISE NOTICE 'estado simulado: % policies legadas em financial_accounts',
    (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'financial_accounts');
END $$;

-- ---------- 2. Aplicar o 002 por cima ----------
\ir ../migrations/002_rls_lockdown.sql

-- ---------- 3. Assercoes ----------
DO $$
DECLARE
  sobreviventes INT;
  abertas       INT;
  sem_rls       TEXT;
BEGIN
  -- 3.1 nenhuma policy legada pode sobreviver
  SELECT count(*) INTO sobreviventes
    FROM pg_policies
   WHERE schemaname = 'public'
     AND policyname IN (
       'Enable read access for all users',
       'Enable insert for authenticated users only'
     );

  IF sobreviventes > 0 THEN
    RAISE EXCEPTION 'FALHA: % policy(ies) legada(s) sobreviveram ao 002 - vazamento entre usuarios logados continua aberto', sobreviventes;
  END IF;
  RAISE NOTICE 'ok: policies legadas removidas pelo 002';

  -- 3.2 nenhuma policy permissiva irrestrita pode restar.
  -- Qual coluna manda depende do comando: INSERT so tem WITH CHECK (qual e
  -- sempre NULL nela, o que nao e sinal de nada); SELECT e DELETE sao regidos
  -- pelo USING; UPDATE e ALL usam o USING para escolher as linhas alcancadas.
  -- Comparar sempre com `qual` marcaria as 8 policies de INSERT do proprio 002
  -- como abertas, sendo que todas tem WITH CHECK restritivo.
  SELECT count(*) INTO abertas
    FROM pg_policies
   WHERE schemaname = 'public'
     AND permissive = 'PERMISSIVE'
     AND 'authenticated' = ANY (roles)
     AND CASE
           WHEN cmd = 'INSERT'
             THEN with_check IS NULL OR btrim(lower(with_check)) IN ('true', '(true)')
           ELSE qual IS NULL OR btrim(lower(qual)) IN ('true', '(true)')
         END;

  IF abertas > 0 THEN
    RAISE EXCEPTION 'FALHA: % policy(ies) com USING (true) em authenticated', abertas;
  END IF;
  RAISE NOTICE 'ok: nenhuma policy com USING (true) em authenticated';

  -- 3.3 a tabela fora do baseline tambem tem que ter ficado com RLS
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO sem_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

  IF sem_rls IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: tabela(s) sem RLS depois do 002: %', sem_rls;
  END IF;
  RAISE NOTICE 'ok: RLS ligada em todas as tabelas, inclusive a fora do baseline';
END $$;

-- 3.4 prova funcional: com a policy legada removida, B nao le a conta do A.
-- Sem a SECAO 3.1 do 002 este bloco retornaria 1 e o teste falharia aqui.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@teste.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@teste.local', 'Conta A'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@teste.local', 'Conta B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.financial_accounts (user_id, name, account_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Conta secreta do A', 'checking');

-- Mesma forma de personificacao do rls_isolation_test.sql: SET LOCAL dentro de
-- uma transacao. Fora de transacao o psql faz autocommit e o SET LOCAL se perde
-- antes do SELECT seguinte. O 002 traz BEGIN/COMMIT proprios, entao a
-- transacao so pode comecar aqui, depois do \ir.
BEGIN;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';

DO $$
DECLARE
  vistas INT;
BEGIN
  SELECT count(*) INTO vistas
    FROM public.financial_accounts
   WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001';

  IF vistas <> 0 THEN
    RAISE EXCEPTION 'FALHA: B leu % conta(s) do A apesar do 002', vistas;
  END IF;
  RAISE NOTICE 'ok: B NAO le a conta do A (0) mesmo com deriva previa';
END $$;

ROLLBACK;

SELECT 'legacy_policy_drift_test: todas as assercoes passaram' AS resultado;
