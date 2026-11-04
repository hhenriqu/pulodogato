import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  DESCRICAO_DA_CATEGORIA_DO_RECEBIMENTO,
  NOME_DA_CATEGORIA_DO_RECEBIMENTO,
  chaveDoPagamento,
  descricaoDoRecebimento,
  type PagamentoEntrePessoas,
} from "@/lib/pagamento-entre-pessoas";

/**
 * Quem recebeu confirma: escolhe a conta e a receita nasce NA SESSAO DELA
 * (081). A conta tem de ser dela (filtro por user_id, e a RLS de
 * financial_transactions recusaria de qualquer forma).
 *
 * Se ligar a receita ao pagamento falhar, a receita e apagada: nao fica
 * receita solta com o pagamento ainda "a lancar", que levaria a pessoa a
 * lancar de novo.
 */
export const dynamic = "force-dynamic";

type Cliente = ReturnType<typeof createClient>;

async function categoriaDoRecebimento(
  supabase: Cliente,
  userId: string,
  serviceId: string
): Promise<string | null> {
  const busca = () =>
    supabase
      .from("transaction_categories")
      .select("id")
      .eq("service_id", serviceId)
      .eq("user_id", userId)
      .eq("name", NOME_DA_CATEGORIA_DO_RECEBIMENTO)
      .maybeSingle();

  const { data: existente } = await busca();
  if (existente) return existente.id;

  const { data: criada, error } = await supabase
    .from("transaction_categories")
    .insert({
      service_id: serviceId,
      user_id: userId,
      name: NOME_DA_CATEGORIA_DO_RECEBIMENTO,
      description: DESCRICAO_DA_CATEGORIA_DO_RECEBIMENTO,
      icon: "users",
      color_hex: "#10B981",
      is_expense: false,
      is_active: true,
    })
    .select("id")
    .single();

  if (criada) return criada.id;
  if (error?.code === "23505") {
    const { data: recem } = await busca();
    return recem?.id ?? null;
  }
  console.error("[pagamentos-entre-pessoas] categoria", error);
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const accountId =
    typeof body?.account_id === "string" && body.account_id ? body.account_id : null;
  if (!accountId) {
    return NextResponse.json(
      { error: "Escolha a conta em que o dinheiro entrou." },
      { status: 400 }
    );
  }

  const { data: lista, error: erroLista } = await supabase.rpc(
    "meus_pagamentos_entre_pessoas"
  );
  if (erroLista) {
    console.error("[pagamentos-entre-pessoas] leitura", erroLista);
    return NextResponse.json({ error: "Não foi possível ler o pagamento." }, { status: 500 });
  }
  const pagamento = ((lista ?? []) as PagamentoEntrePessoas[]).find(
    (p) => p.id === params.id && p.papel === "recebi"
  );
  if (!pagamento) {
    return NextResponse.json({ error: "Pagamento não encontrado." }, { status: 404 });
  }
  if (pagamento.situacao === "lancado") {
    return NextResponse.json({ error: "Você já lançou esse recebimento." }, { status: 409 });
  }

  const { data: conta } = await supabase
    .from("financial_accounts")
    .select("id")
    .eq("user_id", user.id)
    .eq("id", accountId)
    .maybeSingle();
  if (!conta) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 400 });
  }

  const { data: servico } = await supabase
    .from("financial_services")
    .select("id")
    .eq("name", "personal_finance")
    .single();
  if (!servico) {
    return NextResponse.json(
      { error: "Serviço de finanças pessoais não encontrado" },
      { status: 404 }
    );
  }

  const categoriaId = await categoriaDoRecebimento(supabase, user.id, servico.id);
  if (!categoriaId) {
    return NextResponse.json(
      { error: "Não foi possível preparar a categoria do recebimento." },
      { status: 500 }
    );
  }

  const { data: receita, error: erroReceita } = await supabase
    .from("financial_transactions")
    .insert({
      user_id: user.id,
      service_id: servico.id,
      category_id: categoriaId,
      account_id: accountId,
      description: descricaoDoRecebimento(pagamento.outra_pessoa, pagamento.descricao),
      amount: Number(pagamento.valor),
      transaction_type: "income",
      transaction_date: pagamento.data,
      notes: chaveDoPagamento(pagamento.id),
    })
    .select("id")
    .single();

  if (erroReceita || !receita) {
    console.error("[pagamentos-entre-pessoas] receita", erroReceita);
    return NextResponse.json(
      { error: "Não foi possível lançar o recebimento." },
      { status: 500 }
    );
  }

  const { data: ligado, error: erroLigar } = await supabase
    .from("pagamentos_entre_pessoas")
    .update({ lancamento_do_recebedor: receita.id, recusado_em: null })
    .eq("id", pagamento.id)
    .eq("recebedor_id", user.id)
    .select("id");

  if (erroLigar || !ligado || ligado.length === 0) {
    console.error("[pagamentos-entre-pessoas] ligar", erroLigar);
    await supabase.from("financial_transactions").delete().eq("id", receita.id);
    return NextResponse.json(
      { error: "Não foi possível confirmar o recebimento." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, lancamento_id: receita.id });
}
