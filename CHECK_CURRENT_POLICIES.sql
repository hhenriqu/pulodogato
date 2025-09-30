-- =====================================================
-- VERIFY: Check current RLS policies on group_members
-- Run this to see what policies actually exist
-- =====================================================

-- Check all current policies on group_members table
SELECT 
    'Current policies on group_members:' as status,
    policyname,
    cmd,
    permissive,
    qual
FROM pg_policies 
WHERE tablename = 'group_members'
ORDER BY policyname;

-- Also check if table exists and has RLS enabled
SELECT 
    'Table info:' as status,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables pt
JOIN pg_class pc ON pt.tablename = pc.relname
WHERE pt.tablename = 'group_members';