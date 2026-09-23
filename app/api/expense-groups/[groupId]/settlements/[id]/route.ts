import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Desfaz um acerto registrado por engano.
 *
 * So quem registrou desfaz -- a policy de DELETE da 007 exige
 * `created_by = auth.uid()`. Sem isso, qualquer membro poderia apagar o
 * comprovante de um pagamento que recebeu e cobrar de novo.
 *
 * Apagar devolve a divida ao estado anterior por construcao: o saldo e
 * calculado na leitura (view group_member_balances) e nao existe coluna de
 * saldo congelada para ficar fora de sincronia.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { groupId: string; id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId, id } = params;

    const { data: apagados, error } = await supabase
      .from("group_settlements")
      .delete()
      .eq("id", id)
      .eq("group_id", groupId)
      .select("id");

    if (error) {
      console.error("Erro ao desfazer acerto:", error);
      return NextResponse.json(
        { error: "Nao foi possivel desfazer o acerto" },
        { status: 500 }
      );
    }

    // A RLS nao devolve erro quando a linha nao passa na policy -- ela some do
    // resultado, e o DELETE "funciona" apagando zero linhas. Sem esta
    // checagem a tela diria "acerto desfeito" e o valor continuaria la.
    if (!apagados || apagados.length === 0) {
      return NextResponse.json(
        {
          error:
            "Acerto nao encontrado, ou registrado por outra pessoa. Quem registrou e quem desfaz.",
        },
        { status: 403 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro em DELETE settlement:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
