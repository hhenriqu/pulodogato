#!/usr/bin/env node
// =====================================================
// PULODOGATO - o acerto dos grupos nas minhas despesas (HMO-175)
// =====================================================
// `lib/grupos.ts` pega as linhas de `group_member_balances` e responde a
// pergunta da tela de Financas Pessoais: somando todos os meus grupos, eu devo
// ou tenho a receber?
//
// O que este arquivo cobra sao os erros que NAO aparecem na tela:
//
//   - o sinal. A view fala na convencao do credor (positivo = a receber) e a
//     tela fala na do devedor ("o valor que EU vou ter que pagar"). Trocar os
//     dois mostra "voce tem R$ 345 a receber" para quem deve R$ 345, com o
//     numero, o simbolo e a formatacao todos certos;
//   - a tolerancia de um centavo, que tem que ser a MESMA de
//     `simplifySettlements`. Se ela discordar, a tela cobra uma divida de
//     R$ 0,01 que o acerto do grupo se recusa a gerar -- a pessoa abre o grupo
//     para pagar e nao encontra pagamento nenhum;
//   - o liquido que mente. Dever R$ 500 num grupo e ter R$ 500 a receber em
//     outro da liquido zero, e "tudo quitado" e falso: ninguem paga um grupo
//     com o credito que esta em outro, com outras pessoas;
//   - o grupo quitado, que sai da LISTA mas continua contado.
//
// A prova de que o teste nao e uma fixture inocente esta em
// `scripts/mutantes-grupos.mjs`, que quebra cada uma dessas regras no codigo e
// exige que a suite reprove.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  resumoDosGrupos,
  rotuloDoResumo,
  precisaDetalhar,
} from "../.tmp-grupos/grupos.js";

/** Uma linha da view, no formato em que a rota a entrega. */
function linha(extra = {}) {
  return {
    group_id: "g1",
    nome: "Viagem",
    net_balance: 0,
    total_paid: 0,
    total_owed: 0,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// O SINAL
// ---------------------------------------------------------------------------

test("net_balance negativo vira divida POSITIVA na tela", () => {
  const resumo = resumoDosGrupos([
    linha({ net_balance: -345, total_paid: 0, total_owed: 345 }),
  ]);

  assert.equal(resumo.grupos.length, 1);
  assert.equal(resumo.grupos[0].devo, 345);
  assert.equal(resumo.aPagar, 345);
  assert.equal(resumo.aReceber, 0);
  assert.equal(resumo.liquido, 345);
});

// O controle positivo do caso acima: sem ele, um codigo que devolvesse
// `Math.abs()` passaria nos dois -- e `Math.abs` e exatamente o "conserto"
// que alguem escreve ao ver um sinal trocado na tela.
test("net_balance positivo vira credito, e nao vira divida", () => {
  const resumo = resumoDosGrupos([
    linha({ net_balance: 345, total_paid: 345, total_owed: 0 }),
  ]);

  assert.equal(resumo.grupos[0].devo, -345);
  assert.equal(resumo.aPagar, 0);
  assert.equal(resumo.aReceber, 345);
  assert.equal(resumo.liquido, -345);
});

test("o rotulo acompanha o sinal, nos tres estados", () => {
  const devendo = rotuloDoResumo(resumoDosGrupos([linha({ net_balance: -20 })]));
  assert.equal(devendo.estado, "devo");
  assert.equal(devendo.valor, 20);
  assert.match(devendo.titulo, /deve aos grupos/);

  const recebendo = rotuloDoResumo(resumoDosGrupos([linha({ net_balance: 20 })]));
  assert.equal(recebendo.estado, "recebo");
  assert.equal(recebendo.valor, 20);
  assert.notEqual(recebendo.titulo, devendo.titulo);

  const zerado = rotuloDoResumo(resumoDosGrupos([linha({ net_balance: 0 })]));
  assert.equal(zerado.estado, "quitado");
  assert.equal(zerado.valor, 0);
});

// ---------------------------------------------------------------------------
// A TOLERANCIA DE UM CENTAVO
// ---------------------------------------------------------------------------

test("saldo de um centavo nao vira divida na lista", () => {
  const resumo = resumoDosGrupos([
    linha({ group_id: "g1", net_balance: -0.01 }),
    linha({ group_id: "g2", net_balance: 0.01 }),
  ]);

  assert.deepEqual(resumo.grupos, []);
  assert.equal(resumo.aPagar, 0);
  assert.equal(resumo.aReceber, 0);
});

test("dois centavos ja contam", () => {
  const resumo = resumoDosGrupos([linha({ net_balance: -0.02 })]);

  assert.equal(resumo.grupos.length, 1);
  assert.equal(resumo.grupos[0].devo, 0.02);
});

test("tres pessoas dividindo R$ 100 nao deixam divida fantasma", () => {
  // O caso que existe so em ponto flutuante: 100/3 = 33.333..., e a soma dos
  // tres nao fecha em 100. Em centavos inteiros a conta e exata, e quem pagou
  // sua parte exata sai da lista em vez de dever R$ 0,0000001 para sempre.
  const resumo = resumoDosGrupos([
    linha({ net_balance: 100 / 3 - 100 / 3, total_paid: 100 / 3 }),
  ]);

  assert.deepEqual(resumo.grupos, []);
  assert.equal(resumo.liquido, 0);
});

// ---------------------------------------------------------------------------
// VARIOS GRUPOS
// ---------------------------------------------------------------------------

test("grupos em sentidos opostos nao se cancelam na leitura", () => {
  const resumo = resumoDosGrupos([
    linha({ group_id: "viagem", nome: "Viagem", net_balance: -500 }),
    linha({ group_id: "casa", nome: "Casa", net_balance: 500 }),
  ]);

  // O liquido de fato e zero -- e justamente por isso ele nao pode ser a
  // unica coisa na tela.
  assert.equal(resumo.liquido, 0);
  assert.equal(resumo.aPagar, 500);
  assert.equal(resumo.aReceber, 500);
  assert.equal(precisaDetalhar(resumo), true);
  assert.equal(resumo.grupos.length, 2);
});

test("so um sentido nao pede detalhamento", () => {
  const resumo = resumoDosGrupos([
    linha({ group_id: "a", net_balance: -10 }),
    linha({ group_id: "b", net_balance: -20 }),
  ]);

  assert.equal(precisaDetalhar(resumo), false);
  assert.equal(resumo.aPagar, 30);
  assert.equal(resumo.liquido, 30);
});

test("grupo quitado sai da lista mas continua contado", () => {
  const resumo = resumoDosGrupos([
    linha({ group_id: "a", net_balance: -10 }),
    linha({ group_id: "b", net_balance: 0 }),
  ]);

  assert.equal(resumo.grupos.length, 1);
  assert.equal(resumo.totalDeGrupos, 2);
});

test("a ordem e deterministica quando dois grupos empatam", () => {
  const entrada = [
    linha({ group_id: "zzz", net_balance: -50 }),
    linha({ group_id: "aaa", net_balance: -50 }),
  ];

  const primeiro = resumoDosGrupos(entrada).grupos.map((g) => g.group_id);
  const segundo = resumoDosGrupos([...entrada].reverse()).grupos.map(
    (g) => g.group_id
  );

  assert.deepEqual(primeiro, ["aaa", "zzz"]);
  assert.deepEqual(primeiro, segundo);
});

test("a maior divida vem primeiro, e o credito vai para o fim", () => {
  const resumo = resumoDosGrupos([
    linha({ group_id: "medio", net_balance: -50 }),
    linha({ group_id: "credito", net_balance: 90 }),
    linha({ group_id: "maior", net_balance: -300 }),
  ]);

  assert.deepEqual(
    resumo.grupos.map((g) => g.group_id),
    ["maior", "medio", "credito"]
  );
});

// ---------------------------------------------------------------------------
// O QUE A LINHA CARREGA JUNTO
// ---------------------------------------------------------------------------

test("pago e devido chegam na linha, para a tela explicar a conta", () => {
  const resumo = resumoDosGrupos([
    linha({ net_balance: -100, total_paid: 200, total_owed: 300 }),
  ]);

  assert.equal(resumo.grupos[0].total_paid, 200);
  assert.equal(resumo.grupos[0].total_owed, 300);
  // A divida e devido - pago, e nao um dos dois sozinho.
  assert.equal(resumo.grupos[0].devo, 100);
});

test("grupo sem nome nao some da lista", () => {
  // Um grupo sem nome ainda e dinheiro em aberto. Descartar a linha por causa
  // do rotulo esconderia a divida da tela inteira.
  const resumo = resumoDosGrupos([linha({ nome: null, net_balance: -42 })]);

  assert.equal(resumo.grupos.length, 1);
  assert.equal(resumo.grupos[0].devo, 42);
  assert.equal(typeof resumo.grupos[0].nome, "string");
  assert.notEqual(resumo.grupos[0].nome, "");
});

test("sem grupo nenhum a resposta e vazia, e nao um erro", () => {
  const resumo = resumoDosGrupos([]);

  assert.deepEqual(resumo.grupos, []);
  assert.equal(resumo.totalDeGrupos, 0);
  assert.equal(resumo.liquido, 0);
  assert.equal(rotuloDoResumo(resumo).estado, "quitado");
});
