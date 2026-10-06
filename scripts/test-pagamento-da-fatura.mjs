#!/usr/bin/env node
// =====================================================
// PULODOGATO - pagar a fatura do cartao: a decisao e os dois pedidos (HMO-312)
// =====================================================
//   npm run test:pagamento-da-fatura
//
// `lib/pagamento-da-fatura.ts` e o caminho de "informei que paguei a fatura"
// extraido de dentro de `app/(dashboard)/dashboard/bills/page.tsx` (F13 da
// HMO-309). Esta suite existe por dois modos de falha, e os dois sao SILENCIOSOS:
//
// 1. OS TRES SABORES DE FATURA, E SO UM PRECISA DE `close`.
//    A fatura ABERTA sintetizada, a fatura FECHADA na agenda, e a previsao que
//    a pessoa LIGOU a fatura (HMO-305) casam todas pelo mesmo critério. O que
//    separa UMA escrita de DUAS e se a linha esta GRAVADA. Trocar `gravada` por
//    `natureza` naquele galho fecha a fatura do CARTAO quando a pessoa pagou a
//    previsao da CONTA CORRENTE: o `close` responde 200, a fatura do mes vira
//    uma conta a pagar de verdade, e o mes passa a cobrar a divida duas vezes.
//    Nada levanta excecao, nada aparece no `tsc`, e os dois numeros na tela sao
//    plausiveis.
//
// 2. O 409 DO `close` NAO E ERRO.
//    Ele vem com `scheduled_transaction_id` e e o que acontece quando outra aba
//    (ou o botao "Fechar fatura" de Orcamentos) fechou a fatura entre a
//    abertura do dialogo e o clique. Tratar como falha nao perde dinheiro --
//    perde o clique, e a pessoa tenta de novo e ve o mesmo erro, porque o
//    estado nao vai mudar. Este galho e o unico motivo de a sequencia ser
//    EXTRAIDA em vez de copiada na tela de Despesas.
//
// O QUE ESTA SUITE NAO COBRE
// --------------------------
// O `fetch` acontecendo e a tela recarregando. Isto afirma sobre as funcoes
// puras; a sequencia com rede e
// `components/fatura/DialogoDePagamentoDaFatura.tsx`, e a escrita de verdade
// (saldo da conta pagadora ANTES -> DEPOIS) e a verificacao da F14.
//
// DOIS FUSOS: tudo que toca `mes`/`invoice_month` aqui e manipulacao de STRING
// (`slice`, split), nunca `new Date()`. A suite roda em UTC e em
// America/Sao_Paulo no CI, e os dois tem de dar o mesmo resultado -- a sandbox
// e Sao Paulo e o CI e UTC, e um teste que so roda num deles nao ve o bug.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  AVISO_DA_FATURA_ABERTA,
  ERRO_DO_FECHAMENTO,
  FRASE_DO_PATRIMONIO_ANTES,
  FRASE_DO_PATRIMONIO_DEPOIS,
  FRASE_SEM_CONTA_PAGADORA,
  ROTA_DE_FECHAMENTO,
  avisoDaFaturaAberta,
  chaveDaEscrita,
  contasQuePodemPagar,
  faturaDepoisDoFechamento,
  faturaPagavelDaAgenda,
  hojeEmSaoPaulo,
  pedidoDeBaixaDaFatura,
  pedidoDeFechamento,
  precisaFecharAFatura,
  toastDaFaturaPaga,
} = await import("../.tmp-pagamento-da-fatura/pagamento-da-fatura.js");

const CARTAO = "33333333-3333-4333-b333-333333333333";
const CORRENTE = "44444444-4444-4444-b444-444444444444";
const MES = "2026-10-01";
const CHAVE = `fatura:${MES}:${CARTAO}`;
const ID_DA_LINHA = "55555555-5555-4555-b555-555555555555";

// ---------------------------------------------------------------------------
// OS TRES SABORES, COMO CONTAS A PAGAR OS RECEBE
// ---------------------------------------------------------------------------

/** 1) A fatura ABERTA sintetizada (HMO-227): `id: null`, nao existe no banco. */
const faturaAberta = (extra = {}) => ({
  id: null,
  fatura_prevista: true,
  account_id: CARTAO,
  account_name: "Nubank",
  invoice_month: MES,
  description: "Fatura Nubank 10/2026",
  amount: 1000,
  due_date: "2026-10-10",
  status: "pending",
  effective_status: "pending",
  days_until_due: 5,
  direction: "expense",
  notes: CHAVE,
  group_id: null,
  recurring_rule_id: null,
  ...extra,
});

/** 2) A fatura FECHADA na agenda: linha real, com a chave canonica em `notes`. */
const faturaFechada = (extra = {}) => ({
  id: ID_DA_LINHA,
  description: "Fatura Nubank 10/2026",
  amount: 1000,
  due_date: "2026-10-10",
  notes: CHAVE,
  account_id: CARTAO,
  ...extra,
});

/**
 * 3) A previsao DIGITADA que a pessoa ligou a fatura (HMO-305).
 *
 * E A ARMADILHA DESTA ISSUE, e o que a distingue da 2 nao e nada no formato: e
 * que `account_id` aqui e a CONTA CORRENTE. A chave em `notes` aponta para a
 * fatura do cartao, e e por isso que `cartaoId` sai da chave e nao do campo.
 */
const previsaoLigada = (extra = {}) => ({
  id: "66666666-6666-4666-b666-666666666666",
  description: "Cartão Nubank",
  amount: 980,
  due_date: "2026-10-10",
  notes: CHAVE,
  account_id: CORRENTE,
  ...extra,
});

/** Uma conta a pagar comum: nao e fatura, nao abre dialogo nenhum. */
const contaComum = (extra = {}) => ({
  id: "77777777-7777-4777-b777-777777777777",
  description: "Aluguel",
  amount: 2500,
  due_date: "2026-10-05",
  notes: "pago no debito",
  account_id: CORRENTE,
  ...extra,
});

// ===========================================================================
// O GALHO QUE DECIDE DINHEIRO: `gravada`, E NAO `natureza`
// ===========================================================================

test("so a fatura ABERTA precisa de close -- as outras duas, nao", () => {
  assert.equal(precisaFecharAFatura(faturaAberta()), true);
  // Se qualquer uma destas duas virar `true`, o `close` fecha a fatura do
  // cartao por conta propria: o mes passa a cobrar a divida duas vezes.
  assert.equal(precisaFecharAFatura(faturaFechada()), false);
  assert.equal(precisaFecharAFatura(previsaoLigada()), false);
});

test("a previsao LIGADA a fatura tem natureza de fatura e NAO leva close", () => {
  // Ela casa em TODO critério de "e fatura" -- `notes` e a chave canonica --, e
  // e exatamente por isso que o galho nao pode ser esse critério. O teste
  // afirma as duas coisas juntas para que nenhuma possa ser "consertada" sozinha.
  const linha = previsaoLigada();
  const fatura = faturaPagavelDaAgenda(linha);
  assert.ok(fatura, "a previsao ligada tem de abrir o dialogo da conta pagadora");
  assert.equal(fatura.precisaFechar, false);
  assert.equal(pedidoDeFechamento(fatura), null);
});

test("a fatura ABERTA vira descritor sem id, com o cartao e o mes do close", () => {
  const fatura = faturaPagavelDaAgenda(faturaAberta());
  assert.deepEqual(fatura, {
    id: null,
    descricao: "Fatura Nubank 10/2026",
    valor: 1000,
    vencimento: "2026-10-10",
    precisaFechar: true,
    cartaoId: CARTAO,
    mes: MES,
  });
});

test("a fatura FECHADA vira descritor COM id e sem close", () => {
  const fatura = faturaPagavelDaAgenda(faturaFechada());
  assert.deepEqual(fatura, {
    id: ID_DA_LINHA,
    descricao: "Fatura Nubank 10/2026",
    valor: 1000,
    vencimento: "2026-10-10",
    precisaFechar: false,
    cartaoId: CARTAO,
    mes: MES,
  });
});

test("o cartao sai da CHAVE, e nao do account_id -- na previsao ligada os dois discordam", () => {
  const fatura = faturaPagavelDaAgenda(previsaoLigada());
  // `account_id` da linha e a conta corrente. Ler dali poria a conta corrente
  // no corpo do `close` de uma fatura de cartao.
  assert.equal(fatura.cartaoId, CARTAO);
  assert.notEqual(fatura.cartaoId, CORRENTE);
  assert.equal(fatura.mes, MES);
});

test("a conta comum NAO e fatura: nada de dialogo de conta pagadora", () => {
  assert.equal(faturaPagavelDaAgenda(contaComum()), null);
  // Sem `notes`, e com uma anotacao livre que PARECE a chave mas nao e: a
  // ancora nas duas pontas do regex e o que separa as duas.
  assert.equal(faturaPagavelDaAgenda(contaComum({ notes: null })), null);
  assert.equal(
    faturaPagavelDaAgenda(contaComum({ notes: `${CHAVE} paguei no debito` })),
    null
  );
});

test("numeric como string do PostgREST ainda vira numero", () => {
  const fatura = faturaPagavelDaAgenda(faturaFechada({ amount: "1000.50" }));
  assert.equal(fatura.valor, 1000.5);
});

// ===========================================================================
// OS DOIS PEDIDOS
// ===========================================================================

test("o close leva o cartao e o mes em AAAA-MM", () => {
  const fatura = faturaPagavelDaAgenda(faturaAberta());
  assert.deepEqual(pedidoDeFechamento(fatura), {
    metodo: "POST",
    url: ROTA_DE_FECHAMENTO,
    // 'AAAA-MM' e nao 'AAAA-MM-01': a rota recusa o dia.
    corpo: { account_id: CARTAO, month: "2026-10" },
  });
});

test("a baixa leva paid_date E payment_account_id", () => {
  const fatura = faturaPagavelDaAgenda(faturaFechada());
  assert.deepEqual(pedidoDeBaixaDaFatura(fatura, CORRENTE, "2026-10-05"), {
    metodo: "POST",
    url: `/api/scheduled-transactions/${ID_DA_LINHA}/pay`,
    corpo: { paid_date: "2026-10-05", payment_account_id: CORRENTE },
  });
});

test("sem conta pagadora, e sem id, NAO existe pedido de baixa", () => {
  const aberta = faturaPagavelDaAgenda(faturaAberta());
  // O `null` e o contrato: ele e o que torna impossivel montar
  // `/api/scheduled-transactions/null/pay` com a fatura que nao existe no banco.
  assert.equal(pedidoDeBaixaDaFatura(aberta, CORRENTE, "2026-10-05"), null);

  const fechada = faturaPagavelDaAgenda(faturaFechada());
  // E um POST sem `payment_account_id` volta recusado pela rota com
  // `mensagemContaPagadora("ausente")` -- melhor nao sair.
  assert.equal(pedidoDeBaixaDaFatura(fechada, "", "2026-10-05"), null);
});

// ===========================================================================
// O 409 NAO E ERRO
// ===========================================================================

test("o close bem-sucedido devolve a fatura com o id da linha real", () => {
  const aberta = faturaPagavelDaAgenda(faturaAberta());
  const r = faturaDepoisDoFechamento(aberta, {
    ok: true,
    status: 201,
    dados: { scheduled_transaction: { id: ID_DA_LINHA } },
  });
  assert.ok("fatura" in r);
  assert.equal(r.fatura.id, ID_DA_LINHA);
  // E ela NAO precisa mais de close: fechar de novo criaria a segunda linha.
  assert.equal(r.fatura.precisaFechar, false);
  // O resto do descritor sobrevive -- o toast e o dialogo leem a descricao.
  assert.equal(r.fatura.descricao, "Fatura Nubank 10/2026");
  assert.equal(r.fatura.valor, 1000);
  assert.equal(r.fatura.cartaoId, CARTAO);
  assert.equal(r.fatura.mes, MES);
});

test("409 'ja foi fechada' NAO e erro: segue com o id que a outra aba criou", () => {
  const aberta = faturaPagavelDaAgenda(faturaAberta());
  const r = faturaDepoisDoFechamento(aberta, {
    ok: false,
    status: 409,
    dados: {
      error: "Esta fatura já foi fechada",
      scheduled_transaction_id: ID_DA_LINHA,
    },
  });
  assert.ok(
    "fatura" in r,
    "o 409 com id e a corrida de duas abas, e o resultado certo e seguir"
  );
  assert.equal(r.fatura.id, ID_DA_LINHA);
  assert.equal(r.fatura.precisaFechar, false);
});

test("409 SEM id ainda e erro -- nao ha com o que seguir", () => {
  const aberta = faturaPagavelDaAgenda(faturaAberta());
  const r = faturaDepoisDoFechamento(aberta, {
    ok: false,
    status: 409,
    dados: { error: "Esta fatura já foi fechada" },
  });
  assert.deepEqual(r, { erro: "Esta fatura já foi fechada" });
});

test("o erro do close vem da rota, com fallback proprio", () => {
  const aberta = faturaPagavelDaAgenda(faturaAberta());
  assert.deepEqual(
    faturaDepoisDoFechamento(aberta, {
      ok: false,
      status: 400,
      dados: { error: "Configure o dia de vencimento do cartão" },
    }),
    { erro: "Configure o dia de vencimento do cartão" }
  );
  assert.deepEqual(
    faturaDepoisDoFechamento(aberta, { ok: false, status: 500, dados: {} }),
    { erro: ERRO_DO_FECHAMENTO }
  );
  // 200 sem id e resposta incompleta, nao sucesso: seguir daria
  // `/scheduled-transactions/undefined/pay`.
  assert.deepEqual(
    faturaDepoisDoFechamento(aberta, {
      ok: true,
      status: 200,
      dados: { scheduled_transaction: null },
    }),
    { erro: ERRO_DO_FECHAMENTO }
  );
});

// ===========================================================================
// A CHAVE DO SPINNER MUDA NO MEIO DA SEQUENCIA
// ===========================================================================

test("a chave da escrita e a canonica na aberta e o id na gravada", () => {
  const aberta = faturaPagavelDaAgenda(faturaAberta());
  // A MESMA chave que `notes` carrega, e a mesma que o `close` vai gravar: com
  // `null` toda linha sintetizada giraria o spinner ao mesmo tempo.
  assert.equal(chaveDaEscrita(aberta), CHAVE);
  assert.equal(chaveDaEscrita(aberta), faturaAberta().notes);

  const gravada = faturaPagavelDaAgenda(faturaFechada());
  assert.equal(chaveDaEscrita(gravada), ID_DA_LINHA);

  // E as duas sao DIFERENTES na mesma fatura: e por isso que o botao do dialogo
  // nao pode comparar com uma delas -- ficaria clicavel entre as duas escritas.
  const depois = faturaDepoisDoFechamento(aberta, {
    ok: true,
    status: 201,
    dados: { scheduled_transaction: { id: ID_DA_LINHA } },
  });
  assert.notEqual(chaveDaEscrita(depois.fatura), chaveDaEscrita(aberta));
});

// ===========================================================================
// QUEM PODE PAGAR, E AS FRASES
// ===========================================================================

test("cartao de credito nao paga fatura de cartao", () => {
  const contas = [
    { id: CORRENTE, name: "Conta corrente", account_type: "checking" },
    { id: CARTAO, name: "Nubank", account_type: "credit_card" },
    { id: "c3", name: "Carteira", account_type: "cash" },
    { id: "c4", name: "Sem tipo", account_type: null },
  ];
  assert.deepEqual(
    contasQuePodemPagar(contas).map((c) => c.id),
    [CORRENTE, "c3", "c4"]
  );
});

test("o aviso de valor congelado aparece SO na fatura aberta", () => {
  const aberta = faturaPagavelDaAgenda(faturaAberta());
  assert.equal(avisoDaFaturaAberta(aberta), AVISO_DA_FATURA_ABERTA);
  // Na fechada o valor nao muda mais, e o aviso ali seria falso.
  assert.equal(avisoDaFaturaAberta(faturaPagavelDaAgenda(faturaFechada())), null);
  assert.equal(avisoDaFaturaAberta(faturaPagavelDaAgenda(previsaoLigada())), null);
});

test("as duas frases de patrimonio dizem que ele NAO muda", () => {
  // Elas sao metade da feature: quem informa R$ 1.000 e ve o patrimonio parado
  // conclui que a tela nao registrou, e registra de novo. A assercao e sobre o
  // que a frase AFIRMA, nao sobre o texto inteiro.
  for (const frase of [FRASE_DO_PATRIMONIO_ANTES, FRASE_DO_PATRIMONIO_DEPOIS]) {
    assert.match(frase, /patrimônio/);
    assert.match(frase, /não muda|fica igual/);
  }
  assert.match(FRASE_DO_PATRIMONIO_ANTES, /não é um gasto novo/);
  assert.match(FRASE_DO_PATRIMONIO_DEPOIS, /quitou o cartão/);
});

test("a frase de nenhuma conta pagadora diz o que cadastrar", () => {
  assert.match(FRASE_SEM_CONTA_PAGADORA, /Cadastre/);
  assert.match(FRASE_SEM_CONTA_PAGADORA, /cartão de crédito não paga/);
});

test("o toast de fallback usa a descricao da fatura", () => {
  const fatura = faturaPagavelDaAgenda(faturaAberta());
  assert.equal(toastDaFaturaPaga(fatura), "Fatura Nubank 10/2026 paga");
});

// ===========================================================================
// OS DOIS FUSOS
// ===========================================================================

test("o mes do close nao passa por new Date() -- o dia 01 nao recua", () => {
  // 'AAAA-MM-01' lido como UTC e formatado no fuso do Brasil volta para o dia
  // 30 do mes anterior, e a fatura de marco seria fechada como a de fevereiro.
  // `slice` de string nao tem fuso: esta assercao e a mesma em UTC e em
  // America/Sao_Paulo, e o CI roda os dois.
  const marco = faturaPagavelDaAgenda(
    faturaAberta({ invoice_month: "2026-03-01", notes: `fatura:2026-03-01:${CARTAO}` })
  );
  assert.equal(pedidoDeFechamento(marco).corpo.month, "2026-03");
});

test("hojeEmSaoPaulo devolve AAAA-MM-DD no fuso de Sao Paulo", () => {
  const hoje = hojeEmSaoPaulo();
  assert.match(hoje, /^\d{4}-\d{2}-\d{2}$/);
  // O que isto fixa e que a data NAO e a do UTC quando os dois discordam: as
  // 21h de Sao Paulo o UTC ja esta no dia seguinte, e a baixa cairia no dia --
  // as vezes no MES -- errado. A comparacao e com o formatador de Sao Paulo
  // explicito, que e verdade nos dois fusos de CI.
  const esperado = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  assert.equal(hoje, esperado);
});
