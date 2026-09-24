import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { totalMensal, type RecurrenceStatus } from "@/lib/recurrence-detector";
import {
  alertasDasRecorrencias,
  type RecorrenciaParaAlerta,
} from "@/lib/services/recurrence-alerts";

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
//
// O CALCULO SAIU DAQUI NA HMO-148
// -------------------------------
// Ele mora em lib/services/recurrence-alerts.ts porque ganhou um terceiro
// consumidor: o cron que manda o push. Enquanto era so esta rota, uma funcao
// local bastava; com o push, a tela e o sino, uma copia da regra em cada lugar
// significaria tres textos que divergem na primeira correcao de redacao. O que
// o banco passou a guardar (migration 016) e so o "ja avisei", nao a regra.
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
    const alertas = await alertasDasRecorrencias(
      supabase,
      user.id,
      lista as RecorrenciaParaAlerta[]
    );

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
