#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DA PROJECAO POR CONTA
// =====================================================
//   npm run test:projecao
//
// Exercita lib/projecao.ts, a aritmetica que a GET /api/projection publica e
// que a tela de orcamentos le. Antes da HMO-342 essa rota era o unico
// agregador de dinheiro do repositorio SEM teste nenhum -- e ela errava a
// fatura. O que este arquivo protege, em ordem de quanto custa errar:
//
//   1. A FATURA FECHADA CONTADA DUAS VEZES. O mesmo dinheiro mora no saldo
//      negativo do cartao (as compras ja rebaixaram o `current_balance` no
//      INSERT) e na conta prevista que o fechamento pendura no PROPRIO cartao.
//      Medido em producao: fechar uma fatura de R$ 300 derrubava o
//      `projected_total` em R$ 300 sem nenhum fato novo.
//
//   2. A ASSINATURA COBRADA NO CARTAO, que NAO e fatura e DEVE continuar
//      descontando. E o controle que separa o criterio certo (a chave canonica
//      em `notes`) do conserto tentador e errado (excluir por `account_type`).
//      Sem este caso, trocar `ehFatura(p.notes)` por
//      `account_type === "credit_card"` passaria verde.
//
//   3. A PREVISTA SEM CONTA. Ela nao tem onde somar por conta, mas o dinheiro
//      sai mesmo: tem de entrar nos TOTAIS. Esquecer isso deixa a lista por
//      conta certa e o total otimista.
//
//   4. VENCIDO. Conta atrasada continua sendo dinheiro que vai sair, e entra
//      no horizonte mesmo tendo vencido antes de hoje.
//
//   5. O BADGE "fica negativa" NOS DOIS LADOS DA BORDA. Ele so avisa quando a
//      projecao MUDA a resposta: saldo de hoje exatamente 0 avisa, saldo de
//      hoje ja negativo nao. A igualdade do `>= 0` e o que se mede aqui.
//
//   6. OS TOTAIS, que sao o que a tela de orcamentos mostra em tres lugares.
//
// Mesmo desenho do test-safe-to-spend.mjs: .mjs rodando o JS que o tsc emitiu,
// com o passo de reescrita de alias no meio, sem runner novo.
//
// Nao se testa a ROTA com duble de client: a consulta de previstas usa embed
// (`recurring_rule:recurring_rules(transaction_type)`), e duble de rota com
// embed projeta `undefined` em tudo -- o teste passaria sem ver nada. E por
// isso que a aritmetica foi extraida para o lib.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { calcularProjecao, fimDoMes, tipoDaPrevista } = await import(
  "../.tmp-projecao/projecao.js"
);

const { chaveFatura } = await import("../.tmp-projecao/chave-da-fatura.js");

// ---------------------------------------------------------------------------
// Cenario base: uma corrente com 1.000, um cartao com R$ 300 de compras ja no
// saldo, nada previsto. Cada teste abaixo muda UMA coisa -- e o que deixa a
// diferenca de valor atribuivel aquela mudanca, e nao a soma de varias.
// ---------------------------------------------------------------------------
const HOJE = "2026-10-08";
const ATE = "2026-10-31";
const CORRENTE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const CARTAO_ID = "11111111-2222-3333-4444-555555555555";

const corrente = (saldo = 1000) => ({
  id: CORRENTE_ID,
  name: "Conta corrente",
  account_type: "checking",
  current_balance: saldo,
});

const cartao = (saldo = -300) => ({
  id: CARTAO_ID,
  name: "Cartao Nubank",
  account_type: "credit_card",
  current_balance: saldo,
});

let seq = 0;
const prevista = (extra = {}) => ({
  id: `prev-${++seq}`,
  account_id: null,
  amount: 100,
  due_date: "2026-10-20",
  notes: null,
  recurring_rule: null,
  ...extra,
});

/**
 * A conta prevista que `POST /api/card-invoices/close` cria.
 *
 * `notes` e EXATAMENTE a chave canonica, como a rota de fechamento grava: a
 * `RE_CHAVE_FATURA` e ancorada nas duas pontas, de proposito. Montar a chave
 * pela funcao de producao e o que impede este arquivo de testar uma string
 * inventada -- se o formato da chave mudar, os casos daqui mudam com ele.
 */
const faturaFechada = (total = 300, mes = "2026-10-01", vencimento = "2026-10-15") =>
  prevista({
    account_id: CARTAO_ID,
    amount: total,
    due_date: vencimento,
    notes: chaveFatura(mes, CARTAO_ID),
  });

const calcula = (contas, previstas, hoje = HOJE, ate = ATE) =>
  calcularProjecao({ contas, previstas, hoje, ate });

const doCartao = (r) => r.accounts.find((a) => a.account_id === CARTAO_ID);
const daCorrente = (r) => r.accounts.find((a) => a.account_id === CORRENTE_ID);

// ---------------------------------------------------------------------------
// 1. A FATURA FECHADA FICA FORA (o defeito da HMO-293)
// ---------------------------------------------------------------------------

test("a fatura fechada nao entra no scheduled_out do cartao", () => {
  const r = calcula([corrente(), cartao(-300)], [faturaFechada(300)]);

  assert.equal(doCartao(r).scheduled_out, 0);
  assert.equal(doCartao(r).projected_balance, -300);
  assert.equal(r.scheduled_out, 0);
  assert.equal(r.projected_total, 700);
});

test("fechar a fatura nao muda numero nenhum da projecao", () => {
  // A medicao em producao, reproduzida: o saldo do cartao e o mesmo antes e
  // depois do clique em "fechar" (fechar nao mexe no saldo), entao a projecao
  // tambem tem de ser. O delta ZERO e a prova -- mais forte que olhar o numero
  // final, porque nao depende do baseline.
  const antes = calcula([corrente(), cartao(-300)], []);
  const depois = calcula([corrente(), cartao(-300)], [faturaFechada(300)]);

  assert.equal(depois.projected_total - antes.projected_total, 0);
  assert.equal(
    doCartao(depois).projected_balance - doCartao(antes).projected_balance,
    0
  );
  assert.equal(depois.scheduled_out - antes.scheduled_out, 0);
});

test("a fatura fechada e ATRASADA tambem nao conta como vencida", () => {
  // O vencimento e anterior a HOJE, entao sem a exclusao esta linha entraria
  // no `overdue_total` -- o "contas atrasadas" da tela. Precisa do vencimento
  // no passado para medir: com a fatura vencendo no futuro o caso ficaria
  // verde pelo horizonte, nao pela exclusao.
  const r = calcula(
    [corrente(), cartao(-300)],
    [faturaFechada(300, "2026-09-01", "2026-09-15")]
  );

  assert.equal(r.overdue_total, 0);
  assert.equal(doCartao(r).scheduled_out, 0);
});

test("duas faturas de meses diferentes no mesmo cartao ficam as duas fora", () => {
  const r = calcula(
    [corrente(), cartao(-800)],
    [
      faturaFechada(300, "2026-09-01", "2026-09-15"),
      faturaFechada(500, "2026-10-01"),
    ]
  );

  assert.equal(doCartao(r).scheduled_out, 0);
  assert.equal(r.scheduled_out, 0);
  assert.equal(r.projected_total, 200);
});

test("a fatura de um cartao ARQUIVADO nao reaparece nos totais", () => {
  // A rota so busca `is_active = true`, entao o cartao arquivado nao tem linha
  // e `porConta.get()` devolve undefined -- mesmo com `account_id` preenchido.
  // Se a exclusao da fatura dependesse de a conta existir na lista, a fatura
  // cairia no balde "sem conta" e voltaria a descontar no TOTAL, com a lista
  // por conta continuando certa: o defeito mais caro de achar.
  const r = calcula([corrente(1000)], [faturaFechada(300)]);

  assert.equal(r.scheduled_out, 0);
  assert.equal(r.projected_total, 1000);
  assert.equal(r.overdue_total, 0);
});

// ---------------------------------------------------------------------------
// 2. O CONTROLE QUE SEPARA `ehFatura` DE `account_type`
// ---------------------------------------------------------------------------

test("assinatura cobrada no cartao NAO e fatura e continua descontando", () => {
  // Netflix cadastrada como conta prevista com `account_id` do cartao. Nao tem
  // chave de fatura em `notes`, e pagar com o cartao rebaixa o cartao de
  // verdade. Excluir por `account_type` apagaria exatamente este caso.
  const assinatura = prevista({
    account_id: CARTAO_ID,
    amount: 55,
    notes: "Netflix",
  });

  const r = calcula([corrente(), cartao(-300)], [assinatura]);

  assert.equal(doCartao(r).scheduled_out, 55);
  assert.equal(doCartao(r).projected_balance, -355);
  assert.equal(r.scheduled_out, 55);
  assert.equal(r.projected_total, 645);
});

test("a fatura sai e a assinatura do MESMO cartao fica, na mesma leitura", () => {
  // O caso que nenhum criterio por tipo de conta consegue acertar: as duas
  // linhas estao no mesmo cartao, e uma tem de sair e a outra tem de ficar.
  const assinatura = prevista({
    account_id: CARTAO_ID,
    amount: 55,
    notes: "Netflix",
  });

  const r = calcula(
    [corrente(), cartao(-300)],
    [faturaFechada(300), assinatura]
  );

  assert.equal(doCartao(r).scheduled_out, 55);
  assert.equal(r.scheduled_out, 55);
});

test("notes sem a chave canonica nao exclui, mesmo citando a palavra fatura", () => {
  // A exclusao e pela CHAVE (`fatura:AAAA-MM:<uuid>`), nao pelo texto. Uma
  // descricao escrita a mao pelo usuario nao pode sumir do numero.
  const r = calcula(
    [corrente(), cartao(-300)],
    [
      prevista({
        account_id: CARTAO_ID,
        amount: 90,
        notes: "Fatura do cartao da loja, paguei no boleto",
      }),
    ]
  );

  assert.equal(doCartao(r).scheduled_out, 90);
});

// ---------------------------------------------------------------------------
// 3. PREVISTA SEM CONTA
// ---------------------------------------------------------------------------

test("prevista sem conta entra nos totais e em conta nenhuma", () => {
  const r = calcula([corrente(1000)], [prevista({ amount: 400 })]);

  assert.equal(daCorrente(r).scheduled_out, 0);
  assert.equal(daCorrente(r).projected_balance, 1000);
  assert.equal(r.scheduled_out, 400);
  assert.equal(r.projected_total, 600);
});

test("prevista apontando conta inativa (fora da lista) cai nos totais", () => {
  // A rota so busca `is_active = true`. Uma prevista pendurada numa conta
  // arquivada nao tem linha onde somar, mas o dinheiro sai mesmo.
  const r = calcula(
    [corrente(1000)],
    [prevista({ account_id: "ffffffff-0000-0000-0000-00000000000f", amount: 70 })]
  );

  assert.equal(r.scheduled_out, 70);
  assert.equal(r.projected_total, 930);
});

test("receita prevista sem conta entra no scheduled_in", () => {
  const r = calcula(
    [corrente(1000)],
    [
      prevista({
        amount: 250,
        recurring_rule: { transaction_type: "income" },
      }),
    ]
  );

  assert.equal(r.scheduled_in, 250);
  assert.equal(r.scheduled_out, 0);
  assert.equal(r.projected_total, 1250);
});

// ---------------------------------------------------------------------------
// 4. VENCIDO
// ---------------------------------------------------------------------------

test("conta vencida ainda nao paga continua descontando e soma em overdue", () => {
  const r = calcula(
    [corrente(1000)],
    [prevista({ account_id: CORRENTE_ID, amount: 120, due_date: "2026-10-01" })]
  );

  assert.equal(daCorrente(r).scheduled_out, 120);
  assert.equal(r.overdue_total, 120);
  assert.equal(r.projected_total, 880);
});

test("receita vencida nao entra no overdue_total", () => {
  const r = calcula(
    [corrente(1000)],
    [
      prevista({
        account_id: CORRENTE_ID,
        amount: 300,
        due_date: "2026-10-01",
        recurring_rule: { transaction_type: "income" },
      }),
    ]
  );

  assert.equal(r.overdue_total, 0);
  assert.equal(r.scheduled_in, 300);
});

test("prevista que vence HOJE nao e vencida", () => {
  const r = calcula(
    [corrente(1000)],
    [prevista({ account_id: CORRENTE_ID, amount: 120, due_date: HOJE })]
  );

  assert.equal(r.overdue_total, 0);
  assert.equal(daCorrente(r).scheduled_out, 120);
});

test("prevista depois do horizonte fica fora de tudo", () => {
  const r = calcula(
    [corrente(1000)],
    [
      prevista({ account_id: CORRENTE_ID, amount: 120, due_date: ATE }),
      prevista({
        account_id: CORRENTE_ID,
        amount: 999,
        due_date: "2026-11-01",
      }),
    ]
  );

  assert.equal(daCorrente(r).scheduled_out, 120);
  assert.equal(r.scheduled_out, 120);
  assert.equal(r.through, ATE);
});

// ---------------------------------------------------------------------------
// 5. O BADGE "fica negativa", NOS DOIS LADOS DA BORDA
// ---------------------------------------------------------------------------

test("saldo de hoje EXATAMENTE zero que fecha negativo avisa", () => {
  // A igualdade do `current_balance >= 0`. Com `> 0` este caso ficaria sem
  // aviso, e e o caso mais comum de quem zera a conta todo mes.
  const r = calcula(
    [corrente(0)],
    [prevista({ account_id: CORRENTE_ID, amount: 10 })]
  );

  assert.equal(daCorrente(r).projected_balance, -10);
  assert.equal(daCorrente(r).goes_negative, true);
});

test("saldo de hoje positivo que fecha negativo avisa", () => {
  const r = calcula(
    [corrente(100)],
    [prevista({ account_id: CORRENTE_ID, amount: 150 })]
  );

  assert.equal(daCorrente(r).goes_negative, true);
});

test("quem JA esta negativo hoje nao recebe o aviso", () => {
  const r = calcula(
    [corrente(-5)],
    [prevista({ account_id: CORRENTE_ID, amount: 10 })]
  );

  assert.equal(daCorrente(r).projected_balance, -15);
  assert.equal(daCorrente(r).goes_negative, false);
});

test("projecao que fecha EXATAMENTE em zero nao avisa", () => {
  const r = calcula(
    [corrente(100)],
    [prevista({ account_id: CORRENTE_ID, amount: 100 })]
  );

  assert.equal(daCorrente(r).projected_balance, 0);
  assert.equal(daCorrente(r).goes_negative, false);
});

test("cartao com fatura fechada nao ganha o badge", () => {
  // Confirmado na medicao em producao: `goes_negative: false` nas tres etapas.
  // O dano do defeito era todo em TOTAIS, nunca no badge.
  const r = calcula([corrente(), cartao(-300)], [faturaFechada(300)]);

  assert.equal(doCartao(r).goes_negative, false);
});

test("receita prevista pode TIRAR o aviso de uma conta", () => {
  const r = calcula(
    [corrente(100)],
    [
      prevista({ account_id: CORRENTE_ID, amount: 150 }),
      prevista({
        account_id: CORRENTE_ID,
        amount: 200,
        recurring_rule: { transaction_type: "income" },
      }),
    ]
  );

  assert.equal(daCorrente(r).projected_balance, 150);
  assert.equal(daCorrente(r).goes_negative, false);
});

// ---------------------------------------------------------------------------
// 6. TOTAIS, ORDEM E FORMA DA RESPOSTA
// ---------------------------------------------------------------------------

test("o saldo de hoje nao conta prevista nenhuma", () => {
  const r = calcula(
    [corrente(1000), cartao(-300)],
    [prevista({ account_id: CORRENTE_ID, amount: 400 }), faturaFechada(300)]
  );

  assert.equal(r.current_total, 700);
});

test("projected_total e o saldo de hoje menos o que sai mais o que entra", () => {
  const r = calcula(
    [corrente(1000), cartao(-300)],
    [
      prevista({ account_id: CORRENTE_ID, amount: 400 }),
      prevista({ amount: 100 }),
      prevista({
        account_id: CORRENTE_ID,
        amount: 250,
        recurring_rule: { transaction_type: "income" },
      }),
    ]
  );

  assert.equal(r.current_total, 700);
  assert.equal(r.scheduled_out, 500);
  assert.equal(r.scheduled_in, 250);
  assert.equal(r.projected_total, 450);
  assert.equal(
    r.projected_total,
    r.current_total - r.scheduled_out + r.scheduled_in
  );
});

test("a projecao por conta desconta o que sai e soma o que entra", () => {
  const r = calcula(
    [corrente(1000)],
    [
      prevista({ account_id: CORRENTE_ID, amount: 400 }),
      prevista({
        account_id: CORRENTE_ID,
        amount: 250,
        recurring_rule: { transaction_type: "income" },
      }),
    ]
  );

  assert.equal(daCorrente(r).scheduled_out, 400);
  assert.equal(daCorrente(r).scheduled_in, 250);
  assert.equal(daCorrente(r).projected_balance, 850);
});

test("a lista sai da conta mais apertada para a mais folgada", () => {
  const r = calcula([corrente(1000), cartao(-300)], []);

  assert.deepEqual(
    r.accounts.map((a) => a.account_id),
    [CARTAO_ID, CORRENTE_ID]
  );
});

test("conta sem nada previsto aparece com os campos zerados", () => {
  const r = calcula([corrente(1000)], []);

  assert.deepEqual(r.accounts, [
    {
      account_id: CORRENTE_ID,
      account_name: "Conta corrente",
      account_type: "checking",
      current_balance: 1000,
      scheduled_out: 0,
      scheduled_in: 0,
      projected_balance: 1000,
      goes_negative: false,
    },
  ]);
});

test("a forma da resposta e exatamente a que a tela le", () => {
  // A rota e cacheada pelo service worker: campo novo quase quebrou o painel
  // na HMO-187. Esta assercao e o que faz um campo a mais reprovar.
  const r = calcula([corrente(1000)], []);

  assert.deepEqual(Object.keys(r).sort(), [
    "accounts",
    "current_total",
    "overdue_total",
    "projected_total",
    "scheduled_in",
    "scheduled_out",
    "through",
  ]);
});

test("valor em string vindo do numeric do Postgres e numero aqui", () => {
  const r = calcula(
    [{ ...corrente(), current_balance: "1000.50" }],
    [prevista({ account_id: CORRENTE_ID, amount: "100.25" })]
  );

  assert.equal(r.current_total, 1000.5);
  assert.equal(r.scheduled_out, 100.25);
  assert.equal(r.projected_total, 900.25);
});

test("amount negativo entra como modulo", () => {
  const r = calcula(
    [corrente(1000)],
    [prevista({ account_id: CORRENTE_ID, amount: -400 })]
  );

  assert.equal(daCorrente(r).scheduled_out, 400);
  assert.equal(r.projected_total, 600);
});

// ---------------------------------------------------------------------------
// 7. A DIRECAO VEM DO TIPO DA REGRA, NAS DUAS FORMAS DO EMBED
// ---------------------------------------------------------------------------

test("o embed vem como objeto ou como array de um, e os dois leem igual", () => {
  assert.equal(
    tipoDaPrevista(prevista({ recurring_rule: { transaction_type: "income" } })),
    "income"
  );
  assert.equal(
    tipoDaPrevista(
      prevista({ recurring_rule: [{ transaction_type: "income" }] })
    ),
    "income"
  );
  assert.equal(tipoDaPrevista(prevista({ recurring_rule: null })), undefined);
});

test("receita chega igual pelas duas formas do embed", () => {
  const objeto = calcula(
    [corrente(1000)],
    [
      prevista({
        account_id: CORRENTE_ID,
        amount: 250,
        recurring_rule: { transaction_type: "income" },
      }),
    ]
  );
  const array = calcula(
    [corrente(1000)],
    [
      prevista({
        account_id: CORRENTE_ID,
        amount: 250,
        recurring_rule: [{ transaction_type: "income" }],
      }),
    ]
  );

  assert.equal(objeto.scheduled_in, 250);
  assert.deepEqual(array, objeto);
});

test("regra de despesa desconta, igual a prevista avulsa", () => {
  const r = calcula(
    [corrente(1000)],
    [
      prevista({
        account_id: CORRENTE_ID,
        amount: 400,
        recurring_rule: { transaction_type: "expense" },
      }),
    ]
  );

  assert.equal(daCorrente(r).scheduled_out, 400);
  assert.equal(daCorrente(r).scheduled_in, 0);
});

// ---------------------------------------------------------------------------
// 8. O HORIZONTE DEFAULT
// ---------------------------------------------------------------------------

test("fimDoMes devolve o ultimo dia, inclusive em fevereiro bissexto", () => {
  assert.equal(fimDoMes("2026-10-08"), "2026-10-31");
  assert.equal(fimDoMes("2026-02-10"), "2026-02-28");
  assert.equal(fimDoMes("2024-02-10"), "2024-02-29");
  assert.equal(fimDoMes("2026-04-01"), "2026-04-30");
});
