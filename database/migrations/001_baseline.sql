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
