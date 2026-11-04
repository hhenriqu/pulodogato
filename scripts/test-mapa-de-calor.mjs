#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DO MAPA DE CALOR DO PAINEL
// =====================================================
//   npm run test:mapa-de-calor
//
// Exercita lib/mapa-de-calor.ts. Os casos que importam:
//   * o calendario comeca no domingo certo e fecha em semanas de sete;
//   * o futuro aparece apagado, e nao como "zero gasto" -- e nem um lancamento
//     com data futura (recorrencia materializada) o pinta;
//   * os niveis saem dos quartis, e um dia de aluguel nao achata o resto;
//   * a media divide pelos dias VIVIDOS, nao pelos dias do periodo.
// Os valores esperados foram feitos a mao a partir da regra.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  diaDaSemana,
  diasDoPeriodo,
  limitesDosNiveis,
  montarMapaDeCalor,
  nivelDoValor,
  rotuloDaSemana,
  somarPorDia,
} = await import("../.tmp-mapa-de-calor/mapa-de-calor.js");

const novembro = { de: "2026-11-01", ate: "2026-11-30" };

test("dia da semana sem fuso: 01/11/2026 e um domingo", () => {
  assert.equal(diaDaSemana("2026-11-01"), 0);
  assert.equal(diaDaSemana("2026-10-01"), 4);
  assert.equal(diasDoPeriodo("2026-11-01", "2026-11-30"), 30);
  assert.equal(diasDoPeriodo("2026-02-27", "2026-03-02"), 4);
});

test("o calendario abre no dia da semana certo e fecha em semanas de sete", () => {
  const m = montarMapaDeCalor({
    de: "2026-10-01",
    ate: "2026-10-31",
    hoje: "2026-10-31",
    gastos: [],
  });
  // Outubro de 2026 comeca numa quinta: quatro celulas vazias antes.
  assert.equal(m.semanas[0].slice(0, 4).every((c) => c.data === null), true);
  assert.equal(m.semanas[0][4].data, "2026-10-01");
  assert.ok(m.semanas.every((s) => s.length === 7));
  const dias = m.semanas.flat().filter((c) => c.data !== null);
  assert.equal(dias.length, 31);
  assert.equal(dias.at(-1).data, "2026-10-31");
});

test("despesa negativa soma pelo modulo, e o dia junta varias", () => {
  const porDia = somarPorDia([
    { data: "2026-11-02", valor: -10.1 },
    { data: "2026-11-02", valor: -20.2 },
    { data: "2026-11-03", valor: "abc" },
    { data: "2026-11-04", valor: 0 },
  ]);
  assert.equal(porDia.get("2026-11-02"), 30.3);
  assert.equal(porDia.has("2026-11-03"), false);
  assert.equal(porDia.has("2026-11-04"), false);
});

test("o futuro fica apagado e nao conta, mesmo com lancamento nele", () => {
  const m = montarMapaDeCalor({
    ...novembro,
    hoje: "2026-11-04",
    gastos: [
      { data: "2026-11-02", valor: -100 },
      { data: "2026-11-20", valor: -999 }, // recorrencia materializada
    ],
  });
  const dia20 = m.semanas.flat().find((c) => c.data === "2026-11-20");
  assert.equal(dia20.futuro, true);
  assert.equal(dia20.valor, 0);
  assert.equal(dia20.nivel, 0);
  assert.equal(m.total, 100);
  assert.equal(m.diasPassados, 4);
  assert.equal(m.diasComGasto, 1);
  // 100 em 4 dias vividos, e nao 100 em 30 nem 100 em 1.
  assert.equal(m.mediaPorDia, 25);
  assert.deepEqual(m.maiorDia, { data: "2026-11-02", valor: 100 });
});

test("gasto fora do periodo nao entra", () => {
  const m = montarMapaDeCalor({
    ...novembro,
    hoje: "2026-11-30",
    gastos: [
      { data: "2026-10-31", valor: -50 },
      { data: "2026-12-01", valor: -50 },
    ],
  });
  assert.equal(m.total, 0);
  assert.equal(m.maiorDia, null);
});

test("os niveis saem dos quartis: o aluguel nao achata o resto do mes", () => {
  // Dez dias de 10 a 100 e um aluguel de 3000. Escalando pelo maximo, todos
  // os dez cairiam no nivel 1; pelos quartis eles se espalham.
  const valores = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 3000];
  const limites = limitesDosNiveis(valores);
  assert.deepEqual(limites, [35, 60, 85]);
  assert.equal(nivelDoValor(10, limites), 1);
  assert.equal(nivelDoValor(40, limites), 2);
  assert.equal(nivelDoValor(70, limites), 3);
  assert.equal(nivelDoValor(100, limites), 4);
  assert.equal(nivelDoValor(3000, limites), 4);
  assert.equal(nivelDoValor(0, limites), 0);
});

test("um unico dia com gasto e quente, e nao frio", () => {
  const limites = limitesDosNiveis([42]);
  assert.equal(nivelDoValor(42, limites), 4);
  assert.deepEqual(limitesDosNiveis([]), [0, 0, 0]);
});

test("o rotulo de mes aparece na primeira semana e na virada", () => {
  const m = montarMapaDeCalor({
    de: "2026-10-15",
    ate: "2026-11-15",
    hoje: "2026-11-15",
    gastos: [],
  });
  const rotulos = m.semanas.map((s, i) => rotuloDaSemana(s, i === 0));
  assert.equal(rotulos[0], "out");
  assert.equal(rotulos.filter((r) => r === "nov").length, 1);
  assert.equal(rotulos.filter((r) => r !== null).length, 2);
});
