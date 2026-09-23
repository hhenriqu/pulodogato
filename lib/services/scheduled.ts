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
      account_id: regra.account_id ?? null,
      group_id: regra.group_id ?? null,
      description: regra.description,
      amount: regra.amount,
      due_date,
      status: "pending" as const,
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
 * Sinal do valor conforme a convencao ja usada em financial_transactions:
 * despesa entra negativa, receita positiva. `scheduled_transactions.amount` e
 * sempre positivo (CHECK no banco); a direcao vem do tipo.
 */
export function valorComSinal(amount: number, tipo: string | null | undefined): number {
  return tipo === "income" ? Math.abs(amount) : -Math.abs(amount);
}
