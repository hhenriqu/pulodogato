// GET /api/reports/export?report=cash-flow|categories|planned|net-worth|transactions&months=12&groupId=
//
// Devolve o relatorio em CSV, pronto para abrir no Excel em pt-BR (separador
// `;`, decimal com virgula, BOM na frente -- ver lib/services/reports.ts).
//
// E O PDF?
// --------
// Nao ha geracao de PDF no servidor, e isso foi decidido, nao esquecido. As
// bibliotecas de PDF em JS (jsPDF, pdfkit, puppeteer) custam entre 300 KB e um
// Chromium inteiro na funcao serverless -- para produzir um arquivo pior do
// que o que o proprio browser ja imprime, porque teriam que redesenhar do zero
// os graficos que o recharts ja desenhou na tela.
//
// A tela de relatorios tem estilo de impressao (`print:` no Tailwind) e um
// botao "Salvar em PDF" que chama window.print(). O usuario escolhe "Salvar
// como PDF" no dialogo do sistema e leva o relatorio COM os graficos. O CSV
// cobre o outro uso, que e levar os numeros para a planilha.
//
// Se algum dia for preciso PDF sem interacao humana (envio por e-mail, por
// exemplo), o lugar e um job separado, nao esta rota.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  janelaDeMeses,
  montarCsv,
  cabecalhosCsv,
  rotuloMes,
} from "@/lib/services/reports";
import { somarMeses } from "@/lib/services/budget";

const RELATORIOS = [
  "cash-flow",
  "categories",
  "planned",
  "net-worth",
  "transactions",
] as const;

type Relatorio = (typeof RELATORIOS)[number];

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
    const report = (url.searchParams.get("report") ?? "cash-flow") as Relatorio;

    if (!RELATORIOS.includes(report)) {
      return NextResponse.json(
        { error: `Relatório inválido. Use um de: ${RELATORIOS.join(", ")}` },
        { status: 400 }
      );
    }

    const janela = janelaDeMeses(url.searchParams.get("months"));

    if (!janela) {
      return NextResponse.json(
        { error: "months deve ser um inteiro entre 1 e 60" },
        { status: 400 }
      );
    }

    const groupId = url.searchParams.get("groupId");

    let csv: string;
    let nome: string;

    if (report === "cash-flow") {
      const q = supabase
        .from("monthly_cash_flow")
        .select("month, income, expense, net, transaction_count")
        .eq("user_id", user.id)
        .gte("month", janela.inicio)
        .lte("month", janela.fim);

      const { data } = await (groupId
        ? q.eq("group_id", groupId)
        : q.is("group_id", null)
      ).order("month", { ascending: true });

      csv = montarCsv(
        ["Mês", "Entradas", "Saídas", "Resultado", "Lançamentos"],
        (data ?? []).map((d) => [
          rotuloMes(String(d.month)),
          Number(d.income),
          Number(d.expense),
          Number(d.net),
          Number(d.transaction_count),
        ])
      );
      nome = `fluxo-de-caixa-${janela.inicio.slice(0, 7)}-a-${janela.fim.slice(0, 7)}.csv`;
    } else if (report === "categories") {
      const base = supabase
        .from("category_monthly_totals")
        .select("month, category_id, expense, income, transaction_count")
        .gte("month", janela.inicio)
        .lte("month", janela.fim);

      const { data } = groupId
        ? await base.eq("group_id", groupId)
        : await base.eq("user_id", user.id).is("group_id", null);

      const linhas = data ?? [];
      const ids = Array.from(new Set(linhas.map((l) => l.category_id)));
      const { data: categorias } = ids.length
        ? await supabase
            .from("transaction_categories")
            .select("id, name")
            .in("id", ids)
        : { data: [] };
      const porId = new Map((categorias ?? []).map((c) => [c.id, c.name]));

      csv = montarCsv(
        ["Mês", "Categoria", "Saídas", "Entradas", "Lançamentos"],
        linhas
          .sort((a, b) => String(a.month).localeCompare(String(b.month)))
          .map((l) => [
            rotuloMes(String(l.month)),
            porId.get(l.category_id) ?? "Sem categoria",
            Number(l.expense),
            Number(l.income),
            Number(l.transaction_count),
          ])
      );
      nome = `gastos-por-categoria-${janela.inicio.slice(0, 7)}-a-${janela.fim.slice(0, 7)}.csv`;
    } else if (report === "planned") {
      const q = supabase
        .from("planned_vs_actual")
        .select("*")
        .eq("user_id", user.id)
        .gte("month", janela.inicio)
        .lte("month", janela.fim);

      const { data } = await (groupId
        ? q.eq("group_id", groupId)
        : q.is("group_id", null)
      ).order("month", { ascending: true });

      csv = montarCsv(
        [
          "Mês",
          "Despesa prevista",
          "Despesa realizada",
          "Diferença",
          "Receita prevista",
          "Receita realizada",
          "Contas em aberto",
          "Contas vencidas",
        ],
        (data ?? []).map((d) => [
          rotuloMes(String(d.month)),
          Number(d.planned_expense),
          Number(d.actual_expense),
          Number(d.expense_variance),
          Number(d.planned_income),
          Number(d.actual_income),
          Number(d.pending_count),
          Number(d.overdue_count),
        ])
      );
      nome = `previsto-x-realizado-${janela.inicio.slice(0, 7)}-a-${janela.fim.slice(0, 7)}.csv`;
    } else if (report === "net-worth") {
      const { data } = await supabase
        .from("net_worth_history")
        .select("month, net_change, net_worth")
        .eq("user_id", user.id)
        .gte("month", janela.inicio)
        .lte("month", janela.fim)
        .order("month", { ascending: true });

      csv = montarCsv(
        ["Mês", "Variação no mês", "Patrimônio no fim do mês"],
        (data ?? []).map((d) => [
          rotuloMes(String(d.month)),
          Number(d.net_change),
          Number(d.net_worth),
        ])
      );
      nome = `patrimonio-${janela.inicio.slice(0, 7)}-a-${janela.fim.slice(0, 7)}.csv`;
    } else {
      // O extrato: uma linha por lancamento. E o que o contador pede e o que o
      // usuario quer quando desconfia de um numero agregado.
      const base = supabase
        .from("financial_transactions")
        .select(
          "transaction_date, description, amount, transaction_type, category_id, account_id, notes"
        )
        .gte("transaction_date", janela.inicio)
        // `janela.fim` e o dia 1 do mes CORRENTE, nao o ultimo dia dele. Um
        // `lt(fim)` aqui cortaria o mes inteiro que o usuario esta olhando: o
        // extrato sairia terminando no mes passado, e quem exportasse dia 20
        // nao acharia nenhum lancamento dos ultimos vinte dias.
        .lt("transaction_date", somarMeses(janela.fim, 1));

      const { data } = groupId
        ? await base.eq("group_id", groupId).order("transaction_date")
        : await base
            .eq("user_id", user.id)
            .is("group_id", null)
            .order("transaction_date");

      const linhas = data ?? [];
      const catIds = Array.from(
        new Set(linhas.map((l) => l.category_id).filter(Boolean))
      );
      const contaIds = Array.from(
        new Set(linhas.map((l) => l.account_id).filter(Boolean))
      );

      const [{ data: categorias }, { data: contas }] = await Promise.all([
        catIds.length
          ? supabase
              .from("transaction_categories")
              .select("id, name")
              .in("id", catIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        contaIds.length
          ? supabase
              .from("financial_accounts")
              .select("id, name")
              .in("id", contaIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);

      const nomeCat = new Map((categorias ?? []).map((c) => [c.id, c.name]));
      const nomeConta = new Map((contas ?? []).map((c) => [c.id, c.name]));
      const tipo: Record<string, string> = {
        income: "Receita",
        expense: "Despesa",
        transfer: "Transferência",
      };

      csv = montarCsv(
        ["Data", "Descrição", "Categoria", "Conta", "Tipo", "Valor"],
        linhas.map((l) => [
          String(l.transaction_date).slice(0, 10).split("-").reverse().join("/"),
          l.description,
          nomeCat.get(l.category_id) ?? "",
          l.account_id ? nomeConta.get(l.account_id) ?? "" : "",
          tipo[l.transaction_type as string] ?? l.transaction_type,
          // O valor sai com o SINAL do banco, de proposito: despesa negativa.
          // Numa planilha e isso que faz a coluna somar sozinha para o saldo
          // do periodo. As telas e os outros relatorios e que precisam de ABS.
          Number(l.amount),
        ])
      );
      nome = `extrato-${janela.inicio.slice(0, 7)}-a-${janela.fim.slice(0, 7)}.csv`;
    }

    return new NextResponse(csv, { headers: cabecalhosCsv(nome) });
  } catch (error) {
    console.error("Erro ao exportar relatório:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
