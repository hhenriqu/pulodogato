-- 🔍 VERIFICAR RLS POLICIES - financial_transactions

-- 1. Ver todas as políticas RLS ativas para financial_transactions
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'financial_transactions'
ORDER BY policyname;

-- 2. Ver se RLS está habilitado
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables 
WHERE tablename = 'financial_transactions';

-- 3. Verificar políticas para group_transactions também
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'group_transactions'
ORDER BY policyname;

-- 4. TEMPORÁRIO - Desabilitar RLS apenas para teste (NÃO RECOMENDADO EM PRODUÇÃO)
-- Descomente apenas se necessário para teste:
-- ALTER TABLE financial_transactions DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE group_transactions DISABLE ROW LEVEL SECURITY;

-- 5. Para reabilitar depois do teste:
-- ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE group_transactions ENABLE ROW LEVEL SECURITY;