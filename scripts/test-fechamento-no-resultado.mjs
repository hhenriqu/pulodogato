// =====================================================
// PULODOGATO - o fechamento do grupo no Resultado do mes (RN016 a RN018, fase 4)
// =====================================================
//   npm run test:fechamento-no-resultado
//
// A 069 troca a leitura no banco: no grupo com dia de fechamento a parte de
// quem nao pagou sai de `group_share_entries`, e a conta do fechamento quitada
// entra pelo `group_closing_entries` -- database/tests/069_resultado_pelo_fechamento_test.sql
// prova isso. O que o banco nao alcanca, e esta suite mede, e a leitura nas
// TELAS, que montam o previsto e parte do realizado em TypeScript:
//
//   1. A TRADUCAO (lib/fechamento-no-resultado.ts): a conta quitada no formato
//      de uma linha realizada, a estimativa no de uma prevista, a conta prevista
//      do grupo que fecha pela parte de cada um, e a lista da Financas Pessoais;
//   2. AS ABAS RECEITAS E DESPESAS (/api/movimentacoes/resumo): a conta do
//      grupo que fecha pela parte (sem "pague a Fulano"), a conta quitada no
//      realizado, a estimativa no previsto e o credito do grupo que fecha fora
//      do reembolso;
//   3. A PREVISAO DO PAINEL e o RELATORIO DE FLUXO DE CAIXA;
//   4. O "PAGUEI MINHA PARTE", que o grupo que fecha recusa.
//
// O exemplo e o da PRD (RN018): grupo Casa, 50/30/20, Helio pagou R$ 1.500 de
// aluguel e Lais R$ 500 de mercado. Cada bloco tem o CONTROLE junto: o mesmo
// caso num grupo SEM dia de fechamento, que tem de seguir a leitura antiga.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { criarDuble } from "./duble-de-supabase.mjs";

const RAIZ = "../.tmp-fechamento-no-resultado";

const LIB = await import(`${RAIZ}/lib/fechamento-no-resultado.js`);
const { montarParticipantesPorGrupo } = await import(`${RAIZ}/lib/parte-do-grupo.js`);
const { RECUSA_NO_GRUPO_QUE_FECHA } = await import(
  `${RAIZ}/lib/conta-de-grupo-na-agenda.js`
);
const RESUMO = await import(`${RAIZ}/app/api/movimentacoes/resumo/route.js`);
const PREVISAO = await import(`${RAIZ}/app/api/dashboard/previsao/route.js`);
const FLUXO = await import(`${RAIZ}/app/api/reports/cash-flow/route.js`);
const MINHA_BAIXA = await import(
  `${RAIZ}/app/api/scheduled-transactions/[id]/minha-baixa/route.js`
);

const HELIO = "11111111-1111-1111-1111-111111111111";
const LAIS = "22222222-2222-2222-2222-222222222222";
const LETICIA = "33333333-3333-3333-3333-333333333333";
const CASA = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const SERVICO = "ffffffff-0000-0000-0000-000000000001";
const ALUGUEL = "a1a1a1a1-0000-0000-0000-000000000001";
const MERCADO = "a1a1a1a1-0000-0000-0000-000000000002";
const INTERNET = "b2b2b2b2-0000-0000-0000-000000000001";

// -----------------------------------------------------
// As datas saem do relogio, e por isso sao calculadas AQUI, sem a lib
// -----------------------------------------------------
// A estimativa vence no proximo dia de fechamento a partir de HOJE (decisao
// D3), e as rotas leem `today()`. Calcular o esperado com
// `proximoFechamento` seria conferir a lib com ela mesma; a regra aqui e a da
// PRD em tres linhas: dia 9 deste mes se hoje e ate dia 9, senao dia 9 do
// mes seguinte.
const HOJE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
}).format(new Date());
const [ANO, MES, DIA] = HOJE.split("-").map(Number);
const DIA_DO_FECHAMENTO = 9;
const doMes = (ano, mes, dia) =>
  `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
const VENCIMENTO =
  DIA <= DIA_DO_FECHAMENTO
    ? doMes(ANO, MES, DIA_DO_FECHAMENTO)
    : MES === 12
      ? doMes(ANO + 1, 1, DIA_DO_FECHAMENTO)
      : doMes(ANO, MES + 1, DIA_DO_FECHAMENTO);
const ultimoDia = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const [VA, VM] = VENCIMENTO.split("-").map(Number);
// O periodo das telas: do primeiro dia deste mes ao ultimo do mes do
// vencimento. Ele contem hoje, o vencimento e as despesas do fixture.
const DE = doMes(ANO, MES, 1);
const ATE = doMes(VA, VM, ultimoDia(VA, VM));
const NO_PERIODO = DE;

// -----------------------------------------------------
// O fixture
// -----------------------------------------------------
function grupo({ fecha = true } = {}) {
  return {
    id: CASA,
    name: "Casa",
    group_code: "CASA01",
    is_active: true,
    default_split_type: "percentage",
    closing_day: fecha ? DIA_DO_FECHAMENTO : null,
  };
}

const MEMBROS = [
  { id: "m1", group_id: CASA, user_id: HELIO, percentage: 50, status: "active", joined_at: "2026-01-01T00:00:00Z" },
  { id: "m2", group_id: CASA, user_id: LAIS, percentage: 30, status: "active", joined_at: "2026-01-02T00:00:00Z" },
  { id: "m3", group_id: CASA, user_id: LETICIA, percentage: 20, status: "active", joined_at: "2026-01-03T00:00:00Z" },
];

const despesa = (id, user_id, valor, descricao) => ({
  id,
  user_id,
  service_id: SERVICO,
  description: descricao,
  amount: -valor,
  exchange_rate: 1,
  currency: "BRL",
  transaction_date: NO_PERIODO,
  transaction_type: "expense",
  counterpart_transaction_id: null,
  notes: null,
  include_in_total: true,
  created_at: `${NO_PERIODO}T12:00:00Z`,
  category: { name: "Casa", is_expense: true },
  account: null,
});

/** A conta prevista do grupo: a Internet de R$ 300 que o Helio lancou. */
const internet = {
  id: INTERNET,
  user_id: HELIO,
  description: "Internet",
  amount: 300,
  due_date: ATE,
  status: "pending",
  my_status: "pending",
  my_effective_status: "pending",
  currency: "BRL",
  direction: "expense",
  notes: null,
  recurring_rule_id: null,
  group_id: CASA,
  category: { name: "Casa" },
  account: null,
};

/** Uma linha de `group_closing_entries` (069). */
const quitada = (user_id, tipo, valor, extra = {}) => ({
  id: `st-${user_id.slice(0, 4)}-${tipo}`,
  user_id,
  group_id: CASA,
  closing_id: "fech-1",
  transaction_date: NO_PERIODO,
  month: DE,
  category_id:
    tipo === "expense"
      ? LIB.CATEGORIA_DO_PAGAMENTO_AO_GRUPO
      : LIB.CATEGORIA_DO_RECEBIMENTO_DO_GRUPO,
  transaction_type: tipo,
  currency: "BRL",
  amount: valor,
  descricao: tipo === "expense" ? "Pagamento ao grupo Casa" : "A receber do grupo Casa",
  ...extra,
});

function tabelas({ fecha = true, extra = {} } = {}) {
  return {
    financial_services: [{ id: SERVICO, name: "personal_finance" }],
    financial_accounts: [],
    financial_transactions: [
      despesa(ALUGUEL, HELIO, 1500, "Aluguel"),
      despesa(MERCADO, LAIS, 500, "Mercado"),
    ],
    expense_groups: [grupo({ fecha })],
    group_members: MEMBROS,
    group_transactions: [
      { group_id: CASA, transaction_id: ALUGUEL },
      { group_id: CASA, transaction_id: MERCADO },
    ],
    group_closings: [],
    group_closing_items: [],
    group_settlements: [],
    group_settlement_allocations: [],
    group_closing_entries: [],
    scheduled_transactions_effective: [internet],
    profiles: [
      { id: HELIO, full_name: "Helio" },
      { id: LAIS, full_name: "Lais" },
      { id: LETICIA, full_name: "Leticia" },
    ],
    mybank_due_entries: [],
    mybank_loans: [],
    mybank_installments: [],
    ...extra,
  };
}

/**
 * Chama um handler com o duble de quem olha. `erros` derruba uma tabela
 * inteira, como o PostgREST faria.
 */
async function chamar(handler, { quem, tabelas: t, erros = {}, url, params, corpo }) {
  const d = criarDuble({ user: { id: quem }, tabelas: t, erros });
  globalThis.__dubleDeSupabase = { sessao: () => d.client, servico: () => d.client };
  try {
    const pedido = url
      ? { url, nextUrl: new URL(url), json: async () => corpo ?? {} }
      : { json: async () => corpo ?? {} };
    const resposta = await handler(pedido, params ? { params } : undefined);
    return { status: resposta.status, corpo: await resposta.json(), d };
  } finally {
    delete globalThis.__dubleDeSupabase;
  }
}

const resumo = (quem, tipo, opcoes = {}) =>
  chamar(RESUMO.GET, {
    quem,
    tabelas: tabelas(opcoes),
    erros: opcoes.erros,
    url: `http://t/api/movimentacoes/resumo?tipo=${tipo}&de=${DE}&ate=${ATE}`,
  });

// =====================================================
// 1. A traducao
// =====================================================
test("a conta quitada vira linha realizada: sinal do banco, id com prefixo, sem dono", () => {
  const [paga, recebe] = LIB.contasDoFechamentoComoRealizadas([
    quitada(LAIS, "expense", "100.00"),
    quitada(HELIO, "income", 500),
  ]);

  assert.equal(paga.amount, -100);
  assert.equal(paga.transaction_type, "expense");
  assert.equal(paga.category.name, "Pagamento a grupo");
  assert.equal(paga.category.is_expense, true);
  assert.ok(paga.id.startsWith(LIB.PREFIXO_DA_CONTA_DO_FECHAMENTO));
  assert.equal(recebe.amount, 500);
  assert.equal(recebe.category.name, "Recebimento de grupo");
  // Sem `user_id`: a ausencia e o que tira os botoes da linha na tela.
  assert.ok(!("user_id" in paga));
  // Controle: um tipo que o fechamento nao gera nao vira linha nenhuma.
  assert.deepEqual(
    LIB.contasDoFechamentoComoRealizadas([quitada(LAIS, "transfer", 80)]),
    []
  );
});

test("a estimativa do membro e a conta que o fechamento geraria; saldo zero nao tem", () => {
  const fechamento = {
    contas: [
      { user_id: HELIO, tipo: "income", valor: 500 },
      { user_id: LAIS, tipo: "expense", valor: 100 },
    ],
  };
  assert.deepEqual(LIB.estimativaDoMembro(fechamento, HELIO), { tipo: "income", valor: 500 });
  assert.deepEqual(LIB.estimativaDoMembro(fechamento, LAIS), { tipo: "expense", valor: 100 });
  assert.equal(LIB.estimativaDoMembro(fechamento, LETICIA), null);
  assert.equal(
    LIB.estimativaDoMembro({ contas: [{ user_id: LETICIA, tipo: "expense", valor: 0 }] }, LETICIA),
    null
  );
});

test("a estimativa vira prevista sem id e sem grupo, com chave propria", () => {
  const [linha] = LIB.estimativasComoPrevistas([
    { group_id: CASA, nome: "Casa", vencimento: "2026-11-09", tipo: "expense", valor: 100 },
  ]);
  assert.equal(linha.id, null);
  // Sem `group_id`: com ele a estimativa passaria pelo rateio e encolheria.
  assert.equal(linha.group_id, null);
  assert.equal(linha.amount, 100);
  assert.equal(linha.direction, "expense");
  assert.equal(linha.description, "Estimativa: pagamento ao grupo Casa");
  assert.equal(linha.notes, `${LIB.PREFIXO_DA_ESTIMATIVA_DO_FECHAMENTO}${CASA}:2026-11-09`);
  assert.equal(
    LIB.descricaoDaEstimativa({ tipo: "income", nome: "Casa" }),
    "Estimativa: a receber do grupo Casa"
  );
});

test("a conta prevista do grupo que fecha entra pela parte, inclusive para quem a lancou", () => {
  const pesos = montarParticipantesPorGrupo(MEMBROS);
  const { doGrupoQueFecha, demais } = LIB.separarPeloFechamento(
    [internet, { ...internet, id: "avulsa", group_id: null }],
    new Set([CASA])
  );
  assert.deepEqual(doGrupoQueFecha.map((p) => p.id), [INTERNET]);
  assert.deepEqual(demais.map((p) => p.id), ["avulsa"]);

  const [doHelio] = LIB.previstasNoGrupoQueFecha(doGrupoQueFecha, pesos, HELIO);
  const [daLais] = LIB.previstasNoGrupoQueFecha(doGrupoQueFecha, pesos, LAIS);
  assert.equal(doHelio.amount, 150);
  assert.equal(daLais.amount, 90);
  // AUSENTE, e nao nulo: nulo e "deve a alguem que nao consigo ler".
  assert.ok(!("pagar_para" in daLais));
  // O grupo continua na linha: e ele que poe o selo de grupo na tela.
  assert.equal(daLais.group_id, CASA);

  // Controle: grupo fora do conjunto fica com a regra de antes.
  assert.equal(LIB.separarPeloFechamento([internet], new Set()).doGrupoQueFecha.length, 0);
});

test("a lista da Financas Pessoais ganha a conta quitada na ordem da data, sem mexer nas outras", () => {
  const linhas = [
    { kind: "minha", mov: { id: "t3", transaction_date: "2026-10-20" } },
    { kind: "parte", parte: { id: "p1", transactionDate: "2026-10-09" } },
    { kind: "minha", mov: { id: "t2", transaction_date: "2026-10-09" } },
    { kind: "minha", mov: { id: "t1", transaction_date: "2026-10-01" } },
  ];
  const [conta] = LIB.contasDoFechamentoComoRealizadas([
    quitada(LAIS, "expense", 100, { transaction_date: "2026-10-09" }),
  ]);
  const juntas = LIB.comAsContasDoFechamento(linhas, [conta]);
  assert.deepEqual(
    juntas.map((l) => (l.kind === "fechamento" ? "F" : l.kind === "parte" ? l.parte.id : l.mov.id)),
    // Estavel: no dia 09 as duas que ja estavam continuam na ordem delas.
    ["t3", "p1", "t2", "F", "t1"]
  );
  // Controle: sem conta, a lista e a mesma.
  assert.deepEqual(LIB.comAsContasDoFechamento(linhas, []), linhas);
});

// =====================================================
// 2. As abas Receitas e Despesas
// =====================================================
const linhaDa = (corpo, id) => corpo.linhas.find((l) => l.id === id);

test("Despesas do Helio: a Internet do grupo que fecha entra pela parte dele, sem reembolso", async () => {
  const r = await resumo(HELIO, "expense");
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(linhaDa(r.corpo, INTERNET).valor, 150);

  // Controle: no grupo SEM dia de fechamento, quem fronta ve a conta cheia
  // (a regra do pagador, HMO-364).
  const semFechamento = await resumo(HELIO, "expense", { fecha: false });
  assert.equal(linhaDa(semFechamento.corpo, INTERNET).valor, 300);
});

test("Despesas da Lais: a parte dela, e ninguem para quem pagar", async () => {
  const r = await resumo(LAIS, "expense");
  assert.equal(linhaDa(r.corpo, INTERNET).valor, 90);
  // No grupo que fecha a parte se paga ao grupo, no fechamento.
  assert.deepEqual(r.corpo.pra_quem_pagar, []);

  // Controle: no grupo sem fechamento, a mesma parte manda pagar o Helio.
  const semFechamento = await resumo(LAIS, "expense", { fecha: false });
  assert.equal(linhaDa(semFechamento.corpo, INTERNET).valor, 90);
  assert.equal(semFechamento.corpo.pra_quem_pagar.length, 1);
});

test("a conta do fechamento quitada entra no realizado, sem botao; a de outro membro nao", async () => {
  const extra = {
    group_closing_entries: [
      quitada(LAIS, "expense", 100),
      // A do Helio esta na view para a Lais nao a ver: a rota filtra por dono.
      quitada(HELIO, "income", 500),
    ],
  };
  const r = await resumo(LAIS, "expense", { extra });
  const conta = r.corpo.linhas.find((l) =>
    l.id.startsWith(LIB.PREFIXO_DA_CONTA_DO_FECHAMENTO)
  );
  assert.ok(conta, "a conta quitada nao apareceu em Despesas");
  assert.equal(conta.valor, 100);
  assert.equal(conta.origem, "realizado");
  assert.equal(conta.posso_editar, false);
  // Mercado 500 + Pagamento ao grupo 100: o realizado da Lais no exemplo.
  assert.equal(r.corpo.resumo.realizado, 600);

  const helio = await resumo(HELIO, "income", { extra });
  const recebe = helio.corpo.linhas.find((l) =>
    l.id.startsWith(LIB.PREFIXO_DA_CONTA_DO_FECHAMENTO)
  );
  assert.equal(recebe.valor, 500);
  assert.equal(helio.corpo.resumo.realizado, 500);

  // Controle: sem a linha na view, o realizado e so o Mercado.
  const sem = await resumo(LAIS, "expense");
  assert.equal(sem.corpo.resumo.realizado, 500);
});

test("a view que falta (069 ainda nao colada) segue sem a conta; erro de verdade e 500", async () => {
  const ausente = await resumo(LAIS, "expense", {
    erros: { group_closing_entries: { code: "42P01", message: "relation does not exist" } },
  });
  assert.equal(ausente.status, 200);
  assert.equal(ausente.corpo.resumo.realizado, 500);

  const quebrada = await resumo(LAIS, "expense", {
    erros: { group_closing_entries: { code: "57014", message: "timeout" } },
  });
  assert.equal(quebrada.status, 500);
});

test("a estimativa do periodo aberto entra no previsto, no dia do fechamento", async () => {
  // Helio pagou 1.500 e deve 1.000: tem 500 a receber.
  const helio = await resumo(HELIO, "income");
  const estimativa = helio.corpo.linhas.find(
    (l) => l.descricao === "Estimativa: a receber do grupo Casa"
  );
  assert.ok(estimativa, "a estimativa do Helio nao apareceu em Receitas");
  assert.equal(estimativa.valor, 500);
  assert.equal(estimativa.data, VENCIMENTO);
  assert.equal(estimativa.gravada, false);
  assert.equal(helio.corpo.resumo.previsto, 500);

  // Lais pagou 500 e deve 600: 100 a pagar. Leticia: 400 a pagar.
  const lais = await resumo(LAIS, "expense");
  const daLais = lais.corpo.linhas.find(
    (l) => l.descricao === "Estimativa: pagamento ao grupo Casa"
  );
  assert.equal(daLais.valor, 100);
  const leticia = await resumo(LETICIA, "expense");
  assert.equal(
    leticia.corpo.linhas.find((l) => l.descricao === "Estimativa: pagamento ao grupo Casa").valor,
    400
  );

  // Controle: grupo sem dia de fechamento nao tem estimativa.
  const semFechamento = await resumo(HELIO, "income", { fecha: false });
  assert.ok(
    !semFechamento.corpo.linhas.some((l) => l.descricao?.startsWith("Estimativa:"))
  );
});

test("o grupo que fecha sai do reembolso previsto de Receitas; o que nao fecha continua", async () => {
  // O Helio fronta a Internet: na regra do pagador os outros lhe devem a parte
  // deles, como reembolso. No grupo que fecha isso vem da estimativa.
  const comFechamento = await resumo(HELIO, "income");
  assert.equal(comFechamento.corpo.quem_me_paga?.linhas?.length ?? 0, 0);

  const semFechamento = await resumo(HELIO, "income", { fecha: false });
  assert.ok(
    semFechamento.corpo.quem_me_paga.linhas.length > 0,
    "controle: no grupo sem fechamento o credito tem de aparecer"
  );
});

// =====================================================
// 3. A previsao do painel e o fluxo de caixa
// =====================================================
test("a Previsao do painel soma a estimativa, e so a do grupo que fecha", async () => {
  const url = `http://t/api/dashboard/previsao?de=${DE}&ate=${ATE}`;
  const com = await chamar(PREVISAO.GET, { quem: HELIO, tabelas: tabelas(), url });
  const sem = await chamar(PREVISAO.GET, { quem: HELIO, tabelas: tabelas({ fecha: false }), url });
  assert.equal(com.status, 200, JSON.stringify(com.corpo));
  assert.equal(sem.status, 200, JSON.stringify(sem.corpo));
  assert.equal(com.corpo.previsao.receita - sem.corpo.previsao.receita, 500);
});

test("o relatorio de fluxo de caixa soma a conta quitada no intervalo", async () => {
  const url = `http://t/api/reports/cash-flow?de=${DE}&ate=${ATE}&cartao=fatura`;
  const extra = { group_closing_entries: [quitada(LAIS, "expense", 100)] };
  const com = await chamar(FLUXO.GET, { quem: LAIS, tabelas: tabelas({ extra }), url });
  const sem = await chamar(FLUXO.GET, { quem: LAIS, tabelas: tabelas(), url });
  assert.equal(com.status, 200, JSON.stringify(com.corpo));
  assert.equal(com.corpo.summary.total_expense - sem.corpo.summary.total_expense, 100);
});

// =====================================================
// 4. "Paguei minha parte"
// =====================================================
test("o aviso de 'paguei minha parte' e recusado no grupo que fecha, e passa no que nao fecha", async () => {
  const conta = { id: INTERNET, user_id: HELIO, group_id: CASA };
  const com = await chamar(MINHA_BAIXA.POST, {
    quem: LAIS,
    tabelas: { scheduled_transactions: [conta], expense_groups: [grupo()], group_bill_payments: [] },
    params: { id: INTERNET },
  });
  assert.equal(com.status, 409);
  assert.equal(com.corpo.error, RECUSA_NO_GRUPO_QUE_FECHA);
  assert.deepEqual(com.d.escritas, []);

  const sem = await chamar(MINHA_BAIXA.POST, {
    quem: LAIS,
    tabelas: {
      scheduled_transactions: [conta],
      expense_groups: [grupo({ fecha: false })],
      group_bill_payments: [],
    },
    params: { id: INTERNET },
  });
  assert.equal(sem.status, 200, JSON.stringify(sem.corpo));
  assert.ok(sem.d.escritas.some((e) => e.tabela === "group_bill_payments"));
});
