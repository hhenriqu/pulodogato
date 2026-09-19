import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Endpoint público: nunca expor mensagens cruas do banco ou do Supabase.
// Detalhes ficam no log do servidor; o cliente recebe apenas ok/error.
export async function GET() {
  try {
    const supabase = createClient();

    const { error: connectionError } = await supabase
      .from("profiles")
      .select("id")
      .limit(1);

    if (connectionError) {
      console.error("Health check: database connection failed", connectionError);
      return NextResponse.json(
        {
          status: "error",
          message: "Database connection failed",
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      status: "ok",
      message: "Database connection successful",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check error:", error);
    return NextResponse.json(
      {
        status: "error",
        message: "Health check failed",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
