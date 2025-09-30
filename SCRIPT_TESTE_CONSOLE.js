/* 
🧪 SCRIPT DE TESTE - INTEGRAÇÃO GRUPOS
Execute este código no console do navegador (F12 → Console)
*/

console.log("🧪 Iniciando teste de integração...");

// 1. Testar API de grupos
async function testarGrupos() {
  try {
    console.log("📋 Testando API de grupos...");
    const response = await fetch("/api/expense-groups");
    const data = await response.json();

    if (response.ok) {
      console.log("✅ API grupos funcionando:", data);
      console.log(
        `📊 ${data.groupsCount} grupos encontrados:`,
        data.groups?.map((g) => g.name)
      );
    } else {
      console.error("❌ Erro na API grupos:", data);
    }
  } catch (error) {
    console.error("❌ Erro ao testar grupos:", error);
  }
}

// 2. Testar API de categorias
async function testarCategorias() {
  try {
    console.log("📂 Testando categorias...");
    const response = await fetch("/api/personal-finance/categories");
    const data = await response.json();

    if (response.ok) {
      console.log(
        "✅ Categorias funcionando:",
        data?.categories?.length || 0,
        "categorias"
      );
    } else {
      console.error("❌ Erro nas categorias:", data);
    }
  } catch (error) {
    console.error("❌ Erro ao testar categorias:", error);
  }
}

// 3. Simular criação de transação com grupo
async function testarCriacaoTransacao() {
  const transacaoTeste = {
    description: "Teste integração - Console",
    amount: 25.5,
    transaction_date: new Date().toISOString().split("T")[0],
    category_id: "categoria_teste", // Você precisa usar uma categoria real
    group_id: "4661ff8c-6b43-48c0-881d-57bd36d9875d", // testereaaa
    transaction_type: "expense",
    notes: "Teste via console do navegador",
  };

  try {
    console.log("💳 Testando criação de transação...");
    console.log("📝 Dados enviados:", transacaoTeste);

    const response = await fetch("/api/personal-finance/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(transacaoTeste),
    });

    const result = await response.json();

    if (response.ok) {
      console.log("✅ Transação criada com sucesso!");
      console.log("📄 Resultado:", result);
    } else {
      console.log("❌ Erro ao criar transação:", result);
    }
  } catch (error) {
    console.error("❌ Erro no teste de transação:", error);
  }
}

// 4. Executar todos os testes
async function executarTodos() {
  console.log("🚀 Executando bateria de testes...");
  await testarGrupos();
  await testarCategorias();

  console.log("\n⚠️ Para testar criação de transação:");
  console.log("1. Primeiro obtenha uma category_id real das categorias acima");
  console.log("2. Execute: testarCriacaoTransacao()");
}

// Executar automaticamente
executarTodos();

// Disponibilizar funções globalmente
window.testarGrupos = testarGrupos;
window.testarCategorias = testarCategorias;
window.testarCriacaoTransacao = testarCriacaoTransacao;

console.log("\n🎯 Funções disponíveis:");
console.log("- testarGrupos()");
console.log("- testarCategorias()");
console.log("- testarCriacaoTransacao()");
