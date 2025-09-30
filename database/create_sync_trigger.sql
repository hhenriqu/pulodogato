-- =====================================================
-- TRIGGER: Sincronização Automática de Transações com Grupos
-- Data: 29/09/2025
-- Descrição: Criar trigger para sincronizar automaticamente transações com grupos
-- =====================================================

-- Função para sincronização automática
CREATE OR REPLACE FUNCTION sync_transaction_with_group()
RETURNS TRIGGER AS $$
DECLARE
    member_count INTEGER;
    split_amount DECIMAL(10,2);
    gt_id UUID;
BEGIN
    -- Se a transação tem group_id e é uma despesa (valor negativo)
    IF NEW.group_id IS NOT NULL AND NEW.amount < 0 THEN
        -- Verificar se já existe group_transaction para esta transação
        IF NOT EXISTS (
            SELECT 1 FROM group_transactions 
            WHERE transaction_id = NEW.id AND group_id = NEW.group_id
        ) THEN
            -- Criar group_transaction e obter ID
            INSERT INTO group_transactions (group_id, transaction_id, split_type)
            VALUES (NEW.group_id, NEW.id, 'equal')
            RETURNING id INTO gt_id;
            
            -- Contar membros ativos do grupo
            SELECT COUNT(*) INTO member_count
            FROM group_members 
            WHERE group_id = NEW.group_id AND status = 'active';
            
            -- Se há membros, criar splits
            IF member_count > 0 THEN
                split_amount := ABS(NEW.amount) / member_count;
                
                -- Criar splits automáticos para membros ativos
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
                WHERE gm.group_id = NEW.group_id AND gm.status = 'active';
                
                RAISE NOTICE 'Created group transaction and % splits for transaction %', member_count, NEW.id;
            END IF;
        END IF;
    -- Se group_id foi removido (apenas em UPDATE), limpar group_transactions relacionados
    ELSIF TG_OP = 'UPDATE' AND OLD.group_id IS NOT NULL AND (NEW.group_id IS NULL OR NEW.group_id != OLD.group_id) THEN
        DELETE FROM group_transactions 
        WHERE transaction_id = NEW.id AND group_id = OLD.group_id;
        
        RAISE NOTICE 'Removed group transaction for transaction %', NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Remover trigger existente se houver
DROP TRIGGER IF EXISTS trigger_sync_transaction_group ON financial_transactions;

-- Criar novo trigger
CREATE TRIGGER trigger_sync_transaction_group
    AFTER INSERT OR UPDATE ON financial_transactions
    FOR EACH ROW
    EXECUTE FUNCTION sync_transaction_with_group();

-- Teste do trigger
SELECT 'Trigger de sincronização criado com sucesso!' as status;