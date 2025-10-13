import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = createClient();

    // Try to get enum values for group_member_status
    const { data: enumQuery, error: enumError } = await supabase
      .from("information_schema.columns")
      .select("*")
      .eq("table_name", "group_members")
      .eq("column_name", "status");

    console.log("📊 Enum query result:", { enumQuery, enumError });

    // Alternative approach: Try to get constraint details
    const { data: constraintData, error: constraintError } = await supabase.rpc('sql', {
      query: `
        SELECT 
          conname as constraint_name,
          pg_get_constraintdef(oid) as constraint_definition
        FROM pg_constraint 
        WHERE conname LIKE '%group_members_status%' 
           OR conname LIKE '%status_check%';
      `
    });

    console.log("🔒 Constraint data:", { constraintData, constraintError });

    // Another approach: Direct SQL to get enum values
    const { data: directEnum, error: directError } = await supabase.rpc('sql', {
      query: `
        SELECT 
          enumlabel as enum_value
        FROM pg_enum pe
        JOIN pg_type pt ON pe.enumtypid = pt.oid
        WHERE pt.typname = 'group_member_status'
        ORDER BY pe.enumsortorder;
      `
    });

    console.log("🎯 Direct enum query:", { directEnum, directError });

    return NextResponse.json({
      enum_query: { data: enumQuery, error: enumError },
      constraint_data: { data: constraintData, error: constraintError },
      direct_enum: { data: directEnum, error: directError }
    });

  } catch (error) {
    console.error("❌ Error in enum values debug:", error);
    return NextResponse.json(
      { error: "Failed to get enum values", details: error },
      { status: 500 }
    );
  }
}