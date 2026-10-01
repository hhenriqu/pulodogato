// GET /api/card-invoices?account_id=&month=YYYY-MM
//
// As faturas dos cartoes, agrupadas por cartao e mes. Sem `month`, devolve a
// fatura corrente de cada cartao.
//
// Em que fatura cada compra cai e decidido pela view card_invoice_lines, que
// chama public.card_invoice_month(). Essa regra existe em UM lugar so: se o
// app recalculasse aqui em TypeScript, a tela e o relatorio poderiam discordar
// sobre o mesmo cartao -- que e o tipo de divergencia que ninguem percebe ate
// fechar o mes errado.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { primeiroDiaDoMes, mesCorrente } from "@/lib/services/budget";
import { ehFatura } from "@/lib/card-invoice";
import type {
  CardInvoice,
  CardInvoiceLine,
  ScheduledTransaction,
} from "@/types/financial";

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
    const accountId = url.searchParams.get("account_id");
    const mesParam = url.searchParams.get("month");
    const mes = mesParam ? primeiroDiaDoMes(mesParam) : mesCorrente();

    if (!mes) {
      return NextResponse.json(
        { error: "Mês deve estar no formato AAAA-MM" },
        { status: 400 }
      );
    }

    let query = supabase
      .from("card_invoice_lines")
      .select("*")
      .eq("invoice_month", mes)
      .order("transaction_date", { ascending: true });

    if (accountId) query = query.eq("account_id", accountId);

    const { data: linhas, error } = await query;

    if (error) {
      console.error("Erro ao carregar faturas:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar as faturas" },
        { status: 500 }
      );
    }

    // Agrupa por cartao. O total soma `invoice_amount`, que ja vem com o sinal
    // invertido pela view: a compra soma e o estorno abate.
    const porCartao = new Map<string, CardInvoice>();

    for (const linha of (linhas ?? []) as CardInvoiceLine[]) {
      let fatura = porCartao.get(linha.account_id);

      if (!fatura) {
        fatura = {
          account_id: linha.account_id,
          account_name: linha.account_name,
          closing_day: linha.closing_day,
          due_day: linha.due_day,
          invoice_month: linha.invoice_month,
          due_date: linha.invoice_due_date,
          total: 0,
          line_count: 0,
          lines: [],
        };
        porCartao.set(linha.account_id, fatura);
      }

      fatura.total += Number(linha.invoice_amount);
      fatura.line_count += 1;
      fatura.lines.push(linha);
    }

    const faturas = Array.from(porCartao.values());

    // Um cartao sem nenhum lancamento no mes nao aparece na view -- e ele
    // precisa aparecer na tela, com fatura zerada, senao some do painel e o
    // usuario acha que perdeu o cartao.
    let cartoesQuery = supabase
      .from("financial_accounts")
      .select("id, name, closing_day, due_day")
      .eq("user_id", user.id)
      .eq("account_type", "credit_card")
      .eq("is_active", true);

    if (accountId) cartoesQuery = cartoesQuery.eq("id", accountId);

    const { data: cartoes } = await cartoesQuery;

    for (const cartao of cartoes ?? []) {
      if (porCartao.has(cartao.id)) continue;
      faturas.push({
        account_id: cartao.id,
        account_name: cartao.name,
        closing_day: cartao.closing_day ?? undefined,
        due_day: cartao.due_day ?? undefined,
        invoice_month: mes,
        due_date: undefined,
        total: 0,
        line_count: 0,
        lines: [],
      });
    }

    // Se a fatura ja virou conta prevista, a tela precisa saber para nao
    // oferecer "fechar" de novo. O vinculo e pela descricao canonica que
    // /api/card-invoices/close grava -- ver o comentario la.
    const { data: previstas } = await supabase
      .from("scheduled_transactions")
      .select("id, account_id, due_date, notes")
      .eq("user_id", user.id)
      .like("notes", `fatura:${mes}%`);

    for (const fatura of faturas) {
      const casada = (previstas ?? []).find((p) => p.account_id === fatura.account_id);
      if (casada) fatura.scheduled_transaction_id = casada.id;
    }

    // -----------------------------------------------------------------------
    // AS PREVISOES PENDENTES DAQUELE CARTAO QUE NAO SAO FATURA (HMO-227)
    // -----------------------------------------------------------------------
    // A HMO-209 tirou de Contas a Pagar toda previsao apontada para um cartao
    // que nao seja a fatura -- a assinatura que alguem cadastrou com o cartao
    // como conta, por exemplo -- e o comentario dela promete que aquelas linhas
    // "passam a aparecer na tela do cartao". ELAS NAO APARECIAM.
    //
    // Nos DOIS lugares: `card_invoice_lines` e view sobre
    // `financial_transactions`, e previsao nao e lancamento; e a consulta logo
    // acima le `scheduled_transactions` so com `notes` de fatura. Uma previsao
    // pendente apontada para o cartao estava escondida da agenda E da tela do
    // cartao -- gravada, sem leitor nenhum, que e o pior lugar para um dado
    // estar.
    //
    // ELAS NAO SAO FILTRADAS POR MES DE FATURA, e isso e deliberado: previsao
    // tem `due_date`, nao `invoice_month`. Encaixa-las pelo `closing_day` seria
    // aplicar a uma conta a pagar a regra de uma COMPRA, e a assinatura de
    // dezembro apareceria dentro da fatura de novembro sem nada na tela
    // explicando por que. Por isso vao em campo PROPRIO, com o vencimento de
    // cada uma, e nunca somadas a `total`.
    const idsDosCartoes = faturas.map((f) => f.account_id);

    if (idsDosCartoes.length > 0) {
      const { data: pendentes, error: erroPendentes } = await supabase
        .from("scheduled_transactions_effective")
        .select("*, category:transaction_categories(*)")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .in("account_id", idsDosCartoes)
        .order("due_date", { ascending: true });

      if (erroPendentes) {
        // A fatura ainda tem valor sem este bloco, e `undefined` e distinguivel
        // de "nenhuma previsao" na tela. Derrubar a resposta inteira por causa
        // dele trocaria um bloco que falta por uma pagina vazia.
        console.error("Faturas seguiram sem as previsões do cartão:", erroPendentes);
      } else {
        for (const fatura of faturas) {
          fatura.scheduled_pending = ((pendentes ?? []) as ScheduledTransaction[]).filter(
            (p) => p.account_id === fatura.account_id && !ehFatura(p.notes)
          );
        }
      }
    }

    faturas.sort((a, b) => b.total - a.total);

    return NextResponse.json({
      month: mes,
      invoices: faturas,
      total: faturas.reduce((soma, f) => soma + f.total, 0),
    });
  } catch (error) {
    console.error("Erro na API de faturas:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
