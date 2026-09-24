// GET /api/cron/recurrence-alerts   dispara os alertas de assinatura
//
// Agendado em vercel.json para 09:30 UTC = 06:30 em Brasilia -- meia hora
// DEPOIS do /api/cron/recurrence-scan (09:00 UTC). A ordem importa: a varredura
// e quem atualiza `last_amount` e `last_charge_date`, e essa ultima coluna e a
// chave de deduplicacao do aviso de aumento. Rodando antes, o aviso sairia
// sobre o estado de ontem e so chegaria no dia seguinte.
//
// (Meia hora e folga, nao sincronizacao: se a varredura atrasar, o pior caso e
// o aviso sair no dia seguinte -- nunca sair errado, porque a deduplicacao e
// por `reference_date` e nao por "ja rodei hoje".)
//
// POR QUE ESTA ROTA EXISTE, EM UMA FRASE
// --------------------------------------
// Os dois alertas ja eram CALCULADOS e apareciam na tela desde a HMO-145. O que
// nao existia era o disparo -- e disparar exige o estado "ja avisei este usuario
// sobre este alerta", porque a varredura roda no cron diario E ao fim de cada
// importacao de extrato (HMO-147). Sem esse estado, quem importa tres extratos
// numa tarde recebe o mesmo aviso tres vezes, desliga a notificacao do app, e
// perde junto o aviso de vencimento -- que e o que ele mais precisa.
//
// POR QUE PRECISA DA service_role
// -------------------------------
// Mesmo motivo do /api/cron/bill-alerts: o cron roda sem usuario logado e
// precisa varrer TODO MUNDO. Com a chave anon a RLS do 009/011 devolveria zero
// linhas e o job sairia verde sem avisar ninguem -- a pior falha possivel aqui,
// porque e silenciosa. Por isso a rota EXIGE as variaveis e responde 503
// dizendo qual falta, em vez de rodar a vazio.
//
// O QUE IMPEDE O SPAM
// -------------------
// O indice unico (recurrence_id, kind, reference_date) do 016, com
// `ignoreDuplicates`. O push sai so para as linhas que o upsert acabou de
// gravar; as que ja existiam foram avisadas antes. O `CRON_SECRET` e a primeira
// linha de defesa, o indice e a segunda -- disparar esta rota na mao dez vezes
// nao manda nada de novo.
//
// ATENCAO AO INDICE: ele e CHEIO, nao parcial, e tem que continuar assim. Um
// indice unico PARCIAL nao serve de arbitro de ON CONFLICT pela lista de colunas
// que o PostgREST manda, e o `upsert` abaixo passaria a responder "there is no
// unique or exclusion constraint matching the ON CONFLICT specification" em toda
// execucao. Ver o cabecalho da migration 016.

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { enviarPush } from "@/lib/services/notifications";
import {
  alertasDasRecorrencias,
  COLUNAS_PARA_ALERTA,
  linhaDeNotificacao,
  MAX_RECORRENCIAS,
  URL_DOS_ALERTAS,
  type RecorrenciaParaAlerta,
} from "@/lib/services/recurrence-alerts";

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
        error: `Aviso de assinatura não configurado. Faltam: ${faltando.join(", ")}.`,
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

  try {
    const admin = createClient(url as string, serviceRole as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Uma leitura so, de todo mundo. `status <> 'IGNORED'` porque "ignorar" e o
    // botao que a tela oferece para calar uma assinatura -- mandar push dela
    // desfaria a decisao do usuario pelo canal mais intrusivo que o app tem.
    const { data: recorrencias, error } = await admin
      .from("detected_recurrences")
      .select(COLUNAS_PARA_ALERTA + ", user_id")
      .neq("status", "IGNORED")
      .limit(MAX_RECORRENCIAS);

    if (error) {
      console.error("Cron: erro ao ler detected_recurrences:", error);
      return NextResponse.json({ error: "Falha ao ler as assinaturas" }, { status: 500 });
    }

    const lista = (recorrencias ?? []) as unknown as Array<
      RecorrenciaParaAlerta & { user_id: string }
    >;

    if (lista.length === 0) {
      return NextResponse.json({ ok: true, avisos: 0, push: 0, usuarios: 0 });
    }

    // Agrupar por usuario e nao varrer por linha: `alertasDasRecorrencias` faz
    // UMA consulta de transacoes por usuario, entao o agrupamento e o que
    // mantem o numero de viagens ao banco proporcional a usuarios, nao a
    // assinaturas. O filtro `user_id` daquela consulta tambem e o que impede a
    // service_role de cruzar a transacao de um com a assinatura de outro.
    const porUsuario = new Map<string, RecorrenciaParaAlerta[]>();
    for (const r of lista) {
      const atual = porUsuario.get(r.user_id);
      if (atual) atual.push(r);
      else porUsuario.set(r.user_id, [r]);
    }

    const linhas: ReturnType<typeof linhaDeNotificacao>[] = [];
    const falhas: string[] = [];

    // `Array.from` e nao `of porUsuario`: o target do tsconfig deste projeto nao
    // aceita iterar um Map direto (TS2802).
    for (const [userId, recorrenciasDoUsuario] of Array.from(porUsuario.entries())) {
      try {
        const alertas = await alertasDasRecorrencias(admin, userId, recorrenciasDoUsuario);
        for (const a of alertas) linhas.push(linhaDeNotificacao(userId, a));
      } catch (erro) {
        // Um usuario que falha nao pode calar o aviso dos outros -- e a mesma
        // escolha do cron de varredura. A contagem volta na resposta para a
        // falha nao ficar so no log.
        console.error(`Cron: alertas do usuario ${userId} falharam:`, erro);
        falhas.push(userId);
      }
    }

    if (linhas.length === 0) {
      return NextResponse.json({
        ok: true,
        avisos: 0,
        push: 0,
        usuarios: porUsuario.size,
        falhas: falhas.length,
      });
    }

    // Gravar ANTES de mandar o push e deliberado, igual ao bill-alerts: se a
    // gravacao falhasse depois do envio, o proximo cron mandaria o mesmo push de
    // novo. Nesta ordem, o pior caso e um aviso gravado que nao chegou no
    // celular -- e ele ainda aparece no sino do app.
    const { data: gravados, error: erroGravar } = await admin
      .from("bill_notifications")
      .upsert(linhas, {
        onConflict: "recurrence_id,kind,reference_date",
        ignoreDuplicates: true,
      })
      .select("id, user_id, recurrence_id, title, body");

    if (erroGravar) {
      console.error("Cron: erro ao gravar avisos de assinatura:", erroGravar);
      return NextResponse.json({ error: "Falha ao gravar os avisos" }, { status: 500 });
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
          url: URL_DOS_ALERTAS,
          // Uma notificacao por assinatura: o aviso novo da Netflix substitui o
          // anterior da Netflix na bandeja em vez de empilhar dois.
          tag: `recurrence-${n.recurrence_id}`,
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

    return NextResponse.json({
      ok: true,
      avisos: novos.length,
      ja_avisados: linhas.length - novos.length,
      push: enviados,
      usuarios: porUsuario.size,
      falhas: falhas.length,
      assinaturas_removidas: removidos,
      push_desligado: pushDesligado,
      // O corte tem que aparecer na resposta: sem isto o cron avisaria um pedaco
      // da base e sairia verde. Ver MAX_RECORRENCIAS.
      truncated: lista.length >= MAX_RECORRENCIAS,
    });
  } catch (error) {
    console.error("Cron: erro inesperado nos alertas de assinatura:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
