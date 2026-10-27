import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParteDaConexao } from "@/lib/conta-da-conexao";

/**
 * Grava as partes de uma despesa fixa (`recurring_rule_splits`) ou de uma conta
 * prevista (`scheduled_splits`) dividida com conexoes (075). O banco faz o
 * resto: as contas "A receber de" e "Pagamento a" nascem dos triggers.
 *
 * Devolve a frase para a tela quando nao gravou, ou `null`. A policy da 075 so
 * deixa gravar parte de conexao ACEITA, e e essa a recusa (42501) que a frase
 * traduz.
 */
export async function gravarPartesDaConexao(
  supabase: SupabaseClient,
  destino: "recurring_rule_splits" | "scheduled_splits",
  id: string,
  partes: ParteDaConexao[]
): Promise<string | null> {
  if (partes.length === 0) return null;
  const coluna =
    destino === "recurring_rule_splits" ? "recurring_rule_id" : "scheduled_transaction_id";

  const { error } = await supabase
    .from(destino)
    .insert(partes.map((p) => ({ [coluna]: id, ...p })));

  if (!error) return null;
  console.error(`Erro ao gravar ${destino}:`, error);
  return error.code === "42501"
    ? "Só dá para dividir com uma conexão aceita."
    : "Não foi possível gravar a divisão com a conexão.";
}
