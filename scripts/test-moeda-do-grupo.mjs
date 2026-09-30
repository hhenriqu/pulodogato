#!/usr/bin/env node
// =====================================================
// PULODOGATO - a moeda da viagem na tela do grupo (HMO-182, itens 3/4/5)
// =====================================================
// A migration 026 separou duas coisas que a tela do grupo mistura com
// facilidade, e a separacao e o que esta suite protege:
//
//   `group_member_balances.amount_currency` = 'BRL'    <- o numero que VALE
//   `group_member_balances.group_currency`  = 'USD'    <- a moeda em que se FALA
//
// O saldo e em real porque cada despesa foi convertida pela cotacao do dia DELA,
// congelada. A moeda da viagem serve para a tela escrever o mesmo saldo em
// dolar, ao cambio de HOJE, dizendo que e de hoje. As duas conversoes usam
// cotacoes diferentes e uma delas nao pode invadir a outra.
//
// O QUE ESTA SUITE OLHA COM MAIS CUIDADO
// --------------------------------------
//   1. a conversao de apresentacao DIVIDE. Multiplicar da um numero 28 vezes
//      maior num grupo em dolar, e erra para cima -- o lado que faz alguem
//      pagar a mais;
//   2. o rotulo DIZ que a cotacao e de hoje e NAO diz que e a da compra. Um
//      valor convertido sem eixo de tempo afirma algo falso: amanha o mesmo
//      saldo da outro numero sem ninguem ter gastado nada;
//   3. `null` quando nao ha cotacao, nunca 1. A taxa 1 numa moeda estrangeira e
//      o valor que o CHECK da 026 proibe, e e o unico numero capaz de fazer a
//      conversao sair identica ao BRL sem ninguem notar;
//   4. a sobra de centavo do acerto em moeda estrangeira e DEVOLVIDA, nao
//      escondida numa cotacao calculada de tras para frente;
//   5. a tolerancia de um centavo daqui e a MESMA de `simplifySettlements`. Se
//      divergirem, a tela avisa de uma sobra que a lista de sugestoes nao tem.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  acertoNaMoedaDaViagem,
  avisoDeSobra,
  avisoSemConversao,
  moedaDaViagem,
  moedaDoGrupoParaGravar,
  moedaSugeridaDaDespesa,
  rotuloDaConversao,
  saldoNaMoedaDaViagem,
} from "../.tmp-moeda-do-grupo/moeda-do-grupo.js";

import { simplifySettlements } from "../.tmp-moeda-do-grupo/settlement.js";

// A PTAX de um dia util real, para os numeros dos testes serem conferiveis a
// mao: R$ 267,50 / 5,35 = US$ 50,00 exato.
const USD = 5.35;

// -----------------------------------------------------------------------------
// moedaDaViagem: leitura tolerante
// -----------------------------------------------------------------------------

test("moedaDaViagem: codigo conhecido passa, em maiusculas", () => {
  assert.equal(moedaDaViagem("USD"), "USD");
  assert.equal(moedaDaViagem(" usd "), "USD");
});

test("moedaDaViagem: ausencia e codigo estranho caem em BRL", () => {
  // BRL nao e um palpite: e o denominador REAL do saldo, porque a view devolve
  // BRL. Cair nele desliga a apresentacao na moeda da viagem em vez de escrever
  // "R$" na frente de um numero em dolar.
  assert.equal(moedaDaViagem(null), "BRL");
  assert.equal(moedaDaViagem(undefined), "BRL");
  assert.equal(moedaDaViagem(""), "BRL");
  assert.equal(moedaDaViagem("CZK"), "BRL");
});

// -----------------------------------------------------------------------------
// moedaDoGrupoParaGravar: a ESCRITA e mais rigorosa que a leitura
// -----------------------------------------------------------------------------

test("moedaDoGrupoParaGravar: campo ausente vira BRL, e nao recusa", () => {
  // Um cliente antigo que nao manda `currency` continua criando grupo, e o
  // grupo dele e em real -- o DEFAULT da coluna e o que sempre foi verdade.
  assert.equal(moedaDoGrupoParaGravar(undefined), "BRL");
  assert.equal(moedaDoGrupoParaGravar(null), "BRL");
  assert.equal(moedaDoGrupoParaGravar(""), "BRL");
});

test("moedaDoGrupoParaGravar: codigo fora do catalogo e RECUSADO", () => {
  // Aqui a diferenca com moedaDaViagem importa: gravar BRL quando alguem pediu
  // CZK criaria um grupo em real sem que ninguem tenha escolhido real.
  assert.equal(moedaDoGrupoParaGravar("CZK"), null);
  assert.equal(moedaDoGrupoParaGravar("usdd"), null);
  assert.equal(moedaDoGrupoParaGravar(42), null);
  assert.equal(moedaDoGrupoParaGravar({ codigo: "USD" }), null);
});

test("moedaDoGrupoParaGravar: aceita as 13 do catalogo, nas duas caixas", () => {
  for (const c of ["BRL", "USD", "EUR", "GBP", "CHF", "CAD", "AUD", "ARS", "CLP", "UYU", "PYG", "JPY", "CNY"]) {
    assert.equal(moedaDoGrupoParaGravar(c), c, `${c} deveria ser aceita`);
    assert.equal(moedaDoGrupoParaGravar(c.toLowerCase()), c);
  }
});

// -----------------------------------------------------------------------------
// saldoNaMoedaDaViagem: a conversao de APRESENTACAO
// -----------------------------------------------------------------------------

test("saldoNaMoedaDaViagem: DIVIDE pela cotacao, e o resultado e conferivel a mao", () => {
  const r = saldoNaMoedaDaViagem(-267.5, "USD", USD);

  assert.equal(r.brl, -267.5);
  assert.equal(r.moeda, "USD");
  assert.equal(r.naMoedaDaViagem, -50);
  assert.equal(r.taxaDeHoje, USD);
  assert.equal(r.motivo, null);
});

test("saldoNaMoedaDaViagem: multiplicar seria 28x maior -- o mutante mais provavel", () => {
  // Esta assercao existe para matar a troca de `/` por `*`. Sem ela, um saldo
  // pequeno passaria os outros testes: -1 daria -0.19 ou -5.35, os dois
  // "plausiveis" numa tela.
  const r = saldoNaMoedaDaViagem(-267.5, "USD", USD);
  assert.notEqual(r.naMoedaDaViagem, -267.5 * USD);
  assert.ok(
    Math.abs(r.naMoedaDaViagem) < Math.abs(r.brl),
    "o dolar vale mais que o real: o numero em dolar TEM que ser menor"
  );
});

test("saldoNaMoedaDaViagem: o sinal sobrevive nas duas direcoes", () => {
  // A tela escolhe "Deve pagar"/"A receber" pelo sinal. Um Math.abs aqui faria
  // todo devedor aparecer como credor na moeda da viagem, com o numero em real
  // certo ao lado.
  assert.ok(saldoNaMoedaDaViagem(-267.5, "USD", USD).naMoedaDaViagem < 0);
  assert.ok(saldoNaMoedaDaViagem(267.5, "USD", USD).naMoedaDaViagem > 0);
  assert.equal(saldoNaMoedaDaViagem(0, "USD", USD).naMoedaDaViagem, 0);
});

test("saldoNaMoedaDaViagem: viagem em real nao converte, e diz por que", () => {
  const r = saldoNaMoedaDaViagem(-267.5, "BRL", 1);
  assert.equal(r.naMoedaDaViagem, null);
  assert.equal(r.taxaDeHoje, null);
  assert.equal(r.motivo, "mesma_moeda");
  // E nao e um erro: nao ha aviso a dar.
  assert.equal(avisoSemConversao(r), null);
});

test("saldoNaMoedaDaViagem: sem cotacao devolve null, NUNCA 1", () => {
  // O `null` e o contrato de lib/cambio.ts e a razao dele esta escrita la: 1 e
  // justamente o valor que o CHECK da 026 proibe para moeda estrangeira. Se
  // esta funcao devolvesse 1 "para o campo nao ficar vazio", US$ 267,50
  // apareceria como a divida de R$ 267,50.
  for (const taxa of [null, undefined, 0, -5.35, Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = saldoNaMoedaDaViagem(-267.5, "USD", taxa);
    assert.equal(r.naMoedaDaViagem, null, `taxa ${taxa} nao deveria converter`);
    assert.equal(r.taxaDeHoje, null);
    assert.equal(r.motivo, "sem_cotacao");
    // O numero que vale continua na resposta: a tela nao fica sem saldo.
    assert.equal(r.brl, -267.5);
  }
});

test("saldoNaMoedaDaViagem: taxa 1 numa moeda estrangeira e recusada", () => {
  // Este e o caso que o CHECK da 026 proibe no banco, e o unico em que a
  // conversao sai IGUAL ao BRL -- ou seja, o unico que nao tem sintoma visivel.
  const r = saldoNaMoedaDaViagem(-267.5, "USD", 1);
  assert.equal(r.naMoedaDaViagem, null);
  assert.equal(r.motivo, "sem_cotacao");
});

test("saldoNaMoedaDaViagem: moeda sem casas decimais arredonda para inteiro", () => {
  // Iene tem zero casas (lib/dinheiro.ts). "¥ 1.234,56" nao existe.
  const r = saldoNaMoedaDaViagem(-1000, "JPY", 0.037);
  assert.equal(r.naMoedaDaViagem, Math.round(-1000 / 0.037));
  assert.equal(r.naMoedaDaViagem, -27027);
});

test("saldoNaMoedaDaViagem: moeda que a PTAX nao cobre converte se a taxa vier", () => {
  // ARS/CLP/UYU/PYG/CNY nao tem PTAX (lib/cambio.ts), entao na pratica a taxa
  // chega `null` e cai em "sem_cotacao". Mas a funcao nao e quem decide isso: se
  // alguem digitar a cotacao, a conversao e valida. Confundir "a PTAX nao
  // publica" com "nao da para converter" tiraria a apresentacao de quem digitou
  // a cotacao na mao.
  const r = saldoNaMoedaDaViagem(-100, "ARS", 0.0052);
  assert.equal(r.motivo, null);
  assert.equal(r.naMoedaDaViagem, Math.round((-100 / 0.0052) * 100) / 100);
});

// -----------------------------------------------------------------------------
// rotuloDaConversao: o eixo de tempo, que e o que torna a frase verdadeira
// -----------------------------------------------------------------------------

test("rotuloDaConversao: diz que e de HOJE, com a data", () => {
  const r = saldoNaMoedaDaViagem(-267.5, "USD", USD);
  const rotulo = rotuloDaConversao(r, "2026-09-30");

  assert.ok(rotulo, "deveria haver rotulo quando houve conversao");
  assert.match(rotulo, /hoje/i);
  assert.match(rotulo, /30\/09\/2026/);
});

test("rotuloDaConversao: NAO afirma ser a cotacao da compra, e repete o valor em real", () => {
  // A negacao explicita: sem ela, "US$ 50,00 · 30/09/2026" passaria em todas as
  // assercoes acima e continuaria parecendo o valor gasto na viagem de marco.
  const r = saldoNaMoedaDaViagem(-267.5, "USD", USD);
  const rotulo = rotuloDaConversao(r, "2026-09-30");

  assert.doesNotMatch(rotulo, /compra|lançamento|lancamento|gasto/i);
  // E a frase tem de trazer o numero que VALE, nao so o convertido.
  assert.match(rotulo, /R\$ 267,50/);
  assert.match(rotulo, /não muda/);
});

test("rotuloDaConversao: sem conversao nao ha rotulo", () => {
  assert.equal(
    rotuloDaConversao(saldoNaMoedaDaViagem(-267.5, "BRL", 1), "2026-09-30"),
    null
  );
  assert.equal(
    rotuloDaConversao(saldoNaMoedaDaViagem(-267.5, "USD", null), "2026-09-30"),
    null
  );
});

test("avisoSemConversao: separa 'nao consegui a cotacao' de 'e em real'", () => {
  const semTaxa = saldoNaMoedaDaViagem(-267.5, "USD", null);
  const aviso = avisoSemConversao(semTaxa);
  assert.ok(aviso);
  assert.match(aviso, /USD/);
  assert.match(aviso, /reais/);

  // Viagem em real nao e falha nenhuma: avisar seria inventar um problema.
  assert.equal(avisoSemConversao(saldoNaMoedaDaViagem(-267.5, "BRL", 1)), null);
});

// -----------------------------------------------------------------------------
// acertoNaMoedaDaViagem: o que vai para o POST de group_settlements
// -----------------------------------------------------------------------------

test("acerto em real: cotacao 1, e nao sobra nada", () => {
  const a = acertoNaMoedaDaViagem(267.5, "BRL", 1);
  assert.deepEqual(a, {
    amount: 267.5,
    currency: "BRL",
    exchange_rate: 1,
    abateEmBRL: 267.5,
    sobraEmBRL: 0,
  });
});

test("acerto em real ignora a cotacao que vier junto", () => {
  // A mesma rudeza de `taxaParaGravar`: BRL com cotacao 1,05 e a linha que o
  // banco recusa, com um erro que a pessoa nao associa a campo nenhum.
  const a = acertoNaMoedaDaViagem(100, "BRL", 5.35);
  assert.equal(a.exchange_rate, 1);
  assert.equal(a.currency, "BRL");
});

test("acerto em dolar: o payload obedece ao CHECK da 026", () => {
  const a = acertoNaMoedaDaViagem(267.5, "USD", USD);

  assert.equal(a.currency, "USD");
  assert.equal(a.amount, 50);
  assert.equal(a.exchange_rate, USD);
  // A regra do CHECK: cotacao 1 se e somente se BRL.
  assert.equal((a.currency === "BRL") === (a.exchange_rate === 1), true);
  // E `amount` esta na MOEDA, nao em real: mandar 267.5 com cotacao 5.35
  // abateria R$ 1.431,13.
  assert.notEqual(a.amount, 267.5);
  assert.equal(a.abateEmBRL, 267.5);
  assert.equal(a.sobraEmBRL, 0);
});

test("acerto em dolar: a sobra de centavo e DEVOLVIDA, nao escondida", () => {
  // R$ 267,53 / 5,35 = US$ 50,0056 -> US$ 50,01 em centavos de dolar.
  // 50,01 * 5,35 = R$ 267,5535 -> R$ 267,55. Paga-se R$ 0,02 a MAIS.
  const a = acertoNaMoedaDaViagem(267.53, "USD", USD);

  assert.equal(a.amount, 50.01);
  assert.equal(a.abateEmBRL, 267.55);
  assert.equal(a.sobraEmBRL, -0.02);

  // A cotacao gravada e a REAL, e nao `divida / amount` -- que daria
  // 5.349730... e fecharia exato mentindo sobre o mundo.
  assert.equal(a.exchange_rate, USD);
  assert.notEqual(a.exchange_rate, 267.53 / a.amount);

  const aviso = avisoDeSobra(a);
  assert.ok(aviso, "sobra de 2 centavos tem que ser avisada antes de registrar");
  assert.match(aviso, /a mais/);
});

test("avisoDeSobra: a tolerancia e a MESMA de simplifySettlements", () => {
  // Controle positivo do acoplamento. `simplifySettlements` nao gera sugestao
  // para saldo de 1 centavo; entao `avisoDeSobra` nao pode avisar de 1 centavo.
  // Se um dos dois mudar sozinho, a tela avisa de uma sobra que nao esta na
  // lista, ou deixa de avisar de uma que esta.
  const semSugestao = simplifySettlements([
    { user_id: "a", net_balance: -0.01 },
    { user_id: "b", net_balance: 0.01 },
  ]);
  assert.equal(semSugestao.length, 0, "1 centavo nao virou sugestao");

  assert.equal(
    avisoDeSobra({ amount: 1, currency: "USD", exchange_rate: USD, abateEmBRL: 5.35, sobraEmBRL: 0.01 }),
    null,
    "1 centavo de sobra nao deve ser avisado"
  );
  assert.ok(
    avisoDeSobra({ amount: 1, currency: "USD", exchange_rate: USD, abateEmBRL: 5.35, sobraEmBRL: 0.02 }),
    "2 centavos de sobra deve ser avisado"
  );

  const comSugestao = simplifySettlements([
    { user_id: "a", net_balance: -0.02 },
    { user_id: "b", net_balance: 0.02 },
  ]);
  assert.equal(comSugestao.length, 1, "2 centavos virou sugestao");
});

test("acerto: sem cotacao NAO ha payload -- e o que segura o 23514", () => {
  // Sem este `null`, o caminho da moeda estrangeira mandaria cotacao 1 e o banco
  // devolveria 23514 na cara de quem esta registrando o pagamento.
  for (const taxa of [null, undefined, 0, -1, 1, Number.NaN]) {
    assert.equal(
      acertoNaMoedaDaViagem(267.5, "USD", taxa),
      null,
      `taxa ${taxa} nao deveria gerar payload`
    );
  }
});

test("acerto: divida zero ou negativa nao gera payload", () => {
  // O CHECK da 007 exige `amount > 0`, e um acerto de zero nao e um acerto.
  assert.equal(acertoNaMoedaDaViagem(0, "BRL", 1), null);
  assert.equal(acertoNaMoedaDaViagem(-10, "USD", USD), null);
});

test("acerto: divida que arredonda para zero na moeda cai fora", () => {
  // Guarani tem zero casas e vale ~R$ 0,00073: uma divida de R$ 0,50 daria
  // 684 guaranis, mas uma divida de R$ 0,0004 em iene daria 0 -- e `amount = 0`
  // e recusado pelo CHECK da 007. Devolver null manda a tela oferecer o
  // pagamento em real, o unico que representa aquela divida.
  assert.equal(acertoNaMoedaDaViagem(0.01, "JPY", 100), null);
  assert.ok(acertoNaMoedaDaViagem(0.5, "PYG", 0.00073));
});

// -----------------------------------------------------------------------------
// moedaSugeridaDaDespesa: item 3, "a moeda SUGERIDA a cada despesa"
// -----------------------------------------------------------------------------

test("moedaSugeridaDaDespesa: dentro do grupo, a viagem ganha da conta", () => {
  // Na viagem a despesa e na moeda do lugar; a conta usada e um detalhe de como
  // se pagou.
  assert.equal(moedaSugeridaDaDespesa("USD", "BRL"), "USD");
  assert.equal(moedaSugeridaDaDespesa("EUR", "USD"), "EUR");
});

test("moedaSugeridaDaDespesa: grupo em real devolve a moeda da CONTA", () => {
  // Grupo em real nao e uma escolha de moeda: e o default de todo grupo que ja
  // existia. Sobrepor a conda em dolar aqui reverteria a regra da 022 para todo
  // grupo antigo.
  assert.equal(moedaSugeridaDaDespesa("BRL", "USD"), "USD");
  assert.equal(moedaSugeridaDaDespesa(null, "USD"), "USD");
  assert.equal(moedaSugeridaDaDespesa("BRL", null), "BRL");
  assert.equal(moedaSugeridaDaDespesa(null, "CZK"), "BRL");
});

// -----------------------------------------------------------------------------
// A conta inteira, de ponta a ponta: uma viagem em dolar
// -----------------------------------------------------------------------------

test("caminho completo: jantar de US$ 180 em marco, acerto em setembro", () => {
  // O jantar foi pago a 5,10 em marco e gravado assim -- congelado. Em setembro
  // o dolar esta a 5,35. Duas pessoas no grupo.
  const jantarEmBRL = Math.round(180 * 5.1 * 100) / 100; // R$ 918,00
  assert.equal(jantarEmBRL, 918);

  // Quem nao pagou deve metade: a view faz `es.amount * t.exchange_rate`, ou
  // seja 90 * 5,10 = R$ 459,00. Na cotacao de HOJE isso daria 90 * 5,35 =
  // R$ 481,50 -- R$ 22,50 que ninguem gastou. E por isso que a cotacao da
  // compra e congelada.
  const devoEmBRL = -459;
  assert.notEqual(devoEmBRL, -(90 * 5.35));

  // A tela apresenta em dolar, ao cambio de hoje.
  const apresentado = saldoNaMoedaDaViagem(devoEmBRL, "USD", USD);
  assert.equal(apresentado.brl, -459);
  assert.equal(apresentado.naMoedaDaViagem, Math.round((-459 / 5.35) * 100) / 100);
  assert.equal(apresentado.naMoedaDaViagem, -85.79);

  // Repare: NAO e US$ 90. Os US$ 90 de marco custaram R$ 459 e hoje esses
  // R$ 459 compram menos dolar. O valor do passado nao mudou -- a divida
  // continua sendo R$ 459,00 -- mas quem for pagar em dolar hoje paga 85,79.
  assert.notEqual(apresentado.naMoedaDaViagem, -90);

  // E o acerto, pago em dolar hoje.
  const acerto = acertoNaMoedaDaViagem(459, "USD", USD);
  assert.equal(acerto.amount, 85.79);
  assert.equal(acerto.currency, "USD");
  assert.equal(acerto.exchange_rate, 5.35);
  // O que a view vai somar: 85,79 * 5,35 = R$ 458,98. Sobram 2 centavos, e a
  // tela diz isso antes de registrar.
  assert.equal(acerto.abateEmBRL, 458.98);
  assert.equal(acerto.sobraEmBRL, 0.02);
  assert.match(avisoDeSobra(acerto), /em aberto/);
});
