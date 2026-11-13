// =========================================================
// PULODOGATO -- os tres numeros da conversa (HMO-465, F2 da HMO-462)
// =========================================================
//   npm run test:saldo-da-conversa
//
// Roda o JS compilado de lib/saldo-da-conversa.ts, com `periodo-do-painel`
// emitido junto: o mes corrente medido aqui e o do app, nao uma copia.
//
// A FRASE DA ISSUE E O CASO 1, E ELA E CONFERIVEL DE CABECA
// ---------------------------------------------------------
// "Gastei 1000, ganhei 2000, entao saldo 1000." Duas linhas de fixture, tres
// assercoes, nenhuma conta recalculada com a formula da lib -- um conferidor que
// usa o mesmo extrator nos dois lados concorda com qualquer aritmetica,
// inclusive com `ganhei + gastei`. Todo esperado deste arquivo e CRAVADO.
//
// OS TRES SAO ASSERIDOS SEPARADOS, SEMPRE
// ---------------------------------------
// Nunca so o saldo. O mutante que troca o rotulo das pernas
// (`=== "income"` virando `=== "expense"`) deixa o SALDO EM 1000 e move
// `ganhei` para 1000 -- com uma assercao de saldo sozinha ele sobreviveria, e a
// tela diria "Ganhei 1000, Gastei 0, Saldo 1000" sobre um mes em que ela ganhou
// 2000 e gastou 1000. Dai o desenho: tres assercoes por caso.
//
// CADA ARMADILHA TEM VALOR PROPRIO, E NENHUM E REDONDO
// ----------------------------------------------------
// 777,77 (grupo), 333,33 (marca), 444,44 (cache), 555,55 e 666,66 (meses
// vizinhos), 5000 (transferencia), 1234,56 (tipo nulo). Valores distintos
// porque uma armadilha que vale o mesmo que a outra nao diz QUAL filtro caiu --
// o numero da assercao e o diagnostico.
//
// A SOMA DAS ASSERCOES E EM CENTAVOS
// ----------------------------------
// A lib devolve reais com 2 casas, mas SOMAR dois desses floats reintroduz o
// erro (`1444.44 + 555.56` nao e 2000 exato em todo caminho). Onde o teste
// precisa de soma, ele soma em centavos inteiros.
//
// O LIMITE CONHECIDO DA MEDICAO DO RELOGIO
// ----------------------------------------
// O caso do `mesCorrenteDaConversa()` sem argumento prova que ele vem do fuso de
// SAO PAULO e nao do relogio do processo -- mas Sao Paulo e UTC so discordam nas
// ultimas 3 horas do mes, entao essa assercao sozinha nao pegaria um
// `new Date().toISOString()` em 99% dos dias. O que cobre isso de verdade e a
// suite rodar nos DOIS fusos (`TZ=America/Sao_Paulo` e `TZ=UTC`, no
// package.json) somada aos casos de data CRAVADA abaixo, que nao leem relogio
// nenhum.
// =========================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  COLUNAS_DA_CONVERSA,
  linhasDaConversa,
  mesCorrenteDaConversa,
  tresNumerosDaConversa,
} = await import("../.tmp-saldo-da-conversa/lib/saldo-da-conversa.js");

// ---------------------------------------------------------
// O FIXTURE
// ---------------------------------------------------------
// Marco de 2026, com vizinhos dos dois lados para o recorte ter o que descartar.
const HOJE = "2026-03-15";
const MES = mesCorrenteDaConversa(HOJE);

const GRUPO_CASA = "99999999-9999-9999-9999-999999999999";

/** `amount` como STRING, que e o que o PostgREST manda de um `numeric(15,2)`. */
function ganho(amount, transaction_date, extra = {}) {
  return {
    transaction_type: "income",
    amount: String(amount),
    transaction_date,
    group_id: null,
    include_in_total: true,
    ...extra,
  };
}

/** Despesa, NEGATIVA -- a convencao de `financial_transactions`. */
function gasto(amount, transaction_date, extra = {}) {
  return {
    transaction_type: "expense",
    amount: String(-Math.abs(amount)),
    transaction_date,
    group_id: null,
    include_in_total: true,
    ...extra,
  };
}

/** A frase da issue, e nada mais: ganhou 2000, gastou 1000. */
const A_FRASE_DA_ISSUE = [
  ganho(2000, "2026-03-10"),
  gasto(1000, "2026-03-12"),
];

/**
 * A MESMA frase, com as sete armadilhas em volta -- o caso 9.
 *
 * Declarado AQUI, junto do fixture, e nao na secao 9 que o mede: o caso 2 o usa,
 * e um `const` declarado depois do `test()` que o le funciona por acidente (o
 * corpo do teste roda depois do modulo inteiro). Mover um teste para cima
 * quebraria com `Cannot access before initialization`, que se le como erro do
 * runner.
 */
const O_MES_CHEIO = [
  ganho(2000, "2026-03-10"),
  gasto(1000, "2026-03-12"),
  gasto(777.77, "2026-03-05", { group_id: GRUPO_CASA }),
  gasto(333.33, "2026-03-07", { include_in_total: false }),
  ganho(555.55, "2026-02-28"),
  ganho(666.66, "2026-04-01"),
  {
    transaction_type: "transfer",
    amount: "-5000",
    transaction_date: "2026-03-11",
    group_id: null,
    include_in_total: true,
  },
  {
    transaction_type: null,
    amount: "-1234.56",
    transaction_date: "2026-03-11",
    group_id: null,
    include_in_total: true,
  },
];

function emCentavos(valor) {
  return Math.round(valor * 100);
}

// ---------------------------------------------------------
// 1. A FRASE DA ISSUE
// ---------------------------------------------------------

test("os tres numeros: ganhei 2000, gastei 1000, saldo 1000", () => {
  const tres = tresNumerosDaConversa(A_FRASE_DA_ISSUE, MES);

  assert.equal(tres.ganhei, 2000);
  assert.equal(tres.gastei, 1000);
  assert.equal(tres.saldo, 1000);
});

test("a aritmetica FECHA: saldo e sempre ganhei menos gastei", () => {
  // O que a tela promete. Vale para a frase da issue e para o mes cheio do
  // caso 9 -- se este par de assercoes falhar, nenhum dos tres numeros serve.
  for (const linhas of [A_FRASE_DA_ISSUE, O_MES_CHEIO]) {
    const t = tresNumerosDaConversa(linhas, MES);
    assert.equal(
      emCentavos(t.saldo),
      emCentavos(t.ganhei) - emCentavos(t.gastei)
    );
  }
});

test("a despesa entra NEGATIVA e sai POSITIVA em gastei", () => {
  // O `Math.abs` + `transaction_type`, nao o sinal do numero. Sem o abs,
  // `gastei` ficaria -1000 e `ganhei - gastei` SOMARIA as duas pernas (3000),
  // com os dois primeiros numeros da tela certos e o terceiro errado.
  assert.equal(A_FRASE_DA_ISSUE[1].amount, "-1000");
  assert.equal(tresNumerosDaConversa(A_FRASE_DA_ISSUE, MES).gastei, 1000);
});

test("`amount` numerico e `amount` string dao o mesmo numero", () => {
  const comNumero = [
    { ...A_FRASE_DA_ISSUE[0], amount: 2000 },
    { ...A_FRASE_DA_ISSUE[1], amount: -1000 },
  ];
  assert.deepEqual(
    tresNumerosDaConversa(comNumero, MES),
    tresNumerosDaConversa(A_FRASE_DA_ISSUE, MES)
  );
});

// ---------------------------------------------------------
// 2. FILTRO 1 -- `group_id IS NULL`
// ---------------------------------------------------------

test("a perna de GRUPO do custo pessoal dela NAO entra", () => {
  // Linha de verdade em `financial_transactions`, com o `user_id` DELA -- a RLS
  // a entrega, e sem o filtro ela e somada calada. Sem o `group_id IS NULL`,
  // `gastei` viraria 1777,77.
  const linhas = [
    ...A_FRASE_DA_ISSUE,
    gasto(777.77, "2026-03-05", { group_id: GRUPO_CASA }),
  ];
  const tres = tresNumerosDaConversa(linhas, MES);

  assert.equal(tres.ganhei, 2000);
  assert.equal(tres.gastei, 1000);
  assert.equal(tres.saldo, 1000);
});

// ---------------------------------------------------------
// 3. FILTRO 2 -- `include_in_total`
// ---------------------------------------------------------

test("o lancamento marcado FORA DOS TOTAIS nao entra", () => {
  const linhas = [
    ...A_FRASE_DA_ISSUE,
    gasto(333.33, "2026-03-07", { include_in_total: false }),
  ];
  const tres = tresNumerosDaConversa(linhas, MES);

  assert.equal(tres.ganhei, 2000);
  assert.equal(tres.gastei, 1000);
  assert.equal(tres.saldo, 1000);
});

test("a linha SEM o campo (cache offline, banco pre-060) CONTA", () => {
  // O caso que separa `!== false` de `=== true`, e o unico que o separa: a
  // coluna e NOT NULL no banco, entao `undefined` so chega de onde o Postgres
  // nao respondeu. Com `=== true`, toda linha do cache sairia da soma e a
  // conversa mostraria o saldo errado PARA BAIXO sem rede.
  const semOCampo = gasto(444.44, "2026-03-08");
  delete semOCampo.include_in_total;
  assert.equal("include_in_total" in semOCampo, false);

  const tres = tresNumerosDaConversa([...A_FRASE_DA_ISSUE, semOCampo], MES);

  assert.equal(tres.ganhei, 2000);
  assert.equal(tres.gastei, 1444.44);
  assert.equal(tres.saldo, 555.56);
});

test("`include_in_total: null` tambem CONTA", () => {
  // NULL nao existe na coluna (NOT NULL), mas existe em qualquer caminho que
  // passe por JSON com o campo zerado. "Nao sei" soma, que e o default.
  const comNull = gasto(444.44, "2026-03-08", { include_in_total: null });
  assert.equal(tresNumerosDaConversa([...A_FRASE_DA_ISSUE, comNull], MES).gastei, 1444.44);
});

// ---------------------------------------------------------
// 4. FILTRO 3 -- O MES CORRENTE
// ---------------------------------------------------------

test("os meses VIZINHOS ficam fora dos tres numeros", () => {
  // Sem o recorte, `ganhei` viraria 3222,21 -- e um saldo sem periodo cresce
  // para sempre e nunca reinicia.
  const linhas = [
    ...A_FRASE_DA_ISSUE,
    ganho(555.55, "2026-02-28"),
    ganho(666.66, "2026-04-01"),
  ];
  const tres = tresNumerosDaConversa(linhas, MES);

  assert.equal(tres.ganhei, 2000);
  assert.equal(tres.gastei, 1000);
  assert.equal(tres.saldo, 1000);
});

test("as BORDAS do mes entram -- dia 1 e ultimo dia", () => {
  // Janela FECHADA dos dois lados. Um `>` no lugar do `>=` perderia o dia 1, e
  // ninguem na tela saberia por que o salario do dia 1 nao apareceu.
  const linhas = [ganho(10, "2026-03-01"), gasto(3, "2026-03-31")];
  const tres = tresNumerosDaConversa(linhas, MES);

  assert.equal(tres.ganhei, 10);
  assert.equal(tres.gastei, 3);
  assert.equal(tres.saldo, 7);
});

test("o mes corrente sai de `periodoCorrente`, com data cravada", () => {
  assert.deepEqual(mesCorrenteDaConversa("2026-03-15"), {
    de: "2026-03-01",
    ate: "2026-03-31",
  });

  // E o ultimo dia e o do mes de verdade, inclusive em fevereiro bissexto.
  assert.deepEqual(mesCorrenteDaConversa("2026-02-10"), {
    de: "2026-02-01",
    ate: "2026-02-28",
  });
  assert.deepEqual(mesCorrenteDaConversa("2024-02-10"), {
    de: "2024-02-01",
    ate: "2024-02-29",
  });
});

test("sem argumento, o mes corrente vem do fuso de SAO PAULO", () => {
  // Nao do relogio do processo: a sandbox e Sao Paulo e o CI e UTC, e nas
  // ultimas 3 horas do mes os dois discordam de MES (HMO-173).
  const emSaoPaulo = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());

  assert.deepEqual(mesCorrenteDaConversa(), mesCorrenteDaConversa(emSaoPaulo));

  // E a forma: primeiro dia do mes, e os dois extremos no MESMO mes.
  const { de, ate } = mesCorrenteDaConversa();
  assert.match(de, /^\d{4}-\d{2}-01$/);
  assert.equal(de.slice(0, 7), ate.slice(0, 7));
});

// ---------------------------------------------------------
// 5. FILTRO 4 -- SO 'income' E 'expense'
// ---------------------------------------------------------

test("a TRANSFERENCIA nao e ganho nem gasto", () => {
  // Dinheiro andando entre as contas dela. Contada, viraria gasto fantasma de
  // 5000 -- e a frase da tela mandaria a Leticia procurar uma despesa que nao
  // existe.
  const transferencia = {
    transaction_type: "transfer",
    amount: "-5000",
    transaction_date: "2026-03-11",
    group_id: null,
    include_in_total: true,
  };
  const tres = tresNumerosDaConversa([...A_FRASE_DA_ISSUE, transferencia], MES);

  assert.equal(tres.ganhei, 2000);
  assert.equal(tres.gastei, 1000);
  assert.equal(tres.saldo, 1000);
});

test("`transaction_type` NULO nao e ganho nem gasto", () => {
  // A coluna e ANULAVEL na tabela. Um `else` no lugar do segundo `if` varreria
  // esta linha para dentro de `gastei` (2234,56).
  const semTipo = {
    transaction_type: null,
    amount: "-1234.56",
    transaction_date: "2026-03-11",
    group_id: null,
    include_in_total: true,
  };
  const tres = tresNumerosDaConversa([...A_FRASE_DA_ISSUE, semTipo], MES);

  assert.equal(tres.ganhei, 2000);
  assert.equal(tres.gastei, 1000);
  assert.equal(tres.saldo, 1000);
});

// ---------------------------------------------------------
// 6. O `amount` QUE NAO VIRA NUMERO
// ---------------------------------------------------------

test("`amount` invalido e descartado, e NAO envenena os tres numeros", () => {
  // Um `NaN` numa parcela viraria "R$ NaN" nos TRES campos de uma vez.
  const lixo = ganho("abracadabra", "2026-03-11");
  const tres = tresNumerosDaConversa([...A_FRASE_DA_ISSUE, lixo], MES);

  assert.equal(tres.ganhei, 2000);
  assert.equal(tres.gastei, 1000);
  assert.equal(tres.saldo, 1000);
  for (const n of [tres.ganhei, tres.gastei, tres.saldo]) {
    assert.equal(Number.isFinite(n), true);
  }
});

// ---------------------------------------------------------
// 7. CENTAVOS
// ---------------------------------------------------------

test("a soma de centavos nao acumula erro de float", () => {
  const linhas = [
    ganho(0.1, "2026-03-02"),
    ganho(0.2, "2026-03-03"),
    gasto(0.3, "2026-03-04"),
  ];
  const tres = tresNumerosDaConversa(linhas, MES);

  assert.equal(tres.ganhei, 0.3);
  assert.equal(tres.gastei, 0.3);
  assert.equal(tres.saldo, 0);
});

test("o mes vazio da tres zeros, nao tres `undefined`", () => {
  assert.deepEqual(tresNumerosDaConversa([], MES), {
    ganhei: 0,
    gastei: 0,
    saldo: 0,
  });
});

// ---------------------------------------------------------
// 8. `linhasDaConversa` -- a lista que a rota e a tela recebem
// ---------------------------------------------------------

test("`linhasDaConversa` devolve EXATAMENTE as linhas que a soma contou", () => {
  // A lista da tela e o total em cima dela saem do MESMO criterio. Duas copias
  // divergiriam, e o sintoma seria uma lista de 4 linhas debaixo do total de 2.
  const linhas = [
    { ...ganho(2000, "2026-03-10"), marca: "entra: ganho do mes" },
    { ...gasto(1000, "2026-03-12"), marca: "entra: gasto do mes" },
    { ...gasto(777.77, "2026-03-05", { group_id: GRUPO_CASA }), marca: "grupo" },
    { ...gasto(333.33, "2026-03-07", { include_in_total: false }), marca: "marca" },
    { ...ganho(555.55, "2026-02-28"), marca: "mes anterior" },
    { ...ganho(666.66, "2026-04-01"), marca: "mes seguinte" },
  ];

  assert.deepEqual(
    linhasDaConversa(linhas, MES).map((l) => l.marca),
    ["entra: ganho do mes", "entra: gasto do mes"]
  );
});

test("`linhasDaConversa` nao muta nem reordena a lista recebida", () => {
  const linhas = [...A_FRASE_DA_ISSUE];
  const antes = JSON.stringify(linhas);
  linhasDaConversa(linhas, MES);
  assert.equal(JSON.stringify(linhas), antes);
});

// ---------------------------------------------------------
// 9. O MES CHEIO -- todas as armadilhas de uma vez
// ---------------------------------------------------------
// Uma armadilha por caso prova cada filtro isolado; todas juntas provam que
// nenhum par delas se cancela. Os dois desenhos sao necessarios: um filtro
// quebrado que SOMA 777,77 e outro que SUBTRAI 777,77 passariam verdes num
// caso unico de total. (`O_MES_CHEIO` esta declarado junto do fixture, no topo.)

test("o mes cheio, com as sete armadilhas, ainda da 2000 / 1000 / 1000", () => {
  const tres = tresNumerosDaConversa(O_MES_CHEIO, MES);

  assert.equal(tres.ganhei, 2000);
  assert.equal(tres.gastei, 1000);
  assert.equal(tres.saldo, 1000);
});

// ---------------------------------------------------------
// 10. O `select` DA LEITURA
// ---------------------------------------------------------

test("o `select` da conversa e `*`, e nao a lista de colunas", () => {
  // Nomear `include_in_total` faz o PostgREST responder 42703 em qualquer banco
  // que ainda nao recebeu a 060 -- e migration neste repo e colada A MAO, depois
  // do deploy. Medido em producao na HMO-431 com a homonima da 058. A constante
  // existe para que F3 nao redescubra isso por um 500.
  assert.equal(COLUNAS_DA_CONVERSA, "*");
  assert.equal(COLUNAS_DA_CONVERSA.includes("include_in_total"), false);
});
