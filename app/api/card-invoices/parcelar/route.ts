// POST   /api/card-invoices/parcelar   { account_id, month: 'AAAA-MM', parcelas, juros? }
// DELETE /api/card-invoices/parcelar   { account_id, month: 'AAAA-MM' }
//
// Parcelar a fatura: ela fecha em zero e o total entra em `parcelas` faturas
// seguintes, com os juros como despesa. A regra esta em
// lib/mover-e-parcelar-fatura.ts; o DELETE desfaz pela chave em `notes`.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  CATEGORIA_DO_PARCELAMENTO,
  chaveParcelamento,
  planoDoParcelamento,
} from "@/lib/mover-e-parcelar-fatura";
import { CATEGORIAS_DO_PAGAMENTO_PARCIAL } from "@/lib/pagamento-parcial-da-fatura";
import { categoriaReservada } from "@/lib/services/categoria-reservada";
import { faturaParaMexer } from "@/lib/services/fatura-para-mexer";
import { today } from "@/lib/recurrence";

async function autenticar() {
  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return { supabase, user: error ? null : user };
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await autenticar();
    if (!user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const fatura = await faturaParaMexer(supabase, user.id, body);
    if (!fatura.ok) return fatura.resposta;
    const { mes, cartao, pendenteId } = fatura;
    const chave = chaveParcelamento(mes, cartao.id)!;

    const { data: jaParcelada } = await supabase
      .from("financial_transactions")
      .select("id")
      .eq("user_id", user.id)
      .eq("account_id", cartao.id)
      .eq("notes", chave)
      .limit(1);
    if (jaParcelada && jaParcelada.length > 0) {
      return NextResponse.json(
        { error: "Esta fatura já foi parcelada" },
        { status: 409 }
      );
    }

    const { data: linhas, error: erroLinhas } = await supabase
      .from("card_invoice_lines")
      .select("invoice_amount")
      .eq("account_id", cartao.id)
      .eq("invoice_month", mes);
    if (erroLinhas) {
      console.error("Erro ao ler a fatura a parcelar:", erroLinhas);
      return NextResponse.json(
        { error: "Não foi possível ler a fatura" },
        { status: 500 }
      );
    }
    const totalEmCentavos = (linhas ?? []).reduce(
      (soma: number, l: { invoice_amount: number | string }) =>
        soma + Math.round(Number(l.invoice_amount) * 100),
      0
    );

    const plano = planoDoParcelamento({
      total: totalEmCentavos / 100,
      parcelas: Number(body.parcelas),
      juros: body.juros != null && body.juros !== "" ? Number(body.juros) : null,
      mes,
      cartaoId: cartao.id,
      hoje: today(),
    });
    if (!plano.ok) {
      return NextResponse.json({ error: plano.erro }, { status: 400 });
    }

    const servico = await supabase
      .from("financial_services")
      .select("id")
      .eq("name", "personal_finance")
      .single();
    if (!servico.data) {
      return NextResponse.json(
        { error: "Serviço de finanças pessoais não encontrado" },
        { status: 404 }
      );
    }
    const serviceId = servico.data.id as string;

    const categoriaDasParcelas = await categoriaReservada(
      supabase,
      user.id,
      serviceId,
      CATEGORIA_DO_PARCELAMENTO
    );
    const temJuros = plano.linhas.some((l) => l.papel === "juros");
    const categoriaDosJuros = temJuros
      ? await categoriaReservada(
          supabase,
          user.id,
          serviceId,
          CATEGORIAS_DO_PAGAMENTO_PARCIAL.encargo
        )
      : null;
    if (!categoriaDasParcelas || (temJuros && !categoriaDosJuros)) {
      return NextResponse.json(
        { error: "Não foi possível preparar o parcelamento" },
        { status: 500 }
      );
    }

    const { data: criadas, error: erroCriar } = await supabase
      .from("financial_transactions")
      .insert(
        plano.linhas.map(({ papel, ...linha }) => ({
          ...linha,
          user_id: user.id,
          service_id: serviceId,
          group_id: null,
          category_id:
            papel === "juros" ? categoriaDosJuros!.id : categoriaDasParcelas.id,
        }))
      )
      .select("id");
    if (erroCriar || !criadas || criadas.length !== plano.linhas.length) {
      const parciais = (criadas ?? []).map((l: { id: string }) => l.id);
      if (parciais.length > 0) {
        await supabase.from("financial_transactions").delete().in("id", parciais);
      }
      console.error("Erro ao parcelar a fatura:", erroCriar);
      return NextResponse.json(
        { error: "Não foi possível parcelar a fatura. Nada foi lançado." },
        { status: 500 }
      );
    }

    // A conta a pagar do total antigo sai da agenda: a fatura agora fecha em
    // zero, e cada parcela entra na fatura do mes dela.
    if (pendenteId) {
      const { error: erroAgenda } = await supabase
        .from("scheduled_transactions")
        .delete()
        .eq("id", pendenteId)
        .eq("user_id", user.id)
        .eq("status", "pending");
      if (erroAgenda) {
        await supabase
          .from("financial_transactions")
          .delete()
          .in(
            "id",
            criadas.map((l: { id: string }) => l.id)
          );
        console.error("Parcelamento desfeito: a conta a pagar não saiu:", erroAgenda);
        return NextResponse.json(
          { error: "Não foi possível parcelar a fatura. Nada foi lançado." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        message: `Fatura parcelada em ${plano.parcelas.length}x`,
        parcelas: plano.parcelas,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Erro ao parcelar a fatura:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { supabase, user } = await autenticar();
    if (!user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const fatura = await faturaParaMexer(supabase, user.id, body);
    if (!fatura.ok) return fatura.resposta;
    const chave = chaveParcelamento(fatura.mes, fatura.cartao.id)!;

    const { data: apagadas, error } = await supabase
      .from("financial_transactions")
      .delete()
      .eq("user_id", user.id)
      .eq("account_id", fatura.cartao.id)
      .eq("notes", chave)
      .select("id");
    if (error) {
      console.error("Erro ao desfazer o parcelamento:", error);
      return NextResponse.json(
        { error: "Não foi possível desfazer o parcelamento" },
        { status: 500 }
      );
    }
    if (!apagadas || apagadas.length === 0) {
      return NextResponse.json(
        { error: "Esta fatura não está parcelada" },
        { status: 404 }
      );
    }
    return NextResponse.json({ message: "Parcelamento desfeito" });
  } catch (error) {
    console.error("Erro ao desfazer o parcelamento:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
