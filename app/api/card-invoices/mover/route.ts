// POST /api/card-invoices/mover   { account_id, month: 'AAAA-MM' }
//
// "Mover para o proximo vencimento", como no Minhas Financas: toda linha do
// cartao que cai na fatura `month` passa para a fatura seguinte
// (`invoice_month_override`, 041). O saldo do cartao nao muda. A regra e as
// recusas estao em lib/mover-e-parcelar-fatura.ts e
// lib/services/fatura-para-mexer.ts.
//
// A ORDEM: primeiro as linhas andam, depois a fatura fechada (se havia) sai da
// agenda. Se a segunda escrita falhar, as linhas voltam para onde estavam --
// "nada mudou" e o pior caso, nunca uma conta a pagar do total antigo numa
// fatura que ficou vazia.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { somarMeses } from "@/lib/mover-e-parcelar-fatura";
import { faturaParaMexer } from "@/lib/services/fatura-para-mexer";

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const fatura = await faturaParaMexer(supabase, user.id, body);
    if (!fatura.ok) return fatura.resposta;
    const { mes, cartao, pendenteId } = fatura;
    const seguinte = somarMeses(mes, 1)!;

    const { data: linhas, error: erroLinhas } = await supabase
      .from("card_invoice_lines")
      .select("transaction_id")
      .eq("account_id", cartao.id)
      .eq("invoice_month", mes);
    if (erroLinhas) {
      console.error("Erro ao ler as linhas da fatura:", erroLinhas);
      return NextResponse.json(
        { error: "Não foi possível ler a fatura" },
        { status: 500 }
      );
    }
    const ids = (linhas ?? []).map(
      (l: { transaction_id: string }) => l.transaction_id
    );
    if (ids.length === 0) {
      return NextResponse.json(
        { error: "Esta fatura não tem lançamentos" },
        { status: 409 }
      );
    }

    // O valor antigo de cada linha, para desfazer.
    const { data: antes, error: erroAntes } = await supabase
      .from("financial_transactions")
      .select("id, invoice_month_override")
      .eq("user_id", user.id)
      .in("id", ids);
    if (erroAntes || !antes || antes.length !== ids.length) {
      console.error("Erro ao ler as linhas a mover:", erroAntes);
      return NextResponse.json(
        { error: "Não foi possível mover a fatura" },
        { status: 500 }
      );
    }

    const { data: movidas, error: erroMover } = await supabase
      .from("financial_transactions")
      .update({ invoice_month_override: seguinte })
      .eq("user_id", user.id)
      .in("id", ids)
      .select("id");

    const desfazer = async () => {
      const porValor = new Map<string | null, string[]>();
      for (const l of antes as { id: string; invoice_month_override: string | null }[]) {
        const lista = porValor.get(l.invoice_month_override) ?? [];
        lista.push(l.id);
        porValor.set(l.invoice_month_override, lista);
      }
      for (const [valor, lista] of Array.from(porValor.entries())) {
        await supabase
          .from("financial_transactions")
          .update({ invoice_month_override: valor })
          .eq("user_id", user.id)
          .in("id", lista);
      }
    };

    if (erroMover || !movidas || movidas.length !== ids.length) {
      // Contagem menor e o UPDATE que a RLS filtrou em parte.
      await desfazer();
      console.error("Erro ao mover a fatura:", erroMover);
      return NextResponse.json(
        { error: "Não foi possível mover a fatura. Nada mudou." },
        { status: 500 }
      );
    }

    if (pendenteId) {
      const { error: erroAgenda } = await supabase
        .from("scheduled_transactions")
        .delete()
        .eq("id", pendenteId)
        .eq("user_id", user.id)
        .eq("status", "pending");
      if (erroAgenda) {
        await desfazer();
        console.error("Fatura não movida: a conta a pagar não saiu:", erroAgenda);
        return NextResponse.json(
          { error: "Não foi possível mover a fatura. Nada mudou." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      message: `Fatura movida para o vencimento seguinte`,
      moved: ids.length,
      from_month: mes,
      to_month: seguinte,
    });
  } catch (error) {
    console.error("Erro ao mover a fatura:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
