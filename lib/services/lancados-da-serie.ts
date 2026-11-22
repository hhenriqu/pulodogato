// ---------------------------------------------------------------------------
// "TODOS OS MESES" TAMBEM APAGA OS JA LANCADOS (decisao de 22/11/2026)
// ---------------------------------------------------------------------------
// A pergunta do alcance nas telas de Receitas/Despesas oferece "Todos os
// meses". Por padrao (Contas a Pagar, HMO-228) encerrar a serie preserva o que
// ja foi pago. Mas o caso que trouxe a pergunta foi o SALARIO DUPLICADO: uma
// serie que nunca deveria ter existido, e cujos meses ja recebidos sao tao
// duplicados quanto os futuros. A pessoa escolheu que, ali, "Todos" apaga
// tambem os lancamentos ja recebidos/pagos da serie.
//
// O QUE ISTO FAZ, NA ORDEM
// ------------------------
//   1. le as ocorrencias `paid` da regra e o lancamento de cada uma;
//   2. apaga os lancamentos que NAO sao transferencia. Fatura, transferencia
//      prevista e parcela do MyBank dao baixa com DUAS pernas, e o estorno delas
//      e o `DELETE .../pay` -- apagar uma perna daqui deixaria a outra no saldo
//      (o mesmo motivo de a 065 deixa-las de fora). Essas FICAM, e a contagem
//      volta para a tela;
//   3. o trigger da 065 devolve cada ocorrencia para `pending`; aqui ela vira
//      `cancelled` pelo id. Sem isso, `encerrarRegra` (que so cancela as
//      pendentes de HOJE em diante) deixaria os meses passados reaparecendo
//      como contas atrasadas.
//
//   4. os meses PASSADOS ainda em aberto tambem saem (`cancelled`): numa serie
//      que a pessoa mandou apagar inteira, a "conta atrasada" de um salario
//      duplicado nao e divida real nenhuma.
//
// Quem chama encerra a regra ANTES (`encerrarRegra`), como sempre: ela cancela
// as pendentes de hoje em diante e devolve a contagem dela.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";

export interface LancadosApagados {
  /** Lancamentos ja recebidos/pagos que foram apagados. */
  apagados: number;
  /** Os que ficaram: transferencias, ou recusados pelo banco. */
  preservados: number;
  /** Meses PASSADOS ainda em aberto, que `encerrarRegra` deixa e aqui saem. */
  vencidasCanceladas: number;
}

export async function apagarLancadosDaSerie(
  supabase: SupabaseClient,
  ruleId: string,
  userId: string
): Promise<LancadosApagados> {
  const { data: pagas, error } = await supabase
    .from("scheduled_transactions")
    .select("id, transaction_id")
    .eq("recurring_rule_id", ruleId)
    .eq("user_id", userId)
    .eq("status", "paid");

  if (error) throw error;

  const comLancamento = (pagas ?? []).filter(
    (o): o is { id: string; transaction_id: string } => !!o.transaction_id
  );
  if (comLancamento.length === 0) {
    return { apagados: 0, preservados: 0, vencidasCanceladas: await cancelarEmAberto(supabase, ruleId, userId) };
  }

  const { data: lancamentos, error: erroDosLancamentos } = await supabase
    .from("financial_transactions")
    .select("id, transaction_type")
    .in(
      "id",
      comLancamento.map((o) => o.transaction_id)
    )
    .eq("user_id", userId);

  if (erroDosLancamentos) throw erroDosLancamentos;

  const apagaveis = new Set(
    (lancamentos ?? [])
      .filter((l) => l.transaction_type !== "transfer")
      .map((l) => l.id as string)
  );

  let apagados = 0;
  // UM POR UM, e nao `.in(...)`: um lancamento que o banco recusa (a divisao
  // com pessoa ja paga, 070) derrubaria o lote inteiro, e a pessoa ficaria sem
  // saber quais sairam. Assim cada um sai ou fica, e a ocorrencia so e
  // cancelada quando o lancamento dela saiu de fato.
  for (const ocorrencia of comLancamento) {
    if (!apagaveis.has(ocorrencia.transaction_id)) continue;

    const { error: erroAoApagar } = await supabase
      .from("financial_transactions")
      .delete()
      .eq("id", ocorrencia.transaction_id)
      .eq("user_id", userId);

    if (erroAoApagar) {
      console.error(
        `Lançamento ${ocorrencia.transaction_id} da série ${ruleId} não foi apagado:`,
        erroAoApagar
      );
      continue;
    }

    // `paid` tambem, e o elo zerado aqui mesmo: o trigger da 065 ja fez isso
    // num banco com a migration colada, e esta escrita nao depende dele -- sem
    // ela, um banco sem a 065 recusaria o DELETE acima pela FK, e nada chegaria
    // aqui; com ela, a linha ja esta `pending` e o `in` a pega igual.
    await supabase
      .from("scheduled_transactions")
      .update({ status: "cancelled", paid_date: null, transaction_id: null })
      .eq("id", ocorrencia.id)
      .eq("user_id", userId)
      .in("status", ["pending", "paid"]);

    apagados += 1;
  }

  return {
    apagados,
    preservados: comLancamento.length - apagados,
    vencidasCanceladas: await cancelarEmAberto(supabase, ruleId, userId),
  };
}

/** O passo 4: toda ocorrencia ainda `pending` da regra vira `cancelled`. */
async function cancelarEmAberto(
  supabase: SupabaseClient,
  ruleId: string,
  userId: string
): Promise<number> {
  const { data } = await supabase
    .from("scheduled_transactions")
    .update({ status: "cancelled" })
    .eq("recurring_rule_id", ruleId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("id");
  return data?.length ?? 0;
}
