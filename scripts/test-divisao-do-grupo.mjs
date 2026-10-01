#!/usr/bin/env node
// =====================================================
// PULODOGATO - as opcoes de divisao da despesa de grupo (HMO-190)
// =====================================================
// `lib/divisao-do-grupo.ts` decide o que vai ser gravado quando alguem escolhe
// "Por Percentual", "Customizada" ou uma das sugestoes. Antes dela, NENHUMA
// dessas opcoes funcionava: a despesa saia em partes iguais e a tela dizia
// "Despesa adicionada com sucesso!".
//
// O que este arquivo cobra sao os erros que a tela nao mostra:
//
//   - o vocabulario. `split-suggestions` fala `proportional` e `historical`, e
//     o CHECK de group_transactions.split_type aceita so equal/percentage/
//     custom. Mandar a palavra crua e 23514 -- e a rota nao conferia o erro,
//     entao a despesa ficava com o rateio igual do trigger;
//   - o tipo desconhecido virando `equal`. Cair em divisao igual por nao
//     entender a palavra e EXATAMENTE o defeito desta issue: silencio no lugar
//     de erro. Aqui ele tem que devolver null;
//   - o dinheiro que nao fecha. A soma das partes e o valor da despesa, em
//     centavos inteiros. 70/20 nao e uma divisao de 90%: e uma divisao ERRADA,
//     e tem que ser recusada antes de gravar, porque o residual que ela deixa
//     nenhum pagamento zera (a mesma familia de defeito da SECAO 3b da 007);
//   - o arredondamento de porcentagem, que NAO pode ser recusado: 100/3 nao
//     tem duas casas decimais. Os valores sao derivados pelo maior resto e
//     somam o total exato mesmo quando as porcentagens somam 99,99;
//   - a divisao igual reescrita pela tela. A sugestao "Divisao Igual" calcula
//     amount = total * pct / 100 em ponto flutuante e perde centavo; o trigger
//     divide em centavos inteiros e nao perde. Para `equal` esta funcao tem que
//     devolver `partes: null` -- "nao toque no que o banco fez";
//   - o membro repetido, que o banco aceitaria (nao ha indice unico) e que
//     cobraria a mesma pessoa duas vezes.
//
// A prova de que o teste nao e uma fixture inocente esta em
// `scripts/mutantes-divisao-do-grupo.mjs`, que quebra cada uma dessas regras no
// codigo e exige que a suite reprove.
//
// O outro lado da correcao -- a ORDEM de escrita, que a RLS de um membro comum
// obriga -- e provado em `database/tests/hmo190_divisao_combinada_test.sql`:
// nao da para provar em JS que um DELETE barrado pela RLS apaga zero linhas em
// silencio.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  divisaoParaGravar,
  tipoGravavel,
} from "../.tmp-divisao-do-grupo/divisao-do-grupo.js";

/** Soma das partes em centavos, que e onde o dinheiro tem que fechar. */
function somaEmCentavos(partes) {
  return partes.reduce((acc, p) => acc + Math.round(p.amount * 100), 0);
}

function parteDe(partes, memberId) {
  const encontrada = partes.find((p) => p.member_id === memberId);
  assert.ok(encontrada, `nao ha parte para ${memberId}`);
  return encontrada;
}

// =====================================================
// 1. O vocabulario: o que a tela pede x o que a coluna aceita
// =====================================================
test("as tres palavras de porcentagem viram percentage", () => {
  assert.equal(tipoGravavel("percentage"), "percentage");
  // As duas que davam 23514 no UPDATE do split_type.
  assert.equal(tipoGravavel("proportional"), "percentage");
  assert.equal(tipoGravavel("historical"), "percentage");
});

test("equal e custom passam direto, e a ausencia de tipo e equal", () => {
  assert.equal(tipoGravavel("equal"), "equal");
  assert.equal(tipoGravavel("custom"), "custom");
  // `body.split_type` ausente: o default da tela e a divisao igual.
  assert.equal(tipoGravavel(undefined), "equal");
  assert.equal(tipoGravavel(null), "equal");
  assert.equal(tipoGravavel(""), "equal");
});

test("tipo desconhecido devolve null, e NAO equal", () => {
  // Esta e a assercao central do silencio: qualquer palavra nova que a tela
  // invente tem que PARAR a gravacao, nao cair em partes iguais.
  assert.equal(tipoGravavel("proporcional"), null);
  assert.equal(tipoGravavel("fifty-fifty"), null);
  assert.equal(tipoGravavel("equally"), null);
  assert.equal(tipoGravavel(42), null);
});

test("e o tipo desconhecido vira erro, nao divisao igual", () => {
  const r = divisaoParaGravar({
    tipo: "proporcional",
    partes: [{ member_id: "m1", percentage: 100 }],
    total: 300,
  });
  assert.equal(r.ok, false);
  assert.match(r.erro, /desconhecido/i);
});

// =====================================================
// 2. Divisao igual nao reescreve o rateio do trigger
// =====================================================
test("equal devolve partes null mesmo com valores vindos da tela", () => {
  // A sugestao "Divisao Igual" manda amount = 33,33 tres vezes para R$ 100 --
  // soma 99,99. Gravar isso em cima do maior resto do banco TROCARIA uma
  // divisao exata por uma com residuo.
  const r = divisaoParaGravar({
    tipo: "equal",
    partes: [
      { member_id: "m1", percentage: 33.333333, amount: 33.33 },
      { member_id: "m2", percentage: 33.333333, amount: 33.33 },
      { member_id: "m3", percentage: 33.333333, amount: 33.33 },
    ],
    total: 100,
  });
  assert.equal(r.ok, true);
  assert.equal(r.splitType, "equal");
  assert.equal(r.partes, null);
});

// =====================================================
// 3. Porcentagem: o caso do relato, 70/30
// =====================================================
test("70/30 de R$ 300 da R$ 210 e R$ 90", () => {
  const r = divisaoParaGravar({
    tipo: "percentage",
    partes: [
      { member_id: "m1", percentage: 70 },
      { member_id: "m2", percentage: 30 },
    ],
    total: 300,
  });
  assert.equal(r.ok, true);
  assert.equal(r.splitType, "percentage");
  assert.equal(parteDe(r.partes, "m1").amount, 210);
  assert.equal(parteDe(r.partes, "m2").amount, 90);
  // A NEGACAO: nenhuma parte e a metade. Sem ela, uma implementacao que
  // ignorasse a porcentagem e dividisse igual passaria se as asercoes fossem
  // so sobre a soma.
  assert.ok(r.partes.every((p) => p.amount !== 150));
  assert.equal(somaEmCentavos(r.partes), 30000);
});

test("a despesa negativa do banco da a mesma divisao", () => {
  // `financial_transactions.amount` e NEGATIVO para despesa, e a parte e sempre
  // positiva. O sinal nao pode virar parte negativa.
  const r = divisaoParaGravar({
    tipo: "percentage",
    partes: [
      { member_id: "m1", percentage: 70 },
      { member_id: "m2", percentage: 30 },
    ],
    total: -300,
  });
  assert.equal(r.ok, true);
  assert.equal(parteDe(r.partes, "m1").amount, 210);
  assert.equal(parteDe(r.partes, "m2").amount, 90);
});

test("valor e porcentagem em string, como chegam do JSON", () => {
  const r = divisaoParaGravar({
    tipo: "proportional",
    partes: [
      { member_id: "m1", percentage: "60" },
      { member_id: "m2", percentage: "40" },
    ],
    total: "250.00",
  });
  assert.equal(r.ok, true);
  assert.equal(r.splitType, "percentage");
  assert.equal(parteDe(r.partes, "m1").amount, 150);
  assert.equal(parteDe(r.partes, "m2").amount, 100);
});

// =====================================================
// 4. O centavo do arredondamento
// =====================================================
test("R$ 100 em tres partes iguais soma exatamente R$ 100", () => {
  const r = divisaoParaGravar({
    tipo: "percentage",
    partes: [
      { member_id: "m1", percentage: 33.333333 },
      { member_id: "m2", percentage: 33.333333 },
      { member_id: "m3", percentage: 33.333333 },
    ],
    total: 100,
  });
  assert.equal(r.ok, true);
  // 33,34 / 33,33 / 33,33 -- e nao 33,33 tres vezes, que someria R$ 0,01.
  assert.equal(somaEmCentavos(r.partes), 10000);
  const valores = r.partes.map((p) => p.amount).sort();
  assert.deepEqual(valores, [33.33, 33.33, 33.34]);
  // E a porcentagem gravada cabe em numeric(5,2): 33,333333 nao entra na
  // coluna, e deixar o banco arredondar por conta dele e o tipo de deriva que
  // faz a conta do app discordar da do SQL depois.
  for (const parte of r.partes) {
    assert.equal(parte.percentage, 33.33);
  }
});

test("R$ 0,05 em tres nao pode somar R$ 0,06", () => {
  // O caso que separa o maior resto de "cada parte arredonda sozinha": 5
  // centavos entre tres da 1,67 centavo para cada, e arredondar cada um para
  // cima grava 2+2+2 = 6 centavos de uma despesa de 5. O grupo passaria a
  // cobrar mais do que foi gasto -- e um centavo a mais nao zera em acerto
  // nenhum. Centavo e pouco; o defeito e que a soma deixa de ser o total.
  const r = divisaoParaGravar({
    tipo: "percentage",
    partes: [
      { member_id: "m1", percentage: 33.333333 },
      { member_id: "m2", percentage: 33.333333 },
      { member_id: "m3", percentage: 33.333333 },
    ],
    total: 0.05,
  });
  assert.equal(r.ok, true);
  assert.equal(somaEmCentavos(r.partes), 5);
  // E os dois centavos de sobra vao para DOIS membros, nao os dois para um so:
  // 0,02 / 0,02 / 0,01, e nao 0,03 / 0,01 / 0,01.
  const valores = r.partes.map((p) => p.amount).sort();
  assert.deepEqual(valores, [0.01, 0.02, 0.02]);
});

test("porcentagem arredondada que soma 99,90 nao e recusada", () => {
  // Dez membros a 9,99%: a soma e 99,90 por arredondamento de duas casas, e
  // nao por divisao incompleta. Recusar seria impossivel de satisfazer.
  const partes = Array.from({ length: 10 }, (_, i) => ({
    member_id: `m${i}`,
    percentage: 9.99,
  }));
  const r = divisaoParaGravar({ tipo: "percentage", partes, total: 1000 });
  assert.equal(r.ok, true);
  // E os valores ainda fecham o total exato: 100,00 cada.
  assert.equal(somaEmCentavos(r.partes), 100000);
});

test("o centavo extra vai sempre para o mesmo membro, em qualquer ordem", () => {
  // Empate de resto: quem decide e o member_id, nao a ordem em que o cliente
  // montou a lista. Sem isso, a mesma divisao gravaria valores diferentes a
  // cada tentativa.
  const base = [
    { member_id: "m3", percentage: 33.333333 },
    { member_id: "m1", percentage: 33.333333 },
    { member_id: "m2", percentage: 33.333333 },
  ];
  const direta = divisaoParaGravar({
    tipo: "percentage",
    partes: base,
    total: 100,
  });
  const invertida = divisaoParaGravar({
    tipo: "percentage",
    partes: [...base].reverse(),
    total: 100,
  });

  assert.equal(direta.ok, true);
  assert.equal(invertida.ok, true);
  for (const id of ["m1", "m2", "m3"]) {
    assert.equal(
      parteDe(direta.partes, id).amount,
      parteDe(invertida.partes, id).amount,
      `a parte de ${id} mudou de valor so por causa da ordem da lista`
    );
  }
  // E e o menor member_id que leva o centavo.
  assert.equal(parteDe(direta.partes, "m1").amount, 33.34);
});

test("a porcentagem gravada cabe em numeric(5,2) e respeita o CHECK > 0", () => {
  const r = divisaoParaGravar({
    tipo: "percentage",
    partes: [
      { member_id: "m1", percentage: 99.998 },
      { member_id: "m2", percentage: 0.002 },
    ],
    total: 500,
  });
  assert.equal(r.ok, true);
  // 0,002 arredondado para duas casas e 0,00, que o CHECK `percentage > 0`
  // recusa -- e o INSERT inteiro falharia com uma mensagem sobre `percentage`.
  assert.equal(parteDe(r.partes, "m2").percentage, 0.01);
  assert.ok(parteDe(r.partes, "m1").percentage <= 100);
  assert.equal(somaEmCentavos(r.partes), 50000);
});

// =====================================================
// 5. Porcentagem que nao fecha
// =====================================================
test("70/20 e recusado, e o erro diz quanto deu", () => {
  const r = divisaoParaGravar({
    tipo: "percentage",
    partes: [
      { member_id: "m1", percentage: 70 },
      { member_id: "m2", percentage: 20 },
    ],
    total: 300,
  });
  assert.equal(r.ok, false);
  assert.match(r.erro, /90/);
  assert.match(r.erro, /100/);
});

test("porcentagem zerada, negativa ou acima de 100 e recusada", () => {
  for (const pct of [0, -10, 101]) {
    const r = divisaoParaGravar({
      tipo: "percentage",
      partes: [
        { member_id: "m1", percentage: pct },
        { member_id: "m2", percentage: 100 - pct },
      ],
      total: 300,
    });
    assert.equal(r.ok, false, `percentual ${pct} deveria ser recusado`);
  }
});

test("porcentagem ausente e recusada", () => {
  const r = divisaoParaGravar({
    tipo: "percentage",
    partes: [{ member_id: "m1" }, { member_id: "m2", percentage: 50 }],
    total: 300,
  });
  assert.equal(r.ok, false);
  assert.match(r.erro, /percentual/i);
});

// =====================================================
// 6. Customizada: quem manda sao os valores
// =====================================================
test("custom de 210 + 90 fecha R$ 300 e deriva 70/30", () => {
  const r = divisaoParaGravar({
    tipo: "custom",
    partes: [
      { member_id: "m1", amount: 210 },
      { member_id: "m2", amount: 90 },
    ],
    total: 300,
  });
  assert.equal(r.ok, true);
  assert.equal(r.splitType, "custom");
  assert.equal(parteDe(r.partes, "m1").amount, 210);
  // A porcentagem derivada e o que `recalcular_partes_pendentes` (024) usa para
  // reescalar as partes se o valor da despesa mudar depois.
  assert.equal(parteDe(r.partes, "m1").percentage, 70);
  assert.equal(parteDe(r.partes, "m2").percentage, 30);
});

test("custom com valores negativos grava partes positivas", () => {
  // A parte e sempre positiva: a convencao de despesa NEGATIVA vale para
  // `financial_transactions.amount`, nao para `group_expense_splits.amount`.
  // Um cliente que mande as partes no mesmo sinal da despesa nao pode gravar
  // divida negativa -- que inverteria o saldo de quem deve.
  const r = divisaoParaGravar({
    tipo: "custom",
    partes: [
      { member_id: "m1", amount: -210 },
      { member_id: "m2", amount: -90 },
    ],
    total: -300,
  });
  assert.equal(r.ok, true);
  assert.equal(parteDe(r.partes, "m1").amount, 210);
  assert.equal(parteDe(r.partes, "m2").amount, 90);
});

test("custom que nao soma a despesa e recusado, dizendo o que falta", () => {
  const r = divisaoParaGravar({
    tipo: "custom",
    partes: [
      { member_id: "m1", amount: 200 },
      { member_id: "m2", amount: 90 },
    ],
    total: 300,
  });
  assert.equal(r.ok, false);
  assert.match(r.erro, /faltam/i);
  assert.match(r.erro, /10,00/);
});

test("custom que passa da despesa tambem e recusado", () => {
  const r = divisaoParaGravar({
    tipo: "custom",
    partes: [
      { member_id: "m1", amount: 250 },
      { member_id: "m2", amount: 90 },
    ],
    total: 300,
  });
  assert.equal(r.ok, false);
  assert.match(r.erro, /sobram/i);
});

test("custom errado por UM centavo tambem e recusado", () => {
  // O centavo e o que o acerto de contas nao consegue zerar depois.
  const r = divisaoParaGravar({
    tipo: "custom",
    partes: [
      { member_id: "m1", amount: 210 },
      { member_id: "m2", amount: 89.99 },
    ],
    total: 300,
  });
  assert.equal(r.ok, false);
  assert.match(r.erro, /0,01/);
});

test("parte de R$ 0,00 e recusada antes do CHECK do banco", () => {
  const r = divisaoParaGravar({
    tipo: "custom",
    partes: [
      { member_id: "m1", amount: 300 },
      { member_id: "m2", amount: 0 },
    ],
    total: 300,
  });
  assert.equal(r.ok, false);
  assert.match(r.erro, /0,00/);
});

// =====================================================
// 7. As listas que o banco aceitaria e nao devia
// =====================================================
test("membro repetido e recusado", () => {
  // Nao ha indice unico em (group_transaction_id, member_id): duas linhas
  // entrariam e cobrariam a mesma pessoa duas vezes.
  const r = divisaoParaGravar({
    tipo: "percentage",
    partes: [
      { member_id: "m1", percentage: 50 },
      { member_id: "m1", percentage: 50 },
    ],
    total: 300,
  });
  assert.equal(r.ok, false);
  assert.match(r.erro, /repete/i);
});

test("parte sem member_id e recusada", () => {
  const r = divisaoParaGravar({
    tipo: "percentage",
    partes: [{ percentage: 100 }],
    total: 300,
  });
  assert.equal(r.ok, false);
  assert.match(r.erro, /membro/i);
});

test("divisao combinada sem partes e recusada, nao vira divisao igual", () => {
  // O caso de escolher "Por Percentual" no seletor e nao escolher sugestao
  // nenhuma: ANTES disto a despesa era gravada em partes iguais, com 200 e
  // "sucesso" na tela.
  for (const partes of [undefined, null, [], "nao-e-lista"]) {
    const r = divisaoParaGravar({ tipo: "percentage", partes, total: 300 });
    assert.equal(r.ok, false, `partes=${JSON.stringify(partes)}`);
    assert.match(r.erro, /Escolha/i);
  }
});

test("despesa sem valor nao tem divisao combinada", () => {
  for (const total of [0, undefined, null, "abc"]) {
    const r = divisaoParaGravar({
      tipo: "percentage",
      partes: [{ member_id: "m1", percentage: 100 }],
      total,
    });
    assert.equal(r.ok, false, `total=${JSON.stringify(total)}`);
    assert.match(r.erro, /valor/i);
  }
});
