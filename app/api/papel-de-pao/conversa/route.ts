// POST /api/papel-de-pao/conversa  -- grava "Gastei X" ou "Ganhei X"
// GET  /api/papel-de-pao/conversa  -- devolve os tres numeros do mes corrente
//
// A ROTA DA CONVERSA -- HMO-481 (F3 do plano da HMO-462).
//
// Ela e o par da `painel/route.ts` ao lado, e a diferenca entre as duas e a
// decisao central do plano-mae: o painel le PREVISTO
// (`scheduled_transactions_effective`), a conversa escreve e le REALIZADO
// (`financial_transactions`). As duas tabelas tem convencoes de sinal OPOSTAS,
// entao nenhuma funcao de `lib/papel-de-pao.ts` entra aqui.
//
// A ROTA NAO FAZ CONTA NENHUMA, pela mesma regra escrita no cabecalho da irma:
// ela autentica, resolve os defaults, grava, le e DELEGA. As somas moram em
// `lib/saldo-da-conversa.ts` (F2), sob suite propria. Somar aqui dentro poria a
// definicao de "Saldo" num lugar que nenhuma suite alcanca, e rotulo novo em
// cima de numero velho e como este app ja errou duas vezes (HMO-187, HMO-290).
//
// =============================================================================
// POR QUE ROTA NOVA, E NAO /api/personal-finance/transactions
// =============================================================================
// Dois achados medidos naquela rota, cada um suficiente por si:
//
//   1. o POST dela NUNCA GRAVA `account_id` -- a coluna nao aparece no `insert`
//      (route.ts:230-259 na `main` de hoje). A coluna e ANULAVEL (001:1136),
//      entao nada reprova e nada loga; o preco e que o
//      `update_account_balance_trigger` (001:2033) so mexe no saldo da conta
//      APONTADA, e a linha sem conta nao move saldo nenhum. A tela de contas
//      passa a discordar do extrato, calada;
//
//   2. o POST dela LE DO CORPO os campos de divisao de despesa. A conversa
//      precisa que esses campos NAO EXISTAM no corpo que ela le -- ver a secao
//      abaixo.
//
// =============================================================================
// OS CAMPOS DE DIVISAO DE DESPESA: AQUI ELES NAO EXISTEM
// =============================================================================
// Nao e "mandar `false`", e nao e recusar com 400. O corpo lido tem DOIS campos
// (`direcao` e `valor`) e os tres campos de divisao nao aparecem em lugar nenhum
// deste arquivo -- nem desestruturados, nem validados, NEM CITADOS EM
// COMENTARIO. A suite cobra a ausencia dos tres no arquivo INTEIRO, e e por isso
// que esta secao os descreve em vez de os nomear: um comentario que os repetisse
// reprovaria o teste -- e seria tudo o que faria o teste passar se eles
// voltassem ao codigo.
//
// O motivo de eles terem de INEXISTIR, e nao de serem recusados: `amount`
// negativo acompanhado da chave do grupo e rateado por TRIGGER DO BANCO
// (`auto_create_group_transaction`, AFTER INSERT em `financial_transactions`,
// 001:2021 e 024:438). A divisao NAO DEPENDE de o app concordar, nem de a rota
// ler o campo depois. Um corpo que carregue a chave e um corpo que ja rateou.
//
// Campo a mais no JSON nao e recusado com 400 -- ele e IGNORADO. Recusar por
// "campo desconhecido" convidaria o proximo chamador a mandar a chave com `null`
// para passar pela validacao, e ai o campo voltaria a existir no caminho.
//
// =============================================================================
// OS TRES DEFAULTS QUE O SERVIDOR RESOLVE -- E O `data` DO CORPO QUE ELE IGNORA
// =============================================================================
// A conversa nao pergunta nada disso: nao sao perguntas para ela.
//
//   * DATA = hoje, por `today()` (lib/recurrence.ts:167), o relogio de
//     America/Sao_Paulo do app -- o MESMO de que `periodoCorrente`, e portanto
//     `mesCorrenteDaConversa`, nasce. NAO `new Date().toISOString()`: aquele e
//     UTC, e em Sao Paulo das 21:00 as 23:59 do ultimo dia do mes ele ja aponta
//     para o mes SEGUINTE. A linha nasceria FORA da janela que o GET soma, e a
//     tela mostraria "anotei" com os tres numeros parados (HMO-173 e a mesma
//     familia). `lib/conversa-do-papel.ts` (F1) tem um campo `data` na intencao
//     de lancamento, e esta rota o IGNORA de proposito -- com a data do cliente,
//     ela poderia escrever em outro mes e ver exatamente esse sintoma;
//   * CONTA = pela escada abaixo, nunca nula;
//   * CATEGORIA = a reservada daquela direcao (`lib/categoria-da-conversa.ts`),
//     criada na primeira vez. SEM MIGRATION.
//
// =============================================================================
// O QUE A LEITURA FILTRA NO BANCO, E O QUE ELA DEIXA PARA A LIB
// =============================================================================
// No banco: `user_id`, `service_id` e a JANELA DE DATAS.
//
//   * `user_id` porque filtro por dono e de CONSULTA -- F2 diz isso no proprio
//     cabecalho, e a policy de SELECT do 002 entrega tambem a linha de grupo de
//     quem e membro;
//   * a janela porque sem ela a rota leria o historico INTEIRO dela para somar
//     um mes, e o custo cresce para sempre.
//
// Na lib (`linhasDaConversa`, F2) ficam os outros dois criterios, cada um por
// uma razao diferente:
//
//   * `include_in_total` NAO PODE APARECER aqui -- nem num `select` nomeado, nem
//     num `.not(...)`, nem num `.eq(...)`. A coluna e da migration 060, colada A
//     MAO no SQL Editor DEPOIS do deploy do codigo, e nomea-la responde `42703
//     column ... does not exist` em todo banco que ainda nao a recebeu -- foi o
//     que as quatro rotas de patrimonio mediram em producao na HMO-431 com a
//     homonima da 058. Por isso o `select` e `COLUNAS_DA_CONVERSA` (`*`), que
//     nao nomeia coluna nenhuma, e o criterio e `!== false` em JS, que trata o
//     campo ausente como "soma" -- o default da coluna. E pior que o 42703
//     seria o FILTRO: ele DESCARTARIA a linha em vez de derrubar a rota, e um
//     saldo silenciosamente menor e pior que um 500;
//
//   * o porteiro de grupo fica na lib para continuar OBSERVAVEL. Um filtro igual
//     no banco faria o duble peneirar a linha antes de ela chegar na lib, o
//     mutante de F2 que apaga aquele criterio sobreviveria, e a suite de F2
//     ficaria verde protegendo nada. Um gate, um dono, um mutante que o mata.
//
// =============================================================================
// UM CAMINHO SO PARA OS TRES NUMEROS -- `tresNumerosDoMes`
// =============================================================================
// O POST responde os tres numeros RELIDOS pelo mesmo helper que o GET usa. Nao e
// economia de requisicao: e o que impede o numero que ela ve logo apos confirmar
// de discordar do numero que ela ve ao recarregar. Duas leituras plausiveis que
// discordam, sem um terceiro numero que as confronte, e a familia de defeito que
// este repositorio mais paga.

import { createClient } from "@/utils/supabase/server";
import { NextResponse, type NextRequest } from "next/server";
import { today } from "@/lib/recurrence";
import { escopoDoTipo } from "@/lib/contas";
import type { AccountType } from "@/types/financial";
import type { Direcao } from "@/lib/conversa-do-papel";
import {
  COLUNAS_DA_CONVERSA,
  linhasDaConversa,
  mesCorrenteDaConversa,
  tresNumerosDaConversa,
  type LinhaDaConversa,
  type MesDaConversa,
  type TresNumerosDaConversa,
} from "@/lib/saldo-da-conversa";
import {
  CATEGORIAS_DA_CONVERSA,
  categoriaDaConversa,
} from "@/lib/categoria-da-conversa";

/**
 * As duas palavras, e so elas. Catraca por ENUMERACAO, nunca por exclusao:
 * `d !== "ganhei" ? "gastei" : d` trataria corpo vazio, `null` e typo como
 * "gastei" -- e um botao que ninguem apertou gravaria uma despesa.
 */
const DIRECOES: readonly Direcao[] = ["gastei", "ganhei"];

/** `expense` para "gastei", `income` para "ganhei". O SINAL vem separado. */
const TIPO_POR_DIRECAO: Record<Direcao, "expense" | "income"> = {
  gastei: "expense",
  ganhei: "income",
};

/**
 * A GRANDEZA aceita: decimal com ponto, ate 13 digitos inteiros e 2 casas.
 *
 * Os 13 digitos sao o TETO DE `numeric(15,2)` (001:1138). Sem o limite, um valor
 * de 16 digitos faz o insert voltar `22003 numeric field overflow`, que a rota
 * devolve como 500 -- erro de servidor para um pedido que era invalido.
 *
 * Regex em vez de `Number()`, e e a diferenca que importa: `Number("39,90")` e
 * `NaN` (virgula e o separador que o teclado brasileiro produz) e `NaN` gravado
 * em `numeric(15,2)` e o lancamento dela perdido. `"1e20"`, `"0x10"` e `" 10 "`
 * tambem viram numero por `Number()` e nenhum deles e um valor que a tela
 * produz: `lib/conversa-do-papel.ts` (F1) entrega `valor` como decimal com
 * ponto, e e exatamente essa forma que esta linha aceita.
 */
const VALOR_DA_CONVERSA = /^\d{1,13}(\.\d{1,2})?$/;

/** A direcao que veio no corpo, ou `null` quando nao e uma das duas. */
function direcaoDoCorpo(bruta: unknown): Direcao | null {
  return DIRECOES.includes(bruta as Direcao) ? (bruta as Direcao) : null;
}

/**
 * A grandeza em reais, ou `null` quando nao da para gravar.
 *
 * `> 0` e recusa, nao conserto: a direcao JA diz o sinal, e aceitar negativo
 * poria uma RECEITA debaixo do botao Gastei. (A regex ja recusa o sinal de menos;
 * o `> 0` e o que barra `"0"` e `"0.00"`.)
 */
function valorDoCorpo(bruto: unknown): number | null {
  if (typeof bruto !== "number" && typeof bruto !== "string") return null;
  const texto = String(bruto);
  if (!VALOR_DA_CONVERSA.test(texto)) return null;
  const numero = Number(texto);
  return numero > 0 ? numero : null;
}

/** O servico de financas pessoais -- `service_id` e NOT NULL na tabela. */
async function servicoDeFinancas(
  supabase: ReturnType<typeof createClient>
): Promise<{ id: string } | { erro: string }> {
  const { data: servico, error } = await supabase
    .from("financial_services")
    .select("id")
    .eq("name", "personal_finance")
    .maybeSingle();

  if (error || !servico) {
    console.error("Conversa: serviço de finanças não encontrado:", error);
    return { erro: "Serviço de finanças não encontrado" };
  }
  return { id: servico.id };
}

/** Uma conta como a consulta abaixo a entrega, no que importa para a escolha. */
interface ContaElegivel {
  id: string;
  name: string | null;
  account_type: AccountType;
  is_active: boolean | null;
}

/** O nome literal que a migration 056 da a conta padrao de quem se cadastra. */
const NOME_DA_CONTA_PADRAO = "Conta Corrente";

/**
 * A CONTA EM QUE A CONVERSA GRAVA, ou `null` quando nao ha nenhuma elegivel.
 *
 * O plano foi alem do texto da issue-mae ("conta = a conta padrao dela") porque
 * a medicao obrigou: `financial_accounts` NAO TEM coluna `is_default` (baseline
 * 001), entao nao existe "a conta padrao" no banco para ler; e a migration 056
 * cria `Conta Corrente`/`Dinheiro` SO PARA USUARIO NOVO
 * (`database/tests/056_contas_antes_da_056.sql` existe para quem se cadastrou
 * antes). Logo, escada declarada:
 *
 *   1. conta ativa de `account_type = 'checking'` chamada `Conta Corrente` -- a
 *      que ela tem sem nunca ter cadastrado nada;
 *   2. senao, a MAIS ANTIGA (`created_at`, ordenado pela consulta) ativa cujo
 *      `escopoDoTipo` e "conta" -- reusando `lib/contas.ts`, o unico lugar do
 *      app que decide o que e conta e o que e cartao;
 *   3. senao, `null`, e quem chama RECUSA com 409.
 *
 * NUNCA CARTAO, e e o degrau 2 que garante: `escopoDoTipo("credit_card")` e
 * "cartao". Gasto em cartao NAO e dinheiro saindo hoje -- ele vira linha de
 * fatura, com mes de competencia proprio (`card_invoice_month()`, 006), e a
 * despesa so se REALIZA no pagamento da fatura. A conversa le
 * `financial_transactions` direto, entao o dinheiro seria contado AGORA e OUTRA
 * VEZ no pagamento: "Gastei" maior do que ela gastou, com os outros dois numeros
 * certos.
 *
 * `is_active !== false`, e nao `=== true`: a coluna e ANULAVEL com default
 * `true` (001:1106), entao `NULL` quer dizer "ninguem mexeu" e conta como ativa
 * -- o mesmo criterio de `contasQueSomam` e pelo mesmo motivo.
 *
 * A ORDEM E RESPONSABILIDADE DE QUEM CONSULTA, e o degrau 2 so e deterministico
 * com `ORDER BY`: sem ele o Postgres pode devolver duas ordens para a mesma
 * tabela, e dois "Gastei" iguais cairiam em contas diferentes.
 */
function contaDaConversa(contas: ContaElegivel[]): ContaElegivel | null {
  const ativas = contas.filter((conta) => conta.is_active !== false);

  return (
    ativas.find(
      (conta) =>
        conta.account_type === "checking" && conta.name === NOME_DA_CONTA_PADRAO
    ) ??
    ativas.find((conta) => escopoDoTipo(conta.account_type) === "conta") ??
    null
  );
}

/** Os tres numeros do mes corrente, e as linhas que entraram neles. */
type LeituraDaConversa =
  | {
      mes: MesDaConversa;
      numeros: TresNumerosDaConversa;
      linhas: LinhaDaConversa[];
    }
  | { erro: string };

/**
 * O CAMINHO UNICO dos tres numeros -- usado pelo GET e, de novo, pelo POST.
 *
 * Ver a secao do caminho unico no cabecalho: e isto que impede o numero de
 * logo-apos-confirmar de discordar do numero do recarregar.
 *
 * `linhas` sao as que `linhasDaConversa` ACEITOU, nao as que o banco devolveu:
 * a lista que a tela (F4) vai abrir tem de sair do MESMO criterio que somou, ou
 * a lista discordaria do total que esta em cima dela.
 */
async function tresNumerosDoMes(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  serviceId: string
): Promise<LeituraDaConversa> {
  const mes = mesCorrenteDaConversa(today());

  const { data, error } = await supabase
    .from("financial_transactions")
    // `*` por `COLUNAS_DA_CONVERSA`, e nao a lista de colunas -- ver a secao do
    // que a leitura filtra no banco, no cabecalho.
    .select(COLUNAS_DA_CONVERSA)
    .eq("user_id", userId)
    .eq("service_id", serviceId)
    .gte("transaction_date", mes.de)
    .lte("transaction_date", mes.ate);

  if (error) {
    console.error("Conversa: erro ao ler os três números:", error);
    return { erro: "Não foi possível calcular o saldo" };
  }

  const doBanco = (data ?? []) as unknown as LinhaDaConversa[];

  return {
    mes,
    // OS TRES JUNTOS, nunca o saldo sozinho: e o que deixa a aritmetica visivel
    // na tela e a unica defesa real contra o numero plausivel e errado.
    numeros: tresNumerosDaConversa(doBanco, mes),
    linhas: linhasDaConversa(doBanco, mes),
  };
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

    // O CORPO, lido em DOIS CAMPOS e nada mais -- ver a secao dos campos de
    // divisao no cabecalho. `catch` em vez de deixar estourar: corpo vazio ou
    // JSON cortado no meio e 400 com frase, nao 500.
    let corpo: { direcao?: unknown; valor?: unknown } = {};
    try {
      corpo = (await request.json()) ?? {};
    } catch {
      return NextResponse.json(
        { error: 'Diga "gastei" ou "ganhei" em `direcao`' },
        { status: 400 }
      );
    }

    const direcao = direcaoDoCorpo(corpo.direcao);
    if (!direcao) {
      return NextResponse.json(
        { error: 'Diga "gastei" ou "ganhei" em `direcao`' },
        { status: 400 }
      );
    }

    const valor = valorDoCorpo(corpo.valor);
    if (valor === null) {
      return NextResponse.json(
        { error: "O valor tem que ser um número maior que zero" },
        { status: 400 }
      );
    }

    const servico = await servicoDeFinancas(supabase);
    if ("erro" in servico) {
      return NextResponse.json({ error: servico.erro }, { status: 404 });
    }

    // A CONTA. `order("created_at")` nao e enfeite -- ver o degrau 2 de
    // `contaDaConversa`.
    const { data: contas, error: erroContas } = await supabase
      .from("financial_accounts")
      .select("id, name, account_type, is_active")
      .eq("user_id", user.id)
      .order("created_at");

    if (erroContas) {
      console.error("Conversa: erro ao ler as contas:", erroContas);
      return NextResponse.json(
        { error: "Não foi possível registrar agora" },
        { status: 500 }
      );
    }

    const conta = contaDaConversa((contas ?? []) as ContaElegivel[]);

    // RECUSA, e nao insert com a conta nula. `account_id` e ANULAVEL, logo o
    // insert orfao volta 201 -- exatamente o defeito da rota velha, e "anotei"
    // na tela com o saldo da conta parado e pior que uma frase pedindo para
    // cadastrar a conta. Nenhuma escrita acontece antes desta linha.
    if (!conta) {
      return NextResponse.json(
        {
          error:
            "Você ainda não tem uma conta onde lançar. Cadastre uma conta " +
            "corrente ou dinheiro em Contas.",
        },
        { status: 409 }
      );
    }

    const categoria = await categoriaDaConversa(
      supabase,
      user.id,
      servico.id,
      direcao
    );
    if ("erro" in categoria) {
      return NextResponse.json({ error: categoria.erro }, { status: 500 });
    }

    const reservada = CATEGORIAS_DA_CONVERSA[direcao];

    const { data: gravado, error: erroInsert } = await supabase
      .from("financial_transactions")
      .insert({
        // Do SERVIDOR, nunca do corpo: e o que a policy do 002 compara com
        // `auth.uid()`.
        user_id: user.id,
        service_id: servico.id,
        category_id: categoria.id,
        // A COLUNA QUE A ROTA VELHA ESQUECE. Sem ela o
        // `update_account_balance_trigger` nao move saldo nenhum.
        account_id: conta.id,
        description: reservada.descricaoDoLancamento,
        // O SINAL, pela direcao e so por ela: despesa NEGATIVA, receita
        // positiva -- a convencao de `financial_transactions` (em
        // `scheduled_transactions` a despesa e POSITIVA, e e por isso que esta
        // linha nao se parece com a do painel).
        amount: direcao === "gastei" ? -valor : valor,
        // Sem esta coluna a transacao nasce com `transaction_type` NULO (ela e
        // anulavel, 001:1140), as tres views da 008 a descartam, e F2 nao a
        // soma nem em `ganhei` nem em `gastei` -- ela apareceria na lista e nao
        // mexeria no saldo (HMO-181).
        transaction_type: TIPO_POR_DIRECAO[direcao],
        // HOJE pelo relogio de Sao Paulo, NUNCA por UTC -- ver os defaults no
        // cabecalho.
        transaction_date: today(),
      })
      .select("id")
      .single();

    if (erroInsert || !gravado) {
      console.error("Conversa: erro ao gravar o lançamento:", erroInsert);
      return NextResponse.json(
        { error: "Não foi possível registrar agora" },
        { status: 500 }
      );
    }

    // OS TRES NUMEROS RELIDOS pelo mesmo caminho do GET -- ver a secao do
    // caminho unico no cabecalho.
    const leitura = await tresNumerosDoMes(supabase, user.id, servico.id);
    if ("erro" in leitura) {
      return NextResponse.json({ error: leitura.erro }, { status: 500 });
    }

    return NextResponse.json(
      {
        lancamento: { id: gravado.id },
        mes: leitura.mes,
        numeros: leitura.numeros,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Erro no POST da conversa:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function GET(_request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const servico = await servicoDeFinancas(supabase);
    if ("erro" in servico) {
      return NextResponse.json({ error: servico.erro }, { status: 404 });
    }

    const leitura = await tresNumerosDoMes(supabase, user.id, servico.id);
    if ("erro" in leitura) {
      return NextResponse.json({ error: leitura.erro }, { status: 500 });
    }

    // `mes` ECOA a janela consultada, e nao e enfeite: as rotas `/api/` tem
    // cache de 24h no PWA, e resposta de um mes pintada na moldura de outro e o
    // modo de falha -- a mesma razao pela qual a irma ecoa o `month`. Ele sai de
    // `leitura.mes`, que e a unica fonte da janela: um campo calculado a parte
    // poderia discordar dela.
    //
    // Sem querystring de mes, de proposito: "Saldo" na conversa e do mes
    // corrente e a tela diz isso. Navegacao mes a mes e o relatorio que o plano
    // da HMO-462 esta substituindo.
    return NextResponse.json({
      mes: leitura.mes,
      numeros: leitura.numeros,
      linhas: leitura.linhas,
    });
  } catch (error) {
    console.error("Erro no GET da conversa:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
