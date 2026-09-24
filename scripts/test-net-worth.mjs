#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DO PATRIMONIO LIQUIDO CONSOLIDADO
// =====================================================
//   npm run test:net-worth
//
// Exercita lib/net-worth.ts. Mesmo desenho do test-calculadoras.mjs: .mjs
// rodando o JS que o tsc (ja dependencia) emitiu, sem runner de teste novo.
//
// -----------------------------------------------------------------------
// O que estes testes existem para pegar
// -----------------------------------------------------------------------
// Consolidacao de patrimonio nao quebra: ela desenha uma composicao errada.
// Nao ha excecao, nao ha 500, nao ha tela vazia -- ha uma barra bonita dizendo
// que 68% da carteira esta em investimento quando o numero certo e 12%.
//
// Os quatro erros de maior consequencia, cada um com teste proprio:
//   - classificar pelo SINAL do saldo (cartao com estorno vira ativo, conta no
//     cheque especial vira divida, e a composicao muda sozinha);
//   - dividir a participacao pelo PATRIMONIO LIQUIDO em vez do total de
//     ativos (quem tem R$ 10.000 aplicados e R$ 9.500 de fatura aparece com
//     "investimentos = 2000% da carteira");
//   - dividir por zero em usuario novo, que tem as quatro contas padrao
//     zeradas (`create_default_accounts`) -- quatro tiles imprimindo NaN%;
//   - tratar o mes ausente como zero na variacao, o que faz o primeiro mes da
//     janela saltar do nada ate o patrimonio inteiro.
//
// Os valores esperados abaixo foram calculados a mao a partir dos saldos do
// fixture, e nao colados da saida da funcao: um teste escrito rodando o codigo
// e gravando o resultado prova so que ele continua fazendo o que faz.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { classificarConta, consolidar, comVariacao, resumoDaJanela } =
  await import("../.tmp-net-worth/net-worth.js");

/** Compara dinheiro com tolerancia de um centavo. */
function perto(recebido, esperado, mensagem) {
  assert.ok(
    Math.abs(recebido - esperado) <= 0.01 + 1e-9,
    `${mensagem}: esperado ${esperado}, recebido ${recebido}`
  );
}

function conta(id, tipo, saldo, extras = {}) {
  return {
    id,
    name: extras.name ?? `conta ${id}`,
    account_type: tipo,
    current_balance: saldo,
    is_active: extras.is_active ?? true,
    color_hex: extras.color_hex ?? null,
  };
}

function classe(consolidado, nome) {
  return consolidado.classes.find((c) => c.classe === nome);
}

// =====================================================
// classificarConta
// =====================================================

test("investment vira investimento", () => {
  assert.equal(classificarConta("investment"), "investimento");
});

test("credit_card vira divida", () => {
  assert.equal(classificarConta("credit_card"), "divida");
});

test("as contas de dinheiro disponivel viram liquido", () => {
  for (const tipo of ["checking", "savings", "cash", "digital", "debit_card", "other"]) {
    assert.equal(classificarConta(tipo), "liquido", `${tipo} deveria ser liquido`);
  }
});

test("tipo desconhecido cai em liquido", () => {
  // Se um dia entrar um tipo de DIVIDA no enum (emprestimo, financiamento),
  // este teste continua verde e o numero fica errado -- por isso a revisao do
  // enum tem que passar por classificarConta. O teste existe para que quem
  // adicionar o tipo leia este comentario.
  assert.equal(classificarConta("loan"), "liquido");
});

// =====================================================
// A armadilha 1: classificar pelo SINAL
// =====================================================

test("cartao com saldo positivo continua sendo divida", () => {
  // Estorno maior que as compras deixa o cartao positivo. Ele nao virou
  // investimento: continua na classe divida, com total positivo.
  const c = consolidar([
    conta("1", "checking", 1000),
    conta("2", "credit_card", 250),
  ]);

  assert.equal(classe(c, "divida").contas.length, 1);
  perto(classe(c, "divida").total, 250, "total da divida");
  // E nao ha divida a pagar: o cartao esta a favor do usuario.
  perto(c.totalDividas, 0, "total de dividas");
  perto(c.patrimonioLiquido, 1250, "patrimonio");
});

test("conta corrente no cheque especial continua sendo liquido", () => {
  const c = consolidar([
    conta("1", "checking", -800),
    conta("2", "investment", 5000),
  ]);

  assert.equal(classe(c, "liquido").contas.length, 1);
  perto(classe(c, "liquido").total, -800, "total liquido");
  assert.equal(classe(c, "divida").contas.length, 0, "nada virou divida");
  perto(c.patrimonioLiquido, 4200, "patrimonio");
});

// =====================================================
// A armadilha 2: participacao sobre o patrimonio liquido
// =====================================================

test("participacao divide pelo total de ativos, nao pelo patrimonio", () => {
  // R$ 10.000 aplicados, R$ 500 na conta, R$ 9.500 de fatura.
  // Patrimonio liquido = 1.000. Ativos = 10.500.
  // Se o divisor fosse o patrimonio, investimento daria 1000% da carteira.
  const c = consolidar([
    conta("1", "checking", 500),
    conta("2", "investment", 10000),
    conta("3", "credit_card", -9500),
  ]);

  perto(c.patrimonioLiquido, 1000, "patrimonio");
  perto(c.totalAtivos, 10500, "total de ativos");
  perto(c.totalDividas, 9500, "total de dividas");

  perto(classe(c, "investimento").participacao, 10000 / 10500, "share investimento");
  perto(classe(c, "liquido").participacao, 500 / 10500, "share liquido");
});

test("a composicao dos ativos soma 1", () => {
  const c = consolidar([
    conta("1", "checking", 2000),
    conta("2", "savings", 3000),
    conta("3", "investment", 5000),
    conta("4", "credit_card", -4000),
  ]);

  const soma = c.classes.reduce((s, cl) => s + cl.participacao, 0);
  perto(soma, 1, "soma das participacoes");
  // A divida NAO disputa espaco na barra: ela e o outro lado da conta.
  assert.equal(classe(c, "divida").participacao, 0);
});

test("patrimonio negativo nao inverte a composicao", () => {
  // Deve mais do que tem. O patrimonio e negativo, mas a carteira de ativos
  // continua sendo 80% investimento -- dividir pelo patrimonio devolveria
  // participacoes negativas, e a barra apareceria ao contrario.
  const c = consolidar([
    conta("1", "checking", 1000),
    conta("2", "investment", 4000),
    conta("3", "credit_card", -12000),
  ]);

  perto(c.patrimonioLiquido, -7000, "patrimonio");
  perto(classe(c, "investimento").participacao, 0.8, "share investimento");
  perto(classe(c, "liquido").participacao, 0.2, "share liquido");
});

test("cheque especial nao encolhe o divisor da composicao", () => {
  // Liquido negativo nao e ativo. Somar o -500 ao divisor daria 4500 e
  // inflaria a participacao do investimento para mais de 100%.
  const c = consolidar([
    conta("1", "checking", -500),
    conta("2", "investment", 5000),
  ]);

  perto(c.totalAtivos, 5000, "total de ativos");
  perto(classe(c, "investimento").participacao, 1, "share investimento");
  assert.equal(classe(c, "liquido").participacao, 0, "liquido negativo nao ocupa a barra");
});

// =====================================================
// A armadilha 3: divisao por zero
// =====================================================

test("usuario novo com as quatro contas padrao zeradas nao produz NaN", () => {
  // create_default_accounts cria exatamente estas quatro, todas em zero.
  const c = consolidar([
    conta("1", "checking", 0),
    conta("2", "credit_card", 0),
    conta("3", "cash", 0),
    conta("4", "digital", 0),
  ]);

  perto(c.patrimonioLiquido, 0, "patrimonio");
  perto(c.totalAtivos, 0, "total de ativos");
  for (const cl of c.classes) {
    assert.ok(Number.isFinite(cl.participacao), `${cl.classe} devolveu ${cl.participacao}`);
    assert.equal(cl.participacao, 0);
  }
});

test("usuario sem conta nenhuma devolve zeros, nao NaN", () => {
  const c = consolidar([]);
  assert.equal(c.patrimonioLiquido, 0);
  assert.equal(c.totalAtivos, 0);
  assert.equal(c.totalDividas, 0);
  assert.equal(c.classes.length, 3);
  for (const cl of c.classes) {
    assert.equal(cl.total, 0);
    assert.equal(cl.participacao, 0);
  }
});

// =====================================================
// Conta arquivada
// =====================================================

test("conta arquivada entra no patrimonio e e reportada a parte", () => {
  // Ela ENTRA porque a linha do tempo (net_worth_history) tambem conta. Tirar
  // aqui faria o numero de cima discordar do grafico logo abaixo dele.
  const c = consolidar([
    conta("1", "checking", 1000),
    conta("2", "savings", 300, { is_active: false }),
  ]);

  perto(c.patrimonioLiquido, 1300, "patrimonio");
  perto(c.totalInativas, 300, "total em conta arquivada");
});

test("is_active ausente conta como ativa", () => {
  const c = consolidar([
    { id: "1", name: "x", account_type: "checking", current_balance: 100 },
  ]);
  perto(c.totalInativas, 0, "nada arquivado");
  assert.equal(classe(c, "liquido").contas[0].ativa, true);
});

// =====================================================
// Leitura do saldo
// =====================================================

test("saldo em texto (o que o PostgREST devolve para numeric) e somado", () => {
  const c = consolidar([
    conta("1", "checking", "1500.25"),
    conta("2", "investment", "2000.75"),
  ]);
  perto(c.patrimonioLiquido, 3501, "patrimonio");
});

test("saldo nulo vale zero e nao contamina a soma", () => {
  const c = consolidar([
    conta("1", "checking", null),
    conta("2", "savings", 100),
  ]);
  assert.ok(Number.isFinite(c.patrimonioLiquido));
  perto(c.patrimonioLiquido, 100, "patrimonio");
});

test("a soma nao acumula lixo de ponto flutuante", () => {
  // 0.1 + 0.2 = 0.30000000000000004. Com dezenas de contas isso chega na tela.
  const c = consolidar([
    conta("1", "checking", 0.1),
    conta("2", "savings", 0.2),
  ]);
  assert.equal(c.patrimonioLiquido, 0.3);
});

// =====================================================
// A armadilha 4: variacao comparando com zero
// =====================================================

const LINHA = [
  { month: "2026-04-01", net_worth: 10000, net_change: 500 },
  { month: "2026-05-01", net_worth: 11000, net_change: 1000 },
  { month: "2026-06-01", net_worth: 10500, net_change: -500 },
];

test("o primeiro mes da janela nao tem variacao", () => {
  const pontos = comVariacao(LINHA);
  assert.equal(pontos[0].variacao, null, "variacao do primeiro mes");
  assert.equal(pontos[0].variacaoRelativa, null, "variacao relativa do primeiro mes");
});

test("a variacao compara com o mes anterior da janela", () => {
  const pontos = comVariacao(LINHA);
  perto(pontos[1].variacao, 1000, "variacao de maio");
  perto(pontos[1].variacaoRelativa, 0.1, "variacao relativa de maio");
  perto(pontos[2].variacao, -500, "variacao de junho");
  perto(pontos[2].variacaoRelativa, -500 / 11000, "variacao relativa de junho");
});

test("variacao relativa partindo de zero devolve null, nao infinito", () => {
  const pontos = comVariacao([
    { month: "2026-01-01", net_worth: 0, net_change: 0 },
    { month: "2026-02-01", net_worth: 500, net_change: 500 },
  ]);
  perto(pontos[1].variacao, 500, "variacao absoluta");
  assert.equal(pontos[1].variacaoRelativa, null, "sem percentual sobre base zero");
});

test("variacao relativa partindo de patrimonio negativo devolve null", () => {
  // De -1000 para -500 a situacao MELHOROU. Dividir daria -50%, que le como
  // piora. Sem base positiva nao ha percentual honesto.
  const pontos = comVariacao([
    { month: "2026-01-01", net_worth: -1000, net_change: 0 },
    { month: "2026-02-01", net_worth: -500, net_change: 500 },
  ]);
  perto(pontos[1].variacao, 500, "variacao absoluta");
  assert.equal(pontos[1].variacaoRelativa, null, "sem percentual sobre base negativa");
});

test("linha do tempo vazia nao quebra", () => {
  assert.deepEqual(comVariacao([]), []);
});

// =====================================================
// resumoDaJanela
// =====================================================

test("o resumo mede do primeiro ao ultimo ponto", () => {
  const r = resumoDaJanela(LINHA);
  perto(r.inicio, 10000, "inicio");
  perto(r.fim, 10500, "fim");
  perto(r.variacao, 500, "variacao da janela");
  perto(r.crescimento, 0.05, "crescimento");
});

test("melhor e pior mes saem de net_change, que e exato", () => {
  const r = resumoDaJanela(LINHA);
  assert.equal(r.melhorMes.month, "2026-05-01");
  assert.equal(r.piorMes.month, "2026-06-01");
});

test("resumo de janela vazia devolve zeros e nenhum mes", () => {
  const r = resumoDaJanela([]);
  assert.equal(r.inicio, 0);
  assert.equal(r.fim, 0);
  assert.equal(r.variacao, 0);
  assert.equal(r.crescimento, null);
  assert.equal(r.melhorMes, null);
  assert.equal(r.piorMes, null);
});

test("crescimento partindo de zero devolve null", () => {
  const r = resumoDaJanela([
    { month: "2026-01-01", net_worth: 0, net_change: 0 },
    { month: "2026-02-01", net_worth: 800, net_change: 800 },
  ]);
  perto(r.variacao, 800, "variacao absoluta");
  assert.equal(r.crescimento, null, "sem percentual sobre base zero");
});

test("crescimento partindo de patrimonio negativo devolve null", () => {
  // Este teste nasceu de uma mutacao que ficou VERDE: trocar `inicio > 0` por
  // `inicio !== 0` nao quebrava nada, porque so comVariacao tinha o caso de
  // base negativa e resumoDaJanela nao. Saindo de -2000 para -500 a divida
  // caiu pela metade, e a divisao devolveria -75% -- um numero que le como a
  // situacao tendo piorado 75%.
  const r = resumoDaJanela([
    { month: "2026-01-01", net_worth: -2000, net_change: 0 },
    { month: "2026-02-01", net_worth: -500, net_change: 1500 },
  ]);
  perto(r.variacao, 1500, "variacao absoluta");
  assert.equal(r.crescimento, null, "sem percentual sobre base negativa");
});

test("um unico mes na janela: variacao zero, crescimento zero", () => {
  const r = resumoDaJanela([LINHA[0]]);
  perto(r.inicio, 10000, "inicio");
  perto(r.fim, 10000, "fim");
  perto(r.variacao, 0, "variacao");
  perto(r.crescimento, 0, "crescimento");
  assert.equal(r.melhorMes.month, "2026-04-01");
});

// =====================================================
// O caso que junta tudo
// =====================================================

test("carteira completa: patrimonio, classes e composicao", () => {
  // Conta corrente 3.200,50 + poupanca 12.000 + dinheiro 150 = 15.350,50
  // Investimento 48.000
  // Cartao -4.780,30 (arquivado: poupanca antiga 900, dentro do liquido)
  const c = consolidar([
    conta("1", "checking", 3200.5),
    conta("2", "savings", 12000),
    conta("3", "cash", 150),
    conta("4", "savings", 900, { is_active: false }),
    conta("5", "investment", 48000),
    conta("6", "credit_card", -4780.3),
  ]);

  perto(classe(c, "liquido").total, 16250.5, "total liquido");
  perto(classe(c, "investimento").total, 48000, "total investimento");
  perto(classe(c, "divida").total, -4780.3, "total divida");

  perto(c.totalAtivos, 64250.5, "total de ativos");
  perto(c.totalDividas, 4780.3, "total de dividas");
  perto(c.patrimonioLiquido, 59470.2, "patrimonio liquido");
  perto(c.totalInativas, 900, "arquivado");

  perto(classe(c, "investimento").participacao, 48000 / 64250.5, "share investimento");
  assert.equal(classe(c, "liquido").contas.length, 4);
  assert.equal(classe(c, "divida").contas.length, 1);
});
