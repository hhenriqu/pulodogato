// GET  /api/payroll   lista os contracheques com bruto, descontos e liquido
// POST /api/payroll   grava contracheque + descontos + o lancamento do liquido
//
// A RLS da migration 012 e quem filtra: a view `payroll_entry_totals` e
// security_invoker, entao ela ja devolve so o que e do usuario. Nao repetimos
// o filtro aqui para nao ter duas versoes da mesma regra de acesso.
//
// O POST chama `register_payroll()` em vez de fazer tres inserts. As tres
// escritas (contracheque, descontos, lancamento) so fazem sentido juntas:
// feitas em sequencia pela rota, uma falha no meio deixa um contracheque sem
// descontos -- que tem liquido = bruto e infla a renda do mes sem nada falhar.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const KINDS = [
  "INSS",
  "IRRF",
  "PENSION",
  "HEALTH",
  "UNION",
  "ADVANCE",
  "OTHER",
] as const;

export async function GET(_request: NextRequest) {
  const supabase = createClient();

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { data: entries, error } = await supabase
      .from("payroll_entry_totals")
      .select("*")
      .order("reference_month", { ascending: false });

    if (error) {
      console.error("Erro ao buscar contracheques:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar os contracheques" },
        { status: 500 }
      );
    }

    // Os descontos vem numa segunda consulta em vez de embed: o embed da
    // PostgREST parte da TABELA, e aqui a lista sai da VIEW (que e quem calcula
    // o liquido). Pedir o embed a partir da view devolveria erro de relacao.
    const ids = (entries ?? []).map((e) => e.id);
    let deductions: Array<Record<string, unknown>> = [];

    if (ids.length) {
      const { data, error: dedError } = await supabase
        .from("payroll_deductions")
        .select("*")
        .in("payroll_entry_id", ids);

      if (dedError) {
        console.error("Erro ao buscar descontos:", dedError);
      } else {
        deductions = data ?? [];
      }
    }

    return NextResponse.json({
      entries: (entries ?? []).map((entry) => ({
        ...entry,
        deductions: deductions.filter((d) => d.payroll_entry_id === entry.id),
      })),
    });
  } catch (error) {
    console.error("Get payroll error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const supabase = createClient();

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const {
      reference_month,
      employer,
      gross_amount,
      account_id,
      category_id,
      deductions = [],
      notes,
    } = body;

    if (!reference_month || !/^\d{4}-\d{2}/.test(String(reference_month))) {
      return NextResponse.json(
        { error: "Informe o mês de referência" },
        { status: 400 }
      );
    }

    const bruto = Number(gross_amount);
    if (!Number.isFinite(bruto) || bruto <= 0) {
      return NextResponse.json(
        { error: "O salário bruto deve ser maior que zero" },
        { status: 400 }
      );
    }

    if (!Array.isArray(deductions)) {
      return NextResponse.json(
        { error: "Descontos inválidos" },
        { status: 400 }
      );
    }

    // Validar aqui devolve uma mensagem; deixar passar devolve um 500 com
    // codigo 23514 vindo do CHECK, que nao diz qual linha estava errada.
    const limpos = [];
    let total = 0;
    for (const bruta of deductions) {
      const valor = Number(bruta?.amount);
      if (!Number.isFinite(valor) || valor <= 0) {
        return NextResponse.json(
          { error: "Cada desconto precisa de um valor maior que zero" },
          { status: 400 }
        );
      }
      if (!KINDS.includes(bruta?.kind)) {
        return NextResponse.json(
          { error: `Tipo de desconto inválido: ${bruta?.kind}` },
          { status: 400 }
        );
      }
      total += valor;
      limpos.push({
        kind: bruta.kind,
        description: bruta.description ?? null,
        amount: valor,
      });
    }

    if (total >= bruto) {
      return NextResponse.json(
        {
          error:
            "Os descontos somam o valor do salário bruto ou mais. Confira os valores.",
        },
        { status: 400 }
      );
    }

    // O lancamento do liquido so acontece com conta E categoria. Sem os dois, o
    // contracheque e gravado como memoria (bruto e descontos) e a tela mostra
    // "sem lançamento" -- em vez de inventar uma conta e mexer num saldo que o
    // usuario nao escolheu.
    let serviceId: string | null = null;
    if (account_id && category_id) {
      const { data: service } = await supabase
        .from("financial_services")
        .select("id")
        .eq("name", "personal_finance")
        .single();
      serviceId = service?.id ?? null;
    }

    const { data: entryId, error } = await supabase.rpc("register_payroll", {
      p_reference_month: `${String(reference_month).slice(0, 7)}-01`,
      p_employer: employer || "Principal",
      p_gross_amount: bruto,
      p_account_id: account_id || null,
      p_category_id: serviceId ? category_id : null,
      p_service_id: serviceId,
      p_deductions: limpos,
      p_notes: notes || null,
    });

    if (error) {
      console.error("Erro ao registrar contracheque:", error);

      // 23505 = o UNIQUE (user, mes, empregador). Ele existe para impedir a
      // renda do mes de dobrar, e merece uma mensagem que diga isso.
      if (error.code === "23505") {
        return NextResponse.json(
          {
            error:
              "Já existe um contracheque desse empregador neste mês. Edite o que existe em vez de lançar de novo.",
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: error.message ?? "Não foi possível registrar o contracheque" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, id: entryId });
  } catch (error) {
    console.error("Create payroll error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
