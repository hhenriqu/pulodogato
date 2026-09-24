// GET /api/safe-to-spend
//
// "Quanto ainda posso gastar este mes, e quanto por dia?" A aritmetica inteira
// -- e cada armadilha dela -- mora em lib/safe-to-spend.ts, com teste unitario
// proprio. Aqui so ha busca de linha e traducao de formato.
//
// E leitura pura: nao existe tabela de "posso gastar" e nao deve existir. O
// numero muda a cada compra no cartao e a cada conta paga, e uma tabela
// precisaria de trigger em financial_transactions, em scheduled_transactions e
// no saldo das contas para nao mentir.
//
// Por que materializa a agenda antes de somar: as ocorrencias futuras das
// regras recorrentes sao criadas sob demanda (lib/services/scheduled.ts). Sem
// este passo o aluguel do dia 25 pode simplesmente nao existir como linha, e o
// app diria que ha mais dinheiro livre do que ha -- o pior sentido para errar.
// E best-effort de proposito: se a materializacao falhar, e melhor devolver o
// numero com as linhas que existem do que devolver 500.

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import { materializarAgenda } from "@/lib/services/scheduled";
import {
  calcularQuantoPossoGastar,
  fimDoMes,
  type PrevistaParaGastar,
} from "@/lib/safe-to-spend";

interface LinhaPrevista {
  id: string;
  amount: number | string;
  due_date: string;
  notes: string | null;
  recurring_rule:
    | { transaction_type: string }
    | { transaction_type: string }[]
    | null;
}

export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const hoje = today();
    const ate = fimDoMes(hoje);

    try {
      await materializarAgenda(supabase, user.id, { de: hoje, ate });
    } catch (erroAgenda) {
      console.error("Posso gastar seguiu sem materializar a agenda:", erroAgenda);
    }

    // `is_active` vem junto: a conta arquivada e excluida do disponivel dentro
    // do calculo, e o cartao arquivado continua descontando. Filtrar aqui por
    // is_active tiraria a divida do cartao cancelado da conta.
    const { data: contas, error: erroContas } = await supabase
      .from("financial_accounts")
      .select("id, name, account_type, current_balance, is_active")
      .eq("user_id", user.id);

    if (erroContas) {
      console.error("Erro ao carregar contas:", erroContas);
      return NextResponse.json(
        { error: "Não foi possível carregar as contas" },
        { status: 500 }
      );
    }

    // Sem piso de data: uma conta que venceu no mes passado e nao foi paga
    // continua sendo dinheiro que vai sair. O filtro de teto e feito no
    // calculo, que ja conhece o fim do mes.
    const { data: previstas, error: erroPrevistas } = await supabase
      .from("scheduled_transactions")
      .select(
        "id, amount, due_date, notes, recurring_rule:recurring_rules(transaction_type)"
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

    // A direcao (sai ou entra) vem do tipo da REGRA, nao da ocorrencia --
    // `scheduled_transactions.amount` e sempre positivo por CHECK. Mesma
    // leitura da /api/projection; conta avulsa nao tem regra e e despesa.
    const paraCalculo: PrevistaParaGastar[] = ((previstas ??
      []) as LinhaPrevista[]).map((p) => {
      const regra = Array.isArray(p.recurring_rule)
        ? p.recurring_rule[0]
        : p.recurring_rule;

      return {
        id: p.id,
        amount: p.amount,
        due_date: p.due_date,
        notes: p.notes,
        tipo: regra?.transaction_type === "income" ? "income" : "expense",
      };
    });

    return NextResponse.json({
      today: hoje,
      safe_to_spend: calcularQuantoPossoGastar({
        contas: contas ?? [],
        previstas: paraCalculo,
        hoje,
      }),
    });
  } catch (error) {
    console.error("Erro na API de quanto posso gastar:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
