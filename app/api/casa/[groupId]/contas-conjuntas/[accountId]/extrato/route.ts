// GET /api/casa/[groupId]/contas-conjuntas/[accountId]/extrato?mes=AAAA-MM
//
// Os lancamentos da conta conjunta no mes, de quem quer que tenha lancado, com
// o nome de quem lancou. Vem da funcao `extrato_da_conta_conjunta` (078),
// porque a tabela de lancamentos continua fechada por dono: abrir a policy
// dela mudaria numero em tela que soma sem filtrar `user_id`.
import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { intervaloDoMes, statusDoErroDaCasa } from "@/lib/resultado-da-casa";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { groupId: string; accountId: string } }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const periodo = intervaloDoMes(request.nextUrl.searchParams.get("mes"));
  const { data, error } = await supabase.rpc("extrato_da_conta_conjunta", {
    p_account_id: params.accountId,
    p_desde: periodo.desde,
    p_ate: periodo.ate,
  });
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: statusDoErroDaCasa(error) }
    );
  }

  return NextResponse.json({
    periodo,
    lancamentos: (data ?? []).map((l: Record<string, unknown>) => ({
      id: l.id,
      data: l.transaction_date,
      descricao: l.description,
      valor: Number(l.amount ?? 0),
      tipo: l.transaction_type,
      quem: l.quem,
      meu: l.user_id === user.id,
    })),
  });
}
