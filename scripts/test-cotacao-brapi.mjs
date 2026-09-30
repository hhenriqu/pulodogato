// =====================================================
// HMO-191 -- a aritmetica da cotacao, sem rede e sem banco
// =====================================================
//
//   npm run test:cotacao-brapi
//
// O que esta suite guarda, em ordem de quanto custa errar:
//
//   1. O PAR. `atualizacaoDePreco` e o unico construtor do que vai para o
//      `.update()`, e ele sempre devolve os dois campos. Se um dia alguem
//      relaxar isso, o UPDATE toma 23514 e a carteira para de atualizar
//      inteira -- com o cron devolvendo 200. O teste do banco
//      (database/tests/031_cotacao_automatica_test.sql) prova que o banco
//      recusa; este prova que o codigo nao chega a mandar a metade.
//
//   2. NAO ZERAR PRECO. Requisito literal da issue: "um ticker que a brapi nao
//      conhece nao pode zerar o preco que ja estava la". O banco NAO impede
//      isso (o teste SQL demonstra que aceita). Quem impede e `precoDaResposta`
//      recusando a resposta ruim, e o fato de nao existir caminho de
//      `ResultadoDaCotacao` falho para `AtualizacaoDePreco`.
//
//   3. O SIMBOLO TROCADO. A brapi responde 200 com preco valido de OUTRO papel
//      quando o ticker resolve para outra coisa. Esse e o unico defeito desta
//      entrega que produz um numero plausivel e errado -- e numero plausivel e
//      errado e o que o usuario usa para decidir. Mesmo defeito que a HMO-194
//      encontrou na busca da B3.
//
//   4. A FILA. Distinta por simbolo (a brapi cobra por chamada) e ordenada por
//      quem esta ha mais tempo sem preco (quando o teto corta, a ordem decide
//      quem fica desatualizado para sempre).

import test from "node:test";
import assert from "node:assert/strict";

const {
  montarFila,
  precoDaResposta,
  atualizacaoDePreco,
  motivoDoStatus,
  urlDaCotacao,
  TIPOS_COTADOS,
  MOEDA_COTADA,
  TETO_DE_CHAMADAS_POR_EXECUCAO,
} = await import("../.tmp-cotacao-brapi/cotacao-brapi.js");

/** Atalho para montar linha de `investment_assets` nos testes. */
function ativo(symbol, extra = {}) {
  return {
    symbol,
    type: "stock",
    currency: "BRL",
    current_price_at: null,
    ...extra,
  };
}

/** Corpo tipico do plano gratuito da brapi. */
function respostaBoa(symbol, preco) {
  return {
    results: [
      {
        symbol,
        shortName: `${symbol} ON`,
        currency: "BRL",
        regularMarketPrice: preco,
        regularMarketTime: "2026-09-30T20:06:00.000Z",
      },
    ],
    requestedAt: "2026-09-30T21:00:00.000Z",
    took: "12ms",
  };
}

// =====================================================
// 1. O par preco/data -- a armadilha da 021
// =====================================================

test("atualizacaoDePreco devolve SEMPRE os dois campos, nao-nulos", () => {
  const agora = new Date("2026-09-30T21:00:00.000Z");
  const a = atualizacaoDePreco(38.42, agora);

  // A assercao e sobre as CHAVES, nao so sobre os valores: um objeto com
  // `current_price_at: undefined` serializa sem a chave no JSON que o
  // supabase-js manda, e o banco recebe exatamente a metade proibida.
  assert.deepEqual(
    Object.keys(a).sort(),
    ["current_price", "current_price_at"],
    "a atualizacao tem que ter as duas chaves e so elas"
  );
  assert.equal(a.current_price, 38.42);
  assert.equal(a.current_price_at, "2026-09-30T21:00:00.000Z");
  assert.notEqual(a.current_price_at, null);
  assert.notEqual(a.current_price_at, undefined);
});

test("atualizacaoDePreco recusa o que o CHECK da 021 recusaria depois", () => {
  const agora = new Date("2026-09-30T21:00:00.000Z");

  // `investment_assets_current_price_positivo`: zero e negativo.
  assert.throws(() => atualizacaoDePreco(0, agora), /preco invalido/);
  assert.throws(() => atualizacaoDePreco(-1, agora), /preco invalido/);

  // NaN/Infinity viram `null` no JSON.stringify do supabase-js -- ou seja,
  // chegariam ao banco como preco nulo com data preenchida: a OUTRA metade
  // proibida do par, e a que ninguem procura.
  assert.throws(() => atualizacaoDePreco(NaN, agora), /preco invalido/);
  assert.throws(() => atualizacaoDePreco(Infinity, agora), /preco invalido/);
  assert.throws(() => atualizacaoDePreco(undefined, agora), /preco invalido/);

  // Data invalida daria `current_price_at` invalido com preco bom.
  assert.throws(() => atualizacaoDePreco(10, new Date("nao e data")), /data invalida/);
  assert.throws(() => atualizacaoDePreco(10, "2026-09-30"), /data invalida/);
});

test("JSON.stringify da atualizacao carrega as duas chaves", () => {
  // E assim que o par chega ao PostgREST. Este teste existe porque a garantia
  // de tipo do TypeScript some na serializacao, e e la que a metade do par
  // nasceria.
  const serializado = JSON.parse(
    JSON.stringify(atualizacaoDePreco(12.5, new Date("2026-09-30T21:00:00.000Z")))
  );
  assert.deepEqual(Object.keys(serializado).sort(), ["current_price", "current_price_at"]);
  assert.equal(typeof serializado.current_price, "number");
  assert.equal(typeof serializado.current_price_at, "string");
});

// =====================================================
// 2. Resposta ruim nunca vira preco
// =====================================================

test("resposta boa vira preco", () => {
  const r = precoDaResposta(respostaBoa("PETR4", 38.42), "PETR4");
  assert.equal(r.ok, true);
  assert.equal(r.preco, 38.42);
});

test("ticker que a brapi nao conhece nao produz preco", () => {
  // Os tres formatos de "nao existe" que a API usa.
  const vazio = precoDaResposta({ results: [] }, "XPTO9");
  assert.equal(vazio.ok, false);
  assert.equal(vazio.motivo, "desconhecido");

  const comErro = precoDaResposta({ error: true, message: "Ação não encontrada" }, "XPTO9");
  assert.equal(comErro.ok, false);
  assert.equal(comErro.motivo, "desconhecido");

  assert.equal(motivoDoStatus(404), "desconhecido");
});

// --- o corpo REAL da brapi, capturado em 2026-09-30 --------------------------
// Copiado da resposta de verdade, nao inventado. Um fixture inventado so prova
// que o parser concorda com a minha suposicao sobre a API -- que e exatamente
// a suposicao que pode estar errada.
const PETR4_REAL = {
  results: [
    {
      symbol: "PETR4",
      shortName: "PETR4",
      longName: "Petroleo Brasileiro SA Pfd",
      currency: "BRL",
      regularMarketPrice: 49.4,
      regularMarketDayHigh: 50.03,
      regularMarketDayLow: 49.26,
      regularMarketChange: 0.3,
      regularMarketChangePercent: 0.61,
      regularMarketTime: "2026-09-30T19:47:30.000Z",
      marketCap: 663110364068,
      regularMarketPreviousClose: 49.4,
      priceEarnings: 4.7737309509774555,
      earningsPerShare: 10.3482633,
      logourl: "https://icons.brapi.dev/icons/PETR4.svg",
    },
  ],
  requestedAt: "2026-09-30T19:48:39.947Z",
  took: 0,
};

// O corpo REAL de uma chamada sem token, tambem capturado em 2026-09-30.
const SEM_TOKEN_REAL = {
  error: true,
  message: "Token de autenticação não fornecido",
  code: "MISSING_TOKEN",
};

test("o corpo REAL da brapi atravessa o parser e vira o par completo", () => {
  const r = precoDaResposta(PETR4_REAL, "PETR4");
  assert.equal(r.ok, true);
  assert.equal(r.preco, 49.4);

  const a = atualizacaoDePreco(r.preco, new Date("2026-09-30T23:00:00.000Z"));
  assert.deepEqual(a, {
    current_price: 49.4,
    current_price_at: "2026-09-30T23:00:00.000Z",
  });
});

test("o corpo REAL pedido com OUTRO ticker e recusado", () => {
  // Mesmo corpo valido, pergunta diferente.
  const r = precoDaResposta(PETR4_REAL, "VALE3");
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "simbolo_trocado");
});

test("token recusado NAO e lido como ticker inexistente", () => {
  // Medido: a brapi usa o MESMO `error: true` para "ticker nao existe" e para
  // "sua chave nao serve". Confundir os dois faz o cron anunciar que a carteira
  // inteira do usuario tem tickers invalidos quando o defeito e a chave do
  // dono -- duas acoes opostas a partir do mesmo resumo.
  const r = precoDaResposta(SEM_TOKEN_REAL, "PETR4");
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "credencial_recusada");
  assert.notEqual(r.motivo, "desconhecido");

  // E o status HTTP que acompanha (401) concorda com o corpo.
  assert.equal(motivoDoStatus(401), "credencial_recusada");
  assert.equal(motivoDoStatus(403), "credencial_recusada");
});

test("ticker inexistente continua sendo desconhecido, nao problema de chave", () => {
  // O controle do teste acima: a mensagem de ticker invalido nao pode cair na
  // heuristica de credencial, senao ela engoliria os dois casos e o resumo
  // voltaria a ter uma causa so.
  const r = precoDaResposta({ error: true, message: "Ação não encontrada" }, "XPTO9");
  assert.equal(r.motivo, "desconhecido");
});

test("404 e distinguido de 429 e de 5xx", () => {
  // Confundir os tres faria o resumo do cron acusar carteira quebrada num dia
  // em que a brapi so estava fora do ar -- e, pior, esconderia a cota estourada
  // no meio de "tickers invalidos", que e o unico dos tres que exige acao do
  // usuario.
  assert.equal(motivoDoStatus(429), "limite_atingido");
  assert.equal(motivoDoStatus(500), "fonte_indisponivel");
  assert.equal(motivoDoStatus(502), "fonte_indisponivel");

  // 401/403 tem motivo proprio (`credencial_recusada`): e o unico que o dono do
  // projeto conserta, e so ele justifica a rota devolver 500 em vez de 200.
  assert.equal(motivoDoStatus(401), "credencial_recusada");
  assert.equal(motivoDoStatus(403), "credencial_recusada");
});

test("preco zero ou negativo nao passa (papel suspenso na B3)", () => {
  const zero = precoDaResposta(respostaBoa("PETR4", 0), "PETR4");
  assert.equal(zero.ok, false);
  assert.equal(zero.motivo, "sem_preco");

  const negativo = precoDaResposta(respostaBoa("PETR4", -3), "PETR4");
  assert.equal(negativo.ok, false);
  assert.equal(negativo.motivo, "sem_preco");
});

test("preco ausente, nulo ou em texto nao passa", () => {
  // `"38.42"` e o caso traicoeiro: `Number("38.42")` daria 38.42 e um parse
  // permissivo aceitaria. Mas se a API comecar a mandar texto, alguma coisa
  // mudou nela -- e adivinhar o formato novo e como se grava numero errado com
  // cara de certo. Recusar e a resposta honesta.
  for (const valor of [undefined, null, "38.42", {}, []]) {
    const r = precoDaResposta({ results: [{ symbol: "PETR4", regularMarketPrice: valor }] }, "PETR4");
    assert.equal(r.ok, false, `deveria recusar regularMarketPrice = ${JSON.stringify(valor)}`);
    assert.equal(r.motivo, "sem_preco");
  }
});

test("corpo fora do formato nao derruba e nao vira preco", () => {
  for (const bruto of [null, undefined, 42, "texto", {}, { results: "nao e lista" }, { results: [7] }]) {
    const r = precoDaResposta(bruto, "PETR4");
    assert.equal(r.ok, false, `deveria recusar ${JSON.stringify(bruto)}`);
  }
});

// =====================================================
// 3. O simbolo trocado -- o numero plausivel e errado
// =====================================================

test("resposta de OUTRO ticker e recusada mesmo com preco valido", () => {
  // Preco perfeitamente valido, corpo perfeitamente bem formado. So o papel e
  // outro. Gravar isso seria a PETR4 do usuario mostrando o preco da VALE3,
  // com a data de hoje e nenhum erro em lugar nenhum.
  const r = precoDaResposta(respostaBoa("VALE3", 61.7), "PETR4");
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "simbolo_trocado");
  assert.match(r.detalhe, /PETR4/);
  assert.match(r.detalhe, /VALE3/);
});

test("a conferencia do simbolo nao e sensivel a caixa nem a espaco", () => {
  // A API pode devolver com espaco ou caixa diferente. Recusar por isso
  // desligaria a cotacao inteira sem motivo real.
  const r = precoDaResposta({ results: [{ symbol: " petr4 ", regularMarketPrice: 38.42 }] }, "PETR4");
  assert.equal(r.ok, true);
  assert.equal(r.preco, 38.42);
});

test("resposta sem campo symbol e recusada", () => {
  const r = precoDaResposta({ results: [{ regularMarketPrice: 38.42 }] }, "PETR4");
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "simbolo_trocado");
});

// =====================================================
// 4. A fila: distinta, filtrada e priorizada
// =====================================================

test("o mesmo ticker em N carteiras vira UMA chamada", () => {
  // A conta da entrega: `investment_assets` e por usuario, a cotacao nao e.
  const fila = montarFila([
    ativo("PETR4"),
    ativo("PETR4"),
    ativo("PETR4"),
    ativo("VALE3"),
  ]);
  assert.deepEqual(
    fila.map((f) => f.symbol),
    ["PETR4", "VALE3"]
  );
});

test("renda fixa, internacional e moeda estrangeira ficam de fora", () => {
  const fila = montarFila([
    ativo("CDB2028", { type: "fixed_income" }),
    ativo("AAPL", { type: "international", currency: "USD" }),
    ativo("AAPL34", { type: "stock", currency: "USD" }),
    ativo("MXRF11", { type: "fii" }),
    ativo("PETR4"),
  ]);

  // Os dois que sobram sao os dois tipos cotados em BRL.
  assert.deepEqual(
    fila.map((f) => f.symbol),
    ["MXRF11", "PETR4"]
  );
  assert.deepEqual([...TIPOS_COTADOS].sort(), ["fii", "stock"]);
  assert.equal(MOEDA_COTADA, "BRL");
});

test("um tipo novo na 021 nasce FORA da cotacao", () => {
  // O padrao seguro e nao cotar. Se a 021 ganhar 'cripto' e `montarFila`
  // passar a cotar por omissao, o endpoint de acao responde outro numero (ou
  // 404 todo dia queimando cota).
  const fila = montarFila([ativo("BTC", { type: "cripto" })]);
  assert.deepEqual(fila, []);
});

test("quem nunca teve preco vem primeiro; depois, do mais velho ao mais novo", () => {
  const fila = montarFila([
    ativo("CCCC3", { current_price_at: "2026-09-30T21:00:00.000Z" }),
    ativo("AAAA3", { current_price_at: "2026-01-05T21:00:00.000Z" }),
    ativo("BBBB3", { current_price_at: null }),
    ativo("DDDD3", { current_price_at: "2026-06-15T21:00:00.000Z" }),
  ]);
  assert.deepEqual(
    fila.map((f) => f.symbol),
    ["BBBB3", "AAAA3", "DDDD3", "CCCC3"]
  );
});

test("empate desempata pelo simbolo -- duas execucoes montam a mesma fila", () => {
  // Sem desempate deterministico o teto cortaria um conjunto diferente a cada
  // execucao e nao haveria o que afirmar sobre quem fica de fora.
  const mesmoInstante = "2026-09-30T21:00:00.000Z";
  const entrada = [
    ativo("ZZZZ3", { current_price_at: mesmoInstante }),
    ativo("AAAA3", { current_price_at: mesmoInstante }),
    ativo("MMMM3", { current_price_at: mesmoInstante }),
  ];
  assert.deepEqual(
    montarFila(entrada).map((f) => f.symbol),
    ["AAAA3", "MMMM3", "ZZZZ3"]
  );
  assert.deepEqual(
    montarFila([...entrada].reverse()).map((f) => f.symbol),
    ["AAAA3", "MMMM3", "ZZZZ3"]
  );
});

test("o grupo herda a cotacao MAIS ANTIGA entre as linhas do mesmo simbolo", () => {
  // Dez pessoas com PETR4, uma delas cadastrou hoje e esta sem preco. O grupo
  // tem que ser tratado como o pior caso -- e a tela DELA que esta sem numero.
  const fila = montarFila([
    ativo("PETR4", { current_price_at: "2026-09-30T21:00:00.000Z" }),
    ativo("PETR4", { current_price_at: null }),
    ativo("VALE3", { current_price_at: "2026-09-29T21:00:00.000Z" }),
  ]);
  assert.deepEqual(
    fila.map((f) => f.symbol),
    ["PETR4", "VALE3"]
  );
  assert.equal(fila[0].cotadoEm, null);

  // E a ordem de chegada nao pode mudar o resultado.
  const invertida = montarFila([
    ativo("PETR4", { current_price_at: null }),
    ativo("PETR4", { current_price_at: "2026-09-30T21:00:00.000Z" }),
    ativo("VALE3", { current_price_at: "2026-09-29T21:00:00.000Z" }),
  ]);
  assert.equal(invertida[0].symbol, "PETR4");
  assert.equal(invertida[0].cotadoEm, null);
});

test("o teto corta a fila, e o que sobra e o primeiro da proxima vez", () => {
  const entrada = [
    ativo("AAAA3", { current_price_at: "2026-01-01T00:00:00.000Z" }),
    ativo("BBBB3", { current_price_at: "2026-02-01T00:00:00.000Z" }),
    ativo("CCCC3", { current_price_at: "2026-03-01T00:00:00.000Z" }),
  ];

  const hoje = montarFila(entrada, 2);
  assert.deepEqual(hoje.map((f) => f.symbol), ["AAAA3", "BBBB3"]);

  // Amanha: os dois de hoje foram atualizados, CCCC3 nao. Ele passa a ser o
  // mais velho e sobe para o topo -- nenhum simbolo fica preso fora do teto.
  const amanha = montarFila(
    [
      ativo("AAAA3", { current_price_at: "2026-09-30T23:00:00.000Z" }),
      ativo("BBBB3", { current_price_at: "2026-09-30T23:00:00.000Z" }),
      ativo("CCCC3", { current_price_at: "2026-03-01T00:00:00.000Z" }),
    ],
    2
  );
  assert.equal(amanha[0].symbol, "CCCC3");
});

test("teto zero ou negativo desliga o job sem apagar o registro dele", () => {
  assert.deepEqual(montarFila([ativo("PETR4")], 0), []);
  assert.deepEqual(montarFila([ativo("PETR4")], -5), []);
});

test("carteira vazia devolve fila vazia", () => {
  assert.deepEqual(montarFila([]), []);
});

test("o teto cabe na cota mensal do plano gratuito", () => {
  // 15.000 chamadas/mes, uma por ticker, ~22 pregoes por mes (o cron roda de
  // segunda a sexta). Se alguem subir o teto sem refazer esta conta, a cota
  // acaba no meio do mes e a carteira fica sem cotacao ate o dia 1.
  const PREGOES_POR_MES = 23;
  const COTA_MENSAL = 15000;
  assert.ok(
    TETO_DE_CHAMADAS_POR_EXECUCAO * PREGOES_POR_MES <= COTA_MENSAL,
    `teto de ${TETO_DE_CHAMADAS_POR_EXECUCAO} x ${PREGOES_POR_MES} pregoes passa da cota de ${COTA_MENSAL}`
  );
});

// =====================================================
// 5. A URL
// =====================================================

test("a URL e de um ticker so e nao carrega o token", () => {
  const url = urlDaCotacao("petr4");

  // Maiuscula: a 021 guarda assim e a brapi e sensivel a caixa.
  assert.equal(url, "https://brapi.dev/api/quote/PETR4");

  // O token vai no header. Se ele voltar para a query string, ele passa a
  // aparecer em log de erro e em mensagem de excecao do fetch.
  assert.ok(!url.includes("token"), "o token nao pode estar na URL");
  assert.ok(!url.includes("?"), "a URL nao tem query string");

  // Um ticker por chamada: o endpoint de lote e pago e no gratuito responde so
  // o primeiro, calado -- a carteira encolheria sozinha.
  assert.ok(!url.includes(","), "a URL nao pode pedir lote");
});

test("a URL escapa o que o usuario digitou", () => {
  // `symbol` vem de `investment_assets`, que o usuario preenche. O CHECK da 021
  // limita a 16 caracteres mas nao proibe `/` nem `?`.
  // A maiuscula vem ANTES do escape -- por isso `x=1` sai `X%3D1`.
  assert.equal(urlDaCotacao("A/B"), "https://brapi.dev/api/quote/A%2FB");
  assert.equal(urlDaCotacao("A?x=1"), "https://brapi.dev/api/quote/A%3FX%3D1");

  // O que o escape impede: sair do caminho de cotacao. Sem ele, um symbol com
  // `/` viraria outro endpoint da propria brapi.
  assert.ok(!urlDaCotacao("A/B").endsWith("/A/B"));
});
