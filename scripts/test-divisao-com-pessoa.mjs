// =====================================================
// PULODOGATO - a divisao com pessoa pelo lancamento (RN020, fase 5)
// =====================================================
//   npm run test:divisao-com-pessoa
//
// A 070 faz o lancamento dividido com uma pessoa criar duas contas previstas,
// "A receber de <pessoa>" para quem pagou e "Pagamento a <pessoa>" para o
// outro -- e o banco prova isso em
// database/tests/070_divisao_com_pessoa_no_lancamento_test.sql. O que o banco
// nao alcanca, e esta suite mede, e o que fica em volta dele:
//
//   1. O QUE A EDICAO GRAVA (lib/conta-da-divisao.ts). O formulario apagava as
//      partes e inseria de novo a cada Salvar. Desde a 070 isso refaz as contas
//      dos dois lados, e e recusado quando um deles ja pagou -- mesmo numa
//      correcao de descricao. A edicao grava so a diferenca;
//   2. A AGENDA. Editar e excluir a conta da divisao respondem 409 com a frase
//      que diz onde mudar, sem escrever nada. A baixa comum continua valendo:
//      e assim que cada lado quita a dele (RN020.6);
//   3. A RECUSA DA DIVISAO JA PAGA (PDG02). Editar ou apagar o lancamento, e
//      recusar a parte, viram 409 com a frase, e nao o 500 de "tente de novo".
//
// Cada bloco tem o CONTROLE junto: a mesma chamada sem a condicao, que tem de
// seguir outro caminho.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { criarDuble } from "./duble-de-supabase.mjs";

const RAIZ = "../.tmp-divisao-com-pessoa";

const {
  avisoDaDivisaoPaga,
  ehContaDaDivisaoComPessoa,
  mudancasDaDivisao,
  MENSAGEM_DA_CONTA_DA_DIVISAO,
  MENSAGEM_DA_DIVISAO_PAGA,
} = await import(`${RAIZ}/lib/conta-da-divisao.js`);
const ROTA_PREVISTA = await import(`${RAIZ}/app/api/scheduled-transactions/[id]/route.js`);
const ROTA_PAY = await import(`${RAIZ}/app/api/scheduled-transactions/[id]/pay/route.js`);
const ROTA_LANCAMENTO = await import(
  `${RAIZ}/app/api/personal-finance/transactions/[id]/route.js`
);
const ROTA_PARTES = await import(`${RAIZ}/app/api/personal-finance/splits/route.js`);

const HELIO = "11111111-1111-1111-1111-111111111111";
const LAIS = "22222222-2222-2222-2222-222222222222";
const LETICIA = "33333333-3333-3333-3333-333333333333";
const PARTE = "parte-1";
const DESPESA = "despesa-1";
const SERVICO = "servico-1";
const CORRENTE_DO_HELIO = "conta-corrente-helio";
const PAGAMENTO_A_PESSOA = "546f8740-14f1-42bd-a202-870f0f444874";

const RECUSA_DA_070 = {
  code: "PDG02",
  message:
    "Esta divisao ja foi paga por um dos lados: desfaca a baixa na agenda antes de mudar o valor, a data, a pessoa ou apagar o lancamento (RN020.3)",
};

// -----------------------------------------------------
// 1. O que a edicao grava
// -----------------------------------------------------
const gravada = (id, participant_id, percentage) => ({ id, participant_id, percentage });

test("editar sem mexer na divisao nao grava parte nenhuma", () => {
  // A coluna e numeric(5,2) e chega como texto: "90.00" e 90 sao a mesma parte.
  const partes = [gravada("p1", HELIO, "90.00"), gravada("p2", LETICIA, "5.50")];
  assert.deepEqual(
    mudancasDaDivisao(partes, [
      { participanteId: HELIO, percentual: 90 },
      { participanteId: LETICIA, percentual: 5.5 },
    ]),
    { inserir: [], atualizar: [], apagar: [] }
  );
  // Controle: mudar a porcentagem de um vira UM update, na parte dele, e a
  // outra fica como esta.
  assert.deepEqual(
    mudancasDaDivisao(partes, [
      { participanteId: HELIO, percentual: 40 },
      { participanteId: LETICIA, percentual: 5.5 },
    ]),
    { inserir: [], atualizar: [{ id: "p1", percentual: 40 }], apagar: [] }
  );
});

test("quem sai e apagado, quem entra e inserido, e a pessoa e a chave", () => {
  const partes = [gravada("p1", HELIO, "50.00"), gravada("p2", LETICIA, "20.00")];
  assert.deepEqual(
    mudancasDaDivisao(partes, [
      { participanteId: HELIO, percentual: 50 },
      { participanteId: LAIS, percentual: 20 },
    ]),
    {
      inserir: [{ participanteId: LAIS, percentual: 20 }],
      atualizar: [],
      apagar: ["p2"],
    }
  );
});

test("lancamento posto num grupo (lista vazia) apaga todas as partes", () => {
  const partes = [gravada("p1", HELIO, "90.00")];
  assert.deepEqual(mudancasDaDivisao(partes, []), {
    inserir: [],
    atualizar: [],
    apagar: ["p1"],
  });
  // Controle: sem nada gravado, a lista do formulario e toda insercao -- e o
  // caminho do lancamento novo.
  assert.deepEqual(mudancasDaDivisao([], [{ participanteId: HELIO, percentual: 90 }]), {
    inserir: [{ participanteId: HELIO, percentual: 90 }],
    atualizar: [],
    apagar: [],
  });
});

test("ehContaDaDivisaoComPessoa: so a conta que tem a parte", () => {
  assert.equal(ehContaDaDivisaoComPessoa({ expense_split_id: PARTE }), true);
  assert.equal(ehContaDaDivisaoComPessoa({ expense_split_id: null }), false);
  // A linha lida antes da colagem da 070 nao tem a coluna.
  assert.equal(ehContaDaDivisaoComPessoa({}), false);
  assert.equal(ehContaDaDivisaoComPessoa(null), false);
});

test("avisoDaDivisaoPaga casa pelo codigo PDG02, e so por ele", () => {
  assert.equal(avisoDaDivisaoPaga(RECUSA_DA_070), MENSAGEM_DA_DIVISAO_PAGA);
  assert.equal(avisoDaDivisaoPaga({ code: "PDG02", message: "" }), MENSAGEM_DA_DIVISAO_PAGA);
  // Controle: a recusa do grupo (PDG01) tem frase propria, e um CHECK comum
  // nao e esta recusa, mesmo com o mesmo texto.
  assert.equal(avisoDaDivisaoPaga({ code: "PDG01", message: "aprovou" }), null);
  assert.equal(avisoDaDivisaoPaga({ ...RECUSA_DA_070, code: "23514" }), null);
  assert.equal(avisoDaDivisaoPaga(null), null);
  assert.equal(avisoDaDivisaoPaga("PDG02"), null);
});

// -----------------------------------------------------
// 2. A agenda
// -----------------------------------------------------
const CONTA = "conta-prevista-1";

/** O "Pagamento a Lais" do Helio, ou uma conta comum com os mesmos dados. */
function contaPrevista({ daDivisao = true, status = "pending", semAColuna = false } = {}) {
  const linha = {
    id: CONTA,
    user_id: HELIO,
    description: "Pagamento a Lais — Agropecuaria",
    amount: "71.87",
    due_date: "2026-10-20",
    status,
    transaction_type: "expense",
    direction: "expense",
    category_id: PAGAMENTO_A_PESSOA,
    subcategory_id: null,
    account_id: CORRENTE_DO_HELIO,
    group_id: null,
    notes: null,
    recurring_rule_id: null,
    paid_date: null,
    transaction_id: null,
    group_closing_id: null,
    expense_split_id: daDivisao ? PARTE : null,
    created_at: "2026-10-20T12:00:00Z",
    recurring_rule: null,
  };
  if (semAColuna) delete linha.expense_split_id;
  return linha;
}

/** Chama um handler com o duble e devolve `{ status, corpo, escritas, lidas }`. */
async function chamar(handler, { usuario = HELIO, tabelas, corpo = {}, params, errosDeEscrita }) {
  const d = criarDuble({ user: { id: usuario }, tabelas, errosDeEscrita });
  globalThis.__dubleDeSupabase = { sessao: () => d.client };
  let resposta;
  try {
    resposta = await handler({ json: async () => corpo }, { params });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }
  return {
    status: resposta.status,
    corpo: await resposta.json(),
    escritas: d.escritas,
    lidas: d.lidas,
  };
}

const daAgenda = (opcoes) => ({
  scheduled_transactions: [contaPrevista(opcoes)],
  financial_transactions: [],
  financial_services: [{ id: SERVICO, name: "personal_finance" }],
});

test("editar e excluir a conta da divisao respondem 409 com a frase, e nao gravam nada", async () => {
  const editar = await chamar(ROTA_PREVISTA.PATCH, {
    tabelas: daAgenda(),
    corpo: { description: "Pagamento a Lais — Agropecuaria", amount: 50, due_date: "2026-10-20" },
    params: { id: CONTA },
  });
  assert.equal(editar.status, 409);
  assert.equal(editar.corpo.error, MENSAGEM_DA_CONTA_DA_DIVISAO);
  assert.deepEqual(editar.escritas, []);

  // Excluir uma avulsa e um DELETE de verdade; pular uma de serie e `skipped`.
  // Nenhum dos dois pode sumir com a divida que o lancamento da Lais diz que
  // existe.
  const excluir = await chamar(ROTA_PREVISTA.DELETE, {
    tabelas: daAgenda(),
    params: { id: CONTA },
  });
  assert.equal(excluir.status, 409);
  assert.equal(excluir.corpo.error, MENSAGEM_DA_CONTA_DA_DIVISAO);
  assert.deepEqual(excluir.escritas, []);
});

test("CONTROLE: a conta comum, e a lida antes da colagem da 070, passam da guarda", async () => {
  for (const opcoes of [{ daDivisao: false }, { semAColuna: true }]) {
    const editar = await chamar(ROTA_PREVISTA.PATCH, {
      tabelas: daAgenda(opcoes),
      corpo: { amount: 50 },
      params: { id: CONTA },
    });
    assert.notEqual(editar.corpo.error, MENSAGEM_DA_CONTA_DA_DIVISAO);
    assert.ok(
      editar.escritas.some((e) => e.tabela === "scheduled_transactions" && e.verbo === "update"),
      `a conta ${JSON.stringify(opcoes)} deveria chegar ao UPDATE`
    );

    const excluir = await chamar(ROTA_PREVISTA.DELETE, {
      tabelas: daAgenda(opcoes),
      params: { id: CONTA },
    });
    assert.notEqual(excluir.corpo.error, MENSAGEM_DA_CONTA_DA_DIVISAO);
    assert.ok(
      excluir.escritas.some((e) => e.tabela === "scheduled_transactions"),
      `a conta ${JSON.stringify(opcoes)} deveria sair da agenda`
    );
  }
});

test("a guarda vem antes do 'ja foi paga': a conta da divisao paga ainda diz onde mudar", async () => {
  const r = await chamar(ROTA_PREVISTA.PATCH, {
    tabelas: daAgenda({ status: "paid" }),
    corpo: { amount: 50 },
    params: { id: CONTA },
  });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.error, MENSAGEM_DA_CONTA_DA_DIVISAO);
});

test("a baixa comum quita a conta da divisao: despesa na categoria e na conta dela", async () => {
  const r = await chamar(ROTA_PAY.POST, {
    tabelas: daAgenda(),
    corpo: { paid_date: "2026-10-21" },
    params: { id: CONTA },
  });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));

  const lancamento = r.escritas.find(
    (e) => e.tabela === "financial_transactions" && e.verbo === "insert"
  );
  assert.ok(lancamento, "a baixa deveria lancar a transacao");
  const [linha] = lancamento.linhas;
  assert.equal(linha.amount, -71.87);
  assert.equal(linha.transaction_type, "expense");
  assert.equal(linha.category_id, PAGAMENTO_A_PESSOA);
  assert.equal(linha.account_id, CORRENTE_DO_HELIO);

  const baixa = r.escritas.find(
    (e) => e.tabela === "scheduled_transactions" && e.verbo === "update"
  );
  assert.equal(baixa.patch.status, "paid");
  assert.equal(baixa.patch.transaction_id, linha.id);
});

// -----------------------------------------------------
// 3. A recusa da divisao ja paga
// -----------------------------------------------------
const doLancamento = () => ({
  financial_transactions: [
    {
      id: DESPESA,
      user_id: LAIS,
      amount: -79.86,
      transaction_type: "expense",
      category_id: "moradia",
      description: "Agropecuaria",
      transaction_date: "2026-10-20",
      group_id: null,
    },
  ],
  transaction_categories: [{ id: "moradia", is_expense: true }],
  expense_splits: [
    { id: PARTE, transaction_id: DESPESA, participant_id: HELIO, percentage: "90.00", status: "pending" },
  ],
});

test("editar o valor do lancamento ja acertado: 409 com a frase, e nao o 500", async () => {
  const r = await chamar(ROTA_LANCAMENTO.PATCH, {
    usuario: LAIS,
    tabelas: doLancamento(),
    corpo: { amount: -100 },
    params: { id: DESPESA },
    errosDeEscrita: { financial_transactions: { update: RECUSA_DA_070 } },
  });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.error, MENSAGEM_DA_DIVISAO_PAGA);

  // Controle: outra recusa de escrita continua sendo o 500 de antes.
  const outra = await chamar(ROTA_LANCAMENTO.PATCH, {
    usuario: LAIS,
    tabelas: doLancamento(),
    corpo: { amount: -100 },
    params: { id: DESPESA },
    errosDeEscrita: { financial_transactions: { update: { code: "23514", message: "check" } } },
  });
  assert.equal(outra.status, 500);
});

test("apagar o lancamento ja acertado: 409 com a frase; sem a recusa, apaga", async () => {
  const r = await chamar(ROTA_LANCAMENTO.DELETE, {
    usuario: LAIS,
    tabelas: doLancamento(),
    params: { id: DESPESA },
    errosDeEscrita: { financial_transactions: { delete: RECUSA_DA_070 } },
  });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.error, MENSAGEM_DA_DIVISAO_PAGA);

  const livre = await chamar(ROTA_LANCAMENTO.DELETE, {
    usuario: LAIS,
    tabelas: doLancamento(),
    params: { id: DESPESA },
  });
  assert.equal(livre.status, 200);
  assert.ok(
    livre.escritas.some((e) => e.tabela === "financial_transactions" && e.verbo === "delete")
  );
});

test("recusar a parte depois de um lado pagar: 409 com a frase; sem a recusa, recusa", async () => {
  const r = await chamar(ROTA_PARTES.PATCH, {
    tabelas: doLancamento(),
    corpo: { splitId: PARTE, action: "reject" },
    errosDeEscrita: { expense_splits: { update: RECUSA_DA_070 } },
  });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.error, MENSAGEM_DA_DIVISAO_PAGA);

  const livre = await chamar(ROTA_PARTES.PATCH, {
    tabelas: doLancamento(),
    corpo: { splitId: PARTE, action: "reject" },
  });
  assert.equal(livre.status, 200);
  assert.equal(livre.corpo.status, "rejected");
});
