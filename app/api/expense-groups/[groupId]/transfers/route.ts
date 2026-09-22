import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  simplifySettlements,
  residual,
  transfersForUser,
  type MemberBalance,
} from "@/lib/settlement";

/**
 * Acerto simplificado: quem paga quanto para quem, no menor numero de Pix.
 *
 * Duas mudancas em relacao a versao anterior:
 *
 *  1. O saldo vem da view `group_member_balances` (007), a mesma que a rota de
 *     balances le -- antes cada uma calculava do seu jeito e as duas podiam
 *     discordar na mesma tela. E agora os acertos ja registrados abatem: a
 *     sugestao SOME depois que o pagamento e registrado, que era o passo que
 *     faltava para a funcionalidade inteira fazer sentido.
 *  2. O algoritmo saiu daqui para lib/settlement.ts, onde e testado em
 *     centavos inteiros (npm run test:settlement). Em ponto flutuante, tres
 *     pessoas dividindo R$ 100 deixavam residuo que virava transferencia de
 *     R$ 0,00 -- ou um "voce ainda deve" que pagamento nenhum zerava.
 */
export async function GET(
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

    const { data: membership } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { data: linhas, error } = await supabase
      .from("group_member_balances")
      .select("user_id, net_balance")
      .eq("group_id", groupId);

    if (error) {
      console.error("Erro ao ler saldos para o acerto:", error);
      return NextResponse.json(
        { error: "Failed to load balances" },
        { status: 500 }
      );
    }

    const userIds = (linhas || []).map((l: any) => l.user_id);
    const { data: perfis } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", userIds.length > 0 ? userIds : [user.id]);

    const perfilPor = new Map((perfis || []).map((p: any) => [p.id, p]));

    const balances: MemberBalance[] = (linhas || []).map((l: any) => ({
      user_id: l.user_id,
      net_balance: Number(l.net_balance),
      full_name: perfilPor.get(l.user_id)?.full_name ?? null,
      avatar_url: perfilPor.get(l.user_id)?.avatar_url ?? null,
    }));

    const transfers = simplifySettlements(balances);
    const sobra = residual(balances);
    const meus = transfersForUser(transfers, user.id);

    return NextResponse.json({
      success: true,
      // O formato antigo (`from`/`to` com o perfil inteiro) fica, para a tela
      // que ja consome esta rota nao quebrar no mesmo deploy.
      transfers: transfers.map((t) => ({
        from: {
          id: t.from_user_id,
          full_name: t.from_name,
          avatar_url: perfilPor.get(t.from_user_id)?.avatar_url ?? null,
        },
        to: {
          id: t.to_user_id,
          full_name: t.to_name,
          avatar_url: perfilPor.get(t.to_user_id)?.avatar_url ?? null,
        },
        amount: t.amount,
      })),
      my_transfers: meus,
      // Diferente de zero significa que o grupo NAO fecha -- despesa sem
      // rateio, rateio parcial, ou parte de quem ja saiu. A tela avisa em vez
      // de exibir um acerto impossivel de concluir.
      residual: sobra,
      is_balanced: Math.abs(sobra) < 0.02,
    });
  } catch (error) {
    console.error("Erro em GET transfers:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
