#!/usr/bin/env node
// =====================================================
// PULODOGATO - a perna do acerto de grupo (HMO-245, fase 11)
// =====================================================
// `group_settlements` existia desde a 007 sem gerar lancamento nenhum: o Pix de
// uma pessoa para a outra era invisivel nos dois lados e o saldo da conta
// corrente nao se mexia. `lib/acerto-em-lancamento.ts` decide O QUE gravar, e
// esta suite fixa as cinco coisas que erram dinheiro em silencio se mudarem:
//
//   1. O SINAL. Quem recebe soma, quem paga subtrai. `update_account_balance`
//      faz `current_balance + NEW.amount` sem olhar o tipo, entao o sinal e a
//      unica coisa que move o saldo -- invertido, o acerto afunda a conta de
//      quem acabou de receber, com o numero certo na tela toda.
//
//   2. O TIPO, NOS DOIS LADOS. `transfer` tambem em quem RECEBE. Esta e a
//      decisao com medicao atras (ver o cabecalho do modulo): com `income`, o
//      painel pessoal de quem recebe fecha o mes empatado -- income 200 /
//      expense 200 -- apagando a parte que ela mesma consumiu, porque
//      `personal_category_monthly_totals` (033) ja conta "a minha parte" das
//      despesas de grupo e ignora `transfer`.
//
//   3. `group_id` NULO. `auto_create_group_transaction` dispara em
//      `group_id IS NOT NULL AND amount < 0` e ratearia o proprio Pix entre os
//      membros: pagar a divida criaria divida nova. Medido num Postgres local --
//      2 linhas de rateio somando R$ 400 viram 4 somando R$ 600.
//
//   4. A MOEDA DA PERNA sai da CONTA escolhida, pela taxa gravada na quitacao e
//      nunca pela de hoje. Uma conta em terceira moeda e RECUSADA em vez de
//      convertida: nao ha cotacao entre euro e dolar neste caminho, e gravar o
//      numero cru poria 50 euros valendo 50 dolares no saldo.
//
//   5. CARTAO DE CREDITO e recusado. A perna cairia dentro da fatura
//      (`card_invoice_lines` le `financial_transactions` da conta de cartao),
//      inventando uma compra que ninguem fez.
//
// O que esta suite NAO prova: que a escrita acontece. Isso e
// `database/tests/hmo245_acerto_vira_lancamento_test.sql`, que mede
// `current_balance` antes e depois num Postgres de verdade.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  NOME_DA_CATEGORIA_DE_ACERTO,
  TIPO_DA_PERNA,
  chaveDoAcerto,
  contasParaOAcerto,
  descricaoDoAcerto,
  direcaoDoAcerto,
  fraseDoLancamentoDoAcerto,
  mensagemDaContaDoAcerto,
  pernaDoAcerto,
} from "../.tmp-acerto-em-lancamento/acerto-em-lancamento.js";

const ANA = "aaaaaaaa-0000-0000-0000-00000000a001";
const BIA = "bbbbbbbb-0000-0000-0000-00000000b001";
const CAIO = "cccccccc-0000-0000-0000-00000000c001";

const CONTA_BRL = { id: "conta-brl", account_type: "checking", currency: "BRL" };
const CONTA_USD = { id: "conta-usd", account_type: "checking", currency: "USD" };
const CONTA_EUR = { id: "conta-eur", account_type: "checking", currency: "EUR" };
const CARTAO = { id: "cartao", account_type: "credit_card", currency: "BRL" };

const ACERTO_EM_REAL = {
  amount: 130,
  currency: "BRL",
  exchange_rate: 1,
  settledOn: "2026-03-12",
  settlementId: "s-1",
};

// ---------------------------------------------------------------------------
// A direcao
// ---------------------------------------------------------------------------

test("quem recebe e quem paga sao reconhecidos pelos dois campos", () => {
  assert.equal(
    direcaoDoAcerto({ fromUserId: BIA, toUserId: ANA, userId: ANA }),
    "recebi"
  );
  assert.equal(
    direcaoDoAcerto({ fromUserId: BIA, toUserId: ANA, userId: BIA }),
    "paguei"
  );
});

test("quem nao e parte no pagamento nao tem direcao -- seria o botao de perdoar divida alheia", () => {
  assert.equal(
    direcaoDoAcerto({ fromUserId: BIA, toUserId: ANA, userId: CAIO }),
    null
  );
});

// ---------------------------------------------------------------------------
// 1. O sinal
// ---------------------------------------------------------------------------

test("recebendo, o valor entra POSITIVO; pagando, NEGATIVO", () => {
  const recebi = pernaDoAcerto({
    ...ACERTO_EM_REAL,
    direcao: "recebi",
    conta: CONTA_BRL,
  });
  const paguei = pernaDoAcerto({
    ...ACERTO_EM_REAL,
    direcao: "paguei",
    conta: CONTA_BRL,
  });

  assert.equal(recebi.perna.amount, 130);
  assert.equal(paguei.perna.amount, -130);

  // O par nao se anula dentro de um usuario, e isso e o desenho: as duas pernas
  // sao de PESSOAS diferentes. Somar as duas aqui e a pergunta errada -- a soma
  // que tem de fechar e a do grupo.
  assert.equal(recebi.perna.amount + paguei.perna.amount, 0);
});

// ---------------------------------------------------------------------------
// 2. O tipo, nos dois lados
// ---------------------------------------------------------------------------

test("as DUAS pernas sao `transfer` -- `income` em quem recebe apaga a parte dela no painel", () => {
  // Nao e preferencia de estilo: medido em Postgres com a cadeia 001->039, com
  // hotel de R$ 400 pago pela Ana e rateio 200/200.
  //
  //   painel pessoal da Ana    income   expense    net
  //   antes do acerto            0,00    200,00  -200,00
  //   recebendo como `income`  200,00    200,00     0,00   <- mente
  //   recebendo como `transfer`  0,00    200,00  -200,00   <- certo
  assert.equal(TIPO_DA_PERNA, "transfer");

  for (const direcao of ["recebi", "paguei"]) {
    const { perna } = pernaDoAcerto({
      ...ACERTO_EM_REAL,
      direcao,
      conta: CONTA_BRL,
    });
    assert.equal(perna.transaction_type, "transfer");
    assert.notEqual(perna.transaction_type, "income");
    assert.notEqual(perna.transaction_type, "expense");
  }
});

// ---------------------------------------------------------------------------
// 3. group_id nulo
// ---------------------------------------------------------------------------

test("`group_id` e nulo e `is_shared` e falso -- senao o trigger rateia o proprio Pix", () => {
  for (const direcao of ["recebi", "paguei"]) {
    const { perna } = pernaDoAcerto({
      ...ACERTO_EM_REAL,
      direcao,
      conta: CONTA_BRL,
    });
    assert.equal(perna.group_id, null);
    assert.equal(perna.is_shared, false);
  }
});

// ---------------------------------------------------------------------------
// 4. A moeda
// ---------------------------------------------------------------------------

test("conta em real recebe o valor em real, pela taxa GRAVADA na quitacao", () => {
  // US$ 50 a 5,35 = R$ 267,50. A taxa e a de `settled_on`, nunca a de hoje:
  // pela de hoje, o valor recebido mudaria sozinho todo dia.
  const { perna } = pernaDoAcerto({
    direcao: "recebi",
    conta: CONTA_BRL,
    amount: 50,
    currency: "USD",
    exchange_rate: 5.35,
    settledOn: "2026-03-12",
    settlementId: "s-2",
  });

  assert.equal(perna.amount, 267.5);
  assert.equal(perna.currency, "BRL");
  // O CHECK da 026 exige `(currency = 'BRL') = (exchange_rate = 1)`: mandar
  // 5.35 aqui tomaria 23514 do banco.
  assert.equal(perna.exchange_rate, 1);
});

test("conta na mesma moeda do acerto fica NA MOEDA DELA, com a taxa da quitacao", () => {
  const { perna } = pernaDoAcerto({
    direcao: "paguei",
    conta: CONTA_USD,
    amount: 50,
    currency: "USD",
    exchange_rate: 5.35,
    settledOn: "2026-03-12",
    settlementId: "s-3",
  });

  assert.equal(perna.amount, -50);
  assert.equal(perna.currency, "USD");
  assert.equal(perna.exchange_rate, 5.35);
});

test("conta numa TERCEIRA moeda e recusada, nao convertida", () => {
  const r = pernaDoAcerto({
    direcao: "paguei",
    conta: CONTA_EUR,
    amount: 50,
    currency: "USD",
    exchange_rate: 5.35,
    settledOn: "2026-03-12",
    settlementId: "s-4",
  });

  assert.equal(r.perna, undefined);
  assert.equal(r.problema, "moeda_incompativel");
  // A frase tem de dizer QUAL moeda serve, senao a pessoa nao sabe o que trocar.
  assert.match(mensagemDaContaDoAcerto(r.problema, "USD"), /USD/);
});

test("a data da perna e a do PAGAMENTO, nao a de hoje", () => {
  const { perna } = pernaDoAcerto({
    ...ACERTO_EM_REAL,
    direcao: "paguei",
    conta: CONTA_BRL,
  });
  assert.equal(perna.transaction_date, "2026-03-12");
  assert.notEqual(perna.transaction_date, new Date().toISOString().slice(0, 10));
});

// ---------------------------------------------------------------------------
// 5. Cartao de credito
// ---------------------------------------------------------------------------

test("cartao de credito e recusado -- a perna cairia dentro da fatura", () => {
  const r = pernaDoAcerto({
    ...ACERTO_EM_REAL,
    direcao: "paguei",
    conta: CARTAO,
  });
  assert.equal(r.perna, undefined);
  assert.equal(r.problema, "conta_de_cartao");
  assert.match(mensagemDaContaDoAcerto(r.problema), /cart/i);
});

test("conta ausente e recusada com a frase que manda escolher uma", () => {
  const r = pernaDoAcerto({ ...ACERTO_EM_REAL, direcao: "paguei", conta: null });
  assert.equal(r.problema, "sem_conta");
  assert.match(mensagemDaContaDoAcerto("sem_conta"), /conta/i);
});

// ---------------------------------------------------------------------------
// A chave do desfazer
// ---------------------------------------------------------------------------

test("`notes` carrega a chave do acerto -- e por ela que o desfazer acha a perna", () => {
  const { perna } = pernaDoAcerto({
    ...ACERTO_EM_REAL,
    direcao: "paguei",
    conta: CONTA_BRL,
    settlementId: "abc-123",
  });

  assert.equal(perna.notes, chaveDoAcerto("abc-123"));
  // O id tem de estar DENTRO da chave: uma chave constante faria o desfazer de
  // um acerto apagar a perna de todos os outros.
  assert.match(perna.notes, /abc-123/);
  assert.notEqual(chaveDoAcerto("abc-123"), chaveDoAcerto("abc-124"));
});

// ---------------------------------------------------------------------------
// O que a tela diz
// ---------------------------------------------------------------------------

test("a frase do dialogo distingue receber de pagar", () => {
  const formatar = (v, m) => `${m} ${v.toFixed(2)}`;

  const entra = fraseDoLancamentoDoAcerto({
    direcao: "recebi",
    valor: 130,
    moeda: "BRL",
    nomeDaConta: "Nubank",
    formatar,
  });
  const sai = fraseDoLancamentoDoAcerto({
    direcao: "paguei",
    valor: -130,
    moeda: "BRL",
    nomeDaConta: "Nubank",
    formatar,
  });

  assert.notEqual(entra, sai);
  assert.match(entra, /Entra/);
  assert.match(sai, /Sai/);
  // O nome da conta aparece nas duas: "entra R$ 130" sem dizer ONDE nao
  // distingue a conta certa da errada.
  assert.match(entra, /Nubank/);
  assert.match(sai, /Nubank/);
  // O sinal nao vaza para o texto: quem paga ja le "Sai".
  assert.doesNotMatch(sai, /-130/);
});

test("a descricao diz o nome de quem esta do outro lado, e o lado certo", () => {
  const recebi = descricaoDoAcerto({
    direcao: "recebi",
    nomeDaContraparte: "Bia",
    nomeDoGrupo: "Viagem",
  });
  const paguei = descricaoDoAcerto({
    direcao: "paguei",
    nomeDaContraparte: "Bia",
    nomeDoGrupo: "Viagem",
  });

  assert.match(recebi, /Bia/);
  assert.match(recebi, /Viagem/);
  assert.notEqual(recebi, paguei);
  // Sem nome a frase continua inteira: os nomes vem de uma consulta que pode
  // falhar, e uma descricao vazia no extrato seria pior.
  assert.ok(descricaoDoAcerto({ direcao: "recebi" }).length > 0);
});

// ---------------------------------------------------------------------------
// A lista do seletor e a regra do servidor sao a MESMA
// ---------------------------------------------------------------------------

test("o seletor oferece exatamente as contas que a rota aceita", () => {
  const todas = [CONTA_BRL, CONTA_USD, CONTA_EUR, CARTAO];

  const paraUSD = contasParaOAcerto(todas, "USD");
  assert.deepEqual(
    paraUSD.map((c) => c.id),
    ["conta-brl", "conta-usd"]
  );

  // Controle: a lista nao e so "tudo menos cartao". Num acerto em real, a conta
  // em dolar tambem sai -- pagar R$ 130 de uma conta em dolar exigiria uma
  // cotacao que ninguem informou.
  const paraBRL = contasParaOAcerto(todas, "BRL");
  assert.deepEqual(
    paraBRL.map((c) => c.id),
    ["conta-brl"]
  );

  // E o que o seletor oferece, `pernaDoAcerto` aceita. Divergir faria a tela
  // oferecer uma opcao que o POST recusa com 400.
  for (const conta of paraUSD) {
    const r = pernaDoAcerto({
      direcao: "paguei",
      conta,
      amount: 50,
      currency: "USD",
      exchange_rate: 5.35,
      settledOn: "2026-03-12",
      settlementId: "s-5",
    });
    assert.ok(r.perna, `a rota recusou ${conta.id}, que o seletor ofereceu`);
  }
});

test("a categoria reservada tem nome estavel -- a linha nasce por usuario, sem migration", () => {
  assert.equal(NOME_DA_CATEGORIA_DE_ACERTO, "Acerto de grupo");
});
