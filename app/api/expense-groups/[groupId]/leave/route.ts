import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { divisaoPendenteDoGrupo } from "@/lib/services/expense-groups";

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

    // 1. Verificar se o usuário é membro do grupo
    const { data: membership, error: membershipError } = await supabase
      .from("group_members")
      .select("role, status")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: "Você não é membro deste grupo" },
        { status: 404 }
      );
    }

    // 2. Verificar quantos membros ativos restam no grupo
    const { data: allMembers, error: allMembersError } = await supabase
      .from("group_members")
      .select("id, role, user_id")
      .eq("group_id", groupId)
      .eq("status", "active");

    if (allMembersError) {
      console.error("Error checking members:", allMembersError);
      return NextResponse.json(
        { error: "Erro ao verificar membros do grupo" },
        { status: 500 }
      );
    }

    const totalMembers = allMembers?.length || 0;
    const isUserAdmin = membership.role === "admin";
    const adminCount =
      allMembers?.filter((m) => m.role === "admin").length || 0;
    const isOnlyAdmin = isUserAdmin && adminCount === 1;

    console.log("🔍 Análise de saída:", {
      totalMembers,
      isUserAdmin,
      adminCount,
      isOnlyAdmin,
    });

    // 3. Decidir a ação baseada no contexto
    if (totalMembers === 1) {
      // Se é o único membro, arquivar o grupo
      return await archiveEmptyGroup(supabase, groupId, user.id);
    } else if (isOnlyAdmin && totalMembers > 1) {
      // Se é o único admin e há outros membros, não pode sair
      return NextResponse.json(
        {
          error:
            "Você é o único administrador. Promova outro membro a administrador antes de sair ou arquive o grupo.",
          action_required: "promote_admin_or_archive",
        },
        { status: 400 }
      );
    } else {
      // Pode sair normalmente (há outros membros e outros admins ou não é admin)
      return await removeUserFromGroup(supabase, groupId, user.id);
    }
  } catch (error) {
    console.error("Error in leave group:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Função para arquivar grupo vazio
async function archiveEmptyGroup(
  supabase: any,
  groupId: string,
  userId: string
) {
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
          "Não é possível sair. Há transações pendentes no grupo. Finalize todas as divisões primeiro.",
      },
      { status: 400 }
    );
  }

  // Obter dados do grupo para log
  const { data: group } = await supabase
    .from("expense_groups")
    .select("name")
    .eq("id", groupId)
    .single();

  // Arquivar o grupo
  const updateData: any = {};

  // Detectar campos disponíveis
  const { data: existingGroup } = await supabase
    .from("expense_groups")
    .select("*")
    .eq("id", groupId)
    .single();

  if (existingGroup && "is_active" in existingGroup) {
    updateData.is_active = false;
  }

  if (existingGroup && "archived_at" in existingGroup) {
    updateData.archived_at = new Date().toISOString();
  }

  if (existingGroup && "archived_by" in existingGroup) {
    updateData.archived_by = userId;
  }

  // Se não tem campos de arquivamento, usar alternativa
  if (Object.keys(updateData).length === 0) {
    updateData.description =
      (existingGroup?.description || "") + " [ARQUIVADO - ÚLTIMO MEMBRO SAIU]";
  }

  const { error: archiveError } = await supabase
    .from("expense_groups")
    .update(updateData)
    .eq("id", groupId);

  if (archiveError) {
    console.error("Error archiving group:", archiveError);
    return NextResponse.json(
      { error: "Erro ao arquivar grupo" },
      { status: 500 }
    );
  }

  // Arquivar membros
  const { error: membersError } = await supabase
    .from("group_members")
    .update({
      status: "archived",
      ...(existingGroup && "archived_at" in existingGroup
        ? {
            archived_at: new Date().toISOString(),
          }
        : {}),
    })
    .eq("group_id", groupId)
    .eq("status", "active");

  if (membersError) {
    console.error("Error archiving members:", membersError);
  }

  return NextResponse.json({
    success: true,
    action: "group_archived",
    message: `Grupo "${
      group?.name || "N/A"
    }" foi arquivado pois você era o último membro.`,
  });
}

// Função para remover usuário do grupo
async function removeUserFromGroup(
  supabase: any,
  groupId: string,
  userId: string
) {
  // Strategy 1: Try to discover valid status enum values first
  let validStatusValues: string[] = [];

  try {
    // Attempt to get enum values from database
    const { data: enumData } = await supabase.rpc("get_enum_values", {
      enum_name: "group_member_status",
    });

    if (enumData) {
      validStatusValues = enumData;
      console.log("🎯 Found valid status values:", validStatusValues);
    }
  } catch (enumError) {
    console.log("ℹ️ Could not fetch enum values, will try common values");
  }

  // Verificar que campos existem na tabela
  const { data: existingMember } = await supabase
    .from("group_members")
    .select("*")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .single();

  console.log(
    "🔍 Campos disponíveis no membro:",
    Object.keys(existingMember || {})
  );

  // Strategy 2: Try update with status field if it exists
  if (existingMember && "status" in existingMember) {
    // Determine the best status value to use
    const statusOptions =
      validStatusValues.length > 0
        ? validStatusValues
        : ["inactive", "removed", "pending"]; // Use only known-valid values

    for (const statusValue of statusOptions) {
      const updateData: any = { status: statusValue };

      // Add left_at if field exists
      if ("left_at" in existingMember) {
        updateData.left_at = new Date().toISOString();
      }

      console.log(`🔄 Trying to update with status: "${statusValue}"`);

      const { error: updateError } = await supabase
        .from("group_members")
        .update(updateData)
        .eq("group_id", groupId)
        .eq("user_id", userId);

      if (!updateError) {
        console.log(`✅ Successfully updated with status: "${statusValue}"`);
        return NextResponse.json({
          success: true,
          action: "user_left",
          message: "Você saiu do grupo com sucesso!",
        });
      } else {
        console.log(
          `❌ Failed with status "${statusValue}":`,
          updateError.message
        );
      }
    }
  }

  // Strategy 3: Try update with only left_at field
  if (existingMember && "left_at" in existingMember) {
    console.log("🔄 Trying to update with only left_at field");

    const { error: leftAtError } = await supabase
      .from("group_members")
      .update({ left_at: new Date().toISOString() })
      .eq("group_id", groupId)
      .eq("user_id", userId);

    if (!leftAtError) {
      console.log("✅ Successfully updated with left_at");
      return NextResponse.json({
        success: true,
        action: "user_left",
        message: "Você saiu do grupo com sucesso!",
      });
    } else {
      console.log("❌ Failed to update with left_at:", leftAtError.message);
    }
  }

  // Strategy 4: Fallback to deletion
  console.log("🔄 Falling back to member deletion");

  const { error: deleteError } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);

  if (deleteError) {
    console.error("❌ Error deleting member:", deleteError);
    return NextResponse.json(
      { error: `Erro ao sair do grupo: ${deleteError.message}` },
      { status: 500 }
    );
  }

  console.log("✅ Successfully removed member via deletion");
  return NextResponse.json({
    success: true,
    action: "user_left",
    message: "Você saiu do grupo com sucesso!",
  });
}
