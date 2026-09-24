// POST /api/card-invoices/close   fecha a fatura como conta prevista
//
// Body: { account_id, month: 'YYYY-MM' }
//
// Aqui a Fase 2 encontra a Fase 1: a fatura vira uma linha em
// scheduled_transactions e, a partir dai, aparece na tela de contas previstas,
// entra no total a vencer e e paga pela mesma rota de baixa -- sem nenhum
// codigo novo de pagamento.
//
// O QUE ESTA ROTA NAO FAZ: nao lanca dinheiro. Fechar a fatura cria a conta A
// PAGAR; o dinheiro so sai quando o usuario der baixa. E nao mexe em
// current_balance -- as compras do cartao ja rebaixaram o saldo do cartao uma
// vez, quando foram lancadas. Debitar de novo ao fechar contaria a mesma
// despesa duas vezes.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { primeiroDiaDoMes, mesCorrente } from "@/lib/services/budget";
import { chaveFatura } from "@/lib/card-invoice";

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

    const body = await request.json().catch(() => ({}));
    const accountId = body.account_id;
    const mes = body.month ? primeiroDiaDoMes(body.month) : mesCorrente();

    if (!accountId) {
      return NextResponse.json(
        { error: "Cartão é obrigatório" },
        { status: 400 }
      );
    }

    if (!mes) {
      return NextResponse.json(
        { error: "Mês deve estar no formato AAAA-MM" },
        { status: 400 }
      );
    }

    const { data: cartao } = await supabase
      .from("financial_accounts")
      .select("id, name, account_type, closing_day, due_day")
      .eq("id", accountId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!cartao) {
      return NextResponse.json(
        { error: "Cartão não encontrado" },
        { status: 404 }
      );
    }

    if (cartao.account_type !== "credit_card") {
      return NextResponse.json(
        { error: "Esta conta não é um cartão de crédito" },
        { status: 400 }
      );
    }

    if (!cartao.due_day) {
      return NextResponse.json(
        {
          error:
            "Configure o dia de vencimento do cartão antes de fechar a fatura",
        },
        { status: 400 }
      );
    }

    const { data: linhas, error: erroLinhas } = await supabase
      .from("card_invoice_lines")
      .select("invoice_amount, invoice_due_date, category_id")
      .eq("account_id", accountId)
      .eq("invoice_month", mes);

    if (erroLinhas) {
      console.error("Erro ao ler as linhas da fatura:", erroLinhas);
      return NextResponse.json(
        { error: "Não foi possível ler a fatura" },
        { status: 500 }
      );
    }

    if (!linhas?.length) {
      return NextResponse.json(
        { error: "Esta fatura não tem lançamentos" },
        { status: 409 }
      );
    }

    const total = linhas.reduce((soma, l) => soma + Number(l.invoice_amount), 0);

    // Fatura negativa = o cartao esta com saldo a favor do usuario (estorno
    // maior que as compras). Nao existe "conta a pagar" de valor negativo, e o
    // CHECK amount > 0 do 005 recusaria a linha de qualquer forma.
    if (total <= 0) {
      return NextResponse.json(
        { error: "Esta fatura não tem valor a pagar" },
        { status: 409 }
      );
    }

    const vencimento = linhas[0].invoice_due_date;
    if (!vencimento) {
      return NextResponse.json(
        { error: "Não foi possível calcular o vencimento da fatura" },
        { status: 500 }
      );
    }

    // `notes` carrega a chave canonica da fatura. E o que permite a rota GET
    // reconhecer que esta fatura ja foi fechada, sem uma coluna nova em
    // scheduled_transactions so para isso -- e o que torna esta rota
    // idempotente: clicar "fechar" duas vezes nao cria duas contas a pagar.
    //
    // Desde o conserto do HMO-149 esta chave tem um terceiro papel: e por ela
    // que a rota de baixa sabe que esta conta prevista e uma FATURA, e portanto
    // que pagar nao e gastar -- e uma transferencia da conta pagadora para o
    // cartao. O formato mora em lib/card-invoice.ts, com a leitura ao lado da
    // escrita: quem mudar a chave aqui quebra a deteccao la, e vice-versa.
    const chave = chaveFatura(mes, accountId);

    const { data: existente } = await supabase
      .from("scheduled_transactions")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("notes", chave)
      .maybeSingle();

    if (existente) {
      return NextResponse.json(
        {
          error: "Esta fatura já foi fechada",
          scheduled_transaction_id: existente.id,
        },
        { status: 409 }
      );
    }

    // A categoria da fatura e a da compra mais recente do cartao; category_id e
    // NOT NULL em scheduled_transactions e a fatura inteira nao tem categoria
    // propria. O usuario pode trocar depois, na tela de contas previstas.
    const categoriaId = linhas[linhas.length - 1].category_id;

    const [ano, mesNum] = mes.split("-");
    const descricao = `Fatura ${cartao.name} ${mesNum}/${ano}`;

    const { data: prevista, error: erroPrevista } = await supabase
      .from("scheduled_transactions")
      .insert({
        user_id: user.id,
        category_id: categoriaId,
        // O cartao, e nao a conta de onde o dinheiro vai sair: esta conta a
        // pagar PERTENCE ao cartao. Qual conta paga so se sabe na baixa, e e la
        // que o usuario escolhe (HMO-149). Gravar aqui uma conta pagadora
        // adivinhada foi o que produziu o bug da despesa em dobro.
        account_id: accountId,
        description: descricao,
        amount: total,
        due_date: vencimento,
        status: "pending",
        notes: chave,
      })
      .select("*")
      .single();

    if (erroPrevista) {
      console.error("Erro ao fechar a fatura:", erroPrevista);
      return NextResponse.json(
        { error: "Não foi possível fechar a fatura" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { scheduled_transaction: prevista, total, due_date: vencimento },
      { status: 201 }
    );
  } catch (error) {
    console.error("Erro ao fechar a fatura:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
