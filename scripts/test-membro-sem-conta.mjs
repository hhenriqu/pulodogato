#!/usr/bin/env node
// =====================================================
// PULODOGATO - o participante sem conta (077)
// =====================================================
// A metade TypeScript da 077, em lib/membro-sem-conta.ts: o nome que a rota de
// adicionar aceita, a identidade de cada um no saldo e no acerto, e o perfil
// de fachada que a tela le. A metade de banco (CHECKs, RLS, rateio, saldo,
// acerto e a trava do fechamento) esta em
// database/tests/077_membro_sem_conta_e_quem_pagou_test.sql.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  TAMANHO_MAXIMO_DO_NOME,
  idDaParte,
  membroParaATela,
  nomeDoMembro,
  nomeDoParticipanteParaGravar,
  respostaDoErroDoBanco,
  semConta,
} from "../.tmp-membro-sem-conta/membro-sem-conta.js";

test("o limite do nome e o do CHECK da 077", () => {
  assert.equal(TAMANHO_MAXIMO_DO_NOME, 80);
});

test("o nome chega limpo: pontas e espacos repetidos saem", () => {
  assert.deepEqual(nomeDoParticipanteParaGravar("  Joao   da  Silva "), {
    ok: true,
    nome: "Joao da Silva",
  });
});

test("nome vazio, so espaco ou que nao e texto e recusado", () => {
  for (const bruto of ["", "   ", undefined, null, 42]) {
    const r = nomeDoParticipanteParaGravar(bruto);
    assert.equal(r.ok, false, String(bruto));
  }
});

test("nome no limite passa, um caractere a mais e recusado", () => {
  assert.equal(nomeDoParticipanteParaGravar("a".repeat(80)).ok, true);
  const longo = nomeDoParticipanteParaGravar("a".repeat(81));
  assert.equal(longo.ok, false);
  assert.match(longo.erro, /80/);
});

test("a identidade da parte: user_id de quem tem conta, a linha de quem nao tem", () => {
  assert.equal(idDaParte({ member_id: "m1", user_id: "u1" }), "u1");
  assert.equal(idDaParte({ member_id: "m2", user_id: null }), "m2");
  assert.equal(semConta({ user_id: null }), true);
  assert.equal(semConta({ user_id: "u1" }), false);
});

test("o nome na tela: o perfil para quem tem conta, display_name para quem nao tem", () => {
  assert.equal(nomeDoMembro({ user_id: "u1", display_name: "ignorado" }, "Lais"), "Lais");
  assert.equal(nomeDoMembro({ user_id: "u1" }, null), null);
  assert.equal(nomeDoMembro({ user_id: null, display_name: "Joao" }), "Joao");
});

test("o perfil de fachada tem id nulo, para nenhuma comparacao com o usuario logado dar verdadeiro", () => {
  const perfil = { id: "u1", full_name: "Lais", avatar_url: null };
  assert.equal(membroParaATela({ user_id: "u1" }, perfil), perfil);
  assert.deepEqual(membroParaATela({ user_id: null, display_name: "Joao" }, null), {
    id: null,
    full_name: "Joao",
    avatar_url: null,
  });
  // A RLS de profiles pode esconder o perfil de quem tem conta: continua nulo,
  // e nao vira fachada com o display_name.
  assert.equal(membroParaATela({ user_id: "u1", display_name: "x" }, null), null);
});

test("as travas do banco viram a resposta certa da rota", () => {
  assert.deepEqual(respostaDoErroDoBanco({ code: "PDG77", message: "fecha" }), {
    status: 409,
    mensagem: "fecha",
  });
  assert.equal(
    respostaDoErroDoBanco({
      code: "42501",
      message: 'new row violates row-level security policy for table "group_members"',
    }).mensagem,
    "Só o admin do grupo pode fazer isso."
  );
  assert.deepEqual(
    respostaDoErroDoBanco({ code: "42501", message: "So quem participa do grupo lanca despesa nele." }),
    { status: 403, mensagem: "So quem participa do grupo lanca despesa nele." }
  );
  assert.equal(respostaDoErroDoBanco({ code: "23514", message: "check" }).status, 400);
  assert.equal(respostaDoErroDoBanco({ code: "22023", message: "valor" }).status, 400);
  // Erro inesperado nao vaza a mensagem do banco.
  assert.deepEqual(respostaDoErroDoBanco({ code: "XX000", message: "interno" }), {
    status: 500,
    mensagem: "Não foi possível gravar.",
  });
});
