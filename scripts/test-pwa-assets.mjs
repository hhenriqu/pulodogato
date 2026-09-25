// =====================================================
// TESTES DO GUARD DE ASSETS DE PWA
// =====================================================
//   npm run test:pwa-assets
//
// Um guard que so foi visto passando nao prova nada -- `process.exit(0)` no
// topo passaria igual. Cada teste aqui monta uma arvore de projeto minima com
// UM defeito plantado e exige que o guard reprove, citando aquele defeito.
//
// Os defeitos plantados nao sao inventados: os cinco primeiros sao exatamente
// o que estava em producao antes deste PR.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";

const GUARD = resolve("scripts/check-pwa-assets.mjs");

/** Um PNG de verdade do tamanho pedido, gerado na hora. */
async function png(lado) {
  const { codificarPNG, telaLisa } = await import("./png.mjs");
  return codificarPNG(telaLisa(lado, lado, [10, 20, 30]));
}

const MANIFEST_BOM = {
  name: "App",
  short_name: "App",
  start_url: "/dashboard",
  scope: "/",
  display: "standalone",
  icons: [
    { src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    {
      src: "/icons/icon-maskable-192x192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "maskable",
    },
  ],
  shortcuts: [
    {
      name: "Transacoes",
      url: "/dashboard/transactions",
      icons: [{ src: "/icons/shortcut-transactions.png", sizes: "96x96", type: "image/png" }],
    },
  ],
};

const BROWSERCONFIG_BOM =
  '<?xml version="1.0"?><browserconfig><msapplication><tile>' +
  '<square150x150logo src="/icons/icon-192x192.png"/>' +
  "</tile></msapplication></browserconfig>";

const NEXT_CONFIG_BOM = `const withPWA = require("next-pwa")({
  dest: "public",
  fallbacks: { document: "/offline" },
});
module.exports = withPWA({});
`;

const LAYOUT_BOM = `export const metadata = {
  icons: { icon: [{ url: "/icons/icon-192x192.png" }] },
};
export default function L({ children }) { return children; }
`;

/**
 * Monta um projeto de mentira e roda o guard dentro dele.
 * `ajustar` recebe a arvore para plantar o defeito antes da execucao.
 */
async function rodarGuard(ajustar = () => {}) {
  const raiz = mkdtempSync(join(tmpdir(), "pwa-assets-"));

  const arquivos = new Map([
    ["public/manifest.json", JSON.stringify(structuredClone(MANIFEST_BOM), null, 2)],
    ["public/icons/browserconfig.xml", BROWSERCONFIG_BOM],
    ["app/layout.tsx", LAYOUT_BOM],
    ["next.config.js", NEXT_CONFIG_BOM],
    ["app/offline/page.tsx", "export default function P() {}"],
    ["app/(dashboard)/dashboard/page.tsx", "export default function P() {}"],
    ["app/(dashboard)/dashboard/transactions/page.tsx", "export default function P() {}"],
    ["public/icons/icon-192x192.png", await png(192)],
    ["public/icons/icon-maskable-192x192.png", await png(192)],
    ["public/icons/shortcut-transactions.png", await png(96)],
  ]);

  // O ajuste recebe um objeto com o manifest ja parseado, para os testes
  // mexerem em campo em vez de em texto.
  const contexto = {
    arquivos,
    manifest: JSON.parse(arquivos.get("public/manifest.json")),
  };
  ajustar(contexto);
  arquivos.set("public/manifest.json", JSON.stringify(contexto.manifest, null, 2));

  for (const [caminho, conteudo] of arquivos) {
    if (conteudo === null) continue; // null = "este arquivo nao existe"
    const destino = join(raiz, caminho);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, conteudo);
  }

  const r = spawnSync(process.execPath, [GUARD], { cwd: raiz, encoding: "utf8" });
  rmSync(raiz, { recursive: true, force: true });

  return { codigo: r.status, saida: (r.stdout ?? "") + (r.stderr ?? "") };
}

// ---------------------------------------------------------------------------

test("a arvore sem defeito passa", async () => {
  // O controle. Sem ele, um guard que reprova tudo passaria em todos os
  // testes abaixo e pareceria excelente.
  const { codigo, saida } = await rodarGuard();
  assert.equal(codigo, 0, saida);
});

test("reprova SVG com nome .png -- o defeito original", async () => {
  const { codigo, saida } = await rodarGuard(({ arquivos }) => {
    arquivos.set(
      "public/icons/icon-192x192.png",
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"><svg viewBox="0 0 192 192"></svg>'
    );
  });

  assert.equal(codigo, 1);
  assert.match(saida, /NAO e PNG/);
  assert.match(saida, /icon-192x192\.png/);
});

test("reprova favicon.ico que e SVG por dentro", async () => {
  const { codigo, saida } = await rodarGuard(({ arquivos }) => {
    arquivos.set("public/favicon.ico", "<!DOCTYPE svg ...");
    arquivos.set(
      "app/layout.tsx",
      LAYOUT_BOM.replace("icon: [", 'shortcut: "/favicon.ico", icon: [')
    );
  });

  assert.equal(codigo, 1);
  assert.match(saida, /nao e um \.ico/);
});

test("reprova caminho declarado que nao existe no disco", async () => {
  const { codigo, saida } = await rodarGuard(({ arquivos }) => {
    // Era assim que as sete telas de abertura e o /logo_pulodogato.svg viviam.
    arquivos.set(
      "app/layout.tsx",
      LAYOUT_BOM.replace("icon: [", 'other: "/splash/apple-splash-750-1334.png", icon: [')
    );
  });

  assert.equal(codigo, 1);
  assert.match(saida, /o arquivo nao existe/);
  assert.match(saida, /apple-splash-750-1334/);
});

test("reprova dimensao anunciada diferente da real", async () => {
  const { codigo, saida } = await rodarGuard(({ arquivos }) => {
    // O arquivo E um PNG valido -- so que de 64px se dizendo de 192. O Chrome
    // aceitaria e mostraria esticado; so a medicao pega.
    arquivos.set("public/icons/icon-192x192.png", null);
  });
  assert.equal(codigo, 1, saida);

  const segundo = await rodarGuard(({ manifest }) => {
    manifest.icons[0].sizes = "512x512";
  });
  assert.equal(segundo.codigo, 1);
  assert.match(segundo.saida, /anuncia 512x512 e o arquivo tem 192x192/);
});

test("reprova atalho que aponta para rota sem page.tsx", async () => {
  const { codigo, saida } = await rodarGuard(({ manifest }) => {
    // Os dois atalhos originais faziam exatamente isto.
    manifest.shortcuts[0].url = "/dashboard/portfolio";
  });

  assert.equal(codigo, 1);
  assert.match(saida, /nao ha page\.tsx/);
  assert.match(saida, /portfolio/);
});

test("reprova start_url sem rota", async () => {
  const { codigo, saida } = await rodarGuard(({ manifest }) => {
    manifest.start_url = "/inicio?utm_source=pwa";
  });

  assert.equal(codigo, 1);
  assert.match(saida, /start_url/);
});

test("reprova manifest sem icone instalavel de 192px", async () => {
  const { codigo, saida } = await rodarGuard(({ manifest, arquivos }) => {
    // 128px e um icone legitimo -- so nao serve para o Chrome oferecer
    // instalar. E o caso em que tudo "existe e e valido" e mesmo assim o app
    // nao pode ser instalado.
    manifest.icons[0] = {
      src: "/icons/icon-128x128.png",
      sizes: "128x128",
      type: "image/png",
      purpose: "any",
    };
    arquivos.set("public/icons/icon-192x192.png", null);
    arquivos.set("public/icons/icon-128x128.png", arquivos.get("public/icons/icon-192x192.png"));
    arquivos.set("app/layout.tsx", LAYOUT_BOM.replace("icon-192x192", "icon-128x128"));
    arquivos.set("public/icons/browserconfig.xml", BROWSERCONFIG_BOM.replace("icon-192x192", "icon-128x128"));
  });

  assert.equal(codigo, 1);
  assert.match(saida, /nao oferece instalar/);
});

test("reprova manifest sem nenhum maskable", async () => {
  const { codigo, saida } = await rodarGuard(({ manifest }) => {
    manifest.icons = manifest.icons.filter((i) => i.purpose !== "maskable");
  });

  assert.equal(codigo, 1);
  assert.match(saida, /maskable/);
});

test('reprova o mesmo arquivo declarado "any maskable"', async () => {
  const { codigo, saida } = await rodarGuard(({ manifest }) => {
    // Era o que o manifest fazia em oito dos onze icones. Os dois propositos
    // pedem enquadramento diferente: um arquivo so nao atende os dois.
    manifest.icons[0].purpose = "any maskable";
  });

  assert.equal(codigo, 1);
  assert.match(saida, /any maskable/);
});

test("relata TODOS os problemas, nao so o primeiro", async () => {
  // Importa porque os defeitos vieram em bloco: dez icones e catorze caminhos
  // de uma vez. Um guard que para no primeiro exigiria vinte e quatro rodadas.
  const { codigo, saida } = await rodarGuard(({ arquivos, manifest }) => {
    arquivos.set("public/icons/icon-192x192.png", "<!DOCTYPE svg ...");
    arquivos.set("public/icons/shortcut-transactions.png", "<!DOCTYPE svg ...");
    manifest.shortcuts[0].url = "/dashboard/nao-existe";
  });

  assert.equal(codigo, 1);
  assert.match(saida, /3 problema\(s\)/);
});

// ---------------------------------------------------------------------------
// O desvio para /offline (HMO-145)
// ---------------------------------------------------------------------------
// Mesma familia dos defeitos acima: o arquivo existe, o caminho parece
// configurado, e a peca que ligaria os dois nao esta la. A pagina /offline
// ficou meses assim -- pronta, bonita e inalcancavel.

test("reprova next.config.js sem o desvio para a pagina de offline", async () => {
  const { codigo, saida } = await rodarGuard(({ arquivos }) => {
    // Exatamente o estado que estava em producao: o next-pwa configurado, sem
    // a chave `fallbacks`. Com o default ele procura `pages/_offline.*`, nao
    // acha (App Router), e desliga os desvios sem imprimir nada.
    arquivos.set(
      "next.config.js",
      'const withPWA = require("next-pwa")({ dest: "public" });\nmodule.exports = withPWA({});\n'
    );
  });

  assert.equal(codigo, 1);
  assert.match(saida, /fallbacks/);
});

test("reprova desvio apontando para rota sem page.tsx", async () => {
  // O jeito de reintroduzir o defeito sem apagar nenhuma linha: renomear a
  // rota e deixar a configuracao apontando para o vazio. A pagina some e a
  // chave continua la, parecendo certa.
  const { codigo, saida } = await rodarGuard(({ arquivos }) => {
    arquivos.set("app/offline/page.tsx", null);
  });

  assert.equal(codigo, 1);
  assert.match(saida, /nao ha page\.tsx para essa rota/);
});
