// ---------------------------------------------------------------------------
// A COBRANCA NO CARTAO: A CONTA PREVISTA QUE VIRA COMPRA SOZINHA (24/10/2026)
// ---------------------------------------------------------------------------
// O pedido do Helio: "Despesas fixas no cartao tem que ser possivel.
// basicamente ele se repete em toda fatura."
//
// A despesa fixa no cartao ja se cadastrava (lancamento de despesa, lugar
// "cartao", "Fixa" marcada): vira uma `recurring_rules` com o cartao como conta,
// e cada mes uma `scheduled_transactions` pendente. E ali ela ficava. A HMO-209
// a tira de Contas a Pagar (`agendaSemCompraNoCartao`), `card_invoice_lines` so
// ve lancamento, e a tela do cartao a mostrava num bloco a parte, "fora do
// total da fatura". Nao havia botao de pagar -- e nem podia haver, pela
// RN004.4: o que mora numa fatura so se paga pelo pagamento da fatura. Na
// pratica ela nao contava em lugar nenhum.
//
// A REGRA, EM TRES FRASES
// -----------------------
//   1. A cobranca cai na fatura como uma COMPRA feita no dia da cobranca: o
//      mes da fatura sai do `closing_day`, pela mesma regra da 006
//      (`faturaAbertaDoCartao`, que o teste prende ao `card_invoice_month`).
//   2. ANTES do dia ela e PREVISTA: entra no total previsto da fatura (a
//      sintese da fatura aberta e a tela do cartao), e por ai no Previsto da
//      aba Despesas, dentro da fatura.
//   3. NO DIA (ou na primeira leitura depois dele) o app lanca a compra no
//      cartao sozinho e da a conta prevista por paga. A compra e um lancamento
//      comum, que se edita e se apaga na fatura como qualquer outro.
//
// FIXA E AVULSA, AS DUAS
// ----------------------
// O pedido fala da fixa, e a avulsa apontada para um cartao estava no MESMO
// limbo: fora da agenda, fora da fatura, sem baixa. Tratar so a fixa deixaria o
// bloco da tela do cartao com duas regras lado a lado sem nada dizendo qual e
// qual. As duas sao "uma compra que vai acontecer neste cartao naquele dia".
//
// O QUE NAO E COBRANCA, MESMO MORANDO NUM CARTAO
// ----------------------------------------------
//   * a FATURA (chave `fatura:` em `notes`) -- ela e o pagamento, nao a compra;
//   * a TRANSFERENCIA prevista -- duas pernas, e para cartao ela e recusada
//     (RN004.4);
//   * as linhas que pertencem a outro mecanismo e tem baixa propria: a parcela
//     do MyBank (`mybank:`), a conta do fechamento do grupo (`group_closing_id`)
//     e a conta da divisao com pessoa (`expense_split_id`). As duas ultimas tem
//     trava de banco (068, 070); lanca-las como compra aqui seria um segundo
//     caminho de baixa para elas.
//
// ARQUIVO SEM REDE. A leitura e a escrita moram em
// `lib/services/cobranca-no-cartao.ts`; aqui fica o que o teste afirma.
// ---------------------------------------------------------------------------

import { ehFatura } from "@/lib/chave-da-fatura";
import { faturaAbertaDoCartao } from "@/lib/fatura-do-cartao";

// A chave do MyBank (`PREFIXO_DA_CHAVE_DO_MYBANK`, lib/emprestimo-do-mybank.ts)
// em literal, pelo mesmo motivo de lib/vinculo-da-prevista.ts: importar de la
// puxaria o modulo inteiro do MyBank para dentro de uma regra que so precisa do
// prefixo.
const PREFIXO_DO_MYBANK = "mybank:";

/** O que a regra le da conta prevista. A forma e a da tabela, com a regra embutida. */
export interface PrevistaNoCartao {
  id: string;
  user_id: string;
  recurring_rule_id?: string | null;
  category_id: string;
  subcategory_id?: string | null;
  account_id: string | null;
  group_id?: string | null;
  description: string;
  amount: number | string;
  due_date: string;
  status: string;
  notes?: string | null;
  created_at?: string | null;
  /** A direcao da OCORRENCIA (027). NULL quer dizer "pergunte a regra". */
  transaction_type?: string | null;
  group_closing_id?: string | null;
  expense_split_id?: string | null;
  /** O embed `recurring_rule:recurring_rules(transaction_type)`. */
  recurring_rule?: { transaction_type?: string | null } | null;
}

/** O que a regra le do cartao. */
export interface CartaoDaCobranca {
  id: string;
  name?: string | null;
  closing_day?: number | null;
  due_day?: number | null;
}

/**
 * A direcao da cobranca: a da ocorrencia, depois a da regra, depois `expense`.
 *
 * A MESMA precedencia da baixa comum (`/pay`) e da coluna `direction` da view
 * (027). Escrita de novo aqui, e nao lida da view, porque esta leitura e da
 * TABELA: a view e a que `check-as-oito-leituras` mede, e esta pergunta e
 * sobre a conta (ela ja virou compra?), nao sobre a pessoa.
 */
export function direcaoDaCobranca(
  p: Pick<PrevistaNoCartao, "transaction_type" | "recurring_rule">
): string {
  return p.transaction_type ?? p.recurring_rule?.transaction_type ?? "expense";
}

/**
 * Esta conta prevista, que JA se sabe apontada para um cartao, e uma cobranca?
 *
 * Quem garante o "apontada para um cartao" e a leitura (ela filtra
 * `account_id` pelos cartoes da pessoa). Aqui ficam as outras peneiras -- ver
 * o cabecalho.
 */
export function ehCobrancaNoCartao(p: PrevistaNoCartao): boolean {
  if (!p.account_id) return false;
  if (ehFatura(p.notes)) return false;
  if (p.notes?.startsWith(PREFIXO_DO_MYBANK)) return false;
  if (p.group_closing_id || p.expense_split_id) return false;
  return direcaoDaCobranca(p) !== "transfer";
}

/**
 * O mes da fatura em que a cobranca cai, 'AAAA-MM-01'.
 *
 * Pela regra da COMPRA (006): ate o dia do fechamento, a fatura do proprio mes;
 * depois, a do seguinte. Cartao sem `closing_day` poe toda compra na fatura do
 * proprio mes -- e o ramo `IS NULL` de `card_invoice_month`, e e por isso que o
 * `null` de `faturaAbertaDoCartao` aqui NAO vira "sem fatura".
 *
 * `null` so para data que nao da para ler.
 */
export function mesDaFaturaDaCobranca(
  dueDate: string | null | undefined,
  closingDay: number | null | undefined
): string | null {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  const temFechamento =
    closingDay !== null &&
    closingDay !== undefined &&
    Number.isInteger(closingDay) &&
    closingDay >= 1 &&
    closingDay <= 31;
  const mes = temFechamento
    ? faturaAbertaDoCartao(dueDate, closingDay)
    : dueDate.slice(0, 7);
  return mes ? `${mes}-01` : null;
}

/**
 * O id da compra que a cobranca vira: o id da conta prevista com a versao
 * trocada de 4 para 5.
 *
 * E O QUE TORNA O LANCAMENTO IDEMPOTENTE. A primeira leitura depois do dia
 * costuma ser o painel, que abre quatro rotas ao mesmo tempo, e as quatro
 * passam por aqui. Com um id novo a cada tentativa, a mesma assinatura entraria
 * quatro vezes na fatura. Com este, a segunda tentativa leva 23505 (chave
 * primaria) e sabe que a compra ja existe.
 *
 * Versao 5 E NAO A PROPRIA: os ids do banco sao `gen_random_uuid()`, versao 4,
 * entao nenhum lancamento feito por outro caminho tem este id. E ele diz, a
 * quem apagar a compra, que ela foi lancada pelo app a partir daquela conta
 * prevista -- ver `cobrancaApagadaVoltaParaPulada`.
 *
 * `null` para o que nao e uuid: nao ha como derivar, e inventar um id aleatorio
 * aqui perderia a idempotencia, que e o motivo da funcao.
 */
export function idDaCompraDaCobranca(scheduledId: string | null | undefined): string | null {
  if (
    !scheduledId ||
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      scheduledId
    )
  ) {
    return null;
  }
  const id = scheduledId.toLowerCase();
  return `${id.slice(0, 14)}5${id.slice(15)}`;
}

/**
 * A compra foi lancada pelo app a partir DESTA conta prevista?
 *
 * Apagar a compra solta a conta prevista (065: volta para pendente). Para a
 * cobranca no cartao isso e ressuscita-la: na proxima leitura ela seria
 * lancada de novo, com o mesmo id. Quem apaga a compra que o app lancou esta
 * dizendo "esta cobranca nao aconteceu", e por isso a conta prevista vai para
 * `skipped` -- o mesmo estado de "pular este mes".
 *
 * A compra que a pessoa ligou a mao ("Ja lancei", RN006.3) tem outro id, e
 * continua na RN006.5.
 */
export function cobrancaApagadaVoltaParaPulada(
  transactionId: string,
  scheduledId: string
): boolean {
  return idDaCompraDaCobranca(scheduledId) === transactionId.toLowerCase();
}

/** O que a fatura e a tela leem de uma cobranca prevista. */
export interface CobrancaNaFatura {
  /** O id da conta prevista. */
  id: string;
  account_id: string;
  account_name: string | null;
  description: string;
  /** Positivo, como em `scheduled_transactions`. */
  amount: number;
  direction: "expense" | "income";
  /** O dia da cobranca -- o dia em que ela vira compra. */
  due_date: string;
  /** 'AAAA-MM-01'. */
  invoice_month: string;
  recurring_rule_id: string | null;
}

/**
 * As cobrancas pendentes com o mes da fatura de cada uma.
 *
 * Fica de fora: o que nao e cobranca (`ehCobrancaNoCartao`), o que nao esta
 * pendente, o cartao que nao esta na lista, e a data que nao da para ler.
 */
export function cobrancasNaFatura(
  previstas: PrevistaNoCartao[],
  cartoes: CartaoDaCobranca[]
): CobrancaNaFatura[] {
  const porId = new Map(cartoes.map((c) => [c.id, c]));
  const saida: CobrancaNaFatura[] = [];
  for (const p of previstas) {
    if (p.status !== "pending" || !ehCobrancaNoCartao(p)) continue;
    const cartao = porId.get(p.account_id as string);
    if (!cartao) continue;
    const mes = mesDaFaturaDaCobranca(p.due_date, cartao.closing_day);
    const valor = Math.abs(Number(p.amount));
    if (!mes || !Number.isFinite(valor) || valor === 0) continue;
    saida.push({
      id: p.id,
      account_id: cartao.id,
      account_name: cartao.name?.trim() || null,
      description: p.description,
      amount: valor,
      direction: direcaoDaCobranca(p) === "income" ? "income" : "expense",
      due_date: p.due_date,
      invoice_month: mes,
      recurring_rule_id: p.recurring_rule_id ?? null,
    });
  }
  saida.sort((a, b) => a.due_date.localeCompare(b.due_date));
  return saida;
}

/**
 * Quanto a cobranca soma na fatura, com o sinal de `invoice_amount`: a compra
 * soma e o estorno abate -- o mesmo `-amount` que a view aplica ao lancamento.
 */
export function valorNaFatura(c: Pick<CobrancaNaFatura, "amount" | "direction">): number {
  return c.direction === "income" ? -c.amount : c.amount;
}

/**
 * O total previsto da fatura: o que ja foi lancado mais as cobrancas que ainda
 * vao cair nela. Em centavos, pelo mesmo motivo da sintese: a soma de floats
 * deixaria R$ 0,00000001 de sobra.
 */
export function totalPrevistoDaFatura(
  total: number,
  cobrancas: Pick<CobrancaNaFatura, "amount" | "direction">[]
): number {
  const soma = cobrancas.reduce((acc, c) => acc + valorNaFatura(c), Number(total) || 0);
  return Number(soma.toFixed(2));
}

/** A forma de `invoice_amount` que a compra lancada vai ter, para a linha da sintese. */
export interface LinhaDaCobrancaNaFatura {
  account_id: string;
  account_name: string | null;
  invoice_month: string;
  invoice_due_date: string | null;
  invoice_amount: number;
}

/**
 * A cobranca como uma linha da fatura aberta (`sintetizarFaturasAbertas`).
 *
 * Ela entra na MESMA soma das compras, e nao num campo a parte, porque e isso
 * que a regra diz: ela e uma compra que ainda nao aconteceu. Por la ela chega
 * a Contas a Pagar, ao Previsto da aba Despesas e a previsao do painel, sem
 * nenhuma dessas rotas mudar.
 *
 * O vencimento vem de fora (`card_invoice_due_date`, no banco): esta funcao
 * nao faz aritmetica de vencimento.
 */
export function linhaDaCobrancaNaFatura(
  c: CobrancaNaFatura,
  invoiceDueDate: string | null
): LinhaDaCobrancaNaFatura {
  return {
    account_id: c.account_id,
    account_name: c.account_name,
    invoice_month: c.invoice_month,
    invoice_due_date: invoiceDueDate,
    invoice_amount: valorNaFatura(c),
  };
}

/**
 * O lancamento que a cobranca vira, no dia dela.
 *
 * Campo a campo o que a baixa comum (`/pay`) grava, com duas diferencas que sao
 * a regra: o id e o derivado (`idDaCompraDaCobranca`), e a data e o dia da
 * cobranca -- e nao o dia em que o app abriu. Lancar com a data de hoje poria
 * na fatura seguinte a assinatura que caiu antes do fechamento, so porque a
 * pessoa abriu o app depois dele.
 *
 * `null` quando nao ha id para derivar.
 */
export function compraDaCobranca(
  p: PrevistaNoCartao,
  serviceId: string
): Record<string, unknown> | null {
  const id = idDaCompraDaCobranca(p.id);
  if (!id || !p.account_id) return null;
  const tipo = direcaoDaCobranca(p) === "income" ? "income" : "expense";
  const valor = Math.abs(Number(p.amount));
  return {
    id,
    user_id: p.user_id,
    service_id: serviceId,
    category_id: p.category_id,
    subcategory_id: p.subcategory_id ?? null,
    account_id: p.account_id,
    group_id: p.group_id ?? null,
    description: p.description,
    // O sinal de `valorComSinal` (lib/services/scheduled.ts): despesa negativa.
    amount: tipo === "income" ? valor : -valor,
    transaction_date: p.due_date,
    transaction_type: tipo,
    notes: p.notes ?? null,
    expected_date: p.due_date,
    launch_date: p.created_at ? String(p.created_at).slice(0, 10) : p.due_date,
  };
}
