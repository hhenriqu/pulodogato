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
  setupHintFor,
  getSupabaseEnv,
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

// HMO-132, segunda metade: a MENSAGEM de variavel ausente num preview.
//
// Escolhida a configuracao "escopo Preview sem as variaveis", todo preview
// deployment passa a falhar o build -- de proposito. O que esses testes
// protegem e o texto que a pessoa le nesse build falho. A dica de producao
// ("defina em Environment Variables e redeploy") levaria ela a um dashboard
// que marca os tres escopos por padrao, reabrindo o banco real para os
// previews. O erro seria de LEITURA, e nenhum outro teste aqui o pegaria.

test("no preview, a dica nao manda cadastrar a variavel", () => {
  const preview = setupHintFor(true, "preview");

  // A metade que importa: nao pode empurrar o leitor para o dashboard.
  assert.ok(
    !preview.includes("escopo Production"),
    `a dica de preview nao pode mandar definir a variavel: ${preview}`
  );
  assert.ok(
    !preview.includes("redeploy"),
    `a dica de preview nao pode pedir redeploy: ${preview}`
  );

  // A outra metade: falhar calado sem explicar o motivo seria igualmente
  // ruim. Tem que dizer que e intencional e qual e o caminho seguro.
  assert.ok(preview.includes("de proposito"), preview);
  assert.ok(preview.includes("SEPARADO"), preview);
});

test("fora do preview as dicas continuam as de antes", () => {
  // Controle positivo. Sem ele, apagar o texto das tres dicas deixaria o
  // teste acima verde -- string vazia passa em toda assercao de negacao.
  const producao = setupHintFor(true, "production");
  assert.ok(
    producao.includes("escopo Production") && producao.includes("redeploy"),
    producao
  );

  const local = setupHintFor(false, undefined);
  assert.ok(local.includes(".env.local"), local);

  // E um build de producao na Vercel nao pode receber a dica de preview.
  assert.ok(!producao.includes("de proposito"), producao);
});

test("so VERCEL_ENV=preview troca a dica", () => {
  // Fora da Vercel, `VERCEL_ENV` nao existe -- mas se existisse, quem manda e
  // o flag de estar na Vercel. Sem isto, rodar `next build` na maquina com a
  // variavel exportada daria a dica errada para quem so esqueceu o .env.local.
  assert.ok(setupHintFor(false, "preview").includes(".env.local"));

  for (const env of [undefined, "development", "production", "Preview", ""]) {
    assert.ok(
      !setupHintFor(true, env).includes("de proposito"),
      `VERCEL_ENV=${JSON.stringify(env)} nao devia dar a dica de preview`
    );
  }
});

// HMO-132, a ligacao. Os testes acima chamam `setupHintFor` direto, entao todos
// eles continuariam verdes se `required()` deixasse de chamar `setupHint()`, ou
// se `setupHint()` passasse o argumento errado -- a dica certa existiria e
// ninguem a leria. Estes dois vao pelo caminho real, `getSupabaseEnv()`, e
// olham a mensagem que o build de fato imprime.

/** Roda `fn` com o ambiente trocado, e devolve tudo como estava depois. */
function comAmbiente(vars, fn) {
  const antes = { ...process.env };
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, antes);
  }
}

/** A mensagem que `getSupabaseEnv()` joga, ou null se ela nao jogar. */
function erroDe(vars) {
  return comAmbiente(vars, () => {
    try {
      getSupabaseEnv();
      return null;
    } catch (e) {
      return e.message;
    }
  });
}

test("o build de um preview sem variaveis imprime a dica de preview", () => {
  const msg = erroDe({
    VERCEL: "1",
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_URL: undefined,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
  });

  assert.ok(msg, "getSupabaseEnv() tinha que falhar sem as variaveis");
  assert.match(msg, /Variável de ambiente ausente/);
  assert.ok(msg.includes("de proposito"), msg);
  assert.ok(msg.includes("SEPARADO"), msg);
  assert.ok(!msg.includes("escopo Production"), msg);
  assert.ok(!msg.includes("redeploy"), msg);
});

test("o mesmo build em producao continua imprimindo a dica de producao", () => {
  // Controle positivo da ligacao: sem ele, `setupHint()` devolvendo sempre a
  // dica de preview passaria no teste acima.
  const msg = erroDe({
    VERCEL: "1",
    VERCEL_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: undefined,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
  });

  assert.ok(msg, "getSupabaseEnv() tinha que falhar sem as variaveis");
  assert.ok(msg.includes("escopo Production") && msg.includes("redeploy"), msg);
  assert.ok(!msg.includes("de proposito"), msg);
});
