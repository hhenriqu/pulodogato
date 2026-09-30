#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DO PERIODO DO PAINEL (HMO-173)
// =====================================================
//   npm run test:periodo-painel
//
// Exercita lib/periodo-do-painel.ts. Quatro familias de erro, todas do mesmo
// tipo -- numero errado sem sintoma:
//
//   1. O MES CORRENTE EM UTC. `new Date().toISOString().slice(0, 7)` no dia
//      30/09 as 22:00 em Sao Paulo ja e "2026-10". O painel achava a linha de
//      outubro no resumo de contas previstas e mostrava as contas do mes que
//      vem debaixo de "a vencer neste mes". A tela nao fica vazia, nao da
//      erro, e o numero e plausivel. O teste abaixo congela exatamente esse
//      instante e tem controle positivo: ele AFIRMA que a forma antiga erra,
//      para nao virar um teste que passa porque o fixture e inofensivo.
//
//   2. A TRANSFERENCIA DENTRO DA AGREGACAO. Transferencia entre contas e
//      pagamento de fatura sao gravados como DUAS pernas. Somando as duas,
//      receita e despesa incham pelo mesmo valor e o `net` fica EXATO -- quem
//      confere olha o saldo, ve bater, e nunca desconfia dos dois tiles de
//      cima. Por isso o fixture tem transferencia: um fixture so com receita e
//      despesa passa verde com o bug de pe.
//
//   3. O PASSO DE MES QUE DESALINHA O MES. 31/01 mais um mes e 28/02; se o
//      fim do periodo fosse somado em vez de recalculado, marco apareceria com
//      28 dos 31 dias e a diferenca sumiria do tile sem aparecer em lugar
//      nenhum.
//
//   4. MATERIALIZAR AGENDA NO PASSADO. `materializarAgenda` ESCREVE. Rodar
//      numa janela que ja passou criaria contas com vencimento retroativo, que
//      nascem vencidas -- o app acusaria atraso em divida que nunca existiu.
//
// Mesmo desenho do test-reports.mjs: .mjs rodando o JS que o tsc ja compila,
// sem runner de teste novo no package.json.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  agregarTransacoes,
  agregarTransacoesPorMoeda,
  contemHoje,
  ehDataIso,
  ehPeriodoCorrente,
  janelaParaMaterializar,
  lerPeriodo,
  mesesDoPeriodo,
  modoDoPeriodo,
  passoDeMes,
  periodoCorrente,
  periodoDaQuery,
  periodoDoPreset,
  periodoParaQuery,
  presetDoPeriodo,
  rotuloDoPeriodo,
  rotuloDoSaldo,
  somarPrevistas,
  terminaNoPassado,
  ultimoDiaDoMes,
} = await import("../.tmp-periodo-painel/periodo-do-painel.js");

// ---------------------------------------------------------------------------
// O relogio congelado
// ---------------------------------------------------------------------------
// `today()` chama `new Date()`, e nao ha como injetar o instante por
// parametro sem mudar a assinatura que bills, budgets e goals ja usam. Trocar
// o `Date` global durante a chamada e o menor gesto que prova o
// comportamento no horario em que ele quebrava.
function comRelogioEm(instanteIso, fn) {
  const Real = Date;
  const fixo = new Real(instanteIso).getTime();

  class Congelada extends Real {
    constructor(...args) {
      if (args.length === 0) super(fixo);
      else super(...args);
    }
    static now() {
      return fixo;
    }
  }

  globalThis.Date = Congelada;
  try {
    return fn();
  } finally {
    globalThis.Date = Real;
  }
}

// O instante do aceite 1: 30 de setembro de 2026, 22:00 em America/Sao_Paulo
// (UTC-3). Em UTC ja e 1o de outubro.
const VESPERA_DE_VIRADA = "2026-10-01T01:00:00Z";

// ---------------------------------------------------------------------------
// 1. O mes corrente sai do fuso de Sao Paulo, nao de UTC
// ---------------------------------------------------------------------------

test("as 22:00 de 30/09 em Sao Paulo, o painel abre em SETEMBRO", () => {
  const periodo = comRelogioEm(VESPERA_DE_VIRADA, () => periodoCorrente());

  assert.equal(periodo.de, "2026-09-01");
  assert.equal(periodo.ate, "2026-09-30");
  assert.equal(periodo.modo, "mes");
  assert.equal(rotuloDoPeriodo(periodo), "setembro de 2026");
});

test("CONTROLE: a forma antiga (UTC) erra nesse mesmo instante", () => {
  // Sem esta assercao, o teste acima passaria identico num fixture inocente --
  // e ninguem saberia se ele cobre a armadilha ou so o caso facil.
  const mesEmUtc = comRelogioEm(VESPERA_DE_VIRADA, () =>
    new Date().toISOString().slice(0, 7)
  );

  assert.equal(mesEmUtc, "2026-10");
});

test("sem parametro na URL, o periodo e o mes corrente em Sao Paulo", () => {
  const periodo = comRelogioEm(VESPERA_DE_VIRADA, () => lerPeriodo(null, null));
  assert.deepEqual(periodo, {
    de: "2026-09-01",
    ate: "2026-09-30",
    modo: "mes",
  });
});

// ---------------------------------------------------------------------------
// 2. As setas andam mes a mes e continuam colando no mes
// ---------------------------------------------------------------------------

test("a seta avanca um mes inteiro, recalculando o ultimo dia", () => {
  const janeiro = { de: "2026-01-01", ate: "2026-01-31", modo: "mes" };

  const fevereiro = passoDeMes(janeiro, 1);
  // Somar 1 mes a 31/01 daria 28/02 pelo clamp -- o que por acaso acerta aqui.
  // O caso que denuncia a soma ingenua e o passo SEGUINTE.
  assert.deepEqual(fevereiro, {
    de: "2026-02-01",
    ate: "2026-02-28",
    modo: "mes",
  });

  const marco = passoDeMes(fevereiro, 1);
  assert.deepEqual(marco, { de: "2026-03-01", ate: "2026-03-31", modo: "mes" });
});

test("a seta volta um mes, e ir e voltar devolve o mesmo periodo", () => {
  const marco = { de: "2026-03-01", ate: "2026-03-31", modo: "mes" };
  assert.deepEqual(passoDeMes(passoDeMes(marco, -1), 1), marco);
});

test("a seta atravessa o ano", () => {
  const dezembro = { de: "2025-12-01", ate: "2025-12-31", modo: "mes" };
  assert.deepEqual(passoDeMes(dezembro, 1), {
    de: "2026-01-01",
    ate: "2026-01-31",
    modo: "mes",
  });
});

test("nao ha limite para frente nem para tras", () => {
  const hoje = { de: "2026-09-01", ate: "2026-09-30", modo: "mes" };
  assert.equal(passoDeMes(hoje, 12).de, "2027-09-01");
  assert.equal(passoDeMes(hoje, -120).de, "2016-09-01");
});

test("uma janela de 3 meses anda preservando o tamanho", () => {
  const trimestre = { de: "2026-07-01", ate: "2026-09-30", modo: "mes" };
  assert.deepEqual(passoDeMes(trimestre, 1), {
    de: "2026-08-01",
    ate: "2026-10-31",
    modo: "mes",
  });
  assert.equal(mesesDoPeriodo(passoDeMes(trimestre, 1)).length, 3);
});

test("um intervalo que, ao andar, vira mes inteiro PASSA a ser modo mes", () => {
  // 01/01 a 28/01 e recorte solto. Mais um mes, o clamp leva o fim para
  // 28/02 -- que em 2026 E o ultimo dia de fevereiro. O periodo virou um mes
  // inteiro, e a proxima consulta tem que sair das views do 008, nao da
  // agregacao por data. Por isso `passoDeMes` RECALCULA o modo em vez de
  // herda-lo: herdado, o painel continuaria perguntando pelo caminho errado.
  const recorte = { de: "2026-01-01", ate: "2026-01-28", modo: "intervalo" };
  assert.deepEqual(passoDeMes(recorte, 1), {
    de: "2026-02-01",
    ate: "2026-02-28",
    modo: "mes",
  });
});

test("um intervalo solto anda de mes em mes e continua intervalo", () => {
  const solto = { de: "2026-09-15", ate: "2026-10-20", modo: "intervalo" };
  assert.deepEqual(passoDeMes(solto, 1), {
    de: "2026-10-15",
    ate: "2026-11-20",
    modo: "intervalo",
  });
});

// ---------------------------------------------------------------------------
// 3. Modo mes x modo intervalo -- quem decide de onde vem a resposta
// ---------------------------------------------------------------------------

test("mes inteiro e modo mes; recorte solto e modo intervalo", () => {
  assert.equal(modoDoPeriodo("2026-09-01", "2026-09-30"), "mes");
  assert.equal(modoDoPeriodo("2026-07-01", "2026-09-30"), "mes");
  assert.equal(modoDoPeriodo("2026-01-01", "2026-12-31"), "mes");

  // O que as views do 008 nao respondem: qualquer ponta no meio de um mes.
  assert.equal(modoDoPeriodo("2026-09-15", "2026-10-20"), "intervalo");
  assert.equal(modoDoPeriodo("2026-09-01", "2026-09-29"), "intervalo");
  assert.equal(modoDoPeriodo("2026-09-02", "2026-09-30"), "intervalo");
});

test("fevereiro bissexto tem 29 dias, e o modo mes reconhece", () => {
  assert.equal(ultimoDiaDoMes("2028-02-10"), "2028-02-29");
  assert.equal(modoDoPeriodo("2028-02-01", "2028-02-29"), "mes");
  assert.equal(modoDoPeriodo("2028-02-01", "2028-02-28"), "intervalo");
});

test("os meses do periodo sao a chave das views do 008", () => {
  assert.deepEqual(
    mesesDoPeriodo({ de: "2026-07-01", ate: "2026-09-30", modo: "mes" }),
    ["2026-07-01", "2026-08-01", "2026-09-01"]
  );
  // Em modo intervalo, os meses das pontas ainda sao os meses TOCADOS: a
  // rota usa isso so para dimensionar a janela, nunca para somar.
  assert.deepEqual(
    mesesDoPeriodo({ de: "2026-09-15", ate: "2026-10-20", modo: "intervalo" }),
    ["2026-09-01", "2026-10-01"]
  );
});

// ---------------------------------------------------------------------------
// 4. A URL e a fonte da verdade
// ---------------------------------------------------------------------------

test("recarregar com ?de=&ate= cai no mesmo periodo", () => {
  const original = { de: "2026-07-01", ate: "2026-09-30", modo: "mes" };
  const query = periodoParaQuery(original);
  assert.equal(query, "de=2026-07-01&ate=2026-09-30");

  const params = new URLSearchParams(query);
  assert.deepEqual(
    lerPeriodo(params.get("de"), params.get("ate"), "2026-09-29"),
    original
  );
});

test("um intervalo personalizado tambem sobrevive a ida e volta pela URL", () => {
  const original = { de: "2026-09-15", ate: "2026-10-20", modo: "intervalo" };
  const params = new URLSearchParams(periodoParaQuery(original));
  assert.deepEqual(
    lerPeriodo(params.get("de"), params.get("ate"), "2026-09-29"),
    original
  );
});

test("na TELA, parametro estragado vira o mes corrente em vez de tela branca", () => {
  const hoje = "2026-09-29";
  const setembro = { de: "2026-09-01", ate: "2026-09-30", modo: "mes" };

  assert.deepEqual(lerPeriodo("2026-13-01", "2026-09-30", hoje), setembro);
  assert.deepEqual(lerPeriodo("2026-02-31", "2026-09-30", hoje), setembro);
  assert.deepEqual(lerPeriodo("ontem", "hoje", hoje), setembro);
  assert.deepEqual(lerPeriodo("2026-09-01", null, hoje), setembro);
  // Invertido: o `ate` antes do `de` descreveria um periodo vazio.
  assert.deepEqual(lerPeriodo("2026-09-30", "2026-09-01", hoje), setembro);
});

test("na ROTA, o mesmo parametro estragado e 400 -- nao o mes corrente", () => {
  // A diferenca e deliberada: uma rota que responde setembro a quem pediu
  // julho manda numero errado para um chamador que nao tem como perceber.
  assert.equal(periodoDaQuery("2026-02-31", "2026-09-30"), "invalido");
  assert.equal(periodoDaQuery("2026-09-01", null), "invalido");
  assert.equal(periodoDaQuery(null, "2026-09-30"), "invalido");
  assert.equal(periodoDaQuery("2026-09-30", "2026-09-01"), "invalido");

  // Nenhum dos dois = a chamada nao pediu periodo, e a rota segue com `months`.
  assert.equal(periodoDaQuery(null, null), null);

  assert.deepEqual(periodoDaQuery("2026-09-01", "2026-09-30"), {
    de: "2026-09-01",
    ate: "2026-09-30",
    modo: "mes",
  });
});

test("ehDataIso recusa dia que nao existe", () => {
  assert.equal(ehDataIso("2026-02-31"), false);
  assert.equal(ehDataIso("2026-04-31"), false);
  assert.equal(ehDataIso("2026-00-10"), false);
  assert.equal(ehDataIso("2026-9-1"), false);
  assert.equal(ehDataIso("2028-02-29"), true);
  assert.equal(ehDataIso("2026-02-28"), true);
});

// ---------------------------------------------------------------------------
// 5. Os presets
// ---------------------------------------------------------------------------

test("os presets, calculados em 29/09/2026", () => {
  const hoje = "2026-09-29";

  assert.deepEqual(periodoDoPreset("este-mes", hoje), {
    de: "2026-09-01",
    ate: "2026-09-30",
    modo: "mes",
  });
  assert.deepEqual(periodoDoPreset("mes-passado", hoje), {
    de: "2026-08-01",
    ate: "2026-08-31",
    modo: "mes",
  });
  // Inclui o mes corrente: julho, agosto e setembro.
  assert.deepEqual(periodoDoPreset("ultimos-3-meses", hoje), {
    de: "2026-07-01",
    ate: "2026-09-30",
    modo: "mes",
  });
  assert.deepEqual(periodoDoPreset("este-ano", hoje), {
    de: "2026-01-01",
    ate: "2026-12-31",
    modo: "mes",
  });
});

test("todo preset e alinhado a mes -- nenhum cai na agregacao por data", () => {
  const hoje = "2026-09-29";
  for (const id of ["este-mes", "mes-passado", "ultimos-3-meses", "este-ano"]) {
    const p = periodoDoPreset(id, hoje);
    assert.equal(modoDoPeriodo(p.de, p.ate), "mes", `preset ${id}`);
  }
});

test("mes-passado atravessa a virada do ano", () => {
  assert.deepEqual(periodoDoPreset("mes-passado", "2026-01-15"), {
    de: "2025-12-01",
    ate: "2025-12-31",
    modo: "mes",
  });
  assert.deepEqual(periodoDoPreset("ultimos-3-meses", "2026-01-15"), {
    de: "2025-11-01",
    ate: "2026-01-31",
    modo: "mes",
  });
});

test("o seletor reconhece o preset de quem chegou por link", () => {
  const hoje = "2026-09-29";
  assert.equal(
    presetDoPeriodo({ de: "2026-07-01", ate: "2026-09-30", modo: "mes" }, hoje),
    "ultimos-3-meses"
  );
  assert.equal(
    presetDoPeriodo({ de: "2026-09-01", ate: "2026-09-30", modo: "mes" }, hoje),
    "este-mes"
  );
  // Julho sozinho nao e preset nenhum -- o seletor abre em "personalizado".
  assert.equal(
    presetDoPeriodo({ de: "2026-07-01", ate: "2026-07-31", modo: "mes" }, hoje),
    null
  );
});

test('o botao "Hoje" so aparece fora do mes corrente', () => {
  const hoje = "2026-09-29";
  assert.equal(
    ehPeriodoCorrente({ de: "2026-09-01", ate: "2026-09-30", modo: "mes" }, hoje),
    true
  );
  assert.equal(
    ehPeriodoCorrente({ de: "2026-08-01", ate: "2026-08-31", modo: "mes" }, hoje),
    false
  );
  // Contem hoje mas NAO e o mes corrente: o botao tem que aparecer, senao
  // quem escolheu "ultimos 3 meses" fica sem o caminho de volta.
  assert.equal(
    ehPeriodoCorrente({ de: "2026-07-01", ate: "2026-09-30", modo: "mes" }, hoje),
    false
  );
});

// ---------------------------------------------------------------------------
// 6. A agregacao por data, com transferencia no fixture
// ---------------------------------------------------------------------------
// O fixture representa um intervalo personalizado 15/09 a 20/10 com:
//   * receita     R$ 5.000,00
//   * despesas    R$ 320,50 + R$ 79,50 = R$ 400,00  (gravadas NEGATIVAS)
//   * uma transferencia da conta corrente para a poupanca, R$ 1.000,00,
//     em duas pernas que se anulam
//   * um pagamento de fatura de cartao, R$ 2.000,00, tambem em duas pernas
//
// A resposta certa ignora as quatro pernas de `transfer`.

const INTERVALO_COM_TRANSFERENCIA = [
  { transaction_type: "income", amount: 5000 },
  { transaction_type: "expense", amount: -320.5 },
  { transaction_type: "expense", amount: -79.5 },
  // Transferencia entre contas proprias: sai de uma, entra na outra.
  { transaction_type: "transfer", amount: -1000 },
  { transaction_type: "transfer", amount: 1000 },
  // Pagamento de fatura (HMO-149): mesmo desenho, duas pernas.
  { transaction_type: "transfer", amount: -2000 },
  { transaction_type: "transfer", amount: 2000 },
];

test("a agregacao por data bate com a soma do intervalo, sem as transferencias", () => {
  const resumo = agregarTransacoes(INTERVALO_COM_TRANSFERENCIA);

  assert.equal(resumo.total_income, 5000);
  assert.equal(resumo.total_expense, 400);
  assert.equal(resumo.net, 4600);
  // Tres lancamentos contam; as quatro pernas de transferencia, nao -- o
  // mesmo `COUNT(*) FILTER (WHERE transaction_type IN (...))` da view.
  assert.equal(resumo.transaction_count, 3);
});

test("CONTROLE: incluir transferencia infla receita E despesa e deixa o net EXATO", () => {
  // Este e o teste que justifica o fixture ter transferencia. Ele simula o
  // bug -- somar todos os tipos -- e mostra que o `net` continua 4600. Uma
  // assercao feita so sobre o saldo liquido passaria verde com os dois tiles
  // de cima errados, que e exatamente como o bug chegaria a producao.
  const comBug = INTERVALO_COM_TRANSFERENCIA.reduce(
    (acc, l) => {
      const v = Number(l.amount);
      if (v >= 0) acc.entrada += v;
      else acc.saida += Math.abs(v);
      return acc;
    },
    { entrada: 0, saida: 0 }
  );

  assert.equal(comBug.entrada, 8000); // 5.000 viram 8.000
  assert.equal(comBug.saida, 3400); // 400 viram 3.400
  assert.equal(comBug.entrada - comBug.saida, 4600); // e o net nao acusa nada
});

test("o sinal nunca decide o tipo -- quem decide e transaction_type", () => {
  // Um estorno lancado como receita NEGATIVA. Somar pelo sinal jogaria esta
  // linha na despesa; a view usa ABS e filtra por tipo, e aqui e igual.
  const resumo = agregarTransacoes([
    { transaction_type: "income", amount: -100 },
    { transaction_type: "expense", amount: 50 },
  ]);
  assert.equal(resumo.total_income, 100);
  assert.equal(resumo.total_expense, 50);
  assert.equal(resumo.net, 50);
});

test("valores em texto (o PostgREST devolve numeric como string)", () => {
  const resumo = agregarTransacoes([
    { transaction_type: "income", amount: "1234.56" },
    { transaction_type: "expense", amount: "-234.56" },
  ]);
  assert.equal(resumo.total_income, 1234.56);
  assert.equal(resumo.total_expense, 234.56);
  assert.equal(resumo.net, 1000);
});

test("intervalo sem nenhuma linha devolve zeros, nao NaN", () => {
  assert.deepEqual(agregarTransacoes([]), {
    total_income: 0,
    total_expense: 0,
    net: 0,
    transaction_count: 0,
  });
});

// ---------------------------------------------------------------------------
// 7. O resumo de contas previstas, somado em vez de procurado
// ---------------------------------------------------------------------------

/** Um mes do resumo, com as quatro pernas zeradas por padrao. */
const mesPrevisto = (month, campos = {}) => ({
  month,
  total_pending_expense: 0,
  count_pending_expense: 0,
  total_pending_income: 0,
  count_pending_income: 0,
  total_overdue_expense: 0,
  count_overdue_expense: 0,
  total_overdue_income: 0,
  count_overdue_income: 0,
  ...campos,
});

test("o resumo soma TODOS os meses do periodo", () => {
  const resumo = somarPrevistas([
    mesPrevisto("2026-07", {
      total_pending_expense: 100.1,
      count_pending_expense: 1,
    }),
    mesPrevisto("2026-08", {
      total_pending_expense: 200.2,
      count_pending_expense: 2,
      total_overdue_expense: 50,
      count_overdue_expense: 1,
    }),
    mesPrevisto("2026-09", {
      total_pending_expense: 300.3,
      count_pending_expense: 3,
    }),
  ]);

  assert.equal(resumo.total_pending_expense, 600.6);
  assert.equal(resumo.total_overdue_expense, 50);
  assert.equal(resumo.count_pending_expense, 6);
  assert.equal(resumo.count_overdue_expense, 1);
});

test("as quatro pernas somam separadas, sem vazar de uma para a outra", () => {
  // O cenario medido em producao na HMO-186, espalhado por dois meses: se
  // qualquer perna vazasse para outra, um destes quatro numeros mudaria.
  const resumo = somarPrevistas([
    mesPrevisto("2026-10", {
      total_pending_expense: 2588.5,
      count_pending_expense: 2,
      total_pending_income: 7000,
      count_pending_income: 1,
    }),
    mesPrevisto("2026-11", {
      total_overdue_expense: 120,
      count_overdue_expense: 1,
      total_overdue_income: 300,
      count_overdue_income: 1,
    }),
  ]);

  assert.equal(resumo.total_pending_expense, 2588.5);
  assert.equal(resumo.total_pending_income, 7000);
  assert.equal(resumo.total_overdue_expense, 120);
  assert.equal(resumo.total_overdue_income, 300);
  assert.equal(resumo.count_pending_expense, 2);
  assert.equal(resumo.count_pending_income, 1);

  // O defeito da HMO-187 em uma linha: o numero unico que o painel mostrava.
  // Se alguem voltar a somar as duas direcoes, este assert cai.
  assert.notEqual(resumo.total_pending_expense, 9588.5);
});

test("CONTROLE: a forma antiga pegaria UM mes -- e, na virada, o errado", () => {
  const linhas = [
    mesPrevisto("2026-09", {
      total_pending_expense: 900,
      count_pending_expense: 1,
    }),
    mesPrevisto("2026-10", {
      total_pending_expense: 1000,
      count_pending_expense: 1,
    }),
  ];

  // O que o painel fazia: procurar o mes corrente calculado em UTC.
  const mesEmUtc = comRelogioEm(VESPERA_DE_VIRADA, () =>
    new Date().toISOString().slice(0, 7)
  );
  const antigo = linhas.find((l) => l.month === mesEmUtc);

  // As 22:00 de 30/09 em Sao Paulo, o painel exibia 1000: outubro.
  assert.equal(antigo.total_pending_expense, 1000);
  assert.notEqual(antigo.total_pending_expense, 900);
});

test("o resumo de um periodo sem conta prevista e zero, nao indefinido", () => {
  // Lista VAZIA e uma afirmacao legitima: nao havia nada agendado. E diferente
  // da resposta que nao TRAZ as pernas -- ver o teste do cache abaixo.
  assert.deepEqual(somarPrevistas([]), {
    total_pending_expense: 0,
    count_pending_expense: 0,
    total_pending_income: 0,
    count_pending_income: 0,
    total_overdue_expense: 0,
    count_overdue_expense: 0,
    total_overdue_income: 0,
    count_overdue_income: 0,
  });
});

test("resposta de antes da HMO-187 devolve null, nao zeros", () => {
  // O que o cache do PWA pode servir por ate 24h depois do deploy. Com os
  // campos antigos, `Number(undefined ?? 0)` daria 0 e o painel anunciaria
  // "R$ 0,00 a vencer" -- uma afirmacao sobre o dinheiro do usuario feita em
  // cima de uma resposta que nao tem a informacao.
  const antiga = [
    {
      month: "2026-10",
      total_pending: 9588.5,
      total_overdue: 0,
      count_pending: 3,
      count_overdue: 0,
    },
  ];

  assert.equal(somarPrevistas(antiga), null);
});

test("um mes incompleto no meio da lista contamina o total inteiro", () => {
  // O mes bom sozinho somaria 100. Com o mes sem pernas ao lado, o resultado
  // tem que ser `null` e nao 100: um total parcial apresentado como total e
  // pior que nenhum total.
  const resumo = somarPrevistas([
    mesPrevisto("2026-10", {
      total_pending_expense: 100,
      count_pending_expense: 1,
    }),
    { month: "2026-11" },
  ]);

  assert.equal(resumo, null);
});

test("o resumo aceita numeric em texto", () => {
  const resumo = somarPrevistas([
    mesPrevisto("2026-09", {
      total_pending_expense: "10.50",
      total_overdue_expense: "5.25",
      count_pending_expense: "2",
      count_overdue_expense: "1",
      total_pending_income: "7.75",
    }),
  ]);
  assert.equal(resumo.total_pending_expense, 10.5);
  assert.equal(resumo.total_overdue_expense, 5.25);
  assert.equal(resumo.count_pending_expense, 2);
  assert.equal(resumo.total_pending_income, 7.75);
});

test("texto que nao e numero devolve null em vez de NaN na tela", () => {
  assert.equal(
    somarPrevistas([mesPrevisto("2026-09", { total_pending_expense: "abc" })]),
    null
  );
});

// ---------------------------------------------------------------------------
// 8. Onde esta hoje dentro do periodo
// ---------------------------------------------------------------------------

test("contemHoje e terminaNoPassado nas bordas do periodo", () => {
  const setembro = { de: "2026-09-01", ate: "2026-09-30", modo: "mes" };

  assert.equal(contemHoje(setembro, "2026-09-01"), true);
  assert.equal(contemHoje(setembro, "2026-09-30"), true);
  assert.equal(contemHoje(setembro, "2026-08-31"), false);
  assert.equal(contemHoje(setembro, "2026-10-01"), false);

  // O ultimo dia do periodo AINDA e presente: quem abre o painel em 30/09 ve
  // "quanto posso gastar", nao o aviso de periodo encerrado.
  assert.equal(terminaNoPassado(setembro, "2026-09-30"), false);
  assert.equal(terminaNoPassado(setembro, "2026-10-01"), true);
});

// ---------------------------------------------------------------------------
// 9. A agenda nunca e materializada no passado
// ---------------------------------------------------------------------------

test("periodo inteiramente passado NAO materializa nada", () => {
  assert.equal(
    janelaParaMaterializar({ de: "2026-07-01", ate: "2026-07-31" }, "2026-09-29"),
    null
  );
});

test("periodo que contem hoje materializa so de hoje para a frente", () => {
  // O pedaco de 01/09 a 28/09 ja passou: criar vencimento la seria fabricar
  // conta que nasce vencida.
  assert.deepEqual(
    janelaParaMaterializar({ de: "2026-09-01", ate: "2026-09-30" }, "2026-09-29"),
    { de: "2026-09-29", ate: "2026-09-30" }
  );
});

test("periodo no futuro materializa a janela inteira, e ela comeca no futuro", () => {
  const janela = janelaParaMaterializar(
    { de: "2026-12-01", ate: "2026-12-31" },
    "2026-09-29"
  );
  assert.deepEqual(janela, { de: "2026-12-01", ate: "2026-12-31" });
  // O aceite 5, dito como asercao: nada antes de hoje entra na janela de
  // escrita.
  assert.ok(janela.de >= "2026-09-29");
});

test("periodo que termina hoje ainda materializa o dia de hoje", () => {
  assert.deepEqual(
    janelaParaMaterializar({ de: "2026-09-01", ate: "2026-09-29" }, "2026-09-29"),
    { de: "2026-09-29", ate: "2026-09-29" }
  );
});

// ---------------------------------------------------------------------------
// 10. O tile de saldo nunca aparece rotulado com um periodo que nao e dele
// ---------------------------------------------------------------------------
// O aceite 2 da issue, como assercao: "nenhum bloco sem eixo de tempo fica
// rotulado com o mes escolhido".

test("periodo passado SEM reconstrucao: o rotulo avisa que o numero e de hoje", () => {
  const julho = { de: "2026-07-01", ate: "2026-07-31", modo: "mes" };
  const r = rotuloDoSaldo({
    periodo: julho,
    hoje: "2026-09-29",
    saldoHistorico: null,
    quantidadeDeContas: 3,
  });

  assert.equal(r.doPeriodo, false);
  // Num periodo que ja terminou nao basta dizer "hoje" de passagem: a nota tem
  // que NEGAR a associacao com o periodo. A contagem de contas ("3 contas
  // ativas, saldo de hoje") menciona hoje e ainda assim deixa quem passa o
  // olho concluindo que aquele e o saldo de julho.
  assert.equal(r.nota, "Saldo de hoje — não é do período escolhido");
  assert.match(r.nota, /não é do período/);
  // O ponto exato da issue: o numero de hoje NAO pode carregar o nome do
  // periodo escolhido.
  assert.ok(
    !r.nota.includes("julho") && !r.titulo.includes("julho"),
    `rotulo de hoje nomeou o periodo: ${r.titulo} / ${r.nota}`
  );
});

test("periodo passado COM reconstrucao: o rotulo pode nomear o periodo", () => {
  const julho = { de: "2026-07-01", ate: "2026-07-31", modo: "mes" };
  const r = rotuloDoSaldo({
    periodo: julho,
    hoje: "2026-09-29",
    saldoHistorico: 12345.67,
    quantidadeDeContas: 3,
  });

  assert.equal(r.doPeriodo, true);
  assert.match(r.nota, /julho de 2026/);
  assert.ok(!r.nota.includes("hoje"));
});

test("periodo que contem hoje: o saldo de hoje e legitimo, e ainda assim dito", () => {
  const setembro = { de: "2026-09-01", ate: "2026-09-30", modo: "mes" };
  const r = rotuloDoSaldo({
    periodo: setembro,
    hoje: "2026-09-29",
    saldoHistorico: null,
    quantidadeDeContas: 1,
  });

  assert.equal(r.nota, "1 conta ativa, saldo de hoje");
  assert.equal(r.doPeriodo, false);
});

test("nenhum rotulo de saldo de hoje nomeia o periodo, em periodo nenhum", () => {
  // Varredura: o mesmo par de regras para todos os recortes que a tela
  // consegue produzir. Um caso especifico passaria verde se alguem
  // reintroduzisse o rotulo implicito em UM dos ramos.
  const hoje = "2026-09-29";
  const periodos = [
    { de: "2026-07-01", ate: "2026-07-31", modo: "mes" },
    { de: "2026-01-01", ate: "2026-12-31", modo: "mes" },
    { de: "2025-11-01", ate: "2026-02-28", modo: "mes" },
    { de: "2026-09-15", ate: "2026-10-20", modo: "intervalo" },
    { de: "2026-08-15", ate: "2026-08-20", modo: "intervalo" },
    { de: "2026-12-01", ate: "2026-12-31", modo: "mes" },
  ];

  for (const periodo of periodos) {
    const r = rotuloDoSaldo({
      periodo,
      hoje,
      saldoHistorico: null,
      quantidadeDeContas: 2,
    });
    assert.equal(r.doPeriodo, false, JSON.stringify(periodo));
    assert.match(r.nota, /hoje/, JSON.stringify(periodo));
    assert.ok(
      !`${r.titulo} ${r.nota}`.includes(rotuloDoPeriodo(periodo)),
      `rotulo de hoje nomeou o periodo ${rotuloDoPeriodo(periodo)}`
    );
  }
});

// ---------------------------------------------------------------------------
// 11. O rotulo -- a unica coisa na tela que diz a que periodo o numero se refere
// ---------------------------------------------------------------------------

test("o rotulo nomeia o periodo, e nunca diz 'mes' sobre o que nao e um mes", () => {
  assert.equal(
    rotuloDoPeriodo({ de: "2026-09-01", ate: "2026-09-30", modo: "mes" }),
    "setembro de 2026"
  );
  assert.equal(
    rotuloDoPeriodo({ de: "2026-07-01", ate: "2026-09-30", modo: "mes" }),
    "julho a setembro de 2026"
  );
  assert.equal(
    rotuloDoPeriodo({ de: "2025-11-01", ate: "2026-02-28", modo: "mes" }),
    "novembro de 2025 a fevereiro de 2026"
  );
  assert.equal(
    rotuloDoPeriodo({ de: "2026-01-01", ate: "2026-12-31", modo: "mes" }),
    "ano de 2026"
  );
  assert.equal(
    rotuloDoPeriodo({ de: "2026-09-15", ate: "2026-10-20", modo: "intervalo" }),
    "15/09/2026 a 20/10/2026"
  );
});

test("o rotulo do intervalo nao passa por Date -- 30/09 nao vira 29/09", () => {
  // `new Date('2026-09-30')` nasce em UTC e, no fuso de Sao Paulo, imprimiria
  // 29. E a mesma armadilha que o helper `diaEMes` do painel documenta.
  assert.equal(
    rotuloDoPeriodo({ de: "2026-09-30", ate: "2026-10-01", modo: "intervalo" }),
    "30/09/2026 a 01/10/2026"
  );
});

// ---------------------------------------------------------------------------
// O INTERVALO NAO PODE SOMAR MOEDAS DIFERENTES (HMO-171 x HMO-173)
// ---------------------------------------------------------------------------
// Este bloco existe por causa do cruzamento de duas issues que passaram no CI
// separadas e produziam um defeito juntas.
//
// A HMO-171 tirou a mistura de moedas dos relatorios: a migration 022 poe a
// moeda no GRAO das views do 008, e a rota separa a serie mensal por moeda. A
// HMO-173 abriu um SEGUNDO caminho na mesma rota -- o periodo que nao cai em
// meses inteiros nao sai de view nenhuma, e a soma passa a ser feita em
// JavaScript sobre as linhas cruas.
//
// Esse segundo caminho nasceu sem moeda. Para 15/09 a 20/10 com gasto em real e
// em dolar ele devolvia 1000 + 180 = 1180: um numero que nao esta em moeda
// nenhuma, com cara de total e para MAIS. Sem erro, sem aviso, e com a 022 ja
// aplicada em producao.
//
// Nenhuma das duas suites pegava sozinha, e e por isso que a asercao mora aqui:
// a da moeda so exercita a serie das views, e esta so exercitava a aritmetica
// sem moeda.

test("intervalo com duas moedas devolve dois blocos, e nenhum soma o outro", () => {
  const blocos = agregarTransacoesPorMoeda(
    [
      { amount: -1000, transaction_type: "expense", currency: "BRL" },
      { amount: -180, transaction_type: "expense", currency: "USD" },
      { amount: 5000, transaction_type: "income", currency: "BRL" },
    ],
    "BRL"
  );

  assert.equal(blocos.length, 2, "as duas moedas tem que virar dois blocos");

  const brl = blocos.find((b) => b.currency === "BRL");
  const usd = blocos.find((b) => b.currency === "USD");

  assert.equal(brl.summary.total_expense, 1000);
  assert.equal(brl.summary.total_income, 5000);
  assert.equal(usd.summary.total_expense, 180);

  // A NEGACAO explicita, que e o que separa este teste de um que passaria com o
  // defeito de pe: 1180 e o numero errado, e ele nao pode aparecer em bloco
  // nenhum.
  for (const bloco of blocos) {
    assert.notEqual(
      bloco.summary.total_expense,
      1180,
      "o intervalo somou reais com dolares -- o defeito que a 022 existe para impedir"
    );
  }
});

test("a moeda oficial vem primeiro, mesmo movimentando menos", () => {
  // A ordem tem que ser a MESMA do caminho mensal, senao o painel e o relatorio
  // elegem blocos principais diferentes para o mesmo dinheiro.
  const blocos = agregarTransacoesPorMoeda(
    [
      { amount: -9000, transaction_type: "expense", currency: "USD" },
      { amount: -10, transaction_type: "expense", currency: "BRL" },
    ],
    "BRL"
  );
  assert.equal(blocos[0].currency, "BRL");
});

test("sem movimento na oficial, o bloco principal e o mais movimentado", () => {
  // Um mes inteiro no exterior so tem dolar. Fixar reais aqui devolveria uma
  // serie de zeros para quem gastou -- dinheiro sumindo da tela.
  const blocos = agregarTransacoesPorMoeda(
    [{ amount: -9000, transaction_type: "expense", currency: "USD" }],
    "BRL"
  );
  assert.equal(blocos[0].currency, "USD");
});

test("lancamento sem moeda cai na OFICIAL, e nao em BRL fixo", () => {
  // Quem tem dolar como moeda principal e um lancamento antigo sem a coluna
  // veria esse lancamento virar um bloco "BRL" de mentira, separado do resto do
  // proprio dinheiro.
  const blocos = agregarTransacoesPorMoeda(
    [
      { amount: -50, transaction_type: "expense", currency: null },
      { amount: -70, transaction_type: "expense", currency: "USD" },
    ],
    "USD"
  );
  assert.equal(blocos.length, 1, "os dois lancamentos sao da mesma moeda");
  assert.equal(blocos[0].currency, "USD");
  assert.equal(blocos[0].summary.total_expense, 120);
});

test("transferencia continua fora da conta, em qualquer moeda", () => {
  // As duas pernas de uma transferencia se anulam no saldo e inflariam receita
  // E despesa. O filtro ja existia em `agregarTransacoes`; agrupar por moeda
  // nao pode ter aberto um buraco nele.
  const blocos = agregarTransacoesPorMoeda(
    [
      { amount: -300, transaction_type: "transfer", currency: "USD" },
      { amount: 300, transaction_type: "transfer", currency: "USD" },
      { amount: -40, transaction_type: "expense", currency: "USD" },
    ],
    "USD"
  );
  assert.equal(blocos.length, 1);
  assert.equal(blocos[0].summary.total_expense, 40);
  assert.equal(blocos[0].summary.total_income, 0);
  assert.equal(blocos[0].summary.transaction_count, 1);
});

test("periodo sem movimento nenhum nao produz bloco", () => {
  assert.deepEqual(agregarTransacoesPorMoeda([], "BRL"), []);
});
