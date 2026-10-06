import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Os dois embeds sao many-to-one (objeto) e podem vir NULOS -- e esse nulo que a
// nota abaixo trata: a escolha do lado sai de `requester_id`, nao do embed.
type PerfilDaConexao = {
  id: string;
  full_name: string | null;
  nickname: string | null;
  avatar_url: string | null;
} | null;

type Conexao = {
  requester_id: string;
  requested_id: string;
  requester: PerfilDaConexao;
  requested: PerfilDaConexao;
};

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Buscar conexões aceitas para divisão de gastos
    const { data: connections, error } = await supabase
      .from("user_connections")
      .select(
        `
        requester_id,
        requested_id,
        requester:profiles!user_connections_requester_id_fkey(id, full_name, nickname, avatar_url),
        requested:profiles!user_connections_requested_id_fkey(id, full_name, nickname, avatar_url)
      `
      )
      .or(`requester_id.eq.${user.id},requested_id.eq.${user.id}`)
      .eq("status", "accepted")
      .returns<Conexao[]>();

    if (error) {
      console.error("Database error:", error);
      return NextResponse.json(
        { error: "Failed to fetch connections" },
        { status: 500 }
      );
    }

    // Mapear as conexões para retornar o perfil do outro usuário
    const connectionsList =
      connections
        ?.map((conn) => {
          // Decidir por requester_id, e nao por `conn.requester?.id`: se o
          // embed do perfil vier nulo, a comparacao antiga escolhe justamente
          // o lado nulo e a pessoa some da lista de rateio em silencio.
          const profile =
            conn.requester_id === user.id ? conn.requested : conn.requester;
          return {
            id: profile?.id,
            full_name: profile?.full_name,
            nickname: profile?.nickname,
            avatar_url: profile?.avatar_url,
          };
        })
        .filter((profile) => profile.id) || [];

    return NextResponse.json({ connections: connectionsList });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
