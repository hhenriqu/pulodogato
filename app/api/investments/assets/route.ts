import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { TIPOS_DE_ATIVO, type AssetType } from "@/lib/investments";

// =====================================================
// POST /api/investments/assets
// =====================================================
// Cadastra um ativo na carteira do usuario.
// Body: { symbol, name, type, currency?, currentPrice? }
//
// Nao ha catalogo global de tickers (ver o cabecalho da migration 021): quem
// diz que PETR4 existe e o usuario. Entao a validacao aqui e de FORMA, nao de
// existencia -- recusar "PETR4" por nao estar numa lista nossa deixaria o
// usuario sem poder lancar o que ele de fato tem.
// =====================================================

/** Normaliza como o CHECK do banco exige: maiuscula, sem espaco na borda. */
function normalizarSimbolo(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toUpperCase();
}

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

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Corpo invalido" }, { status: 400 });
    }

    const symbol = normalizarSimbolo(body.symbol);
    const name = String(body.name ?? "").trim();
    const type = String(body.type ?? "") as AssetType;
    const currency = String(body.currency ?? "BRL")
      .trim()
      .toUpperCase();

    if (!symbol || symbol.length > 16) {
      return NextResponse.json(
        { error: "Informe o codigo do ativo (ate 16 caracteres)" },
        { status: 400 }
      );
    }
    if (!name) {
      return NextResponse.json(
        { error: "Informe o nome do ativo" },
        { status: 400 }
      );
    }
    if (!TIPOS_DE_ATIVO.includes(type)) {
      return NextResponse.json(
        { error: `Tipo invalido. Use um de: ${TIPOS_DE_ATIVO.join(", ")}` },
        { status: 400 }
      );
    }
    if (currency.length !== 3) {
      return NextResponse.json(
        { error: "Moeda deve ter 3 letras (ex.: BRL, USD)" },
        { status: 400 }
      );
    }

    // Preco e opcional. Quem nao informa fica com a posicao avaliada pelo custo
    // e a tela avisa -- ver o cabecalho de lib/investments.ts.
    let current_price: number | null = null;
    let current_price_at: string | null = null;
    if (body.currentPrice !== undefined && body.currentPrice !== null && body.currentPrice !== "") {
      const preco = Number(body.currentPrice);
      if (!Number.isFinite(preco) || preco <= 0) {
        return NextResponse.json(
          { error: "Preco atual precisa ser um numero positivo" },
          { status: 400 }
        );
      }
      current_price = preco;
      // O par preco/data e obrigatorio no banco (CHECK). Gravar a data aqui e
      // nao no cliente porque o relogio do navegador do usuario pode estar em
      // qualquer lugar, e essa data e o que a tela mostra como "preco de".
      current_price_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from("investment_assets")
      .insert({
        user_id: user.id,
        symbol,
        name,
        type,
        currency,
        current_price,
        current_price_at,
      })
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation. Mensagem propria porque "duplicate key value
      // violates constraint investment_assets_user_symbol_unico" nao diz nada
      // para quem esta olhando o formulario.
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `${symbol} ja esta na sua carteira` },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: `Erro ao cadastrar ativo: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ asset: data }, { status: 201 });
  } catch (error) {
    console.error("Erro em POST /api/investments/assets:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
