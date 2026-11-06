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
