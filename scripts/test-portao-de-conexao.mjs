#!/usr/bin/env node
// =====================================================
// PULODOGATO - o perfil que a policy admite e a busca nunca mostrou (HMO-373)
// =====================================================
//   npm run test:portao-de-conexao
//
// O DEFEITO: UM ESTADO QUE O BANCO ACEITA E O APP NEGA
// ----------------------------------------------------
// `profiles.allow_connections` tem TRES estados, nao dois: `true`, `false` e
// `NULL`. A coluna e anulavel e o default dela e `true`
// (`001_baseline.sql:1252`), entao `NULL` quer dizer "nunca mexeu no botao" --
// e quem nunca mexeu continua com o default, que e PERMITIR. A migration 010 ja
// decidiu assim, por escrito: a policy de INSERT de `user_connections` compara
// `COALESCE(p.allow_connections, true)` (`010:198`).
//
// A busca discordava do banco:
//
//     .eq("allow_connections", true)
//
// `= true` nao casa com `NULL` em SQL -- o resultado e `NULL`, que nao e
// verdadeiro. O efeito e um perfil que a policy ADMITE e que a busca NUNCA
// MOSTRA: sem erro, sem log, sem sintoma. E o terceiro estado nao e hipotese de
// teste, e o default da coluna.
//
// POR QUE OS TRES ESTADOS, E QUAL DELES E O CONTROLE
// --------------------------------------------------
// Uma suite com `true` e `NULL` so provaria "a busca acha os dois" -- que
// `.not("allow_connections", "is", false)` cumpre e um `or: () => api` no-op
// cumpriria tambem. O `false` e o que da MEDIDA ao conserto: ele tem de
// continuar invisivel. Sem ele, apagar o portao inteiro passaria verde, e o
// conserto do defeito teria virado vazamento de quem desligou o botao de
// proposito.
//
// MEDIDO EM PRODUCAO (2026-10-10): dos 13 perfis publicos, ZERO estao com a
// coluna `NULL` hoje -- o defeito era latente, nao ativo. O numero nao desfaz o
// defeito (nada impede o `NULL`: a coluna aceita e a policy admite), mas e por
// isso que a prova de que o filtro novo acha a linha `NULL` foi feita
// escrevendo `NULL` numa linha de verdade em producao, e nao contando o que ja
// estava la. Aqui a mesma prova e feita no fixture.
//
// A BUSCA POR E-MAIL, E O QUE ELA NAO PODE ALARGAR
// ------------------------------------------------
// A busca casava so `full_name`/`nickname`. O e-mail entrou pelo caminho que a
// 039 ja havia escolhido -- `get_user_by_email`, que compara
// `LOWER(auth.users.email)` -- e NAO por `profiles.email`, que e forjavel
// (policy de RLS trava a linha, nunca a coluna: quem esta logado escreve
// qualquer string no proprio `profiles.email`).
//
// `get_user_by_email` nao sabe de `is_public` nem de `allow_connections`: ela
// devolve qualquer conta confirmada. Entao os dois ultimos casos desta suite sao
// o que impede a feature de virar vazamento -- achar pelo e-mail NAO pode
// mostrar quem desligou um dos portoes, senao a rota passaria a ser um oraculo
// de "este e-mail tem conta no app".
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import { criarDuble } from "./duble-de-supabase.mjs";

const ROTA = await import("../.tmp-portao-de-conexao/app/api/users/search/route.js");
const CONEXOES = await import("../.tmp-portao-de-conexao/app/api/connections/route.js");

const EU = "eu-mesmo";

/** Os tres estados da coluna, em tres perfis com o mesmo nome buscavel. */
const PERMITE = "perfil-allow-true";
const NUNCA_MEXEU = "perfil-allow-null";
const RECUSOU = "perfil-allow-false";

const EMAIL_DE_QUEM_PERMITE = "silva@exemplo.com.br";
const EMAIL_DE_QUEM_RECUSOU = "recusou@exemplo.com.br";

/**
 * Chama o GET com um duble e devolve `{ status, corpo, nomes, sessao }`.
 *
 * O fixture e o MESMO nos tres casos de coluna -- muda so o `q`. As tres linhas
 * coexistem na tabela em toda chamada, e e isso que faz as assercoes medirem
 * RECORTE em vez de medirem fixture: "achou o NULL" e "nao achou o false" sao
 * afirmacoes sobre a mesma leitura.
 */
async function buscar(q, extra = {}) {
  const sessao = criarDuble({
    user: { id: EU },
    tabelas: {
      profiles: [
        {
          id: PERMITE,
          full_name: "Silva, Joao",
          nickname: "joaos",
          avatar_url: null,
          bio: null,
          is_public: true,
          allow_connections: true,
        },
        {
          // A linha do defeito. `allow_connections` esta presente e NULA de
          // proposito, e nao omitida: e assim que a coluna fica quando o perfil
          // nasce sem ninguem tocar no botao.
          id: NUNCA_MEXEU,
          full_name: "Silva, Maria",
          nickname: "marias",
          avatar_url: null,
          bio: null,
          is_public: true,
          allow_connections: null,
        },
        {
          // O CONTROLE NEGATIVO. Quem desligou o botao de proposito.
          id: RECUSOU,
          full_name: "Silva, Pedro",
          nickname: "pedros",
          avatar_url: null,
          bio: null,
          is_public: true,
          allow_connections: false,
        },
        {
          // Quem fechou o perfil. O OUTRO portao, que o conserto nao toca.
          id: "perfil-nao-publico",
          full_name: "Silva, Ana",
          nickname: "anas",
          avatar_url: null,
          bio: null,
          is_public: false,
          allow_connections: true,
        },
        {
          // Eu. O `.neq("id", user.id)` tem de me tirar da minha propria busca.
          id: EU,
          full_name: "Silva, Eu Mesmo",
          nickname: "eumesmo",
          avatar_url: null,
          bio: null,
          is_public: true,
          allow_connections: true,
        },
      ],
      user_connections: [],
      ...extra,
    },
  });

  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  let resposta;
  try {
    resposta = await ROTA.GET(
      new Request(`https://local/api/users/search?q=${encodeURIComponent(q)}`)
    );
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  const corpo = await resposta.json();

  return {
    status: resposta.status,
    corpo,
    nomes: Array.isArray(corpo) ? corpo.map((u) => u.id).sort() : null,
    sessao,
    registro,
  };
}

// ---------------------------------------------------------------------------
// Os tres estados da coluna, na MESMA leitura
// ---------------------------------------------------------------------------

test("busca por nome: acha `true` E `NULL`, e nao acha `false`", async () => {
  const { status, nomes } = await buscar("Silva");

  assert.equal(status, 200);

  // O NULL no meio e o defeito da issue; o false fora e o que da medida ao
  // conserto. Afirmar o CONJUNTO inteiro, e nao `includes`, e o que faz esta
  // assercao reprovar tanto o filtro antigo quanto o portao apagado.
  assert.deepEqual(nomes, [NUNCA_MEXEU, PERMITE].sort());
});

test("`allow_connections: NULL` aparece -- era o perfil invisivel", async () => {
  const { nomes } = await buscar("Maria");
  assert.deepEqual(nomes, [NUNCA_MEXEU]);
});

test("`allow_connections: false` continua invisivel (controle negativo)", async () => {
  const { nomes } = await buscar("Pedro");
  assert.deepEqual(nomes, []);
});

test("`is_public: false` continua invisivel -- o outro portao esta intacto", async () => {
  const { nomes } = await buscar("Ana");
  assert.deepEqual(nomes, []);
});

test("eu nao apareco na minha propria busca", async () => {
  const { nomes } = await buscar("Eu Mesmo");
  assert.deepEqual(nomes, []);
});

// ---------------------------------------------------------------------------
// O filtro citado: o nome com virgula (HMO-142, que a rota tinha deixado passar)
// ---------------------------------------------------------------------------

test("nome com virgula busca em vez de quebrar a arvore do PostgREST", async () => {
  // "Silva, Joao" e o termo: a virgula e separador de disjuncao na arvore do
  // PostgREST, e colada crua ela faria o operando `full_name.ilike.%Silva` e o
  // ramo orfao ` Joao%` -- PGRST100, que a rota devolve como 500.
  const { status, nomes } = await buscar("Silva, Joao");

  assert.equal(status, 200);
  assert.deepEqual(nomes, [PERMITE]);
});

// ---------------------------------------------------------------------------
// A busca por e-mail
// ---------------------------------------------------------------------------

test("acha pelo e-mail, e o e-mail NAO volta no corpo", async () => {
  const { status, corpo, nomes } = await buscar(EMAIL_DE_QUEM_PERMITE, {
    "rpc:get_user_by_email": [
      {
        id: PERMITE,
        email: EMAIL_DE_QUEM_PERMITE,
        full_name: "Silva, Joao",
      },
    ],
  });

  assert.equal(status, 200);
  assert.deepEqual(nomes, [PERMITE]);

  // `get_user_by_email` devolve o e-mail, e ele e DESCARTADO: se a rota
  // repassasse a linha da funcao, a busca por nome passaria a entregar o
  // e-mail de quem ela achou -- exatamente o que lib/profile-fields.ts existe
  // para impedir.
  assert.equal(
    Object.prototype.hasOwnProperty.call(corpo[0], "email"),
    false,
    "o corpo da busca nao pode carregar o e-mail do perfil achado"
  );
});

test("e-mail de quem tem `allow_connections: false` nao acha ninguem", async () => {
  // O caso que separa "busca por e-mail" de "oraculo de existencia de conta".
  // A funcao ACHA a conta (ela nao sabe de portao nenhum); o que barra e a
  // releitura de `profiles` com os dois portoes.
  const { status, nomes } = await buscar(EMAIL_DE_QUEM_RECUSOU, {
    "rpc:get_user_by_email": [
      {
        id: RECUSOU,
        email: EMAIL_DE_QUEM_RECUSOU,
        full_name: "Silva, Pedro",
      },
    ],
  });

  assert.equal(status, 200);
  assert.deepEqual(nomes, []);
});

test("e-mail de perfil nao publico nao acha ninguem", async () => {
  const { nomes } = await buscar("ana@exemplo.com.br", {
    "rpc:get_user_by_email": [
      {
        id: "perfil-nao-publico",
        email: "ana@exemplo.com.br",
        full_name: "Silva, Ana",
      },
    ],
  });

  assert.deepEqual(nomes, []);
});

test("e-mail com `allow_connections: NULL` acha -- o defeito tambem pelo e-mail", async () => {
  const { nomes } = await buscar("maria@exemplo.com.br", {
    "rpc:get_user_by_email": [
      {
        id: NUNCA_MEXEU,
        email: "maria@exemplo.com.br",
        full_name: "Silva, Maria",
      },
    ],
  });

  assert.deepEqual(nomes, [NUNCA_MEXEU]);
});

test("termo que nao parece e-mail nao consulta `get_user_by_email`", async () => {
  const { sessao } = await buscar("Silva");

  // Uma ida a mais por digitacao nao e so desperdicio: `get_user_by_email` e
  // SECURITY DEFINER sobre `auth.users`, e consultar essa funcao a cada tecla
  // de uma busca por nome e um alcance que a busca nao precisa ter.
  assert.equal(
    sessao.lidas.some((l) => l.tabela === "rpc:get_user_by_email"),
    false
  );
});

test("o proprio e-mail nao me devolve a mim mesmo", async () => {
  const { nomes } = await buscar("eu@exemplo.com.br", {
    "rpc:get_user_by_email": [
      { id: EU, email: "eu@exemplo.com.br", full_name: "Silva, Eu Mesmo" },
    ],
  });

  assert.deepEqual(nomes, []);
});

// ---------------------------------------------------------------------------
// O MESMO portao, na outra forma: o POST que PEDE a conexao
// ---------------------------------------------------------------------------
//
// `app/api/users/search` filtra na consulta; aqui a rota ja tem o valor na mao
// e decide com um `if`. Era `if (!targetProfile.allow_connections)`, e `!null`
// e `true`: a rota respondia "Este usuário não aceita conexões" para um perfil
// que a policy de INSERT da 010 ADMITE (`COALESCE(allow_connections, true)`).
// O INSERT logo abaixo teria passado -- quem barrava era o `if`.

/** Chama o POST de `/api/connections` pedindo conexao com `requested_id`. */
async function pedirConexao(requested_id, allow_connections) {
  const sessao = criarDuble({
    user: { id: EU },
    tabelas: {
      profiles: [
        {
          id: requested_id,
          full_name: "Alvo",
          is_public: true,
          allow_connections,
        },
      ],
      user_connections: [],
    },
  });

  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  let resposta;
  try {
    resposta = await CONEXOES.POST({
      json: async () => ({ requested_id, message: null }),
    });
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  return { status: resposta.status, corpo: await resposta.json(), sessao };
}

test("POST: `allow_connections: NULL` ACEITA o pedido -- era o `!null`", async () => {
  const { status, sessao } = await pedirConexao(NUNCA_MEXEU, null);

  assert.equal(status, 201);

  // O 201 sozinho nao bastaria: a prova e que a linha foi ESCRITA. Uma rota que
  // respondesse 201 sem inserir deixaria o pedido sumir em silencio.
  const inseridas = sessao.escritas.filter(
    (e) => e.tabela === "user_connections" && e.verbo === "insert"
  );
  assert.equal(inseridas.length, 1);
  assert.equal(inseridas[0].linhas[0].requester_id, EU);
  assert.equal(inseridas[0].linhas[0].requested_id, NUNCA_MEXEU);
});

test("POST: `allow_connections: false` continua RECUSADO (controle negativo)", async () => {
  const { status, corpo, sessao } = await pedirConexao(RECUSOU, false);

  assert.equal(status, 400);
  assert.match(corpo.error, /não aceita conexões/);

  // E nada foi escrito: recusar na resposta e inserir de qualquer jeito seria
  // o pior dos dois mundos.
  assert.equal(
    sessao.escritas.some((e) => e.tabela === "user_connections"),
    false
  );
});

test("POST: `allow_connections: true` continua aceitando", async () => {
  const { status } = await pedirConexao(PERMITE, true);
  assert.equal(status, 201);
});

// ---------------------------------------------------------------------------
// Controle POSITIVO da propria sonda
// ---------------------------------------------------------------------------

test("CONTROLE: a rota leu `profiles` pelo duble (a sonda nao esta vazia)", async () => {
  const { sessao, registro } = await buscar("Silva");

  // Sem isto, um dia em que a rota trocasse o jeito de obter o client faria
  // todas as assercoes acima medirem uma rota que nao consultou nada -- e
  // `deepEqual(nomes, [])` dos controles negativos passaria por vacuidade.
  // Ver o cabecalho de scripts/monta-duble-de-rota.mjs.
  assert.ok(
    registro.chamadasDeSessao > 0,
    "a rota tem de ter pedido o client de sessao ao duble"
  );
  assert.equal(
    sessao.lidas.some((l) => l.tabela === "profiles"),
    true,
    "a rota tem de ter consultado `profiles` pelo duble"
  );
});

test("CONTROLE: a conexao JA existente continua sendo filtrada", async () => {
  // O recorte que a rota ja fazia antes da issue, e que o `achados` novo (a
  // lista que junta nome + e-mail) nao pode ter perdido no caminho.
  const { nomes } = await buscar("Silva", {
    user_connections: [{ requester_id: EU, requested_id: PERMITE }],
  });

  assert.deepEqual(nomes, [NUNCA_MEXEU]);
});
