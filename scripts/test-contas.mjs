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
  contasDoRecorte,
  contasQueSomam,
  corpoDaConta,
  escopoDoTipo,
  faltaFatura,
  porTipo,
  tipoDoRecorte,
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

// =====================================================
// O RECORTE DA TELA (HMO-423)
// =====================================================
// A tela de Contas passou a aceitar `?tipo=`, para o menu poder dar um caminho
// paralelo as contas de investimento ("Investimentos > Contas de
// Investimento") sem duplicar o cadastro. O que esta em jogo aqui e uma lista
// recortada ser INDISTINGUIVEL de uma lista incompleta: `?tipo=banana` que
// filtrasse tudo deixaria a tela dizendo "Você ainda não tem contas" para quem
// tem oito.
// =====================================================

test("so tipo de CONTA recorta a tela; o resto cai em 'todas'", () => {
  // Os cinco que recortam: todos os de escopo `conta`.
  for (const tipo of tiposDoEscopo("conta")) {
    assert.equal(
      tipoDoRecorte(tipo.valor),
      tipo.valor,
      `${tipo.valor} deveria recortar a tela de Contas`
    );
  }

  // O QUE IMPORTA MAIS: cartao de credito NAO recorta. Ele nao mora nesta tela
  // (escopo `cartao`), e aceitar o recorte dele pintaria o titulo "Contas de
  // Cartão de crédito" sobre uma lista sempre vazia -- a tela afirmando que a
  // pessoa nao tem cartao, na tela errada.
  for (const tipo of tiposDoEscopo("cartao")) {
    assert.equal(tipoDoRecorte(tipo.valor), null);
  }

  // E tudo que nao e tipo: query ausente, vazia, inventada, ou com erro de
  // digitacao de uma letra -- que e o caso real (`investments` por
  // `investment`) e o unico que ninguem veria, porque a tela abre certa.
  for (const valor of [null, undefined, "", "banana", "investments", "INVESTMENT"]) {
    assert.equal(
      tipoDoRecorte(valor),
      null,
      `?tipo=${valor} nao deveria recortar nada`
    );
  }
});

test("o recorte filtra pelo tipo, e sem recorte devolve a lista inteira", () => {
  const contas = [
    { id: "1", account_type: "checking", current_balance: 100 },
    { id: "2", account_type: "investment", current_balance: 500 },
    { id: "3", account_type: "investment", current_balance: 300 },
    { id: "4", account_type: "savings", current_balance: 50 },
  ];

  assert.deepEqual(
    contasDoRecorte(contas, "investment").map((c) => c.id),
    ["2", "3"]
  );
  // Sem recorte e a lista inteira -- e o caminho de quem clicou em "Contas",
  // que e a maioria.
  assert.equal(contasDoRecorte(contas, null), contas);

  // E O TOTAL ACOMPANHA A LISTA, que e a metade de dinheiro desta feature: o
  // titulo diz "Contas de Investimento" e o numero tem de ser o daquelas
  // contas. Somar as quatro debaixo de um titulo que promete duas e o numero
  // plausivel e errado, que nenhuma inspecao visual pega.
  assert.equal(totalDoEscopo(contasDoRecorte(contas, "investment"), "conta"), 800);
  assert.equal(totalDoEscopo(contasDoRecorte(contas, null), "conta"), 950);
});

test("o recorte nao e um segundo filtro de escopo", () => {
  // Cartao de credito nao entra na tela de Contas nem com recorte nenhum: quem
  // decide isso continua sendo o ESCOPO. Se um dia `tipoDoRecorte` aceitar
  // `credit_card`, este caso mostra o que acontece -- a tela somaria a fatura
  // junto com os saldos, que e o corte que a HMO-166 desfez.
  const contas = [
    { id: "1", account_type: "checking", current_balance: 100 },
    { id: "2", account_type: "credit_card", current_balance: -700 },
  ];

  assert.equal(tipoDoRecorte("credit_card"), null);
  assert.equal(contasDoRecorte(contas, tipoDoRecorte("credit_card")), contas);
  // E o total da tela continua ignorando o cartao, recorte ou nao.
  assert.equal(totalDoEscopo(contas, "conta"), 100);
});

// =====================================================
// A CONTA QUE NAO SOMA NOS TOTAIS (HMO-431)
// =====================================================
// O checkbox "Somar nos totais" e a coluna `include_in_total` (migration 058).
//
// O ORACULO AQUI NAO E "O TOTAL MUDOU", e sim "o total e o da lista que soma".
// Uma assercao do tipo `total !== totalAntes` fica verde se a funcao subtrair
// um valor qualquer; as de baixo fixam o numero exato, calculado a mao.

test("a conta desligada sai do total de Contas", () => {
  const carteira = [
    conta("checking", 1000),
    conta("savings", 500, { include_in_total: false }),
  ];
  // 1000, e nao 1500: a poupanca esta fora.
  assert.equal(totalDoEscopo(carteira, "conta"), 1000);
});

test("o recorte vale no escopo cartao tambem", () => {
  // CUIDADO AO LER ESTE TESTE: ele NAO prova que o cartao desligado sai de
  // "Faturas em aberto" na tela. Aquele total deixou de usar `totalDoEscopo` na
  // HMO-290 e hoje vem da soma das faturas do mes (`GET /api/card-invoices`),
  // que nao passa por esta funcao -- o escopo `cartao` daqui esta sem chamador
  // em producao.
  //
  // O que ele fixa e que o criterio nao vale em metade dos casos: se algum dia
  // alguem voltar a somar cartao por aqui, o recorte ja esta certo. Aplicado so
  // em `conta`, este teste devolveria 1200 (os dois cartoes pelo `Math.abs`).
  const carteira = [
    conta("credit_card", -200),
    conta("credit_card", -1000, { include_in_total: false }),
  ];
  assert.equal(totalDoEscopo(carteira, "cartao"), 200);
});

test("desligar uma conta nao mexe no total do OUTRO escopo", () => {
  // O cartao desligado nao pode levar dinheiro do saldo embora, e vice-versa:
  // um filtro aplicado antes do recorte de escopo erraria isto calado.
  const carteira = [
    conta("checking", 800),
    conta("credit_card", -300, { include_in_total: false }),
  ];
  assert.equal(totalDoEscopo(carteira, "conta"), 800);
  assert.equal(totalDoEscopo(carteira, "cartao"), 0);
});

test("sem o campo, a conta SOMA -- o cache offline de antes da 058", () => {
  // `=== true` no lugar de `!== false` faria este total dar 0: a resposta
  // guardada no cache offline nao tem a coluna, e a tela mostraria R$ 0,00
  // para quem abrisse o app sem rede.
  const doCache = [{ account_type: "checking", current_balance: 700 }];
  assert.equal(totalDoEscopo(doCache, "conta"), 700);
  assert.deepEqual(contasQueSomam(doCache), doCache);
});

test("`null` tambem soma: so o booleano false desliga", () => {
  // A coluna e NOT NULL no banco, entao `null` nao vem do Postgres -- mas vem
  // de JSON montado a mao e da fila offline. Tratar `null` como "nao soma"
  // tiraria dinheiro do total por causa de um campo que ninguem preencheu.
  assert.equal(
    totalDoEscopo([conta("checking", 300, { include_in_total: null })], "conta"),
    300
  );
});

test("contasQueSomam preserva a ordem e nao copia item", () => {
  // Ela e usada no meio das leituras de patrimonio e projecao, que dependem da
  // ordem que o banco devolveu (`order by current_balance`). E os itens tem de
  // ser os MESMOS objetos: as rotas fazem `as ContaBruta[]` em cima do
  // resultado, e um clone superficial perderia campo que o cast promete.
  const a = conta("checking", 1);
  const b = conta("savings", 2, { include_in_total: false });
  const c = conta("cash", 3);
  const somam = contasQueSomam([a, b, c]);
  assert.equal(somam.length, 2);
  assert.ok(somam[0] === a);
  assert.ok(somam[1] === c);
});

test("desligar a conta NAO e arquivar: os dois campos sao independentes", () => {
  // `is_active` e `include_in_total` decidem coisas diferentes, e `totalDoEscopo`
  // nao olha `is_active` (quem recorta ativa/arquivada e a tela). Este teste
  // existe para que ninguem "simplifique" os dois campos em um.
  const carteira = [
    conta("checking", 100, { is_active: true, include_in_total: false }),
    conta("checking", 50, { is_active: false, include_in_total: true }),
  ];
  assert.equal(totalDoEscopo(carteira, "conta"), 50);
});

// -----------------------------------------------------------------------
// O CAMPO NO FORMULARIO
// -----------------------------------------------------------------------

test("conta nova nasce somando, igual ao DEFAULT da coluna", () => {
  assert.equal(valoresIniciais("conta").include_in_total, true);
  assert.equal(valoresIniciais("cartao").include_in_total, true);
});

test("reabrir uma conta desligada mostra o campo DESLIGADO", () => {
  const desligada = valoresDaConta({
    id: "x",
    name: "Conta da empresa",
    account_type: "checking",
    current_balance: 0,
    is_active: true,
    color_hex: "#000",
    icon: "building",
    include_in_total: false,
  });
  assert.equal(desligada.include_in_total, false);
});

test("conta antiga, sem o campo gravado, abre LIGADA", () => {
  // `=== true` aqui faria a edicao de qualquer campo (trocar o nome) gravar
  // `include_in_total: false` em cima de uma conta que somava -- a conta sairia
  // dos totais sem ninguem ter tocado no checkbox.
  const antiga = valoresDaConta({
    id: "x",
    name: "Conta de antes da 058",
    account_type: "checking",
    current_balance: 0,
    is_active: true,
    color_hex: "#000",
    icon: "building",
  });
  assert.equal(antiga.include_in_total, true);
});

test("o campo vai no corpo das DUAS telas, como booleano", () => {
  // Pelo mesmo motivo da moeda: ele e de toda conta, nao de cartao. Mandar so
  // onde o campo aparece faria a conta voltar a somar quando alguem editasse o
  // nome dela por uma tela que esconde o campo.
  for (const escopo of ["conta", "cartao"]) {
    const valores = { ...valoresIniciais(escopo), include_in_total: false };
    const corpo = corpoDaConta(valores, escopo);
    assert.equal(corpo.include_in_total, false);
    // Booleano, e nao a string "false" -- que e um valor VERDADEIRO em JS e
    // faria o servidor gravar `true`.
    assert.equal(typeof corpo.include_in_total, "boolean");
  }
});
