// GET /api/scheduled-transactions/summary?months=3
// GET /api/scheduled-transactions/summary?de=AAAA-MM-DD&ate=AAAA-MM-DD
//
// O numero que o app nao sabia responder antes: quanto ainda vai sair este mes.
// Serve o cabecalho da tela de contas e o widget do dashboard.
//
// A agregacao e feita aqui, em JavaScript, e nao com um GROUP BY: o PostgREST
// nao expoe agregacao sem criar uma RPC, e uma RPC nova significaria mais uma
// funcao SECURITY DEFINER para auditar (ver migrations 003 e 004). O volume e
// de dezenas de linhas por mes - cabe na memoria sem pensar duas vezes.
//
// ESTA ROTA NAO CONSEGUIA RESPONDER O PASSADO (HMO-173)
// ------------------------------------------------------
// Com `?months=N` a janela comeca no primeiro dia do mes CORRENTE e caminha
// para a frente. Isso e certo para "o que ainda vai sair", e e por isso que o
// painel, ao navegar para agosto, recebia uma lista que nao continha agosto --
// e mostrava zero. `de`/`ate` explicitos resolvem.
//
// O QUE A JANELA EXPLICITA NAO PODE FAZER
// ----------------------------------------
// NENHUMA DAS DUAS CONSULTAS FILTRA POR user_id (HMO-177)
// -------------------------------------------------------
// Isso e deliberado -- a RLS filtra --, mas as policies do 005 nao sao
// `user_id = auth.uid()` e mais nada: elas tambem liberam
// `group_id IS NOT NULL AND is_group_member(group_id)`. Entao a consulta sem
// filtro traz, junto com as minhas linhas, as linhas de GRUPO dos outros
// membros. Um aluguel de R$ 3.000 do grupo Casa aparecia inteiro para as duas
// pessoas: para quem cadastrou a regra e para quem nunca cadastrou nada.
// Por isso cada linha de grupo entra aqui pela parte de um membro -- ver
// lib/parte-do-grupo.ts, que tem a medicao e o controle negativo.
//
// `materializarAgenda` CRIA linhas de vencimento a partir das regras
// recorrentes. Rodar isso sobre um mes que ja passou fabricaria contas
// retroativas -- e, como elas nasceriam vencidas, o app passaria a acusar
// atraso em dividas que o usuario nunca teve. Navegar para tras e leitura; a
// janela de escrita sai de `janelaParaMaterializar`, que nunca comeca antes de
// hoje e devolve `null` quando o periodo inteiro ja passou.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { materializarAgenda } from "@/lib/services/scheduled";
import { addMonthsClamped, today } from "@/lib/recurrence";
import {
  contarMembrosAtivos,
  custoFixoMensalDaMinhaParte,
  parteDoMembro,
} from "@/lib/parte-do-grupo";
import { janelaParaMaterializar, periodoDaQuery } from "@/lib/periodo-do-painel";
import type { RecurringRule, ScheduledSummary } from "@/types/financial";

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const hoje = today();

    const periodo = periodoDaQuery(
      url.searchParams.get("de") ?? url.searchParams.get("from"),
      url.searchParams.get("ate") ?? url.searchParams.get("to")
    );

    if (periodo === "invalido") {
      return NextResponse.json(
        { error: "de e ate devem ser datas AAAA-MM-DD, com de <= ate" },
        { status: 400 }
      );
    }

    let de: string;
    let ate: string;

    if (periodo) {
      de = periodo.de;
      ate = periodo.ate;
    } else {
      const meses = Math.min(
        Math.max(Number(url.searchParams.get("months") ?? 3), 1),
        12
      );
      // Do primeiro dia do mes corrente ate o fim da janela: o resumo do mes
      // tem que incluir o que ja foi pago nos dias que passaram.
      de = `${hoje.slice(0, 7)}-01`;
      ate = addMonthsClamped(de, meses);
    }

    const aMaterializar = janelaParaMaterializar({ de, ate }, hoje);

    if (aMaterializar) {
      try {
        await materializarAgenda(supabase, user.id, aMaterializar);
      } catch (erroAgenda) {
        console.error("Resumo seguiu sem materializar a agenda:", erroAgenda);
      }
    }

    const { data: linhas, error } = await supabase
      .from("scheduled_transactions_effective")
      .select("due_date, amount, status, effective_status, group_id")
      .gte("due_date", de)
      .lte("due_date", ate);

    if (error) {
      console.error("Erro ao resumir contas previstas:", error);
      return NextResponse.json(
        { error: "Não foi possível calcular o resumo" },
        { status: 500 }
      );
    }

    const { data: regras } = await supabase
      .from("recurring_rules")
      .select("amount, frequency, interval_count, transaction_type, group_id")
      .eq("is_active", true);

    // Quantos membros ativos tem cada grupo que aparece nas duas consultas.
    // Sem isto a parte dos outros continua contando como minha - ver o cabecalho
    // de lib/parte-do-grupo.ts para a medicao que mostra o numero inflado.
    const gruposEnvolvidos = Array.from(
      new Set(
        [
          ...((regras ?? []) as { group_id?: string | null }[]),
          ...((linhas ?? []) as { group_id?: string | null }[]),
        ]
          .map((r) => r.group_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    let membrosAtivosPorGrupo: Map<string, number> = new Map();

    if (gruposEnvolvidos.length > 0) {
      const { data: membros, error: erroMembros } = await supabase
        .from("group_members")
        .select("group_id, status")
        .in("group_id", gruposEnvolvidos)
        .eq("status", "active");

      if (erroMembros) {
        // Sem a contagem, `parteDoMembro` mantem o valor CHEIO. Erra para cima,
        // que e o comportamento antigo, em vez de subestimar o custo fixo e
        // fazer o safe-to-spend prometer dinheiro que nao sobra.
        console.error(
          "Resumo seguiu sem dividir a parte do grupo:",
          erroMembros
        );
      } else {
        membrosAtivosPorGrupo = contarMembrosAtivos(membros ?? []);
      }
    }

    const custoFixoMensal = custoFixoMensalDaMinhaParte(
      (regras ?? []) as RecurringRule[],
      membrosAtivosPorGrupo,
      hoje
    );

    const porMes = new Map<string, ScheduledSummary>();

    for (const linha of linhas ?? []) {
      const mes = String(linha.due_date).slice(0, 7);
      const atual =
        porMes.get(mes) ??
        ({
          month: mes,
          total_pending: 0,
          total_overdue: 0,
          total_paid: 0,
          fixed_monthly_cost: Number(custoFixoMensal.toFixed(2)),
          count_pending: 0,
          count_overdue: 0,
        } as ScheduledSummary);

      // A linha de grupo entra pela MINHA parte. Nao e refinamento do custo
      // fixo: a policy do 005 devolve tambem as previstas de grupo dos OUTROS
      // membros, entao sem esta divisao a Lais via uma conta de R$ 3.000 no nome
      // do Helio somada ao "quanto ainda vai sair" dela.
      const valor = parteDoMembro(
        linha.amount,
        (linha as { group_id?: string | null }).group_id,
        membrosAtivosPorGrupo
      );

      if (linha.effective_status === "overdue") {
        atual.total_overdue += valor;
        atual.count_overdue += 1;
      } else if (linha.status === "pending") {
        atual.total_pending += valor;
        atual.count_pending += 1;
      } else if (linha.status === "paid") {
        atual.total_paid += valor;
      }

      porMes.set(mes, atual);
    }

    // Array.from em vez de spread: o tsconfig do projeto compila para ES5, onde
    // espalhar um iterador de Map exige --downlevelIteration.
    const resumo = Array.from(porMes.values())
      .map((m) => ({
        ...m,
        total_pending: Number(m.total_pending.toFixed(2)),
        total_overdue: Number(m.total_overdue.toFixed(2)),
        total_paid: Number(m.total_paid.toFixed(2)),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return NextResponse.json({
      summary: resumo,
      fixed_monthly_cost: Number(custoFixoMensal.toFixed(2)),
      range: { from: de, to: ate },
    });
  } catch (error) {
    console.error("Erro no resumo de contas previstas:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
