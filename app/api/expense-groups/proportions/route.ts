import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = createClient();

  try {
    // Verificar autenticação
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const { group_id, calculation_month } = body;

    if (!group_id) {
      return NextResponse.json(
        { error: "ID do grupo é obrigatório" },
        { status: 400 }
      );
    }

    // Verificar se o usuário é membro do grupo
    const { data: membership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", group_id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!membership) {
      return NextResponse.json(
        { error: "Acesso negado ao grupo" },
        { status: 403 }
      );
    }

    // Definir mês de cálculo (padrão: mês atual)
    const targetMonth =
      calculation_month || new Date().toISOString().slice(0, 7) + "-01";

    // Chamar função do banco para calcular proporções
    const { data: proportions, error: calcError } = await supabase.rpc(
      "calculate_member_proportions",
      {
        p_group_id: group_id,
        p_calculation_month: targetMonth,
      }
    );

    if (calcError) {
      console.error("Error calculating proportions:", calcError);
      return NextResponse.json(
        { error: "Erro ao calcular proporções" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      calculation_month: targetMonth,
      proportions: proportions || [],
      total_members: proportions?.length || 0,
    });
  } catch (error) {
    console.error("Calculate proportions error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { searchParams } = new URL(request.url);
  const group_id = searchParams.get("group_id");
  const month = searchParams.get("month");

  try {
    // Verificar autenticação
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    if (!group_id) {
      return NextResponse.json(
        { error: "ID do grupo é obrigatório" },
        { status: 400 }
      );
    }

    // Verificar se o usuário é membro do grupo
    const { data: membership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", group_id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!membership) {
      return NextResponse.json(
        { error: "Acesso negado ao grupo" },
        { status: 403 }
      );
    }

    // Definir mês de consulta (padrão: mês atual)
    const targetMonth = month || new Date().toISOString().slice(0, 7) + "-01";

    // Buscar proporções existentes para o mês
    const { data: existingProportions, error: fetchError } = await supabase
      .from("group_member_proportions")
      .select(
        `
        id,
        member_id,
        total_income,
        proportion_percentage,
        calculated_at
      `
      )
      .eq("group_id", group_id)
      .eq("calculation_month", targetMonth)
      .eq("is_active", true)
      .order("proportion_percentage", { ascending: false });

    if (fetchError) {
      console.error("Error fetching proportions:", fetchError);
      return NextResponse.json(
        { error: "Erro ao buscar proporções" },
        { status: 500 }
      );
    }

    // Verificar se o usuário pode ver valores absolutos (apenas admins)
    const canViewAbsolute = membership.role === "admin";

    // Processar dados simplificados (frontend buscará detalhes dos membros separadamente)
    const processedProportions =
      existingProportions?.map((prop) => ({
        member_id: prop.member_id,
        proportion_percentage: prop.proportion_percentage,
        total_income: canViewAbsolute ? prop.total_income : null, // Apenas admin vê
        calculated_at: prop.calculated_at,
      })) || [];

    return NextResponse.json({
      group_id,
      calculation_month: targetMonth,
      can_view_absolute: canViewAbsolute,
      proportions: processedProportions,
      total_members: processedProportions.length,
      needs_recalculation: processedProportions.length === 0,
    });
  } catch (error) {
    console.error("Get proportions error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
