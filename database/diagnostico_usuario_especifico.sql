-- =====================================================
-- TESTE ESPECÍFICO: Verificar transações do usuário
-- Data: 29/09/2025
-- Descrição: Verificar transações específicas do usuário atual
-- =====================================================

-- 1. Verificar transações do usuário com group_id
SELECT 
    'Transações do Usuário com Grupo' as tipo,
    ft.id,
    ft.description,
    ft.amount,
    ft.group_id,
    eg.name as group_name,
    ft.created_at::date as data_criacao
FROM financial_transactions ft
LEFT JOIN expense_groups eg ON ft.group_id = eg.id
WHERE ft.user_id = '2a1107d1-81fe-45d3-bd16-ed5dad884285'  -- Seu user_id
  AND ft.group_id IS NOT NULL
ORDER BY ft.created_at DESC;

-- 2. Verificar se essas transações têm group_transactions
SELECT 
    'Group Transactions do Usuário' as tipo,
    gt.id as group_transaction_id,
    gt.group_id,
    gt.transaction_id,
    ft.description,
    ft.amount,
    eg.name as group_name
FROM group_transactions gt
JOIN financial_transactions ft ON gt.transaction_id = ft.id
JOIN expense_groups eg ON gt.group_id = eg.id
WHERE ft.user_id = '2a1107d1-81fe-45d3-bd16-ed5dad884285'
ORDER BY gt.created_at DESC;

-- 3. Verificar splits das transações do usuário
SELECT 
    'Splits das Transações do Usuário' as tipo,
    ges.id,
    ges.group_transaction_id,
    ges.amount,
    ges.status,
    gm.user_id,
    p.full_name as member_name
FROM group_expense_splits ges
JOIN group_transactions gt ON ges.group_transaction_id = gt.id
JOIN financial_transactions ft ON gt.transaction_id = ft.id
JOIN group_members gm ON ges.member_id = gm.id
JOIN profiles p ON gm.user_id = p.id
WHERE ft.user_id = '2a1107d1-81fe-45d3-bd16-ed5dad884285'
ORDER BY ges.created_at DESC;

-- 4. Verificar inconsistências específicas do usuário
SELECT 
    'Inconsistências do Usuário' as tipo,
    ft.id as transaction_id,
    ft.description,
    ft.amount,
    ft.group_id,
    eg.name as group_name,
    'Tem group_id mas sem group_transaction' as problema
FROM financial_transactions ft
JOIN expense_groups eg ON ft.group_id = eg.id
WHERE ft.user_id = '2a1107d1-81fe-45d3-bd16-ed5dad884285'
  AND ft.group_id IS NOT NULL
  AND ft.amount < 0  -- Apenas despesas
  AND NOT EXISTS (
    SELECT 1 FROM group_transactions gt 
    WHERE gt.transaction_id = ft.id AND gt.group_id = ft.group_id
  );

-- 5. Verificar membros dos grupos do usuário
SELECT 
    'Membros dos Grupos' as tipo,
    eg.name as group_name,
    p.full_name as member_name,
    gm.role,
    gm.status,
    gm.user_id
FROM expense_groups eg
JOIN group_members gm ON eg.id = gm.group_id
JOIN profiles p ON gm.user_id = p.id
WHERE eg.id IN (
    '4661ff8c-6b43-48c0-881d-57bd36d9875d',
    '32e8d77e-86a0-4a5b-ad81-2fa6a553a76d'
)
ORDER BY eg.name, gm.role;

-- 6. Teste da query que a API do grupo usa (para grupo 'testereaaa')
SELECT 
    'Query API Grupo testereaaa' as tipo,
    gt.id,
    gt.split_type,
    gt.created_at,
    ft.id as transaction_id,
    ft.description,
    ft.amount,
    ft.transaction_date,
    ft.user_id
FROM group_transactions gt
JOIN financial_transactions ft ON gt.transaction_id = ft.id
WHERE gt.group_id = '4661ff8c-6b43-48c0-881d-57bd36d9875d'
ORDER BY gt.created_at DESC;

-- 7. Teste da query que a API do grupo usa (para grupo 'testess')
SELECT 
    'Query API Grupo testess' as tipo,
    gt.id,
    gt.split_type,
    gt.created_at,
    ft.id as transaction_id,
    ft.description,
    ft.amount,
    ft.transaction_date,
    ft.user_id
FROM group_transactions gt
JOIN financial_transactions ft ON gt.transaction_id = ft.id
WHERE gt.group_id = '32e8d77e-86a0-4a5b-ad81-2fa6a553a76d'
ORDER BY gt.created_at DESC;

-- 8. Verificar todas as transações do usuário (com e sem grupo)
SELECT 
    'Todas Transações do Usuário' as tipo,
    ft.id,
    ft.description,
    ft.amount,
    CASE WHEN ft.group_id IS NOT NULL THEN eg.name ELSE 'SEM GRUPO' END as grupo_status,
    ft.created_at::date as data
FROM financial_transactions ft
LEFT JOIN expense_groups eg ON ft.group_id = eg.id
WHERE ft.user_id = '2a1107d1-81fe-45d3-bd16-ed5dad884285'
ORDER BY ft.created_at DESC
LIMIT 20;

SELECT '=== DIAGNÓSTICO ESPECÍFICO CONCLUÍDO ===' as resultado;