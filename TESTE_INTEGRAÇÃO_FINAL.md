# 🧪 Guia de Teste Completo - Integração Finanças + Grupos

## ✅ Status Atual

### Implementado:

- ✅ API `/api/expense-groups` carregando grupos corretamente
- ✅ Formulário `NewTransactionDialog.tsx` com campo de seleção de grupo
- ✅ API `/api/personal-finance/transactions` com sincronização automática
- ✅ Serviço `financial.ts` usando APIs HTTP (não Supabase direto)

### Grupos Disponíveis:

- **testereaaa** (ID: 4661ff8c-6b43-48c0-881d-57bd36d9875d)
- **testess** (ID: 32e8d77e-86a0-4a5b-ad81-2fa6a553a76d)

## 🎯 Teste 1: Interface Web

### Passos:

1. **Abrir** http://localhost:3000/dashboard
2. **Clicar** em "Nova Transação"
3. **Preencher**:
   - Descrição: "Teste integração - Pizza grupo"
   - Valor: 45.00
   - Tipo: Despesa
   - Categoria: qualquer categoria de despesa
   - **Grupo de Despesa**: selecionar "testereaaa"
4. **Submeter** o formulário
5. **Verificar** mensagem de sucesso

### Logs Esperados:

```
🚀 Enviando transação para API: {group_id: "4661ff8c-6b43-48c0-881d-57bd36d9875d", ...}
✅ Transação criada com sucesso: {transaction: {...}}
```

## 🧪 Teste 2: API Direct (Alternativo)

### Se o teste 1 falhar, usar:

```bash
curl -X POST http://localhost:3000/api/test/create-transaction \\
  -H "Content-Type: application/json" \\
  -b "sb-access-token=SEU_TOKEN"
```

## 🔍 Teste 3: Verificação no Banco

### Executar no Supabase:

```sql
-- 1. Ver transação criada
SELECT ft.id, ft.description, ft.amount, ft.group_id, ft.created_at
FROM financial_transactions ft
WHERE ft.user_id = '2a1107d1-81fe-45d3-bd16-ed5dad884285'
ORDER BY ft.created_at DESC
LIMIT 5;

-- 2. Ver se foi sincronizada no grupo
SELECT gt.*, ft.description, ft.amount
FROM group_transactions gt
JOIN financial_transactions ft ON gt.transaction_id = ft.id
WHERE gt.group_id = '4661ff8c-6b43-48c0-881d-57bd36d9875d'
ORDER BY gt.created_at DESC;

-- 3. Ver se criou splits automaticamente
SELECT ges.*, gm.user_id
FROM group_expense_splits ges
JOIN group_transactions gt ON ges.group_transaction_id = gt.id
JOIN group_members gm ON ges.member_id = gm.id
WHERE gt.group_id = '4661ff8c-6b43-48c0-881d-57bd36d9875d'
ORDER BY ges.created_at DESC;
```

## 🎯 Teste 4: Visualização no Grupo

### Passos:

1. **Ir** para `/dashboard/grupos/testereaaa`
2. **Verificar** se a transação aparece na lista
3. **Verificar** se o valor está dividido entre membros

## 📊 Indicadores de Sucesso

### ✅ Funcionando se:

- Transação aparece em finanças pessoais
- Transação aparece no grupo
- Group_transactions tem entrada
- Group_expense_splits criados automaticamente
- Outros membros veem a transação

### ❌ Com problema se:

- Erro 401/403 (autenticação)
- Erro 404 (categoria não encontrada)
- Erro 500 (falha na sincronização)
- Transação criada mas não aparece no grupo

## 🚀 Próximos Passos

1. **Executar Teste 1** (interface web)
2. Se funcionar: **marcar todo como completo** ✅
3. Se falhar: **usar Teste 2** e **debuggar**
4. **Executar scripts SQL** restantes no Supabase:
   - `create_sync_trigger.sql`
   - `fix_existing_transactions.sql`

A integração está **95% completa**! 🎉
