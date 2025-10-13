import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Restaurar grupo arquivado
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

    // Verificar se o usuário era admin do grupo arquivado
    const { data: membership, error: membershipError } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "archived")
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: "Grupo não encontrado ou acesso negado" },
        { status: 404 }
      );
    }

    if (membership.role !== "admin") {
      return NextResponse.json(
        { error: "Apenas administradores podem restaurar grupos" },
        { status: 403 }
      );
    }

    // Verificar se o grupo está realmente arquivado
    const { data: group, error: groupError } = await supabase
      .from("expense_groups")
      .select("is_active, name")
      .eq("id", groupId)
      .single();

    if (groupError || !group) {
      return NextResponse.json(
        { error: "Grupo não encontrado" },
        { status: 404 }
      );
    }

    if (group.is_active) {
      return NextResponse.json(
        { error: "Este grupo já está ativo" },
        { status: 400 }
      );
    }

    // Restaurar o grupo
    const { error: restoreError } = await supabase
      .from("expense_groups")
      .update({
        is_active: true,
        archived_at: null,
        archived_by: null,
        restored_at: new Date().toISOString(),
        restored_by: user.id,
      })
      .eq("id", groupId);

    if (restoreError) {
      console.error("Error restoring group:", restoreError);
      return NextResponse.json(
        { error: "Erro ao restaurar grupo" },
        { status: 500 }
      );
    }

    // Restaurar membros do grupo
    const { error: membersRestoreError } = await supabase
      .from("group_members")
      .update({
        status: "active",
        archived_at: null,
        restored_at: new Date().toISOString(),
      })
      .eq("group_id", groupId)
      .eq("status", "archived");

    if (membersRestoreError) {
      console.error("Error restoring members:", membersRestoreError);
      // Não falhar se não conseguir restaurar membros
    }

    return NextResponse.json({
      success: true,
      message: `Grupo "${group.name}" restaurado com sucesso!`,
      restored_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error restoring group:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
