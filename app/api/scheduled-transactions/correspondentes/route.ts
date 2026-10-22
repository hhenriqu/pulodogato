// GET /api/scheduled-transactions/correspondentes?transaction_id=<uuid>
//
// "Isso e o pagamento de <prevista>?" -- as contas previstas que um lancamento
// recem-gravado PARECE pagar. O formulario de lancamento chama depois do
// Salvar e, se vier alguma, pergunta. Esta rota so LE: o vinculo so acontece
// no `POST /api/scheduled-transactions/{id}/vincular`, com a pessoa clicando
// "Sim". Nunca vincular sem confirmacao e a regra, e ela fica mais facil de
// manter com a leitura e a escrita em rotas diferentes.
//
// A regra da correspondencia (valor +-1%, vencimento +-7 dias, mesma categoria
// ou descricao) e `previstasCorrespondentes`, em lib/vinculo-da-prevista.ts.
// Aqui a consulta ja recorta a janela de vencimento e o dono, para nao trazer a
// agenda inteira por um lancamento.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { addDays } from "@/lib/recurrence";
import {
  JANELA_DA_SUGESTAO,
  previstasCorrespondentes,
  type LancamentoParaVinculo,
  type PrevistaParaVinculo,
} from "@/lib/vinculo-da-prevista";

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

    const transactionId = new URL(request.url).searchParams.get("transaction_id");
    if (!transactionId) {
      return NextResponse.json(
        { error: "Informe o lançamento" },
        { status: 400 }
      );
    }

    const { data: lancamento } = await supabase
      .from("financial_transactions")
      .select(
        "id, user_id, amount, transaction_date, transaction_type, category_id, description"
      )
      .eq("id", transactionId)
      .eq("user_id", user.id)
      .maybeSingle<LancamentoParaVinculo>();

    if (!lancamento) {
      return NextResponse.json(
        { error: "Lançamento não encontrado" },
        { status: 404 }
      );
    }

    // Um lancamento que ja quita uma prevista nao e sugerido de novo.
    const { data: jaVinculada } = await supabase
      .from("scheduled_transactions")
      .select("id")
      .eq("transaction_id", lancamento.id)
      .limit(1)
      .maybeSingle();

    if (jaVinculada) {
      return NextResponse.json({ scheduled: [] });
    }

    const { data: previstas, error } = await supabase
      .from("scheduled_transactions_effective")
      .select(
        "id, user_id, status, amount, due_date, direction, category_id, description, notes"
      )
      .eq("user_id", user.id)
      .eq("status", "pending")
      .gte("due_date", addDays(lancamento.transaction_date, -JANELA_DA_SUGESTAO))
      .lte("due_date", addDays(lancamento.transaction_date, JANELA_DA_SUGESTAO))
      .returns<PrevistaParaVinculo[]>();

    if (error) {
      console.error("Erro ao procurar a prevista correspondente:", error);
      return NextResponse.json(
        { error: "Não foi possível procurar a conta prevista" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      scheduled: previstasCorrespondentes(previstas ?? [], lancamento),
    });
  } catch (error) {
    console.error("Erro ao procurar a prevista correspondente:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
