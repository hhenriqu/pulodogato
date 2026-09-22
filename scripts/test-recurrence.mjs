#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DE RECORRENCIA
// =====================================================
//   npm run test:recurrence
//
// Exercita lib/recurrence.ts nos casos que quebram calendario: dia 31 em
// fevereiro, ano bissexto, virada de ano, fim e limite de ocorrencias.
//
// O arquivo e .mjs (e nao .ts) porque o projeto nao tem runner de teste; o
// script npm compila lib/recurrence.ts com o tsc que ja e dependencia e roda
// isto com `node --test`. Nenhuma dependencia nova entra no package.json so
// para conferir aritmetica de data.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  occurrencesBetween,
  addMonthsClamped,
  firstOccurrence,
  monthlyCost,
  lastDayOfMonth,
} = await import("../.tmp-recurrence/recurrence.js");

test("mensal simples: 12 vencimentos no ano", () => {
  const dias = occurrencesBetween(
    { frequency: "monthly", due_day: 10, start_date: "2026-01-01" },
    "2026-01-01",
    "2026-12-31",
  );
  assert.equal(dias.length, 12);
  assert.equal(dias[0], "2026-01-10");
  assert.equal(dias[11], "2026-12-10");
});

test("dia 31 nao pula fevereiro: cai no ultimo dia do mes", () => {
  const dias = occurrencesBetween(
    { frequency: "monthly", due_day: 31, start_date: "2026-01-01" },
    "2026-01-01",
    "2026-04-30",
  );
  // O setUTCMonth cru daria 03/03 no lugar de 28/02 -- fevereiro ficaria sem
  // conta e marco com duas.
  assert.deepEqual(dias, ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
});

test("o mes curto nao contamina os seguintes", () => {
  // Reancorar na ocorrencia anterior faria tudo virar dia 28 depois de fevereiro.
  const dias = occurrencesBetween(
    { frequency: "monthly", due_day: 30, start_date: "2026-01-01" },
    "2026-02-01",
    "2026-05-31",
  );
  assert.deepEqual(dias, ["2026-02-28", "2026-03-30", "2026-04-30", "2026-05-30"]);
});

test("ano bissexto: 2028 tem 29 de fevereiro", () => {
  assert.equal(lastDayOfMonth(2028, 2), 29);
  assert.equal(addMonthsClamped("2028-01-31", 1, 31), "2028-02-29");
  assert.equal(addMonthsClamped("2026-01-31", 1, 31), "2026-02-28");
});

test("cadastrar depois do vencimento joga a primeira para o mes seguinte", () => {
  // Aluguel vence dia 10; cadastrado dia 20. A primeira conta e a de novembro,
  // nao uma ja vencida em outubro.
  assert.equal(
    firstOccurrence({ frequency: "monthly", due_day: 10, start_date: "2026-10-20" }),
    "2026-11-10",
  );
  assert.equal(
    firstOccurrence({ frequency: "monthly", due_day: 10, start_date: "2026-10-05" }),
    "2026-10-10",
  );
});

test("semanal e quinzenal andam em dias, atravessando o mes", () => {
  assert.deepEqual(
    occurrencesBetween({ frequency: "weekly", start_date: "2026-01-29" }, "2026-01-01", "2026-02-20"),
    ["2026-01-29", "2026-02-05", "2026-02-12", "2026-02-19"],
  );
  assert.deepEqual(
    occurrencesBetween({ frequency: "biweekly", start_date: "2026-12-24" }, "2026-01-01", "2027-01-30"),
    ["2026-12-24", "2027-01-07", "2027-01-21"],
  );
});

test("interval_count multiplica o periodo", () => {
  assert.deepEqual(
    occurrencesBetween(
      { frequency: "monthly", interval_count: 3, due_day: 5, start_date: "2026-01-01" },
      "2026-01-01",
      "2026-12-31",
    ),
    ["2026-01-05", "2026-04-05", "2026-07-05", "2026-10-05"],
  );
});

test("end_date e max_occurrences cortam a serie", () => {
  assert.deepEqual(
    occurrencesBetween(
      { frequency: "monthly", due_day: 15, start_date: "2026-01-01", end_date: "2026-03-20" },
      "2026-01-01",
      "2026-12-31",
    ),
    ["2026-01-15", "2026-02-15", "2026-03-15"],
  );
  assert.deepEqual(
    occurrencesBetween(
      { frequency: "monthly", due_day: 15, start_date: "2026-01-01", max_occurrences: 2 },
      "2026-01-01",
      "2026-12-31",
    ),
    ["2026-01-15", "2026-02-15"],
  );
});

test("max_occurrences conta desde a primeira, nao desde a janela pedida", () => {
  // Regra de 3 parcelas comecando em janeiro; a tela pede marco em diante.
  // So sobra a terceira -- a contagem nao pode reiniciar na janela.
  assert.deepEqual(
    occurrencesBetween(
      { frequency: "monthly", due_day: 15, start_date: "2026-01-01", max_occurrences: 3 },
      "2026-03-01",
      "2026-12-31",
    ),
    ["2026-03-15"],
  );
});

test("janela invertida ou anterior a regra devolve lista vazia", () => {
  assert.deepEqual(
    occurrencesBetween({ frequency: "monthly", due_day: 10, start_date: "2026-01-01" }, "2026-05-01", "2026-04-01"),
    [],
  );
  assert.deepEqual(
    occurrencesBetween({ frequency: "monthly", due_day: 10, start_date: "2026-06-01" }, "2026-01-01", "2026-03-31"),
    [],
  );
});

test("anual atravessa a virada de ano", () => {
  assert.deepEqual(
    occurrencesBetween({ frequency: "annual", due_day: 31, start_date: "2026-12-31" }, "2026-01-01", "2029-01-01"),
    ["2026-12-31", "2027-12-31", "2028-12-31"],
  );
});

test("monthlyCost normaliza frequencias diferentes", () => {
  assert.equal(monthlyCost({ frequency: "monthly" }, 100), 100);
  assert.equal(monthlyCost({ frequency: "annual" }, 1200), 100);
  assert.equal(monthlyCost({ frequency: "quarterly" }, 300), 100);
  // Semanal: 52 semanas / 12 meses ~= 4,33 -- nao 4.
  assert.ok(Math.abs(monthlyCost({ frequency: "weekly" }, 100) - 434.52) < 0.01);
});

test("data fora do formato ISO e recusada", () => {
  assert.throws(
    () => occurrencesBetween({ frequency: "monthly", start_date: "01/01/2026" }, "2026-01-01", "2026-12-31"),
    /YYYY-MM-DD/,
  );
});
