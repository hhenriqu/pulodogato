import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const installmentId = params.id;

  try {
    // Verificar autenticação
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const { paid_date = new Date().toISOString().split("T")[0] } = body;

    // Validar formato da data
    if (!paid_date || !/^\d{4}-\d{2}-\d{2}$/.test(paid_date)) {
      return NextResponse.json(
        { error: "Data de pagamento inválida" },
        { status: 400 }
      );
    }

    // Verificar se a parcela existe e pertence ao usuário
    const { data: installment } = await supabase
      .from("transaction_installments")
      .select("*")
      .eq("id", installmentId)
      .eq("user_id", user.id)
      .single();

    if (!installment) {
      return NextResponse.json(
        { error: "Parcela não encontrada" },
        { status: 404 }
      );
    }

    // Verificar se já não foi paga
    if (installment.paid_date) {
      return NextResponse.json(
        { error: "Parcela já foi paga" },
        { status: 400 }
      );
    }

    // Usar função do banco para marcar como paga
    const { data: success, error: payError } = await supabase.rpc(
      "pay_installment",
      {
        p_installment_id: installmentId,
        p_paid_date: paid_date,
      }
    );

    if (payError || !success) {
      console.error("Error paying installment:", payError);
      return NextResponse.json(
        { error: "Erro ao marcar parcela como paga" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Parcela marcada como paga com sucesso!",
    });
  } catch (error) {
    console.error("Pay installment error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const installmentId = params.id;

  try {
    // Verificar autenticação
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    // Verificar se a parcela existe e pertence ao usuário
    const { data: installment } = await supabase
      .from("transaction_installments")
      .select("*, parent_transaction_id")
      .eq("id", installmentId)
      .eq("user_id", user.id)
      .single();

    if (!installment) {
      return NextResponse.json(
        { error: "Parcela não encontrada" },
        { status: 404 }
      );
    }

    // Se foi paga, primeiro remover a transação correspondente
    if (installment.paid_date) {
      await supabase
        .from("financial_transactions")
        .delete()
        .eq("installment_parent_id", installmentId);
    }

    // Marcar parcela como inativa (soft delete)
    const { error: deleteError } = await supabase
      .from("transaction_installments")
      .update({ is_active: false })
      .eq("id", installmentId);

    if (deleteError) {
      console.error("Error deleting installment:", deleteError);
      return NextResponse.json(
        { error: "Erro ao cancelar parcela" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Parcela cancelada com sucesso!",
    });
  } catch (error) {
    console.error("Delete installment error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
