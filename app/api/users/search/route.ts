import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");

    if (!query || query.length < 2) {
      return NextResponse.json(
        { error: "Query deve ter pelo menos 2 caracteres" },
        { status: 400 }
      );
    }

    // Buscar usuários públicos que permitem conexões
    const { data: users, error } = await supabase
      .from("profiles")
      .select(
        "id, full_name, nickname, avatar_url, bio, is_public, allow_connections"
      )
      .or(`full_name.ilike.%${query}%,nickname.ilike.%${query}%`)
      .eq("is_public", true)
      .eq("allow_connections", true)
      .neq("id", user.id)
      .limit(20);

    if (error) {
      console.error("Error searching users:", error);
      return NextResponse.json(
        { error: "Erro ao buscar usuários" },
        { status: 500 }
      );
    }

    // Filtrar usuários que já têm conexão
    const userIds = users?.map((u) => u.id) || [];
    if (userIds.length > 0) {
      const { data: connections } = await supabase
        .from("user_connections")
        .select("requester_id, requested_id")
        .or(
          userIds
            .map(
              (id) =>
                `and(requester_id.eq.${user.id},requested_id.eq.${id}),` +
                `and(requester_id.eq.${id},requested_id.eq.${user.id})`
            )
            .join(",")
        );

      const connectedUserIds = new Set();
      connections?.forEach((conn) => {
        if (conn.requester_id === user.id) {
          connectedUserIds.add(conn.requested_id);
        } else {
          connectedUserIds.add(conn.requester_id);
        }
      });

      const filteredUsers =
        users?.filter((u) => !connectedUserIds.has(u.id)) || [];
      return NextResponse.json(filteredUsers);
    }

    return NextResponse.json(users || []);
  } catch (error) {
    console.error("Error in users search GET:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
