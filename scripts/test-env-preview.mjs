// HMO-132: um preview deployment da Vercel nao pode falar com o banco de
// producao.
//
// O que este teste protege e uma regra que NAO tem sintoma quando quebra. Se o
// guard parar de disparar, o preview sobe verde, a tela funciona, e a unica
// pista e um lancamento de teste aparecendo na conta real do Helio dias depois.
//
//   npm run test:env-preview

import test from "node:test";
import assert from "node:assert/strict";

import {
  projectRefFromSupabaseUrl,
  previewPointsAtProduction,
} from "../.tmp-env-preview/env.js";

// O ref de producao, conferido contra o host de SUPABASE_DB_URL_RO.
const PROD = "https://odxqjvtxsioksguuevqm.supabase.co";
const OUTRO = "https://abcdefghijklmnopqrst.supabase.co";

test("le o ref do projeto a partir da URL", () => {
  assert.equal(projectRefFromSupabaseUrl(PROD), "odxqjvtxsioksguuevqm");
  assert.equal(projectRefFromSupabaseUrl(OUTRO), "abcdefghijklmnopqrst");

  // Maiuscula no host e barra no fim sao a mesma URL, e precisam dar o mesmo
  // ref -- senao o guard libera o banco de producao achando que e outro.
  //
  // Quem normaliza o caso aqui e o proprio `new URL()`, que ja devolve o host
  // em minusculas para http/https; o `.toLowerCase()` no codigo e redundante
  // para este caso (tirar ele mantem este teste verde -- conferido). A
  // assercao fica por ser a propriedade que importa, nao por cobrir a chamada.
  assert.equal(
    projectRefFromSupabaseUrl("HTTPS://ODXQJVTXSIOKSGUUEVQM.SUPABASE.CO/"),
    "odxqjvtxsioksguuevqm"
  );
});

test("o que nao e host de projeto Supabase devolve null", () => {
  assert.equal(projectRefFromSupabaseUrl("http://127.0.0.1:54321"), null);
  assert.equal(projectRefFromSupabaseUrl("https://pulodogato.hmoraes.com.br"), null);
  assert.equal(projectRefFromSupabaseUrl("nao e uma url"), null);
  assert.equal(projectRefFromSupabaseUrl(""), null);
});

test("preview apontando para producao e barrado", () => {
  assert.equal(previewPointsAtProduction("preview", PROD, undefined), true);
});

test("producao apontando para producao passa", () => {
  // Controle que separa "o guard funciona" de "o guard barra tudo": se esta
  // assercao virar true, o deploy de producao para de subir.
  assert.equal(previewPointsAtProduction("production", PROD, undefined), false);
});

test("preview com projeto separado passa", () => {
  assert.equal(previewPointsAtProduction("preview", OUTRO, undefined), false);
});

test("fora da Vercel o guard nao opina", () => {
  // `next build` na maquina do dev, e o `npm run build` do CI.
  assert.equal(previewPointsAtProduction(undefined, PROD, undefined), false);
  assert.equal(previewPointsAtProduction("development", PROD, undefined), false);
});

test("a escotilha de saida abre so com o valor exato", () => {
  assert.equal(previewPointsAtProduction("preview", PROD, "1"), false);

  // Um `PREVIEW_ALLOW_PRODUCTION_DB=false` ou `=0` digitado na Vercel tem que
  // continuar BARRANDO. "definida" nao pode valer como "ligada": e assim que
  // uma variavel esquecida no dashboard abre o banco real sem ninguem pedir.
  for (const valor of ["false", "0", "", "sim", "true"]) {
    assert.equal(
      previewPointsAtProduction("preview", PROD, valor),
      true,
      `PREVIEW_ALLOW_PRODUCTION_DB=${JSON.stringify(valor)} nao devia liberar`
    );
  }
});
