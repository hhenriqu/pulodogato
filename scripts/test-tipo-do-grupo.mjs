#!/usr/bin/env node
// =====================================================
// PULODOGATO - o tipo do grupo: casa ou evento (076)
// =====================================================
// A metade TypeScript da 076, em lib/tipo-do-grupo.ts: o que a rota de criar e
// de editar grupo aceita gravar, e como a tela le uma resposta sem a coluna.
// A metade de banco (CHECK, DEFAULT e a classificacao dos grupos que ja
// existiam) esta em database/tests/076_tipo_do_grupo_test.sql.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  TIPOS_DE_GRUPO,
  TIPO_PADRAO,
  ROTULO_DO_TIPO,
  DESCRICAO_DO_TIPO,
  casaPrimeiro,
  tipoDoGrupo,
  tipoDoGrupoParaGravar,
} from "../.tmp-tipo-do-grupo/tipo-do-grupo.js";

test("os tipos sao os mesmos do CHECK da 076, e o padrao e o DEFAULT da coluna", () => {
  assert.deepEqual([...TIPOS_DE_GRUPO], ["casa", "evento"]);
  assert.equal(TIPO_PADRAO, "evento");
});

test("a rota grava casa e evento como vieram", () => {
  assert.equal(tipoDoGrupoParaGravar("casa"), "casa");
  assert.equal(tipoDoGrupoParaGravar("evento"), "evento");
});

test("campo ausente vira evento: o cliente anterior a 076 continua criando grupo", () => {
  assert.equal(tipoDoGrupoParaGravar(undefined), "evento");
  assert.equal(tipoDoGrupoParaGravar(null), "evento");
  assert.equal(tipoDoGrupoParaGravar(""), "evento");
});

test("valor fora da lista e recusado (400), e nao trocado por evento em silencio", () => {
  assert.equal(tipoDoGrupoParaGravar("familia"), null);
  assert.equal(tipoDoGrupoParaGravar("Casa"), null);
  assert.equal(tipoDoGrupoParaGravar("public"), null);
  assert.equal(tipoDoGrupoParaGravar(1), null);
});

test("a tela le a resposta sem a coluna como evento", () => {
  assert.equal(tipoDoGrupo(undefined), "evento");
  assert.equal(tipoDoGrupo("qualquer"), "evento");
  assert.equal(tipoDoGrupo("casa"), "casa");
});

test("todo tipo tem rotulo e descricao", () => {
  for (const tipo of TIPOS_DE_GRUPO) {
    assert.ok(ROTULO_DO_TIPO[tipo]);
    assert.ok(DESCRICAO_DO_TIPO[tipo]);
  }
});

test("a casa vem primeiro na lista, e o resto fica na ordem que veio", () => {
  const grupos = [
    { id: "viagem", group_kind: "evento" },
    { id: "churrasco" },
    { id: "casa", group_kind: "casa" },
    { id: "festa", group_kind: "evento" },
  ];
  assert.deepEqual(
    casaPrimeiro(grupos).map((g) => g.id),
    ["casa", "viagem", "churrasco", "festa"]
  );
  // nao muda o array de entrada
  assert.equal(grupos[0].id, "viagem");
});
