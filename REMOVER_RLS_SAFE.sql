-- 🔥 REMOVER RLS - APENAS TABELAS QUE EXISTEM

-- 1. Verificar quais tabelas existem primeiro
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN (
    'financial_transactions',
    'group_transactions', 
    'group_expense_splits',
    'expense_groups',
    'group_members',
    'profiles',
    'financial_accounts',
    'financial_categories',
    'financial_services'
)
ORDER BY tablename;

-- 2. DESABILITAR RLS apenas nas tabelas que existem
ALTER TABLE financial_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE group_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE expense_groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE group_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- 3. Tentar desabilitar nas outras (pode dar erro, mas não importa)
DO $$
BEGIN
    BEGIN
        ALTER TABLE financial_accounts DISABLE ROW LEVEL SECURITY;
    EXCEPTION WHEN undefined_table THEN
        RAISE NOTICE 'Tabela financial_accounts não existe';
    END;
    
    BEGIN
        ALTER TABLE financial_services DISABLE ROW LEVEL SECURITY;
    EXCEPTION WHEN undefined_table THEN
        RAISE NOTICE 'Tabela financial_services não existe';
    END;
    
    BEGIN
        ALTER TABLE group_expense_splits DISABLE ROW LEVEL SECURITY;
    EXCEPTION WHEN undefined_table THEN
        RAISE NOTICE 'Tabela group_expense_splits não existe';
    END;
END $$;

-- 4. DROPAR TODAS AS POLÍTICAS RLS das tabelas principais
DROP POLICY IF EXISTS "financial_transactions_select_policy" ON financial_transactions;
DROP POLICY IF EXISTS "financial_transactions_insert_policy" ON financial_transactions;
DROP POLICY IF EXISTS "financial_transactions_update_policy" ON financial_transactions;
DROP POLICY IF EXISTS "financial_transactions_delete_policy" ON financial_transactions;

DROP POLICY IF EXISTS "group_transactions_select_policy" ON group_transactions;
DROP POLICY IF EXISTS "group_transactions_insert_policy" ON group_transactions;
DROP POLICY IF EXISTS "group_transactions_update_policy" ON group_transactions;
DROP POLICY IF EXISTS "group_transactions_delete_policy" ON group_transactions;

-- 5. Adicionar coluna created_by se não existe
ALTER TABLE group_transactions 
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);

-- 6. Criar tabela group_expense_splits se não existir
CREATE TABLE IF NOT EXISTS group_expense_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_transaction_id UUID NOT NULL REFERENCES group_transactions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id),
    amount DECIMAL(10, 2) NOT NULL,
    percentage DECIMAL(5, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Desabilitar RLS na nova tabela
ALTER TABLE group_expense_splits DISABLE ROW LEVEL SECURITY;

-- 8. Verificar que RLS foi desabilitado
SELECT 
    tablename,
    rowsecurity as "RLS_Desabilitado"
FROM pg_tables 
WHERE tablename IN (
    'financial_transactions', 
    'group_transactions', 
    'group_expense_splits',
    'expense_groups',
    'group_members'
)
AND schemaname = 'public'
ORDER BY tablename;

-- ✅ PRONTO! RLS removido das tabelas que existem!