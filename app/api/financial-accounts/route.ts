import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { moedaConhecida } from "@/lib/dinheiro";

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

    // A tela de gerenciamento precisa ver o que foi arquivado para poder
    // reativar; todo o resto do app (seletor de conta em lancamento, orcamento,
    // extrato) so quer as ativas, que segue sendo o padrao.
    const incluirArquivadas =
      request.nextUrl.searchParams.get("include_inactive") === "1";

    let query = supabase
      .from("financial_accounts")
      .select("*")
      .eq("user_id", user.id);

    if (!incluirArquivadas) query = query.eq("is_active", true);

    const { data: accounts, error: fetchError } = await query.order(
      "created_at",
      { ascending: false }
    );

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
      // Cartao de credito (migration 006): fechamento e vencimento da fatura.
      closing_day,
      due_day,
      // Moeda da conta (migration 022). E o padrao que os lancamentos dela
      // herdam -- ver lib/moeda.ts.
      currency,
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

    // O banco tem CHECK de 1 a 31 nos dois; validar aqui devolve uma mensagem
    // em vez de um 500 com codigo 23514.
    const dia = (valor: unknown) => (valor == null || valor === "" ? null : Number(valor));
    const diaFechamento = dia(closing_day);
    const diaVencimento = dia(due_day);

    for (const [rotulo, valor] of [
      ["fechamento", diaFechamento],
      ["vencimento", diaVencimento],
    ] as const) {
      if (valor !== null && (!Number.isInteger(valor) || valor < 1 || valor > 31)) {
        return NextResponse.json(
          { error: `O dia de ${rotulo} deve estar entre 1 e 31` },
          { status: 400 }
        );
      }
    }

    // A moeda e recusada aqui quando nao esta no catalogo, e nao corrigida em
    // silencio: o banco tem CHECK (022), entao deixar passar daria um 500 com
    // codigo 23514 -- que a tela mostra como "Erro ao criar conta", sem dizer o
    // que esta errado. Ausente cai no DEFAULT 'BRL' da coluna, que e a decisao
    // "ficam-brl" e tambem o que mantem compativel todo cliente que nao manda o
    // campo (a fila offline, por exemplo).
    if (currency !== undefined && currency !== null && currency !== "") {
      if (!moedaConhecida(currency)) {
        return NextResponse.json(
          { error: "Moeda inválida" },
          { status: 400 }
        );
      }
    }

    const moedaDaConta =
      currency === undefined || currency === null || currency === ""
        ? undefined
        : String(currency).trim().toUpperCase();

    // Criar conta
    const { data: account, error: createError } = await supabase
      .from("financial_accounts")
      .insert({
        user_id: user.id,
        name: name.trim(),
        account_type,
        // `undefined` e omitido pelo supabase-js e a coluna fica com o DEFAULT.
        // Mandar `null` aqui violaria o NOT NULL da 022.
        ...(moedaDaConta ? { currency: moedaDaConta } : {}),
        bank_name: bank_name?.trim(),
        last_four_digits: last_four_digits?.trim(),
        credit_limit: credit_limit ? parseFloat(credit_limit) : null,
        color_hex,
        icon,
        closing_day: diaFechamento,
        due_day: diaVencimento,
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
