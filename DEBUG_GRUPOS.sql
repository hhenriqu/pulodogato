-- =====================================================
-- DEBUG: Verificar por que grupo não aparece na lista
-- Execute este SQL no Console do Supabase
-- =====================================================

-- 1. Verificar se você é membro do grupo
SELECT 
    gm.*,
    p.full_name,
    p.email
FROM group_members gm
JOIN profiles p ON gm.user_id = p.id
WHERE gm.group_id = '32e8d77e-86a0-4a5b-ad81-2fa6a553a76d'
AND gm.user_id = auth.uid();

-- 2. Verificar todos os seus grupos
SELECT 
    gm.group_id,
    gm.status,
    gm.role,
    eg.name as group_name,
    eg.is_active
FROM group_members gm
JOIN expense_groups eg ON gm.group_id = eg.id
WHERE gm.user_id = auth.uid();

-- 3. Verificar políticas de group_members
SELECT 
    policyname, 
    cmd, 
    qual 
FROM pg_policies 
WHERE tablename = 'group_members';

-- 4. Testar consulta da API manualmente
SELECT 
    gm.group_id
FROM group_members gm
WHERE gm.user_id = auth.uid()
AND gm.status = 'active';

-- 5. Verificar se consegue acessar o grupo específico
SELECT 
    eg.*,
    creator.full_name as creator_name
FROM expense_groups eg
LEFT JOIN profiles creator ON eg.created_by = creator.id
WHERE eg.id = '32e8d77e-86a0-4a5b-ad81-2fa6a553a76d'
AND eg.is_active = true;