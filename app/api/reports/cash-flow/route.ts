// GET /api/reports/cash-flow?months=12&groupId=<uuid>
// GET /api/reports/cash-flow?de=AAAA-MM-DD&ate=AAAA-MM-DD&groupId=<uuid>
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
//
// AS DUAS FORMAS DE PERGUNTAR, E POR QUE NAO DA PARA TER SO UMA (HMO-173)
// -----------------------------------------------------------------------
// `?months=N` continua existindo e continua significando o que sempre
// significou: uma janela de N meses terminando no mes corrente. A tela de
// relatorios pergunta assim.
//
// `?de=&ate=` e o periodo escolhido no painel. Quando ele e uma uniao de meses
// INTEIROS, a resposta sai das mesmas views -- e tem que sair, senao o painel e
// o relatorio dariam numeros diferentes para o mesmo mes. Quando nao e (15/09 a
// 20/10, por exemplo), nenhum rollup mensal responde, e a soma passa a ser
// feita sobre `financial_transactions` recortada por data.
//
// Nesse segundo caminho, `months` volta VAZIO em vez de aproximado: um grafico
// mensal desenhado a partir de um intervalo que corta meses pela metade seria
// um grafico de meses que nao existiram. Quem consome olha `grao`.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { janelaDeMeses, completarMeses } from "@/lib/services/reports";
import {
  agregarTransacoes,
  mesesDoPeriodo,
  periodoDaQuery,
  ultimoDiaDoMes,
} from "@/lib/periodo-do-painel";

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
    const groupId = url.searchParams.get("groupId");

    // `de`/`ate` e o nome do par na URL do painel; `from`/`to` existe porque e
    // como uma rota HTTP costuma se chamar. Os dois apontam para o mesmo
    // parametro de proposito -- o que nao pode acontecer e alguem chamar com o
    // nome "errado" e receber, calado, o mes corrente.
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

    // ---------------------------------------------------------------------
    // Modo intervalo: nenhuma view responde, a soma vem das transacoes
    // ---------------------------------------------------------------------
    if (periodo && periodo.modo === "intervalo") {
      const base = supabase
        .from("financial_transactions")
        // `transaction_type` nao e decoracao: e ele que `agregarTransacoes`
        // usa para deixar as duas pernas de transferencia e de pagamento de
        // fatura FORA da conta, repetindo o filtro que
        // `category_monthly_totals` aplica no lado do banco.
        .select("amount, transaction_type")
        .gte("transaction_date", periodo.de)
        // `lte` e nao `lt`: o periodo e fechado nos dois extremos, e o ultimo
        // dia escolhido pelo usuario tem que entrar.
        .lte("transaction_date", periodo.ate);

      const { data, error } = groupId
        ? await base.eq("group_id", groupId)
        : await base.eq("user_id", user.id).is("group_id", null);

      if (error) {
        console.error("Erro no fluxo de caixa por intervalo:", error);
        return NextResponse.json(
          { error: "Não foi possível montar o relatório" },
          { status: 500 }
        );
      }

      const resumo = agregarTransacoes(data ?? []);

      return NextResponse.json({
        // Vazio de proposito -- ver o cabecalho do arquivo.
        months: [],
        grao: "intervalo",
        summary: {
          ...resumo,
          months_with_activity: resumo.transaction_count > 0 ? 1 : 0,
          average_expense: resumo.total_expense,
          average_income: resumo.total_income,
        },
        window: { from: periodo.de, to: periodo.ate, months: null },
      });
    }

    // ---------------------------------------------------------------------
    // Modo mes: as views do 008, como sempre foi
    // ---------------------------------------------------------------------
    const janela = periodo
      ? {
          inicio: `${periodo.de.slice(0, 7)}-01`,
          fim: `${periodo.ate.slice(0, 7)}-01`,
          meses: mesesDoPeriodo(periodo).length,
        }
      : janelaDeMeses(url.searchParams.get("months"));

    if (!janela) {
      return NextResponse.json(
        { error: "months deve ser um inteiro entre 1 e 60" },
        { status: 400 }
      );
    }

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
      grao: "mes",
      // O `to` e o ULTIMO DIA do ultimo mes, nao o dia 1 dele. `janela.fim` e
      // dia 1 por construcao (a chave das views e `date_trunc('month', ...)`),
      // e devolver isso como fim de janela ja cortou um mes inteiro de um
      // consumidor antes -- ver a nota em app/api/reports/export/route.ts.
      window: {
        from: janela.inicio,
        to: ultimoDiaDoMes(janela.fim),
        months: janela.meses,
      },
    });
  } catch (error) {
    console.error("Erro na API de relatórios:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
