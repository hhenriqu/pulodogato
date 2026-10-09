import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { conferirEscrita } from "@/lib/escrita-conferida";

export const dynamic = "force-dynamic";

/**
 * Aprova ou recusa quem pediu para entrar no grupo pelo codigo.
 *
 * Grupo privado nao aceita entrada direta: `join_group_by_code`
 * (002_rls_lockdown.sql) grava o pedido como `pending` e devolve "aguardando
 * aprovacao do admin". Ate o HMO-190 nao existia nenhuma rota que tirasse o
 * membro desse estado, entao o pedido nunca era aprovado e o grupo nunca
 * aparecia para quem digitou o codigo.
 *
 * `memberId` no caminho e o id da LINHA de group_members (o `member.id` que a
 * tela ja tem em maos), nao o user_id.
 */
export async function POST(
  request: NextRequest,
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
    const body = await request.json().catch(() => ({}));
    const { action } = body as { action?: string };

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { error: "Ação inválida: use 'approve' ou 'reject'" },
        { status: 400 }
      );
    }

    // Só admin ativo do grupo decide.
    const { data: currentUserMembership, error: membershipError } =
      await supabase
        .from("group_members")
        .select("role")
        .eq("group_id", groupId)
        .eq("user_id", user.id)
        .eq("status", "active")
        .single();

    if (
      membershipError ||
      !currentUserMembership ||
      currentUserMembership.role !== "admin"
    ) {
      return NextResponse.json(
        { error: "Apenas administradores podem aprovar pedidos de entrada" },
        { status: 403 }
      );
    }

    // O alvo precisa estar `pending` neste grupo. O filtro por status tambem
    // impede que esta rota reative por engano quem foi removido do grupo.
    const { data: targetMember, error: targetError } = await supabase
      .from("group_members")
      .select("id, user:profiles!group_members_user_id_fkey(full_name)")
      .eq("id", memberId)
      .eq("group_id", groupId)
      .eq("status", "pending")
      .single();

    if (targetError || !targetMember) {
      return NextResponse.json(
        { error: "Pedido de entrada não encontrado" },
        { status: 404 }
      );
    }

    const novoStatus = action === "approve" ? "active" : "removed";

    // `.select()` + linhas afetadas (HMO-203). Sem contagem, `if (updateError)`
    // nao distingue "aprovou" de "nao escreveu nada": escrita filtrada pela RLS
    // volta sucesso com zero linha, e o `.eq("status","pending")` acrescenta um
    // segundo caminho para zero -- se o pedido foi respondido por outro admin
    // entre a leitura e a escrita, nenhuma linha casa. Nos dois casos a rota
    // respondia "X agora faz parte do grupo!" e X continuava de fora.
    const resposta = conferirEscrita(
      await supabase
        .from("group_members")
        .update({ status: novoStatus })
        .eq("id", memberId)
        .eq("group_id", groupId)
        .eq("status", "pending")
        .select("id"),
      "responder ao pedido de entrada"
    );

    if (!resposta.ok) {
      console.error("Error updating member status:", resposta);

      // Zero linha aqui e quase sempre corrida com outro admin, e isso nao e
      // erro de servidor: 409 com a frase que diz o que aconteceu. O resto
      // (erro de banco, `.select()` esquecido) continua 500.
      if (resposta.motivo === "nenhuma-linha") {
        return NextResponse.json(
          {
            error:
              "Esse pedido de entrada nao esta mais pendente -- outro " +
              "administrador pode ter respondido antes. Recarregue a lista.",
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: "Erro ao responder ao pedido de entrada" },
        { status: 500 }
      );
    }

    // O embed do Supabase vem como array; normalizamos para pegar o nome.
    const targetProfile = Array.isArray(targetMember.user)
      ? targetMember.user[0]
      : targetMember.user;
    const memberName = targetProfile?.full_name || "O participante";

    return NextResponse.json({
      success: true,
      message:
        action === "approve"
          ? `${memberName} agora faz parte do grupo!`
          : `Pedido de ${memberName} recusado.`,
      member_id: memberId,
      new_status: novoStatus,
    });
  } catch (error) {
    console.error("Error in member approval:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
