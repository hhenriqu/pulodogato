# 🧪 Guia de Teste - Sincronização de Despesas com Grupos

## 📋 Cenários de Teste

### 1. 🆕 Criar Nova Despesa com Grupo

#### Teste via API:

```bash
POST /api/personal-finance/transactions
Content-Type: application/json

{
  "description": "Jantar no restaurante",
  "amount": 150.00,
  "category_id": "categoria-restaurante-id",
  "transaction_date": "2025-09-29",
  "notes": "Divisão entre amigos",
  "group_id": "grupo-amigos-id"
}
```

#### Resultado Esperado:

- ✅ Transação criada em `financial_transactions` com `group_id`
- ✅ `group_transaction` criado automaticamente
- ✅ `group_expense_splits` criados para todos os membros ativos
- ✅ Transação aparece na API do grupo
- ✅ Transação aparece nas finanças pessoais de todos os membros

---

### 2. ✏️ Editar Despesa Existente - Adicionar ao Grupo

#### Teste via API:

```bash
PATCH /api/personal-finance/transactions/[transaction-id]
Content-Type: application/json

{
  "group_id": "grupo-familia-id"
}
```

#### Resultado Esperado:

- ✅ Campo `group_id` atualizado na transação
- ✅ `group_transaction` criado automaticamente
- ✅ `group_expense_splits` criados para todos os membros
- ✅ Transação passa a aparecer no grupo
- ✅ Transação passa a aparecer nas finanças dos membros

---

### 3. 🔄 Mover Despesa Entre Grupos

#### Teste via API:

```bash
PATCH /api/personal-finance/transactions/[transaction-id]
Content-Type: application/json

{
  "group_id": "grupo-trabalho-id"
}
```

#### Resultado Esperado:

- ✅ `group_transaction` do grupo anterior removido
- ✅ `group_expense_splits` do grupo anterior removidos
- ✅ Novo `group_transaction` criado para o novo grupo
- ✅ Novos `group_expense_splits` criados
- ✅ Transação desaparece do grupo anterior
- ✅ Transação aparece no novo grupo

---

### 4. ❌ Remover Despesa do Grupo

#### Teste via API:

```bash
PATCH /api/personal-finance/transactions/[transaction-id]
Content-Type: application/json

{
  "group_id": null
}
```

#### Resultado Esperado:

- ✅ Campo `group_id` limpo na transação
- ✅ `group_transaction` removido
- ✅ `group_expense_splits` removidos
- ✅ Transação desaparece do grupo
- ✅ Transação permanece apenas nas finanças do criador

---

## 🔍 Verificações Manuais

### Passo 1: Verificar Dados no Banco

```sql
-- Verificar transação criada
SELECT ft.*, eg.name as group_name
FROM financial_transactions ft
LEFT JOIN expense_groups eg ON ft.group_id = eg.id
WHERE ft.description LIKE '%teste%';

-- Verificar group_transaction
SELECT gt.*, ft.description, eg.name
FROM group_transactions gt
JOIN financial_transactions ft ON gt.transaction_id = ft.id
JOIN expense_groups eg ON gt.group_id = eg.id;

-- Verificar splits criados
SELECT ges.*, gm.user_id, p.full_name
FROM group_expense_splits ges
JOIN group_members gm ON ges.member_id = gm.id
JOIN profiles p ON gm.user_id = p.id;
```

### Passo 2: Verificar APIs

#### Transações do Grupo:

```bash
GET /api/expense-groups/[group-id]/transactions
```

**Deve retornar**: Transação com informações do pagador e splits

#### Finanças Pessoais (Criador):

```bash
GET /api/personal-finance/transactions
```

**Deve retornar**: Transação criada pelo usuário

#### Finanças Pessoais (Outros Membros):

```bash
GET /api/personal-finance/transactions
```

**Deve retornar**: Transação do grupo nas finanças pessoais

#### Balanços do Grupo:

```bash
GET /api/expense-groups/[group-id]/balances
```

**Deve retornar**: Balanços corretos (pagador positivo, outros negativos)

---

## 🎯 Casos de Borda

### 1. **Usuário não é membro do grupo**

```bash
POST /api/personal-finance/transactions
{
  "description": "Teste",
  "amount": 100,
  "group_id": "grupo-nao-membro"
}
```

**Esperado**: Erro 403 - "User is not a member of the specified group"

### 2. **Receita com group_id**

```bash
POST /api/personal-finance/transactions
{
  "description": "Salário",
  "amount": 5000,
  "category_id": "categoria-receita-id",
  "group_id": "grupo-familia-id"
}
```

**Esperado**: Transação criada MAS sem `group_transaction` (apenas despesas são divididas)

### 3. **Grupo sem membros ativos**

- Criar transação em grupo onde todos os membros estão inativos
  **Esperado**: `group_transaction` criado mas sem `group_expense_splits`

### 4. **Editar valor da transação**

```bash
PATCH /api/personal-finance/transactions/[id]
{
  "amount": 200.00
}
```

**Esperado**: Splits reajustados automaticamente para o novo valor

---

## 📊 Validação de Balanços

### Cenário: Grupo com 3 membros, despesa de R$ 150

**Antes da transação:**

- Membro A: R$ 0,00
- Membro B: R$ 0,00
- Membro C: R$ 0,00

**Membro A paga R$ 150:**

**Depois da transação:**

- Membro A: +R$ 100,00 (pagou R$ 150, deve receber R$ 50 dos outros)
- Membro B: -R$ 50,00 (deve R$ 50 para A)
- Membro C: -R$ 50,00 (deve R$ 50 para A)

**Validação**: Soma dos balanços = 0 ✅

---

## 🚀 Scripts de Teste Automatizado

### Criar Transação de Teste:

```javascript
const testTransaction = {
  description: "Teste Sincronização " + Date.now(),
  amount: 150.0,
  category_id: "categoria-restaurante-id",
  transaction_date: new Date().toISOString().split("T")[0],
  group_id: "seu-grupo-id-aqui",
};

fetch("/api/personal-finance/transactions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(testTransaction),
})
  .then((res) => res.json())
  .then(console.log);
```

### Verificar se Apareceu no Grupo:

```javascript
fetch("/api/expense-groups/seu-grupo-id-aqui/transactions")
  .then((res) => res.json())
  .then((data) => {
    const found = data.transactions.find((t) =>
      t.description.includes("Teste Sincronização")
    );
    console.log(
      "Transação no grupo:",
      found ? "✅ Encontrada" : "❌ Não encontrada"
    );
  });
```

---

## ✅ Checklist Final

- [ ] **Criar transação com grupo** → Aparece no grupo e nas finanças de todos
- [ ] **Editar transação** → Adicionar/remover/trocar grupo funciona
- [ ] **Balanços corretos** → Quem pagou vs. quem deve
- [ ] **Validações de segurança** → Não permite grupos onde não é membro
- [ ] **Receitas ignoradas** → Apenas despesas são divididas
- [ ] **Trigger funcionando** → Sincronização automática no banco
- [ ] **APIs consistentes** → Todas as APIs retornam dados corretos

**Meta**: Quando você "lança uma finança e atrela ao grupo", ela **DEVE** aparecer no grupo E nas finanças de todos os membros! 🎯
