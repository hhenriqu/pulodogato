// GET /api/cron/bill-alerts   varre os vencimentos e avisa (uma vez por dia)
//
// Agendado em vercel.json para 11:00 UTC = 08:00 em Brasilia -- cedo o
// bastante para ainda dar tempo de pagar no mesmo dia.
//
// POR QUE ESTA ROTA PRECISA DA service_role
// ------------------------------------------
// O cron roda sem nenhum usuario logado e precisa enxergar o vencimento de
// TODOS. Com a chave anon a RLS do 009 devolveria zero linhas e o job sairia
// verde sem avisar ninguem -- a pior falha possivel aqui, porque e silenciosa.
//
// Por isso a rota EXIGE as duas variaveis e responde 503 dizendo qual falta, em
// vez de rodar a vazio. E por isso ela e a unica do projeto que usa a
// service_role: tudo que passa pelo navegador continua passando pela RLS.
//
// PROTECAO
// --------
// `CRON_SECRET` no header Authorization. Sem ele, qualquer um na internet
// dispararia a varredura -- nao vazaria dado (a resposta e so contagem), mas
// encheria o celular de todo mundo de notificacao repetida... ate a UNIQUE de
// bill_notifications barrar. A UNIQUE e a segunda linha de defesa; o segredo e
// a primeira.
//
// O QUE IMPEDE O SPAM
// -------------------
// A view ja traz `already_notified`, e o INSERT bate na UNIQUE
// (scheduled_transaction_id, kind, reference_date) do 009. Mesmo que o cron
// rode dez vezes no mesmo dia, o aviso sai uma vez so.

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { enviarPush, textoDoAviso, type BillAlert } from "@/lib/services/notifications";
import { comRegistro } from "@/lib/services/cron-ledger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const faltando = [
    !segredo && "CRON_SECRET",
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !serviceRole && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);

  if (faltando.length) {
    return NextResponse.json(
      {
        error: `Aviso de vencimento não configurado. Faltam: ${faltando.join(", ")}.`,
        hint: "Project Settings → Environment Variables, escopo Production.",
      },
      { status: 503 }
    );
  }

  // A Vercel manda `Authorization: Bearer <CRON_SECRET>` nos crons do projeto.
  const enviado = request.headers.get("authorization");
  if (enviado !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // Daqui para baixo toda saida passa pelo livro-razao (`cron_runs`, 019) --
  // inclusive o "nao havia nada a fazer" logo abaixo, que e o caso normal e o
  // unico que distingue um cron ocioso de um cron que nunca foi chamado.
  // O `faltando` acima ja garantiu que as duas existem, mas o TypeScript nao
  // enxerga isso atraves do array -- dai o estreitamento explicito aqui.
  const env = { url: url as string, serviceRole: serviceRole as string };

  const saida = await comRegistro("bill-alerts", env, async () => {
    const admin = createClient(env.url, env.serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: alertas, error } = await admin
      .from("bill_alerts")
      .select("*")
      .eq("already_notified", false);

    if (error) {
      console.error("Cron: erro ao ler bill_alerts:", error);
      return { status: 500, body: { error: "Falha ao ler os vencimentos" } };
    }

    const lista = (alertas ?? []) as BillAlert[];
    if (lista.length === 0) {
      return { status: 200, body: { ok: true, avisos: 0, push: 0 } };
    }

    // Um INSERT so, com ON CONFLICT. Gravar ANTES de mandar o push e
    // deliberado: se a gravacao falhar depois do envio, o proximo cron manda o
    // mesmo push de novo. Na ordem inversa, o pior caso e um aviso gravado que
    // nao saiu no celular -- e ele ainda aparece no sino do app.
    const linhas = lista.map((a) => {
      const { title, body } = textoDoAviso(a);
      return {
        user_id: a.user_id,
        scheduled_transaction_id: a.scheduled_transaction_id,
        kind: a.kind,
        reference_date: a.due_date,
        title,
        body,
        channel: "inapp" as const,
      };
    });

    const { data: gravados, error: erroGravar } = await admin
      .from("bill_notifications")
      .upsert(linhas, {
        onConflict: "scheduled_transaction_id,kind,reference_date",
        ignoreDuplicates: true,
      })
      .select("id, user_id, scheduled_transaction_id, title, body");

    if (erroGravar) {
      console.error("Cron: erro ao gravar avisos:", erroGravar);
      return { status: 500, body: { error: "Falha ao gravar os avisos" } };
    }

    const novos = gravados ?? [];

    // Push so para os que acabaram de ser gravados: os que ja existiam foram
    // avisados numa execucao anterior.
    let enviados = 0;
    let removidos = 0;
    let pushDesligado = false;

    await Promise.all(
      novos.map(async (n) => {
        const r = await enviarPush(admin, n.user_id, {
          title: n.title,
          body: n.body,
          url: "/dashboard/bills",
          // uma notificacao por conta: a do aluguel substitui a anterior do
          // aluguel em vez de empilhar duas na bandeja.
          tag: `bill-${n.scheduled_transaction_id}`,
        });
        enviados += r.enviados;
        removidos += r.removidos;
        if (r.desligado) pushDesligado = true;
      })
    );

    if (enviados > 0) {
      await admin
        .from("bill_notifications")
        .update({ channel: "push" })
        .in(
          "id",
          novos.map((n) => n.id)
        );
    }

    return {
      status: 200,
      body: {
        ok: true,
        avisos: novos.length,
        ja_avisados: lista.length - novos.length,
        push: enviados,
        assinaturas_removidas: removidos,
        push_desligado: pushDesligado,
      },
    };
  });

  return NextResponse.json(saida.body, { status: saida.status });
}
