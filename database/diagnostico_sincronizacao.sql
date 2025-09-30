-- =====================================================
-- DIAGNÓSTICO: Verificar Sincronização de Grupos
-- Data: 29/09/2025
-- Descrição: Queries para diagnosticar problemas de sincronização
-- =====================================================

-- 1. Verificar se transações têm group_id
SELECT 
    'Transações com group_id' as tipo,
    ft.id,
    ft.description,
    ft.amount,
    ft.group_id,
    eg.name as group_name,
    ft.created_at
FROM financial_transactions ft
LEFT JOIN expense_groups eg ON ft.group_id = eg.id
WHERE ft.group_id IS NOT NULL
ORDER BY ft.created_at DESC
LIMIT 10;

-- 2. Verificar group_transactions existentes
SELECT 
    'Group Transactions' as tipo,
    gt.id,
    gt.group_id,
    gt.transaction_id,
    gt.split_type,
    ft.description,
    ft.amount,
    eg.name as group_name
FROM group_transactions gt
JOIN financial_transactions ft ON gt.transaction_id = ft.id
JOIN expense_groups eg ON gt.group_id = eg.id
ORDER BY gt.created_at DESC
LIMIT 10;

-- 3. Verificar group_expense_splits
SELECT 
    'Group Splits' as tipo,
    ges.id,
    ges.group_transaction_id,
    ges.member_id,
    ges.amount,
    ges.status,
    p.full_name as member_name
FROM group_expense_splits ges
JOIN group_members gm ON ges.member_id = gm.id
JOIN profiles p ON gm.user_id = p.id
ORDER BY ges.created_at DESC
LIMIT 10;

-- 4. Verificar se trigger existe
SELECT 
    'Trigger Status' as tipo,
    trigger_name,
    event_manipulation,
    event_object_table,
    action_timing
FROM information_schema.triggers 
WHERE trigger_name = 'trigger_sync_transaction_group';

-- 5. Verificar função do trigger
SELECT 
    'Function Status' as tipo,
    routine_name,
    routine_type,
    data_type
FROM information_schema.routines 
WHERE routine_name = 'sync_transaction_with_group';

-- 6. Teste específico: buscar uma transação e suas ligações
-- Substitua 'transaction-id-aqui' pelo ID de uma transação real
SELECT 
    'Transação Específica' as tipo,
    ft.id as transaction_id,
    ft.description,
    ft.amount,
    ft.group_id,
    gt.id as group_transaction_id,
    COUNT(ges.id) as splits_count
FROM financial_transactions ft
LEFT JOIN group_transactions gt ON ft.id = gt.transaction_id
LEFT JOIN group_expense_splits ges ON gt.id = ges.group_transaction_id
WHERE ft.id = 'transaction-id-aqui'  -- Substitua por um ID real
GROUP BY ft.id, ft.description, ft.amount, ft.group_id, gt.id;

-- 7. Verificar grupos do usuário atual
SELECT 
    'Grupos do Usuário' as tipo,
    eg.id,
    eg.name,
    gm.role,
    gm.status,
    COUNT(gt.id) as transactions_count
FROM expense_groups eg
JOIN group_members gm ON eg.id = gm.group_id
LEFT JOIN group_transactions gt ON eg.id = gt.group_id
WHERE gm.user_id = auth.uid()
GROUP BY eg.id, eg.name, gm.role, gm.status;

-- 8. Verificar se há inconsistências
SELECT 
    'Inconsistências' as tipo,
    'Transações com group_id mas sem group_transaction' as problema,
    COUNT(*) as count
FROM financial_transactions ft
WHERE ft.group_id IS NOT NULL
  AND ft.amount < 0  -- Apenas despesas
  AND NOT EXISTS (
    SELECT 1 FROM group_transactions gt 
    WHERE gt.transaction_id = ft.id AND gt.group_id = ft.group_id
  )

UNION ALL

SELECT 
    'Inconsistências' as tipo,
    'Group transactions sem splits' as problema,
    COUNT(*) as count
FROM group_transactions gt
WHERE NOT EXISTS (
    SELECT 1 FROM group_expense_splits ges 
    WHERE ges.group_transaction_id = gt.id
);

SELECT '=== DIAGNÓSTICO COMPLETO ===' as resultado;