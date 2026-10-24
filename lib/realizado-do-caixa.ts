// -----------------------------------------------------------------------------
// O CARTAO SO VIRA REALIZADO QUANDO A FATURA E PAGA (HMO-265)
// -----------------------------------------------------------------------------
// "Dashboard ainda esta considerando as despesas do cartao como realizadas, mas
// e como ja disse, despesa do cartao so e realizada quando fatura do cartao e
// paga, usar o valor total do cartao como parametro pra saber se ja foi
// realizada ou nao."
//
// A tela de Despesas ja seguia essa regra desde a HMO-260 (`ehGastoNoCartao` em
// lib/telas-de-movimentacao.ts). O painel nao: o Realizado dele sai de
// `/api/reports/cash-flow`, que soma `monthly_cash_flow` / as linhas cruas de
// `financial_transactions` -- e ali a compra no cartao e uma despesa como
// qualquer outra, contada no dia da COMPRA.
//
// AS DUAS METADES SAO UMA SO MUDANCA, E SEPARA-LAS ERRA DINHEIRO
// -------------------------------------------------------------
// Este modulo faz duas coisas sobre a mesma lista, e nenhuma das duas esta certa
// sozinha:
//
//   1. TIRA a linha do cartao: a compra e o estorno. Elas estao DENTRO da
//      fatura, e a fatura e que vai contar.
//   2. SOMA a fatura paga, uma linha por fatura (`faturasPagasComoTransacoes`,
//      lib/fatura-paga-no-resultado.ts), com o total das linhas dela.
//
// So a 1: o mes da fatura perde o valor dela. Um mes em que vencia uma fatura de
// R$ 1.290 aparece R$ 1.290 MAIS BARATO, e um total menor nao parece erro --
// parece um mes barato. E o defeito que a HMO-264 descreve na tela de Despesas,
// trazido para o painel.
//
// So a 2: a compra continua somada no dia da compra E a fatura soma de novo no
// vencimento. O cartao conta DUAS vezes, que e a HMO-149 de volta.
//
// A FASE 6 DO MODELO NOVO MUDOU A SEGUNDA METADE (RN017.3, RN017.4, 072)
// --------------------------------------------------------------------
// Da HMO-265 ate a fase 5 a segunda metade PROMOVIA a perna de saida do
// pagamento da fatura a despesa: o valor pago, no dia do pagamento. Desde a 072
// a fatura conta como o banco a conta no modo mes (perna 5 de
// `personal_category_monthly_totals`):
//
//   * no mes do VENCIMENTO, e nao no do pagamento. Pagar adiantado ou atrasado
//     nao muda o mes;
//   * pelo TOTAL das linhas que contam nos totais, estornos abatidos, e nao pelo
//     valor pago. Pagar diferente nao muda a despesa: a diferenca fica no saldo
//     do cartao;
//   * realizada quando foi paga no app. A fatura aberta continua no Previsto.
//
// A perna de saida volta a ser o que a coluna diz, `transfer`, e todo agregador
// de fluxo a deixa fora.
//
// POR QUE A FATURA SAI DA VIEW, E NAO DAS LINHAS DO PERIODO
// ---------------------------------------------------------
// Porque as compras de uma fatura nao estao no periodo dela: a fatura que vence
// em novembro e feita de compras de outubro. A view `card_invoice_paid_entries`
// (072) entrega cada linha de fatura paga com o vencimento dela, e e por ele que
// a rota recorta.
// -----------------------------------------------------------------------------

import {
  TIPO_CARTAO,
  TIPOS_QUE_ENTRAM_NA_FATURA,
} from "@/lib/telas-de-movimentacao";
import type { LinhaComTotais } from "@/lib/fora-dos-totais";
import {
  faturasPagasComoTransacoes,
  type LinhaDaFaturaPaga,
} from "@/lib/fatura-paga-no-resultado";

/**
 * Uma linha somavel pelos agregadores de fluxo, com o que esta regra precisa
 * ler a mais.
 *
 * TODOS OS CAMPOS NOVOS SAO OPCIONAIS, e isso nao e frouxidao: a MESMA lista
 * recebe tambem as linhas de `group_share_entries` convertidas por
 * `partesComoTransacoes` (lib/parte-do-grupo-realizada.ts), que nao tem conta.
 * Elas atravessam este modulo intactas -- a minha parte de uma despesa de grupo
 * nao e linha de fatura minha.
 */
export interface LinhaDoRealizado extends LinhaComTotais {
  amount: number | string;
  transaction_type: string | null;
  currency?: string | null;
  /**
   * O embed da conta. DUAS FORMAS POSSIVEIS, e nao e paranoia -- ver
   * `contaDaLinha`.
   */
  account?: ContaDaLinha | ContaDaLinha[] | null;
}

/** O que esta regra precisa saber sobre a conta da linha. */
export interface ContaDaLinha {
  account_type?: string | null;
}

/**
 * A conta da linha, venha o embed objeto ou array de um.
 *
 * `financial_transactions` e TABELA, e ali o supabase-js resolve muitos-para-um
 * e devolve objeto -- mas a rota entrega a resposta atravessando um `as`, e o
 * `tsc` nao verifica nada nessa fronteira. Se o embed chegasse array,
 * `linha.account.account_type` seria `undefined` em TODA linha, nenhuma casaria
 * com `credit_card`, e o painel voltaria a contar a compra no cartao no dia da
 * compra -- sem erro, sem log e com o tsc verde. Mesma armadilha da HMO-209.
 */
function contaDaLinha(linha: LinhaDoRealizado): ContaDaLinha | null {
  const bruto = linha.account;
  if (!bruto) return null;
  if (Array.isArray(bruto)) return bruto[0] ?? null;
  return bruto;
}

/**
 * Esta linha e uma compra NO CARTAO (e por isso ja esta dentro da fatura)?
 *
 * O nome diz compra, e a pergunta inclui o ESTORNO no cartao: `income` tambem
 * esta em `TIPOS_QUE_ENTRAM_NA_FATURA`, e ele abate a fatura que vai contar.
 *
 * Os dois criterios de `ehGastoNoCartao` (HMO-260), pelas mesmas duas razoes:
 *
 *   * a conta e um cartao de credito;
 *   * e o `transaction_type` GRAVADO esta em `TIPOS_QUE_ENTRAM_NA_FATURA`, que e
 *     a copia do `WHERE` da view `card_invoice_lines`. So pode sair daqui a
 *     linha que a fatura de fato CONTEM. Uma compra no cartao com
 *     `transaction_type` NULO nao esta na fatura (ha linha assim em producao);
 *     ela tambem nunca entrou neste agregado, porque todo agregado de fluxo
 *     filtra income/expense -- tirar nao muda nada, e promover seria inventar.
 *
 * SEM CONTA (ou sem conseguir ler a conta) A LINHA FICA. Embed `null` por RLS
 * significa "nao sei", nao "e cartao", e a despesa de grupo e gravada sem
 * `account_id`. Esconder no "nao sei" apagaria despesa legitima do numero que a
 * pessoa abre o painel para ver.
 */
export function ehCompraNoCartao(linha: LinhaDoRealizado): boolean {
  if (contaDaLinha(linha)?.account_type !== TIPO_CARTAO) return false;
  return TIPOS_QUE_ENTRAM_NA_FATURA.has(String(linha.transaction_type));
}

/**
 * A lista do realizado com o cartao contado pela FATURA PAGA, e nao pela compra.
 *
 * Devolve uma lista nova com a linha do cartao FORA e uma linha por fatura paga
 * no fim, `expense` com o total negativo, como `financial_transactions` grava.
 * `faturasPagas` sao as linhas de `card_invoice_paid_entries` que vencem no
 * periodo, e quem recorta e a rota (`lerFaturasPagas`).
 *
 * POR QUE A FATURA ENTRA COMO LINHA, EM VEZ DE SOMAR A PARTE
 * ----------------------------------------------------------
 * Porque assim nenhuma aritmetica muda. `agregarTransacoes` /
 * `agregarTransacoesPorMoeda` (lib/periodo-do-painel.ts) continuam sendo as
 * unicas funcoes que somam -- as que ja sabem que despesa e gravada negativa,
 * que o `Math.abs` vem antes de tudo e que cada moeda e um bloco proprio. Uma
 * segunda soma aqui seria uma segunda versao do mesmo numero, e as duas
 * divergiriam na primeira mudanca. A fatura cujo total e negativo (um estorno
 * maior que as compras) sai `income`, pelo `Math.abs` delas: o Resultado fica o
 * do banco.
 *
 * A `transaction_count` e a unica diferenca para o modo mes: aqui a fatura conta
 * UMA linha, e no banco cada compra dela conta uma.
 */
export function realizadoComCartaoPelaFatura(
  linhas: readonly LinhaDoRealizado[],
  faturasPagas: readonly LinhaDaFaturaPaga[]
): LinhaDoRealizado[] {
  const saida: LinhaDoRealizado[] = [];

  for (const linha of linhas) {
    if (ehCompraNoCartao(linha)) continue;
    saida.push(linha);
  }

  for (const fatura of faturasPagasComoTransacoes(faturasPagas)) {
    saida.push(fatura);
  }

  return saida;
}

/**
 * As colunas que a consulta do realizado precisa pedir para esta regra funcionar.
 *
 * NUMA CONSTANTE PORQUE O EMBED DA CONTA E LOAD-BEARING E NAO APARECE NA TELA.
 * Uma limpeza de "campos nao usados" o tira sem quebrar tsc nem teste de
 * unidade, e o efeito e o de sempre: a regra recebe `undefined`, para de casar,
 * e o painel volta a contar o cartao no dia da compra E na fatura. Ver HMO-260,
 * onde `account_type` foi exatamente isso.
 *
 * `amount`, `transaction_type` e `currency` eram o que a rota ja pedia.
 * `transaction_date` nao entra aqui: ela nao e desta regra -- e o recorte de
 * periodo da rota, que existia antes. `notes` e o elo do 015 sairam na fase 6:
 * eram da promocao da perna de saida, que deixou de existir.
 *
 * `include_in_total` (060, HMO-453) e a QUINTA, e ela e load-bearing do mesmo
 * jeito e por quem NAO esta neste arquivo: quem filtra e a rota, no laco de
 * paginacao (`apenasNosTotais`). Sem a coluna aqui, o ramo de intervalo do
 * relatorio PESSOAL -- e SO ele, porque e o unico que usa esta lista -- receberia o campo
 * `undefined` em toda linha, o predicado `!== false` deixaria tudo passar, e o
 * Realizado do painel voltaria a contar a linha desmarcada. Nenhum `tsc`
 * reclama (o campo e opcional) e nenhum teste de unidade desta funcao nota, o
 * que faz dela a mais facil de perder numa limpeza de "campos nao usados" --
 * exatamente o que aconteceu com `account_type` na HMO-260.
 */
export const COLUNAS_DO_REALIZADO_DE_CAIXA =
  "amount, transaction_type, currency, include_in_total, account:financial_accounts(account_type)";
