// GET /api/scheduled-transactions/summary?months=3
//
// O numero que o app nao sabia responder antes: quanto ainda vai sair este mes.
// Serve o cabecalho da tela de contas e o widget do dashboard.
//
// A agregacao e feita aqui, em JavaScript, e nao com um GROUP BY: o PostgREST
// nao expoe agregacao sem criar uma RPC, e uma RPC nova significaria mais uma
// funcao SECURITY DEFINER para auditar (ver migrations 003 e 004). O volume e
// de dezenas de linhas por mes - cabe na memoria sem pensar duas vezes.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { materializarAgenda } from "@/lib/services/scheduled";
import { addMonthsClamped, monthlyCost, today } from "@/lib/recurrence";
import type { RecurringRule, ScheduledSummary } from "@/types/financial";

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const meses = Math.min(Math.max(Number(url.searchParams.get("months") ?? 3), 1), 12);

    const hoje = today();
    // Do primeiro dia do mes corrente ate o fim da janela: o resumo do mes tem
    // que incluir o que ja foi pago nos dias que passaram.
    const de = `${hoje.slice(0, 7)}-01`;
    const ate = addMonthsClamped(de, meses);

    try {
      await materializarAgenda(supabase, user.id, { de: hoje, ate });
    } catch (erroAgenda) {
      console.error("Resumo seguiu sem materializar a agenda:", erroAgenda);
    }

    const { data: linhas, error } = await supabase
      .from("scheduled_transactions_effective")
      .select("due_date, amount, status, effective_status")
      .gte("due_date", de)
      .lte("due_date", ate);

    if (error) {
      console.error("Erro ao resumir contas previstas:", error);
      return NextResponse.json(
        { error: "Não foi possível calcular o resumo" },
        { status: 500 }
      );
    }

    const { data: regras } = await supabase
      .from("recurring_rules")
      .select("amount, frequency, interval_count, transaction_type")
      .eq("is_active", true);

    const custoFixoMensal = ((regras ?? []) as RecurringRule[])
      .filter((r) => r.transaction_type !== "income")
      .reduce(
        (soma, r) =>
          soma +
          monthlyCost(
            { frequency: r.frequency, interval_count: r.interval_count, start_date: hoje },
            Number(r.amount)
          ),
        0
      );

    const porMes = new Map<string, ScheduledSummary>();

    for (const linha of linhas ?? []) {
      const mes = String(linha.due_date).slice(0, 7);
      const atual =
        porMes.get(mes) ??
        ({
          month: mes,
          total_pending: 0,
          total_overdue: 0,
          total_paid: 0,
          fixed_monthly_cost: Number(custoFixoMensal.toFixed(2)),
          count_pending: 0,
          count_overdue: 0,
        } as ScheduledSummary);

      const valor = Number(linha.amount);

      if (linha.effective_status === "overdue") {
        atual.total_overdue += valor;
        atual.count_overdue += 1;
      } else if (linha.status === "pending") {
        atual.total_pending += valor;
        atual.count_pending += 1;
      } else if (linha.status === "paid") {
        atual.total_paid += valor;
      }

      porMes.set(mes, atual);
    }

    // Array.from em vez de spread: o tsconfig do projeto compila para ES5, onde
    // espalhar um iterador de Map exige --downlevelIteration.
    const resumo = Array.from(porMes.values())
      .map((m) => ({
        ...m,
        total_pending: Number(m.total_pending.toFixed(2)),
        total_overdue: Number(m.total_overdue.toFixed(2)),
        total_paid: Number(m.total_paid.toFixed(2)),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return NextResponse.json({
      summary: resumo,
      fixed_monthly_cost: Number(custoFixoMensal.toFixed(2)),
      range: { from: de, to: ate },
    });
  } catch (error) {
    console.error("Erro no resumo de contas previstas:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
