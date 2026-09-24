// =====================================================
// ALERTAS DE ASSINATURA - uma implementacao so
// =====================================================
// Os dois alertas do detector (preco subiu mais de 10%, cobranca depois de
// marcada como cancelada) passaram a ter TRES consumidores:
//
//   1. GET /api/recurrences      a tela /dashboard/recurrences;
//   2. GET /api/notifications    o sino do app;
//   3. GET /api/cron/recurrence-alerts   quem manda o push e grava o "ja avisei".
//
// Este arquivo e o mesmo desenho -- e existe pelo mesmo motivo -- de
// lib/services/recurrence-scan.ts: o cliente do Supabase entra como parametro
// para que a sessao do usuario e a service_role rodem o MESMO codigo. Se a
// regra fosse copiada, o dia em que alguem ajustasse o limite num lugar e nao
// no outro produziria a pior falha possivel: o push diria uma coisa, a tela
// diria outra, e as duas pareceriam certas.
//
// O CALCULO NAO MORA AQUI
// -----------------------
// Quem decide o que e alerta e lib/recurrence-detector.ts, que tem teste
// proprio (`npm run test:recurrence-detector`). Aqui mora a CONVERSA COM O
// BANCO -- quais linhas entram, que transacoes sustentam cada uma -- e a
// traducao do alerta para a linguagem da notificacao (`kind`, `reference_date`,
// titulo e corpo). Reescrever a regra numa view SQL criaria duas definicoes do
// mesmo alerta; ver o cabecalho da migration 016.
// =====================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  alertaDeAumento,
  alertaDeCobrancaAposCancelamento,
  type Alerta,
  type AlertaTipo,
  type RecurrenceStatus,
} from "@/lib/recurrence-detector";

/** O `kind` de bill_notifications, na familia de recorrencia (migration 016). */
export type RecurrenceAlertKind = "price_increase" | "charge_after_cancel";

/**
 * O tipo do detector -> o `kind` do banco.
 *
 * Sao dois vocabularios de proposito: o do detector descreve o FENOMENO e o do
 * banco e um dominio fechado por CHECK, compartilhado com a familia de conta
 * prevista ('due_soon', 'overdue'). O mapa existe para a traducao ficar num
 * lugar so -- espalhada, um `kind` digitado errado sai do CHECK como erro de
 * gravacao no cron, longe de quem o escreveu.
 */
export const KIND_DO_ALERTA: Record<AlertaTipo, RecurrenceAlertKind> = {
  PRICE_INCREASE: "price_increase",
  CHARGED_AFTER_CANCEL: "charge_after_cancel",
};

/** Para onde o clique no sino e no push leva. */
export const URL_DOS_ALERTAS = "/dashboard/recurrences";

/** As colunas de detected_recurrences que o calculo dos alertas precisa. */
export const COLUNAS_PARA_ALERTA =
  "id, merchant_key, display_name, status, status_changed_at, last_charge_date, transaction_ids";

/**
 * Teto de recorrencias lidas numa varredura de avisos.
 *
 * Mesmo papel do MAX_TRANSACOES da varredura: o PostgREST limita a resposta de
 * qualquer jeito, e sem um teto explicito o corte seria invisivel -- o cron
 * avisaria sobre um pedaco da base e sairia verde. Com ele a rota devolve
 * `truncated: true` e o corte aparece.
 */
export const MAX_RECORRENCIAS = 2000;

export interface RecorrenciaParaAlerta {
  id: string;
  merchant_key: string;
  display_name: string;
  status: RecurrenceStatus;
  status_changed_at: string | null;
  last_charge_date: string;
  transaction_ids: string[] | null;
}

export interface AlertaDeRecorrencia extends Alerta {
  /** A linha de detected_recurrences que originou o alerta. */
  recurrenceId: string;
  kind: RecurrenceAlertKind;
  /** A chave de deduplicacao do aviso. Ver `referenciaDoAlerta`. */
  referenceDate: string;
  title: string;
  body: string;
}

/**
 * O usuario ja decidiu sobre esta assinatura?
 *
 * 'IGNORED' e um "nao me fale mais disso" explicito -- e o botao que a tela
 * oferece justamente para calar uma linha. Mandar push de uma assinatura
 * ignorada seria desfazer a decisao dele pelo canal mais intrusivo que o app
 * tem.
 *
 * Isto muda um comportamento antigo de proposito: antes da HMO-148 a tela
 * calculava alerta para TODA linha que ela listava, e com `?status=all` (como o
 * usuario desfaz um "ignorar") os alertas das ignoradas apareciam. Agora a
 * regra e uma so, aqui, para o sino, o push e a tela nao discordarem sobre o
 * que conta como alerta.
 */
export function mereceAlerta(status: RecurrenceStatus): boolean {
  return status !== "IGNORED";
}

/**
 * A data que entra na chave unica do aviso -- ou seja, o que faz um aviso ser
 * "o mesmo de novo" ou "um fato novo".
 *
 * Aumento de preco: `last_charge_date`. O alerta fala da ULTIMA cobranca, e a
 * cobranca seguinte e um fato novo que merece aviso novo -- mesma ideia do
 * `due_date` na familia de conta prevista, onde adiar a conta ressuscita o
 * aviso. Sem a data na chave, o usuario seria avisado do reajuste uma unica vez
 * na vida da assinatura e o do ano seguinte passaria calado.
 *
 * Cobranca apos cancelamento: a data da COBRANCA QUE A FRASE CITA, e nao
 * `last_charge_date`. A frase desse alerta nomeia sempre a primeira cobranca
 * posterior ao cancelamento (ver o docstring de
 * `alertaDeCobrancaAposCancelamento` -- e deliberado). Com `last_charge_date` a
 * chave andaria a cada cobranca nova e o usuario receberia a MESMA frase, com o
 * MESMO valor e a MESMA data, todo mes -- indistinguivel de um bug, e
 * exatamente o spam que a HMO-148 existe para impedir. Marcar o status de novo
 * move `status_changed_at`, muda qual e a "primeira cobranca posterior" e ai
 * sim gera aviso novo.
 */
export function referenciaDoAlerta(alerta: Alerta, lastChargeDate: string): string {
  return alerta.dataDaCobranca ?? lastChargeDate;
}

/**
 * Titulo e corpo, no molde do `textoDoAviso` de lib/services/notifications.ts.
 *
 * O corpo e a `mensagem` do detector, sem reescrita: e a MESMA frase que a tela
 * /dashboard/recurrences mostra e que o teste do detector fixa. Um segundo
 * texto aqui divergiria do da tela na primeira correcao de redacao, e o usuario
 * veria o push dizer uma coisa e o app outra.
 *
 * O titulo e curto porque em push e ele que aparece na tela de bloqueio; o
 * corpo pode ser cortado pelo sistema, o titulo raramente.
 */
export function textoDoAlerta(alerta: Alerta): { title: string; body: string } {
  if (alerta.tipo === "PRICE_INCREASE") {
    return { title: `${alerta.displayName} ficou mais caro`, body: alerta.mensagem };
  }
  return {
    title: `${alerta.displayName} cobrou depois de cancelada`,
    body: alerta.mensagem,
  };
}

/**
 * A linha de bill_notifications de um alerta.
 *
 * Pura de proposito: e o pedaco que o teste pode afirmar sem banco, e e onde um
 * erro sairia caro -- `kind` fora do dominio do CHECK, ou `reference_date`
 * errado, viram aviso repetido ou aviso que nunca sai.
 *
 * `channel` nasce 'inapp' porque nesse instante o push ainda nao foi tentado. A
 * rota promove para 'push' depois de o envio dar certo; sem chave VAPID ou sem
 * aparelho inscrito, 'inapp' e a verdade -- e o sino funciona igual.
 */
export function linhaDeNotificacao(userId: string, alerta: AlertaDeRecorrencia) {
  return {
    user_id: userId,
    recurrence_id: alerta.recurrenceId,
    kind: alerta.kind,
    reference_date: alerta.referenceDate,
    title: alerta.title,
    body: alerta.body,
    channel: "inapp" as const,
  };
}

/**
 * Calcula os alertas de uma lista de recorrencias ja lida do banco.
 *
 * Uma consulta so para todas as recorrencias, e nao uma por linha: com 20
 * assinaturas o laco ingenuo faria 20 viagens ao banco a cada abertura da tela.
 */
export async function alertasDasRecorrencias(
  supabase: SupabaseClient,
  userId: string,
  recorrencias: RecorrenciaParaAlerta[]
): Promise<AlertaDeRecorrencia[]> {
  const candidatas = recorrencias.filter((r) => mereceAlerta(r.status));
  const todosIds = candidatas.flatMap((r) => r.transaction_ids || []);
  if (todosIds.length === 0) return [];

  const { data: transacoes } = await supabase
    .from("financial_transactions")
    .select("id, description, amount, transaction_date")
    .eq("user_id", userId)
    .in("id", todosIds)
    .order("transaction_date", { ascending: true });

  if (!transacoes) return [];

  const porId = new Map(transacoes.map((t) => [t.id, t]));
  const alertas: AlertaDeRecorrencia[] = [];

  const acrescentar = (r: RecorrenciaParaAlerta, alerta: Alerta | null) => {
    if (!alerta) return;
    alertas.push({
      ...alerta,
      recurrenceId: r.id,
      kind: KIND_DO_ALERTA[alerta.tipo],
      referenceDate: referenciaDoAlerta(alerta, r.last_charge_date),
      ...textoDoAlerta(alerta),
    });
  };

  for (const r of candidatas) {
    const doGrupo = (r.transaction_ids || [])
      .map((id) => porId.get(id))
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));

    if (doGrupo.length === 0) continue;

    acrescentar(
      r,
      alertaDeAumento(
        r.merchant_key,
        r.display_name,
        // `numeric` chega como STRING no supabase-js. Converter na fronteira,
        // pelo mesmo motivo documentado em recurrence-scan.ts: o detector
        // sobrevive a string por acidente, nao por contrato.
        doGrupo.map((t) => Number(t.amount))
      )
    );

    if (r.status === "CANCELLED" && r.status_changed_at) {
      acrescentar(
        r,
        alertaDeCobrancaAposCancelamento(
          r.merchant_key,
          r.display_name,
          r.status,
          r.status_changed_at.slice(0, 10),
          doGrupo.map((t) => ({
            id: t.id,
            description: t.description,
            amount: Number(t.amount),
            transaction_date: t.transaction_date,
          }))
        )
      );
    }
  }

  return alertas;
}

export interface AlertasDoUsuario {
  alertas: AlertaDeRecorrencia[];
  truncated: boolean;
}

/**
 * Le as recorrencias de um usuario e devolve os alertas dele.
 *
 * O caminho do cron e do sino, que nao tem a lista em maos. A tela usa
 * `alertasDasRecorrencias` direto, com a lista que ela ja leu para exibir --
 * ler duas vezes a mesma tabela no mesmo request nao acrescenta nada.
 *
 * `status <> 'IGNORED'` filtra no banco o que `mereceAlerta` filtraria em
 * memoria: e um indice a menos de linhas trafegadas, e o filtro em memoria
 * continua valendo como rede.
 */
export async function alertasDoUsuario(
  supabase: SupabaseClient,
  userId: string
): Promise<AlertasDoUsuario> {
  const { data, error } = await supabase
    .from("detected_recurrences")
    .select(COLUNAS_PARA_ALERTA)
    .eq("user_id", userId)
    .neq("status", "IGNORED")
    .limit(MAX_RECORRENCIAS);

  if (error) {
    throw new Error(`Erro ao ler recorrencias: ${error.message}`);
  }

  const lista = (data || []) as unknown as RecorrenciaParaAlerta[];

  return {
    alertas: await alertasDasRecorrencias(supabase, userId, lista),
    truncated: lista.length >= MAX_RECORRENCIAS,
  };
}
