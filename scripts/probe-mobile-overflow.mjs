#!/usr/bin/env node
// =====================================================
// SONDA: scroll horizontal no painel, medido de verdade (HMO-168)
// =====================================================
//   PLAYWRIGHT_MODULE=/caminho/para/playwright \
//   APP_URL=https://pulodogato.hmoraes.com.br \
//   APP_EMAIL=... APP_PASSWORD=... \
//   node scripts/probe-mobile-overflow.mjs
//
// POR QUE ISTO NAO E UM TESTE DE CI
// ---------------------------------
// Ela precisa de duas coisas que o CI nao tem: um navegador e uma conta de
// verdade no ambiente que se quer medir. E deliberado que ela more fora da
// suite -- um passo de CI que baixa Chromium e guarda senha para rodar em todo
// PR custa caro e falha por motivo que nao e o codigo.
//
// A guarda que roda em todo PR e `npm run test:mobile-overflow`, e ela afirma
// sobre CLASSES. Esta sonda e a outra metade: afirma sobre PIXELS, uma vez, no
// ambiente de verdade. Foi ela que achou as oito rotas da HMO-168, e e ela que
// prova o conserto depois do deploy.
//
// O CRITERIO
// ----------
// `document.documentElement.scrollWidth > clientWidth`. Objetivo e sem opiniao:
// se o documento e mais largo do que a viewport, a pagina anda para o lado.
// Quando estoura, a sonda lista todo elemento cuja borda direita passa da
// viewport, com a largura dele -- o que transforma "a tela esta torta" em um
// alvo.
//
// A ARMADILHA QUE ELA JA ME PREGOU
// --------------------------------
// Contar elemento antes da hidratacao inventa bug: logo depois do
// `waitForURL(/\/dashboard/)` metade da arvore ainda nao existe. Daqui em
// diante, toda medicao espera por um seletor visivel primeiro.
// =====================================================

const APP = (process.env.APP_URL || "https://pulodogato.hmoraes.com.br").replace(
  /\/$/,
  "",
);
const EMAIL = process.env.APP_EMAIL;
const SENHA = process.env.APP_PASSWORD;

if (!EMAIL || !SENHA) {
  console.error(
    "Faltou APP_EMAIL / APP_PASSWORD -- o painel inteiro exige login, e sem " +
      "sessao esta sonda mediria a tela de login vinte e tres vezes.",
  );
  process.exit(2);
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

/** As rotas do painel. As oito da HMO-168 primeiro. */
const ROTAS = [
  "/dashboard/transactions",
  "/dashboard/personal-finance",
  "/dashboard/expense-groups",
  "/dashboard/reports",
  "/dashboard/investments",
  "/dashboard/trading",
  "/dashboard/budgets",
  "/dashboard/calculators",
  // As que passavam. Ficam na lista como controle: se o conserto tiver
  // quebrado uma delas, aparece aqui.
  "/dashboard",
  "/dashboard/contas",
  "/dashboard/cartoes",
  "/dashboard/bills",
  "/dashboard/goals",
  "/dashboard/recurrences",
  "/dashboard/connections",
  "/dashboard/settings",
  "/dashboard/plans",
  "/dashboard/profile",
  "/dashboard/import",
  "/dashboard/categories",
  "/dashboard/notifications",
  "/dashboard/net-worth",
  "/dashboard/cash-flow",
  "/dashboard/alerts",
  // As tres telas de lancamento. NUNCA FORAM MEDIDAS: as duas primeiras
  // nasceram na HMO-165, depois da HMO-168 ter feito a varredura, e ninguem as
  // acrescentou aqui -- a lista dizia "as vinte e tres rotas do painel" e havia
  // vinte e cinco. A terceira e a da HMO-164, e entra junto pelo mesmo motivo.
  //
  // Um vermelho nelas na proxima execucao nao e regressao: e a primeira
  // medicao. E a HMO-168 mostrou que vazamento pequeno so aparece depois que o
  // grande para de vazar na frente dele.
  "/dashboard/movimentacoes/receita",
  "/dashboard/movimentacoes/despesa",
  "/dashboard/movimentacoes/transferencia",
];

const LARGURAS = [390, 320];

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const navegador = await chromium.launch();

try {
  const contexto = await navegador.newContext({
    viewport: { width: LARGURAS[0], height: 780 },
    userAgent: IPHONE,
    isMobile: true,
    hasTouch: true,
  });
  const pagina = await contexto.newPage();

  // ---- login ----
  await pagina.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
  await pagina.fill('input[type="email"]', EMAIL);
  await pagina.fill('input[type="password"]', SENHA);
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL(/\/dashboard/, { timeout: 30000 });
  console.log(`logado em ${APP} como ${EMAIL}\n`);

  const achados = [];

  for (const largura of LARGURAS) {
    await pagina.setViewportSize({ width: largura, height: 780 });

    for (const rota of ROTAS) {
      await pagina.goto(`${APP}${rota}`, { waitUntil: "domcontentloaded" });

      // Hidratacao: sem esta espera a medicao e de uma arvore pela metade.
      try {
        await pagina.waitForSelector("h1, h2", {
          state: "visible",
          timeout: 15000,
        });
      } catch {
        console.log(`  ${rota} @${largura}: sem titulo visivel (pulada)`);
        continue;
      }
      await pagina.waitForTimeout(600);

      const medida = await pagina.evaluate(() => {
        const raiz = document.documentElement;
        const vazamento = raiz.scrollWidth - raiz.clientWidth;
        const culpados = [];

        if (vazamento > 0) {
          for (const el of document.querySelectorAll("body *")) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.right > raiz.clientWidth + 1) {
              culpados.push({
                tag: el.tagName.toLowerCase(),
                classe: (el.getAttribute("class") || "").slice(0, 90),
                largura: Math.round(r.width),
                borda: Math.round(r.right),
              });
            }
          }
        }

        return {
          scrollWidth: raiz.scrollWidth,
          clientWidth: raiz.clientWidth,
          vazamento,
          // Os mais largos primeiro: o container que vaza costuma ser o pai.
          culpados: culpados.sort((a, b) => b.largura - a.largura).slice(0, 4),
        };
      });

      const marca = medida.vazamento > 0 ? "VAZA" : "ok  ";
      console.log(
        `  ${marca} ${rota} @${largura}: scrollWidth=${medida.scrollWidth} ` +
          `clientWidth=${medida.clientWidth}`,
      );
      for (const c of medida.culpados) {
        console.log(
          `         ${c.tag}.${c.classe} (${c.largura}px, borda direita ${c.borda})`,
        );
      }

      if (medida.vazamento > 0) achados.push({ rota, largura, ...medida });
    }
    console.log("");
  }

  // ===================================================================
  // O RECORTE DO TOPO (HMO-185)
  // ===================================================================
  // Chromium nao tem notch, entao `env(safe-area-inset-top)` vale 0 aqui e
  // sempre valeu -- e por isso que o header ficou meses desenhando por cima do
  // relogio do iPhone sem que medicao nenhuma reclamasse.
  //
  // O conserto leu o recorte para dentro de variaveis CSS justamente para
  // abrir essa porta: variavel pode ser sobrescrita de fora, `env()` nao pode.
  // Abaixo a sonda injeta os 47px de um iPhone 14 e mede o que acontece. Nao
  // e um iPhone de verdade, e nao substitui um; e a prova de que o MECANISMO
  // responde -- que era a peca que faltava.
  await pagina.setViewportSize({ width: 390, height: 780 });
  await pagina.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" });
  await pagina.waitForSelector("main h1", { state: "visible", timeout: 20000 });
  await pagina.waitForTimeout(1000);

  const geometria = () =>
    pagina.evaluate(() => {
      const header = document.querySelector(".lg\\:hidden.fixed.top-0");
      const espacador = document.querySelector(".app-header-offset");
      const principal = document.querySelector("main");
      if (!header || !espacador || !principal) {
        return { faltando: true };
      }
      return {
        faltando: false,
        // O topo da BARRA visivel, nao o da caixa: a caixa fica em y=0 de
        // proposito (o fundo dela precisa pintar a area do notch); o que nao
        // pode ficar debaixo do relogio e o conteudo.
        barraTopo: Math.round(
          header.firstElementChild.getBoundingClientRect().top,
        ),
        headerAltura: Math.round(header.getBoundingClientRect().height),
        espacador: Math.round(espacador.getBoundingClientRect().height),
        mainTopo: Math.round(principal.getBoundingClientRect().top),
      };
    });

  const semRecorte = await geometria();
  await pagina.evaluate(() => {
    document.documentElement.style.setProperty("--safe-top", "47px");
    document.documentElement.style.setProperty("--safe-bottom", "34px");
  });
  await pagina.waitForTimeout(300);
  const comRecorte = await geometria();

  const problemasDeRecorte = [];
  if (semRecorte.faltando || comRecorte.faltando) {
    problemasDeRecorte.push(
      "nao achei header/.app-header-offset/main -- ou o deploy e anterior a " +
        "HMO-185, ou o layout foi reescrito e esta sonda precisa ser reescrita",
    );
  } else {
    console.log("");
    console.log("recorte do topo:");
    for (const [rotulo, g] of [
      ["sem recorte (Android, desktop)", semRecorte],
      ["com 47px injetados (iPhone 14)", comRecorte],
    ]) {
      console.log(
        `  ${rotulo}: barra em y=${g.barraTopo}, header ${g.headerAltura}px, ` +
          `espacador ${g.espacador}px, main em y=${g.mainTopo}`,
      );
    }

    if (semRecorte.barraTopo !== 0)
      problemasDeRecorte.push(
        `sem recorte a barra deveria comecar em y=0 e comeca em y=${semRecorte.barraTopo} ` +
          "-- o conserto do iPhone nao pode mexer no Android",
      );
    if (comRecorte.barraTopo !== 47)
      problemasDeRecorte.push(
        `com 47px de recorte a barra deveria descer para y=47 e esta em ` +
          `y=${comRecorte.barraTopo} -- e o defeito relatado na HMO-185, o ` +
          "header desenhando por cima do relogio",
      );
    for (const [rotulo, g] of [
      ["sem recorte", semRecorte],
      ["com recorte", comRecorte],
    ]) {
      if (g.espacador !== g.headerAltura)
        problemasDeRecorte.push(
          `${rotulo}: o espacador reserva ${g.espacador}px para um header de ` +
            `${g.headerAltura}px -- a diferenca e conteudo escondido embaixo dele`,
        );
      if (g.mainTopo !== g.headerAltura)
        problemasDeRecorte.push(
          `${rotulo}: o <main> comeca em y=${g.mainTopo} e o header acaba em ` +
            `y=${g.headerAltura}`,
        );
    }
  }

  // A meta viewport: ela ja foi reescrita em runtime so no iPhone, apagando o
  // que app/layout.tsx declara. Como a sonda roda com UA de iPhone, ela e o
  // unico lugar que enxerga essa reescrita acontecer.
  const meta = await pagina.evaluate(
    () => document.querySelector('meta[name="viewport"]')?.content ?? "",
  );
  if (/user-scalable=no|maximum-scale=1\b/.test(meta)) {
    problemasDeRecorte.push(
      `a meta viewport proibe zoom no iPhone ("${meta}") -- WCAG 1.4.4, e ` +
        "sinal de que a reescrita em runtime voltou",
    );
  }

  console.log("");
  console.log("=".repeat(60));
  if (achados.length === 0) {
    console.log(
      `Nenhuma das ${ROTAS.length} rotas vaza em ${LARGURAS.join("px nem ")}px.`,
    );
  } else {
    console.log(`${achados.length} medicoes com vazamento:`);
    for (const a of achados) {
      console.log(`  ${a.rota} @${a.largura}: +${a.vazamento}px`);
    }
  }

  if (problemasDeRecorte.length === 0) {
    console.log("O recorte do topo responde, e o espacador acompanha.");
  } else {
    console.log(`${problemasDeRecorte.length} problema(s) de area util:`);
    for (const p of problemasDeRecorte) console.log(`  ${p}`);
  }

  process.exitCode =
    achados.length === 0 && problemasDeRecorte.length === 0 ? 0 : 1;
} finally {
  await navegador.close();
}
