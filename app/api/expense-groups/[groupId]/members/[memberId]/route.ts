import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { respostaDoErroDoBanco } from "@/lib/membro-sem-conta";

/**
 * Remove do grupo um participante SEM CONTA (migration 077).
 *
 * So quem nao tem conta: quem tem sai pela rota `leave`, que aplica as regras
 * de saida (docs/REGRAS_SAIDA_GRUPOS.md). E so quem ainda nao tem historico --
 * nenhuma parte de despesa, nenhuma despesa paga por ele, nenhum acerto.
 * Apagar a linha de quem ja dividiu algo mudaria o saldo dos outros sem
 * ninguem pagar nada, e as FKs da 077 recusariam a despesa e o acerto de
 * qualquer jeito. Com historico, a resposta e 409 e o caminho e acertar antes.
 *
 * Quem pode: o admin (RLS `group_members_delete`, 002).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { groupId: string; memberId: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId, memberId } = params;

    const { data: membro } = await supabase
      .from("group_members")
      .select("id, user_id")
      .eq("group_id", groupId)
      .eq("id", memberId)
      .maybeSingle();

    if (!membro) {
      return NextResponse.json(
        { error: "Participante não encontrado neste grupo" },
        { status: 404 }
      );
    }

    if (membro.user_id) {
      return NextResponse.json(
        {
          error:
            "Quem tem conta sai pelo próprio app. Aqui só se remove participante sem conta.",
        },
        { status: 400 }
      );
    }

    const [partes, pagas, acertos] = await Promise.all([
      supabase
        .from("group_expense_splits")
        .select("id", { count: "exact", head: true })
        .eq("member_id", memberId),
      supabase
        .from("group_transactions")
        .select("id", { count: "exact", head: true })
        .eq("paid_by_member_id", memberId),
      supabase
        .from("group_settlements")
        .select("id", { count: "exact", head: true })
        .eq("group_id", groupId)
        .or(`from_member_id.eq.${memberId},to_member_id.eq.${memberId}`),
    ]);

    const historico =
      (partes.count ?? 0) + (pagas.count ?? 0) + (acertos.count ?? 0);

    if (partes.error || pagas.error || acertos.error) {
      console.error(
        "Erro ao conferir o historico do participante:",
        partes.error || pagas.error || acertos.error
      );
      return NextResponse.json(
        { error: "Não foi possível conferir o histórico do participante" },
        { status: 500 }
      );
    }

    if (historico > 0) {
      return NextResponse.json(
        {
          error:
            "Este participante já tem despesas ou acertos no grupo. Remover agora mudaria o saldo dos outros.",
        },
        { status: 409 }
      );
    }

    const { data: apagadas, error } = await supabase
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("id", memberId)
      .is("user_id", null)
      .select("id");

    if (error) {
      const { status, mensagem } = respostaDoErroDoBanco(error);
      console.error("Erro ao remover participante sem conta:", error);
      return NextResponse.json({ error: mensagem }, { status });
    }

    // A RLS de DELETE nao da erro: ela so nao apaga. Zero linhas = nao e admin.
    if (!apagadas || apagadas.length === 0) {
      return NextResponse.json(
        { error: "Só o admin do grupo pode remover participante." },
        { status: 403 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro em DELETE member:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
