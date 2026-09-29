import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// =====================================================
// DELETE /api/investments/transactions/:transactionId
// =====================================================
// Apaga um lancamento. E como se corrige uma compra digitada errada: nao ha
// PATCH de lancamento.
//
// Por que nao ha PATCH: mudar quantidade ou preco de um lancamento antigo
// reescreve o preco medio de toda a serie DEPOIS dele, incluindo o resultado
// realizado de vendas que ja aconteceram. Apagar e lancar de novo produz o mesmo
// efeito, e deixa visivel para o usuario que a carteira mudou de forma.
//
// Apagar uma COMPRA pode deixar a posicao com quantidade negativa se ja houver
// venda em cima dela. Isso nao e barrado aqui de proposito -- barrar obrigaria o
// usuario a desfazer a venda primeiro sem dizer isso em lugar nenhum, e ele
// ficaria preso com um lancamento errado na tela. lib/investments.ts trava a
// quantidade em zero e marca `exceeded_position`, e a tela avisa.
// =====================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: { transactionId: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("investment_transactions")
      .delete()
      .eq("id", params.transactionId)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: `Erro ao apagar lancamento: ${error.message}` },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Lancamento nao encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json({ deleted: data.id });
  } catch (error) {
    console.error(
      "Erro em DELETE /api/investments/transactions/:transactionId:",
      error
    );
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
