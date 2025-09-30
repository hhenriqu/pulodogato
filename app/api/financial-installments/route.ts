import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = createClient();

  try {
    // Verificar autenticação
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const {
      account_id,
      category_id,
      description,
      total_amount,
      total_installments,
      first_due_date,
      transaction_type,
      group_id,
      group_split_type,
      notes,
    } = body;

    // Validações
    if (!description?.trim()) {
      return NextResponse.json(
        { error: "Descrição é obrigatória" },
        { status: 400 }
      );
    }

    if (!total_amount || total_amount <= 0) {
      return NextResponse.json(
        { error: "Valor total deve ser maior que zero" },
        { status: 400 }
      );
    }

    if (!total_installments || total_installments < 1) {
      return NextResponse.json(
        { error: "Número de parcelas deve ser maior que zero" },
        { status: 400 }
      );
    }

    if (!first_due_date) {
      return NextResponse.json(
        { error: "Data de vencimento da primeira parcela é obrigatória" },
        { status: 400 }
      );
    }

    if (!category_id) {
      return NextResponse.json(
        { error: "Categoria é obrigatória" },
        { status: 400 }
      );
    }

    if (
      !transaction_type ||
      !["income", "expense", "transfer"].includes(transaction_type)
    ) {
      return NextResponse.json(
        { error: "Tipo de transação inválido" },
        { status: 400 }
      );
    }

    // Verificar se a categoria pertence ao usuário/serviço
    const { data: category } = await supabase
      .from("transaction_categories")
      .select("*, financial_services(name)")
      .eq("id", category_id)
      .single();

    if (!category) {
      return NextResponse.json(
        { error: "Categoria não encontrada" },
        { status: 404 }
      );
    }

    // Verificar se a conta pertence ao usuário
    if (account_id) {
      const { data: account } = await supabase
        .from("financial_accounts")
        .select("id")
        .eq("id", account_id)
        .eq("user_id", user.id)
        .single();

      if (!account) {
        return NextResponse.json(
          { error: "Conta não encontrada" },
          { status: 404 }
        );
      }
    }

    // Criar parcelas usando a função do banco
    const { data: installmentIds, error: createError } = await supabase.rpc(
      "create_installments",
      {
        p_user_id: user.id,
        p_account_id: account_id,
        p_category_id: category_id,
        p_description: description.trim(),
        p_total_amount: parseFloat(total_amount),
        p_total_installments: parseInt(total_installments),
        p_first_due_date: first_due_date,
        p_transaction_type: transaction_type,
        p_group_id: group_id || null,
        p_group_split_type: group_split_type || null,
        p_notes: notes?.trim() || null,
      }
    );

    if (createError) {
      console.error("Error creating installments:", createError);
      return NextResponse.json(
        { error: "Erro ao criar parcelas" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      installment_ids: installmentIds,
      total_created: installmentIds?.length || 0,
      message: `${installmentIds?.length || 0} parcelas criadas com sucesso!`,
    });
  } catch (error) {
    console.error("Create installments error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status"); // 'pending', 'paid', 'overdue'
  const limit = parseInt(searchParams.get("limit") || "50");

  try {
    // Verificar autenticação
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    let query = supabase
      .from("transaction_installments")
      .select(
        `
        *,
        category:transaction_categories(*),
        account:financial_accounts(id, name, account_type, icon, color_hex),
        group:expense_groups(id, name, group_code)
      `
      )
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("due_date", { ascending: true })
      .limit(limit);

    // Filtrar por status se especificado
    if (status === "pending") {
      query = query.is("paid_date", null);
    } else if (status === "paid") {
      query = query.not("paid_date", "is", null);
    } else if (status === "overdue") {
      query = query
        .is("paid_date", null)
        .lt("due_date", new Date().toISOString().split("T")[0]);
    }

    const { data: installments, error: fetchError } = await query;

    if (fetchError) {
      console.error("Error fetching installments:", fetchError);
      return NextResponse.json(
        { error: "Erro ao buscar parcelas" },
        { status: 500 }
      );
    }

    // Agrupar por parent_transaction_id para facilitar visualização
    const groupedInstallments =
      installments?.reduce((groups, installment) => {
        const parentId = installment.parent_transaction_id || installment.id;
        if (!groups[parentId]) {
          groups[parentId] = [];
        }
        groups[parentId].push(installment);
        return groups;
      }, {} as Record<string, any[]>) || {};

    return NextResponse.json({
      installments: installments || [],
      grouped: groupedInstallments,
      total_found: installments?.length || 0,
    });
  } catch (error) {
    console.error("Get installments error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
