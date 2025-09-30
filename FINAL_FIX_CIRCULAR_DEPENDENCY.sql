-- =====================================================
-- DEFINITIVE FIX: Remove circular dependency in RLS policies
-- EXECUTE THIS IN SUPABASE SQL EDITOR
-- =====================================================

-- 1. DROP the problematic policies that cause infinite recursion
DROP POLICY IF EXISTS "Membros veem outros membros do grupo" ON group_members;
DROP POLICY IF EXISTS "Admins podem gerenciar membros" ON group_members;
DROP POLICY IF EXISTS "Usuários veem convites relacionados a eles" ON group_invitations;
DROP POLICY IF EXISTS "Usuários podem criar convites para seus grupos admin" ON group_invitations;

-- 2. CREATE simple, non-recursive policies for group_members
CREATE POLICY "Users see their own memberships" 
    ON group_members FOR SELECT 
    USING (user_id = auth.uid());

CREATE POLICY "Admins insert members" 
    ON group_members FOR INSERT 
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM group_members gm 
            WHERE gm.group_id = group_members.group_id 
            AND gm.user_id = auth.uid() 
            AND gm.role = 'admin' 
            AND gm.status = 'active'
        )
    );

CREATE POLICY "Admins update members" 
    ON group_members FOR UPDATE 
    USING (
        EXISTS (
            SELECT 1 FROM group_members gm 
            WHERE gm.group_id = group_members.group_id 
            AND gm.user_id = auth.uid() 
            AND gm.role = 'admin' 
            AND gm.status = 'active'
        )
    );

CREATE POLICY "Admins delete members" 
    ON group_members FOR DELETE 
    USING (
        EXISTS (
            SELECT 1 FROM group_members gm 
            WHERE gm.group_id = group_members.group_id 
            AND gm.user_id = auth.uid() 
            AND gm.role = 'admin' 
            AND gm.status = 'active'
        )
    );

-- 3. CREATE simple policies for group_invitations
CREATE POLICY "Users see their invitations" 
    ON group_invitations FOR SELECT 
    USING (
        invited_by = auth.uid() OR 
        invited_user_id = auth.uid()
    );

CREATE POLICY "Admins create invitations" 
    ON group_invitations FOR INSERT 
    WITH CHECK (
        auth.uid() = invited_by AND
        EXISTS (
            SELECT 1 FROM group_members gm 
            WHERE gm.group_id = group_invitations.group_id 
            AND gm.user_id = auth.uid() 
            AND gm.role = 'admin' 
            AND gm.status = 'active'
        )
    );

-- 4. Verify the new policies
SELECT 
    'New policies created:' as status,
    schemaname,
    tablename,
    policyname,
    cmd
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename IN ('group_members', 'group_invitations')
ORDER BY tablename, policyname;