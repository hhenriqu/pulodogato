import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { janelaPedida, varrerRecorrencias } from "@/lib/services/recurrence-scan";

// =====================================================
// POST /api/recurrences/scan
// =====================================================
// A varredura sob demanda: o "Procurar agora" da tela, e o disparo automatico
// da tela de importacao de extrato depois que o usuario manda linhas para
// dentro (ver o comentario de `agendarVarredura` em statements/page.tsx).
//
// Roda com a SESSAO do usuario. A RLS da 011 limita o que ele le e o que ele
// grava -- e por isso esta rota nao precisa saber de user_id nenhum alem do
// dono do token.
//
// O terceiro gatilho e o cron diario, em /api/cron/recurrence-scan, que roda
// com service_role e varre todo mundo. Os dois chamam a MESMA funcao, em
// lib/services/recurrence-scan.ts; o cabecalho de la explica por que isso nao
// pode ser copia.
// =====================================================

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const meses = janelaPedida(url.searchParams.get("months"));

    const resultado = await varrerRecorrencias(supabase, user.id, meses);
    return NextResponse.json(resultado);
  } catch (error) {
    // A varredura lanca com a mensagem do banco quando a leitura ou a gravacao
    // falha. Devolver essa mensagem e deliberado: foi ela que apontou a
    // migration 011 faltando em producao, e um "Erro interno" generico teria
    // escondido isso.
    const mensagem = error instanceof Error ? error.message : "Erro interno";
    console.error("Erro em POST /api/recurrences/scan:", error);
    return NextResponse.json({ error: mensagem }, { status: 500 });
  }
}
