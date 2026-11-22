// =====================================================
// PULODOGATO - E2E: a fixture que vigia cada pagina
// =====================================================
// Todo teste logado usa `test` daqui em vez do de @playwright/test. Ele ganha:
//
//   1. SOMENTE LEITURA. A suite roda contra PRODUCAO, com dados de verdade.
//      Toda escrita que a pagina tentar (POST/PUT/PATCH/DELETE em /api, e
//      escrita direta no PostgREST do Supabase) e ABORTADA antes de sair do
//      navegador, e fica registrada no relatorio. O login (`/auth/v1/`) e as
//      leituras por RPC (`/rest/v1/rpc/`, que sao POST mas so leem) passam.
//
//   2. OS SINAIS DE QUEBRA, coletados enquanto a pagina vive:
//        - excecao nao tratada no navegador (`pageerror`);
//        - resposta 5xx de qualquer `/api/` ou do Supabase.
//      `semQuebras()` reprova o teste com a lista, e nao so com "falhou".
//
//   3. A EVIDENCIA: `evidencia(nome)` tira o print da pagina inteira, com os
//      valores MASCARADOS (ver `mascarar`), anexa ao relatorio e grava em
//      e2e/evidencias/<projeto>/<nome>.png -- a pasta que o CI sobe como
//      artefato, um por deploy.
// =====================================================

import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { EVIDENCIAS, MASCARAR } from "./ambiente";

export interface Quebras {
  excecoes: string[];
  respostas5xx: string[];
  escritasBloqueadas: string[];
}

const ESCRITA = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** A requisicao e uma escrita que a suite nao deixa sair? */
export function ehEscritaBloqueada(metodo: string, url: string): boolean {
  if (!ESCRITA.has(metodo)) return false;
  const { pathname } = new URL(url);
  if (pathname.startsWith("/auth/v1/")) return false; // login e refresh do token
  if (pathname.startsWith("/rest/v1/rpc/")) return false; // RPC de leitura
  return pathname.startsWith("/api/") || pathname.startsWith("/rest/v1/") || pathname.startsWith("/storage/v1/");
}

/**
 * Troca cada digito visivel por "0" e borra imagens de grafico. O layout fica
 * igual (mesma largura de texto em fonte tabular), os valores somem. Nomes de
 * tela, rotulos e botoes continuam legiveis -- e isso que a evidencia mostra.
 */
async function mascarar(page: Page) {
  await page.evaluate(() => {
    const andar = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let no: Node | null;
    while ((no = andar.nextNode())) {
      if (no.nodeValue && /\d/.test(no.nodeValue)) no.nodeValue = no.nodeValue.replace(/\d/g, "0");
    }
    document.querySelectorAll<HTMLInputElement>("input").forEach((i) => {
      if (/\d/.test(i.value)) i.value = i.value.replace(/\d/g, "0");
    });
    document.querySelectorAll<SVGTextElement>("svg text, svg tspan").forEach((t) => {
      if (t.textContent && /\d/.test(t.textContent)) t.textContent = t.textContent.replace(/\d/g, "0");
    });
  });
}

export async function evidencia(page: Page, info: TestInfo, nome: string) {
  if (MASCARAR) await mascarar(page);
  const pasta = join(EVIDENCIAS, info.project.name);
  mkdirSync(pasta, { recursive: true });
  const caminho = join(pasta, `${nome}.png`);
  await page.screenshot({ path: caminho, fullPage: true, animations: "disabled" });
  await info.attach(nome, { path: caminho, contentType: "image/png" });
}

/** Espera a pagina assentar: rede quieta e nenhum "Carregando..." na tela. */
export async function esperarAssentar(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await expect(page.locator("main").getByText(/^Carregando/))
    .toHaveCount(0, { timeout: 15_000 })
    .catch(() => {});
}

export const test = base.extend<{ quebras: Quebras }>({
  // `auto`: a trava de escrita vale ate para o teste que nao pede `quebras`.
  quebras: [async ({ page }, use, info) => {
    const quebras: Quebras = { excecoes: [], respostas5xx: [], escritasBloqueadas: [] };

    page.on("pageerror", (e) => quebras.excecoes.push(`${e.name}: ${e.message}`));
    page.on("response", (r) => {
      const u = new URL(r.url());
      const nossa = u.pathname.startsWith("/api/") || u.pathname.startsWith("/rest/v1/") || u.pathname.startsWith("/auth/v1/");
      if (nossa && r.status() >= 500) quebras.respostas5xx.push(`${r.status()} ${r.request().method()} ${u.pathname}`);
    });

    await page.route("**/*", (rota) => {
      const req = rota.request();
      if (ehEscritaBloqueada(req.method(), req.url())) {
        quebras.escritasBloqueadas.push(`${req.method()} ${new URL(req.url()).pathname}`);
        return rota.abort("blockedbyclient");
      }
      return rota.fallback();
    });

    await use(quebras);

    if (quebras.escritasBloqueadas.length) {
      info.annotations.push({
        type: "escrita bloqueada",
        description: [...new Set(quebras.escritasBloqueadas)].join(", "),
      });
    }
    // Print da falha, MASCARADO. O `screenshot: "on"` do Playwright nao passa
    // pela mascara, por isso ele fica desligado no config.
    if (info.status !== info.expectedStatus) {
      await evidencia(page, info, `FALHA-${info.title.replace(/[^\w-]+/g, "-")}`).catch(() => {});
    }
  }, { auto: true }],
});

export function semQuebras(quebras: Quebras) {
  expect.soft(quebras.excecoes, "excecao nao tratada no navegador").toEqual([]);
  expect.soft(quebras.respostas5xx, "resposta 5xx do servidor").toEqual([]);
}

export { expect };
