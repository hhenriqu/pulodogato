// Teste do filtro de liquidez do mercado do dia -- HMO-193.
//
// O que esta suite existe para impedir: a tela publicar "IGTI4F subiu 16,82%"
// porque QUATRO papeis trocaram de mao, com a mesma cara de certa que tem a
// alta da Magazine Luiza sobre 39 milhoes de acoes.
//
// O enunciado nomeia quatro controles negativos -- TXRX3F, MSPA3F, IGTI4F e
// RCFA11 -- e diz por que: "um teste que so confirma que AZZA3 aparece passa
// mesmo com o filtro desligado". Todo teste de bloqueio aqui nomeia o ticker.
//
// E o enunciado avisa do inverso, que e o modo de falhar mais caro: um filtro
// largo demais esvazia o ranking e passa em TODA assercao de bloqueio. Por isso
// a secao 4 afirma o contrario -- que sobra conteudo legitimo, com nome.
//
// AS FIXTURES SAO MATERIA-PRIMA, NAO RESULTADO DESTE CODIGO
// ---------------------------------------------------------
//   - `brapi-altas-2026-09-30.json` e `brapi-baixas-2026-09-30.json` sao a
//     resposta CRUA de GET /api/quote/list, gravada em 2026-09-30, com a ordem
//     original preservada e sem linha removida;
//   - `brapi-relato-hmo193.json` NAO e captura: sao as cinco linhas que o
//     enunciado publica, transcritas. Existe separada porque RCFA11 nao
//     negociou em 2026-09-30 e nao esta na captura -- e o enunciado exige
//     RCFA11. O arquivo diz isso de si mesmo no campo `_procedencia`.
//
// Varios testes afirmam DUAS coisas: que a regra acerta, e que a fixture ainda
// CONTEM a armadilha. Fixture que perdeu a armadilha faz a suite passar sem
// provar nada.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AVISO_DE_ATRASO,
  AVISO_NAO_E_RECOMENDACAO,
  MEDICOES,
  PISO_DE_LIQUIDEZ_EM_REAIS,
  classificarErro,
  ehFracionario,
  lerCotacao,
  mensagemDaFalha,
  montarRanking,
  motivoDaRecusa,
  normalizarTicker,
  reaisNegociados,
  temLiquidez,
} from "../.tmp-mercado/mercado.js";

const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");
const ler = (nome) => JSON.parse(readFileSync(join(DIR, nome), "utf8"));

const ALTAS = ler("brapi-altas-2026-09-30.json").stocks;
const BAIXAS = ler("brapi-baixas-2026-09-30.json").stocks;
const RELATO = ler("brapi-relato-hmo193.json");

/** Todas as linhas capturadas, sem repetir ticker. */
const CAPTURA = [...new Map([...ALTAS, ...BAIXAS].map((s) => [s.stock, s])).values()];

const achar = (linhas, ticker) => linhas.find((s) => s.stock === ticker);
const tickers = (ranking) => ranking.itens.map((i) => i.ticker);

/** Os quatro nomes que o enunciado exige como controle negativo. */
const CONTROLES_NEGATIVOS = ["TXRX3F", "MSPA3F", "IGTI4F", "RCFA11"];

// ===========================================================================
// 1. OS CONTROLES NEGATIVOS -- o coracao da entrega
// ===========================================================================

test("os quatro controles negativos do enunciado estao nas fixtures, com os numeros do enunciado", () => {
  // Sem isto, as secoes seguintes provariam "nao aparece" sobre linhas que
  // nunca existiram -- a forma mais silenciosa de um teste nao testar nada.
  const esperado = {
    TXRX3F: { change: 33.78, volume: 14 },
    MSPA3F: { change: 30.54, volume: 36 },
    IGTI4F: { change: 16.82, volume: 3 },
    RCFA11: { change: -76.67, volume: 100 },
  };

  const doRelato = [...RELATO.altas, ...RELATO.baixas];

  for (const ticker of CONTROLES_NEGATIVOS) {
    const linha = achar(doRelato, ticker);
    assert.ok(linha, `${ticker} deveria estar na fixture do enunciado`);
    assert.equal(linha.change, esperado[ticker].change, `${ticker}: variacao do enunciado`);
    assert.equal(linha.volume, esperado[ticker].volume, `${ticker}: acoes do enunciado`);
  }

  // TXRX3F, MSPA3F e IGTI4F tambem sobreviveram ate a captura de 2026-09-30 --
  // nao sao um dia estranho, sao o estado normal do topo da lista.
  for (const ticker of ["TXRX3F", "MSPA3F", "IGTI4F"]) {
    assert.ok(achar(CAPTURA, ticker), `${ticker} deveria estar na captura de 2026-09-30`);
  }
});

test("A FIXTURE CONTEM A ARMADILHA: os quatro vem da brapi com type=stock e no topo da lista crua", () => {
  // O enunciado: "o filtro type=stock da propria brapi nao resolve". Se a
  // captura tivesse vindo com type diferente, o filtro poderia estar sendo
  // provado contra um problema que nao existe.
  for (const ticker of ["TXRX3F", "MSPA3F", "IGTI4F"]) {
    assert.equal(achar(CAPTURA, ticker).type, "stock", `${ticker}: a brapi diz que e stock`);
  }

  // E estao no TOPO: sem filtro, sao eles que a tela mostraria.
  const dezPrimeiras = ALTAS.slice(0, 10).map((s) => s.stock);
  for (const ticker of ["TXRX3F", "MSPA3F", "IGTI4F"]) {
    assert.ok(
      dezPrimeiras.includes(ticker),
      `${ticker} deveria estar nas 10 primeiras da lista CRUA -- e a razao do filtro existir`,
    );
  }
});

test("nenhum dos quatro controles negativos entra no ranking de altas", () => {
  const ranking = montarRanking([...ALTAS, ...RELATO.altas, ...RELATO.baixas], "altas", 10);

  for (const ticker of CONTROLES_NEGATIVOS) {
    assert.ok(
      !tickers(ranking).includes(ticker),
      `${ticker} nao pode aparecer nas maiores altas`,
    );
  }
});

test("nenhum dos quatro controles negativos entra no ranking de baixas", () => {
  const ranking = montarRanking([...BAIXAS, ...RELATO.altas, ...RELATO.baixas], "baixas", 10);

  for (const ticker of CONTROLES_NEGATIVOS) {
    assert.ok(
      !tickers(ranking).includes(ticker),
      `${ticker} nao pode aparecer nas maiores baixas`,
    );
  }
});

test("RCFA11 e recusado pelo PISO, nao pelo sufixo -- as duas regras sao necessarias", () => {
  // RCFA11 nao termina em F. Se o filtro fosse so o sufixo, ele passaria
  // caindo 76,67% sobre 100 acoes. E o teste que impede a segunda regra de ser
  // apagada sem que nada fique vermelho.
  const rcfa = achar(RELATO.baixas, "RCFA11");

  assert.equal(ehFracionario(rcfa.stock), false, "RCFA11 nao e fracionario");
  assert.notEqual(motivoDaRecusa(rcfa), null, "RCFA11 tem que ser recusado");
  assert.notEqual(
    motivoDaRecusa(rcfa),
    "fracionario",
    "RCFA11 nao pode ser recusado pelo motivo errado",
  );
});

test("IGTI4F e recusado tambem quando so o piso existe, e tambem quando so o sufixo existe", () => {
  // O inverso do teste anterior: IGTI4F cai pelas duas regras, e afirmar isso
  // separadamente impede que uma delas fique passando de carona na outra.
  const igti = achar(CAPTURA, "IGTI4F");

  assert.equal(ehFracionario(igti.stock), true, "IGTI4F e fracionario");

  const semSufixo = { ...igti, stock: "IGTI4" };
  assert.equal(
    motivoDaRecusa(semSufixo),
    "abaixo_do_piso",
    "sem o F no nome, IGTI4F ainda tem que cair pelo volume",
  );
});

// ===========================================================================
// 2. O SUFIXO F -- e o vazamento do regex "esperto"
// ===========================================================================

test("B1003F e B3SA3F sao fracionarios, e o regex de 4 letras nao os pega", () => {
  // A armadilha 2 do modulo. B1003F nao e hipotese: esta no topo das altas
  // capturadas, +23,19% sobre TRES acoes.
  const regexEsperto = /^[A-Z]{4}\d+[A-Z]*F$/;

  for (const ticker of MEDICOES.vazamentosDoRegexEsperto) {
    assert.equal(regexEsperto.test(ticker), false, `${ticker}: o regex esperto vaza`);
    assert.equal(ehFracionario(ticker), true, `${ticker}: a regra literal pega`);
  }

  const b100 = achar(CAPTURA, "B1003F");
  assert.ok(b100, "B1003F deveria estar na captura");
  assert.ok(b100.volume <= 10, `B1003F negociou ${b100.volume} acoes -- e a linha a remover`);
  assert.ok(
    !tickers(montarRanking(ALTAS, "altas", 10)).includes("B1003F"),
    "B1003F nao pode aparecer no ranking",
  );
});

test("MRSA5BF -- classe com letra no meio -- tambem e fracionario", () => {
  assert.equal(ehFracionario("MRSA5BF"), true);
  assert.equal(ehFracionario("PETR4F"), true);
  assert.equal(ehFracionario("KLBN11F"), true);
});

test("nenhum papel cheio e confundido com fracionario", () => {
  // O contrapeso da regra literal: ela so e segura porque nao ha ticker
  // inteiro terminado em F na B3. Estes sao papeis reais da captura.
  for (const ticker of ["PETR4", "VALE3", "ITUB4", "AZZA3", "KLBN11", "MGLU3", "SANB3"]) {
    assert.equal(ehFracionario(ticker), false, `${ticker} nao e fracionario`);
  }
});

test("A CAPTURA CONTEM A ARMADILHA: o topo das altas e majoritariamente fracionario", () => {
  const fracionariosNoTopo = ALTAS.slice(0, 10).filter((s) => ehFracionario(s.stock)).length;
  assert.ok(
    fracionariosNoTopo >= 6,
    `so ${fracionariosNoTopo} das 10 primeiras sao fracionarias -- a captura perdeu a armadilha`,
  );
});

// ===========================================================================
// 3. O PISO -- por que em reais, e nao em quantidade de acoes
// ===========================================================================

test("o piso em QUANTIDADE DE ACOES apagaria Bradespar e Santander do ranking", () => {
  // A armadilha 3. Este teste nao prova o codigo: prova a DECISAO. Se alguem
  // trocar o piso de reais por um piso de 100.000 acoes -- a traducao aparente
  // do enunciado -- estes dois somem, e o teste diz quais sao.
  const brap = achar(CAPTURA, "BRAP3");
  const sanb = achar(CAPTURA, "SANB3");

  assert.ok(brap && sanb, "BRAP3 e SANB3 deveriam estar na captura");

  for (const [nome, linha] of [["BRAP3", brap], ["SANB3", sanb]]) {
    assert.ok(linha.volume < 100_000, `${nome} negociou ${linha.volume} acoes -- abaixo de 100 mil`);
    assert.ok(
      reaisNegociados(linha) >= PISO_DE_LIQUIDEZ_EM_REAIS,
      `${nome} negociou R$ ${Math.round(reaisNegociados(linha))} -- e liquido de verdade`,
    );
    assert.equal(temLiquidez(linha), true, `${nome} tem que passar`);
  }
});

test("a margem do piso e enorme: o mentiroso mais liquido fica centenas de vezes abaixo", () => {
  // O enunciado: "nao ha zona cinzenta para calibrar o piso". Este teste
  // guarda essa afirmacao contra um piso que alguem encoste no limite.
  const mspa = achar(CAPTURA, "MSPA3F");
  const negociado = reaisNegociados(mspa);

  assert.ok(negociado < 10_000, `MSPA3F negociou R$ ${Math.round(negociado)}`);
  assert.ok(
    PISO_DE_LIQUIDEZ_EM_REAIS / negociado > 100,
    "o piso tem que estar ao menos 100x acima do mentiroso mais liquido medido",
  );
});

test("linha sem preco e recusada -- sem preco nao da para provar liquidez", () => {
  // As linhas do enunciado nao publicam preco. Uma delas, RCFA11, tem 100
  // acoes; a outra, IGTI4F, tem 3. Nenhuma pode virar "liquidez desconhecida,
  // entao deixa passar".
  const semPreco = achar(RELATO.altas, "IGTI4F");
  assert.equal(semPreco.close, null, "a fixture do enunciado nao publica preco");
  assert.equal(reaisNegociados(semPreco), null);
  assert.notEqual(motivoDaRecusa(semPreco), null, "linha sem preco tem que ser recusada");
});

test("linha sem negocio nenhum e recusada", () => {
  const base = { stock: "XXXX3", name: "X", change: 9, close: 10, volume: 0, type: "stock" };
  assert.equal(motivoDaRecusa(base), "sem_acoes");
  assert.equal(motivoDaRecusa({ ...base, volume: null }), "sem_acoes");
  assert.equal(motivoDaRecusa({ ...base, close: 0, volume: 1e9 }), "sem_preco");
  assert.equal(motivoDaRecusa({ ...base, change: null, volume: 1e9 }), "sem_variacao");
});

// ===========================================================================
// 4. O CONTRAPESO -- o filtro largo demais que passa em tudo acima
// ===========================================================================

test("o ranking de altas TEM conteudo, e e feito de nome reconhecivel", () => {
  const ranking = montarRanking(ALTAS, "altas", 10);

  assert.equal(ranking.itens.length, 10, "o ranking de altas tem que vir cheio");

  // Nomes, nao contagem: um teste de "length > 0" passaria com dez linhas de
  // lixo diferente. Estes sao papeis da B3 com volume de milhoes na captura.
  for (const ticker of ["BHIA3", "SIMH3", "MGLU3", "PCAR3"]) {
    assert.ok(
      tickers(ranking).includes(ticker),
      `${ticker} deveria estar nas maiores altas de 2026-09-30`,
    );
  }
});

test("o ranking de baixas TEM conteudo, e e feito de nome reconhecivel", () => {
  const ranking = montarRanking(BAIXAS, "baixas", 10);

  assert.equal(ranking.itens.length, 10, "o ranking de baixas tem que vir cheio");
  assert.ok(
    ranking.itens.every((i) => i.variacao < 0),
    "toda linha de 'maiores baixas' tem que estar caindo",
  );
});

test("AZZA3 -- o papel legitimo que o enunciado cita -- passa pelo filtro", () => {
  const azza = achar(RELATO.altas, "AZZA3");

  assert.equal(azza.volume, 6_522_400, "as acoes negociadas do enunciado");
  assert.equal(temLiquidez(azza), true, "AZZA3 tem que passar");
  assert.ok(tickers(montarRanking([azza], "altas", 10)).includes("AZZA3"));
});

test("o filtro nao esvazia a lista: 143 dos 297 nao fracionarios capturados passam", () => {
  // O numero exato, nao "mais que zero". Um filtro que sobrevivesse a todas as
  // assercoes de bloqueio deixando 3 linhas de pe quebraria aqui.
  const naoFracionarios = CAPTURA.filter((s) => !ehFracionario(s.stock));
  const passam = naoFracionarios.filter((s) => temLiquidez(s));

  assert.equal(naoFracionarios.length, MEDICOES.naoFracionarios);
  assert.equal(passam.length, MEDICOES.naoFracionariosQuePassam);
  assert.ok(
    passam.length / naoFracionarios.length > 0.4,
    "o filtro nao pode reprovar a maioria dos papeis cheios",
  );
});

// ===========================================================================
// 5. A MONTAGEM DO RANKING
// ===========================================================================

test("filtra ANTES de cortar em 10 -- cortar antes devolveria um ranking de lixo", () => {
  // As 10 primeiras da lista crua sao quase todas fracionarias. Se o corte
  // viesse primeiro, sobrariam uma ou duas linhas.
  const ranking = montarRanking(ALTAS, "altas", 10);
  assert.equal(ranking.itens.length, 10);
  assert.ok(ranking.itens.every((i) => !ehFracionario(i.ticker)));
});

test("'maiores altas' nunca mostra papel em queda, nem o contrario", () => {
  // A brapi ordena por variacao mas nao promete sinal: a cauda de sortOrder=asc
  // ainda pode estar subindo num dia de alta generalizada, e "maior baixa" de
  // +2% e um rotulo que mente.
  const subindo = { stock: "AAAA3", name: "A", change: 4, close: 10, volume: 1e6, type: "stock" };
  const caindo = { stock: "BBBB3", name: "B", change: -4, close: 10, volume: 1e6, type: "stock" };
  const parado = { stock: "CCCC3", name: "C", change: 0, close: 10, volume: 1e6, type: "stock" };
  const linhas = [subindo, caindo, parado];

  assert.deepEqual(tickers(montarRanking(linhas, "altas", 10)), ["AAAA3"]);
  assert.deepEqual(tickers(montarRanking(linhas, "baixas", 10)), ["BBBB3"]);
});

test("ordena por variacao dentro da direcao", () => {
  const linha = (stock, change) => ({ stock, name: stock, change, close: 10, volume: 1e6, type: "stock" });
  const linhas = [linha("AAAA3", 2), linha("BBBB3", 9), linha("CCCC3", 5)];

  assert.deepEqual(tickers(montarRanking(linhas, "altas", 10)), ["BBBB3", "CCCC3", "AAAA3"]);
  assert.deepEqual(
    tickers(montarRanking(linhas.map((l) => ({ ...l, change: -l.change })), "baixas", 10)),
    ["BBBB3", "CCCC3", "AAAA3"],
  );
});

test("conta as removidas por motivo -- o ranking diz quanto lixo tirou", () => {
  const ranking = montarRanking(ALTAS, "altas", 10);

  assert.equal(ranking.recebidas, ALTAS.length);
  assert.ok(ranking.removidas.fracionario > 0, "a captura tem fracionario para remover");
  assert.ok(ranking.removidas.abaixo_do_piso > 0, "a captura tem papel cheio ilíquido para remover");
});

// ===========================================================================
// 6. A CONSULTA POR TICKER
// ===========================================================================

test("normaliza o ticker digitado, e recusa o que nem vale uma chamada", () => {
  assert.equal(normalizarTicker(" petr4 "), "PETR4");
  assert.equal(normalizarTicker("mrsa5bf"), "MRSA5BF");
  assert.equal(normalizarTicker("PET"), null, "curto demais para ser ticker");
  assert.equal(normalizarTicker("PETR4; DROP"), null);
  assert.equal(normalizarTicker(""), null);
  assert.equal(normalizarTicker(null), null);
});

test("nao 'corrige' o ticker digerido pela metade", () => {
  // Quem digita ITUB recebe "nao encontrei ITUB", que e verdade, em vez da
  // cotacao de ITUB4 -- um papel que ele nao pediu.
  assert.equal(normalizarTicker("ITUB"), "ITUB");
  assert.notEqual(normalizarTicker("ITUB"), "ITUB4");
});

test("le a cotacao da brapi, e devolve null quando a resposta nao tem preco", () => {
  // Resposta verbatim de GET /api/quote/PETR4 em 2026-09-30.
  const bruta = {
    symbol: "PETR4",
    shortName: "PETR4",
    longName: "Petroleo Brasileiro SA Pfd",
    currency: "BRL",
    regularMarketPrice: 49.61,
    regularMarketChange: 0.51,
    regularMarketChangePercent: 1.04,
    regularMarketDayHigh: 50.03,
    regularMarketDayLow: 49.26,
    regularMarketPreviousClose: 49.61,
    regularMarketVolume: 20_725_100,
    regularMarketTime: "2026-09-30T19:26:30.000Z",
  };

  const c = lerCotacao(bruta);
  assert.equal(c.ticker, "PETR4");
  assert.equal(c.nome, "Petroleo Brasileiro SA Pfd");
  assert.equal(c.preco, 49.61);
  assert.equal(c.variacaoPercentual, 1.04);
  assert.equal(c.acoesNegociadas, 20_725_100);

  // Simbolo que existe no cadastro mas nao negocia volta 200 sem preco. Um
  // objeto com preco NaN colocaria "R$ NaN" na tela.
  assert.equal(lerCotacao({ ...bruta, regularMarketPrice: null }), null);
  assert.equal(lerCotacao({ ...bruta, regularMarketPrice: 0 }), null);
  assert.equal(lerCotacao(null), null);
});

test("a cotacao carrega o aviso de atraso -- a tela nao pode esquecer dele", () => {
  const c = lerCotacao({ symbol: "PETR4", regularMarketPrice: 49.61 });
  assert.equal(c.aviso, AVISO_DE_ATRASO);
  assert.match(c.aviso, /30 minutos/);
  assert.match(c.aviso, /[Nn]ão é preço ao vivo/);
});

test("401 da brapi vira 'falta chave', nao 'ticker nao existe'", () => {
  // Medido em 2026-09-30: sem token, WEGE3/BHIA3/ROMI3/AZZA3 voltam 401
  // MISSING_TOKEN enquanto PETR4/ITUB4/VALE3/MGLU3 voltam 200. Dizer "WEGE3 nao
  // encontrada" seria falso e mandaria a pessoa procurar defeito no que digitou.
  const corpo = { error: true, message: "Token de autenticação não fornecido", code: "MISSING_TOKEN" };

  assert.deepEqual(classificarErro(401, corpo, "WEGE3"), { tipo: "precisa_de_token", ticker: "WEGE3" });
  assert.deepEqual(classificarErro(404, {}, "XXXX9"), { tipo: "nao_encontrado", ticker: "XXXX9" });
  assert.deepEqual(classificarErro(429, {}, "PETR4"), { tipo: "limite_atingido" });
  assert.deepEqual(classificarErro(500, {}, "PETR4"), { tipo: "indisponivel" });

  const frase = mensagemDaFalha(classificarErro(401, corpo, "WEGE3"));
  assert.match(frase, /chave/, "a frase tem que falar de configuracao do app");
  assert.ok(
    !/não encontrei/i.test(frase),
    "a frase do 401 NAO pode dizer que o papel nao existe",
  );
});

test("a falta de chave nao derruba os rankings -- a frase diz isso", () => {
  const frase = mensagemDaFalha({ tipo: "precisa_de_token", ticker: "WEGE3" });
  assert.match(frase, /altas e baixas continuam funcionando/i);
});

// ===========================================================================
// 7. O VOCABULARIO -- "maiores altas" e fato, nao sugestao de compra
// ===========================================================================

test("o aviso do ranking nega recomendacao de forma explicita", () => {
  // O enunciado poe isso fora de escopo de forma direta: "o vocabulario da tela
  // nao pode sugerir acao". Afirmar so que a frase existe deixaria trocar por
  // qualquer coisa; a assercao e sobre o CONTEUDO.
  assert.match(AVISO_NAO_E_RECOMENDACAO, /[Nn]ão é recomendação/);
  assert.match(AVISO_NAO_E_RECOMENDACAO, /compra ou venda/);
  assert.match(AVISO_NAO_E_RECOMENDACAO, /[Ii]nformativa/);
});

test("nenhum texto do modulo usa vocabulario de recomendacao", () => {
  const proibidos = [
    /\boportunidade\b/i,
    /\baproveite\b/i,
    /\bcompre\b/i,
    /\bvenda já\b/i,
    /\bmelhores? (ações|papéis|oportunidades)\b/i,
    /\bdica\b/i,
    /\brecomendamos\b/i,
    /\bsugerimos\b/i,
  ];

  const textos = [
    AVISO_DE_ATRASO,
    AVISO_NAO_E_RECOMENDACAO,
    mensagemDaFalha({ tipo: "ticker_invalido" }),
    mensagemDaFalha({ tipo: "nao_encontrado", ticker: "XXXX9" }),
    mensagemDaFalha({ tipo: "precisa_de_token", ticker: "WEGE3" }),
    mensagemDaFalha({ tipo: "limite_atingido" }),
    mensagemDaFalha({ tipo: "indisponivel" }),
  ];

  for (const texto of textos) {
    for (const proibido of proibidos) {
      assert.ok(!proibido.test(texto), `"${texto}" usa vocabulario de recomendacao: ${proibido}`);
    }
  }
});
