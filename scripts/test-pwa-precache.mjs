// =====================================================
// TESTES DO PRECACHE DO SERVICE WORKER
// =====================================================
//   npm run test:pwa-precache
//
// Este arquivo existe por causa de uma linha do next-pwa 5.6 (`index.js`:142):
//
//     let manifestEntries = additionalManifestEntries
//     if (!Array.isArray(manifestEntries)) { ...varre public/... }
//
// Passar um array **desliga** a varredura da pasta `public/`. Quem mexer em
// `lib/pwa-precache.js` e devolver so as rotas tira do precache o
// `manifest.json`, o `favicon.ico` e os 20 icones -- e o sintoma disso e o
// Chrome parar de oferecer a instalacao do app, sem erro em lugar nenhum: o
// build passa, o `tsc` passa, o servidor responde 200 em todos eles.
//
// Este projeto ja perdeu meses com exatamente esse tipo de falha (os icones
// eram SVG com nome .png; a Vercel servia 200 com Content-Type image/png e
// todo mundo concordava). O teste abaixo e a forma de nao repetir.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  montarPrecache,
  revisaoDoDeploy,
  ROTAS_QUE_ABREM_SEM_REDE,
} = require("../lib/pwa-precache.js");

const RAIZ = path.join(import.meta.dirname, "..");
const PUBLIC = path.join(RAIZ, "public");

/** Uma pasta `public/` de mentira, para os casos que precisam de forma exata. */
function pastaFalsa(arquivos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "precache-"));
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    const destino = path.join(dir, rel);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, conteudo);
  }
  return dir;
}

const urls = (entradas) => entradas.map((e) => e.url);

// ---------------------------------------------------------------------------
// O QUE NAO PODE SUMIR
// ---------------------------------------------------------------------------

test("os arquivos que fazem o app ser instalavel continuam no precache", () => {
  // Nominais de proposito. Uma contagem ("pelo menos 20 entradas") passaria
  // verde com o manifest fora, que e justamente o arquivo que o Chrome le
  // para decidir se oferece a instalacao.
  const lista = urls(
    montarPrecache({ publicDir: PUBLIC, revisaoDasRotas: "rev" })
  );

  for (const critico of [
    "/manifest.json",
    "/favicon.ico",
    "/icons/icon-192x192.png",
    "/icons/icon-512x512.png",
    "/icons/icon-maskable-512x512.png",
    "/icons/apple-touch-icon-180x180.png",
  ]) {
    assert.ok(
      lista.includes(critico),
      `${critico} saiu do precache -- o app volta a nao ser instalavel, e nada acusa`
    );
  }
});

test("as rotas que abrem sem rede estao na lista", () => {
  const lista = urls(
    montarPrecache({ publicDir: PUBLIC, revisaoDasRotas: "rev" })
  );
  assert.ok(lista.includes("/dashboard"));
  assert.ok(lista.includes("/dashboard/personal-finance"));
  // As tres de leitura entraram quando aprenderam a dizer "sem rede" em vez
  // de imprimir R$ 0,00 -- ver `lib/offline-leitura.ts`.
  assert.ok(lista.includes("/dashboard/bills"));
  assert.ok(lista.includes("/dashboard/accounts"));
  assert.ok(lista.includes("/dashboard/recurrences"));
});

test("toda rota precacheada tem `page.tsx`, e ele nao le o pedido", () => {
  // Duas regressoes que o teste de cima nao alcanca, porque nenhuma das duas
  // aparece no NOME da rota:
  //
  //   1. rota que nao existe -- o workbox nao acha o HTML na instalacao e
  //      FALHA A INSTALACAO INTEIRA do service worker. O app perde o offline
  //      inteiro por causa de um item da lista, e o erro so aparece no
  //      console do aparelho de quem instalou;
  //   2. a pagina passa a pedir `cookies()` ou a declarar `force-dynamic`.
  //      O nome continua o mesmo e a rota vira `ƒ`: o HTML passa a sair com
  //      o dado de quem pediu, e o precache guarda a pagina de UMA pessoa no
  //      aparelho.
  for (const rota of ROTAS_QUE_ABREM_SEM_REDE) {
    const arquivo = path.join(RAIZ, "app/(dashboard)", rota, "page.tsx");
    assert.ok(
      fs.existsSync(arquivo),
      `${rota} esta no precache e nao tem ${path.relative(RAIZ, arquivo)} -- ` +
        `a instalacao do service worker falha inteira`
    );

    const fonte = fs.readFileSync(arquivo, "utf8");
    assert.ok(
      !/\bcookies\s*\(/.test(fonte) && !/force-dynamic/.test(fonte),
      `${rota} e renderizada por pedido: precachear guardaria a pagina de uma pessoa`
    );
  }
});

test("a pasta public e as rotas convivem -- este e o ponto do arquivo", () => {
  // O defeito que o teste existe para pegar e binario: ou alguem devolve so as
  // rotas (e os icones somem) ou so o public (e o limite das 24h volta).
  const dir = pastaFalsa({ "manifest.json": "{}" });
  try {
    const lista = urls(
      montarPrecache({
        publicDir: dir,
        revisaoDasRotas: "rev",
        rotas: ["/dashboard"],
      })
    );
    assert.deepEqual(lista.sort(), ["/dashboard", "/manifest.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// REVISAO
// ---------------------------------------------------------------------------

test("arquivo com conteudo diferente tem revisao diferente", () => {
  const a = pastaFalsa({ "x.txt": "um" });
  const b = pastaFalsa({ "x.txt": "outro" });
  try {
    const rev = (d) =>
      montarPrecache({ publicDir: d, revisaoDasRotas: "r", rotas: [] })[0]
        .revision;
    assert.notEqual(rev(a), rev(b));
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});

test("toda entrada tem revisao preenchida", () => {
  // Entrada sem revisao o workbox trata como URL versionada -- ela entra no
  // precache UMA vez e nunca mais e rebuscada. Para o HTML de uma rota isso
  // significa a tela do deploy antigo presa no aparelho para sempre.
  const entradas = montarPrecache({
    publicDir: PUBLIC,
    revisaoDasRotas: "rev",
  });
  for (const e of entradas) {
    assert.ok(
      typeof e.revision === "string" && e.revision.length > 0,
      `${e.url} sem revisao`
    );
  }
});

test("a revisao do deploy existe e e estavel dentro do mesmo build", () => {
  const r = revisaoDoDeploy();
  assert.ok(typeof r === "string" && r.length > 0);
  assert.equal(r, revisaoDoDeploy());
});

// ---------------------------------------------------------------------------
// DESCARTES
// ---------------------------------------------------------------------------

test("o service worker nao entra no precache dele mesmo", () => {
  // `sw.js`, `workbox-*.js`, `worker-*.js` e `fallback-*.js` sao saida do
  // build e moram em public/. Guardar a versao de ontem junto com o service
  // worker de hoje e o comeco de um SW que nunca se atualiza.
  const dir = pastaFalsa({
    "sw.js": "x",
    "sw.js.map": "x",
    "workbox-abc123.js": "x",
    "worker-abc123.js": "x",
    "fallback-abc123.js": "x",
    "manifest.json": "{}",
  });
  try {
    const lista = urls(
      montarPrecache({ publicDir: dir, revisaoDasRotas: "rev", rotas: [] })
    );
    assert.deepEqual(lista, ["/manifest.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("subpasta entra com o caminho inteiro, nao so o nome do arquivo", () => {
  // `/icon-192x192.png` no lugar de `/icons/icon-192x192.png` seria uma
  // entrada que o workbox busca, nao acha, e a instalacao do SW falha inteira.
  const dir = pastaFalsa({ "icons/icon-192x192.png": "x" });
  try {
    const lista = urls(
      montarPrecache({ publicDir: dir, revisaoDasRotas: "rev", rotas: [] })
    );
    assert.deepEqual(lista, ["/icons/icon-192x192.png"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// A LISTA DE ROTAS
// ---------------------------------------------------------------------------

test("so entra rota de prerender estatico (○), nunca dinamica (ƒ)", () => {
  // O HTML de uma rota `ƒ` e renderizado com o cookie de quem pediu. Precachear
  // uma delas guardaria a pagina de UMA pessoa no aparelho -- e o service
  // worker a serviria para a proxima sessao. As cinco de hoje sao `○` no
  // `next build`: HTML igual para todo mundo, sem um byte de dado de usuario.
  // Os numeros das telas chegam depois, por chamada do cliente, com o token
  // de verdade batendo na RLS.
  //
  // As tres dinamicas do projeto hoje: /dashboard/expense-groups/[groupId],
  // /dashboard/migrations e toda /api/*.
  for (const rota of ROTAS_QUE_ABREM_SEM_REDE) {
    assert.ok(rota.startsWith("/dashboard"), `${rota} fora do dashboard`);
    assert.ok(!rota.includes("["), `${rota} e rota dinamica`);
    assert.ok(!rota.startsWith("/api/"), `${rota} e rota de API`);
  }
  assert.ok(!ROTAS_QUE_ABREM_SEM_REDE.includes("/dashboard/migrations"));
});

test("a tela que funciona offline nao pode sair da lista", () => {
  // /dashboard/personal-finance e a unica que tem catalogo e fila no aparelho.
  // Tirar ela daqui devolve o limite das 24h exatamente onde ele doi.
  assert.ok(
    ROTAS_QUE_ABREM_SEM_REDE.includes("/dashboard/personal-finance"),
    "sem esta rota o modo offline volta a depender de ter aberto a tela ontem"
  );
});
