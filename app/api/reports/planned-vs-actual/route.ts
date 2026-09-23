// GET /api/reports/planned-vs-actual?months=6
//
// Previsto (a agenda de contas previstas da Fase 1) contra realizado (o que de
// fato saiu da conta), mes a mes. Sai de `planned_vs_actual` (008).
//
// Contar a conta paga nos dois lados nao e dupla contagem: previsto e o que
// estava na agenda, realizado e o que aconteceu. A diferenca entre os dois E o
// relatorio.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { janelaDeMeses, completarMeses } from "@/lib/services/reports";

interface LinhaPrevisto {
  month: string;
  planned_expense: number;
  planned_income: number;
  actual_expense: number;
  actual_income: number;
  expense_variance: number;
  pending_count: number;
  overdue_count: number;
}

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
    const janela = janelaDeMeses(url.searchParams.get("months"));

    if (!janela) {
      return NextResponse.json(
        { error: "months deve ser um inteiro entre 1 e 60" },
        { status: 400 }
      );
    }

    const groupId = url.searchParams.get("groupId");

    let query = supabase
      .from("planned_vs_actual")
      .select("*")
      .eq("user_id", user.id)
      .gte("month", janela.inicio)
      .lte("month", janela.fim);

    query = groupId ? query.eq("group_id", groupId) : query.is("group_id", null);

    const { data, error } = await query.order("month", { ascending: true });

    if (error) {
      console.error("Erro no relatório previsto x realizado:", error);
      return NextResponse.json(
        { error: "Não foi possível montar o relatório" },
        { status: 500 }
      );
    }

    const linhas = completarMeses<LinhaPrevisto>(
      (data ?? []).map((d) => ({
        month: String(d.month).slice(0, 10),
        planned_expense: Number(d.planned_expense),
        planned_income: Number(d.planned_income),
        actual_expense: Number(d.actual_expense),
        actual_income: Number(d.actual_income),
        expense_variance: Number(d.expense_variance),
        pending_count: Number(d.pending_count),
        overdue_count: Number(d.overdue_count),
      })),
      janela.inicio,
      janela.meses,
      (mes) => ({
        month: mes,
        planned_expense: 0,
        planned_income: 0,
        actual_expense: 0,
        actual_income: 0,
        expense_variance: 0,
        pending_count: 0,
        overdue_count: 0,
      })
    );

    const previsto = linhas.reduce((s, l) => s + l.planned_expense, 0);
    const realizado = linhas.reduce((s, l) => s + l.actual_expense, 0);

    // A aderencia so faz sentido nos meses em que houve previsao. Um mes sem
    // nenhuma conta na agenda entraria como 0% de aderencia e arrastaria a
    // media para baixo, sugerindo um descontrole que nao houve -- o usuario
    // apenas nao tinha cadastrado gastos fixos ainda.
    const mesesComPrevisao = linhas.filter((l) => l.planned_expense > 0);

    return NextResponse.json({
      months: linhas,
      summary: {
        total_planned_expense: Number(previsto.toFixed(2)),
        total_actual_expense: Number(realizado.toFixed(2)),
        variance: Number((realizado - previsto).toFixed(2)),
        months_with_plan: mesesComPrevisao.length,
        overdue_count: linhas.reduce((s, l) => s + l.overdue_count, 0),
      },
      window: { from: janela.inicio, to: janela.fim, months: janela.meses },
    });
  } catch (error) {
    console.error("Erro na API de relatórios:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
