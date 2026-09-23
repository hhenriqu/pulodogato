// POST   /api/push   registra este aparelho para receber aviso de vencimento
// DELETE /api/push    desregistra
//
// O endpoint e UNIQUE global no 009, sem o user_id junto: o mesmo navegador
// reassinando gera o mesmo endpoint, e duas linhas mandariam a notificacao em
// duplicata para o mesmo aparelho. O upsert por endpoint tambem cobre o caso de
// duas contas no mesmo navegador -- a ultima a assinar fica com o aparelho, que
// e o comportamento certo: e para ela que o push vai chegar.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const endpoint = body?.endpoint as string | undefined;
    const p256dh = body?.keys?.p256dh as string | undefined;
    const auth = body?.keys?.auth as string | undefined;

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { error: "Assinatura de push incompleta" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint,
          p256dh,
          auth,
          user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
          failure_count: 0,
        },
        { onConflict: "endpoint" }
      )
      .select("id")
      .single();

    if (error) {
      console.error("Erro ao registrar push:", error);
      return NextResponse.json(
        { error: "Não foi possível ativar os avisos neste aparelho" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
  } catch (error) {
    console.error("Erro ao registrar push:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const endpoint = body?.endpoint as string | undefined;

    // Sem endpoint: desliga o push em TODOS os aparelhos. E o que o botao
    // "desativar avisos" faz quando o navegador ja perdeu a assinatura local e
    // nao tem endpoint para mandar.
    const query = supabase.from("push_subscriptions").delete().eq("user_id", user.id);
    const { error } = endpoint ? await query.eq("endpoint", endpoint) : await query;

    if (error) {
      console.error("Erro ao desativar push:", error);
      return NextResponse.json(
        { error: "Não foi possível desativar" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erro ao desativar push:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
