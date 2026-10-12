#!/usr/bin/env node
// =====================================================
// PULODOGATO - o Fluxo de Caixa DIZ quando o numero e copia do aparelho (HMO-401)
// =====================================================
//   npm run test:fluxo-na-tela
//
// O QUE SO ESTA SUITE PROVA
// -------------------------
// `npm run test:pwa-runtime-cache` prova a metade de BAIXO: o service worker
// carimba a resposta que saiu do aparelho (`x-pulodogato-do-aparelho`) e os
// nomes dos cabecalhos la batem com os de `lib/offline-leitura.ts`.
// `npm run test:offline-leitura` prova o MEIO: `classificarLeitura` transforma
// aquele carimbo no estado `do-aparelho`, com a data.
//
// As duas juntas passam verde com a tela CALADA -- e foi exatamente esse o
// estado do Fluxo de Caixa ate aqui. O carimbo existia, a classificacao
// existia, e a tela nao chamava nenhuma das duas: ela fazia `fetch` cru,
// tratava `!resp.ok` como uma tarja de erro, e a copia de ate sete dias entrava
// pelo caminho de SUCESSO -- previsao de ontem, grafico desenhado, data do
// mergulho anunciada, sem uma palavra sobre de quando era.
//
// O que falta, e o que esta suite mede, e a METADE DE CIMA: a pagina de
// producao, montada em navegador de verdade, com a resposta CARIMBADA chegando
// pelo `fetch` -- e o aviso tem de aparecer na tela, com o momento.
//
// O CONTROLE NEGATIVO E OBRIGATORIO, e e metade dos casos daqui. Uma faixa que
// aparece sempre deixa de significar alguma coisa: ela viraria moldura, a
// pessoa para de ler, e o dia em que o numero for velho de verdade ela nao vai
// olhar. Entao todo caso que exige a faixa tem um gemeo, com a MESMA resposta
// sem o carimbo, que exige a ausencia dela.
//
// POR QUE O SERVICE WORKER NAO ENTRA NESTA PAGINA
// -----------------------------------------------
// A issue pedia "a sonda com o service worker servindo uma resposta
// carimbada". Service worker exige origem segura -- `https:` ou `localhost` --
// e esta sonda roda em `file://` porque e o unico caminho que funciona neste
// ambiente (ver [testar-dom-em-chromium-aqui]: o Chromium daqui nao alcanca
// 127.0.0.1, e `<script type=module>` e diferido, entao o `--dump-dom`
// fotografa o DOM antes de ele rodar).
//
// E registrar um service worker de verdade mediria o workbox, nao o app: o
// comportamento do `NetworkFirst` (quando cai na copia, o que ele carimba) ja
// tem suite propria, e ela confere o carimbo contra a MESMA constante que a
// tela le. O que estava sem prova era a tela. Entao a resposta carimbada chega
// aqui pelo lugar onde o service worker a entrega -- o `fetch` --, com o
// cabecalho escrito como LITERAL, exatamente como `lib/pwa-runtime-cache.js` o
// escreve; e o ultimo caso desta suite confere esse literal contra os dois
// arquivos de producao, para que um nome trocado de um lado nao passe por
// acordo entre a sonda e si mesma.
//
// A RECEITA DO AMBIENTE
// ---------------------
// A base e a de scripts/test-lista-na-tela.mjs e scripts/test-papel-na-tela.mjs
// (`file://` + script CLASSICO + `--dump-dom`; React pelo UMD INLINE;
// `ReactDOM.render` legado e nao `createRoot`, porque o legado renderiza
// sincrono e descarrega a atualizacao no fim do evento). E, como lá, a pagina
// DRENA MICROTASKS intercalado com `flushSync` antes de cada medicao: a leitura
// e `await`, a continuacao dela e microtask, e sem drenar toda medicao cairia na
// fase `carregando` -- onde a tela mostra "Calculando..." e NADA mais. Aí a
// assercao negativa ("a faixa nao esta na tela") ficaria verde por nao haver
// tela nenhuma, indistinguivel de uma feature que funciona. O caso B existe
// para isso nao passar em silencio.
//
// Esta pagina ainda tem uma drenagem a mais que a da lista: a primeira busca
// ESPERA o `localStorage` ser lido (`ajuste === undefined` interrompe o
// `carregar`), entao sao dois efeitos em sequencia antes de o `fetch` sair.
//
// O `localStorage` NAO e esbocado: em `file://` o Chromium nega o acesso, a
// pagina ja trata isso (`catch` -> segue com o valor calculado) e o resultado e
// o mesmo de um armazenamento vazio -- que e o estado que estes casos querem.
//
// COMO O CODIGO DE PRODUCAO CHEGA NA PAGINA, E O QUE E ESBOCO
// ----------------------------------------------------------
// Vao compilados e INTACTOS no corpo (ver `PARTES`, em ordem de dependencia):
//
//   lib/offline-leitura.js  -- `buscarLeitura` e `classificarLeitura` (o
//                              CAMINHO DE REDE do app) e `descreverMomento`,
//                              que escreve "em 09/10 as 10:03". Esbocar
//                              qualquer um dos tres seria esbocar a feature;
//   lib/dinheiro.js         -- sem import proprio, e o campo de valor a usa;
//   components/ui/*.js      -- button, card e badge: a faixa e os dois paineis
//                              sao feitos deles, e e o texto DELES que as
//                              assercoes leem;
//   components/SemRede.js   -- a faixa `FaixaDadoDoAparelho`, `PainelSemRede` e
//                              `PainelErroDoServidor`. ELES SAO A ASSERCAO:
//                              esbocados, a sonda mediria a propria sonda;
//   app/.../cash-flow/page.js -- a pagina, inteira. E o alvo.
//
// Esbocado (e todo esboco imprime um marcador `[ESBOCO-...]`, auditavel -- os
// colchetes existem para o inventario de marcadores poder ser lido do
// textContent: sem eles `ESBOCO-CAMPO-DE-VALOR` emenda na primeira letra do
// botao ao lado, e o regex do inventario devolve `ESBOCO-CAMPO-DE-VALORU`):
//
//   `CampoDeValor` -- o campo mascarado do cartao de gasto do dia a dia.
//     Nenhuma assercao daqui le o campo, e ele arrasta a calculadora, o dialogo
//     do Radix e a mascara de digitacao;
//   `Link` (next/link) e os dez icones do lucide -- nenhuma assercao os le.
//     Icone sem esboco e `React.createElement(undefined)`, que derruba o render
//     da pagina INTEIRA e reprova todos os casos com "a raiz ficou vazia";
//   `cn`, `cva` e `Slot` -- a fiacao de classe dos componentes de ui;
//   `gastoDiarioComAjustes` -- ela e so chamada em callback de clique, e nenhum
//     caso daqui clica no editor de gasto.
//
// E DUAS CONSTANTES VAO EXTRAIDAS do `lib/variable-spend.js` com `daLib`, em
// vez de esbocadas: a lib inteira arrasta `recurrence-detector` e `anomalies`
// por duas declaracoes, mas as duas sao AUTO-CONTIDAS e a pagina IMPRIME uma
// delas (`DIAS_MEDIOS_DO_MES`, no "equivale a X por mes"). Escrita a mao na
// sonda, a assercao casaria com qualquer numero que a tela imprimisse.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SAIDA = ".tmp-fluxo-na-tela";

/** O caminho da pagina compilada. Os parenteses do grupo de rotas vao junto. */
const PAGINA_COMPILADA = "app/(dashboard)/dashboard/cash-flow/page.js";

/**
 * Acha um Chromium: o do `CHROMIUM_BIN`, o que o Playwright baixou, ou o Chrome
 * do sistema (o runner do Actions ja vem com um).
 *
 * A VERSAO DO PLAYWRIGHT NAO ESTA FIXA AQUI. As outras quatro sondas de
 * navegador deste repositorio tinham `chromium-1243` escrito no fonte, e o
 * bump do ambiente para `chromium-1248` deixou as quatro 100% vermelhas numa
 * arvore intocada; o sintoma de superficie e dezenas de `Cannot read properties
 * of null`: le-se como "o meu import derrubou a pagina", que e o diagnostico
 * errado e caro. A pasta e LISTADA em vez de adivinhada, entao o proximo bump
 * nao morde. A HMO-406 portou esta mesma busca para as quatro.
 */
function acharChromium() {
  const candidatos = [process.env.CHROMIUM_BIN];

  for (const base of [
    `${process.env.HOME}/.cache/ms-playwright`,
    "/paperclip/.cache/ms-playwright",
  ]) {
    if (!existsSync(base)) continue;
    for (const dir of readdirSync(base).sort().reverse()) {
      if (!/^chromium(_headless_shell)?-\d+$/.test(dir)) continue;
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

// --- a pagina e os componentes, ja compilados ---------------------------------
//
// Quem compila e o script `test:fluxo-na-tela` do package.json. Isso tambem e o
// que faz a segunda peneira do check-tests-in-ci.mjs enxergar os arquivos desta
// suite -- ela le os caminhos citados NO COMANDO.

if (!existsSync(join(SAIDA, PAGINA_COMPILADA))) {
  throw new Error(
    `${SAIDA}/ nao existe. Rode por \`npm run test:fluxo-na-tela\`, ` +
      "que e quem compila a pagina antes do teste."
  );
}

/**
 * Tira so a fiacao de modulo, deixando o corpo das funcoes intacto.
 *
 * `export default function X` precisa de regra PROPRIA e ANTES da generica:
 * tirar so a palavra `export` deixaria `default function CashFlowPage() {`, que
 * e SyntaxError -- e um que a peneira de "sobrou export" nao pega, porque a
 * palavra `export` sumiu. Nenhuma das outras sondas de navegador deste
 * repositorio monta uma PAGINA do App Router, e esta e a unica diferenca.
 */
const paraScriptClassico = (fonte) =>
  fonte
    // O `import` emitido pelo tsc ocupa mais de uma linha quando a lista de
    // nomes e longa, entao o recorte e do `import` ate o `;` -- nao de uma
    // linha so, que deixaria metade da lista de nomes solta no meio do script.
    .replace(/^import\s[\s\S]*?;$/gm, "")
    .replace(/^export default function /gm, "function ")
    // O `export { A, B, ... };` de fim de arquivo (card.js): apagado INTEIRO, e
    // ANTES da regra de baixo. `[^}]*` nao atravessa chave, entao corpo de
    // funcao e `export { ... } from "..."` ficam fora do alcance.
    .replace(/^export\s*\{[^}]*\}\s*;$/gm, "")
    .replace(/^export /gm, "");

/**
 * UM PEDACO AUTO-CONTIDO DE UMA LIB QUE A PAGINA NAO CARREGA INTEIRA.
 *
 * `rotulo` entra na mensagem de erro porque uma extracao que nao casa e o modo
 * de falha caro: ela deixaria o nome `undefined` na pagina, e o sintoma seria
 * um `ReferenceError` vinte linhas depois, sem dizer que a ancora do regex
 * mudou.
 */
function daLib(arquivo, fonte, regex, rotulo) {
  const achado = regex.exec(fonte);
  if (!achado) {
    throw new Error(
      `nao achei ${rotulo} em ${arquivo}: a ancora da extracao mudou.\n` +
        "ou ajuste o regex, ou ponha a lib inteira em PARTES"
    );
  }
  return achado[0].replace(/^export /m, "");
}

/**
 * AS DUAS CONSTANTES DO GASTO VARIAVEL.
 *
 * `lib/variable-spend.js` NAO entra em `PARTES`: ela importa
 * `lib/recurrence-detector` e `lib/anomalies` -- dois modulos de aritmetica de
 * recorrencia por duas declaracoes. As duas sao AUTO-CONTIDAS (numero e string
 * literal, sem usar nenhum dos imports), entao entram pelo CODIGO DE PRODUCAO
 * extraido. `DIAS_MEDIOS_DO_MES` e o que a tela IMPRIME ("equivale a X por
 * mes"): escrito a mao aqui, ele casaria com qualquer numero.
 */
const DO_GASTO_VARIAVEL = (() => {
  const arquivo = "lib/variable-spend.js";
  const fonte = readFileSync(join(SAIDA, arquivo), "utf8");

  return ["DIAS_MEDIOS_DO_MES", "SEM_CATEGORIA"]
    .map((nome) =>
      daLib(
        arquivo,
        fonte,
        new RegExp("^export const " + nome + " = [^\\n]*;$", "m"),
        nome
      )
    )
    .join("\n");
})();

const PARTES = [
  // ORDEM DE DEPENDENCIA. Nao e exigencia do JavaScript para funcao declarada
  // (ela e iceada), mas e para `const` de modulo -- e quase todos tem varios.
  "lib/offline-leitura.js",
  "lib/dinheiro.js",
  "components/ui/button.js",
  "components/ui/card.js",
  "components/ui/badge.js",
  "components/SemRede.js",
  PAGINA_COMPILADA,
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

/**
 * O CARIMBO, ESCRITO COMO LITERAL -- do lado de quem RESPONDE.
 *
 * E o mesmo literal que `lib/pwa-runtime-cache.js` escreve dentro do service
 * worker (ele tem de ser literal la porque o plugin e copiado como TEXTO para
 * dentro do sw.js e nao leva o escopo do arquivo junto). Aqui ele e literal de
 * proposito tambem: usar a constante que a PAGINA le faria os dois lados
 * concordarem por construcao, e um nome trocado passaria verde. O caso H
 * confere este literal contra os dois arquivos de producao.
 */
const MARCA = "x-pulodogato-do-aparelho";
const MARCA_QUANDO = "x-pulodogato-guardado-em";

/**
 * Quando o servidor produziu a copia. Fixo, e no passado por mais de um dia,
 * porque `descreverMomento` so escreve a data completa ("em 09/10") a partir
 * de anteontem -- "hoje"/"ontem" dependeriam do dia em que o CI roda.
 *
 * `TZ=America/Sao_Paulo` sai do script do package.json e o Chromium o herda:
 * 13:03 UTC sao 10:03 aqui, e e esse o par que as assercoes esperam.
 */
const GUARDADO_EM = "Fri, 09 Oct 2026 13:03:00 GMT";
const MOMENTO_ESPERADO = "em 09/10 as 10:03";

// A pagina e montada com template literal, e NUNCA com `String.replace`: o
// bundle do React tem `$$typeof` dentro, e numa string de substituicao `$$`
// vira `$` -- o bundle chega corrompido e o erro e "React is not defined", que
// nao se le como o que e.
const PAGINA = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<div id="raiz-a"></div><div id="raiz-b"></div>
<div id="raiz-c"></div><div id="raiz-d"></div>
<div id="raiz-e"></div><div id="raiz-f"></div>
<div id="raiz-g"></div>
<div id="resultado"></div>
<script>${umd("react", "react.development.js")}</script>
<script>${umd("react-dom", "react-dom.development.js")}</script>
<script>
(async function () {
try {

// --- os hooks por nome -------------------------------------------------------
// O \`import\` deles foi removido junto com o resto da fiacao de modulo.
const { useCallback, useEffect, useMemo, useRef, useState } = React;

// --- a fiacao de classe dos componentes de ui --------------------------------

const cn = (...partes) => partes.filter(Boolean).join(" ");
const cva = (base) => () => base;
const Slot = React.forwardRef(function Slot(props, ref) {
  return React.createElement("span", Object.assign({ ref: ref }, props));
});

// --- os esbocos --------------------------------------------------------------
//
// Todo esboco imprime um marcador \`ESBOCO-...\`. O caso B confere que nenhum
// deles aparece onde as assercoes leem.

const icone = (nome) => (props) =>
  React.createElement("span", { "data-icone": nome, "aria-hidden": "true" });

// Os sete da pagina...
const AlertTriangle = icone("AlertTriangle");
const CalendarClock = icone("CalendarClock");
const LineChart = icone("LineChart");
const Repeat = icone("Repeat");
const ShoppingCart = icone("ShoppingCart");
const TrendingDown = icone("TrendingDown");
const TrendingUp = icone("TrendingUp");
// ...e os tres de components/SemRede.
const CloudOff = icone("CloudOff");
const RefreshCw = icone("RefreshCw");
const ServerCrash = icone("ServerCrash");

const Link = React.forwardRef(function Link(props, ref) {
  const resto = Object.assign({ ref: ref }, props);
  delete resto.prefetch;
  return React.createElement("a", resto);
});

// O campo mascarado do editor de gasto. Nenhuma assercao daqui o le, e ele
// arrasta a calculadora, o dialogo do Radix e a mascara de digitacao.
const CampoDeValor = (props) =>
  React.createElement(
    "span",
    { "aria-label": props["aria-label"] },
    "[ESBOCO-CAMPO-DE-VALOR]"
  );

// So chamada em callback de clique, e nenhum caso daqui clica no editor.
const gastoDiarioComAjustes = () => 0;

${DO_GASTO_VARIAVEL}

// --- o codigo de producao ----------------------------------------------------

${producao}

// --- a rede ------------------------------------------------------------------
//
// A RESPOSTA E A MEDIDA: o que esta suite troca entre um caso e o gemeo dele e
// APENAS o cabecalho, com o mesmo corpo byte a byte. E isso que faz o par
// significar "a tela leu o carimbo", e nao "a tela reagiu a outro dado".

/** As URLs que sairam, na ordem. */
let CHAMADAS = [];
/** O que o \`fetch\` vai responder no caso corrente. */
let MODO = "fresco";
/** O corpo, igual para todos os modos que respondem. */
let CORPO = null;

const comCabecalhos = (mapa) => ({
  get: (nome) => {
    const chave = String(nome).toLowerCase();
    return Object.prototype.hasOwnProperty.call(mapa, chave) ? mapa[chave] : null;
  },
});

window.fetch = async (url) => {
  CHAMADAS.push(String(url));

  // Nenhuma resposta: e assim que o \`buscarLeitura\` ve "nao ha copia e nao ha
  // servidor". E o \`fetch\` do navegador LANCA nesse caso -- nao devolve 0.
  if (MODO === "sem-rede") throw new TypeError("Failed to fetch");

  if (MODO === "erro-do-servidor") {
    return {
      ok: false,
      status: 500,
      headers: comCabecalhos({}),
      json: async () => ({ error: "Erro interno" }),
    };
  }

  // A copia do aparelho e byte a byte a mesma coisa que a resposta do
  // servidor, MENOS os dois cabecalhos. E por isso que a tela nao tinha como
  // saber, e por isso que o carimbo existe.
  const cabecalhos =
    MODO === "do-aparelho"
      ? { "${MARCA}": "1", "${MARCA_QUANDO}": "${GUARDADO_EM}" }
      : {};

  return {
    ok: true,
    status: 200,
    headers: comCabecalhos(cabecalhos),
    json: async () => CORPO,
  };
};

// --- o corpo de \`/api/cash-flow\` ---------------------------------------------
//
// A sonda monta o objeto porque o que esta sendo medido e a TELA: quem calcula
// a previsao e a rota, e ela tem suite propria (\`npm run test:cash-flow\`).
// Recalcular aquilo aqui seria a sonda medindo a propria sonda.
//
// \`gastoDiario: 0\` de proposito: sem faixa a tela desenha UMA linha, e os casos
// daqui falam do aviso de procedencia, nao da segunda linha.

const fluxo = (extra) =>
  Object.assign(
    {
      de: "2026-10-12",
      ate: "2027-01-10",
      dias: 90,
      saldoInicial: 4200,
      comecaNegativo: false,
      primeiroDiaNegativo: "2026-11-20",
      saldoFinal: -1500,
      menorSaldo: -1800,
      diaDoMenorSaldo: "2026-12-05",
      totalEntra: 9000,
      totalSai: 14700,
      gastoDiario: 0,
      gastoVariavelTotal: 0,
      saldoFinalProvavel: -1500,
      menorSaldoProvavel: -1800,
      diaDoMenorSaldoProvavel: "2026-12-05",
      primeiroDiaNegativoProvavel: "2026-11-20",
      absorvidasPelaAgenda: [],
      linha: [
        { data: "2026-10-12", entra: 0, sai: 0, saldo: 4200, saldoProvavel: 4200 },
        { data: "2026-11-20", entra: 0, sai: 2500, saldo: -300, saldoProvavel: -300 },
        { data: "2027-01-10", entra: 0, sai: 1200, saldo: -1500, saldoProvavel: -1500 },
      ],
    },
    extra || {}
  );

const EVENTO = {
  id: "s-1",
  data: "2026-11-20",
  descricao: "Aluguel",
  valor: -2500,
  origem: "prevista",
  saldoDepois: -300,
};

const corpo = (eventos) => ({
  cash_flow: fluxo(),
  upcoming: eventos,
  variable_spend: null,
  recorrencias_indisponiveis: false,
  gasto_indisponivel: false,
});

// --- o arnes -----------------------------------------------------------------

/**
 * DRENA A FILA DE MICROTASKS, intercalado com \`flushSync\`.
 *
 * A continuacao de um \`await\` e um microtask, e a fila so drena no fim da
 * tarefa atual -- ou seja, depois que este \`<script>\` inteiro terminar.
 * \`flushSync\` e sincrono e nao a drena. Sem drenar intercalado, toda medicao
 * cairia na fase \`carregando\`, onde a tela mostra "Calculando..." e nada mais.
 *
 * Esta pagina precisa de MAIS voltas que a sonda da lista: o \`carregar\` dela
 * interrompe enquanto o \`localStorage\` nao foi lido (\`ajuste === undefined\`),
 * entao sao dois efeitos em sequencia antes de o \`fetch\` sair, e a leitura do
 * corpo (\`resposta.json()\`) e um terceiro \`await\`.
 *
 * E NUNCA \`setTimeout\`: a fila de microtasks drena muito antes de o
 * \`--dump-dom\` fotografar; um temporizador seria uma corrida contra a foto.
 */
async function assentar() {
  for (let i = 0; i < 48; i++) {
    await Promise.resolve();
    ReactDOM.flushSync(function () {});
  }
}

/** Monta a pagina num container, com o modo de rede e o corpo do caso. */
async function montar(idDaRaiz, modo, corpoDoCaso) {
  CHAMADAS = [];
  MODO = modo;
  CORPO = corpoDoCaso;

  const raiz = document.getElementById(idDaRaiz);
  ReactDOM.render(React.createElement(CashFlowPage), raiz);
  await assentar();
  return raiz;
}

/** O que a tela mostra, reduzido ao que as assercoes leem. */
const retrato = (raiz) => ({
  texto: raiz.textContent.replace(/\\s+/g, " ").trim(),
  // O botao da faixa, achado pelo ROTULO que producao escreve. Ele e o unico
  // "Atualizar" da tela.
  temBotaoAtualizar: Array.prototype.slice
    .call(raiz.querySelectorAll("button"))
    .some((b) => b.textContent.trim() === "Atualizar"),
  chamadas: CHAMADAS.slice(),
});

/**
 * Clica no botao da faixa pelo texto dele. Devolve \`false\` se ele nao existe.
 *
 * NAO LANCA de proposito. Um \`throw\` aqui derruba a IIFE inteira, a pagina
 * reporta "ERRO NA PAGINA" e os treze casos ficam vermelhos de uma vez -- o que
 * se le como sonda quebrada, nao como defeito. E o defeito que apaga este botao
 * e justamente o que apaga a FAIXA: medido, o mutante que faz a tela calar de
 * novo era reportado como erro de pagina, com a assercao da faixa (a que
 * importa) enterrada no meio das outras doze.
 */
async function clicarAtualizar(raiz) {
  const botao = Array.prototype.slice
    .call(raiz.querySelectorAll("button"))
    .find((b) => b.textContent.trim() === "Atualizar");
  if (!botao) return false;
  botao.click();
  await assentar();
  return true;
}

const out = {};

// =========================================================================
// A. A COPIA DO APARELHO: a faixa aparece, com o momento, E os numeros FICAM
// =========================================================================
// As duas metades importam. A faixa sozinha nao basta: o dado guardado e REAL,
// e esconder a previsao por ela estar velha seria trocar um defeito por outro
// (foi para isso que o cache de sete dias foi criado). E os numeros sozinhos
// eram o estado anterior a esta issue.
out.a = retrato(await montar("raiz-a", "do-aparelho", corpo([EVENTO])));

// =========================================================================
// B. CONTROLE NEGATIVO: a MESMA resposta, sem o carimbo, NAO mostra faixa
// =========================================================================
// O corpo e byte a byte o mesmo do caso A -- a unica diferenca sao os dois
// cabecalhos. Sem este caso, uma faixa que aparecesse sempre passaria verde no
// A, e ela deixaria de significar alguma coisa.
out.b = retrato(await montar("raiz-b", "fresco", corpo([EVENTO])));

// =========================================================================
// C. SEM REDE E SEM COPIA: o painel substitui os numeros
// =========================================================================
out.c = retrato(await montar("raiz-c", "sem-rede", null));

// =========================================================================
// D. O SERVIDOR RESPONDEU ERRO: outro painel, porque a acao da pessoa e outra
// =========================================================================
// Dizer "sem conexao" a quem esta conectado manda reiniciar o roteador por
// causa de um defeito nosso.
out.d = retrato(await montar("raiz-d", "erro-do-servidor", null));

// =========================================================================
// E. COPIA DO APARELHO E LISTA VAZIA: a tela NAO convida a cadastrar de novo
// =========================================================================
// A copia pode ser de ANTES de a pessoa cadastrar a primeira conta. "Nenhum
// compromisso previsto" e "Cadastre suas contas" afirmam o contrario, e a
// segunda convida a cadastrar de novo o que ja existe.
out.e = retrato(await montar("raiz-e", "do-aparelho", corpo([])));

// =========================================================================
// F. CONTROLE do E: fresco e lista vazia, as duas frases APARECEM
// =========================================================================
// Sem este caso o E passaria verde numa tela que tivesse perdido o convite de
// vez -- e o convite e util: e ele que diz o que fazer numa conta nova.
out.f = retrato(await montar("raiz-f", "fresco", corpo([])));

// =========================================================================
// G. O BOTAO "ATUALIZAR" PEDE SEM A COPIA
// =========================================================================
// A primeira leitura sai LIMPA (sem o parametro) e a do botao sai com ele. As
// duas metades sao necessarias: um parametro que fosse sempre junto furaria o
// cache em toda carga e apagaria a leitura offline da tela mais pesada do app.
{
  const raiz = await montar("raiz-g", "do-aparelho", corpo([EVENTO]));
  const antes = CHAMADAS.slice();
  const clicou = await clicarAtualizar(raiz);
  out.g = { antes: antes, clicou: clicou, depois: CHAMADAS.slice() };
}

document.getElementById("resultado").textContent =
  "RESULTADO" + JSON.stringify(out) + "FIM";

} catch (e) {
  document.getElementById("resultado").textContent =
    "ERRO NA PAGINA: " + (e && e.stack ? e.stack : e);
}
})();
</script></body></html>`;

// --- roda o navegador --------------------------------------------------------

const chromium = acharChromium();
let resultado = null;
let erroDeExecucao = null;

function rodarPagina(nomeDoArquivo, html) {
  const dir = mkdtempSync(join(tmpdir(), "fluxo-na-tela-"));
  const pagina = join(dir, nomeDoArquivo);
  writeFileSync(pagina, html);

  const dump = execFileSync(
    chromium,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--window-size=390,844", // iPhone: e onde este app e usado
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
    throw new Error(`${nomeDoArquivo} nao carregou:\n${dump.slice(0, 2000)}`);
  }

  // O `--dump-dom` SERIALIZA o textContent como HTML, entao todo `&` do JSON
  // volta como `&amp;` -- e as URLs desta sonda tem `&` (`?dias=90&semCopia=`).
  // Sem desescapar, a assercao da URL compara `&amp;semCopia=` com
  // `&semCopia=` e reprova sem nada estar errado no app; e pior, uma assercao
  // escrita com `includes` passaria a nunca casar e viraria vacua.
  // `&amp;` por ULTIMO, senao `&amp;lt;` viraria `<`.
  const relato = achado[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  if (relato.startsWith("ERRO NA PAGINA")) throw new Error(relato);

  const bruto = relato.match(/^RESULTADO([\s\S]*)FIM$/);
  if (!bruto) {
    throw new Error(
      `${nomeDoArquivo} nao reportou resultado, e sim: ${relato.slice(0, 1200)}`
    );
  }
  return JSON.parse(bruto[1]);
}

try {
  if (!chromium) throw new Error(SEM_NAVEGADOR);
  resultado = rodarPagina("fluxo.html", PAGINA);
} catch (e) {
  erroDeExecucao = e;
}

/** O texto que `FaixaDadoDoAparelho` escreve, e so ela. */
const FRASE_DA_FAIXA = "guardado no aparelho";

// =============================================================================

test("o navegador rodou e a pagina reportou", () => {
  if (erroDeExecucao) throw erroDeExecucao;
  assert.ok(resultado, "sem resultado da pagina");
});

test("CONTROLE: a tela PINTOU a previsao -- nao ficou em Calculando", () => {
  // O controle que da sentido a toda assercao negativa desta suite. Sem drenar
  // os microtasks a leitura fica na fase `carregando` e a tela mostra
  // "Calculando..." e nada mais -- e aí "a faixa nao esta na tela" fica verde
  // por nao haver tela nenhuma, indistinguivel de uma feature que funciona.
  assert.match(resultado.b.texto, /Previsão de fluxo de caixa/);
  assert.match(resultado.b.texto, /Seu saldo fica negativo em/);
  assert.match(resultado.b.texto, /20\/11\/2026/);
  assert.ok(
    !resultado.b.texto.includes("Calculando"),
    resultado.b.texto.slice(0, 300)
  );
  // E o valor saiu formatado pelo caminho de PRODUCAO, nao por um esboco.
  assert.match(resultado.b.texto, /R\$\s?1\.800,00/);
});

test("A copia do aparelho mostra a FAIXA, com o momento da copia", () => {
  assert.match(resultado.a.texto, new RegExp(FRASE_DA_FAIXA));
  // O momento sai de `descreverMomento`, de producao, alimentado pelo cabecalho
  // que o service worker escreve: a cadeia inteira em uma assercao.
  assert.match(
    resultado.a.texto,
    new RegExp(FRASE_DA_FAIXA + ", " + MOMENTO_ESPERADO.replace(/\//g, "\\/"))
  );
  // `soLeitura`: a tela e de consulta, e a frase evita a pessoa tentar mexer.
  assert.match(resultado.a.texto, /Da para consultar, nao da para alterar/);
});

test("A copia do aparelho NAO esconde os numeros -- o dado e real", () => {
  // Esconder a previsao por ela estar velha seria trocar um defeito por outro:
  // a leitura offline existe justamente para esta tela abrir sem rede.
  assert.match(resultado.a.texto, /Seu saldo fica negativo em/);
  assert.match(resultado.a.texto, /20\/11\/2026/);
  assert.match(resultado.a.texto, /Aluguel/);
});

test("CONTROLE NEGATIVO: a resposta DA REDE nao mostra faixa nenhuma", () => {
  // O mesmo corpo do caso A, sem os dois cabecalhos. Uma faixa que aparecesse
  // aqui tambem deixaria de significar alguma coisa quando aparecesse de
  // verdade.
  assert.ok(
    !resultado.b.texto.includes(FRASE_DA_FAIXA),
    resultado.b.texto.slice(0, 400)
  );
  assert.equal(resultado.b.temBotaoAtualizar, false);
});

test("CONTROLE: o UNICO esboco que chega a tela e o campo de valor", () => {
  // O inventario dos marcadores, e nao "nenhum marcador": o campo mascarado e
  // esboco declarado (ver o cabecalho), e ele fica no cartao de gasto do dia a
  // dia -- longe de tudo que esta suite le. O que este caso pega e um esboco
  // NOVO aparecendo onde nao estava: foi assim que uma sonda irma passou a
  // medir a si mesma depois de um import novo num componente.
  for (const caso of ["a", "b", "e", "f"]) {
    const marcadores = resultado[caso].texto.match(/\[ESBOCO-[^\]]+\]/g) || [];
    assert.deepEqual(
      Array.from(new Set(marcadores)).sort(),
      ["[ESBOCO-CAMPO-DE-VALOR]"],
      `caso ${caso}: ${resultado[caso].texto.slice(0, 400)}`
    );
  }
  // E nos dois casos de painel nao ha esboco nenhum: eles substituem o corpo da
  // tela, inclusive o cartao do campo de valor.
  for (const caso of ["c", "d"]) {
    assert.ok(
      !resultado[caso].texto.includes("ESBOCO"),
      `caso ${caso}: ${resultado[caso].texto}`
    );
  }
});

test("Sem rede e sem copia: o painel SUBSTITUI a previsao", () => {
  assert.match(resultado.c.texto, /Sem conexao\. Nao deu para carregar a sua previsão agora/);
  assert.match(resultado.c.texto, /Nada foi perdido/);
  // Nenhum numero na tela: um "R$ 0,00" ao lado do aviso continua sendo numero,
  // e numero na tela e lido.
  assert.ok(!/R\$/.test(resultado.c.texto), resultado.c.texto.slice(0, 400));
  assert.ok(!resultado.c.texto.includes(FRASE_DA_FAIXA), resultado.c.texto);
});

test("Erro do servidor: o OUTRO painel, e nao o de sem conexao", () => {
  assert.match(resultado.d.texto, /Deu erro aqui no nosso lado ao carregar a sua previsão/);
  assert.match(resultado.d.texto, /A conexao esta funcionando/);
  // O erro NAO vira "sem conexao": dizer isso a quem esta conectado manda a
  // pessoa reiniciar o roteador por causa de um defeito nosso.
  assert.ok(!resultado.d.texto.includes("Sem conexao"), resultado.d.texto);
});

test("Copia do aparelho e lista vazia: a tela NAO afirma o vazio", () => {
  assert.match(resultado.e.texto, new RegExp(FRASE_DA_FAIXA));
  assert.ok(
    !resultado.e.texto.includes("Nenhum compromisso previsto"),
    resultado.e.texto.slice(0, 500)
  );
  assert.ok(
    !resultado.e.texto.includes("Cadastre suas contas"),
    resultado.e.texto.slice(0, 500)
  );
  // A secao continua na tela -- o que sai e a AFIRMACAO, nao o cartao.
  assert.match(resultado.e.texto, /O que vem por aí/);
});

test("CONTROLE: fresco e lista vazia, as duas frases aparecem", () => {
  // Sem isto, o caso acima passaria verde numa tela que tivesse perdido o
  // convite de vez -- e e ele que diz o que fazer numa conta nova.
  assert.ok(!resultado.f.texto.includes(FRASE_DA_FAIXA), resultado.f.texto);
  assert.match(resultado.f.texto, /Nenhum compromisso previsto para os próximos 90 dias/);
  assert.match(resultado.f.texto, /Cadastre suas contas em/);
});

test("A primeira leitura sai SEM furar o cache do aparelho", () => {
  // A metade que impede o conserto de virar outro defeito: um parametro que
  // fosse sempre junto apagaria a leitura offline da tela mais pesada do app.
  assert.equal(resultado.g.antes.length, 1, JSON.stringify(resultado.g.antes));
  assert.match(resultado.g.antes[0], /^\/api\/cash-flow\?dias=90$/);
});

test("O botao Atualizar da faixa pede a leitura SEM a copia", () => {
  // `cache: "reload"` nao teria efeito sobre o Cache Storage do service worker:
  // o NetworkFirst continuaria servindo a copia, e o botao devolveria a mesma
  // faixa com o mesmo momento. Um parametro novo muda a CHAVE do cache, entao
  // nao ha copia para cair.
  assert.equal(resultado.g.clicou, true, "a faixa nao tem botao Atualizar");
  assert.equal(resultado.g.depois.length, 2, JSON.stringify(resultado.g.depois));
  const segunda = resultado.g.depois[1];
  assert.match(segunda, /^\/api\/cash-flow\?dias=90&semCopia=\d+$/);
});

test("o carimbo que esta sonda responde e o que PRODUCAO escreve e le", () => {
  // Sem este caso, a sonda e a pagina poderiam concordar num nome errado: eu
  // responderia com o cabecalho que eu mesmo inventei, a tela leria o mesmo, e
  // o service worker de verdade escreveria outro -- a faixa nunca apareceria
  // em producao e esta suite ficaria verde.
  const doServiceWorker = readFileSync("lib/pwa-runtime-cache.js", "utf8");
  assert.ok(
    doServiceWorker.includes(`"${MARCA}"`),
    `lib/pwa-runtime-cache.js nao escreve "${MARCA}"`
  );
  assert.ok(
    doServiceWorker.includes(`"${MARCA_QUANDO}"`),
    `lib/pwa-runtime-cache.js nao escreve "${MARCA_QUANDO}"`
  );

  const doClassificador = readFileSync(
    join(SAIDA, "lib/offline-leitura.js"),
    "utf8"
  );
  assert.ok(
    doClassificador.includes(`"${MARCA}"`),
    `lib/offline-leitura nao le "${MARCA}"`
  );
  assert.ok(
    doClassificador.includes(`"${MARCA_QUANDO}"`),
    `lib/offline-leitura nao le "${MARCA_QUANDO}"`
  );
});
