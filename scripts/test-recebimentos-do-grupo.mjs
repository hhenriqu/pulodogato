// =====================================================
// PULODOGATO - quem me paga a conta "A receber do grupo" (07/11/2026)
// =====================================================
// O caso de producao: o fechamento de 01/11 do grupo Casa deixou a Lais com
// "A receber do grupo" de R$ 71,68, a Leticia devendo R$ 123,59 e o Helio a
// receber R$ 51,91. A aba Receitas da Lais nao dizia de quem vinha o Pix nem
// tinha onde confirmar que ele chegou. `recebimentosDoMembro` e o espelho de
// `transferenciasDoMembro`: os pares do acerto em que EU recebo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { recebimentosDoMembro, transferenciasDoMembro, textoDoRecebimento } =
  await import("../.tmp-recebimentos-do-grupo/despesas-do-grupo.js");
const { paresDoAcerto } = await import(
  "../.tmp-recebimentos-do-grupo/acerto-do-fechamento.js"
);

const LAIS = "241dda5c-22c6-44f6-91e8-69d5e1fea3a2";
const LETICIA = "6582dc50-455b-46d4-ae62-eedf85cbd83e";
const HELIO = "2a1107d1-81fe-45d3-bd16-ed5dad884285";

// As contas do fechamento em aberto, como `contas_em_aberto_do_grupo` devolve.
const conta = (user_id, tipo, valor) => ({
  closing_id: "f-2026-11-01",
  period_end: "2026-11-01",
  user_id,
  tipo,
  valor,
  quitado: 0,
  aberto: valor,
});
const CONTAS = [
  conta(LAIS, "income", 71.68),
  conta(HELIO, "income", 51.91),
  conta(LETICIA, "expense", 123.59),
];

const NOMES = new Map([
  [LETICIA, "Leticia"],
  [HELIO, "Helio"],
]);

test("a Lais recebe R$ 71,68 da Leticia -- e so isso", () => {
  const pares = paresDoAcerto(CONTAS);
  const daLais = recebimentosDoMembro(pares, LAIS, NOMES);
  assert.deepEqual(daLais, [
    { de_user_id: LETICIA, para_user_id: LAIS, nome: "Leticia", valor: 71.68 },
  ]);
  assert.equal(textoDoRecebimento(daLais[0]), "Leticia te paga R$ 71,68");
});

test("quem deve nao tem recebimento, e quem recebe nao tem transferencia", () => {
  const pares = paresDoAcerto(CONTAS);
  assert.deepEqual(recebimentosDoMembro(pares, LETICIA, NOMES), []);
  assert.deepEqual(transferenciasDoMembro(pares, LAIS, NOMES), []);
});

test("os recebimentos somam a conta a receber de cada credor", () => {
  const pares = paresDoAcerto(CONTAS);
  const soma = (id) =>
    recebimentosDoMembro(pares, id, NOMES).reduce((s, r) => s + Math.round(r.valor * 100), 0) / 100;
  assert.equal(soma(LAIS), 71.68);
  assert.equal(soma(HELIO), 51.91);
});

test("sem nome legivel, a frase nao fica sem sujeito", () => {
  const pares = paresDoAcerto(CONTAS);
  const [r] = recebimentosDoMembro(pares, LAIS, new Map());
  assert.equal(r.nome, null);
  assert.match(textoDoRecebimento(r), /^Outro membro do grupo te paga/);
});
