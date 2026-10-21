// ---------------------------------------------------------------------------
// PATCH /api/mybank/installments/[id] -- quem avisa e quem confirma
// ---------------------------------------------------------------------------
// MyBank, F2 da HMO-368 (issue HMO-370). Duas transicoes, uma para cada lado:
//
//   DEVEDOR:  `pending -> reported`  ("paguei, confere")
//   CREDOR:   `reported|pending -> paid`  ("recebi") -- e e ele que grava as
//             pernas de entrada, no Caso B.
//
// SO O JURO E RECEITA, E SAO DUAS PERNAS (F5 da HMO-444, issue HMO-449)
// ---------------------------------------------------------------------
// Com juro a parcela confirmada grava DUAS linhas na conta de investimento, num
// insert so:
//
//   `transfer` da parte-principal  -- principal voltando move dinheiro de
//                                     lugar, nao e receita nova
//   `income`   da parte-juros      -- o ganho, na categoria `Investimentos`
//
// O rateio e proporcional e sai da SERIE INTEIRA (`rateioDoPagamentoDaParcela`
// -> `rateioDaSerie`, F2), com a ultima parcela absorvendo o centavo da
// divisao. A juro zero nada muda: uma perna `transfer` do valor cheio, como
// antes desta issue.
//
// Os dois defeitos que isso impede -- "cobrar juros nunca aparece em Receitas" e
// "o mesmo principal conta como salario 24 vezes" -- estao por extenso no
// cabecalho da secao das pernas em `lib/emprestimo-do-mybank.ts`. Os dois somam
// o mesmo dinheiro na conta, entao saldo nenhum denuncia nenhum dos dois.
//
// ESTA ROTA NAO EXIGE MIGRATION NOVA: ela le `mybank_loans.principal` (053) e
// grava em `financial_transactions` as colunas que ja existem. A 062 (que soltou
// a trava de juro zero) e pre-requisito da F3, nao desta.
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
//
// E A ULTIMA PARCELA QUITA O EMPRESTIMO (HMO-394)
// -----------------------------------------------
// Depois da baixa, esta rota pergunta a serie inteira se sobrou algo em aberto
// (`emprestimoFicouQuitado`) e, se nao, leva o emprestimo a `settled`. E o passo
// final e nao pode desfazer nada: o dinheiro ja entrou e a parcela ja esta paga.
// Antes desta entrega NINGUEM escrevia `settled` -- o emprestimo 24/24 pago ficava
// `active` para sempre e a unica saida da tela era o botao Cancelar, que carimba
// uma divida honrada como cancelada.
// ---------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

import {
  casoDoEmprestimo,
  chaveDaParcelaDoMyBank,
  emprestimoFicouQuitado,
  mensagemDoRecebimentoDaParcela,
  NOME_DA_CATEGORIA_DO_JURO_RECEBIDO,
  patchDaQuitacaoDoEmprestimo,
  pernasDoPagamentoDaParcela,
  rateioDoPagamentoDaParcela,
  type NaturezaDaPernaDoPagamento,
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
    // `principal` ENTRA NO SELECT NA HMO-449, e e ele que separa o principal do
    // juro: `SUM(mybank_installments.amount) - principal` E O JURO do
    // emprestimo (a definicao que o `COMMENT ON COLUMN` da 062 escreve). Sem
    // esta coluna nao ha como saber quanto da parcela e ganho, e a rota so
    // saberia gravar a perna cheia -- que e o defeito de "cobrar juros nunca
    // aparece em Receitas". A coluna e da 053 e esta em producao desde entao.
    const { data: emprestimo } = await supabase
      .from("mybank_loans")
      .select(
        "id, lender_user_id, lender_account_id, borrower_user_id, description, status, principal"
      )
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
    // A SERIE INTEIRA, ANTES DE QUALQUER ESCRITA -- e dela que sai o rateio
    // -----------------------------------------------------------------------
    // ESTA LEITURA NAO E A DA QUITACAO, e as duas nao podem virar uma. Esta
    // acontece ANTES de escrever (ela decide o que escrever) e precisa do
    // `amount` de cada parcela na ORDEM da serie; a da quitacao acontece DEPOIS
    // da baixa (ela le o estado novo) e so precisa do `status`. Juntadas numa, o
    // rateio passaria a sair de uma leitura pre-baixa usada para decidir
    // `settled` -- e a parcela que acabou de ser paga apareceria em aberto.
    //
    // A ORDEM E `installment_number` PORQUE A ULTIMA PARCELA ABSORVE O CENTAVO
    // da divisao (`rateioDaSerie`, F2). Sem `order`, o PostgREST devolve na
    // ordem fisica da tabela, "a ultima" passa a ser uma linha qualquer, e o
    // centavo da sobra vai para a parcela errada -- um erro que nenhuma soma
    // denuncia, porque o TOTAL continua fechando.
    const { data: serie, error: erroDaSerie } = await supabase
      .from("mybank_installments")
      .select("id, installment_number, amount")
      .eq("loan_id", emprestimo.id)
      .order("installment_number", { ascending: true });

    if (erroDaSerie || !serie || serie.length === 0) {
      console.error(
        "MyBank: nao foi possivel ler a serie para ratear a parcela",
        { loanId: emprestimo.id, erro: erroDaSerie }
      );
      return NextResponse.json(
        {
          error:
            "Não foi possível conferir as parcelas deste empréstimo. Nada foi lançado.",
        },
        { status: 500 }
      );
    }

    const rateio = rateioDoPagamentoDaParcela({
      parcelaId: parcela.id,
      principal: emprestimo.principal,
      serie,
    });

    if (!rateio) {
      // `null` NAO E "nao ha juro": a juro zero a funcao devolve
      // `daParcela: null` DENTRO de um objeto, e a rota segue com a perna unica.
      // Aqui chegam os tres estados em que ela nao consegue responder -- o
      // `principal` ilegivel (a coluna fora do `select`), a parcela ausente da
      // serie lida, e o rateio que a F2 recusou.
      //
      // A resposta certa e NAO gravar. A tentacao e cair na perna cheia "como
      // antes": como `transfer` ela APAGA o juro do app, e como `income` ela
      // conta o principal como salario -- os dois defeitos que esta filha existe
      // para impedir, e os dois invisiveis depois, porque o saldo da conta fica
      // exato nas duas.
      console.error("MyBank: o rateio da parcela com juro nao fechou", {
        loanId: emprestimo.id,
        parcelaId: parcela.id,
      });
      return NextResponse.json(
        {
          error:
            "Não foi possível separar o principal dos juros desta parcela. Nada foi lançado.",
        },
        { status: 500 }
      );
    }

    // -----------------------------------------------------------------------
    // AS PERNAS -- uma sem juro, DUAS com juro (`transfer` + `income`)
    // -----------------------------------------------------------------------
    // So o juro e receita. O porque das duas, e o porque de o Caso A nao ter
    // nenhuma, estao por extenso em `pernasDoPagamentoDaParcela`.
    const pernas = pernasDoPagamentoDaParcela({
      caso,
      contaCredoraId: emprestimo.lender_account_id,
      valor: Number(parcela.amount),
      descricao: emprestimo.description,
      numero: parcela.installment_number,
      total: parcela.installment_total,
      rateio: rateio.daParcela,
    });

    if (pernas.length === 0) {
      // Inalcancavel hoje (`caso === "auto"` ja saiu acima), e por isso e 500 e
      // nao uma frase de produto: chegar aqui quer dizer que a decisao de pernas
      // e este ramo discordam, e a resposta certa e nao gravar nada.
      console.error(
        "MyBank: pernasDoPagamentoDaParcela devolveu vazio fora do auto-emprestimo",
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

    // -----------------------------------------------------------------------
    // UMA CATEGORIA POR NATUREZA DE PERNA, e as duas sao LIDAS e nunca criadas
    // -----------------------------------------------------------------------
    //   principal -> `Transferência entre contas` (023, `is_active = false`):
    //                transferencia nao TEM categoria, e a reservada e o que
    //                satisfaz o NOT NULL sem aparecer em seletor nenhum.
    //   juros     -> `Investimentos` (seed do baseline, `is_active = true`):
    //                juro recebido E receita, e a categoria e VISIVEL de
    //                proposito -- e por ela que o ganho aparece no relatorio por
    //                categoria.
    //
    // A categoria do juro e buscada SO QUANDO HA PERNA DE JURO. Buscar as duas
    // sempre faria o emprestimo a juro zero -- o unico que existe em producao
    // hoje -- passar a depender de uma linha de seed que ele nao usa: um banco
    // sem a `Investimentos` deixaria de receber parcela por uma categoria que
    // nao entra em lancamento nenhum dele.
    const nomeDaCategoria: Record<NaturezaDaPernaDoPagamento, string> = {
      principal: NOME_DA_CATEGORIA_DE_TRANSFERENCIA,
      juros: NOME_DA_CATEGORIA_DO_JURO_RECEBIDO,
    };

    const categoriaPorNatureza: Partial<
      Record<NaturezaDaPernaDoPagamento, string>
    > = {};

    // SEM `Set`: o `target` deste tsconfig nao itera `Set` sem
    // `downlevelIteration` (`typedroutes-so-aparece-no-next-build` e vizinho --
    // o `tsc --noEmit` do repo e quem pega isto, e so ele). O `indexOf` sobre
    // duas naturezas e de graca.
    const naturezas = pernas
      .map((p) => p.natureza)
      .filter((n, i, todas) => todas.indexOf(n) === i);

    for (const natureza of naturezas) {
      const nome = nomeDaCategoria[natureza];
      const { data: categoria } = await supabase
        .from("transaction_categories")
        .select("id")
        .eq("service_id", servico.id)
        .eq("name", nome)
        .maybeSingle();

      if (!categoria?.id) {
        console.error(
          `A categoria "${nome}" nao esta legivel no banco. ` +
            (natureza === "principal"
              ? "Aplique database/migrations/023_categoria_de_transferencia.sql."
              : "Ela e seed do baseline (001) -- confira database/seed/reference_data.sql.")
        );
        return NextResponse.json(
          {
            error: `A categoria "${nome}" não está no banco. Nada foi lançado.`,
          },
          { status: 500 }
        );
      }

      categoriaPorNatureza[natureza] = categoria.id;
    }

    // -----------------------------------------------------------------------
    // UM INSERT SO, COM AS DUAS PERNAS -- e o "um" e a parte que importa
    // -----------------------------------------------------------------------
    // Dois inserts seguidos deixariam o estado "o principal entrou e o juro
    // nao" alcancavel por uma falha de rede: a parcela ficaria em aberto com
    // parte do dinheiro no extrato, e o juro daquele mes nao existiria em lugar
    // nenhum. Num insert so o PostgREST executa um comando: ou as duas linhas
    // entram, ou nenhuma entra.
    //
    // `...perna.linha` E NAO `...perna`: `natureza` e pergunta de dominio e nao
    // coluna. Espalhado inteiro, o PostgREST recusaria o lote com PGRST204 --
    // ver `PernaDoPagamentoDaParcela`.
    //
    // AS DUAS LINHAS TEM AS MESMAS CHAVES, e isso nao e coincidencia: o cliente
    // monta as colunas do lote a partir da PRIMEIRA linha, e uma chave presente
    // so na segunda e DESCARTADA em silencio. `perna.linha` tem sempre os
    // mesmos quatro campos, e `category_id` vem do mapa para as duas.
    const comum = {
      user_id: user.id,
      service_id: servico.id,
      group_id: null,
      is_shared: false,
      transaction_date: dataDoPagamento,
      // A chave canonica do elo, a mesma convencao do `acerto:<id>` da
      // HMO-366: sem ela nao ha como achar a perna a partir da parcela depois.
      // AS DUAS pernas a levam, como o par do Caso A ja faz
      // (`chave-mybank-esta-nas-duas-pernas-no-caso-a`): o elo responde "de que
      // parcela e esta linha", e as duas sao da mesma parcela.
      notes: chaveDaParcelaDoMyBank(parcela.id),
    };

    const { data: lancamentos, error: erroDaPerna } = await supabase
      .from("financial_transactions")
      .insert(
        pernas.map((perna) => ({
          ...comum,
          category_id: categoriaPorNatureza[perna.natureza] as string,
          ...perna.linha,
        }))
      )
      .select("id");

    if (erroDaPerna || !lancamentos || lancamentos.length !== pernas.length) {
      console.error("Erro ao lancar a entrada do recebimento:", erroDaPerna);
      return NextResponse.json(
        { error: "Não foi possível lançar o recebimento. A parcela continua em aberto." },
        { status: 500 }
      );
    }

    // `paid_transaction_id` APONTA PARA A PERNA DO PRINCIPAL, e nao para a do
    // juro: aquela coluna responde "onde este dinheiro entrou", e com duas
    // linhas a resposta tem de ser a que representa a parcela -- a que
    // `ehEntradaSoltaDoMyBank` reconhece como a perna da parcela do MyBank. A
    // perna de juro e uma receita que se le pelo elo em `notes`, como qualquer
    // outra linha do par.
    //
    // O FALLBACK PARA 0 COBRE A PARCELA DE JURO PURO (parte-principal zero,
    // omitida por `pernasDoPagamentoDaParcela`): ali a unica linha gravada e a
    // do juro, e e para ela que a parcela aponta. Um `pernas[0]` cru daria a
    // resposta certa nesse caso e a ERRADA no comum, onde a ordem das pernas e
    // detalhe de montagem e nao contrato.
    const indiceDoPrincipal = pernas.findIndex(
      (p) => p.natureza === "principal"
    );
    const lancamento =
      lancamentos[indiceDoPrincipal >= 0 ? indiceDoPrincipal : 0];

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
      // AS PERNAS JA ESTAO GRAVADAS, e desfaze-las seria apagar dinheiro que
      // entrou de verdade na conta. O que falhou foi a baixa da parcela: o
      // estado honesto e "o dinheiro entrou e a parcela continua em aberto",
      // com o id do lancamento na resposta para quem for consertar.
      //
      // `transaction_id` continua SINGULAR no corpo, e aponta a perna do
      // principal: e a mesma coluna que `paid_transaction_id` guardaria, e quem
      // achar essa linha acha a de juro pelo elo `mybank:<id>` que as duas
      // levam. Trocar o nome do campo quebraria o contrato de quem le a
      // resposta por uma informacao que o elo ja da.
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

    // -----------------------------------------------------------------------
    // O EMPRESTIMO SE DECLARA `settled` -- consequencia, e nao a operacao
    // -----------------------------------------------------------------------
    // Daqui para baixo NADA e desfeito: a parcela esta paga e o dinheiro entrou.
    // Se qualquer um destes dois passos falhar, o emprestimo fica `active` com
    // todas as parcelas pagas -- que e exatamente o estado em que esta rota
    // deixava TODO emprestimo antes da HMO-394, e que e correto em dinheiro.
    const { data: parcelasDoEmprestimo, error: erroDaReleitura } = await supabase
      .from("mybank_installments")
      .select("id, status")
      .eq("loan_id", emprestimo.id);

    let emprestimoQuitado = false;

    // A RELEITURA E A FONTE, e nao a parcela em maos: a decisao e sobre a SERIE
    // inteira, e esta rota so conhece uma linha dela. A leitura ja ve a baixa
    // acima porque ela foi gravada antes -- e se a releitura falhar, nao ha
    // quitacao a declarar e tambem nao ha nada a consertar.
    if (!erroDaReleitura && parcelasDoEmprestimo) {
      if (emprestimoFicouQuitado({ parcelas: parcelasDoEmprestimo })) {
        const { data: quitados, error: erroDaQuitacao } = await supabase
          .from("mybank_loans")
          .update(patchDaQuitacaoDoEmprestimo())
          .eq("id", emprestimo.id)
          .select("id, status");

        // O `.length` DE NOVO, e aqui ele tem caminho real: `mybank_loans_update`
        // e `lender_user_id = auth.uid()`, e UPDATE que a policy filtra volta 200
        // com zero linha neste app -- sem erro e sem SQLSTATE. Quem chega a este
        // ramo e o credor, entao a filtragem nao deveria acontecer; se acontecer,
        // responder "quitado" seria afirmar um status que nenhuma tela leria.
        emprestimoQuitado =
          !erroDaQuitacao && !!quitados && quitados.length > 0;

        if (!emprestimoQuitado) {
          console.error(
            "MyBank: a ultima parcela foi paga e o emprestimo nao virou settled.",
            { loanId: emprestimo.id, erro: erroDaQuitacao }
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      status: "paid",
      transaction_id: lancamento.id,
      paid_date: dataDoPagamento,
      // O estado do EMPRESTIMO sai na resposta porque a lista de onde a pessoa
      // clicou filtra `active`: a linha vai desaparecer dela, e desaparecer sem
      // explicacao se le como erro. `false` aqui tambem cobre a falha silenciosa
      // acima -- a resposta diz o que ficou, nao o que deveria ter ficado.
      emprestimo_quitado: emprestimoQuitado,
      // O JURO DESTA PARCELA SAI NA RESPOSTA, e ele e o numero que a tela nao
      // tem de onde derivar: a parcela diz `amount`, e quanto daquilo foi ganho
      // depende do principal do emprestimo e da posicao na serie. Zero quando
      // nao ha juro, e nao ausente -- um campo que aparece e desaparece faz a
      // tela precisar distinguir `undefined` de 0 para saber se a rota e velha.
      juros_da_parcela: rateio.daParcela?.parteDosJuros ?? 0,
      message: mensagemDoRecebimentoDaParcela({
        quitado: emprestimoQuitado,
        juroDaParcela: rateio.daParcela?.parteDosJuros ?? 0,
      }),
    });
  } catch (error) {
    console.error("MyBank installments PATCH error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
