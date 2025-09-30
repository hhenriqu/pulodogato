import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const supabase = createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = params;

    console.log("Getting group details for:", groupId);

    // Get group details
    const { data: group, error: groupError } = await supabase
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
        creator:profiles!expense_groups_created_by_fkey (
          full_name,
          avatar_url
        )
      `
      )
      .eq("id", groupId)
      .single();

    if (groupError || !group) {
      console.error("Group error:", groupError);
      return NextResponse.json(
        { error: "Grupo não encontrado" },
        { status: 404 }
      );
    }

    // Get group members
    const { data: members, error: membersError } = await supabase
      .from("group_members")
      .select(
        `
        id,
        role,
        status,
        percentage,
        user:profiles!group_members_user_id_fkey (
          id,
          full_name,
          avatar_url
        )
      `
      )
      .eq("group_id", groupId)
      .eq("status", "active");

    if (membersError) {
      console.error("Members error:", membersError);
    }

    // Check if user is member of this group
    const userIsMember = members?.some(
      (member: any) => member.user?.id === user.id
    );
    if (!userIsMember) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const groupWithMembers = {
      ...group,
      members: members || [],
    };

    console.log("Group loaded successfully:", groupWithMembers.name);

    return NextResponse.json({
      success: true,
      group: groupWithMembers,
    });
  } catch (error) {
    console.error("Error in group detail API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
