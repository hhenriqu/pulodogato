#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DO PERIODO DO PAINEL (HMO-173)
// =====================================================
//   npm run test:periodo-painel
//
// Exercita lib/periodo-do-painel.ts. Cinco familias de erro, todas do mesmo
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
//   5. O PAR PERSONALIZADO QUE APAGA A PROPRIA DIGITACAO (HMO-240). Tres
//      regras certas que, juntas, deixam o campo impossivel de digitar sem
//      erro nenhum na tela. A familia inteira esta explicada no bloco do fim
//      deste arquivo, que e onde os testes dela moram.
//
// Mesmo desenho do test-reports.mjs: .mjs rodando o JS que o tsc ja compila,
// sem runner de teste novo no package.json.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  agregarTransacoes,
  agregarTransacoesPorMoeda,
  camposAbertos,
  chaveDoPeriodo,
  contemHoje,
  ehDataIso,
  ehPeriodoCorrente,
  escolhaDoSeletor,
  extremoDigitado,
  janelaParaMaterializar,
  lerPeriodo,
  mesesDoPeriodo,
  modoDoPeriodo,
  parDoSeletor,
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
  valorDoSeletor,
  VALOR_PERSONALIZADO,
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

// =====================================================
// O PAR PERSONALIZADO ENQUANTO ESTA SENDO DIGITADO (HMO-240)
// =====================================================
// A HMO-240 trocou os dois `<input type="date">` do seletor pelo campo
// mascarado da HMO-238, e esse par e o unico dos oito campos migrados que NAO
// alimenta formulario: ele alimenta o filtro do painel.
//
// Isso cria uma interacao que nenhuma das outras cinco telas tem, e que fica
// VERDE em qualquer teste de funcao isolada:
//
//   * o campo emite vazio enquanto a data esta pela metade (contrato da 238);
//   * o filtro ignora o vazio, porque `lerPeriodo` devolveria o mes corrente e
//     a tela pularia de mes no meio da digitacao;
//   * e o rascunho do campo so vale enquanto o valor do pai for o que aquele
//     texto emitiu.
//
// As tres regras estao certas e juntas se cancelam: o pai nunca aceita o vazio,
// entao o rascunho nunca vale, e a exibicao volta para a data antiga A CADA
// TECLA -- campo impossivel de digitar, sem erro em lugar nenhum. O teste que
// pega isso tem que rodar a SEQUENCIA de teclas pelas funcoes de verdade (a
// mascara e o rascunho do par), e nao cada uma no seu canto.
//
// O controle positivo esta no ultimo teste: ele AFIRMA que a forma sem rascunho
// de par apaga a digitacao. Sem ele, os testes acima passariam verde tambem no
// mundo em que o bug nunca existiu, e nao seria possivel saber se eles medem
// algo.
// =====================================================

const { aplicarMascaraNoCampo, exibicaoDoCampo } = await import(
  "../.tmp-periodo-painel/data-digitada.js"
);

const HOJE = "2026-10-02";

/**
 * O seletor inteiro, simulado: os dois rascunhos de CAMPO (um por extremo), o
 * rascunho do PAR, o modo personalizado e o periodo do pai, ligados exatamente
 * como SeletorDePeriodo.tsx os liga.
 *
 * `digitar` nao seleciona o texto antes da primeira tecla, de proposito: a
 * regra "digitar sobre uma data completa comeca uma data nova" e da mascara, e
 * medir pelo caminho que NAO depende da selecao e o que mantem o teste valido
 * no aparelho em que a selecao nao sobrevive ao toque.
 *
 * O QUE ESTE SIMULADO PODE E NAO PODE PROVAR (HMO-243)
 * ----------------------------------------------------
 * As tres linhas de `aplicar` abaixo sao as mesmas tres do componente, e isso e
 * copia: `react-dom/server` nao chama handler, entao nao ha como alcancar o
 * `onValueChange` de verdade sem navegador. O que torna a copia honesta e que
 * nenhuma DECISAO vive nela -- `escolhaDoSeletor` e `camposAbertos` respondem
 * tudo, e os mutantes de scripts/mutantes-periodo-painel.mjs estragam o lib, nao
 * este arquivo. Se a decisao estivesse aqui, o teste mediria a si mesmo.
 *
 * A medicao em producao e o que cobre a fiacao: ver o comentario de fechamento
 * da HMO-243.
 */
function seletorSimulado(periodoInicial) {
  let periodo = periodoInicial;
  let rascunhoDoPar = null;
  let personalizado = false;
  const rascunhoDoCampo = { de: null, ate: null };
  /** Cada `aoMudar` que subiu ao painel, na ordem. */
  const filtrou = [];

  const mostrado = (qual) =>
    exibicaoDoCampo(
      rascunhoDoCampo[qual],
      parDoSeletor(rascunhoDoPar, periodo)[qual]
    );

  /** O `aplicar` do componente: a unica porta para o periodo e para o modo. */
  function aplicar(gesto) {
    const escolha = escolhaDoSeletor(gesto, { periodo, personalizado }, HOJE);
    personalizado = escolha.personalizado;
    if (escolha.periodo) {
      periodo = escolha.periodo;
      filtrou.push(periodo);
    }
  }

  function digitar(qual, teclas) {
    for (const tecla of teclas) {
      // O valor que o PAI entrega ao campo nesta volta de render.
      const valorDoPai = parDoSeletor(rascunhoDoPar, periodo)[qual];
      const anterior = exibicaoDoCampo(rascunhoDoCampo[qual], valorDoPai);

      // O `<input>` depois da tecla: a mascara deixou o caret no fim, entao a
      // tecla nova entra no fim do texto.
      const campo = {
        value: anterior + tecla,
        setSelectionRange() {},
      };
      const entrada = aplicarMascaraNoCampo(campo, anterior);
      rascunhoDoCampo[qual] = { texto: entrada.exibicao, valor: entrada.valor };

      // `CampoDeData` so avisa o pai quando o valor muda de fato.
      if (entrada.valor === valorDoPai) continue;

      const passo = extremoDigitado(rascunhoDoPar, periodo, qual, entrada.valor);
      rascunhoDoPar = passo.rascunho;
      if (passo.par) {
        aplicar({
          tipo: "par",
          periodo: lerPeriodo(passo.par.de, passo.par.ate, HOJE),
        });
      }
    }
  }

  /** Um periodo que chega de fora sem gesto nenhum: link, voltar do navegador. */
  function porFora(novo) {
    periodo = novo;
  }

  const presetAtual = () => presetDoPeriodo(periodo, HOJE);

  /**
   * Escolher um item do menu.
   *
   * O `return` quando o valor ja e o selecionado nao e regra nossa: o Radix nao
   * chama `onValueChange` para o item que ja esta marcado. Sem isto o simulado
   * seria mais permissivo que a tela, e um teste passaria por um caminho que o
   * usuario nao tem.
   */
  function escolher(valor) {
    if (valor === valorDoSeletor(presetAtual(), personalizado)) return;
    aplicar({ tipo: "item", valor });
  }

  return {
    digitar,
    porFora,
    mostrado,
    filtrou,
    escolher,
    seta: (meses) => aplicar({ tipo: "passo", meses }),
    botaoHoje: () => aplicar({ tipo: "hoje" }),
    get periodo() {
      return periodo;
    },
    /** Quantos campos de data a tela tem -- a coluna da tabela do aceite. */
    get campos() {
      return camposAbertos(presetAtual(), personalizado) ? 2 : 0;
    },
    /** O item que o menu mostra fechado. */
    get valorDoMenu() {
      return valorDoSeletor(presetAtual(), personalizado);
    },
    /** O rotulo entre as setas: o aceite exige que ele NAO mude. */
    get rotulo() {
      return rotuloDoPeriodo(periodo);
    },
  };
}

const SETEMBRO = { de: "2026-09-01", ate: "2026-09-30", modo: "mes" };

test("digitar a data inicial inteira nao apaga nenhuma tecla", () => {
  const seletor = seletorSimulado(SETEMBRO);

  // Tecla por tecla, e com a exibicao conferida em CADA uma: o defeito que isto
  // guarda nao e "a data final saiu errada", e "a tecla desaparece e a data
  // antiga volta". Uma asercao so no fim passaria verde com o campo piscando.
  const esperado = [
    "1",
    "10",
    "10/0",
    "10/03",
    "10/03/2",
    "10/03/20",
    "10/03/202",
    "10/03/2026",
  ];
  const teclas = "10032026";

  for (let i = 0; i < teclas.length; i++) {
    seletor.digitar("de", teclas[i]);
    assert.equal(
      seletor.mostrado("de"),
      esperado[i],
      `tecla ${i + 1} (${teclas[i]}): a exibicao voltou para a data antiga`
    );
  }

  // 10 de MARCO, e nao 3 de outubro. Era este o erro do controle nativo: a
  // ordem dos segmentos saia do aparelho, e num filtro ela nao da erro -- da um
  // painel com os numeros de outro periodo.
  assert.deepEqual(seletor.periodo, {
    de: "2026-03-10",
    ate: "2026-09-30",
    modo: "intervalo",
  });
});

test("o filtro sobe UMA vez, na oitava tecla, e nunca com data pela metade", () => {
  const seletor = seletorSimulado(SETEMBRO);

  seletor.digitar("de", "1003202");
  assert.deepEqual(
    seletor.filtrou,
    [],
    "o painel foi refiltrado no meio da digitacao"
  );
  // E o periodo do pai nao se mexeu: uma unica chamada com `de` vazio teria
  // caido no mes corrente (outubro) por `lerPeriodo`.
  assert.deepEqual(seletor.periodo, SETEMBRO);

  seletor.digitar("de", "6");
  assert.equal(seletor.filtrou.length, 1);
  assert.equal(seletor.filtrou[0].de, "2026-03-10");
});

test("o par invertido fica na tela sem subir ao filtro", () => {
  const seletor = seletorSimulado(SETEMBRO);

  // `ate` em 10/03/2026, antes do `de` que e 01/09/2026. E o caso normal de
  // quem vai mudar os dois extremos e comeca pelo segundo.
  seletor.digitar("ate", "10032026");

  assert.equal(seletor.mostrado("ate"), "10/03/2026");
  assert.deepEqual(seletor.filtrou, []);
  assert.deepEqual(seletor.periodo, SETEMBRO);

  // Arrumar o outro lado fecha o par e ai sim o painel refiltra.
  seletor.digitar("de", "01012026");
  assert.equal(seletor.filtrou.length, 1);
  assert.deepEqual(seletor.filtrou[0], {
    de: "2026-01-01",
    ate: "2026-03-10",
    modo: "intervalo",
  });
});

test("periodo mudado por fora no meio da digitacao apaga o rascunho", () => {
  const seletor = seletorSimulado(SETEMBRO);

  seletor.digitar("de", "1003");
  assert.equal(seletor.mostrado("de"), "10/03");

  // A seta de mes. Sem a subordinacao do rascunho ao periodo, os campos
  // continuariam mostrando "10/03" e "30/09" com agosto por baixo -- o campo
  // mostrando texto antigo com valor novo por baixo, que e o bug que
  // `exibicaoDoCampo` existe para impedir e que o par tem de herdar.
  seletor.porFora(passoDeMes(SETEMBRO, -1));

  assert.equal(seletor.mostrado("de"), "01/08/2026");
  assert.equal(seletor.mostrado("ate"), "31/08/2026");
});

test("CONTROLE: sem o rascunho do par, a primeira tecla e apagada", () => {
  // A forma ANTERIOR a esta issue, com o campo mascarado no lugar do nativo: o
  // `value` do campo sai direto de `periodo`, e o periodo ignora o vazio.
  //
  // Este teste afirma que aquela forma PERDE a digitacao. Sem ele, os quatro
  // testes acima passariam verde num mundo onde o rascunho do par nao fosse
  // necessario, e nao haveria como saber que eles medem alguma coisa.
  let rascunhoDoCampo = null;
  const valorDoPai = SETEMBRO.de; // o pai nunca aceita o vazio e nao se move

  const anterior = exibicaoDoCampo(rascunhoDoCampo, valorDoPai);
  assert.equal(anterior, "01/09/2026");

  const campo = { value: anterior + "1", setSelectionRange() {} };
  const entrada = aplicarMascaraNoCampo(campo, anterior);
  rascunhoDoCampo = { texto: entrada.exibicao, valor: entrada.valor };

  // A mascara fez a parte dela: "1" e data nova, e data incompleta emite vazio.
  assert.equal(entrada.exibicao, "1");
  assert.equal(entrada.valor, "");

  // E a exibicao da volta seguinte joga fora o "1", porque o pai continua em
  // 2026-09-01. Com o rascunho do par o valor do pai teria virado "".
  assert.equal(
    exibicaoDoCampo(rascunhoDoCampo, valorDoPai),
    "01/09/2026",
    "o controle nao reproduz mais o defeito -- o rascunho do par pode ter " +
      "virado desnecessario, ou `exibicaoDoCampo` mudou de contrato"
  );
  assert.equal(exibicaoDoCampo(rascunhoDoCampo, ""), "1");
});

test("chaveDoPeriodo distingue os extremos e ignora o modo derivado", () => {
  assert.equal(chaveDoPeriodo(SETEMBRO), "2026-09-01|2026-09-30");
  // `modo` sai de `de` e `ate` (ver `modoDoPeriodo`): incluir campo derivado na
  // chave nao distinguiria nada a mais, e faria o rascunho morrer sozinho se
  // algum dia a classificacao mudasse de regra.
  assert.equal(
    chaveDoPeriodo({ ...SETEMBRO, modo: "intervalo" }),
    chaveDoPeriodo(SETEMBRO)
  );
});

test("parDoSeletor devolve o periodo quando nao ha rascunho ou ele venceu", () => {
  assert.deepEqual(parDoSeletor(null, SETEMBRO), {
    de: "2026-09-01",
    ate: "2026-09-30",
  });

  const vencido = { de: "", ate: "2026-09-30", base: "2026-08-01|2026-08-31" };
  assert.deepEqual(parDoSeletor(vencido, SETEMBRO), {
    de: "2026-09-01",
    ate: "2026-09-30",
  });

  const vale = { de: "", ate: "2026-09-30", base: chaveDoPeriodo(SETEMBRO) };
  assert.deepEqual(parDoSeletor(vale, SETEMBRO), {
    de: "",
    ate: "2026-09-30",
  });
});

// =====================================================
// O ITEM "PERSONALIZADO" ABRE OS CAMPOS (HMO-243)
// =====================================================
// O item era DECORATIVO: escolher "Personalizado" nao fazia nada -- nenhum
// campo aparecia e o rotulo nao mudava. O par de datas so era alcancavel
// andando DOIS meses para tras com a seta (um mes cai em "Mes passado", que
// tambem esconde os campos).
//
// A medicao em producao que achou isso, com o controle positivo que a faz valer:
//
//   painel aberto (rotulo "Este mes") ............. 0 campos
//   depois de escolher "Personalizado" ............ 0 campos  <- o defeito
//   controle: "Mes anterior" x1 ................... 0 campos
//   controle: "Mes anterior" x2 ................... 1 campo   <- existem!
//
// Os testes abaixo repetem essa tabela com a coluna de campos saindo de
// `camposAbertos`, mais as duas coisas que a tabela nao mede: que o periodo NAO
// se mexe (senao os numeros da tela mudam quando a pessoa so abriu o menu) e que
// o rotulo continua o mesmo.
//
// O ultimo teste da secao e o CONTROLE: ele reescreve a regra antiga e afirma
// que ela deixa o item decorativo. Sem ele, os testes acima passariam identicos
// num mundo onde o defeito nunca existiu.
// =====================================================

/** O mes corrente para `HOJE` = 02/10/2026: o preset `este-mes`. */
const OUTUBRO = { de: "2026-10-01", ate: "2026-10-31", modo: "mes" };

test("o painel abre no mes corrente, sem campos de data", () => {
  const seletor = seletorSimulado(OUTUBRO);

  // A primeira linha da tabela do aceite.
  assert.equal(seletor.campos, 0);
  assert.equal(seletor.valorDoMenu, "este-mes");
  assert.equal(seletor.rotulo, "outubro de 2026");
});

test('escolher "Personalizado" abre os campos SEM mudar o periodo', () => {
  const seletor = seletorSimulado(OUTUBRO);

  seletor.escolher(VALOR_PERSONALIZADO);

  // A linha do defeito, agora com o numero certo.
  assert.equal(seletor.campos, 2);
  assert.equal(seletor.valorDoMenu, VALOR_PERSONALIZADO);

  // E as duas assercoes que a contagem de campos nao cobre: nenhum filtro subiu
  // ao painel e o rotulo nao mudou. Abrir o menu nao pode mexer nos numeros.
  assert.deepEqual(seletor.filtrou, []);
  assert.deepEqual(seletor.periodo, OUTUBRO);
  assert.equal(seletor.rotulo, "outubro de 2026");

  // Os campos nascem preenchidos com o periodo atual, que e o que o comentario
  // do componente sempre prometeu -- e agora cumpre.
  assert.equal(seletor.mostrado("de"), "01/10/2026");
  assert.equal(seletor.mostrado("ate"), "31/10/2026");
});

test("digitar o par depois de abrir a mao sobe o filtro", () => {
  const seletor = seletorSimulado(OUTUBRO);
  seletor.escolher(VALOR_PERSONALIZADO);

  seletor.digitar("de", "15102026");
  // `de` 15/10 e depois do `ate` 31/10? nao -- o par fecha na hora.
  assert.equal(seletor.filtrou.length, 1);
  assert.deepEqual(seletor.filtrou[0], {
    de: "2026-10-15",
    ate: "2026-10-31",
    modo: "intervalo",
  });
  assert.equal(seletor.rotulo, "15/10/2026 a 31/10/2026");
  assert.equal(seletor.campos, 2);
});

test('escolher um preset depois de "Personalizado" fecha os campos', () => {
  const seletor = seletorSimulado(OUTUBRO);
  seletor.escolher(VALOR_PERSONALIZADO);
  assert.equal(seletor.campos, 2);

  seletor.escolher("mes-passado");

  assert.equal(seletor.campos, 0);
  assert.equal(seletor.valorDoMenu, "mes-passado");
  assert.deepEqual(seletor.filtrou, [
    { de: "2026-09-01", ate: "2026-09-30", modo: "mes" },
  ]);
  assert.equal(seletor.rotulo, "setembro de 2026");
});

test("a seta de mes LIMPA o modo a mao", () => {
  // A decisao do item 5 da issue, fixada aqui: a pessoa saiu do modo clicando
  // noutro controle, e o periodo de destino casa com preset. Deixar os campos
  // abertos ali os deixaria mostrando um par que ela nao digitou.
  const seletor = seletorSimulado(OUTUBRO);
  seletor.escolher(VALOR_PERSONALIZADO);

  seletor.seta(-1);

  assert.equal(seletor.campos, 0);
  assert.equal(seletor.valorDoMenu, "mes-passado");
  assert.deepEqual(seletor.periodo, {
    de: "2026-09-01",
    ate: "2026-09-30",
    modo: "mes",
  });
});

test('CONTROLE POSITIVO: "Mes anterior" x2 abre os campos, como em producao', () => {
  // A quarta linha da tabela: os campos EXISTEM e sao alcancaveis pela porta
  // errada. Se este teste ficasse vermelho, o verde dos outros poderia ser
  // apenas "nao ha campo nenhum em lugar nenhum".
  const seletor = seletorSimulado(OUTUBRO);

  seletor.seta(-1);
  assert.equal(seletor.campos, 0, 'um mes para tras cai em "Mes passado"');

  seletor.seta(-1);
  assert.equal(seletor.campos, 2, "agosto nao tem preset: os campos aparecem");
  assert.equal(seletor.valorDoMenu, VALOR_PERSONALIZADO);
});

test('o botao "Hoje" LIMPA o modo a mao', () => {
  const seletor = seletorSimulado(OUTUBRO);
  seletor.seta(-1);
  seletor.seta(-1);
  assert.equal(seletor.campos, 2);

  seletor.botaoHoje();

  assert.equal(seletor.campos, 0);
  assert.equal(seletor.valorDoMenu, "este-mes");
  assert.deepEqual(seletor.periodo, OUTUBRO);
});

test("um par digitado que casa com preset NAO fecha os campos na mao da pessoa", () => {
  // O caso que o ramo `par` de `escolhaDoSeletor` existe para cobrir. Quem esta
  // em agosto, abre o par e digita 01/10 a 31/10 acaba num periodo que casa com
  // `este-mes` -- e sem o modo a mao ligado os dois campos desapareceriam no
  // instante em que a ultima tecla da segunda data entrou.
  const seletor = seletorSimulado({
    de: "2026-08-01",
    ate: "2026-08-31",
    modo: "mes",
  });
  assert.equal(seletor.campos, 2);

  seletor.digitar("de", "01102026");
  // `de` 01/10 depois do `ate` 31/08: par invertido, nada sobe (HMO-240).
  assert.deepEqual(seletor.filtrou, []);
  assert.equal(seletor.campos, 2);

  seletor.digitar("ate", "31102026");

  assert.deepEqual(seletor.filtrou, [OUTUBRO]);
  assert.equal(presetDoPeriodo(seletor.periodo, HOJE), "este-mes");
  assert.equal(
    seletor.campos,
    2,
    "o par digitado casa com `este-mes`, e os campos tem de continuar na tela"
  );
  assert.equal(seletor.valorDoMenu, VALOR_PERSONALIZADO);
});

test("CONTROLE: a regra antiga deixa o item decorativo", () => {
  // A forma ANTERIOR a esta issue, escrita de volta: "personalizado" nao era
  // estado, o handler do item tinha um `return` seco e os campos sairiam so de
  // `preset === null`.
  //
  // Este teste AFIRMA que aquela forma nao abre campo nenhum. E ele que impede
  // os sete testes acima de serem verdes vazios.
  let periodo = OUTUBRO;
  const camposAntigos = () => (presetDoPeriodo(periodo, HOJE) === null ? 2 : 0);

  const escolherAntigo = (valor) => {
    if (valor === VALOR_PERSONALIZADO) return; // <- o `return` de 45eb575
    periodo = periodoDoPreset(valor, HOJE);
  };

  assert.equal(camposAntigos(), 0);
  escolherAntigo(VALOR_PERSONALIZADO);
  assert.equal(
    camposAntigos(),
    0,
    "o controle nao reproduz mais o defeito -- `presetDoPeriodo` ou a regra " +
      "dos campos mudou de contrato, e os testes acima podem estar vacuos"
  );
  assert.deepEqual(periodo, OUTUBRO);

  // E o mesmo gesto, pela regra NOVA, abre.
  const escolha = escolhaDoSeletor(
    { tipo: "item", valor: VALOR_PERSONALIZADO },
    { periodo: OUTUBRO, personalizado: false },
    HOJE
  );
  assert.equal(escolha.periodo, null);
  assert.equal(camposAbertos(presetDoPeriodo(OUTUBRO, HOJE), true), true);
});

// ---------------------------------------------------------------------------
// As tres funcoes puras, uma a uma
// ---------------------------------------------------------------------------

test("camposAbertos: as duas razoes sao independentes", () => {
  assert.equal(camposAbertos("este-mes", false), false);
  assert.equal(camposAbertos("este-mes", true), true, "o defeito da HMO-243");
  assert.equal(camposAbertos(null, false), true, "chegou por link, sem preset");
  assert.equal(camposAbertos(null, true), true);
});

test("valorDoSeletor: o modo a mao vence o preset", () => {
  assert.equal(valorDoSeletor("este-mes", false), "este-mes");
  assert.equal(valorDoSeletor("este-mes", true), VALOR_PERSONALIZADO);
  assert.equal(valorDoSeletor(null, false), VALOR_PERSONALIZADO);
  assert.equal(valorDoSeletor(null, true), VALOR_PERSONALIZADO);
});

test("escolhaDoSeletor: cada gesto, com e sem periodo novo", () => {
  const estado = { periodo: OUTUBRO, personalizado: false };

  // O item "personalizado": liga o modo e NAO devolve periodo.
  assert.deepEqual(
    escolhaDoSeletor({ tipo: "item", valor: VALOR_PERSONALIZADO }, estado, HOJE),
    { personalizado: true, periodo: null }
  );

  // Um preset: desliga o modo e devolve o periodo do atalho.
  assert.deepEqual(
    escolhaDoSeletor({ tipo: "item", valor: "este-ano" }, estado, HOJE),
    {
      personalizado: false,
      periodo: { de: "2026-01-01", ate: "2026-12-31", modo: "mes" },
    }
  );

  // A seta: desliga o modo.
  assert.deepEqual(
    escolhaDoSeletor({ tipo: "passo", meses: 1 }, { ...estado, personalizado: true }, HOJE),
    {
      personalizado: false,
      periodo: { de: "2026-11-01", ate: "2026-11-30", modo: "mes" },
    }
  );

  // "Hoje": desliga o modo e volta ao mes corrente.
  assert.deepEqual(
    escolhaDoSeletor({ tipo: "hoje" }, { ...estado, personalizado: true }, HOJE),
    { personalizado: false, periodo: OUTUBRO }
  );

  // O par digitado: LIGA o modo, e o periodo vem pronto de `extremoDigitado`.
  const intervalo = { de: "2026-07-15", ate: "2026-08-20", modo: "intervalo" };
  assert.deepEqual(
    escolhaDoSeletor({ tipo: "par", periodo: intervalo }, estado, HOJE),
    { personalizado: true, periodo: intervalo }
  );
});

test("escolhaDoSeletor: valor desconhecido nao refiltra a tela", () => {
  // Nenhum caminho de tela produz um, mas cair em `periodoDoPreset` com lixo
  // devolveria o mes corrente -- o seletor trocando o periodo por causa de um
  // valor que ninguem reconheceu.
  for (const personalizado of [false, true]) {
    assert.deepEqual(
      escolhaDoSeletor(
        { tipo: "item", valor: "ultimos-7-dias" },
        { periodo: OUTUBRO, personalizado },
        HOJE
      ),
      { personalizado, periodo: null },
      "valor desconhecido tem de deixar periodo e modo exatamente como estavam"
    );
  }
});

test("extremoDigitado recusa data que nao existe no calendario", () => {
  // 31/02 passa pelo formato e nao existe. Quem o recusa primeiro e a mascara
  // (emite vazio), mas `extremoDigitado` tem de recusar tambem: ele e chamado
  // tambem pelo botao de calendario, e um dia por uma tela nova.
  const passo = extremoDigitado(null, SETEMBRO, "de", "2026-02-31");
  assert.equal(passo.par, null);
  assert.equal(passo.rascunho.de, "2026-02-31");
});
