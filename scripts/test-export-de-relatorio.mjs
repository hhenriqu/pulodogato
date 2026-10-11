#!/usr/bin/env node
// =====================================================
// PULODOGATO - o export de relatorio confere o `error` das oito leituras (HMO-378)
// =====================================================
//   npm run test:export-de-relatorio
//
// O DEFEITO MEDIDO, EM NUMEROS
// ----------------------------
// Antes desta suite, `app/api/reports/export/route.ts` tinha DOZE chamadas
// `.from(...)`. Duas desestruturavam `error` -- e so para `console.error`, que
// a HMO-207 colocou de proposito ao decidir nao consertar. ZERO das doze
// mudavam a resposta. Uma leitura que falhava virava `data: null`, o `?? []`
// seguinte fazia dela uma secao vazia, e a rota respondia **200 com um CSV sem
// linhas**, com os cabecalhos de download corretos e o nome de arquivo certo.
//
// O 200 e a parte caro: quem exportou o ano inteiro abre a planilha, ve as
// colunas e nenhuma linha, e conclui que nao houve movimento -- nao que a
// leitura falhou. E a familia
// `export-de-relatorio-nunca-confere-error-nos-cinco` + `CSV vazio com 200`.
//
// AS DOZE CONSULTAS SE AGRUPAM EM OITO PONTOS DE GUARDA
// -----------------------------------------------------
// A queda da 033 (`viewDaParteAusente`) reatribui `data`/`error` na MESMA
// variavel em dois ramos, entao tres consultas do ramo de `cash-flow` e tres do
// de `categories` dividem uma guarda cada. Dai 8 guardas para 12 consultas:
//
//   1. o fluxo de caixa mensal       -- `monthly_cash_flow` (grupo),
//                                       `personal_monthly_cash_flow` (033),
//                                       `monthly_cash_flow` (queda)
//   2. os gastos por categoria       -- `category_monthly_totals` (grupo),
//                                       `personal_category_monthly_totals`,
//                                       `category_monthly_totals` (queda)
//   3. os nomes das categorias       -- `transaction_categories` (ramo categories)
//   4. o previsto x realizado        -- `planned_vs_actual`
//   5. o historico de patrimonio     -- `net_worth_history`
//   6. o extrato de lancamentos      -- `financial_transactions`
//   7. os nomes das categorias do extrato -- `transaction_categories` (ramo transactions)
//   8. os nomes das contas do extrato     -- `financial_accounts`
//
// Esta suite tem um caso de erro por **CONSULTA** (doze), e nao por guarda: as
// tres consultas da guarda 1 chegam a ela por caminhos diferentes (o `groupId`,
// a view pessoal, a queda), e um conserto que guardasse so o caminho pessoal
// passaria verde num teste por guarda.
//
// POR QUE A ROTA, E NAO SO `linhasOuFalha`
// ----------------------------------------
// `linhasOuFalha` e pura e um teste de unidade sobre ela tem quatro linhas --
// que passaria verde com a rota continuando a fazer `data ?? []` nos oito
// lugares. A promessa e sobre o STATUS que a rota devolve, e isso vive na
// fiacao. Guard textual tambem nao serve: o arquivo CITA `linhasOuFalha` e
// `?? []` nos comentarios que explicam a decisao
// (`assercao-de-fiacao-casa-com-o-import`).
//
// OS CONTROLES POSITIVOS, E POR QUE SAO TRES
// ------------------------------------------
// Sem eles o conserto passa verde devolvendo 500 SEMPRE, e os doze casos de
// erro nao notariam:
//
//   A. com as consultas todas boas, cada um dos cinco relatorios sai 200 e com
//      as LINHAS CERTAS -- os numeros estao escritos aqui como literais;
//   B. a janela entre o deploy e a colagem da 033: `personal_monthly_cash_flow`
//      respondendo `42P01` tem de CAIR para `monthly_cash_flow` e sair 200.
//      Guardar ANTES da queda e o erro que este controle existe para pegar, e
//      ele nao tem sintoma nenhum fora daquela janela. As duas fontes tem
//      numeros DIFERENTES no fixture de proposito -- com numeros iguais o
//      controle nao mediria QUAL das duas foi lida
//      (`mutante-de-ramo-de-passagem-exige-fixture-do-outro-ramo`);
//   C. o ramo que NAO consulta: um extrato cujas linhas nao tem categoria nem
//      conta nao chega a chamar `transaction_categories` nem
//      `financial_accounts`, e entra na guarda com `{ data: [] }` sem `error`.
//      Sem este controle, a guarda escrita como `if (!resposta.error)` -- em vez
//      de `if (resposta.error)` -- reprovaria todo extrato sem categoria.
// =====================================================

import test, { after, before, mock } from "node:test";
import assert from "node:assert/strict";

import { criarDuble } from "./duble-de-supabase.mjs";

// =====================================================
// O RELOGIO E CONGELADO -- `relogio-congelado-em-teste-node`
// =====================================================
// `janelaDeMeses` chama `mesCorrente()`, que chama `today()` (lib/recurrence.ts),
// que le `new Date()` no fuso de Sao Paulo. Dele sai a janela `[inicio, fim]`
// que os cinco ramos usam no `gte`/`lte` -- e os meses do fixture tem de cair
// dentro dela. Com o relogio de verdade esta suite seria verde no mes em que
// foi escrita e vermelha em todos os outros, sem ninguem ter mudado codigo.
//
// `apis: ["Date"]` e nao os timers todos: congelar `setTimeout` faria qualquer
// `await` interno da rota nunca resolver.
before(() => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-03-05T15:00:00Z") });
});

after(() => {
  mock.timers.reset();
});

const RAIZ = "../.tmp-export-de-relatorio";

const EXPORT = await import(`${RAIZ}/app/api/reports/export/route.js`);

const EU = "11111111-1111-1111-1111-111111111111";
const O_GRUPO = "99999999-9999-9999-9999-999999999999";

const CAT_MERCADO = "cccccccc-0000-0000-0000-000000000001";
const CAT_SALARIO = "cccccccc-0000-0000-0000-000000000002";
const A_CONTA = "aaaaaaaa-0000-0000-0000-000000000001";

// A janela de `?months=3` com o relogio em 2026-03-05: fim = o mes corrente,
// inicio = dois meses antes (`-(meses - 1)`, porque a janela INCLUI o corrente).
const JANEIRO = "2026-01-01";
const FEVEREIRO = "2026-02-01";
const MARCO = "2026-03-01";

/**
 * O erro de leitura de VERDADE usado nos doze casos.
 *
 * `42501` e nao `42P01`, e a escolha e load-bearing: `42P01` e um dos dois
 * codigos que `viewDaParteAusente` reconhece, entao ele NAO exercita a guarda
 * nos ramos de `cash-flow` e `categories` -- ele exercita a queda da 033, que e
 * o controle B. Um caso de erro escrito com `42P01` sairia **200** e a leitura
 * natural do vermelho seria "a guarda nao funciona".
 */
const RLS_BARROU = {
  code: "42501",
  message: "permission denied for view personal_monthly_cash_flow",
};

/** A view que ainda nao foi colada -- o erro que a queda da 033 atravessa. */
const VIEW_AUSENTE = {
  code: "42P01",
  message: 'relation "personal_monthly_cash_flow" does not exist',
};

// =====================================================
// O FIXTURE
// =====================================================
// Os numeros das duas fontes de cada ramo sao DIFERENTES de proposito: e o que
// faz o controle B medir QUAL view foi lida, em vez de so medir que saiu 200.
//
//   personal_monthly_cash_flow (033) -- inclui A MINHA PARTE das despesas de
//     grupo, entao a despesa e MAIOR: 3.200 em janeiro contra 3.000 da antiga.
//   monthly_cash_flow com group_id NULL (a view antiga, a da queda) -- esconde
//     a parte de grupo: 3.000.
//   monthly_cash_flow do grupo -- o valor CHEIO da viagem, de todos os membros.

const FLUXO_PESSOAL = [
  {
    user_id: EU,
    month: JANEIRO,
    income: 5000,
    expense: 3200,
    net: 1800,
    transaction_count: 12,
    currency: "BRL",
  },
  {
    user_id: EU,
    month: FEVEREIRO,
    income: 5000,
    expense: 2750.5,
    net: 2249.5,
    transaction_count: 9,
    currency: "BRL",
  },
  {
    user_id: EU,
    month: MARCO,
    income: 5000,
    expense: 1100,
    net: 3900,
    transaction_count: 4,
    currency: "BRL",
  },
];

const FLUXO_ANTIGO_E_DO_GRUPO = [
  // A view antiga, pelo recorte `is("group_id", null)` da queda.
  {
    user_id: EU,
    group_id: null,
    month: JANEIRO,
    income: 5000,
    expense: 3000,
    net: 2000,
    transaction_count: 10,
    currency: "BRL",
  },
  {
    user_id: EU,
    group_id: null,
    month: FEVEREIRO,
    income: 5000,
    expense: 2550.5,
    net: 2449.5,
    transaction_count: 8,
    currency: "BRL",
  },
  {
    user_id: EU,
    group_id: null,
    month: MARCO,
    income: 5000,
    expense: 1100,
    net: 3900,
    transaction_count: 4,
    currency: "BRL",
  },
  // O painel do grupo: o valor cheio da viagem.
  {
    user_id: EU,
    group_id: O_GRUPO,
    month: FEVEREIRO,
    income: 0,
    expense: 1200,
    net: -1200,
    transaction_count: 3,
    currency: "BRL",
  },
];

const CATEGORIAS_PESSOAIS = [
  {
    user_id: EU,
    month: JANEIRO,
    category_id: CAT_MERCADO,
    expense: 820.4,
    income: 0,
    transaction_count: 7,
    currency: "BRL",
  },
  {
    user_id: EU,
    month: JANEIRO,
    category_id: CAT_SALARIO,
    expense: 0,
    income: 5000,
    transaction_count: 1,
    currency: "BRL",
  },
];

const CATEGORIAS_ANTIGAS_E_DO_GRUPO = [
  {
    user_id: EU,
    group_id: null,
    month: JANEIRO,
    category_id: CAT_MERCADO,
    // 620,40 contra 820,40 da view pessoal: a diferenca e a parte de grupo, e e
    // o que faz o controle B dizer qual das duas views respondeu.
    expense: 620.4,
    income: 0,
    transaction_count: 5,
    currency: "BRL",
  },
  {
    user_id: EU,
    group_id: O_GRUPO,
    month: FEVEREIRO,
    category_id: CAT_MERCADO,
    expense: 1200,
    income: 0,
    transaction_count: 3,
    currency: "BRL",
  },
];

const NOMES_DE_CATEGORIA = [
  { id: CAT_MERCADO, name: "Mercado" },
  { id: CAT_SALARIO, name: "Salário" },
];

const PREVISTO_X_REALIZADO = [
  {
    user_id: EU,
    group_id: null,
    month: JANEIRO,
    currency: "BRL",
    planned_expense: 3500,
    actual_expense: 3000,
    expense_variance: 500,
    planned_income: 5000,
    actual_income: 5000,
    pending_count: 2,
    overdue_count: 1,
  },
  {
    user_id: EU,
    group_id: O_GRUPO,
    month: FEVEREIRO,
    currency: "BRL",
    planned_expense: 1500,
    actual_expense: 1200,
    expense_variance: 300,
    planned_income: 0,
    actual_income: 0,
    pending_count: 1,
    overdue_count: 0,
  },
];

const PATRIMONIO = [
  { user_id: EU, month: JANEIRO, net_change: 2000, net_worth: 42000 },
  { user_id: EU, month: FEVEREIRO, net_change: 2449.5, net_worth: 44449.5 },
];

/** O extrato: uma linha por lancamento, com o SINAL do banco. */
const LANCAMENTOS = [
  {
    user_id: EU,
    group_id: null,
    transaction_date: "2026-01-14",
    description: "Supermercado Zona Sul",
    amount: -320.4,
    transaction_type: "expense",
    category_id: CAT_MERCADO,
    account_id: A_CONTA,
    notes: null,
  },
  {
    user_id: EU,
    group_id: null,
    transaction_date: "2026-01-05",
    description: "Salário",
    amount: 5000,
    transaction_type: "income",
    category_id: CAT_SALARIO,
    account_id: A_CONTA,
    notes: null,
  },
];

/** O mesmo extrato SEM categoria e SEM conta -- o controle C. */
const LANCAMENTOS_SEM_ROTULO = LANCAMENTOS.map((l) => ({
  ...l,
  category_id: null,
  account_id: null,
}));

const NOMES_DE_CONTA = [{ id: A_CONTA, name: "Nubank" }];

/** Tudo bom: o fixture dos controles positivos. */
function tudoBom() {
  return {
    personal_monthly_cash_flow: FLUXO_PESSOAL,
    monthly_cash_flow: FLUXO_ANTIGO_E_DO_GRUPO,
    personal_category_monthly_totals: CATEGORIAS_PESSOAIS,
    category_monthly_totals: CATEGORIAS_ANTIGAS_E_DO_GRUPO,
    transaction_categories: NOMES_DE_CATEGORIA,
    planned_vs_actual: PREVISTO_X_REALIZADO,
    net_worth_history: PATRIMONIO,
    financial_transactions: LANCAMENTOS,
    financial_accounts: NOMES_DE_CONTA,
  };
}

/**
 * O pedido que a rota aceita.
 *
 * `/api/reports/export` faz `new URL(request.url)` -- nao `request.nextUrl` --,
 * mas o shim entrega os dois: `sonda-de-rota-precisa-de-nexturl-e-de-financial-services`.
 * Um `new Request(url)` passaria aqui e estouraria no dia em que a rota trocar
 * de forma, dentro do `try`, devolvendo um 500 com cara de erro de banco.
 */
function pedido(url) {
  return { url, nextUrl: new URL(url) };
}

/**
 * Chama o export e devolve `{ status, texto, corpo }`.
 *
 * `texto` sempre; `corpo` so quando a resposta e JSON -- a rota devolve CSV no
 * caminho bom e JSON no do erro, e um `await resposta.json()` cego estouraria
 * no caminho bom com "Unexpected token" em vez de medir o CSV.
 *
 * O `delete` no `finally` e obrigatorio: sem ele o duble do caso anterior fica
 * no global, e um caso que esquecesse de montar o seu passaria VERDE lendo o
 * fixture do vizinho.
 */
async function exportar({ tabelas = {}, erros = {}, params = "" } = {}) {
  const d = criarDuble({ user: { id: EU }, tabelas, erros });

  globalThis.__dubleDeSupabase = {
    sessao: () => d.client,
    servico: () => d.client,
  };

  try {
    const resposta = await EXPORT.GET(
      pedido(`https://pulodogato.test/api/reports/export?${params}`)
    );
    const texto = await resposta.text();
    const ehJson = (resposta.headers.get("content-type") ?? "").includes("json");

    return {
      status: resposta.status,
      texto,
      corpo: ehJson ? JSON.parse(texto) : null,
      lidas: d.lidas,
    };
  } finally {
    delete globalThis.__dubleDeSupabase;
  }
}

/**
 * O CSV em linhas de campos.
 *
 * O BOM (`﻿`) sai antes de qualquer coisa -- ele existe para o Excel
 * reconhecer UTF-8 e grudaria no primeiro cabecalho, fazendo toda assercao
 * sobre a coluna "Mês" falhar por um caractere invisivel.
 */
function linhasDoCsv(texto) {
  return texto
    .replace(/^﻿/, "")
    .split("\r\n")
    .filter((l) => l !== "")
    .map((l) => l.split(";"));
}

// =====================================================
// 1. O CONTROLE POSITIVO A -- os cinco relatorios saem completos
// =====================================================
// Isto e o teste que separa "guardei as oito leituras" de "devolvo 500
// sempre". Sem ele, os doze casos de erro abaixo passariam verde com a rota
// respondendo 500 a qualquer pedido, e o placar diria 12/12.
//
// Os numeros estao escritos como literais, e nao calculados a partir do
// fixture: um conferidor que usasse o MESMO extrator nos dois lados passaria
// vacuo (`conferidor-com-o-mesmo-extrator-nos-dois-lados-passa-vacuo`).

test("controle A: cash-flow pessoal sai 200 com as tres linhas da view da 033", async () => {
  const r = await exportar({ tabelas: tudoBom(), params: "report=cash-flow&months=3" });

  assert.equal(r.status, 200);

  assert.deepEqual(linhasDoCsv(r.texto), [
    ["Mês", "Moeda", "Entradas", "Saídas", "Resultado", "Lançamentos"],
    ["01/2026", "BRL", "5000,00", "3200,00", "1800,00", "12,00"],
    ["02/2026", "BRL", "5000,00", "2750,50", "2249,50", "9,00"],
    ["03/2026", "BRL", "5000,00", "1100,00", "3900,00", "4,00"],
  ]);
});

test("controle A: cash-flow DE GRUPO sai 200 com o valor cheio da viagem", async () => {
  const r = await exportar({
    tabelas: tudoBom(),
    params: `report=cash-flow&months=3&groupId=${O_GRUPO}`,
  });

  assert.equal(r.status, 200);

  // A linha do grupo, e so ela: as tres linhas de `group_id IS NULL` do mesmo
  // fixture ficam de fora pelo `.eq("group_id", groupId)`.
  assert.deepEqual(linhasDoCsv(r.texto), [
    ["Mês", "Moeda", "Entradas", "Saídas", "Resultado", "Lançamentos"],
    ["02/2026", "BRL", "0,00", "1200,00", "-1200,00", "3,00"],
  ]);
});

test("controle A: categories sai 200 com os NOMES das categorias resolvidos", async () => {
  const r = await exportar({ tabelas: tudoBom(), params: "report=categories&months=3" });

  assert.equal(r.status, 200);

  // "Mercado" e "Salário" vem do join de rotulo (guarda 3). Se ele falhasse em
  // silencio, as duas linhas diriam "Sem categoria" e o arquivo somaria igual.
  assert.deepEqual(linhasDoCsv(r.texto), [
    ["Mês", "Moeda", "Categoria", "Saídas", "Entradas", "Lançamentos"],
    ["01/2026", "BRL", "Mercado", "820,40", "0,00", "7,00"],
    ["01/2026", "BRL", "Salário", "0,00", "5000,00", "1,00"],
  ]);
});

test("controle A: planned sai 200 com as nove colunas do mes pessoal", async () => {
  const r = await exportar({ tabelas: tudoBom(), params: "report=planned&months=3" });

  assert.equal(r.status, 200);

  assert.deepEqual(linhasDoCsv(r.texto), [
    [
      "Mês",
      "Moeda",
      "Despesa prevista",
      "Despesa realizada",
      "Diferença",
      "Receita prevista",
      "Receita realizada",
      "Contas em aberto",
      "Contas vencidas",
    ],
    [
      "01/2026",
      "BRL",
      "3500,00",
      "3000,00",
      "500,00",
      "5000,00",
      "5000,00",
      "2,00",
      "1,00",
    ],
  ]);
});

test("controle A: net-worth sai 200 com as duas linhas do patrimonio", async () => {
  const r = await exportar({ tabelas: tudoBom(), params: "report=net-worth&months=3" });

  assert.equal(r.status, 200);

  assert.deepEqual(linhasDoCsv(r.texto), [
    ["Mês", "Variação no mês", "Patrimônio no fim do mês"],
    ["01/2026", "2000,00", "42000,00"],
    ["02/2026", "2449,50", "44449,50"],
  ]);
});

test("controle A: transactions sai 200 com categoria, conta e o SINAL do banco", async () => {
  const r = await exportar({ tabelas: tudoBom(), params: "report=transactions&months=3" });

  assert.equal(r.status, 200);

  // A despesa sai NEGATIVA (`pulodogato-amount-sign-convention`): e isso que
  // faz a coluna somar sozinha para o saldo do periodo na planilha.
  assert.deepEqual(linhasDoCsv(r.texto), [
    ["Data", "Descrição", "Categoria", "Conta", "Tipo", "Valor"],
    ["05/01/2026", "Salário", "Salário", "Nubank", "Receita", "5000,00"],
    [
      "14/01/2026",
      "Supermercado Zona Sul",
      "Mercado",
      "Nubank",
      "Despesa",
      "-320,40",
    ],
  ]);
});

// =====================================================
// 2. O CONTROLE POSITIVO B -- a queda da 033 continua caindo
// =====================================================
// A guarda fica DEPOIS da queda, e este e o controle que prova a ordem. Um
// conserto que guardasse antes dela responderia 500 na janela entre o deploy e
// a colagem da migration -- e essa janela nao tem sintoma nenhum em teste que
// nao a fabrique.

test("controle B: cash-flow com a view da 033 ausente CAI para a antiga e sai 200", async () => {
  const r = await exportar({
    tabelas: tudoBom(),
    erros: { personal_monthly_cash_flow: VIEW_AUSENTE },
    params: "report=cash-flow&months=3",
  });

  assert.equal(r.status, 200);

  // 3.000 em janeiro, e nao 3.200: os numeros sao da view ANTIGA. Com as duas
  // fontes tendo os mesmos valores, este `deepEqual` passaria sem dizer qual
  // delas respondeu.
  assert.deepEqual(linhasDoCsv(r.texto), [
    ["Mês", "Moeda", "Entradas", "Saídas", "Resultado", "Lançamentos"],
    ["01/2026", "BRL", "5000,00", "3000,00", "2000,00", "10,00"],
    ["02/2026", "BRL", "5000,00", "2550,50", "2449,50", "8,00"],
    ["03/2026", "BRL", "5000,00", "1100,00", "3900,00", "4,00"],
  ]);
});

test("controle B: categories com a view da 033 ausente CAI para a antiga e sai 200", async () => {
  const r = await exportar({
    tabelas: tudoBom(),
    erros: { personal_category_monthly_totals: VIEW_AUSENTE },
    params: "report=categories&months=3",
  });

  assert.equal(r.status, 200);

  // 620,40 e o numero da view antiga; 820,40 seria o da pessoal.
  assert.deepEqual(linhasDoCsv(r.texto), [
    ["Mês", "Moeda", "Categoria", "Saídas", "Entradas", "Lançamentos"],
    ["01/2026", "BRL", "Mercado", "620,40", "0,00", "5,00"],
  ]);
});

// =====================================================
// 3. O CONTROLE POSITIVO C -- o ramo que NAO consulta
// =====================================================
// Um extrato cujas linhas nao tem categoria nem conta nao chega a consultar
// `transaction_categories` nem `financial_accounts`: o `catIds.length` e zero e
// o ramo entrega `{ data: [] }` -- sem `error` nenhum. Esse objeto passa pela
// mesma guarda que as consultas de verdade, e e por isso que o `error` de
// `linhasOuFalha` e opcional.
//
// Sem este controle, uma guarda escrita ao contrario (`if (!resposta.error)`)
// reprovaria TODO extrato sem categoria -- e o modo de falha seria um 500 em
// conta nova, que e a conta de quem acabou de se cadastrar.

test("controle C: extrato sem categoria e sem conta sai 200, com as duas colunas vazias", async () => {
  const r = await exportar({
    tabelas: { ...tudoBom(), financial_transactions: LANCAMENTOS_SEM_ROTULO },
    params: "report=transactions&months=3",
  });

  assert.equal(r.status, 200);

  assert.deepEqual(linhasDoCsv(r.texto), [
    ["Data", "Descrição", "Categoria", "Conta", "Tipo", "Valor"],
    ["05/01/2026", "Salário", "", "", "Receita", "5000,00"],
    ["14/01/2026", "Supermercado Zona Sul", "", "", "Despesa", "-320,40"],
  ]);

  // E a prova de que as duas consultas de rotulo NAO aconteceram: se elas
  // tivessem acontecido, as colunas vazias viriam de um join que nao achou
  // nada, e nao do ramo que nao consulta -- dois estados diferentes com o mesmo
  // arquivo (`sumido-da-tela-pode-ser-so-indistinguivel`).
  const consultadas = r.lidas.map((l) => l.tabela);
  assert.ok(!consultadas.includes("transaction_categories"));
  assert.ok(!consultadas.includes("financial_accounts"));
});

// =====================================================
// 4. AS DOZE CONSULTAS: uma por vez, e a resposta NAO pode ser 200
// =====================================================
// O que se afirma e `status !== 200` e nao `status === 500`? Nao: as duas. O
// `!== 200` sozinho passaria com a rota devolvendo 404 ou 401, que diriam a
// coisa errada a quem integra. O `=== 500` e a decisao da issue; o `!== 200` e
// a razao dela existir, e esta escrito separado para o vermelho dizer qual dos
// dois quebrou.
//
// Cada caso afirma tambem que o corpo NOMEIA a consulta que falhou. Isso e o
// que distingue oito guardas de um `catch` que devolve "Erro interno" para
// tudo: quem recebe o 500 tem de saber o que nao leu sem abrir a rota.

const CONSULTAS = [
  {
    nome: "1a/8 -- monthly_cash_flow no relatorio DE GRUPO",
    tabela: "monthly_cash_flow",
    params: `report=cash-flow&months=3&groupId=${O_GRUPO}`,
    consulta: "o fluxo de caixa mensal",
  },
  {
    nome: "1b/8 -- personal_monthly_cash_flow (a view da 033)",
    tabela: "personal_monthly_cash_flow",
    params: "report=cash-flow&months=3",
    consulta: "o fluxo de caixa mensal",
  },
  {
    // A QUEDA DA 033 TAMBEM FALHANDO. Dois erros no mesmo pedido: a view
    // pessoal ausente (que a queda atravessa) e a ANTIGA barrada pela RLS. Sem
    // este caso, uma guarda escrita ANTES da queda passaria verde nos outros
    // onze e deixaria a queda sem conferencia nenhuma.
    nome: "1c/8 -- monthly_cash_flow na QUEDA da 033 (as duas views falhando)",
    tabela: "monthly_cash_flow",
    errosExtra: { personal_monthly_cash_flow: VIEW_AUSENTE },
    params: "report=cash-flow&months=3",
    consulta: "o fluxo de caixa mensal",
  },
  {
    nome: "2a/8 -- category_monthly_totals no relatorio DE GRUPO",
    tabela: "category_monthly_totals",
    params: `report=categories&months=3&groupId=${O_GRUPO}`,
    consulta: "os gastos por categoria",
  },
  {
    nome: "2b/8 -- personal_category_monthly_totals (a view da 033)",
    tabela: "personal_category_monthly_totals",
    params: "report=categories&months=3",
    consulta: "os gastos por categoria",
  },
  {
    nome: "2c/8 -- category_monthly_totals na QUEDA da 033",
    tabela: "category_monthly_totals",
    errosExtra: { personal_category_monthly_totals: VIEW_AUSENTE },
    params: "report=categories&months=3",
    consulta: "os gastos por categoria",
  },
  {
    nome: "3/8 -- transaction_categories, o join de rotulo de categories",
    tabela: "transaction_categories",
    params: "report=categories&months=3",
    consulta: "os nomes das categorias",
  },
  {
    nome: "4/8 -- planned_vs_actual",
    tabela: "planned_vs_actual",
    params: "report=planned&months=3",
    consulta: "o previsto x realizado",
  },
  {
    nome: "5/8 -- net_worth_history",
    tabela: "net_worth_history",
    params: "report=net-worth&months=3",
    consulta: "o historico de patrimonio",
  },
  {
    nome: "6/8 -- financial_transactions, o extrato",
    tabela: "financial_transactions",
    params: "report=transactions&months=3",
    consulta: "o extrato de lancamentos",
  },
  {
    nome: "7/8 -- transaction_categories, o join de rotulo do extrato",
    tabela: "transaction_categories",
    params: "report=transactions&months=3",
    consulta: "os nomes das categorias do extrato",
  },
  {
    nome: "8/8 -- financial_accounts, o join de rotulo do extrato",
    tabela: "financial_accounts",
    params: "report=transactions&months=3",
    consulta: "os nomes das contas do extrato",
  },
];

for (const { nome, tabela, errosExtra = {}, params, consulta } of CONSULTAS) {
  test(`${nome}: falhando, a resposta NAO e 200`, async () => {
    const r = await exportar({
      tabelas: tudoBom(),
      erros: { ...errosExtra, [tabela]: RLS_BARROU },
      params,
    });

    assert.notEqual(
      r.status,
      200,
      "200 com CSV vazio e o defeito: na planilha isso se le como 'nao houve movimento'"
    );
    assert.equal(r.status, 500);
  });

  test(`${nome}: o corpo do 500 NOMEIA a consulta e repassa o erro do banco`, async () => {
    const r = await exportar({
      tabelas: tudoBom(),
      erros: { ...errosExtra, [tabela]: RLS_BARROU },
      params,
    });

    assert.equal(r.corpo?.consulta, consulta);
    assert.equal(r.corpo?.codigo, "42501");
    assert.equal(r.corpo?.detalhe, RLS_BARROU.message);
    assert.match(r.corpo?.error ?? "", new RegExp(consulta));

    // E NAO sai CSV nenhum: um 500 que ainda entregasse o arquivo com
    // `Content-Disposition` faria o browser baixar o incompleto de todo jeito.
    assert.ok(!r.texto.startsWith("﻿"));
  });
}

// =====================================================
// 5. A FIACAO FOI CONSULTADA -- o duble nao ficou sem uso
// =====================================================
// Se a rota um dia trocar o jeito de obter o client (`createServerClient`
// direto, outro helper), o duble deixa de ser consultado e TODOS os casos acima
// mediriam rede -- ou, mais provavel, um 500 por client ausente, que os doze
// casos de erro leriam como sucesso. Ver o cabecalho de
// scripts/monta-duble-de-rota.mjs.

test("a rota leu pelo client do duble, e nao por outro caminho", async () => {
  const d = criarDuble({ user: { id: EU }, tabelas: tudoBom() });

  // O CONTADOR mora no objeto instalado no global, e nao no `d`: e
  // `monta-duble-de-rota.mjs` quem o incrementa, em
  // `globalThis.__dubleDeSupabase.chamadasDeSessao`. Guardo a referencia para
  // poder ler depois do `delete`.
  const instalado = { sessao: () => d.client, servico: () => d.client };
  globalThis.__dubleDeSupabase = instalado;

  try {
    await EXPORT.GET(
      pedido("https://pulodogato.test/api/reports/export?report=cash-flow&months=3")
    );
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  assert.equal(
    instalado.chamadasDeSessao,
    1,
    "a rota nao pediu o client de sessao ao duble -- o duble ficou sem uso e " +
      "tudo acima mediu outra coisa"
  );
  assert.deepEqual(
    d.lidas.map((l) => l.tabela),
    ["personal_monthly_cash_flow"],
    "o ramo pessoal le UMA view -- a queda da 033 nao dispara sem erro"
  );
});
