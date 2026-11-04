import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { COOKIE_ENTROU_COMO, COOKIE_VOLTA_DO_ADMIN } from "@/lib/entrar-como";

/**
 * "Voltar para minha conta" depois de um "Entrar como"
 * (`app/api/admin/entrar-como/route.ts`).
 *
 * Encerra a sessao do membro (so a deste navegador), restaura a do admin com
 * o refresh token guardado no cookie httpOnly e fecha a linha do registro.
 * Se a volta nao funcionar, o navegador fica deslogado -- nunca preso na
 * conta do membro.
 */

export const dynamic = "force-dynamic";

function limpar(jar: ReturnType<typeof cookies>) {
  jar.delete(COOKIE_VOLTA_DO_ADMIN);
  jar.delete(COOKIE_ENTROU_COMO);
}

export async function POST() {
  const jar = cookies();
  const bruto = jar.get(COOKIE_VOLTA_DO_ADMIN)?.value;

  let volta: { refresh_token?: string; admin_id?: string; registro_id?: string } =
    {};
  try {
    volta = bruto ? JSON.parse(bruto) : {};
  } catch {
    volta = {};
  }

  const supabase = createClient();

  // Sai da conta do membro primeiro, de qualquer jeito.
  await supabase.auth.signOut({ scope: "local" });

  if (!volta.refresh_token || !volta.admin_id) {
    limpar(jar);
    return NextResponse.json(
      { error: "Não há conta para voltar. Entre de novo com a sua senha." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: volta.refresh_token,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceRole && volta.registro_id) {
    const admin = createServiceClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await admin
      .from("registro_entrar_como")
      .update({ saiu_em: new Date().toISOString() })
      .eq("id", volta.registro_id)
      .is("saiu_em", null);
  }

  limpar(jar);

  if (error || data.user?.id !== volta.admin_id) {
    // O token nao voltou para quem entrou: nao deixa sessao nenhuma de pe.
    await supabase.auth.signOut({ scope: "local" });
    return NextResponse.json(
      { error: "A sessão expirou. Entre de novo com a sua senha." },
      { status: 401 }
    );
  }

  return NextResponse.json({ ok: true });
}
