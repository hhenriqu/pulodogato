-- =====================================================
-- FIX CRÍTICO: Política RLS para group_members
-- Problema: Dependência circular impede usuários de verem seus grupos
-- =====================================================

-- 1. Remover políticas existentes problemáticas
DROP POLICY IF EXISTS "Membros veem outros membros do grupo" ON group_members;
DROP POLICY IF EXISTS "Admins podem gerenciar membros" ON group_members;

-- 2. Criar políticas corretas
-- Usuários podem sempre ver seus próprios memberships
CREATE POLICY "Usuários veem seus próprios memberships" 
    ON group_members FOR SELECT 
    USING (user_id = auth.uid());

-- Usuários podem ver outros membros dos grupos onde são membros ativos
CREATE POLICY "Membros veem outros membros do mesmo grupo" 
    ON group_members FOR SELECT 
    USING (
        user_id != auth.uid() AND
        group_id IN (
            SELECT DISTINCT gm.group_id 
            FROM group_members gm 
            WHERE gm.user_id = auth.uid() 
            AND gm.status IN ('active', 'inactive')
        )
    );

-- Admins podem inserir/atualizar/deletar membros
CREATE POLICY "Admins podem gerenciar membros" 
    ON group_members FOR ALL 
    USING (
        group_id IN (
            SELECT DISTINCT gm.group_id 
            FROM group_members gm 
            WHERE gm.user_id = auth.uid() 
            AND gm.role = 'admin' 
            AND gm.status = 'active'
        )
    );

-- Verificar as novas políticas
SELECT 
    policyname, 
    cmd, 
    permissive,
    qual 
FROM pg_policies 
WHERE tablename = 'group_members'
ORDER BY policyname;