import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("🔍 DEBUG: Verificando grupos disponíveis para user:", user.id);

    // 1. Verificar se existem grupos na tabela
    const { data: allGroupsRaw, error: allGroupsError } = await supabase
      .from("expense_groups")
      .select("id, name, is_active, archived_at, created_by");

    console.log("📊 TODOS OS GRUPOS:", allGroupsRaw);

    // 2. Verificar grupos ativos
    const { data: activeGroups, error: activeError } = await supabase
      .from("expense_groups")
      .select("id, name, is_active, archived_at, created_by")
      .eq("is_active", true);

    console.log("✅ GRUPOS ATIVOS:", activeGroups);

    // 3. Verificar membros
    const { data: allMembers, error: membersError } = await supabase
      .from("group_members")
      .select("id, group_id, user_id, role, status");

    console.log("👥 TODOS OS MEMBROS:", allMembers);

    // 4. Verificar membros do usuário atual
    const { data: userMembers, error: userMembersError } = await supabase
      .from("group_members")
      .select("id, group_id, user_id, role, status")
      .eq("user_id", user.id);

    console.log("🎯 MEMBROS DO USUÁRIO:", userMembers);

    // 5. Verificar se as tabelas existem
    const { data: tablesCheck, error: tablesError } = await supabase
      .from("information_schema.tables")
      .select("table_name")
      .eq("table_schema", "public")
      .in("table_name", ["expense_groups", "group_members"]);

    console.log("🗃️ TABELAS EXISTENTES:", tablesCheck);

    return NextResponse.json({
      user_id: user.id,
      debug_info: {
        all_groups_count: allGroupsRaw?.length || 0,
        active_groups_count: activeGroups?.length || 0,
        all_members_count: allMembers?.length || 0,
        user_members_count: userMembers?.length || 0,
        tables_exist: tablesCheck?.map((t) => t.table_name) || [],
      },
      raw_data: {
        all_groups: allGroupsRaw,
        active_groups: activeGroups,
        user_members: userMembers,
        tables: tablesCheck,
      },
      errors: {
        all_groups_error: allGroupsError,
        active_error: activeError,
        members_error: membersError,
        user_members_error: userMembersError,
        tables_error: tablesError,
      },
    });
  } catch (error) {
    console.error("Debug API error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
