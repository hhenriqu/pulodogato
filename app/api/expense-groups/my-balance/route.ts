import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { resumoDosGrupos, type SaldoDeGrupo } from "@/lib/grupos";

export const dynamic = "force-dynamic";

/**
 * Quanto eu devo (ou tenho a receber) somando TODOS os meus grupos (HMO-175).
 *
 * As rotas de grupo que ja existiam respondem sobre UM grupo e exigem saber
 * qual: `[groupId]/balances` e `[groupId]/transfers`. A tela de Financas
 * Pessoais nao sabe -- ela pergunta o contrario, "e no total?", e sem esta rota
 * teria que descobrir os meus grupos e bater numa rota por grupo, N+1
 * requisicoes para um numero so.
 *
 * POR QUE `user_id` NO FILTRO E NAO SO A RLS
 * ------------------------------------------
 * `group_member_balances` e uma view criada SEM `security_invoker` (007), entao
 * ela roda com os privilegios do dono e a RLS das tabelas de baixo NAO se
 * aplica. Um `select()` sem o `.eq("user_id", ...)` devolveria o saldo de todo
 * mundo, de todos os grupos do banco. As rotas por grupo se protegem checando a
 * participacao antes e filtrando por `group_id`; esta nao tem um grupo para
 * checar, entao o filtro por `user_id` e a unica coisa entre a resposta e o
 * saldo dos outros.
 *
 * GRUPO ARQUIVADO NAO ENTRA
 * -------------------------
 * A view so olha `group_members.status = 'active'`, o que nao diz nada sobre o
 * GRUPO: arquivar zera `is_active` em `expense_groups` e a participacao segue
 * ativa. Sem o cruzamento abaixo, a viagem de 2024 que foi arquivada com um
 * residuo de R$ 3 continuaria cobrando esses R$ 3 na tela principal, com um
 * link para um grupo que saiu da listagem.
 */
export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: linhas, error } = await supabase
      .from("group_member_balances")
      .select("group_id, total_paid, total_owed, net_balance")
      .eq("user_id", user.id);

    if (error) {
      console.error("Erro ao ler os saldos dos meus grupos:", error);
      return NextResponse.json(
        { error: "Failed to load group balances" },
        { status: 500 }
      );
    }

    const groupIds = (linhas || []).map((l: any) => l.group_id);

    // `in` com lista vazia devolve tudo em algumas versoes do PostgREST -- e
    // aqui "tudo" seria todo grupo ativo do banco. Sem grupo, nao ha consulta.
    const { data: grupos } = groupIds.length
      ? await supabase
          .from("expense_groups")
          .select("id, name")
          .in("id", groupIds)
          .eq("is_active", true)
      : { data: [] as { id: string; name: string }[] };

    const nomePor = new Map(
      (grupos || []).map((g: any) => [g.id as string, g.name as string])
    );

    const ativas: SaldoDeGrupo[] = (linhas || [])
      .filter((l: any) => nomePor.has(l.group_id))
      .map((l: any) => ({
        group_id: l.group_id,
        nome: nomePor.get(l.group_id),
        net_balance: Number(l.net_balance),
        total_paid: Number(l.total_paid),
        total_owed: Number(l.total_owed),
      }));

    // `grupos` vai junto, e nao so os do resumo: o resumo derruba os grupos
    // quitados (nao ha o que fazer com eles), mas a LISTA de lancamentos usa
    // este mapa para escrever o nome do grupo na linha da despesa. Sem os
    // quitados, a despesa de um grupo ja acertado perderia o rotulo e voltaria
    // a ser uma despesa pessoal qualquer na tela.
    return NextResponse.json({
      success: true,
      resumo: resumoDosGrupos(ativas),
      grupos: (grupos || []).map((g: any) => ({ id: g.id, name: g.name })),
    });
  } catch (error) {
    console.error("Erro em GET my-balance:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
