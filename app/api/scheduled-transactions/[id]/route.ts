// PATCH  /api/scheduled-transactions/{id}   edita, pula ou cancela uma ocorrencia
// DELETE /api/scheduled-transactions/{id}   remove uma conta avulsa
//
// Uma ocorrencia tem vida propria: a conta de luz deste mes pode ter outro
// valor sem que o gasto fixo mude, e o mes que nao vai ter aula pode ser
// pulado sem cancelar a mensalidade inteira.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { isIsoDate } from "@/lib/recurrence";

const STATUS_MANUAIS = ["pending", "skipped", "cancelled"];

export async function PATCH(
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

    const body = await request.json();
    const { description, amount, due_date, category_id, account_id, notes, status } = body;

    const patch: Record<string, unknown> = {};

    if (description !== undefined) {
      if (!description?.trim()) {
        return NextResponse.json({ error: "Descrição é obrigatória" }, { status: 400 });
      }
      patch.description = description.trim();
    }

    if (amount !== undefined) {
      if (!amount || Number(amount) <= 0) {
        return NextResponse.json({ error: "Valor deve ser maior que zero" }, { status: 400 });
      }
      patch.amount = Math.abs(Number(amount));
    }

    if (due_date !== undefined) {
      if (!isIsoDate(due_date)) {
        return NextResponse.json(
          { error: "Vencimento deve estar no formato AAAA-MM-DD" },
          { status: 400 }
        );
      }
      patch.due_date = due_date;
    }

    if (category_id !== undefined) patch.category_id = category_id;
    if (account_id !== undefined) patch.account_id = account_id || null;
    if (notes !== undefined) patch.notes = notes || null;

    if (status !== undefined) {
      // 'paid' so pela rota /pay, que cria a transacao real. Marcar aqui
      // esbarraria na constraint scheduled_transactions_paid_check e voltaria
      // um 500 sem explicacao. 'overdue' nunca e gravado: e calculado.
      if (!STATUS_MANUAIS.includes(status)) {
        return NextResponse.json(
          {
            error:
              "Status inválido. Para dar baixa use POST /api/scheduled-transactions/{id}/pay.",
          },
          { status: 400 }
        );
      }
      patch.status = status;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
    }

    // A conta ja paga esta amarrada a uma transacao real; mexer nela aqui
    // deixaria os dois lados divergentes. O caminho e estornar primeiro.
    const { data: atual } = await supabase
      .from("scheduled_transactions")
      .select("status")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .single();

    if (!atual) {
      return NextResponse.json({ error: "Conta prevista não encontrada" }, { status: 404 });
    }

    if (atual.status === "paid") {
      return NextResponse.json(
        {
          error:
            "Esta conta já foi paga. Estorne pelo DELETE em /pay antes de editar.",
        },
        { status: 409 }
      );
    }

    const { data: scheduled, error } = await supabase
      .from("scheduled_transactions")
      .update(patch)
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select(
        `
        *,
        category:transaction_categories(*),
        account:financial_accounts(id, name, account_type, color_hex),
        group:expense_groups(id, name, group_code)
      `
      )
      .single();

    if (error || !scheduled) {
      console.error("Erro ao editar conta prevista:", error);
      return NextResponse.json(
        { error: "Não foi possível atualizar a conta prevista" },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: "Conta prevista atualizada", scheduled });
  } catch (error) {
    console.error("Erro ao editar conta prevista:", error);
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

    const { data: atual } = await supabase
      .from("scheduled_transactions")
      .select("status, recurring_rule_id")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .single();

    if (!atual) {
      return NextResponse.json({ error: "Conta prevista não encontrada" }, { status: 404 });
    }

    if (atual.status === "paid") {
      return NextResponse.json(
        { error: "Conta já paga: estorne antes de excluir" },
        { status: 409 }
      );
    }

    // Ocorrencia de gasto fixo e derivada da regra: apagar so faria a proxima
    // geracao trazer de volta. Vira 'skipped', que ocupa o lugar dela no
    // indice unico e nao ressuscita.
    if (atual.recurring_rule_id) {
      const { data: pulada, error } = await supabase
        .from("scheduled_transactions")
        .update({ status: "skipped" })
        .eq("id", params.id)
        .eq("user_id", user.id)
        .select()
        .single();

      if (error || !pulada) {
        return NextResponse.json(
          { error: "Não foi possível pular esta conta" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        message: "Ocorrência pulada (o gasto fixo continua ativo)",
        scheduled: pulada,
      });
    }

    const { error } = await supabase
      .from("scheduled_transactions")
      .delete()
      .eq("id", params.id)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json(
        { error: "Não foi possível excluir a conta prevista" },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: "Conta prevista excluída" });
  } catch (error) {
    console.error("Erro ao excluir conta prevista:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
