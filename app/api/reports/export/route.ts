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

      // ESTA ROTA NUNCA CONFERIU `error`, NOS CINCO RELATORIOS: uma falha de
      // leitura sai como CSV so-cabecalho, que na planilha se le como "nao
      // houve movimento no periodo". Consertar isso e mudar o contrato dos
      // outros quatro ramos e nao cabe na HMO-207; registrar, cabe -- sem o log
      // o modo de falha nao existe em lugar nenhum.
      if (error) console.error("Erro ao exportar fluxo de caixa:", error);

      // A coluna "Moeda" e o que mantem este CSV correto depois da 022. Ele nao
      // agrega nada -- despeja as linhas da view -- entao um mes com duas moedas
      // vira DUAS linhas do mesmo mes. Sem a coluna, quem abre a planilha ve o
      // mes repetido com dois valores diferentes e nada dizendo por que, e a
      // primeira reacao de qualquer um e somar as duas.
      csv = montarCsv(
        ["Mês", "Moeda", "Entradas", "Saídas", "Resultado", "Lançamentos"],
        (data ?? []).map((d) => [
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

      if (error) console.error("Erro ao exportar gastos por categoria:", error);

      const linhas = data ?? [];
      const ids = Array.from(new Set(linhas.map((l) => l.category_id)));
      const { data: categorias } = ids.length
        ? await supabase
            .from("transaction_categories")
            .select("id, name")
            .in("id", ids)
        : { data: [] };
      const porId = new Map((categorias ?? []).map((c) => [c.id, c.name]));

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

      const { data } = await (groupId
        ? q.eq("group_id", groupId)
        : q.is("group_id", null)
      ).order("month", { ascending: true });

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
        (data ?? []).map((d) => [
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
      const { data } = await supabase
        .from("net_worth_history")
        .select("month, net_change, net_worth")
        .eq("user_id", user.id)
        .gte("month", janela.inicio)
        .lte("month", janela.fim)
        .order("month", { ascending: true });

      csv = montarCsv(
        ["Mês", "Variação no mês", "Patrimônio no fim do mês"],
        (data ?? []).map((d) => [
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

      const { data } = groupId
        ? await base.eq("group_id", groupId).order("transaction_date")
        : await base
            .eq("user_id", user.id)
            .is("group_id", null)
            .order("transaction_date");

      const linhas = data ?? [];
      const catIds = Array.from(
        new Set(linhas.map((l) => l.category_id).filter(Boolean))
      );
      const contaIds = Array.from(
        new Set(linhas.map((l) => l.account_id).filter(Boolean))
      );

      const [{ data: categorias }, { data: contas }] = await Promise.all([
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

      const nomeCat = new Map((categorias ?? []).map((c) => [c.id, c.name]));
      const nomeConta = new Map((contas ?? []).map((c) => [c.id, c.name]));
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
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
