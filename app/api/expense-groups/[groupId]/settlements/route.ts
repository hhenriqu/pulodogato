import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { MOEDA_PADRAO, moedaConhecida } from "@/lib/dinheiro";
import { cotacaoCoerente, precisaDeCotacao, valorEmReais } from "@/lib/cambio";
import {
  chaveDoAcerto,
  direcaoDoAcerto,
  mensagemDaContaDoAcerto,
  pernaDoAcerto,
} from "@/lib/acerto-em-lancamento";
import { categoriaDoAcerto } from "@/lib/categoria-do-acerto";

// O perfil NAO vem por embed: as FKs da 007 apontam para `auth.users`, entao o
// PostgREST nao relaciona `group_settlements` com `profiles` (ver a nota longa
// no GET). Ele vem da segunda consulta, e `| null` porque a RLS de `profiles`
// pode esconder a linha de quem nao e minha conexao.
type PerfilDoAcerto = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

// `amount` e `exchange_rate` sao numeric -- chegam como string no JSON do
// PostgREST, que e o que justifica o `Number()` em cada leitura.
//
// `from_user_id`/`to_user_id` sao as COLUNAS, e e por elas que a direcao do
// acerto e decidida. Este tipo trazia `from_user`/`to_user` (os embeds) ate a
// HMO-278 trocar o embed por duas consultas; o `s.from_user_id` do corpo passou
// a ser TS2551 e ficou invisivel porque o callback estava anotado `any` -- o
// mesmo `any` que esta issue tirou. Mantenha este tipo colado no `select`.
type AcertoDoGrupo = {
  id: string;
  amount: number | string;
  currency: string | null;
  exchange_rate: number | string | null;
  settled_on: string;
  note: string | null;
  created_by: string;
  created_at: string;
  from_user_id: string;
  to_user_id: string;
};

/** A perna que EU ja lancei para um acerto, quando ja lancei. */
type PernaDoAcerto = {
  id: string;
  amount: number | string;
  account_id: string | null;
  transaction_type: string | null;
  notes: string | null;
};

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
 *     -> continua respeitada, e e o que limita este POST a UMA perna:
 *        `financial_transactions_write` e
 *        `FOR INSERT WITH CHECK (user_id = auth.uid())`
 *        (`002_rls_lockdown.sql:472`), e esta rota roda na sessao de quem
 *        clicou. Qualquer um dos dois lados pode registrar -- `from_user_id`
 *        ou `to_user_id` igual a quem chama --, e cada um grava a PROPRIA.
 *
 * A PERNA DO OUTRO LADO CHEGOU NA FASE 12
 * ---------------------------------------
 * `settlements/[id]/perna/route.ts`: a contraparte abre a propria tela, ve o
 * acerto ja registrado e lanca na conta DELA, na sessao dela. O POST aqui
 * continua gravando uma perna so, e de proposito -- nao ha outro mecanismo, ha
 * a outra sessao.
 *
 * O GET passou a dizer, em `minha_perna`, se quem esta lendo ja lancou. Sem esse
 * campo a tela nao consegue distinguir "ainda nao lancado na sua conta" de
 * "nao aconteceu", que e a parte da fase 12 que nao e dinheiro: e rotulo.
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

    // SEM EMBED DE `profiles`, E NAO POR GOSTO: O EMBED NAO EXISTE
    // ------------------------------------------------------------
    // Esta consulta pedia `from_user:profiles!group_settlements_from_user_id_fkey`
    // e devolvia **500 em producao, para todo mundo**, desde que a rota foi
    // escrita. As FKs da 007 apontam para `auth.users(id)`, nao para
    // `public.profiles(id)` (`007_group_settlements.sql:199-202`), e o PostgREST
    // so embeda pela FK que chega NA TABELA pedida -- entao o hint nomeia uma
    // constraint que existe e ainda assim nao relaciona nada:
    //
    //   PGRST200: Searched for a foreign key relationship between
    //   'group_settlements' and 'profiles' using the hint
    //   'group_settlements_from_user_id_fkey' ... but no matches were found.
    //
    // O sintoma nao parecia com erro de schema: a tela de grupo mostrava a aba
    // de acertos VAZIA, que e indistinguivel de "nenhum acerto registrado".
    // Medido em producao em 06/10/2026 pelas duas contas do fixture HMO-255.
    //
    // Consertar pelo lado do codigo e nao por migration e o que faz esta linha
    // subir hoje: migration e passo manual no SQL Editor. Duas consultas, como
    // `settlements/[id]/perna/route.ts` ja faz pelo mesmo motivo.
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
        from_user_id,
        to_user_id
      `
      )
      .eq("group_id", groupId)
      .order("settled_on", { ascending: false })
      .order("created_at", { ascending: false })
      .returns<AcertoDoGrupo[]>();

    if (error) {
      console.error("Erro ao listar acertos:", error);
      return NextResponse.json(
        { error: "Failed to load settlements" },
        { status: 500 }
      );
    }

    // Os nomes e avatares, numa consulta para a lista toda. Um perfil que a RLS
    // nao deixe ler simplesmente NAO entra no mapa, e a linha sai com
    // `from_user: null` -- a tela ja trata isso ("Sem nome"). Antes, o mesmo caso
    // derrubava a resposta inteira.
    const idsDasPessoas = Array.from(
      new Set(
        (settlements || []).flatMap((s) =>
          [s.from_user_id, s.to_user_id].filter(Boolean)
        )
      )
    );

    const perfilPorId = new Map<string, PerfilDoAcerto>();
    if (idsDasPessoas.length > 0) {
      const { data: perfis } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", idsDasPessoas);

      for (const p of perfis || []) perfilPorId.set(p.id, p);
    }

    // AS PERNAS DE QUEM ESTA LENDO (HMO-245, fase 12)
    // ----------------------------------------------
    // Uma consulta para a lista toda, por `notes IN (...)`. A RLS de
    // `financial_transactions` filtra por `user_id`, entao o que volta e
    // SEMPRE a propria perna -- a pergunta que a tela faz e "EU ja lancei?",
    // nunca "o outro lancou?", que nenhuma sessao pode responder.
    //
    // `from_user_id` e `to_user_id` entraram no `select` acima como COLUNAS, ao
    // lado dos embeds de `profiles`: e por esses dois ids que
    // `comoEuVejoOAcerto` decide a direcao na tela, e ler `from_user.id` em vez
    // da coluna falharia calado -- ser do mesmo grupo nao da acesso ao perfil
    // do outro, entao o embed vem NULO para quem nao tem o perfil visivel e a
    // direcao sairia como "nao sou parte" para quem e parte.
    const chaves = (settlements || []).map((s) => chaveDoAcerto(s.id));

    const pernasPorChave = new Map<string, PernaDoAcerto>();
    if (chaves.length > 0) {
      const { data: pernas } = await supabase
        .from("financial_transactions")
        .select("id, amount, account_id, transaction_type, notes")
        .eq("user_id", user.id)
        .in("notes", chaves)
        .returns<PernaDoAcerto[]>();

      for (const p of pernas || []) {
        if (p.notes) pernasPorChave.set(p.notes, p);
      }
    }

    return NextResponse.json({
      success: true,
      settlements: (settlements || []).map((s) => {
        const currency = moedaConhecida(s.currency) ? s.currency : MOEDA_PADRAO;
        const rate = Number(s.exchange_rate ?? 1) || 1;
        const minhaPerna = pernasPorChave.get(chaveDoAcerto(s.id)) || null;

        return {
          ...s,
          // O que o embed quebrado devolvia -- mesma FORMA, para a tela nao
          // mudar: `{ id, full_name, avatar_url }` ou `null`.
          from_user: perfilPorId.get(s.from_user_id) ?? null,
          to_user: perfilPorId.get(s.to_user_id) ?? null,
          // `null` = eu ainda nao lancei este acerto na minha conta. E a
          // diferenca entre "ainda nao lancado" e "nao aconteceu".
          minha_perna: minhaPerna
            ? {
                id: minhaPerna.id,
                amount: Number(minhaPerna.amount),
                account_id: minhaPerna.account_id,
                transaction_type: minhaPerna.transaction_type,
              }
            : null,
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
