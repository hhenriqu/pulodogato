#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DO CUSTO DE VIDA
// =====================================================
//   npm run test:custo-de-vida
//
// Exercita lib/custo-de-vida.ts: os meses do historico e da previsao, o
// historico separado em fixo e variavel, a previsao pelas OCORRENCIAS das
// contas fixas (a encerrada para de contar, a anual pesa no mes dela) mais a
// media do variavel, e a reserva de 12 meses.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  calcularCustoDeVida,
  fixoPorMes,
  mesesDoHistorico,
  mesesDaPrevisao,
  somarMeses,
  fimDoMes,
  resumoDoCusto,
} = await import("../.tmp-custo-de-vida/custo-de-vida.js");

const HOJE = "2026-11-07";

test("o historico sao os 12 meses FECHADOS antes do mes corrente", () => {
  const meses = mesesDoHistorico(HOJE);
  assert.equal(meses.length, 12);
  assert.equal(meses[0], "2025-11");
  assert.equal(meses[11], "2026-10");
});

test("a previsao comeca no mes corrente e vira o ano", () => {
  const meses = mesesDaPrevisao(HOJE);
  assert.equal(meses.length, 12);
  assert.equal(meses[0], "2026-11");
  assert.equal(meses[2], "2027-01");
  assert.equal(meses[11], "2027-10");
});

test("somarMeses e fimDoMes", () => {
  assert.equal(somarMeses("2026-01", -1), "2025-12");
  assert.equal(somarMeses("2026-12", 1), "2027-01");
  assert.equal(fimDoMes("2028-02"), "2028-02-29");
  assert.equal(fimDoMes("2026-11"), "2026-11-30");
});

test("a conta fixa encerrada para de contar na previsao", () => {
  const meses = mesesDaPrevisao(HOJE);
  const fixos = fixoPorMes(
    [
      // Acaba em janeiro: conta em nov, dez e jan, e nao depois.
      { descricao: "Financiamento", valor: 500, frequency: "monthly", due_day: 10, start_date: "2024-02-10", end_date: "2027-01-31" },
      // 12 parcelas desde fevereiro: a ultima e janeiro de 2027.
      { descricao: "Curso", valor: 100, frequency: "monthly", due_day: 5, start_date: "2026-02-05", max_occurrences: 12 },
    ],
    meses
  );
  assert.equal(fixos.get("2026-11"), 600);
  assert.equal(fixos.get("2027-01"), 600);
  assert.equal(fixos.get("2027-02"), 0);
});

test("a anual pesa no mes do vencimento, e a que ainda nao comecou so depois do inicio", () => {
  const meses = mesesDaPrevisao(HOJE);
  const fixos = fixoPorMes(
    [
      { descricao: "IPVA", valor: 1200, frequency: "annual", due_day: 15, start_date: "2025-03-15" },
      { descricao: "Academia", valor: 150, frequency: "monthly", due_day: 1, start_date: "2027-02-01" },
    ],
    meses
  );
  assert.equal(fixos.get("2027-03"), 1350);
  assert.equal(fixos.get("2027-01"), 0);
  assert.equal(fixos.get("2027-02"), 150);
});

test("o fixo do historico nao entra duas vezes na previsao", () => {
  // Doze meses de aluguel (fixo, pela descricao) e mercado (variavel).
  const despesas = [];
  for (const mes of mesesDoHistorico(HOJE)) {
    despesas.push({ data: `${mes}-10`, valor: 1700, descricao: "Aluguel" });
    despesas.push({ data: `${mes}-12`, valor: 800, descricao: "Mercado Extra", transacaoId: `m-${mes}` });
  }
  // A conta de luz casou com uma prevista pela baixa, nao pela descricao.
  despesas.push({ data: "2026-10-20", valor: 240, descricao: "ENEL SP 10/2026", transacaoId: "luz-out" });

  const custo = calcularCustoDeVida({
    despesas,
    contasFixas: [
      { descricao: "Aluguel", valor: 1700, frequency: "monthly", due_day: 10, start_date: "2024-01-10" },
    ],
    idsDeBaixa: ["luz-out"],
    hoje: HOJE,
  });

  const outubro = custo.historico.at(-1);
  assert.equal(outubro.mes, "2026-10");
  assert.equal(outubro.fixo, 1940);
  assert.equal(outubro.variavel, 800);
  assert.equal(outubro.total, 2740);

  assert.equal(custo.mesesComGasto, 12);
  assert.equal(custo.mediaVariavel, 800);
  // Previsao: 1700 de aluguel + 800 de variavel, todo mes.
  assert.ok(custo.previsao.every((m) => m.total === 2500));
  assert.equal(custo.reservaSugerida, 30000);
  assert.equal(custo.mediaPrevista, 2500);
});

test("a conta fixa desativada ainda marca o pagamento antigo como fixo", () => {
  const despesas = mesesDoHistorico(HOJE).map((mes) => ({
    data: `${mes}-05`,
    valor: 900,
    descricao: "Financiamento carro",
  }));
  const sem = calcularCustoDeVida({ despesas, contasFixas: [], hoje: HOJE });
  assert.equal(sem.mediaVariavel, 900, "sem a descricao encerrada, vira variavel");

  const com = calcularCustoDeVida({
    despesas,
    contasFixas: [],
    descricoesFixasEncerradas: ["Financiamento carro"],
    hoje: HOJE,
  });
  assert.equal(com.mediaVariavel, 0);
  assert.equal(com.reservaSugerida, 0);
});

test("a media e sobre os meses COM gasto", () => {
  const custo = calcularCustoDeVida({
    despesas: [
      { data: "2026-09-03", valor: 1000, descricao: "Mercado" },
      { data: "2026-10-03", valor: 2000, descricao: "Mercado" },
      // Fora da janela: o mes corrente e o passado distante nao entram.
      { data: "2026-11-02", valor: 9999, descricao: "Mercado" },
      { data: "2025-10-31", valor: 9999, descricao: "Mercado" },
    ],
    contasFixas: [],
    hoje: HOJE,
  });
  assert.equal(custo.mesesComGasto, 2);
  assert.equal(custo.mediaRealizada, 1500);
  assert.equal(custo.mediaVariavel, 1500);
  assert.equal(custo.reservaSugerida, 18000);
});

test("sem historico a previsao fica so com as contas fixas", () => {
  const custo = calcularCustoDeVida({
    despesas: [],
    contasFixas: [
      { descricao: "Internet", valor: 120, frequency: "monthly", due_day: 20, start_date: "2026-01-20" },
    ],
    hoje: HOJE,
  });
  assert.equal(custo.mesesComGasto, 0);
  assert.equal(custo.mediaVariavel, 0);
  assert.equal(custo.reservaSugerida, 1440);
});

test("conta com frequencia desconhecida nao derruba a conta inteira", () => {
  const custo = calcularCustoDeVida({
    despesas: [],
    contasFixas: [
      { descricao: "Estranha", valor: 50, frequency: "yearly", start_date: "2026-01-01" },
      { descricao: "Internet", valor: 120, frequency: "monthly", due_day: 20, start_date: "2026-01-20" },
    ],
    hoje: HOJE,
  });
  assert.equal(custo.reservaSugerida, 1440);
});

test("sem o variavel, a reserva e as medias ficam so com o fixo", () => {
  const despesas = [];
  for (const mes of mesesDoHistorico(HOJE)) {
    despesas.push({ data: `${mes}-10`, valor: 1700, descricao: "Aluguel" });
    despesas.push({ data: `${mes}-12`, valor: 800, descricao: "Mercado" });
  }
  const custo = calcularCustoDeVida({
    despesas,
    contasFixas: [
      { descricao: "Aluguel", valor: 1700, frequency: "monthly", due_day: 10, start_date: "2024-01-10" },
    ],
    hoje: HOJE,
  });

  const com = resumoDoCusto(custo, true);
  assert.equal(com.reserva, 30000);
  assert.equal(com.mediaPrevista, 2500);
  assert.equal(com.mediaRealizada, 2500);

  const sem = resumoDoCusto(custo, false);
  assert.equal(sem.reserva, 20400);
  assert.equal(sem.mediaPrevista, 1700);
  assert.equal(sem.mediaRealizada, 1700);
});
