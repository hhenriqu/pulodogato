-- 🔧 CORRIGIR RLS POLICIES - Permitir INSERT para usuários autenticados

-- 1. Primeiro, ver políticas atuais
SELECT policyname, cmd, qual, with_check 
FROM pg_policies 
WHERE tablename = 'financial_transactions';

-- 2. Dropar políticas restritivas se existirem
DROP POLICY IF EXISTS "financial_transactions_insert_policy" ON financial_transactions;
DROP POLICY IF EXISTS "financial_transactions_select_policy" ON financial_transactions;
DROP POLICY IF EXISTS "financial_transactions_update_policy" ON financial_transactions;
DROP POLICY IF EXISTS "financial_transactions_delete_policy" ON financial_transactions;

-- 3. Criar políticas RLS adequadas para financial_transactions
-- SELECT: Usuários podem ver suas próprias transações
CREATE POLICY "financial_transactions_select_policy" ON financial_transactions
    FOR SELECT 
    USING (auth.uid() = user_id);

-- INSERT: Usuários podem criar transações para si mesmos
CREATE POLICY "financial_transactions_insert_policy" ON financial_transactions
    FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

-- UPDATE: Usuários podem atualizar suas próprias transações
CREATE POLICY "financial_transactions_update_policy" ON financial_transactions
    FOR UPDATE 
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- DELETE: Usuários podem deletar suas próprias transações
CREATE POLICY "financial_transactions_delete_policy" ON financial_transactions
    FOR DELETE 
    USING (auth.uid() = user_id);

-- 4. Fazer o mesmo para group_transactions
DROP POLICY IF EXISTS "group_transactions_select_policy" ON group_transactions;
DROP POLICY IF EXISTS "group_transactions_insert_policy" ON group_transactions;
DROP POLICY IF EXISTS "group_transactions_update_policy" ON group_transactions;
DROP POLICY IF EXISTS "group_transactions_delete_policy" ON group_transactions;

-- SELECT: Membros do grupo podem ver transações do grupo
CREATE POLICY "group_transactions_select_policy" ON group_transactions
    FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM group_members gm 
            WHERE gm.group_id = group_transactions.group_id 
            AND gm.user_id = auth.uid() 
            AND gm.status = 'accepted'
        )
    );

-- INSERT: Membros do grupo podem criar transações do grupo
CREATE POLICY "group_transactions_insert_policy" ON group_transactions
    FOR INSERT 
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM group_members gm 
            WHERE gm.group_id = group_transactions.group_id 
            AND gm.user_id = auth.uid() 
            AND gm.status = 'accepted'
        )
    );

-- 5. Verificar se as políticas foram criadas
SELECT tablename, policyname, cmd, permissive 
FROM pg_policies 
WHERE tablename IN ('financial_transactions', 'group_transactions')
ORDER BY tablename, policyname;