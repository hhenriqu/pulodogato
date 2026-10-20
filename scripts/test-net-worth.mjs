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
//   - dividir por zero em usuario novo, que tem as contas padrao zeradas
//     (`create_default_accounts`) -- todos os tiles imprimindo NaN%;
//   - tratar o mes ausente como zero na variacao, o que faz o primeiro mes da
//     janela saltar do nada ate o patrimonio inteiro.
//
// Os valores esperados abaixo foram calculados a mao a partir dos saldos do
// fixture, e nao colados da saida da funcao: um teste escrito rodando o codigo
// e gravando o resultado prova so que ele continua fazendo o que faz.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  classificarConta,
  consolidar,
  comVariacao,
  resumoDaJanela,
  avisoDoPatrimonio,
  AVISO_DO_SALDO,
} = await import("../.tmp-net-worth/net-worth.js");

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

test("usuario novo, com as contas padrao zeradas, nao produz NaN", () => {
  // As QUATRO do fixture, e nao as duas que `create_default_accounts` cria
  // desde a 056, de proposito: este caso tem que valer tambem para quem se
  // cadastrou ANTES dela e ficou com Cartao de Credito e PIX, e para quem
  // cadastrou os dois na mao depois. Quatro e o caso mais largo -- ele cobre
  // uma classe de ativo a mais (`digital`) e uma de divida (`credit_card`) --,
  // e o que o teste mede e o divisor zerado, que nao depende da contagem.
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

// =====================================================
// A ARMADILHA 5: A DUPLA CONTAGEM DA CONTA INVESTIMENTO (HMO-437)
// =====================================================
// Estes testes sao ENTREGA da fase, e nao item de revisao. O defeito que eles
// travam nao levanta excecao, nao quebra proporcao nenhuma e nao deixa linha
// estranha para auditar: ele imprime um patrimonio MAIOR, plausivel, e
// exatamente igual ao certo mais o valor da aplicacao atrelada.
//
// Os valores esperados foram calculados a mao, como o resto desta suite.

/** Uma linha de `valorDaCarteiraPorConta`, do jeito que `consolidar` a recebe. */
function carteira(accountId, valor, extras = {}) {
  const rendimento = extras.rendimento ?? 0;
  return {
    account_id: accountId,
    valor,
    // Sem IR declarado o liquido e o proprio valor (o caso da LCI isenta).
    valorLiquido: extras.valorLiquido ?? valor,
    principal: extras.principal ?? valor - rendimento,
    rendimento,
  };
}

test("a conta com ativo atrelado E saldo digitado aparece UMA vez", () => {
  // Conta Investimento com R$ 10.000 digitados na mao (o unico jeito que
  // funcionava antes desta fase) e um CDB de R$ 10.000 atrelado que ja rendeu
  // R$ 412,35. O patrimonio certo e 2.000 + 10.412,35 = 12.412,35.
  //
  // Se as duas parcelas fossem somadas daria 22.412,35 -- e nada na resposta
  // pareceria errado.
  const c = consolidar(
    [conta("corrente", "checking", 2000), conta("inv", "investment", 10000)],
    [carteira("inv", 10412.35, { rendimento: 412.35, valorLiquido: 10349.49 })]
  );

  perto(c.patrimonioLiquido, 12412.35, "patrimonio");
  perto(classe(c, "investimento").total, 10412.35, "total investimento");
  assert.equal(
    classe(c, "investimento").contas.length,
    1,
    "a conta nao pode aparecer duas vezes"
  );

  // E o saldo digitado nao foi apagado -- ele saiu do total e continua legivel.
  const linha = classe(c, "investimento").contas[0];
  assert.equal(linha.origemDoSaldo, "carteira");
  perto(linha.saldo, 10412.35, "saldo da linha");
  perto(linha.saldoInformado, 10000, "saldo informado preservado");
  perto(linha.carteira.rendimento, 412.35, "rendimento da carteira");
  perto(c.saldoInformadoIgnorado, 10000, "saldo que parou de contar");
  perto(c.totalEmCarteira, 10412.35, "parte que veio da carteira");
});

test("o rendimento SOBE o patrimonio, e e a unica diferenca", () => {
  // O mesmo CDB sem rendimento nenhum (boletim do Banco Central indisponivel:
  // o valor cai para o custo) e com rendimento. A diferenca entre os dois
  // patrimonios tem de ser EXATAMENTE o rendimento -- este e o teste de que
  // "ver o patrimonio crescer" passou a funcionar sem ninguem editar saldo.
  const contas = [conta("inv", "investment", 999999)];

  const semRendimento = consolidar(contas, [carteira("inv", 10000)]);
  const comRendimento = consolidar(contas, [
    carteira("inv", 10412.35, { rendimento: 412.35 }),
  ]);

  perto(semRendimento.patrimonioLiquido, 10000, "patrimonio sem rendimento");
  perto(comRendimento.patrimonioLiquido, 10412.35, "patrimonio com rendimento");
  perto(
    comRendimento.patrimonioLiquido - semRendimento.patrimonioLiquido,
    412.35,
    "a diferenca e o rendimento"
  );
  // E o saldo digitado absurdo (999.999) nao influencia nenhum dos dois.
});

test("conta SEM ativo atrelado da o total identico ao de antes da fase", () => {
  // O caso irmao, e o que protege quem nunca vai atrelar nada: a mesma lista de
  // contas consolidada com carteira VAZIA, com carteira de OUTRA conta e sem o
  // argumento nenhum tem de devolver o mesmo patrimonio, as mesmas classes e as
  // mesmas participacoes.
  const contas = [
    conta("1", "checking", 3200.5),
    conta("2", "savings", 12000),
    conta("3", "investment", 48000),
    conta("4", "credit_card", -4780.3),
  ];

  const antes = consolidar(contas);
  const comListaVazia = consolidar(contas, []);
  const comNulo = consolidar(contas, null);
  // Carteira de uma conta que NAO esta na lista (desligada dos totais pelo
  // `include_in_total`, ou de outro usuario): nao pode entrar por fora.
  const comContaDeFora = consolidar(contas, [carteira("fantasma", 777777)]);

  for (const [nome, c] of [
    ["lista vazia", comListaVazia],
    ["nulo", comNulo],
    ["conta de fora", comContaDeFora],
  ]) {
    perto(c.patrimonioLiquido, antes.patrimonioLiquido, `patrimonio (${nome})`);
    perto(c.totalAtivos, antes.totalAtivos, `ativos (${nome})`);
    perto(c.totalDividas, antes.totalDividas, `dividas (${nome})`);
    perto(c.totalEmCarteira, 0, `nada veio da carteira (${nome})`);
    perto(c.saldoInformadoIgnorado, 0, `nada parou de contar (${nome})`);
    perto(c.irEstimado, 0, `sem IR estimado (${nome})`);
    perto(
      c.patrimonioDescontandoIr,
      antes.patrimonioLiquido,
      `liquido = bruto (${nome})`
    );
    for (const nomeDaClasse of ["liquido", "investimento", "divida"]) {
      perto(
        classe(c, nomeDaClasse).total,
        classe(antes, nomeDaClasse).total,
        `total ${nomeDaClasse} (${nome})`
      );
      perto(
        classe(c, nomeDaClasse).participacao,
        classe(antes, nomeDaClasse).participacao,
        `participacao ${nomeDaClasse} (${nome})`
      );
    }
  }

  // E a conta de investimento sem ativo atrelado continua pelo saldo digitado.
  const linha = classe(antes, "investimento").contas[0];
  assert.equal(linha.origemDoSaldo, "saldo_informado");
  perto(linha.saldo, 48000, "saldo pelo informado");
  perto(linha.saldoInformado, 48000, "saldo informado");
  assert.equal(linha.carteira, null, "sem parcelas de carteira");
});

test("o ativo SOLTO (account_id nulo) nao entra em conta nenhuma", () => {
  // A linha de `account_id: null` e a carteira que ninguem atrelou -- o estado
  // de todo ativo cadastrado antes da 059. Ela nao pode ser distribuida, nem
  // somada a conta de investimento que existe por perto.
  const c = consolidar(
    [conta("corrente", "checking", 500), conta("inv", "investment", 8000)],
    [carteira(null, 30000, { rendimento: 1000 })]
  );

  perto(c.patrimonioLiquido, 8500, "patrimonio sem o solto");
  perto(c.totalEmCarteira, 0, "nada veio da carteira");
  perto(c.saldoInformadoIgnorado, 0, "nenhum saldo parou de contar");
  const linha = classe(c, "investimento").contas[0];
  assert.equal(linha.origemDoSaldo, "saldo_informado");
  perto(linha.saldo, 8000, "a conta continua pelo saldo digitado");
});

test("a carteira NAO substitui saldo de conta que nao e de investimento", () => {
  // A trava da 059 exige `account_type = 'investment'` no elo. Esta funcao nao
  // confia nela: ela recebe linhas, nao garantias. Se um elo errado chegasse
  // aqui, substituir faria a conta corrente perder o saldo dela em silencio.
  const c = consolidar(
    [conta("corrente", "checking", 2500)],
    [carteira("corrente", 99)]
  );

  perto(c.patrimonioLiquido, 2500, "o saldo da conta corrente foi preservado");
  perto(c.totalEmCarteira, 0, "nada veio da carteira");
  assert.equal(classe(c, "liquido").contas[0].origemDoSaldo, "saldo_informado");
});

test("o patrimonio grande e o BRUTO; o liquido de IR vai ao lado", () => {
  // Decisao 2 do plano: o numero grande e o bruto. Um CDB de R$ 10.000 que
  // rendeu R$ 1.000 com 20% de IR vale 11.000 bruto e 10.800 liquido.
  const c = consolidar(
    [conta("inv", "investment", 0)],
    [
      carteira("inv", 11000, {
        rendimento: 1000,
        valorLiquido: 10800,
        principal: 10000,
      }),
    ]
  );

  perto(c.patrimonioLiquido, 11000, "o numero grande e o bruto");
  perto(c.irEstimado, 200, "IR estimado");
  perto(c.patrimonioDescontandoIr, 10800, "o numero de baixo");
});

test("duas contas de investimento atreladas somam cada uma a sua carteira", () => {
  const c = consolidar(
    [
      conta("a", "investment", 1),
      conta("b", "investment", 2),
      conta("c", "investment", 5000, { name: "sem ativo atrelado" }),
    ],
    [
      carteira("a", 1000, { rendimento: 100, valorLiquido: 985 }),
      carteira("b", 2000, { rendimento: 200, valorLiquido: 1970 }),
    ]
  );

  // 1.000 + 2.000 + 5.000 (esta ultima pelo saldo digitado, que nao foi tocado)
  perto(c.patrimonioLiquido, 8000, "patrimonio");
  perto(c.totalEmCarteira, 3000, "o que veio da carteira");
  perto(c.saldoInformadoIgnorado, 3, "os saldos digitados que sairam");
  perto(c.irEstimado, 45, "IR estimado das duas");
  perto(c.patrimonioDescontandoIr, 7955, "patrimonio descontando o IR");
  assert.equal(classe(c, "investimento").contas.length, 3);
});

test("conta de investimento ARQUIVADA com carteira conta pela carteira", () => {
  // `totalInativas` existe para a tela dizer quanto do patrimonio esta em conta
  // arquivada. Se ele continuasse somando o saldo DIGITADO enquanto o
  // patrimonio soma a carteira, as duas metades da tela discordariam.
  const c = consolidar(
    [conta("inv", "investment", 100, { is_active: false })],
    [carteira("inv", 10412.35, { rendimento: 412.35 })]
  );

  perto(c.patrimonioLiquido, 10412.35, "patrimonio");
  perto(c.totalInativas, 10412.35, "arquivado pela carteira");
});

// =====================================================
// O AVISO: DE ONDE VEIO CADA PARTE (HMO-437)
// =====================================================
// A frase e condicional, e e por isso que ela tem teste: um aviso que fala de
// carteira para quem nao tem ativo atrelado e tao ruim quanto um total errado --
// ele ensina a pessoa a nao ler os avisos.

const SEM_CARTEIRA = { carteiraLida: true };

test("sem carteira, o aviso e exatamente o de antes desta fase", () => {
  const c = consolidar([conta("1", "checking", 1000)]);
  assert.equal(avisoDoPatrimonio(c, SEM_CARTEIRA), AVISO_DO_SALDO);
});

test("com carteira, o aviso diz que o saldo informado NAO e somado", () => {
  const c = consolidar(
    [conta("inv", "investment", 10000)],
    [carteira("inv", 10412.35, { rendimento: 412.35, valorLiquido: 10349.49 })]
  );
  const aviso = avisoDoPatrimonio(c, SEM_CARTEIRA);

  assert.ok(aviso.indexOf(AVISO_DO_SALDO) === 0, "comeca pelo aviso do saldo");
  assert.ok(
    aviso.includes("não é somado"),
    `o aviso tem de dizer que o saldo informado nao conta: ${aviso}`
  );
  assert.ok(
    aviso.includes("conta duas vezes"),
    "e tem de nomear a dupla contagem, que e o motivo da regra"
  );
  assert.ok(
    aviso.includes("linha do tempo"),
    "e avisar que a curva pode ficar menor que o numero de hoje"
  );
  assert.ok(aviso.includes("BRUTO"), "e dizer qual dos dois numeros e o grande");
});

test("o aviso do IR so aparece quando ha IR estimado", () => {
  // LCI isenta: `valorLiquido` igual ao `valor`, `irEstimado` zero. Dizer "o
  // numero e o bruto, o liquido desconta o IR" aqui seria falso.
  const isenta = consolidar(
    [conta("inv", "investment", 0)],
    [carteira("inv", 10107.2, { rendimento: 107.2 })]
  );
  perto(isenta.irEstimado, 0, "sem IR");
  assert.ok(!avisoDoPatrimonio(isenta, SEM_CARTEIRA).includes("alíquota"));

  const tributada = consolidar(
    [conta("inv", "investment", 0)],
    [carteira("inv", 11000, { rendimento: 1000, valorLiquido: 10800 })]
  );
  assert.ok(avisoDoPatrimonio(tributada, SEM_CARTEIRA).includes("alíquota"));
});

test("o Banco Central ausente e nomeado, com o indice", () => {
  const c = consolidar([conta("1", "checking", 10)]);
  const aviso = avisoDoPatrimonio(c, {
    carteiraLida: true,
    indexadoresSemBoletim: ["cdi"],
  });
  assert.ok(aviso.includes("Banco Central"), aviso);
  assert.ok(aviso.includes("cdi"), "o indice tem de aparecer");
  assert.ok(
    aviso.includes("valor aplicado"),
    "e a frase tem de dizer por qual valor o papel entrou"
  );
});

test("a carteira SOLTA e avisada com o que fazer a respeito", () => {
  const c = consolidar([conta("1", "checking", 10)]);
  const aviso = avisoDoPatrimonio(c, {
    carteiraLida: true,
    carteiraSolta: 30000,
  });
  assert.ok(aviso.includes("sem conta atrelada"), aviso);
  assert.ok(aviso.includes("NÃO entra"), "e dizer que ele nao esta no total");
  assert.ok(aviso.includes("atrele"), "com a acao que resolve");
});

test("carteira solta ZERO nao gera frase", () => {
  const c = consolidar([conta("1", "checking", 10)]);
  const aviso = avisoDoPatrimonio(c, { carteiraLida: true, carteiraSolta: 0 });
  assert.equal(aviso, AVISO_DO_SALDO);
});

test("a carteira que NAO pode ser lida e dita em voz alta", () => {
  const c = consolidar([conta("1", "checking", 10)]);
  const aviso = avisoDoPatrimonio(c, { carteiraLida: false });
  assert.ok(
    aviso.includes("não entrou nesta leitura"),
    `o silencio pareceria "voce nao tem investimento": ${aviso}`
  );
});

test("o aviso nunca repete a mesma oracao duas vezes", () => {
  // As frases sao concatenadas; um `push` duplicado passaria despercebido na
  // revisao e sairia na tela como paragrafo repetido.
  const c = consolidar(
    [conta("inv", "investment", 10000)],
    [carteira("inv", 11000, { rendimento: 1000, valorLiquido: 10800 })]
  );
  const aviso = avisoDoPatrimonio(c, {
    carteiraLida: true,
    indexadoresSemBoletim: ["cdi"],
    carteiraSolta: 500,
  });
  const oracoes = aviso.split(". ").map((s) => s.trim());
  assert.equal(
    new Set(oracoes).size,
    oracoes.length,
    `oracao repetida em: ${aviso}`
  );
});
