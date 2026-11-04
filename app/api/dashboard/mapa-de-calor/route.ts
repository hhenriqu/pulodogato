// -----------------------------------------------------------------------------
// GET /api/dashboard/mapa-de-calor?de=AAAA-MM-DD&ate=AAAA-MM-DD
// -----------------------------------------------------------------------------
// O gasto de cada dia do periodo, para o mapa de calor da tela inicial. A regra
// (o cartao pela COMPRA, o que fica de fora e por que) esta no cabecalho de
// lib/mapa-de-calor.ts; aqui so ha a leitura.
//
// DUAS FONTES, AS MESMAS DO REALIZADO, SEM A FATURA
// -------------------------------------------------
//   1. `financial_transactions` do usuario, `expense`, dentro dos totais. A
//      despesa de grupo que EU paguei entra inteira, como no Realizado.
//   2. `group_share_entries` com `paguei_eu = false`: a minha parte do que
//      outro membro pagou, no dia da despesa. Sem ela o dia do jantar que um
//      amigo pagou ficaria frio.
// A fatura paga NAO entra: as compras dela ja estao na fonte 1, cada uma no
// seu dia. Somar a fatura tambem contaria o cartao duas vezes.
//
// `eq("user_id")` e load-bearing nas duas, pelo mesmo motivo de
// lib/services/resultado-do-mes.ts: a policy de grupo deixa ler as linhas dos
// outros membros.
// -----------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import { ehDataIso } from "@/lib/periodo-do-painel";
import { lerPreferenciaDeMoeda, moedaSugerida } from "@/lib/moeda";
import { apenasNosTotais } from "@/lib/fora-dos-totais";
import { viewDaParteAusente } from "@/lib/parte-do-grupo-realizada";
import {
  diasDoPeriodo,
  MAXIMO_DE_DIAS_DO_MAPA,
  montarMapaDeCalor,
  type GastoDoDia,
} from "@/lib/mapa-de-calor";

export const dynamic = "force-dynamic";

const PAGINA = 1000;

interface LinhaDeGasto {
  amount: number | string;
  transaction_type: string | null;
  transaction_date: string;
  currency: string | null;
  include_in_total?: boolean | null;
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

  const params = request.nextUrl.searchParams;
  const de = params.get("de");
  const ate = params.get("ate");
  if (!ehDataIso(de) || !ehDataIso(ate) || ate < de) {
    return NextResponse.json(
      { error: "de e ate devem ser datas AAAA-MM-DD, com ate >= de" },
      { status: 400 },
    );
  }
  if (diasDoPeriodo(de, ate) > MAXIMO_DE_DIAS_DO_MAPA) {
    return NextResponse.json(
      {
        error: `O mapa de calor desenha até ${MAXIMO_DE_DIAS_DO_MAPA} dias`,
      },
      { status: 400 },
    );
  }

  const hoje = today();
  // O que ainda nao aconteceu nao e lido. Periodo inteiramente futuro: nada a
  // ler, e o mapa sai so com dias apagados.
  const lerAte = ate < hoje ? ate : hoje;

  const { data: perfil } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", user.id)
    .maybeSingle();
  const oficial = lerPreferenciaDeMoeda(perfil?.preferences).oficial;

  const linhas: LinhaDeGasto[] = [];

  if (de <= lerAte) {
    // Fonte 1 -- os lancamentos do usuario.
    for (let inicio = 0; ; inicio += PAGINA) {
      const { data, error } = await supabase
        .from("financial_transactions")
        .select(
          "amount, transaction_type, transaction_date, currency, include_in_total",
        )
        .eq("user_id", user.id)
        .eq("transaction_type", "expense")
        .gte("transaction_date", de)
        .lte("transaction_date", lerAte)
        .order("id", { ascending: true })
        .range(inicio, inicio + PAGINA - 1);

      if (error) {
        console.error("Mapa de calor: erro ao ler os lançamentos:", error);
        return NextResponse.json(
          { error: "Não foi possível montar o mapa de calor" },
          { status: 500 },
        );
      }
      const lote = (data ?? []) as LinhaDeGasto[];
      for (const linha of apenasNosTotais(lote)) linhas.push(linha);
      if (lote.length < PAGINA) break;
    }

    // Fonte 2 -- a minha parte do que outro membro pagou.
    for (let inicio = 0; ; inicio += PAGINA) {
      const { data, error } = await supabase
        .from("group_share_entries")
        .select("amount, transaction_type, transaction_date, currency")
        .eq("user_id", user.id)
        .eq("paguei_eu", false)
        .eq("transaction_type", "expense")
        .gte("transaction_date", de)
        .lte("transaction_date", lerAte)
        .order("id", { ascending: true })
        .range(inicio, inicio + PAGINA - 1);

      // A view ainda nao existe neste banco: segue sem a parte de grupo, que e
      // o mesmo comportamento do Realizado nessa janela.
      if (error && viewDaParteAusente(error)) break;
      if (error) {
        console.error("Mapa de calor: erro ao ler a parte de grupo:", error);
        return NextResponse.json(
          { error: "Não foi possível montar o mapa de calor" },
          { status: 500 },
        );
      }
      const lote = (data ?? []) as LinhaDeGasto[];
      for (const linha of lote) linhas.push(linha);
      if (lote.length < PAGINA) break;
    }
  }

  let outrasMoedas = 0;
  const gastos: GastoDoDia[] = [];
  for (const linha of linhas) {
    const codigo = moedaSugerida({
      doLancamento: linha.currency,
      oficial,
    });
    if (codigo !== oficial.toUpperCase()) {
      outrasMoedas += 1;
      continue;
    }
    gastos.push({
      data: String(linha.transaction_date).slice(0, 10),
      valor: Number(linha.amount),
    });
  }

  const mapa = montarMapaDeCalor({ de, ate, hoje, gastos });

  return NextResponse.json({
    mapa,
    moeda: oficial,
    hoje,
    /** Quantos lancamentos ficaram fora por estarem em outra moeda. */
    outras_moedas: outrasMoedas,
  });
}
