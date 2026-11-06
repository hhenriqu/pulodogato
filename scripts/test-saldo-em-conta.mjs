#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DO SALDO EM CONTA DO PAINEL
// =====================================================
//   npm run test:saldo-em-conta
//
// Exercita lib/saldo-em-conta.ts. O caso que originou a regra: conta corrente
// zerada e dois cartoes com faturas futuras -- o tile antigo mostrava
// -R$ 1.695,52, que era so a divida dos cartoes.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { calcularSaldoEmConta, contasDeDinheiro, rotuloDoSaldoEmConta } =
  await import("../.tmp-saldo-em-conta/lib/saldo-em-conta.js");

const corrente = { id: "cc", account_type: "checking", current_balance: 0 };
const dinheiro = { id: "din", account_type: "cash", current_balance: 0 };
const c6 = { id: "c6", account_type: "credit_card", current_balance: -863.32 };
const nubank = { id: "nu", account_type: "credit_card", current_balance: -832.2 };
const outubro = { de: "2026-10-01", ate: "2026-10-31" };

test("o cartao nao entra: conta zerada e cartoes devendo dao saldo zero", () => {
  const r = calcularSaldoEmConta({
    contas: [corrente, dinheiro, c6, nubank],
    lancamentos: [
      { id: "x", account_id: "c6", amount: -115, transaction_date: "2026-10-24" },
    ],
    ...outubro,
    hoje: "2026-10-24",
  });
  assert.equal(r.saldo_final, 0);
  assert.equal(r.saldo_inicial, 0);
  assert.equal(r.saidas, 0);
  assert.equal(r.contas, 2);
});

test("saldo inicial + entradas - saidas = saldo final, e o futuro fica de fora", () => {
  // Hoje a conta tem 1.300: comecou outubro com 1.000, recebeu 3.000 no dia 5,
  // pagou 2.500 no dia 10 e tem 200 de luz lancados para o dia 28 (futuro).
  const r = calcularSaldoEmConta({
    contas: [{ ...corrente, current_balance: 1300 }],
    lancamentos: [
      { id: "a", account_id: "cc", amount: 3000, transaction_date: "2026-10-05" },
      { id: "b", account_id: "cc", amount: -2500, transaction_date: "2026-10-10" },
      { id: "c", account_id: "cc", amount: -200, transaction_date: "2026-10-28" },
    ],
    ...outubro,
    hoje: "2026-10-24",
  });
  assert.equal(r.saldo_inicial, 1000);
  assert.equal(r.entradas, 3000);
  assert.equal(r.saidas, 2500);
  assert.equal(r.saldo_final, 1500);
  assert.equal(r.ate, "2026-10-24");
});

test("o fim de um mes e o comeco do seguinte", () => {
  const contas = [{ ...corrente, current_balance: 700 }];
  const lancamentos = [
    { id: "a", account_id: "cc", amount: 500, transaction_date: "2026-09-15" },
    { id: "b", account_id: "cc", amount: -300, transaction_date: "2026-10-03" },
  ];
  const hoje = "2026-10-24";
  const setembro = calcularSaldoEmConta({
    contas, lancamentos, de: "2026-09-01", ate: "2026-09-30", hoje,
  });
  const out = calcularSaldoEmConta({ contas, lancamentos, ...outubro, hoje });
  assert.equal(setembro.saldo_final, 1000);
  assert.equal(out.saldo_inicial, setembro.saldo_final);
  assert.equal(out.saldo_final, 700);
});

test("pagamento de fatura e saida; transferencia entre contas de dinheiro nao e", () => {
  const r = calcularSaldoEmConta({
    contas: [{ ...corrente, current_balance: 400 }, { ...dinheiro, current_balance: 100 }, c6],
    lancamentos: [
      // fatura do C6 paga pela corrente: a perna do cartao nao e desta soma
      { id: "f1", account_id: "cc", amount: -500, transaction_date: "2026-10-10", counterpart_transaction_id: "f2" },
      { id: "f2", account_id: "c6", amount: 500, transaction_date: "2026-10-10", counterpart_transaction_id: "f1" },
      // saque de 100 da corrente para o dinheiro
      { id: "s1", account_id: "cc", amount: -100, transaction_date: "2026-10-12", counterpart_transaction_id: "s2" },
      { id: "s2", account_id: "din", amount: 100, transaction_date: "2026-10-12", counterpart_transaction_id: "s1" },
    ],
    ...outubro,
    hoje: "2026-10-24",
  });
  assert.equal(r.saidas, 500);
  assert.equal(r.entradas, 0);
  assert.equal(r.saldo_inicial, 1000);
  assert.equal(r.saldo_final, 500);
});

test("conta fora dos totais nao soma", () => {
  assert.deepEqual(
    contasDeDinheiro([corrente, { ...dinheiro, include_in_total: false }, c6]).map((c) => c.id),
    ["cc"]
  );
});

test("periodo futuro: saldo de hoje, sem movimento", () => {
  const r = calcularSaldoEmConta({
    contas: [{ ...corrente, current_balance: 800 }],
    lancamentos: [
      { id: "c", account_id: "cc", amount: -200, transaction_date: "2026-11-05" },
    ],
    de: "2026-11-01",
    ate: "2026-11-30",
    hoje: "2026-10-24",
  });
  assert.equal(r.saldo_inicial, 1000);
  assert.equal(r.saldo_final, 1000);
  assert.equal(r.entradas + r.saidas, 0);
});

test("o rotulo diz se o numero e do fim do periodo ou de hoje", () => {
  const base = { de: "2026-09-01", ate: "2026-09-30", nomeDoPeriodo: "setembro de 2026" };
  const passado = rotuloDoSaldoEmConta({ ...base, hoje: "2026-10-24" });
  assert.equal(passado.titulo, "Saldo em conta no fim");
  assert.match(passado.nota, /setembro de 2026/);
  const atual = rotuloDoSaldoEmConta({ ...base, hoje: "2026-09-15" });
  assert.match(atual.nota, /^Hoje/);
  assert.ok(!atual.nota.includes("setembro"));
  const futuro = rotuloDoSaldoEmConta({ ...base, hoje: "2026-08-20" });
  assert.equal(futuro.mostrarMovimento, false);
  assert.match(futuro.titulo, /hoje/);
});

// =============================================================================
// O MES DE CADA CONTA (lib/saldo-por-conta.ts) -- comparacao com o Minhas
// Financas. Os numeros sao os da tela Contas de la, em 06/11/2026.
// =============================================================================

const { mesDasContas, limitesDoMes } = await import(
  "../.tmp-saldo-em-conta/lib/saldo-por-conta.js"
);

const CORRENTE = "c1";
const POUPANCA = "c2";
const CARTAO = "k1";

// Saldo de hoje = 178,17 - 100 (despesa paga) - 200 (fatura parcial).
const contasDoMF = [
  { id: CORRENTE, account_type: "checking", current_balance: -121.83 },
  { id: CARTAO, account_type: "credit_card", current_balance: -700 },
];

const lancamentosDoMF = [
  { id: "t1", account_id: CORRENTE, amount: -100, transaction_date: "2026-11-06" },
  // A perna de saida do pagamento da fatura; a de entrada esta no cartao e
  // aponta para ela.
  { id: "t2", account_id: CORRENTE, amount: -200, transaction_date: "2026-11-06" },
];
const paresDoMF = [
  { id: "t3", account_id: CARTAO, counterpart_transaction_id: "t2" },
];
const previstasDoMF = [
  { id: "p1", account_id: CORRENTE, amount: 50, due_date: "2026-11-20", classe: "expense" },
  { id: "p2", account_id: CORRENTE, amount: 1000, due_date: "2026-11-26", classe: "income" },
  { id: "p3", account_id: CORRENTE, amount: 200, due_date: "2026-11-06", classe: "expense" },
  // Fora do mes: nao entra.
  { id: "p4", account_id: CORRENTE, amount: 999, due_date: "2026-12-01", classe: "expense" },
];

test("mes da conta: os numeros da tela Contas do Minhas Financas", () => {
  const r = mesDasContas({
    contas: contasDoMF,
    lancamentos: lancamentosDoMF,
    pares: paresDoMF,
    previstas: previstasDoMF,
    mes: "2026-11",
    hoje: "2026-11-06",
  });
  assert.equal(r.de, "2026-11-01");
  assert.equal(r.ate, "2026-11-30");
  // O cartao nao e conta de dinheiro: fica fora da lista.
  assert.deepEqual(r.contas.map((c) => c.conta_id), [CORRENTE]);
  const c = r.contas[0];
  assert.equal(c.saldo_inicial, 178.17);
  assert.equal(c.receitas, 1000);
  // Paga (100) + pendente (50) + fixa (200) + pagamento da fatura (200).
  assert.equal(c.despesas, 550);
  assert.equal(c.transf_credito, 0);
  assert.equal(c.transf_debito, 0);
  assert.equal(c.saldo, -121.83);
  assert.equal(c.previsto, 628.17);
  assert.deepEqual(r.total, {
    saldo_inicial: 178.17,
    receitas: 1000,
    despesas: 550,
    transf_credito: 0,
    transf_debito: 0,
    saldo: -121.83,
    previsto: 628.17,
  });
});

test("mes da conta: transferencia entre contas de dinheiro vai para as colunas de transferencia", () => {
  const r = mesDasContas({
    contas: [
      { id: CORRENTE, account_type: "checking", current_balance: 700 },
      { id: POUPANCA, account_type: "savings", current_balance: 300 },
    ],
    lancamentos: [
      { id: "s", account_id: CORRENTE, amount: -300, transaction_date: "2026-11-03" },
      { id: "e", account_id: POUPANCA, amount: 300, transaction_date: "2026-11-03", counterpart_transaction_id: "s" },
    ],
    previstas: [
      { id: "p", account_id: CORRENTE, destination_account_id: POUPANCA, amount: 100, due_date: "2026-11-20", classe: "transfer" },
    ],
    mes: "2026-11",
    hoje: "2026-11-06",
  });
  const [corrente, poupanca] = r.contas;
  assert.equal(corrente.transf_debito, 400);
  assert.equal(corrente.despesas, 0);
  assert.equal(poupanca.transf_credito, 400);
  assert.equal(poupanca.receitas, 0);
  assert.equal(corrente.saldo_inicial, 1000);
  assert.equal(poupanca.saldo_inicial, 0);
  assert.equal(corrente.previsto, 600);
  assert.equal(poupanca.previsto, 400);
  // No total as duas pontas se anulam no previsto.
  assert.equal(r.total.previsto, 1000);
});

test("mes da conta: transferencia prevista para o cartao e despesa", () => {
  const r = mesDasContas({
    contas: [
      { id: CORRENTE, account_type: "checking", current_balance: 500 },
      { id: CARTAO, account_type: "credit_card", current_balance: -500 },
    ],
    lancamentos: [],
    previstas: [
      { id: "p", account_id: CORRENTE, destination_account_id: CARTAO, amount: 500, due_date: "2026-11-23", classe: "transfer" },
    ],
    mes: "2026-11",
    hoje: "2026-11-06",
  });
  assert.equal(r.contas[0].despesas, 500);
  assert.equal(r.contas[0].transf_debito, 0);
  assert.equal(r.contas[0].previsto, 0);
});

test("mes da conta: mes passado fecha no fim dele, e o seguinte comeca ali", () => {
  const contas = [{ id: CORRENTE, account_type: "checking", current_balance: 1000 }];
  const lancamentos = [
    { id: "a", account_id: CORRENTE, amount: 200, transaction_date: "2026-10-10" },
    { id: "b", account_id: CORRENTE, amount: -50, transaction_date: "2026-11-02" },
  ];
  const outubro = mesDasContas({ contas, lancamentos, mes: "2026-10", hoje: "2026-11-06" });
  const novembro = mesDasContas({ contas, lancamentos, mes: "2026-11", hoje: "2026-11-06" });
  assert.equal(outubro.contas[0].saldo_inicial, 850);
  assert.equal(outubro.contas[0].receitas, 200);
  assert.equal(outubro.contas[0].saldo, 1050);
  assert.equal(novembro.contas[0].saldo_inicial, outubro.contas[0].saldo);
  assert.equal(novembro.contas[0].saldo, 1000);
});

test("mes da conta: mes futuro tem saldo igual ao inicial e o previsto anda", () => {
  const r = mesDasContas({
    contas: [{ id: CORRENTE, account_type: "checking", current_balance: 1000 }],
    lancamentos: [
      // Lancamento de data futura, ja gravado: conta no mes dele.
      { id: "f", account_id: CORRENTE, amount: -100, transaction_date: "2026-12-10" },
    ],
    previstas: [
      { id: "p", account_id: CORRENTE, amount: 400, due_date: "2026-12-05", classe: "income" },
    ],
    mes: "2026-12",
    hoje: "2026-11-06",
  });
  const c = r.contas[0];
  assert.equal(c.saldo_inicial, 1100);
  assert.equal(c.saldo, 1100);
  assert.equal(c.despesas, 100);
  assert.equal(c.receitas, 400);
  assert.equal(c.previsto, 1400);
});

test("mes da conta: conta fora dos totais aparece na lista mas nao no total", () => {
  const r = mesDasContas({
    contas: [
      { id: CORRENTE, account_type: "checking", current_balance: 100 },
      { id: POUPANCA, account_type: "savings", current_balance: 900, include_in_total: false },
    ],
    lancamentos: [],
    mes: "2026-11",
    hoje: "2026-11-06",
  });
  assert.equal(r.contas.length, 2);
  assert.equal(r.total.saldo, 100);
});

test("mes da conta: mes ilegivel e null, e os limites do mes", () => {
  assert.equal(mesDasContas({ contas: [], lancamentos: [], mes: "2026-13", hoje: "2026-11-06" }), null);
  assert.deepEqual(limitesDoMes("2027-02"), { de: "2027-02-01", ate: "2027-02-28" });
  assert.deepEqual(limitesDoMes("2028-02"), { de: "2028-02-01", ate: "2028-02-29" });
  assert.equal(limitesDoMes("nov"), null);
});

test("mes da conta: saldo zerado nao sai como -0", () => {
  const r = mesDasContas({
    contas: [{ id: CORRENTE, account_type: "checking", current_balance: 0 }],
    lancamentos: [],
    mes: "2026-11",
    hoje: "2026-11-06",
  });
  assert.ok(!Object.is(r.contas[0].saldo, -0));
  assert.ok(!Object.is(r.total.previsto, -0));
});

// =============================================================================
// O RELATORIO DE LANCAMENTOS COM DATA DE REFERENCIA (lib/relatorio-de-lancamentos.ts)
// =============================================================================

const { montarRelatorio, dataDaEfetivada, dataDaPendente } = await import(
  "../.tmp-saldo-em-conta/lib/relatorio-de-lancamentos.js"
);

// Conta de luz: lancada em 28/10, vencia 05/11, paga em 03/11.
const luz = {
  id: "luz",
  description: "Luz",
  amount: -150,
  transaction_type: "expense",
  transaction_date: "2026-11-03",
  expected_date: "2026-11-05",
  launch_date: "2026-10-28",
  tags: ["casa"],
};
// Compra sem as datas da 027: vale a data da transacao nas tres referencias.
const mercado = {
  id: "mercado",
  description: "Mercado",
  amount: -80,
  transaction_type: "expense",
  transaction_date: "2026-11-10",
};
const salario = {
  id: "sal",
  description: "Salário",
  amount: 5000,
  transaction_type: "income",
  transaction_date: "2026-11-05",
};
const transferencia = {
  id: "tr",
  description: "Para a poupança",
  amount: -500,
  transaction_type: "transfer",
  transaction_date: "2026-11-05",
};
const fora = { ...mercado, id: "fora", description: "Ajuste", include_in_total: false };
const aluguel = {
  id: "alug",
  description: "Aluguel",
  amount: 2000,
  direction: "expense",
  due_date: "2026-11-10",
  created_at: "2026-10-01T12:00:00Z",
};

const base = {
  efetivadas: [luz, mercado, salario, transferencia, fora],
  pendentes: [aluguel],
  de: "2026-11-01",
  ate: "2026-11-30",
  situacao: "todas",
};

test("relatorio: as tres datas da mesma conta de luz", () => {
  assert.equal(dataDaEfetivada(luz, "lancamento"), "2026-10-28");
  assert.equal(dataDaEfetivada(luz, "vencimento"), "2026-11-05");
  assert.equal(dataDaEfetivada(luz, "efetivacao"), "2026-11-03");
  assert.equal(dataDaEfetivada(mercado, "vencimento"), "2026-11-10");
  assert.equal(dataDaPendente(aluguel, "efetivacao"), null);
  assert.equal(dataDaPendente(aluguel, "lancamento"), "2026-10-01");
});

test("relatorio: por vencimento, novembro tem a luz, o mercado e o aluguel pendente", () => {
  const r = montarRelatorio({ ...base, referencia: "vencimento" });
  // Por data, e no mesmo dia pela descricao.
  assert.deepEqual(r.linhas.map((l) => l.id), ["luz", "sal", "fora", "alug", "mercado"]);
  assert.equal(r.receitas, 5000);
  // 150 + 80 + 2000; o "Ajuste" fora dos totais aparece e nao soma.
  assert.equal(r.despesas, 2230);
  assert.equal(r.saldo, 2770);
  // A transferencia nao entra.
  assert.ok(!r.linhas.some((l) => l.id === "tr"));
});

test("relatorio: por lancamento, a luz anotada em outubro sai de novembro", () => {
  const r = montarRelatorio({ ...base, referencia: "lancamento" });
  assert.ok(!r.linhas.some((l) => l.id === "luz"));
  // O aluguel foi lancado em 01/10: tambem fora.
  assert.ok(!r.linhas.some((l) => l.id === "alug"));
});

test("relatorio: por efetivacao, nenhuma pendente entra", () => {
  const r = montarRelatorio({ ...base, referencia: "efetivacao" });
  assert.ok(r.linhas.every((l) => l.origem === "efetivada"));
});

test("relatorio: situacao, tipo e tag recortam", () => {
  const pend = montarRelatorio({ ...base, referencia: "vencimento", situacao: "pendentes" });
  assert.deepEqual(pend.linhas.map((l) => l.id), ["alug"]);
  const efet = montarRelatorio({ ...base, referencia: "vencimento", situacao: "efetivadas" });
  assert.ok(efet.linhas.every((l) => l.origem === "efetivada"));
  const receitas = montarRelatorio({ ...base, referencia: "vencimento", tipo: "income" });
  assert.deepEqual(receitas.linhas.map((l) => l.id), ["sal"]);
  assert.equal(receitas.despesas, 0);
  const casa = montarRelatorio({ ...base, referencia: "vencimento", tag: "casa" });
  assert.deepEqual(casa.linhas.map((l) => l.id), ["luz"]);
});
