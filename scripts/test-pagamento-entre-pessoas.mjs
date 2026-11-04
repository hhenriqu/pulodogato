#!/usr/bin/env node
// =====================================================
// PULODOGATO - o pagamento entre pessoas (081), a parte pura
// =====================================================
// A regra de banco (quem cria, quem confirma, valor e dono) esta em
// database/tests/081_pagamento_entre_pessoas_test.sql. Aqui: quem pede acao de
// quem chama, a descricao da receita de quem recebe, os rotulos e a validacao
// do pedido.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aLancarPorMim,
  chaveDoPagamento,
  descricaoDoRecebimento,
  problemaDoPedido,
  rotuloParaQuemPagou,
} from "../.tmp-pagamento-entre-pessoas/pagamento-entre-pessoas.js";

const base = {
  outra_pessoa_id: "h",
  outra_pessoa: "Helio",
  valor: 607.95,
  data: "2026-11-03",
  descricao: "Pagamento para Lais",
  lancamento_do_pagador: null,
  lancamento_do_recebedor: null,
  created_at: "2026-11-04T00:00:00Z",
};

test("so o recebido e ainda a lancar pede acao de quem chama", () => {
  const lista = [
    { ...base, id: "1", papel: "recebi", situacao: "a_lancar" },
    { ...base, id: "2", papel: "recebi", situacao: "lancado" },
    { ...base, id: "3", papel: "recebi", situacao: "recusado" },
    { ...base, id: "4", papel: "paguei", situacao: "a_lancar" },
  ];
  assert.deepEqual(aLancarPorMim(lista).map((p) => p.id), ["1"]);
});

test("a receita de quem recebe diz de quem veio", () => {
  assert.equal(
    descricaoDoRecebimento("Helio", "Pagamento para Lais"),
    "Recebido de Helio · Pagamento para Lais"
  );
  assert.equal(descricaoDoRecebimento("Helio", "  "), "Recebido de Helio");
  assert.equal(descricaoDoRecebimento("", null), "Recebido de outra pessoa");
});

test("a chave em notes aponta o pagamento", () => {
  assert.equal(chaveDoPagamento("abc"), "pagamento:abc");
});

test("quem pagou ve em que pe esta", () => {
  assert.equal(
    rotuloParaQuemPagou({ ...base, id: "1", papel: "paguei", outra_pessoa: "Lais", situacao: "a_lancar" }),
    "Aguardando Lais confirmar"
  );
  assert.equal(
    rotuloParaQuemPagou({ ...base, id: "1", papel: "paguei", outra_pessoa: "Lais", situacao: "lancado" }),
    "Lais confirmou"
  );
  assert.equal(
    rotuloParaQuemPagou({ ...base, id: "1", papel: "paguei", outra_pessoa: "Lais", situacao: "recusado" }),
    "Lais disse que não recebeu"
  );
});

test("o pedido exige o lancamento e a pessoa", () => {
  assert.equal(problemaDoPedido(null).ok, false);
  assert.equal(problemaDoPedido({ lancamento_id: "x" }).ok, false);
  assert.equal(problemaDoPedido({ recebedor_id: "y" }).ok, false);
  assert.equal(problemaDoPedido({ lancamento_id: 1, recebedor_id: "y" }).ok, false);
  assert.deepEqual(problemaDoPedido({ lancamento_id: "x", recebedor_id: "y" }), {
    ok: true,
    lancamentoId: "x",
    recebedorId: "y",
  });
});
