-- 🔥 REMOVER RLS COMPLETAMENTE - Desabilitar todas as políticas

-- 1. DESABILITAR RLS em financial_transactions
ALTER TABLE financial_transactions DISABLE ROW LEVEL SECURITY;

-- 2. DESABILITAR RLS em group_transactions  
ALTER TABLE group_transactions DISABLE ROW LEVEL SECURITY;

-- 3. DESABILITAR RLS em group_expense_splits
ALTER TABLE group_expense_splits DISABLE ROW LEVEL SECURITY;

-- 4. DESABILITAR RLS em todas as outras tabelas relacionadas
ALTER TABLE expense_groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE group_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE financial_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE financial_categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE financial_services DISABLE ROW LEVEL SECURITY;

-- 5. DROPAR TODAS AS POLÍTICAS RLS (opcional, mas garante limpeza)
DROP POLICY IF EXISTS "financial_transactions_select_policy" ON financial_transactions;
DROP POLICY IF EXISTS "financial_transactions_insert_policy" ON financial_transactions;
DROP POLICY IF EXISTS "financial_transactions_update_policy" ON financial_transactions;
DROP POLICY IF EXISTS "financial_transactions_delete_policy" ON financial_transactions;

DROP POLICY IF EXISTS "group_transactions_select_policy" ON group_transactions;
DROP POLICY IF EXISTS "group_transactions_insert_policy" ON group_transactions;
DROP POLICY IF EXISTS "group_transactions_update_policy" ON group_transactions;
DROP POLICY IF EXISTS "group_transactions_delete_policy" ON group_transactions;

DROP POLICY IF EXISTS "group_expense_splits_select_policy" ON group_expense_splits;
DROP POLICY IF EXISTS "group_expense_splits_insert_policy" ON group_expense_splits;
DROP POLICY IF EXISTS "group_expense_splits_update_policy" ON group_expense_splits;
DROP POLICY IF EXISTS "group_expense_splits_delete_policy" ON group_expense_splits;

-- 6. Garantir que as tabelas existam e tenham as colunas necessárias
ALTER TABLE group_transactions 
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);

-- 7. Criar tabela group_expense_splits se não existir
CREATE TABLE IF NOT EXISTS group_expense_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_transaction_id UUID NOT NULL REFERENCES group_transactions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id),
    amount DECIMAL(10, 2) NOT NULL,
    percentage DECIMAL(5, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Verificar que RLS foi desabilitado
SELECT 
    tablename,
    rowsecurity as "RLS_Habilitado"
FROM pg_tables 
WHERE tablename IN (
    'financial_transactions', 
    'group_transactions', 
    'group_expense_splits',
    'expense_groups',
    'group_members'
)
ORDER BY tablename;

-- 9. Verificar se não há mais políticas
SELECT 
    tablename,
    COUNT(*) as "Políticas_Restantes"
FROM pg_policies 
WHERE tablename IN (
    'financial_transactions', 
    'group_transactions', 
    'group_expense_splits'
)
GROUP BY tablename;

-- ✅ PRONTO! Agora você pode inserir em qualquer tabela sem restrições RLS!