// GET  /api/recurring-rules            lista os gastos e receitas fixos
// POST /api/recurring-rules            cadastra um e ja materializa a agenda
//
// A RLS da migration 005 e quem filtra: o SELECT devolve as regras do proprio
// usuario mais as dos grupos de que ele participa. Nao repetimos o filtro aqui
// para nao ter duas versoes da mesma regra de acesso.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { materializarAgenda } from "@/lib/services/scheduled";
import { isIsoDate, today } from "@/lib/recurrence";

const FREQUENCIAS = [
  "weekly",
  "biweekly",
  "monthly",
  "bimonthly",
  "quarterly",
  "semiannual",
  "annual",
];

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
    const incluirInativas = url.searchParams.get("include_inactive") === "true";

    let query = supabase
      .from("recurring_rules")
      .select(
        `
        *,
        category:transaction_categories(*),
        account:financial_accounts(id, name, account_type, color_hex),
        group:expense_groups(id, name, group_code)
      `
      )
      .order("due_day", { ascending: true, nullsFirst: false });

    if (!incluirInativas) query = query.eq("is_active", true);

    const { data: rules, error } = await query;

    if (error) {
      console.error("Erro ao listar gastos fixos:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar os gastos fixos" },
        { status: 500 }
      );
    }

    return NextResponse.json({ rules: rules ?? [] });
  } catch (error) {
    console.error("Erro na API de gastos fixos:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const {
      description,
      amount,
      category_id,
      account_id,
      group_id,
      transaction_type = "expense",
      frequency = "monthly",
      interval_count = 1,
      due_day,
      start_date = today(),
      end_date,
      max_occurrences,
      reminder_days = 3,
      notes,
    } = body;

    if (!description?.trim()) {
      return NextResponse.json(
        { error: "Descrição é obrigatória" },
        { status: 400 }
      );
    }

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json(
        { error: "Valor deve ser maior que zero" },
        { status: 400 }
      );
    }

    if (!category_id) {
      return NextResponse.json(
        { error: "Categoria é obrigatória" },
        { status: 400 }
      );
    }

    if (!FREQUENCIAS.includes(frequency)) {
      return NextResponse.json(
        { error: `Frequência inválida. Use uma de: ${FREQUENCIAS.join(", ")}` },
        { status: 400 }
      );
    }

    if (due_day != null && (due_day < 1 || due_day > 31)) {
      return NextResponse.json(
        { error: "Dia de vencimento deve estar entre 1 e 31" },
        { status: 400 }
      );
    }

    if (!isIsoDate(start_date) || (end_date && !isIsoDate(end_date))) {
      return NextResponse.json(
        { error: "Datas devem estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    if (end_date && end_date < start_date) {
      return NextResponse.json(
        { error: "Data final não pode ser anterior à inicial" },
        { status: 400 }
      );
    }

    // Grupo so vale se o usuario for membro ativo. A RLS ja barraria a LEITURA
    // depois, mas sem esta checagem o INSERT passa e a regra nasce invisivel
    // para o proprio dono na tela do grupo.
    if (group_id) {
      const { data: membro } = await supabase
        .from("group_members")
        .select("id")
        .eq("group_id", group_id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .single();

      if (!membro) {
        return NextResponse.json(
          { error: "Você não participa deste grupo" },
          { status: 403 }
        );
      }
    }

    const { data: rule, error } = await supabase
      .from("recurring_rules")
      .insert({
        user_id: user.id,
        category_id,
        account_id: account_id || null,
        group_id: group_id || null,
        description: description.trim(),
        amount: Math.abs(Number(amount)),
        transaction_type,
        frequency,
        interval_count: Number(interval_count) || 1,
        due_day: due_day ?? null,
        start_date,
        end_date: end_date || null,
        max_occurrences: max_occurrences ?? null,
        reminder_days: Number(reminder_days) || 0,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Erro ao criar gasto fixo:", error);
      return NextResponse.json(
        { error: "Não foi possível criar o gasto fixo" },
        { status: 500 }
      );
    }

    // Já deixa os próximos vencimentos na agenda: cadastrar um gasto fixo e não
    // ver nada na tela de contas previstas é o caminho mais curto para o
    // usuário achar que não salvou.
    let agenda = { criadas: 0, regras: 0 };
    try {
      agenda = await materializarAgenda(supabase, user.id);
    } catch (erroAgenda) {
      // A regra foi criada; falhar a resposta faria o usuário cadastrar de novo
      // e duplicar. A agenda é recalculável a qualquer momento.
      console.error("Regra criada, mas a agenda não foi materializada:", erroAgenda);
    }

    return NextResponse.json(
      {
        message: "Gasto fixo criado com sucesso",
        rule,
        scheduled_created: agenda.criadas,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Erro na API de gastos fixos:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
