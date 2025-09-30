# Guia de Teste - Integração Finanças e Grupos

## Como Testar a Integração

### 1. Executar o Teste SQL

Execute o arquivo `test_financial_group_integration.sql` no Supabase SQL Editor para validar a integração no banco de dados:

```sql
-- Execute o arquivo completo: database/test_financial_group_integration.sql
```

### 2. Teste Manual na Aplicação

#### Passo 1: Executar a Migração

Primeiro, execute a migração para adicionar o campo `group_id`:

```sql
-- Execute: database/add_group_id_to_transactions.sql
ALTER TABLE financial_transactions
ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES expense_groups(id);

CREATE INDEX IF NOT EXISTS idx_financial_transactions_group_id
ON financial_transactions(group_id);
```

#### Passo 2: Criar um Grupo de Despesas

1. Vá para a seção de grupos de despesas
2. Crie um novo grupo (ex: "Teste Integração")
3. Adicione alguns membros ao grupo

#### Passo 3: Criar Transação Financeira Vinculada ao Grupo

1. Vá para Finanças Pessoais → Nova Transação
2. Preencha os dados da transação
3. Selecione o grupo criado no campo "Grupo" (se disponível na interface)
4. Salve a transação

#### Passo 4: Verificar Sincronização

Verifique se a transação aparece:

1. **No Grupo de Despesas:**

   - Vá para o grupo criado
   - Aba "Transações"
   - A transação deve aparecer aqui

2. **Nas Finanças de Outros Membros:**

   - Login com outro membro do grupo
   - Vá para Finanças Pessoais
   - A transação deve aparecer na lista (mesmo não sendo criada por esse usuário)

3. **No Balanço do Grupo:**
   - Vá para o grupo → Aba "Balanço"
   - Deve mostrar quem pagou e quem deve

### 3. APIs Atualizadas

As seguintes APIs foram modificadas para suportar a integração:

#### Finanças Pessoais

- **GET** `/api/personal-finance/transactions`
  - Agora inclui transações dos grupos do usuário
  - Mostra transações próprias + transações de grupos

#### Grupos de Despesas

- **GET** `/api/expense-groups/[groupId]/transactions`

  - Busca transações reais do banco de dados
  - Inclui informações do criador e splits

- **POST** `/api/expense-groups/[groupId]/transactions`

  - Cria transação financeira real
  - Vincula ao grupo via `group_transactions`
  - Cria splits automáticos entre membros

- **GET** `/api/expense-groups/[groupId]/balances`
  - Calcula balanços reais baseados nas transações
  - Mostra quem deve e quem tem a receber

### 4. Estrutura de Dados

#### Tabelas Modificadas/Criadas:

```sql
-- financial_transactions: adicionado group_id
ALTER TABLE financial_transactions
ADD COLUMN group_id uuid REFERENCES expense_groups(id);

-- group_transactions: vincula transações aos grupos
CREATE TABLE group_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES expense_groups(id),
  transaction_id uuid REFERENCES financial_transactions(id),
  created_by uuid REFERENCES profiles(id),
  split_type text DEFAULT 'equal',
  created_at timestamp DEFAULT now()
);

-- group_expense_splits: divisão das despesas
CREATE TABLE group_expense_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_transaction_id uuid REFERENCES group_transactions(id),
  member_id uuid REFERENCES group_members(id),
  amount decimal(10,2) NOT NULL,
  created_at timestamp DEFAULT now()
);
```

### 5. Fluxo Completo Esperado

1. **Usuário cria transação financeira com grupo:**

   - Transação salva em `financial_transactions` com `group_id`
   - Link criado em `group_transactions`
   - Splits criados em `group_expense_splits` (divisão igual entre membros)

2. **Transação aparece no grupo:**

   - API do grupo busca via `group_transactions`
   - Mostra detalhes da transação e splits

3. **Transação aparece para todos os membros:**

   - API de finanças pessoais inclui transações dos grupos do usuário
   - Cada membro vê a transação em suas finanças

4. **Balanços são calculados:**
   - Quem pagou vs. quem deve (baseado nos splits)
   - Balanço positivo = deve receber
   - Balanço negativo = deve pagar

### 6. Pontos de Atenção

- ✅ Migração do banco deve ser executada primeiro
- ✅ RLS (Row Level Security) deve permitir acesso às transações de grupo
- ✅ Interface pode precisar de ajustes para mostrar o campo grupo
- ✅ Validações de permissão estão implementadas nas APIs

### 7. Debug em Caso de Problemas

Se algo não funcionar, execute essas queries para debug:

```sql
-- Verificar se a migração foi aplicada
SELECT column_name FROM information_schema.columns
WHERE table_name = 'financial_transactions' AND column_name = 'group_id';

-- Verificar transações com grupo
SELECT ft.*, eg.name as group_name
FROM financial_transactions ft
LEFT JOIN expense_groups eg ON ft.group_id = eg.id
WHERE ft.group_id IS NOT NULL;

-- Verificar links grupo-transação
SELECT gt.*, ft.description, eg.name
FROM group_transactions gt
JOIN financial_transactions ft ON gt.transaction_id = ft.id
JOIN expense_groups eg ON gt.group_id = eg.id;
```
