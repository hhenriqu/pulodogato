// ---------------------------------------------------------------------------
// MOVER A FATURA PARA O PROXIMO VENCIMENTO, E PARCELAR A FATURA
// ---------------------------------------------------------------------------
// O pedido (Helio, 06/11/2026), na comparacao com o Minhas Financas.
//
// As parcelas NAO usam `installment_number`/`installment_total`: essas colunas
// sao da serie de compra parcelada (`installment_parent_id`), e uma parcela de
// fatura ali apareceria na tela de parcelamentos como compra. O "(1/3)" vai
// na descricao.
//
// MOVER: no historico de faturas do Minhas Financas, cada fatura em aberto tem
// "Mover para o proximo vencimento", com a confirmacao "Todas as transacoes
// dessa fatura serao movidas para a proxima". Aqui e isso mesmo: toda linha do
// cartao que cai na fatura M ganha `invoice_month_override` = M + 1 (041). O
// saldo do cartao nao muda; muda a fatura em que a divida aparece.
//
// PARCELAR: o banco parcela a fatura em N vezes, com juros. A fatura M fecha
// em zero (um credito do total, fora dos totais) e cada uma das N faturas
// seguintes recebe uma parcela (tambem fora dos totais: e a divida mudando de
// mes, nao despesa nova). Os juros sao despesa de verdade, uma linha por
// parcela. E a mesma forma do restante do pagamento parcial
// (lib/pagamento-parcial-da-fatura.ts), com N linhas em vez de uma.
//
// As duas recusam fatura ja PAGA: mexer nela depois da baixa desfaria a conta
// que a baixa fechou. Estorne primeiro.
// ---------------------------------------------------------------------------

export const PREFIXO_CHAVE_PARCELAMENTO = "parcelamento-da-fatura:";
export const MAXIMO_DE_PARCELAS = 24;

/** 'AAAA-MM-01' do mes da fatura, ou `null`. */
export function primeiroDiaDaFatura(mes: string | null | undefined): string | null {
  if (!mes || !/^\d{4}-\d{2}(-\d{2})?$/.test(mes)) return null;
  const numero = Number(mes.slice(5, 7));
  if (numero < 1 || numero > 12) return null;
  return `${mes.slice(0, 7)}-01`;
}

/** 'AAAA-MM-01' de `mes` + `n` meses; `null` se o mes e ilegivel. */
export function somarMeses(mes: string | null | undefined, n: number): string | null {
  const dia = primeiroDiaDaFatura(mes);
  if (!dia || !Number.isInteger(n)) return null;
  const total = Number(dia.slice(0, 4)) * 12 + Number(dia.slice(5, 7)) - 1 + n;
  const ano = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${String(ano).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
}

export function chaveParcelamento(mes: string, cartaoId: string): string | null {
  const dia = primeiroDiaDaFatura(mes);
  if (!dia || !cartaoId) return null;
  return `${PREFIXO_CHAVE_PARCELAMENTO}${dia}:${cartaoId}`;
}

const NOMES_DOS_MESES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

function nomeCurto(dia: string): string {
  return `${NOMES_DOS_MESES[Number(dia.slice(5, 7)) - 1]}/${dia.slice(0, 4)}`;
}

/** `total` em centavos dividido em `n` partes que somam exatamente o total. */
export function dividirEmCentavos(totalEmCentavos: number, n: number): number[] {
  const base = Math.floor(totalEmCentavos / n);
  const sobra = totalEmCentavos - base * n;
  // A sobra vai nas PRIMEIRAS parcelas, um centavo em cada (RN005.2).
  return Array.from({ length: n }, (_, i) => base + (i < sobra ? 1 : 0));
}

export type PapelDoParcelamento = "credito" | "parcela" | "juros";

export interface LinhaDoParcelamento {
  papel: PapelDoParcelamento;
  account_id: string;
  amount: number;
  transaction_type: "income" | "expense";
  transaction_date: string;
  invoice_month_override: string;
  description: string;
  notes: string;
  include_in_total: boolean;
}

export type PlanoDoParcelamento =
  | { ok: true; linhas: LinhaDoParcelamento[]; parcelas: number[] }
  | { ok: false; erro: string };

/**
 * As linhas do parcelamento da fatura `mes` de `total` em `parcelas` vezes.
 * `juros` e o total de juros do parcelamento, dividido entre as parcelas.
 */
export function planoDoParcelamento(params: {
  total: number;
  parcelas: number;
  juros?: number | null;
  mes: string;
  cartaoId: string;
  hoje: string;
}): PlanoDoParcelamento {
  const { total, parcelas, mes, cartaoId, hoje } = params;
  const juros = params.juros ?? 0;
  const dia = primeiroDiaDaFatura(mes);
  if (!dia || !cartaoId) return { ok: false, erro: "Fatura sem mês legível" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje)) {
    return { ok: false, erro: "Data inválida" };
  }
  if (
    !Number.isInteger(parcelas) ||
    parcelas < 2 ||
    parcelas > MAXIMO_DE_PARCELAS
  ) {
    return {
      ok: false,
      erro: `O parcelamento é de 2 a ${MAXIMO_DE_PARCELAS} vezes`,
    };
  }
  const totalEmCentavos = Math.round(Number(total) * 100);
  if (!Number.isFinite(totalEmCentavos) || totalEmCentavos <= 0) {
    return { ok: false, erro: "Esta fatura não tem valor a parcelar" };
  }
  if (totalEmCentavos < parcelas) {
    return { ok: false, erro: "Valor pequeno demais para tantas parcelas" };
  }
  const jurosEmCentavos = Math.round(Number(juros) * 100);
  if (!Number.isFinite(jurosEmCentavos) || jurosEmCentavos < 0) {
    return { ok: false, erro: "Juros devem ser zero ou positivos" };
  }

  const chave = `${PREFIXO_CHAVE_PARCELAMENTO}${dia}:${cartaoId}`;
  const valores = dividirEmCentavos(totalEmCentavos, parcelas);
  const jurosPorParcela =
    jurosEmCentavos > 0 ? dividirEmCentavos(jurosEmCentavos, parcelas) : [];

  const linhas: LinhaDoParcelamento[] = [
    {
      papel: "credito",
      account_id: cartaoId,
      amount: totalEmCentavos / 100,
      transaction_type: "income",
      transaction_date: hoje,
      invoice_month_override: dia,
      description: `Fatura de ${nomeCurto(dia)} parcelada em ${parcelas}x`,
      notes: chave,
      include_in_total: false,
    },
  ];
  valores.forEach((centavos, i) => {
    const destino = somarMeses(dia, i + 1)!;
    linhas.push({
      papel: "parcela",
      account_id: cartaoId,
      amount: -centavos / 100,
      transaction_type: "expense",
      transaction_date: hoje,
      invoice_month_override: destino,
      description: `Parcelamento da fatura de ${nomeCurto(dia)} (${i + 1}/${parcelas})`,
      notes: chave,
      include_in_total: false,
    });
    const jurosDaParcela = jurosPorParcela[i] ?? 0;
    if (jurosDaParcela > 0) {
      linhas.push({
        papel: "juros",
        account_id: cartaoId,
        amount: -jurosDaParcela / 100,
        transaction_type: "expense",
        transaction_date: hoje,
        invoice_month_override: destino,
        description: `Juros do parcelamento da fatura de ${nomeCurto(dia)} (${i + 1}/${parcelas})`,
        notes: chave,
        include_in_total: true,
      });
    }
  });

  return { ok: true, linhas, parcelas: valores.map((c) => c / 100) };
}

/** A categoria reservada das linhas do parcelamento (os juros usam a de encargos). */
export const CATEGORIA_DO_PARCELAMENTO = {
  nome: "Parcelamento de fatura",
  descricao:
    "Reservada: a fatura parcelada saindo de um mês e entrando nos seguintes. Não é receita nem despesa.",
  icone: "calendar-range",
  cor: "#6B7280",
  ehDespesa: true,
};

/**
 * Esta fatura tem o credito de um parcelamento? A tela nao recebe `notes`
 * (`card_invoice_lines` nao publica a coluna), entao reconhece a linha pela
 * descricao que `planoDoParcelamento` grava. Errar aqui so troca o botao
 * oferecido: a rota decide pela chave em `notes`.
 */
export function faturaParcelada(
  linhas: readonly { description?: string | null; transaction_type?: string | null }[]
): boolean {
  return linhas.some(
    (l) =>
      l.transaction_type === "income" &&
      /^Fatura de [a-z]{3}\/\d{4} parcelada em \d+x$/.test(l.description ?? "")
  );
}
