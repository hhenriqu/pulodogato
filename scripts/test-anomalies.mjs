#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DA ANOMALIA DE GASTO E DO RESUMO DO MES
// =====================================================
//   npm run test:anomalies
//
// Exercita lib/anomalies.ts. Cada bloco abaixo existe porque a implementacao
// ERRADA correspondente e plausivel, compila, e produz um numero que parece
// certo na tela. Em ordem de quanto custa errar:
//
//   1. O SINAL. Despesa e gravada NEGATIVA. Um `SUM(amount)` cru inverte o mes
//      caro com o mes barato. Os fixtures daqui sao NEGATIVOS de proposito --
//      um fixture positivo passa verde sem provar nada, que foi como esse erro
//      quase entrou na Fase 2.
//
//   2. A JANELA. Comparar o dia 12 do mes corrente com meses CHEIOS anteriores
//      acusa queda todo comeco de mes e esconde o estouro. O teste da janela
//      esta montado para que a implementacao ingenua fique VERMELHA, nao so
//      "menos precisa".
//
//   3. MEDIANA, NAO MEDIA. Um mes de ferias na base levanta a media o bastante
//      para engolir o estouro do mes seguinte. O teste tem os numeros escolhidos
//      para que media e mediana deem respostas OPOSTAS.
//
//   4. USUARIO NOVO. Sem historico nao ha alerta, nao ha divisao por zero e nao
//      ha "+Infinity%" na tela.
//
//   5. AS DUAS REGUAS JUNTAS. Percentual sem piso em reais avisa sobre quatro
//      reais; piso sem percentual acusa quem so tem uma categoria cara.
//
//   6. A VIRADA DO ANO. O resumo de janeiro fala de dezembro do ano ANTERIOR.
//      Com `new Date`, no fuso de Sao Paulo, esse mes sai errado.
//
// Mesmo desenho do test-safe-to-spend.mjs: .mjs rodando o JS que o tsc emitiu,
// com o passo de reescrita de alias no meio, sem runner novo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  detectarAnomalias,
  resumoDoMesFechado,
  compararComHistorico,
  gastoDaTransacao,
  mesAnterior,
  chaveDoEstabelecimento,
  MIN_MESES_BASE,
  FATOR_ANOMALIA,
  EXCESSO_MINIMO,
  TOP_CRESCIMENTOS,
} = await import("../.tmp-anomalies/anomalies.js");

// ---------------------------------------------------------------------------
// Atalhos de fixture
// ---------------------------------------------------------------------------

/** Uma despesa, com o valor NEGATIVO como o banco guarda. */
function gasto(data, valor, { categoria = "cat-mercado", descricao = "MERCADO X" } = {}) {
  return {
    transaction_date: data,
    amount: -Math.abs(valor),
    transaction_type: "expense",
    category_id: categoria,
    description: descricao,
  };
}

/** Repete o mesmo gasto no mesmo dia de varios meses. */
function gastoMensal(meses, dia, valor, opcoes) {
  return meses.map((m) => gasto(`${m}-${dia}`, valor, opcoes));
}

/** Só as categorias, indexadas pela chave, para afirmar sem depender da ordem. */
function porChave(lista) {
  return new Map(lista.map((c) => [c.chave, c]));
}

// ---------------------------------------------------------------------------
// 1. O SINAL -- a armadilha mais cara
// ---------------------------------------------------------------------------

test("despesa negativa vira gasto positivo", () => {
  assert.equal(gastoDaTransacao({ transaction_date: "2026-09-01", amount: -250, transaction_type: "expense" }), 250);
});

test("despesa em texto (numeric do PostgREST) tambem", () => {
  assert.equal(gastoDaTransacao({ transaction_date: "2026-09-01", amount: "-250.50", transaction_type: "expense" }), 250.5);
});

test("receita nao e gasto", () => {
  assert.equal(gastoDaTransacao({ transaction_date: "2026-09-01", amount: 5000, transaction_type: "income" }), 0);
});

test("transfer nao e gasto -- as duas pernas do pagamento de fatura ficam de fora", () => {
  // HMO-149: pagar a fatura gera duas linhas `transfer`. Contar qualquer uma
  // delas lancaria a fatura inteira como gasto novo do mes, em cima das compras
  // que ja foram contadas uma a uma -- o mes apareceria com o dobro do cartao.
  const perna1 = { transaction_date: "2026-09-10", amount: -1200, transaction_type: "transfer" };
  const perna2 = { transaction_date: "2026-09-10", amount: 1200, transaction_type: "transfer" };
  assert.equal(gastoDaTransacao(perna1), 0);
  assert.equal(gastoDaTransacao(perna2), 0);
});

test("o total do mes soma o valor absoluto, nao o sinal", () => {
  // Controle negativo do item 1: com `SUM(amount)` cru, `atual` seria -300 e a
  // afirmacao abaixo quebra.
  const r = detectarAnomalias({
    transacoes: [gasto("2026-09-03", 100), gasto("2026-09-04", 200)],
    hoje: "2026-09-10",
  });
  assert.equal(porChave(r.categorias).get("cat-mercado").atual, 300);
});

// ---------------------------------------------------------------------------
// 2. A JANELA -- mes incompleto contra mes cheio
// ---------------------------------------------------------------------------

test("no dia 12, o historico tambem e cortado no dia 12", () => {
  // Cada mes anterior: 100 no dia 5 (dentro da janela) e 900 no dia 20 (fora).
  // O mes corrente, ate o dia 12: 150.
  //
  //   comparacao correta (janela x janela): tipico 100, atual 150 -> ANOMALIA
  //   comparacao ingenua (janela x mes cheio): tipico 1000, atual 150 -> "queda de 85%"
  //
  // Os dois caminhos dao respostas opostas, entao este teste distingue de
  // verdade qual foi implementado.
  const anteriores = ["2026-06", "2026-07", "2026-08"];
  const transacoes = [
    ...gastoMensal(anteriores, "05", 100),
    ...gastoMensal(anteriores, "20", 900),
    gasto("2026-09-03", 150),
  ];

  const r = detectarAnomalias({ transacoes, hoje: "2026-09-12" });
  const mercado = porChave(r.categorias).get("cat-mercado");

  assert.equal(r.ateODia, 12);
  assert.equal(mercado.tipico, 100, "a base tem que ser a janela, nao o mes cheio");
  assert.equal(mercado.atual, 150);
  assert.equal(mercado.anomalia, true);
});

test("gasto depois do dia do corte nao entra no mes corrente", () => {
  // Lancamento com data adiantada dentro do mes corrente: existe (conta agendada
  // que ja virou transacao). Se entrasse, o mes de hoje somaria o que ainda nao
  // aconteceu e o alerta sairia antes do gasto.
  const r = detectarAnomalias({
    transacoes: [gasto("2026-09-05", 100), gasto("2026-09-28", 5000)],
    hoje: "2026-09-12",
  });
  assert.equal(porChave(r.categorias).get("cat-mercado").atual, 100);
});

test("mes futuro nao entra no historico", () => {
  const anteriores = ["2026-06", "2026-07", "2026-08"];
  const r = detectarAnomalias({
    transacoes: [
      ...gastoMensal(anteriores, "05", 100),
      ...gastoMensal(["2026-10", "2026-11"], "05", 9000),
      gasto("2026-09-05", 200),
    ],
    hoje: "2026-09-12",
  });
  const mercado = porChave(r.categorias).get("cat-mercado");
  assert.equal(mercado.mesesBase, 3, "outubro e novembro nao sao historico de setembro");
  assert.equal(mercado.tipico, 100);
});

// ---------------------------------------------------------------------------
// 3. MEDIANA, NAO MEDIA -- o mes de ferias
// ---------------------------------------------------------------------------

test("um mes de ferias na base nao engole o estouro do mes seguinte", () => {
  // Base: cinco meses a 400 e um (ferias) a 2400.
  //   mediana = 400  -> atual 700 e 1,75x o tipico, excesso 300 -> ANOMALIA
  //   media   = 733  -> atual 700 fica ABAIXO do tipico -> nada
  //
  // Escolhido para que os dois criterios se contradigam. Trocar a mediana pela
  // media deixa este teste vermelho.
  const transacoes = [
    ...gastoMensal(["2026-03", "2026-04", "2026-05", "2026-07", "2026-08"], "05", 400),
    ...gastoMensal(["2026-06"], "05", 2400),
    gasto("2026-09-05", 700),
  ];

  const r = detectarAnomalias({ transacoes, hoje: "2026-09-20" });
  const mercado = porChave(r.categorias).get("cat-mercado");

  assert.equal(mercado.tipico, 400, "a base tem que ser a mediana, nao a media");
  assert.equal(mercado.anomalia, true);
});

test("mes sem movimento na chave nao entra na base", () => {
  // Quem come fora a cada dois meses tem o normal calculado sobre os meses em
  // que comeu. Contar zero derrubaria a mediana e a primeira saida do ano
  // viraria anomalia.
  const r = detectarAnomalias({
    transacoes: [
      ...gastoMensal(["2026-05", "2026-07", "2026-08"], "05", 300, { categoria: "cat-restaurante" }),
      gasto("2026-09-05", 320, { categoria: "cat-restaurante" }),
    ],
    hoje: "2026-09-20",
  });
  const rest = porChave(r.categorias).get("cat-restaurante");
  assert.equal(rest.mesesBase, 3, "junho nao teve movimento e nao conta como zero");
  assert.equal(rest.tipico, 300);
  assert.equal(rest.anomalia, false, "320 contra 300 nao e estouro");
});

// ---------------------------------------------------------------------------
// 4. USUARIO NOVO
// ---------------------------------------------------------------------------

test("primeiro mes de uso nao gera alerta nenhum", () => {
  const r = detectarAnomalias({
    transacoes: [gasto("2026-09-03", 5000), gasto("2026-09-04", 8000)],
    hoje: "2026-09-10",
  });
  assert.deepEqual(r.alertas, []);
  assert.equal(r.temBase, false, "sem base, a tela precisa saber que e 'ainda nao da para saber'");
});

test("dois meses de historico ainda nao bastam", () => {
  const r = detectarAnomalias({
    transacoes: [
      ...gastoMensal(["2026-07", "2026-08"], "05", 100),
      gasto("2026-09-05", 900),
    ],
    hoje: "2026-09-20",
  });
  const mercado = porChave(r.categorias).get("cat-mercado");
  assert.equal(mercado.mesesBase, 2);
  assert.equal(mercado.anomalia, false, `MIN_MESES_BASE e ${MIN_MESES_BASE}`);
});

test("categoria que estreia nao vira anomalia nem imprime Infinity", () => {
  const r = detectarAnomalias({
    transacoes: [
      ...gastoMensal(["2026-06", "2026-07", "2026-08"], "05", 100, { categoria: "cat-mercado" }),
      gasto("2026-09-05", 4000, { categoria: "cat-estreia", descricao: "MOVEIS NOVOS" }),
    ],
    hoje: "2026-09-20",
  });
  const estreia = porChave(r.categorias).get("cat-estreia");
  assert.equal(estreia.tipico, 0);
  assert.equal(estreia.razao, null, "sem base nao existe percentual -- nem Infinity, nem NaN");
  assert.equal(estreia.anomalia, false);
});

// ---------------------------------------------------------------------------
// 5. AS DUAS REGUAS, JUNTAS
// ---------------------------------------------------------------------------

test("+100% de quatro reais nao vira notificacao", () => {
  // Piso em reais. Sem ele o app avisa sobre trocado e o usuario desliga a
  // notificacao -- levando junto o aviso de vencimento.
  const r = detectarAnomalias({
    transacoes: [
      ...gastoMensal(["2026-06", "2026-07", "2026-08"], "05", 8, { categoria: "cat-cafe" }),
      gasto("2026-09-05", 16, { categoria: "cat-cafe" }),
    ],
    hoje: "2026-09-20",
  });
  const cafe = porChave(r.categorias).get("cat-cafe");
  assert.equal(cafe.razao, 2, "dobrou de verdade");
  assert.equal(cafe.anomalia, false, `mas o excesso (8) esta abaixo de ${EXCESSO_MINIMO}`);
});

test("categoria cara e estavel nao vira notificacao", () => {
  // O erro simetrico: so o piso em reais acusaria todo mes quem paga aluguel.
  const r = detectarAnomalias({
    transacoes: [
      ...gastoMensal(["2026-06", "2026-07", "2026-08"], "05", 3000, { categoria: "cat-aluguel" }),
      gasto("2026-09-05", 3100, { categoria: "cat-aluguel" }),
    ],
    hoje: "2026-09-20",
  });
  const aluguel = porChave(r.categorias).get("cat-aluguel");
  assert.equal(aluguel.excesso, 100, `acima de ${EXCESSO_MINIMO}`);
  assert.equal(aluguel.anomalia, false, `mas nao chega a ${FATOR_ANOMALIA}x o tipico`);
});

test("estourou nas duas reguas -- este sim vira alerta", () => {
  const r = detectarAnomalias({
    transacoes: [
      ...gastoMensal(["2026-06", "2026-07", "2026-08"], "05", 500, { categoria: "cat-mercado" }),
      gasto("2026-09-05", 900, { categoria: "cat-mercado" }),
    ],
    hoje: "2026-09-20",
    nomesDeCategoria: { "cat-mercado": "Mercado" },
  });
  const mercado = porChave(r.categorias).get("cat-mercado");
  assert.equal(mercado.anomalia, true);
  assert.equal(mercado.rotulo, "Mercado", "a tela nao pode mostrar UUID");
  assert.ok(r.alertas.some((a) => a.chave === "cat-mercado"));
});

// ---------------------------------------------------------------------------
// 6. O EIXO DO ESTABELECIMENTO
// ---------------------------------------------------------------------------

test("o mesmo lojista com descricoes diferentes cai na mesma chave", () => {
  const r = detectarAnomalias({
    transacoes: [
      gasto("2026-06-05", 100, { descricao: "NETFLIX.COM*123" }),
      gasto("2026-07-05", 100, { descricao: "NETFLIX COM" }),
      gasto("2026-08-05", 100, { descricao: "PAG*NETFLIX 4429" }),
      gasto("2026-09-05", 400, { descricao: "NETFLIX.COM*998" }),
    ],
    hoje: "2026-09-20",
  });
  const netflix = porChave(r.estabelecimentos).get("netflix");
  assert.ok(netflix, "as quatro descricoes tem que virar a chave 'netflix'");
  assert.equal(netflix.mesesBase, 3);
  assert.equal(netflix.anomalia, true);
});

test("descricao vazia nao vira um balde 'sem nome'", () => {
  const r = detectarAnomalias({
    transacoes: [gasto("2026-09-05", 100, { descricao: "" })],
    hoje: "2026-09-20",
  });
  assert.equal(r.estabelecimentos.length, 0);
  assert.equal(chaveDoEstabelecimento(""), null);
  assert.equal(chaveDoEstabelecimento(null), null);
});

test("transacao sem categoria nao vira um balde 'sem categoria'", () => {
  const r = detectarAnomalias({
    transacoes: [{ ...gasto("2026-09-05", 100), category_id: null }],
    hoje: "2026-09-20",
  });
  assert.equal(r.categorias.length, 0);
});

// ---------------------------------------------------------------------------
// 7. ORDEM
// ---------------------------------------------------------------------------

test("o maior estouro em reais vem primeiro, nao o maior percentual", () => {
  // 300 a mais no mercado importa mais que 200% a mais numa categoria de 30.
  const atual = new Map([["mercado", 800], ["farmacia", 90]]);
  const historico = new Map([["mercado", [500, 500, 500]], ["farmacia", [30, 30, 30]]]);
  const r = compararComHistorico(atual, historico);
  assert.equal(r[0].chave, "mercado");
  assert.equal(r[0].excesso, 300);
  assert.equal(r[1].chave, "farmacia");
  assert.equal(r[1].razao, 3, "a farmacia triplicou, e ainda assim vem depois");
});

// ---------------------------------------------------------------------------
// 8. RESUMO DO MES FECHADO
// ---------------------------------------------------------------------------

test("o resumo fala do mes ANTERIOR, nunca do corrente", () => {
  const r = resumoDoMesFechado({
    hoje: "2026-10-01",
    fluxo: [{ month: "2026-09-01", income: 8000, expense: 6000 }],
    porCategoria: [],
  });
  assert.equal(r.mes, "2026-09");
  assert.equal(r.entrou, 8000);
  assert.equal(r.saiu, 6000);
  assert.equal(r.saldo, 2000);
});

test("na virada do ano, janeiro fala de dezembro do ano anterior", () => {
  // Aritmetica de string. Com `new Date('2027-01-01')` no fuso de Sao Paulo o
  // mes sai errado e o resumo de janeiro cobriria novembro.
  assert.equal(mesAnterior("2027-01-05"), "2026-12");
  assert.equal(mesAnterior("2026-03-31"), "2026-02");

  const r = resumoDoMesFechado({
    hoje: "2027-01-01",
    fluxo: [{ month: "2026-12-01", income: 100, expense: 40 }],
    porCategoria: [],
  });
  assert.equal(r.mes, "2026-12");
  assert.equal(r.entrou, 100);
});

test("mes fechado sem movimento nao vira notificacao", () => {
  const r = resumoDoMesFechado({ hoje: "2026-10-01", fluxo: [], porCategoria: [] });
  assert.equal(r.temMovimento, false);
  assert.equal(r.entrou, 0);
  assert.equal(r.saiu, 0);
});

test("o resumo lista no maximo as tres categorias que mais cresceram", () => {
  const anteriores = ["2026-06", "2026-07", "2026-08"];
  const porCategoria = [];
  for (const cat of ["a", "b", "c", "d"]) {
    for (const m of anteriores) porCategoria.push({ month: `${m}-01`, category_id: cat, expense: 100 });
  }
  // Setembro: quatro categorias cresceram, em magnitudes diferentes.
  porCategoria.push({ month: "2026-09-01", category_id: "a", expense: 500 });
  porCategoria.push({ month: "2026-09-01", category_id: "b", expense: 400 });
  porCategoria.push({ month: "2026-09-01", category_id: "c", expense: 300 });
  porCategoria.push({ month: "2026-09-01", category_id: "d", expense: 200 });

  const r = resumoDoMesFechado({
    hoje: "2026-10-03",
    fluxo: [{ month: "2026-09-01", income: 9000, expense: 1400 }],
    porCategoria,
    nomesDeCategoria: { a: "Mercado", b: "Carro", c: "Casa", d: "Saude" },
  });

  assert.equal(r.crescimentos.length, TOP_CRESCIMENTOS);
  assert.deepEqual(r.crescimentos.map((c) => c.rotulo), ["Mercado", "Carro", "Casa"]);
});

test("o resumo nao aponta crescimento sem base para sustentar", () => {
  // Segundo mes de uso: sem este filtro sairia "mercado cresceu 400%" comparando
  // com o unico mes anterior que existe.
  const r = resumoDoMesFechado({
    hoje: "2026-10-01",
    fluxo: [{ month: "2026-09-01", income: 100, expense: 500 }],
    porCategoria: [
      { month: "2026-08-01", category_id: "a", expense: 100 },
      { month: "2026-09-01", category_id: "a", expense: 500 },
    ],
  });
  assert.deepEqual(r.crescimentos, []);
});

test("a view entrega 'YYYY-MM-01' e o resumo casa mesmo assim", () => {
  const r = resumoDoMesFechado({
    hoje: "2026-10-15",
    fluxo: [
      { month: "2026-08-01", income: 1, expense: 1 },
      { month: "2026-09-01", income: "7000.00", expense: "5500.50" },
    ],
    porCategoria: [],
  });
  assert.equal(r.entrou, 7000);
  assert.equal(r.saiu, 5500.5);
  assert.equal(Number(r.saldo.toFixed(2)), 1499.5);
});

test("as views tem group_id no grao: o mes soma TODAS as linhas, nao a primeira", () => {
  // Quem participa de um grupo tem, no mesmo mes, uma linha pessoal (group_id
  // nulo) e uma por grupo. Com `find` o resumo pegaria um pedaco do mes -- e
  // qual pedaco dependeria da ordem em que o Postgres devolveu as linhas, que
  // nao e estavel. O numero sairia plausivel, errado, e diferente a cada
  // execucao.
  const r = resumoDoMesFechado({
    hoje: "2026-10-01",
    fluxo: [
      { month: "2026-09-01", income: 5000, expense: 3000 }, // pessoal
      { month: "2026-09-01", income: 1000, expense: 800 },  // do grupo
    ],
    porCategoria: [],
  });
  assert.equal(r.entrou, 6000);
  assert.equal(r.saiu, 3800);
  assert.equal(r.saldo, 2200);
});

test("a mesma categoria em duas linhas do mesmo mes conta como UM mes", () => {
  // Sem o agrupamento por (mes, categoria), cada mes entraria duas vezes na
  // base: `mesesBase` passaria a regua de tres meses tendo historico de dois, e
  // a mediana sairia sobre metades de mes.
  const porCategoria = [];
  for (const m of ["2026-07", "2026-08"]) {
    porCategoria.push({ month: `${m}-01`, category_id: "a", expense: 60 }); // pessoal
    porCategoria.push({ month: `${m}-01`, category_id: "a", expense: 40 }); // do grupo
  }
  porCategoria.push({ month: "2026-09-01", category_id: "a", expense: 500 });

  const r = resumoDoMesFechado({
    hoje: "2026-10-01",
    fluxo: [{ month: "2026-09-01", income: 0, expense: 500 }],
    porCategoria,
  });

  assert.deepEqual(
    r.crescimentos,
    [],
    "julho e agosto sao DOIS meses de base, nao quatro -- nao basta para afirmar crescimento"
  );
});

test("o resumo carrega as assinaturas que subiram e o que ficou vencido", () => {
  const r = resumoDoMesFechado({
    hoje: "2026-10-01",
    fluxo: [{ month: "2026-09-01", income: 8000, expense: 6000 }],
    porCategoria: [],
    assinaturasQueSubiram: [{ displayName: "Netflix", de: 39.9, para: 55.9 }],
    vencidas: [
      { descricao: "IPTU", valor: 320, due_date: "2026-09-10" },
      { descricao: "Internet", valor: -119, due_date: "2026-09-20" },
    ],
  });
  assert.equal(r.assinaturasQueSubiram.length, 1);
  assert.equal(r.totalVencido, 439, "o total do vencido soma em modulo, nao pelo sinal");
});
