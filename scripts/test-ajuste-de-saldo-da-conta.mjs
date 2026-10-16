#!/usr/bin/env node
// =====================================================
// PULODOGATO - o ajuste de saldo tambem para contas (HMO-409)
// =====================================================
//   npm run test:ajuste-de-saldo-da-conta
//
// O QUE ESTA FEATURE REUSA, E O QUE E NOVO
// ----------------------------------------
// O ajuste de saldo existe desde a HMO-253 e e so do cartao. A FORMA dele e a
// certa e se mantem: a pessoa digita o saldo REAL que o banco mostra, o
// servidor deriva a diferenca e a direcao, e salvar duas vezes SUBSTITUI o
// ajuste em vez de empilhar. A aritmetica e a MESMA funcao -- esta suite nao a
// remede: `npm run test:ajuste-de-fatura` ja tem 25 mutantes em cima dela.
//
// O QUE E NOVO SAO CINCO DECISOES, e as cinco erram calado:
//
//   1. O SINAL NAO SE INVERTE. No cartao, `amount = -valorNaFatura`, porque a
//      view publica `(-t.amount) AS invoice_amount`. Na conta, o trigger
//      `update_account_balance` soma a COLUNA CRUA em `current_balance`, entao
//      `amount` E a diferenca. Copiar a inversao do cartao afastaria o saldo do
//      banco pelo DOBRO da diferenca -- com o numero certo na tela de previa.
//
//   2. A BASE SUBTRAI o ajuste existente, enquanto a do cartao SOMA (pelo mesmo
//      motivo: a view inverte, o trigger nao). Copiar o sinal de la erra a base
//      pelo DOBRO do ajuste gravado, e so no SEGUNDO ajuste do mesmo dia.
//
//   3. A CHAVE E POR DIA. Por mes, o ajuste de hoje apagaria o de duas semanas
//      atras -- perdendo a diferenca que apareceu no meio.
//
//   4. A CATEGORIA RESERVADA E OUTRA ("Ajuste de saldo"). Reusar "Ajuste de
//      fatura" rotularia o ajuste da conta corrente como ajuste de cartao em
//      todo relatorio por categoria.
//
//   5. `group_id: null` e `is_shared: false` LITERAIS. Um lancamento negativo
//      que chegue com `group_id` e rateado por `auto_create_group_transaction`:
//      um ajuste de -R$ 50 viraria despesa nova do grupo, dividida com todo
//      mundo, em silencio.
//
// POR QUE A ROTA, E NAO SO A LIB
// ------------------------------
// Tres dos cinco pontos acima sao decisoes da ROTA, nao da funcao pura: a base
// vem de uma consulta, a categoria de outra, e os dois literais so existem no
// payload do INSERT. Uma assercao sobre `lancamentoDoAjusteDeSaldo` passaria
// verde com a rota montando o INSERT a mao e esquecendo `group_id`.
//
// O QUE ESTA SUITE NAO MEDE, DE PROPOSITO
// ---------------------------------------
// Que o saldo FECHE no numero digitado, e que `net_worth_history` nao se mexa
// nos meses anteriores. As duas sao o trigger e uma view -- aritmetica do
// Postgres. O duble nao tem trigger, e simula-lo aqui seria conferir a minha
// simulacao contra ela mesma (ver `conferidor-com-o-mesmo-extrator-nos-dois-
// lados-passa-vacuo`). Elas estao em
// database/tests/ajuste_de_saldo_da_conta_test.sql, que roda no db-verify.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import { criarDuble } from "./duble-de-supabase.mjs";

const ROTA = await import(
  "../.tmp-ajuste-de-saldo-da-conta/app/api/financial-accounts/ajuste/route.js"
);

const LIB = await import(
  "../.tmp-ajuste-de-saldo-da-conta/lib/ajuste-de-saldo-da-conta.js"
);

const DONO = "dono-1";
const ESTRANHO = "dono-2";
const SERVICO = "servico-1";

// UUIDs de verdade: a chave canonica e conferida por regex com a forma de UUID
// (ver `RE_CHAVE_AJUSTE_DE_SALDO`), e um id como "conta-1" faria
// `ajusteDeSaldoDaChave` devolver `null` sobre a chave que a propria rota
// acabou de gravar -- uma suite verde sobre uma chave que ninguem reconhece.
const CONTA = "c0000000-0000-0000-0000-000000000001";
const OUTRA_CONTA = "c0000000-0000-0000-0000-000000000002";
const CARTAO = "c0000000-0000-0000-0000-000000000003";
const CONTA_ALHEIA = "c0000000-0000-0000-0000-000000000009";

// DATA FIXA, e nao "hoje": com `new Date()` a chave mudaria todo dia e as
// assercoes sobre ela teriam de ser construidas com a mesma conta que a rota
// faz -- um conferidor usando o mesmo extrator dos dois lados, que passa vacuo.
const HOJE = "2026-10-16";
const ONTEM = "2026-10-15";

const chave = (dia, conta) => `ajuste-de-saldo:${dia}:${conta}`;

/** As contas do fixture. `current_balance` ja inclui tudo o que esta lancado. */
function contas({ saldo = 2430.0, saldoDaOutra = 100.0 } = {}) {
  return [
    { id: CONTA, user_id: DONO, name: "Conta corrente", account_type: "checking", current_balance: saldo, currency: "BRL" },
    { id: OUTRA_CONTA, user_id: DONO, name: "Poupança", account_type: "savings", current_balance: saldoDaOutra, currency: "BRL" },
    { id: CARTAO, user_id: DONO, name: "Nubank", account_type: "credit_card", current_balance: -800.0, currency: "BRL" },
    { id: CONTA_ALHEIA, user_id: ESTRANHO, name: "Conta do outro", account_type: "checking", current_balance: 5000.0, currency: "BRL" },
  ];
}

/**
 * Chama o POST e devolve `{ status, corpo, lancamentos, categorias, escritas }`.
 *
 * `lancamentos` e `categorias` sao os ARRAYS SEMEADOS, nao copias: e neles que
 * o duble aplica insert, update e delete, e e relendo-os que a assercao ve o
 * que o banco guardaria.
 */
async function ajustar({
  accountId = CONTA,
  data = HOJE,
  saldoReal,
  descricao,
  saldo,
  lancamentos,
  categorias,
  usuario = { id: DONO },
  rlsFiltra,
  /** Campos a mais no corpo do POST, para medir o que a rota IGNORA. */
  corpoExtra,
} = {}) {
  const financial_transactions = lancamentos ?? [];
  const transaction_categories = categorias ?? [];
  const financial_accounts = contas({ saldo });

  const sessao = criarDuble({
    user: usuario,
    tabelas: {
      financial_accounts,
      financial_transactions,
      transaction_categories,
      financial_services: [{ id: SERVICO, name: "personal_finance" }],
    },
    ...(rlsFiltra ? { rlsFiltra } : {}),
  });

  globalThis.__dubleDeSupabase = { sessao: () => sessao.client };

  let resposta;
  try {
    resposta = await ROTA.POST({
      json: async () => ({
        account_id: accountId,
        data,
        saldo_real: saldoReal,
        ...(descricao === undefined ? {} : { descricao }),
        ...(corpoExtra ?? {}),
      }),
    });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  return {
    status: resposta.status ?? 200,
    corpo: await resposta.json(),
    lancamentos: financial_transactions,
    categorias: transaction_categories,
    contas: financial_accounts,
    escritas: sessao.escritas,
    chamadasDeSessao: sessao,
  };
}

/** Chama o DELETE. Mesma forma de `ajustar`. */
async function remover({ accountId = CONTA, data = HOJE, lancamentos } = {}) {
  const financial_transactions = lancamentos ?? [];
  const sessao = criarDuble({
    user: { id: DONO },
    tabelas: {
      financial_accounts: contas(),
      financial_transactions,
      transaction_categories: [],
      financial_services: [{ id: SERVICO, name: "personal_finance" }],
    },
  });

  globalThis.__dubleDeSupabase = { sessao: () => sessao.client };

  let resposta;
  try {
    resposta = await ROTA.DELETE({
      url: `https://x/api/financial-accounts/ajuste?account_id=${accountId}&data=${data}`,
    });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  return {
    status: resposta.status ?? 200,
    corpo: await resposta.json(),
    lancamentos: financial_transactions,
    escritas: sessao.escritas,
  };
}

/** Chama o GET. */
async function conferir({ accountId = CONTA, data = HOJE, saldo, lancamentos } = {}) {
  const sessao = criarDuble({
    user: { id: DONO },
    tabelas: {
      financial_accounts: contas({ saldo }),
      financial_transactions: lancamentos ?? [],
      transaction_categories: [],
      financial_services: [{ id: SERVICO, name: "personal_finance" }],
    },
  });

  globalThis.__dubleDeSupabase = { sessao: () => sessao.client };
  let resposta;
  try {
    resposta = await ROTA.GET({
      url: `https://x/api/financial-accounts/ajuste?account_id=${accountId}&data=${data}`,
    });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }
  return { status: resposta.status ?? 200, corpo: await resposta.json() };
}

/** Um ajuste JA GRAVADO, como a rota o teria deixado. */
function ajusteGravado({ dia = HOJE, conta = CONTA, amount, tipo, id = "ajuste-velho" }) {
  return {
    id,
    user_id: DONO,
    service_id: SERVICO,
    account_id: conta,
    category_id: "categoria-do-ajuste",
    description: "Tarifa que eu não detalhei",
    amount,
    transaction_date: dia,
    transaction_type: tipo ?? (amount > 0 ? "income" : "expense"),
    notes: chave(dia, conta),
    group_id: null,
    is_shared: false,
  };
}

const inserts = (escritas, tabela) =>
  escritas.filter((e) => e.tabela === tabela && e.verbo === "insert");
const naTabela = (escritas, tabela) => escritas.filter((e) => e.tabela === tabela);

// ---------------------------------------------------------------------------
// 1. CONTROLE POSITIVO: a rota grava, e grava com o sinal da CONTA
// ---------------------------------------------------------------------------

test("CONTROLE POSITIVO: a conta tem MENOS do que o app sabia -> lanca saida", async () => {
  // Sem este caso, toda assercao de ausencia abaixo passaria verde tambem com a
  // sonda chamando o handler errado, com um fixture que a rota nao encontra, ou
  // com o duble descartando a escrita.
  //
  // O app diz R$ 2.430,00 e o banco diz R$ 2.380,00: faltam R$ 50 de saida.
  const r = await ajustar({ saldo: 2430.0, saldoReal: "2380.00" });

  assert.equal(r.status, 201);
  assert.equal(r.corpo.criado, true);
  assert.equal(r.corpo.fecha, false);
  assert.equal(r.corpo.diferenca, -50);
  assert.equal(r.corpo.saldo_da_conta, 2380, "o saldo tem de terminar no numero digitado");

  const [escrita] = inserts(r.escritas, "financial_transactions");
  assert.ok(escrita, "nenhum lancamento foi gravado");
  const linha = escrita.linhas[0];

  // O PONTO 1. `-50`, e nao `+50`: o trigger soma `amount` cru em
  // `current_balance`, entao so a diferenca com o proprio sinal leva o saldo ao
  // numero que a pessoa digitou. Com a inversao do cartao o saldo iria para
  // 2.480 -- R$ 100 longe do banco, pelo numero que ela digitou certo.
  assert.equal(linha.amount, -50, "o ajuste da conta NAO inverte o sinal (isso e do cartao)");
  assert.equal(linha.amount, r.corpo.diferenca, "o que foi gravado e o que a resposta prometeu");
  assert.equal(linha.transaction_type, "expense");
  assert.equal(linha.transaction_date, HOJE, "a data e o dia conferido, e nao o dia 1 do mes");
  assert.equal(linha.account_id, CONTA);
  assert.equal(linha.user_id, DONO);
  assert.equal(linha.notes, chave(HOJE, CONTA));
  assert.match(linha.description, /Ajuste de saldo da conta/);
});

test("a conta tem MAIS do que o app sabia -> lanca entrada, com 'income'", async () => {
  // O outro lado. Sem ele, um `amount` cravado em negativo (ou um
  // `Math.abs`) passaria verde no caso de cima.
  const r = await ajustar({ saldo: 2380.0, saldoReal: "2430.00" });

  assert.equal(r.corpo.diferenca, 50);
  assert.equal(r.corpo.saldo_da_conta, 2430);

  const linha = inserts(r.escritas, "financial_transactions")[0].linhas[0];
  assert.equal(linha.amount, 50);
  assert.equal(
    linha.transaction_type,
    "income",
    "entrada gravada como 'expense' poe uma despesa de valor positivo no fluxo de caixa"
  );
});

test("NENHUM UPDATE em financial_accounts -- o saldo e movido pelo trigger", async () => {
  // O PONTO 2 DO PLANO, e a assercao que o mede do lado do codigo.
  // `net_worth_history` reconstroi o patrimonio de tras para frente a partir do
  // saldo de hoje: corrigir `current_balance` direto somaria a diferenca em
  // TODO mes passado do grafico, sem nenhuma transacao explicando a subida.
  //
  // (Que o trigger de fato feche a conta e que os meses anteriores de fato nao
  // se mexam e o que database/tests/ajuste_de_saldo_da_conta_test.sql mede, com
  // banco de verdade. Aqui o que se prova e que a rota NAO tenta escrever o
  // saldo -- o duble nao tem trigger, entao os dois lados sao necessarios.)
  const r = await ajustar({ saldo: 2430.0, saldoReal: "2380.00" });

  assert.deepEqual(
    naTabela(r.escritas, "financial_accounts"),
    [],
    "a rota escreveu em financial_accounts -- o saldo nao pode ser corrigido direto"
  );
  assert.equal(
    r.contas.find((c) => c.id === CONTA).current_balance,
    2430.0,
    "o saldo semeado foi reescrito pela rota"
  );
});

// ---------------------------------------------------------------------------
// 2. OS LITERAIS QUE IMPEDEM O RATEIO SILENCIOSO (ponto 5)
// ---------------------------------------------------------------------------

test("o INSERT leva group_id NULO e is_shared FALSO, escritos", async () => {
  // `auto_create_group_transaction` rateia todo lancamento NEGATIVO que chegue
  // com `group_id` preenchido. Um ajuste de -R$ 50 viraria despesa nova do
  // grupo, dividida com todo mundo, e cada membro passaria a dever a parte dele
  // de um dinheiro que ninguem gastou.
  //
  // A assercao e sobre as CHAVES do payload, e nao so sobre os valores: o
  // default do banco daria o mesmo resultado hoje, e e justamente por isso que
  // `linha.group_id === null` sozinho nao mede nada -- uma linha sem a chave
  // tambem le `undefined === null` como falso, mas `linha.group_id == null`
  // passaria. `Object.keys` e o que distingue escrito de subentendido.
  const r = await ajustar({ saldo: 2430.0, saldoReal: "2380.00" });
  const linha = inserts(r.escritas, "financial_transactions")[0].linhas[0];
  const colunas = Object.keys(linha);

  assert.ok(colunas.includes("group_id"), "group_id nao foi escrito no INSERT");
  assert.ok(colunas.includes("is_shared"), "is_shared nao foi escrito no INSERT");
  assert.equal(linha.group_id, null);
  assert.equal(linha.is_shared, false);
});

test("o group_id MANDADO NO CORPO e ignorado, e nao repassado ao INSERT", async () => {
  // O caso acima prova que os literais estao escritos; este prova que eles sao
  // LITERAIS, e nao um `corpo?.group_id ?? null` -- que da exatamente o mesmo
  // resultado enquanto ninguem manda o campo.
  //
  // Medido: sem este caso, o mutante que troca `group_id: null` por
  // `group_id: corpo?.group_id ?? null` SOBREVIVE a suite inteira. E o defeito
  // e o pior desta feature: um ajuste de -R$ 50 com `group_id` e rateado por
  // `auto_create_group_transaction`, vira despesa nova do grupo, e cada membro
  // passa a dever a parte dele de um dinheiro que ninguem gastou -- em
  // silencio. Que o trigger faca isso esta medido em
  // database/tests/ajuste_de_saldo_da_conta_test.sql; o que se mede aqui e que
  // a rota nao da a ele a chance.
  //
  // `is_shared` vai junto pelo mesmo motivo.
  const r = await ajustar({
    saldo: 2430.0,
    saldoReal: "2380.00",
    corpoExtra: {
      group_id: "99999999-0000-0000-0000-000000000001",
      is_shared: true,
      // E o `user_id` tambem nao e escolhivel: a policy da 036 recusaria um
      // alheio, mas repassar o campo deixaria a rota parecendo que ele e.
      user_id: ESTRANHO,
    },
  });

  const linha = inserts(r.escritas, "financial_transactions")[0].linhas[0];
  assert.equal(
    linha.group_id,
    null,
    "a rota repassou o group_id do corpo -- o ajuste viraria despesa rateada do grupo"
  );
  assert.equal(linha.is_shared, false, "a rota repassou o is_shared do corpo");
  assert.equal(linha.user_id, DONO, "a rota repassou o user_id do corpo");
});

// ---------------------------------------------------------------------------
// 3. A BASE: O AJUSTE QUE JA EXISTE SAI DELA, E SAI SUBTRAIDO (ponto 2)
// ---------------------------------------------------------------------------

test("o SEGUNDO ajuste do mesmo dia nao conta o primeiro duas vezes", async () => {
  // O caso em que o sinal da base erra, e SO ele.
  //
  //   os lancamentos somam R$ 2.430. Um ajuste de -50 ja gravado hoje deixou
  //   `current_balance` em R$ 2.380. O banco agora diz R$ 2.400.
  //
  //   base certa:  2380 - (-50) = 2430  ->  diferenca = 2400 - 2430 = -30
  //   base somada: 2380 + (-50) = 2330  ->  diferenca = 2400 - 2330 = +70
  //
  // O +70 e o que sai se alguem copiar `centavosDaFaturaSemAjuste` do cartao,
  // onde SOMAR e o certo (a view publica `-amount`; aqui o trigger soma a
  // coluna crua). Os dois numeros sao plausiveis, e o erro so aparece no
  // SEGUNDO ajuste.
  const velho = ajusteGravado({ amount: -50 });
  const r = await ajustar({
    saldo: 2380.0,
    saldoReal: "2400.00",
    lancamentos: [velho],
  });

  assert.equal(r.corpo.diferenca, -30, "a base somou o ajuste existente em vez de subtrai-lo");
  assert.equal(r.corpo.saldo_da_conta, 2400, "o saldo tem de terminar no numero digitado");
});

test("salvar duas vezes TROCA o ajuste: UPDATE na linha, e nenhum INSERT", async () => {
  // A chave canonica e o que faz a rota substituir em vez de empilhar. Dois
  // ajustes somando as cegas seriam a volta do problema que a feature conserta.
  const velho = ajusteGravado({ amount: -50 });
  const r = await ajustar({
    saldo: 2380.0,
    saldoReal: "2400.00",
    lancamentos: [velho],
  });

  assert.equal(r.corpo.criado, false);
  assert.equal(
    inserts(r.escritas, "financial_transactions").length,
    0,
    "a rota criou um SEGUNDO ajuste no mesmo dia em vez de trocar o primeiro"
  );
  assert.equal(r.lancamentos.length, 1, "ficou mais de uma linha de ajuste no dia");

  // O TIPO VAI JUNTO COM O VALOR no UPDATE. Trocar -50 por +60 muda
  // 'expense' para 'income'; deixar o tipo velho poria uma despesa de valor
  // positivo no fluxo de caixa -- saldo certo, relatorio errado.
  const patch = naTabela(r.escritas, "financial_transactions").find(
    (e) => e.verbo === "update"
  )?.patch;
  assert.ok(patch, "nao houve UPDATE");
  assert.equal(patch.amount, -30);
  assert.equal(patch.transaction_type, "expense");
  assert.equal(r.lancamentos[0].amount, -30, "a linha no banco nao ficou com o valor novo");
});

test("trocar de saida para ENTRADA leva o transaction_type junto", async () => {
  // O mesmo UPDATE, com a troca que inverte o tipo -- sem este caso, um patch
  // com `transaction_type` cravado em "expense" passaria verde acima.
  const velho = ajusteGravado({ amount: -50 });
  const r = await ajustar({
    saldo: 2380.0,
    saldoReal: "2500.00",
    lancamentos: [velho],
  });

  // base = 2380 - (-50) = 2430; diferenca = 2500 - 2430 = +70
  assert.equal(r.corpo.diferenca, 70);
  const patch = naTabela(r.escritas, "financial_transactions").find(
    (e) => e.verbo === "update"
  ).patch;
  assert.equal(patch.amount, 70);
  assert.equal(patch.transaction_type, "income");
});

// ---------------------------------------------------------------------------
// 4. A CHAVE E POR DIA (ponto 3)
// ---------------------------------------------------------------------------

test("ajustar HOJE nao encosta no ajuste de ONTEM", async () => {
  // Com chave por MES -- a do cartao -- o ajuste de hoje reescreveria o de
  // ontem, e a diferenca que apareceu no meio sumiria do extrato sem nada
  // explicando a mudanca de saldo.
  //
  // O ajuste de ontem JA ESTA em `current_balance`, e isso esta certo: ele e um
  // movimento passado como outro qualquer. A base de hoje e o saldo inteiro,
  // porque hoje ainda nao tem ajuste.
  const deOntem = ajusteGravado({ dia: ONTEM, amount: -20, id: "ajuste-de-ontem" });
  const r = await ajustar({
    saldo: 2430.0,
    saldoReal: "2380.00",
    lancamentos: [deOntem],
  });

  assert.equal(r.corpo.diferenca, -50, "o ajuste de ontem foi descontado da base de hoje");
  assert.equal(r.corpo.criado, true, "a rota reescreveu o ajuste de ontem em vez de criar o de hoje");

  const deOntemDepois = r.lancamentos.find((l) => l.id === "ajuste-de-ontem");
  assert.equal(deOntemDepois.amount, -20, "o ajuste de ontem foi alterado");
  assert.equal(deOntemDepois.notes, chave(ONTEM, CONTA));

  const nova = inserts(r.escritas, "financial_transactions")[0].linhas[0];
  assert.equal(nova.notes, chave(HOJE, CONTA), "a chave do ajuste novo nao e a de hoje");
});

test("o ajuste de UMA conta nao e encontrado pela chave de OUTRA", async () => {
  // A chave leva o id da conta. Sem ele, ajustar a poupanca reescreveria o
  // ajuste da conta corrente -- o saldo de uma consertado as custas da outra.
  const naCorrente = ajusteGravado({ amount: -50 });
  const r = await ajustar({
    accountId: OUTRA_CONTA,
    saldoDaOutra: 100.0,
    saldoReal: "90.00",
    lancamentos: [naCorrente],
  });

  assert.equal(r.corpo.criado, true, "a rota pegou o ajuste da outra conta");
  assert.equal(r.lancamentos.find((l) => l.id === "ajuste-velho").amount, -50);
});

// ---------------------------------------------------------------------------
// 5. A CONTA JA BATE: REMOVE O AJUSTE, NAO GRAVA R$ 0,00
// ---------------------------------------------------------------------------

test("o saldo ja bate E ha ajuste -> a linha e APAGADA", async () => {
  // Quem informa o saldo real e ve que ele bate esta dizendo "nao falta nada
  // nesta conta" -- e um ajuste de mais cedo que continue valendo e justamente
  // o que faria a conta parar de bater no instante seguinte.
  const velho = ajusteGravado({ amount: -50 });
  const r = await ajustar({
    saldo: 2380.0,
    saldoReal: "2430.00", // = a base sem o ajuste
    lancamentos: [velho],
  });

  assert.equal(r.corpo.fecha, true);
  assert.equal(r.corpo.removido, true);
  assert.equal(r.corpo.diferenca, 0);
  assert.equal(r.lancamentos.length, 0, "o ajuste que sobrava continua no banco");
  assert.equal(
    inserts(r.escritas, "financial_transactions").length,
    0,
    "gravou um lancamento de R$ 0,00 no extrato"
  );
});

test("o saldo ja bate e NAO ha ajuste -> nada e escrito", async () => {
  // O outro desfecho de "ja bate", e ele e diferente: nao ha nada a remover.
  // Uma so palavra para os dois diria "removi" sobre uma conta em que nada
  // havia.
  const r = await ajustar({ saldo: 2430.0, saldoReal: "2430.00" });

  assert.equal(r.corpo.fecha, true);
  assert.equal(r.corpo.removido, false);
  assert.deepEqual(
    naTabela(r.escritas, "financial_transactions"),
    [],
    "a rota escreveu alguma coisa sobre uma conta que ja batia"
  );
});

test("o DELETE que a RLS filtra nao vira 'pronto, a conta bate'", async () => {
  // Um DELETE filtrado pela RLS volta 200 com zero linhas e sem erro. Dizer que
  // o ajuste saiu sobre uma linha que continua somando seria a tela afirmando o
  // contrario do banco.
  const velho = ajusteGravado({ amount: -50 });
  const r = await ajustar({
    saldo: 2380.0,
    saldoReal: "2430.00",
    lancamentos: [velho],
    rlsFiltra: { financial_transactions: true },
  });

  assert.equal(r.status, 500);
  assert.match(r.corpo.error, /Não foi possível tirar o ajuste/);
  assert.ok(!r.corpo.fecha, "respondeu sucesso sobre uma remocao que nao aconteceu");
});

// ---------------------------------------------------------------------------
// 6. A CATEGORIA RESERVADA E PROPRIA (ponto 4)
// ---------------------------------------------------------------------------

test("a categoria criada chama 'Ajuste de saldo', e nasce fora dos seletores", async () => {
  const r = await ajustar({ saldo: 2430.0, saldoReal: "2380.00" });

  const [criacao] = inserts(r.escritas, "transaction_categories");
  assert.ok(criacao, "a categoria reservada nao foi criada");
  const categoria = criacao.linhas[0];

  assert.equal(categoria.name, "Ajuste de saldo");
  assert.notEqual(
    categoria.name,
    "Ajuste de fatura",
    "reusar o nome do cartao rotula o ajuste da conta corrente como ajuste de cartao em todo relatorio por categoria"
  );
  // `is_active = FALSE` e o que a mantem fora do seletor de categorias: a rota
  // de catalogo filtra `is_active = true` no proprio SELECT.
  assert.equal(categoria.is_active, false);
  // Do SERVIDOR, nunca do corpo do pedido.
  assert.equal(categoria.user_id, DONO);
});

test("a categoria 'Ajuste de fatura' do mesmo dono NAO e reusada", async () => {
  // O controle negativo do caso acima: com a categoria do cartao ja no banco, a
  // rota tem de criar a dela mesmo assim. Sem este caso, uma busca por nome
  // errado (ou um `.or(...)` generoso) passaria verde.
  const doCartao = {
    id: "categoria-do-cartao",
    service_id: SERVICO,
    user_id: DONO,
    name: "Ajuste de fatura",
    is_active: false,
  };
  const r = await ajustar({
    saldo: 2430.0,
    saldoReal: "2380.00",
    categorias: [doCartao],
  });

  const [criacao] = inserts(r.escritas, "transaction_categories");
  assert.ok(criacao, "a rota reusou a categoria do cartao");
  assert.equal(criacao.linhas[0].name, "Ajuste de saldo");

  const lancamento = inserts(r.escritas, "financial_transactions")[0].linhas[0];
  assert.notEqual(
    lancamento.category_id,
    "categoria-do-cartao",
    "o lancamento da conta saiu com a categoria do cartao"
  );
});

test("a categoria que JA existe e reusada, e nao duplicada", async () => {
  const minha = {
    id: "categoria-do-ajuste",
    service_id: SERVICO,
    user_id: DONO,
    name: "Ajuste de saldo",
    is_active: false,
  };
  const r = await ajustar({
    saldo: 2430.0,
    saldoReal: "2380.00",
    categorias: [minha],
  });

  assert.equal(
    inserts(r.escritas, "transaction_categories").length,
    0,
    "criou uma segunda categoria reservada"
  );
  assert.equal(
    inserts(r.escritas, "financial_transactions")[0].linhas[0].category_id,
    "categoria-do-ajuste"
  );
});

// ---------------------------------------------------------------------------
// 7. QUEM A ROTA RECUSA
// ---------------------------------------------------------------------------

test("o CARTAO e recusado, e a mensagem diz onde esta o ajuste dele", async () => {
  // O ajuste do cartao e por FATURA (o que se deve naquele mes), e nao pelo
  // saldo acumulado. Aceitar um cartao aqui gravaria uma linha que a fatura de
  // nenhum mes explicaria direito -- e mandar a pessoa para a tela certa e mais
  // util do que dizer que a conta nao existe.
  const r = await ajustar({ accountId: CARTAO, saldoReal: "100.00" });

  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /Cartão de crédito/);
  assert.match(r.corpo.error, /Cartões/, "a mensagem nao diz onde fica o ajuste do cartao");
  assert.deepEqual(naTabela(r.escritas, "financial_transactions"), []);
});

test("a conta de OUTRO dono volta 404, sem vazar numero nenhum", async () => {
  // A conferencia vem ANTES da aritmetica de proposito: a consulta confia na
  // RLS e sobre um id alheio devolveria nada, entao sem este passo a rota
  // responderia uma diferenca calculada sobre um saldo inventado antes de
  // chegar ao 404. Numero plausivel em resposta a um id alheio.
  const r = await ajustar({ accountId: CONTA_ALHEIA, saldoReal: "100.00" });

  assert.equal(r.status, 404);
  assert.equal(r.corpo.saldo_da_conta, undefined, "a resposta do 404 trouxe saldo");
  assert.equal(r.corpo.diferenca, undefined);
  assert.deepEqual(naTabela(r.escritas, "financial_transactions"), []);
});

test("a data que nao existe no calendario e recusada antes do banco", async () => {
  // '2026-02-30' chega no `date` do Postgres como 22008 -- "Erro interno" na
  // tela, em vez de uma recusa que diz qual campo esta errado. E `new Date`
  // nao serviria de validador: ele rola a data para 2 de marco, calado.
  const r = await ajustar({ data: "2026-02-30", saldoReal: "2380.00" });

  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /AAAA-MM-DD/);
  assert.deepEqual(naTabela(r.escritas, "financial_transactions"), []);
});

test("sem sessao, 401 e nenhuma leitura de conta", async () => {
  const r = await ajustar({ usuario: null, saldoReal: "2380.00" });
  assert.equal(r.status, 401);
  assert.deepEqual(r.escritas, []);
});

test("o campo vazio e recusado com a frase da CONTA, e nao a do cartao", async () => {
  // `Number("")` e 0 em JavaScript, e um saldo real de R$ 0,00 e uma afirmacao
  // legitima -- a recusa vem de `ajusteParaFecharEm`, que distingue as duas.
  // O que esta suite acrescenta e o VOCABULARIO: "Informe quanto o cartão diz
  // hoje" numa tela de conta corrente e uma frase que fala de outra coisa, e
  // quem a le conclui que abriu a tela errada.
  const r = await ajustar({ saldo: 2430.0, saldoReal: "" });

  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /conta/i);
  assert.ok(
    !/cart[ãa]o/i.test(r.corpo.error),
    `a recusa do ajuste de conta fala de cartao: ${r.corpo.error}`
  );
});

// ---------------------------------------------------------------------------
// 8. O DELETE
// ---------------------------------------------------------------------------

test("o DELETE apaga de verdade o ajuste daquele dia", async () => {
  // Apaga, e nao marca inativo: o trigger so estorna o saldo no DELETE. Um soft
  // delete deixaria a diferenca somada em `current_balance` para sempre.
  const deHoje = ajusteGravado({ amount: -50 });
  const deOntem = ajusteGravado({ dia: ONTEM, amount: -20, id: "ajuste-de-ontem" });
  const r = await remover({ lancamentos: [deHoje, deOntem] });

  assert.equal(r.status, 200);
  assert.equal(r.corpo.removidos, 1);
  assert.deepEqual(
    r.lancamentos.map((l) => l.id),
    ["ajuste-de-ontem"],
    "o DELETE levou junto o ajuste de outro dia"
  );
});

test("o DELETE sobre um dia sem ajuste volta 404, e nao um sucesso vazio", async () => {
  // Um DELETE filtrado volta 200 com zero linhas e sem erro. Sem o `.select()`
  // depois dele, a tela diria "ajuste removido" sobre uma conta que continua
  // ajustada.
  const r = await remover({ lancamentos: [] });
  assert.equal(r.status, 404);
  assert.match(r.corpo.error, /não tem ajuste de saldo/i);
});

// ---------------------------------------------------------------------------
// 9. O GET: a tela precisa da BASE, e nao do saldo da lista
// ---------------------------------------------------------------------------

test("o GET devolve a base SEM o ajuste, e o ajuste que esta valendo", async () => {
  // A lista de Contas mostra `current_balance`, que ja inclui o ajuste. Uma
  // previa calculada em cima dele somaria o ajuste velho ao novo -- e a frase
  // "o saldo passa de X para Y" discordaria do que o POST grava.
  const velho = ajusteGravado({ amount: -50 });
  const r = await conferir({ saldo: 2380.0, lancamentos: [velho] });

  assert.equal(r.status, 200);
  assert.equal(r.corpo.saldo_atual, 2380);
  assert.equal(r.corpo.saldo_sem_ajuste, 2430, "a base nao tirou o ajuste gravado");
  assert.equal(r.corpo.ajuste.amount, -50);
  // A descricao volta para o formulario reabrir com o motivo escrito; o VALOR
  // nao volta de proposito -- o campo nasce vazio (ver `abrirAjuste`).
  assert.equal(r.corpo.ajuste.description, "Tarifa que eu não detalhei");
});

test("o GET de um dia sem ajuste responde `ajuste: null`, e nao omite o campo", async () => {
  // `null` e "nao ha ajuste neste dia, com certeza". A tela so pode afirmar a
  // ausencia porque qualquer falha de leitura sai como 500 -- ver
  // `ajusteGravado` na rota.
  const r = await conferir({ saldo: 2430.0, lancamentos: [] });

  assert.equal(r.status, 200);
  assert.equal(r.corpo.ajuste, null);
  assert.equal(r.corpo.saldo_sem_ajuste, 2430);
});

// ---------------------------------------------------------------------------
// 10. A LIB: o que a rota apoia, medido sozinho
// ---------------------------------------------------------------------------

test("centavosDoSaldoSemAjuste SUBTRAI o ajuste, em centavos inteiros", () => {
  // O sinal, de novo, mas sobre a funcao pura: o cartao SOMA aqui (a view
  // publica `-amount`), a conta SUBTRAI (o trigger soma a coluna crua).
  assert.equal(
    LIB.centavosDoSaldoSemAjuste({ saldoAtual: 2380.0, amountDoAjuste: -50 }),
    243000
  );
  assert.equal(
    LIB.centavosDoSaldoSemAjuste({ saldoAtual: 2430.0, amountDoAjuste: 50 }),
    238000
  );
  assert.equal(
    LIB.centavosDoSaldoSemAjuste({ saldoAtual: 2430.0, amountDoAjuste: null }),
    243000,
    "sem ajuste gravado, a base e o saldo"
  );

  // Zero e base legitima; `null` e "nao sei". Confundir os dois faria o ajuste
  // ser o saldo real INTEIRO.
  assert.equal(LIB.centavosDoSaldoSemAjuste({ saldoAtual: 0, amountDoAjuste: null }), 0);
  assert.equal(
    LIB.centavosDoSaldoSemAjuste({ saldoAtual: null, amountDoAjuste: null }),
    null
  );
  assert.equal(
    LIB.centavosDoSaldoSemAjuste({ saldoAtual: 100, amountDoAjuste: "xis" }),
    null,
    "um ajuste gravado com amount ilegivel sairia da base como se nao existisse"
  );

  // O RESIDUO. `2430.10 - 2380.00` em ponto flutuante nao da 50.1 exato, e o
  // residuo cai exatamente no teste de "a conta ja bate".
  assert.equal(
    LIB.centavosDoSaldoSemAjuste({ saldoAtual: 2430.1, amountDoAjuste: 0.1 }),
    243000
  );
});

test("diaDoAjuste recusa o dia que nao existe no mes", () => {
  assert.equal(LIB.diaDoAjuste("2026-10-16"), "2026-10-16");
  assert.equal(LIB.diaDoAjuste("2024-02-29"), "2024-02-29", "2024 e bissexto");
  assert.equal(LIB.diaDoAjuste("2026-02-29"), null, "2026 nao e bissexto");
  assert.equal(LIB.diaDoAjuste("2100-02-29"), null, "ano secular nao bissexto");
  assert.equal(LIB.diaDoAjuste("2000-02-29"), "2000-02-29", "divisivel por 400");
  assert.equal(LIB.diaDoAjuste("2026-04-31"), null);
  assert.equal(LIB.diaDoAjuste("2026-13-01"), null);
  assert.equal(LIB.diaDoAjuste("2026-00-10"), null);
  assert.equal(LIB.diaDoAjuste("2026-10-00"), null);
  assert.equal(LIB.diaDoAjuste("2026-10"), null, "mes nao e dia");
  assert.equal(LIB.diaDoAjuste(""), null);
  assert.equal(LIB.diaDoAjuste(null), null);
});

test("diaLocalDe le o relogio do APARELHO, e nao a ISO em UTC", () => {
  // O caso que separa as duas implementacoes: 21h30 em Sao Paulo ja e o dia
  // SEGUINTE em UTC. `hojeISO()` de lib/lancamento.ts corta `toISOString()` e
  // devolveria 17 aqui, datando o ajuste em AMANHA -- uma chave canonica de um
  // dia que ainda nao chegou, e um ajuste a mais quando a pessoa conferisse de
  // novo pela manha.
  const noiteEmSaoPaulo = new Date(2026, 9, 16, 21, 30, 0);

  // A PRIMEIRA LINHA E O CONTROLE DA SEGUNDA, e por isso ela vem antes: ela
  // afirma que neste fuso as duas implementacoes DIVERGEM. Sem ela, a suite
  // rodando em UTC (o fuso do runner do GitHub) compararia o dia local com ele
  // mesmo e aprovaria `toISOString()` -- o mutante sobrevive la e morre na
  // maquina de quem escreveu. E por isso que o npm script fixa
  // TZ=America/Sao_Paulo.
  assert.equal(
    noiteEmSaoPaulo.toISOString().slice(0, 10),
    "2026-10-17",
    "a suite nao esta rodando em America/Sao_Paulo -- esta medicao fica vacua"
  );
  assert.equal(LIB.diaLocalDe(noiteEmSaoPaulo), "2026-10-16");

  // Um digito em cada campo: sem o padStart, 1o de marco sairia '2026-3-1' --
  // que `diaDoAjuste` recusa, e o ajuste nunca grava.
  assert.equal(LIB.diaLocalDe(new Date(2026, 2, 1, 0, 5, 0)), "2026-03-01");
});

test("lancamentoDoAjusteDeSaldo nao inverte o sinal, e recusa zero", () => {
  const entrada = LIB.lancamentoDoAjusteDeSaldo({
    diferenca: 50,
    data: HOJE,
    accountId: CONTA,
  });
  assert.equal(entrada.amount, 50, "inverter aqui e o defeito que o cartao induz");
  assert.equal(entrada.transaction_type, "income");
  assert.equal(entrada.transaction_date, HOJE);
  assert.equal(entrada.notes, chave(HOJE, CONTA));

  const saida = LIB.lancamentoDoAjusteDeSaldo({
    diferenca: -50,
    data: HOJE,
    accountId: CONTA,
  });
  assert.equal(saida.amount, -50);
  assert.equal(saida.transaction_type, "expense");

  // ZERO e `null`, e nao uma linha de R$ 0,00: ela nao muda saldo nenhum e
  // aparece no extrato com cara de lancamento real.
  assert.equal(
    LIB.lancamentoDoAjusteDeSaldo({ diferenca: 0, data: HOJE, accountId: CONTA }),
    null
  );
  // Data ilegivel e `null`, e nao um fallback para hoje: gravar dinheiro num dia
  // que a pessoa nao escolheu poe o degrau no mes errado do patrimonio.
  assert.equal(
    LIB.lancamentoDoAjusteDeSaldo({ diferenca: 50, data: "2026-02-30", accountId: CONTA }),
    null
  );
  assert.equal(
    LIB.lancamentoDoAjusteDeSaldo({ diferenca: 50, data: HOJE, accountId: "" }),
    null
  );

  // A descricao do usuario vence a padrao, e a vazia nao apaga o rotulo: uma
  // linha de R$ 50 sem nada que a identifique e indistinguivel de um gasto
  // esquecido tres meses depois.
  assert.equal(
    LIB.lancamentoDoAjusteDeSaldo({
      diferenca: 50,
      data: HOJE,
      accountId: CONTA,
      descricao: "  Rendimento  ",
    }).description,
    "Rendimento"
  );
  assert.match(
    LIB.lancamentoDoAjusteDeSaldo({
      diferenca: 50,
      data: HOJE,
      accountId: CONTA,
      descricao: "   ",
    }).description,
    /Ajuste de saldo da conta/
  );
});

test("a chave canonica e ancorada nas duas pontas", () => {
  assert.deepEqual(LIB.ajusteDeSaldoDaChave(chave(HOJE, CONTA)), {
    dia: HOJE,
    accountId: CONTA,
  });

  // Sem o `$`, uma nota escrita a mao passaria por chave canonica e a descricao
  // livre do usuario viraria regra de negocio.
  assert.equal(
    LIB.ajusteDeSaldoDaChave(`${chave(HOJE, CONTA)} conferi no app`),
    null
  );
  assert.equal(LIB.ajusteDeSaldoDaChave(`sobre ${chave(HOJE, CONTA)}`), null);
  // A chave do CARTAO nao e chave de conta, e vice-versa: os dois prefixos
  // convivem na mesma coluna `notes`.
  assert.equal(LIB.ajusteDeSaldoDaChave(`ajuste-de-fatura:2026-10-01:${CONTA}`), null);
  assert.equal(LIB.ehAjusteDeSaldo(null), false);
  assert.equal(LIB.ehAjusteDeSaldo(chave(HOJE, CONTA)), true);
});

test("o vocabulario da recusa e o da conta, e a aritmetica e a do cartao", () => {
  // As duas metades desta feature numa assercao so: a funcao e a mesma
  // (`ajusteParaFecharEm`), e por isso a diferenca sai identica; o texto e
  // outro, e por isso a tela nao fala de fatura.
  const vazio = LIB.ajusteParaOSaldoFicarEm({ saldoReal: "", saldoSemAjuste: 2430 });
  assert.equal(vazio.ok, false);
  assert.ok(!/cart[ãa]o|fatura/i.test(vazio.erro), vazio.erro);

  const semBase = LIB.ajusteParaOSaldoFicarEm({ saldoReal: "100", saldoSemAjuste: null });
  assert.equal(semBase.ok, false);
  assert.ok(!/fatura/i.test(semBase.erro), semBase.erro);

  const conta = LIB.ajusteParaOSaldoFicarEm({
    saldoReal: "2380.00",
    saldoSemAjuste: 2430,
  });
  assert.deepEqual(conta, { ok: true, fecha: false, valorNaFatura: -50 });

  assert.deepEqual(
    LIB.ajusteParaOSaldoFicarEm({ saldoReal: "2430", saldoSemAjuste: 2430 }),
    { ok: true, fecha: true, valorNaFatura: 0 }
  );
});
