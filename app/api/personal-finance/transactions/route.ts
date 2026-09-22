import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Helper function to get user group IDs
async function getUserGroupIds(supabase: any, userId: string): Promise<string> {
  const { data: groups } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)
    .eq("status", "active");

  return groups?.map((g: any) => g.group_id).join(",") || "";
}

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

    const url = new URL(request.url);
    const limit = url.searchParams.get("limit") || "50";
    const offset = url.searchParams.get("offset") || "0";

    // Buscar serviço de finanças pessoais
    const { data: service } = await supabase
      .from("financial_services")
      .select("id")
      .eq("name", "personal_finance")
      .single();

    if (!service) {
      return NextResponse.json(
        { error: "Personal finance service not found" },
        { status: 404 }
      );
    }

    // Get user group IDs first
    const userGroupIds = await getUserGroupIds(supabase, user.id);

    // Build the query conditions
    let query = supabase
      .from("financial_transactions")
      .select(
        `
        *,
        category:transaction_categories(*),
        expense_splits(
          *,
          participant:profiles!expense_splits_participant_id_fkey(full_name, avatar_url)
        ),
        group:expense_groups(id, name, group_code)
      `
      )
      .eq("service_id", service.id);

    // Add user filter - either user's own transactions or group transactions they're member of
    if (userGroupIds) {
      query = query.or(`user_id.eq.${user.id},group_id.in.(${userGroupIds})`);
    } else {
      query = query.eq("user_id", user.id);
    }

    const { data: transactions, error } = await query
      .order("transaction_date", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      console.error("Database error:", error);
      return NextResponse.json(
        { error: "Failed to fetch transactions" },
        { status: 500 }
      );
    }

    return NextResponse.json({ transactions });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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
    const {
      description,
      amount,
      category_id,
      transaction_date,
      notes,
      is_shared,
      splits,
      group_id,
    } = body;

    // Validações básicas
    if (!description || !amount || !category_id) {
      return NextResponse.json(
        {
          error: "Missing required fields: description, amount, category_id",
        },
        { status: 400 }
      );
    }

    // Buscar serviço de finanças pessoais
    const { data: service } = await supabase
      .from("financial_services")
      .select("id")
      .eq("name", "personal_finance")
      .single();

    if (!service) {
      return NextResponse.json(
        { error: "Personal finance service not found" },
        { status: 404 }
      );
    }

    // Verificar se a categoria é uma despesa
    const { data: category } = await supabase
      .from("transaction_categories")
      .select("is_expense")
      .eq("id", category_id)
      .single();

    const isExpense = category?.is_expense && amount > 0;
    const finalAmount = isExpense ? -Math.abs(amount) : Math.abs(amount);

    // Validar divisões se fornecidas
    if (is_shared && splits && splits.length > 0) {
      const totalPercentage = splits.reduce(
        (sum: number, split: any) => sum + split.percentage,
        0
      );
      if (Math.abs(totalPercentage - 100) > 0.01) {
        return NextResponse.json(
          {
            error: "Split percentages must sum to 100%",
          },
          { status: 400 }
        );
      }
    }

    // Validar group_id se fornecido
    if (group_id) {
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

    // Criar transação
    const { data: transaction, error: transactionError } = await supabase
      .from("financial_transactions")
      .insert({
        user_id: user.id,
        service_id: service.id,
        category_id,
        description,
        amount: finalAmount,
        transaction_date:
          transaction_date || new Date().toISOString().split("T")[0],
        notes,
        is_shared: is_shared && splits && splits.length > 0,
        group_id: group_id || null,
      })
      .select()
      .single();

    if (transactionError) {
      console.error("Transaction creation error:", transactionError);
      return NextResponse.json(
        { error: "Failed to create transaction" },
        { status: 500 }
      );
    }

    // Despesa com group_id: o trigger `auto_create_group_transaction` do banco
    // ja criou a ligacao e o rateio igualitario no INSERT acima.
    //
    // Esta rota criava tudo DE NOVO -- uma segunda linha em group_transactions
    // (nao ha indice unico que impeca) com um segundo jogo de rateios. O efeito
    // era cada membro devendo o DOBRO da parte dele naquela despesa, em
    // silencio. So ficou visivel com a view de saldo da 007, porque antes o
    // saldo era calculado de dois jeitos diferentes e nenhum deles fechava.
    //
    // O rateio em centavos inteiros tambem passou a ser do banco (007): a
    // divisao em TypeScript aqui perdia centavo na divisao inexata.
    if (group_id && isExpense) {
      const { data: groupTransaction } = await supabase
        .from("group_transactions")
        .select("id")
        .eq("group_id", group_id)
        .eq("transaction_id", transaction.id)
        .maybeSingle();

      if (!groupTransaction) {
        // Banco sem a 007: mantem o caminho antigo para nao deixar a despesa
        // sem rateio nenhum.
        const { data: criada, error: groupTransactionError } = await supabase
          .from("group_transactions")
          .insert({
            group_id: group_id,
            transaction_id: transaction.id,
            split_type: "equal",
          })
          .select("id")
          .single();

        if (groupTransactionError) {
          console.error(
            "Group transaction creation error:",
            groupTransactionError
          );
        } else {
          const { data: members } = await supabase
            .from("group_members")
            .select("id")
            .eq("group_id", group_id)
            .eq("status", "active");

          if (members && members.length > 0) {
            const splitAmount = Math.abs(finalAmount) / members.length;
            const splitPercentage = 100 / members.length;

            const { error: groupSplitsError } = await supabase
              .from("group_expense_splits")
              .insert(
                members.map((member: any) => ({
                  group_transaction_id: criada.id,
                  member_id: member.id,
                  percentage: splitPercentage,
                  amount: splitAmount,
                  status: "pending",
                }))
              );

            if (groupSplitsError) {
              console.error("Group splits creation error:", groupSplitsError);
            }
          }
        }
      }
    }

    // Criar divisões tradicionais se necessário (para finanças pessoais)
    if (is_shared && splits && splits.length > 0 && isExpense && !group_id) {
      const splitsData = splits.map((split: any) => ({
        transaction_id: transaction.id,
        participant_id: split.participant_id,
        percentage: split.percentage,
      }));

      const { error: splitsError } = await supabase
        .from("expense_splits")
        .insert(splitsData);

      if (splitsError) {
        console.error("Splits creation error:", splitsError);
        // Não falhar a operação, apenas log do erro
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
      .eq("id", transaction.id)
      .single();

    return NextResponse.json(
      {
        message: "Transaction created successfully",
        transaction: completeTransaction,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
