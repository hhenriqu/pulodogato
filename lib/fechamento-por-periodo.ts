/**
 * O FECHAMENTO DO GRUPO POR PERIODO (RN018, fase 2 do modelo novo).
 *
 * O grupo tem um dia de fechamento (1 a 28). No dia, o saldo de cada membro no
 * periodo vira uma conta prevista PESSOAL: "Pagamento ao grupo" para quem deve,
 * "A receber do grupo" para quem tem a receber. Este modulo e a aritmetica
 * disso, sem I/O; quem le o banco e grava e lib/services/fechamento-dos-grupos.ts,
 * e quem confere as somas de novo, do lado do banco, e
 * `registrar_fechamento_do_grupo` (067).
 *
 * O exemplo da PRD, que o teste reproduz numero por numero: grupo Casa, % de
 * 50/30/20, R$ 2.000 de contas no periodo.
 *
 *   Helio    pagou 1.500   responsabilidade 1.000   A receber   500
 *   Lais     pagou   500   responsabilidade   600   Pagamento   100
 *   Leticia  pagou     0   responsabilidade   400   Pagamento   400
 *
 * O QUE ENTRA NO PERIODO
 * ----------------------
 * Toda despesa REALIZADA do grupo ainda nao fechada, com data ate o fim do
 * periodo -- inclusive a de data antiga, lancada depois do fechamento dela
 * (RN018.3). A conta prevista entra quando e paga, pela transacao que a baixa
 * cria: ela nunca e linha daqui por si, e por isso nao ha como a mesma conta
 * entrar como prevista num periodo e como paga no seguinte.
 *
 * O acerto de antes da fase 3 (um `group_settlements` sem conta gerada) tambem
 * entra (RN018.11): quem mandou o Pix "pagou" aquele valor ao grupo, e quem
 * recebeu deixa de ter aquilo a receber. Sem isso, a Lais que ja pagou R$ 100
 * ao Helio receberia a mesma divida de novo na conta do fechamento.
 *
 * QUEM NAO E MEMBRO ATIVO
 * -----------------------
 * Quem saiu do grupo pode ter pago uma conta do periodo. A responsabilidade e
 * so dos membros ativos (e o % deles que soma 100), mas o que essa pessoa pagou
 * continua tendo acontecido: ela entra na foto com responsabilidade zero e sai
 * com "A receber do grupo". E isso que faz os saldos somarem zero sem inventar
 * dono para o dinheiro.
 *
 * AS DATAS SAO STRING `YYYY-MM-DD`
 * --------------------------------
 * Pelo mesmo motivo de lib/fechamento-do-grupo.ts: `new Date("2026-10-01")` e
 * 21:00 de 30/09 em America/Sao_Paulo. A conta de dia e feita em UTC por
 * lib/recurrence.ts, que nunca sai do dia que recebeu.
 */

import { toCents, toReais } from "@/lib/settlement";
import { ratearPorPeso } from "@/lib/fechamento-do-grupo";
import { addDays, addMonthsClamped, isIsoDate } from "@/lib/recurrence";

/** O menor e o maior dia de fechamento: todo mes tem dia 28. */
export const DIA_MINIMO = 1;
export const DIA_MAXIMO = 28;

/**
 * Quantos dias DEPOIS do dia de fechamento o cron ainda fecha o periodo.
 *
 * O cron e diario, e a Vercel tem tolerancia de +-59 min (RN015.3): um dia de
 * execucao perdida nao pode deixar o periodo aberto ate o mes que vem. Mas a
 * janela nao pode ser larga, porque quem configura o dia 9 no dia 20 nao espera
 * que um periodo terminado onze dias atras feche na hora, com as contas ja
 * vencidas. Dois dias cobre a execucao perdida e nada alem dela.
 */
export const TOLERANCIA_DO_CRON = 2;

/**
 * O dia de fechamento, validado. Qualquer coisa fora de 1..28 inteiro e `null`
 * -- o grupo que "nao fecha" --, e nao um dia corrigido: um dia 31 virando 28
 * em silencio fecharia o periodo tres dias antes do que o admin escolheu.
 */
export function diaDeFechamento(valor: unknown): number | null {
  const n = typeof valor === "string" && valor.trim() !== "" ? Number(valor) : valor;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  return n >= DIA_MINIMO && n <= DIA_MAXIMO ? n : null;
}

/**
 * O fechamento mais recente em ou antes de `hoje`.
 *
 * Dia 9 e hoje 15/10 -> 09/10. Hoje 09/10 -> 09/10 (o dia do fechamento e o
 * ultimo dia do periodo, entao ele mesmo ja e "fechou"). Hoje 05/10 -> 09/09.
 */
export function ultimoFechamento(dia: number, hoje: string): string {
  const doMes = `${hoje.slice(0, 7)}-${String(dia).padStart(2, "0")}`;
  return doMes <= hoje ? doMes : addMonthsClamped(doMes, -1, dia);
}

/** O proximo fechamento em ou depois de `hoje`: o fim do periodo aberto. */
export function proximoFechamento(dia: number, hoje: string): string {
  const doMes = `${hoje.slice(0, 7)}-${String(dia).padStart(2, "0")}`;
  return doMes >= hoje ? doMes : addMonthsClamped(doMes, 1, dia);
}

/** Um periodo, com as duas pontas inclusivas. */
export interface Periodo {
  inicio: string;
  fim: string;
}

/**
 * O periodo que termina em `fim`.
 *
 * Comeca no dia seguinte ao fim do fechamento anterior. Sem fechamento
 * anterior, comeca no dia seguinte ao mesmo dia do mes passado -- o periodo
 * "normal" --, mas isso e so o rotulo: o primeiro fechamento inclui toda
 * despesa ainda nao fechada, de qualquer data (RN018.3).
 */
export function periodoQueTerminaEm(fim: string, fimAnterior: string | null): Periodo {
  const inicio =
    fimAnterior && isIsoDate(fimAnterior) && fimAnterior < fim
      ? addDays(fimAnterior, 1)
      : addDays(addMonthsClamped(fim, -1, Number(fim.slice(8, 10))), 1);
  return { inicio, fim };
}

/**
 * O periodo que o cron deve fechar HOJE, ou `null`.
 *
 * Tres condicoes, e cada uma tem seu motivo:
 *
 *   1. o grupo tem dia de fechamento;
 *   2. o fechamento mais recente foi ha no maximo `TOLERANCIA_DO_CRON` dias --
 *      a execucao perdida e coberta, o periodo que acabou ha semanas nao;
 *   3. ele e DEPOIS do ultimo periodo ja fechado. Sem isso, mudar o dia de 9
 *      para 20 no dia 21 fecharia de novo um periodo terminado em 20/10 que
 *      comeca antes de 09/10, que ja fechou.
 *
 * O banco ainda recusa o mesmo `period_end` duas vezes; esta funcao decide se
 * vale a pena chamar.
 */
export function periodoParaFechar(
  dia: unknown,
  hoje: string,
  fimAnterior: string | null
): Periodo | null {
  const d = diaDeFechamento(dia);
  if (d === null || !isIsoDate(hoje)) return null;

  const fim = ultimoFechamento(d, hoje);
  if (addDays(fim, TOLERANCIA_DO_CRON) < hoje) return null;
  if (fimAnterior && fimAnterior >= fim) return null;

  return periodoQueTerminaEm(fim, fimAnterior);
}

/** Uma despesa realizada do grupo, ainda nao fechada. */
export interface DespesaDoPeriodo {
  transaction_id: string;
  pagador_user_id: string;
  /** BRL, positivo -- ver `valorDoFechamento` em lib/fechamento-do-grupo.ts. */
  valor: number;
  /** `YYYY-MM-DD`. */
  data: string;
  descricao?: string | null;
}

/** Um acerto antigo do grupo (sem conta gerada), ainda nao fechado. */
export interface AcertoDoPeriodo {
  settlement_id: string;
  de_user_id: string;
  para_user_id: string;
  /** BRL, positivo. */
  valor: number;
  data: string;
}

/**
 * Um membro ATIVO e o peso dele, na ordem estavel da rota (`joined_at`,
 * `user_id`): em divisao igual o centavo que sobra vai pela ordem.
 */
export interface MembroDoPeriodo {
  user_id: string;
  peso: number;
}

/** A foto de um participante no fechamento. Os valores sao BRL. */
export interface PosicaoNoPeriodo {
  user_id: string;
  /** O % que valeu, para a tela e para a foto. 0 para quem nao e membro ativo. */
  percentual: number;
  pago: number;
  /** O que mandou menos o que recebeu em acerto antigo. */
  acertos: number;
  responsabilidade: number;
  /** `pago + acertos - responsabilidade`. Positivo = tem a receber. */
  saldo: number;
}

/** O item como `registrar_fechamento_do_grupo` o grava. */
export interface ItemDoFechamento {
  kind: "despesa" | "acerto";
  transaction_id?: string;
  settlement_id?: string;
  from_user_id: string;
  to_user_id?: string;
  amount: number;
  item_date: string;
  description?: string | null;
}

/** A conta que o fechamento gera. */
export interface ContaDoFechamento {
  user_id: string;
  tipo: "expense" | "income";
  valor: number;
}

export interface FechamentoDoPeriodo {
  total: number;
  membros: PosicaoNoPeriodo[];
  itens: ItemDoFechamento[];
  contas: ContaDoFechamento[];
  /**
   * `false` quando ha despesa e nenhum membro ativo para responder por ela: a
   * soma das responsabilidades nao chega no total, e o banco recusaria. O cron
   * registra e segue para o proximo grupo.
   */
  fecha: boolean;
}

/**
 * Fecha um periodo: responsabilidade, saldo e a conta de cada um.
 *
 * Recebe o que ainda nao foi fechado; devolve so o que entra, que e o que tem
 * data ate `fim` e valor positivo. Tudo em centavos ate a saida.
 */
export function fecharPeriodo(entrada: {
  despesas: readonly DespesaDoPeriodo[];
  acertos: readonly AcertoDoPeriodo[];
  membros: readonly MembroDoPeriodo[];
  fim: string;
}): FechamentoDoPeriodo {
  const { fim } = entrada;
  const despesas = entrada.despesas.filter(
    (d) => isIsoDate(d.data) && d.data <= fim && toCents(d.valor) > 0
  );
  const acertos = entrada.acertos.filter(
    (a) =>
      isIsoDate(a.data) &&
      a.data <= fim &&
      toCents(a.valor) > 0 &&
      a.de_user_id !== a.para_user_id
  );

  const totalCents = despesas.reduce((s, d) => s + toCents(d.valor), 0);

  // A responsabilidade e SO dos membros ativos: e o % deles que soma 100.
  const responsabilidade = ratearPorPeso(
    totalCents,
    entrada.membros.map((m) => ({ user_id: m.user_id, peso: m.peso }))
  );

  // O % da foto. Pesos todos em zero e o degrau 0/0 de `ratearPorPeso`, que
  // divide igual -- a foto diz o mesmo.
  const somaPesos = entrada.membros.reduce(
    (s, m) => s + (Number.isFinite(m.peso) && m.peso > 0 ? m.peso : 0),
    0
  );
  const percentualDe = (peso: number) =>
    somaPesos > 0
      ? Math.round(((Number.isFinite(peso) && peso > 0 ? peso : 0) / somaPesos) * 10000) / 100
      : Math.round(10000 / entrada.membros.length) / 100;

  // Os participantes: os membros ativos, na ordem recebida, e depois quem
  // aparece num item sem ser membro ativo, em ordem de id para a foto nao mudar
  // de ordem entre duas execucoes.
  const ordem: string[] = entrada.membros.map((m) => m.user_id);
  const deFora = new Set<string>();
  for (const d of despesas) deFora.add(d.pagador_user_id);
  for (const a of acertos) {
    deFora.add(a.de_user_id);
    deFora.add(a.para_user_id);
  }
  for (const id of ordem) deFora.delete(id);
  ordem.push(...Array.from(deFora).sort());

  const pago = new Map<string, number>();
  for (const d of despesas) {
    pago.set(d.pagador_user_id, (pago.get(d.pagador_user_id) ?? 0) + toCents(d.valor));
  }

  const acerto = new Map<string, number>();
  for (const a of acertos) {
    const c = toCents(a.valor);
    acerto.set(a.de_user_id, (acerto.get(a.de_user_id) ?? 0) + c);
    acerto.set(a.para_user_id, (acerto.get(a.para_user_id) ?? 0) - c);
  }

  const pesoDe = new Map(entrada.membros.map((m) => [m.user_id, m.peso] as const));

  const membros: PosicaoNoPeriodo[] = ordem.map((user_id) => {
    const p = pago.get(user_id) ?? 0;
    const a = acerto.get(user_id) ?? 0;
    const r = responsabilidade.get(user_id) ?? 0;
    return {
      user_id,
      percentual: pesoDe.has(user_id) ? percentualDe(pesoDe.get(user_id) as number) : 0,
      pago: toReais(p),
      acertos: toReais(a),
      responsabilidade: toReais(r),
      saldo: toReais(p + a - r),
    };
  });

  const contas: ContaDoFechamento[] = membros
    .filter((m) => toCents(m.saldo) !== 0)
    .map((m) => ({
      user_id: m.user_id,
      tipo: m.saldo < 0 ? "expense" : "income",
      valor: toReais(Math.abs(toCents(m.saldo))),
    }));

  const itens: ItemDoFechamento[] = [
    ...despesas.map((d) => ({
      kind: "despesa" as const,
      transaction_id: d.transaction_id,
      from_user_id: d.pagador_user_id,
      amount: toReais(toCents(d.valor)),
      item_date: d.data,
      description: d.descricao ?? null,
    })),
    ...acertos.map((a) => ({
      kind: "acerto" as const,
      settlement_id: a.settlement_id,
      from_user_id: a.de_user_id,
      to_user_id: a.para_user_id,
      amount: toReais(toCents(a.valor)),
      item_date: a.data,
    })),
  ];

  const somaResponsabilidades = Array.from(responsabilidade.values()).reduce(
    (s, c) => s + c,
    0
  );

  return {
    total: toReais(totalCents),
    membros,
    itens,
    contas,
    fecha: somaResponsabilidades === totalCents,
  };
}
