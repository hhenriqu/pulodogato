// ---------------------------------------------------------------------------
// A BAIXA DE UMA TRANSFERENCIA PREVISTA -- as duas pernas, a parcela do MyBank
// e a previsao, nesta ordem, com os desfazimentos (HMO-396)
// ---------------------------------------------------------------------------
// ESTE ARQUIVO NAO E CODIGO NOVO. Ele e o passo 2 + 2.5 + 3 de
// `app/api/scheduled-transactions/[id]/pay/route.ts`, movido inteiro para que a
// antecipacao do Caso A (`/api/mybank/loans/[id]/antecipacao`) o CHAME em vez
// de reescrever.
//
// POR QUE MOVER, E NAO COPIAR AS QUARENTA LINHAS
// ----------------------------------------------
// A ordem das escritas e os desfazimentos SAO a feature, e cada decisao aqui
// tem um motivo que e dinheiro:
//
//   * a entrada e apagada ANTES da saida, porque e a entrada que aponta para a
//     saida e o FK e ON DELETE SET NULL;
//   * a parcela do MyBank vira `paid` DEPOIS das pernas (o FK de
//     `paid_transaction_id`) e ANTES da baixa da previsao (para que a falha no
//     meio seja "nao deu baixa", e nao "dinheiro movido e previsao pendente");
//   * a baixa que a RLS FILTRA responde 200 com `[]`, e por isso a contagem e
//     conferida em vez do erro.
//
// Duas copias disso divergiriam na primeira mudanca, e o sintoma seria
// `soma-que-nao-fecha-tem-defeito-oposto-nas-duas-funcoes`: a antecipacao
// desfazendo numa ordem e a baixa noutra, as duas passando verde na suite de
// cada uma. A decisao tem UM dono, como a regra de sinal tem um dono em
// `pernasDaTransferencia`.
//
// E E POR ISSO QUE A FUNCAO NAO DEVOLVE `NextResponse`
// ---------------------------------------------------
// Os dois chamadores respondem coisas diferentes sobre o MESMO resultado: a
// rota da baixa devolve a previsao baixada e as duas pernas, e a antecipacao
// soma N destes resultados numa frase que conta quantas parcelas entraram. Um
// `NextResponse` aqui obrigaria a antecipacao a LER a resposta da outra rota
// para decidir se continua o laco -- e o `status` de uma resposta e um canal
// pior do que um campo, porque ele some no primeiro `catch`.
//
// A PARCELA DO MYBANK E OPCIONAL, E ISSO E O CASO COMUM
// ----------------------------------------------------
// A maioria das transferencias previstas nao e parcela de emprestimo nenhum:
// `parcela: null` pula o passo 2.5 e a funcao e a baixa de uma transferencia
// comum. Quem decide se o elo vale (chave inteira, parcela existente, estado
// que aceita a baixa) e quem chama -- a decisao ja tinha dono em
// `parcelaDaChaveDoMyBank` + `parcelaSegueABaixaDaPrevisao`, e trazer a leitura
// para ca faria esta funcao consultar o banco por uma pergunta que o chamador
// ja respondeu.
// ---------------------------------------------------------------------------

import {
  patchDaBaixaDaParcela,
  patchDaBaixaDaPrevisao,
  patchDoEstornoDaParcela,
} from "@/lib/emprestimo-do-mybank";
import { pernasDaTransferencia } from "@/lib/transferencia";

/** A linha de `scheduled_transactions` que esta baixa fecha. */
export interface ContaPrevistaABaixar {
  id: string;
  account_id: string;
  destination_account_id: string | null;
  description: string;
  amount: number;
  due_date: string;
  category_id: string | null;
  notes: string | null;
  created_at?: string | null;
}

/** A parcela do MyBank que esta baixa leva a `paid`, quando ha uma. */
export interface ParcelaDaBaixa {
  id: string;
}

export type ResultadoDaBaixaDaPrevisao =
  | {
      ok: true;
      /** A perna NEGATIVA, na conta de origem. E ela que a previsao aponta. */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      txSaida: any;
      /** A perna POSITIVA, na conta de destino. E ela que a parcela aponta. */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      txEntrada: any;
      /** A linha da previsao depois do UPDATE. */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      baixada: any;
    }
  | {
      ok: false;
      erro: string;
      /** O HTTP que a rota da baixa devolvia para este mesmo caminho. */
      status: number;
      /**
       * Onde parou. A antecipacao NAO usa isto para decidir nada -- ela para o
       * laco em qualquer falha --, e ele existe para o `console.error` de quem
       * chama poder dizer qual passo foi, sem reconstruir isso da frase.
       */
      parouEm: "saida" | "entrada" | "parcela" | "previsao";
    };

/**
 * Move o dinheiro de uma transferencia prevista e baixa tudo o que ela fecha.
 *
 * A ORDEM, e ela e a mesma de antes desta extracao:
 *
 *   1. perna de SAIDA  (-valor na origem);
 *   2. perna de ENTRADA (+valor no destino, apontando para a de saida).
 *      falhou? apaga a saida;
 *   3. a parcela do MyBank vira `paid`, apontando para a perna de ENTRADA.
 *      falhou? apaga as duas pernas (a previsao ainda nao foi baixada, entao o
 *      mundo volta ao estado de antes do clique);
 *   4. a previsao vira `paid`, apontando para a perna de SAIDA.
 *      falhou? apaga as duas pernas E devolve a parcela a `pending`.
 *
 * O passo 4 aponta para a SAIDA de proposito: e o que faz o estorno funcionar
 * de graca (o DELETE da rota da baixa acha a contraparte por
 * `counterpart_transaction_id = conta.transaction_id`, e esse elo mora na perna
 * de entrada apontando para a de saida). Ver `patchDaBaixaDaPrevisao`.
 */
export async function baixaDaTransferenciaPrevista(params: {
  // O tipo do cliente do supabase-js so aparece na assinatura de createClient;
  // repetir o generico aqui nao acrescenta prova nenhuma.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  serviceId: string;
  conta: ContaPrevistaABaixar;
  /** O valor que de fato se move. `null` usa o `amount` da previsao. */
  valorPago: number | null;
  paidDate: string;
  /** A parcela a levar a `paid`, ou `null` numa transferencia comum. */
  parcela: ParcelaDaBaixa | null;
}): Promise<ResultadoDaBaixaDaPrevisao> {
  const { supabase, userId, serviceId, conta, valorPago, parcela } = params;
  const paid_date = params.paidDate;
  // A LINHA A BAIXAR E `conta`, E O ID SAI DELA. Receber o id por fora daria
  // duas fontes para "qual previsao baixar", e o dia em que elas divergissem o
  // UPDATE acertaria outra linha -- com as pernas lancadas pela conta deste
  // pedido, e a previsao de verdade seguindo pendente.
  const scheduledId = conta.id;

  // `fechaOCicloDoMyBank` CONTINUA SENDO UMA VARIAVEL, e nao `parcela !== null`
  // escrito nos tres lugares: o nome e o que diz, em cada um dos tres, que
  // aquele passo e o ciclo do Caso A fechando e nao uma defesa contra `null`.
  const fechaOCicloDoMyBank = parcela !== null;
  const parcelaDoMyBank = parcela;

  const { saida, entrada } = pernasDaTransferencia({
    // A baixa aceita valor diferente do previsto, como a comum: o CHECK do banco
    // e `amount > 0` e `valorPago` ja veio por `Math.abs`.
    valor: valorPago ?? Number(conta.amount),
    origemId: conta.account_id,
    destinoId: conta.destination_account_id as string,
    descricao: conta.description,
  });

  // `group_id: null` e `is_shared: false` nas duas pernas, mesmo que a conta
  // prevista tenha grupo -- igual a rota da transferencia pontual. Transferencia
  // entre contas proprias nao e despesa compartilhada, e os triggers de grupo
  // (sync_transaction_with_group, auto_create_group_transaction) criariam rateio
  // para ela, cobrando dos outros membros um valor que eles ja rateiam nas
  // COMPRAS.
  const comum = {
    user_id: userId,
    service_id: serviceId,
    category_id: conta.category_id,
    group_id: null,
    is_shared: false,
    transaction_date: paid_date,
    notes: conta.notes,
    // As duas datas sobrevivem a baixa, como na comum (027): `expected_date`
    // guarda o dia previsto e `launch_date` o dia em que a previsao foi criada.
    // Sem elas a transferencia prevista para o dia 5 e feita no dia 12 nao teria
    // como dizer que atrasou.
    expected_date: conta.due_date,
    launch_date: conta.created_at
      ? String(conta.created_at).slice(0, 10)
      : paid_date,
  };

  const { data: txSaida, error: erroSaida } = await supabase
    .from("financial_transactions")
    .insert({ ...comum, ...saida })
    .select()
    .single();

  if (erroSaida || !txSaida) {
    console.error("Erro ao lançar a saída da transferência prevista:", erroSaida);
    return {
      ok: false,
      erro: "Não foi possível lançar a transferência",
      status: 500,
      parouEm: "saida",
    };
  }

  const { data: txEntrada, error: erroEntrada } = await supabase
    .from("financial_transactions")
    .insert({ ...comum, ...entrada, counterpart_transaction_id: txSaida.id })
    .select()
    .single();

  if (erroEntrada || !txEntrada) {
    await supabase.from("financial_transactions").delete().eq("id", txSaida.id);
    console.error(
      "Transferência desfeita: a perna de entrada não entrou",
      erroEntrada
    );
    return {
      ok: false,
      erro:
        "Não foi possível completar a transferência. Nada foi lançado — tente novamente.",
      status: 500,
      parouEm: "entrada",
    };
  }

  // PASSO 2.5 -- a parcela do MyBank vira `paid` (HMO-382). Ver o cabecalho
  // desta funcao para a posicao; aqui fica o porque de cada detalhe.
  if (fechaOCicloDoMyBank && parcelaDoMyBank) {
    const { data: parcelasBaixadas, error: erroDaParcela } = await supabase
      .from("mybank_installments")
      // O elo aponta para a perna de ENTRADA -- a positiva, a da conta de
      // investimento. Ver `patchDaBaixaDaParcela`: e a mesma coluna que no Caso
      // B guarda a entrada que o credor lanca, e apontar para a saida faria ela
      // querer dizer coisas opostas nos dois casos.
      .update(
        patchDaBaixaDaParcela({
          paidDate: paid_date,
          pernaDeEntradaId: txEntrada.id,
        })
      )
      .eq("id", parcelaDoMyBank.id)
      .select("id, status");

    // `.select()` E A CONTAGEM NAO SAO DECORACAO. Um UPDATE que a policy nao
    // deixa casar responde 200 com corpo vazio -- a RLS FILTRA em vez de recusar
    // --, entao sem conferir a contagem esta rota diria "parcela paga" sobre um
    // UPDATE que alcancou zero linha. O caminho e real aqui: a trigger
    // `mybank_installments_trava_do_devedor` (053) tambem recusa, e com
    // excecao, se quem clicou nao for o credor.
    if (erroDaParcela || !parcelasBaixadas || parcelasBaixadas.length === 0) {
      // NADA FICA GRAVADO. A previsao ainda nao foi baixada (este passo vem
      // antes), entao desfazer as duas pernas devolve o mundo ao estado de
      // antes do clique -- "nao deu baixa", que a pessoa ve e refaz. A ordem e a
      // mesma do passo 3: a entrada primeiro, porque e ela que aponta para a
      // saida e o FK e ON DELETE SET NULL.
      await supabase.from("financial_transactions").delete().eq("id", txEntrada.id);
      await supabase.from("financial_transactions").delete().eq("id", txSaida.id);
      console.error(
        "Baixa desfeita: a parcela do MyBank não pôde ser marcada como paga",
        erroDaParcela
      );
      return {
        ok: false,
        erro:
          "Não foi possível baixar a parcela do MyBank. Nada foi lançado — tente novamente.",
        status: 500,
        parouEm: "parcela",
      };
    }
  }

  const { data: baixada, error: erroBaixa } = await supabase
    .from("scheduled_transactions")
    .update(patchDaBaixaDaPrevisao({ paidDate: paid_date, pernaDeSaidaId: txSaida.id }))
    .eq("id", scheduledId)
    .eq("user_id", userId)
    .select()
    .single();

  if (erroBaixa || !baixada) {
    // A entrada primeiro: ela aponta para a saida, e o FK e ON DELETE SET NULL.
    // Apagar a saida antes deixaria a entrada sem elo nenhum -- uma perna solta
    // no saldo do destino, sem nada que diga de onde veio.
    await supabase.from("financial_transactions").delete().eq("id", txEntrada.id);
    await supabase.from("financial_transactions").delete().eq("id", txSaida.id);

    // E a parcela volta com elas. Sem este desfazimento o estorno automatico
    // deixaria o estado pior do que o defeito original: parcela do MyBank paga,
    // previsao pendente e nenhum dinheiro lancado -- emprestimo quitado de
    // graca. O `paid_transaction_id` ja teria ficado NULL pelo FK (ON DELETE SET
    // NULL), mas o `status` NAO volta sozinho.
    if (fechaOCicloDoMyBank && parcelaDoMyBank) {
      const { error: erroDoEstornoDaParcela } = await supabase
        .from("mybank_installments")
        .update(patchDoEstornoDaParcela())
        .eq("id", parcelaDoMyBank.id);

      if (erroDoEstornoDaParcela) {
        console.error(
          "A parcela do MyBank ficou paga sem baixa na previsão:",
          erroDoEstornoDaParcela
        );
      }
    }

    console.error(
      "Baixa desfeita: não foi possível marcar a transferência como feita",
      erroBaixa
    );
    return {
      ok: false,
      erro: "Não foi possível dar baixa na transferência prevista",
      status: 500,
      parouEm: "previsao",
    };
  }

  return { ok: true, txSaida, txEntrada, baixada };
}
