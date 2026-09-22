import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  detectRecurrences,
  inicioDaJanela,
  type TransacaoEntrada,
} from "@/lib/recurrence-detector";

// =====================================================
// POST /api/recurrences/scan
// =====================================================
// A varredura: le o historico de transacoes, roda o detector e grava o
// resultado em detected_recurrences. E o "job" da subtarefa 3 -- chamado depois
// de cada importacao de extrato e, quando houver agendador, uma vez por dia.
//
// Idempotente: rodar duas vezes seguidas produz o mesmo estado. Quem garante
// isso e o UNIQUE (user_id, merchant_key) da migration 011 -- sem ele, cada
// varredura acrescentaria uma Netflix a tela.
//
// A JANELA NAO E DE 6 MESES, E ISSO E DE PROPOSITO
// -------------------------------------------------
// O criterio de aceite 1 fala em "ultimos 6 meses" e o criterio 2 aceita
// frequencia anual. Os dois nao cabem juntos: uma cobranca anual precisa de 3
// ocorrencias para virar recorrencia, e 3 cobrancas anuais ocupam mais de 24
// meses de extrato. Com janela de 6 meses a frequencia YEARLY nunca seria
// detectada -- o codigo existiria e nunca rodaria, que e o tipo de bug que so
// aparece quando alguem pergunta por que a anuidade do cartao nao esta na
// lista.
//
// A janela padrao aqui e 24 meses, que e o minimo para o anual existir. O
// parametro `?months=` permite ajustar sem mexer no codigo. Decidido pelo Helio
// na HMO-145 em 22/09/2026: fica em 24 meses, para a anuidade de cartao e o
// seguro anual entrarem na lista. Quem voltar isso para 6 precisa tirar YEARLY
// do dominio junto, senao a opcao fica morta no banco.
// =====================================================

/** Ver o bloco acima. 24 = o minimo para uma serie anual ter 3 ocorrencias. */
const JANELA_PADRAO_MESES = 24;

/**
 * Teto de transacoes lidas numa varredura.
 *
 * O detector roda em memoria, e o PostgREST limita a resposta de qualquer
 * jeito. O numero existe para a varredura de um usuario com anos de extrato
 * falhar de forma visivel -- devolvendo `truncated: true` -- em vez de
 * silenciosamente analisar so o pedaco que coube e concluir que a assinatura
 * nao tem ocorrencias suficientes.
 */
const MAX_TRANSACOES = 5000;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const mesesParam = Number(url.searchParams.get("months"));
    const meses =
      Number.isFinite(mesesParam) && mesesParam > 0 && mesesParam <= 60
        ? Math.floor(mesesParam)
        : JANELA_PADRAO_MESES;

    const hoje = new Date().toISOString().slice(0, 10);
    const desde = inicioDaJanela(hoje, meses);

    const { data: transacoes, error: erroLeitura } = await supabase
      .from("financial_transactions")
      .select("id, description, amount, transaction_date")
      .eq("user_id", user.id)
      .lt("amount", 0) // despesa e negativa; receita nao e assinatura
      .gte("transaction_date", desde)
      .order("transaction_date", { ascending: true })
      .limit(MAX_TRANSACOES);

    if (erroLeitura) {
      return NextResponse.json(
        { error: `Erro ao ler transacoes: ${erroLeitura.message}` },
        { status: 500 }
      );
    }

    const entradas: TransacaoEntrada[] = (transacoes || []).map((t) => ({
      id: t.id,
      description: t.description,
      // `numeric` chega como string no supabase-js. Sem o Number aqui, a
      // comparacao `amount < 0` do detector roda sobre string e descarta tudo
      // em silencio -- a tela abre vazia e nada falha.
      amount: Number(t.amount),
      transaction_date: t.transaction_date,
    }));

    const detectadas = detectRecurrences(entradas);

    if (detectadas.length > 0) {
      const linhas = detectadas.map((r) => ({
        user_id: user.id,
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
        // `status` e `status_changed_at` NAO entram no payload de proposito.
        // O upsert so sobrescreve as colunas que recebe, entao a decisao do
        // usuario ("ignorar", "cancelei") sobrevive a varredura. Acrescentar
        // status aqui faz a assinatura ignorada reaparecer na tela depois de
        // cada importacao.
      }));

      const { error: erroGravacao } = await supabase
        .from("detected_recurrences")
        .upsert(linhas, { onConflict: "user_id,merchant_key" });

      if (erroGravacao) {
        return NextResponse.json(
          { error: `Erro ao gravar recorrencias: ${erroGravacao.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      scanned: entradas.length,
      detected: detectadas.length,
      window: { from: desde, to: hoje, months: meses },
      truncated: entradas.length >= MAX_TRANSACOES,
    });
  } catch (error) {
    console.error("Erro em POST /api/recurrences/scan:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
