#!/usr/bin/env node
// =====================================================
// PULODOGATO - quem o admin pode assumir no "Entrar como"
// =====================================================
// O plano "admin" vale para o app inteiro. O que impede o admin de entrar na
// conta de qualquer usuario e `possoAssumir`: so membro ATIVO, com conta, de
// um grupo onde o admin tambem esta ATIVO. Este teste fixa esse recorte.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pessoasQuePossoAssumir,
  possoAssumir,
  lerEntrouComo,
  escreverEntrouComo,
} from "../.tmp-entrar-como/entrar-como.js";

const HELIO = "h";
const membros = [
  { group_id: "casa", user_id: HELIO, status: "active", nome: "Helio", grupo: "Casa" },
  { group_id: "casa", user_id: "lais", status: "active", nome: "Lais", grupo: "Casa" },
  { group_id: "casa", user_id: "leticia", status: "active", nome: "Letícia", grupo: "Casa" },
  { group_id: "casa", user_id: null, status: "active", nome: null, grupo: "Casa" },
  { group_id: "casa", user_id: "saiu", status: "removed", nome: "Saiu", grupo: "Casa" },
  // Grupo de onde o Helio saiu: quem esta la nao entra na lista por ele.
  { group_id: "antigo", user_id: HELIO, status: "removed", nome: "Helio", grupo: "Antigo" },
  { group_id: "antigo", user_id: "ex", status: "active", nome: "Ex", grupo: "Antigo" },
  // Grupo do qual o Helio nunca fez parte.
  { group_id: "outro", user_id: "estranho", status: "active", nome: "Estranho", grupo: "Outro" },
  // A Lais tambem em outro grupo com o Helio: aparece uma vez, com os dois.
  { group_id: "viagem", user_id: HELIO, status: "active", nome: "Helio", grupo: "Viagem" },
  { group_id: "viagem", user_id: "lais", status: "active", nome: "Lais", grupo: "Viagem" },
];

test("lista so os membros ativos, com conta, dos grupos ativos do admin", () => {
  const lista = pessoasQuePossoAssumir(HELIO, membros);
  assert.deepEqual(
    lista.map((p) => p.user_id),
    ["lais", "leticia"]
  );
  assert.deepEqual(lista[0].grupos, ["Casa", "Viagem"]);
});

test("o admin nunca assume a si mesmo", () => {
  assert.equal(possoAssumir(HELIO, HELIO, membros), false);
});

test("membro de grupo em comum pode", () => {
  assert.equal(possoAssumir(HELIO, "leticia", membros), true);
});

test("quem saiu do grupo, grupo de onde o admin saiu e grupo alheio nao podem", () => {
  assert.equal(possoAssumir(HELIO, "saiu", membros), false);
  assert.equal(possoAssumir(HELIO, "ex", membros), false);
  assert.equal(possoAssumir(HELIO, "estranho", membros), false);
  assert.equal(possoAssumir(HELIO, "", membros), false);
});

test("admin sem grupo nao assume ninguem", () => {
  assert.deepEqual(pessoasQuePossoAssumir("ninguem", membros), []);
});

test("o cookie do aviso vai e volta, e estragado vira null", () => {
  assert.deepEqual(lerEntrouComo(escreverEntrouComo("Letícia")), { nome: "Letícia" });
  // Como chega no navegador: o Next codifica uma vez ao gravar.
  const gravado = encodeURIComponent(escreverEntrouComo("Lais Bernucio"));
  assert.deepEqual(lerEntrouComo(gravado), { nome: "Lais Bernucio" });
  // O valor real visto em producao com a primeira versao (codificado duas vezes).
  assert.deepEqual(
    lerEntrouComo("%257B%2522nome%2522%253A%2522Lais%2520Bernucio%2522%257D"),
    { nome: "Lais Bernucio" }
  );
  assert.equal(lerEntrouComo("%E0%A4%A"), null);
  assert.equal(lerEntrouComo("%7Bquebrado"), null);
  assert.equal(lerEntrouComo(undefined), null);
  assert.equal(lerEntrouComo(escreverEntrouComo("  ")), null);
});
