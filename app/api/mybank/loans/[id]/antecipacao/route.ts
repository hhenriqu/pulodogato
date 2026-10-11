// ---------------------------------------------------------------------------
// POST /api/mybank/loans/[id]/antecipacao -- adiantar parcelas do FIM da serie
// ---------------------------------------------------------------------------
// MyBank, F2 da HMO-393 (issue HMO-395). SEM MIGRATION: medido na 053, nao
// suposto -- `installment_total` nao e tocado, `((status='paid') = (paid_date IS
// NOT NULL))` e atendido por `patchDaBaixaDaParcela`, e NAO EXISTE trava de
// ordem de pagamento (nenhum CHECK e nenhuma das duas triggers compara
// `installment_number` com o das vizinhas). Pagar a 24 com a 3 pendente e um
// UPDATE comum.
//
// O DINHEIRO PAGA A CAUDA. NADA E CANCELADO
// -----------------------------------------
// As N parcelas em aberto de maior vencimento viram `paid`, com `paid_date` e
// uma perna de entrada cada. A parcela 3 continua `pending`, vence no mes que
// vem, com o valor que sempre teve. A serie que acabava em 08/2028 acaba em
// 06/2028. O porque por extenso -- e por que o desenho que CANCELA a cauda
// extingue o dobro do que foi pago -- esta no cabecalho da secao da antecipacao
// em `lib/emprestimo-do-mybank.ts`.
//
// ROTA IRMA, E NAO UM RAMO NOVO NO `PATCH` DE `loans/[id]`
// -------------------------------------------------------
// Aquele `if` que recusa todo corpo que nao seja `{status:"cancelled"}` e uma
// DEFESA MEDIDA: `principal`, `installment_count`, `borrower_user_id` e
// `lender_account_id` nao sao lidos em ramo nenhum daquele arquivo, e abri-lo
// para um segundo verbo e desmonta-la. E o gesto aqui nao e editar um campo do
// emprestimo: e criar N lancamentos e dar N baixas.
//
// O CORPO PEDE QUANTAS PARCELAS, NAO QUANTOS REAIS
// -----------------------------------------------
// `{ parcelas: N, data_do_pagamento?: "AAAA-MM-DD" }`. `valor` NAO EXISTE no
// contrato, e isso e a decisao: a rota so aceita parcela inteira, entao "R$ 150
// contra parcelas de R$ 200" nao tem como ser EXPRESSO -- a recusa esta na forma
// do corpo, que e mais forte que uma validacao que alguem pode afrouxar. A
// frase do `quantas_invalida` diz o que fazer com os R$ 150 em vez de so
// recusar.
//
// A ROTA E DO CREDOR, E O 403 VEM ANTES DA ESCRITA
// -----------------------------------------------
// A decisao sai do BANCO e nao de preferencia:
// `mybank_installments_trava_do_devedor` (053) deixa o devedor fazer EXATAMENTE
// `pending -> reported` e levanta `insufficient_privilege` em qualquer outro
// campo -- inclusive `paid_date` e `paid_transaction_id`, que a antecipacao
// precisa gravar. E `mybank_loans_update` e `lender_user_id = auth.uid()` nos
// dois lados.
//
// Mesmo assim a pergunta e feita na ROTA, antes: UPDATE que a POLICY filtra
// volta 200 com corpo `[]`, sem erro e sem SQLSTATE
// (`update-filtrado-pela-rls-vira-sucesso`, medido em producao). Sem ela o
// devedor receberia "antecipei duas parcelas" de uma escrita que nao aconteceu.
//
// A ORDEM DOS PASSOS -- E ELA E SOBRE DINHEIRO
// -------------------------------------------
//   1. ler o emprestimo; conferir o credor ANTES de qualquer escrita;
//   2. ler as parcelas; escolher as N da cauda pela regra pura
//      (`parcelasDaAntecipacao`: `due_date DESC`, desempate por
//      `installment_number DESC`);
//   3. POR PARCELA, UMA DE CADA VEZ: gravar a perna de entrada e so depois a
//      baixa. Se a baixa falhar, APAGAR A PERNA que acabou de entrar e parar --
//      o mesmo rollback que a baixa da previsao faz, pelo mesmo motivo: perna
//      sem parcela baixada e dinheiro no extrato que nenhuma divida explica;
//   4. `settled` pela regra da HMO-394, se nao sobrou nada em aberto;
//   5. a resposta diz QUANTAS DE VERDADE ENTRARAM.
//
// PARAR NO MEIO E UM ESTADO CONSISTENTE, E E POR ISSO QUE NAO HA TRANSACAO
// -----------------------------------------------------------------------
// Cada parcela antecipada e fechada em si (uma perna, uma baixa), e
// `soma(recebido) + soma(em aberto) = principal` continua valendo depois de cada
// uma. "Antecipei 1 das 2 que pedi" e um resultado, nao um estado quebrado -- e
// e por isso que `parcelas_antecipadas` E O CONTRATO desta resposta, e nao o
// booleano: quem le so o `success` trata 1-de-2 como 2.
//
// A alternativa -- um `.in()` de N ids num UPDATE so -- seria atomica na baixa e
// NAO nas N pernas, e deixaria "4 pernas gravadas, 4 parcelas pagas, 1 perna
// perdida": irreconciliavel, porque `paid_transaction_id` aponta para uma linha
// que nao existe.
//
// A FASE 2 REABRE ESTA FEATURE
// ---------------------------
// `mybank_loans_interest_rate_fase_1` trava `interest_rate = 0`, e e isso que
// faz `valorDaAntecipacao` ser uma soma simples -- cada real abate principal real
// a real. COM JURO, antecipar tem de descontar o juro NAO-CORRIDO da cauda, e
// uma soma de `amount` passaria a cobrar juro de um tempo que nao existiu. Por
// isso esta rota RECUSA `interest_rate <> 0` em vez de calcular errado. Quem
// reabrir a fase 2 comeca por aqui.
//
// SEM CHAMADOR NA TELA, E ISSO E A FASE
// ------------------------------------
// Esta e a F2 de 4 da HMO-393: o nucleo. O gesto na tela e a medicao em producao
// vem depois, e nenhuma LEITURA muda -- `escopoDoBlocoDoDevedor` ja anda sozinho
// de "a 08/2028" para "a 06/2028" porque le as parcelas em aberto. Se alguma
// leitura parecer precisar de conserto, o desenho saiu do trilho.
// ---------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

import {
  casoDoEmprestimo,
  chaveDaParcelaDoMyBank,
  emprestimoFicouQuitado,
  mensagemDaAntecipacao,
  mensagemDoProblemaDaAntecipacao,
  parcelasDaAntecipacao,
  patchDaBaixaDaParcela,
  patchDaQuitacaoDoEmprestimo,
  pernaDeEntradaDoPagamento,
  problemaDaAntecipacao,
  quantasEmAberto,
  ultimoVencimentoEmAberto,
  valorDaAntecipacao,
} from "@/lib/emprestimo-do-mybank";
import { hojeISO } from "@/lib/lancamento";
import { NOME_DA_CATEGORIA_DE_TRANSFERENCIA } from "@/lib/transferencia";

export async function POST(
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
    const { parcelas: quantasPedidas, data_do_pagamento } = body as {
      parcelas?: unknown;
      data_do_pagamento?: string | null;
    };

    // `Number(undefined)` e `NaN`, e `Number.isInteger(NaN)` e `false`: o corpo
    // sem `parcelas` cai no `quantas_invalida` com a frase que explica o
    // contrato, em vez de num 500 mais adiante.
    const quantas = Number(quantasPedidas);

    // -----------------------------------------------------------------------
    // 1. O emprestimo, e o credor conferido ANTES
    // -----------------------------------------------------------------------
    const { data: emprestimo } = await supabase
      .from("mybank_loans")
      .select(
        "id, lender_user_id, lender_account_id, borrower_user_id, description, status, interest_rate"
      )
      .eq("id", params.id)
      .maybeSingle();

    if (!emprestimo) {
      // 404 e nao 403: a policy de SELECT deixa os dois lados verem a linha,
      // entao "nao achei" aqui quer dizer que o emprestimo nao e meu nem e uma
      // divida minha. Dizer "existe mas nao e seu" confirmaria a existencia do
      // id para quem o chutou -- a mesma escolha do PATCH do cancelamento.
      return NextResponse.json(
        { error: "Empréstimo não encontrado" },
        { status: 404 }
      );
    }

    // -----------------------------------------------------------------------
    // 2. As parcelas, e a escolha da CAUDA pela regra pura
    // -----------------------------------------------------------------------
    const { data: parcelas, error: erroDaLeituraDasParcelas } = await supabase
      .from("mybank_installments")
      .select(
        "id, installment_number, installment_total, amount, due_date, status"
      )
      .eq("loan_id", emprestimo.id);

    if (erroDaLeituraDasParcelas || !parcelas) {
      console.error(
        "Erro ao ler as parcelas do emprestimo a antecipar:",
        erroDaLeituraDasParcelas
      );
      return NextResponse.json(
        { error: "Não foi possível ler as parcelas. Nada foi antecipado." },
        { status: 500 }
      );
    }

    const problema = problemaDaAntecipacao({
      emprestimo,
      meuId: user.id,
      parcelas,
      quantas,
    });

    if (problema) {
      // 403 so para "nao e seu". 400 para corpo malformado e para o Caso A (que
      // aponta OUTRO caminho), e 409 para o que conflita com o estado da divida.
      const codigo =
        problema === "nao_sou_o_credor"
          ? 403
          : problema === "quantas_invalida" || problema === "caso_a_nao_entra_aqui"
            ? 400
            : 409;

      return NextResponse.json(
        {
          error: mensagemDoProblemaDaAntecipacao(problema, {
            status: emprestimo.status,
            emAberto: quantasEmAberto(parcelas),
          }),
        },
        { status: codigo }
      );
    }

    const caso = casoDoEmprestimo({
      lenderUserId: emprestimo.lender_user_id,
      borrowerUserId: emprestimo.borrower_user_id,
    });

    const escolhidas = parcelasDaAntecipacao({ parcelas, quantas });

    // O ULTIMO VENCIMENTO DE ANTES, LIDO ANTES DE QUALQUER ESCRITA. Ele e metade
    // da frase que prova que a serie encurtou ("era 08/2028, passou a ser
    // 06/2028"), e depois das baixas ele nao existe mais em lugar nenhum.
    const ultimoVencimentoAntes = ultimoVencimentoEmAberto(parcelas);

    const dataDoPagamento =
      typeof data_do_pagamento === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(data_do_pagamento)
        ? data_do_pagamento
        : hojeISO();

    // -----------------------------------------------------------------------
    // O servico e a categoria reservada -- lidos UMA vez, fora do laco
    // -----------------------------------------------------------------------
    // N parcelas dariam N pares de consultas identicas, e a falha de uma delas
    // no meio do laco pararia a antecipacao DEPOIS de algumas parcelas, por um
    // motivo que nao tem nada a ver com dinheiro.
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

    // -----------------------------------------------------------------------
    // 3. UMA PARCELA DE CADA VEZ: a perna de entrada, e so depois a baixa
    // -----------------------------------------------------------------------
    // `amount` E NAO `valor` NO NOME DO CAMPO: e esta lista que vai a
    // `valorDaAntecipacao`, e ela soma `amount`. Um `valor` aqui obrigaria a um
    // `.map()` de renomeacao entre as duas -- e um `.map()` e onde um `?? 0`
    // entra sem que nada reclame.
    const antecipadas: {
      id: string;
      numero: number;
      amount: number;
      vencimento: string;
      transacao: string;
    }[] = [];

    /** O que parou o laco, quando algo parou. */
    let parouPor: string | null = null;

    for (const parcela of escolhidas) {
      // `transfer` e nao `income`: principal voltando NAO e receita. Com
      // `income` o mesmo dinheiro contaria como renda uma vez por parcela
      // antecipada -- e a antecipacao lanca varias de uma vez, o que torna o
      // defeito maior aqui do que na parcela avulsa.
      const perna = pernaDeEntradaDoPagamento({
        caso,
        contaCredoraId: emprestimo.lender_account_id,
        valor: Number(parcela.amount),
        descricao: emprestimo.description,
        numero: parcela.installment_number,
        total: parcela.installment_total,
      });

      if (!perna) {
        // Inalcancavel: `caso_a_nao_entra_aqui` ja saiu acima, e so o Caso A
        // devolve `null`. Chegar aqui quer dizer que a decisao de pernas e esta
        // rota discordam, e a resposta certa e nao gravar mais nada.
        console.error(
          "MyBank: pernaDeEntradaDoPagamento devolveu null na antecipacao",
          { caso, loanId: emprestimo.id }
        );
        parouPor = "Não foi possível montar o lançamento do recebimento.";
        break;
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
          // A chave canonica do elo, a mesma do `acerto:<id>` da HMO-366: e por
          // ela que se acha a perna a partir da parcela depois.
          notes: chaveDaParcelaDoMyBank(parcela.id),
          ...perna,
        })
        .select("id")
        .single();

      if (erroDaPerna || !lancamento) {
        // NADA desta parcela ficou gravado, e as anteriores ficaram inteiras
        // (perna + baixa). O laco para aqui: insistir nas seguintes depois de
        // uma falha de escrita so aumenta a chance de parar num estado pior.
        console.error(
          "Erro ao lancar a entrada da parcela antecipada:",
          erroDaPerna
        );
        parouPor =
          `A parcela ${parcela.installment_number} não pôde ser lançada.`;
        break;
      }

      const { data: baixadas, error: erroDaBaixa } = await supabase
        .from("mybank_installments")
        .update(
          patchDaBaixaDaParcela({
            paidDate: dataDoPagamento,
            pernaDeEntradaId: lancamento.id,
          })
        )
        .eq("id", parcela.id)
        .select("id, status");

      // `.select()` E A CONTAGEM NAO SAO DECORACAO: a trava do devedor (053)
      // recusa com excecao, mas a POLICY filtra em silencio -- 200 com `[]`.
      // Sem a contagem esta rota diria "antecipei" sobre um UPDATE que alcancou
      // zero linha, e a perna ficaria orfa no extrato.
      if (erroDaBaixa || !baixadas || baixadas.length === 0) {
        // O ROLLBACK DA PERNA. Perna sem parcela baixada e dinheiro no extrato
        // que nenhuma divida explica -- e o credor veria o saldo da conta de
        // investimento subir com a divida inteira de pe. O mesmo desfazimento
        // que a baixa da previsao faz quando a parcela nao baixa.
        await supabase
          .from("financial_transactions")
          .delete()
          .eq("id", lancamento.id);

        console.error(
          "Antecipacao desfeita nesta parcela: a baixa nao alcancou a linha",
          { parcelaId: parcela.id, erro: erroDaBaixa }
        );
        parouPor =
          `A parcela ${parcela.installment_number} não pôde ser baixada, e o lançamento dela foi desfeito.`;
        break;
      }

      antecipadas.push({
        id: parcela.id,
        numero: parcela.installment_number,
        amount: Number(parcela.amount),
        vencimento: String(parcela.due_date),
        transacao: lancamento.id,
      });
    }

    if (antecipadas.length === 0) {
      // Nenhuma parcela entrou, e o rollback ja desfez o que tinha entrado: o
      // mundo esta como antes do pedido.
      return NextResponse.json(
        {
          error:
            (parouPor ?? "Não foi possível antecipar.") +
            " Nada foi antecipado — tente de novo.",
          parcelas_antecipadas: 0,
        },
        { status: 500 }
      );
    }

    // -----------------------------------------------------------------------
    // 4. `settled`, se nao sobrou nada em aberto (HMO-394)
    // -----------------------------------------------------------------------
    // Daqui para baixo NADA e desfeito: o dinheiro entrou e as parcelas estao
    // pagas. A RELEITURA e a fonte -- a decisao e sobre a SERIE inteira, e as
    // linhas em maos so conhecem as que esta chamada tocou.
    const { data: serieDepois, error: erroDaReleitura } = await supabase
      .from("mybank_installments")
      .select("id, status, due_date")
      .eq("loan_id", emprestimo.id);

    let emprestimoQuitado = false;
    let ultimoVencimentoDepois: string | null = null;
    // `null` E NAO `0`, E A DIFERENCA E DINHEIRO. Com a releitura falhando, um
    // `0` aqui diria "nao sobrou nada a pagar" porque a rota nao conseguiu
    // PERGUNTAR quanto sobrou -- e as parcelas antecipadas ja estao pagas, entao
    // quem le concluiria que quitou. `null` e "nao sei", e a frase tem ramo
    // proprio para ele.
    let aindaEmAberto: number | null = null;
    const serieRelida = !erroDaReleitura && !!serieDepois;

    // `&& serieDepois` DE NOVO e so para o tsc estreitar o tipo: a pergunta e
    // `serieRelida`, e escrever a condicao de outra forma aqui deixaria duas
    // versoes do mesmo criterio em linhas vizinhas -- as duas podendo divergir
    // na primeira mudanca sem que nada reclame.
    if (serieRelida && serieDepois) {
      aindaEmAberto = quantasEmAberto(serieDepois);
      ultimoVencimentoDepois = ultimoVencimentoEmAberto(serieDepois);

      if (emprestimoFicouQuitado({ parcelas: serieDepois })) {
        const { data: quitados, error: erroDaQuitacao } = await supabase
          .from("mybank_loans")
          .update(patchDaQuitacaoDoEmprestimo())
          .eq("id", emprestimo.id)
          .select("id, status");

        emprestimoQuitado =
          !erroDaQuitacao && !!quitados && quitados.length > 0;

        if (!emprestimoQuitado) {
          console.error(
            "MyBank: a antecipacao zerou a serie e o emprestimo nao virou settled.",
            { loanId: emprestimo.id, erro: erroDaQuitacao }
          );
        }
      }
    }

    // A frase sai das parcelas QUE DE VERDADE ENTRARAM, e nao das escolhidas: o
    // laco pode ter parado no meio, e dizer "2 parcelas antecipadas" de uma so
    // seria a resposta mentindo sobre o dinheiro que ela mesma movimentou.
    const message = mensagemDaAntecipacao({
      numerosAntecipados: antecipadas.map((p) => p.numero),
      ultimoVencimentoAntes: ultimoVencimentoAntes ?? "—",
      ultimoVencimentoDepois,
      // O `settled` MEDIDO, e nao deduzido de "nao sobrou vencimento": sem o
      // UPDATE ter alcancado a linha o emprestimo continua `active`, e anunciar
      // quitacao ali seria a resposta dizendo o que deveria ter ficado.
      quitado: emprestimoQuitado,
      serieRelida,
    });

    return NextResponse.json({
      // `parcelas_antecipadas` E O CONTRATO, e nao este booleano -- ver PARAR NO
      // MEIO, no cabecalho. `success` e `false` na antecipacao parcial justamente
      // para que quem le so ele nao trate 1-de-2 como 2.
      success: antecipadas.length === escolhidas.length,
      loan_id: emprestimo.id,
      caso,
      parcelas_pedidas: escolhidas.length,
      parcelas_antecipadas: antecipadas.length,
      valor: valorDaAntecipacao({ parcelasEscolhidas: antecipadas }),
      paid_date: dataDoPagamento,
      numeros: antecipadas.map((p) => p.numero),
      transacoes: antecipadas.map((p) => p.transacao),
      ultimo_vencimento_antes: ultimoVencimentoAntes,
      ultimo_vencimento_depois: ultimoVencimentoDepois,
      parcelas_em_aberto: aindaEmAberto,
      emprestimo_quitado: emprestimoQuitado,
      ...(parouPor ? { parcial: parouPor } : {}),
      message,
    });
  } catch (error) {
    console.error("MyBank loan antecipacao POST error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
