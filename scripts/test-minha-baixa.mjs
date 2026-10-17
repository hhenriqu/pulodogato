#!/usr/bin/env node
// =====================================================
// PULODOGATO - o "pago" por pessoa: o gesto do membro e o leitor (HMO-411)
// =====================================================
//   npm run test:minha-baixa
//
// DUAS ROTAS, E NENHUMA PROVA A OUTRA
// -----------------------------------
//   * `POST/DELETE /api/scheduled-transactions/{id}/minha-baixa` -- o gesto que
//     faltava. A rota de baixa (`../pay`) filtra `.eq("user_id", user.id)` e
//     responde 404 para quem nao e o dono: a Lais ve a conta do grupo, aperta o
//     botao e leva "Conta prevista nao encontrada";
//   * `GET /api/expense-groups/{groupId}/scheduled` -- o LEITOR do que o gesto
//     grava. Sem ele o `reported` e dado sem leitor, que nesta base e o mesmo
//     que nao existir: a feature passaria verde com ninguem vendo nada.
//
// A ASSERCAO QUE CARREGA A ISSUE E A DA DECISAO D1
// ------------------------------------------------
// "A rota NAO grava lancamento nenhum." Ela e medida pela lista de escritas do
// duble, e nao por inspecao do fonte: um `insert` em `financial_transactions`
// aqui contaria a parte do membro DUAS vezes -- quando o dono da baixa, a
// trigger `auto_create_group_transaction` ja rateia a despesa e a parte da
// Lais ja fica realizada nos relatorios dela, via `group_share_entries`.
//
// O caso "ela ve o dobro do que gastou" nao produz erro nenhum: so um numero
// maior, plausivel. Por isso a assercao e sobre o CONJUNTO de tabelas tocadas,
// e nao sobre a ausencia de uma delas -- uma lista fechada reprova tambem o
// `insert` numa tabela de dinheiro que ainda nem existe.
//
// O ARBITRO DO `ON CONFLICT` E MEDIDO, E NAO CONFERIDO POR LEITURA
// ---------------------------------------------------------------
// `onConflict` que nao casa com a UNIQUE da 055 nao e ignorado pelo banco: o
// segundo toque estoura com chave duplicada. O duble (HMO-411) honra o
// arbitro, entao "o segundo toque nao cria linha nova" e uma assercao que
// consegue reprovar.
// =====================================================

import test, { after, before, mock } from "node:test";
import assert from "node:assert/strict";

import { criarDuble } from "./duble-de-supabase.mjs";

// O relogio congelado -- `relogio-congelado-em-teste-node`. A rota carimba
// `reported_at` com `new Date()`, e o CHECK `group_bill_payments_carimbos_check`
// recusa `reported` sem carimbo: sem congelar, a assercao sobre o carimbo
// mediria o relogio da maquina.
before(() => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-03-05T15:00:00Z") });
});

after(() => {
  mock.timers.reset();
});

const RAIZ = "../.tmp-minha-baixa";

const MINHA_BAIXA = await import(
  `${RAIZ}/app/api/scheduled-transactions/[id]/minha-baixa/route.js`
);
const PREVISTAS_DO_GRUPO = await import(
  `${RAIZ}/app/api/expense-groups/[groupId]/scheduled/route.js`
);

// As frases vem do lib, e nao da rota: `route.ts` do App Router nao pode
// exportar nada fora do que o Next conhece (o `next build` reprova com "«X» is
// not a valid Route export field", e so ele reprova). Comparar o corpo da
// resposta com estas constantes -- e nao com literal repetido aqui -- e o que
// faz a suite reprovar quando a rota passa a devolver outra coisa.
const FRASES = await import(`${RAIZ}/lib/conta-de-grupo-na-agenda.js`);

const O_HELIO = "11111111-1111-1111-1111-111111111111";
const A_LAIS = "22222222-2222-2222-2222-222222222222";
const A_ANA = "33333333-3333-3333-3333-333333333333";
const GRUPO_CASA = "99999999-9999-9999-9999-999999999999";
const O_ALUGUEL = "aaaaaaaa-0000-0000-0000-000000000001";
/** Uma conta individual da Lais -- o controle de "nao e de grupo". */
const A_LUZ_DA_LAIS = "aaaaaaaa-0000-0000-0000-000000000002";

/** O aluguel do grupo Casa: do Helio, R$ 3.000, vence dia 10. */
const ALUGUEL = {
  id: O_ALUGUEL,
  user_id: O_HELIO,
  group_id: GRUPO_CASA,
  description: "Aluguel",
  amount: 3000,
  due_date: "2026-03-10",
  status: "pending",
  effective_status: "pending",
  days_until_due: 5,
  recurring_rule_id: null,
  category_id: null,
};

const MEMBROS = [
  { id: "m1", group_id: GRUPO_CASA, user_id: O_HELIO, percentage: 40, status: "active" },
  { id: "m2", group_id: GRUPO_CASA, user_id: A_LAIS, percentage: 35, status: "active" },
  { id: "m3", group_id: GRUPO_CASA, user_id: A_ANA, percentage: 25, status: "active" },
];

const PERFIS = [
  { id: O_HELIO, full_name: "Hélio" },
  { id: A_LAIS, full_name: "Laís" },
  { id: A_ANA, full_name: "Ana" },
];

/**
 * O duble, com a RLS da 055 modelada A MAO nas linhas de pagamento.
 *
 * O duble nao tem RLS (ver o cabecalho de scripts/duble-de-supabase.mjs), e a
 * policy de SELECT da 055 faz um recorte que o leitor do grupo depende: uma
 * linha de pagamento e visivel para a dona DELA e para o dono da CONTA
 * PREVISTA, e para mais ninguem. Entao quem monta o fixture ja entrega o que a
 * policy entregaria -- e e por isso que o caso "a Lais nao ve a Ana" consegue
 * ser escrito aqui.
 */
function duble(quemOlha, { pagamentos = [], previstas = [ALUGUEL] } = {}) {
  const visiveis = pagamentos.filter(
    (p) =>
      p.user_id === quemOlha ||
      previstas.some((s) => s.id === p.scheduled_transaction_id && s.user_id === quemOlha)
  );

  return criarDuble({
    user: { id: quemOlha },
    tabelas: {
      scheduled_transactions: previstas,
      scheduled_transactions_effective: previstas,
      group_bill_payments: visiveis,
      group_members: MEMBROS,
      profiles: PERFIS,
      transaction_categories: [],
    },
  });
}

async function chamar(handler, d, { params, url } = {}) {
  globalThis.__dubleDeSupabase = { sessao: () => d.client, servico: () => d.client };
  try {
    const pedido = new Request(url ?? "http://t/x", { method: "POST" });
    const resposta = await handler(pedido, { params });
    return { status: resposta.status, corpo: await resposta.json() };
  } finally {
    delete globalThis.__dubleDeSupabase;
  }
}

// ---------------------------------------------------------------------------
// SECAO 1: A DECISAO D1 -- so o status, nenhum lancamento
// ---------------------------------------------------------------------------

test("o aviso grava a linha de pagamento em `reported`, com carimbo", async () => {
  const d = duble(A_LAIS);
  const { status, corpo } = await chamar(MINHA_BAIXA.POST, d, {
    params: { id: O_ALUGUEL },
  });

  assert.equal(status, 200);
  assert.equal(corpo.success, true);

  const escritas = d.escritas.filter((e) => e.tabela === "group_bill_payments");
  assert.equal(escritas.length, 1, "o aviso devia escrever UMA vez");

  const [linha] = escritas[0].linhas;
  assert.equal(linha.user_id, A_LAIS);
  assert.equal(linha.scheduled_transaction_id, O_ALUGUEL);
  assert.equal(linha.status, "reported");
  // O CARIMBO NAO E ENFEITE: o CHECK `group_bill_payments_carimbos_check`
  // recusa `reported` sem `reported_at`, porque a tela do grupo escreve
  // "avisou que pagou" COM a data -- sem carimbo viraria "avisou em
  // --/--/----". Sem esta assercao a rota passaria verde gravando `null` e o
  // 400 so apareceria em producao.
  assert.equal(linha.reported_at, "2026-03-05T15:00:00.000Z");
  // `confirmed_at` E DO DONO. A trigger `group_bill_payments_trava_do_membro`
  // recusa o UPDATE do membro que a mexesse, e manda-la aqui seria pedir 400.
  assert.equal(linha.confirmed_at, undefined);
});

test("DECISAO D1: o aviso NAO grava lancamento nenhum", async () => {
  const d = duble(A_LAIS);
  await chamar(MINHA_BAIXA.POST, d, { params: { id: O_ALUGUEL } });

  // A LISTA E FECHADA, e nao um `assert(!tocou("financial_transactions"))`.
  //
  // Nomear a tabela proibida mede uma tabela so: um `insert` em
  // `group_transactions`, em `group_share_entries` ou numa tabela de dinheiro
  // que ainda nao existe passaria verde pela mesma assercao. O defeito aqui
  // nao produz erro -- so a parte da pessoa contada DUAS vezes, com cara de
  // numero certo --, entao o que se prende e o conjunto inteiro.
  const tabelasEscritas = [...new Set(d.escritas.map((e) => e.tabela))];
  assert.deepEqual(
    tabelasEscritas,
    ["group_bill_payments"],
    `o aviso escreveu fora de group_bill_payments: ${tabelasEscritas.join(", ")}`
  );
});

test("CONTROLE POSITIVO da assercao acima: ela ve uma escrita a mais", async () => {
  // Sem este caso, a assercao de D1 passaria verde se o duble simplesmente
  // nao registrasse escrita nenhuma -- `suite-vermelha-faz-todo-controle-
  // negativo-passar-vacuo` aplicado a uma lista vazia. Aqui a MESMA leitura
  // de `d.escritas` ve duas tabelas, e isso prova que ela enxerga.
  const d = duble(A_LAIS);
  await chamar(MINHA_BAIXA.POST, d, { params: { id: O_ALUGUEL } });
  await d.client.from("financial_transactions").insert({ amount: 1 });

  const tabelasEscritas = [...new Set(d.escritas.map((e) => e.tabela))];
  assert.deepEqual(tabelasEscritas.sort(), [
    "financial_transactions",
    "group_bill_payments",
  ]);
});

// ---------------------------------------------------------------------------
// SECAO 2: O ARBITRO DO `ON CONFLICT`
// ---------------------------------------------------------------------------

test("o segundo toque nao cria linha nova -- e responde 'voce ja avisou'", async () => {
  const d = duble(A_LAIS);
  await chamar(MINHA_BAIXA.POST, d, { params: { id: O_ALUGUEL } });

  const depoisDoPrimeiro = d.escritas.length;

  const segundo = await chamar(MINHA_BAIXA.POST, d, { params: { id: O_ALUGUEL } });

  assert.equal(segundo.status, 200, "o duplo toque no celular nao e erro");
  assert.equal(segundo.corpo.message, FRASES.JA_AVISADO);
  // NENHUMA ESCRITA NOVA. O `USING` da policy de UPDATE da 055 exige `pending`
  // na linha ANTIGA, e num `INSERT ... ON CONFLICT DO UPDATE` o Postgres
  // aborta a instrucao inteira quando ele recusa: um upsert cego aqui seria um
  // 500 com texto de RLS na cara da pessoa.
  assert.equal(
    d.escritas.length,
    depoisDoPrimeiro,
    "o segundo toque escreveu de novo"
  );
});

test("o arbitro do upsert e a UNIQUE da 055, e nao outra coluna", async () => {
  // A ROTA NOMEIA O ARBITRO, E ELE TEM DE SER O DA CONSTRAINT. `onConflict`
  // que nao casa com uma UNIQUE existente nao e ignorado pelo banco -- o
  // segundo insert estoura com chave duplicada --, e indice PARCIAL nao
  // arbitra `ON CONFLICT`. A `group_bill_payments_unico` e
  // `(scheduled_transaction_id, user_id)`, sem `WHERE`.
  //
  // Medido pelo COMPORTAMENTO, com uma linha ja semeada: se o arbitro
  // estivesse errado, o duble nao a acharia e gravaria uma SEGUNDA linha para
  // a mesma pessoa na mesma conta.
  const d = duble(A_LAIS, {
    pagamentos: [
      {
        id: "p-velha",
        scheduled_transaction_id: O_ALUGUEL,
        user_id: A_LAIS,
        status: "pending",
        reported_at: null,
      },
    ],
  });

  await chamar(MINHA_BAIXA.POST, d, { params: { id: O_ALUGUEL } });

  const inserts = d.escritas.filter((e) => e.verbo === "upsert-insert");
  const updates = d.escritas.filter((e) => e.verbo === "upsert-update");

  assert.equal(inserts.length, 0, "o upsert criou linha nova sobre a que existia");
  assert.equal(updates.length, 1, "o upsert nao achou a linha pela UNIQUE");
  assert.equal(updates[0].linhas[0].status, "reported");
});

// ---------------------------------------------------------------------------
// SECAO 3: QUEM NAO PODE AVISAR
// ---------------------------------------------------------------------------

test("o DONO da conta e mandado para o botao de dar baixa, e nada e gravado", async () => {
  // A RLS NAO RECUSA ESTE CASO -- o Helio e membro do grupo e dono da conta,
  // e a policy de INSERT da 055 aprovaria. O que ele criaria e uma linha de
  // pagamento que a view NUNCA le: para linha propria `my_status` sai de
  // `s.status::text` e ignora `group_bill_payments`. Estado gravado sem
  // leitor, que nesta base e o mesmo que nao existir.
  const d = duble(O_HELIO);
  const { status, corpo } = await chamar(MINHA_BAIXA.POST, d, {
    params: { id: O_ALUGUEL },
  });

  assert.equal(status, 409);
  assert.equal(corpo.error, FRASES.RECUSA_DA_CONTA_PROPRIA);
  // A FRASE TEM DE DIZER PARA ONDE IR. Uma recusa que nao aponta o outro botao
  // deixa a pessoa onde o 404 da `../pay` ja a deixava.
  assert.match(corpo.error, /baixa/i);
  assert.equal(d.escritas.length, 0);
});

test("conta que NAO e de grupo responde 404, e nada e gravado", async () => {
  const d = duble(A_LAIS, {
    previstas: [
      {
        ...ALUGUEL,
        id: A_LUZ_DA_LAIS,
        user_id: A_ANA,
        group_id: null,
        description: "Luz da Ana",
      },
    ],
  });

  const { status } = await chamar(MINHA_BAIXA.POST, d, {
    params: { id: A_LUZ_DA_LAIS },
  });

  assert.equal(status, 404);
  assert.equal(d.escritas.length, 0);
});

test("conta inexistente responde 404 com a MESMA frase da ../pay", async () => {
  const d = duble(A_LAIS);
  const { status, corpo } = await chamar(MINHA_BAIXA.POST, d, {
    params: { id: "00000000-0000-0000-0000-000000000000" },
  });

  assert.equal(status, 404);
  // A MESMA frase de "nao e sua" de proposito: distinguir as duas diria a um
  // estranho que o id existe.
  assert.equal(corpo.error, "Conta prevista não encontrada");
});

test("depois de o dono confirmar, o membro nao desfaz nem reavisa", async () => {
  const confirmada = [
    {
      id: "p-paga",
      scheduled_transaction_id: O_ALUGUEL,
      user_id: A_LAIS,
      status: "paid",
      reported_at: "2026-03-04T10:00:00.000Z",
      confirmed_at: "2026-03-05T10:00:00.000Z",
    },
  ];

  for (const verbo of ["POST", "DELETE"]) {
    const d = duble(A_LAIS, { pagamentos: confirmada });
    const { status, corpo } = await chamar(MINHA_BAIXA[verbo], d, {
      params: { id: O_ALUGUEL },
    });

    assert.equal(status, 409, `${verbo} devia recusar depois do paid`);
    assert.equal(corpo.error, FRASES.JA_CONFIRMADO);
    assert.equal(d.escritas.length, 0, `${verbo} escreveu depois do paid`);
  }
});

// ---------------------------------------------------------------------------
// SECAO 4: O DESFAZER
// ---------------------------------------------------------------------------

test("desfazer apaga a MINHA linha -- e linha ausente e `pending` de novo", async () => {
  // O DESFAZER EXISTE POR CAUSA DO COALESCE DA VIEW: apagar a linha e voltar
  // ao estado inicial. Sem ele quem tocou por engano fica em `reported` para
  // sempre -- o `USING` da policy de UPDATE exige `pending` e nao ha volta.
  const d = duble(A_LAIS, {
    pagamentos: [
      {
        id: "p-avisada",
        scheduled_transaction_id: O_ALUGUEL,
        user_id: A_LAIS,
        status: "reported",
        reported_at: "2026-03-04T10:00:00.000Z",
      },
    ],
  });

  const { status } = await chamar(MINHA_BAIXA.DELETE, d, {
    params: { id: O_ALUGUEL },
  });

  assert.equal(status, 200);

  const apagou = d.escritas.filter((e) => e.verbo === "delete");
  assert.equal(apagou.length, 1);
  // OS DOIS FILTROS, e o segundo nao e redundante com a RLS: DELETE recusado
  // pela RLS volta 200 sem apagar nada, entao um id trocado sem o
  // `user_id = eu` seria um apagao silencioso de linha alheia.
  const colunas = apagou[0].filtros.map(([, coluna]) => coluna).sort();
  assert.deepEqual(colunas, ["scheduled_transaction_id", "user_id"]);
});

test("desfazer sem linha nenhuma e 200, e nao 404", async () => {
  // "Desfazer o que nao existe" ja E o resultado pedido. Um erro aqui
  // transformaria o duplo toque num alarme.
  const d = duble(A_LAIS);
  const { status, corpo } = await chamar(MINHA_BAIXA.DELETE, d, {
    params: { id: O_ALUGUEL },
  });

  assert.equal(status, 200);
  assert.equal(corpo.success, true);
  assert.equal(d.escritas.length, 0);
});

// ---------------------------------------------------------------------------
// SECAO 5: O LEITOR -- sem ele o `reported` e dado sem leitor
// ---------------------------------------------------------------------------

async function quadro(quemOlha, pagamentos) {
  const d = duble(quemOlha, { pagamentos });
  globalThis.__dubleDeSupabase = { sessao: () => d.client, servico: () => d.client };
  try {
    const resposta = await PREVISTAS_DO_GRUPO.GET(
      new Request(`http://t/api/expense-groups/${GRUPO_CASA}/scheduled`),
      { params: { groupId: GRUPO_CASA } }
    );
    const corpo = await resposta.json();
    return corpo.scheduled?.[0];
  } finally {
    delete globalThis.__dubleDeSupabase;
  }
}

const AVISO_DA_LAIS = {
  id: "p-lais",
  scheduled_transaction_id: O_ALUGUEL,
  user_id: A_LAIS,
  status: "reported",
  reported_at: "2026-03-04T10:00:00.000Z",
};

test("o DONO ve o quadro inteiro: Helio pendente · Laís avisou · Ana pendente", async () => {
  const linha = await quadro(O_HELIO, [AVISO_DA_LAIS]);

  assert.ok(linha, "a previsao do grupo sumiu da resposta");
  assert.equal(linha.estado_parcial, false);

  const porPessoa = Object.fromEntries(
    linha.estado_por_membro.map((m) => [m.full_name, m.estado])
  );

  assert.deepEqual(porPessoa, {
    // O DONO SAI DO `status` DA CONTA, e nao de `group_bill_payments`: ele
    // nunca tem linha la. A conta so chega aqui com `status <> 'paid'`, logo
    // ele esta pendente -- e a linha dele existe porque um quadro que comeca
    // na Lais faz parecer que o Helio nao deve nada.
    "Hélio": "pendente",
    "Laís": "avisou",
    Ana: "pendente",
  });
});

test("o leitor VE a diferenca que o gesto faz -- sem aviso, ninguem avisou", async () => {
  // O CONTROLE NEGATIVO do caso acima. Sem ele, um `estado` cravado em
  // "avisou" passaria verde: `sonda-que-se-mede-a-si-mesma`.
  const linha = await quadro(O_HELIO, []);
  const estados = [...new Set(linha.estado_por_membro.map((m) => m.estado))];
  assert.deepEqual(estados, ["pendente"]);
});

test("a confirmacao do dono aparece como `pago` no quadro", async () => {
  const linha = await quadro(O_HELIO, [
    { ...AVISO_DA_LAIS, status: "paid", confirmed_at: "2026-03-05T11:00:00.000Z" },
  ]);

  const lais = linha.estado_por_membro.find((m) => m.full_name === "Laís");
  assert.equal(lais.estado, "pago");
});

test("quem NAO criou a conta nao recebe 'Ana pendente' inventada", async () => {
  // A ARMADILHA DESTA ROTA, E ELA E DE HONESTIDADE E NAO DE SEGURANCA.
  //
  // A policy de SELECT da 055 esconde da Lais a linha da Ana. Linha ausente
  // vale `pending` pelo COALESCE da view -- mas "a Ana nao tem linha" e "a RLS
  // escondeu a linha da Ana" chegam aqui IDENTICOS, e a Ana pode ter avisado
  // ha uma semana. Imprimir "Ana pendente" seria inventar.
  const linha = await quadro(A_LAIS, [AVISO_DA_LAIS]);

  const nomes = linha.estado_por_membro.map((m) => m.full_name).sort();
  assert.deepEqual(
    nomes,
    ["Hélio", "Laís"],
    "a Lais recebeu o estado de quem a RLS esconde dela"
  );

  // E A TELA TEM DE SABER POR QUE A LISTA ESTA CURTA: sem esta flag, "so nos
  // dois no grupo" e "nao posso ver os outros" sao a mesma lista.
  assert.equal(linha.estado_parcial, true);

  const lais = linha.estado_por_membro.find((m) => m.full_name === "Laís");
  assert.equal(lais.estado, "avisou", "a Lais nao ve o proprio aviso");
});

test("o grupo continua SEM status de pago: a conta paga nao volta as previstas", async () => {
  // Pedido do Helio, e esta certo: quando o dono da baixa, a despesa vira real,
  // o rateio nasce e a linha passa para a aba de DESPESAS. O `.neq("status",
  // "paid")` da rota continua lendo o status do DONO de proposito -- a
  // pergunta aqui e sobre a CONTA, nao sobre a pessoa.
  const d = duble(O_HELIO, {
    previstas: [{ ...ALUGUEL, status: "paid", effective_status: "paid" }],
    pagamentos: [AVISO_DA_LAIS],
  });

  globalThis.__dubleDeSupabase = { sessao: () => d.client, servico: () => d.client };
  try {
    const resposta = await PREVISTAS_DO_GRUPO.GET(
      new Request(`http://t/api/expense-groups/${GRUPO_CASA}/scheduled`),
      { params: { groupId: GRUPO_CASA } }
    );
    const corpo = await resposta.json();
    assert.deepEqual(corpo.scheduled, []);
  } finally {
    delete globalThis.__dubleDeSupabase;
  }
});
