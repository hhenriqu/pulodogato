// ---------------------------------------------------------------------------
// POST /api/mybank/loans -- criar o emprestimo + a serie de parcelas
// GET  /api/mybank/loans -- os meus emprestimos, com valor, `n de m` e quem deve
// ---------------------------------------------------------------------------
// MyBank, F2 da HMO-368 (issue HMO-370). As tabelas sao da migration 053; a
// aritmetica e a decisao de quais pernas cada caso gera estao em
// `lib/emprestimo-do-mybank.ts`, e nao aqui.
//
// A ROTA RECUSA ANTES; O BANCO E A REDE DE SEGURANCA, NAO A UX
// -----------------------------------------------------------
// As duas travas da 053 (conta credora de investimento do proprio credor;
// devedor igual ao credor ou conexao `accepted`) sao trigger, e trigger responde
// `check_violation` com um texto que nenhuma tela quer mostrar. Esta rota
// pergunta as mesmas duas coisas antes e devolve 400 com frase legivel. As duas
// camadas nao sao redundancia: quem chega pelo PostgREST direto nao passa por
// aqui, e e a trigger que o segura.
//
// TRES INSERTS, NESTA ORDEM, E POR QUE NAO DA PARA SER MENOS
// ---------------------------------------------------------
//   1. `mybank_loans`      -- 1 linha. O `loan_id` so existe depois dela.
//   2. `mybank_installments` -- as N parcelas num insert SO (a forma de
//      `/api/financial-installments`): um laco de N inserts pode parar no meio e
//      a divida ficaria gravada pela metade, com a soma das parcelas deixando de
//      fechar com o `principal` sem que nenhuma linha estivesse errada sozinha.
//   3. SO NO CASO A: `scheduled_transactions` -- as N transferencias previstas,
//      tambem num insert so. Elas levam o `mybank_installments.id` no elo, que
//      e o motivo de este passo vir DEPOIS do 2.
//
// O PASSO 3 FALHANDO DESFAZ O EMPRESTIMO, E ISSO E DIFERENTE DA ROTA DE PARCELAS
// -----------------------------------------------------------------------------
// Em `/api/financial-installments` o `UPDATE` da amarra pode falhar sem derrubar
// a resposta, porque as linhas de dinheiro ja estao gravadas e aparecem na
// fatura -- o que se perde e a amarra. Aqui nao: no Caso A as previsoes sao o
// UNICO jeito de a parcela aparecer em Contas a Pagar. Um emprestimo com
// parcelas e sem previsao e uma divida que a pessoa nunca ve para pagar, e ela
// nao tem como descobrir que faltou. Entao o passo 3 que falha apaga o
// emprestimo (o `ON DELETE CASCADE` de `loan_id` leva as parcelas) e a resposta
// diz que nada foi gravado.
//
// A CHAVE DO PEDIDO: `id` VINDO DO CLIENTE, E `23505` RESPONDIDO COM 200 (HMO-390)
// -------------------------------------------------------------------------------
// Esta rota nao tinha idempotencia nenhuma, e `mybank_loans` nao tem UNIQUE
// sobre `(lender, borrower, principal, first_due_date)`: dois POSTs iguais
// criavam DUAS dividas de 24 meses. O `disabled` da tela nao alcanca o caminho
// mais provavel -- recarregar a pagina e reenviar o mesmo formulario.
//
// O conserto usa a unicidade que a 053 JA tem: o cliente escolhe o `id`, a rota
// insere com ele, e o segundo POST bate na PK. `23505` nao e erro aqui; e a
// resposta "esse pedido ja virou linha", e a rota devolve 200 com a linha.
//
// Tres coisas que fazem isto ser seguro, e cada uma esta comentada no ponto onde
// mora:
//
//   1. o `id` e conferido como uuid ANTES (senao 22P02 viraria um 500);
//   2. no insert ele e ESPALHADO condicionalmente -- `id: null` explicito
//      derrubaria o `DEFAULT gen_random_uuid()` da coluna;
//   3. no `23505` a linha relida e conferida com `lender_user_id === user.id`.
//      A policy de SELECT da 053 e `lender OR borrower`: sem esta conferencia um
//      id colidido devolveria o emprestimo de OUTRA pessoa.
//
// OS JUROS, NOS DOIS SENTIDOS (F3 da HMO-444, issue HMO-448)
// ----------------------------------------------------------
// O POST passa a receber `modo_do_juro` + `taxa` OU `total`, e a mudanca de
// dinheiro e uma so: **a serie e montada sobre o TOTAL A RECEBER, e `principal`
// guarda o EMPRESTADO.** Antes desta issue os dois eram o mesmo numero. A
// aritmetica e toda da F2 (`lib/juros-do-emprestimo.ts`) e a escolha de qual
// numero vai onde e das tres funcoes de `lib/emprestimo-do-mybank.ts`
// (`valorQueMontaASerie`, `baseQueMontaASerie`, `principalQueVaiParaAColuna`).
//
// ESTA ROTA EXIGE A MIGRATION 062 COLADA, E A EXIGENCIA E TOTAL -- NAO SO PARA
// O EMPRESTIMO COM JURO
// ---------------------------------------------------------------------------
// O insert do passo 1 NOMEIA `interest_kind`, que e coluna da 062. Com a 062
// nao colada, o PostgREST responde `PGRST204 Could not find the 'interest_kind'
// column in the schema cache` -- no cache de schema, ANTES de qualquer RLS ou
// privilegio -- e TODO emprestimo para de ser criado, inclusive o a juro zero.
// Familia `select-que-nomeia-coluna-nova-derruba-a-rota-antes-da-colagem`.
//
// Isso e deliberado, e e por isso que a issue manda a colagem vir antes do
// merge: a alternativa (omitir a coluna no caso de juro zero, deixando o
// `DEFAULT 'total_simples'` responder) trocaria uma falha ALTA e imediata por
// uma silenciosa -- o emprestimo com juro continuaria quebrado, e no dia em que
// a 062 ganhar um segundo valor de `interest_kind` o default decidiria a
// convencao de uma linha cuja aritmetica esta rodando aqui. A rota declara qual
// convencao ela calculou; ela nao herda uma.
// ---------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

import {
  baseQueMontaASerie,
  casoDoEmprestimo,
  CONVENCAO_DO_JURO_DO_EMPRESTIMO,
  juroDoPedido,
  linhasDasParcelas,
  mensagemDoProblema,
  parcelaAConfirmar,
  previsoesDoEmprestimo,
  principalQueVaiParaAColuna,
  problemaDoEmprestimo,
  problemaDoJuroDoPedido,
  quemDevePagar,
  serieDoEmprestimo,
  valorQueMontaASerie,
  type ModoDoJuro,
  type ParcelaGravada,
} from "@/lib/emprestimo-do-mybank";
import type { BaseDoValorParcelado } from "@/lib/lancamento";
import { ehUuid } from "@/lib/pedido-de-emprestimo";
import { NOME_DA_CATEGORIA_DE_TRANSFERENCIA } from "@/lib/transferencia";

/**
 * A categoria reservada das pernas. SO LEITURA -- ela e seed (migration 023).
 *
 * `scheduled_transactions.category_id` e NOT NULL (005) e transferencia nao tem
 * categoria. A linha esta no banco com `is_active = false`, que e o que a mantem
 * fora dos dois seletores de categoria do app, e uma policy propria da 023 e o
 * que a torna legivel mesmo desativada.
 *
 * NAO TENTAR CRIA-LA: `transaction_categories` e tabela de REFERENCIA, o
 * `002_rls_lockdown` so deu `GRANT SELECT`, e o insert volta 42501 em toda
 * chamada -- foi assim que a transferencia passou meses respondendo 500 em
 * producao sem ninguem ver. Ausencia dela e schema desatualizado, e o log diz
 * exatamente isso.
 */
async function categoriaDaTransferencia(
  supabase: ReturnType<typeof createClient>,
  serviceId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("transaction_categories")
    .select("id")
    .eq("service_id", serviceId)
    .eq("name", NOME_DA_CATEGORIA_DE_TRANSFERENCIA)
    .maybeSingle();

  if (data?.id) return data.id;

  console.error(
    `A categoria "${NOME_DA_CATEGORIA_DE_TRANSFERENCIA}" nao esta legivel no banco. ` +
      "Aplique database/migrations/023_categoria_de_transferencia.sql.",
    error
  );
  return null;
}

export async function POST(request: NextRequest) {
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
    const {
      // O id DO EMPRESTIMO, ESCOLHIDO PELO CLIENTE (HMO-390). Ver o bloco
      // "A CHAVE DO PEDIDO" no cabecalho deste arquivo.
      id,
      descricao,
      conta_credora_id,
      conta_de_pagamento_id,
      devedor_id,
      // O VALOR VAI CRU, COM A PERGUNTA AO LADO (HMO-211)
      //
      // O cliente manda o que foi digitado (`valor`) e o que aquilo significa
      // (`base`), e e o SERVIDOR que faz a conta, com a mesma funcao pura que a
      // tela usa para mostrar o resumo. Receber o total ja multiplicado poria a
      // aritmetica do dinheiro no cliente.
      valor,
      base,
      parcelas,
      primeiro_vencimento,
      // OS JUROS, NOS DOIS SENTIDOS (HMO-448). Ver o bloco "OS JUROS" abaixo.
      //
      // `juros` (o campo da fase 1, que so aceitava 0) SAIU do contrato: ele
      // nomeava uma coisa que nao existe mais. O que entra e o MODO e um dos
      // dois numeros -- `taxa` OU `total`.
      modo_do_juro,
      taxa,
      total,
    } = body as {
      /** A chave do pedido. Ausente = a coluna usa o `DEFAULT gen_random_uuid()`. */
      id?: string | null;
      descricao?: string;
      conta_credora_id?: string | null;
      conta_de_pagamento_id?: string | null;
      /** `null`/ausente = auto-emprestimo. Ver `casoDoEmprestimo`. */
      devedor_id?: string | null;
      valor?: string | number;
      base?: BaseDoValorParcelado;
      parcelas?: number;
      primeiro_vencimento?: string;
      /**
       * `sem_juros` (ou ausente) = o caminho de antes desta issue, INTACTO.
       *
       * AUSENTE CAI EM `sem_juros` DE PROPOSITO, e isso nao e tolerancia: quem
       * chega pelo PostgREST direto, pela fila offline ou por uma sonda escrita
       * antes desta issue manda o corpo velho, e o corpo velho descreve um
       * emprestimo a juro zero perfeitamente valido. Um `400 modo ausente`
       * quebraria todos eles por um campo que nao muda o pedido deles.
       */
      modo_do_juro?: ModoDoJuro;
      /** A taxa em PERCENTO ("20" = 20%). Modo `taxa`. */
      taxa?: string | number;
      /** O total a receber, em reais. Modo `total`. */
      total?: string | number;
    };

    const contaCredoraPedida = conta_credora_id || null;
    const contaDePagamentoPedida = conta_de_pagamento_id || null;

    // A CHAVE DO PEDIDO, CONFERIDA COMO uuid ANTES DE VIRAR CHAVE PRIMARIA.
    //
    // Sem esta peneira um `id: "abc"` chega ao Postgres e volta
    // `22P02 invalid input syntax for type uuid` -- que esta rota devolveria
    // como 500 "erro interno". Um pedido malformado respondendo 500 nao se le
    // como pedido malformado em log nenhum, e o 400 daqui diz o que esta errado.
    const pedidoId = id || null;

    if (pedidoId !== null && !ehUuid(pedidoId)) {
      return NextResponse.json(
        { error: "O identificador do pedido não é um UUID." },
        { status: 400 }
      );
    }

    // AUSENTE QUER DIZER "EU MESMO", e a coluna continua NOT NULL no banco.
    //
    // A 053 fez `borrower_user_id` NOT NULL de proposito: "emprestimo para mim
    // mesmo" fica explicito na linha e nenhuma leitura precisa tratar NULL como
    // "eu". A tela, por outro lado, tem um radio "eu mesmo / uma conexao" --
    // entao a traducao de ausencia para o meu id e aqui, num lugar so.
    const devedorId = devedor_id || user.id;
    const caso = casoDoEmprestimo({
      lenderUserId: user.id,
      borrowerUserId: devedorId,
    });

    const numeroDeParcelas = Number(parcelas);

    // -----------------------------------------------------------------------
    // OS JUROS: O PEDIDO E RESOLVIDO ANTES DA SERIE, PORQUE A SERIE DEPENDE DELE
    // -----------------------------------------------------------------------
    // Este e o ponto exato onde o dinheiro muda de valor. Com juro, o que foi
    // digitado no campo de valor e o EMPRESTADO, e a serie e montada sobre o
    // TOTAL A RECEBER -- as duas grandezas deixam de ser o mesmo numero, e a
    // diferenca delas e o juro. As tres funcoes abaixo sao as donas dessa
    // escolha, e nenhuma delas tem aritmetica: ela toda vive na F2
    // (`lib/juros-do-emprestimo.ts`), que e a MESMA funcao que a previa da tela
    // chama antes do clique (`previa-na-tela-tem-que-usar-o-peso-do-fechamento`).
    const modo: ModoDoJuro = modo_do_juro ?? "sem_juros";

    const juro = juroDoPedido({
      modo,
      emprestado: String(valor ?? ""),
      taxaPercentual: String(taxa ?? ""),
      totalARceber: String(total ?? ""),
    });

    const serie = serieDoEmprestimo({
      // O TOTAL quando ha juro, o digitado quando nao ha. O mutante que troca
      // isto pelo `principal` e o que a issue manda matar: ele grava a taxa
      // certa, devolve o total certo na resposta, e as parcelas somam o
      // EMPRESTADO -- juro nenhum cobrado, e nenhuma linha invalida no banco.
      valor: valorQueMontaASerie({ modo, digitado: String(valor ?? ""), juro }),
      // `base` ainda pode ser invalida aqui; `problemaDoEmprestimo` e quem
      // recusa com a frase. Passar o valor cru faz `serieDeParcelas` devolver
      // `null`, que e tratado pelo mesmo caminho.
      base: baseQueMontaASerie({ modo, daTela: base }) as BaseDoValorParcelado,
      parcelas: numeroDeParcelas,
      primeiroVencimento: String(primeiro_vencimento ?? ""),
    });

    // AS DUAS CONTAS SAO LIDAS JUNTAS, E COM `user_id` NO FILTRO
    //
    // Conta de outra pessoa volta como "nao encontrada", que e a resposta certa:
    // dizer "essa conta nao e sua" confirmaria que o id existe. E a mesma razao
    // pela qual a trigger da 053 nao distingue "nao e sua" de "nao e de
    // investimento".
    const idsDeConta = [contaCredoraPedida, contaDePagamentoPedida].filter(
      (x): x is string => Boolean(x)
    );

    const { data: contas } = idsDeConta.length
      ? await supabase
          .from("financial_accounts")
          .select("id, account_type")
          .eq("user_id", user.id)
          .in("id", idsDeConta)
      : { data: [] as { id: string; account_type: string | null }[] };

    const achar = (id: string | null) =>
      id === null ? null : (contas ?? []).find((c) => c.id === id) ?? null;

    const contaCredora = achar(contaCredoraPedida);
    const contaDePagamento = achar(contaDePagamentoPedida);

    // A CONEXAO E CONSULTADA SO NO CASO QUE PRECISA DELA
    //
    // `user_connections` tem `CHECK (requester_id <> requested_id)`: ninguem e
    // conexao de si mesmo, entao perguntar no auto-emprestimo devolveria
    // "nenhuma" e recusaria o caso principal da issue. A consulta cruza os DOIS
    // lados porque o pedido pode ter partido de qualquer um dos dois -- e a
    // mesma leitura que a trigger da 053 faz.
    let conexaoAceita = false;
    if (caso === "conexao") {
      const { data: conexoes } = await supabase
        .from("user_connections")
        .select("id")
        .eq("status", "accepted")
        .or(
          `and(requester_id.eq.${user.id},requested_id.eq.${devedorId}),` +
            `and(requested_id.eq.${user.id},requester_id.eq.${devedorId})`
        );

      conexaoAceita = (conexoes ?? []).length > 0;
    }

    const problema = problemaDoEmprestimo({
      descricao: String(descricao ?? ""),
      // A BASE EFETIVA, e nao a do corpo: com juro ela e `total` cravado (a
      // serie e montada sobre o total a receber) e a pergunta `parcela|total`
      // nao e feita na tela. Passar a do corpo recusaria com
      // `base_do_valor_ausente` todo pedido com juro que nao mandasse um campo
      // que aquele modo nao tem.
      base: baseQueMontaASerie({ modo, daTela: base }),
      caso,
      contaCredoraPedida,
      contaCredora,
      contaDePagamentoPedida,
      contaDePagamento,
      conexaoAceita,
      problemaDoJuro: problemaDoJuroDoPedido({
        modo,
        emprestado: String(valor ?? ""),
        taxaPercentual: String(taxa ?? ""),
        totalARceber: String(total ?? ""),
      }),
      parcelas: numeroDeParcelas,
      serie,
    });

    if (problema) {
      return NextResponse.json(
        { error: mensagemDoProblema(problema) },
        { status: 400 }
      );
    }

    // `problemaDoEmprestimo` ja garantiu os tres, mas o TypeScript nao sabe
    // disso: o estreitamento mora dentro da funcao pura, que e exatamente onde
    // ele deve morar.
    const serieFechada = serie!;
    const credora = contaCredora!;

    // -----------------------------------------------------------------------
    // CASO A: a categoria reservada e lida ANTES de gravar qualquer coisa
    // -----------------------------------------------------------------------
    // Se ela faltar, o passo 3 falharia e o emprestimo teria de ser desfeito --
    // uma ida e volta ao banco por um problema de schema que da para descobrir
    // antes. No Caso B nao ha previsao nenhuma, e por isso a leitura esta dentro
    // do ramo: exigi-la sempre faria "emprestar para a Lais" depender de um seed
    // que o Caso B nao usa.
    let categoriaId: string | null = null;
    if (caso === "auto") {
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

      categoriaId = await categoriaDaTransferencia(supabase, servico.id);

      if (!categoriaId) {
        return NextResponse.json(
          {
            error:
              "A categoria reservada de transferência não está no banco. Nada foi gravado.",
          },
          { status: 500 }
        );
      }
    }

    // -----------------------------------------------------------------------
    // 1. O emprestimo
    // -----------------------------------------------------------------------
    // `principal` E O EMPRESTADO, E COM JURO ELE NAO E MAIS A SOMA DAS PARCELAS
    // ------------------------------------------------------------------------
    // Sem juro `principalQueVaiParaAColuna` devolve `serieFechada.valorTotal`,
    // que e o que esta linha gravava antes desta issue e continua correto ali:
    // com base "parcela" o digitado e UMA parcela, e gravar o digitado poria
    // R$ 1.000 num emprestimo de R$ 24.000.
    //
    // COM juro ela devolve o emprestado, e a soma das parcelas DEIXA DE FECHAR
    // com esta coluna -- de proposito, e e a unica mudanca de dinheiro desta
    // issue. A migration 062 apagou o `COMMENT` da 053 que afirmava o
    // contrario, porque aquela afirmacao convidava uma guarda "consertando" a
    // soma, que apagaria o juro de todo emprestimo do sistema.
    //
    //   principal          o que SAIU da conta de investimento
    //   SUM(amount)        o que VOLTA (principal + juro)
    //   SUM(amount) - principal   o JURO
    const { data: emprestimo, error: erroDoEmprestimo } = await supabase
      .from("mybank_loans")
      .insert({
        // O id DO PEDIDO, QUANDO VEIO UM.
        //
        // `...(pedidoId ? { id: pedidoId } : {})` e nao `id: pedidoId`: a
        // coluna e NOT NULL com `DEFAULT gen_random_uuid()`, e um `id: null`
        // explicito no payload DERRUBA o default (o Postgres recebe o NULL e
        // recusa com 23502) -- quem chega pelo PostgREST sem mandar id, e as
        // sondas que nao sabem desta issue, pararia de conseguir emprestar.
        ...(pedidoId ? { id: pedidoId } : {}),
        lender_user_id: user.id,
        lender_account_id: credora.id,
        borrower_user_id: devedorId,
        description: String(descricao).trim(),
        principal: principalQueVaiParaAColuna({ juro, serie: serieFechada }),
        installment_count: numeroDeParcelas,
        first_due_date: serieFechada.parcelas[0].vencimento,
        // A TAXA DERIVADA, e nao o que o cliente digitou.
        //
        // No modo `total` a taxa nem foi digitada -- ela sai de
        // `total / principal - 1` (F2). E no modo `taxa` o que vai para a coluna
        // tambem passa pela inversa, pela razao escrita em
        // `tresCamposDoEmprestimo`: a previa mostra a taxa que o banco vai
        // GUARDAR, e nao uma que o `numeric(9,6)` arredondaria depois.
        interest_rate: juro ? juro.taxa : 0,
        // A CONVENCAO GRAVADA NA LINHA (062, decisao D2). Sem ela, o dia em que
        // entrar juro composto reinterpretaria todo emprestimo velho pela
        // aritmetica nova -- o total na tela mudaria sozinho, sem ninguem editar
        // nada e sem nenhuma linha do banco estar invalida.
        interest_kind: juro
          ? juro.convencao
          : CONVENCAO_DO_JURO_DO_EMPRESTIMO,
        status: "active",
      })
      .select("id")
      .single();

    // -----------------------------------------------------------------------
    // O SEGUNDO POST COM O MESMO id: `23505`, E A RESPOSTA E 200 COM O QUE EXISTE
    // -----------------------------------------------------------------------
    // Este e o caminho que nenhum `disabled` de tela alcanca: recarregar a
    // pagina e reenviar o mesmo formulario. A PK da 053 recusa a segunda linha,
    // e e isso que torna a idempotencia EXATA -- sem janela de tempo e sem
    // heuristica de "pedido parecido".
    //
    // A ARMADILHA: `.select()` POR id MENTE EM LINHA ALHEIA
    // ----------------------------------------------------
    // `mybank_loans_select` e `lender_user_id = auth.uid() OR borrower_user_id =
    // auth.uid()`. Um id escolhido pelo cliente pode colidir com a linha de
    // OUTRA pessoa -- inclusive uma em que eu sou DEVEDOR --, e um re-`select`
    // nu passaria pela policy e devolveria aquele emprestimo como se fosse o
    // meu: a tela diria "criado" mostrando uma divida que eu devo a alguem.
    // Por isso a conferencia e `lender_user_id === user.id`, e nao "o select
    // achou a linha". Familia `o .select() mente em linha alheia`.
    //
    // Nao e so privacidade: sem o 409 o cliente nunca descobre que o id dele
    // colidiu, e o emprestimo que ele pediu simplesmente nao existe.
    if (erroDoEmprestimo?.code === "23505" && pedidoId) {
      const { data: jaExistia } = await supabase
        .from("mybank_loans")
        .select("id, lender_user_id, installment_count, principal, borrower_user_id")
        .eq("id", pedidoId)
        .maybeSingle();

      // `!jaExistia` cobre a colisao com a linha de um TERCEIRO: ali a policy
      // nao alcanca a linha e o select volta vazio, que e indistinguivel de
      // "nao existe" -- e as duas levam ao mesmo 409.
      if (!jaExistia || jaExistia.lender_user_id !== user.id) {
        console.error(
          "MyBank: id de pedido colidiu com linha que nao e do credor.",
          { pedidoId }
        );
        return NextResponse.json(
          {
            error:
              "Esse pedido não pôde ser confirmado. Tente de novo.",
          },
          { status: 409 }
        );
      }

      // 200, E NAO 201: nada foi gravado AGORA.
      //
      // A contagem vem do banco e nao de `numeroDeParcelas`: o que importa aqui
      // e o que a divida TEM, nao o que este pedido pediu -- e os dois podem
      // divergir se o primeiro POST tiver morrido entre o passo 1 e o passo 2.
      const { count: quantasParcelas } = await supabase
        .from("mybank_installments")
        .select("id", { count: "exact", head: true })
        .eq("loan_id", jaExistia.id);

      const casoGravado = casoDoEmprestimo({
        lenderUserId: user.id,
        borrowerUserId: jaExistia.borrower_user_id,
      });

      return NextResponse.json(
        {
          success: true,
          loan_id: jaExistia.id,
          caso: casoGravado,
          /** A marca do caminho idempotente: a sonda afirma sobre ela. */
          ja_existia: true,
          total_de_parcelas: quantasParcelas ?? 0,
          principal: Number(jaExistia.principal),
          message:
            "Esse empréstimo já tinha sido criado. Nada foi duplicado.",
        },
        { status: 200 }
      );
    }

    if (erroDoEmprestimo || !emprestimo) {
      console.error("Erro ao criar o emprestimo do MyBank:", erroDoEmprestimo);
      return NextResponse.json(
        { error: "Não foi possível criar o empréstimo" },
        { status: 500 }
      );
    }

    // -----------------------------------------------------------------------
    // 2. A serie, num insert so
    // -----------------------------------------------------------------------
    const parcelasPedidas = linhasDasParcelas({
      serie: serieFechada,
      parcelas: numeroDeParcelas,
    }).map((linha) => ({ ...linha, loan_id: emprestimo.id }));

    const { data: parcelasCriadas, error: erroDasParcelas } = await supabase
      .from("mybank_installments")
      .insert(parcelasPedidas)
      .select("id, installment_number, installment_total, amount, due_date");

    if (erroDasParcelas || !parcelasCriadas || parcelasCriadas.length === 0) {
      console.error("Erro ao criar as parcelas do MyBank:", erroDasParcelas);
      // O emprestimo sem parcela nenhuma e uma divida de valor zero que aparece
      // na lista: desfaz.
      await supabase.from("mybank_loans").delete().eq("id", emprestimo.id);
      return NextResponse.json(
        { error: "Não foi possível criar as parcelas. Nada foi gravado." },
        { status: 500 }
      );
    }

    // -----------------------------------------------------------------------
    // 3. As transferencias previstas -- SO NO CASO A
    // -----------------------------------------------------------------------
    // `previsoesDoEmprestimo` devolve `[]` no Caso B, e e ela que decide isso.
    // O `if` aqui e sobre nao mandar um insert vazio ao PostgREST, nao sobre a
    // regra: a regra esta na funcao pura, com o porque escrito.
    const previsoes = previsoesDoEmprestimo({
      caso,
      parcelas: parcelasCriadas as ParcelaGravada[],
      descricao: String(descricao).trim(),
      contaDePagamentoId: contaDePagamento?.id ?? null,
      contaCredoraId: credora.id,
    });

    if (previsoes.length > 0) {
      const { error: erroDasPrevisoes } = await supabase
        .from("scheduled_transactions")
        .insert(
          previsoes.map((p) => ({
            user_id: user.id,
            category_id: categoriaId,
            // `group_id` NULL explicito: as triggers de rateio de grupo
            // (`auto_create_group_transaction`) criariam parte para uma
            // transferencia entre contas minhas, cobrando de membros um valor
            // que nao e despesa de ninguem.
            group_id: null,
            status: "pending",
            ...p,
          }))
        );

      if (erroDasPrevisoes) {
        console.error(
          "Erro ao criar as previsoes do auto-emprestimo:",
          erroDasPrevisoes
        );
        // Ver o cabecalho: no Caso A a previsao e o UNICO jeito de a parcela
        // aparecer em Contas a Pagar. O CASCADE de `loan_id` leva as parcelas.
        await supabase.from("mybank_loans").delete().eq("id", emprestimo.id);
        return NextResponse.json(
          {
            error:
              "Não foi possível agendar as parcelas em Contas a Pagar. Nada foi gravado.",
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        success: true,
        loan_id: emprestimo.id,
        caso,
        total_de_parcelas: parcelasCriadas.length,
        previsoes_criadas: previsoes.length,
        // AS QUATRO GRANDEZAS, SEPARADAS NA RESPOSTA (HMO-448)
        //
        // `principal` deixou de ser `serieFechada.valorTotal`: com juro eles
        // divergem, e uma resposta que mandasse um numero so faria a tela ter de
        // escolher qual dos dois ela chama de "empréstimo criado". A sonda da
        // rota afirma sobre os DOIS, que e o unico jeito de ver o mutante que
        // monta a serie sobre o principal (ali os dois numeros ficam IGUAIS).
        principal: principalQueVaiParaAColuna({ juro, serie: serieFechada }),
        total: serieFechada.valorTotal,
        juros: juro ? juro.juros : 0,
        taxa: juro ? juro.taxa : 0,
        valor_da_parcela: serieFechada.valorDaParcela,
        message: mensagemDaCriacao(
          caso,
          parcelasCriadas.length,
          serieFechada.valorDaParcela,
          juro ? juro.juros : 0
        ),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("MyBank loans POST error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

/**
 * O toast, e ele DIZ onde a parcela vai aparecer.
 *
 * Os dois casos tem destinos diferentes, e um texto unico ("24 parcelas
 * criadas") faria o Caso B parecer que criou conta a pagar no meu nome -- que e
 * exatamente o que ele nao faz. Quem leu "voce nao vai ver isso em Despesas" nao
 * vai procurar a despesa que falta.
 *
 * O VALOR AGORA E O DA PARCELA, E ANTES DESTA ISSUE ERA O TOTAL
 * ------------------------------------------------------------
 * A frase sempre disse "N parcelas de X" e X era `serieFechada.valorTotal`: um
 * emprestimo de 24x R$ 1.000 anunciava "24 parcelas de R$ 24.000,00". Nenhuma
 * assercao pegava isso porque nenhuma olhava esta frase, e o numero estava certo
 * -- era o rotulo dele que estava errado. Com juro a mesma frase ficaria pior
 * ainda (o total passa a incluir o juro), entao o rotulo foi corrigido junto:
 * quem le "24 parcelas de R$ 1.000,00" conhece a parcela, e o `total` fica na
 * oracao do juro, onde ele e a resposta de uma pergunta ("quanto volta").
 *
 * E A FRASE DO JURO SO APARECE QUANDO HA JURO. Um "sem juros" escrito em todo
 * emprestimo a juro zero seria ruido na frase de sucesso do caminho comum.
 */
function mensagemDaCriacao(
  caso: "auto" | "conexao",
  quantas: number,
  valorDaParcela: number,
  juros: number
): string {
  const reais = emReais(valorDaParcela);
  const oJuro =
    juros > 0 ? ` Você vai receber ${emReais(juros)} de juros.` : "";

  if (caso === "auto") {
    return `${quantas} parcelas de ${reais} em Contas a Pagar, como transferência para a conta de investimento.${oJuro}`;
  }
  return `${quantas} parcelas de ${reais} a receber no MyBank. Isso não entra nas suas despesas — quem paga é a outra pessoa.${oJuro}`;
}

/**
 * R$ a mao, e nao `toLocaleString("pt-BR")`.
 *
 * Este texto entra em assercao de teste, e depender da base de locale do Node
 * faz o mesmo teste passar numa maquina e falhar noutra sem nada no codigo ter
 * mudado (ha Node sem full-icu que devolve o formato en-US para qualquer locale
 * pedido). Mesma razao de `resumoDaSerie` em lib/lancamento.ts.
 */
function emReais(v: number): string {
  const centavos = Math.round(v * 100);
  const inteiros = String(Math.floor(centavos / 100)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    "."
  );
  return `R$ ${inteiros},${String(centavos % 100).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// GET: os MEUS emprestimos, com os tres campos que a issue nomeia
// ---------------------------------------------------------------------------
// "apenas como a receber no mybank informando valor, numero da parcela e quem
// deve pagar."
//
// E NENHUM FILTRO DE `status` -- A UNICA DAS QUATRO LEITURAS SEM ELE (HMO-398)
// ---------------------------------------------------------------------------
// As outras tres filtram `status = 'active'`, e estao certas em filtrar:
// `totaisDaContaCredora` e `lerAReceberDoMyBank` somam DINHEIRO A RECEBER, e a
// view `mybank_due_entries` monta Contas a Pagar do devedor -- emprestimo
// quitado ou cancelado nao tem nada em nenhum dos tres.
//
// Esta rota alimenta a LISTA "Emprestimos desta conta", que e outra coisa: e o
// unico lugar do app onde o registro de uma divida HONRADA aparece. Filtrar
// aqui apagaria a unica coisa que a HMO-394 (o `settled`) existe para mostrar --
// e nao ha outra tela onde procurar, porque `mybank_loans_delete` recusa
// emprestimo com parcela `paid` de proposito.
//
// O RECORTE E DA TELA, e ele existe: `recorteDaListaDeEmprestimos`
// (`lib/mybank-na-tela.ts`) separa os em andamento dos encerrados e deixa os
// encerrados atras de um botao, FECHADOS por padrao. Acrescentar um `.eq("status",
// "active")` aqui "para ficar igual as outras tres" esvaziaria aquela secao sem
// mudar NUMERO NENHUM na tela -- e e por isso que ha mutante com esse nome em
// `scripts/mutantes-emprestimo-do-mybank.mjs`, e uma assercao de GET que exige
// o `settled` e o `cancelled` no corpo.
//
// `lender_user_id = auth.uid()` NO FILTRO, E ISSO NAO E O QUE A RLS JA FAZ
// -----------------------------------------------------------------------
// `mybank_loans_select` e `lender_user_id = auth.uid() OR borrower_user_id =
// auth.uid()` -- ela deixa os DOIS lados verem a linha, o que e o que faz o
// devedor ver a divida dele. Sem o `.eq` aqui, esta rota devolveria tambem o que
// EU devo a outra pessoa, misturado com o que me devem, e "quem deve pagar"
// passaria a dizer o meu nome numa lista chamada "A receber". O lado do devedor
// tem leitura propria -- a view `mybank_due_entries`, que e de Contas a Pagar.
//
// O NOME DO DEVEDOR SAI DE UMA CONSULTA PROPRIA, NAO DE UM EMBED
// -------------------------------------------------------------
// O embed de `profiles` pelo `borrower_user_id` seria mais curto e e uma
// armadilha medida neste repositorio: embed que a RLS nao deixa resolver nao
// devolve `null`, ele DESCARTA A LINHA -- e a lista de emprestimos ficaria vazia
// para quem desfez a conexao depois de emprestar, sem erro nenhum. Com a leitura
// separada, perfil ilegivel vira nome `null`, e `quemDevePagar` tem frase para
// isso: a divida nao deixou de existir porque o contato saiu.
// ---------------------------------------------------------------------------
export async function GET() {
  const supabase = createClient();

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { data: emprestimos, error } = await supabase
      .from("mybank_loans")
      .select(
        "id, lender_account_id, borrower_user_id, description, principal, installment_count, first_due_date, status, created_at"
      )
      .eq("lender_user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Erro ao ler os emprestimos do MyBank:", error);
      return NextResponse.json(
        { error: "Não foi possível ler os empréstimos" },
        { status: 500 }
      );
    }

    const linhas = emprestimos ?? [];

    if (linhas.length === 0) {
      return NextResponse.json({ loans: [] });
    }

    const { data: parcelas } = await supabase
      .from("mybank_installments")
      .select(
        "id, loan_id, installment_number, installment_total, amount, due_date, status, reported_at, paid_date"
      )
      .in(
        "loan_id",
        linhas.map((l) => l.id)
      )
      .order("installment_number", { ascending: true });

    // So os devedores que NAO sao eu: o meu proprio nome nao vem de
    // `profiles` aqui, ele e a frase "Você mesmo" de `quemDevePagar`.
    //
    // Sem repetidos, e a deduplicacao e por `indexOf` e nao por `[...new
    // Set()]`: o `tsconfig.json` deste projeto nao tem `target` nem
    // `downlevelIteration`, e espalhar um Set reprova com TS2802 -- que so
    // aparece no `type-check`, nao na suite (o tsconfig dela tem
    // `target: es2020`). Dois emprestimos para a MESMA pessoa pediriam o perfil
    // dela duas vezes no `.in()`.
    const idsDeDevedor = linhas
      .map((l) => l.borrower_user_id)
      .filter((id, i, todos) => id !== user.id && todos.indexOf(id) === i);

    const { data: perfis } = idsDeDevedor.length
      ? await supabase
          .from("profiles")
          .select("id, full_name, nickname")
          .in("id", idsDeDevedor)
      : { data: [] as { id: string; full_name: string | null; nickname: string | null }[] };

    const nomePorId = new Map(
      (perfis ?? []).map((p) => [p.id, p.nickname || p.full_name || null])
    );

    const loans = linhas.map((l) => {
      const caso = casoDoEmprestimo({
        lenderUserId: user.id,
        borrowerUserId: l.borrower_user_id,
      });

      const minhas = (parcelas ?? []).filter((p) => p.loan_id === l.id);

      return {
        id: l.id,
        descricao: l.description,
        conta_credora_id: l.lender_account_id,
        caso,
        status: l.status,
        principal: Number(l.principal),
        total_de_parcelas: l.installment_count,
        primeiro_vencimento: l.first_due_date,
        /** Um dos tres campos da issue. */
        quem_deve_pagar: quemDevePagar({
          caso,
          nomeDoDevedor: nomePorId.get(l.borrower_user_id) ?? null,
        }),
        devedor_id: l.borrower_user_id,
        parcelas: minhas.map((p) => ({
          id: p.id,
          /** Os outros dois campos da issue: o valor e o `n de m`. */
          valor: Number(p.amount),
          numero: p.installment_number,
          total: p.installment_total,
          rotulo: `${p.installment_number} de ${p.installment_total}`,
          vencimento: p.due_date,
          status: p.status,
          // `reported` sem o credor ter confirmado: a acao Confirmar da tela.
          // Estado DERIVADO, nao coluna nova -- a forma da HMO-366. Pela
          // funcao, e nao por um `=== "reported"` aqui: a mesma pergunta e
          // feita no PATCH, e duas copias discordariam na primeira mudanca.
          a_confirmar: parcelaAConfirmar(p),
          reported_at: p.reported_at,
          paid_date: p.paid_date,
        })),
      };
    });

    return NextResponse.json({ loans });
  } catch (error) {
    console.error("MyBank loans GET error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
