#!/usr/bin/env node
// =====================================================
// PULODOGATO - o cron de vencimento diz POR QUE a lista veio vazia (HMO-486)
// =====================================================
//   npm run test:cron-le-zero
//
// O DEFEITO QUE ESTA SUITE EXISTE PARA TORNAR LEGIVEL
// ---------------------------------------------------
// Medido em producao em 22/10/2026: `cron_runs`, job `bill-alerts`, 27
// execucoes entre 25/09 e 21/10, TODAS `status=ok`, `http_status=200`, e todas
// com o mesmo corpo:
//
//   {"ok": true, "push": 0, "email": 0, "avisos": 0, "email_desligado": true}
//
// No mesmo dia, a MESMA view `bill_alerts` devolvia 2 linhas vencidas para o
// dono (o sino do app as mostra), e `bill_notifications` nunca recebeu uma
// linha deste job. Ou seja: a lista chega VAZIA ao cron, todo dia, e o job sai
// verde. Enquanto isso durar, preencher as chaves VAPID e a RESEND_API_KEY nao
// muda nada -- os dois canais iteram sobre uma lista vazia.
//
// POR QUE `avisos: 0` NAO PODIA TER DESCOBERTO ISSO
// -------------------------------------------------
// `avisos: 0` e o dia normal de um cron de vencimento. Lido sozinho ele e
// indistinguivel de (a) nao havia conta na janela -- correto -- e (b) a leitura
// voltou vazia -- defeito. O VALOR nao desempata; o que desempata e o CONJUNTO
// DE CHAVES, que e propriedade do codigo e nao do dado. Dai as duas familias de
// assercao daqui:
//
//   1. o retorno ocioso CARREGA as contagens que separam as tres causas;
//   2. o conjunto de chaves de cada ramo e CRAVADO (8 no ocioso, 13 no caminho
//      completo), para que contar chaves continue provando o ramo na proxima
//      investigacao.
//
// O CONTROLE NEGATIVO E O CORACAO DA SUITE
// ----------------------------------------
// `lista_bruta: 0` e a celula do diagnostico que manda conferir URL e chave. Se
// a contagem devolvesse `0` tambem quando a CONSULTA FALHA, ela fabricaria essa
// conclusao a partir de um erro de permissao -- e a investigacao iria para o
// lado errado com uma evidencia que parece positiva. Por isso ha sonda para
// erro na contagem e para `count: null`, e nas duas o campo tem de sair como
// TEXTO, nunca como zero.
//
// E POR QUE UM DUBLE QUE CONTA DE VERDADE
// ---------------------------------------
// `lista_bruta`/`st_pendentes` saem de `select(..., { count: "exact", head:
// true })`. Um duble que respondesse `{ data, error }` sem `count` faria a rota
// cair no caminho de degradacao SEMPRE, e toda assercao de numero aqui passaria
// medindo o duble em vez da rota. O duble desta suite guarda linhas por tabela
// e conta aplicando os `.eq()` que a rota pediu.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const CRON = await import("../.tmp-cron-le-zero/app/api/cron/bill-alerts/route.js");

const SEGREDO = "segredo-de-teste-486";
const DONO = "user-helio";
const CONTA = "sonda-hmo-235";
/** O ref do projeto de producao -- o valor que `projeto` tem de reproduzir. */
const REF_DE_PROD = "odxqjvtxsioksguuevqm";

/** Uma linha de `bill_alerts` como a view a devolve, no formato que a rota le. */
function alerta(patch = {}) {
  return {
    scheduled_transaction_id: CONTA,
    user_id: DONO,
    group_id: null,
    account_id: "conta-corrente",
    description: "SONDA HMO-235",
    amount: 0.37,
    due_date: "2026-10-05",
    days_until: -17,
    kind: "overdue",
    days_before: 3,
    transaction_type: "expense",
    already_notified: false,
    notify_email: true,
    ...patch,
  };
}

/**
 * O duble. Diferente do da suite `aviso-por-destinatario` em um ponto que e
 * todo o motivo de esta suite existir separada: ele SABE CONTAR.
 *
 * `erroPorTabela` injeta a falha de uma consulta especifica, e `countNuloEm`
 * reproduz o PostgREST respondendo sem o cabecalho de contagem -- os dois casos
 * em que "0" seria uma mentira.
 */
function montarDuble({
  linhasPorTabela = {},
  erroPorTabela = {},
  countNuloEm = [],
  erroNaLeituraDaView = null,
} = {}) {
  const registro = { consultas: [], upserts: [] };

  const consulta = (tabela) => {
    const estado = { tabela, filtros: [], pediuCount: false, head: false };
    registro.consultas.push(estado);

    /** As linhas da tabela depois dos `.eq()` que a rota aplicou. */
    const filtradas = () =>
      (linhasPorTabela[tabela] ?? []).filter((linha) =>
        estado.filtros.every((f) => linha[f.coluna] === f.valor)
      );

    const resposta = () => {
      // A leitura PRINCIPAL da view e a unica que pode falhar por `erro_leitura`
      // -- as contagens tem o `erroPorTabela` delas.
      if (erroNaLeituraDaView && tabela === "bill_alerts" && !estado.pediuCount) {
        return { data: null, count: null, error: erroNaLeituraDaView };
      }
      if (estado.pediuCount && erroPorTabela[tabela]) {
        return { data: null, count: null, error: erroPorTabela[tabela] };
      }
      const linhas = filtradas();
      return {
        // `head: true` nao traz linha nenhuma -- e e por isso que a contagem e
        // barata. Um duble que devolvesse as linhas aqui esconderia uma rota
        // que lesse `data.length` em vez de `count`.
        data: estado.head ? null : linhas,
        count: estado.pediuCount
          ? countNuloEm.includes(tabela)
            ? null
            : linhas.length
          : null,
        error: null,
      };
    };

    const alvo = {
      select(colunas, opcoes) {
        estado.colunas = colunas;
        estado.pediuCount = Boolean(opcoes?.count);
        estado.head = opcoes?.head === true;
        return alvo;
      },
      eq(coluna, valor) {
        estado.filtros.push({ coluna, valor });
        return alvo;
      },
      in(coluna, valores) {
        estado.filtros.push({ coluna, valores });
        return alvo;
      },
      insert(payload) {
        estado.insert = payload;
        return alvo;
      },
      update(patch) {
        estado.update = patch;
        return alvo;
      },
      upsert(linhas, opcoes) {
        registro.upserts.push({ tabela, linhas, opcoes });
        return {
          select: () =>
            Promise.resolve({
              data: linhas.map((l, i) => ({ ...l, id: `aviso-${i}` })),
              error: null,
            }),
        };
      },
      then(resolve) {
        return Promise.resolve(resposta()).then(resolve);
      },
    };
    return alvo;
  };

  const client = {
    from: consulta,
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: DONO } }, error: null }),
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

function ambienteDoCron({ url = `https://${REF_DE_PROD}.supabase.co` } = {}) {
  process.env.CRON_SECRET = SEGREDO;
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-de-servico";
  // Canal de e-mail desligado de proposito: o que se mede aqui e o ramo da
  // lista vazia, e `email_desligado: true` na resposta confirma o caminho.
  delete process.env.RESEND_API_KEY;
}

/** As consultas de CONTAGEM que a rota disparou, por tabela. */
function contagensDe(registro, tabela) {
  return registro.consultas.filter((c) => c.tabela === tabela && c.pediuCount);
}

// =====================================================
// AS TRES CAUSAS QUE O DIAGNOSTICO SEPARA
// =====================================================

test("MUNDO 1 -- nada em lugar nenhum: lista_bruta 0 e st_pendentes 0, e `projeto` nomeia o banco", async () => {
  // A celula "o cliente do cron nao esta vendo o banco de producao". Ela junta
  // tres causas (env, URL, chave) e `projeto` arranca a do meio: se o ref
  // gravado em `cron_runs` nao for o de producao, a investigacao acaba aqui.
  ambienteDoCron();
  montarDuble({ linhasPorTabela: { bill_alerts: [], scheduled_transactions: [] } });

  const resposta = await CRON.GET(pedidoDoCron());
  const corpo = await resposta.json();

  // CONTROLE POSITIVO: sem o 200 a rota pode ter parado no 503/401 e todas as
  // assercoes de campo abaixo passariam vazias.
  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  assert.equal(corpo.avisos, 0);
  assert.equal(corpo.lista_bruta, 0);
  assert.equal(corpo.st_pendentes, 0);
  assert.equal(
    corpo.projeto,
    REF_DE_PROD,
    "sem o ref do projeto, `0 e 0` continua significando tres coisas de uma vez"
  );
});

test("MUNDO 2 -- a view esconde: lista_bruta 0 com st_pendentes > 0", async () => {
  // `scheduled_transactions` tem conta pendente e a view devolve zero. E a
  // unica das tres causas que acusa a VIEW, e so e visivel porque
  // `st_pendentes` NAO passa por view nenhuma.
  ambienteDoCron();
  montarDuble({
    linhasPorTabela: {
      bill_alerts: [],
      scheduled_transactions: [
        { id: CONTA, status: "pending" },
        { id: "outra", status: "pending" },
        { id: "paga", status: "paid" },
      ],
    },
  });

  const resposta = await CRON.GET(pedidoDoCron());
  const corpo = await resposta.json();

  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  assert.equal(corpo.lista_bruta, 0);
  assert.equal(
    corpo.st_pendentes,
    2,
    "a contagem tem de recortar por status='pending' -- 3 significaria que o filtro nao foi aplicado"
  );
});

test("MUNDO 3 -- quem zera e o filtro: lista_bruta > 0 com a lista filtrada vazia", async () => {
  // As linhas existem na view e `already_notified` as tira da varredura. E o
  // defeito da HMO-414: lido pela service_role, `already_notified` significa
  // "alguem foi avisado", nao "este destinatario foi".
  ambienteDoCron();
  montarDuble({
    linhasPorTabela: {
      bill_alerts: [alerta({ already_notified: true }), alerta({ already_notified: true })],
      scheduled_transactions: [{ id: CONTA, status: "pending" }],
    },
  });

  const resposta = await CRON.GET(pedidoDoCron());
  const corpo = await resposta.json();

  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  assert.equal(corpo.avisos, 0, "a lista FILTRADA esta vazia -- e o ramo ocioso");
  assert.equal(
    corpo.lista_bruta,
    2,
    "`lista_bruta` tem de contar a view SEM o filtro; igual a `avisos` ela nao distingue nada"
  );
  assert.equal(corpo.st_pendentes, 1);
});

test("a contagem bruta NAO aplica already_notified -- senao o campo e uma tautologia", async () => {
  // A assercao de mecanismo. Um `lista_bruta` que herdasse o filtro valeria
  // SEMPRE 0 no ramo ocioso (e o que define o ramo), e o mundo 3 ficaria
  // indistinguivel do mundo 1 para sempre -- verde, e inutil.
  ambienteDoCron();
  const registro = montarDuble({
    linhasPorTabela: {
      bill_alerts: [alerta({ already_notified: true })],
      scheduled_transactions: [],
    },
  });

  const resposta = await CRON.GET(pedidoDoCron());
  assert.equal(resposta.status, 200);

  const brutas = contagensDe(registro, "bill_alerts");
  assert.equal(brutas.length, 1, "faltou a contagem bruta da view");
  assert.deepEqual(
    brutas[0].filtros.map((f) => f.coluna),
    [],
    "a contagem bruta nao pode filtrar nada -- `already_notified` e justamente o suspeito"
  );
  assert.equal(brutas[0].head, true, "a contagem tem de ser `head: true`: nenhuma linha trafega");

  const pendentes = contagensDe(registro, "scheduled_transactions");
  assert.equal(pendentes.length, 1, "faltou a contagem de scheduled_transactions");
  assert.deepEqual(
    pendentes[0].filtros,
    [{ coluna: "status", valor: "pending" }],
    "`st_pendentes` e a tabela CRUA recortada por status"
  );
});

// =====================================================
// CONTAGEM QUE FALHA NAO PODE VIRAR ZERO
// =====================================================

test("CONTROLE NEGATIVO: contagem que ERRA sai como texto, nao como 0", async () => {
  // O erro mais caro possivel aqui. `lista_bruta: 0` e a evidencia que manda
  // conferir env/URL/chave; fabrica-la a partir de um `42501` mandaria a
  // investigacao para o lado errado com uma pista que parece positiva.
  ambienteDoCron();
  montarDuble({
    linhasPorTabela: { bill_alerts: [], scheduled_transactions: [] },
    erroPorTabela: {
      bill_alerts: { code: "42501", message: "permission denied for view bill_alerts" },
    },
  });

  const resposta = await CRON.GET(pedidoDoCron());
  const corpo = await resposta.json();

  // O cron NAO cai por causa do diagnostico: o dia continua 200 e o trabalho
  // (que era nenhum) continua feito. O que muda e o registro.
  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  assert.notEqual(
    corpo.lista_bruta,
    0,
    "uma contagem que falhou nao pode ser gravada como `0 linhas`"
  );
  assert.equal(typeof corpo.lista_bruta, "string");
  assert.match(String(corpo.lista_bruta), /42501/);
  assert.match(String(corpo.lista_bruta), /permission denied/);
  // E a OUTRA contagem continua valendo: uma falha nao apaga a evidencia que deu.
  assert.equal(corpo.st_pendentes, 0);
});

test("CONTROLE NEGATIVO: count ausente no PostgREST sai como texto, nao como 0", async () => {
  // `count: null` com `error: null` acontece quando a resposta volta sem o
  // cabecalho de contagem. Nao e "zero linhas", e nao pode se passar por isso.
  ambienteDoCron();
  montarDuble({
    linhasPorTabela: { bill_alerts: [], scheduled_transactions: [] },
    countNuloEm: ["scheduled_transactions"],
  });

  const resposta = await CRON.GET(pedidoDoCron());
  const corpo = await resposta.json();

  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  assert.equal(typeof corpo.st_pendentes, "string");
  assert.notEqual(corpo.st_pendentes, 0);
  assert.equal(corpo.lista_bruta, 0, "a contagem que deu certo continua numerica");
});

test("`projeto` nunca carrega a chave de servico", async () => {
  // O campo vai para `cron_runs.result`, que e lido por `paperclip_ro`. Ele e
  // o ref do subdominio -- publico, ja viaja no bundle -- e nada mais.
  ambienteDoCron({ url: "https://outro-projeto-qualquer.supabase.co" });
  montarDuble({ linhasPorTabela: { bill_alerts: [], scheduled_transactions: [] } });

  const corpo = await (await CRON.GET(pedidoDoCron())).json();
  const serializado = JSON.stringify(corpo);

  assert.equal(corpo.projeto, "outro-projeto-qualquer");
  assert.ok(
    !serializado.includes("chave-de-servico"),
    `a resposta do cron vazou a service_role: ${serializado}`
  );
});

// =====================================================
// ERRO DE LEITURA TEM CAUSA NO REGISTRO, NAO SO NO CONSOLE
// =====================================================

test("falha ao ler a view grava a causa em erro_leitura, e nao so um 500 mudo", async () => {
  // O log da funcao da Vercel tem retencao curta e nao e consultavel por SQL.
  // `cron_runs` e o registro que sobrevive -- e um 500 sem causa nao distingue
  // permissao de coluna que nao existe mais de banco fora do ar.
  ambienteDoCron();
  montarDuble({
    linhasPorTabela: { scheduled_transactions: [] },
    erroNaLeituraDaView: {
      code: "42P01",
      message: 'relation "public.bill_alerts" does not exist',
    },
  });

  const resposta = await CRON.GET(pedidoDoCron());
  const corpo = await resposta.json();

  assert.equal(resposta.status, 500, JSON.stringify(corpo));
  assert.match(String(corpo.erro_leitura), /42P01/);
  assert.match(String(corpo.erro_leitura), /does not exist/);
});

// =====================================================
// O CONJUNTO DE CHAVES E A ASSINATURA DO RAMO
// =====================================================
// Foi contando chaves que a HMO-486 provou que as 27 execucoes de producao
// paravam no retorno ocioso: 5 chaves nao podiam ter vindo do caminho completo,
// que devolve 13. Essas duas sondas CRAVAM a tabela do cabecalho da rota, para
// que a proxima investigacao possa contar chaves com a mesma confianca.

test("o ramo OCIOSO devolve exatamente 8 chaves", async () => {
  ambienteDoCron();
  montarDuble({ linhasPorTabela: { bill_alerts: [], scheduled_transactions: [] } });

  const corpo = await (await CRON.GET(pedidoDoCron())).json();

  assert.deepEqual(
    Object.keys(corpo).sort(),
    [
      "avisos",
      "email",
      "email_desligado",
      "lista_bruta",
      "ok",
      "projeto",
      "push",
      "st_pendentes",
    ],
    "mudou o conjunto de chaves do ramo ocioso -- atualize a tabela do cabecalho da rota"
  );
});

test("CONTROLE NEGATIVO: o caminho COMPLETO nao paga as contagens, e tem 13 chaves", async () => {
  // Metade controle de custo, metade controle de ambiguidade. Se as contagens
  // rodassem sempre, o dia com aviso a dar pagaria duas consultas a mais por
  // nada -- e, pior, os dois ramos passariam a ter campos em comum, acabando
  // com a assinatura que torna o ramo legivel em `cron_runs`.
  ambienteDoCron();
  const registro = montarDuble({
    linhasPorTabela: {
      bill_alerts: [alerta()],
      scheduled_transactions: [{ id: CONTA, status: "pending" }],
    },
  });

  const resposta = await CRON.GET(pedidoDoCron());
  const corpo = await resposta.json();

  // CONTROLE POSITIVO: este tem de ser o caminho COMPLETO, nao o ocioso.
  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  assert.equal(corpo.avisos, 1, "a sonda tem de ter passado pelo upsert");
  assert.equal(registro.upserts.length, 1);

  assert.equal(Object.keys(corpo).length, 13, JSON.stringify(Object.keys(corpo)));
  assert.equal(corpo.lista_bruta, undefined, "o caminho completo nao declara lista_bruta");
  assert.equal(corpo.st_pendentes, undefined, "o caminho completo nao declara st_pendentes");
  assert.equal(
    contagensDe(registro, "scheduled_transactions").length,
    0,
    "o dia com aviso a dar nao pode pagar a contagem de diagnostico"
  );
  assert.equal(contagensDe(registro, "bill_alerts").length, 0);
});
