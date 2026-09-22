// POST /api/budgets/carry-forward   repete os tetos de um mes no mes seguinte
//
// Body opcional: { from: 'YYYY-MM', to: 'YYYY-MM' }. Sem body, repete o mes
// corrente no proximo.
//
// Esta rota e o que evita redigitar o orcamento inteiro todo dia 1. So copia
// os tetos marcados com carry_forward, e nunca sobrescreve um teto que ja
// exista no mes destino -- ver repetirOrcamentos() para o porque.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { repetirOrcamentos, primeiroDiaDoMes } from "@/lib/services/budget";

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

    const body = await request.json().catch(() => ({}));

    const de = body.from ? primeiroDiaDoMes(body.from) : null;
    const para = body.to ? primeiroDiaDoMes(body.to) : null;

    if ((body.from && !de) || (body.to && !para)) {
      return NextResponse.json(
        { error: "Mês deve estar no formato AAAA-MM" },
        { status: 400 }
      );
    }

    const resultado = await repetirOrcamentos(supabase, user.id, {
      de: de ?? undefined,
      para: para ?? undefined,
    });

    return NextResponse.json(resultado);
  } catch (error) {
    console.error("Erro ao repetir orçamentos:", error);
    return NextResponse.json(
      { error: "Não foi possível repetir os orçamentos" },
      { status: 500 }
    );
  }
}
