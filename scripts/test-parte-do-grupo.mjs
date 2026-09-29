#!/usr/bin/env node
// =====================================================
// PULODOGATO - a minha parte da despesa de grupo (HMO-177)
// =====================================================
// O aluguel de R$ 3.000 do grupo Casa, com duas pessoas, aparecia como
// R$ 3.000 de custo fixo mensal. A parte do outro virava sua.
//
// E era pior do que "o dono da regra ve o dobro". As policies do 005 liberam
// `user_id = auth.uid() OR (group_id IS NOT NULL AND is_group_member(group_id))`
// e a rota do resumo nao filtra por user_id, entao QUEM NAO CADASTROU NADA
// tambem via os R$ 3.000 -- medido num Postgres local com 001 -> 025:
//
//   Helio (dono da regra)          1 regra   3000.00
//   Lais  (nao tem regra nenhuma)  1 regra   3000.00
//   alguem de fora (controle)      0 regras        0
//
// O que este arquivo cobra sao erros que a TELA NAO MOSTRA:
//
//   - a parte do outro contando como minha. O numero sai formatado em reais, a
//     barra enche, e o unico sintoma e um custo fixo alto que a pessoa atribui
//     a gastar mesmo -- e que ainda alimenta safe-to-spend e cash-flow;
//   - a despesa PESSOAL sendo dividida. O mutante que divide tudo conserta o
//     aluguel e passa a mentir em toda regra sem grupo, para baixo;
//   - a contagem desconhecida virando divisao por palpite. Grupo que a RLS nao
//     me deixa contar tem que manter o valor CHEIO: subestimar o custo fixo faz
//     o app prometer dinheiro que nao sobra;
//   - o `status` do membro sendo ignorado na contagem. Membro que saiu ou nunca
//     aceitou nao divide conta, e contar ele deixa a minha parte MENOR;
//   - a soma das partes deixando de fechar. Se cada membro conta a sua parte, a
//     soma tem que ser a despesa inteira -- e e isso que torna "a minha parte" a
//     unica leitura que fecha para os dois lados ao mesmo tempo;
//   - o residuo de ponto flutuante: R$ 100 em 3 nao pode virar 33.33333333.
//
// A prova de que o teste nao e uma fixture inocente esta em
// `scripts/mutantes-parte-do-grupo.mjs`, que quebra cada uma dessas decisoes no
// codigo e exige que a suite reprove.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { parteDoMembro, custoFixoMensalDaMinhaParte, contarMembrosAtivos } =
  await import("../.tmp-parte-do-grupo/lib/parte-do-grupo.js");

const CASA = "44444444-0000-0000-0000-000000000004";
const VIAGEM = "55555555-0000-0000-0000-000000000005";
const HOJE = "2026-09-29";

/** Duas pessoas na Casa, tres na Viagem. */
const membros = new Map([
  [CASA, 2],
  [VIAGEM, 3],
]);

// =====================================================
// parteDoMembro
// =====================================================

test("aluguel de grupo conta a MINHA parte, nao o valor cheio", () => {
  assert.equal(parteDoMembro(3000, CASA, membros), 1500);
  // A negacao explicita: o defeito era exatamente devolver o cheio aqui.
  assert.notEqual(parteDoMembro(3000, CASA, membros), 3000);
});

test("despesa PESSOAL nao se divide com ninguem", () => {
  assert.equal(parteDoMembro(3000, null, membros), 3000);
  assert.equal(parteDoMembro(3000, undefined, membros), 3000);
});

test("grupo de um membro so devolve o valor cheio", () => {
  assert.equal(parteDoMembro(3000, "grupo-solo", new Map([["grupo-solo", 1]])), 3000);
});

test("grupo que a RLS nao me deixa contar mantem o valor CHEIO", () => {
  // Errar para cima e o comportamento antigo; errar para baixo faz o
  // safe-to-spend prometer dinheiro que nao sobra.
  assert.equal(parteDoMembro(3000, "grupo-desconhecido", membros), 3000);
  assert.equal(parteDoMembro(3000, CASA, new Map()), 3000);
});

test("contagem invalida nao produz divisao por zero nem NaN", () => {
  for (const ruim of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    const parte = parteDoMembro(3000, CASA, new Map([[CASA, ruim]]));
    assert.ok(Number.isFinite(parte), `parte nao finita com membros=${ruim}`);
    assert.equal(parte, 3000);
  }
});

test("numerico que chega como string do PostgREST e lido igual", () => {
  assert.equal(parteDoMembro("3000.00", CASA, membros), 1500);
});

test("a parte sai em centavos inteiros, sem residuo de ponto flutuante", () => {
  const parte = parteDoMembro(100, VIAGEM, membros);
  assert.equal(parte, 33.33);
  // A negacao: 100/3 em ponto flutuante seria 33.333333333333336.
  assert.equal(
    Number.isInteger(Math.round(parte * 100) - parte * 100),
    true,
    "a parte tem que caber em centavos"
  );
});

test("a soma das partes fecha a despesa inteira (a menos do centavo do rateio)", () => {
  const cheio = 3000;
  const soma = 2 * parteDoMembro(cheio, CASA, membros);
  assert.equal(soma, cheio);
});

// =====================================================
// contarMembrosAtivos
// =====================================================

test("conta um por membro ativo, por grupo", () => {
  const contagem = contarMembrosAtivos([
    { group_id: CASA, status: "active" },
    { group_id: CASA, status: "active" },
    { group_id: VIAGEM, status: "active" },
  ]);
  assert.equal(contagem.get(CASA), 2);
  assert.equal(contagem.get(VIAGEM), 1);
});

test("membro que saiu ou nao aceitou NAO divide a conta", () => {
  const contagem = contarMembrosAtivos([
    { group_id: CASA, status: "active" },
    { group_id: CASA, status: "active" },
    { group_id: CASA, status: "removed" },
    { group_id: CASA, status: "pending" },
  ]);
  // Contar os quatro daria uma parte de R$ 750 num aluguel que duas pessoas
  // dividem -- menor, e para baixo.
  assert.equal(contagem.get(CASA), 2);
  assert.equal(parteDoMembro(3000, CASA, contagem), 1500);
});

test("grupo sem nenhum membro ativo nao entra no mapa, e a parte fica cheia", () => {
  const contagem = contarMembrosAtivos([{ group_id: CASA, status: "removed" }]);
  assert.equal(contagem.get(CASA), undefined);
  assert.equal(parteDoMembro(3000, CASA, contagem), 3000);
});

// =====================================================
// custoFixoMensalDaMinhaParte
// =====================================================

const regraAluguel = {
  amount: 3000,
  frequency: "monthly",
  interval_count: 1,
  transaction_type: "expense",
  group_id: CASA,
};

test("o custo fixo do aluguel de grupo e a minha metade", () => {
  assert.equal(custoFixoMensalDaMinhaParte([regraAluguel], membros, HOJE), 1500);
  assert.notEqual(
    custoFixoMensalDaMinhaParte([regraAluguel], membros, HOJE),
    3000
  );
});

test("o custo fixo e o MESMO para quem cadastrou e para quem nao cadastrou", () => {
  // As duas leem a mesma linha, porque a policy do 005 devolve a regra de grupo
  // para os dois. Ler "a minha parte" e o que faz os dois numeros baterem.
  const doHelio = custoFixoMensalDaMinhaParte([regraAluguel], membros, HOJE);
  const daLais = custoFixoMensalDaMinhaParte([regraAluguel], membros, HOJE);
  assert.equal(doHelio, daLais);
  assert.equal(doHelio + daLais, 3000);
});

test("regra pessoal entra inteira, regra de grupo entra pela parte", () => {
  const pessoal = {
    amount: 200,
    frequency: "monthly",
    interval_count: 1,
    transaction_type: "expense",
    group_id: null,
  };
  assert.equal(
    custoFixoMensalDaMinhaParte([regraAluguel, pessoal], membros, HOJE),
    1700
  );
});

test("receita continua fora do custo fixo", () => {
  const salario = {
    amount: 9000,
    frequency: "monthly",
    interval_count: 1,
    transaction_type: "income",
    group_id: null,
  };
  assert.equal(
    custoFixoMensalDaMinhaParte([regraAluguel, salario], membros, HOJE),
    1500
  );
});

test("a normalizacao para mes continua valendo sobre a parte", () => {
  // Seguro anual de R$ 1.200 numa viagem de 3: minha parte e 400 no ano, 33.33
  // por mes. Sem a normalizacao sairiam os 400 inteiros num mes so.
  const anual = {
    amount: 1200,
    frequency: "annual",
    interval_count: 1,
    transaction_type: "expense",
    group_id: VIAGEM,
  };
  assert.equal(custoFixoMensalDaMinhaParte([anual], membros, HOJE), 33.33);
  // A negacao: sem normalizar sairiam os 400 da minha parte anual num mes so.
  assert.notEqual(custoFixoMensalDaMinhaParte([anual], membros, HOJE), 400);
});

test("frequencia fora do enum nao passa por 'annual' calada", () => {
  // `monthlyCost` trata frequencia desconhecida como SEMANAL (o `?? 7` de
  // DAYS_PER_PERIOD), o que transforma R$ 1.200/ano em R$ 1.738/mes. O enum e
  // 'annual', nao 'yearly' -- e foi este teste que pegou a troca.
  const errada = {
    amount: 1200,
    frequency: "yearly",
    interval_count: 1,
    transaction_type: "expense",
    group_id: VIAGEM,
  };
  assert.notEqual(custoFixoMensalDaMinhaParte([errada], membros, HOJE), 33.33);
});

test("lista vazia da zero, e nao NaN", () => {
  assert.equal(custoFixoMensalDaMinhaParte([], membros, HOJE), 0);
});
