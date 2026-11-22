// GET /api/card-invoices/composicao?month=AAAA-MM&account_id=
//
// A composicao dos cartoes em fixo, assinatura, parcelado e esporadico: o
// MENSAL (a fatura do mes pedido; sem `month`, a do mes corrente) e o TOTAL
// para quitar (a divida em aberto, com o fixo e a assinatura so do mes atual).
// Sem `account_id`, todos os cartoes ativos, com a soma dos que entram nos
// totais. A regra esta em lib/composicao-da-fatura.ts; ver
// docs/COMPOSICAO-DA-FATURA.md.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { primeiroDiaDoMes, mesCorrente } from "@/lib/services/budget";
import { lancarCobrancasDoCartao } from "@/lib/services/cobranca-no-cartao";
import { lerComposicaoDosCartoes } from "@/lib/services/composicao-da-fatura";

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const mesParam = url.searchParams.get("month");
    const mes = mesParam ? primeiroDiaDoMes(mesParam) : mesCorrente();
    if (!mes) {
      return NextResponse.json(
        { error: "Mês deve estar no formato AAAA-MM" },
        { status: 400 }
      );
    }

    // A cobranca que venceu vira compra antes da leitura, como em
    // GET /api/card-invoices: senao ela contaria como prevista num dia em que
    // ja e compra. Nao lanca erro.
    await lancarCobrancasDoCartao(supabase, user.id);

    const resposta = await lerComposicaoDosCartoes(supabase, user.id, {
      mes,
      accountId: url.searchParams.get("account_id"),
    });
    if (!resposta) {
      return NextResponse.json(
        { error: "Não foi possível calcular a composição dos cartões" },
        { status: 500 }
      );
    }
    return NextResponse.json(resposta);
  } catch (error) {
    console.error("Erro na composição dos cartões:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
