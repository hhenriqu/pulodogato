// =====================================================
// TESTE DIRETO DA API - Execute no Console do Navegador
// Copie e cole este código no Console (F12) da página
// =====================================================

// Função para testar a API diretamente
async function testarAPI() {
  console.log("🧪 INICIANDO TESTE DA API...");

  try {
    const response = await fetch("/api/expense-groups", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    console.log("📡 RESPOSTA DA API:", {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    });

    const data = await response.json();

    console.log("📊 DADOS RETORNADOS:", {
      groups: data.groups,
      groupsCount: data.groups?.length || 0,
      error: data.error,
    });

    if (data.groups && data.groups.length > 0) {
      data.groups.forEach((group, index) => {
        console.log(`🎯 GRUPO ${index + 1}:`, {
          id: group.id,
          name: group.name,
          group_code: group.group_code,
          creator: group.creator?.full_name,
          membersCount: group.members?.length || 0,
          members:
            group.members?.map((m) => ({
              id: m.id,
              role: m.role,
              status: m.status,
              userName: m.user?.full_name,
              userId: m.user?.id,
            })) || [],
        });
      });

      // Verificar se há algum grupo com menos de 2 membros
      const groupsWithFewMembers = data.groups.filter(
        (g) => (g.members?.length || 0) < 2
      );
      if (groupsWithFewMembers.length > 0) {
        console.warn(
          "⚠️ GRUPOS COM POUCOS MEMBROS:",
          groupsWithFewMembers.map((g) => ({
            name: g.name,
            membersCount: g.members?.length || 0,
          }))
        );
      }
    } else {
      console.log("❌ NENHUM GRUPO ENCONTRADO");
    }
  } catch (error) {
    console.error("💥 ERRO NO TESTE:", error);
  }
}

// Executar o teste
testarAPI();

// Instrução para o usuário
console.log(`
🔧 INSTRUÇÕES:
1. Execute o script SQL LIMPEZA_FINAL_RLS.sql no Supabase
2. Recarregue esta página 
3. Execute testarAPI() novamente
4. Verifique se os grupos mostram 2 membros em vez de 1
`);
