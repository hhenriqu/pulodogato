#!/usr/bin/env node
// =====================================================
// PULODOGATO - A FATURA DO PERIODO, E O QUE AINDA NAO E DELE (HMO-290)
// =====================================================
//   npm run test:fatura-do-periodo
//
// Exercita lib/fatura-do-periodo.ts, o modulo que tirou a tela de cartoes de
// cima do `current_balance`.
//
// O QUE ESTE ARQUIVO PROTEGE, em ordem de quanto custa errar:
//
//   1. `null` NAO E ZERO. A rota devolve uma entrada para TODO cartao ativo,
//      zerada quando o mes nao teve compra -- entao um cartao ausente da
//      resposta e um numero que a tela nao obteve, nao uma fatura vazia.
//      "Fatura de outubro: R$ 0,00" embaixo do nome do cartao certo e
//      indistinguivel de um mes sem compra nenhuma, e e a unica coisa aqui que
//      ninguem descobre olhando a tela.
//
//   2. A SOMA PARCIAL. Com um cartao fora da resposta, somar os outros produz
//      um total menor que o certo, plausivel, sob o rotulo "Faturas em aberto".
//      Ou todos os cartoes tem fatura, ou o total e `null`.
//
//   3. O CARTAO ERRADO. `somaDasFaturas` casa por `account_id`; com `[0]` a
//      lista mostraria o total do primeiro cartao embaixo do nome de todos.
//      Dois cartoes do mesmo dono, valores plausiveis, erro nenhum.
//
//   4. AS PARCELAS FUTURAS. Depois da troca, o risco de produto se inverte: a
//      tela para de exagerar a fatura e passa a esconder o que ja esta
//      comprometido. A derivacao sai de `installment_number` /
//      `installment_total` (035), nunca da `description` -- que o usuario pode
//      reescrever.
//
//   5. O SINAL. `total` ja vem com o sinal certo da view (`invoice_amount` e
//      `-amount`): a compra soma e o estorno abate. Um `Math.abs` aqui faria o
//      credito de R$ 50 aparecer como R$ 50 a pagar.
//
// Mesmo desenho do test-fatura-do-cartao.mjs: .mjs rodando o JS que o tsc
// emitiu, com o passo de reescrita de alias no meio, sem runner novo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  totalDaFatura,
  parcelasFuturasDaFatura,
  somaDasFaturas,
  somaDasParcelasFuturas,
} = await import("../.tmp-fatura-do-periodo/lib/fatura-do-periodo.js");

const NUBANK = "11111111-2222-3333-4444-555555555555";
const ITAU = "99999999-8888-7777-6666-555555555555";

/** Uma linha da fatura, do jeito que `card_invoice_lines` entrega. */
const linha = (extra = {}) => ({
  transaction_id: "t-1",
  user_id: "u-1",
  account_id: NUBANK,
  account_name: "Cartao Nubank",
  category_id: "c-1",
  description: "Compra",
  amount: -300,
  invoice_amount: 300,
  transaction_date: "2026-10-02",
  transaction_type: "expense",
  invoice_month: "2026-10-01",
  ...extra,
});

/** Uma fatura agregada, do jeito que `GET /api/card-invoices` devolve. */
const faturaDe = (accountId, total, lines = []) => ({
  account_id: accountId,
  account_name: accountId === NUBANK ? "Cartao Nubank" : "Cartao Itau",
  invoice_month: "2026-10-01",
  total,
  line_count: lines.length,
  lines,
});

// ---------------------------------------------------------------------------
// 1. `null` nao e zero -- a armadilha caseira deste modulo
// ---------------------------------------------------------------------------

test("cartao ausente da resposta devolve null, e NAO zero", () => {
  // O caso que a tela nao pode confundir: a rota zera o cartao sem compra, e
  // por isso a AUSENCIA so pode significar "nao deu para ler".
  assert.equal(totalDaFatura(null), null);
  assert.equal(totalDaFatura(undefined), null);
});

test("fatura zerada de verdade devolve 0, e nao null", () => {
  // O outro lado do item 1: o mes sem compra tem numero, e a tela pode dizer
  // R$ 0,00. Devolver `null` aqui esconderia um numero que a rota respondeu.
  assert.equal(totalDaFatura(faturaDe(NUBANK, 0)), 0);
});

test("numeric que chega como texto nao vira NaN", () => {
  assert.equal(totalDaFatura(faturaDe(NUBANK, "1234.56")), 1234.56);
});

test("total ilegivel devolve null, e nao zero", () => {
  // `NaN` sob o rotulo de fatura imprimiria "R$ NaN" ou, pior, viraria 0 num
  // `?? 0` qualquer lá na frente.
  assert.equal(totalDaFatura(faturaDe(NUBANK, "nao e numero")), null);
});

// ---------------------------------------------------------------------------
// 2. O sinal
// ---------------------------------------------------------------------------

test("mes com mais estorno que compra tem fatura NEGATIVA, e ela aparece assim", () => {
  // O cartao deve a voce. `Math.abs` aqui transformaria um credito de R$ 50 em
  // R$ 50 a pagar -- a mesma troca de sinal que a nota da SECAO 4 do 006
  // existe para evitar.
  assert.equal(totalDaFatura(faturaDe(NUBANK, -50)), -50);
});

// ---------------------------------------------------------------------------
// 3. A soma da lista, e a soma parcial que ela recusa
// ---------------------------------------------------------------------------

test("soma as faturas dos cartoes da lista", () => {
  const faturas = [faturaDe(NUBANK, 300), faturaDe(ITAU, 120.5)];
  assert.equal(somaDasFaturas(faturas, [NUBANK, ITAU]), 420.5);
});

test("falta a fatura de UM cartao: o total inteiro e null, nao a soma dos outros", () => {
  // O item 2 do cabecalho. R$ 300 sob "Faturas em aberto" com o Itau faltando
  // e um numero menor que o certo, e nada na tela diria que falta uma parcela.
  const faturas = [faturaDe(NUBANK, 300)];
  assert.equal(somaDasFaturas(faturas, [NUBANK, ITAU]), null);
});

test("leitura que nao voltou (null) nao vira total zero", () => {
  assert.equal(somaDasFaturas(null, [NUBANK]), null);
  assert.equal(somaDasFaturas(undefined, [NUBANK]), null);
});

test("lista vazia de cartoes soma zero -- nao ha o que faltar", () => {
  // O usuario sem cartao nenhum. `null` aqui faria a tela escrever
  // "indisponivel" para quem nao tem cartao, que e uma falha inventada.
  assert.equal(somaDasFaturas([], []), 0);
});

test("a fatura casa por account_id, nunca pela posicao na lista", () => {
  // Com `faturas[0]` este teste daria 300 para o Itau. Dois cartoes do mesmo
  // dono, valores plausiveis, erro nenhum -- o item 3 do cabecalho.
  const faturas = [faturaDe(NUBANK, 300), faturaDe(ITAU, 120)];
  assert.equal(somaDasFaturas(faturas, [ITAU]), 120);
});

test("fatura de cartao que nao esta na lista nao entra no total", () => {
  // O cartao arquivado com compra no mes aparece na view, e a lista mostra so
  // os ativos. Somar o que nao esta na tela faz o total nao fechar com a soma
  // dos cards que a pessoa ve.
  const faturas = [faturaDe(NUBANK, 300), faturaDe(ITAU, 120)];
  assert.equal(somaDasFaturas(faturas, [NUBANK]), 300);
});

// ---------------------------------------------------------------------------
// 4. As parcelas futuras
// ---------------------------------------------------------------------------

test("o caso da issue: 3.000 em 10x mostra 2.700 ainda por vir", () => {
  const fatura = faturaDe(NUBANK, 300, [
    linha({ invoice_amount: 300, installment_number: 1, installment_total: 10 }),
  ]);

  assert.equal(totalDaFatura(fatura), 300);
  assert.equal(parcelasFuturasDaFatura(fatura, NUBANK), 2700);
});

test("na ULTIMA parcela nao sobra nada por vir", () => {
  const fatura = faturaDe(NUBANK, 300, [
    linha({ invoice_amount: 300, installment_number: 10, installment_total: 10 }),
  ]);

  assert.equal(parcelasFuturasDaFatura(fatura, NUBANK), 0);
});

test("compra avulsa (sem as colunas de parcela) nao gera parcela futura", () => {
  // As duas colunas vem NULL juntas numa compra avulsa -- ha CHECK no banco.
  const fatura = faturaDe(NUBANK, 300, [linha({ invoice_amount: 300 })]);
  assert.equal(parcelasFuturasDaFatura(fatura, NUBANK), 0);
});

test("linha com so UMA das duas colunas de parcela nao vira NaN", () => {
  // O CHECK do banco impede este estado, e o modulo nao se apoia nele: uma
  // coluna sozinha multiplicada daria `NaN`, e `NaN` somado zera o aviso dos
  // outros cartoes sem nada ficar vermelho.
  const so_numero = faturaDe(NUBANK, 300, [
    linha({ invoice_amount: 300, installment_number: 3 }),
  ]);
  const so_total = faturaDe(NUBANK, 300, [
    linha({ invoice_amount: 300, installment_total: 10 }),
  ]);

  assert.equal(parcelasFuturasDaFatura(so_numero, NUBANK), 0);
  assert.equal(parcelasFuturasDaFatura(so_total, NUBANK), 0);
});

test("parcela fracionaria nao vira '8,5 parcelas que faltam'", () => {
  // `numeric` do PostgREST chega como texto, e nada no caminho garante inteiro
  // antes daqui. 2,5 de 10 derivaria 7,5 parcelas e um comprometimento com
  // centavos inventados -- de um par que o CHECK do banco nunca deveria aceitar,
  // mas que esta funcao recebe de uma fronteira `any`.
  const fatura = faturaDe(NUBANK, 300, [
    linha({ invoice_amount: 300, installment_number: 2.5, installment_total: 10 }),
  ]);

  assert.equal(parcelasFuturasDaFatura(fatura, NUBANK), 0);
});

test("parcela de numero MAIOR que o total nao vira comprometimento negativo", () => {
  // Dado torto ("parcela 12 de 10") daria -2 parcelas, e um negativo aqui
  // ABATERIA o aviso das outras compras.
  const fatura = faturaDe(NUBANK, 300, [
    linha({ invoice_amount: 300, installment_number: 12, installment_total: 10 }),
  ]);

  assert.equal(parcelasFuturasDaFatura(fatura, NUBANK), 0);
});

test("estorno parcelado nao gera parcela futura negativa", () => {
  // Uma linha negativa multiplicada por 9 viraria um comprometimento negativo
  // que abate o das outras.
  const fatura = faturaDe(NUBANK, -100, [
    linha({ invoice_amount: -100, installment_number: 1, installment_total: 10 }),
  ]);

  assert.equal(parcelasFuturasDaFatura(fatura, NUBANK), 0);
});

test("duas compras parceladas na mesma fatura somam as duas sobras", () => {
  const fatura = faturaDe(NUBANK, 500, [
    linha({ invoice_amount: 300, installment_number: 1, installment_total: 10 }),
    linha({ invoice_amount: 200, installment_number: 2, installment_total: 3 }),
  ]);

  // 300 * 9 + 200 * 1
  assert.equal(parcelasFuturasDaFatura(fatura, NUBANK), 2900);
});

test("a linha de OUTRO cartao nao conta como parcela futura deste", () => {
  // A RLS de `financial_transactions` tem um OR para membro de grupo (002),
  // entao a view PODE devolver a compra de outro cartao. O filtro repete o que
  // a rota ja fez, e e a afirmacao da tela.
  const fatura = faturaDe(NUBANK, 300, [
    linha({ invoice_amount: 300, installment_number: 1, installment_total: 10 }),
    linha({
      account_id: ITAU,
      invoice_amount: 500,
      installment_number: 1,
      installment_total: 10,
    }),
  ]);

  assert.equal(parcelasFuturasDaFatura(fatura, NUBANK), 2700);
});

test("fatura sem lines (cartao zerado no mes) nao gera parcela futura", () => {
  assert.equal(parcelasFuturasDaFatura(faturaDe(NUBANK, 0), NUBANK), 0);
});

test("parcela futura de cartao ausente da resposta e null, nao zero", () => {
  // Mesma politica do total: "nao deu para ler" nao pode virar "nada a vir".
  assert.equal(parcelasFuturasDaFatura(null, NUBANK), null);
});

test("sem accountId a derivacao e null, e nao a soma de todas as linhas", () => {
  // Sem o id nao da para filtrar por cartao, e somar tudo devolveria a sobra
  // do cartao errado embaixo do nome certo.
  const fatura = faturaDe(NUBANK, 300, [
    linha({ invoice_amount: 300, installment_number: 1, installment_total: 10 }),
  ]);

  assert.equal(parcelasFuturasDaFatura(fatura, ""), null);
});

test("a soma das parcelas futuras atravessa os cartoes da lista", () => {
  const faturas = [
    faturaDe(NUBANK, 300, [
      linha({ invoice_amount: 300, installment_number: 1, installment_total: 10 }),
    ]),
    faturaDe(ITAU, 100, [
      linha({
        account_id: ITAU,
        invoice_amount: 100,
        installment_number: 1,
        installment_total: 3,
      }),
    ]),
  ];

  // 2700 do Nubank + 200 do Itau
  assert.equal(somaDasParcelasFuturas(faturas, [NUBANK, ITAU]), 2900);
});

test("falta um cartao: a soma das parcelas futuras tambem e null", () => {
  const faturas = [faturaDe(NUBANK, 300)];
  assert.equal(somaDasParcelasFuturas(faturas, [NUBANK, ITAU]), null);
});

test("leitura que nao voltou nao vira 'nenhuma parcela futura'", () => {
  assert.equal(somaDasParcelasFuturas(null, [NUBANK]), null);
});
