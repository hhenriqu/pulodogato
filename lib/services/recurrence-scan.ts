// =====================================================
// A VARREDURA DE RECORRENCIAS - uma implementacao so
// =====================================================
// Este arquivo existe porque a varredura passou a ter DOIS gatilhos: o botao
// "Procurar agora" da tela (POST /api/recurrences/scan, com a sessao do
// usuario) e o cron diario (GET /api/cron/recurrence-scan, com service_role,
// varrendo todo mundo).
//
// Os dois precisam produzir exatamente o mesmo resultado. Se a logica fosse
// copiada, o dia em que alguem corrigisse a janela num lugar e nao no outro
// produziria a pior falha possivel aqui: a tela mostraria uma lista, o cron
// gravaria outra, e as duas pareceriam certas. Por isso o cliente entra como
// parametro -- e o unico jeito de o mesmo codigo servir aos dois.
//
// O QUE ESTE MODULO NAO FAZ
// -------------------------
// Nao apaga. Uma recorrencia que deixou de ser detectada (o usuario apagou os
// lancamentos que a sustentavam) continua na tabela com a decisao dele
// preservada. Apagar aqui destruiria o "eu ja ignorei essa" a cada varredura.
// =====================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectRecurrences,
  inicioDaJanela,
  type TransacaoEntrada,
} from "@/lib/recurrence-detector";

/**
 * Janela de analise, em meses.
 *
 * 24 = o minimo para uma serie ANUAL ter 3 ocorrencias, que e o que o criterio
 * de recorrencia exige. Com 6 meses (o numero do criterio de aceite 1) a
 * frequencia YEARLY existiria no codigo e nunca rodaria -- anuidade de cartao e
 * seguro anual nunca apareceriam na lista, que e justamente a cobranca que o
 * usuario esquece.
 *
 * Decidido pelo Helio na HMO-145 em 22/09/2026. Quem voltar isso para 6 tem que
 * tirar YEARLY do dominio junto, senao a opcao fica morta no banco.
 */
export const JANELA_PADRAO_MESES = 24;

/**
 * Teto de transacoes lidas numa varredura de UM usuario.
 *
 * O detector roda em memoria e o PostgREST limita a resposta de qualquer jeito.
 * O numero existe para a varredura de quem tem anos de extrato falhar de forma
 * VISIVEL -- devolvendo `truncated: true` -- em vez de analisar em silencio so
 * o pedaco que coube e concluir que a assinatura nao tem ocorrencias
 * suficientes.
 */
export const MAX_TRANSACOES = 5000;

export interface ResultadoVarredura {
  scanned: number;
  detected: number;
  window: { from: string; to: string; months: number };
  truncated: boolean;
}

/**
 * Normaliza `?months=` vindo da URL. Fora de 1..60 vale o padrao -- um
 * `?months=0` silencioso faria a janela comecar hoje e a tela abriria vazia
 * sem nenhum erro.
 */
export function janelaPedida(valor: string | null): number {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 && n <= 60 ? Math.floor(n) : JANELA_PADRAO_MESES;
}

/**
 * Le o historico de um usuario, roda o detector e grava o resultado.
 *
 * Idempotente: rodar duas vezes seguidas produz o mesmo estado. Quem garante
 * isso e o UNIQUE (user_id, merchant_key) da migration 011 -- sem ele cada
 * varredura acrescentaria uma Netflix a tela.
 *
 * Lanca `Error` quando o banco recusa. Quem chama decide o status HTTP; o cron
 * precisa seguir para o proximo usuario em vez de morrer no primeiro.
 */
export async function varrerRecorrencias(
  supabase: SupabaseClient,
  userId: string,
  meses: number = JANELA_PADRAO_MESES
): Promise<ResultadoVarredura> {
  const hoje = new Date().toISOString().slice(0, 10);
  const desde = inicioDaJanela(hoje, meses);

  const { data: transacoes, error: erroLeitura } = await supabase
    .from("financial_transactions")
    .select("id, description, amount, transaction_date")
    .eq("user_id", userId)
    .lt("amount", 0) // despesa e negativa; receita nao e assinatura
    .gte("transaction_date", desde)
    .order("transaction_date", { ascending: true })
    .limit(MAX_TRANSACOES);

  if (erroLeitura) {
    throw new Error(`Erro ao ler transacoes: ${erroLeitura.message}`);
  }

  const entradas: TransacaoEntrada[] = (transacoes || []).map((t) => ({
    id: t.id,
    description: t.description,
    // `numeric` chega como STRING no supabase-js, e `TransacaoEntrada.amount` e
    // declarado `number`. O tsc nao pega a diferenca porque a resposta do
    // supabase-js e `any`.
    //
    // Hoje o detector sobreviveria a string por acidente: `"-39.90" < 0` e true
    // (o JavaScript converte na comparacao) e todo uso do valor passa por
    // `Math.abs`, que converte de novo. Conferido -- a saida e identica com
    // string e com numero.
    //
    // A conversao fica porque esse acidente nao e contrato. Basta alguem somar
    // o valor antes do `Math.abs` para `0 + "-39.90"` virar `"0-39.90"`, ou
    // trocar por comparacao estrita, e o erro aparece como valor errado na
    // tela, nao como excecao. Converter na fronteira e o que mantem a assinatura
    // do modulo verdadeira.
    amount: Number(t.amount),
    transaction_date: t.transaction_date,
  }));

  const detectadas = detectRecurrences(entradas);

  if (detectadas.length > 0) {
    const linhas = detectadas.map((r) => ({
      user_id: userId,
      merchant_key: r.merchantKey,
      display_name: r.displayName,
      avg_amount: r.avgAmount,
      last_amount: r.lastAmount,
      monthly_cost: r.monthlyCost,
      frequency: r.frequency,
      occurrences: r.occurrences,
      last_charge_date: r.lastChargeDate,
      next_expected_date: r.nextExpectedDate,
      transaction_ids: r.transactionIds,
      // `status` e `status_changed_at` NAO entram no payload, de proposito.
      // O upsert so sobrescreve as colunas que recebe, entao a decisao do
      // usuario ("ignorar", "cancelei") sobrevive a varredura. Acrescentar
      // status aqui faz a assinatura ignorada reaparecer na tela depois de cada
      // importacao -- e agora tambem depois de cada noite, por causa do cron.
    }));

    const { error: erroGravacao } = await supabase
      .from("detected_recurrences")
      .upsert(linhas, { onConflict: "user_id,merchant_key" });

    if (erroGravacao) {
      throw new Error(`Erro ao gravar recorrencias: ${erroGravacao.message}`);
    }
  }

  return {
    scanned: entradas.length,
    detected: detectadas.length,
    window: { from: desde, to: hoje, months: meses },
    truncated: entradas.length >= MAX_TRANSACOES,
  };
}
