// =========================================================
// PULODOGATO - o recorte de mes da aba de despesas do grupo (HMO-248)
// =========================================================
//   npm run test:periodo-do-grupo
//
// Roda o JS compilado de lib/periodo-do-grupo.ts, que importa lib/settlement.ts
// e lib/fechamento-do-grupo.ts -- por isso o npm script tem o passo de
// resolve-aliases.
//
// Cada bloco carrega o CONTROLE: o numero que a tela ANTES desta issue
// mostrava. Sem isso "total = 1800" passa verde num recorte que devolve a
// lista inteira num grupo que so tem uma conta -- e a assercao nao seria capaz
// de falhar. O numero do antes aqui e 5400: o aluguel de tres meses somado num
// cartao que se chama "Previstas" e nao diz de qual mes.
// =========================================================

import test from "node:test";
import assert from "node:assert/strict";

const { rotuloDoMes, recortarPrevistas, recortarRealizado } = await import(
  "../.tmp-periodo-do-grupo/periodo-do-grupo.js"
);

/** O aluguel da issue: fixa de R$ 1.800, vencendo dia 10, tres meses materializados. */
const aluguel = (mes) => ({
  id: `aluguel-${mes}`,
  description: "Aluguel",
  due_date: `${mes}-10`,
  amount: 1800,
  share_amount: 900,
  is_recurring: true,
});

// ---------------------------------------------------------
// O caso da issue, numero por numero
// ---------------------------------------------------------
test("o aluguel fixo de tres meses vira UMA conta no mes selecionado", () => {
  const previstas = [
    aluguel("2026-10"),
    aluguel("2026-11"),
    aluguel("2026-12"),
  ];

  // CONTROLE: o que a tela mostrava antes -- a lista inteira e a soma dela.
  assert.equal(previstas.length, 3);
  assert.equal(
    previstas.reduce((s, p) => s + p.amount, 0),
    5400,
    "controle: era este o total que o cartao Previstas mostrava"
  );

  const recorte = recortarPrevistas(previstas, "2026-10");

  assert.equal(recorte.doMes.length, 1, "o mes tem UMA parcela do aluguel");
  assert.equal(recorte.doMes[0].id, "aluguel-2026-10");
  assert.equal(recorte.total, 1800, "o total do mes e o aluguel, nao tres");
  assert.notEqual(recorte.total, 5400);
  assert.equal(recorte.parte, 900, "a parte tambem e de um mes so");

  // E as outras duas nao somem sem contagem: o cartao tem o que dizer.
  assert.deepEqual(recorte.depois, { quantidade: 2, total: 3600 });
  assert.deepEqual(recorte.antes, { quantidade: 0, total: 0 });
});

test("trocar o mes mostra o aluguel DAQUELE mes, e nao uma lista vazia", () => {
  const previstas = [aluguel("2026-10"), aluguel("2026-11")];

  const novembro = recortarPrevistas(previstas, "2026-11");
  assert.equal(novembro.doMes.length, 1);
  assert.equal(novembro.doMes[0].id, "aluguel-2026-11");
  assert.equal(novembro.total, 1800);
  // Outubro ficou ATRAS de novembro, nao a frente.
  assert.deepEqual(novembro.antes, { quantidade: 1, total: 1800 });
  assert.deepEqual(novembro.depois, { quantidade: 0, total: 0 });
});

test("a parcela VENCIDA de um mes passado fica fora do total e continua contada", () => {
  // O caso que o recorte por mes poderia esconder, e que e justamente o que
  // precisa de acao: a parcela de setembro que ninguem pagou.
  const previstas = [aluguel("2026-09"), aluguel("2026-10")];
  const recorte = recortarPrevistas(previstas, "2026-10");

  assert.equal(recorte.total, 1800, "setembro NAO entra no total de outubro");
  assert.equal(
    recorte.antes.quantidade,
    1,
    "a vencida de setembro tem de ser contada em algum lugar"
  );
  assert.equal(recorte.antes.total, 1800);
});

// ---------------------------------------------------------
// O fuso: o bug que o recorte antigo tinha
// ---------------------------------------------------------
test("a conta que vence no dia 1 pertence ao mes dela, e nao ao anterior", () => {
  const diaUm = { ...aluguel("2026-10"), id: "s1", due_date: "2026-10-01" };

  // CONTROLE: o caminho que a tela usava. `new Date("2026-10-01")` e meia-noite
  // UTC; em America/Sao_Paulo isso e 21:00 de 30/09 e `getMonth()` devolve
  // SETEMBRO. Em CI (UTC) devolve outubro -- e por isso o bug nao aparecia no
  // teste e aparecia no celular.
  const ingenuo = new Date("2026-10-01");
  if (ingenuo.getTimezoneOffset() > 0) {
    assert.equal(
      ingenuo.getMonth(),
      8,
      "controle: o caminho por Date joga o dia 1 no mes anterior neste fuso"
    );
  }

  const recorte = recortarPrevistas([diaUm], "2026-10");
  assert.equal(recorte.doMes.length, 1, "o dia 1 e de outubro");
  assert.equal(recorte.total, 1800);

  const emSetembro = recortarPrevistas([diaUm], "2026-09");
  assert.equal(emSetembro.doMes.length, 0, "e NAO e de setembro");
});

test("a despesa realizada no dia 1 tambem pertence ao mes dela", () => {
  const linhas = [
    { id: "t1", transaction_date: "2026-10-01", amount: -120 },
    { id: "t2", transaction_date: "2026-10-31", amount: -80 },
    { id: "t3", transaction_date: "2026-09-30", amount: -50 },
  ];

  const outubro = recortarRealizado(linhas, "2026-10");
  assert.deepEqual(
    outubro.map((l) => l.id),
    ["t1", "t2"],
    "o dia 1 e o dia 31 sao do mes; o 30/09 nao"
  );

  // CONTROLE da propria extracao: um filtro que devolvesse tudo daria 3.
  assert.notEqual(outubro.length, linhas.length);
});

test("mes invalido devolve lista vazia, nao a lista inteira do grupo", () => {
  // A linha SEM DATA e o que faz a guarda `if (!alvo) return []` ter trabalho,
  // e nao ser codigo morto. Com mes invalido `alvo` e "", e `mesDaData(null)`
  // tambem e "": sem a guarda a comparacao `"" === ""` e VERDADEIRA e a despesa
  // sem data entra na lista de todo mes que nao existe. O mutante que remove a
  // guarda sobrevive a qualquer caso que tenha data em todas as linhas.
  const linhas = [
    { id: "t1", transaction_date: "2026-10-01" },
    { id: "t2", transaction_date: null },
  ];
  // Um `?mes=` cortado no meio nao pode virar "todas as despesas da vida do
  // grupo" sob um titulo de um mes so.
  assert.deepEqual(recortarRealizado(linhas, "2026-1"), []);
  assert.deepEqual(recortarRealizado(linhas, ""), []);
  assert.deepEqual(recortarRealizado(linhas, null), []);
  // E o controle: com o mes certo a linha com data aparece, e a sem data nao.
  assert.deepEqual(
    recortarRealizado(linhas, "2026-10").map((l) => l.id),
    ["t1"]
  );
});

test("previstas com mes invalido nao engordam o total do mes", () => {
  const recorte = recortarPrevistas([aluguel("2026-10")], "outubro");
  assert.equal(recorte.doMes.length, 0);
  assert.equal(recorte.total, 0, "nada entra num mes que nao existe");
  // A conta nao evaporou: ela esta contada.
  assert.equal(recorte.antes.quantidade, 1);
});

test("conta prevista sem data vence fora do mes e continua contada", () => {
  const semData = { id: "s9", due_date: null, amount: 100, share_amount: 50 };
  const recorte = recortarPrevistas([semData, aluguel("2026-10")], "2026-10");

  assert.equal(recorte.total, 1800, "a linha sem data nao entra no total");
  assert.equal(recorte.antes.quantidade, 1);
  assert.equal(recorte.antes.total, 100);
});

// ---------------------------------------------------------
// A soma em centavos
// ---------------------------------------------------------
test("a soma do mes nao ganha o centavo de nada do float", () => {
  const previstas = [
    { id: "a", due_date: "2026-10-05", amount: 0.1, share_amount: 0.05 },
    { id: "b", due_date: "2026-10-06", amount: 0.2, share_amount: 0.1 },
  ];

  // CONTROLE: a soma em reais, que e o que um `reduce` cru produz.
  assert.notEqual(0.1 + 0.2, 0.3);

  const recorte = recortarPrevistas(previstas, "2026-10");
  assert.equal(recorte.total, 0.3);
  assert.equal(recorte.parte, 0.15);
});

test("valor negativo entra como grandeza positiva", () => {
  // `scheduled_transactions.amount` tem CHECK > 0, mas a tela ja recebeu linha
  // de outras formas; um valor negativo aqui SUBTRAIRIA do total do mes.
  const recorte = recortarPrevistas(
    [
      { id: "a", due_date: "2026-10-05", amount: 100, share_amount: 50 },
      { id: "b", due_date: "2026-10-06", amount: -40, share_amount: -20 },
    ],
    "2026-10"
  );
  assert.equal(recorte.total, 140, "nao 60: o sinal nao apaga despesa");
  assert.equal(recorte.parte, 70);
});

// ---------------------------------------------------------
// Ordem estavel
// ---------------------------------------------------------
test("a lista do mes sai da que vence primeiro, com empate estavel", () => {
  const previstas = [
    { id: "zz", due_date: "2026-10-20", amount: 10, share_amount: 5 },
    { id: "bb", due_date: "2026-10-05", amount: 10, share_amount: 5 },
    { id: "aa", due_date: "2026-10-05", amount: 10, share_amount: 5 },
  ];
  const ids = recortarPrevistas(previstas, "2026-10").doMes.map((p) => p.id);
  assert.deepEqual(ids, ["aa", "bb", "zz"]);
  // Duas chamadas sobre a mesma entrada dao a mesma ordem: sem isso a lista
  // se reorganiza a cada carregamento da tela sem nada ter mudado.
  assert.deepEqual(recortarPrevistas(previstas, "2026-10").doMes.map((p) => p.id), ids);
});

test("a entrada nao e mutada pelo recorte", () => {
  const previstas = [
    { id: "zz", due_date: "2026-10-20", amount: 10, share_amount: 5 },
    { id: "aa", due_date: "2026-10-05", amount: 10, share_amount: 5 },
  ];
  recortarPrevistas(previstas, "2026-10");
  assert.deepEqual(
    previstas.map((p) => p.id),
    ["zz", "aa"],
    "o sort nao pode reordenar o array que o componente guarda no estado"
  );
});

// ---------------------------------------------------------
// rotuloDoMes
// ---------------------------------------------------------
test("o rotulo do mes sai da string, e nao de um Date em UTC", () => {
  // CONTROLE: o caminho por Date. `new Date("2026-10")` e meia-noite UTC de
  // 01/10, que em America/Sao_Paulo e setembro.
  const ingenuo = new Date("2026-10");
  if (ingenuo.getTimezoneOffset() > 0) {
    assert.equal(
      ingenuo.getMonth(),
      8,
      "controle: por Date o rotulo diria setembro sobre outubro"
    );
  }

  assert.equal(rotuloDoMes("2026-10"), "outubro de 2026");
  assert.equal(rotuloDoMes("2026-01"), "janeiro de 2026");
  assert.equal(rotuloDoMes("2026-12"), "dezembro de 2026");
  // Mes que nao existe devolve a propria string em vez de "undefined de 2026".
  assert.equal(rotuloDoMes("2026-99"), "2026-99");
  assert.equal(rotuloDoMes(""), "");
});

// ---------------------------------------------------------
// Vacuidade
// ---------------------------------------------------------
test("grupo sem conta prevista devolve zeros, nao NaN", () => {
  const vazio = recortarPrevistas([], "2026-10");
  assert.deepEqual(vazio.doMes, []);
  assert.equal(vazio.total, 0);
  assert.equal(vazio.parte, 0);
  assert.deepEqual(vazio.antes, { quantidade: 0, total: 0 });
  assert.deepEqual(vazio.depois, { quantidade: 0, total: 0 });
  assert.equal(Number.isNaN(vazio.total), false);
});
