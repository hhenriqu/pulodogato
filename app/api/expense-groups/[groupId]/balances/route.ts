import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Saldo de cada membro do grupo.
 *
 * Passou a ler a view `group_member_balances` (migration 007) em vez de
 * recalcular aqui. Tres coisas mudaram com isso:
 *
 *  1. Os ACERTOS entram na conta. Antes, registrar o pagamento nao mexia no
 *     saldo -- na verdade nem havia onde registrar, e a divida quitada
 *     continuava aparecendo para sempre.
 *  2. Uma consulta em vez de duas POR MEMBRO. A versao anterior rodava um
 *     `Promise.all` que refazia a mesma busca de group_transactions uma vez
 *     para cada membro, e depois filtrava em memoria.
 *  3. Rateio recusado deixou de contar como divida.
 *
 * E esta rota e a rota de transfers davam respostas DIFERENTES para "quanto eu
 * devo", porque cada uma implementava a regra do seu jeito. Agora as duas leem
 * a mesma view.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = params;

    const { data: membership } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { data: linhas, error } = await supabase
      .from("group_member_balances")
      .select(
        `
        user_id,
        member_id,
        total_paid,
        total_owed,
        settlements_paid,
        settlements_received,
        net_balance,
        paid_count,
        owed_count
      `
      )
      .eq("group_id", groupId);

    if (error) {
      console.error("Erro ao ler saldos do grupo:", error);
      return NextResponse.json(
        { error: "Failed to load balances" },
        { status: 500 }
      );
    }

    // A view nao carrega nome e foto (ela e sobre dinheiro). Um SELECT em
    // profiles resolve, e e uma consulta so para o grupo inteiro.
    const userIds = (linhas || []).map((l: any) => l.user_id);
    const { data: perfis } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", userIds.length > 0 ? userIds : [user.id]);

    const perfilPor = new Map((perfis || []).map((p: any) => [p.id, p]));

    const balances = (linhas || []).map((l: any) => ({
      member: perfilPor.get(l.user_id) || { id: l.user_id, full_name: null },
      balance: Number(l.net_balance),
      total_paid: Number(l.total_paid),
      total_owed: Number(l.total_owed),
      settlements_paid: Number(l.settlements_paid),
      settlements_received: Number(l.settlements_received),
      transactions_count: Number(l.paid_count) + Number(l.owed_count),
    }));

    // Grupo fechado soma zero: todo real pago a mais por um e um real pago a
    // menos por outro. Quando nao soma, e despesa sem rateio, rateio que nao
    // cobre 100% do valor, ou parte no nome de quem ja saiu do grupo -- ver a
    // nota de `residual` em lib/settlement.ts. A tela avisa em vez de exibir um
    // acerto que nunca fecha.
    const residualCents = balances.reduce(
      (acc, b) => acc + Math.round(b.balance * 100),
      0
    );

    return NextResponse.json({
      success: true,
      balances,
      residual: residualCents / 100,
      is_balanced: Math.abs(residualCents) <= 1,
    });
  } catch (error) {
    console.error("Erro em GET balances:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
