// =====================================================
// ORCAMENTO - regras de negocio compartilhadas
// =====================================================
// O que mais de uma rota precisa: normalizar o mes e repetir os tetos de um
// mes para o seguinte.
// =====================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { today } from "@/lib/recurrence";

/**
 * Normaliza para o primeiro dia do mes, aceitando 'YYYY-MM' ou 'YYYY-MM-DD'.
 *
 * Feito por fatia de string, sem `new Date()`: a string ISO e interpretada como
 * UTC e, no fuso do Brasil, `new Date('2026-03-01').getMonth()` ainda devolve
 * fevereiro. O mesmo cuidado que lib/recurrence.ts ja toma.
 */
export function primeiroDiaDoMes(valor: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(valor);
  if (!m) return null;

  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;

  return `${m[1]}-${m[2]}-01`;
}

/** O mes corrente, no fuso de Sao Paulo, como 'YYYY-MM-01'. */
export function mesCorrente(): string {
  return `${today().slice(0, 7)}-01`;
}

/** Soma meses a um 'YYYY-MM-01' sem passar por Date. */
export function somarMeses(mesIso: string, meses: number): string {
  const [ano, mes] = mesIso.split("-").map(Number);
  // -1 para trabalhar com o mes em base 0, senao dezembro (12) + 1 vira o mes
  // 13 do mesmo ano em vez de janeiro do ano seguinte.
  const total = ano * 12 + (mes - 1) + meses;
  const novoAno = Math.floor(total / 12);
  const novoMes = (total % 12) + 1;
  return `${String(novoAno).padStart(4, "0")}-${String(novoMes).padStart(2, "0")}-01`;
}

/**
 * Copia para `mesDestino` os tetos de `mesOrigem` marcados com carry_forward.
 *
 * Idempotente, mas NAO por upsert -- e aqui esta a diferenca para a agenda da
 * Fase 1, que usa `onConflict: "recurring_rule_id,due_date"`.
 *
 * Os dois indices unicos do 006 sao PARCIAIS (um `WHERE group_id IS NULL`,
 * outro `WHERE group_id IS NOT NULL`), porque so assim o teto pessoal e o do
 * grupo ficam separados: num indice comum, dois NULL nunca colidem no Postgres
 * e dois orcamentos pessoais da mesma categoria e mes passariam. O preco e que
 * o ON CONFLICT do PostgREST nao consegue inferir um indice com predicado e
 * estoura 42P10 -- exatamente o motivo pelo qual o 005 fez questao de NAO usar
 * indice parcial. Entao aqui a conta e feita no app: le o que ja existe no mes
 * destino e insere so o que falta.
 *
 * Corrida entre duas requisicoes simultaneas continua coberta pelo indice, que
 * devolve 23505; o chamador trata como "ja estava la".
 *
 * O que NAO acontece: um teto ja existente no mes destino nao e sobrescrito.
 * Se o usuario ajustou o mercado de outubro para R$ 1.200, repetir setembro
 * por cima desfaria o ajuste dele -- e ele nao teria como saber.
 */
export async function repetirOrcamentos(
  supabase: SupabaseClient,
  userId: string,
  opts: { de?: string; para?: string } = {},
): Promise<{ criados: number; origem: string; destino: string }> {
  const origem = opts.de ?? mesCorrente();
  const destino = opts.para ?? somarMeses(origem, 1);

  const { data: base, error } = await supabase
    .from("budgets")
    .select("category_id, group_id, amount_limit, alert_threshold, notes")
    .eq("user_id", userId)
    .eq("month", origem)
    .eq("carry_forward", true);

  if (error) throw error;
  if (!base?.length) return { criados: 0, origem, destino };

  const { data: existentes, error: erroExistentes } = await supabase
    .from("budgets")
    .select("category_id, group_id")
    .eq("user_id", userId)
    .eq("month", destino);

  if (erroExistentes) throw erroExistentes;

  const chave = (categoria: string, grupo: string | null) => `${categoria}|${grupo ?? ""}`;
  const jaExiste = new Set(
    (existentes ?? []).map((e) => chave(e.category_id, e.group_id ?? null)),
  );

  const linhas = base
    .filter((b) => !jaExiste.has(chave(b.category_id, b.group_id ?? null)))
    .map((b) => ({
      user_id: userId,
      category_id: b.category_id,
      group_id: b.group_id ?? null,
      month: destino,
      amount_limit: b.amount_limit,
      alert_threshold: b.alert_threshold,
      carry_forward: true,
      notes: b.notes ?? null,
    }));

  if (!linhas.length) return { criados: 0, origem, destino };

  const { data: criadas, error: erroInsert } = await supabase
    .from("budgets")
    .insert(linhas)
    .select("id");

  // 23505 = outra requisicao criou os mesmos tetos entre o SELECT e o INSERT.
  // O resultado desejado (os tetos existem no mes destino) ja foi alcancado.
  if (erroInsert && erroInsert.code !== "23505") throw erroInsert;

  return { criados: criadas?.length ?? 0, origem, destino };
}

/**
 * Alerta em texto para a tela e para a notificacao.
 *
 * `ratio` ja vem positivo da view (ela aplica ABS sobre o valor, que e gravado
 * negativo nas despesas).
 */
export function rotuloConsumo(status: string, ratio: number): string {
  const pct = Math.round(ratio * 100);
  if (status === "exceeded") return `Estourou: ${pct}% do teto`;
  if (status === "alert") return `Atenção: ${pct}% do teto`;
  return `${pct}% do teto`;
}
