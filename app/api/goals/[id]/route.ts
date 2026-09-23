// GET    /api/goals/[id]   uma meta, com o historico de aportes
// PATCH  /api/goals/[id]   edita (so quem criou -- ver a RLS do 008)
// DELETE /api/goals/[id]   apaga a meta E os aportes (ON DELETE CASCADE)

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { isIsoDate } from "@/lib/recurrence";

const STATUS_VALIDOS = ["active", "completed", "paused", "cancelled"];

export async function GET(
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

    const { data: goal, error } = await supabase
      .from("goal_progress")
      .select("*")
      .eq("id", params.id)
      .single();

    if (error || !goal) {
      return NextResponse.json(
        { error: "Meta não encontrada" },
        { status: 404 }
      );
    }

    const { data: aportes } = await supabase
      .from("goal_contributions")
      .select("*")
      .eq("goal_id", params.id)
      .order("contributed_at", { ascending: false });

    // Numa meta de grupo, "quem aportou" e a informacao que faz a meta
    // coletiva funcionar. Os nomes vem de profiles numa segunda consulta:
    // goal_contributions aponta para auth.users, que o PostgREST nao expoe.
    const userIds = Array.from(
      new Set((aportes ?? []).map((a) => a.user_id))
    );

    const { data: perfis } = userIds.length
      ? await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", userIds)
      : { data: [] };

    const porId = new Map((perfis ?? []).map((p) => [p.id, p]));

    return NextResponse.json({
      goal,
      contributions: (aportes ?? []).map((a) => ({
        ...a,
        user: porId.get(a.user_id) ?? null,
        is_mine: a.user_id === user.id,
      })),
    });
  } catch (error) {
    console.error("Erro na API de metas:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

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

    if (body.title !== undefined) {
      if (!body.title?.trim()) {
        return NextResponse.json(
          { error: "Título é obrigatório" },
          { status: 400 }
        );
      }
      patch.title = body.title.trim();
    }

    if (body.description !== undefined) {
      patch.description = body.description?.trim() || null;
    }

    if (body.target_amount !== undefined) {
      if (!body.target_amount || Number(body.target_amount) <= 0) {
        return NextResponse.json(
          { error: "Valor da meta deve ser maior que zero" },
          { status: 400 }
        );
      }
      patch.target_amount = Math.abs(Number(body.target_amount));
    }

    if (body.target_date !== undefined) {
      if (body.target_date && !isIsoDate(body.target_date)) {
        return NextResponse.json(
          { error: "Prazo deve estar no formato AAAA-MM-DD" },
          { status: 400 }
        );
      }
      patch.target_date = body.target_date || null;
    }

    if (body.status !== undefined) {
      if (!STATUS_VALIDOS.includes(body.status)) {
        return NextResponse.json(
          { error: `Status inválido. Use um de: ${STATUS_VALIDOS.join(", ")}` },
          { status: 400 }
        );
      }
      patch.status = body.status;
    }

    if (body.account_id !== undefined) {
      if (body.account_id) {
        const { data: conta } = await supabase
          .from("financial_accounts")
          .select("id")
          .eq("id", body.account_id)
          .eq("user_id", user.id)
          .single();

        if (!conta) {
          return NextResponse.json(
            { error: "Conta não encontrada" },
            { status: 404 }
          );
        }
      }
      patch.account_id = body.account_id || null;
    }

    if (body.color_hex !== undefined) patch.color_hex = body.color_hex;
    if (body.icon !== undefined) patch.icon = body.icon;

    if (!Object.keys(patch).length) {
      return NextResponse.json(
        { error: "Nada para atualizar" },
        { status: 400 }
      );
    }

    const { data: goal, error } = await supabase
      .from("financial_goals")
      .update(patch)
      .eq("id", params.id)
      .select()
      .single();

    // A RLS deixa editar so quem criou, e ela filtra em SILENCIO: o UPDATE
    // "funciona" sem pegar nenhuma linha. Sem este 404 a tela diria "meta
    // atualizada" depois de um UPDATE que nao mudou nada -- num numero que o
    // usuario acha que ajustou.
    if (error || !goal) {
      return NextResponse.json(
        { error: "Meta não encontrada ou você não pode editá-la" },
        { status: 404 }
      );
    }

    return NextResponse.json({ goal });
  } catch (error) {
    console.error("Erro na API de metas:", error);
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

    const { data: apagada, error } = await supabase
      .from("financial_goals")
      .delete()
      .eq("id", params.id)
      .select("id")
      .single();

    // Mesmo motivo do PATCH: sem o .select() a RLS filtraria em silencio e a
    // tela removeria o card de uma meta que continua no banco -- ela voltaria
    // no proximo refresh, sem explicacao.
    if (error || !apagada) {
      return NextResponse.json(
        { error: "Meta não encontrada ou você não pode apagá-la" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erro na API de metas:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
