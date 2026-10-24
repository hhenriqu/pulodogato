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
 * dia. A estimativa le pelas mesmas duas funcoes (`lerOQueNaoFechou`,
 * `lerMembrosComPeso`) e faz a mesma conta (`fecharPeriodo`), com o mesmo
 * cliente do usuario e a mesma RLS de membro: o painel nao pode prometer
 * R$ 100 e o fechamento gerar R$ 120 sobre o mesmo dinheiro. O que ela soma a
 * mais e a conta prevista ainda nao paga -- ver abaixo.
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
 *
 * COM AS CONTAS PREVISTAS DO GRUPO (24/10/2026)
 * ---------------------------------------------
 * "O lancamento no grupo de outubro deveria fechar dia 01 e aparecer pras
 * pessoas em novembro apenas. Pode aparecer, mas como previsto." A conta que
 * outro membro lancou no grupo que fecha saiu da aba Despesas do mes em que
 * vence (`previstasNoGrupoQueFecha`), e e AQUI que ela volta: a conta prevista
 * em aberto entra na estimativa como se ja estivesse paga por quem a lancou,
 * no vencimento dela. Sem isso a Leticia nao veria nada do aluguel do grupo
 * ate o Helio dar baixa nele.
 *
 * A previa da tela do grupo e o cron continuam so com o realizado: o
 * fechamento leva o que foi pago. A diferenca entre os dois numeros e
 * exatamente a conta prevista que ainda nao foi paga, e o detalhe da linha a
 * marca como "prevista". Se ela nao for paga ate o fechamento, ela fica para o
 * proximo -- e a estimativa seguinte a mostra.
 *
 * UM PERIODO POR FECHAMENTO, ATE O FIM DA TELA
 * -------------------------------------------
 * Com `ate`, a leitura segue alem do periodo aberto: os periodos seguintes so
 * tem conta prevista (o realizado e de hoje para tras), e cada um vira a
 * estimativa do fechamento dele. Sem isso a aba Despesas de dezembro nao
 * mostraria nada do grupo, quando antes mostrava a minha parte de cada conta.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  diaDeFechamento,
  fecharPeriodo,
  periodoQueTerminaEm,
  proximoFechamento,
  type DespesaDoPeriodo,
} from "@/lib/fechamento-por-periodo";
import { addDays } from "@/lib/recurrence-detector";
import {
  COLUNAS_DA_CONTA_DO_FECHAMENTO,
  estimativaDoMembro,
  VIEW_DA_CONTA_DO_FECHAMENTO,
  type ContaDoFechamentoCrua,
  type EstimativaDoGrupo,
} from "@/lib/fechamento-no-resultado";
import {
  detalheDoPeriodo,
  PREFIXO_DA_PREVISTA_NA_ESTIMATIVA,
} from "@/lib/despesas-do-grupo";
import { viewDaParteAusente } from "@/lib/parte-do-grupo-realizada";
import {
  lerMembrosComPeso,
  lerOQueNaoFechou,
  ultimoFimFechado,
} from "@/lib/services/fechamento-dos-grupos";

export type LeituraDaEstimativa =
  | { ok: true; estimativas: EstimativaDoGrupo[] }
  | { ok: false; mensagem: string };

/**
 * Quantos periodos uma leitura atravessa, no maximo. A tela pede um mes e o
 * painel de previsao alguns; o teto so existe para um `ate` absurdo nao virar
 * um laco de anos.
 */
export const MAXIMO_DE_PERIODOS_DA_ESTIMATIVA = 24;

/** Uma conta prevista do grupo, como a estimativa a le. */
interface PrevistaDoGrupoCrua {
  id: string;
  user_id: string | null;
  description: string | null;
  amount: number | string | null;
  due_date: string | null;
  direction: string | null;
}

/**
 * As contas previstas EM ABERTO do grupo, com vencimento ate `ate`, como
 * despesa do periodo: o pagador e quem a lancou, a data e o vencimento.
 *
 * `status = 'pending'` e o status do DONO, e e ele que importa: no grupo que
 * fecha nao ha baixa por membro (069), e a conta que o dono pagou ja virou
 * despesa realizada em `lerOQueNaoFechou`. Contar as duas seria o aluguel em
 * dobro.
 *
 * So despesa: receita prevista de grupo nao e conta do grupo, pela mesma regra
 * de `lerOQueNaoFechou`.
 */
async function lerPrevistasDoGrupo(
  supabase: SupabaseClient,
  groupId: string,
  ate: string
): Promise<DespesaDoPeriodo[]> {
  const { data, error } = await supabase
    .from("scheduled_transactions_effective")
    .select("id, user_id, description, amount, due_date, direction")
    .eq("group_id", groupId)
    .eq("status", "pending")
    .lte("due_date", ate);
  if (error) throw new Error(`scheduled_transactions_effective: ${error.message}`);

  return ((data ?? []) as PrevistaDoGrupoCrua[])
    .filter((p) => p.direction === "expense" && p.user_id && p.due_date)
    .map((p) => ({
      transaction_id: `${PREFIXO_DA_PREVISTA_NA_ESTIMATIVA}${p.id}`,
      pagador_user_id: p.user_id as string,
      // `scheduled_transactions.amount` e positivo por CHECK; o `abs` e o mesmo
      // de `valorDoFechamento`, para nenhuma linha antiga inverter o sinal.
      valor: Math.round(Math.abs(Number(p.amount) || 0) * 100) / 100,
      data: p.due_date as string,
      descricao: p.description ?? null,
    }));
}

/**
 * As estimativas do usuario, uma por grupo que fecha e por fechamento em que
 * ele tem saldo.
 *
 * So grupo ATIVO (nao arquivado) e participacao ATIVA: o arquivado nao fecha
 * mais, e quem saiu nao responde pelo periodo (RN018.4 reparte entre os
 * membros ativos).
 *
 * Sem `ate`, so o periodo aberto, como antes. Com `ate`, todo fechamento ate
 * aquele dia -- o primeiro e sempre o aberto, que leva tudo o que ainda nao
 * fechou, de qualquer data (RN018.3); os seguintes levam so o que vence dentro
 * deles.
 */
export async function lerEstimativasDoFechamento(
  supabase: SupabaseClient,
  userId: string,
  hoje: string,
  ate?: string
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

      // Os fechamentos que a leitura cobre: o aberto, e os seguintes ate `ate`.
      const fins: string[] = [periodo.fim];
      while (ate && fins.length < MAXIMO_DE_PERIODOS_DA_ESTIMATIVA) {
        const seguinte = proximoFechamento(dia, addDays(fins[fins.length - 1], 1));
        if (seguinte > ate) break;
        fins.push(seguinte);
      }

      const [{ despesas, acertos }, { membros }, previstas] = await Promise.all([
        lerOQueNaoFechou(supabase, grupo.id),
        lerMembrosComPeso(supabase, grupo.id),
        lerPrevistasDoGrupo(supabase, grupo.id, fins[fins.length - 1]),
      ]);
      const todas = [...despesas, ...previstas];

      fins.forEach((fimDoPeriodo, k) => {
        const desde = k === 0 ? null : fins[k - 1];
        const fechamento = fecharPeriodo({
          despesas: desde === null ? todas : todas.filter((d) => d.data > desde),
          // O acerto antigo e de hoje para tras: ele so pesa no periodo aberto.
          acertos: k === 0 ? acertos : [],
          membros,
          fim: fimDoPeriodo,
        });
        const minha = estimativaDoMembro(fechamento, userId);
        if (!minha) return;

        estimativas.push({
          ...minha,
          group_id: grupo.id,
          nome: grupo.name ?? "",
          vencimento: fimDoPeriodo,
          detalhe: detalheDoPeriodo(fechamento, userId),
        });
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
