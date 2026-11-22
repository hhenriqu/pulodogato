// =============================================================================
// A COMPOSICAO DA FATURA: FIXO, ASSINATURA, PARCELADO E ESPORADICO
// =============================================================================
// O pedido (Helio, 22/11/2026): "preciso saber a composicao do meu cartao de
// credito. Entre o que e gasto recorrente como fixo ou assinatura, e o que
// tenho parcelado e esporadico." Uma rosca com a legenda embaixo, o MENSAL
// dentro da fatura, e nos paineis (Cartoes e o inicial) uma chave para o TOTAL:
// quanto seria preciso para QUITAR os cartoes, ficando so com o que e fixo e
// assinatura -- que nao entra no total, exceto o do mes atual.
//
// Spec em docs/COMPOSICAO-DA-FATURA.md. Quem le o banco e
// `lib/services/composicao-da-fatura.ts`; aqui fica so a regra, sem I/O e SEM
// IMPORTS DE RUNTIME -- o teste (scripts/test-composicao-da-fatura.mjs) compila
// este arquivo sozinho e o roda com `node --test`. A normalizacao da descricao
// (`normalizeMerchant`) chega injetada em `Reconhecimento.chave`.
//
// COMO UMA LINHA DA FATURA E CLASSIFICADA, NESTA ORDEM
// ----------------------------------------------------
//   1. PARCELADO: tem `installment_total > 1` (035). A parcela vence tudo: a
//      compra parcelada cuja descricao lembra uma conta fixa continua sendo
//      divida que acaba.
//   2. FIXO ou ASSINATURA pela BAIXA: a linha e a compra que uma conta prevista
//      de uma conta fixa virou (`scheduled_transactions.transaction_id`, ver
//      `lancarCobrancasDoCartao`). A marca `is_subscription` da regra (084)
//      decide entre as duas.
//   3. ASSINATURA pelo EXTRATO: a linha e uma das cobrancas que o detector
//      achou (`detected_recurrences.transaction_ids`) ou tem a chave de lojista
//      de uma recorrencia DETECTED/CONFIRMED -- as mesmas que a tela de
//      Assinaturas soma. Ou tem a descricao de uma conta fixa MARCADA como
//      assinatura.
//   4. FIXO pela DESCRICAO: a chave da descricao e a de uma conta fixa de
//      despesa ativa -- o mesmo criterio do custo de vida (`ehDespesaFixa`),
//      para a compra importada do extrato, que nao tem baixa.
//   5. ESPORADICO: o resto. O estorno (valor negativo na fatura) abate da
//      fatia em que cair, e o ajuste de saldo cai aqui.
//
// AS COBRANCAS PREVISTAS (a conta fixa no cartao antes do dia dela) entram na
// composicao do mes delas como fixo/assinatura pela regra; a avulsa, como
// esporadico. Elas ja somam no total previsto da tela do cartao.
//
// O TOTAL PARA QUITAR (`quitacaoDoCartao`)
// ----------------------------------------
// E a divida do cartao ainda nao paga, pelas FATURAS:
//   * a fatura EM ABERTO do cartao (pelo fechamento) e todas as seguintes:
//     todas as linhas delas -- as parcelas que faltam, a compra feita depois do
//     fechamento, o fixo que ja virou compra neste ciclo;
//   * as faturas ANTERIORES que ainda nao foram pagas: a fechada que esta na
//     agenda como pendente, e a imediatamente anterior a aberta quando ainda
//     nao ha registro dela (fechou e ninguem fechou/pagou no app). Fatura mais
//     antiga sem registro conta como paga fora do app -- senao o historico
//     importado viraria divida para sempre;
//   * a fatura PAGA nunca entra;
//   * das cobrancas previstas, SO as da fatura em aberto: o fixo e a
//     assinatura dos meses seguintes ainda nao sao divida, e o pedido diz que
//     eles ficam de fora "exceto o mes atual".
//
// TUDO EM CENTAVOS por dentro: a soma de dezenas de parcelas em ponto
// flutuante erraria o centavo que a legenda mostra.
// =============================================================================

export type TipoDoGasto = "assinatura" | "fixo" | "parcelado" | "esporadico";

/** A ordem da legenda: o recorrente primeiro, depois o que acaba. */
export const TIPOS_DO_GASTO: readonly TipoDoGasto[] = [
  "fixo",
  "assinatura",
  "parcelado",
  "esporadico",
];

export const NOME_DO_TIPO: Record<TipoDoGasto, string> = {
  fixo: "Fixo",
  assinatura: "Assinaturas",
  parcelado: "Parcelado",
  esporadico: "Esporádico",
};

/**
 * Hex e nao `hsl(var(--...))`: o recharts escreve a cor no atributo `fill` do
 * SVG, e atributo de apresentacao nao resolve variavel CSS (ver
 * `CORES_DA_ROSCA`, lib/widgets-do-painel.ts). As duas recorrentes sao frias e
 * vizinhas; as duas que acabam, quentes.
 */
export const COR_DO_TIPO: Record<TipoDoGasto, string> = {
  fixo: "#3b82f6",
  assinatura: "#8b5cf6",
  parcelado: "#f59e0b",
  esporadico: "#10b981",
};

export interface Composicao {
  fixo: number;
  assinatura: number;
  parcelado: number;
  esporadico: number;
  /** A soma das quatro. */
  total: number;
}

/** O que a regra le de uma linha de `card_invoice_lines`. */
export interface LinhaDaComposicao {
  transaction_id: string;
  account_id: string;
  /** 'AAAA-MM-01'. */
  invoice_month: string;
  /** Positivo para compra, negativo para estorno (a view inverte o sinal). */
  invoice_amount: number | string;
  description?: string | null;
  installment_total?: number | null;
}

/** O que a regra le de uma cobranca prevista (`CobrancaNaFatura`). */
export interface CobrancaDaComposicao {
  account_id: string;
  /** 'AAAA-MM-01'. */
  invoice_month: string;
  /** Positivo, como em `scheduled_transactions`. */
  amount: number | string;
  direction: "expense" | "income";
  recurring_rule_id: string | null;
  description?: string | null;
}

/** Tudo que reconhece o recorrente, ja lido do banco. */
export interface Reconhecimento {
  /** transaction_id da compra -> a regra cuja conta prevista virou aquela compra. */
  regraDaBaixa: ReadonlyMap<string, string>;
  /** id da regra -> e assinatura? (084) */
  assinaturaDaRegra: ReadonlyMap<string, boolean>;
  /** As compras que o detector juntou numa recorrencia que soma. */
  transacoesDeAssinatura: ReadonlySet<string>;
  /** Chaves de lojista de assinatura: detector + contas fixas marcadas. */
  chavesDeAssinatura: ReadonlySet<string>;
  /** Chaves de descricao das contas fixas de despesa NAO marcadas. */
  chavesFixas: ReadonlySet<string>;
  /** A normalizacao da descricao (`normalizeMerchant`). */
  chave: (descricao: string) => string;
}

/** 'fatura paga' ou 'fatura na agenda, pendente'. Ausente: sem registro. */
export type SituacaoDaFatura = "paga" | "pendente";

function centavos(valor: number | string | null | undefined): number {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function tipoDaRegra(regraId: string, rec: Reconhecimento): TipoDoGasto {
  return rec.assinaturaDaRegra.get(regraId) ? "assinatura" : "fixo";
}

/** Em que fatia esta linha da fatura cai. Ver a ordem no cabecalho. */
export function classificarLinha(
  linha: LinhaDaComposicao,
  rec: Reconhecimento
): TipoDoGasto {
  if ((linha.installment_total ?? 0) > 1) return "parcelado";

  const regra = rec.regraDaBaixa.get(linha.transaction_id);
  if (regra) return tipoDaRegra(regra, rec);

  if (rec.transacoesDeAssinatura.has(linha.transaction_id)) return "assinatura";

  const chave = rec.chave(linha.description ?? "");
  if (chave !== "") {
    if (rec.chavesDeAssinatura.has(chave)) return "assinatura";
    if (rec.chavesFixas.has(chave)) return "fixo";
  }
  return "esporadico";
}

/** Em que fatia esta cobranca prevista cai: pela regra, ou esporadico. */
export function classificarCobranca(
  cobranca: CobrancaDaComposicao,
  rec: Reconhecimento
): TipoDoGasto {
  return cobranca.recurring_rule_id
    ? tipoDaRegra(cobranca.recurring_rule_id, rec)
    : "esporadico";
}

/** Uma composicao em centavos virada em reais. */
function emReais(c: Record<TipoDoGasto, number>): Composicao {
  const total = TIPOS_DO_GASTO.reduce((s, t) => s + c[t], 0);
  return {
    fixo: c.fixo / 100,
    assinatura: c.assinatura / 100,
    parcelado: c.parcelado / 100,
    esporadico: c.esporadico / 100,
    total: total / 100,
  };
}

function zerada(): Record<TipoDoGasto, number> {
  return { fixo: 0, assinatura: 0, parcelado: 0, esporadico: 0 };
}

/** A composicao do que foi passado -- quem chama escolhe as linhas. */
export function composicaoDe(
  linhas: readonly LinhaDaComposicao[],
  cobrancas: readonly CobrancaDaComposicao[],
  rec: Reconhecimento
): Composicao {
  const soma = zerada();
  for (const linha of linhas) {
    soma[classificarLinha(linha, rec)] += centavos(linha.invoice_amount);
  }
  for (const c of cobrancas) {
    // A cobranca de RECEITA no cartao (um credito previsto) abate, como o
    // estorno; o `amount` e sempre positivo na tabela.
    const sinal = c.direction === "income" ? -1 : 1;
    soma[classificarCobranca(c, rec)] += sinal * centavos(c.amount);
  }
  return emReais(soma);
}

/** A fatura de UM mes: as linhas e as cobrancas previstas daquele mes. */
export function composicaoDaFatura(params: {
  linhas: readonly LinhaDaComposicao[];
  cobrancas: readonly CobrancaDaComposicao[];
  /** 'AAAA-MM-01'. */
  mes: string;
  rec: Reconhecimento;
}): Composicao {
  const { linhas, cobrancas, mes, rec } = params;
  return composicaoDe(
    linhas.filter((l) => l.invoice_month === mes),
    cobrancas.filter((c) => c.invoice_month === mes),
    rec
  );
}

/** 'AAAA-MM-01' andado de N meses (N pode ser negativo). */
export function mesDeslocado(mes: string, n: number): string {
  const total = Number(mes.slice(0, 4)) * 12 + (Number(mes.slice(5, 7)) - 1) + n;
  const ano = Math.floor(total / 12);
  return `${String(ano).padStart(4, "0")}-${String(total - ano * 12 + 1).padStart(2, "0")}-01`;
}

/**
 * A fatura deste mes ainda e divida do cartao? Ver "O TOTAL PARA QUITAR".
 *
 * @param mes 'AAAA-MM-01' da fatura
 * @param mesAberto 'AAAA-MM-01' da fatura em aberto do cartao
 */
export function faturaEntraNaQuitacao(
  mes: string,
  mesAberto: string,
  situacao: SituacaoDaFatura | undefined
): boolean {
  if (situacao === "paga") return false;
  if (mes >= mesAberto) return true;
  if (situacao === "pendente") return true;
  return mes === mesDeslocado(mesAberto, -1);
}

/** Quanto este cartao precisa para ser quitado, por fatia. */
export function quitacaoDoCartao(params: {
  /** As linhas do cartao, de quantos meses a leitura trouxe. */
  linhas: readonly LinhaDaComposicao[];
  /** As cobrancas previstas do cartao (todas as lidas). */
  cobrancas: readonly CobrancaDaComposicao[];
  /** 'AAAA-MM-01'. */
  mesAberto: string;
  /** 'AAAA-MM-01' -> situacao da fatura daquele mes. */
  situacoes: ReadonlyMap<string, SituacaoDaFatura>;
  rec: Reconhecimento;
}): Composicao {
  const { linhas, cobrancas, mesAberto, situacoes, rec } = params;
  return composicaoDe(
    linhas.filter((l) =>
      faturaEntraNaQuitacao(l.invoice_month, mesAberto, situacoes.get(l.invoice_month))
    ),
    // So o fixo/assinatura do mes atual: o dos meses seguintes nao e divida.
    cobrancas.filter(
      (c) => c.invoice_month === mesAberto && situacoes.get(mesAberto) !== "paga"
    ),
    rec
  );
}

/** A soma de varias composicoes (os cartoes que somam nos totais). */
export function somarComposicoes(lista: readonly Composicao[]): Composicao {
  const soma = zerada();
  for (const c of lista) {
    for (const t of TIPOS_DO_GASTO) soma[t] += centavos(c[t]);
  }
  return emReais(soma);
}

export interface FatiaDaComposicao {
  tipo: TipoDoGasto;
  nome: string;
  valor: number;
  cor: string;
  /** Fracao do que a rosca desenha, de 0 a 1. */
  parte: number;
}

/**
 * As fatias da rosca, na ordem da legenda. So o que e positivo se desenha: a
 * fatia que o estorno deixou negativa sai da rosca (e continua na legenda,
 * com o valor dela, para a soma fechar com o total).
 */
export function fatiasDaComposicao(c: Composicao): FatiaDaComposicao[] {
  const positivas = TIPOS_DO_GASTO.filter((t) => centavos(c[t]) > 0);
  const desenhado = positivas.reduce((s, t) => s + centavos(c[t]), 0);
  if (desenhado === 0) return [];
  return positivas.map((t) => ({
    tipo: t,
    nome: NOME_DO_TIPO[t],
    valor: c[t],
    cor: COR_DO_TIPO[t],
    parte: centavos(c[t]) / desenhado,
  }));
}

/** O recorrente (fixo + assinatura) e o que acaba (parcelado + esporadico). */
export function recorrenteDa(c: Composicao): number {
  return (centavos(c.fixo) + centavos(c.assinatura)) / 100;
}
