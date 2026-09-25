// =====================================================
// TESTES DO CARIMBO "ESTA RESPOSTA VEIO DO APARELHO"
// =====================================================
//   npm run test:pwa-runtime-cache
//
// O que este arquivo protege, em uma frase: o cache padrao do next-pwa JA
// guarda as respostas de `/api/`, entao sem rede a tela nao recebe zero --
// ela recebe o JSON de ontem, com `ok` verdadeiro e todo campo no lugar.
//
// Sem o carimbo do service worker, isso e indistinguivel do dado de agora, e
// numero velho com cara de atual e pior que numero nenhum. O carimbo e a
// unica evidencia possivel: o service worker e o unico ponto do sistema onde
// a decisao "rede ou cache" e tomada.
//
// Node puro: `Headers` e `Response` sao globais desde o Node 18, entao da
// para executar o plugin de verdade aqui -- e nao so conferir que ele existe.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  MARCA_DO_APARELHO,
  MARCA_GUARDADO_EM,
  MAXIMO_DE_APIS,
  VALIDADE_DAS_APIS_EM_SEGUNDOS,
  pluginDeMarcacao,
  montarRuntimeCaching,
} = require("../lib/pwa-runtime-cache.js");

const padrao = require("next-pwa/cache");

const DATA = "Wed, 24 Sep 2026 21:40:00 GMT";

// ---------------------------------------------------------------------------
// O PLUGIN, EXECUTADO
// ---------------------------------------------------------------------------

test("a resposta servida do cache sai carimbada, com o Date do servidor", async () => {
  const guardada = new Response(JSON.stringify({ accounts: [1] }), {
    status: 200,
    headers: { date: DATA, "content-type": "application/json" },
  });

  const saida = await pluginDeMarcacao.cachedResponseWillBeUsed({
    cachedResponse: guardada,
  });

  assert.equal(saida.headers.get(MARCA_DO_APARELHO), "1");
  assert.equal(saida.headers.get(MARCA_GUARDADO_EM), DATA);
  // O corpo tem que atravessar inteiro: a tela mostra estes numeros.
  assert.deepEqual(await saida.json(), { accounts: [1] });
  // E o status tambem, senao a classificacao do outro lado muda de caso.
  assert.equal(saida.status, 200);
  assert.equal(saida.headers.get("content-type"), "application/json");
});

test("sem `Date` guardado, o carimbo de origem continua", async () => {
  // A idade some, a origem nao. `descreverMomento(null)` diz "de um
  // carregamento anterior" -- menos preciso e igualmente honesto. O erro
  // grave seria o contrario: perder a data e a tela concluir que o dado e de
  // agora.
  const saida = await pluginDeMarcacao.cachedResponseWillBeUsed({
    cachedResponse: new Response("{}", { status: 200 }),
  });

  assert.equal(saida.headers.get(MARCA_DO_APARELHO), "1");
  assert.equal(saida.headers.get(MARCA_GUARDADO_EM), null);
});

test("sem resposta guardada o plugin nao inventa uma", async () => {
  // `cachedResponseWillBeUsed` tambem roda com `null` -- quando nao havia
  // copia. Devolver qualquer coisa que nao seja `null` aqui faria o workbox
  // entregar uma resposta vazia como se fosse dado.
  assert.equal(
    await pluginDeMarcacao.cachedResponseWillBeUsed({ cachedResponse: null }),
    null
  );
});

// ---------------------------------------------------------------------------
// A ARMADILHA DO ESCOPO: O PLUGIN E COPIADO COMO TEXTO PARA DENTRO DO sw.js
// ---------------------------------------------------------------------------

test("o plugin nao cita nenhuma constante deste modulo", () => {
  // O workbox-build serializa o plugin com `stringifyWithoutComments`: ele
  // copia o CODIGO-FONTE da funcao para dentro do `sw.js`. A funcao chega la
  // sem o escopo deste arquivo, e qualquer nome de fora vira ReferenceError
  // LA DENTRO -- no meio da leitura do cache, offline, que e o lugar do app
  // onde ninguem consegue investigar.
  //
  // O sintoma seria: sem rede, a tela que deveria mostrar o dado guardado com
  // a data em cima mostra o painel de "sem conexao". Build verde, tudo 200.
  const fonte = pluginDeMarcacao.cachedResponseWillBeUsed.toString();

  assert.ok(fonte.includes(`"${MARCA_DO_APARELHO}"`));
  assert.ok(fonte.includes(`"${MARCA_GUARDADO_EM}"`));
  assert.ok(
    !/\bMARCA_[A-Z_]+/.test(fonte),
    "o plugin usa uma constante do modulo em vez do texto literal"
  );

  // As unicas coisas de fora que ele pode citar sao globais do service
  // worker. Se alguem trouxer um `require` ou um import para dentro, o sw.js
  // quebra na instalacao.
  assert.ok(!/require\(|import\s/.test(fonte));
});

// ---------------------------------------------------------------------------
// A ARMADILHA DA LISTA: `runtimeCaching` SUBSTITUI, NAO SOMA
// ---------------------------------------------------------------------------

test("as regras padrao do next-pwa continuam todas la", () => {
  // Passar um array para `runtimeCaching` descarta a lista padrao inteira --
  // o mesmo desenho de `additionalManifestEntries`, e o mesmo modo de falha:
  // o app continua funcionando online e perde o offline sem um erro sequer.
  //
  // Nominais de proposito. Uma contagem ("continuam 15") passaria verde com a
  // regra do `/_next/static` trocada pela de audio.
  const nossas = montarRuntimeCaching(padrao);

  assert.equal(nossas.length, padrao.length);

  const nomes = nossas.map((r) => r.options?.cacheName).filter(Boolean);
  for (const critico of [
    "apis",
    "static-js-assets",
    "next-data",
    "static-image-assets",
    "next-image",
    "google-fonts-webfonts",
    "others",
  ]) {
    assert.ok(nomes.includes(critico), `a regra ${critico} sumiu da lista`);
  }
});

test("so a regra de `apis` e trocada -- as outras saem identicas", () => {
  const nossas = montarRuntimeCaching(padrao);

  for (let i = 0; i < padrao.length; i++) {
    if (padrao[i].options?.cacheName === "apis") continue;
    assert.equal(
      nossas[i],
      padrao[i],
      `a regra ${padrao[i].options?.cacheName} foi remontada sem necessidade`
    );
  }
});

test("a regra de `apis` mantem NetworkFirst e ganha o plugin", () => {
  const api = montarRuntimeCaching(padrao).find(
    (r) => r.options?.cacheName === "apis"
  );

  // NetworkFirst e o que faz o carimbo ser raro: com rede, a copia guardada
  // nem e consultada. Trocar para CacheFirst aqui mostraria dado velho o
  // tempo todo -- carimbado, mas velho.
  assert.equal(api.handler, "NetworkFirst");
  assert.equal(api.method, "GET");
  assert.ok(api.options.plugins.includes(pluginDeMarcacao));
  assert.equal(api.options.expiration.maxEntries, MAXIMO_DE_APIS);
  assert.equal(api.options.expiration.maxAgeSeconds, VALIDADE_DAS_APIS_EM_SEGUNDOS);

  // O limite antigo era 16, e uma unica tela (contas previstas) busca seis
  // enderecos: navegar por tres telas ja despejava a primeira. Offline, a
  // mesma tela abria com dado hoje e sem dado amanha, sem regra nenhuma que
  // a pessoa pudesse aprender.
  assert.ok(MAXIMO_DE_APIS > 16);
});

test("a regra de `apis` do next-pwa sumindo tem que falhar ALTO", () => {
  // Se uma versao futura renomear ou dividir essa regra, "trocar no lugar"
  // nao troca nada: o app seguiria sem carimbo, as telas mostrariam o dado do
  // aparelho como se fosse de agora, e o build ficaria verde.
  const semApis = padrao.filter((r) => r.options?.cacheName !== "apis");
  assert.throws(() => montarRuntimeCaching(semApis), /apis/);

  // Duas tambem e sinal de que a regra mudou de forma.
  const duplicada = [...padrao, padrao.find((r) => r.options?.cacheName === "apis")];
  assert.throws(() => montarRuntimeCaching(duplicada), /apis/);
});

test("o next.config.js liga as duas pontas", () => {
  // O modulo pode estar perfeito e nao ser usado. Ja aconteceu neste projeto:
  // a pagina /offline existia, estava pronta, e nada no service worker
  // navegava ate ela.
  const fs = require("node:fs");
  const path = require("node:path");
  const cfg = fs.readFileSync(
    path.join(import.meta.dirname, "..", "next.config.js"),
    "utf8"
  );

  assert.match(cfg, /runtimeCaching:\s*montarRuntimeCaching\(/);
  assert.match(cfg, /require\("next-pwa\/cache"\)/);
});
