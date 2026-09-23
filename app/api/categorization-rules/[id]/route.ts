// PATCH  /api/categorization-rules/[id]   troca a categoria ou liga/desliga
// DELETE /api/categorization-rules/[id]   apaga de vez
//
// O QUE NAO SE MUDA AQUI
// ----------------------
// `merchant_key`. Trocar a chave de uma regra existente a faz casar com OUTRO
// estabelecimento mantendo o display_name antigo: a tela continuaria escrito
// "iFood" e a regra passaria a categorizar Uber. Nada falharia -- os
// lancamentos so nasceriam na categoria errada. A trigger da SECAO 5 da
// migration 014 recusa no banco; aqui o campo simplesmente nao e lido, para o
// erro nunca chegar la.
//
// DESLIGAR E APAGAR NAO SAO A MESMA COISA
// ----------------------------------------
// Desligar (`is_active = false`) mantem a linha, e e o que impede o
// aprendizado da importacao de recriar a regra na proxima vez que o usuario
// importar aquele lojista. Apagar de verdade deixa o aprendizado livre para
// aprender de novo -- o que as vezes e o que se quer, e por isso os dois
// existem.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
    const patch: Record<string, unknown> = {};

    if (body?.category_id !== undefined) {
      const { data: categoria } = await supabase
        .from("transaction_categories")
        .select("id")
        .eq("id", body.category_id)
        .eq("is_active", true)
        .maybeSingle();

      if (!categoria) {
        return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });
      }

      patch.category_id = body.category_id;
      // Trocar a categoria a mao e uma decisao do usuario, entao a regra deixa
      // de ser um palpite aprendido e passa a ser dele. E o que a protege de
      // ser reescrita pelo aprendizado na proxima importacao.
      patch.source = "manual";
    }

    if (body?.is_active !== undefined) {
      patch.is_active = Boolean(body.is_active);
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Nada para alterar. Informe category_id ou is_active." },
        { status: 400 }
      );
    }

    // O `.eq("user_id")` e redundante com a RLS e fica de proposito: a RLS e a
    // garantia, mas sem o filtro explicito um erro de policy no futuro vira
    // edicao da regra de outra pessoa em vez de 404.
    const { data: regra, error } = await supabase
      .from("categorization_rules")
      .update(patch)
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select(
        "id, merchant_key, display_name, category_id, source, is_active, times_applied, last_applied_at, transaction_categories(id, name, icon, color_hex, is_expense)"
      )
      .maybeSingle();

    if (error) {
      console.error("Erro ao atualizar regra:", error);
      return NextResponse.json(
        { error: "Não foi possível atualizar a regra" },
        { status: 500 }
      );
    }

    if (!regra) {
      return NextResponse.json({ error: "Regra não encontrada" }, { status: 404 });
    }

    return NextResponse.json({ rule: regra });
  } catch (error) {
    console.error("Erro em PATCH /api/categorization-rules/[id]:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { data: apagada, error } = await supabase
      .from("categorization_rules")
      .delete()
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Erro ao apagar regra:", error);
      return NextResponse.json(
        { error: "Não foi possível apagar a regra" },
        { status: 500 }
      );
    }

    if (!apagada) {
      return NextResponse.json({ error: "Regra não encontrada" }, { status: 404 });
    }

    // Apagar a regra NAO mexe nos lancamentos que ela ja categorizou. Eles sao
    // dinheiro do usuario a partir do momento em que nasceram -- a regra
    // decidiu a categoria uma vez, na importacao, e nao e dona deles depois.
    return NextResponse.json({
      ok: true,
      aviso:
        "A regra foi removida. Os lançamentos que ela já categorizou continuam como estão.",
    });
  } catch (error) {
    console.error("Erro em DELETE /api/categorization-rules/[id]:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
