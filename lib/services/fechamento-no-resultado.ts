/**
 * O FECHAMENTO DO GRUPO NO RESULTADO: as duas leituras (RN016 a RN018, fase 4).
 *
 *   * `lerContasDoFechamentoRealizadas` -- a conta do fechamento ja quitada,
 *     o lado realizado dela (`group_closing_entries`, 069);
 *   * `lerEstimativasDoFechamento` -- a estimativa do periodo aberto;
 *   * `lerGruposQueFecham` -- quais dos grupos de uma leitura tem dia de
 *     fechamento, para a conta prevista deles sair da regra do pagador.
 *
 * A aritmetica e a traducao de formato estao em lib/fechamento-no-resultado.ts.
 *
 * A ESTIMATIVA DO PERIODO ABERTO DE TODOS OS MEUS GRUPOS QUE FECHAM (RN018.7)
 * -------------------------------------------------------------------------
 *
 * "Antes do fechamento, o saldo estimado do membro no periodo aparece como
 * previsto no painel, a pagar ou a receber, sem gerar conta" (decisao D2).
 *
 * A CONTA E A DA PREVIA DA TELA DO GRUPO, E A DO CRON
 * ---------------------------------------------------
 * `calcularPeriodo` (lib/services/fechamento-dos-grupos.ts) e o que a rota
 * GET .../fechamento-do-periodo mostra como previa e o que o cron grava no
 * dia. A estimativa e a mesma chamada, com o mesmo cliente do usuario e a
 * mesma RLS de membro: o painel nao pode prometer R$ 100 e o fechamento gerar
 * R$ 120.
 *
 * O vencimento e o fim do periodo aberto -- o dia em que o fechamento vai
 * gerar a conta (decisao D3). Entao a estimativa cai no mes do PROXIMO
 * fechamento, como a conta cairia.
 *
 * O ERRO VOLTA COMO VALOR, NAO COMO EXCECAO
 * ----------------------------------------
 * Pela mesma razao de `lerCreditoDosGrupos`: as chamadoras existem para
 * responder outros numeros (a previsao do painel, a tela de Receitas e
 * Despesas), e trocar todos eles por um 500 por causa da estimativa seria o
 * pior dos dois. Elas seguem sem ela e registram o motivo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  diaDeFechamento,
  periodoQueTerminaEm,
  proximoFechamento,
} from "@/lib/fechamento-por-periodo";
import { addDays } from "@/lib/recurrence-detector";
import {
  COLUNAS_DA_CONTA_DO_FECHAMENTO,
  estimativaDoMembro,
  VIEW_DA_CONTA_DO_FECHAMENTO,
  type ContaDoFechamentoCrua,
  type EstimativaDoGrupo,
} from "@/lib/fechamento-no-resultado";
import { viewDaParteAusente } from "@/lib/parte-do-grupo-realizada";
import {
  calcularPeriodo,
  ultimoFimFechado,
} from "@/lib/services/fechamento-dos-grupos";

export type LeituraDaEstimativa =
  | { ok: true; estimativas: EstimativaDoGrupo[] }
  | { ok: false; mensagem: string };

/**
 * As estimativas do usuario, uma por grupo que fecha em que ele tem saldo.
 *
 * So grupo ATIVO (nao arquivado) e participacao ATIVA: o arquivado nao fecha
 * mais, e quem saiu nao responde pelo periodo (RN018.4 reparte entre os
 * membros ativos).
 */
export async function lerEstimativasDoFechamento(
  supabase: SupabaseClient,
  userId: string,
  hoje: string
): Promise<LeituraDaEstimativa> {
  try {
    const { data: minhas, error: erroMinhas } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", userId)
      .eq("status", "active");
    if (erroMinhas) throw new Error(`group_members: ${erroMinhas.message}`);

    const meusIds = Array.from(
      new Set((minhas ?? []).map((m) => m.group_id).filter(Boolean))
    ) as string[];
    if (meusIds.length === 0) return { ok: true, estimativas: [] };

    const { data: grupos, error: erroGrupos } = await supabase
      .from("expense_groups")
      .select("id, name, closing_day")
      .in("id", meusIds)
      .eq("is_active", true)
      .not("closing_day", "is", null);
    if (erroGrupos) throw new Error(`expense_groups: ${erroGrupos.message}`);

    const estimativas: EstimativaDoGrupo[] = [];

    for (const grupo of grupos ?? []) {
      const dia = diaDeFechamento(grupo.closing_day);
      if (dia === null) continue;

      // O periodo aberto. Se o cron ja fechou o periodo que termina hoje, o
      // aberto e o seguinte -- sem isto a estimativa do dia do fechamento
      // seria de um periodo vazio, que ja virou conta.
      const fimAnterior = await ultimoFimFechado(supabase, grupo.id);
      let fim = proximoFechamento(dia, hoje);
      if (fimAnterior && fimAnterior >= fim) {
        fim = proximoFechamento(dia, addDays(fimAnterior, 1));
      }
      const periodo = periodoQueTerminaEm(fim, fimAnterior);

      const fechamento = await calcularPeriodo(supabase, grupo.id, periodo.fim);
      const minha = estimativaDoMembro(fechamento, userId);
      if (!minha) continue;

      estimativas.push({
        ...minha,
        group_id: grupo.id,
        nome: grupo.name ?? "",
        vencimento: periodo.fim,
      });
    }

    return { ok: true, estimativas };
  } catch (erro) {
    return {
      ok: false,
      mensagem: erro instanceof Error ? erro.message : String(erro),
    };
  }
}

export type LeituraDasContasDoFechamento =
  | { ok: true; contas: ContaDoFechamentoCrua[] }
  | { ok: false; erro: unknown };

/**
 * As contas do fechamento quitadas do usuario, com vencimento no intervalo.
 *
 * Uma consulta so, sem paginar: e uma conta por grupo por fechamento, e um
 * intervalo de um ano tem doze por grupo -- longe do teto do PostgREST.
 *
 * `user_id` filtrado na mao mesmo com a RLS ja entregando so as do usuario:
 * e a mesma convencao de `group_share_entries`, e o filtro nao custa nada.
 *
 * A JANELA ENTRE O DEPLOY E A COLAGEM DA 069: a view nao existe e a leitura
 * segue sem as contas (`viewDaParteAusente`), que e o comportamento de antes.
 * Erro de verdade volta como erro, para a rota responder 500 em vez de um
 * relatorio menor sem aviso.
 */
export async function lerContasDoFechamentoRealizadas(
  supabase: SupabaseClient,
  userId: string,
  de: string,
  ate: string
): Promise<LeituraDasContasDoFechamento> {
  const { data, error } = await supabase
    .from(VIEW_DA_CONTA_DO_FECHAMENTO)
    .select(COLUNAS_DA_CONTA_DO_FECHAMENTO)
    .eq("user_id", userId)
    .gte("transaction_date", de)
    .lte("transaction_date", ate)
    .order("transaction_date", { ascending: true })
    .order("id", { ascending: true });

  if (error && viewDaParteAusente(error)) return { ok: true, contas: [] };
  if (error) return { ok: false, erro: error };
  return { ok: true, contas: (data ?? []) as unknown as ContaDoFechamentoCrua[] };
}

export type LeituraDosGruposQueFecham =
  | { ok: true; ids: Set<string> }
  | { ok: false; mensagem: string };

/**
 * Quais dos grupos pedidos tem dia de fechamento.
 *
 * Grupo arquivado conta: a 069 decide por `closing_day` e nada mais, e a tela
 * nao pode dividir a conta de um jeito que o banco nao divide.
 *
 * O FILTRO E EM JAVASCRIPT, e nao um `.not("closing_day", "is", null)`, para a
 * resposta ser a mesma com ou sem a coluna no objeto que volta: um grupo sem a
 * chave e um grupo que nao fecha.
 */
export async function lerGruposQueFecham(
  supabase: SupabaseClient,
  groupIds: readonly string[]
): Promise<LeituraDosGruposQueFecham> {
  if (groupIds.length === 0) return { ok: true, ids: new Set() };

  const { data, error } = await supabase
    .from("expense_groups")
    .select("id, closing_day")
    .in("id", [...groupIds]);

  if (error) return { ok: false, mensagem: error.message };

  const ids = new Set<string>();
  for (const g of (data ?? []) as { id: string; closing_day?: number | null }[]) {
    if (g.closing_day !== null && g.closing_day !== undefined) ids.add(g.id);
  }
  return { ok: true, ids };
}
