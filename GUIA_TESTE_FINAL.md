# Guia de Teste Completo da Integração

## 1. Scripts para executar no Supabase (SQL Editor)

### Executar os scripts na seguinte ordem:

1. **create_sync_trigger.sql** - Criar trigger de sincronização automática
2. **fix_existing_transactions.sql** - Corrigir transações existentes
3. **diagnostico_usuario_especifico.sql** - Verificar dados do usuário

## 2. Teste da Interface (Novo Formulário)

O formulário `NewTransactionDialog.tsx` agora inclui:

✅ Campo de seleção de grupo de despesa
✅ Carregamento automático dos grupos do usuário
✅ Integração com API de criação de transações

### Como testar:

1. Abrir a aplicação no dashboard
2. Clicar em "Nova Transação"
3. Preencher os dados:
   - Descrição: "Teste com grupo"
   - Valor: 50.00
   - Categoria: qualquer
   - **Grupo de Despesa**: selecionar "testereaaa" ou "testess"
4. Submeter o formulário

## 3. Verificações Após o Teste

### No Supabase (SQL):

```sql
-- Verificar se a transação foi criada
SELECT ft.*, gt.group_id
FROM financial_transactions ft
LEFT JOIN group_transactions gt ON ft.id = gt.transaction_id
WHERE ft.user_id = '2a1107d1-81fe-45d3-bd16-ed5dad884285'
ORDER BY ft.created_at DESC;

-- Verificar se aparece no grupo
SELECT * FROM group_transactions
WHERE group_id = '4661ff8c-6b43-48c0-881d-57bd36d9875d'
ORDER BY created_at DESC;
```

### Na Interface:

1. Ir ao grupo "testereaaa"
2. Verificar se a transação aparece na lista
3. Verificar se outros membros podem ver a transação

## 4. Teste Manual via Console (Alternativo)

Se houver problemas na interface, usar o script do `TESTE_MANUAL_RAPIDO.md`.

## 5. Correções Aplicadas

✅ API endpoints corrigidos para incluir group_transactions
✅ Trigger automático de sincronização criado
✅ Interface do formulário atualizada com seleção de grupo
✅ Validação e tratamento de erros implementados

A integração entre finanças pessoais e grupos de despesa está agora completa!
