#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DA CARTEIRA DE INVESTIMENTOS
// =====================================================
//   npm run test:investments
//
// Exercita lib/investments.ts. Mesmo desenho do test-net-worth.mjs: .mjs
// rodando o JS que o tsc (ja dependencia) emitiu, sem runner de teste novo.
//
// -----------------------------------------------------------------------
// O que estes testes existem para pegar
// -----------------------------------------------------------------------
// Nenhum erro desta conta levanta excecao. Nao ha 500, nao ha tela vazia: ha um
// preco medio de R$ 31,14 onde o certo e R$ 30,00, e ninguem estranha 31,14.
//
// Os erros de maior consequencia, cada um com teste e mutante proprio:
//
//   - somar a VENDA na ponderacao do preco medio. E o erro central do custo
//     medio e o mais plausivel de escrever: `soma(quantidade*preco)/soma(qtd)`
//     parece obviamente certo. Ele muda o preco medio, e com ele o lucro, a
//     rentabilidade e o "Valor Atual" da tela;
//
//   - esquecer a TAXA no custo. Infla o lucro em exatamente o valor das
//     corretagens, todo mes, e o total investido fica menor que o dinheiro que
//     saiu da conta do usuario;
//
//   - tratar preco ausente como ZERO. O usuario cadastra o primeiro ativo e a
//     tela diz que a carteira vale R$ 0,00 com -100% de prejuizo;
//
//   - dividir a rentabilidade pelo VALOR ATUAL em vez do custo, e a alocacao
//     pelo patrimonio em vez do total da carteira (o defeito da HMO-146);
//
//   - contar posicao ZERADA na carteira de hoje, ou -- o oposto -- perder os
//     proventos de um ativo que o usuario vendeu por inteiro;
//
//   - desenhar o grafico de evolucao com meses vazios na frente, ou aplicar o
//     preco de HOJE a quantidade do passado (ficcao com cara de historico).
//
// Os valores esperados abaixo foram calculados a mao a partir do fixture, e nao
// colados da saida da funcao: um teste escrito rodando o codigo e gravando o
// resultado prova so que ele continua fazendo o que faz.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  calcularPosicoes,
  posicoesAbertas,
  resumirCarteira,
  alocacaoPorTipo,
  evolucaoMensal,
  quantidadeDisponivel,
  ROTULO_TIPO,
} = await import("../.tmp-investments/investments.js");

/** Compara dinheiro com tolerancia de um centavo. */
function perto(recebido, esperado, mensagem) {
  assert.ok(
    Math.abs(recebido - esperado) <= 0.01 + 1e-9,
    `${mensagem}: esperado ${esperado}, recebido ${recebido}`
  );
}

function ativo(id, symbol, tipo, preco = null) {
  return {
    id,
    symbol,
    name: `Ativo ${symbol}`,
    type: tipo,
    currency: "BRL",
    current_price: preco,
    current_price_at: preco === null ? null : "2026-09-28T00:00:00Z",
  };
}

function lanc(assetId, kind, quantity, unit_price, trade_date, fees = 0) {
  return { asset_id: assetId, kind, quantity, unit_price, fees, trade_date };
}

function porId(posicoes, id) {
  return posicoes.find((p) => p.asset_id === id);
}

// =====================================================
// 1. Preco medio ponderado de compras, com taxa
// =====================================================
// A mao: 100 x R$ 30,00 + R$ 5,90 = R$ 3.005,90
//        50 x R$ 36,00 + R$ 5,90 = R$ 1.805,90
//        custo = R$ 4.811,80, quantidade = 150
//        preco medio = 4811,80 / 150 = R$ 32,078666...
test("preco medio pondera as compras e inclui a taxa no custo", () => {
  const posicoes = calcularPosicoes(
    [ativo("a1", "PETR4", "stock", 40)],
    [
      lanc("a1", "buy", 100, 30, "2026-01-10", 5.9),
      lanc("a1", "buy", 50, 36, "2026-02-10", 5.9),
    ]
  );

  const p = porId(posicoes, "a1");
  assert.equal(p.total_quantity, 150);
  perto(p.total_invested, 4811.8, "custo total");
  perto(p.average_price, 32.0787, "preco medio");

  // Sem a taxa no custo o preco medio sairia 32,00 -- exatamente 7,8 centavos
  // por acao a menos, e o "investido" R$ 11,80 abaixo do que saiu da conta.
  assert.notEqual(Math.round(p.average_price * 100), 3200);

  // Valor atual = 150 x 40 = 6.000; resultado = 6.000 - 4.811,80 = 1.188,20
  perto(p.current_value, 6000, "valor atual");
  perto(p.profit_loss, 1188.2, "resultado nao realizado");
  // 1188,20 / 4811,80 = 24,6936...%
  perto(p.profit_loss_percentage, 24.69, "rentabilidade");
});

// =====================================================
// 2. A VENDA nao entra na ponderacao do preco medio
// =====================================================
// Este e o caso do cabecalho de lib/investments.ts, com o numero na casa do
// centavo: comprar 100 a R$ 30,00 e vender 40 a R$ 34,00.
//
// A mao, custo medio (o metodo brasileiro):
//   custo depois da compra = 100 x 30 = 3.000, medio = 30,00
//   venda de 40: baixa 40 x 30 = 1.200 de custo
//   sobra: quantidade 60, custo 1.800, medio AINDA 30,00
//   realizado = 40 x 34 - 40 x 30 = 1.360 - 1.200 = 160,00
//
// Com a venda somada na media (o mutante):
//   (100 x 30 + 40 x 34) / 140 = 4.360 / 140 = 31,142857...
test("venda abate quantidade e NAO muda o preco medio", () => {
  const posicoes = calcularPosicoes(
    [ativo("a1", "PETR4", "stock", 34)],
    [
      lanc("a1", "buy", 100, 30, "2026-01-10"),
      lanc("a1", "sell", 40, 34, "2026-03-10"),
    ]
  );

  const p = porId(posicoes, "a1");
  assert.equal(p.total_quantity, 60);
  perto(p.average_price, 30.0, "preco medio depois da venda");
  perto(p.total_invested, 1800, "custo remanescente");
  perto(p.realized_profit_loss, 160, "resultado realizado");

  // O mutante produz 31,14. Se algum dia esse valor aparecer aqui, a venda
  // voltou para a media.
  assert.notEqual(Math.round(p.average_price * 100), 3114);

  // Resultado NAO realizado a 34,00: 60 x 34 - 1.800 = 2.040 - 1.800 = 240
  perto(p.profit_loss, 240, "resultado nao realizado");

  // E o realizado nao pode estar somado no profit_loss: vender no lucro nao
  // cria dinheiro novo na posicao que sobrou.
  assert.notEqual(Math.round(p.profit_loss * 100), Math.round((240 + 160) * 100));
});

// =====================================================
// 3. Provento nao mexe em quantidade nem em custo
// =====================================================
// A mao: 100 cotas, provento de R$ 0,85 por cota = R$ 85,00
test("provento soma em dividendos e nao toca na posicao", () => {
  const posicoes = calcularPosicoes(
    [ativo("a1", "MXRF11", "fii", 10)],
    [
      lanc("a1", "buy", 100, 10, "2026-01-10"),
      lanc("a1", "dividend", 100, 0.85, "2026-02-15"),
    ]
  );

  const p = porId(posicoes, "a1");
  assert.equal(p.total_quantity, 100);
  perto(p.total_invested, 1000, "custo nao muda com provento");
  perto(p.average_price, 10, "preco medio nao muda com provento");
  perto(p.dividends, 85, "proventos");
  perto(p.profit_loss, 0, "provento nao e lucro de posicao");
});

// =====================================================
// 4. Ativo sem preco informado e avaliado PELO CUSTO
// =====================================================
test("preco ausente avalia pelo custo e nao zera a carteira", () => {
  const posicoes = calcularPosicoes(
    [ativo("a1", "VALE3", "stock", null)],
    [lanc("a1", "buy", 10, 60, "2026-01-10", 4.5)]
  );

  const p = porId(posicoes, "a1");
  assert.equal(p.has_price, false);
  assert.equal(p.current_price, undefined);
  // custo = 10 x 60 + 4,50 = 604,50; valor atual = o mesmo custo
  perto(p.total_invested, 604.5, "custo");
  perto(p.current_value, 604.5, "valor atual avaliado pelo custo");
  perto(p.profit_loss, 0, "resultado zero, nao -100%");
  perto(p.profit_loss_percentage, 0, "rentabilidade zero");

  const resumo = resumirCarteira(posicoes);
  assert.equal(resumo.ativosSemPreco, 1);
  // O mutante (`?? 0`) daria valor atual 0 e -100%.
  assert.notEqual(Math.round(resumo.currentValue * 100), 0);
  assert.notEqual(Math.round(resumo.totalProfitLossPercentage), -100);
});

// =====================================================
// 5. Posicao zerada sai da carteira, mas o dinheiro dela fica
// =====================================================
test("venda total fecha a posicao e preserva provento e realizado", () => {
  const posicoes = calcularPosicoes(
    [ativo("a1", "PETR4", "stock", 34), ativo("a2", "MXRF11", "fii", 10)],
    [
      lanc("a1", "buy", 100, 30, "2026-01-10"),
      lanc("a1", "dividend", 100, 1.2, "2026-02-10"),
      lanc("a1", "sell", 100, 34, "2026-03-10"),
      lanc("a2", "buy", 50, 10, "2026-01-10"),
    ]
  );

  const fechada = porId(posicoes, "a1");
  assert.equal(fechada.total_quantity, 0);
  perto(fechada.total_invested, 0, "custo zerado");
  perto(fechada.average_price, 0, "sem preco medio sem posicao");
  perto(fechada.realized_profit_loss, 400, "realizado = 100 x (34 - 30)");
  perto(fechada.dividends, 120, "proventos da posicao encerrada");

  // A TAXA DA VENDA sai do realizado. Sem este caso (e ele faltava: as vendas
  // dos outros testes tinham taxa zero) o mutante "taxa da venda deixa de
  // abater" sobrevive -- e o usuario ve um lucro realizado maior do que o
  // dinheiro que entrou na conta dele.
  // A mao: compra 100 x 30 + 9,90 = 3.009,90, medio 30,099;
  //        venda 100 x 34 - 9,90 - 3.009,90 = 3.400 - 9,90 - 3.009,90 = 380,20
  const comTaxa = calcularPosicoes(
    [ativo("a3", "PETR4", "stock", 34)],
    [
      lanc("a3", "buy", 100, 30, "2026-01-10", 9.9),
      lanc("a3", "sell", 100, 34, "2026-03-10", 9.9),
    ]
  );
  perto(
    porId(comTaxa, "a3").realized_profit_loss,
    380.2,
    "realizado liquido das duas taxas"
  );

  const abertas = posicoesAbertas(posicoes);
  assert.equal(abertas.length, 1);
  assert.equal(abertas[0].asset_id, "a2");

  const resumo = resumirCarteira(posicoes);
  // Investido e valor atual olham SO o que esta aberto: 50 x 10 = 500.
  perto(resumo.totalInvested, 500, "investido so das abertas");
  perto(resumo.currentValue, 500, "valor atual so das abertas");
  // Proventos e realizado somam TUDO, inclusive a posicao encerrada.
  perto(resumo.totalDividends, 120, "proventos incluem a encerrada");
  perto(resumo.realizedProfitLoss, 400, "realizado inclui a encerrada");
});

// =====================================================
// 6. Carteira vazia nao imprime NaN
// =====================================================
test("carteira vazia devolve zeros, nunca NaN", () => {
  const resumo = resumirCarteira([]);
  for (const [chave, valor] of Object.entries(resumo)) {
    assert.ok(
      typeof valor !== "number" || Number.isFinite(valor),
      `${chave} saiu NaN/Infinity`
    );
  }
  assert.equal(resumo.totalProfitLossPercentage, 0);
  assert.deepEqual(alocacaoPorTipo([]), []);
  assert.deepEqual(evolucaoMensal([]), []);

  // Ativo cadastrado e ainda sem nenhum lancamento: o caso do usuario que
  // acabou de criar o ativo. Nao pode virar NaN nem divisao por zero.
  const posicoes = calcularPosicoes([ativo("a1", "PETR4", "stock", 30)], []);
  assert.equal(posicoes[0].total_quantity, 0);
  assert.equal(posicoes[0].profit_loss_percentage, 0);
  assert.equal(posicoesAbertas(posicoes).length, 0);
});

// =====================================================
// 7. Alocacao: rotulos que o grafico colore, e soma 100%
// =====================================================
test("alocacao usa os rotulos do grafico, divide pelo total da carteira e soma 100%", () => {
  const posicoes = calcularPosicoes(
    [
      ativo("a1", "PETR4", "stock", 30),
      ativo("a2", "MXRF11", "fii", 10),
      ativo("a3", "TESOURO", "fixed_income", 1),
      // Vendido por inteiro: nao pode aparecer na alocacao nem no divisor.
      ativo("a4", "VALE3", "stock", 60),
    ],
    [
      lanc("a1", "buy", 100, 25, "2026-01-10"), // atual 3.000
      lanc("a2", "buy", 200, 9, "2026-01-10"), //  atual 2.000
      lanc("a3", "buy", 1000, 1, "2026-01-10"), // atual 1.000
      lanc("a4", "buy", 10, 50, "2026-01-10"),
      lanc("a4", "sell", 10, 60, "2026-02-10"),
    ]
  );

  const fatias = alocacaoPorTipo(posicoes);
  assert.equal(fatias.length, 3);

  const nomes = fatias.map((f) => f.name);
  assert.deepEqual(nomes, [ROTULO_TIPO.stock, ROTULO_TIPO.fii, ROTULO_TIPO.fixed_income]);
  // Acentuacao incluida: o dicionario de cores do grafico tem "Ações" como
  // chave, e "Acoes" sairia cinza.
  assert.equal(nomes[0], "Ações");

  const total = 3000 + 2000 + 1000;
  perto(fatias[0].value, 3000, "valor de acoes");
  perto(fatias[0].percentage, (3000 / total) * 100, "50%");
  perto(fatias[1].percentage, (2000 / total) * 100, "33,33%");

  const soma = fatias.reduce((s, f) => s + f.percentage, 0);
  perto(soma, 100, "as fatias somam 100%");

  // Nenhuma fatia de 0%: tipo sem posicao fica fora da legenda.
  assert.ok(fatias.every((f) => f.value > 0));
});

// =====================================================
// 8. Evolucao mensal: custo no fim de cada mes, sem meses vazios na frente
// =====================================================
// A mao, com janela de 12 meses terminando em 2026-09:
//   jan: 100 x 20 = 2.000
//   fev: sem lancamento -> continua 2.000
//   mar: +50 x 30 = 1.500 -> 3.500
//   abr: venda de 50 pelo medio de 3.500/150 = 23,3333 -> baixa 1.166,67 -> 2.333,33
test("evolucao mensal comeca no primeiro lancamento e mostra o custo de cada mes", () => {
  const lancamentos = [
    lanc("a1", "buy", 100, 20, "2026-01-15"),
    lanc("a1", "buy", 50, 30, "2026-03-20"),
    lanc("a1", "sell", 50, 40, "2026-04-05"),
  ];

  const pontos = evolucaoMensal(lancamentos, 12, new Date("2026-09-15T00:00:00Z"));

  // Janela cortada em janeiro: 9 pontos (jan..set), nao 12 com tres zeros.
  assert.equal(pontos.length, 9);
  assert.equal(pontos[0].date, "2026-01-31");
  assert.equal(pontos[pontos.length - 1].date, "2026-09-30");

  perto(pontos[0].portfolio, 2000, "jan");
  perto(pontos[1].portfolio, 2000, "fev sem lancamento repete jan");
  perto(pontos[2].portfolio, 3500, "mar depois do segundo aporte");
  perto(pontos[3].portfolio, 2333.33, "abr depois da venda pelo custo medio");
  perto(pontos[8].portfolio, 2333.33, "set continua igual");

  // O ponto e o ULTIMO dia do mes: um off-by-one no fim do mes tiraria o aporte
  // do dia 31 do mes dele.
  //
  // A assercao tem que olhar a DATA do primeiro ponto, nao so o valor: se
  // janeiro for descartado, fevereiro aparece com os mesmos R$ 100,00 na
  // primeira posicao e um teste que so compara valor passa verde com o mes
  // inteiro perdido.
  const noDia31 = evolucaoMensal(
    [lanc("a1", "buy", 1, 100, "2026-01-31")],
    2,
    new Date("2026-02-10T00:00:00Z")
  );
  assert.equal(noDia31.length, 2, "janeiro e fevereiro");
  assert.equal(noDia31[0].date, "2026-01-31", "o mes do aporte nao pode cair");
  perto(noDia31[0].portfolio, 100, "aporte do dia 31 entra em janeiro");
});

// =====================================================
// 9. Ordem de entrada nao muda o resultado
// =====================================================
test("lancamentos fora de ordem dao o mesmo resultado", () => {
  const ativos = [ativo("a1", "PETR4", "stock", 34)];
  const emOrdem = [
    lanc("a1", "buy", 100, 30, "2026-01-10"),
    lanc("a1", "buy", 100, 40, "2026-02-10"),
    lanc("a1", "sell", 50, 50, "2026-03-10"),
  ];
  const foraDeOrdem = [emOrdem[2], emOrdem[0], emOrdem[1]];

  const a = porId(calcularPosicoes(ativos, emOrdem), "a1");
  const b = porId(calcularPosicoes(ativos, foraDeOrdem), "a1");

  perto(a.average_price, b.average_price, "preco medio");
  perto(a.realized_profit_loss, b.realized_profit_loss, "realizado");
  perto(a.total_invested, b.total_invested, "custo");

  // E o valor certo, calculado a mao: custo 7.000 / 200 = R$ 35,00 de medio;
  // venda de 50 a 50 realiza 2.500 - 50 x 35 = 750; sobra 150 a 35 = 5.250.
  perto(a.average_price, 35, "preco medio correto");
  perto(a.realized_profit_loss, 750, "realizado correto");
  perto(a.total_invested, 5250, "custo remanescente correto");
});

// =====================================================
// 10. Venda acima da posicao nao vira quantidade negativa
// =====================================================
test("venda maior que a posicao zera e sinaliza, em vez de ficar negativa", () => {
  const posicoes = calcularPosicoes(
    [ativo("a1", "PETR4", "stock", 30)],
    [
      lanc("a1", "buy", 10, 20, "2026-01-10"),
      lanc("a1", "sell", 30, 25, "2026-02-10"),
    ]
  );

  const p = porId(posicoes, "a1");
  assert.equal(p.total_quantity, 0);
  assert.equal(p.exceeded_position, true);
  assert.ok(p.total_quantity >= 0, "quantidade nao pode ficar negativa");
  assert.ok(Number.isFinite(p.average_price));

  // E a funcao que a rota usa para RECUSAR essa venda antes de gravar. Ela tem
  // que descontar as vendas (senao a rota autoriza vender o que ja foi vendido)
  // e olhar SO o ativo pedido (senao a quantidade de um ativo autoriza a venda
  // de outro).
  const carteira = [
    lanc("a1", "buy", 10, 20, "2026-01-10"),
    lanc("a1", "sell", 4, 25, "2026-02-10"),
    lanc("a1", "dividend", 6, 1, "2026-02-20"),
    lanc("a2", "buy", 999, 5, "2026-01-10"),
  ];
  assert.equal(quantidadeDisponivel(carteira, "a1"), 6, "10 comprados - 4 vendidos");
  assert.equal(quantidadeDisponivel(carteira, "a2"), 999, "o outro ativo, inteiro");
  assert.equal(quantidadeDisponivel(carteira, "a3"), 0, "ativo sem lancamento");
  assert.equal(quantidadeDisponivel([], "a1"), 0);
});

// =====================================================
// 11. numeric do Postgres chega como string
// =====================================================
test("valores em string (numeric do PostgREST) somam como numero", () => {
  const posicoes = calcularPosicoes(
    [{ ...ativo("a1", "PETR4", "stock"), current_price: "32.50" }],
    [
      {
        asset_id: "a1",
        kind: "buy",
        quantity: "100.00000000",
        unit_price: "30.00000000",
        fees: "5.90",
        trade_date: "2026-01-10",
      },
    ]
  );

  const p = porId(posicoes, "a1");
  // Concatenacao de string daria "10030" em algum lugar; o teste morre na
  // primeira soma errada.
  perto(p.total_invested, 3005.9, "custo com valores em string");
  perto(p.current_value, 3250, "valor atual com preco em string");
  assert.equal(p.has_price, true);
});
