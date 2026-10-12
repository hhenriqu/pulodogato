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
//   2.5. SO NO CASO A: ler as previsoes da cauda pelo elo e recusar, com NADA
//      gravado, se faltar a de alguma parcela -- e DA PREVISAO que sai a conta
//      de onde o dinheiro e debitado;
//   3. POR PARCELA, UMA DE CADA VEZ: gravar a perna de entrada e so depois a
//      baixa. Se a baixa falhar, APAGAR A PERNA que acabou de entrar e parar --
//      o mesmo rollback que a baixa da previsao faz, pelo mesmo motivo: perna
//      sem parcela baixada e dinheiro no extrato que nenhuma divida explica.
//      NO CASO A sao DUAS pernas e a previsao tambem e baixada, e os tres passos
//      saem de `baixaDaTransferenciaPrevista` -- o mesmo codigo que Contas a
//      Pagar chamaria, com o mesmo desfazimento;
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
//
// O CASO A ENTRA AQUI DESDE A F3 (HMO-396), E AS PREVISOES SAO BAIXADAS
// --------------------------------------------------------------------
// A F2 RECUSAVA o Caso A com uma frase que apontava para Contas a Pagar -- a
// convencao do `PATCH` da parcela (`installments/[id]/route.ts:226`), e pela
// mesma razao: a parcela do auto-emprestimo JA e transferencia prevista. A F3
// derrubou aquela recusa por uma razao de dinheiro: a parcela da cauda vence em
// 2028, e a previsao dela pode estar FORA DO HORIZONTE de Contas a Pagar
// (`skipped-protege-so-o-horizonte-ja-materializado`). O ponteiro mandava a
// pessoa para uma tela onde a linha podia nao estar.
//
// O `PATCH` da parcela CONTINUA recusando `paid` no Caso A, e isso nao e
// incoerencia: lá a recusa esta certa (marcar `paid` sem mover dinheiro deixaria
// o emprestimo andando de graca) e AQUI a rota move o dinheiro.
//
// Entao no Caso A a rota faz o trabalho, e faz chamando o mesmo codigo que
// Contas a Pagar chamaria: `baixaDaTransferenciaPrevista`
// (`lib/services/baixa-da-transferencia-prevista.ts`) -- duas pernas, a parcela
// `paid` e a previsao BAIXADA, nessa ordem, com os desfazimentos. A previsao
// vira `paid` e NAO e apagada: ela e o registro de que o dinheiro se moveu. O
// cancelamento apaga as mesmas linhas, pelo mesmo elo, porque lá nada se moveu
// -- mesmo elo, criterio oposto, e o oposto e o ponto.
//
// As pernas do Caso A sao DUAS (saida da corrente, entrada no investimento) e no
// Caso B e UMA (o dinheiro vem de fora das minhas contas). E por isso que
// `pernaDeEntradaDoPagamento` devolve `null` no Caso A: as duas pernas de lá nao
// sao a mesma decisao, e misturar as duas contaria o dinheiro duas vezes.
// ---------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

import {
  casoDoEmprestimo,
  chaveDaParcelaDoMyBank,
  chavesDasPrevisoesDaAntecipacao,
  emprestimoFicouQuitado,
  mensagemDaAntecipacao,
  mensagemDaPrevisaoDaCaudaAusente,
  mensagemDoProblemaDaAntecipacao,
  paresDaAntecipacaoDoCasoA,
  parcelasDaAntecipacao,
  patchDaBaixaDaParcela,
  patchDaQuitacaoDoEmprestimo,
  pernaDeEntradaDoPagamento,
  problemaDaAntecipacao,
  quantasEmAberto,
  ultimoVencimentoEmAberto,
  valorDaAntecipacao,
  type PrevisaoABaixar,
} from "@/lib/emprestimo-do-mybank";
import { hojeISO } from "@/lib/lancamento";
import { baixaDaTransferenciaPrevista } from "@/lib/services/baixa-da-transferencia-prevista";
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
      // 403 so para "nao e seu". 400 para corpo malformado, e 409 para o que
      // conflita com o estado da divida.
      const codigo =
        problema === "nao_sou_o_credor"
          ? 403
          : problema === "quantas_invalida"
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
    //
    // A EXIGENCIA DA CATEGORIA NAO E SO DO CASO B, e por isso ela nao esta num
    // ramo: no Caso A as pernas herdam o `category_id` DA PREVISAO, e aquele
    // valor e esta mesma categoria reservada -- `previsoesDoEmprestimo` a gravou
    // na criacao da serie. Uma antecipacao do Caso A num banco sem a 023 criaria
    // pernas apontando para uma categoria que nao existe mais.
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
    // 2.5. CASO A: as previsoes da cauda, pelo elo -- LIDAS ANTES DA ESCRITA
    // -----------------------------------------------------------------------
    // Ler agora e o que permite recusar, com NADA gravado, o Caso A cuja parcela
    // da cauda nao tem conta a pagar. Descobrir isso na terceira parcela de
    // quatro deixaria duas antecipadas e uma recusa, pelo motivo mais confuso
    // possivel -- e a conta de onde o dinheiro sai mora NA PREVISAO, nao no
    // emprestimo (ver o cabecalho da secao do Caso A em
    // `lib/emprestimo-do-mybank.ts`).
    const previsaoDaParcela = new Map<string, PrevisaoABaixar>();

    const chaves = chavesDasPrevisoesDaAntecipacao({
      caso,
      parcelasAntecipadas: escolhidas,
    });

    // A GUARDA DO `.length`, E ELA NAO E ECONOMIA DE CHAMADA -- a MESMA do
    // cancelamento (`loans/[id]/route.ts`), e aqui o estrago e pior.
    //
    // No Caso B a lista e vazia por decisao (`chavesDasPrevisoesDaAntecipacao`
    // devolve `[]`: nao existe previsao minha), e `.in("notes", [])` NAO FILTRA
    // -- a clausula vazia desaparece e a consulta alcanca TODA linha que a RLS
    // entrega. No cancelamento o verbo era DELETE e apagava a agenda inteira;
    // aqui as linhas lidas sao as que virao a ser BAIXADAS, e o Caso B passaria
    // a exigir previsao para parcelas que nunca tiveram uma -- recusando toda
    // antecipacao de conexao em 409, ou baixando a conta a pagar errada se o
    // `notes` de alguma casar.
    //
    // E E POR ISSO QUE A PERGUNTA E `chaves.length`, E NAO `caso === "auto"`:
    // as duas sao a mesma hoje, e a do `.length` e a que continua certa se a
    // regra do elo mudar de ideia sobre algum caso.
    if (chaves.length > 0) {
      const { data: previsoes, error: erroDasPrevisoes } = await supabase
        .from("scheduled_transactions")
        .select(
          "id, account_id, destination_account_id, description, amount, due_date, category_id, notes, created_at"
        )
        // `user_id` EXPLICITO, como no cancelamento: `notes` e campo que a pessoa
        // digita, e nada impede a previsao de outra conta de ter `mybank:<id>`
        // ali. A RLS tambem barra, e esta e a camada que nao depende dela.
        .eq("user_id", user.id)
        // `pending` SO. A previsao ja `paid` e fato consumado, e a parcela dela
        // nao estaria em aberto para entrar na cauda -- mas o filtro nao e
        // redundante: sem ele uma previsao baixada a mao seria re-baixada, com
        // `transaction_id` repontado para a perna nova e a perna antiga orfa.
        .eq("status", "pending")
        .in("notes", chaves);

      if (erroDasPrevisoes || !previsoes) {
        console.error(
          "Erro ao ler as previsoes da cauda a antecipar:",
          erroDasPrevisoes
        );
        return NextResponse.json(
          {
            error:
              "Não foi possível ler as contas a pagar destas parcelas. Nada foi antecipado.",
          },
          { status: 500 }
        );
      }

      const { pares, parcelasSemPrevisao } = paresDaAntecipacaoDoCasoA({
        escolhidas,
        previsoes,
      });

      if (parcelasSemPrevisao.length > 0) {
        // 409 E NAO 500: o estado do banco e legivel e coerente -- a parcela
        // existe, a conta a pagar dela nao. Nada foi escrito, e a frase diz
        // quais parcelas e onde conferir.
        return NextResponse.json(
          {
            error: mensagemDaPrevisaoDaCaudaAusente(parcelasSemPrevisao),
            parcelas_antecipadas: 0,
          },
          { status: 409 }
        );
      }

      for (const par of pares) {
        previsaoDaParcela.set(par.parcela.id, par.previsao);
      }
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

    /** Quantas previsoes da cauda foram BAIXADAS (Caso A). Nunca apagadas. */
    let previsoesBaixadas = 0;

    for (const parcela of escolhidas) {
      // ---------------------------------------------------------------------
      // CASO A: duas pernas, a parcela e a PREVISAO BAIXADA -- pelo servico
      // ---------------------------------------------------------------------
      // `baixaDaTransferenciaPrevista` e o passo 2/2.5/3 da rota da baixa, e
      // chamar o mesmo codigo e a entrega desta fase: antecipar a parcela 24 faz
      // exatamente o que fazer ela em Contas a Pagar faria, na mesma ordem e com
      // os mesmos desfazimentos. A previsao vira `paid` -- BAIXADA, nao apagada:
      // ela e o registro de que o dinheiro se moveu, e e o oposto do
      // cancelamento, que apaga porque lá nada se moveu.
      if (caso === "auto") {
        const previsao = previsaoDaParcela.get(parcela.id);

        if (!previsao) {
          // Inalcancavel: o passo 2.5 recusou a antecipacao inteira quando
          // faltava qualquer previsao. Chegar aqui quer dizer que o
          // emparelhamento e este laco discordam, e a resposta certa e nao
          // gravar mais nada.
          console.error(
            "MyBank: parcela da cauda sem previsao no laco da antecipacao",
            { parcelaId: parcela.id, loanId: emprestimo.id }
          );
          parouPor = `A parcela ${parcela.installment_number} não tem conta a pagar.`;
          break;
        }

        const movimento = await baixaDaTransferenciaPrevista({
          supabase,
          userId: user.id,
          serviceId: servico.id,
          conta: previsao,
          // O VALOR SAI DA PARCELA, e nao da previsao -- e as duas podem
          // DIVERGIR. A previsao e editavel em Contas a Pagar: nada impede a
          // pessoa de ter mudado o valor dela a mao. A divida e a parcela, e e a
          // soma das parcelas que `valorDaAntecipacao` devolve na resposta --
          // deixar a previsao mandar faria o dinheiro que se move divergir do
          // valor que a propria resposta afirma ter movido, e a invariante
          // `soma(recebido) + soma(em aberto) = principal` quebraria calada.
          valorPago: Number(parcela.amount),
          paidDate: dataDoPagamento,
          parcela: { id: parcela.id },
        });

        if (!movimento.ok) {
          // O servico ja desfez o que esta parcela tinha escrito -- as pernas, e
          // a parcela quando foi a previsao que falhou. As anteriores ficaram
          // inteiras, e o laco para: insistir nas seguintes depois de uma falha
          // de escrita so aumenta a chance de parar num estado pior.
          console.error("Antecipacao do Caso A desfeita nesta parcela:", {
            parcelaId: parcela.id,
            parouEm: movimento.parouEm,
          });
          parouPor = `A parcela ${parcela.installment_number} não pôde ser antecipada, e o que ela havia lançado foi desfeito.`;
          break;
        }

        previsoesBaixadas += 1;

        antecipadas.push({
          id: parcela.id,
          numero: parcela.installment_number,
          amount: Number(parcela.amount),
          vencimento: String(parcela.due_date),
          // A PERNA DE ENTRADA, como no Caso B: e a que `paid_transaction_id`
          // aponta, e e a que responde "onde este dinheiro entrou". A de saida
          // esta no elo da previsao.
          transacao: movimento.txEntrada.id,
        });

        continue;
      }

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
        // Inalcancavel: o Caso A saiu por `continue` acima, e so ele devolve
        // `null`. Chegar aqui quer dizer que a decisao de pernas e esta rota
        // discordam sobre qual caso e qual, e a resposta certa e nao gravar mais
        // nada -- uma perna no caso errado daria ao auto-emprestimo uma TERCEIRA
        // perna e contaria o mesmo dinheiro duas vezes.
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
      // A FRASE DO CASO A diz o que mudou na OUTRA tela: as contas a pagar
      // daquelas parcelas foram baixadas, e o dinheiro saiu da conta corrente.
      caso,
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
      // QUANTAS PREVISOES FORAM BAIXADAS -- `0` no Caso B, onde nao existe
      // previsao minha. E o campo que a medicao em producao confere contra as
      // linhas de Contas a Pagar: `previsoes_baixadas: 2` com duas linhas
      // `paid` e o que distingue "baixadas" de "apagadas", e um DELETE no lugar
      // do UPDATE devolveria este mesmo numero com as linhas sumidas -- por isso
      // a medicao conta as linhas, e nao acredita no campo.
      previsoes_baixadas: previsoesBaixadas,
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
