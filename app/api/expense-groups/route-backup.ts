import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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

    // Primeiro, buscar os IDs dos grupos onde o usuário é membro
    const { data: userGroups, error: memberError } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", user.id)
      .eq("status", "active");

    if (memberError) {
      console.error("Member lookup error:", memberError);
      return NextResponse.json(
        { error: "Failed to fetch user groups" },
        { status: 500 }
      );
    }

    const groupIds = userGroups?.map((g) => g.group_id) || [];

    if (groupIds.length === 0) {
      return NextResponse.json({ groups: [] });
    }

    // Buscar os grupos e seus membros
    const { data: groups, error } = await supabase
      .from("expense_groups")
      .select(
        `
        *,
        creator:profiles!expense_groups_created_by_fkey(full_name, avatar_url),
        members:group_members!inner(
          id,
          role,
          status,
          percentage,
          user:profiles!group_members_user_id_fkey(id, full_name, avatar_url)
        )
      `
      )
      .in("id", groupIds)
      .eq("is_active", true)
      .eq("members.status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Database error:", error);
      return NextResponse.json(
        { error: "Failed to fetch groups" },
        { status: 500 }
      );
    }

    return NextResponse.json({ groups });
  } catch (error) {
    console.error("API error:", error);
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
    const {
      name,
      description,
      group_type = "private",
      default_split_type = "equal",
      photo_url,
    } = body;

    // Validações básicas
    if (!name || name.trim().length < 3) {
      return NextResponse.json(
        {
          error: "Group name must be at least 3 characters",
        },
        { status: 400 }
      );
    }

    if (!["public", "private"].includes(group_type)) {
      return NextResponse.json(
        {
          error: "Group type must be public or private",
        },
        { status: 400 }
      );
    }

    if (!["equal", "percentage", "custom"].includes(default_split_type)) {
      return NextResponse.json(
        {
          error: "Invalid default split type",
        },
        { status: 400 }
      );
    }

    // Criar grupo
    const { data: group, error: groupError } = await supabase
      .from("expense_groups")
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        group_type,
        default_split_type,
        photo_url: photo_url || null,
        created_by: user.id,
      })
      .select("*")
      .single();

    if (groupError) {
      console.error("Group creation error:", groupError);
      return NextResponse.json(
        { error: "Failed to create group" },
        { status: 500 }
      );
    }

    // Buscar grupo completo com relacionamentos após criação
    const { data: completeGroup, error: fetchError } = await supabase
      .from("expense_groups")
      .select(
        `
        *,
        creator:profiles!expense_groups_created_by_fkey(full_name, avatar_url),
        members:group_members!inner(
          id,
          role,
          status,
          percentage,
          user:profiles!group_members_user_id_fkey(id, full_name, avatar_url)
        )
      `
      )
      .eq("id", group.id)
      .eq("members.status", "active")
      .single();

    if (fetchError) {
      console.error("Group fetch error:", fetchError);
      // Retorna grupo básico se não conseguir buscar relacionamentos
      return NextResponse.json(
        {
          message: "Group created successfully",
          group: { ...group, creator: null, members: [] },
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      {
        message: "Group created successfully",
        group: completeGroup,
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
