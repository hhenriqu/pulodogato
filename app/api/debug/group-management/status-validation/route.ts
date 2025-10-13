import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createClient();

    // Use real group and user IDs from the data we found
    const testGroupId = "104dcfaa-c8f9-49bf-88ae-1c410ee0f0b0";
    const testUserId = "8d5e24a9-e0a6-48e6-87be-d6c942b1ba0f";

    // First, get the current member data
    const { data: currentMember } = await supabase
      .from("group_members")
      .select("*")
      .eq("group_id", testGroupId)
      .eq("user_id", testUserId)
      .single();

    console.log("👤 Current member data:", currentMember);

    // Store original status to restore later
    const originalStatus = currentMember?.status;

    // Test different status values
    const statusTests = [];
    const statusValues = ['left', 'inactive', 'removed', 'departed', 'exited', 'pending'];
    
    for (const status of statusValues) {
      const { error } = await supabase
        .from("group_members")
        .update({ status })
        .eq("group_id", testGroupId)
        .eq("user_id", testUserId);
      
      const success = !error;
      statusTests.push({
        status,
        success,
        error: error ? {
          message: error.message,
          code: error.code,
          details: error.details
        } : null
      });

      // If successful, restore original status immediately
      if (success && originalStatus) {
        await supabase
          .from("group_members")
          .update({ status: originalStatus })
          .eq("group_id", testGroupId)
          .eq("user_id", testUserId);
      }
    }

    return NextResponse.json({
      current_member: currentMember,
      original_status: originalStatus,
      status_validation_tests: statusTests,
      valid_statuses: statusTests.filter(t => t.success).map(t => t.status),
      message: "Status validation complete"
    });

  } catch (error) {
    console.error("❌ Error in status validation:", error);
    return NextResponse.json(
      { error: "Failed to validate status values", details: error },
      { status: 500 }
    );
  }
}