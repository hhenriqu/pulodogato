// GET /api/dashboard/saldo-em-conta?de=AAAA-MM-DD&ate=AAAA-MM-DD
//
// O tile "Saldo em conta" do painel: o dinheiro nas contas que nao sao cartao,
// no comeco e no fim do periodo, com as entradas realizadas e as saidas pagas
// entre os dois. A regra, e por que o cartao fica de fora, esta no cabecalho de
// lib/saldo-em-conta.ts.
//
// `select("*")` nas contas pelo mesmo motivo de /api/net-worth: nomear
// `include_in_total` derruba a rota num banco sem a 058.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { addDays, today } from "@/lib/recurrence";
import { ehDataIso } from "@/lib/periodo-do-painel";
import {
  calcularSaldoEmConta,
  contasDeDinheiro,
  type ContaDoSaldo,
} from "@/lib/saldo-em-conta";

export async function GET(request: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const de = params.get("de");
  const ate = params.get("ate");
  if (!ehDataIso(de) || !ehDataIso(ate) || ate < de) {
    return NextResponse.json(
      { error: "de e ate devem ser datas AAAA-MM-DD, com ate >= de" },
      { status: 400 }
    );
  }

  const { data: contas, error: erroContas } = await supabase
    .from("financial_accounts")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (erroContas) {
    console.error("Saldo em conta: erro ao ler as contas:", erroContas);
    return NextResponse.json(
      { error: "Não foi possível calcular o saldo em conta" },
      { status: 500 }
    );
  }

  const hoje = today();
  const dinheiro = contasDeDinheiro((contas ?? []) as ContaDoSaldo[]);
  const ids = dinheiro.map((c) => c.id);
  // Tudo o que pode mexer no saldo a partir da vespera do comeco: os
  // lancamentos do periodo e os de depois dele, que saem do saldo de hoje.
  const desde = addDays(de < hoje ? de : hoje, -1);

  let lancamentos: Parameters<typeof calcularSaldoEmConta>[0]["lancamentos"] = [];
  // Em paginas de 1000: o PostgREST corta a resposta ali, e uma pagina a
  // menos aqui vira um saldo errado sem erro nenhum.
  const PAGINA = 1000;
  for (let inicio = 0; ids.length > 0; inicio += PAGINA) {
    const { data, error } = await supabase
      .from("financial_transactions")
      .select("id, account_id, amount, transaction_date, counterpart_transaction_id")
      .eq("user_id", user.id)
      .in("account_id", ids)
      .gt("transaction_date", desde)
      .order("id")
      .range(inicio, inicio + PAGINA - 1);

    if (error) {
      console.error("Saldo em conta: erro ao ler os lançamentos:", error);
      return NextResponse.json(
        { error: "Não foi possível calcular o saldo em conta" },
        { status: 500 }
      );
    }
    lancamentos = lancamentos.concat(data ?? []);
    if (!data || data.length < PAGINA) break;
  }

  const saldo = calcularSaldoEmConta({
    contas: (contas ?? []) as ContaDoSaldo[],
    lancamentos,
    de,
    ate,
    hoje,
  });

  return NextResponse.json({ saldo });
}
