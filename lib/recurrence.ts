// =====================================================
// RECORRENCIA - datas dos gastos fixos
// =====================================================
// Calcula os vencimentos de uma regra de recorrencia (`recurring_rules`) num
// intervalo. E daqui que saem as linhas de `scheduled_transactions`.
//
// Por que aqui e nao no banco: as migrations 003 e 004 existiram so para
// consertar triggers que gravavam sem privilegio suficiente. Calculo de data
// nao precisa desse risco -- e em TypeScript da para exercitar fevereiro,
// ano bissexto e horario de verao sem subir um Postgres.
//
// Regras de ouro deste arquivo:
//   * data e string 'YYYY-MM-DD', nunca Date local. `new Date('2026-03-10')`
//     e UTC, mas `new Date(2026, 2, 10)` e local -- misturar os dois faz o
//     vencimento andar um dia para tras em quem esta a oeste de Greenwich,
//     que e o caso do Brasil inteiro.
//   * toda a aritmetica roda em UTC.
// =====================================================

export type RecurrenceFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "bimonthly"
  | "quarterly"
  | "semiannual"
  | "annual";

export interface RecurrenceSpec {
  frequency: RecurrenceFrequency;
  /** De quantos em quantos periodos. `monthly` + 3 = a cada 3 meses. */
  interval_count?: number | null;
  /** Dia do vencimento (1-31). Em mes curto, cai no ultimo dia do mes. */
  due_day?: number | null;
  /** 'YYYY-MM-DD' */
  start_date: string;
  /** 'YYYY-MM-DD'; null = sem fim */
  end_date?: string | null;
  /** Quantas ocorrencias no total; null = sem limite */
  max_occurrences?: number | null;
}

/** Quantos meses cada frequencia anda por periodo. 0 = a frequencia e em dias. */
const MONTHS_PER_PERIOD: Record<RecurrenceFrequency, number> = {
  weekly: 0,
  biweekly: 0,
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

const DAYS_PER_PERIOD: Partial<Record<RecurrenceFrequency, number>> = {
  weekly: 7,
  biweekly: 14,
};

// Um teto para o laco. Uma regra semanal cobrindo 10 anos da ~520 ocorrencias;
// qualquer coisa acima disso e a chamada pedindo um intervalo absurdo, e a
// resposta certa e parar, nao encher a tabela.
const MAX_ITERATIONS = 1000;

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toUtc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Ultimo dia do mes (1-12) -- 1-indexado no mes, como o usuario fala. */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Soma meses preservando o dia desejado, sem transbordar para o mes seguinte.
 *
 * O `setUTCMonth` cru transforma 31/01 + 1 mes em 03/03, porque 31/02 nao
 * existe e o Date "corrige" somando os dias que faltam. Para uma conta que
 * vence todo dia 31, isso move o vencimento para marco e o mes de fevereiro
 * fica sem conta nenhuma. Aqui o dia 31 em fevereiro vira 28 (ou 29).
 */
export function addMonthsClamped(iso: string, months: number, preferredDay?: number | null): string {
  const base = toUtc(iso);
  const day = preferredDay ?? base.getUTCDate();
  const totalMonths = base.getUTCFullYear() * 12 + base.getUTCMonth() + months;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths % 12; // 0-indexado
  const clamped = Math.min(day, lastDayOfMonth(year, month + 1));
  return toIso(new Date(Date.UTC(year, month, clamped)));
}

export function addDays(iso: string, days: number): string {
  const base = toUtc(iso);
  base.setUTCDate(base.getUTCDate() + days);
  return toIso(base);
}

/**
 * Primeiro vencimento da regra.
 *
 * Com `due_day`, a primeira ocorrencia e o proximo dia `due_day` em ou depois
 * de `start_date` -- cadastrar o aluguel no dia 20 com vencimento no dia 10
 * cria a conta do mes QUE VEM, nao uma ja vencida hoje.
 */
export function firstOccurrence(spec: RecurrenceSpec): string {
  const { start_date, due_day, frequency } = spec;
  if (!MONTHS_PER_PERIOD[frequency] || !due_day) return start_date;

  const base = toUtc(start_date);
  const day = Math.min(due_day, lastDayOfMonth(base.getUTCFullYear(), base.getUTCMonth() + 1));
  const candidate = toIso(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), day)));
  if (candidate >= start_date) return candidate;
  return addMonthsClamped(start_date, 1, due_day);
}

/**
 * Todos os vencimentos da regra dentro de [from, to], inclusive nas pontas.
 *
 * Idempotente por construcao: a mesma regra e o mesmo intervalo dao sempre a
 * mesma lista, que e o que permite chamar isso toda vez que a tela abre. Quem
 * impede a linha duplicada no banco e o indice unico (rule_id, due_date) da
 * migration 005.
 */
export function occurrencesBetween(spec: RecurrenceSpec, from: string, to: string): string[] {
  if (!isIsoDate(from) || !isIsoDate(to) || !isIsoDate(spec.start_date)) {
    throw new Error("occurrencesBetween: datas precisam estar em YYYY-MM-DD");
  }
  if (to < from) return [];

  const interval = Math.max(1, spec.interval_count ?? 1);
  const months = MONTHS_PER_PERIOD[spec.frequency] * interval;
  const days = (DAYS_PER_PERIOD[spec.frequency] ?? 0) * interval;
  if (!months && !days) {
    throw new Error(`occurrencesBetween: frequencia desconhecida (${spec.frequency})`);
  }

  // O dia preferido e reancorado a cada passo a partir da data inicial, e nao
  // da ocorrencia anterior. Sem isso, o vencimento "dia 31" que caiu em 28/02
  // passaria a puxar dia 28 para sempre -- o mes curto contaminaria o resto do
  // calendario.
  const anchor = firstOccurrence(spec);
  const preferredDay = spec.due_day ?? toUtc(anchor).getUTCDate();

  const out: string[] = [];
  const hardEnd = spec.end_date && spec.end_date < to ? spec.end_date : to;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const due = months ? addMonthsClamped(anchor, months * i, preferredDay) : addDays(anchor, days * i);

    if (due > hardEnd) break;
    if (spec.max_occurrences != null && i >= spec.max_occurrences) break;
    if (due >= from) out.push(due);
  }

  return out;
}

/** Hoje em 'YYYY-MM-DD', no fuso de Sao Paulo (onde os vencimentos vivem). */
export function today(timeZone = "America/Sao_Paulo"): string {
  // en-CA formata como YYYY-MM-DD, que e exatamente o formato que queremos.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

/** Quanto uma regra custa por mes, para somar gastos fixos de frequencias diferentes. */
export function monthlyCost(spec: RecurrenceSpec, amount: number): number {
  const interval = Math.max(1, spec.interval_count ?? 1);
  const months = MONTHS_PER_PERIOD[spec.frequency] * interval;
  if (months) return amount / months;
  const days = (DAYS_PER_PERIOD[spec.frequency] ?? 7) * interval;
  return (amount * 365) / (12 * days);
}
