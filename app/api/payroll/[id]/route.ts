// DELETE /api/payroll/{id}   apaga o contracheque
//
// Os descontos vao junto por ON DELETE CASCADE. O LANCAMENTO do liquido e
// apagado explicitamente aqui: a FK dele e ON DELETE SET NULL, entao sem este
// passo o contracheque sumiria da tela e a receita continuaria no extrato,
// orfa e sem nada que explicasse de onde veio.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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

    const { data: entry, error: fetchError } = await supabase
      .from("payroll_entries")
      .select("id, transaction_id")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchError) {
      console.error("Erro ao buscar contracheque:", fetchError);
      return NextResponse.json(
        { error: "Não foi possível apagar o contracheque" },
        { status: 500 }
      );
    }

    if (!entry) {
      return NextResponse.json(
        { error: "Contracheque não encontrado" },
        { status: 404 }
      );
    }

    // Primeiro o contracheque, depois o lancamento. Na ordem inversa, uma falha
    // no meio deixaria um contracheque apontando para transacao que nao existe
    // mais; nesta ordem, a falha deixa o lancamento -- que ainda e dinheiro que
    // de fato entrou na conta, e o usuario pode apagar pela tela de transacoes.
    const { error: deleteError } = await supabase
      .from("payroll_entries")
      .delete()
      .eq("id", params.id)
      .eq("user_id", user.id);

    if (deleteError) {
      console.error("Erro ao apagar contracheque:", deleteError);
      return NextResponse.json(
        { error: "Não foi possível apagar o contracheque" },
        { status: 500 }
      );
    }

    if (entry.transaction_id) {
      const { error: txError } = await supabase
        .from("financial_transactions")
        .delete()
        .eq("id", entry.transaction_id)
        .eq("user_id", user.id);

      if (txError) {
        console.error("Erro ao apagar o lancamento do liquido:", txError);
        return NextResponse.json(
          {
            error:
              "O contracheque foi apagado, mas o lançamento do líquido continua no extrato. Apague-o em Finanças Pessoais.",
          },
          { status: 207 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete payroll error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
