-- =====================================================
-- SIMPLE TEST: Check if the issue is in group_invitations table
-- The error might be coming from group_invitations, not group_members
-- =====================================================

-- 1. Check policies on group_invitations table (this might be the real culprit)
SELECT 
    'group_invitations policies:' as table_name,
    policyname,
    cmd,
    qual
FROM pg_policies 
WHERE schemaname = 'public' AND tablename = 'group_invitations'
ORDER BY policyname;

-- 2. Check policies on group_members 
SELECT 
    'group_members policies:' as table_name,
    policyname,
    cmd,
    qual
FROM pg_policies 
WHERE schemaname = 'public' AND tablename = 'group_members'
ORDER BY policyname;

-- 3. Check if group_invitations has any foreign key to group_members
SELECT 
    'Foreign keys from group_invitations:' as info,
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name = 'group_invitations';