// =============================================================================
// O QUE AS TRES TELAS DE MOVIMENTACAO LEEM (HMO-246)
// =============================================================================
//   GET /api/movimentacoes/resumo?tipo=income|expense|transfer&de=&ate=
//
// Uma rota para as tres telas, e nao tres rotas. O que muda entre elas e UM
// parametro; tres copias divergiriam na primeira mudanca, e a divergencia
// apareceria como "a tela de Receitas soma diferente da de Despesas" sem nada
// na tela dizendo por que.
//
// TODA A ARITMETICA ESTA EM lib/telas-de-movimentacao.ts, DE PROPOSITO
// --------------------------------------------------------------------
// Esta rota faz as consultas e traduz; quem soma, filtra por tipo e decide o
// que entra e o modulo puro, que tem teste e mutante
// (`npm run mutantes:telas-de-movimentacao`). As quatro armadilhas estao
// documentadas no cabecalho dele, e as duas que mais custam -- a conta prevista
// paga contada de novo e a segunda perna da transferencia -- moram em funcoes
// com assercao por cima, e nao em filtros de consulta daqui. Um `.neq()`
// trocado numa refatoracao nao quebra teste nenhum, e o defeito que ele cria e
// um total DOBRADO, que parece plausivel.
//
// AS TRES FONTES DO LADO PREVISTO, E POR QUE SAO TRES
// --------------------------------------------------
//   1. `scheduled_transactions_effective` -- a agenda gravada, com `direction`
//      ja resolvida pela view (027). E a unica fonte das tres telas que cobre
//      receita prevista e transferencia recorrente (038).
//   2. menos as COMPRAS NO CARTAO (`agendaSemCompraNoCartao`, HMO-209): a
//      parcela de uma compra no cartao nao e uma conta a pagar propria -- ela
//      esta DENTRO da fatura. Contar as duas e a fatura em dobro.
//   3. mais a FATURA ABERTA sintetizada (`faturasPrevistasDaJanela`, HMO-227),
//      que nao existe em tabela nenhuma e e, em muitos meses, a maior despesa
//      prevista do periodo. Sem ela a tela de Despesas mostraria um "Previsto"
//      que ignora o cartao -- um numero menor, plausivel, e exatamente o que
//      Contas Previstas NAO faz. A issue pede aquela tela como referencia.
//
// O lado realizado tem UMA fonte DE DINHEIRO: `financial_transactions`, com os
// mesmos filtros da lista de Financas Pessoais (`user_id`, `service_id` de
// personal_finance, o periodo). Os mesmos e nao parecidos: dois recortes
// diferentes para a mesma pergunta dao dois numeros certos que discordam na
// mesma sessao do usuario.
//
// A terceira consulta (3b, HMO-285) le `scheduled_transactions` e NAO soma nada:
// ela responde quais das linhas realizadas vieram de uma regra fixa, que e um
// ROTULO. Ela existe porque o elo e de uma via -- `financial_transactions` nao
// tem `recurring_rule_id` --, e falhar nela nao derruba a leitura nem mexe em
// centavo nenhum. Ver o comentario dela.
//
// E O LADO REALIZADO TAMBEM NAO CONTA O CARTAO (HMO-260)
// ------------------------------------------------------
// Pela MESMA razao do item 2 acima, do outro lado da conta: a compra no cartao
// esta dentro da fatura que o item 3 sintetiza inteira. `Total` e
// `previsto + realizado`, entao a compra solta no realizado fazia uma compra de
// R$ 400 fechar o mes em R$ 800.
//
// A exclusao mora em `ehGastoNoCartao` (lib/telas-de-movimentacao.ts), e NAO num
// filtro desta consulta -- pelo motivo do cabecalho e por um a mais, que e o do
// HMO-209: no PostgREST um filtro sobre coluna de EMBED vira INNER JOIN, e a
// despesa de grupo, que e gravada sem `account_id`, sairia da resposta junto.
// O que esta consulta tem de fazer e so uma coisa: TRAZER `account_type` no
// embed da conta. Sem ele a regra pura recebe `undefined` em toda linha, nenhuma
// casa com `credit_card`, o filtro passa a nao filtrar nada e a tela volta ao
// defeito desta issue -- sem erro, sem log e com o tsc verde.
//
// O QUE FICA DE FORA DO REALIZADO, E A TELA DIZ
// ---------------------------------------------
// A MINHA PARTE das despesas de grupo que outra pessoa JA PAGOU
// (`group_share_entries`, 033). Ela esta na lista de Financas Pessoais (HMO-215)
// e nao entra aqui, pelo mesmo motivo que nao entra nos tres cartoes de la: o
// realizado soma o valor CHEIO do que saiu da minha conta, e acrescentar uma
// FRACAO do que saiu da conta de outro misturaria dois criterios dentro de um
// numero so. A legenda da tela de Despesas diz isso em uma linha -- um valor
// que falta sem rotulo e indistinguivel de um bug.
//
// O LADO PREVISTO DO GRUPO: BRUTO AQUI, REEMBOLSO EM RECEITAS (HMO-364)
// ---------------------------------------------------------------------
// Esta rota -- e so ela entre as cinco leituras do previsto -- aplica a REGRA
// DO PAGADOR (`previstasPelaRegraDoPagador`, passo 3a): a conta de grupo que EU
// fronto entra pelo valor CHEIO, a que outro membro fronta entra pela minha
// parte. A aba Despesas responde *"quanto sai da minha conta"*.
//
// A contrapartida e o passo 3c: o que os outros me devem entra no cartao
// «Previsto» da aba Receitas como REEMBOLSO PREVISTO. As duas coisas sao UMA
// decisao e nao podem ser separadas -- sem o reembolso, o Previsto de Despesas
// sobe sem contrapartida e a tela mostra uma divida que nao e minha.
//
// E as duas vao DISCORDAR do painel na mesma navegacao, de proposito: o
// `safe-to-spend` responde *"quanto posso gastar"* e conta so a minha parte
// (HMO-306/308, que a secao 4 do plano da HMO-360 decidiu NAO reverter). Cada
// um dos dois numeros leva a legenda de lib/legenda-do-bruto-e-do-liquido.ts,
// porque numero novo sem rotulo e indistinguivel de bug -- e esta e a quinta
// convencao da familia `despesa-de-grupo-tem-tres-convencoes`.
// =============================================================================

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import {
  janelaParaMaterializar,
  mesesDoPeriodo,
  periodoCorrente,
  periodoDaQuery,
} from "@/lib/periodo-do-painel";
import { materializarAgenda } from "@/lib/services/scheduled";
import { faturasPrevistasDaJanela } from "@/lib/services/fatura-prevista";
import { lerCreditoDosGrupos } from "@/lib/services/credito-dos-grupos";
import {
  notaDoCreditoAReceber,
  type CreditoAReceber,
} from "@/lib/credito-de-grupo";
import { agendaSemCompraNoCartao } from "@/lib/agenda-do-cartao";
import {
  montarParticipantesPorGrupo,
  type ParticipantesPorGrupo,
} from "@/lib/parte-do-grupo";
import { previstasPelaRegraDoPagador } from "@/lib/regra-do-pagador";
import {
  contasDoFechamentoComoRealizadas,
  estimativasComoPrevistas,
  previstasNoGrupoQueFecha,
  separarPeloFechamento,
} from "@/lib/fechamento-no-resultado";
import {
  lerContasDoFechamentoRealizadas,
  lerEstimativasDoFechamento,
  lerGruposQueFecham,
} from "@/lib/services/fechamento-no-resultado";
import { chaveDoAcerto } from "@/lib/acerto-em-lancamento";
import {
  acertosNaAbaReceitas,
  ACERTOS_VAZIOS,
  type AcertoCruDaReceita,
  type AcertosNaAbaReceitas,
} from "@/lib/acerto-na-aba-receitas";
import {
  destinosDoPagamento,
  type DestinoDoPagamento,
} from "@/lib/pra-quem-pagar";
import {
  linhasDaTela,
  previstoVencido,
  resumoComAReceberDoMyBank,
  resumoComReembolsoPrevisto,
  resumoDaTela,
  telaDoTipo,
  type PrevistaCrua,
  type RealizadaCrua,
  type ReembolsoPrevisto,
} from "@/lib/telas-de-movimentacao";
import {
  lerAReceberDoMyBank,
  lerDividaDoMyBank,
} from "@/lib/services/divida-do-mybank";
import {
  comODonoDaLeitura,
  type AReceberDoMyBank,
  type ParcelaDevidaNaAgenda,
} from "@/lib/leituras-do-mybank";

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const params = request.nextUrl.searchParams;

    // `?tipo=` INVALIDO E 400, e nao um padrao. `?tipo=despeza` caindo em
    // "expense" responderia numeros de despesa a quem pediu outra coisa, com
    // 200, e quem chamou nao teria como saber. O padrao vive na TELA, onde um
    // link cortado no meio nao pode virar pagina em branco.
    const tela = telaDoTipo(params.get("tipo"));
    if (!tela) {
      return NextResponse.json(
        {
          error:
            'tipo deve ser "income", "expense" ou "transfer" -- um por tela de movimentação',
        },
        { status: 400 }
      );
    }

    const doPedido = periodoDaQuery(params.get("de"), params.get("ate"));

    if (doPedido === "invalido") {
      return NextResponse.json(
        {
          error:
            "de e ate devem ser datas AAAA-MM-DD válidas, as duas presentes, com de anterior ou igual a ate",
        },
        { status: 400 }
      );
    }

    const hoje = today();
    const periodo = doPedido ?? periodoCorrente(hoje);

    // ----------------------------------------------------------------
    // 1. A agenda do periodo, materializada quando isso e seguro
    // ----------------------------------------------------------------
    // Sem este passo, abrir a tela de Despesas em novembro mostraria "Previsto
    // R$ 0,00" para quem tem seis gastos fixos cadastrados: as ocorrencias de
    // novembro ainda nao existem como linha. Um zero confiante em cima de uma
    // agenda que a pessoa cadastrou.
    //
    // `janelaParaMaterializar` recusa a janela que ja passou, e a recusa e o
    // ponto: materializar no passado FABRICARIA contas vencidas retroativas --
    // o app inventando dividas que nunca existiram e as marcando em atraso.
    // Navegar para julho e um gesto de leitura.
    //
    // Falhar aqui nao derruba a leitura: a agenda que ja existe continua tendo
    // valor, e trocar as linhas que existem por uma tela de erro por causa das
    // que faltam e o pior dos dois.
    const janela = janelaParaMaterializar(periodo, hoje);
    if (janela) {
      try {
        await materializarAgenda(supabase, user.id, janela);
      } catch (erro) {
        console.error("A tela de movimentação seguiu sem materializar a agenda:", erro);
      }
    }

    // ----------------------------------------------------------------
    // 2. O REALIZADO
    // ----------------------------------------------------------------
    // `service_id` de personal_finance, como a lista de Financas Pessoais. Ha
    // tres servicos no seed (personal_finance, investments, goals) e a lista le
    // so o primeiro; sem o filtro, estas telas somariam linhas que ela nunca
    // mostrou.
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

    // `category(name, is_expense)` e os DOIS campos, nao so o nome:
    // `is_expense` e o que `classificarMovimentacao` usa quando
    // `transaction_type` esta NULO -- e ha linha com a coluna nula em producao
    // (o POST de /api/personal-finance/transactions nao a gravava). Sem ele a
    // classificacao cairia no sinal, e pelo sinal a perna de saida de uma
    // transferencia e uma despesa.
    //
    // `counterpart_transaction_id` existe para a frase "Itaú → Nubank": o elo do
    // 015 e de uma via, e sem a coluna a metade das transferencias perderia o
    // destino na tela que existe para mostra-lo.
    //
    // `account(... account_type)` E LOAD-BEARING, e nao enfeite da frase da
    // conta (HMO-260): e o unico campo pelo qual `ehGastoNoCartao` consegue
    // saber que a linha esta dentro da fatura. Tirar `account_type` deste
    // `select` -- numa limpeza de campos "nao usados na tela", por exemplo --
    // nao quebra tsc nem teste de unidade nenhum: a regra pura passa a receber
    // `undefined`, deixa de casar com `credit_card`, para de filtrar, e o Total
    // da tela de Despesas volta a somar o cartao duas vezes.
    //
    // `notes` E LOAD-BEARING DO MESMO JEITO, E NO SENTIDO OPOSTO (HMO-264): ele e
    // o unico campo pelo qual uma linha realizada sabe que e a FATURA PAGA. A
    // chave canonica (`fatura:AAAA-MM-01:<cartao>`) chega aqui de graca porque
    // `pagarFatura` copia `scheduled_transactions.notes` para as DUAS pernas do
    // pagamento -- nao houve coluna nova nem migration. Tirar `notes` deste
    // `select` nao quebra tsc (o campo e opcional em `RealizadaCrua`, e a
    // ausencia e o estado da maioria das linhas) nem teste de unidade nenhum:
    // `ehPagamentoDaFatura` para de casar, e o mes em que a fatura foi paga volta
    // a fechar mais barato pelo valor dela inteiro -- no Previsto, no Realizado e
    // no Total.
    //
    // E DESDE A HMO-380 `notes` CARREGA UMA SEGUNDA CHAVE CANONICA
    // (`mybank:<id da parcela>`), que e como a perna de entrada SOLTA do MyBank
    // escapa da de-duplicacao da armadilha 3 (`ehEntradaSoltaDoMyBank`). Tira-lo
    // daqui agora custa as DUAS leituras: a fatura paga some da aba Despesas e o
    // dinheiro que a conexao pagou some da aba Transferencias -- e esta segunda
    // nao tem nem o sintoma do total, porque a linha e a unica daquele dinheiro.
    // -----------------------------------------------------------------------
    // `include_in_total` NA LISTA NOMEADA, E A MEDIDA QUE AUTORIZA ISSO
    // -----------------------------------------------------------------------
    // A coluna e a da migration 060 (HMO-443), e ela decide o SELO da linha e a
    // acao "Não somar nos totais" (HMO-452). Sem ela aqui a tela perde as duas
    // em TODA linha, em silencio e sem quebrar `tsc` nem teste de unidade -- a
    // mesma familia de `notes` e `recurring_rule_id` acima.
    //
    // NOMEAR UMA COLUNA NUM `select` E A ARMADILHA DO #335: o PostgREST
    // responde `42703 column ... does not exist` e o handler cai em 500, ou
    // seja a tela de Despesas e a de Receitas param de carregar inteiras. A 060
    // e colada A MAO no SQL Editor, depois do deploy
    // (`deploy-ships-code-not-schema`), e nomear a coluna antes da colagem e
    // exatamente o defeito que o #336 consertou com a homonima da 058.
    //
    // MEDIDO EM PRODUCAO ANTES DE ESCREVER ESTA LINHA, em 2026-10-21, pelo
    // PostgREST com a chave anon e com CONTROLE NEGATIVO:
    //
    //   select=is_shared            -> 401 42501 permission denied   (existe)
    //   select=include_in_total     -> 401 42501 permission denied   (EXISTE)
    //   select=include_in_totalz    -> 400 42703 does not exist,
    //                                  hint: 'Perhaps you meant to reference
    //                                  the column
    //                                  "financial_transactions.include_in_total"'
    //
    // As tres linhas juntas sao a prova, e nenhuma sozinha serve. O PostgREST
    // resolve o NOME da coluna antes de checar permissao, entao `42501` ja diz
    // que o nome existe no catalogo -- e o `42703` do nome inventado e o
    // controle que impede esta sonda de confirmar o proprio typo
    // (`sonda-de-coluna-inventada-confirma-o-proprio-typo`). O hint do terceiro
    // caso e o catalogo NOMEANDO a coluna de volta.
    //
    // Por que isto nao fica so no comentario: o guard textual de
    // scripts/test-contrato-das-telas-de-movimentacao.mjs passou a COBRAR a
    // coluna neste `select`, do mesmo jeito que cobra `notes` e `user_id`. E e
    // por isso que esta lista continua NOMEADA em vez de virar `select("*")`:
    // `*` apagaria aquele guard e os dois irmaos dele, que protegem dinheiro.
    const { data: realizadasCruas, error: erroRealizadas } = await supabase
      .from("financial_transactions")
      .select(
        `
        id, user_id, description, amount, exchange_rate, currency, transaction_date,
        transaction_type, counterpart_transaction_id, notes, include_in_total,
        category:transaction_categories(name, is_expense),
        account:financial_accounts(id, name, account_type)
      `
      )
      .eq("user_id", user.id)
      .eq("service_id", servico.id)
      .gte("transaction_date", periodo.de)
      .lte("transaction_date", periodo.ate)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (erroRealizadas) {
      console.error("Erro ao ler o realizado da tela de movimentação:", erroRealizadas);
      return NextResponse.json(
        { error: "Não foi possível carregar os lançamentos do período" },
        { status: 500 }
      );
    }

    // ----------------------------------------------------------------
    // 3. O PREVISTO
    // ----------------------------------------------------------------
    // `status` NAO e filtrado aqui de proposito -- nem `paid`, nem `skipped`,
    // nem `cancelled`. Quem os exclui e `linhaPrevista`, que tem assercao por
    // cima. Ver o cabecalho deste arquivo.
    //
    // `direction` vem da view e e repassada crua: a precedencia entre o tipo da
    // ocorrencia e o da regra recorrente e da 027, e refazer esse COALESCE aqui
    // e o defeito que ela fechou.
    //
    // `recurring_rule_id` E LOAD-BEARING, pelo mesmo motivo e com o mesmo modo
    // de falha de `account_type` acima (HMO-285): ele e o unico campo pelo qual
    // a linha prevista sabe que nasceu de uma regra fixa. Tira-lo deste `select`
    // -- numa limpeza de campos "nao usados na tela", por exemplo -- NAO quebra
    // `tsc` nem teste de unidade nenhum, porque o campo e opcional em
    // `PrevistaCrua` e a ausencia dele e um estado legitimo (a previsao avulsa).
    // O que acontece e TODA conta fixa do periodo passar a se chamar comum na
    // tela, sem erro, sem log e com a lista e os totais inalterados. A sonda
    // textual de scripts/test-contrato-das-telas-de-movimentacao.mjs e o que
    // impede isso.
    //
    // A view o expoe desde a 005 (`scheduled_transactions.recurring_rule_id`) e
    // a 027 o manteve na coluna de saida (`027_...sql:248`) -- nenhuma migration
    // e necessaria aqui.
    //
    // `group_id` ENTROU NA HMO-303, E ELE E O QUE FALTAVA. Sem ele nada depois
    // desta consulta sabia que havia o que dividir, e a MINHA linha de grupo de
    // R$ 1.000 entrava CHEIA num mes em que o grupo cobra R$ 300. Ele alimenta
    // duas coisas: a divisao (`previstasComAMinhaParte`) e o ROTULO
    // (`LinhaDaTela.de_grupo`).
    //
    // `my_status`/`my_effective_status` NO LUGAR DE `status`/`effective_status`
    // (HMO-411, leitura 4 de 8) -- o porque completo esta no cabecalho de
    // app/api/scheduled-transactions/route.ts. E o `OR` logo abaixo que torna a
    // troca necessaria AQUI: ele traz a conta de grupo do outro membro para
    // estas telas de proposito, e ate agora o estado que a classificava era o
    // do DONO -- o aluguel que o Helio pagou saia do previsto da Lais no mesmo
    // instante, sem que ela tivesse resolvido a parte dela.
    const { data: agendaCrua, error: erroAgenda } = await supabase
      .from("scheduled_transactions_effective")
      .select(
        `
        id, user_id, description, amount, due_date, my_status, my_effective_status, currency,
        direction, notes, recurring_rule_id, group_id,
        category:transaction_categories(name),
        account:financial_accounts(id, name, account_type)
      `
      )
      // O `OR` É DELIBERADO -- HMO-303, E ELE É A DIFERENÇA ENTRE AS DUAS TELAS
      // DO MÓDULO.
      //
      // Até esta issue o filtro era `user_id = eu` e nada mais, e por isso a tela
      // de Despesas nao listava NADA da conta de grupo que outro membro lancou --
      // enquanto o painel do modo Papel de Pao (que nao filtra por `user_id`)
      // somava a minha parte dela. Duas telas do mesmo modulo, dois numeros, e
      // nada na tela dizendo por que. A diferenca sempre foi este filtro, e nao
      // uma regra de produto.
      //
      // ELE NAO ALARGA O QUE A PESSOA PODE VER: a policy `scheduled_transactions_select`
      // (005:310) libera `user_id = auth.uid() OR (group_id IS NOT NULL AND
      // is_group_member(group_id))`. O `OR` daqui pede exatamente o segundo ramo,
      // e a RLS continua sendo quem recusa grupo de que eu nao sou membro -- e o
      // MESMO mecanismo pelo qual o painel ja ve essas linhas.
      //
      // A LINHA DO OUTRO MEMBRO NAO GANHA BOTAO: `posso_editar` e
      // `ehMinha(crua.user_id, meuUserId)` desde a HMO-301, e `UPDATE` recusado
      // pela RLS volta 200 SEM ALTERAR NADA -- o app diria "pronto" e a linha
      // ficaria.
      .or(`user_id.eq.${user.id},group_id.not.is.null`)
      .gte("due_date", periodo.de)
      .lte("due_date", periodo.ate)
      .order("due_date", { ascending: false });

    if (erroAgenda) {
      console.error("Erro ao ler o previsto da tela de movimentação:", erroAgenda);
      return NextResponse.json(
        { error: "Não foi possível carregar as contas previstas do período" },
        { status: 500 }
      );
    }

    // A compra no cartao sai da agenda: ela esta DENTRO da fatura, e as duas na
    // mesma soma e a fatura em dobro. O filtro e em JavaScript e nao na
    // consulta porque a regra cruza `notes` (da previsao) com `account_type`
    // (da conta), e no PostgREST um filtro sobre coluna de embed vira INNER
    // JOIN -- a previsao SEM conta escolhida, que e o caso mais comum, sairia
    // da resposta junto. Ver HMO-209.
    const agenda = agendaSemCompraNoCartao(agendaCrua ?? []);

    // ----------------------------------------------------------------
    // 3a. A REGRA DO PAGADOR NAS LINHAS DE GRUPO -- HMO-303, HMO-364
    // ----------------------------------------------------------------
    // A pergunta "quanto desta despesa de grupo entra nesta tela?" tem DUAS
    // respostas certas, e qual vale depende de quem LANCOU a conta. Desde a
    // HMO-364 (fase F1b da HMO-360) esta leitura -- e SO esta -- responde pela
    // REGRA DO PAGADOR: valor CHEIO na conta que EU fronto, a minha parte na
    // que outro membro fronta. A aba Despesas responde *"quanto sai da minha
    // conta"*, e no dia do vencimento sai a conta inteira.
    //
    // A CONTRAPARTIDA E OBRIGATORIA, E ELA ESTA NO PASSO 4 DESTE ARQUIVO: a
    // parte dos outros volta como REEMBOLSO PREVISTO no cartao «Previsto» da
    // aba Receitas (fase F3). Sem ela esta troca infla o Previsto de Despesas
    // sem contrapartida e a tela mostra uma divida que nao e minha -- "F1 e F3
    // vao juntas ou nao vao" e a trava central do plano da HMO-360.
    //
    // AS OUTRAS LEITURAS NAO MUDARAM, E ISSO FOI DECIDIDO:
    // `safe-to-spend`, `scheduled-transactions/summary`
    // e `dashboard/previsao` continuam chamando `parteConfiguradaDoMembro`
    // direto, pela minha parte. A secao 4 do plano pergunta isso em voz alta e
    // responde NAO REVERTER a HMO-306/308: o `safe-to-spend` responde *"posso
    // gastar isso?"* e e conservador de proposito. Os dois numeros vao
    // discordar na mesma navegacao, e e por isso que cada um leva a legenda de
    // lib/legenda-do-bruto-e-do-liquido.ts.
    //
    // Quem DIVIDE continua sendo `parteConfiguradaDoMembro`, inalterada: a
    // resposta "qual e a minha parte" tem um lugar so, e e a que o fechamento
    // do grupo vai cobrar. O que a regra do pagador acrescenta e QUAL das duas
    // respostas a linha recebe.
    //
    // `id, user_id, percentage` SAO LOAD-BEARING -- ver o comentario identico em
    // app/api/papel-de-pao/painel/route.ts. E `ORDER BY` nao aparece aqui de
    // proposito: quem fixa a ordem (que vale um centavo) e
    // `montarParticipantesPorGrupo`, uma vez, e nao cinco consultas.
    const gruposEnvolvidos = Array.from(
      new Set(
        (agenda as { group_id?: string | null }[])
          .map((l) => l.group_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    let pesosPorGrupo: ParticipantesPorGrupo = new Map();

    if (gruposEnvolvidos.length > 0) {
      const { data: membros, error: erroMembros } = await supabase
        .from("group_members")
        .select("id, group_id, user_id, percentage, status")
        .in("group_id", gruposEnvolvidos)
        .eq("status", "active");

      if (erroMembros) {
        // Sem os pesos, `parteConfiguradaDoMembro` mantem o valor CHEIO. Erra
        // para cima, que e o comportamento desta tela antes da HMO-303, em vez de
        // subestimar a conta a pagar.
        console.error(
          "A tela de movimentação seguiu sem dividir a parte do grupo:",
          erroMembros
        );
      } else {
        pesosPorGrupo = montarParticipantesPorGrupo(membros ?? []);
      }
    }

    // O GRUPO QUE FECHA SAI DA REGRA DO PAGADOR (fase 4, RN018). A conta
    // prevista dele entra pela parte de cada membro, inclusive a de quem a
    // lancou, e nao ha reembolso por conta: o que cada um deve ou recebe vem do
    // fechamento. O porque inteiro esta em `previstasNoGrupoQueFecha`
    // (lib/fechamento-no-resultado.ts).
    //
    // FALHAR AQUI NAO DERRUBA A LEITURA: sem saber quais grupos fecham, toda
    // conta de grupo segue pela regra do pagador, que e a leitura de antes da
    // fase 4 -- erra para cima, como a falha dos pesos logo acima.
    let gruposQueFecham: ReadonlySet<string> = new Set();

    if (gruposEnvolvidos.length > 0) {
      const leitura = await lerGruposQueFecham(supabase, gruposEnvolvidos);
      if (!leitura.ok) {
        console.error(
          "A tela de movimentação seguiu sem saber quais grupos fecham:",
          leitura.mensagem
        );
      } else {
        gruposQueFecham = leitura.ids;
      }
    }

    const { doGrupoQueFecha, demais } = separarPeloFechamento(
      agenda as (PrevistaCrua & {
        group_id?: string | null;
        user_id?: string | null;
      })[],
      gruposQueFecham
    );

    const agendaPelaRegraDoPagador = [
      ...previstasPelaRegraDoPagador(demais, pesosPorGrupo, user.id),
      ...previstasNoGrupoQueFecha(doGrupoQueFecha, pesosPorGrupo, user.id),
    ];

    // ----------------------------------------------------------------
    // 3c. O REEMBOLSO PREVISTO DO GRUPO -- HMO-364, fase F3 da HMO-360
    // ----------------------------------------------------------------
    // O outro lado da regra do pagador. Se a aba Despesas conta a conta de
    // grupo que eu fronto pelo valor CHEIO, o que os outros me devem tem de
    // aparecer como RECEITA PREVISTA -- senao a soma deixa de fechar e a tela
    // promete uma divida que nao e minha.
    //
    // SO NA ABA RECEITAS, pela mesma razao da fatura logo abaixo: nas outras
    // duas o valor seria descartado depois de seis consultas. `tipo=expense`
    // NAO ganha um desconto aqui -- "quanto sai da minha conta" nao abate
    // promessa, e quem abate e o `safe-to-spend`, que e outra pergunta e outra
    // tela.
    //
    // ELE VAI PARA O «PREVISTO» E NUNCA PARA O REALIZADO. A recusa escrita no
    // cabecalho de lib/credito-de-grupo.ts -- "este modulo NAO exporta nada que
    // some em `receitas`" -- continua de pe: ela protege o REALIZADO de receber
    // credito sobre conta que ninguem pagou. Aqui o balde e o previsto, e a
    // simetria e exata, porque a despesa correspondente tambem nao foi paga.
    // Quem soma e `resumoComReembolsoPrevisto`, que tem assercao e mutante.
    //
    // FALHAR AQUI NAO DERRUBA A LEITURA, e e a mesma decisao da consulta 3b e
    // da materializacao da agenda: o reembolso fica `null`, o cartao «Previsto»
    // volta a ser o de antes desta issue e os tres numeros nao mentem -- eles
    // ficam MENORES, que e a direcao barata. Trocar Total, Previsto e Realizado
    // do mes por uma tela de erro por causa do reembolso seria o pior dos dois.
    // O `console.error` fica porque "o reembolso desapareceu" e um sintoma que
    // ninguem reporta.
    /**
     * AS LINHAS DO MESMO CREDITO -- HMO-422.
     *
     * DECLARADA ACIMA DE `reembolso`, E O LUGAR E DE PROPOSITO. O mutante
     * `f3_em_todas_as_telas` (scripts/mutantes-fiacao-do-bruto.mjs) ancora em
     * `let reembolso …` SEGUIDO do `if (tela.tipo === "income") {`, e aquela
     * ancora foi repontada na HMO-379 exatamente porque o `if` sozinho aparece
     * tres vezes neste arquivo (reembolso, MyBank e acertos). Declarar esta
     * variavel ENTRE as duas linhas mata a ancora -- medido: o
     * `check-ancora-de-mutante` acusou `ancora MORTA` na primeira volta desta
     * issue. Acima, o par continua contiguo e o mutante alheio continua medindo
     * o que ele diz medir.
     *
     * `notaDoCreditoAReceber` COLAPSA `CreditoAReceber` em tres numeros
     * (`total`, `quantos`, `grupos`) e as linhas morriam aqui. O efeito, medido
     * na tela do Helio: o cartao «Previsto» dizia R$ 508,42 "de 2 pessoas em 1
     * grupo" e a aba Receitas nao tinha, em lugar nenhum, QUEM sao as duas
     * pessoas nem QUAL e o grupo -- enquanto a aba DESPESAS lista os
     * destinatarios da parte simetrica desde a HMO-365 (`pra_quem_pagar`).
     * Conferir os R$ 508,42 exigia trocar de tela (/dashboard/personal-finance,
     * bloco "A receber dos grupos", que le o MESMO credito pela MESMA lib).
     *
     * O CAMPO E A LEITURA INTEIRA e nao so `linhas`: `sem_devedor` viaja com
     * elas porque o total do cartao e a soma das LINHAS, e o resto do saldo
     * (a tolerancia de um centavo de `simplifySettlements`) nao tem a quem ser
     * cobrado. Mandar as linhas sem ele deixaria o painel somando menos que o
     * numero citado na legenda do cartao, sem nada na tela dizendo por que --
     * exatamente o defeito que `CreditoAReceber.sem_devedor` existe para evitar.
     *
     * NAO E UM SEGUNDO SOMADOR: o valor ja esta dentro de `resumo.previsto`
     * (quem soma e `resumoComReembolsoPrevisto`, com mutante por cima) e o
     * painel diz isso por escrito, como `NOTA_PRA_QUEM_PAGAR` faz do outro lado.
     */
    let creditoDosGrupos: CreditoAReceber | null = null;
    let reembolso: ReembolsoPrevisto | null = null;

    if (tela.tipo === "income") {
      // `mesesDoPeriodo` devolve 'AAAA-MM-01' (a chave das views do 008) e
      // `fecharMes` recorta por 'AAAA-MM' -- a mesma conversao da rota
      // my-credit, que le o mesmo credito pelo mesmo modulo.
      const leitura = await lerCreditoDosGrupos(
        supabase,
        user.id,
        mesesDoPeriodo(periodo).map((m) => m.slice(0, 7))
      );

      if (!leitura.ok) {
        console.error(
          "A tela de movimentação seguiu sem o reembolso previsto do grupo:",
          leitura.mensagem
        );
      } else {
        // `notaDoCreditoAReceber` E QUEM CONTA, e nao um `.length` daqui: a
        // frase do cartao concorda em numero com `quantos` e `grupos`, e
        // concordancia calculada fora da funcao que agrega e o que divergiu da
        // conta no cartao de Despesas antes da HMO-275. Ela devolve `null`
        // quando nao ha linha nenhuma, que e o estado de quem nao tem grupo.
        reembolso = notaDoCreditoAReceber(leitura.credito);
        // AS LINHAS SAEM DA MESMA LEITURA, e isso e o ponto: uma segunda
        // chamada a `lerCreditoDosGrupos` (ou a `my-credit` por HTTP) seria a
        // segunda implementacao da mesma leitura, e o painel mostraria linhas
        // que nao somam o numero do cartao ao lado dele -- a familia de
        // `fontes-consistentes-que-discordam`, que o cabecalho daquele servico
        // recusa por escrito.
        creditoDosGrupos = leitura.credito;
      }
    }

    // ----------------------------------------------------------------
    // 3d. "ELA PAGOU; EU CONFIRMO" -- HMO-366, fase F4 da HMO-360
    // ----------------------------------------------------------------
    // Os acertos de grupo em que EU sou `to_user_id` e que a MINHA sessao ainda
    // nao lancou. O estado inteiro ja existia no banco e em lib puro, e esta
    // leitura e a unica coisa que faltava -- ver o cabecalho de
    // lib/acerto-na-aba-receitas.ts. SEM MIGRATION.
    //
    // NENHUM DESTES VALORES ENTRA EM `resumo` NEM EM `linhas`, e as duas razoes
    // estao escritas naquele cabecalho: o «Previsto» de Receitas JA conta este
    // dinheiro como reembolso previsto (F3, e `fecharMes` nao desconta acerto
    // registrado), e a perna e `transfer`, que nao e receita realizada. Eles
    // viajam em CAMPO PROPRIO da resposta, como `fatura_sem_vencimento` ja faz.
    //
    // FALHAR AQUI NAO DERRUBA A LEITURA -- mesma decisao de 3b, 3c e da
    // materializacao da agenda: os dois lados ficam vazios, a aba volta a ser a
    // de antes desta issue e nenhum numero se mexe. O `console.error` fica
    // porque "o acerto a confirmar desapareceu" e um sintoma que ninguem
    // reporta.
    // ----------------------------------------------------------------
    // 3c-bis. O «A RECEBER» DO MYBANK -- HMO-372, decisao 2 da HMO-368
    // ----------------------------------------------------------------
    // A simetria com o reembolso de grupo logo acima e exata: o que a conexao
    // ainda me deve e PROMESSA, vai para o «Previsto» de Receitas e nunca para o
    // Realizado -- quando ela paga, a perna e `transfer` e nao `income`, porque
    // principal voltando move dinheiro de lugar e nao e receita nova (ver
    // `pernaDeEntradaDoPagamento` em lib/emprestimo-do-mybank.ts).
    //
    // SO NA ABA RECEITAS, pela mesma razao do reembolso: nas outras duas o valor
    // seria descartado depois de duas consultas.
    //
    // FALHAR AQUI NAO DERRUBA A LEITURA -- mesma decisao de 3b, 3c e 3d: o
    // campo fica `null`, o cartao «Previsto» volta a ser o de antes desta issue
    // e os tres numeros nao mentem, eles ficam MENORES. O `console.error` fica
    // porque "o a receber do MyBank desapareceu" e um sintoma que ninguem
    // reporta.
    let aReceberDoMyBank: AReceberDoMyBank | null = null;

    if (tela.tipo === "income") {
      const leitura = await lerAReceberDoMyBank(supabase, user.id, {
        de: periodo.de,
        ate: periodo.ate,
      });

      if (!leitura.ok) {
        console.error(
          "A tela de movimentação seguiu sem o «a receber» do MyBank:",
          leitura.mensagem
        );
      } else {
        aReceberDoMyBank = leitura.aReceber;
      }
    }

    let acertos: AcertosNaAbaReceitas | null = null;

    if (tela.tipo === "income") {
      acertos = ACERTOS_VAZIOS;

      // `to_user_id = eu` NA CONSULTA, e nao so na funcao pura: a policy da 007
      // e `USING (is_group_member(group_id))`, entao sem este filtro a resposta
      // traria TODO acerto de TODO grupo meu -- inclusive os entre outras duas
      // pessoas -- para a funcao descartar depois. `acertosNaAbaReceitas`
      // descarta de novo (pela direcao), e isso nao e redundancia: o filtro aqui
      // e tamanho de payload, e o de la e a regra que o teste alcanca.
      //
      // `settled_on` recorta pelo MESMO periodo da tela. A perna nasce com
      // `transaction_date = settled_on` (`pernaDoAcerto`), entao o acerto e a
      // perna dele caem sempre no mesmo mes -- confirmar nao muda a linha de
      // periodo, ela muda de LADO dentro do periodo.
      //
      // GRUPO ARQUIVADO NAO E FILTRADO, ao contrario de `lerCreditoDosGrupos`:
      // la o que se lista e PROMESSA (o que ainda vao me pagar), e cobrar
      // residuo de viagem arquivada e ruido. Aqui a pessoa DISSE que me pagou --
      // o dinheiro pode estar na minha conta e eu ainda nao ter lancado. Esconder
      // isso porque o grupo foi arquivado deixaria o Pix fora do extrato para
      // sempre, sem nada na tela dizendo que ha algo a fazer.
      const { data: acertosCrus, error: erroAcertos } = await supabase
        .from("group_settlements")
        .select(
          "id, group_id, from_user_id, to_user_id, created_by, amount, currency, exchange_rate, settled_on"
        )
        .eq("to_user_id", user.id)
        .gte("settled_on", periodo.de)
        .lte("settled_on", periodo.ate)
        .order("settled_on", { ascending: false });

      if (erroAcertos) {
        console.error(
          "A tela de movimentação seguiu sem os acertos de grupo a confirmar:",
          erroAcertos
        );
      } else if ((acertosCrus ?? []).length > 0) {
        const crus = acertosCrus as AcertoCruDaReceita[];

        // AS MINHAS PERNAS, POR `notes IN (...)` -- a MESMA consulta que o GET
        // da tela do grupo faz (settlements/route.ts). A RLS de
        // `financial_transactions` filtra por `user_id`, entao o que volta e
        // sempre a propria perna: a pergunta e "EU ja lancei?", nunca "o outro
        // lancou?", que nenhuma sessao pode responder por policy.
        //
        // O `.eq("user_id")` nao e confianca na RLS: `rls-com-or-infla-agregado
        // -pessoal` esta medido neste repositorio, e a policy de SELECT de
        // `financial_transactions` tem um `OR` de grupo (002) -- sem o filtro, a
        // perna de OUTRO membro sobre uma despesa de grupo poderia entrar na
        // contagem e o meu acerto apareceria como "ja lancado" sem eu ter
        // lancado nada. O botao Confirmar desapareceria, e o Pix ficaria fora do
        // meu extrato para sempre.
        const chaves = crus.map((a) => chaveDoAcerto(a.id));

        const { data: pernas, error: erroPernas } = await supabase
          .from("financial_transactions")
          .select("notes")
          .eq("user_id", user.id)
          .in("notes", chaves);

        if (erroPernas) {
          // AQUI A FALHA NAO PODE SEGUIR EM FRENTE, e e a excecao a regra deste
          // arquivo: sem saber quais pernas existem, TODO acerto do periodo
          // pareceria "a confirmar" -- inclusive os que eu ja lancei. A tela
          // ofereceria Confirmar sobre dinheiro que ja esta na conta, o POST
          // responderia 409 e o segundo clique seria lido como app travado.
          // Vazio dos dois lados e a direcao barata: a aba fica como antes.
          console.error(
            "A tela de movimentação seguiu sem saber quais acertos eu já lancei:",
            erroPernas
          );
        } else {
          const chavesComPerna = new Set(
            (pernas ?? [])
              .map((p) => p.notes)
              .filter((n): n is string => typeof n === "string" && n.length > 0)
          );

          // Os nomes e os grupos sao SO PARA A FRASE, e e por isso que a falha
          // deles nao derruba nada: `descricaoDoAcerto` tem fallback escrito
          // para os dois ("Acerto de grupo — recebido"). Ser do mesmo grupo NAO
          // da acesso ao perfil do outro -- as policies de SELECT de `profiles`
          // nao olham `group_members` --, entao o perfil ausente e caminho
          // normal, nao erro.
          const idsDePagadores = Array.from(
            new Set(crus.map((a) => a.from_user_id).filter(Boolean))
          );
          const idsDeGrupos = Array.from(
            new Set(crus.map((a) => a.group_id).filter(Boolean))
          );

          const [{ data: perfis }, { data: gruposDoAcerto }] = await Promise.all([
            supabase.from("profiles").select("id, full_name").in("id", idsDePagadores),
            supabase.from("expense_groups").select("id, name").in("id", idsDeGrupos),
          ]);

          const nomes = new Map<string, string>();
          for (const p of perfis ?? []) {
            const nome = (p.full_name ?? "").trim();
            // Nome em branco e tratado como AUSENTE: `full_name` nao tem NOT
            // NULL em `profiles` (001), e guardar `""` aqui faria a frase sair
            // "Acerto de grupo — me pagou", com o espaco e nada antes.
            if (p.id && nome) nomes.set(p.id, nome);
          }

          const grupos = new Map<string, string>();
          for (const g of gruposDoAcerto ?? []) {
            const nome = (g.name ?? "").trim();
            if (g.id && nome) grupos.set(g.id, nome);
          }

          acertos = acertosNaAbaReceitas({
            acertos: crus,
            tipo: tela.tipo,
            userId: user.id,
            chavesComPerna,
            nomes,
            grupos,
          });
        }
      }
    }

    // ----------------------------------------------------------------
    // 3e. PRA QUEM PAGAR -- HMO-365, fase F2 da HMO-360
    // ----------------------------------------------------------------
    // O outro lado do carimbo de `previstasPelaRegraDoPagador`. A linha de grupo
    // que OUTRO membro frontou ja entra no «Previsto» pela minha parte; o que
    // faltava era dizer A QUEM eu pago -- `pagar_para` morria dentro de
    // `linhasDaTela`, que monta `LinhaDaTela` campo por campo.
    //
    // SO NA ABA DESPESAS, pela razao da fatura logo abaixo: em Receitas e
    // Transferencias isto seria duas consultas para descartar tudo depois. E o
    // lado de Receitas desta mesma divida ja tem dono (o reembolso previsto, 3c).
    //
    // DUAS CONSULTAS, E SO QUANDO HA DESTINATARIO. `profiles` da o nome e
    // `expense_groups` da o nome do grupo; sem linha de outro membro no periodo
    // (o caso de quem nao tem grupo, e de quem fronta tudo) nenhuma das duas
    // acontece.
    //
    // FALHAR AQUI NAO DERRUBA A LEITURA, e e a mesma decisao de 3b e 3c: os
    // mapas ficam vazios, `rotuloDoDestino` cai no rotulo escrito ("outro membro
    // de Casa", ou "do grupo") e o painel continua de pe dizendo o que sabe. O
    // que ele NAO faz e desaparecer -- a divida seguiria dentro do cartao
    // «Previsto» de cima, sem nada na tela explicando de quem ela e.
    let destinos: DestinoDoPagamento[] = [];

    if (tela.tipo === "expense") {
      // O `pagar_para` so e carimbado em linha de grupo de outro membro, entao
      // este filtro e exatamente "ha a quem pagar?". `!== undefined` e nao um
      // `Boolean(...)`: `null` e um destinatario de verdade (linha de grupo sem
      // `user_id` legivel) e um `if (p.pagar_para)` o descartaria.
      const comDestino = agendaPelaRegraDoPagador.filter(
        (p) => p.pagar_para !== undefined
      );

      if (comDestino.length > 0) {
        const idsDePagadores = Array.from(
          new Set(
            comDestino
              .map((p) => p.pagar_para)
              .filter((id): id is string => typeof id === "string" && id !== "")
          )
        );

        const idsDeGrupos = Array.from(
          new Set(
            comDestino
              .map((p) => p.group_id)
              .filter((id): id is string => typeof id === "string" && id !== "")
          )
        );

        // `profiles` POR `id`, O MESMO CAMINHO DA ROTA my-credit. E o nome pode
        // simplesmente NAO VIR: nenhuma das tres policies de SELECT de
        // `profiles` olha `group_members` (`id = auth.uid()`, `is_public = TRUE`
        // do 002, "conexao aceita" do 010), entao dividir a conta com alguem nao
        // da acesso ao perfil dele -- e o PostgREST nao levanta erro nisso, a
        // linha so nao vem. `is_public` tem DEFAULT true, entao na pratica a
        // maioria chega, e e isso que torna o caminho sem nome perigoso: ele
        // quase nunca acontece em teste e acontece em producao.
        const [perfis, grupos] = await Promise.all([
          idsDePagadores.length > 0
            ? supabase.from("profiles").select("id, full_name").in("id", idsDePagadores)
            : Promise.resolve({ data: [], error: null }),
          idsDeGrupos.length > 0
            ? supabase.from("expense_groups").select("id, name").in("id", idsDeGrupos)
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (perfis.error) {
          console.error(
            "A tela de Despesas seguiu sem o nome de quem frontou a conta:",
            perfis.error
          );
        }
        if (grupos.error) {
          console.error(
            "A tela de Despesas seguiu sem o nome do grupo:",
            grupos.error
          );
        }

        const nomes = new Map<string, string>();
        for (const perfil of (perfis.data ?? []) as {
          id?: string | null;
          full_name?: string | null;
        }[]) {
          // Nome em branco NAO entra no mapa: `full_name` nao tem NOT NULL nem
          // CHECK de tamanho em `profiles` (001), e guardar `""` faria o rotulo
          // sair "Pagar para " -- com o espaco e nada depois. O perfil legivel e
          // sem nome cai no mesmo caminho do invisivel, de proposito. Mesmo
          // critério de `nomesDosPagadores` (HMO-274).
          const nome = (perfil?.full_name ?? "").trim();
          if (perfil?.id && nome) nomes.set(perfil.id, nome);
        }

        const nomesDeGrupos = new Map<string, string>();
        for (const grupo of (grupos.data ?? []) as {
          id?: string | null;
          name?: string | null;
        }[]) {
          const nome = (grupo?.name ?? "").trim();
          if (grupo?.id && nome) nomesDeGrupos.set(grupo.id, nome);
        }

        destinos = destinosDoPagamento(comDestino, nomes, nomesDeGrupos);
      }
    }

    // A fatura aberta do cartao, so na tela de Despesas: ela e `direction:
    // "expense"` por construcao, e chamar a leitura nas outras duas gastaria
    // duas consultas para descartar tudo depois.
    const fatura =
      tela.tipo === "expense"
        ? await faturasPrevistasDaJanela(supabase, user.id, {
            de: periodo.de,
            ate: periodo.ate,
            hoje,
          })
        : { previstas: [], semVencimento: [] };

    // ----------------------------------------------------------------
    // 3f. A PARCELA QUE EU DEVO NO MYBANK -- HMO-377
    // ----------------------------------------------------------------
    // A QUINTA leitura de `lerDividaDoMyBank`, e a que faltava. A HMO-372 ligou
    // o lado do devedor a Contas a Pagar (leitura 1) e ao safe-to-spend (leitura
    // 3) e deixou esta aba de fora de proposito -- a tabela das sete leituras
    // daquela issue nao a listava, e alargar o escopo ali seria decidir sozinho
    // que a aba Despesas ganha uma linha. MEDIDO na main 40c7b01, do lado da
    // devedora: Contas a Pagar somava R$ 1.200,00 e esta aba respondia
    // R$ 200,00 no MESMO periodo, pela MESMA divida.
    //
    // SO NA ABA DESPESAS, e por construcao e nao por economia: a linha chega
    // `direction: "expense"` (`parcelasDevidasNaAgenda`), entao em Receitas e em
    // Transferencias ela seria descartada pela peneira de tipo de `linhasDaTela`
    // depois de uma consulta. E ficar fora de Transferencias e a resposta CERTA:
    // o dinheiro sai da minha conta para a conta de OUTRA PESSOA, e aquela aba
    // afirma que ele andou entre contas minhas. Ver o cabecalho de
    // `ehParcelaDevidaDoMyBank`.
    //
    // O AUTO-EMPRESTIMO NAO VEM POR AQUI, E E ISSO QUE IMPEDE A LINHA REPETIDA:
    // a view tem `borrower_user_id IS DISTINCT FROM lender_user_id` (053), e a
    // parcela do Caso A ja esta na consulta do passo 3 -- uma
    // `scheduled_transaction` com `direction: 'transfer'` que
    // `ehParcelaDoAutoEmprestimo` traz para esta aba. As duas fontes sao
    // DISJUNTAS no banco, e nao de-duplicadas aqui; a mesma decisao, com o mesmo
    // comentario, esta em /api/scheduled-transactions.
    //
    // AS DUAS PONTAS DA JANELA, ao contrario do safe-to-spend, que passa
    // `de: null`. Lá a pergunta e "quanto vai sair da minha conta", e a parcela
    // que venceu no mes passado e nao foi paga continua sendo dinheiro que vai
    // sair; aqui a pergunta e "o que este PERIODO compromete", e uma parcela de
    // fevereiro numa tela de marco seria a linha no mes errado
    // (`leitura-sem-recorte-de-data-soma-o-horizonte`).
    //
    // FALHAR AQUI NAO DERRUBA A LEITURA -- mesma decisao de 3b, 3c, 3c-bis e 3d:
    // a lista fica vazia, a aba volta a ser a de antes desta issue e os numeros
    // ficam MENORES, que e a direcao que a pessoa percebe quando paga a parcela
    // e a conta nao fecha. O `console.error` fica porque "a parcela desapareceu"
    // e um sintoma que ninguem reporta.
    let parcelasDevidas: ParcelaDevidaNaAgenda[] = [];

    if (tela.tipo === "expense") {
      const leitura = await lerDividaDoMyBank(supabase, user.id, {
        de: periodo.de,
        ate: periodo.ate,
        hoje,
      });

      if (!leitura.ok) {
        console.error(
          "A tela de movimentação seguiu sem a dívida do MyBank:",
          leitura.mensagem
        );
      } else {
        // `comODonoDaLeitura` E OBRIGATORIO, e o campo que ele preenche nao e
        // enfeite: a view devolve `borrower_user_id` como `user_id` mas
        // `ParcelaDevidaNaAgenda` nasce com `user_id: ""`, e `posso_editar` sai
        // de `ehMinha(crua.user_id, meuUserId)`. Sem esta linha a parcela
        // chegaria a tela marcada como linha de OUTRA PESSOA. Hoje isso nao
        // muda botao nenhum (`gravada: false` ja os recusa todos -- ver a regra
        // 3 de lib/acoes-da-linha.ts), e e justamente por isso que ela tem de
        // estar escrita: o dia em que a linha ganhar o botao de avisar que
        // pagou, o campo ja esta certo em vez de ser um `false` silencioso. E a
        // licao da HMO-311 na fatura sintetizada.
        parcelasDevidas = comODonoDaLeitura(leitura.linhas, user.id);
      }
    }

    // ----------------------------------------------------------------
    // 3b. QUAIS DAS REALIZADAS VIERAM DE UMA REGRA FIXA
    // ----------------------------------------------------------------
    // Uma terceira consulta, e ela existe porque O ELO E DE UMA VIA:
    // `financial_transactions` nao tem `recurring_rule_id` nem
    // `scheduled_transaction_id` (001_...sql:1131-1148). Quem guarda a ponte e
    // `scheduled_transactions.transaction_id`, do lado da agenda, apontando para
    // a transacao que a baixa criou. Entao nao da para responder "esta linha
    // realizada e de uma conta fixa?" lendo a linha realizada -- a pergunta tem
    // de ser feita do outro lado, e por isso a resposta chega em `linhasDaTela`
    // como um conjunto de `transaction_id`.
    //
    // `.not("recurring_rule_id", "is", null)` no SERVIDOR e nao no cliente: sem
    // ele a consulta traria tambem as previsoes AVULSAS que receberam baixa, que
    // sao a maioria das linhas de quem lanca conta a conta -- payload maior para
    // depois descartar.
    //
    // DIRECAO DO ERRO: falhar aqui NAO derruba a leitura. O conjunto fica vazio,
    // as linhas caem em `natureza: "despesa"` -- que e exatamente o estado de
    // antes desta issue -- e os tres numeros nao se mexem um centavo. Trocar os
    // totais do mes por uma tela de erro por causa de um ROTULO seria o pior dos
    // dois. O `console.error` fica, porque "sem rotulo nenhum" e um sintoma que
    // ninguem reporta. Mesma decisao que `faturasPrevistasDaJanela` e a
    // materializacao da agenda ja tomam neste arquivo.
    const idsRealizados = (realizadasCruas ?? [])
      .map((linha) => linha.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    const idsDeFixa = new Set<string>();

    // Sem id nenhum no periodo nao ha o que perguntar, e um `.in()` com lista
    // vazia e uma ida ao banco para receber zero linhas de volta.
    if (idsRealizados.length > 0) {
      const { data: comRegra, error: erroRegra } = await supabase
        .from("scheduled_transactions")
        .select("transaction_id, recurring_rule_id")
        .eq("user_id", user.id)
        .in("transaction_id", idsRealizados)
        .not("recurring_rule_id", "is", null);

      if (erroRegra) {
        console.error(
          "A tela de movimentação seguiu sem saber quais realizadas são fixas:",
          erroRegra
        );
      } else {
        for (const linha of comRegra ?? []) {
          if (linha.transaction_id) idsDeFixa.add(linha.transaction_id);
        }
      }
    }

    // ----------------------------------------------------------------
    // 3e. O FECHAMENTO DO GRUPO -- fase 4, RN017 e RN018.7
    // ----------------------------------------------------------------
    // Duas leituras, uma de cada lado:
    //
    //   * a conta do fechamento JA QUITADA ("Pagamento ao grupo" em Despesas,
    //     "A receber do grupo" em Receitas) entra no REALIZADO. Em aberto ela e
    //     uma conta prevista minha e ja chega pela agenda; quitada, o status
    //     dela vira `paid` sem transacao nenhuma (068), e e
    //     `group_closing_entries` (069) que a devolve. Falhar aqui e 500, como
    //     o realizado do passo 2: um realizado menor sem aviso e o pior dos
    //     dois;
    //   * a ESTIMATIVA do periodo aberto entra no PREVISTO, no mes em que o
    //     fechamento vai gerar a conta (decisao D2). Falhar aqui nao derruba a
    //     leitura, pela razao do reembolso no passo 3c.
    //
    // As duas so falam de Receitas e Despesas: em Transferencias a peneira de
    // tipo de `linhasDaTela` as descartaria depois de cinco consultas.
    let contasDoFechamento: ReturnType<typeof contasDoFechamentoComoRealizadas> = [];
    let estimativasDoFechamento: ReturnType<typeof estimativasComoPrevistas> = [];

    if (tela.tipo !== "transfer") {
      const quitadas = await lerContasDoFechamentoRealizadas(
        supabase,
        user.id,
        periodo.de,
        periodo.ate
      );

      if (!quitadas.ok) {
        console.error(
          "Erro ao ler as contas do fechamento da tela de movimentação:",
          quitadas.erro
        );
        return NextResponse.json(
          { error: "Não foi possível carregar os lançamentos do período" },
          { status: 500 }
        );
      }

      contasDoFechamento = contasDoFechamentoComoRealizadas(quitadas.contas);

      const estimativas = await lerEstimativasDoFechamento(supabase, user.id, hoje);

      if (!estimativas.ok) {
        console.error(
          "A tela de movimentação seguiu sem a estimativa do fechamento:",
          estimativas.mensagem
        );
      } else {
        estimativasDoFechamento = estimativasComoPrevistas(
          estimativas.estimativas.filter(
            (e) => e.vencimento >= periodo.de && e.vencimento <= periodo.ate
          )
        );
      }
    }

    // ----------------------------------------------------------------
    // 4. Os tres numeros e a lista
    // ----------------------------------------------------------------
    const previstas: PrevistaCrua[] = [
      ...(agendaPelaRegraDoPagador as PrevistaCrua[]),
      // A fatura sintetizada NAO passa por `previstasPelaRegraDoPagador`: ela
      // nasce com `group_id` ausente (fatura de cartao nao e de grupo) e a
      // funcao a devolveria intacta. Deixa-la fora do `map` diz isso no codigo.
      ...(fatura.previstas as PrevistaCrua[]),
      // E A PARCELA DO MYBANK ENTRA PELO MESMO CAMINHO DA FATURA -- HMO-377.
      //
      // Ela tambem fica FORA de `previstasPelaRegraDoPagador`, e pela mesma
      // razao: `group_id` e `null` em `ParcelaDevidaNaAgenda` (divida de MyBank
      // nao se rateia), entao a funcao a devolveria intacta. E fica fora de
      // `agendaSemCompraNoCartao` por construcao -- ela nao tem conta nenhuma,
      // muito menos cartao.
      //
      // O CAST NAO ESCONDE NADA: `ParcelaDevidaNaAgenda` satisfaz `PrevistaCrua`
      // campo a campo (`id: null`, `amount`, `due_date`, `status`,
      // `effective_status`, `direction`, `notes`, `recurring_rule_id`,
      // `group_id`), e os campos que ela NAO tem sao os opcionais que a fatura
      // sintetizada tambem nao tem. O que `linhaPrevista` faz com ela esta
      // medido em scripts/test-leituras-do-mybank.mjs, na rota de verdade: a
      // chave vira `mybank:<id>` (nunca um uuid que `/api/scheduled-transactions`
      // aceitaria), `gravada` sai `false` e nenhum botao aparece.
      ...(parcelasDevidas as unknown as PrevistaCrua[]),
      // A estimativa do fechamento (3e) tambem fica fora da regra do pagador:
      // ela ja e a MINHA posicao no grupo, e nasce com `group_id` nulo para nao
      // ser dividida de novo.
      ...(estimativasDoFechamento as PrevistaCrua[]),
    ];

    const linhas = linhasDaTela(
      [
        ...(realizadasCruas ?? []),
        ...contasDoFechamento,
      ] as unknown as RealizadaCrua[],
      previstas,
      tela.tipo,
      idsDeFixa,
      // QUEM ESTA OLHANDO (HMO-301). A rota e quem autentica, entao e dela que a
      // resposta sai; a REGRA ("a linha e minha?") fica na lib, onde
      // `npm run test:telas-de-movimentacao` e os mutantes a alcancam. E a mesma
      // fiacao que /api/papel-de-pao/painel ja faz (HMO-300).
      //
      // `user_id` ENTROU NOS DOIS `select` ACIMA POR ISTO, e e uma coluna em
      // consulta que ja existia -- nao uma consulta nova. Tira-la nao quebra
      // `tsc` nem teste de unidade nenhum (o campo e opcional nas duas
      // interfaces cruas, porque a fatura sintetizada nao o tem): o que
      // acontece e `posso_editar: false` em TODA linha e a lista voltar a ser
      // so leitura, sem erro e sem log. Quem tranca isso e a sonda textual de
      // scripts/test-contrato-das-telas-de-movimentacao.mjs.
      //
      // Hoje as duas consultas ja filtram `.eq("user_id", user.id)`, entao a
      // comparacao e verdadeira em quase toda linha. Ela nao e redundante:
      // qualquer alargamento futuro da leitura (a parte de grupo de outro
      // membro, que a policy do 005 ja libera) passa a chegar aqui, e a tela
      // nasce FECHADA para ela em vez de ganhar botao que a RLS recusa.
      user.id
    );

    // O REEMBOLSO ENTRA DEPOIS DE `resumoDaTela`, E FORA DE `linhas`.
    //
    // Ele nao e linha da lista: o credito nasce de `fecharMes`, que NETA o mes
    // por devedor, e nao de uma previsao gravada que a pessoa possa abrir,
    // editar ou confirmar. Fabricar uma linha sintetica aqui daria a ela os
    // tres botoes de `posso_editar` sobre um id que nao existe em tabela
    // nenhuma -- e `UPDATE` recusado pela RLS volta 200 sem alterar nada, ou
    // seja o app diria "pronto" e nada teria acontecido.
    //
    // Por isso `quantidadePrevista` tambem NAO sobe: a frase "N lançamento(s)"
    // prometeria uma linha que a lista nao tem. Quem garante isso e
    // `resumoComReembolsoPrevisto`, com mutante por cima.
    // E O «A RECEBER» DO MYBANK ENTRA DEPOIS DELE -- HMO-372, decisao 2 da
    // HMO-368.
    //
    // CAMPO PROPRIO (`a_receber_do_mybank`) e nao dentro de
    // `reembolso_previsto`: a issue manda reusar a FORMA de
    // `lib/services/credito-dos-grupos.ts`, nao o balde. A razao inteira esta no
    // cabecalho de `resumoComAReceberDoMyBank` -- somar os dois no mesmo campo
    // apagaria a medicao do credito de grupo e tiraria da tela a frase que diz
    // de onde vem cada parte.
    //
    // A ORDEM DAS DUAS CHAMADAS NAO IMPORTA HOJE e isso esta escrito la: as duas
    // somam no mesmo par de campos e nenhuma le o que a outra escreveu.
    const resumo = resumoComAReceberDoMyBank(
      resumoComReembolsoPrevisto(resumoDaTela(linhas), tela.tipo, reembolso),
      tela.tipo,
      aReceberDoMyBank
    );
    const vencido = previstoVencido(linhas);

    return NextResponse.json({
      success: true,
      tipo: tela.tipo,
      periodo,
      today: hoje,
      resumo,
      vencido,
      linhas,
      /**
       * Cartao com fatura aberta e SEM dia de vencimento configurado.
       *
       * Vai na resposta mesmo nao entrando em soma nenhuma, e e o oposto de
       * ruido: sem `due_day` o banco nao calcula vencimento, entao a fatura nao
       * pode virar linha prevista -- e omitir isso em silencio deixaria a tela
       * de Despesas com um "Previsto" que ignora um cartao INTEIRO, sem nada
       * dizendo que ele foi ignorado. Ver HMO-227.
       */
      fatura_sem_vencimento: fatura.semVencimento,
      /**
       * OS ACERTOS DE GRUPO DESTA ABA -- HMO-366, so em `tipo=income`.
       *
       * `null` nas outras duas telas, e isso NAO e o mesmo que vazio: a tela
       * distingue "nao ha acerto nenhum" (dois arrays vazios) de "esta resposta
       * nao fala de acerto" (campo ausente), e a segunda e tambem o estado de
       * uma resposta guardada no aparelho de antes desta feature. Um `[]` ali
       * afirmaria "voce nao tem nada a confirmar" com base num corpo que nunca
       * respondeu isso.
       *
       * FORA de `resumo` e FORA de `linhas`, pelas duas razoes do cabecalho de
       * lib/acerto-na-aba-receitas.ts.
       */
      acertos_do_grupo: acertos,
      /**
       * PRA QUEM PAGAR -- HMO-365, so na aba Despesas (`[]` nas outras duas).
       *
       * Cada item traz o rotulo PRONTO (`rotulo.texto` + `rotulo.temNome`), e
       * nao so o nome: o fallback de perfil ilegivel e decisao de uma funcao so
       * (`rotuloDoDestino`), porque calcular o texto na rota e a marca na tela e
       * a receita do rotulo que mente -- ver o cabecalho de lib/pra-quem-pagar.ts.
       *
       * O VALOR DAQUI JA ESTA DENTRO DE `resumo.previsto`. Nao e um acrescimo, e
       * a tela diz isso por escrito (`NOTA_PRA_QUEM_PAGAR`): e a minha parte das
       * contas que outra pessoa frontou, que a regra do pagador (HMO-363) ja
       * somou no «Previsto».
       */
      pra_quem_pagar: destinos,
      /**
       * QUEM ME PAGA -- HMO-422, so na aba Receitas (`null` nas outras duas).
       *
       * O ESPELHO de `pra_quem_pagar`, e a mesma frase vale com o sinal
       * trocado: O VALOR DAQUI JA ESTA DENTRO DE `resumo.previsto`. Nao e um
       * acrescimo -- e o reembolso de grupo que `resumoComReembolsoPrevisto`
       * somou la, agora com o nome de quem deve e o grupo de cada parcela.
       *
       * `null` e nao `{linhas: [], sem_devedor: 0}` nas outras abas, pela razao
       * de `acertos_do_grupo`: a tela distingue "nenhum credito" (array vazio)
       * de "esta resposta nao fala de credito" (campo ausente), e a segunda e
       * tambem o estado de um corpo guardado no aparelho de antes desta issue.
       * Um `[]` ali afirmaria "ninguem te deve nada" sobre uma resposta que
       * nunca respondeu isso -- e o cartao «Previsto» ao lado estaria dizendo
       * R$ 508,42.
       */
      quem_me_paga: creditoDosGrupos,
    });
  } catch (error) {
    console.error("Erro na tela de movimentação:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
