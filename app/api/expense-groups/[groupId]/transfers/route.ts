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

    console.log("Getting transfer suggestions for group:", groupId);

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
        user_id,
        user:profiles!group_members_user_id_fkey (
          id,
          full_name,
          avatar_url
        )
      `
      )
      .eq("group_id", groupId)
      .eq("status", "active");

    if (!members || members.length === 0) {
      return NextResponse.json({
        success: true,
        transfers: [],
      });
    }

    // Get all group transactions with their splits
    const { data: groupTransactions } = await supabase
      .from("group_transactions")
      .select(
        `
        id,
        transaction:financial_transactions (
          id,
          amount,
          user_id,
          transaction_date
        ),
        splits:group_expense_splits (
          id,
          amount,
          member_id,
          member:group_members (
            user_id,
            user:profiles!group_members_user_id_fkey (
              id,
              full_name,
              avatar_url
            )
          )
        )
      `
      )
      .eq("group_id", groupId);

    // Calculate net balances for each member
    const memberBalances = new Map<
      string,
      {
        user: any;
        paid: number;
        owes: number;
        net: number;
      }
    >();

    // Initialize balances for all members
    members.forEach((member: any) => {
      memberBalances.set(member.user_id, {
        user: member.user,
        paid: 0,
        owes: 0,
        net: 0,
      });
    });

    // Calculate what each member paid and owes
    if (groupTransactions) {
      groupTransactions.forEach((gt: any) => {
        if (gt.transaction && gt.splits) {
          const paidAmount = Math.abs(gt.transaction.amount || 0);
          const payerId = gt.transaction.user_id;

          // Add to what the payer paid
          if (memberBalances.has(payerId)) {
            memberBalances.get(payerId)!.paid += paidAmount;
          }

          // Add to what each member owes
          gt.splits.forEach((split: any) => {
            if (
              split.member?.user_id &&
              memberBalances.has(split.member.user_id)
            ) {
              memberBalances.get(split.member.user_id)!.owes +=
                split.amount || 0;
            }
          });
        }
      });
    }

    // Calculate net balances (paid - owes)
    memberBalances.forEach((balance, userId) => {
      balance.net = balance.paid - balance.owes;
    });

    // Generate transfer suggestions using a greedy algorithm
    const transfers: any[] = [];
    const balances = Array.from(memberBalances.values()).filter(
      (b) => Math.abs(b.net) > 0.01
    ); // Only include non-zero balances

    // Separate debtors (negative balance) and creditors (positive balance)
    const debtors = balances
      .filter((b) => b.net < -0.01)
      .sort((a, b) => a.net - b.net);
    const creditors = balances
      .filter((b) => b.net > 0.01)
      .sort((a, b) => b.net - a.net);

    // Create transfers to balance the accounts
    let debtorIndex = 0;
    let creditorIndex = 0;

    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
      const debtor = debtors[debtorIndex];
      const creditor = creditors[creditorIndex];

      const debtAmount = Math.abs(debtor.net);
      const creditAmount = creditor.net;
      const transferAmount = Math.min(debtAmount, creditAmount);

      if (transferAmount > 0.01) {
        transfers.push({
          from: {
            id: debtor.user.id,
            full_name: debtor.user.full_name,
            avatar_url: debtor.user.avatar_url,
          },
          to: {
            id: creditor.user.id,
            full_name: creditor.user.full_name,
            avatar_url: creditor.user.avatar_url,
          },
          amount: transferAmount,
        });
      }

      // Update balances
      debtor.net += transferAmount;
      creditor.net -= transferAmount;

      // Move to next debtor/creditor if balance is settled
      if (Math.abs(debtor.net) < 0.01) {
        debtorIndex++;
      }
      if (Math.abs(creditor.net) < 0.01) {
        creditorIndex++;
      }
    }

    console.log("📊 TRANSFER SUGGESTIONS CALCULATED:", {
      totalMembers: members.length,
      totalTransfers: transfers.length,
      transfers: transfers.map((t) => ({
        from: t.from.full_name,
        to: t.to.full_name,
        amount: t.amount,
      })),
    });

    return NextResponse.json({
      success: true,
      transfers,
    });
  } catch (error) {
    console.error("Error in transfers API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
