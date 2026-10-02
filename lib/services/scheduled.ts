// =====================================================
// CONTAS PREVISTAS - regras de negocio compartilhadas
// =====================================================
// O que mais de uma rota precisa: materializar ocorrencias a partir das regras
// e transformar uma conta prevista em transacao real.
// =====================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { occurrencesBetween, today, addMonthsClamped } from "@/lib/recurrence";
import type { RecurringRule } from "@/types/financial";

/** Ate onde a agenda e materializada por padrao. */
export const HORIZONTE_PADRAO_MESES = 3;

/** Nome do servico em financial_services; toda transacao precisa de um. */
export const SERVICO_FINANCAS = "personal_finance";

export function horizonteAte(meses = HORIZONTE_PADRAO_MESES, a_partir_de = today()): string {
  return addMonthsClamped(a_partir_de, meses);
}

export async function getServiceId(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase
    .from("financial_services")
    .select("id")
    .eq("name", SERVICO_FINANCAS)
    .single();
  return data?.id ?? null;
}

/**
 * Materializa em `scheduled_transactions` os vencimentos das regras ativas do
 * usuario dentro da janela.
 *
 * Idempotente: o indice unico (recurring_rule_id, due_date) da migration 005
 * impede a linha repetida, e o insert usa ignoreDuplicates -- abrir a tela
 * duas vezes no mesmo dia nao duplica o aluguel do mes.
 *
 * O que NAO e recriado: ocorrencia que o usuario apagou volta na proxima
 * geracao (ela e derivada da regra). Para tirar um mes especifico do caminho
 * sem que ele ressuscite, o status e `skipped`, nao DELETE -- a linha continua
 * la e o indice unico segura o lugar dela.
 */
export async function materializarAgenda(
  supabase: SupabaseClient,
  userId: string,
  opts: { de?: string; ate?: string } = {},
): Promise<{ criadas: number; regras: number }> {
  const de = opts.de ?? today();
  const ate = opts.ate ?? horizonteAte();

  const { data: regras, error } = await supabase
    .from("recurring_rules")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) throw error;
  if (!regras?.length) return { criadas: 0, regras: 0 };

  const linhas = (regras as RecurringRule[]).flatMap((regra) =>
    occurrencesBetween(
      {
        frequency: regra.frequency,
        interval_count: regra.interval_count,
        due_day: regra.due_day,
        start_date: regra.start_date,
        end_date: regra.end_date,
        max_occurrences: regra.max_occurrences,
      },
      de,
      ate,
    ).map((due_date) => ({
      user_id: userId,
      recurring_rule_id: regra.id,
      category_id: regra.category_id,
      // HMO-216. O ultimo elo: a regra guarda a subcategoria, e e aqui que ela
      // chega a cada ocorrencia. Sem esta linha a cadeia inteira
      // (tela -> regra -> agenda -> baixa) carregaria o campo e o soltaria no
      // penultimo passo, e o sintoma seria "a despesa fixa perde a
      // subcategoria, a avulsa nao" -- sem erro em lugar nenhum.
      subcategory_id: regra.subcategory_id ?? null,
      account_id: regra.account_id ?? null,
      group_id: regra.group_id ?? null,
      description: regra.description,
      amount: regra.amount,
      due_date,
      status: "pending" as const,
      // A TRANSFERENCIA RECORRENTE (HMO-172, migration 037)
      //
      // Estas duas linhas sao o elo que faltava: sem elas a ocorrencia nasce sem
      // destino, e a baixa de uma transferencia prevista gravaria UMA perna --
      // o saldo das duas contas errado em direcoes opostas, com o total geral
      // certo e nenhum agregado acusando. E o defeito que a HMO-172 nomeia.
      //
      // `transaction_type` e gravado EXPLICITAMENTE aqui, e so em transferencia.
      // Para income/expense ele continua NULL, que na 027 quer dizer "pergunte a
      // regra" -- e esse NULL e deliberado: editar a regra de despesa para
      // receita tem de reapontar as ocorrencias futuras, e uma copia gravada em
      // cada uma congelaria a direcao antiga.
      //
      // Transferencia e a excecao porque o CHECK da 037 precisa do tipo na
      // PROPRIA linha para poder exigir `destination_account_id`: um CHECK nao
      // consulta outra tabela, entao sem o literal aqui a ocorrencia cairia no
      // ramo que proibe destino e o INSERT levaria 23514. A exigencia do banco e
      // o que torna esta assimetria segura em vez de arbitraria -- e o par
      // (tipo, destino) viaja junto ou nao viaja.
      ...(regra.transaction_type === "transfer"
        ? {
            transaction_type: "transfer" as const,
            destination_account_id: regra.destination_account_id ?? null,
          }
        : {}),
    })),
  );

  if (!linhas.length) return { criadas: 0, regras: regras.length };

  const { data: inseridas, error: erroInsert } = await supabase
    .from("scheduled_transactions")
    .upsert(linhas, {
      onConflict: "recurring_rule_id,due_date",
      ignoreDuplicates: true,
    })
    .select("id");

  if (erroInsert) throw erroInsert;

  return { criadas: inseridas?.length ?? 0, regras: regras.length };
}

/**
 * Encerra um gasto fixo: a regra para de gerar e as ocorrencias abertas saem da
 * agenda.
 *
 * POR QUE ISTO E UMA FUNCAO, E NAO CODIGO REPETIDO (HMO-228)
 * ---------------------------------------------------------
 * Dois caminhos precisam fazer exatamente isto:
 *
 *   DELETE /api/recurring-rules/{id}                  "excluir o gasto fixo"
 *   DELETE /api/scheduled-transactions/{id}?alcance=todas
 *                                                     "apagar todas as parcelas"
 *
 * Sao duas frases para o mesmo pedido, e o segundo chegou depois. Escrever o
 * `is_active = false` + `cancelled` de novo no caminho novo criaria dois lugares
 * que encerram uma regra -- e eles divergem no primeiro conserto que so um dos
 * dois receber. O defeito resultante seria "apagar pela tela de contas previstas
 * funciona, apagar pela tela de gastos fixos deixa um mes para tras", sem nada
 * no codigo indicando que havia duas implementacoes.
 *
 * O `gte(hoje)` nas ocorrencias e deliberado e e diferente da barreira das
 * outras regras de alcance: aqui nao se esta corrigindo um valor, e sim tirando
 * da agenda o que ainda nao venceu. A conta que venceu e nao foi paga continua
 * sendo uma divida real -- cancela-la apagaria da tela um atraso que existe.
 */
export async function encerrarRegra(
  supabase: SupabaseClient,
  ruleId: string,
  userId: string,
): Promise<
  | { ok: true; rule: Record<string, unknown>; canceladas: number }
  | { ok: false; motivo: "nao_encontrada" | "erro" }
> {
  const { data: rule, error } = await supabase
    .from("recurring_rules")
    .update({ is_active: false })
    .eq("id", ruleId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error || !rule) return { ok: false, motivo: "nao_encontrada" };

  const { data: canceladas } = await supabase
    .from("scheduled_transactions")
    .update({ status: "cancelled" })
    .eq("recurring_rule_id", ruleId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .gte("due_date", today())
    .select("id");

  return { ok: true, rule, canceladas: canceladas?.length ?? 0 };
}

/**
 * Sinal do valor conforme a convencao ja usada em financial_transactions:
 * despesa entra negativa, receita positiva. `scheduled_transactions.amount` e
 * sempre positivo (CHECK no banco); a direcao vem do tipo.
 */
export function valorComSinal(amount: number, tipo: string | null | undefined): number {
  return tipo === "income" ? Math.abs(amount) : -Math.abs(amount);
}
