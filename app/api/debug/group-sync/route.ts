import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("=== DEBUG: Verificando sincronização ===");

    // 1. Transações do usuário com group_id
    const { data: transactionsWithGroup } = await supabase
      .from("financial_transactions")
      .select(
        `
        id,
        description,
        amount,
        group_id,
        created_at
      `
      )
      .eq("user_id", user.id)
      .not("group_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(10);

    // 2. Group transactions relacionadas
    const { data: groupTransactions } = await supabase
      .from("group_transactions")
      .select(
        `
        id,
        group_id,
        transaction_id,
        split_type,
        created_at
      `
      )
      .order("created_at", { ascending: false })
      .limit(10);

    // 3. Group expense splits
    const { data: groupSplits } = await supabase
      .from("group_expense_splits")
      .select(
        `
        id,
        group_transaction_id,
        member_id,
        amount,
        status,
        created_at
      `
      )
      .order("created_at", { ascending: false })
      .limit(10);

    // 4. Grupos do usuário
    const { data: userGroups } = await supabase
      .from("group_members")
      .select(
        `
        group_id,
        role,
        status,
        group:expense_groups (
          id,
          name
        )
      `
      )
      .eq("user_id", user.id)
      .eq("status", "active");

    // 5. Verificar inconsistências
    const inconsistencies = [];

    if (transactionsWithGroup) {
      for (const transaction of transactionsWithGroup) {
        const hasGroupTransaction = groupTransactions?.find(
          (gt) =>
            gt.transaction_id === transaction.id &&
            gt.group_id === transaction.group_id
        );

        if (!hasGroupTransaction) {
          inconsistencies.push({
            type: "missing_group_transaction",
            transaction_id: transaction.id,
            description: transaction.description,
            group_id: transaction.group_id,
          });
        }
      }
    }

    // 6. Test query que a API do grupo usa
    const testGroupId = userGroups?.[0]?.group_id;
    let groupApiTest = null;

    if (testGroupId) {
      const { data: apiTest, error: apiError } = await supabase
        .from("group_transactions")
        .select(
          `
          id,
          split_type,
          created_at,
          transaction:financial_transactions (
            id,
            description,
            amount,
            transaction_date,
            created_at,
            user_id
          )
        `
        )
        .eq("group_id", testGroupId);

      groupApiTest = { data: apiTest, error: apiError, groupId: testGroupId };
    }

    return NextResponse.json({
      user_id: user.id,
      summary: {
        transactions_with_group: transactionsWithGroup?.length || 0,
        group_transactions: groupTransactions?.length || 0,
        group_splits: groupSplits?.length || 0,
        user_groups: userGroups?.length || 0,
        inconsistencies: inconsistencies.length,
      },
      details: {
        transactions_with_group: transactionsWithGroup,
        group_transactions: groupTransactions,
        group_splits: groupSplits,
        user_groups: userGroups,
        inconsistencies: inconsistencies,
        group_api_test: groupApiTest,
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
