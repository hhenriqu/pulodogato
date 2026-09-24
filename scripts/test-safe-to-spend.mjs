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
//   6. A RESERVA DE META DESCONTADA DUAS VEZES (HMO-155). Gemeo do item 1: o
//      aporte do dia 5 ja saiu do saldo da conta, entao descontar o alvo mensal
//      CHEIO por cima dele tira o mesmo dinheiro duas vezes. Junto com isso:
//      meta encerrada nao reserva, e prazo vencido nao pode virar Infinity.
//
// Mesmo desenho do test-categorization.mjs: .mjs rodando o JS que o tsc
// emitiu, com o passo de reescrita de alias no meio, sem runner novo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  calcularQuantoPossoGastar,
  fimDoMes,
  diasRestantesNoMes,
  mesesAteOAlvo,
  reservaDaMeta,
} = await import("../.tmp-safe-to-spend/safe-to-spend.js");

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

// ---------------------------------------------------------------------------
// 7. A quinta parcela: a reserva das metas (HMO-155)
// ---------------------------------------------------------------------------
// O buraco que o PR #37 deixou documentado no cabecalho do lib: o app dizia que
// havia R$ 1.200 livres no mes exatamente para quem planejava separar R$ 800
// deles.
//
// A armadilha central aqui e a mesma do item 1 com outra roupa: o aporte ja
// lancado saiu do saldo da conta, entao descontar o alvo mensal CHEIO por cima
// dele desconta o mesmo dinheiro duas vezes.

const meta = (mudancas = {}) => ({
  id: "g-1",
  title: "Viagem",
  status: "active",
  target_amount: 12000,
  saved: 0,
  target_date: null,
  monthly_contribution: null,
  aportadoNoMes: 0,
  ...mudancas,
});

/** Cenario base + metas, para a diferenca ser atribuivel so as metas. */
const comMetas = (metas) =>
  calcularQuantoPossoGastar({
    contas: [corrente(3000), cartao(0)],
    previstas: [],
    metas,
    hoje: HOJE,
  });

test("alvo mensal escolhido desconta do 'posso gastar'", () => {
  const r = comMetas([meta({ monthly_contribution: 800 })]);

  assert.equal(r.reservaDeMetas, 800);
  assert.equal(r.livre, 2200); // 3000 - 800
  assert.equal(r.porDia, 2200 / 21);
});

test("o que JA foi aportado no mes nao e descontado de novo", () => {
  // O caso que da nome ao bug. Alvo de 800, dos quais 300 ja sairam da conta
  // corrente no dia 5 -- e por isso os 3000 de saldo ja estao 300 menores.
  // Descontar 800 aqui tiraria esses 300 pela segunda vez.
  const r = comMetas([
    meta({ monthly_contribution: 800, aportadoNoMes: 300, saved: 300 }),
  ]);

  assert.equal(r.reservaDeMetas, 500); // 800 - 300, nao 800
  assert.equal(r.livre, 2500);
  // A tela abre o numero: o alvo continua sendo 800, o descontado e 500.
  assert.equal(r.metas[0].alvoMensal, 800);
  assert.equal(r.metas[0].aportado, 300);
  assert.equal(r.metas[0].reserva, 500);
});

test("aporte MAIOR que o alvo do mes nao vira reserva negativa", () => {
  // Reserva negativa AUMENTARIA o "posso gastar": quem adiantou o aporte de
  // dezembro ganharia dinheiro de mentira para gastar em setembro.
  const r = comMetas([
    meta({ monthly_contribution: 800, aportadoNoMes: 1000, saved: 1000 }),
  ]);

  assert.equal(r.reservaDeMetas, 0);
  assert.equal(r.livre, 3000);
  // Meta sem reserva sai da lista da tela -- nao ha o que mostrar.
  assert.deepEqual(r.metas, []);
});

test("meta pausada, concluida ou cancelada nao reserva nada", () => {
  // Desconto fantasma: encolheria o "posso gastar" todo mes, para sempre, e a
  // tela de metas mostraria a meta como encerrada -- sem lugar onde consertar.
  for (const status of ["paused", "completed", "cancelled"]) {
    const r = comMetas([meta({ status, monthly_contribution: 800 })]);
    assert.equal(r.reservaDeMetas, 0, `status ${status} nao pode reservar`);
    assert.equal(r.livre, 3000, `status ${status} nao pode mexer no livre`);
  }
});

test("meta ja atingida nao reserva, mesmo com status 'active'", () => {
  // A view chama isso de progress_status 'reached': os aportes alcancaram o
  // alvo mas ninguem marcou a meta como concluida na mao.
  const r = comMetas([
    meta({ target_amount: 5000, saved: 5000, monthly_contribution: 800 }),
  ]);

  assert.equal(r.reservaDeMetas, 0);
});

test("a reserva nunca passa do que falta para fechar a meta", () => {
  // Alvo de 300 por mes, mas so faltam 50 para a meta inteira.
  const r = comMetas([
    meta({ target_amount: 5000, saved: 4950, monthly_contribution: 300 }),
  ]);

  assert.equal(r.reservaDeMetas, 50);
  assert.equal(r.metas[0].alvoMensal, 50);
});

// --- a derivacao pelo prazo ------------------------------------------------

test("sem alvo escolhido, o prazo deriva o alvo do mes", () => {
  // Faltam 900 e faltam 3 meses (setembro -> dezembro): 300 por mes. E o mesmo
  // numero que goal_progress.monthly_required publica e que a tela de metas ja
  // mostra ao usuario.
  const r = comMetas([
    meta({
      target_amount: 1000,
      saved: 100,
      target_date: "2026-12-20",
      monthly_contribution: null,
    }),
  ]);

  assert.equal(r.reservaDeMetas, 300);
  assert.equal(r.metas[0].derivado, true);
});

test("alvo escolhido MANDA sobre o prazo", () => {
  // A mesma meta do teste anterior (derivaria 300), agora com 120 escolhidos.
  const r = comMetas([
    meta({
      target_amount: 1000,
      saved: 100,
      target_date: "2026-12-20",
      monthly_contribution: 120,
    }),
  ]);

  assert.equal(r.reservaDeMetas, 120);
  assert.equal(r.metas[0].derivado, false);
});

test("prazo VENCIDO nao vira Infinity nem reserva negativa", () => {
  // O divisor seria -2 (setembro -> julho). Sem o piso de 1 mes isso produz um
  // alvo NEGATIVO, que aumentaria o "posso gastar" de quem esta atrasado na
  // meta. Com prazo no mes corrente o divisor seria 0 -> Infinity, e a tela
  // imprimiria "-R$ Infinity".
  const vencida = comMetas([
    meta({ target_amount: 1000, saved: 400, target_date: "2026-07-10" }),
  ]);

  assert.equal(Number.isFinite(vencida.reservaDeMetas), true);
  assert.equal(vencida.reservaDeMetas, 600); // piso de 1 mes -> o que falta
  assert.equal(vencida.livre, 2400);

  const esteMes = comMetas([
    meta({ target_amount: 1000, saved: 400, target_date: "2026-09-28" }),
  ]);

  assert.equal(Number.isFinite(esteMes.reservaDeMetas), true);
  assert.equal(esteMes.reservaDeMetas, 600);
});

test("meta sem alvo e sem prazo reserva zero", () => {
  // "Juntar 15 mil" e uma meta valida sem data -- esta escrito no comentario da
  // coluna target_date no 008. Nao ha o que derivar, e inventar um alvo
  // encolheria o numero sem o usuario ter pedido.
  const r = comMetas([meta({ target_date: null, monthly_contribution: null })]);

  assert.equal(r.reservaDeMetas, 0);
  assert.equal(r.livre, 3000);
});

// --- forma da saida --------------------------------------------------------

test("a lista de metas vem da maior reserva para a menor, sem as zeradas", () => {
  const r = comMetas([
    meta({ id: "a", title: "Reserva", monthly_contribution: 200 }),
    meta({ id: "b", title: "Viagem", monthly_contribution: 900 }),
    meta({ id: "c", title: "Pausada", status: "paused", monthly_contribution: 500 }),
    meta({ id: "d", title: "Carro", monthly_contribution: 400 }),
  ]);

  assert.deepEqual(r.metas.map((m) => m.id), ["b", "d", "a"]);
  assert.equal(r.reservaDeMetas, 1500);
});

test("numeric do PostgREST chega como string e nao vira NaN", () => {
  // `goal_progress.saved` e `target_amount` sao numeric(15,2): o PostgREST
  // devolve os dois como texto. Somar texto aqui produziria NaN, e NaN
  // subtraido do livre apaga o numero inteiro da tela.
  const r = comMetas([
    meta({
      target_amount: "1000.00",
      saved: "100.00",
      monthly_contribution: "250.50",
      aportadoNoMes: "50.50",
    }),
  ]);

  assert.equal(Number.isNaN(r.reservaDeMetas), false);
  assert.equal(r.reservaDeMetas, 200);
  assert.equal(r.livre, 2800);
});

test("sem metas o resultado e o de antes da HMO-155", () => {
  // Controle: a parcela nova so pode mexer no numero quando ha meta.
  const semCampo = base();
  const listaVazia = comMetas([]);

  assert.equal(semCampo.reservaDeMetas, 0);
  assert.equal(semCampo.livre, 3000);
  assert.deepEqual(semCampo.metas, []);
  assert.equal(listaVazia.livre, semCampo.livre);
});

test("as cinco parcelas somam exatamente o total da tela", () => {
  // Criterio de aceite 2: quem conferir a conta na mao, a partir dos cinco
  // tiles, tem que chegar no numero grande. Se um dia aparecer uma sexta
  // parcela que nao tenha tile, este assert quebra antes da tela mentir.
  const r = calcularQuantoPossoGastar({
    contas: [corrente(1200), cartao(-1500)],
    previstas: [
      prevista(5000, "2026-09-05", { tipo: "income" }),
      prevista(1800, "2026-09-10", { tipo: "expense" }),
    ],
    metas: [
      meta({ id: "a", monthly_contribution: 800, aportadoNoMes: 300, saved: 300 }),
      meta({ id: "b", target_amount: 1000, saved: 100, target_date: "2026-12-20" }),
    ],
    hoje: HOJE,
  });

  assert.equal(r.reservaDeMetas, 800); // 500 que faltam + 300 derivados
  assert.equal(
    r.livre,
    r.disponivel +
      r.receitasPrevistas -
      r.compromissos -
      r.dividaDeCartao -
      r.reservaDeMetas
  );
  assert.equal(r.livre, 1200 + 5000 - 1800 - 1500 - 800);
});

// --- as duas funcoes soltas ------------------------------------------------

test("mesesAteOAlvo conta meses cheios, com piso de 1", () => {
  assert.equal(mesesAteOAlvo("2026-09-10", "2026-12-20"), 3);
  assert.equal(mesesAteOAlvo("2026-09-10", "2027-03-01"), 6);
  // Grao de MES: o dia dentro do mes do prazo nao muda o numero, porque a
  // pergunta e "quantas vezes eu ainda separo dinheiro".
  assert.equal(mesesAteOAlvo("2026-09-10", "2026-11-01"), 2);
  assert.equal(mesesAteOAlvo("2026-09-10", "2026-11-30"), 2);
  // Piso: mes corrente e passado.
  assert.equal(mesesAteOAlvo("2026-09-10", "2026-09-28"), 1);
  assert.equal(mesesAteOAlvo("2026-09-10", "2026-07-10"), 1);
  assert.equal(mesesAteOAlvo("2026-09-10", "2025-01-10"), 1);
});

test("reservaDaMeta nao devolve reserva negativa para quem aportou a mais", () => {
  // Este assert existe no nivel da funcao, e nao so no total, de proposito. No
  // total a reserva negativa nunca aparece porque o `filter(reserva > 0)` do
  // calculo a descarta antes da soma -- o que significa que o total NAO prova
  // nada sobre esta guarda. Uma mutacao que apaga o `Math.max(0, ...)` daqui
  // passa verde por todos os testes de total. Quem chamar reservaDaMeta
  // direto, ou quem mexer no filtro, ficaria sem rede.
  const r = reservaDaMeta(
    meta({ monthly_contribution: 800, aportadoNoMes: 1000, saved: 1000 }),
    HOJE
  );

  assert.equal(r.reserva, 0);
  assert.equal(r.alvoMensal, 800);
});

test("meta com MAIS dinheiro do que o alvo nao devolve alvo mensal negativo", () => {
  // Passar do alvo acontece -- e a razao do GREATEST(..., 0) do `remaining` na
  // view goal_progress. Aqui o que importa e o campo `alvoMensal` do retorno:
  // a tela o imprime ("de R$ X, R$ Y ja aportado"), e um valor negativo viraria
  // "de -R$ 200,00". A reserva ja sairia 0 pelo Math.max de baixo -- e por isso
  // o assert precisa ser sobre o alvoMensal, nao sobre o total.
  const r = reservaDaMeta(
    meta({ target_amount: 1000, saved: 1200, monthly_contribution: 300 }),
    HOJE
  );

  assert.equal(r.alvoMensal, 0);
  assert.equal(r.reserva, 0);
});

test("aporte negativo e tratado como zero, nao como credito", () => {
  // `goal_contributions.amount` tem CHECK > 0 no 008, entao a rota nao consegue
  // produzir isto hoje. A guarda e para o outro lado: MetaParaGastar e uma
  // interface publica, e um numero negativo aqui AUMENTARIA o alvo a reservar
  // -- com sinal trocado, a meta viraria fonte de dinheiro para gastar. Zerar
  // erra para o lado conservador, que e o mesmo criterio do resto do arquivo.
  const r = reservaDaMeta(
    meta({ monthly_contribution: 800, aportadoNoMes: -500 }),
    HOJE
  );

  assert.equal(r.aportado, 0);
  assert.equal(r.reserva, 800); // nao 1300
});

test("reservaDaMeta devolve a meta zerada com o aporte preservado", () => {
  // A tela nao mostra meta encerrada, mas quem depurar precisa ver que o aporte
  // foi lido -- zerar tudo esconderia a diferenca entre "nao reservou porque
  // esta pausada" e "nao reservou porque nao chegou dado nenhum".
  const r = reservaDaMeta(
    meta({ status: "paused", monthly_contribution: 800, aportadoNoMes: 120 }),
    HOJE
  );

  assert.equal(r.reserva, 0);
  assert.equal(r.alvoMensal, 0);
  assert.equal(r.aportado, 120);
});
