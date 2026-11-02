// =====================================================
// O RESULTADO DO MES UNICO (mapa do projeto, prioridade 1)
// =====================================================
// lib/services/resultado-do-mes.ts e a leitura que o painel, os relatorios,
// Financas Pessoais e o resumo mensal passaram a compartilhar. Esta suite chama
// o servico com o duble do Supabase (scripts/duble-de-supabase.mjs), que
// APLICA os filtros, e mede o numero que sai.
//
// O que cada secao prende:
//
//   1. AS CINCO PERNAS JUNTAS. Uma fixture com uma linha de cada perna, cada
//      uma com um valor distinto, e o total esperado escrito a mao. Perder
//      qualquer perna muda o total para um numero que a secao reconhece.
//   2. A PAGINACAO. 1001 lancamentos, o ultimo diferente: o total so fecha se
//      a segunda pagina entrar. E o defeito dos cartoes de Financas Pessoais,
//      que somavam so a pagina carregada.
//   3. O QUE NAO E MEU NAO ENTRA. A despesa de outro membro (visivel pela RLS
//      de grupo) e a minha parte do que EU paguei (`paguei_eu`).
//   4. FALHA DIZ ONDE. Uma perna com erro devolve `ok: false` com a etapa, e
//      nao um total menor.
//   5. POR MES. `personal_monthly_cash_flow`, e a queda para
//      `monthly_cash_flow` SEM grupo quando a view ainda nao existe.
// =====================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { criarDuble } from "./duble-de-supabase.mjs";

const {
  lerResultadoDoPeriodo,
  lerResultadoPorMes,
  resumoNaMoeda,
  TAMANHO_DA_PAGINA_DO_RESULTADO,
} = await import("../.tmp-resultado-do-mes/lib/services/resultado-do-mes.js");

const EU = "11111111-1111-1111-1111-111111111111";
const OUTRO = "22222222-2222-2222-2222-222222222222";
const GRUPO = "99999999-9999-9999-9999-999999999999";

const DE = "2026-10-01";
const ATE = "2026-10-31";
const DIA = "2026-10-15";

const transacao = (extra) => ({
  user_id: EU,
  group_id: null,
  transaction_date: DIA,
  amount: -1,
  transaction_type: "expense",
  currency: "BRL",
  include_in_total: true,
  notes: null,
  counterpart_transaction_id: null,
  account: { account_type: "checking" },
  ...extra,
});

const parte = (extra) => ({
  user_id: EU,
  transaction_date: DIA,
  amount: 20,
  transaction_type: "expense",
  currency: "BRL",
  category_id: null,
  paguei_eu: false,
  ...extra,
});

/** Uma linha de cada perna. Os valores sao distintos de proposito. */
function fixtureDasCincoPernas() {
  return {
    financial_transactions: [
      // perna 1: receita e despesa minhas
      transacao({ id: "t-1", amount: 5000, transaction_type: "income" }),
      transacao({ id: "t-2", amount: -1000 }),
      // perna 1: a despesa de grupo que EU paguei, INTEIRA
      transacao({ id: "t-3", amount: -90, group_id: GRUPO }),
      // perna 1: compra no cartao -- SAI (entra pela fatura, perna 5)
      transacao({
        id: "t-4",
        amount: -300,
        account: { account_type: "credit_card" },
      }),
      // perna 1: fora dos totais -- SAI
      transacao({ id: "t-5", amount: -7, include_in_total: false }),
    ],
    group_share_entries: [
      // perna 2: a minha parte do que OUTRO pagou
      parte({ id: "p-1", amount: 20 }),
      // a minha parte do que EU paguei -- ja veio inteira na perna 1
      parte({ id: "p-2", amount: 30, paguei_eu: true }),
    ],
    group_closing_entries: [
      // perna 3: o "Pagamento ao grupo" quitado
      {
        id: "f-1",
        user_id: EU,
        transaction_date: DIA,
        amount: 40,
        transaction_type: "expense",
        currency: "BRL",
        category_id: null,
      },
    ],
    mybank_interest_entries: [
      // perna 4: o juro pago do MyBank
      {
        id: "j-1",
        user_id: EU,
        transaction_date: DIA,
        amount: 3,
        transaction_type: "expense",
        currency: "BRL",
        category_id: null,
      },
    ],
    card_invoice_paid_entries: [
      // perna 5: a fatura paga, pelo vencimento
      {
        id: "c-1",
        user_id: EU,
        account_id: "cartao",
        invoice_month: "2026-09-01",
        due_date: "2026-10-05",
        paid_date: "2026-10-03",
        category_id: null,
        invoice_amount: "400.00",
        currency: "BRL",
        include_in_total: true,
      },
    ],
  };
}

test("1. as cinco pernas entram, cada uma uma vez", async () => {
  const { client } = criarDuble({ user: { id: EU }, tabelas: fixtureDasCincoPernas() });

  const r = await lerResultadoDoPeriodo(client, EU, {
    de: DE,
    ate: ATE,
    moedaOficial: "BRL",
  });

  assert.equal(r.ok, true, JSON.stringify(r));
  const resumo = resumoNaMoeda(r);

  // 1000 + 90 (meu, inteiro) + 20 (minha parte) + 40 (fechamento) + 3 (juros)
  // + 400 (fatura) = 1553. Sem a compra no cartao (300) e sem o fora dos
  // totais (7), e sem a minha parte do que eu paguei (30).
  assert.equal(resumo.total_expense, 1553);
  assert.equal(resumo.total_income, 5000);
  assert.equal(resumo.net, 5000 - 1553);
  assert.equal(r.principal.currency, "BRL");
});

test("2. a segunda pagina entra no total", async () => {
  const volume = [];
  for (let i = 0; i < TAMANHO_DA_PAGINA_DO_RESULTADO; i++) {
    volume.push(transacao({ id: `t-${String(i).padStart(6, "0")}`, amount: -1 }));
  }
  // a unica que so existe na segunda pagina
  volume.push(transacao({ id: "t-999999", amount: -777.77 }));

  const { client } = criarDuble({
    user: { id: EU },
    tabelas: { financial_transactions: volume },
  });

  const r = await lerResultadoDoPeriodo(client, EU, {
    de: DE,
    ate: ATE,
    moedaOficial: "BRL",
  });

  assert.equal(r.ok, true);
  assert.equal(
    resumoNaMoeda(r).total_expense,
    Number((TAMANHO_DA_PAGINA_DO_RESULTADO + 777.77).toFixed(2))
  );
});

test("3. a despesa de OUTRO membro e o fora do periodo ficam de fora", async () => {
  const { client } = criarDuble({
    user: { id: EU },
    tabelas: {
      financial_transactions: [
        transacao({ id: "t-1", amount: -100 }),
        // de outro membro, visivel pela RLS de grupo
        transacao({ id: "t-2", amount: -500, user_id: OUTRO, group_id: GRUPO }),
        // fora do periodo
        transacao({ id: "t-3", amount: -900, transaction_date: "2026-11-01" }),
      ],
      group_share_entries: [
        // a parte de OUTRO membro numa despesa que eu nao paguei
        parte({ id: "p-1", amount: 60, user_id: OUTRO }),
      ],
    },
  });

  const r = await lerResultadoDoPeriodo(client, EU, {
    de: DE,
    ate: ATE,
    moedaOficial: "BRL",
  });

  assert.equal(r.ok, true);
  assert.equal(resumoNaMoeda(r).total_expense, 100);
});

test("3b. faturaAte estende so a fatura paga, e nao o resto", async () => {
  const tabelas = fixtureDasCincoPernas();
  tabelas.card_invoice_paid_entries[0].due_date = "2026-10-25";
  const { client } = criarDuble({ user: { id: EU }, tabelas });

  const ateHoje = await lerResultadoDoPeriodo(client, EU, {
    de: DE,
    ate: "2026-10-20",
    moedaOficial: "BRL",
  });
  const comFatura = await lerResultadoDoPeriodo(client, EU, {
    de: DE,
    ate: "2026-10-20",
    faturaAte: ATE,
    moedaOficial: "BRL",
  });

  assert.equal(resumoNaMoeda(comFatura).total_expense - resumoNaMoeda(ateHoje).total_expense, 400);
});

test("4. uma perna com erro devolve a etapa, e nao um total menor", async () => {
  const { client } = criarDuble({
    user: { id: EU },
    tabelas: fixtureDasCincoPernas(),
    erros: { financial_transactions: { code: "XX000", message: "caiu" } },
  });

  const r = await lerResultadoDoPeriodo(client, EU, {
    de: DE,
    ate: ATE,
    moedaOficial: "BRL",
  });

  assert.equal(r.ok, false);
  assert.equal(r.etapa, "transacoes");
});

test("4b. a view da parte ausente (antes da 033) nao derruba o Resultado", async () => {
  const { client } = criarDuble({
    user: { id: EU },
    tabelas: { financial_transactions: [transacao({ id: "t-1", amount: -100 })] },
    erros: { group_share_entries: { code: "42P01", message: "relation does not exist" } },
  });

  const r = await lerResultadoDoPeriodo(client, EU, {
    de: DE,
    ate: ATE,
    moedaOficial: "BRL",
  });

  assert.equal(r.ok, true);
  assert.equal(resumoNaMoeda(r).total_expense, 100);
});

test("5. por mes le personal_monthly_cash_flow, so do usuario", async () => {
  const { client } = criarDuble({
    user: { id: EU },
    tabelas: {
      personal_monthly_cash_flow: [
        { user_id: EU, month: "2026-09-01", income: "5000", expense: "1553", net: "3447", transaction_count: 9, currency: "BRL" },
        { user_id: EU, month: "2026-09-01", income: "0", expense: "10", net: "-10", transaction_count: 1, currency: "USD" },
        { user_id: OUTRO, month: "2026-09-01", income: "1", expense: "999", net: "-998", transaction_count: 1, currency: "BRL" },
      ],
    },
  });

  const r = await lerResultadoPorMes(client, EU, { desde: "2026-09-01", moeda: "BRL" });

  assert.equal(r.ok, true);
  assert.equal(r.criterioAntigo, false);
  assert.deepEqual(r.meses, [
    { month: "2026-09-01", income: 5000, expense: 1553, net: 3447, transaction_count: 9, currency: "BRL" },
  ]);
});

test("5b. sem a view pessoal, cai na antiga SEM as linhas de grupo", async () => {
  const { client } = criarDuble({
    user: { id: EU },
    tabelas: {
      monthly_cash_flow: [
        { user_id: EU, group_id: null, month: "2026-09-01", income: 100, expense: 40, net: 60, transaction_count: 2, currency: "BRL" },
        // a viagem inteira que eu paguei: no criterio antigo ela somaria no
        // resumo pessoal
        { user_id: EU, group_id: GRUPO, month: "2026-09-01", income: 0, expense: 900, net: -900, transaction_count: 1, currency: "BRL" },
      ],
    },
    erros: { personal_monthly_cash_flow: { code: "42P01", message: "relation does not exist" } },
  });

  const r = await lerResultadoPorMes(client, EU, { desde: "2026-09-01" });

  assert.equal(r.ok, true);
  assert.equal(r.criterioAntigo, true);
  assert.equal(r.meses.length, 1);
  assert.equal(r.meses[0].expense, 40);
});
