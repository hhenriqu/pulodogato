// ---------------------------------------------------------------------------
// PATCH /api/mybank/loans/[id] -- cancelar OU AJUSTAR um emprestimo em atividade
// ---------------------------------------------------------------------------
// MyBank. O cancelamento e a F3 da HMO-383 (issue HMO-391); o AJUSTE e a F4 da
// HMO-444 (issue HMO-447). SEM MIGRATION nos dois: a 053 ja aceita `cancelled`
// nos dois `status_check`, a policy de UPDATE ja e so do credor, e
// `mybank_loans_trava` de proposito NAO re-exige a conexao num UPDATE que nao
// mexe em `lender_user_id`, `lender_account_id` nem `borrower_user_id` -- os
// dois verbos funcionam mesmo depois de a conexao ser desfeita.
//
// DOIS VERBOS NUM `PATCH` SO, E O DESPACHO E A PRIMEIRA COISA QUE ACONTECE
// -----------------------------------------------------------------------
// Ate a HMO-447 esta rota SO cancelava, e a defesa contra editar o valor da
// divida era a AUSENCIA do caminho: qualquer corpo que nao fosse
// `{"status":"cancelled"}` voltava 400. Aquela defesa foi DERRUBADA DE
// PROPOSITO, porque o custo dela ficou visivel -- um typo na descricao de um
// emprestimo de 24 meses nao tinha conserto pela tela, e a unica saida era
// cancelar a divida inteira e criar outra, o que apaga o historico das parcelas
// ja pagas.
//
// O que substitui a ausencia nao e uma validacao a mais: e a REGRA PURA de
// `ajusteDoEmprestimo`, que decide o que muda em que e nunca devolve patch de
// `installment_number`, `installment_total`, `status`, `paid_date` nem
// `paid_transaction_id` -- e os mutantes que tentam fazer isso morrem na suite.
// A antecipacao (`loans/[id]/antecipacao`) seguiu rota IRMA mesmo assim, e
// segue certa: o gesto dela nao e editar um campo, e criar N lancamentos e dar
// N baixas.
//
// AS DUAS REGRAS PURAS NAO ESTAO AQUI
// -----------------------------------
// `problemaDoCancelamento`, `parcelaSegueOCancelamento`,
// `chavesDasPrevisoesDoCancelamento`, `problemaDoAjuste`, `caudaRecalculada`,
// `ajusteDoEmprestimo`, `previsoesDoAjuste` e as frases vivem em
// `lib/emprestimo-do-mybank.ts`, com o porque de cada uma e com os mutantes
// alcancando-as. Aqui ficam a ordem dos passos e o que se faz quando um deles
// falha -- que e justamente o que funcao pura nenhuma consegue medir.
//
// A ORDEM DO CANCELAMENTO, E ELA E SOBRE DINHEIRO
// -----------------------------------------------
//   1. ler o emprestimo e conferir que o credor sou eu;
//   2. `mybank_loans.status = 'cancelled'` -- as duas leituras filtram
//      `active`, entao a divida sai da tela do credor E da devedora neste passo
//      so, sem leitor novo;
//   3. as parcelas em aberto (`pending`/`reported`) viram `cancelled`. As `paid`
//      FICAM `paid`: elas tem (ou tiveram) perna em `financial_transactions`;
//   4. as previsoes ainda `pending` do Caso A sao apagadas de
//      `scheduled_transactions`, pelo elo `mybank:<id da parcela>`.
//
// Quebrar no meio DESTA ordem deixa previsao orfa em Contas a Pagar -- a pessoa
// e cobrada por algo que nao deve e PERCEBE. A ordem inversa deixaria a divida
// viva sem as contas a pagar: dinheiro subestimado, e ninguem reporta. A direcao
// da falha parcial e escolhida, e o porque por extenso esta no cabecalho da
// secao do cancelamento em `lib/emprestimo-do-mybank.ts`.
//
// A ORDEM DO AJUSTE E A INVERSA, E O MOTIVO E QUE ELA PODE SER REPETIDA
// --------------------------------------------------------------------
//   1. ler o emprestimo e conferir que o credor sou eu, e que ele esta `active`;
//   2. ler as parcelas; recusar em 409 se alguma esta `reported`, NOMEANDO
//      quais; recalcular so as `pending` sobre o que falta receber;
//   2.5. SO NO CASO A: ler as previsoes do elo SEM FILTRAR POR STATUS e recusar,
//      com NADA gravado, se a de alguma parcela `pending` ja foi BAIXADA -- e
//      esta e a guarda de dinheiro desta fase (ver abaixo);
//   3. POR PARCELA: o `amount`/`due_date` dela, e so depois a previsao do Caso A;
//   4. O EMPRESTIMO POR ULTIMO -- `description` e `principal`.
//
// O emprestimo vir por ULTIMO e o oposto do cancelamento, e os dois estao
// certos porque as falhas parciais sao de naturezas diferentes. Lá parar no meio
// deixa um estado que NAO se conserta tentando de novo (o emprestimo ja esta
// `cancelled`, e a segunda chamada cai no 409 de "ja encerrado"). Aqui o corpo
// do pedido diz O ESTADO QUE SE QUER -- "este emprestimo passa a valer X" --,
// entao mandar o MESMO pedido de novo termina o servico: as parcelas que ja
// foram reescritas saem do patch por nao terem mudado, as que faltaram sao
// reescritas, e o emprestimo e atualizado no fim. Parar no meio e um estado
// RECUPERAVEL, e e por isso que `principal` nao e gravado numa passagem que
// parou: ele e a afirmacao de um total que as parcelas ainda nao somam.
//
// E E POR ISSO QUE A PRESENCA DO CAMPO MANDA, E NAO A DIFERENCA. Um contrato de
// "mande o que mudou" faria a segunda tentativa precisar saber o que a primeira
// alcancou. Ver A PRESENCA DO CAMPO MANDA em `ajusteDoEmprestimo`.
//
// A GUARDA DE DINHEIRO DO AJUSTE: A PREVISAO JA BAIXADA DE UMA PARCELA `pending`
// -----------------------------------------------------------------------------
// No Caso A a parcela tem previsao emparelhada pelo elo, e os dois estados podem
// DIVERGIR: a baixa que falhou depois de gravar as pernas, um estorno pela
// metade. A parcela diz `pending` e o dinheiro JA SE MOVEU. Reescrever o
// `amount` dela mexeria num lancamento REALIZADO.
//
// Por isso o passo 2.5 le as previsoes SEM `.eq("status", "pending")` -- ao
// contrario do passo 4 do cancelamento e do passo 2.5 da antecipacao, que
// filtram. O filtro lá protege a linha ja baixada de ser TOCADA; aqui ele
// esconderia justamente a linha que tem de PARAR o pedido: a previsao baixada
// sairia da leitura, a parcela cairia em "sem previsao" (que nao e recusa) e o
// ajuste seguiria. Mesmo elo, criterio oposto, e o oposto e o ponto.
//
// A RLS NAO BASTA, E A RAZAO E MEDIDA
// -----------------------------------
// `mybank_loans_select` e `lender OR borrower`: o DEVEDOR enxerga a linha e
// chega a esta rota com um emprestimo legivel. E UPDATE que a policy filtra
// volta como SUCESSO COM ZERO LINHAS neste app -- 200, corpo `[]`, sem erro e
// sem SQLSTATE (`update-filtrado-pela-rls-vira-sucesso`, medido em producao).
// Entao o credor e conferido DUAS vezes: na linha lida ANTES (para a recusa ter
// frase) e na linha devolvida DEPOIS (para "cancelei" ou "ajustei" nao ser dito
// sobre um UPDATE que alcancou nada).
//
// Do lado da parcela a conferencia e a mesma e por outro motivo tambem:
// `mybank_installments_trava_do_devedor` (053) devolve `NEW` sem perguntar nada
// quando quem escreve e o CREDOR, entao o ajuste do credor passa pela trigger --
// e e a POLICY, que filtra em silencio, a unica coisa entre esta rota e um
// "ajustei 21 parcelas" sobre zero linha escrita.
// ---------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ajusteDoEmprestimo,
  avisadasDaSerie,
  casoDoEmprestimo,
  caudaRecalculada,
  chavesDasPrevisoesDoAjuste,
  chavesDasPrevisoesDoCancelamento,
  ehDataISO,
  faltaReceberDoAjuste,
  jaRecebidoDaSerie,
  juroDepoisDoAjuste,
  mensagemDaPrevisaoJaBaixada,
  mensagemDoAjuste,
  mensagemDoCancelamento,
  mensagemDoProblemaDoAjuste,
  mensagemDoProblemaDoCancelamento,
  parcelaSegueOCancelamento,
  patchDoCancelamentoDaParcela,
  pendentesDaSerie,
  previsoesDoAjuste,
  problemaDoAjuste,
  problemaDoCancelamento,
  problemaDoJuroDoAjuste,
  STATUS_CANCELADO,
  type PedidoDeAjuste,
  type PrevisaoAAjustar,
} from "@/lib/emprestimo-do-mybank";

/** O que os dois verbos desta rota precisam, lido uma vez pelo `PATCH`. */
interface ContextoDoPatch {
  supabase: SupabaseClient;
  user: { id: string };
  loanId: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // CORPO QUE NAO E JSON E 400 E NAO 500. O `await request.json()` ficava
    // dentro do `try` geral do cancelamento e virava "Erro interno do
    // servidor" -- a rota culpando o servidor por um pedido malformado.
    return NextResponse.json(
      { error: "Mande um corpo JSON." },
      { status: 400 }
    );
  }

  const { status } = (body ?? {}) as { status?: string };

  const contexto: ContextoDoPatch = { supabase, user, loanId: params.id };

  // -------------------------------------------------------------------------
  // O DESPACHO. `status` DECIDE, e o unico valor que ele aceita e `cancelled`
  // -------------------------------------------------------------------------
  // `settled` NAO ENTRA, e esta e a unica parte da antiga peneira que sobrevive
  // inteira: quem escreve `settled` sao o PATCH da parcela e a baixa da
  // previsao, pela regra `emprestimoFicouQuitado` (HMO-394). Ele e estado que o
  // CICLO DE PAGAMENTO alcanca, nao que a tela declare -- declara-lo aqui faria
  // um emprestimo com 20 parcelas em aberto sair das duas telas como se tivesse
  // sido pago.
  if (status !== undefined && status !== STATUS_CANCELADO) {
    return NextResponse.json(
      {
        error:
          `Esta rota não escreve o status "${status}". Para encerrar, mande ` +
          '{ "status": "cancelled" }; "settled" é alcançado pelo pagamento das parcelas, não declarado aqui.',
      },
      { status: 400 }
    );
  }

  if (status === STATUS_CANCELADO) {
    return cancelar(contexto);
  }

  // SEM `status`, O PEDIDO E DE AJUSTE. O corpo vazio nao chega a escrever nada:
  // `problemaDoAjuste` devolve `nada_a_ajustar` e a frase diz quais campos
  // existem -- que e o que um cliente com um campo escrito errado precisa ler.
  return ajustar(contexto, (body ?? {}) as PedidoDeAjuste);
}

// ---------------------------------------------------------------------------
// CANCELAR -- o corpo da HMO-391, intacto
// ---------------------------------------------------------------------------
async function cancelar({ supabase, user, loanId }: ContextoDoPatch) {
  try {
    // -----------------------------------------------------------------------
    // 1. O emprestimo, e o credor conferido ANTES
    // -----------------------------------------------------------------------
    const { data: emprestimo } = await supabase
      .from("mybank_loans")
      .select("id, lender_user_id, borrower_user_id, description, status")
      .eq("id", loanId)
      .maybeSingle();

    if (!emprestimo) {
      // 404 e nao 403: a policy de SELECT deixa os dois lados verem a linha,
      // entao "nao achei" aqui quer dizer que o emprestimo nao e meu nem e uma
      // divida minha. Dizer "existe mas nao e seu" confirmaria a existencia do
      // id para quem o chutou.
      return NextResponse.json(
        { error: "Empréstimo não encontrado" },
        { status: 404 }
      );
    }

    const problema = problemaDoCancelamento({ emprestimo, meuId: user.id });

    if (problema) {
      // 403 para "nao e seu" e 409 para "ja encerrado": os dois sao recusas
      // EXPLICITAS, que e o ponto da issue -- o devedor nao pode receber
      // "cancelado com sucesso" de um UPDATE que a RLS filtrou.
      return NextResponse.json(
        { error: mensagemDoProblemaDoCancelamento(problema) },
        {
          status: problema === "nao_sou_o_credor" ? 403 : 409,
        }
      );
    }

    const caso = casoDoEmprestimo({
      lenderUserId: emprestimo.lender_user_id,
      borrowerUserId: emprestimo.borrower_user_id,
    });

    const { data: parcelas, error: erroDaLeituraDasParcelas } = await supabase
      .from("mybank_installments")
      .select("id, status")
      .eq("loan_id", emprestimo.id);

    if (erroDaLeituraDasParcelas) {
      console.error(
        "Erro ao ler as parcelas do emprestimo a cancelar:",
        erroDaLeituraDasParcelas
      );
      return NextResponse.json(
        { error: "Não foi possível ler as parcelas. Nada foi cancelado." },
        { status: 500 }
      );
    }

    // O NOME DE QUEM DEIXA DE SER COBRADO, LIDO ANTES DE QUALQUER ESCRITA
    //
    // A resposta tem de dizer o que mudou nos DOIS lados ("a divida saiu das
    // despesas de <nome>"), e o nome vem de uma consulta propria -- nao de um
    // embed, que a RLS descartaria a linha inteira em vez de devolver `null`
    // (`embed-nulo-pela-rls-vira-linha-descartada`).
    //
    // E ela e feita AGORA, nao no fim: `profiles` e alcancado pela
    // `profiles_select_connected` (010), e desfazer a conexao antes de cancelar
    // deixa o perfil ilegivel. Perfil ilegivel vira nome `null` e a frase tem
    // alternativa para isso; o que nao pode e uma leitura capaz de falhar
    // DEPOIS de a divida ja estar encerrada.
    let nomeDoDevedor: string | null = null;
    if (caso === "conexao") {
      const { data: perfil } = await supabase
        .from("profiles")
        .select("id, full_name, nickname")
        .eq("id", emprestimo.borrower_user_id)
        .maybeSingle();

      nomeDoDevedor = perfil?.nickname || perfil?.full_name || null;
    }

    const todas = parcelas ?? [];
    // `parcelaSegueOCancelamento` e quem decide, e ela esta na lib: um
    // `filter(p => p.status !== "paid")` aqui teria o mesmo efeito hoje e
    // incluiria as `cancelled` numa segunda chamada.
    const aCancelar = todas.filter(parcelaSegueOCancelamento);
    const quantasPagas = todas.filter((p) => p.status === "paid").length;

    // -----------------------------------------------------------------------
    // 2. O emprestimo vira `cancelled` -- e a divida sai das DUAS telas aqui
    // -----------------------------------------------------------------------
    const { data: cancelados, error: erroDoCancelamento } = await supabase
      .from("mybank_loans")
      .update({ status: STATUS_CANCELADO })
      .eq("id", emprestimo.id)
      .select("id, lender_user_id, status");

    // `.select()` NAO E DECORACAO. Ver o cabecalho: sem a contagem, zero linha
    // alcancada responderia sucesso.
    if (erroDoCancelamento || !cancelados || cancelados.length === 0) {
      console.error("Erro ao cancelar o emprestimo do MyBank:", erroDoCancelamento);
      return NextResponse.json(
        { error: "Não foi possível cancelar o empréstimo. Nada foi alterado." },
        { status: 500 }
      );
    }

    // A LINHA DEVOLVIDA, CONFERIDA DEPOIS.
    //
    // A pergunta do passo 1 foi feita sobre a linha LIDA; esta e sobre a linha
    // ESCRITA, e as duas podem divergir -- um `.eq("id")` sobre um id que mudou
    // de dono entre as duas chamadas, ou uma policy futura mais frouxa. Barato,
    // e e a unica conferencia que fala do UPDATE que de fato aconteceu.
    if (cancelados.some((l) => l.lender_user_id !== user.id)) {
      console.error(
        "MyBank: o UPDATE do cancelamento alcancou linha que nao e do credor.",
        { loanId: emprestimo.id }
      );
      return NextResponse.json(
        { error: "Não foi possível cancelar o empréstimo." },
        { status: 500 }
      );
    }

    // -----------------------------------------------------------------------
    // 3. As parcelas em aberto. As `paid` nao entram no `.in`
    // -----------------------------------------------------------------------
    // A lista vazia e um estado REAL, e continua sendo depois da HMO-394: o
    // emprestimo em que toda parcela ja foi paga vira `settled` pelo ciclo de
    // pagamento, mas os que QUITARAM ANTES daquela entrega ficaram `active` --
    // ninguem os reescreveu -- e para eles o botao Cancelar segue sendo a unica
    // saida. E um emprestimo de parcela nenhuma (o POST que morreu entre os dois
    // inserts) tambem chega aqui com a lista vazia. `.in("id", [])`
    // no PostgREST nao filtra nada -- o UPDATE alcancaria TODA parcela que a RLS
    // entrega, inclusive as pagas de OUTROS emprestimos meus. A guarda e o
    // `.length`.
    let canceladas: { id: string }[] = [];

    if (aCancelar.length > 0) {
      const { data: parcelasCanceladas, error: erroDasParcelas } = await supabase
        .from("mybank_installments")
        .update(patchDoCancelamentoDaParcela())
        .in(
          "id",
          aCancelar.map((p) => p.id)
        )
        .select("id, status");

      if (erroDasParcelas || !parcelasCanceladas || parcelasCanceladas.length === 0) {
        // O EMPRESTIMO JA ESTA `cancelled`, e desfazer isso seria ressuscitar a
        // divida nas duas telas por causa de uma falha no passo seguinte. O
        // estado honesto e "a divida esta encerrada e as parcelas continuam em
        // aberto", com o numero na resposta para quem tentar de novo -- e tentar
        // de novo cai no 409 de "ja cancelado", que e o motivo de esta mensagem
        // dizer o que sobrou.
        console.error(
          "Erro ao cancelar as parcelas do emprestimo:",
          erroDasParcelas
        );
        return NextResponse.json(
          {
            error:
              `O empréstimo foi encerrado, mas ${aCancelar.length} parcela(s) continuam em aberto ` +
              "e as contas a pagar delas não foram removidas. Verifique em Contas a Pagar.",
            parcelas_em_aberto: aCancelar.length,
          },
          { status: 500 }
        );
      }

      canceladas = parcelasCanceladas;
    }

    // -----------------------------------------------------------------------
    // 4. CASO A: as previsoes ainda `pending`
    // -----------------------------------------------------------------------
    // As chaves saem das parcelas QUE O BANCO DEVOLVEU, e nao das que eu
    // pretendia cancelar: apagar a conta a pagar de uma parcela que continuou em
    // aberto seria exatamente a direcao de falha que esta ordem existe para
    // evitar -- divida de pe, cobranca invisivel.
    const chaves = chavesDasPrevisoesDoCancelamento({
      caso,
      parcelasCanceladas: canceladas,
    });

    let previsoesApagadas = 0;

    // A GUARDA DO `.length`, E ELA NAO E ECONOMIA DE CHAMADA.
    //
    // No Caso B a lista e vazia por decisao (`chavesDasPrevisoesDoCancelamento`
    // devolve `[]`), e `.in("notes", [])` nao filtra: o DELETE apagaria TODA
    // previsao pendente da pessoa -- a agenda inteira de Contas a Pagar, sem
    // erro nenhum no caminho. Mesma armadilha do lado da leitura em
    // `lib/services/divida-do-mybank.ts`.
    if (chaves.length > 0) {
      const { data: apagadas, error: erroDasPrevisoes } = await supabase
        .from("scheduled_transactions")
        .delete()
        // `user_id` EXPLICITO: `notes` e campo que a pessoa digita, e nada
        // impede a previsao de outra conta de ter `mybank:<id>` ali. A RLS
        // tambem barra, e esta e a camada que nao depende dela.
        .eq("user_id", user.id)
        // `pending` SO. Previsao ja baixada e fato consumado: o dinheiro saiu da
        // conta corrente e entrou na de investimento, as duas pernas estao em
        // `financial_transactions`, e apagar a previsao paga deixaria as pernas
        // orfas e o extrato sem a linha que as explica. Sem este filtro, cancelar
        // apagaria o historico de tudo o que ja foi pago.
        .eq("status", "pending")
        .in("notes", chaves)
        .select("id");

      if (erroDasPrevisoes) {
        // Os passos 2 e 3 ja aconteceram: a divida esta encerrada e as parcelas
        // canceladas. O que sobrou e a previsao orfa em Contas a Pagar -- a
        // falha VISIVEL que esta ordem escolhe, e a resposta diz onde ela esta.
        console.error(
          "Erro ao apagar as previsoes do emprestimo cancelado:",
          erroDasPrevisoes
        );
        return NextResponse.json(
          {
            error:
              "O empréstimo foi cancelado, mas as contas a pagar das parcelas continuam na agenda. " +
              "Exclua-as em Contas a Pagar.",
            parcelas_canceladas: canceladas.length,
          },
          { status: 500 }
        );
      }

      previsoesApagadas = apagadas?.length ?? 0;
    }

    return NextResponse.json({
      success: true,
      loan_id: emprestimo.id,
      caso,
      status: STATUS_CANCELADO,
      parcelas_canceladas: canceladas.length,
      parcelas_pagas_intactas: quantasPagas,
      previsoes_apagadas: previsoesApagadas,
      message: mensagemDoCancelamento({
        caso,
        quantasCanceladas: canceladas.length,
        quantasPagas,
        previsoesApagadas,
        nomeDoDevedor,
      }),
    });
  } catch (error) {
    console.error("MyBank loan cancel PATCH error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// AJUSTAR -- a entrega (1) da HMO-444: corrigir a divida que esta acontecendo
// ---------------------------------------------------------------------------
async function ajustar(
  { supabase, user, loanId }: ContextoDoPatch,
  pedido: PedidoDeAjuste
) {
  try {
    // -----------------------------------------------------------------------
    // 1. O emprestimo, e o credor conferido ANTES
    // -----------------------------------------------------------------------
    // `principal` E `interest_rate` ENTRAM NO SELECT: o primeiro e o total de
    // antes (a base de "passou de X para Y" e o valor que fica quando o pedido
    // nao manda `total`), e o segundo e o que `juros_fora_da_fase_1` pergunta.
    // Um select que nao os nomeia faria `ajusteDoEmprestimo` receber `undefined`
    // e gravar `principal: NaN` -- 22P02 no UPDATE, depois de as parcelas ja
    // terem sido reescritas.
    const { data: emprestimo } = await supabase
      .from("mybank_loans")
      .select(
        "id, lender_user_id, borrower_user_id, description, principal, installment_count, status, interest_rate"
      )
      .eq("id", loanId)
      .maybeSingle();

    if (!emprestimo) {
      // 404 e nao 403, pela mesma razao do cancelamento: a policy de SELECT
      // deixa os dois lados verem a linha, e dizer "existe mas nao e seu"
      // confirmaria a existencia do id para quem o chutou.
      return NextResponse.json(
        { error: "Empréstimo não encontrado" },
        { status: 404 }
      );
    }

    // -----------------------------------------------------------------------
    // 2. As parcelas, e o recalculo da cauda pela regra pura
    // -----------------------------------------------------------------------
    const { data: parcelas, error: erroDaLeituraDasParcelas } = await supabase
      .from("mybank_installments")
      .select(
        "id, installment_number, installment_total, amount, due_date, status"
      )
      .eq("loan_id", emprestimo.id);

    if (erroDaLeituraDasParcelas || !parcelas) {
      console.error(
        "Erro ao ler as parcelas do emprestimo a ajustar:",
        erroDaLeituraDasParcelas
      );
      return NextResponse.json(
        { error: "Não foi possível ler as parcelas. Nada foi ajustado." },
        { status: 500 }
      );
    }

    const pendentes = pendentesDaSerie(parcelas);
    const jaRecebido = jaRecebidoDaSerie(parcelas);

    const mexeNoTotal = pedido.total !== undefined;

    // O JURO RESOLVIDO, ANTES DA CAUDA -- porque e ele que diz sobre QUANTO a
    // cauda e repartida (HMO-478). `null` quando o pedido nao mexe em juro, e
    // ai tudo abaixo e o caminho de antes desta issue.
    //
    // `null` TAMBEM QUANDO OS CAMPOS NAO SERVEM, e isso NAO vira um ajuste sem
    // juro por acidente: `problemaDoAjuste` chama `problemaDoJuroDoAjuste` e
    // recusa com `juro_nao_serve` ANTES de qualquer escrita. A ordem aqui e a
    // mesma da cauda, que tambem e calculada antes da recusa que a julga.
    const juro = juroDepoisDoAjuste({ emprestimo, pedido });

    // A CAUDA E CALCULADA ANTES DA RECUSA, e isso e a forma de
    // `problemaDoEmprestimo` (que recebe `serie: SerieDeParcelas | null` e
    // devolve `serie_impossivel`): a pergunta "este ajuste serve?" inclui "a
    // repartição fecha?", e fecha-la depois obrigaria a rota a decidir sozinha
    // o que fazer com um `null` que veio de longe.
    //
    // `null` QUANDO NAO HA PENDENTE NENHUMA -- o emprestimo todo pago, cuja
    // descricao ainda pode ser corrigida. `problemaDoAjuste` sabe disso: ele so
    // pergunta pela cauda depois de ver que o pedido mexe em `total` ou em
    // `primeiroVencimentoDaCauda`, e SO esses dois exigem serie em aberto.
    // A CAUDA E MONTADA SEMPRE QUE HA PENDENTE, E NAO SO QUANDO O PEDIDO MEXE
    // NO VALOR. O ajuste que so troca a descricao nao recalcula nada -- e
    // precisa da lista das pendentes do mesmo jeito, porque e a COBRANCA de cada
    // uma que recebe o texto novo ("Moto elétrica (3/4)" em Contas a Pagar).
    // Com a cauda `null` ali, o typo que abre a issue ficaria consertado no
    // emprestimo e errado nas 21 contas a pagar dele.
    const cauda =
      pendentes.length > 0
        ? caudaRecalculada({
            pendentes,
            // O QUE FALTA RECEBER -- OS TRES RAMOS DESCERAM PARA A LIB NA
            // HMO-478 (`faltaReceberDoAjuste`), e o motivo da mudanca de lugar
            // esta no JSDoc de la: o ramo novo (`juro.total - jaRecebido`)
            // escrito aqui ficaria fora do alcance de todo mutante da lib, e
            // trocar `juro.total` por `pedido.total` e exatamente o estrago que
            // a issue descreve -- com `{taxa: 30}` o pedido nao traz total
            // nenhum, e a cauda seria repartida sobre `NaN`.
            faltaReceber: faltaReceberDoAjuste({
              pendentes,
              jaRecebido,
              pedido,
              juro,
            }),
            primeiroVencimentoDaCauda: ehDataISO(
              pedido.primeiroVencimentoDaCauda
            )
              ? pedido.primeiroVencimentoDaCauda
              : null,
          })
        : null;

    const problema = problemaDoAjuste({
      emprestimo,
      meuId: user.id,
      parcelas,
      pedido,
      cauda,
    });

    if (problema) {
      // 403 so para "nao e seu". 400 para corpo malformado, e 409 para o que
      // conflita com o ESTADO da divida -- a mesma escala da antecipacao.
      const codigo =
        problema === "nao_sou_o_credor"
          ? 403
          : problema === "emprestimo_nao_esta_ativo" ||
              problema === "tem_parcela_reportada" ||
              problema === "sem_parcela_pendente" ||
              problema === "total_menor_que_o_pago"
            ? 409
            : 400;

      return NextResponse.json(
        {
          error: mensagemDoProblemaDoAjuste(problema, {
            status: emprestimo.status,
            avisadas: avisadasDaSerie(parcelas),
            jaRecebido,
            pendentes: pendentes.length,
            // A RECUSA DA F2 PERGUNTADA DE NOVO, E NAO GUARDADA DA PRIMEIRA
            // VEZ: `problemaDoAjuste` nao devolve o motivo do juro, so o
            // rotulo `juro_nao_serve`. As duas chamadas sao da MESMA funcao
            // pura sobre os MESMOS argumentos -- nao ha estado entre elas que
            // as faca divergir.
            problemaDoJuro: problemaDoJuroDoAjuste({ emprestimo, pedido }),
          }),
          parcelas_ajustadas: 0,
        },
        { status: codigo }
      );
    }

    const caso = casoDoEmprestimo({
      lenderUserId: emprestimo.lender_user_id,
      borrowerUserId: emprestimo.borrower_user_id,
    });

    const ajuste = ajusteDoEmprestimo({ emprestimo, parcelas, pedido, cauda });

    // -----------------------------------------------------------------------
    // 2.5. CASO A: as previsoes do elo, LIDAS ANTES DA ESCRITA E SEM FILTRO DE
    //      STATUS -- a guarda de dinheiro desta fase
    // -----------------------------------------------------------------------
    // Ver A GUARDA DE DINHEIRO DO AJUSTE, no cabecalho: o filtro
    // `.eq("status", "pending")` que o cancelamento e a antecipacao usam
    // ESCONDERIA aqui exatamente a linha que tem de parar o pedido.
    const previsaoDaParcela = new Map<string, PrevisaoAAjustar>();

    const chavesDoAjuste = chavesDasPrevisoesDoAjuste({
      caso,
      parcelasAjustadas: ajuste.parcelas,
    });

    let previsoesAusentes: number[] = [];

    // A GUARDA DO `.length`, E ELA NAO E ECONOMIA DE CHAMADA -- a MESMA do
    // cancelamento e da antecipacao. No Caso B a lista e vazia por decisao, e
    // `.in("notes", [])` NAO FILTRA: a clausula desaparece e a leitura alcanca
    // TODA previsao que a RLS entrega. Aqui o estrago passaria pela leitura e
    // chegaria na ESCRITA do passo 3 -- a agenda inteira de Contas a Pagar
    // virando parcelas deste emprestimo, com valor e vencimento trocados.
    //
    // E E POR ISSO QUE A PERGUNTA E `chavesDoAjuste.length`, E NAO `caso === "auto"`:
    // as duas sao a mesma hoje, e a do `.length` e a que continua certa quando
    // o pedido nao muda parcela nenhuma (so a descricao de um emprestimo todo
    // pago), porque ali a lista tambem e vazia.
    if (chavesDoAjuste.length > 0) {
      const { data: previsoes, error: erroDasPrevisoes } = await supabase
        .from("scheduled_transactions")
        .select("id, description, amount, due_date, notes, status")
        // `user_id` EXPLICITO, como nas outras duas: `notes` e campo que a
        // pessoa digita, e nada impede a previsao de outra conta de ter
        // `mybank:<id>` ali. A RLS tambem barra, e esta e a camada que nao
        // depende dela.
        .eq("user_id", user.id)
        .in("notes", chavesDoAjuste);

      if (erroDasPrevisoes || !previsoes) {
        console.error(
          "Erro ao ler as previsoes das parcelas a ajustar:",
          erroDasPrevisoes
        );
        return NextResponse.json(
          {
            error:
              "Não foi possível ler as contas a pagar destas parcelas. Nada foi ajustado.",
            parcelas_ajustadas: 0,
          },
          { status: 500 }
        );
      }

      const { pares, comPrevisaoBaixada, semPrevisao } = previsoesDoAjuste({
        parcelasAjustadas: ajuste.parcelas,
        previsoes,
      });

      if (comPrevisaoBaixada.length > 0) {
        // 409 E NAO 500: o estado do banco e legivel -- a parcela esta em
        // aberto e a conta a pagar dela ja foi baixada. Nada foi escrito, e a
        // frase diz quais parcelas e o que fazer antes de tentar de novo.
        return NextResponse.json(
          {
            error: mensagemDaPrevisaoJaBaixada(comPrevisaoBaixada),
            parcelas_ajustadas: 0,
          },
          { status: 409 }
        );
      }

      previsoesAusentes = semPrevisao;

      for (const par of pares) {
        previsaoDaParcela.set(par.parcela.id, par.previsao);
      }
    }

    // -----------------------------------------------------------------------
    // 3. POR PARCELA: a divida, e so depois a cobranca dela
    // -----------------------------------------------------------------------
    // A parcela ANTES da previsao porque a parcela E a divida: a previsao e a
    // cobranca derivada dela, e uma cobranca que discorda da divida aparece em
    // Contas a Pagar com um valor que a tela do emprestimo desmente -- visivel,
    // e corrigivel ali mesmo. A ordem inversa esconderia a divergencia do lado
    // que ninguem confere linha por linha.
    /**
     * As parcelas cuja LINHA foi reescrita de verdade.
     *
     * "Ajustada" aqui e "o UPDATE alcancou a linha", e nao "o pedido mexia
     * nela": a parcela de patch vazio (a que entrou na lista so porque a
     * descricao mudou) ja esta no estado pedido e nao e contada. Sem essa
     * distincao, um pedido que so troca o texto responderia "3 parcelas
     * ajustadas" sem ter escrito em parcela nenhuma -- e a medicao em producao
     * iria procurar na tabela tres valores que nao mudaram.
     */
    const ajustadas: { id: string; numero: number }[] = [];

    /** O que parou o laco, quando algo parou. */
    let parouPor: string | null = null;

    let previsoesAjustadas = 0;

    for (const linha of ajuste.parcelas) {
      // O PATCH VAZIO E UM ESTADO REAL, e nao um erro: e a parcela que JA ESTA no
      // estado pedido -- porque o pedido nao mexeu no valor dela, ou porque uma
      // passagem anterior ja a reescreveu. A COBRANCA dela e atualizada de
      // qualquer jeito (ver TODA PENDENTE ENTRA NA LISTA em
      // `ajusteDoEmprestimo`); o que se pula e o UPDATE da parcela. Um
      // `update({})` no PostgREST nao e um no-op: ele e 400 (`PGRST102`), e a
      // passagem morreria aqui.
      if (Object.keys(linha.patch).length > 0) {
        const { data: escritas, error: erroDaParcela } = await supabase
          .from("mybank_installments")
          .update(linha.patch)
          .eq("id", linha.id)
          .select("id, amount, due_date");

        // `.select()` E A CONTAGEM NAO SAO DECORACAO: a trava da 053 recusa com
        // excecao, mas a POLICY filtra em silencio -- 200 com `[]`. Sem a
        // contagem esta rota diria "ajustei 21 parcelas" sobre zero linha.
        if (erroDaParcela || !escritas || escritas.length === 0) {
          // NADA E DESFEITO, e isso e deliberado: as parcelas anteriores estao
          // com o valor que o pedido pediu, e desfaze-las exigiria guardar o
          // valor antigo de cada uma e reescrever tudo de volta -- um segundo
          // laco de escrita, com a propria chance de parar no meio, para voltar
          // a um estado que ninguem pediu. O emprestimo NAO e atualizado (ver a
          // ordem no cabecalho), e mandar o MESMO pedido de novo termina o
          // servico.
          console.error("Erro ao ajustar a parcela do emprestimo:", {
            parcelaId: linha.id,
            erro: erroDaParcela,
          });
          parouPor = `A parcela ${linha.numero} não pôde ser ajustada.`;
          break;
        }

        // A PARCELA ENTRA NA CONTA AQUI, E NAO NO FIM DO LACO. A cobranca dela
        // vem depois e pode falhar -- e contar a parcela so depois disso faria a
        // resposta dizer "nada foi ajustado" sobre uma divida que JA foi
        // reescrita no banco. O que falhou sai em `parcial`, nomeando a parcela.
        ajustadas.push({ id: linha.id, numero: linha.numero });
      }

      // ---------------------------------------------------------------------
      // CASO A: a conta a pagar da parcela acompanha
      // ---------------------------------------------------------------------
      // No Caso B nao ha nada a atualizar, e isso NAO e uma lacuna: a view
      // `mybank_due_entries` le `i.amount` da propria parcela, entao a tela da
      // devedora ja mostra o valor novo sem leitor nenhum ter mudado.
      const previsao = previsaoDaParcela.get(linha.id);

      if (previsao) {
        const { data: previsoesEscritas, error: erroDaPrevisao } =
          await supabase
            .from("scheduled_transactions")
            // OS TRES CAMPOS SAEM DA REGRA PURA, JA MONTADOS. O valor nao sai
            // do que a previsao tinha: ela e EDITAVEL em Contas a Pagar e as
            // duas podem divergir. A divida e a parcela -- deixar a previsao
            // mandar faria a cobranca manter um valor que a divida acabou de
            // deixar de ter. Ver `cobranca` em `AjusteDoEmprestimo`.
            .update(linha.cobranca)
            .eq("id", previsao.id)
            // `status = pending` NO PROPRIO PEDIDO, E ELE NAO E REDUNDANTE.
            //
            // O passo 2.5 ja recusou o pedido inteiro quando alguma previsao
            // nao estava `pending`, e esta e a camada que nao depende daquela
            // leitura: entre ela e esta escrita a previsao pode ter sido baixada
            // em outra aba (`o-banco-muda-no-meio-do-heartbeat`). Sem o filtro,
            // o ajuste reescreveria o valor de um lancamento ja realizado --
            // exatamente o que o passo 2.5 existe para impedir.
            .eq("status", "pending")
            .select("id");

        if (erroDaPrevisao || !previsoesEscritas || previsoesEscritas.length === 0) {
          // A PARCELA JA FOI AJUSTADA, e desfaze-la seria devolver a divida ao
          // valor antigo por causa de uma falha na COBRANCA dela. O estado
          // honesto e "a divida esta ajustada e esta conta a pagar nao", com o
          // numero na resposta -- e a frase manda tentar de novo, que e o
          // gesto que termina o servico.
          console.error("Erro ao ajustar a conta a pagar da parcela:", {
            parcelaId: linha.id,
            previsaoId: previsao.id,
            erro: erroDaPrevisao,
          });
          parouPor =
            `A parcela ${linha.numero} foi ajustada, mas a conta a pagar dela em Contas a Pagar não.`;
          break;
        }

        previsoesAjustadas += 1;
      }
    }

    // O LACO PAROU ANTES DE ESCREVER QUALQUER COISA? O mundo esta como antes do
    // pedido, e a resposta e 500 com `parcelas_ajustadas: 0`.
    //
    // A PERGUNTA SOMA AS DUAS TABELAS, e nao so as parcelas: o pedido que so
    // troca a descricao nao escreve parcela nenhuma: ele escreve PREVISAO. Com a
    // pergunta so em `ajustadas`, uma passagem que reescreveu as tres contas a
    // pagar e parou na terceira responderia "nada foi ajustado" -- e quem lesse
    // isso nao iria conferir em Contas a Pagar.
    if (parouPor && ajustadas.length === 0 && previsoesAjustadas === 0) {
      return NextResponse.json(
        {
          error: parouPor + " Nada foi ajustado — tente de novo.",
          parcelas_ajustadas: 0,
        },
        { status: 500 }
      );
    }

    // -----------------------------------------------------------------------
    // 4. O EMPRESTIMO, POR ULTIMO -- e SO se a cauda inteira passou
    // -----------------------------------------------------------------------
    // `principal` e a afirmacao de um total que a soma das parcelas tem de
    // fechar (comentario da 053). Gravar o total novo depois de um laco que
    // parou no meio faria a linha do emprestimo AFIRMAR um numero que nenhuma
    // parcela sustenta -- e, pior, faria a segunda tentativa recalcular a cauda
    // a partir de um total que a primeira ja gravou, convergindo para o lugar
    // certo por acidente. Com o `principal` antigo de pe, repetir o pedido e
    // deterministico.
    let emprestimoAtualizado = true;

    if (!parouPor && ajuste.patchDoEmprestimo) {
      const { data: atualizados, error: erroDoEmprestimo } = await supabase
        .from("mybank_loans")
        .update(ajuste.patchDoEmprestimo)
        .eq("id", emprestimo.id)
        // `interest_rate` ENTRA DESDE A HMO-478: num ajuste com juro ele e a
        // UNICA coluna que muda na linha do emprestimo (o `principal` fica
        // parado), e sem ele no `.select()` a conferencia da linha ESCRITA nao
        // alcancaria o campo que o pedido veio mudar.
        .select("id, lender_user_id, description, principal, interest_rate");

      // A LINHA DEVOLVIDA, CONFERIDA DEPOIS -- a mesma pergunta do
      // cancelamento, e pelo mesmo motivo: a do passo 1 foi sobre a linha LIDA,
      // esta e sobre a linha ESCRITA, e as duas podem divergir.
      emprestimoAtualizado =
        !erroDoEmprestimo &&
        !!atualizados &&
        atualizados.length > 0 &&
        atualizados.every((l) => l.lender_user_id === user.id);

      if (!emprestimoAtualizado) {
        console.error("MyBank: o UPDATE do ajuste nao alcancou o emprestimo.", {
          loanId: emprestimo.id,
          erro: erroDoEmprestimo,
        });
      }
    }

    const mudouADescricao = ajuste.patchDoEmprestimo?.description !== undefined;

    const message = mensagemDoAjuste({
      // AS PARCELAS QUE DE VERDADE ENTRARAM, e nao as escolhidas: o laco pode
      // ter parado, e dizer "21 ajustadas" de 3 seria a resposta mentindo sobre
      // a divida que ela mesma reescreveu.
      quantasParcelas: ajustadas.length,
      total: ajuste.total,
      jaRecebido: ajuste.jaRecebido,
      caso,
      previsoesAjustadas,
      previsoesAusentes,
      mudouADescricao,
      mudouOTotal: mexeNoTotal,
      // O JURO DO AJUSTE SAI DE `ajuste`, e nao do `juro` desta funcao: os dois
      // sao o mesmo objeto hoje, e o da regra pura e o que acompanha o patch
      // que foi de fato montado. Ler a variavel local faria a frase e o patch
      // poderem divergir no dia em que `ajusteDoEmprestimo` resolver o juro de
      // outro jeito -- e a frase diz dinheiro.
      juro: ajuste.juro,
      emprestimoAtualizado,
    });

    return NextResponse.json(
      {
        // `parcelas_ajustadas` E O CONTRATO, e nao este booleano: quem le so o
        // `success` trataria 3-de-21 como 21. A mesma escolha da antecipacao.
        // `!parouPor` E NAO `ajustadas.length === ajuste.parcelas.length`: as
        // duas divergem de proposito no pedido que so troca a descricao (3
        // parcelas na lista, 0 linhas de parcela escritas), e aquela comparacao
        // responderia `false` a um ajuste que deu certo inteiro.
        success: !parouPor && emprestimoAtualizado,
        loan_id: emprestimo.id,
        caso,
        descricao: mudouADescricao
          ? ajuste.patchDoEmprestimo?.description
          : emprestimo.description,
        total: ajuste.total,
        ja_recebido: ajuste.jaRecebido,
        // AS TRES GRANDEZAS DO JURO NO CORPO, E O `emprestado` E O CONTROLE
        // DESTA ISSUE EM FORMA DE CAMPO (HMO-478).
        //
        // A medicao em producao confere `emprestado` contra
        // `mybank_loans.principal` ANTES do pedido: se os dois batem, o ajuste
        // nao reescreveu o que saiu da conta de investimento. Sem este campo o
        // unico jeito de ver o defeito seria ler a tabela antes e depois -- e
        // ele nao tem sintoma nenhum na tela (`SUM(amount) - principal` vira
        // zero em silencio).
        //
        // SO COM JURO: a juro zero nao ha taxa nova a reportar, e um
        // `taxa: 0` constante faria a medicao nao distinguir "nao mexeu em
        // juro" de "zerou o juro".
        ...(ajuste.juro
          ? {
              emprestado: ajuste.juro.principal,
              taxa: ajuste.juro.taxa,
              juros: ajuste.juro.juros,
            }
          : {}),
        parcelas_pedidas: ajuste.parcelas.length,
        parcelas_ajustadas: ajustadas.length,
        numeros: ajustadas.map((p) => p.numero),
        // AS `paid` QUE NAO FORAM TOCADAS -- o numero que a medicao confere
        // contra a tabela. Ele e o controle negativo desta filha em forma de
        // campo: um ajuste que reescrevesse a serie inteira devolveria o mesmo
        // `parcelas_ajustadas` e este numero continuaria igual, e por isso a
        // medicao le a TABELA e nao acredita no campo.
        parcelas_pagas_intactas: parcelas.filter((p) => p.status === "paid")
          .length,
        previsoes_ajustadas: previsoesAjustadas,
        ...(previsoesAusentes.length > 0
          ? { previsoes_ausentes: previsoesAusentes }
          : {}),
        emprestimo_atualizado: emprestimoAtualizado,
        ...(parouPor ? { parcial: parouPor } : {}),
        message,
      },
      // 207 NAO EXISTE NESTE APP, e um 500 apagaria o corpo que diz o que
      // entrou. O ajuste parcial e 200 com `success: false` e `parcial` -- a
      // mesma forma da antecipacao parcial, para que quem ler o status e quem
      // ler o corpo cheguem a mesma conclusao.
      { status: 200 }
    );
  } catch (error) {
    console.error("MyBank loan ajuste PATCH error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
