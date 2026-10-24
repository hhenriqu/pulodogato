/**
 * A DESPESA DE GRUPO NA ABA DESPESAS, NUMA LINHA SO: as leituras (24/10/2026).
 *
 * A forma das linhas e a aritmetica do detalhe estao em lib/despesas-do-grupo.ts.
 * Este arquivo le o que falta para a tela desenhar a linha do grupo:
 *
 *   * a conta do fechamento EM ABERTO ("Pagamento ao grupo X") do periodo, com
 *     o que fechou nela (`group_closings.members` e `group_closing_items`) e
 *     os Pix que a quitam (`contas_em_aberto_do_grupo`, 068, e `paresDoAcerto`
 *     -- a mesma sugestao da tela do grupo, RN019.5);
 *   * os nomes de quem lancou cada despesa e de quem recebe cada Pix;
 *   * a chave Pix de quem recebe, para o botao de copia e cola. Quem decide o
 *     que volta e a RLS de `user_pix_keys` (032): o dono e quem divide um grupo
 *     ATIVO com ele -- a mesma leitura da tela do grupo (PixDoMembro.tsx).
 *
 * O ERRO VOLTA COMO VALOR, NAO COMO EXCECAO, pela razao de
 * `lerEstimativasDoFechamento`: a linha do grupo e apresentacao. Sem ela a aba
 * mostra as linhas soltas, como antes, e nenhum numero muda.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { paresDoAcerto, type ContaEmAberto } from "@/lib/acerto-do-fechamento";
import { tabelaDePixAusente, type TipoDeChavePix } from "@/lib/chave-pix";
import {
  detalheDoPeriodo,
  transferenciasDoMembro,
  type GrupoNaLista,
} from "@/lib/despesas-do-grupo";
import type { ItemDoFechamento, PosicaoNoPeriodo } from "@/lib/fechamento-por-periodo";

/** A chave Pix de quem recebe, como a tela a copia (crua). */
export interface ChavePixDaLista {
  chave: string;
  tipo: TipoDeChavePix;
}

export type LeituraDosGruposNaLista =
  | { ok: true; grupos: GrupoNaLista[] }
  | { ok: false; mensagem: string };

interface ContaDoFechamentoEmAberto {
  id: string;
  group_closing_id: string;
  transaction_type: string | null;
}

interface FechamentoGravado {
  id: string;
  group_id: string;
  period_end: string;
  members: PosicaoNoPeriodo[] | null;
}

/**
 * As contas do fechamento EM ABERTO do usuario, com vencimento no periodo e do
 * lado da tela, como linha de grupo: o detalhe do que fechou e, em Despesas,
 * os Pix que a quitam.
 *
 * A conta e lida da TABELA, e nao da view da agenda: a view nao traz
 * `group_closing_id` (ver app/api/scheduled-transactions/[id]/vincular). O id
 * que volta e o da linha da lista, que e o id da conta.
 */
export async function lerContasDoFechamentoEmAberto(
  supabase: SupabaseClient,
  userId: string,
  tipo: "expense" | "income",
  periodo: { de: string; ate: string }
): Promise<LeituraDosGruposNaLista> {
  try {
    const { data: contasCruas, error: erroContas } = await supabase
      .from("scheduled_transactions")
      .select("id, group_closing_id, transaction_type")
      .eq("user_id", userId)
      .not("group_closing_id", "is", null)
      .eq("status", "pending")
      .gte("due_date", periodo.de)
      .lte("due_date", periodo.ate);
    if (erroContas) throw new Error(`scheduled_transactions: ${erroContas.message}`);

    const contas = ((contasCruas ?? []) as ContaDoFechamentoEmAberto[]).filter(
      (c) => c.group_closing_id && c.transaction_type === tipo
    );
    if (contas.length === 0) return { ok: true, grupos: [] };

    const idsDosFechamentos = Array.from(new Set(contas.map((c) => c.group_closing_id)));

    const [fechamentos, itens] = await Promise.all([
      supabase
        .from("group_closings")
        .select("id, group_id, period_end, members")
        .in("id", idsDosFechamentos),
      supabase
        .from("group_closing_items")
        .select("closing_id, kind, transaction_id, from_user_id, amount, item_date, description")
        .in("closing_id", idsDosFechamentos),
    ]);
    if (fechamentos.error) throw new Error(`group_closings: ${fechamentos.error.message}`);
    if (itens.error) throw new Error(`group_closing_items: ${itens.error.message}`);

    const fechamentoPorId = new Map(
      ((fechamentos.data ?? []) as FechamentoGravado[]).map((f) => [f.id, f])
    );
    const itensPorFechamento = new Map<string, ItemDoFechamento[]>();
    for (const i of (itens.data ?? []) as (ItemDoFechamento & { closing_id: string })[]) {
      const lista = itensPorFechamento.get(i.closing_id) ?? [];
      lista.push({ ...i, amount: Number(i.amount) || 0 });
      itensPorFechamento.set(i.closing_id, lista);
    }

    // OS PIX QUE QUITAM, por grupo: o que esta em aberto e do GRUPO inteiro, e
    // o par sai das contas de todos (RN019.5). So em Despesas: quem recebe nao
    // tem transferencia a fazer.
    const paresPorGrupo = new Map<string, ReturnType<typeof paresDoAcerto>>();
    if (tipo === "expense") {
      const grupos = Array.from(
        new Set(
          contas
            .map((c) => fechamentoPorId.get(c.group_closing_id)?.group_id)
            .filter((id): id is string => Boolean(id))
        )
      );
      for (const groupId of grupos) {
        const { data, error } = await supabase.rpc("contas_em_aberto_do_grupo", {
          p_group_id: groupId,
        });
        if (error) throw new Error(`contas_em_aberto_do_grupo: ${error.message}`);
        paresPorGrupo.set(groupId, paresDoAcerto((data ?? []) as ContaEmAberto[]));
      }
    }

    const grupos: GrupoNaLista[] = [];
    for (const conta of contas) {
      const fechamento = fechamentoPorId.get(conta.group_closing_id);
      if (!fechamento) continue;
      const { itens: doDetalhe, abatimentos } = detalheDoPeriodo(
        {
          membros: (fechamento.members ?? []).map((m) => ({
            ...m,
            pago: Number(m.pago) || 0,
            acertos: Number(m.acertos) || 0,
            responsabilidade: Number(m.responsabilidade) || 0,
          })),
          itens: itensPorFechamento.get(fechamento.id) ?? [],
        },
        userId
      );
      grupos.push({
        chave: `fechamento:${conta.id}`,
        tipo: "conta_do_fechamento",
        group_id: fechamento.group_id,
        nome: null,
        direcao: tipo,
        linhas: [conta.id],
        fechamento: fechamento.period_end,
        itens: doDetalhe,
        abatimentos,
        transferencias: transferenciasDoMembro(
          paresPorGrupo.get(fechamento.group_id) ?? [],
          userId,
          new Map()
        ),
      });
    }

    return { ok: true, grupos };
  } catch (erro) {
    return { ok: false, mensagem: erro instanceof Error ? erro.message : String(erro) };
  }
}

/**
 * Os nomes de pessoas e de grupos que as linhas de grupo citam.
 *
 * Nome em branco nao entra no mapa, pelo criterio de `rotuloDoDestino`
 * (lib/pra-quem-pagar.ts): o perfil legivel e sem nome cai no mesmo caminho
 * do invisivel, e a tela escreve o rotulo de fallback.
 */
export async function lerNomesDasLinhasDeGrupo(
  supabase: SupabaseClient,
  pessoas: readonly string[],
  grupos: readonly string[]
): Promise<{ nomes: Map<string, string>; nomesDosGrupos: Map<string, string> }> {
  const [perfis, doGrupo] = await Promise.all([
    pessoas.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", [...pessoas])
      : Promise.resolve({ data: [], error: null }),
    grupos.length > 0
      ? supabase.from("expense_groups").select("id, name").in("id", [...grupos])
      : Promise.resolve({ data: [], error: null }),
  ]);

  const nomes = new Map<string, string>();
  for (const p of (perfis.data ?? []) as { id?: string | null; full_name?: string | null }[]) {
    const nome = (p?.full_name ?? "").trim();
    if (p?.id && nome) nomes.set(p.id, nome);
  }
  const nomesDosGrupos = new Map<string, string>();
  for (const g of (doGrupo.data ?? []) as { id?: string | null; name?: string | null }[]) {
    const nome = (g?.name ?? "").trim();
    if (g?.id && nome) nomesDosGrupos.set(g.id, nome);
  }
  return { nomes, nomesDosGrupos };
}

/**
 * As chaves Pix das pessoas, para o copia e cola. Quem a RLS nao libera, ou
 * quem nao cadastrou, simplesmente nao vem -- e a tela diz "nao cadastrou
 * chave Pix". A 032 ainda nao colada e o mesmo estado, e nao erro.
 */
export async function lerChavesPix(
  supabase: SupabaseClient,
  pessoas: readonly string[]
): Promise<Record<string, ChavePixDaLista>> {
  if (pessoas.length === 0) return {};
  const { data, error } = await supabase
    .from("user_pix_keys")
    .select("user_id, pix_key, pix_key_type")
    .in("user_id", [...pessoas]);
  if (error) {
    if (!tabelaDePixAusente(error)) {
      console.error("A tela de movimentação seguiu sem as chaves Pix:", error);
    }
    return {};
  }
  const chaves: Record<string, ChavePixDaLista> = {};
  for (const l of (data ?? []) as { user_id?: string; pix_key?: string; pix_key_type?: string }[]) {
    if (l.user_id && l.pix_key && l.pix_key_type) {
      chaves[l.user_id] = { chave: l.pix_key, tipo: l.pix_key_type as TipoDeChavePix };
    }
  }
  return chaves;
}
