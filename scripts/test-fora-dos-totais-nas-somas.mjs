// =====================================================
// AS SOMAS FORA DA CADEIA DE VIEWS HONRAM include_in_total
// (HMO-453, F3 da HMO-443)
// =====================================================
//   npm run test:fora-dos-totais-nas-somas
//
// A 060 pos `AND t.include_in_total` em `category_monthly_totals`, e dali ele
// propaga para a cadeia de cinco views e para os cinco leitores delas. A 063 fez
// o mesmo em `budget_consumption`, que tem o `SUM` dela proprio. Esta suite e a
// OUTRA METADE: as somas que percorrem as linhas cruas em JavaScript e nao
// herdam nada.
//
// O QUE ESTA SUITE MEDE QUE AS OUTRAS QUATRO NAO MEDEM
// ----------------------------------------------------
// `test:movimentacoes`, `test:telas-de-movimentacao`,
// `test:categorias-do-periodo` e `test:realizado-do-caixa` ganharam blocos
// proprios, cada um sobre a funcao dele. Aqui ficam as tres coisas que nenhuma
// daquelas quatro alcanca:
//
//   1. O DONO DO PREDICADO. `entraNosTotais` e a unica decisao sobre a forma
//      `!== false`, e os quatro estados (true / false / ausente / null) sao
//      medidos UMA vez, no lugar onde a decisao mora;
//   2. AS ROTAS, pelo ramo de INTERVALO. O filtro de /api/reports/cash-flow
//      vive no laco de paginacao, dentro do handler -- nenhuma suite de lib o
//      alcanca. E e aqui que a armadilha desta fase e medida (ver abaixo);
//   3. A HERANCA, confirmada e nao suposta. `resumoComPartesDeGrupo` chama
//      `resumoDoPeriodo`; a issue pede explicitamente para CONFIRMAR isso.
//
// A ARMADILHA DESTA FASE: MENSAL x INTERVALO
// ------------------------------------------
// Fluxo de Caixa e Categorias tem DOIS RAMOS cada -- mes inteiro (as views, ja
// filtradas pela 060 e ja em producao) e intervalo livre (estas somas em JS).
// Consertar so um faz "setembro inteiro" e "01/09 a 30/09" darem numeros
// DIFERENTES, que e pior que o defeito original: as duas leituras discordam sem
// nada que arbitre (duas-leituras-do-previsto-discordam-por-construcao).
//
// E A SONDA QUE MEDE COM MES INTEIRO CAI NO RAMO MENSAL e nao prova nada sobre
// o outro: o duble nao preenche `personal_monthly_cash_flow`, entao a resposta
// sai `summary.total_expense = 0` com status 200 -- zero que se le como "a regra
// descartou todas as linhas"
// (sonda-do-ramo-de-intervalo-com-mes-inteiro-cai-no-ramo-mensal-e-da-zero).
//
// POR ISSO TODO PERIODO DESTA SUITE COMECA EM 20/04 E TERMINA EM 31/05: ele
// CORTA MES nas duas pontas do calendario, e `periodoDaQuery` o manda para o
// ramo de intervalo SEM depender do parametro `cartao=fatura`. Um caso com o
// parametro existe tambem, na secao 4, porque e como o painel principal
// pergunta -- e porque e o unico caminho que usa
// `COLUNAS_DO_REALIZADO_DE_CAIXA`.
//
// TODA FIXTURE DESTA SUITE TEM UMA LINHA MARCADA E UMA NAO MARCADA
// ----------------------------------------------------------------
// Um filtro de opt-out sem as duas e o caso tipico do sobrevivente que ninguem
// ve: a assercao passa com o filtro APAGADO, porque nao ha linha marcada para
// delatar (guarda-de-ancora-verde-nao-prova-que-o-mutante-morre). E ha uma
// TERCEIRA linha, sem o campo, porque `undefined` e um estado de producao de
// verdade -- a janela entre o deploy e a colagem, e o cache offline.
// =====================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { criarDuble } from "./duble-de-supabase.mjs";

const RAIZ = "../.tmp-fora-dos-totais-nas-somas";

const FLUXO = await import(`${RAIZ}/app/api/reports/cash-flow/route.js`);
const CATEGORIAS = await import(`${RAIZ}/app/api/reports/categories/route.js`);
const MERGULHO = await import(`${RAIZ}/app/api/cash-flow/route.js`);

const { entraNosTotais, apenasNosTotais } = await import(
  `${RAIZ}/lib/fora-dos-totais.js`
);
const { resumoComPartesDeGrupo } = await import(
  `${RAIZ}/lib/parte-de-grupo-na-lista.js`
);
const { resumoDoPeriodo } = await import(`${RAIZ}/lib/movimentacoes.js`);
const { calcularGastoVariavel } = await import(`${RAIZ}/lib/variable-spend.js`);
const { COLUNAS_DA_TRANSACAO } = await import(
  `${RAIZ}/lib/services/monthly-summary.js`
);
const { COLUNAS_DO_REALIZADO_DE_CAIXA } = await import(
  `${RAIZ}/lib/realizado-do-caixa.js`
);

// ---------------------------------------------------------------------------
// 1. O DONO DO PREDICADO: os quatro estados, medidos uma vez
// ---------------------------------------------------------------------------

test("entraNosTotais: so `false` tira a linha", () => {
  assert.equal(entraNosTotais({ include_in_total: true }), true);
  assert.equal(entraNosTotais({ include_in_total: false }), false);
});

test("entraNosTotais: o campo AUSENTE soma -- e e isso que `!== false` compra", () => {
  // Os dois estados de producao em que o campo nao chega:
  //   * a janela entre o deploy e a colagem da 060 (deploy leva codigo, nao
  //     schema, e a colagem e passo manual);
  //   * uma resposta GUARDADA no aparelho de antes da feature.
  //
  // Com `=== true` ou `!linha.include_in_total` no lugar do `!== false`, estes
  // dois casos viram `false` e TODO lancamento desaparece dos totais nessas
  // janelas: o app zerado, sem erro, sem log, com o tsc verde.
  assert.equal(entraNosTotais({}), true);
  assert.equal(entraNosTotais({ include_in_total: undefined }), true);
  assert.equal(entraNosTotais({ include_in_total: null }), true);
});

test("apenasNosTotais preserva a ORDEM e nao muta a entrada", () => {
  // A ordem importa porque algumas rotas paginam e dependem de `order("id")`
  // para nao repetir nem pular linha. E a imutabilidade importa porque a MESMA
  // lista e lida mais de uma vez em /api/reports/cash-flow (uma vez por moeda):
  // mutar aqui seria efeito a distancia que nao aparece em nenhum dos leitores.
  const entrada = [
    { id: "a", include_in_total: true },
    { id: "b", include_in_total: false },
    { id: "c" },
  ];
  const copia = JSON.parse(JSON.stringify(entrada));

  const saida = apenasNosTotais(entrada);

  assert.deepEqual(
    saida.map((l) => l.id),
    ["a", "c"]
  );
  assert.deepEqual(entrada, copia, "apenasNosTotais mutou a lista recebida");
  assert.notEqual(saida, entrada, "devolveu a MESMA referencia, nao uma copia");
});

// ---------------------------------------------------------------------------
// 2. A HERANCA, CONFIRMADA E NAO SUPOSTA
// ---------------------------------------------------------------------------
// A tabela da issue diz que `resumoComPartesDeGrupo` "herda se `resumoDoPeriodo`
// for consertado -- confirmar, nao assumir". Herdar e uma propriedade da
// CHAMADA, e uma chamada pode ser trocada por uma copia da aritmetica sem que
// nada fique vermelho. Estes blocos medem a heranca pelo numero.

const despesaDeGrupo = (amount) => ({
  amount,
  transaction_type: "expense",
  paguei_eu: false,
});

test("resumoComPartesDeGrupo herda o filtro de resumoDoPeriodo", () => {
  const minhas = [
    { amount: -500, transaction_type: "expense", include_in_total: true },
    { amount: -200, transaction_type: "expense", include_in_total: false },
  ];
  const partes = [despesaDeGrupo(53.3)];

  const r = resumoComPartesDeGrupo(minhas, partes);

  // 500 das minhas linhas (a de 200 saiu) + 53,30 da parte de terceiro.
  assert.equal(r.despesas, 553.3);
  assert.notEqual(r.despesas, 753.3, "a linha desmarcada voltou pelo caminho do grupo");

  // E o CONTROLE DA HERANCA: a diferenca entre as duas funcoes e exatamente o
  // total das partes, nem um centavo a mais. Se `resumoComPartesDeGrupo`
  // passasse a somar por conta propria, este numero mudaria mesmo com o
  // `despesas` acima certo por acidente.
  assert.equal(
    Number((r.despesas - resumoDoPeriodo(minhas).despesas).toFixed(2)),
    53.3
  );
});

test("a PARTE DE GRUPO nao tem o flag, e continua contando (decisao D)", () => {
  // `group_share_entries` nao tem `include_in_total` -- a coluna e de
  // `financial_transactions`. O que eu DEVO a alguem nao muda porque quem
  // lancou escondeu a linha do relatorio dele. `undefined !== false` e `true`,
  // entao a parte atravessa; esta assercao e o que impede alguem de "consertar"
  // a assimetria achando que ela e esquecimento.
  const r = resumoComPartesDeGrupo([], [despesaDeGrupo(100)]);
  assert.equal(r.despesas, 100);
});

// ---------------------------------------------------------------------------
// 3. A MEDIANA DE GASTO: um filtro que cobre DUAS rotas
// ---------------------------------------------------------------------------
// `calcularGastoVariavel` e lido por /api/cash-flow (a data de mergulho) e por
// /api/dashboard/previsao. O filtro mora nele e nao nas rotas, para que as duas
// nao possam discordar sobre o mesmo historico.

/** 'hoje' fixo: a janela do gasto variavel conta MESES FECHADOS para tras. */
const HOJE = "2026-06-15";

const gastoEm = (mes, amount, extra = {}) => ({
  transaction_date: `${mes}-10`,
  amount,
  transaction_type: "expense",
  category_id: "mercado",
  description: `compra ${mes}`,
  ...extra,
});

test("a mediana de gasto ignora a linha desmarcada", () => {
  // Tres meses fechados com movimento e o minimo para existir mediana
  // (MIN_MESES_JANELA). Em cada mes: 100 que soma e 900 desmarcados. A mediana
  // tem de ser 100 -- com o filtro apagado ela vira 1000, e a data de mergulho
  // sai dez vezes mais cedo.
  const transacoes = [];
  for (const mes of ["2026-03", "2026-04", "2026-05"]) {
    transacoes.push(gastoEm(mes, -100, { include_in_total: true }));
    transacoes.push(gastoEm(mes, -900, { include_in_total: false }));
  }

  const g = calcularGastoVariavel({ transacoes, hoje: HOJE, meses: 3 });

  assert.equal(g.temBase, true, "a fixture precisa ter base para a medida valer");
  assert.equal(g.porMes, 100);
  assert.notEqual(g.porMes, 1000, "1000 e a mediana com o filtro apagado");
});

test("a abertura por categoria fecha com o total JA filtrado", () => {
  // O invariante do modulo e `soma(categorias.porMes) + residuoPorMes ===
  // porMes`. Um filtro aplicado ao total e nao a abertura (ou vice-versa) o
  // quebraria -- e o sintoma seria a pizza da tela nao fechar com o numero
  // grande em cima dela. As duas metades saem do MESMO laco, e este bloco e o
  // que prende isso.
  const transacoes = [];
  for (const mes of ["2026-03", "2026-04", "2026-05"]) {
    transacoes.push(gastoEm(mes, -100, { include_in_total: true }));
    transacoes.push(gastoEm(mes, -900, { include_in_total: false }));
  }

  const g = calcularGastoVariavel({ transacoes, hoje: HOJE, meses: 3 });
  const soma = g.categorias.reduce((s, c) => s + c.porMes, 0);

  assert.equal(Number((soma + g.residuoPorMes).toFixed(2)), g.porMes);
  assert.equal(g.categorias.length, 1);
  assert.equal(g.categorias[0].porMes, 100);
});

test("o gasto sem o campo entra na mediana: antes da colagem nada muda", () => {
  const transacoes = [];
  for (const mes of ["2026-03", "2026-04", "2026-05"]) {
    transacoes.push(gastoEm(mes, -100));
  }

  const g = calcularGastoVariavel({ transacoes, hoje: HOJE, meses: 3 });
  assert.equal(g.porMes, 100);
});

test("COLUNAS_DA_TRANSACAO pede include_in_total -- as tres leituras dependem", () => {
  // A lista e compartilhada por `anomaliasDoUsuario`, /api/cash-flow e
  // /api/dashboard/previsao. Sem a coluna aqui o campo chega `undefined` nas
  // TRES, o predicado deixa tudo passar, e nenhuma delas fica vermelha.
  for (const coluna of [
    "transaction_date",
    "amount",
    "transaction_type",
    "category_id",
    "description",
    "include_in_total",
  ]) {
    assert.ok(
      COLUNAS_DA_TRANSACAO.includes(coluna),
      `COLUNAS_DA_TRANSACAO perdeu ${coluna}`
    );
  }
});

test("FIACAO: anomaliasDoUsuario filtra antes de comparar com o historico", () => {
  // ASSERCAO DE FIACAO, E ELA E DECLARADA COMO TAL. `anomaliasDoUsuario` nao
  // tem sonda de comportamento em suite nenhuma deste repositorio: ela precisa
  // de um client e de `nomesDasCategorias`, e o duble cobriria a consulta sem
  // cobrir a comparacao com sete meses de historico. O que esta linha mede e
  // que a chamada EXISTE -- nao que ela esta certa.
  //
  // Ela vale porque o defeito que ela pega e caro e silencioso: um ajuste de
  // saldo desmarcado dispararia "voce gastou 3x o normal nesta categoria" POR
  // E-MAIL, no mesmo e-mail cujos totais (que saem das views da 060) nao
  // contam aquela linha. Duas frases da mesma mensagem discordando.
  const fonte = readFileSync("lib/services/monthly-summary.ts", "utf8");
  assert.match(
    fonte,
    /const transacoes = apenasNosTotais\(/,
    "anomaliasDoUsuario parou de filtrar o fora-dos-totais"
  );
  assert.match(
    fonte,
    /import \{ apenasNosTotais \} from "@\/lib\/fora-dos-totais"/,
    "o import de apenasNosTotais saiu de monthly-summary"
  );
});

// ---------------------------------------------------------------------------
// 4. AS ROTAS, PELO RAMO DE INTERVALO
// ---------------------------------------------------------------------------

const EU = "a4530000-0000-0000-0000-0000000000a1";
const CONTA = "f4530000-0000-0000-0000-0000000000a1";
const CARTAO = "f4530000-0000-0000-0000-0000000000a9";
const MERCADO = "c4530000-0000-0000-0000-000000000001";
const INVESTIMENTOS = "c4530000-0000-0000-0000-000000000002";
const SERVICO = "ffffffff-0000-0000-0000-000000000001";

/**
 * O PERIODO QUE CORTA MES -- ver a ARMADILHA DESTA FASE, no cabecalho.
 *
 * `de` NAO e dia 1, entao `periodoDaQuery` responde `modo: "intervalo"` sem que
 * a sonda precise mandar `cartao=fatura`. Com `2026-05-01` a `2026-05-31` as
 * duas rotas cairiam no ramo das views do 008, o duble devolveria lista vazia
 * para elas, e TODA assercao abaixo passaria com `0,00` e status 200 -- medindo
 * o outro ramo.
 */
const DE = "2026-04-20";
const ATE = "2026-05-31";

/** `amount` NEGATIVO na despesa, como o app grava. */
const transacao = (extra) => ({
  user_id: EU,
  service_id: SERVICO,
  account_id: CONTA,
  group_id: null,
  currency: "BRL",
  transaction_type: "expense",
  notes: null,
  counterpart_transaction_id: null,
  account: { account_type: "checking" },
  ...extra,
});

/** SOMA. 500,00 de mercado, dentro do intervalo. */
const MERCADO_QUE_SOMA = transacao({
  id: "74530000-0000-0000-0000-000000000001",
  category_id: MERCADO,
  amount: -500,
  transaction_date: "2026-05-05",
  include_in_total: true,
});

/**
 * NAO SOMA. O caso que abriu a HMO-443, do lado da despesa.
 *
 * Na categoria Investimentos de proposito: e la que o ajuste de saldo cai, e e
 * isso que faz a linha ser distinguivel TAMBEM na pizza por categoria -- nao so
 * no total.
 */
const AJUSTE_DESMARCADO = transacao({
  id: "74530000-0000-0000-0000-000000000002",
  category_id: INVESTIMENTOS,
  description: "Ajuste de saldo",
  amount: -200,
  transaction_date: "2026-05-08",
  include_in_total: false,
});

/**
 * SEM O CAMPO -- a janela entre o deploy e a colagem, dentro da fixture.
 *
 * 77,00 e um valor que nao cai por acidente em nenhuma soma parcial errada: o
 * total certo e 577,00, e os dois errados sao 777,00 (o filtro apagado) e
 * 500,00 (o `=== true` no lugar do `!== false`).
 */
const ANTIGA_SEM_CAMPO = transacao({
  id: "74530000-0000-0000-0000-000000000003",
  category_id: MERCADO,
  amount: -77,
  transaction_date: "2026-04-25",
});

/** A RECEITA desmarcada, o lado que a issue-mae descreve literalmente. */
const RECEITA_DESMARCADA = transacao({
  id: "74530000-0000-0000-0000-000000000004",
  category_id: INVESTIMENTOS,
  description: "Ajuste de saldo (receita)",
  amount: 1000,
  transaction_date: "2026-04-28",
  transaction_type: "income",
  include_in_total: false,
});

/** A receita que soma, para o lado de entrada tambem discriminar. */
const SALARIO = transacao({
  id: "74530000-0000-0000-0000-000000000005",
  category_id: MERCADO,
  description: "Salario",
  amount: 3000,
  transaction_date: "2026-04-30",
  transaction_type: "income",
  include_in_total: true,
});

/**
 * NAO SOMA, e na MESMA categoria das que somam -- e e por isso que ela existe.
 *
 * Sem ela, `Investimentos` seria a unica categoria com linha desmarcada, e a
 * assercao sobre o `transaction_count` de `Mercado` nao distinguiria NADA: 3
 * com o filtro e 3 sem ele. Com ela, o Mercado conta 3 e contaria 4 -- e e o
 * `COUNT(*) FILTER` da 060 que esta sendo reproduzido aqui.
 *
 * 123,00 nao cai por acidente em soma parcial nenhuma: 577 certo, 900 com o
 * filtro apagado, 500 com `=== true`.
 */
const MERCADO_DESMARCADO = transacao({
  id: "74530000-0000-0000-0000-000000000007",
  category_id: MERCADO,
  description: "Ajuste na categoria que soma",
  amount: -123,
  transaction_date: "2026-05-20",
  include_in_total: false,
});

const TRANSACOES = [
  MERCADO_QUE_SOMA,
  AJUSTE_DESMARCADO,
  ANTIGA_SEM_CAMPO,
  RECEITA_DESMARCADA,
  SALARIO,
  MERCADO_DESMARCADO,
];

/** A compra no cartao, desmarcada: so a secao do `cartao=fatura` a usa. */
const COMPRA_NO_CARTAO_DESMARCADA = transacao({
  id: "74530000-0000-0000-0000-000000000006",
  account_id: CARTAO,
  account: { account_type: "credit_card" },
  category_id: MERCADO,
  amount: -350,
  transaction_date: "2026-05-11",
  include_in_total: false,
});

const CATALOGO = [
  { id: MERCADO, name: "Mercado", icon: null, color_hex: null, is_expense: true },
  {
    id: INVESTIMENTOS,
    name: "Investimentos",
    icon: null,
    color_hex: null,
    is_expense: true,
  },
];

const PERFIS = [{ id: EU, preferences: { moeda: { oficial: "BRL" } } }];

/** O total certo: 500 + 77. Calculado do fixture, nao cravado. */
const DESPESA_CERTA = Number(
  TRANSACOES.filter(
    (l) => l.transaction_type === "expense" && l.include_in_total !== false
  )
    .reduce((s, l) => s + Math.abs(l.amount), 0)
    .toFixed(2)
);

/** O total COM o filtro apagado: 500 + 200 + 77. Nomeia o defeito. */
const DESPESA_SEM_FILTRO = Number(
  TRANSACOES.filter((l) => l.transaction_type === "expense")
    .reduce((s, l) => s + Math.abs(l.amount), 0)
    .toFixed(2)
);

/** O total com `=== true` no lugar do `!== false`: a linha antiga desaparece. */
const DESPESA_COM_ESTRITO = Number(
  TRANSACOES.filter(
    (l) => l.transaction_type === "expense" && l.include_in_total === true
  )
    .reduce((s, l) => s + Math.abs(l.amount), 0)
    .toFixed(2)
);

/**
 * Chama um handler com o duble instalado.
 *
 * `chamadasDeSessao > 0` e o controle positivo de
 * route-handler-roda-no-node-com-duble-de-client: se a rota trocar o jeito de
 * obter o client, o duble deixa de ser consultado, a resposta sai plausivel e
 * TODA assercao abaixo passa por vacuidade.
 */
async function chamar(rota, url, { tabelas } = {}) {
  const sessao = criarDuble({
    user: { id: EU },
    tabelas: {
      profiles: PERFIS,
      transaction_categories: CATALOGO,
      financial_transactions: TRANSACOES,
      group_share_entries: [],
      financial_services: [{ id: SERVICO, name: "personal_finance" }],
      ...tabelas,
    },
  });

  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  let resposta;
  try {
    // `nextUrl` JUNTO do `url`: as rotas de relatorio fazem `new URL(
    // request.url)` e outras leem `request.nextUrl.searchParams`
    // (sonda-de-rota-precisa-de-nexturl). Passar so um faz a rota que le o
    // outro cair no periodo corrente -- com 200 na mao e um numero de outro mes.
    resposta = await rota.GET({ url, nextUrl: new URL(url) });
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

const URL_FLUXO = `https://x/api/reports/cash-flow?de=${DE}&ate=${ATE}`;
const URL_CATEGORIAS = `https://x/api/reports/categories?de=${DE}&ate=${ATE}`;

test("CONTROLE: a fixture DISCRIMINA os tres criterios", () => {
  // Sem este bloco, um fixture em que os tres numeros coincidissem deixaria
  // toda assercao abaixo verde sem medir nada -- e a coincidencia e facil de
  // criar sem perceber (basta o valor desmarcado ser zero, ou a linha sem campo
  // cair fora do periodo).
  assert.equal(DESPESA_CERTA, 577);
  assert.equal(DESPESA_SEM_FILTRO, 900);
  assert.equal(DESPESA_COM_ESTRITO, 500);
  assert.notEqual(DESPESA_CERTA, DESPESA_SEM_FILTRO);
  assert.notEqual(DESPESA_CERTA, DESPESA_COM_ESTRITO);
});

test("Fluxo de Caixa, ramo INTERVALO: a linha desmarcada sai do total", async () => {
  const { resposta } = await chamar(FLUXO, URL_FLUXO);
  assert.equal(resposta.status, 200, await textoDoErro(resposta));

  const corpo = await resposta.json();
  assert.equal(
    corpo.summary.total_expense,
    DESPESA_CERTA,
    [
      `a despesa do intervalo tem de ser ${DESPESA_CERTA} (500 que soma + 77 sem o campo).`,
      `${DESPESA_SEM_FILTRO}: o filtro nao esta no laco de paginacao -- o ramo de`,
      "  intervalo discorda do ramo MENSAL, que a 060 ja filtrou em producao.",
      `${DESPESA_COM_ESTRITO}: `
        + "`=== true` no lugar do `!== false` -- a linha sem o campo desaparece, e",
      "  com ela TODO lancamento na janela entre o deploy e a colagem.",
    ].join("\n  ")
  );

  // A receita, pelo mesmo caminho: 3000 entra, o ajuste de 1000 nao.
  assert.equal(corpo.summary.total_income, 3000);

  // E A CONTAGEM ACOMPANHA. O filtro entra onde a 060 o pos -- no `WHERE`, e
  // nao em cada `FILTER` --, entao a linha desmarcada sai TAMBEM do
  // `transaction_count`. Tres das seis linhas somam.
  assert.equal(corpo.summary.transaction_count, 3);
});

test("as duas listas de colunas pedem include_in_total ao banco", () => {
  // POR QUE ISTO E UMA ASSERCAO SOBRE A CONSTANTE, E NAO SOBRE A CONSULTA: o
  // `lidas` do duble guarda `{ tabela, filtros, terminador }` e NAO guarda a
  // string do `select`. Mas o select ja esta medido pelo bloco anterior, por
  // outro caminho e melhor: o duble PROJETA so as colunas nomeadas
  // (duble-com-select-de-embed-projeta-undefined), entao um `select` que
  // perdesse `include_in_total` entregaria a linha SEM o campo, o predicado
  // `!== false` deixaria tudo passar, e o total do bloco acima saltaria de 577
  // para 777. O que estas duas linhas acrescentam e o NOME do defeito na
  // mensagem -- sem elas, "esperado 577, obtido 777" nao diz se o que caiu foi
  // o `select` ou o laco.
  //
  // `COLUNAS_DO_REALIZADO_DE_CAIXA` tem a mesma rede desde a fase 6: e ela que
  // o ramo de intervalo PESSOAL pede (o `URL_FLUXO` deste arquivo). Antes so o
  // painel a pedia, por `cartao=fatura`, e esta linha era a unica medida dela.
  assert.match(COLUNAS_DO_REALIZADO_DE_CAIXA, /include_in_total/);
  assert.match(COLUNAS_DA_TRANSACAO, /include_in_total/);
});

test("Categorias, ramo INTERVALO: o gemeo em JS concorda com a view", async () => {
  const { resposta } = await chamar(CATEGORIAS, URL_CATEGORIAS);
  assert.equal(resposta.status, 200, await textoDoErro(resposta));

  const corpo = await resposta.json();
  const porId = new Map(corpo.categories.map((l) => [l.category_id, l]));

  // Mercado: 500 + 77 = 577. A linha desmarcada de 123 nao entra.
  assert.equal(porId.get(MERCADO).expense, 577);

  // INVESTIMENTOS SAI DA PIZZA INTEIRA: as duas linhas dela estao desmarcadas
  // (a despesa de 200 e a receita de 1000). Uma categoria que aparecesse com
  // 0,00 seria pior que ausente -- ela ocuparia fatia zero na pizza e uma linha
  // na legenda, dizendo que ali houve gasto.
  assert.equal(porId.has(INVESTIMENTOS), false);

  // E A CONTAGEM DO MERCADO E TRES, NAO QUATRO: duas despesas que somam mais o
  // salario. A de 123 esta desmarcada e sai TAMBEM da contagem -- o
  // `transaction_count` segue o mesmo `WHERE`, como o `COUNT(*) FILTER` da 060.
  assert.equal(porId.get(MERCADO).transaction_count, 3);
  // E o salario de 3.000 continua no `income` da categoria: o flag nao muda a
  // natureza da linha, so se ela soma.
  assert.equal(porId.get(MERCADO).income, 3000);
});

test("AS DUAS ROTAS FECHAM ENTRE SI na mesma fixture", async () => {
  // O total do fluxo tem de ser igual a soma das categorias, senao a pizza do
  // painel nao fecha em 100% com o numero grande em cima dela. Esta e a
  // assercao que nenhuma das duas suites de rota sozinha pode fazer -- e e o
  // par da armadilha mensal/intervalo: duas somas certas por regras diferentes
  // continuam sendo duas somas que discordam.
  const { resposta: rf } = await chamar(FLUXO, URL_FLUXO);
  const { resposta: rc } = await chamar(CATEGORIAS, URL_CATEGORIAS);

  const fluxo = await rf.json();
  const categorias = await rc.json();

  const somaDasCategorias = Number(
    categorias.categories.reduce((s, l) => s + l.expense, 0).toFixed(2)
  );
  assert.equal(somaDasCategorias, fluxo.summary.total_expense);
});

test("faturaAte: o mes inteiro cai no ramo de intervalo, e o filtro vale la tambem", async () => {
  // A OUTRA PORTA PARA O RAMO DE INTERVALO, e e como o painel principal
  // pergunta: `faturaAte` vai em toda chamada dele, e aqui depois de `ate`,
  // que e o caso do Realizado que para antes do fim do periodo. Ate a fase 6 a
  // porta era `cartao=fatura`.
  //
  // A compra no cartao desmarcada e o caso cruzado: ela sairia do total de
  // qualquer jeito (a regra do cartao a tira para a fatura contar), entao a
  // assercao que importa aqui e sobre a CONSULTA e sobre o total das outras.
  const url = `https://x/api/reports/cash-flow?de=2026-05-01&ate=2026-05-31&faturaAte=2026-06-30`;
  const { resposta, lidas } = await chamar(FLUXO, url, {
    financial_transactions: [...TRANSACOES, COMPRA_NO_CARTAO_DESMARCADA],
  });
  assert.equal(resposta.status, 200, await textoDoErro(resposta));

  // Maio: o mercado de 500 soma, o ajuste de 200 nao, a compra no cartao de 350
  // sai pela regra da fatura. A linha de 77 e as duas de abril estao fora do
  // periodo.
  // A ASSERCAO QUE O `lidas` FOI DESTRUCTURADO PARA FAZER, E QUE FICOU PELA
  // METADE (HMO-483).
  //
  // O titulo deste caso afirma que o mes inteiro "cai no ramo de intervalo" e
  // nada aqui afirmava isso: `lidas` saia do `chamar` e nunca era conferido. O
  // lint acusava `'lidas' is assigned a value but never used`, e a saida facil
  // (`_lidas`) calaria o aviso preservando o buraco -- num teste, variavel de
  // leitura atribuida e nunca conferida costuma ser assercao que ficou pela
  // metade, nao sobra de refatoracao. O comentario no topo deste bloco ja dizia
  // qual era ("a assercao que importa aqui e sobre a CONSULTA"); faltava ela.
  //
  // O RAMO E ESCOLHIDO NA ROTA, por `periodo.modo === "intervalo" ||
  // faturaAte !== null`. Os dois ramos leem
  // lugares DIFERENTES, e e isso que torna a escolha observavel: o mensal
  // responde pela view `monthly_cash_flow`, e este soma `financial_transactions`
  // crua entre duas datas.
  //
  // ELA VEM ANTES DAS ASSERCOES DE TOTAL, E ISSO E O PONTO -- MEDIDO, NAO
  // SUPOSTO. Rodei os dois mutantes que esta assercao parecia existir para
  // pegar, e o TOTAL pega os dois primeiro:
  //
  //   a porta do `faturaAte` apagada da condicao do ramo  ->  total 0 (esperado 500)
  //   `.gte("transaction_date", periodo.de)` apagado     ->  total 577 (esperado 500)
  //
  // Ou seja: isto NAO e um detector novo, e escrever que era seria assercao que
  // mente. E um CONTROLE POSITIVO -- o mesmo papel que o `lidas` cumpre no caso
  // do `MERGULHO` logo abaixo -- e o que ele acrescenta e o NOME do defeito na
  // mensagem: "a rota nao leu financial_transactions" em vez de "esperado 500,
  // obtido 0", que nao diz se o que caiu foi o ramo, o filtro ou o laco. Posta
  // DEPOIS do total, ela nunca falaria, porque o total falha primeiro.
  //
  // O dia em que a fixture do ramo mensal ganhar linhas, os dois totais podem
  // coincidir e ela passa a ser tambem o unico detector. Hoje nao e, e o
  // comentario diz hoje.
  const consulta = lidas.find((l) => l.tabela === "financial_transactions");
  assert.ok(
    consulta,
    "a rota nao leu `financial_transactions`: `faturaAte` nao levou ao ramo " +
      "de intervalo, e o total abaixo seria medido sobre outro caminho"
  );
  assert.ok(
    consulta.filtros.some(([op, coluna]) => op === "gte" && coluna === "transaction_date"),
    "a leitura de `financial_transactions` nao tem `gte` em `transaction_date` -- " +
      `o recorte do periodo nao chegou a consulta (filtros: ${JSON.stringify(
        consulta.filtros
      )})`
  );

  const corpo = await resposta.json();
  assert.equal(corpo.summary.total_expense, 500);
  assert.notEqual(
    corpo.summary.total_expense,
    823,
    "os dois ajustes desmarcados de maio (200 + 123) voltaram"
  );
});

test("a data de mergulho le a lista pela constante compartilhada", async () => {
  // /api/cash-flow le `COLUNAS_DA_TRANSACAO` e passa a lista para
  // `calcularGastoVariavel`, que e quem filtra. A mediana em si ja esta medida
  // na secao 3, com fixture de tres meses fechados; o que falta e o CONTROLE
  // POSITIVO de que esta rota chega ate a consulta -- sem ele, a secao 3
  // mediria uma funcao que a rota deixou de chamar.
  const { resposta, lidas } = await chamar(MERGULHO, "https://x/api/cash-flow");
  assert.equal(resposta.status, 200, await textoDoErro(resposta));

  const consulta = lidas.find((l) => l.tabela === "financial_transactions");
  assert.ok(
    consulta,
    "a rota nao consultou financial_transactions -- a secao 3 mede uma funcao orfa"
  );

  const corpo = await resposta.json();
  assert.ok(
    corpo.variable_spend,
    "a rota nao devolveu variable_spend: o calculo nao chegou na resposta"
  );
});
