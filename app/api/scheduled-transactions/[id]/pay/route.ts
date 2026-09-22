// POST   /api/scheduled-transactions/{id}/pay   da baixa: vira transacao real
// DELETE /api/scheduled-transactions/{id}/pay   estorna a baixa
//
// Este e o unico ponto em que uma conta prevista vira dinheiro de verdade.
// Duas coisas importam aqui:
//
// 1. O saldo da conta e os saldos do grupo sao mantidos por TRIGGER em
//    financial_transactions (update_account_balance, sync_transaction_with_group,
//    auto_create_group_transaction). Entao a baixa so precisa inserir a
//    transacao - refazer a divisao do grupo na mao, como faz a rota antiga de
//    personal-finance, criaria split em dobro.
//
// 2. Nao ha transacao de banco entre os dois passos (o supabase-js fala
//    PostgREST, uma requisicao por vez). A ordem foi escolhida para que a
//    falha no meio seja a menos ruim: primeiro cria a transacao, depois marca
//    a conta como paga. Se o segundo passo falhar, a transacao criada e
//    apagada em seguida - e o pior caso vira "nao deu baixa", que o usuario
//    ve e refaz, em vez de "conta marcada como paga sem dinheiro nenhum
//    lancado", que ninguem percebe.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getServiceId, valorComSinal } from "@/lib/services/scheduled";
import { isIsoDate, today } from "@/lib/recurrence";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
    const paid_date = body.paid_date ?? today();
    // A conta de luz quase nunca fecha no valor previsto: a baixa aceita o
    // valor real e mantem o previsto na linha, para o relatorio de desvio.
    const valorPago = body.amount != null ? Math.abs(Number(body.amount)) : null;

    if (!isIsoDate(paid_date)) {
      return NextResponse.json(
        { error: "Data de pagamento deve estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    if (valorPago != null && !(valorPago > 0)) {
      return NextResponse.json(
        { error: "Valor pago deve ser maior que zero" },
        { status: 400 }
      );
    }

    const { data: conta } = await supabase
      .from("scheduled_transactions")
      .select("*, recurring_rule:recurring_rules(transaction_type)")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .single();

    if (!conta) {
      return NextResponse.json(
        { error: "Conta prevista não encontrada" },
        { status: 404 }
      );
    }

    if (conta.status === "paid") {
      return NextResponse.json(
        { error: "Esta conta já foi paga" },
        { status: 409 }
      );
    }

    if (conta.status === "cancelled") {
      return NextResponse.json(
        { error: "Esta conta foi cancelada" },
        { status: 409 }
      );
    }

    const serviceId = await getServiceId(supabase);
    if (!serviceId) {
      return NextResponse.json(
        { error: "Serviço de finanças pessoais não encontrado" },
        { status: 404 }
      );
    }

    const tipo = conta.recurring_rule?.transaction_type ?? "expense";
    const valor = valorComSinal(valorPago ?? Number(conta.amount), tipo);

    const { data: transacao, error: erroTransacao } = await supabase
      .from("financial_transactions")
      .insert({
        user_id: user.id,
        service_id: serviceId,
        category_id: conta.category_id,
        account_id: conta.account_id,
        group_id: conta.group_id,
        description: conta.description,
        amount: valor,
        transaction_date: paid_date,
        transaction_type: tipo,
        notes: conta.notes,
      })
      .select()
      .single();

    if (erroTransacao || !transacao) {
      console.error("Erro ao lançar a transação da baixa:", erroTransacao);
      return NextResponse.json(
        { error: "Não foi possível lançar a transação" },
        { status: 500 }
      );
    }

    const { data: baixada, error: erroBaixa } = await supabase
      .from("scheduled_transactions")
      .update({
        status: "paid",
        paid_date,
        transaction_id: transacao.id,
      })
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (erroBaixa || !baixada) {
      // Desfaz o lançamento para não deixar dinheiro solto sem conta
      // correspondente. O DELETE também reverte o saldo, pelo mesmo trigger.
      await supabase.from("financial_transactions").delete().eq("id", transacao.id);
      console.error("Baixa desfeita: não foi possível marcar a conta como paga", erroBaixa);
      return NextResponse.json(
        { error: "Não foi possível dar baixa na conta prevista" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "Baixa registrada",
      scheduled: baixada,
      transaction: transacao,
    });
  } catch (error) {
    console.error("Erro ao dar baixa:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { data: conta } = await supabase
      .from("scheduled_transactions")
      .select("status, transaction_id")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .single();

    if (!conta) {
      return NextResponse.json(
        { error: "Conta prevista não encontrada" },
        { status: 404 }
      );
    }

    if (conta.status !== "paid") {
      return NextResponse.json(
        { error: "Esta conta não está paga" },
        { status: 409 }
      );
    }

    // Ordem inversa da baixa: solta a conta primeiro. A constraint
    // scheduled_transactions_paid_check exige que paid_date e transaction_id
    // saiam junto com o status - e o FK e ON DELETE SET NULL, entao apagar a
    // transacao antes deixaria a linha em 'paid' com transaction_id NULL,
    // exatamente o estado que a constraint existe para impedir.
    const { error: erroSolta } = await supabase
      .from("scheduled_transactions")
      .update({ status: "pending", paid_date: null, transaction_id: null })
      .eq("id", params.id)
      .eq("user_id", user.id);

    if (erroSolta) {
      console.error("Erro ao estornar a baixa:", erroSolta);
      return NextResponse.json(
        { error: "Não foi possível estornar a baixa" },
        { status: 500 }
      );
    }

    if (conta.transaction_id) {
      const { error: erroDelete } = await supabase
        .from("financial_transactions")
        .delete()
        .eq("id", conta.transaction_id)
        .eq("user_id", user.id);

      if (erroDelete) {
        // A conta ja voltou para pendente; avisar e melhor do que fingir que
        // deu certo, porque o valor continua contando no saldo.
        console.error("Conta estornada, mas a transação não foi apagada:", erroDelete);
        return NextResponse.json(
          {
            error:
              "Conta voltou para pendente, mas a transação original não pôde ser removida. Exclua manualmente em Transações.",
            transaction_id: conta.transaction_id,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ message: "Baixa estornada" });
  } catch (error) {
    console.error("Erro ao estornar baixa:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
