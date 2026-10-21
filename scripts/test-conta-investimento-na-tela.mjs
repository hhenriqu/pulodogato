// =====================================================
// O CARTAO DA CONTA INVESTIMENTO, EM CHROMIUM -- HMO-438 (F4 da HMO-432)
// =====================================================
//   npm run test:conta-investimento-na-tela
//
// O QUE ESTA SUITE PROVA
// ----------------------
//   A. AS TRES LINHAS APARECEM, cada uma com o seu numero. A assercao e sobre
//      as ancoras (`data-linha`, `data-valor`) e nao sobre o texto do cartao:
//      "Aplicado" e um valor em reais aparecem em varios lugares da tela, e uma
//      assercao sobre o texto todo continuaria VERDE com uma das tres linhas
//      apagada. Ver `sumido-da-tela-pode-ser-so-indistinguivel`.
//
//   B. QUAL DELAS CONTA ESTA DITO, e dito em TEXTO. `data-entra-no-patrimonio`
//      e "sim" nas duas primeiras e "nao" na terceira, e a frase "nao entra no
//      patrimonio" sai no textContent. Uma feature que separa dois estados e
//      os pinta com cores diferentes nao separa nada para quem le a tela em
//      preto e branco.
//
//   C. A CONTA SEM ATIVO ATRELADO FICA IDENTICA AO DE HOJE. O componente nao
//      rende NODE NENHUM com `carteira: null` -- `innerHTML` vazio, nao um
//      bloco discreto nem um `hidden`. `hidden` nao serviria: o texto continua
//      no `textContent`, e a assercao e exatamente sobre isso.
//
//      O CONTROLE POSITIVO VIVE NA MESMA PAGINA: a raiz do caso A tem conteudo.
//      Sem ele, um componente que devolvesse `null` SEMPRE passaria em C -- e
//      passaria justamente no caso em que a feature inteira desapareceu.
//
//   D. O RECORTE DO IPHONE, EM PIXELS, em 390 E em 320. Tres linhas num cartao
//      e onde o scroll horizontal aparece, e a issue pede medida e nao classe.
//
// O CSS E UM ESBOCO DECLARADO, E O LIMITE DELE IMPORTA
// ---------------------------------------------------
// A pagina da sonda nao carrega Tailwind -- as sondas irmas deste repo medem
// layout SEM folha de estilo, onde `flex` e `truncate` nao fazem nada e todo
// texto quebra sozinho. Uma medida assim nunca acusaria o defeito que a HMO-185
// achou em producao, que e precisamente uma linha `flex` que NAO encolhe.
//
// Entao aqui vai um `<style>` com as oito utilitarias deste componente que
// afetam a LARGURA (`flex`, `items-baseline`, `justify-between`, `gap-2`,
// `min-w-0`, `truncate`, `shrink-0`, `block`), escritas a mao a partir do que o
// Tailwind gera para cada uma. As outras que ele usa sao verticais ou de cor
// (`space-y-2`, `border-t`, `pt-3`, `text-xs`, `tabular-nums`, os tokens de
// cor) e nao mudam medida horizontal nenhuma -- ficam fora.
//
// Isso torna a medida REAL para o mecanismo de que o componente depende -- e e
// tudo o que ela e. O que a sonda NAO prova: que o Tailwind de verdade emite
// exatamente isto, e que o cartao INTEIRO (que vive no `page.tsx`, com
// `next/navigation` e Radix dentro) cabe. A guarda de classe que roda em todo
// PR continua sendo `npm run test:mobile-overflow`.
//
// O NOME DA CLASSE ENTRA NO CSS POR LISTA EXPLICITA, e nao por regex sobre o
// componente: um seletor gerado a partir do proprio fonte casaria com qualquer
// classe nova sem ninguem decidir nada, e a medida passaria a depender de um
// CSS que a sonda inventou no caminho.
//
// A PARTE PURA NAO USA NAVEGADOR
// ------------------------------
// `comporCarteiraPorConta` e aritmetica de encaminhamento e e medida no node,
// no fim do arquivo -- inclusive o caso que a issue nomeia: a rota do rendimento
// falhou, a carteira sai PELO CUSTO e `rendimentoIndisponivel` liga. Isso nao
// precisa de DOM, e meter no navegador so o tornaria mais lento e mais fragil.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SAIDA = ".tmp-conta-investimento-na-tela";

/**
 * Acha um Chromium: o do `CHROMIUM_BIN`, o que o Playwright baixou, ou o Chrome
 * do sistema.
 *
 * A VERSAO DO PLAYWRIGHT NAO ESTA FIXA AQUI. Quatro sondas antigas tinham
 * `chromium-1243` escrito no fonte, e o dia em que a maquina subiu para a 1248
 * as quatro ficaram vermelhas numa arvore intocada. A pasta e VARRIDA: qualquer
 * `chromium-*` serve.
 */
function acharChromium() {
  const candidatos = [process.env.CHROMIUM_BIN];

  for (const base of [
    `${process.env.HOME}/.cache/ms-playwright`,
    "/paperclip/.cache/ms-playwright",
  ]) {
    if (!existsSync(base)) continue;
    let pastas = [];
    try {
      pastas = readdirSync(base);
    } catch {
      pastas = [];
    }
    for (const dir of pastas) {
      if (!/^chromium/.test(dir)) continue;
      // `chrome-linux64` e o layout atual (medido: a 1248 desta maquina usa
      // ele); `chrome-linux` e o antigo. O headless shell vem num pacote
      // PROPRIO (`chromium_headless_shell-*`), com um terceiro layout -- o
      // regex `^chromium` alcanca os dois pacotes e os tres sufixos cobrem o
      // que cada um instala.
      for (const sufixo of [
        "chrome-linux64/chrome",
        "chrome-linux/chrome",
        "chrome-headless-shell-linux64/chrome-headless-shell",
      ]) {
        candidatos.push(join(base, dir, sufixo));
      }
    }
  }

  candidatos.push(
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  );

  return candidatos.find((c) => c && existsSync(c)) ?? null;
}

const SEM_NAVEGADOR =
  "Nenhum Chromium encontrado. Aponte CHROMIUM_BIN para um binario, " +
  "ou instale com `npx playwright install chromium`.";

const ALVO = join(
  SAIDA,
  "components/contas/CarteiraDaContaDeInvestimento.js"
);
if (!existsSync(ALVO)) {
  throw new Error(
    `${ALVO} nao existe. Rode por \`npm run test:conta-investimento-na-tela\`, ` +
      "que e quem compila o componente antes do teste."
  );
}

/**
 * `formatarValor` DE PRODUCAO, do JS compilado -- e o esperado das assercoes de
 * valor. Ver o bloco A2.
 */
const { formatarValor } = await import(`../${SAIDA}/lib/dinheiro.js`);

/**
 * O espaco depois do `R$`, normalizado nos DOIS lados da comparacao.
 *
 * `--dump-dom` serializa o textContent como HTML, e o Chromium escreve
 * `&nbsp;` para um espaco COMUM quando quer preservar o espacamento -- entao a
 * entidade no dump e ambigua: ela pode ter nascido de um U+00A0 de verdade ou
 * de um espaco que o serializador resolveu proteger.
 *
 * `formatarValor` deste app usa espaco comum (medido: codigo 32, e ele e
 * escrito a mao em lib/dinheiro.ts, nao sai de `Intl`). Em vez de apostar em
 * qual dos dois bytes atravessa o dump, as duas pontas sao normalizadas: o que
 * esta sob teste e qual CAMPO caiu em qual linha, nunca qual espaco o
 * serializador escolheu. Ver `intl-pt-br-separa-o-real-com-nbsp` para o caso
 * em que esse byte importa -- ali a funcao e outra.
 */
const semNbsp = (s) =>
  s === null ? null : String(s).replace(/\u00A0/g, " ");

/** Tira so a fiacao de modulo, deixando o corpo das funcoes intacto. */
const paraScriptClassico = (fonte) =>
  fonte
    // O `import` emitido pelo tsc ocupa mais de uma linha quando a lista de
    // nomes e longa: o recorte e do `import` ate o `;`, nao de uma linha so.
    .replace(/^import\s[\s\S]*?;$/gm, "")
    // O `export { A, B };` de fim de arquivo, INTEIRO e antes da regra de
    // baixo: tirar so a palavra deixaria `{ A, B };`, que e SyntaxError.
    .replace(/^export\s*\{[^}]*\}\s*;$/gm, "")
    .replace(/^export /gm, "")
    .replace(/^"use client";$/gm, "");

// ORDEM DE DEPENDENCIA. Nao e exigencia do JavaScript para funcao declarada
// (ela e icada), mas e para `const` de modulo -- e estes arquivos tem varios.
const PARTES = [
  "lib/dinheiro.js",
  "lib/data-digitada.js",
  "lib/data-na-tela.js",
  "components/contas/CarteiraDaContaDeInvestimento.js",
];

const producao = PARTES.map((parte) => {
  const fonte = paraScriptClassico(readFileSync(join(SAIDA, parte), "utf8"));

  const sobra = fonte.match(/^\s*(import|export)\s.*$/m);
  if (sobra) {
    throw new Error(
      `sobrou fiacao de modulo em ${parte}: ${sobra[0].trim()}\n` +
        "ajuste paraScriptClassico()"
    );
  }

  try {
    new Function(fonte);
  } catch (e) {
    throw new Error(
      `${parte} nao parseia depois do strip: ${e.message}\n` +
        "ajuste paraScriptClassico()"
    );
  }

  return fonte;
}).join("\n");

try {
  new Function(producao);
} catch (e) {
  throw new Error(
    `as partes juntas nao parseiam: ${e.message}\n` +
      "provavelmente duas delas declaram o mesmo nome no topo"
  );
}

/** O React UMD, inline: `<script src>` entre arquivos file:// e outra briga. */
const umd = (pacote, arquivo) =>
  readFileSync(join("node_modules", pacote, "umd", arquivo), "utf8");

// --- o fixture, do lado do node ----------------------------------------------
//
// Os numeros vivem AQUI e sao comparados com o que saiu da tela: um literal
// escrito nos dois lugares e o que torna a comparacao real. E eles sao
// DIFERENTES uns dos outros de proposito -- com `principal` igual a
// `rendimento`, uma linha lendo o campo errado passaria verde.
const APLICADO = 10000;
const RENDIMENTO = 1234.56;
const VALOR = APLICADO + RENDIMENTO;
/** Diferente do valor da carteira: e o numero que PAROU de contar. */
const SALDO_INFORMADO = 9000.5;
const ATUALIZADA_EM = "2026-10-18T13:45:00.000Z";

const CARTEIRA = {
  valor: VALOR,
  principal: APLICADO,
  rendimento: RENDIMENTO,
  semRendimento: 0,
};

// O CASO DO RECORTE (D), E POR QUE OS NUMEROS SAO ABSURDOS
// --------------------------------------------------------
// NAO MEXA nestes valores para baixo sem reler isto. Este componente nao tem
// texto livre: os rotulos sao fixos ("Aplicado", "Rendimento", "Saldo
// informado"), e texto fixo e curto QUEBRA sozinho em qualquer largura. Com um
// fixture modesto, D passava com o `min-w-0`/`truncate` E TAMBEM SEM eles --
// medido, por mutante: a linha nao precisava encolher, entao a medida nao
// falava do mecanismo que o componente usa para caber.
//
// O que estoura uma linha destas e o VALOR: "R$ 9.876.543.210.987,65" e um
// token sem espaco, e ele e `shrink-0`. Com um numero deste tamanho, o rotulo
// ao lado PRECISA encolher para a linha caber em 320px -- e ai a medida vira
// uma medida de verdade: tirar o `truncate` do rotulo reprova D320 (medido).
//
// D390 continua passando sem o `truncate`, e e por isso que as duas larguras
// sao medidas: 320 e a apertada, e uma sonda so em 390 nao teria dente nenhum.
const MUITO_GRANDE = 9876543210987.65;
const CARTEIRA_GRANDE = {
  valor: MUITO_GRANDE,
  principal: 8765432109876.54,
  rendimento: 1111111101111.11,
  // `1` liga a nota "um papel ainda nao rende" -- a mais comprida das duas, e
  // uma linha a mais para a medida de D atravessar.
  semRendimento: 1,
};

/**
 * O CSS que a pagina injeta -- as oito utilitarias, a mao. Ver o cabecalho.
 *
 * `box-sizing: border-box` no `*` porque e o preflight do Tailwind que faz
 * isso, e sem ele o `padding` da caixa de medida somaria a largura e a medida
 * acusaria estouro que o app nao tem.
 */
const css = (larguraDoCartao) => `
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: sans-serif; font-size: 16px; }
.flex { display: flex; }
.items-baseline { align-items: baseline; }
.justify-between { justify-content: space-between; }
.gap-2 { gap: 0.5rem; }
.min-w-0 { min-width: 0px; }
.shrink-0 { flex-shrink: 0; }
.block { display: block; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cartao { width: ${larguraDoCartao}px; padding: 1.5rem; }
`;

/**
 * A LARGURA MEDIDA VEM DO CSS, E NAO DE `--window-size`.
 *
 * MEDIDO nesta maquina: com `--window-size=390,844` o `window.innerWidth` do
 * headless responde 500 de todo jeito. Uma sonda que confiasse na janela
 * mediria 500 nas duas voltas, e os dois casos de D passariam falando da MESMA
 * tela -- verde, sem medir nada do que a issue pede.
 *
 * Entao a largura e cravada na caixa, e derivada assim:
 *
 *   viewport do aparelho  390 (iPhone 12/13/14) e 320 (iPhone SE)
 *   - 32px                o `px-4` do `<main>` do painel, dos dois lados
 *                         (app/(dashboard)/layout.tsx)
 *   = a largura do CARTAO, porque a grade de /dashboard/contas tem UMA coluna
 *     nessas duas larguras (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`).
 *
 * O padding de 24px do `<Card>` fica DENTRO dessa largura por `border-box`, que
 * e o que o preflight do Tailwind faz -- sem ele o padding somaria por fora e a
 * medida acusaria um estouro que o app nao tem. A borda ficou fora da caixa de
 * proposito: ela tiraria 2px do `clientWidth` e poria uma constante a mais
 * entre a conta acima e o que se mede.
 */
const LARGURA_DO_CARTAO = { 390: 390 - 32, 320: 320 - 32 };

const paginaCom = (larguraDoCartao) => `<!doctype html>
<html><head><meta charset="utf-8"><style>${css(
  larguraDoCartao
)}</style></head><body>
<div id="raiz-com" class="cartao"></div>
<div id="raiz-sem" class="cartao"></div>
<div id="raiz-grande" class="cartao"></div>
<div id="resultado">a pagina nao rodou</div>
<script>${umd("react", "react.development.js")}</script>
<script>${umd("react-dom", "react-dom.development.js")}</script>
<script>
// UM UNICO <script>: o codigo de producao resolve os hooks por NOME no momento
// da chamada, e dentro de uma funcao eles passariam a ser locais DELA -- o erro
// seria \`ReferenceError: useState is not defined\` no meio do primeiro render.
const { useCallback, useEffect, useMemo, useRef, useState } = React;

// A PONTE DO JSX RUNTIME.
//
// \`jsx: react-jsx\` emite \`import { jsx as _jsx, jsxs as _jsxs } from
// "react/jsx-runtime"\`, e esse import e removido por \`paraScriptClassico\` --
// num script classico o modulo nao existe. Os nomes aqui sao \`_jsx\`/\`_jsxs\`
// (com sublinhado) porque e assim que o tsc os CHAMA no corpo; definir \`jsx\`
// sem sublinhado deixaria \`_jsx is not defined\` no primeiro render, e o
// sintoma -- a pagina reportando ERRO -- nao aponta para o nome.
//
// Nao e esboco de comportamento: \`createElement\` recebe os MESMOS argumentos,
// com a key separada das props. \`_jsxs\` (varios filhos) e o mesmo que \`_jsx\`
// aqui porque \`createElement\` aceita um array de children do mesmo jeito.
const _jsx = function (tipo, props, key) {
  const { children, ...resto } = props || {};
  if (key !== undefined) resto.key = key;
  return React.createElement(tipo, resto, children);
};
const _jsxs = _jsx;

// --- o codigo de producao, intacto -------------------------------------------
${producao}

// --- a sonda ------------------------------------------------------------------
try {
  const out = {};

  /**
   * \`scrollWidth > clientWidth\` e o criterio de
   * \`scripts/probe-mobile-overflow.mjs\`: se o conteudo e mais largo do que a
   * caixa, a tela anda para o lado.
   *
   * A medida e da RAIZ e nao do \`documentElement\`: a \`<div id="resultado">\`
   * guarda um JSON que estouraria a largura e reprovaria tudo por causa da
   * propria sonda.
   */
  function recorteDe(raiz) {
    return {
      scrollWidth: raiz.scrollWidth,
      clientWidth: raiz.clientWidth,
      // O mais largo que passar da borda, COM O NOME -- transforma "a tela
      // esta torta" em um alvo.
      estourando: Array.from(raiz.querySelectorAll("*"))
        .filter(function (el) {
          return el.getBoundingClientRect().right > raiz.clientWidth + 1;
        })
        .slice(0, 5)
        .map(function (el) {
          return el.tagName + "." + String(el.className).slice(0, 60);
        }),
    };
  }

  /** As linhas de um bloco, por ancora: o que a tela mostra em cada uma. */
  function linhasDe(raiz) {
    return Array.from(raiz.querySelectorAll("[data-linha]")).map(function (el) {
      const valor = el.querySelector("[data-valor]");
      return {
        ancora: el.getAttribute("data-linha"),
        entra: el.getAttribute("data-entra-no-patrimonio"),
        valor: valor ? valor.textContent : null,
      };
    });
  }

  const comAtivo = document.getElementById("raiz-com");
  ReactDOM.render(
    React.createElement(CarteiraDaContaDeInvestimento, {
      carteira: ${JSON.stringify(CARTEIRA)},
      saldoInformado: ${JSON.stringify(SALDO_INFORMADO)},
      atualizadaEm: ${JSON.stringify(ATUALIZADA_EM)},
    }),
    comAtivo
  );

  const semAtivo = document.getElementById("raiz-sem");
  ReactDOM.render(
    React.createElement(CarteiraDaContaDeInvestimento, {
      // O CASO C: conta sem ativo atrelado. As outras props vem iguais as do
      // caso A de proposito -- a UNICA diferenca entre as duas montagens e
      // esta, entao o que a assercao mede e o efeito dela e nao de um fixture
      // diferente.
      carteira: null,
      saldoInformado: ${JSON.stringify(SALDO_INFORMADO)},
      atualizadaEm: ${JSON.stringify(ATUALIZADA_EM)},
    }),
    semAtivo
  );

  const grande = document.getElementById("raiz-grande");
  ReactDOM.render(
    React.createElement(CarteiraDaContaDeInvestimento, {
      carteira: ${JSON.stringify(CARTEIRA_GRANDE)},
      saldoInformado: ${JSON.stringify(SALDO_INFORMADO)},
      atualizadaEm: ${JSON.stringify(ATUALIZADA_EM)},
      rendimentoIndisponivel: true,
    }),
    grande
  );

  out.com = {
    linhas: linhasDe(comAtivo),
    texto: comAtivo.textContent,
    vazio: comAtivo.innerHTML === "",
    recorte: recorteDe(comAtivo),
  };
  out.sem = {
    linhas: linhasDe(semAtivo),
    texto: semAtivo.textContent,
    // O QUE O CASO C MEDE. \`innerHTML\` e nao \`textContent\`: um \`<div hidden>\`
    // vazio de texto passaria por \`textContent === ""\` e seria um node na
    // arvore -- e o cartao nao estaria identico ao de hoje.
    vazio: semAtivo.innerHTML === "",
    recorte: recorteDe(semAtivo),
  };
  out.grande = {
    linhas: linhasDe(grande),
    texto: grande.textContent,
    recorte: recorteDe(grande),
  };
  // A LARGURA QUE FOI MEDIDA DE FATO, lida da caixa e nao da janela: e ela que
  // prova que as duas voltas da sonda mediram telas DIFERENTES. \`innerWidth\`
  // nao serve -- ver o comentario de LARGURA_DO_CARTAO.
  out.larguraDoCartao = comAtivo.getBoundingClientRect().width;
  out.innerWidth = window.innerWidth;

  document.getElementById("resultado").textContent =
    "RESULTADO" + JSON.stringify(out) + "FIM";
} catch (e) {
  document.getElementById("resultado").textContent =
    "ERRO NA PAGINA: " + (e && e.stack ? e.stack : e);
}
</script></body></html>`;

// --- roda o navegador --------------------------------------------------------

const chromium = acharChromium();

function rodarPagina(largura) {
  const dir = mkdtempSync(join(tmpdir(), "conta-investimento-na-tela-"));
  const pagina = join(dir, "cartao.html");
  writeFileSync(pagina, paginaCom(LARGURA_DO_CARTAO[largura]));

  const dump = execFileSync(
    chromium,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      `--window-size=${largura},844`,
      "--dump-dom",
      `file://${pagina}`,
    ],
    {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024, // o dump carrega o React inline junto
      stdio: ["ignore", "pipe", "ignore"], // o Chromium enche a stderr de dbus
    }
  );

  // Ancorado na DIV, e nao no dump solto: o `--dump-dom` devolve tambem o FONTE
  // do script, e procurar o marcador no dump inteiro acha a string literal do
  // proprio codigo -- um falso positivo que se disfarca de erro de pagina.
  const achado = dump.match(/id="resultado">([\s\S]*?)<\/div>/);
  if (!achado) {
    throw new Error(`a pagina nao carregou:\n${dump.slice(0, 2000)}`);
  }

  // O `--dump-dom` SERIALIZA o textContent como HTML, entao todo `&` do JSON
  // volta como `&amp;`. `&amp;` por ULTIMO, senao `&amp;lt;` viraria `<`. E o
  // `&nbsp;` do `R$` do pt-BR volta como entidade -- desescapa-lo para o
  // caractere de verdade (U+00A0) e o que permite a comparacao com
  // `formatarValor` falar do byte que a tela tem (ver
  // `intl-pt-br-separa-o-real-com-nbsp`).
  const relato = achado[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  if (relato.startsWith("ERRO NA PAGINA")) throw new Error(relato);

  const bruto = relato.match(/^RESULTADO([\s\S]*)FIM$/);
  if (!bruto) {
    throw new Error(
      `a pagina nao reportou resultado, e sim: ${relato.slice(0, 1200)}`
    );
  }
  return JSON.parse(bruto[1]);
}

let em390 = null;
let em320 = null;
let erroDeExecucao = null;

try {
  if (!chromium) throw new Error(SEM_NAVEGADOR);
  em390 = rodarPagina(390);
  em320 = rodarPagina(320);
} catch (e) {
  erroDeExecucao = e;
}

/** Reprova com a causa real da execucao, e nao com um TypeError derivado. */
function resultado(qual) {
  if (erroDeExecucao) throw erroDeExecucao;
  return qual === 390 ? em390 : em320;
}

// =============================================================================
// A. AS TRES LINHAS
// =============================================================================

test("A1: o cartao da conta com ativo atrelado mostra as TRES linhas", () => {
  const { com } = resultado(390);

  assert.deepEqual(
    com.linhas.map((l) => l.ancora),
    ["aplicado", "rendimento", "saldo-informado"],
    "as tres linhas, nesta ordem -- o saldo informado vem por ultimo"
  );
});

test("A2: cada linha mostra o SEU numero", () => {
  const { com } = resultado(390);
  const porAncora = {};
  for (const l of com.linhas) porAncora[l.ancora] = l.valor;

  // O esperado e montado AQUI, pelo literal do fixture, e nao lido da tela:
  // comparar a tela com ela mesma e a assercao que nunca reprova. O formato
  // (`R$`, NBSP, duas casas) sai de `formatarValor`, que e producao e tem suite
  // propria -- aqui so se confere qual CAMPO caiu em qual linha.
  // O ESPERADO SAI DE `formatarValor`, QUE E PRODUCAO -- importado do JS
  // compilado e rodado no node, fora do navegador.
  //
  // Isso nao e comparar a tela com ela mesma: o que esta sob teste e QUAL
  // CAMPO caiu em qual linha, e o formato (separador de milhar, duas casas, o
  // `R$`) ja tem suite propria em `lib/dinheiro`. Reimplementar o formato aqui
  // foi a primeira versao desta assercao, e ela reprovou por um motivo que nao
  // tinha nada a ver com a feature: a copia divergia do original no espaco
  // depois do `R$`.
  assert.equal(
    semNbsp(porAncora.aplicado),
    semNbsp(formatarValor(APLICADO)),
    "a linha Aplicado"
  );
  assert.equal(
    semNbsp(porAncora.rendimento),
    semNbsp(formatarValor(RENDIMENTO)),
    "a linha Rendimento"
  );
  assert.equal(
    semNbsp(porAncora["saldo-informado"]),
    semNbsp(formatarValor(SALDO_INFORMADO)),
    "a linha Saldo informado"
  );
});

test("A3: o rendimento e o aplicado nao sao o mesmo campo", () => {
  const { com } = resultado(390);
  const porAncora = {};
  for (const l of com.linhas) porAncora[l.ancora] = l.valor;

  // Controle contra a familia de defeito mais barata deste bloco: as tres
  // linhas lendo o mesmo campo. A1 e A2 ja cobrem, e esta afirma o contrario
  // em voz alta porque e o que um refactor desatento produz.
  assert.notEqual(porAncora.aplicado, porAncora.rendimento);
  assert.notEqual(porAncora.aplicado, porAncora["saldo-informado"]);
  assert.notEqual(porAncora.rendimento, porAncora["saldo-informado"]);
});

test("A4: a data do saldo informado sai na tela", () => {
  const { com } = resultado(390);

  // 18/10/2026 em pt-BR. A data do fixture e um `timestamptz`, e
  // `dataOuMomentoNaTela` le o INSTANTE no fuso local -- nao o recua um dia
  // como faria um `slice` de ISO. Ver `teste-de-data-passa-em-utc-e-nao-ve-o-bug`.
  assert.match(
    com.texto,
    /atualizada em \d{2}\/\d{2}\/\d{4}/,
    `a frase da data nao saiu. texto: ${com.texto}`
  );
});

// =============================================================================
// B. QUAL DELAS CONTA
// =============================================================================

test("B1: as duas primeiras entram no patrimonio e a terceira NAO", () => {
  const { com } = resultado(390);
  const porAncora = {};
  for (const l of com.linhas) porAncora[l.ancora] = l.entra;

  assert.equal(porAncora.aplicado, "sim");
  assert.equal(porAncora.rendimento, "sim");
  assert.equal(
    porAncora["saldo-informado"],
    "nao",
    "o saldo informado e informacao, nao valor (Decisao 1A)"
  );
});

test("B2: 'nao entra no patrimonio' esta escrito, e nao sO pintado", () => {
  const { com } = resultado(390);

  assert.match(
    com.texto,
    /não entra no patrimônio/,
    "a frase tem de estar no texto: cor nao e lida por quem ve em preto e " +
      "branco nem por leitor de tela"
  );
});

// =============================================================================
// C. A CONTA SEM ATIVO ATRELADO
// =============================================================================

test("C1: a conta SEM ativo atrelado nao rende node nenhum", () => {
  const { sem } = resultado(390);

  assert.equal(
    sem.vazio,
    true,
    `o bloco deveria ficar vazio e saiu com: ${sem.texto}`
  );
  assert.deepEqual(sem.linhas, [], "nenhuma linha");
  assert.equal(sem.texto, "", "nenhum texto -- nem escondido por `hidden`");
});

test("C2: controle positivo -- a MESMA pagina rende o caso com ativo", () => {
  const { com, sem } = resultado(390);

  // Sem este par, um componente que devolvesse `null` sempre passaria em C1 --
  // e passaria justo quando a feature inteira desapareceu.
  assert.equal(com.vazio, false, "o caso com ativo atrelado tem de ter saido");
  assert.ok(
    com.texto.length > 0 && sem.texto.length === 0,
    `as duas montagens tem de diferir: com=${com.texto.length} chars, ` +
      `sem=${sem.texto.length} chars`
  );
});

// =============================================================================
// D. O RECORTE DO IPHONE, EM PIXELS
// =============================================================================

for (const largura of [390, 320]) {
  test(`D${largura}: nada estoura a largura em ${largura}px`, () => {
    const dados = resultado(largura);

    for (const [nome, bloco] of [
      ["o cartao com ativo atrelado", dados.com],
      ["o cartao com valores grandes e aviso", dados.grande],
    ]) {
      // A MEDIDA VACUA REPROVA: raiz sem largura mediria scrollWidth 0 <=
      // clientWidth 0 e passaria dizendo que a tela cabe.
      assert.ok(
        bloco.recorte.clientWidth > 150,
        `${nome}: a raiz nao tem largura (${bloco.recorte.clientWidth}px) -- ` +
          "a medida seria vacua"
      );
      assert.ok(
        bloco.recorte.scrollWidth <= bloco.recorte.clientWidth,
        `${nome} anda para o lado em ${largura}px: scrollWidth ` +
          `${bloco.recorte.scrollWidth} > clientWidth ` +
          `${bloco.recorte.clientWidth}. Estourando: ` +
          `${JSON.stringify(bloco.recorte.estourando)}`
      );
    }
  });
}

test("D0: as duas voltas mediram cartoes de larguras DIFERENTES", () => {
  // O controle contra a sonda medir a mesma tela duas vezes. Ele existe porque
  // a primeira versao desta sonda fazia exatamente isso: ela confiava em
  // `--window-size`, que o headless desta maquina ignora -- `innerWidth`
  // respondia 500 nas duas voltas e os dois casos de D passavam falando da
  // mesma largura.
  assert.equal(resultado(390).larguraDoCartao, LARGURA_DO_CARTAO[390]);
  assert.equal(resultado(320).larguraDoCartao, LARGURA_DO_CARTAO[320]);
  assert.notEqual(
    resultado(390).larguraDoCartao,
    resultado(320).larguraDoCartao
  );
});

// =============================================================================
// E. A COMPOSICAO, PURA (sem navegador)
// =============================================================================

const { comporCarteiraPorConta, carteiraDaConta } = await import(
  `../${SAIDA}/lib/carteira-na-tela.js`
);

const CONTA_A = "a1111111-1111-4111-b111-111111111111";

/** Um ativo e um lancamento de compra que custa `custo` reais. */
function fixtureDeRendaFixa(custo, accountId) {
  return {
    assets: [
      {
        id: "ativo-1",
        symbol: "CDB",
        name: "CDB do banco",
        type: "fixed_income",
        currency: "BRL",
        current_price: null,
        current_price_at: null,
        account_id: accountId,
      },
    ],
    // `quantity` em REAIS e `unit_price` 1: e a convencao da renda fixa neste
    // app (HMO-439). Ver PRECO_UNITARIO_DA_RENDA_FIXA em lib/investments.ts.
    positions: [
      {
        asset_id: "ativo-1",
        symbol: "CDB",
        name: "CDB do banco",
        type: "fixed_income",
        total_quantity: custo,
        average_price: 1,
        total_invested: custo,
        current_value: custo,
        profit_loss: 0,
        profit_loss_percentage: 0,
        dividends: 0,
        realized_profit_loss: 0,
        has_price: false,
        exceeded_position: false,
      },
    ],
  };
}

test("E1: sem a rota do rendimento, a carteira sai PELO CUSTO e avisa", () => {
  const composta = comporCarteiraPorConta(
    fixtureDeRendaFixa(10000, CONTA_A),
    // O caso que a issue nomeia: o timeout do SGS.
    null
  );

  const linha = carteiraDaConta(composta, CONTA_A);
  assert.ok(linha, "a conta tem de continuar aparecendo");
  assert.equal(linha.valor, 10000, "o valor cai para o custo -- nunca zero");
  assert.equal(linha.rendimento, 0);
  assert.equal(
    composta.rendimentoIndisponivel,
    true,
    "e a tela tem de saber disso para avisar"
  );
});

test("E2: com rendimento, ele entra no valor da conta", () => {
  const composta = comporCarteiraPorConta(fixtureDeRendaFixa(10000, CONTA_A), {
    projections: [
      {
        asset_id: "ativo-1",
        symbol: "CDB",
        principal: 10000,
        bruto: 500,
        liquido: 400,
        motivo: null,
      },
    ],
  });

  const linha = carteiraDaConta(composta, CONTA_A);
  assert.equal(linha.valor, 10500, "principal + bruto");
  assert.equal(linha.rendimento, 500);
  assert.equal(
    composta.rendimentoIndisponivel,
    false,
    "o rendimento veio: nada a avisar"
  );
});

test("E3: a conta sem ativo atrelado nao tem linha -- e isso e o `null`", () => {
  const composta = comporCarteiraPorConta(
    // `account_id: null` e o ativo SOLTO: todo ativo cadastrado antes da 059.
    fixtureDeRendaFixa(10000, null),
    null
  );

  assert.equal(
    carteiraDaConta(composta, CONTA_A),
    null,
    "e o `null` que faz o cartao daquela conta ficar identico ao de hoje"
  );
  assert.ok(composta.solta, "mas o dinheiro nao desaparece: ele sai no solto");
  assert.equal(composta.solta.valor, 10000);
});

test("E4: carteira sem renda fixa nenhuma nao liga o aviso do Banco Central", () => {
  const acao = fixtureDeRendaFixa(10000, CONTA_A);
  acao.assets[0].type = "stock";
  acao.positions[0].type = "stock";
  acao.positions[0].has_price = true;

  const composta = comporCarteiraPorConta(acao, null);

  // O par de E1: os dois tem `rendaFixa: null` e dao `rendimento: 0`, e so um
  // deles tem algo a avisar. Sem este caso, um `rendimentoIndisponivel` cravado
  // em `true` passaria em E1.
  assert.equal(
    composta.rendimentoIndisponivel,
    false,
    "quem nao tem renda fixa nao tem o que esperar do Banco Central"
  );
});
