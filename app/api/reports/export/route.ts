// GET /api/reports/export?report=cash-flow|categories|planned|net-worth|transactions&months=12&groupId=
//
// Devolve o relatorio em CSV, pronto para abrir no Excel em pt-BR (separador
// `;`, decimal com virgula, BOM na frente -- ver lib/services/reports.ts).
//
// E O PDF?
// --------
// Nao ha geracao de PDF no servidor, e isso foi decidido, nao esquecido. As
// bibliotecas de PDF em JS (jsPDF, pdfkit, puppeteer) custam entre 300 KB e um
// Chromium inteiro na funcao serverless -- para produzir um arquivo pior do
// que o que o proprio browser ja imprime, porque teriam que redesenhar do zero
// os graficos que o recharts ja desenhou na tela.
//
// A tela de relatorios tem estilo de impressao (`print:` no Tailwind) e um
// botao "Salvar em PDF" que chama window.print(). O usuario escolhe "Salvar
// como PDF" no dialogo do sistema e leva o relatorio COM os graficos. O CSV
// cobre o outro uso, que e levar os numeros para a planilha.
//
// Metade desse estilo de impressao mora em app/(dashboard)/layout.tsx, nao na
// pagina: header e sidebar sao renderizados pelo layout, fora da arvore da
// pagina, que por isso nao consegue esconder nenhum dos dois.
//
// Se algum dia for preciso PDF sem interacao humana (envio por e-mail, por
// exemplo), o lugar e um job separado, nao esta rota.
//
// A PARTE DE GRUPO: QUAIS RELATORIOS A CONTAM, E POR QUE NAO SAO TODOS (HMO-207)
// ------------------------------------------------------------------------------
// A HMO-202 fez o realizado PESSOAL contar A MINHA PARTE das despesas de grupo,
// lendo as views da 033 em vez de filtrar `group_id IS NULL`. Ela mudou
// /api/reports/cash-flow e /api/reports/categories e NAO mudou esta rota, sem
// dizer que era de proposito -- e nao era. O resultado foi a pior forma de
// divergencia que este produto sabe produzir: o CSV abria, tinha cabecalho,
// tinha coluna de Moeda e SOMAVA SOZINHO NA PLANILHA, so que sem a linha de
// 180,00 em dolar que a tela mostrava. Quem exportasse para conferir o mes
// concluiria que a TELA estava inflada -- confiaria no arquivo e desconfiaria do
// numero certo. Antes da 033 os dois lados concordavam (os dois escondiam a
// parte de grupo); foi a correcao PARCIAL que criou a discordancia.
//
// Por isso os quatro `group_id IS NULL` desta rota nao tem o mesmo destino, e a
// razao de cada um fica escrita no proprio ramo:
//
//   * `cash-flow`  -> `personal_monthly_cash_flow` (033). Tem tela equivalente,
//                     e ela le essa view. CONSERTADO.
//   * `categories` -> `personal_category_monthly_totals` (033). Idem.
//   * `planned`    -> continua em `planned_vs_actual` com `group_id IS NULL`,
//                     porque /api/reports/planned-vs-actual faz EXATAMENTE o
//                     mesmo filtro. Aqui os dois lados ja concordam, e trocar so
//                     este criaria a divergencia que o resto deste comentario
//                     descreve -- ao contrario.
//   * `transactions` -> continua excluindo grupo. O substituto da lista da tela
//                     nao e este relatorio, e /api/personal-finance/transactions/export,
//                     cujo cabecalho explica as DUAS diferencas de WHERE (grupo e
//                     `service_id`). Ver o ramo no fim deste arquivo.
//
// O criterio que generaliza, e que a HMO-202 nao aplicou: o que decide se um
// ramo muda nao e o NOME do relatorio, e o WHERE do lado que o usuario ve.
//
// SO MODO MES, E ISSO LIMITA O CONSERTO
// -------------------------------------
// Esta rota recorta por `?months=N` (`janelaDeMeses`) e nao aceita `de`/`ate`.
// Entao das duas metades do criterio da 033 -- rollup mensal no modo mes,
// `group_share_entries` somada no modo intervalo -- so a primeira tem onde
// acontecer aqui. Nada de `partesComoTransacoes` neste arquivo: nao ha caminho
// que leia linha crua.
//
// TODA LEITURA DAQUI CONFERE `error`, E UMA QUE FALHA DA 500 (HMO-378)
// --------------------------------------------------------------------
// Medido em 2026-10-11: esta rota tinha DOZE chamadas `.from(...)`, duas
// desestruturavam `error` (so para `console.error`) e ZERO mudavam a resposta.
// Uma leitura que falhava virava `data: null`, o `?? []` seguinte fazia dela
// uma secao vazia, e a rota respondia **200 com um CSV sem linhas** -- que na
// planilha se le como "nao houve movimento no periodo", nao como "a leitura
// falhou". A HMO-207 mediu isso, instrumentou dois ramos e deixou escrito que
// nao consertaria; esta e a issue que consertou.
//
// As doze chamadas compartilham OITO pontos de guarda, porque a queda da 033
// reatribui `data`/`error` na mesma variavel em dois ramos. Cada ponto e uma
// chamada a `linhasOuFalha` (lib/leitura-do-export.ts), e cada uma tem um
// mutante proprio em scripts/mutantes-export-de-relatorio.mjs -- uma guarda
// escrita em oito lugares e sete lugares para esquecer.
//
// A guarda vem **DEPOIS** da queda da 033, e isso e load-bearing: guardar antes
// faria a rota responder 500 na janela entre o deploy e a colagem da migration,
// que e exatamente o caso que `viewDaParteAusente` existe para atravessar. Ha
// um controle positivo para isso na suite (`npm run test:export-de-relatorio`),
// porque "o conserto 500-ou-nada quebrou a queda" nao tem sintoma nenhum fora
// daquela janela.
//
// Por que 500 e nao uma linha de erro dentro do CSV: ver o cabecalho de
// lib/leitura-do-export.ts. Em resumo, o export existe para ser arquivado e
// conferido fora do app, e um CSV incompleto nao tem onde se explicar no lugar
// em que vai ser lido.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  janelaDeMeses,
  montarCsv,
  cabecalhosCsv,
  nomeArquivoCsv,
  rotuloMes,
} from "@/lib/services/reports";
import { somarMeses } from "@/lib/services/budget";
import { viewDaParteAusente } from "@/lib/parte-do-grupo-realizada";
import {
  FalhaDeLeituraDoExport,
  linhasOuFalha,
} from "@/lib/leitura-do-export";

const RELATORIOS = [
  "cash-flow",
  "categories",
  "planned",
  "net-worth",
  "transactions",
] as const;

type Relatorio = (typeof RELATORIOS)[number];

/**
 * Formatos que esta rota entrega. So CSV -- ver a nota sobre PDF no topo.
 *
 * `format` e conferido em vez de ignorado, e a diferenca importa: quem pedir
 * `?format=pdf` tem que receber um erro dizendo onde o PDF esta, e nao um CSV
 * com 200 no cabecalho. Um parametro ignorado responde "deu certo" entregando
 * o arquivo errado, e quem integrar com a rota conclui que o PDF existe.
 */
const FORMATOS = ["csv"] as const;

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
    const report = (url.searchParams.get("report") ?? "cash-flow") as Relatorio;

    if (!RELATORIOS.includes(report)) {
      return NextResponse.json(
        { error: `Relatório inválido. Use um de: ${RELATORIOS.join(", ")}` },
        { status: 400 }
      );
    }

    const format = url.searchParams.get("format") ?? "csv";

    if (!FORMATOS.includes(format as (typeof FORMATOS)[number])) {
      return NextResponse.json(
        {
          error:
            "Formato inválido. Esta rota exporta apenas csv. Para PDF, use o botão \"Salvar em PDF\" na tela de relatórios, que imprime a página pelo navegador.",
        },
        { status: 400 }
      );
    }

    const janela = janelaDeMeses(url.searchParams.get("months"));

    if (!janela) {
      return NextResponse.json(
        { error: "months deve ser um inteiro entre 1 e 60" },
        { status: 400 }
      );
    }

    const groupId = url.searchParams.get("groupId");

    let csv: string;
    let nome: string;

    if (report === "cash-flow") {
      // DUAS VIEWS, E NAO UMA COM FILTRO (HMO-207)
      //
      // Tem que ser a MESMA fonte que /api/reports/cash-flow usa no modo mes,
      // porque e disso que a igualdade entre a tela e o arquivo depende:
      //
      //   grupo   -> `monthly_cash_flow`, que tem `group_id` no grao. No painel
      //              do grupo o numero certo e o valor CHEIO da viagem.
      //   pessoal -> `personal_monthly_cash_flow` (033), que soma o que e so do
      //              usuario com A PARTE dele das despesas de grupo. Ela NAO tem
      //              `group_id` -- nem poderia: no pessoal a Viagem e a Casa
      //              somam na mesma linha do mes.
      //
      // O `eq("user_id")` vale para as duas, e na pessoal ele e load-bearing e
      // nao higiene: as policies de grupo tem `OR is_group_member(...)`, e sem
      // ele a consulta traz a parte dos OUTROS membros junto.
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

      let { data, error } = await query.order("month", { ascending: true });

      // A janela entre o deploy e a colagem da 033: cai para a view antiga em
      // vez de entregar arquivo vazio. Ver viewDaParteAusente em
      // lib/parte-do-grupo-realizada.ts -- so os dois codigos de relacao
      // inexistente, para erro de verdade nao virar silencio.
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

      // GUARDA 1 de 8 (HMO-378) -- cobre as TRES consultas acima: a de grupo,
      // a pessoal da 033 e a queda. Ela vem depois da queda de proposito: antes
      // dela, a janela entre o deploy e a colagem da 033 responderia 500.
      const linhasDoFluxo = linhasOuFalha("o fluxo de caixa mensal", {
        data,
        error,
      });

      // A coluna "Moeda" e o que mantem este CSV correto depois da 022. Ele nao
      // agrega nada -- despeja as linhas da view -- entao um mes com duas moedas
      // vira DUAS linhas do mesmo mes. Sem a coluna, quem abre a planilha ve o
      // mes repetido com dois valores diferentes e nada dizendo por que, e a
      // primeira reacao de qualquer um e somar as duas.
      csv = montarCsv(
        ["Mês", "Moeda", "Entradas", "Saídas", "Resultado", "Lançamentos"],
        linhasDoFluxo.map((d) => [
          rotuloMes(String(d.month)),
          String(d.currency ?? "BRL"),
          Number(d.income),
          Number(d.expense),
          Number(d.net),
          Number(d.transaction_count),
        ])
      );
      nome = nomeArquivoCsv("fluxo-de-caixa", janela);
    } else if (report === "categories") {
      // DUAS VIEWS (HMO-207), pela mesma razao do ramo de cash-flow acima, e
      // com uma exigencia a mais: tem que ser a mesma fonte que AQUELE ramo
      // usa. `personal_monthly_cash_flow` e rollup de
      // `personal_category_monthly_totals`, entao ler as duas mantem o total do
      // fluxo igual a soma das categorias -- dois CSVs do mesmo mes que nao
      // fecham entre si sao o sintoma de haver duas definicoes.
      //
      // No relatorio de GRUPO nao se filtra `user_id`: o ponto e ver o gasto da
      // viagem inteira, de todos os membros, e a RLS ja garante que so membro
      // enxerga essas linhas. No PESSOAL o `eq("user_id")` e obrigatorio, pelo
      // `OR is_group_member(...)` das policies.
      const query = groupId
        ? supabase
            .from("category_monthly_totals")
            .select(
              "month, category_id, expense, income, transaction_count, currency"
            )
            .gte("month", janela.inicio)
            .lte("month", janela.fim)
            .eq("group_id", groupId)
        : supabase
            .from("personal_category_monthly_totals")
            .select(
              "month, category_id, expense, income, transaction_count, currency"
            )
            .gte("month", janela.inicio)
            .lte("month", janela.fim)
            .eq("user_id", user.id);

      let { data, error } = await query;

      // A queda da janela de colagem da 033, igual ao ramo de cash-flow.
      if (error && !groupId && viewDaParteAusente(error)) {
        const antiga = await supabase
          .from("category_monthly_totals")
          .select(
            "month, category_id, expense, income, transaction_count, currency"
          )
          .gte("month", janela.inicio)
          .lte("month", janela.fim)
          .eq("user_id", user.id)
          .is("group_id", null);

        data = antiga.data;
        error = antiga.error;
      }

      // GUARDA 2 de 8 (HMO-378) -- as tres consultas de categoria acima.
      const linhas = linhasOuFalha("os gastos por categoria", { data, error });

      const ids = Array.from(new Set(linhas.map((l) => l.category_id)));

      // GUARDA 3 de 8 (HMO-378) -- o join de ROTULO, e ele tem um modo de falha
      // proprio: sem a guarda, uma falha aqui produz 200 com todas as linhas
      // dizendo "Sem categoria", porque o `porId.get(...) ?? "Sem categoria"`
      // nao distingue "esta categoria nao existe" de "nao consegui ler nenhuma".
      // O arquivo sai com os VALORES certos e a classificacao inteira apagada,
      // o que e pior que o arquivo vazio: ele soma.
      //
      // O ramo sem consulta (`ids.length === 0`) entra na guarda com
      // `error` ausente e sai como lista vazia -- e e por isso que o `error` de
      // `linhasOuFalha` e opcional. Nao se inventa um `error: null` aqui para
      // satisfazer o tipo: o ramo que nao consulta nao tem erro.
      const categorias = linhasOuFalha(
        "os nomes das categorias",
        ids.length
          ? await supabase
              .from("transaction_categories")
              .select("id, name")
              .in("id", ids)
          : { data: [] as { id: string; name: string }[] }
      );

      const porId = new Map(categorias.map((c) => [c.id, c.name]));

      csv = montarCsv(
        ["Mês", "Moeda", "Categoria", "Saídas", "Entradas", "Lançamentos"],
        linhas
          .sort((a, b) => String(a.month).localeCompare(String(b.month)))
          .map((l) => [
            rotuloMes(String(l.month)),
            String(l.currency ?? "BRL"),
            porId.get(l.category_id) ?? "Sem categoria",
            Number(l.expense),
            Number(l.income),
            Number(l.transaction_count),
          ])
      );
      nome = nomeArquivoCsv("gastos-por-categoria", janela);
    } else if (report === "planned") {
      // `group_id IS NULL` FICA, E ISSO E A CONCLUSAO DA MEDICAO (HMO-207)
      //
      // /api/reports/planned-vs-actual -- o lado que o usuario ve -- faz
      // `.eq("user_id", ...)` e o MESMO `.is("group_id", null)`, sobre a MESMA
      // view. Os dois lados ja concordam, entao aqui nao ha o que consertar:
      // trocar so este ramo produziria exatamente a divergencia que a HMO-207
      // existe para apagar, de cabeca para baixo -- o arquivo passaria a contar
      // a parte de grupo que a tela nao conta.
      //
      // Nao ha `personal_planned_vs_actual`: a 033 criou quatro views e nenhuma
      // delas e do previsto. A parte de grupo no PREVISTO e feita em JavaScript,
      // em lib/parte-do-grupo.ts (HMO-177), por outro criterio -- ela DIVIDE
      // pelos membros ativos, porque conta que ainda nao foi paga nao tem rateio
      // gravado. Levar aquele criterio para ca sem tela correspondente seria uma
      // terceira definicao de "minha parte".
      const q = supabase
        .from("planned_vs_actual")
        .select("*")
        .eq("user_id", user.id)
        .gte("month", janela.inicio)
        .lte("month", janela.fim);

      // A resposta sai numa variavel e a guarda vem na linha seguinte, em vez
      // de a consulta ir dentro da chamada: `scripts/mutantes-parte-do-grupo-no-csv.mjs`
      // tem uma ancora de mutante sobre o `: q.is("group_id", null)` desta
      // expressao, e aninha-la um nivel a mais mudaria a indentacao e MATARIA
      // aquela ancora -- `componente-extraido-leva-o-endereco-das-assercoes-com-ele`.
      // A guarda de `npm run check-ancora-de-mutante` pega isso; o formato
      // abaixo e o que a mantem viva de graca.
      const previsto = await (groupId
        ? q.eq("group_id", groupId)
        : q.is("group_id", null)
      ).order("month", { ascending: true });

      // GUARDA 4 de 8 (HMO-378). Este ramo e o que a HMO-207 NAO instrumentou:
      // antes desta linha ele nao desestruturava `error` em lugar nenhum, e
      // uma falha de leitura saia como nove colunas e zero linhas.
      const linhasDoPrevisto = linhasOuFalha("o previsto x realizado", previsto);

      csv = montarCsv(
        [
          "Mês",
          "Moeda",
          "Despesa prevista",
          "Despesa realizada",
          "Diferença",
          "Receita prevista",
          "Receita realizada",
          "Contas em aberto",
          "Contas vencidas",
        ],
        linhasDoPrevisto.map((d) => [
          rotuloMes(String(d.month)),
          String(d.currency ?? "BRL"),
          Number(d.planned_expense),
          Number(d.actual_expense),
          Number(d.expense_variance),
          Number(d.planned_income),
          Number(d.actual_income),
          Number(d.pending_count),
          Number(d.overdue_count),
        ])
      );
      nome = nomeArquivoCsv("previsto-x-realizado", janela);
    } else if (report === "net-worth") {
      // GUARDA 5 de 8 (HMO-378). O patrimonio e o relatorio onde o CSV vazio
      // mente mais alto: duas colunas de numero e nenhuma linha se le como
      // "este app nao sabe meu patrimonio", e nao como leitura falhada.
      const linhasDoPatrimonio = linhasOuFalha(
        "o historico de patrimonio",
        await supabase
          .from("net_worth_history")
          .select("month, net_change, net_worth")
          .eq("user_id", user.id)
          .gte("month", janela.inicio)
          .lte("month", janela.fim)
          .order("month", { ascending: true })
      );

      csv = montarCsv(
        ["Mês", "Variação no mês", "Patrimônio no fim do mês"],
        linhasDoPatrimonio.map((d) => [
          rotuloMes(String(d.month)),
          Number(d.net_change),
          Number(d.net_worth),
        ])
      );
      nome = nomeArquivoCsv("patrimonio", janela);
    } else {
      // O extrato: uma linha por lancamento. E o que o contador pede e o que o
      // usuario quer quando desconfia de um numero agregado.
      //
      // `group_id IS NULL` FICA AQUI TAMBEM, POR OUTRA RAZAO (HMO-207)
      //
      // Este ramo tambem exclui grupo, e a tentacao e consertar os quatro de uma
      // vez. Mas o substituto da lista da tela nao e este relatorio: o botao
      // "Exportar CSV" de /dashboard/personal-finance aponta para
      // /api/personal-finance/transactions/export, e o cabecalho DAQUELE arquivo
      // registra as duas diferencas de WHERE que o levaram a existir -- grupo e
      // `service_id`, a segunda das quais este ramo nao filtra.
      //
      // Entao a divergencia que a HMO-207 mediu nao se aplica: este CSV nao tem
      // uma tela que ele contradiga. Mudar o WHERE dele por simetria de NOME
      // daria um extrato com a linha de -400 do hotel E a parte de 200 da mesma
      // despesa, que e a dupla contagem descrita em
      // lib/parte-de-grupo-na-lista.ts (HMO-215).
      const base = supabase
        .from("financial_transactions")
        .select(
          "transaction_date, description, amount, transaction_type, category_id, account_id, notes"
        )
        .gte("transaction_date", janela.inicio)
        // `janela.fim` e o dia 1 do mes CORRENTE, nao o ultimo dia dele. Um
        // `lt(fim)` aqui cortaria o mes inteiro que o usuario esta olhando: o
        // extrato sairia terminando no mes passado, e quem exportasse dia 20
        // nao acharia nenhum lancamento dos ultimos vinte dias.
        .lt("transaction_date", somarMeses(janela.fim, 1));

      // A consulta sai numa variavel pela mesma razao do ramo de `planned`
      // acima: o `.is("group_id", null)` desta expressao e ancora de mutante em
      // scripts/mutantes-parte-do-grupo-no-csv.mjs, e aninha-la mudaria a
      // indentacao e mataria a ancora.
      const extrato = groupId
        ? await base.eq("group_id", groupId).order("transaction_date")
        : await base
            .eq("user_id", user.id)
            .is("group_id", null)
            .order("transaction_date");

      // GUARDA 6 de 8 (HMO-378). O extrato e o relatorio que alguem abre
      // JUSTAMENTE para desconfiar de um numero agregado -- "o painel diz
      // R$ 4.000 e o extrato nao tem linha nenhuma" nao se resolve a favor do
      // extrato por acaso: o extrato parece a fonte mais crua das duas.
      const linhas = linhasOuFalha("o extrato de lancamentos", extrato);

      const catIds = Array.from(
        new Set(linhas.map((l) => l.category_id).filter(Boolean))
      );
      const contaIds = Array.from(
        new Set(linhas.map((l) => l.account_id).filter(Boolean))
      );

      const [respostaDasCategorias, respostaDasContas] = await Promise.all([
        catIds.length
          ? supabase
              .from("transaction_categories")
              .select("id, name")
              .in("id", catIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        contaIds.length
          ? supabase
              .from("financial_accounts")
              .select("id, name")
              .in("id", contaIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);

      // GUARDA 7 e GUARDA 8 de 8 (HMO-378). Sao DUAS guardas e nao uma, mesmo
      // saindo do mesmo `Promise.all`: as duas consultas falham por razoes
      // diferentes e o `Promise.all` nao as junta -- ele devolve as duas
      // respostas, cada uma com o seu `error`. Uma guarda so cobriria a
      // primeira, e o sintoma da outra seria a coluna "Conta" inteira em branco
      // num arquivo com 200.
      //
      // E o modo de falha dos dois joins de rotulo e o mesmo do ramo de
      // categorias: o arquivo sai com os VALORES certos e a classificacao
      // apagada. Ele soma na planilha, entao nada nele chama atencao.
      const nomeCat = new Map(
        linhasOuFalha("os nomes das categorias do extrato", respostaDasCategorias).map(
          (c) => [c.id, c.name]
        )
      );
      const nomeConta = new Map(
        linhasOuFalha("os nomes das contas do extrato", respostaDasContas).map((c) => [
          c.id,
          c.name,
        ])
      );
      const tipo: Record<string, string> = {
        income: "Receita",
        expense: "Despesa",
        transfer: "Transferência",
      };

      csv = montarCsv(
        ["Data", "Descrição", "Categoria", "Conta", "Tipo", "Valor"],
        linhas.map((l) => [
          String(l.transaction_date).slice(0, 10).split("-").reverse().join("/"),
          l.description,
          nomeCat.get(l.category_id) ?? "",
          l.account_id ? nomeConta.get(l.account_id) ?? "" : "",
          tipo[l.transaction_type as string] ?? l.transaction_type,
          // O valor sai com o SINAL do banco, de proposito: despesa negativa.
          // Numa planilha e isso que faz a coluna somar sozinha para o saldo
          // do periodo. As telas e os outros relatorios e que precisam de ABS.
          Number(l.amount),
        ])
      );
      nome = nomeArquivoCsv("extrato", janela);
    }

    return new NextResponse(csv, { headers: cabecalhosCsv(nome) });
  } catch (error) {
    console.error("Erro ao exportar relatório:", error);

    // A LEITURA QUE FALHOU DIZ O NOME DELA (HMO-378)
    //
    // "Erro interno" sobre um export de oito consultas manda quem recebeu o 500
    // abrir a rota e adivinhar qual nao leu. O `instanceof` e o que separa esta
    // falha de um defeito de programacao: as duas respondem 500, mas repetir a
    // mensagem de um `TypeError` no corpo vazaria caminho de arquivo e nome de
    // variavel. So a falha de leitura tem corpo proprio.
    if (error instanceof FalhaDeLeituraDoExport) {
      return NextResponse.json(
        {
          error: `Não foi possível ler ${error.consulta}. O arquivo não foi gerado: um CSV incompleto não teria como se explicar na planilha.`,
          consulta: error.consulta,
          detalhe: error.detalhe,
          codigo: error.codigo,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
