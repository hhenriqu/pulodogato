import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { problemaDoPedido } from "@/lib/pagamento-entre-pessoas";

/**
 * Pagamento entre pessoas (081) -- ver `lib/pagamento-entre-pessoas.ts`.
 *
 * GET  os pagamentos de quem chama, dos dois lados, com o nome do outro.
 * POST { lancamento_id, recebedor_id } marca a despesa de quem chama como
 *      pagamento para outra pessoa da familia. Quem recebe passa a ver
 *      "a lancar". Tudo na sessao de quem chama: a policy e a trava PDG81 da
 *      081 conferem dono, valor e grupo em comum.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.rpc("meus_pagamentos_entre_pessoas");
  if (error) {
    console.error("[pagamentos-entre-pessoas] leitura", error);
    return NextResponse.json(
      { error: "Não foi possível ler os pagamentos" },
      { status: 500 }
    );
  }
  return NextResponse.json({ pagamentos: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pedido = problemaDoPedido(await request.json().catch(() => null));
  if (!pedido.ok) {
    return NextResponse.json({ error: pedido.erro }, { status: 400 });
  }

  const { data: lancamento } = await supabase
    .from("financial_transactions")
    .select("id, amount, transaction_date, description")
    .eq("id", pedido.lancamentoId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!lancamento) {
    return NextResponse.json(
      { error: "Lançamento não encontrado." },
      { status: 404 }
    );
  }
  if (Number(lancamento.amount) >= 0) {
    return NextResponse.json(
      { error: "Só uma saída pode ser pagamento para outra pessoa." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("pagamentos_entre_pessoas")
    .insert({
      pagador_id: user.id,
      recebedor_id: pedido.recebedorId,
      valor: Math.abs(Number(lancamento.amount)),
      data: lancamento.transaction_date,
      descricao: lancamento.description,
      lancamento_do_pagador: lancamento.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Esse lançamento já foi marcado como pagamento." },
        { status: 409 }
      );
    }
    if (error.code === "42501") {
      return NextResponse.json(
        { error: "Só dá para pagar quem está num grupo ativo com você." },
        { status: 403 }
      );
    }
    console.error("[pagamentos-entre-pessoas] criar", error);
    return NextResponse.json(
      { error: "Não foi possível avisar quem recebeu." },
      { status: 500 }
    );
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
