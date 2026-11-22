#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DA COMPOSICAO DA FATURA
// =====================================================
//   npm run test:composicao-da-fatura
//
// Exercita lib/composicao-da-fatura.ts: em que fatia cada compra do cartao cai
// (fixo, assinatura, parcelado, esporadico), a composicao do mes e o TOTAL para
// quitar os cartoes. Ver docs/COMPOSICAO-DA-FATURA.md.
//
// Os valores esperados foram escritos a mao a partir da regra.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  classificarLinha,
  classificarCobranca,
  composicaoDaFatura,
  quitacaoDoCartao,
  faturaEntraNaQuitacao,
  somarComposicoes,
  fatiasDaComposicao,
  recorrenteDa,
  mesDeslocado,
} = await import("../.tmp-composicao-da-fatura/composicao-da-fatura.js");

const chave = (d) => d.toLowerCase().replace(/[^a-z]+/g, " ").trim();

function rec(extra = {}) {
  return {
    regraDaBaixa: new Map([["t-academia", "r-academia"], ["t-netflix", "r-netflix"]]),
    assinaturaDaRegra: new Map([["r-academia", false], ["r-netflix", true]]),
    transacoesDeAssinatura: new Set(["t-spotify"]),
    chavesDeAssinatura: new Set(["youtube premium"]),
    chavesFixas: new Set(["seguro do carro"]),
    chave,
    ...extra,
  };
}

const linha = (id, mes, valor, extra = {}) => ({
  transaction_id: id,
  account_id: "c1",
  invoice_month: mes,
  invoice_amount: valor,
  description: extra.description ?? id,
  installment_total: extra.installment_total ?? null,
});

test("a parcela vence tudo, ate a descricao de conta fixa", () => {
  const l = linha("t-x", "2026-12-01", 100, {
    description: "Seguro do carro (2/10)",
    installment_total: 10,
  });
  assert.equal(classificarLinha(l, rec()), "parcelado");
});

test("a compra que veio da baixa de uma conta fixa e fixo ou assinatura pela marca da regra", () => {
  assert.equal(classificarLinha(linha("t-academia", "2026-12-01", 99), rec()), "fixo");
  assert.equal(classificarLinha(linha("t-netflix", "2026-12-01", 55.9), rec()), "assinatura");
});

test("o extrato reconhece assinatura pela transacao e pela chave do lojista", () => {
  assert.equal(classificarLinha(linha("t-spotify", "2026-12-01", 21.9), rec()), "assinatura");
  assert.equal(
    classificarLinha(linha("t-yt", "2026-12-01", 24.9, { description: "YouTube Premium" }), rec()),
    "assinatura"
  );
});

test("a descricao de conta fixa sem baixa e fixo; o resto e esporadico", () => {
  assert.equal(
    classificarLinha(linha("t-s", "2026-12-01", 300, { description: "SEGURO DO CARRO" }), rec()),
    "fixo"
  );
  assert.equal(
    classificarLinha(linha("t-m", "2026-12-01", 80, { description: "Mercado" }), rec()),
    "esporadico"
  );
  assert.equal(classificarLinha(linha("t-v", "2026-12-01", 80, { description: "" }), rec()), "esporadico");
});

test("a cobranca prevista e classificada pela regra; a avulsa e esporadica", () => {
  const base = { account_id: "c1", invoice_month: "2026-12-01", amount: 10, direction: "expense" };
  assert.equal(classificarCobranca({ ...base, recurring_rule_id: "r-netflix" }, rec()), "assinatura");
  assert.equal(classificarCobranca({ ...base, recurring_rule_id: "r-academia" }, rec()), "fixo");
  assert.equal(classificarCobranca({ ...base, recurring_rule_id: null }, rec()), "esporadico");
});

test("a composicao do mes soma as linhas daquele mes e as cobrancas dele, em centavos", () => {
  const linhas = [
    linha("t-academia", "2026-12-01", 99.9),
    linha("t-p", "2026-12-01", "100.10", { installment_total: 3 }),
    linha("t-m", "2026-12-01", 0.1, { description: "Mercado" }),
    linha("t-m2", "2026-12-01", 0.2, { description: "Padaria" }),
    linha("t-estorno", "2026-12-01", -0.05, { description: "Estorno padaria" }),
    linha("t-jan", "2027-01-01", 500, { installment_total: 3 }),
  ];
  const cobrancas = [
    { account_id: "c1", invoice_month: "2026-12-01", amount: 55.9, direction: "expense", recurring_rule_id: "r-netflix" },
    { account_id: "c1", invoice_month: "2027-01-01", amount: 55.9, direction: "expense", recurring_rule_id: "r-netflix" },
  ];
  const c = composicaoDaFatura({ linhas, cobrancas, mes: "2026-12-01", rec: rec() });
  assert.deepEqual(c, {
    fixo: 99.9,
    assinatura: 55.9,
    parcelado: 100.1,
    esporadico: 0.25,
    total: 256.15,
  });
});

test("o credito previsto no cartao abate", () => {
  const c = composicaoDaFatura({
    linhas: [],
    cobrancas: [
      { account_id: "c1", invoice_month: "2026-12-01", amount: 10, direction: "income", recurring_rule_id: null },
    ],
    mes: "2026-12-01",
    rec: rec(),
  });
  assert.equal(c.esporadico, -10);
  assert.equal(c.total, -10);
});

test("mesDeslocado atravessa o ano", () => {
  assert.equal(mesDeslocado("2026-01-01", -1), "2025-12-01");
  assert.equal(mesDeslocado("2026-12-01", 1), "2027-01-01");
});

test("que faturas ainda sao divida", () => {
  const aberto = "2026-12-01";
  // a aberta e as seguintes, sem registro
  assert.equal(faturaEntraNaQuitacao("2026-12-01", aberto, undefined), true);
  assert.equal(faturaEntraNaQuitacao("2027-05-01", aberto, undefined), true);
  // a fechada logo antes, sem registro: ainda a pagar
  assert.equal(faturaEntraNaQuitacao("2026-11-01", aberto, undefined), true);
  // mais antiga sem registro: paga fora do app (historico importado)
  assert.equal(faturaEntraNaQuitacao("2026-10-01", aberto, undefined), false);
  // pendente na agenda entra, por mais antiga que seja
  assert.equal(faturaEntraNaQuitacao("2026-08-01", aberto, "pendente"), true);
  // paga nunca entra, nem a aberta paga adiantado
  assert.equal(faturaEntraNaQuitacao("2026-11-01", aberto, "paga"), false);
  assert.equal(faturaEntraNaQuitacao("2026-12-01", aberto, "paga"), false);
});

test("o total para quitar: parcelas futuras e esporadicos em aberto, fixo so do mes atual", () => {
  const linhas = [
    // novembro: fechada e paga
    linha("t-nov", "2026-11-01", 1000, { description: "Mercado" }),
    // dezembro (aberta)
    linha("t-academia", "2026-12-01", 99.9),
    linha("t-tv-1", "2026-12-01", 300, { installment_total: 3, description: "TV (1/3)" }),
    linha("t-m", "2026-12-01", 150, { description: "Restaurante" }),
    // janeiro e fevereiro: as outras parcelas da TV e uma compra depois do fechamento
    linha("t-tv-2", "2027-01-01", 300, { installment_total: 3 }),
    linha("t-tv-3", "2027-02-01", 300, { installment_total: 3 }),
    linha("t-depois", "2027-01-01", 40, { description: "Farmacia" }),
  ];
  const cobrancas = [
    { account_id: "c1", invoice_month: "2026-12-01", amount: 55.9, direction: "expense", recurring_rule_id: "r-netflix" },
    // a assinatura de janeiro NAO entra
    { account_id: "c1", invoice_month: "2027-01-01", amount: 55.9, direction: "expense", recurring_rule_id: "r-netflix" },
  ];
  const situacoes = new Map([["2026-11-01", "paga"]]);
  const q = quitacaoDoCartao({ linhas, cobrancas, mesAberto: "2026-12-01", situacoes, rec: rec() });
  assert.deepEqual(q, {
    fixo: 99.9,
    assinatura: 55.9,
    parcelado: 900,
    esporadico: 190,
    total: 1245.8,
  });
});

test("a fatura fechada ainda nao paga entra no total para quitar", () => {
  const linhas = [linha("t-nov", "2026-11-01", 1000, { description: "Mercado" })];
  const semRegistro = quitacaoDoCartao({
    linhas, cobrancas: [], mesAberto: "2026-12-01", situacoes: new Map(), rec: rec(),
  });
  assert.equal(semRegistro.total, 1000);
  const pendente = quitacaoDoCartao({
    linhas, cobrancas: [], mesAberto: "2026-12-01",
    situacoes: new Map([["2026-11-01", "pendente"]]), rec: rec(),
  });
  assert.equal(pendente.esporadico, 1000);
});

test("somar cartoes, recorrente e fatias da rosca", () => {
  const a = { fixo: 0.1, assinatura: 0.2, parcelado: 10, esporadico: -5, total: 5.3 };
  const b = { fixo: 0.2, assinatura: 0, parcelado: 0, esporadico: 7, total: 7.2 };
  const s = somarComposicoes([a, b]);
  assert.deepEqual(s, { fixo: 0.3, assinatura: 0.2, parcelado: 10, esporadico: 2, total: 12.5 });
  assert.equal(recorrenteDa(s), 0.5);

  // a fatia negativa sai da rosca; a ordem e a da legenda
  const fatias = fatiasDaComposicao(a);
  assert.deepEqual(fatias.map((f) => f.tipo), ["fixo", "assinatura", "parcelado"]);
  const soma = fatias.reduce((x, f) => x + f.parte, 0);
  assert.ok(Math.abs(soma - 1) < 1e-9);
  assert.deepEqual(fatiasDaComposicao({ fixo: 0, assinatura: 0, parcelado: 0, esporadico: 0, total: 0 }), []);
});
