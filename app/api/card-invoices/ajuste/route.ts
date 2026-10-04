// POST   /api/card-invoices/ajuste   { account_id, month, saldo_real, descricao? }
// DELETE /api/card-invoices/ajuste?account_id=&month=   tira o ajuste
//
// ===========================================================================
// O AJUSTE DE SALDO DA FATURA (HMO-253)
// ===========================================================================
// "Possibilidade de lancar um ajuste de saldo para que a fatura fique igual a
// real sem ter que discriminar o que foi o gasto."
//
// O CORPO DO POST E `saldo_real` -- QUANTO O CARTAO DIZ HOJE -- e nao o valor do
// ajuste (2a volta da HMO-253: "deve ser automatico, eu lanco o valor real que
// esta hoje meu cartao e um metodo verifica se e menor ou maior que a fatura, e
// lanca a diferenca somando ou subtraindo"). A diferenca e a direcao sao
// DERIVADAS aqui dentro, sobre um total lido agora -- ver
// `centavosDaFaturaSemAjuste` para por que o cliente nao manda a diferenca.
//
// E uma resposta com `fecha: true` nao e erro: e "o cartao ja bate", e nesse
// caso a rota REMOVE o ajuste que estiver valendo em vez de gravar R$ 0,00.
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
  ajusteParaFecharEm,
  centavosDaFaturaSemAjuste,
  chaveAjuste,
  lancamentoDoAjuste,
  primeiroDiaDoMesDaFatura,
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

/**
 * O total da fatura SEM ajuste nenhum, em CENTAVOS INTEIROS. `null` = nao sei.
 *
 * A ARITMETICA mora em `centavosDaFaturaSemAjuste` (lib/ajuste-de-fatura.ts),
 * que tem teste e mutantes -- o sinal do ajuste existente e a soma em centavos
 * sao o que pode errar aqui, e as duas erram calado. Esta funcao e a CONSULTA.
 *
 * ===========================================================================
 * POR QUE O SERVIDOR RECALCULA, EM VEZ DE ACEITAR O TOTAL DA TELA (HMO-253, 2a)
 * ===========================================================================
 * O desenho obvio seria o cliente mandar a diferenca ja calculada -- ele tem o
 * total na tela e o saldo real no campo. Esse desenho tem um modo de falha que
 * nao levanta erro em lugar nenhum:
 *
 *   A tela carregou com a fatura em R$ 1.240. No celular, uma compra de R$ 40
 *   entrou. O usuario olha o app do banco (R$ 1.290), digita 1.290 na tela
 *   velha, e o cliente calcula 1.290 - 1.240 = +50. O ajuste certo era +10.
 *   A fatura passa a 1.330, e a proxima conferencia vai dizer que o cartao
 *   esta R$ 40 acima -- de novo, pela mesma causa, para sempre.
 *
 * O numero que o usuario digitou e o UNICO dado que so ele tem. O total da
 * fatura o servidor sabe melhor que a tela, por definicao. Entao a rota aceita
 * `saldo_real` e NAO aceita diferenca: nao ha como o cliente errar uma conta que
 * ele nao faz.
 *
 * A CONSULTA REPETE A FORMA DA DO `GET /api/card-invoices`, e isso e deliberado
 * ate no que ela NAO filtra. A rota de leitura nao poe `.eq("user_id", ...)` --
 * ela confia na RLS -- e com isso o total que a tela do cartao imprime inclui a
 * linha de despesa de grupo que um membro pendurou neste cartao. Acrescentar o
 * filtro aqui faria o servidor calcular sobre um total MENOR que o impresso:
 * o usuario digitaria o numero que ele ve e receberia um ajuste maior que a
 * diferenca real, sem nada na tela sugerindo que as duas contas usam bases
 * diferentes. Duas fontes que nao fecham sao piores que uma base discutivel --
 * e a base discutivel ja e a que a tela mostra. (`faturasPrevistasDaJanela`
 * escolheu o contrario, por um motivo que vale LA: ela AGREGA varios cartoes
 * para a agenda, onde a linha alheia inflaria a previsao de quem nem tem o
 * cartao. Aqui o cartao e um e e o da tela que o usuario esta conferindo.)
 *
 * Devolve `null` quando a leitura falhou ou quando alguma linha veio com valor
 * ilegivel. `null` E DIFERENTE DE ZERO: uma fatura sem linha nenhuma soma 0
 * (cartao novo, mes sem compra -- e ajustar isso e legitimo), enquanto `null`
 * significa que nao se sabe o total, e ai nao ha diferenca a calcular.
 *
 * @param amountDoAjuste `financial_transactions.amount` do ajuste que ja existe
 *   -- a COLUNA CRUA, nao o valor na fatura -- ou `null` quando nao ha ajuste.
 */
async function lerCentavosDaFaturaSemAjuste(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  mes: string,
  amountDoAjuste: unknown
): Promise<number | null> {
  const { data: linhas, error } = await supabase
    .from("card_invoice_lines")
    .select("invoice_amount")
    .eq("invoice_month", mes)
    .eq("account_id", accountId);

  if (error) {
    console.error("Erro ao ler a fatura para o ajuste automático:", error);
    return null;
  }

  const centavos = centavosDaFaturaSemAjuste({
    invoiceAmounts: (linhas ?? []).map((linha) => linha.invoice_amount),
    amountDoAjuste,
  });

  if (centavos === null) {
    console.error(
      "Fatura com valor ilegível; ajuste automático recusado:",
      { accountId, mes, linhas: linhas?.length ?? 0 }
    );
  }
  return centavos;
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

    // O CARTAO E CONFERIDO ANTES DA LEITURA DA FATURA, e nao depois. A consulta
    // de `card_invoice_lines` filtra por `account_id` e confia na RLS; sobre uma
    // conta que nao e do usuario ela devolveria zero linhas, ou seja total 0 --
    // e a rota responderia uma diferenca calculada sobre uma fatura inventada
    // antes de chegar ao 404. Numero plausivel em resposta a um id alheio.
    const problema = await conferirCartao(supabase, user.id, accountId);
    if (problema) {
      return NextResponse.json(
        { error: problema.erro },
        { status: problema.status }
      );
    }

    // A CHAVE CANONICA e o que torna esta rota uma TROCA, e nao um acumulo.
    // Salvar duas vezes deixa UM ajuste no mes, nao dois -- porque o segundo
    // pedido encontra a linha do primeiro aqui e a reescreve.
    const chave = chaveAjuste(mes, accountId);

    const { data: existente, error: erroBusca } = await supabase
      .from("financial_transactions")
      .select("id, amount")
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

    // `null` AQUI SIGNIFICA "nao ha ajuste gravado", e e por isso que ele vem de
    // `existente` e nao de um `?? 0`: um ajuste gravado cujo `amount` voltasse
    // ilegivel sairia da base como se nao existisse, e a diferenca seria
    // calculada em cima dele -- o acumulo que a chave canonica existe para
    // impedir. `centavosDaFaturaSemAjuste` devolve `null` nesse caso, e a rota
    // recusa logo abaixo.
    const centavosSemAjuste = await lerCentavosDaFaturaSemAjuste(
      supabase,
      accountId,
      mes,
      existente ? existente.amount : null
    );
    if (centavosSemAjuste === null) {
      return NextResponse.json(
        { error: "Não foi possível ler o total desta fatura para comparar" },
        { status: 500 }
      );
    }

    const totalSemAjuste = centavosSemAjuste / 100;

    // O UNICO DADO QUE VEM DO CLIENTE: quanto o cartao diz hoje. A diferenca e a
    // direcao saem daqui -- ver o cabecalho de `ajusteParaFecharEm`.
    const calculado = ajusteParaFecharEm({
      saldoReal: corpo?.saldo_real,
      totalSemAjuste,
    });
    if (!calculado.ok) {
      return NextResponse.json({ error: calculado.erro }, { status: 400 });
    }

    // ------------------------------------------------------------------
    // A FATURA JA BATE: O CERTO E REMOVER O AJUSTE, NAO GRAVAR R$ 0,00
    // ------------------------------------------------------------------
    // Armadilha 4 de `ajusteParaFecharEm`. Quem informa o saldo real e ve que
    // ele bate com as compras esta dizendo "nao falta nada nesta fatura" -- e um
    // ajuste de meses atras que ainda esteja valendo e justamente o que faria a
    // fatura parar de bater no instante seguinte. Gravar R$ 0,00 no lugar seria
    // uma linha na fatura que nao muda nada e parece compra, e `lancamentoDoAjuste`
    // recusa zero de qualquer forma.
    if (calculado.fecha) {
      if (!existente) {
        return NextResponse.json({
          fecha: true,
          removido: false,
          total_da_fatura: totalSemAjuste,
          valor_na_fatura: 0,
        });
      }

      const { data: apagados, error: erroDelete } = await supabase
        .from("financial_transactions")
        .delete()
        .eq("id", existente.id)
        .eq("user_id", user.id)
        .select("id");

      if (erroDelete) {
        console.error("Erro ao tirar o ajuste de uma fatura que já bate:", erroDelete);
        return NextResponse.json(
          { error: "Não foi possível tirar o ajuste desta fatura" },
          { status: 500 }
        );
      }
      // Um DELETE filtrado pela RLS volta 200 com zero linhas e sem erro (ver o
      // DELETE desta rota). Dizer "pronto, a fatura bate" sobre um ajuste que
      // continua somando seria a tela afirmando o contrario do banco.
      if (!apagados?.length) {
        return NextResponse.json(
          { error: "Não foi possível tirar o ajuste desta fatura" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        fecha: true,
        removido: true,
        total_da_fatura: totalSemAjuste,
        valor_na_fatura: 0,
      });
    }

    const lancamento = lancamentoDoAjuste({
      valorNaFatura: calculado.valorNaFatura,
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
        fecha: false,
        valor_na_fatura: calculado.valorNaFatura,
        // O total que a fatura passa a ter. A tela o usa para confirmar com o
        // numero, e nao so com "gravado": o usuario acabou de informar quanto o
        // cartao diz, e a confirmacao util e ver a fatura nesse valor.
        total_da_fatura: totalSemAjuste + calculado.valorNaFatura,
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
        fecha: false,
        valor_na_fatura: calculado.valorNaFatura,
        total_da_fatura: totalSemAjuste + calculado.valorNaFatura,
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
