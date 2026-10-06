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
  camposDaTransferencia,
  destinoDaTransferencia,
  regraDeTransferenciaRecorrente,
  validarBaixaDeTransferencia,
  mensagemDaBaixaDeTransferencia,
  camposDeDestinoDaRegra,
} = await import("../.tmp-transferencia/transferencia.js");

const { naturezasDoTipo } = await import("../.tmp-transferencia/lancamento.js");

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

// ---------------------------------------------------------------------------
// A TRANSFERENCIA RECORRENTE (HMO-172)
// ---------------------------------------------------------------------------
// A ASSERCAO E POR CONTA, E ISSO E O TESTE INTEIRO
// -----------------------------------------------
// O defeito que esta issue fecha e "a materializacao gera UMA perna". Ele e
// invisivel em todo agregado que o app tem, e os dois controles abaixo
// (`agregadoDePatrimonio`, `agregadoDeFluxo`) existem para PROVAR que ele e
// invisivel la -- nao para medir o conserto.
//
//   * `net_worth_history` soma qualquer `transaction_type`. Um par completo da
//     -1000 + 1000 = 0... e ZERO ocorrencias tambem dao 0. O agregado nao
//     distingue "transferiu certo" de "nao transferiu nada".
//   * `monthly_cash_flow` e `category_monthly_totals` filtram
//     income/expense, entao nenhuma das pernas entra. Tambem 0 nos dois casos.
//
// Entao: qualquer assercao sobre o total passa verde com o bug de pe. O que
// pega e o saldo POR CONTA, e e so o que as assercoes de verdade olham.

/** O efeito de um conjunto de pernas no saldo de CADA conta. */
const saldoPorConta = (pernas) => {
  const saldos = {};
  for (const p of pernas) {
    saldos[p.account_id] = (saldos[p.account_id] ?? 0) + p.amount;
  }
  return saldos;
};

/** O que `net_worth_history` veria: soma de tudo, sem olhar o tipo. */
const agregadoDePatrimonio = (pernas) =>
  pernas.reduce((t, p) => t + p.amount, 0);

/** O que `monthly_cash_flow` veria: so income/expense. */
const agregadoDeFluxo = (pernas) =>
  pernas
    .filter((p) => p.transaction_type !== "transfer")
    .reduce((t, p) => t + Math.abs(p.amount), 0);

/**
 * A baixa de uma transferencia prevista, como a rota a monta.
 *
 * Reproduz `pagarTransferencia`: as duas pernas saem de
 * `pernasDaTransferencia`, o elo mora na ENTRADA apontando para a saida, e as
 * duas levam `group_id: null` / `is_shared: false`.
 */
const baixaDaTransferencia = (conta, valorPago = null) => {
  const { saida, entrada } = pernasDaTransferencia({
    valor: valorPago ?? conta.amount,
    origemId: conta.account_id,
    destinoId: conta.destination_account_id,
    descricao: conta.description,
  });
  const comum = { group_id: null, is_shared: false };
  return [
    { ...comum, ...saida, id: "tx-saida", counterpart_transaction_id: null },
    { ...comum, ...entrada, id: "tx-entrada", counterpart_transaction_id: "tx-saida" },
  ];
};

/** A perna UNICA: o defeito que a issue descreve. */
const baixaDeUmaPernaSo = (conta) => [baixaDaTransferencia(conta)[0]];

const PREVISTA = {
  account_id: CORRENTE,
  destination_account_id: POUPANCA,
  amount: 1000,
  description: "Reserva mensal",
};

test("a baixa da transferencia prevista mexe nas DUAS contas, por conta", () => {
  const saldos = saldoPorConta(baixaDaTransferencia(PREVISTA));

  // A assercao que o bug nao sobrevive: cada conta, separada.
  assert.equal(saldos[CORRENTE], -1000);
  assert.equal(saldos[POUPANCA], 1000);
});

test("com UMA perna so, a conta de destino nao e tocada", () => {
  const saldos = saldoPorConta(baixaDeUmaPernaSo(PREVISTA));

  assert.equal(saldos[CORRENTE], -1000);
  // E AQUI que o defeito aparece, e so aqui: o destino nao existe no resultado.
  // A pessoa ve o dinheiro sair da corrente e nunca chegar na poupanca.
  assert.equal(saldos[POUPANCA], undefined);
});

test("CONTROLE: o agregado de patrimonio e CEGO ao defeito", () => {
  // As duas pernas se anulam, entao o par completo da zero.
  assert.equal(agregadoDePatrimonio(baixaDaTransferencia(PREVISTA)), 0);
  // ...e NENHUMA ocorrencia tambem da zero. O agregado nao distingue os dois.
  assert.equal(agregadoDePatrimonio([]), 0);

  // Este e o motivo de o teste acima afirmar por conta. Sem este controle, um
  // teste que conferisse so o patrimonio passaria verde com a materializacao
  // quebrada -- e pior, passaria verde com ela NAO MATERIALIZANDO NADA.
});

test("CONTROLE: o agregado de fluxo nem ve as pernas", () => {
  // `monthly_cash_flow` filtra income/expense. Transferencia nao entra, nem
  // completa nem pela metade -- os tres casos dao o mesmo numero.
  assert.equal(agregadoDeFluxo(baixaDaTransferencia(PREVISTA)), 0);
  assert.equal(agregadoDeFluxo(baixaDeUmaPernaSo(PREVISTA)), 0);
  assert.equal(agregadoDeFluxo([]), 0);
});

test("as duas pernas da baixa sao transfer, e o elo so na entrada", () => {
  const [saida, entrada] = baixaDaTransferencia(PREVISTA);

  assert.equal(saida.transaction_type, "transfer");
  assert.equal(entrada.transaction_type, "transfer");
  // O elo e de UMA via (migration 015): so a entrada aponta. Gravar nos dois
  // lados criaria um ciclo que o estorno segue duas vezes.
  assert.equal(saida.counterpart_transaction_id, null);
  assert.equal(entrada.counterpart_transaction_id, "tx-saida");
});

test("as duas pernas da baixa saem sem grupo e sem rateio", () => {
  for (const perna of baixaDaTransferencia(PREVISTA)) {
    // Transferencia entre contas proprias nao e despesa compartilhada: com
    // `group_id` os triggers de grupo ratearam cada ocorrencia, cobrando dos
    // outros membros um valor que eles ja rateiam nas COMPRAS.
    assert.equal(perna.group_id, null);
    assert.equal(perna.is_shared, false);
  }
});

test("a baixa com valor diferente do previsto move o MESMO valor nas duas contas", () => {
  // A conta de luz quase nunca fecha no previsto, e a baixa aceita o valor real.
  // Numa transferencia o risco e outro: aplicar o valor novo em uma perna e o
  // previsto na outra deixaria as duas contas erradas por R$ 200.
  const saldos = saldoPorConta(baixaDaTransferencia(PREVISTA, 1200));
  assert.equal(saldos[CORRENTE], -1200);
  assert.equal(saldos[POUPANCA], 1200);
  assert.equal(agregadoDePatrimonio(baixaDaTransferencia(PREVISTA, 1200)), 0);
});

// ---------------------------------------------------------------------------
// A REGRA, OS CAMPOS E O DESTINO (HMO-172)
// ---------------------------------------------------------------------------

const fixa = (extra = {}) => ({
  ...valoresIniciaisDeTransferencia(),
  descricao: "Reserva mensal",
  valor: "1000",
  origemId: CORRENTE,
  destinoId: POUPANCA,
  data: "2026-03-01",
  natureza: "fixed",
  diaDeVencimento: "5",
  ...extra,
});

test("a regra leva a ORIGEM em account_id e o DESTINO em destination_account_id", () => {
  const regra = regraDeTransferenciaRecorrente(fixa(), "cat-023");

  // Trocar os dois nao da erro em lugar nenhum -- o CHECK da 038 so exige que
  // sejam diferentes -- e a transferencia andaria para tras todo mes.
  assert.equal(regra.account_id, CORRENTE);
  assert.equal(regra.destination_account_id, POUPANCA);
});

test("a regra vai com o valor POSITIVO e o tipo transfer", () => {
  const regra = regraDeTransferenciaRecorrente(fixa({ valor: "-1000" }), "cat-023");

  // `recurring_rules` tem CHECK (amount > 0): a regra nao tem sinal, quem aplica
  // os dois sinais e a baixa. O input aceita "-1000" e o abs e o que impede o
  // 23514 sem traducao.
  assert.equal(regra.amount, 1000);
  assert.equal(regra.transaction_type, "transfer");
});

test("a regra nasce sem grupo", () => {
  assert.equal(regraDeTransferenciaRecorrente(fixa(), "cat-023").group_id, null);
});

test("duracao indefinida vira max_occurrences null, contada vira o numero", () => {
  // NULL e "sem fim" na 005. Mandar 0 esbarraria no CHECK (max_occurrences > 0).
  assert.equal(
    regraDeTransferenciaRecorrente(fixa(), "cat-023").max_occurrences,
    null
  );
  assert.equal(
    regraDeTransferenciaRecorrente(
      fixa({ duracao: "contada", mesesDeRepeticao: "12" }),
      "cat-023"
    ).max_occurrences,
    12
  );
});

test("a data da tela vira start_date, e o dia vira due_day", () => {
  const regra = regraDeTransferenciaRecorrente(fixa(), "cat-023");
  assert.equal(regra.start_date, "2026-03-01");
  assert.equal(regra.due_day, 5);
  assert.equal(regra.frequency, "monthly");
});

test("a categoria da regra vem de fora, nao da tela", () => {
  // Transferencia nao tem categoria: a reservada do 023 e resolvida pela rota.
  assert.equal(
    regraDeTransferenciaRecorrente(fixa(), "cat-023").category_id,
    "cat-023"
  );
});

test("pontual vai para transacao, fixa vai para regra", () => {
  assert.equal(destinoDaTransferencia(valoresIniciaisDeTransferencia()), "transacao");
  assert.equal(destinoDaTransferencia(fixa()), "regra");
});

test("os campos da repeticao so existem na natureza fixa", () => {
  const pontual = camposDaTransferencia(valoresIniciaisDeTransferencia());
  assert.equal(pontual.diaDeVencimento, false);
  assert.equal(pontual.duracao, false);
  // O seletor de natureza existe SEMPRE: e ele que deixa escolher "todo mes".
  assert.equal(pontual.natureza, true);

  const campos = camposDaTransferencia(fixa());
  assert.equal(campos.diaDeVencimento, true);
  assert.equal(campos.duracao, true);
});

test("duracao anda COLADA no dia do vencimento", () => {
  // Mostrar "por 12 meses" sem o dia deixaria a pessoa dizer por quanto tempo
  // repetir sem dizer QUANDO, e a regra nasceria com due_day nulo -- uma agenda
  // que nunca gera ocorrencia nenhuma.
  for (const natureza of ["one_off", "fixed"]) {
    const campos = camposDaTransferencia(fixa({ natureza }));
    assert.equal(campos.duracao, campos.diaDeVencimento);
  }
});

test("transferencia nao tem a natureza 'no cartao'", () => {
  const naturezas = naturezasDoTipo("transfer");
  // Mover dinheiro PARA um cartao e quitar divida, e aquele caminho e o
  // pagamento de fatura. Uma segunda forma de pagar fatura que nao passe por
  // `pernasDoPagamentoDeFatura` seria a segunda fonte da regra de sinal.
  assert.ok(!naturezas.includes("card"));
  assert.deepEqual(naturezas, ["one_off", "fixed"]);
  // E a despesa CONTINUA tendo -- o controle que mata o mutante que tira "card"
  // de todo mundo.
  assert.ok(naturezasDoTipo("expense").includes("card"));
});

// ---------------------------------------------------------------------------
// A VALIDACAO DA RECORRENCIA (HMO-172)
// ---------------------------------------------------------------------------

const contasDeTeste = [conta(CORRENTE, "checking"), conta(POUPANCA, "savings")];

test("transferencia fixa sem dia do vencimento e recusada", () => {
  const r = validarTransferencia(fixa({ diaDeVencimento: "" }), contasDeTeste);
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /dia do vencimento/i);
});

test("dia do vencimento fora de 1..31 e recusado", () => {
  for (const dia of ["0", "32", "-1", "5.5"]) {
    const r = validarTransferencia(fixa({ diaDeVencimento: dia }), contasDeTeste);
    assert.equal(r.ok, false, `dia ${dia} deveria ser recusado`);
  }
});

test("transferencia PONTUAL nao cobra o dia do vencimento", () => {
  // O campo nao esta na tela: cobrar daria um erro que a pessoa nao tem como
  // consertar.
  const r = validarTransferencia(
    { ...fixa(), natureza: "one_off", diaDeVencimento: "" },
    contasDeTeste
  );
  assert.equal(r.ok, true);
});

test("duracao contada sem numero de meses e recusada", () => {
  const r = validarTransferencia(
    fixa({ duracao: "contada", mesesDeRepeticao: "" }),
    contasDeTeste
  );
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /quantos meses/i);
});

test("zero meses e recusado, e 1 passa", () => {
  // `max_occurrences` tem CHECK (> 0): 0 nao e "sem fim" -- o sem fim e a
  // duracao indefinida, que grava NULL.
  assert.equal(
    validarTransferencia(
      fixa({ duracao: "contada", mesesDeRepeticao: "0" }),
      contasDeTeste
    ).ok,
    false
  );
  assert.equal(
    validarTransferencia(
      fixa({ duracao: "contada", mesesDeRepeticao: "1" }),
      contasDeTeste
    ).ok,
    true
  );
});

test("a transferencia fixa valida passa inteira", () => {
  // CONTROLE POSITIVO: sem ele, uma validacao que recusasse TUDO passaria em
  // todas as assercoes de recusa acima.
  assert.equal(validarTransferencia(fixa(), contasDeTeste).ok, true);
  assert.equal(
    validarTransferencia(
      fixa({ duracao: "contada", mesesDeRepeticao: "12" }),
      contasDeTeste
    ).ok,
    true
  );
});

// ---------------------------------------------------------------------------
// A BAIXA RECUSA ANTES DE ESCREVER (HMO-172)
// ---------------------------------------------------------------------------

test("a baixa recusa a transferencia prevista sem destino", () => {
  // Esta e a guarda da JANELA em que o codigo novo fala com o banco sem a 038:
  // a coluna nem existe, `destination_account_id` chega undefined, e sem a
  // recusa a baixa gravaria a perna de saida sozinha.
  assert.equal(
    validarBaixaDeTransferencia({ account_id: CORRENTE }),
    "sem_destino"
  );
  assert.equal(
    validarBaixaDeTransferencia({ account_id: CORRENTE, destination_account_id: null }),
    "sem_destino"
  );
});

test("a baixa recusa sem origem e com destino igual a origem", () => {
  assert.equal(
    validarBaixaDeTransferencia({ destination_account_id: POUPANCA }),
    "sem_origem"
  );
  assert.equal(
    validarBaixaDeTransferencia({
      account_id: CORRENTE,
      destination_account_id: CORRENTE,
    }),
    "mesma_conta"
  );
});

test("a baixa ACEITA a transferencia prevista completa", () => {
  // CONTROLE POSITIVO: uma guarda que recusasse tudo passaria nas duas acima e
  // quebraria toda baixa de transferencia no app.
  assert.equal(validarBaixaDeTransferencia(PREVISTA), null);
});

test("cada recusa da baixa tem mensagem propria e nao manda procurar campo", () => {
  const vistas = new Set();
  for (const problema of ["sem_origem", "sem_destino", "mesma_conta"]) {
    const msg = mensagemDaBaixaDeTransferencia(problema);
    assert.ok(msg.trim().length > 0);
    // A pessoa aqui clicou "confirmar" numa conta prevista, nao esta preenchendo
    // formulario: "Escolha de qual conta o dinheiro saiu" mandaria procurar um
    // campo que nao esta na tela.
    assert.ok(!/^Escolha /.test(msg), `mensagem de ${problema} manda escolher`);
    vistas.add(msg);
  }
  // Tres estados, tres frases: uma mensagem unica para dois estados faz o
  // usuario repetir a mentira de volta.
  assert.equal(vistas.size, 3);
});

// ---------------------------------------------------------------------------
// OS CAMPOS DE DESTINO NO INSERT DA REGRA (HMO-236)
// ---------------------------------------------------------------------------
// A pergunta aqui nao e "qual o valor da coluna", e sim "a CHAVE vai no objeto".
// Por isso todo assert usa `in` em vez de comparar com `null`: PGRST204 e
// disparado pela chave existir, nao pelo valor dela -- um teste que so olhasse
// `=== null` passaria igual com a chave presente, que e exatamente o defeito.

test("despesa fixa nao leva a chave destination_account_id", () => {
  const campos = camposDeDestinoDaRegra("expense", null);
  assert.equal(
    "destination_account_id" in campos,
    false,
    "a chave viajou num expense: em banco sem a 038 isso e PGRST204 e o INSERT inteiro falha"
  );
  assert.deepEqual(campos, {});
});

test("receita fixa tambem nao leva a chave", () => {
  assert.equal(
    "destination_account_id" in camposDeDestinoDaRegra("income", null),
    false
  );
});

test("transferencia LEVA a chave com o id do destino", () => {
  // CONTROLE POSITIVO: uma funcao que devolvesse `{}` sempre passaria nos dois
  // testes acima e regrediria a HMO-172 -- a regra nasceria sem destino e a
  // baixa gravaria UMA perna.
  const campos = camposDeDestinoDaRegra("transfer", POUPANCA);
  assert.equal("destination_account_id" in campos, true);
  assert.equal(campos.destination_account_id, POUPANCA);
});

test("transferencia sem destino manda a chave como NULL, nao string vazia", () => {
  // `""` numa coluna uuid volta 22P02. E a chave PRECISA ir: e ela que faz o
  // CHECK da 038 recusar a transferencia sem destino, em vez de deixar nascer a
  // regra que materializa meia transferencia.
  for (const vazio of ["", null, undefined]) {
    const campos = camposDeDestinoDaRegra("transfer", vazio);
    assert.equal("destination_account_id" in campos, true);
    assert.equal(campos.destination_account_id, null);
  }
});

test("o tipo e comparado com 'transfer' exato, nao por prefixo nem truthy", () => {
  // Mata o mutante que troca a comparacao por algo permissivo (`!!tipo`,
  // `tipo.includes("transfer")`): um tipo desconhecido nao pode abrir o ramo
  // que manda a coluna.
  for (const tipo of ["expense", "income", "transferencia", "TRANSFER", ""]) {
    assert.equal(
      "destination_account_id" in camposDeDestinoDaRegra(tipo, POUPANCA),
      false,
      `o tipo ${JSON.stringify(tipo)} abriu o ramo de transferencia`
    );
  }
});
