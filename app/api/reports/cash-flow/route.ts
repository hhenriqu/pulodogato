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
import { lerContasDoFechamentoRealizadas } from "@/lib/services/fechamento-no-resultado";
import { lerJurosPagosDoMyBank } from "@/lib/services/divida-do-mybank";
import { lerFaturasPagas } from "@/lib/services/fatura-paga-no-resultado";
import type { LinhaDaFaturaPaga } from "@/lib/fatura-paga-no-resultado";
import {
  COLUNAS_DA_PARTE_DE_GRUPO,
  partesComoTransacoes,
  viewDaParteAusente,
  type ParteDeGrupoCrua,
} from "@/lib/parte-do-grupo-realizada";
import {
  COLUNAS_DO_REALIZADO_DE_CAIXA,
  realizadoComCartaoPelaFatura,
  type LinhaDoRealizado,
} from "@/lib/realizado-do-caixa";
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
          //
          // No relatorio pessoal entra o embed da conta, que e load-bearing e
          // invisivel na tela -- ver COLUNAS_DO_REALIZADO_DE_CAIXA. Ele NAO e
          // pedido no do grupo porque custa um join em toda linha do periodo, e
          // o grupo conta o cartao pela compra.
          //
          // `include_in_total` (060, HMO-443) entra nas DUAS listas: nesta
          // literal e dentro de COLUNAS_DO_REALIZADO_DE_CAIXA. Sem ela o campo
          // chega `undefined`, o predicado `!== false` deixa tudo passar, e
          // este ramo volta a contar a linha desmarcada -- enquanto o ramo
          // MENSAL, que le as views que a 060 filtrou, nao conta. "Setembro
          // inteiro" e "01/09 a 30/09" dariam numeros diferentes, sem erro.
          //
          // Nomear coluna num `select` e a armadilha do #335; a medida que
          // autoriza isto (42501 em prod contra 42703 do nome inventado,
          // 2026-10-21) esta no bloco homonimo de
          // app/api/movimentacoes/resumo/route.ts.
          .select(
            groupId
              ? "amount, transaction_type, currency, include_in_total"
              : COLUNAS_DO_REALIZADO_DE_CAIXA
          )
          .gte("transaction_date", periodo.de)
          // `lte` e nao `lt`: o periodo e fechado nos dois extremos, e o ultimo
          // dia escolhido pelo usuario tem que entrar.
          .lte("transaction_date", periodo.ate)
          // Ordem estavel: sem ela, duas paginas podem repetir e pular linhas.
          .order("id", { ascending: true })
          .range(inicio, inicio + TAMANHO_DA_PAGINA - 1);

        // SEM `is("group_id", null)` NO CAMINHO PESSOAL (HMO-418).
        //
        // A despesa de grupo que EU paguei entra INTEIRA -- e a metade 1 do
        // criterio aprovado, descrita no cabecalho deste arquivo. Ela so esta
        // correta porque a consulta de `group_share_entries` logo abaixo
        // descarta `paguei_eu`; sem isso o valor cheio e a minha parte dele
        // somariam a mesma despesa duas vezes (1.040,00 na fixture de maio).
        //
        // O `eq("user_id")` e o que impede a despesa de grupo dos OUTROS
        // membros de entrar: a linha dela tem `user_id` = quem pagou, e a
        // policy do 002 me deixa LER a linha de quem divide grupo comigo. Era
        // o `group_id IS NULL` que descartava essas linhas de graca; agora o
        // filtro de usuario e sozinho.
        return groupId
          ? base.eq("group_id", groupId)
          : base.eq("user_id", user.id);
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
      // `transaction_type` nullable porque a coluna e nullable -- e porque a
      // parte de grupo (abaixo) repassa o campo da view em vez de afirmar
      // 'expense'. `agregarTransacoes` ja descarta o que nao e income/expense.
      //
      // `LinhaDoRealizado` tem o embed da conta opcional, e e por isso que ele
      // serve para os dois caminhos deste ramo: no do grupo a consulta nao pede
      // `account`, e a regra nao e aplicada.
      const linhas: LinhaDoRealizado[] = [];

      // As linhas das faturas pagas que vencem no periodo (fase 6). So no
      // relatorio pessoal; ficam vazias no do grupo.
      let faturasPagas: LinhaDaFaturaPaga[] = [];

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
        // O `as` existe porque o `select` deste ramo e escolhido em tempo de
        // execucao (duas listas de colunas), e com isso o supabase-js nao
        // consegue inferir a forma da linha. A fronteira NAO e verificada pelo
        // tsc, e e por isso que `contaDaLinha` em lib/realizado-do-caixa.ts
        // trata o embed vindo objeto OU array em vez de confiar no tipo.
        //
        // O FILTRO DO FORA-DOS-TOTAIS ENTRA AQUI, E O LUGAR E ESCOLHIDO
        // (HMO-453). Aqui e o leitor da TABELA -- antes da parte de grupo ser
        // anexada e antes da regra do cartao --, e as tres consequencias sao as
        // desejadas:
        //
        //   * a linha desmarcada sai do total e da `transaction_count` dos dois
        //     caminhos deste ramo (pessoal e de grupo), do mesmo jeito
        //     que a 060 a tirou do `WHERE` de `category_monthly_totals` e nao
        //     de cada `FILTER`;
        //   * `partesComoTransacoes` e anexada DEPOIS e nao passa por aqui, o
        //     que e a decisao D: o que eu devo nao muda porque quem lancou
        //     escondeu a linha do relatorio dele. (Aquelas linhas tambem nao
        //     tem a coluna, entao `apenasNosTotais` as deixaria passar de
        //     qualquer forma -- mas a POSICAO e que faz disso uma escolha e nao
        //     um acidente.)
        //   * a linha da fatura desmarcada nao passa por aqui: ela vem de
        //     `card_invoice_paid_entries`, e `faturasPagasComoTransacoes` aplica
        //     o mesmo `apenasNosTotais` nela.
        for (const linha of apenasNosTotais(
          lote as unknown as LinhaDoRealizado[]
        ))
          linhas.push(linha);
        // Pagina incompleta = acabou. Uma pagina cheia pode ser a ultima, e
        // nesse caso a proxima volta vazia e o laco encerra do mesmo jeito.
        if (lote.length < TAMANHO_DA_PAGINA) break;
      }

      // A MINHA PARTE DAS DESPESAS QUE OUTRO PAGOU, no mesmo intervalo
      // (HMO-202, recortada pela HMO-418).
      //
      // So no relatorio PESSOAL: com `groupId` a tela quer o valor cheio da
      // viagem, que as linhas de `financial_transactions` acima ja trazem.
      //
      // O `eq("user_id")` nao e redundante com a RLS, e esse e o erro facil
      // aqui: as policies de grupo sao `user_id = auth.uid() OR
      // is_group_member(group_id)`, entao uma consulta SEM ele devolve tambem a
      // parte dos OUTROS membros -- medido, 400 em vez de 200 num grupo de dois.
      // Mesma armadilha que a HMO-177 encontrou no previsto.
      if (!groupId) {
        const paginaDeParte = (inicio: number) =>
          supabase
            .from("group_share_entries")
            .select(COLUNAS_DA_PARTE_DE_GRUPO)
            .eq("user_id", user.id)
            // `paguei_eu = false` E A METADE 2 DO CRITERIO (HMO-418).
            //
            // O espelho do `WHERE NOT g.paguei_eu` da perna 2 da migration 046.
            // O que EU paguei ja veio INTEIRO na consulta de cima; somar a minha
            // parte dele aqui contaria a mesma despesa duas vezes -- 120 de um
            // jantar de 90.
            //
            // `eq(..., false)` e nao `not(..., "is", true)`: `paguei_eu` e
            // `(t.user_id = em.user_id)` na 033, e quando `em.user_id` e nulo
            // (convite sem conta, 039) a propria coluna `user_id` da view sai
            // nula e o filtro de usuario acima ja descartou a linha. Os dois
            // escrevem a mesma selecao, e `eq` e o que a tela de Financas
            // Pessoais ja usa (HMO-275) -- uma forma so para o mesmo criterio.
            .eq("paguei_eu", false)
            .gte("transaction_date", periodo.de)
            .lte("transaction_date", periodo.ate)
            .order("id", { ascending: true })
            .range(inicio, inicio + TAMANHO_DA_PAGINA - 1);

        // Paginada pela mesma razao das transacoes: a soma e feita aqui, e uma
        // resposta truncada pelo teto do PostgREST sairia MENOR que a real, sem
        // erro nenhum.
        const partes: ParteDeGrupoCrua[] = [];

        for (let inicio = 0; ; inicio += TAMANHO_DA_PAGINA) {
          const { data, error } = await paginaDeParte(inicio);

          // A janela entre o deploy e a colagem da 033: a view nao existe
          // ainda. Segue sem a parte de grupo, que e o comportamento antigo --
          // o relatorio do periodo nao pode morrer por causa disso.
          if (error && viewDaParteAusente(error)) {
            partes.length = 0;
            break;
          }

          if (error) {
            console.error("Erro na parte de grupo do intervalo:", error);
            return NextResponse.json(
              { error: "Não foi possível montar o relatório" },
              { status: 500 }
            );
          }

          const lote = data ?? [];
          for (const linha of lote) partes.push(linha);
          if (lote.length < TAMANHO_DA_PAGINA) break;
        }

        for (const linha of partesComoTransacoes(partes)) linhas.push(linha);

        // A CONTA DO FECHAMENTO DO GRUPO JA QUITADA (069, RN017.6).
        //
        // No grupo com dia de fechamento a parte de quem nao pagou saiu de
        // `group_share_entries` (RN018.9), e o que ele deve -- ou tem a
        // receber -- entra pela conta que o fechamento gerou: em Despesas o
        // "Pagamento ao grupo", em Receitas o "A receber do grupo". Em aberto
        // ela e previsao; quitada, ela e realizado, no mes do fechamento.
        //
        // `partesComoTransacoes` serve sem mudanca: a view entrega `amount`
        // POSITIVO e o sinal em `transaction_type`, e os agregadores leem os
        // dois -- inclusive `income`, que a parte de grupo nunca teve.
        const doFechamento = await lerContasDoFechamentoRealizadas(
          supabase,
          user.id,
          periodo.de,
          periodo.ate
        );
        if (!doFechamento.ok) {
          console.error("Erro na conta do fechamento do intervalo:", doFechamento.erro);
          return NextResponse.json(
            { error: "Não foi possível montar o relatório" },
            { status: 500 }
          );
        }
        for (const linha of partesComoTransacoes(doFechamento.contas)) linhas.push(linha);

        // O JURO PAGO DO MYBANK (071, RN021.3), do lado de quem pegou, na data
        // do pagamento. Quem pegou nao grava transacao nenhuma quando quem
        // emprestou confirma, e a view entrega a mesma forma da conta do
        // fechamento (`amount` positivo, o sinal em `transaction_type`). O
        // juro de quem emprestou ja e uma transacao `income` dele.
        const jurosPagos = await lerJurosPagosDoMyBank(
          supabase,
          user.id,
          periodo.de,
          periodo.ate
        );
        if (!jurosPagos.ok) {
          console.error("Erro nos juros pagos do MyBank do intervalo:", jurosPagos.erro);
          return NextResponse.json(
            { error: "Não foi possível montar o relatório" },
            { status: 500 }
          );
        }
        for (const linha of partesComoTransacoes(jurosPagos.juros)) linhas.push(linha);

        // A FATURA PAGA (072, RN017.4), pelo VENCIMENTO, ate `faturaAte` quando
        // o painel o passa. Ver `?faturaAte=` no cabecalho. Falhar aqui e 500,
        // pela razao da conta do fechamento logo acima.
        const faturas = await lerFaturasPagas(
          supabase,
          user.id,
          periodo.de,
          faturaAte ?? periodo.ate
        );
        if (!faturas.ok) {
          console.error("Erro nas faturas pagas do intervalo:", faturas.erro);
          return NextResponse.json(
            { error: "Não foi possível montar o relatório" },
            { status: 500 }
          );
        }
        faturasPagas = faturas.linhas;
      }

      // O CARTAO PASSA A CONTAR PELA FATURA PAGA (HMO-265, fase 6).
      //
      // Depois da parte de grupo e ANTES da agregacao, e as duas posicoes sao
      // deliberadas:
      //
      //   * depois da parte de grupo, porque as linhas de `group_share_entries`
      //     atravessam a regra intactas (nao tem conta) e separa-las em duas
      //     listas criaria um segundo caminho para somar;
      //
      //     DESDE A HMO-418 A LISTA TEM UM TERCEIRO TIPO DE LINHA, e ele NAO
      //     atravessa intacto: a despesa de grupo que eu paguei vem agora de
      //     `financial_transactions`, com conta. Lancada no CARTAO, ela e
      //     compra no cartao como qualquer outra e sai daqui -- passa a contar
      //     na fatura, junto com o resto dela, que e o que o banco faz.
      //
      //     A assimetria que fica: a MINHA PARTE de uma despesa que outro pagou
      //     no cartao DELE continua contando no mes da compra. Nao ha fatura
      //     minha que a contenha -- o que eu devo e um reembolso a uma pessoa,
      //     nao uma linha de fatura -- e `group_share_entries` nao tem conta
      //     para a regra olhar.
      //   * antes da agregacao, porque `agregarTransacoesPorMoeda` continua
      //     sendo a UNICA funcao que soma. A regra so tira e acrescenta linha;
      //     nenhuma aritmetica e refeita aqui.
      const paraAgregar = groupId
        ? linhas
        : realizadoComCartaoPelaFatura(linhas, faturasPagas);

      const blocosDoIntervalo = agregarTransacoesPorMoeda(
        paraAgregar,
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
    const query = groupId
      ? supabase
          .from("monthly_cash_flow")
          .select("month, income, expense, net, transaction_count, currency")
          .eq("user_id", user.id)
          .eq("group_id", groupId)
          .gte("month", janela.inicio)
          .lte("month", janela.fim)
      : supabase
          .from("personal_monthly_cash_flow")
          .select("month, income, expense, net, transaction_count, currency")
          .eq("user_id", user.id)
          .gte("month", janela.inicio)
          .lte("month", janela.fim);

    // A moeda oficial decide qual bloco e o PRINCIPAL da resposta. Lida em
    // paralelo com o relatorio, e sem derrubar nada quando falha: ela so ordena
    // blocos, e um erro aqui nao pode custar o relatorio inteiro. Perfil ausente
    // ou `error` cai no padrao de `lerPreferenciaDeMoeda`.
    const perfilPromessa = supabase
      .from("profiles")
      .select("preferences")
      .eq("id", user.id)
      .maybeSingle();

    const [primeiraTentativa, { data: perfil }] = await Promise.all([
      query.order("month", { ascending: true }),
      perfilPromessa,
    ]);

    let { data, error } = primeiraTentativa;

    // A JANELA ENTRE O DEPLOY E A COLAGEM DA 033 (ver viewDaParteAusente)
    //
    // Producao nao tem runner de migration. Entre o merge e a colagem da 033 no
    // SQL Editor, `personal_monthly_cash_flow` nao existe -- e sem isto o bloco
    // de realizado do painel principal devolveria 500 para todo mundo.
    //
    // A queda e para o comportamento ANTIGO, nao para um erro: a parte de grupo
    // volta a faltar (o bug conhecido, que e o estado em que producao ja esta),
    // e o painel continua mostrando os numeros do mes.
    if (error && !groupId && viewDaParteAusente(error)) {
      const antiga = await supabase
        .from("monthly_cash_flow")
        .select("month, income, expense, net, transaction_count, currency")
        .eq("user_id", user.id)
        .is("group_id", null)
        .gte("month", janela.inicio)
        .lte("month", janela.fim)
        .order("month", { ascending: true });

      data = antiga.data;
      error = antiga.error;
    }

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
