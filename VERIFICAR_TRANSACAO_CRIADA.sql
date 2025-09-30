-- 🔍 VERIFICAR SE TRANSAÇÃO COM GROUP_ID FOI CRIADA

-- 1. Ver transações mais recentes do usuário
SELECT 
    id,
    description,
    amount,
    group_id,
    is_shared,
    created_at,
    transaction_date
FROM financial_transactions 
WHERE user_id = '2a1107d1-81fe-45d3-bd16-ed5dad884285'
ORDER BY created_at DESC 
LIMIT 10;

-- 2. Ver se existe sincronização para o grupo "testess" (32e8d77e-86a0-4a5b-ad81-2fa6a553a76d)
SELECT 
    gt.id as group_transaction_id,
    gt.transaction_id,
    ft.description,
    ft.amount,
    gt.created_at as sync_created_at
FROM group_transactions gt
JOIN financial_transactions ft ON gt.transaction_id = ft.id
WHERE gt.group_id = '32e8d77e-86a0-4a5b-ad81-2fa6a553a76d'
ORDER BY gt.created_at DESC;

-- 3. Ver se existem splits para o grupo "testess"
SELECT 
    ges.id,
    ges.user_id,
    ges.amount,
    ft.description,
    gt.created_at
FROM group_expense_splits ges
JOIN group_transactions gt ON ges.group_transaction_id = gt.id
JOIN financial_transactions ft ON gt.transaction_id = ft.id
WHERE gt.group_id = '32e8d77e-86a0-4a5b-ad81-2fa6a553a76d'
ORDER BY gt.created_at DESC;

-- 4. Ver membros do grupo "testess"
SELECT 
    gm.user_id,
    p.email,
    gm.created_at as membro_desde
FROM group_members gm
LEFT JOIN profiles p ON gm.user_id = p.id
WHERE gm.group_id = '32e8d77e-86a0-4a5b-ad81-2fa6a553a76d'
AND gm.status = 'accepted';

-- 5. Status do problema atual
SELECT 
    'DIAGNÓSTICO COMPLETO:' as status,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM financial_transactions 
            WHERE user_id = '2a1107d1-81fe-45d3-bd16-ed5dad884285'
            AND group_id = '32e8d77e-86a0-4a5b-ad81-2fa6a553a76d'
            AND description LIKE '%Teste%'
        ) THEN '✅ Transação criada com group_id'
        ELSE '❌ Transação NÃO criada com group_id'
    END as transacao_status,
    
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM group_transactions gt
            JOIN financial_transactions ft ON gt.transaction_id = ft.id
            WHERE gt.group_id = '32e8d77e-86a0-4a5b-ad81-2fa6a553a76d'
            AND ft.description LIKE '%Teste%'
        ) THEN '✅ Sincronização criada'
        ELSE '❌ Sincronização NÃO criada'
    END as sincronizacao_status;