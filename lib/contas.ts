// ---------------------------------------------------------------------------
// CONTA TEM SALDO, CARTAO TEM FATURA (HMO-166)
// ---------------------------------------------------------------------------
// A tela de cadastro era UM formulario para os oito valores do ENUM
// `account_type`, com limite, dia de fechamento e dia de vencimento aparecendo
// e desaparecendo conforme a pessoa trocava o tipo. Quem cadastrava uma conta
// corrente via tres campos de cartao piscarem e sumirem.
//
// A propria tela ja sabia que as duas coisas nao sao a mesma na hora de somar:
//
//     if (conta.account_type === "credit_card") fatura += Math.abs(valor);
//     else saldo += valor;
//
// Cartao de credito guarda o que foi GASTO -- uma divida que cresce. Conta
// guarda o que se TEM. Somar os dois daria um "total" que nao e dinheiro
// nenhum. Este arquivo e o unico lugar que decide qual tipo e qual, para que as
// duas telas separadas nao cheguem a respostas diferentes para a mesma conta.
//
// POR QUE O ESCOPO E UM CAMPO DO CATALOGO, E NAO UM `if`
// ------------------------------------------------------
// `debit_card` e o caso que nao se resolve sozinho: o usuario chama aquilo de
// "cartao", mas ele nao tem fatura, nem limite, nem fechamento, nem vencimento
// -- o dinheiro sai da conta na hora. Ele se comporta como conta e esta em
// Contas. Se essa escolha for revista, o que muda e a palavra `escopo` de UMA
// linha da tabela abaixo: nenhuma tela, nenhum total e nenhum formulario
// repetem a decisao.
//
// O QUE NAO PODE SE PERDER, E ESTA AQUI PORQUE SE PERDE CALADO
// ------------------------------------------------------------
// Os campos de fatura sao gravados `null` fora do escopo de cartao. Sem isso
// sobra dia de fechamento numa conta corrente -- ela nao tem fatura para
// fechar, entao o valor fica no banco sem nada que o leia e sem nada que o
// denuncie.
// ---------------------------------------------------------------------------

import type { AccountType, FinancialAccount } from "@/types/financial";
import { MOEDA_PADRAO } from "@/lib/dinheiro";
import { moedaSugerida } from "@/lib/moeda";

/** As duas telas. */
export type EscopoDeConta = "conta" | "cartao";

export interface TipoDeConta {
  valor: AccountType;
  rotulo: string;
  /** Em qual das duas telas este tipo se cadastra e se lista. */
  escopo: EscopoDeConta;
}

/**
 * Os oito valores do ENUM `account_type`, cada um com a tela onde mora.
 *
 * A ordem e a que a tela antiga usava, menos o cartao de credito, que saiu do
 * meio da lista de contas para a tela dele.
 */
export const TIPOS_DE_CONTA: TipoDeConta[] = [
  { valor: "checking", rotulo: "Conta corrente", escopo: "conta" },
  { valor: "savings", rotulo: "Poupança", escopo: "conta" },
  { valor: "credit_card", rotulo: "Cartão de crédito", escopo: "cartao" },
  // Ver o cabecalho: ele se comporta como conta. Trocar esta palavra move o
  // tipo de tela, de cadastro e de total, sem mais nenhuma edicao.
  { valor: "debit_card", rotulo: "Cartão de débito", escopo: "conta" },
  { valor: "cash", rotulo: "Dinheiro", escopo: "conta" },
  { valor: "digital", rotulo: "Carteira digital", escopo: "conta" },
  { valor: "investment", rotulo: "Investimento", escopo: "conta" },
  { valor: "other", rotulo: "Outra", escopo: "conta" },
];

/**
 * O tipo desconhecido cai em "Outra", como na tela antiga.
 *
 * Nao e defensivo a toa: `account_type` chega de uma consulta, e uma linha
 * gravada por um caminho que nao passou por aqui nao pode derrubar a tela.
 */
export const porTipo = (tipo: AccountType): TipoDeConta =>
  TIPOS_DE_CONTA.find((t) => t.valor === tipo) ??
  TIPOS_DE_CONTA[TIPOS_DE_CONTA.length - 1];

export const escopoDoTipo = (tipo: AccountType): EscopoDeConta =>
  porTipo(tipo).escopo;

/** Os tipos que o seletor de UMA tela oferece. */
export const tiposDoEscopo = (escopo: EscopoDeConta): TipoDeConta[] =>
  TIPOS_DE_CONTA.filter((t) => t.escopo === escopo);

/** O tipo que uma tela cria quando o seletor nao existe (Cartoes). */
export const tipoPadraoDoEscopo = (escopo: EscopoDeConta): AccountType =>
  tiposDoEscopo(escopo)[0].valor;

/** O recorte da lista que cada tela mostra. */
export function contasDoEscopo<T extends { account_type: AccountType }>(
  contas: T[],
  escopo: EscopoDeConta
): T[] {
  return contas.filter((c) => escopoDoTipo(c.account_type) === escopo);
}

// ---------------------------------------------------------------------------
// OS CAMPOS DE CADA TELA
// ---------------------------------------------------------------------------

export interface CamposDaConta {
  /** O seletor de tipo. Em Cartoes ha um tipo so, entao nao ha o que escolher. */
  tipo: boolean;
  /** Limite, dia de fechamento e dia de vencimento: so onde ha fatura. */
  fatura: boolean;
  /** O que o botao e o titulo do dialogo chamam a coisa. */
  substantivo: string;
}

/**
 * O que vai para a tela, a partir do escopo e so dele.
 *
 * E funcao de uma entrada, e e ela que o teste de renderizacao usa como oraculo
 * do que devia estar em tela. `camposDoEscopo("conta").fatura === false` e a
 * issue inteira em uma linha.
 */
export function camposDoEscopo(escopo: EscopoDeConta): CamposDaConta {
  if (escopo === "cartao") {
    return { tipo: false, fatura: true, substantivo: "cartão" };
  }
  return { tipo: true, fatura: false, substantivo: "conta" };
}

// ---------------------------------------------------------------------------
// OS TOTAIS
// ---------------------------------------------------------------------------

/**
 * O total de UMA tela.
 *
 * Contas somam saldo com sinal: uma conta no vermelho tem que puxar o total
 * para baixo. Cartoes somam `Math.abs` porque a fatura e apresentada como
 * divida -- o valor gravado e negativo (as compras rebaixaram o saldo do
 * cartao) e "Faturas em aberto: -R$ 1.200" seria um sinal a mais na leitura.
 *
 * Somar os dois escopos separados tem que dar o mesmo que a tela unica somava
 * junta: isto e o que o teste afirma, porque a separacao nao pode mover um
 * centavo de lugar.
 */
export function totalDoEscopo(
  contas: Array<Pick<FinancialAccount, "account_type" | "current_balance">>,
  escopo: EscopoDeConta
): number {
  return contasDoEscopo(contas, escopo).reduce((soma, conta) => {
    const valor = Number(conta.current_balance ?? 0);
    return soma + (escopo === "cartao" ? Math.abs(valor) : valor);
  }, 0);
}

/**
 * O cartao que nao fecha fatura.
 *
 * Sem os dois dias o `card_invoice_month()` (migration 006) trata toda compra
 * como do proprio mes: a fatura nao fecha e a compra do dia 28 aparece no mes
 * errado. O aviso na tela existe por isso, e nao por capricho de cadastro.
 */
export function faltaFatura(
  conta: Pick<FinancialAccount, "account_type" | "closing_day" | "due_day">
): boolean {
  if (escopoDoTipo(conta.account_type) !== "cartao") return false;
  return !conta.closing_day || !conta.due_day;
}

// ---------------------------------------------------------------------------
// O FORMULARIO
// ---------------------------------------------------------------------------

/** O estado do formulario. Tudo string: e o que sai de um `<input>`. */
export interface ValoresDaConta {
  id?: string;
  name: string;
  account_type: AccountType;
  bank_name: string;
  last_four_digits: string;
  credit_limit: string;
  closing_day: string;
  due_day: string;
  currency: string;
}

/**
 * Conta nova nasce na moeda principal da pessoa, e nao em BRL fixo: quem
 * configurou dolar como moeda oficial nao quer digitar "dolar" em cada conta
 * que cria.
 *
 * O parametro e opcional porque a preferencia chega de uma leitura e demora um
 * tique; ate ela chegar o formulario nasce em `MOEDA_PADRAO`, e a tela
 * reinicializa quando abre o dialogo.
 */
export function valoresIniciais(
  escopo: EscopoDeConta,
  moedaOficial: string = MOEDA_PADRAO
): ValoresDaConta {
  return {
    name: "",
    account_type: tipoPadraoDoEscopo(escopo),
    bank_name: "",
    last_four_digits: "",
    credit_limit: "",
    closing_day: "",
    due_day: "",
    currency: moedaOficial,
  };
}

/** Preenche o formulario a partir de uma conta que ja existe. */
export function valoresDaConta(conta: FinancialAccount): ValoresDaConta {
  return {
    id: conta.id,
    name: conta.name,
    account_type: conta.account_type,
    bank_name: conta.bank_name ?? "",
    last_four_digits: conta.last_four_digits ?? "",
    credit_limit: conta.credit_limit != null ? String(conta.credit_limit) : "",
    closing_day: conta.closing_day != null ? String(conta.closing_day) : "",
    due_day: conta.due_day != null ? String(conta.due_day) : "",
    // A moeda da PROPRIA conta, nunca a oficial: reabrir uma conta em dolar tem
    // que mostrar dolar. Cair na oficial aqui faria a edicao de qualquer campo
    // (trocar o nome, corrigir o dia de vencimento) gravar a moeda principal em
    // cima da moeda da conta, sem ninguem tocar nesse campo.
    currency: moedaSugerida({ daConta: conta.currency }),
  };
}

/**
 * O que impede o envio, em uma frase para quem esta preenchendo.
 *
 * Os dois dias tem CHECK de 1 a 31 no banco. Barrar aqui evita um 500 com
 * codigo 23514, que nao diz nada para quem digitou 32.
 */
export function validarConta(
  valores: ValoresDaConta,
  escopo: EscopoDeConta
): string | null {
  const campos = camposDoEscopo(escopo);

  if (!valores.name.trim()) {
    return `Dê um nome para ${escopo === "cartao" ? "o cartão" : "a conta"}`;
  }

  if (!campos.fatura) return null;

  for (const [rotulo, valor] of [
    ["fechamento", valores.closing_day],
    ["vencimento", valores.due_day],
  ] as const) {
    if (!valor) continue;
    const dia = Number(valor);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
      return `O dia de ${rotulo} deve estar entre 1 e 31`;
    }
  }

  return null;
}

/**
 * O corpo do POST/PATCH de `/api/financial-accounts`.
 *
 * OS TRES `null` SAO O PONTO. Fora do escopo de cartao nao existe limite, nem
 * fechamento, nem vencimento -- e o que foi digitado antes de trocar de tela
 * nao pode viajar junto. A tela antiga ja zerava os dois dias, mas mandava
 * `credit_limit` sempre: dava para gravar limite numa conta corrente digitando
 * o valor com o tipo em "Cartao de credito" e trocando o tipo depois. Ninguem
 * ve, porque nenhuma tela le limite de conta -- e por isso que precisa ser
 * decidido aqui, e nao no JSX.
 */
export function corpoDaConta(
  valores: ValoresDaConta,
  escopo: EscopoDeConta
): Record<string, unknown> {
  const temFatura = camposDoEscopo(escopo).fatura;

  return {
    name: valores.name.trim(),
    account_type: valores.account_type,
    bank_name: valores.bank_name.trim(),
    last_four_digits: valores.last_four_digits.trim(),
    credit_limit: temFatura ? valores.credit_limit || null : null,
    closing_day: temFatura ? valores.closing_day || null : null,
    due_day: temFatura ? valores.due_day || null : null,
    // Sempre mandada, inclusive com o seletor escondido. Note que ela NAO segue
    // a regra dos tres `null` acima: limite e os dois dias sao de cartao, a
    // moeda e de toda conta. Mandar so quando o campo esta visivel faria a conta
    // perder a moeda que tinha no dia em que a pessoa desligasse o recurso nas
    // configuracoes e editasse o nome -- a conta em dolar voltaria a BRL calada,
    // e o relatorio dela mudaria de balde.
    currency: valores.currency,
  };
}
