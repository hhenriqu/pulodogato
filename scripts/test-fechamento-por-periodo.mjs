// =====================================================
// PULODOGATO - o fechamento do grupo por periodo (RN018, fase 2)
// =====================================================
//   npm run test:fechamento-por-periodo
//
// Roda o JS compilado de lib/fechamento-por-periodo.ts e de
// lib/services/fechamento-dos-grupos.ts. O segundo le o banco por um duble do
// Supabase que FILTRA de verdade (scripts/duble-de-supabase.mjs), entao um
// filtro esquecido na consulta aparece aqui como numero errado.
//
// Cada bloco tem o CONTROLE junto: o numero que a conta errada produziria. Sem
// isso, "a Lais paga R$ 100" passaria verde numa conta que nem olhasse o %.
// O npm script roda a suite em America/Sao_Paulo e em UTC: as datas sao string
// e nao podem depender do fuso da maquina.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { criarDuble } from "./duble-de-supabase.mjs";

const {
  diaDeFechamento,
  ultimoFechamento,
  proximoFechamento,
  periodoQueTerminaEm,
  periodoParaFechar,
  fecharPeriodo,
  TOLERANCIA_DO_CRON,
} = await import("../.tmp-fechamento-por-periodo/fechamento-por-periodo.js");

const { lerOQueNaoFechou, fecharOGrupo } = await import(
  "../.tmp-fechamento-por-periodo/services/fechamento-dos-grupos.js"
);

const HELIO = "11111111-1111-1111-1111-111111111111";
const LAIS = "22222222-2222-2222-2222-222222222222";
const LETICIA = "33333333-3333-3333-3333-333333333333";
const BIA = "44444444-4444-4444-4444-444444444444";
const CASA = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const OUTRO = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const despesa = (id, pagador, valor, data) => ({
  transaction_id: id,
  pagador_user_id: pagador,
  valor,
  data,
  descricao: id,
});

const posicaoDe = (f, id) => f.membros.find((m) => m.user_id === id);
const contaDe = (f, id) => f.contas.find((c) => c.user_id === id);

// O grupo Casa da PRD: 50/30/20 em centesimos de ponto, como a configuracao grava.
const CASA_50_30_20 = [
  { user_id: HELIO, peso: 5000 },
  { user_id: LAIS, peso: 3000 },
  { user_id: LETICIA, peso: 2000 },
];

// -----------------------------------------------------
// O dia de fechamento
// -----------------------------------------------------
test("diaDeFechamento aceita 1..28 inteiro e recusa o resto, sem corrigir", () => {
  assert.equal(diaDeFechamento(1), 1);
  assert.equal(diaDeFechamento(28), 28);
  assert.equal(diaDeFechamento("9"), 9);
  // Controle: um "clamp" para 28 fecharia o dia 31 tres dias antes do pedido.
  assert.equal(diaDeFechamento(31), null);
  assert.equal(diaDeFechamento(29), null);
  assert.equal(diaDeFechamento(0), null);
  assert.equal(diaDeFechamento(9.5), null);
  assert.equal(diaDeFechamento(""), null);
  assert.equal(diaDeFechamento(null), null);
  assert.equal(diaDeFechamento("nove"), null);
});

test("ultimoFechamento: o dia do fechamento ja e 'fechou'", () => {
  assert.equal(ultimoFechamento(9, "2026-10-15"), "2026-10-09");
  assert.equal(ultimoFechamento(9, "2026-10-09"), "2026-10-09");
  assert.equal(ultimoFechamento(9, "2026-10-05"), "2026-09-09");
  // A virada do ano.
  assert.equal(ultimoFechamento(9, "2026-01-05"), "2025-12-09");
});

test("proximoFechamento: o fim do periodo aberto", () => {
  assert.equal(proximoFechamento(9, "2026-10-15"), "2026-11-09");
  assert.equal(proximoFechamento(9, "2026-10-09"), "2026-10-09");
  assert.equal(proximoFechamento(9, "2026-10-01"), "2026-10-09");
  assert.equal(proximoFechamento(28, "2026-12-29"), "2027-01-28");
});

test("periodoQueTerminaEm: comeca no dia seguinte ao fechamento anterior", () => {
  assert.deepEqual(periodoQueTerminaEm("2026-11-09", "2026-10-09"), {
    inicio: "2026-10-10",
    fim: "2026-11-09",
  });
  // Sem fechamento anterior: o periodo "normal", de um mes.
  assert.deepEqual(periodoQueTerminaEm("2026-11-09", null), {
    inicio: "2026-10-10",
    fim: "2026-11-09",
  });
  // Depois de mudar o dia de 9 para 20, o primeiro periodo e curto, e comeca
  // onde o anterior acabou -- nao um mes antes, o que repetiria 10/10 a 09/10.
  assert.deepEqual(periodoQueTerminaEm("2026-10-20", "2026-10-09"), {
    inicio: "2026-10-10",
    fim: "2026-10-20",
  });
});

test("periodoParaFechar: so no dia, com a tolerancia do cron, e depois do ultimo fechado", () => {
  assert.equal(TOLERANCIA_DO_CRON, 2);
  const esperado = { inicio: "2026-10-10", fim: "2026-11-09" };

  assert.deepEqual(periodoParaFechar(9, "2026-11-09", "2026-10-09"), esperado);
  // Execucao perdida: dois dias depois ainda fecha.
  assert.deepEqual(periodoParaFechar(9, "2026-11-11", "2026-10-09"), esperado);
  // Tres dias depois, nao: quem configura o dia 9 no dia 20 nao ganha contas
  // vencidas na hora.
  assert.equal(periodoParaFechar(9, "2026-11-12", "2026-10-09"), null);
  // Ja fechado.
  assert.equal(periodoParaFechar(9, "2026-11-09", "2026-11-09"), null);
  // O grupo que nao fecha.
  assert.equal(periodoParaFechar(null, "2026-11-09", null), null);
  assert.equal(periodoParaFechar(31, "2026-11-09", null), null);
  // Mudou o dia de 9 para 5 no dia 06/10, com o periodo ate 09/10 ja fechado:
  // o "ultimo dia 5" e 05/10, ANTES do ultimo fechado. Fechar de novo contaria
  // de novo o que ja fechou.
  assert.equal(periodoParaFechar(5, "2026-10-06", "2026-10-09"), null);
});

// -----------------------------------------------------
// O fechamento: o exemplo da PRD, numero por numero
// -----------------------------------------------------
test("o exemplo da PRD: 50/30/20, R$ 2.000, Helio recebe 500, Lais paga 100, Leticia 400", () => {
  const f = fecharPeriodo({
    despesas: [
      despesa("aluguel", HELIO, 1000, "2026-10-12"),
      despesa("condominio", HELIO, 500, "2026-11-02"),
      despesa("mercado", LAIS, 500, "2026-10-20"),
    ],
    acertos: [],
    membros: CASA_50_30_20,
    fim: "2026-11-09",
  });

  assert.equal(f.total, 2000);
  assert.equal(f.fecha, true);
  assert.deepEqual(f.contas, [
    { user_id: HELIO, tipo: "income", valor: 500 },
    { user_id: LAIS, tipo: "expense", valor: 100 },
    { user_id: LETICIA, tipo: "expense", valor: 400 },
  ]);

  // O Resultado de cada um fecha na responsabilidade: pago - saldo.
  for (const [id, resp] of [[HELIO, 1000], [LAIS, 600], [LETICIA, 400]]) {
    const p = posicaoDe(f, id);
    assert.equal(p.responsabilidade, resp);
    assert.equal(Math.round((p.pago - p.saldo) * 100) / 100, resp);
  }

  // Controle: dividir IGUAL daria a Lais 666,67 de parte e 166,67 a pagar.
  assert.notEqual(contaDe(f, LAIS).valor, 166.67);

  // A foto guarda o % que valeu.
  assert.deepEqual(
    f.membros.map((m) => m.percentual),
    [50, 30, 20]
  );
  assert.equal(f.itens.length, 3);
});

test("a soma dos saldos e zero, e a das responsabilidades e o total, em centavos", () => {
  // R$ 100 entre tres iguais: 33,34 + 33,33 + 33,33. Arredondar cada parte por
  // conta propria daria 33,33 x 3 = 99,99 e um centavo sem dono.
  const f = fecharPeriodo({
    despesas: [despesa("luz", HELIO, 100, "2026-10-15")],
    acertos: [],
    membros: [
      { user_id: HELIO, peso: 1 },
      { user_id: LAIS, peso: 1 },
      { user_id: LETICIA, peso: 1 },
    ],
    fim: "2026-11-09",
  });
  const centavos = (v) => Math.round(v * 100);
  assert.equal(
    f.membros.reduce((s, m) => s + centavos(m.responsabilidade), 0),
    10000
  );
  assert.equal(
    f.membros.reduce((s, m) => s + centavos(m.saldo), 0),
    0
  );
  // O centavo que sobra vai para o primeiro da ordem recebida.
  assert.deepEqual(
    f.membros.map((m) => m.responsabilidade),
    [33.34, 33.33, 33.33]
  );
  assert.deepEqual(
    f.membros.map((m) => m.percentual),
    [33.33, 33.33, 33.33]
  );
});

test("entra a despesa ate o fim do periodo, inclusive a de data antiga; fica fora a de depois", () => {
  const f = fecharPeriodo({
    despesas: [
      // lancada depois do fechamento do periodo dela: entra no proximo (RN018.3)
      despesa("atrasada", LAIS, 100, "2026-09-25"),
      despesa("no-dia", HELIO, 200, "2026-11-09"),
      // do periodo que vem
      despesa("depois", HELIO, 999, "2026-11-10"),
    ],
    acertos: [],
    membros: CASA_50_30_20,
    fim: "2026-11-09",
  });
  assert.equal(f.total, 300);
  assert.deepEqual(
    f.itens.map((i) => i.transaction_id),
    ["atrasada", "no-dia"]
  );
});

test("despesa de valor zero ou invalido nao vira item", () => {
  const f = fecharPeriodo({
    despesas: [
      despesa("zero", HELIO, 0, "2026-10-15"),
      despesa("sem-data", HELIO, 50, ""),
      despesa("boa", HELIO, 10, "2026-10-15"),
    ],
    acertos: [],
    membros: CASA_50_30_20,
    fim: "2026-11-09",
  });
  assert.deepEqual(
    f.itens.map((i) => i.transaction_id),
    ["boa"]
  );
});

test("o acerto antigo entra: quem ja mandou o Pix nao recebe a divida de novo (RN018.11)", () => {
  const f = fecharPeriodo({
    despesas: [
      despesa("aluguel", HELIO, 1500, "2026-10-12"),
      despesa("mercado", LAIS, 500, "2026-10-20"),
    ],
    acertos: [
      { settlement_id: "pix", de_user_id: LAIS, para_user_id: HELIO, valor: 100, data: "2026-10-30" },
    ],
    membros: CASA_50_30_20,
    fim: "2026-11-09",
  });
  // A Lais devia 100 e ja mandou 100: sem conta. O Helio tinha 500 a receber
  // e ja recebeu 100.
  assert.equal(contaDe(f, LAIS), undefined);
  assert.deepEqual(contaDe(f, HELIO), { user_id: HELIO, tipo: "income", valor: 400 });
  assert.equal(posicaoDe(f, LAIS).acertos, 100);
  assert.equal(posicaoDe(f, HELIO).acertos, -100);
  // Controle: ignorar o acerto cobraria R$ 100 da Lais de novo.
  assert.notDeepEqual(contaDe(f, LAIS), { user_id: LAIS, tipo: "expense", valor: 100 });
  assert.deepEqual(
    f.itens.filter((i) => i.kind === "acerto"),
    [{ kind: "acerto", settlement_id: "pix", from_user_id: LAIS, to_user_id: HELIO, amount: 100, item_date: "2026-10-30" }]
  );
});

test("quem saiu do grupo e pagou uma conta sai com A receber, e a parte e so dos ativos", () => {
  const f = fecharPeriodo({
    despesas: [despesa("gas", BIA, 90, "2026-10-15")],
    acertos: [],
    membros: [
      { user_id: HELIO, peso: 1 },
      { user_id: LAIS, peso: 1 },
    ],
    fim: "2026-11-09",
  });
  const bia = posicaoDe(f, BIA);
  assert.equal(bia.responsabilidade, 0);
  assert.equal(bia.percentual, 0);
  assert.deepEqual(contaDe(f, BIA), { user_id: BIA, tipo: "income", valor: 90 });
  assert.equal(posicaoDe(f, HELIO).responsabilidade, 45);
  assert.equal(f.fecha, true);
  // Controle: dividir entre os tres daria 30 de parte para a Bia.
  assert.notEqual(posicaoDe(f, HELIO).responsabilidade, 30);
});

test("sem membro ativo, a despesa nao tem quem responda por ela: nao fecha", () => {
  const f = fecharPeriodo({
    despesas: [despesa("gas", BIA, 90, "2026-10-15")],
    acertos: [],
    membros: [],
    fim: "2026-11-09",
  });
  assert.equal(f.fecha, false);
});

test("periodo sem despesa fecha em zero, sem conta nenhuma", () => {
  const f = fecharPeriodo({ despesas: [], acertos: [], membros: CASA_50_30_20, fim: "2026-11-09" });
  assert.equal(f.total, 0);
  assert.equal(f.fecha, true);
  assert.deepEqual(f.contas, []);
});

// -----------------------------------------------------
// A leitura: o que ainda nao fechou
// -----------------------------------------------------
function dubleDaCasa({ rpc } = {}) {
  const d = criarDuble({
    tabelas: {
      group_closing_items: [
        { group_id: CASA, transaction_id: "t-fechada", settlement_id: null },
        { group_id: CASA, transaction_id: null, settlement_id: "s-fechado" },
      ],
      group_transactions: [
        { group_id: CASA, transaction_id: "t-fechada" },
        { group_id: CASA, transaction_id: "t-aberta" },
        { group_id: CASA, transaction_id: "t-receita" },
        { group_id: OUTRO, transaction_id: "t-outro" },
      ],
      financial_transactions: [
        { id: "t-fechada", description: "Aluguel", amount: -1000, exchange_rate: 1, transaction_date: "2026-09-12", user_id: HELIO, transaction_type: "expense" },
        { id: "t-aberta", description: "Mercado", amount: -500, exchange_rate: 1, transaction_date: "2026-10-20", user_id: LAIS, transaction_type: "expense" },
        { id: "t-receita", description: "Reembolso", amount: 80, exchange_rate: 1, transaction_date: "2026-10-21", user_id: HELIO, transaction_type: "income" },
        { id: "t-outro", description: "Outro", amount: -50, exchange_rate: 1, transaction_date: "2026-10-15", user_id: BIA, transaction_type: "expense" },
      ],
      group_settlements: [
        { id: "s-fechado", group_id: CASA, from_user_id: LAIS, to_user_id: HELIO, amount: 30, exchange_rate: 1, settled_on: "2026-09-30" },
        { id: "s-aberto", group_id: CASA, from_user_id: LETICIA, to_user_id: HELIO, amount: 40, exchange_rate: 1, settled_on: "2026-10-25" },
      ],
      group_members: [
        { group_id: CASA, user_id: HELIO, joined_at: "2026-01-01", percentage: 50, status: "active" },
        { group_id: CASA, user_id: LAIS, joined_at: "2026-01-02", percentage: 30, status: "active" },
        { group_id: CASA, user_id: LETICIA, joined_at: "2026-01-03", percentage: 20, status: "active" },
      ],
      expense_groups: [{ id: CASA, default_split_type: "percentage", closing_day: 9 }],
      group_closings: [{ group_id: CASA, period_end: "2026-10-09" }],
    },
  });
  const chamadas = [];
  d.client.rpc = async (nome, args) => {
    chamadas.push({ nome, args });
    return rpc ? rpc(nome, args) : { data: "novo-fechamento", error: null };
  };
  return { ...d, chamadas };
}

test("lerOQueNaoFechou: so despesa do grupo, ainda nao fechada; so acerto ainda nao fechado", async () => {
  const { client } = dubleDaCasa();
  const r = await lerOQueNaoFechou(client, CASA);
  // Controle: sem a exclusao, o aluguel ja fechado entraria de novo; sem o
  // filtro de tipo, o reembolso viraria despesa; sem o recorte do grupo, a
  // despesa do outro grupo entraria.
  assert.deepEqual(
    r.despesas.map((d) => d.transaction_id),
    ["t-aberta"]
  );
  assert.deepEqual(r.despesas[0], {
    transaction_id: "t-aberta",
    pagador_user_id: LAIS,
    valor: 500,
    data: "2026-10-20",
    descricao: "Mercado",
  });
  assert.deepEqual(
    r.acertos.map((a) => a.settlement_id),
    ["s-aberto"]
  );
});

// -----------------------------------------------------
// O cron: fecha no dia, uma vez
// -----------------------------------------------------
test("fecharOGrupo no dia: chama a funcao do banco com o periodo e as contas", async () => {
  const { client, chamadas } = dubleDaCasa();
  const r = await fecharOGrupo(client, { id: CASA, closing_day: 9 }, "2026-11-09");

  assert.equal(r.desfecho, "fechado");
  assert.deepEqual(r.periodo, { inicio: "2026-10-10", fim: "2026-11-09" });
  assert.equal(chamadas.length, 1);
  const { nome, args } = chamadas[0];
  assert.equal(nome, "registrar_fechamento_do_grupo");
  assert.equal(args.p_group_id, CASA);
  assert.equal(args.p_period_start, "2026-10-10");
  assert.equal(args.p_period_end, "2026-11-09");
  // R$ 500 de mercado da Lais, 50/30/20, e o Pix de 40 da Leticia ao Helio:
  //   Helio  0 - 40 - 250 = -290   Lais  500 - 150 = +350   Leticia 40 - 100 = -60
  assert.equal(args.p_fechamento.total, 500);
  assert.deepEqual(args.p_fechamento.contas, [
    { user_id: HELIO, tipo: "expense", valor: 290 },
    { user_id: LAIS, tipo: "income", valor: 350 },
    { user_id: LETICIA, tipo: "expense", valor: 60 },
  ]);
});

test("fecharOGrupo fora do dia nao chama o banco", async () => {
  const { client, chamadas } = dubleDaCasa();
  const r = await fecharOGrupo(client, { id: CASA, closing_day: 9 }, "2026-11-20");
  assert.equal(r.desfecho, "fora_do_dia");
  assert.equal(chamadas.length, 0);
});

test("fecharOGrupo: o periodo que outra execucao fechou primeiro volta como ja_fechado", async () => {
  const { client } = dubleDaCasa({ rpc: () => ({ data: null, error: null }) });
  const r = await fecharOGrupo(client, { id: CASA, closing_day: 9 }, "2026-11-09");
  assert.equal(r.desfecho, "ja_fechado");
});

test("fecharOGrupo: a recusa do banco sobe como erro, para o cron registrar", async () => {
  const { client } = dubleDaCasa({
    rpc: () => ({ data: null, error: { message: "Fechamento: as contas nao sao os saldos dos membros" } }),
  });
  await assert.rejects(
    fecharOGrupo(client, { id: CASA, closing_day: 9 }, "2026-11-09"),
    /as contas nao sao os saldos/
  );
});
