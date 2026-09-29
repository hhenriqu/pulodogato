import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// =====================================================
// PATCH /api/investments/assets/:assetId  -- atualiza o preco atual
// DELETE /api/investments/assets/:assetId -- remove o ativo e o historico dele
// =====================================================
// Enquanto nao houver fonte de cotacao contratada (HMO-141 item 2), o PATCH e o
// unico caminho pelo qual o preco atual entra no sistema. Quando houver, ela
// escreve nas MESMAS duas colunas e nada mais muda.
//
// O que o PATCH NAO aceita mudar: `symbol` e `user_id`.
//
// O symbol esta de fora porque ele e a identidade do ativo dentro da carteira --
// a chave do UNIQUE (user_id, symbol). Renomear PETR4 para VALE3 nao corrige um
// erro de digitacao: deixa todo o historico de compras da Petrobras pendurado na
// Vale, com preco medio somando dois ativos diferentes. O caminho certo para o
// erro de digitacao e apagar e cadastrar de novo, que e o DELETE abaixo.
// =====================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: { assetId: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Corpo invalido" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};

    if ("currentPrice" in body) {
      // null explicito limpa o preco: e como o usuario diz "nao sei mais quanto
      // vale". As duas colunas tem que ir juntas -- o CHECK do banco recusa uma
      // sem a outra.
      if (body.currentPrice === null || body.currentPrice === "") {
        patch.current_price = null;
        patch.current_price_at = null;
      } else {
        const preco = Number(body.currentPrice);
        if (!Number.isFinite(preco) || preco <= 0) {
          return NextResponse.json(
            { error: "Preco atual precisa ser um numero positivo" },
            { status: 400 }
          );
        }
        patch.current_price = preco;
        patch.current_price_at = new Date().toISOString();
      }
    }

    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json(
          { error: "Nome nao pode ficar vazio" },
          { status: 400 }
        );
      }
      patch.name = name;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Nada para atualizar" },
        { status: 400 }
      );
    }

    // O `.eq("user_id")` e redundante com a RLS de propósito: se algum dia uma
    // policy for afrouxada, o filtro explicito continua impedindo a escrita
    // cruzada. Ele tambem e o que faz o `.select()` voltar vazio -- e a rota
    // responder 404 em vez de 200 mudo -- quando o id nao e do usuario.
    const { data, error } = await supabase
      .from("investment_assets")
      .update(patch)
      .eq("id", params.assetId)
      .eq("user_id", user.id)
      .select()
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: `Erro ao atualizar ativo: ${error.message}` },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Ativo nao encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json({ asset: data });
  } catch (error) {
    console.error("Erro em PATCH /api/investments/assets/:assetId:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { assetId: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Os lancamentos vao junto, pelo ON DELETE CASCADE da FK composta (021). E
    // deliberado: lancamento sem ativo nao significa nada, e o banco recusaria a
    // exclusao se a FK fosse RESTRICT -- a tela ofereceria um botao que nunca
    // funciona.
    const { data, error } = await supabase
      .from("investment_assets")
      .delete()
      .eq("id", params.assetId)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: `Erro ao remover ativo: ${error.message}` },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Ativo nao encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json({ deleted: data.id });
  } catch (error) {
    console.error("Erro em DELETE /api/investments/assets/:assetId:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
