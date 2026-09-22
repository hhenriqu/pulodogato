// PATCH  /api/recurring-rules/{id}   edita a regra
// DELETE /api/recurring-rules/{id}   desativa a regra (e limpa o que ainda nao venceu)
//
// Editar a regra NAO reescreve o passado. Por padrao a alteracao vale para as
// ocorrencias futuras ainda pendentes; o que ja foi pago fica como foi pago,
// senao o historico do mes passado mudaria sozinho quando o aluguel reajusta.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { materializarAgenda } from "@/lib/services/scheduled";
import { isIsoDate, today } from "@/lib/recurrence";

const CAMPOS_EDITAVEIS = [
  "description",
  "amount",
  "category_id",
  "account_id",
  "transaction_type",
  "frequency",
  "interval_count",
  "due_day",
  "end_date",
  "max_occurrences",
  "reminder_days",
  "auto_post",
  "is_active",
  "notes",
] as const;

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
    const { aplicar_em_pendentes = true, ...campos } = body;

    const patch: Record<string, unknown> = {};
    for (const campo of CAMPOS_EDITAVEIS) {
      if (campo in campos) patch[campo] = campos[campo];
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Nenhum campo editável foi enviado" },
        { status: 400 }
      );
    }

    if (patch.amount != null && Number(patch.amount) <= 0) {
      return NextResponse.json(
        { error: "Valor deve ser maior que zero" },
        { status: 400 }
      );
    }
    if (patch.amount != null) patch.amount = Math.abs(Number(patch.amount));

    if (patch.due_day != null && (Number(patch.due_day) < 1 || Number(patch.due_day) > 31)) {
      return NextResponse.json(
        { error: "Dia de vencimento deve estar entre 1 e 31" },
        { status: 400 }
      );
    }

    if (patch.end_date && !isIsoDate(patch.end_date as string)) {
      return NextResponse.json(
        { error: "Data final deve estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    const { data: rule, error } = await supabase
      .from("recurring_rules")
      .update(patch)
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error || !rule) {
      return NextResponse.json(
        { error: "Gasto fixo não encontrado" },
        { status: 404 }
      );
    }

    // Propaga para o que ainda vai vencer. `status` fica de fora do patch: uma
    // conta ja marcada como paga nao volta a pendente porque o valor mudou.
    let atualizadas = 0;
    if (aplicar_em_pendentes) {
      const propagaveis = ["description", "amount", "category_id", "account_id"] as const;
      const patchOcorrencias: Record<string, unknown> = {};
      for (const campo of propagaveis) {
        if (campo in patch) patchOcorrencias[campo] = patch[campo];
      }

      if (Object.keys(patchOcorrencias).length > 0) {
        const { data: tocadas } = await supabase
          .from("scheduled_transactions")
          .update(patchOcorrencias)
          .eq("recurring_rule_id", params.id)
          .eq("user_id", user.id)
          .eq("status", "pending")
          .gte("due_date", today())
          .select("id");
        atualizadas = tocadas?.length ?? 0;
      }
    }

    // Mudou frequencia, dia ou fim: a agenda antiga nao vale mais. Apaga o que
    // ainda esta pendente no futuro e gera de novo pela regra nova.
    const mudouCalendario = ["frequency", "interval_count", "due_day", "end_date", "max_occurrences"].some(
      (campo) => campo in patch
    );

    let recriadas = 0;
    if (mudouCalendario && rule.is_active) {
      await supabase
        .from("scheduled_transactions")
        .delete()
        .eq("recurring_rule_id", params.id)
        .eq("user_id", user.id)
        .eq("status", "pending")
        .gt("due_date", today());

      try {
        const agenda = await materializarAgenda(supabase, user.id);
        recriadas = agenda.criadas;
      } catch (erroAgenda) {
        console.error("Regra editada, mas a agenda não foi regerada:", erroAgenda);
      }
    }

    return NextResponse.json({
      message: "Gasto fixo atualizado",
      rule,
      scheduled_updated: atualizadas,
      scheduled_recreated: recriadas,
    });
  } catch (error) {
    console.error("Erro ao editar gasto fixo:", error);
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

    // Desativar, nao apagar: a regra tem ocorrencias pagas penduradas nela
    // (ON DELETE CASCADE), e apagar levaria junto o historico do que ja foi
    // pago. `?purge=true` continua disponivel para quem cadastrou errado e
    // nunca pagou nada.
    const purge = new URL(request.url).searchParams.get("purge") === "true";

    const { data: pagas } = await supabase
      .from("scheduled_transactions")
      .select("id")
      .eq("recurring_rule_id", params.id)
      .eq("user_id", user.id)
      .eq("status", "paid")
      .limit(1);

    if (purge && (pagas?.length ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            "Este gasto fixo já tem contas pagas. Desative em vez de excluir, para não apagar o histórico.",
        },
        { status: 409 }
      );
    }

    if (purge) {
      const { error } = await supabase
        .from("recurring_rules")
        .delete()
        .eq("id", params.id)
        .eq("user_id", user.id);

      if (error) {
        return NextResponse.json(
          { error: "Não foi possível excluir o gasto fixo" },
          { status: 500 }
        );
      }
      return NextResponse.json({ message: "Gasto fixo excluído" });
    }

    const { data: rule, error } = await supabase
      .from("recurring_rules")
      .update({ is_active: false })
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error || !rule) {
      return NextResponse.json(
        { error: "Gasto fixo não encontrado" },
        { status: 404 }
      );
    }

    // Tira da agenda o que ainda nao venceu; o passado permanece.
    const { data: canceladas } = await supabase
      .from("scheduled_transactions")
      .update({ status: "cancelled" })
      .eq("recurring_rule_id", params.id)
      .eq("user_id", user.id)
      .eq("status", "pending")
      .gte("due_date", today())
      .select("id");

    return NextResponse.json({
      message: "Gasto fixo desativado",
      rule,
      scheduled_cancelled: canceladas?.length ?? 0,
    });
  } catch (error) {
    console.error("Erro ao desativar gasto fixo:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
