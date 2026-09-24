#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DO PAGAMENTO DE FATURA DE CARTAO
// =====================================================
//   npm run test:card-invoice
//
// Exercita lib/card-invoice.ts. Mesmo desenho do test-net-worth.mjs: .mjs
// rodando o JS que o tsc (ja dependencia) emitiu, sem runner novo.
//
// -----------------------------------------------------------------------
// O que estes testes existem para pegar
// -----------------------------------------------------------------------
// O bug do HMO-149 nao quebrou nada. Nao houve excecao, nao houve 500, nao
// houve tela vazia: houve um patrimonio 20% menor do que o real, plausivel,
// com duas casas decimais. Quem pagou a fatura viu o numero cair e acreditou.
//
// Os erros de maior consequencia aqui, cada um com teste proprio:
//
//   - detectar a fatura pelo TIPO DA CONTA em vez da chave canonica. A
//     assinatura cobrada no cartao e cadastrada como conta prevista com
//     account_id do cartao, e pagar aquela conta com o cartao e despesa de
//     verdade. Quem detectasse por account_type transformaria toda assinatura
//     de cartao em transferencia e a faria DESAPARECER do fluxo de caixa.
//   - aceitar o proprio cartao como conta pagadora. As duas pernas cairiam na
//     mesma conta, se anulariam, e a fatura ficaria paga sem dinheiro nenhum
//     ter se movido -- o mesmo bug com outra roupa.
//   - trocar o sinal das pernas. Inverter as duas continua "fechando" (a soma
//     e zero de qualquer jeito) mas rebaixa a conta errada: a divida do cartao
//     dobra e a conta corrente sobe.
//   - regex de chave sem ancora no fim, que faria a nota escrita a mao pelo
//     usuario virar regra de negocio.
//
// Os valores esperados foram calculados a mao a partir da reproducao registrada
// na HMO-149, nao colados da saida da funcao.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  PREFIXO_CHAVE_FATURA,
  chaveFatura,
  faturaDaChave,
  ehFatura,
  validarContaPagadora,
  mensagemContaPagadora,
  pernasDoPagamentoDeFatura,
} = await import("../.tmp-card-invoice/card-invoice.js");

const CARTAO = "11111111-2222-3333-4444-555555555555";
const CORRENTE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OUTRO_CARTAO = "99999999-8888-7777-6666-555555555555";

/** Compara dinheiro com tolerancia de um centavo. */
function perto(recebido, esperado, mensagem) {
  assert.ok(
    Math.abs(recebido - esperado) <= 0.01 + 1e-9,
    `${mensagem}: esperado ${esperado}, recebido ${recebido}`
  );
}

// =====================================================
// 1. A chave canonica
// =====================================================

test("chaveFatura monta a chave no formato que o 006 ja gravava", () => {
  assert.equal(
    chaveFatura("2026-09-01", CARTAO),
    `fatura:2026-09-01:${CARTAO}`
  );
  assert.ok(chaveFatura("2026-09-01", CARTAO).startsWith(PREFIXO_CHAVE_FATURA));
});

test("chaveFatura e faturaDaChave sao inversas", () => {
  const lida = faturaDaChave(chaveFatura("2026-12-01", CARTAO));
  assert.deepEqual(lida, { mes: "2026-12-01", accountId: CARTAO });
});

test("a chave de fatura e reconhecida como fatura", () => {
  assert.equal(ehFatura(`fatura:2026-09-01:${CARTAO}`), true);
});

test("nota de conta comum NAO e fatura", () => {
  for (const notes of [
    null,
    undefined,
    "",
    "aluguel de setembro",
    "Netflix",
    "fatura do cartao",
    "fatura:",
  ]) {
    assert.equal(ehFatura(notes), false, `deveria recusar: ${String(notes)}`);
  }
});

// A regex e ancorada nas duas pontas. Sem o `$`, esta nota passaria por chave
// canonica e o texto livre do usuario viraria regra de negocio: a rota de
// baixa trataria a conta como fatura e exigiria conta pagadora.
test("chave com texto colado no fim NAO e chave", () => {
  assert.equal(ehFatura(`fatura:2026-09-01:${CARTAO} paguei no debito`), false);
  assert.equal(faturaDaChave(`fatura:2026-09-01:${CARTAO}x`), null);
});

test("chave com prefixo antes NAO e chave", () => {
  assert.equal(ehFatura(`obs: fatura:2026-09-01:${CARTAO}`), false);
});

test("chave com mes malformado NAO e chave", () => {
  assert.equal(ehFatura(`fatura:2026-09:${CARTAO}`), false);
  assert.equal(ehFatura(`fatura:setembro:${CARTAO}`), false);
});

test("chave sem uuid de cartao NAO e chave", () => {
  assert.equal(ehFatura("fatura:2026-09-01:123"), false);
  assert.equal(ehFatura("fatura:2026-09-01:"), false);
});

test("faturaDaChave aceita uuid em maiuscula", () => {
  const lida = faturaDaChave(`fatura:2026-09-01:${CARTAO.toUpperCase()}`);
  assert.equal(lida?.accountId, CARTAO.toUpperCase());
});

// =====================================================
// 2. A conta pagadora
// =====================================================

test("conta corrente serve para pagar a fatura", () => {
  assert.equal(
    validarContaPagadora({ id: CORRENTE, account_type: "checking" }, CARTAO),
    null
  );
});

test("poupanca e carteira tambem servem", () => {
  for (const tipo of ["savings", "cash", "investment"]) {
    assert.equal(
      validarContaPagadora({ id: CORRENTE, account_type: tipo }, CARTAO),
      null,
      `deveria aceitar ${tipo}`
    );
  }
});

test("conta nao informada e 'ausente', nao um padrao silencioso", () => {
  assert.equal(validarContaPagadora(undefined, CARTAO), "ausente");
});

test("id informado que a busca nao achou e 'nao_encontrada'", () => {
  assert.equal(validarContaPagadora(null, CARTAO), "nao_encontrada");
});

// O caso que mais importa: as duas pernas cairiam na mesma conta, -total e
// +total se anulariam, e a fatura ficaria marcada como paga sem que dinheiro
// nenhum se movesse.
test("o proprio cartao NAO pode pagar a propria fatura", () => {
  assert.equal(
    validarContaPagadora({ id: CARTAO, account_type: "credit_card" }, CARTAO),
    "e_o_proprio_cartao"
  );
});

test("outro cartao de credito tambem nao paga", () => {
  assert.equal(
    validarContaPagadora(
      { id: OUTRO_CARTAO, account_type: "credit_card" },
      CARTAO
    ),
    "outro_cartao"
  );
});

// A ordem dos dois motivos importa: o proprio cartao TAMBEM e credit_card, e
// devolver "outro_cartao" para ele daria ao usuario uma mensagem que nao
// descreve o que ele fez.
test("o proprio cartao ganha a mensagem dele, nao a de 'outro cartao'", () => {
  const problema = validarContaPagadora(
    { id: CARTAO, account_type: "credit_card" },
    CARTAO
  );
  assert.match(mensagemContaPagadora(problema), /próprio cartão/);
});

test("todo problema tem mensagem em portugues", () => {
  for (const problema of [
    "ausente",
    "nao_encontrada",
    "e_o_proprio_cartao",
    "outro_cartao",
  ]) {
    const msg = mensagemContaPagadora(problema);
    assert.equal(typeof msg, "string");
    assert.ok(msg.length > 10, `mensagem curta demais para ${problema}`);
  }
});

// =====================================================
// 3. As duas pernas
// =====================================================

function pernas(valor = 1000, descricao = "Fatura Nubank 09/2026") {
  return pernasDoPagamentoDeFatura({
    valor,
    cartaoId: CARTAO,
    contaPagadoraId: CORRENTE,
    descricao,
  });
}

test("a perna de saida tira o dinheiro da conta pagadora", () => {
  const { saida } = pernas();
  assert.equal(saida.account_id, CORRENTE);
  perto(saida.amount, -1000, "saida");
});

test("a perna de entrada quita a divida do cartao", () => {
  const { entrada } = pernas();
  assert.equal(entrada.account_id, CARTAO);
  perto(entrada.amount, 1000, "entrada");
});

// Este e o teste do bug. O trigger update_account_balance soma NEW.amount na
// conta indicada; entao a reproducao da HMO-149 (corrente 5.000, cartao
// -1.000) tem que terminar em corrente 4.000 e cartao 0, patrimonio 4.000 --
// o mesmo patrimonio de antes do pagamento.
test("aplicadas nos saldos, as pernas quitam o cartao sem mexer no patrimonio", () => {
  const saldos = { [CORRENTE]: 5000, [CARTAO]: -1000 };
  const patrimonioAntes = saldos[CORRENTE] + saldos[CARTAO];

  const { saida, entrada } = pernas(1000);
  for (const perna of [saida, entrada]) {
    saldos[perna.account_id] += perna.amount;
  }

  perto(saldos[CORRENTE], 4000, "conta corrente depois do pagamento");
  perto(saldos[CARTAO], 0, "cartao depois do pagamento");
  perto(
    saldos[CORRENTE] + saldos[CARTAO],
    patrimonioAntes,
    "patrimonio nao muda ao pagar a fatura"
  );
});

// Controle do sinal: inverter as DUAS pernas continua somando zero (o
// patrimonio fecharia), mas rebaixa a conta errada -- a divida do cartao
// dobraria, que e exatamente o bug relatado.
test("o sinal invertido dobraria a divida do cartao", () => {
  const { saida, entrada } = pernas(1000);
  const saldos = { [CORRENTE]: 5000, [CARTAO]: -1000 };
  saldos[saida.account_id] -= saida.amount;
  saldos[entrada.account_id] -= entrada.amount;

  perto(saldos[CARTAO], -2000, "cartao com o sinal invertido");
  assert.notEqual(saldos[CARTAO], 0);
});

test("as duas pernas somam zero: nenhum dinheiro nasce nem desaparece", () => {
  for (const valor of [0.01, 1, 1000, 12345.67]) {
    const { saida, entrada } = pernas(valor);
    perto(saida.amount + entrada.amount, 0, `soma das pernas de ${valor}`);
  }
});

// scheduled_transactions.amount e sempre positivo (CHECK do 005), mas quem
// chamar daqui a um ano nao sabe: o valor negativo nao pode inverter a
// transferencia.
test("valor negativo na entrada nao inverte a transferencia", () => {
  const { saida, entrada } = pernas(-1000);
  perto(saida.amount, -1000, "saida com valor negativo na entrada");
  perto(entrada.amount, 1000, "entrada com valor negativo na entrada");
});

// 'transfer' e o que mantem as duas pernas fora de category_monthly_totals e
// de monthly_cash_flow (que filtram expense/income) e fora de
// card_invoice_lines. Se virasse 'expense', a despesa voltaria a ser contada
// duas vezes; se virasse 'income', o mes ganharia uma receita de 1.000 que
// ninguem recebeu.
test("as duas pernas sao 'transfer', nunca expense nem income", () => {
  const { saida, entrada } = pernas();
  assert.equal(saida.transaction_type, "transfer");
  assert.equal(entrada.transaction_type, "transfer");
});

test("a descricao da saida e a da conta prevista; a da entrada diz que e pagamento", () => {
  const { saida, entrada } = pernas(1000, "Fatura Nubank 09/2026");
  assert.equal(saida.description, "Fatura Nubank 09/2026");
  assert.match(entrada.description, /^Pagamento/);
  assert.match(entrada.description, /Fatura Nubank 09\/2026/);
});

test("centavos sobrevivem: a fatura de 1.234,56 nao arredonda", () => {
  const { saida, entrada } = pernas(1234.56);
  perto(saida.amount, -1234.56, "saida");
  perto(entrada.amount, 1234.56, "entrada");
});
