-- =====================================================
-- TESTE: Verificar se RLS foi corrigido
-- Execute APÓS aplicar o FIX_RLS_GROUP_MEMBERS.sql
-- =====================================================

-- 1. Testar se consegue ver seus próprios memberships
SELECT 
    'TESTE 1: Meus memberships' as teste,
    COUNT(*) as total_encontrado
FROM group_members 
WHERE user_id = auth.uid();

-- 2. Testar se consegue ver detalhes dos seus memberships  
SELECT 
    'TESTE 2: Detalhes dos meus grupos' as teste,
    gm.group_id,
    gm.status,
    gm.role,
    eg.name as group_name
FROM group_members gm
JOIN expense_groups eg ON gm.group_id = eg.id
WHERE gm.user_id = auth.uid()
AND gm.status = 'active';

-- 3. Simular a consulta da API
SELECT 
    'TESTE 3: Consulta da API' as teste,
    gm.group_id
FROM group_members gm
WHERE gm.user_id = auth.uid()
AND gm.status = 'active';

-- 4. Verificar se consegue acessar o grupo específico
SELECT 
    'TESTE 4: Acesso ao grupo específico' as teste,
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