import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = createClient();

    // Verificar autenticação
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    // Buscar grupos do usuário
    const { data: groupsData, error } = await supabase
      .from("group_members")
      .select(
        `
        role,
        user_groups (
          id,
          name,
          description,
          owner_id,
          is_private,
          max_members,
          invite_code,
          created_at
        )
      `
      )
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json(
        { error: "Erro ao buscar grupos" },
        { status: 500 }
      );
    }

    // Adicionar contagem de membros para cada grupo
    const groups = await Promise.all(
      (groupsData || []).map(async (item: any) => {
        const group = item.user_groups;
        const { count } = await supabase
          .from("group_members")
          .select("*", { count: "exact" })
          .eq("group_id", group.id);

        return {
          ...group,
          member_count: count || 0,
          user_role: item.role,
        };
      })
    );

    return NextResponse.json(groups);
  } catch (error) {
    console.error("Error in groups GET:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createClient();

    // Verificar autenticação
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, is_private, max_members } = body;

    // Validações
    if (!name || name.trim().length < 3) {
      return NextResponse.json(
        { error: "Nome do grupo deve ter pelo menos 3 caracteres" },
        { status: 400 }
      );
    }

    if (name.length > 50) {
      return NextResponse.json(
        { error: "Nome do grupo deve ter no máximo 50 caracteres" },
        { status: 400 }
      );
    }

    if (description && description.length > 200) {
      return NextResponse.json(
        { error: "Descrição deve ter no máximo 200 caracteres" },
        { status: 400 }
      );
    }

    const maxMembersNum = parseInt(max_members) || 10;
    if (maxMembersNum < 2 || maxMembersNum > 50) {
      return NextResponse.json(
        { error: "Número máximo de membros deve ser entre 2 e 50" },
        { status: 400 }
      );
    }

    // Gerar código de convite se for grupo privado
    const inviteCode = is_private
      ? Math.random().toString(36).substring(2, 8).toUpperCase()
      : null;

    // Criar grupo
    const { data: group, error: groupError } = await supabase
      .from("user_groups")
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        owner_id: user.id,
        is_private: Boolean(is_private),
        max_members: maxMembersNum,
        invite_code: inviteCode,
      })
      .select()
      .single();

    if (groupError) {
      console.error("Error creating group:", groupError);
      return NextResponse.json(
        { error: "Erro ao criar grupo" },
        { status: 500 }
      );
    }

    // Adicionar owner como membro
    const { error: memberError } = await supabase.from("group_members").insert({
      group_id: group.id,
      user_id: user.id,
      role: "owner",
    });

    if (memberError) {
      console.error("Error adding owner as member:", memberError);
      // Tentar deletar o grupo se falhou ao adicionar o owner
      await supabase.from("user_groups").delete().eq("id", group.id);
      return NextResponse.json(
        { error: "Erro ao criar grupo" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ...group,
        member_count: 1,
        user_role: "owner",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error in groups POST:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
