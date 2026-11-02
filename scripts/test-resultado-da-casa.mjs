#!/usr/bin/env node
// =====================================================
// PULODOGATO - a visao da casa (078): a soma do mes da familia
// =====================================================
// A metade TypeScript da 078, em lib/resultado-da-casa.ts: a conta que a tela
// faz com as linhas de `resultado_da_casa` e `saldos_da_casa`. A metade de
// banco (quem aparece, o interno, a conta conjunta) esta em
// database/tests/078_visao_da_casa_test.sql, com os MESMOS numeros do caso
// Ana/Beto abaixo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  resumirACasa,
  resumirSaldos,
  intervaloDoMes,
  statusDoErroDaCasa,
} from "../.tmp-resultado-da-casa/resultado-da-casa.js";

const ANA = "a";
const BETO = "b";
const membros = [
  { member_id: "m1", user_id: ANA, nome: "Ana", role: "admin", dependente: false, compartilha: true, sou_eu: true },
  { member_id: "m2", user_id: BETO, nome: "Beto", role: "member", dependente: false, compartilha: true, sou_eu: false },
  { member_id: "m3", user_id: "c", nome: "Caio", role: "member", dependente: false, compartilha: false, sou_eu: false },
  { member_id: "m4", user_id: null, nome: "Lia", role: "member", dependente: true, compartilha: false, sou_eu: false },
];

// O caso do teste SQL: Ana paga farmacia 15 e o mercado de 90 da casa (dividido
// em tres); Beto recebe 2000, gasta 20 na conjunta e deve 30 do mercado.
const outubro = [
  { user_id: ANA, month: "2026-10-01", currency: "BRL", income: "0.00", expense: "105.00", net: "-105.00", interno_expense: "0.00" },
  { user_id: BETO, month: "2026-10-01", currency: "BRL", income: "2000.00", expense: "50.00", net: "1950.00", interno_expense: "30.00" },
];

test("a casa tira o que um membro deve ao outro: saiu 125, e nao 155", () => {
  const r = resumirACasa(outubro, membros);
  assert.deepEqual(r.totais, [
    { currency: "BRL", entrou: 2000, saiu: 125, resultado: 1875, interno: 30 },
  ]);
});

test("controle: sem o interno, a soma seria 155 (o caso que o modulo existe para evitar)", () => {
  const semInterno = outubro.map((l) => ({ ...l, interno_expense: 0 }));
  assert.equal(resumirACasa(semInterno, membros).totais[0].saiu, 155);
});

test("cada membro aparece com o numero do painel dele, sem desconto", () => {
  const r = resumirACasa(outubro, membros);
  assert.deepEqual(
    r.porMembro.map((m) => [m.nome, m.entrou, m.saiu, m.resultado]),
    [
      ["Ana", 0, 105, -105],
      ["Beto", 2000, 50, 1950],
    ]
  );
});

test("conta quem tem conta e nao compartilha; o dependente nao conta", () => {
  assert.equal(resumirACasa(outubro, membros).naoCompartilham, 1);
});

test("moedas nao se misturam, e a principal vem primeiro", () => {
  const r = resumirACasa(
    [
      ...outubro,
      { user_id: ANA, month: "2026-10-01", currency: "USD", income: 0, expense: 40, net: -40, interno_expense: 0 },
      { user_id: BETO, month: "2026-10-01", currency: "EUR", income: 10, expense: 0, net: 10, interno_expense: 0 },
    ],
    membros,
    "USD"
  );
  assert.deepEqual(r.totais.map((t) => t.currency), ["USD", "BRL", "EUR"]);
  assert.equal(r.totais[0].saiu, 40);
  assert.equal(r.totais[1].saiu, 125);
});

test("varios meses somam em centavos, sem sobra de ponto flutuante", () => {
  const linhas = Array.from({ length: 10 }, (_, i) => ({
    user_id: ANA, month: `2026-0${(i % 9) + 1}-01`, currency: "BRL",
    income: "0.10", expense: "0.20", net: "-0.10", interno_expense: "0.00",
  }));
  const t = resumirACasa(linhas, membros).totais[0];
  assert.equal(t.entrou, 1);
  assert.equal(t.saiu, 2);
  assert.equal(t.resultado, -1);
});

test("casa sem movimento: sem totais, e a tela mostra zero", () => {
  const r = resumirACasa([], membros);
  assert.deepEqual(r.totais, []);
  assert.deepEqual(r.porMembro, []);
});

test("saldos: a conjunta com o dono, o total de cada um e a soma por moeda", () => {
  const s = resumirSaldos(
    [
      { tipo: "conjunta", account_id: "f1", nome_da_conta: "Conjunta", account_type: "checking", user_id: ANA, currency: "BRL", saldo: "1000.00" },
      { tipo: "pessoal", account_id: null, nome_da_conta: null, account_type: null, user_id: BETO, currency: "BRL", saldo: "2300.00" },
      { tipo: "pessoal", account_id: null, nome_da_conta: null, account_type: null, user_id: ANA, currency: "BRL", saldo: "395.00" },
    ],
    membros
  );
  assert.deepEqual(s.conjuntas, [
    { account_id: "f1", nome: "Conjunta", currency: "BRL", saldo: 1000, dono: "Ana" },
  ]);
  assert.deepEqual(s.porMembro.map((m) => [m.nome, m.saldo]), [["Ana", 395], ["Beto", 2300]]);
  assert.deepEqual(s.totais, [{ currency: "BRL", saldo: 3695 }]);
});

test("o mes da URL vira o intervalo do banco, com o ultimo dia certo", () => {
  assert.deepEqual(intervaloDoMes("2026-02"), { mes: "2026-02", desde: "2026-02-01", ate: "2026-02-28" });
  assert.deepEqual(intervaloDoMes("2028-02"), { mes: "2028-02", desde: "2028-02-01", ate: "2028-02-29" });
  assert.deepEqual(intervaloDoMes("2026-10"), { mes: "2026-10", desde: "2026-10-01", ate: "2026-10-31" });
});

test("mes invalido ou ausente vira o mes de hoje", () => {
  const hoje = new Date(2026, 10, 2);
  for (const mes of [undefined, null, "", "2026-13", "2026-1", "outubro"]) {
    assert.equal(intervaloDoMes(mes, hoje).mes, "2026-11");
  }
});

test("o erro do banco vira o status certo", () => {
  assert.equal(statusDoErroDaCasa({ code: "42501" }), 403);
  assert.equal(statusDoErroDaCasa({ code: "P0002" }), 404);
  assert.equal(statusDoErroDaCasa({ code: "XX000" }), 500);
  assert.equal(statusDoErroDaCasa(null), 500);
});
