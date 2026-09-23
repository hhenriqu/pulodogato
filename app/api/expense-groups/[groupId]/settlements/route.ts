import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Acertos de contas do grupo: o registro de "Caio pagou R$ 130 para a Ana".
 *
 * GET  lista os acertos ja registrados, mais recentes primeiro.
 * POST registra um novo.
 *
 * O acerto NAO vira lancamento em financial_transactions -- ver a SECAO "POR
 * QUE UMA TABELA SO PARA ISSO" da migration 007. Quem quiser ver o dinheiro
 * sair da conta corrente lanca a transferencia por fora: sao fatos diferentes.
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

    // A RLS de group_settlements ja exige is_group_member, entao esta checagem
    // nao e o que protege o dado -- ela existe para devolver 403 em vez de uma
    // lista vazia, que e indistinguivel de "o grupo nao tem acerto nenhum".
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

    const { data: settlements, error } = await supabase
      .from("group_settlements")
      .select(
        `
        id,
        amount,
        settled_on,
        note,
        created_by,
        created_at,
        from_user:profiles!group_settlements_from_user_id_fkey (
          id, full_name, avatar_url
        ),
        to_user:profiles!group_settlements_to_user_id_fkey (
          id, full_name, avatar_url
        )
      `
      )
      .eq("group_id", groupId)
      .order("settled_on", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Erro ao listar acertos:", error);
      return NextResponse.json(
        { error: "Failed to load settlements" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      settlements: (settlements || []).map((s: any) => ({
        ...s,
        amount: Number(s.amount),
        // Quem registrou e quem pode desfazer -- a RLS de DELETE exige
        // created_by = auth.uid(). A tela usa isto para nao oferecer um botao
        // que vai falhar.
        can_delete: s.created_by === user.id,
      })),
    });
  } catch (error) {
    console.error("Erro em GET settlements:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

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
    const body = await request.json();

    const fromUserId = body.from_user_id;
    const toUserId = body.to_user_id;
    const amount = Number(body.amount);

    if (!fromUserId || !toUserId) {
      return NextResponse.json(
        { error: "from_user_id e to_user_id sao obrigatorios" },
        { status: 400 }
      );
    }

    if (fromUserId === toUserId) {
      return NextResponse.json(
        { error: "Um acerto precisa de duas pessoas diferentes" },
        { status: 400 }
      );
    }

    // `Number("abc")` e NaN e `NaN > 0` e false, entao este teste ja cobre o
    // valor nao numerico. O CHECK do banco cobriria de qualquer forma, mas com
    // um 500 em vez de uma mensagem legivel.
    if (!(amount > 0)) {
      return NextResponse.json(
        { error: "O valor do acerto tem que ser maior que zero" },
        { status: 400 }
      );
    }

    // Centavos: o valor vem da sugestao calculada em lib/settlement.ts, que ja
    // trabalha em centavos inteiros. Arredondar aqui impede que um cliente
    // mande 33.333333 e grave um valor que a coluna numeric(15,2) trunca
    // sozinha -- o acerto nao zeraria o saldo e ninguem saberia por que.
    const valor = Math.round(amount * 100) / 100;

    // Quem registra precisa ser parte no pagamento. A policy de INSERT da 007
    // exige o mesmo; aqui e so para a mensagem ser legivel em vez de 42501.
    if (fromUserId !== user.id && toUserId !== user.id) {
      return NextResponse.json(
        {
          error:
            "Voce so pode registrar um acerto em que paga ou recebe. Peca a quem participou.",
        },
        { status: 403 }
      );
    }

    // As duas partes precisam ser membros ativos: um acerto com quem nunca
    // esteve no grupo nao corresponde a divida nenhuma, e a RLS nao checa isso
    // (ela so olha quem esta gravando).
    const { data: partes } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("status", "active")
      .in("user_id", [fromUserId, toUserId]);

    if (!partes || partes.length !== 2) {
      return NextResponse.json(
        { error: "As duas pessoas precisam ser membros ativos do grupo" },
        { status: 400 }
      );
    }

    const { data: settlement, error } = await supabase
      .from("group_settlements")
      .insert({
        group_id: groupId,
        from_user_id: fromUserId,
        to_user_id: toUserId,
        amount: valor,
        settled_on: body.settled_on || new Date().toISOString().slice(0, 10),
        note: body.note || null,
        created_by: user.id,
      })
      .select("id, amount, settled_on, note, created_at")
      .single();

    if (error) {
      // 42501 = a policy da 007 barrou. Acontece quando o banco ainda nao tem a
      // migration aplicada com a regra que esta rota assume.
      const status = error.code === "42501" ? 403 : 500;
      console.error("Erro ao registrar acerto:", error);
      return NextResponse.json(
        { error: "Nao foi possivel registrar o acerto" },
        { status }
      );
    }

    return NextResponse.json({
      success: true,
      settlement: { ...settlement, amount: Number(settlement.amount) },
    });
  } catch (error) {
    console.error("Erro em POST settlements:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
