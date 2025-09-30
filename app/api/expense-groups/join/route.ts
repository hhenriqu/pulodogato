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

    // Verificar se o grupo existe e está ativo
    const { data: group, error: groupError } = await supabase
      .from("expense_groups")
      .select(
        `
        *,
        creator:profiles!expense_groups_created_by_fkey(full_name, avatar_url),
        members:group_members(
          id,
          user_id,
          status,
          user:profiles!group_members_user_id_fkey(full_name, avatar_url)
        )
      `
      )
      .eq("group_code", group_code.toUpperCase())
      .eq("is_active", true)
      .single();

    if (groupError || !group) {
      return NextResponse.json(
        {
          error: "Group not found or invalid code",
        },
        { status: 404 }
      );
    }

    // Verificar se o usuário já é membro
    const existingMember = group.members?.find(
      (member: any) => member.user_id === user.id
    );

    if (existingMember) {
      if (existingMember.status === "active") {
        return NextResponse.json(
          {
            error: "You are already a member of this group",
          },
          { status: 400 }
        );
      }

      if (existingMember.status === "pending") {
        return NextResponse.json(
          {
            error: "Your membership is pending approval",
          },
          { status: 400 }
        );
      }
    }

    // Se o grupo é público, adicionar diretamente
    // Se é privado, criar solicitação de entrada
    const memberStatus = group.group_type === "public" ? "active" : "pending";

    // Adicionar como membro
    const { data: membership, error: memberError } = await supabase
      .from("group_members")
      .insert({
        group_id: group.id,
        user_id: user.id,
        role: "member",
        status: memberStatus,
      })
      .select()
      .single();

    if (memberError) {
      console.error("Membership creation error:", memberError);
      return NextResponse.json(
        { error: "Failed to join group" },
        { status: 500 }
      );
    }

    // Se é grupo privado, criar registro de convite como solicitação
    if (group.group_type === "private") {
      await supabase.from("group_invitations").insert({
        group_id: group.id,
        invited_by: user.id, // Auto-convite via código
        invite_method: "code",
        invite_target: user.id,
        invited_user_id: user.id,
        status: "pending",
        expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48h
      });

      return NextResponse.json(
        {
          message: "Request sent! Waiting for admin approval",
          group: {
            id: group.id,
            name: group.name,
            description: group.description,
            status: "pending",
          },
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      {
        message: "Successfully joined the group!",
        group: {
          id: group.id,
          name: group.name,
          description: group.description,
          status: "active",
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
