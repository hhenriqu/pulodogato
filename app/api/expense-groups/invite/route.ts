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

    const group = membership.group;

    let invitedUserId = null;

    // Se método for email/phone, tentar encontrar usuário existente
    if (method === "email" && email_or_phone.includes("@")) {
      // Buscar usuário pelo email na tabela auth.users via RPC ou query específica
      const { data: existingUser } = await supabase.rpc("get_user_by_email", {
        user_email: email_or_phone,
      });

      if (existingUser && existingUser.length > 0) {
        invitedUserId = existingUser[0].id;
      }
    }

    // Verificar se já existe convite pendente
    const { data: existingInvite } = await supabase
      .from("group_invitations")
      .select("id, status")
      .eq("group_id", group_id)
      .eq("invite_target", email_or_phone)
      .eq("status", "pending")
      .single();

    if (existingInvite) {
      return NextResponse.json(
        {
          error: "Invitation already sent to this contact",
        },
        { status: 400 }
      );
    }

    // Se usuário já existe, verificar se já é membro
    if (invitedUserId) {
      const { data: existingMember } = await supabase
        .from("group_members")
        .select("status")
        .eq("group_id", group_id)
        .eq("user_id", invitedUserId)
        .single();

      if (existingMember && existingMember.status === "active") {
        return NextResponse.json(
          {
            error: "This user is already a member of the group",
          },
          { status: 400 }
        );
      }
    }

    // Criar convite (expira em 14 dias)
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 dias

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
      .select(
        `
        *,
        group:expense_groups(name, description, group_code),
        inviter:profiles!group_invitations_invited_by_fkey(full_name, avatar_url)
      `
      )
      .single();

    if (inviteError) {
      console.error("Invitation creation error:", inviteError);
      return NextResponse.json(
        { error: "Failed to create invitation" },
        { status: 500 }
      );
    }

    // NAO existe envio de email/SMS neste produto: nenhum provedor esta
    // configurado. Ate o HMO-190 esta rota respondia "Email invitation sent
    // to X" mesmo assim, entao o admin via "convite enviado" e o convidado
    // nunca recebia nada -- sem nenhum erro em lugar nenhum. Enquanto o envio
    // nao existir, a resposta diz a verdade e manda passar o codigo a mao.
    const responseMessage = `Convite registrado para ${email_or_phone}. O envio automático ainda não está disponível: passe o código ${invitation.group.group_code} para a pessoa entrar pelo app.`;

    return NextResponse.json(
      {
        message: responseMessage,
        delivery: "manual",
        invitation: {
          id: invitation.id,
          method: invitation.invite_method,
          target: invitation.invite_target,
          expires_at: invitation.expires_at,
          group: {
            name: invitation.group.name,
            code: invitation.group.group_code,
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
