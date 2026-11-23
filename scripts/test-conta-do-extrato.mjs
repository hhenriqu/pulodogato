#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DA CONTA DO EXTRATO
// =====================================================
//   npm run test:conta-do-extrato
//
// Exercita lib/conta-do-extrato.ts: sem conta escolhida, o arquivo do C6 ou
// do Mercado Pago vai para a conta da ultima importacao, para a conta com o
// nome do banco, ou para uma conta (ou cartao) criada na hora.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { contaParaOrigem, vencimentoPeloNome, fechamentoDoC6 } = await import(
  "../.tmp-conta-do-extrato/conta-do-extrato.js"
);

// As contas do Helio em 23/11/2026, como o app lista.
const contas = [
  { id: "c6-cartao", name: "C6", account_type: "credit_card" },
  { id: "c6-invest", name: "C6 Investimentos", account_type: "investment" },
  { id: "corrente", name: "Conta Corrente", account_type: "checking" },
  { id: "itau", name: "Cartão Itaú", account_type: "credit_card" },
  { id: "ml", name: "Mercado Livre", account_type: "credit_card" },
  { id: "mp-invest", name: "Mercado Pago", account_type: "investment" },
  { id: "mp-conta", name: "Mercado Pago Conta", account_type: "digital" },
];

test("a fatura do C6 vai para o cartao C6 que ja existe", () => {
  assert.deepEqual(contaParaOrigem({ origem: "c6_cartao", contas }), {
    acao: "usar",
    id: "c6-cartao",
    motivo: "pelo_nome",
  });
});

test("o extrato da conta do C6 vai para a conta da ultima importacao, mesmo sem C6 no nome", () => {
  assert.deepEqual(contaParaOrigem({ origem: "c6_conta", contas, ultimaUsada: "corrente" }), {
    acao: "usar",
    id: "corrente",
    motivo: "ultima_importacao",
  });
});

test("a conta de investimento nunca recebe o extrato da conta", () => {
  const r = contaParaOrigem({ origem: "c6_conta", contas });
  assert.equal(r.acao, "criar");
  assert.equal(r.conta.name, "C6 Conta");
  assert.equal(r.conta.account_type, "checking");
  // A ultima importacao numa conta que nao serve (cartao) e ignorada.
  assert.equal(contaParaOrigem({ origem: "c6_conta", contas, ultimaUsada: "c6-cartao" }).acao, "criar");
});

test("o Mercado Pago vai para a conta digital, nao para a de investimento", () => {
  assert.deepEqual(contaParaOrigem({ origem: "mercadopago_conta", contas }), {
    acao: "usar",
    id: "mp-conta",
    motivo: "pelo_nome",
  });
});

test("sem conta do Mercado Pago, cria com um nome que nao existe (QA B2)", () => {
  const semConta = contas.filter((c) => c.id !== "mp-conta");
  const r = contaParaOrigem({ origem: "mercadopago_conta", contas: semConta });
  assert.equal(r.acao, "criar");
  assert.equal(r.conta.name, "Mercado Pago Conta");
  assert.equal(r.conta.account_type, "digital");
  const comOsDoisNomes = [...semConta, { id: "x", name: "Mercado Pago Conta", account_type: "investment" }, { id: "y", name: "Conta Mercado Pago", account_type: "other" }];
  assert.equal(contaParaOrigem({ origem: "mercadopago_conta", contas: comOsDoisNomes }).conta.name, "Mercado Pago Conta 2");
});

test("sem cartao C6, cria o cartao com o vencimento do nome do arquivo", () => {
  const semCartao = contas.filter((c) => c.id !== "c6-cartao");
  const r = contaParaOrigem({ origem: "c6_cartao", contas: semCartao, nomeDoArquivo: "Fatura_2026-11-20.csv" });
  assert.equal(r.acao, "criar");
  assert.deepEqual(
    { name: r.conta.name, tipo: r.conta.account_type, vence: r.conta.due_day, fecha: r.conta.closing_day },
    { name: "Cartão C6", tipo: "credit_card", vence: 20, fecha: 13 }
  );
  // Sem o dia no nome, os dois ficam em branco para o usuario preencher.
  const semDia = contaParaOrigem({ origem: "c6_cartao", contas: semCartao, nomeDoArquivo: "fatura.csv" });
  assert.equal(semDia.conta.due_day, null);
  assert.equal(semDia.conta.closing_day, null);
});

test("conta inativa nao recebe extrato", () => {
  const inativo = [{ id: "velho", name: "Cartão C6", account_type: "credit_card", is_active: false }];
  assert.equal(contaParaOrigem({ origem: "c6_cartao", contas: inativo, ultimaUsada: "velho" }).acao, "criar");
  assert.equal(contaParaOrigem({ origem: "c6_cartao", contas: inativo }).conta.name, "Cartão C6 Bank");
});

test("'C6' so casa como palavra: 'ABC60' nao e o C6", () => {
  const r = contaParaOrigem({ origem: "c6_cartao", contas: [{ id: "z", name: "ABC60", account_type: "credit_card" }] });
  assert.equal(r.acao, "criar");
});

test("vencimento e fechamento pelo nome do arquivo", () => {
  assert.equal(vencimentoPeloNome("Fatura_2026-11-20.csv"), 20);
  assert.equal(vencimentoPeloNome("Fatura_2026-11.csv"), null);
  assert.equal(fechamentoDoC6(20), 13);
  assert.equal(fechamentoDoC6(5), 28);
  assert.equal(fechamentoDoC6(null), null);
});
