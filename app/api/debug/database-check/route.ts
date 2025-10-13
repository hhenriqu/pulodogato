import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createClient();

    const checks = {
      connection: false,
      profiles_table: false,
      portfolios_table: false,
      assets_table: false,
      asset_categories_table: false,
      auth_working: false,
      rls_enabled: false,
    };

    const errors = [];
    const details = {};

    // 1. Test basic connection
    try {
      const { error } = await supabase.from("profiles").select("count");
      if (!error) {
        checks.connection = true;
        checks.profiles_table = true;
      } else if (error.code === "PGRST116") {
        checks.connection = true;
        checks.profiles_table = false;
        errors.push("profiles table does not exist");
      } else {
        errors.push(`Connection error: ${error.message}`);
      }
    } catch (err) {
      errors.push(
        `Connection failed: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }

    // 2. Check other essential tables
    const tables = ["portfolios", "assets", "asset_categories"];

    for (const table of tables) {
      try {
        const { error } = await supabase.from(table).select("count").limit(1);
        if (!error) {
          checks[`${table}_table` as keyof typeof checks] = true;
        } else if (error.code === "PGRST116") {
          errors.push(`${table} table does not exist`);
        } else {
          errors.push(`${table} error: ${error.message}`);
        }
      } catch (err) {
        errors.push(
          `${table} check failed: ${
            err instanceof Error ? err.message : "Unknown"
          }`
        );
      }
    }

    // 3. Test auth
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (!error) {
        checks.auth_working = true;
        details.auth = user ? "authenticated" : "not authenticated";
      } else {
        errors.push(`Auth error: ${error.message}`);
      }
    } catch (err) {
      errors.push(
        `Auth check failed: ${err instanceof Error ? err.message : "Unknown"}`
      );
    }

    // 4. Check if we need to setup database
    const needsSetup =
      !checks.profiles_table ||
      !checks.assets_table ||
      !checks.asset_categories_table;

    return NextResponse.json({
      status: needsSetup
        ? "needs_setup"
        : errors.length > 0
        ? "partial"
        : "healthy",
      checks,
      errors,
      details,
      needsSetup,
      setupInstructions: needsSetup
        ? [
            "1. Go to your Supabase dashboard",
            "2. Navigate to SQL Editor",
            "3. Run the database-setup.sql script from docs/ folder",
            "4. Refresh this endpoint to verify setup",
          ]
        : null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Database check error:", error);
    return NextResponse.json(
      {
        status: "error",
        message: "Database check failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
