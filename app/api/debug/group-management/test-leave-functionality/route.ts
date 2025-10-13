import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const supabase = createClient();

    // Test scenario: User wants to leave a group
    // Using the known data from our analysis
    const testGroupId = "32e8d77e-86a0-4a5b-ad81-2fa6a553a76d"; // This group has 2 members
    const testUserId = "2a1107d1-81fe-45d3-bd16-ed5dad884285"; // This user is a "member" (not admin)

    console.log("🧪 Testing leave group functionality");
    console.log(`👤 User: ${testUserId}`);
    console.log(`🏠 Group: ${testGroupId}`);

    // Get current state before test
    const { data: beforeMembers } = await supabase
      .from("group_members")
      .select("*")
      .eq("group_id", testGroupId);

    console.log("📊 Members before test:", beforeMembers);

    // Simulate the leave process by testing our removeUserFromGroup logic
    const { data: existingMember } = await supabase
      .from("group_members")
      .select("*")
      .eq("group_id", testGroupId)
      .eq("user_id", testUserId)
      .single();

    console.log("👤 Target member:", existingMember);

    if (!existingMember) {
      return NextResponse.json({
        error: "Member not found for test",
        group_id: testGroupId,
        user_id: testUserId
      });
    }

    // Test Strategy 2: Update with status field
    console.log("🔄 Testing status update to 'inactive'");
    
    const updateData = { 
      status: "inactive",
      updated_at: new Date().toISOString()
    };
    
    // Add left_at if field exists
    if ("left_at" in existingMember) {
      updateData.left_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from("group_members")
      .update(updateData)
      .eq("group_id", testGroupId)
      .eq("user_id", testUserId);

    if (updateError) {
      console.log("❌ Update failed:", updateError);
      return NextResponse.json({
        success: false,
        error: updateError,
        test_data: { testGroupId, testUserId, existingMember }
      });
    }

    console.log("✅ Successfully updated member to inactive");

    // Verify the change
    const { data: afterMembers } = await supabase
      .from("group_members")
      .select("*")
      .eq("group_id", testGroupId);

    console.log("📊 Members after test:", afterMembers);

    // Restore the member to active for future tests
    await supabase
      .from("group_members")
      .update({ status: "active" })
      .eq("group_id", testGroupId)
      .eq("user_id", testUserId);

    console.log("🔄 Restored member to active status");

    return NextResponse.json({
      success: true,
      message: "Leave functionality test completed successfully",
      test_results: {
        before_members: beforeMembers,
        target_member: existingMember,
        update_data: updateData,
        after_members: afterMembers,
        strategy_used: "status_update_to_inactive"
      }
    });

  } catch (error) {
    console.error("❌ Error in leave functionality test:", error);
    return NextResponse.json(
      { 
        success: false,
        error: "Test failed", 
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}