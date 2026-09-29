#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DA TRANSFERENCIA ENTRE CONTAS (HMO-164)
// =====================================================
//   npm run test:transferencia
//
// Exercita lib/transferencia.ts, e junto com ele o pagamento de fatura, que
// passou a sair do mesmo lugar. Mesmo desenho do test-card-invoice.mjs: .mjs
// rodando o JS que o tsc emitiu, sem runner novo.
//
// -----------------------------------------------------------------------
// O que estes testes existem para pegar
// -----------------------------------------------------------------------
// O bug que a HMO-164 conserta nao quebrava nada. Escolher
// "Transferencia/Balanco" na tela antiga gravava UMA linha: o dinheiro saia de
// uma conta e nao entrava em nenhuma. Nao havia excecao, nao havia 500 -- havia
// um patrimonio menor pelo valor transferido, plausivel, com duas casas
// decimais. Quem moveu R$ 1.000 da corrente para a poupanca viu o total cair
// mil reais e acreditou.
//
// Os erros de maior consequencia aqui, cada um com teste proprio:
//
//   - as duas pernas com o MESMO sinal. O saldo somaria ou subtrairia duas
//     vezes o valor em vez de se anular, e o patrimonio erraria pelo dobro.
//   - `Math.abs` ausente. O input aceita "-500": sem o abs a saida viraria
//     +500 e a entrada -500, a transferencia andaria para tras, e as duas
//     contas ficariam erradas na mesma operacao.
//   - origem igual ao destino. As duas pernas se anulariam na MESMA conta, a
//     tela diria "transferido" e nada teria se movido -- o bug do HMO-149 com
//     outra roupa: o numero fecha e o fato nao aconteceu.
//   - cartao de credito como ORIGEM. Criaria divida sem compra por tras, e essa
//     linha entraria na fatura cobrando algo que ninguem comprou.
//   - a generalizacao mudar o pagamento da fatura. `pernasDoPagamentoDeFatura`
//     agora e uma casca sobre `pernasDaTransferencia`, e a traducao
//     cartao/pagadora -> destino/origem e invertivel sem o compilador notar:
//     trocar os dois faria o dinheiro sair do CARTAO e entrar na corrente.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  pernasDaTransferencia,
  validarContasDaTransferencia,
  mensagemDaTransferencia,
  validarTransferencia,
  valoresIniciaisDeTransferencia,
  contasDeOrigem,
  NOME_DA_CATEGORIA_DE_TRANSFERENCIA,
  ROTA_DA_TRANSFERENCIA,
} = await import("../.tmp-transferencia/transferencia.js");

const { pernasDoPagamentoDeFatura } = await import(
  "../.tmp-transferencia/card-invoice.js"
);

const CORRENTE = "11111111-1111-1111-1111-111111111111";
const POUPANCA = "22222222-2222-2222-2222-222222222222";
const CARTAO = "33333333-3333-3333-3333-333333333333";

const conta = (id, tipo) => ({ id, account_type: tipo });

// ---------------------------------------------------------------------------
// AS DUAS PERNAS
// ---------------------------------------------------------------------------

test("as duas pernas tem sinais opostos e o mesmo modulo", () => {
  const { saida, entrada } = pernasDaTransferencia({
    valor: 1000,
    origemId: CORRENTE,
    destinoId: POUPANCA,
    descricao: "Reserva",
  });

  assert.equal(saida.amount, -1000);
  assert.equal(entrada.amount, 1000);
  // A soma e o que o trigger de saldo faz com as duas linhas juntas. Zero aqui
  // e o patrimonio parado, que e o fato: transferir nao cria nem destroi
  // dinheiro.
  assert.equal(saida.amount + entrada.amount, 0);
});

test("a saida sai da origem e a entrada cai no destino", () => {
  const { saida, entrada } = pernasDaTransferencia({
    valor: 250.5,
    origemId: CORRENTE,
    destinoId: POUPANCA,
    descricao: "Reserva",
  });

  assert.equal(saida.account_id, CORRENTE);
  assert.equal(entrada.account_id, POUPANCA);
  assert.equal(saida.amount, -250.5);
  assert.equal(entrada.amount, 250.5);
});

test("as duas pernas sao 'transfer', e nao expense/income", () => {
  const { saida, entrada } = pernasDaTransferencia({
    valor: 10,
    origemId: CORRENTE,
    destinoId: POUPANCA,
    descricao: "Teste",
  });

  // Este e o campo que mantem as duas pernas fora de Receitas e Despesas: as
  // views do 008 filtram `transaction_type IN ('expense','income')`. Uma perna
  // marcada 'expense' faria a transferencia virar gasto, e a outra, receita --
  // que e exatamente como o mes ficava inflado dos dois lados antes da HMO-162.
  assert.equal(saida.transaction_type, "transfer");
  assert.equal(entrada.transaction_type, "transfer");
});

test("valor negativo nao inverte a transferencia", () => {
  // O `CampoDeValor` nao aceita mais o menos, mas a rota aceita qualquer corpo
  // e esta funcao e chamada dos dois lados. Sem o `Math.abs`, -500 daria
  // saida +500 e entrada -500: o dinheiro andaria ao contrario e as duas contas
  // ficariam erradas de uma vez.
  const { saida, entrada } = pernasDaTransferencia({
    valor: -500,
    origemId: CORRENTE,
    destinoId: POUPANCA,
    descricao: "Reserva",
  });

  assert.equal(saida.amount, -500);
  assert.equal(entrada.amount, 500);
});

test("as duas pernas levam a mesma descricao numa transferencia comum", () => {
  const { saida, entrada } = pernasDaTransferencia({
    valor: 100,
    origemId: CORRENTE,
    destinoId: POUPANCA,
    descricao: "Reserva de emergência",
  });

  // E assim que a pessoa reconhece o par olhando o extrato das duas contas.
  assert.equal(saida.description, "Reserva de emergência");
  assert.equal(entrada.description, "Reserva de emergência");
});

test("descricaoDaEntrada troca so o rotulo da entrada", () => {
  const { saida, entrada } = pernasDaTransferencia({
    valor: 100,
    origemId: CORRENTE,
    destinoId: CARTAO,
    descricao: "Fatura de setembro",
    descricaoDaEntrada: "Pagamento — Fatura de setembro",
  });

  assert.equal(saida.description, "Fatura de setembro");
  assert.equal(entrada.description, "Pagamento — Fatura de setembro");
  // O rotulo nao pode mexer no dinheiro.
  assert.equal(saida.amount, -100);
  assert.equal(entrada.amount, 100);
});

// ---------------------------------------------------------------------------
// O PAGAMENTO DE FATURA CONTINUA IGUAL DEPOIS DA GENERALIZACAO
// ---------------------------------------------------------------------------
// Estes dois sao a rede de seguranca da HMO-149. `pernasDoPagamentoDeFatura`
// virou uma casca, e a traducao (cartao -> destino, pagadora -> origem) e
// invertivel sem erro de compilacao.

test("pagar fatura: o dinheiro sai da conta pagadora, nao do cartao", () => {
  const { saida, entrada } = pernasDoPagamentoDeFatura({
    valor: 1000,
    cartaoId: CARTAO,
    contaPagadoraId: CORRENTE,
    descricao: "Fatura Nubank 09/2026",
  });

  // Se os dois ids fossem trocados na traducao, esta afirmacao cairia e o
  // HMO-149 voltaria: a saida no cartao deixaria o cartao MAIS negativo e a
  // conta de onde o dinheiro saiu nao se mexeria.
  assert.equal(saida.account_id, CORRENTE);
  assert.equal(saida.amount, -1000);
  assert.equal(entrada.account_id, CARTAO);
  assert.equal(entrada.amount, 1000);
});

test("pagar fatura: a entrada mantem o prefixo 'Pagamento —'", () => {
  const { saida, entrada } = pernasDoPagamentoDeFatura({
    valor: 42,
    cartaoId: CARTAO,
    contaPagadoraId: CORRENTE,
    descricao: "Fatura Nubank 09/2026",
  });

  assert.equal(saida.description, "Fatura Nubank 09/2026");
  assert.equal(entrada.description, "Pagamento — Fatura Nubank 09/2026");
});

test("pagar fatura: valor negativo continua sendo absorvido", () => {
  const { saida, entrada } = pernasDoPagamentoDeFatura({
    valor: -300,
    cartaoId: CARTAO,
    contaPagadoraId: CORRENTE,
    descricao: "Fatura",
  });

  assert.equal(saida.amount, -300);
  assert.equal(entrada.amount, 300);
});

// ---------------------------------------------------------------------------
// AS CONTAS
// ---------------------------------------------------------------------------

test("par valido passa", () => {
  assert.equal(
    validarContasDaTransferencia(
      conta(CORRENTE, "checking"),
      conta(POUPANCA, "savings")
    ),
    null
  );
});

test("mesma conta nos dois lados e recusado", () => {
  // O caso que mais importa: as duas pernas cairiam na mesma conta, -total e
  // +total se anulariam, e a tela diria "transferido" sem que nada tivesse se
  // movido.
  assert.equal(
    validarContasDaTransferencia(
      conta(CORRENTE, "checking"),
      conta(CORRENTE, "checking")
    ),
    "mesma_conta"
  );
});

test("cartao de credito nao pode ser a origem", () => {
  assert.equal(
    validarContasDaTransferencia(conta(CARTAO, "credit_card"), conta(CORRENTE, "checking")),
    "origem_e_cartao"
  );
});

test("cartao de credito PODE ser o destino", () => {
  // Adiantar dinheiro para o cartao e quitar divida, e e um fato que acontece.
  // Recusar aqui deixaria a pessoa sem caminho para registrar o que fez.
  assert.equal(
    validarContasDaTransferencia(conta(CORRENTE, "checking"), conta(CARTAO, "credit_card")),
    null
  );
});

test("debit_card e conta comum: serve como origem", () => {
  // `debit_card` e do ENUM `account_type` e nao tem fatura -- ele se comporta
  // como conta. Um filtro por "cartao" pelo NOME do tipo tiraria ele da origem
  // e a pessoa nao conseguiria mover o proprio dinheiro.
  assert.equal(
    validarContasDaTransferencia(conta("d", "debit_card"), conta(POUPANCA, "savings")),
    null
  );
});

test("origem ausente e origem invalida dao motivos diferentes", () => {
  // `undefined` = campo em branco. `null` = id que a busca nao achou, o que
  // inclui a conta de OUTRA pessoa. Uma mensagem so esconderia a segunda atras
  // de "preencha o campo".
  assert.equal(
    validarContasDaTransferencia(undefined, conta(POUPANCA, "savings")),
    "origem_ausente"
  );
  assert.equal(
    validarContasDaTransferencia(null, conta(POUPANCA, "savings")),
    "origem_nao_encontrada"
  );
});

test("destino ausente e destino invalido dao motivos diferentes", () => {
  assert.equal(
    validarContasDaTransferencia(conta(CORRENTE, "checking"), undefined),
    "destino_ausente"
  );
  assert.equal(
    validarContasDaTransferencia(conta(CORRENTE, "checking"), null),
    "destino_nao_encontrado"
  );
});

test("a origem e conferida antes do destino", () => {
  // Com os dois em branco, a mensagem tem que falar do primeiro campo da tela.
  // Reclamar do destino manda a pessoa preencher de baixo para cima.
  assert.equal(validarContasDaTransferencia(undefined, undefined), "origem_ausente");
});

test("todo motivo tem mensagem, e nenhuma e vazia", () => {
  const motivos = [
    "origem_ausente",
    "destino_ausente",
    "origem_nao_encontrada",
    "destino_nao_encontrado",
    "mesma_conta",
    "origem_e_cartao",
  ];

  const vistas = new Set();
  for (const motivo of motivos) {
    const msg = mensagemDaTransferencia(motivo);
    assert.ok(msg && msg.trim().length > 0, `motivo sem mensagem: ${motivo}`);
    // Duas mensagens iguais para motivos diferentes deixariam a pessoa sem
    // saber qual dos dois campos corrigir.
    assert.ok(!vistas.has(msg), `mensagem repetida: ${msg}`);
    vistas.add(msg);
  }
});

// ---------------------------------------------------------------------------
// A VALIDACAO DA TELA
// ---------------------------------------------------------------------------

const valoresValidos = () => ({
  ...valoresIniciaisDeTransferencia(),
  descricao: "Reserva",
  valor: "1000",
  origemId: CORRENTE,
  destinoId: POUPANCA,
  data: "2026-09-29",
});

const contasDaTela = [
  { id: CORRENTE, name: "Corrente", account_type: "checking" },
  { id: POUPANCA, name: "Poupança", account_type: "savings" },
  { id: CARTAO, name: "Cartão", account_type: "credit_card" },
];

test("transferencia completa e valida", () => {
  assert.deepEqual(validarTransferencia(valoresValidos(), contasDaTela), {
    ok: true,
  });
});

test("sem descricao, recusa", () => {
  const r = validarTransferencia(
    { ...valoresValidos(), descricao: "   " },
    contasDaTela
  );
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /descrição/i);
});

test("sem origem, recusa falando da origem", () => {
  const r = validarTransferencia(
    { ...valoresValidos(), origemId: "" },
    contasDaTela
  );
  assert.equal(r.ok, false);
  assert.equal(r.mensagem, mensagemDaTransferencia("origem_ausente"));
});

test("sem destino, recusa falando do destino", () => {
  const r = validarTransferencia(
    { ...valoresValidos(), destinoId: "" },
    contasDaTela
  );
  assert.equal(r.ok, false);
  assert.equal(r.mensagem, mensagemDaTransferencia("destino_ausente"));
});

test("origem igual ao destino, recusa", () => {
  const r = validarTransferencia(
    { ...valoresValidos(), destinoId: CORRENTE },
    contasDaTela
  );
  assert.equal(r.ok, false);
  assert.equal(r.mensagem, mensagemDaTransferencia("mesma_conta"));
});

test("cartao escolhido como origem, recusa na tela", () => {
  // O seletor nao oferece cartao como origem, mas o estado pode chegar com ele
  // (um id salvo, um corpo montado a mao). A tela recusa antes do POST.
  const r = validarTransferencia(
    { ...valoresValidos(), origemId: CARTAO },
    contasDaTela
  );
  assert.equal(r.ok, false);
  assert.equal(r.mensagem, mensagemDaTransferencia("origem_e_cartao"));
});

test("valor zero e valor negativo sao recusados", () => {
  for (const valor of ["0", "-5", "", "abc"]) {
    const r = validarTransferencia(
      { ...valoresValidos(), valor },
      contasDaTela
    );
    assert.equal(r.ok, false, `passou com valor ${JSON.stringify(valor)}`);
  }
});

test("data fora do formato e recusada", () => {
  const r = validarTransferencia(
    { ...valoresValidos(), data: "29/09/2026" },
    contasDaTela
  );
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /data/i);
});

test("sem a lista de contas, ainda checa origem igual a destino", () => {
  // A tela offline pode nao ter carregado as contas. O `account_type` some, mas
  // a igualdade dos dois ids nao depende dele -- e perder essa checagem
  // deixaria passar a transferencia que nao move nada.
  const r = validarTransferencia({ ...valoresValidos(), destinoId: CORRENTE }, []);
  assert.equal(r.ok, false);
  assert.equal(r.mensagem, mensagemDaTransferencia("mesma_conta"));
});

// ---------------------------------------------------------------------------
// O SELETOR
// ---------------------------------------------------------------------------

test("contasDeOrigem tira o cartao de credito e mantem o resto", () => {
  const origens = contasDeOrigem(contasDaTela);
  assert.deepEqual(
    origens.map((c) => c.id),
    [CORRENTE, POUPANCA]
  );
});

test("contasDeOrigem mantem conta sem tipo declarado", () => {
  // Conta antiga, sem `account_type`. Sumir do seletor por causa de um campo em
  // branco deixaria a pessoa sem conseguir transferir dela, sem explicacao.
  const origens = contasDeOrigem([{ id: "x", name: "Antiga" }]);
  assert.equal(origens.length, 1);
});

// ---------------------------------------------------------------------------
// CONSTANTES
// ---------------------------------------------------------------------------

test("a rota da tela aponta para movimentacoes/transferencia", () => {
  assert.equal(ROTA_DA_TRANSFERENCIA, "/dashboard/movimentacoes/transferencia");
});

test("o nome da categoria reservada nao e vazio", () => {
  // Ele e a chave de busca da rota (`service_id` + `name`, a UNIQUE do 001).
  // Vazio, o SELECT casaria com qualquer categoria sem nome.
  assert.ok(NOME_DA_CATEGORIA_DE_TRANSFERENCIA.trim().length > 0);
});
