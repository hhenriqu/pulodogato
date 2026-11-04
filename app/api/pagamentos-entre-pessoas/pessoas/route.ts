import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

/** Para quem quem chama pode pagar: membros ativos dos grupos dele (081). */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.rpc("pessoas_para_pagamento");
  if (error) {
    console.error("[pagamentos-entre-pessoas] pessoas", error);
    return NextResponse.json({ pessoas: [] });
  }
  return NextResponse.json({ pessoas: data ?? [] });
}
