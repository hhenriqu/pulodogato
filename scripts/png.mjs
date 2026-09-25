// =====================================================
// UM CODEC PNG MINIMO, EM NODE PURO
// =====================================================
// Existe para gerar os icones do PWA a partir de `public/logo_pulodogato.png`
// sem depender de `sharp`, ImageMagick ou rsvg -- nenhum dos tres existe neste
// ambiente, e nenhum deveria entrar no `package.json` so para produzir arquivo
// estatico que e commitado. `zlib` ja vem no Node e faz a parte dificil.
//
// O ESCOPO E DELIBERADAMENTE ESTREITO
// -----------------------------------
// Le apenas o subconjunto que a imagem de origem usa -- 8 bits por canal, sem
// entrelacamento, cor RGB ou RGBA -- e RECUSA com erro qualquer outra coisa.
// Um decodificador que "tenta" um formato que nao entende devolve pixel de lixo
// em silencio, e o defeito so apareceria no icone do celular de alguem.
// =====================================================

import zlib from "node:zlib";

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Bytes por pixel de cada `colorType` que este codec aceita. */
const CANAIS = { 2: 3, 6: 4 };

// ---------------------------------------------------------------------------
// CRC32 -- exigido em todo chunk PNG.
// ---------------------------------------------------------------------------
const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Decodificacao
// ---------------------------------------------------------------------------

/**
 * Le um PNG e devolve `{ largura, altura, canais, pixels }`, com `pixels` no
 * formato linear (sem o byte de filtro por linha).
 */
export function decodificarPNG(buffer) {
  if (!buffer.subarray(0, 8).equals(ASSINATURA)) {
    throw new Error("nao e um PNG: assinatura ausente");
  }

  let largura = 0;
  let altura = 0;
  let canais = 0;
  const pedacos = [];

  let o = 8;
  while (o + 8 <= buffer.length) {
    const tamanho = buffer.readUInt32BE(o);
    const tipo = buffer.subarray(o + 4, o + 8).toString("latin1");
    const dados = buffer.subarray(o + 8, o + 8 + tamanho);

    if (tipo === "IHDR") {
      largura = dados.readUInt32BE(0);
      altura = dados.readUInt32BE(4);
      const profundidade = dados[8];
      const tipoDeCor = dados[9];
      const entrelacado = dados[12];

      // As tres recusas abaixo sao o ponto do codec ser estreito. Sem elas o
      // laco de desfiltragem ainda "funcionaria" -- com `bpp` errado -- e
      // produziria uma imagem embaralhada sem nenhum erro.
      if (profundidade !== 8) {
        throw new Error(`profundidade ${profundidade} nao suportada (so 8 bits por canal)`);
      }
      if (!CANAIS[tipoDeCor]) {
        throw new Error(`colorType ${tipoDeCor} nao suportado (so 2=RGB e 6=RGBA)`);
      }
      if (entrelacado !== 0) {
        throw new Error("PNG entrelacado (Adam7) nao suportado");
      }
      canais = CANAIS[tipoDeCor];
    } else if (tipo === "IDAT") {
      // Os IDAT sao pedacos de UM unico fluxo zlib: precisam ser concatenados
      // antes de inflar. Inflar cada um por si falha a partir do segundo.
      pedacos.push(Buffer.from(dados));
    } else if (tipo === "IEND") {
      break;
    }

    o += 12 + tamanho;
  }

  if (!largura || !altura) throw new Error("PNG sem IHDR valido");
  if (!pedacos.length) throw new Error("PNG sem IDAT");

  const bruto = zlib.inflateSync(Buffer.concat(pedacos));
  const passo = largura * canais;

  if (bruto.length < altura * (passo + 1)) {
    throw new Error(
      `IDAT curto: ${bruto.length} bytes para ${altura} linhas de ${passo + 1}`
    );
  }

  const pixels = Buffer.alloc(altura * passo);

  for (let y = 0; y < altura; y++) {
    const filtro = bruto[y * (passo + 1)];
    const linha = bruto.subarray(y * (passo + 1) + 1, y * (passo + 1) + 1 + passo);
    const atual = pixels.subarray(y * passo, (y + 1) * passo);
    const acima = y > 0 ? pixels.subarray((y - 1) * passo, y * passo) : null;

    for (let i = 0; i < passo; i++) {
      const a = i >= canais ? atual[i - canais] : 0;
      const b = acima ? acima[i] : 0;
      const c = acima && i >= canais ? acima[i - canais] : 0;
      let v = linha[i];

      switch (filtro) {
        case 0:
          break;
        case 1:
          v += a;
          break;
        case 2:
          v += b;
          break;
        case 3:
          v += (a + b) >> 1;
          break;
        case 4: {
          // Paeth: escolhe o vizinho mais proximo da predicao linear. O empate
          // e resolvido na ordem a > b > c, e ela E normativa -- inverter a
          // ordem decodifica a maioria dos pixels certo e alguns errado, que e
          // o pior tipo de defeito porque a imagem "quase" aparece.
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default:
          throw new Error(`filtro de linha desconhecido: ${filtro}`);
      }

      atual[i] = v & 0xff;
    }
  }

  return { largura, altura, canais, pixels };
}

// ---------------------------------------------------------------------------
// Codificacao
// ---------------------------------------------------------------------------

function chunk(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, "latin1"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo), 0);
  return Buffer.concat([tamanho, corpo, crc]);
}

/**
 * Escreve um PNG a partir de `{ largura, altura, canais, pixels }`.
 *
 * Usa filtro 0 (None) em todas as linhas. Um codificador serio escolheria o
 * filtro linha a linha para comprimir melhor, mas aqui as imagens sao icones
 * de no maximo 512px com area chapada, onde o deflate ja resolve -- e filtro
 * fixo mantem o codificador pequeno o bastante para ser obviamente correto.
 */
export function codificarPNG({ largura, altura, canais, pixels }) {
  if (!CANAIS[canais === 3 ? 2 : 6]) throw new Error(`canais invalido: ${canais}`);

  const tipoDeCor = canais === 3 ? 2 : 6;
  const passo = largura * canais;

  const bruto = Buffer.alloc(altura * (passo + 1));
  for (let y = 0; y < altura; y++) {
    bruto[y * (passo + 1)] = 0;
    pixels.copy(bruto, y * (passo + 1) + 1, y * passo, (y + 1) * passo);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;
  ihdr[9] = tipoDeCor;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    ASSINATURA,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(bruto, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Le largura e altura do IHDR sem decodificar a imagem.
 *
 * E o que a verificacao de assets usa: ela precisa saber se `icon-192x192.png`
 * tem mesmo 192 pixels, e inflar o IDAT de todos os arquivos so para isso seria
 * desperdicio. Devolve `null` quando o arquivo nao e PNG -- que e exatamente o
 * caso que originou tudo isto (SVG com nome `.png`).
 */
export function lerDimensoes(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(ASSINATURA)) return null;
  if (buffer.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return { largura: buffer.readUInt32BE(16), altura: buffer.readUInt32BE(20) };
}

// ---------------------------------------------------------------------------
// Operacoes de imagem
// ---------------------------------------------------------------------------

/** Cor de um pixel, como array de `canais` bytes. */
function pixelEm(img, x, y) {
  const i = (y * img.largura + x) * img.canais;
  return img.pixels.subarray(i, i + img.canais);
}

/**
 * Reducao por media de area (box filter).
 *
 * NAO e vizinho mais proximo de proposito: a origem tem 1024px e o menor icone
 * tem 16px, uma reducao de 64x. Amostrar um unico pixel a cada 64 faria o
 * contorno do gato aparecer e sumir conforme o alinhamento, e o icone de 16px
 * poderia cair inteiro numa regiao de fundo -- um quadrado creme liso.
 */
export function redimensionar(img, larguraAlvo, alturaAlvo) {
  const saida = Buffer.alloc(larguraAlvo * alturaAlvo * img.canais);
  const escalaX = img.largura / larguraAlvo;
  const escalaY = img.altura / alturaAlvo;

  for (let y = 0; y < alturaAlvo; y++) {
    const y0 = Math.floor(y * escalaY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * escalaY));

    for (let x = 0; x < larguraAlvo; x++) {
      const x0 = Math.floor(x * escalaX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * escalaX));

      const soma = new Array(img.canais).fill(0);
      let n = 0;

      for (let sy = y0; sy < Math.min(y1, img.altura); sy++) {
        for (let sx = x0; sx < Math.min(x1, img.largura); sx++) {
          const p = pixelEm(img, sx, sy);
          for (let c = 0; c < img.canais; c++) soma[c] += p[c];
          n++;
        }
      }

      const i = (y * larguraAlvo + x) * img.canais;
      for (let c = 0; c < img.canais; c++) saida[i + c] = Math.round(soma[c] / n);
    }
  }

  return { largura: larguraAlvo, altura: alturaAlvo, canais: img.canais, pixels: saida };
}

/** Recorta um retangulo. */
export function recortar(img, x, y, largura, altura) {
  if (x < 0 || y < 0 || x + largura > img.largura || y + altura > img.altura) {
    throw new Error("recorte fora dos limites da imagem");
  }

  const saida = Buffer.alloc(largura * altura * img.canais);
  for (let ly = 0; ly < altura; ly++) {
    const origem = ((y + ly) * img.largura + x) * img.canais;
    img.pixels.copy(saida, ly * largura * img.canais, origem, origem + largura * img.canais);
  }
  return { largura, altura, canais: img.canais, pixels: saida };
}

/** Uma tela chapada da cor dada. */
export function telaLisa(largura, altura, cor) {
  const canais = cor.length;
  const pixels = Buffer.alloc(largura * altura * canais);
  for (let i = 0; i < largura * altura; i++) {
    for (let c = 0; c < canais; c++) pixels[i * canais + c] = cor[c];
  }
  return { largura, altura, canais, pixels };
}

/** Desenha `frente` sobre `fundo` na posicao dada (sem mistura alfa). */
export function sobrepor(fundo, frente, x, y) {
  if (fundo.canais !== frente.canais) throw new Error("canais diferentes ao sobrepor");
  const pixels = Buffer.from(fundo.pixels);

  for (let ly = 0; ly < frente.altura; ly++) {
    const dy = y + ly;
    if (dy < 0 || dy >= fundo.altura) continue;
    const destino = (dy * fundo.largura + x) * fundo.canais;
    const origem = ly * frente.largura * frente.canais;
    frente.pixels.copy(pixels, destino, origem, origem + frente.largura * frente.canais);
  }

  return { largura: fundo.largura, altura: fundo.altura, canais: fundo.canais, pixels };
}

/**
 * Menor retangulo que contem tudo que difere da cor de fundo.
 *
 * O logo de origem e LARGO e fica acima do centro da tela de 1024 -- reduzir a
 * imagem inteira para 192px daria um icone com o gato pequeno e torto, cercado
 * de creme. Enquadrar pelo conteudo e o que faz o icone parecer desenhado para
 * o tamanho em vez de sobra de outro arquivo.
 */
export function caixaDoConteudo(img, corDeFundo, tolerancia = 30) {
  let minX = img.largura;
  let minY = img.altura;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < img.altura; y++) {
    for (let x = 0; x < img.largura; x++) {
      const p = pixelEm(img, x, y);
      let diferenca = 0;
      // So os tres canais de cor: um logo com alfa teria o canal 4 variando
      // onde a cor nao varia, e a caixa viraria a imagem inteira.
      for (let c = 0; c < 3; c++) diferenca += Math.abs(p[c] - corDeFundo[c]);

      if (diferenca > tolerancia) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null; // imagem inteiramente da cor de fundo
  return { x: minX, y: minY, largura: maxX - minX + 1, altura: maxY - minY + 1 };
}

/**
 * As faixas horizontais de conteudo, separadas por linhas inteiras de fundo.
 *
 * Serve para separar o SIMBOLO do WORDMARK sem ninguem escrever a coordenada
 * do corte na mao. No logo atual devolve duas faixas -- o gato com o grafico
 * (151..630) e o texto "PULO DO GATO" (682..769), com 51 linhas de fundo entre
 * elas. Se o logo for redesenhado, o corte acompanha; uma constante escrita a
 * mao passaria a cortar no meio do desenho, e em silencio.
 */
export function faixasHorizontais(img, corDeFundo, tolerancia = 30) {
  const faixas = [];
  let inicio = -1;

  for (let y = 0; y < img.altura; y++) {
    let temTinta = false;

    for (let x = 0; x < img.largura && !temTinta; x++) {
      const p = pixelEm(img, x, y);
      let diferenca = 0;
      for (let c = 0; c < 3; c++) diferenca += Math.abs(p[c] - corDeFundo[c]);
      if (diferenca > tolerancia) temTinta = true;
    }

    if (temTinta && inicio < 0) inicio = y;
    if (!temTinta && inicio >= 0) {
      faixas.push({ y: inicio, altura: y - inicio });
      inicio = -1;
    }
  }

  if (inicio >= 0) faixas.push({ y: inicio, altura: img.altura - inicio });
  return faixas;
}

/**
 * Enquadra o conteudo num quadrado de `lado`, ocupando `ocupacao` da aresta.
 *
 * `ocupacao` e o que separa os dois tipos de icone exigidos pelo Android:
 *
 *   purpose "any"      -> a tela inteira e o icone; ocupacao alta (0.92)
 *   purpose "maskable" -> o sistema RECORTA a tela na forma que quiser
 *                         (circulo, quadrado arredondado, gota). So o circulo
 *                         central de 80% do lado e garantido. Conteudo fora
 *                         dali e cortado -- por isso o maskable usa 0.6, e nao
 *                         porque "ficou melhor com margem".
 *
 * Declarar o mesmo arquivo como "any maskable", que e o que o manifest fazia,
 * garante que um dos dois sai errado: ou sobra moldura no icone normal, ou o
 * gato perde as orelhas no adaptativo.
 */
export function enquadrarEmQuadrado(img, caixa, lado, ocupacao, corDeFundo) {
  const conteudo = recortar(img, caixa.x, caixa.y, caixa.largura, caixa.altura);

  const disponivel = lado * ocupacao;
  const escala = Math.min(disponivel / conteudo.largura, disponivel / conteudo.altura);

  // Pelo menos 1px em cada lado: um icone de 16px com ocupacao 0.6 daria menos
  // de 1 pixel numa dimensao, e `redimensionar` com alvo 0 devolve buffer vazio.
  const largura = Math.max(1, Math.round(conteudo.largura * escala));
  const altura = Math.max(1, Math.round(conteudo.altura * escala));

  const reduzido = redimensionar(conteudo, largura, altura);
  const tela = telaLisa(lado, lado, corDeFundo);

  return sobrepor(
    tela,
    reduzido,
    Math.round((lado - largura) / 2),
    Math.round((lado - altura) / 2)
  );
}
