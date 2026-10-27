#!/usr/bin/env node
// =====================================================
// PULODOGATO - a conexao funciona como um grupo de duas pessoas (075)
// =====================================================
// "Conexoes devem funcionar assim como grupos: quando lancar contas, ficar
// registrado na conexao, aparecer pra quem vai receber como receita prevista e
// pra quem paga como despesa, pra saber o quanto tem que pagar por mes."
//
// As duas metades puras de lib/conta-da-conexao.ts:
//
//   * a parte que a despesa fixa, a prevista e a parcelada levam para o banco
//     (`divisaoParaGravar`, `conferirDivisao`) -- ate a 075 ela era descartada
//     em silencio nesses tres caminhos;
//   * o resumo do mes da conexao (`resumoDaConexao`) -- quanto eu pago, quanto
//     eu recebo, e o saldo.
//
// A metade de banco (as contas geradas, a trava, a regra) esta em
// database/tests/075_conta_dividida_com_conexao_test.sql.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  PARAM_DA_CONEXAO,
  conferirDivisao,
  divisaoParaGravar,
  resumoDaConexao,
} from "../.tmp-conta-da-conexao/conta-da-conexao.js";

const HELIO = "a1";
const LAIS = "b1";
const LETICIA = "e1";

// ---------------------------------------------------------------------------
// O QUE O FORMULARIO MANDA
// ---------------------------------------------------------------------------

test("a despesa dividida com a Lais leva a parte dela", () => {
  assert.deepEqual(
    divisaoParaGravar({
      compartilhado: true,
      grupoId: "",
      rateios: [{ participanteId: LAIS, percentual: 40 }],
    }),
    [{ participant_id: LAIS, percentage: 40 }]
  );
});

test("com grupo nao vai parte de pessoa: o grupo ja diz quem paga (RN020.4)", () => {
  assert.deepEqual(
    divisaoParaGravar({
      compartilhado: true,
      grupoId: "casa",
      rateios: [{ participanteId: LAIS, percentual: 40 }],
    }),
    []
  );
});

test("desmarcar 'Dividir esta despesa' nao manda a parte que ficou no estado", () => {
  assert.deepEqual(
    divisaoParaGravar({
      compartilhado: false,
      grupoId: "",
      rateios: [{ participanteId: LAIS, percentual: 40 }],
    }),
    []
  );
});

test("parte zerada nao vai", () => {
  assert.deepEqual(
    divisaoParaGravar({
      compartilhado: true,
      grupoId: "",
      rateios: [
        { participanteId: LAIS, percentual: 0 },
        { participanteId: LETICIA, percentual: 30 },
      ],
    }),
    [{ participant_id: LETICIA, percentage: 30 }]
  );
});

test("o link da tela da conexao e o leitor do formulario usam o mesmo nome", () => {
  assert.equal(PARAM_DA_CONEXAO, "conexao");
});

// ---------------------------------------------------------------------------
// O QUE A ROTA ACEITA
// ---------------------------------------------------------------------------

test("sem campo ou lista vazia e 'sem divisao'", () => {
  assert.deepEqual(conferirDivisao(undefined, HELIO), { ok: true, partes: [] });
  assert.deepEqual(conferirDivisao(null, HELIO), { ok: true, partes: [] });
  assert.deepEqual(conferirDivisao([], HELIO), { ok: true, partes: [] });
});

test("a parte valida passa, com o percentual em centesimos", () => {
  assert.deepEqual(
    conferirDivisao([{ participant_id: LAIS, percentage: "33.333" }], HELIO),
    { ok: true, partes: [{ participant_id: LAIS, percentage: 33.33 }] }
  );
});

test("33,33 + 33,33 + 33,34 fecha 100 sem o erro do ponto flutuante", () => {
  const r = conferirDivisao(
    [
      { participant_id: LAIS, percentage: 33.33 },
      { participant_id: LETICIA, percentage: 33.33 },
      { participant_id: "c1", percentage: 33.34 },
    ],
    HELIO
  );
  assert.equal(r.ok, true);
});

test("o que a rota recusa, cada um com a frase dele", () => {
  const casos = [
    ["nao e lista", { participant_id: LAIS }, /lista/],
    ["sem pessoa", [{ percentage: 10 }], /com quem/],
    ["zero", [{ participant_id: LAIS, percentage: 0 }], /0,01% a 100%/],
    ["acima de 100", [{ participant_id: LAIS, percentage: 101 }], /0,01% a 100%/],
    ["texto", [{ participant_id: LAIS, percentage: "abc" }], /0,01% a 100%/],
    ["consigo mesmo", [{ participant_id: HELIO, percentage: 10 }], /você mesmo/],
    [
      "pessoa repetida",
      [
        { participant_id: LAIS, percentage: 10 },
        { participant_id: LAIS, percentage: 20 },
      ],
      /duas vezes/,
    ],
    [
      "soma acima de 100",
      [
        { participant_id: LAIS, percentage: 60 },
        { participant_id: LETICIA, percentage: 50 },
      ],
      /passa de 100%/,
    ],
  ];
  for (const [nome, bruto, frase] of casos) {
    const r = conferirDivisao(bruto, HELIO);
    assert.equal(r.ok, false, nome);
    assert.match(r.erro, frase, nome);
  }
});

// ---------------------------------------------------------------------------
// QUANTO PAGAR E QUANTO RECEBER, POR MES
// ---------------------------------------------------------------------------

const conta = (id, due_date, transaction_type, amount, status = "pending") => ({
  id,
  description: `${transaction_type === "income" ? "A receber de Lais" : "Pagamento a Lais"} — ${id}`,
  amount,
  due_date,
  status,
  transaction_type,
});

test("o mes junta o que eu pago e o que eu recebo, e o saldo", () => {
  const [novembro] = resumoDaConexao([
    conta("aluguel", "2026-11-10", "income", "800.00"),
    conta("agropecuaria", "2026-11-22", "expense", "71.87"),
    conta("luz", "2026-11-15", "income", 37.5),
  ]);
  assert.equal(novembro.mes, "2026-11");
  assert.equal(novembro.aReceber, 837.5);
  assert.equal(novembro.aPagar, 71.87);
  assert.equal(novembro.saldo, 765.63);
  assert.deepEqual(
    novembro.contas.map((c) => c.id),
    ["aluguel", "luz", "agropecuaria"],
    "as contas saem na ordem do vencimento"
  );
});

test("a conta paga sai do 'a pagar' e entra no 'ja pagou'", () => {
  const [mes] = resumoDaConexao([
    conta("a", "2026-11-10", "expense", 100, "paid"),
    conta("b", "2026-11-20", "expense", 50),
    conta("c", "2026-11-21", "income", 30, "paid"),
  ]);
  assert.equal(mes.aPagar, 50);
  assert.equal(mes.pago, 100);
  assert.equal(mes.recebido, 30);
  assert.equal(mes.aReceber, 0);
  assert.equal(mes.saldo, -50);
});

test("pulada e cancelada nao contam: nao vao acontecer", () => {
  const meses = resumoDaConexao([
    conta("a", "2026-11-10", "expense", 100, "skipped"),
    conta("b", "2026-11-20", "expense", 50, "cancelled"),
  ]);
  assert.deepEqual(meses, []);
});

test("cada mes e um balde, em ordem", () => {
  const meses = resumoDaConexao([
    conta("dez", "2026-12-10", "income", 800),
    conta("nov", "2026-11-10", "income", 800),
    conta("out", "2026-10-10", "expense", 10),
  ]);
  assert.deepEqual(
    meses.map((m) => [m.mes, m.saldo]),
    [
      ["2026-10", -10],
      ["2026-11", 800],
      ["2026-12", 800],
    ]
  );
});

test("a soma e feita em centavos: 0,1 + 0,2 da 0,3", () => {
  const [mes] = resumoDaConexao([
    conta("a", "2026-11-01", "expense", 0.1),
    conta("b", "2026-11-02", "expense", 0.2),
  ]);
  assert.equal(mes.aPagar, 0.3);
});
