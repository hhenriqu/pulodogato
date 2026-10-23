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
// Dois lados da mesma moto de R$ 24.000 em 24x de R$ 1.000:
//
//   * CASO A -- eu pego emprestado da MINHA conta de investimento. A parcela e
//     uma transferencia prevista em `scheduled_transactions` (R$ 1.000, dia 10),
//     e ela tem de aparecer UMA vez em Contas a Pagar, UMA vez no «A vencer»,
//     UMA vez no «Previsto» da aba Despesas, e descontar R$ 1.000 do
//     safe-to-spend;
//   * CASO B -- eu emprestei para a Lais. No MEU lado: nada em tabela de
//     dinheiro, R$ 1.000 no «Previsto» de Receitas (decisao 2) e ZERO de
//     desconto no safe-to-spend. No lado DELA: R$ 1.000 em Contas a Pagar pela
//     view, e R$ 1.000 descontados do safe-to-spend dela.
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
});

test("controle negativo 4/4: o «Previsto» de Despesas da conta sem MyBank continua R$ 200,00", async () => {
  const d = duble(EU, SEM_MYBANK);
  const { corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=expense&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  assert.equal(corpo.resumo.previsto, 200);
  assert.equal(corpo.linhas.length, 1);
  assert.equal(corpo.linhas[0].natureza, "despesa");
  assert.equal(corpo.resumo.a_receber_do_mybank, null);
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

test("leitura 2: o auto-emprestimo entra no «Previsto» de DESPESAS, com o selo", async () => {
  // A decisao 1 da HMO-368: a parcela e `transfer` na coluna (e so assim o
  // «Total de contas» fica certo) e APARECE em Despesas (porque no dia 10 saem
  // R$ 1.000 da conta corrente). Sem `ehParcelaDoAutoEmprestimo` a peneira
  // `linha.tipo === tipo` a manda so para a aba Transferencias.
  const d = duble(EU, {
    ...SEM_MYBANK,
    scheduled_transactions_effective: [CONTA_DE_LUZ, PARCELA_DO_AUTO_EMPRESTIMO],
  });

  const { corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=expense&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  // R$ 1.200,00 contra os R$ 200,00 do retrato.
  assert.equal(corpo.resumo.previsto, 1200);

  const doMyBank = corpo.linhas.filter((l) => l.natureza === "mybank");
  assert.equal(doMyBank.length, 1, "uma linha, nao duas");
  assert.equal(doMyBank[0].valor, 1000);
  assert.equal(doMyBank[0].tipo, "expense");
  assert.equal(doMyBank[0].gravada, true, "ela e uma previsao de verdade, e clicavel");
});

test("leitura 2: a MESMA parcela continua na aba Transferencias", async () => {
  // Tira-la de Transferencias esconderia uma transferencia de verdade, que e o
  // que aquela aba existe para listar. O «Total» de cada aba e o da propria
  // aba, entao nao ha numero em que ela entre duas vezes.
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

test("leitura 2: o «a receber» da conexao entra no «Previsto» de RECEITAS, em campo proprio", async () => {
  const d = duble(EU, {
    ...SEM_MYBANK,
    scheduled_transactions_effective: [],
    mybank_loans: [{ id: EMPRESTIMO_DA_MOTO, borrower_user_id: A_LAIS, lender_user_id: EU, status: "active" }],
    mybank_installments: [
      {
        id: PARCELA_3_DE_24,
        loan_id: EMPRESTIMO_DA_MOTO,
        amount: "1000.00",
        due_date: VENCE_DIA_10,
        status: "pending",
      },
    ],
  });

  const { corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=income&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  assert.equal(corpo.resumo.previsto, 1000);
  assert.equal(corpo.resumo.total, 1000);
  // CAMPO PROPRIO, e nao somado dentro de `reembolso_previsto`: somar os dois
  // no mesmo campo apagaria a medicao do credito de grupo e tiraria da tela a
  // frase que diz de onde vem cada parte.
  assert.deepEqual(corpo.resumo.a_receber_do_mybank, {
    total: 1000,
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

test("leitura 2: o AUTO-emprestimo nao vira «a receber» de mim mesmo", async () => {
  // O auto-emprestimo ja esta no «Previsto» de DESPESAS. Devolve-lo aqui poria o
  // mesmo dinheiro nos dois lados do mesmo mes: o resultado previsto fecharia
  // em zero e nenhuma das duas linhas estaria errada sozinha.
  const d = duble(EU, {
    ...SEM_MYBANK,
    scheduled_transactions_effective: [],
    mybank_loans: [{ id: EMPRESTIMO_DA_MOTO, borrower_user_id: EU, lender_user_id: EU, status: "active" }],
    mybank_installments: [
      {
        id: PARCELA_3_DE_24,
        loan_id: EMPRESTIMO_DA_MOTO,
        amount: "1000.00",
        due_date: VENCE_DIA_10,
        status: "pending",
      },
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

test("leitura 2: a parcela `paid` nao conta como a receber, a `reported` conta", async () => {
  const comStatus = async (status) => {
    const d = duble(EU, {
      ...SEM_MYBANK,
      scheduled_transactions_effective: [],
      mybank_loans: [{ id: EMPRESTIMO_DA_MOTO, borrower_user_id: A_LAIS, lender_user_id: EU, status: "active" }],
      mybank_installments: [
        { id: PARCELA_3_DE_24, loan_id: EMPRESTIMO_DA_MOTO, amount: "1000.00", due_date: VENCE_DIA_10, status },
      ],
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
  assert.equal((await comStatus("reported")).total, 1000);
  assert.equal(await comStatus("paid"), null);
  assert.equal(await comStatus("cancelled"), null);
});

// =====================================================
// LEITURA 4 -- a aba Despesas do DEVEDOR (HMO-377)
// =====================================================
// A leitura que a HMO-372 deixou de fora de proposito, e que esta issue liga.
//
// O NUMERO MEDIDO NA main 40c7b01, do lado da Lais, no MESMO periodo:
//
//   * Contas a Pagar  ....... R$ 1.200,00  (R$ 200 de luz + a parcela de R$ 1.000)
//   * aba Despesas .......... R$   200,00  (uma linha so, a de luz)
//
// Duas telas do mesmo app, dois numeros para a MESMA divida, e nada na tela
// dizendo por que -- a familia `despesa-de-grupo-tem-tres-convencoes`. Depois
// desta issue as duas dizem R$ 1.200,00.
//
// O que a devedora tem: a conta de luz DELA (R$ 200) e a parcela pela view.

/** O retrato da Lais: a luz e dela, e nao ha previsao de MyBank nenhuma. */
const COMO_A_LAIS_VE = {
  ...SEM_MYBANK,
  financial_accounts: [],
  scheduled_transactions_effective: [{ ...CONTA_DE_LUZ, user_id: A_LAIS }],
};

test("leitura 4: a parcela que a devedora DEVE aparece na aba Despesas -- R$ 200 vira R$ 1.200", async () => {
  const d = duble(A_LAIS, {
    ...COMO_A_LAIS_VE,
    mybank_due_entries: [DIVIDA_DA_LAIS],
  });

  const { status, corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=expense&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  assert.equal(status, 200);

  // O NUMERO. R$ 1.200,00 contra os R$ 200,00 que esta mesma aba respondia
  // antes -- e os R$ 1.200,00 com que Contas a Pagar ja concordava (leitura 1b).
  assert.equal(corpo.resumo.previsto, 1200);
  assert.equal(corpo.resumo.total, 1200);
  assert.equal(corpo.resumo.realizado, 0, "nada foi pago: a parcela e promessa");

  // E A CONTAGEM SOBE JUNTO, ao contrario do reembolso de grupo e do «a
  // receber» do MyBank: ali a promessa NAO vira linha e `quantidadePrevista`
  // nao podia subir (a frase "N lançamento(s)" prometeria uma linha que a lista
  // nao tem). Aqui ela VIRA linha, entao o contador e a lista concordam.
  assert.equal(corpo.resumo.quantidadePrevista, 2);
  assert.equal(corpo.linhas.length, 2);

  const parcela = corpo.linhas.find((l) => l.natureza === "mybank");
  assert.ok(parcela, "a parcela devida tem de estar na lista, com o selo");
  assert.equal(parcela.valor, 1000, "a string numeric(15,2) tem de virar numero");
  assert.equal(parcela.tipo, "expense");
  assert.equal(parcela.origem, "previsto");
  assert.equal(parcela.descricao, "Moto elétrica");
  assert.equal(parcela.data, VENCE_DIA_10);
  assert.equal(parcela.situacao, "pending");

  // A CHAVE NAO E UM UUID, e isso e o que impede a acao de ir para a rota
  // errada: `mybank:<id>` nao passa por um `/api/scheduled-transactions/<uuid>`
  // plausivel. A linha tambem nao e `gravada`, e e isso que faz
  // `lib/acoes-da-linha.ts` recusar os tres botoes (regra 3) -- a assercao sobre
  // a recusa em si mora em scripts/test-acoes-da-linha.mjs, que e quem compila
  // aquele modulo.
  assert.equal(parcela.gravada, false);
  assert.equal(parcela.id, `mybank:${PARCELA_3_DE_24}`);
  assert.ok(
    !/^[0-9a-f-]{36}$/.test(parcela.id),
    "a chave da linha nao pode ser um uuid nu: ela viraria uma URL de scheduled-transactions"
  );

  // E A LUZ NAO SE MEXEU. Sem esta assercao, um defeito que trocasse a conta de
  // luz pela parcela (em vez de acrescenta-la) daria os mesmos R$ 1.200 se os
  // valores coincidissem -- e daria 1 linha, nao 2.
  const luz = corpo.linhas.find((l) => l.descricao === "Luz");
  assert.ok(luz, "a conta de luz da devedora continua na lista");
  assert.equal(luz.valor, 200);
  assert.equal(luz.natureza, "despesa");
});

test("leitura 4: a parcela entra UMA vez -- nao ha linha repetida nem valor dobrado", async () => {
  // O CONTROLE QUE IMPORTA, dito pela issue: "a parcela nao pode passar a ser
  // contada DUAS vezes". Ha dois jeitos de ela dobrar, e os dois estao medidos:
  //
  //   * a MESMA fonte entrando duas vezes na lista (duas linhas de R$ 1.000);
  //   * as DUAS fontes casando na mesma parcela -- a view E uma previsao em
  //     `scheduled_transactions` com a mesma chave `mybank:<id>`. E esse o
  //     cenario deste caso: o fixture poe as DUAS, que e o estado que a view
  //     impede no banco (`borrower IS DISTINCT FROM lender`, 053) e que um
  //     `CREATE OR REPLACE VIEW` descuidado reabriria.
  const d = duble(A_LAIS, {
    ...COMO_A_LAIS_VE,
    mybank_due_entries: [DIVIDA_DA_LAIS],
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

  // A SOMA E O SEGUNDO LADO DA MESMA PERGUNTA, e ela nao e redundante com a
  // contagem: `csv-nao-agrega-filtro-perdido-vira-linha-repetida` -- o total
  // pode fechar com a lista dobrada se a soma vier de outro lugar, e a lista
  // pode dobrar com o total certo. As duas assercoes juntas fecham os dois.
  assert.equal(corpo.resumo.previsto, 1200);
});

test("leitura 4: a parcela da devedora NAO vaza para Transferencias nem para Receitas", async () => {
  // A DIFERENCA COM O CASO A, e ela e deliberada. A parcela do auto-emprestimo
  // aparece nas DUAS abas (Despesas e Transferencias) porque ela E uma
  // transferencia: o dinheiro vai da minha corrente para a MINHA conta de
  // investimento. Esta aqui sai da conta da devedora para a conta de OUTRA
  // PESSOA -- dizer "andou entre as suas contas" sobre ela seria uma frase
  // falsa na tela. `direction: 'expense'` em `parcelasDevidasNaAgenda` e o que
  // decide, e nenhuma excecao de aba e aberta para ela.
  for (const tipo of ["transfer", "income"]) {
    const d = duble(A_LAIS, {
      ...COMO_A_LAIS_VE,
      scheduled_transactions_effective: [],
      mybank_due_entries: [DIVIDA_DA_LAIS],
    });

    const { corpo } = await chamar(
      MOVIMENTACAO.GET,
      d,
      `http://t/api/movimentacoes/resumo?tipo=${tipo}&de=${HOJE}&ate=${FIM_DO_MES}`
    );

    assert.equal(corpo.linhas.length, 0, `a parcela nao pode aparecer em ${tipo}`);
    assert.equal(corpo.resumo.previsto, 0, `nem somar no previsto de ${tipo}`);

    // E A ROTA NEM CONSULTOU A VIEW nessas duas abas: a leitura e guardada por
    // `tela.tipo === "expense"`. Sem esta assercao, uma versao que consultasse
    // sempre e descartasse depois passaria igual -- e gastaria uma consulta por
    // leitura de Receitas em toda sessao do app.
    assert.ok(
      !d.lidas.some((l) => l.tabela === "mybank_due_entries"),
      `a aba ${tipo} nao tem o que fazer com a divida do MyBank: nao deve consultar a view`
    );
  }
});

test("leitura 4: o RECORTE DE DATA vale -- a parcela de abril nao entra na aba de marco", async () => {
  // `leitura-sem-recorte-de-data-soma-o-horizonte`: a view e a divida INTEIRA
  // (24 parcelas de R$ 1.000). Sem o recorte, o «Previsto» de marco somaria os
  // R$ 24.000 do emprestimo todo. As DUAS pontas da janela vao na chamada --
  // diferente do safe-to-spend, que passa `de: null` de proposito.
  const d = duble(A_LAIS, {
    ...COMO_A_LAIS_VE,
    mybank_due_entries: [
      DIVIDA_DA_LAIS,
      { ...DIVIDA_DA_LAIS, id: "parcela-de-abril", due_date: "2026-04-10" },
      { ...DIVIDA_DA_LAIS, id: "parcela-de-fevereiro", due_date: "2026-02-10" },
    ],
  });

  const { corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=expense&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  assert.equal(corpo.resumo.previsto, 1200, "uma parcela so entra na janela");
  assert.equal(
    corpo.linhas.filter((l) => l.natureza === "mybank").length,
    1
  );
});

test("leitura 4: a parcela VENCIDA da devedora cai em «vencido», na aba Despesas", async () => {
  // O mesmo `CASE` da 027 chegando ate a tela: `pending` com vencimento antes
  // de hoje e `overdue`, e `previstoVencido` e quem separa os dois baldes. Sem
  // isso a parcela atrasada ficaria em "ainda vai vencer" -- e a aba Despesas e
  // onde a pessoa abre para ver o que esta atrasado.
  const d = duble(A_LAIS, {
    ...COMO_A_LAIS_VE,
    scheduled_transactions_effective: [],
    mybank_due_entries: [{ ...DIVIDA_DA_LAIS, due_date: "2026-03-01" }],
  });

  const { corpo } = await chamar(
    MOVIMENTACAO.GET,
    d,
    `http://t/api/movimentacoes/resumo?tipo=expense&de=2026-03-01&ate=${FIM_DO_MES}`
  );

  assert.equal(corpo.vencido.total, 1000);
  assert.equal(corpo.vencido.quantidade, 1);
  assert.equal(corpo.linhas[0].situacao, "overdue");
});

test("leitura 4: a parcela `paid` nao aparece na aba Despesas", async () => {
  // A view so devolve `pending`/`reported` (053), entao o fixture modela isso: a
  // parcela paga simplesmente NAO vem. O caso existe porque a direcao do erro
  // importa -- uma parcela paga na lista de "o que ainda vence" e uma divida
  // cobrada duas vezes.
  //
  // `reported` CONTINUA APARECENDO, e isso e a convencao da HMO-366: "eu avisei
  // que paguei e o credor ainda nao confirmou" ainda e divida. Mapear `reported`
  // para fora faria o «Previsto» descer no clique do devedor -- um botao que
  // paga a conta.
  const paga = duble(A_LAIS, { ...COMO_A_LAIS_VE, mybank_due_entries: [] });
  const avisada = duble(A_LAIS, {
    ...COMO_A_LAIS_VE,
    mybank_due_entries: [
      { ...DIVIDA_DA_LAIS, status: "reported", reported_at: "2026-03-06" },
    ],
  });

  const comPaga = await chamar(
    MOVIMENTACAO.GET,
    paga,
    `http://t/api/movimentacoes/resumo?tipo=expense&de=${HOJE}&ate=${FIM_DO_MES}`
  );
  const comAvisada = await chamar(
    MOVIMENTACAO.GET,
    avisada,
    `http://t/api/movimentacoes/resumo?tipo=expense&de=${HOJE}&ate=${FIM_DO_MES}`
  );

  assert.equal(comPaga.corpo.resumo.previsto, 200, "paga: volta ao retrato");
  assert.equal(comAvisada.corpo.resumo.previsto, 1200, "reported: continua divida");
  assert.equal(
    comAvisada.corpo.linhas.find((l) => l.natureza === "mybank").valor,
    1000
  );
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
