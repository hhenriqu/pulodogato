// ---------------------------------------------------------------------------
// PAGAMENTO PARCIAL DA FATURA, COM O RESTANTE NA PROXIMA (como no Minhas Financas)
// ---------------------------------------------------------------------------
// O pedido (Helio, 06/11/2026): pagar menos que o total da fatura e mandar o
// que faltou para a fatura seguinte, com encargos opcionais -- o que o Minhas
// Financas faz no "Registrar pagamento".
//
// O QUE O MINHAS FINANCAS FAZ, MEDIDO COM LANCAMENTOS DE TESTE
// ------------------------------------------------------------
//   fatura de novembro R$ 500, pagamento de R$ 200 com "Valor restante na
//   proxima fatura" marcado:
//     -> novembro: "Fatura parcial R$ 200", com uma linha de credito
//        "Valor restante na proxima fatura" de R$ 300;
//     -> dezembro: uma linha "Restante de fatura" de R$ 300;
//     -> Em aberto do cartao: de R$ 900 para R$ 700 (so o pago saiu);
//     -> nenhum juro automatico: encargo e um campo que a pessoa preenche.
//
// AQUI, SAO DUAS LINHAS NO CARTAO QUE SE ANULAM NO SALDO
// -----------------------------------------------------
//   credito  +restante, `invoice_month_override` = a fatura paga
//   debito   -restante, `invoice_month_override` = a fatura seguinte
//
// O saldo do cartao (`current_balance`, o "Em aberto") nao muda com elas -- so
// a transferencia do pagamento mexe nele, exatamente como no Minhas Financas.
// O que muda e EM QUAL FATURA a divida aparece: a paga fecha no valor pago, e
// a seguinte cresce o restante.
//
// As duas vao com `include_in_total = false` (060): nao sao receita nem despesa
// de ninguem, sao a divida mudando de mes. A fatura soma a linha desmarcada
// (061), entao o total da fatura continua certo; o relatorio do mes nao ganha
// R$ 300 de "receita" e R$ 300 de "despesa" que nunca existiram.
//
// O ENCARGO, ao contrario, e despesa de verdade (juros, multa, IOF): entra na
// fatura seguinte e conta nos totais.
//
// A CHAVE EM `notes` liga as linhas a fatura paga, para o estorno da baixa
// apaga-las junto com as pernas. Uma chave por fatura basta: a fatura e paga
// uma vez so (a linha da agenda vira `paid`).
// ---------------------------------------------------------------------------

export const PREFIXO_CHAVE_RESTANTE = "restante-da-fatura:";
export const PREFIXO_CHAVE_ENCARGO = "encargo-da-fatura:";

/** O mes da fatura em 'AAAA-MM-01', ou `null` se ilegivel. */
function primeiroDia(mes: string | null | undefined): string | null {
  if (!mes || !/^\d{4}-\d{2}(-\d{2})?$/.test(mes)) return null;
  const numero = Number(mes.slice(5, 7));
  if (numero < 1 || numero > 12) return null;
  return `${mes.slice(0, 7)}-01`;
}

/** 'AAAA-MM-01' do mes seguinte; `null` se o mes e ilegivel. */
export function mesSeguinteDaFatura(mes: string | null | undefined): string | null {
  const dia = primeiroDia(mes);
  if (!dia) return null;
  let ano = Number(dia.slice(0, 4));
  let m = Number(dia.slice(5, 7)) + 1;
  if (m === 13) {
    m = 1;
    ano += 1;
  }
  return `${String(ano).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
}

/** A chave das duas linhas do restante desta fatura (paga em `mes`). */
export function chaveRestante(mes: string, cartaoId: string): string | null {
  const dia = primeiroDia(mes);
  if (!dia || !cartaoId) return null;
  return `${PREFIXO_CHAVE_RESTANTE}${dia}:${cartaoId}`;
}

/** A chave do encargo pago junto com esta fatura. */
export function chaveEncargo(mes: string, cartaoId: string): string | null {
  const dia = primeiroDia(mes);
  if (!dia || !cartaoId) return null;
  return `${PREFIXO_CHAVE_ENCARGO}${dia}:${cartaoId}`;
}

/** Os valores em centavos inteiros: R$ 0,1 + R$ 0,2 nao pode virar 0,30000004. */
function centavos(valor: number): number {
  return Math.round(valor * 100);
}

export type PapelDaLinha = "credito-do-restante" | "restante" | "encargo";

/** Uma linha a gravar no cartao, sem `user_id`/`service_id`/`category_id`. */
export interface LinhaDoPagamentoParcial {
  papel: PapelDaLinha;
  account_id: string;
  /** Com o sinal do banco: credito positivo, divida negativa. */
  amount: number;
  transaction_type: "income" | "expense";
  transaction_date: string;
  invoice_month_override: string;
  description: string;
  notes: string;
  include_in_total: boolean;
}

export type PlanoDoPagamentoParcial =
  | {
      ok: true;
      /** Quanto ficou sem pagar (0 quando pagou tudo ou mais). */
      restante: number;
      linhas: LinhaDoPagamentoParcial[];
    }
  | { ok: false; erro: string };

const NOMES_DOS_MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function nomeDoMes(dia: string): string {
  return `${NOMES_DOS_MESES[Number(dia.slice(5, 7)) - 1]}/${dia.slice(0, 4)}`;
}

/**
 * As linhas que o pagamento parcial grava no cartao, alem das duas pernas.
 *
 * - `levarRestante` falso, ou pagou o total (ou mais): nenhuma linha de
 *   restante. Pagar a menos sem marcar a opcao e o comportamento de antes --
 *   a divida fica no saldo do cartao, sem fatura.
 * - `encargo` > 0: uma despesa na fatura seguinte, com ou sem restante.
 */
export function planoDoPagamentoParcial(params: {
  totalDaFatura: number;
  valorPago: number;
  levarRestante: boolean;
  encargo?: number | null;
  mes: string;
  cartaoId: string;
  pagoEm: string;
}): PlanoDoPagamentoParcial {
  const { totalDaFatura, valorPago, levarRestante, mes, cartaoId, pagoEm } =
    params;
  const encargo = params.encargo ?? 0;

  const dia = primeiroDia(mes);
  const seguinte = mesSeguinteDaFatura(mes);
  if (!dia || !seguinte || !cartaoId) {
    return { ok: false, erro: "Fatura sem mês legível" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pagoEm)) {
    return { ok: false, erro: "Data de pagamento inválida" };
  }
  if (!Number.isFinite(totalDaFatura) || !Number.isFinite(valorPago)) {
    return { ok: false, erro: "Valor da fatura inválido" };
  }
  if (!Number.isFinite(encargo) || encargo < 0) {
    return { ok: false, erro: "Encargo deve ser zero ou positivo" };
  }

  const restanteEmCentavos = centavos(totalDaFatura) - centavos(valorPago);
  const restante = restanteEmCentavos > 0 ? restanteEmCentavos / 100 : 0;
  const linhas: LinhaDoPagamentoParcial[] = [];

  if (levarRestante && restante > 0) {
    const chave = `${PREFIXO_CHAVE_RESTANTE}${dia}:${cartaoId}`;
    linhas.push(
      {
        papel: "credito-do-restante",
        account_id: cartaoId,
        amount: restante,
        transaction_type: "income",
        transaction_date: pagoEm,
        invoice_month_override: dia,
        description: `Valor restante na próxima fatura (${nomeDoMes(seguinte)})`,
        notes: chave,
        include_in_total: false,
      },
      {
        papel: "restante",
        account_id: cartaoId,
        amount: -restante,
        transaction_type: "expense",
        transaction_date: pagoEm,
        invoice_month_override: seguinte,
        description: `Restante da fatura de ${nomeDoMes(dia)}`,
        notes: chave,
        include_in_total: false,
      }
    );
  }

  const encargoEmCentavos = centavos(encargo);
  if (encargoEmCentavos > 0) {
    linhas.push({
      papel: "encargo",
      account_id: cartaoId,
      amount: -encargoEmCentavos / 100,
      transaction_type: "expense",
      transaction_date: pagoEm,
      invoice_month_override: seguinte,
      description: `Encargos da fatura de ${nomeDoMes(dia)}`,
      notes: `${PREFIXO_CHAVE_ENCARGO}${dia}:${cartaoId}`,
      include_in_total: true,
    });
  }

  return { ok: true, restante, linhas };
}

/**
 * O valor digitado ("1.234,56", "200", "200,5") em reais, ou `null`.
 * Vazio tambem e `null`: a tela usa o total.
 */
export function valorDigitado(texto: string | null | undefined): number | null {
  const limpo = (texto ?? "").trim().replace(/^R\$\s*/, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  if (!/^\d+(\.\d{1,2})?$/.test(normalizado)) return null;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// AS CATEGORIAS RESERVADAS
// ---------------------------------------------------------------------------
// O restante NAO usa a categoria do ajuste de saldo: a tela do cartao reconhece
// "o ajuste da fatura" pela categoria (`ajusteDaFatura`), e uma linha de
// restante com ela seria lida como ajuste -- e "Ajustar saldo" calcularia a
// diferenca sobre o numero errado.

export type TipoDeCategoriaDoParcial = "restante" | "encargo";

export function categoriaDoPapel(papel: PapelDaLinha): TipoDeCategoriaDoParcial {
  return papel === "encargo" ? "encargo" : "restante";
}

export const CATEGORIAS_DO_PAGAMENTO_PARCIAL: Record<
  TipoDeCategoriaDoParcial,
  { nome: string; descricao: string; icone: string; cor: string; ehDespesa: boolean }
> = {
  restante: {
    nome: "Restante de fatura",
    descricao:
      "Reservada: o valor não pago de uma fatura, levado para a fatura seguinte. Não é receita nem despesa.",
    icone: "arrow-right",
    cor: "#6B7280",
    ehDespesa: true,
  },
  encargo: {
    nome: "Encargos do cartão",
    descricao:
      "Reservada: juros, multa e IOF informados no pagamento parcial da fatura.",
    icone: "percent",
    cor: "#B91C1C",
    ehDespesa: true,
  },
};
