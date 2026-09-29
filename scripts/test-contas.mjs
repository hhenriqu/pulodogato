#!/usr/bin/env node
// =====================================================
// PULODOGATO - conta tem saldo, cartao tem fatura (HMO-166)
// =====================================================
// As REGRAS do corte. A arvore de cada tela tem suite propria
// (test-campos-da-conta.mjs), e ela nao alcanca nada do que esta aqui: o que
// vai `null` para o banco e o que entra em cada total nao aparecem no HTML.
//
// O TESTE QUE IMPORTA MAIS E O DE CONSERVACAO
// -------------------------------------------
// Separar a tela nao pode mover um centavo de lugar. A tela unica somava
//
//     if (conta.account_type === "credit_card") fatura += Math.abs(valor);
//     else saldo += valor;
//
// sobre a lista INTEIRA. Agora sao duas telas, cada uma somando a sua metade.
// Se o catalogo de escopos e a soma discordarem -- um tipo que saiu de Contas
// sem entrar em Cartoes, por exemplo -- o dinheiro desaparece de uma tela sem
// aparecer na outra, e ninguem procura um total que sumiu de uma tela que a
// pessoa nao abriu. Por isso o oraculo aqui e a formula ANTIGA, escrita a mao.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  TIPOS_DE_CONTA,
  camposDoEscopo,
  contasDoEscopo,
  corpoDaConta,
  escopoDoTipo,
  faltaFatura,
  porTipo,
  tipoPadraoDoEscopo,
  tiposDoEscopo,
  totalDoEscopo,
  validarConta,
  valoresDaConta,
  valoresIniciais,
} from "../.tmp-contas/lib/contas.js";

/** Os oito valores do ENUM `account_type`, escritos a mao de proposito. */
const TODOS_OS_TIPOS = [
  "checking",
  "savings",
  "credit_card",
  "debit_card",
  "cash",
  "digital",
  "investment",
  "other",
];

const conta = (account_type, current_balance = 0, extra = {}) => ({
  account_type,
  current_balance,
  ...extra,
});

// ---------------------------------------------------------------------------
// O CATALOGO
// ---------------------------------------------------------------------------

test("os oito tipos do ENUM estao no catalogo, cada um com uma tela", () => {
  assert.deepEqual(
    TIPOS_DE_CONTA.map((t) => t.valor).sort(),
    [...TODOS_OS_TIPOS].sort(),
    "o catalogo divergiu do ENUM account_type -- um tipo sem tela nao se cadastra e nao se lista"
  );

  for (const tipo of TODOS_OS_TIPOS) {
    const escopo = escopoDoTipo(tipo);
    assert.ok(
      escopo === "conta" || escopo === "cartao",
      `${tipo} ficou sem escopo`
    );
  }
});

test("so o cartao de credito tem fatura", () => {
  const comFatura = TODOS_OS_TIPOS.filter((t) => escopoDoTipo(t) === "cartao");
  assert.deepEqual(
    comFatura,
    ["credit_card"],
    "algum tipo sem fatura foi parar na tela de Cartoes -- ele ganharia limite, fechamento e vencimento que nao existem para ele"
  );
});

test("cartao de debito e conta: ele tem saldo, nao fatura", () => {
  // A decisao da issue, e o unico lugar que a afirma. Se ela for revista, este
  // teste e o que tem que ser editado junto -- e e de propositio que doi um
  // pouco: o tipo aparece em dois totais diferentes conforme a resposta.
  assert.equal(escopoDoTipo("debit_card"), "conta");
});

test("tipo desconhecido cai em Outra, e nao derruba a tela", () => {
  // Uma linha gravada por um caminho que nao passou pelo catalogo nao pode
  // virar `undefined.rotulo` no meio da lista.
  assert.equal(porTipo("tipo_que_nao_existe").rotulo, "Outra");
  assert.equal(escopoDoTipo("tipo_que_nao_existe"), "conta");
});

test("cada tela oferece so os seus tipos", () => {
  assert.deepEqual(
    tiposDoEscopo("cartao").map((t) => t.valor),
    ["credit_card"]
  );

  const deConta = tiposDoEscopo("conta").map((t) => t.valor);
  assert.ok(
    !deConta.includes("credit_card"),
    "o seletor de Contas voltou a oferecer cartao de credito"
  );
  assert.equal(
    deConta.length + 1,
    TODOS_OS_TIPOS.length,
    "algum tipo sumiu dos dois seletores"
  );
});

test("a tela de Cartoes cria cartao de credito sem precisar de seletor", () => {
  assert.equal(tipoPadraoDoEscopo("cartao"), "credit_card");
  assert.equal(valoresIniciais("cartao").account_type, "credit_card");
  assert.equal(valoresIniciais("conta").account_type, "checking");
});

// ---------------------------------------------------------------------------
// OS CAMPOS
// ---------------------------------------------------------------------------

test("Contas nao tem os campos de fatura; Cartoes tem", () => {
  // A issue em duas linhas. O teste de renderizacao prova que o JSX obedece.
  assert.equal(camposDoEscopo("conta").fatura, false);
  assert.equal(camposDoEscopo("cartao").fatura, true);
});

test("o seletor de tipo so existe onde ha mais de um tipo", () => {
  assert.equal(camposDoEscopo("conta").tipo, true);
  assert.equal(camposDoEscopo("cartao").tipo, false);
});

// ---------------------------------------------------------------------------
// O CORTE DA LISTA
// ---------------------------------------------------------------------------

test("cada tela lista so o que e dela, e nada fica de fora das duas", () => {
  const todas = TODOS_OS_TIPOS.map((t) => conta(t));
  const contas = contasDoEscopo(todas, "conta");
  const cartoes = contasDoEscopo(todas, "cartao");

  assert.equal(contas.length + cartoes.length, todas.length);
  assert.deepEqual(
    cartoes.map((c) => c.account_type),
    ["credit_card"]
  );
  assert.ok(
    contas.some((c) => c.account_type === "debit_card"),
    "o cartao de debito sumiu da tela de Contas"
  );
});

// ---------------------------------------------------------------------------
// OS TOTAIS: A SEPARACAO NAO MOVE DINHEIRO
// ---------------------------------------------------------------------------

/** A formula da tela unica, antes do corte. Escrita a mao, e e o oraculo. */
function totaisDaTelaAntiga(contas) {
  let saldo = 0;
  let fatura = 0;
  for (const c of contas) {
    const valor = Number(c.current_balance ?? 0);
    if (c.account_type === "credit_card") fatura += Math.abs(valor);
    else saldo += valor;
  }
  return { saldo, fatura };
}

test("as duas telas somadas dao exatamente o que a tela unica somava", () => {
  const carteira = [
    conta("checking", 2500.75),
    conta("savings", 10000),
    conta("cash", 130.4),
    conta("digital", 89.9),
    conta("investment", 4200),
    conta("debit_card", 0),
    conta("other", -15.5),
    // No vermelho: tem que PUXAR o saldo para baixo, e nao entrar em modulo.
    conta("checking", -320.1),
    // Cartao guarda o gasto como negativo -- ver a convencao de sinal do app.
    conta("credit_card", -1200.35),
    conta("credit_card", -80),
  ];

  const antigo = totaisDaTelaAntiga(carteira);

  assert.equal(totalDoEscopo(carteira, "conta"), antigo.saldo);
  assert.equal(totalDoEscopo(carteira, "cartao"), antigo.fatura);
});

test("conta no vermelho baixa o total de Contas", () => {
  const so = [conta("checking", -500)];
  assert.equal(totalDoEscopo(so, "conta"), -500);
});

test("a fatura e somada como divida, sem o sinal", () => {
  const cartoes = [conta("credit_card", -1200), conta("credit_card", -300)];
  assert.equal(totalDoEscopo(cartoes, "cartao"), 1500);
});

test("cada total ignora a lista da outra tela", () => {
  const carteira = [conta("checking", 1000), conta("credit_card", -400)];
  assert.equal(totalDoEscopo(carteira, "conta"), 1000);
  assert.equal(totalDoEscopo(carteira, "cartao"), 400);
});

// ---------------------------------------------------------------------------
// O AVISO DE FATURA INCOMPLETA
// ---------------------------------------------------------------------------

test("cartao sem os dois dias nao fecha fatura, e a tela diz", () => {
  assert.equal(faltaFatura(conta("credit_card", 0, {})), true);
  assert.equal(
    faltaFatura(conta("credit_card", 0, { closing_day: 10 })),
    true,
    "so o fechamento nao basta: sem vencimento a fatura nao vira conta a pagar"
  );
  assert.equal(
    faltaFatura(conta("credit_card", 0, { due_day: 20 })),
    true
  );
  assert.equal(
    faltaFatura(conta("credit_card", 0, { closing_day: 10, due_day: 20 })),
    false
  );
});

test("conta nenhuma cobra dia de fatura", () => {
  // Sem isto, a tela de Contas ganharia uma tarja amarela em toda conta
  // corrente cobrando dois dias que ela nunca vai ter.
  for (const tipo of TODOS_OS_TIPOS.filter((t) => t !== "credit_card")) {
    assert.equal(
      faltaFatura(conta(tipo, 0, {})),
      false,
      `${tipo} passou a cobrar fechamento e vencimento`
    );
  }
});

// ---------------------------------------------------------------------------
// O QUE VAI PARA O BANCO
// ---------------------------------------------------------------------------

const preenchido = {
  name: "  Nubank  ",
  account_type: "credit_card",
  bank_name: "  Nu  ",
  last_four_digits: " 1234 ",
  credit_limit: "5000",
  closing_day: "10",
  due_day: "20",
};

test("cartao grava limite, fechamento e vencimento", () => {
  const corpo = corpoDaConta(preenchido, "cartao");
  assert.equal(corpo.credit_limit, "5000");
  assert.equal(corpo.closing_day, "10");
  assert.equal(corpo.due_day, "20");
  assert.equal(corpo.name, "Nubank", "o nome foi gravado com os espacos");
  assert.equal(corpo.bank_name, "Nu");
  assert.equal(corpo.last_four_digits, "1234");
});

test("conta grava NULL nos tres campos de fatura", () => {
  // O que nao pode se perder no corte, e o que se perde calado: um dia de
  // fechamento sobrando numa conta corrente fica no banco sem nada que o leia
  // e sem nada que o denuncie.
  //
  // `credit_limit` esta aqui porque a tela ANTIGA o mandava sempre, mesmo
  // quando o tipo nao era cartao: dava para gravar limite numa conta corrente
  // digitando o valor com o tipo em "Cartao de credito" e trocando o tipo
  // depois de digitar.
  const corpo = corpoDaConta({ ...preenchido, account_type: "checking" }, "conta");
  assert.equal(corpo.credit_limit, null);
  assert.equal(corpo.closing_day, null);
  assert.equal(corpo.due_day, null);
});

test("campo de fatura vazio vira NULL, e nao string vazia", () => {
  // `""` num inteiro e um 500 com codigo 22P02, nao um campo em branco.
  const corpo = corpoDaConta(
    { ...preenchido, credit_limit: "", closing_day: "", due_day: "" },
    "cartao"
  );
  assert.equal(corpo.credit_limit, null);
  assert.equal(corpo.closing_day, null);
  assert.equal(corpo.due_day, null);
});

// ---------------------------------------------------------------------------
// O QUE IMPEDE O ENVIO
// ---------------------------------------------------------------------------

test("sem nome nao envia, e a frase sabe do que esta falando", () => {
  const vazio = { ...preenchido, name: "   " };
  assert.match(validarConta(vazio, "conta"), /a conta/);
  assert.match(validarConta(vazio, "cartao"), /o cartão/);
});

test("dia fora de 1 a 31 para antes do banco", () => {
  // O CHECK existe no banco; o 500 com codigo 23514 nao diz nada para quem
  // digitou 32.
  for (const dia of ["0", "32", "-1", "10.5", "abc"]) {
    assert.match(
      validarConta({ ...preenchido, closing_day: dia }, "cartao") ?? "",
      /fechamento/,
      `o dia de fechamento "${dia}" passou`
    );
    assert.match(
      validarConta({ ...preenchido, due_day: dia }, "cartao") ?? "",
      /vencimento/,
      `o dia de vencimento "${dia}" passou`
    );
  }

  assert.equal(validarConta({ ...preenchido, closing_day: "1" }, "cartao"), null);
  assert.equal(validarConta({ ...preenchido, closing_day: "31" }, "cartao"), null);
});

test("cartao sem os dias e valido: da para cadastrar antes de saber", () => {
  // O aviso na tela e tarja, nao bloqueio. Quem acabou de pedir o cartao ainda
  // nao recebeu a fatura que diz os dias.
  assert.equal(
    validarConta(
      { ...preenchido, credit_limit: "", closing_day: "", due_day: "" },
      "cartao"
    ),
    null
  );
});

// ---------------------------------------------------------------------------
// O CARTAO CRIADO PELA TELA NOVA AINDA FECHA FATURA
// ---------------------------------------------------------------------------
// O segundo pedido da issue. `POST /api/card-invoices/close` recusa o cartao em
// dois pontos, e os dois dependem so do que ESTA TELA gravou:
//
//   1. `if (cartao.account_type !== "credit_card")` -> 400
//   2. `if (!cartao.due_day)` -> 400
//
// e as linhas da fatura saem da view `card_invoice_lines`, que agrupa pelo
// `card_invoice_month()` da migration 006 -- e ele precisa do `closing_day`
// para saber a qual mes a compra pertence.
//
// O teste e estatico de proposito: ele afirma sobre o CORPO que a tela manda,
// que e a fronteira que o corte de tela mexeu. O comportamento da rota em si
// tem as suites de card-invoice.

test("o corpo que a tela de Cartoes manda passa pelas guardas do close", () => {
  const corpo = corpoDaConta(preenchido, "cartao");

  assert.equal(
    corpo.account_type,
    "credit_card",
    "a tela nao tem seletor de tipo: se o padrao do escopo errar, o cartao nasce como conta e o close devolve 400"
  );
  assert.ok(corpo.due_day, "sem vencimento o close devolve 400");
  assert.ok(
    corpo.closing_day,
    "sem fechamento o card_invoice_month() joga toda compra no proprio mes"
  );
});

test("o cadastro sem os dias e o caso que o aviso da tela cobre", () => {
  // Nao e um bug: da para cadastrar o cartao antes de saber os dias. O que nao
  // pode acontecer e isso passar despercebido -- o close devolveria 400 e a
  // fatura nunca fecharia, sem nada na tela explicando por que.
  const semDias = corpoDaConta(
    { ...preenchido, closing_day: "", due_day: "" },
    "cartao"
  );
  assert.equal(semDias.due_day, null);
  assert.equal(
    faltaFatura({
      account_type: "credit_card",
      closing_day: semDias.closing_day,
      due_day: semDias.due_day,
    }),
    true,
    "o cartao que o close vai recusar nao recebeu a tarja na tela"
  );
});

test("o dia digitado antes de trocar de tela nao barra a conta", () => {
  // Contas nao tem esses campos, entao um valor invalido herdado da edicao de
  // um cartao nao pode travar o Salvar de uma conta -- ele vai para o banco
  // como `null` de qualquer jeito.
  assert.equal(
    validarConta({ ...preenchido, account_type: "checking", closing_day: "99" }, "conta"),
    null
  );
});

// ---------------------------------------------------------------------------
// A MOEDA DA CONTA (HMO-171)
// ---------------------------------------------------------------------------

test("conta nova nasce na moeda oficial da pessoa, e nao em BRL fixo", () => {
  // Quem configurou dolar como moeda oficial nao quer digitar "dolar" em cada
  // conta que cria.
  assert.equal(valoresIniciais("conta", "USD").currency, "USD");
  assert.equal(valoresIniciais("cartao", "USD").currency, "USD");
});

test("sem preferencia carregada ainda, o formulario nasce em BRL", () => {
  // A preferencia chega de uma leitura e demora um tique. O default segura esse
  // intervalo; a tela reinicializa o formulario quando o dialogo abre.
  assert.equal(valoresIniciais("conta").currency, "BRL");
});

test("reabrir uma conta em dolar mostra dolar, nunca a moeda oficial", () => {
  // O erro simetrico e o caro: cair na moeda oficial aqui faria a edicao de
  // QUALQUER campo -- trocar o nome, corrigir o dia de vencimento -- gravar a
  // moeda principal em cima da moeda da conta, sem ninguem tocar nesse campo.
  // Quem mudasse a moeda oficial para BRL veria toda conta em dolar voltar a
  // real no primeiro salvamento, e o relatorio dela mudaria de balde.
  const conta = {
    id: "c1",
    name: "Conta gringa",
    account_type: "checking",
    bank_name: "",
    last_four_digits: null,
    credit_limit: null,
    closing_day: null,
    due_day: null,
    currency: "USD",
  };
  assert.equal(valoresDaConta(conta).currency, "USD");
});

test("conta antiga, sem moeda gravada, le como BRL", () => {
  // A 022 poe DEFAULT 'BRL' na coluna, mas uma linha que veio de cache offline
  // ou de uma leitura parcial pode chegar sem o campo. Cair no padrao e o que
  // impede o formulario de abrir com o seletor vazio e gravar NULL por cima.
  const conta = {
    id: "c2",
    name: "Conta velha",
    account_type: "checking",
    bank_name: "",
    last_four_digits: null,
    credit_limit: null,
    closing_day: null,
    due_day: null,
  };
  assert.equal(valoresDaConta(conta).currency, "BRL");
});

test("a moeda vai no corpo das DUAS telas, inclusive com o seletor escondido", () => {
  // Ela NAO segue a regra dos tres `null` de limite/fechamento/vencimento:
  // aqueles sao de cartao, a moeda e de toda conta. Mandar so quando o campo
  // esta visivel faria a conta perder a moeda que tinha no dia em que a pessoa
  // desligasse o recurso nas configuracoes e editasse o nome -- a conta em
  // dolar voltaria a BRL calada.
  for (const escopo of ["conta", "cartao"]) {
    const corpo = corpoDaConta(
      { ...valoresIniciais(escopo), name: "X", currency: "USD" },
      escopo
    );
    assert.equal(
      corpo.currency,
      "USD",
      `a tela de ${escopo} nao mandou a moeda no corpo`
    );
  }
});
