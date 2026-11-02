// GET /api/reports/cash-flow?months=12&groupId=<uuid>
// GET /api/reports/cash-flow?de=AAAA-MM-DD&ate=AAAA-MM-DD&groupId=<uuid>
// GET /api/reports/cash-flow?de=&ate=&faturaAte=        <- o painel (fase 6)
//
// Entrada, saida e resultado por mes. Sai de `monthly_cash_flow` (008), que
// por sua vez e um rollup de category_monthly_totals -- uma unica definicao de
// como o sinal e tratado, para o total do fluxo nunca discordar da soma das
// categorias.
//
// Sem `groupId` o relatorio e PESSOAL: o que e so do usuario MAIS a parte dele
// das despesas que OUTRO pagou.
//
// O CRITERIO DO CUSTO PESSOAL: BRUTO + REEMBOLSO (HMO-258, HMO-418)
// -----------------------------------------------------------------
// Ate a 033 este caminho filtrava `group_id IS NULL`, e o efeito era que a
// despesa de grupo nao aparecia no painel pessoal de NINGUEM -- nem de quem
// pagou (0,00 medido), nem de quem devia a parte (0,00 medido).
//
// A 033 trouxe A PARTE DE CADA UM, lida de `group_expense_splits` (nunca
// recalculada) via `group_share_entries`. Mas ela a trouxe para OS DOIS LADOS:
// quem pagou o jantar de 90 via a parte dele (30) em vez do valor cheio. Isso
// era uma TERCEIRA convencao de custo pessoal, sem rotulo em tela nenhuma, e a
// pergunta de produto atras dela foi respondida em 08/10/2026 -- interaction
// `hmo258:criterio-do-relatorio:v1`, por uma PESSOA:
//
//   INTEIRO quando EU paguei          (o jantar de 90 conta 90)
//   MINHA PARTE quando OUTRO pagou    (o mercado de 60 da B conta 20)
//
// E o mesmo criterio que `resumoComPartesDeGrupo` (lib/parte-de-grupo-na-lista.ts,
// HMO-275) usa em Financas Pessoais, e o que a migration 046 colocou nas views
// do modo mes. Quem o aplica depende do ramo:
//
//   modo mes       -> `personal_monthly_cash_flow` (rollup, sai do banco: 033+046)
//   modo intervalo -> AQUI, nos dois filtros da secao abaixo
//
// OS DOIS FILTROS DO MODO INTERVALO SO FUNCIONAM JUNTOS
// ----------------------------------------------------
// E o espelho exato das duas pernas da 046, e cada um sem o outro erra dinheiro
// num sentido diferente -- medido na fixture de maio da HMO-255, onde o numero
// aprovado e 1.010,00:
//
//   `financial_transactions` sem `group_id IS NULL`   -> a despesa que EU paguei
//                                                       entra INTEIRA;
//   `group_share_entries` com `NOT paguei_eu`         -> so a parte do que OUTRO
//                                                       pagou.
//
//   os dois filtros antigos ...... 950,00  (minha parte dos dois lados)
//   so o primeiro trocado ........ 1.040,00 (valor cheio + a minha parte dele)
//   so o segundo trocado ......... 920,00  (a despesa que eu paguei desaparece)
//   os dois trocados ............. 1.010,00 <- o criterio aprovado
//
// O `.eq("user_id")` passa a ser a UNICA coisa que separa a minha despesa de
// grupo da dos outros membros, e por isso ele ficou mais load-bearing do que
// era: a linha de uma despesa de grupo tem `user_id` = quem PAGOU, e a policy do
// 002 (`user_id = auth.uid() OR is_group_member(group_id)`) deixa eu ler a dos
// meus colegas. Mesma propriedade que a 046 escreveu para quem le as views.
//
// Com `groupId` nada disso se aplica: o painel DO GRUPO mostra o valor CHEIO da
// viagem, de todos os membros, e continua lendo `monthly_cash_flow`.
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
//
// O CARTAO CONTA PELA FATURA PAGA, NO MES DO VENCIMENTO (fase 6, RN017.3/RN017.4)
// ---------------------------------------------------------------------------
// "Despesa do cartao so e realizada quando fatura do cartao e paga, usar o valor
// total do cartao como parametro pra saber se ja foi realizada ou nao."
//
// Desde a 072 a regra e UMA para o relatorio pessoal inteiro, e nao um
// parametro: a compra e o estorno no cartao saem, e a fatura paga entra no mes
// do vencimento, pelo total das linhas dela.
//
//   modo mes       -> `personal_monthly_cash_flow` (a perna 5 da 072)
//   modo intervalo -> AQUI, por `realizadoComCartaoPelaFatura`
//                     (lib/realizado-do-caixa.ts) sobre as linhas do periodo e
//                     as de `card_invoice_paid_entries` que vencem nele
//
// Da HMO-265 ate a fase 5 era `?cartao=fatura`, so do painel, com a fatura no
// dia do PAGAMENTO; a tela de relatorios contava a compra (HMO-266), e a legenda
// das duas telas explicava a diferenca. O parametro ainda e aceito e nao muda
// nada -- recusa-lo quebraria a aba aberta com o painel antigo.
//
// O GRUPO CONTINUA NA COMPRA. Com `groupId` o painel do grupo quer o valor CHEIO
// da despesa no mes em que ela aconteceu, e quem divide a conta nao paga a
// fatura do cartao de ninguem. `cartao=fatura` com `groupId` continua 400:
// ignorar responderia 200 com a regra que a URL nao pediu.
//
// `?faturaAte=` E O FIM DO PERIODO DO PAINEL. O Realizado do painel para em
// hoje (HMO-174), e a fatura paga que vence depois de hoje, dentro do periodo,
// ja aconteceu: ela saiu do Previsto quando foi paga. Recortada pelo `ate` de
// hoje, ela sumiria dos dois lados ate o vencimento. A rota le a fatura paga
// ate `faturaAte`, e o resto do periodo ate `ate`. Com ele a resposta sai
// SEMPRE do modo intervalo, mesmo num mes inteiro, como saia com `cartao=fatura`:
// as views nao sabem recortar dois eixos, e o painel soma as linhas cruas e nao
// le view nenhuma (HMO-258) -- o numero dele nao muda de caminho conforme o
// periodo caia ou nao em meses inteiros.
//
// O campo `cartao` da resposta diz qual regra produziu os numeros: `fatura` no
// pessoal, `compra` no grupo.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { janelaDeMeses, completarMeses } from "@/lib/services/reports";
import {
  agregarTransacoesPorMoeda,
  ehDataIso,
  mesesDoPeriodo,
  periodoDaQuery,
  ultimoDiaDoMes,
} from "@/lib/periodo-do-painel";
import { lerPreferenciaDeMoeda, separarSeriePorMoeda } from "@/lib/moeda";
import {
  lerMoedaOficial,
  lerResultadoDoPeriodo,
  lerResultadoPorMes,
  resultadoVazio,
} from "@/lib/services/resultado-do-mes";
import type { BlocoDeFluxoPorMoeda } from "@/lib/periodo-do-painel";
import type { LinhaDoRealizado } from "@/lib/realizado-do-caixa";
import { apenasNosTotais } from "@/lib/fora-dos-totais";

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

    // O CARTAO CONTA PELA FATURA PAGA no relatorio pessoal, e pela compra no do
    // grupo. Ver o cabecalho deste arquivo.
    //
    // `cartao=fatura` e aceito e nao muda nada, menos com `groupId`: 400, e nao
    // um 200 calado com a regra que a URL nao pediu.
    if (url.searchParams.get("cartao") === "fatura" && groupId) {
      return NextResponse.json(
        {
          error:
            "cartao=fatura vale só no relatório pessoal: o painel do grupo conta a despesa dividida no mês em que ela aconteceu",
        },
        { status: 400 }
      );
    }

    // ATE QUANDO LER A FATURA PAGA (fase 6). Ver `?faturaAte=` no cabecalho.
    // Recusado, e nao ignorado, fora do caso que ele descreve: sem `de`/`ate`,
    // com `groupId` ou antes de `ate`, ele nao tem resposta certa.
    const faturaAteDaQuery = url.searchParams.get("faturaAte");
    let faturaAte: string | null = null;

    if (faturaAteDaQuery !== null) {
      if (
        !periodo ||
        groupId ||
        !ehDataIso(faturaAteDaQuery) ||
        faturaAteDaQuery < periodo.ate
      ) {
        return NextResponse.json(
          {
            error:
              "faturaAte vale só no relatório pessoal com de e ate, e não pode ser antes de ate",
          },
          { status: 400 }
        );
      }
      faturaAte = faturaAteDaQuery;
    }

    // ---------------------------------------------------------------------
    // Modo intervalo: nenhuma view responde, a soma vem das transacoes
    // ---------------------------------------------------------------------
    // `faturaAte` entra nesta MESMA condicao, e nao num terceiro ramo proprio:
    // as views do 008 recortam um eixo de data so, e este ramo e o unico que le
    // as linhas cruas. Um ramo paralelo seria uma segunda implementacao da
    // paginacao, da parte de grupo e da separacao por moeda -- tres coisas cujo
    // modo de falha e devolver um total MENOR sem erro nenhum.
    //
    // MESMO IGUAL A `ate`: e o painel perguntando, e o painel soma as linhas
    // cruas em todo periodo (ver `?faturaAte=` no cabecalho).
    if (periodo && (periodo.modo === "intervalo" || faturaAte !== null)) {
      // A moeda oficial decide qual bloco e o PRINCIPAL, igual ao caminho
      // mensal. Erro aqui cai no padrao de `lerPreferenciaDeMoeda` e nao custa
      // o relatorio.
      const moedaDoIntervalo = await lerMoedaOficial(supabase, user.id);

      let blocosDoIntervalo: BlocoDeFluxoPorMoeda[];

      if (!groupId) {
        // O RELATORIO PESSOAL E O RESULTADO DO MES (mapa, prioridade 1).
        //
        // As cinco pernas -- transacoes, a minha parte do que outro pagou, a
        // conta do fechamento quitada, o juro pago do MyBank e a fatura paga --
        // moravam aqui. Mudaram para lib/services/resultado-do-mes.ts para que
        // Financas Pessoais e o resumo mensal leiam o MESMO numero que o
        // painel, em vez de cada um somar do seu jeito. Os racionais vieram
        // junto com o codigo.
        const resultado = await lerResultadoDoPeriodo(supabase, user.id, {
          de: periodo.de,
          ate: periodo.ate,
          faturaAte,
          moedaOficial: moedaDoIntervalo,
        });

        if (!resultado.ok) {
          console.error(
            `Erro no fluxo de caixa por intervalo (${resultado.etapa}):`,
            resultado.erro
          );
          return NextResponse.json(
            { error: "Não foi possível montar o relatório" },
            { status: 500 }
          );
        }

        blocosDoIntervalo = resultado.blocos;
      } else {
        // O PAINEL DO GRUPO: o valor CHEIO das despesas do grupo, de todos os
        // membros, com o cartao pela COMPRA -- quem divide a conta nao paga a
        // fatura do cartao de ninguem. Sem parte, sem fechamento, sem fatura.
        //
        // `include_in_total` (060, HMO-443) entra na lista de colunas: sem ela
        // o campo chega `undefined`, o predicado `!== false` deixa tudo passar,
        // e este ramo volta a contar a linha desmarcada -- enquanto o ramo
        // MENSAL, que le as views que a 060 filtrou, nao conta.
        //
        // Paginado pela razao do cabecalho de lib/services/resultado-do-mes.ts:
        // a soma e feita aqui, e uma resposta truncada pelo teto do PostgREST
        // sairia MENOR que a real, sem erro nenhum.
        const pagina = (inicio: number) =>
          supabase
            .from("financial_transactions")
            .select("amount, transaction_type, currency, include_in_total")
            .gte("transaction_date", periodo.de)
            .lte("transaction_date", periodo.ate)
            .order("id", { ascending: true })
            .range(inicio, inicio + TAMANHO_DA_PAGINA - 1)
            .eq("group_id", groupId);

        const linhas: LinhaDoRealizado[] = [];

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
          for (const linha of apenasNosTotais(
            lote as unknown as LinhaDoRealizado[]
          ))
            linhas.push(linha);
          if (lote.length < TAMANHO_DA_PAGINA) break;
        }

        blocosDoIntervalo = agregarTransacoesPorMoeda(linhas, moedaDoIntervalo);
      }

      // O bloco principal, pela mesma regra do caminho mensal: a moeda oficial
      // quando ela tem movimento, senao a mais movimentada. Periodo sem
      // movimento nenhum nao produz bloco, e a resposta sai zerada na oficial.
      const principalDoIntervalo =
        blocosDoIntervalo[0] ?? resultadoVazio(moedaDoIntervalo);

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
        // `intervalo` TAMBEM quando o periodo pedido e um mes inteiro e
        // `faturaAte` o empurrou para ca: a resposta e um balde, e dizer "mes"
        // com `months: []` seria a unica combinacao que o cabecalho deste
        // arquivo proibe -- quem consome olha `grao` justamente para saber se
        // pode desenhar a serie.
        grao: "intervalo",
        /**
         * Qual regra do cartao produziu estes numeros (HMO-265).
         *
         * Vai na resposta porque as duas dao totais DIFERENTES para o mesmo
         * periodo: `compra` (o grupo) conta o gasto no dia da compra, `fatura`
         * (o pessoal) conta a fatura paga no mes do vencimento. Sem este campo,
         * o painel do grupo e o pessoal mostrando numeros distintos para
         * outubro seriam indistinguiveis de um bug -- e foi assim que a
         * HMO-258 nasceu.
         */
        cartao: groupId ? "compra" : "fatura",
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

    // DUAS VIEWS, E NAO UMA COM FILTRO (HMO-202)
    //
    // O relatorio de GRUPO le `monthly_cash_flow`, que tem `group_id` no grao:
    // la o numero certo e o valor CHEIO da viagem, somando todos os membros.
    //
    // O relatorio PESSOAL le `personal_monthly_cash_flow` (033), que soma o que
    // e so do usuario com A PARTE DELE das despesas de grupo. Ela nao tem
    // `group_id` -- nem poderia: no painel pessoal a Viagem e a Casa somam na
    // mesma linha do mes, que e o que o usuario ve.
    //
    // O `eq("user_id")` vale para as duas, e na pessoal ele e load-bearing: as
    // policies de grupo tem `OR is_group_member(...)`, e sem o filtro a consulta
    // devolveria a parte dos OUTROS membros junto (medido: 400 em vez de 200).
    //
    // O PESSOAL e o Resultado do mes por mes, e sai de
    // lib/services/resultado-do-mes.ts -- a mesma leitura que o resumo mensal
    // usa, com a queda para `monthly_cash_flow` sem grupo na janela entre o
    // deploy e a colagem da 033 (ver `viewDaParteAusente`).

    // A moeda oficial decide qual bloco e o PRINCIPAL da resposta. Lida em
    // paralelo com o relatorio, e sem derrubar nada quando falha: ela so ordena
    // blocos, e um erro aqui nao pode custar o relatorio inteiro. Perfil ausente
    // ou `error` cai no padrao de `lerPreferenciaDeMoeda`.
    const perfilPromessa = supabase
      .from("profiles")
      .select("preferences")
      .eq("id", user.id)
      .maybeSingle();

    type LinhaDaView = {
      month: unknown;
      income: unknown;
      expense: unknown;
      net: unknown;
      transaction_count: unknown;
      currency: unknown;
    };
    const leitura: Promise<{ data: LinhaDaView[] | null; error: unknown }> = groupId
      ? Promise.resolve(
          supabase
            .from("monthly_cash_flow")
            .select("month, income, expense, net, transaction_count, currency")
            .eq("user_id", user.id)
            .eq("group_id", groupId)
            .gte("month", janela.inicio)
            .lte("month", janela.fim)
            .order("month", { ascending: true })
        ).then(({ data, error }) => ({ data, error }))
      : lerResultadoPorMes(supabase, user.id, {
          desde: janela.inicio,
          ate: janela.fim,
        }).then((r) =>
          r.ok ? { data: r.meses, error: null } : { data: null, error: r.erro }
        );

    const [{ data, error }, { data: perfil }] = await Promise.all([
      leitura,
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
          // Soma dos meses DESTA moeda, pela mesma razao das medias logo abaixo:
          // o bloco e por moeda, e o painel do grupo mostra esta contagem ao
          // lado dos totais desta moeda.
          //
          // O grao `intervalo` ja devolvia `transaction_count` e este nao: o
          // tile "Lancamentos" do painel do grupo lia `undefined` e caia no
          // `?? 0`, mostrando ZERO em cima de um mes com gasto -- e o periodo
          // default do painel (o mes corrente) e exatamente um mes fechado,
          // entao era o caso comum, nao a borda.
          transaction_count: linhas.reduce(
            (s, l) => s + l.transaction_count,
            0
          ),
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
        transaction_count: 0,
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
      /**
       * Qual regra do cartao produziu estes numeros (HMO-266, fase 6).
       *
       * O MESMO criterio do ramo de intervalo: desde a 072 a view pessoal
       * conta a fatura paga no mes do vencimento, e `monthly_cash_flow` (o
       * grupo) continua na compra.
       *
       * O campo existia so no ramo de intervalo desde a HMO-265, e a falta dele
       * AQUI era o que impedia a tela de relatorios de escrever a legenda a
       * partir da API em vez de supor o criterio.
       */
      cartao: groupId ? "compra" : "fatura",
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
