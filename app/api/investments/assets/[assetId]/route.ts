import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { lerCamposDeRendaFixa } from "@/lib/renda-fixa";
import {
  conferirContaDeInvestimento,
  lerContaDoCorpo,
} from "@/lib/conta-do-ativo";

// =====================================================
// PATCH /api/investments/assets/:assetId  -- preco atual, renda fixa e conta
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
//
// O QUE O PATCH ACEITA MUDAR DESDE A 059: `accountId` (ou `account_id`), o elo
// com a Conta Investimento. Ele e o caminho de "atrelar" E de "soltar": um
// `null` explicito desfaz o elo e devolve o ativo ao estado solto, que e o
// estado valido de tudo que ja existe em producao. Sem este caminho, os ativos
// cadastrados desde a 021 nunca ganhariam conta -- so quem cadastrasse de novo,
// que e o mesmo buraco que a 031 deixou e este PATCH ja tapa para a renda fixa.
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

    // Os seis campos da 031 (HMO-192). Eles vao SEMPRE JUNTOS, e nao um a um,
    // porque os CHECK da migration cruzam uns com os outros: gravar
    // `index_percentage` sozinho num ativo cujo `index_kind` ja esta nulo quebra
    // `percentual_exige_indexador`, e um PATCH parcial tornaria a validacao
    // desta rota uma mentira (ela aprovaria um conjunto que ela nao viu
    // inteiro). O formulario manda a secao completa; `null` em qualquer um
    // limpa aquele campo.
    //
    // E este caminho que cumpre o "preenchimento progressivo" prometido pela
    // 031: os ativos de renda fixa cadastrados desde a 021 estao todos com os
    // seis campos nulos, e sem um PATCH eles nunca ganhariam rendimento
    // automatico -- so quem cadastrasse de novo.
    if ("indexKind" in body) {
      const { data: atual, error: erroLeitura } = await supabase
        .from("investment_assets")
        .select("type")
        .eq("id", params.assetId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (erroLeitura) {
        return NextResponse.json(
          { error: `Erro ao ler o ativo: ${erroLeitura.message}` },
          { status: 500 }
        );
      }
      if (!atual) {
        return NextResponse.json(
          { error: "Ativo nao encontrado" },
          { status: 404 }
        );
      }
      // O CHECK `renda_fixa_so_em_fixed_income` recusaria isso de todo jeito; a
      // checagem aqui existe pela mensagem. Ver o cabecalho de /assets.
      if (atual.type !== "fixed_income") {
        return NextResponse.json(
          {
            error:
              "Indexador e vencimento sao campos de renda fixa, e este ativo nao e",
          },
          { status: 400 }
        );
      }

      const leitura = lerCamposDeRendaFixa(body);
      if (!leitura.ok) {
        return NextResponse.json({ error: leitura.erro }, { status: 400 });
      }
      Object.assign(patch, leitura.campos);
    }

    // O elo com a Conta Investimento (059). Mesma funcao que o POST usa, e nao
    // uma segunda copia da regra: a travessa de arquivar grupo ja mostrou o
    // custo de escrever a mesma pergunta em dois lugares -- o defeito da
    // HMO-145 estava nas duas copias, e consertar uma delas deixou a outra
    // verde por meses.
    const elo = lerContaDoCorpo(body);
    if (!elo.ok) {
      return NextResponse.json({ error: elo.erro }, { status: 400 });
    }
    if (elo.presente) {
      if (elo.account_id !== null) {
        const conferida = await conferirContaDeInvestimento(
          supabase,
          elo.account_id,
          user.id
        );
        if (!conferida.ok) {
          return NextResponse.json(
            { error: conferida.erro },
            { status: conferida.status }
          );
        }
      }
      // `null` chega ao banco de proposito: e ele que solta o ativo. Por isso o
      // teste da chave e `elo.presente` e nao `elo.account_id`, que confundiria
      // "nao pediu" com "pediu para soltar".
      patch.account_id = elo.account_id;
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
