// =============================================================================
// GET /api/casa/[groupId]?mes=AAAA-MM -- a visao da casa (migration 078)
// =============================================================================
// Os membros (com o dependente), o Resultado do mes somado de quem compartilha
// -- ja sem a divida de um membro com o outro, ver lib/resultado-da-casa.ts --
// e onde o dinheiro da casa esta hoje (conta conjunta + total de cada um).
//
// As tres leituras sao funcoes DEFINER do banco que checam sozinhas se quem
// pergunta e membro ativo de uma casa ativa: 403 se nao e membro, 404 se o
// grupo nao e casa. A rota nao repete essa checagem, so traduz o erro.
// =============================================================================
import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  intervaloDoMes,
  resumirACasa,
  resumirSaldos,
  statusDoErroDaCasa,
  type LinhaDoResultadoDaCasa,
  type MembroDaCasa,
  type SaldoDaCasa,
} from "@/lib/resultado-da-casa";
import { lerMoedaOficial } from "@/lib/services/resultado-do-mes";

export const dynamic = "force-dynamic";

export async function GET(
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

  const { groupId } = params;
  const periodo = intervaloDoMes(request.nextUrl.searchParams.get("mes"));

  const { data: grupo } = await supabase
    .from("expense_groups")
    .select("id, name, group_kind, closing_day, currency")
    .eq("id", groupId)
    .maybeSingle();

  // Os membros primeiro: e a leitura que diz 403/404 com motivo.
  const membros = await supabase.rpc("membros_da_casa", { p_group_id: groupId });
  if (membros.error) {
    return NextResponse.json(
      { error: membros.error.message },
      { status: statusDoErroDaCasa(membros.error) }
    );
  }

  const [resultado, saldos, moeda] = await Promise.all([
    supabase.rpc("resultado_da_casa", {
      p_group_id: groupId,
      p_desde: periodo.desde,
      p_ate: periodo.ate,
    }),
    supabase.rpc("saldos_da_casa", { p_group_id: groupId }),
    lerMoedaOficial(supabase, user.id),
  ]);

  if (resultado.error) {
    console.error("[casa] resultado_da_casa:", resultado.error);
    return NextResponse.json(
      { error: "Nao foi possivel ler o mes da casa" },
      { status: statusDoErroDaCasa(resultado.error) }
    );
  }
  if (saldos.error) {
    console.error("[casa] saldos_da_casa:", saldos.error);
    return NextResponse.json(
      { error: "Nao foi possivel ler os saldos da casa" },
      { status: statusDoErroDaCasa(saldos.error) }
    );
  }

  const listaDeMembros = (membros.data ?? []) as MembroDaCasa[];

  return NextResponse.json({
    grupo,
    periodo,
    moeda,
    membros: listaDeMembros,
    resultado: resumirACasa(
      (resultado.data ?? []) as LinhaDoResultadoDaCasa[],
      listaDeMembros,
      moeda
    ),
    saldos: resumirSaldos((saldos.data ?? []) as SaldoDaCasa[], listaDeMembros, moeda),
  });
}
