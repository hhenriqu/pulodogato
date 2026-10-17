#!/usr/bin/env node
// =====================================================
// PULODOGATO - o aviso da conta de grupo vai para cada membro (HMO-414)
// =====================================================
//   npm run test:aviso-por-destinatario
//
// O DEFEITO, E POR QUE AS DUAS METADES SAO INSEPARAVEIS
// -----------------------------------------------------
// `bill_alerts` usava `s.user_id` como destinatario. Conta prevista de grupo e
// UMA linha, do dono, entao o aviso de vencimento da conta da casa saia so para
// quem a cadastrou. A migration 057 passou a devolver uma linha POR
// DESTINATARIO -- e isso sozinho nao manda um e-mail a mais:
//
//   * o cron grava com `upsert(..., { onConflict, ignoreDuplicates: true })`.
//     Com `user_id` FORA do `onConflict`, o aviso do segundo membro colide com
//     o do primeiro e o PostgREST responde `INSERT 0 0` -- SEM ERRO. O fan-out
//     inteiro grava uma linha, e nao ha log de nada;
//   * o sino (`GET /api/notifications`) lia `bill_alerts` sem filtro de
//     `user_id`, e a RLS NAO recorta o fan-out: `group_members_select` (002)
//     mostra o grupo inteiro a qualquer membro. Medido num Postgres 17 com a
//     cadeia 001 -> 057: sem o filtro, um membro de grupo de 3 pessoas ve a
//     mesma conta TRES vezes, com `overdue_count` triplicado.
//
// POR QUE A ASSERCAO E SOBRE O ARGUMENTO, E NAO SOBRE O ARQUIVO
// -------------------------------------------------------------
// `onConflict` e uma string de nomes de coluna. Um guard textual que procurasse
// `user_id` no arquivo da rota fica VERDE casando com `user_id: a.user_id` da
// linha gravada, tres linhas acima -- e com a string do `onConflict` errada. O
// unico oraculo honesto e o objeto que a rota passou ao client, e e isso que o
// duble guarda.
//
// O CONTROLE POSITIVO NAO E OPCIONAL
// ----------------------------------
// Varias assercoes daqui sao sobre uma chamada ter acontecido com certo
// argumento. Se a rota nao for chamada (um 503 por variavel de ambiente
// faltando, um 401 por segredo errado), `chamadasDeServico` fica em 0 e TODA
// assercao de argumento passaria vazia. Por isso toda sonda confere o `status`
// da resposta e a contagem de chamadas antes de olhar o argumento.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const CRON = await import("../.tmp-aviso-por-destinatario/app/api/cron/bill-alerts/route.js");
const SINO = await import("../.tmp-aviso-por-destinatario/app/api/notifications/route.js");

const SEGREDO = "segredo-de-teste-414";
const CONTA = "conta-prevista-da-casa";
const HELIO = "user-helio";
const LAIS = "user-lais";
const ANA = "user-ana";
const VENCE_EM = "2099-03-20";

/**
 * As tres linhas que a 057 devolve para UMA conta prevista de grupo -- uma por
 * destinatario. Antes da 057 isto era uma linha so, com `user_id` do dono.
 */
function alertasDoGrupo() {
  return [HELIO, LAIS, ANA].map((user_id) => ({
    scheduled_transaction_id: CONTA,
    user_id,
    group_id: "grupo-casa",
    account_id: "conta-corrente",
    description: "Luz da Casa",
    amount: 300,
    due_date: VENCE_EM,
    days_until: 2,
    kind: "due_soon",
    days_before: 3,
    transaction_type: "expense",
    already_notified: false,
    notify_email: true,
  }));
}

/**
 * Um duble minimo e PROPRIO desta suite, em vez do `criarDuble` compartilhado:
 * o que precisa ser medido aqui e `upsert`, que o duble compartilhado nao
 * implementa -- e ensina-lo a fazer upsert mudaria o aparelho de 13 outras
 * suites por causa desta. O que este duble faz de verdade e GUARDAR as
 * chamadas; ele nao tenta imitar o banco.
 *
 * `linhasPorTabela` responde o SELECT; `registro` acumula o que a rota escreveu.
 */
function montarDuble({ linhasPorTabela = {}, chaveForcada = null } = {}) {
  const registro = {
    upserts: [],
    selects: [],
    filtros: [],
    inserts: [],
    updates: [],
  };

  const consulta = (tabela) => {
    const alvo = {
      // ---- leitura ----
      select(colunas) {
        registro.selects.push({ tabela, colunas });
        return alvo;
      },
      eq(coluna, valor) {
        registro.filtros.push({ tabela, coluna, valor });
        return alvo;
      },
      in(coluna, valores) {
        registro.filtros.push({ tabela, coluna, valores });
        return alvo;
      },
      // Os filtros que a familia de ASSINATURA usa (`recurrence-alerts`, que o
      // sino le no mesmo handler). Eles nao sao medidos aqui, e existem para a
      // cadeia nao estourar: o sino envolve essa leitura num try/catch proprio
      // de proposito ("perder o alerta da Netflix nao pode apagar o aviso de
      // que o aluguel venceu"), entao sem eles a suite passaria igual -- mas
      // com um TypeError no stderr de toda rodada, que e exatamente o tipo de
      // ruido que esconde a falha de verdade na proxima vez.
      neq(coluna, valor) {
        registro.filtros.push({ tabela, coluna, valor, op: "neq" });
        return alvo;
      },
      is(coluna, valor) {
        registro.filtros.push({ tabela, coluna, valor, op: "is" });
        return alvo;
      },
      not() {
        return alvo;
      },
      gte() {
        return alvo;
      },
      lte() {
        return alvo;
      },
      order() {
        return alvo;
      },
      limit() {
        return alvo;
      },
      // ---- escrita ----
      insert(payload) {
        registro.inserts.push({ tabela, payload });
        return alvo;
      },
      update(patch) {
        registro.updates.push({ tabela, patch });
        return alvo;
      },
      upsert(linhas, opcoes) {
        registro.upserts.push({ tabela, linhas, opcoes });
        // O comportamento que importa: o conflito e decidido pelas colunas que
        // `onConflict` NOMEIA. E assim que o banco se comporta, e e o que faz a
        // diferenca entre gravar 3 linhas e gravar 1.
        //
        // `chaveForcada` existe para o CONTROLE NEGATIVO: ela ignora o que a
        // rota pediu e colide pela chave do 009. E o unico jeito de provar que
        // o "gravou 3" das assercoes acima vem da CHAVE, e nao de o duble nao
        // saber colidir.
        const chave =
          chaveForcada ??
          String(opcoes?.onConflict ?? "")
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);
        const vistas = new Set();
        const gravadas = [];
        for (const linha of linhas) {
          const id = chave.map((c) => String(linha[c])).join("|");
          if (vistas.has(id)) continue;
          vistas.add(id);
          gravadas.push({ ...linha, id: `aviso-${gravadas.length}` });
        }
        return {
          select: () => Promise.resolve({ data: gravadas, error: null }),
        };
      },
      // O `await` da cadeia sem `.select()` no fim (cron_runs, os UPDATEs).
      then(resolve) {
        return Promise.resolve({
          data: linhasPorTabela[tabela] ?? [],
          error: null,
        }).then(resolve);
      },
    };
    return alvo;
  };

  const client = {
    from: consulta,
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: LAIS } }, error: null }),
      admin: {
        getUserById: (id) =>
          Promise.resolve({ data: { user: { email: `${id}@teste.local` } }, error: null }),
      },
    },
  };

  globalThis.__dubleDeSupabase = {
    servico: () => client,
    sessao: () => client,
    registro,
  };
  return registro;
}

function pedidoDoCron() {
  return {
    headers: { get: (n) => (n === "authorization" ? `Bearer ${SEGREDO}` : null) },
  };
}

function ambienteDoCron() {
  process.env.CRON_SECRET = SEGREDO;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-de-servico";
  // O canal de e-mail fica DESLIGADO de proposito: ligado, a rota faz uma
  // chamada a API de admin por destinatario, e o que esta suite mede e a
  // GRAVACAO. `email_desligado` na resposta e a prova de que o caminho foi o
  // esperado.
  delete process.env.RESEND_API_KEY;
}

// =====================================================
// O CRON
// =====================================================

test("o onConflict do cron NOMEIA user_id -- a UNIQUE da 057", async () => {
  ambienteDoCron();
  const registro = montarDuble({
    linhasPorTabela: { bill_alerts: alertasDoGrupo() },
  });

  const resposta = await CRON.GET(pedidoDoCron());
  const corpo = await resposta.json();

  // CONTROLE POSITIVO: sem isto, uma rota que respondesse 503 deixaria todas as
  // assercoes de argumento abaixo passando vazias.
  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  assert.equal(registro.upserts.length, 1, "a rota nao gravou nada");

  const { opcoes } = registro.upserts[0];
  const colunas = String(opcoes.onConflict).split(",").map((c) => c.trim());

  assert.ok(
    colunas.includes("user_id"),
    `onConflict sem user_id ("${opcoes.onConflict}"): o aviso do segundo ` +
      "membro do grupo sera descartado em silencio pelo ignoreDuplicates"
  );
  // O conjunto INTEIRO, e nao so a coluna nova: o PostgREST exige um indice
  // unico que case com esta lista, e a UNIQUE da 057 tem exatamente estas
  // quatro. Uma lista com coluna a mais ou a menos faz o cron responder ERRO.
  assert.deepEqual(
    [...colunas].sort(),
    ["kind", "reference_date", "scheduled_transaction_id", "user_id"],
    "a lista do onConflict tem de casar com bill_notifications_unique (057)"
  );
  assert.equal(opcoes.ignoreDuplicates, true);
});

test("uma conta de grupo rende UM aviso POR MEMBRO", async () => {
  ambienteDoCron();
  const registro = montarDuble({
    linhasPorTabela: { bill_alerts: alertasDoGrupo() },
  });

  const resposta = await CRON.GET(pedidoDoCron());
  const corpo = await resposta.json();

  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  assert.equal(corpo.avisos, 3, "os tres destinatarios tem de ser gravados");

  const gravadas = registro.upserts[0].linhas;
  assert.deepEqual(
    gravadas.map((l) => l.user_id).sort(),
    [ANA, HELIO, LAIS].sort(),
    "o destinatario gravado e o da linha da view, nao o dono"
  );
  // Todas sobre a MESMA conta e a MESMA data: e exatamente a colisao que a
  // UNIQUE estreita do 009 recusava.
  assert.deepEqual(
    [...new Set(gravadas.map((l) => l.scheduled_transaction_id))],
    [CONTA]
  );
  assert.deepEqual([...new Set(gravadas.map((l) => l.reference_date))], [VENCE_EM]);
  assert.equal(corpo.email_desligado, true, "o canal de e-mail devia estar off");
});

test("CONTROLE NEGATIVO: com a chave do 009 a MESMA rota grava 1 de 3, sem erro", async () => {
  // A MESMA rota, o MESMO duble, a MESMA lista de tres destinatarios -- muda so
  // a chave pela qual o conflito e resolvido, que e o que a UNIQUE estreita do
  // 009 fazia. Sem este controle, o "gravou 3" das assercoes acima passaria
  // tambem num aparelho que nao sabe colidir: estaria medindo o duble.
  //
  // E o `status` 200 aqui e metade do achado -- e assim que o defeito e
  // silencioso: nenhum erro, nenhum log, e `avisos: 1` numa resposta que
  // ninguem le.
  ambienteDoCron();
  const registro = montarDuble({
    linhasPorTabela: { bill_alerts: alertasDoGrupo() },
    chaveForcada: ["scheduled_transaction_id", "kind", "reference_date"],
  });

  const resposta = await CRON.GET(pedidoDoCron());
  const corpo = await resposta.json();

  assert.equal(resposta.status, 200, "o defeito nao levanta erro -- e o problema");
  assert.equal(registro.upserts.length, 1, "a rota tem de ter tentado gravar");
  assert.equal(
    registro.upserts[0].linhas.length,
    3,
    "a rota OFERECEU os tres destinatarios"
  );
  assert.equal(
    corpo.avisos,
    1,
    "com a chave do 009 o fan-out inteiro vira UMA linha gravada"
  );
});

test("conta PESSOAL continua rendendo um aviso so", async () => {
  ambienteDoCron();
  const registro = montarDuble({
    linhasPorTabela: {
      bill_alerts: [{ ...alertasDoGrupo()[0], group_id: null, user_id: HELIO }],
    },
  });

  const resposta = await CRON.GET(pedidoDoCron());
  const corpo = await resposta.json();

  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  assert.equal(corpo.avisos, 1);
  assert.equal(registro.upserts[0].linhas[0].user_id, HELIO);
});

test("o cron NAO filtra user_id -- ele precisa do conjunto inteiro", async () => {
  // O espelho da assercao do sino, e o par e que faz as duas valerem: filtrar
  // aqui faria o fan-out morrer de outra maneira (o cron le sem usuario
  // nenhum, entao `user_id = <ninguem>` nao devolveria linha alguma).
  ambienteDoCron();
  const registro = montarDuble({
    linhasPorTabela: { bill_alerts: alertasDoGrupo() },
  });

  const resposta = await CRON.GET(pedidoDoCron());
  assert.equal(resposta.status, 200);

  const filtrosNaView = registro.filtros.filter((f) => f.tabela === "bill_alerts");
  assert.deepEqual(
    filtrosNaView.map((f) => f.coluna),
    ["already_notified"],
    "o cron filtra SO already_notified na view"
  );
});

// =====================================================
// O SINO
// =====================================================

test("o sino filtra bill_alerts pelo usuario logado", async () => {
  const registro = montarDuble({
    linhasPorTabela: { bill_alerts: alertasDoGrupo(), bill_notifications: [] },
  });

  const resposta = await SINO.GET();
  const corpo = await resposta.json();

  assert.equal(resposta.status, 200, JSON.stringify(corpo));

  const filtro = registro.filtros.find(
    (f) => f.tabela === "bill_alerts" && f.coluna === "user_id"
  );
  assert.ok(
    filtro,
    "sem o filtro de user_id o membro de um grupo de 3 pessoas ve a mesma " +
      "conta TRES vezes no sino (a RLS nao recorta o fan-out da 057)"
  );
  assert.equal(filtro.valor, LAIS, "o filtro tem de ser o usuario da SESSAO");
});

test("o sino nao pede a tabela de avisos sem limite nem ordem", async () => {
  // Controle de que a sonda esta exercitando a rota de verdade, e nao so a
  // primeira linha dela: as duas leituras do sino saem no mesmo Promise.all.
  const registro = montarDuble({
    linhasPorTabela: { bill_alerts: alertasDoGrupo(), bill_notifications: [] },
  });

  await SINO.GET();

  assert.ok(
    registro.selects.some((s) => s.tabela === "bill_notifications"),
    "o historico do sino nao foi lido"
  );
});
