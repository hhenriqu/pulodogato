import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { moedaConhecida } from "@/lib/dinheiro";
import { taxaParaGravar } from "@/lib/cambio";
import { moedaDaViagem } from "@/lib/moeda-do-grupo";
import { divisaoParaGravar } from "@/lib/divisao-do-grupo";
import { conferirEscrita } from "@/lib/escrita-conferida";

// Sem o generic `Database` no client, `select()` volta `any`. `transaction`,
// `category`, `member` e `user` sao embeds many-to-one (objeto, nao lista) e
// podem vir nulos pela RLS -- o codigo abaixo ja trata o nulo de `transaction`
// com um `return null` e o de `member` com `?.`.
type DespesaDoGrupo = {
  id: string;
  split_type: string | null;
  created_at: string;
  transaction: {
    id: string;
    description: string | null;
    amount: number;
    currency: string | null;
    exchange_rate: number | null;
    transaction_date: string;
    created_at: string;
    user_id: string;
    category: { name: string; icon: string | null } | null;
  } | null;
};

type ParteDaDespesa = {
  id: string;
  amount: number;
  status: string | null;
  member: {
    id: string;
    user: {
      id: string;
      full_name: string | null;
      avatar_url: string | null;
    } | null;
  } | null;
};

export async function GET(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const supabase = createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = params;

    console.log("Getting transactions for group:", groupId);

    // Check if user is member of this group
    const { data: membership } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get transactions linked to this group through group_transactions table
    const { data: groupTransactions, error: groupError } = await supabase
      .from("group_transactions")
      .select(
        `
        id,
        split_type,
        created_at,
        transaction:financial_transactions (
          id,
          description,
          amount,
          currency,
          exchange_rate,
          transaction_date,
          created_at,
          user_id,
          category:transaction_categories (
            name,
            icon
          )
        )
      `
      )
      .eq("group_id", groupId)
      .returns<DespesaDoGrupo[]>();

    if (groupError) {
      console.error("Error loading group transactions:", groupError);
      return NextResponse.json(
        { error: "Failed to load transactions" },
        { status: 500 }
      );
    }

    // Get splits for each transaction and payer info
    const transactionsWithSplits = await Promise.all(
      (groupTransactions || []).map(async (gt) => {
        if (!gt.transaction) return null;

        // Get payer info separately
        const { data: payer } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .eq("id", gt.transaction.user_id)
          .single();

        const { data: splits } = await supabase
          .from("group_expense_splits")
          .select(
            `
            id,
            amount,
            status,
            member:group_members (
              id,
              user:profiles!group_members_user_id_fkey (
                id,
                full_name,
                avatar_url
              )
            )
          `
          )
          .eq("group_transaction_id", gt.id)
          .returns<ParteDaDespesa[]>();

        return {
          id: gt.transaction.id,
          description: gt.transaction.description,
          amount: Math.abs(gt.transaction.amount), // Convert to positive for display
          // `amount` esta NESTA moeda, e nao em real. A lista precisa das duas
          // colunas para nao escrever "R$ 180,00" sobre um jantar de US$ 180 --
          // exatamente o erro de 80% que o CHECK da 026 fecha na escrita.
          currency: gt.transaction.currency || "BRL",
          exchange_rate: Number(gt.transaction.exchange_rate ?? 1) || 1,
          transaction_date: gt.transaction.transaction_date,
          created_at: gt.transaction.created_at,
          payer: payer,
          splits: (splits || []).map((split) => ({
            id: split.id,
            // A parte de cada um esta na moeda da DESPESA: `group_expense_splits`
            // nao tem moeda propria de proposito (ver a 026), porque a parte e
            // uma fracao do todo e a cotacao certa e a da despesa que a originou.
            amount: split.amount,
            status: split.status,
            member: split.member?.user,
          })),
          category: gt.transaction.category,
        };
      })
    );

    const validTransactions = transactionsWithSplits.filter((t) => t !== null);

    return NextResponse.json({
      success: true,
      transactions: validTransactions,
    });
  } catch (error) {
    console.error("Error in transactions API:", error);
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

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = params;
    const body = await request.json();

    console.log("Creating transaction for group:", groupId, body);

    // Check if user is member of this group
    const { data: membership } = await supabase
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get a default category for expenses (first expense category)
    const { data: category } = await supabase
      .from("transaction_categories")
      .select("id, service_id")
      .eq("is_expense", true)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!category) {
      return NextResponse.json(
        { error: "No expense category found" },
        { status: 400 }
      );
    }

    // A MOEDA DA DESPESA DE GRUPO (HMO-182, itens 2 e 3)
    // -------------------------------------------------
    // Este e o TERCEIRO caminho de escrita de lancamento do app, e ate aqui ele
    // nao mandava moeda nenhuma -- toda despesa lancada de dentro do grupo caia
    // no DEFAULT 'BRL' da 022. Numa viagem em dolar isso grava o jantar de
    // US$ 180 como R$ 180: o CHECK da 026 NAO reclama (BRL com cotacao 1 e
    // valido), a tela mostra "R$ 180,00", e o saldo do grupo fecha. E o mesmo
    // erro de 80% que a 026 fechou nos outros dois caminhos, pela porta que
    // sobrou.
    //
    // A moeda ausente no corpo vira a do GRUPO, e nao BRL: e o que "moeda
    // sugerida a cada despesa da viagem" significa do lado do servidor, e o que
    // protege um cliente que ainda nao manda o campo.
    //
    // Mas a moeda EXPLICITA no corpo ganha da do grupo, sempre. "Sugerida" e a
    // palavra da decisao: uma diaria cobrada em dolar numa viagem ao Chile e o
    // caso normal, nao a excecao, e uma regra que sobrepusesse o pedido do
    // cliente pela moeda do grupo tornaria essa despesa impossivel de lancar
    // corretamente.
    const { data: grupo } = await supabase
      .from("expense_groups")
      .select("currency")
      .eq("id", groupId)
      .maybeSingle();

    if (body.currency !== undefined && !moedaConhecida(body.currency)) {
      return NextResponse.json(
        { error: "Moeda desconhecida" },
        { status: 400 }
      );
    }

    const currency = moedaConhecida(body.currency)
      ? String(body.currency).trim().toUpperCase()
      : moedaDaViagem(grupo?.currency);

    // A cotacao do dia da COMPRA (`transaction_date`), nao de hoje. `null`
    // devolvido por `taxaParaGravar` significa "moeda estrangeira sem cotacao
    // utilizavel": gravar assim e 23514, e a mensagem generica do banco nao diz
    // a quem lanca o que fazer.
    const exchangeRate = taxaParaGravar(currency, Number(body.exchange_rate));

    if (exchangeRate === null) {
      return NextResponse.json(
        {
          error: `Informe a cotação de ${currency} no dia da compra para lançar esta despesa.`,
        },
        { status: 400 }
      );
    }

    // A DIVISAO ESCOLHIDA, VALIDADA ANTES DE QUALQUER ESCRITA (HMO-190)
    // ----------------------------------------------------------------
    // `custom_splits` e o nome que a tela manda (ver o cabecalho de
    // lib/divisao-do-grupo.ts: ela montava `custom_splits` e esta rota lia
    // `body.splits`, entao toda divisao combinada era descartada em silencio e
    // a despesa saia em partes iguais). Os dois nomes sao aceitos: `splits` e
    // o que a validacao de lib/validations/financial.ts descreve e o que um
    // cliente mais antigo pode mandar.
    //
    // Validar ANTES do INSERT e o que evita a despesa orfa: uma divisao que nao
    // fecha (70/20) ou um tipo que a coluna nao aceita precisa virar 400 sem
    // ter gravado lancamento nenhum.
    const divisao = divisaoParaGravar({
      tipo: body.split_type,
      partes: body.custom_splits ?? body.splits,
      total: body.amount,
    });

    if (!divisao.ok) {
      return NextResponse.json({ error: divisao.erro }, { status: 400 });
    }

    // `partes === null` e divisao igual: quem rateia e o trigger, em centavos
    // inteiros pelo maior resto (007). A combinada precisa de uma ordem de
    // escrita diferente -- ver o bloco depois do INSERT.
    const partesCombinadas = divisao.partes;

    // Create financial transaction (with negative amount for expenses)
    const { data: transaction, error: transactionError } = await supabase
      .from("financial_transactions")
      .insert({
        user_id: user.id,
        service_id: category.service_id,
        category_id: body.category_id || category.id,
        description: body.description,
        amount: -Math.abs(body.amount), // Negative for expenses
        // SEM ISTO A COLUNA FICA NULL, E QUEM PAGOU NAO APARECE COMO TENDO PAGO.
        //
        // Medido em producao (grupo e3314097, 30/09): a despesa gravou, apareceu
        // na lista, e `group_member_balances` devolveu
        //
        //     total_paid = 0 | total_owed = 963 | net_balance = -963
        //
        // porque a perna do PAGO da view filtra `t.transaction_type = 'expense'`
        // e NULL nao casa com nada. A perna do DEVIDO nao filtra por isso, entao
        // ela contou. Resultado: quem pagou o jantar inteiro aparece devendo o
        // jantar inteiro, e o grupo nao soma zero -- o residual que
        // lib/settlement.ts descreve, com uma causa que nao estava na lista dele.
        //
        // Nao e um defeito desta issue: o INSERT nunca gravou a coluna. Mas e a
        // unica coisa entre o saldo desta tela e o numero certo, e a HMO-182 se
        // fecha conferindo exatamente esse numero.
        transaction_type: "expense",
        currency,
        // Congelada: e a cotacao do dia da compra e nunca e recalculada. E o que
        // faz `group_member_balances` somar `amount * exchange_rate` e chegar ao
        // valor em real que a despesa teve de verdade.
        exchange_rate: exchangeRate,
        transaction_date: body.transaction_date,
        notes: body.notes,
        is_shared: true,
        // Sem esta coluna a despesa fica invisivel para os OUTROS membros: a
        // policy de SELECT de financial_transactions (migration 002) libera a
        // transacao alheia justamente por `group_id IS NOT NULL AND
        // is_group_member(group_id)`. Ate a 007 esta rota nao a gravava, e o
        // resultado era cada membro abrindo a mesma viagem e lendo que todos os
        // outros pagaram zero -- sem erro nenhum aparecer. O consumo de
        // orcamento de grupo (006) depende da mesma coluna.
        //
        // NA DIVISAO COMBINADA A COLUNA ENTRA DEPOIS, E NAO AQUI (HMO-190)
        // ----------------------------------------------------------------
        // Com `group_id` preenchido, o trigger ja cria a ligacao e o rateio
        // IGUAL antes de a rota conseguir dizer qualquer coisa. Para gravar
        // 70/30 por cima disso seria preciso APAGAR as partes iguais -- e a
        // policy `group_expense_splits_delete` exige is_group_admin. Para quem
        // nao e admin do grupo, esse DELETE nao da erro: apaga zero linhas, em
        // silencio, e o INSERT seguinte ACRESCENTA as partes combinadas as
        // iguais. Medido no teste hmo190_divisao_combinada_test.sql, secao 6a:
        // uma despesa de R$ 200 passa a cobrar R$ 400 do grupo.
        //
        // Entao a divisao combinada grava o grupo por ultimo (secao 6b): a
        // despesa nasce sem `group_id`, a rota cria a ligacao com o split_type
        // certo e as partes, e so entao preenche a coluna. Nessa ordem nao ha
        // parte nenhuma para apagar, e nada depende de ser admin.
        group_id: partesCombinadas === null ? groupId : null,
      })
      .select()
      .single();

    if (transactionError) {
      console.error("Error creating transaction:", transactionError);
      return NextResponse.json(
        { error: "Failed to create transaction" },
        { status: 500 }
      );
    }

    // Desfaz a despesa quando a divisao nao pode ser gravada. Sem isso sobra um
    // lancamento sem ligacao de grupo: ele aparece nas despesas pessoais de
    // quem lancou, nao aparece no grupo, e ninguem entende de onde veio. A
    // CASCADE de group_transactions.transaction_id leva a ligacao e as partes
    // junto.
    const desfazer = async (motivo: string, erro: unknown) => {
      console.error(motivo, erro);

      // ESTA ESCRITA E CONFERIDA PARA O LOG, E NUNCA MUDA A RESPOSTA (HMO-356)
      // ---------------------------------------------------------------------
      // A assimetria com o UPDATE la embaixo e deliberada. Aqui zero linha NAO
      // pode virar a falha que a rota reporta: a rota JA esta falhando, e
      // trocar `motivo` por "a compensacao nao pegou nada" apagaria o erro que
      // disparou a compensacao -- que e o unico que diz o que consertar. E o
      // mesmo recorte que lib/escrita-conferida.ts descreve no fim do cabecalho
      // e que a HMO-356 reafirma para os dois `delete` de settlements.
      //
      // Mas zero linha tambem nao e inocente, e e por isso que o `.select()`
      // entra: sem apagar nada a CASCADE de group_transactions.transaction_id
      // nao roda, e sobra exatamente o lancamento orfao que este bloco existe
      // para evitar -- nas despesas pessoais de quem lancou, ausente do grupo,
      // sem ninguem entender de onde veio. `conferirEscrita` aqui serve so para
      // o log nomear a linha que ficou, e para separar "a policy recusou" de
      // "esta chamada perdeu o `.select()`" quando alguem for ler.
      const compensacao = conferirEscrita(
        await supabase
          .from("financial_transactions")
          .delete()
          .eq("id", transaction.id)
          .select("id"),
        `apagar a despesa ${transaction.id}, que ficou sem divisao de grupo`
      );

      if (!compensacao.ok) {
        console.error(
          `Compensacao sem efeito (${compensacao.motivo}): a despesa ` +
            `${transaction.id} ficou ORFA -- gravada, fora do grupo, visivel ` +
            `so para quem lancou. ${compensacao.mensagem}`
        );
      }

      return NextResponse.json({ error: motivo }, { status: 500 });
    };

    if (partesCombinadas !== null) {
      // DIVISAO COMBINADA: ligacao e partes primeiro, `group_id` por ultimo.
      // A despesa nasceu sem grupo (ver o INSERT acima), entao nao existe
      // rateio igual nenhum para competir com este -- nem para apagar.
      const { data: ligacao, error: erroLigacao } = await supabase
        .from("group_transactions")
        .insert({
          group_id: groupId,
          transaction_id: transaction.id,
          // Ja traduzido para o que o CHECK da coluna aceita: as sugestoes da
          // tela falam `proportional` e `historical`, que sao 23514 aqui.
          split_type: divisao.splitType,
          // A policy de INSERT exige `created_by = auth.uid()`. Sem a coluna
          // explicita o INSERT e barrado pela RLS.
          created_by: user.id,
        })
        .select("id, split_type")
        .single();

      if (erroLigacao || !ligacao) {
        return desfazer("Erro ao ligar a despesa ao grupo.", erroLigacao);
      }

      // O BEFORE INSERT `calculate_equal_split` devolve estas linhas intactas
      // porque `split_type <> 'equal'` (007). Os valores ja vem fechando o
      // total em centavos inteiros de `divisaoParaGravar`.
      const { error: erroPartes } = await supabase
        .from("group_expense_splits")
        .insert(
          partesCombinadas.map((parte) => ({
            group_transaction_id: ligacao.id,
            member_id: parte.member_id,
            percentage: parte.percentage,
            amount: parte.amount,
            status: "pending",
          }))
        );

      if (erroPartes) {
        return desfazer("Erro ao gravar a divisão da despesa.", erroPartes);
      }

      // Agora sim a coluna. O trigger roda no UPDATE, encontra a ligacao que
      // acabou de ser criada e nao recria nem recalcula nada (o valor nao
      // mudou). Sem este passo a despesa fica invisivel para os outros membros
      // -- e a policy de SELECT de financial_transactions que depende dela.
      //
      // `.select()` + LINHAS AFETADAS (HMO-356)
      // ---------------------------------------
      // Ate aqui era `.update(...).eq(...)` cru, e `if (erroGrupo)` era o unico
      // criterio. Esse `if` NAO distingue "publicou" de "nao escreveu nada":
      // escrita que a policy nao alcanca volta sucesso com ZERO linha -- a RLS
      // FILTRA em vez de recusar --, e sem `.select()` o supabase-js nao entrega
      // contagem, entao `data` e `error` vinham os dois nulos. E a mesma mentira
      // medida em producao em 2026-09-30 na rota de restaurar grupo (HMO-203,
      // ver lib/escrita-conferida.ts).
      //
      // Zero linha AQUI e o pior silencio desta rota, e nao o mais barato: a
      // despesa fica gravada e visivel para quem lancou, enquanto a policy de
      // SELECT de financial_transactions -- `group_id IS NOT NULL AND
      // is_group_member(group_id)` -- a esconde de TODOS os outros membros. O
      // grupo entao divide uma conta que metade dele nao consegue ver, os
      // saldos de `group_member_balances` discordam entre as pessoas, e a tela
      // de quem lancou disse "Despesa adicionada com sucesso!".
      //
      // Diferente do laco que a HMO-356 descrevia: aqui e UMA linha, pela chave
      // primaria, numa despesa que esta rota acabou de inserir. Nao ha "movi N
      // de M" para reportar e nenhuma decisao de produto a tomar -- zero linha e
      // falha, e `desfazer` ja sabe o que fazer com ela.
      //
      // O `.select()` depende da policy de SELECT, e aqui isso e seguro porque a
      // perna `user_id = auth.uid()` dela cobre o dono -- e o dono e quem esta
      // chamando, pela chave primaria da linha que ele mesmo acabou de inserir.
      // Em escrita de linha ALHEIA esse detalhe se inverte e vira armadilha: o
      // UPDATE grava e o `.select()` volta vazio, e a conferencia reprovaria uma
      // escrita que funcionou.
      const publicacao = conferirEscrita(
        await supabase
          .from("financial_transactions")
          .update({ group_id: groupId })
          .eq("id", transaction.id)
          .select("id"),
        "publicar a despesa no grupo"
      );

      if (!publicacao.ok) {
        return desfazer("Erro ao publicar a despesa no grupo.", publicacao);
      }
    } else {
      // DIVISAO IGUAL: a transacao ja nasceu com `group_id`, e o trigger
      // `auto_create_group_transaction` JA criou a ligacao e o rateio
      // igualitario. Inserir de novo aqui criaria uma SEGUNDA linha em
      // group_transactions para a mesma despesa -- nao ha indice unico que
      // impeca -- e um segundo jogo de rateios: cada membro passaria a dever o
      // dobro, sem erro nenhum aparecer. Entao aqui so lemos o que o banco fez.
      const { data: existente } = await supabase
        .from("group_transactions")
        .select("id, split_type")
        .eq("group_id", groupId)
        .eq("transaction_id", transaction.id)
        .maybeSingle();

      // Rede de seguranca: se o trigger nao rodou (despesa positiva, banco sem
      // a 007 aplicada), a ligacao ainda precisa existir.
      if (!existente) {
        const { error: groupError } = await supabase
          .from("group_transactions")
          .insert({
            group_id: groupId,
            transaction_id: transaction.id,
            split_type: "equal",
            created_by: user.id,
          })
          .select("id, split_type")
          .single();

        if (groupError) {
          return desfazer(
            "Failed to link transaction to group",
            groupError
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      transaction: {
        id: transaction.id,
        description: transaction.description,
        amount: Math.abs(transaction.amount),
        transaction_date: transaction.transaction_date,
        created_at: transaction.created_at,
      },
    });
  } catch (error) {
    console.error("Error creating transaction:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
