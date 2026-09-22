// GET /api/reports/cash-flow?months=12&groupId=<uuid>
//
// Entrada, saida e resultado por mes. Sai de `monthly_cash_flow` (008), que
// por sua vez e um rollup de category_monthly_totals -- uma unica definicao de
// como o sinal e tratado, para o total do fluxo nunca discordar da soma das
// categorias.
//
// Sem `groupId` o relatorio e PESSOAL: filtra group_id IS NULL. Isso nao e
// detalhe de implementacao. Sem o filtro, a despesa da viagem que o usuario
// pagou entraria no fluxo de caixa dele com o valor CHEIO do hotel, e nao com
// a parte dele -- o mes pessoal fecharia no vermelho por causa de um dinheiro
// que os outros membros ja devolveram.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { janelaDeMeses, completarMeses } from "@/lib/services/reports";

interface LinhaFluxo {
  month: string;
  income: number;
  expense: number;
  net: number;
  transaction_count: number;
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
      .from("monthly_cash_flow")
      .select("month, income, expense, net, transaction_count")
      .eq("user_id", user.id)
      .gte("month", janela.inicio)
      .lte("month", janela.fim);

    query = groupId ? query.eq("group_id", groupId) : query.is("group_id", null);

    const { data, error } = await query.order("month", { ascending: true });

    if (error) {
      console.error("Erro no relatório de fluxo de caixa:", error);
      return NextResponse.json(
        { error: "Não foi possível montar o relatório" },
        { status: 500 }
      );
    }

    const linhas = completarMeses<LinhaFluxo>(
      (data ?? []).map((d) => ({
        month: String(d.month).slice(0, 10),
        income: Number(d.income),
        expense: Number(d.expense),
        net: Number(d.net),
        transaction_count: Number(d.transaction_count),
      })),
      janela.inicio,
      janela.meses,
      (mes) => ({
        month: mes,
        income: 0,
        expense: 0,
        net: 0,
        transaction_count: 0,
      })
    );

    const totalEntrada = linhas.reduce((s, l) => s + l.income, 0);
    const totalSaida = linhas.reduce((s, l) => s + l.expense, 0);

    // Media sobre os meses COM movimento, nao sobre a janela inteira: quem usa
    // o app ha dois meses e pede doze veria a media dividida por doze e
    // concluiria que gasta um sexto do que gasta.
    const mesesComMovimento = linhas.filter(
      (l) => l.transaction_count > 0
    ).length;

    return NextResponse.json({
      months: linhas,
      summary: {
        total_income: Number(totalEntrada.toFixed(2)),
        total_expense: Number(totalSaida.toFixed(2)),
        net: Number((totalEntrada - totalSaida).toFixed(2)),
        months_with_activity: mesesComMovimento,
        average_expense: mesesComMovimento
          ? Number((totalSaida / mesesComMovimento).toFixed(2))
          : 0,
        average_income: mesesComMovimento
          ? Number((totalEntrada / mesesComMovimento).toFixed(2))
          : 0,
      },
      window: { from: janela.inicio, to: janela.fim, months: janela.meses },
    });
  } catch (error) {
    console.error("Erro na API de relatórios:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
