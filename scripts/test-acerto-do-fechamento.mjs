// =====================================================
// PULODOGATO - o acerto que da baixa nas contas do fechamento (RN019, fase 3)
// =====================================================
//   npm run test:acerto-do-fechamento
//
// A 068 faz o acerto quitar, nos dois lados, as contas que o fechamento do
// grupo gerou -- e o banco prova isso em
// database/tests/068_acerto_que_da_baixa_test.sql. O que o banco nao alcanca,
// e esta suite mede, e o que fica em volta dele:
//
//   1. QUEM PAGA QUEM (lib/acerto-do-fechamento.ts). A tela sugere os Pix a
//      partir das contas em aberto. Um par entre duas pessoas que nao tem conta
//      a pagar e a receber registraria dinheiro sem quitar nada; um par que
//      somasse em float deixaria R$ 0,01 pendurado para sempre;
//   2. AS ROTAS QUE RECUSAM A CONTA GERADA. A baixa comum, a edicao, o excluir
//      e o "Ja lancei: vincular" respondem 409 com a frase que diz o que fazer
//      -- sem escrever nada. O trigger da 068 recusaria do mesmo jeito, mas
//      como um 500 sem explicacao, e no caso do vinculo DEPOIS de a rota ja ter
//      lido o lancamento;
//   3. O DESFAZER DO ACERTO QUE JA ENTROU NUM FECHAMENTO. O banco recusa o
//      DELETE da quitacao, mas so DEPOIS de a rota ter apagado a perna: sem a
//      conferencia antes, o dinheiro voltaria para a conta e a divida
//      continuaria dada como paga;
//   4. O FECHAMENTO DO PERIODO devolve o que esta em aberto e os pares.
//
// Cada bloco tem o CONTROLE junto: a mesma chamada sem a condicao, que tem de
// seguir outro caminho. Sem isso, "respondeu 409" passaria verde numa rota que
// respondesse 409 para tudo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { criarDuble } from "./duble-de-supabase.mjs";

const RAIZ = "../.tmp-acerto-do-fechamento";

const { emAbertoPorMembro, paresDoAcerto } = await import(
  `${RAIZ}/lib/acerto-do-fechamento.js`
);
const { ehContaDoFechamento, MENSAGEM_DA_CONTA_DO_FECHAMENTO } = await import(
  `${RAIZ}/lib/conta-do-fechamento.js`
);
const ROTA_PAY = await import(`${RAIZ}/app/api/scheduled-transactions/[id]/pay/route.js`);
const ROTA_PREVISTA = await import(`${RAIZ}/app/api/scheduled-transactions/[id]/route.js`);
const ROTA_VINCULAR = await import(
  `${RAIZ}/app/api/scheduled-transactions/[id]/vincular/route.js`
);
const ROTA_DESFAZER = await import(
  `${RAIZ}/app/api/expense-groups/[groupId]/settlements/[id]/route.js`
);
const ROTA_FECHAMENTO = await import(
  `${RAIZ}/app/api/expense-groups/[groupId]/fechamento-do-periodo/route.js`
);

const HELIO = "11111111-1111-1111-1111-111111111111";
const LAIS = "22222222-2222-2222-2222-222222222222";
const LETICIA = "33333333-3333-3333-3333-333333333333";
const CASA = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const FECHAMENTO = "f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0";

const conta = (user_id, tipo, aberto, extra = {}) => ({
  closing_id: FECHAMENTO,
  period_end: "2026-10-09",
  user_id,
  tipo,
  valor: aberto,
  quitado: 0,
  aberto,
  ...extra,
});

const soma = (pares) =>
  pares.reduce((s, p) => s + Math.round(p.valor * 100), 0) / 100;

// -----------------------------------------------------
// 1. Quem paga quem
// -----------------------------------------------------
test("o exemplo da 068: a Leticia deve as duas, e paga cada uma pelo que ela tem a receber", () => {
  // Depois da compensacao do teste do banco (S10b): Helio tem 200 a receber,
  // Lais 120, Leticia duas contas a pagar de 200 e 120.
  const contas = [
    conta(HELIO, "income", 200),
    conta(LAIS, "income", "120.00"),
    conta(LETICIA, "expense", 200),
    conta(LETICIA, "expense", "120.00", { closing_id: "outro-fechamento" }),
  ];

  assert.deepEqual(emAbertoPorMembro(contas), [
    { user_id: LETICIA, saldo: -320 },
    { user_id: LAIS, saldo: 120 },
    { user_id: HELIO, saldo: 200 },
  ]);
  // Controle: sem somar as duas contas da Leticia, ela apareceria duas vezes e
  // os pares seriam tres, um deles pagando so parte de uma conta.
  assert.deepEqual(paresDoAcerto(contas), [
    { de_user_id: LETICIA, para_user_id: HELIO, valor: 200 },
    { de_user_id: LETICIA, para_user_id: LAIS, valor: 120 },
  ]);
});

test("os pares fecham no centavo: o que sai e exatamente o que entra", () => {
  // R$ 100 em tercos: 66,67 a receber, 33,34 e 33,33 a pagar.
  const contas = [
    conta(HELIO, "income", "66.67"),
    conta(LAIS, "expense", "33.34"),
    conta(LETICIA, "expense", "33.33"),
  ];
  const pares = paresDoAcerto(contas);
  assert.deepEqual(pares, [
    { de_user_id: LAIS, para_user_id: HELIO, valor: 33.34 },
    { de_user_id: LETICIA, para_user_id: HELIO, valor: 33.33 },
  ]);
  // Controle: somando em float, 33.34 + 33.33 da 66.66999999999999.
  assert.equal(soma(pares), 66.67);
});

test("o maior devedor paga o maior credor, e N pessoas fecham em no maximo N - 1 Pix", () => {
  const A = "a", B = "b", C = "c", D = "d", E = "e";
  const contas = [
    conta(A, "expense", 500),
    conta(B, "expense", 300),
    conta(C, "expense", 100),
    conta(D, "income", 600),
    conta(E, "income", 300),
  ];
  const pares = paresDoAcerto(contas);
  assert.deepEqual(pares, [
    { de_user_id: A, para_user_id: D, valor: 500 },
    { de_user_id: B, para_user_id: D, valor: 100 },
    { de_user_id: B, para_user_id: E, valor: 200 },
    { de_user_id: C, para_user_id: E, valor: 100 },
  ]);
  assert.ok(pares.length <= 4);
  assert.equal(soma(pares), 900);
});

test("quem tem os dois lados abertos entra pelo liquido, e nunca paga a si mesmo", () => {
  // Banco sem a compensacao: o Helio deve 50 e tem 200 a receber.
  const contas = [
    conta(HELIO, "expense", 50),
    conta(HELIO, "income", 200),
    conta(LAIS, "expense", 150),
  ];
  assert.deepEqual(emAbertoPorMembro(contas), [
    { user_id: LAIS, saldo: -150 },
    { user_id: HELIO, saldo: 150 },
  ]);
  const pares = paresDoAcerto(contas);
  assert.deepEqual(pares, [{ de_user_id: LAIS, para_user_id: HELIO, valor: 150 }]);
  // Controle: tratando cada conta por si, sairia Helio -> Helio 50.
  assert.ok(pares.every((p) => p.de_user_id !== p.para_user_id));
});

test("conta quitada, de valor zero ou de tipo estranho nao entra; quem empata some", () => {
  const contas = [
    conta(HELIO, "income", 0),
    conta(LAIS, "expense", "0.00"),
    conta(LETICIA, "transfer", 80),
    conta(HELIO, "expense", 40),
    conta(HELIO, "income", 40),
  ];
  assert.deepEqual(emAbertoPorMembro(contas), []);
  assert.deepEqual(paresDoAcerto(contas), []);
  assert.deepEqual(paresDoAcerto([]), []);
});

test("se o que se deve e o que se recebe nao empatam, os pares param no menor", () => {
  // Nao deveria acontecer (a baixa e simetrica), e por isso mesmo a tela nao
  // pode inventar um Pix que nao quita conta nenhuma.
  const contas = [
    conta(LAIS, "expense", 100),
    conta(LETICIA, "expense", 40),
    conta(HELIO, "income", 60),
  ];
  const pares = paresDoAcerto(contas);
  assert.deepEqual(pares, [{ de_user_id: LAIS, para_user_id: HELIO, valor: 60 }]);
  assert.equal(soma(pares), 60);
});

test("ehContaDoFechamento: so a conta que tem fechamento", () => {
  assert.equal(ehContaDoFechamento({ group_closing_id: FECHAMENTO }), true);
  assert.equal(ehContaDoFechamento({ group_closing_id: null }), false);
  assert.equal(ehContaDoFechamento({}), false);
  assert.equal(ehContaDoFechamento(null), false);
  assert.equal(ehContaDoFechamento(undefined), false);
});

// -----------------------------------------------------
// 2. As rotas que recusam a conta gerada
// -----------------------------------------------------
const PREVISTA = "prevista-1";

/** A conta "Pagamento ao grupo" da Lais, ou uma conta comum com os mesmos dados. */
function prevista({ geradaPeloFechamento = true, status = "pending" } = {}) {
  return {
    id: PREVISTA,
    user_id: LAIS,
    description: "Pagamento ao grupo Casa",
    amount: 100,
    due_date: "2026-10-09",
    status,
    direction: "expense",
    category_id: null,
    account_id: null,
    notes: null,
    recurring_rule_id: null,
    paid_date: null,
    transaction_id: null,
    group_closing_id: geradaPeloFechamento ? FECHAMENTO : null,
    recurring_rule: null,
  };
}

/** Chama um handler com o duble da Lais e devolve `{ status, corpo, escritas }`. */
async function chamar(handler, { tabelas, corpo = {}, params }) {
  const d = criarDuble({ user: { id: LAIS }, tabelas });
  globalThis.__dubleDeSupabase = { sessao: () => d.client };
  let resposta;
  try {
    resposta = await handler({ json: async () => corpo }, { params });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }
  return { status: resposta.status, corpo: await resposta.json(), escritas: d.escritas, lidas: d.lidas };
}

const daPrevista = (opcoes) => {
  const linha = prevista(opcoes);
  return {
    scheduled_transactions: [linha],
    // A view da 027 nao traz `group_closing_id`: o vinculo tem de ler a tabela.
    scheduled_transactions_effective: [{ ...linha, group_closing_id: undefined }],
    financial_transactions: [],
  };
};

test("a baixa comum recusa a conta gerada com a frase do acerto, e nao grava nada", async () => {
  const r = await chamar(ROTA_PAY.POST, {
    tabelas: daPrevista(),
    corpo: { paid_date: "2026-10-09" },
    params: { id: PREVISTA },
  });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.error, MENSAGEM_DA_CONTA_DO_FECHAMENTO);
  assert.deepEqual(r.escritas, []);
});

test("CONTROLE: a mesma conta, comum e ja paga, cai no 'ja foi paga' -- o 409 de cima e da guarda", async () => {
  const comum = await chamar(ROTA_PAY.POST, {
    tabelas: daPrevista({ geradaPeloFechamento: false, status: "paid" }),
    corpo: { paid_date: "2026-10-09" },
    params: { id: PREVISTA },
  });
  assert.equal(comum.status, 409);
  assert.equal(comum.corpo.error, "Esta conta já foi paga");

  // E a gerada que a 068 quitou continua com a frase do acerto: a guarda vem
  // antes do "ja foi paga", senao a pessoa le que pagou e procura o estorno.
  const quitada = await chamar(ROTA_PAY.POST, {
    tabelas: daPrevista({ status: "paid" }),
    corpo: { paid_date: "2026-10-09" },
    params: { id: PREVISTA },
  });
  assert.equal(quitada.corpo.error, MENSAGEM_DA_CONTA_DO_FECHAMENTO);
});

test("editar e excluir recusam a conta gerada; a comum passa da guarda", async () => {
  const editar = await chamar(ROTA_PREVISTA.PATCH, {
    tabelas: daPrevista(),
    corpo: { amount: 80 },
    params: { id: PREVISTA },
  });
  assert.equal(editar.status, 409);
  assert.equal(editar.corpo.error, MENSAGEM_DA_CONTA_DO_FECHAMENTO);
  assert.deepEqual(editar.escritas, []);

  const excluir = await chamar(ROTA_PREVISTA.DELETE, {
    tabelas: daPrevista(),
    params: { id: PREVISTA },
  });
  assert.equal(excluir.status, 409);
  assert.equal(excluir.corpo.error, MENSAGEM_DA_CONTA_DO_FECHAMENTO);
  assert.deepEqual(excluir.escritas, []);

  // Controle: a conta comum chega ao UPDATE e ao DELETE.
  const editarComum = await chamar(ROTA_PREVISTA.PATCH, {
    tabelas: daPrevista({ geradaPeloFechamento: false }),
    corpo: { amount: 80 },
    params: { id: PREVISTA },
  });
  assert.notEqual(editarComum.corpo.error, MENSAGEM_DA_CONTA_DO_FECHAMENTO);
  assert.ok(
    editarComum.escritas.some((e) => e.tabela === "scheduled_transactions" && e.verbo === "update"),
    "a conta comum deveria chegar ao UPDATE"
  );

  const excluirComum = await chamar(ROTA_PREVISTA.DELETE, {
    tabelas: daPrevista({ geradaPeloFechamento: false }),
    params: { id: PREVISTA },
  });
  assert.notEqual(excluirComum.corpo.error, MENSAGEM_DA_CONTA_DO_FECHAMENTO);
  assert.ok(
    excluirComum.escritas.some((e) => e.tabela === "scheduled_transactions" && e.verbo === "delete"),
    "a conta comum deveria chegar ao DELETE"
  );
});

test("o vinculo le o fechamento da TABELA (a view nao tem a coluna) e recusa a conta gerada", async () => {
  const listar = await chamar(ROTA_VINCULAR.GET, {
    tabelas: daPrevista(),
    params: { id: PREVISTA },
  });
  assert.equal(listar.status, 409);
  assert.equal(listar.corpo.error, MENSAGEM_DA_CONTA_DO_FECHAMENTO);
  // Controle de ordem: a recusa vem antes de listar os lancamentos.
  assert.ok(!listar.lidas.some((l) => l.tabela === "financial_transactions"));

  const vincular = await chamar(ROTA_VINCULAR.POST, {
    tabelas: daPrevista(),
    corpo: { transaction_id: "lancamento-1" },
    params: { id: PREVISTA },
  });
  assert.equal(vincular.status, 409);
  assert.equal(vincular.corpo.error, MENSAGEM_DA_CONTA_DO_FECHAMENTO);
  assert.deepEqual(vincular.escritas, []);

  // Controle: a conta comum segue para a lista de lancamentos.
  const comum = await chamar(ROTA_VINCULAR.GET, {
    tabelas: daPrevista({ geradaPeloFechamento: false }),
    params: { id: PREVISTA },
  });
  assert.equal(comum.status, 200);
  assert.ok(Array.isArray(comum.corpo.transactions));
});

// -----------------------------------------------------
// 3. O desfazer do acerto que ja entrou num fechamento
// -----------------------------------------------------
const ACERTO = "acerto-1";

const doAcerto = ({ fechado }) => ({
  group_settlements: [{ id: ACERTO, group_id: CASA, created_by: LAIS }],
  group_closing_items: fechado
    ? [{ id: "item-1", closing_id: FECHAMENTO, settlement_id: ACERTO }]
    : [{ id: "item-2", closing_id: FECHAMENTO, settlement_id: "outro-acerto" }],
  financial_transactions: [{ id: "perna-1", user_id: LAIS, notes: `acerto:${ACERTO}` }],
});

test("o acerto que entrou no fechamento nao se desfaz, e a perna fica onde esta", async () => {
  const r = await chamar(ROTA_DESFAZER.DELETE, {
    tabelas: doAcerto({ fechado: true }),
    params: { groupId: CASA, id: ACERTO },
  });
  assert.equal(r.status, 409);
  assert.match(r.corpo.error, /entrou no fechamento/);
  // O ponto da conferencia: a perna NAO foi apagada antes da recusa.
  assert.deepEqual(r.escritas, []);
});

test("CONTROLE: o acerto que nao entrou (outro acerto entrou) apaga a perna e a quitacao", async () => {
  const r = await chamar(ROTA_DESFAZER.DELETE, {
    tabelas: doAcerto({ fechado: false }),
    params: { groupId: CASA, id: ACERTO },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.escritas.map((e) => [e.tabela, e.verbo]),
    [
      ["financial_transactions", "delete"],
      ["group_settlements", "delete"],
    ]
  );
});

// -----------------------------------------------------
// 4. O fechamento do periodo devolve o que esta em aberto
// -----------------------------------------------------
function doFechamento({ contas = [], erro = null } = {}) {
  const d = criarDuble({
    user: { id: LAIS },
    tabelas: {
      group_members: [{ id: "m-lais", group_id: CASA, user_id: LAIS, status: "active" }],
      // Sem dia de fechamento: a previa fica de fora e o que se mede e o em aberto.
      expense_groups: [{ id: CASA, closing_day: null }],
      group_closings: [],
      profiles: [
        { id: HELIO, full_name: "Helio" },
        { id: LAIS, full_name: "Lais" },
        { id: LETICIA, full_name: "Leticia" },
      ],
    },
  });
  const chamadas = [];
  d.client.rpc = async (nome, args) => {
    chamadas.push({ nome, args });
    return erro ? { data: null, error: erro } : { data: contas, error: null };
  };
  return { d, chamadas };
}

async function lerFechamento(opcoes) {
  const { d, chamadas } = doFechamento(opcoes);
  globalThis.__dubleDeSupabase = { sessao: () => d.client };
  let resposta;
  try {
    resposta = await ROTA_FECHAMENTO.GET({}, { params: { groupId: CASA } });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }
  return { status: resposta.status, corpo: await resposta.json(), chamadas };
}

test("o fechamento do periodo devolve o em aberto, os pares e o nome de quem aparece neles", async () => {
  const r = await lerFechamento({
    contas: [
      conta(HELIO, "income", "200.00"),
      conta(LAIS, "income", "120.00"),
      conta(LETICIA, "expense", "320.00"),
    ],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.chamadas, [
    { nome: "contas_em_aberto_do_grupo", args: { p_group_id: CASA } },
  ]);
  assert.deepEqual(r.corpo.em_aberto, [
    { user_id: LETICIA, saldo: -320 },
    { user_id: LAIS, saldo: 120 },
    { user_id: HELIO, saldo: 200 },
  ]);
  assert.deepEqual(r.corpo.pares, [
    { de_user_id: LETICIA, para_user_id: HELIO, valor: 200 },
    { de_user_id: LETICIA, para_user_id: LAIS, valor: 120 },
  ]);
  // Sem previa e sem fechamento gravado, so o em aberto traz os nomes.
  assert.equal(r.corpo.nomes[HELIO], "Helio");
  assert.equal(r.corpo.nomes[LETICIA], "Leticia");
});

test("nada em aberto: listas vazias; a leitura que falha e 500, nao 'tudo quitado'", async () => {
  const vazio = await lerFechamento({ contas: [] });
  assert.equal(vazio.status, 200);
  assert.deepEqual(vazio.corpo.em_aberto, []);
  assert.deepEqual(vazio.corpo.pares, []);

  const falhou = await lerFechamento({ erro: { message: "permission denied" } });
  assert.equal(falhou.status, 500);
  assert.equal(falhou.corpo.em_aberto, undefined);
});
