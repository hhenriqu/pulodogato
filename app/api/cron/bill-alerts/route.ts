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

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { enviarPush, textoDoAviso, type BillAlert } from "@/lib/services/notifications";
import {
  configuracaoDeEmail,
  enviarEmails,
  separarDestinatarios,
} from "@/lib/services/email";
import { comRegistro } from "@/lib/services/cron-ledger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * O e-mail de cada usuario, lido pela API de admin.
 *
 * O endereco mora em `auth.users`, que nao e consultavel por PostgREST -- e
 * nao deve ser copiado para `profiles`: a policy `profiles_select_own_or_public`
 * do 002 expoe o perfil a toda conta autenticada, e uma coluna de e-mail ali
 * publicaria o endereco de todo mundo para a base inteira (foi exatamente o
 * raciocinio da 032 com a chave Pix).
 *
 * Deduplica antes de perguntar: varias contas vencendo no mesmo dia sao
 * normalmente do mesmo usuario, e uma chamada por AVISO viraria dez chamadas
 * identicas.
 *
 * Falha de leitura NAO derruba o cron. Sem endereco o aviso sai sem e-mail e
 * entra em `email_sem_endereco` -- visivel no livro-razao, ao contrario de uma
 * excecao que levaria junto o push e a gravacao que ja deram certo.
 */
async function enderecosDe(
  admin: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string | null>> {
  const mapa = new Map<string, string | null>();

  // `Array.from` e nao `for...of` direto no Set: o target do tsconfig do app
  // e es5 e iterar um Set sem isso reprova com TS2802.
  for (const id of Array.from(new Set(userIds))) {
    try {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error) {
        console.error("Cron: falha ao ler o e-mail do usuario", id, error.message);
        mapa.set(id, null);
        continue;
      }
      mapa.set(id, data.user?.email ?? null);
    } catch (e) {
      console.error("Cron: excecao ao ler o e-mail do usuario", id, e);
      mapa.set(id, null);
    }
  }

  return mapa;
}

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
      // `email_desligado` tambem no caminho ocioso: o dia normal deste cron e
      // o dia sem nada a avisar, e e justamente nele que "o canal esta
      // configurado?" precisa continuar aparecendo em `cron_runs`. Sem isto a
      // resposta so apareceria no primeiro dia com vencimento -- e o relatorio
      // de meses tranquilos nao diria nada sobre o e-mail.
      return {
        status: 200,
        body: { ok: true, avisos: 0, push: 0, email: 0, email_desligado: !configuracaoDeEmail() },
      };
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

    // -----------------------------------------------------------------------
    // E-MAIL (HMO-183)
    // -----------------------------------------------------------------------
    // Depois do push, e sobre a MESMA lista `novos` -- os avisos que acabaram
    // de ser gravados. E dai que vem a idempotencia do canal: a UNIQUE
    // (scheduled_transaction_id, kind, reference_date) da 009 faz o segundo
    // cron do dia devolver `novos` vazio, entao ele nao manda e-mail nenhum.
    // Nao ha contagem separada a manter; o que ja protegia o push protege o
    // e-mail pela mesma linha.
    // Com o canal desligado NAO se procura endereco nenhum. `enderecosDe` e
    // uma chamada a API de admin por usuario, todo dia, e sem a chave do
    // provedor nenhuma delas pode terminar em envio -- seria custo e latencia
    // puros numa rota que ja tem teto de 60s, por um canal que esta off.
    const canalLigado = configuracaoDeEmail() !== null;

    const prefs = new Map(lista.map((a) => [a.user_id, a.notify_email]));
    const emails = canalLigado
      ? await enderecosDe(
          admin,
          novos.map((n) => n.user_id)
        )
      : new Map<string, string | null>();

    // Com o canal desligado as contagens ficam ZERADAS, nao "todo mundo sem
    // endereco". Sao coisas diferentes e exigem acoes diferentes: `0 enviados,
    // 4 sem endereco` manda investigar o cadastro dos usuarios, quando o que
    // havia era uma variavel de ambiente faltando. Quem responde isso e
    // `email_desligado`, sozinho.
    const { paraEnviar, recusaram, semEndereco } = canalLigado
      ? separarDestinatarios(
          novos,
          (u) => prefs.get(u),
          (u) => emails.get(u)
        )
      : { paraEnviar: [], recusaram: 0, semEndereco: 0 };

    const email = await enviarEmails(paraEnviar);

    // O id da mensagem no provedor fica gravado na linha do aviso. E com ele
    // que se confere a entrega no painel depois -- sem isso o unico registro
    // de que o e-mail saiu seria um contador numa resposta HTTP que ninguem
    // guarda.
    //
    // Um UPDATE por aviso porque cada um tem um id de mensagem diferente;
    // `novos` e um punhado de linhas por dia.
    for (const e of email.entregues) {
      const { error: erroMarcar } = await admin
        .from("bill_notifications")
        .update({ emailed_at: new Date().toISOString(), email_message_id: e.messageId })
        .eq("id", e.id);

      // Nao derruba a execucao: o e-mail JA SAIU. Perder a marcacao faz o
      // proximo cron... nao reenviar nada, porque quem decide isso e a UNIQUE
      // sobre `novos`, nao esta coluna. O custo real e so ficar sem o id para
      // conferir, e isso vale uma linha no log, nao um 500.
      if (erroMarcar) {
        console.error("Cron: e-mail enviado mas nao marcado:", e.id, erroMarcar.message);
      }
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
        // Daqui para baixo e o que vai para `cron_runs.result` sobre o e-mail.
        // `email_desligado` e o campo que esta issue existe para criar: sem
        // ele, um canal sem chave de API e um canal funcionando respondem o
        // mesmo 200, que foi exatamente como o push passou meses morto.
        email: email.enviados,
        email_desligado: email.desligado,
        email_remetente_sandbox: email.sandbox,
        email_recusado: recusaram,
        email_sem_endereco: semEndereco + email.semEndereco,
        email_falhas: email.falhas,
      },
    };
  });

  return NextResponse.json(saida.body, { status: saida.status });
}
