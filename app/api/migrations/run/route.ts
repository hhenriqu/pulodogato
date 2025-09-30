import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();

    // Verificar se o usuário é admin ou tem permissão
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { migrationName } = body;

    if (!migrationName) {
      return NextResponse.json(
        { error: "Nome da migração é obrigatório" },
        { status: 400 }
      );
    }

    // Verificar status das migrações
    const migrationStatus = await checkMigrationStatus(supabase);

    return NextResponse.json({
      success: true,
      message:
        "Verificação de migração concluída. Execute manualmente no Supabase.",
      migrationStatus,
      instructions: {
        step1: "Acesse https://supabase.com/dashboard",
        step2: "Navegue para SQL Editor",
        step3: "Cole e execute o conteúdo da migração solicitada",
        step4: `Para ${migrationName}: copie o arquivo database/migrations/${migrationName}`,
      },
    });
  } catch (error: any) {
    console.error("Erro ao verificar migração:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor", details: error.message },
      { status: 500 }
    );
  }
}

async function checkMigrationStatus(supabase: any) {
  const checks = [];

  // Verificar 002_personal_finance.sql
  try {
    const { data: personalFinanceCheck } = await supabase
      .from("financial_services")
      .select("id")
      .limit(1);

    checks.push({
      migration: "002_personal_finance.sql",
      status: personalFinanceCheck ? "✅ Instalado" : "❌ Não instalado",
      tables: [
        "financial_services",
        "transaction_categories",
        "financial_transactions",
      ],
    });
  } catch {
    checks.push({
      migration: "002_personal_finance.sql",
      status: "❌ Não instalado",
      tables: [
        "financial_services",
        "transaction_categories",
        "financial_transactions",
      ],
    });
  }

  // Verificar 003_expense_groups.sql
  try {
    const { data: groupsCheck } = await supabase
      .from("expense_groups")
      .select("id")
      .limit(1);

    checks.push({
      migration: "003_expense_groups.sql",
      status: groupsCheck ? "✅ Instalado" : "❌ Não instalado",
      tables: ["expense_groups", "group_members", "group_invites"],
    });
  } catch {
    checks.push({
      migration: "003_expense_groups.sql",
      status: "❌ Não instalado",
      tables: ["expense_groups", "group_members", "group_invites"],
    });
  }

  // Verificar 004_financial_extensions.sql
  try {
    const { data: accountsCheck } = await supabase
      .from("financial_accounts")
      .select("id")
      .limit(1);

    checks.push({
      migration: "004_financial_extensions.sql",
      status: accountsCheck ? "✅ Instalado" : "❌ Não instalado",
      tables: [
        "financial_accounts",
        "transaction_installments",
        "group_member_proportions",
      ],
    });
  } catch {
    checks.push({
      migration: "004_financial_extensions.sql",
      status: "❌ Não instalado",
      tables: [
        "financial_accounts",
        "transaction_installments",
        "group_member_proportions",
      ],
    });
  }

  return checks;
}

// GET para listar migrações disponíveis
export async function GET() {
  try {
    const migrations = [
      {
        name: "002_personal_finance.sql",
        description:
          "Sistema básico de finanças pessoais com categorias e transações",
        required: true,
      },
      {
        name: "003_expense_groups.sql",
        description: "Sistema de grupos para divisão de gastos compartilhados",
        required: false,
      },
      {
        name: "004_financial_extensions.sql",
        description:
          "Extensões financeiras: contas, cartões de crédito e parcelamento",
        required: false,
      },
    ];

    return NextResponse.json({
      migrations,
      message:
        "Use POST com { migrationName: 'nome_do_arquivo.sql' } para executar",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Erro ao listar migrações", details: error.message },
      { status: 500 }
    );
  }
}
