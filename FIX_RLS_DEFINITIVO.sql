-- =====================================================
-- SOLUÇÃO DEFINITIVA: RLS sem recursão para group_members
-- Usa funções de segurança para evitar recursão infinita
-- =====================================================

-- 1. Criar função helper para verificar se usuário é membro de um grupo
CREATE OR REPLACE FUNCTION is_group_member(p_group_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN AS $$
DECLARE
    member_count INTEGER;
BEGIN
    -- Verificar se o usuário é membro do grupo
    SELECT COUNT(*) INTO member_count
    FROM group_members
    WHERE group_id = p_group_id 
      AND user_id = p_user_id 
      AND status IN ('active', 'inactive');
    
    RETURN member_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Criar função helper para verificar se usuário é admin de um grupo
CREATE OR REPLACE FUNCTION is_group_admin(p_group_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN AS $$
DECLARE
    admin_count INTEGER;
BEGIN
    -- Verificar se o usuário é admin do grupo
    SELECT COUNT(*) INTO admin_count
    FROM group_members
    WHERE group_id = p_group_id 
      AND user_id = p_user_id 
      AND role = 'admin'
      AND status = 'active';
    
    RETURN admin_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Remover políticas temporárias
DROP POLICY IF EXISTS "authenticated_users_full_access" ON group_members;

-- 4. Criar políticas seguras usando as funções
-- Política 1: Ver próprios memberships
CREATE POLICY "select_own_memberships" 
    ON group_members FOR SELECT 
    USING (user_id = auth.uid());

-- Política 2: Ver membros dos grupos onde você é membro (usando função)
CREATE POLICY "select_group_members_if_member" 
    ON group_members FOR SELECT 
    USING (is_group_member(group_id));

-- Política 3: Admins podem inserir/atualizar/deletar (usando função)
CREATE POLICY "admin_manage_all_operations" 
    ON group_members FOR ALL 
    USING (is_group_admin(group_id));

-- 5. Verificar as novas políticas
SELECT 
    'POLÍTICAS FINAIS:' as info,
    policyname, 
    cmd, 
    permissive,
    qual 
FROM pg_policies 
WHERE tablename = 'group_members'
ORDER BY policyname;