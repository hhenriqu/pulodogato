// GET /api/projection?through=YYYY-MM-DD
//
// "Sobra ou falta no dia 30?" -- saldo de hoje mais tudo que esta previsto ate
// a data, por conta. Sem `through`, projeta ate o fim do mes corrente.
//
// E uma leitura pura: nao existe tabela de projecao e nao deve existir. Ela
// muda a cada lancamento, e uma tabela precisaria de trigger em
// financial_transactions E em scheduled_transactions para nao mentir.
//
// O que entra: contas previstas com status 'pending' e vencimento ate a data,
// incluindo as ja VENCIDAS -- uma conta que venceu ontem e nao foi paga
// continua sendo dinheiro que vai sair. Ficam de fora 'paid' (ja virou
// transacao real e ja esta no saldo), 'skipped' e 'cancelled'.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { isIsoDate, today, lastDayOfMonth } from "@/lib/recurrence";
import type { AccountProjection } from "@/types/financial";

function fimDoMes(iso: string): string {
  const [ano, mes] = iso.split("-").map(Number);
  const ultimo = lastDayOfMonth(ano, mes);
  return `${iso.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`;
}

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
    const param = url.searchParams.get("through");
    const hoje = today();
    const ate = param ?? fimDoMes(hoje);

    if (!isIsoDate(ate)) {
      return NextResponse.json(
        { error: "Data deve estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    const { data: contas, error: erroContas } = await supabase
      .from("financial_accounts")
      .select("id, name, account_type, current_balance")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (erroContas) {
      console.error("Erro ao carregar contas:", erroContas);
      return NextResponse.json(
        { error: "Não foi possível carregar as contas" },
        { status: 500 }
      );
    }

    // A direcao (sai ou entra) vem do tipo da REGRA, nao da ocorrencia:
    // scheduled_transactions.amount e sempre positivo por CHECK, e quem diz se
    // aquilo e despesa ou receita e recurring_rules.transaction_type. Conta
    // avulsa nao tem regra, e por convencao da Fase 1 e despesa.
    const { data: previstas, error: erroPrevistas } = await supabase
      .from("scheduled_transactions")
      .select(
        "id, account_id, amount, due_date, status, recurring_rule:recurring_rules(transaction_type)"
      )
      .eq("user_id", user.id)
      .eq("status", "pending")
      .lte("due_date", ate);

    if (erroPrevistas) {
      console.error("Erro ao carregar contas previstas:", erroPrevistas);
      return NextResponse.json(
        { error: "Não foi possível carregar as contas previstas" },
        { status: 500 }
      );
    }

    const porConta = new Map<string, AccountProjection>();

    for (const conta of contas ?? []) {
      porConta.set(conta.id, {
        account_id: conta.id,
        account_name: conta.name,
        account_type: conta.account_type,
        current_balance: Number(conta.current_balance ?? 0),
        scheduled_out: 0,
        scheduled_in: 0,
        projected_balance: Number(conta.current_balance ?? 0),
        goes_negative: false,
      });
    }

    // Previstas sem conta vinculada entram no total geral, mas nao tem onde
    // somar por conta -- o usuario nao disse de onde o dinheiro sai.
    let semContaOut = 0;
    let semContaIn = 0;
    let vencidoTotal = 0;

    for (const p of previstas ?? []) {
      const regra = Array.isArray(p.recurring_rule)
        ? p.recurring_rule[0]
        : p.recurring_rule;
      const ehReceita = regra?.transaction_type === "income";
      const valor = Math.abs(Number(p.amount));

      if (p.due_date < hoje) vencidoTotal += ehReceita ? 0 : valor;

      const projecao = p.account_id ? porConta.get(p.account_id) : undefined;

      if (!projecao) {
        if (ehReceita) semContaIn += valor;
        else semContaOut += valor;
        continue;
      }

      if (ehReceita) projecao.scheduled_in += valor;
      else projecao.scheduled_out += valor;
    }

    const projecoes = Array.from(porConta.values()).map((p) => {
      const projetado = p.current_balance - p.scheduled_out + p.scheduled_in;
      return {
        ...p,
        projected_balance: projetado,
        // So interessa avisar quando a projecao MUDA a resposta: uma conta que
        // ja esta negativa hoje nao e uma descoberta.
        goes_negative: projetado < 0 && p.current_balance >= 0,
      };
    });

    projecoes.sort((a, b) => a.projected_balance - b.projected_balance);

    const saldoAtual = projecoes.reduce((s, p) => s + p.current_balance, 0);
    const saiTotal =
      projecoes.reduce((s, p) => s + p.scheduled_out, 0) + semContaOut;
    const entraTotal =
      projecoes.reduce((s, p) => s + p.scheduled_in, 0) + semContaIn;

    return NextResponse.json({
      through: ate,
      current_total: saldoAtual,
      projected_total: saldoAtual - saiTotal + entraTotal,
      scheduled_out: saiTotal,
      scheduled_in: entraTotal,
      overdue_total: vencidoTotal,
      accounts: projecoes,
    });
  } catch (error) {
    console.error("Erro na API de projeção:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
