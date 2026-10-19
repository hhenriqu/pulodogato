#!/usr/bin/env node
// =====================================================
// PULODOGATO - a travessa de arquivar o grupo mede SALDO, nao status de parte
// (HMO-426)
// =====================================================
//   npm run test:travessa-de-arquivar
//
// O DEFEITO QUE ESTA SUITE FIXA
// -----------------------------
// `lib/services/expense-groups.ts` recusava arquivar o grupo quando alguma
// parte estava `status = 'pending'`. A HMO-425 tirou do app o aprovar/recusar a
// propria parte -- a rota PATCH de `splits`, a lib e os botoes --, e com isso
// nenhum caminho nosso escreve mais nada naquela coluna: toda parte nasce
// 'pending' e fica.
//
// Resultado medido na leitura do codigo e reproduzido aqui: grupo com QUALQUER
// despesa lancada nao podia mais ser arquivado nem apagado, para sempre, e a
// porta de saida que a mensagem antiga nomeava ("Finalize todas as divisoes
// primeiro") havia sido removida na mesma issue.
//
// O criterio certo e saldo diferente de zero em `group_member_balances` -- o
// numero que a tela do grupo mostra. Grupo acertado pode ser arquivado; grupo
// devendo continua travado.
//
// POR QUE AS DUAS ROTAS, E NAO A FUNCAO SOZINHA
// ---------------------------------------------
// A funcao devolve `{situacao}` e nao decide nada. Quem decide entre 400, 503 e
// escrever sao as duas rotas, cada uma com a SUA copia do bloco -- e o defeito
// irmao desta issue (HMO-145) tambem estava escrito duas vezes. Consertar um
// caminho e deixar o outro e o modo de falha mais provavel aqui, e so uma
// sonda que chame os dois handlers o enxerga.
//
// A ORDEM "LER ANTES DE ESCREVER" E MEDIDA POR AUSENCIA DE ESCRITA
// ----------------------------------------------------------------
// A view recorta pelo membro ATIVO (`WHERE m.status = 'active'` na 026), entao
// uma travessa consultada DEPOIS do UPDATE que arquiva os membros responderia
// "nao ha saldo em aberto" sempre -- a falha aberta de volta, agora por ordem
// em vez de por consulta errada. Os casos de recusa abaixo exigem
// `escritas: []`: se a leitura tivesse mudado de lugar, as escritas teriam
// acontecido antes da recusa e a lista nao estaria vazia.
//
// O QUE ESTA SUITE NAO MEDE, E QUEM MEDE
// --------------------------------------
// A comparacao `net_balance <> 0` acontece no POSTGRES (ver o porque em
// lib/services/expense-groups.ts). O duble a imita em JavaScript, entao o que
// esta aqui e o comportamento da ROTA em cima da resposta -- os fixtures usam
// numeros porque e assim que o duble filtra. Que a view de verdade devolva zero
// num grupo acertado e valor em aberto num grupo devendo, com as partes todas
// 'pending' nos dois casos, e provado contra um Postgres de verdade em
// database/tests/hmo426_saldo_em_aberto_trava_arquivar_test.sql. As duas metades
// sao necessarias: sem a de SQL, esta suite estaria afirmando que a rota reage
// certo a um numero que ninguem conferiu que o banco produz.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import { criarDuble } from "./duble-de-supabase.mjs";

const ROTA_GRUPO = await import(
  "../.tmp-travessa-de-arquivar/app/api/expense-groups/[groupId]/route.js"
);
const ROTA_SAIR = await import(
  "../.tmp-travessa-de-arquivar/app/api/expense-groups/[groupId]/leave/route.js"
);

const GRUPO = "grupo-viagem";
const VIZINHO = "grupo-do-vizinho";
const ADMIN = "helio";
const MEMBRA = "ana";

/**
 * As partes como elas ficaram DEPOIS da HMO-425: todas 'pending', e nada no app
 * capaz de mudar isso.
 *
 * Elas estao em todo fixture de proposito, inclusive nos casos que esperam
 * sucesso. Sao elas que fazem o criterio ANTIGO ser distinguivel do novo: sem
 * nenhuma parte 'pending' no fixture, a travessa velha tambem deixaria arquivar
 * e o caso da issue passaria verde sobre o defeito.
 */
function despesasComPartesPendentes() {
  return {
    group_transactions: [
      { id: "gt-1", group_id: GRUPO, transaction_id: "ft-1" },
      { id: "gt-2", group_id: GRUPO, transaction_id: "ft-2" },
    ],
    group_expense_splits: [
      { id: "s-1", group_transaction_id: "gt-1", member_id: "m-admin", status: "pending" },
      { id: "s-2", group_transaction_id: "gt-1", member_id: "m-membra", status: "pending" },
      { id: "s-3", group_transaction_id: "gt-2", member_id: "m-admin", status: "pending" },
    ],
  };
}

/** O grupo acertado: todo mundo em zero. E o caso que a issue cobra. */
const TODOS_EM_ZERO = [
  { group_id: GRUPO, user_id: ADMIN, member_id: "m-admin", net_balance: 0 },
  { group_id: GRUPO, user_id: MEMBRA, member_id: "m-membra", net_balance: 0 },
];

/** O grupo devendo: Helio tem R$ 50 a receber de Ana. */
const SALDO_EM_ABERTO = [
  { group_id: GRUPO, user_id: ADMIN, member_id: "m-admin", net_balance: 50 },
  { group_id: GRUPO, user_id: MEMBRA, member_id: "m-membra", net_balance: -50 },
];

/**
 * A linha de membro de quem pede. `sozinho` decide qual dos dois caminhos de
 * `POST .../leave` roda: com um membro ativo so, ele arquiva o grupo (e passa
 * pela travessa); com dois, ele apenas remove a pessoa e nao passa por aqui.
 */
function membros({ sozinho }) {
  const admin = {
    id: "m-admin",
    group_id: GRUPO,
    user_id: ADMIN,
    role: "admin",
    status: "active",
  };
  if (sozinho) return [admin];
  return [
    admin,
    {
      id: "m-membra",
      group_id: GRUPO,
      user_id: MEMBRA,
      role: "member",
      status: "active",
    },
  ];
}

/**
 * Monta o duble e chama um dos dois handlers.
 *
 * `erroNaView` usa o botao `erros` do duble, e o SQLSTATE e o 42703 de verdade
 * -- o mesmo que a HMO-145 mediu contra o PostgREST de producao. O ponto nao e
 * o codigo: e que um erro de leitura NAO pode virar "nao ha saldo em aberto".
 */
async function pedir({
  acao,
  saldos = TODOS_EM_ZERO,
  sozinho = true,
  erroNaView = null,
  grupo = GRUPO,
}) {
  const expense_groups = [
    { id: GRUPO, name: "Viagem a Bahia", is_active: true, currency: "BRL" },
    { id: VIZINHO, name: "Grupo do vizinho", is_active: true, currency: "BRL" },
  ];
  const group_members = membros({ sozinho });
  const pendentes = despesasComPartesPendentes();

  const sessao = criarDuble({
    user: { id: ADMIN },
    tabelas: {
      expense_groups,
      group_members,
      group_member_balances: saldos,
      ...pendentes,
    },
    erros: erroNaView ? { group_member_balances: erroNaView } : {},
  });

  globalThis.__dubleDeSupabase = { sessao: () => sessao.client };

  let resposta;
  let chamadasDeSessao;
  try {
    resposta =
      acao === "apagar"
        ? await ROTA_GRUPO.DELETE({}, { params: { groupId: grupo } })
        : await ROTA_SAIR.POST({}, { params: { groupId: grupo } });
    chamadasDeSessao = globalThis.__dubleDeSupabase.chamadasDeSessao ?? 0;
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  return {
    status: resposta.status,
    corpo: await resposta.json(),
    grupos: expense_groups,
    membros: group_members,
    escritas: sessao.escritas,
    lidas: sessao.lidas,
    chamadasDeSessao,
  };
}

const grupoDe = (grupos, id) => grupos.find((g) => g.id === id);

// ---------------------------------------------------------------------------
// 1. O DEFEITO DA ISSUE: grupo ACERTADO, partes todas 'pending'
// ---------------------------------------------------------------------------
// Antes do conserto os dois casos abaixo respondiam 400 e o grupo ficava ativo
// para sempre. A assercao e sobre a TABELA, e nao sobre o 200: a rota de
// restaurar grupo ja respondeu "sucesso" sobre uma escrita que nao aconteceu
// (HMO-203), e `is_active` e o que diz se arquivou.

test("APAGAR o grupo acertado funciona, com as partes todas 'pending'", async () => {
  const r = await pedir({ acao: "apagar", sozinho: false });

  assert.equal(r.status, 200, `arquivou? corpo: ${JSON.stringify(r.corpo)}`);
  assert.equal(
    grupoDe(r.grupos, GRUPO).is_active,
    false,
    "o grupo TEM de sair da lista ativa"
  );
  assert.ok(r.corpo.archived_at, "a resposta devolve quando arquivou");
  // Os membros tambem: grupo arquivado cujos membros continuam 'active' fica
  // invisivel nas duas telas (ver o comentario da rota).
  assert.deepEqual(
    r.membros.map((m) => m.status),
    ["archived", "archived"],
    "os dois membros ficam arquivados"
  );
  // Controle positivo do aparelho: sem isto, tudo aqui passaria verde com a
  // rota tendo pegado um client que nao e o duble. Ver o cabecalho de
  // scripts/monta-duble-de-rota.mjs.
  assert.ok(r.chamadasDeSessao > 0, "a rota usou o client do duble");
});

test("SAIR como ultimo membro do grupo acertado arquiva, com as partes 'pending'", async () => {
  const r = await pedir({ acao: "sair", sozinho: true });

  assert.equal(r.status, 200, `arquivou? corpo: ${JSON.stringify(r.corpo)}`);
  assert.equal(r.corpo.action, "group_archived");
  assert.equal(
    grupoDe(r.grupos, GRUPO).is_active,
    false,
    "o grupo TEM de sair da lista ativa"
  );
  assert.equal(r.membros[0].status, "archived", "o ultimo membro fica arquivado");
  assert.ok(r.chamadasDeSessao > 0, "a rota usou o client do duble");
});

// ---------------------------------------------------------------------------
// 2. O QUE A TRAVESSA CONTINUA PROTEGENDO: saldo em aberto
// ---------------------------------------------------------------------------
// Este e o lado que nao pode ter sido afrouxado pelo conserto. Arquivar esconde
// o registro de quem devia a quem das duas telas, e nao ha caminho de volta
// pelo app.

test("APAGAR o grupo com saldo em aberto recusa, e NAO escreve nada", async () => {
  const r = await pedir({ acao: "apagar", saldos: SALDO_EM_ABERTO, sozinho: false });

  assert.equal(r.status, 400, `recusou? corpo: ${JSON.stringify(r.corpo)}`);
  assert.equal(
    grupoDe(r.grupos, GRUPO).is_active,
    true,
    "o grupo com divida em aberto continua ativo"
  );
  // A lista VAZIA e o que prova a ordem (ver o cabecalho): a travessa foi
  // consultada antes de qualquer escrita, senao os UPDATEs teriam saido.
  assert.deepEqual(
    r.escritas,
    [],
    `a rota escreveu antes de recusar: ${JSON.stringify(r.escritas)}`
  );
});

test("SAIR como ultimo membro com saldo em aberto recusa, e NAO escreve nada", async () => {
  const r = await pedir({ acao: "sair", saldos: SALDO_EM_ABERTO, sozinho: true });

  assert.equal(r.status, 400, `recusou? corpo: ${JSON.stringify(r.corpo)}`);
  assert.equal(grupoDe(r.grupos, GRUPO).is_active, true, "o grupo continua ativo");
  assert.equal(r.membros[0].status, "active", "quem pediu continua membro");
  assert.deepEqual(
    r.escritas,
    [],
    `a rota escreveu antes de recusar: ${JSON.stringify(r.escritas)}`
  );
});

test("UM CENTAVO em aberto ja trava as duas acoes", async () => {
  // `net_balance` e numeric(15,2) e um centavo e divida: quem arredondasse a
  // comparacao (ou tolerasse "quase zero", como o `residual` da tela de saldos
  // faz de proposito com `<= 1` centavo) passaria nos dois casos acima e
  // falharia aqui. O acerto exato existe -- lib/settlement.ts fecha em
  // centavos --, entao nao ha caso legitimo para a tolerancia.
  const umCentavo = [
    { group_id: GRUPO, user_id: ADMIN, member_id: "m-admin", net_balance: 0.01 },
    { group_id: GRUPO, user_id: MEMBRA, member_id: "m-membra", net_balance: -0.01 },
  ];

  const apagar = await pedir({ acao: "apagar", saldos: umCentavo, sozinho: false });
  assert.equal(apagar.status, 400, "apagar com um centavo em aberto");
  assert.equal(grupoDe(apagar.grupos, GRUPO).is_active, true);

  const sair = await pedir({ acao: "sair", saldos: umCentavo, sozinho: true });
  assert.equal(sair.status, 400, "sair com um centavo em aberto");
  assert.equal(grupoDe(sair.grupos, GRUPO).is_active, true);
});

// ---------------------------------------------------------------------------
// 3. "NAO DEU PARA SABER" RECUSA JUNTO COM "HA"  (a travessa da HMO-145)
// ---------------------------------------------------------------------------
// O contrato de tres estados nasceu de um bug real: a consulta dava 42703, o
// `error` nao era lido, `data` vinha `null`, e a travessa concluia "nao ha" --
// SEMPRE. Falha aberta, sem log e sem sintoma. O conserto do criterio nao pode
// ter colapsado os tres em dois.

test("erro ao ler a view: APAGAR responde 503 e NAO escreve nada", async () => {
  const r = await pedir({
    acao: "apagar",
    sozinho: false,
    erroNaView: { code: "42703", message: 'column "net_balance" does not exist' },
  });

  assert.equal(r.status, 503, `corpo: ${JSON.stringify(r.corpo)}`);
  assert.equal(
    grupoDe(r.grupos, GRUPO).is_active,
    true,
    "erro de leitura NAO pode virar 'nao ha saldo em aberto'"
  );
  assert.deepEqual(r.escritas, [], `a rota escreveu: ${JSON.stringify(r.escritas)}`);
});

test("erro ao ler a view: SAIR responde 503 e NAO escreve nada", async () => {
  const r = await pedir({
    acao: "sair",
    sozinho: true,
    erroNaView: { code: "42703", message: 'column "net_balance" does not exist' },
  });

  assert.equal(r.status, 503, `corpo: ${JSON.stringify(r.corpo)}`);
  assert.equal(grupoDe(r.grupos, GRUPO).is_active, true);
  assert.equal(r.membros[0].status, "active", "quem pediu continua membro");
  assert.deepEqual(r.escritas, [], `a rota escreveu: ${JSON.stringify(r.escritas)}`);
});

// ---------------------------------------------------------------------------
// 4. O RECORTE POR GRUPO
// ---------------------------------------------------------------------------

test("saldo em aberto em OUTRO grupo nao trava este", async () => {
  // Sem este caso, uma travessa que esquecesse o `.eq("group_id", ...)` passaria
  // em tudo acima: os fixtures de cima tem um grupo so com saldo, e "o meu
  // saldo" e "o saldo de todos os grupos" sao o mesmo conjunto ali. O efeito em
  // producao seria o grupo acertado travado por uma divida de outra viagem.
  const saldoDoVizinho = [
    ...TODOS_EM_ZERO,
    { group_id: VIZINHO, user_id: ADMIN, member_id: "m-vizinho", net_balance: -480.9 },
  ];

  const apagar = await pedir({ acao: "apagar", saldos: saldoDoVizinho, sozinho: false });
  assert.equal(apagar.status, 200, `corpo: ${JSON.stringify(apagar.corpo)}`);
  assert.equal(grupoDe(apagar.grupos, GRUPO).is_active, false);

  const sair = await pedir({ acao: "sair", saldos: saldoDoVizinho, sozinho: true });
  assert.equal(sair.status, 200, `corpo: ${JSON.stringify(sair.corpo)}`);
  assert.equal(grupoDe(sair.grupos, GRUPO).is_active, false);
});

// ---------------------------------------------------------------------------
// 5. O CRITERIO ANTIGO SAIU DE VERDADE
// ---------------------------------------------------------------------------

test("a travessa le a view de saldo e NAO le o status das partes", async () => {
  // Os casos de cima provam o COMPORTAMENTO; este prova de onde ele veio. Um
  // criterio que lesse as duas coisas -- saldo E status de parte -- passaria em
  // 1, 2, 3 e 4 e traria de volta o travamento eterno no primeiro grupo cujos
  // saldos zerassem com parte pendente, que e o caso normal depois da HMO-425.
  for (const acao of ["apagar", "sair"]) {
    const r = await pedir({ acao, sozinho: acao === "sair" });

    const tabelas = r.lidas.map((l) => l.tabela);
    assert.ok(
      tabelas.includes("group_member_balances"),
      `${acao}: a travessa nao leu group_member_balances. Leu: ${tabelas.join(", ")}`
    );
    assert.ok(
      !tabelas.includes("group_expense_splits"),
      `${acao}: ainda ha leitura de group_expense_splits -- o criterio velho voltou`
    );

    const daView = r.lidas.find((l) => l.tabela === "group_member_balances");
    assert.ok(
      daView.filtros.some(([op, coluna]) => op === "eq" && coluna === "group_id"),
      `${acao}: a leitura da view nao filtra por group_id`
    );
    assert.ok(
      daView.filtros.some(([op, coluna]) => op === "neq" && coluna === "net_balance"),
      `${acao}: a leitura da view nao compara net_balance com zero`
    );
  }
});
