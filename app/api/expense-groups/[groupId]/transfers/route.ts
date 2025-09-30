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

    console.log("Getting transfer suggestions for group:", groupId);

    // Mock data for now - replace with actual transfer calculations later
    const mockTransfers = [
      {
        from: {
          id: "user-2",
          full_name: "Maria Santos",
          avatar_url: null,
        },
        to: {
          id: user.id,
          full_name: "João Silva",
          avatar_url: null,
        },
        amount: 75.25,
      },
    ];

    return NextResponse.json({
      success: true,
      transfers: mockTransfers,
    });
  } catch (error) {
    console.error("Error in transfers API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
