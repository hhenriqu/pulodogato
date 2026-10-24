// ---------------------------------------------------------------------------
// A FATURA PAGA NO RESULTADO (RN017.3, RN017.4, fase 6 do modelo novo)
// ---------------------------------------------------------------------------
// A compra no cartao nao entra sozinha em Despesas. Ela e uma linha da fatura,
// e a fatura e que conta: no mes do VENCIMENTO, realizada quando foi paga,
// pelo total das linhas dela que contam nos totais.
//
// O banco faz a conta do modo mes (`personal_category_monthly_totals`, perna 5
// da 072). Este modulo faz a mesma conta com as linhas de
// `card_invoice_paid_entries` para quem soma em TypeScript: a aba Despesas, o
// modo intervalo dos relatorios e os tres cartoes de Financas Pessoais. Cada
// leitor tambem tira a compra no cartao das linhas cruas dele
// (`ehCompraNoCartao`, lib/realizado-do-caixa.ts, e `ehGastoNoCartao`,
// lib/telas-de-movimentacao.ts).
//
// O ESTORNO ABATE
// --------------
// `invoice_amount` e positivo na compra e negativo no estorno (`-amount`, a
// view da 006). A fatura soma os dois, e o total e a despesa. Por categoria, a
// conta e a mesma do banco: a categoria so com estorno numa fatura fica com
// despesa negativa naquele mes.
//
// A LINHA FORA DOS TOTAIS FICA FORA (060)
// --------------------------------------
// A fatura do banco soma a linha desmarcada, e o Resultado nao. `apenasNosTotais`
// e o mesmo filtro das outras somas do app.
//
// SO IMPORTA FOLHAS, e isso e requisito: `chave-da-fatura`, `fora-dos-totais` e
// `categorias-do-periodo` nao puxam nada do Next, e as suites que compilam este
// modulo rodam sem o runtime.
// ---------------------------------------------------------------------------

import { chaveFatura } from "@/lib/chave-da-fatura";
import { apenasNosTotais, type LinhaComTotais } from "@/lib/fora-dos-totais";
import {
  CATEGORIA_AUSENTE,
  type LinhaDeCategoria,
} from "@/lib/categorias-do-periodo";

/** A view da 072: cada linha de uma fatura paga, com o vencimento dela. */
export const VIEW_DA_FATURA_PAGA = "card_invoice_paid_entries";

/**
 * As colunas que as leituras pedem.
 *
 * `include_in_total` e load-bearing do mesmo jeito que em
 * `COLUNAS_DO_REALIZADO_DE_CAIXA`: sem ela no `select`, `apenasNosTotais`
 * recebe `undefined`, deixa tudo passar, e a linha desmarcada volta a somar.
 */
export const COLUNAS_DA_FATURA_PAGA =
  "id, account_id, account_name, invoice_month, invoice_description, due_date, paid_date, category_id, invoice_amount, currency, include_in_total";

/**
 * O prefixo do id da fatura paga na aba Despesas.
 *
 * A linha nao existe em tabela nenhuma: ela e a soma das compras de uma fatura.
 * O prefixo e o que `ehFaturaPagaNoResultado` (lib/telas-de-movimentacao.ts)
 * reconhece, e e ele que separa esta linha de uma `expense` de verdade que
 * carregue a chave da fatura em `notes`. A string esta repetida la, e
 * scripts/test-realizado-do-caixa.mjs afirma que as duas sao iguais.
 */
export const PREFIXO_DA_FATURA_PAGA = "fatura-paga:";

/** Uma linha de `card_invoice_paid_entries`, do jeito que a view entrega. */
export interface LinhaDaFaturaPaga extends LinhaComTotais {
  id: string;
  account_id: string;
  account_name?: string | null;
  /** 'AAAA-MM-01', o mes da fatura (nao o do vencimento). */
  invoice_month: string;
  invoice_description?: string | null;
  /** O vencimento da conta a pagar da fatura: a data em que ela conta. */
  due_date: string;
  paid_date?: string | null;
  category_id: string | null;
  /** Positivo na compra, negativo no estorno. `numeric` chega como string. */
  invoice_amount: number | string;
  currency?: string | null;
}

/** Uma fatura paga, somada. */
export interface FaturaPaga {
  accountId: string;
  /** 'AAAA-MM-01', o mes da fatura. */
  mes: string;
  nomeDoCartao: string | null;
  descricao: string | null;
  /** 'AAAA-MM-DD', o vencimento. */
  vencimento: string;
  pagaEm: string | null;
  moeda: string;
  /** O total das linhas que contam: a despesa. Pode ser <= 0. */
  total: number;
  /** Quantas linhas contam. */
  linhas: number;
}

const centavos = (valor: number) => Number(valor.toFixed(2));

const valorDaLinha = (linha: LinhaDaFaturaPaga): number => {
  const n = Number(linha.invoice_amount);
  return Number.isFinite(n) ? n : 0;
};

const mesDaFatura = (valor: string): string => String(valor).slice(0, 10);

/**
 * As faturas pagas, uma por cartao, mes da fatura e moeda.
 *
 * So as linhas que contam nos totais entram, e a fatura sem nenhuma linha que
 * conte nao aparece: ela nao tem despesa nenhuma para o Resultado.
 */
export function faturasPagas(
  linhas: readonly LinhaDaFaturaPaga[],
  moedaPadrao = "BRL"
): FaturaPaga[] {
  const porFatura = new Map<string, FaturaPaga>();

  for (const linha of apenasNosTotais(linhas)) {
    const mes = mesDaFatura(linha.invoice_month);
    const moeda = linha.currency ?? moedaPadrao;
    const chave = `${linha.account_id}\u0000${mes}\u0000${moeda}`;
    const fatura =
      porFatura.get(chave) ??
      ({
        accountId: linha.account_id,
        mes,
        nomeDoCartao: linha.account_name ?? null,
        descricao: linha.invoice_description ?? null,
        vencimento: linha.due_date,
        pagaEm: linha.paid_date ?? null,
        moeda,
        total: 0,
        linhas: 0,
      } as FaturaPaga);
    fatura.total += valorDaLinha(linha);
    fatura.linhas += 1;
    porFatura.set(chave, fatura);
  }

  return Array.from(porFatura.values()).map((f) => ({
    ...f,
    total: centavos(f.total),
  }));
}

/** Uma fatura paga como um lancamento que os agregadores de fluxo somam. */
export interface FaturaPagaComoTransacao extends LinhaComTotais {
  id: string;
  description: string;
  amount: number;
  transaction_type: "expense" | "income";
  transaction_date: string;
  currency: string;
  category_id: null;
  notes: string;
}

/**
 * As faturas pagas como lancamentos: uma linha por fatura, na data do
 * vencimento, com a despesa NEGATIVA, que e como `financial_transactions`
 * grava.
 *
 * Para `agregarTransacoesPorMoeda` (o modo intervalo do fluxo de caixa) e
 * `resumoDoPeriodo` (os cartoes de Financas Pessoais). Os dois somam
 * `Math.abs(amount)` pelo tipo, entao a fatura cujo total e negativo (um
 * estorno maior que as compras que contam) sai `income`: o Resultado fica o
 * mesmo do banco, onde ela e despesa negativa.
 */
export function faturasPagasComoTransacoes(
  linhas: readonly LinhaDaFaturaPaga[],
  moedaPadrao = "BRL"
): FaturaPagaComoTransacao[] {
  const saida: FaturaPagaComoTransacao[] = [];
  for (const fatura of faturasPagas(linhas, moedaPadrao)) {
    if (fatura.total === 0) continue;
    saida.push({
      id: `${PREFIXO_DA_FATURA_PAGA}${fatura.accountId}:${fatura.mes}`,
      description: fatura.descricao ?? `Fatura ${fatura.nomeDoCartao ?? "do cartão"}`,
      amount: -fatura.total,
      transaction_type: fatura.total > 0 ? "expense" : "income",
      transaction_date: fatura.vencimento,
      currency: fatura.moeda,
      category_id: null,
      notes: chaveFatura(fatura.mes, fatura.accountId),
      include_in_total: true,
    });
  }
  return saida;
}

/**
 * As faturas pagas por categoria: o mesmo que a perna 5 da 072 soma, para o
 * modo intervalo do relatorio por categoria.
 *
 * Sai no formato de `linhasDeCategoria` (lib/categorias-do-periodo.ts), e nao
 * como lancamentos para ela somar, porque ela soma `Math.abs`: o estorno viraria
 * despesa. Aqui a despesa e assinada, como no banco.
 */
export function faturasPagasPorCategoria(
  linhas: readonly LinhaDaFaturaPaga[],
  moedaPadrao = "BRL"
): LinhaDeCategoria[] {
  const porCategoria = new Map<string, LinhaDeCategoria>();

  for (const linha of apenasNosTotais(linhas)) {
    const categoria = linha.category_id ?? CATEGORIA_AUSENTE;
    const moeda = linha.currency ?? moedaPadrao;
    const chave = `${categoria}\u0000${moeda}`;
    const atual =
      porCategoria.get(chave) ??
      ({
        category_id: categoria,
        expense: 0,
        income: 0,
        transaction_count: 0,
        currency: moeda,
      } as LinhaDeCategoria);
    atual.expense += valorDaLinha(linha);
    atual.transaction_count += 1;
    porCategoria.set(chave, atual);
  }

  return Array.from(porCategoria.values()).map((l) => ({
    ...l,
    expense: centavos(l.expense),
  }));
}

/** A fatura paga como linha realizada da aba Despesas. */
export interface FaturaPagaRealizada {
  id: string;
  description: string;
  amount: number;
  transaction_date: string;
  transaction_type: "expense";
  currency: string;
  notes: string;
  category: { name: string; is_expense: boolean };
  account: { id: string; name: string | null; account_type: string };
  include_in_total: true;
}

/**
 * As faturas pagas como linhas realizadas da aba Despesas, uma por fatura.
 *
 * A data e o VENCIMENTO, e nao o dia do pagamento: e por ela que a fatura entra
 * no periodo (RN017.4), e e a data em que ela estava no previsto ate ser paga.
 *
 * Sem `user_id`, de proposito: a linha nao e um lancamento, e `posso_editar`
 * cai para `false` (ninguem edita uma soma). A conta e o cartao, para a lista
 * dizer de onde ela e.
 *
 * A fatura de total zero ou negativo nao vira linha: a aba nao mostra despesa
 * negativa. O Resultado do banco a tem como despesa negativa, e a diferenca e
 * so desse caso.
 */
export function faturasPagasComoRealizadas(
  linhas: readonly LinhaDaFaturaPaga[],
  moedaPadrao = "BRL"
): FaturaPagaRealizada[] {
  const saida: FaturaPagaRealizada[] = [];
  for (const fatura of faturasPagas(linhas, moedaPadrao)) {
    if (!(fatura.total > 0)) continue;
    saida.push({
      id: `${PREFIXO_DA_FATURA_PAGA}${fatura.accountId}:${fatura.mes}`,
      description: fatura.descricao ?? `Fatura ${fatura.nomeDoCartao ?? "do cartão"}`,
      amount: -fatura.total,
      transaction_date: fatura.vencimento,
      transaction_type: "expense",
      currency: fatura.moeda,
      notes: chaveFatura(fatura.mes, fatura.accountId),
      category: { name: "Fatura do cartão", is_expense: true },
      account: {
        id: fatura.accountId,
        name: fatura.nomeDoCartao,
        account_type: "credit_card",
      },
      include_in_total: true,
    });
  }
  return saida;
}
