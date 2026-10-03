/**
 * O FECHAMENTO DO MES DE UM GRUPO (HMO-245).
 *
 * A pergunta que a tela do grupo nao respondia: "em outubro o grupo tem
 * R$ 2.000 de conta -- quanto cada um paga, e quem paga para quem?"
 *
 * POR QUE A CONTA DO GRUPO SUMIA DO MES
 * -------------------------------------
 * A internet de R$ 159,90 no cartao C6, vencendo 15/10, lancada no grupo, nao
 * entra em `group_transactions`: ela e uma linha de `scheduled_transactions`
 * (conta prevista). A tela do grupo mostra isso numa secao "Previstas"
 * deliberadamente SEPARADA das despesas, e o total do "Mes Atual" soma apenas o
 * realizado. Entao a conta existia na tela, mas nao existia em nenhum total do
 * mes -- e o rateio dela nao existia em lugar nenhum, porque
 * `group_expense_splits` so nasce na BAIXA da conta prevista
 * ([[banco-ja-divide-despesa-de-grupo]]).
 *
 * Aquela separacao esta certa para a lista: parte aprovavel so existe no
 * realizado. Mas ela nao e a pergunta do fechamento. Para dividir o mes, "ja
 * aconteceu" e "vai acontecer dia 15" sao a mesma conta -- as duas saem do
 * bolso de alguem dentro do mes 10. Este modulo e a leitura que junta as duas.
 *
 * AS TRES ARMADILHAS QUE ESTA CONTA TEM, E QUE O TESTE PROVA
 * ---------------------------------------------------------
 * 1. **O SINAL DOS DOIS LADOS E OPOSTO.** `financial_transactions.amount` de
 *    despesa e NEGATIVO; `scheduled_transactions.amount` tem
 *    `CHECK (amount > 0)` e e sempre POSITIVO. Somar os dois crus faz a conta
 *    prevista de 159,90 CANCELAR a despesa realizada de -159,90 e o mes fechar
 *    em zero, com a lista das duas despesas ao lado. Por isso `valorDoFechamento`
 *    e quem converte, com `Math.abs`, e ninguem neste modulo le `amount`
 *    direto. Ver [[pulodogato-amount-sign-convention]].
 *
 * 2. **O RATEIO TEM DE FECHAR EXATO.** R$ 2.000 entre 3 pessoas nao da tres
 *    partes iguais. Arredondar cada parte por conta propria (666,67 x 3 =
 *    2.000,01) deixa um residuo de um centavo que aparece como "as contas deste
 *    grupo nao fecham" em TODO grupo de tres. `ratearCentavos` distribui o
 *    resto por maior-resto, entao a soma das partes e o total, sempre e
 *    exatamente.
 *
 *    Isso DIVERGE de propósito de `parteDoMembro` (lib/parte-do-grupo.ts), que
 *    copia o arredondamento do trigger (`ABS(amount) / member_count` por
 *    linha) porque ela previsa o que o banco VAI cobrar numa linha. Aqui o
 *    arredondamento acontece uma vez, sobre o total do mes, que e a unidade que
 *    o fechamento divide.
 *
 * 3. **RECEITA PREVISTA NAO E CONTA A PAGAR.** `scheduled_transactions` nao
 *    guarda direcao no sinal: quem diz se a previsao e despesa ou receita e a
 *    coluna `direction` da view `scheduled_transactions_effective`. Uma receita
 *    prevista de grupo somada aqui como despesa inventa dinheiro no fechamento.
 *    Este modulo filtra por `tipo`, e a rota le `direction` -- nunca refaz o
 *    COALESCE. Ver [[previsao-nao-tem-direcao-no-banco]].
 *
 * O MES E RECORTADO POR PREFIXO DE STRING, NAO POR Date
 * -----------------------------------------------------
 * `new Date("2026-10-01")` e meia-noite UTC, que em America/Sao_Paulo e
 * 21:00 de 30/09 -- a primeira conta do mes cai no mes anterior, e so em
 * maquina com fuso negativo. O teste roda nos dois fusos.
 * Ver [[teste-de-data-passa-em-utc-e-nao-ve-o-bug]].
 */

import { toCents, toReais, simplifySettlements } from "@/lib/settlement";
import type { SuggestedTransfer } from "@/lib/settlement";

/** De onde a linha do fechamento veio. As duas contam igual no total. */
export type OrigemDaLinha = "realizado" | "previsto";

/**
 * Uma conta do grupo dentro do fechamento, com o sinal JA normalizado.
 *
 * `valor` e sempre positivo e sempre em BRL: use `valorDoFechamento` para
 * produzi-lo a partir do que o banco devolve.
 */
export interface LinhaDoFechamento {
  id: string;
  descricao: string | null;
  /** BRL, positivo. */
  valor: number;
  /** `YYYY-MM-DD`: data do lancamento (realizado) ou vencimento (previsto). */
  data: string;
  /** Quem pagou, ou quem vai pagar. `null` = nao identificado. */
  pagador_user_id: string | null;
  origem: OrigemDaLinha;
}

/** O minimo que o fechamento precisa saber de um membro ativo. */
export interface MembroDoFechamento {
  user_id: string;
  full_name?: string | null;
  avatar_url?: string | null;
}

/** A posicao de um membro no mes. */
export interface PosicaoNoMes {
  user_id: string;
  full_name?: string | null;
  avatar_url?: string | null;
  /** Quanto saiu (ou vai sair) do bolso dele no mes. BRL, positivo. */
  pago: number;
  /** A parte dele no total do mes. BRL, positivo. */
  devido: number;
  /** `pago - devido`. Positivo = tem a receber; negativo = deve. */
  saldo: number;
}

export interface FechamentoDoMes {
  /** `YYYY-MM`. */
  mes: string;
  /** O que o grupo gasta no mes, previsto e realizado juntos. BRL, positivo. */
  total: number;
  total_realizado: number;
  total_previsto: number;
  /** As linhas do mes, da mais recente para a mais antiga. */
  linhas: LinhaDoFechamento[];
  /** Um por membro ativo, na ordem em que os membros chegaram. */
  por_membro: PosicaoNoMes[];
  /** "Voce paga X para Ana": o acerto do mes, com o menor numero de Pix. */
  transferencias: SuggestedTransfer[];
  /**
   * Quanto do mes foi pago por quem NAO e membro ativo (saiu do grupo). Esse
   * dinheiro entra no total e no `devido` de todos, mas nao tem a quem creditar,
   * entao e exatamente o quanto os saldos deixam de somar zero.
   */
  pago_por_nao_membro: number;
  /** `true` = os saldos somam zero e o acerto fecha. */
  fecha: boolean;
}

/**
 * O mes de uma data `YYYY-MM-DD`, como `YYYY-MM`.
 *
 * Recorte por string de proposito -- ver o cabecalho. Data vazia ou curta
 * devolve `""`, que nao casa com mes nenhum (e portanto nao entra em fechamento
 * nenhum), em vez de virar "NaN-NaN" ou o mes de hoje.
 */
export function mesDaData(data: string | null | undefined): string {
  // A guarda de TIPO e necessaria (`null.slice` lanca). Uma guarda de
  // COMPRIMENTO nao e: string com menos de 7 caracteres fatia em si mesma e nao
  // tem como casar com um padrao de exatamente 7. O mutante que removia essa
  // segunda guarda sobreviveu ao teste -- e sobreviveu com razao, porque ela era
  // codigo morto.
  if (typeof data !== "string") return "";
  const mes = data.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(mes) ? mes : "";
}

/**
 * O valor de uma linha para o fechamento: BRL, positivo.
 *
 * `Math.abs` ANTES da multiplicacao e o que faz os dois lados do app
 * (realizado negativo, previsto positivo) virarem a mesma grandeza. A cotacao
 * entra porque `financial_transactions.amount` esta na moeda da despesa, nao em
 * real -- num grupo em real `exchange_rate` e 1 e isso nao muda nada.
 *
 * Cotacao ausente, zero ou nao numerica vira 1: e o que `exchange_rate`
 * significa em linha de grupo em real, e multiplicar por 0 apagaria a despesa
 * do fechamento sem erro nenhum.
 */
export function valorDoFechamento(
  amount: number | string | null | undefined,
  exchangeRate?: number | string | null
): number {
  const bruto = Math.abs(Number(amount) || 0);
  const cotacao = Number(exchangeRate);
  const taxa = Number.isFinite(cotacao) && cotacao > 0 ? cotacao : 1;
  return toReais(Math.round(toCents(bruto) * taxa));
}

/**
 * Divide um total em centavos entre N pessoas de modo que as partes somem
 * EXATAMENTE o total.
 *
 * Maior-resto: todos recebem o piso da divisao, e os primeiros `resto`
 * participantes (na ordem recebida) ganham um centavo a mais. R$ 2.000 entre
 * tres da 666,67 / 666,67 / 666,66 -- e a soma e 2.000,00, nao 2.000,01.
 *
 * A ordem recebida decide quem fica com o centavo extra, e por isso a rota
 * ordena os membros de forma estavel: sem isso, o centavo pularia de pessoa a
 * cada refresh da tela sem nada ter mudado (a mesma razao do desempate por
 * `user_id` em `simplifySettlements`).
 *
 * Total negativo e tratado pelo mesmo caminho (piso para o lado do zero e resto
 * distribuido), mas o fechamento nunca produz um: `valorDoFechamento` ja
 * normalizou o sinal.
 */
export function ratearCentavos(
  totalCents: number,
  participantes: readonly string[]
): Map<string, number> {
  const partes = new Map<string, number>();
  const n = participantes.length;
  if (n === 0) return partes;

  const total = Math.round(totalCents);
  const sinal = total < 0 ? -1 : 1;
  const absoluto = Math.abs(total);
  const piso = Math.floor(absoluto / n);
  const resto = absoluto - piso * n;

  participantes.forEach((user_id, i) => {
    const parte = piso + (i < resto ? 1 : 0);
    partes.set(user_id, sinal * parte);
  });

  return partes;
}

/** O que o fechamento aceita como linha crua, antes do recorte do mes. */
export interface LinhaCrua extends LinhaDoFechamento {
  /**
   * `expense` entra no fechamento; `income` e `transfer` ficam fora.
   *
   * No realizado isso e `financial_transactions.transaction_type`; no previsto
   * e `direction` da view -- ver a armadilha 3 no cabecalho. Vem separado do
   * `valor` porque `valorDoFechamento` apaga o sinal, e depois dele o sinal nao
   * pode mais ser o criterio.
   */
  tipo?: string | null;
}

/** Uma linha de `group_transactions` + `financial_transactions`, como vem. */
export interface RealizadoCru {
  id: string;
  description?: string | null;
  amount: number | string | null;
  exchange_rate?: number | string | null;
  transaction_date?: string | null;
  user_id?: string | null;
  transaction_type?: string | null;
}

/** Uma linha de `scheduled_transactions_effective`, como vem. */
export interface PrevistoCru {
  id: string;
  description?: string | null;
  amount: number | string | null;
  due_date?: string | null;
  user_id?: string | null;
  status?: string | null;
  /** A coluna `direction` da view. NUNCA o `transaction_type` cru. */
  direction?: string | null;
}

/** Converte a despesa realizada em linha de fechamento. */
export function linhaDoRealizado(linha: RealizadoCru): LinhaCrua {
  return {
    id: linha.id,
    descricao: linha.description ?? null,
    valor: valorDoFechamento(linha.amount, linha.exchange_rate),
    data: linha.transaction_date ?? "",
    pagador_user_id: linha.user_id ?? null,
    origem: "realizado",
    // `transaction_type` NULL e comum em linha antiga (ver
    // [[transaction-type-nulo-esconde-o-pago]]). No realizado o sinal ainda
    // diz a direcao, e so despesa tem `amount < 0`, entao a linha sem tipo e
    // classificada pelo sinal em vez de descartada.
    tipo:
      linha.transaction_type ??
      ((Number(linha.amount) || 0) < 0 ? "expense" : "income"),
  };
}

/**
 * Converte a conta prevista em linha de fechamento -- ou `null` quando ela NAO
 * pode entrar.
 *
 * `status === 'paid'` devolve `null`, e esta e a unica defesa contra contar a
 * mesma conta DUAS vezes: a conta prevista que recebeu baixa tem
 * `transaction_id` preenchido (o CHECK `scheduled_transactions_paid_check`
 * exige) e essa transacao JA e uma linha de `group_transactions`, ou seja ja
 * esta no lado realizado deste mesmo fechamento. Sem este `null` a internet de
 * R$ 159,90 paga dia 15 viraria R$ 319,80 no fechamento de outubro.
 *
 * O filtro vive aqui, e nao no `.neq()` da consulta, para ter teste: um
 * `.neq("status", "paid")` que alguem troque por `.eq()` numa refatoracao nao
 * quebra nenhuma assercao, e o defeito que ele cria e um total dobrado que
 * parece plausivel.
 */
export function linhaDoPrevisto(linha: PrevistoCru): LinhaCrua | null {
  if (linha.status === "paid") return null;

  return {
    id: linha.id,
    descricao: linha.description ?? null,
    // A conta prevista nao tem `exchange_rate` (a coluna nao existe em
    // `scheduled_transactions`), entao o valor entra em BRL por conta propria.
    valor: valorDoFechamento(linha.amount),
    data: linha.due_date ?? "",
    pagador_user_id: linha.user_id ?? null,
    origem: "previsto",
    // `direction` da view, com 'expense' como ultimo recurso -- a view JA faz
    // o COALESCE com a regra recorrente, e refazer essa precedencia aqui e o
    // defeito que a 027 fechou.
    tipo: linha.direction ?? "expense",
  };
}

/**
 * Fecha o mes: total do grupo, a parte de cada um e quem paga para quem.
 *
 * Previsto e realizado contam IGUAL -- e o pedido da HMO-245 e o que separa
 * esta leitura do "Mes Atual" da aba de despesas, que soma so o realizado.
 */
export function fecharMes(
  linhas: readonly LinhaCrua[],
  membros: readonly MembroDoFechamento[],
  mes: string
): FechamentoDoMes {
  // `transfer` fica fora porque toda transferencia tem DUAS pernas que se
  // anulam: contar as duas infla o total do mes sem ninguem ter gasto nada.
  // Ver [[duas-pernas-mantem-o-total-certo]].
  const doMes = linhas
    .filter((l) => mesDaData(l.data) === mes)
    .filter((l) => (l.tipo ?? "expense") === "expense")
    .map((l) => ({ ...l, valor: Math.abs(Number(l.valor) || 0) }));

  const totalCents = doMes.reduce((soma, l) => soma + toCents(l.valor), 0);
  const realizadoCents = doMes
    .filter((l) => l.origem === "realizado")
    .reduce((soma, l) => soma + toCents(l.valor), 0);

  const ids = membros.map((m) => m.user_id);
  const devidoPor = ratearCentavos(totalCents, ids);

  const pagoPor = new Map<string, number>();
  let naoMembroCents = 0;
  for (const l of doMes) {
    const cents = toCents(l.valor);
    if (l.pagador_user_id && devidoPor.has(l.pagador_user_id)) {
      pagoPor.set(
        l.pagador_user_id,
        (pagoPor.get(l.pagador_user_id) ?? 0) + cents
      );
    } else {
      // Quem pagou saiu do grupo (ou nao foi identificado): o gasto conta no
      // total e no `devido` de todos, mas nao ha a quem creditar.
      naoMembroCents += cents;
    }
  }

  const por_membro: PosicaoNoMes[] = membros.map((m) => {
    const pagoCents = pagoPor.get(m.user_id) ?? 0;
    const devCents = devidoPor.get(m.user_id) ?? 0;
    return {
      user_id: m.user_id,
      full_name: m.full_name ?? null,
      avatar_url: m.avatar_url ?? null,
      pago: toReais(pagoCents),
      devido: toReais(devCents),
      saldo: toReais(pagoCents - devCents),
    };
  });

  const transferencias = simplifySettlements(
    por_membro.map((p) => ({
      user_id: p.user_id,
      net_balance: p.saldo,
      full_name: p.full_name,
      avatar_url: p.avatar_url,
    }))
  );

  const somaDosSaldos = por_membro.reduce((acc, p) => acc + toCents(p.saldo), 0);

  return {
    mes,
    total: toReais(totalCents),
    total_realizado: toReais(realizadoCents),
    total_previsto: toReais(totalCents - realizadoCents),
    // Mais recente primeiro; empate de data pelo id, para a ordem nao mudar
    // entre dois carregamentos da mesma tela.
    linhas: [...doMes].sort(
      (a, b) => b.data.localeCompare(a.data) || a.id.localeCompare(b.id)
    ),
    por_membro,
    transferencias,
    pago_por_nao_membro: toReais(naoMembroCents),
    // As DUAS condicoes sao necessarias, e a segunda nao e redundante: num
    // grupo COM membros, `pago_por_nao_membro > 0` ja desequilibra os saldos
    // (e o teste do membro que saiu mostra o residuo de -300), mas num grupo
    // SEM membro ativo `por_membro` e vazio e a soma dos saldos da zero por
    // vacuidade -- o fechamento diria "fecha" com R$ 100 sem dono.
    fecha: somaDosSaldos === 0 && naoMembroCents === 0,
  };
}

/**
 * Os meses que tem alguma conta, do mais recente para o mais antigo.
 *
 * O seletor de mes da tela sai daqui: oferecer doze meses fixos mostraria onze
 * fechamentos vazios, e oferecer so o mes de hoje esconderia o fechamento que o
 * grupo acabou de fechar.
 *
 * O mes de hoje entra SEMPRE, mesmo sem conta nenhuma: um grupo novo precisa
 * abrir no fechamento do mes corrente, e nao numa lista vazia.
 */
export function mesesComConta(
  linhas: readonly LinhaCrua[],
  hoje: string
): string[] {
  const meses = new Set<string>();
  const mesDeHoje = mesDaData(hoje);
  if (mesDeHoje) meses.add(mesDeHoje);
  for (const l of linhas) {
    const mes = mesDaData(l.data);
    if (mes) meses.add(mes);
  }
  // `Array.from` e nao spread: o tsconfig do app tem target antigo e
  // `[...umSet]` nao compila la (TS2802), embora compile no tsc do teste.
  return Array.from(meses).sort((a, b) => b.localeCompare(a));
}
