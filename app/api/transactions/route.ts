import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();

    // Verificar se o usuário está autenticado
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Buscar transações do usuário
    const { data: transactions, error } = await supabase
      .from("transactions")
      .select(
        `
        *,
        assets (
          symbol,
          name,
          type
        )
      `
      )
      .eq("user_id", user.id)
      .order("date", { ascending: false });

    if (error) {
      console.error("Erro ao buscar transações:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }

    return NextResponse.json({ transactions });
  } catch (error) {
    console.error("Erro na API de transações:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();

    // Verificar se o usuário está autenticado
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { asset_id, type, quantity, price, fees, date, notes } = body;

    // Validar dados obrigatórios
    if (!asset_id || !type || !quantity || !price || !date) {
      return NextResponse.json(
        { error: "Dados obrigatórios faltando" },
        { status: 400 }
      );
    }

    // Inserir nova transação
    const { data: transaction, error } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        asset_id,
        type,
        quantity,
        price,
        fees: fees || 0,
        date,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Erro ao criar transação:", error);
      return NextResponse.json(
        { error: "Erro ao criar transação" },
        { status: 500 }
      );
    }

    return NextResponse.json({ transaction }, { status: 201 });
  } catch (error) {
    console.error("Erro na API de transações:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
