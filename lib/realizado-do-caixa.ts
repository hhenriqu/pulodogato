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

import {
  ehPagamentoDaFatura,
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

// -----------------------------------------------------------------------------
// QUEM DECIDE "ESTA LINHA E A PERNA DE SAIDA DO PAGAMENTO DA FATURA" -- HMO-317
// -----------------------------------------------------------------------------
// `ehPagamentoDaFatura`, importado de lib/telas-de-movimentacao.ts. ELE E O DONO
// UNICO DA PERGUNTA, e os tres criterios com o peso de cada um estao no
// cabecalho DELE -- aqui nao fica resumo nenhum, de proposito: um resumo e a
// segunda copia voltando pela porta do comentario, e comentario desatualizado
// nao da erro nenhum.
//
// ESTE ARQUIVO TINHA A SUA PROPRIA COPIA (`ehSaidaDePagamentoDeFatura`, HMO-265)
// com os mesmos tres criterios escritos a mao, e as duas JA DIVERGIAM em
// `amount === 0`: ficava fora aqui (o sinal estrito) e entrava na tela de
// Despesas. Nenhum total mudava com isso, e era por isso que importava -- duas
// copias de um criterio de DINHEIRO que ninguem compara sao a forma exata do
// defeito que este repositorio ja pagou caro. A decisao unica e a que este lado
// tomava (o par de zero fica FORA), e as tres razoes dela estao no cabecalho da
// funcao dona.
//
// POR QUE O DONO E LA E NAO AQUI: este arquivo JA importava `TIPO_CARTAO` e
// `TIPOS_QUE_ENTRAM_NA_FATURA` de la (foi para isso que a segunda deixou de ser
// privada na HMO-265). Inverter a direcao fecharia um ciclo e poria
// `realizado-do-caixa` -- e `card-invoice` -> `transferencia` -> `lancamento`
// atras dele -- dentro da arvore que scripts/mutantes-telas-de-movimentacao.mjs
// copia: todo mutante daquele modulo deixaria de COMPILAR, "morreria" por motivo
// errado, e o placar viraria 100% sem medir nada.
//
// O IMPORT E A FIACAO, E E ELE QUE O `tsc` COBRA. Nao ha mais copia local para
// divergir; o que ainda pode divergir e o CAMINHO DE DINHEIRO, e e isso que o
// bloco "os dois leitores da fatura paga concordam, linha por linha" de
// scripts/test-realizado-do-caixa.mjs mede: a MESMA matriz de linhas pelos dois
// leitores, afirmando que a resposta da funcao dona e exatamente o que cada um
// faz com a linha. Era o controle que nao existia em lugar nenhum.
//
// E O CRITERIO DO `transaction_type` CONTINUA SENDO UM INVARIANTE DESTE LADO,
// nao um ramo com teste. Nenhum caminho de escrita do app produz a chave
// `fatura:` com tipo diferente de 'transfer', e para a PROMOCAO daqui ele e
// invisivel por um motivo a mais: a unica linha que ele separa (a despesa
// nascida do elo da HMO-305) ja e `expense`, entao reescreve-la para `expense`
// nao mudaria um centavo. O mutante que o removia sobreviveu, a conclusao foi
// escrever isto em vez de forjar estado que o app nao alcanca, e a unificacao
// nao mudou a decisao -- mudou que agora ele TEM teste, do OUTRO lado: na tela
// de Despesas ele decide `natureza`, e la o mutante morre. Ver o bloco de notas
// de scripts/mutantes-realizado-do-caixa.mjs.

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
    if (ehPagamentoDaFatura(linha)) {
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
