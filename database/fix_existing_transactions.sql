-- =====================================================
-- CORREÇÃO: Sincronizar Transações Existentes
-- Data: 29/09/2025
-- Descrição: Criar group_transactions e splits para transações existentes com group_id
-- =====================================================

-- Função para sincronizar transações existentes
CREATE OR REPLACE FUNCTION fix_existing_group_transactions()
RETURNS TEXT AS $$
DECLARE
    transaction_record RECORD;
    member_count INTEGER;
    split_amount DECIMAL(10,2);
    gt_id UUID;
    transactions_fixed INTEGER := 0;
    splits_created INTEGER := 0;
BEGIN
    -- Para cada transação com group_id que não tem group_transaction
    FOR transaction_record IN 
        SELECT ft.id, ft.group_id, ft.user_id, ABS(ft.amount) as amount, ft.description
        FROM financial_transactions ft
        WHERE ft.group_id IS NOT NULL 
          AND ft.amount < 0  -- Apenas despesas
          AND NOT EXISTS (
              SELECT 1 FROM group_transactions gt 
              WHERE gt.transaction_id = ft.id AND gt.group_id = ft.group_id
          )
    LOOP
        -- Verificar se o usuário ainda é membro do grupo
        IF EXISTS (
            SELECT 1 FROM group_members gm
            WHERE gm.group_id = transaction_record.group_id 
            AND gm.user_id = transaction_record.user_id 
            AND gm.status = 'active'
        ) THEN
            -- Criar group_transaction
            INSERT INTO group_transactions (group_id, transaction_id, split_type)
            VALUES (transaction_record.group_id, transaction_record.id, 'equal')
            RETURNING id INTO gt_id;
            
            transactions_fixed := transactions_fixed + 1;
            
            -- Contar membros ativos do grupo
            SELECT COUNT(*) INTO member_count
            FROM group_members gm 
            WHERE gm.group_id = transaction_record.group_id AND gm.status = 'active';
            
            -- Se há membros, criar splits
            IF member_count > 0 THEN
                split_amount := transaction_record.amount / member_count;
                
                -- Criar splits para todos os membros ativos
                INSERT INTO group_expense_splits (
                    group_transaction_id, 
                    member_id, 
                    amount, 
                    status
                )
                SELECT 
                    gt_id,
                    gm.id,
                    split_amount,
                    'pending'
                FROM group_members gm 
                WHERE gm.group_id = transaction_record.group_id AND gm.status = 'active';
                
                -- Contar splits criados para esta transação
                splits_created := splits_created + member_count;
                
                RAISE NOTICE 'Fixed transaction "%" with % splits', transaction_record.description, member_count;
            END IF;
        ELSE
            -- Se o usuário não é mais membro, limpar o group_id
            UPDATE financial_transactions 
            SET group_id = NULL 
            WHERE id = transaction_record.id;
            
            RAISE NOTICE 'Cleared group_id for transaction "%" (user not in group)', transaction_record.description;
        END IF;
    END LOOP;
    
    RETURN format('Correção concluída: %s group_transactions criados, %s splits criados', 
                  transactions_fixed, splits_created);
END;
$$ LANGUAGE plpgsql;

-- Executar a correção
SELECT fix_existing_group_transactions() as resultado;

-- Verificar o resultado
SELECT 
    'Verificação pós-correção' as tipo,
    COUNT(*) as count
FROM financial_transactions ft
WHERE ft.group_id IS NOT NULL
  AND ft.amount < 0
  AND EXISTS (
    SELECT 1 FROM group_transactions gt 
    WHERE gt.transaction_id = ft.id AND gt.group_id = ft.group_id
  );

SELECT 
    'Splits criados' as tipo,
    COUNT(*) as count
FROM group_expense_splits ges
JOIN group_transactions gt ON ges.group_transaction_id = gt.id
JOIN financial_transactions ft ON gt.transaction_id = ft.id;

-- Mostrar algumas transações corrigidas
SELECT 
    'Transações Corrigidas' as tipo,
    ft.id,
    ft.description,
    ft.amount,
    eg.name as group_name,
    gt.id as group_transaction_id,
    COUNT(ges.id) as splits_count
FROM financial_transactions ft
JOIN expense_groups eg ON ft.group_id = eg.id
JOIN group_transactions gt ON ft.id = gt.transaction_id AND gt.group_id = ft.group_id
LEFT JOIN group_expense_splits ges ON gt.id = ges.group_transaction_id
WHERE ft.amount < 0
GROUP BY ft.id, ft.description, ft.amount, eg.name, gt.id
ORDER BY ft.created_at DESC
LIMIT 10;

SELECT 'Correção de transações existentes concluída!' as status;