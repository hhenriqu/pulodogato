// =====================================================
// PULODOGATO - o criterio de custo pessoal do PAINEL (HMO-258, HMO-418)
// =====================================================
//   npm run test:criterio-do-painel
//
// A DECISAO QUE ESTA SUITE TRANCA
// -------------------------------
// "Quando eu pago 90 por tres pessoas, a minha despesa do mes e 90 ou 30?" foi
// respondida em 08/10/2026, na interaction `hmo258:criterio-do-relatorio:v1`,
// por uma PESSOA (`resolvedByUserId` preenchido, `resolvedByAgentId` nulo):
//
//   1.010,00 -- BRUTO + REEMBOLSO
//     INTEIRO quando EU paguei          (o jantar de 90 conta 90)
//     MINHA PARTE quando OUTRO pagou    (o mercado de 60 da B conta 20)
//
// A opcao DESCARTADA era 950,00 ("manter so a minha parte, com rotulo na tela"),
// e era ela que o painel mostrava -- sem o rotulo que a propria opcao pedia.
//
// POR QUE A PROVA TEM DE CHAMAR A ROTA, E NAO LER UMA VIEW
// --------------------------------------------------------
// A migration 046 pos o criterio aprovado nas views e declarou no cabecalho dela
// "painel ... 950,00 -> 1.010,00". O commit dela (b9fb8c4) nao toca um unico
// arquivo de `app/` -- e O PAINEL NAO LE VIEW NENHUMA. Ele chama
// `/api/reports/cash-flow?de=&ate=&cartao=fatura`, e `cartao=fatura` cai no ramo
// `periodo.modo === "intervalo" || cartaoPelaFatura`, que soma as linhas CRUAS
// no JavaScript mesmo quando o periodo e um mes inteiro. Nenhuma migration pode
// mudar o numero daquela tela.
//
// O medidor (scripts/medidor-hmo258.sql) tambem mediu a view no lugar do painel
// por nove dias, e com isso o contador de respostas distintas dele imprimia 2
// enquanto a tela mais aberta do app mostrava um TERCEIRO numero. Entao esta
// suite nao mede view, nao mede funcao pura e nao le texto: ela CHAMA OS DOIS
// HANDLERS com a fixture de maio e assere dinheiro.
//
// OS QUATRO NUMEROS, E POR QUE UM DELES BASTA PARA DISCRIMINAR
// ------------------------------------------------------------
// O criterio e feito de DOIS filtros, e cada um sem o outro erra dinheiro num
// sentido diferente. Na fixture de maio:
//
//   os dois filtros antigos ......   950,00  minha parte dos DOIS lados (o
//                                            estado recusado em 08/10)
//   so `group_id IS NULL` tirado .. 1.040,00 valor cheio + a minha parte dele:
//                                            a mesma despesa duas vezes
//   so `NOT paguei_eu` posto .....   920,00  a despesa que EU paguei desaparece
//   os dois trocados ............. 1.010,00  <- o criterio aprovado
//
// Os quatro sao distintos, e e isso que faz UMA assercao de total reprovar as
// tres meias-correcoes. A secao 0 nao confia nessa propriedade: ela a CALCULA a
// partir do fixture e reprova se uma edicao futura colapsar dois dos quatro --
// que e como esta suite deixaria de discriminar sem ficar vermelha.
//
// NAO HA RELOGIO CONGELADO, E ISSO E DELIBERADO
// ---------------------------------------------
// O ramo de intervalo nao chama `today()`: a janela vem inteira de `?de=&ate=`,
// e a comparacao de datas e lexicografica sobre ISO.
// =====================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { criarDuble } from "./duble-de-supabase.mjs";

const RAIZ = "../.tmp-criterio-do-painel";

const FLUXO = await import(`${RAIZ}/app/api/reports/cash-flow/route.js`);
const CATEGORIAS = await import(`${RAIZ}/app/api/reports/categories/route.js`);

/** EU sou a conta A da fixture da HMO-255. */
const EU = "a5800000-0000-0000-0000-0000000000a1";
/** A B, que pagou o mercado do grupo. */
const OUTRO = "a5800000-0000-0000-0000-0000000000b1";
const GRUPO = "95800000-0000-0000-0000-000000000001";

const CONTA_MINHA = "f5800000-0000-0000-0000-0000000000a1";
const CARTAO_MEU = "f5800000-0000-0000-0000-0000000000a9";

/**
 * Quatro categorias, uma por despesa.
 *
 * O medidor usa a MESMA categoria no mercado e nas duas despesas de grupo,
 * porque ele precisa de um teto de orcamento para consumir. Aqui elas sao
 * separadas: a secao de categorias assere o valor de cada fatia, e com duas
 * despesas na mesma fatia nao daria para dizer qual das duas entrou errada.
 * Nenhum total muda com isso -- os valores sao os mesmos.
 */
const MERCADO = "c0000000-0000-0000-0000-000000000001";
const COMBUSTIVEL = "c0000000-0000-0000-0000-000000000002";
const JANTAR = "c0000000-0000-0000-0000-000000000003";
const MERCADO_DO_GRUPO = "c0000000-0000-0000-0000-000000000004";

/**
 * MAIO INTEIRO, que e como o painel pergunta.
 *
 * Um mes fechado cairia no ramo dos rollups do 008 se nao fosse `cartao=fatura`
 * -- e esse e o ponto: o painel manda sempre o parametro, e com ele o mes
 * inteiro cai no ramo que soma as linhas cruas. A secao 2 repete a medida num
 * periodo que NAO e mes inteiro, para o criterio nao ficar amarrado ao
 * parametro do cartao.
 */
const DE = "2026-05-01";
const ATE = "2026-05-31";

/** Um periodo que corta meses pela metade: cai no ramo de intervalo sem o cartao. */
const DE_PARTIDO = "2026-04-20";
const ATE_PARTIDO = "2026-05-31";

/** `amount` NEGATIVO, como o app grava (pulodogato-amount-sign-convention). */
const transacao = (extra) => ({
  user_id: EU,
  account_id: CONTA_MINHA,
  group_id: null,
  currency: "BRL",
  transaction_type: "expense",
  notes: null,
  counterpart_transaction_id: null,
  account: { account_type: "checking" },
  ...extra,
});

const MERCADO_SO_MEU = transacao({
  id: "75800000-0000-0000-0000-000000000001",
  category_id: MERCADO,
  amount: -500,
  transaction_date: "2026-05-05",
});

const COMBUSTIVEL_SO_MEU = transacao({
  id: "75800000-0000-0000-0000-000000000002",
  category_id: COMBUSTIVEL,
  amount: -400,
  transaction_date: "2026-05-08",
});

/**
 * O JANTAR DE 90 QUE EU PAGUEI. A linha CHEIA, com `group_id` preenchido.
 *
 * Ate a HMO-418 a rota a descartava inteira (`is("group_id", null)`) e contava
 * so a minha parte de 30. Ela e a metade 1 do criterio.
 */
const JANTAR_QUE_EU_PAGUEI = transacao({
  id: "75800000-0000-0000-0000-000000000003",
  category_id: JANTAR,
  group_id: GRUPO,
  amount: -90,
  transaction_date: "2026-05-12",
});

/**
 * O MERCADO DE 60 QUE A B PAGOU. Visivel para mim pela policy do 002
 * (`user_id = auth.uid() OR is_group_member(group_id)`), e NAO e meu dinheiro.
 *
 * Com o `is("group_id", null)` fora, o `eq("user_id")` passou a ser a unica
 * coisa que segura esta linha -- e e por isso que a secao 3 o confere na
 * consulta que a rota fez, nao so no total.
 */
const MERCADO_QUE_A_B_PAGOU = transacao({
  id: "75800000-0000-0000-0000-000000000004",
  user_id: OUTRO,
  account_id: null,
  account: null,
  category_id: MERCADO_DO_GRUPO,
  group_id: GRUPO,
  amount: -60,
  transaction_date: "2026-05-20",
});

const TRANSACOES = [
  MERCADO_SO_MEU,
  COMBUSTIVEL_SO_MEU,
  JANTAR_QUE_EU_PAGUEI,
  MERCADO_QUE_A_B_PAGOU,
];

/**
 * `group_share_entries` (033): uma linha por (parte, membro).
 *
 * `amount` sai POSITIVO da view -- a parte de uma despesa de -90 e 30,00 -- e os
 * agregadores aplicam `Math.abs`. Ver lib/parte-do-grupo-realizada.ts.
 *
 * As partes da C ficam de fora do fixture: elas nao sao visiveis no total de
 * ninguem que esta suite mede, e cada linha a mais aqui so dilui a leitura. As
 * da B estao, porque sao justamente o que o `eq("user_id")` segura.
 */
const parte = (extra) => ({
  user_id: EU,
  group_id: GRUPO,
  currency: "BRL",
  transaction_type: "expense",
  ...extra,
});

/** A MINHA parte do jantar que EU paguei: 30,00, `paguei_eu` TRUE. */
const MINHA_PARTE_DO_JANTAR = parte({
  id: "e0000000-0000-0000-0000-000000000001",
  transaction_id: JANTAR_QUE_EU_PAGUEI.id,
  category_id: JANTAR,
  amount: 30,
  transaction_date: "2026-05-12",
  paguei_eu: true,
});

/** A MINHA parte do mercado que a B pagou: 20,00, `paguei_eu` FALSE. */
const MINHA_PARTE_DO_MERCADO_DA_B = parte({
  id: "e0000000-0000-0000-0000-000000000002",
  transaction_id: MERCADO_QUE_A_B_PAGOU.id,
  category_id: MERCADO_DO_GRUPO,
  amount: 20,
  transaction_date: "2026-05-20",
  paguei_eu: false,
});

/** As partes da B. O `eq("user_id")` da rota e o que as segura. */
const PARTES_DA_B = [
  parte({
    id: "e0000000-0000-0000-0000-00000000000b",
    user_id: OUTRO,
    transaction_id: JANTAR_QUE_EU_PAGUEI.id,
    category_id: JANTAR,
    amount: 30,
    transaction_date: "2026-05-12",
    paguei_eu: false,
  }),
  parte({
    id: "e0000000-0000-0000-0000-00000000000c",
    user_id: OUTRO,
    transaction_id: MERCADO_QUE_A_B_PAGOU.id,
    category_id: MERCADO_DO_GRUPO,
    amount: 20,
    transaction_date: "2026-05-20",
    paguei_eu: true,
  }),
];

const PARTES = [
  MINHA_PARTE_DO_JANTAR,
  MINHA_PARTE_DO_MERCADO_DA_B,
  ...PARTES_DA_B,
];

const CATALOGO = [
  { id: MERCADO, name: "Mercado", icon: null, color_hex: null, is_expense: true },
  {
    id: COMBUSTIVEL,
    name: "Combustível",
    icon: null,
    color_hex: null,
    is_expense: true,
  },
  { id: JANTAR, name: "Jantar", icon: null, color_hex: null, is_expense: true },
  {
    id: MERCADO_DO_GRUPO,
    name: "Mercado do grupo",
    icon: null,
    color_hex: null,
    is_expense: true,
  },
];

const PERFIS = [{ id: EU, preferences: { moeda: { oficial: "BRL" } } }];

// ---------------------------------------------------------------------------
// Os quatro numeros, calculados do FIXTURE em vez de cravados
// ---------------------------------------------------------------------------
// Cravar `1010` aqui tornaria a secao 0 uma tautologia. Estas quatro funcoes
// refazem, sobre o fixture, o que cada combinacao de filtro selecionaria -- e e
// a comparacao entre elas que prova que a fixture ainda DISCRIMINA.
const somaDeDespesa = (linhas) =>
  Number(
    linhas
      .filter((l) => l.transaction_type === "expense")
      .reduce((s, l) => s + Math.abs(Number(l.amount)), 0)
      .toFixed(2)
  );

/** O que `financial_transactions` traz, por combinacao do filtro de grupo. */
const minhasTransacoes = (comFiltroDeGrupo) =>
  TRANSACOES.filter(
    (l) => l.user_id === EU && (!comFiltroDeGrupo || l.group_id === null)
  );

/** O que `group_share_entries` traz, por combinacao do filtro de `paguei_eu`. */
const minhasPartes = (comFiltroDePaguei) =>
  PARTES.filter(
    (p) => p.user_id === EU && (!comFiltroDePaguei || p.paguei_eu === false)
  );

const totalCom = (comFiltroDeGrupo, comFiltroDePaguei) =>
  Number(
    (
      somaDeDespesa(minhasTransacoes(comFiltroDeGrupo)) +
      somaDeDespesa(minhasPartes(comFiltroDePaguei))
    ).toFixed(2)
  );

/** O criterio APROVADO: sem o filtro de grupo, com o de `paguei_eu`. */
const APROVADO = totalCom(false, true);
/** Os tres estados errados, cada um com o nome do defeito. */
const RECUSADO_EM_OUTUBRO = totalCom(true, false);
const DUPLA_CONTAGEM = totalCom(false, false);
const DESPESA_QUE_EU_PAGUEI_DESAPARECE = totalCom(true, true);

/**
 * Chama um handler com o duble instalado.
 *
 * `chamadasDeSessao > 0` e o controle positivo de
 * [[route-handler-roda-no-node-com-duble-de-client]]: se a rota trocar o jeito
 * de obter o client, o duble deixa de ser consultado, a resposta sai plausivel e
 * TODA assercao abaixo passa por vacuidade.
 */
async function chamar(rota, url, { tabelas, erros = {} } = {}) {
  const sessao = criarDuble({
    user: { id: EU },
    tabelas: {
      profiles: PERFIS,
      transaction_categories: CATALOGO,
      financial_transactions: TRANSACOES,
      group_share_entries: PARTES,
      ...tabelas,
    },
    erros,
  });

  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  let resposta;
  try {
    resposta = await rota.GET({ url });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  assert.ok(
    (registro.chamadasDeSessao ?? 0) > 0,
    `controle positivo: ${url} nao abriu o client de SESSAO. A resposta medida ` +
      "abaixo nao veio do fixture."
  );

  return { resposta, lidas: sessao.lidas };
}

/** O corpo de uma resposta que deveria ter sido 200, para a mensagem do assert. */
async function textoDoErro(resposta) {
  if (resposta.status === 200) return "";
  return (
    `a rota respondeu ${resposta.status}: ${await resposta.text()}. Um 500 aqui ` +
    "costuma ser metodo que falta no duble (o `catch` da rota engole o " +
    "`... is not a function`) -- e nao a feature."
  );
}

/** A mensagem que nomeia o defeito pelo numero que apareceu. */
const diagnostico = (achado) =>
  [
    `o custo pessoal de maio tem de ser ${APROVADO} (500 + 400 + o jantar de 90 ` +
      "INTEIRO, porque eu paguei, + os 20 da minha parte do mercado da B).",
    `${RECUSADO_EM_OUTUBRO}: os dois filtros antigos -- a minha parte dos DOIS ` +
      "lados, a convencao RECUSADA em 08/10/2026.",
    `${DUPLA_CONTAGEM}: `
      + "`group_id IS NULL` saiu e `NOT paguei_eu` nao entrou -- o valor cheio "
      + "do jantar MAIS a minha parte dele, a mesma despesa duas vezes.",
    `${DESPESA_QUE_EU_PAGUEI_DESAPARECE}: `
      + "`NOT paguei_eu` entrou e `group_id IS NULL` ficou -- os 90 que sairam "
      + "da minha conta desaparecem do meu painel.",
    `achado: ${achado}.`,
  ].join("\n  ");

/** As consultas que a rota fez a uma tabela. */
const consultasA = (lidas, tabela) => lidas.filter((l) => l.tabela === tabela);

const temFiltro = (consulta, op, coluna, valor) =>
  consulta.filtros.some(
    ([o, c, v]) => o === op && c === coluna && v === valor
  );

const urlDoPainel = `https://exemplo.test/api/reports/cash-flow?de=${DE}&ate=${ATE}&cartao=fatura`;

// ===========================================================================
// SECAO 0 - a fixture DISCRIMINA as quatro combinacoes (anti-vacuidade)
// ===========================================================================
// Esta secao e a que impede o resto da suite de apodrecer. Toda assercao de
// dinheiro abaixo so reprova as meias-correcoes enquanto os quatro numeros forem
// DIFERENTES -- e eles sao propriedade da fixture, nao da rota. Uma edicao que
// zerasse o jantar, ou que tirasse a parte da B, colapsaria dois dos quatro e a
// suite continuaria verde medindo menos do que diz medir.
test("secao 0: os quatro criterios dao quatro numeros distintos nesta fixture", () => {
  const quatro = {
    aprovado: APROVADO,
    recusado: RECUSADO_EM_OUTUBRO,
    duplaContagem: DUPLA_CONTAGEM,
    despesaDesaparece: DESPESA_QUE_EU_PAGUEI_DESAPARECE,
  };

  assert.equal(
    new Set(Object.values(quatro)).size,
    4,
    "dois criterios dao o MESMO numero nesta fixture, e a assercao de total das " +
      "secoes abaixo deixa de distinguir um do outro: " +
      JSON.stringify(quatro)
  );

  // E os valores da issue, para que o colapso nao seja "consertado" mexendo nos
  // numeros em vez de na fixture. Sao os quatro medidos na HMO-413 sobre a
  // fixture de maio da conta A da HMO-255.
  assert.deepEqual(quatro, {
    aprovado: 1010,
    recusado: 950,
    duplaContagem: 1040,
    despesaDesaparece: 920,
  });
});

// ===========================================================================
// SECAO 1 - O PAINEL: `?de=&ate=&cartao=fatura` sobre maio inteiro
// ===========================================================================
// A URL e a de app/(dashboard)/dashboard/page.tsx. `cartao=fatura` nao e
// opcional naquela tela, e e ele que faz o mes inteiro cair no ramo que soma as
// linhas cruas -- entao nao existe caminho em que o painel leia a view que a 046
// consertou.
test("secao 1: o painel soma bruto + reembolso", async () => {
  const { resposta } = await chamar(FLUXO, urlDoPainel);

  assert.equal(resposta.status, 200, await textoDoErro(resposta));
  const corpo = await resposta.json();

  assert.equal(corpo.grao, "intervalo", "`cartao=fatura` responde um BALDE");
  assert.equal(corpo.cartao, "fatura");

  assert.equal(
    corpo.summary.total_expense,
    APROVADO,
    diagnostico(corpo.summary.total_expense)
  );

  // A contagem acompanha o criterio: 3 transacoes minhas (mercado, combustivel,
  // jantar) + 1 parte (o mercado da B). Um total certo com contagem errada
  // significa linha entrando e saindo aos pares.
  assert.equal(
    corpo.summary.transaction_count,
    4,
    "a contagem tem de ser 4 -- as tres despesas que eu lancei mais a parte do " +
      "que a B pagou. 5 significa que a minha parte do jantar entrou junto com " +
      "o valor cheio dele"
  );

  assert.equal(corpo.summary.total_income, 0);
  assert.equal(corpo.summary.net, -APROVADO);
});

// ===========================================================================
// SECAO 2 - o MESMO criterio num periodo que corta meses pela metade
// ===========================================================================
// Sem `cartao=fatura`, e com `de` que nao e dia 1: o ramo e o mesmo e o criterio
// nao pode depender do parametro do cartao. Se dependesse, a tela que um dia
// pedir um intervalo sem o parametro veria o 950 de volta.
//
// O periodo comeca em 20/04, antes das quatro despesas, entao o total e o mesmo
// da secao 1 -- o que muda e por qual porta a rota entrou no ramo.
test("secao 2: o criterio nao depende de `cartao=fatura`", async () => {
  const { resposta } = await chamar(
    FLUXO,
    `https://exemplo.test/api/reports/cash-flow?de=${DE_PARTIDO}&ate=${ATE_PARTIDO}`
  );

  assert.equal(resposta.status, 200, await textoDoErro(resposta));
  const corpo = await resposta.json();

  assert.equal(corpo.grao, "intervalo");
  assert.equal(corpo.cartao, "compra", "sem o parametro, a regra do cartao nao roda");

  assert.equal(
    corpo.summary.total_expense,
    APROVADO,
    diagnostico(corpo.summary.total_expense)
  );
});

// ===========================================================================
// SECAO 3 - os dois filtros, na consulta que a rota FEZ
// ===========================================================================
// As secoes 1 e 2 medem o total, que e o que importa. Esta mede as duas
// consultas, e existe porque o total NAO distingue duas causas muito diferentes
// para o mesmo numero certo:
//
//   * a rota perdeu o `eq("user_id")` e ganhou de volta o `is("group_id")`: o
//     total continuaria 1.010 nesta fixture se a despesa da B tivesse o mesmo
//     valor da minha parte dela;
//   * o filtro de `paguei_eu` virou `eq(..., true)` numa fixture onde as duas
//     partes tivessem o mesmo valor.
//
// Cravar a presenca dos filtros fecha essas portas sem precisar de uma fixture
// que as cubra uma a uma.
test("secao 3: as duas consultas levam os filtros do criterio", async () => {
  const { lidas } = await chamar(FLUXO, urlDoPainel);

  for (const consulta of consultasA(lidas, "financial_transactions")) {
    assert.ok(
      temFiltro(consulta, "eq", "user_id", EU),
      'a consulta de transacoes perdeu o `eq("user_id")`. Ele deixou de ser ' +
        "higiene na HMO-418: sem o `is(\"group_id\", null)` ele e a UNICA coisa " +
        "que separa a minha despesa de grupo da dos outros membros, que a " +
        "policy do 002 me deixa ler"
    );
    assert.ok(
      !temFiltro(consulta, "is", "group_id", null),
      'a consulta de transacoes voltou a filtrar `group_id IS NULL`: a despesa ' +
        "de grupo que EU paguei desaparece do meu custo (" +
        `${DESPESA_QUE_EU_PAGUEI_DESAPARECE} nesta fixture)`
    );
  }

  const daParte = consultasA(lidas, "group_share_entries");
  assert.ok(
    daParte.length > 0,
    "a rota nao consultou `group_share_entries`: o reembolso que eu devo e a " +
      "metade 2 do criterio aprovado"
  );

  for (const consulta of daParte) {
    assert.ok(
      temFiltro(consulta, "eq", "user_id", EU),
      'a consulta de partes perdeu o `eq("user_id")`: as views da 033 nao ' +
        "filtram usuario e a policy tem `OR is_group_member(...)`, entao vem a " +
        "parte dos OUTROS membros"
    );
    assert.ok(
      temFiltro(consulta, "eq", "paguei_eu", false),
      "a consulta de partes perdeu o `paguei_eu = false`. E o espelho do " +
        "`WHERE NOT g.paguei_eu` da perna 2 da migration 046; sem ele o valor " +
        "cheio da despesa que eu paguei soma com a minha parte dela " +
        `(${DUPLA_CONTAGEM} nesta fixture)`
    );
  }
});

// ===========================================================================
// SECAO 4 - /api/reports/categories le o MESMO conjunto de linhas
// ===========================================================================
// O cabecalho das duas rotas diz que isso e de proposito: o total do fluxo tem
// de ser igual a soma das categorias, senao a pizza do painel nao fecha em 100%.
//
// Esta rota NAO TEM CHAMADOR no modo pessoal hoje -- o unico consumidor,
// `PainelDoGrupo`, sempre passa `groupId`. E por isso que ela e a que apodrece
// calada: consertar uma e nao a outra deixaria as duas irmas discordando na
// primeira tela que pedisse categoria por intervalo, sem nada ficar vermelho.
test("secao 4: a soma das categorias e o mesmo total do fluxo", async () => {
  const { resposta, lidas } = await chamar(
    CATEGORIAS,
    `https://exemplo.test/api/reports/categories?de=${DE_PARTIDO}&ate=${ATE_PARTIDO}`
  );

  assert.equal(resposta.status, 200, await textoDoErro(resposta));
  const corpo = await resposta.json();

  assert.equal(corpo.grao, "intervalo");

  assert.equal(
    corpo.summary.total_expense,
    APROVADO,
    diagnostico(corpo.summary.total_expense)
  );

  const soma = Number(
    corpo.categories.reduce((s, c) => s + c.expense, 0).toFixed(2)
  );
  assert.equal(
    soma,
    APROVADO,
    "a soma das fatias nao fecha com o total do bloco -- a pizza nao fecha em 100%"
  );

  // Fatia por fatia: o jantar INTEIRO na categoria dele, e so a minha parte na
  // do mercado da B. Um total certo com as fatias trocadas de tamanho e
  // exatamente o defeito que o par de filtros pode produzir numa fixture onde os
  // valores se compensem.
  const porCategoria = new Map(
    corpo.categories.map((c) => [c.category_id, c.expense])
  );

  assert.equal(porCategoria.get(MERCADO), 500);
  assert.equal(porCategoria.get(COMBUSTIVEL), 400);
  assert.equal(
    porCategoria.get(JANTAR),
    90,
    "o jantar que EU paguei tem de entrar INTEIRO na categoria dele. 30 e a " +
      "minha parte -- o criterio recusado; 120 e a soma dos dois"
  );
  assert.equal(
    porCategoria.get(MERCADO_DO_GRUPO),
    20,
    "do mercado que a B pagou entra so a MINHA PARTE. 60 e o valor cheio dela, " +
      "que nao e meu dinheiro nenhum"
  );

  // E os mesmos dois filtros, pela mesma razao da secao 3.
  for (const consulta of consultasA(lidas, "financial_transactions")) {
    assert.ok(temFiltro(consulta, "eq", "user_id", EU));
    assert.ok(
      !temFiltro(consulta, "is", "group_id", null),
      "a rota de categorias voltou a filtrar `group_id IS NULL` e passou a " +
        "discordar do fluxo de caixa sobre o mesmo periodo"
    );
  }
  for (const consulta of consultasA(lidas, "group_share_entries")) {
    assert.ok(temFiltro(consulta, "eq", "user_id", EU));
    assert.ok(
      temFiltro(consulta, "eq", "paguei_eu", false),
      "a rota de categorias perdeu o `paguei_eu = false`: a despesa que eu " +
        "paguei conta duas vezes na categoria dela"
    );
  }
});

// ===========================================================================
// SECAO 5 - o painel DO GRUPO nao se move
// ===========================================================================
// Com `groupId` o numero certo e o valor CHEIO da despesa, de todos os membros,
// e a parte de grupo NAO e consultada -- somar a minha parte sobre o total do
// grupo contaria a minha fracao duas vezes. Esta secao e o controle de que os
// dois filtros trocados ficaram no caminho PESSOAL.
test("secao 5: com groupId o total continua sendo o do grupo inteiro", async () => {
  const { resposta, lidas } = await chamar(
    FLUXO,
    `https://exemplo.test/api/reports/cash-flow?de=${DE_PARTIDO}&ate=${ATE_PARTIDO}&groupId=${GRUPO}`
  );

  assert.equal(resposta.status, 200, await textoDoErro(resposta));
  const corpo = await resposta.json();

  // As duas despesas de grupo, pelo valor cheio: 90 + 60.
  assert.equal(
    corpo.summary.total_expense,
    150,
    "o painel do grupo mostra o valor CHEIO das despesas do grupo, somando " +
      "todos os membros"
  );

  assert.equal(
    consultasA(lidas, "group_share_entries").length,
    0,
    "a rota consultou a parte de grupo no caminho DO GRUPO: a minha fracao " +
      "entraria duas vezes"
  );

  for (const consulta of consultasA(lidas, "financial_transactions")) {
    assert.ok(
      temFiltro(consulta, "eq", "group_id", GRUPO),
      "o caminho de grupo perdeu o filtro de grupo"
    );
    assert.ok(
      !temFiltro(consulta, "eq", "user_id", EU),
      "o caminho de grupo filtrou por usuario: o painel do grupo mostraria so " +
        "as despesas que EU lancei"
    );
  }
});

// ===========================================================================
// SECAO 6 - a despesa de grupo lancada NO CARTAO
// ===========================================================================
// O efeito colateral que a HMO-418 tinha de conferir: as linhas de grupo passam
// a atravessar `realizadoComCartaoPelaFatura`, e a regra do cartao cruza o tipo
// da CONTA com a chave em `notes`.
//
// A resposta certa e que ela SAI do realizado: a compra esta dentro da fatura, e
// a fatura e que vai contar no mes em que for paga. E a mesma resposta que uma
// despesa pessoal no cartao recebe -- o que nao podia acontecer era a linha sair
// da conta por um criterio (grupo) e voltar por outro (fatura).
//
// E SEM `cartao=fatura` ELA FICA, pelo mesmo motivo que toda compra fica nesse
// caminho: a regra nao roda. Os dois casos juntos sao o que separa "a linha de
// grupo atravessa a regra" de "a linha de grupo some".
test("secao 6: a despesa de grupo no cartao conta pela fatura, como qualquer outra", async () => {
  const JANTAR_NO_CARTAO = transacao({
    ...JANTAR_QUE_EU_PAGUEI,
    account_id: CARTAO_MEU,
    account: { account_type: "credit_card" },
  });

  const tabelas = {
    financial_transactions: [
      MERCADO_SO_MEU,
      COMBUSTIVEL_SO_MEU,
      JANTAR_NO_CARTAO,
      MERCADO_QUE_A_B_PAGOU,
    ],
  };

  const comFatura = await chamar(FLUXO, urlDoPainel, { tabelas });
  assert.equal(comFatura.resposta.status, 200, await textoDoErro(comFatura.resposta));
  const corpoComFatura = await comFatura.resposta.json();

  assert.equal(
    corpoComFatura.summary.total_expense,
    APROVADO - 90,
    `com \`cartao=fatura\` o jantar de 90 no cartao sai do realizado: ${APROVADO - 90} ` +
      `(= ${APROVADO} menos os 90). ${APROVADO} significa que a linha de grupo ` +
      "nao atravessou a regra do cartao, e a compra conta no dia da compra E de " +
      "novo quando a fatura for paga"
  );

  // O PERIODO AQUI E O PARTIDO, E NAO MAIO INTEIRO. Sem `cartao=fatura`, um mes
  // fechado cai no ramo dos rollups do 008 -- `personal_monthly_cash_flow`, que
  // este fixture nao preenche -- e a resposta sai 0,00 com status 200. Medido ao
  // escrever esta secao: o zero se le como "a linha de grupo desapareceu", que e
  // justamente a hipotese que a secao existe para distinguir.
  const semFatura = await chamar(
    FLUXO,
    `https://exemplo.test/api/reports/cash-flow?de=${DE_PARTIDO}&ate=${ATE_PARTIDO}`,
    { tabelas }
  );
  assert.equal(semFatura.resposta.status, 200, await textoDoErro(semFatura.resposta));
  const corpoSemFatura = await semFatura.resposta.json();

  assert.equal(
    corpoSemFatura.summary.total_expense,
    APROVADO,
    "sem o parametro a regra do cartao nao roda, e a compra no cartao conta no " +
      "dia da compra -- inclusive a de grupo. Um numero menor aqui significa " +
      "que a linha de grupo esta sendo descartada por outro motivo"
  );
});

// ===========================================================================
// SECAO 7 - a janela entre o deploy e a colagem da 033
// ===========================================================================
// Producao nao tem runner de migration. Num banco onde a 033 nao existe a rota
// segue SEM o reembolso em vez de devolver 500 -- e agora essa queda custa
// menos do que custava: o que sobra e `tudo o que EU lancei`, 990,00, que e o
// fluxo de caixa. Antes da HMO-418 a queda derrubava tambem a despesa de grupo
// que eu paguei e sobravam 900,00, que nao e convencao de ninguem.
test("secao 7: sem a 033 colada, o que sobra e o que EU lancei", async () => {
  for (const code of ["42P01", "PGRST205"]) {
    const { resposta } = await chamar(FLUXO, urlDoPainel, {
      erros: { group_share_entries: { code, message: "nao existe" } },
    });

    assert.equal(resposta.status, 200, await textoDoErro(resposta));
    const corpo = await resposta.json();

    assert.equal(
      corpo.summary.total_expense,
      990,
      `${code}: a queda tem de devolver 990,00 -- as tres despesas que eu ` +
        "lancei, sem o reembolso que eu devo. 900,00 e o estado de antes da " +
        "HMO-418, onde a queda levava junto a despesa de grupo que eu paguei"
    );
  }
});
