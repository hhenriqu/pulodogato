-- =====================================================
-- DEBUG: Verificar usuário atual e seus grupos
-- Execute este SQL no Console do Supabase
-- =====================================================

-- 1. Verificar qual usuário está logado
SELECT 
    id,
    email,
    created_at
FROM auth.users 
WHERE id = auth.uid();

-- 2. Verificar perfil do usuário atual
SELECT 
    id,
    full_name,
    email
FROM profiles 
WHERE id = auth.uid();

-- 3. Verificar todos os memberships do usuário atual
SELECT 
    gm.group_id,
    gm.status,
    gm.role,
    gm.joined_at,
    eg.name as group_name,
    eg.is_active,
    creator.full_name as creator_name
FROM group_members gm
JOIN expense_groups eg ON gm.group_id = eg.id
LEFT JOIN profiles creator ON eg.created_by = creator.id
WHERE gm.user_id = auth.uid()
ORDER BY gm.joined_at DESC;

-- 4. Verificar especificamente o grupo "testess"
SELECT 
    gm.*,
    p.full_name as member_name
FROM group_members gm
JOIN profiles p ON gm.user_id = p.id
WHERE gm.group_id = '32e8d77e-86a0-4a5b-ad81-2fa6a553a76d'
ORDER BY gm.joined_at;

-- 5. Verificar convites pendentes para o usuário atual
SELECT 
    gi.*,
    eg.name as group_name
FROM group_invitations gi
JOIN expense_groups eg ON gi.group_id = eg.id
WHERE gi.invited_user_id = auth.uid()
ORDER BY gi.created_at DESC;