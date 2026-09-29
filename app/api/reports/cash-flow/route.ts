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
  agregarTransacoesPorMoeda,
  mesesDoPeriodo,
  periodoDaQuery,
  ultimoDiaDoMes,
} from "@/lib/periodo-do-painel";
import { lerPreferenciaDeMoeda, separarSeriePorMoeda } from "@/lib/moeda";

interface LinhaFluxo {
  month: string;
  income: number;
  expense: number;
  net: number;
  transaction_count: number;
}

/** Quantas linhas por ida ao banco, na agregacao por intervalo. */
const TAMANHO_DA_PAGINA = 1000;

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
      // A consulta e remontada a cada pagina: o builder do supabase-js e de uso
      // unico, e reaproveitar o mesmo objeto acumularia os `.range()`.
      const pagina = (inicio: number) => {
        const base = supabase
          .from("financial_transactions")
          // `transaction_type` nao e decoracao: e ele que `agregarTransacoes`
          // usa para deixar as duas pernas de transferencia e de pagamento de
          // fatura FORA da conta, repetindo o filtro que
          // `category_monthly_totals` aplica no lado do banco.
          //
          // `currency` e o que impede este caminho de refazer, no JavaScript, a
          // mistura que a 022 tirou das views: sem ela, um periodo com gasto em
          // real e em dolar volta 1000 + 180 = 1180.
          .select("amount, transaction_type, currency")
          .gte("transaction_date", periodo.de)
          // `lte` e nao `lt`: o periodo e fechado nos dois extremos, e o ultimo
          // dia escolhido pelo usuario tem que entrar.
          .lte("transaction_date", periodo.ate)
          // Ordem estavel: sem ela, duas paginas podem repetir e pular linhas.
          .order("id", { ascending: true })
          .range(inicio, inicio + TAMANHO_DA_PAGINA - 1);

        return groupId
          ? base.eq("group_id", groupId)
          : base.eq("user_id", user.id).is("group_id", null);
      };

      // ------------------------------------------------------------------
      // POR QUE PAGINAR, SE NENHUMA OUTRA ROTA DESTE REPOSITORIO PAGINA
      // ------------------------------------------------------------------
      // Porque este e o unico lugar onde a SOMA e feita no JavaScript sobre
      // as linhas cruas. O PostgREST tem teto de linhas por resposta; batendo
      // nele, a resposta vem truncada e sem erro nenhum -- o total do periodo
      // sairia MENOR que o real, com cara de numero certo. Nos caminhos que
      // usam as views do 008 isso nao existe: quem soma e o banco, e a
      // resposta ja vem agregada em poucas linhas.
      const linhas: {
        amount: number | string;
        transaction_type: string;
        currency?: string | null;
      }[] = [];

      // A moeda oficial decide qual bloco e o PRINCIPAL, igual ao caminho
      // mensal. Erro aqui cai no padrao de `lerPreferenciaDeMoeda` e nao custa
      // o relatorio.
      const { data: perfilDoIntervalo } = await supabase
        .from("profiles")
        .select("preferences")
        .eq("id", user.id)
        .maybeSingle();

      const moedaDoIntervalo = lerPreferenciaDeMoeda(
        perfilDoIntervalo?.preferences
      ).oficial;

      for (let inicio = 0; ; inicio += TAMANHO_DA_PAGINA) {
        const { data, error } = await pagina(inicio);

        if (error) {
          console.error("Erro no fluxo de caixa por intervalo:", error);
          return NextResponse.json(
            { error: "Não foi possível montar o relatório" },
            { status: 500 }
          );
        }

        const lote = data ?? [];
        for (const linha of lote) linhas.push(linha);
        // Pagina incompleta = acabou. Uma pagina cheia pode ser a ultima, e
        // nesse caso a proxima volta vazia e o laco encerra do mesmo jeito.
        if (lote.length < TAMANHO_DA_PAGINA) break;
      }

      const blocosDoIntervalo = agregarTransacoesPorMoeda(
        linhas,
        moedaDoIntervalo
      );

      // O bloco principal, pela mesma regra do caminho mensal: a moeda oficial
      // quando ela tem movimento, senao a mais movimentada. Periodo sem
      // movimento nenhum nao produz bloco, e a resposta sai zerada na oficial.
      const principalDoIntervalo = blocosDoIntervalo[0] ?? {
        currency: moedaDoIntervalo,
        symbol: "",
        summary: {
          total_income: 0,
          total_expense: 0,
          net: 0,
          transaction_count: 0,
        },
      };

      const comMedias = (resumo: typeof principalDoIntervalo.summary) => ({
        ...resumo,
        // O intervalo e UM balde, nao uma serie de meses: a media de um periodo
        // unico e o proprio total. Dividir por uma contagem de meses aqui daria
        // um numero que nao corresponde a nada na tela.
        months_with_activity: resumo.transaction_count > 0 ? 1 : 0,
        average_expense: resumo.total_expense,
        average_income: resumo.total_income,
      });

      return NextResponse.json({
        // Vazio de proposito -- ver o cabecalho do arquivo.
        months: [],
        grao: "intervalo",
        currency: principalDoIntervalo.currency,
        by_currency: blocosDoIntervalo.map((bloco) => ({
          currency: bloco.currency,
          symbol: bloco.symbol,
          // Sem `months`: neste grao nao ha serie mensal para desenhar, e
          // inventar uma seria um grafico de meses que nao existiram.
          months: [],
          summary: comMedias(bloco.summary),
        })),
        multi_currency: blocosDoIntervalo.length > 1,
        summary: comMedias(principalDoIntervalo.summary),
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
      .select("month, income, expense, net, transaction_count, currency")
      .eq("user_id", user.id)
      .gte("month", janela.inicio)
      .lte("month", janela.fim);

    query = groupId ? query.eq("group_id", groupId) : query.is("group_id", null);

    // A moeda oficial decide qual bloco e o PRINCIPAL da resposta. Lida em
    // paralelo com o relatorio, e sem derrubar nada quando falha: ela so ordena
    // blocos, e um erro aqui nao pode custar o relatorio inteiro. Perfil ausente
    // ou `error` cai no padrao de `lerPreferenciaDeMoeda`.
    const perfilPromessa = supabase
      .from("profiles")
      .select("preferences")
      .eq("id", user.id)
      .maybeSingle();

    const [{ data, error }, { data: perfil }] = await Promise.all([
      query.order("month", { ascending: true }),
      perfilPromessa,
    ]);

    if (error) {
      console.error("Erro no relatório de fluxo de caixa:", error);
      return NextResponse.json(
        { error: "Não foi possível montar o relatório" },
        { status: 500 }
      );
    }

    // A MOEDA MUDA A ARITMETICA DAQUI (HMO-171)
    //
    // `monthly_cash_flow` passou a ter a moeda no GRAO (022): onde antes vinha
    // uma linha por mes, agora vem uma por (mes, moeda). Os `reduce` abaixo eram
    // somas sobre meses e viraram somas entre MOEDAS -- 1000 reais com 180
    // dolares dando 1180, que nao esta em moeda nenhuma, com cara de total e
    // para MAIS.
    //
    // A correcao nao e converter (nao ha cotacao neste app, e a issue pede para
    // mostrar SEPARADO): a serie e separada por moeda e a aritmetica que ja
    // existia roda uma vez por moeda, intacta.
    const moedaOficial = lerPreferenciaDeMoeda(perfil?.preferences).oficial;

    const porMoeda = separarSeriePorMoeda(
      (data ?? []).map((d) => ({
        month: String(d.month).slice(0, 10),
        income: Number(d.income),
        expense: Number(d.expense),
        net: Number(d.net),
        transaction_count: Number(d.transaction_count),
        currency: d.currency as string | null,
      })),
      moedaOficial
    );

    const blocos = porMoeda.map((grupo) => {
      const linhas = completarMeses<LinhaFluxo>(
        grupo.linhas.map((l) => ({
          month: l.month,
          income: l.income,
          expense: l.expense,
          net: l.net,
          transaction_count: l.transaction_count,
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
      //
      // "Com movimento NESTA MOEDA": um mes sem nenhum lancamento em dolar nao
      // entra na media do dolar, senao a media em dolar de quem gastou num mes
      // so sairia dividida pelos doze da janela.
      const mesesComMovimento = linhas.filter(
        (l) => l.transaction_count > 0
      ).length;

      return {
        currency: grupo.moeda,
        symbol: grupo.simbolo,
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
      };
    });

    // O bloco PRINCIPAL, para as telas que leem `months` e `summary` direto.
    //
    // E o primeiro de `separarSeriePorMoeda`: a moeda oficial quando ela tem
    // movimento, senao a mais movimentada. Nao e "o BRL": um mes inteiro no
    // exterior tem so dolar, e fixar reais aqui devolveria uma serie de zeros
    // para quem gastou -- dinheiro desaparecendo da tela.
    //
    // Periodo sem movimento nenhum nao tem bloco: aqui a serie e a de meses
    // vazios na moeda oficial, que e o que a tela ja sabia desenhar.
    const principal = blocos[0] ?? {
      currency: moedaOficial,
      symbol: "",
      months: completarMeses<LinhaFluxo>([], janela.inicio, janela.meses, (mes) => ({
        month: mes,
        income: 0,
        expense: 0,
        net: 0,
        transaction_count: 0,
      })),
      summary: {
        total_income: 0,
        total_expense: 0,
        net: 0,
        months_with_activity: 0,
        average_expense: 0,
        average_income: 0,
      },
    };

    return NextResponse.json({
      months: principal.months,
      currency: principal.currency,
      // A lista COMPLETA, uma entrada por moeda com movimento. A tela mostra
      // separado quando ela tem mais de uma -- que e o pedido da parte 3.
      by_currency: blocos,
      multi_currency: blocos.length > 1,
      summary: {
        ...principal.summary,
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
