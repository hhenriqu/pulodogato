// =============================================================================
// PULODOGATO - o acerto registrado vira TETO do credito a receber (HMO-404)
// =============================================================================
//   npm run test:teto-do-acerto
//
// Roda o JS compilado de lib/teto-do-acerto.ts, lib/credito-de-grupo.ts e
// lib/fechamento-do-grupo.ts -- por isso o npm script tem o passo de
// resolve-aliases.
//
// O QUE FOI MEDIDO EM PRODUCAO, E QUE E O ALVO DESTE ARQUIVO
// ----------------------------------------------------------
// `scripts/medicao-hmo367-duas-leituras.mjs` (prod, 12/10/2026, fixture
// HMO-255): o C pagou os R$ 240,00 que devia a A, a tela do grupo passou a
// dizer "nada a receber" e a aba Receitas continuou prometendo R$ 39,99 a
// receber do MESMO C, em outubro E em setembro. O criterio decidido na HMO-367:
//
//   teto(g, devedor) = max(0, acumulado(g, devedor) - acertos_recebidos(g, devedor))
//   credito_do_periodo = min(credito_do_periodo_de_hoje, teto(g, devedor))
//
// POR QUE O TESTE ALIMENTA O TETO COM A SAIDA REAL DE `fecharMes`
// ---------------------------------------------------------------
// Escrever `{ linhas: [...], total }` a mao seria mais curto e mediria menos:
// o acumulado de que o teto depende sai da aritmetica do proprio `fecharMes`
// sobre TODOS os meses do grupo, com previsto e realizado juntos (pedido da
// HMO-245), e um objeto escrito a mao nao tem previsto nem realizado dentro --
// tem numeros. Os blocos abaixo montam as despesas de verdade, conferem que o
// fechamento tem previsto onde deveria, e so depois medem o teto.
//
// A FIXTURE TEM DOIS DEVEDORES, E ISSO NAO E ENFEITE
// --------------------------------------------------
// Com UM devedor, "agregar os acertos por grupo" e "agregar por (grupo,
// devedor)" dao o MESMO numero -- os dois criterios empatam, e um teste de um
// devedor so deixaria passar o criterio errado. O defeito dele e que o
// pagamento do C abate o que o D me deve: o D sai da tela devendo zero. Por
// isso todo bloco de teto tem dois devedores, um que pagou e um que nao.
//
// CADA BLOCO TEM O CONTROLE JUNTO: sem acerto nenhum o `min` e no-op por
// construcao, e "e estruturalmente impossivel" ja foi dito neste projeto sobre
// defeito que existia -- entao esta medido, com numeros diferentes de zero dos
// dois lados, que e o que distingue "nao mexeu" de "a leitura morreu".
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";

const { fecharMes, linhaDoPrevisto, linhaDoRealizado } = await import(
  "../.tmp-teto-do-acerto/fechamento-do-grupo.js"
);

const { creditoAReceber } = await import(
  "../.tmp-teto-do-acerto/credito-de-grupo.js"
);

const { acertosRecebidosPorDevedor, aplicarTetoDoAcerto, chaveDoPar } =
  await import("../.tmp-teto-do-acerto/teto-do-acerto.js");

const EU = "11111111-1111-1111-1111-111111111111";
const C = "22222222-2222-2222-2222-222222222222";
const D = "33333333-3333-3333-3333-333333333333";

const NOME = { [EU]: "Hélio", [C]: "Camila", [D]: "Dani" };

const CASA = { id: "g-casa", nome: "Casa" };
const VIAGEM = { id: "g-viagem", nome: "Viagem" };

/** Membros sem peso = divisao igual, que e o caso de todo grupo nao configurado. */
const membros = (...ids) =>
  ids.map((id) => ({ user_id: id, full_name: NOME[id] ?? null }));

/** Uma despesa JA PAGA por `pagador`, lancada no grupo. */
const realizada = (id, valor, data, pagador = EU) =>
  linhaDoRealizado({
    id,
    description: id,
    // `financial_transactions.amount` de despesa e NEGATIVO neste banco.
    amount: String(-Math.abs(valor)),
    exchange_rate: 1,
    transaction_date: data,
    user_id: pagador,
    transaction_type: "expense",
  });

/** Uma despesa que NINGUEM pagou ainda -- a conta a vencer. */
const prevista = (id, valor, vencimento, pagador = EU) =>
  linhaDoPrevisto({
    id,
    description: id,
    // `scheduled_transactions.amount` e POSITIVO por CHECK.
    amount: String(Math.abs(valor)),
    due_date: vencimento,
    user_id: pagador,
    status: "pending",
    direction: "expense",
    group_id: CASA.id,
  });

/**
 * O credito de um grupo em `meses`, pela cadeia de verdade:
 * `fecharMes` (um por mes) -> `creditoAReceber`.
 */
const creditoEm = (grupo, linhas, gente, meses) =>
  creditoAReceber(
    meses.map((mes) => ({
      grupo,
      fechamento: fecharMes(linhas, gente, mes),
    })),
    EU
  );

/** O valor da linha de um devedor, ou `null` quando ele nao esta na lista. */
const valorDe = (credito, devedor) =>
  credito.linhas.find((l) => l.devedor_user_id === devedor)?.valor ?? null;

// -----------------------------------------------------------------------------
// A FIXTURE: a Casa com dois devedores, seis meses, previsto E realizado
// -----------------------------------------------------------------------------
// EU pago R$ 90,00 de jantar todo mes num grupo de tres: cada um deve R$ 30,00,
// entao o C me deve 30 e o D me deve 30 POR MES. Outubro e PREVISTO (ninguem
// pagou ainda) e setembro e REALIZADO -- a mistura que `fecharMes` faz de
// proposito, e que e a razao de o teto nao poder sair da view do 007, que e so
// realizado.
const GENTE = membros(EU, C, D);
const LINHAS_DA_CASA = [
  realizada("t-set", 90, "2026-09-22"),
  prevista("s-out", 90, "2026-10-22"),
];
const MESES_DO_GRUPO = ["2026-09", "2026-10"];
const SO_OUTUBRO = ["2026-10"];

test("a fixture e o que eu digo que ela e: outubro e PREVISTO, e cada devedor me deve 30 por mes", () => {
  const outubro = fecharMes(LINHAS_DA_CASA, GENTE, "2026-10");
  assert.equal(outubro.total, 90);
  // O bloco inteiro perde o sentido se outubro estiver realizado: o teto da
  // view (alternativa 3, reprovada) acertaria o numero por acaso.
  assert.equal(outubro.total_previsto, 90);
  assert.equal(outubro.total_realizado, 0);

  const setembro = fecharMes(LINHAS_DA_CASA, GENTE, "2026-09");
  assert.equal(setembro.total_realizado, 90);

  const doMes = creditoEm(CASA, LINHAS_DA_CASA, GENTE, SO_OUTUBRO);
  assert.equal(valorDe(doMes, C), 30);
  assert.equal(valorDe(doMes, D), 30);
  assert.equal(doMes.total, 60);

  const acumulado = creditoEm(CASA, LINHAS_DA_CASA, GENTE, MESES_DO_GRUPO);
  assert.equal(valorDe(acumulado, C), 60);
  assert.equal(valorDe(acumulado, D), 60);
});

// -----------------------------------------------------------------------------
// O CONTROLE, E ELE VEM PRIMEIRO: GRUPO SEM ACERTO NENHUM NAO MUDA
// -----------------------------------------------------------------------------
test("sem acerto nenhum o teto e no-op -- e os numeros nao sao zero", () => {
  const doPeriodo = creditoEm(CASA, LINHAS_DA_CASA, GENTE, SO_OUTUBRO);
  const acumulado = creditoEm(CASA, LINHAS_DA_CASA, GENTE, MESES_DO_GRUPO);

  const presas = aplicarTetoDoAcerto({
    doPeriodo,
    acumulado,
    acertos: acertosRecebidosPorDevedor([]),
  });

  assert.deepEqual(
    presas.linhas.map((l) => [l.devedor_user_id, l.valor]),
    doPeriodo.linhas.map((l) => [l.devedor_user_id, l.valor])
  );
  assert.equal(presas.total, doPeriodo.total);

  // O controle nao e vacuo: 60,00 e as duas linhas sao distinguiveis de "a
  // leitura morreu", que um controle de zero vs zero nao distinguiria.
  assert.equal(presas.total, 60);
  assert.equal(presas.linhas.length, 2);
});

test("acerto de OUTRO grupo nao abate nada aqui", () => {
  const doPeriodo = creditoEm(CASA, LINHAS_DA_CASA, GENTE, SO_OUTUBRO);
  const acumulado = creditoEm(CASA, LINHAS_DA_CASA, GENTE, MESES_DO_GRUPO);

  const presas = aplicarTetoDoAcerto({
    doPeriodo,
    acumulado,
    // O MESMO devedor, o MESMO valor, a Viagem em vez da Casa.
    acertos: acertosRecebidosPorDevedor([
      { group_id: VIAGEM.id, from_user_id: C, amount: "60.00", exchange_rate: 1 },
    ]),
  });

  assert.equal(presas.total, 60);
  assert.equal(valorDe(presas, C), 30);
});

// -----------------------------------------------------------------------------
// O CASO DA ISSUE: O DEVEDOR PAGOU TUDO, E O CREDITO DELE VAI A ZERO
// -----------------------------------------------------------------------------
test("o C pagou o acumulado inteiro: a linha dele sai, e a do D fica intacta", () => {
  const doPeriodo = creditoEm(CASA, LINHAS_DA_CASA, GENTE, SO_OUTUBRO);
  const acumulado = creditoEm(CASA, LINHAS_DA_CASA, GENTE, MESES_DO_GRUPO);

  const presas = aplicarTetoDoAcerto({
    doPeriodo,
    acumulado,
    acertos: acertosRecebidosPorDevedor([
      { group_id: CASA.id, from_user_id: C, amount: "60.00", exchange_rate: 1 },
    ]),
  });

  // teto(C) = max(0, 60 - 60) = 0, entao min(30, 0) = 0 -- e linha de R$ 0,00
  // nao fica na tela.
  assert.equal(valorDe(presas, C), null);

  // O CRITERIO ERRADO QUE ESTE PAR DE ASSERCOES EXISTE PARA PEGAR: agregar o
  // acerto por GRUPO abateria do D o que o C pagou, e o D sairia devendo zero
  // (as duas linhas sumiriam, total 0,00). Com um devedor so, os dois
  // criterios empatam.
  assert.equal(valorDe(presas, D), 30);
  assert.equal(presas.linhas.length, 1);

  // O total e a SOMA DAS LINHAS (criterio da HMO-275). O teto aplicado ao
  // total daria 60,00 aqui, com uma linha de 30,00 embaixo dele.
  assert.equal(presas.total, 30);
  assert.equal(
    presas.total,
    presas.linhas.reduce((s, l) => s + l.valor, 0)
  );
});

test("o acerto PARCIAL prende no que sobra, e nao zera", () => {
  const doPeriodo = creditoEm(CASA, LINHAS_DA_CASA, GENTE, SO_OUTUBRO);
  const acumulado = creditoEm(CASA, LINHAS_DA_CASA, GENTE, MESES_DO_GRUPO);

  const presas = aplicarTetoDoAcerto({
    doPeriodo,
    acumulado,
    // Acumulado do C = 60; ele pagou 45, entao o teto e 15 e o credito do mes
    // (30) cai para 15. Subtrair dentro do mes daria 30 - 45 = -15.
    acertos: acertosRecebidosPorDevedor([
      { group_id: CASA.id, from_user_id: C, amount: "45.00", exchange_rate: 1 },
    ]),
  });

  assert.equal(valorDe(presas, C), 15);
  assert.equal(valorDe(presas, D), 30);
  assert.equal(presas.total, 45);
});

test("acerto MAIOR que o acumulado nao vira desconto: o teto tem piso zero", () => {
  const doPeriodo = creditoEm(CASA, LINHAS_DA_CASA, GENTE, SO_OUTUBRO);
  const acumulado = creditoEm(CASA, LINHAS_DA_CASA, GENTE, MESES_DO_GRUPO);

  const presas = aplicarTetoDoAcerto({
    doPeriodo,
    acumulado,
    // O C me pagou 100 sobre um acumulado de 60 (pagou adiantado, ou pagou
    // fora do que o app conhece). Sem o piso, teto = -40: a linha dele entra
    // com valor NEGATIVO e o total do cartao fica 30 - 40 = -10,00, ou seja o
    // acerto do C passa a DESCONTAR o que o D me deve.
    acertos: acertosRecebidosPorDevedor([
      { group_id: CASA.id, from_user_id: C, amount: "100.00", exchange_rate: 1 },
    ]),
  });

  assert.equal(valorDe(presas, C), null);
  assert.equal(valorDe(presas, D), 30);
  assert.equal(presas.total, 30);
  assert.ok(
    presas.total > 0,
    "o total nunca e negativo -- 'a receber' negativo e uma divida escrita em verde"
  );
  assert.equal(
    presas.total,
    presas.linhas.reduce((s, l) => s + l.valor, 0)
  );
});

// -----------------------------------------------------------------------------
// O LIMITE DECLARADO: EXATO NO PERIODO INTEIRO, APROXIMADO NO SUB-PERIODO
// -----------------------------------------------------------------------------
test("o teto e exato para os dois meses juntos e aproximado para um mes so", () => {
  // O exemplo do cabecalho de lib/teto-do-acerto.ts, com os numeros dele: o C
  // deve 40 realizado em setembro e 100 previsto em outubro, e paga 40.
  const gente = membros(EU, C);
  const linhas = [
    realizada("t-set", 80, "2026-09-10"),
    prevista("s-out", 200, "2026-10-10"),
  ];
  const acertos = acertosRecebidosPorDevedor([
    { group_id: CASA.id, from_user_id: C, amount: "40.00", exchange_rate: 1 },
  ]);
  const acumulado = creditoEm(CASA, linhas, gente, MESES_DO_GRUPO);
  assert.equal(valorDe(acumulado, C), 140);

  const osDois = aplicarTetoDoAcerto({
    doPeriodo: creditoEm(CASA, linhas, gente, MESES_DO_GRUPO),
    acumulado,
    acertos,
  });
  // EXATO: 140 - 40 = 100, que e o previsto de outubro.
  assert.equal(osDois.total, 100);

  const soSetembro = aplicarTetoDoAcerto({
    doPeriodo: creditoEm(CASA, linhas, gente, ["2026-09"]),
    acumulado,
    acertos,
  });
  // APROXIMADO, e isso esta escrito no codigo e na issue: setembro sozinho
  // continua 40 embora aquele mes tenha sido pago, porque nada liga um acerto
  // ao mes que ele quita. O conserto exato e o elo acerto <-> divida, que e
  // migration e fase propria.
  assert.equal(soSetembro.total, 40);
});

// -----------------------------------------------------------------------------
// O CAMBIO: CADA LADO PELA COTACAO CONGELADA DELE, OS DOIS EM BRL
// -----------------------------------------------------------------------------
test("o acerto em moeda estrangeira abate pela cotacao congelada dele", () => {
  const doPeriodo = creditoEm(CASA, LINHAS_DA_CASA, GENTE, SO_OUTUBRO);
  const acumulado = creditoEm(CASA, LINHAS_DA_CASA, GENTE, MESES_DO_GRUPO);

  const presas = aplicarTetoDoAcerto({
    doPeriodo,
    acumulado,
    // US$ 12,00 a 5,00 = R$ 60,00, que quita o acumulado do C inteiro.
    // Ignorar `exchange_rate` abateria 12 reais e deixaria o credito em 30.
    acertos: acertosRecebidosPorDevedor([
      { group_id: CASA.id, from_user_id: C, amount: "12.00", exchange_rate: "5.00" },
    ]),
  });

  assert.equal(valorDe(presas, C), null);
  assert.equal(presas.total, 30);
});

test("cotacao nula e cotacao zero valem 1 -- o acerto em real nao se perde", () => {
  for (const cotacao of [null, 0, ""]) {
    const presas = aplicarTetoDoAcerto({
      doPeriodo: creditoEm(CASA, LINHAS_DA_CASA, GENTE, SO_OUTUBRO),
      acumulado: creditoEm(CASA, LINHAS_DA_CASA, GENTE, MESES_DO_GRUPO),
      acertos: acertosRecebidosPorDevedor([
        {
          group_id: CASA.id,
          from_user_id: C,
          amount: "60.00",
          exchange_rate: cotacao,
        },
      ]),
    });
    assert.equal(
      valorDe(presas, C),
      null,
      `cotacao ${JSON.stringify(cotacao)} deveria valer 1`
    );
  }
});

// -----------------------------------------------------------------------------
// A SOMA DOS ACERTOS, E A CHAVE DO PAR
// -----------------------------------------------------------------------------
test("dois acertos do mesmo devedor somam; o do outro devedor nao se mistura", () => {
  const acertos = acertosRecebidosPorDevedor([
    { group_id: CASA.id, from_user_id: C, amount: "20.00", exchange_rate: 1 },
    { group_id: CASA.id, from_user_id: C, amount: "25.50", exchange_rate: 1 },
    { group_id: CASA.id, from_user_id: D, amount: "10.00", exchange_rate: 1 },
  ]);

  assert.equal(acertos.get(chaveDoPar(CASA.id, C)), 4550);
  assert.equal(acertos.get(chaveDoPar(CASA.id, D)), 1000);

  const presas = aplicarTetoDoAcerto({
    doPeriodo: creditoEm(CASA, LINHAS_DA_CASA, GENTE, SO_OUTUBRO),
    acumulado: creditoEm(CASA, LINHAS_DA_CASA, GENTE, MESES_DO_GRUPO),
    acertos,
  });

  // teto(C) = 60 - 45,50 = 14,50; teto(D) = 60 - 10 = 50 -> min(30, 50) = 30.
  assert.equal(valorDe(presas, C), 14.5);
  assert.equal(valorDe(presas, D), 30);
  assert.equal(presas.total, 44.5);
});

test("os centavos somam em centavos inteiros, sem residuo de fracao", () => {
  const acertos = acertosRecebidosPorDevedor(
    // Tres acertos de 0,10 em ponto flutuante dao 0.30000000000000004.
    Array.from({ length: 3 }, () => ({
      group_id: CASA.id,
      from_user_id: C,
      amount: "0.10",
      exchange_rate: 1,
    }))
  );
  assert.equal(acertos.get(chaveDoPar(CASA.id, C)), 30);
});

// -----------------------------------------------------------------------------
// A ORDEM DA LISTA DEPOIS DO TETO
// -----------------------------------------------------------------------------
test("a lista e reordenada pelo valor JA preso, e nao pelo valor de antes", () => {
  // O C me deve mais, e quase tudo dele esta pago; o D me deve menos e nao
  // pagou nada. Depois do teto, o D e a maior linha -- e a tela ordena do
  // maior para o menor.
  const gente = membros(EU, C, D);
  const linhas = [
    // Setembro: so o C participa da despesa grande (ele e o pagador de nada e
    // eu paguei 300 num grupo de 3 -> cada um deve 100).
    realizada("t-set", 300, "2026-09-05"),
    prevista("s-out", 150, "2026-10-05"),
  ];
  // Acumulado por devedor: 100 (set) + 50 (out) = 150 para cada um.
  const acumulado = creditoEm(CASA, linhas, gente, MESES_DO_GRUPO);
  assert.equal(valorDe(acumulado, C), 150);

  const presas = aplicarTetoDoAcerto({
    // No periodo de setembro o credito e de 100 por devedor.
    doPeriodo: creditoEm(CASA, linhas, gente, ["2026-09"]),
    acumulado,
    acertos: acertosRecebidosPorDevedor([
      // O C pagou 140 dos 150: sobra teto de 10.
      { group_id: CASA.id, from_user_id: C, amount: "140.00", exchange_rate: 1 },
    ]),
  });

  assert.deepEqual(
    presas.linhas.map((l) => [l.devedor_user_id, l.valor]),
    [
      [D, 100],
      [C, 10],
    ]
  );
});

// -----------------------------------------------------------------------------
// O QUE O TETO NAO TOCA
// -----------------------------------------------------------------------------
test("`sem_devedor` passa intacto -- o teto e por (grupo, devedor)", () => {
  const doPeriodo = {
    ...creditoEm(CASA, LINHAS_DA_CASA, GENTE, SO_OUTUBRO),
    sem_devedor: 0.01,
  };

  const presas = aplicarTetoDoAcerto({
    doPeriodo,
    acumulado: creditoEm(CASA, LINHAS_DA_CASA, GENTE, MESES_DO_GRUPO),
    acertos: acertosRecebidosPorDevedor([
      { group_id: CASA.id, from_user_id: C, amount: "60.00", exchange_rate: 1 },
    ]),
  });

  assert.equal(presas.sem_devedor, 0.01);
});

test("o devedor que nao aparece no acumulado nao inventa credito", () => {
  // Caminho que a leitura real nao produz (o acumulado e um super-conjunto dos
  // meses do periodo), mas a funcao e publica: sem o `?? 0` do acumulado, a
  // conta viraria `undefined` e o `min` devolveria NaN -- um R$ NaN na tela.
  const presas = aplicarTetoDoAcerto({
    doPeriodo: creditoEm(CASA, LINHAS_DA_CASA, GENTE, SO_OUTUBRO),
    acumulado: { linhas: [], total: 0, sem_devedor: 0 },
    acertos: acertosRecebidosPorDevedor([]),
  });

  assert.equal(presas.total, 0);
  assert.deepEqual(presas.linhas, []);
});
