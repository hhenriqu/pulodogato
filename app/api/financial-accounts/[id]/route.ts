// PATCH /api/financial-accounts/{id}
//
// Existe para configurar o cartao: fechamento e vencimento da fatura
// (migration 006). Sem esses dois dias, card_invoice_month() trata toda compra
// como sendo da fatura do proprio mes e a fatura nao pode ser fechada.
//
// O que esta rota NAO deixa mexer: `current_balance`. Ele e mantido pelo
// trigger update_account_balance a partir das transacoes -- um PATCH direto no
// saldo criaria uma diferenca que nenhum lancamento explica.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const patch: Record<string, unknown> = {};

    for (const campo of ["closing_day", "due_day"] as const) {
      if (body[campo] === undefined) continue;

      const bruto = body[campo];
      if (bruto === null || bruto === "") {
        patch[campo] = null;
        continue;
      }

      const valor = Number(bruto);
      if (!Number.isInteger(valor) || valor < 1 || valor > 31) {
        const rotulo = campo === "closing_day" ? "fechamento" : "vencimento";
        return NextResponse.json(
          { error: `O dia de ${rotulo} deve estar entre 1 e 31` },
          { status: 400 }
        );
      }
      patch[campo] = valor;
    }

    if (body.name !== undefined) {
      if (!String(body.name).trim()) {
        return NextResponse.json(
          { error: "Nome da conta é obrigatório" },
          { status: 400 }
        );
      }
      patch.name = String(body.name).trim();
    }

    if (body.credit_limit !== undefined) {
      patch.credit_limit =
        body.credit_limit === null || body.credit_limit === ""
          ? null
          : parseFloat(body.credit_limit);
    }

    if (body.color_hex !== undefined) patch.color_hex = body.color_hex;
    if (body.icon !== undefined) patch.icon = body.icon;
    if (body.bank_name !== undefined)
      patch.bank_name = String(body.bank_name).trim() || null;
    if (body.last_four_digits !== undefined)
      patch.last_four_digits = String(body.last_four_digits).trim() || null;
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "Nada para alterar" }, { status: 400 });
    }

    const { data: account, error } = await supabase
      .from("financial_accounts")
      .update(patch)
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("Erro ao atualizar conta:", error);
      return NextResponse.json(
        { error: "Não foi possível atualizar a conta" },
        { status: 500 }
      );
    }

    if (!account) {
      return NextResponse.json(
        { error: "Conta não encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json({ account });
  } catch (error) {
    console.error("Update account error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

// DELETE /api/financial-accounts/{id}
//
// Arquiva (is_active = false) em vez de apagar. Apagar a conta apagaria em
// cascata o historico que aponta para ela: `financial_transactions.account_id`,
// as parcelas e as linhas de extrato ja conciliadas. O usuario que quer "tirar
// da lista" um cartao que nao usa mais nao esta pedindo para perder os gastos
// que fez nele -- e o saldo do mes passado mudaria sozinho.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { data: account, error } = await supabase
      .from("financial_accounts")
      .update({ is_active: false })
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Erro ao arquivar conta:", error);
      return NextResponse.json(
        { error: "Não foi possível arquivar a conta" },
        { status: 500 }
      );
    }

    if (!account) {
      return NextResponse.json(
        { error: "Conta não encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Archive account error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
