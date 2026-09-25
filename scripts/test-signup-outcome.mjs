import test from "node:test";
import assert from "node:assert/strict";

import {
  DESTINO_LOGADO,
  MENSAGEM_CONFIRMACAO,
  decidirPosCadastro,
  temSessaoUtil,
} from "../.tmp-signup-outcome/signup-outcome.js";

import {
  CONFLITO_PERFIL,
  garantirPerfil,
  nomeDoUsuario,
  perfilDoUsuario,
} from "../.tmp-signup-outcome/ensure-profile.js";

const sessaoValida = { user: { id: "0d1c1a6e-0000-4000-8000-000000000001" } };

test("sem sessao o cadastro pede a confirmacao por email", () => {
  const r = decidirPosCadastro(null);

  assert.equal(r.kind, "confirmar");
  assert.equal(r.mensagem, MENSAGEM_CONFIRMACAO);
});

test("com sessao o cadastro termina logado e assume o perfil", () => {
  const r = decidirPosCadastro(sessaoValida);

  assert.equal(r.kind, "logado");
  assert.equal(r.destino, DESTINO_LOGADO);
  // O perfil precisa nascer NESTE caminho: ninguem passa por /auth/callback
  // quando a confirmacao de email esta desligada.
  assert.equal(r.criarPerfil, true);
});

test("o destino de quem termina logado nao e a tela de login", () => {
  // O bug original: o cadastro despachava para /login todo mundo, inclusive
  // quem ja estava logado.
  const r = decidirPosCadastro(sessaoValida);

  assert.equal(r.kind, "logado");
  assert.ok(!r.destino.startsWith("/login"), `destino era ${r.destino}`);
});

test("sessao sem usuario nao conta como logado", () => {
  // Sem `auth.uid()` a policy `profiles_insert_own` recusa o insert; chamar
  // isto de "logado" trocaria a tela por uma gravacao que a RLS nega.
  for (const sessao of [{}, { user: null }, { user: {} }, { user: { id: "" } }]) {
    assert.equal(temSessaoUtil(sessao), false, JSON.stringify(sessao));
    assert.equal(decidirPosCadastro(sessao).kind, "confirmar");
  }
});

test("undefined e tratado como ausencia de sessao", () => {
  assert.equal(temSessaoUtil(undefined), false);
  assert.equal(decidirPosCadastro(undefined).kind, "confirmar");
});

test("o nome do formulario chega ao perfil", () => {
  const perfil = perfilDoUsuario({
    id: "u1",
    email: "a@b.com",
    user_metadata: { full_name: "Helio Moraes" },
  });

  assert.deepEqual(perfil, {
    id: "u1",
    email: "a@b.com",
    full_name: "Helio Moraes",
  });
});

test("metadata sem nome nao vira string estranha", () => {
  // `user_metadata` e JSON livre: o que vier que nao for string vira null, em
  // vez de gravar "undefined" ou "[object Object]" no perfil.
  for (const full_name of [undefined, null, 42, {}, [], true, "   "]) {
    assert.equal(nomeDoUsuario({ id: "u1", user_metadata: { full_name } }), null, String(full_name));
  }

  assert.equal(nomeDoUsuario({ id: "u1" }), null);
  assert.equal(nomeDoUsuario({ id: "u1", user_metadata: null }), null);
});

test("o nome vem sem espaco sobrando", () => {
  assert.equal(
    nomeDoUsuario({ id: "u1", user_metadata: { full_name: "  Helio  " } }),
    "Helio"
  );
});

test("email ausente vira null e nao undefined", () => {
  // A coluna aceita NULL; `undefined` num upsert do supabase-js OMITE a coluna,
  // que e outra coisa.
  const perfil = perfilDoUsuario({ id: "u1" });

  assert.equal(perfil.email, null);
  assert.ok("email" in perfil);
});

test("o arbitro do ON CONFLICT e a primary key, e nao sobrescreve", () => {
  // `id` e indice CHEIO (PK): indice parcial nao serve de arbitro porque o
  // supabase-js nao manda o predicado. E `ignoreDuplicates` protege o nome que
  // o usuario editou nas configuracoes.
  assert.equal(CONFLITO_PERFIL.onConflict, "id");
  assert.equal(CONFLITO_PERFIL.ignoreDuplicates, true);
});

test("garantirPerfil grava com a chave e as opcoes certas", async () => {
  const chamadas = [];
  const cliente = {
    from(tabela) {
      chamadas.push({ tabela });
      return {
        upsert(valores, opcoes) {
          chamadas.push({ valores, opcoes });
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const { error } = await garantirPerfil(cliente, {
    id: "u9",
    email: "z@b.com",
    user_metadata: { full_name: "Z" },
  });

  assert.equal(error, null);
  assert.deepEqual(chamadas[0], { tabela: "profiles" });
  assert.deepEqual(chamadas[1].valores, {
    id: "u9",
    email: "z@b.com",
    full_name: "Z",
  });
  assert.equal(chamadas[1].opcoes.onConflict, "id");
});

test("o erro do banco volta para quem chamou, em vez de ser engolido", async () => {
  // Foi um `console.error` solto que deixou o cadastro quebrado por meses sem
  // sintoma. O erro precisa SAIR da funcao.
  const cliente = {
    from: () => ({
      upsert: () =>
        Promise.resolve({ error: { message: "new row violates row-level security policy" } }),
    }),
  };

  const { error } = await garantirPerfil(cliente, { id: "u1" });

  assert.equal(error.message, "new row violates row-level security policy");
});
