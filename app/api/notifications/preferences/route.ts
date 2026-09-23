// GET /api/notifications/preferences   quantos dias antes avisar
// PUT /api/notifications/preferences   muda
//
// Quem nunca salvou nada nao tem linha na tabela, e isso e normal: o default de
// 3 dias e aplicado por COALESCE dentro de bill_alerts (009). O GET aqui
// devolve o mesmo default para a tela nao mostrar campo vazio.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const PADRAO = {
  days_before: 3,
  notify_due_soon: true,
  notify_overdue: true,
};

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

    const { data } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    return NextResponse.json({
      preferences: data ?? { user_id: user.id, ...PADRAO },
      // A tela precisa saber se o push esta configurado no servidor para nao
      // oferecer um botao "Ativar avisos" que nunca entregaria nada.
      push_available: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
      vapid_public_key: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
    });
  } catch (error) {
    console.error("Erro ao ler preferências:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
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
    const dias = body?.days_before;

    if (dias != null && (!Number.isInteger(dias) || dias < 0 || dias > 30)) {
      return NextResponse.json(
        { error: "Avise entre 0 e 30 dias antes do vencimento" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("notification_preferences")
      .upsert(
        {
          user_id: user.id,
          days_before: dias ?? PADRAO.days_before,
          notify_due_soon: body?.notify_due_soon ?? PADRAO.notify_due_soon,
          notify_overdue: body?.notify_overdue ?? PADRAO.notify_overdue,
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (error) {
      console.error("Erro ao salvar preferências:", error);
      return NextResponse.json(
        { error: "Não foi possível salvar" },
        { status: 500 }
      );
    }

    return NextResponse.json({ preferences: data });
  } catch (error) {
    console.error("Erro ao salvar preferências:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
