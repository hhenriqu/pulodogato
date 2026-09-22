import { createClient } from "@/utils/supabase/server";
import { PUBLIC_PROFILE_FIELDS } from "@/lib/profile-fields";
import { NextResponse } from "next/server";

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

    // Buscar conexões do usuário
    const { data: connections, error } = await supabase
      .from("user_connections")
      .select(
        `
        *,
        requester:profiles!user_connections_requester_id_fkey(${PUBLIC_PROFILE_FIELDS}),
        requested:profiles!user_connections_requested_id_fkey(${PUBLIC_PROFILE_FIELDS})
      `
      )
      .or(`requester_id.eq.${user.id},requested_id.eq.${user.id}`)
      .eq("status", "accepted");

    if (error) {
      return NextResponse.json(
        { error: "Erro ao buscar conexões" },
        { status: 500 }
      );
    }

    return NextResponse.json(connections || []);
  } catch (error) {
    console.error("Error in connections GET:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
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
    const { requested_id, message } = body;

    // Validações
    if (!requested_id) {
      return NextResponse.json(
        { error: "ID do usuário é obrigatório" },
        { status: 400 }
      );
    }

    if (requested_id === user.id) {
      return NextResponse.json(
        { error: "Não é possível se conectar com você mesmo" },
        { status: 400 }
      );
    }

    // Verificar se o usuário alvo existe e permite conexões
    const { data: targetProfile, error: profileError } = await supabase
      .from("profiles")
      .select("allow_connections")
      .eq("id", requested_id)
      .single();

    if (profileError || !targetProfile) {
      return NextResponse.json(
        { error: "Usuário não encontrado" },
        { status: 404 }
      );
    }

    if (!targetProfile.allow_connections) {
      return NextResponse.json(
        { error: "Este usuário não aceita conexões" },
        { status: 400 }
      );
    }

    // Verificar se já existe conexão
    const { data: existingConnection } = await supabase
      .from("user_connections")
      .select("*")
      .or(
        `and(requester_id.eq.${user.id},requested_id.eq.${requested_id}),` +
          `and(requester_id.eq.${requested_id},requested_id.eq.${user.id})`
      )
      .single();

    if (existingConnection) {
      return NextResponse.json(
        { error: "Conexão já existe entre estes usuários" },
        { status: 400 }
      );
    }

    // Criar solicitação de conexão
    const { data, error } = await supabase
      .from("user_connections")
      .insert({
        requester_id: user.id,
        requested_id,
        status: "pending",
        message: message || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating connection:", error);
      return NextResponse.json(
        { error: "Erro ao criar solicitação" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Error in connections POST:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
