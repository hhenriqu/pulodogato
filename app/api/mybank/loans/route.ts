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
// ---------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

import {
  casoDoEmprestimo,
  linhasDasParcelas,
  mensagemDoProblema,
  parcelaAConfirmar,
  previsoesDoEmprestimo,
  problemaDoEmprestimo,
  quemDevePagar,
  serieDoEmprestimo,
  JUROS_DA_FASE_1,
  type ParcelaGravada,
} from "@/lib/emprestimo-do-mybank";
import type { BaseDoValorParcelado } from "@/lib/lancamento";
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
      juros,
    } = body as {
      descricao?: string;
      conta_credora_id?: string | null;
      conta_de_pagamento_id?: string | null;
      /** `null`/ausente = auto-emprestimo. Ver `casoDoEmprestimo`. */
      devedor_id?: string | null;
      valor?: string | number;
      base?: BaseDoValorParcelado;
      parcelas?: number;
      primeiro_vencimento?: string;
      juros?: number;
    };

    const contaCredoraPedida = conta_credora_id || null;
    const contaDePagamentoPedida = conta_de_pagamento_id || null;

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

    const serie = serieDoEmprestimo({
      valor: String(valor ?? ""),
      // `base` ainda pode ser invalida aqui; `problemaDoEmprestimo` e quem
      // recusa com a frase. Passar o valor cru faz `serieDeParcelas` devolver
      // `null`, que e tratado pelo mesmo caminho.
      base: base as BaseDoValorParcelado,
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
      base,
      caso,
      contaCredoraPedida,
      contaCredora,
      contaDePagamentoPedida,
      contaDePagamento,
      conexaoAceita,
      juros: juros == null ? JUROS_DA_FASE_1 : Number(juros),
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
    // `principal` e `serieFechada.valorTotal`, e nao o valor digitado: com base
    // "parcela" o digitado e UMA parcela, e gravar ele como principal poria
    // R$ 1.000 num emprestimo de R$ 24.000. A soma das parcelas fecha com este
    // numero por construcao -- e a invariante do comentario da 053.
    const { data: emprestimo, error: erroDoEmprestimo } = await supabase
      .from("mybank_loans")
      .insert({
        lender_user_id: user.id,
        lender_account_id: credora.id,
        borrower_user_id: devedorId,
        description: String(descricao).trim(),
        principal: serieFechada.valorTotal,
        installment_count: numeroDeParcelas,
        first_due_date: serieFechada.parcelas[0].vencimento,
        interest_rate: JUROS_DA_FASE_1,
        status: "active",
      })
      .select("id")
      .single();

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
        principal: serieFechada.valorTotal,
        valor_da_parcela: serieFechada.valorDaParcela,
        message: mensagemDaCriacao(
          caso,
          parcelasCriadas.length,
          serieFechada.valorTotal
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
 */
function mensagemDaCriacao(
  caso: "auto" | "conexao",
  quantas: number,
  total: number
): string {
  const reais = emReais(total);
  if (caso === "auto") {
    return `${quantas} parcelas de ${reais} em Contas a Pagar, como transferência para a conta de investimento.`;
  }
  return `${quantas} parcelas de ${reais} a receber no MyBank. Isso não entra nas suas despesas — quem paga é a outra pessoa.`;
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
