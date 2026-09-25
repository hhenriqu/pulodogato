// =====================================================
// TESTES DO CODEC PNG
// =====================================================
//   npm run test:png
//
// A imagem de origem do projeto (`public/logo_pulodogato.png`) e usada como
// corpo de prova em varios testes, e de proposito: ela foi produzida por OUTRO
// codificador e usa os filtros de linha 1 (Sub), 2 (Up) e 4 (Paeth). Um teste
// que so leia o que este mesmo arquivo escreveu nunca exercita a desfiltragem
// de verdade -- codificamos tudo com filtro 0.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import {
  decodificarPNG,
  codificarPNG,
  lerDimensoes,
  redimensionar,
  recortar,
  telaLisa,
  sobrepor,
  caixaDoConteudo,
  faixasHorizontais,
  enquadrarEmQuadrado,
} from "./png.mjs";

const LOGO = "public/logo_pulodogato.png";

/** Monta um PNG a partir do IHDR e do fluxo de linhas JA filtrado. */
function montarPNG(ihdr, brutoFiltrado) {
  const crcTab = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTab[n] = c;
  }
  const crc = (b) => {
    let c = 0xffffffff;
    for (const byte of b) c = crcTab[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (tipo, dados) => {
    const tam = Buffer.alloc(4);
    tam.writeUInt32BE(dados.length, 0);
    const corpo = Buffer.concat([Buffer.from(tipo), dados]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(corpo), 0);
    return Buffer.concat([tam, corpo, c]);
  };

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(brutoFiltrado)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Decodificacao
// ---------------------------------------------------------------------------

test("decodifica um PNG produzido por outro codificador", () => {
  const img = decodificarPNG(readFileSync(LOGO));
  assert.equal(img.largura, 1024);
  assert.equal(img.altura, 1024);
  assert.equal(img.canais, 3);
  assert.equal(img.pixels.length, 1024 * 1024 * 3);
});

test("ida e volta preserva os pixels exatamente", () => {
  // ATENCAO ao que este teste NAO prova. Ele compara `decode(logo)` com
  // `decode(encode(decode(logo)))`: os dois lados passam pelo mesmo
  // decodificador, e o `encode` do meio grava com filtro 0. Um erro na
  // DESFILTRAGEM se cancela aqui e o teste continua verde -- verificado
  // mutando o desempate do Paeth, que sobreviveu a esta afirmacao.
  //
  // O que ele prova e so a consistencia entre codificador e decodificador. Quem
  // cobre a desfiltragem contra valor conhecido e o teste do Paeth mais abaixo.
  const original = decodificarPNG(readFileSync(LOGO));
  const devolta = decodificarPNG(codificarPNG(original));

  assert.equal(devolta.largura, original.largura);
  assert.equal(devolta.canais, original.canais);
  assert.ok(devolta.pixels.equals(original.pixels), "os pixels mudaram na ida e volta");
});

test("o desempate do filtro Paeth segue a ordem normativa a > b > c", () => {
  // Corpo de prova montado byte a byte, com o resultado calculado na mao --
  // e a unica forma de pegar erro de desfiltragem, porque qualquer teste de
  // ida e volta usa o mesmo codigo nas duas pontas e cancela o erro.
  //
  // Imagem 2x2 RGB. A linha 0 vai com filtro 0; a linha 1, com filtro 4.
  // Para o ultimo pixel os vizinhos sao a=esquerda=11, b=acima=8, c=diagonal=10.
  //   p  = a + b - c = 9
  //   pa = |p-a| = 2,  pb = |p-b| = 1,  pc = |p-c| = 1
  // Com `pb <= pc` (normativo) o predito e b=8. Trocar para `pb < pc` escolhe
  // c=10 -- dois valores diferentes, e nenhum erro em lugar nenhum.
  const bruto = Buffer.from([
    0, 10, 10, 10, 8, 8, 8, // linha 0, filtro None
    4, 1, 1, 1, 0, 0, 0,    // linha 1, filtro Paeth
  ]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 2; // RGB

  const png = montarPNG(ihdr, bruto);
  const img = decodificarPNG(png);

  assert.deepEqual(
    [...img.pixels],
    [10, 10, 10, 8, 8, 8, 11, 11, 11, 8, 8, 8],
    "o ultimo pixel denuncia o desempate: 8 = escolheu b (certo), 10 = escolheu c"
  );
});

test("recusa um SVG com nome de PNG", () => {
  // O bug que originou tudo isto. A recusa precisa ser um ERRO, nao uma imagem
  // vazia: `generate-pwa-icons` le a origem com esta funcao, e uma imagem vazia
  // geraria 20 icones em branco sem ninguem notar.
  const svg = Buffer.from(
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"><svg viewBox="0 0 512 512"></svg>'
  );
  assert.throws(() => decodificarPNG(svg), /assinatura ausente/);
});

test("recusa profundidade, colorType e entrelacamento fora do escopo", () => {
  const base = codificarPNG(telaLisa(4, 4, [1, 2, 3]));

  const comProfundidade16 = Buffer.from(base);
  comProfundidade16[24] = 16;
  assert.throws(() => decodificarPNG(comProfundidade16), /profundidade 16/);

  const comPaleta = Buffer.from(base);
  comPaleta[25] = 3; // colorType 3 = paleta
  assert.throws(() => decodificarPNG(comPaleta), /colorType 3/);

  const entrelacado = Buffer.from(base);
  entrelacado[28] = 1;
  assert.throws(() => decodificarPNG(entrelacado), /entrelacado/);
});

test("lerDimensoes devolve null para nao-PNG e nao lanca", () => {
  // O guard chama isto em todo arquivo declarado, inclusive nos que estao
  // quebrados. Se lancasse, o guard morreria no primeiro problema e reportaria
  // um, escondendo os outros treze.
  assert.equal(lerDimensoes(Buffer.from("<!DOCTYPE svg ...")), null);
  assert.equal(lerDimensoes(Buffer.alloc(4)), null);
  assert.deepEqual(lerDimensoes(codificarPNG(telaLisa(7, 11, [0, 0, 0]))), {
    largura: 7,
    altura: 11,
  });
});

// ---------------------------------------------------------------------------
// Operacoes
// ---------------------------------------------------------------------------

test("redimensionar faz MEDIA de area, nao vizinho mais proximo", () => {
  // Tabuleiro 2x2 de preto e branco reduzido a 1x1. A media da 127/128;
  // vizinho mais proximo daria 0 ou 255. E a diferenca entre o icone de 16px
  // mostrar o gato e mostrar um quadrado de uma cor so.
  const img = { largura: 2, altura: 2, canais: 3, pixels: Buffer.from([
    0, 0, 0,  255, 255, 255,
    255, 255, 255,  0, 0, 0,
  ])};

  const r = redimensionar(img, 1, 1);
  assert.equal(r.largura, 1);
  assert.ok(Math.abs(r.pixels[0] - 128) <= 1, `esperava ~128, veio ${r.pixels[0]}`);
});

test("redimensionar nunca produz linha ou coluna vazia", () => {
  // Alvo maior que a origem, e alvo de 1px: os dois casos em que um `x1` mal
  // calculado devolveria zero amostras e dividiria por zero (NaN -> pixel 0).
  for (const [w, h] of [[1, 1], [3, 3], [8, 5], [13, 2]]) {
    const r = redimensionar(telaLisa(4, 4, [200, 100, 50]), w, h);
    assert.equal(r.pixels.length, w * h * 3);
    for (let i = 0; i < r.pixels.length; i += 3) {
      assert.deepEqual([r.pixels[i], r.pixels[i + 1], r.pixels[i + 2]], [200, 100, 50]);
    }
  }
});

test("caixaDoConteudo ignora a moldura de fundo", () => {
  const img = telaLisa(10, 10, [250, 250, 250]);
  // Um unico pixel escuro em (3,4).
  const i = (4 * 10 + 3) * 3;
  img.pixels[i] = img.pixels[i + 1] = img.pixels[i + 2] = 0;

  assert.deepEqual(caixaDoConteudo(img, [250, 250, 250]), {
    x: 3,
    y: 4,
    largura: 1,
    altura: 1,
  });
});

test("caixaDoConteudo devolve null numa imagem de cor unica", () => {
  // O gerador transforma isso em erro. Sem o null explicito, a caixa viria com
  // largura negativa e `recortar` estouraria com uma mensagem sem relacao com
  // a causa.
  assert.equal(caixaDoConteudo(telaLisa(8, 8, [10, 20, 30]), [10, 20, 30]), null);
});

test("faixasHorizontais separa o simbolo do wordmark no logo real", () => {
  const img = decodificarPNG(readFileSync(LOGO));
  const fundo = Array.from(img.pixels.subarray(0, 3));
  const faixas = faixasHorizontais(img, fundo);

  assert.equal(faixas.length, 2, "o logo tem simbolo e texto, separados por fundo");
  const [simbolo, texto] = faixas;
  assert.ok(simbolo.altura > texto.altura, "a faixa de cima e o desenho, a maior");
  assert.ok(
    simbolo.y + simbolo.altura < texto.y,
    "as faixas nao podem se encostar -- e a separacao que define o corte"
  );
});

test("sobrepor nao vaza fora dos limites do fundo", () => {
  const fundo = telaLisa(4, 4, [0, 0, 0]);
  const frente = telaLisa(2, 2, [255, 255, 255]);
  const r = sobrepor(fundo, frente, 1, 3); // a segunda linha cai fora

  assert.equal(r.pixels.length, 4 * 4 * 3);
  // linha 3, colunas 1 e 2 pintadas
  assert.equal(r.pixels[(3 * 4 + 1) * 3], 255);
  assert.equal(r.pixels[(3 * 4 + 2) * 3], 255);
  // coluna 0 da mesma linha intacta
  assert.equal(r.pixels[(3 * 4 + 0) * 3], 0);
});

test("recortar recusa retangulo fora da imagem", () => {
  const img = telaLisa(4, 4, [0, 0, 0]);
  assert.throws(() => recortar(img, 2, 2, 4, 4), /fora dos limites/);
  assert.throws(() => recortar(img, -1, 0, 2, 2), /fora dos limites/);
});

// ---------------------------------------------------------------------------
// Enquadramento
// ---------------------------------------------------------------------------

test("enquadrarEmQuadrado centraliza e respeita a ocupacao", () => {
  const origem = telaLisa(100, 100, [250, 250, 250]);
  // Uma barra escura de 40x20 em (30,40).
  for (let y = 40; y < 60; y++) {
    for (let x = 30; x < 70; x++) {
      const i = (y * 100 + x) * 3;
      origem.pixels[i] = origem.pixels[i + 1] = origem.pixels[i + 2] = 0;
    }
  }

  const caixa = caixaDoConteudo(origem, [250, 250, 250]);
  assert.deepEqual(caixa, { x: 30, y: 40, largura: 40, altura: 20 });

  const r = enquadrarEmQuadrado(origem, caixa, 100, 0.5, [250, 250, 250]);
  assert.equal(r.largura, 100);
  assert.equal(r.altura, 100);

  const dentro = caixaDoConteudo(r, [250, 250, 250]);
  // 50px disponiveis / 40 de largura = escala 1.25 -> 50x25, centrado.
  assert.equal(dentro.largura, 50);
  assert.equal(dentro.altura, 25);
  assert.equal(dentro.x, 25);
  assert.ok(Math.abs(dentro.y - 37) <= 1, `esperava y ~37, veio ${dentro.y}`);
});

test("ocupacao maskable cabe no circulo de seguranca de 80%", () => {
  // O Android recorta o maskable em qualquer forma; so o circulo central de 80%
  // da aresta e garantido. Este teste mede o canto mais distante do desenho e
  // exige que ele caiba nesse circulo -- e o que separa "tem margem" de "tem a
  // margem CERTA".
  const origem = decodificarPNG(readFileSync(LOGO));
  const fundo = Array.from(origem.pixels.subarray(0, 3));
  const caixa = caixaDoConteudo(origem, fundo);

  const lado = 192;
  const r = enquadrarEmQuadrado(origem, caixa, lado, 0.56, fundo);
  const dentro = caixaDoConteudo(r, fundo);

  const centro = lado / 2;
  const cantos = [
    [dentro.x, dentro.y],
    [dentro.x + dentro.largura, dentro.y],
    [dentro.x, dentro.y + dentro.altura],
    [dentro.x + dentro.largura, dentro.y + dentro.altura],
  ];

  const raioSeguro = lado * 0.4; // circulo de diametro 80% da aresta
  for (const [x, y] of cantos) {
    const d = Math.hypot(x - centro, y - centro);
    assert.ok(
      d <= raioSeguro,
      `canto (${x},${y}) esta a ${d.toFixed(1)}px do centro, acima do raio seguro ${raioSeguro}`
    );
  }
});

test("enquadrar em tamanho minusculo nao produz imagem vazia", () => {
  // O piso de 1px so entra em acao quando o arredondamento daria ZERO. Com
  // ocupacao 0.05 num lado de 16 o resultado ainda e 1px por arredondamento,
  // e o teste passava sem exercitar o piso -- conferido mutando o `Math.max`,
  // que sobreviveu aquela versao. Em 0.02 a conta da 0.32 e 0.25, que
  // arredondam para zero: sem o piso, `redimensionar` devolve buffer vazio e
  // o icone sai em branco.
  const origem = decodificarPNG(readFileSync(LOGO));
  const fundo = Array.from(origem.pixels.subarray(0, 3));
  const caixa = caixaDoConteudo(origem, fundo);

  const r = enquadrarEmQuadrado(origem, caixa, 16, 0.02, fundo);
  assert.equal(r.pixels.length, 16 * 16 * 3);
  assert.notEqual(caixaDoConteudo(r, fundo), null, "o desenho sumiu inteiro");
});
