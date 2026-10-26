// -----------------------------------------------------------------------------
// O PESO E O SETOR DE CADA ATIVO, PARA O REBALANCEAMENTO (migration 073)
// -----------------------------------------------------------------------------
// GET devolve `target_weight` e `sector` de cada ativo do usuario. PUT grava os
// dois, em lote.
//
// POR QUE ROTA PROPRIA, E NAO DUAS COLUNAS A MAIS NO GET /api/investments
// ----------------------------------------------------------------------
// Migration neste projeto e colada a mao no SQL Editor, depois do merge. Um
// `select` que nomeia coluna que ainda nao existe responde `42703` e derruba a
// rota inteira -- foi o que aconteceu com a 058 (ver o comentario do select em
// app/api/investments/route.ts). Aqui o `42703` vira `migracaoPendente: true`,
// a tela mostra uma frase no lugar da tabela, e a carteira continua abrindo.
//
// A CONTA NAO MORA AQUI
// ---------------------
// O rebalanceamento depende do aporte que a pessoa esta digitando, e a tela tem
// de mudar a cada tecla -- o mesmo caso dos crivos (ver o cabecalho de
// app/api/investments/crivos/route.ts). A conta e lib/rebalanceamento.ts, a
// mesma funcao com suite propria, rodando na tela sobre a posicao que
// GET /api/investments ja devolve.
// -----------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { lerPesosParaGravar } from "@/lib/rebalanceamento";

export const dynamic = "force-dynamic";

/** Coluna inexistente no PostgREST: a 073 ainda nao foi colada. */
const COLUNA_INEXISTENTE = "42703";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("investment_assets")
      .select("id, target_weight, sector")
      .eq("user_id", user.id);

    if (error) {
      if (error.code === COLUNA_INEXISTENTE) {
        return NextResponse.json({ migracaoPendente: true, pesos: [] });
      }
      console.error("Erro ao ler os pesos do rebalanceamento:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar os pesos da carteira" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      migracaoPendente: false,
      pesos: (data || []).map((linha) => ({
        asset_id: linha.id,
        target_weight: linha.target_weight,
        sector: linha.sector,
      })),
    });
  } catch (error) {
    console.error("Erro em GET /api/investments/rebalanceamento:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const corpo = await request.json().catch(() => null);
    const lidos = lerPesosParaGravar(corpo);
    if (!lidos.ok) {
      return NextResponse.json({ error: lidos.erro }, { status: 400 });
    }

    // Um UPDATE por ativo, preso ao dono. A RLS da 021 ja prende, e o `.eq`
    // de user_id e a segunda trava, no padrao das outras rotas da carteira.
    // `.select("id")` para saber se a linha existia: UPDATE que nao achou nada
    // nao e erro no PostgREST, e a tela diria "gravado" sem ter gravado.
    for (const item of lidos.itens) {
      const { data, error } = await supabase
        .from("investment_assets")
        .update({ target_weight: item.target_weight, sector: item.sector })
        .eq("id", item.asset_id)
        .eq("user_id", user.id)
        .select("id");

      if (error) {
        if (error.code === COLUNA_INEXISTENTE) {
          return NextResponse.json(
            {
              error:
                "O rebalanceamento ainda não está liberado no banco (migration 073).",
            },
            { status: 409 }
          );
        }
        console.error("Erro ao gravar o peso do ativo:", error);
        return NextResponse.json(
          { error: "Não foi possível gravar os pesos" },
          { status: 500 }
        );
      }

      if (!data || data.length === 0) {
        return NextResponse.json(
          { error: "Ativo não encontrado na sua carteira" },
          { status: 404 }
        );
      }
    }

    return NextResponse.json({ ok: true, gravados: lidos.itens.length });
  } catch (error) {
    console.error("Erro em PUT /api/investments/rebalanceamento:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
