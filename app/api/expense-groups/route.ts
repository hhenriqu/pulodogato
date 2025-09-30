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

    console.log("👤 USUÁRIO API:", user.id, user.email);

    // ABORDAGEM ALTERNATIVA: Usar RPC (Remote Procedure Call) para evitar problemas de RLS
    try {
      // Primeiro, buscar grupos usando uma função SQL personalizada ou query direta
      const { data: groupsData, error: groupsError } = await supabase.rpc(
        "get_user_groups",
        {
          user_id_param: user.id,
        }
      );

      console.log("🔧 TENTATIVA RPC:", { groupsData, groupsError });

      // Se RPC falhar, usar abordagem manual (sempre usar manual para garantir)
      // if (groupsError) {
      console.log("🔧 Usando abordagem manual para garantir funcionamento...");

      // Buscar todos os grupos primeiro
      const { data: allGroups, error: allGroupsError } = await supabase
        .from("expense_groups")
        .select(
          `
            id,
            name,
            description,
            group_code,
            group_type,
            default_split_type,
            photo_url,
            created_at,
            created_by,
            creator:profiles!expense_groups_created_by_fkey(full_name, avatar_url)
          `
        )
        .eq("is_active", true);

      if (allGroupsError) {
        console.error("Erro ao buscar grupos:", allGroupsError);
        return NextResponse.json(
          { error: "Failed to fetch groups" },
          { status: 500 }
        );
      }

      // Buscar todos os membros
      const { data: allMembers, error: allMembersError } = await supabase
        .from("group_members")
        .select(
          `
            id,
            group_id,
            user_id,
            role,
            status,
            percentage,
            user:profiles!group_members_user_id_fkey(id, full_name, avatar_url)
          `
        )
        .eq("status", "active");

      if (allMembersError) {
        console.error("Erro ao buscar membros:", allMembersError);
        return NextResponse.json(
          { error: "Failed to fetch members" },
          { status: 500 }
        );
      }

      console.log("📊 DADOS BRUTOS:", {
        totalGroups: allGroups?.length || 0,
        totalMembers: allMembers?.length || 0,
        userGroups:
          allMembers
            ?.filter((m) => m.user_id === user.id)
            .map((m) => m.group_id) || [],
      });

      // Filtrar grupos onde o usuário é membro
      const userGroupIds =
        allMembers
          ?.filter((member) => member.user_id === user.id)
          ?.map((member) => member.group_id) || [];

      const userGroups =
        allGroups?.filter((group) => userGroupIds.includes(group.id)) || [];

      // Combinar grupos com seus membros
      const groupsWithMembers = userGroups.map((group) => ({
        ...group,
        members:
          allMembers?.filter((member) => member.group_id === group.id) || [],
      }));

      console.log("🎯 RESULTADO FINAL:", {
        groupsCount: groupsWithMembers.length,
        groups: groupsWithMembers.map((g) => ({
          id: g.id,
          name: g.name,
          membersCount: g.members.length,
          memberNames: g.members
            .map((m: any) => m.user?.full_name)
            .filter(Boolean),
        })),
      });

      return NextResponse.json({ groups: groupsWithMembers });
    } catch (apiError) {
      console.error("Erro na API:", apiError);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Manter POST existente
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
        { error: "Group name must be at least 3 characters" },
        { status: 400 }
      );
    }

    if (!["public", "private"].includes(group_type)) {
      return NextResponse.json(
        { error: "Group type must be public or private" },
        { status: 400 }
      );
    }

    if (
      !["equal", "percentage", "custom", "proportional"].includes(
        default_split_type
      )
    ) {
      return NextResponse.json(
        { error: "Invalid default split type" },
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

    // Buscar grupo completo básico (sem joins complexos)
    const completeGroup = {
      ...group,
      creator: {
        full_name: user.user_metadata?.full_name || user.email,
        avatar_url: null,
      },
      members: [
        {
          id: "temp-id",
          role: "admin",
          status: "active",
          percentage: 0,
          user: {
            id: user.id,
            full_name: user.user_metadata?.full_name || user.email,
            avatar_url: null,
          },
        },
      ],
    };

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
