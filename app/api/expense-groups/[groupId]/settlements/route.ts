import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { MOEDA_PADRAO, moedaConhecida } from "@/lib/dinheiro";
import { cotacaoCoerente, precisaDeCotacao, valorEmReais } from "@/lib/cambio";
import {
  DESCRICAO_DA_CATEGORIA_DE_ACERTO,
  NOME_DA_CATEGORIA_DE_ACERTO,
  direcaoDoAcerto,
  mensagemDaContaDoAcerto,
  pernaDoAcerto,
} from "@/lib/acerto-em-lancamento";

/**
 * Acertos de contas do grupo: o registro de "Caio pagou R$ 130 para a Ana".
 *
 * GET  lista os acertos ja registrados, mais recentes primeiro.
 * POST registra um novo E GRAVA A PERNA DE QUEM REGISTRA em
 *      `financial_transactions`.
 *
 * O ACERTO PASSOU A VIRAR LANCAMENTO (HMO-245, fase 11)
 * -----------------------------------------------------
 * Ate aqui esta frase dizia o contrario -- "o acerto NAO vira lancamento" --
 * apontando para a SECAO "POR QUE UMA TABELA SO PARA ISSO" da 007, e mandando
 * quem quisesse ver o dinheiro sair da conta lancar a transferencia por fora.
 * Na pratica ninguem lancava: o Pix ficava invisivel nos dois lados e o saldo da
 * conta corrente nao se mexia. Era o defeito relatado.
 *
 * A decisao nova NAO reabre as duas objecoes da 007 -- a 007 foi reescrita no
 * mesmo commit e as duas continuam de pe:
 *
 *   objecao 2 (lancar como despesa contaria o hotel duas vezes por categoria)
 *     -> respondida pelo tipo `transfer`. As duas pernas sao `transfer`, que
 *        `category_monthly_totals`, `monthly_cash_flow` e
 *        `personal_category_monthly_totals` ignoram: o acerto nao muda a
 *        Receita nem a Despesa de ninguem, so move dinheiro de lugar. O POR QUE
 *        de `transfer` tambem do lado de QUEM RECEBE esta medido em
 *        `lib/acerto-em-lancamento.ts` (com `income`, o painel pessoal de quem
 *        recebe fecha o mes empatado e apaga a propria parte dela).
 *
 *   objecao 1 (um acerto nunca deve mexer na conta de OUTRA pessoa)
 *     -> continua respeitada, e e o que limita esta fase a UMA perna:
 *        `financial_transactions_write` e
 *        `FOR INSERT WITH CHECK (user_id = auth.uid())`
 *        (`002_rls_lockdown.sql:472`), e esta rota roda na sessao de quem
 *        clicou. A perna da contraparte e a fase 12 e vai precisar de outro
 *        mecanismo. Qualquer um dos dois lados pode registrar -- `from_user_id`
 *        ou `to_user_id` igual a quem chama --, e cada um grava a PROPRIA.
 *
 * `account_id` passou a ser obrigatorio no POST, e isso e o resto do conserto:
 * sem conta nao ha onde a perna cair, e um POST sem conta "funcionaria" como
 * antes -- registrando a quitacao e nenhum dinheiro.
 *
 * ACERTO EM MOEDA ESTRANGEIRA (HMO-182, item 5)
 * ---------------------------------------------
 * A 026 deu a `group_settlements` as mesmas duas colunas do lancamento --
 * `currency` e `exchange_rate`, congelada no dia `settled_on` -- e os mesmos
 * tres CHECKs. O motivo esta escrito na migration: `group_member_balances` cruza
 * pago, devido e acertos na MESMA soma, entao um acerto de US$ 50 lido como
 * R$ 50 abate um quinto da divida e a tela continua pedindo o resto depois de o
 * dinheiro ter sido pago.
 *
 * `amount` esta na moeda do PAGAMENTO, nunca em real. Quem manda 267.50 com
 * `currency: 'USD'` e `exchange_rate: 5.35` registra um pagamento de US$ 267,50
 * -- R$ 1.431,13 -- e nao os R$ 267,50 que pretendia. A rota nao tem como
 * distinguir os dois casos (os dois numeros sao validos), entao quem monta o
 * payload e `acertoNaMoedaDaViagem` em lib/moeda-do-grupo.ts, que faz a divisao
 * e tem teste.
 *
 * Os dois campos sao OPCIONAIS e caem em (BRL, 1): todo cliente que ja chamava
 * esta rota continua funcionando sem mudanca, e continua registrando em real --
 * que e o que ele sempre fez.
 */

/**
 * A categoria reservada do acerto DAQUELE usuario, criando-a na primeira vez.
 *
 * Mesma receita do ajuste de fatura (HMO-253,
 * `app/api/card-invoices/ajuste/route.ts`): `category_id` e NOT NULL, acerto nao
 * tem categoria, e a 036 deu `user_id` + `transaction_categories_insert_own`
 * (`WITH CHECK (user_id = auth.uid())`) a `transaction_categories` -- entao a
 * linha nasce aqui, por usuario, sem migration.
 *
 * O caminho da 023 (seed global, colado a mao no SQL Editor) nao se repete: ele
 * foi necessario porque a tabela era global e o INSERT batia em 42501 em toda
 * chamada, de todo usuario.
 *
 * SELECT-depois-INSERT e nao `ON CONFLICT`: a UNIQUE das categorias de usuario e
 * indice PARCIAL (`WHERE user_id IS NOT NULL`), e indice parcial nao arbitra
 * `ON CONFLICT`. O ramo de 23505 cobre dois pedidos simultaneos do mesmo
 * usuario.
 */
async function categoriaDoAcerto(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  serviceId: string
): Promise<{ id: string } | { erro: string }> {
  const { data: existente, error: erroBusca } = await supabase
    .from("transaction_categories")
    .select("id")
    .eq("service_id", serviceId)
    .eq("user_id", userId)
    .eq("name", NOME_DA_CATEGORIA_DE_ACERTO)
    .maybeSingle();

  if (erroBusca) {
    console.error("Erro ao buscar a categoria do acerto:", erroBusca);
    return { erro: "Nao foi possivel preparar o lancamento do acerto" };
  }
  if (existente) return { id: existente.id };

  const { data: criada, error: erroCriacao } = await supabase
    .from("transaction_categories")
    .insert({
      service_id: serviceId,
      // Do servidor, nunca do corpo do pedido.
      user_id: userId,
      name: NOME_DA_CATEGORIA_DE_ACERTO,
      description: DESCRICAO_DA_CATEGORIA_DE_ACERTO,
      icon: "handshake",
      color_hex: "#6B7280",
      // `is_expense` e NOT NULL e e lido so como ultimo recurso: as telas
      // classificam por `transaction_type`, e a perna do acerto sempre grava o
      // tipo. FALSE porque a perna NAO e despesa em nenhum dos dois lados --
      // ela e `transfer` --, e um fallback que dissesse "despesa" seria a
      // afirmacao errada justamente para quem recebeu.
      is_expense: false,
      is_active: false,
    })
    .select("id")
    .single();

  if (erroCriacao) {
    if (erroCriacao.code === "23505") {
      const { data: recem } = await supabase
        .from("transaction_categories")
        .select("id")
        .eq("service_id", serviceId)
        .eq("user_id", userId)
        .eq("name", NOME_DA_CATEGORIA_DE_ACERTO)
        .maybeSingle();
      if (recem) return { id: recem.id };
    }
    console.error("Erro ao criar a categoria do acerto:", erroCriacao);
    return { erro: "Nao foi possivel preparar o lancamento do acerto" };
  }

  return { id: criada.id };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = params;

    // A RLS de group_settlements ja exige is_group_member, entao esta checagem
    // nao e o que protege o dado -- ela existe para devolver 403 em vez de uma
    // lista vazia, que e indistinguivel de "o grupo nao tem acerto nenhum".
    const { data: membership } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { data: settlements, error } = await supabase
      .from("group_settlements")
      .select(
        `
        id,
        amount,
        currency,
        exchange_rate,
        settled_on,
        note,
        created_by,
        created_at,
        from_user:profiles!group_settlements_from_user_id_fkey (
          id, full_name, avatar_url
        ),
        to_user:profiles!group_settlements_to_user_id_fkey (
          id, full_name, avatar_url
        )
      `
      )
      .eq("group_id", groupId)
      .order("settled_on", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Erro ao listar acertos:", error);
      return NextResponse.json(
        { error: "Failed to load settlements" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      settlements: (settlements || []).map((s: any) => {
        const currency = moedaConhecida(s.currency) ? s.currency : MOEDA_PADRAO;
        const rate = Number(s.exchange_rate ?? 1) || 1;

        return {
          ...s,
          amount: Number(s.amount),
          currency,
          exchange_rate: rate,
          // O que este pagamento abateu de verdade, pela mesma conta da view
          // (`amount * exchange_rate`). A lista de pagamentos mostra os dois:
          // "US$ 50,00" e o que saiu do bolso, "R$ 267,50" e o que saiu da
          // divida. Sem o segundo, um historico misturando moedas nao soma.
          amount_in_brl: valorEmReais(Number(s.amount), rate),
          // Quem registrou e quem pode desfazer -- a RLS de DELETE exige
          // created_by = auth.uid(). A tela usa isto para nao oferecer um botao
          // que vai falhar.
          can_delete: s.created_by === user.id,
        };
      }),
    });
  } catch (error) {
    console.error("Erro em GET settlements:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = params;
    const body = await request.json();

    const fromUserId = body.from_user_id;
    const toUserId = body.to_user_id;
    const amount = Number(body.amount);

    if (!fromUserId || !toUserId) {
      return NextResponse.json(
        { error: "from_user_id e to_user_id sao obrigatorios" },
        { status: 400 }
      );
    }

    if (fromUserId === toUserId) {
      return NextResponse.json(
        { error: "Um acerto precisa de duas pessoas diferentes" },
        { status: 400 }
      );
    }

    // `Number("abc")` e NaN e `NaN > 0` e false, entao este teste ja cobre o
    // valor nao numerico. O CHECK do banco cobriria de qualquer forma, mas com
    // um 500 em vez de uma mensagem legivel.
    if (!(amount > 0)) {
      return NextResponse.json(
        { error: "O valor do acerto tem que ser maior que zero" },
        { status: 400 }
      );
    }

    // Centavos: o valor vem da sugestao calculada em lib/settlement.ts, que ja
    // trabalha em centavos inteiros. Arredondar aqui impede que um cliente
    // mande 33.333333 e grave um valor que a coluna numeric(15,2) trunca
    // sozinha -- o acerto nao zeraria o saldo e ninguem saberia por que.
    const valor = Math.round(amount * 100) / 100;

    // A moeda e a cotacao do pagamento (026). Ausentes = em real, que e o que
    // esta rota sempre fez.
    const currency = String(body.currency ?? MOEDA_PADRAO)
      .trim()
      .toUpperCase();

    if (!moedaConhecida(currency)) {
      return NextResponse.json(
        { error: "Moeda desconhecida para o acerto" },
        { status: 400 }
      );
    }

    // BRL grava 1 e ignora o que vier, igual a `taxaParaGravar` no lancamento: a
    // alternativa e deixar sair uma linha (BRL, 1.05) que o CHECK recusa com um
    // erro que a pessoa nao tem como associar a campo nenhum.
    const exchangeRate = precisaDeCotacao(currency)
      ? Number(body.exchange_rate)
      : 1;

    // `cotacaoCoerente` e a regra do CHECK
    // `group_settlements_rate_matches_currency` em TypeScript -- inclusive o
    // caso que parece inofensivo e nao e: moeda estrangeira com cotacao 1. Sem
    // esta guarda, um acerto de US$ 50 entraria na soma da view valendo R$ 50.
    if (!cotacaoCoerente(currency, exchangeRate)) {
      return NextResponse.json(
        {
          error: precisaDeCotacao(currency)
            ? `Informe a cotação do dia do pagamento para registrar um acerto em ${currency}.`
            : "Um acerto em reais não leva cotação.",
        },
        { status: 400 }
      );
    }

    // Quem registra precisa ser parte no pagamento. A policy de INSERT da 007
    // exige o mesmo; aqui e so para a mensagem ser legivel em vez de 42501.
    if (fromUserId !== user.id && toUserId !== user.id) {
      return NextResponse.json(
        {
          error:
            "Voce so pode registrar um acerto em que paga ou recebe. Peca a quem participou.",
        },
        { status: 403 }
      );
    }

    // As duas partes precisam ser membros ativos: um acerto com quem nunca
    // esteve no grupo nao corresponde a divida nenhuma, e a RLS nao checa isso
    // (ela so olha quem esta gravando).
    const { data: partes } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("status", "active")
      .in("user_id", [fromUserId, toUserId]);

    if (!partes || partes.length !== 2) {
      return NextResponse.json(
        { error: "As duas pessoas precisam ser membros ativos do grupo" },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------------
    // A PERNA DE QUEM REGISTRA (HMO-245, fase 11)
    // ------------------------------------------------------------------
    // Tudo que pode recusar a perna e conferido ANTES de gravar a quitacao. A
    // ordem nao e estetica: `supabase-js` fala PostgREST, uma requisicao por
    // vez, e nao ha transacao entre os dois inserts. Descobrir depois que a
    // conta e um cartao deixaria a quitacao gravada sem lancamento -- que e
    // exatamente o estado que esta fase existe para acabar, e que ninguem veria.
    const direcao = direcaoDoAcerto({
      fromUserId,
      toUserId,
      userId: user.id,
    });

    // `null` nao e alcancavel aqui: a guarda de "so quem paga ou recebe" acima
    // ja respondeu 403. Tratar de novo e o que mantem o tipo honesto -- e se a
    // guarda de cima mudar, a recusa continua sendo a mesma.
    if (!direcao) {
      return NextResponse.json(
        {
          error:
            "Voce so pode registrar um acerto em que paga ou recebe. Peca a quem participou.",
        },
        { status: 403 }
      );
    }

    const accountId =
      typeof body.account_id === "string" && body.account_id
        ? body.account_id
        : null;

    if (!accountId) {
      return NextResponse.json(
        { error: mensagemDaContaDoAcerto("sem_conta") },
        { status: 400 }
      );
    }

    // `user_id` no filtro: a conta de outra pessoa volta como "nao encontrada",
    // que e a resposta certa -- dizer "essa conta nao e sua" confirmaria que o
    // id existe. A RLS recusaria o insert de qualquer forma, com 42501.
    const { data: conta } = await supabase
      .from("financial_accounts")
      .select("id, name, account_type, currency")
      .eq("user_id", user.id)
      .eq("id", accountId)
      .maybeSingle();

    if (!conta) {
      return NextResponse.json(
        { error: mensagemDaContaDoAcerto("conta_nao_encontrada") },
        { status: 400 }
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

    const categoria = await categoriaDoAcerto(supabase, user.id, servico.id);
    if ("erro" in categoria) {
      return NextResponse.json({ error: categoria.erro }, { status: 500 });
    }

    // Os nomes sao so para a descricao do extrato, e e por isso que a falha
    // deles nao derruba nada: `descricaoDoAcerto` tem frase para o caso sem
    // nome. Duas consultas diretas em vez de embed -- `group_members` tem mais
    // de uma FK para `profiles` e o embed sairia PGRST201.
    const contraparteId = direcao === "recebi" ? fromUserId : toUserId;
    const [{ data: contraparte }, { data: grupo }] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name")
        .eq("id", contraparteId)
        .maybeSingle(),
      supabase
        .from("expense_groups")
        .select("name")
        .eq("id", groupId)
        .maybeSingle(),
    ]);

    const settledOn =
      body.settled_on || new Date().toISOString().slice(0, 10);

    // A perna e montada ANTES do insert da quitacao, com um id de mentira, so
    // para saber se a conta escolhida serve. A de verdade e montada depois, com
    // o id real -- `notes` carrega esse id, e e por ele que o desfazer acha a
    // linha.
    const ensaio = pernaDoAcerto({
      direcao,
      conta,
      amount: valor,
      currency,
      exchange_rate: exchangeRate,
      settledOn,
      settlementId: "00000000-0000-0000-0000-000000000000",
    });

    if (ensaio.problema) {
      return NextResponse.json(
        { error: mensagemDaContaDoAcerto(ensaio.problema, currency) },
        { status: 400 }
      );
    }

    const { data: settlement, error } = await supabase
      .from("group_settlements")
      .insert({
        group_id: groupId,
        from_user_id: fromUserId,
        to_user_id: toUserId,
        amount: valor,
        currency,
        exchange_rate: exchangeRate,
        settled_on: settledOn,
        note: body.note || null,
        created_by: user.id,
      })
      .select("id, amount, currency, exchange_rate, settled_on, note, created_at")
      .single();

    if (error) {
      // 42501 = a policy da 007 barrou. Acontece quando o banco ainda nao tem a
      // migration aplicada com a regra que esta rota assume.
      //
      // 23514 = um dos CHECKs da 026. As guardas acima cobrem os casos que esta
      // rota produz, entao chegar aqui significa OUTRA coisa: a 026 nao esta
      // aplicada neste banco, ou a coluna existe com um CHECK diferente do que
      // este codigo assume. As duas leituras merecem uma frase propria em vez de
      // "Nao foi possivel registrar o acerto" -- a diferenca entre "tente de
      // novo" e "falta aplicar a migration" nao aparece em log nenhum que a
      // pessoa consiga ler.
      if (error.code === "23514") {
        console.error("CHECK da 026 recusou o acerto:", error);
        return NextResponse.json(
          {
            error:
              "O banco recusou a moeda ou a cotação deste acerto. Se o grupo é em moeda estrangeira, avise: pode faltar aplicar uma migration.",
          },
          { status: 400 }
        );
      }

      const status = error.code === "42501" ? 403 : 500;
      console.error("Erro ao registrar acerto:", error);
      return NextResponse.json(
        { error: "Nao foi possivel registrar o acerto" },
        { status }
      );
    }

    // Agora com o id real: `notes` carrega `acerto:<id>`, e e por essa chave que
    // o DELETE apaga a perna junto com a quitacao.
    const { perna } = pernaDoAcerto({
      direcao,
      conta,
      amount: valor,
      currency,
      exchange_rate: exchangeRate,
      settledOn,
      settlementId: settlement.id,
      nomeDaContraparte: contraparte?.full_name,
      nomeDoGrupo: grupo?.name,
    });

    const { data: lancamento, error: erroDoLancamento } = await supabase
      .from("financial_transactions")
      .insert({
        ...perna!,
        user_id: user.id,
        service_id: servico.id,
        category_id: categoria.id,
      })
      .select("id, amount, transaction_type, transaction_date, account_id")
      .single();

    if (erroDoLancamento || !lancamento) {
      // A QUITACAO OU NENHUMA DAS DUAS. Deixar a quitacao sem perna reporia o
      // defeito desta issue -- a divida sai da sugestao, o Pix nao aparece em
      // lugar nenhum -- e com uma tela dizendo "Acerto registrado" por cima.
      // Tudo que podia recusar a perna foi conferido antes do insert da
      // quitacao, entao chegar aqui e falha de banco, nao de preenchimento.
      await supabase
        .from("group_settlements")
        .delete()
        .eq("id", settlement.id);

      console.error(
        "Acerto desfeito: a perna em financial_transactions falhou",
        erroDoLancamento
      );
      return NextResponse.json(
        {
          error:
            "Não foi possível lançar o acerto na sua conta. Nada foi registrado — tente novamente.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      // O que entrou em `financial_transactions`. A tela usa para dizer em QUAL
      // conta o dinheiro mexeu: "Acerto registrado" sozinho nao distingue o
      // comportamento novo do antigo, que era registrar e nao lancar nada.
      lancamento: {
        ...lancamento,
        amount: Number(lancamento.amount),
        account_name: conta.name,
      },
      settlement: {
        ...settlement,
        amount: Number(settlement.amount),
        exchange_rate: Number(settlement.exchange_rate),
        amount_in_brl: valorEmReais(
          Number(settlement.amount),
          Number(settlement.exchange_rate)
        ),
      },
    });
  } catch (error) {
    console.error("Erro em POST settlements:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
