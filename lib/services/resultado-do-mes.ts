// =============================================================================
// O RESULTADO DO MES -- UMA LEITURA SO PARA TODAS AS TELAS (mapa, prioridade 1)
// =============================================================================
// "Quanto entrou, quanto saiu e qual foi o Resultado" do usuario num periodo.
// Antes deste arquivo cada tela montava essa resposta do seu jeito:
//
//   tela                         como somava                        defeito
//   ---------------------------  ---------------------------------  ---------------------------
//   painel (/dashboard)          as cinco pernas, dentro da rota    -- (era o numero certo)
//                                /api/reports/cash-flow
//   relatorios                   `personal_monthly_cash_flow`       -- (mesmo criterio, no banco)
//   Financas Pessoais            no navegador, sobre as linhas JA   com mais de uma pagina no
//                                CARREGADAS da lista                mes, os tres cartoes somavam
//                                                                   so a primeira pagina
//   resumo mensal (e-mail/push)  `monthly_cash_flow`, a view do     cartao pela compra, sem a
//                                criterio antigo                    parte de grupo, sem o
//                                                                   fechamento e sem o MyBank
//
// Agora as quatro leem daqui. As duas funcoes abaixo sao as DUAS FORMAS da
// mesma resposta, e nao duas respostas:
//
//   `lerResultadoDoPeriodo` -> qualquer periodo (15/09 a 20/10, ou o mes ate
//                              hoje). Soma as linhas cruas no JavaScript.
//   `lerResultadoPorMes`    -> meses inteiros, um balde por mes. Le
//                              `personal_monthly_cash_flow`, que e o rollup da
//                              `personal_category_monthly_totals` (072).
//
// As duas aplicam o MESMO criterio, perna por perna -- a view no SQL, a
// primeira aqui -- e e isso que faz "setembro inteiro" e "01/09 a 30/09" darem
// o mesmo numero:
//
//   perna  de onde vem                       o que entra
//   -----  --------------------------------  ----------------------------------------
//   1      financial_transactions            o que e meu, INTEIRO quando eu paguei
//                                            (inclusive a despesa de grupo), menos a
//                                            compra/estorno no cartao e menos a linha
//                                            "fora dos totais"
//   2      group_share_entries               a MINHA PARTE do que OUTRO pagou
//                                            (`paguei_eu = false`)
//   3      group_closing_entries             a conta do fechamento do grupo ja quitada
//   4      mybank_interest_entries           o juro pago do MyBank, de quem pegou
//   5      card_invoice_paid_entries         a fatura paga, no mes do vencimento
//
// Os racionais de cada perna (por que `eq("user_id")` e load-bearing, por que
// paginar, por que o cartao sai pela fatura) estao no cabecalho de
// app/api/reports/cash-flow/route.ts e nos comentarios abaixo, que vieram de
// la junto com o codigo.
//
// O QUE NAO E ESTE NUMERO
// -----------------------
//   * O «Previsto» (o que ainda vai acontecer) -- outra pergunta, outras rotas.
//   * A aba Despesas/Receitas (/api/movimentacoes/resumo): ela responde "quanto
//     sai da sua conta" por tipo, e nao o Resultado. A diferenca e de proposito
//     e tem legenda (lib/legenda-do-bruto-e-do-liquido.ts).
//   * O cartao "Saldo" do painel: e a soma do `current_balance` das contas, um
//     estoque, e nao o Resultado do periodo, que e um fluxo.
//   * O painel DO GRUPO: la o numero e o valor CHEIO da despesa de todos os
//     membros, e a rota de cash-flow continua lendo `monthly_cash_flow`.
//
// Nao importa nada de servidor: Financas Pessoais chama do navegador com o
// cliente dela, e a RLS e a mesma.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  agregarTransacoesPorMoeda,
  type BlocoDeFluxoPorMoeda,
  type ResumoDeFluxo,
} from "@/lib/periodo-do-painel";
import { lerPreferenciaDeMoeda } from "@/lib/moeda";
import { lerContasDoFechamentoRealizadas } from "@/lib/services/fechamento-no-resultado";
import { lerJurosPagosDoMyBank } from "@/lib/services/divida-do-mybank";
import { lerFaturasPagas } from "@/lib/services/fatura-paga-no-resultado";
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

/** Quantas linhas por ida ao banco. Ver "POR QUE PAGINAR" abaixo. */
export const TAMANHO_DA_PAGINA_DO_RESULTADO = 1000;

/** Qual perna falhou -- vai para o log de quem chama. */
export type EtapaDoResultado =
  | "transacoes"
  | "parte-de-grupo"
  | "fechamento"
  | "juros-do-mybank"
  | "fatura-paga";

export interface ResultadoDoPeriodo {
  /** A moeda oficial do usuario, que decide qual bloco e o principal. */
  moeda: string;
  /**
   * Um bloco por moeda, o principal primeiro. Vazio quando o periodo nao tem
   * movimento nenhum.
   */
  blocos: BlocoDeFluxoPorMoeda[];
  /** O bloco principal, ou zerado na moeda oficial. */
  principal: BlocoDeFluxoPorMoeda;
}

export type LeituraDoResultado =
  | ({ ok: true } & ResultadoDoPeriodo)
  | { ok: false; etapa: EtapaDoResultado; erro: unknown };

export interface PedidoDoResultado {
  /** Primeiro dia, INCLUSIVE, 'AAAA-MM-DD'. */
  de: string;
  /** Ultimo dia, INCLUSIVE, 'AAAA-MM-DD'. */
  ate: string;
  /**
   * Ate quando ler a FATURA PAGA, quando for depois de `ate`. E o `?faturaAte=`
   * do painel: o Realizado para em hoje, mas a fatura paga que vence depois de
   * hoje, dentro do periodo, ja aconteceu -- ela saiu do Previsto quando foi
   * paga. Sem ele, ela sumiria dos dois lados ate o vencimento.
   */
  faturaAte?: string | null;
  /**
   * A moeda oficial, quando quem chama ja a leu. Sem ela a funcao le
   * `profiles.preferences` -- uma ida a mais ao banco.
   */
  moedaOficial?: string;
}

/** Zerado, na moeda dada: periodo sem movimento nenhum. */
export function resultadoVazio(moeda: string): BlocoDeFluxoPorMoeda {
  return {
    currency: moeda,
    symbol: "",
    summary: {
      total_income: 0,
      total_expense: 0,
      net: 0,
      transaction_count: 0,
    },
  };
}

/**
 * O bloco da moeda pedida, ou zerado nela.
 *
 * Para quem mostra UM numero (os tres cartoes de Financas Pessoais): somar os
 * blocos juntaria real com dolar, que e o defeito que a 022 tirou das views.
 */
export function resumoNaMoeda(
  resultado: ResultadoDoPeriodo,
  moeda: string = resultado.moeda
): ResumoDeFluxo {
  return (
    resultado.blocos.find((b) => b.currency === moeda)?.summary ??
    resultadoVazio(moeda).summary
  );
}

/** A moeda oficial do usuario. Falha cai no padrao, e nao custa a leitura. */
export async function lerMoedaOficial(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", userId)
    .maybeSingle();
  return lerPreferenciaDeMoeda(data?.preferences).oficial;
}

/**
 * O Resultado do usuario num periodo qualquer, com as cinco pernas.
 *
 * E o numero do «Realizado» do painel, e e o que Financas Pessoais mostra nos
 * tres cartoes. `userId` e obrigatorio e e LOAD-BEARING: as policies de grupo
 * sao `user_id = auth.uid() OR is_group_member(group_id)`, entao sem o filtro
 * a leitura traria a despesa e a parte dos OUTROS membros (medido: 400 em vez
 * de 200 num grupo de dois).
 */
export async function lerResultadoDoPeriodo(
  supabase: SupabaseClient,
  userId: string,
  pedido: PedidoDoResultado
): Promise<LeituraDoResultado> {
  const { de, ate } = pedido;
  const faturaAte = pedido.faturaAte ?? null;

  const moeda =
    pedido.moedaOficial ?? (await lerMoedaOficial(supabase, userId));

  // ---------------------------------------------------------------------
  // PERNA 1 -- financial_transactions
  // ---------------------------------------------------------------------
  // SEM `is("group_id", null)` (HMO-418): a despesa de grupo que EU paguei
  // entra INTEIRA. Ela so esta correta porque a perna 2 descarta `paguei_eu`;
  // sem isso o valor cheio e a minha parte dele somariam a mesma despesa duas
  // vezes (1.040,00 na fixture de maio, contra 1.010,00 aprovado).
  //
  // A consulta e remontada a cada pagina: o builder do supabase-js e de uso
  // unico, e reaproveitar o mesmo objeto acumularia os `.range()`.
  //
  // `lte` e nao `lt`: o periodo e fechado nos dois extremos. Ordem por `id`
  // estavel: sem ela, duas paginas podem repetir e pular linhas.
  //
  // POR QUE PAGINAR: a soma e feita aqui, sobre as linhas cruas. O PostgREST
  // tem teto de linhas por resposta; batendo nele a resposta vem truncada e sem
  // erro -- o total sairia MENOR que o real, com cara de numero certo. Foi
  // exatamente o defeito dos cartoes de Financas Pessoais, que somavam so a
  // pagina da lista que estava na tela.
  const pagina = (inicio: number) =>
    supabase
      .from("financial_transactions")
      .select(COLUNAS_DO_REALIZADO_DE_CAIXA)
      .gte("transaction_date", de)
      .lte("transaction_date", ate)
      .order("id", { ascending: true })
      .range(inicio, inicio + TAMANHO_DA_PAGINA_DO_RESULTADO - 1)
      .eq("user_id", userId);

  const linhas: LinhaDoRealizado[] = [];

  for (let inicio = 0; ; inicio += TAMANHO_DA_PAGINA_DO_RESULTADO) {
    const { data, error } = await pagina(inicio);
    if (error) return { ok: false, etapa: "transacoes", erro: error };

    const lote = data ?? [];
    // O FORA-DOS-TOTAIS (HMO-453) sai aqui, no leitor da TABELA, antes das
    // outras pernas: o que eu devo (perna 2) nao muda porque quem lancou
    // escondeu a linha do relatorio dele, e a fatura (perna 5) aplica o mesmo
    // filtro nas linhas dela.
    for (const linha of apenasNosTotais(lote as unknown as LinhaDoRealizado[]))
      linhas.push(linha);
    // Pagina incompleta = acabou.
    if (lote.length < TAMANHO_DA_PAGINA_DO_RESULTADO) break;
  }

  // ---------------------------------------------------------------------
  // PERNA 2 -- a MINHA PARTE do que OUTRO pagou (HMO-202, HMO-418)
  // ---------------------------------------------------------------------
  // `paguei_eu = false` e o espelho do `WHERE NOT g.paguei_eu` da 046. O que
  // EU paguei ja veio INTEIRO na perna 1.
  const paginaDeParte = (inicio: number) =>
    supabase
      .from("group_share_entries")
      .select(COLUNAS_DA_PARTE_DE_GRUPO)
      .eq("user_id", userId)
      .eq("paguei_eu", false)
      .gte("transaction_date", de)
      .lte("transaction_date", ate)
      .order("id", { ascending: true })
      .range(inicio, inicio + TAMANHO_DA_PAGINA_DO_RESULTADO - 1);

  const partes: ParteDeGrupoCrua[] = [];

  for (let inicio = 0; ; inicio += TAMANHO_DA_PAGINA_DO_RESULTADO) {
    const { data, error } = await paginaDeParte(inicio);

    // A janela entre o deploy e a colagem da 033: a view nao existe ainda.
    // Segue sem a parte de grupo, que e o comportamento antigo.
    if (error && viewDaParteAusente(error)) {
      partes.length = 0;
      break;
    }
    if (error) return { ok: false, etapa: "parte-de-grupo", erro: error };

    const lote = data ?? [];
    for (const linha of lote) partes.push(linha);
    if (lote.length < TAMANHO_DA_PAGINA_DO_RESULTADO) break;
  }

  for (const linha of partesComoTransacoes(partes)) linhas.push(linha);

  // ---------------------------------------------------------------------
  // PERNA 3 -- a conta do fechamento do grupo ja quitada (069, RN017.6)
  // ---------------------------------------------------------------------
  const doFechamento = await lerContasDoFechamentoRealizadas(
    supabase,
    userId,
    de,
    ate
  );
  if (!doFechamento.ok)
    return { ok: false, etapa: "fechamento", erro: doFechamento.erro };
  for (const linha of partesComoTransacoes(doFechamento.contas))
    linhas.push(linha);

  // ---------------------------------------------------------------------
  // PERNA 4 -- o juro pago do MyBank, do lado de quem pegou (071, RN021.3)
  // ---------------------------------------------------------------------
  const jurosPagos = await lerJurosPagosDoMyBank(supabase, userId, de, ate);
  if (!jurosPagos.ok)
    return { ok: false, etapa: "juros-do-mybank", erro: jurosPagos.erro };
  for (const linha of partesComoTransacoes(jurosPagos.juros))
    linhas.push(linha);

  // ---------------------------------------------------------------------
  // PERNA 5 -- a fatura paga, pelo VENCIMENTO (072, RN017.4)
  // ---------------------------------------------------------------------
  const faturas = await lerFaturasPagas(supabase, userId, de, faturaAte ?? ate);
  if (!faturas.ok)
    return { ok: false, etapa: "fatura-paga", erro: faturas.erro };

  // A regra do cartao tira a compra/estorno no cartao e poe a fatura paga, e
  // NAO soma nada: `agregarTransacoesPorMoeda` continua sendo a unica funcao
  // que soma. As linhas das pernas 2 a 4 nao tem conta e atravessam intactas.
  const blocos = agregarTransacoesPorMoeda(
    realizadoComCartaoPelaFatura(linhas, faturas.linhas),
    moeda
  );

  return {
    ok: true,
    moeda,
    blocos,
    principal: blocos[0] ?? resultadoVazio(moeda),
  };
}

// =============================================================================
// POR MES -- personal_monthly_cash_flow
// =============================================================================

/** Uma linha de `personal_monthly_cash_flow`: um mes, uma moeda. */
export interface ResultadoDoMes {
  /** Primeiro dia do mes, 'AAAA-MM-01'. */
  month: string;
  income: number;
  expense: number;
  net: number;
  transaction_count: number;
  currency: string;
}

export type LeituraPorMes =
  | {
      ok: true;
      meses: ResultadoDoMes[];
      /**
       * `true` quando `personal_monthly_cash_flow` ainda nao existe (antes da
       * 033) e a resposta saiu de `monthly_cash_flow` sem grupo -- o criterio
       * antigo, que e o estado em que o banco ainda estaria.
       */
      criterioAntigo: boolean;
    }
  | { ok: false; erro: unknown };

export interface PedidoPorMes {
  /** Primeiro mes, 'AAAA-MM-01', INCLUSIVE. */
  desde: string;
  /** Ultimo mes, 'AAAA-MM-01', INCLUSIVE. Sem ele, ate o fim da serie. */
  ate?: string;
  /** So esta moeda. Sem ela, todas, uma linha por (mes, moeda). */
  moeda?: string;
}

/**
 * O Resultado do usuario mes a mes, com as cinco pernas -- a view
 * `personal_monthly_cash_flow`, que e o mesmo criterio de
 * `lerResultadoDoPeriodo` aplicado no banco.
 *
 * Ordenado por mes. Um mes com duas moedas tem DUAS linhas; quem soma meses
 * tem de separar por `currency` antes.
 */
export async function lerResultadoPorMes(
  supabase: SupabaseClient,
  userId: string,
  pedido: PedidoPorMes
): Promise<LeituraPorMes> {
  const montar = (view: "personal_monthly_cash_flow" | "monthly_cash_flow") => {
    let q = supabase
      .from(view)
      .select("month, income, expense, net, transaction_count, currency")
      // LOAD-BEARING na pessoal: sem ele a policy de grupo devolve a parte dos
      // OUTROS membros junto.
      .eq("user_id", userId)
      .gte("month", pedido.desde);
    if (pedido.ate) q = q.lte("month", pedido.ate);
    if (pedido.moeda) q = q.eq("currency", pedido.moeda);
    // Na antiga, so a linha pessoal: as de grupo tem `user_id` = quem pagou e
    // `group_id` preenchido, e somariam a viagem inteira no resumo de um.
    if (view === "monthly_cash_flow") q = q.is("group_id", null);
    return q.order("month", { ascending: true });
  };

  const primeira = await montar("personal_monthly_cash_flow");
  let { data, error } = primeira;
  let criterioAntigo = false;

  // A janela entre o deploy e a colagem da 033 (ver `viewDaParteAusente`).
  if (error && viewDaParteAusente(error)) {
    const antiga = await montar("monthly_cash_flow");
    data = antiga.data;
    error = antiga.error;
    criterioAntigo = true;
  }

  if (error) return { ok: false, erro: error };

  return {
    ok: true,
    criterioAntigo,
    meses: ((data ?? []) as Array<Record<string, unknown>>).map((l) => ({
      month: String(l.month),
      income: Number(l.income ?? 0),
      expense: Number(l.expense ?? 0),
      net: Number(l.net ?? 0),
      transaction_count: Number(l.transaction_count ?? 0),
      currency: String(l.currency ?? ""),
    })),
  };
}
