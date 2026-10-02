-- =====================================================
-- SHIM DO SUPABASE PARA POSTGRES CRU
-- =====================================================
-- NAO RODAR EM UM PROJETO SUPABASE. La tudo isto ja existe, e recriar
-- `auth.uid()` por cima quebraria a autenticacao do projeto inteiro.
--
-- Serve para uma coisa so: permitir que `001_baseline.sql`,
-- `002_rls_lockdown.sql` e `rls_isolation_test.sql` rodem num Postgres vazio
-- (CI, docker local), onde nao existe nem o schema `auth` nem as roles que o
-- Supabase cria.
--
-- Reproduz o minimo de que as migrations dependem:
--   * roles anon / authenticated / service_role
--   * schema auth e auth.users (so as colunas que o baseline referencia)
--   * auth.uid(), lendo o mesmo claim que o GoTrue injeta
--
-- Uso:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/tests/00_supabase_shim.sql
-- =====================================================

BEGIN;

-- Recusa rodar onde o Supabase de verdade ja esta instalado.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin')
     OR EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'supabase_vault') THEN
    RAISE EXCEPTION
      'Este shim e so para Postgres cru. Este banco parece ser um projeto Supabase real.';
  END IF;
END $$;

-- -----------------------------------------------------
-- Roles
-- -----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

-- O dono da conexao precisa poder virar essas roles (SET LOCAL ROLE no teste).
DO $$
BEGIN
  EXECUTE format('GRANT anon, authenticated, service_role TO %I', current_user);
END $$;

-- -----------------------------------------------------
-- Schema auth
-- -----------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

-- Apenas as colunas que as migrations e os testes tocam. O auth.users real do
-- Supabase tem dezenas de colunas a mais, todas irrelevantes aqui.
--
-- `email_confirmed_at` e a condicao de "esta conta existe de verdade" em dois
-- lugares que precisam concordar: `get_user_by_email()` (001) e o trigger de
-- convite da 039. Ela estava FALTANDO aqui, e isso nao aparecia: o corpo do
-- `get_user_by_email` e LANGUAGE sql e foi criado sem reclamar, entao a coluna
-- ausente so viraria erro se algum teste chamasse a funcao -- nenhum chamava.
-- Quem levantou foi o backfill da 039, que roda o SELECT de verdade.
CREATE TABLE IF NOT EXISTS auth.users (
  id                 UUID PRIMARY KEY,
  email              TEXT UNIQUE,
  email_confirmed_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Para o caso de o schema vir de um banco onde o shim antigo ja rodou: o
-- CREATE TABLE acima e IF NOT EXISTS e nao acrescentaria a coluna.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ;

-- Mesmo contrato do auth.uid() do Supabase: le o claim `sub` do JWT da
-- requisicao. O PostgREST publica os claims como GUCs; nos testes o mesmo
-- efeito se obtem com SET LOCAL request.jwt.claim.sub = '<uuid>'.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', TRUE), ''),
    NULLIF((current_setting('request.jwt.claims', TRUE)::jsonb ->> 'sub'), '')
  )::UUID;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', TRUE), ''),
    'authenticated'
  );
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;

COMMIT;
