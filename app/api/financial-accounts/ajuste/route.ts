// GET    /api/financial-accounts/ajuste?account_id=&data=
// POST   /api/financial-accounts/ajuste   { account_id, data, saldo_real, descricao? }
// DELETE /api/financial-accounts/ajuste?account_id=&data=   tira o ajuste
//
// ===========================================================================
// O AJUSTE DE SALDO DA CONTA (HMO-409)
// ===========================================================================
// "Ajuste de saldo tambem para contas, nao so para cartao."
//
// A FORMA E A DA HMO-253 e se mantem inteira: o corpo do POST e `saldo_real`
// -- QUANTO A CONTA MOSTRA HOJE --, nao o valor do ajuste. A diferenca e a
// direcao sao DERIVADAS aqui dentro, sobre um saldo lido agora. E uma resposta
// com `fecha: true` nao e erro: e "a conta ja bate", e nesse caso a rota REMOVE
// o ajuste que estiver valendo em vez de gravar R$ 0,00.
//
// O QUE ESTA ROTA GRAVA, E O QUE ELA NAO GRAVA
// --------------------------------------------
// Grava um lancamento comum em `financial_transactions`, na conta, no dia em
// que a pessoa conferiu. NAO escreve em `financial_accounts.current_balance`,
// e isso e a decisao central -- ver o ponto 2 do cabecalho de
// `lib/ajuste-de-saldo-da-conta.ts`:
//
//   - o trigger `update_account_balance` (007:350) ja soma `NEW.amount` em
//     `current_balance`, entao o lancamento FECHA a conta sozinho. Um UPDATE
//     no saldo por cima dele contaria a diferenca duas vezes;
//   - `net_worth_history` (008:455) reconstroi o patrimonio de tras para
//     frente a partir do saldo de hoje. Corrigir `current_balance` direto --
//     sem lancamento -- deslocaria TODO mes passado do grafico, sem nenhuma
//     transacao explicando a subida. Com o lancamento datado, as duas pontas
//     andam juntas e a historia anterior ao ajuste nao se mexe.
//
// POR QUE NAO A ROTA DO CARTAO, COM UM PARAMETRO
// -----------------------------------------------
// A aritmetica e a mesma (e e a mesma funcao, importada), mas tudo em volta
// dela e diferente: a base vem de outra coluna, o sinal do `amount` nao e
// invertido, a chave canonica e por DIA e a categoria reservada e outra. Um
// parametro `tipo` em /api/card-invoices/ajuste faria cada um desses quatro
// pontos virar um `if` -- e os quatro erram calado.
//
// POR QUE NAO POST /api/personal-finance/transactions
// ----------------------------------------------------
// O mesmo motivo da HMO-253: aquela rota exige `category_id` do cliente (e o
// ajuste existe justamente porque a pessoa NAO quer discriminar) e nao tem como
// ser idempotente por dia. E a idempotencia que garante que conferir o saldo
// duas vezes deixa UM ajuste, e nao dois.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { escopoDoTipo } from "@/lib/contas";
import { ajusteParaFecharEm } from "@/lib/ajuste-de-fatura";
import {
  DESCRICAO_DA_CATEGORIA_DE_AJUSTE_DE_SALDO,
  NOME_DA_CATEGORIA_DE_AJUSTE_DE_SALDO,
  TEXTOS_DO_AJUSTE_DE_SALDO,
  centavosDoSaldoSemAjuste,
  chaveAjusteDeSaldo,
  diaDoAjuste,
  lancamentoDoAjusteDeSaldo,
} from "@/lib/ajuste-de-saldo-da-conta";

/** O que `conferirConta` devolve quando deu certo: a conta e o saldo de agora. */
interface ContaDoAjuste {
  id: string;
  current_balance: unknown;
}

/**
 * A conta existe, e do usuario e NAO e cartao de credito? Devolve o problema.
 *
 * O ESCOPO SAI DE `escopoDoTipo`, e nao de `=== "credit_card"` escrito aqui.
 * A regra "o que tem saldo e o que tem fatura" mora em lib/contas.ts e ja
 * decide a tela de Contas, a de Cartoes, o total somado e os campos do
 * formulario. Uma segunda copia aqui divergiria no dia em que um tipo novo
 * entrasse -- e a divergencia seria "a conta aparece na tela de Contas e a
 * rota recusa o ajuste dela".
 *
 * O cartao e recusado com mensagem propria, e nao com o 404 generico: ele TEM
 * ajuste, em outra tela, e mandar a pessoa para la e mais util do que dizer que
 * a conta nao existe. O ajuste do cartao e por FATURA (o que se deve naquele
 * mes), e nao pelo saldo acumulado -- aplicar este aqui num cartao gravaria uma
 * linha que a fatura de nenhum mes explicaria direito.
 */
async function conferirConta(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  accountId: string
): Promise<{ erro: string; status: number } | { conta: ContaDoAjuste }> {
  const { data: conta, error } = await supabase
    .from("financial_accounts")
    .select("id, account_type, current_balance")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Erro ao ler a conta do ajuste de saldo:", error);
    return { erro: "Não foi possível ler esta conta", status: 500 };
  }

  // Os dois motivos de `conta` ser nula terminam no mesmo 404 de proposito:
  // distinguir "nao existe" de "nao e sua" contaria a um estranho que aquele id
  // existe. A RLS recusaria a escrita de qualquer forma; o que esta conferencia
  // acrescenta e a mensagem, porque sem ela o 403 da policy chegaria na tela
  // como "Erro interno".
  if (!conta) return { erro: "Conta não encontrada", status: 404 };

  if (escopoDoTipo(conta.account_type) !== "conta") {
    return {
      erro: "Cartão de crédito tem ajuste de fatura, na tela de Cartões",
      status: 400,
    };
  }

  return { conta: { id: conta.id, current_balance: conta.current_balance } };
}

/**
 * A categoria reservada do ajuste de saldo DAQUELE usuario, criando-a na
 * primeira vez.
 *
 * Mesmo desenho da categoria do cartao (`categoriaDoAjuste` em
 * /api/card-invoices/ajuste), e por isso as mesmas tres decisoes:
 *
 *   `is_active = FALSE` -- a policy `transaction_categories_read_own` (036) nao
 *   filtra `is_active` (o dono le as desativadas), mas
 *   `GET /api/personal-finance/categories` filtra `is_active = true` no proprio
 *   SELECT. Entao o dono le a categoria, a tela reconhece a linha por ela, e
 *   ninguem a escolhe por engano num lancamento comum.
 *
 *   SELECT-depois-INSERT, e nao `ON CONFLICT`: a UNIQUE das categorias de
 *   usuario e um indice PARCIAL (`WHERE user_id IS NOT NULL`, 036), e indice
 *   parcial nao serve de arbitro de `ON CONFLICT` -- o Postgres recusa com
 *   "no unique or exclusion constraint matching". O ramo de 23505 cobre a
 *   corrida de dois pedidos simultaneos do mesmo usuario.
 *
 *   `user_id` DO SERVIDOR, nunca do corpo do pedido. A policy da 036 recusaria
 *   um `user_id` alheio, mas aceitar o campo deixaria a rota parecendo que ele
 *   e escolhivel.
 *
 * O NOME E OUTRO, e e a unica diferenca que importa: "Ajuste de saldo", nao
 * "Ajuste de fatura". Reusar o nome do cartao rotularia o ajuste da conta
 * corrente como ajuste de cartao em todo relatorio por categoria.
 */
async function categoriaDoAjusteDeSaldo(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  serviceId: string
): Promise<{ id: string } | { erro: string }> {
  const { data: existente, error: erroBusca } = await supabase
    .from("transaction_categories")
    .select("id")
    .eq("service_id", serviceId)
    .eq("user_id", userId)
    .eq("name", NOME_DA_CATEGORIA_DE_AJUSTE_DE_SALDO)
    .maybeSingle();

  if (erroBusca) {
    console.error("Erro ao buscar a categoria do ajuste de saldo:", erroBusca);
    return { erro: "Não foi possível preparar o ajuste" };
  }
  if (existente) return { id: existente.id };

  const { data: criada, error: erroCriacao } = await supabase
    .from("transaction_categories")
    .insert({
      service_id: serviceId,
      user_id: userId,
      name: NOME_DA_CATEGORIA_DE_AJUSTE_DE_SALDO,
      description: DESCRICAO_DA_CATEGORIA_DE_AJUSTE_DE_SALDO,
      icon: "scale",
      color_hex: "#6B7280",
      // `is_expense` e NOT NULL e so e consultado como ULTIMO recurso: as telas
      // classificam por `transaction_type`, e o ajuste sempre grava o tipo. O
      // ajuste de conta vai para os DOIS lados com a mesma frequencia (tarifa
      // esquecida e rendimento esquecido), entao nenhum dos dois valores e mais
      // honesto que o outro; FALSE acompanha o sinal positivo de `amount`, que
      // e o que o trigger soma no saldo.
      is_expense: false,
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
        .eq("name", NOME_DA_CATEGORIA_DE_AJUSTE_DE_SALDO)
        .maybeSingle();
      if (recem) return { id: recem.id };
    }
    console.error("Erro ao criar a categoria do ajuste de saldo:", erroCriacao);
    return { erro: "Não foi possível preparar o ajuste" };
  }

  return { id: criada.id };
}

/**
 * O ajuste que ja esta gravado naquele dia naquela conta, ou `null`.
 *
 * `undefined` NAO E UM DOS RETORNOS: o erro de leitura sobe como `{ erro }`,
 * porque "nao consegui conferir" e "nao ha ajuste" levam a rota a caminhos
 * opostos -- o segundo autoriza um INSERT, e fazer esse INSERT sem saber se ja
 * existe linha e o acumulo que a chave canonica existe para impedir.
 */
async function ajusteGravado(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  accountId: string,
  chave: string
): Promise<
  | { ajuste: { id: string; amount: unknown; description: string } | null }
  | { erro: string }
> {
  const { data, error } = await supabase
    .from("financial_transactions")
    // `description` vem junto para o formulario REABRIR com o motivo que a
    // pessoa escreveu. O valor, nao: ele nasce vazio de proposito (ver
    // `abrirAjuste` na tela de Contas) -- um campo pre-preenchido com o saldo
    // atual faria "Salvar" sem digitar nada REMOVER o ajuste que estava
    // valendo, porque a diferenca daria zero.
    .select("id, amount, description")
    .eq("user_id", userId)
    .eq("account_id", accountId)
    .eq("notes", chave)
    .maybeSingle();

  if (error) {
    console.error("Erro ao procurar o ajuste de saldo existente:", error);
    return { erro: "Não foi possível ler o ajuste desta conta" };
  }

  return { ajuste: data ?? null };
}

export async function GET(request: NextRequest) {
  // A TELA PRECISA DE TRES COISAS QUE ELA NAO TEM COMO CALCULAR: se da para
  // conferir, qual ajuste esta valendo, e qual e a BASE da previa.
  //
  // A base e o ponto. A lista de Contas mostra `current_balance`, que ja inclui
  // o ajuste gravado. Uma previa calculada em cima dele somaria o ajuste velho
  // ao novo -- e a frase "o saldo passa de X para Y" discordaria do que o POST
  // grava, que e o jeito mais rapido de perder a confianca no numero.
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
    const dia = diaDoAjuste(url.searchParams.get("data"));

    if (!accountId) {
      return NextResponse.json({ error: "Informe a conta" }, { status: 400 });
    }
    if (!dia) {
      return NextResponse.json(
        { error: "Data deve estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    const conferida = await conferirConta(supabase, user.id, accountId);
    if ("erro" in conferida) {
      return NextResponse.json(
        { error: conferida.erro },
        { status: conferida.status }
      );
    }

    const encontrado = await ajusteGravado(
      supabase,
      user.id,
      accountId,
      chaveAjusteDeSaldo(dia, accountId)
    );
    if ("erro" in encontrado) {
      return NextResponse.json({ error: encontrado.erro }, { status: 500 });
    }

    const centavos = centavosDoSaldoSemAjuste({
      saldoAtual: conferida.conta.current_balance,
      amountDoAjuste: encontrado.ajuste ? encontrado.ajuste.amount : null,
    });
    if (centavos === null) {
      return NextResponse.json(
        { error: TEXTOS_DO_AJUSTE_DE_SALDO.semBaseParaComparar },
        { status: 500 }
      );
    }

    return NextResponse.json({
      // `null` aqui significa "nao ha ajuste neste dia", COM CERTEZA: qualquer
      // falha de leitura saiu acima como 500. A tela pode afirmar a ausencia.
      ajuste: encontrado.ajuste
        ? {
            id: encontrado.ajuste.id,
            amount: Number(encontrado.ajuste.amount),
            description: encontrado.ajuste.description,
          }
        : null,
      saldo_sem_ajuste: centavos / 100,
      saldo_atual: Number(conferida.conta.current_balance),
    });
  } catch (error) {
    console.error("Erro na rota de ajuste de saldo da conta:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
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
    const dia = diaDoAjuste(corpo?.data);

    if (!accountId || typeof accountId !== "string") {
      return NextResponse.json({ error: "Informe a conta" }, { status: 400 });
    }
    if (!dia) {
      return NextResponse.json(
        { error: "Data deve estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    // A CONTA E CONFERIDA ANTES DE QUALQUER CONTA ARITMETICA, pelo mesmo motivo
    // da rota do cartao: sobre um id alheio a RLS devolveria nada, e sem este
    // passo a rota responderia uma diferenca calculada sobre um saldo inventado
    // antes de chegar ao 404. Numero plausivel em resposta a um id alheio.
    const conferida = await conferirConta(supabase, user.id, accountId);
    if ("erro" in conferida) {
      return NextResponse.json(
        { error: conferida.erro },
        { status: conferida.status }
      );
    }

    // A CHAVE CANONICA e o que torna esta rota uma TROCA, e nao um acumulo.
    // Conferir o saldo duas vezes no mesmo dia deixa UM ajuste, nao dois --
    // porque o segundo pedido encontra a linha do primeiro aqui e a reescreve.
    const chave = chaveAjusteDeSaldo(dia, accountId);

    const encontrado = await ajusteGravado(supabase, user.id, accountId, chave);
    if ("erro" in encontrado) {
      return NextResponse.json({ error: encontrado.erro }, { status: 500 });
    }
    const existente = encontrado.ajuste;

    // A BASE: o saldo de hoje MENOS o ajuste que ja esta nele.
    //
    // `conferirConta` leu `current_balance` ANTES de `ajusteGravado` rodar, e
    // essa ordem e a segura: o saldo lido ja continha o ajuste que a consulta
    // seguinte encontrou, entao a subtracao casa. Na ordem inversa, um ajuste
    // gravado por outra aba entre as duas leituras entraria no saldo sem ser
    // encontrado -- e a diferenca sairia errada pelo valor dele.
    const centavosSemAjuste = centavosDoSaldoSemAjuste({
      saldoAtual: conferida.conta.current_balance,
      amountDoAjuste: existente ? existente.amount : null,
    });
    if (centavosSemAjuste === null) {
      return NextResponse.json(
        { error: TEXTOS_DO_AJUSTE_DE_SALDO.semBaseParaComparar },
        { status: 500 }
      );
    }

    const saldoSemAjuste = centavosSemAjuste / 100;

    // O UNICO DADO QUE VEM DO CLIENTE: quanto a conta mostra hoje. A diferenca e
    // a direcao saem daqui. O cliente NAO manda a diferenca pelo mesmo motivo da
    // rota do cartao: a tela pode ter carregado antes de um lancamento entrar, e
    // a subtracao feita sobre um saldo velho erra sem levantar erro nenhum.
    const calculado = ajusteParaFecharEm({
      saldoReal: corpo?.saldo_real,
      totalSemAjuste: saldoSemAjuste,
      textos: TEXTOS_DO_AJUSTE_DE_SALDO,
    });
    if (!calculado.ok) {
      return NextResponse.json({ error: calculado.erro }, { status: 400 });
    }

    // ------------------------------------------------------------------
    // A CONTA JA BATE: O CERTO E REMOVER O AJUSTE, NAO GRAVAR R$ 0,00
    // ------------------------------------------------------------------
    // Quem informa o saldo real e ve que ele bate com os lancamentos esta
    // dizendo "nao falta nada nesta conta" -- e um ajuste gravado mais cedo que
    // ainda esteja valendo e justamente o que faria a conta parar de bater no
    // instante seguinte. Gravar R$ 0,00 no lugar seria uma linha no extrato que
    // nao muda nada e parece lancamento, e `lancamentoDoAjusteDeSaldo` recusa
    // zero de qualquer forma.
    if (calculado.fecha) {
      if (!existente) {
        return NextResponse.json({
          fecha: true,
          removido: false,
          saldo_da_conta: saldoSemAjuste,
          diferenca: 0,
        });
      }

      const { data: apagados, error: erroDelete } = await supabase
        .from("financial_transactions")
        .delete()
        .eq("id", existente.id)
        .eq("user_id", user.id)
        .select("id");

      if (erroDelete) {
        console.error("Erro ao tirar o ajuste de uma conta que já bate:", erroDelete);
        return NextResponse.json(
          { error: "Não foi possível tirar o ajuste desta conta" },
          { status: 500 }
        );
      }
      // Um DELETE filtrado pela RLS volta 200 com zero linhas e sem erro. Dizer
      // "pronto, a conta bate" sobre um ajuste que continua no saldo seria a
      // tela afirmando o contrario do banco.
      if (!apagados?.length) {
        return NextResponse.json(
          { error: "Não foi possível tirar o ajuste desta conta" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        fecha: true,
        removido: true,
        saldo_da_conta: saldoSemAjuste,
        diferenca: 0,
      });
    }

    const lancamento = lancamentoDoAjusteDeSaldo({
      diferenca: calculado.valorNaFatura,
      data: dia,
      accountId,
      descricao: typeof corpo?.descricao === "string" ? corpo.descricao : null,
    });

    // `null` aqui seria data ilegivel ou diferenca zero, e os dois ja foram
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

    const categoria = await categoriaDoAjusteDeSaldo(supabase, user.id, servico.id);
    if ("erro" in categoria) {
      return NextResponse.json({ error: categoria.erro }, { status: 500 });
    }

    if (existente) {
      // UPDATE, e nao DELETE + INSERT. O trigger `update_account_balance`
      // estorna `OLD.amount` antes de somar `NEW.amount` desde a 007, entao o
      // saldo da conta acompanha a troca sem passo intermediario -- e o id da
      // linha nao muda, o que mantem recibo, regra de categorizacao e qualquer
      // elo que aponte para ela.
      //
      // `transaction_type` VAI no UPDATE junto com `amount`: trocar o ajuste de
      // +50 para -50 muda o tipo de 'income' para 'expense', e deixar o tipo
      // velho poria uma receita de valor negativo no fluxo de caixa -- saldo
      // certo, relatorio errado.
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
        console.error("Erro ao trocar o ajuste de saldo da conta:", erroUpdate);
        return NextResponse.json(
          { error: "Não foi possível gravar o ajuste" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ajuste: atualizado,
        fecha: false,
        diferenca: calculado.valorNaFatura,
        // O saldo que a conta passa a ter. A tela o usa para confirmar com o
        // numero, e nao so com "gravado": a pessoa acabou de informar quanto a
        // conta mostra, e a confirmacao util e ver o saldo nesse valor.
        saldo_da_conta: saldoSemAjuste + calculado.valorNaFatura,
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
        // category_monthly_totals e planned_vs_actual (HMO-181) -- apareceria
        // no extrato e sumiria de todo relatorio. Desde a 048 a coluna e NOT
        // NULL, entao omiti-la seria 23502.
        transaction_type: lancamento.transaction_type,
        notes: lancamento.notes,
        // ------------------------------------------------------------------
        // OS DOIS LITERAIS QUE PRECISAM ESTAR ESCRITOS, E NAO SUBENTENDIDOS
        // ------------------------------------------------------------------
        // `group_id` NULO. `auto_create_group_transaction` rateia TODO
        // lancamento negativo que chega com `group_id` preenchido: um ajuste de
        // -R$ 50 numa conta viraria despesa nova do grupo, dividida com todo
        // mundo, e cada membro passaria a dever a parte dele de um dinheiro que
        // ninguem gastou. O ajuste e uma correcao do MEU extrato -- ele nao e
        // despesa de ninguem, nem minha.
        //
        // `is_shared` FALSO. As leituras de grupo e de custo pessoal separam a
        // linha compartilhada da individual por esta coluna; um ajuste marcado
        // como compartilhado entraria no rateio das telas mesmo sem `group_id`.
        //
        // OS DOIS TEM DEFAULT NO BANCO (`group_id` nulo por ausencia,
        // `is_shared` FALSE pela 001), e ainda assim vao escritos: o que o
        // default garante e o valor de HOJE. Escrito, o `tsc` e o `git blame`
        // mostram a escolha, e um default que mude amanha nao transforma este
        // INSERT em rateio sem ninguem reparar.
        group_id: null,
        is_shared: false,
      })
      .select("id, amount, transaction_type, transaction_date, description")
      .single();

    if (erroInsert) {
      console.error("Erro ao gravar o ajuste de saldo da conta:", erroInsert);
      return NextResponse.json(
        { error: "Não foi possível gravar o ajuste" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ajuste: criado,
        fecha: false,
        diferenca: calculado.valorNaFatura,
        saldo_da_conta: saldoSemAjuste + calculado.valorNaFatura,
        criado: true,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Erro na rota de ajuste de saldo da conta:", error);
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
    const dia = diaDoAjuste(url.searchParams.get("data"));

    if (!accountId) {
      return NextResponse.json({ error: "Informe a conta" }, { status: 400 });
    }
    if (!dia) {
      return NextResponse.json(
        { error: "Data deve estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    const conferida = await conferirConta(supabase, user.id, accountId);
    if ("erro" in conferida) {
      return NextResponse.json(
        { error: conferida.erro },
        { status: conferida.status }
      );
    }

    // APAGA DE VERDADE, e nao marca inativo: o trigger so estorna o saldo no
    // DELETE. Um soft delete deixaria a diferenca somada em `current_balance`
    // para sempre, que e o oposto do que "remover ajuste" significa.
    //
    // `.select()` depois do delete e o que distingue "apagou" de "nao havia":
    // um DELETE filtrado pela RLS volta 200 com zero linhas, sem erro -- a tela
    // diria "ajuste removido" sobre uma conta que continua ajustada.
    const { data: apagados, error } = await supabase
      .from("financial_transactions")
      .delete()
      .eq("user_id", user.id)
      .eq("account_id", accountId)
      .eq("notes", chaveAjusteDeSaldo(dia, accountId))
      .select("id");

    if (error) {
      console.error("Erro ao remover o ajuste de saldo da conta:", error);
      return NextResponse.json(
        { error: "Não foi possível remover o ajuste" },
        { status: 500 }
      );
    }

    if (!apagados?.length) {
      return NextResponse.json(
        { error: "Esta conta não tem ajuste de saldo neste dia" },
        { status: 404 }
      );
    }

    return NextResponse.json({ removidos: apagados.length });
  } catch (error) {
    console.error("Erro na rota de ajuste de saldo da conta:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
