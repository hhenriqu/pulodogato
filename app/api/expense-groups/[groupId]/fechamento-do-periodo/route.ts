import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import {
  diaDeFechamento,
  periodoQueTerminaEm,
  proximoFechamento,
  fecharPeriodo,
  type FechamentoDoPeriodo,
  type Periodo,
} from "@/lib/fechamento-por-periodo";
import type { DivisaoDoPeriodo } from "@/lib/divisao-configurada";
import {
  lerMembrosComPeso,
  lerOQueNaoFechou,
  ultimoFimFechado,
} from "@/lib/services/fechamento-dos-grupos";
import {
  emAbertoPorMembro,
  paresDoAcerto,
  type ContaEmAberto,
} from "@/lib/acerto-do-fechamento";

export const dynamic = "force-dynamic";

/**
 * O FECHAMENTO DO GRUPO POR PERIODO, COMO O MEMBRO O VE (RN018, fase 2).
 *
 *   GET /api/expense-groups/{groupId}/fechamento-do-periodo
 *
 * Tres coisas, para a tela de configuracao do grupo:
 *
 *   1. o dia de fechamento e o periodo aberto (de quando a quando);
 *   2. a PREVIA: o que cada um pagaria ou receberia se o periodo aberto
 *      fechasse com o que ja foi lancado. E a mesma conta que o cron grava --
 *      `lerOQueNaoFechou` + `fecharPeriodo` --, com o cliente do usuario;
 *   3. os fechamentos ja gravados, com a foto de cada um;
 *   4. o que ainda esta em aberto das contas que os fechamentos geraram, e os
 *      Pix que quitam tudo (RN019.5). Vem de `contas_em_aberto_do_grupo`
 *      (068), porque a conta gerada e do membro e a RLS nao deixa um membro
 *      ler a do outro.
 *
 * Leitura so, pela RLS de membro. Quem grava e o cron, com a service_role.
 */
export async function GET(
  _request: Request,
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

    const { data: grupo, error: erroGrupo } = await supabase
      .from("expense_groups")
      .select("closing_day")
      .eq("id", groupId)
      .maybeSingle();

    if (erroGrupo) {
      console.error("Erro ao ler o dia de fechamento:", erroGrupo);
      return NextResponse.json(
        { error: "Não foi possível carregar o fechamento do grupo" },
        { status: 500 }
      );
    }

    const hoje = today();
    const dia = diaDeFechamento(grupo?.closing_day);

    const { data: fechamentos, error: erroFechamentos } = await supabase
      .from("group_closings")
      .select("id, period_start, period_end, total, members")
      .eq("group_id", groupId)
      .order("period_end", { ascending: false })
      .limit(12);

    if (erroFechamentos) {
      console.error("Erro ao ler os fechamentos do grupo:", erroFechamentos);
      return NextResponse.json(
        { error: "Não foi possível carregar o fechamento do grupo" },
        { status: 500 }
      );
    }

    // Sem dia de fechamento nao ha periodo aberto nem previa: o grupo nao fecha.
    let periodo: Periodo | null = null;
    let previa: FechamentoDoPeriodo | null = null;
    let divisao: DivisaoDoPeriodo | null = null;
    if (dia !== null) {
      const fimAnterior = await ultimoFimFechado(supabase, groupId);
      periodo = periodoQueTerminaEm(proximoFechamento(dia, hoje), fimAnterior);

      const [{ despesas, acertos }, membrosComPeso] = await Promise.all([
        lerOQueNaoFechou(supabase, groupId),
        lerMembrosComPeso(supabase, groupId),
      ]);
      divisao = membrosComPeso.divisao;
      previa = fecharPeriodo({
        despesas,
        acertos,
        membros: membrosComPeso.membros,
        fim: periodo.fim,
      });
    }

    const { data: contasEmAberto, error: erroEmAberto } = await supabase.rpc(
      "contas_em_aberto_do_grupo",
      { p_group_id: groupId }
    );

    if (erroEmAberto) {
      console.error("Erro ao ler as contas em aberto do grupo:", erroEmAberto);
      return NextResponse.json(
        { error: "Não foi possível carregar o fechamento do grupo" },
        { status: 500 }
      );
    }

    const abertas = (contasEmAberto ?? []) as ContaEmAberto[];
    const emAberto = emAbertoPorMembro(abertas);
    const pares = paresDoAcerto(abertas);

    // Os nomes de todo mundo que aparece na previa, nos fechamentos e no que
    // esta em aberto.
    const ids = new Set<string>();
    for (const m of previa?.membros ?? []) ids.add(m.user_id);
    for (const m of emAberto) ids.add(m.user_id);
    for (const f of fechamentos ?? []) {
      for (const m of (f.members as Array<{ user_id?: string }>) ?? []) {
        if (m.user_id) ids.add(m.user_id);
      }
    }

    const { data: perfis } = ids.size
      ? await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", Array.from(ids))
      : { data: [] as { id: string; full_name: string | null }[] };

    const nomes: Record<string, string | null> = {};
    for (const p of perfis ?? []) nomes[p.id] = p.full_name ?? null;

    return NextResponse.json({
      success: true,
      hoje,
      closing_day: dia,
      periodo,
      previa,
      divisao,
      fechamentos: fechamentos ?? [],
      em_aberto: emAberto,
      pares,
      nomes,
      viewer_user_id: user.id,
    });
  } catch (error) {
    console.error("Erro no fechamento do periodo do grupo:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
