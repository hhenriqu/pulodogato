import { createClient } from "@/utils/supabase/server";
import { PUBLIC_PROFILE_FIELDS } from "@/lib/profile-fields";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
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

    // Buscar solicitações pendentes para o usuário
    const { data: requests, error } = await supabase
      .from("user_connections")
      .select(
        `
        *,
        requester:profiles!user_connections_requester_id_fkey(${PUBLIC_PROFILE_FIELDS})
      `
      )
      .eq("requested_id", user.id)
      .eq("status", "pending");

    if (error) {
      return NextResponse.json(
        { error: "Erro ao buscar solicitações" },
        { status: 500 }
      );
    }

    return NextResponse.json(requests || []);
  } catch (error) {
    console.error("Error in requests GET:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
