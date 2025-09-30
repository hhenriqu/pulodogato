-- 🔥 FORÇA BRUTA - REMOVER RLS DE TUDO

-- 1. DROPAR TODAS AS POLÍTICAS PRIMEIRO (com aspas para tratar espaços)
-- financial_transactions
DO $$ 
DECLARE 
    pol record;
BEGIN
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'financial_transactions'
    LOOP
        EXECUTE 'DROP POLICY "' || pol.policyname || '" ON financial_transactions';
    END LOOP;
END $$;

-- group_transactions  
DO $$ 
DECLARE 
    pol record;
BEGIN
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'group_transactions'
    LOOP
        EXECUTE 'DROP POLICY "' || pol.policyname || '" ON group_transactions';
    END LOOP;
END $$;

-- group_expense_splits
DO $$ 
DECLARE 
    pol record;
BEGIN
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'group_expense_splits'
    LOOP
        EXECUTE 'DROP POLICY "' || pol.policyname || '" ON group_expense_splits';
    END LOOP;
END $$;

-- expense_groups
DO $$ 
DECLARE 
    pol record;
BEGIN
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'expense_groups'
    LOOP
        EXECUTE 'DROP POLICY "' || pol.policyname || '" ON expense_groups';
    END LOOP;
END $$;

-- group_members
DO $$ 
DECLARE 
    pol record;
BEGIN
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'group_members'
    LOOP
        EXECUTE 'DROP POLICY "' || pol.policyname || '" ON group_members';
    END LOOP;
END $$;

-- profiles
DO $$ 
DECLARE 
    pol record;
BEGIN
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'profiles'
    LOOP
        EXECUTE 'DROP POLICY "' || pol.policyname || '" ON profiles';
    END LOOP;
END $$;

-- 2. AGORA DESABILITAR RLS EM TUDO
ALTER TABLE financial_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE group_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE group_expense_splits DISABLE ROW LEVEL SECURITY;
ALTER TABLE expense_groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE group_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- 3. Garantir coluna created_by existe
ALTER TABLE group_transactions 
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);

-- 4. Verificar resultado final
SELECT 
    tablename,
    rowsecurity as "RLS_Status_Final"
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

-- 5. Verificar se ainda há políticas
SELECT 
    tablename,
    COUNT(*) as "Políticas_Restantes"
FROM pg_policies 
WHERE tablename IN (
    'financial_transactions', 
    'group_transactions', 
    'group_expense_splits',
    'expense_groups',
    'group_members'
)
GROUP BY tablename;

-- ✅ AGORA DEVE ESTAR TUDO DESABILITADO!