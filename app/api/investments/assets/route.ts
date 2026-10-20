import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { TIPOS_DE_ATIVO, type AssetType } from "@/lib/investments";
import {
  camposDeRendaFixaVazios,
  lerCamposDeRendaFixa,
} from "@/lib/renda-fixa";
import {
  conferirContaDeInvestimento,
  lerContaDoCorpo,
} from "@/lib/conta-do-ativo";

// =====================================================
// POST /api/investments/assets
// =====================================================
// Cadastra um ativo na carteira do usuario.
// Body: { symbol, name, type, currency?, currentPrice?, accountId?,
//         fixedIncomeProduct?, indexKind?, indexPercentage?, spreadAnnual?,
//         appliedDate?, maturityDate? }
//
// `accountId` (ou `account_id`) e o elo com a Conta Investimento, criado pela
// migration 059. Ele e OPCIONAL e continua opcional: ausente quer dizer "ativo
// solto", que e o estado de todo ativo que ja existe em producao e um estado
// legitimo e permanente -- nao um pendente de migracao. Quem confere o elo e
// lib/conta-do-ativo.ts, e o cabecalho dele explica por que a conferencia vive
// na rota quando a trigger da 059 ja recusaria.
//
// Nao ha catalogo global de tickers (ver o cabecalho da migration 021): quem
// diz que PETR4 existe e o usuario. Entao a validacao aqui e de FORMA, nao de
// existencia -- recusar "PETR4" por nao estar numa lista nossa deixaria o
// usuario sem poder lancar o que ele de fato tem.
//
// Os seis campos de renda fixa (HMO-192) sao os da migration 031, e so entram
// quando `type` e `fixed_income`: o CHECK
// `investment_assets_renda_fixa_so_em_fixed_income` recusa uma PETR4 com
// indexador, e com razao -- ela apareceria na tela como acao rendendo CDI todo
// dia POR CIMA da variacao de preco, contando o rendimento duas vezes. Quem
// manda os campos num ativo de outro tipo tem os campos IGNORADOS em vez de um
// 400: o formulario esconde a secao ao trocar o tipo, e o estado dela pode
// sobreviver a troca.
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

    // So `fixed_income` carrega os seis campos da 031 -- ver o cabecalho.
    let rendaFixa = camposDeRendaFixaVazios();
    if (type === "fixed_income") {
      const leitura = lerCamposDeRendaFixa(body);
      if (!leitura.ok) {
        return NextResponse.json({ error: leitura.erro }, { status: 400 });
      }
      rendaFixa = leitura.campos;
    }

    // O elo com a Conta Investimento (059). A conferencia vem ANTES do INSERT:
    // depois dele, a trigger ja teria recusado a linha inteira e a unica coisa
    // que sobraria para dizer ao usuario seria um 500.
    const elo = lerContaDoCorpo(body);
    if (!elo.ok) {
      return NextResponse.json({ error: elo.erro }, { status: 400 });
    }
    // `account_id` so entra no payload quando foi pedido. Mandar `null`
    // explicito daria no mesmo (o default da coluna e nulo), mas a ausencia e o
    // que deixa o INSERT desta rota identico ao de antes desta fase para quem
    // nao usa a feature.
    const conta: { account_id?: string | null } = {};
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
      conta.account_id = elo.account_id;
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
        ...rendaFixa,
        ...conta,
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
