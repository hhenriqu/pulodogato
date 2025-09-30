-- 🔍 VERIFICAR E CORRIGIR SCHEMA group_transactions

-- 1. Ver estrutura atual da tabela
\d group_transactions;

-- 2. Se a coluna created_by não existe, adicionar
ALTER TABLE group_transactions 
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);

-- 3. Verificar se a tabela group_expense_splits existe
\d group_expense_splits;

-- 4. Se não existe, criar
CREATE TABLE IF NOT EXISTS group_expense_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_transaction_id UUID NOT NULL REFERENCES group_transactions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id),
    amount DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Verificar estrutura final
\d group_transactions;
\d group_expense_splits;