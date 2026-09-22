-- =====================================================
-- PULODOGATO -- VALIDACAO PASSO 1: schema do zero
-- =====================================================
-- GERADO por scripts/gen-validation-bundle.mjs. Nao edite este arquivo:
-- a fonte e database/migrations/*.sql e database/tests/rls_isolation_test.sql.
--
-- Cole este arquivo inteiro no SQL Editor do projeto Supabase DESCARTAVEL e
-- rode. Ele aplica 001 -> 002 -> 003 -> 004 -> 005 num banco vazio e termina imprimindo uma
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
-- Para reconferir os VALORES contra producao seria preciso uma role que nao
-- esteja sujeita a RLS, ou uma policy `TO paperclip_ro` nestas duas tabelas.
-- Ver HMO-127.
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
