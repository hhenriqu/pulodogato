#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DAS PARCELAS DA FATURA IMPORTADA
// =====================================================
//   npm run test:parcelas-da-fatura-importada
//
// Exercita lib/parcelas-da-fatura-importada.ts: a parcela k/N importada da
// fatura do C6 ganha as k+1..N (uma por fatura), sem repetir a que ja existe,
// e a parcela que ja nasceu numa importacao anterior e reconhecida para o
// vinculo. E o que faz o TOTAL para quitar os cartoes ver a compra inteira.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  descricaoDaSerie,
  mesDaFaturaMais,
  parcelaJaGravada,
  parcelasQueFaltam,
  temParcelasPelaFrente,
} = await import("../.tmp-parcelas-da-fatura-importada/parcelas-da-fatura-importada.js");

const solar = {
  numero: 3,
  total: 10,
  mesDaFatura: "2026-11-01",
  valor: -2200,
  descricao: "PLACA SOLAR (3/10)",
};

test("a descricao da serie ignora o (k/N), a caixa e os espacos", () => {
  assert.equal(descricaoDaSerie("PLACA  SOLAR (3/10)"), "placa solar");
  assert.equal(descricaoDaSerie("Placa Solar ( 4 / 10 )"), "placa solar");
  assert.equal(descricaoDaSerie("Mercado"), "mercado");
});

test("o mes da fatura anda pelo calendario, virando o ano", () => {
  assert.equal(mesDaFaturaMais("2026-11-01", 1), "2026-12-01");
  assert.equal(mesDaFaturaMais("2026-11-01", 2), "2027-01-01");
  assert.equal(mesDaFaturaMais("2026-01-01", -1), "2025-12-01");
  assert.equal(mesDaFaturaMais("lixo", 1), null);
});

test("a placa solar 3/10 ganha as parcelas 4 a 10, uma por fatura", () => {
  const faltam = parcelasQueFaltam(solar, []);
  assert.equal(faltam.length, 7);
  assert.deepEqual(
    faltam.map((f) => `${f.mesDaFatura}=${f.numero}`),
    [
      "2026-12-01=4",
      "2027-01-01=5",
      "2027-02-01=6",
      "2027-03-01=7",
      "2027-04-01=8",
      "2027-05-01=9",
      "2027-06-01=10",
    ]
  );
  assert.equal(faltam[0].descricao, "PLACA SOLAR (4/10)");
  assert.equal(faltam[6].descricao, "PLACA SOLAR (10/10)");
  assert.ok(faltam.every((f) => f.valor === -2200 && f.dataDoLancamento === f.mesDaFatura));
  // O que o TOTAL passa a ver: as 7 que faltam somam 15.400.
  assert.equal(faltam.reduce((s, f) => s - f.valor, 0), 15400);
});

test("a parcela que ja existe nao se repete", () => {
  const gravadas = [
    { id: "a", numero: 4, total: 10, mesDaFatura: "2026-12-01", valor: -2200, descricao: "Placa Solar (4/10)", vinculada: false },
    { id: "b", numero: 5, total: 10, mesDaFatura: "2027-01-01", valor: -2200, descricao: "PLACA SOLAR (5/10)", vinculada: true },
  ];
  assert.deepEqual(
    parcelasQueFaltam(solar, gravadas).map((f) => f.numero),
    [6, 7, 8, 9, 10]
  );
});

test("outra compra (valor, N ou descricao diferentes) nao conta como a mesma serie", () => {
  const outras = [
    { id: "a", numero: 4, total: 10, mesDaFatura: "2026-12-01", valor: -2199.99, descricao: "PLACA SOLAR (4/10)", vinculada: false },
    { id: "b", numero: 4, total: 12, mesDaFatura: "2026-12-01", valor: -2200, descricao: "PLACA SOLAR (4/12)", vinculada: false },
    { id: "c", numero: 4, total: 10, mesDaFatura: "2026-12-01", valor: -2200, descricao: "INVERSOR (4/10)", vinculada: false },
  ];
  assert.equal(parcelasQueFaltam(solar, outras).length, 7);
});

test("a ultima parcela, a vista e o estorno zerado nao ganham nada", () => {
  assert.deepEqual(parcelasQueFaltam({ ...solar, numero: 10, descricao: "PLACA SOLAR (10/10)" }, []), []);
  assert.equal(temParcelasPelaFrente({ numero: null, total: null, valor: -50 }), false);
  assert.equal(temParcelasPelaFrente({ numero: 1, total: 1, valor: -50 }), false);
  assert.equal(temParcelasPelaFrente({ numero: 1, total: 2, valor: 0 }), false);
  assert.equal(temParcelasPelaFrente({ numero: 1, total: 2, valor: -50 }), true);
});

test("a parcela de agora reconhece a que a fatura anterior ja gravou", () => {
  const proxima = { ...solar, numero: 4, mesDaFatura: "2026-12-01", descricao: "PLACA SOLAR (4/10)" };
  const gravadas = [
    { id: "proj-4", numero: 4, total: 10, mesDaFatura: "2026-12-01", valor: -2200, descricao: "PLACA SOLAR (4/10)", vinculada: false },
    { id: "proj-5", numero: 5, total: 10, mesDaFatura: "2027-01-01", valor: -2200, descricao: "PLACA SOLAR (5/10)", vinculada: false },
  ];
  assert.equal(parcelaJaGravada(proxima, gravadas)?.id, "proj-4");
  // E nao cria a 5 de novo.
  assert.deepEqual(parcelasQueFaltam(proxima, gravadas).map((f) => f.numero), [6, 7, 8, 9, 10]);
});

test("nao reconhece a parcela ja vinculada a outra linha, nem a de outra fatura", () => {
  const proxima = { ...solar, numero: 4, mesDaFatura: "2026-12-01", descricao: "PLACA SOLAR (4/10)" };
  assert.equal(
    parcelaJaGravada(proxima, [
      { id: "x", numero: 4, total: 10, mesDaFatura: "2026-12-01", valor: -2200, descricao: "PLACA SOLAR (4/10)", vinculada: true },
      { id: "y", numero: 4, total: 10, mesDaFatura: "2027-01-01", valor: -2200, descricao: "PLACA SOLAR (4/10)", vinculada: false },
    ]),
    null
  );
});
