#!/usr/bin/env node
// =====================================================
// PULODOGATO - zero linha e FALHA, nao sucesso (HMO-203)
// =====================================================
// O defeito que este modulo fecha foi medido em producao em 2026-09-30, na rota
// de restaurar grupo: HTTP 200 com "Grupo restaurado com sucesso!" e a linha
// intacta no banco, antes e depois. A causa nao estava no SQL nem no codigo da
// rota lidos separadamente -- estava na combinacao:
//
//   * a policy de UPDATE era `USING (is_group_admin(id))` e o chamador nao
//     passava mais nela. A RLS, nesse caso, FILTRA as linhas em vez de recusar:
//     o PATCH volta 200 com corpo `[]`, sem erro e sem SQLSTATE;
//   * `supabase-js` sem `.select()` nao devolve contagem: `data` e `error` vem
//     os DOIS nulos.
//
// Entao `if (error)` -- que e o que toda rota deste repo fazia -- nao tinha como
// disparar. A rota nao mentia por descuido; ela nao tinha nenhum sinal para ler.
//
// ===========================================================================
// O QUE ESTE ARQUIVO AFIRMA, E POR QUE CADA CASO EXISTE
// ===========================================================================
// A funcao tem quatro desfechos, e tres deles sao "nao deu". A tentacao e
// colapsar os tres em `false`, e cada colapso apaga uma informacao diferente:
//
//   1. `erro`         -> o banco recusou de verdade (CHECK, FK, trigger, GRANT).
//                        Tem mensagem do banco, e e ela que diz o que fazer;
//   2. `nenhuma-linha`-> O CASO DA ISSUE. Passou e nao pegou linha. Em rota sob
//                        RLS e quase sempre a policy, e nao o dado;
//   3. `sem-select`   -> `data` nulo COM `error` nulo. Aqui a escrita pode ter
//                        funcionado: o defeito e no chamador, que esqueceu o
//                        `.select()`. Juntar este com o (2) daria a uma rota mal
//                        escrita a aparencia de uma rota barrada pela RLS, e o
//                        conserto iria para o lugar errado -- alguem mexeria na
//                        policy por causa de um `.select()` faltando.
//
// `linhas` no caso `ok` tambem nao e enfeite: a rota de arquivar precisa saber
// QUANTOS membros arquivou, e a de restaurar mostra isso na resposta.
//
// A ARMADILHA DESTE ARQUIVO: ele nao pode se contentar com `ok === false`.
// Um teste assim passaria verde com a funcao devolvendo `erro` para os tres
// casos -- e seria indistinguivel de hoje para quem le o placar. Por isso toda
// assercao de falha aqui olha o `motivo`, e nao so o `ok`.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import { conferirEscrita } from "../.tmp-escrita-conferida/escrita-conferida.js";

test("uma linha escrita e sucesso, e a contagem vem junto", () => {
  const r = conferirEscrita({ data: [{ id: "a" }], error: null }, "arquivar o grupo");

  assert.equal(r.ok, true);
  assert.equal(r.linhas, 1);
});

test("varias linhas: a contagem e o numero de linhas, nao um booleano", () => {
  // A rota de arquivar membros escreve N linhas de uma vez, e a de restaurar
  // devolve `members_restored` para a tela. `ok: true` sem numero obrigaria
  // cada chamador a refazer o `.length`, que e justamente o passo que se
  // esquece.
  const r = conferirEscrita(
    { data: [{ id: "a" }, { id: "b" }, { id: "c" }], error: null },
    "arquivar os membros"
  );

  assert.equal(r.ok, true);
  assert.equal(r.linhas, 3);
});

test("O CASO DA HMO-203: lista vazia sem erro e FALHA, com motivo proprio", () => {
  // Isto e, literalmente, o que o PostgREST devolveu em producao:
  // `HTTP 200, corpo []`. Nenhum erro, nenhuma linha.
  const r = conferirEscrita({ data: [], error: null }, "restaurar o grupo");

  assert.equal(r.ok, false);
  // `ok === false` nao basta como assercao: a funcao poderia estar devolvendo
  // `erro` aqui e o teste passaria igual, escondendo que o caso mais importante
  // perdeu a identidade dele.
  assert.equal(r.motivo, "nenhuma-linha");
});

test("a mensagem de lista vazia nomeia a escrita E a causa provavel", () => {
  const r = conferirEscrita({ data: [], error: null }, "restaurar o grupo");

  assert.equal(r.ok, false);
  // O nome da escrita: sem ele o log diz "zero linhas" e quem le nao sabe de
  // qual das duas escritas da rota se trata.
  assert.match(r.mensagem, /restaurar o grupo/);
  // E a causa provavel. Esta e a parte que economiza a investigacao: "zero
  // linhas" leva a procurar dado errado; a policy e o que realmente acontece.
  assert.match(r.mensagem, /RLS/);
});

test("erro do banco tem motivo proprio e carrega a mensagem do banco", () => {
  const r = conferirEscrita(
    {
      data: null,
      error: { message: 'new row violates check constraint "group_members_status_check"' },
    },
    "arquivar os membros"
  );

  assert.equal(r.ok, false);
  assert.equal(r.motivo, "erro");
  assert.match(r.mensagem, /group_members_status_check/);
});

test("erro TEM PRECEDENCIA sobre data nulo", () => {
  // Quando o banco levanta erro, `data` vem nulo de qualquer forma. Se a ordem
  // dos ifs estivesse invertida, um CHECK violado sairia como "sem-select" --
  // e o diagnostico mandaria encadear `.select()` numa rota que ja tem, em vez
  // de olhar o dado que o banco recusou.
  const r = conferirEscrita(
    { data: null, error: { message: "duplicate key value violates unique constraint" } },
    "entrar no grupo"
  );

  assert.equal(r.ok, false);
  assert.equal(r.motivo, "erro");
});

test("data nulo SEM erro e `sem-select`, e nao se confunde com lista vazia", () => {
  // Este e o retorno de `.update(...).eq(...)` sem `.select()` encadeado -- o
  // codigo que a issue encontrou em oito rotas. A escrita pode ter funcionado
  // perfeitamente: o que nao existe e a CONTAGEM.
  const r = conferirEscrita({ data: null, error: null }, "restaurar o grupo");

  assert.equal(r.ok, false);
  assert.equal(r.motivo, "sem-select");
  // A mensagem tem de dizer o que fazer, porque o leitor dela e quem escreveu
  // a rota, nao quem usa o app.
  assert.match(r.mensagem, /\.select\(\)/);
});

test("os tres modos de falhar sao TRES, e nao um so", () => {
  // O controle da armadilha do cabecalho, escrito como assercao: se um dia os
  // motivos colapsarem, este teste e o que reprova -- os de cima continuariam
  // verdes se `nenhuma-linha` e `sem-select` passassem a devolver `erro` junto
  // com... nada, porque cada um deles so olha o proprio caso.
  const motivos = [
    conferirEscrita({ data: [], error: null }, "x"),
    conferirEscrita({ data: null, error: null }, "x"),
    conferirEscrita({ data: null, error: { message: "boom" } }, "x"),
  ].map((r) => (r.ok ? "ok" : r.motivo));

  assert.deepEqual(motivos, ["nenhuma-linha", "sem-select", "erro"]);
  assert.equal(new Set(motivos).size, 3);
});
