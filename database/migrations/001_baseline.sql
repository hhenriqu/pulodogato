-- =====================================================
-- PULODOGATO - BASELINE SCHEMA (public)
-- =====================================================
-- Migration: 001_baseline
-- Gerado em: 2026-09-18
-- Projeto de origem: Supabase odxqjvtxsioksguuevqm
--
-- PROVENIENCIA - LEIA ANTES DE CONFIAR NESTE ARQUIVO
-- --------------------------------------------------
-- Este arquivo foi RECONSTRUIDO a partir da API PostgREST de producao
-- (scripts/extract-schema.mjs), nao de um `pg_dump`. Ate a data acima nao
-- havia credencial de Postgres disponivel para rodar o dump real.
--
-- VERIFICADO contra producao:
--   * quais tabelas existem (16) e quais nao existem
--   * o nome exato de cada coluna de cada tabela
--   * o grafo de foreign keys (via embeds do PostgREST)
--   * quais colunas sao ENUM e o nome do tipo ENUM
--   * o conteudo completo do seed (financial_services, transaction_categories)
--
-- INFERIDO (precisa de confirmacao contra o dump real):
--   * tipos exatos, precisao de numeric, NOT NULL, DEFAULT
--   * a lista completa de valores de cada ENUM (so os valores em uso foram
--     observados; os demais vieram do codigo TypeScript)
--   * indices, triggers e funcoes - NAO foram capturados. O codigo chama a
--     RPC `get_user_by_email`, que nao esta reproduzida aqui.
--
-- As politicas de RLS ficam em 002_rls_lockdown.sql, nao neste arquivo.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 1: EXTENSOES
-- =====================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- SECAO 2: TIPOS ENUM
-- =====================================================
-- Nomes dos tipos confirmados em producao. Os valores marcados com (*) foram
-- observados nos dados reais; os demais vieram do codigo da aplicacao.

DO $$ BEGIN
  CREATE TYPE account_type AS ENUM (
    'cash',         -- (*)
    'checking',     -- (*)
    'savings',
    'credit_card',  -- (*)
    'digital',      -- (*)
    'investment'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transaction_financial_type AS ENUM (
    'income',       -- (*)
    'expense',      -- (*)
    'transfer'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_plan_type AS ENUM ('admin', 'free', 'invest', 'trader');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM (
    'active', 'inactive', 'canceled', 'past_due', 'trialing'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================
-- SECAO 3: TABELAS
-- =====================================================

-- profiles: 1:1 com auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name         TEXT,
  email             TEXT,
  phone             TEXT,
  avatar_url        TEXT,
  birth_date        DATE,
  preferences       JSONB DEFAULT '{}'::jsonb,
  allow_connections BOOLEAN DEFAULT TRUE,
  bio               TEXT,
  location          TEXT,
  nickname          TEXT,
  is_public         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- financial_services: tabela de referencia (seed na secao 4)
CREATE TABLE IF NOT EXISTS public.financial_services (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  icon        TEXT,
  color_hex   TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- transaction_categories: tabela de referencia (seed na secao 4)
CREATE TABLE IF NOT EXISTS public.transaction_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id  UUID REFERENCES public.financial_services(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  color_hex   TEXT,
  is_expense  BOOLEAN DEFAULT TRUE,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.financial_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  account_type     account_type NOT NULL,
  bank_name        TEXT,
  last_four_digits TEXT,
  credit_limit     NUMERIC(15,2),
  current_balance  NUMERIC(15,2) DEFAULT 0.00,
  is_active        BOOLEAN DEFAULT TRUE,
  color_hex        TEXT,
  icon             TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expense_groups (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  description        TEXT,
  photo_url          TEXT,
  group_code         TEXT UNIQUE,
  group_type         TEXT DEFAULT 'private',
  default_split_type TEXT DEFAULT 'equal',
  created_by         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_active          BOOLEAN DEFAULT TRUE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES public.expense_groups(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       TEXT DEFAULT 'member',   -- 'admin' | 'member'
  status     TEXT DEFAULT 'active',   -- 'active' | 'pending' | 'left' | 'removed'
  percentage NUMERIC(5,2) DEFAULT 0.00,
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id           UUID REFERENCES public.financial_services(id) ON DELETE SET NULL,
  category_id          UUID REFERENCES public.transaction_categories(id) ON DELETE SET NULL,
  account_id           UUID REFERENCES public.financial_accounts(id) ON DELETE SET NULL,
  group_id             UUID REFERENCES public.expense_groups(id) ON DELETE SET NULL,
  description          TEXT,
  amount               NUMERIC(15,2) NOT NULL,
  transaction_date     DATE NOT NULL,
  transaction_type     transaction_financial_type,
  attachment_url       TEXT,
  notes                TEXT,
  is_shared            BOOLEAN DEFAULT FALSE,
  installment_parent_id UUID,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID NOT NULL REFERENCES public.expense_groups(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES public.financial_transactions(id) ON DELETE CASCADE,
  split_type     TEXT DEFAULT 'equal',
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_expense_splits (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_transaction_id UUID NOT NULL REFERENCES public.group_transactions(id) ON DELETE CASCADE,
  member_id            UUID NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  percentage           NUMERIC(5,2),
  amount               NUMERIC(15,2),
  status               TEXT DEFAULT 'pending',
  approved_at          TIMESTAMPTZ,
  comments             TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_member_proportions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              UUID NOT NULL REFERENCES public.expense_groups(id) ON DELETE CASCADE,
  member_id             UUID NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  proportion_percentage NUMERIC(5,2),
  calculation_month     DATE,
  is_active             BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.group_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES public.expense_groups(id) ON DELETE CASCADE,
  invited_user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  invited_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status          TEXT DEFAULT 'pending',
  invite_method   TEXT,
  invite_target   TEXT,
  message         TEXT,
  expires_at      TIMESTAMPTZ,
  responded_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expense_splits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.financial_transactions(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount         NUMERIC(15,2),
  percentage     NUMERIC(5,2),
  status         TEXT DEFAULT 'pending',
  approved_at    TIMESTAMPTZ,
  comments       TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.transaction_installments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id           UUID REFERENCES public.expense_groups(id) ON DELETE SET NULL,
  account_id         UUID REFERENCES public.financial_accounts(id) ON DELETE SET NULL,
  category_id        UUID REFERENCES public.transaction_categories(id) ON DELETE SET NULL,
  total_amount       NUMERIC(15,2),
  description        TEXT,
  notes              TEXT,
  installment_number INTEGER,
  total_installments INTEGER,
  due_date           DATE,
  paid_date          DATE,
  is_active          BOOLEAN DEFAULT TRUE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_balances (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creditor_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  debtor_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount       NUMERIC(15,2) DEFAULT 0.00,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (creditor_id, debtor_id)
);

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan                 user_plan_type NOT NULL DEFAULT 'free',
  status               subscription_status NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  trial_end            TIMESTAMPTZ,
  payment_method       TEXT,
  metadata             JSONB DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id)
);

-- Nota: em producao esta tabela NAO tem coluna `id` nem `created_at`.
-- A PK e o proprio user_id.
CREATE TABLE IF NOT EXISTS public.user_usage_limits (
  user_id                UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_transactions   INTEGER DEFAULT 0,
  current_accounts       INTEGER DEFAULT 0,
  current_categories     INTEGER DEFAULT 0,
  current_portfolios     INTEGER DEFAULT 0,
  current_expense_groups INTEGER DEFAULT 0,
  max_transactions       INTEGER,
  max_accounts           INTEGER,
  max_categories         INTEGER,
  max_portfolios         INTEGER,
  max_expense_groups     INTEGER,
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- SECAO 4: INDICES
-- =====================================================
-- Inferidos a partir dos padroes de consulta do codigo. Os indices reais de
-- producao nao foram capturados - confirmar contra o dump.

CREATE INDEX IF NOT EXISTS idx_financial_accounts_user       ON public.financial_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_user   ON public.financial_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_date   ON public.financial_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_group  ON public.financial_transactions(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group           ON public.group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user            ON public.group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_transactions_group      ON public.group_transactions(group_id);
CREATE INDEX IF NOT EXISTS idx_group_expense_splits_member   ON public.group_expense_splits(member_id);
CREATE INDEX IF NOT EXISTS idx_group_invitations_target      ON public.group_invitations(invite_target);
CREATE INDEX IF NOT EXISTS idx_expense_splits_participant    ON public.expense_splits(participant_id);
CREATE INDEX IF NOT EXISTS idx_transaction_installments_user ON public.transaction_installments(user_id);

-- =====================================================
-- SECAO 5: SEED - DADOS DE REFERENCIA
-- =====================================================
-- Extraido integralmente de producao em 2026-09-18. Os UUIDs sao preservados
-- de proposito: ha dados de producao apontando para eles.

INSERT INTO public.financial_services (id, name, description, icon, color_hex, is_active) VALUES
  ('8730cd96-d656-4c48-863e-673e1016a832', 'personal_finance', 'Finanças Pessoais',  'wallet',      '#10B981', TRUE),
  ('28061401-f767-48e4-85d5-9462783b4cb8', 'investments',      'Investimentos',      'trending-up', '#F59E0B', TRUE),
  ('1ffa145a-0c38-42b5-a7a4-228097bea865', 'goals',            'Metas Financeiras',  'target',      '#8B5CF6', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.transaction_categories (id, service_id, name, description, icon, color_hex, is_expense, is_active) VALUES
  ('b9db286c-ce4f-4fbe-b0bf-f3133185f90f', '8730cd96-d656-4c48-863e-673e1016a832', 'Alimentação',   'Gastos com comida e restaurantes',  'utensils',        '#EF4444', TRUE,  TRUE),
  ('49d97f81-6f07-4e6d-9822-75167b8426b2', '8730cd96-d656-4c48-863e-673e1016a832', 'Transporte',    'Uber, gasolina, transporte público','car',             '#F97316', TRUE,  TRUE),
  ('ef656abf-50f0-4cd7-8e96-15cbe4eaac26', '8730cd96-d656-4c48-863e-673e1016a832', 'Compras',       'Roupas, eletrônicos, diversos',     'shopping-bag',    '#8B5CF6', TRUE,  TRUE),
  ('57726de2-7a27-493b-b010-04814a7475c4', '8730cd96-d656-4c48-863e-673e1016a832', 'Lazer',         'Cinema, shows, viagens',            'gamepad-2',       '#06B6D4', TRUE,  TRUE),
  ('c962941b-1aa5-4ae9-9103-d3e5ab8c98e5', '8730cd96-d656-4c48-863e-673e1016a832', 'Saúde',         'Médicos, remédios, academia',       'heart',           '#EC4899', TRUE,  TRUE),
  ('b61d7949-2abc-430d-9bd0-02a146c1d9d8', '8730cd96-d656-4c48-863e-673e1016a832', 'Moradia',       'Aluguel, contas da casa',           'home',            '#84CC16', TRUE,  TRUE),
  ('7802239b-2617-4dc7-a79b-4830bcbda3b0', '8730cd96-d656-4c48-863e-673e1016a832', 'Educação',      'Cursos, livros, materiais',         'graduation-cap',  '#3B82F6', TRUE,  TRUE),
  ('499636db-7c96-4dae-a807-f95011b3ae8c', '8730cd96-d656-4c48-863e-673e1016a832', 'Serviços',      'Assinatura, taxas, manutenções',    'settings',        '#6B7280', TRUE,  TRUE),
  ('d93a6d01-3b70-4c54-af08-e8b56b09fb9e', '8730cd96-d656-4c48-863e-673e1016a832', 'Salário',       'Renda do trabalho',                 'briefcase',       '#10B981', FALSE, TRUE),
  ('bdb788d6-f1fa-48d0-94ee-b97beca29064', '8730cd96-d656-4c48-863e-673e1016a832', 'Freelance',     'Trabalhos extras',                  'laptop',          '#F59E0B', FALSE, TRUE),
  ('8269d16f-f5c3-42c4-9ec8-dbcdcb823a61', '8730cd96-d656-4c48-863e-673e1016a832', 'Investimentos', 'Dividendos, juros, ganhos',         'trending-up',     '#8B5CF6', FALSE, TRUE),
  ('ed1c5e94-208e-45d8-a436-a772927e6a27', '8730cd96-d656-4c48-863e-673e1016a832', 'Outros',        'Receitas diversas',                 'plus-circle',     '#6B7280', FALSE, TRUE)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- =====================================================
-- PROXIMO PASSO OBRIGATORIO: rodar 002_rls_lockdown.sql
-- Sem ele o schema fica sem RLS e qualquer portador da chave anon le e
-- escreve tudo. Ver database/README.md.
-- =====================================================
