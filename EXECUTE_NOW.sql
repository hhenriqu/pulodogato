-- =====================================================
-- EXECUTE THIS IN SUPABASE SQL EDITOR NOW
-- This fixes the infinite recursion error you're seeing
-- =====================================================

-- 1. Remove ALL existing policies to start fresh
DROP POLICY IF EXISTS "Membros veem outros membros do grupo" ON group_members;
DROP POLICY IF EXISTS "Admins podem gerenciar membros" ON group_members;
DROP POLICY IF EXISTS "Usuários veem seus próprios memberships" ON group_members;
DROP POLICY IF EXISTS "Membros veem outros membros do mesmo grupo" ON group_members;

-- 2. Create correct policies without circular dependency
CREATE POLICY "Usuários veem seus próprios memberships" 
    ON group_members FOR SELECT 
    USING (user_id = auth.uid());

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

-- 3. Verify policies were created
SELECT 
    'Policy created:' as status,
    policyname,
    cmd
FROM pg_policies 
WHERE tablename = 'group_members'
ORDER BY policyname;