-- 🚨 CORREÇÃO URGENTE - Schema group_transactions + RLS

-- 1. Verificar se coluna created_by existe
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'group_transactions' AND column_name = 'created_by';

-- 2. Adicionar coluna se não existe
ALTER TABLE group_transactions 
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);

-- 3. Garantir que group_expense_splits também existe
CREATE TABLE IF NOT EXISTS group_expense_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_transaction_id UUID NOT NULL REFERENCES group_transactions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id),
    amount DECIMAL(10, 2) NOT NULL,
    percentage DECIMAL(5, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. CORRIGIR RLS - Permitir INSERT para group_transactions
DROP POLICY IF EXISTS "group_transactions_insert_policy" ON group_transactions;

-- Nova política mais permissiva para INSERT
CREATE POLICY "group_transactions_insert_policy" ON group_transactions
    FOR INSERT 
    WITH CHECK (
        -- Verificar se user é membro do grupo OU é o owner da transação original
        EXISTS (
            SELECT 1 FROM group_members gm 
            WHERE gm.group_id = group_transactions.group_id 
            AND gm.user_id = auth.uid() 
            AND gm.status IN ('accepted', 'active')
        )
        OR
        EXISTS (
            SELECT 1 FROM financial_transactions ft
            WHERE ft.id = group_transactions.transaction_id
            AND ft.user_id = auth.uid()
        )
    );

-- 5. Habilitar RLS nas tabelas se não estiver
ALTER TABLE group_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_expense_splits ENABLE ROW LEVEL SECURITY;

-- 6. Política para group_expense_splits
DROP POLICY IF EXISTS "group_expense_splits_insert_policy" ON group_expense_splits;
CREATE POLICY "group_expense_splits_insert_policy" ON group_expense_splits
    FOR INSERT 
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM group_transactions gt
            JOIN group_members gm ON gt.group_id = gm.group_id
            WHERE gt.id = group_expense_splits.group_transaction_id
            AND gm.user_id = auth.uid()
            AND gm.status IN ('accepted', 'active')
        )
    );

-- 7. Verificar membros do grupo "testess" para debug
SELECT 
    gm.user_id,
    gm.status,
    p.email
FROM group_members gm
LEFT JOIN profiles p ON gm.user_id = p.id
WHERE gm.group_id = '32e8d77e-86a0-4a5b-ad81-2fa6a553a76d';

-- 8. Verificar estrutura final
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'group_transactions' 
ORDER BY ordinal_position;