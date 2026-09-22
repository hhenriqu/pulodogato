// PATCH /api/statements/entries/[id]   decide o que fazer com uma linha do extrato
//
// Quatro acoes, e so a primeira cria dinheiro:
//
//   import  -> cria a financial_transaction com a categoria escolhida
//   link    -> aponta a linha para um lancamento que JA existia (a conciliacao)
//   ignore  -> a linha nao interessa (tarifa ja contabilizada, saldo, etc.)
//   reset   -> desfaz, devolvendo a linha para 'pending'
//
// O SINAL, PELA ULTIMA VEZ
// ------------------------
// `transaction_type` sai do SINAL do extrato e de mais nada -- nunca da
// categoria escolhida. Deixar a categoria mandar criaria o caso em que o
// usuario classifica um estorno de R$ 250 como "Alimentacao" e o app grava
// -250: o estorno, que e dinheiro que VOLTOU, viraria mais um gasto. O valor
// gravado e exatamente o que o banco mandou.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getServiceId } from "@/lib/services/scheduled";
import { tipoPeloSinal } from "@/lib/statement";

const ACOES = ["import", "link", "ignore", "reset"] as const;
type Acao = (typeof ACOES)[number];

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
    const acao = body?.action as Acao;

    if (!ACOES.includes(acao)) {
      return NextResponse.json(
        { error: `Ação inválida. Use uma de: ${ACOES.join(", ")}` },
        { status: 400 }
      );
    }

    const { data: linha } = await supabase
      .from("statement_entries")
      .select("*")
      .eq("id", params.id)
      .single();

    if (!linha) {
      return NextResponse.json(
        { error: "Lançamento do extrato não encontrado" },
        { status: 404 }
      );
    }

    // ---------------------------------------------------------------
    // reset
    // ---------------------------------------------------------------
    if (acao === "reset") {
      // A transacao criada por um 'import' anterior NAO e apagada aqui: ela e
      // um lancamento do usuario a partir do momento em que nasceu, e pode ter
      // sido editada, dividida com o grupo ou usada num acerto. Desfazer a
      // marcacao e uma coisa; apagar dinheiro e outra.
      const { error } = await supabase
        .from("statement_entries")
        .update({ status: "pending", transaction_id: null })
        .eq("id", params.id);

      if (error) {
        console.error("Erro ao desfazer:", error);
        return NextResponse.json({ error: "Não foi possível desfazer" }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        aviso:
          linha.status === "imported"
            ? "A linha voltou para pendente. O lançamento criado antes continua nos seus lançamentos."
            : undefined,
      });
    }

    if (linha.status !== "pending") {
      return NextResponse.json(
        { error: "Esta linha já foi resolvida. Desfaça antes de mudar." },
        { status: 409 }
      );
    }

    // ---------------------------------------------------------------
    // ignore
    // ---------------------------------------------------------------
    if (acao === "ignore") {
      const { error } = await supabase
        .from("statement_entries")
        .update({ status: "ignored" })
        .eq("id", params.id);

      if (error) {
        console.error("Erro ao ignorar linha:", error);
        return NextResponse.json({ error: "Não foi possível ignorar" }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    // ---------------------------------------------------------------
    // link  (a linha ja estava lancada)
    // ---------------------------------------------------------------
    if (acao === "link") {
      const transactionId = body?.transaction_id as string | undefined;
      if (!transactionId) {
        return NextResponse.json(
          { error: "Informe o lançamento a vincular" },
          { status: 400 }
        );
      }

      const { data: alvo } = await supabase
        .from("financial_transactions")
        .select("id, amount, account_id")
        .eq("id", transactionId)
        .eq("user_id", user.id)
        .single();

      if (!alvo) {
        return NextResponse.json({ error: "Lançamento não encontrado" }, { status: 404 });
      }

      // O valor tem que bater exatamente. Vincular valores diferentes faria a
      // linha sumir do extrato sem que o lancamento correspondente existisse --
      // e a diferenca nunca mais apareceria em lugar nenhum.
      if (Math.round(Number(alvo.amount) * 100) !== Math.round(Number(linha.amount) * 100)) {
        return NextResponse.json(
          { error: "O valor do lançamento escolhido é diferente do valor do extrato" },
          { status: 409 }
        );
      }

      // Um lancamento ja reivindicado por outra linha nao pode ser reivindicado
      // de novo: o segundo gasto de verdade sumiria do app. Mesma regra que a
      // conciliacao aplica ao sugerir.
      const { data: jaLigado } = await supabase
        .from("statement_entries")
        .select("id")
        .eq("transaction_id", transactionId)
        .maybeSingle();

      if (jaLigado) {
        return NextResponse.json(
          { error: "Este lançamento já está vinculado a outra linha do extrato" },
          { status: 409 }
        );
      }

      const { error } = await supabase
        .from("statement_entries")
        .update({ status: "linked", transaction_id: transactionId })
        .eq("id", params.id);

      if (error) {
        console.error("Erro ao vincular:", error);
        return NextResponse.json({ error: "Não foi possível vincular" }, { status: 500 });
      }

      return NextResponse.json({ ok: true, transaction_id: transactionId });
    }

    // ---------------------------------------------------------------
    // import  (nasce o lancamento)
    // ---------------------------------------------------------------
    const categoryId = body?.category_id as string | undefined;
    if (!categoryId) {
      return NextResponse.json(
        { error: "Escolha uma categoria para este lançamento" },
        { status: 400 }
      );
    }

    const { data: categoria } = await supabase
      .from("transaction_categories")
      .select("id")
      .eq("id", categoryId)
      .single();

    if (!categoria) {
      return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });
    }

    const serviceId = await getServiceId(supabase);
    if (!serviceId) {
      return NextResponse.json(
        { error: "Serviço de finanças pessoais não encontrado" },
        { status: 404 }
      );
    }

    const valor = Number(linha.amount);

    const { data: transacao, error: erroTransacao } = await supabase
      .from("financial_transactions")
      .insert({
        user_id: user.id,
        service_id: serviceId,
        category_id: categoryId,
        account_id: linha.account_id,
        // O usuario pode corrigir a descricao do banco ("PAG*IFD3947") na tela.
        description: (body?.description || linha.description || "Lançamento importado").slice(0, 500),
        amount: valor,
        transaction_date: linha.posted_at,
        transaction_type: tipoPeloSinal(valor),
        notes: linha.memo,
      })
      .select()
      .single();

    if (erroTransacao || !transacao) {
      console.error("Erro ao criar lançamento do extrato:", erroTransacao);
      return NextResponse.json(
        { error: "Não foi possível criar o lançamento" },
        { status: 500 }
      );
    }

    const { error: erroLinha } = await supabase
      .from("statement_entries")
      .update({ status: "imported", transaction_id: transacao.id })
      .eq("id", params.id);

    if (erroLinha) {
      // A transacao nasceu mas a linha nao fechou: sem desfazer, a mesma linha
      // continuaria pendente e o usuario a importaria de novo, lancando o
      // gasto duas vezes.
      console.error("Erro ao fechar a linha do extrato, desfazendo:", erroLinha);
      await supabase.from("financial_transactions").delete().eq("id", transacao.id);
      return NextResponse.json(
        { error: "Não foi possível concluir a importação desta linha" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, transaction: transacao }, { status: 201 });
  } catch (error) {
    console.error("Erro na ação do extrato:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
