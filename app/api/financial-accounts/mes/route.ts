// GET /api/financial-accounts/mes?mes=AAAA-MM
//
// O mes de cada conta de dinheiro, como a tela Contas do Minhas Financas:
// saldo inicial, receitas, despesas, transferencias recebidas e enviadas, saldo
// realizado e previsto. A regra esta no cabecalho de lib/saldo-por-conta.ts;
// aqui ficam so as consultas.
//
// `select("*")` nas contas pelo mesmo motivo de /api/net-worth: nomear
// `include_in_total` derruba a rota num banco sem a 058.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { addDays, today } from "@/lib/recurrence";
import { classeDaAgenda } from "@/lib/previsto-x-realizado";
import { materializarAgenda } from "@/lib/services/scheduled";
import {
  limitesDoMes,
  mesDasContas,
  type ContaDoMes,
  type LancamentoDoMes,
  type PontaDoPar,
  type PrevistaDoMes,
} from "@/lib/saldo-por-conta";

const PAGINA = 1000;
const LOTE_DE_IDS = 200;

function erro(contexto: string, causa: unknown) {
  console.error(`Mês das contas: ${contexto}:`, causa);
  return NextResponse.json(
    { error: "Não foi possível calcular o mês das contas" },
    { status: 500 }
  );
}

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const hoje = today();
  const mes = request.nextUrl.searchParams.get("mes") ?? hoje.slice(0, 7);
  const limites = limitesDoMes(mes);
  if (!limites) {
    return NextResponse.json(
      { error: "mes deve estar no formato AAAA-MM" },
      { status: 400 }
    );
  }

  const { data: contas, error: erroContas } = await supabase
    .from("financial_accounts")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_active", true);
  if (erroContas) return erro("erro ao ler as contas", erroContas);

  const todas = (contas ?? []) as ContaDoMes[];
  const ids = todas
    .filter((c) => c.account_type !== "credit_card")
    .map((c) => c.id);

  // Tudo o que mexe no saldo desde a vespera do mes: os lancamentos do mes e
  // os de depois dele, que saem do saldo de hoje. Em paginas, porque o
  // PostgREST corta a resposta em 1000 linhas.
  const vespera = addDays(limites.de, -1);
  let lancamentos: LancamentoDoMes[] = [];
  for (let inicio = 0; ids.length > 0; inicio += PAGINA) {
    const { data, error } = await supabase
      .from("financial_transactions")
      .select("id, account_id, amount, transaction_date, counterpart_transaction_id")
      .eq("user_id", user.id)
      .in("account_id", ids)
      .gt("transaction_date", vespera)
      .order("id")
      .range(inicio, inicio + PAGINA - 1);
    if (error) return erro("erro ao ler os lançamentos", error);
    lancamentos = lancamentos.concat((data ?? []) as LancamentoDoMes[]);
    if (!data || data.length < PAGINA) break;
  }

  // As pontas do outro lado: as que estes lancamentos apontam e as que
  // apontam para eles. E por elas que a transferencia entre contas se separa
  // do pagamento de fatura.
  const doMes = lancamentos.filter(
    (l) => l.transaction_date >= limites.de && l.transaction_date <= limites.ate
  );
  const apontados = doMes
    .map((l) => l.counterpart_transaction_id)
    .filter((id): id is string => Boolean(id));
  const idsDoMes = doMes.map((l) => l.id);
  let pares: PontaDoPar[] = [];
  for (const [coluna, valores] of [
    ["id", apontados],
    ["counterpart_transaction_id", idsDoMes],
  ] as const) {
    for (let i = 0; i < valores.length; i += LOTE_DE_IDS) {
      const { data, error } = await supabase
        .from("financial_transactions")
        .select("id, account_id, counterpart_transaction_id")
        .eq("user_id", user.id)
        .in(coluna, valores.slice(i, i + LOTE_DE_IDS));
      if (error) return erro("erro ao ler as transferências", error);
      pares = pares.concat((data ?? []) as PontaDoPar[]);
    }
  }

  // A agenda do mes, materializada antes de ler (como o fluxo de caixa): a
  // conta fixa de dezembro so existe na agenda depois disso. Falhar aqui nao
  // derruba a tela -- as previsoes que ja existem continuam contando.
  try {
    await materializarAgenda(supabase, user.id, {
      de: limites.de < hoje ? hoje : limites.de,
      ate: limites.ate,
    });
  } catch (erroAgenda) {
    console.error("Mês das contas seguiu sem materializar a agenda:", erroAgenda);
  }

  // A view para a direcao (ocorrencia -> regra -> 'expense', 027) e a tabela
  // para o destino da transferencia, que a view nao publica. O `.eq("user_id")`
  // tira as linhas de grupo dos outros membros, que a RLS deixa passar.
  const { data: agenda, error: erroAgenda } = await supabase
    .from("scheduled_transactions_effective")
    .select("id, account_id, amount, due_date, direction")
    .eq("user_id", user.id)
    .eq("my_status", "pending")
    .gte("due_date", limites.de)
    .lte("due_date", limites.ate);
  if (erroAgenda) return erro("erro ao ler a agenda", erroAgenda);

  const linhasDaAgenda = (agenda ?? []) as {
    id: string;
    account_id: string | null;
    amount: number | string;
    due_date: string;
    direction: string | null;
  }[];
  const transferencias = linhasDaAgenda
    .filter((p) => classeDaAgenda(p.direction) === "transfer")
    .map((p) => p.id);
  const destinos = new Map<string, string | null>();
  for (let i = 0; i < transferencias.length; i += LOTE_DE_IDS) {
    const { data, error } = await supabase
      .from("scheduled_transactions")
      .select("id, destination_account_id")
      .in("id", transferencias.slice(i, i + LOTE_DE_IDS));
    if (error) return erro("erro ao ler as transferências previstas", error);
    for (const linha of data ?? []) {
      destinos.set(linha.id, linha.destination_account_id ?? null);
    }
  }

  const previstas: PrevistaDoMes[] = linhasDaAgenda.map((p) => ({
    id: p.id,
    account_id: p.account_id,
    destination_account_id: destinos.get(p.id) ?? null,
    amount: p.amount,
    due_date: p.due_date,
    classe: classeDaAgenda(p.direction),
  }));

  const resultado = mesDasContas({
    contas: todas,
    lancamentos,
    pares,
    previstas,
    mes,
    hoje,
  });

  return NextResponse.json({ mes, hoje, ...resultado });
}
