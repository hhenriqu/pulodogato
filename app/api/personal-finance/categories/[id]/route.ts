// ---------------------------------------------------------------------------
// PERSONALIZAR E REMOVER CATEGORIA (HMO-216)
// ---------------------------------------------------------------------------
// "Todas as categorias devem poder ser personalizadas pelo usuario."
//
// TODAS inclui as 13 do catalogo, e e dai que vem a unica coisa dificil desta
// rota: uma categoria do catalogo NAO PODE ser editada. A linha e a mesma para
// todos os usuarios do app, e a policy da 036 so permite UPDATE em
// `user_id = auth.uid()`.
//
// Entao ha dois destinos de escrita para o MESMO gesto da pessoa:
//
//   categoria dela      -> UPDATE em `transaction_categories`
//   categoria do catalogo -> UPSERT em `transaction_category_prefs`
//
// A escolha e do servidor, nao do cliente, e esta e a decisao de desenho desta
// rota. A alternativa -- dois endpoints, e a tela decidindo qual chamar --
// espalharia a regra "de quem e esta linha?" pela tela, pelo modo offline e
// por qualquer caminho futuro, e o primeiro que errasse levaria 42501 com a
// mensagem "erro ao salvar".
//
// O mesmo vale para a remocao, e por um motivo a mais: nenhum dos dois casos e
// um DELETE de verdade.
//
//   categoria dela, sem lancamento -> DELETE mesmo
//   categoria dela, COM lancamento -> is_active = FALSE
//                                     (a FK e RESTRICT; apagar a categoria de
//                                     300 lancamentos nao e o que a pessoa
//                                     pediu ao clicar em "excluir")
//   categoria do catalogo          -> is_hidden = TRUE na preferencia
//                                     (a linha e dos outros tambem)
// ---------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  validarNomeDeCategoria,
  mensagemDeErroDeNome,
} from "@/lib/categorias";

export const dynamic = "force-dynamic";

/** `#RRGGBB` ou nada. O valor entra em `style` na tela. */
function corFinal(valor: unknown): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (typeof valor !== "string") return null;
  return /^#[0-9A-Fa-f]{6}$/.test(valor.trim()) ? valor.trim() : null;
}

function textoFinal(valor: unknown): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (typeof valor !== "string") return undefined;
  const limpo = valor.trim();
  return limpo.length > 0 ? limpo : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Esta leitura faz duas coisas, e a segunda e a que importa: ela e o
    // controle de acesso. A policy de SELECT da 036 devolve catalogo + as
    // minhas, entao uma categoria de OUTRA pessoa chega aqui como "nao
    // encontrada" -- 404, nao 403. E a resposta certa: dizer "sem permissao"
    // confirmaria que aquele id existe.
    const { data: categoria } = await supabase
      .from("transaction_categories")
      .select("id, name, is_expense, user_id, service_id")
      .eq("id", id)
      .maybeSingle();

    if (!categoria) {
      return NextResponse.json(
        { error: "Categoria não encontrada." },
        { status: 404 }
      );
    }

    const corpo = await request.json().catch(() => null);
    const nome = textoFinal(corpo?.name);
    const icone = textoFinal(corpo?.icon);
    const cor = corFinal(corpo?.color_hex);
    const esconder = typeof corpo?.is_hidden === "boolean" ? corpo.is_hidden : undefined;

    if (nome !== undefined && nome !== null) {
      const { data: visiveis } = await supabase
        .from("transaction_categories")
        .select("id, name, is_expense")
        .eq("service_id", categoria.service_id);

      // O escopo da duplicata exclui a propria categoria (`id`) -- sem isso,
      // abrir e salvar sem mexer no nome diria "você já tem uma categoria com
      // esse nome" sobre ela mesma.
      //
      // Os nomes PERSONALIZADOS tambem concorrem: se a pessoa ja chama "Lazer"
      // de "Rolê", criar outra "Rolê" produziria duas linhas indistinguiveis no
      // seletor. A unique do banco nao pega esse caso (ela olha a coluna da
      // categoria, nao a da preferencia), entao a checagem aqui e a unica.
      const { data: prefs } = await supabase
        .from("transaction_category_prefs")
        .select("category_id, name");

      const apelidos = new Map(
        (prefs ?? [])
          .filter((p) => typeof p.name === "string" && p.name)
          .map((p) => [p.category_id, p.name as string])
      );

      const escopo = (visiveis ?? [])
        .filter((c) => c.is_expense === categoria.is_expense)
        .map((c) => ({ id: c.id, name: apelidos.get(c.id) ?? c.name }));

      const erro = validarNomeDeCategoria(nome, escopo, id);
      if (erro) {
        return NextResponse.json(
          { error: mensagemDeErroDeNome(erro) },
          { status: 400 }
        );
      }
    }

    // -----------------------------------------------------------------------
    // Categoria DELA: UPDATE direto na linha
    // -----------------------------------------------------------------------
    if (categoria.user_id === user.id) {
      if (esconder === true) {
        // "Esconder" uma categoria propria e desativa-la. Gravar `is_hidden`
        // numa pref sobre a propria categoria funcionaria e criaria dois
        // estados para a mesma coisa -- e a tela de gerenciar, que lista por
        // `is_active`, nao mostraria a categoria escondida nem para reativar.
        return await desativar(supabase, id);
      }

      const mudancas: Record<string, unknown> = {};
      if (nome !== undefined && nome !== null) mudancas.name = nome;
      if (icone !== undefined) mudancas.icon = icone;
      if (cor !== undefined) mudancas.color_hex = cor;
      if (esconder === false) mudancas.is_active = true;

      if (Object.keys(mudancas).length === 0) {
        return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });
      }

      // `.select()` depois do UPDATE nao e cosmetico: UPDATE filtrado pela RLS
      // nao da erro, ele afeta ZERO linhas e volta 200. Sem conferir o retorno
      // a rota responderia "salvo" sobre uma escrita que nao aconteceu.
      const { data: atualizada, error } = await supabase
        .from("transaction_categories")
        .update(mudancas)
        .eq("id", id)
        .eq("user_id", user.id)
        .select("id, name, icon, color_hex, is_expense, is_active, user_id")
        .maybeSingle();

      if (error) {
        if (error.code === "23505") {
          return NextResponse.json(
            { error: mensagemDeErroDeNome("duplicado") },
            { status: 409 }
          );
        }
        console.error("Erro ao atualizar categoria:", error);
        return NextResponse.json(
          { error: "Não foi possível salvar a categoria." },
          { status: 500 }
        );
      }

      if (!atualizada) {
        return NextResponse.json(
          { error: "Categoria não encontrada." },
          { status: 404 }
        );
      }

      return NextResponse.json({ category: atualizada, via: "categoria" });
    }

    // -----------------------------------------------------------------------
    // Categoria do CATALOGO: preferencia
    // -----------------------------------------------------------------------
    // `upsert` com `onConflict` na PK composta (user_id, category_id), que e um
    // indice CHEIO -- indice parcial nao serve de arbitro de ON CONFLICT, e
    // esta tabela de proposito nao tem nenhum.
    const pref: Record<string, unknown> = {
      user_id: user.id,
      category_id: id,
    };
    if (nome !== undefined) pref.name = nome;
    if (icone !== undefined) pref.icon = icone;
    if (cor !== undefined) pref.color_hex = cor;
    if (esconder !== undefined) pref.is_hidden = esconder;

    if (Object.keys(pref).length === 2) {
      return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });
    }

    const { data: salva, error: erroPref } = await supabase
      .from("transaction_category_prefs")
      .upsert(pref, { onConflict: "user_id,category_id" })
      .select("category_id, name, icon, color_hex, is_hidden")
      .maybeSingle();

    if (erroPref || !salva) {
      console.error("Erro ao personalizar categoria:", erroPref);
      return NextResponse.json(
        { error: "Não foi possível salvar a personalização." },
        { status: 500 }
      );
    }

    return NextResponse.json({ pref: salva, via: "preferencia" });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: categoria } = await supabase
      .from("transaction_categories")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle();

    if (!categoria) {
      return NextResponse.json(
        { error: "Categoria não encontrada." },
        { status: 404 }
      );
    }

    // Categoria do catalogo nao se apaga: esconde-se. A resposta diz qual dos
    // dois aconteceu (`via`) para que a tela possa dar o retorno certo -- e
    // para que "escondida" nunca seja anunciada como "excluída".
    if (categoria.user_id !== user.id) {
      const { error } = await supabase
        .from("transaction_category_prefs")
        .upsert(
          { user_id: user.id, category_id: id, is_hidden: true },
          { onConflict: "user_id,category_id" }
        );

      if (error) {
        console.error("Erro ao esconder categoria:", error);
        return NextResponse.json(
          { error: "Não foi possível esconder a categoria." },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: true, via: "escondida" });
    }

    // Categoria propria. Tentamos o DELETE e deixamos o BANCO decidir se ela
    // esta em uso, em vez de contar lancamentos antes: a contagem e uma corrida
    // (um lancamento criado entre o COUNT e o DELETE) e, pior, ela precisaria
    // olhar QUATRO tabelas (financial_transactions, transaction_installments,
    // recurring_rules, scheduled_transactions). O 23503 e a resposta exata.
    const { error } = await supabase
      .from("transaction_categories")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error?.code === "23503") {
      return await desativar(supabase, id);
    }

    if (error) {
      console.error("Erro ao excluir categoria:", error);
      return NextResponse.json(
        { error: "Não foi possível excluir a categoria." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, via: "excluida" });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Desativa a categoria propria, preservando o historico.
 *
 * Devolve `via: "desativada"` e nao `"excluida"`: a tela precisa poder dizer
 * "ela saiu da lista, e os lançamentos antigos continuam com o nome dela" --
 * que e verdade, e que e diferente do que a pessoa clicou.
 */
async function desativar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string
) {
  const { data, error } = await supabase
    .from("transaction_categories")
    .update({ is_active: false })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("Erro ao desativar categoria:", error);
    return NextResponse.json(
      { error: "Não foi possível remover a categoria." },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, via: "desativada" });
}
