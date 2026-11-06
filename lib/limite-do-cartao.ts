// ---------------------------------------------------------------------------
// LIMITE DO CARTAO E SITUACAO DA FATURA (comparacao com o Minhas Financas)
// ---------------------------------------------------------------------------
// O pedido (Helio, 06/11/2026): o Minhas Financas mostra em cada cartao o
// Limite, o valor Em aberto, o Limite disponivel com uma barra de uso, e um
// selo "Aberta" ou "Fechada" na fatura do mes. O Pulo do Gato so mostrava o
// limite cadastrado.
//
// O QUE O MINHAS FINANCAS FAZ, MEDIDO COM LANCAMENTOS DE TESTE
// ------------------------------------------------------------
//   compra a vista R$ 300 + compra 3x R$ 600, limite R$ 30.000
//     -> Em aberto R$ 900 (as parcelas FUTURAS contam inteiras), disponivel
//        R$ 29.100, fatura do mes R$ 500;
//   pagamento de R$ 200 da fatura
//     -> Em aberto R$ 700, disponivel R$ 29.300;
//   compra R$ 80 e estorno R$ 30 noutro cartao
//     -> Em aberto R$ 50.
//
// Em aberto e, entao, a divida INTEIRA do cartao: tudo que foi comprado menos
// estorno menos pagamento. Aqui isso ja existe e tem nome: `current_balance`
// do cartao, mantido pelo trigger `update_account_balance` -- a compra e
// gravada negativa, o estorno e a perna do pagamento entram positivos, e a
// serie parcelada e gravada inteira de uma vez (`lib/fatura-do-periodo.ts`,
// HMO-290). O que era o defeito da "Fatura atual" e exatamente o numero certo
// para o limite. Por isso nada aqui soma lancamento: le o saldo e inverte o
// sinal.
//
// A SITUACAO DA FATURA
// --------------------
// A fatura de um mes esta ABERTA enquanto uma compra feita hoje ainda cairia
// nela, FECHADA depois disso, e e FUTURA quando ainda nao comecou a receber
// compra de hoje. "Cairia nela" e a regra da compra (`faturaAbertaDoCartao`,
// presa ao `card_invoice_month` da 006) aplicada a hoje -- nenhuma segunda
// copia da regra do fechamento.
// ---------------------------------------------------------------------------

import { faturaAbertaDoCartao } from "@/lib/fatura-do-cartao";

/** O que esta regra le do cadastro do cartao. */
export interface CartaoDoLimite {
  current_balance?: number | string | null;
  credit_limit?: number | string | null;
}

export interface LimiteDoCartao {
  /** Quanto do limite esta comprometido: compras menos estornos e pagamentos. */
  emAberto: number;
  /** `null` quando o cartao nao tem limite cadastrado. */
  limite: number | null;
  /** `limite - emAberto`; `null` sem limite. Pode ser negativo (estourado). */
  disponivel: number | null;
  /** 0 a 100, para a barra. `null` sem limite. */
  percentualUsado: number | null;
}

function numero(valor: number | string | null | undefined): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function centavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Limite, em aberto e disponivel de um cartao.
 *
 * `null` quando o saldo nao da para ler: "Em aberto R$ 0,00" ali seria o zero
 * confiante de `lib/offline-leitura.ts`.
 *
 * Cartao com credito (estorno maior que a divida) fica com `emAberto` NEGATIVO
 * e disponivel acima do limite, que e o que o banco mostra. Arredondar para
 * zero esconderia o credito.
 */
export function limiteDoCartao(cartao: CartaoDoLimite): LimiteDoCartao | null {
  const saldo = numero(cartao.current_balance);
  if (saldo === null) return null;

  // `0 - saldo` e nao `-saldo`: `-0` sairia "-R$ 0,00" no Intl.
  const emAberto = centavos(0 - saldo) || 0;
  const limiteBruto = numero(cartao.credit_limit);
  const limite = limiteBruto !== null && limiteBruto > 0 ? limiteBruto : null;

  if (limite === null) {
    return { emAberto, limite: null, disponivel: null, percentualUsado: null };
  }

  const disponivel = centavos(limite - emAberto);
  const percentualUsado = Math.min(
    100,
    Math.max(0, Math.round((emAberto / limite) * 100))
  );
  return { emAberto, limite, disponivel, percentualUsado };
}

export type SituacaoDaFatura = "aberta" | "fechada" | "futura";

/**
 * A fatura do mes `mes` ('AAAA-MM' ou 'AAAA-MM-01') esta aberta, fechada ou
 * ainda e futura, em `hoje` ('AAAA-MM-DD').
 *
 * `null` quando nao da para dizer: mes ou hoje ilegiveis. Cartao sem dia de
 * fechamento usa a regra da 006 para ele (a fatura do proprio mes).
 */
export function situacaoDaFatura(
  mes: string | null | undefined,
  hoje: string,
  closingDay: number | null | undefined
): SituacaoDaFatura | null {
  if (!mes || !/^\d{4}-\d{2}(-\d{2})?$/.test(mes)) return null;
  const alvo = mes.slice(0, 7);
  // '2026-13' casa com o regex e nao e mes nenhum: sem esta peneira ele seria
  // "futura" com cara de certeza.
  const numeroDoMes = Number(alvo.slice(5, 7));
  if (numeroDoMes < 1 || numeroDoMes > 12) return null;

  const aberta =
    closingDay === null || closingDay === undefined
      ? /^\d{4}-\d{2}-\d{2}$/.test(hoje)
        ? hoje.slice(0, 7)
        : null
      : faturaAbertaDoCartao(hoje, closingDay);
  if (!aberta) return null;

  if (alvo === aberta) return "aberta";
  return alvo < aberta ? "fechada" : "futura";
}

/** O texto do selo. */
export const ROTULO_DA_SITUACAO: Record<SituacaoDaFatura, string> = {
  aberta: "Aberta",
  fechada: "Fechada",
  futura: "Futura",
};

/** 'AAAA-MM-DD' de hoje no fuso de Sao Paulo, onde o cartao fecha. */
export function hojeNoFusoDoCartao(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(agora);
}
