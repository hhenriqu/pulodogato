import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

/** Quem recebeu diz que o dinheiro nao chegou (081). So a propria linha. */
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("pagamentos_entre_pessoas")
    .update({ recusado_em: new Date().toISOString() })
    .eq("id", params.id)
    .eq("recebedor_id", user.id)
    .is("lancamento_do_recebedor", null)
    .select("id");

  if (error) {
    console.error("[pagamentos-entre-pessoas] recusar", error);
    return NextResponse.json({ error: "Não foi possível recusar." }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Pagamento não encontrado ou já lançado." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
