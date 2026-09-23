#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DO ACERTO DE CONTAS
// =====================================================
//   npm run test:settlement
//
// Exercita lib/settlement.ts. O que importa aqui nao e o numero de
// transferencias -- e que a conta FECHE: depois de aplicar a lista sugerida,
// todo mundo tem que ficar em zero, ate o centavo. Cada teste abaixo aplica as
// transferencias de volta nos saldos e confere isso.
//
// Mesmo desenho do test-recurrence.mjs: .mjs compilado pelo tsc que ja e
// dependencia, sem runner de teste novo no package.json.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { simplifySettlements, residual, toCents, transfersForUser } =
  await import("../.tmp-settlement/settlement.js");

/** Aplica as transferencias nos saldos e devolve o resultado, em centavos. */
function aplicar(balances, transfers) {
  const saldo = new Map(balances.map((b) => [b.user_id, toCents(b.net_balance)]));
  for (const t of transfers) {
    saldo.set(t.from_user_id, saldo.get(t.from_user_id) + toCents(t.amount));
    saldo.set(t.to_user_id, saldo.get(t.to_user_id) - toCents(t.amount));
  }
  return saldo;
}

function esperaTodosZerados(balances, transfers) {
  for (const [user, cents] of aplicar(balances, transfers)) {
    assert.equal(cents, 0, `${user} ficou com ${cents} centavos apos o acerto`);
  }
}

test("caso simples: um deve, um recebe", () => {
  const saldos = [
    { user_id: "ana", net_balance: 150 },
    { user_id: "bia", net_balance: -150 },
  ];
  const t = simplifySettlements(saldos);
  assert.equal(t.length, 1);
  assert.equal(t[0].from_user_id, "bia");
  assert.equal(t[0].to_user_id, "ana");
  assert.equal(t[0].amount, 150);
  esperaTodosZerados(saldos, t);
});

test("tres pessoas, um pagou tudo: duas transferencias, nao seis", () => {
  // Ana pagou 300 de um jantar dividido por tres.
  const saldos = [
    { user_id: "ana", net_balance: 200 },
    { user_id: "bia", net_balance: -100 },
    { user_id: "caio", net_balance: -100 },
  ];
  const t = simplifySettlements(saldos);
  assert.equal(t.length, 2);
  assert.ok(t.every((x) => x.to_user_id === "ana"));
  esperaTodosZerados(saldos, t);
});

test("o guloso quebra uma divida em duas quando precisa", () => {
  const saldos = [
    { user_id: "ana", net_balance: 100 },
    { user_id: "bia", net_balance: 50 },
    { user_id: "caio", net_balance: -150 },
  ];
  const t = simplifySettlements(saldos);
  assert.equal(t.length, 2);
  assert.ok(t.every((x) => x.from_user_id === "caio"));
  esperaTodosZerados(saldos, t);
});

test("no maximo N-1 transferencias para N pessoas", () => {
  const saldos = [
    { user_id: "a", net_balance: -70 },
    { user_id: "b", net_balance: -30 },
    { user_id: "c", net_balance: 45 },
    { user_id: "d", net_balance: 20 },
    { user_id: "e", net_balance: 35 },
  ];
  const t = simplifySettlements(saldos);
  assert.ok(t.length <= saldos.length - 1, `gerou ${t.length} transferencias`);
  esperaTodosZerados(saldos, t);
});

test("R$ 100 divididos por tres: fecha em centavos, sem residuo fantasma", () => {
  // O caso que motiva os centavos inteiros. Em float, 33.333... nao soma 100 e
  // sobra um residuo que nenhuma transferencia consegue quitar.
  const saldos = [
    { user_id: "ana", net_balance: 66.66 },
    { user_id: "bia", net_balance: -33.33 },
    { user_id: "caio", net_balance: -33.33 },
  ];
  const t = simplifySettlements(saldos);
  esperaTodosZerados(saldos, t);
  for (const x of t) {
    assert.ok(x.amount > 0, "nenhuma transferencia pode ser de R$ 0,00");
    assert.equal(
      Math.round(x.amount * 100),
      toCents(x.amount),
      "o valor tem que caber em centavos",
    );
  }
});

test("saldo de um centavo nao vira transferencia", () => {
  const t = simplifySettlements([
    { user_id: "ana", net_balance: 0.01 },
    { user_id: "bia", net_balance: -0.01 },
  ]);
  assert.equal(t.length, 0);
});

test("grupo ja acertado nao sugere nada", () => {
  const t = simplifySettlements([
    { user_id: "ana", net_balance: 0 },
    { user_id: "bia", net_balance: 0 },
    { user_id: "caio", net_balance: 0 },
  ]);
  assert.deepEqual(t, []);
});

test("par que se anula exatamente nao gera transferencia de R$ 0,00", () => {
  // Devedor e credor zeram na mesma rodada (50 contra -50, depois 80 contra
  // -80). Duas defesas independentes impedem o pagamento de R$ 0,00 aqui: a
  // guarda `valor > 0` e o avanco dos DOIS indices. Cada uma basta sozinha --
  // derrubar so uma delas mantem este teste verde, conferido. Ele acusa quando
  // as duas caem, que e o unico estado em que a tela mostraria "pague R$ 0,00".
  const saldos = [
    { user_id: "ana", net_balance: 50 },
    { user_id: "bia", net_balance: -50 },
    { user_id: "caio", net_balance: 80 },
    { user_id: "dan", net_balance: -80 },
  ];
  const t = simplifySettlements(saldos);
  assert.ok(
    t.every((x) => x.amount > 0),
    "gerou transferencia de valor zero",
  );
  assert.equal(t.length, 2);
  esperaTodosZerados(saldos, t);
});

test("resultado e deterministico com saldos empatados", () => {
  const saldos = [
    { user_id: "zeca", net_balance: -50 },
    { user_id: "ana", net_balance: -50 },
    { user_id: "bia", net_balance: 100 },
  ];
  const a = JSON.stringify(simplifySettlements(saldos));
  const b = JSON.stringify(simplifySettlements([...saldos].reverse()));
  assert.equal(a, b, "a ordem de chegada do banco mudou a sugestao");
});

test("residual denuncia o grupo que nao fecha", () => {
  // Despesa de 90 lancada sem rateio: quem pagou fica credor e ninguem devedor.
  assert.equal(residual([{ user_id: "ana", net_balance: 90 }]), 90);
  assert.equal(
    residual([
      { user_id: "ana", net_balance: 60 },
      { user_id: "bia", net_balance: -60 },
    ]),
    0,
  );
});

test("transfersForUser separa o que eu pago do que eu recebo", () => {
  const t = simplifySettlements([
    { user_id: "ana", net_balance: 200 },
    { user_id: "bia", net_balance: -100 },
    { user_id: "caio", net_balance: -100 },
  ]);
  assert.equal(transfersForUser(t, "bia").toPay.length, 1);
  assert.equal(transfersForUser(t, "bia").toReceive.length, 0);
  assert.equal(transfersForUser(t, "ana").toReceive.length, 2);
});
