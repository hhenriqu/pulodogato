#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DO DETECTOR DE RECORRENCIAS
// =====================================================
//   npm run test:recurrence-detector
//
// Exercita lib/recurrence-detector.ts: normalizacao de descricao de extrato,
// agrupamento, classificacao de frequencia e os dois alertas.
//
// O arquivo e .mjs (e nao .ts) porque o projeto nao tem runner de teste; o
// script npm compila lib/recurrence-detector.ts com o tsc que ja e dependencia
// e roda isto com `node --test`. Mesma escolha de scripts/test-recurrence.mjs.
//
// Nao ha passo de reescrita de alias aqui porque o modulo sob teste nao
// importa nada -- ver o cabecalho dele.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  normalizeMerchant,
  detectRecurrences,
  classificarFrequencia,
  mediana,
  custoMensal,
  proximaCobranca,
  totalMensal,
  alertaDeAumento,
  alertaDeCobrancaAposCancelamento,
  addMonthsClamped,
  inicioDaJanela,
  diasEntre,
} = await import("../.tmp-recurrence-detector/recurrence-detector.js");

// ---------------------------------------------------------------------------
// 1. Normalizacao
// ---------------------------------------------------------------------------
// Descricoes reais de extrato e fatura brasileiros. O que importa em cada par
// nao e o texto da chave, e sim que as variacoes do MESMO lojista cheguem a
// mesma chave -- e que lojistas diferentes nao colidam.

const EXEMPLOS = [
  // --- o caso do enunciado ---
  ["NETFLIX.COM*123", "netflix"],
  ["NETFLIX COM", "netflix"],
  ["NETFLIX.COM SAO PAULO BR", "netflix"],
  ["Netflix.com Los Gatos", "netflix"],

  // --- prefixo de gateway ---
  ["PAG*ACADEMIA SMART", "academia smart"],
  ["MP *SPOTIFY", "spotify"],
  ["PAYPAL *STEAM GAMES", "steam games"],
  ["EBN*UBER TRIP", "uber trip"],
  ["PAGSEGURO *BARBEARIA", "barbearia"],

  // --- sufixo de ruido ---
  ["SPOTIFY BR", "spotify"],
  ["SPOTIFY.COM BR", "spotify"],
  ["AMAZON PRIME BR", "amazon prime"],
  ["GOOGLE ONE LTDA", "google one"],
  ["ADOBE SYSTEMS INT", "adobe systems"],

  // --- identificador e parcela colados ---
  ["UNIMED 0092831", "unimed"],
  ["SEGURO AUTO PARCELA 03/12", "seguro auto"],
  ["FATURA CLARO 4429", "fatura claro"],
  ["ACADEMIA BLUEFIT 12/2026", "academia bluefit"],

  // --- acento e caixa ---
  ["Academia Força Total", "academia forca total"],
  ["FARMÁCIA SÃO JOÃO", "farmacia sao joao"],
  ["ASSOCIAÇÃO DOS MORADORES", "associacao dos moradores"],

  // --- praca colada ---
  ["ICLOUD RIO DE JANEIRO", "icloud"],
  ["DROPBOX DUBLIN", "dropbox"],

  // --- o nome E o numero: nao pode virar chave vazia ---
  ["99*99APP SAO PAULO", "99app"],
  ["1PASSWORD", "1password"],
  ["123MILHAS", "123milhas"],
];

test("normalizeMerchant: 26 descricoes reais de extrato", () => {
  for (const [entrada, esperado] of EXEMPLOS) {
    assert.equal(
      normalizeMerchant(entrada),
      esperado,
      `"${entrada}" deveria normalizar para "${esperado}"`,
    );
  }
});

test("normalizeMerchant: as variacoes do mesmo lojista colidem de proposito", () => {
  const netflix = [
    "NETFLIX.COM*123",
    "NETFLIX COM",
    "NETFLIX.COM SAO PAULO BR",
    "Netflix.com Los Gatos",
  ].map(normalizeMerchant);
  assert.equal(new Set(netflix).size, 1, "as 4 variacoes tem que dar uma chave so");
});

test("normalizeMerchant: lojistas diferentes NAO colidem", () => {
  const chaves = [
    "NETFLIX.COM*123",
    "SPOTIFY BR",
    "AMAZON PRIME BR",
    "ACADEMIA BLUEFIT 12/2026",
  ].map(normalizeMerchant);
  assert.equal(new Set(chaves).size, 4);
});

test("normalizeMerchant: 'pag' no meio do nome nao e gateway", () => {
  // O corte de prefixo so olha o primeiro token. "clube pag" perderia o nome
  // inteiro se o corte varresse a string.
  assert.equal(normalizeMerchant("CLUBE PAG"), "clube pag");
});

test("normalizeMerchant: entrada vazia ou so pontuacao nao vira chave", () => {
  assert.equal(normalizeMerchant(""), "");
  assert.equal(normalizeMerchant("***"), "");
  assert.equal(normalizeMerchant("   "), "");
});

// ---------------------------------------------------------------------------
// 2. Frequencia
// ---------------------------------------------------------------------------

test("classificarFrequencia: dentro da tolerancia de +/-3 dias", () => {
  assert.equal(classificarFrequencia(7), "WEEKLY");
  assert.equal(classificarFrequencia(4), "WEEKLY");
  assert.equal(classificarFrequencia(10), "WEEKLY");
  assert.equal(classificarFrequencia(30), "MONTHLY");
  assert.equal(classificarFrequencia(28), "MONTHLY");
  assert.equal(classificarFrequencia(31), "MONTHLY");
  assert.equal(classificarFrequencia(365), "YEARLY");
  assert.equal(classificarFrequencia(366), "YEARLY");
});

test("classificarFrequencia: o que nao e recorrencia devolve null", () => {
  assert.equal(classificarFrequencia(1), null);
  assert.equal(classificarFrequencia(15), null); // quinzenal nao esta no escopo
  assert.equal(classificarFrequencia(60), null); // bimestral tambem nao
  assert.equal(classificarFrequencia(180), null);
});

test("mediana: impar e par", () => {
  assert.equal(mediana([30, 31, 29]), 30);
  assert.equal(mediana([28, 30, 31, 31]), 30.5);
});

// ---------------------------------------------------------------------------
// 3. Deteccao
// ---------------------------------------------------------------------------

/** Ajuda a montar despesa: valor NEGATIVO, como o banco grava. */
function despesa(id, description, amount, transaction_date) {
  return { id, description, amount: -Math.abs(amount), transaction_date };
}

test("mensal classica: 6 cobrancas da Netflix viram uma recorrencia", () => {
  const txs = [
    despesa("1", "NETFLIX.COM*8821", 39.9, "2026-03-15"),
    despesa("2", "NETFLIX.COM*9134", 39.9, "2026-04-15"),
    despesa("3", "NETFLIX COM", 39.9, "2026-05-15"),
    despesa("4", "NETFLIX.COM SAO PAULO BR", 39.9, "2026-06-15"),
    despesa("5", "NETFLIX.COM*1220", 39.9, "2026-07-15"),
    despesa("6", "NETFLIX.COM*3310", 39.9, "2026-08-15"),
  ];
  const [r] = detectRecurrences(txs);
  assert.equal(r.merchantKey, "netflix");
  assert.equal(r.frequency, "MONTHLY");
  assert.equal(r.occurrences, 6);
  assert.equal(r.avgAmount, 39.9);
  assert.equal(r.lastChargeDate, "2026-08-15");
  assert.equal(r.nextExpectedDate, "2026-09-15");
  assert.equal(r.transactionIds.length, 6);
});

test("o valor sai POSITIVO, mesmo a despesa sendo negativa no banco", () => {
  // Esta e a regressao que um fixture de valor positivo nao pega: se o
  // detector somar o amount cru, avgAmount vem -39,90 e o total mensal da
  // tela vira um numero negativo.
  const txs = [
    despesa("1", "SPOTIFY BR", 21.9, "2026-06-10"),
    despesa("2", "SPOTIFY BR", 21.9, "2026-07-10"),
    despesa("3", "SPOTIFY BR", 21.9, "2026-08-10"),
  ];
  const [r] = detectRecurrences(txs);
  assert.equal(r.avgAmount, 21.9);
  assert.equal(r.monthlyCost, 21.9);
  assert.ok(r.avgAmount > 0);
  assert.ok(totalMensal([r]) > 0);
});

test("receita nao e assinatura: o salario nao entra", () => {
  // Salario e mensal, regular e de valor estavel -- passa em todos os outros
  // criterios. So o sinal o distingue.
  const txs = [
    { id: "1", description: "SALARIO EMPRESA XYZ", amount: 8500, transaction_date: "2026-06-05" },
    { id: "2", description: "SALARIO EMPRESA XYZ", amount: 8500, transaction_date: "2026-07-05" },
    { id: "3", description: "SALARIO EMPRESA XYZ", amount: 8500, transaction_date: "2026-08-05" },
  ];
  assert.deepEqual(detectRecurrences(txs), []);
});

test("menos de 3 ocorrencias nao e recorrencia", () => {
  const txs = [
    despesa("1", "AMAZON PRIME BR", 14.9, "2026-07-01"),
    despesa("2", "AMAZON PRIME BR", 14.9, "2026-08-01"),
  ];
  assert.deepEqual(detectRecurrences(txs), []);
});

test("intervalo irregular reprova mesmo com mediana boa", () => {
  // 10, 40 e 70 dias: a mediana e 30, mas nenhuma das pontas e mensal. Se a
  // checagem olhasse so a mediana, o supermercado viraria assinatura.
  const txs = [
    despesa("1", "SUPERMERCADO BOM PRECO", 250, "2026-05-01"),
    despesa("2", "SUPERMERCADO BOM PRECO", 250, "2026-05-11"),
    despesa("3", "SUPERMERCADO BOM PRECO", 250, "2026-06-20"),
    despesa("4", "SUPERMERCADO BOM PRECO", 250, "2026-08-29"),
  ];
  assert.deepEqual(detectRecurrences(txs), []);
});

test("variacao de valor acima de 10% reprova o grupo", () => {
  const txs = [
    despesa("1", "POSTO IPIRANGA", 100, "2026-06-10"),
    despesa("2", "POSTO IPIRANGA", 100, "2026-07-10"),
    despesa("3", "POSTO IPIRANGA", 160, "2026-08-10"),
  ];
  assert.deepEqual(detectRecurrences(txs), []);
});

test("variacao de ate 10% passa", () => {
  const txs = [
    despesa("1", "ENERGIA CEMIG", 200, "2026-06-10"),
    despesa("2", "ENERGIA CEMIG", 210, "2026-07-10"),
    despesa("3", "ENERGIA CEMIG", 190, "2026-08-10"),
  ];
  const [r] = detectRecurrences(txs);
  assert.equal(r.frequency, "MONTHLY");
  assert.equal(r.avgAmount, 200);
});

test("mes de 28 a 31 dias continua sendo mensal", () => {
  // Dia 31 de janeiro -> 28 de fevereiro sao 28 dias; 28/02 -> 31/03 sao 31.
  // Os dois precisam caber na faixa, senao toda assinatura cobrada no fim do
  // mes deixa de ser detectada em fevereiro.
  const txs = [
    despesa("1", "ICLOUD BR", 12.9, "2026-01-31"),
    despesa("2", "ICLOUD BR", 12.9, "2026-02-28"),
    despesa("3", "ICLOUD BR", 12.9, "2026-03-31"),
    despesa("4", "ICLOUD BR", 12.9, "2026-04-30"),
  ];
  const [r] = detectRecurrences(txs);
  assert.equal(r.frequency, "MONTHLY");
  assert.equal(r.occurrences, 4);
});

test("semanal e anual tambem sao classificadas", () => {
  const semanal = detectRecurrences([
    despesa("1", "CLUBE SEMANAL", 20, "2026-08-03"),
    despesa("2", "CLUBE SEMANAL", 20, "2026-08-10"),
    despesa("3", "CLUBE SEMANAL", 20, "2026-08-17"),
  ]);
  assert.equal(semanal[0].frequency, "WEEKLY");
  assert.equal(semanal[0].nextExpectedDate, "2026-08-24");

  const anual = detectRecurrences([
    despesa("1", "DOMINIO REGISTRO BR", 40, "2024-09-01"),
    despesa("2", "DOMINIO REGISTRO BR", 40, "2025-09-01"),
    despesa("3", "DOMINIO REGISTRO BR", 40, "2026-09-01"),
  ]);
  assert.equal(anual[0].frequency, "YEARLY");
  assert.equal(anual[0].nextExpectedDate, "2027-09-01");
});

test("duas cobrancas no mesmo dia contam como uma ocorrencia somada", () => {
  // Sem agrupar por data, o intervalo 0 entre elas reprovaria a serie inteira
  // e a assinatura sumiria da tela.
  const txs = [
    despesa("1", "SEGURO VIDA", 50, "2026-06-10"),
    despesa("2", "SEGURO VIDA", 50, "2026-06-10"),
    despesa("3", "SEGURO VIDA", 100, "2026-07-10"),
    despesa("4", "SEGURO VIDA", 100, "2026-08-10"),
  ];
  const [r] = detectRecurrences(txs);
  assert.equal(r.occurrences, 3);
  assert.equal(r.avgAmount, 100);
  assert.equal(r.transactionIds.length, 4);
});

test("a lista sai da mais cara por mes para a mais barata", () => {
  const txs = [
    despesa("a1", "SPOTIFY BR", 21.9, "2026-06-10"),
    despesa("a2", "SPOTIFY BR", 21.9, "2026-07-10"),
    despesa("a3", "SPOTIFY BR", 21.9, "2026-08-10"),
    despesa("b1", "ACADEMIA BLUEFIT", 119.9, "2026-06-05"),
    despesa("b2", "ACADEMIA BLUEFIT", 119.9, "2026-07-05"),
    despesa("b3", "ACADEMIA BLUEFIT", 119.9, "2026-08-05"),
  ];
  const lista = detectRecurrences(txs);
  assert.equal(lista.length, 2);
  assert.equal(lista[0].merchantKey, "academia bluefit");
  assert.equal(lista[1].merchantKey, "spotify");
  assert.equal(totalMensal(lista), 141.8);
});

test("custoMensal poe frequencias diferentes na mesma escala", () => {
  assert.equal(custoMensal("MONTHLY", 100), 100);
  assert.equal(custoMensal("YEARLY", 1200), 100);
  // Semanal: 52 semanas / 12 meses = ~4,33 cobrancas por mes.
  assert.ok(Math.abs(custoMensal("WEEKLY", 20) - 86.9) < 0.5);
});

test("proximaCobranca no dia 31 nao pula fevereiro", () => {
  assert.equal(proximaCobranca("MONTHLY", "2026-01-31"), "2026-02-28");
  assert.equal(addMonthsClamped("2028-01-31", 1), "2028-02-29");
});

test("inicioDaJanela volta 6 meses", () => {
  assert.equal(inicioDaJanela("2026-09-22"), "2026-03-22");
  assert.equal(inicioDaJanela("2026-01-15"), "2025-07-15");
  assert.equal(inicioDaJanela("2026-08-31", 6), "2026-02-28");
});

test("diasEntre atravessa virada de ano e horario de verao", () => {
  assert.equal(diasEntre("2025-12-20", "2026-01-19"), 30);
  // Outubro tem mudanca de fuso em varios paises; a conta roda em UTC.
  assert.equal(diasEntre("2026-10-15", "2026-11-15"), 31);
});

// ---------------------------------------------------------------------------
// 4. Alertas
// ---------------------------------------------------------------------------

test("aumento acima de 10% gera alerta", () => {
  const a = alertaDeAumento("netflix", "Netflix", [-39.9, -39.9, -39.9, -59.9]);
  assert.ok(a);
  assert.equal(a.tipo, "PRICE_INCREASE");
  assert.ok(a.variacao > 0.1);
  assert.match(a.mensagem, /Netflix subiu/);
});

test("a media do aumento exclui a cobranca nova", () => {
  // 3x 100 e depois 111: contra a media das anteriores (100) sao 11%, acima do
  // limite. Se a nova entrasse na media (103,75), daria 7% e o alerta sumiria.
  const a = alertaDeAumento("x", "X", [-100, -100, -100, -111]);
  assert.ok(a, "11% contra a media das anteriores tem que alertar");
  assert.ok(Math.abs(a.variacao - 0.11) < 0.001);
});

test("aumento de exatamente 10% nao alerta", () => {
  assert.equal(alertaDeAumento("x", "X", [-100, -100, -110]), null);
});

test("queda de preco nao alerta", () => {
  assert.equal(alertaDeAumento("x", "X", [-100, -100, -80]), null);
});

test("serie de uma cobranca so nao tem com o que comparar", () => {
  assert.equal(alertaDeAumento("x", "X", [-100]), null);
});

test("cobranca depois do cancelamento gera alerta", () => {
  const a = alertaDeCobrancaAposCancelamento(
    "netflix",
    "Netflix",
    "CANCELLED",
    "2026-07-20",
    [despesa("1", "NETFLIX.COM*1", 39.9, "2026-07-15"), despesa("2", "NETFLIX.COM*2", 39.9, "2026-08-15")],
  );
  assert.ok(a);
  assert.equal(a.tipo, "CHARGED_AFTER_CANCEL");
  assert.match(a.mensagem, /15\/08\/2026/);
});

test("a cobranca que motivou o cancelamento nao dispara o alerta", () => {
  // Comparacao estritamente maior: a cobranca do dia 15 e anterior ao clique
  // do dia 20. Com >=, o alerta nasceria no mesmo instante do cancelamento.
  const a = alertaDeCobrancaAposCancelamento(
    "netflix",
    "Netflix",
    "CANCELLED",
    "2026-07-20",
    [despesa("1", "NETFLIX.COM*1", 39.9, "2026-07-15")],
  );
  assert.equal(a, null);
});

test("so o status CANCELLED dispara o alerta de cobranca", () => {
  for (const status of ["DETECTED", "CONFIRMED", "IGNORED"]) {
    assert.equal(
      alertaDeCobrancaAposCancelamento("x", "X", status, "2026-07-20", [
        despesa("1", "X", 10, "2026-08-15"),
      ]),
      null,
      `status ${status} nao deveria alertar`,
    );
  }
});
