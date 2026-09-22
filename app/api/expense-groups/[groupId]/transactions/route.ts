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

    console.log("Getting transactions for group:", groupId);

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

    // Get transactions linked to this group through group_transactions table
    const { data: groupTransactions, error: groupError } = await supabase
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
          user_id,
          category:transaction_categories (
            name,
            icon
          )
        )
      `
      )
      .eq("group_id", groupId);

    if (groupError) {
      console.error("Error loading group transactions:", groupError);
      return NextResponse.json(
        { error: "Failed to load transactions" },
        { status: 500 }
      );
    }

    // Get splits for each transaction and payer info
    const transactionsWithSplits = await Promise.all(
      (groupTransactions || []).map(async (gt: any) => {
        if (!gt.transaction) return null;

        // Get payer info separately
        const { data: payer } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .eq("id", gt.transaction.user_id)
          .single();

        const { data: splits } = await supabase
          .from("group_expense_splits")
          .select(
            `
            id,
            amount,
            status,
            member:group_members (
              id,
              user:profiles!group_members_user_id_fkey (
                id,
                full_name,
                avatar_url
              )
            )
          `
          )
          .eq("group_transaction_id", gt.id);

        return {
          id: gt.transaction.id,
          description: gt.transaction.description,
          amount: Math.abs(gt.transaction.amount), // Convert to positive for display
          transaction_date: gt.transaction.transaction_date,
          created_at: gt.transaction.created_at,
          payer: payer,
          splits: (splits || []).map((split: any) => ({
            id: split.id,
            amount: split.amount,
            status: split.status,
            member: split.member?.user,
          })),
          category: gt.transaction.category,
        };
      })
    );

    const validTransactions = transactionsWithSplits.filter((t) => t !== null);

    return NextResponse.json({
      success: true,
      transactions: validTransactions,
    });
  } catch (error) {
    console.error("Error in transactions API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

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
    const body = await request.json();

    console.log("Creating transaction for group:", groupId, body);

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

    // Get a default category for expenses (first expense category)
    const { data: category } = await supabase
      .from("transaction_categories")
      .select("id, service_id")
      .eq("is_expense", true)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!category) {
      return NextResponse.json(
        { error: "No expense category found" },
        { status: 400 }
      );
    }

    // Create financial transaction (with negative amount for expenses)
    const { data: transaction, error: transactionError } = await supabase
      .from("financial_transactions")
      .insert({
        user_id: user.id,
        service_id: category.service_id,
        category_id: body.category_id || category.id,
        description: body.description,
        amount: -Math.abs(body.amount), // Negative for expenses
        transaction_date: body.transaction_date,
        notes: body.notes,
        is_shared: true,
        // Sem esta coluna a despesa fica invisivel para os OUTROS membros: a
        // policy de SELECT de financial_transactions (migration 002) libera a
        // transacao alheia justamente por `group_id IS NOT NULL AND
        // is_group_member(group_id)`. Ate a 007 esta rota nao a gravava, e o
        // resultado era cada membro abrindo a mesma viagem e lendo que todos os
        // outros pagaram zero -- sem erro nenhum aparecer. O consumo de
        // orcamento de grupo (006) depende da mesma coluna.
        group_id: groupId,
      })
      .select()
      .single();

    if (transactionError) {
      console.error("Error creating transaction:", transactionError);
      return NextResponse.json(
        { error: "Failed to create transaction" },
        { status: 500 }
      );
    }

    // A partir da 007 a transacao acima ja nasce com `group_id`, e o trigger
    // `auto_create_group_transaction` do banco JA criou a ligacao e o rateio
    // igualitario. Inserir de novo aqui criaria uma SEGUNDA linha em
    // group_transactions para a mesma despesa -- nao ha indice unico que
    // impeca -- e um segundo jogo de rateios: cada membro passaria a dever o
    // dobro, sem erro nenhum aparecer. Entao aqui so lemos o que o banco fez.
    const { data: existente } = await supabase
      .from("group_transactions")
      .select("id, split_type")
      .eq("group_id", groupId)
      .eq("transaction_id", transaction.id)
      .maybeSingle();

    let groupTransaction = existente;

    // Rede de seguranca: se o trigger nao rodou (despesa positiva, banco sem a
    // 007 aplicada), a ligacao ainda precisa existir.
    if (!groupTransaction) {
      const { data: criada, error: groupError } = await supabase
        .from("group_transactions")
        .insert({
          group_id: groupId,
          transaction_id: transaction.id,
          split_type: body.split_type || "equal",
        })
        .select("id, split_type")
        .single();

      if (groupError) {
        console.error("Error linking to group:", groupError);
        await supabase
          .from("financial_transactions")
          .delete()
          .eq("id", transaction.id);

        return NextResponse.json(
          { error: "Failed to link transaction to group" },
          { status: 500 }
        );
      }
      groupTransaction = criada;
    }

    // O trigger sempre rateia igualmente. Divisao combinada (custom,
    // percentage, proporcional) substitui o rateio automatico -- e precisa
    // trocar o split_type ANTES de inserir, porque e ele que faz o trigger
    // `calculate_equal_split` devolver os valores intactos em vez de achatar
    // tudo para partes iguais.
    const splitTypeDesejado = body.split_type || "equal";
    const temSplitsCustomizados =
      splitTypeDesejado !== "equal" &&
      Array.isArray(body.splits) &&
      body.splits.length > 0;

    if (temSplitsCustomizados) {
      await supabase
        .from("group_transactions")
        .update({ split_type: splitTypeDesejado })
        .eq("id", groupTransaction.id);

      await supabase
        .from("group_expense_splits")
        .delete()
        .eq("group_transaction_id", groupTransaction.id);

      await supabase.from("group_expense_splits").insert(
        body.splits.map((s: any) => ({
          group_transaction_id: groupTransaction!.id,
          member_id: s.member_id,
          percentage: s.percentage,
          amount: Math.abs(s.amount),
          status: "pending",
        }))
      );
    }

    return NextResponse.json({
      success: true,
      transaction: {
        id: transaction.id,
        description: transaction.description,
        amount: Math.abs(transaction.amount),
        transaction_date: transaction.transaction_date,
        created_at: transaction.created_at,
      },
    });
  } catch (error) {
    console.error("Error creating transaction:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
