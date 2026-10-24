/**
 * LER A FATURA PAGA -- a leitura de banco da fase 6, num lugar so (RN017.4).
 *
 * Quatro leitores somam o Resultado em TypeScript e precisam das mesmas linhas:
 * a aba Despesas (`/api/movimentacoes/resumo`), o modo intervalo do fluxo de
 * caixa e do relatorio por categoria, e Financas Pessoais. A conta mora em
 * lib/fatura-paga-no-resultado.ts, pura; aqui fica so a consulta.
 *
 * O RECORTE E PELO VENCIMENTO (`due_date`), e nao pelo dia do pagamento: e por
 * ele que a fatura entra no mes (RN017.4).
 *
 * A forma do retorno e a de `lerJurosPagosDoMyBank` e de
 * `lerContasDoFechamentoRealizadas`: erro de verdade volta como erro, para a
 * rota responder 500 em vez de um Resultado sem o cartao e sem aviso, e a view
 * que ainda nao existe (a 072 e colada a mao) e lista vazia.
 *
 * PAGINADA, porque uma fatura e uma linha por compra: um ano de cartao passa
 * facil das 1000 linhas que o PostgREST devolve por ida.
 *
 * O `user_id` E OBRIGATORIO. A view le `financial_transactions` com a RLS de
 * grupo, e quem le e quem separa a fatura dele da dos outros.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { viewDaParteAusente } from "@/lib/parte-do-grupo-realizada";
import {
  COLUNAS_DA_FATURA_PAGA,
  VIEW_DA_FATURA_PAGA,
  type LinhaDaFaturaPaga,
} from "@/lib/fatura-paga-no-resultado";

/** Quantas linhas por ida ao banco. */
const TAMANHO_DA_PAGINA = 1000;

export type LeituraDaFaturaPaga =
  | { ok: true; linhas: LinhaDaFaturaPaga[] }
  | { ok: false; erro: unknown };

/** As linhas das faturas pagas que vencem em [de, ate]. */
export async function lerFaturasPagas(
  supabase: SupabaseClient,
  meuUserId: string,
  de: string,
  ate: string
): Promise<LeituraDaFaturaPaga> {
  const linhas: LinhaDaFaturaPaga[] = [];

  for (let inicio = 0; ; inicio += TAMANHO_DA_PAGINA) {
    const { data, error } = await supabase
      .from(VIEW_DA_FATURA_PAGA)
      .select(COLUNAS_DA_FATURA_PAGA)
      .eq("user_id", meuUserId)
      .gte("due_date", de)
      .lte("due_date", ate)
      // Ordem estavel: sem ela, duas paginas podem repetir e pular linhas.
      .order("id", { ascending: true })
      .range(inicio, inicio + TAMANHO_DA_PAGINA - 1);

    if (error && viewDaParteAusente(error)) return { ok: true, linhas: [] };
    if (error) return { ok: false, erro: error };

    const lote = (data ?? []) as unknown as LinhaDaFaturaPaga[];
    for (const linha of lote) linhas.push(linha);
    if (lote.length < TAMANHO_DA_PAGINA) break;
  }

  return { ok: true, linhas };
}
