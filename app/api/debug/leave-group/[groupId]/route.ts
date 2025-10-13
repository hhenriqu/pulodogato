import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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

    console.log(
      "🔍 DEBUG LEAVE: Verificando condições para sair do grupo:",
      groupId
    );

    // 1. Verificar se o usuário é membro do grupo
    const { data: membership, error: membershipError } = await supabase
      .from("group_members")
      .select("*")
      .eq("group_id", groupId)
      .eq("user_id", user.id);

    console.log("👤 MEMBERSHIP:", membership);
    console.log("❌ MEMBERSHIP ERROR:", membershipError);

    // 2. Verificar todos os membros do grupo
    const { data: allMembers, error: allMembersError } = await supabase
      .from("group_members")
      .select("*")
      .eq("group_id", groupId);

    console.log("👥 ALL MEMBERS:", allMembers);
    console.log("❌ ALL MEMBERS ERROR:", allMembersError);

    // 3. Verificar se há transações pendentes
    const { data: pendingTransactions, error: pendingError } = await supabase
      .from("group_expense_splits")
      .select("id, status")
      .eq("group_id", groupId)
      .eq("status", "pending")
      .limit(5);

    console.log("⏳ PENDING TRANSACTIONS:", pendingTransactions);
    console.log("❌ PENDING ERROR:", pendingError);

    // 4. Verificar dados do grupo
    const { data: group, error: groupError } = await supabase
      .from("expense_groups")
      .select("*")
      .eq("id", groupId)
      .single();

    console.log("🏠 GROUP DATA:", group);
    console.log("❌ GROUP ERROR:", groupError);

    // 5. Verificar schema das tabelas
    const { data: membersSchema } = await supabase
      .from("information_schema.columns")
      .select("column_name, data_type")
      .eq("table_name", "group_members")
      .eq("table_schema", "public");

    console.log("🗃️ MEMBERS SCHEMA:", membersSchema);

    // Análise das condições
    const activeMembership = membership?.find((m) => m.status === "active");
    const activeMembers =
      allMembers?.filter((m) => m.status === "active") || [];
    const totalActiveMembers = activeMembers.length;
    const isUserAdmin = activeMembership?.role === "admin";
    const adminCount = activeMembers.filter((m) => m.role === "admin").length;
    const isOnlyAdmin = isUserAdmin && adminCount === 1;

    const analysis = {
      user_id: user.id,
      group_id: groupId,
      is_member: !!activeMembership,
      user_role: activeMembership?.role || "none",
      total_active_members: totalActiveMembers,
      admin_count: adminCount,
      is_user_admin: isUserAdmin,
      is_only_admin: isOnlyAdmin,
      pending_transactions_count: pendingTransactions?.length || 0,
      can_leave: false,
      action_required: "none",
    };

    // Determinar se pode sair
    if (!activeMembership) {
      analysis.action_required = "not_member";
    } else if (pendingTransactions && pendingTransactions.length > 0) {
      analysis.action_required = "has_pending_transactions";
    } else if (totalActiveMembers === 1) {
      analysis.can_leave = true;
      analysis.action_required = "archive_group";
    } else if (isOnlyAdmin) {
      analysis.action_required = "promote_another_admin";
    } else {
      analysis.can_leave = true;
      analysis.action_required = "leave_normally";
    }

    return NextResponse.json({
      debug_info: analysis,
      raw_data: {
        membership,
        all_members: allMembers,
        pending_transactions: pendingTransactions,
        group,
        members_schema: membersSchema,
      },
      errors: {
        membership_error: membershipError,
        all_members_error: allMembersError,
        pending_error: pendingError,
        group_error: groupError,
      },
    });
  } catch (error) {
    console.error("Debug leave error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
