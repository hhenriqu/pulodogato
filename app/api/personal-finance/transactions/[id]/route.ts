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

      // PDG01 e a recusa da migration 024 (HMO-176): a edicao mudaria uma
      // divisao de grupo cuja parte alguem ja aprovou. Nao e falha do servidor
      // -- e uma regra de negocio, e a mensagem vem escrita para ser lida por
      // quem lancou. Devolver 500 com "Failed to update transaction" faria a
      // tela dizer "tente de novo" para algo que nunca vai passar.
      if (updateError.code === "PDG01") {
        return NextResponse.json({ error: updateError.message }, { status: 409 });
      }

      return NextResponse.json(
        { error: "Failed to update transaction" },
        { status: 500 }
      );
    }

    // -----------------------------------------------------------------------
    // GRUPO: QUEM REFAZ A DIVISAO E O BANCO (HMO-176)
    // -----------------------------------------------------------------------
    // Aqui havia um bloco que apagava a ligacao do grupo antigo e inseria a do
    // novo, com um rateio calculado a mao (valor / numero de membros). Ele
    // duplicava o que o trigger de financial_transactions faz -- e desde a
    // migration 024 o trigger faz isso CERTO, inclusive na edicao: move a
    // divisao de grupo, recalcula as partes pendentes pelo metodo do maior
    // resto do 007 (que nao perde centavo) e recusa a edicao quando alguem ja
    // aprovou a propria parte.
    //
    // Mantido, o bloco produziria dois defeitos novos: o INSERT bateria no
    // indice unico por transaction_id que a 024 criou -- e o erro so era
    // registrado no console, entao a rota responderia 200 com uma falha
    // silenciosa dentro --, e o rateio a mao reintroduziria o centavo perdido
    // que o 007 existiu para tirar (R$ 100 entre 3 davam 33,33 tres vezes).
    //
    // E a mesma conclusao a que a HMO-175 chegou na tela de lancamento: quando
    // o `await` do update acima retorna, a divisao JA esta em dia.

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
