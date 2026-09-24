#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DA PREVISAO DE FLUXO DE CAIXA
// =====================================================
//   npm run test:cash-flow
//
// Exercita lib/cash-flow-forecast.ts. O que este arquivo protege, em ordem de
// quanto custa errar:
//
//   1. A MESMA COBRANCA CONTADA DUAS VEZES. Quem cadastrou a Netflix como
//      conta prevista E deixou o detector rodar tem a cobranca nas duas
//      fontes. Somar as duas antecipa -- ou inventa -- um dia negativo. E o
//      erro mais caro porque o numero continua parecendo plausivel.
//
//   2. A FATURA DE CARTAO, que aqui ENTRA e no "posso gastar" NAO. A regra e
//      oposta a do arquivo vizinho de proposito: la a pergunta nao tem data,
//      aqui a data e a pergunta. O teste registra a divergencia para a proxima
//      pessoa nao "consertar" a diferenca e reintroduzir a contagem dupla.
//
//   3. O DIA NEGATIVO. Nao pode aparecer para quem ja esta negativo hoje (isso
//      nao e descoberta), e tem que ser o PRIMEIRO cruzamento, nao o ultimo.
//
//   4. VENCIDO. Conta atrasada nao tem dia futuro -- cai em hoje, e nao some.
//
//   5. RECORRENCIA COM DATA VELHA. Rola para a frente pela frequencia, sem
//      laco infinito, e sem cobrar num dia que ja passou.
//
//   6. IGNORED E CANCELLED nao projetam nada.
//
// Mesmo desenho do test-safe-to-spend.mjs: .mjs rodando o JS que o tsc
// emitiu, com o passo de reescrita de alias no meio, sem runner novo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  projetarFluxoDeCaixa,
  cobrancasNaJanela,
  horizonteValido,
  proximosEventos,
  DIAS_PADRAO,
  DIAS_MAX,
  TOLERANCIA_DUPLICATA_DIAS,
} = await import("../.tmp-cash-flow/cash-flow-forecast.js");

// ---------------------------------------------------------------------------
// Cenario base: uma corrente com 1.000, nada previsto, nada detectado.
// Cada teste muda UMA coisa -- e o que deixa a diferenca atribuivel aquela
// mudanca, e nao a soma de varias.
// ---------------------------------------------------------------------------
const HOJE = "2026-09-10";

const corrente = (saldo, extra = {}) => ({
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  name: "Conta corrente",
  account_type: "checking",
  current_balance: saldo,
  is_active: true,
  ...extra,
});

const cartao = (saldo) => ({
  id: "cccccccc-0000-0000-0000-000000000001",
  name: "Cartao",
  account_type: "credit_card",
  current_balance: saldo,
  is_active: true,
});

let seqPrevista = 0;
const prevista = (due_date, amount, extra = {}) => ({
  id: `pppppppp-0000-0000-0000-${String(++seqPrevista).padStart(12, "0")}`,
  description: "Conta de luz",
  amount,
  due_date,
  tipo: "expense",
  ...extra,
});

let seqRec = 0;
const recorrencia = (next_expected_date, avg_amount, extra = {}) => ({
  id: `rrrrrrrr-0000-0000-0000-${String(++seqRec).padStart(12, "0")}`,
  merchant_key: "netflix",
  display_name: "Netflix",
  avg_amount,
  frequency: "MONTHLY",
  next_expected_date,
  status: "DETECTED",
  ...extra,
});

const fluxo = (parcial = {}) =>
  projetarFluxoDeCaixa({
    contas: [corrente(1000)],
    previstas: [],
    recorrencias: [],
    hoje: HOJE,
    dias: 30,
    ...parcial,
  });

/** O dia da linha com aquela data. */
const dia = (f, data) => f.linha.find((d) => d.data === data);

// ---------------------------------------------------------------------------
// 1. Forma da linha
// ---------------------------------------------------------------------------

test("a linha tem um item por dia, comecando hoje", () => {
  const f = fluxo({ dias: 30 });
  assert.equal(f.linha.length, 30);
  assert.equal(f.linha[0].data, HOJE);
  assert.equal(f.linha[29].data, "2026-10-09");
  assert.equal(f.ate, "2026-10-09");
});

test("sem evento nenhum o saldo nao anda", () => {
  const f = fluxo();
  assert.equal(f.saldoInicial, 1000);
  assert.equal(f.saldoFinal, 1000);
  assert.equal(f.totalEntra, 0);
  assert.equal(f.totalSai, 0);
  assert.equal(f.primeiroDiaNegativo, null);
  assert.equal(f.menorSaldo, 1000);
  assert.equal(f.diaDoMenorSaldo, HOJE);
});

test("horizonte fora da faixa e corrigido, nao rejeitado", () => {
  assert.equal(horizonteValido(undefined), DIAS_PADRAO);
  assert.equal(horizonteValido(0), DIAS_PADRAO);
  assert.equal(horizonteValido(-5), DIAS_PADRAO);
  assert.equal(horizonteValido("abc"), DIAS_PADRAO);
  assert.equal(horizonteValido(9999), DIAS_MAX);
  assert.equal(horizonteValido(45), 45);
  assert.equal(horizonteValido(45.9), 45);
});

test("o horizonte nao passa do teto nem quando pedido", () => {
  const f = fluxo({ dias: 5000 });
  assert.equal(f.linha.length, DIAS_MAX);
  assert.equal(f.dias, DIAS_MAX);
});

// ---------------------------------------------------------------------------
// 2. Saldo inicial: quem entra e quem fica de fora
// ---------------------------------------------------------------------------

test("investimento nao e dinheiro para pagar a conta de quinta", () => {
  const f = fluxo({
    contas: [
      corrente(1000),
      { id: "i1", name: "Corretora", account_type: "investment", current_balance: 50000, is_active: true },
    ],
  });
  assert.equal(f.saldoInicial, 1000);
});

test("conta arquivada fica fora do saldo inicial", () => {
  const f = fluxo({ contas: [corrente(1000), corrente(700, { id: "a2", is_active: false })] });
  assert.equal(f.saldoInicial, 1000);
});

test("ARMADILHA 2: a divida do cartao NAO e descontada do saldo inicial", () => {
  // No lib/safe-to-spend.ts ela e -- e la esta certo. Aqui ela entraria duas
  // vezes, porque a fatura fechada vira conta prevista com data. Se este teste
  // falhar, alguem "alinhou" os dois arquivos e reintroduziu a contagem dupla.
  const f = fluxo({ contas: [corrente(1000), cartao(-800)] });
  assert.equal(f.saldoInicial, 1000);
  assert.equal(f.saldoFinal, 1000);
});

test("ARMADILHA 2: a fatura entra como evento datado, e so ela", () => {
  const f = fluxo({
    contas: [corrente(1000), cartao(-800)],
    previstas: [
      prevista("2026-09-20", 800, {
        description: "Fatura do cartao",
        notes: "fatura:2026-09:cccccccc-0000-0000-0000-000000000001",
      }),
    ],
  });
  // 1000 - 800 = 200, e nao -600 (que seria o saldo do cartao somado junto).
  assert.equal(f.saldoFinal, 200);
  assert.equal(dia(f, "2026-09-20").sai, 800);
});

// ---------------------------------------------------------------------------
// 3. Contas previstas
// ---------------------------------------------------------------------------

test("a despesa prevista cai no dia do vencimento", () => {
  const f = fluxo({ previstas: [prevista("2026-09-15", 300)] });
  assert.equal(dia(f, "2026-09-14").saldo, 1000);
  assert.equal(dia(f, "2026-09-15").saldo, 700);
  assert.equal(dia(f, "2026-09-15").sai, 300);
  assert.equal(f.saldoFinal, 700);
});

test("a receita prevista soma", () => {
  const f = fluxo({ previstas: [prevista("2026-09-15", 2500, { tipo: "income", description: "Salario" })] });
  assert.equal(dia(f, "2026-09-15").entra, 2500);
  assert.equal(f.saldoFinal, 3500);
  assert.equal(f.totalEntra, 2500);
});

test("previsto depois do horizonte nao entra", () => {
  const f = fluxo({ dias: 10, previstas: [prevista("2026-09-25", 300)] });
  assert.equal(f.saldoFinal, 1000);
  assert.equal(f.totalSai, 0);
});

test("previsto depois do horizonte tambem nao absorve assinatura de dentro", () => {
  // Achado por mutacao: tirar o corte de horizonte da leitura das previstas
  // parecia inofensivo -- o evento dela cairia fora da linha de qualquer jeito.
  // Nao e: ela entraria na lista de candidatas a absorver, engoliria a cobranca
  // de 19/09 que esta DENTRO da janela, e os R$ 55 sumiriam da previsao sem
  // aparecer em lugar nenhum. O dinheiro nao pode evaporar entre as duas
  // fontes; ou ele esta na conta prevista, ou esta na assinatura.
  const f = fluxo({
    dias: 11, // 10/09 a 20/09
    previstas: [prevista("2026-09-22", 55, { description: "Netflix" })],
    recorrencias: [recorrencia("2026-09-19", 55)],
  });
  assert.equal(f.totalSai, 55);
  assert.equal(dia(f, "2026-09-19").sai, 55);
  assert.deepEqual(f.absorvidasPelaAgenda, []);
});

test("cobrancasNaJanela nao devolve data anterior a janela", () => {
  // Contrato da propria funcao, e nao do fluxo: uma data antes de `de` seria
  // descartada la na frente (a linha comeca em hoje), entao o fluxo inteiro
  // nao distingue. Aqui distingue -- e e aqui que a garantia mora.
  assert.deepEqual(cobrancasNaJanela(recorrencia("2026-06-20", 55), HOJE, "2026-10-31"), [
    "2026-09-20",
    "2026-10-20",
  ]);
});

test("ARMADILHA 4: conta vencida nao some, cai em hoje", () => {
  const f = fluxo({ previstas: [prevista("2026-08-30", 300)] });
  assert.equal(dia(f, HOJE).sai, 300);
  assert.equal(dia(f, HOJE).saldo, 700);
  assert.equal(dia(f, HOJE).eventos[0].vencida, true);
});

test("o valor entra em modulo mesmo se vier negativo do banco", () => {
  const f = fluxo({ previstas: [prevista("2026-09-15", -300)] });
  assert.equal(dia(f, "2026-09-15").sai, 300);
  assert.equal(f.saldoFinal, 700);
});

test("numeric em texto (o que o PostgREST devolve) e lido como numero", () => {
  const f = fluxo({
    contas: [corrente("1000.00")],
    previstas: [prevista("2026-09-15", "300.50")],
  });
  assert.equal(f.saldoInicial, 1000);
  assert.equal(f.saldoFinal, 699.5);
});

// ---------------------------------------------------------------------------
// 4. Recorrencias detectadas
// ---------------------------------------------------------------------------

test("a assinatura detectada cobra dentro da janela", () => {
  // 70 dias a partir de 10/09 terminam em 18/11: a cobranca de 20/11 fica de
  // fora da janela, e e por isso que o total e 110 e nao 165.
  const f = fluxo({ dias: 70, recorrencias: [recorrencia("2026-09-20", 55)] });
  assert.equal(f.ate, "2026-11-18");
  assert.equal(dia(f, "2026-09-20").sai, 55);
  assert.equal(dia(f, "2026-10-20").sai, 55);
  assert.equal(dia(f, "2026-11-20"), undefined);
  assert.equal(f.totalSai, 110);
});

test("ARMADILHA 5: next_expected no passado e rolada para a frente", () => {
  // Varredura antiga: a proxima cobranca "prevista" e de junho. A assinatura
  // continua cobrando -- some-la e o lado conservador do erro.
  const f = fluxo({ dias: 30, recorrencias: [recorrencia("2026-06-20", 55)] });
  assert.equal(f.totalSai, 55);
  assert.equal(dia(f, "2026-09-20").sai, 55);
  // e nenhuma cobranca em dia que ja passou
  assert.equal(f.linha[0].sai, 0);
});

test("ARMADILHA 5: data malformada nao trava nem cobra", () => {
  const f = fluxo({ recorrencias: [recorrencia("nao-e-data", 55)] });
  assert.equal(f.totalSai, 0);
  assert.deepEqual(cobrancasNaJanela({ frequency: "MONTHLY", next_expected_date: "" }, HOJE, "2026-12-31"), []);
});

test("semanal e anual usam o proprio passo", () => {
  const semanal = fluxo({
    dias: 30,
    recorrencias: [recorrencia("2026-09-11", 10, { frequency: "WEEKLY", merchant_key: "academia", display_name: "Academia" })],
  });
  // 11, 18, 25, 02/10, 09/10 -> 5 cobrancas em 30 dias
  assert.equal(semanal.totalSai, 50);

  const anual = fluxo({
    dias: 30,
    recorrencias: [recorrencia("2026-09-11", 240, { frequency: "YEARLY", merchant_key: "dominio", display_name: "Dominio" })],
  });
  assert.equal(anual.totalSai, 240);
});

test("ARMADILHA 6: IGNORED e CANCELLED nao projetam nada", () => {
  for (const status of ["IGNORED", "CANCELLED"]) {
    const f = fluxo({ recorrencias: [recorrencia("2026-09-20", 55, { status })] });
    assert.equal(f.totalSai, 0, `status ${status} nao pode projetar`);
  }
});

test("CONFIRMED projeta igual a DETECTED", () => {
  const f = fluxo({ recorrencias: [recorrencia("2026-09-20", 55, { status: "CONFIRMED" })] });
  assert.equal(f.totalSai, 55);
});

test("assinatura com valor zero nao vira evento vazio na lista", () => {
  const f = fluxo({ recorrencias: [recorrencia("2026-09-20", 0)] });
  assert.equal(f.totalSai, 0);
  assert.equal(dia(f, "2026-09-20").eventos.length, 0);
});

// ---------------------------------------------------------------------------
// 5. ARMADILHA 1: a mesma cobranca nas duas fontes
// ---------------------------------------------------------------------------

test("ARMADILHA 1: conta prevista e assinatura do mesmo lugar contam UMA vez", () => {
  const f = fluxo({
    previstas: [prevista("2026-09-20", 55, { description: "NETFLIX.COM*4455" })],
    recorrencias: [recorrencia("2026-09-18", 55)],
  });
  assert.equal(f.totalSai, 55);
  assert.equal(f.saldoFinal, 945);
  assert.deepEqual(f.absorvidasPelaAgenda, ["Netflix"]);
});

test("ARMADILHA 1: quem sobrevive e a conta prevista, com a data e o valor dela", () => {
  const f = fluxo({
    previstas: [prevista("2026-09-20", 61, { description: "Netflix" })],
    recorrencias: [recorrencia("2026-09-18", 55)],
  });
  assert.equal(dia(f, "2026-09-20").sai, 61);
  assert.equal(dia(f, "2026-09-18").sai, 0);
});

test("ARMADILHA 1: fora da tolerancia as duas contam -- sao cobrancas diferentes", () => {
  const f = fluxo({
    previstas: [prevista("2026-09-28", 55, { description: "Netflix" })],
    recorrencias: [recorrencia("2026-09-18", 55)],
  });
  assert.equal(f.totalSai, 110);
  assert.deepEqual(f.absorvidasPelaAgenda, []);
});

test("ARMADILHA 1: a tolerancia vale nos dois sentidos, e a borda e inclusiva", () => {
  const naBorda = fluxo({
    previstas: [prevista("2026-09-25", 55, { description: "Netflix" })],
    recorrencias: [recorrencia("2026-09-18", 55)],
  });
  assert.equal(TOLERANCIA_DUPLICATA_DIAS, 7);
  assert.equal(naBorda.totalSai, 55, "7 dias de distancia ainda e a mesma cobranca");

  const antes = fluxo({
    previstas: [prevista("2026-09-13", 55, { description: "Netflix" })],
    recorrencias: [recorrencia("2026-09-18", 55)],
  });
  assert.equal(antes.totalSai, 55, "a conta prevista pode vir ANTES da cobranca detectada");
});

test("ARMADILHA 1: uma conta prevista absorve UMA cobranca, nao a assinatura inteira", () => {
  // Semanal com uma unica conta prevista cadastrada: as outras semanas
  // continuam saindo. Sem o consumo por ocorrencia, a academia inteira
  // desapareceria da previsao.
  const f = fluxo({
    dias: 30,
    previstas: [prevista("2026-09-11", 10, { description: "Academia" })],
    recorrencias: [
      recorrencia("2026-09-11", 10, {
        frequency: "WEEKLY",
        merchant_key: "academia",
        display_name: "Academia",
      }),
    ],
  });
  // 5 cobrancas semanais; uma absorvida pela conta prevista de mesmo valor.
  assert.equal(f.totalSai, 50);
  assert.equal(dia(f, "2026-09-11").eventos.length, 1);
});

test("ARMADILHA 1: estabelecimento diferente nao absorve", () => {
  const f = fluxo({
    previstas: [prevista("2026-09-20", 55, { description: "Spotify" })],
    recorrencias: [recorrencia("2026-09-18", 55)],
  });
  assert.equal(f.totalSai, 110);
});

test("ARMADILHA 1: receita nunca absorve assinatura", () => {
  // Um salario descrito como "Netflix" e absurdo, mas o detector so agrupa
  // despesa: deixar a receita casar apagaria a assinatura da previsao.
  const f = fluxo({
    previstas: [prevista("2026-09-20", 3000, { description: "Netflix", tipo: "income" })],
    recorrencias: [recorrencia("2026-09-18", 55)],
  });
  assert.equal(f.totalEntra, 3000);
  assert.equal(f.totalSai, 55);
});

test("ARMADILHA 1: conta prevista sem descricao nao absorve nada", () => {
  const f = fluxo({
    previstas: [prevista("2026-09-20", 55, { description: null })],
    recorrencias: [recorrencia("2026-09-18", 55)],
  });
  assert.equal(f.totalSai, 110);
});

test("ARMADILHA 1: chave vazia nao e curinga -- nem de um lado nem do outro", () => {
  // O detector NAO grava chave vazia (`if (!chave) continue` no
  // detectRecurrences), mas o schema tambem NAO proibe: nao ha CHECK de
  // `merchant_key <> ''` na tabela do 011 -- conferido no banco de producao.
  // Entao a garantia tem que estar aqui. Sem ela, uma unica conta prevista sem
  // descricao viraria curinga e engoliria a cobranca, que sumiria das duas
  // fontes: nao aparece como conta (ela tem outro valor) nem como assinatura.
  const f = fluxo({
    previstas: [prevista("2026-09-20", 900, { description: null })],
    recorrencias: [recorrencia("2026-09-18", 55, { merchant_key: "", display_name: "Sem nome" })],
  });
  assert.equal(f.totalSai, 955);
  assert.deepEqual(f.absorvidasPelaAgenda, []);
});

// ---------------------------------------------------------------------------
// 6. ARMADILHA 3: o dia negativo
// ---------------------------------------------------------------------------

test("o dia negativo e o PRIMEIRO cruzamento", () => {
  const f = fluxo({
    contas: [corrente(500)],
    previstas: [prevista("2026-09-15", 600), prevista("2026-09-25", 100)],
  });
  assert.equal(f.primeiroDiaNegativo, "2026-09-15");
  assert.equal(f.comecaNegativo, false);
});

test("o dia negativo continua sendo o primeiro mesmo quando o saldo se recupera", () => {
  const f = fluxo({
    contas: [corrente(500)],
    previstas: [
      prevista("2026-09-15", 600),
      prevista("2026-09-16", 2000, { tipo: "income", description: "Salario" }),
    ],
  });
  assert.equal(f.primeiroDiaNegativo, "2026-09-15");
  assert.equal(f.saldoFinal, 1900);
  assert.equal(f.menorSaldo, -100);
  assert.equal(f.diaDoMenorSaldo, "2026-09-15");
});

test("saldo que nao cruza zero nao inventa data", () => {
  const f = fluxo({ previstas: [prevista("2026-09-15", 999.99)] });
  assert.equal(f.primeiroDiaNegativo, null);
});

test("zero em ponto nao e negativo", () => {
  const f = fluxo({ previstas: [prevista("2026-09-15", 1000)] });
  assert.equal(f.primeiroDiaNegativo, null);
  assert.equal(f.saldoFinal, 0);
});

test("ARMADILHA 3: quem ja esta no vermelho nao recebe uma data de mergulho", () => {
  const f = fluxo({ contas: [corrente(-200)], previstas: [prevista("2026-09-15", 100)] });
  assert.equal(f.comecaNegativo, true);
  assert.equal(f.primeiroDiaNegativo, null);
  assert.equal(f.menorSaldo, -300);
  assert.equal(f.diaDoMenorSaldo, "2026-09-15");
});

test("o menor saldo empatado fica com o dia mais cedo", () => {
  const f = fluxo({
    previstas: [
      prevista("2026-09-15", 400),
      prevista("2026-09-20", 400),
      prevista("2026-09-21", 400, { tipo: "income", description: "Reembolso" }),
    ],
  });
  // 1000 -> 600 (15) -> 200 (20) -> 600 (21). O fundo do poco e dia 20.
  assert.equal(f.menorSaldo, 200);
  assert.equal(f.diaDoMenorSaldo, "2026-09-20");
});

// ---------------------------------------------------------------------------
// 7. A lista de proximos eventos
// ---------------------------------------------------------------------------

test("proximosEventos vem em ordem de data com o saldo corrente ao lado", () => {
  const f = fluxo({
    previstas: [
      prevista("2026-09-20", 300),
      prevista("2026-09-15", 100),
      prevista("2026-09-18", 2000, { tipo: "income", description: "Salario" }),
    ],
  });
  const eventos = proximosEventos(f);
  assert.deepEqual(
    eventos.map((e) => [e.data, e.valor, e.saldoDepois]),
    [
      ["2026-09-15", -100, 900],
      ["2026-09-18", 2000, 2900],
      ["2026-09-20", -300, 2600],
    ]
  );
});

test("dentro do dia, a despesa aparece antes da receita", () => {
  const f = fluxo({
    previstas: [
      prevista("2026-09-15", 2000, { tipo: "income", description: "Salario" }),
      prevista("2026-09-15", 100),
    ],
  });
  const eventos = proximosEventos(f);
  assert.equal(eventos[0].valor, -100);
  assert.equal(eventos[1].valor, 2000);
});

test("proximosEventos respeita o limite", () => {
  const previstas = [];
  for (let i = 0; i < 40; i++) previstas.push(prevista(`2026-09-${String(11 + (i % 10)).padStart(2, "0")}`, 1));
  const f = fluxo({ previstas });
  assert.equal(proximosEventos(f, 5).length, 5);
  assert.equal(proximosEventos(f, 100).length, 40);
});

test("a origem de cada evento vai junto -- a tela separa conta de assinatura", () => {
  const f = fluxo({
    previstas: [prevista("2026-09-15", 100)],
    recorrencias: [recorrencia("2026-09-16", 55)],
  });
  const eventos = proximosEventos(f);
  assert.deepEqual(
    eventos.map((e) => [e.origem, e.descricao]),
    [
      ["prevista", "Conta de luz"],
      ["recorrencia", "Netflix"],
    ]
  );
});

// ---------------------------------------------------------------------------
// 7. A segunda linha: gasto variavel do dia a dia
// ---------------------------------------------------------------------------
// A linha otimista continua sendo o piso de tudo que este arquivo afirma, e
// nenhum destes testes pode mexer nela. O que se prova aqui:
//
//   * sem media, as duas linhas sao a MESMA -- quem nao tem historico nao
//     ganha uma segunda linha desenhada em cima de nada;
//   * a linha provavel nunca fica acima da otimista, nem com valor absurdo,
//     nem com sinal trocado. E a unica coisa que ela nao pode ser;
//   * o gasto comeca AMANHA, porque o saldo de hoje ja carrega o de hoje.

test("sem gasto variavel, a linha provavel e identica a otimista", () => {
  const f = fluxo({ previstas: [prevista("2026-09-15", 300)] });

  assert.equal(f.gastoDiario, 0);
  assert.equal(f.gastoVariavelTotal, 0);
  assert.equal(f.saldoFinalProvavel, f.saldoFinal);
  assert.equal(f.primeiroDiaNegativoProvavel, f.primeiroDiaNegativo);
  for (const d of f.linha) {
    assert.equal(d.saldoProvavel, d.saldo, `divergiu em ${d.data}`);
  }
});

test("o gasto variavel comeca amanha, nao hoje", () => {
  // O saldo de hoje ja e o saldo da conta, e nele ja esta o que a pessoa
  // gastou e lancou hoje. Cobrar o dia cheio de hoje por cima disso conta
  // parte do dia duas vezes.
  const f = fluxo({ gastoDiario: 50 });

  assert.equal(dia(f, HOJE).saldoProvavel, 1000);
  assert.equal(dia(f, "2026-09-11").saldoProvavel, 950);
  assert.equal(dia(f, "2026-09-12").saldoProvavel, 900);
  // 30 dias de horizonte, 29 dias cobrados.
  assert.equal(f.gastoVariavelTotal, 50 * 29);
  assert.equal(f.saldoFinalProvavel, 1000 - 50 * 29);
});

test("a linha provavel desce mais cedo que a otimista", () => {
  const f = fluxo({
    contas: [corrente(1000)],
    previstas: [prevista("2026-09-28", 900)],
    gastoDiario: 50,
    dias: 30,
  });

  // Otimista: so a conta de 900 no dia 28 -> sobram 100, e a linha nunca cruza
  // o zero. E a tela diria "voce nao fica negativo" para quem vai ficar.
  assert.equal(f.primeiroDiaNegativo, null);
  assert.ok(f.saldoFinal > 0);

  // Provavel: os 50/dia desde amanha ja tinham comido 900 quando a conta
  // chegou (18 dias, de 11 a 28), entao o dia 28 fecha em -800.
  assert.equal(f.primeiroDiaNegativoProvavel, "2026-09-28");
  assert.equal(dia(f, "2026-09-28").saldoProvavel, -800);
  assert.ok(f.saldoFinalProvavel < 0);
});

test("a linha provavel NUNCA fica acima da otimista", () => {
  const f = fluxo({
    previstas: [prevista("2026-09-15", 300), prevista("2026-09-20", 2000, { tipo: "income" })],
    recorrencias: [recorrencia("2026-09-12", 55)],
    gastoDiario: 37.5,
  });

  for (const d of f.linha) {
    assert.ok(
      d.saldoProvavel <= d.saldo + 1e-9,
      `${d.data}: provavel ${d.saldoProvavel} acima da otimista ${d.saldo}`
    );
  }
});

test("gasto variavel negativo vira zero, nunca receita", () => {
  // Este e o repositorio onde despesa e gravada NEGATIVA: um sinal trocado
  // chegando aqui e questao de tempo. Somado, ele desenharia a linha provavel
  // ACIMA da otimista -- prometendo dinheiro que nao existe.
  const f = fluxo({ gastoDiario: -80 });

  assert.equal(f.gastoDiario, 0);
  assert.equal(f.saldoFinalProvavel, f.saldoFinal);
});

test("gasto variavel invalido vira zero, e nao NaN na tela", () => {
  for (const ruim of [Number.NaN, Infinity, null, undefined, "abc"]) {
    const f = fluxo({ gastoDiario: ruim });
    assert.equal(f.gastoDiario, 0, `${String(ruim)} deveria virar zero`);
    assert.ok(Number.isFinite(f.saldoFinalProvavel));
  }
});

test("o gastoDiario devolvido e o SANEADO, nao o que foi pedido", () => {
  // A tela imprime o numero que entrou na conta. Se ela imprimisse o que
  // pediu, as duas passariam a discordar em silencio.
  assert.equal(fluxo({ gastoDiario: -5 }).gastoDiario, 0);
  assert.equal(fluxo({ gastoDiario: 42.5 }).gastoDiario, 42.5);
});

test("o fundo do poco da linha provavel e proprio dela", () => {
  const f = fluxo({
    previstas: [prevista("2026-09-12", 500), prevista("2026-09-14", 500, { tipo: "income" })],
    gastoDiario: 20,
    dias: 30,
  });

  // Otimista: mergulha no dia 12 (500 -> 500) e volta no dia 14 (-> 1000).
  assert.equal(f.diaDoMenorSaldo, "2026-09-12");
  assert.equal(f.menorSaldo, 500);

  // Provavel: o gasto diario nunca para, entao o fundo e o ULTIMO dia.
  assert.equal(f.diaDoMenorSaldoProvavel, "2026-10-09");
  assert.ok(f.menorSaldoProvavel < f.menorSaldo);
});

test("quem ja esta negativo hoje nao recebe data de mergulho em nenhuma das linhas", () => {
  const f = fluxo({ contas: [corrente(-200)], gastoDiario: 50 });

  assert.equal(f.comecaNegativo, true);
  assert.equal(f.primeiroDiaNegativo, null);
  assert.equal(f.primeiroDiaNegativoProvavel, null);
});

test("o gasto variavel nao mexe na linha otimista", () => {
  // A blindagem: nenhum numero da linha de compromissos pode mudar por causa
  // da media. Se mudar, a media parou de ser uma segunda leitura e virou uma
  // correcao da primeira.
  const semMedia = fluxo({
    previstas: [prevista("2026-09-15", 300)],
    recorrencias: [recorrencia("2026-09-12", 55)],
  });
  const comMedia = fluxo({
    previstas: [prevista("2026-09-15", 300)],
    recorrencias: [recorrencia("2026-09-12", 55)],
    gastoDiario: 75,
  });

  assert.equal(comMedia.saldoFinal, semMedia.saldoFinal);
  assert.equal(comMedia.menorSaldo, semMedia.menorSaldo);
  assert.equal(comMedia.diaDoMenorSaldo, semMedia.diaDoMenorSaldo);
  assert.equal(comMedia.totalSai, semMedia.totalSai);
  assert.equal(comMedia.totalEntra, semMedia.totalEntra);
  assert.equal(comMedia.primeiroDiaNegativo, semMedia.primeiroDiaNegativo);
  assert.deepEqual(
    comMedia.linha.map((d) => d.saldo),
    semMedia.linha.map((d) => d.saldo)
  );
});

test("o gasto variavel NAO entra no totalSai", () => {
  // `totalSai` e o cartao "A pagar" da tela, e ele fala de compromissos com
  // data. Misturar a media ali faria a soma das contas previstas mudar sem que
  // nenhuma conta tenha sido criada.
  const f = fluxo({ previstas: [prevista("2026-09-15", 300)], gastoDiario: 50 });
  assert.equal(f.totalSai, 300);
});
