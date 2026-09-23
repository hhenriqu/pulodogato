// GET  /api/goals?status=active   metas do usuario e dos grupos dele
// POST /api/goals                 cria uma meta
//
// A leitura sai de `goal_progress`, nao de `financial_goals`: o quanto ja foi
// juntado e a soma dos aportes, calculada na hora. Ver a SECAO 4 da migration
// 008 para o porque de nao ser coluna -- e para o porque de nao ser o saldo da
// conta.
//
// A RLS do 008 e quem filtra: o SELECT devolve as metas do proprio usuario
// mais as dos grupos de que ele participa. Nao repetimos o filtro aqui para
// nao ter duas versoes da mesma regra de acesso.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { isIsoDate } from "@/lib/recurrence";

const STATUS_VALIDOS = ["active", "completed", "paused", "cancelled"];

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
    const status = url.searchParams.get("status");
    const groupId = url.searchParams.get("groupId");

    let query = supabase.from("goal_progress").select("*");

    if (status && status !== "all") {
      if (!STATUS_VALIDOS.includes(status)) {
        return NextResponse.json(
          { error: `Status inválido. Use um de: ${STATUS_VALIDOS.join(", ")}` },
          { status: 400 }
        );
      }
      query = query.eq("status", status);
    }

    // `scope=personal` e o caso da tela de metas pessoais. Sem ele, a meta da
    // viagem apareceria misturada com a reserva de emergencia e o usuario
    // somaria mentalmente dinheiro que e do grupo.
    if (groupId) {
      query = query.eq("group_id", groupId);
    } else if (url.searchParams.get("scope") === "personal") {
      query = query.is("group_id", null);
    }

    const { data: goals, error } = await query.order("created_at", {
      ascending: false,
    });

    if (error) {
      console.error("Erro ao listar metas:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar as metas" },
        { status: 500 }
      );
    }

    // A view nao traz relacionamentos e o PostgREST nao infere FK atraves de
    // view -- mesma limitacao que budget_consumption enfrentou no 006. As
    // contas vinculadas vem numa segunda consulta.
    const contaIds = Array.from(
      new Set((goals ?? []).map((g) => g.account_id).filter(Boolean))
    );

    const { data: contas } = contaIds.length
      ? await supabase
          .from("financial_accounts")
          .select("id, name, account_type, color_hex")
          .in("id", contaIds)
      : { data: [] };

    const porId = new Map((contas ?? []).map((c) => [c.id, c]));

    return NextResponse.json({
      goals: (goals ?? []).map((g) => ({
        ...g,
        account: g.account_id ? porId.get(g.account_id) ?? null : null,
      })),
    });
  } catch (error) {
    console.error("Erro na API de metas:", error);
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
      title,
      description,
      target_amount,
      target_date,
      account_id,
      group_id,
      color_hex,
      icon,
    } = body;

    if (!title?.trim()) {
      return NextResponse.json(
        { error: "Título é obrigatório" },
        { status: 400 }
      );
    }

    if (!target_amount || Number(target_amount) <= 0) {
      return NextResponse.json(
        { error: "Valor da meta deve ser maior que zero" },
        { status: 400 }
      );
    }

    if (target_date && !isIsoDate(target_date)) {
      return NextResponse.json(
        { error: "Prazo deve estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    // Grupo so vale se o usuario for membro ativo. A RLS do 008 ja barraria o
    // INSERT, mas com uma mensagem de erro do Postgres; a checagem aqui existe
    // para o usuario ler "Você não participa deste grupo".
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

    // Conta vinculada tem que ser do proprio usuario: vincular a meta a conta
    // de outra pessoa nao vazaria saldo (o progresso vem dos aportes), mas
    // deixaria a tela mostrando o nome de uma conta que o dono nao reconhece.
    if (account_id) {
      const { data: conta } = await supabase
        .from("financial_accounts")
        .select("id")
        .eq("id", account_id)
        .eq("user_id", user.id)
        .single();

      if (!conta) {
        return NextResponse.json(
          { error: "Conta não encontrada" },
          { status: 404 }
        );
      }
    }

    const { data: goal, error } = await supabase
      .from("financial_goals")
      .insert({
        user_id: user.id,
        group_id: group_id || null,
        title: title.trim(),
        description: description?.trim() || null,
        // ABS porque o formulario aceita o que o usuario digitar: uma meta
        // negativa passaria no CHECK apenas se o sinal fosse invertido em
        // algum caminho, e o CHECK abortaria com erro do Postgres na cara do
        // usuario em vez de uma mensagem legivel.
        target_amount: Math.abs(Number(target_amount)),
        target_date: target_date || null,
        account_id: account_id || null,
        color_hex: color_hex || undefined,
        icon: icon || undefined,
      })
      .select()
      .single();

    if (error) {
      console.error("Erro ao criar meta:", error);
      return NextResponse.json(
        { error: "Não foi possível criar a meta" },
        { status: 500 }
      );
    }

    return NextResponse.json({ goal }, { status: 201 });
  } catch (error) {
    console.error("Erro na API de metas:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
