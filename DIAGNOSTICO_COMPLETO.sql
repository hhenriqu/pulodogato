-- =====================================================
-- DIAGNÓSTICO COMPLETO: Convites de Grupo
-- Execute este SQL no Console do Supabase
-- =====================================================

-- 1. Verificar se as políticas RLS foram criadas
SELECT 
    schemaname,
    tablename, 
    policyname,
    permissive,
    cmd
FROM pg_policies 
WHERE tablename IN ('expense_groups', 'group_invitations', 'group_members')
ORDER BY tablename, policyname;

-- 2. Verificar convites pendentes do usuário atual
SELECT 
    gi.*,
    eg.name as group_name,
    eg.is_active as group_active,
    p.full_name as inviter_name
FROM group_invitations gi
JOIN expense_groups eg ON gi.group_id = eg.id
LEFT JOIN profiles p ON gi.invited_by = p.id
WHERE gi.invited_user_id = auth.uid()
AND gi.status = 'pending'
AND gi.expires_at > NOW();

-- 3. Verificar se você consegue ver o grupo específico agora
SELECT 
    id, 
    name, 
    description, 
    group_code, 
    group_type, 
    default_split_type, 
    is_active,
    created_by
FROM expense_groups 
WHERE id = '32e8d77e-86a0-4a5b-ad81-2fa6a553a76d';

-- 4. Verificar membros do grupo
SELECT 
    gm.*,
    p.full_name
FROM group_members gm
LEFT JOIN profiles p ON gm.user_id = p.id
WHERE gm.group_id = '32e8d77e-86a0-4a5b-ad81-2fa6a553a76d';

-- 5. Verificar seu perfil atual
SELECT 
    id,
    full_name,
    email
FROM profiles 
WHERE id = auth.uid();