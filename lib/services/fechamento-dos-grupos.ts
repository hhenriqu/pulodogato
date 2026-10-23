/**
 * O FECHAMENTO DO GRUPO POR PERIODO: a metade que le e grava (RN018, fase 2).
 *
 * A aritmetica e de lib/fechamento-por-periodo.ts, sem I/O. Este arquivo faz as
 * consultas, traduz as linhas e chama `registrar_fechamento_do_grupo` (067).
 *
 * Dois chamadores, com dois clientes:
 *
 *   * a rota GET .../fechamento-do-periodo, com o cliente do usuario: a previa
 *     do periodo aberto, pela RLS de membro;
 *   * o cron app/api/cron/group-closings, com a service_role: o fechamento de
 *     verdade, de todos os grupos que fecham hoje.
 *
 * A LEITURA E A MESMA NOS DOIS, DE PROPOSITO
 * ------------------------------------------
 * A previa que o membro ve e o fechamento que o cron grava tem de ser a mesma
 * conta. Uma funcao so le "o que ainda nao fechou" para os dois; se cada
 * chamador tivesse a sua, a tela mostraria R$ 100 e o fechamento geraria
 * R$ 120 no primeiro filtro que divergisse.
 *
 * DUAS CONSULTAS EM VEZ DE UM EMBED
 * ---------------------------------
 * Igual a rota do fechamento mensal: `financial_transactions` tem `group_id` E e
 * alvo de `group_transactions.transaction_id`, e embed com dois caminhos
 * responde PGRST201. Ler os ids primeiro nao tem ambiguidade.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { valorDoFechamento } from "@/lib/fechamento-do-grupo";
import { divisaoDoPeriodo, type DivisaoDoPeriodo } from "@/lib/divisao-configurada";
import {
  fecharPeriodo,
  periodoParaFechar,
  type AcertoDoPeriodo,
  type DespesaDoPeriodo,
  type FechamentoDoPeriodo,
  type MembroDoPeriodo,
  type Periodo,
} from "@/lib/fechamento-por-periodo";

/** O que ainda nao entrou em fechamento nenhum. */
export interface OQueNaoFechou {
  despesas: DespesaDoPeriodo[];
  acertos: AcertoDoPeriodo[];
}

/**
 * As despesas realizadas e os acertos do grupo que ainda nao entraram em
 * fechamento nenhum.
 *
 * "Nao entrou" e lido de `group_closing_items`, e nao de uma data: a despesa de
 * data antiga lancada depois do fechamento dela tem de entrar no proximo
 * (RN018.3), e so a marca de "ja fechada" sabe isso.
 */
export async function lerOQueNaoFechou(
  client: SupabaseClient,
  groupId: string
): Promise<OQueNaoFechou> {
  const { data: fechados, error: erroFechados } = await client
    .from("group_closing_items")
    .select("transaction_id, settlement_id")
    .eq("group_id", groupId);
  if (erroFechados) throw new Error(`group_closing_items: ${erroFechados.message}`);

  const despesaFechada = new Set<string>();
  const acertoFechado = new Set<string>();
  for (const f of fechados ?? []) {
    if (f.transaction_id) despesaFechada.add(f.transaction_id);
    if (f.settlement_id) acertoFechado.add(f.settlement_id);
  }

  const { data: vinculos, error: erroVinculos } = await client
    .from("group_transactions")
    .select("transaction_id")
    .eq("group_id", groupId);
  if (erroVinculos) throw new Error(`group_transactions: ${erroVinculos.message}`);

  const ids = Array.from(
    new Set(
      (vinculos ?? [])
        .map((v) => v.transaction_id as string | null)
        .filter((id): id is string => Boolean(id) && !despesaFechada.has(id as string))
    )
  );

  const { data: transacoes, error: erroTransacoes } = ids.length
    ? await client
        .from("financial_transactions")
        .select("id, description, amount, exchange_rate, transaction_date, user_id, transaction_type")
        .in("id", ids)
    : { data: [], error: null };
  if (erroTransacoes) throw new Error(`financial_transactions: ${erroTransacoes.message}`);

  const despesas: DespesaDoPeriodo[] = (transacoes ?? [])
    // `transaction_type` NULL e comum em linha antiga; o sinal ainda diz a
    // direcao, como em `linhaDoRealizado`. Receita e transferencia de grupo nao
    // sao conta do grupo.
    .filter(
      (t) =>
        (t.transaction_type ?? ((Number(t.amount) || 0) < 0 ? "expense" : "income")) ===
        "expense"
    )
    .map((t) => ({
      transaction_id: t.id,
      pagador_user_id: t.user_id,
      valor: valorDoFechamento(t.amount, t.exchange_rate),
      data: t.transaction_date,
      descricao: t.description ?? null,
    }));

  const { data: liquidacoes, error: erroLiquidacoes } = await client
    .from("group_settlements")
    .select("id, from_user_id, to_user_id, amount, exchange_rate, settled_on")
    .eq("group_id", groupId);
  if (erroLiquidacoes) throw new Error(`group_settlements: ${erroLiquidacoes.message}`);

  const acertos: AcertoDoPeriodo[] = (liquidacoes ?? [])
    .filter((s) => !acertoFechado.has(s.id))
    .map((s) => ({
      settlement_id: s.id,
      de_user_id: s.from_user_id,
      para_user_id: s.to_user_id,
      valor: valorDoFechamento(s.amount, s.exchange_rate),
      data: s.settled_on,
    }));

  return { despesas, acertos };
}

/**
 * Os membros ATIVOS, na ordem estavel, com o peso que a configuracao do grupo
 * da a cada um. A mesma ordem e o mesmo `divisaoDoPeriodo` da rota do
 * fechamento mensal: o centavo que sobra na divisao igual vai para o mesmo
 * membro nas duas telas.
 */
export async function lerMembrosComPeso(
  client: SupabaseClient,
  groupId: string
): Promise<{ membros: MembroDoPeriodo[]; divisao: DivisaoDoPeriodo }> {
  const { data: membrosCrus, error: erroMembros } = await client
    .from("group_members")
    .select("user_id, joined_at, percentage")
    .eq("group_id", groupId)
    .eq("status", "active")
    .order("joined_at", { ascending: true })
    .order("user_id", { ascending: true });
  if (erroMembros) throw new Error(`group_members: ${erroMembros.message}`);

  const ativos = (membrosCrus ?? []).filter((m) => m.user_id);

  const { data: grupo } = await client
    .from("expense_groups")
    .select("default_split_type")
    .eq("id", groupId)
    .maybeSingle();

  const divisao = divisaoDoPeriodo(grupo?.default_split_type, ativos);
  return {
    membros: ativos.map((m, i) => ({
      user_id: m.user_id,
      peso: divisao.pesos[i].peso,
    })),
    divisao,
  };
}

/** O `period_end` do fechamento mais recente do grupo, ou `null`. */
export async function ultimoFimFechado(
  client: SupabaseClient,
  groupId: string
): Promise<string | null> {
  const { data, error } = await client
    .from("group_closings")
    .select("period_end")
    .eq("group_id", groupId)
    .order("period_end", { ascending: false })
    .limit(1);
  if (error) throw new Error(`group_closings: ${error.message}`);
  return (data?.[0]?.period_end as string | undefined) ?? null;
}

/** A conta do periodo que termina em `fim`, sobre o que ainda nao fechou. */
export async function calcularPeriodo(
  client: SupabaseClient,
  groupId: string,
  fim: string
): Promise<FechamentoDoPeriodo> {
  const [{ despesas, acertos }, { membros }] = await Promise.all([
    lerOQueNaoFechou(client, groupId),
    lerMembrosComPeso(client, groupId),
  ]);
  return fecharPeriodo({ despesas, acertos, membros, fim });
}

/** O que aconteceu com um grupo numa execucao do cron. */
export type DesfechoDoGrupo =
  | { group_id: string; desfecho: "fora_do_dia" }
  | { group_id: string; desfecho: "fechado"; periodo: Periodo; contas: number; closing_id: string }
  | { group_id: string; desfecho: "ja_fechado"; periodo: Periodo }
  | { group_id: string; desfecho: "sem_membro_ativo"; periodo: Periodo };

/**
 * Fecha o grupo se hoje e dia de fechar.
 *
 * `admin` tem de ser o cliente da service_role: so ele executa
 * `registrar_fechamento_do_grupo`, e so ele le as despesas de TODOS os membros
 * sem depender de quem esta logado. Erro de leitura ou de gravacao sobe como
 * excecao, e o cron registra a falha deste grupo e segue para o proximo.
 */
export async function fecharOGrupo(
  admin: SupabaseClient,
  grupo: { id: string; closing_day: unknown },
  hoje: string
): Promise<DesfechoDoGrupo> {
  const fimAnterior = await ultimoFimFechado(admin, grupo.id);
  const periodo = periodoParaFechar(grupo.closing_day, hoje, fimAnterior);
  if (!periodo) return { group_id: grupo.id, desfecho: "fora_do_dia" };

  const fechamento = await calcularPeriodo(admin, grupo.id, periodo.fim);
  if (!fechamento.fecha) {
    return { group_id: grupo.id, desfecho: "sem_membro_ativo", periodo };
  }

  const { data, error } = await admin.rpc("registrar_fechamento_do_grupo", {
    p_group_id: grupo.id,
    p_period_start: periodo.inicio,
    p_period_end: periodo.fim,
    p_fechamento: {
      total: fechamento.total,
      membros: fechamento.membros,
      itens: fechamento.itens,
      contas: fechamento.contas,
    },
  });
  if (error) throw new Error(`registrar_fechamento_do_grupo: ${error.message}`);

  // NULL e o periodo que outra execucao fechou primeiro: a UNIQUE da 067.
  if (!data) return { group_id: grupo.id, desfecho: "ja_fechado", periodo };

  return {
    group_id: grupo.id,
    desfecho: "fechado",
    periodo,
    contas: fechamento.contas.length,
    closing_id: data as string,
  };
}
