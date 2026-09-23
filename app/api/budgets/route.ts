// GET  /api/budgets?month=YYYY-MM   tetos do mes, com o consumido de cada um
// POST /api/budgets                 cria um teto
//
// A leitura sai de `budget_consumption`, nao de `budgets`: o consumido e
// calculado na hora, sobre financial_transactions. Ver a SECAO 5 da migration
// 006 para o porque de nao ser coluna.
//
// A RLS do 006 e quem filtra: o SELECT devolve os tetos do proprio usuario
// mais os dos grupos de que ele participa. Nao repetimos o filtro aqui para
// nao ter duas versoes da mesma regra de acesso.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { primeiroDiaDoMes, mesCorrente } from "@/lib/services/budget";

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
    const mesParam = url.searchParams.get("month");
    const mes = mesParam ? primeiroDiaDoMes(mesParam) : mesCorrente();

    if (!mes) {
      return NextResponse.json(
        { error: "Mês deve estar no formato AAAA-MM" },
        { status: 400 }
      );
    }

    const { data: budgets, error } = await supabase
      .from("budget_consumption")
      .select("*")
      .eq("month", mes)
      .order("amount_limit", { ascending: false });

    if (error) {
      console.error("Erro ao listar orçamentos:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar os orçamentos" },
        { status: 500 }
      );
    }

    // A view nao traz os relacionamentos; buscamos as categorias em uma
    // segunda consulta em vez de embutir o join, porque budget_consumption e
    // uma view e o PostgREST nao infere FK atraves dela.
    const categoriaIds = Array.from(
      new Set((budgets ?? []).map((b) => b.category_id))
    );

    const { data: categorias } = categoriaIds.length
      ? await supabase
          .from("transaction_categories")
          .select("*")
          .in("id", categoriaIds)
      : { data: [] };

    const porId = new Map((categorias ?? []).map((c) => [c.id, c]));

    const comCategoria = (budgets ?? []).map((b) => ({
      ...b,
      category: porId.get(b.category_id) ?? null,
    }));

    const totalLimite = comCategoria.reduce(
      (soma, b) => soma + Number(b.amount_limit),
      0
    );
    const totalGasto = comCategoria.reduce((soma, b) => soma + Number(b.spent), 0);

    return NextResponse.json({
      month: mes,
      budgets: comCategoria,
      summary: {
        total_limit: totalLimite,
        total_spent: totalGasto,
        total_remaining: totalLimite - totalGasto,
        count_alert: comCategoria.filter((b) => b.consumption_status === "alert")
          .length,
        count_exceeded: comCategoria.filter(
          (b) => b.consumption_status === "exceeded"
        ).length,
      },
    });
  } catch (error) {
    console.error("Erro na API de orçamentos:", error);
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
      category_id,
      amount_limit,
      month,
      group_id,
      alert_threshold = 0.8,
      carry_forward = true,
      notes,
    } = body;

    if (!category_id) {
      return NextResponse.json(
        { error: "Categoria é obrigatória" },
        { status: 400 }
      );
    }

    const valor = Number(amount_limit);
    if (!Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json(
        { error: "O teto do orçamento deve ser maior que zero" },
        { status: 400 }
      );
    }

    const mes = month ? primeiroDiaDoMes(month) : mesCorrente();
    if (!mes) {
      return NextResponse.json(
        { error: "Mês deve estar no formato AAAA-MM" },
        { status: 400 }
      );
    }

    const limiar = Number(alert_threshold);
    if (!Number.isFinite(limiar) || limiar <= 0 || limiar > 1) {
      return NextResponse.json(
        { error: "O alerta deve ser uma fração entre 0 e 1 (0.8 = 80%)" },
        { status: 400 }
      );
    }

    const { data: budget, error } = await supabase
      .from("budgets")
      .insert({
        user_id: user.id,
        category_id,
        group_id: group_id || null,
        month: mes,
        amount_limit: valor,
        alert_threshold: limiar,
        carry_forward: Boolean(carry_forward),
        notes: notes || null,
      })
      .select("*, category:transaction_categories(*)")
      .single();

    if (error) {
      // 23505: ja existe teto para esta categoria neste mes. E o caso comum de
      // quem clica duas vezes, e merece uma mensagem propria em vez de 500.
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Já existe um orçamento para esta categoria neste mês" },
          { status: 409 }
        );
      }
      console.error("Erro ao criar orçamento:", error);
      return NextResponse.json(
        { error: "Não foi possível criar o orçamento" },
        { status: 500 }
      );
    }

    return NextResponse.json({ budget }, { status: 201 });
  } catch (error) {
    console.error("Erro na API de orçamentos:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
