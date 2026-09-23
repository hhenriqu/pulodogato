// POST   /api/goals/[id]/contributions             registra um aporte
// DELETE /api/goals/[id]/contributions?id=<uuid>    desfaz um aporte
//
// O aporte e sempre POSITIVO (CHECK do 008). Tirar dinheiro da meta se faz
// apagando o aporte, nao lancando um negativo: um negativo desapareceria na
// soma e o historico passaria a mentir sobre quanto cada um contribuiu -- o
// que numa meta de grupo e a unica coisa que a tela tem para mostrar.
//
// O aporte NAO mexe no saldo de conta nenhuma. Quem quiser ver o dinheiro sair
// da corrente e entrar na poupanca lanca a transferencia normalmente: sao
// fatos diferentes, pelo mesmo motivo que o acerto de grupo do 007 e um livro
// separado.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { isIsoDate, today } from "@/lib/recurrence";

export async function POST(
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
    const { amount, contributed_at, notes } = body;

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json(
        { error: "Valor do aporte deve ser maior que zero" },
        { status: 400 }
      );
    }

    if (contributed_at && !isIsoDate(contributed_at)) {
      return NextResponse.json(
        { error: "Data deve estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    // A meta tem que ser visivel para este usuario. A RLS do INSERT ja exige
    // isso, mas a checagem aqui distingue "meta que nao existe" de "meta de
    // outra pessoa" para a mensagem, e evita um erro cru do Postgres na tela.
    const { data: meta } = await supabase
      .from("financial_goals")
      .select("id")
      .eq("id", params.id)
      .single();

    if (!meta) {
      return NextResponse.json(
        { error: "Meta não encontrada" },
        { status: 404 }
      );
    }

    const { data: aporte, error } = await supabase
      .from("goal_contributions")
      .insert({
        goal_id: params.id,
        // Sempre o proprio usuario: numa meta de grupo, cada um aporta o seu.
        // A RLS exige o mesmo (WITH CHECK user_id = auth.uid()), entao aceitar
        // um user_id do corpo so criaria um caminho que falha mais tarde e com
        // mensagem pior.
        user_id: user.id,
        amount: Math.abs(Number(amount)),
        contributed_at: contributed_at || today(),
        notes: notes?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Erro ao registrar aporte:", error);
      return NextResponse.json(
        { error: "Não foi possível registrar o aporte" },
        { status: 500 }
      );
    }

    // Devolve o progresso ja recalculado: a tela precisa dele para mover a
    // barra, e uma segunda ida ao servidor deixaria a barra parada por um
    // instante depois do usuario confirmar.
    const { data: progresso } = await supabase
      .from("goal_progress")
      .select("*")
      .eq("id", params.id)
      .single();

    return NextResponse.json(
      { contribution: aporte, goal: progresso },
      { status: 201 }
    );
  } catch (error) {
    console.error("Erro na API de aportes:", error);
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

    const contributionId = new URL(request.url).searchParams.get("id");

    if (!contributionId) {
      return NextResponse.json(
        { error: "Informe qual aporte desfazer" },
        { status: 400 }
      );
    }

    const { data: apagado, error } = await supabase
      .from("goal_contributions")
      .delete()
      .eq("id", contributionId)
      .eq("goal_id", params.id)
      .select("id")
      .single();

    // A RLS deixa apagar so o proprio aporte, e filtra em silencio. Sem este
    // 404 a tela sumiria com o aporte de outro membro na interface local e ele
    // reapareceria no refresh seguinte.
    if (error || !apagado) {
      return NextResponse.json(
        { error: "Aporte não encontrado ou não é seu" },
        { status: 404 }
      );
    }

    const { data: progresso } = await supabase
      .from("goal_progress")
      .select("*")
      .eq("id", params.id)
      .single();

    return NextResponse.json({ ok: true, goal: progresso });
  } catch (error) {
    console.error("Erro na API de aportes:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
