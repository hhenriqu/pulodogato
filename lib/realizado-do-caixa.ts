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
//   1. TIRA a compra no cartao. Ela esta DENTRO da fatura, e a fatura e que vai
//      contar.
//   2. PROMOVE a perna de saida do pagamento da fatura a despesa realizada. Ela
//      e gravada como 'transfer' (015), e 'transfer' fica fora de todo agregado
//      de fluxo -- entao sem este passo o valor da fatura nao entra em lugar
//      nenhum.
//
// So a 1: o mes em que a fatura foi paga perde o valor dela. Um mes em que se
// pagou R$ 1.290 de cartao aparece R$ 1.290 MAIS BARATO, e um total menor nao
// parece erro -- parece um mes barato. E o defeito que a HMO-264 descreve na
// tela de Despesas, trazido para o painel.
//
// So a 2: a compra continua somada no dia da compra E a fatura soma de novo no
// dia do pagamento. O cartao conta DUAS vezes, que e a HMO-149 de volta.
//
// POR QUE O VALOR SAI DA PERNA DE SAIDA, E NAO DE `scheduled_transactions.amount`
// ------------------------------------------------------------------------------
// Porque a baixa aceita um valor diferente do previsto (`valorPago` em
// app/api/scheduled-transactions/[id]/pay/route.ts) e NAO reescreve o `amount`
// da linha da agenda -- de proposito, para o relatorio de desvio continuar
// sabendo quanto se previa. Quem sabe quanto dinheiro de fato saiu e a perna de
// saida.
//
// E ela traz mais duas coisas de graca, que ler a agenda exigiria juntar na mao:
//
//   * a DATA. `transaction_date` da perna e o `paid_date`, entao o recorte de
//     periodo que a rota ja faz por data poe a fatura no mes em que ela foi
//     PAGA. Pelo `due_date` seria no mes errado toda vez que alguem pagasse
//     atrasado.
//   * a MOEDA, que `scheduled_transactions` tem mas o agregado por moeda da
//     rota precisa na mesma linha.
//
// POR QUE A DETECCAO E PELA CHAVE EM `notes`, NUNCA PELO TIPO DA CONTA
// --------------------------------------------------------------------
// Mesma razao que lib/card-invoice.ts e a migration 015 ja registram: a
// assinatura cobrada no cartao tambem e uma conta prevista com `account_id` de
// cartao, e pagar aquela conta COM o cartao e despesa de verdade. Quem olhasse
// so `account_type` promoveria qualquer transferencia que toca um cartao a
// despesa do mes.
// -----------------------------------------------------------------------------

import { ehFatura } from "@/lib/card-invoice";
import {
  TIPO_CARTAO,
  TIPOS_QUE_ENTRAM_NA_FATURA,
} from "@/lib/telas-de-movimentacao";

/**
 * Uma linha somavel pelos agregadores de fluxo, com o que esta regra precisa
 * ler a mais.
 *
 * TODOS OS CAMPOS NOVOS SAO OPCIONAIS, e isso nao e frouxidao: a MESMA lista
 * recebe tambem as linhas de `group_share_entries` convertidas por
 * `partesComoTransacoes` (lib/parte-do-grupo-realizada.ts), que nao tem conta,
 * nem `notes`, nem elo. Elas atravessam este modulo intactas -- a minha parte de
 * uma despesa de grupo nao e compra no cartao nem pagamento de fatura.
 */
export interface LinhaDoRealizado {
  amount: number | string;
  transaction_type: string | null;
  currency?: string | null;
  /** A chave canonica da fatura, quando a linha e um pagamento de fatura. */
  notes?: string | null;
  /** O elo do 015. Preenchido APENAS na perna de entrada. */
  counterpart_transaction_id?: string | null;
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
 * Esta linha e a perna de SAIDA do pagamento de uma fatura -- a que diz quanto
 * dinheiro saiu da conta corrente?
 *
 * TRES criterios, e os tres carregam peso:
 *
 *   * `transaction_type === 'transfer'`. E o que a baixa grava (015), e e o que
 *     mantem esta linha fora do agregado hoje.
 *
 *     ESTE PRIMEIRO CRITERIO E UM INVARIANTE, E NAO UM RAMO COM TESTE -- de
 *     proposito, e a nota existe para que ninguem o "cubra" depois forjando
 *     estado. Nenhum caminho de escrita do app produz uma linha com a chave
 *     `fatura:` em `notes` e tipo diferente de 'transfer': o unico escritor e
 *     `POST /api/scheduled-transactions/[id]/pay`, e la o `faturaDaChave(conta
 *     .notes)` desvia TODA conta prevista com a chave para `pagarFatura`, que
 *     grava as duas pernas por `pernasDaTransferencia` -- sempre 'transfer'.
 *     (O `ajuste-de-fatura:` da HMO-253 tem prefixo PROPRIO e nao casa com
 *     `ehFatura`.) O mutante que removia esta linha sobreviveu, e a conclusao
 *     foi escrever este paragrafo em vez de uma assercao sobre um estado que o
 *     app nao alcanca -- uma trava provada so por estado forjado por fora nao
 *     prova nada. Mesma escolha que `ehPernaDeEntrada` faz para `amount === 0`.
 *
 *     Ela fica porque e barata e porque o dia em que a baixa deixar de gravar
 *     'transfer' e o dia em que a promocao passaria a reescrever o tipo de uma
 *     linha que o agregado JA conta.
 *
 *   * `notes` e a chave canonica da fatura (`ehFatura`, ancorada nas duas
 *     pontas). `pagarFatura` copia `conta.notes` para as DUAS pernas, entao a
 *     chave esta la. Sem este criterio, toda transferencia entre contas
 *     proprias -- um Pix da corrente para a poupanca -- viraria despesa do mes.
 *
 *   * e ela nao e a perna de ENTRADA. As duas pernas tem a mesma data, a mesma
 *     chave e o mesmo tipo, e so o SINAL as distingue -- mas `agregarTransacoes`
 *     aplica `Math.abs` antes de somar. Promover as duas nao se anularia: daria
 *     a fatura em DOBRO no total de despesas, com o `net` errado pelo valor
 *     inteiro dela. A mesma armadilha 3 de lib/telas-de-movimentacao.ts.
 *
 * QUAL DAS DUAS E A DE SAIDA: os mesmos dois criterios de `ehPernaDeEntrada`
 * (lib/telas-de-movimentacao.ts), negados. O elo do 015 e de uma via -- quem
 * grava `counterpart_transaction_id` e a perna de ENTRADA, apontando para a de
 * saida -- e o sinal cobre a linha cujo par perdeu o elo (o FK e `ON DELETE SET
 * NULL`).
 *
 * `amount === 0` sem elo nenhum fica fora dos dois lados, e e inofensivo:
 * promover zero nao mudaria numero nenhum.
 *
 * ESTA FUNCAO TEM UM GEMEO, E ELE E DIVIDA CONHECIDA -- HMO-317
 * ------------------------------------------------------------
 * `ehPagamentoDaFatura` (lib/telas-de-movimentacao.ts, HMO-264) responde a MESMA
 * pergunta para a tela de Despesas, com os MESMOS tres criterios -- e ele os
 * escreve delegando os dois ultimos a `ehPernaDeEntrada`, em vez de repetir o
 * elo e o sinal a mao como aqui.
 *
 * E AS DUAS JA DIVERGEM no caso do paragrafo acima: `amount === 0` sem elo fica
 * fora AQUI (o `< 0` e estrito) e ENTRA LA (`ehPernaDeEntrada` deixa as duas
 * linhas de zero passarem de proposito). Nenhum total muda com isso hoje, e e
 * por isso que a divergencia e perigosa: duas copias de um criterio de DINHEIRO
 * que ninguem compara sao a forma exata do defeito que este repositorio ja pagou
 * caro.
 *
 * O DONO FUTURO E `telas-de-movimentacao`, e nao este arquivo: ESTE ja importa
 * `TIPO_CARTAO` e `TIPOS_QUE_ENTRAM_NA_FATURA` de la (foi para isso que a
 * segunda deixou de ser privada na HMO-265), entao inverter a direcao fecharia
 * um ciclo. Quem unificar tem de reverificar o caminho de dinheiro DESTE arquivo
 * -- suite e mutantes proprios --, e em particular reler o primeiro criterio
 * acima: ele e um INVARIANTE com mutante sobrevivente e decisao escrita, nao um
 * ramo com teste. HMO-317.
 */
export function ehSaidaDePagamentoDeFatura(linha: LinhaDoRealizado): boolean {
  if (linha.transaction_type !== "transfer") return false;
  if (!ehFatura(linha.notes)) return false;
  if (linha.counterpart_transaction_id) return false;
  return Number(linha.amount) < 0;
}

/**
 * A lista do realizado com o cartao contado pela FATURA, e nao pela compra.
 *
 * Devolve uma lista nova com a compra no cartao FORA e a perna de saida do
 * pagamento da fatura reescrita como `'expense'`.
 *
 * POR QUE REESCREVER O TIPO, EM VEZ DE SOMAR A FATURA A PARTE
 * -----------------------------------------------------------
 * Porque assim nenhuma aritmetica muda. `agregarTransacoes` /
 * `agregarTransacoesPorMoeda` (lib/periodo-do-painel.ts) continuam sendo as
 * unicas funcoes que somam -- as que ja sabem que despesa e gravada negativa,
 * que o `Math.abs` vem antes de tudo e que cada moeda e um bloco proprio. Uma
 * segunda soma aqui seria uma segunda versao do mesmo numero, e as duas
 * divergiriam na primeira mudanca.
 *
 * O objeto e COPIADO (`{ ...linha, transaction_type: "expense" }`) e nao mutado:
 * as linhas chegam do PostgREST e a mesma lista e lida mais de uma vez na rota
 * (uma vez por moeda). Mutar aqui seria um efeito a distancia que nao aparece em
 * nenhuma das duas funcoes.
 */
export function realizadoComCartaoPelaFatura<T extends LinhaDoRealizado>(
  linhas: readonly T[]
): T[] {
  const saida: T[] = [];

  for (const linha of linhas) {
    if (ehCompraNoCartao(linha)) continue;
    if (ehSaidaDePagamentoDeFatura(linha)) {
      saida.push({ ...linha, transaction_type: "expense" });
      continue;
    }
    saida.push(linha);
  }

  return saida;
}

/**
 * As colunas que a consulta do realizado precisa pedir para esta regra funcionar.
 *
 * NUMA CONSTANTE PORQUE AS QUATRO SAO LOAD-BEARING E NENHUMA APARECE NA TELA.
 * Uma limpeza de "campos nao usados" tira qualquer uma delas sem quebrar tsc nem
 * teste de unidade, e o efeito e sempre o mesmo: a regra recebe `undefined`,
 * para de casar, e o painel volta a contar o cartao no dia da compra (ou a
 * perder a fatura paga). Ver HMO-260, onde `account_type` foi exatamente isso.
 *
 * `amount`, `transaction_type` e `currency` eram o que a rota ja pedia.
 * `transaction_date` nao entra aqui: ela nao e desta regra -- e o recorte de
 * periodo da rota, que existia antes.
 */
export const COLUNAS_DO_REALIZADO_DE_CAIXA =
  "amount, transaction_type, currency, notes, counterpart_transaction_id, account:financial_accounts(account_type)";
