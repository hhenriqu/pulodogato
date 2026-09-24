#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DO GASTO VARIAVEL DO DIA A DIA
// =====================================================
//   npm run test:variable-spend
//
// Exercita lib/variable-spend.ts. O que este arquivo protege, em ordem de
// quanto custa errar:
//
//   1. CONTAR A ASSINATURA DUAS VEZES. A Netflix ja entra na previsao como
//      evento datado. Se ela tambem estiver dentro da media diaria, a linha
//      provavel mergulha num dia que nao vai acontecer -- e o numero continua
//      parecendo plausivel, que e o que torna esse erro caro.
//
//   2. EXCLUIR DE MAIS, que e pior. Uma chave excluida da media SEM virar
//      evento some das duas metades, e a linha "provavel" fica mais otimista
//      que a "otimista" -- o oposto exato do que ela promete. Por isso ha
//      teste de que a chave de fora do conjunto CONTINUA na media: e o unico
//      jeito de a assinatura marcada como IGNORED nao evaporar.
//
//   3. MES PELA METADE. O mes corrente entrando na base puxaria a mediana para
//      baixo todo comeco de mes.
//
//   4. MES VAZIO. Quem importou marco e setembro tem cinco meses sem dado no
//      meio. Contar zero neles zera a media e a segunda linha vira a primeira.
//
//   5. O SINAL. Despesa e gravada NEGATIVA aqui, e um fixture positivo passa
//      verde sem provar nada -- por isso TODO fixture deste arquivo e negativo.
//
//   6. A MEDIANA, nao a media: o mes de ferias nao pode virar o novo normal.
//
// Mesmo desenho do test-cash-flow-forecast.mjs: .mjs rodando o JS que o tsc
// emitiu, com o passo de reescrita de alias no meio, sem runner novo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  calcularGastoVariavel,
  janelaValida,
  mesesFechados,
  inicioDaJanela,
  MESES_JANELA_PADRAO,
  MESES_JANELA_MAX,
  MIN_MESES_JANELA,
  DIAS_MEDIOS_DO_MES,
} = await import("../.tmp-variable-spend/variable-spend.js");

const HOJE = "2026-09-10";

// Os seis meses fechados que a janela padrao alcanca a partir de HOJE.
const FECHADOS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];

/**
 * Uma despesa. O `amount` sai NEGATIVO de proposito -- e como o banco grava, e
 * um fixture positivo esconderia um `SUM` cru que passou a ler o sinal.
 */
const gasto = (data, valor, descricao = "MERCADO EXTRA") => ({
  transaction_date: data,
  amount: -Math.abs(valor),
  transaction_type: "expense",
  description: descricao,
});

/** A mesma despesa em todos os meses de `meses`, sempre no dia 15. */
const todoMes = (meses, valor, descricao) =>
  meses.map((m) => gasto(`${m}-15`, valor, descricao));

// ---------------------------------------------------------------------------
// O caso base
// ---------------------------------------------------------------------------

test("seis meses fechados de 1.500 devolvem 1.500/mes e o diario correspondente", () => {
  const r = calcularGastoVariavel({
    transacoes: todoMes(FECHADOS, 1500),
    chavesComprometidas: [],
    hoje: HOJE,
  });

  assert.equal(r.mesesBase, 6);
  assert.equal(r.temBase, true);
  assert.equal(r.porMes, 1500);
  assert.equal(r.porDia, 1500 / DIAS_MEDIOS_DO_MES);
});

test("a despesa e gravada NEGATIVA e o gasto sai POSITIVO", () => {
  const r = calcularGastoVariavel({
    transacoes: todoMes(FECHADOS, 800),
    chavesComprometidas: [],
    hoje: HOJE,
  });

  // O teste que mata um `SUM(amount)` cru: com o sinal cru isto seria -800.
  assert.equal(r.porMes, 800);
  assert.ok(r.porDia > 0, "o gasto diario tem que ser positivo");
});

test("a procedencia sai junto: os meses usados, em ordem, com o total de cada um", () => {
  const r = calcularGastoVariavel({
    transacoes: [
      gasto("2026-08-15", 900),
      gasto("2026-08-20", 100),
      gasto("2026-07-15", 700),
      gasto("2026-06-15", 500),
    ],
    chavesComprometidas: [],
    hoje: HOJE,
  });

  assert.deepEqual(r.meses, [
    { mes: "2026-06", total: 500 },
    { mes: "2026-07", total: 700 },
    { mes: "2026-08", total: 1000 },
  ]);
});

// ---------------------------------------------------------------------------
// 1 e 2. A contagem dupla, e o exagero na correcao dela
// ---------------------------------------------------------------------------

test("a chave comprometida sai da media -- e o quanto ela pesava sai junto", () => {
  const r = calcularGastoVariavel({
    transacoes: [
      ...todoMes(FECHADOS, 1000, "MERCADO EXTRA"),
      ...todoMes(FECHADOS, 55, "NETFLIX.COM*123"),
    ],
    chavesComprometidas: ["netflix"],
    hoje: HOJE,
  });

  assert.equal(r.porMes, 1000, "a Netflix nao pode estar na media: ela ja e evento");
  assert.equal(r.chavesDescartadas, 1);
  assert.equal(r.totalComprometidoDescartado, 55 * 6);
});

test("a chave FORA do conjunto continua na media -- e o que salva a assinatura ignorada", () => {
  // Uma recorrencia em IGNORED e o usuario dizendo "isto nao e assinatura". A
  // rota nao a manda em `chavesComprometidas`, e a previsao nao a projeta como
  // evento. Se mesmo assim ela saisse da media, o gasto sumiria das duas
  // metades e a linha provavel ficaria ACIMA da realidade.
  const r = calcularGastoVariavel({
    transacoes: [
      ...todoMes(FECHADOS, 1000, "MERCADO EXTRA"),
      ...todoMes(FECHADOS, 55, "NETFLIX.COM*123"),
    ],
    chavesComprometidas: [],
    hoje: HOJE,
  });

  assert.equal(r.porMes, 1055);
  assert.equal(r.chavesDescartadas, 0);
  assert.equal(r.totalComprometidoDescartado, 0);
});

test("a exclusao e por chave normalizada, nao por texto igual", () => {
  // As tres descricoes sao a mesma assinatura escrita de tres jeitos pelo
  // adquirente. Comparar string crua deixaria duas delas passarem.
  const r = calcularGastoVariavel({
    transacoes: [
      ...todoMes(FECHADOS, 1000, "MERCADO EXTRA"),
      gasto("2026-08-05", 55, "NETFLIX.COM*4429"),
      gasto("2026-07-05", 55, "NETFLIX COM BR"),
      gasto("2026-06-05", 55, "PAG*NETFLIX"),
    ],
    chavesComprometidas: ["netflix"],
    hoje: HOJE,
  });

  assert.equal(r.porMes, 1000);
  assert.equal(r.totalComprometidoDescartado, 165);
});

test("descricao sem chave aproveitavel NAO e descartada", () => {
  // Chave vazia nao casa com nada comprometido, e aquilo foi dinheiro que saiu.
  const r = calcularGastoVariavel({
    transacoes: [
      ...todoMes(FECHADOS, 1000, "MERCADO EXTRA"),
      ...todoMes(FECHADOS, 30, ""),
    ],
    chavesComprometidas: ["", "netflix"],
    hoje: HOJE,
  });

  assert.equal(r.porMes, 1030);
  assert.equal(r.chavesDescartadas, 0);
});

// ---------------------------------------------------------------------------
// 3. O mes pela metade, e a janela
// ---------------------------------------------------------------------------

test("o mes corrente NAO entra na base", () => {
  const base = todoMes(FECHADOS, 1500);
  const semCorrente = calcularGastoVariavel({
    transacoes: base,
    chavesComprometidas: [],
    hoje: HOJE,
  });
  const comCorrente = calcularGastoVariavel({
    transacoes: [...base, gasto("2026-09-02", 90)],
    chavesComprometidas: [],
    hoje: HOJE,
  });

  assert.deepEqual(comCorrente.meses, semCorrente.meses);
  assert.equal(comCorrente.porMes, 1500);
});

test("mes anterior a janela fica de fora", () => {
  const r = calcularGastoVariavel({
    transacoes: [...todoMes(FECHADOS, 1500), gasto("2026-02-15", 99999)],
    chavesComprometidas: [],
    hoje: HOJE,
  });

  assert.equal(r.mesesBase, 6);
  assert.equal(r.porMes, 1500);
});

test("a janela anda para tras a partir do mes anterior, virando o ano", () => {
  assert.deepEqual(mesesFechados("2026-01-15", 3), ["2025-12", "2025-11", "2025-10"]);
  assert.deepEqual(mesesFechados(HOJE, 6), [
    "2026-08",
    "2026-07",
    "2026-06",
    "2026-05",
    "2026-04",
    "2026-03",
  ]);
  assert.equal(inicioDaJanela("2026-01-15", 3), "2025-10-01");
});

test("janela fora de faixa e corrigida, nao rejeitada", () => {
  assert.equal(janelaValida(undefined), MESES_JANELA_PADRAO);
  assert.equal(janelaValida(0), MESES_JANELA_PADRAO);
  assert.equal(janelaValida(1), MESES_JANELA_PADRAO);
  assert.equal(janelaValida(-5), MESES_JANELA_PADRAO);
  assert.equal(janelaValida(Number.NaN), MESES_JANELA_PADRAO);
  assert.equal(janelaValida(999), MESES_JANELA_MAX);
  assert.equal(janelaValida(4), 4);
});

// ---------------------------------------------------------------------------
// 4. O mes vazio
// ---------------------------------------------------------------------------

test("mes sem movimento nao entra como zero na base", () => {
  // Tres meses com extrato importado, tres sem. Se os vazios contassem zero, a
  // mediana de [0,0,0,1200,1200,1200] seria 600 -- metade do real.
  const r = calcularGastoVariavel({
    transacoes: todoMes(["2026-06", "2026-07", "2026-08"], 1200),
    chavesComprometidas: [],
    hoje: HOJE,
  });

  assert.equal(r.mesesBase, 3);
  assert.equal(r.porMes, 1200);
});

test("menos de tres meses com movimento nao produzem media nenhuma", () => {
  const r = calcularGastoVariavel({
    transacoes: todoMes(["2026-07", "2026-08"], 1200),
    chavesComprometidas: [],
    hoje: HOJE,
  });

  assert.equal(r.mesesBase, 2);
  assert.equal(r.temBase, false);
  // Zero, e nao a media dos dois meses: quem ignorar `temBase` erra para o lado
  // de nao mudar a linha, nao para o lado de desenhar uma segunda linha falsa.
  assert.equal(r.porDia, 0);
  assert.equal(r.porMes, 0);
});

test("usuario sem transacao nenhuma nao divide por zero", () => {
  const r = calcularGastoVariavel({
    transacoes: [],
    chavesComprometidas: [],
    hoje: HOJE,
  });

  assert.equal(r.mesesBase, 0);
  assert.equal(r.temBase, false);
  assert.equal(r.porDia, 0);
  assert.ok(Number.isFinite(r.porDia));
});

test("o piso de meses e o MIN_MESES_JANELA declarado", () => {
  const meses = ["2026-06", "2026-07", "2026-08"].slice(0, MIN_MESES_JANELA);
  const r = calcularGastoVariavel({
    transacoes: todoMes(meses, 900),
    chavesComprometidas: [],
    hoje: HOJE,
  });

  assert.equal(r.temBase, true);
});

// ---------------------------------------------------------------------------
// 5 e 6. O que nao e gasto, e a mediana
// ---------------------------------------------------------------------------

test("receita e transferencia ficam de fora", () => {
  // O salario e as duas pernas do pagamento de fatura (HMO-149) aparecem em
  // TODOS os meses da janela, e nao so num deles. A diferenca nao e cosmetica:
  // com o ruido em um mes so, a mediana o engole e o teste passa verde mesmo
  // se o filtro por `transaction_type` for removido -- foi assim que esta
  // versao nasceu, e a mutacao que deveria mata-la sobreviveu. Em todos os
  // meses, qualquer vazamento move a mediana.
  const salarios = FECHADOS.map((m) => ({
    transaction_date: `${m}-05`,
    amount: 9000,
    transaction_type: "income",
    description: "SALARIO",
  }));
  const fatura = FECHADOS.flatMap((m) => [
    {
      transaction_date: `${m}-10`,
      amount: -3000,
      transaction_type: "transfer",
      description: "PAGAMENTO FATURA CARTAO",
    },
    {
      transaction_date: `${m}-10`,
      amount: 3000,
      transaction_type: "transfer",
      description: "PAGAMENTO FATURA CARTAO",
    },
  ]);

  const r = calcularGastoVariavel({
    transacoes: [...todoMes(FECHADOS, 1000), ...salarios, ...fatura],
    chavesComprometidas: [],
    hoje: HOJE,
  });

  assert.equal(r.porMes, 1000);
});

test("a mediana resiste ao mes de ferias; a media nao resistiria", () => {
  const r = calcularGastoVariavel({
    transacoes: [
      ...todoMes(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"], 1000),
      gasto("2026-08-15", 6000),
    ],
    chavesComprometidas: [],
    hoje: HOJE,
  });

  // Mediana de [1000,1000,1000,1000,1000,6000] = 1000.
  // A media seria 1833,33 e a linha provavel passaria a mentir para baixo em
  // todo mes comum -- exatamente o que a escolha da mediana existe para evitar.
  assert.equal(r.porMes, 1000);
});

test("a conversao mensal -> diario usa 365,25/12, nao 30", () => {
  const r = calcularGastoVariavel({
    transacoes: todoMes(FECHADOS, 3044),
    chavesComprometidas: [],
    hoje: HOJE,
  });

  assert.equal(DIAS_MEDIOS_DO_MES, 30.44);
  assert.equal(r.porDia, 100);
});
