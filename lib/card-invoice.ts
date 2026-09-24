// =====================================================
// PAGAMENTO DE FATURA DE CARTAO
// =====================================================
// Por que este arquivo existe: pagar a fatura do cartao NAO e uma despesa, e
// tratar como despesa contava a mesma compra duas vezes.
//
// A compra no cartao ja e a despesa. Ela e lancada negativa na conta do
// cartao, entra no fluxo de caixa do mes em que foi feita e consome o teto da
// categoria. Quando a fatura e paga, o que acontece e outra coisa: dinheiro
// sai da conta corrente e a divida do cartao e quitada. Nenhum gasto novo
// aconteceu -- o patrimonio liquido nao muda com o pagamento, muda com a
// compra.
//
// O bug que isto conserta (HMO-149): a baixa lancava UMA transacao negativa na
// conta do CARTAO. O trigger update_account_balance soma NEW.amount na conta
// indicada, entao o cartao ficava mais negativo pelo valor da fatura e a conta
// de onde o dinheiro realmente saiu nao se mexia:
//
//   depois da compra de 1.000   | corrente 5.000 | cartao -1.000 | patrimonio 4.000
//   depois de pagar a fatura    | corrente 5.000 | cartao -2.000 | patrimonio 3.000
//
// O certo e 4.000 nos dois momentos.
//
// O desenho: DUAS pernas com transaction_type 'transfer'.
//
//   perna de saida:  -total na conta pagadora (o dinheiro sai)
//   perna de entrada: +total na conta do cartao (a divida e quitada)
//
// 'transfer' nao e detalhe de nomenclatura, e o que faz as views do 008
// fecharem. category_monthly_totals e monthly_cash_flow filtram
// `transaction_type IN ('expense','income')`, entao as duas pernas ficam fora
// do fluxo de caixa -- a despesa continua contada uma vez, na compra.
// net_worth_history soma amount de QUALQUER tipo, espelhando o trigger de
// saldo, e la as duas pernas se anulam: -1.000 + 1.000 = 0. E
// card_invoice_lines tambem filtra ('expense','income'), entao a perna de
// entrada nao aparece como credito na fatura do mes seguinte.
//
// (A nota da SECAO 4 do 006 diz que "pagamento da fatura entra como income na
// conta do cartao". Era a intencao antiga e estava errada por dois motivos:
// income infla a receita do mes no fluxo de caixa, e apareceria como linha
// abatendo a fatura SEGUINTE. Estorno de compra continua sendo income; o
// pagamento e transferencia.)
//
// O que continua sendo despesa: assinatura cobrada no cartao e cadastrada como
// conta prevista com account_id do cartao. Pagar aquela conta COM o cartao
// rebaixa o cartao mesmo -- e o comportamento certo. Por isso a deteccao aqui
// e pela chave canonica da fatura em `notes`, e nao pelo tipo da conta: quem
// olhasse so o account_type transformaria toda assinatura de cartao em
// transferencia e faria a despesa desaparecer do relatorio.
// =====================================================

/**
 * Prefixo da chave canonica que `POST /api/card-invoices/close` grava em
 * `scheduled_transactions.notes`.
 */
export const PREFIXO_CHAVE_FATURA = "fatura:";

/**
 * A chave canonica da fatura daquele mes naquele cartao.
 *
 * E ela que torna o fechamento idempotente (clicar duas vezes nao cria duas
 * contas a pagar), que permite ao GET reconhecer a fatura ja fechada sem uma
 * coluna nova, e -- desde o conserto do HMO-149 -- que diz a rota de baixa que
 * aquela conta prevista e uma fatura, nao uma despesa.
 *
 * @param mes 'YYYY-MM-01' (primeiro dia do mes da fatura)
 */
export function chaveFatura(mes: string, accountId: string): string {
  return `${PREFIXO_CHAVE_FATURA}${mes}:${accountId}`;
}

// Ancorada nas duas pontas de proposito. Sem o `$`, uma nota escrita a mao
// como "fatura:2026-09-01:xxx paguei no debito" passaria por chave canonica e
// a descricao livre do usuario viraria regra de negocio.
const RE_CHAVE_FATURA =
  /^fatura:(\d{4}-\d{2}-\d{2}):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

/** O mes e o cartao de uma chave de fatura, ou null se `notes` nao for uma. */
export function faturaDaChave(
  notes: string | null | undefined,
): { mes: string; accountId: string } | null {
  if (!notes) return null;
  const m = RE_CHAVE_FATURA.exec(notes);
  if (!m) return null;
  return { mes: m[1], accountId: m[2] };
}

/** Esta conta prevista e a fatura de um cartao? */
export function ehFatura(notes: string | null | undefined): boolean {
  return faturaDaChave(notes) !== null;
}

/** Por que a conta escolhida para pagar a fatura nao serve. */
export type ProblemaContaPagadora =
  | "ausente"
  | "nao_encontrada"
  | "e_o_proprio_cartao"
  | "outro_cartao";

/** O que a validacao precisa saber sobre a conta pagadora. */
export interface ContaPagadora {
  id: string;
  account_type: string;
}

/**
 * A conta escolhida serve para pagar esta fatura?
 *
 * Devolve `null` quando serve, ou o motivo. Nenhum dos quatro motivos e
 * paranoia:
 *
 * - `ausente`: sem conta pagadora nao ha de onde tirar o dinheiro. Cair num
 *   padrao ("a primeira conta corrente") lancaria dinheiro saindo de uma conta
 *   que o usuario nao escolheu, e o saldo errado seria descoberto semanas
 *   depois.
 * - `e_o_proprio_cartao`: as duas pernas cairiam na mesma conta, -total e
 *   +total se anulariam, e a fatura ficaria marcada como paga sem que dinheiro
 *   nenhum se movesse. E exatamente o bug do HMO-149 com outra roupa: o numero
 *   fecha e o fato nao aconteceu.
 * - `outro_cartao`: pagar cartao com cartao nao existe neste app. Aceitar
 *   criaria divida num cartao sem nenhuma compra por tras, e a fatura desse
 *   segundo cartao passaria a cobrar uma linha que nao e compra.
 *
 * Conta arquivada (`is_active = false`) NAO e recusada: quem esta quitando a
 * fatura de um cartao que fechou costuma pagar pela conta que fechou junto, e
 * recusar deixaria o usuario sem caminho nenhum para registrar um pagamento
 * que aconteceu de verdade.
 *
 * `undefined` = o cliente nao mandou conta nenhuma. `null` = mandou um id que
 * a busca nao achou (ou nao e do usuario). Os dois casos precisam de mensagens
 * diferentes: um e um campo em branco, o outro e um id invalido.
 */
export function validarContaPagadora(
  pagadora: ContaPagadora | null | undefined,
  cartaoId: string,
): ProblemaContaPagadora | null {
  if (!pagadora?.id) return pagadora === null ? "nao_encontrada" : "ausente";
  if (pagadora.id === cartaoId) return "e_o_proprio_cartao";
  if (pagadora.account_type === "credit_card") return "outro_cartao";
  return null;
}

/** Mensagem para o usuario. A rota nao inventa texto proprio. */
export function mensagemContaPagadora(problema: ProblemaContaPagadora): string {
  switch (problema) {
    case "ausente":
      return "Escolha de qual conta o dinheiro da fatura saiu";
    case "nao_encontrada":
      return "Conta de pagamento não encontrada";
    case "e_o_proprio_cartao":
      return "A fatura não pode ser paga pelo próprio cartão";
    case "outro_cartao":
      return "A fatura não pode ser paga por outro cartão de crédito";
  }
}

/** Uma das duas linhas que a baixa da fatura grava. */
export interface PernaPagamento {
  account_id: string;
  description: string;
  amount: number;
  transaction_type: "transfer";
}

/**
 * As duas pernas do pagamento da fatura.
 *
 * `saida` e a perna principal: e a que `scheduled_transactions.transaction_id`
 * aponta, porque e onde o dinheiro efetivamente saiu. `entrada` quita a divida
 * do cartao e guarda o elo de volta em `counterpart_transaction_id` (migration
 * 015), para que o estorno da baixa encontre as duas sem adivinhar por
 * valor e data.
 *
 * O valor entra por `Math.abs`: `scheduled_transactions.amount` e sempre
 * positivo (CHECK do 005), mas quem chamar daqui a um ano nao sabe disso, e o
 * sinal trocado nas duas pernas inverteria a transferencia sem erro nenhum
 * aparecer.
 */
export function pernasDoPagamentoDeFatura(params: {
  valor: number;
  cartaoId: string;
  contaPagadoraId: string;
  descricao: string;
}): { saida: PernaPagamento; entrada: PernaPagamento } {
  const total = Math.abs(params.valor);
  return {
    saida: {
      account_id: params.contaPagadoraId,
      description: params.descricao,
      amount: -total,
      transaction_type: "transfer",
    },
    entrada: {
      account_id: params.cartaoId,
      description: `Pagamento — ${params.descricao}`,
      amount: total,
      transaction_type: "transfer",
    },
  };
}
