// =====================================================
// GRUPO DE DESPESA - a travessa que impede sair devendo
// =====================================================
// Existe uma pergunta que sair do grupo e apagar o grupo precisam fazer antes de
// mexer em qualquer coisa: "ainda ha divisao pendente aqui?". Ela estava escrita
// duas vezes, nas duas rotas, e nas duas do mesmo jeito errado (HMO-145):
//
//     const { data } = await supabase
//       .from("group_expense_splits").select("id")
//       .eq("group_id", groupId).eq("status", "pending").limit(1);
//     if (data && data.length > 0) { /* recusa */ }
//
// `group_expense_splits` NAO TEM coluna `group_id` -- ela chega no grupo por
// `group_transaction_id -> group_transactions.group_id`. Provado contra o
// PostgREST de producao: aquela consulta responde
// `400 {"code":"42703","message":"column group_expense_splits.group_id does not
// exist"}`.
//
// E o `error` nao era lido. Entao `data` vinha `null`, `data && ...` era falso, e
// a travessa concluia "nao ha nada pendente" -- SEMPRE. A mensagem "Nao e
// possivel sair. Ha transacoes pendentes no grupo" nunca teve como aparecer, e
// quem saia levava embora o registro de quem devia a quem. Falha ABERTA, sem
// erro em lugar nenhum: nem log, nem 500, nem tela estranha.
//
// Por isso a resposta aqui tem TRES valores e nao dois. "Nao sei" nao pode
// colapsar em "nao ha" -- foi exatamente esse colapso que produziu o defeito.
// =====================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export type DivisaoPendente =
  | { situacao: "ha" }
  | { situacao: "nao-ha" }
  | { situacao: "nao-deu-para-saber"; erro: unknown };

/**
 * Ha divisao com `status = 'pending'` em alguma transacao deste grupo?
 *
 * A leitura parte de `group_transactions`, que e quem tem `group_id`, e exige a
 * divisao pelo embed `!inner`. Confirmado em producao: `200 []` para grupo sem
 * pendencia (a forma da consulta e aceita, nao e um 42703 disfarcado de vazio).
 *
 * A RLS cobre quem pergunta: `group_transactions_select` e
 * `is_group_member(group_id)`, e quem esta saindo ainda e membro no momento da
 * checagem. Depois de sair, a mesma leitura devolveria vazio -- razao a mais
 * para a travessa vir ANTES de qualquer escrita.
 */
export async function divisaoPendenteDoGrupo(
  supabase: SupabaseClient,
  groupId: string
): Promise<DivisaoPendente> {
  const { data, error } = await supabase
    .from("group_transactions")
    .select("id, group_expense_splits!inner(id)")
    .eq("group_id", groupId)
    .eq("group_expense_splits.status", "pending")
    .limit(1);

  if (error) return { situacao: "nao-deu-para-saber", erro: error };
  return (data ?? []).length > 0 ? { situacao: "ha" } : { situacao: "nao-ha" };
}
