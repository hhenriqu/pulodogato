import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  alertaDeAumento,
  alertaDeCobrancaAposCancelamento,
  totalMensal,
  type Alerta,
  type RecurrenceStatus,
} from "@/lib/recurrence-detector";

// =====================================================
// GET /api/recurrences
// =====================================================
// Le o que o detector ja gravou. NAO detecta: quem detecta e
// POST /api/recurrences/scan.
//
// A separacao importa porque a deteccao varre meses de transacoes e escreve;
// se isso morasse no GET, abrir a tela duas vezes seguidas faria duas varreduras
// e a tela ficaria lenta na exata proporcao do historico do usuario. Aqui o GET
// e uma consulta indexada (idx_detected_recurrences_user_status).
//
// Os ALERTAS, por outro lado, sao calculados na leitura. Eles sao derivados --
// "o preco subiu" e uma comparacao entre colunas que ja estao na linha -- e
// manter uma tabela sincronizada com isso custaria mais que recalcular. Ver o
// cabecalho da migration 011.
// =====================================================

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    // Por padrao a tela nao mostra o que o usuario mandou ignorar. `?status=all`
    // traz tudo, que e como ele desfaz um "ignorar".
    const filtro = url.searchParams.get("status");

    let query = supabase
      .from("detected_recurrences")
      .select("*")
      .eq("user_id", user.id)
      .order("monthly_cost", { ascending: false });

    if (filtro && filtro !== "all") {
      query = query.eq("status", filtro);
    } else if (!filtro) {
      query = query.neq("status", "IGNORED");
    }

    const { data: recorrencias, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: `Erro ao buscar recorrencias: ${error.message}` },
        { status: 500 }
      );
    }

    const lista = recorrencias || [];
    const alertas = await montarAlertas(supabase, user.id, lista);

    return NextResponse.json({
      recurrences: lista,
      // O total soma so o que esta valendo. Uma assinatura marcada como
      // cancelada ou ignorada nao pode continuar pesando no "quanto gasto por
      // mes" -- era esse numero que a tela existe para o usuario baixar.
      monthlyTotal: totalMensal(
        lista
          .filter((r: { status: RecurrenceStatus }) =>
            r.status === "DETECTED" || r.status === "CONFIRMED"
          )
          .map((r: { monthly_cost: string | number }) => ({
            monthlyCost: Number(r.monthly_cost),
          }))
      ),
      alerts: alertas,
    });
  } catch (error) {
    console.error("Erro em GET /api/recurrences:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/**
 * Monta os dois alertas do criterio de aceite a partir das transacoes que
 * sustentam cada recorrencia.
 *
 * Uma consulta so para todas as recorrencias, e nao uma por linha: com 20
 * assinaturas o laco ingenuo faria 20 viagens ao banco a cada abertura da
 * tela.
 */
async function montarAlertas(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  recorrencias: Array<{
    id: string;
    merchant_key: string;
    display_name: string;
    status: RecurrenceStatus;
    status_changed_at: string | null;
    transaction_ids: string[];
  }>
): Promise<Alerta[]> {
  const todosIds = recorrencias.flatMap((r) => r.transaction_ids || []);
  if (todosIds.length === 0) return [];

  const { data: transacoes } = await supabase
    .from("financial_transactions")
    .select("id, description, amount, transaction_date")
    .eq("user_id", userId)
    .in("id", todosIds)
    .order("transaction_date", { ascending: true });

  if (!transacoes) return [];

  const porId = new Map(transacoes.map((t) => [t.id, t]));
  const alertas: Alerta[] = [];

  for (const r of recorrencias) {
    const doGrupo = (r.transaction_ids || [])
      .map((id) => porId.get(id))
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));

    if (doGrupo.length === 0) continue;

    const aumento = alertaDeAumento(
      r.merchant_key,
      r.display_name,
      doGrupo.map((t) => Number(t.amount))
    );
    if (aumento) alertas.push(aumento);

    if (r.status === "CANCELLED" && r.status_changed_at) {
      const cobrou = alertaDeCobrancaAposCancelamento(
        r.merchant_key,
        r.display_name,
        r.status,
        r.status_changed_at.slice(0, 10),
        doGrupo.map((t) => ({
          id: t.id,
          description: t.description,
          amount: Number(t.amount),
          transaction_date: t.transaction_date,
        }))
      );
      if (cobrou) alertas.push(cobrou);
    }
  }

  return alertas;
}
