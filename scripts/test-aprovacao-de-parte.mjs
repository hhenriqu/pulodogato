import test from "node:test";
import assert from "node:assert/strict";

import {
  acoesDaParte,
  ehParteDe,
  rotuloDaAcao,
} from "../.tmp-aprovacao-de-parte/aprovacao-de-parte.js";

/**
 * HMO-178. O bug que esta suite existe para nao deixar voltar: a tela do grupo
 * mostrava tres status (`pending`, `approved`, `rejected`) e nenhum caminho do
 * app escrevia outro valor alem de `pending`. O cracha era um rotulo morto.
 *
 * O contrato aqui tem duas metades, e a suite exige as DUAS separadamente --
 * uma assercao que so cobre "aparece para o dono" passaria com uma funcao que
 * ignora o status, e uma que so cobre "pending oferece aprovar" passaria com
 * uma funcao que ignora de quem e a parte. Essa segunda e a perigosa: recusar
 * tira a parte de `total_owed` em `group_member_balances`, entao um botao
 * oferecido na linha errada mexe no saldo de outra pessoa.
 */

test("a parte pendente do proprio usuario oferece aprovar e recusar", () => {
  assert.deepEqual(acoesDaParte({ status: "pending", ehMinha: true }), [
    "approve",
    "reject",
  ]);
});

test("a parte pendente de OUTRO membro nao oferece acao nenhuma", () => {
  // A metade que o mutante largo derruba: sem esta, `acoesDaParte` poderia
  // ignorar `ehMinha` por inteiro e a suite continuaria verde.
  assert.deepEqual(acoesDaParte({ status: "pending", ehMinha: false }), []);
  assert.deepEqual(acoesDaParte({ status: "approved", ehMinha: false }), []);
  assert.deepEqual(acoesDaParte({ status: "rejected", ehMinha: false }), []);
});

test("parte ja aprovada oferece reabrir, e NAO oferece aprovar de novo", () => {
  const acoes = acoesDaParte({ status: "approved", ehMinha: true });
  assert.deepEqual(acoes, ["reopen"]);
  // A negacao explicita: "reopen esta na lista" sozinho passaria mesmo se
  // `approve` continuasse ali, e um botao Aprovar numa parte aprovada so
  // renderia 409 da rota.
  assert.ok(!acoes.includes("approve"));
  assert.ok(!acoes.includes("reject"));
});

test("parte recusada oferece reabrir, e so isso", () => {
  const acoes = acoesDaParte({ status: "rejected", ehMinha: true });
  assert.deepEqual(acoes, ["reopen"]);
  assert.ok(!acoes.includes("reject"));
});

test("parte expirada nao oferece volta nem para o dono", () => {
  // `expired` esta no CHECK da tabela desde a 001 mas nenhum caminho do app o
  // escreve. Oferecer reabrir seria inventar uma regra de negocio que nao
  // existe em lugar nenhum.
  assert.deepEqual(acoesDaParte({ status: "expired", ehMinha: true }), []);
});

test("status desconhecido nao derruba a lista nem inventa acao", () => {
  // Status novo vindo do banco (a tela e mais velha que a migration que o
  // criaria) tem que virar zero botao, e nao `undefined.map` no JSX.
  assert.deepEqual(acoesDaParte({ status: "coisa-nova", ehMinha: true }), []);
});

test("dois ids ausentes NAO fazem a parte ser minha", () => {
  // `undefined === undefined` e `true`. Este e o caso que existe de verdade:
  // primeiro render, sessao ainda carregando (`user` nulo) e um `member` que o
  // join nao trouxe -- a comparacao ingenua ofereceria "Recusar" numa parte de
  // dono desconhecido, e recusar mexe no saldo.
  assert.equal(ehParteDe(undefined, undefined), false);
  assert.equal(ehParteDe(null, null), false);
  assert.equal(ehParteDe("", ""), false);
  assert.equal(ehParteDe("perfil-1", undefined), false);
  assert.equal(ehParteDe(undefined, "perfil-1"), false);
});

test("ids iguais sao a mesma pessoa, ids diferentes nao", () => {
  // O controle positivo do par acima: sem ele, `ehParteDe = () => false`
  // passaria em todas as assercoes de ausencia e nenhum botao apareceria nunca.
  assert.equal(ehParteDe("perfil-1", "perfil-1"), true);
  assert.equal(ehParteDe("perfil-1", "perfil-2"), false);
});

test("a parte de outro membro nao ganha botao nem com status que aceita acao", () => {
  // A composicao das duas funcoes, que e o que o JSX faz de fato.
  assert.deepEqual(
    acoesDaParte({
      status: "pending",
      ehMinha: ehParteDe("perfil-do-outro", "perfil-1"),
    }),
    []
  );
  assert.deepEqual(
    acoesDaParte({
      status: "pending",
      ehMinha: ehParteDe("perfil-1", "perfil-1"),
    }),
    ["approve", "reject"]
  );
});

test("cada acao tem rotulo proprio, e os tres sao distintos", () => {
  const rotulos = ["approve", "reject", "reopen"].map(rotuloDaAcao);
  assert.deepEqual(rotulos, ["Aprovar", "Recusar", "Reabrir"]);
  assert.equal(new Set(rotulos).size, 3);
});

/**
 * Controle POSITIVO da tabela de transicoes: prova que a suite acima esta
 * mesmo lendo o modulo compilado e nao uma fixture que fecha sozinha. Se
 * `acoesDaParte` virasse `() => []`, todo teste de "nao oferece" passaria --
 * este aqui e o que quebra.
 */
test("existe pelo menos um caminho que oferece acao", () => {
  const todas = new Set();
  for (const status of ["pending", "approved", "rejected", "expired"]) {
    for (const acao of acoesDaParte({ status, ehMinha: true })) {
      todas.add(acao);
    }
  }
  assert.deepEqual([...todas].sort(), ["approve", "reject", "reopen"]);
});
