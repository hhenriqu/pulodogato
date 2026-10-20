#!/usr/bin/env node
// =====================================================
// PULODOGATO - as rotas de investimento aprendem a conta (HMO-436)
// =====================================================
//   npm run test:conta-do-ativo
//
// A migration 059 criou `investment_assets.account_id`. Esta fase e o lado do
// app: as duas rotas de ESCRITA passam a aceitar o elo com validacao propria, e
// as duas de LEITURA passam a devolve-lo e a aceitar `?account_id=` para
// recortar.
//
// POR QUE A VALIDACAO NA ROTA, SE A TRIGGER DA 059 JA RECUSA
// ---------------------------------------------------------
// Pela mensagem. A trigger levanta `check_violation` falando de nome de
// constraint, e a rota devolveria isso como 500 "Erro ao cadastrar ativo: ...".
// Quem escolheu uma conta num `<select>` precisa ler "essa conta e corrente";
// 500 manda o cliente tentar de novo, o que nunca vai funcionar. Os casos
// `400 ... NAO ESCREVE NADA` abaixo sao o que prova que a conferencia acontece
// ANTES do INSERT -- se ela tivesse ficado depois, a escrita teria acontecido e
// `escritas` nao estaria vazia.
//
// O QUE ESTA SUITE NAO MEDE, E QUEM MEDE
// --------------------------------------
// Que o BANCO tambem recuse (a ultima linha de defesa, e a janela de corrida
// entre o SELECT da conferencia e o INSERT) e provado contra um Postgres de
// verdade em database/tests/059_ativo_ligado_a_conta.sql, que veio com a
// migration. As duas metades sao necessarias: sem a de SQL, esta suite estaria
// afirmando que a rota reage certo a uma regra que ninguem conferiu que o banco
// aplica; sem esta, a regra existiria no banco com a rota traduzindo-a em 500.
//
// A REGRA QUE ESTA FASE NAO PODE QUEBRAR, E COMO ELA E MEDIDA
// -----------------------------------------------------------
// `/api/investments` e proibida de falar com o Banco Central. Ela existe para
// os quatro numeros da tela sairem do mesmo par de leituras, e um timeout do
// SGS nao pode derrubar a carteira de quem nao tem renda fixa nenhuma. Isso se
// mede por AUSENCIA, e ausencia nao se mede com teste de comportamento: o
// ultimo bloco le o EMIT das duas rotas e exige que a da carteira nao
// referencie lib/cdi e que a da renda fixa referencie -- o controle positivo,
// sem o qual um criterio que parou de casar passaria verde nas duas.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { criarDuble } from "./duble-de-supabase.mjs";

const ROTA_ASSETS = await import(
  "../.tmp-conta-do-ativo/app/api/investments/assets/route.js"
);
const ROTA_ASSET = await import(
  "../.tmp-conta-do-ativo/app/api/investments/assets/[assetId]/route.js"
);
const ROTA_CARTEIRA = await import(
  "../.tmp-conta-do-ativo/app/api/investments/route.js"
);
const ROTA_RENDA_FIXA = await import(
  "../.tmp-conta-do-ativo/app/api/investments/renda-fixa/route.js"
);

const DONO = "helio";
const OUTRO = "estranho";

// Os uuids sao de forma VALIDA de proposito: a rota recusa `account_id`
// malformado antes de consultar o banco, e um fixture com id tipo "conta-1"
// faria todo caso de conta valida reprovar no 400 de forma -- verde pelo motivo
// errado seria ainda pior.
const CLEAR = "11111111-1111-4111-8111-111111111111";
const XP = "22222222-2222-4222-8222-222222222222";
const NUBANK = "33333333-3333-4333-8333-333333333333";
const DO_ESTRANHO = "44444444-4444-4444-8444-444444444444";
const NAO_EXISTE = "99999999-9999-4999-8999-999999999999";

/**
 * As contas do fixture. `NUBANK` e `checking` -- e ela que distingue "conta que
 * nao e sua" de "conta que nao e de investimento", os dois 400 que a issue
 * cobra separadamente.
 *
 * A conta do estranho esta aqui, e nao ausente: sem ela, o caso da conta de
 * outro dono passaria verde pelo mesmo caminho do uuid inexistente, e o `.eq`
 * de `user_id` da conferencia poderia ser apagado sem nenhum teste reclamar.
 */
function contas() {
  return [
    { id: CLEAR, user_id: DONO, name: "Clear", account_type: "investment" },
    { id: XP, user_id: DONO, name: "XP", account_type: "investment" },
    { id: NUBANK, user_id: DONO, name: "Nubank", account_type: "checking" },
    {
      id: DO_ESTRANHO,
      user_id: OUTRO,
      name: "Corretora do estranho",
      account_type: "investment",
    },
  ];
}

/** Um pedido que serve para as duas familias de rota -- ver a memoria do shim. */
const pedido = (url, body) => ({
  url,
  nextUrl: new URL(url),
  json: () => Promise.resolve(body),
});

function montar({ user = { id: DONO }, tabelas = {}, ...resto } = {}) {
  const d = criarDuble({
    user,
    tabelas: { financial_accounts: contas(), ...tabelas },
    ...resto,
  });
  globalThis.__dubleDeSupabase = {
    sessao: () => d.client,
    servico: () => d.client,
  };
  return d;
}

function desmontar() {
  delete globalThis.__dubleDeSupabase;
}

// ---------------------------------------------------------------------------
// POST /api/investments/assets -- cadastrar ja atrelado
// ---------------------------------------------------------------------------

const ATIVO_BASE = { symbol: "PETR4", name: "Petrobras PN", type: "stock" };

async function postar(body, opcoes) {
  const d = montar({ tabelas: { investment_assets: [] }, ...opcoes });
  try {
    const r = await ROTA_ASSETS.POST(
      pedido("https://x/api/investments/assets", { ...ATIVO_BASE, ...body })
    );
    return { d, status: r.status, corpo: await r.json() };
  } finally {
    desmontar();
  }
}

test("POST sem conta nenhuma: 201, e o ativo nasce SOLTO", async () => {
  const { d, status, corpo } = await postar({});

  assert.equal(status, 201, JSON.stringify(corpo));
  assert.equal(d.escritas.length, 1);

  // A chave nem vai no payload. `account_id: null` daria no mesmo no banco (o
  // default da coluna e nulo), e a assercao e sobre a chave AUSENTE porque e ela
  // que mantem o INSERT desta rota identico ao de antes desta fase para quem nao
  // usa a feature -- o estado de 100% dos ativos de producao.
  assert.equal(
    "account_id" in d.escritas[0].linhas[0],
    false,
    "quem nao mandou conta nao devia ter `account_id` no INSERT"
  );
});

test("POST com conta de investimento do dono: 201 e o elo chega ao banco", async () => {
  const { d, status, corpo } = await postar({ accountId: CLEAR });

  assert.equal(status, 201, JSON.stringify(corpo));
  assert.equal(d.escritas[0].linhas[0].account_id, CLEAR);
});

test("POST aceita a grafia account_id tambem, com o MESMO efeito", async () => {
  const { d, status } = await postar({ account_id: CLEAR });

  assert.equal(status, 201);
  assert.equal(d.escritas[0].linhas[0].account_id, CLEAR);
});

test("POST com as duas grafias discordando: 400, nada escrito", async () => {
  const { d, status, corpo } = await postar({
    accountId: CLEAR,
    account_id: XP,
  });

  assert.equal(status, 400);
  assert.match(corpo.error, /valores diferentes/i);
  assert.deepEqual(d.escritas, []);
});

test("POST com conta de OUTRO dono: 400 explicado, e NAO ESCREVE NADA", async () => {
  const { d, status, corpo } = await postar({ accountId: DO_ESTRANHO });

  assert.equal(status, 400, JSON.stringify(corpo));
  assert.match(corpo.error, /nao encontrada/i);
  // A prova de que a conferencia roda ANTES do INSERT. Com ela depois, a linha
  // teria nascido e a trigger da 059 teria recusado -- 500, nao 400.
  assert.deepEqual(d.escritas, []);
});

test("POST com conta CHECKING: 400 que NOMEIA a conta, e nao escreve nada", async () => {
  const { d, status, corpo } = await postar({ accountId: NUBANK });

  assert.equal(status, 400, JSON.stringify(corpo));
  assert.match(corpo.error, /Nubank/);
  assert.match(corpo.error, /Conta Investimento/i);
  assert.deepEqual(d.escritas, []);

  // E a mensagem tem de ser DISTINGUIVEL da de conta inexistente: as duas
  // levam o usuario a acoes diferentes (escolher outra conta vs. criar a conta),
  // e colapsar as duas num texto so e o defeito de
  // `mensagem-de-erro-unica-para-dois-estados`.
  const outra = await postar({ accountId: NAO_EXISTE });
  assert.equal(outra.status, 400);
  assert.notEqual(outra.corpo.error, corpo.error);
});

test("POST com conta inexistente: 400, nada escrito", async () => {
  const { d, status, corpo } = await postar({ accountId: NAO_EXISTE });

  assert.equal(status, 400);
  assert.match(corpo.error, /nao encontrada/i);
  assert.deepEqual(d.escritas, []);
});

test("POST com account_id malformado: 400 antes de consultar o banco", async () => {
  const { d, status, corpo } = await postar({ accountId: "abc" });

  assert.equal(status, 400, JSON.stringify(corpo));
  assert.deepEqual(d.escritas, []);
  // Nao chegou a perguntar nada a `financial_accounts`: um uuid malformado no
  // PostgREST responde `22P02`, que a rota leria como erro de banco e devolveria
  // como 500.
  assert.equal(
    d.lidas.some((l) => l.tabela === "financial_accounts"),
    false
  );
});

test('POST com account_id "" (o <select> em "nenhuma"): 201 e ativo solto', async () => {
  const { d, status } = await postar({ accountId: "" });

  assert.equal(status, 201);
  assert.equal(d.escritas[0].linhas[0].account_id, null);
});

test("POST: falha de banco na conferencia da conta e 500, nao 400", async () => {
  // O `error` da conferencia e LIDO. Nao ler e o defeito da HMO-145: `data` vem
  // null, o codigo conclui "nao achei" e devolve uma mensagem de usuario para
  // o que e uma falha de infraestrutura.
  const { d, status, corpo } = await postar(
    { accountId: CLEAR },
    { erros: { financial_accounts: { message: "connection reset" } } }
  );

  assert.equal(status, 500, JSON.stringify(corpo));
  assert.match(corpo.error, /conferir a conta/i);
  assert.deepEqual(d.escritas, []);
});

// ---------------------------------------------------------------------------
// PATCH /api/investments/assets/:assetId -- atrelar e SOLTAR
// ---------------------------------------------------------------------------

const ATIVO_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATIVO_VIZINHO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * O ativo do dono e um VIZINHO. O vizinho nao e decoracao: sem ele, "esta linha"
 * e "todas as linhas" sao o mesmo conjunto, e o `.eq("id")` do UPDATE poderia
 * ser apagado sem nenhum teste reclamar.
 */
function ativos() {
  return [
    {
      id: ATIVO_ID,
      user_id: DONO,
      symbol: "PETR4",
      name: "Petrobras PN",
      type: "stock",
      account_id: null,
    },
    {
      id: ATIVO_VIZINHO,
      user_id: DONO,
      symbol: "VALE3",
      name: "Vale ON",
      type: "stock",
      account_id: XP,
    },
  ];
}

async function patchar(body) {
  const d = montar({ tabelas: { investment_assets: ativos() } });
  try {
    const r = await ROTA_ASSET.PATCH(
      pedido(`https://x/api/investments/assets/${ATIVO_ID}`, body),
      { params: { assetId: ATIVO_ID } }
    );
    return { d, status: r.status, corpo: await r.json() };
  } finally {
    desmontar();
  }
}

test("PATCH atrela o ativo SOLTO a uma conta: 200 e o elo no patch", async () => {
  const { d, status, corpo } = await patchar({ accountId: CLEAR });

  assert.equal(status, 200, JSON.stringify(corpo));
  assert.equal(d.escritas.length, 1);
  assert.equal(d.escritas[0].patch.account_id, CLEAR);
});

test("PATCH com account_id NULL SOLTA o ativo -- e o null chega ao banco", async () => {
  const { d, status, corpo } = await patchar({ accountId: null });

  assert.equal(status, 200, JSON.stringify(corpo));
  // A chave tem de estar PRESENTE e valer null. Um `if (elo.account_id)` em vez
  // de `if (elo.presente)` confundiria "nao pediu" com "pediu para soltar", e o
  // sintoma seria um botao "desatrelar" que responde 200 e nao desatrela nada.
  assert.equal("account_id" in d.escritas[0].patch, true);
  assert.equal(d.escritas[0].patch.account_id, null);
});

test("PATCH so com a conta NAO cai em 'Nada para atualizar'", async () => {
  // A travessa de `Object.keys(patch).length === 0` existia antes do elo. Se o
  // elo fosse lido DEPOIS dela, atrelar seria impossivel pela rota -- 400 numa
  // chamada perfeitamente valida, que e o modo de falha mais facil de introduzir
  // aqui.
  const { status, corpo } = await patchar({ accountId: XP });
  assert.equal(status, 200, JSON.stringify(corpo));
});

test("PATCH com conta de outro dono: 400, e o ativo fica intacto", async () => {
  const { d, status, corpo } = await patchar({ accountId: DO_ESTRANHO });

  assert.equal(status, 400, JSON.stringify(corpo));
  assert.deepEqual(d.escritas, []);
});

test("PATCH com conta checking: 400 que nomeia a conta, sem escrever", async () => {
  const { d, status, corpo } = await patchar({ accountId: NUBANK });

  assert.equal(status, 400, JSON.stringify(corpo));
  assert.match(corpo.error, /Nubank/);
  assert.deepEqual(d.escritas, []);
});

test("PATCH sem tocar em conta nenhuma continua funcionando como antes", async () => {
  const { d, status, corpo } = await patchar({ currentPrice: 38.5 });

  assert.equal(status, 200, JSON.stringify(corpo));
  assert.equal(d.escritas[0].patch.current_price, 38.5);
  assert.equal(
    "account_id" in d.escritas[0].patch,
    false,
    "quem nao falou de conta nao devia ter o elo mexido"
  );
});

// ---------------------------------------------------------------------------
// GET /api/investments -- o recorte, e a carteira inteira de sempre
// ---------------------------------------------------------------------------

/**
 * Tres ativos em tres estados: um na Clear, um na XP, um solto. Os tres estados
 * em todo fixture de leitura -- com dois, o recorte por conta e o recorte por
 * "soltos" nao se distinguem de "devolveu tudo".
 */
function carteira() {
  return [
    { id: "a-clear", user_id: DONO, symbol: "AAAA", name: "Na Clear", type: "stock", account_id: CLEAR, current_price: 10 },
    { id: "a-xp", user_id: DONO, symbol: "BBBB", name: "Na XP", type: "stock", account_id: XP, current_price: 10 },
    { id: "a-solto", user_id: DONO, symbol: "CCCC", name: "Solto", type: "stock", account_id: null, current_price: 10 },
  ];
}

function lancamentos() {
  return [
    { id: "l-1", user_id: DONO, asset_id: "a-clear", kind: "buy", quantity: 10, unit_price: 5, fees: 0, trade_date: "2026-01-10" },
    { id: "l-2", user_id: DONO, asset_id: "a-xp", kind: "buy", quantity: 20, unit_price: 5, fees: 0, trade_date: "2026-02-10" },
    { id: "l-3", user_id: DONO, asset_id: "a-solto", kind: "buy", quantity: 30, unit_price: 5, fees: 0, trade_date: "2026-03-10" },
  ];
}

async function pegarCarteira(query = "") {
  const d = montar({
    tabelas: {
      investment_assets: carteira(),
      investment_transactions: lancamentos(),
    },
  });
  try {
    const r = await ROTA_CARTEIRA.GET(
      pedido(`https://x/api/investments${query}`)
    );
    return { d, status: r.status, corpo: await r.json() };
  } finally {
    desmontar();
  }
}

test("GET sem ?account_id: a carteira INTEIRA, como antes desta fase", async () => {
  const { d, status, corpo } = await pegarCarteira();

  assert.equal(status, 200, JSON.stringify(corpo));
  assert.equal(corpo.assets.length, 3);
  assert.equal(corpo.transactions.length, 3);

  // E a consulta de lancamentos fica IDENTICA a de antes: sem `.in`. Mandar a
  // lista de todos os ativos do usuario trocaria uma consulta simples por uma
  // URL que cresce com a carteira.
  const leituraDeLancamentos = d.lidas.filter(
    (l) => l.tabela === "investment_transactions"
  );
  assert.equal(leituraDeLancamentos.length, 1);
  assert.equal(
    leituraDeLancamentos[0].filtros.some((f) => f[0] === "in"),
    false
  );
});

test("GET devolve account_id em cada ativo -- a Fase 3 depende disso", async () => {
  const { corpo } = await pegarCarteira();
  const porSymbol = {};
  for (const a of corpo.assets) porSymbol[a.symbol] = a;

  assert.equal(porSymbol.AAAA.account_id, CLEAR);
  assert.equal(porSymbol.CCCC.account_id, null);
});

test("GET ?account_id=<conta> recorta os ativos E os lancamentos", async () => {
  const { status, corpo } = await pegarCarteira(`?account_id=${CLEAR}`);

  assert.equal(status, 200, JSON.stringify(corpo));
  assert.deepEqual(
    corpo.assets.map((a) => a.symbol),
    ["AAAA"]
  );

  // O recorte vale para os lancamentos tambem. Recortar so os ativos deixaria
  // `evolution` e `summary` (que saem dos LANCAMENTOS) falando da carteira
  // toda ao lado da lista de uma conta -- um grafico que nao fecha com a tabela
  // embaixo dele, e nenhuma excecao em lugar nenhum.
  assert.deepEqual(
    corpo.transactions.map((l) => l.asset_id),
    ["a-clear"]
  );
  assert.equal(corpo.evolution.length > 0, true);
  // 10 cotas a 5 = 50 investidos, e so os desta conta. Sem o recorte nos
  // lancamentos este numero seria 300 (os tres ativos), que e exatamente o
  // vazamento que a assercao existe para pegar.
  assert.equal(corpo.summary.totalInvested, 50);
});

test('GET ?account_id=none devolve os SOLTOS, nao "tudo"', async () => {
  const { status, corpo } = await pegarCarteira("?account_id=none");

  assert.equal(status, 200, JSON.stringify(corpo));
  assert.deepEqual(
    corpo.assets.map((a) => a.symbol),
    ["CCCC"]
  );
  assert.deepEqual(
    corpo.transactions.map((l) => l.asset_id),
    ["a-solto"]
  );
});

test("GET ?account_id= VAZIO e 400, e nao a carteira inteira", async () => {
  // A resposta errada mais perigosa desta rota: quem pediu um pedaco recebendo
  // tudo, com 200 e lista cheia. Nada nessa resposta parece errado, e o numero
  // que a tela soma passa a ser de todas as contas.
  const { status, corpo } = await pegarCarteira("?account_id=");

  assert.equal(status, 400, JSON.stringify(corpo));
  assert.equal(corpo.assets, undefined);
});

test("GET ?account_id=abc e 400, nao 500 de banco", async () => {
  const { d, status, corpo } = await pegarCarteira("?account_id=abc");

  assert.equal(status, 400, JSON.stringify(corpo));
  assert.equal(
    d.lidas.some((l) => l.tabela === "investment_assets"),
    false,
    "uuid malformado nao devia nem chegar ao banco (22P02 viraria 500)"
  );
});

test("GET com recorte em conta VAZIA: 200 com a forma de sempre", async () => {
  const { d, status, corpo } = await pegarCarteira(`?account_id=${NAO_EXISTE}`);

  assert.equal(status, 200, JSON.stringify(corpo));
  assert.deepEqual(corpo.assets, []);
  assert.deepEqual(corpo.positions, []);
  assert.equal(corpo.summary.totalInvested, 0);
  assert.deepEqual(corpo.evolution, []);
  // E nem perguntou pelos lancamentos: `.in("asset_id", [])` nao e uma pergunta
  // que valha fazer ao banco.
  assert.equal(
    d.lidas.some((l) => l.tabela === "investment_transactions"),
    false
  );
});

// ---------------------------------------------------------------------------
// GET /api/investments/renda-fixa -- o mesmo recorte, e o elo na projecao
// ---------------------------------------------------------------------------

function rendaFixa() {
  const base = {
    user_id: DONO,
    type: "fixed_income",
    currency: "BRL",
    fixed_income_product: "cdb",
    index_kind: null,
    index_percentage: null,
    spread_annual: null,
    applied_date: null,
    maturity_date: null,
    current_price: null,
  };
  return [
    { ...base, id: "rf-clear", symbol: "CDB-CLEAR", name: "CDB na Clear", account_id: CLEAR },
    { ...base, id: "rf-solto", symbol: "CDB-SOLTO", name: "CDB solto", account_id: null },
  ];
}

async function pegarRendaFixa(query = "") {
  const d = montar({
    tabelas: {
      investment_assets: rendaFixa(),
      investment_transactions: [],
    },
  });
  try {
    const r = await ROTA_RENDA_FIXA.GET(
      pedido(`https://x/api/investments/renda-fixa${query}`)
    );
    return { d, status: r.status, corpo: await r.json() };
  } finally {
    desmontar();
  }
}

test("renda-fixa: cada projecao carrega o account_id do ativo", async () => {
  const { status, corpo } = await pegarRendaFixa();

  assert.equal(status, 200, JSON.stringify(corpo));
  assert.equal(corpo.projections.length, 2);
  const porSymbol = {};
  for (const p of corpo.projections) porSymbol[p.symbol] = p;
  assert.equal(porSymbol["CDB-CLEAR"].account_id, CLEAR);
  assert.equal(porSymbol["CDB-SOLTO"].account_id, null);
});

test("renda-fixa ?account_id=<conta> recorta", async () => {
  const { status, corpo } = await pegarRendaFixa(`?account_id=${CLEAR}`);

  assert.equal(status, 200, JSON.stringify(corpo));
  assert.deepEqual(
    corpo.projections.map((p) => p.symbol),
    ["CDB-CLEAR"]
  );
});

test("renda-fixa ?account_id=none devolve so os soltos", async () => {
  const { corpo } = await pegarRendaFixa("?account_id=none");

  assert.deepEqual(
    corpo.projections.map((p) => p.symbol),
    ["CDB-SOLTO"]
  );
});

test("renda-fixa ?account_id= vazio e 400", async () => {
  const { status } = await pegarRendaFixa("?account_id=");
  assert.equal(status, 400);
});

// ---------------------------------------------------------------------------
// A regra que esta fase nao pode quebrar, medida no EMIT
// ---------------------------------------------------------------------------

const emit = (caminho) =>
  readFileSync(new URL(`../.tmp-conta-do-ativo/${caminho}`, import.meta.url), "utf8");

test("/api/investments NAO fala com o Banco Central (e a renda fixa fala)", () => {
  const carteiraJs = emit("app/api/investments/route.js");
  const rendaFixaJs = emit("app/api/investments/renda-fixa/route.js");

  // O controle POSITIVO vem primeiro de proposito. Sem ele, um criterio que
  // parasse de casar (o arquivo de cdi renomeado, o import virando dinamico)
  // imprimiria o mesmo verde nas duas rotas, e esta assercao passaria a nao
  // medir nada -- `guarda-de-ancora-verde-nao-prova-que-o-mutante-morre`.
  assert.match(
    rendaFixaJs,
    /lib\/cdi/,
    "a rota de renda fixa deveria importar lib/cdi -- o criterio desta assercao morreu"
  );

  assert.equal(
    /lib\/cdi/.test(carteiraJs),
    false,
    "GET /api/investments passou a importar lib/cdi: um timeout do SGS agora " +
      "derruba a carteira de quem nao tem renda fixa nenhuma"
  );
});
