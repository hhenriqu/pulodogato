#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DAS CONTAS FIXAS MARCADAS COMO ASSINATURA (084)
// =====================================================
//   npm run test:assinaturas-das-contas-fixas
//
// Exercita lib/assinaturas-das-contas-fixas.ts: o custo mensal de cada
// frequencia, o que entra (e o que fica de fora) da lista e o total.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  custoMensalDaRegra,
  assinaturasDasContasFixas,
  totalMensalDasContasFixas,
  rotuloDaFrequenciaDaRegra,
} = await import("../.tmp-assinaturas-das-contas-fixas/assinaturas-das-contas-fixas.js");

test("mensal custa o proprio valor por mes", () => {
  assert.equal(custoMensalDaRegra("monthly", 39.9), 39.9);
});

test("anual divide por 12, trimestral por 3, semanal multiplica por 52/12", () => {
  assert.equal(custoMensalDaRegra("annual", 120), 10);
  assert.equal(custoMensalDaRegra("quarterly", 90), 30);
  assert.equal(custoMensalDaRegra("weekly", 12), 52);
  assert.equal(custoMensalDaRegra("biweekly", 12), 26);
});

test("interval_count divide: mensal a cada 2 meses custa metade por mes", () => {
  assert.equal(custoMensalDaRegra("monthly", 100, 2), 50);
});

test("frequencia desconhecida conta como mensal, e nao some do total", () => {
  assert.equal(custoMensalDaRegra("???", 25), 25);
});

test("so entram regras ativas de despesa, da mais cara para a mais barata", () => {
  const lista = assinaturasDasContasFixas([
    { id: "a", description: "Netflix", amount: "39.90", frequency: "monthly" },
    { id: "b", description: "Seguro", amount: "1200", frequency: "annual" },
    { id: "c", description: "Spotify", amount: 21.9, frequency: "monthly", is_active: false },
    { id: "d", description: "Salario", amount: 5000, frequency: "monthly", transaction_type: "income" },
    { id: "e", description: "Academia", amount: "-120", frequency: "monthly", interval_count: 1 },
  ]);
  assert.deepEqual(lista.map((a) => a.id), ["e", "b", "a"]);
  assert.equal(lista[0].valor, 120);
  assert.equal(lista[1].custoMensal, 100);
  assert.equal(totalMensalDasContasFixas(lista), 259.9);
});

test("rotulo da frequencia", () => {
  assert.equal(rotuloDaFrequenciaDaRegra("monthly", 1), "Mensal");
  assert.equal(rotuloDaFrequenciaDaRegra("monthly", 2), "A cada 2 meses");
  assert.equal(rotuloDaFrequenciaDaRegra("annual", 1), "Anual");
});
