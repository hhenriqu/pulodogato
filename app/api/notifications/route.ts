// GET /api/notifications     o sino do app: o que vence e o que ja foi avisado
//
// As duas listas saem da MESMA definicao do 009: `bill_alerts` e o que merece
// aviso hoje, e `already_notified` diz se o push ja saiu. O cron le a mesma
// view filtrando `already_notified = false`. Duas consultas separadas sairiam
// de sincronia e o usuario veria no sino uma conta que o push nunca mandou.

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { textoDoAviso, type BillAlert } from "@/lib/services/notifications";

export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const [{ data: alertas, error: erroAlertas }, { data: avisos }] = await Promise.all([
      supabase.from("bill_alerts").select("*").order("due_date", { ascending: true }),
      supabase
        .from("bill_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (erroAlertas) {
      console.error("Erro ao ler os vencimentos:", erroAlertas);
      return NextResponse.json(
        { error: "Não foi possível carregar os avisos" },
        { status: 500 }
      );
    }

    const lista = (alertas ?? []) as BillAlert[];

    return NextResponse.json({
      // O texto vem do servidor para o sino e o push dizerem exatamente a mesma
      // frase -- duas formatacoes do mesmo aviso divergem na primeira mudanca.
      alerts: lista.map((a) => ({ ...a, ...textoDoAviso(a) })),
      notifications: avisos ?? [],
      unread_count: (avisos ?? []).filter((n) => !n.read_at).length,
      overdue_count: lista.filter((a) => a.kind === "overdue").length,
    });
  } catch (error) {
    console.error("Erro na API de avisos:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
