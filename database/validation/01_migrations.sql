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
-- Entao o acerto e um livro proprio, que so a view de saldo le. Quem quiser
-- ver o dinheiro sair da conta corrente lanca a transferencia normalmente:
-- sao fatos diferentes e continuam separados.
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
