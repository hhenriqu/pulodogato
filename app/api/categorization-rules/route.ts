// GET  /api/categorization-rules   as regras do usuario, com o nome da categoria
// POST /api/categorization-rules   cadastra uma regra a mao
//
// A regra cadastrada aqui nasce `source = 'manual'`, e a diferenca nao e
// cosmetica: o aprendizado da importacao nunca sobrescreve uma regra manual
// (ver a SECAO 2 da migration 014). O que a pessoa digitou vale mais que o que
// o app deduziu do comportamento dela.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { chaveDaDescricao } from "@/lib/categorization";
import { MAX_REGRAS } from "@/lib/services/categorization";

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

    // O join traz o nome da categoria: sem ele a tela mostraria uuid, ou faria
    // uma consulta por linha.
    const { data, error } = await supabase
      .from("categorization_rules")
      .select(
        "id, merchant_key, display_name, category_id, source, is_active, times_applied, last_applied_at, created_at, transaction_categories(id, name, icon, color_hex, is_expense)"
      )
      .eq("user_id", user.id)
      .order("times_applied", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(MAX_REGRAS);

    if (error) {
      console.error("Erro ao ler regras de categorizacao:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar as regras" },
        { status: 500 }
      );
    }

    const regras = data ?? [];

    return NextResponse.json({
      rules: regras,
      // Quantos lancamentos as regras ja categorizaram sozinhas. E o numero que
      // responde "isto vale a pena?" -- sem ele a tela e uma lista de
      // configuracao sem resultado visivel.
      total_applied: regras.reduce((soma, r) => soma + Number(r.times_applied ?? 0), 0),
      active: regras.filter((r) => r.is_active).length,
    });
  } catch (error) {
    console.error("Erro em GET /api/categorization-rules:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
    const texto = String(body?.description ?? body?.merchant ?? "").trim();
    const categoryId = body?.category_id as string | undefined;

    if (!texto) {
      return NextResponse.json(
        { error: "Informe o nome do estabelecimento, como aparece no extrato" },
        { status: 400 }
      );
    }

    if (!categoryId) {
      return NextResponse.json({ error: "Escolha uma categoria" }, { status: 400 });
    }

    // A chave e derivada do texto pela MESMA normalizacao da importacao. O
    // usuario pode colar "IFD*IFOOD 3947" direto do extrato -- que e o texto que
    // ele tem na mao -- e a regra casa com todas as outras variacoes do lojista.
    //
    // Deixar a pessoa digitar a chave crua seria pedir que ela adivinhasse a
    // saida de uma funcao: ela escreveria "ifood" onde o extrato produz
    // "ifd ifood", a regra nao pegaria nada, e nada falharia.
    const merchantKey = chaveDaDescricao(texto);

    if (!merchantKey) {
      return NextResponse.json(
        {
          error:
            "Esse texto não tem nome de estabelecimento reconhecível (só símbolos ou números).",
        },
        { status: 400 }
      );
    }

    const { data: categoria } = await supabase
      .from("transaction_categories")
      .select("id, name")
      .eq("id", categoryId)
      .eq("is_active", true)
      .maybeSingle();

    if (!categoria) {
      return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });
    }

    const { data: regra, error } = await supabase
      .from("categorization_rules")
      .upsert(
        {
          user_id: user.id,
          merchant_key: merchantKey,
          display_name: texto.slice(0, 200),
          category_id: categoryId,
          source: "manual",
          is_active: true,
        },
        { onConflict: "user_id,merchant_key" }
      )
      .select(
        "id, merchant_key, display_name, category_id, source, is_active, times_applied, last_applied_at, transaction_categories(id, name, icon, color_hex, is_expense)"
      )
      .single();

    if (error) {
      console.error("Erro ao gravar regra de categorizacao:", error);
      return NextResponse.json(
        { error: "Não foi possível salvar a regra" },
        { status: 500 }
      );
    }

    // `upsert` e nao `insert`: cadastrar de novo o mesmo lojista e a forma
    // natural de CORRIGIR a categoria dele, e um 409 aqui obrigaria o usuario a
    // ir caçar a regra antiga na lista antes de poder consertar. O UPDATE
    // tambem promove a regra aprendida a manual, que e exatamente o que ele
    // acabou de fazer ao confirma-la a mao.
    return NextResponse.json({ rule: regra }, { status: 201 });
  } catch (error) {
    console.error("Erro em POST /api/categorization-rules:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
