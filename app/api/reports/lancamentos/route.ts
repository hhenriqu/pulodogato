// GET /api/reports/lancamentos?de=AAAA-MM-DD&ate=AAAA-MM-DD
//     &referencia=lancamento|vencimento|efetivacao
//     &situacao=todas|efetivadas|pendentes
//     &tipo=expense|income &tag= &categoria= &conta=
//
// O relatorio de lancamentos com DATA DE REFERENCIA, como no Minhas Financas.
// A regra (qual data vale em cada referencia, o que soma) esta em
// lib/relatorio-de-lancamentos.ts; aqui ficam so as consultas.
//
// O BANCO RECORTA UM SUPERCONJUNTO e o JavaScript recorta o exato: "vencimento
// no periodo" e `COALESCE(expected_date, transaction_date)`, que o PostgREST
// nao filtra direto -- vira um `or()` das duas formas, e `dataDaEfetivada`
// decide a linha.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { addDays } from "@/lib/recurrence";
import { ehDataIso } from "@/lib/periodo-do-painel";
import { tagsDoTexto } from "@/lib/tags";
import {
  dataDeReferencia,
  montarRelatorio,
  situacao as lerSituacao,
  type EfetivadaCrua,
  type PendenteCrua,
} from "@/lib/relatorio-de-lancamentos";

const PAGINA = 1000;

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
  const referencia = dataDeReferencia(params.get("referencia"));
  const situacao = lerSituacao(params.get("situacao"));
  const tipoBruto = params.get("tipo");
  const tipo = tipoBruto === "income" || tipoBruto === "expense" ? tipoBruto : null;
  const tag = tagsDoTexto(params.get("tag"))[0] ?? null;

  let efetivadas: EfetivadaCrua[] = [];
  if (situacao !== "pendentes") {
    const colunaDaData =
      referencia === "vencimento"
        ? "expected_date"
        : referencia === "lancamento"
          ? "launch_date"
          : null;
    for (let inicio = 0; ; inicio += PAGINA) {
      let consulta = supabase
        .from("financial_transactions")
        .select(
          "id, description, amount, transaction_type, transaction_date, expected_date, launch_date, category_id, account_id, include_in_total, tags"
        )
        .eq("user_id", user.id)
        .in("transaction_type", ["income", "expense"]);
      consulta = colunaDaData
        ? consulta.or(
            `and(${colunaDaData}.gte.${de},${colunaDaData}.lte.${ate}),and(${colunaDaData}.is.null,transaction_date.gte.${de},transaction_date.lte.${ate})`
          )
        : consulta.gte("transaction_date", de).lte("transaction_date", ate);
      if (tag) consulta = consulta.contains("tags", [tag]);
      const { data, error } = await consulta
        .order("id")
        .range(inicio, inicio + PAGINA - 1);
      if (error) {
        console.error("Relatório de lançamentos: erro nas efetivadas:", error);
        return NextResponse.json(
          { error: "Não foi possível montar o relatório" },
          { status: 500 }
        );
      }
      efetivadas = efetivadas.concat((data ?? []) as EfetivadaCrua[]);
      if (!data || data.length < PAGINA) break;
    }
  }

  // A previsao pendente nao tem tag (a coluna e de `financial_transactions`)
  // nem efetivacao: com um dos dois no filtro, nenhuma entra.
  let pendentes: PendenteCrua[] = [];
  if (situacao !== "efetivadas" && referencia !== "efetivacao" && !tag) {
    let consulta = supabase
      .from("scheduled_transactions_effective")
      .select("id, description, amount, direction, due_date, created_at, category_id, account_id")
      .eq("user_id", user.id)
      .eq("my_status", "pending");
    consulta =
      referencia === "vencimento"
        ? consulta.gte("due_date", de).lte("due_date", ate)
        : consulta.gte("created_at", de).lt("created_at", addDays(ate, 1));
    const { data, error } = await consulta;
    if (error) {
      console.error("Relatório de lançamentos: erro nas pendentes:", error);
      return NextResponse.json(
        { error: "Não foi possível montar o relatório" },
        { status: 500 }
      );
    }
    pendentes = (data ?? []) as PendenteCrua[];
  }

  const relatorio = montarRelatorio({
    efetivadas,
    pendentes,
    de,
    ate,
    referencia,
    situacao,
    tag,
    categoriaId: params.get("categoria") || null,
    contaId: params.get("conta") || null,
    tipo,
  });

  return NextResponse.json({ de, ate, referencia, situacao, tag, ...relatorio });
}
