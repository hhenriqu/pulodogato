-- =====================================================
-- FIX URGENTE: Convites de Grupo - RLS Policy
-- Execute este SQL no Console do Supabase
-- =====================================================

-- 1. Primeiro, verificar políticas existentes
SELECT 
    schemaname, 
    tablename, 
    policyname, 
    permissive, 
    cmd, 
    qual 
FROM pg_policies 
WHERE tablename = 'expense_groups'
ORDER BY policyname;

-- 2. Adicionar nova política para convites pendentes
CREATE POLICY "Usuários veem grupos para os quais foram convidados" 
    ON expense_groups FOR SELECT 
    USING (
        id IN (
            SELECT group_id FROM group_invitations 
            WHERE invited_user_id = auth.uid() 
            AND status = 'pending' 
            AND expires_at > NOW()
        )
    );

-- 3. Verificar se a política foi criada
SELECT 
    policyname, 
    cmd, 
    qual 
FROM pg_policies 
WHERE tablename = 'expense_groups' 
AND policyname = 'Usuários veem grupos para os quais foram convidados';

-- 4. Testar a consulta que está falhando
-- Esta consulta deveria retornar o grupo agora
SELECT 
    id, 
    name, 
    description, 
    group_code, 
    group_type, 
    default_split_type, 
    photo_url, 
    is_active 
FROM expense_groups 
WHERE id = '32e8d77e-86a0-4a5b-ad81-2fa6a553a76d';