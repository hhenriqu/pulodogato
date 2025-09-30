-- =====================================================
-- LIMPEZA E APLICAÇÃO FINAL: Políticas RLS Simplificadas
-- Remove conflitos e aplica apenas políticas essenciais
-- =====================================================

-- 1. REMOVER TODAS AS POLÍTICAS EXISTENTES (limpeza completa)
DROP POLICY IF EXISTS "admin_manage_all_operations" ON group_members;
DROP POLICY IF EXISTS "group_members_delete_by_admins" ON group_members;
DROP POLICY IF EXISTS "group_members_insert_by_admins" ON group_members;
DROP POLICY IF EXISTS "group_members_select_own" ON group_members;
DROP POLICY IF EXISTS "group_members_update_by_admins" ON group_members;
DROP POLICY IF EXISTS "select_group_members_if_member" ON group_members;
DROP POLICY IF EXISTS "select_own_memberships" ON group_members;
DROP POLICY IF EXISTS "temp_authenticated_access" ON group_members;
DROP POLICY IF EXISTS "authenticated_users_access_groups" ON group_members;

-- 2. VERIFICAR SE LIMPOU TUDO
SELECT 
    'APÓS LIMPEZA - Políticas restantes:' as status,
    COUNT(*) as total_policies
FROM pg_policies 
WHERE tablename = 'group_members';

-- 3. APLICAR APENAS POLÍTICA SIMPLES E FUNCIONAL
-- Uma única política que permite acesso completo para usuários autenticados
-- (mais seguro do que desabilitar RLS completamente)
CREATE POLICY "authenticated_users_access_groups" 
    ON group_members FOR ALL 
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);

-- 4. VERIFICAR SE FOI APLICADA CORRETAMENTE
SELECT 
    'POLÍTICA FINAL APLICADA:' as status,
    policyname, 
    cmd, 
    permissive,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'group_members'
ORDER BY policyname;

-- 5. TESTE BÁSICO: Verificar se conseguimos fazer consulta simples
SELECT 
    'TESTE - Total de membros visíveis:' as test_status,
    COUNT(*) as total_members
FROM group_members 
WHERE status = 'active';

-- 6. TESTE AVANÇADO: Verificar grupos do usuário atual
SELECT 
    'TESTE - Grupos do usuário atual:' as test_status,
    gm.group_id,
    gm.role,
    gm.status,
    eg.name as group_name
FROM group_members gm
LEFT JOIN expense_groups eg ON gm.group_id = eg.id
WHERE gm.user_id = auth.uid()
AND gm.status = 'active'
ORDER BY eg.name;