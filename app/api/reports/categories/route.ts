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
import { lerPreferenciaDeMoeda, separarSeriePorMoeda } from "@/lib/moeda";
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
      .select("month, category_id, expense, income, transaction_count, currency")
      .gte("month", janela.inicio)
      .lte("month", janela.fim);

    // No relatorio de GRUPO nao se filtra por user_id: o ponto e ver o gasto
    // da viagem inteira, de todos os membros. A RLS ja garante que so os
    // membros enxergam essas linhas.
    query = groupId
      ? query.eq("group_id", groupId)
      : query.eq("user_id", user.id).is("group_id", null);

    const perfilPromessa = supabase
      .from("profiles")
      .select("preferences")
      .eq("id", user.id)
      .maybeSingle();

    const [{ data, error }, { data: perfil }] = await Promise.all([
      query,
      perfilPromessa,
    ]);

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

    // A MOEDA MUDA A ARITMETICA DAQUI, E MUDA A PORCENTAGEM (HMO-171)
    //
    // `category_monthly_totals` passou a ter a moeda no GRAO (022). Somar as
    // linhas de uma categoria sem olhar a moeda produz dois erros, e o segundo e
    // pior que o primeiro:
    //
    //   o gasto da categoria vira 1000 reais + 180 dolares = 1180;
    //   e o `share` -- a fatia da pizza -- e calculado sobre esse total, entao
    //   TODAS as porcentagens ficam erradas, inclusive as das categorias que so
    //   tem uma moeda. Uma pizza cujas fatias somam 100% e a evidencia mais
    //   convincente que existe de que a conta esta certa.
    //
    // Por isso o acumulado e por (categoria, MOEDA) e cada moeda tem o seu
    // proprio total e as suas proprias fatias.
    const moedaOficial = lerPreferenciaDeMoeda(perfil?.preferences).oficial;

    const blocos = separarSeriePorMoeda(
      linhas.map((l) => ({ ...l, currency: l.currency as string | null })),
      moedaOficial
    ).map((grupo) => {
      const acumulado = new Map<
        string,
        { expense: number; income: number; transaction_count: number }
      >();

      for (const l of grupo.linhas) {
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

      return {
        currency: grupo.moeda,
        symbol: grupo.simbolo,
        total_expense: Number(totalGasto.toFixed(2)),
        categories: Array.from(acumulado.entries())
          .map(([id, v]) => ({
            category_id: id,
            category: porId.get(id) ?? null,
            expense: Number(v.expense.toFixed(2)),
            income: Number(v.income.toFixed(2)),
            transaction_count: v.transaction_count,
            // fatia do gasto total DESTA MOEDA. Zero quando nao houve gasto: sem
            // o guarda, a divisao por zero daria NaN e o grafico de pizza sumiria
            // inteiro -- justamente no caso mais comum, o do mes que ainda nao
            // comecou.
            share: totalGasto > 0 ? Number((v.expense / totalGasto).toFixed(4)) : 0,
          }))
          .filter((c) => c.expense > 0 || c.income > 0)
          .sort((a, b) => b.expense - a.expense),
      };
    });

    // O bloco principal para quem le `categories` direto: a moeda oficial quando
    // ela tem movimento, senao a mais movimentada -- nunca "o BRL" fixo, que
    // devolveria lista vazia para um mes inteiro no exterior.
    const categoriasOrdenadas = blocos[0]?.categories ?? [];

    const principal = blocos[0];

    return NextResponse.json({
      categories: categoriasOrdenadas,
      currency: principal?.currency ?? moedaOficial,
      // Uma entrada por moeda com movimento. A tela mostra separado quando ha
      // mais de uma -- o pedido da parte 3 da issue.
      by_currency: blocos,
      multi_currency: blocos.length > 1,
      by_month: linhas.map((l) => ({
        month: String(l.month).slice(0, 10),
        category_id: l.category_id,
        category_name: porId.get(l.category_id)?.name ?? "Sem categoria",
        expense: Number(l.expense),
        income: Number(l.income),
        // A moeda vai na linha do grafico mes a mes tambem. Sem ela, a barra
        // empilhada soma reais com dolares na altura da coluna -- e uma barra nao
        // tem como mostrar que esta errada.
        currency: l.currency ?? "BRL",
      })),
      summary: {
        total_expense: principal?.total_expense ?? 0,
        category_count: categoriasOrdenadas.length,
      },
      window: { from: janela.inicio, to: janela.fim, months: janela.meses },
    });
  } catch (error) {
    console.error("Erro na API de relatórios:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
