// =============================================================================
// /api/casa/[groupId]/contas-conjuntas -- marcar uma conta MINHA como conjunta
// =============================================================================
//   GET    as minhas contas que podem virar conjuntas desta casa (todas, menos
//          cartao), cada uma dizendo se ja e.
//   PATCH  { accountId, conjunta: boolean } -- marca ou desmarca.
//
// Quem valida e o banco (trigger `trava_da_conta_conjunta`, 078): casa ativa,
// dono membro ativo, nada de cartao. A rota so filtra pelo dono, para a
// mensagem ser "conta nao encontrada" e nao um erro de policy.
// =============================================================================
import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("financial_accounts")
    .select("id, name, account_type, currency, current_balance, casa_id, is_active")
    .eq("user_id", user.id)
    .neq("account_type", "credit_card")
    .order("name", { ascending: true });

  if (error) {
    console.error("[casa] contas-conjuntas GET:", error);
    return NextResponse.json({ error: "Nao foi possivel ler as contas" }, { status: 500 });
  }

  return NextResponse.json({
    contas: (data ?? [])
      .filter((c) => c.is_active !== false)
      .map((c) => ({
        id: c.id,
        name: c.name,
        account_type: c.account_type,
        currency: c.currency,
        current_balance: Number(c.current_balance ?? 0),
        conjunta: c.casa_id === params.groupId,
        // Conjunta de OUTRA casa: a tela avisa em vez de mover calada.
        deOutraCasa: c.casa_id != null && c.casa_id !== params.groupId,
      })),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const corpo = await request.json().catch(() => null);
  if (!corpo || typeof corpo.accountId !== "string" || typeof corpo.conjunta !== "boolean") {
    return NextResponse.json(
      { error: "Envie { accountId, conjunta: true | false }" },
      { status: 400 }
    );
  }

  let consulta = supabase
    .from("financial_accounts")
    .update({ casa_id: corpo.conjunta ? params.groupId : null })
    .eq("id", corpo.accountId)
    .eq("user_id", user.id);
  // Desmarcar so desmarca DESTA casa.
  if (!corpo.conjunta) consulta = consulta.eq("casa_id", params.groupId);

  const { data, error } = await consulta.select("id, casa_id");

  if (error) {
    // 23514 = a trava da 078 (cartao, grupo que nao e casa, dono fora da casa).
    const status = error.code === "23514" || error.code === "42501" ? 400 : 500;
    if (status === 500) console.error("[casa] contas-conjuntas PATCH:", error);
    return NextResponse.json({ error: error.message }, { status });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Conta nao encontrada" }, { status: 404 });
  }
  return NextResponse.json({ id: data[0].id, conjunta: data[0].casa_id === params.groupId });
}
