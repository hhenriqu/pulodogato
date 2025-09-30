-- 🔍 DIAGNÓSTICO COMPLETO - Table group_transactions

-- 1. Ver estrutura da tabela group_transactions
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'group_transactions' 
AND table_schema = 'public'
ORDER BY ordinal_position;

-- 2. Ver constraints da tabela
SELECT conname, contype, pg_get_constraintdef(oid) as constraint_def
FROM pg_constraint 
WHERE conrelid = 'public.group_transactions'::regclass;

-- 3. Ver triggers da tabela
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers 
WHERE event_object_table = 'group_transactions'
AND event_object_schema = 'public';

-- 4. Solução rápida: Adicionar created_by se não existe
ALTER TABLE group_transactions 
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);

-- 5. Verificar novamente
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'group_transactions' 
ORDER BY ordinal_position;