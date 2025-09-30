import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = params;
    const body = await request.json();

    // Verificar se a transação pertence ao usuário
    const { data: existingTransaction, error: fetchError } = await supabase
      .from("financial_transactions")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !existingTransaction) {
      return NextResponse.json(
        { error: "Transaction not found or access denied" },
        { status: 404 }
      );
    }

    // Extrair campos que podem ser atualizados
    const {
      description,
      amount,
      category_id,
      transaction_date,
      notes,
      group_id,
    } = body;

    // Validar group_id se fornecido
    if (group_id && group_id !== existingTransaction.group_id) {
      const { data: groupMember } = await supabase
        .from("group_members")
        .select("id")
        .eq("group_id", group_id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .single();

      if (!groupMember) {
        return NextResponse.json(
          { error: "User is not a member of the specified group" },
          { status: 403 }
        );
      }
    }

    // Verificar se é despesa para lógica de grupos
    let isExpense = false;
    if (category_id) {
      const { data: category } = await supabase
        .from("transaction_categories")
        .select("is_expense")
        .eq("id", category_id)
        .single();
      isExpense =
        category?.is_expense &&
        (amount ? amount > 0 : existingTransaction.amount < 0);
    } else {
      isExpense = existingTransaction.amount < 0;
    }

    // Preparar dados para atualização
    const updateData: any = {};
    if (description !== undefined) updateData.description = description;
    if (amount !== undefined) {
      updateData.amount = isExpense ? -Math.abs(amount) : Math.abs(amount);
    }
    if (category_id !== undefined) updateData.category_id = category_id;
    if (transaction_date !== undefined)
      updateData.transaction_date = transaction_date;
    if (notes !== undefined) updateData.notes = notes;
    if (group_id !== undefined) updateData.group_id = group_id || null;

    // Atualizar transação
    const { data: updatedTransaction, error: updateError } = await supabase
      .from("financial_transactions")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("Transaction update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update transaction" },
        { status: 500 }
      );
    }

    // Gerenciar grupos se necessário
    if (group_id !== undefined && isExpense) {
      // Remover ligação com grupo anterior se existir
      if (existingTransaction.group_id) {
        await supabase
          .from("group_transactions")
          .delete()
          .eq("transaction_id", id)
          .eq("group_id", existingTransaction.group_id);
      }

      // Adicionar ao novo grupo se fornecido
      if (group_id) {
        // Criar group_transaction
        const { data: groupTransaction, error: groupTransactionError } =
          await supabase
            .from("group_transactions")
            .insert({
              group_id: group_id,
              transaction_id: id,
              split_type: "equal",
            })
            .select()
            .single();

        if (groupTransactionError) {
          console.error(
            "Group transaction creation error:",
            groupTransactionError
          );
        } else {
          // Buscar membros ativos do grupo
          const { data: members } = await supabase
            .from("group_members")
            .select("id")
            .eq("group_id", group_id)
            .eq("status", "active");

          if (members && members.length > 0) {
            // Criar splits igualmente divididos entre todos os membros
            const transactionAmount = Math.abs(updatedTransaction.amount);
            const splitAmount = transactionAmount / members.length;
            const splitPercentage = 100 / members.length;

            const groupSplitsData = members.map((member: any) => ({
              group_transaction_id: groupTransaction.id,
              member_id: member.id,
              percentage: splitPercentage,
              amount: splitAmount,
              status: "pending",
            }));

            const { error: groupSplitsError } = await supabase
              .from("group_expense_splits")
              .insert(groupSplitsData);

            if (groupSplitsError) {
              console.error("Group splits creation error:", groupSplitsError);
            }
          }
        }
      }
    }

    // Buscar transação completa para retorno
    const { data: completeTransaction } = await supabase
      .from("financial_transactions")
      .select(
        `
        *,
        category:transaction_categories(*),
        expense_splits(
          *,
          participant:profiles!expense_splits_participant_id_fkey(full_name, avatar_url)
        )
      `
      )
      .eq("id", id)
      .single();

    return NextResponse.json({
      message: "Transaction updated successfully",
      transaction: completeTransaction,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = params;

    // Verificar se a transação pertence ao usuário
    const { data: existingTransaction, error: fetchError } = await supabase
      .from("financial_transactions")
      .select("group_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !existingTransaction) {
      return NextResponse.json(
        { error: "Transaction not found or access denied" },
        { status: 404 }
      );
    }

    // Remover group_transactions e splits relacionados primeiro
    if (existingTransaction.group_id) {
      await supabase
        .from("group_transactions")
        .delete()
        .eq("transaction_id", id)
        .eq("group_id", existingTransaction.group_id);
    }

    // Deletar transação (expense_splits serão deletados automaticamente devido ao CASCADE)
    const { error: deleteError } = await supabase
      .from("financial_transactions")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (deleteError) {
      console.error("Transaction deletion error:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete transaction" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "Transaction deleted successfully",
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
