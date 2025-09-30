-- =====================================================
-- TEST: Verify RLS policies are working correctly
-- Run this to confirm the infinite recursion is fixed
-- =====================================================

-- 1. Test if you can see your own memberships (should work now)
SELECT 
    'TEST 1: My memberships' as test,
    COUNT(*) as total_found
FROM group_members 
WHERE user_id = auth.uid();

-- 2. Test if you can see details of your groups  
SELECT 
    'TEST 2: My group details' as test,
    gm.group_id,
    gm.status,
    gm.role,
    eg.name as group_name
FROM group_members gm
JOIN expense_groups eg ON gm.group_id = eg.id
WHERE gm.user_id = auth.uid()
AND gm.status = 'active';

-- 3. Simulate the API query (this should work without infinite recursion)
SELECT 
    'TEST 3: API simulation' as test,
    gm.group_id
FROM group_members gm
WHERE gm.user_id = auth.uid()
AND gm.status = 'active';

-- 4. Verify access to specific groups
SELECT 
    'TEST 4: Group access' as test,
    eg.id,
    eg.name,
    eg.is_active
FROM expense_groups eg
WHERE eg.id IN (
    SELECT gm.group_id
    FROM group_members gm
    WHERE gm.user_id = auth.uid()
    AND gm.status = 'active'
);

-- 5. Show current user for reference
SELECT 
    'TEST 5: Current user' as test,
    auth.uid() as user_id;