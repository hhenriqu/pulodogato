#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DO PAINEL DE ASSINATURAS
// =====================================================
//   npm run test:painel-de-assinaturas
//
// Exercita lib/painel-de-assinaturas.ts: a lista unica (contas fixas marcadas +
// cobrancas do extrato), o que fica fora da conta e por que, os totais e quanto
// as assinaturas pesam na renda mensal. Ver docs/ASSINATURAS.md.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { montarPainelDeAssinaturas, faixaDoPeso } = await import(
  "../.tmp-painel-de-assinaturas/painel-de-assinaturas.js"
);

const netflixFixa = {
  id: "f1",
  descricao: "Netflix",
  valor: 55.9,
  frequencia: "monthly",
  intervalo: 1,
  diaDoVencimento: 10,
  contaId: "c1",
  custoMensal: 55.9,
};

const seguroAnual = {
  id: "f2",
  descricao: "Seguro do celular",
  valor: 480,
  frequencia: "annual",
  intervalo: 1,
  diaDoVencimento: 5,
  contaId: "c1",
  custoMensal: 40,
};

function detectada(id, merchant, custo, status, extra = {}) {
  return {
    id,
    merchant_key: merchant,
    display_name: merchant.toUpperCase(),
    avg_amount: String(custo),
    monthly_cost: String(custo),
    frequency: "MONTHLY",
    occurrences: 4,
    last_charge_date: "2026-11-03",
    next_expected_date: "2026-12-03",
    status,
    ...extra,
  };
}

test("junta contas fixas e cobrancas do extrato numa lista so, da mais cara para a mais barata", () => {
  const painel = montarPainelDeAssinaturas({
    fixas: [seguroAnual, netflixFixa],
    detectadas: [
      detectada("d1", "spotify", 21.9, "CONFIRMED"),
      detectada("d2", "academia", 120, "DETECTED"),
    ],
    chavesDasFixas: ["netflix", "seguro do celular"],
    rendaMensal: null,
  });

  assert.deepEqual(
    painel.itens.map((i) => [i.origem, i.nome]),
    [
      ["extrato", "ACADEMIA"],
      ["conta-fixa", "Netflix"],
      ["conta-fixa", "Seguro do celular"],
      ["extrato", "SPOTIFY"],
    ]
  );
  assert.equal(painel.totalMensal, 237.8);
  assert.equal(painel.totalAnual, 2853.6);
  assert.equal(painel.quantidade, 4);
});

test("custo anual e fatia do total de cada uma", () => {
  const painel = montarPainelDeAssinaturas({
    fixas: [seguroAnual],
    detectadas: [detectada("d1", "spotify", 60, "CONFIRMED")],
    chavesDasFixas: [],
    rendaMensal: null,
  });

  const [spotify, seguro] = painel.itens;
  assert.equal(spotify.custoAnual, 720);
  assert.equal(spotify.participacao, 60);
  assert.equal(seguro.custoAnual, 480);
  assert.equal(seguro.valorDaCobranca, 480);
  assert.equal(seguro.participacao, 40);
});

test("detectada ainda nao confirmada entra na conta e fica marcada para revisar", () => {
  const painel = montarPainelDeAssinaturas({
    fixas: [],
    detectadas: [
      detectada("d1", "spotify", 21.9, "CONFIRMED"),
      detectada("d2", "academia", 120, "DETECTED"),
    ],
    chavesDasFixas: [],
    rendaMensal: null,
  });

  assert.equal(painel.paraRevisar, 1);
  assert.deepEqual(
    painel.itens.map((i) => [i.nome, i.paraRevisar]),
    [
      ["ACADEMIA", true],
      ["SPOTIFY", false],
    ]
  );
});

test("ignorada, cancelada e repetida de conta fixa saem da conta, cada uma com o motivo", () => {
  const painel = montarPainelDeAssinaturas({
    fixas: [netflixFixa],
    detectadas: [
      detectada("d1", "netflix", 55.9, "CONFIRMED"),
      detectada("d2", "hbo", 34.9, "CANCELLED"),
      detectada("d3", "padaria", 80, "IGNORED"),
      detectada("d4", "spotify", 21.9, "DETECTED"),
    ],
    chavesDasFixas: ["netflix"],
    rendaMensal: null,
  });

  assert.deepEqual(
    painel.itens.map((i) => i.nome),
    ["Netflix", "SPOTIFY"]
  );
  assert.equal(painel.totalMensal, 77.8);
  assert.deepEqual(
    painel.foraDaConta.map((f) => [f.nome, f.motivo]),
    [
      ["PADARIA", "ignorada"],
      ["NETFLIX", "ja-e-conta-fixa"],
      ["HBO", "cancelada"],
    ]
  );
});

test("peso na renda: porcentagem com uma casa e a faixa", () => {
  const painel = montarPainelDeAssinaturas({
    fixas: [netflixFixa, seguroAnual],
    detectadas: [],
    chavesDasFixas: [],
    rendaMensal: 4000,
  });

  assert.equal(painel.totalMensal, 95.9);
  assert.equal(painel.percentualDaRenda, 2.4);
  assert.equal(painel.faixa, "leve");
});

test("sem renda fixa cadastrada (0) ou sem leitura (null), nao ha porcentagem", () => {
  const base = { fixas: [netflixFixa], detectadas: [], chavesDasFixas: [] };

  const semRenda = montarPainelDeAssinaturas({ ...base, rendaMensal: 0 });
  assert.equal(semRenda.percentualDaRenda, null);
  assert.equal(semRenda.faixa, null);
  assert.equal(semRenda.rendaMensal, 0);

  const semLeitura = montarPainelDeAssinaturas({ ...base, rendaMensal: null });
  assert.equal(semLeitura.percentualDaRenda, null);
  assert.equal(semLeitura.rendaMensal, null);
});

test("faixas: ate 5% leve, ate 10% atencao, acima disso pesado", () => {
  assert.equal(faixaDoPeso(5), "leve");
  assert.equal(faixaDoPeso(5.1), "atencao");
  assert.equal(faixaDoPeso(10), "atencao");
  assert.equal(faixaDoPeso(10.1), "pesado");
});

test("nada cadastrado: lista vazia, total zero e participacao sem dividir por zero", () => {
  const painel = montarPainelDeAssinaturas({
    fixas: [],
    detectadas: [],
    chavesDasFixas: [],
    rendaMensal: 3000,
  });

  assert.deepEqual(painel.itens, []);
  assert.equal(painel.totalMensal, 0);
  assert.equal(painel.percentualDaRenda, 0);
  assert.equal(painel.faixa, "leve");
});

test("datas: conta fixa leva o dia do vencimento, a do extrato leva proxima e ultima", () => {
  const painel = montarPainelDeAssinaturas({
    fixas: [netflixFixa],
    detectadas: [detectada("d1", "spotify", 21.9, "CONFIRMED")],
    chavesDasFixas: [],
    rendaMensal: null,
  });

  const [netflix, spotify] = painel.itens;
  assert.equal(netflix.diaDoVencimento, 10);
  assert.equal(netflix.proximaCobranca, null);
  assert.equal(spotify.proximaCobranca, "2026-12-03");
  assert.equal(spotify.ultimaCobranca, "2026-11-03");
});
