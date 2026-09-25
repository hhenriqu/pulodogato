#!/usr/bin/env node
// =====================================================
// GERA OS ICONES DO PWA A PARTIR DO LOGO
// =====================================================
//   node scripts/generate-pwa-icons.mjs
//
// O QUE ESTE SCRIPT CONSERTA
// --------------------------
// Todo arquivo em `public/icons/*.png` era, na verdade, um documento SVG com
// nome `.png` -- e o `public/favicon.ico` tambem. Conferido nos bytes, aqui e
// em producao:
//
//   $ head -c 40 public/icons/icon-512x512.png
//   <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ...
//
// A Vercel serve esses arquivos com `Content-Type: image/png`, porque o tipo
// sai da EXTENSAO, nao do conteudo. Entao nada no caminho reclama: o servidor
// anuncia PNG, o manifest declara `"type": "image/png"`, e o corpo e XML.
//
// A consequencia nao e estetica. O Chrome no Android so oferece instalar um
// site quando o manifest tem ao menos um icone de 192px ou mais que ele
// consiga DECODIFICAR -- e o Chrome nao aceita SVG como icone de manifest
// (o Firefox aceita; e essa diferenca que faz o defeito parecer intermitente).
// Nenhum dos 10 arquivos decodificava. O evento `beforeinstallprompt` nunca
// era emitido, e por isso o banner "Instalar Pulo do Gato" do PWAWrapper --
// que esta escrito e correto desde o inicio -- nunca apareceu para ninguem.
//
// POR QUE EM NODE PURO
// --------------------
// Nao ha `sharp`, ImageMagick, rsvg nem python neste ambiente. Colocar um
// binario nativo no `package.json` para produzir 20 arquivos estaticos que sao
// commitados seria pagar a dependencia em todo `npm ci`, para sempre, por um
// trabalho que acontece uma vez. `scripts/png.mjs` faz o suficiente com `zlib`.
//
// A FONTE E O PNG, NAO O SVG
// --------------------------
// `public/logo_pulodogato.png` e um PNG de verdade: 1024x1024, 8 bits, RGB.
// Os SVGs mal-nomeados nao servem de origem porque rasterizar SVG exigiria
// justamente a dependencia que nao queremos.
// =====================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  decodificarPNG,
  codificarPNG,
  caixaDoConteudo,
  enquadrarEmQuadrado,
  faixasHorizontais,
  recortar,
} from "./png.mjs";

const ORIGEM = "public/logo_pulodogato.png";

/**
 * Quanto da aresta o desenho ocupa em cada familia de icone.
 *
 * `any` -- a tela inteira e o icone. O sistema pode arredondar os cantos, mas
 * nao recorta o miolo. Margem pequena so para o desenho nao encostar na borda.
 *
 * `maskable` -- o Android RECORTA a tela na forma que o fabricante escolher:
 * circulo, quadrado arredondado, gota. A unica regiao garantida e o circulo
 * central de 80% da aresta. Um quadrado inscrito nesse circulo tem lado
 * 0.8/raiz(2) = 0.566 da aresta; 0.56 fica logo abaixo disso, entao o desenho
 * sobrevive a QUALQUER mascara, nao apenas as mais generosas.
 */
const OCUPACAO = { any: 0.92, maskable: 0.56 };

const TAMANHOS_ANY = [16, 32, 48, 72, 96, 128, 144, 152, 192, 384, 512];

/**
 * Abaixo deste lado o icone usa SO o simbolo, sem o wordmark.
 *
 * O logo tem o texto "PULO DO GATO" ocupando a faixa de baixo. Enquadrado
 * inteiro num favicon de 32px, o texto vira uma tarja cinza ilegivel E rouba
 * metade da altura do gato -- o resultado nao le como nada. Cortado, o simbolo
 * usa a tela toda e ainda se reconhece.
 *
 * O corte fica em 128 porque e onde a altura do texto passa de ~11px, o limite
 * em que ele deixa de ser uma mancha. O icone de 192, que e o que o Android
 * usa na tela inicial, fica com o logo completo.
 */
const LADO_MINIMO_COM_TEXTO = 128;

/** O Android exige 192 e 512 maskable; os outros tamanhos ele deriva. */
const TAMANHOS_MASKABLE = [192, 512];

/** iOS ignora o manifest e usa <link rel="apple-touch-icon">. 180 e o tamanho atual. */
const TAMANHOS_APPLE = [152, 167, 180];

/** Os tamanhos que entram no favicon.ico. */
const TAMANHOS_FAVICON = [16, 32, 48];

// =====================================================
// POR QUE NAO HA TELA DE ABERTURA (SPLASH) DO iOS AQUI
// =====================================================
// O layout declarava sete `startupImage` em `/splash/*`. Nenhuma existia -- as
// sete davam 404 em producao. A saida obvia seria gerar as sete; medi o custo
// antes, e ele nao se paga:
//
//   logo a 1229px na tela de 2048x2732 -> 913 KB   (proporcional, o default)
//   logo a  420px na mesma tela        -> 183 KB   (ja pequeno demais)
//   so o fundo chapado, sem logo algum ->  20 KB   (o piso do formato)
//
// Sete arquivos dariam entre 1,3 e 3,9 MB commitados, baixados em toda
// instalacao. O logo e uma ilustracao com ruido, e PNG e um formato ruim para
// isso em tamanho grande -- dai o piso alto.
//
// E o gasto compraria pouco: o iOS so aceita a imagem quando ela bate EXATAMENTE
// com a resolucao fisica do aparelho. A lista declarada cobre iPhone 8, X, XR,
// SE e iPads -- nenhum iPhone 12 em diante. Todo aparelho recente cairia no
// mesmo fallback de qualquer jeito, e um conjunto pela metade e pior que nenhum:
// metade dos usuarios abriria com a marca e a outra metade sem.
//
// O fallback e uma tela chapada da cor `background_color` do manifest. Entao a
// decisao aqui foi apontar essa cor para o creme do proprio logo, o que da a
// abertura colorida em TODO aparelho por zero byte, em vez da abertura branca
// que o `#ffffff` anterior produzia.
// =====================================================

/** Os atalhos de toque longo no icone. Rotas conferidas em app/(dashboard). */
const ATALHOS = ["transactions", "cash-flow", "recurrences"];

/**
 * Com `--check` o script nao escreve nada: compara o que GERARIA com o que
 * esta commitado e sai 1 na primeira diferenca. E o modo que o CI usa.
 */
const APENAS_CONFERIR = process.argv.includes("--check");

const divergencias = [];

/**
 * Escreve o arquivo -- ou, em modo conferencia, compara PIXEL A PIXEL.
 *
 * A comparacao e dos pixels decodificados, e nao dos bytes do arquivo, porque
 * o tamanho do fluxo deflate depende da versao do zlib: o mesmo pixel sai com
 * bytes diferentes no Node do CI e no da maquina de quem gerou. Comparar bytes
 * daria um vermelho intermitente que nao corresponde a defeito nenhum -- e o
 * jeito mais rapido de ensinar todo mundo a ignorar este job.
 */
function gravar(caminho, buffer) {
  if (APENAS_CONFERIR) {
    if (!existsSync(caminho)) {
      divergencias.push(`${caminho} -- o gerador produz este arquivo e ele nao esta no repositorio`);
      return buffer.length;
    }

    // O .ico e um container com PNGs dentro, cada um com o seu fluxo deflate.
    // Decodificar cada entrada para comparar pixels seria reescrever um leitor
    // de ICO por pouco: os PNGs que entram nele sao os mesmos que ja foram
    // conferidos um a um acima. Aqui basta conferir que e um ICO de verdade e
    // que tem a quantidade certa de entradas.
    if (caminho.endsWith(".ico")) {
      const commitado = readFileSync(caminho);
      const cabecalhoOk =
        commitado[0] === 0 && commitado[1] === 0 && commitado[2] === 1 && commitado[3] === 0;

      if (!cabecalhoOk) {
        divergencias.push(`${caminho} -- nao e um .ico valido`);
      } else if (commitado.readUInt16LE(4) !== buffer.readUInt16LE(4)) {
        divergencias.push(
          `${caminho} -- tem ${commitado.readUInt16LE(4)} entradas e o gerador produz ` +
            `${buffer.readUInt16LE(4)}`
        );
      }
      return buffer.length;
    }

    const commitado = decodificarPNG(readFileSync(caminho));
    const gerado = decodificarPNG(buffer);

    if (
      commitado.largura !== gerado.largura ||
      commitado.altura !== gerado.altura ||
      !commitado.pixels.equals(gerado.pixels)
    ) {
      divergencias.push(
        `${caminho} -- o arquivo commitado difere do que o gerador produz ` +
          `(${commitado.largura}x${commitado.altura} vs ${gerado.largura}x${gerado.altura})`
      );
    }

    return buffer.length;
  }

  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, buffer);
  return buffer.length;
}

function main() {
  const origem = decodificarPNG(readFileSync(ORIGEM));
  console.log(`origem: ${ORIGEM} -> ${origem.largura}x${origem.altura}, ${origem.canais} canais`);

  // A cor de preenchimento sai do proprio arquivo, do pixel (0,0), em vez de
  // ser uma constante escrita a mao. Se o logo for retrabalhado num fundo
  // diferente, a moldura dos icones acompanha sozinha -- uma constante
  // desatualizada produziria um halo retangular em volta do desenho.
  const fundo = Array.from(origem.pixels.subarray(0, origem.canais));
  console.log(`cor de fundo lida do pixel (0,0): rgb(${fundo.slice(0, 3).join(", ")})`);

  const caixa = caixaDoConteudo(origem, fundo);
  if (!caixa) throw new Error(`${ORIGEM} e uma imagem de cor unica -- nao ha logo para recortar`);
  console.log(
    `caixa do conteudo: ${caixa.largura}x${caixa.altura} em (${caixa.x},${caixa.y})` +
      ` -- ${((caixa.largura / origem.largura) * 100).toFixed(0)}% x ` +
      `${((caixa.altura / origem.altura) * 100).toFixed(0)}% da origem`
  );

  // A faixa de cima e o simbolo; a de baixo, o wordmark. Ver LADO_MINIMO_COM_TEXTO.
  const faixas = faixasHorizontais(origem, fundo);
  if (faixas.length < 2) {
    throw new Error(
      `esperava ao menos 2 faixas em ${ORIGEM} (simbolo e texto), achei ${faixas.length}`
    );
  }

  const simbolo = caixaDoConteudo(
    recortar(origem, 0, faixas[0].y, origem.largura, faixas[0].altura),
    fundo
  );
  // `caixaDoConteudo` acima roda sobre o recorte, entao o y volta relativo a
  // faixa. Somar o deslocamento traz de volta para as coordenadas da origem --
  // esquecer isso recortaria o topo do gato, e o icone ainda pareceria
  // plausivel o bastante para passar.
  const caixaSimbolo = { ...simbolo, y: simbolo.y + faixas[0].y };
  console.log(
    `simbolo sem o wordmark: ${caixaSimbolo.largura}x${caixaSimbolo.altura}` +
      ` em (${caixaSimbolo.x},${caixaSimbolo.y})`
  );

  let arquivos = 0;
  let bytes = 0;
  const emitir = (caminho, img) => {
    bytes += gravar(caminho, codificarPNG(img));
    arquivos++;
  };

  /** A caixa a usar num dado lado: logo inteiro em cima do limite, simbolo abaixo. */
  const caixaPara = (lado) => (lado >= LADO_MINIMO_COM_TEXTO ? caixa : caixaSimbolo);

  for (const n of TAMANHOS_ANY) {
    emitir(
      `public/icons/icon-${n}x${n}.png`,
      enquadrarEmQuadrado(origem, caixaPara(n), n, OCUPACAO.any, fundo)
    );
  }

  for (const n of TAMANHOS_MASKABLE) {
    emitir(
      `public/icons/icon-maskable-${n}x${n}.png`,
      enquadrarEmQuadrado(origem, caixaPara(n), n, OCUPACAO.maskable, fundo)
    );
  }

  for (const n of TAMANHOS_APPLE) {
    // O iOS nao arredonda nem recorta o apple-touch-icon: ele aplica a propria
    // mascara de canto sobre a imagem cheia. Entao usa a ocupacao `any`.
    emitir(
      `public/icons/apple-touch-icon-${n}x${n}.png`,
      enquadrarEmQuadrado(origem, caixaPara(n), n, OCUPACAO.any, fundo)
    );
  }

  for (const nome of ATALHOS) {
    // Atalho aparece em 96px dentro de um menu, ja com o nome escrito ao lado:
    // o wordmark seria texto ilegivel ao lado de texto legivel.
    emitir(
      `public/icons/shortcut-${nome}.png`,
      enquadrarEmQuadrado(origem, caixaSimbolo, 96, OCUPACAO.any, fundo)
    );
  }

  // O favicon.ico tambem era um SVG. Um .ico e um container: cabecalho de 6
  // bytes, uma entrada de 16 bytes por imagem, e os dados. Navegador atual
  // aceita PNG dentro do .ico, entao reaproveitamos os icones ja gerados.
  bytes += gravar("public/favicon.ico", montarICO(TAMANHOS_FAVICON.map((n) =>
    codificarPNG(enquadrarEmQuadrado(origem, caixa, n, OCUPACAO.any, fundo))
  )));
  arquivos++;

  if (APENAS_CONFERIR) {
    if (divergencias.length) {
      console.error(`\ngenerate-pwa-icons --check: ${divergencias.length} divergencia(s)\n`);
      for (const d of divergencias) console.error(`  ${d}`);
      console.error(`\nRode: npm run generate-pwa-icons\n`);
      process.exit(1);
    }

    console.log(
      `\n${arquivos} arquivos conferidos -- os icones no repositorio sao ` +
        `exatamente o que o gerador produz a partir de ${ORIGEM}.`
    );
    return;
  }

  console.log(`\n${arquivos} arquivos, ${(bytes / 1024).toFixed(0)} KB no total`);
}

/** Empacota PNGs num unico arquivo .ico. */
function montarICO(pngs) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0); // reservado
  cabecalho.writeUInt16LE(1, 2); // 1 = icone
  cabecalho.writeUInt16LE(pngs.length, 4);

  const entradas = [];
  let deslocamento = 6 + pngs.length * 16;

  for (const png of pngs) {
    const lado = png.readUInt32BE(16);
    const e = Buffer.alloc(16);
    // 256 e gravado como 0: o campo tem 1 byte so. Nao chegamos a 256 aqui,
    // mas deixar o modulo evita um 0 acidental virar "256" se a lista crescer.
    e[0] = lado % 256;
    e[1] = lado % 256;
    e[2] = 0; // cores da paleta (0 = sem paleta)
    e[3] = 0; // reservado
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(deslocamento, 12);
    entradas.push(e);
    deslocamento += png.length;
  }

  return Buffer.concat([cabecalho, ...entradas, ...pngs]);
}

main();
