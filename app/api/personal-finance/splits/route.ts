import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Buscar divisões onde o usuário é participante (pendentes de aprovação)
    const { data: pendingSplits, error: pendingError } = await supabase
      .from("expense_splits")
      .select(
        `
        *,
        transaction:financial_transactions(
          *,
          category:transaction_categories(*),
          user_id
        )
      `
      )
      .eq("participant_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (pendingError) {
      console.error("Database error:", pendingError);
      return NextResponse.json(
        { error: "Failed to fetch pending splits" },
        { status: 500 }
      );
    }

    // Buscar divisões criadas pelo usuário (com status)
    const { data: createdSplits, error: createdError } = await supabase
      .from("expense_splits")
      .select(
        `
        *,
        participant:profiles!expense_splits_participant_id_fkey(full_name, avatar_url),
        transaction:financial_transactions(
          *,
          category:transaction_categories(*)
        )
      `
      )
      .eq("transaction.user_id", user.id)
      .order("created_at", { ascending: false });

    if (createdError) {
      console.error("Database error:", createdError);
      return NextResponse.json(
        { error: "Failed to fetch created splits" },
        { status: 500 }
      );
    }

    // Buscar balanços do usuário
    const { data: balances, error: balanceError } = await supabase
      .from("user_balances")
      .select(
        `
        *,
        creditor:profiles!user_balances_creditor_id_fkey(full_name, avatar_url),
        debtor:profiles!user_balances_debtor_id_fkey(full_name, avatar_url)
      `
      )
      .or(`creditor_id.eq.${user.id},debtor_id.eq.${user.id}`)
      .gt("amount", 0)
      .order("amount", { ascending: false });

    if (balanceError) {
      console.error("Database error:", balanceError);
      return NextResponse.json(
        { error: "Failed to fetch balances" },
        { status: 500 }
      );
    }

    // Helper function to get user info
    const getUserInfo = async (userId: string) => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .eq("id", userId)
        .single();
      return data;
    };

    // Enrich pending splits with user info
    const enrichedPendingSplits = await Promise.all(
      (pendingSplits || []).map(async (split: any) => ({
        ...split,
        transaction: {
          ...split.transaction,
          user: await getUserInfo(split.transaction.user_id),
        },
      }))
    );

    return NextResponse.json({
      pendingSplits: enrichedPendingSplits,
      createdSplits: createdSplits || [],
      balances: balances || [],
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { splitId, action, rejectionReason } = body;

    if (!splitId || !action || !["approve", "reject"].includes(action)) {
      return NextResponse.json(
        {
          error: "Missing or invalid fields: splitId, action (approve/reject)",
        },
        { status: 400 }
      );
    }

    // Verificar se o usuário é o participante da divisão
    const { data: split, error: splitError } = await supabase
      .from("expense_splits")
      .select("*")
      .eq("id", splitId)
      .eq("participant_id", user.id)
      .eq("status", "pending")
      .single();

    if (splitError || !split) {
      return NextResponse.json(
        { error: "Split not found or not authorized" },
        { status: 404 }
      );
    }

    // Atualizar status da divisão
    const updateData: any = {
      status: action === "approve" ? "approved" : "rejected",
      updated_at: new Date().toISOString(),
    };

    if (action === "approve") {
      updateData.approved_at = new Date().toISOString();
    } else if (rejectionReason) {
      updateData.rejection_reason = rejectionReason;
    }

    const { error: updateError } = await supabase
      .from("expense_splits")
      .update(updateData)
      .eq("id", splitId);

    if (updateError) {
      console.error("Update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update split" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: `Split ${action}d successfully`,
      splitId,
      status: updateData.status,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
