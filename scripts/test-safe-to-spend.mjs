#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DO "QUANTO AINDA POSSO GASTAR"
// =====================================================
//   npm run test:safe-to-spend
//
// Exercita lib/safe-to-spend.ts. O que este arquivo protege, em ordem de
// quanto custa errar:
//
//   1. A FATURA CONTADA DUAS VEZES. O mesmo dinheiro mora no saldo negativo do
//      cartao e na conta prevista criada pelo fechamento da fatura. Descontar
//      os dois corta o "posso gastar" quase pela metade -- e o numero continua
//      parecendo plausivel na tela, que e o que torna esse erro caro.
//
//   2. A COMPRA NO CARTAO QUE NAO MEXE NO NUMERO. O erro simetrico: sem a
//      divida do cartao na conta, gastar no cartao nao muda o "posso gastar", e
//      o app passa a recompensar quem usa o cartao.
//
//   3. INVESTIMENTO E CONTA ARQUIVADA. As duas sao dinheiro do usuario e
//      nenhuma das duas e dinheiro para gastar esta semana. Entram no
//      patrimonio liquido e ficam FORA daqui, de proposito.
//
//   4. VENCIDO. Conta atrasada continua sendo dinheiro que vai sair.
//
//   5. VERBA DIARIA. Dia 31 nao pode dividir por zero, e mes no vermelho nao
//      tem verba diaria negativa.
//
// Mesmo desenho do test-categorization.mjs: .mjs rodando o JS que o tsc
// emitiu, com o passo de reescrita de alias no meio, sem runner novo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { calcularQuantoPossoGastar, fimDoMes, diasRestantesNoMes } =
  await import("../.tmp-safe-to-spend/safe-to-spend.js");

const { chaveFatura } = await import("../.tmp-safe-to-spend/card-invoice.js");

// ---------------------------------------------------------------------------
// Cenario base: uma corrente com 3.000, um cartao sem divida, nada previsto.
// Cada teste abaixo muda UMA coisa neste cenario -- e o que deixa a diferenca
// de valor atribuivel aquela mudanca, e nao a soma de varias.
// ---------------------------------------------------------------------------
const HOJE = "2026-09-10"; // setembro tem 30 dias -> 21 dias restantes
const CARTAO_ID = "11111111-2222-3333-4444-555555555555";

const corrente = (saldo, extra = {}) => ({
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  name: "Conta corrente",
  account_type: "checking",
  current_balance: saldo,
  ...extra,
});

const cartao = (saldo, extra = {}) => ({
  id: CARTAO_ID,
  name: "Cartao Nubank",
  account_type: "credit_card",
  current_balance: saldo,
  ...extra,
});

const prevista = (amount, due_date, extra = {}) => ({
  id: `p-${due_date}-${amount}`,
  amount,
  due_date,
  ...extra,
});

const base = (mudancas = {}) =>
  calcularQuantoPossoGastar({
    contas: [corrente(3000), cartao(0)],
    previstas: [],
    hoje: HOJE,
    ...mudancas,
  });

// ---------------------------------------------------------------------------
// 1. A fatura contada duas vezes -- a armadilha caseira deste calculo
// ---------------------------------------------------------------------------

test("fatura fechada desconta UMA vez, nao duas", () => {
  // Estado real depois de fechar a fatura: o cartao deve 800 (o saldo NAO muda
  // no fechamento) e existe uma conta prevista de 800 com a chave canonica.
  const r = calcularQuantoPossoGastar({
    contas: [corrente(3000), cartao(-800)],
    previstas: [
      prevista(800, "2026-09-20", { notes: chaveFatura("2026-08-01", CARTAO_ID) }),
    ],
    hoje: HOJE,
  });

  assert.equal(r.dividaDeCartao, 800);
  // Se a fatura entrasse tambem em `compromissos`, este assert viria 1400.
  assert.equal(r.compromissos, 0);
  assert.equal(r.livre, 2200);
});

test("despesa comum vencendo no cartao NAO e fatura: continua sendo compromisso", () => {
  // A assinatura cadastrada como conta prevista do cartao. Ela nao tem chave
  // canonica, entao e compromisso de verdade. Detectar fatura pelo TIPO da
  // conta -- em vez da chave -- faria esta despesa desaparecer, que e
  // exatamente o erro que o lib/card-invoice.ts documenta.
  const r = calcularQuantoPossoGastar({
    contas: [corrente(3000), cartao(0)],
    previstas: [prevista(59.9, "2026-09-15", { notes: "Netflix" })],
    hoje: HOJE,
  });

  assert.equal(r.compromissos, 59.9);
  assert.equal(r.livre, 2940.1);
});

test("nota escrita a mao que so PARECE chave de fatura nao escapa do desconto", () => {
  const r = calcularQuantoPossoGastar({
    contas: [corrente(3000), cartao(0)],
    previstas: [
      prevista(500, "2026-09-15", {
        notes: `${chaveFatura("2026-08-01", CARTAO_ID)} paguei no debito`,
      }),
    ],
    hoje: HOJE,
  });

  assert.equal(r.compromissos, 500);
});

// ---------------------------------------------------------------------------
// 2. A compra no cartao tem que mexer no numero
// ---------------------------------------------------------------------------

test("divida do periodo aberto (sem fatura fechada) desconta", () => {
  // Comprou 500 no cartao hoje. A fatura nem fechou, entao nao existe conta
  // prevista nenhuma -- e o dinheiro ja foi gasto.
  const r = calcularQuantoPossoGastar({
    contas: [corrente(3000), cartao(-500)],
    previstas: [],
    hoje: HOJE,
  });

  assert.equal(r.dividaDeCartao, 500);
  assert.equal(r.livre, 2500);
});

test("fatura fechada + periodo aberto no mesmo cartao: desconta a divida toda", () => {
  // 800 fechados (com conta prevista) + 300 comprados depois = saldo -1100.
  const r = calcularQuantoPossoGastar({
    contas: [corrente(3000), cartao(-1100)],
    previstas: [
      prevista(800, "2026-10-10", { notes: chaveFatura("2026-09-01", CARTAO_ID) }),
    ],
    hoje: HOJE,
  });

  assert.equal(r.dividaDeCartao, 1100);
  assert.equal(r.compromissos, 0);
  assert.equal(r.livre, 1900);
});

test("estorno maior que as compras nao vira dinheiro extra", () => {
  // Cartao com saldo POSITIVO: credito de 200 dentro do cartao. Nao da para
  // gastar isso no mercado, e somar aumentaria o "posso gastar".
  const r = calcularQuantoPossoGastar({
    contas: [corrente(3000), cartao(200)],
    previstas: [],
    hoje: HOJE,
  });

  assert.equal(r.dividaDeCartao, 0);
  assert.equal(r.livre, 3000);
});

test("cada cartao aparece no detalhe, do que mais deve para o que menos deve", () => {
  const outro = {
    id: "99999999-8888-7777-6666-555555555555",
    name: "Cartao Itau",
    account_type: "credit_card",
    current_balance: -2000,
  };

  const r = calcularQuantoPossoGastar({
    contas: [corrente(5000), cartao(-300), outro],
    previstas: [],
    hoje: HOJE,
  });

  assert.deepEqual(
    r.cartoes.map((c) => [c.name, c.divida]),
    [
      ["Cartao Itau", 2000],
      ["Cartao Nubank", 300],
    ]
  );
  assert.equal(r.dividaDeCartao, 2300);
});

// ---------------------------------------------------------------------------
// 3. O que NAO e dinheiro para gastar
// ---------------------------------------------------------------------------

test("investimento nao entra em disponivel", () => {
  const r = calcularQuantoPossoGastar({
    contas: [
      corrente(3000),
      {
        id: "inv-1",
        name: "Corretora",
        account_type: "investment",
        current_balance: 50000,
      },
    ],
    previstas: [],
    hoje: HOJE,
  });

  assert.equal(r.disponivel, 3000);
  assert.equal(r.livre, 3000);
});

test("conta arquivada nao entra em disponivel (e entra no patrimonio -- divergencia proposital)", () => {
  const r = calcularQuantoPossoGastar({
    contas: [corrente(3000), corrente(900, { id: "velha", is_active: false })],
    previstas: [],
    hoje: HOJE,
  });

  assert.equal(r.disponivel, 3000);
});

test("cartao arquivado com divida continua descontando", () => {
  // Arquivar o cartao nao perdoa a fatura. Se o desconto saisse da conta, o
  // "posso gastar" subiria de degrau no dia em que alguem arrumasse a lista de
  // contas -- sem nenhum pagamento por tras.
  const r = calcularQuantoPossoGastar({
    contas: [corrente(3000), cartao(-700, { is_active: false })],
    previstas: [],
    hoje: HOJE,
  });

  assert.equal(r.dividaDeCartao, 700);
  assert.equal(r.livre, 2300);
});

test("poupanca, dinheiro, digital e tipo desconhecido contam como disponivel", () => {
  const tipos = ["savings", "cash", "digital", "debit_card", "other", "tipo_novo"];
  const contas = tipos.map((t, i) => ({
    id: `c-${i}`,
    name: t,
    account_type: t,
    current_balance: 100,
  }));

  const r = calcularQuantoPossoGastar({ contas, previstas: [], hoje: HOJE });

  assert.equal(r.disponivel, 100 * tipos.length);
});

test("conta corrente no cheque especial derruba o disponivel", () => {
  const r = calcularQuantoPossoGastar({
    contas: [corrente(-400)],
    previstas: [],
    hoje: HOJE,
  });

  assert.equal(r.disponivel, -400);
  assert.equal(r.livre, -400);
  assert.equal(r.porDia, 0);
});

// ---------------------------------------------------------------------------
// 4. Previstas: janela, direcao e vencido
// ---------------------------------------------------------------------------

test("prevista do mes que vem fica fora da conta deste mes", () => {
  const r = calcularQuantoPossoGastar({
    contas: [corrente(3000)],
    previstas: [prevista(1200, "2026-10-05"), prevista(100, "2026-09-30")],
    hoje: HOJE,
  });

  assert.equal(r.ate, "2026-09-30");
  assert.equal(r.compromissos, 100);
});

test("prevista vencendo no ULTIMO dia do mes entra (a janela e inclusiva)", () => {
  const r = calcularQuantoPossoGastar({
    contas: [corrente(3000)],
    previstas: [prevista(100, "2026-09-30")],
    hoje: HOJE,
  });

  assert.equal(r.compromissos, 100);
});

test("receita prevista soma em vez de subtrair", () => {
  const r = calcularQuantoPossoGastar({
    contas: [corrente(1000)],
    previstas: [
      prevista(4000, "2026-09-05", { tipo: "income" }),
      prevista(1500, "2026-09-10", { tipo: "expense" }),
    ],
    hoje: HOJE,
  });

  assert.equal(r.receitasPrevistas, 4000);
  assert.equal(r.compromissos, 1500);
  assert.equal(r.livre, 3500);
});

test("prevista sem tipo e despesa (conta avulsa, convencao da Fase 1)", () => {
  const r = calcularQuantoPossoGastar({
    contas: [corrente(1000)],
    previstas: [prevista(300, "2026-09-12")],
    hoje: HOJE,
  });

  assert.equal(r.compromissos, 300);
  assert.equal(r.receitasPrevistas, 0);
});

test("vencido entra no total e aparece separado", () => {
  const r = calcularQuantoPossoGastar({
    contas: [corrente(1000)],
    previstas: [
      prevista(200, "2026-09-03"), // venceu (hoje e dia 10)
      prevista(300, "2026-09-25"), // a vencer
    ],
    hoje: HOJE,
  });

  assert.equal(r.compromissos, 500);
  assert.equal(r.compromissosVencidos, 200);
  assert.equal(r.livre, 500);
});

test("prevista vencendo HOJE nao conta como vencida", () => {
  const r = calcularQuantoPossoGastar({
    contas: [corrente(1000)],
    previstas: [prevista(200, HOJE)],
    hoje: HOJE,
  });

  assert.equal(r.compromissos, 200);
  assert.equal(r.compromissosVencidos, 0);
});

test("valor negativo em amount nao inverte o sinal do compromisso", () => {
  // `amount` e positivo por CHECK no 005, mas a rota entrega o que o banco
  // devolve. Um dado torto nao pode virar dinheiro extra no bolso.
  const r = calcularQuantoPossoGastar({
    contas: [corrente(1000)],
    previstas: [prevista(-200, "2026-09-12")],
    hoje: HOJE,
  });

  assert.equal(r.compromissos, 200);
  assert.equal(r.livre, 800);
});

test("numeric que chega como texto nao vira NaN", () => {
  // O PostgREST devolve `numeric` como string. Sem o Number() no meio, a soma
  // viraria concatenacao e a tela imprimiria NaN.
  const r = calcularQuantoPossoGastar({
    contas: [corrente("3000.50"), cartao("-100.25")],
    previstas: [prevista("200.25", "2026-09-12")],
    hoje: HOJE,
  });

  assert.equal(r.disponivel, 3000.5);
  assert.equal(r.dividaDeCartao, 100.25);
  assert.equal(r.compromissos, 200.25);
  assert.equal(r.livre, 2700);
});

test("saldo nulo conta como zero, nao como NaN", () => {
  const r = calcularQuantoPossoGastar({
    contas: [corrente(null), corrente(500, { id: "outra" })],
    previstas: [],
    hoje: HOJE,
  });

  assert.equal(r.disponivel, 500);
});

// ---------------------------------------------------------------------------
// 5. Verba diaria e o horizonte
// ---------------------------------------------------------------------------

test("por dia divide o livre pelos dias restantes, hoje incluido", () => {
  const r = base();

  assert.equal(r.diasRestantes, 21); // 30 - 10 + 1
  assert.equal(r.livre, 3000);
  assert.equal(r.porDia, 3000 / 21);
});

test("no ultimo dia do mes o divisor e 1, nao 0", () => {
  const r = calcularQuantoPossoGastar({
    contas: [corrente(150)],
    previstas: [],
    hoje: "2026-09-30",
  });

  assert.equal(r.diasRestantes, 1);
  assert.equal(r.porDia, 150);
});

test("mes no vermelho nao tem verba diaria negativa", () => {
  const r = calcularQuantoPossoGastar({
    contas: [corrente(100)],
    previstas: [prevista(1000, "2026-09-20")],
    hoje: HOJE,
  });

  assert.equal(r.livre, -900);
  assert.equal(r.porDia, 0);
});

test("livre exatamente zero tambem nao rende verba diaria", () => {
  const r = calcularQuantoPossoGastar({
    contas: [corrente(1000)],
    previstas: [prevista(1000, "2026-09-20")],
    hoje: HOJE,
  });

  assert.equal(r.livre, 0);
  assert.equal(r.porDia, 0);
});

test("fevereiro de ano bissexto termina no dia 29", () => {
  assert.equal(fimDoMes("2028-02-10"), "2028-02-29");
  assert.equal(diasRestantesNoMes("2028-02-10"), 20);
});

test("fevereiro de ano comum termina no dia 28", () => {
  assert.equal(fimDoMes("2026-02-10"), "2026-02-28");
  assert.equal(diasRestantesNoMes("2026-02-10"), 19);
});

test("dezembro nao vira janeiro do ano seguinte", () => {
  assert.equal(fimDoMes("2026-12-05"), "2026-12-31");
});

test("usuario novo, com as quatro contas zeradas, ve zero e nao NaN", () => {
  // `create_default_accounts` cria quatro contas zeradas no cadastro. Sem
  // guarda de divisao, a tela imprimiria NaN no primeiro acesso de todo mundo.
  const r = calcularQuantoPossoGastar({
    contas: [
      corrente(0),
      cartao(0),
      { id: "p", name: "Poupanca", account_type: "savings", current_balance: 0 },
      { id: "i", name: "Investimentos", account_type: "investment", current_balance: 0 },
    ],
    previstas: [],
    hoje: HOJE,
  });

  assert.equal(r.livre, 0);
  assert.equal(r.porDia, 0);
  assert.equal(Number.isNaN(r.porDia), false);
});

// ---------------------------------------------------------------------------
// 6. O cenario inteiro, de uma vez -- a conta que a tela mostra
// ---------------------------------------------------------------------------

test("mes tipico: salario a receber, aluguel a pagar, fatura fechada e compra no cartao", () => {
  const r = calcularQuantoPossoGastar({
    contas: [
      corrente(1200),
      { id: "pou", name: "Poupanca", account_type: "savings", current_balance: 800 },
      { id: "cdb", name: "CDB", account_type: "investment", current_balance: 20000 },
      cartao(-1500), // 900 de fatura fechada + 600 do periodo aberto
    ],
    previstas: [
      prevista(5000, "2026-09-05", { tipo: "income" }), // salario
      prevista(1800, "2026-09-10", { tipo: "expense" }), // aluguel, vence hoje
      prevista(120, "2026-09-02", { tipo: "expense" }), // luz, VENCIDA
      prevista(900, "2026-09-15", { notes: chaveFatura("2026-08-01", CARTAO_ID) }),
      prevista(400, "2026-10-08", { tipo: "expense" }), // mes que vem
    ],
    hoje: HOJE,
  });

  assert.equal(r.disponivel, 2000); // 1200 + 800, sem o CDB
  assert.equal(r.receitasPrevistas, 5000);
  assert.equal(r.compromissos, 1920); // 1800 + 120, sem a fatura e sem outubro
  assert.equal(r.compromissosVencidos, 120);
  assert.equal(r.dividaDeCartao, 1500);
  assert.equal(r.livre, 3580); // 2000 + 5000 - 1920 - 1500
  assert.equal(r.porDia, 3580 / 21);
});
