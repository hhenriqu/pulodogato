#!/usr/bin/env node
// =====================================================
// PULODOGATO - a moeda oficial, a sugestao por lancamento, e o periodo com
// varias moedas (HMO-171, partes 2 e 3)
// =====================================================
// A parte 3 da issue cabe numa frase ("mostrar separado por moeda quando houver
// mais de uma") e e onde este arquivo gasta a maior parte das asercoes. O motivo
// esta no cabecalho de lib/moeda.ts: a pergunta "quantas moedas tem este
// periodo" tem uma resposta obvia e errada -- contar as moedas distintas que
// voltaram do banco.
//
// `monthly_cash_flow` (022) produz uma linha por moeda, e uma linha pode ser
// toda de zeros. Contar linhas diria "duas moedas" num mes que teve movimento em
// uma so, e a tela quebraria o resultado em dois blocos com um deles zerado.
//
// A outra metade sao as duas decisoes do Helio, que sao afirmacoes sobre
// PRECEDENCIA e nao sobre formatacao -- o tipo de regra que passa pelo tsc
// invertida:
//
//   "os-dois"    a conta sugere, o lancamento decide;
//   "ficam-brl"  nada reescreve a moeda de quem ja existe.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  PREFERENCIA_DE_MOEDA_PADRAO,
  lerPreferenciaDeMoeda,
  mesclarPreferenciaDeMoeda,
  moedaSugerida,
  opcoesDeMoeda,
  periodoTemVariasMoedas,
  resumirPorMoeda,
  validarPreferenciaDeMoeda,
} from "../.tmp-moeda/moeda.js";

// ---------------------------------------------------------------------------
// A preferencia
// ---------------------------------------------------------------------------

test("perfil sem preferencia de moeda cai no padrao BRL, desligado", () => {
  // O caso da conta antiga, e o mais comum do app: ninguem configurou nada. Se
  // isto voltasse com `porLancamento: true`, TODA pessoa do app ganharia um
  // campo de moeda no formulario de lancamento sem ter pedido.
  assert.deepEqual(lerPreferenciaDeMoeda(null), PREFERENCIA_DE_MOEDA_PADRAO);
  assert.deepEqual(lerPreferenciaDeMoeda({}), PREFERENCIA_DE_MOEDA_PADRAO);
  assert.deepEqual(lerPreferenciaDeMoeda({ dashboard: {} }), PREFERENCIA_DE_MOEDA_PADRAO);
  assert.equal(PREFERENCIA_DE_MOEDA_PADRAO.oficial, "BRL");
  assert.equal(PREFERENCIA_DE_MOEDA_PADRAO.porLancamento, false);
});

test("a preferencia gravada e lida de volta", () => {
  assert.deepEqual(
    lerPreferenciaDeMoeda({ moeda: { oficial: "USD", porLancamento: true } }),
    { oficial: "USD", porLancamento: true }
  );
});

test("moeda oficial ilegivel no jsonb cai no padrao, sem lancar", () => {
  // Mao humana no jsonb, ou uma versao anterior do app. A leitura e tolerante de
  // proposito: uma preferencia estranha nao pode deixar a tela de lancamento
  // branca. Ver o par deste caso na secao de validacao -- a ESCRITA recusa.
  for (const estranho of ["CZK", "", "  ", 42, null, ["USD"], { codigo: "USD" }]) {
    assert.equal(
      lerPreferenciaDeMoeda({ moeda: { oficial: estranho, porLancamento: false } }).oficial,
      "BRL",
      `${JSON.stringify(estranho)} deveria cair no padrao`
    );
  }
});

test("codigo em minuscula e com espaco e aceito na leitura", () => {
  assert.equal(
    lerPreferenciaDeMoeda({ moeda: { oficial: " usd ", porLancamento: false } }).oficial,
    "USD"
  );
});

test("porLancamento so liga com booleano true, nunca com truthy", () => {
  // Um formulario mal serializado manda "false" (string), que e truthy em
  // JavaScript. Ligar o campo para quem pediu o contrario e o defeito silencioso
  // aqui: nada da erro, a pessoa so passa a ver um campo que desativou.
  for (const truthy of ["false", "true", 1, "1", {}, []]) {
    assert.equal(
      lerPreferenciaDeMoeda({ moeda: { oficial: "BRL", porLancamento: truthy } }).porLancamento,
      false,
      `${JSON.stringify(truthy)} nao deveria ligar o seletor`
    );
  }
  assert.equal(
    lerPreferenciaDeMoeda({ moeda: { oficial: "BRL", porLancamento: true } }).porLancamento,
    true
  );
});

test("mesclar preserva o resto do jsonb do perfil", () => {
  // O caso que o PUT tem que acertar. `preferences` e o jsonb INTEIRO do perfil:
  // um update que escrevesse `{ moeda: ... }` direto apagaria o painel e as
  // notificacoes -- em silencio, porque a moeda passaria a funcionar como o
  // usuario pediu enquanto o resto voltava ao padrao.
  const atual = {
    dashboard: { layout: ["saldo", "metas"] },
    notifications: { email: false },
  };

  const depois = mesclarPreferenciaDeMoeda(atual, { oficial: "EUR", porLancamento: true });

  assert.deepEqual(depois.dashboard, { layout: ["saldo", "metas"] });
  assert.deepEqual(depois.notifications, { email: false });
  assert.deepEqual(depois.moeda, { oficial: "EUR", porLancamento: true });
});

test("mesclar preserva chaves desconhecidas DENTRO do bloco de moeda", () => {
  // Uma versao futura pode guardar mais coisa em `preferences.moeda`. Trocar o
  // bloco inteiro apagaria isso na primeira vez que alguem abrisse as
  // configuracoes e clicasse em salvar.
  const depois = mesclarPreferenciaDeMoeda(
    { moeda: { oficial: "BRL", porLancamento: false, cotacaoManual: 5.4 } },
    { oficial: "USD", porLancamento: true }
  );

  assert.deepEqual(depois.moeda, {
    oficial: "USD",
    porLancamento: true,
    cotacaoManual: 5.4,
  });
});

test("mesclar sobre jsonb ausente ou invalido nao lanca", () => {
  for (const ruim of [null, undefined, "texto", 7, []]) {
    const depois = mesclarPreferenciaDeMoeda(ruim, { oficial: "GBP", porLancamento: false });
    assert.deepEqual(depois.moeda, { oficial: "GBP", porLancamento: false });
  }
});

// ---------------------------------------------------------------------------
// A validacao da escrita
// ---------------------------------------------------------------------------

test("a escrita RECUSA moeda fora do catalogo, em vez de corrigir", () => {
  // O par do caso de leitura tolerante. Corrigir "CZK" para "BRL" aqui mostraria
  // "salvo" com outra moeda gravada, e a pessoa descobre no proximo lancamento.
  const r = validarPreferenciaDeMoeda({ oficial: "CZK", porLancamento: false });
  assert.equal(r.ok, false);
  assert.match(r.erro, /lista/i);
});

test("a escrita recusa porLancamento ausente ou nao booleano", () => {
  // Assumir `false` desligaria o seletor de quem so quis trocar a moeda oficial,
  // e as contas em dolar dessa pessoa perderiam o campo que as explica.
  for (const corpo of [
    { oficial: "USD" },
    { oficial: "USD", porLancamento: "true" },
    { oficial: "USD", porLancamento: 1 },
  ]) {
    const r = validarPreferenciaDeMoeda(corpo);
    assert.equal(r.ok, false, `${JSON.stringify(corpo)} deveria ser recusado`);
    assert.match(r.erro, /porLancamento/);
  }
});

test("a escrita aceita o corpo certo e normaliza o codigo", () => {
  const r = validarPreferenciaDeMoeda({ oficial: " jpy ", porLancamento: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.valor, { oficial: "JPY", porLancamento: true });
});

test("a escrita recusa corpo que nao e objeto", () => {
  for (const ruim of [null, "USD", 3, []]) {
    assert.equal(validarPreferenciaDeMoeda(ruim).ok, false);
  }
});

// ---------------------------------------------------------------------------
// "os-dois": a conta sugere, o lancamento decide
// ---------------------------------------------------------------------------

test("a moeda do lancamento ganha da moeda da conta", () => {
  // A ordem que erra facil, e o unico caso deste arquivo que apaga dinheiro de
  // verdade: invertida, reabrir um lancamento antigo de uma conta que mudou de
  // moeda mostraria a moeda NOVA, e salvar sem mexer em nada converteria o
  // historico na razao de 1 para 1.
  assert.equal(
    moedaSugerida({ doLancamento: "USD", daConta: "BRL", oficial: "EUR" }),
    "USD"
  );
});

test("sem moeda no lancamento, a da conta vale", () => {
  assert.equal(moedaSugerida({ daConta: "USD", oficial: "BRL" }), "USD");
  assert.equal(moedaSugerida({ doLancamento: null, daConta: "USD", oficial: "BRL" }), "USD");
});

test("sem conta escolhida, a moeda oficial vale", () => {
  assert.equal(moedaSugerida({ oficial: "EUR" }), "EUR");
});

test("sem nada, BRL", () => {
  // "ficam-brl" do lado do codigo: o fallback e o mesmo DEFAULT da coluna.
  assert.equal(moedaSugerida({}), "BRL");
  assert.equal(moedaSugerida({ doLancamento: "CZK", daConta: "XXX", oficial: "ZZZ" }), "BRL");
});

// ---------------------------------------------------------------------------
// A parte 3: o periodo separado por moeda
// ---------------------------------------------------------------------------

const MARCO_MISTO = [
  { currency: "BRL", income: 3000, expense: 1000, net: 2000, transaction_count: 3 },
  { currency: "USD", income: 0, expense: 180, net: -180, transaction_count: 2 },
];

test("periodo de uma moeda da um bloco, com a moeda dentro", () => {
  const blocos = resumirPorMoeda(
    [{ currency: "BRL", income: 3000, expense: 1000, net: 2000, transaction_count: 3 }],
    "BRL"
  );
  assert.equal(blocos.length, 1);
  assert.equal(blocos[0].moeda, "BRL");
  assert.equal(blocos[0].simbolo, "R$");
  assert.equal(periodoTemVariasMoedas([{ currency: "BRL", expense: 10, transaction_count: 1 }], "BRL"), false);
});

test("periodo com duas moedas da dois blocos, cada um puro", () => {
  const blocos = resumirPorMoeda(MARCO_MISTO, "BRL");
  assert.equal(blocos.length, 2);
  assert.equal(periodoTemVariasMoedas(MARCO_MISTO, "BRL"), true);

  const brl = blocos.find((b) => b.moeda === "BRL");
  const usd = blocos.find((b) => b.moeda === "USD");

  // O numero que a issue existe para proteger: 1000, nao 1180.
  assert.equal(brl.expense, 1000);
  assert.equal(usd.expense, 180);
  // E a renda em reais nao vaza para o bloco de dolar.
  assert.equal(usd.income, 0);
  assert.equal(usd.net, -180);
});

test("nao existe total geral somando as moedas", () => {
  // A funcao devolve LISTA de proposito. Um campo `total` aqui seria somado por
  // alguem um dia, e somar 1000 reais com 180 dolares nao da numero nenhum --
  // este app nao tem cotacao.
  const blocos = resumirPorMoeda(MARCO_MISTO, "BRL");
  assert.ok(Array.isArray(blocos));
  for (const bloco of blocos) {
    assert.equal("total" in bloco, false);
  }
});

test("moeda sem lancamento nenhum nao vira bloco", () => {
  // O caso que uma contagem de moedas distintas erra: a tela nao pode mostrar
  // "voce gastou R$ 0,00 e US$ 300,00".
  //
  // Esta forma de linha -- tudo zero, inclusive a contagem -- NAO vem de
  // `monthly_cash_flow`: a view conta com o mesmo FILTER que usa para agrupar,
  // entao toda linha dela tem contagem >= 1 (conferido no Postgres). Ela vem de
  // quem CHAMA: uma rota que semeia uma linha por moeda conhecida para a tela
  // poder oferecer todas -- que e o jeito natural de montar esse seletor.
  const linhas = [
    { currency: "BRL", income: 0, expense: 0, net: 0, transaction_count: 0 },
    { currency: "USD", income: 0, expense: 300, net: -300, transaction_count: 1 },
  ];

  const blocos = resumirPorMoeda(linhas, "BRL");
  assert.equal(blocos.length, 1);
  assert.equal(blocos[0].moeda, "USD");
  assert.equal(periodoTemVariasMoedas(linhas, "BRL"), false);
});

test("moeda cujo unico lancamento vale zero CONTINUA sendo bloco", () => {
  // O outro lado, e o motivo de o critério ser "houve lancamento" e nao "o valor
  // e diferente de zero".
  //
  // Esta linha e REAL, e foi conferida no Postgres: `financial_transactions` nao
  // tem CHECK sobre `amount`, entao um lancamento de valor zero entra, e
  // `monthly_cash_flow` devolve para ele income = 0, expense = 0 e
  // transaction_count = 1. Esconder o bloco faria a contagem de lancamentos da
  // tela nao fechar com a lista logo abaixo dela -- "1 lancamento" num periodo
  // que nao mostra bloco nenhum.
  //
  // A primeira versao deste caso usava income 500 / expense 500 ("se anulam"),
  // que tem valor diferente de zero e portanto NAO exercitava a clausula da
  // contagem: o mutante que a removia sobrevivia.
  const linhas = [
    { currency: "BRL", income: 0, expense: 0, net: 0, transaction_count: 1 },
    { currency: "USD", income: 0, expense: 300, net: -300, transaction_count: 1 },
  ];

  const blocos = resumirPorMoeda(linhas, "BRL");
  assert.equal(blocos.length, 2);
  assert.equal(blocos[0].moeda, "BRL");
  assert.equal(blocos[0].transacoes, 1);
  assert.equal(periodoTemVariasMoedas(linhas, "BRL"), true);
});

test("moeda que so teve transferencia nao chega aqui como bloco vazio", () => {
  // Uma transferencia entre moedas (cambio) e `transfer` nas duas pernas, e a
  // view filtra `type IN ('expense','income')` -- conferido no Postgres: a moeda
  // que so recebeu a perna do cambio nao produz linha NENHUMA. Entao o cambio
  // nao inventa um bloco zerado em dolar, e este caso documenta isso do lado do
  // TypeScript: se um dia a view passar a devolver essa linha, ela vem com
  // contagem 0 e o filtro a descarta.
  const linhas = [
    { currency: "BRL", income: 0, expense: 1000, net: -1000, transaction_count: 1 },
    { currency: "USD", income: 0, expense: 0, net: 0, transaction_count: 0 },
  ];

  assert.deepEqual(resumirPorMoeda(linhas, "BRL").map((b) => b.moeda), ["BRL"]);
});

test("uma moeda que NAO e a oficial ainda diz qual moeda e", () => {
  // O mes inteiro no exterior. Uma linha so, entao "nao ha mistura" -- e sem a
  // moeda no bloco a tela mostraria o total com R$ na frente de um numero em
  // dolar, que e exatamente o erro que esta issue existe para impedir.
  const blocos = resumirPorMoeda(
    [{ currency: "USD", income: 0, expense: 900, net: -900, transaction_count: 4 }],
    "BRL"
  );
  assert.equal(blocos.length, 1);
  assert.equal(blocos[0].moeda, "USD");
  assert.equal(blocos[0].simbolo, "US$");
});

test("a moeda oficial vem primeiro, mesmo com menos movimento", () => {
  const blocos = resumirPorMoeda(
    [
      { currency: "USD", income: 0, expense: 9000, net: -9000, transaction_count: 9 },
      { currency: "BRL", income: 0, expense: 10, net: -10, transaction_count: 1 },
    ],
    "BRL"
  );
  assert.deepEqual(blocos.map((b) => b.moeda), ["BRL", "USD"]);
});

test("fora da oficial, ordena por volume e desempata pelo codigo", () => {
  // Volume = entrada + saida, e nao `net`: um mes caro tem `net` muito negativo,
  // e ordenar por ele jogaria a moeda mais movimentada para o fim da tela.
  const blocos = resumirPorMoeda(
    [
      { currency: "EUR", income: 0, expense: 100, net: -100, transaction_count: 1 },
      { currency: "USD", income: 0, expense: 5000, net: -5000, transaction_count: 1 },
      { currency: "GBP", income: 0, expense: 100, net: -100, transaction_count: 1 },
    ],
    "BRL"
  );
  assert.deepEqual(blocos.map((b) => b.moeda), ["USD", "EUR", "GBP"]);
});

test("varias linhas da mesma moeda somam dentro do bloco", () => {
  // `category_monthly_totals` tem uma linha por CATEGORIA. Quem ler dali em vez
  // de `monthly_cash_flow` manda varias linhas da mesma moeda, e elas tem que
  // somar -- dentro da moeda, que e a unica soma legitima aqui.
  const blocos = resumirPorMoeda(
    [
      { currency: "BRL", income: 0, expense: 300, net: -300, transaction_count: 1 },
      { currency: "BRL", income: 0, expense: 700, net: -700, transaction_count: 2 },
    ],
    "BRL"
  );
  assert.equal(blocos.length, 1);
  assert.equal(blocos[0].expense, 1000);
  assert.equal(blocos[0].transacoes, 3);
});

test("numeric do Postgres chega como string e e somado como numero", () => {
  // supabase-js devolve `numeric` como STRING. Sem conversao, "300" + "700"
  // daria "300700" -- um gasto de trezentos mil reais na tela, sem erro nenhum.
  const blocos = resumirPorMoeda(
    [
      { currency: "BRL", income: "0", expense: "300.00", net: "-300.00", transaction_count: "1" },
      { currency: "BRL", income: "0", expense: "700.50", net: "-700.50", transaction_count: "2" },
    ],
    "BRL"
  );
  assert.equal(blocos[0].expense, 1000.5);
  assert.equal(blocos[0].transacoes, 3);
});

test("linha sem moeda e tratada como BRL, e nao descartada", () => {
  // Linha de antes da 022, ou de uma view que esqueceu a coluna. Descartar faria
  // dinheiro desaparecer da tela -- pior que mostrar no balde do padrao.
  const blocos = resumirPorMoeda(
    [{ income: 0, expense: 42, net: -42, transaction_count: 1 }],
    "BRL"
  );
  assert.equal(blocos.length, 1);
  assert.equal(blocos[0].moeda, "BRL");
  assert.equal(blocos[0].expense, 42);
});

test("periodo vazio nao da bloco nenhum e nao tem varias moedas", () => {
  for (const vazio of [[], null, undefined]) {
    assert.deepEqual(resumirPorMoeda(vazio, "BRL"), []);
    assert.equal(periodoTemVariasMoedas(vazio, "BRL"), false);
  }
});

test("as duas respostas nao podem discordar", () => {
  // `periodoTemVariasMoedas` sai de `resumirPorMoeda` para que a tela nunca
  // anuncie "varias moedas" e renderize um bloco so.
  const cenarios = [
    [],
    [{ currency: "BRL", expense: 0, transaction_count: 0 }],
    [{ currency: "BRL", expense: 10, transaction_count: 1 }],
    MARCO_MISTO,
    [
      { currency: "BRL", expense: 0, transaction_count: 0 },
      { currency: "USD", expense: 1, transaction_count: 1 },
    ],
  ];

  for (const linhas of cenarios) {
    assert.equal(
      periodoTemVariasMoedas(linhas, "BRL"),
      resumirPorMoeda(linhas, "BRL").length > 1,
      `discordancia em ${JSON.stringify(linhas)}`
    );
  }
});

// ---------------------------------------------------------------------------
// O seletor
// ---------------------------------------------------------------------------

test("o rotulo do seletor distingue as moedas que compartilham o $", () => {
  // So o simbolo nao basta. Sete moedas do catalogo usam alguma variacao de "$"
  // (R$, US$, C$, A$, AR$, CLP$, UY$), tres delas chamadas "Dólar" -- um seletor
  // que mostrasse so o simbolo deixaria a pessoa escolher dolar canadense
  // pensando em americano. O rotulo carrega codigo E nome por isso.
  const opcoes = opcoesDeMoeda();
  const rotulos = opcoes.map((o) => o.rotulo);

  const comDolar = opcoes.filter((o) => o.rotulo.includes("$"));
  assert.ok(comDolar.length >= 5, `esperava varias moedas com $, vi ${comDolar.length}`);

  // O que importa nao e quantas sao: e que nenhum rotulo repita outro, senao a
  // lista tem duas linhas iguais e a escolha e uma moeda ao acaso.
  assert.equal(new Set(rotulos).size, rotulos.length, "ha rotulo repetido no seletor");
  assert.equal(new Set(opcoes.map((o) => o.codigo)).size, opcoes.length);

  const dolares = rotulos.filter((r) => /[Dd]ólar/.test(r));
  assert.equal(dolares.length, 3, "USD, CAD e AUD");
  assert.ok(rotulos.includes("USD - Dólar americano (US$)"));
  assert.ok(rotulos.includes("CAD - Dólar canadense (C$)"));
});

test("todo codigo do seletor e aceito pela escrita", () => {
  // O fecho da corrente: uma opcao que o `<select>` oferece e que
  // `validarPreferenciaDeMoeda` recusa daria "erro ao salvar" numa escolha
  // legitima da lista.
  for (const opcao of opcoesDeMoeda()) {
    const r = validarPreferenciaDeMoeda({ oficial: opcao.codigo, porLancamento: false });
    assert.equal(r.ok, true, `${opcao.codigo} deveria ser aceito`);
  }
});

// ---------------------------------------------------------------------------
// A terceira copia do padrao
// ---------------------------------------------------------------------------
// `MOEDA_PADRAO` (lib/dinheiro.ts) e o DEFAULT da coluna (022) sao duas copias,
// e o teste da suite `dinheiro` cuida delas. `valoresIniciais()` em
// lib/lancamento.ts e a TERCEIRA: ela repete "BRL" como literal porque aquele
// arquivo nao pode importar nada -- `test:lancamento` o compila sozinho, sem o
// passo que reescreve o alias `@/`, e um import ali derruba a suite com
// ERR_MODULE_NOT_FOUND.
//
// Se as duas divergirem, o formulario de lancamento abre numa moeda e o banco
// grava outra quando o campo nao e mandado. Nenhum dos dois lados da erro.
test("o padrao de moeda do formulario e o mesmo de MOEDA_PADRAO", async () => {
  const { MOEDA_PADRAO } = await import("../.tmp-moeda/dinheiro.js");
  const { valoresIniciais } = await import("../.tmp-moeda/lancamento.js");

  assert.equal(valoresIniciais().moeda, MOEDA_PADRAO);
  // E a checkbox nasce desmarcada: marcada, todo lancamento abriria com o
  // seletor de moeda aberto mesmo para quem so usa uma moeda.
  assert.equal(valoresIniciais().moedaSobreposta, false);
});
