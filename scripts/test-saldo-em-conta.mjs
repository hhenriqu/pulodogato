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
