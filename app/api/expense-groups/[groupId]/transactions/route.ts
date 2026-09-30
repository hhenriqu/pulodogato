import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { moedaConhecida } from "@/lib/dinheiro";
import { taxaParaGravar } from "@/lib/cambio";
import { moedaDaViagem } from "@/lib/moeda-do-grupo";

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
      .eq("group_id", groupId);

    if (groupError) {
      console.error("Error loading group transactions:", groupError);
      return NextResponse.json(
        { error: "Failed to load transactions" },
        { status: 500 }
      );
    }

    // Get splits for each transaction and payer info
    const transactionsWithSplits = await Promise.all(
      (groupTransactions || []).map(async (gt: any) => {
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
          .eq("group_transaction_id", gt.id);

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
          splits: (splits || []).map((split: any) => ({
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

    // Create financial transaction (with negative amount for expenses)
    const { data: transaction, error: transactionError } = await supabase
      .from("financial_transactions")
      .insert({
        user_id: user.id,
        service_id: category.service_id,
        category_id: body.category_id || category.id,
        description: body.description,
        amount: -Math.abs(body.amount), // Negative for expenses
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
        group_id: groupId,
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

    // A partir da 007 a transacao acima ja nasce com `group_id`, e o trigger
    // `auto_create_group_transaction` do banco JA criou a ligacao e o rateio
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

    let groupTransaction = existente;

    // Rede de seguranca: se o trigger nao rodou (despesa positiva, banco sem a
    // 007 aplicada), a ligacao ainda precisa existir.
    if (!groupTransaction) {
      const { data: criada, error: groupError } = await supabase
        .from("group_transactions")
        .insert({
          group_id: groupId,
          transaction_id: transaction.id,
          split_type: body.split_type || "equal",
        })
        .select("id, split_type")
        .single();

      if (groupError) {
        console.error("Error linking to group:", groupError);
        await supabase
          .from("financial_transactions")
          .delete()
          .eq("id", transaction.id);

        return NextResponse.json(
          { error: "Failed to link transaction to group" },
          { status: 500 }
        );
      }
      groupTransaction = criada;
    }

    // O trigger sempre rateia igualmente. Divisao combinada (custom,
    // percentage, proporcional) substitui o rateio automatico -- e precisa
    // trocar o split_type ANTES de inserir, porque e ele que faz o trigger
    // `calculate_equal_split` devolver os valores intactos em vez de achatar
    // tudo para partes iguais.
    const splitTypeDesejado = body.split_type || "equal";
    const temSplitsCustomizados =
      splitTypeDesejado !== "equal" &&
      Array.isArray(body.splits) &&
      body.splits.length > 0;

    if (temSplitsCustomizados) {
      await supabase
        .from("group_transactions")
        .update({ split_type: splitTypeDesejado })
        .eq("id", groupTransaction.id);

      await supabase
        .from("group_expense_splits")
        .delete()
        .eq("group_transaction_id", groupTransaction.id);

      await supabase.from("group_expense_splits").insert(
        body.splits.map((s: any) => ({
          group_transaction_id: groupTransaction!.id,
          member_id: s.member_id,
          percentage: s.percentage,
          amount: Math.abs(s.amount),
          status: "pending",
        }))
      );
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
