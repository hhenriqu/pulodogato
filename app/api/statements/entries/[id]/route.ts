// PATCH /api/statements/entries/[id]   decide o que fazer com uma linha do extrato
//
// Quatro acoes, e so a primeira cria dinheiro:
//
//   import  -> cria a financial_transaction com a categoria escolhida (e,
//              desde a 087, com data, valor e descricao editados na fila)
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
import { TOLERANCIA_CENTAVOS_PADRAO, tipoPeloSinal } from "@/lib/statement";
import {
  parcelaJaGravada,
  parcelasQueFaltam,
  type ParcelaGravada,
  type ParcelaImportada,
} from "@/lib/parcelas-da-fatura-importada";
import {
  aprenderRegra,
  regraParaLinha,
  registrarAplicacao,
} from "@/lib/services/categorization";

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

      // O valor tem que bater, com no maximo alguns centavos de diferenca (a
      // mesma folga da conciliacao). Vincular valores diferentes faria a linha
      // sumir do extrato sem que o lancamento correspondente existisse -- e a
      // diferenca nunca mais apareceria em lugar nenhum. Por isso, quando ha
      // diferenca de centavos, o lancamento passa a ter o valor do BANCO, que
      // e o que de fato saiu da conta (mais abaixo).
      const centavosAlvo = Math.round(Number(alvo.amount) * 100);
      const centavosLinha = Math.round(Number(linha.amount) * 100);
      if (
        Math.sign(centavosAlvo) !== Math.sign(centavosLinha) ||
        Math.abs(centavosAlvo - centavosLinha) > TOLERANCIA_CENTAVOS_PADRAO
      ) {
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

      // Centavos de diferenca: o lancamento fica com o valor do extrato. Assim
      // a fatura e o saldo batem com o banco, e a diferenca nao some calada.
      const valorAjustado = centavosAlvo !== centavosLinha ? centavosLinha / 100 : null;
      if (valorAjustado !== null) {
        const { error: erroValor } = await supabase
          .from("financial_transactions")
          .update({ amount: valorAjustado })
          .eq("id", transactionId)
          .eq("user_id", user.id);
        if (erroValor) {
          console.error("Erro ao ajustar o valor ao vincular:", erroValor);
          return NextResponse.json({ error: "Não foi possível vincular" }, { status: 500 });
        }
      }

      const { error } = await supabase
        .from("statement_entries")
        .update({ status: "linked", transaction_id: transactionId })
        .eq("id", params.id);

      if (error) {
        console.error("Erro ao vincular:", error);
        return NextResponse.json({ error: "Não foi possível vincular" }, { status: 500 });
      }

      return NextResponse.json({ ok: true, transaction_id: transactionId, adjusted_amount: valorAjustado });
    }

    // ---------------------------------------------------------------
    // import  (nasce o lancamento)
    // ---------------------------------------------------------------
    // A categoria pode vir de tres lugares, e a ordem nao e arbitraria:
    //
    //   1. o corpo da requisicao  -- o usuario escolheu, explicitamente
    //   2. uma REGRA dele         -- ele ja escolheu antes, para este lojista
    //   3. nenhum                 -> 400, como sempre foi
    //
    // O CATALOGO EMBUTIDO NAO ENTRA AQUI. Ele aparece como sugestao na tela
    // (GET /api/statements/[id]) e so vira categoria se o usuario aceitar,
    // porque ai a escolha volta pelo caminho 1. Deixa-lo aplicar sozinho seria
    // o app adivinhando e gravando: a linha nasceria na categoria errada sem
    // ninguem ter dito nada, e o erro so apareceria no relatorio do mes.
    // Regra, sim, aplica sozinha -- foi o proprio usuario quem a escreveu.
    const escolhaExplicita = body?.category_id as string | undefined;
    let categoryId = escolhaExplicita;
    let regraAplicada: string | undefined;

    if (!categoryId) {
      // NAO LANCA: sem regra disponivel a importacao cai no 400 logo abaixo,
      // que e como ela se comportava antes desta feature existir. Ver
      // `lerInsumos` em lib/services/categorization.ts.
      const sugestao = await regraParaLinha(
        supabase,
        user.id,
        linha.description ?? "",
        Number(linha.amount)
      );

      if (sugestao) {
        categoryId = sugestao.categoryId;
        regraAplicada = sugestao.ruleId;
      }
    }

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

    // --- o que o usuario editou na fila (087, issue #447) ------------------
    // Data, valor e descricao podem ser corrigidos antes de confirmar. O VALOR
    // chega sem sinal e o sinal continua sendo o do banco: editar "87,35" para
    // "90,00" numa saida grava -90,00. Deixar o sinal vir da tela abriria a
    // porta para o estorno digitado virar gasto -- ver o topo do arquivo.
    const sinal = Number(linha.amount) < 0 ? -1 : 1;
    let valor = Number(linha.amount);
    if (body?.amount != null && body.amount !== "") {
      const editado = Math.round(Math.abs(Number(body.amount)) * 100) / 100;
      if (!Number.isFinite(editado) || editado === 0) {
        return NextResponse.json({ error: "Valor inválido" }, { status: 400 });
      }
      valor = sinal * editado;
    }

    let data = String(linha.posted_at).slice(0, 10);
    if (body?.transaction_date) {
      const editada = String(body.transaction_date).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(editada) || Number.isNaN(Date.parse(`${editada}T00:00:00Z`))) {
        return NextResponse.json({ error: "Data inválida" }, { status: 400 });
      }
      data = editada;
    }

    // Na fatura do C6, o lancamento leva a parcela e o mes da fatura de onde
    // veio. Sem o override, uma compra feita depois do fechamento cairia na
    // fatura SEGUINTE pela data, e nao na fatura que o usuario importou.
    const { data: extratoDaLinha } = await supabase
      .from("statement_imports")
      .select("source, invoice_month")
      .eq("id", linha.import_id)
      .single();
    const daFatura = extratoDaLinha?.source === "c6_cartao";
    const descricaoFinal = (body?.description || linha.description || "Lançamento importado").slice(0, 500);

    // --- a compra parcelada da fatura (089) ---------------------------------
    // A fatura traz so a parcela do mes. As que faltam nascem junto (mais
    // abaixo), e a parcela que ja nasceu assim numa importacao anterior e
    // VINCULADA aqui, em vez de virar um segundo lancamento. Ver
    // lib/parcelas-da-fatura-importada.ts.
    const parcela: ParcelaImportada | null =
      daFatura &&
      extratoDaLinha?.invoice_month &&
      linha.installment_number &&
      linha.installment_total &&
      linha.installment_total > 1
        ? {
            numero: linha.installment_number,
            total: linha.installment_total,
            mesDaFatura: String(extratoDaLinha.invoice_month).slice(0, 10),
            valor,
            descricao: descricaoFinal,
          }
        : null;

    let gravadas: ParcelaGravada[] = [];
    if (parcela) {
      const { data: daSerie, error: erroDaSerie } = await supabase
        .from("card_invoice_lines")
        .select("transaction_id, installment_number, installment_total, invoice_month, amount, description")
        .eq("account_id", linha.account_id)
        .eq("installment_total", parcela.total)
        .gte("installment_number", parcela.numero)
        .gte("invoice_month", parcela.mesDaFatura);
      if (erroDaSerie) {
        // Sem a leitura nao da para saber o que ja existe: criar as parcelas
        // as cegas poderia dobrar a serie. A linha entra sozinha, como antes.
        console.error("Erro ao ler as parcelas já gravadas:", erroDaSerie);
      } else {
        const ids = (daSerie ?? []).map((t) => t.transaction_id as string);
        const { data: ligadas } = ids.length
          ? await supabase.from("statement_entries").select("transaction_id").in("transaction_id", ids)
          : { data: [] };
        const ocupadas = new Set((ligadas ?? []).map((l) => l.transaction_id));
        gravadas = (daSerie ?? []).map((t) => ({
          id: t.transaction_id as string,
          numero: t.installment_number ?? null,
          total: t.installment_total ?? null,
          mesDaFatura: String(t.invoice_month).slice(0, 10),
          valor: Number(t.amount),
          descricao: t.description ?? "",
          vinculada: ocupadas.has(t.transaction_id),
        }));
      }
    }

    const jaGravada = parcela ? parcelaJaGravada(parcela, gravadas) : null;
    if (jaGravada) {
      // A parcela nasceu com a fatura anterior. A categoria escolhida agora
      // vale para ela; o valor, a data e a fatura ja sao os do banco.
      const { data: vinculada, error: erroVinculo } = await supabase
        .from("financial_transactions")
        .update({ category_id: categoryId })
        .eq("id", jaGravada.id)
        .eq("user_id", user.id)
        .select()
        .single();
      if (erroVinculo || !vinculada) {
        console.error("Erro ao vincular a parcela já gravada:", erroVinculo);
        return NextResponse.json({ error: "Não foi possível vincular a parcela" }, { status: 500 });
      }
      const { error: erroLinhaVinculada } = await supabase
        .from("statement_entries")
        .update({ status: "linked", transaction_id: jaGravada.id })
        .eq("id", params.id);
      if (erroLinhaVinculada) {
        console.error("Erro ao fechar a linha da parcela:", erroLinhaVinculada);
        return NextResponse.json({ error: "Não foi possível vincular a parcela" }, { status: 500 });
      }
      return NextResponse.json(
        {
          ok: true,
          transaction: vinculada,
          installment_linked: true,
          aviso: `A parcela ${parcela!.numero}/${parcela!.total} já estava lançada pela fatura anterior: vinculei a ela.`,
        },
        { status: 200 }
      );
    }

    const { data: transacao, error: erroTransacao } = await supabase
      .from("financial_transactions")
      .insert({
        user_id: user.id,
        service_id: serviceId,
        category_id: categoryId,
        account_id: linha.account_id,
        // O usuario pode corrigir a descricao do banco ("PAG*IFD3947") na tela.
        description: descricaoFinal,
        amount: valor,
        transaction_date: data,
        transaction_type: tipoPeloSinal(valor),
        notes: linha.memo,
        ...(daFatura
          ? {
              installment_number: linha.installment_number ?? null,
              installment_total: linha.installment_total ?? null,
              invoice_month_override: extratoDaLinha?.invoice_month ?? null,
            }
          : {}),
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

    // --- as parcelas que faltam (089) --------------------------------------
    // Depois de a linha fechar: se este insert falhar, a parcela do mes ja
    // esta certa, e a resposta diz que as seguintes nao entraram. Um insert so
    // com todas: ou entram as que faltam, ou nenhuma.
    let parcelasCriadas = 0;
    let avisoDasParcelas: string | undefined;
    if (parcela) {
      const faltam = parcelasQueFaltam(parcela, gravadas);
      if (faltam.length > 0) {
        const { data: criadas, error: erroParcelas } = await supabase
          .from("financial_transactions")
          .insert(
            faltam.map((f) => ({
              user_id: user.id,
              service_id: serviceId,
              category_id: categoryId,
              account_id: linha.account_id,
              description: f.descricao.slice(0, 500),
              amount: f.valor,
              transaction_date: f.dataDoLancamento,
              transaction_type: tipoPeloSinal(f.valor),
              installment_number: f.numero,
              installment_total: f.total,
              invoice_month_override: f.mesDaFatura,
              installment_parent_id: transacao.id,
            }))
          )
          .select("id");
        if (erroParcelas) {
          console.error("Erro ao criar as parcelas seguintes:", erroParcelas);
          avisoDasParcelas = `As parcelas seguintes (${faltam[0].numero} a ${parcela.total}) não foram criadas. Lance a compra parcelada pelo cartão para que entrem no total.`;
        } else {
          parcelasCriadas = criadas?.length ?? 0;
          await supabase
            .from("financial_transactions")
            .update({ installment_parent_id: transacao.id })
            .eq("id", transacao.id)
            .eq("user_id", user.id);
        }
      }
    }

    // --- o aprendizado ------------------------------------------------------
    // Depois de a linha fechar, nunca antes: gravar a regra e um efeito
    // secundario, e nenhuma falha dele pode desfazer um lancamento que ja
    // nasceu. Por isso `aprenderRegra` e `registrarAplicacao` nao lancam -- o
    // pior resultado aceitavel e "na proxima o usuario escolhe de novo".
    let aprendizado;
    if (escolhaExplicita) {
      // O usuario escolheu a mao: e exatamente isto que vale a pena aprender.
      aprendizado = await aprenderRegra(
        supabase,
        user.id,
        linha.description ?? "",
        escolhaExplicita
      );
    } else if (regraAplicada) {
      // A categoria veio de uma regra: nao ha o que aprender, so o que contar.
      await registrarAplicacao(supabase, regraAplicada);
    }

    return NextResponse.json(
      {
        ok: true,
        transaction: transacao,
        // A tela usa isto para dizer "criei uma regra: proximo iFood ja vem
        // categorizado" -- e o momento em que o usuario descobre que a feature
        // existe. Uma regra criada em silencio e uma regra que ele nunca vai
        // procurar na tela de regras.
        rule_learned: aprendizado?.outcome === "created" ? aprendizado.ruleId : undefined,
        rule_applied: regraAplicada,
        // Quantas parcelas seguintes nasceram com esta (089).
        installments_created: parcelasCriadas,
        aviso: avisoDasParcelas,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Erro na ação do extrato:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
