#!/usr/bin/env node
// =====================================================
// TODO ASSET DE PWA DECLARADO EXISTE, E E O QUE DIZ SER
// =====================================================
//   npm run check-pwa-assets
//
// POR QUE ESTE GUARD EXISTE
// -------------------------
// Os dez arquivos de `public/icons/*.png` eram documentos SVG com nome `.png`,
// e o `favicon.ico` tambem. Alem deles, catorze caminhos declarados no manifest
// e no layout apontavam para arquivos que nunca existiram (as sete telas de
// abertura do iOS, `/logo_pulodogato.svg`, os icones dos atalhos, as capturas
// de tela). Nada no projeto reclamava de nenhum dos dois casos:
//
//   * a Vercel decide o `Content-Type` pela EXTENSAO. Um SVG chamado `.png` e
//     servido como `image/png` com HTTP 200. O servidor concorda com a mentira;
//   * um `<link rel="apple-touch-icon">` quebrado nao gera erro de build, nao
//     gera aviso de lint e nao aparece na tela -- o icone simplesmente nao
//     surge, e quem testa no desktop nunca ve.
//
// O resultado nao era estetico. O Chrome no Android so oferece instalar quando
// consegue DECODIFICAR um icone de 192px ou mais do manifest, e ele nao aceita
// SVG nesse papel. Como nenhum dos dez decodificava, `beforeinstallprompt`
// nunca era emitido e o app nao podia ser instalado -- por meses, sem sintoma.
//
// Este guard fecha as tres portas: o arquivo existe, e um PNG de verdade, e tem
// a dimensao que foi anunciada.
// =====================================================

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { lerDimensoes } from "./png.mjs";

const MANIFEST = "public/manifest.json";
const LAYOUT = "app/layout.tsx";
const BROWSERCONFIG = "public/icons/browserconfig.xml";

/** Menor lado que o Chrome aceita como icone instalavel. */
const LADO_MINIMO_INSTALAVEL = 192;

const problemas = [];
const reclamar = (onde, o_que) => problemas.push({ onde, o_que });

// ---------------------------------------------------------------------------
// O que cada arquivo declara
// ---------------------------------------------------------------------------

/** `[{ url, tamanhoDeclarado, onde }]` a partir do manifest. */
function declaradosNoManifest(manifest) {
  const saida = [];

  for (const icone of manifest.icons ?? []) {
    saida.push({ url: icone.src, tamanho: icone.sizes, onde: `${MANIFEST} icons` });
  }

  for (const atalho of manifest.shortcuts ?? []) {
    for (const icone of atalho.icons ?? []) {
      saida.push({
        url: icone.src,
        tamanho: icone.sizes,
        onde: `${MANIFEST} shortcuts[${atalho.name}]`,
      });
    }
  }

  // As capturas de tela entram na mesma conferencia: uma `screenshot` que da
  // 404 faz o Chrome descartar a ficha de instalacao rica e cair na simples,
  // sem dizer por que.
  for (const captura of manifest.screenshots ?? []) {
    saida.push({
      url: captura.src,
      tamanho: captura.sizes,
      onde: `${MANIFEST} screenshots`,
    });
  }

  return saida;
}

/**
 * Todo caminho absoluto de asset citado no layout.
 *
 * Varre o TEXTO do arquivo em vez de importar o modulo: o layout e TSX e
 * importa CSS e fontes, entao carrega-lo aqui exigiria o build do Next inteiro.
 * O custo e nao entender caminho montado em runtime -- e o layout nao tem
 * nenhum, todos sao literais.
 */
function declaradosNoLayout(texto) {
  const achados = texto.matchAll(/["'`](\/[A-Za-z0-9_\-./]+\.(?:png|ico|svg|xml|webmanifest|json))["'`]/g);
  return [...achados].map((m) => ({ url: m[1], tamanho: null, onde: LAYOUT }));
}

/** Os `src` das tiles do Windows. */
function declaradosNoBrowserconfig(texto) {
  const achados = texto.matchAll(/src="(\/[^"]+)"/g);
  return [...achados].map((m) => ({ url: m[1], tamanho: null, onde: BROWSERCONFIG }));
}

// ---------------------------------------------------------------------------
// As rotas que existem de verdade
// ---------------------------------------------------------------------------

/**
 * Toda rota com `page.tsx`, com os grupos `(...)` removidos do caminho.
 *
 * Os dois atalhos originais do manifest apontavam para
 * `/dashboard/transactions/new` e `/dashboard/portfolio`; nenhuma das duas
 * existe (a segunda chama-se `/dashboard/investments`). Atalho de toque longo
 * so aparece depois que o app esta instalado, entao os dois 404 estavam num
 * lugar onde ninguem tropeca por acaso.
 */
function rotasExistentes(raiz = "app") {
  const rotas = new Set();

  const andar = (dir) => {
    for (const entrada of readdirSync(dir)) {
      const caminho = `${dir}/${entrada}`;
      if (statSync(caminho).isDirectory()) andar(caminho);
      else if (entrada === "page.tsx") {
        const rota = dir
          .slice(raiz.length)
          .split("/")
          .filter((s) => s && !s.startsWith("("))
          .join("/");
        rotas.add("/" + rota);
      }
    }
  };

  andar(raiz);
  return rotas;
}

// ---------------------------------------------------------------------------
// As conferencias
// ---------------------------------------------------------------------------

function conferirAsset({ url, tamanho, onde }) {
  const caminho = "public" + url.split("?")[0];

  if (!existsSync(caminho)) {
    reclamar(onde, `${url} -- declarado, mas o arquivo nao existe em ${caminho}`);
    return;
  }

  if (!caminho.endsWith(".png") && !caminho.endsWith(".ico")) return;

  const bytes = readFileSync(caminho);

  if (caminho.endsWith(".ico")) {
    // Um .ico comeca com 00 00 01 00. Um SVG comeca com "<" -- que foi
    // exatamente o que o favicon.ico deste projeto tinha dentro.
    if (!(bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0)) {
      reclamar(onde, `${url} -- nao e um .ico (comeca com ${JSON.stringify(bytes.subarray(0, 12).toString("latin1"))})`);
    }
    return;
  }

  const dimensoes = lerDimensoes(bytes);
  if (!dimensoes) {
    reclamar(
      onde,
      `${url} -- tem nome .png mas NAO e PNG. Comeca com ` +
        `${JSON.stringify(bytes.subarray(0, 40).toString("latin1"))}`
    );
    return;
  }

  // A dimensao anunciada tem que bater com a real. Sem isto, trocar o arquivo
  // de 512 por uma copia do de 192 passaria despercebido: o Chrome aceitaria
  // o icone (decodifica) e mostraria uma versao esticada e borrada.
  const esperado =
    tamanho ??
    (caminho.match(/-(\d+)x(\d+)\.png$/) ? RegExp.$1 + "x" + RegExp.$2 : null);

  if (esperado) {
    const real = `${dimensoes.largura}x${dimensoes.altura}`;
    if (real !== esperado) {
      reclamar(onde, `${url} -- anuncia ${esperado} e o arquivo tem ${real}`);
    }
  }
}

function conferirInstalabilidade(manifest) {
  const icones = manifest.icons ?? [];

  const serve = (icone, proposito) => {
    const propositos = (icone.purpose ?? "any").split(/\s+/);
    if (!propositos.includes(proposito)) return false;
    const [largura] = (icone.sizes ?? "0x0").split("x").map(Number);
    return largura >= LADO_MINIMO_INSTALAVEL;
  };

  if (!icones.some((i) => serve(i, "any"))) {
    reclamar(
      MANIFEST,
      `nenhum icone com purpose "any" de ${LADO_MINIMO_INSTALAVEL}px ou mais -- ` +
        `o Chrome nao oferece instalar sem isso`
    );
  }

  if (!icones.some((i) => serve(i, "maskable"))) {
    reclamar(
      MANIFEST,
      `nenhum icone com purpose "maskable" de ${LADO_MINIMO_INSTALAVEL}px ou mais -- ` +
        `o Android desenha o icone dentro de um quadrado branco no lugar de usar a forma do sistema`
    );
  }

  // "any maskable" no MESMO arquivo garante que um dos dois sai errado: ou o
  // icone normal fica com moldura grossa, ou o adaptativo tem o desenho cortado
  // pela mascara. Sao enquadramentos diferentes, nao rotulos diferentes.
  for (const icone of icones) {
    const propositos = (icone.purpose ?? "any").split(/\s+/);
    if (propositos.includes("any") && propositos.includes("maskable")) {
      reclamar(
        MANIFEST,
        `${icone.src} -- declarado "any maskable" ao mesmo tempo. Os dois pedem ` +
          `enquadramento diferente: gere um arquivo para cada purpose`
      );
    }
  }
}

function conferirAtalhos(manifest, rotas) {
  for (const atalho of manifest.shortcuts ?? []) {
    const rota = atalho.url.split("?")[0].replace(/\/$/, "");
    if (!rotas.has(rota)) {
      reclamar(
        `${MANIFEST} shortcuts[${atalho.name}]`,
        `${atalho.url} -- nao ha page.tsx para essa rota`
      );
    }
  }

  const inicio = (manifest.start_url ?? "/").split("?")[0].replace(/\/$/, "");
  if (inicio && !rotas.has(inicio)) {
    reclamar(MANIFEST, `start_url ${manifest.start_url} -- nao ha page.tsx para essa rota`);
  }
}

// ---------------------------------------------------------------------------

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const rotas = rotasExistentes();

  const declarados = [
    ...declaradosNoManifest(manifest),
    ...declaradosNoLayout(readFileSync(LAYOUT, "utf8")),
    ...declaradosNoBrowserconfig(readFileSync(BROWSERCONFIG, "utf8")),
  ];

  // Agrupa por ARQUIVO antes de conferir. O mesmo icone costuma ser declarado
  // no manifest, no layout e no browserconfig; sem o agrupamento, um unico
  // arquivo quebrado vira tres linhas iguais, e o estado original deste projeto
  // -- dez icones invalidos -- encheria a tela com trinta reclamacoes para
  // catorze causas.
  const porArquivo = new Map();
  for (const d of declarados) {
    // O proprio manifest e servido pelo Next, nao e um asset de imagem.
    if (d.url === "/manifest.json") continue;

    if (!porArquivo.has(d.url)) porArquivo.set(d.url, { url: d.url, tamanhos: new Map() });
    if (d.tamanho) porArquivo.get(d.url).tamanhos.set(d.tamanho, d.onde);
    porArquivo.get(d.url).ondes ??= [];
    porArquivo.get(d.url).ondes.push(d.onde);
  }

  for (const { url, tamanhos, ondes } of porArquivo.values()) {
    const onde = [...new Set(ondes)].join(", ");

    // Dois lugares anunciando tamanhos diferentes para o mesmo arquivo: um dos
    // dois esta errado, e nao da para saber qual sem olhar. Reclamar e mais
    // util que escolher em silencio.
    if (tamanhos.size > 1) {
      reclamar(
        onde,
        `${url} -- anunciado com tamanhos diferentes: ` +
          [...tamanhos.entries()].map(([t, o]) => `${t} em ${o}`).join(", ")
      );
      continue;
    }

    conferirAsset({ url, tamanho: [...tamanhos.keys()][0] ?? null, onde });
  }

  conferirInstalabilidade(manifest);
  conferirAtalhos(manifest, rotas);

  if (problemas.length) {
    console.error(`\ncheck-pwa-assets: ${problemas.length} problema(s)\n`);
    for (const p of problemas) console.error(`  [${p.onde}]\n    ${p.o_que}\n`);
    console.error(
      "Para regerar os icones a partir de public/logo_pulodogato.png:\n" +
        "  node scripts/generate-pwa-icons.mjs\n"
    );
    process.exit(1);
  }

  console.log(
    `check-pwa-assets: ${porArquivo.size} arquivos ` +
      `(${declarados.length} declaracoes) conferidos -- todos existem, sao do ` +
      `formato que anunciam e tem a dimensao anunciada.`
  );
}

main();
