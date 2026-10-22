#!/usr/bin/env node
// =====================================================
// PULODOGATO - a rota da conversa do Papel de Pao (HMO-481, F3 da HMO-462)
// =====================================================
//   npm run test:rota-da-conversa
//
// POR QUE O DUBLE, E NAO UMA ASSERCAO SOBRE O TEXTO DA ROTA
// ---------------------------------------------------------
// As duas promessas desta fase sao sobre o OBJETO QUE CHEGOU AO BANCO:
//
//   1. `account_id` PREENCHIDO -- o defeito que
//      /api/personal-finance/transactions tem hoje (a coluna nao aparece no
//      `insert` dele). A coluna e anulavel, entao nada reprova e nada loga: o
//      `update_account_balance_trigger` (001:2033) so mexe no saldo da conta
//      APONTADA, e a linha sem conta nao move saldo nenhum;
//
//   2. os campos de divisao de despesa AUSENTES. Esta e uma afirmacao sobre o
//      que NAO esta no objeto, e nenhum grep no fonte a prova sozinho: um grep
//      passa verde no dia em que alguem acrescentar um spread do corpo
//      (`...corpo`) que leve os campos de volta sem a palavra aparecer.
//
// A medida que corresponde as duas e CHAMAR o handler e olhar `escritas` do
// duble -- o objeto exato que foi para o `.insert()`. O guard de fonte entra
// COMO SEGUNDA trava, e nao como a unica: ele cobre o caminho oposto (alguem
// escrever o campo de propria mao), e o teste de comportamento cobre o spread.
//
// NOS DOIS FUSOS (America/Sao_Paulo e UTC)
// ----------------------------------------
// A data do lancamento e `today()` e a janela sai de `periodoCorrente`. Teste de
// data passa verde em UTC sem ver o bug: a sandbox e Sao Paulo e o CI e UTC, e
// das 21:00 as 23:59 do ultimo dia do mes o UTC ja aponta para o mes SEGUINTE
// (HMO-173). Por isso o npm script roda a suite duas vezes.
//
// E POR ISSO UM TESTE CONGELA O RELOGIO
// -------------------------------------
// Rodar nos dois fusos nao basta para o mutante que troca `today()` por
// `new Date().toISOString()`: os dois valores sao IGUAIS em 21 das 24 horas do
// dia, nos dois fusos, porque `today()` nomeia `America/Sao_Paulo` por dentro e
// nao depende do `TZ` do processo. Um mutante assim sobreviveria quase sempre e
// morreria de madrugada -- placar de controle negativo que depende da hora e
// pior que placar nenhum. `mock.timers` fixa o instante em
// 2026-11-01T01:00:00Z, que e 31/10 as 22:00 em Sao Paulo: ali os dois valores
// DISCORDAM, e discordam identicamente nos dois fusos. Ver
// "A DATA E DE HOJE" abaixo.
// =====================================================
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { criarDuble } from "./duble-de-supabase.mjs";

const ROTA = await import(
  "../.tmp-rota-da-conversa/app/api/papel-de-pao/conversa/route.js"
);
const SALDO = await import("../.tmp-rota-da-conversa/lib/saldo-da-conversa.js");
const CATEGORIAS = await import(
  "../.tmp-rota-da-conversa/lib/categoria-da-conversa.js"
);

const EU = "leticia";
const OUTRA = "outra-pessoa";
const SERVICO = "servico-personal-finance";
const OUTRO_SERVICO = "servico-mybank";

/** O mes que a rota vai somar -- a MESMA funcao que ela usa, nunca uma copia. */
const MES = SALDO.mesCorrenteDaConversa();

/** Um dia dentro do mes corrente, e um que cai fora (o dia anterior a janela). */
const DENTRO = MES.de;
const FORA_ANTES = (() => {
  const d = new Date(`${MES.de}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();

/** Os nomes das duas categorias reservadas, lidos da lib -- nunca recopiados. */
const NOME_DO_GASTO = CATEGORIAS.CATEGORIAS_DA_CONVERSA.gastei.name;
const NOME_DO_GANHO = CATEGORIAS.CATEGORIAS_DA_CONVERSA.ganhei.name;

/**
 * Uma conta de `financial_accounts` como a consulta da rota a encontra.
 *
 * `user_id` entra por aqui e NAO e enfeite de fixture: a rota le as contas com
 * `.eq("user_id", user.id)`, e o duble FILTRA de verdade. Uma fixture sem o
 * campo some da consulta, a escada nao acha conta nenhuma, e TODO caso da suite
 * responde 409 -- um "sem conta elegivel" que descreve a fixture, nao a rota.
 */
const conta = (campos) => ({
  user_id: EU,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  ...campos,
});

/** As duas contas que a migration 056 cria para quem se cadastra, na ordem dela. */
const CONTAS_DA_056 = [
  conta({ id: "conta-corrente", name: "Conta Corrente", account_type: "checking" }),
  conta({
    id: "dinheiro",
    name: "Dinheiro",
    account_type: "cash",
    created_at: "2026-01-01T00:00:01Z",
  }),
];

/** `financial_services` -- sem ela a rota responde 404, e nao e o que se mede. */
const SERVICOS = [{ id: SERVICO, name: "personal_finance" }];

/**
 * Uma sessao de duble que ATRAVESSA varias chamadas.
 *
 * O duble e o mesmo entre um POST e o seguinte de proposito: e assim que
 * "a categoria nasce na primeira vez e e REUSADA na segunda" tem como ser
 * medido, e e assim que o POST rele o que ele mesmo acabou de gravar.
 *
 * `chamadasDeSessao` e o CONTROLE POSITIVO DO DUBLE: ele vem do preambulo que
 * `monta-duble-de-rota.mjs` escreve, e conta quantas vezes a rota pediu o client
 * de sessao. Se um dia a rota trocar o jeito de obter o client
 * (`createServerClient` direto, outro helper), o duble deixa de ser consultado e
 * esta suite mediria "uma resposta qualquer" -- verde sobre nada.
 */
function abrirSessao(fixture = {}) {
  const duble = criarDuble({
    user: fixture.semSessao ? null : { id: EU },
    tabelas: {
      financial_services: fixture.servicos ?? SERVICOS,
      financial_accounts: fixture.contas ?? CONTAS_DA_056,
      transaction_categories: fixture.categorias ?? [],
      financial_transactions: fixture.linhas ?? [],
    },
    erros: fixture.erros ?? {},
    errosDeInsert: fixture.errosDeInsert ?? {},
  });

  // O objeto que a rota compilada enxerga -- e onde o preambulo do duble
  // incrementa a contagem.
  const instalado = { sessao: () => duble.client };

  async function chamar(handler) {
    globalThis.__dubleDeSupabase = instalado;
    try {
      return await handler();
    } finally {
      delete globalThis.__dubleDeSupabase;
    }
  }

  return {
    escritas: duble.escritas,
    lidas: duble.lidas,
    get chamadasDeSessao() {
      return instalado.chamadasDeSessao ?? 0;
    },
    /**
     * O POST. O corpo vai CRU para `request.json()` de proposito: e assim que um
     * campo a mais consegue CHEGAR na rota, que e a unica forma de medir que ele
     * nao passa dali.
     */
    async post(corpoDoPedido) {
      const r = await chamar(() => ROTA.POST({ json: async () => corpoDoPedido }));
      return { status: r.status, corpo: await r.json() };
    },
    async get() {
      const r = await chamar(() =>
        ROTA.GET({ nextUrl: new URL("https://local/api/papel-de-pao/conversa") })
      );
      return { status: r.status, corpo: await r.json() };
    },
  };
}

/** Um POST numa sessao de uma chamada so. */
async function postar(corpoDoPedido, fixture = {}) {
  const s = abrirSessao(fixture);
  const r = await s.post(corpoDoPedido);
  return { ...r, escritas: s.escritas, lidas: s.lidas, sessao: s };
}

/** Um GET numa sessao de uma chamada so. */
async function pegar(linhas, fixture = {}) {
  const s = abrirSessao({ ...fixture, linhas });
  const r = await s.get();
  return { ...r, escritas: s.escritas, lidas: s.lidas, sessao: s };
}

/** Os objetos que foram para `<tabela>.insert()`, na ordem. */
const insertsEm = (escritas, tabela) =>
  escritas.filter((e) => e.tabela === tabela && e.verbo === "insert");

/** O lancamento que foi para `financial_transactions.insert()`, ou `undefined`. */
const lancamentoGravado = (escritas) =>
  insertsEm(escritas, "financial_transactions")[0]?.linhas?.[0];

/** Uma linha realizada como o PostgREST a entrega. */
const linha = (campos) => ({
  user_id: EU,
  service_id: SERVICO,
  transaction_date: DENTRO,
  group_id: null,
  include_in_total: true,
  ...campos,
});

// ---------------------------------------------------------------------------
// 1. "GASTEI" GRAVA NEGATIVO -- E COM CONTA. OS DOIS DEFEITOS NUM CASO SO.
// ---------------------------------------------------------------------------

test("gastei 1000: amount NEGATIVO e account_id PREENCHIDO", async () => {
  const r = await postar({ direcao: "gastei", valor: 1000 });

  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  const gravada = lancamentoGravado(r.escritas);
  assert.ok(
    gravada,
    `nenhum insert em financial_transactions: ${JSON.stringify(r.escritas)}`
  );

  // O numero CRAVADO, e nao `< 0`: um mutante que gravasse -1 passaria por "e
  // negativo" e perderia 999 reais dela.
  assert.equal(gravada.amount, -1000);
  assert.equal(gravada.transaction_type, "expense");

  // AS TRES ASSERCOES DE CONTA, e as tres sao necessarias: `account_id` presente
  // mas `undefined` e exatamente o que o PostgREST DESCARTA da coluna -- a linha
  // nasceria sem conta e o objeto do insert pareceria ter o campo.
  assert.ok(
    "account_id" in gravada,
    `sem account_id: ${JSON.stringify(gravada)}`
  );
  assert.notEqual(gravada.account_id, undefined, "account_id veio undefined");
  assert.equal(gravada.account_id, "conta-corrente");

  // E o dono e o servico saem do SERVIDOR: a policy do 002 compara `user_id`
  // com `auth.uid()`, e `service_id` e NOT NULL.
  assert.equal(gravada.user_id, EU);
  assert.equal(gravada.service_id, SERVICO);
  assert.equal(gravada.description, "Gastei");
});

test("ganhei 2000: amount POSITIVO e transaction_type income", async () => {
  const r = await postar({ direcao: "ganhei", valor: 2000 });

  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  const gravada = lancamentoGravado(r.escritas);
  assert.equal(gravada.amount, 2000);
  assert.equal(gravada.transaction_type, "income");
  assert.equal(gravada.account_id, "conta-corrente");
  assert.equal(gravada.description, "Ganhei");
});

test("o POST responde os tres numeros RELIDOS, pelo mesmo caminho do GET", async () => {
  // A frase da issue, ponta a ponta e numa sessao so: ela aperta Ganhei 2000,
  // depois Gastei 1000, e o segundo POST ja responde o saldo fechado. Os numeros
  // saem da RELEITURA -- se o POST os calculasse por conta propria, discordariam
  // do recarregar, que e a familia de defeito que este repositorio mais paga.
  const s = abrirSessao();

  const ganhou = await s.post({ direcao: "ganhei", valor: 2000 });
  assert.equal(ganhou.status, 201, JSON.stringify(ganhou.corpo));
  assert.deepEqual(ganhou.corpo.numeros, { ganhei: 2000, gastei: 0, saldo: 2000 });

  const gastou = await s.post({ direcao: "gastei", valor: 1000 });
  assert.equal(gastou.status, 201, JSON.stringify(gastou.corpo));
  assert.deepEqual(gastou.corpo.numeros, {
    ganhei: 2000,
    gastei: 1000,
    saldo: 1000,
  });

  // E o `id` do que acabou de nascer, para a tela nao ter de reler.
  assert.ok(gastou.corpo.lancamento?.id, JSON.stringify(gastou.corpo));

  // A MOLDURA junto com o numero: as rotas /api/ tem cache de 24h no PWA, e
  // resposta de um mes pintada na moldura de outro e o modo de falha.
  assert.deepEqual(gastou.corpo.mes, MES);

  // E O GET CONCORDA COM O POST -- a mesma sessao, os mesmos tres numeros. Sem
  // esta linha, "o POST rele" ficaria sem controle: duas leituras plausiveis que
  // discordam e o que o helper unico existe para impedir.
  const lido = await s.get();
  assert.deepEqual(lido.corpo.numeros, gastou.corpo.numeros);
  assert.deepEqual(lido.corpo.mes, gastou.corpo.mes);
});

// ---------------------------------------------------------------------------
// 2. OS CAMPOS DE DIVISAO DE DESPESA NAO CHEGAM AO INSERT
// ---------------------------------------------------------------------------
// O corpo os MANDA. O que se mede e que a rota nao os leva adiante: `amount`
// negativo acompanhado da chave do grupo e rateado por TRIGGER DO BANCO
// (`auto_create_group_transaction`), e a divisao nao depende de o app concordar.

test("group_id / splits / is_shared no corpo NAO chegam ao insert", async () => {
  const r = await postar({
    direcao: "gastei",
    valor: 1000,
    group_id: "grupo-casa",
    is_shared: true,
    splits: [
      { participant_id: "membro-a", percentage: 50 },
      { participant_id: "membro-b", percentage: 50 },
    ],
  });

  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  const gravada = lancamentoGravado(r.escritas);

  // `in`, e nao `!== valor`: o que o trigger olha e a PRESENCA da coluna com
  // valor nao nulo, e um `null` gravado explicitamente tambem seria "o campo
  // existe no caminho". A promessa e que ele nao exista.
  for (const campo of ["group_id", "is_shared", "splits"]) {
    assert.ok(
      !(campo in gravada),
      `${campo} chegou ao insert: ${JSON.stringify(gravada)}`
    );
  }

  // E o valor continua INTEIRO -- 1000, nao 500. Se o campo tivesse passado, o
  // rateio do trigger e que dividiria e o insert ainda pareceria certo aqui;
  // esta linha e o que amarra a promessa ao dinheiro.
  assert.equal(gravada.amount, -1000);

  // O lote tambem nao pode ter DESCARTADO o campo em silencio: o duble registra
  // as chaves que o insert jogou fora, e uma lista nao vazia aqui significaria
  // que a rota mandou o campo e o PostgREST e que o perderia.
  assert.deepEqual(insertsEm(r.escritas, "financial_transactions")[0].descartadas, []);
});

test("a rota nao escreve nem CONSULTA tabela de grupo nenhuma", async () => {
  const r = await postar({
    direcao: "gastei",
    valor: 300,
    group_id: "grupo-casa",
    splits: [{ participant_id: "membro-a", percentage: 100 }],
  });

  const deGrupo = (registros) =>
    registros.filter((x) =>
      ["group_transactions", "group_expense_splits", "group_members"].includes(
        x.tabela
      )
    );

  assert.deepEqual(deGrupo(r.escritas), [], "a rota escreveu em tabela de grupo");
  // Nem consulta: nao ha nada a validar, porque nao ha campo a aceitar.
  assert.deepEqual(deGrupo(r.lidas), [], "a rota consultou tabela de grupo");
});

test("GUARD DE FONTE: a rota nao NOMEIA os tres campos, nem em comentario", () => {
  // A segunda trava, e ela cobre o caminho oposto do teste acima: ali, o campo
  // chegando ao insert por um spread; aqui, alguem escrevendo o campo de propria
  // mao. "Nem em comentario" e literal e tem precedente (o guard de fonte de
  // test-movimentacoes.mjs cobra a ausencia no arquivo INTEIRO): um comentario
  // que repete os nomes seria tudo o que faria este teste passar se eles
  // voltassem ao codigo. O cabecalho da rota descreve os tres SEM os nomear --
  // de proposito, e por causa desta linha.
  const FONTE = readFileSync("app/api/papel-de-pao/conversa/route.ts", "utf8");

  for (const campo of ["group_id", "is_shared", "splits"]) {
    assert.ok(
      !FONTE.includes(campo),
      `app/api/papel-de-pao/conversa/route.ts menciona \`${campo}\``
    );
  }
});

// ---------------------------------------------------------------------------
// 3. A DATA E DE HOJE, PELO RELOGIO DE SAO PAULO -- E O CORPO NAO A ESCOLHE
// ---------------------------------------------------------------------------

test("a data gravada e HOJE, e cai dentro da janela que o GET soma", async () => {
  const s = abrirSessao();
  const r = await s.post({ direcao: "gastei", valor: 7 });
  const gravada = lancamentoGravado(s.escritas);

  assert.ok(
    gravada.transaction_date >= MES.de && gravada.transaction_date <= MES.ate,
    `${gravada.transaction_date} fora de ${MES.de}..${MES.ate}`
  );

  // Nao basta "tem transaction_date": o que importa e que a linha que ela acabou
  // de criar ENTRE na conta do mes. O proprio POST ja responde isso.
  assert.deepEqual(r.corpo.numeros, { ganhei: 0, gastei: 7, saldo: -7 });
});

test("`data` no corpo apontando OUTRO MES e ignorada: a linha nasce com hoje", async () => {
  // Com a data do cliente, ela aperta Confirmar, ve "anotei", e os tres numeros
  // NAO SE MOVEM -- o GET so soma o mes corrente. `lib/conversa-do-papel.ts`
  // (F1) tem o campo `data` na intencao de lancamento, e esta rota o ignora.
  const s = abrirSessao();
  const r = await s.post({
    direcao: "gastei",
    valor: 55,
    data: "2020-03-15",
    transaction_date: "2020-03-15",
  });

  const gravada = lancamentoGravado(s.escritas);
  assert.notEqual(gravada.transaction_date, "2020-03-15");
  assert.ok(
    gravada.transaction_date >= MES.de && gravada.transaction_date <= MES.ate,
    `a data do corpo passou: ${gravada.transaction_date}`
  );

  // A prova que FECHA: os numeros se movem. Com a data do cliente eles ficariam
  // em zero, com 201 na resposta.
  assert.deepEqual(r.corpo.numeros, { ganhei: 0, gastei: 55, saldo: -55 });
});

test("RELOGIO CONGELADO: a data e a de Sao Paulo, nao a de UTC", async () => {
  // 2026-11-01T01:00:00Z e 31/10 as 22:00 em Sao Paulo. Nesse instante:
  //
  //     today()                            -> "2026-10-31"  (o certo)
  //     new Date().toISOString().slice(..)  -> "2026-11-01"  (UTC, um mes a mais)
  //
  // E a janela do mes corrente, que sai do MESMO relogio, e a de outubro. Com a
  // forma de UTC a linha nasce FORA dela: 201 na tela, saldo parado. Esta e a
  // unica assercao da suite que mata esse mutante em qualquer hora do dia, e ela
  // vale identicamente nos dois fusos -- `today()` nomeia o fuso por dentro.
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 1, 1, 0, 0) });
  try {
    const s = abrirSessao();
    const r = await s.post({ direcao: "gastei", valor: 12 });

    assert.equal(lancamentoGravado(s.escritas).transaction_date, "2026-10-31");
    assert.deepEqual(r.corpo.mes, { de: "2026-10-01", ate: "2026-10-31" });
    assert.deepEqual(r.corpo.numeros, { ganhei: 0, gastei: 12, saldo: -12 });
  } finally {
    mock.timers.reset();
  }
});

// ---------------------------------------------------------------------------
// 4. AS DUAS CATEGORIAS RESERVADAS, UMA POR DIRECAO
// ---------------------------------------------------------------------------

test("primeira vez: cria a reservada da direcao e aponta o lancamento para ela", async () => {
  const r = await postar({ direcao: "gastei", valor: 10 });

  const criadas = insertsEm(r.escritas, "transaction_categories");
  assert.equal(criadas.length, 1, JSON.stringify(r.escritas));

  const categoria = criadas[0].linhas[0];
  assert.equal(categoria.name, NOME_DO_GASTO);
  assert.equal(categoria.user_id, EU, "nasceu sem dono -- a policy do 036 recusa");
  assert.equal(categoria.service_id, SERVICO);
  // `is_expense` e NOT NULL e e o degrau 2 de `classificarMovimentacao`: uma
  // categoria unica para as duas direcoes classificaria metade das linhas ao
  // contrario.
  assert.equal(categoria.is_expense, true);
  assert.equal(
    categoria.is_active,
    false,
    "a reservada apareceria nos seletores das telas normais"
  );

  // E o lancamento aponta para ELA, nao para `undefined`: `category_id` e NOT
  // NULL, e a rota velha o exige do cliente.
  assert.equal(lancamentoGravado(r.escritas).category_id, categoria.id);
});

test("ganhei cria a OUTRA, com is_expense false", async () => {
  const r = await postar({ direcao: "ganhei", valor: 10 });
  const categoria = insertsEm(r.escritas, "transaction_categories")[0].linhas[0];

  assert.equal(categoria.name, NOME_DO_GANHO);
  assert.equal(categoria.is_expense, false);
  assert.notEqual(NOME_DO_GANHO, NOME_DO_GASTO, "as duas reservadas tem o mesmo nome");
});

test("segunda chamada da MESMA direcao: REUSA -- duas chamadas, UM insert", async () => {
  const s = abrirSessao();

  const primeira = await s.post({ direcao: "gastei", valor: 10 });
  const segunda = await s.post({ direcao: "gastei", valor: 20 });

  assert.equal(primeira.status, 201, JSON.stringify(primeira.corpo));
  assert.equal(segunda.status, 201, JSON.stringify(segunda.corpo));

  const criadas = insertsEm(s.escritas, "transaction_categories");
  assert.equal(
    criadas.length,
    1,
    `duas chamadas criaram ${criadas.length} categorias`
  );

  // E as duas linhas de dinheiro apontam para a MESMA categoria -- senao o
  // relatorio dela teria uma categoria por lancamento.
  const lancamentos = insertsEm(s.escritas, "financial_transactions");
  assert.equal(lancamentos.length, 2);
  assert.equal(
    lancamentos[0].linhas[0].category_id,
    lancamentos[1].linhas[0].category_id
  );
});

test("as duas direcoes na mesma sessao: DUAS categorias, uma por direcao", async () => {
  const s = abrirSessao();
  await s.post({ direcao: "gastei", valor: 10 });
  await s.post({ direcao: "ganhei", valor: 10 });
  await s.post({ direcao: "gastei", valor: 10 });

  const criadas = insertsEm(s.escritas, "transaction_categories");
  assert.deepEqual(
    criadas.map((c) => c.linhas[0].name),
    [NOME_DO_GASTO, NOME_DO_GANHO],
    "tres chamadas tinham de criar exatamente as duas reservadas"
  );
});

test("a categoria de OUTRA pessoa com o mesmo nome nao e reusada", async () => {
  const r = await postar(
    { direcao: "gastei", valor: 10 },
    {
      categorias: [
        {
          id: "categoria-da-outra",
          service_id: SERVICO,
          user_id: OUTRA,
          name: NOME_DO_GASTO,
          is_expense: true,
          is_active: false,
        },
      ],
    }
  );

  // Sem o `.eq("user_id", ...)` na busca, o lancamento dela apontaria para a
  // categoria de outra pessoa -- e a FK nao reprova, porque a linha existe. O
  // sintoma seria o relatorio dela sem a categoria e o da outra pessoa com os
  // numeros dela dentro.
  const criada = insertsEm(r.escritas, "transaction_categories")[0];
  assert.ok(criada, "reusou a categoria de outra pessoa");
  assert.equal(criada.linhas[0].user_id, EU);
  assert.notEqual(
    lancamentoGravado(r.escritas).category_id,
    "categoria-da-outra"
  );
});

test("23505 na criacao da categoria: rele e grava, sem 500", async () => {
  // Dois toques no Confirmar em sequencia, ou a fila offline descarregando: a
  // UNIQUE das categorias de usuario e indice PARCIAL (036:192) e nao arbitra
  // `ON CONFLICT`, entao o caminho e SELECT-INSERT-releitura.
  const r = await postar(
    { direcao: "gastei", valor: 10 },
    {
      errosDeInsert: {
        transaction_categories: { code: "23505", message: "duplicate key" },
      },
      categorias: [
        {
          id: "a-que-o-outro-pedido-criou",
          service_id: SERVICO,
          user_id: EU,
          name: NOME_DO_GASTO,
          is_expense: true,
          is_active: false,
        },
      ],
    }
  );

  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(
    lancamentoGravado(r.escritas).category_id,
    "a-que-o-outro-pedido-criou"
  );
});

// ---------------------------------------------------------------------------
// 5. A ESCADA DA CONTA -- E NUNCA CARTAO
// ---------------------------------------------------------------------------

test("degrau 1: Conta Corrente entre outras e a escolhida", async () => {
  const r = await postar(
    { direcao: "gastei", valor: 10 },
    {
      contas: [
        conta({ id: "nubank", name: "Nubank", account_type: "checking", created_at: "2020-01-01T00:00:00Z" }),
        conta({ id: "grana", name: "Dinheiro", account_type: "cash", created_at: "2021-01-01T00:00:00Z" }),
        conta({ id: "a-da-056", name: "Conta Corrente", account_type: "checking", created_at: "2026-01-01T00:00:00Z" }),
      ],
    }
  );

  // A MAIS NOVA das tres, e e o ponto: o degrau 1 e por NOME, e ganha do degrau
  // 2 (que e por `created_at`). Se a escada estivesse invertida, a escolhida
  // seria `nubank`.
  assert.equal(lancamentoGravado(r.escritas).account_id, "a-da-056");
});

test("degrau 2: sem Conta Corrente, a MAIS ANTIGA elegivel", async () => {
  const r = await postar(
    { direcao: "gastei", valor: 10 },
    {
      contas: [
        conta({ id: "recente", name: "Itaú", account_type: "checking", created_at: "2026-05-01T00:00:00Z" }),
        conta({ id: "antiga", name: "Carteira", account_type: "cash", created_at: "2019-02-02T00:00:00Z" }),
      ],
    }
  );

  // `created_at` manda, e nao o tipo: sem `ORDER BY` o Postgres pode devolver
  // duas ordens para a mesma tabela, e dois "Gastei" iguais cairiam em contas
  // diferentes.
  assert.equal(lancamentoGravado(r.escritas).account_id, "antiga");
});

test("CARTAO nunca recebe o lancamento, mesmo sendo o mais antigo", async () => {
  const r = await postar(
    { direcao: "gastei", valor: 1000 },
    {
      contas: [
        conta({ id: "cartao", name: "Conta Corrente", account_type: "credit_card", created_at: "2010-01-01T00:00:00Z" }),
        conta({ id: "corrente", name: "Itaú", account_type: "checking", created_at: "2026-01-01T00:00:00Z" }),
      ],
    }
  );

  // O cartao esta com o NOME do degrau 1 e e o mais antigo -- ele ganharia os
  // dois degraus se o criterio fosse so nome ou so idade. Gasto em cartao nao e
  // dinheiro saindo hoje: ele vira linha de fatura, com mes de competencia
  // proprio (`card_invoice_month()`, 006), e a despesa so se REALIZA no
  // pagamento. Contado aqui, o dinheiro sairia duas vezes.
  assert.equal(lancamentoGravado(r.escritas).account_id, "corrente");
});

test("so cartao de credito cadastrado: 409 e NENHUM insert", async () => {
  const r = await postar(
    { direcao: "gastei", valor: 1000 },
    {
      contas: [
        conta({ id: "cartao", name: "Cartão", account_type: "credit_card" }),
      ],
    }
  );

  assert.equal(r.status, 409, JSON.stringify(r.corpo));
  // E o ponto: ela NAO grava. `account_id` e ANULAVEL, logo um insert sem conta
  // voltaria 201 e nasceria orfao -- a rota velha de volta.
  assert.deepEqual(r.escritas, [], `gravou sem conta elegivel: ${JSON.stringify(r.escritas)}`);
  assert.ok(r.corpo.error, "o 409 veio sem frase para a tela mostrar");
});

// ---------------------------------------------------------------------------
// A CONTA DE INVESTIMENTO -- O GEMEO DO CARTAO, E O QUE O ESCOPO NAO PEGAVA
// ---------------------------------------------------------------------------
// Os dois casos abaixo sao os do cartao, acima, com `account_type:
// 'investment'`. Eles existem separados, e nao como mais uma conta nos casos do
// cartao, porque o cartao e a conta de investimento caem do MESMO lado desta
// rota por MOTIVOS diferentes, e o criterio que pegava um nao pegava o outro:
// `escopoDoTipo("credit_card")` e "cartao", mas `escopoDoTipo("investment")` e
// "conta" -- de proposito, porque ela se cadastra e se lista na tela de Contas.
// Com o criterio de escopo, que e o que a HMO-481 entregou, estes dois testes
// REPROVAM (HMO-482).
//
// E conta de ATIVO (migration 059): o valor dela vem das movimentacoes da
// carteira, nao do extrato, e dinheiro que sai dela e RESGATE, nao gasto. Um
// "Gastei 1000" ali move `current_balance` pelo
// `update_account_balance_trigger` e a carteira segue dizendo outra coisa --
// duas leituras plausiveis que discordam, sem erro nenhum.

test("CONTA DE INVESTIMENTO nunca recebe o lancamento, mesmo sendo a mais antiga", async () => {
  const r = await postar(
    { direcao: "gastei", valor: 1000 },
    {
      contas: [
        conta({ id: "clear", name: "Conta Corrente", account_type: "investment", created_at: "2010-01-01T00:00:00Z" }),
        conta({ id: "corrente", name: "Itaú", account_type: "checking", created_at: "2026-01-01T00:00:00Z" }),
      ],
    }
  );

  // Igual ao caso do cartao: ela esta com o NOME do degrau 1 e e a mais antiga,
  // logo ganharia os dois degraus se o criterio fosse so nome ou so idade. E,
  // diferente do cartao, ela tambem passaria pelo criterio de ESCOPO.
  assert.equal(lancamentoGravado(r.escritas).account_id, "corrente");
});

test("so conta de INVESTIMENTO cadastrada: 409 e NENHUM insert", async () => {
  const r = await postar(
    { direcao: "gastei", valor: 1000 },
    {
      contas: [
        conta({ id: "clear", name: "Clear", account_type: "investment" }),
      ],
    }
  );

  assert.equal(r.status, 409, JSON.stringify(r.corpo));
  // O mesmo ponto do gemeo do cartao: 409 e NENHUMA escrita. Cair no insert com
  // `account_id` da conta de investimento seria pior que o orfao -- a linha
  // moveria o saldo de uma conta cujo valor nasce na carteira.
  assert.deepEqual(r.escritas, [], `gravou na conta de investimento: ${JSON.stringify(r.escritas)}`);
  assert.ok(r.corpo.error, "o 409 veio sem frase para a tela mostrar");
});

// A CATRACA, e nao o filtro por omissao. O criterio velho mandava o tipo
// desconhecido para `porTipo` -> "other" -> escopo "conta", logo um valor novo
// do ENUM `account_type` nascia ELEGIVEL sem ninguem decidir. Hoje o criterio e
// um `Record<AccountType, boolean>` exaustivo: o build para no nono valor, e em
// runtime o tipo que o union nao conhece da `undefined`, que e falso.
//
// O teste precisa mentir sobre o tipo de proposito -- e exatamente a linha que o
// banco pode gravar e o union ainda nao conhecer.
test("account_type que o app nao conhece nasce INELEGIVEL: 409 e NENHUM insert", async () => {
  const r = await postar(
    { direcao: "gastei", valor: 1000 },
    {
      contas: [
        conta({ id: "novo", name: "Conta Corrente", account_type: "tipo_que_o_enum_ganhou_depois" }),
      ],
    }
  );

  // Nao e "o degrau 1 nao casou": a conta esta com o nome do degrau 1. O tipo e
  // que a derruba, nos DOIS degraus.
  assert.equal(r.status, 409, JSON.stringify(r.corpo));
  assert.deepEqual(r.escritas, [], `o tipo desconhecido gravou: ${JSON.stringify(r.escritas)}`);
});

test("nenhuma conta cadastrada: 409 e NENHUM insert", async () => {
  const r = await postar({ direcao: "gastei", valor: 10 }, { contas: [] });

  assert.equal(r.status, 409, JSON.stringify(r.corpo));
  assert.deepEqual(r.escritas, [], `a rota escreveu: ${JSON.stringify(r.escritas)}`);
});

test("conta desativada nao recebe; is_active NULO recebe", async () => {
  const desativada = await postar(
    { direcao: "gastei", valor: 10 },
    {
      contas: [
        conta({ id: "velha", name: "Conta Corrente", account_type: "checking", is_active: false, created_at: "2019-01-01T00:00:00Z" }),
        conta({ id: "nova", name: "Itaú", account_type: "checking", created_at: "2026-01-01T00:00:00Z" }),
      ],
    }
  );
  assert.equal(lancamentoGravado(desativada.escritas).account_id, "nova");

  // `is_active` e ANULAVEL com default `true` (001:1106): `NULL` quer dizer
  // "ninguem mexeu" e conta como ativa. Com `=== true` a conta vinda do cache
  // offline (que pode chegar sem o campo) sairia da lista e a rota recusaria o
  // lancamento de quem esta sem rede.
  const nula = await postar(
    { direcao: "gastei", valor: 10 },
    {
      contas: [
        conta({ id: "nunca-mexeu", name: "Conta Corrente", account_type: "checking", is_active: null }),
      ],
    }
  );
  assert.equal(lancamentoGravado(nula.escritas).account_id, "nunca-mexeu");
});

test("a leitura das contas recorta por user_id", async () => {
  const r = await postar({ direcao: "gastei", valor: 10 });
  const consulta = r.lidas.find((l) => l.tabela === "financial_accounts");

  assert.ok(consulta, "a rota nao leu financial_accounts");
  const filtros = JSON.stringify(consulta.filtros);
  assert.ok(
    filtros.includes("user_id") && filtros.includes(EU),
    `a leitura das contas nao recortou por user_id: ${filtros}`
  );
});

// ---------------------------------------------------------------------------
// 6. O CORPO RECUSADO -- E NENHUMA ESCRITA EM NENHUM DOS CASOS
// ---------------------------------------------------------------------------

test("direcao ausente, vazia ou inventada: 400 e nenhuma escrita", async () => {
  for (const direcao of [undefined, null, "", "gasto", "GASTEI", "transfer", 1, {}]) {
    const r = await postar({ direcao, valor: 10 });
    assert.equal(r.status, 400, `direcao=${JSON.stringify(direcao)} passou`);
    assert.deepEqual(
      r.escritas,
      [],
      `direcao=${JSON.stringify(direcao)} escreveu: ${JSON.stringify(r.escritas)}`
    );
  }
});

test("valor que nao da para gravar: 400 e nenhuma escrita", async () => {
  // `"39,90"` esta aqui de proposito: `Number("39,90")` e `NaN`, e `NaN` gravado
  // em `numeric(15,2)` e o lancamento dela perdido. `-50` tambem: a direcao JA
  // diz o sinal, e um `Math.abs` em cima dele poria uma RECEITA de 50 debaixo do
  // botao Gastei.
  const recusados = [
    undefined,
    null,
    0,
    "0",
    "0.00",
    -50,
    "-50",
    "39,90",
    "abc",
    {},
    Infinity,
    NaN,
    "1e3",
    " 10 ",
    "10.999",
  ];

  for (const valor of recusados) {
    const r = await postar({ direcao: "gastei", valor });
    assert.equal(r.status, 400, `valor=${JSON.stringify(valor)} passou`);
    assert.deepEqual(
      r.escritas,
      [],
      `valor=${JSON.stringify(valor)} escreveu: ${JSON.stringify(r.escritas)}`
    );
  }
});

test("TETO DE numeric(15,2): 14 digitos inteiros sao 400, nao 500", async () => {
  // Sem o limite, o insert volta `22003 numeric field overflow` e a rota o
  // devolve como 500 -- erro de servidor para um pedido que era invalido.
  const treze = "9999999999999";
  const quatorze = "99999999999999";

  const passa = await postar({ direcao: "gastei", valor: treze });
  assert.equal(passa.status, 201, JSON.stringify(passa.corpo));

  const barra = await postar({ direcao: "gastei", valor: quatorze });
  assert.equal(barra.status, 400, JSON.stringify(barra.corpo));
  assert.deepEqual(barra.escritas, []);
});

test("valor como string decimal com ponto e aceito tal e qual", async () => {
  // E a forma que `lib/conversa-do-papel.ts` (F1) entrega: decimal com ponto,
  // duas casas. Nada de arredondar aqui -- o teclado de F1 e em CENTAVOS.
  const r = await postar({ direcao: "gastei", valor: "39.90" });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(lancamentoGravado(r.escritas).amount, -39.9);

  const inteiro = await postar({ direcao: "ganhei", valor: "1000.00" });
  assert.equal(lancamentoGravado(inteiro.escritas).amount, 1000);
});

test("corpo que nao e JSON: 400 e nenhuma escrita", async () => {
  const duble = criarDuble({
    user: { id: EU },
    tabelas: { financial_services: SERVICOS, financial_accounts: CONTAS_DA_056 },
  });
  globalThis.__dubleDeSupabase = { sessao: () => duble.client };

  let resposta;
  try {
    resposta = await ROTA.POST({
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  assert.equal(resposta.status, 400);
  assert.deepEqual(duble.escritas, []);
});

// ---------------------------------------------------------------------------
// 7. SEM SESSAO, AS DUAS RECUSAM -- E NEM LEEM
// ---------------------------------------------------------------------------

test("POST sem sessao: 401, nenhuma escrita, nenhuma leitura", async () => {
  const r = await postar({ direcao: "gastei", valor: 1000 }, { semSessao: true });

  assert.equal(r.status, 401, JSON.stringify(r.corpo));
  assert.deepEqual(r.escritas, [], `escreveu sem sessao: ${JSON.stringify(r.escritas)}`);
  assert.deepEqual(r.lidas, [], `leu sem sessao: ${JSON.stringify(r.lidas)}`);
});

test("GET sem sessao: 401 e nenhuma leitura de dinheiro", async () => {
  const r = await pegar([linha({ transaction_type: "income", amount: 1000 })], {
    semSessao: true,
  });

  assert.equal(r.status, 401, JSON.stringify(r.corpo));
  // Nao basta o 401: o que importa e que os numeros dela nao foram lidos. Uma
  // rota que lesse e so entao recusasse vazaria pelo log e pelo tempo.
  const deDinheiro = r.lidas.filter((l) => l.tabela === "financial_transactions");
  assert.deepEqual(deDinheiro, [], `leu dinheiro sem sessao: ${JSON.stringify(deDinheiro)}`);
  assert.equal(r.corpo.numeros, undefined);
});

// ---------------------------------------------------------------------------
// 8. O SERVICO AUSENTE: 404 NAS DUAS, COMO NAS IRMAS
// ---------------------------------------------------------------------------

test("sem financial_services: 404 nas duas, e o POST nao grava", async () => {
  const post = await postar({ direcao: "gastei", valor: 10 }, { servicos: [] });
  assert.equal(post.status, 404, JSON.stringify(post.corpo));
  assert.deepEqual(post.escritas, []);

  const get = await pegar([], { servicos: [] });
  assert.equal(get.status, 404, JSON.stringify(get.corpo));
});

// ---------------------------------------------------------------------------
// 9. O GET: OS TRES NUMEROS, A MOLDURA, A LISTA E OS FILTROS
// ---------------------------------------------------------------------------

test("os TRES numeros saem juntos, com a moldura e a lista", async () => {
  const r = await pegar([
    linha({ transaction_type: "income", amount: 2000 }),
    linha({ transaction_type: "expense", amount: -1000 }),
  ]);

  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual(r.corpo.numeros, { ganhei: 2000, gastei: 1000, saldo: 1000 });
  // A moldura ECOA a janela consultada -- cache de 24h do PWA nas rotas /api/.
  assert.deepEqual(r.corpo.mes, MES);
  // A lista sai do MESMO criterio que somou (`linhasDaConversa`, F2): a tela
  // (F4) abre a lista sem uma segunda leitura que discordasse do total.
  assert.equal(r.corpo.linhas.length, 2);
});

test("include_in_total FALSE sai da conta; NULO e AUSENTE contam", async () => {
  const r = await pegar([
    linha({ transaction_type: "expense", amount: -100, include_in_total: false }),
    linha({ transaction_type: "expense", amount: -20, include_in_total: null }),
    // A linha do CACHE OFFLINE: guardada antes da migration 060, chega SEM o
    // campo. Com `=== true` ela sairia da soma e a conversa mostraria o saldo
    // menor para quem abre sem rede.
    {
      user_id: EU,
      service_id: SERVICO,
      transaction_date: DENTRO,
      group_id: null,
      transaction_type: "expense",
      amount: -3,
    },
  ]);

  assert.equal(r.corpo.numeros.gastei, 23, JSON.stringify(r.corpo));
  assert.equal(r.corpo.linhas.length, 2);
});

test("a linha de GRUPO nao entra, nem com o user_id dela", async () => {
  const r = await pegar([
    linha({ transaction_type: "expense", amount: -1000 }),
    // A perna de grupo do custo pessoal dela e uma linha de VERDADE em
    // financial_transactions, com o `user_id` DELA. Sem o porteiro ela e somada,
    // calada. A rota nao filtra isso no banco de proposito -- quem filtra e
    // `linhasDaConversa` (F2), para o mutante de F2 continuar observavel.
    linha({ transaction_type: "expense", amount: -500, group_id: "grupo-casa" }),
  ]);

  assert.equal(r.corpo.numeros.gastei, 1000, JSON.stringify(r.corpo));
  assert.equal(r.corpo.linhas.length, 1);
});

test("transfer e tipo NULO ficam fora dos dois numeros", async () => {
  const r = await pegar([
    linha({ transaction_type: "income", amount: 2000 }),
    // Dinheiro andando entre contas dela nao e ganho nem gasto.
    linha({ transaction_type: "transfer", amount: -800 }),
    linha({ transaction_type: null, amount: -700 }),
  ]);

  assert.deepEqual(r.corpo.numeros, { ganhei: 2000, gastei: 0, saldo: 2000 });
});

test("a linha de OUTRO MES e a de OUTRO SERVICO nao entram", async () => {
  const r = await pegar([
    linha({ transaction_type: "expense", amount: -100 }),
    linha({ transaction_type: "expense", amount: -999, transaction_date: FORA_ANTES }),
    linha({ transaction_type: "expense", amount: -777, service_id: OUTRO_SERVICO }),
  ]);

  assert.equal(r.corpo.numeros.gastei, 100, JSON.stringify(r.corpo));
});

test("o GET recorta por user_id, service_id e pela janela, NO BANCO", async () => {
  const r = await pegar([linha({ transaction_type: "income", amount: 1 })]);

  const consulta = r.lidas.find((l) => l.tabela === "financial_transactions");
  assert.ok(consulta, "a rota nao leu financial_transactions");
  const filtros = JSON.stringify(consulta.filtros);

  // `user_id`: a policy do 002 entrega tambem a linha de grupo de quem e membro.
  assert.ok(filtros.includes("user_id") && filtros.includes(EU), `sem user_id: ${filtros}`);
  assert.ok(filtros.includes("service_id") && filtros.includes(SERVICO), `sem service_id: ${filtros}`);
  // A janela: sem ela a rota le o historico INTEIRO dela para somar um mes, e o
  // custo cresce para sempre.
  assert.ok(filtros.includes(MES.de) && filtros.includes(MES.ate), `sem janela: ${filtros}`);
});

test("a leitura NAO nomeia include_in_total -- nem no select, nem em filtro", async () => {
  const r = await pegar([linha({ transaction_type: "income", amount: 1 })]);
  const consulta = r.lidas.find((l) => l.tabela === "financial_transactions");

  // A coluna e da migration 060, colada A MAO no SQL Editor DEPOIS do deploy.
  // Nomea-la responde `42703 column ... does not exist` em todo banco que ainda
  // nao a recebeu -- foi o que as quatro rotas de patrimonio mediram em producao
  // na HMO-431 com a homonima da 058. E um FILTRO seria pior que o 42703: ele
  // DESCARTARIA a linha, e saldo silenciosamente menor e pior que 500.
  //
  // A assercao e sobre a CONSULTA, e nao sobre o texto do arquivo: o cabecalho da
  // rota explica a coluna pelo nome, de proposito, e um grep no fonte reprovaria
  // a explicacao em vez do defeito.
  const consultado = JSON.stringify(consulta.filtros) + JSON.stringify(consulta.terminador);
  assert.ok(
    !consultado.includes("include_in_total"),
    `o select/filtro nomeia a coluna da 060: ${consultado}`
  );
  assert.equal(SALDO.COLUNAS_DA_CONVERSA, "*");
});

test("mes sem lancamento: tres zeros e lista VAZIA, com 200", async () => {
  const r = await pegar([]);

  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual(r.corpo.numeros, { ganhei: 0, gastei: 0, saldo: 0 });
  // Tres zeros sao indistinguiveis de um saldo que fechou em zero -- e a tela
  // (F4) precisa da diferenca para dizer "nenhum lançamento este mês".
  assert.deepEqual(r.corpo.linhas, []);
});

test("o GET nao escreve nada", async () => {
  const r = await pegar([linha({ transaction_type: "income", amount: 10 })]);
  assert.deepEqual(r.escritas, [], `o GET escreveu: ${JSON.stringify(r.escritas)}`);
});

test("erro ao ler as linhas: 500 com frase, nao numero errado", async () => {
  const r = await pegar([], { erros: { financial_transactions: { message: "boom" } } });

  assert.equal(r.status, 500, JSON.stringify(r.corpo));
  // O que NAO pode acontecer: responder 200 com tres zeros. "Saldo 0" e uma
  // afirmacao falsa sobre o dinheiro dela.
  assert.equal(r.corpo.numeros, undefined);
});

test("erro ao gravar: 500, e a resposta nao diz que gravou", async () => {
  const r = await postar(
    { direcao: "gastei", valor: 10 },
    { errosDeInsert: { financial_transactions: { code: "23514", message: "boom" } } }
  );

  assert.equal(r.status, 500, JSON.stringify(r.corpo));
  assert.equal(r.corpo.lancamento, undefined);
  assert.equal(r.corpo.numeros, undefined);
});

// ---------------------------------------------------------------------------
// 10. CONTROLE POSITIVO DO DUBLE -- A SUITE ESTA MEDINDO A ROTA?
// ---------------------------------------------------------------------------

test("CONTROLE POSITIVO: os dois verbos pediram o client de SESSAO ao duble", async () => {
  // Sem isto a suite mediria uma rota que trocou o jeito de obter o client
  // (`createServerClient` direto, outro helper): o duble deixaria de ser
  // consultado, `globalThis.__dubleDeSupabase` ficaria sem uso, e a sonda veria
  // "uma resposta qualquer" -- verde sobre nada. E o modo de falha que o
  // cabecalho de monta-duble-de-rota.mjs descreve.
  const doPost = abrirSessao();
  const post = await doPost.post({ direcao: "gastei", valor: 10 });
  assert.equal(post.status, 201, JSON.stringify(post.corpo));
  assert.ok(
    doPost.chamadasDeSessao > 0,
    "o POST respondeu 201 sem pedir o client de sessao ao duble"
  );

  const doGet = abrirSessao({ linhas: [linha({ transaction_type: "income", amount: 1 })] });
  const get = await doGet.get();
  assert.equal(get.status, 200, JSON.stringify(get.corpo));
  assert.ok(
    doGet.chamadasDeSessao > 0,
    "o GET respondeu 200 sem pedir o client de sessao ao duble"
  );
});

test("CONTROLE NEGATIVO do duble: a rota nunca pede o client de SERVICE ROLE", async () => {
  // O par do controle acima, e aqui o zero e a AFIRMACAO: esta rota le e escreve
  // so o dinheiro de quem esta logada, sob RLS. Um client de service role aqui
  // passaria por cima da policy do 002, e o sintoma de uma rota assim nao e erro
  // nenhum -- e dado de outra pessoa aparecendo nos tres numeros dela.
  //
  // O duble de service role NAO e instalado: se a rota o pedisse, o preambulo
  // gerado estouraria com "nao foi instalado" em vez de passar calado.
  const s = abrirSessao();
  const r = await s.post({ direcao: "gastei", valor: 10 });

  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(globalThis.__dubleDeSupabase, undefined);
});
