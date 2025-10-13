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

    console.log("🔍 DEBUG: Verificando grupo para arquivamento:", groupId);

    // 1. Verificar se o grupo existe
    const { data: group, error: groupError } = await supabase
      .from("expense_groups")
      .select("*")
      .eq("id", groupId)
      .single();

    console.log("📊 GRUPO ENCONTRADO:", group);
    console.log("❌ ERRO DO GRUPO:", groupError);

    // 2. Verificar schema da tabela expense_groups
    const { data: groupSchema, error: schemaError } = await supabase
      .from("information_schema.columns")
      .select("column_name, data_type, is_nullable")
      .eq("table_name", "expense_groups")
      .eq("table_schema", "public");

    console.log("🗃️ SCHEMA EXPENSE_GROUPS:", groupSchema);

    // 3. Verificar membros do usuário neste grupo
    const { data: membership, error: membershipError } = await supabase
      .from("group_members")
      .select("*")
      .eq("group_id", groupId)
      .eq("user_id", user.id);

    console.log("👥 MEMBERSHIP:", membership);
    console.log("❌ MEMBERSHIP ERROR:", membershipError);

    // 4. Verificar schema da tabela group_members
    const { data: membersSchema, error: membersSchemaError } = await supabase
      .from("information_schema.columns")
      .select("column_name, data_type, is_nullable")
      .eq("table_name", "group_members")
      .eq("table_schema", "public");

    console.log("🗃️ SCHEMA GROUP_MEMBERS:", membersSchema);

    // 5. Verificar transações pendentes (se a tabela existir)
    const { data: pendingTransactions, error: pendingError } = await supabase
      .from("group_expense_splits")
      .select("id, status")
      .eq("group_id", groupId)
      .eq("status", "pending")
      .limit(5);

    console.log("⏳ TRANSAÇÕES PENDENTES:", pendingTransactions);
    console.log("❌ PENDING ERROR:", pendingError);

    return NextResponse.json({
      group_id: groupId,
      user_id: user.id,
      debug_info: {
        group_exists: !!group,
        group_data: group,
        membership_exists: !!membership,
        membership_data: membership,
        pending_transactions_count: pendingTransactions?.length || 0,
        pending_transactions: pendingTransactions,
      },
      schemas: {
        expense_groups: groupSchema,
        group_members: membersSchema,
      },
      errors: {
        group_error: groupError,
        membership_error: membershipError,
        schema_error: schemaError,
        members_schema_error: membersSchemaError,
        pending_error: pendingError,
      },
    });
  } catch (error) {
    console.error("Debug archive error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
