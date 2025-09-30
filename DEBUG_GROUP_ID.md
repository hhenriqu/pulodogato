# 🔍 DEBUG: group_id não está sendo enviado

## 🚨 Problema Identificado

No curl vemos que o POST não inclui `group_id`:

```json
{
  "description": "salario",
  "amount": -123123,
  // ... outros campos
  "is_shared": true
  // ❌ FALTA: "group_id": "4661ff8c-6b43-48c0-881d-57bd36d9875d"
}
```

## 🔍 Pontos de Verificação

### 1. Estado do Formulário

**Console deve mostrar:**

```javascript
📝 Novo estado formData: {
  group_id: "4661ff8c-6b43-48c0-881d-57bd36d9875d",
  // ... outros campos
}
```

### 2. Dados Enviados pelo Service

**Console deve mostrar:**

```javascript
🚀 Enviando transação para API: {
  group_id: "4661ff8c-6b43-48c0-881d-57bd36d9875d",
  // ... outros campos
}
```

### 3. Possíveis Causas

**A. FormData não tem group_id**

- Seleção do grupo não está salvando no estado
- Verificar se `updateField("group_id", value)` funciona

**B. Service não recebe group_id**

- Hook `createTransaction` não passa o campo
- Verificar se `transaction.group_id` está undefined

**C. API recebe mas não processa**

- Verificar se a API `/api/personal-finance/transactions` recebe o campo

## 🧪 Teste de Debug

### Passo 1: Verificar Estado do Form

```javascript
// No console do navegador após selecionar grupo
console.log("🔍 Estado atual do form:", formData);
console.log("🎯 Group ID específico:", formData.group_id);
```

### Passo 2: Interceptar Envio

```javascript
// Adicionar no formulário antes de createTransaction()
console.log("📤 Dados sendo enviados:", formData);
console.log("📋 Incluindo group_id:", formData.group_id);
```

### Passo 3: Verificar Network Tab

1. F12 → Network
2. Criar transação
3. Procurar POST para `/api/personal-finance/transactions`
4. Ver Request Payload

## 🎯 Teste Rápido

**Execute no console após selecionar grupo:**

```javascript
// Ver se o estado tem group_id
console.log(
  "FormData:",
  document.querySelector('[data-testid="form-data"]') || "Form não encontrado"
);

// Forçar log do estado (se disponível globalmente)
if (window.currentFormData) {
  console.log("Estado atual:", window.currentFormData);
}
```

## ✅ Solução Esperada

**Se funcionar corretamente, deve aparecer:**

```
🚀 Enviando transação para API: {
  "description": "salario",
  "amount": -123123,
  "group_id": "4661ff8c-6b43-48c0-881d-57bd36d9875d"  ← DEVE ESTAR AQUI
}
```

---

**Execute os testes de debug e me diga qual etapa está falhando! 🔍**
