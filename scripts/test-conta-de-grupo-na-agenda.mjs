#!/usr/bin/env node
// =====================================================
// A REGRA DE "ESTA CONTA DE GRUPO NAO E MINHA" (HMO-411)
// =====================================================
//   npm run test:conta-de-grupo-na-agenda
//
// A parte PURA da decisao. Quem monta a linha e
// `scripts/test-conta-de-grupo-na-tela.mjs` (sonda de navegador); quem prova
// que a tela CHAMA esta regra e `scripts/check-conta-de-grupo-na-agenda.mjs`.
// Esta suite mede so o criterio -- e ele tem tres condicoes, cada uma
// excluindo um caso real que ja existe na tela.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  ehContaDeGrupoDeOutro,
  estadoDaMinhaParte,
} = await import("../.tmp-conta-de-grupo-na-agenda/lib/conta-de-grupo-na-agenda.js");

const EU = "eu";
const O_HELIO = "helio";

/** Uma conta de grupo GRAVADA, criada pelo Helio. O caso que a issue conserta. */
const DO_HELIO = {
  id: "s1",
  user_id: O_HELIO,
  group_id: "casa",
  my_status: "pending",
};

test("a conta de grupo de outro dono e desta linha", () => {
  assert.equal(ehContaDeGrupoDeOutro(DO_HELIO, EU), true);
});

test("a MINHA conta de grupo NAO e: a baixa dela e que rateia para os outros", () => {
  // Trocar os quatro botoes pelo aviso aqui quebraria o grupo inteiro:
  // ninguem mais pagaria a conta de verdade, e sem a baixa a trigger
  // `auto_create_group_transaction` nunca roda.
  assert.equal(
    ehContaDeGrupoDeOutro({ ...DO_HELIO, user_id: EU }, EU),
    false
  );
});

test("conta individual nao e, mesmo sendo de outra pessoa", () => {
  assert.equal(
    ehContaDeGrupoDeOutro({ ...DO_HELIO, group_id: null }, EU),
    false
  );
  assert.equal(
    ehContaDeGrupoDeOutro({ ...DO_HELIO, group_id: undefined }, EU),
    false
  );
});

test("a linha NAO GRAVADA nao e: a fatura e a parcela do MyBank tem `id: null`", () => {
  // As duas ja tem desenho proprio. Sem esta condicao, uma delas que um dia
  // ganhasse `group_id` cairia aqui e o botao montaria
  // `/api/scheduled-transactions/null/minha-baixa`.
  assert.equal(ehContaDeGrupoDeOutro({ ...DO_HELIO, id: null }, EU), false);
  assert.equal(ehContaDeGrupoDeOutro({ ...DO_HELIO, id: undefined }, EU), false);
});

test("sem saber quem eu sou, a resposta e `false` -- e a direcao do erro e o motivo", () => {
  // Com `""` a comparacao `user_id !== meuUserId` seria verdadeira para TODA
  // linha, e a tela trocaria os quatro botoes de todo mundo por um so. Errar
  // para "mostra os botoes de sempre" devolve a tela de antes desta issue;
  // errar para o outro lado apaga a baixa de verdade da tela inteira.
  for (const vazio of [null, undefined, ""]) {
    assert.equal(ehContaDeGrupoDeOutro(DO_HELIO, vazio), false, String(vazio));
  }
});

test("linha sem dono nao e desta linha", () => {
  // `user_id` ausente chega da fatura sintetizada. `undefined !== "eu"` e
  // verdadeiro, e sem o `Boolean(linha.user_id)` ela cairia aqui.
  assert.equal(ehContaDeGrupoDeOutro({ ...DO_HELIO, user_id: null }, EU), false);
  assert.equal(
    ehContaDeGrupoDeOutro({ ...DO_HELIO, user_id: undefined }, EU),
    false
  );
});

// ---------------------------------------------------------------------------
// O ESTADO DA MINHA PARTE
// ---------------------------------------------------------------------------

test("os tres estados saem de `my_status`", () => {
  assert.equal(estadoDaMinhaParte({ my_status: "pending" }), "pendente");
  assert.equal(estadoDaMinhaParte({ my_status: "reported" }), "avisado");
  assert.equal(estadoDaMinhaParte({ my_status: "paid" }), "confirmado");
});

test("linha ausente e valor desconhecido caem em `pendente`", () => {
  // Linha ausente em `group_bill_payments` E `pending` -- a view ja funde os
  // dois no COALESCE de `my_status`, e esta funcao nao os separa de novo.
  //
  // O desconhecido cai no mesmo lugar de proposito: o erro possivel passa a
  // ser oferecer o botao a quem ja avisou (a rota responde "voce ja avisou",
  // sem gravar nada), e nao esconder o botao de quem precisa dele.
  assert.equal(estadoDaMinhaParte({}), "pendente");
  assert.equal(estadoDaMinhaParte({ my_status: null }), "pendente");
  assert.equal(estadoDaMinhaParte({ my_status: "overdue" }), "pendente");
});

test("`status` do DONO nao e lido no lugar de `my_status`", () => {
  // O CONTROLE QUE IMPORTA. Uma versao que lesse `status` diria "confirmado"
  // para a conta que o Helio pagou -- e e exatamente o defeito desta issue: a
  // parte da pessoa some porque OUTRO alguem pagou.
  assert.equal(
    estadoDaMinhaParte({ status: "paid", my_status: "pending" }),
    "pendente"
  );
});
