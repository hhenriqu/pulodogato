import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const supabase = createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = params;
    const body = await request.json();
    const { memberId, action } = body; // action: 'promote' | 'demote'

    // Verificar se o usuário é administrador do grupo
    const { data: currentUserMembership, error: membershipError } =
      await supabase
        .from("group_members")
        .select("role")
        .eq("group_id", groupId)
        .eq("user_id", user.id)
        .eq("status", "active")
        .single();

    if (
      membershipError ||
      !currentUserMembership ||
      currentUserMembership.role !== "admin"
    ) {
      return NextResponse.json(
        { error: "Apenas administradores podem alterar permissões" },
        { status: 403 }
      );
    }

    // Verificar se o membro alvo existe no grupo
    const { data: targetMember, error: targetError } = await supabase
      .from("group_members")
      .select("role, user:profiles!group_members_user_id_fkey(full_name)")
      .eq("group_id", groupId)
      .eq("user_id", memberId)
      .eq("status", "active")
      .single();

    if (targetError || !targetMember) {
      return NextResponse.json(
        { error: "Membro não encontrado no grupo" },
        { status: 404 }
      );
    }

    // Validar ação
    if (action === "promote" && targetMember.role === "admin") {
      return NextResponse.json(
        { error: "Este membro já é administrador" },
        { status: 400 }
      );
    }

    if (action === "demote" && targetMember.role !== "admin") {
      return NextResponse.json(
        { error: "Este membro não é administrador" },
        { status: 400 }
      );
    }

    // Se está rebaixando, verificar se não é o último admin
    if (action === "demote") {
      const { data: admins } = await supabase
        .from("group_members")
        .select("id")
        .eq("group_id", groupId)
        .eq("role", "admin")
        .eq("status", "active");

      if ((admins?.length || 0) <= 1) {
        return NextResponse.json(
          { error: "Deve haver pelo menos um administrador no grupo" },
          { status: 400 }
        );
      }
    }

    // Aplicar mudança
    const newRole = action === "promote" ? "admin" : "member";

    const { error: updateError } = await supabase
      .from("group_members")
      .update({
        role: newRole,
        role_updated_at: new Date().toISOString(),
        role_updated_by: user.id,
      })
      .eq("group_id", groupId)
      .eq("user_id", memberId);

    if (updateError) {
      console.error("Error updating member role:", updateError);
      return NextResponse.json(
        { error: "Erro ao alterar permissão do membro" },
        { status: 500 }
      );
    }

    const actionText =
      action === "promote" ? "promovido a administrador" : "rebaixado a membro";
    const memberName = targetMember.user?.full_name || "Membro";

    return NextResponse.json({
      success: true,
      message: `${memberName} foi ${actionText} com sucesso!`,
      member_id: memberId,
      new_role: newRole,
    });
  } catch (error) {
    console.error("Error in member role change:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
