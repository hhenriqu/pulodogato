import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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
    const { group_id, email_or_phone, method = "email", message } = body;

    // Validações básicas
    if (!group_id || (!email_or_phone && method !== "code")) {
      return NextResponse.json(
        {
          error: "Missing required fields: group_id, email_or_phone",
        },
        { status: 400 }
      );
    }

    // Verificar se o usuário é admin do grupo
    const { data: membership, error: memberError } = await supabase
      .from("group_members")
      .select("role, group:expense_groups(*)")
      .eq("group_id", group_id)
      .eq("user_id", user.id)
      .eq("role", "admin")
      .eq("status", "active")
      .single();

    if (memberError || !membership) {
      return NextResponse.json(
        {
          error: "You must be an admin of this group to send invitations",
        },
        { status: 403 }
      );
    }

    // `group:expense_groups(*)` chega tipado como array: a FK aponta para UMA
    // linha, mas o tipo gerado nao sabe disso. Antes ninguem lia `group` (o
    // codigo usava o embed de outra consulta), e `group.group_code` reprova o tsc
    // sem esta normalizacao.
    const group = (
      Array.isArray(membership.group) ? membership.group[0] : membership.group
    ) as { name: string; group_code: string } | undefined;

    if (!group) {
      console.error("Admin sem grupo no embed:", { group_id, user: user.id });
      return NextResponse.json(
        { error: "Grupo não encontrado" },
        { status: 404 }
      );
    }

    // O CANAL DE ENTREGA E O PROPRIO APP (HMO-196)
    // ------------------------------------------------
    // Decisao do H.: "Nao usaremos email, sera enviando um convite para o
    // usuario referente daquele email". Ou seja o convite e entregue DENTRO do
    // app, no sino, para a conta dona daquele endereco -- e quem o encontra la
    // e `invited_user_id`.
    //
    // Daqui sai a regra que esta rota nao tinha: sem `invited_user_id` o convite
    // e invisivel para TODO MUNDO, para sempre. Nenhuma tela o lista, porque
    // toda leitura filtra por `invited_user_id = auth.uid()`. Antes a rota
    // gravava a linha de qualquer jeito e respondia sucesso -- 5 convites assim
    // foram criados em producao. Agora ela recusa e explica, em vez de deixar
    // lixo que parece convite enviado.
    if (method !== "email" || !email_or_phone.includes("@")) {
      return NextResponse.json(
        {
          error:
            "O convite é entregue dentro do app, então precisa de um email de " +
            "conta do PuloDoGato. Para convidar por telefone, passe o código do " +
            "grupo para a pessoa entrar pelo app.",
        },
        { status: 400 }
      );
    }

    // O erro era descartado aqui. Se a RPC falhar (ela e SECURITY DEFINER e
    // depende de GRANT para `authenticated`), "nao achei a conta" e "nao pude
    // procurar" sao a mesma resposta vazia -- e a segunda viraria uma recusa
    // dizendo que a pessoa nao tem conta, o que manda o admin caçar o problema
    // errado.
    const { data: contas, error: erroBusca } = await supabase.rpc(
      "get_user_by_email",
      { user_email: email_or_phone }
    );

    if (erroBusca) {
      console.error("Falha ao procurar a conta do convidado:", erroBusca);
      return NextResponse.json(
        { error: "Não foi possível verificar esse email agora" },
        { status: 500 }
      );
    }

    const invitedUserId: string | null = contas?.[0]?.id ?? null;

    if (!invitedUserId) {
      // Caso real e comum: a pessoa ainda nao usa o app. O codigo do grupo e a
      // saida honesta, e vai na resposta para o admin nao ter que ir buscar.
      return NextResponse.json(
        {
          error:
            `Não existe conta do PuloDoGato com o email ${email_or_phone}. ` +
            `Peça para a pessoa se cadastrar e entrar com o código ${group.group_code}, ` +
            `ou convide-a depois que a conta existir.`,
          group_code: group.group_code,
        },
        { status: 404 }
      );
    }

    // Convite pendente repetido: a chave e a CONTA, nao o texto digitado.
    // Casando por `invite_target` o mesmo convidado passava duas vezes so por
    // escrever "Leticia@..." na segunda -- `get_user_by_email` compara em LOWER,
    // este filtro comparava byte a byte. Duas linhas pendentes para a mesma
    // pessoa dao dois cartoes iguais no sino dela.
    const { data: convitesPendentes, error: erroPendentes } = await supabase
      .from("group_invitations")
      .select("id")
      .eq("group_id", group_id)
      .eq("invited_user_id", invitedUserId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString());

    if (erroPendentes) {
      console.error("Falha ao conferir convites pendentes:", erroPendentes);
      return NextResponse.json(
        { error: "Não foi possível verificar convites anteriores" },
        { status: 500 }
      );
    }

    if (convitesPendentes && convitesPendentes.length > 0) {
      return NextResponse.json(
        {
          error:
            "Essa pessoa já tem um convite pendente para este grupo, esperando " +
            "a resposta dela no app.",
        },
        { status: 400 }
      );
    }

    const { data: existingMember } = await supabase
      .from("group_members")
      .select("status")
      .eq("group_id", group_id)
      .eq("user_id", invitedUserId)
      .maybeSingle();

    if (existingMember && existingMember.status === "active") {
      return NextResponse.json(
        { error: "Essa pessoa já é membro do grupo" },
        { status: 400 }
      );
    }

    // Criar convite (expira em 14 dias)
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 dias

    // Sem embed no `.select()`. O admin aqui CONSEGUE ler o grupo e o proprio
    // perfil, entao os embeds antigos funcionavam -- mas o nome do grupo e o
    // codigo ja estao em `group`, vindos da checagem de admin logo acima, e
    // depender de embed foi justamente o que quebrou o lado do convidado.
    const { data: invitation, error: inviteError } = await supabase
      .from("group_invitations")
      .insert({
        group_id,
        invited_by: user.id,
        invite_method: method,
        invite_target: email_or_phone,
        invited_user_id: invitedUserId,
        message: message || null,
        expires_at: expiresAt.toISOString(),
      })
      .select("id, invite_method, invite_target, expires_at")
      .single();

    if (inviteError) {
      console.error("Invitation creation error:", inviteError);
      return NextResponse.json(
        { error: "Failed to create invitation" },
        { status: 500 }
      );
    }

    // A resposta agora descreve uma entrega que ACONTECEU. O convite esta na
    // caixa da pessoa: `invited_user_id` aponta para a conta dela, e
    // `list_my_group_invitations()` (migration 030) o entrega no sino do app
    // dela com o nome do grupo e o de quem convidou.
    const nomeConvidado = contas?.[0]?.full_name || email_or_phone;
    const responseMessage =
      `Convite enviado para ${nomeConvidado}. Ele aparece nas notificações do ` +
      `app dela, com Aceitar e Recusar, e vale por 14 dias.`;

    return NextResponse.json(
      {
        message: responseMessage,
        delivery: "in_app",
        invitation: {
          id: invitation.id,
          method: invitation.invite_method,
          target: invitation.invite_target,
          expires_at: invitation.expires_at,
          group: {
            name: group.name,
            code: group.group_code,
          },
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

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const group_id = url.searchParams.get("group_id");

    if (!group_id) {
      return NextResponse.json(
        {
          error: "Missing group_id parameter",
        },
        { status: 400 }
      );
    }

    // Verificar se o usuário é admin do grupo
    const { data: membership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", group_id)
      .eq("user_id", user.id)
      .eq("role", "admin")
      .eq("status", "active")
      .single();

    if (!membership) {
      return NextResponse.json(
        {
          error: "You must be an admin to view invitations",
        },
        { status: 403 }
      );
    }

    // Buscar convites do grupo
    const { data: invitations, error } = await supabase
      .from("group_invitations")
      .select(
        `
        *,
        inviter:profiles!group_invitations_invited_by_fkey(full_name, avatar_url),
        invited_user:profiles!group_invitations_invited_user_id_fkey(full_name, avatar_url)
      `
      )
      .eq("group_id", group_id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Database error:", error);
      return NextResponse.json(
        { error: "Failed to fetch invitations" },
        { status: 500 }
      );
    }

    return NextResponse.json({ invitations });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
