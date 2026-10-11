// ---------------------------------------------------------------------------
// PATCH /api/mybank/loans/[id] -- cancelar um emprestimo em atividade
// ---------------------------------------------------------------------------
// MyBank, F3 da HMO-383 (issue HMO-391). SEM MIGRATION: a 053 ja aceita
// `cancelled` nos dois `status_check`, a policy de UPDATE ja e so do credor, e
// `mybank_loans_trava` de proposito NAO re-exige a conexao num UPDATE que mexe
// so no status -- cancelar funciona mesmo depois de a conexao ser desfeita.
//
// O QUE NAO EXISTIA: NENHUM CAMINHO DE ENCERRAMENTO
// -------------------------------------------------
// `app/api/mybank/` tinha POST e GET de emprestimo, o GET da agenda e o PATCH da
// parcela. Nao havia PATCH nem DELETE de emprestimo, e por isso a divida
// duplicada que entrou em producao (o caso que abriu a HMO-383) nao tinha como
// sair pela propria tela.
//
// A REGRA PURA NAO ESTA AQUI
// --------------------------
// `problemaDoCancelamento`, `parcelaSegueOCancelamento`,
// `chavesDasPrevisoesDoCancelamento` e as frases vivem em
// `lib/emprestimo-do-mybank.ts`, com o porque de cada uma e com os mutantes
// alcancando-as. Aqui ficam a ordem dos passos e o que se faz quando um deles
// falha -- que e justamente o que funcao pura nenhuma consegue medir.
//
// A ORDEM, E ELA E SOBRE DINHEIRO
// -------------------------------
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
// A RLS NAO BASTA, E A RAZAO E MEDIDA
// -----------------------------------
// `mybank_loans_select` e `lender OR borrower`: o DEVEDOR enxerga a linha e
// chega a esta rota com um emprestimo legivel. E UPDATE que a policy filtra
// volta como SUCESSO COM ZERO LINHAS neste app -- 200, corpo `[]`, sem erro e
// sem SQLSTATE (`update-filtrado-pela-rls-vira-sucesso`, medido em producao).
// Entao o credor e conferido DUAS vezes: na linha lida ANTES (para a recusa ter
// frase) e na linha devolvida DEPOIS (para "cancelei" nao ser dito sobre um
// UPDATE que alcancou nada).
// ---------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

import {
  casoDoEmprestimo,
  chavesDasPrevisoesDoCancelamento,
  mensagemDoCancelamento,
  mensagemDoProblemaDoCancelamento,
  parcelaSegueOCancelamento,
  patchDoCancelamentoDaParcela,
  problemaDoCancelamento,
  STATUS_CANCELADO,
} from "@/lib/emprestimo-do-mybank";

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
    const { status } = body as { status?: string };

    // SO `cancelled`, E O CORPO NAO TEM MAIS NENHUM CAMPO LIDO.
    //
    // A defesa e a ausencia, como no PATCH da parcela: `principal`,
    // `installment_count`, `borrower_user_id` e `lender_account_id` nao sao
    // lidos em ramo nenhum deste arquivo. Nao ha um `delete patch.principal`
    // para alguem remover sem querer -- editar a divida nao e uma operacao que
    // esta rota saiba fazer, e `settled` e estado que o ciclo de pagamento
    // alcanca, nao que a tela declare.
    //
    // E DESDE A HMO-394 O CICLO ALCANCA MESMO: quem escreve `settled` sao o PATCH
    // da parcela e a baixa da previsao, pela regra `emprestimoFicouQuitado`.
    // Antes dela esta frase descrevia uma intencao -- ninguem escrevia o status,
    // e um emprestimo 24/24 pago so saia das telas pelo botao Cancelar.
    if (status !== STATUS_CANCELADO) {
      return NextResponse.json(
        {
          error:
            'Esta rota só cancela um empréstimo: mande { "status": "cancelled" }.',
        },
        { status: 400 }
      );
    }

    // -----------------------------------------------------------------------
    // 1. O emprestimo, e o credor conferido ANTES
    // -----------------------------------------------------------------------
    const { data: emprestimo } = await supabase
      .from("mybank_loans")
      .select("id, lender_user_id, borrower_user_id, description, status")
      .eq("id", params.id)
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
