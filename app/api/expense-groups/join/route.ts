import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Responder a um convite de grupo -- aceitar ou recusar.
//
// Isto era SELECT + upsert + UPDATE soltos, e estava quebrado de duas formas
// que so aparecem do lado de quem foi convidado (HMO-196):
//
//   1. o SELECT embutia `group:expense_groups(id, name, ...)`, e a RLS esconde o
//      grupo de quem ainda nao e membro. PostgREST devolve `group: null` sem
//      erro, entao `invitation.group.name` la embaixo era um TypeError -- que o
//      catch virava 500 "Internal server error". Aceitar um convite valido
//      respondia erro de servidor;
//   2. sem transacao, o upsert do membro podia gravar e o UPDATE do convite
//      falhar: a pessoa entrava no grupo e o convite ficava `pending` para
//      sempre, com o sino oferecendo Aceitar de novo.
//
// Agora e uma chamada a `respond_to_group_invitation` (migration 030): uma
// transacao, SECURITY DEFINER para poder ler o nome do grupo, e com a
// autorizacao ("o convite e endereçado a auth.uid()") checada dentro da funcao,
// nao no argumento que o cliente manda.
async function handleInvitationResponse(
  supabase: any,
  invitation_id: string,
  accept: boolean
) {
  const { data, error } = await supabase
    .rpc("respond_to_group_invitation", {
      p_invitation_id: invitation_id,
      p_accept: accept,
    })
    .single();

  if (error) {
    // no_data_found = nao e seu, ja foi respondido, venceu, ou o grupo foi
    // arquivado. Sao indistinguiveis de proposito: dizer qual dos quatro
    // confirmaria a existencia do convite de outra pessoa para quem chutou um id.
    if (error.code === "P0002" || error.code === "no_data_found") {
      return NextResponse.json(
        { error: "Convite não encontrado, expirado ou já respondido" },
        { status: 404 }
      );
    }
    console.error("Invitation response error:", error);
    return NextResponse.json(
      { error: "Não foi possível responder ao convite" },
      { status: 500 }
    );
  }

  const resultado = data as {
    group_id: string;
    group_name: string;
    member_status: string;
  };

  if (!accept) {
    return NextResponse.json({ message: "Convite recusado" }, { status: 200 });
  }

  return NextResponse.json(
    {
      message: `Você entrou no grupo "${resultado.group_name}"!`,
      group: {
        id: resultado.group_id,
        name: resultado.group_name,
        status: resultado.member_status,
      },
    },
    { status: 200 }
  );
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
      return await handleInvitationResponse(supabase, invitation_id, accept);
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
