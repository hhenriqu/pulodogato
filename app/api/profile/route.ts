import { createClient } from "@/utils/supabase/server";
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

    // Buscar perfil do usuário
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (error && error.code !== "PGRST116") {
      return NextResponse.json(
        { error: "Erro ao buscar perfil" },
        { status: 500 }
      );
    }

    // Se perfil não existe, criar um padrão
    if (!profile) {
      const defaultProfile = {
        id: user.id,
        full_name:
          user.user_metadata?.full_name || user.email?.split("@")[0] || "",
        nickname: "",
        phone: "",
        avatar_url: user.user_metadata?.avatar_url || "",
        bio: "",
        is_public: false,
        allow_connections: true,
        preferences: {
          currency: "BRL",
          timezone: "America/Sao_Paulo",
          notifications: {
            connection_requests: true,
            group_invites: true,
            dividends: true,
            price_alerts: false,
            portfolio_summary: true,
          },
          dashboard: {
            default_period: "1Y",
            show_percentage: true,
            chart_type: "line",
          },
          privacy: {
            show_portfolio_value: false,
            show_transactions: false,
            show_performance: false,
          },
        },
      };

      const { data: newProfile, error: createError } = await supabase
        .from("profiles")
        .insert(defaultProfile)
        .select()
        .single();

      if (createError) {
        return NextResponse.json(
          { error: "Erro ao criar perfil" },
          { status: 500 }
        );
      }

      return NextResponse.json(newProfile);
    }

    return NextResponse.json(profile);
  } catch (error) {
    console.error("Error in profile GET:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
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
    const {
      full_name,
      nickname,
      phone,
      bio,
      avatar_url,
      is_public,
      allow_connections,
      preferences,
    } = body;

    // Validações básicas
    if (!full_name || full_name.trim().length < 2) {
      return NextResponse.json(
        { error: "Nome completo deve ter pelo menos 2 caracteres" },
        { status: 400 }
      );
    }

    if (nickname && nickname.length > 50) {
      return NextResponse.json(
        { error: "Apelido deve ter no máximo 50 caracteres" },
        { status: 400 }
      );
    }

    if (bio && bio.length > 500) {
      return NextResponse.json(
        { error: "Biografia deve ter no máximo 500 caracteres" },
        { status: 400 }
      );
    }

    if (
      phone &&
      !/^\(\d{2}\)\s\d{4,5}-\d{4}$/.test(phone) &&
      phone.trim() !== ""
    ) {
      return NextResponse.json(
        { error: "Formato de telefone inválido. Use: (11) 99999-9999" },
        { status: 400 }
      );
    }

    // Verificar se nickname já existe (se fornecido)
    if (nickname && nickname.trim() !== "") {
      const { data: existingNickname } = await supabase
        .from("profiles")
        .select("id")
        .eq("nickname", nickname.trim())
        .neq("id", user.id)
        .single();

      if (existingNickname) {
        return NextResponse.json(
          { error: "Este apelido já está em uso" },
          { status: 400 }
        );
      }
    }

    // Atualizar perfil
    const { data, error } = await supabase
      .from("profiles")
      .update({
        full_name: full_name.trim(),
        nickname: nickname ? nickname.trim() : null,
        phone: phone ? phone.trim() : null,
        bio: bio ? bio.trim() : null,
        avatar_url,
        is_public: Boolean(is_public),
        allow_connections: Boolean(allow_connections),
        preferences,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id)
      .select()
      .single();

    if (error) {
      console.error("Error updating profile:", error);
      return NextResponse.json(
        { error: "Erro ao atualizar perfil" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in profile PUT:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
