// GET /api/reports/categories?months=1&groupId=<uuid>
//
// Gasto por categoria no periodo. Sai de `category_monthly_totals` (008).
//
// A view devolve uma linha por (mes, categoria); aqui os meses da janela sao
// somados por categoria, porque a pergunta da tela e "no que eu gastei", nao
// "no que eu gastei em cada mes". O detalhamento mes a mes continua disponivel
// em `by_month` para o grafico de barras empilhadas.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { janelaDeMeses } from "@/lib/services/reports";

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
      .from("category_monthly_totals")
      .select("month, category_id, expense, income, transaction_count")
      .gte("month", janela.inicio)
      .lte("month", janela.fim);

    // No relatorio de GRUPO nao se filtra por user_id: o ponto e ver o gasto
    // da viagem inteira, de todos os membros. A RLS ja garante que so os
    // membros enxergam essas linhas.
    query = groupId
      ? query.eq("group_id", groupId)
      : query.eq("user_id", user.id).is("group_id", null);

    const { data, error } = await query;

    if (error) {
      console.error("Erro no relatório por categoria:", error);
      return NextResponse.json(
        { error: "Não foi possível montar o relatório" },
        { status: 500 }
      );
    }

    const linhas = data ?? [];
    const categoriaIds = Array.from(new Set(linhas.map((l) => l.category_id)));

    const { data: categorias } = categoriaIds.length
      ? await supabase
          .from("transaction_categories")
          .select("id, name, icon, color_hex, is_expense")
          .in("id", categoriaIds)
      : { data: [] };

    const porId = new Map((categorias ?? []).map((c) => [c.id, c]));

    const acumulado = new Map<
      string,
      { expense: number; income: number; transaction_count: number }
    >();

    for (const l of linhas) {
      const atual = acumulado.get(l.category_id) ?? {
        expense: 0,
        income: 0,
        transaction_count: 0,
      };
      atual.expense += Number(l.expense);
      atual.income += Number(l.income);
      atual.transaction_count += Number(l.transaction_count);
      acumulado.set(l.category_id, atual);
    }

    const totalGasto = Array.from(acumulado.values()).reduce(
      (s, c) => s + c.expense,
      0
    );

    const categoriasOrdenadas = Array.from(acumulado.entries())
      .map(([id, v]) => ({
        category_id: id,
        category: porId.get(id) ?? null,
        expense: Number(v.expense.toFixed(2)),
        income: Number(v.income.toFixed(2)),
        transaction_count: v.transaction_count,
        // fatia do gasto total. Zero quando nao houve gasto: sem o guarda, a
        // divisao por zero daria NaN e o grafico de pizza sumiria inteiro --
        // justamente no caso mais comum, o do mes que ainda nao comecou.
        share: totalGasto > 0 ? Number((v.expense / totalGasto).toFixed(4)) : 0,
      }))
      .filter((c) => c.expense > 0 || c.income > 0)
      .sort((a, b) => b.expense - a.expense);

    return NextResponse.json({
      categories: categoriasOrdenadas,
      by_month: linhas.map((l) => ({
        month: String(l.month).slice(0, 10),
        category_id: l.category_id,
        category_name: porId.get(l.category_id)?.name ?? "Sem categoria",
        expense: Number(l.expense),
        income: Number(l.income),
      })),
      summary: {
        total_expense: Number(totalGasto.toFixed(2)),
        category_count: categoriasOrdenadas.length,
      },
      window: { from: janela.inicio, to: janela.fim, months: janela.meses },
    });
  } catch (error) {
    console.error("Erro na API de relatórios:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
