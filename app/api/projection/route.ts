// GET /api/projection?through=YYYY-MM-DD
//
// "Sobra ou falta no dia 30?" -- saldo de hoje mais tudo que esta previsto ate
// a data, por conta. Sem `through`, projeta ate o fim do mes corrente.
//
// Rota fina de proposito: ela busca as linhas e repassa. Toda a aritmetica --
// e a decisao de deixar a fatura fechada FORA do `scheduled_out`, que e a
// razao de o lib existir -- esta no lib/projecao.ts, com suite propria
// (`npm run test:projecao`) e mutantes (`scripts/mutantes-projecao.mjs`).
// Leia o cabecalho de la antes de mexer no numero: ele explica por que o
// lib/cash-flow-forecast.ts decide o oposto sobre a mesma fatura.
//
// O filtro de status fica aqui porque e da consulta: 'pending' e vencimento
// ate a data, incluindo as ja VENCIDAS -- uma conta que venceu ontem e nao foi
// paga continua sendo dinheiro que vai sair. Ficam de fora 'paid' (ja virou
// transacao real e ja esta no saldo), 'skipped' e 'cancelled'.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { isIsoDate, today } from "@/lib/recurrence";
import { calcularProjecao, fimDoMes } from "@/lib/projecao";

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
    const param = url.searchParams.get("through");
    const hoje = today();
    const ate = param ?? fimDoMes(hoje);

    if (!isIsoDate(ate)) {
      return NextResponse.json(
        { error: "Data deve estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    const { data: contas, error: erroContas } = await supabase
      .from("financial_accounts")
      .select("id, name, account_type, current_balance")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (erroContas) {
      console.error("Erro ao carregar contas:", erroContas);
      return NextResponse.json(
        { error: "Não foi possível carregar as contas" },
        { status: 500 }
      );
    }

    // `notes` carrega a chave canonica da fatura, e e ela que o
    // lib/projecao.ts usa para deixar a fatura fechada fora do
    // `scheduled_out`. Tirar a coluna do select nao da erro nenhum: so faz a
    // exclusao parar de acontecer, em silencio.
    const { data: previstas, error: erroPrevistas } = await supabase
      .from("scheduled_transactions")
      .select(
        "id, account_id, amount, due_date, status, notes, recurring_rule:recurring_rules(transaction_type)"
      )
      .eq("user_id", user.id)
      .eq("status", "pending")
      .lte("due_date", ate);

    if (erroPrevistas) {
      console.error("Erro ao carregar contas previstas:", erroPrevistas);
      return NextResponse.json(
        { error: "Não foi possível carregar as contas previstas" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      calcularProjecao({
        contas: contas ?? [],
        previstas: previstas ?? [],
        hoje,
        ate,
      })
    );
  } catch (error) {
    console.error("Erro na API de projeção:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
