// GET /api/cron/recurrence-scan   a varredura de assinaturas de todo mundo
//
// Agendado em vercel.json para 09:00 UTC = 06:00 em Brasilia. Cedo, e uma hora
// antes do aviso de vencimento das 11:00 UTC: as duas rotas leem tabelas
// diferentes, mas rodar em horarios separados mantem a leitura do log simples
// quando uma delas falhar.
//
// POR QUE ESTA ROTA EXISTE
// ------------------------
// A subtarefa 3 da HMO-145 pede "job diario, ou disparado a cada importacao".
// O disparo por importacao ja existe (a tela de extrato chama
// POST /api/recurrences/scan depois de mandar linhas para dentro), mas sozinho
// ele nao basta: quem lanca no app em vez de importar OFX nunca teria a lista
// atualizada, e `next_expected_date` envelheceria em silencio -- a tela
// continuaria mostrando uma "proxima cobranca" que ja passou.
//
// POR QUE PRECISA DA service_role
// -------------------------------
// O cron roda sem nenhum usuario logado e precisa varrer TODOS. Com a chave
// anon a RLS da 011 devolveria zero linhas e o job sairia verde sem ter
// detectado nada -- a pior falha possivel aqui, porque e silenciosa. Por isso a
// rota EXIGE as variaveis e responde 503 dizendo qual falta, em vez de rodar a
// vazio. Junto com /api/cron/bill-alerts, sao as unicas rotas do projeto que
// usam service_role: tudo que passa pelo navegador continua passando pela RLS.
//
// PROTECAO
// --------
// `CRON_SECRET` no header Authorization. Sem ele qualquer um na internet
// dispararia a varredura de todos os usuarios -- nao vazaria dado (a resposta e
// so contagem), mas seria trabalho de banco de graca a cada requisicao.
//
// POR QUE NAO E INCREMENTAL
// -------------------------
// A tentacao e varrer so quem teve lancamento novo desde ontem.
// `financial_transactions` nao tem trigger de `updated_at` (conferido no
// 001_baseline), entao "mudou desde ontem" so enxergaria INSERT: editar o valor
// de uma cobranca, ou apagar lancamento, nao mexeria em coluna nenhuma e o
// usuario ficaria fora da varredura com a lista errada na tela. Varrer todo
// mundo e uma leitura indexada por usuario; o incremental so vale a pena
// quando o teto de MAX_USUARIOS comecar a doer, e ai ele aparece como
// `truncated: true` na resposta antes de virar bug.

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { janelaPedida, varrerRecorrencias } from "@/lib/services/recurrence-scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Teto de usuarios por execucao.
 *
 * Existe para a execucao estourar de forma VISIVEL (`truncated: true`) em vez
 * de passar do `maxDuration` e ser cortada no meio pela Vercel -- que e o mesmo
 * resultado, mas sem nada na resposta dizendo que faltou gente.
 */
const MAX_USUARIOS = 500;

/**
 * Quantas varreduras ao mesmo tempo.
 *
 * Sequencial passa de 60s com poucas dezenas de usuarios; tudo de uma vez abre
 * uma conexao por usuario e o pooler do Supabase comeca a recusar. 5 e o meio
 * termo, e o custo de errar aqui e um job lento, nao um job errado.
 */
const CONCORRENCIA = 5;

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
        error: `Varredura de assinaturas não configurada. Faltam: ${faltando.join(", ")}.`,
        hint: "Project Settings → Environment Variables, escopo Production.",
      },
      { status: 503 }
    );
  }

  // A Vercel manda `Authorization: Bearer <CRON_SECRET>` nos crons do projeto.
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const admin = createClient(url as string, serviceRole as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const meses = janelaPedida(new URL(request.url).searchParams.get("months"));

    const { data: perfis, error: erroPerfis } = await admin
      .from("profiles")
      .select("id")
      .limit(MAX_USUARIOS);

    if (erroPerfis) {
      console.error("Cron: erro ao listar usuarios:", erroPerfis);
      return NextResponse.json({ error: "Falha ao listar os usuários" }, { status: 500 });
    }

    const usuarios = (perfis ?? []).map((p) => p.id as string);
    if (usuarios.length === 0) {
      return NextResponse.json({ ok: true, usuarios: 0, detectadas: 0 });
    }

    let detectadas = 0;
    let varridos = 0;
    let truncados = 0;
    const falhas: Array<{ user_id: string; erro: string }> = [];

    // Uma falha de um usuario nao pode derrubar a varredura dos outros: quem
    // tiver uma linha de extrato estranha no historico cancelaria o job inteiro
    // para todo mundo, todo dia, ate alguem perceber.
    for (let i = 0; i < usuarios.length; i += CONCORRENCIA) {
      const lote = usuarios.slice(i, i + CONCORRENCIA);
      await Promise.all(
        lote.map(async (userId) => {
          try {
            const r = await varrerRecorrencias(admin, userId, meses);
            detectadas += r.detected;
            varridos += r.scanned;
            if (r.truncated) truncados++;
          } catch (erro) {
            falhas.push({
              user_id: userId,
              erro: erro instanceof Error ? erro.message : String(erro),
            });
          }
        })
      );
    }

    // Todo mundo falhou = o job nao fez nada. Isso precisa sair 500, senao o
    // painel da Vercel mostra verde para uma varredura que nao varreu ninguem
    // -- por exemplo no dia em que a migration 011 nao estiver no banco.
    if (falhas.length === usuarios.length) {
      console.error("Cron: a varredura falhou para todos os usuarios:", falhas[0]?.erro);
      return NextResponse.json(
        { error: "A varredura falhou para todos os usuários", exemplo: falhas[0]?.erro },
        { status: 500 }
      );
    }

    if (falhas.length) {
      console.error(`Cron: ${falhas.length} usuário(s) falharam na varredura`, falhas);
    }

    return NextResponse.json({
      ok: true,
      usuarios: usuarios.length,
      transacoes_lidas: varridos,
      detectadas,
      falhas: falhas.length,
      // `truncated` por usuario (historico maior que o teto do detector) e
      // `truncated_usuarios` (mais gente que MAX_USUARIOS) sao coisas
      // diferentes, e as duas precisam aparecer.
      historicos_truncados: truncados,
      truncated_usuarios: usuarios.length >= MAX_USUARIOS,
      window: { months: meses },
    });
  } catch (error) {
    console.error("Cron: erro inesperado na varredura de assinaturas:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
