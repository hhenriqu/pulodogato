#!/usr/bin/env node
// =====================================================
// PULODOGATO - a busca de pessoas da aba Conexoes (HMO-142)
// =====================================================
// O defeito original nao era de aparencia nem de permissao: era a busca inteira
// falhando para uma classe grande de nomes. A tela colava o texto digitado na
// arvore logica do PostgREST, e a virgula e separador nessa arvore. Medido em
// producao:
//
//   or=(full_name.ilike.%Silva, Joao%,nickname.ilike.%Silva, Joao%)
//     -> 400 PGRST100 "failed to parse logic tree"
//     -> a tela cai no catch e mostra "Erro ao buscar usuários"
//
// Quem se chama "Silva, Joao" simplesmente nao conseguia ser encontrado, e
// quem buscava levava a culpa de um erro que parecia de rede.
//
// O que este arquivo NAO pode virar: um teste que so confira "tem aspas". A
// afirmacao que importa e que a arvore continua com DOIS ramos e o termo inteiro
// vai dentro do operando -- e que o termo vazio nao vire `ilike.%%`, que casaria
// com todo perfil publico da base e transformaria o campo de busca numa
// listagem de usuarios.
//
// A forma citada foi conferida contra o PostgREST de PRODUCAO antes de entrar:
// com virgula deu 200 (antes 400) e o controle positivo continuou achando o
// perfil existente.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { montarFiltroDeBusca } from "../.tmp-busca-de-perfil/busca-de-perfil.js";

test("termo simples vira dois ramos, nome e apelido", () => {
  const f = montarFiltroDeBusca("ana");
  assert.equal(f, 'full_name.ilike."%ana%",nickname.ilike."%ana%"');
});

test("virgula no nome NAO quebra a arvore: fica dentro do operando citado", () => {
  const f = montarFiltroDeBusca("Silva, Joao");

  // A virgula do usuario tem que estar entre aspas, nunca solta separando ramos.
  assert.ok(f.includes('"%Silva, Joao%"'), f);

  // E a arvore tem exatamente 2 ramos. Contar virgulas soltas e o que distingue
  // "escapou direito" de "gerou 3 ramos e um lixo": tiramos os trechos citados
  // e so entao contamos.
  const semCitados = f.replace(/"(?:[^"\\]|\\.)*"/g, "");
  assert.equal(semCitados.split(",").length, 2, `ramos errados em: ${f}`);
});

test("parenteses e ponto tambem ficam contidos", () => {
  const f = montarFiltroDeBusca("Jo(ao). Silva");
  const semCitados = f.replace(/"(?:[^"\\]|\\.)*"/g, "");
  assert.equal(semCitados.split(",").length, 2);
  assert.ok(!semCitados.includes("("), semCitados);
});

test("aspas e barra do usuario sao escapadas dentro do operando", () => {
  const f = montarFiltroDeBusca('a"b\\c');
  assert.ok(f.includes('\\"'), f);
  assert.ok(f.includes("\\\\"), f);
  // Continua com 2 ramos mesmo com aspas no meio -- se o escape falhasse, a
  // aspas fecharia o operando cedo e a contagem mudaria.
  const semCitados = f.replace(/"(?:[^"\\]|\\.)*"/g, "");
  assert.equal(semCitados.split(",").length, 2, f);
});

test("termo vazio ou so espaco nao busca (senao lista a base inteira)", () => {
  assert.equal(montarFiltroDeBusca(""), null);
  assert.equal(montarFiltroDeBusca("   "), null);
  assert.equal(montarFiltroDeBusca(undefined), null);
});

test("o curinga % do usuario continua valendo", () => {
  const f = montarFiltroDeBusca("jo%o");
  assert.ok(f.includes("%jo%o%"), f);
});
