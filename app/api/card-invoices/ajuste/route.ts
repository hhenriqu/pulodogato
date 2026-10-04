// POST   /api/card-invoices/ajuste   grava (ou troca) o ajuste de saldo
// DELETE /api/card-invoices/ajuste?account_id=&month=   tira o ajuste
//
// ===========================================================================
// O AJUSTE DE SALDO DA FATURA (HMO-253)
// ===========================================================================
// "Possibilidade de lancar um ajuste de saldo para que a fatura fique igual a
// real sem ter que discriminar o que foi o gasto."
//
// O QUE ESTA ROTA GRAVA e um lancamento comum em `financial_transactions`, na
// conta do cartao, no primeiro dia do mes da fatura. Nao ha tabela nova nem
// coluna nova, e isso e a decisao central -- ver o cabecalho de
// `lib/ajuste-de-fatura.ts`: o total da fatura e `SUM(invoice_amount)` da view
// `card_invoice_lines`, que le `financial_transactions`. Ajuste gravado em
// qualquer outro lugar seria dado sem leitor, e o sintoma seria "eu ajustei e a
// fatura nao mudou".
//
// O SINAL, A DATA E A CHAVE saem todos de `lib/ajuste-de-fatura.ts`, que tem
// suite propria. Esta rota faz as quatro coisas que precisam do banco:
// autenticar, conferir que a conta e um cartao DO usuario, resolver a categoria
// reservada, e escrever.
//
// POR QUE NAO REUSAR POST /api/personal-finance/transactions
// ----------------------------------------------------------
// Aquela rota exige `category_id` do cliente e deriva tipo e sinal de
// `normalizarLancamento` a partir da categoria escolhida. O ajuste nao tem
// categoria escolhida -- o usuario esta dizendo explicitamente que NAO quer
// discriminar -- e o sinal dele vem da direcao do ajuste, nao da categoria. Mais
// importante: aquela rota nao tem como ser idempotente por mes de fatura, e e a
// idempotencia que garante que salvar duas vezes R$ 50 deixa a fatura 50 maior
// e nao 100.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  DESCRICAO_DA_CATEGORIA_DE_AJUSTE,
  NOME_DA_CATEGORIA_DE_AJUSTE,
  chaveAjuste,
  lancamentoDoAjuste,
  primeiroDiaDoMesDaFatura,
  validarAjuste,
} from "@/lib/ajuste-de-fatura";

/** O cartao existe, e do usuario e e cartao? Devolve a mensagem do problema. */
async function conferirCartao(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  accountId: string
): Promise<{ erro: string; status: number } | null> {
  const { data: cartao } = await supabase
    .from("financial_accounts")
    .select("id, account_type")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();

  // Os dois motivos de `cartao` ser nulo terminam no mesmo 404 de proposito:
  // distinguir "nao existe" de "nao e seu" contaria a um estranho que aquele id
  // existe. A RLS recusaria a escrita de qualquer forma; o que esta conferencia
  // acrescenta e a mensagem, porque sem ela o 403 da policy chegaria na tela
  // como "Erro interno".
  if (!cartao) return { erro: "Cartão não encontrado", status: 404 };

  // O ajuste de SALDO DA FATURA so existe onde existe fatura. Aceitar uma conta
  // corrente aqui gravaria uma despesa sem categoria escolhida no meio do
  // extrato dela, e `card_invoice_lines` (que filtra
  // `account_type = 'credit_card'`) nunca a mostraria -- um lancamento invisivel
  // na conta errada. A issue tambem e explicita: "essa opcao fica no cartao".
  if (cartao.account_type !== "credit_card") {
    return { erro: "O ajuste de saldo é só do cartão de crédito", status: 400 };
  }

  return null;
}

/**
 * A categoria reservada do ajuste DAQUELE usuario, criando-a na primeira vez.
 *
 * `financial_transactions.category_id` e NOT NULL e o ajuste nao tem categoria
 * -- o mesmo problema que a transferencia teve (HMO-162 / migration 023). Lá a
 * solucao precisou de migration porque `transaction_categories` era global: nao
 * havia `user_id`, e o INSERT batia em 42501 (nenhuma policy de escrita). A 036
 * acrescentou `user_id` e a policy `transaction_categories_insert_own`
 * (`WITH CHECK (user_id = auth.uid())`), e por isso aqui da para criar sem
 * nenhum passo humano no SQL Editor.
 *
 * `is_active = FALSE` e o que a mantem fora dos seletores: a policy
 * `transaction_categories_read_own` nao filtra `is_active` (o dono le as
 * desativadas, para poder reativar), mas
 * `GET /api/personal-finance/categories` filtra `is_active = true` no proprio
 * SELECT. Entao o dono le a categoria, a tela do cartao reconhece a linha por
 * ela, e ninguem a escolhe por engano num lancamento comum.
 *
 * SELECT-depois-INSERT, e nao `ON CONFLICT`: a UNIQUE das categorias de usuario
 * e um indice PARCIAL (`WHERE user_id IS NOT NULL`, 036), e indice parcial nao
 * serve de arbitro de `ON CONFLICT` -- o Postgres recusa com
 * "no unique or exclusion constraint matching". O ramo de 23505 abaixo cobre a
 * corrida de dois pedidos simultaneos do mesmo usuario.
 */
async function categoriaDoAjuste(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  serviceId: string
): Promise<{ id: string } | { erro: string }> {
  const { data: existente, error: erroBusca } = await supabase
    .from("transaction_categories")
    .select("id")
    .eq("service_id", serviceId)
    .eq("user_id", userId)
    .eq("name", NOME_DA_CATEGORIA_DE_AJUSTE)
    .maybeSingle();

  if (erroBusca) {
    console.error("Erro ao buscar a categoria do ajuste:", erroBusca);
    return { erro: "Não foi possível preparar o ajuste" };
  }
  if (existente) return { id: existente.id };

  const { data: criada, error: erroCriacao } = await supabase
    .from("transaction_categories")
    .insert({
      service_id: serviceId,
      // Do servidor, NUNCA do corpo do pedido. A policy da 036 recusaria um
      // `user_id` alheio, mas aceitar o campo deixaria a rota parecendo que ele
      // e escolhivel.
      user_id: userId,
      name: NOME_DA_CATEGORIA_DE_AJUSTE,
      description: DESCRICAO_DA_CATEGORIA_DE_AJUSTE,
      icon: "scale",
      color_hex: "#6B7280",
      // `is_expense` e NOT NULL e so e consultado como ULTIMO recurso: as telas
      // classificam por `transaction_type`, e o ajuste sempre grava o tipo (ver
      // `lancamentoDoAjuste`). TRUE e o caso dominante -- o ajuste existe porque
      // faltou gasto na fatura -- e serve de fallback honesto se alguem um dia
      // ler a categoria em vez do tipo.
      is_expense: true,
      is_active: false,
    })
    .select("id")
    .single();

  if (erroCriacao) {
    // 23505: outro pedido do mesmo usuario criou a linha entre o SELECT e o
    // INSERT. A categoria existe, e e isso que se queria.
    if (erroCriacao.code === "23505") {
      const { data: recem } = await supabase
        .from("transaction_categories")
        .select("id")
        .eq("service_id", serviceId)
        .eq("user_id", userId)
        .eq("name", NOME_DA_CATEGORIA_DE_AJUSTE)
        .maybeSingle();
      if (recem) return { id: recem.id };
    }
    console.error("Erro ao criar a categoria do ajuste:", erroCriacao);
    return { erro: "Não foi possível preparar o ajuste" };
  }

  return { id: criada.id };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const corpo = await request.json().catch(() => null);
    const accountId = corpo?.account_id;
    const mes = primeiroDiaDoMesDaFatura(corpo?.month);

    if (!accountId || typeof accountId !== "string") {
      return NextResponse.json({ error: "Informe o cartão" }, { status: 400 });
    }
    if (!mes) {
      return NextResponse.json(
        { error: "Mês deve estar no formato AAAA-MM" },
        { status: 400 }
      );
    }

    const validado = validarAjuste({
      valor: corpo?.valor,
      direcao: corpo?.direcao,
    });
    if (!validado.ok) {
      return NextResponse.json({ error: validado.erro }, { status: 400 });
    }

    const problema = await conferirCartao(supabase, user.id, accountId);
    if (problema) {
      return NextResponse.json(
        { error: problema.erro },
        { status: problema.status }
      );
    }

    const lancamento = lancamentoDoAjuste({
      valorNaFatura: validado.valorNaFatura,
      mes,
      accountId,
      descricao: typeof corpo?.descricao === "string" ? corpo.descricao : null,
    });

    // `null` aqui seria mes ilegivel ou valor zero, e os dois ja foram
    // recusados acima. O ramo existe para o compilador e para que uma mudanca
    // futura na ordem das validacoes nao grave dinheiro com data inventada.
    if (!lancamento) {
      return NextResponse.json(
        { error: "Não foi possível montar o ajuste" },
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

    const categoria = await categoriaDoAjuste(supabase, user.id, servico.id);
    if ("erro" in categoria) {
      return NextResponse.json({ error: categoria.erro }, { status: 500 });
    }

    // A CHAVE CANONICA e o que torna esta rota uma TROCA, e nao um acumulo.
    // Clicar Salvar duas vezes com R$ 50 deixa a fatura 50 maior, nao 100 --
    // porque o segundo pedido encontra a linha do primeiro aqui e a reescreve.
    const chave = chaveAjuste(mes, accountId);

    const { data: existente, error: erroBusca } = await supabase
      .from("financial_transactions")
      .select("id")
      .eq("user_id", user.id)
      .eq("account_id", accountId)
      .eq("notes", chave)
      .maybeSingle();

    if (erroBusca) {
      console.error("Erro ao procurar o ajuste existente:", erroBusca);
      return NextResponse.json(
        { error: "Não foi possível gravar o ajuste" },
        { status: 500 }
      );
    }

    if (existente) {
      // UPDATE, e nao DELETE + INSERT. O trigger `update_account_balance`
      // estorna `OLD.amount` antes de somar `NEW.amount` desde a 007, entao o
      // saldo do cartao acompanha a troca sem passo intermediario -- e o id da
      // linha nao muda, o que mantem recibo, regra de categorizacao e qualquer
      // elo que aponte para ela.
      //
      // `transaction_type` VAI no UPDATE junto com `amount`: trocar o ajuste de
      // +50 para -50 muda o tipo de 'expense' para 'income', e deixar o tipo
      // velho poria uma despesa de valor positivo no fluxo de caixa -- numero
      // certo na fatura, sinal errado no relatorio.
      const { data: atualizado, error: erroUpdate } = await supabase
        .from("financial_transactions")
        .update({
          amount: lancamento.amount,
          transaction_type: lancamento.transaction_type,
          transaction_date: lancamento.transaction_date,
          description: lancamento.description,
          category_id: categoria.id,
        })
        .eq("id", existente.id)
        .eq("user_id", user.id)
        .select("id, amount, transaction_type, transaction_date, description")
        .maybeSingle();

      if (erroUpdate || !atualizado) {
        console.error("Erro ao trocar o ajuste da fatura:", erroUpdate);
        return NextResponse.json(
          { error: "Não foi possível gravar o ajuste" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ajuste: atualizado,
        valor_na_fatura: validado.valorNaFatura,
        criado: false,
      });
    }

    const { data: criado, error: erroInsert } = await supabase
      .from("financial_transactions")
      .insert({
        user_id: user.id,
        service_id: servico.id,
        category_id: categoria.id,
        account_id: accountId,
        description: lancamento.description,
        amount: lancamento.amount,
        transaction_date: lancamento.transaction_date,
        // Sem o tipo a linha fica fora de monthly_cash_flow,
        // category_monthly_totals e planned_vs_actual (HMO-181) E fora de
        // `card_invoice_lines`, que filtra `transaction_type IN
        // ('expense','income')`. Um ajuste sem tipo apareceria na lista de
        // lancamentos e nao mudaria a fatura -- exatamente o que esta rota
        // existe para fazer.
        transaction_type: lancamento.transaction_type,
        notes: lancamento.notes,
      })
      .select("id, amount, transaction_type, transaction_date, description")
      .single();

    if (erroInsert) {
      console.error("Erro ao gravar o ajuste da fatura:", erroInsert);
      return NextResponse.json(
        { error: "Não foi possível gravar o ajuste" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ajuste: criado,
        valor_na_fatura: validado.valorNaFatura,
        criado: true,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Erro na rota de ajuste da fatura:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const accountId = url.searchParams.get("account_id");
    const mes = primeiroDiaDoMesDaFatura(url.searchParams.get("month"));

    if (!accountId) {
      return NextResponse.json({ error: "Informe o cartão" }, { status: 400 });
    }
    if (!mes) {
      return NextResponse.json(
        { error: "Mês deve estar no formato AAAA-MM" },
        { status: 400 }
      );
    }

    const problema = await conferirCartao(supabase, user.id, accountId);
    if (problema) {
      return NextResponse.json(
        { error: problema.erro },
        { status: problema.status }
      );
    }

    // APAGA DE VERDADE, e isso e diferente da regra de despesa fixa (que e
    // soft-delete por `?purge=true`). O ajuste nao tem horizonte nem serie: ele
    // e uma linha de um mes. Marcar como inativo deixaria a linha somando na
    // fatura, que e o oposto do que "remover ajuste" significa.
    //
    // `.select()` depois do delete e o que distingue "apagou" de "nao havia":
    // um DELETE filtrado pela RLS volta 200 com zero linhas, sem erro -- a tela
    // diria "ajuste removido" sobre uma fatura que continua ajustada.
    const { data: apagados, error } = await supabase
      .from("financial_transactions")
      .delete()
      .eq("user_id", user.id)
      .eq("account_id", accountId)
      .eq("notes", chaveAjuste(mes, accountId))
      .select("id");

    if (error) {
      console.error("Erro ao remover o ajuste da fatura:", error);
      return NextResponse.json(
        { error: "Não foi possível remover o ajuste" },
        { status: 500 }
      );
    }

    if (!apagados?.length) {
      return NextResponse.json(
        { error: "Esta fatura não tem ajuste de saldo" },
        { status: 404 }
      );
    }

    return NextResponse.json({ removidos: apagados.length });
  } catch (error) {
    console.error("Erro na rota de ajuste da fatura:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
