# 🧪 Teste Manual Rápido

## 🎯 Execute no Console do Navegador (F12)

### **1. Teste Criar Transação com Grupo**

Copie e cole este código no console:

```javascript
// Teste direto da API - Criar transação com grupo
async function testarSincronizacaoGrupo() {
  console.log("🧪 Iniciando teste de sincronização...");

  // Seus dados
  const grupoTestereaaa = "4661ff8c-6b43-48c0-881d-57bd36d9875d";
  const grupoTestess = "32e8d77e-86a0-4a5b-ad81-2fa6a553a76d";

  // 1. Buscar uma categoria de despesa
  console.log("📋 1. Buscando categorias...");
  const resCategories = await fetch("/api/personal-finance/categories");
  const categories = await resCategories.json();

  const categoryExpense = categories.categories?.find((c) => c.is_expense);

  if (!categoryExpense) {
    console.error("❌ Nenhuma categoria de despesa encontrada");
    return;
  }

  console.log("✅ Categoria encontrada:", categoryExpense.name);

  // 2. Criar transação com grupo
  const novaTransacao = {
    description: "🧪 Teste Sincronização " + new Date().getTime(),
    amount: 120.0,
    category_id: categoryExpense.id,
    transaction_date: new Date().toISOString().split("T")[0],
    group_id: grupoTestereaaa, // Grupo testereaaa
  };

  console.log("💰 2. Criando transação...", novaTransacao);

  const resTransaction = await fetch("/api/personal-finance/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(novaTransacao),
  });

  const transactionResult = await resTransaction.json();

  if (transactionResult.transaction) {
    console.log("✅ Transação criada:", transactionResult.transaction.id);

    // 3. Aguardar 2 segundos e verificar no grupo
    console.log("⏳ 3. Aguardando e verificando no grupo...");

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const resGroup = await fetch(
      "/api/expense-groups/" + grupoTestereaaa + "/transactions"
    );
    const groupResult = await resGroup.json();

    console.log("📊 Transações do grupo:", groupResult);

    const found = groupResult.transactions?.find(
      (t) => t.description && t.description.includes("Teste Sincronização")
    );

    if (found) {
      console.log("🎉 SUCESSO! Transação encontrada no grupo:", found);
    } else {
      console.log("❌ PROBLEMA: Transação NÃO encontrada no grupo");
      console.log("Total no grupo:", groupResult.transactions?.length || 0);
    }

    // 4. Verificar se aparece nas finanças pessoais
    console.log("💼 4. Verificando finanças pessoais...");

    const resPersonal = await fetch("/api/personal-finance/transactions");
    const personalResult = await resPersonal.json();

    const foundPersonal = personalResult.transactions?.find(
      (t) => t.description && t.description.includes("Teste Sincronização")
    );

    if (foundPersonal) {
      console.log("✅ Transação nas finanças:", {
        id: foundPersonal.id,
        description: foundPersonal.description,
        group_name: foundPersonal.group?.name || "SEM GRUPO",
      });
    } else {
      console.log("❌ Transação não encontrada nas finanças pessoais");
    }
  } else {
    console.error("❌ Erro ao criar transação:", transactionResult);
  }

  console.log("🏁 Teste concluído!");
}

// Executar o teste
testarSincronizacaoGrupo().catch(console.error);
```

### **2. Depois Execute o Debug**

```javascript
// Debug da sincronização
fetch("/api/debug/group-sync")
  .then((res) => res.json())
  .then((data) => {
    console.log("🔍 DEBUG SYNC:", data);

    if (data.details.inconsistencies.length > 0) {
      console.log("❌ INCONSISTÊNCIAS ENCONTRADAS:");
      data.details.inconsistencies.forEach((inc) => {
        console.log(`- ${inc.description} (ID: ${inc.transaction_id})`);
      });
    } else {
      console.log("✅ Nenhuma inconsistência");
    }
  })
  .catch(console.error);
```

## 📋 O que Esperar:

### ✅ **Se Funcionar:**

- Transação criada com sucesso
- Transação aparece no grupo imediatamente
- Transação nas finanças pessoais mostra grupo
- Debug sem inconsistências

### ❌ **Se Não Funcionar:**

- Execute os SQLs no Supabase:
  1. `create_sync_trigger.sql`
  2. `fix_existing_transactions.sql`
  3. `diagnostico_usuario_especifico.sql`

## 🔧 Próximos Passos:

Se o teste manual funcionar, o problema está apenas na **interface** não tendo campo para selecionar grupo.

Se não funcionar, o problema está na **lógica de sincronização** no backend.

**Execute o teste e me informe o resultado!** 🎯
