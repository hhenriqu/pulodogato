// GET  /api/scheduled-transactions/{id}/vincular   lancamentos que podem quitar esta prevista
// POST /api/scheduled-transactions/{id}/vincular   { transaction_id } -- quita com um lancamento que JA EXISTE
//
// A outra ponte entre previsto e realizado. O `/pay` CRIA o lancamento; esta
// rota aponta a prevista para um lancamento que a pessoa ja tinha feito a mao
// -- o aluguel lancado no dia 09 cuja conta prevista vencia no dia 10. Sem ela a
// mesma despesa entrava no realizado (o lancamento) e no previsto (a conta
// `pending`), e o dashboard somava as duas.
//
// O QUE A ROTA NAO FAZ
// --------------------
// Nao cria nem altera dinheiro: o lancamento fica como esta (valor, data,
// conta, grupo). A prevista passa a `paid` com `paid_date` = data do
// lancamento, para o "pago em" da agenda dizer o dia em que o dinheiro saiu. O
// valor previsto continua na linha, como no `/pay` com valor diferente.
//
// O DESFAZER e apagar o lancamento: a 065 devolve a prevista para `pending` no
// mesmo DELETE. Antes da 065 ser colada, esse DELETE responde erro de
// constraint -- o vinculo em si funciona sem ela.
//
// A regra de quem pode vincular com quem esta em lib/vinculo-da-prevista.ts.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { addDays } from "@/lib/recurrence";
import {
  JANELA_DO_VINCULO,
  lancamentosParaEscolher,
  mensagemDoVinculo,
  problemaDoVinculo,
  type LancamentoParaVinculo,
  type PrevistaParaVinculo,
} from "@/lib/vinculo-da-prevista";

const COLUNAS_DA_PREVISTA =
  "id, user_id, status, amount, due_date, direction, category_id, description, notes";

const COLUNAS_DO_LANCAMENTO =
  "id, user_id, amount, transaction_date, transaction_type, category_id, description";

export async function GET(
  _request: NextRequest,
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

    // Da VIEW e nao da tabela: `direction` e a precedencia da 027 ja resolvida.
    const { data: prevista } = await supabase
      .from("scheduled_transactions_effective")
      .select(COLUNAS_DA_PREVISTA)
      .eq("id", params.id)
      .eq("user_id", user.id)
      .maybeSingle<PrevistaParaVinculo>();

    if (!prevista) {
      return NextResponse.json(
        { error: "Conta prevista não encontrada" },
        { status: 404 }
      );
    }

    const { data: lancamentos, error } = await supabase
      .from("financial_transactions")
      .select(COLUNAS_DO_LANCAMENTO)
      .eq("user_id", user.id)
      .gte("transaction_date", addDays(prevista.due_date, -JANELA_DO_VINCULO))
      .lte("transaction_date", addDays(prevista.due_date, JANELA_DO_VINCULO))
      .order("transaction_date", { ascending: false })
      .limit(200)
      .returns<LancamentoParaVinculo[]>();

    if (error) {
      console.error("Erro ao listar lançamentos para vincular:", error);
      return NextResponse.json(
        { error: "Não foi possível listar os lançamentos" },
        { status: 500 }
      );
    }

    // Os que ja quitam OUTRA prevista saem da lista: um lancamento paga uma
    // conta so.
    const ids = (lancamentos ?? []).map((l) => l.id);
    let vinculados = new Set<string>();
    if (ids.length > 0) {
      const { data: jaVinculadas } = await supabase
        .from("scheduled_transactions")
        .select("id, transaction_id")
        .in("transaction_id", ids)
        .neq("id", prevista.id)
        .returns<{ id: string; transaction_id: string }[]>();
      vinculados = new Set((jaVinculadas ?? []).map((s) => s.transaction_id));
    }

    return NextResponse.json({
      transactions: lancamentosParaEscolher(prevista, lancamentos ?? [], vinculados),
    });
  } catch (error) {
    console.error("Erro ao listar lançamentos para vincular:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(
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

    const body = await request.json().catch(() => ({}));
    const transactionId =
      typeof body.transaction_id === "string" ? body.transaction_id : "";

    if (!transactionId) {
      return NextResponse.json(
        { error: "Informe o lançamento a vincular" },
        { status: 400 }
      );
    }

    const { data: prevista } = await supabase
      .from("scheduled_transactions_effective")
      .select(COLUNAS_DA_PREVISTA)
      .eq("id", params.id)
      .eq("user_id", user.id)
      .maybeSingle<PrevistaParaVinculo>();

    if (!prevista) {
      return NextResponse.json(
        { error: "Conta prevista não encontrada" },
        { status: 404 }
      );
    }

    // `user_id = eu` no filtro E na regra. O filtro e o que a RLS ja faria para
    // lancamento pessoal; a RLS de lancamento de GRUPO deixa o membro ler o do
    // outro, e e a regra (`lancamento_de_outro`) que recusa esse.
    const { data: lancamento } = await supabase
      .from("financial_transactions")
      .select(COLUNAS_DO_LANCAMENTO)
      .eq("id", transactionId)
      .maybeSingle<LancamentoParaVinculo>();

    if (!lancamento) {
      return NextResponse.json(
        { error: "Lançamento não encontrado" },
        { status: 404 }
      );
    }

    const { data: outra } = await supabase
      .from("scheduled_transactions")
      .select("id")
      .eq("transaction_id", lancamento.id)
      .limit(1)
      .maybeSingle<{ id: string }>();

    const problema = problemaDoVinculo({
      prevista,
      lancamento,
      vinculadoA: outra?.id ?? null,
    });

    if (problema) {
      return NextResponse.json(
        { error: mensagemDoVinculo(problema), problema },
        {
          status:
            problema === "prevista_nao_pendente" || problema === "ja_vinculado"
              ? 409
              : 400,
        }
      );
    }

    // `.eq("status", "pending")` no UPDATE: entre a leitura acima e esta escrita
    // a pessoa pode ter dado baixa por outra aba. Sem o filtro, o vinculo
    // trocaria o `transaction_id` de uma prevista ja paga pelo `/pay` e o
    // lancamento que o `/pay` criou ficaria solto, fora do estorno.
    const { data: vinculada, error: erroVinculo } = await supabase
      .from("scheduled_transactions")
      .update({
        status: "paid",
        paid_date: lancamento.transaction_date,
        transaction_id: lancamento.id,
      })
      .eq("id", prevista.id)
      .eq("user_id", user.id)
      .eq("status", "pending")
      .select()
      .maybeSingle();

    if (erroVinculo) {
      console.error("Erro ao vincular a conta prevista:", erroVinculo);
      return NextResponse.json(
        { error: "Não foi possível vincular a conta prevista" },
        { status: 500 }
      );
    }

    if (!vinculada) {
      return NextResponse.json(
        { error: mensagemDoVinculo("prevista_nao_pendente") },
        { status: 409 }
      );
    }

    return NextResponse.json({
      message: `${prevista.description ?? "Conta"} vinculada ao lançamento`,
      scheduled: vinculada,
      transaction_id: lancamento.id,
    });
  } catch (error) {
    console.error("Erro ao vincular a conta prevista:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
