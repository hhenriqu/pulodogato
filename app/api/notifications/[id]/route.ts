// PATCH /api/notifications/[id]   marca um aviso como lido
//
// A RLS do 009 so deixa o dono atualizar, e o unico campo que esta rota mexe e
// `read_at`. Nao ha caminho para o navegador CRIAR um aviso -- isso e do cron,
// com a service_role.

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

    const body = await request.json().catch(() => ({}));
    const lido = body?.read !== false;

    const { data, error } = await supabase
      .from("bill_notifications")
      .update({ read_at: lido ? new Date().toISOString() : null })
      .eq("id", params.id)
      .select()
      .maybeSingle();

    if (error) {
      console.error("Erro ao marcar aviso:", error);
      return NextResponse.json({ error: "Não foi possível marcar" }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Aviso não encontrado" }, { status: 404 });
    }

    return NextResponse.json({ notification: data });
  } catch (error) {
    console.error("Erro ao marcar aviso:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
