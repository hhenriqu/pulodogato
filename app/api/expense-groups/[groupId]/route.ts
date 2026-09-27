import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { divisaoPendenteDoGrupo } from "@/lib/services/expense-groups";

export const dynamic = "force-dynamic";

export async function GET(
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

    console.log("Getting group details for:", groupId);

    // Get group details
    const { data: group, error: groupError } = await supabase
      .from("expense_groups")
      .select(
        `
        id,
        name,
        description,
        group_code,
        group_type,
        default_split_type,
        photo_url,
        created_at,
        creator:profiles!expense_groups_created_by_fkey (
          full_name,
          avatar_url
        )
      `
      )
      .eq("id", groupId)
      .single();

    if (groupError || !group) {
      console.error("Group error:", groupError);
      return NextResponse.json(
        { error: "Grupo não encontrado" },
        { status: 404 }
      );
    }

    // Get group members
    const { data: members, error: membersError } = await supabase
      .from("group_members")
      .select(
        `
        id,
        role,
        status,
        percentage,
        user:profiles!group_members_user_id_fkey (
          id,
          full_name,
          avatar_url
        )
      `
      )
      .eq("group_id", groupId)
      .eq("status", "active");

    if (membersError) {
      console.error("Members error:", membersError);
    }

    // Check if user is member of this group
    const userIsMember = members?.some(
      (member: any) => member.user?.id === user.id
    );
    if (!userIsMember) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const groupWithMembers = {
      ...group,
      members: members || [],
    };

    console.log("Group loaded successfully:", groupWithMembers.name);

    return NextResponse.json({
      success: true,
      group: groupWithMembers,
    });
  } catch (error) {
    console.error("Error in group detail API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Arquivar grupo (em vez de deletar)
export async function DELETE(
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

    // Verificar se o usuário é admin do grupo
    const { data: membership, error: membershipError } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: "Grupo não encontrado ou acesso negado" },
        { status: 404 }
      );
    }

    if (membership.role !== "admin") {
      return NextResponse.json(
        { error: "Apenas administradores podem arquivar grupos" },
        { status: 403 }
      );
    }

    // Verificar se há transações pendentes. Ver lib/services/expense-groups.ts:
    // "não deu para saber" recusa igual a "há", porque arquivar o grupo apaga o
    // registro de quem devia a quem e isso não tem volta.
    const pendencia = await divisaoPendenteDoGrupo(supabase, groupId);

    if (pendencia.situacao === "nao-deu-para-saber") {
      console.error("Não deu para verificar as divisões pendentes:", pendencia.erro);
      return NextResponse.json(
        {
          error:
            "Não foi possível verificar se há divisões pendentes no grupo. Tente de novo em instantes.",
        },
        { status: 503 }
      );
    }

    if (pendencia.situacao === "ha") {
      return NextResponse.json(
        {
          error:
            "Não é possível arquivar grupos com transações pendentes. Finalize todas as divisões primeiro.",
        },
        { status: 400 }
      );
    }

    // Tentar arquivar o grupo - primeiro verificar quais campos existem
    const { data: existingGroup } = await supabase
      .from("expense_groups")
      .select("*")
      .eq("id", groupId)
      .single();

    console.log(
      "🔍 Campos disponíveis no grupo:",
      Object.keys(existingGroup || {})
    );

    // Preparar update baseado nos campos disponíveis
    let updateData: any = {};

    // Se tem is_active, usar
    if (existingGroup && "is_active" in existingGroup) {
      updateData.is_active = false;
    }

    // Se tem archived_at, usar
    if (existingGroup && "archived_at" in existingGroup) {
      updateData.archived_at = new Date().toISOString();
    }

    // Se tem archived_by, usar
    if (existingGroup && "archived_by" in existingGroup) {
      updateData.archived_by = user.id;
    }

    // Se não tem campos de arquivamento, usar uma abordagem alternativa
    if (Object.keys(updateData).length === 0) {
      // Adicionar um campo de metadata para marcar como arquivado
      updateData = {
        description: (existingGroup?.description || "") + " [ARQUIVADO]",
        // Ou usar um campo JSON se disponível
        ...(existingGroup && "metadata" in existingGroup
          ? {
              metadata: {
                ...(existingGroup.metadata || {}),
                archived: true,
                archived_at: new Date().toISOString(),
                archived_by: user.id,
              },
            }
          : {}),
      };
    }

    const { error: archiveError } = await supabase
      .from("expense_groups")
      .update(updateData)
      .eq("id", groupId);

    if (archiveError) {
      console.error("Error archiving group:", archiveError);
      return NextResponse.json(
        { error: `Erro ao arquivar grupo: ${archiveError.message}` },
        { status: 500 }
      );
    }

    // Tentar arquivar membros - verificar se a tabela suporta
    const { data: existingMember } = await supabase
      .from("group_members")
      .select("*")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .single();

    console.log(
      "🔍 Campos disponíveis no membro:",
      Object.keys(existingMember || {})
    );

    if (existingMember && "status" in existingMember) {
      const { error: membersArchiveError } = await supabase
        .from("group_members")
        .update({
          status: "archived",
          ...(existingMember && "archived_at" in existingMember
            ? {
                archived_at: new Date().toISOString(),
              }
            : {}),
        })
        .eq("group_id", groupId)
        .eq("status", "active");

      if (membersArchiveError) {
        console.error("Error archiving members:", membersArchiveError);
        // Não falhar se não conseguir arquivar membros
      }
    }

    return NextResponse.json({
      success: true,
      message:
        "Grupo arquivado com sucesso. O histórico de transações foi preservado.",
      archived_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error archiving group:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
