import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { moedaConhecida } from "@/lib/dinheiro";
import { taxaParaGravar } from "@/lib/cambio";
import { moedaDaViagem } from "@/lib/moeda-do-grupo";
import { respostaDoErroDoBanco } from "@/lib/membro-sem-conta";

/**
 * A DESPESA PAGA POR OUTRA PESSOA (migration 077, RN025).
 *
 * "O Joao pagou o carvao": quem esta com o app registra uma despesa que OUTRO
 * participante pagou -- com ou sem conta. Ela mora so no grupo
 * (`group_transactions` sem `transaction_id`): nao entra em conta nenhuma nem
 * no Resultado pessoal de ninguem, e conta inteira no saldo do grupo, com
 * a divisao pela regra do grupo (peso configurado ou partes iguais).
 *
 * A escrita e UMA chamada a `lancar_despesa_paga_por_membro` (077, SECAO 6),
 * que grava a despesa e as partes juntas. INSERT direto em `group_transactions`
 * sem `transaction_id` e recusado pela RLS, de proposito.
 *
 * POST   { paid_by_member_id, amount, description, expense_date?, currency?, exchange_rate? }
 * DELETE ?id=<group_transactions.id>  -- so despesa so do grupo; quem lancou ou o admin (RLS)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = params;
    const body = await request.json().catch(() => ({}));

    const pagador =
      typeof body?.paid_by_member_id === "string" ? body.paid_by_member_id : "";
    if (!pagador) {
      return NextResponse.json(
        { error: "Diga quem pagou a despesa." },
        { status: 400 }
      );
    }

    const valor = Math.abs(Number(body?.amount));
    if (!(valor > 0)) {
      return NextResponse.json(
        { error: "O valor da despesa tem que ser maior que zero." },
        { status: 400 }
      );
    }

    const descricao =
      typeof body?.description === "string" ? body.description.trim() : "";
    if (!descricao) {
      return NextResponse.json(
        { error: "Diga o que foi pago." },
        { status: 400 }
      );
    }

    if (body?.currency !== undefined && !moedaConhecida(body.currency)) {
      return NextResponse.json({ error: "Moeda desconhecida" }, { status: 400 });
    }

    const { data: grupo } = await supabase
      .from("expense_groups")
      .select("currency")
      .eq("id", groupId)
      .maybeSingle();

    const moeda = moedaConhecida(body?.currency)
      ? String(body.currency).trim().toUpperCase()
      : moedaDaViagem(grupo?.currency);

    const taxa = taxaParaGravar(moeda, Number(body?.exchange_rate));
    if (taxa === null) {
      return NextResponse.json(
        { error: `Informe a cotação de ${moeda} no dia da compra.` },
        { status: 400 }
      );
    }

    const data =
      typeof body?.expense_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.expense_date)
        ? body.expense_date
        : new Date().toISOString().slice(0, 10);

    const { data: id, error } = await supabase.rpc(
      "lancar_despesa_paga_por_membro",
      {
        p_group_id: groupId,
        p_paid_by_member_id: pagador,
        p_amount: Math.round(valor * 100) / 100,
        p_description: descricao,
        p_expense_date: data,
        p_currency: moeda,
        p_exchange_rate: taxa,
      }
    );

    if (error) {
      const { status, mensagem } = respostaDoErroDoBanco(error);
      console.error("Erro ao lancar despesa paga por outro:", error);
      return NextResponse.json({ error: mensagem }, { status });
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("Erro em POST despesa-paga-por-outro:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = params;
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Falta o id da despesa" }, { status: 400 });
    }

    // `transaction_id IS NULL`: esta rota nunca apaga a ligacao de uma despesa
    // com lancamento -- essa se apaga apagando o lancamento.
    const { data: apagadas, error } = await supabase
      .from("group_transactions")
      .delete()
      .eq("group_id", groupId)
      .eq("id", id)
      .is("transaction_id", null)
      .select("id");

    if (error) {
      const { status, mensagem } = respostaDoErroDoBanco(error);
      console.error("Erro ao apagar despesa paga por outro:", error);
      return NextResponse.json({ error: mensagem }, { status });
    }

    if (!apagadas || apagadas.length === 0) {
      return NextResponse.json(
        {
          error:
            "Despesa não encontrada, ou você não pode apagá-la (só quem lançou ou o admin).",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro em DELETE despesa-paga-por-outro:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
