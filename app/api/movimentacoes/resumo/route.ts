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
// O QUE FICA DE FORA, E A TELA DIZ
// --------------------------------
// A MINHA PARTE das despesas de grupo que outra pessoa pagou
// (`group_share_entries`, 033). Ela esta na lista de Financas Pessoais (HMO-215)
// e nao entra aqui, pelo mesmo motivo que nao entra nos tres cartoes de la: o
// realizado soma o valor CHEIO do que saiu da minha conta, e acrescentar uma
// FRACAO do que saiu da conta de outro misturaria dois criterios dentro de um
// numero so. A legenda da tela de Despesas diz isso em uma linha -- um valor
// que falta sem rotulo e indistinguivel de um bug.
// =============================================================================

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import { janelaParaMaterializar, periodoCorrente, periodoDaQuery } from "@/lib/periodo-do-painel";
import { materializarAgenda } from "@/lib/services/scheduled";
import { faturasPrevistasDaJanela } from "@/lib/services/fatura-prevista";
import { agendaSemCompraNoCartao } from "@/lib/agenda-do-cartao";
import {
  linhasDaTela,
  previstoVencido,
  resumoDaTela,
  telaDoTipo,
  type PrevistaCrua,
  type RealizadaCrua,
} from "@/lib/telas-de-movimentacao";

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
    const { data: realizadasCruas, error: erroRealizadas } = await supabase
      .from("financial_transactions")
      .select(
        `
        id, description, amount, exchange_rate, currency, transaction_date,
        transaction_type, counterpart_transaction_id,
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
    const { data: agendaCrua, error: erroAgenda } = await supabase
      .from("scheduled_transactions_effective")
      .select(
        `
        id, description, amount, due_date, status, effective_status, currency,
        direction, notes, recurring_rule_id,
        category:transaction_categories(name),
        account:financial_accounts(id, name, account_type)
      `
      )
      .eq("user_id", user.id)
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
    // 4. Os tres numeros e a lista
    // ----------------------------------------------------------------
    const previstas: PrevistaCrua[] = [
      ...(agenda as PrevistaCrua[]),
      ...(fatura.previstas as PrevistaCrua[]),
    ];

    const linhas = linhasDaTela(
      (realizadasCruas ?? []) as unknown as RealizadaCrua[],
      previstas,
      tela.tipo,
      idsDeFixa
    );

    const resumo = resumoDaTela(linhas);
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
    });
  } catch (error) {
    console.error("Erro na tela de movimentação:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
