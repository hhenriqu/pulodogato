import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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

    console.log("Getting balances for group:", groupId);

    // Check if user is member of this group
    const { data: membership } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get all group members
    const { data: members } = await supabase
      .from("group_members")
      .select(
        `
        id,
        user:profiles!group_members_user_id_fkey (
          id,
          full_name,
          avatar_url
        )
      `
      )
      .eq("group_id", groupId)
      .eq("status", "active");

    if (!members) {
      return NextResponse.json({
        success: true,
        balances: [],
      });
    }

    // Calculate balances for each member
    const balances = await Promise.all(
      members.map(async (member: any) => {
        // Get total paid by this member
        const { data: paidTransactions } = await supabase
          .from("group_transactions")
          .select(
            `
            id,
            transaction:financial_transactions(
              amount,
              user_id
            )
          `
          )
          .eq("group_id", groupId);

        const totalPaid =
          paidTransactions
            ?.filter((gt: any) => gt.transaction?.user_id === member.user.id)
            ?.reduce(
              (sum: number, gt: any) => sum + Math.abs(gt.transaction.amount),
              0
            ) || 0;

        // Get total owed by this member (splits)
        const { data: owedSplits } = await supabase
          .from("group_expense_splits")
          .select(
            `
            amount,
            group_transaction_id
          `
          )
          .eq("member_id", member.id);

        // Filter splits for this group
        const groupTransactionIds =
          paidTransactions?.map((gt: any) => gt.id) || [];
        const validSplits =
          owedSplits?.filter((split: any) =>
            groupTransactionIds.includes(split.group_transaction_id)
          ) || [];

        const totalOwed = validSplits.reduce(
          (sum: number, split: any) => sum + split.amount,
          0
        );

        // Get transaction count
        const paidCount =
          paidTransactions?.filter(
            (gt: any) => gt.transaction?.user_id === member.user.id
          )?.length || 0;
        const transactionCount = paidCount + validSplits.length;

        return {
          member: member.user,
          balance: totalPaid - totalOwed, // Positive = should receive, Negative = owes
          transactions_count: transactionCount,
        };
      })
    );

    return NextResponse.json({
      success: true,
      balances: balances,
    });
  } catch (error) {
    console.error("Error in balances API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
