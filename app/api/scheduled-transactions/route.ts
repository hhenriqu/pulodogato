// GET  /api/scheduled-transactions   agenda de contas previstas
// POST /api/scheduled-transactions   lanca uma conta avulsa (sem regra fixa)
//
// A leitura sai da view scheduled_transactions_effective, e nao da tabela: e
// ela que responde "esta vencida?" sem que ninguem precise gravar um status
// que envelhece sozinho a meia-noite. A view e security_invoker, entao a RLS
// da tabela base continua valendo.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { materializarAgenda, horizonteAte } from "@/lib/services/scheduled";
import { isIsoDate, today } from "@/lib/recurrence";

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

    const url = new URL(request.url);
    const de = url.searchParams.get("from") ?? today();
    const ate = url.searchParams.get("to") ?? horizonteAte();
    const status = url.searchParams.get("status");
    const groupId = url.searchParams.get("group_id");
    // A geracao e o padrao: sem ela, o usuario abre a tela no dia 1 e nao ve o
    // mes novo. `?generate=false` existe para quem so quer ler (relatorio).
    const gerar = url.searchParams.get("generate") !== "false";

    if (!isIsoDate(de) || !isIsoDate(ate)) {
      return NextResponse.json(
        { error: "Datas devem estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    let geradas = 0;
    if (gerar) {
      try {
        const agenda = await materializarAgenda(supabase, user.id, { de: today(), ate });
        geradas = agenda.criadas;
      } catch (erroAgenda) {
        // Ler a agenda existente ainda tem valor; falhar aqui apagaria a tela
        // inteira por causa das linhas que faltam.
        console.error("Não foi possível materializar a agenda:", erroAgenda);
      }
    }

    let query = supabase
      .from("scheduled_transactions_effective")
      .select(
        `
        *,
        category:transaction_categories(*),
        account:financial_accounts(id, name, account_type, color_hex),
        group:expense_groups(id, name, group_code)
      `
      )
      .gte("due_date", de)
      .lte("due_date", ate)
      .order("due_date", { ascending: true });

    if (groupId) query = query.eq("group_id", groupId);

    if (status === "open") {
      // "em aberto" e o filtro que a tela usa: pendente ou vencida.
      query = query.eq("status", "pending");
    } else if (status && status !== "all") {
      query = query.eq("status", status);
    } else if (!status) {
      // Cancelada e pulada so aparecem se pedirem explicitamente.
      query = query.in("status", ["pending", "paid"]);
    }

    const { data: scheduled, error } = await query;

    if (error) {
      console.error("Erro ao listar contas previstas:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar as contas previstas" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      scheduled: scheduled ?? [],
      generated: geradas,
      range: { from: de, to: ate },
    });
  } catch (error) {
    console.error("Erro na API de contas previstas:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
    const {
      description,
      amount,
      category_id,
      account_id,
      group_id,
      due_date,
      notes,
      transaction_type,
    } = body;

    if (!description?.trim()) {
      return NextResponse.json(
        { error: "Descrição é obrigatória" },
        { status: 400 }
      );
    }

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json(
        { error: "Valor deve ser maior que zero" },
        { status: 400 }
      );
    }

    if (!category_id) {
      return NextResponse.json(
        { error: "Categoria é obrigatória" },
        { status: 400 }
      );
    }

    if (!isIsoDate(due_date)) {
      return NextResponse.json(
        { error: "Vencimento deve estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    // A DIRECAO DA PREVISAO (HMO-188, migration 027)
    //
    // `scheduled_transactions.amount` tem `CHECK (amount > 0)`: a ocorrencia nao
    // guarda sinal. Quem diz se aquilo entra ou sai era so
    // `recurring_rules.transaction_type` -- e uma previsao AVULSA, que e o que
    // esta rota cria, nao tem regra. A baixa caia no `?? "expense"`, e confirmar
    // o recebimento de uma receita prevista gravaria o valor NEGATIVO.
    //
    // O DEFAULT e 'expense' e nao um erro 400: toda chamada anterior a HMO-188
    // (a tela /dashboard/bills) cadastra conta a pagar e nao manda este campo.
    // Exigir o campo quebraria aquela tela, e adivinhar pelo `is_expense` da
    // categoria seria uma segunda fonte de verdade para a direcao.
    //
    // 'transfer' e recusado aqui e no CHECK do banco. Uma previsao de
    // transferencia nao muda patrimonio nenhum, e o terceiro caso faria toda
    // soma de agenda ter de trata-lo -- o tratamento esquecido contaria a perna
    // de saida como despesa prevista.
    const direcao = transaction_type ?? "expense";
    if (direcao !== "income" && direcao !== "expense") {
      return NextResponse.json(
        { error: "A conta prevista tem que ser income ou expense" },
        { status: 400 }
      );
    }

    if (group_id) {
      const { data: membro } = await supabase
        .from("group_members")
        .select("id")
        .eq("group_id", group_id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .single();

      if (!membro) {
        return NextResponse.json(
          { error: "Você não participa deste grupo" },
          { status: 403 }
        );
      }
    }

    const { data: scheduled, error } = await supabase
      .from("scheduled_transactions")
      .insert({
        user_id: user.id,
        category_id,
        account_id: account_id || null,
        group_id: group_id || null,
        description: description.trim(),
        amount: Math.abs(Number(amount)),
        due_date,
        notes: notes || null,
        transaction_type: direcao,
      })
      .select(
        `
        *,
        category:transaction_categories(*),
        account:financial_accounts(id, name, account_type, color_hex),
        group:expense_groups(id, name, group_code)
      `
      )
      .single();

    if (error) {
      console.error("Erro ao criar conta prevista:", error);
      return NextResponse.json(
        { error: "Não foi possível criar a conta prevista" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: "Conta prevista criada", scheduled },
      { status: 201 }
    );
  } catch (error) {
    console.error("Erro na API de contas previstas:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
