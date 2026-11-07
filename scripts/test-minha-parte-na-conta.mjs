#!/usr/bin/env node
// =====================================================
// PULODOGATO - "VOCE EMPRESTOU / VOCE DEVE" NA LISTA DO GRUPO
// =====================================================
//   npm run test:minha-parte-na-conta
//
// Exercita lib/minha-parte-na-conta.ts: a frase da direita de cada conta na
// tela do grupo, e as setas de mes da lista. Mesmo desenho do
// test-settlement.mjs: .mjs sobre o .js que o tsc compila, sem runner novo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { minhaPosicaoNaConta, mesVizinho } = await import(
  "../.tmp-minha-parte-na-conta/minha-parte-na-conta.js"
);

const conta = (pagador, partes, amount = 100) => ({
  amount,
  payer: pagador === undefined ? null : { id: pagador },
  splits: partes.map(([id, valor]) => ({ amount: valor, member: { id } })),
});

test("paguei e divido: emprestei o total menos a minha parte", () => {
  const r = minhaPosicaoNaConta(conta("eu", [["eu", 50], ["ana", 50]]), "eu");
  assert.deepEqual(r, { tipo: "emprestou", valor: 50 });
});

test("paguei e nao estou na divisao: emprestei tudo", () => {
  const r = minhaPosicaoNaConta(conta("eu", [["ana", 100]]), "eu");
  assert.deepEqual(r, { tipo: "emprestou", valor: 100 });
});

test("paguei so para mim: nao participa de divida nenhuma", () => {
  const r = minhaPosicaoNaConta(conta("eu", [["eu", 100]]), "eu");
  assert.equal(r.tipo, "fora");
});

test("outro pagou e eu estou na divisao: devo a minha parte", () => {
  const r = minhaPosicaoNaConta(
    conta("ana", [["eu", 33.33], ["ana", 33.33], ["bia", 33.34]]),
    "eu"
  );
  assert.deepEqual(r, { tipo: "deve", valor: 33.33 });
});

test("outro pagou e eu nao estou na divisao: fora", () => {
  const r = minhaPosicaoNaConta(conta("ana", [["ana", 50], ["bia", 50]]), "eu");
  assert.equal(r.tipo, "fora");
});

test("membro sem conta (id null) nunca e 'eu', nem com userId ausente", () => {
  const semConta = {
    amount: 100,
    payer: { id: null },
    splits: [{ amount: 100, member: { id: null } }],
  };
  assert.equal(minhaPosicaoNaConta(semConta, null).tipo, "fora");
  assert.equal(minhaPosicaoNaConta(semConta, undefined).tipo, "fora");
  assert.equal(minhaPosicaoNaConta(semConta, "eu").tipo, "fora");
});

test("parte com membro null (resposta da rota) nao quebra", () => {
  const r = minhaPosicaoNaConta(
    { amount: 80, payer: { id: "ana" }, splits: [{ amount: 80, member: null }] },
    "eu"
  );
  assert.equal(r.tipo, "fora");
});

test("mesVizinho atravessa a virada do ano nos dois sentidos", () => {
  assert.equal(mesVizinho("2026-11", 1), "2026-12");
  assert.equal(mesVizinho("2026-12", 1), "2027-01");
  assert.equal(mesVizinho("2026-01", -1), "2025-12");
  assert.equal(mesVizinho("2026-03", -14), "2025-01");
});

test("mesVizinho devolve o proprio valor quando nao e um mes", () => {
  assert.equal(mesVizinho("", 1), "");
  assert.equal(mesVizinho("lixo", -1), "lixo");
});
