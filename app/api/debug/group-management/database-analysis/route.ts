import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createClient();

    // Try to get some sample data to understand the database structure
    const { data: groups, error: groupsError } = await supabase
      .from("expense_groups")
      .select("id, name, status")
      .limit(5);

    console.log("📊 Available groups:", { groups, groupsError });

    const { data: members, error: membersError } = await supabase
      .from("group_members")
      .select("*")
      .limit(5);

    console.log("👥 Sample members:", { members, membersError });

    // Test what happens when we try different status values on a non-existent member
    const testResults = [];
    const statusValues = ['left', 'inactive', 'removed', 'departed', 'exited', 'active', 'pending'];
    
    for (const status of statusValues) {
      const { error } = await supabase
        .from("group_members")
        .update({ status })
        .eq("group_id", "99999") // Non-existent
        .eq("user_id", "00000000-0000-0000-0000-000000000000"); // Non-existent
      
      testResults.push({
        status,
        error: error ? {
          message: error.message,
          code: error.code,
          details: error.details
        } : null
      });
    }

    return NextResponse.json({
      groups: { data: groups, error: groupsError },
      members: { data: members, error: membersError },
      status_tests: testResults,
      message: "Database structure analysis complete"
    });

  } catch (error) {
    console.error("❌ Error in database analysis:", error);
    return NextResponse.json(
      { error: "Failed to analyze database", details: error },
      { status: 500 }
    );
  }
}