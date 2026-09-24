// GET /api/notifications     o sino do app: o que vence e o que ja foi avisado
//
// As listas de VENCIMENTO saem da MESMA definicao do 009: `bill_alerts` e o que
// merece aviso hoje, e `already_notified` diz se o push ja saiu. O cron le a
// mesma view filtrando `already_notified = false`. Duas consultas separadas
// sairiam de sincronia e o usuario veria no sino uma conta que o push nunca
// mandou.
//
// DUAS FAMILIAS DESDE A HMO-148
// -----------------------------
// `recurrence_alerts` e a familia nova: preco de assinatura que subiu, e
// cobranca depois de marcada como cancelada. Ela sai de
// lib/services/recurrence-alerts.ts -- o MESMO modulo que a tela
// /dashboard/recurrences e o cron de push usam -- pelo mesmo motivo que a
// familia de vencimento sai da view: a frase tem que ser uma so. Se o sino
// formatasse o texto por conta propria, o push diria "subiu 12,5%" e o app
// diria outra coisa no dia em que alguem mexesse em um dos dois.
//
// O historico (`notifications`) ja traz as DUAS familias sem filtro novo: as
// duas moram em bill_notifications desde a migration 016, e foi para isto que a
// tabela foi generalizada em vez de ganhar uma irma -- o contador de nao-lidos e
// o PATCH /api/notifications/[id] passaram a valer para os avisos de assinatura
// sem uma linha de codigo.

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { textoDoAviso, type BillAlert } from "@/lib/services/notifications";
import { alertasDoUsuario } from "@/lib/services/recurrence-alerts";

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

    // A familia de assinatura entra num try proprio: ela e a parte NOVA e a
    // menos urgente das duas. Se a leitura das recorrencias falhar, o sino tem
    // que continuar mostrando o que vence -- derrubar a resposta inteira
    // trocaria "faltou o alerta da Netflix" por "o usuario nao soube que o
    // aluguel venceu".
    let alertasDeAssinatura: Awaited<ReturnType<typeof alertasDoUsuario>>["alertas"] = [];
    try {
      alertasDeAssinatura = (await alertasDoUsuario(supabase, user.id)).alertas;
    } catch (erro) {
      console.error("Erro ao montar os alertas de assinatura:", erro);
    }

    return NextResponse.json({
      // O texto vem do servidor para o sino e o push dizerem exatamente a mesma
      // frase -- duas formatacoes do mesmo aviso divergem na primeira mudanca.
      alerts: lista.map((a) => ({ ...a, ...textoDoAviso(a) })),
      recurrence_alerts: alertasDeAssinatura,
      notifications: avisos ?? [],
      unread_count: (avisos ?? []).filter((n) => !n.read_at).length,
      overdue_count: lista.filter((a) => a.kind === "overdue").length,
    });
  } catch (error) {
    console.error("Erro na API de avisos:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
