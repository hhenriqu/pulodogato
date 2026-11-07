// GET /api/investments/custo-de-vida
//
// O custo de vida mes a mes (12 meses fechados para tras, 12 para a frente a
// partir do mes corrente) e a reserva de emergencia sugerida para 12 meses. O
// criterio e a conta estao no cabecalho de lib/custo-de-vida.ts; aqui so se le
// o banco e se recorta tudo pela MINHA parte.
//
// AS LEITURAS
// -----------
//   1. `financial_transactions` minhas, de despesa, SEM grupo -- a compra no
//      cartao inclusa, na data da compra. O pagamento da fatura e transferencia
//      e nao entra: o cartao conta uma vez. `include_in_total = false` sai.
//      `eq("user_id")` e load-bearing: a policy de grupo deixa ler a despesa
//      dos colegas.
//   2. `group_share_entries` -- a MINHA parte de cada despesa de grupo, tenha eu
//      pago ou nao (aqui nao se usa o filtro `paguei_eu` do Resultado do mes,
//      porque o que eu paguei para os outros nao e custo de vida meu).
//   3. `group_closing_entries` de despesa -- no grupo com dia de fechamento a
//      parte de quem nao pagou sai da view acima e o que ele deve vem pela
//      conta do fechamento quitada (069).
//   4. `scheduled_transactions.transaction_id` -- as baixas de contas
//      previstas, que marcam a despesa do historico como FIXA.
//   5. `recurring_rules` de despesa -- as contas fixas da previsao, pela minha
//      parte nos grupos (`parteConfiguradaDoMembro`, a mesma do custo fixo).
//
// So a moeda oficial: somar real com dolar daria um numero que nao esta em
// moeda nenhuma, e nao ha cotacao no app.
//
// Nao precisa de migration: tudo o que se le ja existe.

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import {
  calcularCustoDeVida,
  mesesDoHistorico,
  fimDoMes,
  type ContaFixaDoCusto,
  type DespesaDoCusto,
} from "@/lib/custo-de-vida";
import { classeDaAgenda } from "@/lib/previsto-x-realizado";
import {
  montarParticipantesPorGrupo,
  parteConfiguradaDoMembro,
  type ParticipantesPorGrupo,
} from "@/lib/parte-do-grupo";
import { viewDaParteAusente } from "@/lib/parte-do-grupo-realizada";
import { lerMoedaOficial } from "@/lib/services/resultado-do-mes";
import { lerContasDoFechamentoRealizadas } from "@/lib/services/fechamento-no-resultado";
import type { RecurrenceFrequency } from "@/types/financial";

export const dynamic = "force-dynamic";

const PAGINA = 1000;

/** A moeda da linha bate com a oficial? Linha sem moeda e da oficial. */
function naMoeda(moeda: string, linha: { currency?: string | null }): boolean {
  return !linha.currency || linha.currency === moeda;
}

export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const hoje = today();
    const meses = mesesDoHistorico(hoje);
    const de = `${meses[0]}-01`;
    const ate = fimDoMes(meses[meses.length - 1]);

    const moeda = await lerMoedaOficial(supabase, user.id);
    const despesas: DespesaDoCusto[] = [];

    // 1. As minhas despesas sem grupo. Paginado: a soma e feita aqui, e uma
    // resposta truncada pelo teto do PostgREST sairia MENOR, sem erro.
    for (let inicio = 0; ; inicio += PAGINA) {
      const { data, error } = await supabase
        .from("financial_transactions")
        .select("id, amount, transaction_date, description, currency, include_in_total")
        .eq("user_id", user.id)
        .eq("transaction_type", "expense")
        .is("group_id", null)
        .gte("transaction_date", de)
        .lte("transaction_date", ate)
        .order("id", { ascending: true })
        .range(inicio, inicio + PAGINA - 1);

      if (error) {
        console.error("Custo de vida: erro nas despesas:", error);
        return NextResponse.json(
          { error: "Não foi possível calcular o custo de vida" },
          { status: 500 }
        );
      }

      const lote = data ?? [];
      for (const t of lote) {
        if (t.include_in_total === false || !naMoeda(moeda, t)) continue;
        despesas.push({
          data: String(t.transaction_date),
          valor: Math.abs(Number(t.amount) || 0),
          descricao: t.description ?? null,
          transacaoId: t.id,
        });
      }
      if (lote.length < PAGINA) break;
    }

    // 2. A minha parte das despesas de grupo (e da divisao com pessoa).
    for (let inicio = 0; ; inicio += PAGINA) {
      const { data, error } = await supabase
        .from("group_share_entries")
        .select("id, transaction_id, amount, transaction_date, descricao, currency")
        .eq("user_id", user.id)
        .gte("transaction_date", de)
        .lte("transaction_date", ate)
        .order("id", { ascending: true })
        .range(inicio, inicio + PAGINA - 1);

      // A 033 ainda nao colada: segue sem a parte de grupo, como o Resultado.
      if (error && viewDaParteAusente(error)) break;
      if (error) {
        console.error("Custo de vida: erro na parte de grupo:", error);
        return NextResponse.json(
          { error: "Não foi possível calcular o custo de vida" },
          { status: 500 }
        );
      }

      const lote = data ?? [];
      for (const p of lote) {
        if (!naMoeda(moeda, p)) continue;
        despesas.push({
          data: String(p.transaction_date),
          valor: Math.abs(Number(p.amount) || 0),
          descricao: p.descricao ?? null,
          transacaoId: p.transaction_id ?? null,
        });
      }
      if (lote.length < PAGINA) break;
    }

    // 3. A conta do fechamento quitada, do lado de quem pagou ao grupo.
    const fechamento = await lerContasDoFechamentoRealizadas(supabase, user.id, de, ate);
    if (fechamento.ok) {
      for (const c of fechamento.contas) {
        if (c.transaction_type !== "expense" || !naMoeda(moeda, c)) continue;
        despesas.push({
          data: String(c.transaction_date),
          valor: Math.abs(Number(c.amount) || 0),
          descricao: c.descricao ?? null,
        });
      }
    } else {
      console.error("Custo de vida seguiu sem a conta do fechamento:", fechamento.erro);
    }

    // 4 e 5. As baixas das previstas e as contas fixas, em paralelo.
    const [baixas, regras] = await Promise.all([
      supabase
        .from("scheduled_transactions")
        .select("transaction_id")
        .not("transaction_id", "is", null)
        .gte("due_date", `${meses[0]}-01`)
        .limit(5000),
      supabase
        .from("recurring_rules")
        .select(
          "description, amount, frequency, interval_count, due_day, start_date, end_date, max_occurrences, transaction_type, group_id, is_active"
        ),
    ]);

    if (baixas.error) {
      console.error("Custo de vida seguiu sem as baixas das previstas:", baixas.error);
    }
    if (regras.error) {
      console.error("Custo de vida: erro nas contas fixas:", regras.error);
      return NextResponse.json(
        { error: "Não foi possível calcular o custo de vida" },
        { status: 500 }
      );
    }

    type Regra = {
      description: string | null;
      amount: number | string;
      frequency: RecurrenceFrequency;
      interval_count: number | null;
      due_day: number | null;
      start_date: string;
      end_date: string | null;
      max_occurrences: number | null;
      transaction_type: string | null;
      group_id: string | null;
      is_active: boolean | null;
    };

    // Receita e transferencia (inclusive o pagamento da fatura) nao sao custo.
    const deDespesa = ((regras.data ?? []) as Regra[]).filter(
      (r) => classeDaAgenda(r.transaction_type) === "expense"
    );
    const ativas = deDespesa.filter((r) => r.is_active !== false);

    const grupos = Array.from(
      new Set(ativas.map((r) => r.group_id).filter((id): id is string => Boolean(id)))
    );

    let pesos: ParticipantesPorGrupo = new Map();
    if (grupos.length > 0) {
      const { data: membros, error: erroMembros } = await supabase
        .from("group_members")
        .select("id, group_id, user_id, percentage, status")
        .in("group_id", grupos)
        .eq("status", "active");
      if (erroMembros) {
        // Sem os pesos a parte fica no valor cheio: erra para cima, que numa
        // reserva de emergencia e o lado seguro.
        console.error("Custo de vida seguiu sem dividir a parte do grupo:", erroMembros);
      } else {
        pesos = montarParticipantesPorGrupo(membros ?? []);
      }
    }

    const contasFixas: ContaFixaDoCusto[] = ativas.map((r) => ({
      descricao: r.description,
      valor: parteConfiguradaDoMembro(r.amount, r.group_id, pesos, user.id),
      frequency: r.frequency,
      interval_count: r.interval_count,
      due_day: r.due_day,
      start_date: String(r.start_date).slice(0, 10),
      end_date: r.end_date ? String(r.end_date).slice(0, 10) : null,
      max_occurrences: r.max_occurrences,
    }));

    const custo = calcularCustoDeVida({
      despesas,
      contasFixas,
      idsDeBaixa: ((baixas.data ?? []) as { transaction_id: string | null }[])
        .map((b) => b.transaction_id)
        .filter((id): id is string => Boolean(id)),
      descricoesFixasEncerradas: deDespesa
        .filter((r) => r.is_active === false)
        .map((r) => r.description),
      hoje,
    });

    return NextResponse.json({ hoje, moeda, ...custo });
  } catch (error) {
    console.error("Erro no custo de vida:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
