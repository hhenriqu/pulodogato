import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
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

    // Buscar contas do usuário
    const { data: accounts, error: fetchError } = await supabase
      .from("financial_accounts")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error("Error fetching accounts:", fetchError);
      return NextResponse.json(
        { error: "Erro ao buscar contas" },
        { status: 500 }
      );
    }

    // Se não tem contas, criar as padrão
    if (!accounts || accounts.length === 0) {
      await supabase.rpc("create_default_accounts", { p_user_id: user.id });

      // Buscar novamente
      const { data: newAccounts } = await supabase
        .from("financial_accounts")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      return NextResponse.json({
        accounts: newAccounts || [],
        created_defaults: true,
      });
    }

    return NextResponse.json({
      accounts: accounts || [],
      created_defaults: false,
    });
  } catch (error) {
    console.error("Get accounts error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

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
      name,
      account_type,
      bank_name,
      last_four_digits,
      credit_limit,
      color_hex = "#3B82F6",
      icon = "credit-card",
    } = body;

    // Validações
    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Nome da conta é obrigatório" },
        { status: 400 }
      );
    }

    if (!account_type) {
      return NextResponse.json(
        { error: "Tipo de conta é obrigatório" },
        { status: 400 }
      );
    }

    // Criar conta
    const { data: account, error: createError } = await supabase
      .from("financial_accounts")
      .insert({
        user_id: user.id,
        name: name.trim(),
        account_type,
        bank_name: bank_name?.trim(),
        last_four_digits: last_four_digits?.trim(),
        credit_limit: credit_limit ? parseFloat(credit_limit) : null,
        color_hex,
        icon,
      })
      .select()
      .single();

    if (createError) {
      console.error("Error creating account:", createError);
      return NextResponse.json(
        { error: "Erro ao criar conta" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      account,
      message: "Conta criada com sucesso!",
    });
  } catch (error) {
    console.error("Create account error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
