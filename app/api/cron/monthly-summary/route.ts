// GET /api/cron/monthly-summary   manda o resumo do mes que acabou de fechar
//
// Agendado em vercel.json para 12:00 UTC do dia 1 = 09:00 em Brasilia. O dia 1
// e a unica data em que o mes anterior esta FECHADO e ainda e novidade.
//
// A PRECISAO DO CRON NA VERCEL E DE +-59min NO PLANO HOBBY, e por isso a
// deduplicacao nao pode depender de "ja rodei hoje": ela e o indice unico
// (user_id, kind, summary_month) do 017. Rodar esta rota dez vezes no dia 1 --
// ou no dia 2, na mao -- nao manda nada de novo.
//
// POR QUE PRECISA DA service_role
// -------------------------------
// Mesmo motivo do /api/cron/bill-alerts e do /api/cron/recurrence-alerts: o
// cron roda sem usuario logado e precisa varrer TODO MUNDO. Com a chave anon a
// RLS devolveria zero linhas e o job sairia VERDE sem avisar ninguem -- a pior
// falha possivel aqui, porque e silenciosa. Por isso a rota EXIGE as variaveis
// e responde 503 dizendo qual falta, em vez de rodar a vazio.
//
// O QUE ELE NAO FAZ
// -----------------
// Nao manda resumo para quem nao movimentou nada no mes fechado. "Voce
// movimentou R$ 0,00 em setembro" e um aviso que so serve para lembrar que o
// app existe, e o custo de mandar e o usuario desligar a notificacao -- levando
// junto o aviso de vencimento, que e o que ele mais precisa.

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { enviarPush } from "@/lib/services/notifications";
import { comRegistro } from "@/lib/services/cron-ledger";
import {
  linhaDoResumo,
  resumoDoUsuario,
  URL_DO_RESUMO,
} from "@/lib/services/monthly-summary";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Teto de usuarios por execucao.
 *
 * Com mais que isto o job estoura o `maxDuration` e morre no meio -- e morrer
 * no meio e seguro (o indice do 017 garante que a proxima passada nao repete
 * quem ja recebeu), mas fica invisivel. O numero volta na resposta para o
 * truncamento aparecer.
 */
const MAX_USUARIOS = 500;

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
        error: `Resumo mensal não configurado. Faltam: ${faltando.join(", ")}.`,
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

  // O `faltando` acima ja garantiu que as duas existem, mas o TypeScript nao
  // enxerga isso atraves do array -- dai o estreitamento explicito aqui.
  const env = { url: url as string, serviceRole: serviceRole as string };

  // Daqui para baixo toda saida passa pelo livro-razao (`cron_runs`, 019) --
  // inclusive o "nao havia nada a fazer", que e o caso normal e o unico que
  // distingue um cron ocioso de um cron que nunca foi chamado.
  const saida = await comRegistro("monthly-summary", env, async () => {
    const admin = createClient(env.url, env.serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // `?hoje=` existe para poder disparar o resumo de um mes especifico na mao
    // depois de uma falha, sem esperar o dia 1 seguinte. Nao afrouxa nada: a
    // rota continua exigindo o CRON_SECRET, e o indice do 017 continua impedindo
    // o resumo repetido.
    const hoje =
      request.nextUrl.searchParams.get("hoje") ??
      new Date().toISOString().slice(0, 10);

    // Quem tem perfil. `profiles` e a tabela que tem uma linha por usuario do
    // app -- `auth.users` nao e alcancavel pelo PostgREST.
    const { data: perfis, error } = await admin
      .from("profiles")
      .select("id")
      .limit(MAX_USUARIOS);

    if (error) {
      console.error("Cron: erro ao listar perfis:", error);
      return { status: 500, body: { error: "Falha ao listar os usuários" } };
    }

    const usuarios = (perfis ?? []) as Array<{ id: string }>;
    if (usuarios.length === 0) {
      return { status: 200, body: { ok: true, resumos: 0, push: 0, usuarios: 0 } };
    }

    // Um resumo por usuario. `allSettled` e nao `all`: um usuario com dado
    // estranho nao pode impedir o resumo de todos os outros -- e com `all` a
    // primeira rejeicao derrubaria a execucao inteira, deixando o mes sem
    // resumo para quem nao tinha problema nenhum.
    const resultados = await Promise.allSettled(
      usuarios.map(async (u) => {
        const resumo = await resumoDoUsuario(admin, u.id, hoje);
        return { userId: u.id, resumo };
      })
    );

    const linhas = [];
    let falhas = 0;

    for (const r of resultados) {
      if (r.status === "rejected") {
        falhas++;
        console.error("Cron: resumo falhou para um usuário:", r.reason);
        continue;
      }
      // Mes sem movimento nao vira aviso -- ver o cabecalho.
      if (!r.value.resumo.temMovimento) continue;
      linhas.push(linhaDoResumo(r.value.userId, r.value.resumo));
    }

    if (linhas.length === 0) {
      return {
        status: 200,
        body: {
          ok: true,
          resumos: 0,
          push: 0,
          usuarios: usuarios.length,
          falhas,
        },
      };
    }

    // Gravar ANTES de mandar o push e deliberado, igual ao /api/cron/bill-alerts:
    // se a gravacao falhar depois do envio, o proximo cron manda o mesmo push de
    // novo. Na ordem inversa, o pior caso e um aviso gravado que nao saiu no
    // celular -- e ele ainda aparece no sino do app.
    //
    // `onConflict` com a lista de colunas NUA: e tudo o que o PostgREST sabe
    // mandar, e e por isso que o indice do 017 e CHEIO e nao parcial. Ver o
    // cabecalho daquela migration.
    const { data: gravados, error: erroGravar } = await admin
      .from("bill_notifications")
      .upsert(linhas, {
        onConflict: "user_id,kind,summary_month",
        ignoreDuplicates: true,
      })
      .select("id, user_id, title, body, summary_month");

    if (erroGravar) {
      console.error("Cron: erro ao gravar o resumo:", erroGravar);
      return { status: 500, body: { error: "Falha ao gravar os resumos" } };
    }

    const novos = gravados ?? [];

    let enviados = 0;
    let removidos = 0;
    let pushDesligado = false;

    await Promise.all(
      novos.map(async (n) => {
        const r = await enviarPush(admin, n.user_id, {
          title: n.title,
          body: n.body,
          url: URL_DO_RESUMO,
          // Uma notificacao por mes: o resumo de setembro nao empilha com o de
          // outubro na bandeja, substitui.
          tag: `summary-${n.summary_month}`,
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
        usuarios: usuarios.length,
        resumos: novos.length,
        push: enviados,
        inscricoesRemovidas: removidos,
        pushDesligado,
        falhas,
        truncado: usuarios.length >= MAX_USUARIOS,
      },
    };
  });

  return NextResponse.json(saida.body, { status: saida.status });
}
