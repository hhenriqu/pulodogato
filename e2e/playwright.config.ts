// =====================================================
// PULODOGATO - E2E com Playwright (regressao a cada deploy)
// =====================================================
//   npm run e2e                          # tudo, contra producao
//   E2E_BASE_URL=http://localhost:3000 npm run e2e
//   npm run e2e -- --project=publico     # so o que nao precisa de login
//
// Como e por que, em e2e/README.md.
// =====================================================

import { defineConfig, devices } from "@playwright/test";

import { BASE_URL, SESSAO, cabecalhosExtras } from "./ambiente";

const CI = !!process.env.CI;

export default defineConfig({
  testDir: ".",
  outputDir: "./resultados",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Producao e de verdade: poucos navegadores ao mesmo tempo.
  workers: CI ? 2 : 3,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  reporter: [
    ["list"],
    ["html", { outputFolder: "./relatorio", open: "never" }],
    ["json", { outputFile: "./relatorio/resultado.json" }],
  ],
  use: {
    baseURL: BASE_URL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    extraHTTPHeaders: cabecalhosExtras(),
    // Trace, video e o print automatico ficam DESLIGADOS: o repositorio e
    // publico, o relatorio vira artefato, e os tres guardariam valores e
    // respostas da API em claro. A evidencia e o print MASCARADO de
    // e2e/guarda.ts, inclusive o da falha.
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    { name: "entrar", testMatch: /entrar\.setup\.ts/ },
    {
      name: "publico",
      testMatch: /publico\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } },
    },
    {
      name: "desktop",
      testMatch: /(telas|fluxos)\.spec\.ts/,
      dependencies: ["entrar"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
        storageState: SESSAO,
      },
    },
    {
      name: "celular",
      testMatch: /(telas|fluxos)\.spec\.ts/,
      dependencies: ["entrar"],
      use: { ...devices["Pixel 7"], storageState: SESSAO },
    },
  ],
});
