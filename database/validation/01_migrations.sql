-- =====================================================
-- PULODOGATO -- VALIDACAO PASSO 1: schema do zero
-- =====================================================
-- GERADO por scripts/gen-validation-bundle.mjs. Nao edite este arquivo:
-- a fonte e database/migrations/*.sql e database/tests/rls_isolation_test.sql.
--
-- Cole este arquivo inteiro no SQL Editor do projeto Supabase DESCARTAVEL e
-- rode. Ele aplica 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008 -> 009 num banco vazio e termina imprimindo uma
-- tabela de verificacoes.
--
-- O QUE FAZER COM O RESULTADO: copie a tabela final (ou tire um print) e cole na
-- issue HMO-117. Se aparecer erro em vermelho, cole o texto do erro -- e ele que
-- diz qual migration nao sobe num Supabase de verdade.
--
-- NUNCA rode isto no projeto de producao (odxqjvtxsioksguuevqm): as migrations
-- criam objetos. A guarda abaixo recusa qualquer banco que ja tenha tabelas em
-- public, o que ja barra producao.
--
-- Depois deste, rode o 02_isolamento_rls.sql.
-- =====================================================


-- ---------------------------------------------------------------------------
-- 0. Guarda: o alvo e mesmo um Supabase descartavel e vazio?
-- ---------------------------------------------------------------------------
DO $guarda$
DECLARE
  faltando TEXT[] := '{}';
  ja_existe BIGINT;
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    faltando := faltando || 'funcao auth.uid()'::TEXT;
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    faltando := faltando || 'tabela auth.users'::TEXT;
  END IF;
  IF (SELECT count(*) FROM pg_roles
       WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    faltando := faltando || 'roles anon/authenticated/service_role'::TEXT;
  END IF;
  -- O 00_supabase_shim.sql do CI tambem cria auth.uid() e as roles. O que ele
  -- NAO tem e o auth.users do GoTrue (3 colunas contra ~30). Sem esta linha,
  -- um Postgres cru + shim passaria na guarda e a validacao viraria uma copia
  -- mais lenta do CI -- justamente o item que ela existe para fechar.
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'auth' AND table_name = 'users'
         AND column_name IN ('encrypted_password', 'raw_app_meta_data')) <> 2 THEN
    faltando := faltando || 'auth.users do GoTrue (o alvo parece um Postgres cru)'::TEXT;
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname = 'supabase_auth_admin') <> 1 THEN
    faltando := faltando || 'role supabase_auth_admin'::TEXT;
  END IF;

  IF array_length(faltando, 1) IS NOT NULL THEN
    RAISE EXCEPTION E'O alvo nao parece um projeto Supabase. Faltou: %\n\nRode este arquivo no SQL Editor do projeto Supabase descartavel.',
      array_to_string(faltando, ', ');
  END IF;

  SELECT count(*) INTO ja_existe
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r';
  IF ja_existe > 0 THEN
    RAISE EXCEPTION E'O schema public ja tem % tabela(s); a validacao precisa comecar do zero.\n\nSe este e mesmo o projeto DESCARTAVEL (nunca o de producao), limpe com:\n  DROP SCHEMA public CASCADE; CREATE SCHEMA public;\ne rode este arquivo de novo.',
      ja_existe;
  END IF;
END
$guarda$;


-- ---------------------------------------------------------------------------
-- 1. 001_baseline.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - BASELINE SCHEMA (public)
-- =====================================================
-- Migration: 001_baseline
-- Gerado em: 2026-09-21
-- Projeto de origem: Supabase odxqjvtxsioksguuevqm
--
-- NAO EDITE ESTE ARQUIVO A MAO.
-- Ele e gerado por `node scripts/gen-baseline.mjs` a partir de um
-- `pg_dump --schema-only` do banco de producao. Edicao manual se perde na
-- proxima geracao -- e, pior, volta a abrir a distancia entre o arquivo e o
-- banco que a HMO-117 existiu para fechar.
--
-- PROVENIENCIA
-- ------------
-- Extraido com pg_dump de producao, pela role de leitura `paperclip_ro`
-- via Session Pooler (HMO-123). Ate 2026-09-21 este arquivo era uma
-- reconstrucao pela API PostgREST, que nao enxerga o catalogo do Postgres:
-- faltavam 2 tabelas, 35 colunas, 23 funcoes, 13 triggers, 1 view, 57 indices
-- e 2 valores do ENUM account_type (`debit_card` e `other`).
--
-- CONTEUDO (178 objetos)
--     4 tipos ENUM
--    18 tabelas
--     1 view
--    23 funcoes
--    13 triggers
--    57 indices
--    28 constraints
--    34 foreign keys
--   + o seed de referencia (database/seed/reference_data.sql)
--
-- O QUE NAO ESTA AQUI, DE PROPOSITO
-- ---------------------------------
-- RLS, policies e as 5 funcoes auxiliares de RLS ficam em
-- 002_rls_lockdown.sql; a correcao de privilegio dos triggers, em
-- 003_fix_trigger_privileges.sql. Aplicar so o 001 deixa o banco SEM RLS.
-- A ordem obrigatoria e 001 -> 002 -> 003. Ver database/README.md.
--
-- NUM POSTGRES CRU (CI, docker local)
-- -----------------------------------
-- Rode antes database/tests/00_supabase_shim.sql, que cria o schema `auth`,
-- `auth.uid()` e as roles anon/authenticated de que este arquivo depende.
-- Num projeto Supabase de verdade o shim NAO deve ser rodado.
-- =====================================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- O pg_dump qualifica tudo com `public.`, entao zerar o search_path elimina
-- qualquer ambiguidade com objeto de mesmo nome em outro schema.
SELECT pg_catalog.set_config('search_path', '', false);

BEGIN;

-- =====================================================
-- EXTENSOES
-- =====================================================
-- O Supabase instala as extensoes no schema `extensions`, e duas colunas
-- (group_invitations.id e schema_migrations.id) tem
-- `DEFAULT extensions.uuid_generate_v4()` gravado no catalogo. Num Postgres
-- cru esse schema nao existe e o CREATE TABLE falha com 3F000.
-- O `WITH SCHEMA` nas duas nao e enfeite: com search_path vazio (acima), um
-- CREATE EXTENSION sem destino explicito para em "no schema has been selected
-- to create in". E e tambem onde o Supabase as instala.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

--
-- Name: account_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_type AS ENUM (
    'checking',
    'savings',
    'credit_card',
    'debit_card',
    'cash',
    'digital',
    'investment',
    'other'
);

--
-- Name: subscription_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subscription_status AS ENUM (
    'active',
    'inactive',
    'canceled',
    'past_due',
    'trialing'
);

--
-- Name: transaction_financial_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.transaction_financial_type AS ENUM (
    'income',
    'expense',
    'transfer'
);

--
-- Name: user_plan_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_plan_type AS ENUM (
    'admin',
    'free',
    'invest',
    'trader'
);

--
-- Name: add_group_creator(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_group_creator() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO group_members (group_id, user_id, role, status, percentage)
    VALUES (NEW.id, NEW.created_by, 'admin', 'active', 0.00);
    RETURN NEW;
END;
$$;

--
-- Name: auto_create_group_transaction(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_create_group_transaction() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    member_count INTEGER;
    split_amount DECIMAL(10,2);
    gt_id UUID;
BEGIN
    -- Se a transação tem group_id e é uma despesa (valor negativo)
    IF NEW.group_id IS NOT NULL AND NEW.amount < 0 THEN
        -- Verificar se já existe group_transaction para esta transação
        IF NOT EXISTS (
            SELECT 1 FROM group_transactions 
            WHERE transaction_id = NEW.id AND group_id = NEW.group_id
        ) THEN
            -- Criar group_transaction e obter ID
            INSERT INTO group_transactions (group_id, transaction_id, split_type, created_by)
            VALUES (NEW.group_id, NEW.id, 'equal', NEW.user_id)
            RETURNING id INTO gt_id;
            
            -- Contar membros ativos do grupo
            SELECT COUNT(*) INTO member_count
            FROM group_members 
            WHERE group_id = NEW.group_id AND status = 'active';
            
            -- Se há membros, criar splits
            IF member_count > 0 THEN
                split_amount := ABS(NEW.amount) / member_count;
                
                -- Criar splits automáticos para membros ativos
                INSERT INTO group_expense_splits (
                    group_transaction_id, 
                    member_id, 
                    amount, 
                    status
                )
                SELECT 
                    gt_id,
                    gm.id,
                    split_amount,
                    'pending'
                FROM group_members gm 
                WHERE gm.group_id = NEW.group_id AND gm.status = 'active';
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

--
-- Name: calculate_equal_split(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_equal_split() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    active_members_count INTEGER;
    transaction_amount DECIMAL(15,2);
    equal_percentage DECIMAL(5,2);
BEGIN
    -- Contar membros ativos do grupo
    SELECT COUNT(*) INTO active_members_count
    FROM group_members gm
    JOIN group_transactions gt ON gt.group_id = gm.group_id
    WHERE gt.id = NEW.group_transaction_id
      AND gm.status = 'active';
    
    -- Buscar valor da transação
    SELECT ABS(ft.amount) INTO transaction_amount
    FROM financial_transactions ft
    JOIN group_transactions gt ON gt.transaction_id = ft.id
    WHERE gt.id = NEW.group_transaction_id;
    
    -- Calcular percentual igual
    IF active_members_count > 0 THEN
        equal_percentage := 100.0 / active_members_count;
        NEW.percentage := equal_percentage;
        NEW.amount := transaction_amount * (equal_percentage / 100.0);
    END IF;
    
    RETURN NEW;
END;
$$;

--
-- Name: calculate_member_proportions(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_member_proportions(p_group_id uuid, p_calculation_month date DEFAULT date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone)) RETURNS TABLE(member_id uuid, user_name text, total_income numeric, proportion_percentage numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    total_group_income DECIMAL(15,2) := 0;
    member_record RECORD;
BEGIN
    -- Calcular total de receitas do grupo
    SELECT COALESCE(SUM(
        CASE 
            WHEN gm.user_id IS NOT NULL THEN
                COALESCE((
                    SELECT SUM(amount) 
                    FROM financial_transactions ft
                    WHERE ft.user_id = gm.user_id 
                      AND ft.transaction_type = 'income'
                      AND DATE_TRUNC('month', ft.transaction_date) = p_calculation_month
                ), 1000)
            ELSE 1000
        END
    ), 0) INTO total_group_income
    FROM group_members gm
    WHERE gm.group_id = p_group_id AND gm.status = 'active';
    
    -- Se total é zero, usar valor mínimo para todos
    IF total_group_income = 0 THEN
        total_group_income := 1000 * (
            SELECT COUNT(*) FROM group_members 
            WHERE group_id = p_group_id AND status = 'active'
        );
    END IF;
    
    -- Calcular proporção de cada membro
    FOR member_record IN 
        SELECT gm.id as member_id, gm.user_id, p.full_name as user_name
        FROM group_members gm
        LEFT JOIN profiles p ON p.id = gm.user_id
        WHERE gm.group_id = p_group_id AND gm.status = 'active'
    LOOP
        DECLARE
            member_income DECIMAL(15,2);
            calculated_percentage DECIMAL(5,2);
        BEGIN
            -- Calcular receita do membro
            SELECT COALESCE(SUM(amount), 1000) INTO member_income
            FROM financial_transactions ft
            WHERE ft.user_id = member_record.user_id
              AND ft.transaction_type = 'income'
              AND DATE_TRUNC('month', ft.transaction_date) = p_calculation_month;
            
            -- Calcular percentual
            calculated_percentage := ROUND((member_income / total_group_income * 100), 2);
            
            -- Inserir ou atualizar proporção
            INSERT INTO group_member_proportions (
                group_id, member_id, calculation_month, 
                total_income, proportion_percentage
            ) VALUES (
                p_group_id, member_record.member_id, p_calculation_month,
                member_income, calculated_percentage
            )
            ON CONFLICT (group_id, member_id, calculation_month)
            DO UPDATE SET
                total_income = EXCLUDED.total_income,
                proportion_percentage = EXCLUDED.proportion_percentage,
                calculated_at = NOW();
            
            -- Retornar resultado
            member_id := member_record.member_id;
            user_name := member_record.user_name;
            total_income := member_income;
            proportion_percentage := calculated_percentage;
            RETURN NEXT;
        END;
    END LOOP;
END;
$$;

--
-- Name: calculate_split_amount(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_split_amount() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    SELECT ABS(amount) * (NEW.percentage / 100.0)
    INTO NEW.amount
    FROM financial_transactions 
    WHERE id = NEW.transaction_id;
    
    RETURN NEW;
END;
$$;

--
-- Name: cleanup_expired_invitations_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_expired_invitations_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    -- Executar limpeza apenas ocasionalmente para não sobrecarregar
    IF random() < 0.1 THEN -- 10% de chance a cada operação
        PERFORM expire_old_invitations();
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$;

--
-- Name: create_default_accounts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_default_accounts(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    -- Verificar se o usuário já tem contas
    IF EXISTS (SELECT 1 FROM financial_accounts WHERE user_id = p_user_id) THEN
        RETURN;
    END IF;
    
    -- Criar contas padrão
    INSERT INTO financial_accounts (user_id, name, account_type, icon, color_hex) VALUES
    (p_user_id, 'Conta Corrente', 'checking', 'building', '#10B981'),
    (p_user_id, 'Cartão de Crédito', 'credit_card', 'credit-card', '#EF4444'),
    (p_user_id, 'Dinheiro', 'cash', 'banknote', '#84CC16'),
    (p_user_id, 'PIX', 'digital', 'smartphone', '#8B5CF6');
END;
$$;

--
-- Name: create_free_subscription(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_free_subscription() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Criar assinatura gratuita
    INSERT INTO user_subscriptions (
        user_id, 
        plan, 
        status,
        current_period_start,
        current_period_end
    ) VALUES (
        NEW.id, 
        'free', 
        'active',
        NOW(),
        NOW() + INTERVAL '100 years' -- Gratuito nunca expira
    );
    
    -- Criar limites de uso
    INSERT INTO user_usage_limits (
        user_id,
        max_transactions,
        max_accounts,
        max_categories,
        max_portfolios,
        max_expense_groups
    ) VALUES (
        NEW.id,
        100,  -- free plan limits
        3,
        20,
        0,
        2
    );
    
    RETURN NEW;
END;
$$;

--
-- Name: create_installments(uuid, uuid, uuid, text, numeric, integer, date, public.transaction_financial_type, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_installments(p_user_id uuid, p_account_id uuid, p_category_id uuid, p_description text, p_total_amount numeric, p_total_installments integer, p_first_due_date date, p_transaction_type public.transaction_financial_type, p_group_id uuid DEFAULT NULL::uuid, p_group_split_type text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) RETURNS uuid[]
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    installment_amount DECIMAL(15,2);
    current_due_date DATE;
    installment_ids UUID[] := ARRAY[]::UUID[];
    new_installment_id UUID;
    parent_id UUID := NULL;
    i INTEGER;
BEGIN
    -- Calcular valor de cada parcela
    installment_amount := ROUND(p_total_amount / p_total_installments, 2);
    
    current_due_date := p_first_due_date;
    
    -- Criar cada parcela
    FOR i IN 1..p_total_installments LOOP
        -- Ajustar valor da última parcela para bater o total exato
        IF i = p_total_installments THEN
            installment_amount := p_total_amount - (installment_amount * (p_total_installments - 1));
        END IF;
        
        -- Inserir parcela
        INSERT INTO transaction_installments (
            user_id, parent_transaction_id, account_id, category_id, description,
            total_amount, installment_amount, installment_number, total_installments,
            due_date, transaction_type, group_id, group_split_type, notes
        ) VALUES (
            p_user_id, parent_id, p_account_id, p_category_id, 
            p_description || ' (' || i || '/' || p_total_installments || ')',
            p_total_amount, installment_amount, i, p_total_installments,
            current_due_date, p_transaction_type, p_group_id, p_group_split_type, p_notes
        ) RETURNING id INTO new_installment_id;
        
        -- Primeira parcela vira o parent das demais
        IF i = 1 THEN
            parent_id := new_installment_id;
            UPDATE transaction_installments 
            SET parent_transaction_id = new_installment_id 
            WHERE id = new_installment_id;
        END IF;
        
        -- Adicionar ao array de IDs
        installment_ids := array_append(installment_ids, new_installment_id);
        
        -- Próxima data (adicionar 1 mês)
        current_due_date := current_due_date + INTERVAL '1 month';
    END LOOP;
    
    RETURN installment_ids;
END;
$$;

--
-- Name: expire_old_invitations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_old_invitations() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    affected_rows INTEGER;
BEGIN
    UPDATE group_invitations 
    SET status = 'expired', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'pending' 
    AND expires_at < CURRENT_TIMESTAMP;
    
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    RETURN affected_rows;
END;
$$;

--
-- Name: fix_existing_group_transactions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fix_existing_group_transactions() RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    transaction_record RECORD;
    member_count INTEGER;
    split_amount DECIMAL(10,2);
    gt_id UUID;
    transactions_fixed INTEGER := 0;
    splits_created INTEGER := 0;
BEGIN
    -- Para cada transação com group_id que não tem group_transaction
    FOR transaction_record IN 
        SELECT ft.id, ft.group_id, ft.user_id, ABS(ft.amount) as amount, ft.description
        FROM financial_transactions ft
        WHERE ft.group_id IS NOT NULL 
          AND ft.amount < 0  -- Apenas despesas
          AND NOT EXISTS (
              SELECT 1 FROM group_transactions gt 
              WHERE gt.transaction_id = ft.id AND gt.group_id = ft.group_id
          )
    LOOP
        -- Verificar se o usuário ainda é membro do grupo
        IF EXISTS (
            SELECT 1 FROM group_members gm
            WHERE gm.group_id = transaction_record.group_id 
            AND gm.user_id = transaction_record.user_id 
            AND gm.status = 'active'
        ) THEN
            -- Criar group_transaction
            INSERT INTO group_transactions (group_id, transaction_id, split_type)
            VALUES (transaction_record.group_id, transaction_record.id, 'equal')
            RETURNING id INTO gt_id;
            
            transactions_fixed := transactions_fixed + 1;
            
            -- Contar membros ativos do grupo
            SELECT COUNT(*) INTO member_count
            FROM group_members gm 
            WHERE gm.group_id = transaction_record.group_id AND gm.status = 'active';
            
            -- Se há membros, criar splits
            IF member_count > 0 THEN
                split_amount := transaction_record.amount / member_count;
                
                -- Criar splits para todos os membros ativos
                INSERT INTO group_expense_splits (
                    group_transaction_id, 
                    member_id, 
                    amount, 
                    status
                )
                SELECT 
                    gt_id,
                    gm.id,
                    split_amount,
                    'pending'
                FROM group_members gm 
                WHERE gm.group_id = transaction_record.group_id AND gm.status = 'active';
                
                -- Contar splits criados para esta transação
                splits_created := splits_created + member_count;
                
                RAISE NOTICE 'Fixed transaction "%" with % splits', transaction_record.description, member_count;
            END IF;
        ELSE
            -- Se o usuário não é mais membro, limpar o group_id
            UPDATE financial_transactions 
            SET group_id = NULL 
            WHERE id = transaction_record.id;
            
            RAISE NOTICE 'Cleared group_id for transaction "%" (user not in group)', transaction_record.description;
        END IF;
    END LOOP;
    
    RETURN format('Correção concluída: %s group_transactions criados, %s splits criados', 
                  transactions_fixed, splits_created);
END;
$$;

--
-- Name: generate_group_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_group_code() RETURNS text
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN UPPER(LEFT(MD5(RANDOM()::TEXT), 6));
END;
$$;

--
-- Name: get_net_balance(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_net_balance(user_a uuid, user_b uuid) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
    balance_a_to_b DECIMAL(15,2) := 0;
    balance_b_to_a DECIMAL(15,2) := 0;
BEGIN
    -- Quanto user_a deve para user_b
    SELECT COALESCE(amount, 0) INTO balance_a_to_b
    FROM user_balances
    WHERE creditor_id = user_b AND debtor_id = user_a;
    
    -- Quanto user_b deve para user_a
    SELECT COALESCE(amount, 0) INTO balance_b_to_a
    FROM user_balances
    WHERE creditor_id = user_a AND debtor_id = user_b;
    
    RETURN balance_a_to_b - balance_b_to_a;
END;
$$;

--
-- Name: get_user_by_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_by_email(user_email text) RETURNS TABLE(id uuid, email text, full_name text)
    LANGUAGE sql SECURITY DEFINER
    AS $$
    SELECT 
        u.id,
        u.email,
        p.full_name
    FROM auth.users u
    LEFT JOIN profiles p ON p.id = u.id
    WHERE LOWER(u.email) = LOWER(user_email)
    AND u.email_confirmed_at IS NOT NULL;
$$;

--
-- Name: pay_installment(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_installment(p_installment_id uuid, p_paid_date date DEFAULT CURRENT_DATE) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    installment_record transaction_installments;
BEGIN
    -- Buscar a parcela
    SELECT * INTO installment_record 
    FROM transaction_installments 
    WHERE id = p_installment_id AND user_id = auth.uid();
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    -- Marcar como paga
    UPDATE transaction_installments 
    SET paid_date = p_paid_date, updated_at = NOW()
    WHERE id = p_installment_id;
    
    -- Criar transação correspondente na tabela principal
    INSERT INTO financial_transactions (
        user_id, service_id, category_id, account_id, description, amount,
        transaction_date, transaction_type, installment_parent_id, notes, is_shared
    ) VALUES (
        installment_record.user_id,
        (SELECT id FROM financial_services WHERE name = 'personal_finance'),
        installment_record.category_id, installment_record.account_id,
        installment_record.description,
        CASE 
            WHEN installment_record.transaction_type = 'expense' THEN -installment_record.installment_amount
            ELSE installment_record.installment_amount 
        END,
        p_paid_date, installment_record.transaction_type, p_installment_id,
        installment_record.notes, installment_record.group_id IS NOT NULL
    );
    
    RETURN TRUE;
END;
$$;

--
-- Name: set_group_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_group_code() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.group_code IS NULL OR NEW.group_code = '' THEN
        LOOP
            NEW.group_code := generate_group_code();
            EXIT WHEN NOT EXISTS (SELECT 1 FROM expense_groups WHERE group_code = NEW.group_code);
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

--
-- Name: sync_existing_transactions_to_groups(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_existing_transactions_to_groups() RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    transactions_created INTEGER := 0;
    splits_created INTEGER := 0;
    transaction_record RECORD;
    member_count INTEGER;
    split_amount DECIMAL(10,2);
    gt_id UUID;
BEGIN
    -- Para cada transação que tem group_id mas não tem group_transaction
    FOR transaction_record IN 
        SELECT ft.id, ft.group_id, ft.user_id, ABS(ft.amount) as amount
        FROM financial_transactions ft
        WHERE ft.group_id IS NOT NULL 
          AND ft.amount < 0  -- Apenas despesas
          AND NOT EXISTS (
              SELECT 1 FROM group_transactions gt 
              WHERE gt.transaction_id = ft.id AND gt.group_id = ft.group_id
          )
    LOOP
        -- Criar group_transaction
        INSERT INTO group_transactions (group_id, transaction_id, split_type, created_by)
        VALUES (transaction_record.group_id, transaction_record.id, 'equal', transaction_record.user_id)
        RETURNING id INTO gt_id;
        
        transactions_created := transactions_created + 1;
        
        -- Contar membros ativos do grupo
        SELECT COUNT(*) INTO member_count
        FROM group_members gm 
        WHERE gm.group_id = transaction_record.group_id AND gm.status = 'active';
        
        -- Se há membros, criar splits
        IF member_count > 0 THEN
            split_amount := transaction_record.amount / member_count;
            
            -- Criar splits para todos os membros ativos
            INSERT INTO group_expense_splits (
                group_transaction_id, 
                member_id, 
                amount, 
                status
            )
            SELECT 
                gt_id,
                gm.id,
                split_amount,
                'pending'
            FROM group_members gm 
            WHERE gm.group_id = transaction_record.group_id AND gm.status = 'active';
            
            -- Contar splits criados para esta transação
            splits_created := splits_created + member_count;
        END IF;
    END LOOP;
    
    RETURN format('Sincronização concluída: %s group_transactions criados, %s splits criados', 
                  transactions_created, splits_created);
END;
$$;

--
-- Name: sync_transaction_with_group(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_transaction_with_group() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    member_count INTEGER;
    split_amount DECIMAL(10,2);
    gt_id UUID;
BEGIN
    -- Se a transação tem group_id e é uma despesa (valor negativo)
    IF NEW.group_id IS NOT NULL AND NEW.amount < 0 THEN
        -- Verificar se já existe group_transaction para esta transação
        IF NOT EXISTS (
            SELECT 1 FROM group_transactions 
            WHERE transaction_id = NEW.id AND group_id = NEW.group_id
        ) THEN
            -- Criar group_transaction e obter ID
            INSERT INTO group_transactions (group_id, transaction_id, split_type)
            VALUES (NEW.group_id, NEW.id, 'equal')
            RETURNING id INTO gt_id;
            
            -- Contar membros ativos do grupo
            SELECT COUNT(*) INTO member_count
            FROM group_members 
            WHERE group_id = NEW.group_id AND status = 'active';
            
            -- Se há membros, criar splits
            IF member_count > 0 THEN
                split_amount := ABS(NEW.amount) / member_count;
                
                -- Criar splits automáticos para membros ativos
                INSERT INTO group_expense_splits (
                    group_transaction_id, 
                    member_id, 
                    amount, 
                    status
                )
                SELECT 
                    gt_id,
                    gm.id,
                    split_amount,
                    'pending'
                FROM group_members gm 
                WHERE gm.group_id = NEW.group_id AND gm.status = 'active';
                
                RAISE NOTICE 'Created group transaction and % splits for transaction %', member_count, NEW.id;
            END IF;
        END IF;
    -- Se group_id foi removido (apenas em UPDATE), limpar group_transactions relacionados
    ELSIF TG_OP = 'UPDATE' AND OLD.group_id IS NOT NULL AND (NEW.group_id IS NULL OR NEW.group_id != OLD.group_id) THEN
        DELETE FROM group_transactions 
        WHERE transaction_id = NEW.id AND group_id = OLD.group_id;
        
        RAISE NOTICE 'Removed group transaction for transaction %', NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$;

--
-- Name: update_account_balance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_account_balance() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Atualizar saldo da conta quando transação é criada/atualizada
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        IF NEW.account_id IS NOT NULL THEN
            UPDATE financial_accounts 
            SET current_balance = current_balance + NEW.amount, updated_at = NOW()
            WHERE id = NEW.account_id;
        END IF;
        RETURN NEW;
    END IF;
    
    -- Reverter saldo quando transação é deletada
    IF TG_OP = 'DELETE' THEN
        IF OLD.account_id IS NOT NULL THEN
            UPDATE financial_accounts 
            SET current_balance = current_balance - OLD.amount, updated_at = NOW()
            WHERE id = OLD.account_id;
        END IF;
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

--
-- Name: update_usage_limits_on_plan_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_usage_limits_on_plan_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Atualizar limites baseado no novo plano
    UPDATE user_usage_limits 
    SET 
        max_transactions = CASE 
            WHEN NEW.plan IN ('invest', 'trader', 'admin') THEN NULL -- unlimited
            ELSE 100 -- free
        END,
        max_accounts = CASE 
            WHEN NEW.plan = 'admin' THEN NULL -- unlimited
            WHEN NEW.plan = 'trader' THEN NULL -- unlimited
            WHEN NEW.plan = 'invest' THEN 10
            ELSE 3 -- free
        END,
        max_categories = CASE 
            WHEN NEW.plan = 'admin' THEN NULL -- unlimited
            WHEN NEW.plan = 'trader' THEN NULL -- unlimited
            WHEN NEW.plan = 'invest' THEN 50
            ELSE 20 -- free
        END,
        max_portfolios = CASE 
            WHEN NEW.plan = 'admin' THEN NULL -- unlimited
            WHEN NEW.plan = 'trader' THEN NULL -- unlimited
            WHEN NEW.plan = 'invest' THEN 5
            ELSE 0 -- free
        END,
        max_expense_groups = CASE 
            WHEN NEW.plan IN ('trader', 'admin') THEN NULL -- unlimited
            WHEN NEW.plan = 'invest' THEN 10
            ELSE 2 -- free
        END,
        updated_at = NOW()
    WHERE user_id = NEW.user_id;
    
    -- Registrar no histórico se houve mudança de plano
    IF OLD.plan != NEW.plan THEN
        INSERT INTO subscription_history (
            user_id,
            subscription_id,
            from_plan,
            to_plan,
            from_status,
            to_status,
            reason
        ) VALUES (
            NEW.user_id,
            NEW.id,
            OLD.plan,
            NEW.plan,
            OLD.status,
            NEW.status,
            'plan_change'
        );
    END IF;
    
    RETURN NEW;
END;
$$;

--
-- Name: update_user_balances(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_user_balances() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    transaction_owner_id UUID;
BEGIN
    -- Buscar o dono da transação
    SELECT user_id INTO transaction_owner_id
    FROM financial_transactions
    WHERE id = COALESCE(NEW.transaction_id, OLD.transaction_id);
    
    -- Para cada divisão aprovada, atualizar o balanço
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        IF NEW.status = 'approved' AND NEW.participant_id != transaction_owner_id THEN
            -- O participante deve para o dono da transação
            INSERT INTO user_balances (creditor_id, debtor_id, amount)
            VALUES (transaction_owner_id, NEW.participant_id, NEW.amount)
            ON CONFLICT (creditor_id, debtor_id)
            DO UPDATE SET 
                amount = user_balances.amount + NEW.amount,
                last_updated = NOW();
        END IF;
    END IF;
    
    -- Se divisão foi rejeitada ou excluída, remover do balanço
    IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW.status != 'approved') THEN
        IF OLD.participant_id != transaction_owner_id THEN
            UPDATE user_balances 
            SET amount = amount - OLD.amount, last_updated = NOW()
            WHERE creditor_id = transaction_owner_id AND debtor_id = OLD.participant_id;
              
            -- Remover se não há mais dívida
            DELETE FROM user_balances 
            WHERE creditor_id = transaction_owner_id 
              AND debtor_id = OLD.participant_id 
              AND amount <= 0;
        END IF;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$;

--
-- Name: verify_system_setup(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_system_setup() RETURNS TABLE(component text, status text, count_items bigint, details text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Verificar serviços
    RETURN QUERY
    SELECT 
        'financial_services'::TEXT,
        'OK'::TEXT,
        COUNT(*)::BIGINT,
        'Serviços financeiros configurados'::TEXT
    FROM financial_services;
    
    -- Verificar categorias
    RETURN QUERY
    SELECT 
        'transaction_categories'::TEXT,
        CASE WHEN COUNT(*) >= 8 THEN 'OK' ELSE 'INCOMPLETE' END::TEXT,
        COUNT(*)::BIGINT,
        'Categorias de transação disponíveis'::TEXT
    FROM transaction_categories;
    
    -- Verificar políticas RLS
    RETURN QUERY
    SELECT 
        'rls_policies'::TEXT,
        CASE WHEN COUNT(*) >= 10 THEN 'OK' ELSE 'INCOMPLETE' END::TEXT,
        COUNT(*)::BIGINT,
        'Políticas de segurança ativas'::TEXT
    FROM pg_policies 
    WHERE schemaname = 'public';
    
    -- Verificar funções
    RETURN QUERY
    SELECT 
        'custom_functions'::TEXT,
        CASE WHEN COUNT(*) >= 8 THEN 'OK' ELSE 'INCOMPLETE' END::TEXT,
        COUNT(*)::BIGINT,
        'Funções customizadas criadas'::TEXT
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' 
    AND p.proname IN (
        'generate_group_code', 'calculate_split_amount', 'create_installments',
        'pay_installment', 'calculate_member_proportions', 'get_net_balance',
        'create_default_accounts', 'update_user_balances'
    );
    
    -- Verificar triggers
    RETURN QUERY
    SELECT 
        'triggers'::TEXT,
        CASE WHEN COUNT(*) >= 5 THEN 'OK' ELSE 'INCOMPLETE' END::TEXT,
        COUNT(*)::BIGINT,
        'Triggers automáticos configurados'::TEXT
    FROM pg_trigger
    WHERE tgname IN (
        'calculate_split_amount_trigger', 'update_balances_trigger',
        'set_group_code_trigger', 'add_group_creator_trigger',
        'update_account_balance_trigger'
    );
    
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: expense_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    photo_url text,
    group_code text NOT NULL,
    group_type text DEFAULT 'private'::text NOT NULL,
    default_split_type text DEFAULT 'equal'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    CONSTRAINT expense_groups_default_split_type_check CHECK ((default_split_type = ANY (ARRAY['equal'::text, 'percentage'::text, 'custom'::text, 'proportional'::text]))),
    CONSTRAINT expense_groups_group_type_check CHECK ((group_type = ANY (ARRAY['public'::text, 'private'::text])))
);

--
-- Name: expense_splits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_splits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    percentage numeric(5,2) NOT NULL,
    amount numeric(15,2) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    approved_at timestamp with time zone,
    rejection_reason text,
    comments text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT expense_splits_percentage_check CHECK (((percentage > (0)::numeric) AND (percentage <= (100)::numeric))),
    CONSTRAINT expense_splits_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text])))
);

--
-- Name: financial_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    account_type public.account_type NOT NULL,
    bank_name text,
    last_four_digits character varying(4),
    credit_limit numeric(15,2),
    current_balance numeric(15,2) DEFAULT 0,
    is_active boolean DEFAULT true,
    color_hex text DEFAULT '#3B82F6'::text,
    icon text DEFAULT 'credit-card'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: financial_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    icon text,
    color_hex text DEFAULT '#3B82F6'::text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: financial_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    service_id uuid NOT NULL,
    category_id uuid NOT NULL,
    account_id uuid,
    description text NOT NULL,
    amount numeric(15,2) NOT NULL,
    transaction_date date NOT NULL,
    transaction_type public.transaction_financial_type,
    attachment_url text,
    notes text,
    is_shared boolean DEFAULT false,
    installment_parent_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    group_id uuid
);

--
-- Name: group_expense_splits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_expense_splits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_transaction_id uuid NOT NULL,
    member_id uuid NOT NULL,
    percentage numeric(5,2) NOT NULL,
    amount numeric(15,2) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    approved_at timestamp with time zone,
    comments text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT group_expense_splits_percentage_check CHECK (((percentage > (0)::numeric) AND (percentage <= (100)::numeric))),
    CONSTRAINT group_expense_splits_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text])))
);

--
-- Name: group_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    invited_by uuid NOT NULL,
    invite_method text NOT NULL,
    invite_target text NOT NULL,
    invited_user_id uuid,
    message text,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    responded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT group_invitations_invite_method_check CHECK ((invite_method = ANY (ARRAY['email'::text, 'phone'::text, 'code'::text, 'request'::text]))),
    CONSTRAINT group_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'expired'::text])))
);

--
-- Name: group_member_proportions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_member_proportions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    member_id uuid NOT NULL,
    calculation_month date NOT NULL,
    total_income numeric(15,2) DEFAULT 0 NOT NULL,
    proportion_percentage numeric(5,2) NOT NULL,
    calculated_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    CONSTRAINT group_member_proportions_proportion_percentage_check CHECK (((proportion_percentage >= (0)::numeric) AND (proportion_percentage <= (100)::numeric)))
);

--
-- Name: group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    percentage numeric(5,2) DEFAULT 0.00,
    joined_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT group_members_percentage_check CHECK (((percentage >= (0)::numeric) AND (percentage <= (100)::numeric))),
    CONSTRAINT group_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text]))),
    CONSTRAINT group_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'pending'::text, 'removed'::text])))
);

--
-- Name: group_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    transaction_id uuid NOT NULL,
    split_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    CONSTRAINT group_transactions_split_type_check CHECK ((split_type = ANY (ARRAY['equal'::text, 'percentage'::text, 'custom'::text])))
);

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    email text,
    phone text,
    avatar_url text,
    birth_date date,
    preferences jsonb DEFAULT '{"currency": "BRL", "language": "pt-BR", "timezone": "America/Sao_Paulo", "notifications": {"push": true, "email": true, "financial_alerts": true}}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    allow_connections boolean DEFAULT true,
    bio text,
    location text,
    nickname text,
    is_public boolean DEFAULT true
);

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version character varying(20) NOT NULL,
    name text NOT NULL,
    description text,
    checksum text,
    executed_at timestamp with time zone DEFAULT now(),
    execution_time_ms integer,
    rollback_sql text,
    status character varying(20) DEFAULT 'success'::character varying,
    executed_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT schema_migrations_status_check CHECK (((status)::text = ANY ((ARRAY['success'::character varying, 'failed'::character varying, 'rolled_back'::character varying])::text[])))
);

--
-- Name: subscription_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_history (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    from_plan public.user_plan_type,
    to_plan public.user_plan_type NOT NULL,
    from_status public.subscription_status,
    to_status public.subscription_status NOT NULL,
    reason text,
    amount_paid numeric(10,2),
    currency character(3) DEFAULT 'BRL'::bpchar,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: transaction_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    icon text,
    color_hex text DEFAULT '#6B7280'::text,
    is_expense boolean NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: transaction_installments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_installments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    parent_transaction_id uuid,
    account_id uuid,
    category_id uuid NOT NULL,
    description text NOT NULL,
    total_amount numeric(15,2) NOT NULL,
    installment_amount numeric(15,2) NOT NULL,
    installment_number integer NOT NULL,
    total_installments integer NOT NULL,
    due_date date NOT NULL,
    paid_date date,
    transaction_type public.transaction_financial_type NOT NULL,
    group_id uuid,
    group_split_type text,
    notes text,
    attachment_url text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT transaction_installments_check CHECK (((installment_number > 0) AND (installment_number <= total_installments))),
    CONSTRAINT transaction_installments_group_split_type_check CHECK ((group_split_type = ANY (ARRAY['equal'::text, 'percentage'::text, 'custom'::text, 'proportional'::text]))),
    CONSTRAINT transaction_installments_installment_amount_check CHECK ((installment_amount > (0)::numeric)),
    CONSTRAINT transaction_installments_total_amount_check CHECK ((total_amount > (0)::numeric)),
    CONSTRAINT transaction_installments_total_installments_check CHECK ((total_installments > 0))
);

--
-- Name: user_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_balances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creditor_id uuid NOT NULL,
    debtor_id uuid NOT NULL,
    amount numeric(15,2) DEFAULT 0.00 NOT NULL,
    last_updated timestamp with time zone DEFAULT now(),
    CONSTRAINT no_self_balance CHECK ((creditor_id <> debtor_id))
);

--
-- Name: user_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_subscriptions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    plan public.user_plan_type DEFAULT 'free'::public.user_plan_type NOT NULL,
    status public.subscription_status DEFAULT 'active'::public.subscription_status NOT NULL,
    current_period_start timestamp with time zone DEFAULT now() NOT NULL,
    current_period_end timestamp with time zone DEFAULT (now() + '1 mon'::interval) NOT NULL,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    canceled_at timestamp with time zone,
    trial_start timestamp with time zone,
    trial_end timestamp with time zone,
    payment_method text,
    stripe_subscription_id text,
    stripe_customer_id text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_subscriptions_check CHECK ((current_period_end > current_period_start)),
    CONSTRAINT user_subscriptions_check1 CHECK (((trial_end IS NULL) OR (trial_end > trial_start)))
);

--
-- Name: user_usage_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_usage_limits (
    user_id uuid NOT NULL,
    current_transactions integer DEFAULT 0,
    current_accounts integer DEFAULT 0,
    current_categories integer DEFAULT 0,
    current_portfolios integer DEFAULT 0,
    current_expense_groups integer DEFAULT 0,
    max_transactions integer,
    max_accounts integer,
    max_categories integer,
    max_portfolios integer,
    max_expense_groups integer,
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: user_subscription_details; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.user_subscription_details AS
 SELECT u.id AS user_id,
    u.full_name,
    u.email,
    s.id AS subscription_id,
    s.plan,
    s.status,
    s.current_period_start,
    s.current_period_end,
    s.cancel_at_period_end,
    s.trial_end,
    l.current_transactions,
    l.current_accounts,
    l.current_categories,
    l.current_portfolios,
    l.current_expense_groups,
    l.max_transactions,
    l.max_accounts,
    l.max_categories,
    l.max_portfolios,
    l.max_expense_groups,
        CASE
            WHEN (s.plan = ANY (ARRAY['invest'::public.user_plan_type, 'trader'::public.user_plan_type, 'admin'::public.user_plan_type])) THEN true
            ELSE false
        END AS is_premium,
        CASE
            WHEN (s.trial_end > now()) THEN true
            ELSE false
        END AS is_in_trial,
        CASE
            WHEN (s.current_period_end < now()) THEN true
            ELSE false
        END AS is_expired
   FROM ((public.profiles u
     LEFT JOIN public.user_subscriptions s ON ((u.id = s.user_id)))
     LEFT JOIN public.user_usage_limits l ON ((u.id = l.user_id)));

--
-- Name: expense_groups expense_groups_group_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_groups
    ADD CONSTRAINT expense_groups_group_code_key UNIQUE (group_code);

--
-- Name: expense_groups expense_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_groups
    ADD CONSTRAINT expense_groups_pkey PRIMARY KEY (id);

--
-- Name: expense_splits expense_splits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_splits
    ADD CONSTRAINT expense_splits_pkey PRIMARY KEY (id);

--
-- Name: financial_accounts financial_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_accounts
    ADD CONSTRAINT financial_accounts_pkey PRIMARY KEY (id);

--
-- Name: financial_services financial_services_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_services
    ADD CONSTRAINT financial_services_name_key UNIQUE (name);

--
-- Name: financial_services financial_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_services
    ADD CONSTRAINT financial_services_pkey PRIMARY KEY (id);

--
-- Name: financial_transactions financial_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT financial_transactions_pkey PRIMARY KEY (id);

--
-- Name: group_expense_splits group_expense_splits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_expense_splits
    ADD CONSTRAINT group_expense_splits_pkey PRIMARY KEY (id);

--
-- Name: group_invitations group_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_invitations
    ADD CONSTRAINT group_invitations_pkey PRIMARY KEY (id);

--
-- Name: group_member_proportions group_member_proportions_group_id_member_id_calculation_mon_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_member_proportions
    ADD CONSTRAINT group_member_proportions_group_id_member_id_calculation_mon_key UNIQUE (group_id, member_id, calculation_month);

--
-- Name: group_member_proportions group_member_proportions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_member_proportions
    ADD CONSTRAINT group_member_proportions_pkey PRIMARY KEY (id);

--
-- Name: group_members group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_pkey PRIMARY KEY (id);

--
-- Name: group_transactions group_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_transactions
    ADD CONSTRAINT group_transactions_pkey PRIMARY KEY (id);

--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (id);

--
-- Name: schema_migrations schema_migrations_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_version_key UNIQUE (version);

--
-- Name: subscription_history subscription_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_history
    ADD CONSTRAINT subscription_history_pkey PRIMARY KEY (id);

--
-- Name: transaction_categories transaction_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_categories
    ADD CONSTRAINT transaction_categories_pkey PRIMARY KEY (id);

--
-- Name: transaction_installments transaction_installments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_installments
    ADD CONSTRAINT transaction_installments_pkey PRIMARY KEY (id);

--
-- Name: user_balances unique_balance_pair; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_balances
    ADD CONSTRAINT unique_balance_pair UNIQUE (creditor_id, debtor_id);

--
-- Name: transaction_categories unique_category_per_service; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_categories
    ADD CONSTRAINT unique_category_per_service UNIQUE (service_id, name);

--
-- Name: expense_splits unique_participant_per_transaction; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_splits
    ADD CONSTRAINT unique_participant_per_transaction UNIQUE (transaction_id, participant_id);

--
-- Name: group_transactions unique_transaction_per_group; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_transactions
    ADD CONSTRAINT unique_transaction_per_group UNIQUE (group_id, transaction_id);

--
-- Name: group_members unique_user_per_group; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT unique_user_per_group UNIQUE (group_id, user_id);

--
-- Name: user_balances user_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_balances
    ADD CONSTRAINT user_balances_pkey PRIMARY KEY (id);

--
-- Name: user_subscriptions user_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_pkey PRIMARY KEY (id);

--
-- Name: user_subscriptions user_subscriptions_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_user_id_key UNIQUE (user_id);

--
-- Name: user_usage_limits user_usage_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_usage_limits
    ADD CONSTRAINT user_usage_limits_pkey PRIMARY KEY (user_id);

--
-- Name: idx_expense_groups_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_groups_active ON public.expense_groups USING btree (is_active) WHERE (is_active = true);

--
-- Name: idx_expense_groups_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_groups_code ON public.expense_groups USING btree (group_code);

--
-- Name: idx_expense_groups_creator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_groups_creator ON public.expense_groups USING btree (created_by);

--
-- Name: idx_expense_groups_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_groups_type ON public.expense_groups USING btree (group_type);

--
-- Name: idx_expense_splits_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_splits_participant ON public.expense_splits USING btree (participant_id);

--
-- Name: idx_expense_splits_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_splits_pending ON public.expense_splits USING btree (participant_id, status) WHERE (status = 'pending'::text);

--
-- Name: idx_expense_splits_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_splits_status ON public.expense_splits USING btree (status);

--
-- Name: idx_expense_splits_transaction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_splits_transaction ON public.expense_splits USING btree (transaction_id);

--
-- Name: idx_financial_accounts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_accounts_active ON public.financial_accounts USING btree (is_active) WHERE (is_active = true);

--
-- Name: idx_financial_accounts_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_accounts_type ON public.financial_accounts USING btree (account_type);

--
-- Name: idx_financial_accounts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_accounts_user ON public.financial_accounts USING btree (user_id);

--
-- Name: idx_financial_transactions_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_transactions_account ON public.financial_transactions USING btree (account_id);

--
-- Name: idx_financial_transactions_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_transactions_category ON public.financial_transactions USING btree (category_id);

--
-- Name: idx_financial_transactions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_transactions_date ON public.financial_transactions USING btree (transaction_date);

--
-- Name: idx_financial_transactions_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_transactions_group_id ON public.financial_transactions USING btree (group_id);

--
-- Name: idx_financial_transactions_service; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_transactions_service ON public.financial_transactions USING btree (service_id);

--
-- Name: idx_financial_transactions_shared; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_transactions_shared ON public.financial_transactions USING btree (is_shared) WHERE (is_shared = true);

--
-- Name: idx_financial_transactions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_transactions_type ON public.financial_transactions USING btree (transaction_type);

--
-- Name: idx_financial_transactions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_transactions_user ON public.financial_transactions USING btree (user_id);

--
-- Name: idx_group_invitations_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_invitations_expires ON public.group_invitations USING btree (expires_at);

--
-- Name: idx_group_invitations_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_invitations_expires_at ON public.group_invitations USING btree (expires_at);

--
-- Name: idx_group_invitations_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_invitations_group ON public.group_invitations USING btree (group_id);

--
-- Name: idx_group_invitations_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_invitations_group_id ON public.group_invitations USING btree (group_id);

--
-- Name: idx_group_invitations_invited_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_invitations_invited_by ON public.group_invitations USING btree (invited_by);

--
-- Name: idx_group_invitations_invited_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_invitations_invited_user_id ON public.group_invitations USING btree (invited_user_id);

--
-- Name: idx_group_invitations_inviter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_invitations_inviter ON public.group_invitations USING btree (invited_by);

--
-- Name: idx_group_invitations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_invitations_status ON public.group_invitations USING btree (status);

--
-- Name: idx_group_invitations_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_invitations_target ON public.group_invitations USING btree (invite_target);

--
-- Name: idx_group_members_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_members_group ON public.group_members USING btree (group_id);

--
-- Name: idx_group_members_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_members_role ON public.group_members USING btree (role);

--
-- Name: idx_group_members_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_members_status ON public.group_members USING btree (status);

--
-- Name: idx_group_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_members_user ON public.group_members USING btree (user_id);

--
-- Name: idx_group_proportions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_proportions_active ON public.group_member_proportions USING btree (is_active) WHERE (is_active = true);

--
-- Name: idx_group_proportions_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_proportions_group ON public.group_member_proportions USING btree (group_id);

--
-- Name: idx_group_proportions_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_proportions_member ON public.group_member_proportions USING btree (member_id);

--
-- Name: idx_group_proportions_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_proportions_month ON public.group_member_proportions USING btree (calculation_month);

--
-- Name: idx_profiles_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_email ON public.profiles USING btree (email);

--
-- Name: idx_profiles_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_phone ON public.profiles USING btree (phone);

--
-- Name: idx_schema_migrations_executed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schema_migrations_executed_at ON public.schema_migrations USING btree (executed_at);

--
-- Name: idx_schema_migrations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schema_migrations_status ON public.schema_migrations USING btree (status);

--
-- Name: idx_schema_migrations_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schema_migrations_version ON public.schema_migrations USING btree (version);

--
-- Name: idx_subscription_history_subscription_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_history_subscription_id ON public.subscription_history USING btree (subscription_id);

--
-- Name: idx_subscription_history_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_history_user_id ON public.subscription_history USING btree (user_id);

--
-- Name: idx_transaction_categories_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_categories_active ON public.transaction_categories USING btree (is_active) WHERE (is_active = true);

--
-- Name: idx_transaction_categories_service; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_categories_service ON public.transaction_categories USING btree (service_id);

--
-- Name: idx_transaction_installments_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_installments_account ON public.transaction_installments USING btree (account_id);

--
-- Name: idx_transaction_installments_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_installments_active ON public.transaction_installments USING btree (is_active) WHERE (is_active = true);

--
-- Name: idx_transaction_installments_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_installments_category ON public.transaction_installments USING btree (category_id);

--
-- Name: idx_transaction_installments_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_installments_due_date ON public.transaction_installments USING btree (due_date);

--
-- Name: idx_transaction_installments_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_installments_group ON public.transaction_installments USING btree (group_id);

--
-- Name: idx_transaction_installments_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_installments_parent ON public.transaction_installments USING btree (parent_transaction_id);

--
-- Name: idx_transaction_installments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_installments_user ON public.transaction_installments USING btree (user_id);

--
-- Name: idx_user_balances_creditor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_balances_creditor ON public.user_balances USING btree (creditor_id);

--
-- Name: idx_user_balances_debtor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_balances_debtor ON public.user_balances USING btree (debtor_id);

--
-- Name: idx_user_subscriptions_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_subscriptions_plan ON public.user_subscriptions USING btree (plan);

--
-- Name: idx_user_subscriptions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_subscriptions_status ON public.user_subscriptions USING btree (status);

--
-- Name: idx_user_subscriptions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_subscriptions_user_id ON public.user_subscriptions USING btree (user_id);

--
-- Name: expense_groups add_group_creator_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER add_group_creator_trigger AFTER INSERT ON public.expense_groups FOR EACH ROW EXECUTE FUNCTION public.add_group_creator();

--
-- Name: group_expense_splits calculate_equal_split_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER calculate_equal_split_trigger BEFORE INSERT ON public.group_expense_splits FOR EACH ROW EXECUTE FUNCTION public.calculate_equal_split();

--
-- Name: expense_splits calculate_split_amount_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER calculate_split_amount_trigger BEFORE INSERT OR UPDATE ON public.expense_splits FOR EACH ROW EXECUTE FUNCTION public.calculate_split_amount();

--
-- Name: group_invitations cleanup_expired_invitations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cleanup_expired_invitations AFTER INSERT ON public.group_invitations FOR EACH ROW EXECUTE FUNCTION public.cleanup_expired_invitations_trigger();

--
-- Name: profiles create_user_subscription_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER create_user_subscription_trigger AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.create_free_subscription();

--
-- Name: expense_groups set_group_code_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_group_code_trigger BEFORE INSERT ON public.expense_groups FOR EACH ROW EXECUTE FUNCTION public.set_group_code();

--
-- Name: financial_transactions trigger_auto_create_group_transaction; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_auto_create_group_transaction AFTER INSERT OR UPDATE ON public.financial_transactions FOR EACH ROW EXECUTE FUNCTION public.auto_create_group_transaction();

--
-- Name: financial_transactions trigger_sync_transaction_group; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_sync_transaction_group AFTER INSERT OR UPDATE ON public.financial_transactions FOR EACH ROW EXECUTE FUNCTION public.sync_transaction_with_group();

--
-- Name: financial_transactions update_account_balance_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_account_balance_trigger AFTER INSERT OR DELETE OR UPDATE ON public.financial_transactions FOR EACH ROW EXECUTE FUNCTION public.update_account_balance();

--
-- Name: expense_splits update_balances_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_balances_trigger AFTER INSERT OR DELETE OR UPDATE ON public.expense_splits FOR EACH ROW EXECUTE FUNCTION public.update_user_balances();

--
-- Name: user_subscriptions update_limits_on_plan_change_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_limits_on_plan_change_trigger AFTER UPDATE ON public.user_subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_usage_limits_on_plan_change();

--
-- Name: user_subscriptions update_user_subscriptions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_subscriptions_updated_at BEFORE UPDATE ON public.user_subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: user_usage_limits update_user_usage_limits_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_usage_limits_updated_at BEFORE UPDATE ON public.user_usage_limits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: expense_groups expense_groups_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_groups
    ADD CONSTRAINT expense_groups_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: expense_splits expense_splits_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_splits
    ADD CONSTRAINT expense_splits_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: expense_splits expense_splits_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_splits
    ADD CONSTRAINT expense_splits_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.financial_transactions(id) ON DELETE CASCADE;

--
-- Name: financial_accounts financial_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_accounts
    ADD CONSTRAINT financial_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: financial_transactions financial_transactions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT financial_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id);

--
-- Name: financial_transactions financial_transactions_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT financial_transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.transaction_categories(id);

--
-- Name: financial_transactions financial_transactions_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT financial_transactions_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.expense_groups(id);

--
-- Name: financial_transactions financial_transactions_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT financial_transactions_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.financial_services(id);

--
-- Name: financial_transactions financial_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT financial_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: group_expense_splits group_expense_splits_group_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_expense_splits
    ADD CONSTRAINT group_expense_splits_group_transaction_id_fkey FOREIGN KEY (group_transaction_id) REFERENCES public.group_transactions(id) ON DELETE CASCADE;

--
-- Name: group_expense_splits group_expense_splits_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_expense_splits
    ADD CONSTRAINT group_expense_splits_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.group_members(id) ON DELETE CASCADE;

--
-- Name: group_invitations group_invitations_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_invitations
    ADD CONSTRAINT group_invitations_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.expense_groups(id) ON DELETE CASCADE;

--
-- Name: group_invitations group_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_invitations
    ADD CONSTRAINT group_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: group_invitations group_invitations_invited_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_invitations
    ADD CONSTRAINT group_invitations_invited_user_id_fkey FOREIGN KEY (invited_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: group_member_proportions group_member_proportions_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_member_proportions
    ADD CONSTRAINT group_member_proportions_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.expense_groups(id) ON DELETE CASCADE;

--
-- Name: group_member_proportions group_member_proportions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_member_proportions
    ADD CONSTRAINT group_member_proportions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.group_members(id) ON DELETE CASCADE;

--
-- Name: group_members group_members_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.expense_groups(id) ON DELETE CASCADE;

--
-- Name: group_members group_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: group_transactions group_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_transactions
    ADD CONSTRAINT group_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);

--
-- Name: group_transactions group_transactions_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_transactions
    ADD CONSTRAINT group_transactions_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.expense_groups(id) ON DELETE CASCADE;

--
-- Name: group_transactions group_transactions_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_transactions
    ADD CONSTRAINT group_transactions_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.financial_transactions(id) ON DELETE CASCADE;

--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: schema_migrations schema_migrations_executed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_executed_by_fkey FOREIGN KEY (executed_by) REFERENCES auth.users(id);

--
-- Name: subscription_history subscription_history_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_history
    ADD CONSTRAINT subscription_history_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.user_subscriptions(id) ON DELETE CASCADE;

--
-- Name: subscription_history subscription_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_history
    ADD CONSTRAINT subscription_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: transaction_categories transaction_categories_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_categories
    ADD CONSTRAINT transaction_categories_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.financial_services(id);

--
-- Name: transaction_installments transaction_installments_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_installments
    ADD CONSTRAINT transaction_installments_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id);

--
-- Name: transaction_installments transaction_installments_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_installments
    ADD CONSTRAINT transaction_installments_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.transaction_categories(id);

--
-- Name: transaction_installments transaction_installments_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_installments
    ADD CONSTRAINT transaction_installments_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.expense_groups(id);

--
-- Name: transaction_installments transaction_installments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_installments
    ADD CONSTRAINT transaction_installments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: user_balances user_balances_creditor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_balances
    ADD CONSTRAINT user_balances_creditor_id_fkey FOREIGN KEY (creditor_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: user_balances user_balances_debtor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_balances
    ADD CONSTRAINT user_balances_debtor_id_fkey FOREIGN KEY (debtor_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: user_subscriptions user_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

--
-- Name: user_usage_limits user_usage_limits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_usage_limits
    ADD CONSTRAINT user_usage_limits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- =====================================================
-- SEED - DADOS DE REFERENCIA
-- =====================================================
-- =====================================================
-- PULODOGATO - SEED DE DADOS DE REFERENCIA
-- =====================================================
-- Incluido por scripts/gen-baseline.mjs no fim do 001_baseline.sql.
-- Fica separado para sobreviver a regeneracao do baseline: o pg_dump roda
-- como `paperclip_ro`, que e uma role comum e portanto SUJEITA A RLS -- as
-- policies destas duas tabelas sao `TO anon, authenticated`, entao para o
-- `paperclip_ro` as duas voltam VAZIAS. O seed nao pode ser extraido junto
-- com o schema; ele e mantido aqui.
--
-- PROVENIENCIA: extraido integralmente de producao em 2026-09-18 pela API
-- PostgREST com a chave anon (scripts/extract-schema.mjs). Conferido em
-- 2026-09-21 contra o pg_dump real: a lista de colunas de cada INSERT bate
-- com o catalogo. `created_at` e omitida de proposito (tem DEFAULT now()).
--
-- Os UUIDs sao preservados de proposito: ha dados de producao apontando
-- para eles. Trocar um id aqui orfana transacoes reais.
--
-- CONFERENCIA DOS VALORES (HMO-127): rode
--
--     node scripts/check-seed-vs-prod.mjs [--login]
--
-- que le producao pela mesma API PostgREST e compara campo a campo. Rode
-- depois de mexer neste arquivo e antes de um restore -- nao ha guarda no CI,
-- porque a conferencia depende da rede e de producao estar no ar.
-- Ultima passada limpa: 2026-09-29 (3 + 12 linhas, todos os campos iguais).
--
-- A linha reservada de transferencia (`is_active = FALSE`) NAO entra aqui: ela
-- nasce no 023_categoria_de_transferencia.sql, que e idempotente e roda depois
-- deste seed. O `--login` a enxerga e a reporta como linha extra esperada.
-- =====================================================

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
-- escreve tudo. Depois, 003_fix_trigger_privileges.sql.
-- =====================================================


-- ---------------------------------------------------------------------------
-- 2. 002_rls_lockdown.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - RLS LOCKDOWN
-- =====================================================
-- Migration: 002_rls_lockdown
-- Gerado em: 2026-09-18
--
-- POR QUE ESTE ARQUIVO EXISTE
-- ---------------------------
-- Auditoria de 2026-09-18 contra producao (odxqjvtxsioksguuevqm), usando
-- SOMENTE a chave anon publica e SEM autenticar:
--
--   profiles                2 linhas lidas   (nome, telefone, email, bio)
--   financial_accounts      8 linhas lidas   (banco, limite, saldo)
--   financial_transactions  4 linhas lidas   (valor, data, descricao)
--   expense_groups          6 linhas lidas
--   group_members           7 linhas lidas
--   group_expense_splits    5 linhas lidas
--   group_transactions      3 linhas lidas
--
-- E um INSERT anonimo em `profiles` retornou 23505 (duplicate key), nao 42501
-- (RLS violation) - ou seja, a escrita tambem passa. A chave anon vai embutida
-- no bundle JS publico, entao isso equivale a um banco aberto na internet.
--
-- Este script fecha tudo por padrao e reabre apenas o necessario.
--
-- ATENCAO - TESTAR ANTES DE RODAR EM PRODUCAO:
-- As politicas abaixo foram derivadas dos padroes de acesso do codigo, nao das
-- politicas reais (que nao foi possivel ler sem credencial de Postgres).
-- Rode primeiro num projeto Supabase limpo com 001_baseline.sql, exercite o
-- app, e so depois aplique aqui. Ver database/README.md.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0.0: O ARQUIVO CABE NESTE BANCO?
-- =====================================================
-- As duas primeiras tentativas de aplicar este arquivo em producao pararam em
-- deriva - objeto que existe la e nunca passou por aqui - e cada parada custou
-- um dia, porque so o Helio tem credencial no projeto e o Postgres reporta um
-- erro por vez: corrige, roda de novo, para no proximo.
--
-- Este bloco troca essa fila por uma resposta so. Ele confere de uma vez tudo
-- que as SECOES 1, 2 e 4 assumem sobre o schema - tabela, coluna, role e a
-- constraint de que o ON CONFLICT depende - e, se faltar qualquer coisa, aborta
-- listando o conjunto inteiro antes de tocar em nada.
--
-- Por que abortar em vez de pular a policy da tabela que falta: policy que nao
-- e criada deixa a tabela com RLS ligada e zero policies, ou seja, o app perde
-- a tela. Preferimos parar com a lista na mao e ajustar este arquivo sabendo o
-- que producao tem. A transacao inteira volta atras: nada muda no banco.
--
-- A Q6 do 000_preflight_inventory.sql e esta mesma verificacao em forma de
-- SELECT. Rode aquela primeiro: se voltar 0 linhas, este bloco passa.
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(DISTINCT msg, E'\n' ORDER BY msg) INTO v_faltando
  FROM (
    -- (a) tabelas e colunas citadas pelas policies da SECAO 4 e pelos corpos
    -- das funcoes da SECAO 1. As das funcoes entram aqui de proposito: corpo
    -- de funcao em LANGUAGE SQL/plpgsql nao registra dependencia de coluna, e
    -- por isso a funcao e criada sem erro e so quebra quando o app a chama.
    SELECT CASE
             WHEN to_regclass('public.' || quote_ident(r.tabela)) IS NULL
               THEN format('  - tabela public.%s nao existe', r.tabela)
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || quote_ident(r.tabela))
                      AND a.attname = r.coluna
                      AND a.attnum > 0
                      AND NOT a.attisdropped)
               THEN format('  - coluna public.%s.%s nao existe', r.tabela, r.coluna)
           END AS msg
    FROM (VALUES
      ('profiles', 'id'), ('profiles', 'is_public'),
      ('financial_services', 'is_active'),
      ('transaction_categories', 'is_active'),
      ('financial_accounts', 'user_id'),
      ('financial_transactions', 'id'), ('financial_transactions', 'user_id'),
      ('financial_transactions', 'group_id'),
      ('transaction_installments', 'user_id'),
      ('expense_groups', 'id'), ('expense_groups', 'name'),
      ('expense_groups', 'created_by'), ('expense_groups', 'group_code'),
      ('expense_groups', 'group_type'), ('expense_groups', 'is_active'),
      ('group_members', 'id'), ('group_members', 'group_id'),
      ('group_members', 'user_id'), ('group_members', 'role'),
      ('group_members', 'status'), ('group_members', 'updated_at'),
      ('group_transactions', 'id'), ('group_transactions', 'group_id'),
      ('group_transactions', 'created_by'),
      ('group_expense_splits', 'member_id'),
      ('group_expense_splits', 'group_transaction_id'),
      ('group_member_proportions', 'group_id'),
      ('group_invitations', 'group_id'), ('group_invitations', 'invited_by'),
      ('group_invitations', 'invited_user_id'), ('group_invitations', 'status'),
      ('group_invitations', 'expires_at'),
      ('expense_splits', 'participant_id'), ('expense_splits', 'transaction_id'),
      ('user_balances', 'creditor_id'), ('user_balances', 'debtor_id'),
      ('user_subscriptions', 'user_id'),
      ('user_usage_limits', 'user_id')
    ) AS r(tabela, coluna)

    UNION ALL

    -- (b) as roles do Supabase que a SECAO 2 revoga e concede
    SELECT format('  - role %s nao existe neste banco', r.rolname)
    FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolname = r.rolname)

    UNION ALL

    -- (c) o ON CONFLICT (group_id, user_id) de join_group_by_code precisa de um
    -- indice unico exatamente nessas duas colunas. Sem ele a funcao e criada
    -- sem reclamar (plpgsql nao valida o corpo) e quebra na primeira entrada em
    -- grupo por codigo, com 42P10 - ou seja, em producao, no usuario.
    SELECT '  - falta indice/constraint UNIQUE em public.group_members (group_id, user_id), '
           'que o ON CONFLICT de join_group_by_code exige'
    WHERE to_regclass('public.group_members') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indrelid = to_regclass('public.group_members')
          AND i.indisunique
          AND i.indnkeyatts = 2
          AND (SELECT array_agg(a.attname::TEXT ORDER BY a.attname)
                 FROM unnest(i.indkey::SMALLINT[]) k
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k)
              = ARRAY['group_id', 'user_id'])
  ) x
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'o 002 nao cabe no schema deste banco - nada foi alterado.\nFaltando:\n%\n\nMande esta lista inteira no HMO-120: o arquivo sera ajustado de uma vez, sem mais uma rodada de tentativa e erro.',
      v_faltando
      USING ERRCODE = '42703';
  END IF;

  RAISE NOTICE 'pre-requisitos de schema conferidos: o 002 cabe neste banco';
END $$;

-- =====================================================
-- SECAO 0: ZERAR O ESTADO LEGADO (policies + funcoes)
-- =====================================================
-- Producao tem objetos que nunca passaram por este repositorio. Duas variedades
-- de deriva quebram a aplicacao, e as duas sao tratadas aqui, antes de tudo.
--
-- (a) POLICIES COM OUTRO NOME
-- As policies da SECAO 4 sao dropadas e recriadas pelo nome que este arquivo
-- usa. Isso nao alcanca policy antiga com outro nome (as do painel do Supabase
-- costumam se chamar "Enable read access for all users" e afins).
-- Policies permissivas se somam por OR: uma unica policy esquecida com
-- USING (true) em `authenticated` mantem todo usuario logado lendo os dados de
-- todos os outros, mesmo com RLS ligada e com tudo o que vem abaixo aplicado.
-- Pior: a auditoria anonima de scripts/extract-schema.mjs --audit NAO pega esse
-- caso, porque ela testa sem login - passaria verde com o vazamento aberto.
--
-- (b) FUNCOES AUXILIARES COM OUTRA ASSINATURA
-- Producao ja tem uma `is_group_member` de outra safra. CREATE OR REPLACE so
-- substitui a funcao de assinatura identica, entao a antiga sobrevive ao lado
-- da nova e toda chamada `is_group_member(group_id)` na SECAO 4 passa a ter
-- dois candidatos:
--     ERROR: 42725: function public.is_group_member(uuid) is not unique
-- (foi exatamente onde a primeira tentativa de aplicacao parou, em 2026-09-21).
-- Manter a antiga tambem nao serve: ela e SECURITY DEFINER com regra de
-- visibilidade desconhecida, e passaria a decidir quem ve o que. Entao este
-- arquivo vira a definicao canonica dos dois conjuntos: zera e recria.
--
-- A ORDEM IMPORTA: as policies saem primeiro, porque uma policy que referencia
-- a funcao antiga e uma dependencia e faria o DROP FUNCTION falhar.
--
-- Rode o 000_preflight_inventory.sql antes para ter registro do que existia.

-- 0.1: remover TODAS as policies do schema public
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    RAISE NOTICE 'policy preexistente removida: % em %.%', r.policyname, r.schemaname, r.tablename;
  END LOOP;
END $$;

-- 0.2: remover qualquer versao anterior das funcoes que a SECAO 1 recria,
-- seja qual for a assinatura.
--
-- Sem CASCADE de proposito. Se sobrar objeto dependente que este arquivo nao
-- conhece (uma view, um trigger, uma constraint), o DROP falha, a transacao
-- inteira volta atras e nada em producao muda - que e o desfecho certo. Nesse
-- caso o texto do erro diz qual e o objeto: mande a mensagem no HMO-120.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    -- ::TEXT ja aqui: depois do DROP o regprocedure nao resolve mais o nome e
    -- a NOTICE sairia com o OID cru, que nao serve de registro.
    SELECT p.oid::regprocedure::TEXT AS assinatura
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'is_group_member',
        'is_group_admin',
        'owns_group_member',
        'has_pending_invitation',
        'join_group_by_code'
      )
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.assinatura);
    RAISE NOTICE 'funcao preexistente removida: %', r.assinatura;
  END LOOP;
END $$;

-- =====================================================
-- SECAO 1: FUNCOES AUXILIARES
-- =====================================================
-- SECURITY DEFINER de proposito: sem isso, uma policy de group_members que
-- consulta group_members entra em recursao infinita (erro 42P17).

CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_admin(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id
      AND user_id = auth.uid()
      AND role = 'admin'
      AND status = 'active'
  );
$$;

-- Dono da linha de group_members (usado por splits/proporcoes)
CREATE OR REPLACE FUNCTION public.owns_group_member(p_member_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE id = p_member_id AND user_id = auth.uid()
  );
$$;

-- Convite pendente e valido endereçado a quem esta chamando
CREATE OR REPLACE FUNCTION public.has_pending_invitation(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_invitations
    WHERE group_id = p_group_id
      AND invited_user_id = auth.uid()
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > NOW())
  );
$$;

-- ACL explicita das auxiliares. Ate agora elas nasciam com CREATE OR REPLACE,
-- que preserva a ACL existente; como a SECAO 0.2 passou a dropa-las, cada uma
-- renasce com o padrao do Postgres (EXECUTE para PUBLIC, o que inclui `anon`).
-- Sao SECURITY DEFINER: quem executa le group_members ignorando RLS. Para anon
-- o resultado e sempre falso (auth.uid() e NULL), mas nao ha motivo para expor.
-- As policies da SECAO 4 chamam estas funcoes como `authenticated`, e avaliacao
-- de policy exige EXECUTE - por isso o GRANT abaixo nao e opcional.
REVOKE ALL ON FUNCTION
  public.is_group_member(UUID),
  public.is_group_admin(UUID),
  public.owns_group_member(UUID),
  public.has_pending_invitation(UUID)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.is_group_member(UUID),
  public.is_group_admin(UUID),
  public.owns_group_member(UUID),
  public.has_pending_invitation(UUID)
TO authenticated;

-- Entrar em grupo pelo codigo de 6 caracteres.
--
-- Precisa ser SECURITY DEFINER: a checagem de autorizacao aqui e "conhece o
-- group_code", e isso nao da pra expressar numa policy de RLS - o INSERT em
-- group_members so carrega o group_id, nao o codigo. Sem esta funcao, a policy
-- teria que liberar auto-insercao em qualquer grupo (bastaria descobrir o UUID
-- para virar membro e passar a ler as transacoes do grupo).
-- Nota: a busca do grupo pelo codigo TAMBEM precisa estar aqui dentro. A policy
-- de SELECT de expense_groups so mostra grupos em que voce ja esta - quem esta
-- entrando ainda nao esta, entao um SELECT pelo codigo feito pelo app voltaria
-- vazio. Grupo publico entra como 'active'; privado entra como 'pending', que e
-- a regra que app/api/expense-groups/join/route.ts ja aplicava.
CREATE OR REPLACE FUNCTION public.join_group_by_code(p_group_code TEXT)
RETURNS TABLE (group_id UUID, group_name TEXT, member_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- use_column: as colunas de saida (group_id, ...) tem o mesmo nome de colunas
-- de group_members. Sem esta diretiva, o ON CONFLICT abaixo nao compila
-- ("column reference group_id is ambiguous").
#variable_conflict use_column
DECLARE
  v_group   public.expense_groups%ROWTYPE;
  v_status  TEXT;
  v_current TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_group
  FROM public.expense_groups
  WHERE group_code = UPPER(p_group_code) AND is_active = TRUE;

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'grupo nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;

  -- alias obrigatorio: sem ele, `group_id` colide com a coluna de saida da
  -- funcao (RETURNS TABLE) e o Postgres recusa com "column reference ambiguous".
  SELECT gm.status INTO v_current
  FROM public.group_members gm
  WHERE gm.group_id = v_group.id
    AND gm.user_id = auth.uid();

  IF v_current IN ('active', 'pending') THEN
    RAISE EXCEPTION 'ja e membro (%)', v_current USING ERRCODE = 'unique_violation';
  END IF;

  v_status := CASE WHEN v_group.group_type = 'public' THEN 'active' ELSE 'pending' END;

  INSERT INTO public.group_members AS gm (group_id, user_id, role, status)
  VALUES (v_group.id, auth.uid(), 'member', v_status)
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET status = v_status, updated_at = NOW();

  RETURN QUERY SELECT v_group.id, v_group.name, v_status;
END $$;

REVOKE ALL ON FUNCTION public.join_group_by_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_group_by_code(TEXT) TO authenticated;

-- =====================================================
-- SECAO 2: REVOGAR PRIVILEGIOS DE TABELA DO ANON
-- =====================================================
-- RLS so protege se a role tambem nao tiver privilegio amplo. Hoje `anon`
-- tem SELECT/INSERT/UPDATE/DELETE nas tabelas de dados.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Tabelas de referencia continuam legiveis sem login (o app usa na tela de
-- cadastro de transacao antes de resolver a sessao).
GRANT SELECT ON public.financial_services TO anon;
GRANT SELECT ON public.transaction_categories TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- =====================================================
-- SECAO 3: HABILITAR RLS EM TODAS AS TABELAS
-- =====================================================
-- Percorre o catalogo em vez de listar tabela por tabela: uma lista fixa
-- deixaria de fora qualquer tabela criada em producao que nao esteja no
-- 001_baseline.sql, e e justamente essa que passaria despercebida. Assim a
-- migracao cobre exatamente o mesmo conjunto que a query de verificacao de
-- pg_class no fim do arquivo.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    RAISE NOTICE 'RLS habilitada em public.%', r.relname;
  END LOOP;
END $$;

-- =====================================================
-- SECAO 3.1: (vazia - subiu para a SECAO 0.1)
-- =====================================================
-- A limpeza das policies preexistentes ficava aqui. Ela precisou subir para
-- antes da SECAO 1: policy legada que referencia a funcao legada e dependencia,
-- e travaria o DROP FUNCTION da SECAO 0.2.

-- =====================================================
-- SECAO 4: POLITICAS
-- =====================================================

-- ---------- profiles ----------
DROP POLICY IF EXISTS profiles_select_own_or_public ON public.profiles;
CREATE POLICY profiles_select_own_or_public ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_public = TRUE);

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Sem policy de DELETE: perfil some junto com auth.users (ON DELETE CASCADE).

-- ---------- tabelas de referencia (somente leitura) ----------
DROP POLICY IF EXISTS financial_services_read ON public.financial_services;
CREATE POLICY financial_services_read ON public.financial_services
  FOR SELECT TO anon, authenticated USING (is_active = TRUE);

DROP POLICY IF EXISTS transaction_categories_read ON public.transaction_categories;
CREATE POLICY transaction_categories_read ON public.transaction_categories
  FOR SELECT TO anon, authenticated USING (is_active = TRUE);

-- ---------- financial_accounts ----------
DROP POLICY IF EXISTS financial_accounts_own ON public.financial_accounts;
CREATE POLICY financial_accounts_own ON public.financial_accounts
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------- financial_transactions ----------
-- Dono sempre; membros do grupo so leem o que foi compartilhado no grupo.
DROP POLICY IF EXISTS financial_transactions_select ON public.financial_transactions;
CREATE POLICY financial_transactions_select ON public.financial_transactions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (group_id IS NOT NULL AND public.is_group_member(group_id))
  );

DROP POLICY IF EXISTS financial_transactions_write ON public.financial_transactions;
CREATE POLICY financial_transactions_write ON public.financial_transactions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS financial_transactions_update ON public.financial_transactions;
CREATE POLICY financial_transactions_update ON public.financial_transactions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS financial_transactions_delete ON public.financial_transactions;
CREATE POLICY financial_transactions_delete ON public.financial_transactions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ---------- transaction_installments ----------
DROP POLICY IF EXISTS transaction_installments_own ON public.transaction_installments;
CREATE POLICY transaction_installments_own ON public.transaction_installments
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------- expense_groups ----------
DROP POLICY IF EXISTS expense_groups_select ON public.expense_groups;
CREATE POLICY expense_groups_select ON public.expense_groups
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.is_group_member(id));

DROP POLICY IF EXISTS expense_groups_insert ON public.expense_groups;
CREATE POLICY expense_groups_insert ON public.expense_groups
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS expense_groups_update ON public.expense_groups;
CREATE POLICY expense_groups_update ON public.expense_groups
  FOR UPDATE TO authenticated
  USING (public.is_group_admin(id)) WITH CHECK (public.is_group_admin(id));

DROP POLICY IF EXISTS expense_groups_delete ON public.expense_groups;
CREATE POLICY expense_groups_delete ON public.expense_groups
  FOR DELETE TO authenticated USING (created_by = auth.uid());

-- ---------- group_members ----------
DROP POLICY IF EXISTS group_members_select ON public.group_members;
CREATE POLICY group_members_select ON public.group_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_group_member(group_id));

-- Entrar num grupo exige convite pendente, ou ser admin do grupo. Entrar pelo
-- codigo passa por public.join_group_by_code(), nao por INSERT direto.
DROP POLICY IF EXISTS group_members_insert ON public.group_members;
CREATE POLICY group_members_insert ON public.group_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_group_admin(group_id)
    OR (user_id = auth.uid() AND public.has_pending_invitation(group_id))
  );

DROP POLICY IF EXISTS group_members_update ON public.group_members;
CREATE POLICY group_members_update ON public.group_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_group_admin(group_id))
  WITH CHECK (user_id = auth.uid() OR public.is_group_admin(group_id));

DROP POLICY IF EXISTS group_members_delete ON public.group_members;
CREATE POLICY group_members_delete ON public.group_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_group_admin(group_id));

-- ---------- group_transactions ----------
DROP POLICY IF EXISTS group_transactions_select ON public.group_transactions;
CREATE POLICY group_transactions_select ON public.group_transactions
  FOR SELECT TO authenticated USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS group_transactions_insert ON public.group_transactions;
CREATE POLICY group_transactions_insert ON public.group_transactions
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.is_group_member(group_id));

DROP POLICY IF EXISTS group_transactions_modify ON public.group_transactions;
CREATE POLICY group_transactions_modify ON public.group_transactions
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.is_group_admin(group_id))
  WITH CHECK (created_by = auth.uid() OR public.is_group_admin(group_id));

DROP POLICY IF EXISTS group_transactions_delete ON public.group_transactions;
CREATE POLICY group_transactions_delete ON public.group_transactions
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.is_group_admin(group_id));

-- ---------- group_expense_splits ----------
DROP POLICY IF EXISTS group_expense_splits_select ON public.group_expense_splits;
CREATE POLICY group_expense_splits_select ON public.group_expense_splits
  FOR SELECT TO authenticated
  USING (
    public.owns_group_member(member_id)
    OR EXISTS (
      SELECT 1 FROM public.group_transactions gt
      WHERE gt.id = group_transaction_id AND public.is_group_member(gt.group_id)
    )
  );

DROP POLICY IF EXISTS group_expense_splits_write ON public.group_expense_splits;
CREATE POLICY group_expense_splits_write ON public.group_expense_splits
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.group_transactions gt
    WHERE gt.id = group_transaction_id AND public.is_group_member(gt.group_id)
  ));

-- Cada membro aprova/comenta a propria divisao; admin do grupo ajusta qualquer uma.
DROP POLICY IF EXISTS group_expense_splits_update ON public.group_expense_splits;
CREATE POLICY group_expense_splits_update ON public.group_expense_splits
  FOR UPDATE TO authenticated
  USING (
    public.owns_group_member(member_id)
    OR EXISTS (
      SELECT 1 FROM public.group_transactions gt
      WHERE gt.id = group_transaction_id AND public.is_group_admin(gt.group_id)
    )
  )
  WITH CHECK (
    public.owns_group_member(member_id)
    OR EXISTS (
      SELECT 1 FROM public.group_transactions gt
      WHERE gt.id = group_transaction_id AND public.is_group_admin(gt.group_id)
    )
  );

DROP POLICY IF EXISTS group_expense_splits_delete ON public.group_expense_splits;
CREATE POLICY group_expense_splits_delete ON public.group_expense_splits
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.group_transactions gt
    WHERE gt.id = group_transaction_id AND public.is_group_admin(gt.group_id)
  ));

-- ---------- group_member_proportions ----------
DROP POLICY IF EXISTS group_member_proportions_select ON public.group_member_proportions;
CREATE POLICY group_member_proportions_select ON public.group_member_proportions
  FOR SELECT TO authenticated USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS group_member_proportions_write ON public.group_member_proportions;
CREATE POLICY group_member_proportions_write ON public.group_member_proportions
  FOR ALL TO authenticated
  USING (public.is_group_admin(group_id)) WITH CHECK (public.is_group_admin(group_id));

-- ---------- group_invitations ----------
-- Convidado ve o proprio convite; admin do grupo ve e gerencia os do grupo.
DROP POLICY IF EXISTS group_invitations_select ON public.group_invitations;
CREATE POLICY group_invitations_select ON public.group_invitations
  FOR SELECT TO authenticated
  USING (
    invited_user_id = auth.uid()
    OR invited_by = auth.uid()
    OR public.is_group_admin(group_id)
  );

DROP POLICY IF EXISTS group_invitations_insert ON public.group_invitations;
CREATE POLICY group_invitations_insert ON public.group_invitations
  FOR INSERT TO authenticated
  WITH CHECK (invited_by = auth.uid() AND public.is_group_admin(group_id));

DROP POLICY IF EXISTS group_invitations_update ON public.group_invitations;
CREATE POLICY group_invitations_update ON public.group_invitations
  FOR UPDATE TO authenticated
  USING (invited_user_id = auth.uid() OR public.is_group_admin(group_id))
  WITH CHECK (invited_user_id = auth.uid() OR public.is_group_admin(group_id));

DROP POLICY IF EXISTS group_invitations_delete ON public.group_invitations;
CREATE POLICY group_invitations_delete ON public.group_invitations
  FOR DELETE TO authenticated USING (public.is_group_admin(group_id));

-- ---------- expense_splits ----------
DROP POLICY IF EXISTS expense_splits_select ON public.expense_splits;
CREATE POLICY expense_splits_select ON public.expense_splits
  FOR SELECT TO authenticated
  USING (
    participant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.financial_transactions ft
      WHERE ft.id = transaction_id AND ft.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS expense_splits_insert ON public.expense_splits;
CREATE POLICY expense_splits_insert ON public.expense_splits
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.financial_transactions ft
    WHERE ft.id = transaction_id AND ft.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS expense_splits_update ON public.expense_splits;
CREATE POLICY expense_splits_update ON public.expense_splits
  FOR UPDATE TO authenticated
  USING (
    participant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.financial_transactions ft
      WHERE ft.id = transaction_id AND ft.user_id = auth.uid()
    )
  )
  WITH CHECK (
    participant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.financial_transactions ft
      WHERE ft.id = transaction_id AND ft.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS expense_splits_delete ON public.expense_splits;
CREATE POLICY expense_splits_delete ON public.expense_splits
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.financial_transactions ft
    WHERE ft.id = transaction_id AND ft.user_id = auth.uid()
  ));

-- ---------- user_balances ----------
-- Saldo e derivado; so leitura pelo app. Recalculo roda com service_role.
DROP POLICY IF EXISTS user_balances_select ON public.user_balances;
CREATE POLICY user_balances_select ON public.user_balances
  FOR SELECT TO authenticated
  USING (creditor_id = auth.uid() OR debtor_id = auth.uid());

-- ---------- user_subscriptions ----------
-- Leitura propria apenas. Alteracao de plano NAO pode sair do cliente.
DROP POLICY IF EXISTS user_subscriptions_select ON public.user_subscriptions;
CREATE POLICY user_subscriptions_select ON public.user_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.user_subscriptions FROM authenticated;

-- ---------- user_usage_limits ----------
DROP POLICY IF EXISTS user_usage_limits_select ON public.user_usage_limits;
CREATE POLICY user_usage_limits_select ON public.user_usage_limits
  FOR SELECT TO authenticated USING (user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.user_usage_limits FROM authenticated;

COMMIT;

-- =====================================================
-- VERIFICACAO POS-APLICACAO
-- =====================================================
-- 1) Nenhuma tabela pode ficar sem RLS:
--
--   SELECT relname FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
--   -- deve retornar 0 linhas
--
-- 2) Repetir a auditoria anonima (deve dar 0 linhas em tudo, menos nas duas
--    tabelas de referencia):
--
--   node scripts/extract-schema.mjs --audit
-- =====================================================


-- ---------------------------------------------------------------------------
-- 3. 003_fix_trigger_privileges.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- 003 - CORRIGE OS TRIGGERS QUEBRADOS PELA RLS DO 002
-- =====================================================
-- Encontrado em 2026-09-21 (HMO-123) lendo o banco de producao pela primeira
-- vez, com o papel de leitura `paperclip_ro`.
--
-- O 002 ligou RLS nas tabelas derivadas e deu a elas SO policy de SELECT.
-- A intencao estava certa: user_balances, user_subscriptions, user_usage_limits
-- e subscription_history sao escritas pelo sistema, nunca pelo usuario.
--
-- O que passou batido e que quem faz essa escrita sao TRIGGERS, e os triggers
-- rodam com os privilegios de quem disparou a instrucao -- `authenticated`.
-- Entao eles batem na RLS da propria tabela que deveriam manter e derrubam a
-- transacao inteira do usuario.
--
-- Duas quebras confirmadas, ambas alcancaveis pelo app hoje:
--
--   1. Cadastro de usuario. `lib/hooks/useAuth.ts:101` insere em `profiles`
--      com o JWT do usuario -> trigger `create_user_subscription_trigger` ->
--      `create_free_subscription` tenta INSERT em `user_subscriptions`, onde
--      `authenticated` nao tem nem o grant de INSERT -> "permission denied".
--      A transacao inteira reverte: o usuario fica em auth.users mas sem
--      profile, sem assinatura e sem limites. E `useAuth.ts:106` so faz
--      console.error, entao o cadastro ainda parece ter dado certo na tela.
--
--   2. Aprovar uma divisao de despesa. `app/api/personal-finance/splits/route.ts:173`
--      faz UPDATE em `expense_splits` para status='approved' -> trigger
--      `update_balances_trigger` -> `update_user_balances` tenta INSERT em
--      `user_balances`, que so tem policy de SELECT -> violacao de RLS -> 500.
--
-- Uma terceira funcao tem o mesmo defeito mas nao esta quebrada hoje:
-- `update_usage_limits_on_plan_change` so dispara em UPDATE de
-- `user_subscriptions`, e `authenticated` nao tem grant de UPDATE ali -- so o
-- `service_role` muda plano, e ele tem BYPASSRLS. Fica corrigida junto porque
-- o dia em que existir troca de plano self-service ela quebra igual, e porque
-- o UPDATE dela em `user_usage_limits` falha do jeito pior: sob RLS um UPDATE
-- sem policy nao da erro, so afeta zero linhas. Os limites ficariam
-- silenciosamente errados.
--
-- A correcao e SECURITY DEFINER, nao policy de escrita nova: abrir INSERT/UPDATE
-- dessas tabelas para `authenticated` desfaria exatamente o que o 002 quis
-- fazer -- um usuario poderia forjar o proprio saldo ou o proprio plano.
-- SECURITY DEFINER mantem a tabela fechada para o usuario e deixa so o codigo
-- do trigger escrever.
--
-- `SET search_path` em cada funcao e obrigatorio junto com SECURITY DEFINER:
-- sem isso um objeto plantado num schema que venha antes no search_path do
-- chamador seria executado com os privilegios do dono da funcao.

BEGIN;

-- 1. Cadastro: cria assinatura free e limites de uso.
ALTER FUNCTION public.create_free_subscription()
  SECURITY DEFINER
  SET search_path = public, pg_temp;

-- 2. Aprovacao de divisao: mantem o saldo entre credor e devedor.
ALTER FUNCTION public.update_user_balances()
  SECURITY DEFINER
  SET search_path = public, pg_temp;

-- 3. Troca de plano: ajusta limites e grava o historico.
ALTER FUNCTION public.update_usage_limits_on_plan_change()
  SECURITY DEFINER
  SET search_path = public, pg_temp;

-- SECURITY DEFINER faz a funcao rodar como o dono dela. Estas sao chamadas
-- so por trigger, entao ninguem precisa de EXECUTE direto.
--
-- Ressalva, medida em producao depois de aplicar (2026-09-21): este REVOKE
-- tira o EXECUTE de PUBLIC, mas NAO de `anon`/`authenticated`/`service_role`.
-- O Supabase concede EXECUTE a esses tres EXPLICITAMENTE, via ALTER DEFAULT
-- PRIVILEGES, no momento em que a funcao e criada -- e revogar de PUBLIC nao
-- encosta em grant explicito. O `proacl` continua com `authenticated=X/postgres`.
--
-- Nao virou porta mesmo assim, por outro motivo: as cinco retornam `trigger`,
-- e o Postgres recusa chamada direta de funcao de trigger
-- ("trigger functions can only be called as triggers"). O PostgREST tambem nao
-- expoe esse tipo de retorno como RPC. Ou seja, quem fecha a porta e o tipo de
-- retorno, nao este REVOKE -- ele fica porque e barato e correto em intencao.
-- Se algum dia uma delas deixar de retornar `trigger`, o REVOKE precisa passar
-- a nomear os tres papeis.
REVOKE EXECUTE ON FUNCTION public.create_free_subscription() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_user_balances() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_usage_limits_on_plan_change() FROM PUBLIC;

COMMIT;

-- =====================================================
-- VERIFICACAO (rodar depois do COMMIT)
-- =====================================================
-- Deve voltar as tres funcoes com prosecdef = true:
--
--   SELECT p.proname, p.prosecdef, p.proconfig
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('create_free_subscription', 'update_user_balances',
--                       'update_usage_limits_on_plan_change');
--
-- E `scripts/db-introspect.sh` (passo 7/7) deve voltar a imprimir
-- "ok: nenhum trigger escrevendo em tabela sem policy de escrita".
--
-- =====================================================
-- O QUE ESTA MIGRATION NAO RESOLVE
-- =====================================================
-- Os usuarios que se cadastraram enquanto o bug estava em producao ficaram
-- sem profile/assinatura/limites. Corrigir os triggers nao cria essas linhas
-- retroativamente -- isso e backfill e esta separado, na issue filha do HMO-123,
-- porque precisa primeiro medir quantos usuarios em auth.users nao tem profile.


-- ---------------------------------------------------------------------------
-- 4. 004_fix_remaining_trigger_privileges.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- 004 - O RESTO DA QUEDA DO 002: MAIS DOIS TRIGGERS
-- =====================================================
-- Encontrado em 2026-09-21 (HMO-125), rodando os fluxos quebrados como
-- `authenticated` de verdade no projeto de validacao. O HMO-123 tinha provado
-- a cadeia por catalogo; o papel `paperclip_ro` e so-leitura e nao deixa rodar
-- um INSERT de teste. Com o `postgres` do projeto de validacao deu para
-- executar, e a execucao mostrou duas coisas que a leitura de catalogo nao
-- mostrou.
--
-- 1. O 003 NAO conserta a aprovacao de divisao.
--
--    `update_user_balances` e um AFTER trigger. Antes dele roda
--    `calculate_split_amount`, um BEFORE INSERT OR UPDATE na mesma tabela,
--    tambem em SECURITY INVOKER. Ele faz:
--
--        SELECT ABS(amount) * (NEW.percentage / 100.0) INTO NEW.amount
--        FROM financial_transactions WHERE id = NEW.transaction_id;
--
--    Quem aprova a divisao e o PARTICIPANTE, e a policy de SELECT de
--    `financial_transactions` so mostra a despesa para o dono dela (ou para
--    membro do grupo, mas despesa pessoal nao tem grupo). O SELECT ... INTO
--    nao acha linha, deixa NEW.amount NULL, e a aprovacao morre no NOT NULL
--    de `expense_splits.amount` -- 23502, nao 42501.
--
--    Ou seja: com so o 003 aplicado, aprovar divisao continua dando 500. O
--    erro muda de codigo e o sintoma fica igual.
--
-- 2. Criar grupo de despesa tambem esta quebrado, e o 003 nem encosta nisso.
--
--    `add_group_creator` (AFTER INSERT em `expense_groups`) insere o criador
--    em `group_members` como admin. A policy de INSERT de `group_members` exige
--    `is_group_admin(group_id)`, que consulta `group_members`. No instante em
--    que o trigger roda o criador ainda nao e membro, entao a checagem e
--    circular e sempre falha: 42501, "new row violates row-level security
--    policy for table group_members".
--
-- Os outros triggers em SECURITY INVOKER foram testados no mesmo lote e
-- passaram -- `set_group_code`, `auto_create_group_transaction`,
-- `sync_transaction_with_group`, `calculate_equal_split`,
-- `update_account_balance` e `update_updated_at_column`. Escrevem em tabelas
-- onde o proprio usuario tem grant e policy que da certo. Ficam como estao.
--
-- Reproducao: scripts/hmo125-prove-003.sql e scripts/hmo125-audit-triggers.sql.
-- Os dois rodam dentro de uma transacao que termina em ROLLBACK.
--
-- PRE-REQUISITO: aplicar o 003 antes deste.

BEGIN;

-- 1. Aprovacao/rejeicao de divisao: recalcula o valor lendo a despesa do dono.
--    Precisa enxergar `financial_transactions` de quem nao e o chamador.
ALTER FUNCTION public.calculate_split_amount()
  SECURITY DEFINER
  SET search_path = public, pg_temp;

-- 2. Criacao de grupo: insere o criador como admin antes de ele ser membro.
--    Nao ha risco de forjar dono aqui: a policy de INSERT de `expense_groups`
--    tem WITH CHECK (created_by = auth.uid()), entao quando o trigger roda o
--    NEW.created_by ja esta preso ao chamador. O SECURITY DEFINER so cobre a
--    checagem circular de `group_members`, nao afrouxa quem pode criar grupo.
ALTER FUNCTION public.add_group_creator()
  SECURITY DEFINER
  SET search_path = public, pg_temp;

-- Sao chamadas so por trigger; ninguem precisa de EXECUTE direto.
-- Vale a mesma ressalva do 003: isto tira PUBLIC, nao os grants explicitos que
-- o Supabase da a `anon`/`authenticated`/`service_role`. Quem impede a chamada
-- direta e o tipo de retorno `trigger`. Detalhe completo no 003.
REVOKE EXECUTE ON FUNCTION public.calculate_split_amount() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_group_creator() FROM PUBLIC;

COMMIT;

-- =====================================================
-- VERIFICACAO (rodar depois do COMMIT)
-- =====================================================
--   SELECT p.proname, p.prosecdef, p.proconfig
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('calculate_split_amount', 'add_group_creator');
--
-- As duas com prosecdef = true e search_path setado.
--
-- =====================================================
-- O QUE ESTA MIGRATION NAO RESOLVE
-- =====================================================
-- `expense_splits_update` deixa o participante dar UPDATE na propria linha sem
-- travar `transaction_id` nem `percentage`. Com `calculate_split_amount` em
-- SECURITY DEFINER, um participante que ADIVINHE o UUID de uma despesa alheia
-- pode repontar a divisao para ela e ler o valor recalculado em NEW.amount.
-- O UUID e v4 e nao da para enumerar, entao nao e porta aberta -- mas a policy
-- deveria congelar essas duas colunas. Fica como issue separada: e mudanca de
-- policy, nao de privilegio de funcao, e nao cabe no escopo deste fix.


-- ---------------------------------------------------------------------------
-- 5. 005_recurring_and_scheduled.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - GASTOS FIXOS E CONTAS PREVISTAS
-- =====================================================
-- Migration: 005_recurring_and_scheduled
-- Gerado em: 2026-09-22  (HMO-137, Fase 1 da evolucao do produto)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.recurring_rules        regra de repeticao (gasto/receita fixo)
--   public.scheduled_transactions ocorrencia prevista, com vencimento e status
--
-- A separacao entre "regra" e "ocorrencia" e o que os apps grandes (Mobills,
-- Organizze, YNAB) fazem: a regra guarda "aluguel, todo dia 10, R$ 2.500" e a
-- ocorrencia guarda "aluguel de outubro/2026, vence 10/10, ainda nao pago".
-- Editar a regra nao reescreve o passado; cada ocorrencia tem vida propria,
-- pode ter valor diferente (conta de luz), ser adiada ou cancelada sozinha.
--
-- POR QUE A GERACAO NAO E UMA FUNCAO SQL
-- --------------------------------------
-- A materializacao das ocorrencias vive em lib/recurrence.ts, no app. As
-- migrations 003 e 004 existiram justamente para consertar triggers que
-- gravavam em tabela derivada sem SECURITY DEFINER; repetir esse padrao aqui
-- para calcular datas nao paga o risco. O unico trigger criado abaixo e o
-- update_updated_at_column, que so escreve em NEW.
--
-- RELACAO COM transaction_installments
-- ------------------------------------
-- Parcelamento (12x no cartao) continua em transaction_installments: e uma
-- divida fechada, com total conhecido. `scheduled_transactions` e a conta que
-- se repete sem fim definido (aluguel, escola, streaming) ou o lancamento
-- avulso que ainda vai vencer. As duas convivem.
--
-- COMO RODAR
-- ----------
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/005_recurring_and_scheduled.sql
--
-- Aplicar em producao depois de 001 -> 002 -> 003 -> 004. O bloco de preflight
-- abaixo aborta a transacao inteira se faltar qualquer pre-requisito, listando
-- tudo de uma vez - o Postgres reporta um erro por vez e cada ida e volta com
-- producao custa um dia.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: O ARQUIVO CABE NESTE BANCO?
-- =====================================================
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(DISTINCT msg, E'\n' ORDER BY msg) INTO v_faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.' || quote_ident(r.tabela)) IS NULL
               THEN format('  - tabela public.%s nao existe', r.tabela)
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || quote_ident(r.tabela))
                      AND a.attname = r.coluna
                      AND a.attnum > 0
                      AND NOT a.attisdropped)
               THEN format('  - coluna public.%s.%s nao existe', r.tabela, r.coluna)
           END AS msg
    FROM (VALUES
      ('profiles', 'id'),
      ('financial_accounts', 'id'),
      ('transaction_categories', 'id'),
      ('financial_transactions', 'id'),
      ('expense_groups', 'id'),
      ('group_members', 'group_id'),
      ('schema_migrations', 'version')
    ) AS r(tabela, coluna)

    UNION ALL
    -- o ENUM que as duas tabelas reusam
    SELECT '  - tipo public.transaction_financial_type nao existe'
    WHERE to_regtype('public.transaction_financial_type') IS NULL

    UNION ALL
    -- funcoes de que as policies e o trigger dependem
    SELECT format('  - funcao public.%s nao existe', f.nome)
    FROM (VALUES
      ('update_updated_at_column()'),
      ('is_group_member(uuid)')
    ) AS f(nome)
    WHERE to_regprocedure('public.' || f.nome) IS NULL

    UNION ALL
    -- roles do Supabase
    SELECT format('  - role %s nao existe', r.rolname)
    FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname = r.rolname)
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'005 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> 002 -> 003 -> 004 antes.', v_faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: ENUMS
-- =====================================================
-- CREATE TYPE nao aceita IF NOT EXISTS; o DO torna o arquivo re-executavel.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recurrence_frequency'
                   AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.recurrence_frequency AS ENUM (
      'weekly',      -- semanal
      'biweekly',    -- quinzenal
      'monthly',     -- mensal
      'bimonthly',   -- bimestral
      'quarterly',   -- trimestral
      'semiannual',  -- semestral
      'annual'       -- anual
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scheduled_status'
                   AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.scheduled_status AS ENUM (
      'pending',    -- prevista, ainda nao venceu
      'paid',       -- paga/recebida, virou financial_transaction
      'overdue',    -- venceu e nao foi paga (derivado; ver SECAO 5)
      'skipped',    -- pulada neste mes, sem cancelar a regra
      'cancelled'   -- cancelada de vez
    );
  END IF;
END $$;

-- =====================================================
-- SECAO 2: recurring_rules  (gastos e receitas fixos)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.recurring_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    category_id uuid NOT NULL,
    account_id uuid,
    group_id uuid,
    description text NOT NULL,
    amount numeric(15,2) NOT NULL,
    transaction_type public.transaction_financial_type NOT NULL DEFAULT 'expense',
    frequency public.recurrence_frequency NOT NULL DEFAULT 'monthly',
    -- de quantos em quantos periodos: frequency='monthly' + interval_count=3
    -- equivale a trimestral, e existe para o caso que o ENUM nao cobre.
    interval_count integer NOT NULL DEFAULT 1,
    -- dia do vencimento. Em mes curto, o app fixa no ultimo dia do mes
    -- (dia 31 em fevereiro vira 28/29) - ver lib/recurrence.ts.
    due_day integer,
    start_date date NOT NULL DEFAULT CURRENT_DATE,
    end_date date,
    -- quantas ocorrencias no total; NULL = sem fim definido
    max_occurrences integer,
    -- quantos dias antes avisar (usado pela tela de proximos vencimentos)
    reminder_days integer NOT NULL DEFAULT 3,
    -- se true, a ocorrencia vencida vira transacao sozinha quando o usuario
    -- confirmar em lote; nunca lanca dinheiro sem acao humana.
    auto_post boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT recurring_rules_pkey PRIMARY KEY (id),
    CONSTRAINT recurring_rules_amount_check CHECK (amount > (0)::numeric),
    CONSTRAINT recurring_rules_interval_check CHECK (interval_count > 0 AND interval_count <= 60),
    CONSTRAINT recurring_rules_due_day_check CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 31)),
    CONSTRAINT recurring_rules_reminder_check CHECK (reminder_days >= 0 AND reminder_days <= 90),
    CONSTRAINT recurring_rules_end_check CHECK (end_date IS NULL OR end_date >= start_date),
    CONSTRAINT recurring_rules_max_occurrences_check CHECK (max_occurrences IS NULL OR max_occurrences > 0),
    CONSTRAINT recurring_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT recurring_rules_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.transaction_categories(id),
    CONSTRAINT recurring_rules_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id),
    CONSTRAINT recurring_rules_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.expense_groups(id)
);

COMMENT ON TABLE public.recurring_rules IS
  'Gastos e receitas fixos: a regra de repeticao. As ocorrencias ficam em scheduled_transactions.';

CREATE INDEX IF NOT EXISTS idx_recurring_rules_user ON public.recurring_rules (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_recurring_rules_group ON public.recurring_rules (group_id) WHERE group_id IS NOT NULL;

-- =====================================================
-- SECAO 3: scheduled_transactions  (contas previstas)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.scheduled_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    recurring_rule_id uuid,
    category_id uuid NOT NULL,
    account_id uuid,
    group_id uuid,
    description text NOT NULL,
    amount numeric(15,2) NOT NULL,
    due_date date NOT NULL,
    status public.scheduled_status NOT NULL DEFAULT 'pending',
    paid_date date,
    -- transacao real criada quando a conta foi paga; e o elo que impede
    -- contar a mesma despesa duas vezes (uma prevista + uma realizada).
    transaction_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT scheduled_transactions_pkey PRIMARY KEY (id),
    CONSTRAINT scheduled_transactions_amount_check CHECK (amount > (0)::numeric),
    -- status 'paid' exige data e transacao; o resto nao pode ter nenhuma das duas
    CONSTRAINT scheduled_transactions_paid_check CHECK (
      (status = 'paid' AND paid_date IS NOT NULL AND transaction_id IS NOT NULL)
      OR (status <> 'paid' AND paid_date IS NULL AND transaction_id IS NULL)
    ),
    CONSTRAINT scheduled_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT scheduled_transactions_rule_id_fkey FOREIGN KEY (recurring_rule_id) REFERENCES public.recurring_rules(id) ON DELETE CASCADE,
    CONSTRAINT scheduled_transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.transaction_categories(id),
    CONSTRAINT scheduled_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id),
    CONSTRAINT scheduled_transactions_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.expense_groups(id),
    CONSTRAINT scheduled_transactions_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.financial_transactions(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.scheduled_transactions IS
  'Contas previstas (a pagar e a receber). Uma linha por vencimento.';

-- A geracao roda varias vezes sobre o mesmo periodo (toda vez que a tela abre).
-- Este indice e o que torna isso idempotente: a mesma regra nao materializa o
-- mesmo vencimento duas vezes.
--
-- Nao e indice parcial (WHERE recurring_rule_id IS NOT NULL) por dois motivos.
-- Primeiro, nao precisa: no Postgres dois NULL nunca colidem num indice unico,
-- entao lancamento avulso continua podendo repetir no mesmo dia - duas contas
-- de luz com o mesmo vencimento sao legitimas. Segundo, um indice parcial
-- quebraria o upsert: o ON CONFLICT (recurring_rule_id, due_date) que o
-- PostgREST monta nao consegue inferir um indice com predicado e estoura 42P10
-- "no unique or exclusion constraint matching the ON CONFLICT specification".
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_rule_due_unique
  ON public.scheduled_transactions (recurring_rule_id, due_date);

CREATE INDEX IF NOT EXISTS idx_scheduled_user_due ON public.scheduled_transactions (user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_scheduled_status ON public.scheduled_transactions (user_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_scheduled_group ON public.scheduled_transactions (group_id, due_date) WHERE group_id IS NOT NULL;

-- =====================================================
-- SECAO 4: updated_at
-- =====================================================
DROP TRIGGER IF EXISTS update_recurring_rules_updated_at ON public.recurring_rules;
CREATE TRIGGER update_recurring_rules_updated_at
  BEFORE UPDATE ON public.recurring_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_scheduled_transactions_updated_at ON public.scheduled_transactions;
CREATE TRIGGER update_scheduled_transactions_updated_at
  BEFORE UPDATE ON public.scheduled_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- SECAO 5: visao de vencidas
-- =====================================================
-- 'overdue' nao e gravado: seria um status que envelhece sozinho e exigiria um
-- job diario so para virar a chave a meia-noite. A conta esta vencida quando
-- due_date < hoje e status = 'pending' - isso e uma pergunta, nao um estado.
-- A view existe para que a resposta seja a mesma no app, no SQL e no relatorio.
CREATE OR REPLACE VIEW public.scheduled_transactions_effective AS
  SELECT
    s.*,
    CASE
      WHEN s.status = 'pending' AND s.due_date < CURRENT_DATE THEN 'overdue'::public.scheduled_status
      ELSE s.status
    END AS effective_status,
    (s.due_date - CURRENT_DATE) AS days_until_due
  FROM public.scheduled_transactions s;

COMMENT ON VIEW public.scheduled_transactions_effective IS
  'scheduled_transactions com o status vencido calculado na hora (nunca gravado).';

-- =====================================================
-- SECAO 6: RLS
-- =====================================================
-- Mesmo desenho do 002: nega por padrao, libera o dono e - para linhas de
-- grupo - os membros do grupo. Sem policy para anon: a chave anon vai no
-- bundle publico.
-- Sem FORCE ROW LEVEL SECURITY, igual as 18 tabelas do 002: o app nunca conecta
-- como dono da tabela, e ligar FORCE so nestas duas criaria uma diferenca em
-- relforcerowsecurity que a Q1 do 000_preflight_inventory.sql leria como deriva.
ALTER TABLE public.recurring_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_transactions ENABLE ROW LEVEL SECURITY;

-- ---------- recurring_rules ----------
DROP POLICY IF EXISTS recurring_rules_select ON public.recurring_rules;
CREATE POLICY recurring_rules_select ON public.recurring_rules
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (group_id IS NOT NULL AND public.is_group_member(group_id))
  );

DROP POLICY IF EXISTS recurring_rules_insert ON public.recurring_rules;
CREATE POLICY recurring_rules_insert ON public.recurring_rules
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS recurring_rules_update ON public.recurring_rules;
CREATE POLICY recurring_rules_update ON public.recurring_rules
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS recurring_rules_delete ON public.recurring_rules;
CREATE POLICY recurring_rules_delete ON public.recurring_rules
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ---------- scheduled_transactions ----------
DROP POLICY IF EXISTS scheduled_transactions_select ON public.scheduled_transactions;
CREATE POLICY scheduled_transactions_select ON public.scheduled_transactions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (group_id IS NOT NULL AND public.is_group_member(group_id))
  );

DROP POLICY IF EXISTS scheduled_transactions_insert ON public.scheduled_transactions;
CREATE POLICY scheduled_transactions_insert ON public.scheduled_transactions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS scheduled_transactions_update ON public.scheduled_transactions;
CREATE POLICY scheduled_transactions_update ON public.scheduled_transactions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS scheduled_transactions_delete ON public.scheduled_transactions;
CREATE POLICY scheduled_transactions_delete ON public.scheduled_transactions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =====================================================
-- SECAO 7: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes destas tabelas existirem, e
-- ALL TABLES nao alcanca o futuro. Sem estas linhas, as tabelas novas ficam
-- invisiveis para o app mesmo com as policies certas.
REVOKE ALL ON public.recurring_rules FROM anon;
REVOKE ALL ON public.scheduled_transactions FROM anon;
REVOKE ALL ON public.scheduled_transactions_effective FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_transactions TO authenticated;
GRANT SELECT ON public.scheduled_transactions_effective TO authenticated;

-- A view roda com os privilegios do dono (security definer por padrao no
-- Postgres < 15 e ainda o default em 15+). O RLS da tabela base so vale para a
-- view se ela for security_invoker - sem isto, a view devolve a agenda de
-- todo mundo para qualquer usuario logado.
ALTER VIEW public.scheduled_transactions_effective SET (security_invoker = true);

-- =====================================================
-- SECAO 8: registro
-- =====================================================
-- A coluna e `executed_at`, nao `applied_at`; e o ON CONFLICT depende da
-- constraint schema_migrations_version_key, conferida na SECAO 0.
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('005', '005_recurring_and_scheduled',
        'Gastos fixos (recurring_rules) e contas previstas (scheduled_transactions) - HMO-137', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 6. 006_budgets_and_card_invoices.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - ORCAMENTO POR CATEGORIA E FATURA DE CARTAO
-- =====================================================
-- Migration: 006_budgets_and_card_invoices
-- Gerado em: 2026-09-22  (HMO-137, Fase 2 da evolucao do produto)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.budgets                 teto de gasto por categoria e por mes
--   public.budget_consumption      quanto ja foi gasto de cada teto (view)
--   financial_accounts.closing_day dia do fechamento da fatura
--   financial_accounts.due_day     dia do vencimento da fatura
--   public.card_invoice_month()    em que fatura cai uma compra
--   public.card_invoice_lines      cada compra no cartao com a fatura dela (view)
--
-- ORCAMENTO: POR QUE UMA LINHA POR MES
-- ------------------------------------
-- A alternativa seria uma linha por categoria com validade aberta ("R$ 800 de
-- mercado, a partir de marco"). Fica mais enxuto e e pior: o teto de dezembro
-- nao pode ser diferente sem fechar o periodo e abrir outro, e qualquer
-- correcao no valor reescreve o julgamento de todos os meses passados -- "voce
-- estourou o mercado em agosto" mudaria de resposta hoje.
--
-- Uma linha por (categoria, mes) e o mesmo desenho que o 005 usou para regra x
-- ocorrencia, e pela mesma razao: o passado nao pode se mexer. O custo e ter
-- que criar as linhas do mes seguinte; `carry_forward` marca quais o app
-- recria, em lib/services/budget.ts, e o indice unico abaixo torna isso
-- idempotente igual a agenda da Fase 1.
--
-- CONSUMO NAO E COLUNA
-- --------------------
-- `spent` sai da soma de financial_transactions na hora da leitura. Guardar o
-- consumido exigiria trigger em financial_transactions -- exatamente a familia
-- de trigger que as migrations 003 e 004 existiram para consertar, e desta vez
-- sobre a tabela de dinheiro. Editar uma transacao de mes passado tambem teria
-- que reabrir o orcamento daquele mes. A soma na leitura nao tem esse problema.
--
-- FATURA DE CARTAO: O QUE ESTE ARQUIVO **NAO** FAZ
-- ------------------------------------------------
-- Nao mexe em current_balance nem no trigger update_account_balance. O saldo de
-- cartao continua sendo calculado exatamente como hoje. A fatura aqui e uma
-- LEITURA (em que fatura a compra do dia 28 caiu) mais duas colunas de
-- configuracao. Fechar a fatura como conta a pagar reusa scheduled_transactions
-- da Fase 1 e acontece no app, nao no banco.
--
-- Essa foi uma decisao de risco deliberada: o plano da HMO-137 marcou a fatura
-- como a mudanca mais perigosa da Fase 2 justamente por encostar no saldo
-- mantido por trigger. Ela nao encosta.
--
-- COMO RODAR
-- ----------
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/006_budgets_and_card_invoices.sql
--
-- Aplicar depois de 001 -> 002 -> 003 -> 004 -> 005. O preflight abaixo aborta
-- a transacao inteira se faltar qualquer pre-requisito, listando tudo de uma
-- vez -- o Postgres reporta um erro por vez e cada ida e volta com producao
-- custa um dia.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: O ARQUIVO CABE NESTE BANCO?
-- =====================================================
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(DISTINCT msg, E'\n' ORDER BY msg) INTO v_faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.' || quote_ident(r.tabela)) IS NULL
               THEN format('  - tabela public.%s nao existe', r.tabela)
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || quote_ident(r.tabela))
                      AND a.attname = r.coluna
                      AND a.attnum > 0
                      AND NOT a.attisdropped)
               THEN format('  - coluna public.%s.%s nao existe', r.tabela, r.coluna)
           END AS msg
    FROM (VALUES
      ('financial_accounts', 'account_type'),
      ('transaction_categories', 'id'),
      ('financial_transactions', 'transaction_date'),
      ('financial_transactions', 'transaction_type'),
      ('financial_transactions', 'group_id'),
      ('expense_groups', 'id'),
      ('schema_migrations', 'version'),
      -- a Fase 2 fecha a fatura como conta prevista: sem o 005 isso nao existe
      ('scheduled_transactions', 'due_date')
    ) AS r(tabela, coluna)

    UNION ALL
    SELECT format('  - tipo public.%s nao existe', t.nome)
    FROM (VALUES ('transaction_financial_type'), ('account_type')) AS t(nome)
    WHERE to_regtype('public.' || t.nome) IS NULL

    UNION ALL
    SELECT format('  - funcao public.%s nao existe', f.nome)
    FROM (VALUES
      ('update_updated_at_column()'),
      ('is_group_member(uuid)')
    ) AS f(nome)
    WHERE to_regprocedure('public.' || f.nome) IS NULL

    UNION ALL
    SELECT format('  - role %s nao existe', r.rolname)
    FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname = r.rolname)

    UNION ALL
    -- 'credit_card' tem que ser um valor do enum account_type, senao a view de
    -- faturas filtra por um rotulo que nunca casa e sai sempre vazia -- sem
    -- erro nenhum, que e o pior jeito de descobrir.
    SELECT '  - o enum public.account_type nao tem o valor ''credit_card'''
    WHERE to_regtype('public.account_type') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_enum e
        WHERE e.enumtypid = 'public.account_type'::regtype
          AND e.enumlabel = 'credit_card')
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'006 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> 002 -> 003 -> 004 -> 005 antes.', v_faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: budgets  (teto por categoria e mes)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.budgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    category_id uuid NOT NULL,
    -- teto da casa/viagem: o consumo passa a somar o gasto do grupo inteiro,
    -- nao so o de quem cadastrou. NULL = orcamento pessoal.
    group_id uuid,
    -- sempre o dia 1: o mes e a unidade do orcamento, e gravar dia 1 deixa o
    -- indice unico e o BETWEEN da view sem caso especial.
    month date NOT NULL,
    amount_limit numeric(15,2) NOT NULL,
    -- fracao do teto que ja acende o alerta amarelo. 0.8 = avisa aos 80%.
    alert_threshold numeric(4,3) NOT NULL DEFAULT 0.800,
    -- o app recria esta linha no mes seguinte. Ficar false e o jeito de dizer
    -- "isto era so de dezembro".
    carry_forward boolean NOT NULL DEFAULT true,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT budgets_pkey PRIMARY KEY (id),
    CONSTRAINT budgets_amount_check CHECK (amount_limit > (0)::numeric),
    CONSTRAINT budgets_threshold_check CHECK (alert_threshold > (0)::numeric AND alert_threshold <= (1)::numeric),
    -- a unica forma de month nao ser dia 1 e alguem escrever direto no SQL
    -- Editor; a partir dai o indice unico deixa de impedir o teto duplicado.
    CONSTRAINT budgets_month_is_first_day CHECK (month = date_trunc('month', month)::date),
    CONSTRAINT budgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT budgets_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.transaction_categories(id),
    CONSTRAINT budgets_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.expense_groups(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.budgets IS
  'Teto de gasto por categoria e mes. Uma linha por (usuario, categoria, grupo, mes).';
COMMENT ON COLUMN public.budgets.month IS
  'Primeiro dia do mes orcado. O CHECK garante isso.';
COMMENT ON COLUMN public.budgets.carry_forward IS
  'Se true, lib/services/budget.ts recria a linha no mes seguinte.';

-- Um teto por categoria por mes -- e aqui o 006 faz o CONTRARIO do 005 de
-- proposito, entao vale dizer por que.
--
-- O 005 evitou indice parcial porque o ON CONFLICT que o PostgREST monta nao
-- consegue inferir um indice com predicado (42P10). Um indice comum sobre
-- (user_id, category_id, group_id, month) resolveria isso aqui tambem -- e
-- estaria errado: em Postgres dois NULL nunca colidem num indice unico, entao
-- ele deixaria passar DOIS orcamentos pessoais da mesma categoria no mesmo
-- mes, que e justamente o que ele deveria impedir.
--
-- Entao os dois indices sao parciais, a constraint fica correta, e quem paga a
-- conta e o app: repetirOrcamentos() em lib/services/budget.ts le o mes
-- destino e insere so o que falta, em vez de usar upsert. Corrida continua
-- coberta -- o indice devolve 23505 e a rota trata como "ja estava la".
CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_pessoal_unico
  ON public.budgets (user_id, category_id, month)
  WHERE group_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_grupo_unico
  ON public.budgets (group_id, category_id, month)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_budgets_user_month ON public.budgets (user_id, month DESC);

DROP TRIGGER IF EXISTS update_budgets_updated_at ON public.budgets;
CREATE TRIGGER update_budgets_updated_at
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- SECAO 2: fatura de cartao - configuracao
-- =====================================================
-- ADD COLUMN IF NOT EXISTS para o arquivo continuar re-executavel.
ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS closing_day integer,
  ADD COLUMN IF NOT EXISTS due_day integer;

COMMENT ON COLUMN public.financial_accounts.closing_day IS
  'Dia do fechamento da fatura (cartao). Compra depois dele cai na fatura seguinte.';
COMMENT ON COLUMN public.financial_accounts.due_day IS
  'Dia do vencimento da fatura (cartao). Pode ser menor que closing_day: vence no mes seguinte.';

-- Os CHECK nao entram com IF NOT EXISTS (nao existe); o DO deixa re-executavel.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.financial_accounts'::regclass
                    AND conname = 'financial_accounts_closing_day_check') THEN
    ALTER TABLE public.financial_accounts
      ADD CONSTRAINT financial_accounts_closing_day_check
      CHECK (closing_day IS NULL OR (closing_day >= 1 AND closing_day <= 31));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.financial_accounts'::regclass
                    AND conname = 'financial_accounts_due_day_check') THEN
    ALTER TABLE public.financial_accounts
      ADD CONSTRAINT financial_accounts_due_day_check
      CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 31));
  END IF;
END $$;

-- =====================================================
-- SECAO 3: em que fatura cai uma compra
-- =====================================================
-- A regra do mercado (Nubank, Itau, Mobills): compra ATE o dia do fechamento
-- entra na fatura do proprio mes; depois dele, na do mes seguinte.
--
-- Fechamento dia 31 em fevereiro: o dia 31 nao existe, entao "ate o
-- fechamento" precisa virar "ate o ultimo dia do mes" -- sem o LEAST abaixo,
-- nenhuma compra de fevereiro fecharia e todas escorregariam para marco.
--
-- IMMUTABLE porque depende so dos argumentos: e o que permite indexar a
-- expressao depois, se a view ficar pesada.
CREATE OR REPLACE FUNCTION public.card_invoice_month(
  p_transaction_date date,
  p_closing_day integer
) RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    -- cartao sem fechamento configurado: a compra e da fatura do proprio mes.
    WHEN p_closing_day IS NULL THEN date_trunc('month', p_transaction_date)::date
    WHEN EXTRACT(DAY FROM p_transaction_date) <= LEAST(
           p_closing_day,
           EXTRACT(DAY FROM (date_trunc('month', p_transaction_date)
                             + INTERVAL '1 month - 1 day'))::integer)
      THEN date_trunc('month', p_transaction_date)::date
    ELSE (date_trunc('month', p_transaction_date) + INTERVAL '1 month')::date
  END;
$$;

COMMENT ON FUNCTION public.card_invoice_month(date, integer) IS
  'Primeiro dia do mes da fatura em que a compra cai. Fonte unica desta regra.';

-- Vencimento da fatura: due_day do mes da fatura, ou do mes seguinte quando o
-- vencimento vem antes do fechamento (fecha dia 28, vence dia 5). Clampa o dia
-- ao ultimo do mes pelo mesmo motivo do LEAST acima.
CREATE OR REPLACE FUNCTION public.card_invoice_due_date(
  p_invoice_month date,
  p_closing_day integer,
  p_due_day integer
) RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE WHEN p_due_day IS NULL THEN NULL ELSE
    (base + (LEAST(
       p_due_day,
       EXTRACT(DAY FROM (base + INTERVAL '1 month - 1 day'))::integer
     ) - 1) * INTERVAL '1 day')::date
  END
  FROM (
    SELECT CASE
             WHEN p_closing_day IS NOT NULL AND p_due_day <= p_closing_day
               THEN (date_trunc('month', p_invoice_month) + INTERVAL '1 month')
             ELSE date_trunc('month', p_invoice_month)
           END AS base
  ) AS b;
$$;

COMMENT ON FUNCTION public.card_invoice_due_date(date, integer, integer) IS
  'Data de vencimento da fatura daquele mes. NULL quando o cartao nao tem due_day.';

-- =====================================================
-- SECAO 4: card_invoice_lines  (cada compra com a fatura dela)
-- =====================================================
-- Nao e tabela: a fatura e uma pergunta sobre lancamentos que ja existem. Uma
-- tabela precisaria ser mantida em sincronia a cada edicao de transacao -- de
-- novo, trigger sobre a tabela de dinheiro.
CREATE OR REPLACE VIEW public.card_invoice_lines AS
  SELECT
    t.id                AS transaction_id,
    t.user_id,
    t.account_id,
    a.name              AS account_name,
    a.closing_day,
    a.due_day,
    t.category_id,
    t.description,
    t.amount,
    -- O total da fatura e SUM(invoice_amount), nao SUM(amount).
    -- Despesa e gravada negativa e estorno/pagamento positivo (ver a nota de
    -- sinal na SECAO 5), entao inverter o sinal aqui faz a compra somar e o
    -- estorno abater, que e exatamente o que a fatura deve mostrar. Somar
    -- amount cru daria a fatura com o sinal trocado; somar ABS faria o estorno
    -- AUMENTAR o que se deve.
    (-t.amount) AS invoice_amount,
    t.transaction_date,
    t.transaction_type,
    t.group_id,
    public.card_invoice_month(t.transaction_date, a.closing_day) AS invoice_month,
    public.card_invoice_due_date(
      public.card_invoice_month(t.transaction_date, a.closing_day),
      a.closing_day, a.due_day)                                  AS invoice_due_date
  FROM public.financial_transactions t
  JOIN public.financial_accounts a ON a.id = t.account_id
  WHERE a.account_type = 'credit_card'
    -- estorno e pagamento da fatura nao sao compra; entram como income na
    -- conta do cartao e abatem o total.
    AND t.transaction_type IN ('expense', 'income');

COMMENT ON VIEW public.card_invoice_lines IS
  'Lancamentos de cartao com o mes e o vencimento da fatura em que caem.';

-- =====================================================
-- SECAO 5: budget_consumption  (quanto ja foi gasto de cada teto)
-- =====================================================
-- `spent` soma as despesas da categoria no mes. Tres decisoes:
--
-- 1) orcamento de grupo soma o gasto de TODOS os membros (t.group_id = b.group_id);
--    orcamento pessoal soma so o do dono E ignora o que ja esta rateado num
--    grupo -- senao a despesa da viagem consumiria os dois tetos.
-- 2) so 'expense'. Um estorno lancado como income da categoria nao devolve
--    espaco no teto; para isso o caminho e corrigir a despesa.
-- 3) **ABS(t.amount)**, e esta e a linha que mais importa. Neste banco despesa
--    e gravada NEGATIVA: lib/services/scheduled.ts:valorComSinal faz
--    `-Math.abs(amount)`, e o trigger update_account_balance soma NEW.amount
--    direto no saldo. Um SUM(t.amount) cru devolveria -800 para quem gastou
--    800: o consumo ficaria negativo, consumed_ratio negativo, e o status
--    seria 'ok' para sempre -- o alerta de estouro simplesmente nunca
--    dispararia, sem erro nenhum aparecer. O resto do app ja le assim
--    (Math.abs em balances, transfers e split-suggestions).
CREATE OR REPLACE VIEW public.budget_consumption AS
  SELECT
    b.id,
    b.user_id,
    b.category_id,
    b.group_id,
    b.month,
    b.amount_limit,
    b.alert_threshold,
    b.carry_forward,
    b.notes,
    b.created_at,
    b.updated_at,
    COALESCE(g.spent, 0)::numeric(15,2) AS spent,
    (b.amount_limit - COALESCE(g.spent, 0))::numeric(15,2) AS remaining,
    -- percentual com 4 casas; a tela arredonda. Divisao sem risco de zero: o
    -- CHECK garante amount_limit > 0.
    ROUND(COALESCE(g.spent, 0) / b.amount_limit, 4) AS consumed_ratio,
    CASE
      WHEN COALESCE(g.spent, 0) >= b.amount_limit THEN 'exceeded'
      WHEN COALESCE(g.spent, 0) >= b.amount_limit * b.alert_threshold THEN 'alert'
      ELSE 'ok'
    END AS consumption_status
  FROM public.budgets b
  LEFT JOIN LATERAL (
    SELECT SUM(ABS(t.amount)) AS spent
    FROM public.financial_transactions t
    WHERE t.category_id = b.category_id
      AND t.transaction_type = 'expense'
      AND t.transaction_date >= b.month
      AND t.transaction_date < (b.month + INTERVAL '1 month')::date
      AND CASE
            WHEN b.group_id IS NOT NULL THEN t.group_id = b.group_id
            ELSE t.user_id = b.user_id AND t.group_id IS NULL
          END
  ) AS g ON TRUE;

COMMENT ON VIEW public.budget_consumption IS
  'budgets com o consumido, o que resta e o status (ok/alert/exceeded) calculados na leitura.';

-- =====================================================
-- SECAO 6: RLS
-- =====================================================
-- Mesmo desenho do 002 e do 005: nega por padrao, libera o dono e - nas linhas
-- de grupo - os membros. Sem policy para anon: a chave anon vai no bundle
-- publico.
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budgets_select ON public.budgets;
CREATE POLICY budgets_select ON public.budgets
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (group_id IS NOT NULL AND public.is_group_member(group_id))
  );

DROP POLICY IF EXISTS budgets_insert ON public.budgets;
CREATE POLICY budgets_insert ON public.budgets
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS budgets_update ON public.budgets;
CREATE POLICY budgets_update ON public.budgets
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS budgets_delete ON public.budgets;
CREATE POLICY budgets_delete ON public.budgets
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =====================================================
-- SECAO 7: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes destes objetos existirem, e ALL
-- TABLES nao alcanca o futuro.
REVOKE ALL ON public.budgets FROM anon;
REVOKE ALL ON public.budget_consumption FROM anon;
REVOKE ALL ON public.card_invoice_lines FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO authenticated;
GRANT SELECT ON public.budget_consumption TO authenticated;
GRANT SELECT ON public.card_invoice_lines TO authenticated;

-- Sem security_invoker a view roda com o privilegio do dono e a RLS da tabela
-- base nao vale: budget_consumption devolveria o orcamento de todo mundo, e
-- card_invoice_lines a fatura de todo mundo, para qualquer usuario logado.
-- Mesma pegadinha da SECAO 7 do 005.
ALTER VIEW public.budget_consumption SET (security_invoker = true);
ALTER VIEW public.card_invoice_lines SET (security_invoker = true);

-- As funcoes sao IMMUTABLE e so fazem aritmetica de data; nao leem tabela e
-- por isso nao precisam de SECURITY DEFINER (o oposto do caso das 003/004).
--
-- Fechar a execucao para anon exige DOIS revokes, e cada um sozinho e um
-- falso negativo:
--
--   PUBLIC  - o Postgres concede EXECUTE a PUBLIC em toda funcao nova, e anon
--             faz parte de PUBLIC. Este e o vazamento num banco cru.
--   anon    - o Supabase concede EXECUTE a anon/authenticated/service_role
--             EXPLICITAMENTE, via ALTER DEFAULT PRIVILEGES na criacao da
--             funcao. Revogar de PUBLIC nao encosta num grant explicito: o
--             proacl continua com `anon=X/postgres`. Este e o vazamento em
--             producao, e foi o erro que as 003/004 cometeram -- la ficou
--             inofensivo so porque aquelas funcoes retornam `trigger`, que o
--             PostgREST nao expoe como RPC.
--
-- Estas duas retornam `date`: sem as quatro linhas abaixo,
-- /rest/v1/rpc/card_invoice_month fica chamavel com a chave que vai no bundle
-- JS publico. O teste database/tests/budget_invoice_test.sql cobre os dois
-- caminhos -- foi ele que pegou a falta do revoke de PUBLIC.
REVOKE EXECUTE ON FUNCTION public.card_invoice_month(date, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.card_invoice_due_date(date, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.card_invoice_month(date, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.card_invoice_due_date(date, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.card_invoice_month(date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.card_invoice_due_date(date, integer, integer) TO authenticated;

-- =====================================================
-- SECAO 8: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('006', '006_budgets_and_card_invoices',
        'Orcamento por categoria (budgets) e fatura de cartao (colunas + views) - HMO-137 Fase 2', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 7. 007_group_settlements.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - ACERTO DE CONTAS DO GRUPO
-- =====================================================
-- Migration: 007_group_settlements
-- Gerado em: 2026-09-22  (HMO-137, Fase 3 da evolucao do produto)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.group_settlements       cada pagamento de um membro para outro
--   public.group_member_balances   quanto cada membro deve ou tem a receber (view)
--   correcao de public.update_account_balance()  -- ver AVISO abaixo
--   correcao de public.calculate_equal_split()   -- ver AVISO abaixo
--   backfill de financial_transactions.group_id
--
-- AVISO: ESTE ARQUIVO CORRIGE UM BUG DE DINHEIRO QUE JA ESTA EM PRODUCAO
-- ---------------------------------------------------------------------
-- `update_account_balance()` roda em AFTER INSERT OR UPDATE OR DELETE e, no
-- ramo de UPDATE, soma NEW.amount no saldo sem estornar OLD.amount. O efeito
-- e que QUALQUER edicao de lancamento desconta o valor uma segunda vez --
-- inclusive uma edicao que nao encosta no valor, como trocar a descricao.
--
--   saldo 1000, lanca despesa de 300  -> 700   (certo)
--   edita a descricao dessa despesa   -> 400   (errado, e sem erro nenhum)
--
-- Reproduzido num Postgres 17 com a cadeia 001->006, e alcancavel hoje pelo
-- app: app/api/personal-finance/transactions/[id] (PUT) e a tela de lancamentos
-- fazem exatamente esse UPDATE. A SECAO 3a conserta a funcao.
--
-- `calculate_equal_split()` rateia pela porcentagem arredondada em duas casas:
-- uma despesa de R$ 300 dividida por tres vira tres partes de R$ 99,99, e
-- R$ 0,03 somem. Numa viagem inteira isso vira um saldo residual que pagamento
-- nenhum zera. Pior: o trigger nao olha o split_type, entao reescreve TODO
-- rateio como igualitario -- divisao 70/30 combinada com a esposa era gravada
-- 50/50. A SECAO 3b conserta as duas coisas.
--
-- Saldos que JA derivaram nao sao corrigidos por este arquivo. Recalcular
-- current_balance a partir das transacoes apagaria o saldo inicial de quem
-- cadastrou a conta com um valor de abertura -- seria trocar um erro por
-- outro, em cima de dinheiro. Para medir a deriva antes de decidir, rode a
-- consulta somente-leitura de database/maintenance/007_auditoria_saldos.sql.
--
-- O BURACO QUE ELE FECHA
-- ----------------------
-- O app ja calculava o saldo do grupo e ja sugeria as transferencias
-- ("Helio paga R$ 120 para Ana"), em dois lugares diferentes:
-- app/api/expense-groups/[groupId]/balances e .../transfers. Faltava o unico
-- passo que fazia a sugestao valer alguma coisa: **registrar que ela foi
-- paga**. Sem isso a sugestao nunca sumia -- depois de acertar a viagem
-- inteira, o app continuava dizendo que Helio devia R$ 120, para sempre. E o
-- caminho de escape seria apagar as despesas do grupo, isto e, perder o
-- historico da viagem para calar um aviso.
--
-- POR QUE UMA TABELA SO PARA ISSO
-- -------------------------------
-- A alternativa era lancar o acerto como duas financial_transactions (uma
-- despesa em quem paga, uma receita em quem recebe). Rejeitada por duas razoes:
--
--   1) current_balance e mantido por TRIGGER (update_account_balance). Um
--      acerto de grupo passaria a mexer no saldo das contas pessoais de dois
--      usuarios -- exatamente a familia de risco que a Fase 2 contornou com a
--      fatura de cartao, e desta vez sobre a conta de OUTRA pessoa.
--   2) O acerto nao e uma despesa nova. O dinheiro ja foi gasto quando alguem
--      pagou o hotel; o acerto so move quem e o dono daquele buraco. Lancar
--      como despesa contaria o hotel duas vezes em qualquer relatorio por
--      categoria -- inclusive no consumo de orcamento que o 006 acabou de
--      criar.
--
-- Entao o acerto e um livro proprio, e esta tabela continua sendo a fonte da
-- verdade do saldo do grupo.
--
-- O QUE MUDOU EM 04/10/2026 (HMO-245, fase 11) -- E O QUE NAO MUDOU
-- -----------------------------------------------------------------
-- A frase que ficava aqui -- "quem quiser ver o dinheiro sair da conta corrente
-- lanca a transferencia normalmente" -- descrevia um habito que nunca
-- aconteceu. Ninguem lancava. O Pix de uma pessoa para a outra ficava invisivel
-- nos dois lados e o saldo da conta corrente nao se mexia, e foi esse o defeito
-- relatado.
--
-- Desde a fase 11, POST /api/expense-groups/[groupId]/settlements grava
-- tambem UMA perna em financial_transactions: a de quem REGISTRA o acerto.
-- As duas objecoes acima continuam valendo, e cada uma e respondida de um jeito
-- diferente:
--
--   a objecao 2 e respondida pelo TIPO. A perna e `transfer` nos dois lados --
--   quem paga e quem recebe --, e `category_monthly_totals`,
--   `monthly_cash_flow` e `personal_category_monthly_totals` (033) ignoram
--   `transfer`. O hotel nao e contado duas vezes em relatorio nenhum nem no
--   consumo de orcamento: um acerto nao muda a Receita nem a Despesa de
--   ninguem, ele so move dinheiro de lugar. (Medido num Postgres 17 local com a
--   cadeia 001->039: gravar a perna de quem RECEBE como `income` fecha o mes
--   pessoal dela empatado -- income 200 / expense 200 -- apagando a parte que
--   ela mesma consumiu. Com `transfer`, o realizado continua sendo "a minha
--   parte" nos dois lados, que e a invariante da 033.)
--
--   a objecao 1 NAO foi revogada, e e ela que limita a fase a UMA perna.
--   `financial_transactions_write` e
--   `FOR INSERT WITH CHECK (user_id = auth.uid())` (002_rls_lockdown.sql:472) e
--   a rota roda na sessao de quem clicou: nao ha como escrever na conta da
--   outra pessoa, e nao se tentou. Cada lado grava a propria perna quando
--   registra. A perna da contraparte e outra fase (F12) e vai precisar de outro
--   mecanismo -- nao de um relaxamento desta policy.
--
-- Nenhum trigger desta tabela mudou: `update_account_balance` soma
-- `current_balance + NEW.amount` (001_baseline.sql:833) sem olhar o tipo, entao
-- quem carrega o saldo e o SINAL da perna. E a perna vai com `group_id = NULL`
-- de proposito: `auto_create_group_transaction` dispara em
-- `group_id IS NOT NULL AND amount < 0` e rateiaria o proprio Pix entre os
-- membros (medido: 2 linhas de rateio somando R$ 400 viram 4 somando R$ 600).
--
-- COMO RODAR
-- ----------
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/007_group_settlements.sql
--
-- Aplicar depois de 001 -> 002 -> 003 -> 004 -> 005 -> 006. O preflight aborta
-- a transacao inteira listando tudo que falta de uma vez.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: O ARQUIVO CABE NESTE BANCO?
-- =====================================================
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(DISTINCT msg, E'\n' ORDER BY msg) INTO v_faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.' || quote_ident(r.tabela)) IS NULL
               THEN format('  - tabela public.%s nao existe', r.tabela)
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || quote_ident(r.tabela))
                      AND a.attname = r.coluna
                      AND a.attnum > 0
                      AND NOT a.attisdropped)
               THEN format('  - coluna public.%s.%s nao existe', r.tabela, r.coluna)
           END AS msg
    FROM (VALUES
      ('expense_groups', 'id'),
      ('group_members', 'user_id'),
      ('group_members', 'status'),
      ('group_transactions', 'transaction_id'),
      ('group_expense_splits', 'member_id'),
      ('group_expense_splits', 'status'),
      ('financial_transactions', 'transaction_type'),
      ('schema_migrations', 'version')
    ) AS r(tabela, coluna)

    UNION ALL
    SELECT format('  - funcao public.%s nao existe', f.nome)
    FROM (VALUES
      ('update_updated_at_column()'),
      ('is_group_member(uuid)')
    ) AS f(nome)
    WHERE to_regprocedure('public.' || f.nome) IS NULL

    UNION ALL
    SELECT format('  - role %s nao existe', r.rolname)
    FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname = r.rolname)
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'007 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> 002 -> 003 -> 004 -> 005 -> 006 antes.', v_faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: group_settlements  (quem pagou quem)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.group_settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    -- quem PAGOU. Nao referencia group_members: um membro pode sair do grupo
    -- e a divida que ele quitou continua tendo acontecido. Apontar para a
    -- linha de participacao faria o ON DELETE levar o pagamento junto, e o
    -- saldo de quem RECEBEU voltaria a subir sozinho meses depois.
    from_user_id uuid NOT NULL,
    -- quem RECEBEU.
    to_user_id uuid NOT NULL,
    -- sempre positivo: a direcao esta nas duas colunas acima, nao no sinal.
    -- (O resto do banco grava despesa negativa; aqui isso seria ambiguo.)
    amount numeric(15,2) NOT NULL,
    settled_on date NOT NULL DEFAULT CURRENT_DATE,
    note text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT group_settlements_pkey PRIMARY KEY (id),
    CONSTRAINT group_settlements_amount_check CHECK (amount > (0)::numeric),
    -- pagar a si mesmo zeraria o proprio saldo em qualquer direcao e nao
    -- corresponde a nada no mundo.
    CONSTRAINT group_settlements_parties_differ CHECK (from_user_id <> to_user_id),
    CONSTRAINT group_settlements_group_id_fkey FOREIGN KEY (group_id)
      REFERENCES public.expense_groups(id) ON DELETE CASCADE,
    CONSTRAINT group_settlements_from_user_id_fkey FOREIGN KEY (from_user_id)
      REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT group_settlements_to_user_id_fkey FOREIGN KEY (to_user_id)
      REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT group_settlements_created_by_fkey FOREIGN KEY (created_by)
      REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.group_settlements IS
  'Pagamento de um membro do grupo para outro, para zerar o saldo. Nao mexe em financial_transactions.';
COMMENT ON COLUMN public.group_settlements.amount IS
  'Sempre positivo. A direcao do dinheiro esta em from_user_id -> to_user_id.';
COMMENT ON COLUMN public.group_settlements.settled_on IS
  'Data em que o pagamento aconteceu, que pode ser anterior ao registro.';

CREATE INDEX IF NOT EXISTS idx_group_settlements_group
  ON public.group_settlements (group_id, settled_on DESC);
CREATE INDEX IF NOT EXISTS idx_group_settlements_from
  ON public.group_settlements (from_user_id);
CREATE INDEX IF NOT EXISTS idx_group_settlements_to
  ON public.group_settlements (to_user_id);

DROP TRIGGER IF EXISTS update_group_settlements_updated_at ON public.group_settlements;
CREATE TRIGGER update_group_settlements_updated_at
  BEFORE UPDATE ON public.group_settlements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Nao ha indice unico aqui, de proposito: dois pagamentos identicos no mesmo
-- dia sao um fato possivel (duas parcelas de R$ 50 para a mesma pessoa). A
-- protecao contra clique duplo e a idempotencia da rota, nao o banco.

-- =====================================================
-- SECAO 2: group_member_balances  (quanto cada um deve)
-- =====================================================
-- Ate aqui o saldo era calculado em TypeScript, duas vezes, com regras
-- ligeiramente diferentes -- balances/route.ts refazia a consulta uma vez por
-- membro e ignorava o status do rateio; transfers/route.ts fazia numa consulta
-- so. Duas respostas possiveis para "quanto eu devo" na mesma tela.
--
-- A view e a terceira implementacao e a unica que fica: as duas rotas passam a
-- le-la. Tres regras, cada uma com uma razao:
--
--  1) PAGO = SUM(ABS(amount)) das despesas do grupo lancadas por aquele
--     usuario. ABS porque despesa e gravada NEGATIVA neste banco (a mesma
--     armadilha que a Fase 2 pegou na view de consumo de orcamento). Somente
--     'expense': uma receita lancada no grupo nao e alguem pagando a conta do
--     restaurante, e conta-la como pagamento daria credito a quem recebeu
--     dinheiro.
--
--  2) DEVE = SUM(amount) dos rateios em que o membro aparece, EXCETO os
--     rejeitados e os expirados. Hoje o app cria todo rateio como 'pending' e
--     nada nunca os aprova (ver app/api/expense-groups/[groupId]/transactions),
--     entao filtrar por 'approved' zeraria o saldo de todo mundo -- seria
--     "consertar" a regra quebrando o produto. Contar 'rejected' era o bug
--     oposto, e e o que as duas rotas antigas faziam: o membro que recusou a
--     divisao continuava devendo.
--
--  3) ACERTOS entram com o sinal INVERTIDO em relacao a intuicao de quem le
--     rapido: quem PAGA tem o saldo AUMENTADO. O saldo negativo significa "deve",
--     e pagar e justamente o ato de sair do negativo em direcao ao zero. Somar
--     no receptor e subtrair no pagador -- o erro simetrico -- faria a divida
--     DOBRAR a cada acerto registrado, e a tela mostraria a sugestao de
--     transferencia crescendo depois de cada pagamento. O teste
--     database/tests/group_settlement_test.sql trava esse sinal.
--
-- A juncao com group_members e por user_id (nao por group_members.id) porque
-- quem sai e volta ganha uma linha de participacao nova, e o rateio antigo
-- continua apontando para a linha velha. Por user_id o historico dele se
-- reencontra; por member_id ele apareceria como duas pessoas.
CREATE OR REPLACE VIEW public.group_member_balances AS
  SELECT
    m.group_id,
    m.user_id,
    m.id                                        AS member_id,
    COALESCE(p.paid, 0)::numeric(15,2)          AS total_paid,
    COALESCE(o.owed, 0)::numeric(15,2)          AS total_owed,
    COALESCE(s.paid_out, 0)::numeric(15,2)      AS settlements_paid,
    COALESCE(s.received, 0)::numeric(15,2)      AS settlements_received,
    (COALESCE(p.paid, 0)
     - COALESCE(o.owed, 0)
     + COALESCE(s.paid_out, 0)
     - COALESCE(s.received, 0))::numeric(15,2)  AS net_balance,
    COALESCE(p.paid_count, 0)                   AS paid_count,
    COALESCE(o.owed_count, 0)                   AS owed_count
  FROM public.group_members m

  -- o que este usuario pagou pelo grupo
  LEFT JOIN LATERAL (
    SELECT SUM(ABS(t.amount)) AS paid, COUNT(*) AS paid_count
    FROM public.group_transactions gt
    JOIN public.financial_transactions t ON t.id = gt.transaction_id
    WHERE gt.group_id = m.group_id
      AND t.user_id = m.user_id
      AND t.transaction_type = 'expense'
  ) AS p ON TRUE

  -- a parte que cabe a ele nas despesas do grupo
  LEFT JOIN LATERAL (
    SELECT SUM(es.amount) AS owed, COUNT(*) AS owed_count
    FROM public.group_expense_splits es
    JOIN public.group_members em ON em.id = es.member_id
    JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.group_id = m.group_id
      AND em.user_id = m.user_id
      AND es.status NOT IN ('rejected', 'expired')
  ) AS o ON TRUE

  -- os acertos ja registrados, nas duas direcoes
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN gs.from_user_id = m.user_id THEN gs.amount ELSE 0 END) AS paid_out,
      SUM(CASE WHEN gs.to_user_id   = m.user_id THEN gs.amount ELSE 0 END) AS received
    FROM public.group_settlements gs
    WHERE gs.group_id = m.group_id
      AND (gs.from_user_id = m.user_id OR gs.to_user_id = m.user_id)
  ) AS s ON TRUE

  WHERE m.status = 'active';

COMMENT ON VIEW public.group_member_balances IS
  'Saldo de cada membro ativo: pago - devido + acertos pagos - acertos recebidos. Negativo = deve.';

-- =====================================================
-- SECAO 3a: update_account_balance() -- o UPDATE que cobrava duas vezes
-- =====================================================
-- Ver o AVISO no cabecalho. A versao de producao faz, no ramo de UPDATE:
--
--     current_balance = current_balance + NEW.amount
--
-- sem nunca estornar OLD.amount. Toda edicao de lancamento tira o valor do
-- saldo de novo, e trocar a conta do lancamento deixa o valor nas DUAS contas.
--
-- Este arquivo precisa da correcao por um motivo proprio, alem do bug: a
-- SECAO 4 abaixo faz um UPDATE de manutencao em financial_transactions. Com a
-- funcao velha, a migration destruiria o saldo de todas as contas com despesa
-- de grupo -- uma migration que corrompe dinheiro para consertar um join.
-- Corrigida a funcao, o mesmo UPDATE estorna o valor antigo e reaplica o novo:
-- resultado liquido zero, como tem que ser.
--
-- Fica SECURITY INVOKER de proposito: a 004 auditou esta funcao e concluiu que
-- ela escreve em tabela onde o proprio usuario ja tem grant e policy. O que
-- muda e so a aritmetica. O `SET search_path` entra porque a funcao referencia
-- `financial_accounts` sem qualificar o schema.
CREATE OR REPLACE FUNCTION public.update_account_balance() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.account_id IS NOT NULL THEN
            UPDATE public.financial_accounts
               SET current_balance = current_balance + NEW.amount, updated_at = NOW()
             WHERE id = NEW.account_id;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Estorna o efeito antigo e aplica o novo. Os dois passos sao
        -- separados porque a conta pode ter mudado na edicao: um unico UPDATE
        -- com o delta so funcionaria quando OLD.account_id = NEW.account_id, e
        -- falharia em silencio justamente no caso de mover o lancamento de
        -- conta -- que e quando o saldo das duas contas depende disso.
        IF OLD.account_id IS NOT NULL THEN
            UPDATE public.financial_accounts
               SET current_balance = current_balance - OLD.amount, updated_at = NOW()
             WHERE id = OLD.account_id;
        END IF;
        IF NEW.account_id IS NOT NULL THEN
            UPDATE public.financial_accounts
               SET current_balance = current_balance + NEW.amount, updated_at = NOW()
             WHERE id = NEW.account_id;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.account_id IS NOT NULL THEN
            UPDATE public.financial_accounts
               SET current_balance = current_balance - OLD.amount, updated_at = NOW()
             WHERE id = OLD.account_id;
        END IF;
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.update_account_balance() IS
  'Mantem financial_accounts.current_balance. No UPDATE estorna OLD.amount antes de somar NEW.amount.';

-- =====================================================
-- SECAO 3b: calculate_equal_split() -- os centavos que sumiam
-- =====================================================
-- Sem esta correcao o acerto de contas que este arquivo introduz NAO FECHA, e
-- e por isso que ela entra aqui e nao numa migration futura.
--
-- A versao de producao rateia pela PORCENTAGEM, arredondada para duas casas:
--
--     equal_percentage := 100.0 / 3          -> 33.33  (DECIMAL(5,2))
--     NEW.amount := 300 * (33.33 / 100.0)    -> 99.99
--
-- Tres vezes 99,99 e 299,97. A despesa foi de R$ 300: somem R$ 0,03 a cada
-- divisao por 3, R$ 0,01 por 6, e por ai vai -- toda divisao cujo resultado
-- nao tem duas casas exatas. O dinheiro nao volta: quem pagou fica credor de
-- uma sobra que rateio nenhum atribuiu a ninguem.
--
-- Numa viagem com trinta contas isso vira alguns centavos de saldo residual
-- que NENHUM pagamento zera -- a tela diria "voce ainda deve R$ 0,07" para
-- sempre, e o acerto simplificado nunca terminaria. Essa foi a razao de
-- descobrir: o teste do acerto exige que a soma dos saldos do grupo seja zero.
--
-- A correcao e o metodo do maior resto: divide em centavos inteiros e
-- distribui o que sobra, um centavo para cada um dos primeiros restos. Com
-- R$ 300 por 3 da 100,00 para cada; com R$ 100 por 3 da 33,34 / 33,33 / 33,33,
-- que soma exatamente 100,00. Qual membro recebe o centavo a mais e decidido
-- pela ordem de group_members.id -- arbitraria, mas ESTAVEL: cada linha calcula
-- a propria parte sem saber das outras, e mesmo assim o total bate.
--
-- E O SEGUNDO DEFEITO, QUE E MAIOR
-- --------------------------------
-- O trigger e BEFORE INSERT em group_expense_splits SEM clausula WHEN, e a
-- funcao nao olha o split_type. Ou seja: ela reescreve TODO rateio como
-- igualitario, inclusive o personalizado. O app oferece divisao por
-- porcentagem, custom e proporcional a renda (ha ate um endpoint
-- /expense-groups/proportions para calcular esta ultima) -- e o banco achatava
-- as tres para "cada um paga o mesmo", em silencio, na hora do INSERT. Quem
-- combinasse 70/30 com a esposa via 50/50 gravado.
--
-- Agora a funcao so calcula quando o rateio E igualitario e quem inseriu nao
-- trouxe valor proprio. Nos outros casos ela devolve NEW intacto.
CREATE OR REPLACE FUNCTION public.calculate_equal_split() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_split_type TEXT;
    v_total_cents BIGINT;
    v_n INTEGER;
    v_rank INTEGER;
    v_base BIGINT;
    v_resto BIGINT;
BEGIN
    SELECT gt.split_type INTO v_split_type
      FROM public.group_transactions gt
     WHERE gt.id = NEW.group_transaction_id;

    -- Rateio que nao e igualitario: o valor veio de quem inseriu e manda quem
    -- inseriu. Antes, este era o caminho que apagava a divisao combinada.
    IF v_split_type IS NOT NULL AND v_split_type <> 'equal' THEN
        RETURN NEW;
    END IF;

    SELECT ROUND(ABS(ft.amount) * 100)::bigint INTO v_total_cents
      FROM public.financial_transactions ft
      JOIN public.group_transactions gt ON gt.transaction_id = ft.id
     WHERE gt.id = NEW.group_transaction_id;

    IF v_total_cents IS NULL THEN
        RETURN NEW;
    END IF;

    -- Quantos membros ativos, e em que posicao esta o desta linha. As duas
    -- consultas tem que enxergar o MESMO conjunto, senao os restos nao somam.
    SELECT count(*) INTO v_n
      FROM public.group_members gm
      JOIN public.group_transactions gt ON gt.group_id = gm.group_id
     WHERE gt.id = NEW.group_transaction_id
       AND gm.status = 'active';

    IF v_n IS NULL OR v_n = 0 THEN
        RETURN NEW;
    END IF;

    SELECT posicao INTO v_rank
      FROM (
        SELECT gm.id, row_number() OVER (ORDER BY gm.id) - 1 AS posicao
          FROM public.group_members gm
          JOIN public.group_transactions gt ON gt.group_id = gm.group_id
         WHERE gt.id = NEW.group_transaction_id
           AND gm.status = 'active'
      ) AS r
     WHERE r.id = NEW.member_id;

    -- Membro inativo (ou de outro grupo) recebendo rateio: nao esta na
    -- ordenacao, entao nao ha parte justa a calcular. Deixa como veio, em vez
    -- de inventar um valor.
    IF v_rank IS NULL THEN
        RETURN NEW;
    END IF;

    v_base  := v_total_cents / v_n;
    v_resto := v_total_cents - (v_base * v_n);

    NEW.amount := ((v_base + CASE WHEN v_rank < v_resto THEN 1 ELSE 0 END)::numeric) / 100;

    -- A porcentagem vira DISPLAY: com R$ 100 por 3, as partes em dinheiro sao
    -- 33,34 / 33,33 / 33,33 e nenhuma porcentagem de duas casas descreve as
    -- duas coisas ao mesmo tempo. Quem manda e o valor. O CHECK da coluna
    -- exige > 0, entao o GREATEST cobre o grupo grande demais (mais de 10 mil
    -- membros arredondaria para 0,00 e derrubaria o INSERT).
    NEW.percentage := GREATEST(ROUND(100.0 / v_n, 2), 0.01);

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.calculate_equal_split() IS
  'Rateio igualitario em centavos inteiros (maior resto), somando exatamente o valor da despesa. Nao toca em rateio custom/percentage/proporcional.';

-- =====================================================
-- SECAO 4: backfill de financial_transactions.group_id
-- =====================================================
-- A despesa lancada pela tela do grupo
-- (app/api/expense-groups/[groupId]/transactions) grava a transacao SEM
-- group_id -- so cria a linha de ligacao em group_transactions. E a policy de
-- SELECT de financial_transactions, escrita pela 002, libera a transacao de
-- outro membro exatamente por essa coluna:
--
--     user_id = auth.uid() OR (group_id IS NOT NULL AND is_group_member(group_id))
--
-- Ou seja: hoje cada membro so enxerga o que ELE MESMO pagou. A tela de saldos
-- do grupo ja mostra, para cada um, que todos os outros pagaram zero -- dois
-- membros abrem a mesma viagem e leem numeros diferentes, sem nenhum erro
-- aparecer. A view da SECAO 2 herdaria o mesmo buraco, porque e security_invoker.
--
-- O consumo de orcamento de grupo que a Fase 2 criou depende da MESMA coluna
-- (budget_consumption casa t.group_id = b.group_id), entao sem este backfill o
-- teto da viagem leria zero para sempre.
--
-- Daqui para a frente quem grava a coluna e a rota, corrigida no mesmo commit.
-- Este bloco so alcanca o que ja existe.
--
-- Transacao ligada a DOIS grupos fica de fora: nao ha resposta certa para qual
-- deles vai na coluna, e escolher um calado seria mover a despesa de grupo sem
-- avisar. O NOTICE reporta quantas foram.
DO $$
DECLARE
  v_saldo_antes  numeric;
  v_saldo_depois numeric;
  v_corrigidas   integer;
  v_ambiguas     integer;
BEGIN
  SELECT COALESCE(SUM(current_balance), 0) INTO v_saldo_antes
    FROM public.financial_accounts;

  SELECT count(*) INTO v_ambiguas
    FROM (SELECT gt.transaction_id
            FROM public.group_transactions gt
            JOIN public.financial_transactions t ON t.id = gt.transaction_id
           WHERE t.group_id IS NULL
           GROUP BY gt.transaction_id
          HAVING count(DISTINCT gt.group_id) > 1) AS x;

  WITH unico AS (
    SELECT gt.transaction_id, MIN(gt.group_id::text)::uuid AS group_id
      FROM public.group_transactions gt
      JOIN public.financial_transactions t ON t.id = gt.transaction_id
     WHERE t.group_id IS NULL
     GROUP BY gt.transaction_id
    HAVING count(DISTINCT gt.group_id) = 1
  )
  UPDATE public.financial_transactions t
     SET group_id = u.group_id
    FROM unico u
   WHERE t.id = u.transaction_id;

  GET DIAGNOSTICS v_corrigidas = ROW_COUNT;

  SELECT COALESCE(SUM(current_balance), 0) INTO v_saldo_depois
    FROM public.financial_accounts;

  -- A rede de seguranca: se a correcao da SECAO 3 nao tivesse pegado, este
  -- UPDATE teria mexido no saldo e a migration inteira volta atras aqui, em
  -- vez de deixar producao com dinheiro errado e sair verde.
  IF v_saldo_antes IS DISTINCT FROM v_saldo_depois THEN
    RAISE EXCEPTION
      'ABORTADO: o backfill de group_id mudou o saldo das contas (% -> %). Nenhuma alteracao foi gravada.',
      v_saldo_antes, v_saldo_depois;
  END IF;

  RAISE NOTICE 'backfill de group_id: % transacoes ligadas ao grupo, % ambiguas deixadas como estavam, saldo total inalterado (%).',
    v_corrigidas, v_ambiguas, v_saldo_depois;
END $$;

-- =====================================================
-- SECAO 5: RLS
-- =====================================================
ALTER TABLE public.group_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS group_settlements_select ON public.group_settlements;
CREATE POLICY group_settlements_select ON public.group_settlements
  FOR SELECT TO authenticated
  USING (public.is_group_member(group_id));

-- Quem registra tem que ser membro E uma das duas partes. Um terceiro membro
-- registrando "A pagou B" apagaria uma divida que nao e dele -- seria o botao
-- de perdoar a divida alheia, disponivel para qualquer um do grupo.
DROP POLICY IF EXISTS group_settlements_insert ON public.group_settlements;
CREATE POLICY group_settlements_insert ON public.group_settlements
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.is_group_member(group_id)
    AND (from_user_id = auth.uid() OR to_user_id = auth.uid())
  );

-- Corrigir o valor digitado errado: so quem registrou, e sem poder transformar
-- o registro num acerto entre outras duas pessoas.
DROP POLICY IF EXISTS group_settlements_update ON public.group_settlements;
CREATE POLICY group_settlements_update ON public.group_settlements
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND public.is_group_member(group_id))
  WITH CHECK (
    created_by = auth.uid()
    AND (from_user_id = auth.uid() OR to_user_id = auth.uid())
  );

DROP POLICY IF EXISTS group_settlements_delete ON public.group_settlements;
CREATE POLICY group_settlements_delete ON public.group_settlements
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() AND public.is_group_member(group_id));

-- =====================================================
-- SECAO 6: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes destes objetos existirem, e ALL
-- TABLES nao alcanca o futuro.
REVOKE ALL ON public.group_settlements FROM anon;
REVOKE ALL ON public.group_member_balances FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_settlements TO authenticated;
GRANT SELECT ON public.group_member_balances TO authenticated;

-- Sem security_invoker a view roda com o privilegio do dono e a RLS das
-- tabelas base nao vale: group_member_balances devolveria o saldo de todos os
-- grupos do sistema para qualquer usuario logado -- quanto cada casal gasta e
-- com quem cada um viaja. Mesma pegadinha do 005 e do 006.
ALTER VIEW public.group_member_balances SET (security_invoker = true);

-- =====================================================
-- SECAO 7: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('007', '007_group_settlements',
        'Acerto de contas do grupo (group_settlements) e saldo por membro (view) - HMO-137 Fase 3', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 8. 008_goals_and_reports.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - METAS E RELATORIOS
-- =====================================================
-- Migration: 008_goals_and_reports
-- Gerado em: 2026-09-22  (HMO-137, Fase 4 da evolucao do produto)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.financial_goals           a meta ("Reserva de emergencia, R$ 15.000")
--   public.goal_contributions        cada aporte feito para uma meta
--   public.goal_progress             quanto ja juntou, quanto falta, quanto por mes (view)
--   public.category_monthly_totals   entrada/saida por categoria e por mes (view)
--   public.monthly_cash_flow         entrada/saida por mes (view, rollup da anterior)
--   public.planned_vs_actual         previsto x realizado por mes (view)
--   public.net_worth_history         evolucao do patrimonio mes a mes (view)
--
-- Nenhuma funcao de producao e alterada aqui. Ao contrario do 007, este
-- arquivo so acrescenta: as quatro views sao leitura pura e as duas tabelas
-- sao novas.
--
-- A TELA DE METAS ERA UM MOCK
-- ---------------------------
-- app/(dashboard)/dashboard/goals/page.tsx tinha duas metas escritas no
-- codigo ("Reserva de Emergencia", "Viagem Europa") com um TODO em cima. O
-- usuario via barras de progresso que nunca mudavam, nao havia onde cadastrar
-- e o botao "Nova Meta" nao fazia nada. A tela de Relatorios era do mesmo
-- tipo: quatro cartoes com um botao "Gerar" que nao chamava nada.
--
-- POR QUE O PROGRESSO E SOMA DE APORTES, E NAO O SALDO DA CONTA
-- -------------------------------------------------------------
-- A tentacao e ligar a meta a uma financial_account e dizer que o progresso e
-- o current_balance dela. Rejeitado por tres razoes, em ordem de gravidade:
--
--   1) current_balance e mantido por TRIGGER e, ate o 007 ser aplicado em
--      producao, ele derivou a cada edicao de lancamento. A meta herdaria a
--      deriva e diria que voce juntou dinheiro que nao existe -- ou o
--      contrario. Ver database/maintenance/007_auditoria_saldos.sql.
--   2) A conta poupanca costuma guardar dinheiro de mais de uma meta ao mesmo
--      tempo (a reserva E a viagem). Duas metas lendo o mesmo saldo mostrariam
--      as duas cheias com o dinheiro de uma so.
--   3) Aporte e um fato datado: "em marco eu botei R$ 500". Saldo e um numero
--      do presente, sem historia. Sem os aportes nao da para desenhar a
--      evolucao da meta nem responder "no ritmo atual eu chego?".
--
-- Entao goal_contributions e a fonte da verdade do progresso, e account_id na
-- meta e so uma anotacao de ONDE o dinheiro esta guardado. Quem quiser ver o
-- dinheiro sair da conta corrente lanca a transferencia normalmente: sao
-- fatos diferentes, como o acerto de grupo do 007.
--
-- O SINAL DO VALOR, DE NOVO
-- -------------------------
-- Despesa e gravada NEGATIVA em financial_transactions. Foi o que quase passou
-- na Fase 2 (SUM cru no consumo de orcamento daria -800 para quem gastou 800).
-- As views deste arquivo somam com ABS() e filtram por transaction_type, nunca
-- pelo sinal, e o teste tem controle negativo para as duas coisas.
--
-- 'transfer' NAO E NEM ENTRADA NEM SAIDA
-- --------------------------------------
-- O ENUM transaction_financial_type tem tres valores, nao dois. Transferir
-- R$ 1.000 da conta corrente para a poupanca nao e renda nem gasto: somar
-- transfer na entrada faria o fluxo de caixa mostrar uma receita de mil reais
-- que ninguem recebeu, e o mes fecharia positivo sem nenhum dinheiro novo.
-- category_monthly_totals ignora transfer de proposito.
--
-- Em net_worth_history e o oposto: transfer ENTRA na conta, porque o trigger
-- update_account_balance mexe no saldo em QUALQUER tipo. A view espelha
-- exatamente o que o trigger faz -- ver a SECAO 8.
--
-- COMO RODAR
-- ----------
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/008_goals_and_reports.sql
--
-- Aplicar depois de 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007. O preflight
-- aborta a transacao inteira listando tudo que falta de uma vez.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: O ARQUIVO CABE NESTE BANCO?
-- =====================================================
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(DISTINCT msg, E'\n' ORDER BY msg) INTO v_faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.' || quote_ident(r.tabela)) IS NULL
               THEN format('  - tabela public.%s nao existe', r.tabela)
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || quote_ident(r.tabela))
                      AND a.attname = r.coluna
                      AND a.attnum > 0
                      AND NOT a.attisdropped)
               THEN format('  - coluna public.%s.%s nao existe', r.tabela, r.coluna)
           END AS msg
    FROM (VALUES
      ('financial_accounts', 'current_balance'),
      ('financial_accounts', 'is_active'),
      ('financial_transactions', 'transaction_type'),
      ('financial_transactions', 'group_id'),
      ('transaction_categories', 'is_expense'),
      ('expense_groups', 'id'),
      -- do 005: previsto x realizado le a agenda de contas previstas
      ('scheduled_transactions', 'due_date'),
      ('scheduled_transactions', 'status'),
      ('recurring_rules', 'transaction_type'),
      ('schema_migrations', 'version')
    ) AS r(tabela, coluna)

    UNION ALL
    SELECT format('  - funcao public.%s nao existe', f.nome)
    FROM (VALUES
      ('update_updated_at_column()'),
      ('is_group_member(uuid)')
    ) AS f(nome)
    WHERE to_regprocedure('public.' || f.nome) IS NULL

    UNION ALL
    SELECT format('  - role %s nao existe', r.rolname)
    FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname = r.rolname)
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'008 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 antes.', v_faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: financial_goals  (a meta)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.financial_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    -- meta de grupo: a viagem que a familia inteira esta juntando dinheiro
    -- para fazer. NULL = meta pessoal. Mesmo desenho das tabelas do 005/006.
    group_id uuid,
    title text NOT NULL,
    description text,
    target_amount numeric(15,2) NOT NULL,
    -- prazo opcional: "juntar 15 mil" e uma meta valida sem data. Quando tem
    -- data, goal_progress calcula quanto falta por mes.
    target_date date,
    -- ONDE o dinheiro esta guardado. Anotacao, nao fonte do progresso -- ver o
    -- cabecalho. ON DELETE SET NULL: apagar a conta nao pode apagar a meta
    -- nem, pior, zerar o que ja foi juntado.
    account_id uuid,
    status text NOT NULL DEFAULT 'active',
    color_hex text DEFAULT '#8B5CF6'::text,
    icon text DEFAULT 'target'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT financial_goals_pkey PRIMARY KEY (id),
    -- meta de R$ 0 quebraria a divisao do percentual em goal_progress, do
    -- mesmo jeito que amount_limit > 0 protege budget_consumption no 006.
    CONSTRAINT financial_goals_target_check CHECK (target_amount > (0)::numeric),
    CONSTRAINT financial_goals_status_check CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
    CONSTRAINT financial_goals_title_check CHECK (length(btrim(title)) > 0),
    CONSTRAINT financial_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT financial_goals_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.expense_groups(id) ON DELETE CASCADE,
    CONSTRAINT financial_goals_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.financial_goals IS
  'Metas de economia. O progresso NAO fica aqui: e a soma de goal_contributions, lida em goal_progress.';
COMMENT ON COLUMN public.financial_goals.account_id IS
  'Onde o dinheiro esta guardado. Anotacao: o progresso vem dos aportes, nao do saldo da conta.';

CREATE INDEX IF NOT EXISTS idx_financial_goals_user ON public.financial_goals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_financial_goals_group ON public.financial_goals(group_id) WHERE group_id IS NOT NULL;

-- =====================================================
-- SECAO 2: goal_contributions  (cada aporte)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.goal_contributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    goal_id uuid NOT NULL,
    -- QUEM aportou. Numa meta de grupo cada membro aporta o seu, e a tela
    -- mostra quanto cada um ja botou. Nao e redundante com financial_goals
    -- .user_id, que e quem CRIOU a meta.
    user_id uuid NOT NULL,
    amount numeric(15,2) NOT NULL,
    contributed_at date NOT NULL DEFAULT CURRENT_DATE,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT goal_contributions_pkey PRIMARY KEY (id),
    -- Aporte e sempre positivo. Tirar dinheiro da meta se registra apagando o
    -- aporte, nao lancando um negativo: um aporte negativo passaria despercebido
    -- na soma e o historico mentiria sobre quanto cada um contribuiu.
    CONSTRAINT goal_contributions_amount_check CHECK (amount > (0)::numeric),
    CONSTRAINT goal_contributions_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.financial_goals(id) ON DELETE CASCADE,
    CONSTRAINT goal_contributions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.goal_contributions IS
  'Aportes para uma meta. Fonte da verdade do progresso; sempre positivo.';

CREATE INDEX IF NOT EXISTS idx_goal_contributions_goal ON public.goal_contributions(goal_id, contributed_at DESC);
CREATE INDEX IF NOT EXISTS idx_goal_contributions_user ON public.goal_contributions(user_id);

-- =====================================================
-- SECAO 3: updated_at
-- =====================================================
DROP TRIGGER IF EXISTS set_financial_goals_updated_at ON public.financial_goals;
CREATE TRIGGER set_financial_goals_updated_at
  BEFORE UPDATE ON public.financial_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- SECAO 4: goal_progress  (quanto ja juntou)
-- =====================================================
-- O `saved` sai de goal_contributions, nunca do saldo da conta -- ver o
-- cabecalho do arquivo.
--
-- `monthly_required` responde "no ritmo de quanto por mes eu chego no prazo?".
-- A divisao usa GREATEST(months_left, 1): sem isso, uma meta que vence neste
-- mes daria divisao por zero e a tela inteira quebraria com erro 500 no dia do
-- vencimento -- o unico dia em que o usuario mais quer olhar para ela.
CREATE OR REPLACE VIEW public.goal_progress AS
  SELECT
    g.id,
    g.user_id,
    g.group_id,
    g.account_id,
    g.title,
    g.description,
    g.target_amount,
    g.target_date,
    g.status,
    g.color_hex,
    g.icon,
    g.created_at,
    g.updated_at,
    COALESCE(c.saved, 0)::numeric(15,2) AS saved,
    -- nunca negativo: quem passou da meta ve "faltam R$ 0,00", nao um valor
    -- negativo que a tela formataria como "-R$ 300,00 restantes".
    GREATEST(g.target_amount - COALESCE(c.saved, 0), 0)::numeric(15,2) AS remaining,
    -- 4 casas; a tela arredonda. O CHECK garante target_amount > 0.
    ROUND(COALESCE(c.saved, 0) / g.target_amount, 4) AS progress_ratio,
    COALESCE(c.contribution_count, 0) AS contribution_count,
    c.last_contribution_at,
    d.months_left,
    CASE
      WHEN g.target_date IS NULL THEN NULL
      WHEN COALESCE(c.saved, 0) >= g.target_amount THEN 0::numeric(15,2)
      ELSE ROUND(
        (g.target_amount - COALESCE(c.saved, 0)) / GREATEST(d.months_left, 1),
        2)::numeric(15,2)
    END AS monthly_required,
    -- Estado calculado na leitura, separado de g.status (que o usuario controla
    -- ao pausar ou cancelar). 'reached' aparece sozinho quando os aportes
    -- alcancam o alvo: sem isso a meta ficaria "em andamento" com barra cheia
    -- ate alguem lembrar de marcar como concluida na mao.
    CASE
      WHEN g.status IN ('paused', 'cancelled') THEN g.status
      WHEN COALESCE(c.saved, 0) >= g.target_amount THEN 'reached'
      WHEN g.target_date IS NOT NULL AND g.target_date < CURRENT_DATE THEN 'overdue'
      ELSE 'on_track'
    END AS progress_status
  FROM public.financial_goals g
  LEFT JOIN LATERAL (
    SELECT SUM(gc.amount) AS saved,
           COUNT(*) AS contribution_count,
           MAX(gc.contributed_at) AS last_contribution_at
    FROM public.goal_contributions gc
    WHERE gc.goal_id = g.id
  ) AS c ON TRUE
  -- meses cheios entre o mes corrente e o mes do prazo, NULL sem prazo.
  -- Calculado uma vez num LATERAL porque monthly_required precisa do mesmo
  -- numero: duplicar a expressao e como duas versoes da mesma regra, e a
  -- segunda deixa de acompanhar a primeira na primeira vez que alguem mexer.
  -- O ::integer nao e cosmetico -- date_part() devolve double precision, e
  -- ROUND(double, int) nao existe no Postgres: a view nem chega a ser criada.
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN g.target_date IS NULL THEN NULL
             ELSE GREATEST(
               (date_part('year',  g.target_date) - date_part('year',  CURRENT_DATE)) * 12
                 + (date_part('month', g.target_date) - date_part('month', CURRENT_DATE)),
               0)::integer
           END AS months_left
  ) AS d ON TRUE;

COMMENT ON VIEW public.goal_progress IS
  'Metas com o juntado, o que falta e o ritmo mensal necessario, calculados na leitura.';

-- =====================================================
-- SECAO 5: category_monthly_totals  (gasto por categoria)
-- =====================================================
-- Grao: (user_id, group_id, mes, categoria). Cada transacao pertence a
-- exatamente um par (user_id, group_id), entao somar todas as linhas de um
-- usuario da o total dele, sem dupla contagem.
--
-- O relatorio pessoal le group_id IS NULL; o da viagem le um group_id fixo, e
-- ai aparece uma linha por membro -- que e exatamente "quem gastou o que na
-- viagem".
--
-- ABS() + filtro por transaction_type, nunca pelo sinal: despesa e gravada
-- negativa e um SUM cru devolveria -800 para quem gastou 800. Foi o erro que
-- quase passou na Fase 2.
--
-- 'transfer' fica de fora das duas colunas de proposito: mover dinheiro entre
-- as proprias contas nao e renda nem gasto.
CREATE OR REPLACE VIEW public.category_monthly_totals AS
  SELECT
    t.user_id,
    t.group_id,
    date_trunc('month', t.transaction_date)::date AS month,
    t.category_id,
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'expense'), 0)::numeric(15,2) AS expense,
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'income'), 0)::numeric(15,2) AS income,
    (COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'income'), 0)
     - COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'expense'), 0))::numeric(15,2) AS net,
    COUNT(*) FILTER (WHERE t.transaction_type IN ('expense', 'income')) AS transaction_count
  FROM public.financial_transactions t
  WHERE t.transaction_type IN ('expense', 'income')
  GROUP BY t.user_id, t.group_id, date_trunc('month', t.transaction_date)::date, t.category_id;

COMMENT ON VIEW public.category_monthly_totals IS
  'Entrada e saida por categoria e por mes. Ignora transfer: mover dinheiro entre contas proprias nao e renda nem gasto.';

-- =====================================================
-- SECAO 6: monthly_cash_flow  (fluxo de caixa)
-- =====================================================
-- Rollup de category_monthly_totals de proposito, em vez de uma segunda
-- consulta sobre financial_transactions: duas definicoes do mesmo numero saem
-- de sincronia na primeira vez que alguem mexer no tratamento de sinal, e o
-- relatorio por categoria deixaria de somar o total do fluxo de caixa sem que
-- nada acusasse.
CREATE OR REPLACE VIEW public.monthly_cash_flow AS
  SELECT
    c.user_id,
    c.group_id,
    c.month,
    SUM(c.income)::numeric(15,2) AS income,
    SUM(c.expense)::numeric(15,2) AS expense,
    SUM(c.net)::numeric(15,2) AS net,
    SUM(c.transaction_count) AS transaction_count
  FROM public.category_monthly_totals c
  GROUP BY c.user_id, c.group_id, c.month;

COMMENT ON VIEW public.monthly_cash_flow IS
  'Entrada, saida e resultado por mes. Rollup de category_monthly_totals para nao ter duas versoes do mesmo numero.';

-- =====================================================
-- SECAO 7: planned_vs_actual  (previsto x realizado)
-- =====================================================
-- A armadilha desta view e o JOIN. O grao e (user_id, group_id, mes) e
-- group_id e NULL na maioria absoluta das linhas -- e em SQL, `NULL = NULL` e
-- NULL, nao verdadeiro. Um FULL OUTER JOIN ingenuo entre previsto e realizado
-- nao casaria NENHUMA linha pessoal: a tela mostraria previsto e realizado em
-- meses separados, cada um com o outro lado zerado, como se o usuario nunca
-- tivesse pago nada do que planejou.
--
-- Por isso as chaves saem de um UNION (que trata NULL como igual, ao contrario
-- do `=`) e os dois lados entram por LATERAL com IS NOT DISTINCT FROM. O teste
-- tem controle negativo: trocando por `=`, ele fica vermelho.
--
-- scheduled_transactions.amount e sempre POSITIVO (CHECK do 005) e a tabela
-- nao tem transaction_type -- o tipo mora na regra. COALESCE(r.transaction_type,
-- 'expense') espelha exatamente o que a rota de baixa faz ao criar a transacao
-- real (app/api/scheduled-transactions/[id]/pay). Se os dois discordassem, uma
-- conta prevista de receita entraria como despesa prevista e viraria receita
-- realizada ao ser paga: o previsto x realizado acusaria um estouro que nao
-- houve.
--
-- Contar a conta paga nos DOIS lados e correto e nao e dupla contagem: previsto
-- e o que estava na agenda, realizado e o que saiu da conta. Sao eixos
-- diferentes do mesmo mes, e a diferenca entre eles e justamente o relatorio.
CREATE OR REPLACE VIEW public.planned_vs_actual AS
  WITH chaves AS (
    SELECT s.user_id, s.group_id, date_trunc('month', s.due_date)::date AS month
    FROM public.scheduled_transactions s
    UNION
    SELECT t.user_id, t.group_id, date_trunc('month', t.transaction_date)::date AS month
    FROM public.financial_transactions t
    WHERE t.transaction_type IN ('expense', 'income')
  )
  SELECT
    k.user_id,
    k.group_id,
    k.month,
    COALESCE(p.planned_expense, 0)::numeric(15,2) AS planned_expense,
    COALESCE(p.planned_income, 0)::numeric(15,2)  AS planned_income,
    COALESCE(a.income, 0)::numeric(15,2)  AS actual_income,
    COALESCE(a.expense, 0)::numeric(15,2) AS actual_expense,
    -- positivo = gastou mais do que tinha previsto
    (COALESCE(a.expense, 0) - COALESCE(p.planned_expense, 0))::numeric(15,2) AS expense_variance,
    COALESCE(p.pending_count, 0) AS pending_count,
    COALESCE(p.overdue_count, 0) AS overdue_count
  FROM chaves k
  LEFT JOIN LATERAL (
    SELECT
      SUM(s.amount) FILTER (WHERE COALESCE(r.transaction_type, 'expense') = 'expense') AS planned_expense,
      SUM(s.amount) FILTER (WHERE COALESCE(r.transaction_type, 'expense') = 'income')  AS planned_income,
      COUNT(*) FILTER (WHERE s.status = 'pending') AS pending_count,
      COUNT(*) FILTER (WHERE s.status = 'pending' AND s.due_date < CURRENT_DATE) AS overdue_count
    FROM public.scheduled_transactions s
    LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id
    WHERE s.user_id = k.user_id
      AND s.group_id IS NOT DISTINCT FROM k.group_id
      AND date_trunc('month', s.due_date)::date = k.month
      -- cancelada nunca foi previsao de verdade
      AND s.status <> 'cancelled'
  ) AS p ON TRUE
  LEFT JOIN LATERAL (
    SELECT f.income, f.expense
    FROM public.monthly_cash_flow f
    WHERE f.user_id = k.user_id
      AND f.group_id IS NOT DISTINCT FROM k.group_id
      AND f.month = k.month
  ) AS a ON TRUE;

COMMENT ON VIEW public.planned_vs_actual IS
  'Previsto (agenda do 005) contra realizado (transacoes) por mes. Chaves por UNION: group_id e NULL e NULL = NULL nao casa.';

-- =====================================================
-- SECAO 8: net_worth_history  (evolucao do patrimonio)
-- =====================================================
-- O banco nao guarda historico de saldo: financial_accounts.current_balance e
-- um numero do presente, mantido por trigger. Entao o patrimonio de um mes
-- passado e reconstruido ANDANDO PARA TRAS a partir de hoje:
--
--   patrimonio(mes M) = saldo de hoje - (tudo que entrou e saiu depois de M)
--
-- Duas consequencias que precisam estar ditas, porque a tela nao tem como
-- adivinhar:
--
--   1) A VARIACAO mes a mes e exata -- ela sai so das transacoes.
--   2) O NIVEL herda qualquer erro que exista hoje em current_balance. Ate o
--      007 ser aplicado em producao, o saldo derivou a cada edicao de
--      lancamento, e a curva inteira sobe ou desce junto com essa deriva. Nao
--      da para corrigir aqui: seria adivinhar qual parte do saldo e abertura
--      de conta e qual e erro. Rode database/maintenance/007_auditoria_saldos.sql.
--
-- Por que 'transfer' ENTRA aqui e fica de fora do fluxo de caixa: a view tem
-- que espelhar o que o trigger update_account_balance faz, e ele soma
-- NEW.amount em QUALQUER tipo. Ignorar transfer aqui faria a conta de tras
-- para frente nao fechar com o saldo de hoje -- e o erro so apareceria para
-- quem usa transferencia, isto e, para quem tem poupanca.
--
-- Pelo mesmo motivo a soma so olha transacoes com account_id NOT NULL: sem
-- conta, o trigger nao mexe em saldo nenhum.
--
-- Contas inativas entram no saldo de hoje. Uma conta encerrada com saldo
-- residual continua sendo patrimonio, e exclui-la faria o patrimonio cair de
-- degrau no mes em que alguem arquivou a conta, sem nenhuma transacao
-- explicando a queda.
CREATE OR REPLACE VIEW public.net_worth_history AS
  WITH saldo_hoje AS (
    SELECT a.user_id, COALESCE(SUM(a.current_balance), 0)::numeric(15,2) AS total
    FROM public.financial_accounts a
    GROUP BY a.user_id
  ),
  movimento AS (
    SELECT
      t.user_id,
      date_trunc('month', t.transaction_date)::date AS month,
      SUM(t.amount)::numeric(15,2) AS net
    FROM public.financial_transactions t
    WHERE t.account_id IS NOT NULL
    GROUP BY t.user_id, date_trunc('month', t.transaction_date)::date
  )
  SELECT
    m.user_id,
    m.month,
    m.net AS net_change,
    -- saldo de hoje menos tudo que se moveu DEPOIS deste mes. A janela nao tem
    -- ORDER BY porque precisa da soma de todas as linhas seguintes, nao de um
    -- acumulado parcial; SUM() OVER (PARTITION BY ...) sem ORDER BY soma a
    -- particao inteira, e por isso o "depois" e feito subtraindo o acumulado
    -- ate o mes corrente do acumulado total.
    (s.total
     - (SUM(m.net) OVER (PARTITION BY m.user_id)
        - SUM(m.net) OVER (PARTITION BY m.user_id ORDER BY m.month
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))
    )::numeric(15,2) AS net_worth
  FROM movimento m
  JOIN saldo_hoje s ON s.user_id = m.user_id;

COMMENT ON VIEW public.net_worth_history IS
  'Patrimonio mes a mes, reconstruido de tras para frente a partir do saldo de hoje. A variacao e exata; o nivel herda a deriva de current_balance.';

-- =====================================================
-- SECAO 9: RLS
-- =====================================================
-- Mesmo desenho do 002, 005, 006 e 007: nega por padrao, libera o dono e - nas
-- linhas de grupo - os membros. Sem policy para anon: a chave anon vai no
-- bundle JS publico.
ALTER TABLE public.financial_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_contributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_goals_select ON public.financial_goals;
CREATE POLICY financial_goals_select ON public.financial_goals
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (group_id IS NOT NULL AND public.is_group_member(group_id))
  );

DROP POLICY IF EXISTS financial_goals_insert ON public.financial_goals;
CREATE POLICY financial_goals_insert ON public.financial_goals
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (group_id IS NULL OR public.is_group_member(group_id))
  );

-- Editar e apagar ficam so com quem criou, inclusive na meta de grupo: mudar o
-- alvo de uma meta coletiva e uma decisao de quem propos, e apagar levaria
-- junto (ON DELETE CASCADE) os aportes de todo mundo.
DROP POLICY IF EXISTS financial_goals_update ON public.financial_goals;
CREATE POLICY financial_goals_update ON public.financial_goals
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS financial_goals_delete ON public.financial_goals;
CREATE POLICY financial_goals_delete ON public.financial_goals
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Aportes: quem enxerga a meta enxerga os aportes dela (numa meta de grupo,
-- ver quanto cada um ja botou e o ponto). Mas so da para aportar em SEU nome,
-- e so em meta que voce enxerga.
DROP POLICY IF EXISTS goal_contributions_select ON public.goal_contributions;
CREATE POLICY goal_contributions_select ON public.goal_contributions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.financial_goals g
      WHERE g.id = goal_contributions.goal_id
        AND (g.user_id = auth.uid()
             OR (g.group_id IS NOT NULL AND public.is_group_member(g.group_id)))
    )
  );

DROP POLICY IF EXISTS goal_contributions_insert ON public.goal_contributions;
CREATE POLICY goal_contributions_insert ON public.goal_contributions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.financial_goals g
      WHERE g.id = goal_contributions.goal_id
        AND (g.user_id = auth.uid()
             OR (g.group_id IS NOT NULL AND public.is_group_member(g.group_id)))
    )
  );

DROP POLICY IF EXISTS goal_contributions_update ON public.goal_contributions;
CREATE POLICY goal_contributions_update ON public.goal_contributions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS goal_contributions_delete ON public.goal_contributions;
CREATE POLICY goal_contributions_delete ON public.goal_contributions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =====================================================
-- SECAO 10: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes destes objetos existirem, e ALL
-- TABLES nao alcanca o futuro.
REVOKE ALL ON public.financial_goals FROM anon;
REVOKE ALL ON public.goal_contributions FROM anon;
REVOKE ALL ON public.goal_progress FROM anon;
REVOKE ALL ON public.category_monthly_totals FROM anon;
REVOKE ALL ON public.monthly_cash_flow FROM anon;
REVOKE ALL ON public.planned_vs_actual FROM anon;
REVOKE ALL ON public.net_worth_history FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_goals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goal_contributions TO authenticated;
GRANT SELECT ON public.goal_progress TO authenticated;
GRANT SELECT ON public.category_monthly_totals TO authenticated;
GRANT SELECT ON public.monthly_cash_flow TO authenticated;
GRANT SELECT ON public.planned_vs_actual TO authenticated;
GRANT SELECT ON public.net_worth_history TO authenticated;

-- Sem security_invoker a view roda com o privilegio do DONO e a RLS das
-- tabelas base nao vale. Aqui isso seria o pior vazamento do projeto ate agora:
-- monthly_cash_flow devolveria a renda e o gasto mensal de TODOS os usuarios do
-- sistema para qualquer um que estivesse logado, e net_worth_history devolveria
-- o patrimonio de cada um. Mesma pegadinha do 005, do 006 e do 007 -- e o teste
-- tem controle negativo para ela.
ALTER VIEW public.goal_progress SET (security_invoker = true);
ALTER VIEW public.category_monthly_totals SET (security_invoker = true);
ALTER VIEW public.monthly_cash_flow SET (security_invoker = true);
ALTER VIEW public.planned_vs_actual SET (security_invoker = true);
ALTER VIEW public.net_worth_history SET (security_invoker = true);

-- =====================================================
-- SECAO 11: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('008', '008_goals_and_reports',
        'Metas com aportes (financial_goals, goal_contributions) e as views dos relatorios - HMO-137 Fase 4', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 9. 009_statements_alerts_receipts.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - EXTRATO, AVISOS DE VENCIMENTO E COMPROVANTES
-- =====================================================
-- Migration: 009_statements_alerts_receipts
-- Gerado em: 2026-09-22  (HMO-137, Fase 5 da evolucao do produto)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.statement_imports        um arquivo de extrato enviado (OFX ou CSV)
--   public.statement_entries        cada linha lida do arquivo, antes de virar lancamento
--   public.notification_preferences quantos dias antes avisar, e se avisa
--   public.push_subscriptions       os aparelhos que aceitaram receber push
--   public.bill_notifications       o que ja foi avisado  (e o que impede repetir)
--   public.bill_alerts              o que vence, com quantos dias faltam (view)
--   public.receipts                 comprovante anexado a um lancamento
--
-- Como o 008, este arquivo so ACRESCENTA: nenhuma funcao, tabela ou trigger de
-- producao e alterada. As tabelas sao novas e a unica view e leitura pura.
--
-- POR QUE O EXTRATO NAO ENTRA DIRETO EM financial_transactions
-- -------------------------------------------------------------
-- A tentacao e ler o OFX e dar INSERT em financial_transactions direto. Foi
-- rejeitado por quatro razoes, em ordem de gravidade:
--
--   1) financial_transactions.category_id e NOT NULL e o extrato do banco NAO
--      traz categoria. Sem uma area de espera, ou o import falha na primeira
--      linha, ou inventa uma categoria "Outros" e o orcamento por categoria do
--      006 passa a mentir em silencio -- que e pior.
--   2) O INSERT dispara update_account_balance. Importar duas vezes o mesmo
--      arquivo mexeria no saldo duas vezes, e o 007 mostrou o que custa uma
--      linha de trigger que mexe em dinheiro sem ninguem ver.
--   3) Metade do extrato JA ESTA lancado a mao. Sem conciliacao, o usuario
--      importa e ve o mes dobrado de tamanho -- cada almoco aparece duas vezes.
--   4) O arquivo do banco e a fonte de um fato bruto e imutavel; o lancamento
--      e uma coisa editavel que pertence ao usuario. Misturar os dois tira a
--      possibilidade de reconferir "o que o banco realmente mandou".
--
-- Entao statement_entries e uma AREA DE ESPERA: o arquivo entra inteiro, a
-- conciliacao marca o que ja existe, e o usuario decide linha a linha. So
-- quando ele decide e que nasce a financial_transaction -- e a entrada guarda
-- o transaction_id para nunca mais oferecer a mesma linha.
--
-- O SINAL DO VALOR, MAIS UMA VEZ
-- -------------------------------
-- Despesa e gravada NEGATIVA em financial_transactions, e o <TRNAMT> do OFX ja
-- vem negativo num debito. statement_entries.amount guarda o sinal EXATAMENTE
-- como o banco mandou, sem ABS e sem normalizar: e desse sinal que sai o
-- transaction_type na hora de criar o lancamento (negativo -> expense,
-- positivo -> income). Um ABS() aqui faria toda despesa importada virar
-- receita, e os quatro relatorios do 008 passariam a mostrar um mes de lucro
-- onde houve um mes de gasto -- sem nenhum erro aparecer. O teste tem controle
-- negativo para isso.
--
-- POR QUE A DEDUPLICACAO E UM `fingerprint`, E NAO O FITID
-- --------------------------------------------------------
-- O OFX traz <FITID>, um id unico do banco por lancamento. O CSV nao traz
-- nada. Duas regras de deduplicacao diferentes viram duas versoes da mesma
-- regra, e a segunda para de acompanhar a primeira. Entao ha uma coluna so,
-- `fingerprint`, calculada no TypeScript (lib/statement.ts):
--
--   com FITID:  'fitid:' || fit_id
--   sem FITID:  'h:' || data || '|' || valor || '|' || descricao || '|#' || n
--
-- O `#n` e o que impede um falso positivo caro: dois cafes de R$ 8,00 no mesmo
-- dia e na mesma cafeteria sao dois fatos, nao um repetido. O n e a ordem da
-- linha DENTRO do arquivo entre as linhas identicas, entao reimportar o mesmo
-- arquivo devolve exatamente os mesmos fingerprints (e nao duplica), enquanto
-- dois cafes de verdade recebem #1 e #2 e entram os dois.
--
-- POR QUE bill_notifications EXISTE
-- ----------------------------------
-- Sem um registro do que ja foi avisado, o cron que roda de manha manda "o
-- aluguel vence em 3 dias" TODO dia ate o aluguel ser pago. Tres notificacoes
-- da mesma conta e o usuario desliga o aviso -- e ai o produto perde a unica
-- funcionalidade desta secao. A chave unica inclui reference_date de proposito:
-- mudar a data de vencimento e um fato novo e merece um aviso novo.
--
-- COMO RODAR
-- ----------
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/009_statements_alerts_receipts.sql
--
-- Aplicar depois de 001 -> ... -> 008. O preflight aborta a transacao inteira
-- listando tudo que falta de uma vez.
--
-- A SECAO 9 (bucket de comprovantes) SO RODA NUM SUPABASE de verdade: ela
-- depende do schema `storage`, que num Postgres cru nao existe. Num Postgres
-- cru ela e pulada com um NOTICE, e o resto do arquivo aplica normalmente --
-- e por isso que o CI consegue provar as outras oito secoes.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: O ARQUIVO CABE NESTE BANCO?
-- =====================================================
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(DISTINCT msg, E'\n' ORDER BY msg) INTO v_faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.' || quote_ident(r.tabela)) IS NULL
               THEN format('  - tabela public.%s nao existe', r.tabela)
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || quote_ident(r.tabela))
                      AND a.attname = r.coluna
                      AND a.attnum > 0
                      AND NOT a.attisdropped)
               THEN format('  - coluna public.%s.%s nao existe', r.tabela, r.coluna)
           END AS msg
    FROM (VALUES
      ('financial_accounts', 'user_id'),
      ('financial_transactions', 'amount'),
      ('financial_transactions', 'transaction_date'),
      ('financial_transactions', 'account_id'),
      -- do 005: o aviso de vencimento le a agenda de contas previstas
      ('scheduled_transactions', 'due_date'),
      ('scheduled_transactions', 'status'),
      ('recurring_rules', 'transaction_type'),
      -- do 007: o comprovante tambem serve para o acerto de grupo
      ('group_settlements', 'id'),
      ('schema_migrations', 'version')
    ) AS r(tabela, coluna)

    UNION ALL
    SELECT format('  - funcao public.%s nao existe', f.nome)
    FROM (VALUES
      ('update_updated_at_column()'),
      ('is_group_member(uuid)')
    ) AS f(nome)
    WHERE to_regprocedure('public.' || f.nome) IS NULL

    UNION ALL
    SELECT format('  - role %s nao existe', r.rolname)
    FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname = r.rolname)
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'009 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008 antes.', v_faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: statement_imports  (o arquivo enviado)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.statement_imports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    -- NOT NULL de proposito: um extrato sem conta nao pode ser conciliado nem
    -- deduplicado (o fingerprint e unico POR CONTA). "Importar e escolher a
    -- conta depois" produziria linhas que nao casam com nada.
    account_id uuid NOT NULL,
    file_name text NOT NULL,
    file_format text NOT NULL,
    -- periodo coberto pelo arquivo, lido do proprio conteudo. Serve para a tela
    -- dizer "este extrato vai de 01/09 a 30/09" antes de o usuario confirmar --
    -- e para ele perceber que mandou o arquivo do mes errado.
    period_start date,
    period_end date,
    entry_count integer NOT NULL DEFAULT 0,
    -- quantas linhas o arquivo tinha a mais do que entraram: o que foi
    -- descartado por ja existir. Sem este numero o usuario manda o arquivo de
    -- novo, ve "0 lancamentos novos" e acha que o import quebrou.
    duplicate_count integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'open',
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT statement_imports_pkey PRIMARY KEY (id),
    CONSTRAINT statement_imports_format_check CHECK (file_format IN ('ofx', 'csv')),
    CONSTRAINT statement_imports_status_check CHECK (status IN ('open', 'done', 'discarded')),
    CONSTRAINT statement_imports_counts_check CHECK (entry_count >= 0 AND duplicate_count >= 0),
    -- periodo invertido e sinal de parser quebrado, nao de extrato estranho
    CONSTRAINT statement_imports_period_check CHECK (
      period_start IS NULL OR period_end IS NULL OR period_start <= period_end
    ),
    CONSTRAINT statement_imports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT statement_imports_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.statement_imports IS
  'Um arquivo de extrato enviado. As linhas ficam em statement_entries; nada entra direto em financial_transactions.';
COMMENT ON COLUMN public.statement_imports.duplicate_count IS
  'Linhas do arquivo que ja existiam (mesmo fingerprint). Sem este numero, reimportar parece um import quebrado.';

CREATE INDEX IF NOT EXISTS idx_statement_imports_user ON public.statement_imports(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_statement_imports_account ON public.statement_imports(account_id);

-- =====================================================
-- SECAO 2: statement_entries  (cada linha do arquivo)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.statement_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_id uuid NOT NULL,
    user_id uuid NOT NULL,
    -- repetida do import de proposito: o indice unico da deduplicacao e por
    -- CONTA e precisa alcancar linhas de arquivos diferentes. Buscar a conta
    -- pelo import dentro de um indice nao e possivel.
    account_id uuid NOT NULL,
    fit_id text,
    fingerprint text NOT NULL,
    posted_at date NOT NULL,
    -- SINAL PRESERVADO. Ver o cabecalho: e daqui que sai o transaction_type.
    amount numeric(15,2) NOT NULL,
    description text NOT NULL,
    memo text,
    status text NOT NULL DEFAULT 'pending',
    -- o lancamento que nasceu desta linha ('imported') ou o lancamento que ja
    -- existia e a conciliacao encontrou ('linked'). Nos dois casos a linha para
    -- de ser oferecida.
    transaction_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT statement_entries_pkey PRIMARY KEY (id),
    -- lancamento de R$ 0,00 nao existe em extrato: e linha de cabecalho ou de
    -- saldo que o parser leu errado.
    CONSTRAINT statement_entries_amount_check CHECK (amount <> 0),
    CONSTRAINT statement_entries_status_check CHECK (status IN ('pending', 'imported', 'linked', 'ignored')),
    -- Paridade status <-> transaction_id, no mesmo espirito do
    -- scheduled_transactions_paid_check do 005: 'imported' e 'linked' EXIGEM um
    -- lancamento, 'pending' e 'ignored' nao podem ter nenhum. Sem isto, uma
    -- linha marcada como importada sem transacao ficaria invisivel para sempre
    -- sem nunca ter virado dinheiro nenhum.
    CONSTRAINT statement_entries_link_check CHECK (
      (status IN ('imported', 'linked') AND transaction_id IS NOT NULL)
      OR (status IN ('pending', 'ignored') AND transaction_id IS NULL)
    ),
    CONSTRAINT statement_entries_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.statement_imports(id) ON DELETE CASCADE,
    CONSTRAINT statement_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT statement_entries_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id) ON DELETE CASCADE,
    -- SET NULL e nao CASCADE: apagar o lancamento nao pode apagar o registro de
    -- que o banco mandou aquela linha. Mas ai a paridade acima seria violada,
    -- entao a trigger da SECAO 3 devolve a linha para 'pending' -- e ela volta
    -- a ser oferecida, que e exatamente o certo.
    CONSTRAINT statement_entries_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.financial_transactions(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.statement_entries IS
  'Linhas do extrato em area de espera. amount guarda o SINAL do banco: negativo = saida.';
COMMENT ON COLUMN public.statement_entries.fingerprint IS
  'Chave de deduplicacao, calculada em lib/statement.ts. fitid:<id> no OFX, hash da linha + ordinal no CSV.';

-- A deduplicacao inteira mora neste indice. Reimportar o mesmo arquivo nao
-- duplica nada porque o ON CONFLICT DO NOTHING da rota bate exatamente aqui.
CREATE UNIQUE INDEX IF NOT EXISTS idx_statement_entries_fingerprint
  ON public.statement_entries(account_id, fingerprint);

CREATE INDEX IF NOT EXISTS idx_statement_entries_import ON public.statement_entries(import_id, posted_at);
CREATE INDEX IF NOT EXISTS idx_statement_entries_pending
  ON public.statement_entries(user_id, posted_at DESC) WHERE status = 'pending';

-- =====================================================
-- SECAO 3: a linha volta a ser oferecida se o lancamento sumir
-- =====================================================
-- Sem esta funcao, apagar um lancamento que nasceu de um import violaria
-- statement_entries_link_check e o DELETE falharia com um erro de constraint na
-- cara do usuario -- ou, se o check nao existisse, deixaria uma linha
-- 'imported' apontando para o nada, invisivel para sempre.
--
-- SECURITY DEFINER e SET search_path pelo mesmo motivo do 003 e do 004: o
-- trigger roda como `authenticated`, que nao tem privilegio direto de UPDATE
-- garantido em toda tabela, e sem o search_path fixo um schema no caminho do
-- usuario poderia sequestrar o nome.
CREATE OR REPLACE FUNCTION public.statement_entry_release_on_transaction_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.statement_entries
     SET status = 'pending',
         transaction_id = NULL
   WHERE transaction_id = OLD.id;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.statement_entry_release_on_transaction_delete() IS
  'Apagou o lancamento? A linha do extrato volta para pending e e oferecida de novo.';

-- BEFORE DELETE e nao AFTER: o ON DELETE SET NULL da FK roda junto com o
-- DELETE, e um AFTER encontraria transaction_id ja NULL -- o UPDATE nao acharia
-- nenhuma linha e a entrada ficaria 'imported' com transaction_id NULL, que e
-- justamente o estado que o check proibe.
DROP TRIGGER IF EXISTS release_statement_entry ON public.financial_transactions;
CREATE TRIGGER release_statement_entry
  BEFORE DELETE ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.statement_entry_release_on_transaction_delete();

DROP TRIGGER IF EXISTS set_statement_imports_updated_at ON public.statement_imports;
CREATE TRIGGER set_statement_imports_updated_at
  BEFORE UPDATE ON public.statement_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- SECAO 4: notification_preferences  (avisar quando?)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    user_id uuid NOT NULL,
    -- 3 dias e o default porque e o prazo que ainda da para agir: ver a conta
    -- no dia do vencimento nao evita a multa se o banco ja fechou.
    days_before integer NOT NULL DEFAULT 3,
    notify_due_soon boolean NOT NULL DEFAULT true,
    notify_overdue boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id),
    -- 0 = so no dia. Acima de 30 o aviso deixa de ser aviso e vira ruido de
    -- fundo; e o limite tambem protege a varredura do cron.
    CONSTRAINT notification_preferences_days_check CHECK (days_before BETWEEN 0 AND 30),
    CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.notification_preferences IS
  'Quantos dias antes avisar. Linha ausente = o default de 3 dias, aplicado por COALESCE em bill_alerts.';

DROP TRIGGER IF EXISTS set_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER set_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- SECAO 5: push_subscriptions  (os aparelhos)
-- =====================================================
-- Um usuario tem varios: o celular, o notebook, o tablet. Cada um e um
-- endpoint distinto do servico de push do navegador.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    -- as duas chaves da assinatura. Sem elas nao da para cifrar o payload, e o
    -- servico de push recusa a entrega.
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    last_success_at timestamp with time zone,
    -- o navegador devolve 404/410 quando o usuario desinstalou o PWA ou limpou
    -- os dados. Contar a falha permite parar de tentar em vez de acumular
    -- endpoints mortos para sempre.
    failure_count integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id),
    -- UNIQUE no endpoint sozinho, sem o user_id: o mesmo navegador reassinando
    -- gera o mesmo endpoint, e duas linhas iguais mandariam a notificacao em
    -- duplicata para o mesmo aparelho.
    CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint),
    CONSTRAINT push_subscriptions_failure_check CHECK (failure_count >= 0),
    CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.push_subscriptions IS
  'Aparelhos que aceitaram push. endpoint e UNIQUE global: o mesmo navegador reassinando nao vira duas linhas.';

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id);

-- =====================================================
-- SECAO 6: bill_notifications  (o que ja foi avisado)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.bill_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    scheduled_transaction_id uuid NOT NULL,
    kind text NOT NULL,
    -- o due_date que originou o aviso. Faz parte da chave unica: adiar a conta
    -- e um fato novo e merece um aviso novo. Ver o cabecalho.
    reference_date date NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    -- entregue por push, ou so no sino do app? 'inapp' e o que acontece quando
    -- o usuario nao assinou push, ou quando o VAPID nao esta configurado no
    -- servidor -- e continua sendo um aviso util.
    channel text NOT NULL DEFAULT 'inapp',
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT bill_notifications_pkey PRIMARY KEY (id),
    CONSTRAINT bill_notifications_kind_check CHECK (kind IN ('due_soon', 'overdue')),
    CONSTRAINT bill_notifications_channel_check CHECK (channel IN ('inapp', 'push')),
    -- ESTA e a linha que impede o aplicativo de virar spam. Ver o cabecalho.
    CONSTRAINT bill_notifications_unique UNIQUE (scheduled_transaction_id, kind, reference_date),
    CONSTRAINT bill_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT bill_notifications_scheduled_id_fkey FOREIGN KEY (scheduled_transaction_id) REFERENCES public.scheduled_transactions(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.bill_notifications IS
  'Avisos de vencimento ja emitidos. A UNIQUE (conta, tipo, data) e o que impede repetir o mesmo aviso todo dia.';

CREATE INDEX IF NOT EXISTS idx_bill_notifications_user
  ON public.bill_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_notifications_unread
  ON public.bill_notifications(user_id) WHERE read_at IS NULL;

-- =====================================================
-- SECAO 7: bill_alerts  (o que vence, e ja foi avisado?)
-- =====================================================
-- Uma definicao so, usada por dois consumidores: o cron, que filtra
-- `already_notified = false` e manda; e o sino do app, que mostra tudo. Duas
-- consultas separadas sairiam de sincronia na primeira vez que alguem mudasse
-- a janela de dias, e o usuario veria no sino uma conta que o push nunca
-- mandou (ou o contrario).
--
-- `status = 'pending'` e o filtro central: conta paga ou cancelada nao gera
-- aviso. O CHECK do 005 garante que 'paid' tem paid_date e transaction_id,
-- entao nao ha estado ambiguo aqui.
--
-- COALESCE(p.days_before, 3) e o que faz a view funcionar para quem nunca
-- abriu a tela de preferencias -- que e todo mundo, no dia em que isto sobe.
-- Um INNER JOIN em notification_preferences daria uma view vazia e o cron
-- silenciosamente nao avisaria ninguem, sem erro nenhum.
CREATE OR REPLACE VIEW public.bill_alerts AS
  SELECT
    s.id AS scheduled_transaction_id,
    s.user_id,
    s.group_id,
    s.account_id,
    s.description,
    s.amount,
    s.due_date,
    (s.due_date - CURRENT_DATE) AS days_until,
    CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END AS kind,
    COALESCE(p.days_before, 3) AS days_before,
    -- o tipo mora na regra, nao na ocorrencia; sem regra e despesa. Mesmo
    -- COALESCE de planned_vs_actual no 008 e da rota de baixa -- as tres
    -- precisam concordar ou uma conta prevista de receita vira despesa.
    COALESCE(r.transaction_type, 'expense') AS transaction_type,
    EXISTS (
      SELECT 1 FROM public.bill_notifications n
      WHERE n.scheduled_transaction_id = s.id
        AND n.kind = (CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END)
        AND n.reference_date = s.due_date
    ) AS already_notified
  FROM public.scheduled_transactions s
  LEFT JOIN public.notification_preferences p ON p.user_id = s.user_id
  LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id
  WHERE s.status = 'pending'
    -- vencida entra sempre que o usuario quiser ver vencidas; a vencer, so
    -- dentro da janela dele.
    AND (
      (s.due_date < CURRENT_DATE AND COALESCE(p.notify_overdue, true))
      OR (s.due_date >= CURRENT_DATE
          AND COALESCE(p.notify_due_soon, true)
          AND s.due_date - CURRENT_DATE <= COALESCE(p.days_before, 3))
    );

COMMENT ON VIEW public.bill_alerts IS
  'Contas que merecem aviso hoje, com already_notified. Uma definicao para o cron e para o sino do app.';

-- =====================================================
-- SECAO 8: receipts  (o comprovante)
-- =====================================================
-- financial_transactions.attachment_url ja existe no 001 e e um texto livre --
-- qualquer URL, sem dono, sem tamanho, sem tipo. Ela continua onde esta e NAO e
-- alterada por este arquivo: mexer nela migraria dados de producao as cegas.
-- `receipts` e o caminho novo, com arquivo de verdade no Storage, e aceita mais
-- de um comprovante por lancamento (a nota fiscal E o boleto).
CREATE TABLE IF NOT EXISTS public.receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    -- exatamente UM dos tres. Um comprovante solto nao tem a que se referir, e
    -- um comprovante ligado a dois lugares apareceria duas vezes no total.
    transaction_id uuid,
    scheduled_transaction_id uuid,
    settlement_id uuid,
    -- caminho dentro do bucket 'receipts', sempre '<user_id>/<uuid>.<ext>'. A
    -- policy do Storage (SECAO 9) le a primeira pasta do caminho para decidir
    -- o dono, entao o prefixo nao e cosmetico.
    storage_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text NOT NULL,
    byte_size integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT receipts_pkey PRIMARY KEY (id),
    CONSTRAINT receipts_storage_path_key UNIQUE (storage_path),
    CONSTRAINT receipts_target_check CHECK (
      num_nonnulls(transaction_id, scheduled_transaction_id, settlement_id) = 1
    ),
    -- 10 MB. Foto de boleto pelo celular da 2-4 MB; acima de 10 e video ou PDF
    -- digitalizado em 600dpi, e o plano gratuito do Storage some em uma semana.
    CONSTRAINT receipts_size_check CHECK (byte_size > 0 AND byte_size <= 10485760),
    CONSTRAINT receipts_mime_check CHECK (
      mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')
    ),
    CONSTRAINT receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT receipts_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.financial_transactions(id) ON DELETE CASCADE,
    CONSTRAINT receipts_scheduled_id_fkey FOREIGN KEY (scheduled_transaction_id) REFERENCES public.scheduled_transactions(id) ON DELETE CASCADE,
    CONSTRAINT receipts_settlement_id_fkey FOREIGN KEY (settlement_id) REFERENCES public.group_settlements(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.receipts IS
  'Comprovante no Storage. O arquivo em si NAO e apagado pelo CASCADE -- ver a nota da SECAO 9.';
COMMENT ON COLUMN public.receipts.storage_path IS
  'Sempre <user_id>/<uuid>.<ext>: a policy do Storage decide o dono pela primeira pasta do caminho.';

CREATE INDEX IF NOT EXISTS idx_receipts_transaction ON public.receipts(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_scheduled ON public.receipts(scheduled_transaction_id) WHERE scheduled_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_settlement ON public.receipts(settlement_id) WHERE settlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_user ON public.receipts(user_id, created_at DESC);

-- =====================================================
-- SECAO 9: RLS
-- =====================================================
-- Mesmo desenho do 002, 005, 006, 007 e 008: nega por padrao, libera o dono e
-- - nas linhas de grupo - os membros. Sem policy para anon: a chave anon vai no
-- bundle JS publico.
ALTER TABLE public.statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statement_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

-- Extrato e sempre pessoal, mesmo quando a conta e usada para gastos de grupo:
-- o arquivo do banco traz TUDO que passou na conta, inclusive o que nao tem
-- nada a ver com a viagem. Nenhuma policy de grupo aqui, de proposito.
DROP POLICY IF EXISTS statement_imports_all ON public.statement_imports;
CREATE POLICY statement_imports_all ON public.statement_imports
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS statement_entries_all ON public.statement_entries;
CREATE POLICY statement_entries_all ON public.statement_entries
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notification_preferences_all ON public.notification_preferences;
CREATE POLICY notification_preferences_all ON public.notification_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_all ON public.push_subscriptions;
CREATE POLICY push_subscriptions_all ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- O usuario le e marca como lido; quem CRIA o aviso e o cron, com a
-- service_role, que passa por cima de RLS. Sem policy de INSERT para
-- authenticated de proposito: nada no navegador deveria poder fabricar um
-- aviso de vencimento.
DROP POLICY IF EXISTS bill_notifications_select ON public.bill_notifications;
CREATE POLICY bill_notifications_select ON public.bill_notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS bill_notifications_update ON public.bill_notifications;
CREATE POLICY bill_notifications_update ON public.bill_notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS bill_notifications_delete ON public.bill_notifications;
CREATE POLICY bill_notifications_delete ON public.bill_notifications
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- O comprovante do acerto de grupo o grupo inteiro precisa ver: e a prova de
-- que o pagamento aconteceu, e foi por isso que o acerto existiu no 007. Os
-- outros dois alvos sao pessoais.
DROP POLICY IF EXISTS receipts_select ON public.receipts;
CREATE POLICY receipts_select ON public.receipts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (settlement_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.group_settlements gs
          WHERE gs.id = receipts.settlement_id
            AND public.is_group_member(gs.group_id)
        ))
  );

DROP POLICY IF EXISTS receipts_insert ON public.receipts;
CREATE POLICY receipts_insert ON public.receipts
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS receipts_delete ON public.receipts;
CREATE POLICY receipts_delete ON public.receipts
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =====================================================
-- SECAO 10: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes destes objetos existirem, e ALL
-- TABLES nao alcanca o futuro.
REVOKE ALL ON public.statement_imports FROM anon;
REVOKE ALL ON public.statement_entries FROM anon;
REVOKE ALL ON public.notification_preferences FROM anon;
REVOKE ALL ON public.push_subscriptions FROM anon;
REVOKE ALL ON public.bill_notifications FROM anon;
REVOKE ALL ON public.receipts FROM anon;
REVOKE ALL ON public.bill_alerts FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.statement_imports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.statement_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT SELECT, UPDATE, DELETE ON public.bill_notifications TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.receipts TO authenticated;
GRANT SELECT ON public.bill_alerts TO authenticated;

-- Sem security_invoker a view roda com o privilegio do DONO e a RLS das tabelas
-- base nao vale: bill_alerts devolveria as contas a vencer de TODOS os usuarios
-- do sistema -- descricao, valor e data -- para qualquer um logado. Mesma
-- pegadinha do 005, 006, 007 e 008, e o teste tem controle negativo para ela.
ALTER VIEW public.bill_alerts SET (security_invoker = true);

-- =====================================================
-- SECAO 11: bucket de comprovantes  (SO NO SUPABASE)
-- =====================================================
-- Num Postgres cru o schema `storage` nao existe e este bloco e pulado inteiro
-- com um NOTICE -- e por isso que o CI consegue provar as dez secoes acima.
--
-- O bucket e PRIVADO. Publico seria uma URL adivinhavel com a foto do boleto de
-- alguem: nome, CPF parcial, valor e codigo de barras. A leitura sai por URL
-- assinada, gerada pela rota com o usuario ja autenticado.
--
-- A policy decide o dono por (storage.foldername(name))[1] -- a primeira pasta
-- do caminho. E por isso que storage_path e sempre '<user_id>/<uuid>.<ext>'.
--
-- O ARQUIVO NAO E APAGADO PELO CASCADE: apagar o lancamento apaga a linha de
-- `receipts`, mas o objeto continua no bucket ocupando espaco. Isso e
-- deliberado -- um trigger que apaga arquivo e irreversivel e roda fora da
-- transacao. A rota DELETE /api/receipts/[id] apaga os dois na ordem certa; o
-- que sobra e o orfao de quem apagou o lancamento direto pela tela de
-- lancamentos, e isso fica como divida anotada aqui.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE '009: schema storage ausente (Postgres cru) - bucket de comprovantes PULADO. Num Supabase esta secao roda.';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('receipts', 'receipts', false, 10485760,
          ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
  ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

  EXECUTE $pol$ DROP POLICY IF EXISTS receipts_objects_select ON storage.objects $pol$;
  EXECUTE $pol$
    CREATE POLICY receipts_objects_select ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'receipts'
             AND (storage.foldername(name))[1] = auth.uid()::text)
  $pol$;

  EXECUTE $pol$ DROP POLICY IF EXISTS receipts_objects_insert ON storage.objects $pol$;
  EXECUTE $pol$
    CREATE POLICY receipts_objects_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'receipts'
                  AND (storage.foldername(name))[1] = auth.uid()::text)
  $pol$;

  EXECUTE $pol$ DROP POLICY IF EXISTS receipts_objects_delete ON storage.objects $pol$;
  EXECUTE $pol$
    CREATE POLICY receipts_objects_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'receipts'
             AND (storage.foldername(name))[1] = auth.uid()::text)
  $pol$;

  RAISE NOTICE '009: bucket receipts criado/atualizado (privado) com as tres policies.';
END $$;

-- =====================================================
-- SECAO 12: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('009', '009_statements_alerts_receipts',
        'Importacao de extrato com conciliacao, avisos de vencimento e comprovantes - HMO-137 Fase 5', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 10. 010_user_connections.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - CONEXOES ENTRE USUARIOS
-- =====================================================
-- Migration: 010_user_connections
-- Gerado em: 2026-09-22  (HMO-124)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.user_connections   o pedido de conexao entre duas pessoas e o que
--                             aconteceu com ele (pendente / aceito / bloqueado)
--
-- Como o 008 e o 009, este arquivo so ACRESCENTA: nenhuma funcao, tabela,
-- policy ou trigger de producao e alterada.
--
-- POR QUE ESTA TABELA EXISTE
-- ---------------------------
-- Ela nao e uma feature nova: e a unica peca que faltava de uma feature que ja
-- estava inteira no codigo. A tela /dashboard/connections (596 linhas), seis
-- rotas de API e a coluna profiles.allow_connections ja existiam e ja
-- chamavam `user_connections` -- que nunca foi criada. A PostgREST responde
-- PGRST205 "Could not find the table", a tela mostra "Erro ao carregar dados"
-- e o item "Conexoes" do menu leva todo usuario logado a esse erro. Ver
-- HMO-124.
--
-- No produto, conexao nao e rede social: e a lista de pessoas com quem voce
-- divide gasto. `app/api/personal-finance/connections` le exatamente as
-- conexoes com status 'accepted' para oferecer quem pode entrar num rateio.
-- Sem a tabela, essa lista chega sempre vazia -- e dividir uma despesa com a
-- esposa so funciona dentro de um grupo.
--
-- OS NOMES DAS DUAS FOREIGN KEYS NAO SAO LIVRES
-- ----------------------------------------------
-- A tela e as rotas leem o perfil do outro lado por embed da PostgREST:
--
--     requester:profiles!user_connections_requester_id_fkey(...)
--
-- A PostgREST resolve esse embed pelo NOME da constraint. Os dois nomes abaixo
-- -- user_connections_requester_id_fkey e user_connections_requested_id_fkey --
-- sao portanto parte do contrato com o codigo que ja existe. Criar as FKs com
-- nome gerado automaticamente faria a tabela existir e as consultas
-- continuarem falhando, com um erro diferente e mais dificil de ligar a causa.
--
-- AS FKs APONTAM PARA public.profiles, NAO PARA auth.users
-- ---------------------------------------------------------
-- Pelo mesmo motivo: o embed acima so e possivel se a FK apontar para a tabela
-- que se quer embutir. Apontar para auth.users (como fazem statement_imports e
-- receipts, que nao precisam de embed) deixaria a integridade igual, porque
-- profiles.id ja e FK para auth.users(id) ON DELETE CASCADE -- mas quebraria
-- as seis chamadas.
--
-- O PAR E UNICO NOS DOIS SENTIDOS
-- --------------------------------
-- Uma UNIQUE (requester_id, requested_id) comum deixaria passar o par
-- invertido: A pede para B, B pede para A, e nascem DUAS linhas pendentes.
-- Cada um veria um pedido do outro; aceitar um deixaria o outro pendente para
-- sempre, e a tela mostraria "1 pendente" em vermelho sem nada para resolver.
-- O indice unico e sobre o par NAO ORDENADO (LEAST, GREATEST), entao o segundo
-- pedido bate em 23505 -- que e exatamente o codigo que a tela ja trata com a
-- mensagem "Solicitacao ja enviada para este usuario".
--
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: pre-requisitos
-- =====================================================
-- Sem isto a tabela nasce, as policies nascem, e so o USO em producao
-- descobre que profiles.allow_connections nao existe naquele banco.
DO $$
DECLARE
  faltando text;
BEGIN
  SELECT string_agg(msg, E'\n') INTO faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.profiles') IS NULL
               THEN '  - tabela public.profiles nao existe'
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.profiles')
                      AND a.attname = r.coluna
                      AND a.attnum > 0 AND NOT a.attisdropped)
               THEN format('  - coluna public.profiles.%s nao existe', r.coluna)
           END AS msg
    FROM (VALUES ('id'), ('is_public'), ('allow_connections')) AS r(coluna)
  ) t
  WHERE msg IS NOT NULL;

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION E'010 nao pode ser aplicado neste banco:\n%', faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: a tabela
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    -- quem pediu
    requester_id uuid NOT NULL,
    -- quem recebeu o pedido. So ELE pode aceitar -- ver SECAO 4.
    requested_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    -- recado opcional junto do pedido ("sou eu, do grupo da viagem")
    message text,
    created_at timestamp with time zone DEFAULT now(),
    responded_at timestamp with time zone,

    CONSTRAINT user_connections_pkey PRIMARY KEY (id),

    CONSTRAINT user_connections_status_check
      CHECK (status IN ('pending', 'accepted', 'blocked')),

    -- Conectar-se consigo mesmo entraria como uma conexao aceita comum e
    -- apareceria na lista de quem pode dividir uma despesa -- o usuario
    -- poderia ratear um gasto "com ele mesmo" e o acerto do grupo passaria a
    -- ter um participante que e o proprio pagador.
    CONSTRAINT user_connections_no_self_check
      CHECK (requester_id <> requested_id),

    -- responded_at e o carimbo da resposta: existe exatamente quando ja houve
    -- resposta. Sem esta amarra, uma rota que esqueca de gravar o carimbo
    -- produz conexoes aceitas sem data, e a unica forma de perceber e olhar
    -- linha a linha no banco.
    CONSTRAINT user_connections_responded_at_check
      CHECK ((status = 'pending') = (responded_at IS NULL)),

    -- Os dois nomes abaixo sao contrato com os embeds da PostgREST. Ver o
    -- cabecalho.
    CONSTRAINT user_connections_requester_id_fkey
      FOREIGN KEY (requester_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT user_connections_requested_id_fkey
      FOREIGN KEY (requested_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.user_connections IS
  'Pedido de conexao entre duas pessoas. Conexao aceita e o que habilita dividir uma despesa fora de um grupo.';
COMMENT ON COLUMN public.user_connections.requested_id IS
  'Quem recebeu o pedido. A policy de UPDATE so permite a ELE mudar o status -- quem pede nao aceita o proprio pedido.';
COMMENT ON COLUMN public.user_connections.status IS
  'pending -> aceito pelo requested (accepted) ou recusado por ele (blocked). Nao volta para pending.';

-- =====================================================
-- SECAO 2: o par unico nos dois sentidos
-- =====================================================
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_connections_pair
  ON public.user_connections (
    LEAST(requester_id, requested_id),
    GREATEST(requester_id, requested_id)
  );

COMMENT ON INDEX public.uniq_user_connections_pair IS
  'Par nao ordenado: impede A->B e B->A coexistirem como dois pedidos pendentes. Da 23505, que a tela ja trata.';

-- =====================================================
-- SECAO 3: indices de leitura
-- =====================================================
-- A tela abre em duas consultas: "minhas conexoes aceitas" (os dois lados) e
-- "pedidos pendentes para mim". Uma so por consulta.
CREATE INDEX IF NOT EXISTS idx_user_connections_requester
  ON public.user_connections (requester_id, status);
CREATE INDEX IF NOT EXISTS idx_user_connections_requested
  ON public.user_connections (requested_id, status);

-- =====================================================
-- SECAO 4: RLS
-- =====================================================
ALTER TABLE public.user_connections ENABLE ROW LEVEL SECURITY;

-- Ver: so os dois envolvidos.
DROP POLICY IF EXISTS user_connections_select ON public.user_connections;
CREATE POLICY user_connections_select ON public.user_connections
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR requested_id = auth.uid());

-- Pedir: so em nome proprio, so como 'pending', e so para quem aceita pedidos.
--
-- O `status = 'pending'` no WITH CHECK e a amarra que mais importa deste
-- arquivo. Sem ele, qualquer usuario logado poderia gravar diretamente
-- (eu, a vitima, 'accepted') e passar a constar como conexao aceita da vitima
-- sem que ela clicasse em nada -- e conexao aceita e o que habilita puxar
-- alguem para o rateio de uma despesa. O consentimento fica do lado de quem
-- recebe, e so por UPDATE (abaixo).
DROP POLICY IF EXISTS user_connections_insert ON public.user_connections;
CREATE POLICY user_connections_insert ON public.user_connections
  FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = auth.uid()
    AND requested_id <> auth.uid()
    AND status = 'pending'
    AND responded_at IS NULL
    -- allow_connections e NULL-avel; o default da coluna e true, entao NULL
    -- aqui significa "nunca escolheu" e nao "recusa".
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = requested_id
         AND COALESCE(p.allow_connections, true)
    )
  );

-- Responder: so quem recebeu, e so saindo de 'pending'.
--
-- O USING prende a transicao: uma conexao ja aceita nao volta para pending e
-- um bloqueio nao vira aceite depois. O WITH CHECK impede que o requested
-- troque os participantes da linha enquanto responde.
DROP POLICY IF EXISTS user_connections_update ON public.user_connections;
CREATE POLICY user_connections_update ON public.user_connections
  FOR UPDATE TO authenticated
  USING (requested_id = auth.uid() AND status = 'pending')
  WITH CHECK (
    requested_id = auth.uid()
    AND status IN ('accepted', 'blocked')
    AND responded_at IS NOT NULL
  );

-- Apagar: depende do estado, e isto nao e detalhe.
--
--   pending   -> so quem pediu, para desistir do proprio pedido.
--   accepted  -> qualquer um dos dois, para desfazer a conexao.
--   blocked   -> SO quem bloqueou.
--
-- A ultima linha e a que sustenta o bloqueio. Com um DELETE simetrico, quem
-- foi recusado apagaria a propria linha de bloqueio e mandaria o pedido de
-- novo -- e de novo, indefinidamente. O bloqueio pareceria existir na tela de
-- quem bloqueou e nao valeria nada.
DROP POLICY IF EXISTS user_connections_delete ON public.user_connections;
CREATE POLICY user_connections_delete ON public.user_connections
  FOR DELETE TO authenticated
  USING (
       (status = 'pending'  AND requester_id = auth.uid())
    OR (status = 'accepted' AND (requester_id = auth.uid() OR requested_id = auth.uid()))
    OR (status = 'blocked'  AND requested_id = auth.uid())
  );

-- =====================================================
-- SECAO 4.1: ver o perfil de quem ja e conexao aceita
-- =====================================================
-- Policy NOVA e ADITIVA: a `profiles_select_own_or_public` do 002 fica
-- exatamente como esta. Policies permissivas se somam (OR), entao isto so
-- ACRESCENTA leitura -- e a leitura que acrescenta e o nome e o avatar de
-- alguem com quem o usuario ja concordou em se conectar.
--
-- Sem ela ha um buraco silencioso: so se encontra alguem na busca com
-- is_public = true, mas essa pessoa pode desligar o perfil publico DEPOIS. A
-- partir daquele momento o embed `profiles!user_connections_..._fkey` devolve
-- nulo, a linha e descartada no map da rota, e a pessoa simplesmente some da
-- lista de quem pode entrar num rateio -- sem erro, sem aviso, e com a conexao
-- continuando a existir na tela de Conexoes.
--
-- Nao ha recursao: a policy de SELECT de user_connections olha so auth.uid(),
-- nunca profiles.
DROP POLICY IF EXISTS profiles_select_connected ON public.profiles;
CREATE POLICY profiles_select_connected ON public.profiles
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_connections uc
     WHERE uc.status = 'accepted'
       AND ( (uc.requester_id = auth.uid() AND uc.requested_id = profiles.id)
          OR (uc.requested_id = auth.uid() AND uc.requester_id = profiles.id) )
  ));

-- =====================================================
-- SECAO 5: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes desta tabela existir, e ALL TABLES
-- e uma fotografia do momento -- nao alcanca objeto criado depois.
REVOKE ALL ON public.user_connections FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_connections TO authenticated;

-- =====================================================
-- SECAO 6: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('010', '010_user_connections',
        'Tabela user_connections, que a tela de Conexoes e seis rotas ja chamavam - HMO-124', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 11. 011_detected_recurrences.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - RECORRENCIAS DETECTADAS
-- =====================================================
-- Migration: 011_detected_recurrences
-- Gerado em: 2026-09-22  (HMO-145)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.detected_recurrences   a assinatura que o app INFERIU do extrato,
--                                 e o que o usuario decidiu sobre ela
--
-- Como o 010, este arquivo so ACRESCENTA: nenhuma funcao, tabela, policy ou
-- trigger de producao e alterada.
--
-- POR QUE ESTA TABELA NAO E A `recurring_rules`
-- ----------------------------------------------
-- A `recurring_rules` (migration 005, ainda na pilha) guarda o gasto fixo que
-- o USUARIO cadastrou: ele digita "aluguel, dia 10, mensal" e o app projeta os
-- vencimentos. Esta tabela e o caminho contrario -- o app le o extrato e
-- descobre a cobranca que o usuario nao cadastrou, que e justamente a que ele
-- esqueceu que assinou. As duas convivem: a primeira e declaracao, a segunda e
-- observacao, e confundi-las faria o detector apagar o que o usuario digitou.
--
-- O QUE O JOB PODE E O QUE ELE NAO PODE SOBRESCREVER
-- ---------------------------------------------------
-- O detector roda de novo a cada importacao. Ele recalcula valor medio, data
-- da ultima cobranca e proxima prevista -- esses campos sao observacao e
-- precisam acompanhar o extrato. Mas `status` e DECISAO DO USUARIO: se ele
-- marcou "ignorar", a proxima importacao nao pode devolver a linha para
-- DETECTED e fazer a assinatura reaparecer na tela que ele acabou de limpar.
--
-- A amarra disso e o UNIQUE (user_id, merchant_key) da SECAO 2 somado ao
-- `ON CONFLICT DO UPDATE` que NAO lista `status` entre as colunas atualizadas.
-- Esta escrito aqui, no schema, e nao so na rota, porque uma segunda rota que
-- esqueca a regra reintroduz o bug sem que nada falhe.
--
-- POR QUE NAO HA TABELA DE ALERTA
-- --------------------------------
-- Os dois alertas do criterio de aceite (preco subiu, cobrou depois de
-- cancelada) sao DERIVADOS: dao para calcular na leitura a partir desta tabela
-- mais as transacoes, e calcular e mais barato que manter sincronizado. O que
-- exigiria persistencia e "ja avisei este usuario sobre este alerta" -- e esse
-- estado pertence a `alerts` da migration 009, que ainda esta na pilha. Quando
-- o 009 entrar, o disparo de notificacao pendura nele; ate la o alerta aparece
-- na tela, que e onde o criterio 3 ja pede que ele apareca.
--
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: pre-requisitos
-- =====================================================
-- Sem isto a tabela nasce e so o USO descobre que financial_transactions nao
-- tem a forma que o detector espera.
DO $$
DECLARE
  faltando text;
BEGIN
  SELECT string_agg(msg, E'\n') INTO faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.financial_transactions') IS NULL
               THEN '  - tabela public.financial_transactions nao existe'
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.financial_transactions')
                      AND a.attname = r.coluna
                      AND a.attnum > 0 AND NOT a.attisdropped)
               THEN format('  - coluna public.financial_transactions.%s nao existe', r.coluna)
           END AS msg
    FROM (VALUES ('id'), ('user_id'), ('description'), ('amount'), ('transaction_date')) AS r(coluna)
  ) t
  WHERE msg IS NOT NULL;

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION E'011 nao pode ser aplicado neste banco:\n%', faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: a tabela
-- =====================================================
CREATE TABLE IF NOT EXISTS public.detected_recurrences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,

    -- Chave normalizada do estabelecimento ("netflix"). E o que AGRUPA, e sai
    -- de normalizeMerchant() em lib/recurrence-detector.ts. Nao e para a tela.
    merchant_key text NOT NULL,
    -- O que a tela mostra ("Netflix"). Vem da descricao original mais recente.
    display_name text NOT NULL,

    -- POSITIVOS. financial_transactions.amount grava despesa NEGATIVA, mas
    -- aqui o numero responde "quanto custa", e a soma da tela e um total de
    -- custo. O CHECK abaixo e o que impede o sinal cru de entrar: sem ele, um
    -- job que esqueca o modulo grava -39,90, o total mensal vira negativo e
    -- nada falha.
    avg_amount numeric(15,2) NOT NULL,
    last_amount numeric(15,2) NOT NULL,
    -- Quanto pesa por mes. Existe como coluna para somar semanal, mensal e
    -- anual na mesma consulta, sem a tela ter que saber converter.
    monthly_cost numeric(15,2) NOT NULL,

    frequency text NOT NULL,
    occurrences integer NOT NULL,

    last_charge_date date NOT NULL,
    next_expected_date date NOT NULL,

    status text NOT NULL DEFAULT 'DETECTED',
    -- Quando o status virou o que e hoje. E a data a partir da qual uma
    -- cobranca nova conta como "cobrou depois de cancelada" (criterio 4) --
    -- sem ela, a propria cobranca que motivou o cancelamento dispararia o
    -- alerta no mesmo instante do clique.
    status_changed_at timestamp with time zone,

    -- As transacoes que sustentam a recorrencia. Array, e nao tabela de
    -- ligacao, porque a lista e sempre lida inteira junto com a linha e nunca
    -- consultada pelo lado da transacao.
    transaction_ids uuid[] NOT NULL DEFAULT '{}',

    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),

    CONSTRAINT detected_recurrences_pkey PRIMARY KEY (id),

    CONSTRAINT detected_recurrences_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,

    CONSTRAINT detected_recurrences_frequency_check
      CHECK (frequency IN ('WEEKLY', 'MONTHLY', 'YEARLY')),

    CONSTRAINT detected_recurrences_status_check
      CHECK (status IN ('DETECTED', 'CONFIRMED', 'IGNORED', 'CANCELLED')),

    -- Ver o comentario das colunas de valor.
    CONSTRAINT detected_recurrences_amounts_positive_check
      CHECK (avg_amount > 0 AND last_amount > 0 AND monthly_cost > 0),

    -- O criterio de aceite 2 pede no minimo 3 ocorrencias. Gravar uma linha
    -- com 2 significa que o detector foi contornado.
    CONSTRAINT detected_recurrences_occurrences_check
      CHECK (occurrences >= 3),

    -- A proxima cobranca prevista e sempre DEPOIS da ultima observada. Uma
    -- linha que viole isso mostra na tela uma "proxima cobranca" no passado.
    CONSTRAINT detected_recurrences_next_after_last_check
      CHECK (next_expected_date > last_charge_date),

    -- Status diferente de DETECTED e resultado de uma acao do usuario, e acao
    -- tem data. Sem esta amarra, uma linha CANCELLED sem carimbo faz o alerta
    -- do criterio 4 nao ter a partir de quando comparar -- e ele
    -- silenciosamente nunca dispara.
    CONSTRAINT detected_recurrences_status_changed_at_check
      CHECK ((status = 'DETECTED') = (status_changed_at IS NULL))
);

COMMENT ON TABLE public.detected_recurrences IS
  'Assinatura/cobranca recorrente inferida do extrato pelo detector, e a decisao do usuario sobre ela. Nao confundir com recurring_rules, que e o gasto fixo que o usuario cadastrou.';
COMMENT ON COLUMN public.detected_recurrences.merchant_key IS
  'Chave normalizada do estabelecimento. Sai de normalizeMerchant() em lib/recurrence-detector.ts -- mudar a normalizacao muda o agrupamento das linhas ja gravadas.';
COMMENT ON COLUMN public.detected_recurrences.status IS
  'DETECTED e do detector; os outros tres sao decisao do usuario. O job NAO sobrescreve este campo -- ver o cabecalho.';
COMMENT ON COLUMN public.detected_recurrences.avg_amount IS
  'Positivo (modulo). A despesa e negativa em financial_transactions; aqui o numero e custo.';

-- =====================================================
-- SECAO 2: uma linha por estabelecimento por usuario
-- =====================================================
-- E o que torna o job idempotente: rodar a mesma importacao duas vezes atualiza
-- a linha em vez de criar a segunda. Sem isto, cada importacao acrescenta uma
-- Netflix a tela e o total mensal cresce sozinho.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_detected_recurrences_user_merchant
  ON public.detected_recurrences (user_id, merchant_key);

COMMENT ON INDEX public.uniq_detected_recurrences_user_merchant IS
  'Alvo do ON CONFLICT do job. E o que faz reimportar o mesmo extrato nao duplicar a assinatura.';

-- =====================================================
-- SECAO 3: indice de leitura
-- =====================================================
-- A tela abre em uma consulta: as recorrencias do usuario que nao foram
-- ignoradas, da mais cara por mes para a mais barata.
CREATE INDEX IF NOT EXISTS idx_detected_recurrences_user_status
  ON public.detected_recurrences (user_id, status, monthly_cost DESC);

-- =====================================================
-- SECAO 4: RLS
-- =====================================================
ALTER TABLE public.detected_recurrences ENABLE ROW LEVEL SECURITY;

-- Ver: so o dono.
DROP POLICY IF EXISTS detected_recurrences_select ON public.detected_recurrences;
CREATE POLICY detected_recurrences_select ON public.detected_recurrences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Gravar: so em nome proprio, e so como DETECTED.
--
-- O `status = 'DETECTED'` no WITH CHECK nao e formalidade. Quem escreve aqui e
-- o detector, e detector nao decide -- ele observa. Sem a amarra, um cliente
-- poderia inserir a linha ja como CONFIRMED e pular a unica etapa em que o
-- usuario olha para a cobranca e diz o que ela e.
DROP POLICY IF EXISTS detected_recurrences_insert ON public.detected_recurrences;
CREATE POLICY detected_recurrences_insert ON public.detected_recurrences
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'DETECTED'
    AND status_changed_at IS NULL
  );

-- Atualizar: so o dono, e sem trocar de dono nem de estabelecimento.
--
-- O merchant_key preso no WITH CHECK fecha um buraco silencioso: trocar a
-- chave de uma linha existente a faz colidir com outra assinatura do mesmo
-- usuario (ou escapar do UNIQUE e virar uma segunda Netflix), e os
-- transaction_ids gravados passam a apontar para cobrancas de outro lojista.
DROP POLICY IF EXISTS detected_recurrences_update ON public.detected_recurrences;
CREATE POLICY detected_recurrences_update ON public.detected_recurrences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Apagar: so o dono. Apagar aqui nao perde nada de verdade -- a proxima
-- passada do detector reencontra a cobranca no extrato. O que se perde e a
-- decisao (o "ignorar"), e por isso a tela oferece IGNORED em vez de DELETE.
DROP POLICY IF EXISTS detected_recurrences_delete ON public.detected_recurrences;
CREATE POLICY detected_recurrences_delete ON public.detected_recurrences
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =====================================================
-- SECAO 5: carimbo do updated_at
-- =====================================================
-- Funcao propria, e nao a `update_updated_at_column()` legada do 001: as
-- migrations 003 e 004 existiram inteiras para consertar trigger que gravava
-- sem privilegio suficiente sob a RLS do 002. Esta nasce ja com
-- SECURITY INVOKER explicito e search_path fixo -- ela so toca a linha que a
-- transacao ja esta gravando, entao nao precisa de privilegio nenhum alem do
-- de quem chamou.
CREATE OR REPLACE FUNCTION public.detected_recurrences_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_detected_recurrences_touch ON public.detected_recurrences;
CREATE TRIGGER trg_detected_recurrences_touch
  BEFORE UPDATE ON public.detected_recurrences
  FOR EACH ROW EXECUTE FUNCTION public.detected_recurrences_touch_updated_at();

-- =====================================================
-- SECAO 6: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes desta tabela existir, e ALL TABLES
-- e uma fotografia do momento -- nao alcanca objeto criado depois.
REVOKE ALL ON public.detected_recurrences FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.detected_recurrences TO authenticated;

-- =====================================================
-- SECAO 7: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('011', '011_detected_recurrences',
        'Tabela detected_recurrences: assinaturas inferidas do extrato - HMO-145', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 12. 012_payroll.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - CONTRACHEQUE: SALARIO BRUTO E DESCONTOS
-- =====================================================
-- Migration: 012_payroll
-- Gerado em: 2026-09-22  (HMO-145)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.payroll_entries       o contracheque do mes: bruto e de quem
--   public.payroll_deductions    INSS, IRRF e os demais descontos em folha
--   public.payroll_entry_totals  view: bruto, total descontado e LIQUIDO
--   public.register_payroll()    grava o contracheque inteiro numa transacao
--
-- Como o 010 e o 011, este arquivo so ACRESCENTA: nenhuma funcao, tabela,
-- policy ou trigger que ja esta em producao e alterada.
--
-- POR QUE O LANCAMENTO E O LIQUIDO, E NAO O BRUTO
-- ------------------------------------------------
-- O caminho obvio seria gravar o bruto como receita e cada desconto como
-- despesa. Ele esta errado de um jeito que nao falha em lugar nenhum: o
-- dinheiro do INSS e do IRRF NUNCA passou pela conta do usuario. Gravando
-- assim, o fluxo de caixa do 008 mostraria uma receita que ele nao recebeu e
-- uma despesa que ele nao pagou, as duas infladas pelo mesmo valor. O saldo
-- final fecharia certo -- o que torna o erro invisivel --, mas "quanto eu
-- ganho" e "quanto eu gasto" ficariam ambos maiores que a verdade, e sao esses
-- dois numeros que a tela de relatorios existe para responder.
--
-- Entao: UMA transacao de receita, com o valor LIQUIDO, que e o que de fato
-- caiu na conta. O bruto e os descontos vivem aqui, e sao a memoria de como se
-- chegou naquele liquido.
--
-- POR QUE ISTO NAO E UMA CATEGORIA DE TRANSACAO
-- ----------------------------------------------
-- Descontos em folha nao sao lancamentos: eles nao tem data propria, nao
-- afetam saldo de conta nenhuma e nao existem fora do contracheque que os
-- gerou. Modelados como transacao, precisariam de conta (nao tem) e entrariam
-- em todo relatorio de gasto (nao sao gasto do usuario).
--
-- O FGTS NAO ESTA NA LISTA DE PROPOSITO
-- --------------------------------------
-- FGTS nao e desconto: o empregador deposita por fora e o bruto nao diminui
-- por causa dele. Inclui-lo entre os `kind` faria o liquido calculado ficar
-- ~8% abaixo do que a pessoa recebeu, todo mes, e o erro seria copiado do
-- proprio contracheque impresso, onde o FGTS aparece na mesma coluna.
--
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: pre-requisitos
-- =====================================================
-- Sem isto as tabelas nascem e so o USO descobre que financial_transactions
-- nao tem a forma que register_payroll() espera.
DO $$
DECLARE
  faltando text;
BEGIN
  SELECT string_agg(msg, E'\n') INTO faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.financial_transactions') IS NULL
               THEN '  - tabela public.financial_transactions nao existe'
             WHEN NOT EXISTS (
                    SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.financial_transactions')
                      AND a.attname = r.coluna
                      AND a.attnum > 0 AND NOT a.attisdropped)
               THEN format('  - coluna public.financial_transactions.%s nao existe', r.coluna)
           END AS msg
    FROM (VALUES
      ('id'), ('user_id'), ('service_id'), ('category_id'), ('account_id'),
      ('description'), ('amount'), ('transaction_date'), ('transaction_type')
    ) AS r(coluna)
  ) t
  WHERE msg IS NOT NULL;

  IF to_regclass('public.financial_accounts') IS NULL THEN
    faltando := concat_ws(E'\n', faltando, '  - tabela public.financial_accounts nao existe');
  END IF;

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION E'012 nao pode ser aplicado neste banco:\n%', faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: o contracheque
-- =====================================================
CREATE TABLE IF NOT EXISTS public.payroll_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,

    -- Sempre o dia 1: o contracheque e do MES, nao de uma data. O CHECK abaixo
    -- e o que impede duas linhas do mesmo mes (dia 1 e dia 5) escaparem do
    -- UNIQUE da SECAO 3 e a renda do mes aparecer dobrada.
    reference_month date NOT NULL,

    -- Quem paga. NOT NULL com default porque ele entra no UNIQUE, e em coluna
    -- anulavel o UNIQUE deixa de valer justamente para quem nao preencheu.
    employer text NOT NULL DEFAULT 'Principal',

    -- POSITIVO. Salario e receita; a convencao de sinal negativo deste banco e
    -- so para despesa em financial_transactions.
    gross_amount numeric(15,2) NOT NULL,

    -- Onde o liquido cai, e o lancamento que ele gerou. O lancamento pode ser
    -- apagado pela tela de transacoes sem levar o contracheque junto: por isso
    -- SET NULL, e por isso a tela sabe mostrar "sem lancamento".
    account_id uuid,
    transaction_id uuid,

    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),

    CONSTRAINT payroll_entries_pkey PRIMARY KEY (id),

    CONSTRAINT payroll_entries_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,

    CONSTRAINT payroll_entries_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id) ON DELETE SET NULL,

    CONSTRAINT payroll_entries_transaction_id_fkey
      FOREIGN KEY (transaction_id) REFERENCES public.financial_transactions(id) ON DELETE SET NULL,

    CONSTRAINT payroll_entries_gross_positive_check
      CHECK (gross_amount > 0),

    -- Ver o comentario de reference_month.
    CONSTRAINT payroll_entries_reference_month_is_first_check
      CHECK (date_trunc('month', reference_month)::date = reference_month),

    CONSTRAINT payroll_entries_employer_not_blank_check
      CHECK (btrim(employer) <> '')
);

COMMENT ON TABLE public.payroll_entries IS
  'Contracheque do mes: o salario BRUTO e de quem. O liquido nao e coluna -- sai da view payroll_entry_totals, para nao existir em dois lugares.';
COMMENT ON COLUMN public.payroll_entries.gross_amount IS
  'Positivo. O sinal negativo deste banco e convencao de despesa em financial_transactions, e salario nao e despesa.';
COMMENT ON COLUMN public.payroll_entries.transaction_id IS
  'O lancamento de receita com o valor LIQUIDO. NULL significa que o contracheque existe mas nao virou dinheiro em conta nenhuma.';

-- =====================================================
-- SECAO 2: os descontos
-- =====================================================
CREATE TABLE IF NOT EXISTS public.payroll_deductions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payroll_entry_id uuid NOT NULL,

    -- Lista fechada. INSS e IRRF sao nomeados porque sao os dois que todo
    -- contracheque brasileiro tem e os dois que o usuario pediu por nome; o
    -- resto cai em OTHER com descricao livre.
    --
    -- FGTS nao esta aqui de proposito -- ver o cabecalho.
    kind text NOT NULL,

    description text,

    -- POSITIVO. O desconto e uma subtracao feita pela view; gravar o valor ja
    -- negativo faria a subtracao virar soma e o liquido ficar MAIOR que o
    -- bruto, sem nada falhar.
    amount numeric(15,2) NOT NULL,

    created_at timestamp with time zone DEFAULT now(),

    CONSTRAINT payroll_deductions_pkey PRIMARY KEY (id),

    CONSTRAINT payroll_deductions_entry_fkey
      FOREIGN KEY (payroll_entry_id) REFERENCES public.payroll_entries(id) ON DELETE CASCADE,

    CONSTRAINT payroll_deductions_kind_check
      CHECK (kind IN ('INSS', 'IRRF', 'PENSION', 'HEALTH', 'UNION', 'ADVANCE', 'OTHER')),

    CONSTRAINT payroll_deductions_amount_positive_check
      CHECK (amount > 0)
);

COMMENT ON TABLE public.payroll_deductions IS
  'Descontos em folha de um contracheque. Nao sao transacoes: nao tem data propria, nao mexem em saldo e nao existem fora do contracheque.';
COMMENT ON COLUMN public.payroll_deductions.amount IS
  'Positivo. A view subtrai; valor negativo aqui faria o liquido passar do bruto.';

CREATE INDEX IF NOT EXISTS idx_payroll_deductions_entry
  ON public.payroll_deductions (payroll_entry_id);

-- =====================================================
-- SECAO 3: um contracheque por empregador por mes
-- =====================================================
-- Lancar o mesmo contracheque duas vezes dobraria a renda do mes. Quem tem
-- dois empregos continua podendo lancar dois, porque o empregador entra na
-- chave.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payroll_entries_user_month_employer
  ON public.payroll_entries (user_id, reference_month, employer);

-- =====================================================
-- SECAO 4: o desconto nao pode passar do bruto
-- =====================================================
-- Isto e um CHECK entre tabelas, que o Postgres nao tem -- por isso trigger.
--
-- Ele nao calcula dinheiro nenhum: so recusa. Um IRRF digitado como 5000 em
-- vez de 500 produziria liquido NEGATIVO, e o liquido negativo seria gravado
-- como transacao de receita com valor negativo -- que as views do 008 leem
-- como DESPESA, por causa da convencao de sinal. O mes apareceria com renda
-- zero e uma despesa que ninguem fez, e nada teria falhado.
CREATE OR REPLACE FUNCTION public.payroll_deductions_within_gross()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry uuid := COALESCE(NEW.payroll_entry_id, OLD.payroll_entry_id);
  v_gross numeric(15,2);
  v_total numeric(15,2);
BEGIN
  SELECT gross_amount INTO v_gross
  FROM public.payroll_entries WHERE id = v_entry;

  -- A entrada sumiu no mesmo comando (DELETE em cascata): nao ha o que checar.
  IF v_gross IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_total
  FROM public.payroll_deductions WHERE payroll_entry_id = v_entry;

  IF v_total > v_gross THEN
    RAISE EXCEPTION
      'Os descontos (%) passam do salario bruto (%) neste contracheque',
      v_total, v_gross
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

COMMENT ON FUNCTION public.payroll_deductions_within_gross() IS
  'Recusa desconto que faria o liquido ficar negativo. SECURITY INVOKER de proposito: ele so le linhas que o proprio usuario acabou de gravar.';

DROP TRIGGER IF EXISTS trg_payroll_deductions_within_gross ON public.payroll_deductions;
CREATE TRIGGER trg_payroll_deductions_within_gross
  AFTER INSERT OR UPDATE ON public.payroll_deductions
  FOR EACH ROW EXECUTE FUNCTION public.payroll_deductions_within_gross();

-- IMEDIATO, e nao CONSTRAINT TRIGGER DEFERRED. A tentacao e adiar para o
-- commit "porque os descontos entram um a um e a soma parcial nao vale". Mas
-- soma parcial de parcelas POSITIVAS nunca passa da soma final: se a parcial
-- ja estourou o bruto, a final tambem estoura. Adiar so tiraria o erro do
-- comando que o causou -- e, pior, um trigger adiado nao dispara dentro do
-- bloco EXCEPTION do plpgsql, entao o UPDATE que infla um desconto ja gravado
-- pareceria ter passado.
--
-- Nao dispara em DELETE de proposito: apagar desconto so diminui o total.

-- =====================================================
-- SECAO 5: a view do liquido
-- =====================================================
-- O liquido NAO e coluna. Como coluna, ele seria uma terceira copia de um
-- numero que ja esta em dois lugares (bruto e descontos) e passaria a divergir
-- no primeiro desconto editado sem recalculo.
DROP VIEW IF EXISTS public.payroll_entry_totals;
CREATE VIEW public.payroll_entry_totals
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.user_id,
  e.reference_month,
  e.employer,
  e.gross_amount,
  e.account_id,
  e.transaction_id,
  e.notes,
  COALESCE(d.total_deductions, 0)::numeric(15,2) AS total_deductions,
  (e.gross_amount - COALESCE(d.total_deductions, 0))::numeric(15,2) AS net_amount,
  COALESCE(d.inss, 0)::numeric(15,2) AS inss_amount,
  COALESCE(d.irrf, 0)::numeric(15,2) AS irrf_amount,
  e.created_at,
  e.updated_at
FROM public.payroll_entries e
LEFT JOIN (
  SELECT
    payroll_entry_id,
    sum(amount) AS total_deductions,
    sum(amount) FILTER (WHERE kind = 'INSS') AS inss,
    sum(amount) FILTER (WHERE kind = 'IRRF') AS irrf
  FROM public.payroll_deductions
  GROUP BY payroll_entry_id
) d ON d.payroll_entry_id = e.id;

-- security_invoker: sem ele a view roda com o privilegio do DONO e devolve o
-- contracheque de TODO MUNDO para qualquer usuario logado -- a RLS da tabela
-- base nao alcanca view comum. Mesmo motivo das views do 006 e do 008.
COMMENT ON VIEW public.payroll_entry_totals IS
  'Contracheque com total descontado e LIQUIDO calculados. security_invoker: a RLS de payroll_entries e quem filtra.';

-- =====================================================
-- SECAO 6: RLS
-- =====================================================
ALTER TABLE public.payroll_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_entries_select ON public.payroll_entries;
CREATE POLICY payroll_entries_select ON public.payroll_entries
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS payroll_entries_insert ON public.payroll_entries;
CREATE POLICY payroll_entries_insert ON public.payroll_entries
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS payroll_entries_update ON public.payroll_entries;
CREATE POLICY payroll_entries_update ON public.payroll_entries
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS payroll_entries_delete ON public.payroll_entries;
CREATE POLICY payroll_entries_delete ON public.payroll_entries
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

ALTER TABLE public.payroll_deductions ENABLE ROW LEVEL SECURITY;

-- O desconto nao tem user_id proprio: quem manda e o dono do contracheque. O
-- EXISTS abaixo e o que impede alguem pendurar um desconto no contracheque de
-- outro -- e desconto alheio mudaria o liquido alheio.
DROP POLICY IF EXISTS payroll_deductions_select ON public.payroll_deductions;
CREATE POLICY payroll_deductions_select ON public.payroll_deductions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payroll_entries e
    WHERE e.id = payroll_deductions.payroll_entry_id AND e.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS payroll_deductions_insert ON public.payroll_deductions;
CREATE POLICY payroll_deductions_insert ON public.payroll_deductions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.payroll_entries e
    WHERE e.id = payroll_deductions.payroll_entry_id AND e.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS payroll_deductions_update ON public.payroll_deductions;
CREATE POLICY payroll_deductions_update ON public.payroll_deductions
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payroll_entries e
    WHERE e.id = payroll_deductions.payroll_entry_id AND e.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.payroll_entries e
    WHERE e.id = payroll_deductions.payroll_entry_id AND e.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS payroll_deductions_delete ON public.payroll_deductions;
CREATE POLICY payroll_deductions_delete ON public.payroll_deductions
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payroll_entries e
    WHERE e.id = payroll_deductions.payroll_entry_id AND e.user_id = auth.uid()
  ));

-- =====================================================
-- SECAO 6b: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes destas tabelas existirem, e ALL
-- TABLES nao alcanca o futuro. Sem isto a RLS esta certa e o usuario leva
-- "permission denied" -- que nao se parece nada com um problema de policy.
REVOKE ALL ON public.payroll_entries FROM anon;
REVOKE ALL ON public.payroll_deductions FROM anon;
REVOKE ALL ON public.payroll_entry_totals FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_deductions TO authenticated;
GRANT SELECT ON public.payroll_entry_totals TO authenticated;

-- =====================================================
-- SECAO 7: gravar o contracheque inteiro de uma vez
-- =====================================================
-- Contracheque, descontos e lancamento sao tres escritas que so fazem sentido
-- juntas. Feitas em tres chamadas HTTP, uma falha no meio deixa o estado
-- errado de um jeito que ninguem ve: contracheque sem desconto tem liquido =
-- bruto, e a renda do mes aparece maior do que foi.
--
-- SECURITY INVOKER (o padrao): a funcao escreve em nome do usuario e a RLS das
-- SECOES 6 continua valendo dentro dela. SECURITY DEFINER aqui recriaria o
-- problema que o 003 e o 004 passaram duas migrations consertando.
CREATE OR REPLACE FUNCTION public.register_payroll(
  p_reference_month date,
  p_employer text,
  p_gross_amount numeric,
  p_account_id uuid,
  p_category_id uuid,
  p_service_id uuid,
  p_deductions jsonb DEFAULT '[]'::jsonb,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id uuid;
  v_total numeric(15,2);
  v_net numeric(15,2);
  v_transaction_id uuid;
BEGIN
  INSERT INTO public.payroll_entries (
    user_id, reference_month, employer, gross_amount, account_id, notes
  ) VALUES (
    auth.uid(),
    date_trunc('month', p_reference_month)::date,
    COALESCE(NULLIF(btrim(p_employer), ''), 'Principal'),
    p_gross_amount,
    p_account_id,
    p_notes
  )
  RETURNING id INTO v_entry_id;

  INSERT INTO public.payroll_deductions (payroll_entry_id, kind, description, amount)
  SELECT
    v_entry_id,
    d->>'kind',
    NULLIF(btrim(COALESCE(d->>'description', '')), ''),
    (d->>'amount')::numeric
  FROM jsonb_array_elements(COALESCE(p_deductions, '[]'::jsonb)) AS d;

  SELECT COALESCE(sum(amount), 0) INTO v_total
  FROM public.payroll_deductions WHERE payroll_entry_id = v_entry_id;

  v_net := p_gross_amount - v_total;

  -- O trigger da SECAO 4 ja barrou desconto MAIOR que o bruto. Falta o caso do
  -- igual: desconto exatamente igual ao bruto passa pelo trigger e deixaria
  -- liquido zero, que viraria uma transacao de receita de R$ 0,00 -- uma linha
  -- no extrato que nao e dinheiro nenhum.
  IF v_net <= 0 THEN
    RAISE EXCEPTION
      'Os descontos (%) deixam o liquido em % -- confira os valores',
      v_total, v_net
      USING ERRCODE = 'check_violation';
  END IF;

  -- POSITIVO e transaction_type = 'income': e o liquido que caiu na conta.
  -- Ver o cabecalho para por que nao e o bruto.
  IF p_account_id IS NOT NULL AND p_category_id IS NOT NULL AND p_service_id IS NOT NULL THEN
    INSERT INTO public.financial_transactions (
      user_id, service_id, category_id, account_id,
      description, amount, transaction_date, transaction_type, notes
    ) VALUES (
      auth.uid(), p_service_id, p_category_id, p_account_id,
      format('Salário %s', to_char(date_trunc('month', p_reference_month), 'MM/YYYY')),
      v_net,
      date_trunc('month', p_reference_month)::date,
      'income',
      p_notes
    )
    RETURNING id INTO v_transaction_id;

    UPDATE public.payroll_entries
      SET transaction_id = v_transaction_id, updated_at = now()
      WHERE id = v_entry_id;
  END IF;

  RETURN v_entry_id;
END $$;

COMMENT ON FUNCTION public.register_payroll IS
  'Grava contracheque + descontos + o lancamento do LIQUIDO numa transacao so. SECURITY INVOKER: a RLS continua valendo dentro dela.';

COMMIT;


-- ---------------------------------------------------------------------------
-- 13. 013_fix_user_subscription_details_leak.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - FECHA O VAZAMENTO DA user_subscription_details
-- =====================================================
-- Migration: 013_fix_user_subscription_details_leak
-- Gerado em: 2026-09-23  (HMO-145)
--
-- O QUE ESTE ARQUIVO CORRIGE
-- --------------------------
-- `public.user_subscription_details` e a unica view do schema que ficou sem
-- `security_invoker`. Ela nasceu no 001_baseline, antes de a 002 ligar RLS, e
-- nenhuma migration posterior passou por ela: a 006, a 008 e a 012 ligaram
-- security_invoker nas views que ELAS criaram, e esta sobrou.
--
-- O EFEITO, MEDIDO
-- ----------------
-- Sem `security_invoker`, a leitura das tabelas de baixo e checada com o
-- privilegio do DONO da view (`postgres`), nao de quem consulta. `profiles`,
-- `user_subscriptions` e `user_usage_limits` tambem pertencem ao `postgres` e
-- estao com `relforcerowsecurity = false` -- e RLS nao se aplica ao dono da
-- tabela quando FORCE esta desligado. Resultado: a RLS simplesmente nao roda.
--
-- Reproduzido num Postgres 17 com a cadeia 001->012 aplicada, com dois
-- usuarios e `is_public = false` nos dois (nenhum publico, nenhuma conexao
-- aceita entre eles), consultando como `authenticated` com o JWT do primeiro:
--
--     SELECT count(*) FROM public.profiles                   -> 1   (RLS vale)
--     SELECT count(*) FROM public.user_subscription_details  -> 2   (RLS nao vale)
--
-- A view devolve `full_name`, `email`, plano, status da assinatura e os
-- contadores de uso de TODOS os usuarios. `authenticated` tem GRANT SELECT
-- nela, e o PostgREST expoe todo objeto do schema `public` em que o papel tem
-- grant -- em producao a view responde 401 para `anon` (que nao tem grant) e
-- 404 para relacao inexistente, ou seja: ela existe e esta publicada. Qualquer
-- usuario logado alcanca `/rest/v1/user_subscription_details` com a chave anon
-- publica mais o proprio JWT.
--
-- Nenhuma tela usa esta view -- nao ha uma citacao dela em `app/`,
-- `components/`, `lib/`, `utils/` ou `worker/`. Isso e o que torna a correcao
-- barata, e tambem e por que ninguem percebeu: o vazamento nao depende de o
-- app chamar a view, so de ela estar publicada.
--
-- POR QUE `security_invoker` E NAO `REVOKE`
-- -----------------------------------------
-- Revogar de `authenticated` fecharia o vazamento e deixaria a view morta --
-- ela passaria a nao servir para nada, e a proxima pessoa que precisasse do
-- dado daria o GRANT de volta sem saber por que ele tinha sumido. Com
-- `security_invoker` a view passa a valer o que ela sempre deveria ter valido:
-- cada um enxerga por ela exatamente as linhas que enxergaria consultando as
-- tabelas direto. O comportamento fica igual ao das outras 11 views.
--
-- IDEMPOTENTE
-- -----------
-- `ALTER VIEW ... SET` pode rodar quantas vezes for. A SECAO 2 aborta a
-- transacao se, no fim, a opcao nao estiver valendo -- ou seja, este arquivo
-- nao consegue terminar com sucesso deixando o vazamento aberto.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: pre-requisitos
-- =====================================================
DO $$
BEGIN
  IF to_regclass('public.user_subscription_details') IS NULL THEN
    RAISE EXCEPTION
      'Faltando: a view public.user_subscription_details nao existe. Rode o 001_baseline antes deste arquivo.';
  END IF;
END $$;

-- =====================================================
-- SECAO 1: a correcao
-- =====================================================
ALTER VIEW public.user_subscription_details SET (security_invoker = true);

COMMENT ON VIEW public.user_subscription_details IS
  'Assinatura, limites de uso e dados do perfil do usuario. security_invoker: a RLS de profiles, user_subscriptions e user_usage_limits e quem filtra as linhas -- sem ele a view roda com o privilegio do dono e devolve todos os usuarios.';

-- =====================================================
-- SECAO 2: prova
-- =====================================================
-- A migration nao termina se a opcao nao estiver valendo no fim. Sem isto,
-- este arquivo poderia "rodar com sucesso" sem ter mudado nada -- que e a
-- forma como um conserto de privilegio costuma falhar em silencio.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN LATERAL unnest(coalesce(c.reloptions, '{}')) AS o(opt)
     WHERE n.nspname = 'public'
       AND c.relname = 'user_subscription_details'
       AND o.opt ILIKE 'security_invoker=%true%'
  ) THEN
    RAISE EXCEPTION
      'security_invoker nao ficou ativo em public.user_subscription_details -- a view continuaria devolvendo todos os usuarios.';
  END IF;
END $$;

-- =====================================================
-- SECAO 3: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('013', '013_fix_user_subscription_details_leak',
        'security_invoker na user_subscription_details: a view expunha nome, email e plano de todos os usuarios a qualquer usuario logado - HMO-145', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 14. 014_categorization_rules.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - REGRAS DE CATEGORIZACAO
-- =====================================================
-- Migration: 014_categorization_rules
-- Gerado em: 2026-09-23  (HMO-145)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.categorization_rules   "toda vez que aparecer ESTE estabelecimento,
--                                  a categoria e ESTA"
--
-- Como o 010 e o 011, este arquivo so ACRESCENTA: nenhuma funcao, tabela,
-- policy ou trigger de producao e alterada.
--
-- O PROBLEMA QUE ELA RESOLVE
-- ---------------------------
-- `financial_transactions.category_id` e NOT NULL, e a rota de importacao do
-- extrato (app/api/statements/entries/[id]/route.ts) recusa a linha sem
-- categoria com um 400. Ou seja: hoje o usuario escolhe a categoria A MAO,
-- uma linha de cada vez, para cada linha de cada extrato. Um OFX de mes cheio
-- sao dezenas de cliques, e o ifood do dia 3 recebe a mesma escolha que o
-- ifood do dia 17.
--
-- Esta tabela guarda essa escolha UMA vez por estabelecimento.
--
-- POR QUE A CHAVE E `merchant_key` E NAO O TEXTO DO EXTRATO
-- ----------------------------------------------------------
-- Casar pelo texto cru nao funciona: o mesmo lojista chega como "IFD*IFOOD
-- 3947", "IFOOD .COM AG" e "PAG*IFOOD". Uma regra por variacao nunca termina
-- -- o adquirente inventa uma nova no mes seguinte.
--
-- A chave aqui e a saida de `normalizeMerchant()` de lib/recurrence-detector.ts,
-- a MESMA funcao que o detector de assinaturas usa para agrupar. E o principal
-- motivo desta feature ter vindo depois do detector: a normalizacao ja existe,
-- ja tem 31 testes com descricao real de extrato, e reaproveita-la significa
-- que "netflix" quer dizer a mesma coisa nas duas telas.
--
-- CONSEQUENCIA QUE PRECISA ESTAR ESCRITA: mudar a normalizacao muda o
-- casamento das regras JA gravadas. Uma regra gravada como "ifood" para de
-- pegar no dia em que a funcao passar a devolver "ifood com". E o mesmo
-- acoplamento que o `merchant_key` da detected_recurrences tem, e vale o mesmo
-- aviso -- por isso os dois saem da mesma funcao e nao de duas copias.
--
-- POR QUE `learned` E `manual` SAO A MESMA TABELA
-- ------------------------------------------------
-- A regra nasce de dois jeitos: o usuario cadastra na tela ('manual'), ou ele
-- importa uma linha escolhendo a categoria e o app grava o que ele fez
-- ('learned'). Sao a mesma coisa no momento de aplicar -- a diferenca so serve
-- para a tela poder dizer "isto aqui eu aprendi sozinho, confere?" e para o
-- aprendizado nunca sobrescrever o que a pessoa digitou (SECAO 2).
--
-- POR QUE NAO HA COLUNA DE CONFIANCA
-- -----------------------------------
-- Uma regra ou casa ou nao casa: a chave normalizada e igual, ou e diferente.
-- Um numero de confianca aqui seria inventado -- e pior, daria a impressao de
-- que existe um limiar ajustavel que na verdade nao existe. O que existe de
-- incerto (o palpite do catalogo embutido, quando NAO ha regra) mora no
-- codigo, em lib/categorization.ts, e nunca e gravado sem o usuario confirmar.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: pre-requisitos
-- =====================================================
-- Sem isto a tabela nasce e so o USO descobre que falta a categoria para
-- apontar. O FK abaixo ja falharia, mas com a mensagem do Postgres sobre
-- relacao inexistente, que nao diz qual migration ficou faltando.
DO $$
DECLARE
  faltando text;
BEGIN
  SELECT string_agg(msg, E'\n') INTO faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.transaction_categories') IS NULL
               THEN '  - tabela public.transaction_categories nao existe (rode o 001_baseline)'
           END AS msg
    UNION ALL
    SELECT CASE
             WHEN to_regclass('public.financial_transactions') IS NULL
               THEN '  - tabela public.financial_transactions nao existe (rode o 001_baseline)'
           END
  ) t
  WHERE msg IS NOT NULL;

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION E'014 nao pode ser aplicado neste banco:\n%', faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: a tabela
-- =====================================================
CREATE TABLE IF NOT EXISTS public.categorization_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,

    -- Chave normalizada do estabelecimento ("ifood"). E o que CASA, e sai de
    -- normalizeMerchant() em lib/recurrence-detector.ts. Nao e para a tela.
    merchant_key text NOT NULL,
    -- O que a tela mostra ("iFood"). Vem da descricao original que originou a
    -- regra -- a pessoa reconhece "IFD*IFOOD 3947", nao "ifood".
    display_name text NOT NULL,

    category_id uuid NOT NULL,

    -- 'manual'  = o usuario cadastrou na tela de regras
    -- 'learned' = o app gravou o que ele escolheu ao importar uma linha
    source text NOT NULL DEFAULT 'manual',

    -- Desligar em vez de apagar. Apagar perde a informacao de que a pessoa ja
    -- decidiu sobre este estabelecimento, e o aprendizado (SECAO 2) recriaria
    -- a regra na proxima importacao -- exatamente a regra que ela removeu.
    is_active boolean NOT NULL DEFAULT true,

    -- Quantas linhas esta regra ja categorizou. E o que a tela usa para
    -- ordenar por utilidade e para o usuario ver que a regra esta trabalhando.
    times_applied integer NOT NULL DEFAULT 0,
    last_applied_at timestamp with time zone,

    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),

    CONSTRAINT categorization_rules_pkey PRIMARY KEY (id),

    CONSTRAINT categorization_rules_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,

    -- RESTRICT, e nao CASCADE: apagar uma categoria que tem regra apontando
    -- para ela nao pode levar a regra junto em silencio. A categoria some, as
    -- importacoes seguintes voltam a pedir escolha manual, e ninguem entende
    -- por que. Com RESTRICT o DELETE falha e a pessoa decide.
    CONSTRAINT categorization_rules_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.transaction_categories(id)
      ON DELETE RESTRICT,

    CONSTRAINT categorization_rules_source_check
      CHECK (source IN ('manual', 'learned')),

    -- Chave vazia casaria com toda descricao que normaliza para nada -- e
    -- normalizeMerchant() devolve "" para uma linha so de digitos, que existe
    -- em extrato. Uma regra assim categorizaria lixo com a cara de acerto.
    CONSTRAINT categorization_rules_merchant_key_check
      CHECK (length(trim(merchant_key)) > 0),

    CONSTRAINT categorization_rules_display_name_check
      CHECK (length(trim(display_name)) > 0),

    CONSTRAINT categorization_rules_times_applied_check
      CHECK (times_applied >= 0),

    -- Contador e carimbo andam juntos: `times_applied > 0` sem data deixa a
    -- tela sem ter o que mostrar em "ultima vez", e data sem contador e uma
    -- aplicacao que ninguem contou.
    CONSTRAINT categorization_rules_applied_check
      CHECK ((times_applied = 0) = (last_applied_at IS NULL))
);

COMMENT ON TABLE public.categorization_rules IS
  'Regra "este estabelecimento vai nesta categoria", aplicada na importacao do extrato. Casa por merchant_key normalizada, nao pelo texto cru do banco.';
COMMENT ON COLUMN public.categorization_rules.merchant_key IS
  'Chave normalizada. Sai de normalizeMerchant() em lib/recurrence-detector.ts, a mesma do detector de assinaturas -- mudar a normalizacao muda o casamento das regras ja gravadas.';
COMMENT ON COLUMN public.categorization_rules.source IS
  'manual = cadastrada na tela; learned = o app gravou a escolha feita numa importacao. O aprendizado nunca sobrescreve uma regra manual.';
COMMENT ON COLUMN public.categorization_rules.is_active IS
  'Regra desligada nao casa, mas continua existindo -- e o que impede o aprendizado de recriar na proxima importacao a regra que o usuario acabou de remover.';

-- =====================================================
-- SECAO 2: uma regra por estabelecimento por usuario
-- =====================================================
-- E o que torna o aprendizado idempotente e o que da sentido ao `ON CONFLICT`
-- da rota de importacao: importar dez linhas do iFood grava UMA regra, nao dez.
--
-- E e tambem a amarra que protege a escolha manual. O aprendizado grava com
-- `ON CONFLICT (user_id, merchant_key) DO UPDATE ... WHERE source = 'learned'`:
-- se ja existe regra 'manual' para o estabelecimento, o UPDATE nao acontece e a
-- categoria que a pessoa escolheu na tela sobrevive a importacao. Sem o indice
-- nao ha `ON CONFLICT` possivel e essa protecao nao tem onde se apoiar.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_categorization_rules_user_merchant
  ON public.categorization_rules (user_id, merchant_key);

COMMENT ON INDEX public.uniq_categorization_rules_user_merchant IS
  'Alvo do ON CONFLICT do aprendizado. Importar dez linhas do mesmo lojista grava uma regra, nao dez.';

-- =====================================================
-- SECAO 3: indice de leitura
-- =====================================================
-- A tela de regras abre em uma consulta: as regras do usuario, da mais usada
-- para a menos usada.
CREATE INDEX IF NOT EXISTS idx_categorization_rules_user_usage
  ON public.categorization_rules (user_id, times_applied DESC);

-- =====================================================
-- SECAO 4: RLS
-- =====================================================
ALTER TABLE public.categorization_rules ENABLE ROW LEVEL SECURITY;

-- Ver: so o dono.
DROP POLICY IF EXISTS categorization_rules_select ON public.categorization_rules;
CREATE POLICY categorization_rules_select ON public.categorization_rules
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Gravar: so em nome proprio.
DROP POLICY IF EXISTS categorization_rules_insert ON public.categorization_rules;
CREATE POLICY categorization_rules_insert ON public.categorization_rules
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Atualizar: so o dono, e sem trocar de dono nem de estabelecimento.
--
-- O `merchant_key` preso pela trigger da SECAO 5 (e nao aqui) porque a policy
-- so enxerga a linha NOVA -- `WITH CHECK` nao tem como comparar com o valor
-- anterior. A RLS garante o dono; a trigger garante a chave.
DROP POLICY IF EXISTS categorization_rules_update ON public.categorization_rules;
CREATE POLICY categorization_rules_update ON public.categorization_rules
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Apagar: so o dono. A tela oferece desligar (is_active) em vez de apagar,
-- pelo motivo do comentario da coluna, mas apagar de fato continua sendo
-- direito do dono.
DROP POLICY IF EXISTS categorization_rules_delete ON public.categorization_rules;
CREATE POLICY categorization_rules_delete ON public.categorization_rules
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =====================================================
-- SECAO 5: carimbo do updated_at + chave imutavel
-- =====================================================
-- Funcao propria, e nao a `update_updated_at_column()` legada do 001, pelo
-- mesmo motivo do 011: as migrations 003 e 004 existiram inteiras para
-- consertar trigger que gravava sem privilegio suficiente sob a RLS do 002.
-- Esta nasce com SECURITY INVOKER explicito e search_path fixo.
--
-- Ela tambem congela `merchant_key` e `user_id`. Trocar a chave de uma regra
-- existente a faz casar com OUTRO estabelecimento mantendo o display_name
-- antigo: a tela continuaria escrito "iFood" e a regra passaria a categorizar
-- Uber. Nada falharia -- os lancamentos so nasceriam na categoria errada.
CREATE OR REPLACE FUNCTION public.categorization_rules_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.merchant_key IS DISTINCT FROM OLD.merchant_key THEN
    RAISE EXCEPTION 'merchant_key de uma regra nao muda: apague a regra e crie outra (era %, veio %)',
      OLD.merchant_key, NEW.merchant_key;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'regra de categorizacao nao troca de dono';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_categorization_rules_guard ON public.categorization_rules;
CREATE TRIGGER trg_categorization_rules_guard
  BEFORE UPDATE ON public.categorization_rules
  FOR EACH ROW EXECUTE FUNCTION public.categorization_rules_guard();

-- =====================================================
-- SECAO 6: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes desta tabela existir, e ALL TABLES
-- e uma fotografia do momento -- nao alcanca objeto criado depois.
REVOKE ALL ON public.categorization_rules FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categorization_rules TO authenticated;

-- =====================================================
-- SECAO 7: prova
-- =====================================================
-- O arquivo aborta se nao tiver pegado. Sem isto, rodar a migration num banco
-- onde algo falhou em silencio sai verde e o problema aparece semanas depois,
-- como leitura de regra de outro usuario.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF to_regclass('public.categorization_rules') IS NULL THEN
    RAISE EXCEPTION '014 nao criou public.categorization_rules';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = to_regclass('public.categorization_rules') AND relrowsecurity
  ) THEN
    problemas := problemas || E'\n  - RLS nao ficou habilitada';
  END IF;

  -- Quatro policies: select, insert, update, delete.
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'categorization_rules') <> 4 THEN
    problemas := problemas || E'\n  - esperava 4 policies em categorization_rules';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'uniq_categorization_rules_user_merchant'
  ) THEN
    problemas := problemas || E'\n  - falta o UNIQUE (user_id, merchant_key): o aprendizado duplicaria regra';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = to_regclass('public.categorization_rules')
      AND tgname = 'trg_categorization_rules_guard'
      AND NOT tgisinternal
  ) THEN
    problemas := problemas || E'\n  - falta a trigger que congela merchant_key';
  END IF;

  -- `has_table_privilege` de anon: a leitura precisa estar fechada.
  IF has_table_privilege('anon', 'public.categorization_rules', 'SELECT') THEN
    problemas := problemas || E'\n  - anon ainda le categorization_rules';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION E'014 aplicou parcialmente:%', problemas;
  END IF;

  RAISE NOTICE '014 conferido: tabela, RLS, 4 policies, UNIQUE, trigger e anon fechado.';
END $$;

-- =====================================================
-- SECAO 8: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('014', '014_categorization_rules',
        'Tabela categorization_rules: categoria automatica por estabelecimento na importacao - HMO-145', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 15. 015_card_invoice_payment.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - PAGAMENTO DE FATURA: ELO ENTRE AS PERNAS E REPARO DO DADO TORTO
-- =====================================================
-- Migration: 015_card_invoice_payment
-- Gerado em: 2026-09-24  (HMO-149)
--
-- O BUG
-- -----
-- Pagar a fatura do cartao contava a mesma despesa DUAS vezes.
--
-- `app/api/card-invoices/close` cria a conta a pagar da fatura com
-- `account_id` do proprio cartao, e `app/api/scheduled-transactions/[id]/pay`
-- dava baixa inserindo UMA transacao negativa nesse mesmo `account_id`. O
-- trigger `update_account_balance` soma `NEW.amount` na conta indicada, entao:
--
--   momento                  | conta corrente |  cartao  | patrimonio
--   -------------------------+----------------+----------+-----------
--   depois da compra de 1000 |        5000.00 | -1000.00 |    4000.00
--   depois de pagar a fatura |        5000.00 | -2000.00 |    3000.00
--
-- O cartao ficava MAIS negativo pelo valor da fatura e a conta de onde o
-- dinheiro realmente saiu nao se mexia. O patrimonio certo e 4000 nos dois
-- momentos: a despesa aconteceu na compra, nao no pagamento.
--
-- Nada quebrava. Nao havia excecao, 500 nem tela vazia -- havia um patrimonio
-- 25% menor, plausivel, com duas casas decimais.
--
-- O CONSERTO, QUE E METADE CODIGO E METADE ESTE ARQUIVO
-- -----------------------------------------------------
-- No codigo (lib/card-invoice.ts): a baixa da fatura passa a gravar DUAS
-- pernas com `transaction_type = 'transfer'` -- `-total` na conta pagadora e
-- `+total` na conta do cartao. 'transfer' e o que faz as views fecharem: o
-- fluxo de caixa do 008 filtra `('expense','income')` e ignora as duas pernas
-- (a despesa continua contada uma vez, na compra); `net_worth_history` soma
-- qualquer tipo, espelhando o trigger de saldo, e la as duas se anulam; e
-- `card_invoice_lines` tambem filtra ('expense','income'), entao a perna de
-- entrada nao aparece como credito abatendo a fatura do mes SEGUINTE.
--
-- (A nota da SECAO 4 do 006 diz que o pagamento da fatura "entra como income
-- na conta do cartao". Era a intencao antiga e estava errada por dois motivos:
-- income infla a receita do mes, e a linha abateria a fatura seguinte. Estorno
-- de compra continua sendo income; pagamento e transferencia.)
--
-- Aqui, duas coisas que o TypeScript nao alcanca:
--
--   1. `counterpart_transaction_id`: o elo entre as duas pernas, para que o
--      ESTORNO da baixa apague as duas sem adivinhar por valor e data.
--   2. o reparo do dado que ja entrou torto em producao.
--
-- POR QUE O REPARO DEVOLVE A CONTA PARA 'pending' EM VEZ DE CORRIGIR
-- ------------------------------------------------------------------
-- Para corrigir seria preciso saber DE QUAL CONTA o dinheiro saiu, e essa
-- informacao nunca foi gravada -- a baixa antiga so registrava o cartao.
-- Escolher uma conta ("a primeira conta corrente") lancaria dinheiro saindo de
-- uma conta que o usuario nao escolheu: trocaria um erro visivel no patrimonio
-- por um saldo errado em duas contas, que e pior porque ninguem procura.
--
-- Entao o reparo desfaz: apaga a transacao errada (o trigger devolve o saldo
-- do cartao no mesmo movimento) e devolve a conta prevista para 'pending'. A
-- fatura volta para a agenda e o usuario da baixa de novo, agora escolhendo a
-- conta pagadora. O `paid_date` original de cada uma sai no RAISE NOTICE --
-- guarde a saida antes de fechar o SQL Editor.
--
-- O reparo e uma FUNCAO, nao um bloco solto, por dois motivos: o teste
-- (database/tests/card_invoice_payment_test.sql) precisa criar uma baixa torta
-- e chamar o reparo para provar que ele repara, e quem rodar a migration duas
-- vezes tem que poder confiar que a segunda nao faz nada. A funcao fica no
-- schema depois, sem EXECUTE para anon nem para authenticated.
--
-- ORDEM DAS OPERACOES NO REPARO (nao e arbitraria)
-- ------------------------------------------------
-- Solta a conta prevista ANTES de apagar a transacao. A constraint
-- `scheduled_transactions_paid_check` do 005 exige que `paid_date` e
-- `transaction_id` saiam junto com o status, e o FK e ON DELETE SET NULL:
-- apagar a transacao primeiro tentaria deixar a linha em 'paid' com
-- `transaction_id` NULL, exatamente o estado que a constraint existe para
-- impedir -- e o DELETE falharia. E a mesma ordem do DELETE /pay.
--
-- ESTE ARQUIVO SO ACRESCENTA: nenhuma funcao, view, policy ou trigger de
-- producao e alterada. A unica escrita em dado existente e o reparo, e ele so
-- alcanca linha que casa a chave canonica da fatura.
--
-- SEM META-COMANDO DE psql AQUI -- ESTE ARQUIVO E COLADO NO SQL EDITOR
-- ---------------------------------------------------------------------
-- Producao nao tem runner de migration: quem aplica e uma pessoa, colando o
-- arquivo no SQL Editor do Supabase, que fala Postgres e NAO e o psql. Uma
-- linha comecando com barra invertida vira `syntax error at or near "\"` na
-- PRIMEIRA linha executavel -- e como o erro e no topo, NADA e aplicado. O
-- arquivo parece rodado e o banco nao mudou. Foi o que aconteceu na primeira
-- tentativa de aplicar esta migration (HMO-149, 2026-09-24).
--
-- Nenhuma das migrations 000-014 usa meta-comando; esta era a unica. O CI ja
-- passa ON_ERROR_STOP pela linha de comando (`psql -v ON_ERROR_STOP=1`), entao
-- declara-lo aqui dentro nao acrescentava nada la.
--
-- E a seguranca nao dependia dele: o arquivo inteiro esta num BEGIN/COMMIT.
-- Erro no meio aborta a transacao, todo comando seguinte falha com "current
-- transaction is aborted" e o COMMIT final vira ROLLBACK. Aplicar pela metade
-- continua sendo impossivel -- e a SECAO 4 ainda confere objeto por objeto e
-- da RAISE EXCEPTION se faltar alguma coisa.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 1: o elo entre as duas pernas
-- =====================================================
-- Uma direcao so: a perna de ENTRADA (a que quita o cartao) aponta para a
-- perna de SAIDA (a que tirou o dinheiro da conta, e a que
-- `scheduled_transactions.transaction_id` referencia). Apontar nos dois
-- sentidos exigiria um UPDATE depois dos dois INSERTs -- um terceiro passo
-- para falhar no meio, sem nada em troca: o estorno procura pela entrada a
-- partir da saida, nunca o contrario.
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS counterpart_transaction_id uuid;

COMMENT ON COLUMN public.financial_transactions.counterpart_transaction_id IS
  'Perna oposta de uma transferencia entre contas proprias (hoje: pagamento de fatura). A perna de entrada aponta para a de saida.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financial_transactions'::regclass
      AND conname = 'financial_transactions_counterpart_fkey'
  ) THEN
    -- ON DELETE SET NULL, nao CASCADE: apagar a perna de saida nao pode
    -- apagar a perna de entrada em silencio. Quem apaga as duas e o estorno,
    -- explicitamente, para que a rota possa avisar se a segunda falhar.
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_counterpart_fkey
      FOREIGN KEY (counterpart_transaction_id)
      REFERENCES public.financial_transactions(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financial_transactions'::regclass
      AND conname = 'financial_transactions_counterpart_not_self'
  ) THEN
    -- Uma perna apontando para si mesma passaria por par valido e o estorno
    -- apagaria uma linha so, deixando metade da transferencia no saldo.
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_counterpart_not_self
      CHECK (counterpart_transaction_id IS NULL OR counterpart_transaction_id <> id);
  END IF;
END $$;

-- O estorno busca a perna de entrada por counterpart_transaction_id. Sem
-- indice isso e um seq scan na tabela que mais cresce no banco.
CREATE INDEX IF NOT EXISTS idx_financial_transactions_counterpart
  ON public.financial_transactions (counterpart_transaction_id)
  WHERE counterpart_transaction_id IS NOT NULL;

-- =====================================================
-- SECAO 2: o reparo
-- =====================================================
-- A chave canonica que `POST /api/card-invoices/close` grava em
-- `scheduled_transactions.notes` e `fatura:YYYY-MM-01:<uuid do cartao>`.
--
-- A deteccao e pela CHAVE, nunca pelo tipo da conta. Assinatura cobrada no
-- cartao e cadastrada como conta prevista com `account_id` do cartao, e pagar
-- aquela conta COM o cartao e despesa de verdade: quem varresse por
-- `account_type = 'credit_card'` apagaria o lancamento de toda assinatura de
-- cartao ja paga e faria a despesa desaparecer do relatorio.
--
-- A regex e ancorada nas duas pontas pelo mesmo motivo que em
-- lib/card-invoice.ts: sem o `$`, uma nota escrita a mao pelo usuario entraria
-- no reparo.
CREATE OR REPLACE FUNCTION public.reparar_pagamentos_de_fatura()
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_total integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT
      s.id            AS scheduled_id,
      s.transaction_id,
      s.user_id,
      s.description,
      s.paid_date,
      t.amount,
      t.account_id
    FROM public.scheduled_transactions s
    JOIN public.financial_transactions t ON t.id = s.transaction_id
    WHERE s.status = 'paid'
      AND s.notes ~ '^fatura:\d{4}-\d{2}-\d{2}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      -- a transacao da baixa caiu no PROPRIO cartao da chave: e a baixa antiga
      AND t.account_id = (substring(s.notes from '^fatura:\d{4}-\d{2}-\d{2}:(.+)$'))::uuid
      -- cinto e suspensorio: a baixa nova grava 'transfer' e jamais entra aqui
      AND t.transaction_type IS DISTINCT FROM 'transfer'
  LOOP
    -- Ordem inversa da baixa. Ver a nota no cabecalho: soltar a conta depois
    -- do DELETE violaria scheduled_transactions_paid_check.
    UPDATE public.scheduled_transactions
       SET status = 'pending', paid_date = NULL, transaction_id = NULL
     WHERE id = r.scheduled_id;

    -- O trigger update_account_balance devolve o saldo do cartao aqui
    -- (current_balance - OLD.amount), no mesmo comando.
    DELETE FROM public.financial_transactions WHERE id = r.transaction_id;

    v_total := v_total + 1;

    RAISE NOTICE
      'reparada: "%" (usuario %, paga em %, valor %) -> voltou para pending; o saldo do cartao % foi devolvido em %',
      r.description, r.user_id, r.paid_date, r.amount, r.account_id, abs(r.amount);
  END LOOP;

  RETURN v_total;
END $$;

COMMENT ON FUNCTION public.reparar_pagamentos_de_fatura() IS
  'Desfaz baixas de fatura lancadas no proprio cartao (bug HMO-149): apaga a transacao e devolve a conta prevista para pending. Idempotente.';

-- Sem EXECUTE para os papeis do app. A funcao escreve em dinheiro e existe
-- para manutencao; deixar o EXECUTE default (PUBLIC) a publicaria como RPC em
-- /rest/v1/rpc para qualquer usuario logado.
--
-- REVOKE de PUBLIC nao basta neste banco: o Supabase concede explicitamente a
-- anon e authenticated, e um grant explicito sobrevive ao REVOKE de PUBLIC --
-- a mesma armadilha do 002. Por isso os tres REVOKEs.
REVOKE ALL ON FUNCTION public.reparar_pagamentos_de_fatura() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.reparar_pagamentos_de_fatura() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.reparar_pagamentos_de_fatura() FROM authenticated;
  END IF;
END $$;

-- =====================================================
-- SECAO 3: roda o reparo uma vez
-- =====================================================
DO $$
DECLARE
  v_total integer;
BEGIN
  v_total := public.reparar_pagamentos_de_fatura();
  IF v_total = 0 THEN
    RAISE NOTICE '015: nenhuma baixa de fatura torta encontrada.';
  ELSE
    RAISE NOTICE '015: % baixa(s) de fatura desfeita(s). As faturas voltaram para a agenda em Contas Previstas -- de baixa de novo escolhendo a conta pagadora.', v_total;
  END IF;
END $$;

-- =====================================================
-- SECAO 4: prova
-- =====================================================
-- Aborta se qualquer metade nao pegou. O motivo de existir e o mesmo do 014: a
-- migration e colada a mao num SQL Editor, e um erro no meio de um script
-- longo passa despercebido entre os NOTICEs.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'financial_transactions'
      AND column_name = 'counterpart_transaction_id'
  ) THEN
    problemas := problemas || E'\n  - falta a coluna counterpart_transaction_id';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financial_transactions'::regclass
      AND conname = 'financial_transactions_counterpart_fkey'
  ) THEN
    problemas := problemas || E'\n  - falta o FK da perna oposta';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financial_transactions'::regclass
      AND conname = 'financial_transactions_counterpart_not_self'
  ) THEN
    problemas := problemas || E'\n  - falta o CHECK que impede a perna apontar para si mesma';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'reparar_pagamentos_de_fatura'
  ) THEN
    problemas := problemas || E'\n  - falta a funcao de reparo';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND has_function_privilege('authenticated', 'public.reparar_pagamentos_de_fatura()', 'EXECUTE') THEN
    problemas := problemas || E'\n  - authenticated ainda pode executar o reparo (RPC aberta)';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND has_function_privilege('anon', 'public.reparar_pagamentos_de_fatura()', 'EXECUTE') THEN
    problemas := problemas || E'\n  - anon ainda pode executar o reparo (RPC aberta)';
  END IF;

  -- Nenhuma baixa de fatura pode ter sobrado apontando para o proprio cartao.
  IF EXISTS (
    SELECT 1
    FROM public.scheduled_transactions s
    JOIN public.financial_transactions t ON t.id = s.transaction_id
    WHERE s.status = 'paid'
      AND s.notes ~ '^fatura:\d{4}-\d{2}-\d{2}:[0-9a-fA-F-]{36}$'
      AND t.account_id = (substring(s.notes from '^fatura:\d{4}-\d{2}-\d{2}:(.+)$'))::uuid
      AND t.transaction_type IS DISTINCT FROM 'transfer'
  ) THEN
    problemas := problemas || E'\n  - sobrou baixa de fatura lancada no proprio cartao';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION E'015 aplicou parcialmente:%', problemas;
  END IF;

  RAISE NOTICE '015 conferido: coluna, FK, CHECK, indice, funcao de reparo fechada para anon/authenticated, e nenhuma baixa torta restante.';
END $$;

-- =====================================================
-- SECAO 5: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('015', '015_card_invoice_payment',
        'Elo entre as pernas da transferencia e reparo das baixas de fatura lancadas no proprio cartao - HMO-149', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 16. 016_recurrence_notifications.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - AVISO DE ASSINATURA: O "JA AVISEI" DOS ALERTAS DE RECORRENCIA
-- =====================================================
-- Migration: 016_recurrence_notifications
-- Gerado em: 2026-09-24  (HMO-148)
--
-- O QUE FALTAVA
-- -------------
-- Os dois alertas do detector -- preco subiu mais de 10%, e cobranca depois de
-- marcada como cancelada -- ja sao CALCULADOS (lib/recurrence-detector.ts) e
-- aparecem na tela /dashboard/recurrences. O que nao existia era o DISPARO:
-- push e sino.
--
-- Disparar exige uma coisa que o calculo nao tem: o estado "ja avisei ESTE
-- usuario sobre ESTE alerta". Sem ele o aviso sai de novo a cada varredura --
-- e a varredura roda no cron diario E ao fim de cada importacao de extrato
-- (HMO-147). Quem importa tres extratos numa tarde recebe o mesmo "a Netflix
-- subiu 12%" tres vezes. O app vira spam e o usuario desliga a notificacao, o
-- que apaga junto o aviso de vencimento, que e o que ele mais precisa.
--
-- POR QUE A REGRA CONTINUA EM TYPESCRIPT E SO O "JA AVISEI" VEM PARA O BANCO
-- --------------------------------------------------------------------------
-- Reescrever "subiu mais de 10% em relacao a media das ANTERIORES" numa view
-- criaria DUAS definicoes do mesmo alerta -- a de lib/recurrence-detector.ts,
-- que tem teste, e a daqui. Duas definicoes do mesmo numero e o erro que o
-- cabecalho da monthly_cash_flow (008) existe para nao repetir: as duas
-- parecem certas e divergem na primeira correcao aplicada em so uma delas.
--
-- Entao o banco guarda so o fato consumado: "em tal data, avisei tal pessoa
-- sobre tal recorrencia". Isso nenhum TypeScript guarda, porque o processo que
-- avisa morre no fim do request.
--
-- POR QUE GENERALIZAR bill_notifications E NAO CRIAR UMA SEGUNDA TABELA
-- ---------------------------------------------------------------------
-- O sino do app e UMA lista. Com duas tabelas, cada consumidor (o sino, o
-- contador de nao-lidos, o "marcar como lido") teria que ler as duas e
-- intercalar por data -- e o dia em que alguem esquecer a segunda tabela num
-- desses lugares produz um sino que mostra 2 avisos e um contador que diz 5.
-- Uma tabela so, com duas familias de `kind`, faz o PATCH /api/notifications/[id]
-- que ja existe funcionar para os avisos novos sem uma linha de codigo.
--
-- O PRECO: a tabela passa a ter duas referencias opcionais no lugar de uma
-- obrigatoria, e e por isso que as SECOES 3 e 4 existem.
--
-- =====================================================
-- A ARMADILHA QUE ESTA MIGRATION EVITA -- LEIA ANTES DE MEXER NO INDICE
-- =====================================================
-- O desenho da issue pedia um indice unico PARCIAL:
--
--   CREATE UNIQUE INDEX ... ON bill_notifications (recurrence_id, kind, reference_date)
--     WHERE recurrence_id IS NOT NULL;
--
-- O raciocinio estava certo (a UNIQUE antiga nao deduplica linha de
-- recorrencia, porque NULL nao colide com NULL). A FORMA e que nao serve, e o
-- motivo nao aparece em lugar nenhum ate o cron rodar em producao:
--
-- **Um indice unico parcial nao pode ser inferido como arbitro de ON CONFLICT
-- sem repetir o predicado do indice na propria clausula.** Conferido em
-- PostgreSQL 17:
--
--   INSERT ... ON CONFLICT (recurrence_id, kind, reference_date) DO NOTHING
--   -- com indice PARCIAL:
--   ERROR: there is no unique or exclusion constraint matching the ON CONFLICT
--          specification
--
--   INSERT ... ON CONFLICT (recurrence_id, kind, reference_date)
--     WHERE recurrence_id IS NOT NULL DO NOTHING
--   -- passa.
--
-- E o `onConflict:` do supabase-js/PostgREST aceita uma LISTA DE COLUNAS. Nao
-- existe jeito de mandar o `WHERE` do indice por ali. Com o indice parcial, a
-- rota /api/cron/recurrence-alerts responderia 500 em toda execucao e ninguem
-- receberia aviso nenhum -- e o sintoma ("falha ao gravar os avisos") nao
-- aponta para o indice.
--
-- Por isso o indice aqui e CHEIO. O que se perde e uma entrada de indice por
-- linha de conta prevista (recurrence_id NULL); o que se ganha e um upsert que
-- funciona pelo cliente que o projeto realmente usa. E o indice cheio dedupica
-- exatamente igual para a familia de recorrencia, porque duas linhas de conta
-- prevista com `recurrence_id` NULL nunca colidem entre si -- NULL nao e igual
-- a NULL em indice unico. Conferido nos tres casos em
-- database/tests/recurrence_notifications_test.sql.
--
-- REFERENCE_DATE DE UMA RECORRENCIA = last_charge_date
-- ---------------------------------------------------
-- Mesma ideia do `due_date` na familia de conta prevista: a chave unica inclui
-- uma data para que um FATO NOVO mereca um aviso novo. Adiar a conta gera
-- aviso novo; uma cobranca nova da assinatura tambem. Se a chave fosse so
-- (recurrence_id, kind), o usuario seria avisado do aumento uma unica vez na
-- vida daquela assinatura -- o reajuste do ano seguinte passaria calado.
--
-- SEM META-COMANDO DE psql AQUI -- ESTE ARQUIVO E COLADO NO SQL EDITOR
-- ---------------------------------------------------------------------
-- Producao nao tem runner de migration: quem aplica e uma pessoa, colando o
-- arquivo no SQL Editor do Supabase, que fala Postgres e NAO e o psql. Uma
-- linha comecando com barra invertida vira `syntax error at or near "\"`, e
-- como ela estava ANTES do primeiro comando executavel, NADA era aplicado --
-- nem a coluna, nem os CHECKs, nem o indice. O arquivo parecia rodado e o
-- banco nao mudava. Foi exatamente o que aconteceu com a 015 (HMO-149,
-- 2026-09-24); este arquivo tinha o mesmo defeito e ainda nao havia sido
-- aplicado em producao, entao ia falhar do mesmo jeito na vez dele.
--
-- O CI ja passa ON_ERROR_STOP pela linha de comando (`psql -v
-- ON_ERROR_STOP=1`), entao declara-lo aqui dentro nao acrescentava nada la.
-- E a seguranca nao dependia dele: o arquivo inteiro esta num BEGIN/COMMIT.
-- Erro no meio aborta a transacao, todo comando seguinte falha com "current
-- transaction is aborted" e o COMMIT final vira ROLLBACK -- aplicar pela
-- metade continua impossivel, e a SECAO 6 ainda confere objeto por objeto e
-- da RAISE EXCEPTION se faltar alguma coisa.
--
-- scripts/check-migrations-in-ci.mjs agora reprova qualquer migration nova com
-- meta-comando, para que isto nao volte numa terceira.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: pre-requisitos
-- =====================================================
-- Sem isto a migration falha mais adiante com "relation does not exist", que
-- nao diz QUAL migration ficou para tras.
DO $$
BEGIN
  IF to_regclass('public.bill_notifications') IS NULL THEN
    RAISE EXCEPTION '016 exige public.bill_notifications (migration 009) -- aplique o 009 primeiro.';
  END IF;

  IF to_regclass('public.detected_recurrences') IS NULL THEN
    RAISE EXCEPTION '016 exige public.detected_recurrences (migration 011) -- aplique o 011 primeiro.';
  END IF;
END $$;

-- =====================================================
-- SECAO 1: a referencia deixa de ser obrigatoria
-- =====================================================
-- Um aviso de recorrencia nao tem conta prevista. Enquanto a coluna for
-- NOT NULL, a unica saida seria inventar um valor -- e a alternativa comum
-- (apontar para uma conta prevista qualquer) faz o clique no sino levar o
-- usuario para a conta errada.
ALTER TABLE public.bill_notifications
  ALTER COLUMN scheduled_transaction_id DROP NOT NULL;

-- =====================================================
-- SECAO 2: a referencia nova
-- =====================================================
-- ON DELETE CASCADE: apagada a recorrencia, o aviso perde o destino do clique.
-- Manter a linha deixaria um item no sino que abre uma tela vazia.
ALTER TABLE public.bill_notifications
  ADD COLUMN IF NOT EXISTS recurrence_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_recurrence_id_fkey'
  ) THEN
    ALTER TABLE public.bill_notifications
      ADD CONSTRAINT bill_notifications_recurrence_id_fkey
      FOREIGN KEY (recurrence_id) REFERENCES public.detected_recurrences(id) ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON COLUMN public.bill_notifications.recurrence_id IS
  'A assinatura que originou o aviso, quando kind e da familia de recorrencia. Exclusivo com scheduled_transaction_id -- ver o CHECK.';

-- =====================================================
-- SECAO 3: o dominio de `kind` cresce
-- =====================================================
-- O CHECK antigo so admitia 'due_soon' e 'overdue'. Sem trocar por este, o
-- INSERT do cron novo seria recusado pela constraint -- o que, ao menos, e uma
-- falha visivel. O que NAO se pode fazer e largar o dominio aberto: `kind` e o
-- que a tela e o push usam para escolher icone e para onde o clique leva, e um
-- `kind` digitado errado viraria uma linha invisivel em vez de um erro.
ALTER TABLE public.bill_notifications
  DROP CONSTRAINT IF EXISTS bill_notifications_kind_check;

ALTER TABLE public.bill_notifications
  ADD CONSTRAINT bill_notifications_kind_check
  CHECK (kind IN ('due_soon', 'overdue', 'price_increase', 'charge_after_cancel'));

-- =====================================================
-- SECAO 4: exatamente UMA referencia, e coerente com o `kind`
-- =====================================================
-- Sao duas constraints porque sao dois erros diferentes, e um nome de
-- constraint que aparece no log de producao deve dizer qual dos dois aconteceu.
--
-- (a) exatamente uma referencia preenchida. Nenhuma das duas = aviso orfao:
--     aparece no sino e o clique nao tem para onde ir. As duas = o clique tem
--     dois destinos e quem escolhe passa a ser a ordem do `if` no componente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_one_reference_check'
  ) THEN
    ALTER TABLE public.bill_notifications
      ADD CONSTRAINT bill_notifications_one_reference_check
      CHECK (
        (scheduled_transaction_id IS NOT NULL) <> (recurrence_id IS NOT NULL)
      );
  END IF;
END $$;

-- (b) a referencia combina com a familia do `kind`. O (a) sozinho aceita um
--     'due_soon' apontando para uma recorrencia: a linha nasce valida, entra
--     no sino, e desaparece do `already_notified` da view bill_alerts (que
--     casa por scheduled_transaction_id) -- ou seja, o aviso de vencimento
--     sairia DE NOVO no dia seguinte. Um aviso repetido por causa de uma linha
--     que o banco aceitou e exatamente a falha que esta issue existe para
--     fechar, entao a regra vira constraint em vez de convencao.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_kind_reference_check'
  ) THEN
    ALTER TABLE public.bill_notifications
      ADD CONSTRAINT bill_notifications_kind_reference_check
      CHECK (
        (kind IN ('due_soon', 'overdue') AND scheduled_transaction_id IS NOT NULL)
        OR
        (kind IN ('price_increase', 'charge_after_cancel') AND recurrence_id IS NOT NULL)
      );
  END IF;
END $$;

-- =====================================================
-- SECAO 5: o indice que impede o aviso repetido
-- =====================================================
-- Ver "A ARMADILHA" no cabecalho para o porque de ele ser CHEIO e nao parcial.
-- Esta e a linha que faz o cron poder rodar dez vezes por dia -- e depois de
-- cada importacao de extrato -- sem avisar duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS bill_notifications_recurrence_unique
  ON public.bill_notifications (recurrence_id, kind, reference_date);

COMMENT ON INDEX public.bill_notifications_recurrence_unique IS
  'Deduplica o aviso de assinatura. Cheio (nao parcial) porque indice parcial nao serve de arbitro de ON CONFLICT pelo PostgREST -- ver o cabecalho do 016.';

COMMENT ON TABLE public.bill_notifications IS
  'Avisos ja emitidos, das DUAS familias: vencimento de conta prevista (scheduled_transaction_id) e alerta de assinatura (recurrence_id). As duas UNIQUEs sao o que impede repetir o mesmo aviso a cada varredura.';

-- =====================================================
-- SECAO 6: conferencia
-- =====================================================
-- Uma migration que aplica METADE e o pior resultado possivel aqui: a coluna
-- existiria, o cron gravaria, e a deduplicacao -- a razao de ser do arquivo --
-- estaria faltando sem nenhum sintoma ate o segundo aviso chegar no celular.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.bill_notifications'::regclass
      AND attname = 'scheduled_transaction_id'
      AND attnotnull
  ) THEN
    problemas := problemas || E'\n  - scheduled_transaction_id continua NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.bill_notifications'::regclass
      AND attname = 'recurrence_id' AND attnum > 0 AND NOT attisdropped
  ) THEN
    problemas := problemas || E'\n  - coluna recurrence_id nao existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_recurrence_id_fkey' AND confdeltype = 'c'
  ) THEN
    problemas := problemas || E'\n  - FK de recurrence_id ausente ou sem ON DELETE CASCADE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_kind_check'
      AND pg_get_constraintdef(oid) LIKE '%price_increase%'
      AND pg_get_constraintdef(oid) LIKE '%charge_after_cancel%'
  ) THEN
    problemas := problemas || E'\n  - o CHECK de kind nao admite as duas familias novas';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_one_reference_check'
  ) THEN
    problemas := problemas || E'\n  - CHECK de referencia exclusiva ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_kind_reference_check'
  ) THEN
    problemas := problemas || E'\n  - CHECK de coerencia entre kind e referencia ausente';
  END IF;

  -- Nao basta o indice existir: PARCIAL nao serve de arbitro de ON CONFLICT
  -- pelo PostgREST, e essa e a diferenca entre o cron funcionar e responder
  -- 500 em toda execucao. `indpred IS NULL` e o que distingue os dois.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.bill_notifications'::regclass
      AND c.relname = 'bill_notifications_recurrence_unique'
      AND i.indisunique
      AND i.indpred IS NULL
  ) THEN
    problemas := problemas || E'\n  - indice unico de deduplicacao ausente, nao-unico, ou PARCIAL (parcial nao serve de arbitro de ON CONFLICT)';
  END IF;

  -- A UNIQUE da familia de conta prevista tem que continuar de pe: e ela que
  -- impede o aviso de vencimento de repetir.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_unique'
  ) THEN
    problemas := problemas || E'\n  - a UNIQUE de conta prevista desapareceu';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION E'016 aplicou parcialmente:%', problemas;
  END IF;

  RAISE NOTICE '016 conferido: referencia opcional, recurrence_id com CASCADE, dominio de kind, os dois CHECKs e o indice unico CHEIO de deduplicacao.';
END $$;

-- =====================================================
-- SECAO 7: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('016', '016_recurrence_notifications',
        'bill_notifications passa a guardar tambem o "ja avisei" dos alertas de assinatura - HMO-148', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 17. 017_monthly_summary_notifications.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - O RESUMO DO MES FECHADO ENTRA NO SINO
-- =====================================================
-- Migration: 017_monthly_summary_notifications
-- Gerado em: 2026-09-24  (HMO-154)
--
-- O QUE FALTAVA
-- -------------
-- O resumo do mes fechado ja e CALCULADO (lib/anomalies.ts, com 27 testes e
-- sete mutacoes provadas). O que nao existia era o canal: o cron precisa
-- gravar em bill_notifications, e a tabela -- do jeito que a 016 a deixou --
-- RECUSA a linha do resumo. Nao e falta de coluna: e o CHECK
-- `bill_notifications_one_reference_check`, que exige exatamente UMA referencia
-- preenchida entre `scheduled_transaction_id` e `recurrence_id`.
--
-- E um resumo de mes nao aponta para nenhum dos dois. Ele nao e sobre uma conta
-- nem sobre uma assinatura; e sobre um MES. Sem esta migration o cron responde
-- 500 com "violates check constraint" em toda execucao -- e a mensagem cita o
-- nome da constraint, nao o desenho, entao quem for depurar vai olhar para a
-- rota antes de olhar para a tabela.
--
-- A 016 acertou em generalizar bill_notifications em vez de criar uma segunda
-- tabela (o sino do app e UMA lista, e duas tabelas produzem um sino que mostra
-- 2 avisos e um contador que diz 5). Esta migration segue a mesma linha e
-- admite a TERCEIRA familia -- com a diferenca de que esta nao tem objeto para
-- apontar.
--
-- =====================================================
-- POR QUE UMA COLUNA NOVA, E NAO A `reference_date` QUE JA EXISTE
-- =====================================================
-- A deduplicacao e a razao de ser deste arquivo: o cron do resumo roda todo dia
-- 1, e a Vercel no plano Hobby tem +-59min de precisao -- uma execucao dupla na
-- virada nao e hipotese remota. Sem chave unica, quem acorda dia 1 recebe o
-- resumo de setembro duas vezes.
--
-- A chave obvia seria (user_id, kind, reference_date). Ela NAO serve, e o
-- motivo nao aparece ate a familia antiga quebrar em producao: duas contas
-- diferentes que vencem NO MESMO DIA geram dois avisos `due_soon` do mesmo
-- usuario com a mesma `reference_date`. Um indice unico sobre essas tres
-- colunas recusaria o segundo -- e o usuario deixaria de ser avisado de uma
-- conta que vence hoje, sem nada no log dizendo por que. Seria trocar um aviso
-- repetido por um aviso PERDIDO, que e o erro caro dos dois.
--
-- Entao a familia do resumo ganha a propria coluna, `summary_month`, e o indice
-- e sobre ela. Nas linhas das outras duas familias `summary_month` e NULL, e em
-- indice unico NULL nunca colide com NULL -- as linhas de conta e de assinatura
-- atravessam o indice sem se ver. E o mesmo mecanismo que a 016 usou para o
-- indice de recorrencia conviver com as linhas de conta prevista.
--
-- O INDICE E CHEIO, NAO PARCIAL -- e tem que continuar assim. Um indice unico
-- PARCIAL nao pode ser inferido como arbitro de ON CONFLICT pela lista de
-- colunas que o PostgREST manda (o `onConflict:` do supabase-js nao tem como
-- transportar o `WHERE` do indice), e o upsert do cron passaria a responder
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" em TODA execucao. Ver a secao "A ARMADILHA" no cabecalho da
-- 016: e a mesma, e ela ja custou uma migration refeita.
--
-- `summary_month` guarda o primeiro dia do mes FECHADO ('2026-09-01' para o
-- resumo de setembro), igual ao grao de `date_trunc('month', ...)` das views do
-- 008. `reference_date` continua sendo preenchida com o mesmo valor, porque e
-- NOT NULL desde a 009 e e ela que a tela usa para ordenar -- a redundancia e
-- consciente e o preco de manter a familia antiga intacta.
--
-- SEM META-COMANDO DE psql AQUI -- ESTE ARQUIVO E COLADO NO SQL EDITOR
-- ---------------------------------------------------------------------
-- Producao nao tem runner de migration: quem aplica e uma pessoa, colando o
-- arquivo no SQL Editor do Supabase, que fala Postgres e NAO e o psql. Uma
-- unica linha comecando com barra invertida vira `syntax error at or near "\"`
-- e, por estar ANTES do primeiro comando executavel, faz o arquivo INTEIRO ser
-- recusado -- nada e aplicado e o banco nao muda. Aconteceu com a 015 e a 016.
-- Ha guard no CI para isso desde entao (scripts/check-migrations-in-ci.mjs).
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: pre-requisitos
-- =====================================================
-- Sem isto a migration falha mais adiante com "constraint does not exist", que
-- nao diz QUAL migration ficou para tras.
DO $$
BEGIN
  IF to_regclass('public.bill_notifications') IS NULL THEN
    RAISE EXCEPTION '017 exige public.bill_notifications (migration 009) -- aplique o 009 primeiro.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.bill_notifications'::regclass
      AND attname = 'recurrence_id' AND attnum > 0 AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '017 exige bill_notifications.recurrence_id (migration 016) -- aplique o 016 primeiro.';
  END IF;
END $$;

-- =====================================================
-- SECAO 1: a coluna que identifica o mes resumido
-- =====================================================
ALTER TABLE public.bill_notifications
  ADD COLUMN IF NOT EXISTS summary_month date;

COMMENT ON COLUMN public.bill_notifications.summary_month IS
  'Primeiro dia do mes FECHADO que este resumo cobre. Preenchida so na familia monthly_summary; NULL nas outras duas -- e esse NULL que deixa o indice unico cheio conviver com elas.';

-- O resumo e sobre um mes inteiro: um valor que nao seja o dia 1 significa que
-- alguem gravou uma data de transacao no lugar do mes, e ai duas execucoes do
-- mesmo mes deixam de colidir no indice -- o aviso repetiria, que e exatamente
-- o que este arquivo existe para impedir. Barato de verificar, caro de nao ver.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_summary_month_check'
  ) THEN
    ALTER TABLE public.bill_notifications
      ADD CONSTRAINT bill_notifications_summary_month_check
      CHECK (summary_month IS NULL OR summary_month = date_trunc('month', summary_month)::date);
  END IF;
END $$;

-- =====================================================
-- SECAO 2: o dominio de `kind` admite a terceira familia
-- =====================================================
-- Continua FECHADO de proposito: `kind` e o que a tela e o push usam para
-- escolher icone e destino do clique, e um `kind` digitado errado precisa virar
-- erro, nao uma linha invisivel no sino.
ALTER TABLE public.bill_notifications
  DROP CONSTRAINT IF EXISTS bill_notifications_kind_check;

ALTER TABLE public.bill_notifications
  ADD CONSTRAINT bill_notifications_kind_check
  CHECK (kind IN ('due_soon', 'overdue', 'price_increase', 'charge_after_cancel', 'monthly_summary'));

-- =====================================================
-- SECAO 3: as duas regras de coerencia, agora com tres familias
-- =====================================================
-- (a) exatamente UMA referencia. A 016 escreveu isto como `<>` entre dois
--     booleanos, que e XOR e so funciona para dois. Com tres termos o XOR
--     encadeado ACEITA os tres preenchidos (true <> true <> true = true), que e
--     precisamente o caso que a regra existe para recusar. Por isso vira
--     contagem: soma quantas estao preenchidas e exige 1.
ALTER TABLE public.bill_notifications
  DROP CONSTRAINT IF EXISTS bill_notifications_one_reference_check;

ALTER TABLE public.bill_notifications
  ADD CONSTRAINT bill_notifications_one_reference_check
  CHECK (
    (CASE WHEN scheduled_transaction_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN recurrence_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN summary_month IS NOT NULL THEN 1 ELSE 0 END)
    = 1
  );

-- (b) a referencia combina com a familia do `kind`. Sem isto, um 'due_soon'
--     poderia nascer com `summary_month` no lugar de `scheduled_transaction_id`:
--     a linha entraria no sino e sumiria do `already_notified` da view
--     bill_alerts (que casa por scheduled_transaction_id), e o aviso de
--     vencimento sairia DE NOVO no dia seguinte.
ALTER TABLE public.bill_notifications
  DROP CONSTRAINT IF EXISTS bill_notifications_kind_reference_check;

ALTER TABLE public.bill_notifications
  ADD CONSTRAINT bill_notifications_kind_reference_check
  CHECK (
    (kind IN ('due_soon', 'overdue') AND scheduled_transaction_id IS NOT NULL)
    OR
    (kind IN ('price_increase', 'charge_after_cancel') AND recurrence_id IS NOT NULL)
    OR
    (kind = 'monthly_summary' AND summary_month IS NOT NULL)
  );

-- =====================================================
-- SECAO 4: o indice que impede o resumo duplicado
-- =====================================================
-- CHEIO, nao parcial -- ver o cabecalho. E a linha que torna seguro o cron do
-- dia 1 rodar duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS bill_notifications_summary_unique
  ON public.bill_notifications (user_id, kind, summary_month);

COMMENT ON INDEX public.bill_notifications_summary_unique IS
  'Deduplica o resumo mensal. Cheio (nao parcial) porque indice parcial nao serve de arbitro de ON CONFLICT pelo PostgREST -- ver o cabecalho do 016 e do 017. As linhas das outras familias tem summary_month NULL e nao colidem entre si.';

COMMENT ON TABLE public.bill_notifications IS
  'Avisos ja emitidos, das TRES familias: vencimento de conta prevista (scheduled_transaction_id), alerta de assinatura (recurrence_id) e resumo do mes fechado (summary_month). As tres chaves unicas sao o que impede repetir o mesmo aviso a cada passada do cron.';

-- =====================================================
-- SECAO 5: conferencia
-- =====================================================
-- Aplicar METADE e o pior resultado possivel: a coluna existiria, o cron
-- gravaria, e a deduplicacao -- a razao de ser do arquivo -- estaria faltando
-- sem nenhum sintoma ate o segundo resumo chegar no celular.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.bill_notifications'::regclass
      AND attname = 'summary_month' AND attnum > 0 AND NOT attisdropped
  ) THEN
    problemas := problemas || E'\n  - coluna summary_month nao existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_kind_check'
      AND pg_get_constraintdef(oid) LIKE '%monthly_summary%'
  ) THEN
    problemas := problemas || E'\n  - o CHECK de kind nao admite monthly_summary';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_one_reference_check'
      AND pg_get_constraintdef(oid) LIKE '%summary_month%'
  ) THEN
    problemas := problemas || E'\n  - o CHECK de referencia exclusiva nao conhece summary_month';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_kind_reference_check'
      AND pg_get_constraintdef(oid) LIKE '%monthly_summary%'
  ) THEN
    problemas := problemas || E'\n  - o CHECK de coerencia entre kind e referencia nao conhece a familia do resumo';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_summary_month_check'
  ) THEN
    problemas := problemas || E'\n  - CHECK de primeiro-dia-do-mes ausente';
  END IF;

  -- Nao basta o indice existir: PARCIAL nao serve de arbitro de ON CONFLICT
  -- pelo PostgREST, e essa e a diferenca entre o cron funcionar e responder 500
  -- em toda execucao. `indpred IS NULL` e o que distingue os dois.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.bill_notifications'::regclass
      AND c.relname = 'bill_notifications_summary_unique'
      AND i.indisunique
      AND i.indpred IS NULL
  ) THEN
    problemas := problemas || E'\n  - indice unico do resumo ausente, nao-unico, ou PARCIAL (parcial nao serve de arbitro de ON CONFLICT)';
  END IF;

  -- As duas chaves das familias antigas tem que continuar de pe: sao elas que
  -- impedem o aviso de vencimento e o de assinatura de repetirem.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_notifications'::regclass
      AND conname = 'bill_notifications_unique'
  ) THEN
    problemas := problemas || E'\n  - a UNIQUE de conta prevista desapareceu';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.bill_notifications'::regclass
      AND c.relname = 'bill_notifications_recurrence_unique'
      AND i.indisunique
  ) THEN
    problemas := problemas || E'\n  - o indice unico de assinatura (016) desapareceu';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION E'017 aplicou parcialmente:%', problemas;
  END IF;

  RAISE NOTICE '017 conferido: summary_month, dominio de kind com tres familias, os dois CHECKs de coerencia e o indice unico CHEIO do resumo.';
END $$;

-- =====================================================
-- SECAO 6: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('017', '017_monthly_summary_notifications',
        'bill_notifications admite a terceira familia de aviso: o resumo do mes fechado - HMO-154', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 18. 018_goal_monthly_contribution.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - O APORTE DE META ENTRA NO "QUANTO POSSO GASTAR"
-- =====================================================
-- Migration: 018_goal_monthly_contribution
-- Gerado em: 2026-09-24  (HMO-155)
--
-- O BURACO, E ELE FOI DEIXADO DE PROPOSITO
-- ----------------------------------------
-- O cabecalho do lib/safe-to-spend.ts termina listando o que a conta NAO sabe,
-- e o ultimo item e este: "reserva de metas -- aporte de meta ainda nao tem
-- alvo mensal no schema, entao nao ha o que descontar sem inventar semantica".
--
-- A consequencia na tela: o app diz que ha R$ 1.200 livres para o mes
-- exatamente para quem planejava separar R$ 800 deles. O numero nao esta
-- errado por pouco -- ele responde outra pergunta.
--
-- Este arquivo fecha o buraco pelo lado do schema. A aritmetica fica no
-- TypeScript (lib/safe-to-spend.ts, funcao pura com teste), como as outras
-- quatro parcelas.
--
-- =====================================================
-- A DECISAO: VALOR EXPLICITO MANDA, PRAZO E O PLANO B
-- =====================================================
-- A issue deixava as duas portas abertas -- alvo mensal explicito ou derivado
-- de target_amount, saved e target_date -- e pedia que a escolha ficasse
-- registrada AQUI, nao so no PR. Registrada:
--
--   `monthly_contribution` e a fonte da verdade. Quando ela e NULL e a meta tem
--   `target_date`, o alvo do mes e DERIVADO -- e derivado pela mesma formula
--   que a view ja publica em `monthly_required`, isto e, o que falta dividido
--   pelos meses que restam. Sem valor e sem prazo, a meta reserva ZERO.
--
-- Por que nao so explicito: ninguem tem esse campo preenchido hoje. Um desconto
-- que exige cadastro manual em cada meta entrega uma feature que nao muda nada
-- na tela de quem ja usa o app.
--
-- Por que nao so derivado: "juntar 15 mil" e uma meta valida sem data -- esta
-- escrito no comentario da propria coluna `target_date` no 008. So derivar
-- deixaria essa meta reservando nada para sempre, sem lugar onde consertar.
--
-- Por que a derivacao copia `monthly_required` em vez de inventar formula: a
-- tela de metas JA mostra ao usuario "voce precisa de R$ X por mes". Reservar
-- um numero diferente do que a tela promete seriam duas versoes da mesma regra
-- dentro do mesmo app, e a segunda deixa de acompanhar a primeira no dia em que
-- alguem mexer numa delas.
--
-- Por que a coluna e NULL-avel e nao tem DEFAULT: NULL aqui quer dizer "nao
-- escolhi", que e diferente de "escolhi zero". Um DEFAULT 0 apagaria a
-- distincao e, com ela, o plano B -- toda meta com prazo passaria a reservar
-- nada, calada.
--
-- =====================================================
-- O QUE ESTE ARQUIVO NAO FAZ, E POR QUE
-- =====================================================
-- NAO desconta meta de GRUPO. `financial_goals.group_id` existe e a RLS do 008
-- devolve as metas dos grupos do usuario junto com as dele. O alvo mensal de
-- uma meta de grupo e do GRUPO: descontar o valor cheio da carteira de cada
-- membro faria tres pessoas reservarem R$ 900 para uma meta de R$ 300 por mes,
-- e as tres veriam o "posso gastar" cair pelo dinheiro das outras duas. Ratear
-- e o problema do acerto de grupo (007), nao deste arquivo. A rota filtra
-- `group_id IS NULL` e o teste registra a exclusao.
--
-- NAO cria tabela de "reserva do mes". A reserva e derivada de fatos que ja
-- existem (o alvo e os aportes do mes) e muda a cada aporte lancado. Uma tabela
-- precisaria de trigger em goal_contributions para nao mentir -- mesma razao
-- pela qual nao existe tabela de "posso gastar", escrita no topo da rota.
--
-- =====================================================
-- SEM META-COMANDO DE psql AQUI -- ESTE ARQUIVO E COLADO NO SQL EDITOR
-- =====================================================
-- Producao nao tem runner de migration: quem aplica e uma pessoa, colando o
-- arquivo no SQL Editor do Supabase, que fala Postgres e NAO e o psql. Uma
-- unica linha comecando com barra invertida vira `syntax error at or near "\"`
-- e, por estar ANTES do primeiro comando executavel, faz o arquivo INTEIRO ser
-- recusado -- nada e aplicado e o banco nao muda. Aconteceu com a 015 e a 016.
-- Ha guard no CI para isso desde entao (scripts/check-migrations-in-ci.mjs).
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: pre-requisitos
-- =====================================================
-- Falhar aqui, com nome, e melhor do que falhar em "relation does not exist" na
-- SECAO 2 -- essa mensagem nao diz QUAL migration ficou para tras.
DO $$
BEGIN
  IF to_regclass('public.financial_goals') IS NULL THEN
    RAISE EXCEPTION '018 exige a 008 aplicada: public.financial_goals nao existe.';
  END IF;

  IF to_regclass('public.goal_contributions') IS NULL THEN
    RAISE EXCEPTION '018 exige a 008 aplicada: public.goal_contributions nao existe.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = to_regclass('public.goal_progress') AND relkind = 'v'
  ) THEN
    RAISE EXCEPTION '018 exige a 008 aplicada: a view public.goal_progress nao existe.';
  END IF;
END $$;

-- =====================================================
-- SECAO 1: o alvo mensal da meta
-- =====================================================
ALTER TABLE public.financial_goals
  ADD COLUMN IF NOT EXISTS monthly_contribution numeric(15,2);

COMMENT ON COLUMN public.financial_goals.monthly_contribution IS
  'Quanto o usuario quer separar por mes para esta meta. NULL = nao escolheu; nesse caso o "quanto posso gastar" deriva o alvo do prazo (mesma formula de goal_progress.monthly_required) e, sem prazo, reserva zero.';

-- Zero e negativo ficam de fora pelo mesmo motivo que `goal_contributions.amount
-- > 0` no 008: um alvo mensal negativo AUMENTARIA o "posso gastar" -- a meta
-- viraria fonte de dinheiro. E `0` nao e um valor escolhido, e a ausencia de
-- escolha, que ja tem representacao propria (NULL).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financial_goals'::regclass
      AND conname = 'financial_goals_monthly_contribution_check'
  ) THEN
    ALTER TABLE public.financial_goals
      ADD CONSTRAINT financial_goals_monthly_contribution_check
      CHECK (monthly_contribution IS NULL OR monthly_contribution > (0)::numeric);
  END IF;
END $$;

-- =====================================================
-- SECAO 2: a view publica o campo novo
-- =====================================================
-- O corpo abaixo e o do 008 sem uma virgula trocada; a UNICA diferenca e a
-- coluna `monthly_contribution` no fim do SELECT. CREATE OR REPLACE VIEW nao
-- aceita remover nem reordenar coluna -- so acrescentar no fim --, entao
-- repetir o corpo inteiro e o preco de nao usar DROP VIEW (que derrubaria os
-- GRANTs e o security_invoker junto).
CREATE OR REPLACE VIEW public.goal_progress AS
  SELECT
    g.id,
    g.user_id,
    g.group_id,
    g.account_id,
    g.title,
    g.description,
    g.target_amount,
    g.target_date,
    g.status,
    g.color_hex,
    g.icon,
    g.created_at,
    g.updated_at,
    COALESCE(c.saved, 0)::numeric(15,2) AS saved,
    -- nunca negativo: quem passou da meta ve "faltam R$ 0,00", nao um valor
    -- negativo que a tela formataria como "-R$ 300,00 restantes".
    GREATEST(g.target_amount - COALESCE(c.saved, 0), 0)::numeric(15,2) AS remaining,
    -- 4 casas; a tela arredonda. O CHECK garante target_amount > 0.
    ROUND(COALESCE(c.saved, 0) / g.target_amount, 4) AS progress_ratio,
    COALESCE(c.contribution_count, 0) AS contribution_count,
    c.last_contribution_at,
    d.months_left,
    CASE
      WHEN g.target_date IS NULL THEN NULL
      WHEN COALESCE(c.saved, 0) >= g.target_amount THEN 0::numeric(15,2)
      ELSE ROUND(
        (g.target_amount - COALESCE(c.saved, 0)) / GREATEST(d.months_left, 1),
        2)::numeric(15,2)
    END AS monthly_required,
    -- Estado calculado na leitura, separado de g.status (que o usuario controla
    -- ao pausar ou cancelar). 'reached' aparece sozinho quando os aportes
    -- alcancam o alvo: sem isso a meta ficaria "em andamento" com barra cheia
    -- ate alguem lembrar de marcar como concluida na mao.
    CASE
      WHEN g.status IN ('paused', 'cancelled') THEN g.status
      WHEN COALESCE(c.saved, 0) >= g.target_amount THEN 'reached'
      WHEN g.target_date IS NOT NULL AND g.target_date < CURRENT_DATE THEN 'overdue'
      ELSE 'on_track'
    END AS progress_status,
    -- A COLUNA NOVA (018). Vai crua para o cliente: quem decide entre ela e a
    -- derivacao pelo prazo e o lib/safe-to-spend.ts, que tem teste. Se a regra
    -- tambem morasse aqui, existiriam duas.
    g.monthly_contribution
  FROM public.financial_goals g
  LEFT JOIN LATERAL (
    SELECT SUM(gc.amount) AS saved,
           COUNT(*) AS contribution_count,
           MAX(gc.contributed_at) AS last_contribution_at
    FROM public.goal_contributions gc
    WHERE gc.goal_id = g.id
  ) AS c ON TRUE
  -- meses cheios entre o mes corrente e o mes do prazo, NULL sem prazo.
  -- Calculado uma vez num LATERAL porque monthly_required precisa do mesmo
  -- numero: duplicar a expressao e como duas versoes da mesma regra, e a
  -- segunda deixa de acompanhar a primeira na primeira vez que alguem mexer.
  -- O ::integer nao e cosmetico -- date_part() devolve double precision, e
  -- ROUND(double, int) nao existe no Postgres: a view nem chega a ser criada.
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN g.target_date IS NULL THEN NULL
             ELSE GREATEST(
               (date_part('year',  g.target_date) - date_part('year',  CURRENT_DATE)) * 12
                 + (date_part('month', g.target_date) - date_part('month', CURRENT_DATE)),
               0)::integer
           END AS months_left
  ) AS d ON TRUE;

COMMENT ON VIEW public.goal_progress IS
  'Metas com o juntado, o que falta, o ritmo mensal necessario e o alvo mensal escolhido pelo usuario, calculados na leitura.';

-- CREATE OR REPLACE VIEW preserva as reloptions da view antiga, entao em teoria
-- o security_invoker atravessa. Reafirmar e uma linha, e o custo de estar
-- errado e o vazamento que a 013 existiu para fechar: sem isto a view roda como
-- o DONO, a RLS das tabelas base nao se aplica e a meta de qualquer usuario
-- volta para qualquer usuario logado.
ALTER VIEW public.goal_progress SET (security_invoker = true);

GRANT SELECT ON public.goal_progress TO authenticated;

-- =====================================================
-- SECAO 3: conferencia
-- =====================================================
-- Aplicar METADE e o pior resultado: a coluna existiria na tabela, o usuario
-- conseguiria salvar o alvo mensal, e a view nao devolveria o campo -- o
-- desconto simplesmente nao aconteceria, sem erro em lugar nenhum.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.financial_goals'::regclass
      AND attname = 'monthly_contribution' AND attnum > 0 AND NOT attisdropped
  ) THEN
    problemas := problemas || E'\n  - coluna financial_goals.monthly_contribution nao existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.financial_goals'::regclass
      AND conname = 'financial_goals_monthly_contribution_check'
  ) THEN
    problemas := problemas || E'\n  - CHECK de alvo mensal positivo ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.goal_progress'::regclass
      AND attname = 'monthly_contribution' AND attnum > 0 AND NOT attisdropped
  ) THEN
    problemas := problemas || E'\n  - a view goal_progress nao publica monthly_contribution';
  END IF;

  -- As colunas que a tela de metas e a rota ja consomem tem que continuar de
  -- pe: CREATE OR REPLACE VIEW nao deixa remover coluna, mas deixa trocar a
  -- EXPRESSAO de uma delas -- e um corpo copiado errado passaria calado.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.goal_progress'::regclass
      AND attname = 'monthly_required' AND attnum > 0 AND NOT attisdropped
  ) THEN
    problemas := problemas || E'\n  - a view goal_progress perdeu monthly_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.goal_progress'::regclass
      AND attname = 'saved' AND attnum > 0 AND NOT attisdropped
  ) THEN
    problemas := problemas || E'\n  - a view goal_progress perdeu saved';
  END IF;

  -- O item mais caro da lista: sem security_invoker a view devolve a meta de
  -- TODO mundo para qualquer usuario logado. Ver o cabecalho da 013.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.goal_progress'::regclass
      AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    problemas := problemas || E'\n  - goal_progress ficou SEM security_invoker (vazamento: a view roda como o dono e a RLS nao se aplica)';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION E'018 aplicou parcialmente:%', problemas;
  END IF;

  RAISE NOTICE '018 conferido: monthly_contribution na tabela e na view, CHECK de positivo, e goal_progress com security_invoker.';
END $$;

-- =====================================================
-- SECAO 4: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('018', '018_goal_monthly_contribution',
        'Alvo mensal da meta (financial_goals.monthly_contribution) para a reserva entrar no "quanto posso gastar" - HMO-155', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 19. 019_cron_runs.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- PULODOGATO - O LIVRO-RAZAO DAS EXECUCOES DE CRON
-- =====================================================
-- Migration: 019_cron_runs
-- Gerado em: 2026-09-25  (HMO-156)
--
-- A PERGUNTA QUE HOJE NAO TEM RESPOSTA
-- ------------------------------------
-- "Os crons dispararam?" Ninguem consegue responder isso pelo banco.
--
-- A HMO-152 terminou com os quatro crons ARMADOS: chamada anonima devolve 401,
-- o que prova que `CRON_SECRET` existe no escopo Production. E so isso que
-- prova. O guard de Authorization vem ANTES de qualquer acesso ao banco, entao
-- a sonda para no 401 sem nunca executar o corpo da rota -- migration
-- faltando, RLS errada e erro de runtime sao todos invisiveis para ela.
--
-- O plano de verificacao da HMO-156 era olhar o EFEITO COLATERAL de cada job:
--
--   bill-alerts        -> linhas novas em bill_notifications
--   recurrence-alerts  -> bill_notifications com recurrence_id preenchido
--   recurrence-scan    -> linhas novas em detected_recurrences
--
-- Esse plano nao funciona, e da para mostrar por que com o estado fisico das
-- tabelas em producao hoje (25/09/2026), lido do catalogo -- que a RLS nao
-- filtra, ao contrario de um `count(*)` com a credencial de leitura:
--
--   relname                 relpages   bytes
--   detected_recurrences    0          0
--   bill_notifications      0          0
--   scheduled_transactions  0          0
--
-- Zero paginas: nenhuma linha jamais foi escrita em nenhuma das tres. E com o
-- dado que existe hoje elas CONTINUARAO vazias mesmo que os quatro crons
-- disparem perfeitamente -- `financial_transactions` tem uma pagina (~4 linhas)
-- e o detector exige 3 cobrancas do mesmo lojista em intervalo regular para
-- formar uma recorrencia; `scheduled_transactions` esta vazia, entao nao ha
-- vencimento para avisar.
--
-- Ou seja: os tres checks da HMO-156 voltam VAZIOS nos dois mundos -- no mundo
-- em que os crons rodaram direitinho e no mundo em que nenhum deles rodou. Um
-- teste que da o mesmo resultado nos dois casos nao e um teste. A propria
-- HMO-156 ja avisava disso na secao "a armadilha": presenca de linha prova que
-- rodou, ausencia NAO prova que falhou.
--
-- E EXATAMENTE A FALHA DA HMO-152 DE NOVO
-- ---------------------------------------
-- Tres crons responderam 503 desde que nasceram e ninguem percebeu por semanas.
-- O motivo nao foi desatencao: e que um cron MORTO e um cron OCIOSO produzem o
-- mesmo registro no banco -- nenhum. Enquanto a unica evidencia for efeito
-- colateral, essa confusao volta toda vez, porque o dia normal de um job de
-- aviso e justamente o dia em que ele nao tem nada a avisar.
--
-- Esta tabela quebra o empate. Cada execucao que passa do guard de auth grava
-- UMA linha, com o resultado que a rota devolveu -- inclusive, e principalmente,
-- quando o resultado e "nao havia nada a fazer". A partir daqui:
--
--   linha com status 'ok'  e contadores zerados -> rodou, nao tinha trabalho
--   nenhuma linha no dia                        -> a Vercel nao chamou a rota
--
-- Duas causas diferentes, dois registros diferentes. E a unica coisa que esta
-- migration faz.
--
-- =====================================================
-- O QUE ESTA TABELA NAO COBRE, E POR QUE NAO DA
-- =====================================================
-- O caminho 503 (falta variavel de ambiente) NAO e registrado aqui, e nao ha
-- como registrar: escrever nesta tabela exige SUPABASE_SERVICE_ROLE_KEY, que e
-- uma das variaveis cuja ausencia produz o 503. Um 503 por falta da chave de
-- servico nao teria com o que gravar que faltou a chave de servico.
--
-- Isso nao deixa buraco, porque esse caso ja tem deteccao propria e barata:
-- `npm run verify:crons -- <url>` pega o 503 de fora, sem precisar do segredo.
-- As duas verificacoes sao complementares e e assim que devem ser lidas:
--
--   verify:crons  -> a rota esta ARMADA? (variaveis existem, guard responde)
--   cron_runs     -> a rota FOI CHAMADA, e como terminou?
--
-- O 401 tambem nao e registrado, e aqui e de proposito: qualquer um na internet
-- bate em /api/cron/* sem header e levaria 401. Gravar isso transformaria a
-- tabela num log de varredura de porta e, pior, encheria o livro-razao de
-- linhas que nao sao execucoes de cron -- inclusive as sondas do proprio
-- verify:crons, que rodam justamente para conferir o 401.
--
-- =====================================================
-- POR QUE A LEITURA PRECISA DE UMA POLICY EXPLICITA
-- =====================================================
-- Quem vai ler esta tabela para responder a HMO-156 e a credencial de leitura
-- de producao (`paperclip_ro`). Ela NAO e dona da tabela, NAO e superuser e NAO
-- tem BYPASSRLS -- conferido no catalogo:
--
--   current_user=paperclip_ro  rolsuper=f  rolbypassrls=f
--
-- Nessa configuracao, RLS ligada com zero policies nao devolve erro: devolve
-- ZERO LINHAS, em silencio. A tabela ficaria com o livro-razao cheio e a
-- verificacao leria "nenhuma execucao" -- exatamente a conclusao errada que
-- esta migration existe para impedir, e agora com uma aparencia de prova.
-- Ja aconteceu neste projeto com `public.schema_migrations`: passei semanas
-- afirmando que o ledger estava vazio; ele sempre teve 11 linhas.
--
-- Por isso a SECAO 3 cria uma policy de SELECT nomeando o papel. E seguro dar
-- essa leitura: a tabela nao tem dado pessoal nenhum -- nome do job, horario,
-- status, duracao e contadores agregados. Nao ha user_id aqui, e isso tambem e
-- deliberado (ver SECAO 1).
--
-- A policy e condicional: o papel `paperclip_ro` existe em producao e NAO no
-- banco de validacao (sao projetos Supabase diferentes). Sem o DO/IF a
-- migration falharia com "role does not exist" no banco onde ela e testada
-- primeiro.
--
-- SEM META-COMANDO DE psql AQUI -- ESTE ARQUIVO E COLADO NO SQL EDITOR
-- ---------------------------------------------------------------------
-- Producao nao tem runner de migration: quem aplica e uma pessoa, colando o
-- arquivo no SQL Editor do Supabase, que fala Postgres e NAO e o psql. Uma
-- unica linha comecando com barra invertida vira `syntax error at or near "\"`
-- e, por estar ANTES do primeiro comando executavel, faz o arquivo INTEIRO ser
-- recusado -- nada e aplicado e o banco nao muda. Aconteceu com a 015 e a 016.
-- Ha guard no CI para isso desde entao (scripts/check-migrations-in-ci.mjs).
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 1: a tabela
-- =====================================================
-- NAO ha user_id nesta tabela, e a ausencia e o desenho.
--
-- Uma execucao de cron nao pertence a um usuario: ela varre todos. Uma linha
-- por usuario por dia transformaria o livro-razao no maior objeto do banco --
-- e, com RLS por usuario, a leitura de auditoria voltaria a enxergar zero. O
-- grao certo aqui e a EXECUCAO, e o detalhe por usuario continua onde ja esta
-- (bill_notifications, detected_recurrences), agora com uma linha de execucao
-- para ancorar a leitura.
CREATE TABLE IF NOT EXISTS public.cron_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Nome do job, igual ao ultimo segmento de `crons[].path` do vercel.json.
  job          text NOT NULL,

  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,

  -- 'ok'    -> a rota devolveu 2xx (inclusive "nao havia nada a fazer")
  -- 'error' -> a rota devolveu 5xx, ou estourou uma excecao
  status       text NOT NULL,

  -- O status HTTP que a rota devolveu. Guardado alem do `status` porque 500 por
  -- "falha ao ler" e 500 por excecao inesperada sao bugs diferentes, e a
  -- distincao se perde se so restar 'error'.
  http_status  integer,

  duration_ms  integer,

  -- O corpo que a rota devolveu, como veio. Sao contadores agregados
  -- (usuarios, avisos, detectadas, push) -- e o que responde "rodou e fez o
  -- que?" sem precisar cruzar com outra tabela. Fica jsonb e nao colunas
  -- porque cada job devolve um conjunto diferente, e acrescentar contador novo
  -- nao pode exigir migration.
  result       jsonb,

  -- Mensagem de erro quando status='error'. Texto, nao jsonb: o que interessa
  -- aqui e ser legivel numa consulta de auditoria.
  error        text,

  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cron_runs IS
  'Uma linha por execucao de cron que passou do guard de auth -- inclusive as que nao tinham nada a fazer. Existe para distinguir "rodou e estava ocioso" de "nunca foi chamado", que ate a HMO-156 produziam o mesmo registro no banco: nenhum.';

COMMENT ON COLUMN public.cron_runs.result IS
  'O corpo JSON que a rota devolveu. Contadores agregados, sem dado pessoal.';

-- O dominio de `job` segue a lista de `crons[].path` do vercel.json. Um CHECK e
-- nao uma FK porque nao ha tabela de jobs -- e o valor errado aqui e sempre
-- typo, nunca dado do usuario. Sem o CHECK, um job renomeado no vercel.json e
-- esquecido no codigo grava sob o nome antigo e a consulta de auditoria procura
-- por um nome que nunca aparece: de novo, ausencia lida como falha.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cron_runs'::regclass
      AND conname = 'cron_runs_job_check'
  ) THEN
    ALTER TABLE public.cron_runs
      ADD CONSTRAINT cron_runs_job_check
      CHECK (job IN (
        'recurrence-scan',
        'recurrence-alerts',
        'bill-alerts',
        'monthly-summary'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cron_runs'::regclass
      AND conname = 'cron_runs_status_check'
  ) THEN
    ALTER TABLE public.cron_runs
      ADD CONSTRAINT cron_runs_status_check
      CHECK (status IN ('ok', 'error'));
  END IF;
END $$;

-- Uma execucao que terminou nao pode ter terminado antes de comecar. Barato de
-- checar e, sem isso, um relogio errado produz duracao negativa que passa
-- despercebida numa media.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cron_runs'::regclass
      AND conname = 'cron_runs_finished_after_started_check'
  ) THEN
    ALTER TABLE public.cron_runs
      ADD CONSTRAINT cron_runs_finished_after_started_check
      CHECK (finished_at IS NULL OR finished_at >= started_at);
  END IF;
END $$;

-- =====================================================
-- SECAO 2: o indice da consulta de auditoria
-- =====================================================
-- Toda pergunta util aqui e "qual foi a ultima execucao deste job?" ou "o que
-- rodou nas ultimas 24h?". As duas sao (job, started_at DESC).
--
-- NAO ha indice unico nesta tabela, e isso tambem e escolha. Duas execucoes do
-- mesmo job no mesmo dia sao um EVENTO REAL no plano Hobby (+-59min de folga na
-- virada), e o livro-razao tem que registrar as duas -- e a deduplicacao do
-- efeito colateral ja mora nos indices unicos da 016 e da 017. Um indice unico
-- aqui apagaria justamente a evidencia da execucao dupla.
CREATE INDEX IF NOT EXISTS cron_runs_job_started_idx
  ON public.cron_runs (job, started_at DESC);

-- =====================================================
-- SECAO 3: RLS
-- =====================================================
-- Ligada, e sem policy para anon nem para authenticated: nenhum usuario do app
-- tem o que fazer com esta tabela. Quem escreve e o cron, com service_role, que
-- tem BYPASSRLS -- por isso a escrita nao precisa de policy.
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

-- FORCE para que nem o dono da tabela escape da RLS numa consulta futura. Sem
-- isto, "a tabela esta protegida" so vale ate alguem consultar como owner.
ALTER TABLE public.cron_runs FORCE ROW LEVEL SECURITY;

-- A leitura de auditoria. Ver o cabecalho: sem esta policy, `paperclip_ro` le
-- zero linhas SEM ERRO e a verificacao da HMO-156 conclui "nenhuma execucao"
-- com o livro-razao cheio.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paperclip_ro') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'cron_runs'
        AND policyname = 'cron_runs_auditoria_leitura'
    ) THEN
      EXECUTE 'CREATE POLICY cron_runs_auditoria_leitura ON public.cron_runs
                 FOR SELECT TO paperclip_ro USING (true)';
    END IF;

    EXECUTE 'GRANT SELECT ON public.cron_runs TO paperclip_ro';
  ELSE
    RAISE NOTICE '019: papel paperclip_ro ausente -- policy de auditoria NAO criada (esperado no banco de validacao).';
  END IF;
END $$;

COMMIT;

-- =====================================================
-- COMO CONFERIR DEPOIS DE APLICAR
-- =====================================================
-- scripts/hmo156-prove-crons.sql responde as duas perguntas separadas:
-- "a 019 esta no banco?" e "os crons dispararam?".


-- ---------------------------------------------------------------------------
-- 20. 020_group_archive_schema.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 020_group_archive_schema.sql
--
-- HMO-167: a feature "grupos arquivados" foi escrita contra um schema que
-- nunca existiu. Esta migration cria o schema que o codigo ja pede.
--
-- O que o codigo pede, e que nao existe:
--
--   expense_groups.archived_at   -- GET /api/expense-groups/archived filtra por ela
--   expense_groups.archived_by   -- e embute profiles por FK
--   expense_groups.restored_at   -- POST .../[groupId]/restore grava
--   expense_groups.restored_by   -- idem
--   group_members.archived_at
--   group_members.restored_at
--
-- As duas ultimas NAO estavam no levantamento original da issue. Elas escapam
-- do check-column-drift porque vivem dentro do objeto de um `.update({...})`, e
-- aquele guard le `.select()` e os filtros -- nao le a carga de escrita. Sem
-- elas, `POST /api/expense-groups/[groupId]/restore` responderia 500 do mesmo
-- jeito que a rota de listagem.
--
-- E o achado que muda o desenho: `group_members_status_check` so aceita
-- 'active', 'inactive', 'pending' e 'removed'. O codigo grava
-- `status = 'archived'` ao arquivar (app/api/expense-groups/[groupId]/route.ts),
-- entao essa escrita viola o CHECK -- e o erro e capturado e apenas logado
-- ("Nao falhar se nao conseguir arquivar membros"), enquanto a rota devolve
-- `success: true` e um `archived_at` que nunca foi gravado.
--
-- O efeito pratico e que SO criar as colunas nao entregaria a tela: as duas
-- consultas da rota de listagem filtram `status = 'archived'`, nenhuma linha
-- poderia ter esse valor, e a tela abriria vazia para sempre -- com cara de
-- "voce nao tem grupos arquivados", que e a mentira mais convincente que existe.
-- Por isso o CHECK entra aqui junto.
--
-- Sobre dados existentes: `expense_groups` e `group_members` estao com ZERO
-- linhas em producao (conferido em 2026-09-28 pela credencial de leitura), e as
-- colunas nascem nulas. Nao ha backfill a fazer e nao ha linha que possa
-- reprovar o CHECK novo -- ele so ACRESCENTA um valor aceito.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Colunas de arquivamento e restauracao
-- ---------------------------------------------------------------------------

ALTER TABLE public.expense_groups
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS restored_at timestamptz,
  ADD COLUMN IF NOT EXISTS restored_by uuid;

ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS restored_at timestamptz;

COMMENT ON COLUMN public.expense_groups.archived_at IS
  'Quando o grupo foi arquivado. NULL = nunca arquivado. A rota de listagem de arquivados exige NOT NULL aqui.';
COMMENT ON COLUMN public.expense_groups.archived_by IS
  'Quem arquivou. ON DELETE SET NULL: apagar o perfil de quem arquivou nao pode apagar o grupo.';

-- ---------------------------------------------------------------------------
-- 2. As FKs -- e o NOME importa
-- ---------------------------------------------------------------------------
--
-- A rota embute `archiver:profiles!expense_groups_archived_by_fkey(...)`. O
-- PostgREST resolve o embed pelo NOME da constraint, entao um nome diferente
-- aqui quebra a rota mesmo com a coluna e a FK corretas.
--
-- ON DELETE SET NULL, e nao CASCADE. `expense_groups_created_by_fkey` cascateia
-- porque grupo sem criador nao faz sentido; arquivador e outra coisa -- apagar
-- o perfil de quem arquivou nao pode levar o grupo (e o historico financeiro
-- dele) junto. O mesmo para restored_by.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expense_groups_archived_by_fkey'
  ) THEN
    ALTER TABLE public.expense_groups
      ADD CONSTRAINT expense_groups_archived_by_fkey
      FOREIGN KEY (archived_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expense_groups_restored_by_fkey'
  ) THEN
    ALTER TABLE public.expense_groups
      ADD CONSTRAINT expense_groups_restored_by_fkey
      FOREIGN KEY (restored_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. O CHECK que impedia a feature de existir
-- ---------------------------------------------------------------------------
--
-- Acrescenta 'archived' aos valores aceitos. Os quatro que ja existiam
-- continuam aceitos -- nenhuma linha de hoje deixa de passar.

ALTER TABLE public.group_members
  DROP CONSTRAINT IF EXISTS group_members_status_check;

ALTER TABLE public.group_members
  ADD CONSTRAINT group_members_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'pending'::text, 'removed'::text, 'archived'::text]));

-- ---------------------------------------------------------------------------
-- 4. Coerencia entre o par de colunas -- em UMA direcao so
-- ---------------------------------------------------------------------------
--
-- O estado que precisa ser proibido e `archived_by` preenchido com
-- `archived_at` NULL: ali o grupo desaparece das DUAS telas -- da ativa porque
-- is_active = false, e da de arquivados porque a rota filtra por archived_at
-- NOT NULL. Ninguem recebe erro; o grupo simplesmente deixa de ser alcancavel.
--
-- A direcao contraria (`archived_at` preenchido, `archived_by` NULL) tem que
-- ser PERMITIDA, e a primeira versao desta migration errava exatamente isso.
-- Ela usava `(archived_at IS NULL) = (archived_by IS NULL)`, o par simetrico, e
-- o teste 020_group_archive_test.sql reprovou: o `ON DELETE SET NULL` da FK
-- ESCREVE a linha, o CHECK e avaliado nessa escrita, e o DELETE do perfil
-- falhava com check_violation. O efeito seria apagar um perfil que ja arquivou
-- um grupo virar impossivel -- o que hoje nenhuma rota faz (o plano de
-- lib/account-reset.ts nao inclui profiles), mas apagar um usuario pelo painel
-- do Supabase cascateia para profiles e cairia aqui.
--
-- Entao: "arquivado por alguem que ja saiu" e um estado legitimo. A tela tem
-- que aguentar o embed do arquivador vindo nulo.

ALTER TABLE public.expense_groups
  DROP CONSTRAINT IF EXISTS expense_groups_archived_par_check;

ALTER TABLE public.expense_groups
  ADD CONSTRAINT expense_groups_archived_par_check
  CHECK (archived_by IS NULL OR archived_at IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 5. Indice da listagem
-- ---------------------------------------------------------------------------
--
-- Indice PARCIAL de proposito: arquivado e a minoria das linhas, e nenhum
-- upsert usa essas colunas como arbitro de ON CONFLICT -- que e o caso em que
-- indice parcial nao serve (o supabase-js nao manda o predicado).

CREATE INDEX IF NOT EXISTS idx_expense_groups_arquivados
  ON public.expense_groups (archived_at DESC)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_group_members_arquivados
  ON public.group_members (group_id, user_id)
  WHERE status = 'archived';

COMMIT;


-- ---------------------------------------------------------------------------
-- 21. 021_investments.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 021_investments.sql
--
-- HMO-169: a tela de investimentos. Quatro componentes de components/ estao
-- escritos e sem importador desde a HMO-163 porque a TELA deles nao existe, e a
-- tela nao existia porque nao ha de onde o dado vir. Esta migration cria de
-- onde.
--
-- DECISAO DE ESCOPO (HMO-141, item 1 e 2): carteira MANUAL, sem cotacao
-- automatica.
--
--   O "acompanhamento de investimentos" que a pagina de Planos vende pode ser
--   duas coisas de tamanhos muito diferentes: carteira lancada a mao, ou
--   integracao com corretora. A segunda depende de contrato, chave e termo de
--   uso de uma fonte de preco (B3/brapi/Alpha Vantage) -- decisao de produto com
--   custo, nao de codigo. A primeira nao depende de ninguem e ja entrega o
--   numero que o usuario quer ver.
--
--   Por isso o preco atual mora numa COLUNA desta tabela
--   (`investment_assets.current_price`), informada pelo usuario, com a data em
--   que ele informou (`current_price_at`). Quando houver fonte de cotacao, ela
--   passa a escrever nessa mesma coluna e nada mais muda -- o calculo da
--   carteira le a coluna, nao a origem dela.
--
--   O que NAO entra aqui: `/dashboard/trading` ("sinais de trading em tempo
--   real"). Recomendacao de investimento tem implicacao regulatoria (CVM) e
--   continua no EmDesenvolvimento de proposito -- ver HMO-141, item 3.
--
-- SINAL DOS VALORES -- LEIA ANTES DE SOMAR QUALQUER COISA
-- ------------------------------------------------------
-- Em `financial_transactions` a despesa e gravada NEGATIVA, e o sinal carrega o
-- significado. Aqui e o OPOSTO: `quantity`, `unit_price` e `fees` sao sempre
-- POSITIVOS (ha CHECK para os tres), e quem carrega a direcao e a coluna `kind`.
-- Uma venda nao e "quantidade negativa": e `kind = 'sell'` com quantidade
-- positiva.
--
-- A escolha e deliberada. Preco medio e o numero central desta tela, e ele e uma
-- media PONDERADA de compras; misturar venda na ponderacao pelo sinal daria um
-- preco medio errado sem erro nenhum aparecer. Com `kind`, a compra pondera, a
-- venda abate quantidade e o provento nem entra no custo.
--
-- Consequencia pratica para quem escrever consulta nova: um `SUM(quantity)`
-- cru nesta tabela nao e a posicao do usuario -- ele soma compra, venda e
-- provento no mesmo balde. A posicao sai de lib/investments.ts, que e onde o
-- `kind` e lido, e tem suite propria no db-verify.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).

BEGIN;

-- =====================================================
-- SECAO 1: investment_assets -- o ativo que o usuario acompanha
-- =====================================================
--
-- POR USUARIO, e nao catalogo global como `transaction_categories`.
--
-- Catalogo global exigiria manter a lista de tickers da B3 dentro do
-- repositorio e uma migration a cada IPO -- e a primeira acao que faltasse
-- deixaria o usuario sem poder lancar o que ele tem. O custo de ser por usuario
-- e a mesma PETR4 existir em N linhas; como ninguem cruza carteira de usuarios
-- diferentes neste app, esse custo nao compra nada de volta.

CREATE TABLE IF NOT EXISTS public.investment_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Guardado em MAIUSCULA, com o CHECK garantindo. Sem isso "petr4" e "PETR4"
  -- sao duas linhas para o UNIQUE abaixo, e a carteira mostra o mesmo ativo
  -- duas vezes com metade da posicao em cada.
  symbol text NOT NULL,
  name text NOT NULL,

  -- Os quatro tipos sao os que components/PortfolioTable.tsx sabe rotular e os
  -- que components/charts/AssetAllocationChart.tsx sabe colorir. Acrescentar um
  -- quinto valor aqui sem tocar nos dois componentes produz badge com o nome
  -- cru e fatia cinza no grafico -- sem erro.
  type text NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',

  -- Preco informado pelo usuario. NULL = nunca informou, e isso NAO e zero:
  -- ver o cabecalho de lib/investments.ts para o que a tela faz nesse caso.
  current_price numeric(20,8),
  current_price_at timestamp with time zone,

  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT investment_assets_symbol_maiusculo
    CHECK (symbol = upper(symbol) AND btrim(symbol) = symbol AND length(symbol) BETWEEN 1 AND 16),
  CONSTRAINT investment_assets_name_nao_vazio
    CHECK (length(btrim(name)) > 0),
  CONSTRAINT investment_assets_type_check
    CHECK (type IN ('stock', 'fii', 'fixed_income', 'international')),
  CONSTRAINT investment_assets_currency_check
    CHECK (currency = upper(currency) AND length(currency) = 3),
  CONSTRAINT investment_assets_current_price_positivo
    CHECK (current_price IS NULL OR current_price > 0),

  -- Preco e data do preco andam juntos nas duas direcoes. Um preco sem data e
  -- um numero que o usuario nao sabe de quando e -- e ele vai tomar decisao
  -- olhando o "Valor Atual" que sai dai. Uma data sem preco nao significa nada.
  CONSTRAINT investment_assets_preco_par_check
    CHECK ((current_price IS NULL) = (current_price_at IS NULL))
);

-- UNIQUE CHEIO, nao parcial, e de proposito: e ele que serve de arbitro do
-- ON CONFLICT quando a rota faz upsert de ativo. Indice parcial nao serve --
-- o supabase-js nao manda o predicado e o upsert quebra em 100% das chamadas.
CREATE UNIQUE INDEX IF NOT EXISTS investment_assets_user_symbol_unico
  ON public.investment_assets (user_id, symbol);

-- Chave alternativa (id, user_id). Ela existe para a FK COMPOSTA da secao 2 --
-- ver la o buraco que ela fecha.
--
-- NAO da para usar o `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` que o resto
-- deste arquivo usa para ficar re-executavel: a FK da secao 2 DEPENDE do indice
-- desta constraint, e o DROP falha com "other objects depend on it" na segunda
-- passada. Um `DROP ... CASCADE` derrubaria a FK junto e a recriaria so por
-- sorte de ordem -- e uma migration que apaga a propria protecao no meio do
-- caminho e pior do que uma que nao e idempotente. Entao: cria se faltar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.investment_assets'::regclass
       AND conname = 'investment_assets_id_user_unico'
  ) THEN
    ALTER TABLE public.investment_assets
      ADD CONSTRAINT investment_assets_id_user_unico UNIQUE (id, user_id);
  END IF;
END $$;

COMMENT ON TABLE public.investment_assets IS
  'Ativo que o usuario acompanha na carteira. Por usuario, nao catalogo global - HMO-169.';
COMMENT ON COLUMN public.investment_assets.current_price IS
  'Preco atual informado A MAO pelo usuario (nao ha fonte de cotacao contratada - HMO-141 item 2). NULL = sem preco: a tela mostra a posicao pelo custo e avisa, em vez de fingir lucro zero.';
COMMENT ON COLUMN public.investment_assets.current_price_at IS
  'Quando o preco foi informado. Anda em par com current_price (CHECK).';

-- =====================================================
-- SECAO 2: investment_transactions -- compra, venda e provento
-- =====================================================

CREATE TABLE IF NOT EXISTS public.investment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL,

  -- 'buy'      -- quantidade entra na posicao e pondera o preco medio
  -- 'sell'     -- quantidade sai da posicao; NAO mexe no preco medio (custo
  --               medio e o metodo usado no Brasil)
  -- 'dividend' -- nao mexe em quantidade nem em custo; soma em proventos.
  --               Para provento, `quantity` e a quantidade de cotas que
  --               receberam e `unit_price` e o valor POR COTA, entao o total
  --               continua sendo quantity * unit_price como nos outros dois.
  kind text NOT NULL,

  quantity numeric(20,8) NOT NULL,
  unit_price numeric(20,8) NOT NULL,

  -- Corretagem e emolumentos. Entram no custo na compra e saem do valor
  -- recebido na venda -- nunca somam na posicao.
  fees numeric(14,2) NOT NULL DEFAULT 0,

  trade_date date NOT NULL,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),

  -- Ver o cabecalho do arquivo: os tres sao POSITIVOS. O sinal nao carrega
  -- significado nesta tabela.
  CONSTRAINT investment_transactions_kind_check
    CHECK (kind IN ('buy', 'sell', 'dividend')),
  CONSTRAINT investment_transactions_quantity_positiva
    CHECK (quantity > 0),
  CONSTRAINT investment_transactions_unit_price_positivo
    CHECK (unit_price > 0),
  CONSTRAINT investment_transactions_fees_nao_negativa
    CHECK (fees >= 0),

  -- Lancamento no futuro e quase sempre erro de digitacao no ano, e ele
  -- contamina o grafico de evolucao com uma barra solitaria em 2035.
  CONSTRAINT investment_transactions_trade_date_nao_futura
    CHECK (trade_date <= (now() AT TIME ZONE 'UTC')::date + 1),

  -- FK COMPOSTA, e aqui esta a razao de existir o UNIQUE (id, user_id) acima.
  --
  -- Com uma FK simples para investment_assets(id), a politica de INSERT abaixo
  -- (user_id = auth.uid()) NAO impediria o usuario A de pendurar um lancamento
  -- no asset_id do usuario B: o WITH CHECK olha a coluna user_id da LINHA NOVA,
  -- que esta correta, e a FK so exige que o ativo exista. A RLS de SELECT
  -- esconde o ativo de B, mas esconder na leitura nao impede a escrita -- A
  -- gravaria linha de dentro da carteira de B, e a soma de proventos de B
  -- mudaria sem B fazer nada.
  --
  -- A FK composta resolve isso de forma declarativa: o par (asset_id, user_id)
  -- tem que existir junto na tabela de ativos. Trigger faria o mesmo, mas
  -- trigger sob RLS foi exatamente o que as migrations 003 e 004 existiram para
  -- consertar.
  CONSTRAINT investment_transactions_asset_do_mesmo_dono
    FOREIGN KEY (asset_id, user_id)
    REFERENCES public.investment_assets (id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_investment_transactions_user_asset_data
  ON public.investment_transactions (user_id, asset_id, trade_date);

-- O grafico de evolucao le a carteira inteira em ordem de data.
CREATE INDEX IF NOT EXISTS idx_investment_transactions_user_data
  ON public.investment_transactions (user_id, trade_date);

COMMENT ON TABLE public.investment_transactions IS
  'Compra, venda e provento de um ativo. Valores SEMPRE positivos: a direcao esta em kind, nao no sinal - HMO-169.';
COMMENT ON COLUMN public.investment_transactions.quantity IS
  'Sempre positiva. Em kind=dividend e a quantidade de cotas que recebeu o provento.';
COMMENT ON COLUMN public.investment_transactions.unit_price IS
  'Sempre positivo. Em kind=dividend e o valor POR COTA.';

-- =====================================================
-- SECAO 3: RLS
-- =====================================================

ALTER TABLE public.investment_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS investment_assets_select ON public.investment_assets;
CREATE POLICY investment_assets_select ON public.investment_assets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS investment_assets_insert ON public.investment_assets;
CREATE POLICY investment_assets_insert ON public.investment_assets
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Sem troca de dono na atualizacao: o USING olha a linha velha e o WITH CHECK a
-- nova, e exigir auth.uid() nos dois e o que impede mover o ativo (com todo o
-- historico pendurado nele pela FK composta) para outra conta.
DROP POLICY IF EXISTS investment_assets_update ON public.investment_assets;
CREATE POLICY investment_assets_update ON public.investment_assets
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS investment_assets_delete ON public.investment_assets;
CREATE POLICY investment_assets_delete ON public.investment_assets
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS investment_transactions_select ON public.investment_transactions;
CREATE POLICY investment_transactions_select ON public.investment_transactions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS investment_transactions_insert ON public.investment_transactions;
CREATE POLICY investment_transactions_insert ON public.investment_transactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS investment_transactions_update ON public.investment_transactions;
CREATE POLICY investment_transactions_update ON public.investment_transactions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS investment_transactions_delete ON public.investment_transactions;
CREATE POLICY investment_transactions_delete ON public.investment_transactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =====================================================
-- SECAO 4: carimbo do updated_at
-- =====================================================
-- SECURITY INVOKER e search_path fixo, no padrao da 011 -- e nao a
-- `update_updated_at_column()` legada do 001, que foi a familia de trigger que
-- as migrations 003 e 004 consertaram.

CREATE OR REPLACE FUNCTION public.investment_assets_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_investment_assets_touch ON public.investment_assets;
CREATE TRIGGER trg_investment_assets_touch
  BEFORE UPDATE ON public.investment_assets
  FOR EACH ROW EXECUTE FUNCTION public.investment_assets_touch_updated_at();

-- =====================================================
-- SECAO 5: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes destas tabelas existirem, e
-- ALL TABLES e uma fotografia do momento -- nao alcanca objeto criado depois.
REVOKE ALL ON public.investment_assets FROM anon;
REVOKE ALL ON public.investment_transactions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investment_assets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investment_transactions TO authenticated;

-- =====================================================
-- SECAO 6: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('021', '021_investments',
        'Carteira de investimentos manual: investment_assets + investment_transactions - HMO-169', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 22. 022_currency.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 022_currency.sql
--
-- HMO-171, partes 2 e 3: moeda por conta, moeda por lancamento, e resultado
-- separado por moeda.
--
-- As duas decisoes do Helio na issue (interaction respondida em 2026-09-29):
--
--   "os-dois"    -- a CONTA define a moeda padrao dela, e o LANCAMENTO pode
--                   sobrepor. Por isso ha coluna nos dois lugares, e nao num so.
--   "ficam-brl"  -- lancamento que ja existe continua em BRL. A moeda oficial
--                   vale para o que for criado a partir de agora. E por isso que
--                   a coluna nasce NOT NULL DEFAULT 'BRL': o backfill do
--                   historico e exatamente o default, nao ha reescrita de
--                   historico, e nao existe linha sem moeda em nenhum momento.
--
-- ===========================================================================
-- O PERIGO QUE ESTA MIGRATION EXISTE PARA FECHAR
-- ===========================================================================
-- Guardar a moeda e a parte facil. O risco mora nas views de relatorio do 008,
-- que somam `amount` sem saber de moeda:
--
--   SUM(ABS(amount)) FILTER (WHERE transaction_type = 'expense')
--
-- No mundo de uma moeda isso e o gasto do mes. No minuto em que existir um
-- lancamento em dolar, esse mesmo SUM soma 1000 reais com 180 dolares e devolve
-- 1180 -- um numero que nao esta em moeda nenhuma, com cara de total. Nao ha
-- erro, nao ha NULL, nao ha nada para um teste de "a consulta funciona" pegar:
-- o fluxo de caixa simplesmente passa a mentir, e para MAIS, que e o lado do
-- qual ninguem reclama.
--
-- Nao existe conversao possivel aqui: o app nao tem cotacao de cambio, e o
-- pedido da issue e justamente MOSTRAR SEPARADO em vez de converter. Entao a
-- moeda entra no GRAO das tres views. Cada linha passa a ser de uma unica
-- moeda, e todo numero que sai delas esta em exatamente uma moeda -- o que era
-- verdade por acidente antes, e passa a ser verdade por construcao.
--
-- POR QUE A COLUNA `currency` VAI NO FIM DA LISTA DAS VIEWS
-- ---------------------------------------------------------
-- `CREATE OR REPLACE VIEW` so aceita colunas NOVAS no fim; mudar a posicao de
-- uma existente exige DROP. E `DROP ... CASCADE` aqui levaria as tres views
-- juntas mais os GRANTs e o `security_invoker` de cada uma, e um CASCADE derruba
-- tambem o que eu nao listei. Fica no fim de proposito: e feio e e reversivel.
--
-- POR QUE `planned_vs_actual` MUDA SEM TER PEDIDO NADA
-- ---------------------------------------------------
-- Ela le `monthly_cash_flow` por `LEFT JOIN LATERAL` sem agregado e sem LIMIT.
-- Enquanto a view tinha uma linha por mes, isso devolvia uma linha. Com a moeda
-- no grao passa a devolver UMA POR MOEDA, e o LATERAL multiplica a linha de
-- `chaves`: o previsto x realizado do mes apareceria duas vezes, cada uma com o
-- previsto inteiro repetido, e o estouro de orcamento dobraria. Por isso a moeda
-- entra no grao dela tambem, e o LATERAL passa a casar por moeda.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. O catalogo de moedas, em SQL
-- ---------------------------------------------------------------------------
-- A fonte de verdade e `MOEDAS` em lib/dinheiro.ts -- e ela que decide simbolo e
-- numero de casas, e e ela que o `<select>` oferece. Esta lista e a mesma, do
-- lado do banco, para que um INSERT com moeda que o app nao conhece seja
-- recusado em vez de virar uma linha que nenhuma tela sabe formatar
-- (`moedaPorCodigo` cai no padrao, ou seja: um lancamento em CZK apareceria como
-- reais, silenciosamente).
--
-- Duas copias da mesma lista sao duas listas diferentes no primeiro dia em que
-- alguem acrescentar uma moeda. Quem protege daqui em diante e o ultimo caso de
-- `scripts/test-dinheiro.mjs`: ele le ESTE arquivo, acha os tres CHECK e compara
-- codigo por codigo com `MOEDAS`. Fica vermelho nas duas direcoes -- moeda que
-- sobra no SQL e moeda que sobra no TypeScript.
--
-- Ele mora naquela suite, e nao num teste de banco, porque o workflow `dinheiro`
-- roda em todo PR sem filtro de path: a divergencia aparece no mesmo PR que a
-- causa. O db-verify e filtrado por `database/**` e nao veria um PR que so mexe
-- em lib/dinheiro.ts.

-- O CHECK de cada tabela vem logo DEPOIS do respectivo ADD COLUMN, nunca antes:
-- um CHECK sobre coluna que ainda nao existe reprova a migration inteira
-- ("column \"currency\" does not exist"), e como tudo aqui esta num BEGIN, o
-- lote inteiro volta atras -- o modo mais barato de nao aplicar nada e achar que
-- aplicou.

-- ---------------------------------------------------------------------------
-- 2. Moeda da conta  (o padrao que os lancamentos dela herdam)
-- ---------------------------------------------------------------------------

ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL';

COMMENT ON COLUMN public.financial_accounts.currency IS
  'Moeda desta conta (ISO 4217). E o padrao sugerido a cada lancamento dela; o lancamento pode sobrepor. Toda conta que ja existia e BRL.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'financial_accounts_currency_check'
  ) THEN
    ALTER TABLE public.financial_accounts
      ADD CONSTRAINT financial_accounts_currency_check
      CHECK (currency IN ('BRL','USD','EUR','GBP','CHF','CAD','AUD','ARS','CLP','UYU','PYG','JPY','CNY'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Moeda do lancamento  (a que vale para o dinheiro)
-- ---------------------------------------------------------------------------
-- Esta e a coluna que manda. A da conta e sugestao; esta e o que o relatorio
-- soma. Ter as duas e o que a resposta "os-dois" pede, e a razao de o
-- lancamento nao ler a moeda da conta por JOIN na hora do relatorio: uma conta
-- que troca de moeda reescreveria a moeda de todo lancamento passado dela.

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL';

COMMENT ON COLUMN public.financial_transactions.currency IS
  'Moeda deste lancamento (ISO 4217). Sobrepoe a moeda da conta. E a coluna que as views de relatorio agrupam -- nunca somar amount de moedas diferentes.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_currency_check'
  ) THEN
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_currency_check
      CHECK (currency IN ('BRL','USD','EUR','GBP','CHF','CAD','AUD','ARS','CLP','UYU','PYG','JPY','CNY'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Moeda da conta prevista
-- ---------------------------------------------------------------------------
-- `scheduled_transactions` entra junto porque `planned_vs_actual` cruza os dois
-- lados por mes. Sem moeda no previsto, o realizado em dolar nao teria previsto
-- com que casar e apareceria como "gastou 180 sem ter previsto nada" -- um
-- estouro de 100% inventado pela ausencia da coluna, nao por gasto nenhum.

ALTER TABLE public.scheduled_transactions
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL';

COMMENT ON COLUMN public.scheduled_transactions.currency IS
  'Moeda desta conta prevista (ISO 4217). Herdada da conta na criacao. Casa com financial_transactions.currency no previsto x realizado.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_transactions_currency_check'
  ) THEN
    ALTER TABLE public.scheduled_transactions
      ADD CONSTRAINT scheduled_transactions_currency_check
      CHECK (currency IN ('BRL','USD','EUR','GBP','CHF','CAD','AUD','ARS','CLP','UYU','PYG','JPY','CNY'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. As views de relatorio, com a moeda no grao
-- ---------------------------------------------------------------------------
-- O resto de cada view e identico ao 008 de proposito: o ABS() com filtro por
-- `transaction_type` (despesa e gravada negativa, e um SUM cru devolveria -800
-- para quem gastou 800), o `transfer` de fora, o grao por (user_id, group_id).
-- A unica diferenca e a moeda -- reescrever mais do que isso aqui seria mudar
-- dois numeros ao mesmo tempo e nao saber qual deles quebrou.

CREATE OR REPLACE VIEW public.category_monthly_totals AS
  SELECT
    t.user_id,
    t.group_id,
    date_trunc('month', t.transaction_date)::date AS month,
    t.category_id,
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'expense'), 0)::numeric(15,2) AS expense,
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'income'), 0)::numeric(15,2) AS income,
    (COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'income'), 0)
     - COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'expense'), 0))::numeric(15,2) AS net,
    COUNT(*) FILTER (WHERE t.transaction_type IN ('expense', 'income')) AS transaction_count,
    t.currency
  FROM public.financial_transactions t
  WHERE t.transaction_type IN ('expense', 'income')
  GROUP BY t.user_id, t.group_id, date_trunc('month', t.transaction_date)::date, t.category_id, t.currency;

COMMENT ON VIEW public.category_monthly_totals IS
  'Entrada e saida por categoria, mes e MOEDA. Ignora transfer. Cada linha esta em uma moeda so: somar linhas de moedas diferentes nao da numero nenhum.';

CREATE OR REPLACE VIEW public.monthly_cash_flow AS
  SELECT
    c.user_id,
    c.group_id,
    c.month,
    SUM(c.income)::numeric(15,2) AS income,
    SUM(c.expense)::numeric(15,2) AS expense,
    SUM(c.net)::numeric(15,2) AS net,
    SUM(c.transaction_count) AS transaction_count,
    c.currency
  FROM public.category_monthly_totals c
  GROUP BY c.user_id, c.group_id, c.month, c.currency;

COMMENT ON VIEW public.monthly_cash_flow IS
  'Entrada, saida e resultado por mes e MOEDA. Rollup de category_monthly_totals para nao ter duas versoes do mesmo numero. Um mes com duas moedas tem DUAS linhas -- quem le precisa agrupar, nao somar.';

-- `planned_vs_actual`: a moeda entra nas chaves e nos dois LATERAL.
--
-- O `IS NOT DISTINCT FROM` do group_id continua sendo o que faz o lado pessoal
-- casar (group_id e NULL na maioria das linhas, e `NULL = NULL` e NULL, nao
-- verdadeiro -- com `=` a tela mostraria previsto e realizado em meses
-- separados, cada um com o outro lado zerado). A moeda e NOT NULL nas duas
-- tabelas, entao ela pode casar por `=` mesmo; usa `IS NOT DISTINCT FROM` por
-- simetria com a linha de cima, que custa nada e nao convida ninguem a
-- perguntar por que os dois criterios ao lado sao diferentes.
CREATE OR REPLACE VIEW public.planned_vs_actual AS
  WITH chaves AS (
    SELECT s.user_id, s.group_id, date_trunc('month', s.due_date)::date AS month, s.currency
    FROM public.scheduled_transactions s
    UNION
    SELECT t.user_id, t.group_id, date_trunc('month', t.transaction_date)::date AS month, t.currency
    FROM public.financial_transactions t
    WHERE t.transaction_type IN ('expense', 'income')
  )
  SELECT
    k.user_id,
    k.group_id,
    k.month,
    COALESCE(p.planned_expense, 0)::numeric(15,2) AS planned_expense,
    COALESCE(p.planned_income, 0)::numeric(15,2)  AS planned_income,
    COALESCE(a.income, 0)::numeric(15,2)  AS actual_income,
    COALESCE(a.expense, 0)::numeric(15,2) AS actual_expense,
    -- positivo = gastou mais do que tinha previsto
    (COALESCE(a.expense, 0) - COALESCE(p.planned_expense, 0))::numeric(15,2) AS expense_variance,
    COALESCE(p.pending_count, 0) AS pending_count,
    COALESCE(p.overdue_count, 0) AS overdue_count,
    k.currency
  FROM chaves k
  LEFT JOIN LATERAL (
    SELECT
      SUM(s.amount) FILTER (WHERE COALESCE(r.transaction_type, 'expense') = 'expense') AS planned_expense,
      SUM(s.amount) FILTER (WHERE COALESCE(r.transaction_type, 'expense') = 'income')  AS planned_income,
      COUNT(*) FILTER (WHERE s.status = 'pending') AS pending_count,
      COUNT(*) FILTER (WHERE s.status = 'pending' AND s.due_date < CURRENT_DATE) AS overdue_count
    FROM public.scheduled_transactions s
    LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id
    WHERE s.user_id = k.user_id
      AND s.group_id IS NOT DISTINCT FROM k.group_id
      AND date_trunc('month', s.due_date)::date = k.month
      AND s.currency IS NOT DISTINCT FROM k.currency
      -- cancelada nunca foi previsao de verdade
      AND s.status <> 'cancelled'
  ) AS p ON TRUE
  LEFT JOIN LATERAL (
    SELECT f.income, f.expense
    FROM public.monthly_cash_flow f
    WHERE f.user_id = k.user_id
      AND f.group_id IS NOT DISTINCT FROM k.group_id
      AND f.month = k.month
      AND f.currency IS NOT DISTINCT FROM k.currency
  ) AS a ON TRUE;

COMMENT ON VIEW public.planned_vs_actual IS
  'Previsto x realizado por mes e MOEDA. O LATERAL casa a moeda tambem: sem isso um mes com duas moedas duplicaria a linha e repetiria o previsto inteiro em cada uma.';

-- ---------------------------------------------------------------------------
-- 6. security_invoker, de novo, nas tres
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` preserva as reloptions da view, entao em teoria o
-- `security_invoker` do 008 continua valendo. Esta secao existe porque "em
-- teoria" e o que separa esta migration de um vazamento de dado entre usuarios:
-- sem `security_invoker`, a view roda com os direitos do DONO, a RLS de
-- `financial_transactions` nao se aplica, e `monthly_cash_flow` devolve a renda
-- e o gasto mensal de TODOS os usuarios do app para qualquer um logado. Repetir
-- o ALTER e barato; descobrir que a preservacao nao valia, nao.

ALTER VIEW public.category_monthly_totals SET (security_invoker = true);
ALTER VIEW public.monthly_cash_flow SET (security_invoker = true);
ALTER VIEW public.planned_vs_actual SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 7. GRANTs
-- ---------------------------------------------------------------------------
-- Mesma razao da secao 6: o 008 ja concedeu, e `CREATE OR REPLACE` preserva.
-- Idempotente e barato.

REVOKE ALL ON public.category_monthly_totals FROM anon;
REVOKE ALL ON public.monthly_cash_flow FROM anon;
REVOKE ALL ON public.planned_vs_actual FROM anon;

GRANT SELECT ON public.category_monthly_totals TO authenticated;
GRANT SELECT ON public.monthly_cash_flow TO authenticated;
GRANT SELECT ON public.planned_vs_actual TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Indice para a leitura por moeda
-- ---------------------------------------------------------------------------
-- As views agrupam por (user_id, transaction_date, currency). O indice existente
-- e por (user_id, transaction_date); a moeda no fim evita reler a linha para
-- descobrir a moeda no agrupamento.
--
-- Indice CHEIO, sem predicado: um indice parcial nao serve de arbitro de
-- ON CONFLICT (o `onConflict` do supabase-js nao manda o predicado), e embora
-- ninguem faca upsert nesta tabela hoje, um indice parcial aqui seria uma
-- armadilha guardada para quem fizer.

CREATE INDEX IF NOT EXISTS idx_financial_transactions_user_date_currency
  ON public.financial_transactions (user_id, transaction_date, currency);

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('022', '022_currency',
        'Moeda por conta e por lancamento, e moeda no grao das views de relatorio - HMO-171', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 23. 023_categoria_de_transferencia.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 023_categoria_de_transferencia.sql
--
-- HMO-162: destrava a transferencia entre contas, que esta 500 em producao
-- desde que a tela subiu (HMO-164).
--
-- ===========================================================================
-- O QUE ESTA QUEBRADO
-- ===========================================================================
-- `financial_transactions.category_id` e NOT NULL, e transferencia entre
-- contas proprias nao tem categoria. A HMO-164 resolveu isso criando uma
-- categoria reservada SOB DEMANDA, no primeiro uso, de dentro da rota:
--
--     SELECT id FROM transaction_categories WHERE name = 'Transferência entre contas'
--     -- nao achou? entao:
--     INSERT INTO transaction_categories (...) VALUES (...)
--
-- As duas metades falham, e falham para sempre:
--
--   1. o INSERT nao tem como acontecer. `transaction_categories` e tabela de
--      REFERENCIA: o 002_rls_lockdown so deu `GRANT SELECT` a anon, e a unica
--      policy da tabela e `transaction_categories_read`, FOR SELECT. Nao ha
--      GRANT de INSERT nem policy de INSERT para `authenticated` -- de
--      proposito, porque a tabela e global, e uma escrita ali apareceria na
--      tela de TODO mundo. O insert volta 42501, nao 23505, entao nem o ramo
--      de "outro pedido criou primeiro" pega;
--
--   2. o SELECT tambem nao acharia a linha se ela existisse, porque a policy
--      de leitura e `USING (is_active = TRUE)` e a categoria reservada nasce
--      `is_active = FALSE` -- justamente para ficar fora dos seletores.
--
-- Resultado: `categoriaDaTransferencia` devolve NULL em 100% das chamadas, a
-- rota responde 500 "Não foi possível registrar a transferência", e nenhuma
-- transferencia jamais foi gravada. Medido em producao em 2026-09-29, com a
-- conta de teste, pela rota publicada.
--
-- Por que passou por todo o CI: os testes da HMO-164 sao sobre
-- `pernasDaTransferencia` -- funcao pura, que devolve as duas pernas certas e
-- continua devolvendo. O defeito nao esta na aritmetica; esta na permissao de
-- uma tabela que nenhum teste de unidade toca. So um POST de verdade contra o
-- banco de verdade encontra isso.
--
-- ===========================================================================
-- O CONSERTO
-- ===========================================================================
-- A categoria reservada vira SEED, como as outras doze do 001_baseline, e uma
-- segunda policy de leitura a torna visivel. A rota passa a so LER.
--
-- Por que nao abrir INSERT para `authenticated` em vez disso: a tabela nao tem
-- `user_id`. Quem escreve nela escreve para todos os usuarios do app. Dar essa
-- caneta a qualquer portador de sessao para resolver um problema de seed
-- trocaria um 500 honesto por uma porta que ninguem ia lembrar de fechar.
--
-- Por que a policy nova em vez de afrouxar a que existe: `is_active = TRUE` e o
-- que mantem categoria desativada fora do app inteiro. A policy nova adiciona
-- exatamente as linhas reservadas -- `is_active = FALSE` E o nome exato -- e
-- policies do mesmo comando sao OR, entao nada mais muda de visibilidade.
--
-- E a linha continua fora dos seletores: `/api/personal-finance/categories`
-- filtra `is_active = TRUE` no proprio SELECT, nao confia so na RLS.
-- =====================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A categoria reservada
-- ---------------------------------------------------------------------------
-- Id fixo para que o teste e qualquer auditoria futura tenham onde ancorar.
-- O `WHERE NOT EXISTS` olha (service_id, name), que e a UNIQUE da tabela
-- (`unique_category_per_service`): um `ON CONFLICT (id)` sozinho deixaria a
-- segunda passada estourar por nome duplicado se a linha ja existisse com
-- outro id -- e e isso que torna esta migration re-executavel.
INSERT INTO public.transaction_categories
  (id, service_id, name, description, icon, color_hex, is_expense, is_active)
SELECT
  '3f2d1c4a-9b6e-4d80-a1f5-2c7e8b30d941',
  '8730cd96-d656-4c48-863e-673e1016a832',
  'Transferência entre contas',
  'Reservada para as duas pernas de uma transferência. Não aparece nos seletores.',
  'arrow-right-left',
  '#0EA5E9',
  FALSE,
  FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM public.transaction_categories
   WHERE service_id = '8730cd96-d656-4c48-863e-673e1016a832'
     AND name = 'Transferência entre contas'
);

-- ---------------------------------------------------------------------------
-- A policy que torna a linha legivel para quem esta logado
-- ---------------------------------------------------------------------------
-- Estritamente aditiva: o predicado exige `is_active = FALSE`, entao ela nao
-- tem intersecao com `transaction_categories_read` (`is_active = TRUE`).
--
-- `anon` fica de fora. A tela de transferencia exige sessao, e a tabela de
-- referencia so e lida sem login para montar seletor -- onde esta linha nao
-- entra.
DROP POLICY IF EXISTS transaction_categories_read_reservada
  ON public.transaction_categories;

CREATE POLICY transaction_categories_read_reservada
  ON public.transaction_categories
  FOR SELECT TO authenticated
  USING (is_active = FALSE AND name = 'Transferência entre contas');

COMMIT;

-- =====================================================
-- DEPOIS DE APLICAR
-- =====================================================
-- A transferencia volta a funcionar com o codigo que ja esta no ar: a rota
-- procura a categoria por (service_id, name), passa a achar, e nunca chega no
-- INSERT que nao tem permissao. Nao ha deploy a esperar.
-- =====================================================


-- ---------------------------------------------------------------------------
-- 24. 024_edicao_de_despesa_de_grupo.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 024_edicao_de_despesa_de_grupo.sql
--
-- HMO-176: editar uma despesa que ja esta num grupo nao refaz a divisao.
--
-- Os dois estragos, reproduzidos num Postgres 17 com a cadeia 001 -> 023 em
-- cima da fixture de database/tests/group_settlement_test.sql:
--
--   1. MUDAR O VALOR DEIXA AS PARTES VELHAS.
--      Hotel de R$ 300 num grupo de 3 vira R$ 600. As partes continuam R$ 100
--      cada, e a soma dos saldos do grupo -- que TEM que ser zero -- vai para
--      R$ 300. O grupo para de fechar. Medido antes desta migration:
--          soma dos saldos = 300.00
--
--   2. TROCAR O GRUPO COBRA NOS DOIS.
--      Mover o hotel de "Viagem" para "Casa" cria a divisao no grupo novo e
--      NAO apaga a do velho. Medido antes desta migration:
--          Casa   1 parte  / R$ 600
--          Viagem 3 partes / R$ 300
--      A mesma despesa passa a ser cobrada duas vezes, de gente que nem
--      viajou junto.
--
-- A CAUSA
-- -------
-- `auto_create_group_transaction` (001_baseline.sql:143) ja e
-- AFTER INSERT OR UPDATE, entao ele RODA na edicao. So que o corpo inteiro
-- esta dentro de
--
--     IF NOT EXISTS (SELECT 1 FROM group_transactions
--                     WHERE transaction_id = NEW.id AND group_id = NEW.group_id)
--
-- Na edicao de valor esse par existe, ele sai sem fazer nada, e as partes
-- velhas ficam (caso 1). Na troca de grupo o par (transacao, grupo NOVO) nao
-- existe, entao ele insere a segunda divisao -- e deixa a primeira em paz
-- (caso 2). A constraint `unique_transaction_per_group` e (group_id,
-- transaction_id): ela impede a mesma despesa duas vezes no MESMO grupo, e
-- permite a mesma despesa em dois grupos diferentes.
--
-- `calculate_equal_split` e BEFORE **INSERT** de group_expense_splits, entao
-- ele nunca ve uma edicao: quem nao insere parte nova nao passa por ele.
--
-- A DECISAO DE PRODUTO (opcao "b", escolhida por H. Moraes na HMO-176)
-- -------------------------------------------------------------------
-- O que fazer com uma parte que alguem JA aprovou quando o valor muda:
--   a) recalcular tudo e devolver todo mundo para 'pending'  -- apaga a
--      conferencia de quem ja aprovou, sem avisar;
--   b) recalcular so as 'pending' e TRAVAR a edicao quando ja houver parte
--      aprovada;                                              <-- esta aqui
--   c) proibir editar despesa de grupo e exigir estornar e relancar.
--
-- Entao: parte aprovada e um fato que o banco nao apaga sozinho. A edicao que
-- precisaria apagar ou reescrever uma parte aprovada FALHA, com SQLSTATE
-- proprio (PDG01) para a tela dizer o que aconteceu em vez de "erro ao
-- gravar".
--
-- Hoje NENHUMA rota aprova rateio de grupo (ver o comentario da view
-- group_member_balances, na 007), entao na pratica esta trava nao vai disparar
-- para ninguem ainda. Ela existe para o dia em que a aprovacao for ligada --
-- que e exatamente o dia em que ninguem lembraria desta ordem de eventos.
--
-- O QUE A EDICAO PASSA A FAZER
-- ----------------------------
--   * valor mudou       -> as partes 'pending' sao recalculadas sobre o valor
--                          novo, entre os membros ATIVOS de hoje;
--   * grupo mudou       -> a divisao do grupo antigo e apagada (CASCADE leva
--                          as partes) e a do grupo novo e criada;
--   * saiu do grupo     -> a divisao some (group_id = NULL);
--   * virou receita     -> idem: divisao so existe para despesa (amount < 0);
--   * qualquer parte ja aprovada em algo que seria apagado ou reescrito
--                       -> a edicao inteira falha com PDG01.
--
-- Parte 'rejected' e 'expired' NAO e recalculada e NAO trava a edicao: ela ja
-- esta fora do saldo (a view do 007 exclui as duas), entao o valor gravado ali
-- e decorativo. Recalcular seria ressuscitar uma recusa.
--
-- O GEMEO QUE SAI DE CENA
-- -----------------------
-- Havia DOIS triggers quase identicos fazendo esse trabalho desde o baseline:
-- `trigger_auto_create_group_transaction` e `trigger_sync_transaction_group`.
-- Cada um so agia se o outro ainda nao tivesse agido (pelo mesmo IF NOT
-- EXISTS), o que torna "e so mexer no trigger" uma conclusao errada e facil de
-- tirar -- desligar UM nao muda nada, e foi isso que a HMO-175 registrou.
-- Consertar os dois em paralelo seria criar a proxima deriva. Esta migration
-- deixa UM caminho: o trabalho vira uma funcao normal
-- (`refazer_rateio_do_grupo`), `auto_create_group_transaction` passa a ser uma
-- casca que a chama, e o gemeo e dropado.
--
-- POR QUE SECURITY DEFINER (e o que isso NAO abre)
-- ------------------------------------------------
-- Quem edita a despesa e o dono dela, que quase nunca e admin do grupo. E as
-- policies da 002 dizem:
--   * DELETE em group_expense_splits  -> so is_group_admin;
--   * UPDATE em group_expense_splits  -> so a propria parte, ou admin;
--   * DELETE em group_transactions    -> so created_by = auth.uid() ou admin,
--     e as linhas criadas pelo gemeo e pela rota antiga tem created_by NULL.
-- Em SECURITY INVOKER o conserto nao falharia: ele afetaria ZERO linhas, em
-- silencio, e so para quem nao e admin. Verde no teste rodado como postgres,
-- quebrado para o usuario de verdade -- a armadilha que a 003 e a 004 ja
-- pegaram neste banco.
--
-- O que impede o abuso do DEFINER, ja que a funcao (ao contrario de um trigger)
-- e chamavel direto pelo PostgREST:
--   1. ela le user_id, group_id e amount da PROPRIA transacao -- nao aceita
--      valor por parametro, entao nao da para mandar rateio de R$ 10.000 numa
--      despesa de R$ 10;
--   2. ela exige auth.uid() = dono da transacao (auth.uid() nulo = trigger
--      rodando por service_role/psql);
--   3. EXECUTE revogado de PUBLIC, anon e authenticated -- os tres, porque no
--      Supabase revogar so de PUBLIC nao tira o grant explicito que anon e
--      authenticated ja tem.
-- Os parametros que sobram (grupo e valor ANTIGOS) so servem para detectar o
-- que mudou; mentir neles no maximo forca um recalculo que chega no mesmo
-- resultado.
--
-- REPARO DOS DADOS QUE JA ESTAO ERRADOS
-- -------------------------------------
-- A SECAO 4 desfaz as duas sujeiras que as edicoes ja feitas deixaram: divisao
-- em grupo que contradiz o group_id da transacao (a cobranca dupla) e partes
-- que nao somam o valor da despesa. Ela pula tudo que tenha parte aprovada --
-- a mesma regra da opcao (b) -- e nao inventa linha nenhuma onde nao havia
-- divisao.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Pre-requisitos
-- ---------------------------------------------------------------------------
-- Falhar aqui, com nome, e melhor do que falhar la embaixo com "relation does
-- not exist" no meio de um CREATE FUNCTION de 100 linhas.
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(msg, E'\n') INTO v_faltando
  FROM (
    SELECT '  - tabela public.group_transactions' AS msg
    WHERE to_regclass('public.group_transactions') IS NULL
    UNION ALL
    SELECT '  - tabela public.group_expense_splits'
    WHERE to_regclass('public.group_expense_splits') IS NULL
    UNION ALL
    SELECT '  - funcao public.calculate_equal_split() (vem do 001, corrigida no 007)'
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'calculate_equal_split'
    )
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'024 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> ... -> 007 antes.', v_faltando;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. recalcular_partes_pendentes() -- a conta do dinheiro, num lugar so
-- ---------------------------------------------------------------------------
-- Rateio igualitario: APAGA as partes pendentes e insere de novo, para que o
-- BEFORE INSERT `calculate_equal_split` (corrigido no 007) faca a conta. Isso
-- e de proposito: o metodo do maior resto -- centavos inteiros, o resto
-- distribuido pela ordem de group_members.id -- e a unica implementacao de
-- divisao deste banco, e copiar a formula para ca criaria a segunda, que um
-- dia discordaria da primeira em algum centavo.
--
-- As colunas percentage e amount vao com valor de fachada (100 e 0) no INSERT:
-- as duas sao NOT NULL, e o BEFORE INSERT troca as duas antes de o NOT NULL ser
-- avaliado. E o mesmo truque que o trigger do baseline ja usava para percentage.
--
-- Rateio combinado (percentage / custom / proporcional a renda): NAO pode
-- virar divisao igual -- foi exatamente isso que a 007 consertou. Aqui a parte
-- pendente e reescalada pela porcentagem que ficou gravada, que e o que
-- "combinamos 70/30" quer dizer quando a conta muda de tamanho.
--
-- Parte que nao esta 'pending' nao e tocada nos dois caminhos.
CREATE OR REPLACE FUNCTION public.recalcular_partes_pendentes(p_group_transaction_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_split_type TEXT;
  v_total NUMERIC;
  v_partes INTEGER := 0;
BEGIN
  SELECT gt.split_type, ABS(ft.amount)
    INTO v_split_type, v_total
    FROM public.group_transactions gt
    JOIN public.financial_transactions ft ON ft.id = gt.transaction_id
   WHERE gt.id = p_group_transaction_id;

  -- Ligacao orfa (a transacao sumiu no meio do caminho): nao ha valor para
  -- dividir, e inventar zero seria pior do que nao fazer nada.
  IF v_total IS NULL THEN
    RETURN 0;
  END IF;

  IF v_split_type = 'equal' THEN
    DELETE FROM public.group_expense_splits
     WHERE group_transaction_id = p_group_transaction_id
       AND status = 'pending';

    -- Membro ativo que JA tem parte aqui (recusada ou expirada) nao ganha uma
    -- segunda linha: a recusa dele continua valendo, e o saldo do grupo ja
    -- conta a ausencia dela.
    INSERT INTO public.group_expense_splits
      (group_transaction_id, member_id, percentage, amount, status)
    SELECT p_group_transaction_id, gm.id, 100, 0, 'pending'
      FROM public.group_members gm
      JOIN public.group_transactions gt ON gt.group_id = gm.group_id
     WHERE gt.id = p_group_transaction_id
       AND gm.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM public.group_expense_splits es
          WHERE es.group_transaction_id = p_group_transaction_id
            AND es.member_id = gm.id
       );

    GET DIAGNOSTICS v_partes = ROW_COUNT;
  ELSE
    UPDATE public.group_expense_splits es
       SET amount = ROUND(v_total * (es.percentage / 100.0), 2),
           updated_at = now()
     WHERE es.group_transaction_id = p_group_transaction_id
       AND es.status = 'pending';

    GET DIAGNOSTICS v_partes = ROW_COUNT;
  END IF;

  RETURN v_partes;
END;
$$;

COMMENT ON FUNCTION public.recalcular_partes_pendentes(uuid) IS
  'Refaz as partes pendentes de uma divisao sobre o valor atual da despesa. Igualitaria: apaga e reinsere, para o calculate_equal_split fazer a conta em centavos. Combinada: reescala pela porcentagem gravada. Nao toca em parte aprovada, recusada ou expirada.';

REVOKE EXECUTE ON FUNCTION public.recalcular_partes_pendentes(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. refazer_rateio_do_grupo() -- o que a edicao faz, inteiro
-- ---------------------------------------------------------------------------
-- Recebe a transacao e o estado ANTIGO (grupo e valor). Le o estado novo da
-- propria linha -- ver a nota sobre SECURITY DEFINER no cabecalho.
CREATE OR REPLACE FUNCTION public.refazer_rateio_do_grupo(
  p_transaction_id uuid,
  p_group_id_antigo uuid DEFAULT NULL,
  p_valor_antigo numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_group_id uuid;
  v_amount NUMERIC;
  v_alvo uuid;
  v_alvo_antigo uuid;
  v_mudou_grupo BOOLEAN;
  v_mudou_valor BOOLEAN;
  v_gt uuid;
BEGIN
  SELECT ft.user_id, ft.group_id, ft.amount
    INTO v_user_id, v_group_id, v_amount
    FROM public.financial_transactions ft
   WHERE ft.id = p_transaction_id;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Chamada DIRETA (fora de trigger) por alguem que nao e o dono da despesa
  -- nao passa. Dentro de trigger a checagem nao se repete, e isso e
  -- deliberado: para o trigger disparar, o comando em financial_transactions
  -- ja passou pela RLS daquela tabela, que so deixa o dono escrever. Repetir a
  -- checagem ali quebraria toda escrita feita com um claim que nao e o do dono
  -- -- o backfill de uma migration, uma manutencao por psql numa sessao que
  -- ainda tem `request.jwt.claim.sub` de outra pessoa -- com um erro que nao
  -- tem nada a ver com o que a pessoa estava fazendo.
  IF pg_trigger_depth() = 0 AND auth.uid() IS NOT NULL AND auth.uid() <> v_user_id THEN
    RAISE EXCEPTION 'so o dono do lancamento pode refazer o rateio dele'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Divisao de grupo existe para DESPESA lancada num grupo. Receita no grupo
  -- nao e alguem pagando a conta do restaurante (a view do 007 ja faz essa
  -- distincao para o "pago"), e valor zero nao tem o que dividir.
  v_alvo        := CASE WHEN v_group_id        IS NOT NULL AND v_amount       < 0 THEN v_group_id        END;
  v_alvo_antigo := CASE WHEN p_group_id_antigo IS NOT NULL AND p_valor_antigo < 0 THEN p_group_id_antigo END;

  v_mudou_grupo := v_alvo IS DISTINCT FROM v_alvo_antigo;
  v_mudou_valor := p_valor_antigo IS NOT NULL AND p_valor_antigo IS DISTINCT FROM v_amount;

  -- ------------------------------------------------------------------
  -- 2a. As duas travas da opcao (b), ANTES de qualquer escrita
  -- ------------------------------------------------------------------
  IF v_mudou_grupo AND EXISTS (
       SELECT 1
         FROM public.group_expense_splits es
         JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
        WHERE gt.transaction_id = p_transaction_id
          AND (v_alvo IS NULL OR gt.group_id <> v_alvo)
          AND es.status = 'approved'
     ) THEN
    RAISE EXCEPTION 'Alguem ja aprovou a parte desta despesa no grupo atual. Tirar ela dali apagaria essa aprovacao: estorne e relance, ou peca para reabrir a aprovacao.'
      USING ERRCODE = 'PDG01';
  END IF;

  IF v_mudou_valor AND v_alvo IS NOT NULL AND EXISTS (
       SELECT 1
         FROM public.group_expense_splits es
         JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
        WHERE gt.transaction_id = p_transaction_id
          AND gt.group_id = v_alvo
          AND es.status = 'approved'
     ) THEN
    RAISE EXCEPTION 'Alguem ja aprovou a parte desta despesa no grupo. Mudar o valor mudaria o que essa pessoa aprovou: estorne e relance, ou peca para reabrir a aprovacao.'
      USING ERRCODE = 'PDG01';
  END IF;

  -- ------------------------------------------------------------------
  -- 2b. Tirar a despesa dos grupos onde ela nao esta mais
  -- ------------------------------------------------------------------
  -- Condicionado a v_mudou_grupo de proposito. Sem isso, uma edicao de
  -- descricao apagaria a ligacao de uma despesa POSITIVA de grupo -- que a
  -- rota da tela de grupo cria pela rede de seguranca dela, e que nenhum
  -- trigger recriaria depois.
  IF v_mudou_grupo THEN
    DELETE FROM public.group_transactions gt
     WHERE gt.transaction_id = p_transaction_id
       AND (v_alvo IS NULL OR gt.group_id <> v_alvo);
  END IF;

  IF v_alvo IS NULL THEN
    RETURN;
  END IF;

  SELECT gt.id INTO v_gt
    FROM public.group_transactions gt
   WHERE gt.transaction_id = p_transaction_id
     AND gt.group_id = v_alvo;

  -- ------------------------------------------------------------------
  -- 2c. Grupo novo (ou despesa nova): cria a ligacao e as partes
  -- ------------------------------------------------------------------
  IF v_gt IS NULL THEN
    INSERT INTO public.group_transactions (group_id, transaction_id, split_type, created_by)
    VALUES (v_alvo, p_transaction_id, 'equal', v_user_id)
    RETURNING id INTO v_gt;

    INSERT INTO public.group_expense_splits
      (group_transaction_id, member_id, percentage, amount, status)
    SELECT v_gt, gm.id, 100, 0, 'pending'
      FROM public.group_members gm
     WHERE gm.group_id = v_alvo
       AND gm.status = 'active';

    RETURN;
  END IF;

  -- ------------------------------------------------------------------
  -- 2d. Mesmo grupo, valor novo: refaz as partes pendentes
  -- ------------------------------------------------------------------
  IF v_mudou_valor THEN
    PERFORM public.recalcular_partes_pendentes(v_gt);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) IS
  'Poe a divisao de uma despesa em dia com o grupo e o valor atuais dela: cria, move, apaga e recalcula. Falha com SQLSTATE PDG01 quando a edicao precisaria apagar ou reescrever uma parte ja aprovada.';

REVOKE EXECUTE ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) FROM PUBLIC;

-- Revogar so de PUBLIC nao basta no Supabase: anon e authenticated recebem
-- EXECUTE explicito por default (ALTER DEFAULT PRIVILEGES do projeto), e grant
-- explicito nao e alcancado por REVOKE ... FROM PUBLIC. Nomear os dois e o que
-- fecha a porta. O DO cobre o banco local, onde esses roles podem nao existir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.recalcular_partes_pendentes(uuid) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.recalcular_partes_pendentes(uuid) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) FROM authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. O trigger que sobra, e o gemeo que sai
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER tambem aqui, e nao por causa das tabelas: a casca precisa
-- CHAMAR refazer_rateio_do_grupo(), e o EXECUTE dessa funcao foi revogado de
-- authenticated logo acima. Em SECURITY INVOKER a casca roda como o usuario da
-- sessao e bate em "permission denied for function refazer_rateio_do_grupo" na
-- primeira despesa de grupo -- o teste 024 pegou exatamente isso. Como DEFINER
-- ela roda como o dono, que tem o EXECUTE.
--
-- Isto muda o que a 004 registrou sobre esta funcao ("fica como esta", em
-- SECURITY INVOKER). O que a 004 auditou foi o acesso as TABELAS; o motivo
-- novo e a chamada de funcao. Chamar a casca direto continua impossivel pelo
-- tipo de retorno `trigger`, e a regra de quem pode mexer em que rateio esta
-- dentro de refazer_rateio_do_grupo(), que checa auth.uid() contra o dono da
-- transacao -- e auth.uid() le o JWT, que SECURITY DEFINER nao troca.
CREATE OR REPLACE FUNCTION public.auto_create_group_transaction() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.refazer_rateio_do_grupo(NEW.id, NULL, NULL);
  ELSE
    PERFORM public.refazer_rateio_do_grupo(NEW.id, OLD.group_id, OLD.amount);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.auto_create_group_transaction() IS
  'Casca do trigger de financial_transactions: passa o estado antigo para refazer_rateio_do_grupo(). A regra inteira mora la.';

-- O gemeo. Nao ha rota nem cron que o chame -- so comentarios no codigo, que
-- esta migration acompanha. Dropar o trigger antes da funcao, senao o DROP
-- falha por dependencia.
DROP TRIGGER IF EXISTS trigger_sync_transaction_group ON public.financial_transactions;
DROP FUNCTION IF EXISTS public.sync_transaction_with_group();

-- O trigger que fica. Recriado por nome para o caso de um banco onde ele nao
-- exista (ou exista com outro escopo de evento).
DROP TRIGGER IF EXISTS trigger_auto_create_group_transaction ON public.financial_transactions;
CREATE TRIGGER trigger_auto_create_group_transaction
  AFTER INSERT OR UPDATE ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_group_transaction();

-- ---------------------------------------------------------------------------
-- 4. Reparo do que as edicoes ja quebraram
-- ---------------------------------------------------------------------------
-- Idempotente e conservador: nao cria divisao onde nao havia, nao mexe em nada
-- que tenha parte aprovada, e nao encosta em transacao sem group_id (essa
-- coluna e a fonte da verdade desde o backfill da SECAO 4 da 007).
--
-- A ordem importa nas duas pontas: a cobranca dupla tem que sumir ANTES do
-- recalculo (senao recalcularia partes de uma ligacao que vai ser apagada em
-- seguida) e antes do indice unico da SECAO 5, que nao nasce enquanto houver
-- despesa em dois grupos.
DO $$
DECLARE
  v_duplas INTEGER := 0;
  v_recalculadas INTEGER := 0;
  v_pulou_aprovada INTEGER := 0;
  r RECORD;
BEGIN
  -- 4a. Divisao num grupo que nao e o grupo da despesa.
  WITH alvo AS (
    SELECT gt.id
      FROM public.group_transactions gt
      JOIN public.financial_transactions ft ON ft.id = gt.transaction_id
     WHERE ft.group_id IS NOT NULL
       AND gt.group_id <> ft.group_id
       AND NOT EXISTS (
         SELECT 1 FROM public.group_expense_splits es
          WHERE es.group_transaction_id = gt.id AND es.status = 'approved'
       )
  ), apagadas AS (
    DELETE FROM public.group_transactions gt
     USING alvo WHERE gt.id = alvo.id
     RETURNING 1
  )
  SELECT count(*) INTO v_duplas FROM apagadas;

  -- 4b. Partes que nao somam o valor da despesa.
  --     So quando TODAS as partes sao pendentes: com uma recusada, a soma
  --     menor e o estado correto, nao a sobra do caso 1.
  FOR r IN
    SELECT gt.id
      FROM public.group_transactions gt
      JOIN public.financial_transactions ft ON ft.id = gt.transaction_id
      JOIN public.group_expense_splits es ON es.group_transaction_id = gt.id
     WHERE ft.amount < 0
     GROUP BY gt.id, ft.amount
    HAVING count(*) FILTER (WHERE es.status <> 'pending') = 0
       AND SUM(es.amount) <> ABS(ft.amount)
  LOOP
    PERFORM public.recalcular_partes_pendentes(r.id);
    v_recalculadas := v_recalculadas + 1;
  END LOOP;

  -- 4c. O que ficou de fora, para aparecer no log de quem aplicar.
  SELECT count(DISTINCT gt.id) INTO v_pulou_aprovada
    FROM public.group_transactions gt
    JOIN public.financial_transactions ft ON ft.id = gt.transaction_id
    JOIN public.group_expense_splits es ON es.group_transaction_id = gt.id
   WHERE es.status = 'approved'
     AND (gt.group_id IS DISTINCT FROM ft.group_id
          OR (ft.amount < 0 AND (SELECT SUM(x.amount)
                                   FROM public.group_expense_splits x
                                  WHERE x.group_transaction_id = gt.id) <> ABS(ft.amount)));

  RAISE NOTICE '024 reparo: % cobranca(s) dupla apagada(s), % divisao(oes) recalculada(s), % pulada(s) por ter parte aprovada.',
    v_duplas, v_recalculadas, v_pulou_aprovada;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Uma despesa mora em UM grupo
-- ---------------------------------------------------------------------------
-- `unique_transaction_per_group` e (group_id, transaction_id): ela impede a
-- mesma despesa duas vezes no MESMO grupo e permite a mesma despesa em dois
-- grupos diferentes -- que e exatamente a forma do caso 2. A coluna
-- financial_transactions.group_id e singular, entao o indice que descreve a
-- realidade e por transaction_id.
--
-- Indice CHEIO, nao parcial: indice parcial nao serve de arbitro de
-- ON CONFLICT pelo supabase-js, que nao manda o predicado junto.
--
-- A constraint antiga fica: ela e mais fraca que este indice, nao conflita com
-- ele, e derruba-la exigiria conferir quem depende do indice dela.
--
-- O indice NAO e condicao do conserto -- quem impede a cobranca dupla e a
-- SECAO 2b. Ele e a rede embaixo. Por isso, se sobrar alguma despesa em dois
-- grupos que a SECAO 4 nao pode desfazer (parte ja aprovada dos dois lados),
-- esta migration avisa em vez de abortar: abortar deixaria o banco sem o
-- conserto por causa da rede.
DO $$
DECLARE
  v_duplicadas INTEGER;
  v_lista TEXT;
BEGIN
  SELECT count(*), string_agg(transaction_id::text, ', ')
    INTO v_duplicadas, v_lista
    FROM (
      SELECT transaction_id
        FROM public.group_transactions
       GROUP BY transaction_id
      HAVING count(*) > 1
    ) AS d;

  IF v_duplicadas > 0 THEN
    RAISE WARNING E'024: % despesa(s) continuam divididas em mais de um grupo e o indice unico NAO foi criado.\nResolva a mao (a parte aprovada e que trava o reparo automatico) e rode depois:\n  CREATE UNIQUE INDEX uniq_group_transactions_transaction ON public.group_transactions (transaction_id);\nDespesas: %',
      v_duplicadas, v_lista;
  ELSE
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uniq_group_transactions_transaction ON public.group_transactions (transaction_id)';
    EXECUTE $c$COMMENT ON INDEX public.uniq_group_transactions_transaction IS 'Uma despesa so pode estar dividida em um grupo. Sem isto, editar o grupo de uma despesa a cobra nos dois (HMO-176).'$c$;
  END IF;
END $$;

COMMIT;

-- =====================================================
-- VERIFICACAO (rodar depois do COMMIT)
-- =====================================================
-- 1. So um trigger de grupo em financial_transactions:
--
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.financial_transactions'::regclass AND NOT tgisinternal;
--
--   Nao pode haver `trigger_sync_transaction_group` na lista.
--
-- 2. As duas funcoes novas, em SECURITY DEFINER e com search_path preso:
--
--   SELECT proname, prosecdef, proconfig FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND proname IN ('refazer_rateio_do_grupo', 'recalcular_partes_pendentes');
--
-- 3. Nenhuma despesa dividida em dois grupos (tem que voltar 0 linhas):
--
--   SELECT transaction_id, count(*) FROM public.group_transactions
--    GROUP BY transaction_id HAVING count(*) > 1;
--
-- 4. Toda divisao so-pendente somando o valor da despesa (0 linhas):
--
--   SELECT gt.id, ABS(ft.amount) AS despesa, SUM(es.amount) AS partes
--     FROM public.group_transactions gt
--     JOIN public.financial_transactions ft ON ft.id = gt.transaction_id
--     JOIN public.group_expense_splits es ON es.group_transaction_id = gt.id
--    WHERE ft.amount < 0
--    GROUP BY gt.id, ft.amount
--   HAVING count(*) FILTER (WHERE es.status <> 'pending') = 0
--      AND SUM(es.amount) <> ABS(ft.amount);
--
-- O teste automatizado e database/tests/024_edicao_de_despesa_de_grupo_test.sql.


-- ---------------------------------------------------------------------------
-- 25. 025_travar_repontamento_de_divisao.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 025_travar_repontamento_de_divisao.sql
--
-- HMO-130: `expense_splits_update` nao congela `transaction_id` nem
-- `percentage`. Sai da HMO-125. Nao e regressao do 004 -- o buraco ja existia;
-- o 004 so tirou o acidente que o mascarava.
--
-- ===========================================================================
-- O QUE ESTA ABERTO
-- ===========================================================================
-- A policy de UPDATE de `expense_splits` (002, linha 660) e a mesma dos dois
-- lados:
--
--     USING      (participant_id = auth.uid() OR <e dono da transacao>)
--     WITH CHECK (participant_id = auth.uid() OR <e dono da transacao>)
--
-- Ela diz QUAIS LINHAS o participante alcanca, e nao QUAIS COLUNAS ele pode
-- mexer -- policy de RLS nao compara OLD com NEW, entao "esta coluna nao muda"
-- e uma frase que policy nenhuma consegue dizer. O participante alcanca a
-- propria linha inteira.
--
-- O vazamento sai do BEFORE trigger `calculate_split_amount` (001), que o 004
-- passou para SECURITY DEFINER -- e precisa ser DEFINER, senao aprovar divisao
-- quebra, que foi a HMO-125:
--
--     SELECT ABS(amount) * (NEW.percentage / 100.0) INTO NEW.amount
--     FROM financial_transactions WHERE id = NEW.transaction_id;
--
-- Esse SELECT roda SEM RLS. Entao o participante que der
--
--     PATCH /rest/v1/expense_splits?id=eq.<a divisao dele>
--     { "transaction_id": "<despesa alheia>", "percentage": 100 }
--
-- recebe em `amount` o valor exato da despesa alheia, e le de volta pela
-- policy de SELECT da propria linha. Nao precisa de grupo, nao precisa ser
-- dono de nada: a linha continua sendo dele o tempo todo.
--
-- O `percentage` vaza sozinho, sem repontar. Numa divisao 1-para-1 o
-- participante NAO enxerga a transacao: `financial_transactions_select` e
-- `user_id = auth.uid() OR (group_id IS NOT NULL AND is_group_member(...))`,
-- e despesa pessoal dividida nao tem grupo. Ele so conhece a parte DELE.
-- Subir a propria porcentagem para 100 faz o trigger devolver o total da
-- despesa do outro. Por isso as duas colunas entram aqui, e nao so uma.
--
-- ALCANCE: e leitura de valor por alvo conhecido, nao porta aberta. O UUID
-- alvo e v4 e nao da para enumerar, e nao vazam descricao, categoria nem dono
-- -- so o numero. Gravidade baixa. Mas e alcancavel HOJE, pela chave anon com
-- uma sessao comum: o 002 deu `GRANT ... UPDATE ON ALL TABLES ... TO
-- authenticated` (linha 382) e o PostgREST expoe a tabela. Nao e estado que so
-- se forja por dentro do banco.
--
-- Antes do 004 nao dava, mas por acidente: o SELECT do trigger voltava vazio
-- sob RLS, `NEW.amount` virava NULL e o NOT NULL derrubava a transacao. A
-- protecao era efeito colateral de um bug, e foi embora junto com o bug.
--
-- ===========================================================================
-- POR QUE TRIGGER, E NAO POLICY
-- ===========================================================================
-- A HMO-130 listou duas saidas: (1) trigger BEFORE UPDATE, (2) tirar o UPDATE
-- direto do participante e mover aprovar/rejeitar para uma funcao DEFINER
-- (`approve_split`), com a rota chamando RPC. Esta migration faz a (1).
--
-- A (2) e mais limpa a longo prazo, mas troca o contrato de
-- `app/api/personal-finance/splits/route.ts` e so se paga quando a rota for
-- mexida de qualquer jeito. A (1) e contida e nao pede deploy: a rota atual
-- so escreve `status`, `approved_at`, `rejection_reason` e `updated_at`, que
-- e exatamente o que continua passando.
--
-- Quebrar `expense_splits_update` em duas policies (uma do participante, uma
-- do dono), como o esboco da issue sugeria, NAO ajuda e nao esta aqui: duas
-- policies permissivas sao OR entre si, entao o par teria o mesmo predicado
-- efetivo que a policy unica de hoje. Seria renomear, nao consertar. A policy
-- do 002 fica como esta.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION NAO CONGELA, DE PROPOSITO
-- ===========================================================================
--   * `participant_id`: a policy ja o prende para o participante (mudar para
--     terceiro reprova no WITH CHECK, que exige `participant_id = auth.uid()`
--     na linha NOVA). Para o dono nao prende -- mas o dono ja pode criar a
--     divisao apontando para quem quiser, porque `expense_splits_insert` so
--     exige que a transacao seja dele. Congelar aqui nao tiraria poder nenhum
--     de ninguem: seria trava sobre estado que ja e alcancavel por outra
--     porta.
--
--   * `amount`: e coluna DERIVADA. `calculate_split_amount_trigger` e BEFORE
--     INSERT OR UPDATE e reescreve `NEW.amount` em toda passada, a partir de
--     `percentage` e `transaction_id`. Com as duas travadas, o valor escrito
--     a mao e descartado antes de chegar na tabela -- e nao ha ordem de
--     trigger que mude isso, porque nenhum outro trigger escreve `amount`.
--     A SECAO 5 do teste cobre essa transitividade.
--
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A guarda
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER explicito e `search_path` fixo, como a `categorization_rules_guard`
-- do 014. INVOKER e o certo aqui, ao contrario do 003/004: aquelas funcoes
-- precisavam de DEFINER porque ESCREVEM em tabela derivada que a RLS do 002
-- fecha. Esta so LE, e o predicado que ela avalia
-- (`ft.user_id = auth.uid()`) e mais estreito que a policy de SELECT da
-- tabela lida -- entao DEFINER nao compraria resposta nenhuma que INVOKER nao
-- da, e compraria um caminho sem RLS que ninguem precisa.
--
-- `auth.uid() IS NULL` passa direto. Quem chega assim e `service_role`, cron
-- ou psql direto -- backend nosso, que precisa poder corrigir divisao. Nao e
-- brecha para o app: `anon` levou REVOKE ALL da tabela no 002, e um
-- `authenticated` sem claim `sub` teria `participant_id = NULL` na policy de
-- UPDATE, que e NULL, que nao e TRUE -- a RLS nao lhe entrega linha nenhuma
-- para este trigger julgar.
CREATE OR REPLACE FUNCTION public.expense_splits_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dono BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Vale para todo mundo, dono inclusive. Mover uma divisao de uma despesa
  -- para outra nao e edicao, e troca de fato gerador: o saldo ja lancado passa
  -- a referenciar despesa que nunca o produziu. Quem quer dividir outra
  -- despesa cria outra divisao.
  IF NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
    RAISE EXCEPTION
      'divisao nao muda de despesa: apague esta e crie outra (era %, veio %)',
      OLD.transaction_id, NEW.transaction_id
      USING ERRCODE = '42501';
  END IF;

  IF NEW.percentage IS DISTINCT FROM OLD.percentage THEN
    SELECT EXISTS (
      SELECT 1 FROM public.financial_transactions ft
      WHERE ft.id = OLD.transaction_id AND ft.user_id = auth.uid()
    ) INTO v_dono;

    IF NOT v_dono THEN
      RAISE EXCEPTION
        'so o dono da despesa muda a porcentagem da divisao'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_splits_guard ON public.expense_splits;
CREATE TRIGGER trg_expense_splits_guard
  BEFORE UPDATE ON public.expense_splits
  FOR EACH ROW EXECUTE FUNCTION public.expense_splits_guard();

-- Sem REVOKE, de proposito, e vale registrar o porque para ninguem "consertar"
-- a ausencia depois:
--
--   1. no Supabase, `REVOKE ... FROM PUBLIC` nao fecha nada. O Supabase concede
--      EXECUTE a `anon`/`authenticated`/`service_role` EXPLICITAMENTE, por
--      ALTER DEFAULT PRIVILEGES, e revogar de PUBLIC nao mexe em concessao
--      nominal -- o `proacl` continua com `authenticated=X/postgres` depois do
--      revoke. Foi o que o 003 e o 004 shiparam achando que estavam fechando;
--      os dois ja carregam a correcao em comentario. Para fechar de verdade e
--      preciso nomear os tres papeis;
--
--   2. e aqui nao ha o que fechar: a funcao devolve `trigger`, e o Postgres
--      recusa chamada direta a funcao de trigger (`can only be called as a
--      trigger`). O PostgREST tambem nao expoe esse tipo de retorno como RPC.
--
-- Revogar mesmo assim seria ruido que parece protecao. O que o trigger PRECISA
-- e que ninguem revogue o EXECUTE de `authenticated` mais tarde achando que e
-- endurecimento: a checagem de EXECUTE de funcao de trigger acontece na CRIACAO
-- do trigger, nao no disparo, mas a regra so vale enquanto o corpo nao chamar
-- outra funcao com `PERFORM` -- e este nao chama.

-- ---------------------------------------------------------------------------
-- Prova
-- ---------------------------------------------------------------------------
-- O arquivo aborta se algo nao pegou. Sem isto, rodar a migration num banco
-- onde uma metade falhou em silencio sai verde, e o vazamento continua de pe
-- com um "aplicado" no historico.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF to_regprocedure('public.expense_splits_guard()') IS NULL THEN
    RAISE EXCEPTION '025 nao criou public.expense_splits_guard()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = to_regclass('public.expense_splits')
      AND tgname = 'trg_expense_splits_guard'
      AND NOT tgisinternal
  ) THEN
    problemas := problemas || E'\n  - o trigger trg_expense_splits_guard nao ficou em expense_splits';
  END IF;

  -- INVOKER e parte do desenho, nao detalhe: DEFINER aqui faria a funcao ler
  -- financial_transactions sem RLS, que e a mesma porta que o 004 abriu no
  -- calculate_split_amount e que esta migration existe para trancar.
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = to_regprocedure('public.expense_splits_guard()') AND prosecdef
  ) THEN
    problemas := problemas || E'\n  - expense_splits_guard ficou SECURITY DEFINER; tem que ser INVOKER';
  END IF;

  IF (SELECT proconfig FROM pg_proc
      WHERE oid = to_regprocedure('public.expense_splits_guard()')) IS NULL THEN
    problemas := problemas || E'\n  - expense_splits_guard ficou sem search_path fixo';
  END IF;

  -- O trigger so vale se a tabela ainda tiver RLS: sem ela, a policy de UPDATE
  -- nem limita as linhas, e travar coluna vira consolo.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = to_regclass('public.expense_splits') AND relrowsecurity
  ) THEN
    problemas := problemas || E'\n  - expense_splits esta sem RLS';
  END IF;

  -- A premissa do vazamento. Se um dia o calculate_split_amount deixar de ser
  -- DEFINER, esta migration continua correta -- mas a nota de cima passa a
  -- descrever um banco que nao existe mais, e quem ler aqui merece saber.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = to_regprocedure('public.calculate_split_amount()') AND prosecdef
  ) THEN
    RAISE NOTICE '025: calculate_split_amount nao e mais SECURITY DEFINER -- reler a nota do topo';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION '025 nao pegou:%', problemas;
  END IF;

  RAISE NOTICE '025 ok: trg_expense_splits_guard ativo, INVOKER, search_path fixo';
END $$;

COMMIT;

-- =====================================================
-- DEPOIS DE APLICAR
-- =====================================================
-- Nao ha deploy a esperar. A rota de divisoes que esta no ar
-- (app/api/personal-finance/splits/route.ts) escreve `status`, `approved_at`,
-- `rejection_reason` e `updated_at` -- nenhuma das colunas travadas -- entao
-- aprovar e rejeitar continuam funcionando exatamente como hoje.
--
-- O que muda: um PATCH direto no PostgREST que tente repontar `transaction_id`
-- ou mexer em `percentage` sem ser dono passa a voltar 403 em vez de gravar.
-- =====================================================


-- ---------------------------------------------------------------------------
-- 26. 026_cambio_do_grupo.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 026_cambio_do_grupo.sql
--
-- HMO-138, item 3: multimoeda da viagem. Moeda do GRUPO, o cambio do dia da
-- compra GRAVADO no lancamento, e o acerto de contas convergindo para uma
-- moeda so.
--
-- As duas decisoes do Helio (interaction respondida em 2026-09-29T18:59Z):
--
--   "completo"        -- moeda do grupo + cambio do dia gravado no lancamento,
--                        e o acerto de contas converte tudo para uma moeda.
--   "ptax_editavel"   -- a cotacao vem da PTAX do Banco Central e a pessoa pode
--                        corrigir. Por isso o cambio e uma COLUNA comum, e nao
--                        uma tabela de cotacoes: o numero que vale e o que ela
--                        confirmou na hora, nao o que a API devolveria hoje.
--
-- A 022 (HMO-171) ja trouxe a moeda da conta, a do lancamento e a moeda no grao
-- das tres views de relatorio. Ela resolveu o problema dela -- "nao somar dolar
-- com real" -- MOSTRANDO SEPARADO, porque o app nao tinha cotacao nenhuma.
-- Aqui passa a ter, e isso muda o que e possivel: grupo nao pode mostrar
-- separado. Um acerto de contas em duas colunas nao e um acerto de contas.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION EXISTE PARA FECHAR
-- ===========================================================================
-- Duas views somam dinheiro SEM saber de moeda, e as duas ficam erradas no
-- minuto em que existir uma despesa de grupo em dolar. Nenhuma das duas da
-- erro, nenhuma devolve NULL, e as duas erram para o lado de que ninguem
-- reclama:
--
--   1) `group_member_balances` (007). `SUM(ABS(t.amount))` do que o membro
--      pagou, `SUM(es.amount)` do que ele deve. Um jantar de US$ 180 entra como
--      180 ao lado de um mercado de R$ 1.000, e o `net_balance` sai em moeda
--      nenhuma. A tela de acerto le exatamente essa coluna e sugere
--      transferencias com ela: a viagem inteira em dolar seria acertada como se
--      fosse em real, cobrando de cada um cerca de um quinto do que ele deve.
--      Quem pagou os dolares perde a diferenca, e a conta FECHA -- soma zero,
--      residual zero, nada para uma assercao de consistencia pegar.
--
--   2) `budget_consumption` (006). O teto de grupo da Fase 3 (PR #92) le essa
--      view. `SUM(ABS(t.amount))` sobre um teto em reais: a barra da viagem ao
--      exterior marcaria 18% de US$ 180 num teto de R$ 1.000 e ficaria verde
--      durante toda a viagem.
--
-- Agora que existe cotacao por linha, as duas convertem para BRL e cada numero
-- que sai delas esta em BRL. O grao por moeda do 022 continua valendo onde ele
-- resolve o problema (relatorio pessoal: "gastei 1.000 reais e 180 dolares" e a
-- resposta certa); o grupo converte, porque a pergunta dele e "quem deve
-- quanto a quem", e essa pergunta tem uma unica resposta.
--
-- POR QUE O DENOMINADOR E BRL, E NAO A MOEDA DO GRUPO
-- ---------------------------------------------------
-- Converter para a moeda do grupo dentro do banco exigiria, para cada despesa,
-- a cotacao da moeda DO GRUPO no dia DAQUELA despesa -- um numero que ninguem
-- gravou, porque o lancamento em real de uma viagem em dolar nao tem cotacao
-- nenhuma para gravar. So uma tabela de cotacoes diarias completa daria isso, e
-- ela teria que ser preenchida para todo dia de toda viagem, inclusive os dias
-- em que a PTAX nao existe (fim de semana e feriado).
--
-- Com BRL como denominador, a conversao de cada linha usa a cotacao que ESTA na
-- propria linha: exata, sem consulta, e imune a qualquer coisa que aconteca
-- depois. O valor do passado nao muda sozinho -- que e literalmente o pedido da
-- issue.
--
-- `expense_groups.currency` continua sendo o que a decisao pediu, e serve as
-- duas coisas para as quais uma moeda de grupo serve de verdade: ser a moeda
-- SUGERIDA a cada despesa da viagem, e ser a moeda em que a tela APRESENTA o
-- saldo. A segunda e conversao de apresentacao de UM numero do presente (a
-- divida que voce vai pagar agora), feita na tela, ao cambio de hoje e dizendo
-- que e de hoje. Isso nao e o valor do passado mudando: e o mesmo R$ 267,50 de
-- sempre, escrito em dolar.
--
-- POR QUE `exchange_rate = 1` E PROIBIDO FORA DO BRL
-- --------------------------------------------------
-- Ver a SECAO 2. E a parte menos obvia do arquivo e a que protege dinheiro.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Moeda do grupo
-- ---------------------------------------------------------------------------
-- Mesma lista fechada de 13 codigos da 022, pela mesma razao: a fonte de
-- verdade e `MOEDAS` em lib/dinheiro.ts, e um codigo que o app nao conhece
-- viraria uma linha que nenhuma tela sabe formatar (`moedaPorCodigo` cai no
-- padrao, ou seja: uma viagem em CZK apareceria em reais, sem aviso).
--
-- O ultimo caso de scripts/test-dinheiro.mjs le ESTE arquivo tambem: ele acha
-- todo CHECK de moeda nas migrations e compara codigo por codigo com `MOEDAS`.
-- Uma lista nova aqui, esquecida la, fica vermelha no mesmo PR.

ALTER TABLE public.expense_groups
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL';

COMMENT ON COLUMN public.expense_groups.currency IS
  'Moeda desta viagem/grupo (ISO 4217). E a moeda SUGERIDA a cada despesa do grupo e a moeda em que a tela apresenta o saldo. Nao e o denominador do saldo: group_member_balances devolve BRL. Todo grupo que ja existia e BRL.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expense_groups_currency_check'
  ) THEN
    ALTER TABLE public.expense_groups
      ADD CONSTRAINT expense_groups_currency_check
      CHECK (currency IN ('BRL','USD','EUR','GBP','CHF','CAD','AUD','ARS','CLP','UYU','PYG','JPY','CNY'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. O cambio do dia da compra, no lancamento
-- ---------------------------------------------------------------------------
-- Quantos REAIS vale UMA unidade de `currency` no dia `transaction_date`.
-- USD a 5,35 grava 5.35000000. BRL grava 1.
--
-- 8 casas porque o guarani e o peso chileno vivem na terceira casa a direita do
-- zero (PYG ~ 0,00073) e a conta precisa sobreviver a um valor de seis digitos
-- multiplicado por isso sem perder centavo.
--
-- NOT NULL DEFAULT 1: e o backfill do historico, nao uma reescrita dele. Todo
-- lancamento que existe hoje e BRL (default da 022), e a cotacao correta de BRL
-- e exatamente 1 -- entao nao existe, em nenhum instante, linha com cotacao
-- ausente ou errada.
--
-- OS DOIS CHECKS, E POR QUE O SEGUNDO E O IMPORTANTE
-- --------------------------------------------------
-- `exchange_rate > 0` e higiene: cotacao zero zeraria o valor em real de uma
-- despesa (a despesa desapareceria do saldo do grupo em vez de dar erro), e
-- negativa inverteria o sinal do dinheiro.
--
-- O outro CHECK e o que fecha o unico caminho de perda silenciosa que sobra
-- nesta feature. O DEFAULT 1 tem que existir para o backfill; mas DEFAULT 1 num
-- lancamento em DOLAR e uma cotacao errada com cara de cotacao. Uma rota antiga
-- que grave `currency: 'USD'` e esqueca o cambio -- ou o campo editavel enviado
-- vazio, ou a fila offline montada antes desta migration -- gravaria US$ 180
-- valendo R$ 180. A tela mostra "US$ 180,00" corretamente, o saldo do grupo
-- fecha, ninguem ve nada, e o erro e de 80% para menos.
--
-- Por isso: cotacao 1 se e somente se BRL. O caminho do esquecimento passa a
-- devolver 23514 na cara da rota, em vez de gravar dinheiro errado.
--
-- O preco: uma moeda estrangeira que valesse exatamente R$ 1,00000000 nao
-- poderia ser gravada na paridade exata (usa-se 1.00000001, um erro de um
-- centesimo de centavo em dez mil reais). Nenhuma das 12 moedas estrangeiras da
-- lista esta perto de 1 real -- a mais proxima e o peso uruguaio, na casa dos
-- 0,13 -- e se um dia uma estiver, o preco continua sendo esse. E uma troca
-- deliberada: um arredondamento invisivel numa moeda hipotetica, em troca de
-- fechar um erro de 80% numa moeda real.

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,8) NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.financial_transactions.exchange_rate IS
  'Quantos reais vale 1 unidade de currency no dia transaction_date (PTAX, editavel). Congelado: e a cotacao do dia da COMPRA, e nunca e recalculada. amount * exchange_rate = o valor em BRL. Vale 1 se e somente se currency = BRL.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_exchange_rate_check'
  ) THEN
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_exchange_rate_check
      CHECK (exchange_rate > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_rate_matches_currency'
  ) THEN
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_rate_matches_currency
      CHECK ((currency = 'BRL') = (exchange_rate = 1));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. O cambio do acerto
-- ---------------------------------------------------------------------------
-- `group_settlements` (007) registra um pagamento de um membro para outro, e
-- guarda `amount` sem moeda nenhuma. Na viagem ao exterior esse pagamento
-- acontece em dolar, e o pagamento entra na MESMA soma que as despesas:
-- `group_member_balances` cruza pago, devido e acertos. Um acerto de US$ 50
-- lido como R$ 50 nao zera a divida de quem pagou -- ele abate um quinto dela,
-- e a tela continua pedindo o resto depois de o dinheiro ter sido pago.
--
-- Cambio congelado no dia do pagamento (`settled_on`) pelo mesmo motivo do
-- lancamento, e com os dois mesmos CHECKs pela mesma razao.

ALTER TABLE public.group_settlements
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL';

COMMENT ON COLUMN public.group_settlements.currency IS
  'Moeda em que este pagamento foi feito de verdade (ISO 4217). Pode diferir da moeda do grupo: na viagem se paga no que se tem.';

ALTER TABLE public.group_settlements
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,8) NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.group_settlements.exchange_rate IS
  'Quantos reais vale 1 unidade de currency no dia settled_on. Congelado. amount * exchange_rate = o valor em BRL que este pagamento abateu. Vale 1 se e somente se currency = BRL.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'group_settlements_currency_check'
  ) THEN
    ALTER TABLE public.group_settlements
      ADD CONSTRAINT group_settlements_currency_check
      CHECK (currency IN ('BRL','USD','EUR','GBP','CHF','CAD','AUD','ARS','CLP','UYU','PYG','JPY','CNY'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'group_settlements_exchange_rate_check'
  ) THEN
    ALTER TABLE public.group_settlements
      ADD CONSTRAINT group_settlements_exchange_rate_check
      CHECK (exchange_rate > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'group_settlements_rate_matches_currency'
  ) THEN
    ALTER TABLE public.group_settlements
      ADD CONSTRAINT group_settlements_rate_matches_currency
      CHECK ((currency = 'BRL') = (exchange_rate = 1));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. O saldo do grupo, em BRL
-- ---------------------------------------------------------------------------
-- Identica a versao do 007 em TODO o resto -- de proposito. O ABS() com filtro
-- por `transaction_type` (despesa e gravada negativa neste banco), o `expense`
-- sozinho no lado do pago, o `status NOT IN ('rejected','expired')` no lado do
-- devido, o sinal invertido dos acertos (quem PAGA tem o saldo AUMENTADO), a
-- juncao por `user_id` e nao por `member_id`: cada uma dessas linhas tem uma
-- razao escrita no 007 e um teste que a trava. A unica diferenca aqui e o
-- `* exchange_rate`. Reescrever mais do que isso seria mudar dois numeros ao
-- mesmo tempo sem saber qual deles quebrou.
--
-- A multiplicacao entra DENTRO do SUM, por linha, e nao fora dele: fora, ela
-- aplicaria a cotacao de uma linha ao total de todas -- o que da o numero certo
-- exatamente enquanto todas as linhas tiverem a mesma moeda, ou seja, passa em
-- todo teste que nao misture moedas de proposito.
--
-- O lado do DEVIDO precisa de um JOIN novo. `group_expense_splits` nao tem
-- moeda nem cotacao propria, e nao deve ter: a parte de cada um e uma fracao da
-- despesa e esta na moeda DELA. A cotacao correta para a divisao e a da despesa
-- que a originou, entao o LATERAL passa por `financial_transactions`. Dar
-- cotacao propria a divisao permitiria divergencia entre a parte e o todo --
-- 100 dolares divididos em duas partes de 50 que somam 900 reais numa despesa
-- de 535.
--
-- O cast final para numeric(15,2) e onde o arredondamento acontece, uma vez, no
-- fim: e onde o 007 ja arredondava. Arredondar linha por linha antes de somar
-- afastaria os dois lados da conta em centavos e deixaria residual que nenhum
-- pagamento zera.
CREATE OR REPLACE VIEW public.group_member_balances AS
  SELECT
    m.group_id,
    m.user_id,
    m.id                                        AS member_id,
    COALESCE(p.paid, 0)::numeric(15,2)          AS total_paid,
    COALESCE(o.owed, 0)::numeric(15,2)          AS total_owed,
    COALESCE(s.paid_out, 0)::numeric(15,2)      AS settlements_paid,
    COALESCE(s.received, 0)::numeric(15,2)      AS settlements_received,
    (COALESCE(p.paid, 0)
     - COALESCE(o.owed, 0)
     + COALESCE(s.paid_out, 0)
     - COALESCE(s.received, 0))::numeric(15,2)  AS net_balance,
    COALESCE(p.paid_count, 0)                   AS paid_count,
    COALESCE(o.owed_count, 0)                   AS owed_count,
    -- As duas colunas novas vao no FIM porque `CREATE OR REPLACE VIEW` so
    -- aceita coluna nova no fim; mudar a posicao de uma existente exigiria
    -- DROP, e um DROP CASCADE aqui levaria os GRANTs e o security_invoker
    -- junto, mais o que eu nao listei.
    --
    -- `amount_currency` e uma constante, e existe justamente por isso: as sete
    -- colunas de dinheiro acima nao dizem em que moeda estao, e agora ha duas
    -- moedas em jogo na mesma tela. Quem consome a view nao precisa descobrir
    -- lendo este arquivo, e o dia em que o denominador mudar, muda aqui.
    'BRL'::text                                 AS amount_currency,
    -- A moeda da VIAGEM. Nao e a moeda dos numeros acima -- e a moeda em que a
    -- tela deve apresenta-los, convertendo no cliente, ao cambio de hoje e
    -- dizendo que e de hoje.
    eg.currency                                 AS group_currency
  FROM public.group_members m
  JOIN public.expense_groups eg ON eg.id = m.group_id

  -- o que este usuario pagou pelo grupo
  LEFT JOIN LATERAL (
    SELECT SUM(ABS(t.amount) * t.exchange_rate) AS paid, COUNT(*) AS paid_count
    FROM public.group_transactions gt
    JOIN public.financial_transactions t ON t.id = gt.transaction_id
    WHERE gt.group_id = m.group_id
      AND t.user_id = m.user_id
      AND t.transaction_type = 'expense'
  ) AS p ON TRUE

  -- a parte que cabe a ele nas despesas do grupo, na cotacao da despesa
  LEFT JOIN LATERAL (
    SELECT SUM(es.amount * t.exchange_rate) AS owed, COUNT(*) AS owed_count
    FROM public.group_expense_splits es
    JOIN public.group_members em ON em.id = es.member_id
    JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    JOIN public.financial_transactions t ON t.id = gt.transaction_id
    WHERE gt.group_id = m.group_id
      AND em.user_id = m.user_id
      AND es.status NOT IN ('rejected', 'expired')
  ) AS o ON TRUE

  -- os acertos ja registrados, nas duas direcoes, na cotacao do dia do pagamento
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN gs.from_user_id = m.user_id THEN gs.amount * gs.exchange_rate ELSE 0 END) AS paid_out,
      SUM(CASE WHEN gs.to_user_id   = m.user_id THEN gs.amount * gs.exchange_rate ELSE 0 END) AS received
    FROM public.group_settlements gs
    WHERE gs.group_id = m.group_id
      AND (gs.from_user_id = m.user_id OR gs.to_user_id = m.user_id)
  ) AS s ON TRUE

  WHERE m.status = 'active';

COMMENT ON VIEW public.group_member_balances IS
  'Saldo de cada membro ativo, sempre em BRL (coluna amount_currency): pago - devido + acertos pagos - acertos recebidos, cada parcela convertida pela cotacao congelada da propria linha. Negativo = deve. group_currency e a moeda da viagem, para a tela apresentar.';

-- O JOIN com expense_groups e novo e muda quem a view devolve: membro cujo
-- grupo desapareceu deixa de aparecer. Isso nao e alcancavel -- group_members
-- tem FK para expense_groups -- e o DELETE de grupo do 020 arquiva em vez de
-- apagar. E um JOIN, e nao LEFT JOIN, porque `group_currency` NULL seria pior:
-- a tela cairia no padrao BRL e mostraria uma viagem em dolar em reais.

-- ---------------------------------------------------------------------------
-- 5. A barra do orcamento, em BRL
-- ---------------------------------------------------------------------------
-- `budget_consumption` (006) compara gasto com `amount_limit`, e o teto e um
-- numero em reais digitado por uma pessoa. Converter o gasto e o que torna a
-- comparacao uma comparacao.
--
-- Unica diferenca em relacao ao 006: o `* t.exchange_rate` dentro do SUM. O
-- resto -- o ABS() pela despesa negativa, a janela de mes por `>= month` e
-- `< month + 1 mes`, o CASE que separa teto de grupo (por `group_id`) de teto
-- pessoal (por `user_id` com `group_id IS NULL`) -- e identico de proposito.
CREATE OR REPLACE VIEW public.budget_consumption AS
  SELECT
    b.id,
    b.user_id,
    b.category_id,
    b.group_id,
    b.month,
    b.amount_limit,
    b.alert_threshold,
    b.carry_forward,
    b.notes,
    b.created_at,
    b.updated_at,
    COALESCE(g.spent, 0)::numeric(15,2) AS spent,
    (b.amount_limit - COALESCE(g.spent, 0))::numeric(15,2) AS remaining,
    ROUND(COALESCE(g.spent, 0) / b.amount_limit, 4) AS consumed_ratio,
    CASE
      WHEN COALESCE(g.spent, 0) >= b.amount_limit THEN 'exceeded'
      WHEN COALESCE(g.spent, 0) >= b.amount_limit * b.alert_threshold THEN 'alert'
      ELSE 'ok'
    END AS consumption_status
  FROM public.budgets b
  LEFT JOIN LATERAL (
    SELECT SUM(ABS(t.amount) * t.exchange_rate) AS spent
    FROM public.financial_transactions t
    WHERE t.category_id = b.category_id
      AND t.transaction_type = 'expense'
      AND t.transaction_date >= b.month
      AND t.transaction_date < (b.month + INTERVAL '1 month')::date
      AND CASE
            WHEN b.group_id IS NOT NULL THEN t.group_id = b.group_id
            ELSE t.user_id = b.user_id AND t.group_id IS NULL
          END
  ) AS g ON TRUE;

COMMENT ON VIEW public.budget_consumption IS
  'budgets com o consumido, o que resta e o status (ok/alert/exceeded) calculados na leitura. Gasto convertido para BRL pela cotacao congelada de cada lancamento, que e a moeda de amount_limit.';

-- ---------------------------------------------------------------------------
-- 6. security_invoker e GRANTs, de novo, nas duas
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` preserva reloptions e GRANTs, entao em teoria o que
-- o 006 e o 007 concederam continua valendo. Esta secao existe porque "em
-- teoria" e o que separa esta migration de um vazamento: sem
-- `security_invoker`, a view roda com os direitos do DONO, a RLS nao se aplica,
-- e `group_member_balances` devolve o saldo de todos os grupos do app para
-- qualquer um logado. Repetir o ALTER e barato; descobrir que a preservacao nao
-- valia, nao. database/tests/view_security_invoker_test.sql tambem cobre isso.

ALTER VIEW public.group_member_balances SET (security_invoker = true);
ALTER VIEW public.budget_consumption SET (security_invoker = true);

REVOKE ALL ON public.group_member_balances FROM anon;
REVOKE ALL ON public.budget_consumption FROM anon;

GRANT SELECT ON public.group_member_balances TO authenticated;
GRANT SELECT ON public.budget_consumption TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. O que NAO entra aqui, e por que
-- ---------------------------------------------------------------------------
-- `scheduled_transactions` nao ganha cotacao. Ela e a conta PREVISTA, e a 022
-- ja resolveu o risco dela pelo outro caminho: `planned_vs_actual` tem a moeda
-- no grao e casa previsto com realizado por moeda, entao nao ha soma de moedas
-- diferentes para fechar. Uma cotacao numa data futura tambem nao existe: a
-- PTAX de uma conta que vence em marco nao esta disponivel hoje, e inventar uma
-- seria gravar chute com a mesma cara de cotacao confirmada.
--
-- Nao ha tabela de cotacoes diarias. A PTAX de uma data passada nunca muda,
-- entao ela seria um cache legitimo -- mas o cache que importa e a propria
-- coluna `exchange_rate` da linha, que e o unico numero que precisa sobreviver.
-- Uma tabela de referencia aqui custaria RLS e GRANT proprios e traria de volta
-- a armadilha de `transaction_categories`: tabela com GRANT SELECT sozinho, em
-- que o app tenta criar a linha que falta e leva 42501 para sempre.

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('026', '026_cambio_do_grupo',
        'Moeda do grupo e cambio do dia da compra congelado no lancamento; saldo de grupo e consumo de orcamento convertidos para BRL - HMO-138 item 3', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 27. 027_previsto_e_realizado_no_lancamento.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 027_previsto_e_realizado_no_lancamento.sql
--
-- HMO-188: "Despesas e Receitas devem ter o dia do lancamento, o dia previsto
-- para ser realizado, e assim como o usuario vai em uma despesa e confirma que
-- pagou, a receita ele deve confirmar que recebeu, se nao ela fica como
-- prevista."
--
-- Tres coisas, e uma delas e o conserto de um caminho de perda silenciosa que
-- ja existe hoje no banco.
--
-- ===========================================================================
-- ONDE O "PREVISTO" MORA, E POR QUE ELE NAO VAI MORAR EM financial_transactions
-- ===========================================================================
-- A leitura obvia do pedido seria: poe um `status` em `financial_transactions`,
-- 'previsto' enquanto ninguem confirmou, 'realizado' depois. Nao e o que esta
-- aqui, e a razao e concreta:
--
--   TODA linha de `financial_transactions` mexe no saldo da conta, no instante
--   do INSERT, por `update_account_balance_trigger` (001_baseline). E toda
--   linha entra em `monthly_cash_flow`, `budget_consumption`,
--   `group_member_balances`, `planned_vs_actual`, `net_worth` -- o universo
--   inteiro do REALIZADO.
--
-- Uma linha 'previsto' ali dentro sairia gastando dinheiro que nao saiu. Fechar
-- isso exigiria um `WHERE status = 'realizado'` em cada uma dessas views e um
-- trigger de saldo que soubesse a transicao -- ou seja: cada view esquecida
-- viraria um numero errado, plausivel, sem erro nenhum. E o app JA TEM o
-- universo do previsto, com confirmacao e estorno testados:
-- `scheduled_transactions` (005) + `POST /api/scheduled-transactions/{id}/pay`.
--
-- Entao a divisao fica: o que ainda nao aconteceu e uma linha de
-- `scheduled_transactions`; confirmar cria a linha de `financial_transactions`.
-- E exatamente o caminho que a despesa fixa e a fatura de cartao ja usam. O que
-- esta migration acrescenta e (a) a direcao, que falta, e (b) as duas datas, que
-- precisam SOBREVIVER a confirmacao.
--
-- ===========================================================================
-- O DEFEITO QUE A SECAO 1 FECHA: A PREVISAO NAO SABE PARA QUE LADO APONTA
-- ===========================================================================
-- `scheduled_transactions.amount` tem `CHECK (amount > 0)`: a ocorrencia nao
-- guarda sinal. Quem diz se aquilo entra ou sai e
-- `recurring_rules.transaction_type` -- da REGRA, nao da ocorrencia. E a rota de
-- baixa le assim:
--
--     conta.recurring_rule?.transaction_type ?? "expense"
--
-- Uma previsao AVULSA (`recurring_rule_id IS NULL`) nao tem regra. Ela cai no
-- `?? "expense"` e a baixa grava `valorComSinal(valor, 'expense')`, ou seja
-- NEGATIVO. Hoje isso nao machuca porque a unica tela que cria avulsa e
-- /dashboard/bills, e la toda avulsa e um boleto.
--
-- No minuto em que a tela de receita puder criar uma receita prevista avulsa --
-- que e literalmente o que a HMO-188 pede -- confirmar o recebimento de
-- R$ 7.000 gravaria `-7000`. O salario entraria TIRANDO dinheiro da conta, com
-- o valor certo, a descricao certa, a categoria certa e nenhum erro. A tela
-- mostraria "Receita confirmada". Mesma familia de
-- `transaction_type` NULL em `group_expense_splits` (HMO-182): a direcao perdida
-- no meio do caminho, e o saldo continuando plausivel.
--
-- Por isso a coluna vem ANTES do codigo que a precisa, e nao junto dele.
--
-- ===========================================================================
-- AS DUAS DATAS, E POR QUE `created_at` NAO BASTAVA
-- ===========================================================================
-- `created_at` e o instante em que a LINHA nasceu, e para o historico ele e
-- mesmo o dia do lancamento -- e dele que sai o backfill. Mas ele nao e
-- editavel e nao deve ser: quem edita `created_at` mente sobre a linha. O dia
-- do lancamento e um dado do usuario ("anotei isso no dia 28"), entao ele e
-- coluna propria.
--
-- `expected_date` nasce NULL e o NULL quer dizer "nao havia previsao separada":
-- o lancamento aconteceu no dia em que se esperava, ou ninguem registrou
-- expectativa. Preencher o historico com `transaction_date` seria inventar um
-- dado -- todo lancamento antigo passaria a afirmar que foi realizado
-- exatamente no dia previsto, e um relatorio de atraso sairia com zero atrasos
-- e cara de verdade.
--
-- NAO HA CHECK CRUZANDO AS DATAS, DE PROPOSITO
-- --------------------------------------------
-- Um `CHECK (expected_date >= launch_date)` parece higiene e e uma armadilha:
-- ele recusaria o caso comum de anotar hoje uma conta que venceu semana passada
-- ("esqueci de lancar o aluguel do dia 5"). E pior, ele quebraria a EDICAO de
-- qualquer linha antiga no dia em que alguem preenchesse `expected_date` nela,
-- porque `launch_date` daquela linha e a data em que ela foi criada. Migration
-- aditiva com CHECK cruzado e o jeito conhecido de derrubar o app que esta no
-- ar: o INSERT que funcionava ontem passa a voltar 23514 hoje.
--
-- ===========================================================================
-- COMO APLICAR
-- ===========================================================================
-- Producao nao tem runner de migration. Quem aplica e uma pessoa, colando este
-- arquivo INTEIRO no SQL Editor do Supabase. Por isso nao ha nenhum
-- meta-comando de psql (`\set`, `\i`) aqui: uma unica linha com barra invertida
-- reprova o arquivo todo no SQL Editor.
--
-- Re-executavel: rodar duas vezes nao muda nada.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A direcao da previsao
-- ---------------------------------------------------------------------------
-- NULL nao e "sem direcao": e "pergunte a regra". Isso mantem a leitura atual
-- exatamente como ela e para as ocorrencias geradas por `recurring_rules`, onde
-- a regra e a fonte de verdade e continua sendo -- editar a regra de "despesa"
-- para "receita" tem que reapontar as ocorrencias futuras dela, e uma copia
-- gravada em cada ocorrencia congelaria a direcao antiga.
--
-- A precedencia, que o codigo tem que respeitar na mesma ordem:
--
--     COALESCE(s.transaction_type, r.transaction_type, 'expense')
--
-- O 'expense' no fim e o que a rota de baixa ja faz hoje. Ele fica -- mas
-- passa a ser alcancavel so por linha antiga, porque o backfill abaixo
-- preenche as avulsas que existem e o codigo novo sempre manda a direcao.

ALTER TABLE public.scheduled_transactions
  ADD COLUMN IF NOT EXISTS transaction_type public.transaction_financial_type;

COMMENT ON COLUMN public.scheduled_transactions.transaction_type IS
  'Para que lado esta previsao aponta: income (vou receber) ou expense (vou pagar). NULL quer dizer "pergunte a recurring_rules.transaction_type da regra que gerou esta ocorrencia". A baixa le COALESCE(este, o da regra, ''expense''), e e ele que decide o SINAL do lancamento criado - sem ele toda receita prevista avulsa seria confirmada como despesa negativa.';

-- 'transfer' esta fora. Transferencia entre contas proprias e duas pernas que
-- se anulam (023/HMO-149), e uma previsao de transferencia nao tem valor para
-- "a vencer" nem para "a receber": ela nao muda patrimonio nenhum. Aceitar o
-- valor aqui criaria um terceiro caso que toda soma de agenda teria de tratar,
-- e o tratamento esquecido seria contar a perna de saida como despesa prevista.
--
-- Este CHECK e seguro num banco no ar porque a coluna acabou de nascer: nenhuma
-- linha existente pode viola-lo (todas sao NULL, ou 'expense' pelo backfill), e
-- nenhum INSERT que ja roda hoje manda a coluna. O teste prova a recusa sobre
-- VALUES, sem INSERT, e prova tambem que income e expense PASSAM -- uma trava
-- que recusa tudo tambem passaria na assercao de recusa.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scheduled_transactions_transaction_type_check'
  ) THEN
    ALTER TABLE public.scheduled_transactions
      ADD CONSTRAINT scheduled_transactions_transaction_type_check
      CHECK (transaction_type IS NULL OR transaction_type IN ('income', 'expense'));
  END IF;
END $$;

-- Backfill das AVULSAS, e so delas.
--
-- Toda previsao avulsa que existe hoje foi criada por /dashboard/bills, que so
-- cadastra conta a pagar, e toda baixa dela caiu no `?? "expense"`. Gravar
-- 'expense' aqui nao muda comportamento nenhum -- muda o fato de a linha
-- AFIRMAR o que o codigo estava assumindo. O `IS NULL` no WHERE e o que torna a
-- migration re-executavel sem reescrever uma direcao que alguem corrigiu depois.
--
-- As ocorrencias com regra ficam NULL: a regra continua mandando nelas.
UPDATE public.scheduled_transactions
   SET transaction_type = 'expense'
 WHERE recurring_rule_id IS NULL
   AND transaction_type IS NULL;

-- ---------------------------------------------------------------------------
-- 2. O dia do lancamento e o dia previsto, no lancamento
-- ---------------------------------------------------------------------------
-- Duas colunas em `financial_transactions`, e tres datas por linha no total:
--
--   launch_date       quando foi ANOTADO         (default: hoje)
--   expected_date     quando era esperado         (NULL = nao havia previsao)
--   transaction_date  quando ACONTECEU           (o que ja existia, e o que
--                                                 todo relatorio soma)
--
-- `transaction_date` nao muda de significado, e isso e deliberado: ele e a data
-- que `monthly_cash_flow`, `budget_consumption` e os relatorios do 008 usam
-- para dizer em que mes o dinheiro entrou ou saiu. Mexer no significado dele
-- reclassificaria o historico inteiro de mes.

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS launch_date date;

-- Backfill antes do NOT NULL. `created_at` tem DEFAULT now() desde o
-- 001_baseline, entao ele nao e NULL em nenhuma linha -- o COALESCE com
-- CURRENT_DATE existe para a linha teoricamente possivel em que alguem gravou
-- NULL explicito, que sem ele derrubaria o SET NOT NULL logo abaixo com uma
-- mensagem que nao diz qual linha.
UPDATE public.financial_transactions
   SET launch_date = COALESCE(created_at::date, CURRENT_DATE)
 WHERE launch_date IS NULL;

ALTER TABLE public.financial_transactions
  ALTER COLUMN launch_date SET DEFAULT CURRENT_DATE;

ALTER TABLE public.financial_transactions
  ALTER COLUMN launch_date SET NOT NULL;

COMMENT ON COLUMN public.financial_transactions.launch_date IS
  'O dia em que este lancamento foi ANOTADO (HMO-188). Nao e quando o dinheiro andou - isso e transaction_date, e e ele que todo relatorio soma. DEFAULT CURRENT_DATE: toda rota que nao manda a coluna grava hoje, que e a verdade. O historico foi preenchido de created_at::date.';

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS expected_date date;

COMMENT ON COLUMN public.financial_transactions.expected_date IS
  'O dia em que se esperava que este lancamento fosse realizado (HMO-188). NULL quer dizer "nao havia previsao separada", e nao "previsto para hoje" - o historico ficou NULL de proposito, porque copiar transaction_date aqui faria todo lancamento antigo AFIRMAR que saiu no dia previsto e um relatorio de atraso sairia com zero atrasos. Quando a linha nasceu da baixa de uma conta prevista, aqui fica o due_date dela.';

-- Quem lista lancamento por dia previsto precisa do indice; quem soma por mes
-- continua indo por `transaction_date`, que ja tem o seu. Parcial porque a
-- coluna e NULL na esmagadora maioria das linhas -- e um indice cheio gastaria
-- entrada para cada uma delas.
CREATE INDEX IF NOT EXISTS idx_transactions_expected_date
  ON public.financial_transactions (user_id, expected_date)
  WHERE expected_date IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. A view da agenda passa a dizer a direcao (e a moeda)
-- ---------------------------------------------------------------------------
-- `scheduled_transactions_effective` e de onde as tres rotas de leitura da
-- agenda leem. Ela precisa ser REFEITA, e nao `CREATE OR REPLACE`-ada, por um
-- detalhe do Postgres: o `SELECT s.*` do 005 foi EXPANDIDO na criacao, entao a
-- view nao ganha coluna nova sozinha, e `CREATE OR REPLACE` so aceita
-- acrescentar coluna no FIM -- com `s.*` a coluna nova entraria no meio (antes
-- de `effective_status`) e o comando falharia com "cannot change name of view
-- column". Nada depende desta view no banco (nenhuma outra view, nenhuma
-- funcao): o DROP e local.
--
-- Duas coisas entram:
--
--   * `transaction_type` e `direction`. A primeira e o que esta gravado na
--     ocorrencia; a segunda e a precedencia JA RESOLVIDA, para que nenhuma tela
--     precise refazer o COALESCE -- e a copia esquecida em uma das tres rotas
--     de leitura seria justamente uma receita prevista aparecendo como conta a
--     pagar. O LEFT JOIN nunca descarta linha: previsao avulsa nao tem regra, e
--     nesse caso as colunas da regra vem NULL e o COALESCE cai para a coluna
--     propria.
--
--   * `currency`. A 022 acrescentou a coluna em `scheduled_transactions` e esta
--     view nunca a expos, pelo mesmo `s.*` congelado -- as rotas fazem
--     `select("*")` e a moeda da previsao nunca chegou a tela nenhuma. Ela entra
--     aqui porque a view esta sendo refeita de qualquer forma, e porque uma
--     previsao em dolar exibida sem moeda se le como reais.
--
-- `security_invoker` e reposto no fim. Sem ele a view roda com o privilegio do
-- DONO e a RLS de `scheduled_transactions` deixa de valer: cada usuario veria a
-- agenda de todos. O teste tem controle negativo para isso.

DROP VIEW IF EXISTS public.scheduled_transactions_effective;

CREATE VIEW public.scheduled_transactions_effective AS
  SELECT
    s.id,
    s.user_id,
    s.recurring_rule_id,
    s.category_id,
    s.account_id,
    s.group_id,
    s.description,
    s.amount,
    s.due_date,
    s.status,
    s.paid_date,
    s.transaction_id,
    s.notes,
    s.created_at,
    s.updated_at,
    s.currency,
    s.transaction_type,
    -- Vencida e uma PERGUNTA, nao um estado gravado: quem gravasse 'overdue'
    -- precisaria de um cron a meia-noite para envelhecer a linha, e o dia em
    -- que o cron nao rodasse a conta apareceria em dia. Igual ao 005.
    CASE
      WHEN s.status = 'pending' AND s.due_date < CURRENT_DATE
        THEN 'overdue'::public.scheduled_status
      ELSE s.status
    END AS effective_status,
    (s.due_date - CURRENT_DATE) AS days_until_due,
    -- A precedencia, resolvida uma vez: ocorrencia, regra, e por fim o
    -- 'expense' historico que a rota de baixa sempre teve.
    COALESCE(
      s.transaction_type,
      r.transaction_type,
      'expense'::public.transaction_financial_type
    ) AS direction
  FROM public.scheduled_transactions s
  LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id;

COMMENT ON VIEW public.scheduled_transactions_effective IS
  'scheduled_transactions com o status vencido calculado na hora (nunca gravado) e a DIRECAO resolvida (HMO-188): direction = COALESCE(transaction_type da ocorrencia, transaction_type da regra, expense). Toda tela que separa "a pagar" de "a receber" le direction e nao refaz o COALESCE.';

ALTER VIEW public.scheduled_transactions_effective SET (security_invoker = true);

REVOKE ALL ON public.scheduled_transactions_effective FROM anon;
GRANT SELECT ON public.scheduled_transactions_effective TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. O que NAO entra aqui, e por que
-- ---------------------------------------------------------------------------
-- `scheduled_transactions` nao ganha `exchange_rate`. A 026 recusou isso com a
-- razao certa e ela continua valendo: a cotacao de uma data FUTURA nao existe, e
-- gravar um chute teria a mesma cara de uma cotacao confirmada. A consequencia
-- pratica, que o codigo tem que dizer na tela: um lancamento em moeda
-- estrangeira nao pode ficar "previsto" -- ele se lanca no dia em que a pessoa
-- confirma, que e o dia em que existe cotacao para congelar. Sem essa recusa, a
-- baixa de uma previsao em dolar cairia no DEFAULT (BRL, 1) e US$ 180 entrariam
-- como R$ 180.
--
-- `total_pending` de /api/scheduled-transactions/summary continua somando
-- receita prevista junto com despesa prevista num unico numero positivo -- o
-- bloco "A vencer" do painel anuncia R$ 9.588,50 quando o que vai sair sao
-- R$ 2.588,50 (medido em producao na HMO-186). Esta migration entrega o que
-- FALTAVA para consertar aquilo (`direction` na view), mas nao muda a rota:
-- dois consumidores leem `total_pending` e trocar o significado dele calado
-- substituiria um numero errado por outro. E issue propria.

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('027', '027_previsto_e_realizado_no_lancamento',
        'Dia do lancamento e dia previsto em financial_transactions; direcao (income/expense) na conta prevista, para a baixa de receita nao gravar despesa negativa - HMO-188', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 28. 028_fundamento_cvm.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 028_fundamento_cvm.sql
--
-- HMO-194 (entrega 4 da HMO-141): onde mora o fundamento de acao brasileira que
-- vem da DFP anual da CVM, para os crivos da entrega 5 terem de onde ler.
--
-- Esta migration nao tem tela. Ela cria tres tabelas e uma view.
--
-- ===========================================================================
-- POR QUE ISTO NAO E "user data", E O QUE ISSO MUDA NA RLS
-- ===========================================================================
-- O balanco da Petrobras nao pertence a ninguem: e o mesmo numero para todo
-- usuario do PuloDoGato, publicado pelo regulador. Entao estas tabelas seguem o
-- desenho de `transaction_categories` e `financial_services` (002_rls_lockdown),
-- nao o de `financial_transactions`:
--
--   - sem `user_id`, sem coluna de dono;
--   - RLS LIGADA com policy de SELECT para `authenticated`;
--   - GRANT de SELECT e nada mais. Nao ha policy de INSERT/UPDATE/DELETE para
--     papel de aplicacao NENHUM, porque quem escreve aqui e o ingestor, com a
--     service role, que passa por cima da RLS.
--
-- A consequencia esta documentada e vale de aviso para a entrega 5: uma rota que
-- tentar gravar aqui com o cliente normal do Supabase leva 42501 e o erro chega
-- como 500 dentro de um catch. Nao e bug da policy -- e o desenho.
--
-- ===========================================================================
-- A PONTE ticker -> CNPJ E UMA TABELA, NAO UMA FUNCAO
-- ===========================================================================
-- A CVM indexa por CNPJ e codigo CVM e nao sabe o que e um ticker. A ponte vem
-- da consulta aberta da B3, que busca SUBSTRING NO NOME da empresa, ordenada por
-- nome -- e por isso o primeiro resultado de `PETR4` e ACU PETROLEO S.A., o de
-- `VALE3` e ADECOAGRO VALE DO EVINHEMA e o de `RANI3` e GLOBAL X URANIUM ETF
-- (medido em 2026-09-30, 3 erros em 15 tickers).
--
-- O que torna isso perigoso: a empresa errada EXISTE, tem CNPJ valido e tem
-- balanco na CVM. Gravar o par errado nao produz erro nem linha vazia -- produz
-- o ROE de outra empresa. Por isso a ponte e material, auditavel e unica por
-- ticker (`cvm_ponte_ticker`), com a regra de casamento gravada na linha
-- (`criterio`): da para olhar depois e saber COMO cada par foi decidido.
--
-- E o ticker que nao casa por igualdade exata nao entra na ponte: vai para
-- `cvm_tickers_sem_fundamento`, que e o "para e registra" da issue. Espaco em
-- branco honesto na tela, em vez do numero da empresa parecida.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A ponte ticker -> empresa da CVM
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cvm_ponte_ticker (
  ticker            text PRIMARY KEY,
  -- O radical de 4 letras que a B3 devolve em `issuingCompany` (`PETR4` -> `PETR`).
  radical           text        NOT NULL,
  codigo_cvm        text        NOT NULL,
  -- So digitos, como a B3 devolve. Os CSVs da CVM usam a mascara; o ingestor formata.
  cnpj              text        NOT NULL,
  denominacao       text        NOT NULL,
  -- COMO este par foi decidido. Hoje sempre 'issuing_company_exato'; existe para
  -- que afrouxar a regra no futuro seja visivel linha por linha, em vez de virar
  -- uma mudanca de codigo que nao deixa rastro no dado que ela contaminou.
  criterio          text        NOT NULL DEFAULT 'issuing_company_exato',
  resolvido_em      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cvm_ponte_ticker_ticker_formato CHECK (ticker ~ '^[A-Z]{4}[0-9]{1,2}F?$'),
  CONSTRAINT cvm_ponte_ticker_radical_formato CHECK (radical ~ '^[A-Z]{4}$'),
  -- O radical TEM que ser o prefixo do ticker. Esta e a regra da issue escrita
  -- como constraint: sem ela, um ingestor com bug poderia pendurar o codigo CVM
  -- da Acu Petroleo no ticker PETR4 e o banco aceitaria calado.
  CONSTRAINT cvm_ponte_ticker_radical_do_ticker CHECK (left(ticker, 4) = radical),
  CONSTRAINT cvm_ponte_ticker_cnpj_formato CHECK (cnpj ~ '^[0-9]{14}$'),
  CONSTRAINT cvm_ponte_ticker_codigo_cvm_formato CHECK (codigo_cvm ~ '^[0-9]{1,8}$')
);

-- Dois tickers da MESMA empresa e normal e esperado (PETR3/PETR4, ITUB3/ITUB4),
-- entao `codigo_cvm` nao e unico. O que precisa ser rapido e o caminho inverso:
-- dado o codigo CVM, quais tickers dependem dele.
CREATE INDEX IF NOT EXISTS cvm_ponte_ticker_codigo_cvm_idx
  ON public.cvm_ponte_ticker (codigo_cvm);

-- ---------------------------------------------------------------------------
-- 2. O ticker que a ponte RECUSOU
-- ---------------------------------------------------------------------------
-- Sem esta tabela, "a PETR4 nao tem fundamento" e indistinguivel de "ninguem
-- tentou importar a PETR4" -- e as duas situacoes pedem acoes opostas.
CREATE TABLE IF NOT EXISTS public.cvm_tickers_sem_fundamento (
  ticker        text PRIMARY KEY,
  motivo        text        NOT NULL,
  -- Quantos resultados a B3 devolveu. `0` = nao existe nesse registro (o caso do
  -- FII: HGLG11, MXRF11 e KNRI11 voltam zero, porque fundo imobiliario nao e
  -- companhia listada e nao entrega DFP). `>0` = existe gente com o radical no
  -- nome, mas nenhuma casou por igualdade -- o caso perigoso.
  candidatos    integer     NOT NULL DEFAULT 0,
  tentado_em    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cvm_tickers_sem_fundamento_motivo CHECK (
    motivo IN ('ticker_fora_do_padrao', 'sem_casamento_exato', 'casamento_ambiguo',
               'sem_codigo_cvm', 'sem_dfp_no_pacote', 'dado_inconsistente')
  ),
  CONSTRAINT cvm_tickers_sem_fundamento_candidatos CHECK (candidatos >= 0)
);

-- ---------------------------------------------------------------------------
-- 3. As contas, por empresa e por exercicio
-- ---------------------------------------------------------------------------
-- So as poucas contas que os crivos usam -- nao o arquivo inteiro. Tudo em
-- REAIS: o ingestor ja aplicou `ESCALA_MOEDA` (MIL ou UNIDADE, as duas ocorrem
-- no mesmo pacote), porque guardar o numero cru deixaria a escala como um campo
-- que alguem precisa lembrar de multiplicar.
--
-- Valor NULO significa "a empresa nao publicou esta conta", que e diferente de
-- zero. Banco nao tem `3.02 Custo dos Bens Vendidos`; gravar 0 ali faria a
-- margem bruta de um banco valer 100%.
CREATE TABLE IF NOT EXISTS public.cvm_fundamentos (
  codigo_cvm        text    NOT NULL,
  ano_exercicio     integer NOT NULL,
  cnpj              text    NOT NULL,
  -- `DT_FIM_EXERC` do balanco de onde as contas sairam. E a data-base que a tela
  -- da entrega 5 mostra: sem ela, dois indicadores de datas diferentes ficam
  -- lado a lado parecendo do mesmo dia.
  data_base         date    NOT NULL,

  receita_liquida         numeric(20, 2),
  custo                   numeric(20, 2),
  lucro_liquido           numeric(20, 2),
  patrimonio_liquido      numeric(20, 2),
  divida_curto_prazo      numeric(20, 2),
  divida_longo_prazo      numeric(20, 2),
  caixa                   numeric(20, 2),
  aplicacoes_financeiras  numeric(20, 2),
  -- Dividendo + JCP, positivo, da coluna 'Patrimonio Liquido Consolidado' da
  -- DMPL. A coluna importa: a DMPL tem uma linha por componente do patrimonio, e
  -- somar todas conta o mesmo dividendo junto com os totais que ja o contem --
  -- medido na PETR4/2025, R$ 127,2 bi contra R$ 42,4 bi de verdade (3,00x).
  dividendos_distribuidos numeric(20, 2),

  -- Publicada como o arquivo publica, e sem escala declarada: `composicao_capital`
  -- NAO tem coluna de escala e as empresas divergem -- em 2025 a PETR4 declara
  -- 12.888.732.761 (unidades) e a VALE3 declara 4.539.007 (milhares). Guardamos
  -- para nao perder o dado, mas NENHUM indicador "por acao" sai daqui. Ver o
  -- comentario da view.
  quantidade_acoes        numeric(20, 0),

  importado_em      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (codigo_cvm, ano_exercicio),

  CONSTRAINT cvm_fundamentos_cnpj_formato CHECK (cnpj ~ '^[0-9]{14}$'),
  CONSTRAINT cvm_fundamentos_codigo_cvm_formato CHECK (codigo_cvm ~ '^[0-9]{1,8}$'),
  -- 2010 e o primeiro ano do portal de dados abertos da CVM.
  CONSTRAINT cvm_fundamentos_ano_plausivel CHECK (ano_exercicio BETWEEN 2010 AND 2100),
  -- A data-base tem que ser DO exercicio. Balanco de 2024 gravado na linha de
  -- 2025 e o erro que produz "lucro de 2025" com numero de 2024 -- e foi
  -- exatamente o erro que a referencia da issue trazia (o dividendo de R$ 101,2
  -- bi citado como 2025 e o de 2024; o de 2025 e R$ 42,4 bi).
  CONSTRAINT cvm_fundamentos_data_base_do_exercicio
    CHECK (extract(year FROM data_base) = ano_exercicio),
  -- Distribuicao negativa nao existe: o ingestor ja inverteu o sinal da DMPL.
  -- Se isto disparar, a conta 5.04.06 veio positiva e a empresa merece
  -- inspecao, nao um yield negativo na tela.
  CONSTRAINT cvm_fundamentos_dividendos_nao_negativos
    CHECK (dividendos_distribuidos IS NULL OR dividendos_distribuidos >= 0),
  CONSTRAINT cvm_fundamentos_acoes_positivas
    CHECK (quantidade_acoes IS NULL OR quantidade_acoes > 0),
  -- Uma linha em que TODA conta e nula nao e fundamento -- e uma linha que a
  -- view transformaria em card vazio com data-base, parecendo dado importado.
  -- Mesma razao do CHECK sobre `amount` que faltou nas views do 008.
  CONSTRAINT cvm_fundamentos_tem_alguma_conta CHECK (
    receita_liquida IS NOT NULL OR lucro_liquido IS NOT NULL
      OR patrimonio_liquido IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS cvm_fundamentos_ano_idx
  ON public.cvm_fundamentos (ano_exercicio DESC);

-- ---------------------------------------------------------------------------
-- 4. A view que o app le: ticker -> indicador
-- ---------------------------------------------------------------------------
-- O app pensa em ticker; o banco guarda por codigo CVM. A view faz a juncao e
-- deriva os indicadores, cada um por UMA fonte declarada.
--
-- Por que a derivacao esta aqui e nao no TypeScript: a regra "uma fonte por
-- indicador" so vale se houver UM lugar que a implemente. Duas implementacoes
-- (uma na view, uma no cliente) e como os tres P/L da PETR4 nascem -- a mesma
-- PETR4 tinha 4,79, 5,77 e 6,00 no mesmo dia, todos defensaveis, e um crivo
-- "P/L abaixo de 6" aprova ou reprova conforme quem calculou.
--
-- O que esta view NAO tem, de proposito: P/L, dividend yield e lucro por acao.
-- Os tres precisam de preco ou valor de mercado, que nao e CVM (vem da brapi, na
-- entrega 5), e os dois ultimos precisariam dividir por `quantidade_acoes`, cuja
-- escala o arquivo nao declara. Os indicadores daqui sao todos RAZAO entre dois
-- valores monetarios da mesma empresa no mesmo arquivo, e por isso imunes a
-- escala: o fator 1000 cancela em cima e embaixo.
DROP VIEW IF EXISTS public.cvm_indicadores;

CREATE VIEW public.cvm_indicadores AS
SELECT
  p.ticker,
  p.denominacao,
  f.codigo_cvm,
  f.cnpj,
  f.ano_exercicio,
  f.data_base,

  f.lucro_liquido,
  f.receita_liquida,
  f.patrimonio_liquido,

  -- ROE = lucro liquido (DRE con 3.11) / patrimonio liquido (BPP con 2.03).
  --
  -- O patrimonio tem que ser POSITIVO, nao apenas diferente de zero. Empresa com
  -- passivo a descoberto tem patrimonio negativo, e -50 de prejuizo sobre -100
  -- de patrimonio daria "ROE de 50%" -- que um crivo de rentabilidade aprovaria
  -- como se fosse a empresa mais lucrativa da lista. Quando o denominador troca
  -- de sinal a razao troca de significado, e nao existe leitura correta de
  -- "retorno sobre patrimonio" onde nao ha patrimonio.
  CASE WHEN f.patrimonio_liquido > 0
       THEN f.lucro_liquido / f.patrimonio_liquido END AS roe,

  CASE WHEN f.receita_liquida <> 0
       THEN f.lucro_liquido / f.receita_liquida END AS margem_liquida,

  -- `custo` vem NEGATIVO da DRE (3.02), entao soma-se para achar o lucro bruto.
  CASE WHEN f.receita_liquida <> 0 AND f.custo IS NOT NULL
       THEN (f.receita_liquida + f.custo) / f.receita_liquida END AS margem_bruta,

  -- Divida liquida = (curto + longo) - caixa - aplicacoes. `coalesce` nos quatro
  -- termos, mas so depois de exigir que exista ALGUMA das duas pernas de divida:
  -- sem isso, empresa que nao publicou divida nenhuma apareceria com divida
  -- liquida negativa igual ao caixa, parecendo caixa liquido de quem so nao
  -- reportou.
  CASE WHEN f.divida_curto_prazo IS NOT NULL OR f.divida_longo_prazo IS NOT NULL
       THEN coalesce(f.divida_curto_prazo, 0) + coalesce(f.divida_longo_prazo, 0)
            - coalesce(f.caixa, 0) - coalesce(f.aplicacoes_financeiras, 0)
       END AS divida_liquida,

  CASE WHEN f.patrimonio_liquido > 0
         AND (f.divida_curto_prazo IS NOT NULL OR f.divida_longo_prazo IS NOT NULL)
       THEN (coalesce(f.divida_curto_prazo, 0) + coalesce(f.divida_longo_prazo, 0)
             - coalesce(f.caixa, 0) - coalesce(f.aplicacoes_financeiras, 0))
            / f.patrimonio_liquido
       END AS divida_liquida_sobre_patrimonio,

  f.dividendos_distribuidos,
  f.quantidade_acoes,
  f.importado_em
FROM public.cvm_fundamentos f
JOIN public.cvm_ponte_ticker p ON p.codigo_cvm = f.codigo_cvm;

-- Sem `security_invoker` a view roda com o privilegio de quem a CRIOU (o dono do
-- schema), e nao de quem consulta -- furando a RLS das tabelas de baixo. Aqui as
-- duas tabelas sao publicas para `authenticated`, entao o efeito pratico seria
-- pequeno; a regra vale de qualquer forma, porque quem herdar esta view nao vai
-- reauditar as tabelas antes de acrescentar uma que tenha dono.
ALTER VIEW public.cvm_indicadores SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 5. RLS e privilegio
-- ---------------------------------------------------------------------------
ALTER TABLE public.cvm_ponte_ticker            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cvm_tickers_sem_fundamento  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cvm_fundamentos             ENABLE ROW LEVEL SECURITY;

-- Leitura para quem esta logado. `anon` fica de fora: fundamento e conteudo de
-- produto, nao de pagina publica, e `transaction_categories` so abriu para
-- `anon` porque o formulario de cadastro precisa da lista antes do login.
DROP POLICY IF EXISTS cvm_ponte_ticker_read ON public.cvm_ponte_ticker;
CREATE POLICY cvm_ponte_ticker_read ON public.cvm_ponte_ticker
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS cvm_fundamentos_read ON public.cvm_fundamentos;
CREATE POLICY cvm_fundamentos_read ON public.cvm_fundamentos
  FOR SELECT TO authenticated USING (TRUE);

-- `cvm_tickers_sem_fundamento` e diagnostico de ingestao, nao conteudo: a tela
-- mostra espaco em branco, nao o motivo. Fica sem policy nenhuma -- RLS ligada
-- e nenhuma policy nega tudo para papel de aplicacao, e a service role do
-- ingestor passa por cima. Ligar a RLS sem policy e proposital, nao esquecimento.

REVOKE ALL ON public.cvm_ponte_ticker           FROM anon, authenticated;
REVOKE ALL ON public.cvm_tickers_sem_fundamento FROM anon, authenticated;
REVOKE ALL ON public.cvm_fundamentos            FROM anon, authenticated;
REVOKE ALL ON public.cvm_indicadores            FROM anon, authenticated;

GRANT SELECT ON public.cvm_ponte_ticker TO authenticated;
GRANT SELECT ON public.cvm_fundamentos  TO authenticated;
GRANT SELECT ON public.cvm_indicadores  TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. O que NAO entra aqui, e por que
-- ---------------------------------------------------------------------------
-- ITR (trimestral) nao entra. A DFP e anual; o numero entre dois balancos vem de
-- outro pacote, no mesmo portal e no mesmo formato, e precisaria de outra chave
-- (ano + trimestre) nesta tabela. Fazer a chave "quase certa" agora obrigaria
-- uma migration de PRIMARY KEY depois, com dado dentro.
--
-- FII nao entra, e nao e limitacao de codigo: HGLG11, MXRF11 e KNRI11 voltam
-- ZERO resultados na B3 porque fundo imobiliario nao e companhia listada e nao
-- entrega DFP. ROE, margem e divida nao existem para FII por esta via -- o
-- informe mensal e outro regime e outro formato. Os tres caem em
-- `cvm_tickers_sem_fundamento` com `candidatos = 0`, que e a resposta honesta.
-- A decisao de o que mostrar para FII esta pendente com o Helio (HMO-141).
--
-- Valor de mercado, preco e P/L nao entram. Nao sao CVM. A mistura de fonte por
-- indicador e o defeito que a entrega 5 tem que evitar, e ela fica mais facil de
-- evitar se esta tabela simplesmente nao tiver onde guardar preco.

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('028', '028_fundamento_cvm',
        'Fundamento anual da CVM (DFP): ponte ticker->CNPJ por igualdade exata, contas que os crivos usam e view de indicadores com fonte unica por indicador - HMO-194', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ---------------------------------------------------------------------------
-- 29. 029_pedido_de_entrada_visivel.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 029_pedido_de_entrada_visivel.sql
--
-- HMO-190, segunda volta: "Usuario leticia.macoliver esta dizendo que ja faz
-- parte do grupo mas o grupo nao esta aparecendo para ela."
--
-- Ela nao estava enganada, nem confusa: o app disse isso pra ela, com todas as
-- letras. A 002 fechou a entrada por codigo assim -- grupo privado entra como
-- `pending` -- e a #112 deu ao admin como aprovar. O que ficou faltando e o
-- lado de quem pediu, e sao dois buracos que se somam.
--
-- ===========================================================================
-- BURACO 1: PEDIR DUAS VEZES RESPONDE UMA MENTIRA
-- ===========================================================================
-- `join_group_by_code` recusa com um unico SQLSTATE para dois estados que nao
-- sao a mesma coisa:
--
--     IF v_current IN ('active', 'pending') THEN
--       RAISE EXCEPTION 'ja e membro (%)', v_current USING ERRCODE = 'unique_violation';
--
-- e app/api/expense-groups/join/route.ts traduz 23505 -- os dois -- para
-- "You are already a member of this group".
--
-- Para quem esta `active` isso e verdade e nao machuca: o grupo aparece na
-- lista dela. Para quem esta `pending` e falso em cima de invisivel. O
-- caminho que a Leticia percorreu foi exatamente esse:
--
--   1. digitou o codigo   -> virou `pending`, viu "aguardando aprovacao";
--   2. o grupo nao apareceu (nem podia: veja o buraco 2);
--   3. digitou de novo    -> "voce ja e membro deste grupo";
--   4. foi falar com o dono do grupo dizendo que ja fazia parte.
--
-- O passo 3 e o defeito. Repetir um pedido que continua pendente NAO e um
-- erro -- e a mesma pessoa, no mesmo grupo, pedindo a mesma coisa que ja esta
-- na fila. A resposta certa e repetir o estado, nao inventar um membro. Entao
-- `pending` deixa de levantar excecao e passa a RETORNAR, com
-- member_status = 'pending', que e o que a rota ja sabe apresentar como
-- "aguardando aprovacao". O 23505 fica so para `active`, onde ele e honesto.
--
-- Isso torna a funcao idempotente para o pedido pendente, e de proposito: e a
-- unica leitura que nao produz uma afirmacao falsa em algum dos dois estados.
-- O retorno acontece ANTES do INSERT/ON CONFLICT, entao o pedido original
-- preserva o `updated_at` de quando foi mesmo feito -- pedir de novo nao
-- rejuvenesce a fila do admin.
--
-- `removed` e `inactive` continuam caindo no ON CONFLICT DO UPDATE de antes:
-- quem saiu (ou foi tirado) pode pedir de novo, e ai e um pedido novo mesmo.
--
-- ===========================================================================
-- BURACO 2: DEPOIS DE PEDIR, O APP NAO MOSTRA VESTIGIO NENHUM
-- ===========================================================================
-- Nao e a lista de grupos que esconde o pedido -- e a RLS, e ela esta certa:
--
--     is_group_member(g)      := EXISTS (... AND status = 'active')
--     expense_groups_select   := created_by = auth.uid() OR is_group_member(id)
--
-- Quem esta `pending` nao e membro, entao a linha de `expense_groups` e
-- invisivel para ela. Isso e o que a gente quer: pendente nao pode ler o grupo
-- -- nem as despesas, nem quem mais esta dentro. Afrouxar
-- `expense_groups_select` para incluir pendente resolveria a tela e abriria o
-- conteudo do grupo junto. Nao e o negocio.
--
-- Mas ela PODE ler a propria linha de `group_members` (`group_members_select`
-- ja tem `user_id = auth.uid()`), e essa linha so tem o `group_id`: um UUID,
-- que nao da tela nenhuma. O que falta e o nome do grupo -- e so o nome.
--
-- Dai `my_pending_group_requests()`: SECURITY DEFINER, sem argumento, devolve
-- SO as linhas `pending` do proprio chamador, e de cada grupo devolve apenas
-- id, nome e quando o pedido foi feito. Nao devolve descricao, nem
-- `group_code`, nem membros, nem se o grupo tem despesa. Nao da para passar o
-- grupo de outra pessoa como argumento porque nao ha argumento: o filtro e
-- `user_id = auth.uid()`, dentro da funcao.
--
-- O que ela revela, entao, e o nome de um grupo em que a propria chamadora ja
-- registrou um pedido -- ou seja, um grupo cujo codigo ela ja provou conhecer,
-- porque foi digitando o codigo certo que a linha `pending` nasceu. Nenhuma
-- linha nova fica alcancavel por causa desta funcao.

-- =====================================================
-- SECAO 1: PEDIDO PENDENTE REPETIDO NAO E "JA E MEMBRO"
-- =====================================================
-- Reescrita inteira (CREATE OR REPLACE) porque plpgsql nao tem como alterar um
-- ramo isolado. Fora o bloco de `v_current`, o corpo e o mesmo da 002.

CREATE OR REPLACE FUNCTION public.join_group_by_code(p_group_code TEXT)
RETURNS TABLE (group_id UUID, group_name TEXT, member_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- use_column: as colunas de saida (group_id, ...) tem o mesmo nome de colunas
-- de group_members. Sem esta diretiva, o ON CONFLICT abaixo nao compila
-- ("column reference group_id is ambiguous").
#variable_conflict use_column
DECLARE
  v_group   public.expense_groups%ROWTYPE;
  v_status  TEXT;
  v_current TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_group
  FROM public.expense_groups
  WHERE group_code = UPPER(p_group_code) AND is_active = TRUE;

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'grupo nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;

  -- alias obrigatorio: sem ele, `group_id` colide com a coluna de saida da
  -- funcao (RETURNS TABLE) e o Postgres recusa com "column reference ambiguous".
  SELECT gm.status INTO v_current
  FROM public.group_members gm
  WHERE gm.group_id = v_group.id
    AND gm.user_id = auth.uid();

  -- Ja e membro de fato: 23505, e a rota responde "voce ja e membro". Verdade,
  -- e verificavel -- o grupo esta na lista dela.
  IF v_current = 'active' THEN
    RAISE EXCEPTION 'ja e membro (%)', v_current USING ERRCODE = 'unique_violation';
  END IF;

  -- Ja pediu e continua na fila: repete o estado em vez de chamar de erro.
  -- Sai ANTES do INSERT de proposito, para nao reescrever `updated_at`: a
  -- ordem da fila do admin e a ordem em que as pessoas pediram, nao a ordem em
  -- que elas voltaram para conferir.
  IF v_current = 'pending' THEN
    RETURN QUERY SELECT v_group.id, v_group.name, 'pending'::TEXT;
    RETURN;
  END IF;

  v_status := CASE WHEN v_group.group_type = 'public' THEN 'active' ELSE 'pending' END;

  INSERT INTO public.group_members AS gm (group_id, user_id, role, status)
  VALUES (v_group.id, auth.uid(), 'member', v_status)
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET status = v_status, updated_at = NOW();

  RETURN QUERY SELECT v_group.id, v_group.name, v_status;
END $$;

REVOKE ALL ON FUNCTION public.join_group_by_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_group_by_code(TEXT) TO authenticated;

-- =====================================================
-- SECAO 2: A PESSOA CONSEGUE VER QUE TEM UM PEDIDO NA FILA
-- =====================================================
-- Precisa ser DEFINER pelo mesmo motivo da `join_group_by_code`: o nome do
-- grupo esta em `expense_groups`, que a RLS esconde de quem ainda nao e membro
-- ativo. A diferenca e que aqui a autorizacao nao e "conhece o codigo" e sim
-- "ja tem uma linha pending sua neste grupo" -- que e um fato do banco, checado
-- na propria query, e nao algo que o chamador afirma.
--
-- Sem argumento por decisao de seguranca: nao ha nada que o chamador possa
-- passar para apontar a funcao para o grupo de outra pessoa.

CREATE OR REPLACE FUNCTION public.my_pending_group_requests()
RETURNS TABLE (group_id UUID, group_name TEXT, requested_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- `joined_at` (nao `created_at`: a tabela nao tem essa coluna) e preenchido
  -- por DEFAULT now() no INSERT que criou o pedido. Numa linha `pending` ele e
  -- quando a pessoa PEDIU -- ninguem entrou em nada ainda.
  SELECT g.id, g.name, gm.joined_at
  FROM public.group_members gm
  JOIN public.expense_groups g ON g.id = gm.group_id
  WHERE gm.user_id = auth.uid()
    AND gm.status = 'pending'
    AND g.is_active = TRUE
  ORDER BY gm.joined_at DESC;
$$;

-- auth.uid() e NULL para `anon`, entao a funcao ja devolveria zero linha; o
-- REVOKE e para nao depender disso.
REVOKE ALL ON FUNCTION public.my_pending_group_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_pending_group_requests() TO authenticated;


-- ---------------------------------------------------------------------------
-- 30. 030_convite_de_grupo_no_app.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 030_convite_de_grupo_no_app.sql
--
-- HMO-196: "Convite de grupo nao e entregue".
--
-- A HMO-190 deixou escrito que o envio de convite "NUNCA existiu" e que faltava
-- escolher um canal (provedor de email x botao de compartilhar). O H. escolheu
-- um terceiro: "Nao usaremos email, sera enviando um convite para o usuario
-- referente daquele email" -- convite DENTRO do app, para a conta dona daquele
-- endereco.
--
-- E aqui vem a parte que a descricao da issue erra, e vale registrar porque ela
-- muda o tamanho do conserto: esse canal JA ESTAVA TODO CONSTRUIDO. Existe o
-- sino (`components/ui/notifications.tsx`), ele ja tem os botoes Aceitar e
-- Rejeitar, existe o hook que busca os convites (`lib/hooks/useNotifications.ts`)
-- e existe a rota que aceita (`/api/expense-groups/join` com `invitation_id`).
-- A RLS da 002 ja foi escrita pensando nesse fluxo: `group_invitations_select`
-- tem `invited_user_id = auth.uid()`, e `group_members_insert` tem
-- `has_pending_invitation(group_id)`.
--
-- Medido em producao (projeto odxqjvtxsioksguuevqm, 2026-09-30):
--
--     pg_stat_all_tables.n_tup_ins  group_invitations = 5
--     get_user_by_email('leticia.macoliver@gmail.com')
--       -> 6582dc50-455b-46d4-ae62-eedf85cbd83e   (conta existe e esta confirmada)
--
-- Ou seja: os convites foram gravados, e a pessoa convidada existe. Nao faltava
-- envio. O convite estava lá, endereçado a ela, e o app nao mostrava.
--
-- ===========================================================================
-- POR QUE O SINO FICAVA VAZIO
-- ===========================================================================
-- O hook lia o convite com dois embeds do PostgREST:
--
--     group:expense_groups(name, description, group_code)
--     inviter:profiles!group_invitations_invited_by_fkey(full_name, avatar_url)
--
-- Os dois caem na RLS de quem esta lendo -- a convidada:
--
--     expense_groups_select         := created_by = auth.uid() OR is_group_member(id)
--     profiles_select_own_or_public := id = auth.uid() OR is_public = true
--
-- Ela nao criou o grupo e nao e membro (o convite nao cria linha em
-- `group_members`): o grupo e invisivel. E quem convidou nao e ela e nao tem
-- perfil publico: o inviter e invisivel. PostgREST nao levanta erro nesse caso,
-- devolve `null` em cada embed -- e o hook entao descarta a linha:
--
--     if (!invite.group || !invite.inviter) { console.warn(...); return false; }
--
-- O convite existia, era legivel, e era jogado fora na ultima linha do caminho,
-- num console.warn. Reproduzido contra a cadeia inteira num Postgres 17 limpo:
-- o SELECT em `group_invitations` devolve 1, e os dois embeds devolvem 0.
--
-- As duas policies estao CERTAS e nao sao afrouxadas aqui. Quem foi convidado e
-- ainda nao aceitou nao pode ler o grupo (despesas, membros) nem varrer perfil
-- alheio. O que falta e o mesmo que faltava no pedido por codigo: uma funcao que
-- devolva o pouco que a tela precisa -- e so isso -- checando a autorizacao
-- dentro dela. Mesmo desenho da `my_pending_group_requests()`.
--
-- ===========================================================================
-- E O ACEITE TAMBEM ESTAVA QUEBRADO, PELO MESMO MOTIVO
-- ===========================================================================
-- Nao e so a lista. `/api/expense-groups/join` lia o convite com
-- `group:expense_groups(id, name, ...)` e depois respondia
-- `invitation.group.name`. Com o embed nulo isso e um TypeError, que o catch
-- transforma em 500 "Internal server error". Entao mesmo que a convidada tivesse
-- visto o convite, aceitar devolveria erro de servidor. Por isso o aceite passa a
-- ser uma funcao: uma transacao, sem depender de embed que a RLS esconde.
--
-- Nada de schema muda aqui: nenhuma tabela, coluna, indice ou policy. Sao duas
-- funcoes novas, as duas CREATE OR REPLACE, entao o arquivo e idempotente e pode
-- ser colado no SQL Editor mais de uma vez.

-- =====================================================
-- SECAO 1: A PESSOA CONVIDADA VE O PROPRIO CONVITE
-- =====================================================
-- SECURITY DEFINER porque o nome do grupo e o nome de quem convidou estao em
-- duas tabelas que a RLS esconde de quem ainda nao aceitou -- e e exatamente
-- essa a informacao sem a qual o convite nao pode ser apresentado ("Fulano te
-- convidou para o grupo Tal").
--
-- Sem argumento, pelo mesmo motivo da `my_pending_group_requests()`: nao ha nada
-- que o chamador possa passar para apontar a funcao para o convite de outra
-- pessoa. O filtro e `gi.invited_user_id = auth.uid()`, dentro do corpo.
--
-- O que ela expoe, no maximo: o nome/descricao de um grupo para o qual um admin
-- daquele grupo deliberadamente convidou esta pessoa, e o nome de quem convidou.
--
-- `group_code` NAO entra de proposito, embora o sino antigo o exibisse. Quem
-- aceita vira membro e passa a ver o codigo pela tela do grupo; quem recusa nao
-- tem por que sair com um codigo de entrada na mao. Os botoes Aceitar/Recusar
-- nao precisam dele.
CREATE OR REPLACE FUNCTION public.list_my_group_invitations()
RETURNS TABLE (
  invitation_id      UUID,
  group_id           UUID,
  group_name         TEXT,
  group_description  TEXT,
  inviter_name       TEXT,
  inviter_avatar_url TEXT,
  invite_message     TEXT,
  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gi.id,
         g.id,
         g.name,
         g.description,
         p.full_name,
         p.avatar_url,
         gi.message,
         gi.expires_at,
         gi.created_at
  FROM public.group_invitations gi
  JOIN public.expense_groups g ON g.id = gi.group_id
  -- LEFT JOIN por defesa, nao por necessidade: `group_invitations.invited_by` e
  -- NOT NULL com FK para `profiles(id)`, entao hoje a linha sempre existe (e se
  -- o perfil for apagado, o ON DELETE CASCADE leva o convite junto). O que E
  -- alcancavel, e o caso da propria HMO-196, e `full_name` NULO: a Leticia em
  -- producao tem conta confirmada e `full_name = null`. Por isso nao ha filtro
  -- `p.full_name IS NOT NULL` aqui -- um convite nao pode desaparecer porque
  -- quem convidou nunca preencheu o nome. Quem trata o nulo e a tela.
  LEFT JOIN public.profiles p ON p.id = gi.invited_by
  WHERE gi.invited_user_id = auth.uid()
    AND gi.status = 'pending'
    AND gi.expires_at > NOW()
    AND g.is_active = TRUE
  ORDER BY gi.created_at DESC;
$$;

-- auth.uid() e NULL para `anon`, entao a funcao ja devolveria zero linha; o
-- REVOKE e para nao depender disso.
REVOKE ALL ON FUNCTION public.list_my_group_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_group_invitations() TO authenticated;

-- =====================================================
-- SECAO 2: ACEITAR OU RECUSAR, NUMA TRANSACAO
-- =====================================================
-- A RLS da 002 permitiria os tres passos soltos (ler o convite proprio, se
-- inserir em `group_members` via `has_pending_invitation`, marcar o convite como
-- respondido). Eles viram uma funcao por tres motivos:
--
--   1. atomicidade. Solto, o passo 2 pode gravar o membro e o passo 3 falhar: a
--      pessoa entra no grupo e o convite fica `pending` para sempre, entao o sino
--      continua oferecendo Aceitar um convite ja aceito;
--   2. o nome do grupo na resposta ("Voce entrou no grupo X") vem de
--      `expense_groups`, que a RLS ainda esconde no instante em que a funcao
--      comeca -- era isso que estourava TypeError -> 500 na rota;
--   3. `FOR UPDATE` no convite. Dois cliques em Aceitar sao duas requisicoes
--      concorrentes; sem o lock as duas passam pelo mesmo `status = 'pending'`.
--
-- A autorizacao e checada aqui dentro e NAO e "o chamador mandou um id": o
-- convite tem que estar endereçado a `auth.uid()`. Passar o id do convite de
-- outra pessoa nao encontra linha nenhuma.
CREATE OR REPLACE FUNCTION public.respond_to_group_invitation(
  p_invitation_id UUID,
  p_accept        BOOLEAN
)
RETURNS TABLE (group_id UUID, group_name TEXT, member_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- use_column: as colunas de saida (group_id, ...) repetem nomes de colunas de
-- group_members, e sem a diretiva o ON CONFLICT abaixo nao compila. Mesma
-- armadilha da join_group_by_code.
#variable_conflict use_column
DECLARE
  v_invitation public.group_invitations%ROWTYPE;
  v_group      public.expense_groups%ROWTYPE;
  v_current    TEXT;
  v_status     TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao autenticado' USING ERRCODE = '28000';
  END IF;

  -- O filtro por invited_user_id E a autorizacao. FOR UPDATE serializa dois
  -- cliques simultaneos no mesmo convite.
  SELECT * INTO v_invitation
  FROM public.group_invitations gi
  WHERE gi.id = p_invitation_id
    AND gi.invited_user_id = auth.uid()
    AND gi.status = 'pending'
    AND gi.expires_at > NOW()
  FOR UPDATE;

  IF v_invitation.id IS NULL THEN
    RAISE EXCEPTION 'convite nao encontrado, expirado ou ja respondido'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_group
  FROM public.expense_groups g
  WHERE g.id = v_invitation.group_id AND g.is_active = TRUE;

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'grupo nao esta mais ativo' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT p_accept THEN
    UPDATE public.group_invitations
       SET status = 'rejected', responded_at = NOW(), updated_at = NOW()
     WHERE id = v_invitation.id;

    RETURN QUERY SELECT v_group.id, v_group.name, 'rejected'::TEXT;
    RETURN;
  END IF;

  -- alias obrigatorio: `group_id` sem qualificar colide com a coluna de saida.
  SELECT gm.status INTO v_current
  FROM public.group_members gm
  WHERE gm.group_id = v_group.id
    AND gm.user_id = auth.uid();

  IF v_current = 'active' THEN
    -- Ja e membro (entrou pelo codigo e foi aprovada antes de abrir o sino, por
    -- exemplo). Nao e erro: e o estado que o convite pedia. Fecha o convite para
    -- o sino parar de oferecer, e responde o estado de verdade.
    v_status := 'active';
  ELSE
    -- Convite de admin entra como 'active' -- diferente da entrada por codigo em
    -- grupo privado, que nasce 'pending' porque ninguem chamou aquela pessoa.
    -- Aqui um admin do grupo enderecou o convite a ela, e aceitar E a aprovacao.
    v_status := 'active';

    INSERT INTO public.group_members AS gm (group_id, user_id, role, status)
    VALUES (v_group.id, auth.uid(), 'member', v_status)
    ON CONFLICT (group_id, user_id)
    DO UPDATE SET status = v_status, updated_at = NOW();
  END IF;

  UPDATE public.group_invitations
     SET status = 'accepted', responded_at = NOW(), updated_at = NOW()
   WHERE id = v_invitation.id;

  RETURN QUERY SELECT v_group.id, v_group.name, v_status;
END $$;

REVOKE ALL ON FUNCTION public.respond_to_group_invitation(UUID, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_group_invitation(UUID, BOOLEAN)
  TO authenticated;


-- ---------------------------------------------------------------------------
-- 31. 031_renda_fixa_indexada.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 031_renda_fixa_indexada.sql
--
-- HMO-192 (entrega 2 da HMO-141): onde mora "110% do CDI".
--
-- O tipo `fixed_income` existe no CHECK de `investment_assets` desde a 021, mas
-- a unica coisa que a 021 sabe guardar de um ativo e `current_price` -- o preco
-- que o USUARIO digita. Para acao isso e uma limitacao aceitavel (ele abre o
-- home broker e le o numero). Para um CDB de 110% do CDI e diferente: nao existe
-- "cotacao" para ele consultar em lugar nenhum. O valor de hoje e uma CONTA --
-- principal, indexador, percentual, dias corridos desde a aplicacao -- e o app
-- tem todos os ingredientes menos os quatro que esta migration acrescenta.
--
-- Sem isto, renda fixa no PuloDoGato so funciona se a pessoa reabrir a tela todo
-- mes e reescrever o valor na mao. Que e exatamente o trabalho que ela esperava
-- nao ter mais ao cadastrar o ativo.
--
-- ===========================================================================
-- POR QUE SAO DUAS COLUNAS DE TAXA, E NAO UMA
-- ===========================================================================
-- `index_percentage` e `spread_annual` parecem redundantes e nao sao. Renda fixa
-- brasileira remunera de tres formas que NAO cabem no mesmo numero:
--
--   CDB 110% do CDI       -> percentual DO INDICE   (index_percentage = 110)
--   Tesouro IPCA+ 6%      -> indice MAIS um spread  (spread_annual     = 6)
--   CDB prefixado 13% a.a -> taxa absoluta, sem indice (spread_annual  = 13)
--
-- Uma coluna `rate` unica guardaria 110 e 13 lado a lado com significados
-- diferentes. O erro que isso produz nao e um erro: e um CDB prefixado rendendo
-- 110% de um indice que ele nao acompanha -- 13 vezes o rendimento real, sem
-- nenhuma linha vermelha em lugar nenhum. Duas colunas com CHECK cruzado tornam
-- a combinacao sem sentido impossivel de gravar.
--
-- ===========================================================================
-- POR QUE `applied_date` NAO E SO DECORACAO
-- ===========================================================================
-- E ela que decide a ALIQUOTA DE IR. A tabela do IR de renda fixa e regressiva e
-- contada em dias CORRIDOS desde a aplicacao:
--
--   ate 180 dias   22,5%
--   181 a 360      20,0%
--   361 a 720      17,5%
--   acima de 720   15,0%
--
-- Sem a data de aplicacao gravada, o liquido estimado da tela seria um chute com
-- cara de numero. Com ela, e uma conta.
--
-- Quando ela for NULA (ativo cadastrado antes desta migration), a projecao cai
-- para a data da primeira COMPRA do ativo, em `investment_transactions`, e a tela
-- avisa que o prazo veio de la -- ver lib/renda-fixa.ts. Sao quase sempre a mesma
-- data, e a alternativa (nao mostrar rendimento nenhum) puniria justamente quem
-- cadastrou antes. O que a tela NAO faz e escolher uma aliquota sem ter prazo
-- nenhum de onde tirar.
--
-- ===========================================================================
-- `fixed_income_product`: O CAMPO QUE EVITA COBRAR IR DE QUEM E ISENTO
-- ===========================================================================
-- A issue pede quatro campos (indexador, percentual, aplicacao, vencimento) e
-- esta migration acrescenta um quinto, de proposito: o PRODUTO.
--
-- LCI, LCA, CRI, CRA, debenture incentivada e poupanca sao ISENTAS de IR para
-- pessoa fisica. Nelas o liquido e IGUAL ao bruto, e descontar 22,5% mostraria
-- a pessoa um rendimento menor do que ela vai receber de verdade -- errando
-- contra ela, no unico numero que ela abriu a tela para ver.
--
-- E a isencao NAO da para derivar do indexador: uma LCI de 95% do CDI e um CDB
-- de 95% do CDI tem o mesmo indexador, o mesmo percentual, o mesmo prazo, e
-- aliquotas diferentes. Sem esta coluna, o requisito "LCI e LCA sao isentas" da
-- propria issue seria impossivel de cumprir com o dado que existe no banco.
--
-- `outro` existe para nao travar quem tem um papel que nao esta na lista. O
-- codigo trata `outro` e NULO como TRIBUTADOS -- e o lado seguro do erro:
-- subestima o liquido de um isento (e a pessoa recebe mais do que a tela
-- prometeu) em vez de prometer um liquido que o Leao vai cortar.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION NAO FAZ
-- ===========================================================================
-- Nao cria tabela de historico do CDI. A serie 12 do Banco Central e publica,
-- de graca e sem cadastro (ver lib/cdi.ts); cachear em tabela propria seria uma
-- segunda fonte de verdade para manter sincronizada em troca de milissegundos.
--
-- Nao torna nenhum campo OBRIGATORIO para `fixed_income`. Ha linhas de renda
-- fixa cadastradas em producao desde a 021, todas sem estes campos, e um NOT
-- NULL aqui quebraria a tela delas na hora em que este arquivo fosse colado no
-- SQL Editor. O preenchimento e progressivo: quem editar o ativo ganha o
-- rendimento automatico, quem nao editar continua com o preco na mao.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. As colunas
-- ---------------------------------------------------------------------------
-- Todas NULAVEIS, e o ADD COLUMN vem antes de qualquer CHECK -- a ordem importa
-- para a re-execucao: um CHECK que cite coluna que ainda nao existe aborta o
-- lote inteiro, e no SQL Editor "lote inteiro" e o arquivo.

ALTER TABLE public.investment_assets
  ADD COLUMN IF NOT EXISTS fixed_income_product text,
  ADD COLUMN IF NOT EXISTS index_kind           text,
  ADD COLUMN IF NOT EXISTS index_percentage     numeric(8,4),
  ADD COLUMN IF NOT EXISTS spread_annual        numeric(8,4),
  ADD COLUMN IF NOT EXISTS applied_date         date,
  ADD COLUMN IF NOT EXISTS maturity_date        date;

-- ---------------------------------------------------------------------------
-- 2. As constraints
-- ---------------------------------------------------------------------------
-- Todas tem nome fixo, entao o par `DROP CONSTRAINT IF EXISTS` + `ADD
-- CONSTRAINT` e o que torna o arquivo re-executavel. (A 021 documenta o caso em
-- que esse par NAO serve: quando um indice de constraint tem dependente, o DROP
-- falha com "other objects depend on it". Nenhuma destas tem dependente.)

-- Os indexadores que lib/renda-fixa.ts sabe projetar. Acrescentar valor aqui sem
-- tocar naquele arquivo produz um ativo que a tela mostra sem rendimento e sem
-- explicar por que -- o CHECK e o que mantem os dois lados juntos.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_index_kind_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_index_kind_check
  CHECK (index_kind IS NULL OR index_kind IN ('cdi', 'selic', 'ipca', 'igpm', 'prefixado', 'poupanca'));

ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_fixed_income_product_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_fixed_income_product_check
  CHECK (fixed_income_product IS NULL OR fixed_income_product IN (
    -- Tributados pela tabela regressiva.
    'cdb', 'rdb', 'lc', 'debenture',
    -- Isentos de IR para pessoa fisica.
    'lci', 'lca', 'cri', 'cra', 'debenture_incentivada', 'poupanca',
    -- Escape: tratado como TRIBUTADO pelo codigo.
    'outro'
  ));

-- 110% do CDI e 110; 0% nao e investimento e negativo nao existe. O teto de
-- 1000% nao pretende ser uma regra de mercado -- e um limite de digitacao: sem
-- ele, "11000" no lugar de "110" projeta um rendimento cem vezes maior e a tela
-- mostra isso com toda a confianca.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_index_percentage_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_index_percentage_check
  CHECK (index_percentage IS NULL OR (index_percentage > 0 AND index_percentage <= 1000));

-- Spread em pontos percentuais ao ano. Zero e valido (IPCA puro, sem juro real);
-- negativo, nao -- papel que rende menos que a inflacao nao e vendido assim, e
-- um sinal invertido aqui viraria rendimento negativo silencioso.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_spread_annual_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_spread_annual_check
  CHECK (spread_annual IS NULL OR (spread_annual >= 0 AND spread_annual <= 100));

-- "110% de que?" -- percentual sem indexador nao tem significado nenhum.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_percentual_exige_indexador;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_percentual_exige_indexador
  CHECK (index_percentage IS NULL OR index_kind IS NOT NULL);

-- Prefixado NAO acompanha indice: os 13% dele sao a taxa inteira, e moram em
-- `spread_annual`. Um `index_percentage` preenchido aqui seria percentual de um
-- indice que nao existe na linha -- exatamente o erro que as duas colunas
-- existem para impedir.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_prefixado_sem_percentual;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_prefixado_sem_percentual
  CHECK (index_kind IS DISTINCT FROM 'prefixado' OR index_percentage IS NULL);

-- Vencimento depois da aplicacao. Igual tambem nao serve: prazo zero divide por
-- zero em qualquer projecao de rendimento.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_vencimento_depois_da_aplicacao;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_vencimento_depois_da_aplicacao
  CHECK (applied_date IS NULL OR maturity_date IS NULL OR maturity_date > applied_date);

-- Aplicacao no futuro e erro de digitacao no ano, e ela nao e um campo qualquer:
-- e o inicio da contagem do IR. Uma data em 2027 devolve prazo negativo e, com
-- ele, aliquota de 22,5% sobre um rendimento que a conta nem deveria ter
-- produzido. O `+ 1` acompanha o CHECK de `trade_date` da 021 -- fuso do cliente
-- adiantado em relacao ao UTC do servidor.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_applied_date_nao_futura;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_applied_date_nao_futura
  CHECK (applied_date IS NULL OR applied_date <= (now() AT TIME ZONE 'UTC')::date + 1);

-- Os seis campos so fazem sentido em `fixed_income`. Uma PETR4 com indexador nao
-- e recusada por nenhum CHECK acima e apareceria na tela como acao rendendo CDI
-- todo dia, por cima da variacao de preco: o rendimento apareceria DUAS vezes.
--
-- Este CHECK nao pode reprovar nenhuma linha existente no momento em que este
-- arquivo e colado: as seis colunas nasceram nulas duas secoes acima, e o
-- ALTER TABLE valida a tabela inteira -- se houvesse UMA linha violando, o lote
-- abortaria e nada seria aplicado. Ele so barra escrita NOVA, que e o que se
-- quer barrar.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_renda_fixa_so_em_fixed_income;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_renda_fixa_so_em_fixed_income
  CHECK (
    type = 'fixed_income'
    OR (
      fixed_income_product IS NULL
      AND index_kind        IS NULL
      AND index_percentage  IS NULL
      AND spread_annual     IS NULL
      AND applied_date      IS NULL
      AND maturity_date     IS NULL
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Documentacao no catalogo
-- ---------------------------------------------------------------------------
-- Quem abrir a tabela no Supabase Studio ve seis colunas novas sem tela. Estes
-- comentarios sao o que impede a proxima pessoa de inferir o significado errado
-- de `index_percentage` (que e a armadilha inteira desta migration).

COMMENT ON COLUMN public.investment_assets.fixed_income_product IS
  'Produto de renda fixa (cdb, lci, lca, ...). Decide a ISENCAO de IR, que nao da para derivar do indexador: LCI e CDB de 95% do CDI so diferem aqui. NULO e "outro" contam como tributados - HMO-192.';
COMMENT ON COLUMN public.investment_assets.index_kind IS
  'Indexador: cdi, selic, ipca, igpm, prefixado, poupanca. Os valores que lib/renda-fixa.ts sabe projetar - HMO-192.';
COMMENT ON COLUMN public.investment_assets.index_percentage IS
  'Percentual DO INDICE, nao taxa: 110 = "110% do CDI". Para taxa absoluta ou spread use spread_annual. Proibido com index_kind = prefixado (CHECK) - HMO-192.';
COMMENT ON COLUMN public.investment_assets.spread_annual IS
  'Pontos percentuais ao ano SOMADOS ao indice (IPCA + 6 -> 6), ou a taxa inteira quando prefixado (13% a.a. -> 13) - HMO-192.';
COMMENT ON COLUMN public.investment_assets.applied_date IS
  'Data da aplicacao. E dela que sai a ALIQUOTA de IR (tabela regressiva 22,5% -> 15% por dias corridos), por isso e guardada e nao inferida. NULA = a projecao cai para a data da primeira compra do ativo e a tela avisa - HMO-192.';
COMMENT ON COLUMN public.investment_assets.maturity_date IS
  'Vencimento do papel. NULA para liquidez diaria (poupanca, CDB com liquidez) - HMO-192.';

COMMIT;


-- ---------------------------------------------------------------------------
-- 32. 032_chave_pix_do_membro.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 032_chave_pix_do_membro.sql
--
-- HMO-201, parte 1: "adicionar ao perfil a chave pix da pessoa para que o
-- colega do grupo possa copiar e fazer o pagamento."
--
-- ===========================================================================
-- POR QUE ISSO NAO E UMA COLUNA EM `profiles`
-- ===========================================================================
-- A leitura obvia do pedido e `ALTER TABLE profiles ADD COLUMN pix_key text`.
-- Nao da, e o motivo e uma policy que ja esta em producao desde o 002:
--
--     CREATE POLICY profiles_select_own_or_public ON public.profiles
--       FOR SELECT TO authenticated
--       USING (id = auth.uid() OR is_public = TRUE);
--
-- `profiles.is_public` tem DEFAULT TRUE (001_baseline). Ou seja: hoje, QUALQUER
-- conta autenticada do app le o perfil inteiro de praticamente todo mundo --
-- e essa leitura larga e de proposito, e o que faz a busca de pessoas para
-- conexao funcionar. Uma coluna nova em `profiles` herda essa policy sem que
-- ninguem escreva uma linha a mais.
--
-- E RLS nao tranca COLUNA: a policy decide quais LINHAS voltam, nunca quais
-- campos. Nao existe "todo mundo ve o nome, so o grupo ve o Pix" dentro de
-- `profiles`. A chave Pix de alguem costuma ser o CPF, o telefone ou o email
-- dessa pessoa; publicar isso para a base inteira de usuarios autenticados
-- porque o pedido dizia "no perfil" seria trocar um vazamento por uma
-- conveniencia de modelagem.
--
-- Entao a chave mora numa tabela propria, `user_pix_keys`, cuja unica policy de
-- leitura e: o dono, ou quem divide um grupo ATIVO com o dono. O "no perfil" do
-- pedido e sobre onde a pessoa DIGITA a chave (a tela de Perfil), e essa parte
-- e do app -- nao do lugar em que a linha e guardada.
--
-- ===========================================================================
-- A FUNCAO AUXILIAR E `SECURITY DEFINER` PELO MESMO MOTIVO DAS DO 002
-- ===========================================================================
-- A policy precisa perguntar "esta pessoa esta em algum grupo comigo?", o que
-- exige ler `group_members` de OUTRO usuario. A policy de SELECT de
-- `group_members` (002, SECAO 4) devolve so as linhas dos grupos de quem
-- pergunta, entao uma subconsulta direta responderia sempre "nao" para o lado
-- do colega -- silenciosamente, sem erro, e a chave nunca apareceria para
-- ninguem. `SECURITY DEFINER` e o que faz a pergunta ser respondida sobre a
-- tabela inteira, exatamente como `is_group_member` ja faz desde o 002.
--
-- Nao ha recursao: a funcao le `group_members`, e nenhuma policy de
-- `group_members` le `user_pix_keys`.
--
-- ===========================================================================
-- IDEMPOTENTE
-- ===========================================================================
-- Producao nao tem runner de migration: alguem cola este arquivo no SQL Editor
-- do Supabase (ver a nota no topo do 015). Rodar duas vezes tem que ser
-- inofensivo, e nenhuma linha aqui pode ser um meta-comando do psql (`\...`) --
-- uma unica delas reprova o arquivo INTEIRO no SQL Editor.

-- =====================================================
-- SECAO 1: A TABELA
-- =====================================================

CREATE TABLE IF NOT EXISTS public.user_pix_keys (
  -- PK = user_id: uma chave Pix por pessoa. O pedido e "a chave da pessoa para
  -- o colega copiar", nao um chaveiro. Uma lista traria a pergunta "qual
  -- delas?" para dentro da tela de acerto do grupo, que e justamente o lugar
  -- onde a pessoa que vai PAGAR nao tem como escolher certo.
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- A chave como a pessoa digitou. Nao normalizamos aqui de proposito: chave
  -- aleatoria, email, telefone e CPF tem formatos diferentes, e reescrever o
  -- que a pessoa digitou e a maneira mais rapida de entregar ao colega uma
  -- chave que o banco dele recusa.
  pix_key     text NOT NULL,

  -- O TIPO existe para a tela do colega saber o que esta copiando, e para o
  -- app poder formatar a exibicao sem adivinhar. 'aleatoria' e a EVP.
  pix_key_type text NOT NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_pix_keys_type_check
    CHECK (pix_key_type IN ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),

  -- Chave em branco e pior que chave ausente: a tela do colega mostraria um
  -- botao "Copiar Pix" que copia string vazia, e ele so descobre no app do
  -- banco. Linha sem chave nao deve existir -- quem apaga a chave apaga a
  -- LINHA (DELETE), e ai o app volta a dizer "esse colega nao cadastrou Pix".
  CONSTRAINT user_pix_keys_chave_nao_vazia
    CHECK (length(btrim(pix_key)) > 0),

  -- Teto defensivo. A maior chave valida e o email (77 caracteres pelo manual
  -- do Bacen); 200 deixa folga e ainda impede que este campo vire um bloco de
  -- texto que a tela do grupo nao sabe desenhar.
  CONSTRAINT user_pix_keys_chave_no_tamanho
    CHECK (length(pix_key) <= 200)
);

COMMENT ON TABLE public.user_pix_keys IS
  'Chave Pix por usuario. Fora de profiles porque profiles_select_own_or_public '
  'expoe o perfil a toda conta autenticada -- ver o cabecalho da migration 032.';

-- O carimbo de `updated_at`. `update_updated_at_column()` e do 001_baseline e
-- ja e usada por meia duzia de tabelas.
DROP TRIGGER IF EXISTS update_user_pix_keys_updated_at ON public.user_pix_keys;
CREATE TRIGGER update_user_pix_keys_updated_at
  BEFORE UPDATE ON public.user_pix_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- SECAO 2: A FUNCAO AUXILIAR
-- =====================================================

CREATE OR REPLACE FUNCTION public.compartilha_grupo_ativo(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.group_members meu
      JOIN public.group_members dele ON dele.group_id = meu.group_id
     WHERE meu.user_id = auth.uid()
       AND meu.status = 'active'
       AND dele.user_id = p_user_id
       AND dele.status = 'active'
  );
$$;

-- `status = 'active'` nos DOIS lados nao e simetria decorativa. Quem esta em
-- 'pending' (pedido de entrada pelo codigo, 029) ainda nao foi aprovado por
-- ninguem: nem pode ler a chave dos membros, nem deve ter a dele exposta ao
-- grupo em que ainda esta na fila.

-- ACL explicita, pelo mesmo motivo escrito no 002: a funcao e SECURITY DEFINER
-- e nasceria com EXECUTE para PUBLIC (o que inclui `anon`). A policy da SECAO 3
-- e avaliada como `authenticated`, e avaliacao de policy exige EXECUTE -- o
-- GRANT abaixo nao e opcional.
REVOKE ALL ON FUNCTION public.compartilha_grupo_ativo(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compartilha_grupo_ativo(UUID) TO authenticated;

-- =====================================================
-- SECAO 3: RLS
-- =====================================================

ALTER TABLE public.user_pix_keys ENABLE ROW LEVEL SECURITY;
-- FORCE para que nem o dono da tabela escape da policy em sessao normal. Nao
-- alcanca `postgres` no SQL Editor, que tem rolbypassrls.
ALTER TABLE public.user_pix_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_pix_keys_select ON public.user_pix_keys;
CREATE POLICY user_pix_keys_select ON public.user_pix_keys
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.compartilha_grupo_ativo(user_id));

DROP POLICY IF EXISTS user_pix_keys_insert ON public.user_pix_keys;
CREATE POLICY user_pix_keys_insert ON public.user_pix_keys
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- O que esta policy protege e MOVER a propria linha para outro `user_id` --
-- publicar o proprio Pix no nome de outra pessoa, a familia de defeito da
-- HMO-183. O colega do grupo copiaria a chave achando que paga a outra.
--
-- Duas coisas medidas sobre isso, porque as duas sao contraintuitivas e as
-- duas mudam o que aqui e load-bearing (ver os mutantes em
-- scripts/mutantes-chave-pix.mjs):
--
--  1. `WITH CHECK` omitido num policy de UPDATE nao afrouxa nada: o Postgres
--     reaproveita a expressao do USING para validar a linha nova
--     (`polwithcheck` nasce NULO e a escrita e barrada igual). Ele esta escrito
--     aqui por legibilidade, nao por necessidade.
--
--  2. Com a policy de UPDATE TOTALMENTE ABERTA, um `UPDATE ... WHERE ...`
--     continua sendo recusado -- porque ter WHERE obriga o Postgres a LER a
--     linha, a policy de SELECT entra, e ele ainda exige que a linha NOVA siga
--     visivel para quem escreveu. Quem barra ali e o SELECT, nao este policy.
--     O que este policy barra sozinho e o `UPDATE` SEM WHERE, que nao le nada
--     antes de escrever. E so por causa dele que o USING abaixo importa.
DROP POLICY IF EXISTS user_pix_keys_update ON public.user_pix_keys;
CREATE POLICY user_pix_keys_update ON public.user_pix_keys
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_pix_keys_delete ON public.user_pix_keys;
CREATE POLICY user_pix_keys_delete ON public.user_pix_keys
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =====================================================
-- SECAO 4: GRANTS
-- =====================================================
-- O 002 rodou `GRANT ... ON ALL TABLES` antes desta tabela existir, e ALL
-- TABLES e uma fotografia do momento: nao alcanca objeto criado depois. Sem
-- este bloco a tabela nasce sem GRANT nenhum e toda leitura volta 42501, com
-- cara de RLS.
REVOKE ALL ON public.user_pix_keys FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_pix_keys TO authenticated;


-- ---------------------------------------------------------------------------
-- 33. 033_minha_parte_no_realizado.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 033_minha_parte_no_realizado.sql
--
-- HMO-202, quarta parte da HMO-201: "Lancamento vindo de grupos deveriam ser
-- contabilizados como previsto e realizado no financas pessoais quanto no
-- dashboard."
--
-- O PREVISTO ja conta so a minha parte desde a HMO-177 (lib/parte-do-grupo.ts).
-- Esta migration e o REALIZADO.
--
-- ===========================================================================
-- O BURACO, MEDIDO
-- ===========================================================================
-- `/api/reports/cash-flow` sem `groupId` filtra `group_id IS NULL`, e e ele que
-- alimenta o bloco de realizado do painel. Num Postgres local com a cadeia
-- 001 -> 032, grupo "Viagem" de DUAS pessoas, hotel de R$ 400 lancado pela Ana:
--
--   quem                              realizado pessoal (expense)
--   Ana (PAGOU os 400)                      0,00
--   Bia (deve 200 do rateio)                0,00
--
-- Os dois zeros sao o defeito. O dinheiro existe, o rateio existe
-- (`group_expense_splits`, duas linhas de R$ 200,00), e o painel pessoal de
-- ninguem o enxerga.
--
-- ===========================================================================
-- POR QUE O FILTRO `group_id IS NULL` NAO FOI SIMPLESMENTE REMOVIDO
-- ===========================================================================
-- Esta escrito no cabecalho de app/api/reports/cash-flow/route.ts desde a fase
-- dos relatorios, e a razao e concreta. Sem o filtro:
--
--   * a Ana passaria a ver R$ 400 -- o hotel INTEIRO, incluindo os R$ 200 que a
--     Bia ja devolveu. O mes pessoal dela fecharia no vermelho por causa de
--     dinheiro que nao e dela;
--   * a Bia continuaria vendo ZERO, porque a linha de `financial_transactions`
--     e da Ana. Quem nao pagou nao ganharia despesa nenhuma.
--
-- Trocar um numero FALTANDO por um numero ERRADO e pior: o faltando a pessoa
-- percebe.
--
-- O conserto e contar A MINHA PARTE, o mesmo criterio que o previsto ja usa.
-- Para a Ana isso substitui o valor cheio pela parte dela; para a Bia
-- acrescenta a parte dela. A soma entre os membros continua sendo a despesa
-- inteira -- e e por isso que "a minha parte" e a unica leitura que fecha para
-- os dois lados ao mesmo tempo:
--
--   Ana 200,00  +  Bia 200,00  =  400,00  = o hotel
--
-- ===========================================================================
-- A PARTE E LIDA, NUNCA RECALCULADA
-- ===========================================================================
-- `group_expense_splits.amount` ja esta gravado: quem escreve e
-- `calculate_equal_split` (001, corrigido no 007) pelo metodo do maior resto --
-- centavos inteiros, resto distribuido pela ordem de `group_members.id` --, e a
-- 024 passou a refazer essas partes quando a despesa e editada.
--
-- Recalcular aqui (`ABS(t.amount) / n_membros`) criaria a SEGUNDA implementacao
-- de divisao deste banco. Ela empataria com a primeira na maioria dos casos e
-- divergiria exatamente nos que doem: divisao que nao fecha em duas casas
-- (R$ 300 por 3), rateio `percentage`/`custom` combinado fora do igualitario, e
-- membro que entrou no grupo DEPOIS da despesa. O sintoma seria o realizado
-- pessoal discordando do saldo do grupo (`group_member_balances`, 007) por
-- centavos que ninguem consegue explicar.
--
-- Entao: `SUM(es.amount)` cru, a mesma expressao que a view de saldo do 007 usa
-- para o "devido". Se um dia a divisao mudar, os dois numeros mudam juntos.
--
-- ===========================================================================
-- AS QUATRO DECISOES QUE ESTA MIGRATION TOMA, E O QUE CADA UMA EVITA
-- ===========================================================================
--
-- 1. `es.status NOT IN ('rejected', 'expired')` -- copiado do 007, de proposito.
--
--    Nao e `= 'approved'`: hoje o app cria TODO rateio como 'pending' e nada
--    nunca os aprova (ver app/api/expense-groups/[groupId]/transactions). Com
--    'approved' o realizado de grupo sairia ZERO para todo mundo -- o mesmo
--    defeito que esta migration existe para consertar, vestido de rigor. E sem
--    filtro nenhum, o membro que RECUSOU a divisao veria no painel pessoal um
--    gasto que ele se negou a assumir.
--
--    Esta e a mesma regra do saldo do grupo, e tem que ser: as duas telas falam
--    do mesmo dinheiro.
--
-- 2. `t.transaction_type = 'expense'`.
--
--    Divisao de grupo existe para DESPESA. `refazer_rateio_do_grupo` (024) so
--    rateia `amount < 0`, e a view de "pago" do 007 tambem exige 'expense' --
--    receita lancada no grupo nao e alguem pagando a conta do restaurante.
--
--    O filtro e EXPLICITO e nao herdado do rateio: nada no schema impede uma
--    linha de `group_expense_splits` pendurada numa receita (o proprio
--    database/tests/024_... insere uma a mao, e um import ou uma rota antiga
--    pode fazer o mesmo). Sem ele, essa linha entraria no realizado como
--    DESPESA -- dinheiro que entrou aparecendo como dinheiro que saiu.
--
-- 3. A moeda vem de `t.currency`, e entra na CHAVE.
--
--    `group_expense_splits` nao tem coluna de moeda: a parte esta na moeda da
--    despesa. Somar as partes de um grupo em dolar junto com as de um grupo em
--    real daria `1000 + 180 = 1180`, que nao esta em moeda nenhuma -- o defeito
--    exato que a 022 foi a producao tirar das views. A 026 acrescentou
--    `exchange_rate`, mas as views de fluxo de caixa NAO convertem (quem
--    converte e o saldo do grupo); aqui a moeda fica no grao, como no 022.
--
-- 4. O mes e `date_trunc('month', t.transaction_date)` -- a data da DESPESA.
--
--    Nao `es.created_at`. Editar uma despesa antiga refaz as partes (024), e
--    com `created_at` o hotel de setembro migraria para o mes da edicao: o mes
--    fechado mudaria de valor depois de fechado.
--
-- ===========================================================================
-- POR QUE VIEWS, E NAO SOMA NO JAVASCRIPT
-- ===========================================================================
-- O modo mes de `/api/reports/cash-flow` e `/api/reports/categories` sai do
-- banco hoje, e precisa continuar saindo: o total do fluxo e a soma das
-- categorias tem que vir da MESMA definicao, senao a pizza do painel para de
-- fechar em 100% e o usuario fica com dois numeros e nenhum criterio para
-- escolher. Mesma razao pela qual `monthly_cash_flow` e um rollup de
-- `category_monthly_totals` em vez de uma segunda consulta.
--
-- Sao quatro views, em camadas, e cada camada existe por um motivo:
--
--   group_share_entries                    1 linha por parte minha (grao de LINHA)
--   group_share_category_monthly_totals    rollup mensal dela
--   personal_category_monthly_totals       pessoal + minha parte, por categoria
--   personal_monthly_cash_flow             rollup da anterior
--
-- `group_share_entries` existe porque o modo INTERVALO (15/09 a 20/10) nao tem
-- rollup mensal que responda e soma as linhas cruas no JavaScript. Com a view
-- de linha, os dois modos leem a MESMA definicao de "minha parte" -- sem ela, o
-- intervalo teria uma segunda copia da regra de status e de tipo, em outra
-- linguagem, e as duas divergiriam no primeiro rateio recusado.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION NAO TOCA
-- ===========================================================================
-- `category_monthly_totals`, `monthly_cash_flow`, `planned_vs_actual`,
-- `budget_consumption` e as outras views do 008/022 ficam EXATAMENTE como
-- estao. As novas sao aditivas.
--
-- Isso e deliberado: `monthly_cash_flow` tem `group_id` no grao e e o que o
-- painel DO GRUPO le (`?groupId=`), onde o numero certo e o valor CHEIO da
-- viagem, de todos os membros. Mudar aquela view para "minha parte" quebraria a
-- tela do grupo para consertar a pessoal. E ela tambem alimenta
-- `planned_vs_actual` e o consumo de orcamento, que nao estao no pedido.
--
-- ===========================================================================
-- COMO RODAR
-- ===========================================================================
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/033_minha_parte_no_realizado.sql
--
-- Aplicar depois de 001 -> ... -> 032. O preflight aborta listando o que falta.
-- Re-executavel: so tem CREATE OR REPLACE VIEW, COMMENT, GRANT e ALTER VIEW.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Preflight
-- ---------------------------------------------------------------------------
-- Sem isto a migration aplicaria PELA METADE num banco que nao tem a 022: as
-- views nasceriam sem `currency` no grao e o erro apareceria meses depois, como
-- um total em moeda nenhuma.
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(msg, E'\n') INTO v_faltando FROM (
    SELECT '  - tabela public.group_expense_splits (vem do 001)' AS msg
    WHERE to_regclass('public.group_expense_splits') IS NULL
    UNION ALL
    SELECT '  - tabela public.group_transactions (vem do 001)'
    WHERE to_regclass('public.group_transactions') IS NULL
    UNION ALL
    SELECT '  - view public.category_monthly_totals (vem do 008)'
    WHERE to_regclass('public.category_monthly_totals') IS NULL
    UNION ALL
    SELECT '  - coluna financial_transactions.currency (vem do 022)'
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'financial_transactions'
         AND column_name = 'currency'
    )
    UNION ALL
    SELECT '  - coluna currency no grao de category_monthly_totals (vem do 022)'
    WHERE to_regclass('public.category_monthly_totals') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'category_monthly_totals'
           AND column_name = 'currency'
      )
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'033 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> ... -> 032 antes.', v_faltando;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. group_share_entries -- a minha parte, no grao de LINHA
-- ---------------------------------------------------------------------------
-- UMA linha por (parte, membro). Esta e a unica definicao de "minha parte de
-- uma despesa de grupo" no lado do realizado; tudo abaixo e agregacao dela.
--
-- `amount` sai POSITIVO porque e assim que `group_expense_splits` grava (medido:
-- 200.00 para uma despesa de -400.00) e e assim que as views de relatorio
-- expoem despesa (`ABS()` no 008/022). Quem le isto NAO deve aplicar ABS de
-- novo nem inverter o sinal.
--
-- A JUNCAO COM group_members E POR `es.member_id`, E ISSO IMPORTA
-- --------------------------------------------------------------
-- A parte aponta para a LINHA DE PARTICIPACAO, nao para o usuario. Quem saiu do
-- grupo e voltou tem duas linhas em `group_members`, e a parte antiga continua
-- na velha -- entao `em.user_id` e o unico jeito de reencontrar o historico
-- dessa pessoa. A juncao e 1:1 (a FK aponta para a PK), logo nao duplica.
--
-- E NAO HA FILTRO POR `em.status`: a parte de uma despesa de maio continua sendo
-- dinheiro que a pessoa gastou em maio, mesmo que ela tenha saido do grupo em
-- junho. Filtrar por 'active' aqui faria o historico pessoal dela ser reescrito
-- para tras no dia em que ela sai -- e o mes fechado mudaria de valor. (A view
-- de saldo do 007 filtra, e esta certa: la a pergunta e "quem ainda acerta com
-- quem HOJE", que e outra pergunta.)
--
-- `transaction_type` e uma COLUNA, copiada da transacao, e nao o literal
-- 'expense'. A rota que soma o modo intervalo repassa esse campo para o mesmo
-- agregador que ja usa no caminho pessoal; se algum dia o filtro do WHERE
-- afrouxar, a rota acompanha sozinha em vez de continuar afirmando 'expense'
-- sobre uma linha que nao e mais despesa.
CREATE OR REPLACE VIEW public.group_share_entries AS
  SELECT
    es.id                                             AS id,
    em.user_id                                        AS user_id,
    gt.group_id                                       AS group_id,
    t.id                                              AS transaction_id,
    t.transaction_date                                AS transaction_date,
    date_trunc('month', t.transaction_date)::date     AS month,
    t.category_id                                     AS category_id,
    t.transaction_type                                AS transaction_type,
    t.currency                                        AS currency,
    es.amount                                         AS amount,
    es.status                                         AS split_status,
    (t.user_id = em.user_id)                          AS paguei_eu
  FROM public.group_expense_splits es
  JOIN public.group_members em        ON em.id = es.member_id
  JOIN public.group_transactions gt   ON gt.id = es.group_transaction_id
  JOIN public.financial_transactions t ON t.id = gt.transaction_id
  WHERE es.status NOT IN ('rejected', 'expired')
    AND t.transaction_type = 'expense';

COMMENT ON VIEW public.group_share_entries IS
  'A MINHA parte de cada despesa de grupo, uma linha por parte. amount POSITIVO, na moeda da despesa, lido de group_expense_splits (nunca recalculado). Rateio rejected/expired fica fora, igual a group_member_balances. Nao tem filtro por user_id: quem le PRECISA filtrar, senao a RLS de grupo devolve a parte dos OUTROS membros tambem.';

-- ---------------------------------------------------------------------------
-- 2. group_share_category_monthly_totals -- rollup mensal da minha parte
-- ---------------------------------------------------------------------------
-- Mesmo formato de `category_monthly_totals`, para a camada de cima poder somar
-- os dois lados sem converter nada.
--
-- `income` e zero por construcao e nao por acaso: a view de baixa so tem
-- despesa. A coluna existe para o UNION ALL da SECAO 3 nao precisar inventar
-- colunas.
--
-- `transaction_count` conta as PARTES, e isso e load-bearing. A rota divide o
-- total pelos meses COM movimento para dar a media; com a contagem em zero, a
-- Bia -- que nao pagou nada -- veria `total_expense = 200` e
-- `average_expense = 0` no mesmo bloco, e `months_with_activity = 0` apagaria o
-- mes dela da media.
-- NAO TEM COLUNA `net`, ao contrario de `category_monthly_totals`.
--
-- Seria `- SUM(e.amount)` e estaria certa, e por isso mesmo nao esta aqui: a
-- camada de cima RECALCULA o net de `income - expense`, entao esta coluna nao
-- teria leitor nenhum -- seria uma segunda definicao do mesmo numero, dormindo
-- ate alguem usa-la e descobrir que ela discorda da primeira. Uma prova de
-- mutacao confirmou: inverter o sinal dela nao muda resultado nenhum do app.
CREATE OR REPLACE VIEW public.group_share_category_monthly_totals AS
  SELECT
    e.user_id,
    e.group_id,
    e.month,
    e.category_id,
    SUM(e.amount)::numeric(15,2)        AS expense,
    0::numeric(15,2)                    AS income,
    COUNT(*)                            AS transaction_count,
    e.currency
  FROM public.group_share_entries e
  GROUP BY e.user_id, e.group_id, e.month, e.category_id, e.currency;

COMMENT ON VIEW public.group_share_category_monthly_totals IS
  'Rollup mensal de group_share_entries, no formato de category_monthly_totals. Despesa POSITIVA, income sempre 0. Sem coluna net de proposito: quem agrega recalcula de income - expense, e uma segunda definicao do net seria um numero sem leitor esperando para discordar. Uma linha por (usuario, grupo, mes, categoria, moeda).';

-- ---------------------------------------------------------------------------
-- 3. personal_category_monthly_totals -- pessoal + a minha parte dos grupos
-- ---------------------------------------------------------------------------
-- O que o painel pessoal e o relatorio por categoria devem ler.
--
-- O lado pessoal sai de `category_monthly_totals` com `group_id IS NULL`, e NAO
-- de uma segunda consulta a `financial_transactions`: ali mora a unica
-- definicao de como o sinal e tratado e de que `transfer` fica fora (inclusive
-- da contagem). Reescrever isso aqui faria as duas pernas de uma transferencia
-- e de um pagamento de fatura virarem receita e despesa de verdade -- o total
-- continuaria certo porque elas se anulam, mas "quanto entrou" e "quanto saiu"
-- inflariam os dois juntos.
--
-- NAO HA DUPLA CONTAGEM A EVITAR, e vale dizer por que: a despesa de grupo tem
-- `group_id IS NOT NULL`, entao ela JA esta fora do lado pessoal -- foi isso
-- que produziu o zero medido no cabecalho. O UNION ALL e puramente aditivo, e a
-- parte de quem pagou substitui o valor cheio porque o valor cheio nunca
-- esteve aqui.
--
-- `net` e RECALCULADO de `income - expense` em vez de somado das duas pernas.
-- Somar o `net` que cada lado trouxe daria o mesmo numero hoje; recalcular
-- garante que ele nao POSSA discordar das outras duas colunas da propria linha.
--
-- Sem `group_id` nas colunas, de proposito: esta view e o lado PESSOAL, onde
-- group_id nao e uma dimensao -- a despesa da Viagem e da Casa somam na mesma
-- categoria do mesmo mes, que e o que o painel pessoal mostra. Quem quer o
-- recorte por grupo le `monthly_cash_flow`, que continua intacta.
CREATE OR REPLACE VIEW public.personal_category_monthly_totals AS
  WITH tudo AS (
    SELECT
      c.user_id, c.month, c.category_id,
      c.expense, c.income, c.transaction_count, c.currency
    FROM public.category_monthly_totals c
    WHERE c.group_id IS NULL

    UNION ALL

    SELECT
      g.user_id, g.month, g.category_id,
      g.expense, g.income, g.transaction_count, g.currency
    FROM public.group_share_category_monthly_totals g
  )
  SELECT
    tudo.user_id,
    tudo.month,
    tudo.category_id,
    SUM(tudo.expense)::numeric(15,2) AS expense,
    SUM(tudo.income)::numeric(15,2)  AS income,
    (SUM(tudo.income) - SUM(tudo.expense))::numeric(15,2) AS net,
    SUM(tudo.transaction_count)      AS transaction_count,
    tudo.currency
  FROM tudo
  GROUP BY tudo.user_id, tudo.month, tudo.category_id, tudo.currency;

COMMENT ON VIEW public.personal_category_monthly_totals IS
  'Entrada e saida por categoria, mes e MOEDA no painel PESSOAL: o que e so meu (group_id IS NULL) mais A MINHA PARTE das despesas de grupo. Ignora transfer. Quem le precisa filtrar user_id -- sem isso a RLS de grupo devolve a parte dos outros membros.';

-- ---------------------------------------------------------------------------
-- 4. personal_monthly_cash_flow -- o realizado do painel
-- ---------------------------------------------------------------------------
-- Rollup da SECAO 3, pela mesma razao que `monthly_cash_flow` e rollup de
-- `category_monthly_totals`: para o total do fluxo e a soma das categorias
-- nunca serem dois numeros diferentes. Uma pizza que nao fecha em 100% e o
-- sintoma de ter duas definicoes.
CREATE OR REPLACE VIEW public.personal_monthly_cash_flow AS
  SELECT
    p.user_id,
    p.month,
    SUM(p.income)::numeric(15,2)  AS income,
    SUM(p.expense)::numeric(15,2) AS expense,
    SUM(p.net)::numeric(15,2)     AS net,
    SUM(p.transaction_count)      AS transaction_count,
    p.currency
  FROM public.personal_category_monthly_totals p
  GROUP BY p.user_id, p.month, p.currency;

COMMENT ON VIEW public.personal_monthly_cash_flow IS
  'Entrada, saida e resultado por mes e MOEDA no painel PESSOAL, incluindo a minha parte das despesas de grupo. Rollup de personal_category_monthly_totals para nao ter duas versoes do mesmo numero. Um mes com duas moedas tem DUAS linhas.';

-- ---------------------------------------------------------------------------
-- 5. security_invoker e GRANTs
-- ---------------------------------------------------------------------------
-- VIEW SEM `security_invoker` RODA COMO O DONO E FURA A RLS.
--
-- Nao e teoria neste repositorio: e exatamente o que o 008 anotou ao criar
-- `monthly_cash_flow`, e o sintoma seria cada usuario vendo o gasto mensal de
-- TODOS os outros. Em `personal_monthly_cash_flow` seria pior do que no 008,
-- porque esta view atravessa quatro tabelas de grupo: um unico SELECT sem
-- filtro devolveria o rateio de gente que nao divide grupo nenhum com quem
-- perguntou.
--
-- As quatro precisam do ajuste: `security_invoker` nao e herdado. Uma view
-- INVOKER lendo uma view DEFINER le com o privilegio da de baixo, e a camada de
-- cima nao conserta isso.
ALTER VIEW public.group_share_entries                 SET (security_invoker = true);
ALTER VIEW public.group_share_category_monthly_totals SET (security_invoker = true);
ALTER VIEW public.personal_category_monthly_totals    SET (security_invoker = true);
ALTER VIEW public.personal_monthly_cash_flow          SET (security_invoker = true);

-- `anon` nao le relatorio de ninguem. REVOKE explicito porque no Supabase o
-- grant de `PUBLIC` em objeto novo ja alcanca anon.
--
-- ISTO E HIGIENE, E NAO E O QUE PROTEGE O DADO. Medido: com SELECT concedido a
-- anon nas quatro views, a leitura AINDA falha --
-- `permission denied for table group_expense_splits` em `group_share_entries`,
-- `permission denied for view category_monthly_totals` nas de cima. Porque as
-- views sao `security_invoker` e o 002 ja revogou as tabelas-base de anon. Quem
-- fecha essa porta e o 002, uma camada abaixo; estas linhas so evitam que a
-- view apareca como legivel para quem inspeciona privilegios.
REVOKE ALL ON public.group_share_entries                 FROM anon;
REVOKE ALL ON public.group_share_category_monthly_totals FROM anon;
REVOKE ALL ON public.personal_category_monthly_totals    FROM anon;
REVOKE ALL ON public.personal_monthly_cash_flow          FROM anon;

-- Somente SELECT: sao views de relatorio e nao ha o que escrever nelas.
GRANT SELECT ON public.group_share_entries                 TO authenticated;
GRANT SELECT ON public.group_share_category_monthly_totals TO authenticated;
GRANT SELECT ON public.personal_category_monthly_totals    TO authenticated;
GRANT SELECT ON public.personal_monthly_cash_flow          TO authenticated;


-- ---------------------------------------------------------------------------
-- 34. 034_moeda_da_conta_prevista.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 034_moeda_da_conta_prevista.sql
--
-- HMO-184. `scheduled_transactions.currency` existe desde a 022, o app NUNCA a
-- escreve, e nao existe `exchange_rate` nenhuma para converte-la. Esta migration
-- nao da moeda a conta prevista: ela TRANCA a coluna em 'BRL' e passa a dizer a
-- verdade sobre o que a conta prevista e.
--
-- ===========================================================================
-- POR QUE TRANCAR, E NAO COMPLETAR
-- ===========================================================================
-- A leitura obvia da issue era a oposta -- "a coluna existe pela metade, logo
-- complete-a": grave `currency` no INSERT e acrescente `exchange_rate` com os
-- tres CHECKs da 026. Essa leitura nao sobrevive a tres fatos que ja estao no
-- repositorio, e o terceiro e decisivo.
--
--   1. A COTACAO DE UMA DATA FUTURA NAO EXISTE. A PTAX de 15/12 nao esta
--      publicada em 01/10. Uma `exchange_rate` na conta prevista seria uma
--      coluna NOT NULL cujo unico valor honesto e "ninguem sabe" -- e o DEFAULT
--      1 que a 026 usou como backfill aqui nao seria backfill de nada: seria o
--      numero errado nascendo em toda linha nova.
--
--   2. A DECISAO JA FOI TOMADA E JA ESTA NO AR. A HMO-188 fechou exatamente
--      esta pergunta em lib/lancamento.ts, e a resposta e uma frase que o
--      usuario ja le hoje:
--
--        "Em USD nao da para deixar previsto: a cotacao de uma data futura
--         ainda nao existe. Lance no dia em que pagar, com a cotacao do dia."
--
--      Ou seja: o produto JA decidiu que previsao e em real. O que falta nao e
--      a decisao -- e o banco concordar com ela.
--
--   3. A BAIXA NAO SABE DE MOEDA, E ESSE E O FURO DE VERDADE.
--      app/api/scheduled-transactions/[id]/pay/route.ts insere em
--      `financial_transactions` SEM mandar `currency` nem `exchange_rate`: as
--      duas caem no DEFAULT do banco, (BRL, 1).
--
--      Repare no que isso faz com a sugestao "grave a moeda na previsao e
--      converta na baixa". Uma previsao de US$ 180 daria baixa como R$ 180 --
--      e o CHECK `(currency = 'BRL') = (exchange_rate = 1)` da 026 NAO PEGA,
--      porque a rota nao manda nenhuma das duas colunas e o par (BRL, 1) e
--      perfeitamente consistente consigo mesmo. O 23514 que protege o
--      lancamento manual nao protege este caminho. Seria um erro de 80% para
--      menos, sem erro em lugar nenhum -- a MESMA perda silenciosa que a SECAO
--      2 da 026 existe para fechar, entrando pela porta que ela nao cobre.
--
-- Entao a ordem certa e esta: primeiro o banco garante que previsao e BRL
-- (aqui), e so DEPOIS -- se um dia a previsao em moeda estrangeira for pedida
-- de verdade -- alguem reescreve a baixa para carregar moeda e cotacao, e
-- derruba este CHECK no mesmo PR. Trancar agora nao fecha aquela porta: deixa
-- o cadeado num lugar onde quem for abri-lo PRECISA ver a baixa primeiro.
--
-- ===========================================================================
-- O QUE ESTE CHECK PROTEGE, JA QUE NINGUEM ESCREVE A COLUNA
-- ===========================================================================
-- Hoje toda linha nasce no DEFAULT 'BRL' porque os tres unicos INSERTs que
-- existem omitem a coluna:
--
--   app/api/scheduled-transactions/route.ts      (conta avulsa)
--   app/api/card-invoices/close/route.ts         (fatura fechada vira a pagar)
--   lib/services/scheduled.ts                    (materializacao das regras)
--
-- ...e o PATCH de [id]/route.ts monta o patch por lista fechada de campos, sem
-- `currency`. Esta correto HOJE, e correto POR ACIDENTE: nada no banco impede
-- a quarta rota de gravar 'USD'. No instante em que uma gravar, TODO somador de
-- conta prevista passa a somar dolar com real sem erro e sem conversao --
-- /api/scheduled-transactions/summary, /api/safe-to-spend, /api/cash-flow,
-- /api/projection e a secao "Previstas" da tela do grupo --, e todos erram para
-- MENOS. Custo fixo subestimado e o insumo do safe-to-spend: o app passaria a
-- dizer que sobra dinheiro que nao sobra.
--
-- O CHECK troca esse futuro silencioso por um 23514 na cara da rota nova.
--
-- ===========================================================================
-- POR QUE A COLUNA NAO E SIMPLESMENTE REMOVIDA
-- ===========================================================================
-- Porque `planned_vs_actual` (022) usa `s.currency` como parte da chave que
-- casa previsto com realizado:
--
--     AND s.currency IS NOT DISTINCT FROM k.currency
--
-- Dropar a coluna quebraria a view. E, mais importante, a coluna CONTINUA
-- fazendo trabalho ali mesmo trancada em 'BRL': ela e o lado "previsto" do
-- cruzamento, e e o que mantem o previsto em real pareado com o realizado em
-- real quando existe tambem um realizado em dolar no mesmo mes.
--
-- O EFEITO COLATERAL QUE ISTO DEIXA DE PE, E POR QUE ELE NAO E DESTA MIGRATION
-- ----------------------------------------------------------------------------
-- Com previsto sempre em BRL, um realizado em USD gera em `planned_vs_actual`
-- uma linha (mes, 'USD') com `planned_expense = 0` e `expense_variance` igual
-- ao gasto inteiro -- o "gastou 180 sem ter previsto nada" que a issue mandou
-- vigiar. Esse numero NAO e inventado por esta migration: ele e verdade. Nao
-- havia previsao em dolar, porque o app recusa cria-la (HMO-188). A linha diz
-- exatamente o que aconteceu, no grao de moeda que a 022 escolheu de proposito
-- ("gastei 1.000 reais e 180 dolares" e a resposta certa num relatorio
-- PESSOAL). Mascarar isso seria somar moeda com moeda de novo.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A trava
-- ---------------------------------------------------------------------------
-- O catalogo de 13 codigos da 022 FICA. Esta migration so ACRESCENTA um segundo
-- CHECK, mais estreito, ao lado dele.
--
-- POR QUE ADITIVA, E NAO "TROCAR O CATALOGO POR 'BRL'"
-- ----------------------------------------------------
-- Substituir seria mais limpo de ler e teria um custo escondido no dia em que
-- alguem destrancar. Destrancar e, naturalmente, "derrube o CHECK que so aceita
-- BRL" -- e se esse fosse o UNICO CHECK da coluna, a tabela ficaria sem
-- validacao NENHUMA de moeda: 'CZK' passaria a entrar, e `moedaPorCodigo`
-- (lib/dinheiro.ts) cai no padrao em codigo desconhecido, ou seja uma previsao
-- em coroa tcheca apareceria em REAIS, sem aviso. Esse e o defeito que o CHECK
-- da 022 existe para impedir, e ele nao deve morrer junto com a trava.
--
-- Com os dois empilhados, a semantica fica certa nos dois estados: hoje vale a
-- intersecao (so 'BRL'), e no dia em que a trava cair sobra o catalogo da 022,
-- que e exatamente o lugar certo para pousar.
--
-- `ALTER TABLE ... ADD CONSTRAINT ... CHECK` VALIDA as linhas que ja existem.
-- Se houvesse uma unica conta prevista em moeda estrangeira em producao, esta
-- migration ABORTARIA aqui, e o BEGIN/COMMIT faz o arquivo inteiro voltar
-- atras. Isso e deliberado: uma linha dessas seria dinheiro ja gravado errado,
-- e descobrir isso por uma migration que recusa colar e MUITO melhor do que por
-- um `UPDATE ... SET currency = 'BRL'` que apaga a evidencia.
--
-- Medido em producao antes de escrever este arquivo: `pg_class.relpages = 0`
-- para `scheduled_transactions` -- a tabela esta vazia, entao nao ha linha
-- alguma para a validacao reprovar. (A contagem por `SELECT` nao serviria de
-- prova: o papel `paperclip_ro` nao tem `rolbypassrls` e a RLS devolveria
-- `0 rows` tanto para "tabela vazia" quanto para "tabela cheia que eu nao
-- posso ler". `relpages` nao passa pela RLS.)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_transactions_currency_brl'
  ) THEN
    ALTER TABLE public.scheduled_transactions
      ADD CONSTRAINT scheduled_transactions_currency_brl
      CHECK (currency = 'BRL');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. O comentario que mentia
-- ---------------------------------------------------------------------------
-- A 022 escreveu:
--
--   'Moeda desta conta prevista (ISO 4217). Herdada da conta na criacao.
--    Casa com financial_transactions.currency no previsto x realizado.'
--
-- "Herdada da conta na criacao" descreve um comportamento que NUNCA foi
-- implementado -- nenhum INSERT le `financial_accounts.currency`. Um comentario
-- de schema que descreve codigo inexistente e pior que nenhum: foi ele que
-- sustentou a leitura de que faltava "so" terminar a feature. A segunda frase
-- era e continua verdadeira, e fica.

COMMENT ON COLUMN public.scheduled_transactions.currency IS
  'Sempre BRL: ha CHECK. Previsao neste app e em real -- a cotacao de uma data futura nao existe, e por isso o app recusa deixar moeda estrangeira prevista (HMO-188, lib/lancamento.ts). A coluna fica porque planned_vs_actual casa previsto x realizado por moeda. Para destrancar: a baixa ([id]/pay) precisa ANTES passar a gravar currency e exchange_rate em financial_transactions -- hoje ela omite as duas e cai no DEFAULT (BRL, 1), que e perda silenciosa. Ver 034.';

COMMIT;


-- ---------------------------------------------------------------------------
-- 35. 035_parcela_n_de_m.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 035_parcela_n_de_m.sql
--
-- HMO-211 / HMO-208 Fase 4. "Sobre parcelar, deve ser um checkbox abaixo do
-- valor do cartao e ao clicar perguntar se o valor que esta no input e o da
-- parcela ou total, e em qual parcela aquela se refere de quantas no total."
--
-- Esta migration faz UMA coisa: da ao banco as duas colunas que sustentam o
-- rotulo "parcela 3 de 10", e as expoe na fatura. Ela nao cria tabela, nao
-- mexe em dinheiro gravado e nao toca em trigger nenhum.
--
-- ===========================================================================
-- POR QUE NAO E A `create_installments` QUE MUDA
-- ===========================================================================
-- O plano aprovado da HMO-208 previa "estender a RPC `create_installments` para
-- comecar a serie em N". Ler o codigo mudou a conclusao, e vale registrar o
-- porque -- quem vier depois vai achar a RPC e se perguntar por que ela ficou
-- parada.
--
-- `create_installments` (001) grava em `transaction_installments`, e
-- **`transaction_installments` nao tem leitor nenhum no app**. O unico
-- consumidor da tabela em todo o repositorio era o POST do formulario de
-- lancamento. Parcelar gravava linhas que nao apareciam em Lancamentos, nem em
-- Contas a Pagar, nem na fatura do cartao: a tela salvava e a compra sumia.
-- Fazer aquela RPC comecar em N resolveria a aritmetica e deixaria o defeito de
-- pe -- oito parcelas invisiveis em vez de dez.
--
-- O repositorio ja tinha a resposta escrita em dois lugares:
--
--   lib/offline-queue.ts:183   "Parcelamento vira N transacoes amarradas por
--                               `installment_parent_id`"
--   financial_transactions     a coluna `installment_parent_id` existe desde a
--                              001, e ninguem nunca escreveu nela
--
-- Entao a serie passa a ser materializada onde cada tipo de dinheiro JA tem
-- leitor:
--
--   cartao       -> N linhas em `financial_transactions`. A view
--                   `card_invoice_lines` (006) ja decide o `invoice_month` de
--                   cada linha pelo `transaction_date`, entao as parcelas
--                   aparecem na tela do cartao (HMO-210), na fatura de cada mes
--                   e na lista de Lancamentos sem um leitor novo e sem uma
--                   segunda fonte de verdade para o total da fatura.
--   fora do cartao -> N linhas em `scheduled_transactions` (Contas a Pagar),
--                   que e o lugar honesto para "vou pagar R$ X no dia D". Nao
--                   colide com a HMO-209, que exclui da agenda apenas a
--                   previsao de CARTAO.
--
-- `transaction_installments` fica como esta: cheia de linhas de producao que
-- ninguem le, e sem leitor novo. Apagar a tabela ou migrar aquelas linhas e
-- decisao sobre dinheiro gravado e nao cabe nesta migration -- mas o
-- COMMENT da SECAO 3 passa a dizer isso em voz alta, para que a proxima pessoa
-- nao construa em cima dela de novo.
--
-- ===========================================================================
-- O QUE ESTE ARQUIVO ADICIONA
-- ===========================================================================
--   financial_transactions.installment_number   o N de "parcela N de M"
--   financial_transactions.installment_total    o M
--   CHECK financial_transactions_installment_coerente
--   indice parcial em installment_parent_id
--   card_invoice_lines: as duas colunas, para a tela poder rotular
--   COMMENT em transaction_installments (o aviso de tabela sem leitor)
--
-- IDEMPOTENTE: pode ser colada duas vezes.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. As duas colunas
-- ---------------------------------------------------------------------------
-- NULLABLE, e e isso que torna esta migration segura de colar com o app no ar.
-- Toda linha que existe hoje fica com (NULL, NULL) -- "nao e parcela" -- e todo
-- INSERT que o app faz hoje omite as duas colunas e continua valendo. Nao ha
-- backfill: nao existe informacao de parcelamento em `financial_transactions`
-- para recuperar, e inventar `(1, 1)` para o historico faria toda compra avulsa
-- do passado passar a se chamar "parcela 1 de 1" na tela.

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS installment_number integer;

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS installment_total integer;

COMMENT ON COLUMN public.financial_transactions.installment_number IS
  'O N de "parcela N de M". NULL = nao e parcela. Quem escreve: app/api/financial-installments (HMO-211).';
COMMENT ON COLUMN public.financial_transactions.installment_total IS
  'O M de "parcela N de M". NULL = nao e parcela. Sempre NULL ou NOT NULL junto com installment_number (CHECK).';

-- ---------------------------------------------------------------------------
-- 2. O CHECK, e a razao de ele estar escrito desse jeito exato
-- ---------------------------------------------------------------------------
-- A escrita INTUITIVA deste CHECK esta errada, e erra em silencio:
--
--   CHECK ((installment_number IS NULL AND installment_total IS NULL)
--          OR (installment_number >= 1 AND installment_total >= 2
--              AND installment_number <= installment_total))
--
-- Com `installment_number = 3` e `installment_total = NULL`, o primeiro ramo e
-- FALSE e o segundo contem `NULL >= 2`, que e NULL. `FALSE OR NULL` e NULL --
-- e **um CHECK que resulta NULL ACEITA a linha**. Ou seja: a versao obvia deixa
-- passar exatamente a linha meio-preenchida que ela existe para barrar, e a
-- tela mostraria "parcela 3 de " sem numero nenhum depois do "de".
--
-- A forma abaixo nao tem como resultar NULL: a primeira conjuncao compara dois
-- `IS NULL`, que sao sempre TRUE ou FALSE, e a segunda so avalia a aritmetica
-- quando ja se sabe que as duas colunas estao preenchidas.
--
--   (NULL, NULL)  -> TRUE  = TRUE  -> TRUE  AND (TRUE OR ...)        -> aceita
--   (3, NULL)     -> FALSE = TRUE  -> FALSE                          -> recusa
--   (NULL, 10)    -> TRUE  = FALSE -> FALSE                          -> recusa
--   (3, 10)       -> FALSE = FALSE -> TRUE  AND (FALSE OR TRUE)      -> aceita
--   (12, 10)      -> TRUE AND (FALSE OR FALSE)                       -> recusa
--   (0, 10)       -> TRUE AND (FALSE OR FALSE)                       -> recusa
--
-- `installment_total >= 2` e nao `>= 1`: uma "parcela 1 de 1" e uma compra
-- avulsa com um rotulo a mais, e deixar as duas formas gravaveis criaria duas
-- maneiras de dizer a mesma coisa -- a tela rotularia metade das compras.
--
-- O `DO $$` em volta e porque `ADD CONSTRAINT` nao tem `IF NOT EXISTS`, e sem
-- ele colar a migration de novo aborta a transacao inteira (42710). Mesma forma
-- da 034.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'financial_transactions_installment_coerente'
      AND conrelid = 'public.financial_transactions'::regclass
  ) THEN
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_installment_coerente
      CHECK (
        (installment_number IS NULL) = (installment_total IS NULL)
        AND (
          installment_number IS NULL
          OR (
            installment_number >= 1
            AND installment_total >= 2
            AND installment_number <= installment_total
          )
        )
      );
  END IF;
END $$;

-- O indice que faz a serie ser consultavel. Parcial porque a esmagadora
-- maioria das linhas tem `installment_parent_id` NULL -- indexar o NULL de todo
-- lancamento avulso do historico custaria tamanho sem responder pergunta
-- nenhuma. Ele NAO serve de arbitro de `ON CONFLICT` (indice parcial nunca
-- serve), e nao ha `ON CONFLICT` nenhum neste caminho.
CREATE INDEX IF NOT EXISTS idx_financial_transactions_installment_parent
  ON public.financial_transactions (installment_parent_id)
  WHERE installment_parent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. O aviso na tabela que nao tem leitor
-- ---------------------------------------------------------------------------
-- Escrito como COMMENT e nao como comentario de arquivo de proposito: o
-- COMMENT viaja com o schema e aparece para quem inspeciona o banco, que e
-- onde a proxima pessoa vai olhar antes de construir em cima dela.

COMMENT ON TABLE public.transaction_installments IS
  'SEM LEITOR NO APP. Nenhuma tela, rota ou view le esta tabela: as linhas aqui nao aparecem em Lancamentos, nem em Contas a Pagar, nem na fatura do cartao. A partir da 035 o parcelamento e materializado em financial_transactions (cartao, com installment_number/installment_total) ou em scheduled_transactions (fora do cartao) -- ver app/api/financial-installments. As linhas que ja estao aqui sao dados de producao e nao foram migradas nem apagadas; quem for decidir o que fazer com elas esta mexendo em dinheiro gravado. A RPC create_installments escreve aqui e nao e mais chamada por nada.';

-- ---------------------------------------------------------------------------
-- 4. A fatura passa a carregar o rotulo
-- ---------------------------------------------------------------------------
-- As duas colunas entram no FIM da lista, que e a unica posicao que
-- `CREATE OR REPLACE VIEW` aceita: trocar a ordem ou o tipo de uma coluna que
-- ja existe faz o REPLACE falhar ("cannot change name of view column"), e a
-- mensagem nao diz qual coluna.
--
-- Por que a tela precisa das COLUNAS, e nao da descricao: a descricao gravada e
-- "Notebook (3/10)", e ela e editavel pelo usuario. Tirar o rotulo dali seria
-- parsing de um texto que a pessoa pode reescrever -- e o sintoma de uma
-- descricao renomeada seria o rotulo desaparecer de uma parcela e ficar na
-- vizinha, na mesma fatura.
--
-- O corpo abaixo e o da 006 palavra por palavra, mais as duas colunas. Ele e
-- repetido inteiro porque `CREATE OR REPLACE VIEW` nao tem forma incremental.

CREATE OR REPLACE VIEW public.card_invoice_lines AS
  SELECT
    t.id                AS transaction_id,
    t.user_id,
    t.account_id,
    a.name              AS account_name,
    a.closing_day,
    a.due_day,
    t.category_id,
    t.description,
    t.amount,
    -- O total da fatura e SUM(invoice_amount), nao SUM(amount). Despesa e
    -- gravada negativa e estorno/pagamento positivo, entao inverter o sinal
    -- aqui faz a compra somar e o estorno abater. Ver a 006.
    (-t.amount) AS invoice_amount,
    t.transaction_date,
    t.transaction_type,
    t.group_id,
    public.card_invoice_month(t.transaction_date, a.closing_day) AS invoice_month,
    public.card_invoice_due_date(
      public.card_invoice_month(t.transaction_date, a.closing_day),
      a.closing_day, a.due_day)                                  AS invoice_due_date,
    -- 035: o rotulo "parcela N de M". NULL nas duas em toda compra avulsa.
    t.installment_number,
    t.installment_total
  FROM public.financial_transactions t
  JOIN public.financial_accounts a ON a.id = t.account_id
  WHERE a.account_type = 'credit_card'
    AND t.transaction_type IN ('expense', 'income');

COMMENT ON VIEW public.card_invoice_lines IS
  'Lancamentos de cartao com o mes e o vencimento da fatura em que caem, e o rotulo de parcela (035).';

-- SEM ESTA LINHA A MIGRATION ABRE A FATURA DE TODO MUNDO.
--
-- Ela NAO e defensiva, e LOAD-BEARING -- e isso foi MEDIDO, nao suposto:
--
--   CREATE TABLE t (a int, b int);
--   CREATE VIEW v AS SELECT a FROM t;
--   ALTER VIEW v SET (security_invoker = true);  -- reloptions {security_invoker=true}
--   CREATE OR REPLACE VIEW v AS SELECT a, b FROM t;
--   SELECT reloptions FROM pg_class WHERE relname = 'v';          -- VAZIO
--
-- `CREATE OR REPLACE VIEW` **APAGA as reloptions da view** (medido no Postgres
-- 17.11, e conferido tambem sobre a `card_invoice_lines` de verdade: ela sai da
-- 006 com `{security_invoker=true}` e o REPLACE da SECAO 4 acima a deixa sem
-- opcao nenhuma). Ou seja, sem o ALTER abaixo esta migration -- que nao fala de
-- permissao em lugar nenhum e tem toda a cara de aditiva -- faria
-- `card_invoice_lines` voltar a rodar com o privilegio do DONO: a RLS das
-- tabelas base deixa de se aplicar e a fatura de qualquer usuario vai para
-- qualquer usuario logado, sem erro, so com linhas a mais.
--
-- Quem mexer nesta view de novo: o ALTER tem de vir DEPOIS de todo
-- `CREATE OR REPLACE VIEW`, e nao pode ser apagado por "isso e redundante" --
-- nao e. O mutante `sem_reafirmar_invoker` de
-- scripts/mutantes-parcela-n-de-m.mjs existe para que apagar esta linha fique
-- vermelho. Ver a SECAO 7 da 006.
ALTER VIEW public.card_invoice_lines SET (security_invoker = true);

REVOKE ALL ON public.card_invoice_lines FROM anon;
GRANT SELECT ON public.card_invoice_lines TO authenticated;

COMMIT;


-- ---------------------------------------------------------------------------
-- 36. 036_categorias_do_usuario.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 036_categorias_do_usuario.sql
--
-- HMO-216: "Todas as categorias devem poder ser personalizadas pelo usuario.
-- ao selecionar uma categoria, ele tem a opcao de criar uma nova categoria, e
-- as categorias agora devem contar com uma subcategoria. Por padrao toda
-- categoria tem a subcategoria 'Outros'."
--
-- ===========================================================================
-- O PONTO DE PARTIDA: `transaction_categories` E UMA TABELA GLOBAL
-- ===========================================================================
-- Hoje a tabela nao tem `user_id`. As 12 categorias que o app mostra sao SEED
-- do 001_baseline, iguais para todas as contas, e a unica policy de escrita
-- que existe e... nenhuma. O 002 deu a `authenticated` o GRANT de DML
-- (`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES`, SECAO 2), mas nunca
-- criou policy de INSERT/UPDATE/DELETE para esta tabela -- entao toda escrita
-- morre na RLS com 42501. Foi exatamente isso que quebrou a transferencia
-- entre contas por dias em producao (ver o cabecalho da 023).
--
-- Abrir essa porta do jeito obvio -- uma policy de INSERT para `authenticated`
-- sem mais nada -- entregaria a cada portador de sessao uma caneta que escreve
-- na tela de TODOS os usuarios do app. A tabela e global; nao existe "minha
-- categoria" sem uma coluna que diga de quem ela e.
--
-- ===========================================================================
-- O RISCO QUE ESTA MIGRATION FECHA DE PROPOSITO (LEIA ANTES DE "SIMPLIFICAR")
-- ===========================================================================
-- A policy de leitura que esta em producao desde o 002 e:
--
--     CREATE POLICY transaction_categories_read ON public.transaction_categories
--       FOR SELECT TO anon, authenticated USING (is_active = TRUE);
--
-- Nao ha filtro de usuario nenhum -- e nao havia porque nao havia dono. No
-- instante em que `user_id` passa a existir, essa MESMA policy, sem uma linha
-- de codigo nova, publica a categoria de cada pessoa para o app inteiro: a
-- lista de categorias de alguem conta onde a pessoa gasta ("Advogado",
-- "Tratamento", "Pensao"). E a familia de defeito de
-- `profiles_select_own_or_public` (ver 032) e da `coluna nova em profiles`.
--
-- Por isso a SECAO 2 APERTA a policy existente para `user_id IS NULL` (o
-- catalogo) e adiciona uma segunda, estreita, para a propria. Policies do
-- mesmo comando sao OR, entao o catalogo continua visivel para todo mundo e
-- cada pessoa ganha so as suas.
--
-- Se alguem reverter o aperto, o teste
-- `database/tests/hmo216_categorias_do_usuario_test.sql` reprova na assercao
-- (4) -- o controle negativo do estranho.
--
-- ===========================================================================
-- POR QUE SUBCATEGORIA E TABELA PROPRIA, E NAO `parent_id` AQUI
-- ===========================================================================
-- `ALTER TABLE transaction_categories ADD COLUMN parent_id` e uma linha, e
-- custaria caro: QUATRO tabelas apontam para `transaction_categories`
-- (`financial_transactions`, `transaction_installments`, `recurring_rules`,
-- `scheduled_transactions`), e nenhum dos consumidores -- os seletores das
-- telas, `/api/reports/categories`, os orcamentos, as regras de
-- categorizacao, as views do 008 -- sabe filtrar `parent_id IS NULL`. Todos
-- eles passariam a listar subcategoria COMO categoria no mesmo seletor, e o
-- total de cada categoria nos relatorios se partiria em duas linhas sem que
-- ninguem tocasse num SELECT.
--
-- Tabela separada e aditiva para todos eles: quem nao conhece
-- `transaction_subcategories` continua lendo exatamente o que lia.
--
-- ===========================================================================
-- A SUBCATEGORIA NAO PODE PERTENCER A OUTRA CATEGORIA (FK COMPOSTA)
-- ===========================================================================
-- Um `subcategory_id` solto em `financial_transactions` aceitaria "Mercado"
-- (de Alimentacao) dentro de Transporte -- um bug de tela viraria dado
-- gravado, e o relatorio por categoria ficaria certo enquanto o detalhe
-- mentiria. CHECK nao resolve: a regra olha OUTRA tabela.
--
-- A trava e uma FK COMPOSTA sobre `(category_id, subcategory_id)`. Ela e
-- declarativa, nao e trigger (nenhuma linha nova de plpgsql na tabela de
-- dinheiro), e o `MATCH SIMPLE` do Postgres -- o default -- faz exatamente o
-- que a feature precisa: se QUALQUER coluna da FK for NULL a restricao passa.
-- Como `subcategory_id` e nulavel e `category_id` e NOT NULL, lancamento sem
-- subcategoria passa, e lancamento COM subcategoria e obrigado a usar uma
-- subcategoria DAQUELA categoria.
--
-- Residual conhecido e deliberado: a verificacao de FK roda com privilegio do
-- sistema, fora da RLS, entao um cliente malicioso consegue apontar para a
-- subcategoria de OUTRA pessoa que esteja sob a mesma categoria do catalogo.
-- Isso nao vaza nada -- a policy de SELECT nao devolve aquela linha, e a tela
-- mostra o lancamento sem subcategoria. O teste fixa esse comportamento na
-- assercao (11), para que ninguem leia como vazamento depois.
--
-- ===========================================================================
-- "POR PADRAO TODA CATEGORIA TEM A SUBCATEGORIA 'OUTROS'"
-- ===========================================================================
-- Isso e invariante, nao uma linha de codigo na rota de criar categoria. Se
-- morasse na rota, toda categoria nascida por outro caminho (a 023 criou uma
-- por migration; a proxima migration vai criar outra) nasceria sem "Outros", e
-- a tela cairia no caso que nunca foi desenhado: seletor de subcategoria
-- vazio, com a categoria ja escolhida.
--
-- Entao e TRIGGER (SECAO 5) + BACKFILL (SECAO 6).
--
-- O trigger e SECURITY INVOKER de proposito, e isso e o contrario do padrao
-- das funcoes do 002. Funciona porque os dois unicos jeitos de uma categoria
-- nascer satisfazem a policy de INSERT da subcategoria por conta propria:
--
--   * usuario criando a propria categoria -> a subcategoria nasce com o mesmo
--     `user_id`, que e `auth.uid()`, e a policy passa;
--   * migration/SQL Editor criando categoria do catalogo -> quem roda e
--     `postgres`, que tem `rolbypassrls`.
--
-- SECURITY DEFINER aqui seria pior: com `FORCE ROW LEVEL SECURITY` ligado na
-- tabela (e esta), nem o dono escapa da policy em sessao normal, entao o
-- DEFINER nao compraria nada e esconderia de quem le que a escrita e do
-- usuario.
--
-- ===========================================================================
-- "TODAS AS CATEGORIAS DEVEM PODER SER PERSONALIZADAS"
-- ===========================================================================
-- Categoria PROPRIA: a pessoa edita a linha (policy de UPDATE, SECAO 2).
--
-- Categoria do CATALOGO: a linha e compartilhada por todo mundo, entao editar
-- ela mesma e impossivel sem mudar a tela dos outros. A personalizacao mora em
-- `transaction_category_prefs` (SECAO 3): nome, icone, cor e "esconder", por
-- usuario e por categoria. O valor efetivo e `COALESCE(pref, linha)` -- a
-- regra esta em `lib/categorias.ts`, testada sem banco.
--
-- Por que nao "copiar a categoria do catalogo para o usuario na primeira
-- edicao": os lancamentos ja gravados apontam para o id do catalogo. A copia
-- deixaria o historico numa categoria e o futuro na outra, com o mesmo nome na
-- tela, e nenhum relatorio somaria os dois.
--
-- ===========================================================================
-- IDEMPOTENTE, E COLAVEL NO SQL EDITOR
-- ===========================================================================
-- Producao nao tem runner de migration: alguem cola este arquivo no SQL Editor
-- do Supabase. Rodar duas vezes tem que ser inofensivo, e nenhuma linha pode
-- ser meta-comando do psql (`\...`) -- uma so reprova o arquivo INTEIRO.
--
-- Nao se usa `ON CONFLICT` em nenhum lugar aqui: as unicidades desta migration
-- sao INDICES PARCIAIS (por causa do `user_id IS NULL` do catalogo), e indice
-- parcial nao serve de arbitro de `ON CONFLICT`. Todo seed e
-- `INSERT ... WHERE NOT EXISTS`, como na 023.

BEGIN;

-- =====================================================
-- SECAO 1: A CATEGORIA GANHA DONO
-- =====================================================

-- NULL = catalogo (as 12 do 001 + a reservada da 023). Nao-NULL = de uma
-- pessoa. Nulavel e o que torna esta migration aditiva: as linhas que ja
-- existem continuam sendo catalogo sem backfill nenhum.
ALTER TABLE public.transaction_categories
  ADD COLUMN IF NOT EXISTS user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'transaction_categories_user_id_fkey'
       AND conrelid = 'public.transaction_categories'::regclass
  ) THEN
    ALTER TABLE public.transaction_categories
      ADD CONSTRAINT transaction_categories_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON COLUMN public.transaction_categories.user_id IS
  'NULL = categoria do catalogo, visivel a todos. Nao-NULL = categoria da '
  'pessoa, visivel so a ela (036). A policy de leitura DEPENDE disso.';

-- ---------------------------------------------------------------------------
-- A unicidade tem de virar DUAS, e por isso a antiga sai
-- ---------------------------------------------------------------------------
-- `unique_category_per_service UNIQUE (service_id, name)` (001) e global. Com
-- dono, ela proibiria a segunda pessoa do app de ter uma categoria chamada
-- "Pets" porque a primeira ja tem -- e o erro apareceria na tela como 23505
-- sobre um nome que ela nunca viu.
--
-- Trocamos por dois indices parciais que cobrem exatamente o que importa:
-- nome unico DENTRO do catalogo, e nome unico DENTRO de cada pessoa. Um
-- `UNIQUE (service_id, name, user_id)` sozinho nao serviria: em indice unico o
-- NULL nao colide com NULL, entao o catalogo deixaria de ser protegido e duas
-- "Alimentação" globais poderiam coexistir.
--
-- `DROP CONSTRAINT IF EXISTS` e seguro aqui: nenhuma FK referencia
-- (service_id, name) -- as quatro tabelas que apontam para esta usam o `id`.
ALTER TABLE public.transaction_categories
  DROP CONSTRAINT IF EXISTS unique_category_per_service;

CREATE UNIQUE INDEX IF NOT EXISTS unique_categoria_do_catalogo
  ON public.transaction_categories (service_id, name)
  WHERE user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_categoria_do_usuario
  ON public.transaction_categories (service_id, user_id, name)
  WHERE user_id IS NOT NULL;

-- O seletor de cada tela lista "catalogo + as minhas". Sem este indice isso e
-- um seq scan na tabela por abertura de formulario.
CREATE INDEX IF NOT EXISTS idx_transaction_categories_user
  ON public.transaction_categories (user_id)
  WHERE user_id IS NOT NULL;

-- Nome em branco e o caso que a tela nao sabe desenhar: um item de seletor com
-- zero pixels de altura, que da para escolher sem ver. E o teto de 60 impede
-- que a categoria vire um paragrafo dentro do `SelectItem`.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'transaction_categories_nome_utilizavel'
       AND conrelid = 'public.transaction_categories'::regclass
  ) THEN
    ALTER TABLE public.transaction_categories
      ADD CONSTRAINT transaction_categories_nome_utilizavel
      CHECK (length(btrim(name)) > 0 AND length(name) <= 60);
  END IF;
END $$;

-- =====================================================
-- SECAO 2: RLS DA CATEGORIA
-- =====================================================

-- ---------------------------------------------------------------------------
-- 2a. O APERTO (a parte que fecha o vazamento descrito no cabecalho)
-- ---------------------------------------------------------------------------
-- A policy do 002 nao muda de nome: ela continua sendo "o catalogo e publico",
-- e agora diz isso com precisao. `anon` continua lendo o catalogo -- o
-- formulario de cadastro monta o seletor antes de resolver a sessao.
DROP POLICY IF EXISTS transaction_categories_read ON public.transaction_categories;
CREATE POLICY transaction_categories_read ON public.transaction_categories
  FOR SELECT TO anon, authenticated
  USING (is_active = TRUE AND user_id IS NULL);

-- ---------------------------------------------------------------------------
-- 2b. As minhas, inclusive as desativadas
-- ---------------------------------------------------------------------------
-- Sem `is_active` de proposito, e isso e diferente do catalogo: a tela de
-- gerenciar categorias precisa mostrar o que a pessoa desativou para ela poder
-- reativar. Desativar e o caminho normal de "apagar" uma categoria que ja tem
-- lancamento apontando para ela (a FK e RESTRICT por omissao, e tem de ser:
-- apagar a categoria de 300 lancamentos nao e o que a pessoa pediu ao clicar
-- em "excluir").
DROP POLICY IF EXISTS transaction_categories_read_own ON public.transaction_categories;
CREATE POLICY transaction_categories_read_own ON public.transaction_categories
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS transaction_categories_insert_own ON public.transaction_categories;
CREATE POLICY transaction_categories_insert_own ON public.transaction_categories
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- O que este policy protege, alem do obvio, e MOVER a propria categoria para
-- outro `user_id` ou para o CATALOGO (`user_id = NULL`) -- que seria publicar
-- "Pensão da Ana" no seletor de todo mundo. O `WITH CHECK` e quem barra isso:
-- `user_id = auth.uid()` e falso quando `user_id` e NULL.
--
-- Vale lembrar (medido na 032) que num `UPDATE ... WHERE ...` quem barra de
-- fato e a policy de SELECT, nao esta; o `USING` daqui importa no `UPDATE` sem
-- WHERE, que nao le nada antes de escrever.
DROP POLICY IF EXISTS transaction_categories_update_own ON public.transaction_categories;
CREATE POLICY transaction_categories_update_own ON public.transaction_categories
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS transaction_categories_delete_own ON public.transaction_categories;
CREATE POLICY transaction_categories_delete_own ON public.transaction_categories
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- O GRANT de DML para `authenticated` nesta tabela JA EXISTE desde o 002
-- (SECAO 2, `GRANT ... ON ALL TABLES`). Repetido aqui porque a migration tem
-- de ser legivel sozinha, e porque e o unico jeito de alguem que leia so este
-- arquivo nao concluir que falta um GRANT.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_categories TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.transaction_categories FROM anon;

-- =====================================================
-- SECAO 3: PERSONALIZACAO DO CATALOGO
-- =====================================================

CREATE TABLE IF NOT EXISTS public.transaction_category_prefs (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- CASCADE: se a categoria deixar de existir, a preferencia sobre ela nao tem
  -- do que falar. Nao ha risco do efeito descrito em
  -- `on-delete-set-null-dispara-check` aqui, porque isto APAGA a linha em vez
  -- de reescrever uma linha de dinheiro.
  category_id uuid NOT NULL REFERENCES public.transaction_categories(id) ON DELETE CASCADE,

  -- Os tres sao NULAVEIS, e o NULL e significativo: "nao personalizei este
  -- campo, use o do catalogo". Gravar uma copia do valor do catalogo em vez de
  -- NULL congelaria o nome: se o catalogo corrigir "Alimentacão" para
  -- "Alimentação", quem tiver pref nunca ve a correcao.
  name        text,
  icon        text,
  color_hex   text,

  -- "Nao quero ver esta categoria no meu seletor." E a unica forma honesta de
  -- "apagar" uma categoria do catalogo: a linha e dos outros tambem, e pode
  -- haver lancamento meu antigo apontando para ela -- que continua aparecendo
  -- no historico, com o nome certo.
  is_hidden   boolean NOT NULL DEFAULT FALSE,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- Uma preferencia por (pessoa, categoria). PK composta em vez de id proprio:
  -- nao existe pergunta neste sistema que comece com "qual preferencia?" sem
  -- dizer de quem e sobre o que.
  PRIMARY KEY (user_id, category_id),

  -- Mesmos limites da coluna que ele sobrescreve. Nome em branco aqui seria
  -- pior que na categoria: a linha do catalogo continua certa e a tela mostra
  -- vazio, o que se le como bug de carregamento.
  CONSTRAINT transaction_category_prefs_nome_utilizavel
    CHECK (name IS NULL OR (length(btrim(name)) > 0 AND length(name) <= 60)),

  -- `color_hex` entra em `style`/`className` na tela. O formato fechado aqui e
  -- o que impede que a cor da categoria seja um vetor de injecao no CSS.
  CONSTRAINT transaction_category_prefs_cor_hex
    CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9A-Fa-f]{6}$'),

  CONSTRAINT transaction_category_prefs_icone_utilizavel
    CHECK (icon IS NULL OR (length(btrim(icon)) > 0 AND length(icon) <= 40))
);

COMMENT ON TABLE public.transaction_category_prefs IS
  'Personalizacao por usuario de uma categoria do catalogo (036). Valor '
  'efetivo = COALESCE(pref, transaction_categories). Ver lib/categorias.ts.';

DROP TRIGGER IF EXISTS update_transaction_category_prefs_updated_at
  ON public.transaction_category_prefs;
CREATE TRIGGER update_transaction_category_prefs_updated_at
  BEFORE UPDATE ON public.transaction_category_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.transaction_category_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_category_prefs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transaction_category_prefs_own ON public.transaction_category_prefs;
CREATE POLICY transaction_category_prefs_own ON public.transaction_category_prefs
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- O `GRANT ... ON ALL TABLES` do 002 e uma fotografia do momento em que ele
-- rodou: nao alcanca tabela criada depois. Sem este bloco a tabela nasce sem
-- GRANT nenhum e toda leitura volta 42501, com cara de RLS (ver 032).
REVOKE ALL ON public.transaction_category_prefs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_category_prefs TO authenticated;

-- =====================================================
-- SECAO 4: A SUBCATEGORIA
-- =====================================================

CREATE TABLE IF NOT EXISTS public.transaction_subcategories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  category_id uuid NOT NULL REFERENCES public.transaction_categories(id) ON DELETE CASCADE,

  -- Mesma convencao da categoria: NULL = do catalogo (o "Outros" que o
  -- backfill cria para cada categoria global), nao-NULL = de uma pessoa.
  --
  -- Subcategoria PROPRIA sob categoria do CATALOGO e o caso principal da
  -- feature: "quero 'Mercado' e 'Restaurante' dentro de Alimentação, sem
  -- inventar uma categoria".
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,

  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT TRUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT transaction_subcategories_nome_utilizavel
    CHECK (length(btrim(name)) > 0 AND length(name) <= 60)
);

COMMENT ON TABLE public.transaction_subcategories IS
  'Subcategoria de uma categoria (036). Toda categoria tem "Outros" por '
  'invariante -- trigger criar_subcategoria_outros + backfill da 036.';

-- A UNIQUE que torna possivel a FK composta da SECAO 7. `id` ja e PK, entao
-- esta nao restringe nada de novo -- ela existe porque o Postgres exige que o
-- lado referenciado de uma FK seja coberto por um indice unico EXATAMENTE
-- sobre aquelas colunas, nessa ordem.
CREATE UNIQUE INDEX IF NOT EXISTS unique_subcategoria_na_categoria
  ON public.transaction_subcategories (category_id, id);

-- Nome unico dentro de (categoria, dono). Duas pessoas podem ter "Mercado" sob
-- Alimentação; a mesma pessoa, nao. Dois indices pelo mesmo motivo da SECAO 1:
-- NULL nao colide com NULL.
CREATE UNIQUE INDEX IF NOT EXISTS unique_subcategoria_do_catalogo
  ON public.transaction_subcategories (category_id, name)
  WHERE user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_subcategoria_do_usuario
  ON public.transaction_subcategories (category_id, user_id, name)
  WHERE user_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_transaction_subcategories_updated_at
  ON public.transaction_subcategories;
CREATE TRIGGER update_transaction_subcategories_updated_at
  BEFORE UPDATE ON public.transaction_subcategories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.transaction_subcategories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_subcategories FORCE ROW LEVEL SECURITY;

-- Leitura: o catalogo (que inclui todo "Outros" global) e as minhas. Mesma
-- forma da categoria, e pelo mesmo motivo -- "Terapia" dentro de Saúde conta
-- sobre a pessoa tanto quanto uma categoria chamada "Terapia".
--
-- `anon` NAO ENTRA AQUI, e isto e diferente de transaction_categories.
--
-- A primeira versao desta migration dava `GRANT SELECT` a `anon` por simetria
-- com a tabela de categorias, e o db-verify reprovou -- com razao. O guard
-- "anon so pode ler as tabelas de referencia" existe porque a chave `anon` vai
-- EMBUTIDA no bundle JS publico: privilegio dela e dado aberto na internet.
--
-- `transaction_categories` e tabela de REFERENCIA de verdade -- as 13 linhas
-- sao as mesmas para todo mundo, e o formulario de cadastro monta o seletor
-- antes de resolver a sessao. Esta tabela nao e: ela guarda linha de usuario na
-- mesma relacao. Que a policy filtre `user_id IS NULL` nao muda o que o GRANT
-- diz, e um GRANT a `anon` numa tabela com dado de usuario e exatamente a
-- forma de erro que aquele guard foi escrito para pegar.
--
-- Nao se perde nada: subcategoria so e lida na tela de lancamento, que exige
-- sessao.
DROP POLICY IF EXISTS transaction_subcategories_read ON public.transaction_subcategories;
CREATE POLICY transaction_subcategories_read ON public.transaction_subcategories
  FOR SELECT TO authenticated
  USING (is_active = TRUE AND user_id IS NULL);

DROP POLICY IF EXISTS transaction_subcategories_read_own ON public.transaction_subcategories;
CREATE POLICY transaction_subcategories_read_own ON public.transaction_subcategories
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS transaction_subcategories_insert_own ON public.transaction_subcategories;
CREATE POLICY transaction_subcategories_insert_own ON public.transaction_subcategories
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS transaction_subcategories_update_own ON public.transaction_subcategories;
CREATE POLICY transaction_subcategories_update_own ON public.transaction_subcategories
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS transaction_subcategories_delete_own ON public.transaction_subcategories;
CREATE POLICY transaction_subcategories_delete_own ON public.transaction_subcategories
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.transaction_subcategories FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_subcategories TO authenticated;

-- =====================================================
-- SECAO 5: O INVARIANTE "TODA CATEGORIA TEM 'OUTROS'"
-- =====================================================

-- O nome vive em uma constante so, aqui, porque ele e lido em tres lugares
-- (este trigger, o backfill da SECAO 6 e `lib/categorias.ts`) e um erro de
-- digitacao em um deles produziria DUAS subcategorias "Outros"/"outros" sem
-- erro nenhum -- o indice unico e sensivel a caixa.
CREATE OR REPLACE FUNCTION public.criar_subcategoria_outros()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- `WHERE NOT EXISTS` em vez de `ON CONFLICT`: as unicidades da tabela sao
  -- indices PARCIAIS, e indice parcial nao arbitra `ON CONFLICT`.
  INSERT INTO public.transaction_subcategories (category_id, user_id, name)
  SELECT NEW.id, NEW.user_id, 'Outros'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.transaction_subcategories s
     WHERE s.category_id = NEW.id
       AND s.user_id IS NOT DISTINCT FROM NEW.user_id
       AND s.name = 'Outros'
  );
  RETURN NULL;  -- AFTER trigger: o valor de retorno e ignorado.
END $$;

COMMENT ON FUNCTION public.criar_subcategoria_outros() IS
  'HMO-216: "por padrao toda categoria tem a subcategoria Outros". E trigger e '
  'nao codigo de rota para que categoria criada por migration tambem tenha.';

-- SECURITY INVOKER, entao NAO ha o problema de ACL das funcoes do 002: nada
-- aqui e avaliado dentro de policy. A funcao so e alcancavel pelo trigger.
DROP TRIGGER IF EXISTS criar_subcategoria_outros_trg ON public.transaction_categories;
CREATE TRIGGER criar_subcategoria_outros_trg
  AFTER INSERT ON public.transaction_categories
  FOR EACH ROW EXECUTE FUNCTION public.criar_subcategoria_outros();

-- =====================================================
-- SECAO 6: BACKFILL
-- =====================================================
-- O trigger da SECAO 5 so vale para categoria criada DEPOIS dele. As 13 que ja
-- existem (12 do 001 + a reservada da 023) precisam do "Outros" agora, senao a
-- tela abre com o seletor de subcategoria vazio para todas elas -- que e 100%
-- dos casos no dia do deploy.
--
-- Nao ha `WHERE user_id IS NULL`: se producao tiver categoria de usuario
-- criada entre esta migration e a anterior (nao tem como, mas o arquivo nao
-- deve depender disso), ela tambem recebe.
--
-- NOTA PARA QUEM FOR TESTAR: ao contrario do backfill da 027, ESTE e visivel
-- em banco criado do zero, e por um motivo especifico -- o trigger da SECAO 5
-- nasce nesta migration, DEPOIS das 13 linhas de seed do 001/023. Entao na
-- cadeia 001 -> ... -> 036 o backfill e o unico caminho para aquelas 13, e
-- apagar este bloco reprova o teste em banco limpo (medido: mutante
-- `sem_backfill` em scripts/mutantes-categorias.sh). Nao ha fixture
-- "antes da 036" a escrever: nao da para plantar categoria de usuario antes
-- desta migration, porque e ela que cria a coluna `user_id`.
INSERT INTO public.transaction_subcategories (category_id, user_id, name)
SELECT c.id, c.user_id, 'Outros'
  FROM public.transaction_categories c
 WHERE NOT EXISTS (
   SELECT 1 FROM public.transaction_subcategories s
    WHERE s.category_id = c.id
      AND s.user_id IS NOT DISTINCT FROM c.user_id
      AND s.name = 'Outros'
 );

-- =====================================================
-- SECAO 7: O LANCAMENTO APONTA PARA A SUBCATEGORIA
-- =====================================================
-- Tres tabelas, porque as tres sao caminhos pelos quais a MESMA tela grava:
-- despesa avulsa e no cartao vao para `financial_transactions`; despesa fixa
-- vira `recurring_rules` + `scheduled_transactions`. Deixar qualquer uma de
-- fora faria a tela aceitar a subcategoria e descartar em silencio.
--
-- `transaction_installments` fica de fora e isso e consciente: aquela tabela
-- nao tem leitor nenhum hoje (nada no app exibe parcela de la) e esta sendo
-- mexida pela HMO-211. Fica registrado como divida, nao como esquecimento.
--
-- ON DELETE SET NULL em `financial_transactions` seria uma ESCRITA na linha de
-- dinheiro -- dispararia `update_account_balance` e os triggers de grupo (ver
-- `on-delete-set-null-dispara-check`). Por isso o default (RESTRICT): apagar
-- subcategoria em uso e barrado, e o caminho de "excluir" na tela e
-- `is_active = FALSE`, que nao toca em lancamento nenhum.

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS subcategory_id uuid;
ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS subcategory_id uuid;
ALTER TABLE public.scheduled_transactions
  ADD COLUMN IF NOT EXISTS subcategory_id uuid;

-- A FK COMPOSTA (o porque esta no cabecalho). Em loop sobre as tres tabelas
-- para que a definicao exista uma vez so: tres copias divergem na primeira vez
-- que alguem ajustar uma.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['financial_transactions', 'recurring_rules', 'scheduled_transactions']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = t || '_subcategoria_da_categoria'
         AND conrelid = ('public.' || t)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I '
        'FOREIGN KEY (category_id, subcategory_id) '
        'REFERENCES public.transaction_subcategories (category_id, id)',
        t, t || '_subcategoria_da_categoria'
      );
    END IF;

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (subcategory_id) '
      'WHERE subcategory_id IS NOT NULL',
      'idx_' || t || '_subcategory', t
    );
  END LOOP;
END $$;

COMMENT ON COLUMN public.financial_transactions.subcategory_id IS
  'Subcategoria do lancamento (036). NULL = sem subcategoria. A FK composta '
  'com category_id garante que ela pertence AQUELA categoria.';

COMMIT;

-- =====================================================
-- DEPOIS DE APLICAR
-- =====================================================
-- Confira as quatro coisas que importam (cole no SQL Editor):
--
--   -- 1. toda categoria tem "Outros"  -> esperado: 0
--   SELECT count(*) FROM transaction_categories c
--    WHERE NOT EXISTS (SELECT 1 FROM transaction_subcategories s
--                       WHERE s.category_id = c.id AND s.name = 'Outros');
--
--   -- 2. o aperto da policy entrou    -> esperado: contem 'user_id IS NULL'
--   SELECT qual FROM pg_policies
--    WHERE tablename = 'transaction_categories' AND policyname = 'transaction_categories_read';
--
--   -- 3. a FK composta esta VALIDADA  -> esperado: 3 linhas, convalidated = t
--   SELECT conrelid::regclass, convalidated FROM pg_constraint
--    WHERE conname LIKE '%_subcategoria_da_categoria';
--
--   -- 4. as tabelas novas tem GRANT   -> esperado: 4 linhas para authenticated
--   SELECT table_name, privilege_type FROM information_schema.role_table_grants
--    WHERE grantee = 'authenticated'
--      AND table_name IN ('transaction_subcategories', 'transaction_category_prefs');
--
-- O codigo que le isso e o da HMO-216; sem o deploy, a aplicacao desta
-- migration e inofensiva (colunas nulaveis, tabelas sem leitor).
-- =====================================================


-- ---------------------------------------------------------------------------
-- 37. 037_tipo_do_lancamento.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 037_tipo_do_lancamento.sql
--
-- HMO-181: "POST /api/personal-finance/transactions grava despesa POSITIVA e
-- sem transaction_type (a linha desaparece das views)."
--
-- ===========================================================================
-- O QUE ESTA MIGRATION CONSERTA, E O QUE ELA DE PROPOSITO NAO FAZ
-- ===========================================================================
-- O POST de /api/personal-finance/transactions nunca listou `transaction_type`
-- no INSERT. Toda linha criada por ele -- e e a rota do botao "Novo
-- lancamento" -- nasceu com a coluna NULA.
--
-- Isso nao e cosmetico. As tres views da 008 filtram:
--
--     WHERE t.transaction_type IN ('expense', 'income')
--
--   monthly_cash_flow        o fluxo de caixa do mes
--   category_monthly_totals  o relatorio por categoria
--   planned_vs_actual        previsto x realizado (o orcamento)
--
-- Uma linha sem tipo fica FORA das tres. Ela continua aparecendo na lista de
-- lancamentos -- `classificarMovimentacao` em lib/movimentacoes.ts cai para
-- `category.is_expense` e ate acerta o rotulo -- e desaparece do fluxo de
-- caixa, dos relatorios e do orcamento. Sem erro, sem aviso, e com a lista
-- provando que o lancamento existe. O defeito foi achado em 2026-09-29
-- sondando a rota de export em producao: o CSV trouxe a coluna Tipo vazia.
--
-- O conserto da ROTA vai em codigo (o INSERT passou a gravar a coluna, e o
-- sinal passou a sair do tipo em vez de o tipo sair do sinal). Esta migration
-- cuida do que ja esta gravado: as linhas que nasceram sem tipo continuam
-- invisiveis nas tres views enquanto ninguem as preencher.
--
-- O QUE ELA NAO FAZ, E POR QUE
-- ----------------------------
-- Nao poe `NOT NULL` nem CHECK em `transaction_type`. Esta migration e
-- aplicada A MAO, no SQL Editor, ANTES de o codigo novo chegar a producao --
-- e o codigo que esta no ar neste momento e justamente o que grava NULL. Uma
-- trava aqui derrubaria em 23502/23514 todo lancamento criado pela tela, entre
-- a colagem do SQL e o deploy. A trava e uma migration POSTERIOR, depois de o
-- codigo estar no ar; ate la quem guarda a coluna sao os 13 mutantes de
-- `npm run mutantes:tipo-e-sinal`.
--
-- Esta migration e, portanto, ADITIVA e inofensiva para o codigo velho: ela
-- so preenche coluna que estava nula. Aplicar com a `main` "velha" nao quebra
-- nada.
--
-- ===========================================================================
-- COMO O TIPO E DEDUZIDO, EM TRES DEGRAUS
-- ===========================================================================
-- 1. PERNA DE TRANSFERENCIA, PRIMEIRO DE TODOS. Uma transferencia e gravada em
--    DUAS pernas que se anulam (015), ligadas por `counterpart_transaction_id`
--    -- e o elo e de UMA VIA so: quem grava a coluna e a perna de ENTRADA.
--    Por isso o degrau olha os dois lados do elo. Classificar uma perna como
--    despesa ou receita e o erro caro deste backfill: as duas entrariam na
--    conta do mes e o pagamento de uma fatura de R$ 1.000 somaria R$ 1.000 em
--    Receitas E R$ 1.000 em Despesas -- com o SALDO continuando certo, porque
--    as duas se anulam. Nao haveria erro para ninguem procurar, so um mes que
--    pareceria mais movimentado do que foi (e a HMO-162 ja pagou para aprender
--    isso uma vez).
--
--    Na pratica toda perna gravada por /api/movimentacoes/transferencia ja tem
--    `transaction_type = 'transfer'` e nao chega aqui. O degrau existe para a
--    linha anterior aquela rota, e por ser o unico erro deste backfill que nao
--    teria sintoma.
--
-- 2. A CATEGORIA. `transaction_categories.is_expense` e o criterio que a tela
--    usa hoje para rotular a linha sem tipo. Deduzir por ela e o que faz o
--    backfill CONCORDAR com o que o usuario ja viu na lista: um backfill que
--    rotulasse diferente mudaria o passado dele na tela.
--
-- 3. O SINAL, so no fim. Linha sem categoria (a categoria pode ter sido
--    apagada) nao tem criterio melhor. Ele erra no estorno -- que chega
--    positivo e e de categoria de despesa --, e por isso vem depois da
--    categoria, nao antes.
--
-- Nenhum degrau devolve NULL: o pior resultado possivel aqui e deixar a linha
-- como estava, porque "deixei como estava" e indistinguivel de "nao rodei".
--
-- ===========================================================================
-- POR QUE O BACKFILL E UMA FUNCAO, E NAO UM UPDATE SOLTO
-- ===========================================================================
-- Um UPDATE escrito direto aqui nao tem como ser testado: o db-verify constroi
-- o banco DO ZERO e aplica as migrations em ordem, entao quando a 037 roda nao
-- existe nenhuma linha antiga para ela preencher. O teste passaria verde sobre
-- zero linhas -- que e exatamente a forma de verificacao vazia que ja mordeu
-- este repositorio antes.
--
-- Com a regra dentro de uma funcao, o teste da 037 planta as linhas ruins,
-- chama a MESMA funcao que a migration chama, e confere o resultado. Nao ha
-- copia da regra no teste.
--
-- A funcao tambem fica no banco como ferramenta de reparo: se outro caminho de
-- escrita voltar a gravar NULL, `SELECT public.backfill_tipo_do_lancamento();`
-- devolve quantas linhas consertou.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A regra, como funcao
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER (o padrao): ela e chamada por quem aplica a migration e pelo
-- teste, os dois como dono do banco. Nao ha caminho do app ate aqui, e o
-- REVOKE abaixo garante que nao passe a haver por descuido -- uma funcao que
-- reescreve `transaction_type` em massa, exposta a `authenticated`, seria
-- limitada pela RLS da tabela mas ainda assim daria a qualquer portador de
-- sessao um botao de "reclassifique meus lancamentos todos".
CREATE OR REPLACE FUNCTION public.backfill_tipo_do_lancamento()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_linhas integer;
BEGIN
  UPDATE public.financial_transactions t
     SET transaction_type = (
           CASE
             -- Degrau 1: perna de transferencia, pelos DOIS lados do elo.
             WHEN t.counterpart_transaction_id IS NOT NULL
               OR EXISTS (
                    SELECT 1
                      FROM public.financial_transactions o
                     WHERE o.counterpart_transaction_id = t.id
                  )
               THEN 'transfer'
             -- Degrau 2: a categoria, que e o que a tela ja mostra.
             WHEN (SELECT c.is_expense
                     FROM public.transaction_categories c
                    WHERE c.id = t.category_id) IS TRUE
               THEN 'expense'
             WHEN (SELECT c.is_expense
                     FROM public.transaction_categories c
                    WHERE c.id = t.category_id) IS FALSE
               THEN 'income'
             -- Degrau 3: o sinal. Zero nao existe (`amount <> 0` e CHECK
             -- desde o 001), entao o ELSE so alcanca valor positivo.
             WHEN t.amount < 0 THEN 'expense'
             ELSE 'income'
           END
         )::public.transaction_financial_type
   WHERE t.transaction_type IS NULL;

  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  RETURN v_linhas;
END;
$$;

COMMENT ON FUNCTION public.backfill_tipo_do_lancamento() IS
  'Preenche financial_transactions.transaction_type onde ele e NULO (HMO-181). Tres degraus: perna de transferencia (pelos dois lados de counterpart_transaction_id), depois transaction_categories.is_expense, depois o sinal do valor. Devolve quantas linhas foram consertadas. Idempotente: a segunda chamada devolve 0. Linha sem tipo fica fora de monthly_cash_flow, category_monthly_totals e planned_vs_actual, e continua aparecendo na lista de lancamentos.';

-- A porta fechada por padrao. `authenticated` tem GRANT amplo neste banco
-- (002, SECAO 2), e EXECUTE em funcao nova e dado a PUBLIC pelo Postgres sem
-- ninguem pedir.
REVOKE ALL ON FUNCTION public.backfill_tipo_do_lancamento() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. O backfill em si
-- ---------------------------------------------------------------------------
-- Idempotente pelo `WHERE transaction_type IS NULL` de dentro da funcao: a
-- segunda aplicacao desta migration consertou 0 linhas, e isso e sucesso.
--
-- O NOTICE existe para a aplicacao A MAO: quem cola isto no SQL Editor nao tem
-- como saber se o backfill alcancou alguma coisa, e "rodou sem erro" e
-- indistinguivel de "nao tinha o que fazer". O numero diz qual dos dois foi.
--
-- Os tres triggers de UPDATE de `financial_transactions` foram conferidos
-- contra este UPDATE antes de ele ser escrito:
--
--   update_account_balance_trigger  subtrai OLD.amount e soma NEW.amount na
--                                   mesma conta. `amount` nao muda aqui, entao
--                                   o efeito liquido no saldo e zero.
--   trigger_auto_create_group_transaction  chama refazer_rateio_do_grupo com
--                                   OLD.group_id e OLD.amount. Os dois ficam
--                                   iguais, entao `v_mudou_grupo` e
--                                   `v_mudou_valor` sao falsos e as duas travas
--                                   de PDG01 nao disparam -- uma despesa de
--                                   grupo com parte JA APROVADA passa por este
--                                   backfill sem recusar. (Se disparassem, a
--                                   migration morreria no meio, no banco do
--                                   Helio e em nenhum outro.)
--   release_statement_entry         so em DELETE.
DO $$
DECLARE
  v_linhas integer;
BEGIN
  v_linhas := public.backfill_tipo_do_lancamento();

  IF v_linhas = 0 THEN
    RAISE NOTICE '037: nenhuma linha sem transaction_type (ou o backfill ja rodou).';
  ELSE
    RAISE NOTICE '037: % linha(s) de financial_transactions ganharam transaction_type e voltaram para monthly_cash_flow, category_monthly_totals e planned_vs_actual.', v_linhas;
  END IF;
END $$;

COMMIT;

-- ===========================================================================
-- CONFERENCIA, PARA RODAR DEPOIS (E A MESMA ANTES, PARA SABER O TAMANHO)
-- ===========================================================================
-- Esta consulta tem o DENOMINADOR junto de proposito. "Quantas linhas estao
-- erradas?" sozinha responde 0 tanto quando esta tudo certo quanto quando a
-- sessao nao enxerga a tabela -- e `financial_transactions` tem RLS, entao uma
-- credencial que nao seja o dono (nem `postgres`) le zero linha e a conferencia
-- passa VAZIA, parecendo a resposta boa.
--
--   SELECT count(*) AS total,
--          count(*) FILTER (WHERE transaction_type IS NULL) AS sem_tipo,
--          count(*) FILTER (WHERE transaction_type = 'expense' AND amount > 0)
--            AS despesa_com_sinal_trocado
--     FROM public.financial_transactions;
--
-- Depois da 037, `sem_tipo` tem de ser 0 com `total` > 0.
--
-- `despesa_com_sinal_trocado` e o OUTRO estrago da HMO-181, e esta migration
-- NAO o conserta: ela nao inverte sinal de linha nenhuma. O motivo e que um
-- valor positivo em categoria de despesa tambem e o que um ESTORNO legitimo
-- parece, e nao ha no banco nada que distinga os dois -- trocar o sinal em
-- massa transformaria estorno em despesa e tiraria dinheiro do saldo de quem
-- lancou certo. Se a consulta acima devolver linhas aqui, elas sao poucas e
-- identificaveis uma a uma pela descricao; a correcao e pela tela.


-- ---------------------------------------------------------------------------
-- 38. 038_transferencia_recorrente.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 038_transferencia_recorrente.sql
--
-- HMO-172. Uma transferencia recorrente ("todo dia 5 mando R$ 1.000 para a
-- poupanca") nao cabia no banco, e o jeito como ela NAO cabia e o defeito:
-- `recurring_rules` e `scheduled_transactions` tem UMA `account_id` cada.
--
-- ===========================================================================
-- POR QUE UMA COLUNA, E NAO DUAS REGRAS
-- ===========================================================================
-- A leitura obvia e "transferencia sao duas pernas, logo sao duas regras": uma
-- de saida na origem e uma de entrada no destino. Ela nao sobrevive ao primeiro
-- mes.
--
-- Duas regras independentes sao duas linhas que NADA obriga a andar juntas.
-- Editar o valor de uma (a tela de gastos fixos edita uma regra por vez) deixa
-- a outra no valor velho, e o resultado e uma transferencia que tira 1.200 de
-- uma conta e poe 1.000 na outra -- R$ 200 desaparecidos por mes, sem erro em
-- lugar nenhum. Apagar uma deixa a outra gerando metade de transferencia para
-- sempre. E os dois estragos tem a MESMA assinatura do defeito que esta issue
-- existe para fechar (`net_worth_history` soma os dois tipos e fecha em zero;
-- `monthly_cash_flow` e `category_monthly_totals` filtram income/expense e nem
-- olham), ou seja: nenhum agregado acusa.
--
-- Uma regra com DOIS destinos e indivisivel por construcao. O par de pernas
-- nasce na baixa, de `pernasDaTransferencia` (lib/transferencia.ts), que e o
-- unico lugar do app que conhece a regra de sinal.
--
-- ===========================================================================
-- O CHECK DO 027 ERA DELIBERADO, E ESTA MIGRATION RESPONDE O MOTIVO DELE
-- ===========================================================================
-- A 027 escreveu, ao criar `scheduled_transactions.transaction_type`:
--
--     'transfer' esta fora. [...] Aceitar o valor aqui criaria um terceiro caso
--     que toda soma de agenda teria de tratar, e o tratamento esquecido seria
--     contar a perna de saida como despesa prevista.
--
-- A objecao estava certa, e o que mudou nao foi a opiniao: foi o codigo. As
-- duas perguntas que a agenda faz hoje tem dono, e as DUAS ja tratam
-- transferencia de proposito:
--
--   `direcaoDaAgenda`  (lib/previsto-x-realizado.ts) -- "quanto ainda vai sair
--      da conta neste mes". Transferencia CONTA: a perna agendada e uma saida
--      datada da conta corrente, e esconde-la prometeria uma folga que nao
--      existe.
--
--   `direcaoNoPainel`  (lib/realizado-e-previsao.ts) -- "quanto vou gastar no
--      periodo". Transferencia NAO conta (devolve NULL): mover dinheiro entre
--      contas proprias nao e gasto.
--
-- Ou seja: o terceiro caso que a 027 temia ja existe e ja esta tratado nos dois
-- sentidos. Alargar o CHECK agora nao abre a porta que ela trancou -- ela foi
-- aberta, com cuidado, pela HMO-187 e pela HMO-215.
--
-- ===========================================================================
-- POR QUE O CHECK CRUZADO, E O QUE ELE IMPEDE
-- ===========================================================================
-- `destination_account_id` sozinha e uma coluna opcional que nao promete nada.
-- Os tres estados que ela precisa tornar impossiveis:
--
--   1. transfer SEM destino. E a regra que materializa UMA perna -- o defeito
--      inteiro da issue, agora gravavel. Sem o CHECK, uma rota que esqueca o
--      campo grava a regra, a agenda gera a ocorrencia, e a baixa descobre que
--      nao tem para onde mandar o dinheiro no pior momento possivel: depois de
--      ja ter lancado a perna de saida.
--   2. transfer com destino IGUAL a origem. As duas pernas cairiam na mesma
--      conta, -total e +total se anulariam, e a tela diria "transferido" sem
--      que nada tivesse se movido. E o bug do HMO-149 com outra roupa, e
--      `validarContasDaTransferencia` ja o recusa no app -- aqui fica o cinto.
--   3. despesa ou receita COM destino. Uma transferencia disfarcada: a baixa le
--      o tipo, nao a coluna, entao ela gravaria UMA perna e a coluna ficaria
--      ali dizendo que havia um destino que ninguem honrou.
--
-- O estado 3 e o que faz o CHECK ser um `CASE` e nao um `OR`: a forma
-- permissiva ("destino NULL OU tipo = transfer") deixa passar o 1.
--
-- SEGURO NUM BANCO NO AR. `destination_account_id` acaba de nascer, entao toda
-- linha existente tem NULL ali e cai no ramo ELSE, que exige exatamente NULL.
-- O unico jeito de uma linha existente violar o CHECK e ja ter
-- `transaction_type = 'transfer'`, e o bloco de guarda abaixo prova que nao ha
-- nenhuma antes de tentar criar a constraint -- com mensagem que diz o que
-- fazer, em vez do 23514 cru que nao diz qual linha nem por que.

-- ---------------------------------------------------------------------------
-- 1. A guarda: nenhuma regra de transferencia pode PRE-EXISTIR
-- ---------------------------------------------------------------------------
-- `recurring_rules.transaction_type` e o enum `transaction_financial_type`, que
-- tem 'transfer' desde o 001_baseline, e NUNCA houve CHECK ali. Nada no banco
-- impediu uma regra de transferencia de ser criada -- o que impediu foi o app
-- nao ter tela. Se uma existir (importacao, SQL Editor, rota futura), ela e por
-- definicao uma regra de meia transferencia, e e justamente o que esta issue
-- conserta: ela precisa de destino antes de a constraint entrar.
--
-- Falhar aqui e o comportamento certo. A alternativa -- criar a constraint como
-- NOT VALID e seguir -- deixaria a linha quebrada no banco e a migration verde,
-- que e o modo de falha mais caro: ninguem volta a olhar.
DO $$
DECLARE
  n_regras integer;
  n_ocorrencias integer;
BEGIN
  SELECT count(*) INTO n_regras
    FROM public.recurring_rules
   WHERE transaction_type = 'transfer';

  SELECT count(*) INTO n_ocorrencias
    FROM public.scheduled_transactions
   WHERE transaction_type = 'transfer';

  IF n_regras > 0 OR n_ocorrencias > 0 THEN
    RAISE EXCEPTION
      'HMO-172: ha % regra(s) e % ocorrencia(s) com transaction_type = ''transfer'' sem destino. Preencha destination_account_id nelas (ou desative-as) antes de aplicar a 038: elas sao transferencias de UMA perna.',
      n_regras, n_ocorrencias;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Para onde o dinheiro vai
-- ---------------------------------------------------------------------------
ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS destination_account_id uuid;

ALTER TABLE public.scheduled_transactions
  ADD COLUMN IF NOT EXISTS destination_account_id uuid;

COMMENT ON COLUMN public.recurring_rules.destination_account_id IS
  'Para qual conta a transferencia recorrente manda o dinheiro (HMO-172). Preenchida SOMENTE quando transaction_type = ''transfer'', e nesse caso obrigatoria e diferente de account_id - ver o CHECK recurring_rules_destino_check. account_id continua sendo a ORIGEM. Uma regra com os dois lados e indivisivel: duas regras independentes divergiriam na primeira edicao e a transferencia passaria a tirar de uma conta mais do que poe na outra.';

COMMENT ON COLUMN public.scheduled_transactions.destination_account_id IS
  'Copia do destino da regra, por ocorrencia (HMO-172). A baixa monta as duas pernas a partir de account_id (origem) e desta coluna (destino), por pernasDaTransferencia - sem ela a baixa lancaria UMA perna e os saldos das duas contas ficariam errados em direcoes opostas, com o total geral certo e nenhum agregado acusando.';

-- As FKs vao sem ON DELETE: `account_id` tambem vai (005), e pelo mesmo motivo.
-- Apagar uma conta que e destino de uma regra ativa tem de ser recusado pelo
-- banco -- um SET NULL aqui transformaria a regra em transferencia sem destino
-- (o estado 1 acima) e ainda violaria o CHECK na escrita seguinte, numa linha
-- que ninguem tocou. O 23503 chega na hora em que a pessoa ainda entende o que
-- pediu.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recurring_rules_destination_account_id_fkey'
  ) THEN
    ALTER TABLE public.recurring_rules
      ADD CONSTRAINT recurring_rules_destination_account_id_fkey
      FOREIGN KEY (destination_account_id)
      REFERENCES public.financial_accounts(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scheduled_transactions_destination_account_id_fkey'
  ) THEN
    ALTER TABLE public.scheduled_transactions
      ADD CONSTRAINT scheduled_transactions_destination_account_id_fkey
      FOREIGN KEY (destination_account_id)
      REFERENCES public.financial_accounts(id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. O CHECK do 027, alargado
-- ---------------------------------------------------------------------------
-- Tem de ser DROP + ADD, e nao um `IF NOT EXISTS` como o da 027: a constraint
-- JA EXISTE com o texto estreito. Um bloco que so cria quando falta nao faria
-- nada aqui, a migration ficaria verde, e a primeira transferencia prevista
-- levaria 23514 -- uma migration "aplicada" que nao mudou o que prometeu.
--
-- `IF EXISTS` no DROP mantem a migration re-executavel, inclusive num banco
-- onde a 027 nunca rodou.
ALTER TABLE public.scheduled_transactions
  DROP CONSTRAINT IF EXISTS scheduled_transactions_transaction_type_check;

ALTER TABLE public.scheduled_transactions
  ADD CONSTRAINT scheduled_transactions_transaction_type_check
  CHECK (
    transaction_type IS NULL
    OR transaction_type IN ('income', 'expense', 'transfer')
  );

COMMENT ON COLUMN public.scheduled_transactions.transaction_type IS
  'Para que lado esta previsao aponta: income (vou receber), expense (vou pagar) ou transfer (vou mover entre contas minhas, HMO-172). NULL quer dizer "pergunte a recurring_rules.transaction_type da regra que gerou esta ocorrencia". A baixa le COALESCE(este, o da regra, ''expense''), e e ele que decide o SINAL do lancamento criado - e, em transfer, que ha DUAS pernas em vez de uma. A ocorrencia de transferencia grava ''transfer'' explicitamente (nao herda da regra): o CHECK do destino precisa do tipo na propria linha para poder exigir destination_account_id.';

-- ---------------------------------------------------------------------------
-- 4. O CHECK cruzado: o destino e obrigatorio em transfer e proibido fora dele
-- ---------------------------------------------------------------------------
-- Em `scheduled_transactions` o ramo ELSE alcanca `transaction_type IS NULL`
-- (ocorrencia que herda a direcao da regra, o caso normal de despesa fixa) e
-- exige destino NULL -- correto, e a razao pela qual a materializacao GRAVA
-- 'transfer' na ocorrencia em vez de deixar NULL: sem o tipo na linha, o banco
-- nao teria como saber que aquele destino e legitimo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recurring_rules_destino_check'
  ) THEN
    ALTER TABLE public.recurring_rules
      ADD CONSTRAINT recurring_rules_destino_check
      CHECK (
        CASE WHEN transaction_type = 'transfer'
          THEN destination_account_id IS NOT NULL
               AND account_id IS NOT NULL
               AND destination_account_id <> account_id
          ELSE destination_account_id IS NULL
        END
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_transactions_destino_check'
  ) THEN
    ALTER TABLE public.scheduled_transactions
      ADD CONSTRAINT scheduled_transactions_destino_check
      CHECK (
        CASE WHEN transaction_type = 'transfer'
          THEN destination_account_id IS NOT NULL
               AND account_id IS NOT NULL
               AND destination_account_id <> account_id
          ELSE destination_account_id IS NULL
        END
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. A view do 027 continua entregando `direction`
-- ---------------------------------------------------------------------------
-- `scheduled_transactions_effective` e `SELECT ... COALESCE(s.transaction_type,
-- r.transaction_type, 'expense') AS direction`, e `direction` ja e do tipo
-- `transaction_financial_type` -- que tem 'transfer' desde o 001. Entao a view
-- passa a devolver 'transfer' sozinha, sem ser recriada.
--
-- E DE PROPOSITO QUE ELA NAO E RECRIADA AQUI. `CREATE OR REPLACE VIEW` apaga
-- `reloptions`, e com ele o `security_invoker = true` que a 004 colocou -- a
-- view voltaria a rodar como o DONO dela e furaria a RLS de todo mundo, para
-- consertar uma coluna que nao precisava de conserto. O teste abaixo afirma as
-- duas coisas: que a view entrega direction = 'transfer', e que
-- security_invoker continua ligado.
--
-- `destination_account_id` NAO entra na view. Quem da a baixa le a TABELA (a
-- rota de pay faz `select("*")`), e acrescentar coluna a view exigiria recria-la
-- -- o furo acima -- em troca de nada.

COMMENT ON CONSTRAINT scheduled_transactions_destino_check
  ON public.scheduled_transactions IS
  'HMO-172: transferencia prevista tem destino obrigatorio e diferente da origem; qualquer outro tipo (inclusive NULL, que herda a direcao da regra) tem de ter destino NULL. Impede os tres estados que perdem dinheiro em silencio: transfer sem destino (materializa UMA perna), transfer com destino = origem (as pernas se anulam e a tela diz "transferido"), e income/expense com destino (transferencia disfarcada que a baixa grava como perna unica).';


-- ---------------------------------------------------------------------------
-- 39. 039_convite_por_email_sem_conta.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 039_convite_por_email_sem_conta.sql
--
-- HMO-197: "Convite para quem ainda nao tem conta nunca aparece".
--
-- Terceira falha achada na HMO-190. A HMO-196 consertou as outras duas e, para
-- nao deixar lixo no banco, fez a rota RECUSAR o convite quando o email nao tem
-- conta -- resposta 404 mandando o admin passar o codigo do grupo. Era a saida
-- honesta possivel sem migration, e esta migration e o que ela estava esperando.
--
-- Do que a issue descreve, duas pernas JA ESTAO CONSERTADAS (conferido no
-- codigo de origin/main, nao suposto):
--
--   * `lib/hooks/useGroupInvitations.ts` nao filtra mais por
--     `.eq("invited_user_id", user.id)`: ele chama `list_my_group_invitations()`
--     (030). O filtro ainda existe, mas DENTRO da funcao;
--   * `app/api/expense-groups/invite/route.ts` nao grava mais a linha com
--     `invited_user_id` NULO -- ele recusa antes.
--
-- A terceira continua inteira, e e a desta migration: NADA preenche
-- `invited_user_id` no cadastro. Enquanto nao preencher, a unica forma de nao
-- produzir convite invisivel e recusar o convite -- ou seja, "convidar alguem
-- que ainda nao usa o app" simplesmente nao existe como funcionalidade.
--
-- ===========================================================================
-- O QUE PASSA A SER POSSIVEL
-- ===========================================================================
-- O convite para um email SEM conta volta a ser gravado (`invited_user_id`
-- NULO), e o trigger desta migration o entrega no instante em que a conta
-- daquele email nasce. O canal nao muda e continua sendo o escolhido pelo H. na
-- HMO-196 -- "nao usaremos email, sera enviando um convite para o usuario
-- referente daquele email", dentro do app, no sino. A unica diferenca e QUANDO:
-- o convite espera a conta em vez de ser recusado.
--
-- Nada no caminho de leitura muda. `list_my_group_invitations()` (030),
-- `respond_to_group_invitation()` (030) e `has_pending_invitation()` (002)
-- continuam exigindo `invited_user_id = auth.uid()`, e e exatamente por isso que
-- o conserto e preencher esse campo, e nao afrouxar as tres.
--
-- ===========================================================================
-- POR QUE A COMPARACAO E CONTRA auth.users.email, E NAO profiles.email
-- ===========================================================================
-- Esta e a decisao de seguranca do arquivo, e ela nao e cosmetica.
--
-- O trigger dispara AFTER INSERT ON public.profiles, entao `NEW.email` esta na
-- mao e seria o caminho obvio. Ele e forjavel. A policy da 002 e:
--
--     profiles_update_own: USING (id = auth.uid()) WITH CHECK (id = auth.uid())
--
-- Policy de RLS trava a LINHA, nunca a COLUNA -- nao existe OLD dentro de uma
-- policy. Quem esta logado pode escrever qualquer string em `profiles.email` da
-- propria linha, e `garantirPerfil()` (lib/ensure-profile.ts) grava esse campo a
-- partir do cliente. Casar por `profiles.email` seria entao: crio conta com
-- email qualquer, escrevo `profiles.email = 'vitima@...'` e levo os convites
-- endereçados a ela. Em `auth.users` nao ha policy que deixe o usuario escrever,
-- e o endereco so chega la por cadastro/confirmacao no GoTrue.
--
-- O filtro `email_confirmed_at IS NOT NULL` nao e enfeite: ele e LITERALMENTE a
-- condicao que `get_user_by_email()` (001) usa. Isso faz os dois lados serem
-- complementares exatos, e e o que fecha o buraco do meio:
--
--     rota grava invited_user_id NULO  <=>  nao existe conta CONFIRMADA no email
--     trigger reclama o convite        <=>  passou a existir conta CONFIRMADA
--
-- Se as duas condicoes fossem diferentes sobraria um estado sem dono. Com conta
-- NAO confirmada, por exemplo: a rota nao a encontra (grava NULO) e o perfil so
-- nasce em `/auth/callback`, depois do link de email -- quando a confirmacao ja
-- aconteceu e o trigger acha. Com `mailer_autoconfirm` LIGADO o
-- `email_confirmed_at` ja vem preenchido no cadastro, e o trigger acha tambem.
-- Os dois modos de confirmacao do projeto (HMO-157) estao cobertos.
--
-- O que este filtro NAO e: substituto para a confirmacao de email estar ligada.
-- Com autoconfirm ligado, `email_confirmed_at` vem preenchido sem ninguem provar
-- posse do endereco, e ai quem se cadastrar com o email de outra pessoa recebe
-- os convites dela. Isso e uma propriedade do autoconfirm, nao desta migration
-- -- e ja valia para o `get_user_by_email` desde a 001.
--
-- ===========================================================================
-- SECURITY DEFINER, E POR QUE SEM ELE O TRIGGER FALHARIA EM SILENCIO
-- ===========================================================================
-- A policy de UPDATE da 002 e:
--
--     group_invitations_update:
--       USING (invited_user_id = auth.uid() OR is_group_admin(group_id))
--
-- Quem acabou de se cadastrar nao e admin do grupo, e a linha que ele precisa
-- reclamar tem `invited_user_id` NULO -- `NULL = auth.uid()` nao e verdadeiro.
-- Rodando como `authenticated` o UPDATE nao levanta erro nenhum: a RLS so o faz
-- casar com ZERO linha, `GET DIAGNOSTICS` devolve 0, o cadastro termina com
-- sucesso e o convite continua invisivel. Seria a mesma falha de novo, agora
-- escondida atras de um trigger que "existe" -- e por isso o teste afirma a
-- contagem reclamada, e nao so a ausencia de erro.
--
-- Medido, e registrado aqui porque e contraintuitivo: DEFINER na casca do
-- trigger OU na funcao de casamento, qualquer uma das duas SOZINHA, ja resolve
-- -- dentro de uma funcao DEFINER o `current_user` passa a ser o dono dela, e a
-- chamada aninhada herda isso. Trocar so uma das duas por INVOKER e portanto
-- mutante EQUIVALENTE: nao ha assercao que o mate, e nao ha. As duas ficam
-- DEFINER de proposito, e cada uma por um motivo seu:
--
--   * a de dentro, porque e nela que o privilegio e de fato exercido;
--   * a casca, para que a chamada aninhada nunca dependa de `authenticated` ter
--     EXECUTE em `reclamar_convites_orfaos` -- que a SECAO 1 revoga de propria
--     vontade. Ja houve um trigger neste projeto quebrado exatamente assim.
--
-- O que o teste prende e o par: com as duas INVOKER o cadastro deixa de entregar
-- o convite, e a SECAO 9 dele afirma a falha silenciosa diretamente.
--
-- ===========================================================================
-- ESCOPO
-- ===========================================================================
-- Nenhuma tabela, coluna, indice ou policy nasce ou muda aqui. Sao uma funcao
-- (CREATE OR REPLACE), um trigger (DROP IF EXISTS + CREATE) e um UPDATE de
-- backfill que so encosta em linha com `invited_user_id` NULO. O arquivo e
-- idempotente: pode ser colado no SQL Editor mais de uma vez, e a SECAO 3 (o
-- backfill) pode ser recolada sozinha a qualquer momento sem efeito novo.

-- =====================================================
-- SECAO 1: A REGRA DE CASAMENTO, NUM LUGAR SO
-- =====================================================
-- Esta funcao e chamada de DOIS lugares -- o trigger da SECAO 2 (uma conta, no
-- cadastro) e o backfill da SECAO 3 (todas as contas, uma vez). Ela existe para
-- que a regra nao viva duas vezes: um predicado copiado e um predicado que vai
-- divergir, e os dois copias erram em silencio (o UPDATE que casa com zero linha
-- nao e um erro para o Postgres). O teste da HMO-197 chama ESTA funcao, entao o
-- que o CI exercita e o que roda em producao.
--
-- `p_user_id` NULO = todas as contas. E o backfill; nao ha caminho do app que
-- chegue aqui (ver REVOKE abaixo).
CREATE OR REPLACE FUNCTION public.reclamar_convites_orfaos(
  p_user_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reclamados INTEGER;
BEGIN
  -- O JOIN e com auth.users, e nao com profiles, e e a decisao de seguranca do
  -- arquivo (ver cabecalho): profiles.email e escrito pelo proprio usuario.
  --
  -- `u.email_confirmed_at IS NOT NULL` e literalmente a condicao do
  -- get_user_by_email() (001). E ela que faz os dois lados serem complementares:
  -- a rota grava NULO exatamente quando esta funcao nao acharia ninguem.
  --
  -- `gi.invited_user_id IS NULL` e o que torna este UPDATE seguro de reexecutar e
  -- incapaz de roubar convite: convite que ja achou dono nunca troca de dono.
  --
  -- `gi.invite_method = 'email'` porque o invite_target de um convite 'phone' e
  -- um telefone e o de um 'request' e um pedido de entrada (029) -- nenhum dos
  -- dois e um endereco para onde entregar convite.
  --
  -- auth.users.email e UNIQUE, entao o JOIN nao multiplica linha. Dois enderecos
  -- iguais diferindo so na caixa seriam ambiguos sob o LOWER(), mas o GoTrue
  -- normaliza o email na criacao da conta.
  UPDATE public.group_invitations gi
     SET invited_user_id = u.id,
         updated_at      = NOW()
    FROM auth.users u
   WHERE gi.invited_user_id IS NULL
     AND gi.invite_method   = 'email'
     AND gi.status          = 'pending'
     AND gi.expires_at      > NOW()
     AND u.email_confirmed_at IS NOT NULL
     AND LOWER(btrim(u.email)) = LOWER(btrim(gi.invite_target))
     AND (p_user_id IS NULL OR u.id = p_user_id);

  GET DIAGNOSTICS v_reclamados = ROW_COUNT;
  RETURN v_reclamados;
END $$;

COMMENT ON FUNCTION public.reclamar_convites_orfaos(UUID) IS
  'HMO-197: entrega convite de grupo gravado com invited_user_id NULO (email sem '
  'conta na hora do convite) a conta confirmada daquele endereco. p_user_id NULO '
  '= backfill de todas. Casa contra auth.users.email, nunca profiles.email.';

-- Ninguem do app chama isto: a entrega e automatica no cadastro (SECAO 2) e o
-- backfill e um passo de migration. Deixar `authenticated` executar a versao sem
-- argumento seria dar a qualquer usuario um gatilho para reprocessar a tabela
-- inteira. O trigger continua funcionando porque, dentro de uma funcao
-- SECURITY DEFINER, quem chama e o DONO da funcao -- e ele tem EXECUTE.
REVOKE ALL ON FUNCTION public.reclamar_convites_orfaos(UUID)
  FROM PUBLIC, anon, authenticated;

-- =====================================================
-- SECAO 2: O CONVITE ENCONTRA A CONTA QUANDO ELA NASCE
-- =====================================================
CREATE OR REPLACE FUNCTION public.reclamar_convites_do_novo_perfil()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reclamados INTEGER;
BEGIN
  -- SECURITY DEFINER aqui tambem, e nao so na funcao chamada: o trigger dispara
  -- com a sessao de quem acabou de se cadastrar, e e ela que precisa poder
  -- alcancar a funcao. Uma casca INVOKER chamando uma funcao sem EXECUTE para
  -- `authenticated` quebraria o cadastro inteiro.
  v_reclamados := public.reclamar_convites_orfaos(NEW.id);

  IF v_reclamados > 0 THEN
    RAISE NOTICE 'HMO-197: % convite(s) de grupo entregues a conta nova %',
      v_reclamados, NEW.id;
  END IF;

  RETURN NULL;  -- AFTER trigger: o retorno e ignorado.
END $$;

COMMENT ON FUNCTION public.reclamar_convites_do_novo_perfil() IS
  'HMO-197: convite gravado para um email sem conta fica com invited_user_id '
  'NULO e e invisivel para todos. Este trigger o entrega quando a conta daquele '
  'email nasce. Casa contra auth.users.email (profiles.email e escrito pelo '
  'proprio usuario) e so conta confirmada, igual get_user_by_email().';

-- O perfil e o evento certo, e nao o INSERT em auth.users: `garantirPerfil()`
-- (lib/ensure-profile.ts) e o ponto por onde os DOIS jeitos de um cadastro
-- terminar passam -- com confirmacao ligada, por /auth/callback depois do link;
-- com autoconfirm, direto no signUp. E o `upsert` de la usa
-- `ignoreDuplicates`, entao o INSERT acontece UMA vez por conta, no cadastro,
-- e nao a cada login ou troca de senha.
--
-- Nome com prefixo da issue para nao colidir com os dois triggers que a 001 ja
-- pendura em profiles (incluindo create_user_subscription_trigger). A ordem
-- entre eles e irrelevante aqui: nenhum toca group_invitations.
DROP TRIGGER IF EXISTS hmo197_reclamar_convites_trg ON public.profiles;
CREATE TRIGGER hmo197_reclamar_convites_trg
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.reclamar_convites_do_novo_perfil();

-- =====================================================
-- SECAO 3: BACKFILL DOS CONVITES JA ORFAOS
-- =====================================================
-- O trigger da SECAO 2 so vale para conta criada DEPOIS dele. Em producao
-- (projeto odxqjvtxsioksguuevqm) `group_invitations` tinha 5 INSERTs medidos em
-- 2026-09-30, feitos quando a rota ainda gravava `invited_user_id` NULO. Para
-- cada um desses onde a pessoa se cadastrou no meio do caminho, a linha existe,
-- esta pendente, e nenhuma tela do produto consegue mostra-la.
--
-- Pendentes EXPIRADOS ficam de fora de proposito -- ressuscitar um convite de
-- semanas atras nao e conserto, e o admin pode convidar de novo agora que a rota
-- aceita.
--
-- Esta secao pode ser recolada sozinha no SQL Editor a qualquer momento: ela nao
-- encosta em linha que ja tem dono. Vale guardar para o unico caso que o trigger
-- nao cobre -- uma conta confirmada A MAO no painel do Supabase, que nunca passa
-- por /auth/callback e portanto nunca insere perfil.
DO $$
DECLARE
  v_reclamados INTEGER;
BEGIN
  v_reclamados := public.reclamar_convites_orfaos();
  RAISE NOTICE 'HMO-197 backfill: % convite(s) orfao(s) entregues', v_reclamados;
END $$;


-- ---------------------------------------------------------------------------
-- 40. 040_trava_de_percentual_e_papel_do_membro.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 040_trava_de_percentual_e_papel_do_membro.sql
--
-- HMO-268 (fase 2 de 7 da HMO-245): `group_members_update` nao congela
-- `percentage` nem `role`, e qualquer membro escreve os dois na PROPRIA linha.
--
-- ===========================================================================
-- O QUE ESTA ABERTO
-- ===========================================================================
-- A policy de UPDATE de `group_members` (002_rls_lockdown.sql:526) e a mesma
-- dos dois lados:
--
--     USING      (user_id = auth.uid() OR public.is_group_admin(group_id))
--     WITH CHECK (user_id = auth.uid() OR public.is_group_admin(group_id))
--
-- Ela diz QUAIS LINHAS alguem alcanca, nunca QUAIS COLUNAS -- policy de RLS nao
-- compara OLD com NEW, entao "esta coluna nao muda" e uma frase que policy
-- nenhuma consegue dizer. E o ramo `user_id = auth.uid()` entrega ao membro
-- comum a propria linha INTEIRA.
--
-- Medido como `authenticated` de verdade no banco da cadeia 001..039, com o
-- membro comum B do grupo do admin A -- as tres voltaram `UPDATE 1`:
--
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claim.sub = '<o B>';
--     UPDATE group_members SET percentage = 0.01   WHERE id = '<a linha do B>';
--     UPDATE group_members SET role       = 'admin' WHERE id = '<a linha do B>';
--     UPDATE group_members SET group_id   = '<outro grupo>' WHERE id = '<a do B>';
--
-- Nao e estado que so se forja por dentro do banco: o 002 deu
-- `GRANT ... UPDATE ON ALL TABLES ... TO authenticated` (linha 382) e o
-- PostgREST expoe a tabela, entao o caminho e um PATCH com a chave anon --
-- que sai do bundle -- numa sessao comum.
--
-- ===========================================================================
-- POR QUE AGORA, SE A COLUNA NAO FAZ NADA
-- ===========================================================================
-- Hoje `percentage` e quase inofensiva: ate a fase 3 nenhuma conta sai dela.
-- A fase 4 (HMO-270) faz dela o PESO do rateio do fechamento do mes -- e no dia
-- em que isso entra, este UPDATE deixa de ser enfeite e passa a ser "eu pago
-- 0,01% do aluguel", escrito pelo proprio devedor, sem passar por tela nenhuma.
--
-- `role` nao espera a fase 4: a guarda de "so admin promove" mora na ROTA
-- (`app/api/expense-groups/[groupId]/members/[memberId]/role/route.ts:39`), e
-- nao no banco. O membro que escreve `role = 'admin'` na propria linha vira
-- admin do grupo HOJE, e com isso ganha a policy de admin em
-- `expense_groups`, `group_transactions` e nas linhas dos colegas.
--
-- ===========================================================================
-- POR QUE TRIGGER, E NAO POLICY
-- ===========================================================================
-- Nao da para fechar com policy, e o motivo e estrutural: a unica coisa que
-- distingue a escrita legitima da ilegitima aqui e a COMPARACAO entre a linha
-- velha e a nova, e `WITH CHECK` so enxerga a nova. Quebrar
-- `group_members_update` em duas policies tambem nao ajuda -- policies
-- permissivas sao OR entre si, entao o par teria o mesmo predicado efetivo que
-- a policy unica de hoje. A policy do 002 fica como esta.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION CONGELA ALEM DO QUE A ISSUE PEDIU, E POR QUE
-- ===========================================================================
-- A HMO-268 pede `percentage` e `role`. `group_id` e `user_id` entram junto, e
-- a razao e a terceira linha do bloco medido acima: mover a PROPRIA linha para
-- outro `group_id` passa pela policy (o `user_id` continua sendo o de quem
-- escreve nos dois lados do OR), e quem faz isso entra num grupo que nunca o
-- convidou -- com o `role` que a linha ja carregava. Encadeado com o UPDATE de
-- `role`, o membro comum de um grupo qualquer vira ADMIN de qualquer grupo cujo
-- UUID ele conheca, e passa a ler todas as despesas de lá.
--
-- E o mesmo defeito (policy que nao compara OLD com NEW), na mesma tabela, pelo
-- mesmo caminho, e custa duas comparacoes no trigger que ja esta sendo escrito.
-- Travar `percentage` e deixar essa porta aberta seria entregar meia migration:
-- nao adianta o devedor nao poder baixar a propria parte no grupo do aluguel se
-- ele pode se mudar para o grupo do lado.
--
-- Os dois sao congelados para TODO MUNDO, admin inclusive -- nao e "so admin
-- faz", e "isto nao e edicao". Trocar o grupo ou a pessoa de uma linha de
-- `group_members` nao e corrigir um cadastro: e transformar a participacao de
-- alguem na participacao de outro, mantendo o `id` que `group_expense_splits` e
-- `group_member_proportions` referenciam por FK. Quem precisa de outro membro
-- insere outro membro.
--
-- Levantado contra todos os escritores que existem hoje, e nenhum deles muda
-- nenhuma das quatro colunas:
--
--   * `split-config/route.ts:263` e o UNICO escritor de `percentage` no app, e
--     ja exige `role === 'admin'` (linha 160) -- o trigger passa a dizer no
--     banco a mesma regra que a rota ja diz em HTTP. O upsert dele manda
--     `group_id` e `user_id` no payload (precisa: ver o cabecalho da rota), mas
--     com os valores LIDOS do banco, entao `IS DISTINCT FROM` da falso e o
--     congelamento nao o alcanca;
--   * `members/[memberId]/role/route.ts:100` escreve `role`, e tambem ja exige
--     admin;
--   * `join_group_by_code()` (002:361, 029:135) e `respond_to_group_invitation()`
--     (030:231) chegam aqui por `ON CONFLICT ... DO UPDATE`, que DISPARA BEFORE
--     UPDATE. As tres tocam `status` e `updated_at` e mais nada -- se alguma
--     tocasse `role`, entrar em grupo passaria a ser recusado para quem nao e
--     admin dele, que e justamente quem esta entrando. Vale reconferir isso ao
--     mexer nessas funcoes;
--   * `leave/route.ts` (status, left_at), `[groupId]/route.ts:399` (archived),
--     `restore/route.ts:92` (active) e `approve/route.ts:86` (status) nao tocam
--     nenhuma das quatro. O `leave` recusa a saida do unico admin em vez de
--     promover alguem (linha 74), entao nao existe promocao automatica que o
--     trigger precise deixar passar.
--
-- ===========================================================================
-- IDEMPOTENTE
-- ===========================================================================
-- Producao nao tem runner de migration: alguem cola este arquivo no SQL Editor
-- do Supabase (ver a nota no topo do 015). `CREATE OR REPLACE FUNCTION` mais
-- `DROP TRIGGER IF EXISTS` antes do `CREATE TRIGGER` fazem a segunda passada
-- ser inofensiva, e nenhuma linha aqui e meta-comando do psql (`\...`) -- uma
-- unica delas reprovaria o arquivo INTEIRO no SQL Editor.

BEGIN;

-- ---------------------------------------------------------------------------
-- A guarda
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER explicito e `search_path` fixo, como a `expense_splits_guard`
-- do 025. INVOKER e o certo: a unica pergunta privilegiada do corpo ("quem
-- escreve e admin deste grupo?") e feita por `public.is_group_admin`, que o 002
-- ja criou SECURITY DEFINER exatamente para poder ler `group_members` sem RLS.
-- Reusar a funcao do 002 em vez de repetir o EXISTS aqui nao e economia de
-- linha: e o que garante que a definicao de "admin do grupo" usada pelo trigger
-- nao possa divergir da que as policies usam. Duas copias dessa regra, uma
-- delas desatualizada, e um buraco com cara de redundancia.
--
-- `auth.uid() IS NULL` passa direto. Quem chega assim e `service_role`, cron ou
-- psql direto -- backend nosso, que precisa poder corrigir cadastro de membro e
-- rodar backfill. Nao e brecha para o app: `anon` levou `REVOKE ALL` da tabela
-- no 002 (SECAO 2), e um `authenticated` sem claim `sub` teria `user_id = NULL`
-- e `is_group_admin(...) = FALSE` na policy de UPDATE -- os dois lados do OR
-- dao NULL ou FALSE, nenhum e TRUE, e a RLS nao lhe entrega linha nenhuma para
-- este trigger julgar.
--
-- `IS DISTINCT FROM`, e nao `<>`, nas quatro: `percentage` e NULLABLE (001:1215
-- -- `numeric(5,2) DEFAULT 0.00`, sem NOT NULL). Com `<>`, sair de NULL para
-- 0.01 daria NULL, que nao e TRUE, e o IF nao entraria -- a trava passaria ao
-- largo de toda linha cujo percentual nunca foi preenchido, que sao todas as
-- que nenhum admin configurou ainda. O operador correto aqui e o unico que
-- trata NULL como valor.
CREATE OR REPLACE FUNCTION public.group_members_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Identidade da linha, congelada para todo mundo -- ver o cabecalho.
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION
      'linha de group_members nao troca de grupo: entre no outro grupo em vez de mudar esta (era %, veio %)',
      OLD.group_id, NEW.group_id
      USING ERRCODE = '42501';
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION
      'linha de group_members nao troca de pessoa: adicione o outro membro em vez de mudar esta (era %, veio %)',
      OLD.user_id, NEW.user_id
      USING ERRCODE = '42501';
  END IF;

  -- O peso do rateio a partir da fase 4. Sobe E desce: "so para cima" seria
  -- trava pela metade, e pagar menos do que se deve e o lado que custa dinheiro
  -- aos outros membros.
  IF NEW.percentage IS DISTINCT FROM OLD.percentage
     AND NOT public.is_group_admin(OLD.group_id) THEN
    RAISE EXCEPTION
      'so um admin do grupo muda o percentual de divisao do membro (era %, veio %)',
      OLD.percentage, NEW.percentage
      USING ERRCODE = '42501';
  END IF;

  -- `is_group_admin(OLD.group_id)` e nao `NEW`: o grupo da linha ja esta
  -- congelado acima, entao os dois sao iguais quando a execucao chega aqui --
  -- OLD e o que deixa isso explicito para quem ler depois, e e o que continua
  -- certo se um dia o congelamento do grupo sair.
  IF NEW.role IS DISTINCT FROM OLD.role
     AND NOT public.is_group_admin(OLD.group_id) THEN
    RAISE EXCEPTION
      'so um admin do grupo muda o papel do membro (era %, veio %)',
      OLD.role, NEW.role
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_group_members_guard ON public.group_members;
CREATE TRIGGER trg_group_members_guard
  BEFORE UPDATE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.group_members_guard();

-- Sem REVOKE, pelos dois motivos escritos no 025: no Supabase
-- `REVOKE ... FROM PUBLIC` nao fecha concessao nominal a
-- `anon`/`authenticated`/`service_role`, e aqui nao ha o que fechar -- a funcao
-- devolve `trigger`, o Postgres recusa chamada direta ("can only be called as a
-- trigger") e o PostgREST nao expoe esse tipo de retorno como RPC.
--
-- O que este trigger PRECISA e o contrario de um revoke: que `authenticated`
-- NAO perca o `EXECUTE` em `public.is_group_admin(UUID)`, concedido no 002
-- (linha 304). O corpo acima a chama com `NOT public.is_group_admin(...)`, e
-- chamada de funcao DENTRO do corpo e checada no disparo -- ao contrario do
-- EXECUTE da propria funcao de trigger, que e checado na criacao do trigger.
-- Revogar aquele GRANT achando que e endurecimento nao abriria a trava: ela
-- falharia FECHADA, com `permission denied for function is_group_admin` --
-- 42501, o mesmo SQLSTATE das recusas legitimas -- e o que quebraria e o
-- caminho do ADMIN. E por isso que a SECAO 6 do teste existe, e por isso que o
-- bloco de prova abaixo confere o GRANT.

-- ---------------------------------------------------------------------------
-- Prova
-- ---------------------------------------------------------------------------
-- O arquivo aborta se algo nao pegou. Sem isto, colar a migration num banco
-- onde uma metade falhou em silencio sai verde, e o buraco continua de pe com
-- um "aplicado" no historico.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF to_regprocedure('public.group_members_guard()') IS NULL THEN
    RAISE EXCEPTION '040 nao criou public.group_members_guard()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = to_regclass('public.group_members')
      AND tgname = 'trg_group_members_guard'
      AND NOT tgisinternal
  ) THEN
    problemas := problemas || E'\n  - o trigger trg_group_members_guard nao ficou em group_members';
  END IF;

  -- BEFORE e FOR EACH ROW nao sao detalhe: um AFTER nao pode recusar via
  -- RAISE sem desfazer escrita ja feita, e um trigger de STATEMENT nao tem
  -- OLD/NEW -- que e a unica coisa que esta migration tem para olhar.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = to_regclass('public.group_members')
      AND tgname = 'trg_group_members_guard'
      AND (tgtype & 1) = 1    -- FOR EACH ROW
      AND (tgtype & 2) = 2    -- BEFORE
      AND (tgtype & 16) = 16  -- UPDATE
  ) THEN
    problemas := problemas || E'\n  - trg_group_members_guard nao e BEFORE UPDATE FOR EACH ROW';
  END IF;

  -- INVOKER e parte do desenho: DEFINER faria o corpo rodar como o dono da
  -- funcao, e `auth.uid()` continuaria sendo o do chamador -- nao mudaria a
  -- decisao, mas criaria um caminho sem RLS nesta tabela que ninguem precisa.
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = to_regprocedure('public.group_members_guard()') AND prosecdef
  ) THEN
    problemas := problemas || E'\n  - group_members_guard ficou SECURITY DEFINER; tem que ser INVOKER';
  END IF;

  IF (SELECT proconfig FROM pg_proc
      WHERE oid = to_regprocedure('public.group_members_guard()')) IS NULL THEN
    problemas := problemas || E'\n  - group_members_guard ficou sem search_path fixo';
  END IF;

  -- A dependencia do corpo. Sem este GRANT o trigger falha fechado no caminho
  -- do admin, com um 42501 que se le como recusa legitima -- ver a nota acima.
  IF to_regprocedure('public.is_group_admin(uuid)') IS NULL THEN
    problemas := problemas || E'\n  - public.is_group_admin(uuid) nao existe; o corpo do trigger a chama';
  ELSIF NOT has_function_privilege(
          'authenticated', to_regprocedure('public.is_group_admin(uuid)'), 'EXECUTE') THEN
    problemas := problemas || E'\n  - authenticated perdeu EXECUTE em is_group_admin(uuid); o admin nao consegue mais mudar percentual nem papel';
  END IF;

  -- O trigger so vale se a tabela ainda tiver RLS: sem ela a policy de UPDATE
  -- nem limita as LINHAS, e travar coluna vira consolo.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = to_regclass('public.group_members') AND relrowsecurity
  ) THEN
    problemas := problemas || E'\n  - group_members esta sem RLS; a trava de coluna nao substitui a de linha';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION '040 nao ficou completa:%', problemas;
  END IF;

  RAISE NOTICE '040 ok: trg_group_members_guard em group_members, INVOKER, com is_group_admin alcancavel por authenticated';
END $$;

COMMIT;


-- ---------------------------------------------------------------------------
-- 41. 041_fatura_escolhida_no_lancamento.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- 041: a fatura ESCOLHIDA no lancamento
-- =====================================================
-- HMO-281 / HMO-288. PR 1 de 3: SO SCHEMA. Nada de TypeScript, nada de tela.
--
-- O QUE MUDA
-- ----------
-- `financial_transactions` ganha `invoice_month_override date`. Quando ela esta
-- preenchida, a linha cai NAQUELA fatura; quando esta NULA -- que e todo o
-- historico e todo lancamento de hoje -- ela continua caindo pela
-- `card_invoice_month(transaction_date, closing_day)` da 006. NULL significa
-- "cai pela data", entao NAO HA BACKFILL: o comportamento de hoje ja e o
-- default.
--
-- POR QUE ESTA MIGRATION VAI SOZINHA, E ANTES DO CODIGO
-- -----------------------------------------------------
-- `components/movimentacoes/FormularioDeLancamento.tsx` escreve em
-- `financial_transactions` DIRETO pelo supabase-js, do navegador. Se o codigo
-- da PR 2 subir antes de a coluna existir em producao, a ordem invertida nao
-- degrada: o PostgREST responde PGRST204 ("column not found") e DERRUBA TODA
-- despesa no cartao -- inclusive a de quem nunca tocou no campo novo. Deploy
-- leva codigo, nao schema; quem cola esta migration no SQL Editor e uma pessoa.
-- Por isso ela vai primeiro, e sozinha.
--
-- O QUE DELIBERADAMENTE NAO ESTA AQUI
-- -----------------------------------
--   * SEM CHECK CRUZADO com `financial_accounts.account_type`. A regra "so
--     cartao aceita override" so se escreve em SQL como trigger (CHECK nao
--     enxerga outra tabela), e um trigger novo sobre a tabela de dinheiro
--     quebra o app NO AR durante a janela entre a colagem e o deploy da PR 2.
--     Quem recusa override fora do cartao e o formulario e a validacao da rota,
--     na PR 2. O custo de nao ter a trava aqui e uma coluna preenchida que
--     nenhuma view le (a `card_invoice_lines` filtra
--     `account_type = 'credit_card'`) -- inerte, nao errado.
--   * SEM policy nova de RLS. A coluna entra numa tabela que ja e protegida
--     linha a linha pelas policies da 002; coluna nova nao abre linha nova.
--     (Ver a nota do item 3 abaixo, que e sobre a VIEW e e outra historia.)
--   * SEM indice. A view filtra por conta e por mes de fatura, nao por esta
--     coluna; um indice aqui seria peso sem leitor.
--
-- RE-EXECUTAVEL
-- -------------
-- A coluna entra por `ADD COLUMN IF NOT EXISTS`, o CHECK so e criado quando
-- `pg_constraint` nao o tem, e a view entra por `CREATE OR REPLACE`.
--
-- COMO APLICAR EM PRODUCAO
-- ------------------------
-- Colar o arquivo INTEIRO no SQL Editor do Supabase. Nao ha meta-comando de
-- psql aqui de proposito (`\i`, `\set` e afins nao colam no SQL Editor).
-- =====================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A coluna
-- ---------------------------------------------------------------------------
-- `date` e nao `integer`+`integer`: o mes da fatura ja e um `date` no primeiro
-- dia do mes em toda a 006 (`card_invoice_month` devolve exatamente isso, e
-- `card_invoice_due_date` recebe exatamente isso). Guardar ano e mes separados
-- obrigaria a remontar a data em todo lugar que compara, e a primeira
-- remontagem errada seria invisivel.

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS invoice_month_override date;

COMMENT ON COLUMN public.financial_transactions.invoice_month_override IS
  'Fatura ESCOLHIDA pelo usuario para esta compra, como o PRIMEIRO DIA do mes da fatura. NULO = cai pela data (card_invoice_month), que e o comportamento historico. So tem efeito em conta credit_card: a card_invoice_lines filtra por account_type.';

-- ---------------------------------------------------------------------------
-- 2. O dia 1, cravado
-- ---------------------------------------------------------------------------
-- A coluna e um MES, e um `date` nao sabe disso. Sem a trava, '2026-10-15'
-- entra: ele sobrevive ao COALESCE, vira `invoice_month` na view, e a tela
-- passa a ter DUAS faturas de outubro -- a de dia 1 e a de dia 15 --, cada uma
-- com parte das compras e um total que nao e o da fatura. Nada erra; a conta
-- so passa a estar partida em dois numeros plausiveis.
--
-- `IS NULL OR ...` e load-bearing: sem o primeiro ramo o CHECK resultaria NULL
-- para toda linha sem override, e CHECK que resulta NULL ACEITA a linha -- o
-- que aqui seria inofensivo, mas a forma errada e a que se copia depois. A
-- trava vale para o caso em que o override EXISTE.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'financial_transactions_invoice_month_override_dia_1'
       AND conrelid = 'public.financial_transactions'::regclass
  ) THEN
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_invoice_month_override_dia_1
      CHECK (invoice_month_override IS NULL
             OR invoice_month_override = date_trunc('month', invoice_month_override)::date);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. A view passa a respeitar a escolha -- NAS DUAS OCORRENCIAS
-- ---------------------------------------------------------------------------
-- O COALESCE tem de entrar em `invoice_month` E em `invoice_due_date`. Esquecer
-- a segunda e o defeito silencioso do par: a linha aparece na fatura ESCOLHIDA
-- com o vencimento da fatura da DATA. A tela mostra a compra no mes certo, e o
-- "fechar fatura" do 015 gera a conta a pagar com vencimento errado -- um
-- boleto com data de outro mes, sem erro em lugar nenhum.
--
-- O corpo abaixo e o da 035 palavra por palavra, mais os dois COALESCE. Ele e
-- repetido inteiro porque `CREATE OR REPLACE VIEW` nao tem forma incremental, e
-- nenhuma coluna muda de nome, de tipo ou de posicao -- qualquer um dos tres
-- faria o REPLACE falhar com "cannot change name of view column", e a mensagem
-- nao diz qual coluna.

CREATE OR REPLACE VIEW public.card_invoice_lines AS
  SELECT
    t.id                AS transaction_id,
    t.user_id,
    t.account_id,
    a.name              AS account_name,
    a.closing_day,
    a.due_day,
    t.category_id,
    t.description,
    t.amount,
    -- O total da fatura e SUM(invoice_amount), nao SUM(amount). Despesa e
    -- gravada negativa e estorno/pagamento positivo, entao inverter o sinal
    -- aqui faz a compra somar e o estorno abater. Ver a 006.
    (-t.amount) AS invoice_amount,
    t.transaction_date,
    t.transaction_type,
    t.group_id,
    -- 041: a fatura escolhida vence a fatura da data. NULO cai na regra da 006.
    COALESCE(t.invoice_month_override,
             public.card_invoice_month(t.transaction_date, a.closing_day)) AS invoice_month,
    -- 041: e o vencimento acompanha a MESMA fatura. Deixar
    -- `card_invoice_month(...)` cru aqui poe a compra na fatura escolhida com o
    -- vencimento da outra.
    public.card_invoice_due_date(
      COALESCE(t.invoice_month_override,
               public.card_invoice_month(t.transaction_date, a.closing_day)),
      a.closing_day, a.due_day)                                  AS invoice_due_date,
    -- 035: o rotulo "parcela N de M". NULL nas duas em toda compra avulsa.
    t.installment_number,
    t.installment_total
  FROM public.financial_transactions t
  JOIN public.financial_accounts a ON a.id = t.account_id
  WHERE a.account_type = 'credit_card'
    AND t.transaction_type IN ('expense', 'income');

COMMENT ON VIEW public.card_invoice_lines IS
  'Lancamentos de cartao com o mes e o vencimento da fatura em que caem (respeitando invoice_month_override, 041), e o rotulo de parcela (035).';

-- SEM ESTA LINHA A MIGRATION ABRE A FATURA DE TODO MUNDO.
--
-- Ela NAO e defensiva, e LOAD-BEARING -- e isso ja foi MEDIDO (Postgres 17.11,
-- registrado na 035 e em database/validation/01_migrations.sql):
--
--   CREATE TABLE t (a int, b int);
--   CREATE VIEW v AS SELECT a FROM t;
--   ALTER VIEW v SET (security_invoker = true);  -- reloptions {security_invoker=true}
--   CREATE OR REPLACE VIEW v AS SELECT a, b FROM t;
--   SELECT reloptions FROM pg_class WHERE relname = 'v';          -- VAZIO
--
-- `CREATE OR REPLACE VIEW` APAGA as reloptions da view. Sem o ALTER abaixo esta
-- migration -- que tem toda a cara de aditiva e nao fala de permissao em lugar
-- nenhum -- faria `card_invoice_lines` voltar a rodar com o privilegio do DONO:
-- a RLS das tabelas base deixa de se aplicar e a fatura de qualquer usuario vai
-- para qualquer usuario logado, sem erro, so com linhas a mais.
--
-- Quem mexer nesta view de novo: o ALTER tem de vir DEPOIS de todo
-- `CREATE OR REPLACE VIEW`, e nao pode ser apagado por "isso e redundante" --
-- nao e. O mutante `sem_reafirmar_invoker` de
-- scripts/mutantes-fatura-escolhida.mjs existe para que apagar esta linha fique
-- vermelho. Ver a SECAO 7 da 006 e a SECAO 4 da 035.
ALTER VIEW public.card_invoice_lines SET (security_invoker = true);

REVOKE ALL ON public.card_invoice_lines FROM anon;
GRANT SELECT ON public.card_invoice_lines TO authenticated;

COMMIT;


-- ---------------------------------------------------------------------------
-- 42. 042_rateio_do_trigger_honra_o_percentual.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- 042: o rateio do trigger passa a honrar o percentual do membro
-- =====================================================
-- HMO-304 (filha da HMO-302, §4.2). SO SCHEMA: nenhum TypeScript, nenhuma tela.
--
-- O DEFEITO
-- ---------
-- A mesma conta vale um numero enquanto esta PREVISTA e outro depois de PAGA.
-- Num grupo 70/30, uma despesa de R$ 1.000:
--
--     previsto   (painel, tela de Despesas, fechamento do mes)   R$ 300,00
--        | a pessoa da baixa na conta
--     realizado  (group_expense_splits -> group_share_entries)   R$ 500,00
--
-- Medido na cadeia 001..041 deste repositorio, com `percentage` 70/30 gravada
-- em `group_members` e uma despesa de -1000,00 com `group_id`:
--
--     split_type | full_name | pct_config | pct_gravado | valor_gravado
--     -----------+-----------+------------+-------------+--------------
--     equal      | A-70      |      70.00 |       50.00 |        500.00
--     equal      | B-30      |      30.00 |       50.00 |        500.00
--
-- A causa esta na SECAO 2c de `refazer_rateio_do_grupo` (024): ela insere a
-- ligacao com `split_type = 'equal'` fixo e as partes com `percentage = 100,
-- amount = 0` de fachada. O BEFORE INSERT `calculate_equal_split` (007) ve
-- `'equal'`, divide IGUAL em centavos inteiros e sobrescreve as duas colunas.
-- A `percentage` configurada nunca e lida por ninguem.
--
-- A HMO-269/270/271 NAO consertou isto, ao contrario do que o comentario de
-- `parteDoMembro` (lib/parte-do-grupo.ts:39-48) supunha: ela mudou
-- `ratearPorPeso` e o FECHAMENTO do mes, que sao o lado PREVISTO. Conferido
-- migration por migration -- 037, 038, 039, 041 e a 040 em voo nao tocam em
-- `split_type`, `calculate_equal_split`, `recalcular_partes_pendentes` nem
-- `refazer_rateio_do_grupo`.
--
-- O QUE MUDA
-- ----------
-- Só a SECAO 2c de `refazer_rateio_do_grupo`. Quando o grupo tem divisao
-- configurada, a ligacao nasce `split_type = 'percentage'` e as partes nascem
-- com o percentual normalizado e o valor em centavos inteiros. O
-- `calculate_equal_split` entao devolve as linhas INTACTAS, porque ele ja sai
-- fora quando `split_type <> 'equal'` (007:449) -- e por isso esta migration
-- nao precisa toca-lo.
--
-- O ramo ELSE de `recalcular_partes_pendentes` tambem nao muda: ele ja reescala
-- pela porcentagem gravada, que agora e a de verdade. Ver o LIMITE CONHECIDO
-- no fim deste cabecalho.
--
-- O QUE O TRIGGER FAZ QUANDO A SOMA NAO FECHA 100 -- A DECISAO
-- ------------------------------------------------------------
-- A issue pede que esta escolha seja explicita, porque as duas funcoes do app
-- tem defeito OPOSTO aqui. A decisao: `percentage` e PESO, e o rateio divide
-- pela SOMA dos pesos -- nao por 100.
--
-- Com 70/27 gravado (soma 97), R$ 1.000 sai 721,65 / 278,35, e a soma e o
-- valor INTEIRO da despesa. A alternativa -- tratar 70 como "70 de 100" e
-- deixar 3% sem dono -- deixaria o saldo do grupo nao fechando em zero, que e
-- o invariante que `group_member_balances` existe para manter.
--
-- Isto NAO e uma invencao desta migration: e a aritmetica que
-- `ratearPorPeso` (lib/fechamento-do-grupo.ts:244) ja usa em producao desde a
-- HMO-270, e e justamente ela que decide o lado PREVISTO. Escolher qualquer
-- outra coisa aqui manteria previsto e realizado discordando -- que e o
-- defeito que esta issue existe para fechar. A regra em uma frase: o trigger
-- rateia pela MESMA conta que o fechamento do mes.
--
-- O DEGRAU DO 0/0: GRUPO LEGADO CONTINUA DIVIDINDO IGUAL
-- ------------------------------------------------------
-- `group_members.percentage` e `numeric(5,2) DEFAULT 0.00` e NULLABLE
-- (001:1215). Grupo que nunca passou pela tela de divisao tem a coluna 0.00
-- (o default) ou NULL -- nos dois casos a soma dos pesos e ZERO, e nao existe
-- proporcao a respeitar.
--
-- Nesse caso a ligacao nasce `split_type = 'equal'` e as partes de fachada,
-- EXATAMENTE como hoje: quem faz a conta continua sendo o
-- `calculate_equal_split`. Isto e deliberado e nao e preguica -- aquela funcao
-- e a aritmetica de divisao igual que esta em producao, tem teste e tem
-- mutante proprios. Reimplementar a divisao igual aqui criaria um SEGUNDO
-- caminho capaz de divergir do primeiro, e o `ratearPorPeso` toma a mesma
-- decisao pelo mesmo motivo ("O DEGRAU DO 0/0", linha 230).
--
-- Consequencia pratica: para todo grupo que nao configurou divisao -- que e
-- todo grupo de hoje, menos os que passaram pela tela da HMO-271 -- esta
-- migration nao muda UM CENTAVO.
--
-- O MEMBRO COM PESO ZERO ENTRE PESOS POSITIVOS
-- --------------------------------------------
-- Num grupo 100/0 o membro de peso zero deve R$ 0,00 -- e o que `ratearPorPeso`
-- da, e e o que "eu nao divido esta conta" significa. Mas
-- `group_expense_splits_percentage_check` (001:1165) exige `percentage > 0`:
-- gravar 0,00 na coluna de DISPLAY derrubaria o INSERT inteiro, e com ele o
-- lancamento.
--
-- Entao a `percentage` sai com piso de 0,01 e o `amount` sai 0,00. O dinheiro
-- esta certo e a coluna de display e uma aproximacao -- que e a mesma escolha
-- que o 007 ja registrou na propria funcao ("A porcentagem vira DISPLAY (...)
-- Quem manda e o valor", 007:496-501), onde o `GREATEST(..., 0.01)` cobre o
-- grupo com mais de 10 mil membros. A linha CONTINUA existindo, com o valor
-- certo, em vez de o membro desaparecer do rateio.
--
-- O DESEMPATE DO CENTAVO QUE SOBRA
-- --------------------------------
-- Maior resto, e o empate vai para o menor `group_members.id` -- a mesma ordem
-- do `calculate_equal_split` (007:476, `ORDER BY gm.id`), para que o caminho
-- igual e o caminho por peso desempatem igual. `ratearPorPeso` desempata pela
-- ORDEM em que o chamador passou os participantes, que nao e observavel daqui;
-- quando dois restos empatam, previsto e realizado podem portanto diferir UM
-- CENTAVO de lugar (nunca no total, que fecha nos dois). Registrado aqui porque
-- e o unico desvio que sobra entre as duas contas.
--
-- POR QUE NAO HA BACKFILL
-- -----------------------
-- Despesa que JA existe fica com a divisao com que nasceu. Reescrever o rateio
-- do historico mudaria o valor de partes que alguem JA APROVOU -- que e
-- exatamente o que as duas travas PDG01 da 024 (linhas 300-322) existem para
-- impedir, e nao ha razao para esta migration fazer pela porta de tras o que a
-- edicao de despesa recusa pela porta da frente. A mudanca vale da proxima
-- despesa em diante.
--
-- Pelo mesmo motivo nao ha ALTER na coluna nem CHECK novo: nenhuma linha
-- existente passa a violar nada, e a migration e reexecutavel (so
-- CREATE OR REPLACE FUNCTION).
--
-- O QUE MUDA DE COMPORTAMENTO E A ISSUE NAO NOMEOU
-- ------------------------------------------------
-- Na tela do grupo existe um seletor "Tipo de Divisão" que default para
-- `equal`. Quando a pessoa deixa esse default, a rota
-- `app/api/expense-groups/[groupId]/transactions/route.ts` grava a despesa COM
-- `group_id` e delega o rateio ao trigger (`partes === null`, linha 273).
-- Num grupo que TEM divisao configurada, essa despesa passa a sair 70/30 em vez
-- de 50/50.
--
-- Isso e o pedido da issue aplicado onde ele importa -- o fechamento do mes ja
-- cobra 70/30 e nao olha esse seletor --, mas vale dito: nao ha mais, por este
-- caminho, como pedir "divisao igual nesta despesa" num grupo 70/30. A divisao
-- COMBINADA da tela (`custom_splits`) continua intacta: ela nasce sem
-- `group_id`, cria a propria ligacao e so depois preenche a coluna (HMO-190),
-- entao a SECAO 2c nem roda para ela.
--
-- LIMITE CONHECIDO, FORA DO ESCOPO DESTA MIGRATION
-- ------------------------------------------------
-- Ao EDITAR o valor de uma despesa, o ramo ELSE de
-- `recalcular_partes_pendentes` reescala cada parte com
-- `ROUND(v_total * es.percentage / 100, 2)`, linha por linha e sem maior resto.
-- Com percentual que nao tem representacao exata em duas casas (os 72,16% de
-- um 70/27), a soma das partes pode ficar um centavo longe do total. Isso ja
-- valia para todo rateio `percentage`/`custom` antes desta migration, e mexer
-- nessa funcao reescreveria assercoes do teste da 024 que provam o caminho
-- igual. Fica registrado, nao consertado.
--
-- MEDIDO: 13 MUTANTES, 11 MORTOS, E OS DOIS SOBREVIVENTES SAO EQUIVALENTES
-- -------------------------------------------------------------------------
-- Com controle positivo (a 042 intacta passa) e controle negativo (sem a 042 o
-- teste reprova na primeira assercao). Os dois que sobreviveram sobreviveram
-- por serem a MESMA funcao escrita de outro jeito, e nao por falta de
-- assercao -- medido no Postgres 17.11:
--
--   * tirar o `COALESCE` da SOMA dos pesos. `SUM` ja ignora NULL, e com todas
--     as linhas NULL ele devolve NULL -- e `IF NULL > 0 THEN` cai no ramo
--     falso, o mesmo lugar onde `0 > 0` cai. O COALESCE fica porque faz do
--     zero uma DECISAO, em vez de depender de NULL ser falsy num IF;
--   * tirar o `ROUND` de `ROUND(ABS(v_amount) * 100)::bigint`. O cast de
--     numeric para bigint JA arredonda (100000.5 -> 100001), e `amount` e
--     `numeric(15,2)`, entao `ABS(amount) * 100` nunca tem casa decimal para
--     arredondar. O ROUND fica por ser a forma exata que o 007 usa na mesma
--     conta -- duas aritmeticas de centavo que se comparam devem se PARECER.
--
-- Rodar depois de 001 -> ... -> 041.
-- =====================================================

-- ---------------------------------------------------------------------------
-- refazer_rateio_do_grupo() -- igual a 024, com a SECAO 2c nova
-- ---------------------------------------------------------------------------
-- Reproduzida INTEIRA de proposito: `CREATE OR REPLACE FUNCTION` substitui o
-- corpo todo, entao copiar so o trecho novo apagaria as travas PDG01 e a
-- checagem de dono. As secoes 1, 2a, 2b e 2d sao byte a byte as da 024 -- o que
-- muda esta marcado com "HMO-304".
CREATE OR REPLACE FUNCTION public.refazer_rateio_do_grupo(
  p_transaction_id uuid,
  p_group_id_antigo uuid DEFAULT NULL,
  p_valor_antigo numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_group_id uuid;
  v_amount NUMERIC;
  v_alvo uuid;
  v_alvo_antigo uuid;
  v_mudou_grupo BOOLEAN;
  v_mudou_valor BOOLEAN;
  v_gt uuid;
  -- HMO-304: o peso do grupo e o total em centavos inteiros.
  v_soma_pesos BIGINT;
  v_total_cents BIGINT;
BEGIN
  SELECT ft.user_id, ft.group_id, ft.amount
    INTO v_user_id, v_group_id, v_amount
    FROM public.financial_transactions ft
   WHERE ft.id = p_transaction_id;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Chamada DIRETA (fora de trigger) por alguem que nao e o dono da despesa
  -- nao passa. Dentro de trigger a checagem nao se repete, e isso e
  -- deliberado: para o trigger disparar, o comando em financial_transactions
  -- ja passou pela RLS daquela tabela, que so deixa o dono escrever. Repetir a
  -- checagem ali quebraria toda escrita feita com um claim que nao e o do dono
  -- -- o backfill de uma migration, uma manutencao por psql numa sessao que
  -- ainda tem `request.jwt.claim.sub` de outra pessoa -- com um erro que nao
  -- tem nada a ver com o que a pessoa estava fazendo.
  IF pg_trigger_depth() = 0 AND auth.uid() IS NOT NULL AND auth.uid() <> v_user_id THEN
    RAISE EXCEPTION 'so o dono do lancamento pode refazer o rateio dele'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Divisao de grupo existe para DESPESA lancada num grupo. Receita no grupo
  -- nao e alguem pagando a conta do restaurante (a view do 007 ja faz essa
  -- distincao para o "pago"), e valor zero nao tem o que dividir.
  v_alvo        := CASE WHEN v_group_id        IS NOT NULL AND v_amount       < 0 THEN v_group_id        END;
  v_alvo_antigo := CASE WHEN p_group_id_antigo IS NOT NULL AND p_valor_antigo < 0 THEN p_group_id_antigo END;

  v_mudou_grupo := v_alvo IS DISTINCT FROM v_alvo_antigo;
  v_mudou_valor := p_valor_antigo IS NOT NULL AND p_valor_antigo IS DISTINCT FROM v_amount;

  -- ------------------------------------------------------------------
  -- 2a. As duas travas da opcao (b), ANTES de qualquer escrita
  -- ------------------------------------------------------------------
  IF v_mudou_grupo AND EXISTS (
       SELECT 1
         FROM public.group_expense_splits es
         JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
        WHERE gt.transaction_id = p_transaction_id
          AND (v_alvo IS NULL OR gt.group_id <> v_alvo)
          AND es.status = 'approved'
     ) THEN
    RAISE EXCEPTION 'Alguem ja aprovou a parte desta despesa no grupo atual. Tirar ela dali apagaria essa aprovacao: estorne e relance, ou peca para reabrir a aprovacao.'
      USING ERRCODE = 'PDG01';
  END IF;

  IF v_mudou_valor AND v_alvo IS NOT NULL AND EXISTS (
       SELECT 1
         FROM public.group_expense_splits es
         JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
        WHERE gt.transaction_id = p_transaction_id
          AND gt.group_id = v_alvo
          AND es.status = 'approved'
     ) THEN
    RAISE EXCEPTION 'Alguem ja aprovou a parte desta despesa no grupo. Mudar o valor mudaria o que essa pessoa aprovou: estorne e relance, ou peca para reabrir a aprovacao.'
      USING ERRCODE = 'PDG01';
  END IF;

  -- ------------------------------------------------------------------
  -- 2b. Tirar a despesa dos grupos onde ela nao esta mais
  -- ------------------------------------------------------------------
  -- Condicionado a v_mudou_grupo de proposito. Sem isso, uma edicao de
  -- descricao apagaria a ligacao de uma despesa POSITIVA de grupo -- que a
  -- rota da tela de grupo cria pela rede de seguranca dela, e que nenhum
  -- trigger recriaria depois.
  IF v_mudou_grupo THEN
    DELETE FROM public.group_transactions gt
     WHERE gt.transaction_id = p_transaction_id
       AND (v_alvo IS NULL OR gt.group_id <> v_alvo);
  END IF;

  IF v_alvo IS NULL THEN
    RETURN;
  END IF;

  SELECT gt.id INTO v_gt
    FROM public.group_transactions gt
   WHERE gt.transaction_id = p_transaction_id
     AND gt.group_id = v_alvo;

  -- ------------------------------------------------------------------
  -- 2c. Grupo novo (ou despesa nova): cria a ligacao e as partes
  -- ------------------------------------------------------------------
  IF v_gt IS NULL THEN
    -- HMO-304: o peso do grupo decide QUAL dos dois caminhos abaixo roda.
    -- COALESCE porque a coluna e NULLABLE, e em centesimos (`* 100`) para a
    -- aritmetica do rateio ser inteira de ponta a ponta -- `numeric(5,2)`
    -- permite 33,33, e `33.33 * total / soma` em NUMERIC arredondaria no meio
    -- do caminho. Escalar os DOIS lados da divisao por 100 nao muda o
    -- resultado.
    SELECT COALESCE(SUM(ROUND(COALESCE(gm.percentage, 0) * 100)::bigint), 0)
      INTO v_soma_pesos
      FROM public.group_members gm
     WHERE gm.group_id = v_alvo
       AND gm.status = 'active';

    IF v_soma_pesos > 0 THEN
      -- CAMINHO NOVO: o grupo configurou divisao. A ligacao diz 'percentage',
      -- e por isso o `calculate_equal_split` (BEFORE INSERT) devolve cada
      -- linha abaixo INTACTA em vez de achatar para partes iguais.
      INSERT INTO public.group_transactions (group_id, transaction_id, split_type, created_by)
      VALUES (v_alvo, p_transaction_id, 'percentage', v_user_id)
      RETURNING id INTO v_gt;

      v_total_cents := ROUND(ABS(v_amount) * 100)::bigint;

      -- Maior resto, em centavos inteiros, com desempate por `gm.id`. O
      -- `base * soma` no resto (em vez de dividir antes) e a mesma forma de
      -- `ratearPorPeso`: com peso inteiro ela e exata por construcao.
      INSERT INTO public.group_expense_splits
        (group_transaction_id, member_id, percentage, amount, status)
      WITH ativos AS (
        SELECT gm.id AS member_id,
               ROUND(COALESCE(gm.percentage, 0) * 100)::bigint AS peso
          FROM public.group_members gm
         WHERE gm.group_id = v_alvo
           AND gm.status = 'active'
      ),
      bruto AS (
        SELECT a.member_id,
               a.peso,
               (v_total_cents * a.peso) / v_soma_pesos AS base_cents,
               (v_total_cents * a.peso) - ((v_total_cents * a.peso) / v_soma_pesos) * v_soma_pesos AS resto
          FROM ativos a
      ),
      com_ordem AS (
        SELECT b.*,
               row_number() OVER (ORDER BY b.resto DESC, b.member_id) AS ordem,
               v_total_cents - SUM(b.base_cents) OVER () AS sobra
          FROM bruto b
      )
      SELECT v_gt,
             c.member_id,
             -- DISPLAY, com piso de 0,01: o CHECK da coluna exige > 0 e o
             -- membro de peso zero deve R$ 0,00 (ver o cabecalho).
             LEAST(GREATEST(ROUND(c.peso * 100.0 / v_soma_pesos, 2), 0.01), 100),
             (c.base_cents + CASE WHEN c.ordem <= c.sobra THEN 1 ELSE 0 END)::numeric / 100,
             'pending'
        FROM com_ordem c;

      RETURN;
    END IF;

    -- CAMINHO DE SEMPRE: soma dos pesos ZERO -- grupo legado, ou grupo que
    -- nunca passou pela tela de divisao. `split_type = 'equal'` e as partes de
    -- fachada, para o `calculate_equal_split` fazer a conta em centavos. Nao
    -- muda um centavo do que a 024 fazia.
    INSERT INTO public.group_transactions (group_id, transaction_id, split_type, created_by)
    VALUES (v_alvo, p_transaction_id, 'equal', v_user_id)
    RETURNING id INTO v_gt;

    INSERT INTO public.group_expense_splits
      (group_transaction_id, member_id, percentage, amount, status)
    SELECT v_gt, gm.id, 100, 0, 'pending'
      FROM public.group_members gm
     WHERE gm.group_id = v_alvo
       AND gm.status = 'active';

    RETURN;
  END IF;

  -- ------------------------------------------------------------------
  -- 2d. Mesmo grupo, valor novo: refaz as partes pendentes
  -- ------------------------------------------------------------------
  IF v_mudou_valor THEN
    PERFORM public.recalcular_partes_pendentes(v_gt);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) IS
  'Poe a divisao de uma despesa em dia com o grupo e o valor atuais dela: cria, move, apaga e recalcula. A divisao nova sai pelo PESO de group_members.percentage (split_type percentage), e cai em divisao igual quando a soma dos pesos e zero. Falha com SQLSTATE PDG01 quando a edicao precisaria apagar ou reescrever uma parte ja aprovada.';

-- A 024 revogou o EXECUTE desta funcao de PUBLIC, anon e authenticated.
-- `CREATE OR REPLACE FUNCTION` PRESERVA os privilegios de uma funcao que ja
-- existe, entao as revogacoes continuam valendo -- mas repetimos aqui para o
-- banco onde esta migration encontre a funcao ausente (e aonde o REPLACE viria
-- a ser um CREATE, com os defaults do projeto Supabase de volta).
REVOKE EXECUTE ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) FROM authenticated';
  END IF;
END $$;

-- A premissa que esta migration tem de poder assumir: o
-- `calculate_equal_split` sai fora quando `split_type <> 'equal'`. Se um dia
-- ele deixar de fazer isso, as partes por peso gravadas acima voltam a ser
-- achatadas para iguais -- em silencio, e so o dinheiro acusaria. NOTICE, e
-- nao EXCEPTION: o mesmo tom da sonda da 025 sobre o calculate_split_amount.
DO $$
BEGIN
  IF to_regprocedure('public.calculate_equal_split()') IS NULL THEN
    RAISE NOTICE '042: calculate_equal_split nao existe -- reler a nota do topo';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = to_regprocedure('public.calculate_equal_split()')
       AND prosrc LIKE '%<> ''equal''%'
  ) THEN
    RAISE NOTICE '042: calculate_equal_split nao sai mais fora no rateio combinado -- reler a nota do topo';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 43. 043_direcao_do_previsto_avulso.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =============================================================================
-- PULODOGATO - A DIRECAO DO PREVISTO AVULSO EM planned_vs_actual (HMO-256)
-- =============================================================================
-- Aplicar no SQL Editor do Supabase, de uma vez. ADITIVA E IDEMPOTENTE: ela
-- troca a EXPRESSAO de duas agregacoes de uma view. Nenhuma coluna entra ou
-- sai, nenhuma tabela e tocada, nenhum dado e reescrito.
--
-- SEGURO DE APLICAR COM A `main` VELHA NO AR. O codigo em producao le esta view
-- pela rota de orcamento e so consome `planned_expense` / `planned_income`, que
-- continuam existindo com o mesmo tipo e no mesmo lugar. O que muda e o VALOR:
-- a receita prevista avulsa para de entrar em `planned_expense` e passa a
-- entrar em `planned_income`. Isso e o conserto, e ele vale com qualquer versao
-- do app.
--
-- =============================================================================
-- O DEFEITO
-- =============================================================================
-- `planned_vs_actual` decidia a direcao de cada conta prevista por
--
--     COALESCE(r.transaction_type, 'expense')
--
-- -- o tipo da REGRA de recorrencia, com 'expense' no fim. E previsao AVULSA
-- nao tem regra: `r.transaction_type` vem NULL pelo LEFT JOIN, e a linha cai
-- em 'expense'. Toda receita prevista avulsa era contada como conta a pagar.
--
-- A coluna que responde a pergunta certa -- `scheduled_transactions
-- .transaction_type`, a direcao da PROPRIA ocorrencia -- existe desde a
-- migration 027, e a view nunca a leu. A tela de cadastro grava ali desde a
-- HMO-188 (a checkbox "ainda nao recebi").
--
-- MEDIDO EM PRODUCAO, 04/10/2026, conta de teste da HMO-255, outubro/2026:
--
--     planned_expense  1.365,00   <- inclui o bonus de 50,00, que e RECEITA
--     planned_income   2.700,00   <- sem o bonus
--
-- O erro e DUPLO na mesma linha: o valor soma no lado errado E deixa de somar
-- no certo. Um bonus de R$ 50,00 move R$ 100,00 de distancia entre os dois
-- numeros, e `expense_variance` -- que a tela imprime como "gastou mais do que
-- previa" -- se desloca com ele.
--
-- =============================================================================
-- O CONSERTO: A VIEW DA AGENDA, E NAO UM SEGUNDO COALESCE
-- =============================================================================
-- O LATERAL do previsto passa a ler `scheduled_transactions_effective` em vez
-- da tabela, e a filtrar por `s.direction`.
--
-- Escrever `COALESCE(s.transaction_type, r.transaction_type, 'expense')` aqui
-- daria o MESMO numero e foi recusado de proposito: seria a terceira copia da
-- precedencia no repositorio. A 027 criou `scheduled_transactions_effective`
-- justamente para que a precedencia tivesse UMA copia, e escreveu no cabecalho
-- dela que "a copia esquecida em uma das tres rotas de leitura seria justamente
-- uma receita prevista aparecendo como conta a pagar". Foi o que aconteceu --
-- tres vezes, e esta view e a terceira. Ler a coluna `direction` e o que faz a
-- proxima mudanca de precedencia alcancar este lugar sozinha.
--
-- O `LEFT JOIN public.recurring_rules` SAI: a view ja faz esse join por dentro,
-- e manter o nosso aqui deixaria `r` sem uso nenhum -- um convite a reescrever
-- o criterio antigo por cima.
--
-- O `chaves` CTE CONTINUA LENDO A TABELA, e isso nao e descuido: ele so precisa
-- de `user_id`, `group_id`, `due_date` e `currency` para montar a chave do mes.
-- Direcao nao entra na chave, e a tabela e o caminho mais curto.
--
-- =============================================================================
-- O QUE ESTA MIGRATION *NAO* MUDA
-- =============================================================================
--   * `pending_count` e `overdue_count` continuam contando TODA linha pendente,
--     receita incluida. Eles respondem "quantas linhas da agenda estao em
--     aberto", nao "quanto eu devo", e mexer neles aqui mudaria dois numeros de
--     tela sem nenhuma issue pedindo. A receita prevista vencida continua
--     aparecendo como pendente -- e ela esta mesmo pendente.
--   * `s.status <> 'cancelled'` fica. Cancelada nunca foi previsao de verdade.
--   * O recorte de moeda e o `IS NOT DISTINCT FROM` do `group_id` ficam
--     identicos. O segundo e o que faz o lado pessoal casar (`group_id` e NULL
--     na maioria das linhas, e `NULL = NULL` nao e verdadeiro); trocar por `=`
--     mostraria previsto e realizado em meses separados, cada um com o outro
--     lado zerado. O caso 5 do teste da 022 guarda o LATERAL contra a
--     duplicacao por moeda, e continua valendo.
--
-- =============================================================================
-- POR QUE `CREATE OR REPLACE` BASTA AQUI
-- =============================================================================
-- A lista de colunas nao muda -- mesmos nomes, mesma ordem, mesmos tipos --,
-- entao o REPLACE e aceito. (A 027 precisou de DROP + CREATE porque LA a view
-- GANHAVA coluna no meio, e `CREATE OR REPLACE` so aceita acrescentar no fim.)
--
-- AVISO PARA A PROXIMA MIGRATION QUE MEXER NESTA VIEW
-- ---------------------------------------------------
-- `CREATE OR REPLACE VIEW` exige a definicao INTEIRA. Quem mexer em qualquer
-- parte de `planned_vs_actual` daqui para frente recola os dois FILTER do
-- previsto junto -- e recolar a versao ANTIGA
-- (`COALESCE(r.transaction_type, 'expense')`) reverte esta migration sem
-- conflito de git, sem erro e sem sintoma: os dois numeros continuam
-- plausiveis.
--
-- ISSO NAO E HIPOTETICO. Enquanto esta issue estava aberta, a branch da HMO-258
-- (`043_realizado_de_grupo_no_previsto_x_realizado.sql`, nao mergeada) ja
-- carregava a definicao completa com o criterio velho nos dois FILTER.
-- Rebaseando aquela branch: trocar o `FROM` do LATERAL do previsto por
-- `public.scheduled_transactions_effective` e os dois FILTER por `s.direction`.
--
-- Quem avisa e o step "A receita prevista AVULSA continua fora de
-- planned_expense no fim da cadeia" do db-verify, que re-roda o teste desta
-- migration DEPOIS de todas as outras.
--
-- `security_invoker` e REPOSTO no fim mesmo em teoria sendo preservado pelo
-- REPLACE. Sem ele a view roda com os direitos do DONO, a RLS de
-- `scheduled_transactions` e de `financial_transactions` deixa de valer, e a
-- view devolve o previsto e o realizado de TODOS os usuarios para qualquer um
-- logado. Repetir o ALTER e barato; descobrir que a preservacao nao valia, nao.
-- O `view_security_invoker_test.sql` cobra isso de todas as views.
-- =============================================================================

CREATE OR REPLACE VIEW public.planned_vs_actual AS
  WITH chaves AS (
    SELECT s.user_id, s.group_id, date_trunc('month', s.due_date)::date AS month, s.currency
    FROM public.scheduled_transactions s
    UNION
    SELECT t.user_id, t.group_id, date_trunc('month', t.transaction_date)::date AS month, t.currency
    FROM public.financial_transactions t
    WHERE t.transaction_type IN ('expense', 'income')
  )
  SELECT
    k.user_id,
    k.group_id,
    k.month,
    COALESCE(p.planned_expense, 0)::numeric(15,2) AS planned_expense,
    COALESCE(p.planned_income, 0)::numeric(15,2)  AS planned_income,
    COALESCE(a.income, 0)::numeric(15,2)  AS actual_income,
    COALESCE(a.expense, 0)::numeric(15,2) AS actual_expense,
    -- positivo = gastou mais do que tinha previsto
    (COALESCE(a.expense, 0) - COALESCE(p.planned_expense, 0))::numeric(15,2) AS expense_variance,
    COALESCE(p.pending_count, 0) AS pending_count,
    COALESCE(p.overdue_count, 0) AS overdue_count,
    k.currency
  FROM chaves k
  LEFT JOIN LATERAL (
    -- `s.direction` (HMO-256): a precedencia ocorrencia -> regra -> 'expense',
    -- resolvida UMA vez, na 027. Antes era COALESCE(r.transaction_type,
    -- 'expense') -- o tipo da REGRA --, e previsao avulsa nao tem regra.
    SELECT
      SUM(s.amount) FILTER (WHERE s.direction = 'expense') AS planned_expense,
      SUM(s.amount) FILTER (WHERE s.direction = 'income')  AS planned_income,
      -- Contagem de linha EM ABERTO, e nao de divida: receita prevista entra
      -- nos dois contadores, igual a antes desta migration.
      COUNT(*) FILTER (WHERE s.status = 'pending') AS pending_count,
      COUNT(*) FILTER (WHERE s.status = 'pending' AND s.due_date < CURRENT_DATE) AS overdue_count
    FROM public.scheduled_transactions_effective s
    WHERE s.user_id = k.user_id
      AND s.group_id IS NOT DISTINCT FROM k.group_id
      AND date_trunc('month', s.due_date)::date = k.month
      AND s.currency IS NOT DISTINCT FROM k.currency
      -- cancelada nunca foi previsao de verdade
      AND s.status <> 'cancelled'
  ) AS p ON TRUE
  LEFT JOIN LATERAL (
    SELECT f.income, f.expense
    FROM public.monthly_cash_flow f
    WHERE f.user_id = k.user_id
      AND f.group_id IS NOT DISTINCT FROM k.group_id
      AND f.month = k.month
      AND f.currency IS NOT DISTINCT FROM k.currency
  ) AS a ON TRUE;

COMMENT ON VIEW public.planned_vs_actual IS
  'Previsto x realizado por mes e MOEDA. A direcao do previsto sai de scheduled_transactions_effective.direction (HMO-256): previsao AVULSA de receita entrava em planned_expense porque o criterio era o transaction_type da REGRA, e avulsa nao tem regra. O LATERAL casa a moeda tambem: sem isso um mes com duas moedas duplicaria a linha e repetiria o previsto inteiro em cada uma.';

-- A RLS desta view depende DISTO. Ver o cabecalho.
ALTER VIEW public.planned_vs_actual SET (security_invoker = true);

-- `CREATE OR REPLACE VIEW` nao mexe em privilegio, mas repetir o GRANT deixa a
-- migration completa para quem a aplicar num banco reconstruido do zero.
REVOKE ALL ON public.planned_vs_actual FROM anon;
GRANT SELECT ON public.planned_vs_actual TO authenticated;


-- ---------------------------------------------------------------------------
-- 44. 044_expiracao_de_convite_sem_sorteio.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- =====================================================
-- HMO-344: a expiracao de convite deixa de depender de sorteio
-- =====================================================
-- O `001_baseline` deixou em `public.group_invitations` um trigger
-- `cleanup_expired_invitations` (AFTER INSERT, FOR EACH ROW) cuja funcao
-- `cleanup_expired_invitations_trigger()` tem o corpo:
--
--     IF random() < 0.1 THEN
--         PERFORM expire_old_invitations();
--     END IF;
--
-- e `expire_old_invitations()` faz `UPDATE group_invitations SET status =
-- 'expired'` em TODA linha `pending` com `expires_at` no passado.
--
-- Ou seja: cada INSERT de convite tinha 10% de chance de varrer a tabela
-- inteira. Duas consequencias, as duas medidas, nenhuma suposta:
--
--   1. TESTE NAO-DETERMINISTICO. Na HMO-197 o mutante SQL `sem_prazo`
--      sobreviveu em 4 de 8 execucoes sobre clones identicos do mesmo banco.
--      A causa era esta varredura: a linha de teste que era `pending` E
--      expirada de proposito virava `expired`, e entao quem a excluia passava
--      a ser o filtro `status = 'pending'` SOZINHO -- o mutante que removia a
--      clausula de prazo virava EQUIVALENTE, nao "furo de assercao". O
--      conserto de la foi local (DISABLE TRIGGER no trecho); a causa ficou.
--
--   2. EM PRODUCAO, A EXPIRACAO ACONTECE EM MOMENTO QUE NENHUMA LEITURA
--      CONTROLA. O `status` de um convite vencido mudava quando alguem
--      inseria um convite qualquer e o dado sorteava menos de 0.1 -- nao
--      quando o convite vencia. Dois leitores do mesmo convite vencido, no
--      mesmo instante, podiam ver `pending` ou `expired` conforme insercoes
--      alheias.
--
-- POR QUE APAGAR E O CONSERTO INTEIRO, SEM BACKFILL
-- -------------------------------------------------
-- Levantamento feito antes de mexer (pre-requisito da issue): NINGUEM le
-- `group_invitations.status = 'expired'`. E todo leitor de `status =
-- 'pending'` ja carrega o filtro de PRAZO ao lado dele:
--
--   * `list_my_group_invitations()`   (030) -- status='pending' AND expires_at > NOW()
--   * `respond_to_group_invitation()` (030) -- status='pending' AND expires_at > NOW()
--   * `has_pending_invitation()`      (002) -- status='pending' AND (expires_at IS NULL OR expires_at > NOW())
--   * `reclamar_convites_orfaos()`    (039) -- status='pending' AND expires_at > NOW()
--   * `app/api/expense-groups/invite/route.ts` -- .eq("status","pending").gt("expires_at", now)
--
-- Entao um convite vencido fica de fora PELO PRAZO, esteja o `status` como
-- estiver. A correcao de leitura ja estava de pe sem o trigger: o trigger nao
-- sustentava nenhuma leitura, so embaralhava o rotulo.
--
-- Nao ha backfill. As linhas que ja estao carimbadas `expired` em producao
-- continuam `expired`, e isso e inofensivo: elas so foram carimbadas porque
-- `expires_at` ja estava no passado, entao os leitores acima as excluem pelo
-- prazo exatamente como antes. O valor 'expired' TAMBEM CONTINUA LEGAL no
-- CHECK da coluna, de proposito -- tirar o valor do CHECK exigiria reescrever
-- linha historica, e nada ganha com isso.
--
-- E `expire_old_invitations()` TAMBEM SAI, por dois motivos
-- -------------------------------------------------------
-- Primeiro, o trigger era o unico chamador dela em todo o repositorio.
--
-- Segundo, e isto foi achado ao conferir o catalogo e nao estava na issue:
-- ela e `SECURITY DEFINER` e nasceu no baseline SEM REVOKE, entao herdou o
-- padrao do Postgres (EXECUTE para PUBLIC). Medido no catalogo:
--
--     has_function_privilege('anon',         'public.expire_old_invitations()','EXECUTE') -> true
--     has_function_privilege('authenticated','public.expire_old_invitations()','EXECUTE') -> true
--
-- Era um UPDATE de tabela inteira, que ignora RLS, alcancavel por `anon`. O
-- estrago possivel era limitado (ela so carimba `expired` em linha JA vencida,
-- e nenhuma leitura usa o rotulo), mas e uma primitiva de escrita anonima sem
-- nenhum chamador legitimo. Apagar fecha isso de graca.
--
-- Se algum dia o rotulo persistido voltar a ser necessario, o lugar dele e um
-- passo AGENDADO (o repo ja tem cron), nunca um sorteio dentro de trigger.
--
-- Aditiva no sentido que importa: nao cria nem remove coluna, nao mexe em
-- linha, e o codigo que esta em producao hoje nao chama nada do que sai aqui.
-- Aplicar com a `main` velha e inofensivo.
--
-- Idempotente: pode colar duas vezes.
-- =====================================================

BEGIN;

-- Primeiro o trigger, depois a funcao dele: na ordem inversa o DROP FUNCTION
-- falharia por dependencia (e com `CASCADE` apagaria o trigger calado, o que
-- esconderia justamente o que esta sendo apagado).
DROP TRIGGER IF EXISTS cleanup_expired_invitations ON public.group_invitations;

DROP FUNCTION IF EXISTS public.cleanup_expired_invitations_trigger();

-- Sem CASCADE de proposito: se alguem tiver criado um chamador novo desde a
-- leitura do catalogo, o DROP falha e a migration aborta, em vez de levar o
-- chamador embora em silencio.
DROP FUNCTION IF EXISTS public.expire_old_invitations();

COMMENT ON TABLE public.group_invitations IS
  'Convite de grupo. HMO-344: nao ha mais trigger que carimbe status = ''expired'' '
  '(o `cleanup_expired_invitations` do 001 fazia isso sob `random() < 0.1`, em '
  'momento que nenhuma leitura controlava). Um convite vencido continua `pending` '
  'para sempre, e QUEM LE E RESPONSAVEL PELO PRAZO: filtre sempre '
  '`expires_at > NOW()` junto com `status = ''pending''`, nunca o status sozinho. '
  'Linhas historicas carimbadas `expired` seguem validas e tambem estao vencidas.';

COMMIT;


-- ---------------------------------------------------------------------------
-- 45. 045_realizado_de_grupo_no_previsto_x_realizado.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- ===========================================================================
-- 045 -- O REALIZADO DE GRUPO ENTRA NO PREVISTO x REALIZADO (HMO-258)
-- ===========================================================================
-- Medido em `main` (01a7306) por scripts/medidor-hmo258.sql, no mes de maio da
-- conta A da HMO-255 -- mercado 500 e combustivel 400 so dela, jantar de grupo
-- de 90 pago por ela e dividido por 3, mercado de grupo de 60 pago pela B e
-- dividido por 3:
--
--   painel + reports/cash-flow + reports/categories ....... 950,00
--   reports/planned-vs-actual (actual_expense) ............ 900,00   <--
--
-- As duas leituras vivem na MESMA pagina (/dashboard/reports) e discordam em
-- 50,00, que e exatamente a minha parte das duas despesas de grupo do mes
-- (30 do jantar + 20 do mercado da B).
--
-- POR QUE 900 E DEFEITO, E NAO UMA TERCEIRA CONVENCAO LEGITIMA
-- -----------------------------------------------------------
-- A pergunta aberta da HMO-258 e "quando eu pago 90 por tres pessoas, a minha
-- despesa do mes e 90 ou 30?". Ela tem tres respostas defensaveis -- 90 (fluxo
-- de caixa, a tela de Despesas), 30 (minha parte, a 033) e 90 + a parte do que
-- outro pagou (custo com reembolso, HMO-275). Nenhuma delas e ZERO.
--
-- A `planned_vs_actual` responde zero: a despesa de grupo desaparece inteira do
-- lado REALIZADO, qualquer que seja o criterio que a issue venha a escolher. E
-- por isso este conserto NAO depende da decisao de produto que falta na
-- HMO-258 -- ele tira uma das respostas erradas de circulacao sem escolher
-- entre as tres certas.
--
-- O estrago e maior do que um total baixo, porque o relatorio e de VARIANCIA:
-- `expense_variance = actual_expense - planned_expense` existe para dizer
-- "gastou mais do que previu". Com o realizado menor do que qualquer criterio
-- admite, ele parabeniza por uma economia que nao houve -- e faz isso no mesmo
-- /dashboard/reports onde o grafico ao lado mostra 950.
--
-- ISTO E A DIVIDA QUE A 033 DEIXOU ANOTADA, E ELA ANOTOU DE PROPOSITO
-- ------------------------------------------------------------------
-- O cabecalho da 033, em "O QUE ESTA MIGRATION NAO TOCA":
--
--   "`monthly_cash_flow` [...] tambem alimenta `planned_vs_actual` e o consumo
--    de orcamento, que nao estao no pedido."
--
-- Ou seja: a 033 criou `personal_monthly_cash_flow` (o realizado pessoal COM a
-- minha parte de grupo), apontou as outras duas leituras da pagina de
-- relatorios para ela, e deixou a `planned_vs_actual` para tras com a razao
-- escrita. Esta migration e o resgate dessa linha.
--
-- O QUE MUDA, EXATAMENTE
-- ----------------------
-- Duas coisas, e as duas so no lado PESSOAL (`group_id IS NULL`):
--
--   1. O LADO REALIZADO passa a sair de `personal_monthly_cash_flow` em vez de
--      `monthly_cash_flow`. A primeira ja soma a minha parte de grupo; a
--      segunda tem `group_id` no grao, e uma despesa de grupo nunca cai na
--      linha de `group_id IS NULL`.
--
--   2. AS CHAVES ganham uma terceira origem: `group_share_entries`. Sem isso o
--      item 1 nao bastaria -- um mes em que a MINHA unica despesa foi um
--      mercado que a B pagou nao tem linha nenhuma em
--      `financial_transactions` com `user_id = eu`, entao o `UNION` de `chaves`
--      nao produz chave, e o mes simplesmente NAO APARECE no relatorio. Um mes
--      ausente le-se como "nao houve movimento", que e o pior dos sintomas
--      possiveis aqui: silencioso e plausivel.
--
-- O RELATORIO DO GRUPO (`?groupId=`) NAO MUDA
-- -------------------------------------------
-- Quando `k.group_id IS NOT NULL` o realizado continua saindo de
-- `monthly_cash_flow` filtrada por aquele `group_id`, onde o numero certo e o
-- valor CHEIO da despesa, de todos os membros. E a mesma fronteira que a 033
-- defendeu: consertar a leitura pessoal nao pode quebrar a do grupo. A secao 2
-- do teste mede os dois lados no mesmo mes, justamente porque "a pessoal ficou
-- certa" e "a do grupo continuou certa" sao duas afirmacoes diferentes.
--
-- A chave nova de `group_share_entries` entra com `group_id = NULL` DE
-- PROPOSITO: a minha parte de uma despesa da Casa pertence ao meu relatorio
-- PESSOAL, nao ao relatorio da Casa.
--
-- Com o `group_id` real ali, o efeito medido no membro que SO DEVE parte (nao
-- pagou nada no mes) e este:
--
--   group_id = NULL (certo)  -> uma linha PESSOAL de 50,00, a parte dele
--   group_id real (errado)   -> uma linha DO GRUPO de 0,00, e nenhuma pessoal
--
-- A chave com o `group_id` real nao casa com linha nenhuma de
-- `monthly_cash_flow` daquele membro -- ele nao lancou nada --, entao o
-- realizado dele vem zero. O mes inteiro dele sai do relatorio pessoal e vira
-- uma linha inutil no do grupo.
--
-- Vale registrar o erro: a primeira versao deste comentario dizia "dobraria o
-- realizado do grupo". Medir o mutante mostrou que nao dobra nada -- a despesa
-- do membro DESAPARECE. As duas metades estao presas na secao 2b do teste.
--
-- O QUE ESTA MIGRATION NAO TOCA, E A DIVIDA QUE SOBRA
-- --------------------------------------------------
-- `budget_consumption` -- a outra leitura que a 033 citou na mesma frase --
-- continua lendo `monthly_cash_flow` e portanto continua ignorando despesa de
-- grupo no consumo de orcamento. Nao entra aqui porque "quanto do meu orcamento
-- eu gastei" depende do criterio que a HMO-258 vai escolher de um jeito que a
-- variancia nao depende: um orcamento de categoria pode legitimamente querer so
-- o que e meu, so o que saiu da conta, ou o custo com reembolso. Fica anotado
-- aqui, como a 033 anotou isto.
--
-- ELA CARREGA A 043 INTEIRA, E ISSO NAO E DETALHE
-- ----------------------------------------------
-- `CREATE OR REPLACE VIEW` exige a definicao INTEIRA, entao esta migration
-- reproduz tambem o lado PREVISTO -- e o previsto mudou na 043 (HMO-256)
-- enquanto este arquivo estava em revisao. A versao original daqui carregava a
-- forma anterior, `COALESCE(r.transaction_type, 'expense')`, e teria revertido
-- a 043 em silencio: SQL valido, nenhuma suite do 008 reclamando, e toda
-- receita prevista AVULSA de volta a ser contada como conta a pagar.
--
-- O cabecalho da 043 previu exatamente isto e pediu por escrito que quem mexesse
-- na view recolasse os dois FILTER. Foi o que esta versao faz, e e o unico
-- motivo pelo qual o numero deste arquivo e 045 e nao 043.
--
-- COMO RODAR
-- ----------
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/045_realizado_de_grupo_no_previsto_x_realizado.sql
--
-- Aplicar depois de 001 -> ... -> 044. O preflight aborta listando o que falta.
-- Re-executavel: so tem CREATE OR REPLACE VIEW, COMMENT, GRANT e ALTER VIEW.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Preflight
-- ---------------------------------------------------------------------------
-- As duas views que esta migration passa a ler vem da 033. Sem elas o
-- CREATE OR REPLACE abaixo falharia com "relation does not exist", o que ja
-- seria um erro honesto -- o preflight existe para dizer QUAL migration falta
-- em vez de qual objeto, que e a pergunta que a pessoa tem na hora.
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(msg, E'\n') INTO v_faltando FROM (
    SELECT '  - view public.planned_vs_actual (vem do 008)' AS msg
    WHERE to_regclass('public.planned_vs_actual') IS NULL
    UNION ALL
    SELECT '  - view public.personal_monthly_cash_flow (vem do 033)'
    WHERE to_regclass('public.personal_monthly_cash_flow') IS NULL
    UNION ALL
    SELECT '  - view public.group_share_entries (vem do 033)'
    WHERE to_regclass('public.group_share_entries') IS NULL
    UNION ALL
    SELECT '  - view public.monthly_cash_flow (vem do 008)'
    WHERE to_regclass('public.monthly_cash_flow') IS NULL
    UNION ALL
    -- Da 027, e a 043 e quem passou a LE-LA aqui. O previsto desta view sai de
    -- `scheduled_transactions_effective.direction`; sem ela o CREATE OR REPLACE
    -- falharia com "relation does not exist" e a tentacao seria recolar o
    -- `COALESCE(r.transaction_type, ...)` antigo -- que compila e reverte a 043.
    SELECT '  - view public.scheduled_transactions_effective (vem do 027)'
    WHERE to_regclass('public.scheduled_transactions_effective') IS NULL
    UNION ALL
    SELECT '  - coluna direction em public.scheduled_transactions_effective (vem do 027/043)'
    WHERE to_regclass('public.scheduled_transactions_effective') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'scheduled_transactions_effective'
           AND column_name = 'direction'
      )
    -- A 022 poe `currency` no GRAO das views de relatorio, e as tres chaves do
    -- UNION abaixo casam por moeda. Sem a 022 a view nasceria somando reais com
    -- dolares -- um total que nao esta em moeda nenhuma.
    UNION ALL
    SELECT '  - coluna currency no grao de public.planned_vs_actual (vem do 022/034)'
    WHERE to_regclass('public.planned_vs_actual') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'planned_vs_actual'
           AND column_name = 'currency'
      )
    UNION ALL
    SELECT '  - coluna currency em public.group_share_entries (vem do 033)'
    WHERE to_regclass('public.group_share_entries') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'group_share_entries'
           AND column_name = 'currency'
      )
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'045 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> ... -> 044 antes.', v_faltando;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. planned_vs_actual -- o realizado pessoal passa a incluir a minha parte
-- ---------------------------------------------------------------------------
-- O previsto (`p`) nao muda UMA LINHA em relacao a versao do 008/027/034/037.
-- Esta migration mexe em duas coisas so: a terceira origem de `chaves` e o
-- LATERAL do realizado (`a`). O resto esta reproduzido igual de proposito --
-- `CREATE OR REPLACE VIEW` exige a definicao inteira, e um "pequeno ajuste de
-- passagem" no previsto viria junto sem teste nenhum por cima dele.
CREATE OR REPLACE VIEW public.planned_vs_actual AS
  WITH chaves AS (
    SELECT s.user_id, s.group_id,
           date_trunc('month', s.due_date)::date AS month,
           s.currency
      FROM public.scheduled_transactions s
    UNION
    SELECT t.user_id, t.group_id,
           date_trunc('month', t.transaction_date)::date AS month,
           t.currency
      FROM public.financial_transactions t
     WHERE t.transaction_type IN ('expense', 'income')
    UNION
    -- A TERCEIRA ORIGEM (045). `group_id` NULL: a minha parte de uma despesa da
    -- Casa e do meu relatorio PESSOAL. Sem esta chave, o mes em que a minha
    -- unica despesa foi paga por outro membro nao apareceria no relatorio --
    -- nao como zero, mas AUSENTE.
    SELECT gse.user_id, NULL::uuid AS group_id,
           gse.month,
           gse.currency
      FROM public.group_share_entries gse
  )
  SELECT
    k.user_id,
    k.group_id,
    k.month,
    COALESCE(p.planned_expense, 0)::numeric(15,2) AS planned_expense,
    COALESCE(p.planned_income, 0)::numeric(15,2)  AS planned_income,
    COALESCE(a.income, 0)::numeric(15,2)  AS actual_income,
    COALESCE(a.expense, 0)::numeric(15,2) AS actual_expense,
    -- positivo = gastou mais do que tinha previsto
    (COALESCE(a.expense, 0) - COALESCE(p.planned_expense, 0))::numeric(15,2) AS expense_variance,
    COALESCE(p.pending_count, 0) AS pending_count,
    COALESCE(p.overdue_count, 0) AS overdue_count,
    k.currency
  FROM chaves k
  LEFT JOIN LATERAL (
    -- O PREVISTO E O DA 043, RECOLADO LINHA POR LINHA -- e o cabecalho dela
    -- pediu isto por escrito: "quem mexer em qualquer parte de
    -- `planned_vs_actual` daqui para frente recola os dois FILTER do previsto; a
    -- forma antiga (`COALESCE(r.transaction_type, 'expense')`) reverte esta
    -- migration sem [ninguem reparar]".
    --
    -- Esta migration foi escrita contra a definicao ANTERIOR a 043 e carregava
    -- exatamente aquela forma antiga. Mergeada assim, teria revertido a 043 em
    -- SILENCIO: `CREATE OR REPLACE VIEW` exige a definicao inteira, o SQL
    -- continuaria valido, nenhuma suite do 008 reclamaria, e toda receita
    -- prevista AVULSA voltaria a ser contada como conta a pagar.
    --
    -- `s.direction` (043/HMO-256) resolve a precedencia ocorrencia -> regra ->
    -- 'expense' UMA vez, na 027. O criterio antigo era o `transaction_type` da
    -- REGRA, e previsao avulsa nao tem regra -- por isso ela caia toda em
    -- `planned_expense`.
    SELECT
      SUM(s.amount) FILTER (WHERE s.direction = 'expense') AS planned_expense,
      SUM(s.amount) FILTER (WHERE s.direction = 'income')  AS planned_income,
      -- Contagem de linha EM ABERTO, e nao de divida: receita prevista entra
      -- nos dois contadores, igual a antes da 043.
      COUNT(*) FILTER (WHERE s.status = 'pending') AS pending_count,
      COUNT(*) FILTER (WHERE s.status = 'pending' AND s.due_date < CURRENT_DATE) AS overdue_count
    FROM public.scheduled_transactions_effective s
    WHERE s.user_id = k.user_id
      AND s.group_id IS NOT DISTINCT FROM k.group_id
      AND date_trunc('month', s.due_date)::date = k.month
      AND s.currency IS NOT DISTINCT FROM k.currency
      -- cancelada nunca foi previsao de verdade
      AND s.status <> 'cancelled'
  ) AS p ON TRUE
  -- O REALIZADO, EM DUAS FONTES MUTUAMENTE EXCLUSIVAS (045).
  --
  -- As duas pernas do UNION ALL sao guardadas por `k.group_id IS NULL` e
  -- `k.group_id IS NOT NULL`, entao no maximo UMA produz linha para cada chave.
  -- Isso importa: se as duas pudessem casar, o LATERAL devolveria duas linhas,
  -- a chave viraria duas linhas da view e o relatorio contaria o previsto
  -- DUAS VEZES -- um numero dobrado, plausivel, sem erro nenhum.
  --
  -- E por isso que o `k.group_id IS NULL` esta DENTRO de cada perna e nao num
  -- CASE por fora: a exclusao mutua tem de ser uma propriedade do WHERE, nao
  -- uma leitura atenta de quem vier depois.
  LEFT JOIN LATERAL (
    -- PESSOAL: `personal_monthly_cash_flow` (033) ja soma a minha parte de
    -- grupo junto com o que e so meu. Ela nao tem `group_id` -- nem poderia: no
    -- relatorio pessoal a Casa e a Viagem somam na mesma linha.
    SELECT pf.income, pf.expense
      FROM public.personal_monthly_cash_flow pf
     WHERE k.group_id IS NULL
       AND pf.user_id = k.user_id
       AND pf.month = k.month
       AND pf.currency IS NOT DISTINCT FROM k.currency
    UNION ALL
    -- GRUPO: inalterado desde o 008. Aqui o numero certo e o valor CHEIO da
    -- despesa, de todos os membros.
    SELECT f.income, f.expense
      FROM public.monthly_cash_flow f
     WHERE k.group_id IS NOT NULL
       AND f.user_id = k.user_id
       AND f.group_id IS NOT DISTINCT FROM k.group_id
       AND f.month = k.month
       AND f.currency IS NOT DISTINCT FROM k.currency
  ) AS a ON TRUE;

COMMENT ON VIEW public.planned_vs_actual IS
  'Previsto (agenda do 005) contra realizado por mes e MOEDA. A direcao do PREVISTO sai de scheduled_transactions_effective.direction (043): previsao AVULSA de receita entrava em planned_expense porque o criterio era o transaction_type da REGRA, e avulsa nao tem regra. Chaves por UNION de tres origens: agenda, transacoes e a minha parte de grupo (045). O realizado PESSOAL sai de personal_monthly_cash_flow (033, inclui a minha parte de grupo); o do GRUPO sai de monthly_cash_flow (valor cheio). As duas pernas do realizado sao mutuamente exclusivas por group_id. O LATERAL casa a moeda tambem: sem isso um mes com duas moedas duplicaria a linha e repetiria o previsto inteiro em cada uma.';

-- ---------------------------------------------------------------------------
-- 2. security_invoker e GRANTs
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` APAGA AS reloptions DA VIEW, e `security_invoker` e
-- uma reloption. Quem so troca a definicao e nao reaplica o ALTER deixa a view
-- rodando como o DONO -- e esta view agora atravessa `group_share_entries`, que
-- chega em quatro tabelas de grupo. O sintoma seria cada pessoa vendo a
-- variancia mensal de todas as outras, sem erro nenhum no caminho.
--
-- E a razao de o teste medir isso como um usuario SEM grupo (controle negativo)
-- em vez de so conferir a reloption: a reloption certa com a RLS furada uma
-- camada abaixo tambem passaria.
ALTER VIEW public.planned_vs_actual SET (security_invoker = true);

-- Os mesmos GRANTs do 008, reafirmados porque o REPLACE pode vir de um banco
-- onde eles nunca foram dados.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.planned_vs_actual FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON public.planned_vs_actual TO authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Sonda: a view ficou com security_invoker?
-- ---------------------------------------------------------------------------
-- NOTICE e nao EXCEPTION, no mesmo tom da sonda da 042: o teste do 045 e quem
-- reprova isso de verdade, medindo pela RLS. Esta linha existe para quem aplica
-- a migration a mao no SQL Editor e nao roda o teste.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.planned_vs_actual'::regclass
       AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE NOTICE '045: planned_vs_actual ficou SEM security_invoker -- ela esta furando a RLS';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 46. 046_um_criterio_de_custo_pessoal.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- ===========================================================================
-- 046 -- UM CRITERIO SO PARA O CUSTO PESSOAL (HMO-258)
-- ===========================================================================
-- A HMO-258 mediu cinco leituras do mesmo mes dando quatro respostas para
-- "quanto a A gastou em maio?". A 045 tirou uma resposta errada de circulacao
-- (o 900 da `planned_vs_actual`, que apagava despesa de grupo inteira). Sobrou
-- a pergunta de produto que a issue dizia vir ANTES do codigo:
--
--   "quando eu pago 90 por tres pessoas, a minha despesa do mes e 90 ou 30?"
--
-- ELA FOI RESPONDIDA. Em 08/10/2026, na interaction da issue, com quatro
-- opcoes medidas na mesa: **1.010,00 -- igual a Financas Pessoais (bruto +
-- reembolso)**. Ou seja, o criterio que a HMO-275 ja aprovou para uma tela
-- passa a valer para o painel e para os relatorios:
--
--   INTEIRO quando EU paguei          (o jantar de 90 conta 90)
--   MINHA PARTE quando OUTRO pagou    (o mercado de 60 da B conta 20)
--
-- A fixture de maio da conta A da HMO-255 -- mercado 500 e combustivel 400 so
-- dela, jantar de 90 pago por ela e dividido por 3, mercado de 60 pago pela B e
-- dividido por 3 --, medida por `scripts/medidor-hmo258.sql`:
--
--                                                     antes (045)   depois (046)
--   /dashboard/despesas (fluxo de caixa) .........      990,00        990,00
--   painel + reports/cash-flow + categories ......      950,00      1.010,00  <--
--   reports/planned-vs-actual ....................      950,00      1.010,00  <--
--   reports/net-worth (|net_change|) .............      990,00        990,00
--   /dashboard/personal-finance (HMO-275) ........    1.010,00      1.010,00
--
-- Cinco leituras, DUAS respostas -- e as duas sao pontas decididas, cada uma
-- com rotulo na tela: 990 e "o que saiu da minha conta" (o cabecalho de
-- `app/api/movimentacoes/resumo/route.ts` explica por que a fracao do que outro
-- pagou fica de fora ali, e a legenda da tela de Despesas diz isso em uma
-- linha); 1.010 e "o que me custou". O 950 era uma TERCEIRA convencao, sem
-- rotulo em tela nenhuma, e e ela que sai daqui.
--
-- POR QUE O PATRIMONIO (990) NAO ENTRA NA UNIFICACAO
-- -------------------------------------------------
-- `net_worth_history` nao e uma leitura de custo, e uma leitura de SALDO: o
-- `net_change` do mes tem de fechar com o que entrou e saiu das contas, senao o
-- patrimonio deixa de bater com o extrato. A minha parte de uma despesa que
-- outro pagou nao tirou dinheiro da minha conta -- enquanto eu nao transferir,
-- ela e uma DIVIDA, nao uma saida. Contar os 20 ali faria o patrimonio cair
-- duas vezes pelo mesmo evento: agora, e de novo quando eu pagasse a B.
--
-- Isto nao e uma excecao ao "um criterio so": e o reconhecimento de que ha duas
-- perguntas diferentes, e a issue previu isso ("as duas respostas sao legitimas
-- -- fluxo de caixa x custo pessoal"). A unificacao pedida e dentro de CADA
-- pergunta; o que nao podia continuar era ter tres respostas para a MESMA.
--
-- ===========================================================================
-- O QUE MUDA, EXATAMENTE -- DUAS LINHAS, E ELAS SO FUNCIONAM JUNTAS
-- ===========================================================================
-- Na `personal_category_monthly_totals` (033):
--
--   1. A perna PESSOAL perde o `WHERE c.group_id IS NULL`. Com ele, a despesa
--      de grupo que EU paguei nunca chegava inteira -- `category_monthly_totals`
--      tem `group_id` no grao, entao o jantar de 90 vivia numa linha de
--      `group_id` nao-nulo e era descartado.
--
--   2. A perna do GRUPO ganha `WHERE NOT g.paguei_eu`. Sem ela, a parte de 30
--      que e minha no jantar viria SOMADA aos 90 da perna 1: 120 de uma despesa
--      de 90. Dupla contagem.
--
-- PARA A PERNA 2 PODER FILTRAR, `group_share_category_monthly_totals` GANHA
-- `paguei_eu` NO GRAO (coluna apendada no fim, que e o que
-- `CREATE OR REPLACE VIEW` permite). A alternativa era a perna 2 ler
-- `group_share_entries` direto com um GROUP BY proprio -- e isso criaria uma
-- SEGUNDA definicao do rollup, que e exatamente o que o cabecalho da 033
-- argumenta contra. `group_share_entries` continua sendo a unica definicao de
-- "minha parte", e `paguei_eu` ja era coluna dela desde a 033.
--
-- ATENCAO AO MUTANTE 2 DE `scripts/mutantes-minha-parte-no-realizado.mjs`
-- ---------------------------------------------------------------------
-- Ele tira exatamente o filtro do item 1 e se chama "o conserto ERRADO ...
-- valor cheio + parte, dupla contagem". Ele continua CERTO e continua medindo:
-- aquele runner monta a cadeia 001 -> 032 e aplica a 033 mutada, SEM a 046, e
-- na 033 sozinha tirar o filtro de fato produz os 120. O que a 046 faz nao e
-- "aplicar o mutante 2": e aplicar o item 1 **junto com** o item 2. Um sem o
-- outro e o defeito que aquele mutante descreve -- e e por isso que o teste
-- desta migration tem um controle negativo para cada metade separada.
--
-- O EFEITO QUE NAO DEPENDE DE CRITERIO NENHUM: RATEIO RECUSADO
-- -----------------------------------------------------------
-- Medido nos dois estados, com o jantar de 90 da A e TODOS os rateios dele
-- `rejected`:
--
--   antes (045)   painel da A = 920,00
--   depois (046)  painel da A = 1.010,00
--
-- Os 920 sao 500 + 400 + 20. Os 90 que sairam da conta DELA desaparecem do
-- painel DELA. `group_share_entries` exclui rateio `rejected`/`expired` (certo,
-- e deliberado na 033), e o filtro do item 1 ja tinha jogado a despesa fora do
-- lado pessoal -- entao ninguem conta.
--
-- Isso nao e uma terceira convencao perdendo para uma quarta: dinheiro que eu
-- gastei e que ninguem vai me devolver e minha despesa sob QUALQUER um dos tres
-- criterios que a issue colocou na mesa. Era defeito, do mesmo tipo do 900 que
-- a 045 consertou, e estava escondido atras de uma pergunta de produto.
--
-- A PROPRIEDADE QUE E PRECISO SABER: A SOMA ENTRE PESSOAS PASSA DO GASTO REAL
-- --------------------------------------------------------------------------
-- No mes da fixture, somando o painel dos tres membros: 1.010 (A) + 90 (B) +
-- 50 (C) = 1.150, contra 1.050 de dinheiro que realmente saiu de contas.
--
-- Os 100 de diferenca sao as partes que A e B ainda vao receber de volta. Isto
-- NAO e um erro de aritmetica: e o que "bruto + reembolso" quer dizer, e a
-- propria opcao escolhida avisava ("conta como meu gasto dinheiro que vai
-- voltar" era o custo listado da opcao de fluxo de caixa, e vale aqui com sinal
-- trocado). `personal_monthly_cash_flow` e uma leitura POR PESSOA do que o mes
-- custou a ela; ela nunca foi, e nao passa a ser, um livro-caixa do grupo.
-- Quem quer o total do grupo le `monthly_cash_flow` com `group_id`, que esta
-- intacta.
--
-- ===========================================================================
-- QUEM LE PRECISA FILTRAR user_id -- E ISSO FICOU MAIS AFIADO AQUI
-- ===========================================================================
-- A policy de SELECT de `financial_transactions` (002) e
-- `user_id = auth.uid() OR (group_id IS NOT NULL AND is_group_member(group_id))`.
-- Com o `group_id IS NULL` da perna 1 no lugar, as linhas dos OUTROS membros
-- eram descartadas de graca -- uma despesa pessoal de outra pessoa nunca e
-- visivel para mim. Sem o filtro, `category_monthly_totals` devolve tambem as
-- despesas de grupo DELES, cada uma na linha do `user_id` de quem pagou.
--
-- Isso nao vaza nada que a RLS ja nao permitisse (quem divide grupo comigo pode
-- ler aquelas linhas desde a 002, e e assim que a tela do grupo funciona), e nao
-- entra no MEU total enquanto o leitor filtrar `user_id`. Os tres leitores
-- filtram, e o codigo diz que isso e load-bearing:
--
--   app/api/reports/cash-flow/route.ts   (`eq("user_id")`, comentado na linha 438)
--   app/api/reports/categories/route.ts  (`eq("user_id")`, comentado na linha 284)
--   public.planned_vs_actual             (`pf.user_id = k.user_id` no LATERAL, 045)
--
-- A perna 2 ja tinha essa propriedade desde a 033 ("Nao tem filtro por user_id:
-- quem le PRECISA filtrar"), entao o que muda e o alcance do aviso, nao a
-- natureza dele. O teste tem um controle negativo que le a view SEM filtrar
-- user_id e mostra o total do outro membro aparecendo -- para que a proxima
-- pessoa que escrever um leitor novo veja o sintoma antes de causa-lo.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION NAO TOCA
-- ===========================================================================
-- `monthly_cash_flow` e `category_monthly_totals` -- as views com `group_id` no
-- grao, que a tela DO GRUPO le e onde o numero certo e o valor cheio de todos
-- os membros. A 033 defendeu essa fronteira e a 045 a reafirmou; a 046 nao a
-- atravessa. `net_worth_history` tampouco, pela razao da secao de cima.
--
-- `personal_monthly_cash_flow` nao e redefinida: ela e `SUM` da
-- `personal_category_monthly_totals` e acompanha sozinha. Nao sendo tocada por
-- `CREATE OR REPLACE`, ela tambem nao perde `security_invoker` -- so as duas
-- views realmente substituidas aqui precisam do `ALTER` de volta.
--
-- `budget_consumption` CONTINUA FORA, e agora a divida tem numero: ela le
-- `monthly_cash_flow` e portanto ignora despesa de grupo no consumo de
-- orcamento. A 033 ja a citou, a 045 repetiu e esta repete -- com a decisao
-- tomada, ela virou trabalho mecanico em vez de pergunta aberta, e cabe numa
-- issue propria em vez de pegar carona numa migration que ja mexe em duas
-- views.
--
-- ===========================================================================
-- COMO RODAR
-- ===========================================================================
--   psql "$URL" -v ON_ERROR_STOP=1 -f database/migrations/046_um_criterio_de_custo_pessoal.sql
--
-- Aplicar depois de 001 -> ... -> 045. O preflight aborta listando o que falta.
-- Re-executavel: so tem CREATE OR REPLACE VIEW, COMMENT, GRANT e ALTER VIEW.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Preflight
-- ---------------------------------------------------------------------------
-- As duas views substituidas vem da 033, e a coluna `paguei_eu` que a perna 2
-- passa a filtrar tambem. Sem o preflight o erro seria "column does not exist",
-- que diz o objeto e nao a migration -- e "qual migration falta" e a pergunta
-- que a pessoa tem na mao na hora.
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(msg, E'\n') INTO v_faltando FROM (
    SELECT '  - view public.group_share_entries (vem do 033)' AS msg
    WHERE to_regclass('public.group_share_entries') IS NULL
    UNION ALL
    SELECT '  - view public.group_share_category_monthly_totals (vem do 033)'
    WHERE to_regclass('public.group_share_category_monthly_totals') IS NULL
    UNION ALL
    SELECT '  - view public.personal_category_monthly_totals (vem do 033)'
    WHERE to_regclass('public.personal_category_monthly_totals') IS NULL
    UNION ALL
    SELECT '  - view public.category_monthly_totals (vem do 008)'
    WHERE to_regclass('public.category_monthly_totals') IS NULL
    UNION ALL
    -- O criterio inteiro depende deste booleano: ele e o unico campo que separa
    -- "eu paguei" de "outro pagou".
    SELECT '  - coluna paguei_eu em public.group_share_entries (vem do 033)'
    WHERE to_regclass('public.group_share_entries') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'group_share_entries'
           AND column_name = 'paguei_eu'
      )
    UNION ALL
    -- A 022 poe `currency` no grao destas views. Sem ela as duas pernas do
    -- UNION ALL somariam reais com dolares.
    SELECT '  - coluna currency no grao de public.personal_category_monthly_totals (vem do 022/033)'
    WHERE to_regclass('public.personal_category_monthly_totals') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'personal_category_monthly_totals'
           AND column_name = 'currency'
      )
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'046 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> ... -> 045 antes.', v_faltando;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. group_share_category_monthly_totals -- `paguei_eu` entra no grao
-- ---------------------------------------------------------------------------
-- A coluna vai no FIM da lista, e nao perto de `user_id` onde ela se leria
-- melhor: `CREATE OR REPLACE VIEW` so aceita APENDAR coluna. Inserir no meio
-- exigiria DROP, e um DROP aqui derrubaria em cascata
-- `personal_category_monthly_totals` -- que e justamente a view que a proxima
-- secao precisa ter de pe para substituir.
--
-- O GRAO FICA MAIS FINO: um mes em que eu paguei uma despesa da Casa e devo
-- parte de outra, as duas na mesma categoria, passa de uma linha para DUAS.
-- Isso e seguro porque esta view tem um unico leitor no repositorio
-- (`personal_category_monthly_totals`, logo abaixo, que soma) -- conferido com
-- grep em `.ts`, `.tsx` e `.sql`. Quem agregava continua agregando; o que antes
-- era impossivel e agora da, e distinguir as duas origens.
--
-- `income` continua 0 por construcao: `group_share_entries` filtra
-- `transaction_type = 'expense'`. A coluna existe para o UNION ALL da secao 2
-- nao precisar inventar colunas, e o comentario da 033 ja dizia isso.
CREATE OR REPLACE VIEW public.group_share_category_monthly_totals AS
  SELECT
    e.user_id,
    e.group_id,
    e.month,
    e.category_id,
    SUM(e.amount)::numeric(15,2)        AS expense,
    0::numeric(15,2)                    AS income,
    COUNT(*)                            AS transaction_count,
    e.currency,
    -- A 046 acrescenta esta coluna. TRUE = a despesa e minha e o valor cheio
    -- dela ja esta no lado pessoal; quem soma custo pessoal tem de descartar
    -- estas linhas, ou conta a mesma despesa duas vezes.
    e.paguei_eu
  FROM public.group_share_entries e
  GROUP BY e.user_id, e.group_id, e.month, e.category_id, e.currency, e.paguei_eu;

COMMENT ON VIEW public.group_share_category_monthly_totals IS
  'Rollup mensal de group_share_entries, no formato de category_monthly_totals. Despesa POSITIVA, income sempre 0. Sem coluna net de proposito: quem agrega recalcula de income - expense. Uma linha por (usuario, grupo, mes, categoria, moeda, paguei_eu) -- o paguei_eu entrou no grao na 046, porque quem soma CUSTO PESSOAL conta o valor cheio do que eu paguei pelo lado pessoal e so pode somar daqui a parte do que OUTRO pagou.';

-- ---------------------------------------------------------------------------
-- 2. personal_category_monthly_totals -- o criterio escolhido
-- ---------------------------------------------------------------------------
-- As duas mudancas da 046 estao nas duas pernas do UNION ALL, e cada uma sem a
-- outra e um defeito conhecido:
--
--   perna 1 sem perna 2  ->  valor cheio + minha parte = 120 de um jantar de 90
--   perna 2 sem perna 1  ->  o 950 de antes (minha parte dos dois lados)
--
-- O teste da 046 tem um controle negativo para cada uma, separadamente.
--
-- `transaction_count` continua certo sem precisar de ajuste, e vale dizer por
-- que: uma despesa de grupo que eu paguei era contada uma vez pela perna 2 (a
-- minha parte) e passa a ser contada uma vez pela perna 1 (a despesa). A
-- contagem nao muda -- o que muda e o VALOR. Isso importa porque a rota divide
-- o total pelos meses com movimento para dar a media, e a 033 registrou que uma
-- contagem zerada apagaria o mes do membro que nao pagou nada.
--
-- `net` segue RECALCULADO de `income - expense`, e nao somado das pernas, para
-- nao PODER discordar das outras duas colunas da propria linha.
CREATE OR REPLACE VIEW public.personal_category_monthly_totals AS
  WITH tudo AS (
    -- PERNA 1 -- TUDO O QUE EU LANCEI, inclusive o que e de grupo, pelo valor
    -- CHEIO. Sai de `category_monthly_totals` e nao de uma consulta nova a
    -- `financial_transactions` porque ali mora a unica definicao de como o
    -- sinal e tratado e de que `transfer` fica fora (inclusive da contagem) --
    -- reescrever isso aqui faria as duas pernas de uma transferencia e de um
    -- pagamento de fatura virarem receita e despesa de verdade.
    --
    -- O `WHERE c.group_id IS NULL` da 033 SAIU (046): era ele que apagava do
    -- meu custo a despesa de grupo que eu mesma paguei. Note que isto so esta
    -- correto porque a perna 2 descarta `paguei_eu`.
    SELECT
      c.user_id, c.month, c.category_id,
      c.expense, c.income, c.transaction_count, c.currency
    FROM public.category_monthly_totals c

    UNION ALL

    -- PERNA 2 -- O REEMBOLSO QUE EU DEVO: a minha parte do que OUTRO pagou.
    -- `NOT g.paguei_eu` entrou na 046. O que eu paguei ja veio inteiro pela
    -- perna 1; somar a minha parte dele aqui contaria a despesa duas vezes.
    SELECT
      g.user_id, g.month, g.category_id,
      g.expense, g.income, g.transaction_count, g.currency
    FROM public.group_share_category_monthly_totals g
    WHERE NOT g.paguei_eu
  )
  SELECT
    tudo.user_id,
    tudo.month,
    tudo.category_id,
    SUM(tudo.expense)::numeric(15,2) AS expense,
    SUM(tudo.income)::numeric(15,2)  AS income,
    (SUM(tudo.income) - SUM(tudo.expense))::numeric(15,2) AS net,
    SUM(tudo.transaction_count)      AS transaction_count,
    tudo.currency
  FROM tudo
  GROUP BY tudo.user_id, tudo.month, tudo.category_id, tudo.currency;

COMMENT ON VIEW public.personal_category_monthly_totals IS
  'CUSTO PESSOAL por categoria, mes e MOEDA: tudo o que EU lancei pelo valor cheio (inclusive despesa de grupo que eu paguei) mais A MINHA PARTE do que OUTRO pagou. Criterio escolhido na HMO-258 em 08/10/2026, o mesmo da HMO-275 em Financas Pessoais. Ignora transfer. NAO e fluxo de caixa: a parte do que outro pagou ainda nao saiu da minha conta -- para "o que saiu da conta" existe movimentacoes/resumo e net_worth_history. Quem le PRECISA filtrar user_id: sem isso a RLS de grupo devolve tambem as despesas de grupo dos OUTROS membros, cada uma no user_id de quem pagou.';

-- ---------------------------------------------------------------------------
-- 3. security_invoker e GRANTs
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` APAGA AS reloptions DA VIEW, e `security_invoker` e
-- uma reloption. Sem o ALTER de volta, as duas views acima voltam a ser
-- DEFINER, e as duas precisam dele uma a uma: `security_invoker` nao e herdado.
--
-- MAS O SINTOMA NAO E O QUE AS MIGRATIONS IRMAS DESCREVEM, E ISSO FOI MEDIDO.
--
-- A 033 e a 045 dizem, com razao no caso delas, que perder o `security_invoker`
-- faria "cada pessoa ver o dado de todas as outras". Aqui nao faz. Medido num
-- banco com a cadeia inteira, com um usuario que nao divide grupo com ninguem:
--
--   so personal_category_monthly_totals como DEFINER ......... 0 linhas do outro
--   ela E category_monthly_totals (008) como DEFINER .......... 1 linha do outro
--
-- A razao e que nenhuma das duas views desta migration toca uma tabela com RLS:
-- as duas leem outras VIEWS (`category_monthly_totals` do 008 e
-- `group_share_entries` da 033), e e nessas que `financial_transactions`
-- aparece. Uma view DEFINER troca o dono para a checagem das relacoes que ELA
-- referencia; quando a de baixo e INVOKER, a RLS la embaixo volta a ser avaliada
-- com o usuario da sessao. Quem protege a linha, aqui, e o `security_invoker`
-- das views de BAIXO.
--
-- Entao por que reaplicar o ALTER? Por duas razoes que nao sao "o vazamento de
-- hoje": manter a cadeia inteira uniforme (uma unica view DEFINER no meio e uma
-- armadilha para quem, amanha, fizer uma destas ler
-- `financial_transactions` direto -- e ai o vazamento passa a existir), e nao
-- deixar o schema divergir do que a 033 estabeleceu para as mesmas quatro views.
--
-- Isso tem uma consequencia no TESTE, e ela esta escrita la: o controle negativo
-- da RLS NAO pega esta reloption. Quem pega e a assercao direta sobre
-- `reloptions`. As duas existem e medem coisas diferentes.
ALTER VIEW public.group_share_category_monthly_totals SET (security_invoker = true);
ALTER VIEW public.personal_category_monthly_totals    SET (security_invoker = true);

-- Os mesmos GRANTs da 033, reafirmados porque o REPLACE pode vir de um banco
-- onde eles nunca foram dados.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.group_share_category_monthly_totals FROM anon';
    EXECUTE 'REVOKE ALL ON public.personal_category_monthly_totals FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON public.group_share_category_monthly_totals TO authenticated';
    EXECUTE 'GRANT SELECT ON public.personal_category_monthly_totals TO authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Sonda: as duas views ficaram com security_invoker?
-- ---------------------------------------------------------------------------
-- NOTICE e nao EXCEPTION, no mesmo tom da 042 e da 045: quem reprova isso de
-- verdade e o teste desta migration (que mede PELA RLS, com dois usuarios) e o
-- `view_security_invoker_test.sql`, que roda depois de todas as migrations.
-- Esta linha existe para quem aplica a mao no SQL Editor e nao roda teste.
DO $$
DECLARE
  v_sem TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_sem
    FROM pg_class c
   WHERE c.oid IN ('public.group_share_category_monthly_totals'::regclass,
                   'public.personal_category_monthly_totals'::regclass)
     AND NOT COALESCE(c.reloptions @> ARRAY['security_invoker=true'], FALSE);

  IF v_sem IS NOT NULL THEN
    RAISE NOTICE '046: ficou SEM security_invoker (furando a RLS): %', v_sem;
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 47. 047_aviso_por_email.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 047_aviso_por_email.sql
--
-- HMO-183: o canal de e-mail do aviso de vencimento (Fase 5, HMO-140).
--
-- A deteccao de vencimento ja funciona em producao desde o 009: `bill_alerts`
-- diz o que vence e `bill_notifications` guarda o que ja foi avisado. O push
-- ja esta escrito. O que falta e o e-mail, e esta migration abre as tres
-- lacunas de schema que ele precisa:
--
--   1. `notification_preferences.notify_email`  -- quem quer receber;
--   2. `bill_alerts.notify_email`               -- a mesma resposta, exposta
--      na UNICA definicao que o cron e o sino do app leem;
--   3. `bill_notifications.emailed_at` / `.email_message_id` -- a PROVA de que
--      saiu, com o id da mensagem no provedor.
--
-- ===========================================================================
-- POR QUE O DEFAULT DE notify_email E `true`
-- ===========================================================================
-- Nao e a escolha obvia: coluna nova ligada por padrao inscreve todo mundo num
-- canal que ninguem pediu, no instante em que a chave do provedor for colada.
-- Foi escolhida assim mesmo assim, por tres razoes, e a terceira e a que pesa:
--
--   a) a view ja trata ausencia de linha como "sim" em TODAS as preferencias
--      (`COALESCE(p.notify_due_soon, true)`, `COALESCE(p.days_before, 3)`).
--      Hoje ninguem tem linha em `notification_preferences` -- um default
--      `false` aqui seria a unica preferencia que significa "nao" quando
--      ausente, e a view passaria a ter duas convencoes opostas lado a lado;
--
--   b) o aviso e transacional e foi o motivo de a pessoa instalar o app: e uma
--      conta DELA vencendo, nao uma campanha;
--
--   c) um canal que nasce desligado e um canal que ninguem liga. Esse e o
--      defeito que esta issue existe para consertar: o push ficou meses
--      desligado em producao sem aparecer em lugar nenhum. Repetir o desenho
--      no e-mail seria entregar o mesmo silencio com um nome novo.
--
-- O contrapeso esta no app, nao no schema: a tela de Avisos tem o botao de
-- desligar, e o rodape do e-mail diz onde ele fica.
--
-- ===========================================================================
-- POR QUE `channel` NAO GANHA O VALOR 'email'
-- ===========================================================================
-- `bill_notifications.channel` e uma coluna de valor UNICO com CHECK IN
-- ('inapp','push'), e o cron a promove de 'inapp' para 'push' quando o push
-- sai. Com tres canais ela deixa de conseguir representar o caso normal --
-- sino E push E e-mail, os tres no mesmo aviso. Acrescentar 'email' ao CHECK
-- tornaria a coluna MAIS ambigua: 'push' passaria a significar "push, e sobre
-- o e-mail nao se sabe".
--
-- Entao o e-mail ganha colunas proprias. `emailed_at` responde "saiu?" e
-- `email_message_id` responde "qual mensagem?" -- e e o segundo que importa,
-- porque e com ele que se confere a entrega no painel do provedor. Resposta
-- 200 da rota nao prova entrega nenhuma.
--
-- `channel` fica como esta, intocada, e o COMMENT abaixo registra que ela nao
-- fala sobre e-mail -- para que o proximo leitor nao conclua de um
-- `channel='push'` que o e-mail nao saiu.
--
-- ===========================================================================
-- IDEMPOTENTE, E SEM META-COMANDO
-- ===========================================================================
-- Producao nao tem runner de migration: uma pessoa cola este arquivo no SQL
-- Editor do Supabase (ver a nota no topo do 015). Rodar duas vezes tem que ser
-- inofensivo, e nenhuma linha pode ser meta-comando do psql (`\...`) -- uma
-- unica delas reprova o arquivo INTEIRO.
--
-- Todo ADD COLUMN aqui e `IF NOT EXISTS` e NULAVEL ou com DEFAULT, entao
-- nenhuma escrita que o app ja faz passa a falhar no meio da colagem.

-- =====================================================
-- SECAO 1: A PREFERENCIA
-- =====================================================

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.notify_email IS
  'Receber o aviso de vencimento por e-mail. Linha ausente = true, pelo mesmo '
  'COALESCE que ja vale para days_before e notify_due_soon em bill_alerts.';

-- =====================================================
-- SECAO 2: A PROVA DE ENVIO
-- =====================================================

ALTER TABLE public.bill_notifications
  ADD COLUMN IF NOT EXISTS emailed_at timestamp with time zone;

ALTER TABLE public.bill_notifications
  ADD COLUMN IF NOT EXISTS email_message_id text;

COMMENT ON COLUMN public.bill_notifications.emailed_at IS
  'Quando o e-mail foi aceito pelo provedor. NULL = nao saiu (canal desligado, '
  'usuario sem endereco, ou falha).';

COMMENT ON COLUMN public.bill_notifications.email_message_id IS
  'O id da mensagem no provedor. E ele que permite conferir a entrega no painel '
  '-- 200 na resposta da rota nao prova entrega.';

COMMENT ON COLUMN public.bill_notifications.channel IS
  'Sino do app ou push. NAO fala sobre e-mail: um aviso com channel=''push'' '
  'pode ter saido tambem por e-mail -- quem responde isso e emailed_at.';

-- O e-mail so pode ser marcado com o id da mensagem junto, e vice-versa. Uma
-- `emailed_at` sem id e um envio que nao da para conferir; um id sem data e um
-- registro sem quando. Nos dois casos a linha diz "saiu" sem sustentar.
ALTER TABLE public.bill_notifications
  DROP CONSTRAINT IF EXISTS bill_notifications_email_completo_check;
ALTER TABLE public.bill_notifications
  ADD CONSTRAINT bill_notifications_email_completo_check
  CHECK ((emailed_at IS NULL) = (email_message_id IS NULL));

-- As linhas que ja existem em producao tem as duas colunas NULAS, entao o
-- CHECK acima e satisfeito por todas elas e o ALTER nao precisa de NOT VALID.

-- =====================================================
-- SECAO 3: A VIEW
-- =====================================================
-- `bill_alerts` e a unica definicao de "o que merece aviso hoje", lida pelo
-- cron e pelo sino do app. A preferencia de e-mail entra AQUI, e nao numa
-- consulta separada dentro da rota, pelo motivo que o 009 ja escreveu: duas
-- consultas saem de sincronia na primeira vez que alguem mexe numa delas.
--
-- O corpo abaixo e o do 009 com UMA linha nova (`notify_email`). Esta repetido
-- inteiro porque o Postgres nao tem "adicionar coluna a view": CREATE OR
-- REPLACE VIEW exige as colunas antigas, na mesma ordem e com os mesmos tipos,
-- e so aceita colunas NOVAS no fim.

CREATE OR REPLACE VIEW public.bill_alerts AS
  SELECT
    s.id AS scheduled_transaction_id,
    s.user_id,
    s.group_id,
    s.account_id,
    s.description,
    s.amount,
    s.due_date,
    (s.due_date - CURRENT_DATE) AS days_until,
    CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END AS kind,
    COALESCE(p.days_before, 3) AS days_before,
    COALESCE(r.transaction_type, 'expense') AS transaction_type,
    EXISTS (
      SELECT 1 FROM public.bill_notifications n
      WHERE n.scheduled_transaction_id = s.id
        AND n.kind = (CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END)
        AND n.reference_date = s.due_date
    ) AS already_notified,
    -- A coluna nova. Mesmo COALESCE das outras preferencias: quem nunca abriu
    -- a tela nao tem linha, e ausencia significa "sim" -- ver o cabecalho.
    COALESCE(p.notify_email, true) AS notify_email
  FROM public.scheduled_transactions s
  LEFT JOIN public.notification_preferences p ON p.user_id = s.user_id
  LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id
  WHERE s.status = 'pending'
    AND (
      (s.due_date < CURRENT_DATE AND COALESCE(p.notify_overdue, true))
      OR (s.due_date >= CURRENT_DATE
          AND COALESCE(p.notify_due_soon, true)
          AND s.due_date - CURRENT_DATE <= COALESCE(p.days_before, 3))
    );

-- `notify_email` NAO entra no WHERE de proposito. A view responde "o que
-- merece aviso hoje", e o sino do app mostra a mesma lista: filtrar por e-mail
-- aqui apagaria do SINO a conta de quem desligou so o e-mail. A preferencia e
-- de CANAL, e quem a consome e a rota do cron, na hora de escolher para quem
-- mandar -- depois de gravar o aviso para todo mundo.

-- ===========================================================================
-- CREATE OR REPLACE VIEW APAGA OS reloptions -- MEDIDO, NAO SUPOSTO
-- ===========================================================================
-- `security_invoker` e um reloption, e ele NAO sobrevive ao CREATE OR REPLACE
-- acima. Sem a linha abaixo a view volta a rodar com os privilegios do DONO, a
-- RLS de `scheduled_transactions` deixa de ser aplicada, e o sino do app de
-- cada usuario passa a listar as contas a vencer de TODO MUNDO -- sem erro,
-- sem aviso, e com os numeros parecendo plausiveis.
--
-- Esta linha e identica a do 009 e e obrigatoria em toda migration que recria
-- esta view.
ALTER VIEW public.bill_alerts SET (security_invoker = true);

COMMENT ON VIEW public.bill_alerts IS
  'Contas que merecem aviso hoje, com already_notified e a preferencia de canal '
  'notify_email. Uma definicao para o cron e para o sino do app.';

-- `bill_alerts` e recriada pelo CREATE OR REPLACE, o que PRESERVA os GRANTs
-- existentes (ao contrario dos reloptions). O 009 ja deu SELECT a
-- `authenticated`; nada a refazer aqui.


-- ---------------------------------------------------------------------------
-- 48. 048_trava_de_tipo_do_lancamento.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- 048_trava_de_tipo_do_lancamento.sql
--
-- HMO-232: "Travar transaction_type no banco (NOT NULL), depois que o conserto
-- da HMO-181 estiver em producao."
--
-- ===========================================================================
-- ESTA E A SEGUNDA METADE DA 037, E A DEMORA FOI DE PROPOSITO
-- ===========================================================================
-- A 037 preencheu `financial_transactions.transaction_type` onde ele era nulo e
-- NAO pos trava nenhuma na coluna -- escrito no cabecalho dela, com o motivo:
-- migration aqui e colada a mao no SQL Editor ANTES de o codigo subir, e o
-- codigo que estava no ar naquele momento era justamente o que gravava NULL.
-- Um NOT NULL ali teria derrubado em 23502 todo lancamento feito pela tela
-- entre a colagem do SQL e o deploy.
--
-- Esse motivo venceu. O conserto das rotas (PR #139, `f8de98b`) esta na `main`
-- desde 2026-10-02, bem antes da 039, e deploy aqui leva CODIGO sem pedir
-- licenca -- o que fica para tras e schema, nunca o inverso. Entao o que esta
-- em producao hoje grava a coluna em todo caminho de escrita.
--
-- ATENCAO, PORQUE ESTA MIGRATION E A EXCECAO DA CASA: quase toda migration
-- deste repositorio e ADITIVA e por isso inofensiva de colar com a `main`
-- "velha" (coluna com default, view recriada -- o codigo em producao nem sabe
-- que existe). Esta nao. Ela e uma TRAVA, e trava colada antes do codigo
-- quebra o app no ar. Ela so pode ser colada porque o codigo JA chegou, e nao
-- apesar disso.
--
-- ===========================================================================
-- A AUDITORIA DOS ESCRITORES, REFEITA NA `main` DE 2026-10-08
-- ===========================================================================
-- A HMO-232 nasceu com uma tabela de nove escritores, levantada em 02/10. De
-- entao para ca a arvore andou da 039 para a 047 e apareceram TRES caminhos de
-- escrita novos, nenhum deles na lista original. A tabela abaixo e a nova, e
-- ela e o que autoriza a trava -- a de outubro/02 sozinha nao autorizava mais:
--
--   escritor                                            grava o tipo
--   --------------------------------------------------- -----------------------
--   POST   /api/personal-finance/transactions           sim  (`tipo`, HMO-181)
--   PATCH  /api/personal-finance/transactions/[id]      sim  (regrava SEMPRE)
--   POST   /api/movimentacoes/transferencia             sim  ('transfer', as 2)
--   POST   /api/scheduled-transactions/[id]/pay         sim  (as duas pernas)
--   POST   /api/statements/entries/[id]                 sim  (`tipoPeloSinal`)
--   POST   /api/financial-installments                  sim  ('expense')
--   POST   /api/expense-groups/[groupId]/transactions   sim  ('expense')
--   POST   /api/card-invoices/ajuste                    sim  <- NOVO (HMO-292)
--   POST   /api/expense-groups/[groupId]/settlements    sim  <- NOVO (HMO-245)
--   POST   .../settlements/[id]/perna                   sim  <- NOVO (HMO-306)
--   public.register_payroll (012)                       sim  ('income')
--   public.pay_installment (001)                        sim
--
-- As duas funcoes do banco foram conferidas no CATALOGO e nao no arquivo da
-- migration (`pg_proc.prosrc`, buscando `INSERT INTO ... financial_
-- transactions`): sao as duas UNICAS funcoes de `public` que inserem nesta
-- tabela, e as duas listam a coluna. O rateio de grupo nao aparece aqui porque
-- ele nao insere em `financial_transactions` -- ele escreve em
-- `group_transactions` / `expense_splits`.
--
-- O PATCH merece uma linha propria, porque e o unico que poderia gravar NULL
-- sem um INSERT novo. Ele nao pode: `updateData.transaction_type` sai de
-- `normalizarLancamento`, que ou devolve `ok: false` (e a rota responde 400) ou
-- devolve `tipo` vindo de `classificarMovimentacao`, cujo retorno e
-- `'income' | 'expense' | 'transfer'` -- nunca nulo, nem no caminho em que o
-- usuario troca a categoria e o tipo e re-derivado.
--
-- ===========================================================================
-- POR QUE NOT NULL, E NAO CHECK
-- ===========================================================================
-- A pergunta estava aberta no escopo da issue, e ela tem uma resposta so:
-- **CHECK aceita NULL**. `CHECK (transaction_type IN ('income','expense',
-- 'transfer'))` parece a trava e nao e nenhuma: para a linha sem tipo o
-- predicado vale NULL, que nao e FALSE, e o Postgres ACEITA a linha. Seria uma
-- trava que passa em toda revisao de codigo, aparece no `\d+` da tabela, e deixa
-- entrar exatamente a unica linha que ela existia para barrar.
--
-- O ENUM `transaction_financial_type` ja barra valor inventado desde o 001 --
-- 'expence' volta 22P02 --, entao nao sobra nada para um CHECK fazer aqui
-- alem do que o NOT NULL faz. A trava real mora no NOT NULL, e o SQLSTATE que
-- o teste desta migration exige e o dele: **23502**.
--
-- (Um `CHECK (transaction_type IS NOT NULL)` barraria o NULL de verdade, com
-- 23514. Ficaria certo e seria pior: `is_nullable` continuaria 'YES' no
-- catalogo, e todo mundo que olhasse a coluna -- `\d`, o Supabase Studio, o
-- gerador de tipos, `scripts/gen-schema-columns.mjs` -- continuaria lendo
-- "aceita nulo". Dois desses dois mutantes estao em
-- `scripts/mutantes-trava-de-tipo.mjs` justamente porque os dois sao
-- plausiveis e os dois sao errados.)
--
-- ===========================================================================
-- O QUE ESTA TRAVA NAO RESOLVE
-- ===========================================================================
-- O SEGUNDO estrago da HMO-181 continua de pe: despesa gravada com o sinal
-- POSITIVO. Nao ha CHECK nem NOT NULL possivel ali, porque uma linha positiva
-- em categoria de despesa e indistinguivel de um ESTORNO legitimo -- e o
-- estorno e um lancamento que o usuario tem direito de fazer. Quem guarda esse
-- lado sao os 13 mutantes de `npm run mutantes:tipo-e-sinal`, e eles continuam
-- sendo a unica guarda dele depois desta migration.
--
-- ===========================================================================
-- CONFERENCIA EM PRODUCAO, PARA RODAR ANTES DE COLAR
-- ===========================================================================
-- COM O DENOMINADOR JUNTO, e nao so o numerador. "Quantas linhas estao sem
-- tipo?" sozinha responde 0 tanto quando esta tudo certo quanto quando a sessao
-- nao enxerga a tabela -- `financial_transactions` tem RLS, e a credencial
-- `paperclip_ro` le ZERO LINHA dela. A conferencia passa VAZIA, parecendo a
-- resposta boa. Quem roda isto e o Helio, no SQL Editor:
--
--   SELECT count(*) AS total,
--          count(*) FILTER (WHERE transaction_type IS NULL) AS sem_tipo
--     FROM public.financial_transactions;
--
-- `sem_tipo` = 0 com `total` > 0 e o retrato esperado (a 037 ja rodou).
--
-- Se `sem_tipo` > 0, colar esta migration NAO estoura: o passo 1 abaixo chama o
-- backfill da 037 de novo e a trava do passo 2 encontra a coluna cheia. Mas o
-- NUMERO precisa chegar de volta na issue, porque com toda rota gravando a
-- coluna um `sem_tipo` > 0 so pode ser (a) linha anterior ao PR #139 que a 037
-- nunca alcancou -- ou seja, a 037 nao foi colada --, ou (b) um escritor que a
-- auditoria acima nao achou. O (b) e o caso em que a trava vai comecar a
-- devolver 23502 para gente de verdade, e ai o conserto e no escritor.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. O backfill da 037, de novo, para a trava nao poder falhar na colagem
-- ---------------------------------------------------------------------------
-- Nao e desconfianca da 037: e que SET NOT NULL varre a tabela inteira e aborta
-- a migration se achar UMA linha nula, e o unico lugar do mundo onde isso pode
-- acontecer e o banco do Helio -- onde ninguem pode medir antes por causa da
-- RLS (ver a CONFERENCIA acima). A funcao e idempotente pelo
-- `WHERE transaction_type IS NULL` de dentro dela, entao no caso esperado este
-- passo e um no-op que custa um scan.
--
-- A funcao e a MESMA da 037 -- `public.backfill_tipo_do_lancamento()`, deixada
-- no banco por aquela migration como ferramenta de reparo, com os tres degraus
-- (perna de transferencia pelos DOIS lados do elo, depois
-- `transaction_categories.is_expense`, depois o sinal). Nao ha copia da regra
-- aqui, e por isso nao ha como as duas divergirem.
--
-- O NOTICE existe para a colagem A MAO: "rodou sem erro" e indistinguivel de
-- "nao tinha o que fazer", e aqui a diferenca entre os dois e justamente o
-- diagnostico que a issue pede.
DO $$
DECLARE
  v_linhas integer;
BEGIN
  v_linhas := public.backfill_tipo_do_lancamento();

  IF v_linhas = 0 THEN
    RAISE NOTICE '048: nenhuma linha sem transaction_type -- era o esperado, a trava vai entrar sobre a coluna ja limpa.';
  ELSE
    RAISE NOTICE '048: ATENCAO -- % linha(s) ainda estavam sem transaction_type e acabaram de ser preenchidas. A trava vai entrar, mas ESTE NUMERO PRECISA VOLTAR PARA A HMO-232: com todas as rotas gravando a coluna, ele significa que a 037 nao foi colada OU que existe um escritor fora da auditoria -- e nesse segundo caso a trava vai passar a devolver 23502 para o usuario.', v_linhas;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. A trava
-- ---------------------------------------------------------------------------
-- Re-executavel: SET NOT NULL numa coluna que ja e NOT NULL e um no-op no
-- Postgres (nao e erro, nao reescreve a tabela). E o que faz o passo "048 e
-- idempotente" do db-verify passar sem nenhum `IF NOT EXISTS` em volta.
ALTER TABLE public.financial_transactions
  ALTER COLUMN transaction_type SET NOT NULL;

COMMENT ON COLUMN public.financial_transactions.transaction_type IS
  'income | expense | transfer. NOT NULL desde a 048 (HMO-232), e a trava mora aqui e nao num CHECK porque CHECK aceita NULL. Antes dela a linha sem tipo ficava fora de monthly_cash_flow, category_monthly_totals e planned_vs_actual e continuava aparecendo na lista de lancamentos -- aparecia como lancamento e desaparecia do fluxo de caixa, dos relatorios e do orcamento (HMO-181). O sinal de `amount` NAO e derivado desta coluna pelo banco: despesa positiva continua sendo um valor aceito, porque e indistinguivel de estorno legitimo, e quem guarda esse lado sao os mutantes de npm run mutantes:tipo-e-sinal.';

COMMIT;

-- ===========================================================================
-- DEPOIS DE COLAR, EM PRODUCAO
-- ===========================================================================
--   SELECT is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'financial_transactions'
--      AND column_name  = 'transaction_type';
--
-- Tem de sair 'NO'. Esta consulta funciona pela credencial RO: ela le o
-- catalogo, nao a tabela, e catalogo nao tem RLS -- diferente da conferencia de
-- `sem_tipo` ali em cima, que precisa do Helio.


-- ---------------------------------------------------------------------------
-- 49. 049_consumo_de_orcamento_do_grupo.sql
-- ---------------------------------------------------------------------------
-- Cada migration traz o proprio BEGIN/COMMIT: se uma falhar, ela volta atras
-- inteira e as seguintes nem chegam a rodar.
-- ===========================================================================
-- 049 -- O CONSUMO DE ORCAMENTO CONTA A DESPESA DE GRUPO (HMO-347)
-- ===========================================================================
-- `budget_consumption` responde "quanto do meu orcamento eu ja gastei" e
-- IGNORAVA despesa de grupo inteira. Medido num banco com a cadeia 001 -> 048 e
-- a fixture de maio/2026 da conta A da HMO-255 (mercado 500 so dela,
-- combustivel 400 so dela, jantar de 90 pago por ela e dividido por 3, mercado
-- de 60 pago pela B e dividido por 3), com um teto PESSOAL de 700,00 na
-- categoria de mercado:
--
--                                         antes da 049   depois dela
--   spent ..............................     500,00       610,00
--   consumed_ratio .....................     0,7143       0,8714
--   consumption_status .................     ok           alert   <-- a barra
--
-- Os 90 que ela PAGOU e os 20 que ela DEVE do mercado da B nao entravam em
-- numero nenhum: a barra ficava verde num mes em que o teto ja estourou os 80%.
--
-- ESTE E O SEGUNDO DOS DOIS LEITORES QUE A 033 ANOTOU
-- --------------------------------------------------
-- A 033 escreveu, em "O QUE ESTA MIGRATION NAO TOCA": *"tambem alimenta
-- `planned_vs_actual` e o consumo de orcamento, que nao estao no pedido."* A
-- HMO-258 fechou o primeiro (045 aponta o lado pessoal da `planned_vs_actual`
-- para `personal_monthly_cash_flow`; 046 unificou o criterio). Este arquivo
-- fecha o segundo, e a frase da 033 deixa de ter divida pendente.
--
-- O CRITERIO E O MESMO, E ELE JA ESTAVA DECIDIDO
-- ---------------------------------------------
-- Em 08/10/2026, na interaction da HMO-258, o Helio escolheu **bruto +
-- reembolso**: INTEIRO quando EU paguei, MINHA PARTE quando OUTRO pagou. E o
-- criterio da HMO-275 em Financas Pessoais e, desde a 046, o do painel e dos
-- relatorios. Nenhuma decisao nova e tomada aqui.
--
-- Vale dizer por que a pergunta do orcamento NAO podia entrar na HMO-258 junto
-- com a variancia: "gastou mais do que previu" nao dependia da decisao de
-- produto -- ZERO esta errado sob qualquer criterio. "Quanto do meu orcamento
-- eu gastei" depende: ha leitura defensavel em que o orcamento e de CAIXA (so o
-- que saiu da conta, 590 aqui) em vez de CUSTO (610). A decisao de 08/10 e de
-- custo, e e ela que vale -- a leitura de caixa continua existindo, com rotulo
-- proprio, em `/api/movimentacoes/resumo` e em `net_worth_history`.
--
-- ===========================================================================
-- O QUE MUDA, EXATAMENTE -- DUAS LINHAS, E ELAS SO FUNCIONAM JUNTAS
-- ===========================================================================
-- O LATERAL de `budget_consumption` vira a soma de DUAS pernas, nos mesmos dois
-- movimentos da 046 -- e cada um sem o outro e um defeito ja medido:
--
--   1. A perna do VALOR CHEIO perde o `AND t.group_id IS NULL` do ramo pessoal.
--      Com ele, a despesa de grupo que EU paguei nunca era contada: 500 em vez
--      de 590.
--
--   2. Entra uma perna de REEMBOLSO: a minha parte do que OUTRO pagou, de
--      `group_share_entries` com `NOT paguei_eu`. Sem o `NOT`, a minha parte de
--      30 do jantar viria SOMADA aos 90 da perna 1 -- 120 de uma despesa de 90,
--      a mesma dupla contagem que a 046 descreve.
--
-- O ramo de teto de GRUPO (`b.group_id IS NOT NULL`) fica IDENTICO: ele ja
-- somava o gasto de todos os membros por `t.group_id = b.group_id`, e continua
-- somando, pelo valor cheio. A perna 2 e explicitamente desligada ali
-- (`b.group_id IS NULL`): um teto de viagem que somasse "a minha parte" por
-- cima do valor cheio da viagem contaria a mesma despesa duas vezes, e a barra
-- da viagem subiria a cada membro novo.
--
-- POR QUE A MESMA DESPESA PODE APARECER EM DOIS TETOS
-- --------------------------------------------------
-- Com um teto pessoal de mercado e um teto da Casa na mesma categoria e mes, o
-- jantar de 90 que eu paguei entra nos DOIS. Isso nao e dupla contagem: sao
-- duas perguntas diferentes, com dois donos diferentes, e a 006 ja dizia isso
-- ("sao dois bolsos diferentes"). Somar os dois num numero so e o bug que
-- `lib/orcamento-de-grupo.ts` existe inteiro para impedir -- e continua
-- impedindo, porque a separacao dele e por `b.group_id`, que nao muda aqui.
--
-- POR QUE NAO LER `personal_category_monthly_totals`, QUE JA TEM O CRITERIO
-- ------------------------------------------------------------------------
-- Ela e a dona do criterio desde a 046, e o grao dela (usuario, mes, categoria)
-- e exatamente o grao de um teto. Era a leitura obvia -- e ela PERDERIA a
-- conversao de moeda que a 026 trouxe para ca.
--
-- `personal_category_monthly_totals` tem `currency` no GRAO e os valores na
-- moeda de cada lancamento, nao em BRL (foi a 022 que decidiu isso, e esta
-- certa: "gastei 1.000 reais e 180 dolares" e a resposta certa de um relatorio
-- pessoal). `budgets.amount_limit` e um numero em REAIS digitado por uma
-- pessoa. Para comparar, a 026 converte cada linha pela cotacao congelada
-- naquela linha -- e ler a view agregada obrigaria a escolher entre somar reais
-- com dolares (errado em silencio) e filtrar `currency = 'BRL'` (que apagaria
-- do teto a despesa da viagem ao exterior, de novo em silencio).
--
-- Entao a perna 2 le `group_share_entries`, que e a UNICA definicao de "minha
-- parte" e tem grao de LINHA -- e e nesse grao que a cotacao existe. O que esta
-- migration escreve a mao nao e o criterio de rateio (esse continua so na 033);
-- e so o `NOT paguei_eu` e a conversao, os dois visiveis em uma linha cada.
--
-- O JOIN COM `financial_transactions` NA PERNA 2 NAO FILTRA NADA
-- -------------------------------------------------------------
-- Ele existe por UM motivo: `group_share_entries` expoe `currency` mas nao
-- `exchange_rate`, e sem a cotacao a parte de uma despesa em dolar entraria no
-- teto em reais pelo numero errado. O JOIN e por `t.id = e.transaction_id` (FK
-- para a PK, 1:1, nao duplica) e nao pode descartar linha: a propria
-- `group_share_entries` ja junta essa mesma transacao la dentro, entao uma
-- linha invisivel pela RLS nunca chegaria aqui para ser filtrada.
--
-- A alternativa era APENDAR `exchange_rate` em `group_share_entries`. Ficaria
-- mais bonito e foi descartado de proposito: aquela view e da 033, tem a suite
-- e o runner de mutante da 033 e da 046 pendurados nela, e recolar a definicao
-- inteira por causa de uma coluna e exatamente o movimento que ja reverteu
-- migration irma neste repositorio.
--
-- O QUE ESTA MIGRATION NAO TOCA
-- -----------------------------
--   * `group_member_balances` (quem deve a quem) -- outra pergunta.
--   * o ramo de teto de GRUPO, acima.
--   * `lib/orcamento-de-grupo.ts` e `/api/budgets`. Conferido: a rota NAO
--     filtra `group_id IS NULL` em lugar nenhum (ela so aplica o `.eq` quando a
--     tela do grupo pede UM grupo), e a separacao pessoal/grupo da tela e por
--     `b.group_id`, que continua certo. Ou seja: ao contrario da
--     `planned_vs_actual`, onde o defeito estava na view E na rota, aqui ele
--     esta so na view -- consertar a view muda o numero na tela.
--   * a RECEITA do reembolso. O que os outros me devem do jantar nao e receita
--     deste mes; e um credito a receber, e orcamento e teto de DESPESA.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preflight -- o que esta migration PRECISA achar no banco
-- ---------------------------------------------------------------------------
-- Mesmo desenho do preflight da 045/046, e pela mesma razao: aplicada fora de
-- ordem no SQL Editor, esta migration recolaria `budget_consumption` sem a
-- perna 2 (se `group_share_entries` nao existisse o CREATE falharia, isso sim)
-- ou sem a conversao (se `exchange_rate` nao existisse). O erro de uma coluna
-- faltando sai como "column does not exist" no meio de um CREATE VIEW, que nao
-- diz qual migration falta.
DO $$
DECLARE
  v_faltando TEXT;
BEGIN
  SELECT string_agg(msg, E'\n') INTO v_faltando
  FROM (
    SELECT '  - view public.budget_consumption (vem do 006, reescrita pela 026)' AS msg
    WHERE to_regclass('public.budget_consumption') IS NULL
    UNION ALL
    SELECT '  - view public.group_share_entries (vem do 033)'
    WHERE to_regclass('public.group_share_entries') IS NULL
    UNION ALL
    -- A coluna que carrega "quem pagou". Sem ela a perna 2 nao tem como
    -- descartar o que eu mesma paguei, e o resultado seria dupla contagem.
    SELECT '  - coluna paguei_eu em public.group_share_entries (vem do 033)'
    WHERE to_regclass('public.group_share_entries') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'group_share_entries'
           AND column_name = 'paguei_eu'
      )
    UNION ALL
    -- A cotacao congelada da 026. Sem ela as duas pernas somariam reais com
    -- dolares num teto que e em reais.
    SELECT '  - coluna exchange_rate em public.financial_transactions (vem do 026)'
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'financial_transactions'
         AND column_name = 'exchange_rate'
    )
  ) AS checks
  WHERE msg IS NOT NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION E'049 nao pode ser aplicado neste banco. Faltando:\n%\n\nRode 001 -> ... -> 048 antes.', v_faltando;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. budget_consumption -- bruto + reembolso
-- ---------------------------------------------------------------------------
-- As colunas e a ordem delas sao as da 026, inalteradas: `CREATE OR REPLACE
-- VIEW` so aceita APENDAR, e nada aqui precisa de coluna nova. O que muda e o
-- `spent` -- e, por consequencia, `remaining`, `consumed_ratio` e
-- `consumption_status`, que saem dele.
--
-- `spent` NUNCA e NULL agora (as duas pernas vem com COALESCE), e o
-- `COALESCE(g.spent, 0)` de fora continua escrito mesmo assim: o LEFT JOIN
-- LATERAL e quem garante que um teto SEM gasto nenhum nao desapareca da lista,
-- e tirar aquele COALESCE o deixaria depender de um detalhe do subquery. O teto
-- recem-criado do mes que vem e o caso -- `budget_invoice_test.sql` prende ele.
CREATE OR REPLACE VIEW public.budget_consumption AS
  SELECT
    b.id,
    b.user_id,
    b.category_id,
    b.group_id,
    b.month,
    b.amount_limit,
    b.alert_threshold,
    b.carry_forward,
    b.notes,
    b.created_at,
    b.updated_at,
    COALESCE(g.spent, 0)::numeric(15,2) AS spent,
    (b.amount_limit - COALESCE(g.spent, 0))::numeric(15,2) AS remaining,
    ROUND(COALESCE(g.spent, 0) / b.amount_limit, 4) AS consumed_ratio,
    CASE
      WHEN COALESCE(g.spent, 0) >= b.amount_limit THEN 'exceeded'
      WHEN COALESCE(g.spent, 0) >= b.amount_limit * b.alert_threshold THEN 'alert'
      ELSE 'ok'
    END AS consumption_status
  FROM public.budgets b
  LEFT JOIN LATERAL (
    SELECT COALESCE(cheio.v, 0) + COALESCE(reembolso.v, 0) AS spent
    FROM
      -- PERNA 1 -- TUDO O QUE EU LANCEI, pelo valor CHEIO, inclusive a despesa
      -- de grupo que eu paguei. A janela de mes, o ABS() da despesa negativa e
      -- a conversao pela cotacao da propria linha sao os da 026, intocados.
      --
      -- O `AND t.group_id IS NULL` do ramo pessoal SAIU (049): era ele que
      -- apagava do meu teto o que eu mesma paguei pelo grupo. Isto so esta
      -- correto porque a perna 2 descarta `paguei_eu`.
      (
        SELECT SUM(ABS(t.amount) * t.exchange_rate) AS v
        FROM public.financial_transactions t
        WHERE t.category_id = b.category_id
          AND t.transaction_type = 'expense'
          AND t.transaction_date >= b.month
          AND t.transaction_date < (b.month + INTERVAL '1 month')::date
          AND CASE
                WHEN b.group_id IS NOT NULL THEN t.group_id = b.group_id
                ELSE t.user_id = b.user_id
              END
      ) AS cheio,

      -- PERNA 2 -- O REEMBOLSO QUE EU DEVO: a minha parte do que OUTRO pagou.
      --
      -- `b.group_id IS NULL` desliga a perna inteira no teto de GRUPO, onde a
      -- perna 1 ja somou a viagem inteira. `NOT e.paguei_eu` tira o que eu
      -- paguei, que a perna 1 ja trouxe cheio.
      --
      -- `e.month` e `date_trunc('month', transaction_date)` desde a 033, e
      -- `b.month` e sempre dia 1 (CHECK do 006): a igualdade recorta o mesmo mes
      -- que a janela da perna 1.
      --
      -- `e.amount` e POSITIVO por construcao (a 033 e explicita: "quem le isto
      -- NAO deve aplicar ABS de novo nem inverter o sinal"), entao aqui nao ha
      -- ABS -- um ABS inofensivo esconderia o dia em que aquela convencao
      -- mudasse.
      (
        SELECT SUM(e.amount * t.exchange_rate) AS v
        FROM public.group_share_entries e
        JOIN public.financial_transactions t ON t.id = e.transaction_id
        WHERE b.group_id IS NULL
          AND e.user_id = b.user_id
          AND e.category_id = b.category_id
          AND e.month = b.month
          AND NOT e.paguei_eu
      ) AS reembolso
  ) AS g ON TRUE;

COMMENT ON VIEW public.budget_consumption IS
  'budgets com o consumido, o que resta e o status (ok/alert/exceeded) calculados na leitura. O consumido de um teto PESSOAL e CUSTO, nao caixa: bruto + reembolso -- valor cheio do que EU lancei (inclusive despesa de grupo que eu paguei) mais A MINHA PARTE do que OUTRO pagou. Criterio escolhido na HMO-258 em 08/10/2026, o mesmo da HMO-275 e da 046. O teto de GRUPO continua somando o valor cheio gasto por todos os membros, e a perna do reembolso fica desligada nele. Gasto convertido para BRL pela cotacao congelada de cada lancamento, que e a moeda de amount_limit.';

-- ---------------------------------------------------------------------------
-- 2. security_invoker e GRANTs
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` APAGA as reloptions da view, e `security_invoker` e
-- uma reloption. Aqui isso vale dinheiro e privacidade ao mesmo tempo, e o
-- sintoma e MAIOR do que era na 026: a view passou a ler `group_share_entries`,
-- que a 033 deixou SEM filtro de user_id de proposito ("quem le PRECISA
-- filtrar"). A perna 2 filtra (`e.user_id = b.user_id`), entao o teto nao
-- mistura pessoas -- mas `budget_consumption` sem `security_invoker` roda com
-- os direitos do DONO, a RLS do 006 para de valer, e qualquer logado passa a
-- listar o orcamento de TODO MUNDO.
ALTER VIEW public.budget_consumption SET (security_invoker = true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.budget_consumption FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON public.budget_consumption TO authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Sonda: a view ficou com security_invoker?
-- ---------------------------------------------------------------------------
-- NOTICE e nao EXCEPTION, no mesmo tom da 042/045/046: quem reprova isso de
-- verdade e o teste desta migration (que mede PELA RLS, com dois usuarios) e o
-- `view_security_invoker_test.sql`. Esta linha existe para quem aplica a mao no
-- SQL Editor e nao roda teste.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.budget_consumption'::regclass
       AND COALESCE(reloptions @> ARRAY['security_invoker=true'], FALSE)
  ) THEN
    RAISE NOTICE '049: budget_consumption ficou SEM security_invoker (furando a RLS)';
  END IF;
END $$;

COMMIT;


-- ---------------------------------------------------------------------------
-- 4. Relatorio -- ESTA e a tabela para copiar de volta na issue
-- ---------------------------------------------------------------------------
WITH sem_rls AS (
  SELECT coalesce(string_agg(c.relname, ', ' ORDER BY c.relname), '') AS v
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
), anon_extra AS (
  -- A chave anon vai embutida no bundle JS publico: privilegio dela alem das
  -- duas tabelas de referencia e dado aberto na internet.
  SELECT coalesce(string_agg(DISTINCT table_name, ', '), '') AS v
    FROM information_schema.role_table_grants
   WHERE grantee = 'anon' AND table_schema = 'public'
     AND table_name NOT IN ('financial_services', 'transaction_categories')
), sem_definer AS (
  SELECT coalesce(string_agg(p.proname, ', ' ORDER BY p.proname), '') AS v
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND NOT p.prosecdef
     AND p.proname IN ('create_free_subscription', 'update_user_balances',
                       'update_usage_limits_on_plan_change')
), contagem AS (
  SELECT
    (SELECT count(*) FROM public.financial_services)      AS servicos,
    (SELECT count(*) FROM public.transaction_categories)  AS categorias,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r')     AS tabelas,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policies,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public')                         AS funcoes,
    (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal) AS triggers
), linhas AS (
  SELECT r.*
    FROM sem_rls, anon_extra, sem_definer, contagem,
    LATERAL (VALUES
      (1, 'todas as tabelas de public com RLS ligada',
          CASE WHEN sem_rls.v = '' THEN 'OK' ELSE 'FALHA' END,
          coalesce(nullif(sem_rls.v, ''), 'nenhuma tabela sem RLS')),
      (2, 'anon limitada as 2 tabelas de referencia',
          CASE WHEN anon_extra.v = '' THEN 'OK' ELSE 'FALHA' END,
          coalesce(nullif(anon_extra.v, ''), 'nenhum privilegio sobrando')),
      (3, 'seed financial_services = 3',
          CASE WHEN contagem.servicos = 3 THEN 'OK' ELSE 'FALHA' END,
          contagem.servicos::text),
      (4, 'seed transaction_categories = 12',
          CASE WHEN contagem.categorias = 12 THEN 'OK' ELSE 'FALHA' END,
          contagem.categorias::text),
      (5, 'as 3 funcoes de trigger com SECURITY DEFINER (003)',
          CASE WHEN sem_definer.v = '' THEN 'OK' ELSE 'FALHA' END,
          coalesce(nullif(sem_definer.v, ''), 'as 3 estao SECURITY DEFINER')),
      (6, 'inventario do que subiu', 'INFO',
          contagem.tabelas || ' tabelas, ' || contagem.policies || ' policies, ' ||
          contagem.funcoes || ' funcoes, ' || contagem.triggers || ' triggers')
    ) AS r(ord, verificacao, status, detalhe)
)
SELECT ord AS "#", verificacao, status, detalhe FROM linhas
UNION ALL
SELECT 9, 'VEREDITO (migrations)',
       CASE WHEN count(*) FILTER (WHERE status = 'FALHA') = 0 THEN 'TUDO OK' ELSE 'FALHOU' END,
       count(*) FILTER (WHERE status = 'FALHA')::text || ' falha(s) em ' ||
       count(*) FILTER (WHERE status <> 'INFO')::text || ' verificacoes'
  FROM linhas
ORDER BY 1;
