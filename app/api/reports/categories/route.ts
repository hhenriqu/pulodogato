// GET /api/reports/categories?months=1&groupId=<uuid>
// GET /api/reports/categories?de=AAAA-MM-DD&ate=AAAA-MM-DD&groupId=<uuid>
//
// Gasto por categoria no periodo. Sai de `category_monthly_totals` (008).
//
// A view devolve uma linha por (mes, categoria); aqui os meses da janela sao
// somados por categoria, porque a pergunta da tela e "no que eu gastei", nao
// "no que eu gastei em cada mes". O detalhamento mes a mes continua disponivel
// em `by_month` para o grafico de barras empilhadas.
//
// AS DUAS FORMAS DE PERGUNTAR (HMO-201, parte 3)
// ----------------------------------------------
// `?months=N` continua significando o que sempre significou: uma janela de N
// meses terminando no mes corrente. A tela de relatorios pergunta assim.
//
// `?de=&ate=` e o periodo escolhido -- e e o que o painel do grupo precisava,
// porque com `months` nao da nem para pedir "o mes passado". Quando o periodo
// e uma uniao de meses INTEIROS a resposta sai das mesmas views, e tem que
// sair: senao o painel e o relatorio dariam numeros diferentes para o mesmo
// mes. Quando nao e (15/09 a 20/10), nenhum rollup mensal responde e a soma
// passa a ser feita sobre `financial_transactions` recortada por data.
//
// Nesse segundo caminho `by_month` volta VAZIO, pelo mesmo motivo que
// `/api/reports/cash-flow` devolve `months: []`: uma serie mensal desenhada a
// partir de um intervalo que corta meses pela metade seria um grafico de meses
// que nao existiram. Quem consome olha `grao`.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { lerPreferenciaDeMoeda, separarSeriePorMoeda } from "@/lib/moeda";
import { janelaDeMeses } from "@/lib/services/reports";
import {
  mesesDoPeriodo,
  periodoDaQuery,
  ultimoDiaDoMes,
} from "@/lib/periodo-do-painel";
import { linhasDeCategoria } from "@/lib/categorias-do-periodo";
import {
  COLUNAS_DA_PARTE_DE_GRUPO,
  partesComoTransacoes,
  viewDaParteAusente,
  type ParteDeGrupoCrua,
} from "@/lib/parte-do-grupo-realizada";

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

    // A moeda oficial decide qual bloco e o PRINCIPAL da resposta. Lida nos
    // dois caminhos, e sem derrubar nada quando falha: erro aqui cai no padrao
    // de `lerPreferenciaDeMoeda` e nao custa o relatorio inteiro.
    const perfilPromessa = supabase
      .from("profiles")
      .select("preferences")
      .eq("id", user.id)
      .maybeSingle();

    // ---------------------------------------------------------------------
    // Modo intervalo: nenhuma view responde, a soma vem das transacoes
    // ---------------------------------------------------------------------
    if (periodo && periodo.modo === "intervalo") {
      // A consulta e remontada a cada pagina: o builder do supabase-js e de
      // uso unico, e reaproveitar o mesmo objeto acumularia os `.range()`.
      const pagina = (inicio: number) => {
        const base = supabase
          .from("financial_transactions")
          .select("category_id, amount, transaction_type, currency")
          .gte("transaction_date", periodo.de)
          // `lte` e nao `lt`: o periodo e fechado nos dois extremos, e o
          // ultimo dia escolhido pelo usuario tem que entrar.
          .lte("transaction_date", periodo.ate)
          // Ordem estavel: sem ela, duas paginas podem repetir e pular linhas.
          .order("id", { ascending: true })
          .range(inicio, inicio + TAMANHO_DA_PAGINA - 1);

        return groupId
          ? base.eq("group_id", groupId)
          : base.eq("user_id", user.id).is("group_id", null);
      };

      // Paginar porque a SOMA e feita no JavaScript sobre as linhas cruas. O
      // PostgREST tem teto de linhas por resposta; batendo nele a resposta vem
      // truncada e SEM ERRO -- o total do periodo sairia menor que o real, com
      // cara de numero certo. Mesma razao da paginacao em reports/cash-flow.
      const transacoes: {
        category_id: string | null;
        amount: number | string;
        transaction_type: string | null;
        currency?: string | null;
      }[] = [];

      for (let inicio = 0; ; inicio += TAMANHO_DA_PAGINA) {
        const { data, error } = await pagina(inicio);

        if (error) {
          console.error("Erro no relatório por categoria (intervalo):", error);
          return NextResponse.json(
            { error: "Não foi possível montar o relatório" },
            { status: 500 }
          );
        }

        const lote = data ?? [];
        for (const linha of lote) transacoes.push(linha);
        // Pagina incompleta = acabou. Uma pagina cheia pode ser a ultima, e
        // nesse caso a proxima volta vazia e o laco encerra do mesmo jeito.
        if (lote.length < TAMANHO_DA_PAGINA) break;
      }

      // A MINHA PARTE DAS DESPESAS DE GRUPO, no mesmo intervalo (HMO-202).
      //
      // Le a MESMA view que o modo intervalo de /api/reports/cash-flow le, pelo
      // mesmo recorte de datas: e isso que mantem o total do fluxo igual a soma
      // das categorias quando o periodo corta meses pela metade. Duas consultas
      // diferentes aqui seriam duas definicoes de "minha parte", e a primeira
      // divergencia apareceria como uma pizza que nao fecha em 100%.
      if (!groupId) {
        const paginaDeParte = (inicio: number) =>
          supabase
            .from("group_share_entries")
            .select(COLUNAS_DA_PARTE_DE_GRUPO)
            .eq("user_id", user.id)
            .gte("transaction_date", periodo.de)
            .lte("transaction_date", periodo.ate)
            .order("id", { ascending: true })
            .range(inicio, inicio + TAMANHO_DA_PAGINA - 1);

        const partes: ParteDeGrupoCrua[] = [];

        for (let inicio = 0; ; inicio += TAMANHO_DA_PAGINA) {
          const { data, error } = await paginaDeParte(inicio);

          // A janela entre o deploy e a colagem da 033: segue sem a parte de
          // grupo, que e o comportamento antigo. Ver viewDaParteAusente.
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

        for (const linha of partesComoTransacoes(partes)) transacoes.push(linha);
      }

      const { data: perfilDoIntervalo } = await perfilPromessa;
      const moedaDoIntervalo = lerPreferenciaDeMoeda(
        perfilDoIntervalo?.preferences
      ).oficial;

      return montarResposta({
        supabase,
        linhas: linhasDeCategoria(transacoes, moedaDoIntervalo).map((l) => ({
          ...l,
          month: null,
        })),
        moedaOficial: moedaDoIntervalo,
        grao: "intervalo",
        janela: { from: periodo.de, to: periodo.ate, months: null },
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

    // DUAS VIEWS (HMO-202), pela mesma razao de /api/reports/cash-flow.
    //
    // No relatorio de GRUPO nao se filtra por user_id: o ponto e ver o gasto da
    // viagem inteira, de todos os membros. A RLS ja garante que so os membros
    // enxergam essas linhas.
    //
    // No PESSOAL a view e `personal_category_monthly_totals` (033), que soma o
    // que e so do usuario com a PARTE dele das despesas de grupo -- e ai o
    // `eq("user_id")` passa a ser obrigatorio e nao higiene: as policies de
    // grupo tem `OR is_group_member(...)` e sem ele viria a parte dos outros
    // membros tambem.
    //
    // Tem que ser a mesma fonte que o cash-flow usa, senao o total do fluxo e a
    // soma das categorias deixam de bater e a pizza do painel nao fecha em 100%.
    const query = groupId
      ? supabase
          .from("category_monthly_totals")
          .select("month, category_id, expense, income, transaction_count, currency")
          .gte("month", janela.inicio)
          .lte("month", janela.fim)
          .eq("group_id", groupId)
      : supabase
          .from("personal_category_monthly_totals")
          .select("month, category_id, expense, income, transaction_count, currency")
          .gte("month", janela.inicio)
          .lte("month", janela.fim)
          .eq("user_id", user.id);

    const [primeiraTentativa, { data: perfil }] = await Promise.all([
      query,
      perfilPromessa,
    ]);

    let { data, error } = primeiraTentativa;

    // A janela entre o deploy e a colagem da 033: cai para a view antiga em vez
    // de 500. Ver viewDaParteAusente em lib/parte-do-grupo-realizada.ts.
    if (error && !groupId && viewDaParteAusente(error)) {
      const antiga = await supabase
        .from("category_monthly_totals")
        .select("month, category_id, expense, income, transaction_count, currency")
        .gte("month", janela.inicio)
        .lte("month", janela.fim)
        .eq("user_id", user.id)
        .is("group_id", null);

      data = antiga.data;
      error = antiga.error;
    }

    if (error) {
      console.error("Erro no relatório por categoria:", error);
      return NextResponse.json(
        { error: "Não foi possível montar o relatório" },
        { status: 500 }
      );
    }

    return montarResposta({
      supabase,
      linhas: (data ?? []).map((l) => ({
        category_id: l.category_id as string,
        expense: Number(l.expense),
        income: Number(l.income),
        transaction_count: Number(l.transaction_count),
        currency: l.currency as string | null,
        month: String(l.month).slice(0, 10),
      })),
      moedaOficial: lerPreferenciaDeMoeda(perfil?.preferences).oficial,
      grao: "mes",
      janela: {
        from: janela.inicio,
        // O `to` e o ULTIMO DIA do ultimo mes, nao o dia 1 dele. `janela.fim`
        // e dia 1 por construcao (a chave da view e `date_trunc('month',...)`)
        // e devolver isso como fim de janela ja cortou um mes inteiro de um
        // consumidor antes -- ver a nota em app/api/reports/export/route.ts.
        to: ultimoDiaDoMes(janela.fim),
        months: janela.meses,
      },
    });
  } catch (error) {
    console.error("Erro na API de relatórios:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/** Uma linha ja normalizada, venha ela da view ou das transacoes cruas. */
interface LinhaNormalizada {
  category_id: string;
  expense: number;
  income: number;
  transaction_count: number;
  currency: string | null;
  /** `null` no modo intervalo: ali nao ha mes a que a linha pertenca. */
  month: string | null;
}

/**
 * O resto da rota, identico para os dois caminhos.
 *
 * Existe como funcao porque os dois modos precisam produzir EXATAMENTE a mesma
 * forma de resposta -- mesma ordenacao, mesmas fatias, mesmo bloco principal.
 * Duas copias dessa montagem seriam duas chances de o painel e o relatorio
 * discordarem sobre o mesmo periodo, que e o defeito que a HMO-173 ja
 * consertou uma vez no fluxo de caixa.
 */
async function montarResposta({
  supabase,
  linhas,
  moedaOficial,
  grao,
  janela,
}: {
  supabase: ReturnType<typeof createClient>;
  linhas: LinhaNormalizada[];
  moedaOficial: string;
  grao: "mes" | "intervalo";
  janela: { from: string; to: string; months: number | null };
}) {
  try {
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
    const blocos = separarSeriePorMoeda(linhas, moedaOficial).map((grupo) => {
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
      grao,
      // VAZIO no modo intervalo, de proposito: um grafico mes a mes desenhado
      // a partir de um periodo que corta meses pela metade seria um grafico de
      // meses que nao existiram. Quem consome olha `grao` -- mesma decisao que
      // `/api/reports/cash-flow` tomou para `months`.
      by_month: linhas
        .filter((l): l is LinhaNormalizada & { month: string } =>
          Boolean(l.month)
        )
        .map((l) => ({
          month: l.month.slice(0, 10),
          category_id: l.category_id,
          category_name: porId.get(l.category_id)?.name ?? "Sem categoria",
          expense: l.expense,
          income: l.income,
          // A moeda vai na linha do grafico mes a mes tambem. Sem ela, a barra
          // empilhada soma reais com dolares na altura da coluna -- e uma
          // barra nao tem como mostrar que esta errada.
          currency: l.currency ?? "BRL",
        })),
      summary: {
        total_expense: principal?.total_expense ?? 0,
        category_count: categoriasOrdenadas.length,
      },
      window: janela,
    });
  } catch (error) {
    console.error("Erro na API de relatórios:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
