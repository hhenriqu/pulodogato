import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();

    // Verificar autenticação
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body; // 'accept' ou 'reject'

    if (!["accept", "reject"].includes(action)) {
      return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
    }

    // Verificar se a solicitação existe e pertence ao usuário
    const { data: connection, error: fetchError } = await supabase
      .from("user_connections")
      .select("*")
      .eq("id", params.id)
      .eq("requested_id", user.id)
      .eq("status", "pending")
      .single();

    if (fetchError || !connection) {
      return NextResponse.json(
        { error: "Solicitação não encontrada" },
        { status: 404 }
      );
    }

    // Atualizar status da conexão
    const newStatus = action === "accept" ? "accepted" : "blocked";
    const { data, error } = await supabase
      .from("user_connections")
      .update({
        status: newStatus,
        responded_at: new Date().toISOString(),
      })
      .eq("id", params.id)
      .select()
      .single();

    if (error) {
      console.error("Error updating connection:", error);
      return NextResponse.json(
        { error: "Erro ao atualizar solicitação" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in request PUT:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
