#!/usr/bin/env node
// =====================================================
// HMO-243 - O ITEM "PERSONALIZADO" ABRE OS CAMPOS? (medicao em producao)
// =====================================================
//   PLAYWRIGHT_MODULE=<...>/playwright/index.mjs \
//   node scripts/probe-seletor-personalizado.mjs
//
// Repete, no app rodando em producao, a tabela que achou o defeito:
//
//   painel aberto (rotulo "Este mes") ............. 0 campos
//   depois de escolher "Personalizado" ............ 0 campos  <- o defeito
//   controle: "Mes anterior" x1 ................... 0 campos
//   controle: "Mes anterior" x2 ................... 2 campos  <- existem!
//
// POR QUE O CONTROLE POSITIVO E OBRIGATORIO
// -----------------------------------------
// A medida que importa e um ZERO virando DOIS. Um seletor de CSS errado, um
// `placeholder` que mudou de texto ou uma tela que nao hidratou dao zero
// tambem -- e dariam zero nas quatro linhas, com cara de defeito. O controle
// positivo ("Mes anterior" x2) e o que separa "inalcancavel pelo menu" de
// "sonda cega": se ele nao achar os campos, a sonda esta errada e NENHUMA das
// outras linhas vale.
//
// E a sonda mede o gesto que ABRE o controle, nao so a digitacao dentro dele.
// Alcancar o campo por outra porta (a seta, a URL, um `evaluate`) aprovaria
// uma tela que o usuario nao consegue usar -- que era exatamente o estado da
// 243.
// =====================================================

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);

const BASE = "https://pulodogato.hmoraes.com.br";
const EMAIL = process.env.PROBE_EMAIL;
const SENHA = process.env.PROBE_SENHA;
const SHA = process.env.PROBE_SHA ?? "";

/** O input mascarado da HMO-238/240. O `type="date"` escondido nao casa. */
const CAMPO = 'input[placeholder="dd/mm/aaaa"]';

const linhas = [];
let falhou = false;

function medir(rotulo, campos, rotuloDoPeriodo, extra = "") {
  linhas.push({ rotulo, campos, periodo: rotuloDoPeriodo, extra });
  console.log(
    `  ${String(campos).padStart(2)} campos | ${String(rotuloDoPeriodo).padEnd(22)} | ${rotulo}${extra ? " -- " + extra : ""}`
  );
}

const navegador = await chromium.launch();
const ctx = await navegador.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const pagina = await ctx.newPage();

try {
  // -------------------------------------------------------------------------
  // 0. O deploy que esta sendo medido
  // -------------------------------------------------------------------------
  // POR QUE NAO SE EXIGE `x-vercel-cache: MISS` AQUI
  // ------------------------------------------------
  // O aceite da issue pedia MISS. Nao da: `/dashboard` e PRERENDER (casca
  // estatica) e `/_next/static/**` e immutable, entao os dois respondem HIT
  // mesmo com `?cb=` -- o buster nao fura cache de asset imutavel. Medido em
  // 2026-10-02: HIT nos dois, com `age` de ~60s.
  //
  // O que o MISS queria garantir -- "nao estou medindo artefato velho" -- fica
  // provado mais forte, e sem depender de header nenhum:
  //
  //   1. o `sw.js` fresco carimba o commit publicado (e o anterior sumiu);
  //   2. o chunk que carrega a logica sai DESSE manifest, tem nome por hash de
  //      CONTEUDO, e contem os marcadores que nascem com esta issue;
  //   3. um marcador inventado da 0 (controle negativo) e um marcador que ja
  //      existia naquele chunk da 1 (controle positivo: e o chunk certo).
  //
  // Artefato velho seria um ARQUIVO DIFERENTE: o hash de conteudo nao casaria
  // com o do manifest novo. HIT num asset imutavel listado no manifest fresco
  // nao e cache velho -- e o cache do artefato certo.
  const sw = await pagina.request.get(`${BASE}/sw.js?cb=${Date.now()}`);
  const manifest = await sw.text();
  const temSha = SHA ? manifest.includes(SHA.slice(0, 7)) : false;
  console.log(`sw.js carimba ${SHA.slice(0, 7)}: ${temSha ? "SIM" : "NAO"}`);
  if (SHA && !temSha) {
    console.error("XX o commit publicado NAO e o que esta sendo medido.");
    process.exit(1);
  }

  // O chunk do seletor nao e o da rota: `SeletorDePeriodo` entra em 4 telas e o
  // webpack o manda para um chunk COMUM -- grepar o chunk de `/dashboard` da 0
  // em tudo, inclusive nos controles.
  const desescapar = (s) =>
    s
      .replace(/\\x(..)/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u(....)/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

  const caminhos = [...manifest.matchAll(/_next\/static\/chunks\/[^"\\]*\.js/g)]
    .map((m) => m[0])
    .filter((v, i, a) => a.indexOf(v) === i);

  const MARCADORES = [
    // Os quatro gestos de `GestoDoSeletor`: literais ASCII puros que nascem
    // com esta issue e sobrevivem a minificacao (sao VALORES de string).
    { nome: 'tipo:"passo"', re: /tipo:\s*"passo"/, esperado: 1 },
    { nome: 'tipo:"hoje"', re: /tipo:\s*"hoje"/, esperado: 1 },
    { nome: 'tipo:"par"', re: /tipo:\s*"par"/, esperado: 1 },
    { nome: 'tipo:"item"', re: /tipo:\s*"item"/, esperado: 1 },
    // Controle positivo: ja existia no chunk do seletor antes desta issue.
    // Prova que o chunk achado e o certo, e nao um qualquer.
    { nome: "Data inicial (controle +)", re: /Data inicial/, esperado: 1 },
    // Controle negativo: mesma forma, string que nunca existiu.
    { nome: 'tipo:"ontem" (controle -)', re: /tipo:\s*"ontem"/, esperado: 0 },
  ];

  const onde = new Map(MARCADORES.map((m) => [m.nome, []]));
  for (const caminho of caminhos) {
    const r = await pagina.request.get(`${BASE}/${caminho}`);
    const txt = desescapar(await r.text());
    for (const m of MARCADORES) if (m.re.test(txt)) onde.get(m.nome).push(caminho);
  }

  console.log(`\n=== OS MARCADORES NOS ${caminhos.length} CHUNKS DO MANIFEST ===`);
  for (const m of MARCADORES) {
    const lista = onde.get(m.nome);
    const ok = lista.length === m.esperado;
    console.log(
      `  ${ok ? "OK" : "XX"} ${String(lista.length)} chunk(s)  ${m.nome}` +
        (lista.length ? `  -> ${lista[0].split("/").pop()}` : "")
    );
    if (!ok) falhou = true;
  }

  // -------------------------------------------------------------------------
  // 1. Login
  // -------------------------------------------------------------------------
  await pagina.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await pagina.fill('input[type="email"]', EMAIL);
  await pagina.fill('input[type="password"]', SENHA);
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL(/\/dashboard/, { timeout: 60000 });

  const resposta = await pagina.goto(`${BASE}/dashboard?cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
  });
  // Relatado, nao exigido -- ver o bloco 0. `/dashboard` e PRERENDER e o
  // comportamento medido abaixo nao vem do HTML: vem do chunk, ja provado.
  console.log(
    `x-vercel-cache do documento: ${resposta.headers()["x-vercel-cache"] ?? "(ausente)"}`
  );

  // A hidratacao: sem esperar, `count()` responde 0 para tudo e a sonda
  // inventa um defeito. O seletor de periodo e o primeiro controle do painel.
  const menu = pagina.locator('[aria-label="Período"]');
  await menu.waitFor({ state: "visible", timeout: 60000 });

  const rotulo = pagina.locator('[aria-live="polite"]').first();
  const campos = () => pagina.locator(CAMPO).count();
  const textoDoRotulo = async () => (await rotulo.innerText()).trim();

  console.log("\n=== A TABELA ===");

  // -------------------------------------------------------------------------
  // 2. Painel aberto
  // -------------------------------------------------------------------------
  const rotuloInicial = await textoDoRotulo();
  medir("painel aberto", await campos(), rotuloInicial);

  // -------------------------------------------------------------------------
  // 3. O gesto desta issue: escolher "Personalizado" no menu
  // -------------------------------------------------------------------------
  await menu.click();
  await pagina.getByRole("option", { name: "Personalizado" }).click();
  // O Radix fecha o menu com animacao; esperar o campo e mais honesto que um
  // timeout fixo, e o `catch` abaixo deixa a contagem acontecer de qualquer
  // jeito para a tabela registrar o ZERO quando o defeito esta de pe.
  await pagina
    .locator(CAMPO)
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .catch(() => {});

  const camposDepois = await campos();
  const rotuloDepois = await textoDoRotulo();
  medir('escolheu "Personalizado"', camposDepois, rotuloDepois);

  if (camposDepois !== 2) {
    console.error(`XX esperado 2 campos, veio ${camposDepois}`);
    falhou = true;
  }
  if (rotuloDepois !== rotuloInicial) {
    console.error(
      `XX o rotulo mudou de "${rotuloInicial}" para "${rotuloDepois}" -- abrir ` +
        "os campos nao pode mexer nos numeros da tela."
    );
    falhou = true;
  }
  if (new URL(pagina.url()).searchParams.has("de")) {
    console.error("XX a URL ganhou `?de=` so por abrir os campos: refiltrou.");
    falhou = true;
  }

  // -------------------------------------------------------------------------
  // 4. Digitar o par ainda sobe o filtro
  // -------------------------------------------------------------------------
  if (camposDepois === 2) {
    const de = pagina.locator(CAMPO).nth(0);
    await de.click();
    await de.press("ControlOrMeta+a");
    await de.pressSequentially("10032026", { delay: 60 });
    await pagina.waitForTimeout(1500);

    const url = new URL(pagina.url());
    const rotuloFiltrado = await textoDoRotulo();
    medir(
      "digitou 10/03/2026 no `de`",
      await campos(),
      rotuloFiltrado,
      `?de=${url.searchParams.get("de")}&ate=${url.searchParams.get("ate")}`
    );

    if (url.searchParams.get("de") !== "2026-03-10") {
      console.error(
        `XX o filtro nao subiu: ?de=${url.searchParams.get("de")} ` +
          "(esperado 2026-03-10)"
      );
      falhou = true;
    }
    if (rotuloFiltrado === rotuloInicial) {
      console.error("XX o rotulo NAO mudou depois de filtrar de verdade.");
      falhou = true;
    }
  }

  // -------------------------------------------------------------------------
  // 5. O CONTROLE POSITIVO: a porta errada, que sempre funcionou
  // -------------------------------------------------------------------------
  await pagina.goto(`${BASE}/dashboard?cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
  });
  await menu.waitFor({ state: "visible", timeout: 60000 });
  const seta = pagina.locator('[aria-label="Mês anterior"]');

  await seta.click();
  await pagina.waitForTimeout(1200);
  medir('CONTROLE "Mes anterior" x1', await campos(), await textoDoRotulo());

  await seta.click();
  await pagina.waitForTimeout(1200);
  const camposX2 = await campos();
  medir('CONTROLE "Mes anterior" x2', camposX2, await textoDoRotulo());

  if (camposX2 < 1) {
    console.error(
      "XX o controle positivo nao achou campo nenhum. A SONDA esta cega --\n" +
        "   nenhuma linha acima vale, inclusive os zeros."
    );
    falhou = true;
  }

  await pagina.screenshot({
    path: process.env.PROBE_PRINT ?? "/tmp/hmo-243.png",
  });
} finally {
  await navegador.close();
}

console.log(falhou ? "\nXX REPROVADO" : "\nOK: o item abre os campos");
process.exit(falhou ? 1 : 0);
