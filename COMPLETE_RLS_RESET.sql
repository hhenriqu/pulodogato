-- =====================================================
-- COMPLETE RLS RESET - Remove ALL existing policies and recreate
-- EXECUTE THIS IN SUPABASE SQL EDITOR
-- =====================================================

-- Step 1: DROP ALL existing RLS policies for group-related tables
DO $$
DECLARE
    pol RECORD;
BEGIN
    -- Drop all policies for group_members table
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'group_members' AND schemaname = 'public'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(pol.policyname) || ' ON group_members';
        RAISE NOTICE 'Dropped policy: %', pol.policyname;
    END LOOP;
    
    -- Drop all policies for group_invitations table  
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'group_invitations' AND schemaname = 'public'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(pol.policyname) || ' ON group_invitations';
        RAISE NOTICE 'Dropped policy: %', pol.policyname;
    END LOOP;
    
    -- Drop all policies for expense_groups table
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'expense_groups' AND schemaname = 'public'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(pol.policyname) || ' ON expense_groups';
        RAISE NOTICE 'Dropped policy: %', pol.policyname;
    END LOOP;
END $$;

-- Step 2: Verify RLS is enabled on all tables
ALTER TABLE expense_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;  
ALTER TABLE group_invitations ENABLE ROW LEVEL SECURITY;

-- Step 3: Create simple, non-recursive policies for expense_groups
CREATE POLICY "expense_groups_select_own" 
    ON expense_groups FOR SELECT 
    USING (
        created_by = auth.uid() OR
        id IN (
            SELECT group_id 
            FROM group_members 
            WHERE user_id = auth.uid() 
            AND status = 'active'
        )
    );

CREATE POLICY "expense_groups_insert_own" 
    ON expense_groups FOR INSERT 
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "expense_groups_update_admins" 
    ON expense_groups FOR UPDATE 
    USING (
        created_by = auth.uid() OR
        id IN (
            SELECT group_id 
            FROM group_members 
            WHERE user_id = auth.uid() 
            AND role = 'admin' 
            AND status = 'active'
        )
    );

CREATE POLICY "expense_groups_delete_creators" 
    ON expense_groups FOR DELETE 
    USING (created_by = auth.uid());

-- Step 4: Create simple, non-recursive policies for group_members
CREATE POLICY "group_members_select_own" 
    ON group_members FOR SELECT 
    USING (user_id = auth.uid());

CREATE POLICY "group_members_insert_by_admins" 
    ON group_members FOR INSERT 
    WITH CHECK (
        -- Allow group creator to add first admin record
        EXISTS (
            SELECT 1 FROM expense_groups eg 
            WHERE eg.id = group_members.group_id 
            AND eg.created_by = auth.uid()
        ) OR
        -- Allow existing admins to add members
        EXISTS (
            SELECT 1 FROM group_members gm 
            WHERE gm.group_id = group_members.group_id 
            AND gm.user_id = auth.uid() 
            AND gm.role = 'admin' 
            AND gm.status = 'active'
        )
    );

CREATE POLICY "group_members_update_by_admins" 
    ON group_members FOR UPDATE 
    USING (
        user_id = auth.uid() OR  -- Users can update their own status
        EXISTS (
            SELECT 1 FROM group_members gm 
            WHERE gm.group_id = group_members.group_id 
            AND gm.user_id = auth.uid() 
            AND gm.role = 'admin' 
            AND gm.status = 'active'
        )
    );

CREATE POLICY "group_members_delete_by_admins" 
    ON group_members FOR DELETE 
    USING (
        user_id = auth.uid() OR  -- Users can leave groups
        EXISTS (
            SELECT 1 FROM group_members gm 
            WHERE gm.group_id = group_members.group_id 
            AND gm.user_id = auth.uid() 
            AND gm.role = 'admin' 
            AND gm.status = 'active'
        )
    );

-- Step 5: Create simple, non-recursive policies for group_invitations  
CREATE POLICY "group_invitations_select_involved" 
    ON group_invitations FOR SELECT 
    USING (
        invited_by = auth.uid() OR 
        invited_user_id = auth.uid()
    );

CREATE POLICY "group_invitations_insert_by_admins" 
    ON group_invitations FOR INSERT 
    WITH CHECK (
        invited_by = auth.uid() AND (
            -- Group creators can invite
            EXISTS (
                SELECT 1 FROM expense_groups eg 
                WHERE eg.id = group_invitations.group_id 
                AND eg.created_by = auth.uid()
            ) OR
            -- Admins can invite
            EXISTS (
                SELECT 1 FROM group_members gm 
                WHERE gm.group_id = group_invitations.group_id 
                AND gm.user_id = auth.uid() 
                AND gm.role = 'admin' 
                AND gm.status = 'active'
            )
        )
    );

CREATE POLICY "group_invitations_update_involved" 
    ON group_invitations FOR UPDATE 
    USING (
        invited_by = auth.uid() OR 
        invited_user_id = auth.uid()
    );

CREATE POLICY "group_invitations_delete_involved" 
    ON group_invitations FOR DELETE 
    USING (
        invited_by = auth.uid() OR 
        invited_user_id = auth.uid()
    );

-- Step 6: Verify the new policy structure
SELECT 
    'Policy verification:' as status,
    schemaname,
    tablename,
    policyname,
    cmd,
    permissive
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename IN ('expense_groups', 'group_members', 'group_invitations')
ORDER BY tablename, policyname;