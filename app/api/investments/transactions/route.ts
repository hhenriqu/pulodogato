import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  quantidadeDisponivel,
  type InvestmentKind,
  type LancamentoBruto,
} from "@/lib/investments";

// =====================================================
// POST /api/investments/transactions
// =====================================================
// Lanca compra, venda ou provento.
// Body: { assetId, kind, quantity, unitPrice, fees?, tradeDate, notes? }
//
// VALORES SEMPRE POSITIVOS. A direcao esta em `kind`, nao no sinal -- o oposto da
// convencao de `financial_transactions`, onde despesa e negativa. O banco tem
// CHECK para os tres valores, entao mandar quantidade negativa aqui volta 500 e
// nao preco medio errado; mesmo assim a validacao abaixo devolve 400 com texto,
// porque 500 nao explica nada para quem esta no formulario.
//
// A VENDA QUE EXCEDE A POSICAO
// ----------------------------
// E a unica regra desta rota que o banco nao consegue guardar: ela depende das
// OUTRAS linhas da tabela, e CHECK nao ve outras linhas. Sem a verificacao aqui,
// vender 30 de uma posicao de 10 grava sem erro e a tela passa a mostrar preco
// medio zero -- lib/investments.ts trava a quantidade em zero e marca
// `exceeded_position`, mas isso e rede de seguranca para linha editada a mao no
// banco, nao lugar de barrar entrada de usuario.
// =====================================================

const KINDS: InvestmentKind[] = ["buy", "sell", "dividend"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

    const assetId = String(body.assetId ?? "");
    const kind = String(body.kind ?? "") as InvestmentKind;
    const quantity = Number(body.quantity);
    const unitPrice = Number(body.unitPrice);
    const fees = body.fees === undefined || body.fees === null || body.fees === "" ? 0 : Number(body.fees);
    const tradeDate = String(body.tradeDate ?? "");

    if (!assetId) {
      return NextResponse.json({ error: "Informe o ativo" }, { status: 400 });
    }
    if (!KINDS.includes(kind)) {
      return NextResponse.json(
        { error: `Tipo de lancamento invalido. Use um de: ${KINDS.join(", ")}` },
        { status: 400 }
      );
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json(
        { error: "Quantidade precisa ser um numero positivo" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      return NextResponse.json(
        {
          error:
            kind === "dividend"
              ? "Informe o valor por cota (positivo)"
              : "Preco unitario precisa ser um numero positivo",
        },
        { status: 400 }
      );
    }
    if (!Number.isFinite(fees) || fees < 0) {
      return NextResponse.json(
        { error: "Taxas nao podem ser negativas" },
        { status: 400 }
      );
    }
    if (!ISO_DATE.test(tradeDate)) {
      return NextResponse.json(
        { error: "Data invalida (use AAAA-MM-DD)" },
        { status: 400 }
      );
    }

    // O ativo tem que ser do usuario. A FK composta da 021 ja recusaria o
    // cruzado, mas ela devolveria 23503 -- e "violates foreign key constraint"
    // nao e mensagem de tela.
    const { data: ativo, error: erroAtivo } = await supabase
      .from("investment_assets")
      .select("id")
      .eq("id", assetId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (erroAtivo) {
      return NextResponse.json(
        { error: `Erro ao conferir o ativo: ${erroAtivo.message}` },
        { status: 500 }
      );
    }
    if (!ativo) {
      return NextResponse.json(
        { error: "Ativo nao encontrado na sua carteira" },
        { status: 404 }
      );
    }

    if (kind === "sell") {
      const { data: anteriores, error: erroAnteriores } = await supabase
        .from("investment_transactions")
        .select("asset_id, kind, quantity, unit_price, fees, trade_date")
        .eq("user_id", user.id)
        .eq("asset_id", assetId);

      if (erroAnteriores) {
        return NextResponse.json(
          { error: `Erro ao conferir a posicao: ${erroAnteriores.message}` },
          { status: 500 }
        );
      }

      const disponivel = quantidadeDisponivel(
        (anteriores || []) as LancamentoBruto[],
        assetId
      );

      if (quantity > disponivel) {
        return NextResponse.json(
          {
            error: `Voce tem ${disponivel} em carteira e tentou vender ${quantity}`,
            available: disponivel,
          },
          { status: 409 }
        );
      }
    }

    const { data, error } = await supabase
      .from("investment_transactions")
      .insert({
        user_id: user.id,
        asset_id: assetId,
        kind,
        quantity,
        unit_price: unitPrice,
        fees,
        trade_date: tradeDate,
        notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
      })
      .select()
      .single();

    if (error) {
      // 23514 = check_violation: data no futuro, ou valor que escapou da
      // validacao acima.
      if (error.code === "23514") {
        return NextResponse.json(
          { error: "Lancamento recusado pelas regras do banco (data futura ou valor invalido)" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: `Erro ao gravar lancamento: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ transaction: data }, { status: 201 });
  } catch (error) {
    console.error("Erro em POST /api/investments/transactions:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
