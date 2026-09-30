import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Função para lidar com resposta a convites
async function handleInvitationResponse(
  supabase: any,
  user: any,
  invitation_id: string,
  accept: boolean
) {
  try {
    // Buscar convite
    const { data: invitation, error: inviteError } = await supabase
      .from("group_invitations")
      .select(
        `
        *,
        group:expense_groups(id, name, description, group_type, created_by)
      `
      )
      .eq("id", invitation_id)
      .eq("invited_user_id", user.id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .single();

    if (inviteError || !invitation) {
      return NextResponse.json(
        { error: "Invitation not found or expired" },
        { status: 404 }
      );
    }

    if (accept) {
      // Verificar se já é membro
      const { data: existingMember } = await supabase
        .from("group_members")
        .select("status")
        .eq("group_id", invitation.group_id)
        .eq("user_id", user.id)
        .single();

      if (existingMember && existingMember.status === "active") {
        return NextResponse.json(
          { error: "You are already a member of this group" },
          { status: 400 }
        );
      }

      // Adicionar como membro ativo
      const { error: memberError } = await supabase
        .from("group_members")
        .upsert({
          group_id: invitation.group_id,
          user_id: user.id,
          role: "member",
          status: "active",
        });

      if (memberError) {
        console.error("Membership creation error:", memberError);
        return NextResponse.json(
          { error: "Failed to join group" },
          { status: 500 }
        );
      }

      // Marcar convite como aceito
      await supabase
        .from("group_invitations")
        .update({ status: "accepted" })
        .eq("id", invitation_id);

      return NextResponse.json(
        {
          message: `Successfully joined "${invitation.group.name}"!`,
          group: {
            id: invitation.group.id,
            name: invitation.group.name,
            description: invitation.group.description,
          },
        },
        { status: 200 }
      );
    } else {
      // Rejeitar convite
      await supabase
        .from("group_invitations")
        .update({ status: "rejected" })
        .eq("id", invitation_id);

      return NextResponse.json(
        { message: "Invitation rejected" },
        { status: 200 }
      );
    }
  } catch (error) {
    console.error("Invitation response error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { group_code, invitation_id, accept } = body;

    // Se é resposta a convite
    if (invitation_id !== undefined) {
      return await handleInvitationResponse(
        supabase,
        user,
        invitation_id,
        accept
      );
    }

    // Validações básicas para entrada por código
    if (!group_code || group_code.length !== 6) {
      return NextResponse.json(
        {
          error: "Group code must be 6 characters",
        },
        { status: 400 }
      );
    }

    // A entrada por código passa pela RPC join_group_by_code, não por
    // SELECT + INSERT direto. Com RLS ligada, quem ainda não é membro não
    // enxerga o grupo, então o SELECT pelo código voltaria vazio; e liberar o
    // INSERT direto na policy deixaria qualquer um entrar em qualquer grupo
    // sabendo só o UUID. A RPC valida o código e entra na mesma transação.
    // Ver database/migrations/002_rls_lockdown.sql.
    const { data: joined, error: joinError } = await supabase
      .rpc("join_group_by_code", { p_group_code: group_code })
      .single();

    if (joinError) {
      // no_data_found = código inválido; unique_violation = já é membro ATIVO
      if (joinError.code === "P0002" || joinError.code === "no_data_found") {
        return NextResponse.json(
          { error: "Grupo não encontrado — confira o código" },
          { status: 404 }
        );
      }
      // Desde a migration 029 o 23505 significa só uma coisa: a pessoa já é
      // membro `active`. Pedido pendente repetido não cai mais aqui -- a RPC
      // devolve `pending` e o caminho de sucesso abaixo cuida dele.
      //
      // Essa separação é o conserto da HMO-190: enquanto os dois estados
      // dividiam o mesmo 23505, quem estava esperando aprovação lia "você já é
      // membro deste grupo" e ia cobrar o dono do grupo por um acesso que o
      // app tinha acabado de afirmar que ela tinha. Aqui a frase é verificável:
      // quem é `active` enxerga o grupo na lista.
      if (joinError.code === "23505") {
        return NextResponse.json(
          { error: "Você já faz parte deste grupo" },
          { status: 400 }
        );
      }
      console.error("Join error:", joinError);
      return NextResponse.json(
        { error: "Failed to join group" },
        { status: 500 }
      );
    }

    const result = joined as {
      group_id: string;
      group_name: string;
      member_status: string;
    };

    // A mensagem do caso pendente descreve o ESTADO, não o ato de pedir: a RPC
    // é idempotente para quem já tem pedido na fila, então esta resposta serve
    // tanto para o primeiro pedido quanto para a quinta vez que a pessoa volta
    // para conferir -- e em nenhuma delas "pedido enviado agora" seria exato.
    return NextResponse.json(
      {
        message:
          result.member_status === "active"
            ? `Você entrou em "${result.group_name}"!`
            : "Seu pedido está aguardando aprovação de um administrador do grupo",
        group: {
          id: result.group_id,
          name: result.group_name,
          status: result.member_status,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
