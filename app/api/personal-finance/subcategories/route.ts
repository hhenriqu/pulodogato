// ---------------------------------------------------------------------------
// CRIAR SUBCATEGORIA (HMO-216)
// ---------------------------------------------------------------------------
// "as categorias agora devem contar com uma subcategoria."
//
// O caso principal e subcategoria PROPRIA sob categoria do CATALOGO -- "quero
// Mercado e Restaurante dentro de Alimentação, sem inventar uma categoria".
// Por isso esta rota nao exige que a categoria seja da pessoa: ela exige que a
// pessoa CONSIGA VER a categoria, que e o que a RLS da 036 responde.
//
// A listagem nao esta aqui: as subcategorias vem junto de
// `/api/personal-finance/categories`, numa resposta so, para que a tela nunca
// desenhe um seletor com o catalogo e corrija depois.
// ---------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  validarNomeDeCategoria,
  mensagemDeErroDeNome,
  SUBCATEGORIA_PADRAO,
} from "@/lib/categorias";

export const dynamic = "force-dynamic";

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

    const corpo = await request.json().catch(() => null);
    const categoriaId =
      typeof corpo?.category_id === "string" ? corpo.category_id : "";
    const nome = typeof corpo?.name === "string" ? corpo.name.trim() : "";

    if (!categoriaId) {
      return NextResponse.json(
        { error: "Escolha a categoria da subcategoria." },
        { status: 400 }
      );
    }

    // Controle de acesso por LEITURA, como na rota de categoria: uma categoria
    // de outra pessoa volta "nao encontrada" pela policy, e 404 e a resposta
    // certa -- um 403 confirmaria que aquele id existe.
    const { data: categoria } = await supabase
      .from("transaction_categories")
      .select("id")
      .eq("id", categoriaId)
      .maybeSingle();

    if (!categoria) {
      return NextResponse.json(
        { error: "Categoria não encontrada." },
        { status: 404 }
      );
    }

    // O escopo da duplicata e as subcategorias VISIVEIS daquela categoria --
    // o que inclui o "Outros" do catalogo. Criar um segundo "Outros" nao
    // bateria na unique do banco (uma linha e do catalogo, `user_id IS NULL`, e
    // a nova seria da pessoa), e o seletor ficaria com dois itens de mesmo
    // nome e destinos diferentes.
    const { data: existentes } = await supabase
      .from("transaction_subcategories")
      .select("id, name")
      .eq("category_id", categoriaId);

    const erro = validarNomeDeCategoria(nome, existentes ?? []);
    if (erro) {
      return NextResponse.json(
        {
          error:
            erro === "duplicado" && nome.trim() === SUBCATEGORIA_PADRAO
              ? `Toda categoria já tem a subcategoria "${SUBCATEGORIA_PADRAO}".`
              : mensagemDeErroDeNome(erro),
        },
        { status: 400 }
      );
    }

    const { data: criada, error } = await supabase
      .from("transaction_subcategories")
      .insert({
        category_id: categoriaId,
        user_id: user.id,
        name: nome,
        is_active: true,
      })
      .select("id, category_id, name, user_id, is_active")
      .single();

    if (error || !criada) {
      if (error?.code === "23505") {
        return NextResponse.json(
          { error: mensagemDeErroDeNome("duplicado") },
          { status: 409 }
        );
      }
      console.error("Erro ao criar subcategoria:", error);
      return NextResponse.json(
        { error: "Não foi possível criar a subcategoria." },
        { status: 500 }
      );
    }

    return NextResponse.json({ subcategory: criada }, { status: 201 });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
