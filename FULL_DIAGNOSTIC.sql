-- =====================================================
-- COMPREHENSIVE DIAGNOSTIC: Check everything about group_members
-- =====================================================

-- 1. Check ALL policies on group_members (different approach)
SELECT 
    'Method 1 - pg_policies:' as method,
    schemaname,
    tablename,
    policyname,
    cmd,
    permissive,
    roles,
    qual,
    with_check
FROM pg_policies 
WHERE schemaname = 'public' AND tablename = 'group_members'
ORDER BY policyname;

-- 2. Check policies directly from pg_policy system catalog
SELECT 
    'Method 2 - pg_policy:' as method,
    pol.polname as policyname,
    pol.polcmd::text as cmd,
    pol.polpermissive as permissive,
    pg_get_expr(pol.polqual, pol.polrelid) as qual
FROM pg_policy pol
JOIN pg_class pc ON pol.polrelid = pc.oid
JOIN pg_namespace ns ON pc.relnamespace = ns.oid
WHERE pc.relname = 'group_members' AND ns.nspname = 'public';

-- 3. Check if RLS is actually enabled
SELECT 
    'RLS Status:' as info,
    pc.relname as table_name,
    pc.relrowsecurity as rls_enabled,
    pc.relforcerowsecurity as rls_forced
FROM pg_class pc
JOIN pg_namespace ns ON pc.relnamespace = ns.oid
WHERE pc.relname = 'group_members' AND ns.nspname = 'public';

-- 4. Show current database and schema
SELECT 
    'Current Context:' as info,
    current_database() as database_name,
    current_schema() as current_schema,
    current_user as current_user;