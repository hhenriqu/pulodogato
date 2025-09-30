# 🔍 TESTE DEBUG - Rastrear group_id

## 📋 Status

- ✅ Logs adicionados no formulário
- ✅ Logs adicionados no hook
- ✅ Logs adicionados no service
- ✅ DEBUG visual adicionado

## 🧪 Teste Passo a Passo

### 1. Abrir Formulário

```
URL: http://localhost:3000/dashboard
Clique: "Nova Transação"
```

### 2. Verificar Debug Visual

**Deve aparecer:**

```
🔍 DEBUG: group_id = "undefined"
```

### 3. Selecionar Grupo

```
1. Clicar no dropdown "Grupo de Despesa"
2. Selecionar "testereaaa"
```

**Logs esperados no console:**

```javascript
🔄 Mudando grupo para: 4661ff8c-6b43-48c0-881d-57bd36d9875d
📋 Grupos disponíveis: [...]
🔄 Atualizando campo group_id: 4661ff8c-6b43-48c0-881d-57bd36d9875d
📝 Novo estado formData: {group_id: "4661ff8c...", ...}
```

**Debug visual deve mudar para:**

```
🔍 DEBUG: group_id = "4661ff8c-6b43-48c0-881d-57bd36d9875d"
```

### 4. Preencher Formulário

```
Descrição: "Teste debug group"
Valor: 50.00
Data: hoje
Categoria: qualquer categoria de despesa
```

**Verificar se debug visual mantém:**

```
🔍 DEBUG: group_id = "4661ff8c-6b43-48c0-881d-57bd36d9875d"
```

### 5. Submeter Formulário

```
Clicar em "Criar Transação"
```

**Logs esperados (ordem):**

```javascript
// 1. Do formulário
📤 ENVIANDO DADOS PARA createTransaction: {group_id: "4661ff8c...", ...}
🎯 Group ID no momento do envio: 4661ff8c-6b43-48c0-881d-57bd36d9875d
📋 Campos completos: ["description", "amount", ..., "group_id"]

// 2. Do hook
🔗 HOOK recebeu dados: {group_id: "4661ff8c...", ...}
🎯 Group ID no hook: 4661ff8c-6b43-48c0-881d-57bd36d9875d

// 3. Do service
🚀 Enviando transação para API: {group_id: "4661ff8c...", ...}
```

### 6. Verificar Network Tab

```
F12 → Network → Procurar POST /api/personal-finance/transactions
Ver Request Payload deve incluir:
"group_id": "4661ff8c-6b43-48c0-881d-57bd36d9875d"
```

## 🚨 Pontos de Falha

### ❌ Se group_id sempre "undefined":

- Campo não está salvando no estado
- Problema na função updateField

### ❌ Se perde no caminho do hook:

- Problema na passagem de dados
- Hook não está recebendo o campo

### ❌ Se perde no service:

- Service está filtrando o campo
- Problema na montagem do requestData

### ❌ Se não aparece no Network:

- API não está recebendo
- Problema no fetch/JSON.stringify

## ✅ Sucesso Esperado

**Toda a cadeia deve mostrar:**

```
FormData → Hook → Service → API → Network
   ✅        ✅       ✅       ✅       ✅
```

---

**Execute o teste e me diga em qual ponto falha! 🔍**
