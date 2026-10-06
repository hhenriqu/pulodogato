import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Buscar grupos arquivados onde o usuário é/era membro
    const { data: archivedGroups, error: groupsError } = await supabase
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
        archived_at,
        archived_by,
        creator:profiles!expense_groups_created_by_fkey(full_name, avatar_url),
        archiver:profiles!expense_groups_archived_by_fkey(full_name, avatar_url)
      `
      )
      .eq("is_active", false)
      .not("archived_at", "is", null);

    if (groupsError) {
      console.error("Error fetching archived groups:", groupsError);
      return NextResponse.json(
        { error: "Failed to fetch archived groups" },
        { status: 500 }
      );
    }

    // Buscar membros arquivados para filtrar grupos onde o usuário participava
    const { data: archivedMembers, error: membersError } = await supabase
      .from("group_members")
      .select(
        `
        id,
        group_id,
        user_id,
        role,
        status,
        percentage,
        archived_at,
        user:profiles!group_members_user_id_fkey(id, full_name, avatar_url)
      `
      )
      .eq("status", "archived")
      .eq("user_id", user.id);

    if (membersError) {
      console.error("Error fetching archived members:", membersError);
      return NextResponse.json(
        { error: "Failed to fetch archived members" },
        { status: 500 }
      );
    }

    // Filtrar grupos onde o usuário era membro
    const userArchivedGroupIds = archivedMembers?.map((m) => m.group_id) || [];
    const userArchivedGroups =
      archivedGroups?.filter((group) =>
        userArchivedGroupIds.includes(group.id)
      ) || [];

    // Buscar todos os membros dos grupos arquivados para mostrar quem participava
    const { data: allArchivedMembers, error: allMembersError } = await supabase
      .from("group_members")
      .select(
        `
        id,
        group_id,
        user_id,
        role,
        status,
        percentage,
        archived_at,
        user:profiles!group_members_user_id_fkey(id, full_name, avatar_url)
      `
      )
      .eq("status", "archived")
      .in("group_id", userArchivedGroupIds);

    if (allMembersError) {
      console.error("Error fetching all archived members:", allMembersError);
    }

    // Combinar grupos com seus membros
    const groupsWithMembers = userArchivedGroups.map((group) => ({
      ...group,
      members:
        allArchivedMembers?.filter((member) => member.group_id === group.id) ||
        [],
      userRole:
        archivedMembers?.find((m) => m.group_id === group.id)?.role || "member",
    }));

    return NextResponse.json({
      success: true,
      archived_groups: groupsWithMembers,
      total: groupsWithMembers.length,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
