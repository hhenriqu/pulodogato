// ---------------------------------------------------------------------------
// PATCH /api/mybank/installments/[id] -- quem avisa e quem confirma
// ---------------------------------------------------------------------------
// MyBank, F2 da HMO-368 (issue HMO-370). Duas transicoes, uma para cada lado:
//
//   DEVEDOR:  `pending -> reported`  ("paguei, confere")
//   CREDOR:   `reported|pending -> paid`  ("recebi") -- e e ele que grava a
//             perna de entrada, no Caso B.
//
// QUEM VE O DINHEIRO CHEGAR E QUEM CONFIRMA (a forma da HMO-366)
// --------------------------------------------------------------
// "alguem registrou que me pagou e eu ainda nao lancei" e um estado DERIVAVEL,
// nao uma coluna nova: e `status = 'reported'`, e `parcelaAConfirmar` e quem o
// le. O devedor nao consegue levar a parcela a `paid` porque a conta que recebe
// nao e dele -- ele nao tem como saber se o dinheiro entrou.
//
// O DEVEDOR NAO MEXE NO VALOR, E A DEFESA AQUI E A AUSENCIA
// --------------------------------------------------------
// Esta rota NUNCA le `amount`, `due_date`, `installment_number` nem
// `paid_transaction_id` do corpo do pedido -- em ramo nenhum, para papel nenhum.
// Nao ha um `if (euSouODevedor) delete patch.amount`: o campo simplesmente nao
// existe neste arquivo, e e por isso que nenhum corpo de pedido consegue
// alcanca-lo. A trava do banco (`mybank_installments_trava_do_devedor`, 053) e a
// rede por baixo -- ela segura quem chega pelo PostgREST direto, e e ela que
// prende o valor de verdade, porque policy de UPDATE nao compara NEW com OLD.
//
// O CASO A NAO ACEITA `paid` AQUI, E ISSO E DELIBERADO
// ---------------------------------------------------
// No auto-emprestimo a parcela JA e uma transferencia prevista em
// `scheduled_transactions`, e quem a paga e
// `/api/scheduled-transactions/[id]/pay` -- que grava as DUAS pernas de
// `pernasDaTransferencia`. Aceitar `paid` aqui produziria uma parcela paga sem
// nenhum dinheiro ter se movido: o emprestimo apareceria quitado, o saldo da
// conta corrente nao teria baixado e a conta de investimento nao teria subido.
// E a familia do "o numero fecha, o fato nao aconteceu" (HMO-149), e ela e pior
// de achar do que um erro: nada no caminho reclama.
//
// A recusa aponta para onde pagar, e o elo que liga a previsao de volta a parcela
// e a chave `mybank:<id>` em `notes` (`chaveDaParcelaDoMyBank`). Fechar o ciclo
// -- a baixa da previsao marcando a parcela como `paid` -- e trabalho da F4, com
// as outras leituras; aqui o que importa e que a parcela NAO fique paga por
// engano no meio do caminho.
// ---------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

import {
  casoDoEmprestimo,
  chaveDaParcelaDoMyBank,
  pernaDeEntradaDoPagamento,
} from "@/lib/emprestimo-do-mybank";
import { hojeISO } from "@/lib/lancamento";
import { NOME_DA_CATEGORIA_DE_TRANSFERENCIA } from "@/lib/transferencia";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
    const { status, data_do_pagamento } = body as {
      status?: string;
      data_do_pagamento?: string | null;
    };

    if (status !== "paid" && status !== "reported") {
      return NextResponse.json(
        {
          error:
            'A parcela só aceita "reported" (quem deve avisa que pagou) ou "paid" (quem recebeu confirma).',
        },
        { status: 400 }
      );
    }

    const { data: parcela } = await supabase
      .from("mybank_installments")
      .select(
        "id, loan_id, installment_number, installment_total, amount, due_date, status"
      )
      .eq("id", params.id)
      .maybeSingle();

    if (!parcela) {
      // 404 e nao 403: a RLS de `mybank_installments_select` deixa os dois
      // lados verem a linha, entao "nao achei" aqui quer dizer que a parcela
      // nao e de um emprestimo meu nem de uma divida minha. Dizer "existe mas
      // nao e sua" confirmaria a existencia do id para quem o chutou.
      return NextResponse.json(
        { error: "Parcela não encontrada" },
        { status: 404 }
      );
    }

    // O EMPRESTIMO E LIDO SEPARADO, E NAO POR EMBED
    //
    // `mybank_loans!inner(...)` seria mais curto. Embed que a RLS nao deixa
    // resolver nao devolve `null` neste repositorio -- ele DESCARTA A LINHA --,
    // e o sintoma aqui seria "parcela nao encontrada" numa parcela que existe.
    const { data: emprestimo } = await supabase
      .from("mybank_loans")
      .select("id, lender_user_id, lender_account_id, borrower_user_id, description, status")
      .eq("id", parcela.loan_id)
      .maybeSingle();

    if (!emprestimo) {
      return NextResponse.json(
        { error: "Empréstimo não encontrado" },
        { status: 404 }
      );
    }

    const souOCredor = emprestimo.lender_user_id === user.id;
    const souODevedor = emprestimo.borrower_user_id === user.id;

    if (!souOCredor && !souODevedor) {
      return NextResponse.json(
        { error: "Parcela não encontrada" },
        { status: 404 }
      );
    }

    const caso = casoDoEmprestimo({
      lenderUserId: emprestimo.lender_user_id,
      borrowerUserId: emprestimo.borrower_user_id,
    });

    // -----------------------------------------------------------------------
    // O DEVEDOR AVISA: pending -> reported
    // -----------------------------------------------------------------------
    if (status === "reported") {
      // `souOCredor` primeiro: no auto-emprestimo eu sou os dois, e avisar a
      // mim mesmo que paguei nao e um estado util -- nesse caso o caminho e a
      // baixa da previsao em Contas a Pagar.
      if (souOCredor) {
        return NextResponse.json(
          {
            error:
              caso === "auto"
                ? "No empréstimo para você mesmo não há a quem avisar: pague a parcela em Contas a Pagar."
                : 'Quem empresta não avisa que pagou — confirme com "paid" quando o dinheiro entrar.',
          },
          { status: 400 }
        );
      }

      if (parcela.status !== "pending") {
        return NextResponse.json(
          {
            error:
              parcela.status === "reported"
                ? "Você já avisou que pagou esta parcela. Falta quem emprestou confirmar."
                : `Esta parcela está "${parcela.status}" e não aceita o aviso de pagamento.`,
          },
          { status: 409 }
        );
      }

      // SO `status` E `reported_at`. Ver o cabecalho: nenhum outro campo e lido
      // do corpo do pedido, em ramo nenhum deste arquivo.
      const { data: atualizadas, error: erroDoAviso } = await supabase
        .from("mybank_installments")
        .update({ status: "reported", reported_at: new Date().toISOString() })
        .eq("id", parcela.id)
        .select("id, status");

      // `.select()` NAO E DECORACAO: um UPDATE que a policy nao deixa casar
      // responde 200 com corpo vazio, nao erro -- a RLS filtra em vez de
      // recusar. Sem conferir a contagem, esta rota responderia "avisei" sobre
      // um UPDATE que alcancou zero linha.
      if (erroDoAviso || !atualizadas || atualizadas.length === 0) {
        console.error("Erro ao marcar a parcela como reported:", erroDoAviso);
        return NextResponse.json(
          { error: "Não foi possível registrar o aviso de pagamento" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        status: "reported",
        message: "Avisamos quem emprestou. Falta a confirmação de que o dinheiro entrou.",
      });
    }

    // -----------------------------------------------------------------------
    // O CREDOR CONFIRMA: -> paid
    // -----------------------------------------------------------------------
    if (!souOCredor) {
      return NextResponse.json(
        {
          error:
            'Quem confirma o pagamento é quem recebe o dinheiro. Use "reported" para avisar que você pagou.',
        },
        { status: 403 }
      );
    }

    if (parcela.status === "paid") {
      return NextResponse.json(
        { error: "Esta parcela já está paga." },
        { status: 409 }
      );
    }

    if (parcela.status === "cancelled") {
      return NextResponse.json(
        { error: "Esta parcela foi cancelada." },
        { status: 409 }
      );
    }

    // Ver O CASO A NAO ACEITA `paid` AQUI, no cabecalho.
    if (caso === "auto") {
      return NextResponse.json(
        {
          error:
            "Esta parcela é uma transferência agendada: pague-a em Contas a Pagar, que é o que move o dinheiro da sua conta para a de investimento. Marcar como paga aqui deixaria o empréstimo quitado sem nada ter saído da conta.",
        },
        { status: 400 }
      );
    }

    const dataDoPagamento =
      typeof data_do_pagamento === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(data_do_pagamento)
        ? data_do_pagamento
        : hojeISO();

    // -----------------------------------------------------------------------
    // A perna de ENTRADA -- e so ela
    // -----------------------------------------------------------------------
    // `transfer` e nao `income`: principal voltando nao e receita. Ver
    // `pernaDeEntradaDoPagamento`, onde esta o porque por extenso.
    const perna = pernaDeEntradaDoPagamento({
      caso,
      contaCredoraId: emprestimo.lender_account_id,
      valor: Number(parcela.amount),
      descricao: emprestimo.description,
      numero: parcela.installment_number,
      total: parcela.installment_total,
    });

    if (!perna) {
      // Inalcancavel hoje (`caso === "auto"` ja saiu acima), e por isso e 500 e
      // nao uma frase de produto: chegar aqui quer dizer que a decisao de pernas
      // e este ramo discordam, e a resposta certa e nao gravar nada.
      console.error(
        "MyBank: pernaDeEntradaDoPagamento devolveu null fora do auto-emprestimo",
        { caso }
      );
      return NextResponse.json(
        { error: "Não foi possível montar o lançamento do recebimento" },
        { status: 500 }
      );
    }

    const { data: servico } = await supabase
      .from("financial_services")
      .select("id")
      .eq("name", "personal_finance")
      .single();

    if (!servico) {
      return NextResponse.json(
        { error: "Serviço de finanças pessoais não encontrado" },
        { status: 404 }
      );
    }

    const { data: categoria } = await supabase
      .from("transaction_categories")
      .select("id")
      .eq("service_id", servico.id)
      .eq("name", NOME_DA_CATEGORIA_DE_TRANSFERENCIA)
      .maybeSingle();

    if (!categoria?.id) {
      console.error(
        `A categoria "${NOME_DA_CATEGORIA_DE_TRANSFERENCIA}" nao esta legivel no banco. ` +
          "Aplique database/migrations/023_categoria_de_transferencia.sql."
      );
      return NextResponse.json(
        {
          error:
            "A categoria reservada de transferência não está no banco. Nada foi lançado.",
        },
        { status: 500 }
      );
    }

    const { data: lancamento, error: erroDaPerna } = await supabase
      .from("financial_transactions")
      .insert({
        user_id: user.id,
        service_id: servico.id,
        category_id: categoria.id,
        group_id: null,
        is_shared: false,
        transaction_date: dataDoPagamento,
        // A chave canonica do elo, a mesma convencao do `acerto:<id>` da
        // HMO-366: sem ela nao ha como achar a perna a partir da parcela depois.
        notes: chaveDaParcelaDoMyBank(parcela.id),
        ...perna,
      })
      .select("id")
      .single();

    if (erroDaPerna || !lancamento) {
      console.error("Erro ao lancar a entrada do recebimento:", erroDaPerna);
      return NextResponse.json(
        { error: "Não foi possível lançar o recebimento. A parcela continua em aberto." },
        { status: 500 }
      );
    }

    const { data: pagas, error: erroDaBaixa } = await supabase
      .from("mybank_installments")
      .update({
        status: "paid",
        paid_date: dataDoPagamento,
        paid_transaction_id: lancamento.id,
      })
      .eq("id", parcela.id)
      .select("id, status");

    if (erroDaBaixa || !pagas || pagas.length === 0) {
      // A PERNA JA ESTA GRAVADA, e desfaze-la seria apagar dinheiro que entrou
      // de verdade na conta. O que falhou foi a baixa da parcela: o estado
      // honesto e "o dinheiro entrou e a parcela continua em aberto", com o id
      // do lancamento na resposta para quem for consertar.
      console.error("Erro ao dar baixa na parcela do MyBank:", erroDaBaixa);
      return NextResponse.json(
        {
          error:
            "O recebimento foi lançado, mas a parcela não foi baixada. Tente confirmar de novo.",
          transaction_id: lancamento.id,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      status: "paid",
      transaction_id: lancamento.id,
      paid_date: dataDoPagamento,
      message:
        "Parcela baixada. O valor entrou na conta de investimento como transferência — principal voltando não é receita.",
    });
  } catch (error) {
    console.error("MyBank installments PATCH error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
