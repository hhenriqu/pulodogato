import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createClient();

    // Test basic connection
    const { data: connectionTest, error: connectionError } = await supabase
      .from("profiles")
      .select("count(*)")
      .limit(1);

    if (connectionError) {
      return NextResponse.json(
        {
          status: "error",
          message: "Database connection failed",
          error: connectionError.message,
          details: connectionError,
        },
        { status: 500 }
      );
    }

    // Check if essential tables exist
    const { data: tablesCheck, error: tablesError } = await supabase.rpc(
      "check_essential_tables"
    );

    return NextResponse.json({
      status: "ok",
      message: "Database connection successful",
      connection: "ok",
      tables: tablesCheck || "checking...",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check error:", error);
    return NextResponse.json(
      {
        status: "error",
        message: "Health check failed",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
