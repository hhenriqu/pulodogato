// PATCH  /api/budgets/{id}   ajusta o teto, o alerta ou o carry_forward
// DELETE /api/budgets/{id}   remove o teto
//
// O que NAO se edita: `month` e `category_id`. Mudar qualquer um dos dois
// transformaria este teto no teto de outra coisa e levaria junto o historico
// de julgamento ("voce estourou o mercado em agosto" viraria outra frase).
// Para isso o caminho e apagar e criar.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
    const patch: Record<string, unknown> = {};

    if (body.amount_limit !== undefined) {
      const valor = Number(body.amount_limit);
      if (!Number.isFinite(valor) || valor <= 0) {
        return NextResponse.json(
          { error: "O teto do orçamento deve ser maior que zero" },
          { status: 400 }
        );
      }
      patch.amount_limit = valor;
    }

    if (body.alert_threshold !== undefined) {
      const limiar = Number(body.alert_threshold);
      if (!Number.isFinite(limiar) || limiar <= 0 || limiar > 1) {
        return NextResponse.json(
          { error: "O alerta deve ser uma fração entre 0 e 1 (0.8 = 80%)" },
          { status: 400 }
        );
      }
      patch.alert_threshold = limiar;
    }

    if (body.carry_forward !== undefined) {
      patch.carry_forward = Boolean(body.carry_forward);
    }

    if (body.notes !== undefined) {
      patch.notes = body.notes || null;
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json(
        { error: "Nada para alterar" },
        { status: 400 }
      );
    }

    // O .eq("user_id") e redundante com a policy de UPDATE do 006, e fica de
    // proposito: sem ele, um id de outro usuario retornaria "0 linhas
    // alteradas" -- que sob RLS e indistinguivel de "id nao existe". Com ele,
    // a intencao esta explicita no codigo.
    const { data: budget, error } = await supabase
      .from("budgets")
      .update(patch)
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select("*, category:transaction_categories(*)")
      .maybeSingle();

    if (error) {
      console.error("Erro ao atualizar orçamento:", error);
      return NextResponse.json(
        { error: "Não foi possível atualizar o orçamento" },
        { status: 500 }
      );
    }

    if (!budget) {
      return NextResponse.json(
        { error: "Orçamento não encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json({ budget });
  } catch (error) {
    console.error("Erro na API de orçamentos:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { data: apagado, error } = await supabase
      .from("budgets")
      .delete()
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Erro ao remover orçamento:", error);
      return NextResponse.json(
        { error: "Não foi possível remover o orçamento" },
        { status: 500 }
      );
    }

    if (!apagado) {
      return NextResponse.json(
        { error: "Orçamento não encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro na API de orçamentos:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
