#!/usr/bin/env node
// =====================================================
// PULODOGATO - as sete leituras de dinheiro do MyBank (HMO-372, F4 da HMO-368)
// =====================================================
//   npm run test:leituras-do-mybank
//
// O QUE ESTA SUITE MEDE, E POR QUE ELA MEDE ROTA E NAO FUNCAO PURA
// ----------------------------------------------------------------
// A F2 (HMO-370) decidiu o que cada caso ESCREVE. Esta fase decide o que cada
// leitura VE. `parcelasDevidasNaAgenda` e `aReceberDoMyBank` sao puras e um
// teste de unidade sobre elas tem tres linhas -- e passaria verde com as
// QUATRO rotas continuando a nao chamar nenhuma das duas. A promessa da issue e
// sobre os NUMEROS QUE AS LEITURAS DEVOLVEM, e isso vive na fiacao.
//
// Um guard textual tambem nao serve, e aqui a armadilha e concreta: os quatro
// arquivos agora CITAM `lerDividaDoMyBank` e `mybank_due_entries` dentro dos
// comentarios que explicam a decisao, entao `includes(...)` casaria com a
// explicacao e nao com o codigo -- `assercao-de-fiacao-casa-com-o-import` e
// `guard-com-janela-de-chars-conta-comentario`.
//
// O CONTROLE NEGATIVO E O TESTE QUE IMPORTA
// -----------------------------------------
// "Uma conta sem nenhum emprestimo MyBank tem que ler exatamente os mesmos
// numeros de hoje, nas sete." Esse e o teste que separa "integrei" de "mexi no
// dinheiro de todo mundo", e ele e o PRIMEIRO bloco deste arquivo -- os sete
// numeros do retrato estao escritos como literais, medidos na arvore antes de
// qualquer mudanca de leitura.
//
// A FORMA da resposta tambem entra no controle, e nao so os numeros: um campo
// novo que aparecesse como `{ total: 0 }` em toda conta do app mudaria o
// contrato da tela sem mudar numero nenhum. Por isso `a_receber_do_mybank` e
// `null` -- e nao um zero -- na conta sem MyBank, e isso e afirmado.
//
// COMO A VIEW `mybank_due_entries` E MODELADA AQUI
// ------------------------------------------------
// O duble nao tem RLS (ver o cabecalho de scripts/duble-de-supabase.mjs), e a
// view faz TRES recortes que as rotas de proposito NAO repetem:
// `borrower_user_id = auth.uid()`, `borrower IS DISTINCT FROM lender` (o
// auto-emprestimo fora) e `status IN ('pending','reported')`. Entao o fixture
// de `mybank_due_entries` contem exatamente o que a view DEVOLVERIA -- os tres
// recortes sao provados contra um Postgres de verdade em
// database/tests/053_mybank_emprestimo_e_parcelas_test.sql (F1), e o que se
// mede aqui e o que a ROTA faz com o que leu.
//
// O CASO, EM REAIS
// ----------------
// Dois lados da mesma moto em 24x de R$ 1.000, cada parcela com R$ 950 de
// principal e R$ 50 de juro:
//
//   * CASO A -- eu pego emprestado da MINHA conta de investimento. A parcela e
//     uma transferencia prevista em `scheduled_transactions` (R$ 1.000, dia 10),
//     e ela tem de aparecer UMA vez em Contas a Pagar, UMA vez no «A vencer»,
//     UMA vez na aba Transferencias (e NENHUMA em Despesas, desde a fase 5), e
//     descontar R$ 1.000 do safe-to-spend;
//   * CASO B -- eu emprestei para a Lais. No MEU lado: nada em tabela de
//     dinheiro, R$ 50 de juro no «Previsto» de Receitas e ZERO de desconto no
//     safe-to-spend. No lado DELA: R$ 1.000 em Contas a Pagar pela view, R$ 1.000
//     descontados do safe-to-spend dela, e R$ 50 de juro na aba Despesas.
//
// SO O JURO NAS ABAS RECEITAS E DESPESAS (fase 5, RN021.3): elas sao as duas
// metades do Resultado do mes, e o principal do emprestimo e transferencia. O
// juro de cada parcela sai da view `mybank_installment_interest` (071), que o
// fixture modela como a saida da view, pela mesma razao de `mybank_due_entries`:
// o rateio e a RLS sao provados contra um Postgres de verdade em
// database/tests/071_juros_do_mybank_no_resultado_test.sql.
// =====================================================

import test, { after, before, mock } from "node:test";
import assert from "node:assert/strict";

import { criarDuble } from "./duble-de-supabase.mjs";

// =====================================================
// O RELOGIO E CONGELADO -- `relogio-congelado-em-teste-node`
// =====================================================
// As quatro rotas chamam `today()` (lib/recurrence.ts), que le
// `new Date()` no fuso de Sao Paulo, e dele saem TRES coisas que esta suite
// mede: `effective_status` (vencida ou nao), o fim do mes do safe-to-spend, e a
// janela que o `?months=` monta.
//
// Com o relogio de verdade, a parcela do dia 10 estaria "a vencer" nos nove
// primeiros dias do mes e "vencida" nos vinte e um restantes -- os numeros
// desta suite oscilariam no CALENDARIO, sem ninguem ter mudado codigo, e a
// suite seria vermelha em dois tercos dos dias do ano. Pior: no dia certo ela
// passaria verde com a logica de `overdue` apagada.
//
// `apis: ["Date"]` e nao os timers todos: congelar `setTimeout` faria qualquer
// `await` interno da rota nunca resolver.
before(() => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-03-05T15:00:00Z") });
});

after(() => {
  mock.timers.reset();
});

const RAIZ = "../.tmp-leituras-do-mybank";

const LISTA = await import(`${RAIZ}/app/api/scheduled-transactions/route.js`);
const CABECALHO = await import(
  `${RAIZ}/app/api/scheduled-transactions/summary/route.js`
);
const POSSO_GASTAR = await import(`${RAIZ}/app/api/safe-to-spend/route.js`);
const MOVIMENTACAO = await import(`${RAIZ}/app/api/movimentacoes/resumo/route.js`);

const LEITURAS = await import(`${RAIZ}/lib/leituras-do-mybank.js`);
const TELAS = await import(`${RAIZ}/lib/telas-de-movimentacao.js`);
const EMPRESTIMO = await import(`${RAIZ}/lib/emprestimo-do-mybank.js`);

const EU = "11111111-1111-1111-1111-111111111111";
const A_LAIS = "22222222-2222-2222-2222-222222222222";

const CORRENTE = "aaaaaaaa-0000-0000-0000-000000000001";
const INVESTIMENTO = "aaaaaaaa-0000-0000-0000-000000000002";

const EMPRESTIMO_DA_MOTO = "bbbbbbbb-0000-0000-0000-000000000001";
const PARCELA_3_DE_24 = "cccccccc-0000-0000-0000-000000000003";

// O mes da medicao e FIXO. `today()` sai do relogio e as quatro rotas o usam
// para `effective_status`, para o fim do mes e para a janela -- com a data
// variavel, a parcela do dia 10 estaria vencida metade do mes e os numeros
// desta suite oscilariam sem ninguem ter mudado codigo
// (`teste-de-data-passa-em-utc-e-nao-ve-o-bug`).
const HOJE = "2026-03-05";
const VENCE_DIA_10 = "2026-03-10";
const FIM_DO_MES = "2026-03-31";

/**
 * As contas. `current_balance` e R$ 5.000 na corrente de proposito: o
 * safe-to-spend precisa de um disponivel maior que a parcela, senao o "livre"
 * satura em zero e a diferenca de R$ 1.000 que esta suite mede desapareceria
 * no piso -- `piso-com-folga-desarma-o-controle-negativo`.
 */
const CONTAS = [
  {
    id: CORRENTE,
    user_id: EU,
    name: "Corrente",
    account_type: "checking",
    current_balance: 5000,
    is_active: true,
  },
  {
    id: INVESTIMENTO,
    user_id: EU,
    name: "Investimento",
    account_type: "investment",
    current_balance: 24000,
    is_active: true,
  },
];

/** Uma conta a pagar comum, que existe nos DOIS retratos. */
const CONTA_DE_LUZ = {
  id: "dddddddd-0000-0000-0000-000000000001",
  user_id: EU,
  description: "Luz",
  amount: 200,
  due_date: VENCE_DIA_10,
  status: "pending",
  effective_status: "pending",
  // AS DUAS COLUNAS DE HMO-411 VEM JUNTO DAS ANTIGAS, E NAO NO LUGAR DELAS:
  // este fixture e uma linha da VIEW, e a view entrega as quatro. Para conta
  // que nao e de grupo a 055 garante `my_status = status::text` -- o fixture
  // repete essa igualdade de proposito, e e ela que faz esta suite ser o
  // controle de "o numero NAO muda para conta individual".
  my_status: "pending",
  my_effective_status: "pending",
  currency: "BRL",
  direction: "expense",
  notes: null,
  recurring_rule_id: null,
  group_id: null,
  category: { name: "Casa" },
  account: { id: CORRENTE, name: "Corrente", account_type: "checking" },
};

/**
 * A PARCELA DO CASO A -- uma transferencia prevista de verdade.
 *
 * `transaction_type` nao aparece aqui e `direction` sim, e isso e a view: a
 * coluna `direction` da `scheduled_transactions_effective` e a precedencia
 * ocorrencia -> regra -> 'expense' resolvida UMA vez na migration 027. As
 * quatro rotas leem `direction` e nenhuma le `transaction_type`.
 */
const PARCELA_DO_AUTO_EMPRESTIMO = {
  id: "eeeeeeee-0000-0000-0000-000000000001",
  user_id: EU,
  description: "Moto elétrica (3/24)",
  amount: 1000,
  due_date: VENCE_DIA_10,
  status: "pending",
  effective_status: "pending",
  // Ver CONTA_DE_LUZ: linha da view, as quatro colunas, e a igualdade que a
  // 055 garante para linha de que eu sou o dono.
  my_status: "pending",
  my_effective_status: "pending",
  currency: "BRL",
  direction: "transfer",
  notes: EMPRESTIMO.chaveDaParcelaDoMyBank(PARCELA_3_DE_24),
  recurring_rule_id: null,
  group_id: null,
  destination_account_id: INVESTIMENTO,
  category: { name: "Transferência" },
  account: { id: CORRENTE, name: "Corrente", account_type: "checking" },
};

/**
 * O QUE A VIEW `mybank_due_entries` DEVOLVE PARA A LAIS -- a parcela que ELA
 * deve. Ver o cabecalho para por que o fixture e a saida da view, e nao a
 * tabela crua.
 */
const DIVIDA_DA_LAIS = {
  id: PARCELA_3_DE_24,
  loan_id: EMPRESTIMO_DA_MOTO,
  lender_user_id: EU,
  description: "Moto elétrica",
  // STRING e nao numero, de proposito: o PostgREST entrega `numeric(15,2)` como
  // string, e `l.amount + 0` em qualquer uma das quatro rotas produziria
  // "10000" por concatenacao. O unico lugar que converte e `valorDaParcela`.
  amount: "1000.00",
  due_date: VENCE_DIA_10,
  status: "pending",
  installment_number: 3,
  installment_total: 24,
  reported_at: null,
};

/**
 * O JURO DA PARCELA 3/24, COMO `mybank_installment_interest` (071) A DEVOLVE.
 *
 * A view e dos DOIS lados: a mesma linha chega para quem emprestou (eu) e para
 * quem pegou (a Lais), e quem le filtra o lado.
 */
const JURO_DA_PARCELA = {
  id: PARCELA_3_DE_24,
  loan_id: EMPRESTIMO_DA_MOTO,
  lender_user_id: EU,
  borrower_user_id: A_LAIS,
  loan_status: "active",
  description: "Moto elétrica",
  installment_number: 3,
  installment_total: 24,
  amount: "1000.00",
  due_date: VENCE_DIA_10,
  status: "pending",
  // STRING, como o PostgREST entrega `numeric(15,2)`.
  interest_amount: "50.00",
};

/** Monta o duble com um conjunto de tabelas, sobre a sessao de quem olha. */
function duble(quemOlha, tabelas) {
  return criarDuble({ user: { id: quemOlha }, tabelas });
}

/**
 * Instala o duble no global e devolve a resposta em JSON.
 *
 * `sessao` E `servico` apontam para o MESMO client, e nao e descuido: as quatro
 * rotas desta suite usam so o de sessao (nenhuma delas tem service role), e
 * instalar os dois faz a sonda sobreviver ao dia em que uma delas passar a
 * pedir o outro -- em vez de estourar com "nao foi instalado" num erro que o
 * `catch` da rota engole e devolve como 500.
 *
 * O `delete` no `finally` e obrigatorio: sem ele o duble do caso anterior fica
 * no global, e um caso que ESQUECESSE de montar o seu passaria verde lendo o
 * fixture do vizinho.
 */
async function chamar(handler, d, url) {
  globalThis.__dubleDeSupabase = {
    sessao: () => d.client,
    servico: () => d.client,
  };
  try {
    const resposta = await handler(url ? pedido(url) : undefined);
    return { status: resposta.status, corpo: await resposta.json() };
  } finally {
    delete globalThis.__dubleDeSupabase;
  }
}

/**
 * O pedido que as quatro rotas aceitam -- e elas NAO leem a URL do mesmo jeito.
 *
 * `/api/scheduled-transactions` e `/summary` fazem `new URL(request.url)`;
 * `/api/movimentacoes/resumo` le `request.nextUrl.searchParams`, que e do
 * `NextRequest` e NAO existe num `Request` do fetch -- um `new Request(url)`
 * passa pelas duas primeiras e estoura `Cannot read properties of undefined
 * (reading 'searchParams')` na terceira. O `catch` da rota engole isso e
 * devolve **500**, entao o sintoma nao e o TypeError: e uma leitura "que nao
 * carregou", exatamente a cara de um erro de banco.
 *
 * Por isso o shim entrega os DOIS, e nao um Request de verdade: `url` para quem
 * constroi a URL, `nextUrl` para quem ja a espera construida.
 */
function pedido(url) {
  return { url, nextUrl: new URL(url) };
}

// =====================================================
// 0. O RETRATO DA CONTA SEM MYBANK -- o controle negativo
// =====================================================
// Os sete numeros de uma conta que nunca criou emprestimo nenhum. Eles estao
// aqui como LITERAIS, e nao calculados a partir do fixture: um retrato que se
// calcula com o mesmo codigo que ele existe para vigiar passa verde com o
// codigo errado -- `conferidor-com-o-mesmo-extrator-nos-dois-lados-passa-vacuo`.
//
// A conta sem MyBank tem UMA conta de luz de R$ 200 vencendo dia 10.

const SEM_MYBANK = {
  // `/api/movimentacoes/resumo` responde **404** sem esta linha, e nao 200 com
  // lista vazia: ela filtra `financial_services` por `name =
  // 'personal_finance'` e devolve "serviço não encontrado". E o 404 nao se le
  // como fixture incompleto -- ele se le como rota errada.
  financial_services: [{ id: "ffffffff-0000-0000-0000-000000000001", name: "personal_finance" }],
  financial_accounts: CONTAS,
  scheduled_transactions_effective: [CONTA_DE_LUZ],
  // As quatro tabelas do MyBank VAZIAS, e nao ausentes: tabela ausente tambem
  // responde `[]` no duble, e o teste nao distinguiria "a rota consultou e nao
  // achou nada" de "a rota nao consultou". `d.lidas` e o que distingue, e o
  // ultimo caso deste bloco o afirma.
  mybank_due_entries: [],
  mybank_loans: [],
  mybank_installments: [],
  // As duas views da 071 (fase 5).
  mybank_installment_interest: [],
  mybank_interest_entries: [],
};

test("controle negativo 1/4: Contas a Pagar da conta sem MyBank lista UMA linha, a de luz", async () => {
  const d = duble(EU, SEM_MYBANK);
  const { status, corpo } = await chamar(
    LISTA.GET,
    d,
    `http://t/api/scheduled-transactions?from=${HOJE}&to=${FIM_DO_MES}&generate=false`
  );

  assert.equal(status, 200);
  assert.equal(corpo.scheduled.length, 1);
  assert.equal(corpo.scheduled[0].description, "Luz");

  // A rota CONSULTOU a view e recebeu vazio -- e nao deixou de consultar.
  assert.ok(
    d.lidas.some((l) => l.tabela === "mybank_due_entries"),
    "a rota tem de consultar mybank_due_entries mesmo na conta sem MyBank: sem esta consulta o teste acima passa por vacuidade"
  );
});

test("controle negativo 2/4: o «A vencer» da conta sem MyBank continua R$ 200,00", async () => {
  const d = duble(EU, SEM_MYBANK);
  const { status, corpo } = await chamar(
    CABECALHO.GET,
    d,
    `http://t/api/scheduled-transactions/summary?de=${HOJE}&ate=${FIM_DO_MES}`
  );

  assert.equal(status, 200);
  const mes = corpo.summary.find((m) => m.month === "2026-03");
  assert.equal(mes.total_pending_expense, 200);
  assert.equal(mes.count_pending_expense, 1);
  assert.equal(mes.total_pending_income, 0);
  assert.equal(mes.expected_expense, 200);
});

test("controle negativo 3/4: o «Previsto» de Receitas da conta sem MyBank nao ganha campo com zero", async () => {
  const d = duble(EU, SEM_MYBANK);
  const { status, corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=income&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  assert.equal(status, 200);
  assert.equal(corpo.resumo.previsto, 0);
  // `null` E NAO `{ total: 0 }`. A FORMA entra no controle negativo: um campo
  // que aparecesse zerado em toda conta do app mudaria o contrato da tela sem
  // mudar numero nenhum, e a tela escreveria "R$ 0,00 a receber no MyBank" para
  // quem nunca abriu o MyBank -- ruido que parece recurso quebrado.
  assert.equal(corpo.resumo.a_receber_do_mybank, null);

  // A rota CONSULTOU a view do juro e recebeu vazio.
  assert.ok(
    d.lidas.some((l) => l.tabela === "mybank_installment_interest"),
    "a aba Receitas tem de consultar mybank_installment_interest mesmo na conta sem MyBank"
  );
});

test("controle negativo 4/4: o «Previsto» de Despesas da conta sem MyBank continua R$ 200,00", async () => {
  const d = duble(EU, SEM_MYBANK);
  const { corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=expense&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  assert.equal(corpo.resumo.previsto, 200);
  assert.equal(corpo.resumo.realizado, 0);
  assert.equal(corpo.linhas.length, 1);
  assert.equal(corpo.linhas[0].natureza, "despesa");
  assert.equal(corpo.resumo.a_receber_do_mybank, null);

  // As duas views do juro foram consultadas e voltaram vazias.
  for (const view of ["mybank_installment_interest", "mybank_interest_entries"]) {
    assert.ok(
      d.lidas.some((l) => l.tabela === view),
      `a aba Despesas tem de consultar ${view} mesmo na conta sem MyBank`
    );
  }
});

// =====================================================
// LEITURA 1 -- Contas a Pagar: a lista e o cabecalho
// =====================================================

test("leitura 1a: a parcela do devedor APARECE em Contas a Pagar, pela view", async () => {
  const d = duble(A_LAIS, {
    ...SEM_MYBANK,
    financial_accounts: [],
    scheduled_transactions_effective: [],
    mybank_due_entries: [DIVIDA_DA_LAIS],
  });

  const { status, corpo } = await chamar(
    LISTA.GET,
    d,
    `http://t/api/scheduled-transactions?from=${HOJE}&to=${FIM_DO_MES}&generate=false`
  );

  assert.equal(status, 200);
  assert.equal(corpo.scheduled.length, 1);

  const parcela = corpo.scheduled[0];
  assert.equal(parcela.parcela_do_mybank, true);
  assert.equal(parcela.amount, 1000, "a string numeric(15,2) tem de virar numero");
  assert.equal(parcela.direction, "expense");
  assert.equal(parcela.selo, "MyBank");
  assert.equal(parcela.installment_number, 3);
  assert.equal(parcela.installment_total, 24);

  // `id: null` e o id de verdade em campo proprio: um `id` preenchido faria a
  // tela mandar PATCH /api/scheduled-transactions/<id> sobre um uuid que aquela
  // tabela nao tem.
  assert.equal(parcela.id, null);
  assert.equal(parcela.mybank_installment_id, PARCELA_3_DE_24);

  // O DONO DA LEITURA. `undefined` aqui faria `posso_editar` cair para `false` e
  // o botao de avisar que pagou desapareceria -- a licao da HMO-311 na fatura
  // sintetizada, que so a escrita de verdade em producao pegou.
  assert.equal(parcela.user_id, A_LAIS);
});

test("leitura 1a: o auto-emprestimo aparece UMA vez, e nao duas", async () => {
  // O cenario que produziria a linha repetida: a view EXCLUI o auto-emprestimo
  // (`borrower IS DISTINCT FROM lender`), entao o fixture dela esta vazio
  // enquanto a previsao existe. Uma view que devolvesse o auto-emprestimo faria
  // esta mesma parcela aparecer duas vezes -- e e por isso que o fixture de
  // `mybank_due_entries` vazio AO LADO da previsao e o caso, e nao um descuido.
  const d = duble(EU, {
    ...SEM_MYBANK,
    scheduled_transactions_effective: [CONTA_DE_LUZ, PARCELA_DO_AUTO_EMPRESTIMO],
  });

  const { corpo } = await chamar(
    LISTA.GET,
    d,
    `http://t/api/scheduled-transactions?from=${HOJE}&to=${FIM_DO_MES}&generate=false`
  );

  const doMyBank = corpo.scheduled.filter(
    (l) => String(l.notes ?? "").startsWith("mybank:")
  );
  assert.equal(doMyBank.length, 1, "a parcela do auto-emprestimo nao pode aparecer duas vezes");
  assert.equal(doMyBank[0].amount, 1000);
  assert.equal(corpo.scheduled.length, 2);
});

test("leitura 1b: o «A vencer» soma a parcela do devedor UMA vez -- R$ 200 + R$ 1.000", async () => {
  const d = duble(A_LAIS, {
    ...SEM_MYBANK,
    financial_accounts: [],
    scheduled_transactions_effective: [{ ...CONTA_DE_LUZ, user_id: A_LAIS }],
    mybank_due_entries: [DIVIDA_DA_LAIS],
  });

  const { corpo } = await chamar(
    CABECALHO.GET,
    d,
    `http://t/api/scheduled-transactions/summary?de=${HOJE}&ate=${FIM_DO_MES}`
  );

  const mes = corpo.summary.find((m) => m.month === "2026-03");
  // O numero medido: R$ 1.200,00 contra os R$ 200,00 do retrato. A diferenca e
  // exatamente a parcela, e nenhum centavo a mais.
  assert.equal(mes.total_pending_expense, 1200);
  assert.equal(mes.count_pending_expense, 2);
  // E ela NAO entrou do outro lado. Divida nao e receita a receber.
  assert.equal(mes.total_pending_income, 0);
  assert.equal(mes.expected_expense, 1200);
});

test("leitura 1b: a parcela VENCIDA do devedor cai em «vencido a pagar», e nao em «a pagar»", async () => {
  // O mesmo `CASE` da migration 027, do lado do MyBank: `pending` com
  // vencimento anterior a hoje e `overdue`. Sem isto a parcela atrasada ficaria
  // no balde de "ainda vai vencer" e a tela nao destacaria o atraso.
  const d = duble(A_LAIS, {
    ...SEM_MYBANK,
    financial_accounts: [],
    scheduled_transactions_effective: [],
    mybank_due_entries: [{ ...DIVIDA_DA_LAIS, due_date: "2026-03-01" }],
  });

  const { corpo } = await chamar(
    CABECALHO.GET,
    d,
    `http://t/api/scheduled-transactions/summary?de=2026-03-01&ate=${FIM_DO_MES}`
  );

  const mes = corpo.summary.find((m) => m.month === "2026-03");
  assert.equal(mes.total_overdue_expense, 1000);
  assert.equal(mes.total_pending_expense, 0);
});

test("leitura 1: o RECORTE DE DATA vale -- a parcela de abril nao entra na janela de marco", async () => {
  // `leitura-sem-recorte-de-data-soma-o-horizonte`: a view NAO tem recorte de
  // periodo (ela e a divida inteira, 24 parcelas). Sem o recorte, o «A vencer»
  // de marco somaria os R$ 24.000 do emprestimo inteiro.
  const d = duble(A_LAIS, {
    ...SEM_MYBANK,
    financial_accounts: [],
    scheduled_transactions_effective: [],
    mybank_due_entries: [
      DIVIDA_DA_LAIS,
      { ...DIVIDA_DA_LAIS, id: "fora-da-janela", due_date: "2026-04-10" },
    ],
  });

  const { corpo } = await chamar(
    LISTA.GET,
    d,
    `http://t/api/scheduled-transactions?from=${HOJE}&to=${FIM_DO_MES}&generate=false`
  );

  assert.equal(corpo.scheduled.length, 1);
  assert.equal(corpo.scheduled[0].mybank_installment_id, PARCELA_3_DE_24);
});

test("leitura 1: a lista filtrada por grupo nao ganha parcela de MyBank", async () => {
  // Divida de MyBank tem `group_id: null` por construcao. Sem esta condicao,
  // filtrar por um grupo passaria a somar a parcela do MyBank em TODO grupo.
  const d = duble(A_LAIS, {
    ...SEM_MYBANK,
    financial_accounts: [],
    scheduled_transactions_effective: [],
    mybank_due_entries: [DIVIDA_DA_LAIS],
  });

  const { corpo } = await chamar(
    LISTA.GET,
    d,
    `http://t/api/scheduled-transactions?from=${HOJE}&to=${FIM_DO_MES}&generate=false&group_id=qualquer`
  );

  assert.equal(corpo.scheduled.length, 0);
});

test("leitura 1: `?status=paid` nao devolve a parcela pendente do MyBank", async () => {
  const d = duble(A_LAIS, {
    ...SEM_MYBANK,
    financial_accounts: [],
    scheduled_transactions_effective: [],
    mybank_due_entries: [DIVIDA_DA_LAIS],
  });

  const { corpo } = await chamar(
    LISTA.GET,
    d,
    `http://t/api/scheduled-transactions?from=${HOJE}&to=${FIM_DO_MES}&generate=false&status=paid`
  );

  assert.equal(corpo.scheduled.length, 0);
});

// =====================================================
// LEITURA 2 -- as abas Despesas e Receitas
// =====================================================

test("leitura 2: o auto-emprestimo NAO entra no «Previsto» de Despesas -- fica R$ 200 (RN021.4)", async () => {
  // Da HMO-372 ate a fase 4 a parcela do Caso A entrava tambem em Despesas
  // ("quanto sai da sua conta"). Desde a fase 5 a aba Despesas e a metade de
  // Despesas do Resultado do mes, e o emprestimo a si mesmo e transferencia: o
  // dinheiro volta para a minha conta de investimento.
  const d = duble(EU, {
    ...SEM_MYBANK,
    scheduled_transactions_effective: [CONTA_DE_LUZ, PARCELA_DO_AUTO_EMPRESTIMO],
  });

  const { corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=expense&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  // O retrato da conta sem MyBank, e nao R$ 1.200,00.
  assert.equal(corpo.resumo.previsto, 200);
  assert.equal(corpo.linhas.length, 1);
  assert.equal(corpo.linhas[0].descricao, "Luz");
  assert.equal(
    corpo.linhas.filter((l) => l.natureza === "mybank").length,
    0,
    "a parcela do auto-emprestimo nao pode estar em Despesas"
  );
});

test("leitura 2: a parcela do auto-emprestimo esta na aba Transferencias, com o selo", async () => {
  // E o CONTROLE do caso de cima: a parcela existe e e lida, so que na aba em
  // que ela mora.
  const d = duble(EU, {
    ...SEM_MYBANK,
    scheduled_transactions_effective: [CONTA_DE_LUZ, PARCELA_DO_AUTO_EMPRESTIMO],
  });

  const { corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=transfer&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  assert.equal(corpo.linhas.length, 1);
  assert.equal(corpo.linhas[0].tipo, "transfer");
  assert.equal(corpo.linhas[0].natureza, "mybank");
  assert.equal(corpo.resumo.previsto, 1000);
});

test("leitura 2: a parcela do auto-emprestimo NAO aparece na aba Receitas", async () => {
  const d = duble(EU, {
    ...SEM_MYBANK,
    scheduled_transactions_effective: [CONTA_DE_LUZ, PARCELA_DO_AUTO_EMPRESTIMO],
  });

  const { corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=income&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  assert.equal(corpo.linhas.length, 0);
  assert.equal(corpo.resumo.previsto, 0);
});

/**
 * O emprestimo da GELADEIRA, sem juro: a parcela de R$ 300 e toda principal.
 * Ele esta no fixture para a frase contar so as parcelas e os emprestimos que
 * tem juro.
 */
const GELADEIRA_SEM_JURO = {
  ...JURO_DA_PARCELA,
  id: "cccccccc-0000-0000-0000-0000000000a1",
  loan_id: "bbbbbbbb-0000-0000-0000-0000000000a1",
  description: "Geladeira",
  installment_number: 1,
  installment_total: 2,
  amount: "300.00",
  interest_amount: "0.00",
};

test("leitura 2: o JURO a receber da conexao entra no «Previsto» de RECEITAS, em campo proprio", async () => {
  const d = duble(EU, {
    ...SEM_MYBANK,
    scheduled_transactions_effective: [],
    mybank_installment_interest: [JURO_DA_PARCELA, GELADEIRA_SEM_JURO],
  });

  const { corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=income&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  // R$ 50 de juro, e nao os R$ 1.300 das duas parcelas: o principal que volta e
  // transferencia (RN021.3).
  assert.equal(corpo.resumo.previsto, 50);
  assert.equal(corpo.resumo.total, 50);
  // CAMPO PROPRIO, e nao somado dentro de `reembolso_previsto`: somar os dois
  // no mesmo campo apagaria a medicao do credito de grupo e tiraria da tela a
  // frase que diz de onde vem cada parte. E a geladeira, sem juro, nao conta
  // nem como parcela nem como emprestimo.
  assert.deepEqual(corpo.resumo.a_receber_do_mybank, {
    total: 50,
    parcelas: 1,
    devedores: 1,
    emprestimos: 1,
  });
  assert.equal(corpo.resumo.reembolso_previsto, null);
  // E ele NAO e linha da lista: a parcela do Caso B nao existe em tabela de
  // dinheiro nenhuma do meu lado, e uma linha sintetica aqui ganharia os tres
  // botoes de `posso_editar` sobre um id que o banco nao tem.
  assert.equal(corpo.linhas.length, 0);
  assert.equal(corpo.resumo.realizado, 0, "promessa nunca entra no Realizado");
});

test("leitura 2: o juro que EU devo nao vira «a receber» -- a view e dos dois lados", async () => {
  // A Lais me emprestou. A linha da view e a mesma que ela le como credora, e
  // o `lender_user_id = eu` da consulta e o que a deixa fora daqui.
  const d = duble(EU, {
    ...SEM_MYBANK,
    scheduled_transactions_effective: [],
    mybank_installment_interest: [
      { ...JURO_DA_PARCELA, lender_user_id: A_LAIS, borrower_user_id: EU },
    ],
  });

  const { corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=income&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  assert.equal(corpo.resumo.a_receber_do_mybank, null);
  assert.equal(corpo.resumo.previsto, 0);
});

test("leitura 2: o AUTO-emprestimo nao vira «a receber» de mim mesmo", async () => {
  // O juro que eu pago a mim mesmo nao e receita: o dinheiro volta para a minha
  // conta de investimento.
  const d = duble(EU, {
    ...SEM_MYBANK,
    scheduled_transactions_effective: [],
    mybank_installment_interest: [{ ...JURO_DA_PARCELA, borrower_user_id: EU }],
  });

  const { corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=income&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  assert.equal(corpo.resumo.a_receber_do_mybank, null);
  assert.equal(corpo.resumo.previsto, 0);
});

test("leitura 2: a parcela `paid` nao conta como a receber, a `reported` conta", async () => {
  const comStatus = async (status) => {
    const d = duble(EU, {
      ...SEM_MYBANK,
      scheduled_transactions_effective: [],
      mybank_installment_interest: [{ ...JURO_DA_PARCELA, status }],
    });
    const { corpo } = await chamar(
      MOVIMENTACAO.GET,
      d,
      `http://t/api/movimentacoes/resumo?tipo=income&de=${HOJE}&ate=${FIM_DO_MES}`
    );
    return corpo.resumo.a_receber_do_mybank;
  };

  // `reported` CONTINUA contando: o devedor avisou e eu ainda nao confirmei --
  // o dinheiro ainda nao esta na minha conta de investimento. A convencao e a
  // da HMO-366.
  assert.equal((await comStatus("reported")).total, 50);
  assert.equal(await comStatus("paid"), null);
  assert.equal(await comStatus("cancelled"), null);

  // A REGRA e da funcao pura, e nao so do filtro da consulta: o juro pago ja e
  // receita realizada de quem emprestou (a perna `income` da confirmacao).
  assert.equal(
    LEITURAS.aReceberDoMyBank([{ ...JURO_DA_PARCELA, status: "paid" }], EU),
    null
  );
  assert.equal(
    LEITURAS.aReceberDoMyBank([{ ...JURO_DA_PARCELA, status: "reported" }], EU).total,
    50
  );
});

test("leitura 2: a parcela sem juro conhecido nao entra no «a receber»", () => {
  // `interest_amount` nulo e a serie cuja ultima parcela nao cabe a sobra (a
  // confirmacao tambem recusa ratear). Nulo, zero e negativo sao a mesma
  // resposta: nao ha juro para somar.
  for (const interest_amount of [null, "0.00", "-5.00"]) {
    assert.equal(
      LEITURAS.aReceberDoMyBank([{ ...JURO_DA_PARCELA, interest_amount }], EU),
      null,
      `interest_amount ${interest_amount}`
    );
  }
});

// =====================================================
// LEITURA 4 -- a aba Despesas do DEVEDOR (HMO-377 e fase 5)
// =====================================================
// A HMO-377 trouxe para esta aba a parcela que Contas a Pagar ja somava. Desde
// a fase 5 (RN021.3) a aba e a metade de Despesas do Resultado do mes, e da
// parcela so o JURO entra nela: o principal volta para quem emprestou, e isso
// e transferencia. Contas a Pagar continua com a parcela cheia (leitura 1b):
//
//   * Contas a Pagar  ....... R$ 1.200,00  (R$ 200 de luz + a parcela de R$ 1.000)
//   * aba Despesas .......... R$   250,00  (R$ 200 de luz + R$ 50 de juro)
//
// As duas telas respondem perguntas diferentes, e cada uma diz a sua: "quanto
// sai da conta" e "quanto o mes custou".
//
// O que a devedora tem: a conta de luz DELA (R$ 200) e o juro pela view.

/** O retrato da Lais: a luz e dela, e nao ha previsao de MyBank nenhuma. */
const COMO_A_LAIS_VE = {
  ...SEM_MYBANK,
  financial_accounts: [],
  scheduled_transactions_effective: [{ ...CONTA_DE_LUZ, user_id: A_LAIS }],
};

test("leitura 4: o JURO da parcela que a devedora deve aparece na aba Despesas -- R$ 200 vira R$ 250", async () => {
  const d = duble(A_LAIS, {
    ...COMO_A_LAIS_VE,
    mybank_installment_interest: [JURO_DA_PARCELA],
  });

  const { status, corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=expense&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  assert.equal(status, 200);

  // O NUMERO. R$ 250,00: a luz e o juro, e nao os R$ 1.200,00 de Contas a Pagar.
  assert.equal(corpo.resumo.previsto, 250);
  assert.equal(corpo.resumo.total, 250);
  assert.equal(corpo.resumo.realizado, 0, "nada foi pago: o juro e promessa");

  // E A CONTAGEM SOBE JUNTO, ao contrario do reembolso de grupo e do «a
  // receber» do MyBank: aqui a promessa VIRA linha, entao o contador e a lista
  // concordam.
  assert.equal(corpo.resumo.quantidadePrevista, 2);
  assert.equal(corpo.linhas.length, 2);

  const juro = corpo.linhas.find((l) => l.natureza === "mybank");
  assert.ok(juro, "o juro devido tem de estar na lista, com o selo");
  assert.equal(juro.valor, 50, "a string numeric(15,2) tem de virar numero");
  assert.equal(juro.tipo, "expense");
  assert.equal(juro.origem, "previsto");
  // O MESMO nome que `mybank_interest_entries` da ao juro pago: a linha nao
  // muda de nome no dia da baixa.
  assert.equal(juro.descricao, "Juros: Moto elétrica (3/24)");
  assert.equal(juro.data, VENCE_DIA_10);
  assert.equal(juro.situacao, "pending");

  // A CHAVE NAO E UM UUID, e isso e o que impede a acao de ir para a rota
  // errada: `mybank:<id>` nao passa por um `/api/scheduled-transactions/<uuid>`
  // plausivel. A linha tambem nao e `gravada`, e e isso que faz
  // `lib/acoes-da-linha.ts` recusar os tres botoes (regra 3).
  assert.equal(juro.gravada, false);
  assert.equal(juro.id, `mybank:${PARCELA_3_DE_24}`);
  assert.ok(
    !/^[0-9a-f-]{36}$/.test(juro.id),
    "a chave da linha nao pode ser um uuid nu: ela viraria uma URL de scheduled-transactions"
  );

  // E A LUZ NAO SE MEXEU.
  const luz = corpo.linhas.find((l) => l.descricao === "Luz");
  assert.ok(luz, "a conta de luz da devedora continua na lista");
  assert.equal(luz.valor, 200);
  assert.equal(luz.natureza, "despesa");
});

test("leitura 4: o juro entra UMA vez -- nao ha linha repetida nem valor dobrado", async () => {
  const d = duble(A_LAIS, {
    ...COMO_A_LAIS_VE,
    // A divida cheia tambem esta no fixture: Contas a Pagar a le, e a aba
    // Despesas nao pode soma-la junto do juro.
    mybank_due_entries: [DIVIDA_DA_LAIS],
    mybank_installment_interest: [JURO_DA_PARCELA],
  });

  const { corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=expense&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  const comAChave = corpo.linhas.filter((l) =>
    String(l.id ?? "").startsWith("mybank:")
  );
  assert.equal(comAChave.length, 1, "uma linha por parcela, nunca duas");
  assert.equal(corpo.resumo.previsto, 250);
  assert.ok(
    !d.lidas.some((l) => l.tabela === "mybank_due_entries"),
    "a aba Despesas nao le mais a divida cheia"
  );
});

test("leitura 4: o juro da devedora NAO vaza para Transferencias nem para Receitas", async () => {
  // O dinheiro sai da conta da devedora para a conta de OUTRA PESSOA -- dizer
  // "andou entre as suas contas" sobre ele seria uma frase falsa na tela.
  // `direction: 'expense'` em `parcelasDevidasNaAgenda` e o que decide. Em
  // Receitas a view tambem e lida (o lado de quem emprestou), e a linha da
  // devedora fica fora pelo `lender_user_id`.
  for (const tipo of ["transfer", "income"]) {
    const d = duble(A_LAIS, {
      ...COMO_A_LAIS_VE,
      scheduled_transactions_effective: [],
      mybank_installment_interest: [JURO_DA_PARCELA],
    });

    const { corpo } = await chamar(
      MOVIMENTACAO.GET,
      d,
      `http://t/api/movimentacoes/resumo?tipo=${tipo}&de=${HOJE}&ate=${FIM_DO_MES}`
    );

    assert.equal(corpo.linhas.length, 0, `o juro nao pode aparecer em ${tipo}`);
    assert.equal(corpo.resumo.previsto, 0, `nem somar no previsto de ${tipo}`);
    assert.equal(corpo.resumo.a_receber_do_mybank, null);
  }

  // Em Transferencias a rota nem consulta a view.
  const d = duble(A_LAIS, { ...COMO_A_LAIS_VE, mybank_installment_interest: [JURO_DA_PARCELA] });
  await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=transfer&de=${HOJE}&ate=${FIM_DO_MES}`
  );
  assert.ok(
    !d.lidas.some((l) => l.tabela === "mybank_installment_interest"),
    "a aba Transferencias nao tem o que fazer com o juro do MyBank"
  );
});

test("leitura 4: o RECORTE DE DATA vale -- o juro de abril nao entra na aba de marco", async () => {
  const d = duble(A_LAIS, {
    ...COMO_A_LAIS_VE,
    mybank_installment_interest: [
      JURO_DA_PARCELA,
      { ...JURO_DA_PARCELA, id: "parcela-de-abril", due_date: "2026-04-10" },
      { ...JURO_DA_PARCELA, id: "parcela-de-fevereiro", due_date: "2026-02-10" },
    ],
  });

  const { corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=expense&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  assert.equal(corpo.resumo.previsto, 250, "um juro so entra na janela");
  assert.equal(corpo.linhas.filter((l) => l.natureza === "mybank").length, 1);
});

test("leitura 4: o juro VENCIDO da devedora cai em «vencido», na aba Despesas", async () => {
  const d = duble(A_LAIS, {
    ...COMO_A_LAIS_VE,
    scheduled_transactions_effective: [],
    mybank_installment_interest: [{ ...JURO_DA_PARCELA, due_date: "2026-03-01" }],
  });

  const { corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=expense&de=2026-03-01&ate=${FIM_DO_MES}`
  );

  assert.equal(corpo.vencido.total, 50);
  assert.equal(corpo.vencido.quantidade, 1);
  assert.equal(corpo.linhas[0].situacao, "overdue");
});

test("leitura 4: o juro da parcela `paid` sai do previsto, o da `reported` fica", async () => {
  // `reported` CONTINUA APARECENDO, e isso e a convencao da HMO-366: "eu avisei
  // que paguei e o credor ainda nao confirmou" ainda e divida.
  const comStatus = async (status) => {
    const d = duble(A_LAIS, {
      ...COMO_A_LAIS_VE,
      mybank_installment_interest: [{ ...JURO_DA_PARCELA, status }],
    });
    const { corpo } = await chamar(
      MOVIMENTACAO.GET,
      d,
      `http://t/api/movimentacoes/resumo?tipo=expense&de=${HOJE}&ate=${FIM_DO_MES}`
    );
    return corpo;
  };

  assert.equal((await comStatus("paid")).resumo.previsto, 200, "paga: volta ao retrato");
  const avisada = await comStatus("reported");
  assert.equal(avisada.resumo.previsto, 250, "reported: continua divida");
  assert.equal(avisada.linhas.find((l) => l.natureza === "mybank").valor, 50);
});

test("leitura 4: a regra do juro devido -- so o meu lado, sem auto-emprestimo, ativo e com juro", () => {
  // A funcao pura, porque a consulta da rota ja filtra o lado e o status: o
  // filtro de la e tamanho de payload, e o daqui e a regra.
  const valida = { ...JURO_DA_PARCELA, id: "valida" };
  const linhas = LEITURAS.jurosDevidosNaAgenda(
    [
      valida,
      // O lado de quem emprestou: a mesma parcela, lida por mim como credor.
      { ...JURO_DA_PARCELA, id: "sou-o-credor", lender_user_id: A_LAIS, borrower_user_id: EU },
      // Um emprestimo entre duas outras pessoas. A RLS nao o entrega, e a regra
      // tambem nao o soma: a divida nao e minha.
      {
        ...JURO_DA_PARCELA,
        id: "de-terceiros",
        borrower_user_id: "33333333-3333-3333-3333-333333333333",
      },
      // O auto-emprestimo da Lais.
      { ...JURO_DA_PARCELA, id: "auto", lender_user_id: A_LAIS },
      // Emprestimo quitado.
      { ...JURO_DA_PARCELA, id: "quitado", loan_status: "settled" },
      // Parcela paga: o juro dela ja esta no realizado.
      { ...JURO_DA_PARCELA, id: "paga", status: "paid" },
      // Sem juro conhecido, ou sem juro.
      { ...JURO_DA_PARCELA, id: "nulo", interest_amount: null },
      { ...JURO_DA_PARCELA, id: "zero", interest_amount: "0.00" },
    ],
    A_LAIS,
    { de: HOJE, ate: FIM_DO_MES },
    HOJE
  );

  assert.deepEqual(
    linhas.map((l) => l.mybank_installment_id),
    ["valida"]
  );
  assert.equal(linhas[0].amount, 50);
  assert.equal(linhas[0].description, "Juros: Moto elétrica (3/24)");
  assert.equal(linhas[0].notes, `mybank:valida`);
  assert.equal(linhas[0].direction, "expense");
});

// =====================================================
// LEITURA 5 -- o juro PAGO no Realizado de quem pegou (fase 5)
// =====================================================
// Quem pegou nao grava transacao nenhuma quando quem emprestou confirma: as
// duas pernas sao de quem emprestou. O juro pago chega pela view
// `mybank_interest_entries` (071), na data do pagamento.

const PARCELA_2_DE_24 = "cccccccc-0000-0000-0000-000000000002";

/** O que `mybank_interest_entries` devolve para a Lais: o juro da 2/24, pago dia 4. */
const JURO_PAGO_DA_LAIS = {
  id: PARCELA_2_DE_24,
  user_id: A_LAIS,
  amount: "50.00",
  transaction_type: "expense",
  currency: "BRL",
  category_id: "6d9b6e69-43bc-485c-9bbb-d343286d1172",
  transaction_date: "2026-03-04",
  descricao: "Juros: Moto elétrica (2/24)",
};

test("leitura 5: o juro PAGO entra no Realizado de Despesas da devedora, com o selo", async () => {
  const d = duble(A_LAIS, {
    ...COMO_A_LAIS_VE,
    mybank_interest_entries: [
      JURO_PAGO_DA_LAIS,
      // Fora da janela: pago em fevereiro.
      { ...JURO_PAGO_DA_LAIS, id: "pago-em-fevereiro", transaction_date: "2026-02-04" },
    ],
  });

  const { status, corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=expense&de=2026-03-01&ate=${FIM_DO_MES}`
  );

  assert.equal(status, 200);
  assert.equal(corpo.resumo.realizado, 50);
  assert.equal(corpo.resumo.previsto, 200);

  const juro = corpo.linhas.find((l) => l.origem === "realizado");
  assert.ok(juro, "o juro pago tem de estar na lista");
  assert.equal(juro.valor, 50);
  assert.equal(juro.descricao, "Juros: Moto elétrica (2/24)");
  assert.equal(juro.data, "2026-03-04");
  assert.equal(juro.natureza, "mybank");
  assert.equal(juro.id, `juros-do-mybank:${PARCELA_2_DE_24}`);
  // Sem botao: o juro pago nao e transacao da devedora.
  assert.equal(juro.posso_editar, false);
});

test("leitura 5: o juro pago so entra em Despesas", async () => {
  for (const tipo of ["income", "transfer"]) {
    const d = duble(A_LAIS, {
      ...COMO_A_LAIS_VE,
      scheduled_transactions_effective: [],
      mybank_interest_entries: [JURO_PAGO_DA_LAIS],
    });
    const { corpo } = await chamar(
      MOVIMENTACAO.GET,
      d,
      `http://t/api/movimentacoes/resumo?tipo=${tipo}&de=2026-03-01&ate=${FIM_DO_MES}`
    );
    assert.equal(corpo.resumo.realizado, 0, `o juro pago nao pertence a aba ${tipo}`);
    assert.equal(corpo.linhas.length, 0);
  }
});

test("leitura 5: erro de verdade no juro pago e 500; a view que ainda nao existe segue sem ele", async () => {
  const comErro = async (erro) => {
    const d = criarDuble({
      user: { id: A_LAIS },
      tabelas: { ...COMO_A_LAIS_VE },
      erros: { mybank_interest_entries: erro },
    });
    return chamar(
      MOVIMENTACAO.GET,
      d,
      `http://t/api/movimentacoes/resumo?tipo=expense&de=${HOJE}&ate=${FIM_DO_MES}`
    );
  };

  // Um realizado menor sem aviso e o pior dos dois.
  assert.equal((await comErro({ code: "XX000", message: "falhou" })).status, 500);

  // A janela entre o deploy e a colagem da 071: o comportamento de antes.
  for (const code of ["42P01", "PGRST205"]) {
    const { status, corpo } = await comErro({ code, message: "nao existe" });
    assert.equal(status, 200, code);
    assert.equal(corpo.resumo.previsto, 200, code);
    assert.equal(corpo.resumo.realizado, 0, code);
  }
});

test("leitura 5: a view do juro devido que ainda nao existe deixa a aba como antes", async () => {
  const d = criarDuble({
    user: { id: A_LAIS },
    tabelas: { ...COMO_A_LAIS_VE },
    erros: { mybank_installment_interest: { code: "42P01", message: "nao existe" } },
  });
  const { status, corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=expense&de=${HOJE}&ate=${FIM_DO_MES}`
  );
  assert.equal(status, 200);
  assert.equal(corpo.resumo.previsto, 200);
});

test("leitura 5: jurosPagosComoRealizados poe o sinal de despesa e a chave do selo", () => {
  const [linha, ...resto] = LEITURAS.jurosPagosComoRealizados([
    JURO_PAGO_DA_LAIS,
    // So `expense` vira linha, e valor zero nao.
    { ...JURO_PAGO_DA_LAIS, id: "receita", transaction_type: "income" },
    { ...JURO_PAGO_DA_LAIS, id: "zero", amount: "0.00" },
  ]);

  assert.equal(resto.length, 0);
  assert.equal(linha.amount, -50);
  assert.equal(linha.transaction_type, "expense");
  assert.equal(linha.notes, `mybank:${PARCELA_2_DE_24}`);
  assert.equal(linha.selo, "MyBank");
  assert.equal(linha.category.name, "Juros do MyBank");
  assert.equal(linha.id, `juros-do-mybank:${PARCELA_2_DE_24}`);
});

// =====================================================
// LEITURA 3 -- posso gastar?
// =====================================================

test("leitura 3: a parcela que EU devo reduz o disponivel em exatamente R$ 1.000", async () => {
  const semParcela = duble(A_LAIS, {
    ...SEM_MYBANK,
    financial_accounts: CONTAS.map((c) => ({ ...c, user_id: A_LAIS })),
    scheduled_transactions_effective: [],
  });
  const comParcela = duble(A_LAIS, {
    ...SEM_MYBANK,
    financial_accounts: CONTAS.map((c) => ({ ...c, user_id: A_LAIS })),
    scheduled_transactions_effective: [],
    mybank_due_entries: [DIVIDA_DA_LAIS],
  });

  const antes = await chamar(POSSO_GASTAR.GET, semParcela);
  const depois = await chamar(POSSO_GASTAR.GET, comParcela);

  assert.equal(antes.status, 200);
  assert.equal(depois.status, 200);

  // A DIFERENCA e o numero medido, e nao o valor absoluto: o absoluto depende do
  // saldo, das metas e das faturas do fixture, e um teste sobre ele reprovaria
  // no dia em que qualquer uma das tres mudasse sem a feature ter mudado.
  assert.equal(
    antes.corpo.safe_to_spend.compromissos + 1000,
    depois.corpo.safe_to_spend.compromissos
  );
  assert.equal(
    antes.corpo.safe_to_spend.livre - 1000,
    depois.corpo.safe_to_spend.livre
  );
});

test("leitura 3: a parcela A RECEBER nao aumenta o disponivel do credor", async () => {
  // O credor nao tem linha nenhuma: `previsoesDoEmprestimo` devolve `[]` no
  // Caso B. Esta assercao e a que impede o «a receber» de Receitas de vazar
  // para ca -- promessa nao e dinheiro, e a HMO-364 decidiu explicitamente nao
  // reverter a direcao da HMO-306/308.
  const semEmprestimo = duble(EU, SEM_MYBANK);
  const comEmprestimo = duble(EU, {
    ...SEM_MYBANK,
    mybank_loans: [{ id: EMPRESTIMO_DA_MOTO, borrower_user_id: A_LAIS, lender_user_id: EU, status: "active" }],
    mybank_installments: [
      { id: PARCELA_3_DE_24, loan_id: EMPRESTIMO_DA_MOTO, amount: "1000.00", due_date: VENCE_DIA_10, status: "pending" },
    ],
  });

  const antes = await chamar(POSSO_GASTAR.GET, semEmprestimo);
  const depois = await chamar(POSSO_GASTAR.GET, comEmprestimo);

  assert.equal(
    antes.corpo.safe_to_spend.livre,
    depois.corpo.safe_to_spend.livre,
    "emprestar nao pode aumentar o quanto eu posso gastar"
  );
  assert.equal(
    antes.corpo.safe_to_spend.receitasPrevistas,
    depois.corpo.safe_to_spend.receitasPrevistas
  );
});

test("leitura 3: a parcela do auto-emprestimo desconta UMA vez, pela previsao", async () => {
  // O Caso A ja descontava antes desta issue -- `direcaoDaAgenda('transfer')`
  // devolve 'expense' (HMO-303). O que esta assercao protege e o "uma vez": se
  // a view passasse a devolver o auto-emprestimo, ele seria descontado duas.
  const so = duble(EU, {
    ...SEM_MYBANK,
    scheduled_transactions_effective: [PARCELA_DO_AUTO_EMPRESTIMO],
  });
  const vazio = duble(EU, { ...SEM_MYBANK, scheduled_transactions_effective: [] });

  const antes = await chamar(POSSO_GASTAR.GET, vazio);
  const depois = await chamar(POSSO_GASTAR.GET, so);

  assert.equal(
    antes.corpo.safe_to_spend.compromissos + 1000,
    depois.corpo.safe_to_spend.compromissos
  );
});

test("leitura 3: a parcela VENCIDA do mes passado continua descontando -- sem piso de data", async () => {
  // Com piso em `hoje`, a parcela desapareceria do calculo no dia seguinte ao
  // vencimento e o disponivel SUBIRIA por ela estar atrasada. E a mesma decisao
  // que a consulta das previstas desta rota ja toma.
  const d = duble(A_LAIS, {
    ...SEM_MYBANK,
    financial_accounts: CONTAS.map((c) => ({ ...c, user_id: A_LAIS })),
    scheduled_transactions_effective: [],
    mybank_due_entries: [{ ...DIVIDA_DA_LAIS, due_date: "2026-02-10" }],
  });
  const vazio = duble(A_LAIS, {
    ...SEM_MYBANK,
    financial_accounts: CONTAS.map((c) => ({ ...c, user_id: A_LAIS })),
    scheduled_transactions_effective: [],
  });

  const antes = await chamar(POSSO_GASTAR.GET, vazio);
  const depois = await chamar(POSSO_GASTAR.GET, d);

  assert.equal(
    antes.corpo.safe_to_spend.compromissos + 1000,
    depois.corpo.safe_to_spend.compromissos
  );
  assert.equal(depois.corpo.safe_to_spend.compromissosVencidos, 1000);
});

test("leitura 3: a parcela do mes QUE VEM nao desconta deste mes", async () => {
  // O teto existe: `fimDoMes(hoje)`. Sem ele o "posso gastar" de marco
  // descontaria as 24 parcelas do emprestimo inteiro.
  const d = duble(A_LAIS, {
    ...SEM_MYBANK,
    financial_accounts: CONTAS.map((c) => ({ ...c, user_id: A_LAIS })),
    scheduled_transactions_effective: [],
    mybank_due_entries: [{ ...DIVIDA_DA_LAIS, due_date: "2026-04-10" }],
  });
  const vazio = duble(A_LAIS, {
    ...SEM_MYBANK,
    financial_accounts: CONTAS.map((c) => ({ ...c, user_id: A_LAIS })),
    scheduled_transactions_effective: [],
  });

  const antes = await chamar(POSSO_GASTAR.GET, vazio);
  const depois = await chamar(POSSO_GASTAR.GET, d);

  assert.equal(
    antes.corpo.safe_to_spend.compromissos,
    depois.corpo.safe_to_spend.compromissos
  );
});

// =====================================================
// O ELO, E AS DUAS COPIAS DO PREFIXO
// =====================================================

test("o prefixo do elo nao divergiu entre a F2 e a lista da tela", () => {
  // `lib/telas-de-movimentacao.ts` repete a string `mybank:` em vez de importar
  // `chaveDaParcelaDoMyBank` -- o cabecalho de lá explica por que (o `rootDir`
  // das suites que compilam aquele modulo). Esta e a assercao que impede as
  // duas copias de divergirem: se o prefixo mudar na F2, isto reprova.
  assert.ok(
    EMPRESTIMO.chaveDaParcelaDoMyBank("x").startsWith(TELAS.PREFIXO_DO_ELO_DO_MYBANK)
  );
  assert.equal(TELAS.PREFIXO_DO_ELO_DO_MYBANK, "mybank:");
});

test("uma nota que CITA `mybank:` no meio da frase nao e o elo", () => {
  // `guard-de-includes-casa-dentro-de-identificador-maior`: o criterio e
  // `startsWith`, e o elo e sempre o comeco da string porque
  // `chaveDaParcelaDoMyBank` o constroi com template.
  assert.equal(
    TELAS.ehParcelaDoAutoEmprestimo({
      direction: "transfer",
      notes: "paguei fora do mybank: em dinheiro",
    }),
    false
  );
  assert.equal(
    TELAS.ehParcelaDoAutoEmprestimo({ direction: "transfer", notes: "mybank:abc" }),
    true
  );
  // O `transaction_type` e obrigatorio: sem ele, uma previsao de RECEITA
  // anotada com a palavra entraria na aba Despesas.
  assert.equal(
    TELAS.ehParcelaDoAutoEmprestimo({ direction: "income", notes: "mybank:abc" }),
    false
  );
  assert.equal(
    TELAS.ehParcelaDoAutoEmprestimo({ direction: "expense", notes: "mybank:abc" }),
    false
  );
});

test("o recorte de data da funcao pura aceita `de: null` e nunca passa do teto", () => {
  const parcelas = [
    { ...DIVIDA_DA_LAIS, id: "fev", due_date: "2026-02-10" },
    { ...DIVIDA_DA_LAIS, id: "mar", due_date: "2026-03-10" },
    { ...DIVIDA_DA_LAIS, id: "abr", due_date: "2026-04-10" },
  ];

  assert.deepEqual(
    LEITURAS.parcelasDevidasNoPeriodo(parcelas, { de: null, ate: FIM_DO_MES }).map((p) => p.id),
    ["fev", "mar"]
  );
  assert.deepEqual(
    LEITURAS.parcelasDevidasNoPeriodo(parcelas, { de: "2026-03-01", ate: FIM_DO_MES }).map((p) => p.id),
    ["mar"]
  );
  // O dia do vencimento PERTENCE ao periodo que termina nele -- `<=`, igual ao
  // `.lte` das quatro rotas.
  assert.equal(
    LEITURAS.parcelasDevidasNoPeriodo(parcelas, { de: null, ate: "2026-02-10" }).length,
    1
  );
});

test("a linha da agenda carrega os DOIS status: o de dinheiro e o da tela", () => {
  // HMO-386. A linha da agenda e a dona da parcela em Contas a Pagar desde que
  // o bloco do devedor saiu daquela tela, e o gesto dela ("avisar que paguei")
  // precisa saber se a pessoa JA avisou. O `status` nao pode responder isso: ele
  // e o campo de DINHEIRO e vale `'pending'` nos dois casos de proposito --
  // `reported` ainda e divida, e mapea-lo para outra coisa aqui faria o «A
  // vencer» descer no instante do clique do devedor (a convencao da HMO-366,
  // afirmada em "a parcela `reported` continua divida" acima).
  //
  // Entao `mybank_status` existe ao lado dele. SEM ESTA ASSERCAO o campo e
  // invisivel para a suite: um `mybank_status: "pending"` fixo passaria tudo o
  // que ja estava escrito, e o sintoma na tela seria o botao "Avisar que
  // paguei" oferecido a quem ja avisou -- o segundo PATCH responde 200 sem
  // mudar nada, entao o botao parece funcionar e nao faz diferenca nenhuma.
  const [pendente] = LEITURAS.parcelasDevidasNaAgenda([DIVIDA_DA_LAIS], HOJE);
  const [avisada] = LEITURAS.parcelasDevidasNaAgenda(
    [{ ...DIVIDA_DA_LAIS, status: "reported", reported_at: "2026-03-06" }],
    HOJE
  );

  // O CAMPO DE DINHEIRO: igual nos dois. E o que impede o botao do devedor de
  // pagar a conta dele.
  assert.equal(pendente.status, "pending");
  assert.equal(avisada.status, "pending");

  // O CAMPO DA TELA: diferente nos dois. E a unica diferenca entre as duas
  // linhas, e e ela que o gesto le.
  assert.equal(pendente.mybank_status, "pending");
  assert.equal(avisada.mybank_status, "reported");
});

test("leitura da agenda: a parcela VENCIDA sai `overdue` no `effective_status`, ao lado do `my_effective_status`", () => {
  // `effective_status` e o que a tela de Contas Previstas le para destacar o
  // atraso (`conta.effective_status === "overdue"`). As leituras 1b e 4 acima
  // passam pelas rotas, que leem o par `my_*` -- sem esta assercao, um
  // `effective_status: "pending"` fixo passaria a suite inteira e a parcela
  // atrasada do MyBank perderia o destaque so naquela tela.
  const [vencida] = LEITURAS.parcelasDevidasNaAgenda(
    [{ ...DIVIDA_DA_LAIS, due_date: "2026-03-01" }],
    HOJE
  );
  const [aVencer] = LEITURAS.parcelasDevidasNaAgenda([DIVIDA_DA_LAIS], HOJE);

  assert.equal(vencida.effective_status, "overdue");
  assert.equal(vencida.my_effective_status, "overdue");
  assert.equal(aVencer.effective_status, "pending");
  assert.equal(aVencer.my_effective_status, "pending");
});
