import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  normalizeMerchant,
  totalMensal,
  type RecurrenceStatus,
} from "@/lib/recurrence-detector";
import {
  assinaturasDasContasFixas,
  totalMensalDasContasFixas,
  type AssinaturaDaContaFixa,
  type RegraDeAssinatura,
} from "@/lib/assinaturas-das-contas-fixas";
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

    // -----------------------------------------------------------------
    // AS CONTAS FIXAS MARCADAS COMO ASSINATURA (migration 084)
    // -----------------------------------------------------------------
    // O usuario cadastrou e marcou "e assinatura" na conta fixa (no cartao,
    // tipicamente). Elas entram na tela ao lado das detectadas e somam no
    // total.
    //
    // FALHAR AQUI NAO DERRUBA A TELA. Antes da migration 084 rodar a coluna
    // nao existe e o PostgREST responde 42703; `null` diz a tela que esta
    // parte nao foi lida, e as detectadas continuam aparecendo.
    let assinaturasFixas: AssinaturaDaContaFixa[] | null = null;
    const { data: regras, error: erroRegras } = await supabase
      .from("recurring_rules")
      .select(
        "id, description, amount, frequency, interval_count, due_day, account_id, is_active, transaction_type"
      )
      .eq("user_id", user.id)
      .eq("is_subscription", true)
      .eq("is_active", true);

    if (erroRegras) {
      console.error("Assinaturas seguiram sem as contas fixas:", erroRegras);
    } else {
      assinaturasFixas = assinaturasDasContasFixas(
        (regras ?? []) as RegraDeAssinatura[]
      );
    }

    // A MESMA ASSINATURA NAO CONTA DUAS VEZES. A conta fixa no cartao vira
    // compra todo mes, e o detector acaba achando a mesma Netflix no extrato.
    // Quando a chave do lojista da detectada bate com a descricao de uma
    // conta fixa marcada, vale a conta fixa (que o usuario cadastrou) e a
    // detectada sai da soma.
    const chavesDasFixas = new Set(
      (assinaturasFixas ?? []).map((a) => normalizeMerchant(a.descricao))
    );

    const totalDetectadas = totalMensal(
      lista
        .filter((r: { status: RecurrenceStatus }) =>
          r.status === "DETECTED" || r.status === "CONFIRMED"
        )
        .filter(
          (r: { merchant_key: string }) => !chavesDasFixas.has(r.merchant_key)
        )
        .map((r: { monthly_cost: string | number }) => ({
          monthlyCost: Number(r.monthly_cost),
        }))
    );
    const totalFixas = assinaturasFixas
      ? totalMensalDasContasFixas(assinaturasFixas)
      : 0;

    return NextResponse.json({
      recurrences: lista,
      // O total soma so o que esta valendo. Uma assinatura marcada como
      // cancelada ou ignorada nao pode continuar pesando no "quanto gasto por
      // mes" -- era esse numero que a tela existe para o usuario baixar.
      monthlyTotal: Math.round((totalDetectadas + totalFixas) * 100) / 100,
      // `null` = nao deu para ler (ver acima); `[]` = nenhuma marcada.
      fixedSubscriptions: assinaturasFixas,
      fixedMonthlyTotal: assinaturasFixas ? totalFixas : null,
      // As detectadas que repetem uma conta fixa, para a tela avisar.
      duplicatedMerchantKeys: Array.from(chavesDasFixas),
      alerts: alertas,
    });
  } catch (error) {
    console.error("Erro em GET /api/recurrences:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
