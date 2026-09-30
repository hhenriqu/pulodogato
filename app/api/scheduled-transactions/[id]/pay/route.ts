// POST   /api/scheduled-transactions/{id}/pay   da baixa: vira transacao real
// DELETE /api/scheduled-transactions/{id}/pay   estorna a baixa
//
// Este e o unico ponto em que uma conta prevista vira dinheiro de verdade.
// Duas coisas importam aqui:
//
// 1. O saldo da conta e os saldos do grupo sao mantidos por TRIGGER em
//    financial_transactions (update_account_balance, sync_transaction_with_group,
//    auto_create_group_transaction). Entao a baixa so precisa inserir a
//    transacao - refazer a divisao do grupo na mao, como faz a rota antiga de
//    personal-finance, criaria split em dobro.
//
// 2. Nao ha transacao de banco entre os dois passos (o supabase-js fala
//    PostgREST, uma requisicao por vez). A ordem foi escolhida para que a
//    falha no meio seja a menos ruim: primeiro cria a transacao, depois marca
//    a conta como paga. Se o segundo passo falhar, a transacao criada e
//    apagada em seguida - e o pior caso vira "nao deu baixa", que o usuario
//    ve e refaz, em vez de "conta marcada como paga sem dinheiro nenhum
//    lancado", que ninguem percebe.
//
// 3. FATURA DE CARTAO NAO E DESPESA (HMO-149). Quando a conta prevista e a
//    fatura de um cartao, pagar nao gasta: a compra ja foi a despesa. A baixa
//    grava DUAS pernas 'transfer' -- o dinheiro sai da conta pagadora e a
//    divida do cartao e quitada. O porque de cada decisao esta em
//    lib/card-invoice.ts, junto dos testes. Aqui fica so a sequencia de
//    escrita, que tem tres passos em vez de dois e por isso um desfazimento
//    a mais.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getServiceId, valorComSinal } from "@/lib/services/scheduled";
import { isIsoDate, today } from "@/lib/recurrence";
import {
  faturaDaChave,
  validarContaPagadora,
  mensagemContaPagadora,
  pernasDoPagamentoDeFatura,
} from "@/lib/card-invoice";

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
    const paid_date = body.paid_date ?? today();
    // A conta de luz quase nunca fecha no valor previsto: a baixa aceita o
    // valor real e mantem o previsto na linha, para o relatorio de desvio.
    const valorPago = body.amount != null ? Math.abs(Number(body.amount)) : null;

    if (!isIsoDate(paid_date)) {
      return NextResponse.json(
        { error: "Data de pagamento deve estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    if (valorPago != null && !(valorPago > 0)) {
      return NextResponse.json(
        { error: "Valor pago deve ser maior que zero" },
        { status: 400 }
      );
    }

    const { data: conta } = await supabase
      .from("scheduled_transactions")
      .select("*, recurring_rule:recurring_rules(transaction_type)")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .single();

    if (!conta) {
      return NextResponse.json(
        { error: "Conta prevista não encontrada" },
        { status: 404 }
      );
    }

    if (conta.status === "paid") {
      return NextResponse.json(
        { error: "Esta conta já foi paga" },
        { status: 409 }
      );
    }

    if (conta.status === "cancelled") {
      return NextResponse.json(
        { error: "Esta conta foi cancelada" },
        { status: 409 }
      );
    }

    const serviceId = await getServiceId(supabase);
    if (!serviceId) {
      return NextResponse.json(
        { error: "Serviço de finanças pessoais não encontrado" },
        { status: 404 }
      );
    }

    // ---------------------------------------------------------------
    // Caminho da fatura de cartao: transferencia, nao despesa (HMO-149)
    // ---------------------------------------------------------------
    // A deteccao e pela chave canonica em `notes`, nunca pelo tipo da conta.
    // A assinatura cobrada no cartao tambem tem `account_id` de cartao, e
    // pagar aquela conta com o cartao e despesa de verdade -- detectar por
    // `account_type` faria toda assinatura de cartao desaparecer do relatorio.
    const fatura = faturaDaChave(conta.notes);
    if (fatura) {
      return await pagarFatura({
        supabase,
        userId: user.id,
        serviceId,
        conta,
        cartaoId: fatura.accountId,
        contaPagadoraId: body.payment_account_id,
        valorPago,
        paid_date,
        scheduledId: params.id,
      });
    }

    // A DIRECAO: OCORRENCIA, DEPOIS REGRA, DEPOIS 'expense' (HMO-188, 027)
    //
    // Antes da 027 esta linha era `conta.recurring_rule?.transaction_type ??
    // "expense"`, e o `??` era um caminho de perda silenciosa: uma previsao
    // AVULSA nao tem regra, entao ela caia sempre em 'expense'. Enquanto a unica
    // tela que criava avulsa era /dashboard/bills (so conta a pagar) isso nao
    // machucava. Com a tela de receita podendo criar uma receita prevista,
    // confirmar o recebimento de R$ 7.000 gravaria `-7000`: o salario entrando
    // TIRANDO dinheiro da conta, com valor, descricao e categoria certos, e a
    // tela dizendo que deu tudo certo.
    //
    // A ocorrencia vem PRIMEIRO porque ela e a excecao deliberada -- um mes em
    // que a regra de despesa virou estorno, por exemplo. A regra vem depois
    // porque e ela que manda nas ocorrencias geradas por ela (editar a regra
    // reaponta as futuras, e uma copia por ocorrencia congelaria a antiga). O
    // 'expense' final so alcanca linha anterior a 027 cujo backfill nao pegou.
    //
    // A MESMA precedencia esta na coluna `direction` de
    // `scheduled_transactions_effective`, que e o que as telas leem. As duas tem
    // de concordar: se divergirem, a tela mostra "a receber" e a baixa grava
    // despesa.
    const tipo =
      conta.transaction_type ??
      conta.recurring_rule?.transaction_type ??
      "expense";
    const valor = valorComSinal(valorPago ?? Number(conta.amount), tipo);

    const { data: transacao, error: erroTransacao } = await supabase
      .from("financial_transactions")
      .insert({
        user_id: user.id,
        service_id: serviceId,
        category_id: conta.category_id,
        account_id: conta.account_id,
        group_id: conta.group_id,
        description: conta.description,
        amount: valor,
        transaction_date: paid_date,
        transaction_type: tipo,
        notes: conta.notes,
        // AS DUAS DATAS SOBREVIVEM A BAIXA (HMO-188, 027)
        //
        // Sem estas linhas a informacao se perderia exatamente no momento em que
        // ela passa a ter valor: a conta previa o dia 5, foi paga no dia 12, e a
        // transacao resultante nao teria como dizer que houve atraso -- o
        // `due_date` fica na linha da agenda e a tela de lancamentos le a
        // transacao.
        //
        // `launch_date` sai do dia em que a PREVISAO foi criada, e nao de hoje:
        // a pessoa anotou aquela conta quando a cadastrou. Deixar o DEFAULT
        // CURRENT_DATE agir aqui diria que o aluguel de marco foi anotado no dia
        // em que ele foi pago.
        expected_date: conta.due_date,
        launch_date: conta.created_at
          ? String(conta.created_at).slice(0, 10)
          : paid_date,
      })
      .select()
      .single();

    if (erroTransacao || !transacao) {
      console.error("Erro ao lançar a transação da baixa:", erroTransacao);
      return NextResponse.json(
        { error: "Não foi possível lançar a transação" },
        { status: 500 }
      );
    }

    const { data: baixada, error: erroBaixa } = await supabase
      .from("scheduled_transactions")
      .update({
        status: "paid",
        paid_date,
        transaction_id: transacao.id,
      })
      .eq("id", params.id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (erroBaixa || !baixada) {
      // Desfaz o lançamento para não deixar dinheiro solto sem conta
      // correspondente. O DELETE também reverte o saldo, pelo mesmo trigger.
      await supabase.from("financial_transactions").delete().eq("id", transacao.id);
      console.error("Baixa desfeita: não foi possível marcar a conta como paga", erroBaixa);
      return NextResponse.json(
        { error: "Não foi possível dar baixa na conta prevista" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      // A palavra muda com a direcao (HMO-188). "Baixa registrada" numa receita
      // se le como "a conta foi paga", e o que aconteceu foi um recebimento --
      // era esse o defeito que a issue nomeia ("a receita ele deve confirmar que
      // recebeu").
      message:
        tipo === "income" ? "Recebimento confirmado" : "Pagamento confirmado",
      scheduled: baixada,
      transaction: transacao,
      // A tela usa isto para o rotulo e para o icone. Sai da rota e nao e
      // recalculado la: a precedencia da direcao tem UM dono.
      direction: tipo,
    });
  } catch (error) {
    console.error("Erro ao dar baixa:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/**
 * Baixa da fatura de cartao: transferencia em duas pernas (HMO-149).
 *
 * Tres escritas onde a baixa comum tem duas, e cada falha desfaz o que ja
 * entrou. A ordem segue o mesmo principio do resto da rota -- o pior caso tem
 * que ser "nao deu baixa", que o usuario ve e refaz, nunca "metade da
 * transferencia no saldo", que ninguem percebe:
 *
 *   1. perna de saida  (-total na conta pagadora)
 *   2. perna de entrada (+total no cartao, apontando para a de saida)
 *      falhou? apaga a saida.
 *   3. marca a conta prevista como paga, apontando para a perna de SAIDA
 *      (e onde o dinheiro saiu). falhou? apaga as duas pernas.
 */
async function pagarFatura(params: {
  // O tipo do cliente do supabase-js so aparece na assinatura de createClient;
  // repetir o generico aqui nao acrescenta prova nenhuma.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  serviceId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conta: any;
  cartaoId: string;
  contaPagadoraId: unknown;
  valorPago: number | null;
  paid_date: string;
  scheduledId: string;
}): Promise<NextResponse> {
  const {
    supabase,
    userId,
    serviceId,
    conta,
    cartaoId,
    valorPago,
    paid_date,
    scheduledId,
  } = params;

  const contaPagadoraId =
    typeof params.contaPagadoraId === "string" && params.contaPagadoraId
      ? params.contaPagadoraId
      : null;

  if (!contaPagadoraId) {
    return NextResponse.json(
      {
        error: mensagemContaPagadora("ausente"),
        // A tela precisa distinguir "faltou um campo" de "a conta escolhida
        // nao serve" para saber se abre o seletor ou mostra o erro nele.
        needs_payment_account: true,
      },
      { status: 400 }
    );
  }

  const { data: pagadora } = await supabase
    .from("financial_accounts")
    .select("id, name, account_type")
    .eq("id", contaPagadoraId)
    .eq("user_id", userId)
    .maybeSingle();

  // `?? null` de proposito: `null` quer dizer "id informado que a busca nao
  // achou", e `undefined` quer dizer "nao informado" -- ja tratado acima.
  const problema = validarContaPagadora(pagadora ?? null, cartaoId);
  if (problema) {
    return NextResponse.json(
      { error: mensagemContaPagadora(problema), needs_payment_account: true },
      { status: 400 }
    );
  }

  const { saida, entrada } = pernasDoPagamentoDeFatura({
    valor: valorPago ?? Number(conta.amount),
    cartaoId,
    contaPagadoraId: pagadora.id,
    descricao: conta.description,
  });

  // `group_id: null` nas duas pernas, mesmo que a conta prevista tenha grupo.
  // Transferencia entre contas proprias nao e despesa compartilhada, e os
  // triggers de grupo (sync_transaction_with_group, auto_create_group_transaction)
  // criariam rateio para ela -- cobrando dos outros membros um valor que eles
  // ja rateiam nas COMPRAS, que e onde a despesa esta.
  const comum = {
    user_id: userId,
    service_id: serviceId,
    category_id: conta.category_id,
    group_id: null,
    transaction_date: paid_date,
    notes: conta.notes,
  };

  const { data: txSaida, error: erroSaida } = await supabase
    .from("financial_transactions")
    .insert({ ...comum, ...saida })
    .select()
    .single();

  if (erroSaida || !txSaida) {
    console.error("Erro ao lançar a saída do pagamento da fatura:", erroSaida);
    return NextResponse.json(
      { error: "Não foi possível lançar o pagamento da fatura" },
      { status: 500 }
    );
  }

  const { data: txEntrada, error: erroEntrada } = await supabase
    .from("financial_transactions")
    .insert({ ...comum, ...entrada, counterpart_transaction_id: txSaida.id })
    .select()
    .single();

  if (erroEntrada || !txEntrada) {
    await supabase.from("financial_transactions").delete().eq("id", txSaida.id);
    console.error(
      "Pagamento desfeito: não foi possível quitar a dívida do cartão",
      erroEntrada
    );
    return NextResponse.json(
      {
        error:
          "Não foi possível quitar o cartão. Nada foi lançado — tente novamente.",
      },
      { status: 500 }
    );
  }

  const { data: baixada, error: erroBaixa } = await supabase
    .from("scheduled_transactions")
    .update({ status: "paid", paid_date, transaction_id: txSaida.id })
    .eq("id", scheduledId)
    .eq("user_id", userId)
    .select()
    .single();

  if (erroBaixa || !baixada) {
    // A entrada primeiro: ela aponta para a saida, e o FK e ON DELETE SET
    // NULL. Apagar a saida antes deixaria a entrada sem elo nenhum -- uma
    // perna de transferencia solta no saldo do cartao, sem nada que diga de
    // onde veio.
    await supabase.from("financial_transactions").delete().eq("id", txEntrada.id);
    await supabase.from("financial_transactions").delete().eq("id", txSaida.id);
    console.error(
      "Baixa desfeita: não foi possível marcar a fatura como paga",
      erroBaixa
    );
    return NextResponse.json(
      { error: "Não foi possível dar baixa na fatura" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    message: `Fatura paga com ${pagadora.name}`,
    scheduled: baixada,
    transaction: txSaida,
    counterpart: txEntrada,
    // A tela mostra isso: pagar a fatura nao muda o patrimonio, e quem ve o
    // numero parado depois de pagar R$ 1.000 precisa saber que esta certo.
    is_transfer: true,
  });
}

export async function DELETE(
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

    const { data: conta } = await supabase
      .from("scheduled_transactions")
      .select("status, transaction_id")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .single();

    if (!conta) {
      return NextResponse.json(
        { error: "Conta prevista não encontrada" },
        { status: 404 }
      );
    }

    if (conta.status !== "paid") {
      return NextResponse.json(
        { error: "Esta conta não está paga" },
        { status: 409 }
      );
    }

    // A perna oposta, quando a baixa foi de fatura (HMO-149). Procurada ANTES
    // de qualquer DELETE: o elo mora na perna de entrada e o FK e ON DELETE
    // SET NULL, entao apagar a saida primeiro zeraria o elo e a entrada ficaria
    // sozinha no saldo do cartao -- o cartao quitado sem fatura paga, que e
    // pior que nao ter estornado.
    let pernaOposta: string | null = null;
    if (conta.transaction_id) {
      const { data: oposta } = await supabase
        .from("financial_transactions")
        .select("id")
        .eq("counterpart_transaction_id", conta.transaction_id)
        .eq("user_id", user.id)
        .maybeSingle();
      pernaOposta = oposta?.id ?? null;
    }

    // Ordem inversa da baixa: solta a conta primeiro. A constraint
    // scheduled_transactions_paid_check exige que paid_date e transaction_id
    // saiam junto com o status - e o FK e ON DELETE SET NULL, entao apagar a
    // transacao antes deixaria a linha em 'paid' com transaction_id NULL,
    // exatamente o estado que a constraint existe para impedir.
    const { error: erroSolta } = await supabase
      .from("scheduled_transactions")
      .update({ status: "pending", paid_date: null, transaction_id: null })
      .eq("id", params.id)
      .eq("user_id", user.id);

    if (erroSolta) {
      console.error("Erro ao estornar a baixa:", erroSolta);
      return NextResponse.json(
        { error: "Não foi possível estornar a baixa" },
        { status: 500 }
      );
    }

    if (pernaOposta) {
      const { error: erroOposta } = await supabase
        .from("financial_transactions")
        .delete()
        .eq("id", pernaOposta)
        .eq("user_id", user.id);

      if (erroOposta) {
        console.error("Conta estornada, mas a perna do cartão ficou:", erroOposta);
        return NextResponse.json(
          {
            error:
              "Conta voltou para pendente, mas a quitação do cartão não pôde ser removida. Exclua manualmente em Transações.",
            transaction_id: pernaOposta,
          },
          { status: 500 }
        );
      }
    }

    if (conta.transaction_id) {
      const { error: erroDelete } = await supabase
        .from("financial_transactions")
        .delete()
        .eq("id", conta.transaction_id)
        .eq("user_id", user.id);

      if (erroDelete) {
        // A conta ja voltou para pendente; avisar e melhor do que fingir que
        // deu certo, porque o valor continua contando no saldo.
        console.error("Conta estornada, mas a transação não foi apagada:", erroDelete);
        return NextResponse.json(
          {
            error:
              "Conta voltou para pendente, mas a transação original não pôde ser removida. Exclua manualmente em Transações.",
            transaction_id: conta.transaction_id,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ message: "Baixa estornada" });
  } catch (error) {
    console.error("Erro ao estornar baixa:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
