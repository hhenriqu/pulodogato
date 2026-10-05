// O INTERRUPTOR do modo papel de pao, em navegador de verdade -- HMO-283,
// mais o ROTULO do primeiro cartao do painel -- HMO-294.
//
// O QUE SO ESTA SUITE PROVA
// -------------------------
// `npm run test:modo-papel` ja cobre a preferencia: a leitura, o padrao, a
// classe que `aplicarModoPapel` liga, e o script inline do `<head>`. Repetir
// isso aqui nao provaria nada novo.
//
// O que falta e a FIACAO, e ela nao tem rede sem navegador: clicar no papelzinho
// troca a classe do `<html>`? E o Switch de Configuracoes faz a MESMA coisa? A
// issue pede os dois, e medir so um deixaria metade dela sem prova -- um
// `onClick` esquecido no segundo passaria verde com o primeiro.
//
// `react-dom/server`, que e como as outras suites de componente deste repo
// rodam, e cega para isso: `onClick` nao sai no HTML e nunca e chamado pelo
// render. A tela sairia identica com o handler vazio.
//
// A MEDIDA E A CLASSE DO <html>, ANTES -> DEPOIS
// ----------------------------------------------
// Nao "existe um botao com id papel-toggle", nao "o aria-label diz Ligar": as
// duas passariam verde com o modo desligado para sempre. O que a sonda compara e
// `document.documentElement.className` -- a mesma coisa que a pessoa ve virar
// marrom -- e, de quebra, o que ficou gravado no `localStorage`.
//
// E a sonda clica nos DOIS controles, e conta que um mexe no outro: eles
// dividem um `ModoPapelProvider`, entao ligar pelo cabecalho tem que acender o
// Switch de Configuracoes. "Espelho" e essa frase, e ela precisa de medida.
//
// O ROTULO DO PAINEL (HMO-294), E POR QUE ELE MORA AQUI
// -----------------------------------------------------
// A HMO-294 encurtou "Salario Previsto" para "Salario" no primeiro cartao do
// `PainelDePapel`. Rotulo e `string` literal passada como prop: o tsc, o lint e
// `npm run test:papel-de-pao` (que mede a ARITMETICA do painel) ficam todos
// verdes com o texto velho intacto -- e e a mesma familia de defeito que
// "campo de rotulo passa pela suite de aritmetica". Entao a prova tem de vir
// do DOM, e esta pagina ja e o lugar onde este repositorio le DOM de verdade.
//
// A ancora e o `data-rotulo` que o `NumeroGrande` ja emitia antes desta issue
// -- nao um atributo inventado para o teste --, e sao DUAS metades:
//
//   "Salario" PRESENTE e "Salario Previsto" AUSENTE.
//
// So a primeira passaria verde com o texto velho no lugar, porque "Salário" e
// substring de "Salário Previsto". Uma assercao so aqui nao mede nada.
//
// E a segunda metade e SENSIVEL A CAIXA, de proposito: `FRASE_SEM_SALARIO`
// ("nenhum salário previsto para este mês") continua na tela e continua certa.
// Um `includes` que ignorasse caixa reprovaria a frase que a issue manda
// manter -- e e por isso que a assercao compara os VALORES de `data-rotulo`,
// que e onde o titulo mora, e so depois procura a string exata no texto.
//
// O LIMITE: a arvore do painel e medida na fase `carregando`. O rotulo e o
// mesmo nas tres fases (ele e prop do cartao, nao do valor), e travar o `fetch`
// num Promise que nunca resolve e o que torna a fase DETERMINADA -- sem isso a
// leitura cairia em `carregando` ou em `erro` conforme o `file://` recusasse a
// chamada mais rapido ou mais devagar que o `flushSync`. O que esta fase NAO
// cobre e o texto do valor, e nada aqui afirma coisa alguma sobre ele.
//
// DOIS DETALHES DO AMBIENTE QUE DECIDIRAM O DESENHO (os dois medidos aqui)
// -----------------------------------------------------------------------
// 1. `ReactDOM.render` (legado) NAO roda o efeito de montagem de forma
//    sincrona: lido logo depois do render, o `mounted` do provider ainda e
//    false e os dois controles aparecem neutros. `ReactDOM.flushSync(() => {})`
//    descarrega os efeitos pendentes na hora -- e e o que a sonda chama depois
//    de cada render e de cada clique. Sem isso toda assercao mediria o estado
//    ANTERIOR, um falso negativo perfeitamente disfarcado de handler quebrado.
//    (`createRoot` nao serve por outro motivo, o mesmo de
//    scripts/test-divisao-ui-dom.mjs: a renderizacao vira agendada.)
// 2. `localStorage` FUNCIONA em `file://` neste Chromium -- medido antes de
//    escrever a suite. Por isso a sonda usa o storage de verdade, e nao um
//    esboco: o caminho que grava a preferencia e o mesmo do app.
//
// COMO O CODIGO DE PRODUCAO CHEGA NA PAGINA, E O QUE E ESBOCO
// ----------------------------------------------------------
// Num `<script>` CLASSICO, com o React UMD inline antes dele -- os caminhos
// limpos nao funcionam neste ambiente (ver o cabecalho de
// test-divisao-ui-dom.mjs: sem servidor local, sem `import` entre file://, sem
// `type=module`).
//
// Vao para a pagina, compilados e INTACTOS no corpo:
//
//   lib/theme.js, lib/modo-papel.js, components/ui/button.js,
//   components/ui/card.js, ModoPapelProvider.js, PapelToggle.js,
//   ConfiguracaoDePapel.js, PainelDePapel.js
//
// E SETE esbocos, cada um com um motivo e um limite declarado:
//
//   - `cn`, `cva`, `Slot`: a fiacao de CLASSE do Button. Sao calculo de string
//     (clsx + tailwind-merge + class-variance-authority), nao comportamento, e
//     nenhuma assercao daqui fala de classe de Tailwind -- quem cobra cor e
//     `npm run check-color-tokens`. Com eles o `Button` de producao entra de
//     verdade, e e isso que prova que `id`, `aria-pressed`, `aria-label` e
//     `onClick` atravessam ate o `<button>` do DOM;
//   - `Switch`: aqui o esboco e uma concessao de verdade, e vale dizer o
//     tamanho dela. `@radix-ui/react-switch` nao tem build UMD e nao ha
//     empacotador nesta sonda. O esboco respeita o CONTRATO do Radix (um
//     `button role="switch"` com `aria-checked`, que chama
//     `onCheckedChange(!checked)` no clique). Logo: o que esta provado e o MEU
//     lado do fio -- que o evento do Switch vira troca de modo e chega no
//     `<html>`. Que o Radix dispare `onCheckedChange` no clique nao esta
//     provado aqui; e o mesmo Switch que a aba Painel ja usa em oito linhas.
//   - `StickyNote`: um icone. Vira um `<svg>` vazio.
//   - `formatCurrency`, `FRASE_SEM_SALARIO`, `FRASE_SEM_CONTAS`: os tres do
//     painel, e os tres vao para a pagina como MARCADORES ("ESBOCO-...") em vez
//     de valores plausiveis. O motivo e o mesmo nos tres: trazer os valores de
//     verdade exigiria `lib/papel-de-pao.js` inteiro na pagina, e com ele oito
//     modulos (`previsto-x-realizado`, `parte-do-grupo`, `periodo-do-painel`,
//     `settlement`, `recurrence`, `dinheiro`, `moeda`, `types/financial`) que
//     nao tem nada a ver com rotulo nenhum.
//
//     O marcador e o que torna o esboco AUDITAVEL em vez de uma concessao
//     silenciosa: na fase que esta sonda mede, nenhum dos tres chega a
//     renderizar, e ha uma assercao que exige que a palavra "ESBOCO" NAO
//     apareca no painel. No dia em que alguem mover esta medida para a fase do
//     valor ou da frase vazia, ela reprova com o nome do esboco na mensagem --
//     e nao passa verde medindo um texto de mentira.
//
// Qualquer sobra de `import`/`export` nos .js estoura ANTES de a pagina rodar --
// sem isso o sintoma seria "a pagina nao reportou nada", indistinguivel de
// codigo quebrado. E nao basta procurar a PALAVRA `export`: o `card.js` termina
// num `export { Card, CardHeader, ... };`, e tirar so a palavra deixa
// `{ Card, CardHeader, ..., };` -- um bloco com virgula sobrando, que e
// SyntaxError. Por isso `paraScriptClassico` apaga essa forma inteira, e por
// isso cada parte passa por um `new Function` antes de entrar na pagina.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SAIDA = ".tmp-papel-na-tela";

/**
 * Acha um Chromium: o do `CHROMIUM_BIN`, o que o Playwright baixou, ou o Chrome
 * do sistema (o runner do Actions ja vem com um).
 *
 * Sem navegador este teste FALHA -- de proposito, e nao com `skip`. Uma suite
 * que se desliga sozinha quando falta o binario e indistinguivel de uma suite
 * que passou, e a unica prova de fiacao deste interruptor sumiria sem ninguem
 * notar.
 */
function acharChromium() {
  const candidatos = [process.env.CHROMIUM_BIN];

  for (const base of [
    `${process.env.HOME}/.cache/ms-playwright`,
    "/paperclip/.cache/ms-playwright",
  ]) {
    for (const dir of ["chromium-1243", "chromium_headless_shell-1243"]) {
      for (const sufixo of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
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

// --- os componentes, ja compilados -------------------------------------------
//
// Quem compila e o script `test:papel-na-tela` do package.json, como nas outras
// suites. Isso tambem e o que faz a segunda peneira do check-tests-in-ci.mjs
// enxergar os arquivos desta suite -- ela le os caminhos citados NO COMANDO.

if (!existsSync(join(SAIDA, "components/PapelToggle.js"))) {
  throw new Error(
    `${SAIDA}/ nao existe. Rode por \`npm run test:papel-na-tela\`, ` +
      "que e quem compila os componentes antes do teste."
  );
}

/** Tira so a fiacao de modulo, deixando o corpo das funcoes intacto. */
const paraScriptClassico = (fonte) =>
  fonte
    // O `import` emitido pelo tsc pode ocupar mais de uma linha quando a lista
    // de nomes e longa (e o caso do ModoPapelProvider), entao o recorte e do
    // `import` ate o `;` -- e nao de uma linha so, que deixaria metade da lista
    // de nomes solta no meio do script.
    .replace(/^import\s[\s\S]*?;$/gm, "")
    // O `export { A, B, ... };` do fim do card.js: apagado INTEIRO, e antes da
    // regra de baixo. Tirar so a palavra `export` deixaria um bloco com virgula
    // sobrando (`{ A, B, };`), que e SyntaxError -- e um que a peneira de
    // "sobrou `export`" nao pega, porque a palavra sumiu. `[^}]*` nao atravessa
    // chave, entao a forma `export { ... } from "..."` (que nao existe nestes
    // arquivos) e o corpo de qualquer funcao ficam fora do alcance.
    .replace(/^export\s*\{[^}]*\}\s*;$/gm, "")
    .replace(/^export /gm, "");

const PARTES = [
  // Ordem de dependencia. Nao e exigencia do JavaScript para funcao declarada
  // (ela e iceada), mas e para `const` de modulo -- e os quatro primeiros tem
  // varios.
  "lib/theme.js",
  "lib/modo-papel.js",
  // AS QUATRO DA HMO-295, e elas sao codigo de producao e nao esboco.
  // `periodo-do-painel.js` e de onde saem `passoDeMes`, `periodoCorrente`,
  // `ehPeriodoCorrente` e `rotuloDoPeriodo` -- as quatro funcoes que o passo de
  // mes usa, e as mesmas que o painel completo usa. Esbocar qualquer uma delas
  // faria a sonda medir a propria aritmetica de mes em vez da do app, que e
  // justamente o defeito que a issue existe para nao criar.
  //
  // Elas trazem `recurrence` (o `today()` em America/Sao_Paulo e o
  // `addMonthsClamped`), `dinheiro` e `moeda` atras de si. Sao quatro arquivos,
  // todos folha ou quase, e a ordem abaixo e a de dependencia:
  // moeda -> dinheiro, periodo-do-painel -> as tres.
  "lib/recurrence.js",
  "lib/dinheiro.js",
  "lib/moeda.js",
  "lib/periodo-do-painel.js",
  "components/ui/button.js",
  "components/ui/card.js",
  "components/ModoPapelProvider.js",
  "components/PapelToggle.js",
  "components/papel-de-pao/ConfiguracaoDePapel.js",
  "components/papel-de-pao/PainelDePapel.js",
];

const producao = PARTES.map((parte) => {
  const fonte = paraScriptClassico(readFileSync(join(SAIDA, parte), "utf8"));

  // Sobra de `import`/`export` e erro de sintaxe DENTRO da pagina, e o sintoma
  // disso e a pagina nao reportar nada -- indistinguivel de codigo quebrado.
  const sobra = fonte.match(/^\s*(import|export)\s.*$/m);
  if (sobra) {
    throw new Error(
      `sobrou fiacao de modulo em ${parte}: ${sobra[0].trim()}\n` +
        "ajuste paraScriptClassico()"
    );
  }

  // E a peneira que a de cima nao substitui: o strip pode produzir codigo sem
  // nenhum `import`/`export` sobrando e ainda assim invalido (foi o caso do
  // `{ Card, CardHeader, };`). Aqui o erro aparece com o NOME DO ARQUIVO, em
  // vez de virar "a pagina nao reportou resultado" vinte linhas depois.
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

// E a TERCEIRA peneira, que as duas de cima nao substituem: cada parte pode
// parsear sozinha e o CONCATENADO ainda ser invalido -- duas partes declarando
// o mesmo `const` de modulo e um SyntaxError do script inteiro, e o sintoma
// disso e "a pagina nao reportou nada". Com oito modulos de producao na pagina
// (eram quatro antes da HMO-295) isso deixou de ser hipotetico.
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

// A pagina e montada com template literal, e NUNCA com `String.replace`: o
// bundle do React tem `$$typeof` dentro, e numa string de substituicao `$$`
// vira `$` -- o bundle chega corrompido na pagina e o erro e
// "React is not defined", que nao se le como o que e.
const PAGINA = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="theme-color" content="#ffffff">
</head><body>
<div id="raiz-a"></div><div id="raiz-b"></div><div id="raiz-c"></div>
<div id="raiz-d"></div><div id="raiz-e"></div><div id="raiz-f"></div>
<div id="resultado">a pagina nao rodou</div>
<script>${umd("react", "react.development.js")}</script>
<script>${umd("react-dom", "react-dom.development.js")}</script>
<script>
try {
// Os hooks que os componentes usam por nome, do React global -- o \`import\`
// deles foi removido junto com o resto da fiacao de modulo.
const {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} = React;

// --- os quatro esbocos (ver o cabecalho do .mjs) -----------------------------

/** clsx + tailwind-merge: junta o que nao e falso. Calculo de string. */
const cn = (...partes) => partes.filter(Boolean).join(" ");

/** class-variance-authority: devolve a classe base. Nenhuma assercao le classe. */
const cva = (base) => () => base;

/** Nao usado: o PapelToggle nao passa \`asChild\`. Existe para o import sumir. */
const Slot = "span";

/** Icones. Viram \`<svg>\` vazios -- nenhuma assercao fala de desenho. */
const StickyNote = (props) =>
  React.createElement("svg", { ...props, "data-icone": "sticky-note" });
const ChevronLeft = (props) =>
  React.createElement("svg", { ...props, "data-icone": "chevron-left" });
const ChevronRight = (props) =>
  React.createElement("svg", { ...props, "data-icone": "chevron-right" });

/**
 * Os tres esbocos do painel, como MARCADORES e nao como valores plausiveis.
 *
 * Nenhum dos tres renderiza na fase que a sonda mede (\`carregando\`), e ha uma
 * assercao exigindo que "ESBOCO" nao apareca no painel -- entao se alguem mover
 * a medida para a fase do valor ou da frase vazia, ela reprova com o nome do
 * esboco na mensagem em vez de medir um texto de mentira. O motivo de serem
 * esbocos esta no cabecalho do .mjs: os valores de verdade arrastariam
 * \`lib/papel-de-pao.js\` e outros oito modulos para dentro desta pagina.
 */
const formatCurrency = (valor) => "ESBOCO-VALOR:" + valor;
const FRASE_SEM_SALARIO = "ESBOCO-FRASE-SALARIO";
const FRASE_SEM_CONTAS = "ESBOCO-FRASE-CONTAS";

/**
 * O \`fetch\` do painel: por padrao TRAVADO, e trocavel por caso.
 *
 * O travado e um Promise que nunca resolve nem rejeita, e nao e para "evitar
 * rede" -- e para a FASE ser determinada. Sem isto, o \`file://\` recusa a
 * chamada e o componente cai em \`erro\` em algum momento entre o render e a
 * leitura, conforme a recusa chegue antes ou depois do \`flushSync\`; a leitura
 * do rotulo ficaria certa nos dois casos, mas a do TEXTO (que e o controle do
 * esboco) oscilaria entre duas telas diferentes.
 *
 * \`pedidos\` guarda as URLs, e e a MEDIDA do passo de mes da HMO-295: o que a
 * seta tem de trocar e o \`?month=\` que vai para a rota, e isso nao aparece em
 * nenhum pixel da tela. Uma sonda que lesse so o rotulo passaria verde com um
 * \`fetch\` que ignorasse o mes -- a tela diria "novembro de 2026" sobre os
 * numeros de outubro, que e o defeito inteiro desta issue de cabeca para baixo.
 */
const pedidos = [];
let respondeFetch = () => new Promise(() => {});
window.fetch = (url) => {
  pedidos.push(String(url));
  return respondeFetch(String(url));
};

/** O mes que a URL pediu, ou null -- o oraculo e a propria querystring. */
const mesDoPedido = (url) => {
  const achado = String(url).match(/[?&]month=([^&]*)/);
  return achado ? decodeURIComponent(achado[1]) : null;
};

/**
 * Uma resposta de verdade da rota, com o \`month\` ESCOLHIVEL.
 *
 * O \`month\` e parametro e nao copia do pedido de proposito: e com ele que a
 * sonda fabrica o caso "a resposta chegou de outro mes" (cache do PWA, rota que
 * nao reconheceu o parametro) e mede que a tela NAO a pinta.
 */
const respostaDaRota = (month, salario, contas) => ({
  ok: true,
  status: 200,
  json: () =>
    Promise.resolve({
      month,
      range: { from: month + "-01", to: month + "-28" },
      salario_previsto: { total: salario, quantidade: 1 },
      total_de_contas: { total: contas, quantidade: 1 },
    }),
});

/**
 * Esboco do Switch com o CONTRATO do Radix: \`button role="switch"\`,
 * \`aria-checked\`, e \`onCheckedChange(!checked)\` no clique.
 *
 * O limite esta declarado no cabecalho do .mjs: isto prova o meu lado do fio,
 * nao o do Radix.
 */
const Switch = ({ checked, onCheckedChange, ...resto }) =>
  React.createElement("button", {
    ...resto,
    type: "button",
    role: "switch",
    "aria-checked": checked ? "true" : "false",
    onClick: () => onCheckedChange(!checked),
  });

${producao}

// --- utilitarios da sonda ----------------------------------------------------

const html = document.documentElement;
const CHAVE = MODO_PAPEL_STORAGE_KEY;

/**
 * Descarrega os efeitos pendentes -- em VARIAS voltas, e a contagem importa.
 *
 * Com \`ReactDOM.render\` o efeito de montagem do provider NAO roda sincrono:
 * sem nenhuma volta, o \`mounted\` lido aqui ainda e false, os dois controles
 * saem neutros, e toda assercao mediria o estado anterior ao gesto.
 *
 * E uma volta nao basta. Cada \`flushSync\` esvazia UMA camada de efeitos, e a
 * primeira camada do provider CHAMA setState (\`setModoState(lerModoPapel())\` +
 * \`setMounted(true)\`) -- o efeito que de fato escreve a classe no \`<html>\` esta
 * na camada SEGUINTE. Com uma volta so, o caso B (preferencia ja salva) lia um
 * \`<html>\` sem a classe e parecia defeito do provider; nao era, era a sonda
 * fotografando no meio do caminho. No navegador de verdade essas camadas
 * acontecem no mesmo quadro, e a classe nunca sai da tela porque o
 * PAPEL_INIT_SCRIPT ja a tinha posto antes da primeira pintura.
 *
 * Para alem da ultima camada as voltas sao no-ops, entao o laco e barato e o
 * limite esta aqui so para nao girar para sempre se alguem escrever um efeito
 * que se realimenta.
 */
const assentar = () => {
  for (let volta = 0; volta < 6; volta++) ReactDOM.flushSync(() => {});
};

/** Monta a arvore de um caso e devolve leituras ESCOPADAS no container dele. */
const montar = (raiz) => {
  const caixa = document.getElementById(raiz);

  // Os DOIS controles sob o MESMO provider: e essa partilha que faz um ser
  // espelho do outro, e e ela que a sonda mede.
  ReactDOM.render(
    React.createElement(
      ModoPapelProvider,
      null,
      React.createElement(PapelToggle),
      React.createElement(ConfiguracaoDePapel)
    ),
    caixa
  );
  assentar();

  // Escopado no container: os ids sao os MESMOS nas tres arvores desta pagina,
  // e \`getElementById\` devolve o primeiro do DOCUMENTO -- sem o escopo, "o
  // botao do caso C" leria o do caso A e a assercao falaria de outra arvore.
  const achar = (id) => caixa.querySelector("[id='" + id + "']");

  return {
    caixa,
    achar,
    desmontar: () => ReactDOM.unmountComponentAtNode(caixa),
    /** O estado visivel, dos dois controles e do <html>, de uma vez. */
    ler: () => ({
      classesDoHtml: html.className.split(" ").filter(Boolean).sort(),
      barraDeStatus: document
        .querySelector('meta[name="theme-color"]')
        .getAttribute("content"),
      gravado: (() => {
        try { return localStorage.getItem(CHAVE); } catch (_) { return "SEM STORAGE"; }
      })(),
      // O cabecalho.
      pressionado: achar("papel-toggle").getAttribute("aria-pressed"),
      rotulo: achar("papel-toggle").getAttribute("aria-label"),
      // O espelho em Configuracoes.
      switchMarcado: achar("papel-config-switch").getAttribute("aria-checked"),
      estado: achar("papel-config-estado").textContent,
    }),
    clicarNoPapelzinho: () => {
      achar("papel-toggle").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      assentar();
    },
    clicarNoSwitch: () => {
      achar("papel-config-switch").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      assentar();
    },
  };
};

/**
 * Zera o ambiente entre os casos.
 *
 * Quem limpa e a SONDA, nao o codigo de producao: as tres arvores vivem na mesma
 * pagina e dividem um \`<html>\` e um \`localStorage\`. Sem isto o caso B comecaria
 * com a classe que o caso A deixou e passaria verde sem ter feito nada.
 */
const limpar = ({ escuro = false, preferencia = null } = {}) => {
  html.className = escuro ? "dark" : "";
  document
    .querySelector('meta[name="theme-color"]')
    .setAttribute("content", escuro ? THEME_COLOR.dark : THEME_COLOR.light);
  try {
    if (preferencia === null) localStorage.removeItem(CHAVE);
    else localStorage.setItem(CHAVE, preferencia);
  } catch (_) {}
};

const r = {};

// =============================================================================
// CASO A -- CONTA NOVA, TEMA CLARO: os dois interruptores, e um e espelho do outro
// =============================================================================

limpar();
const a = montar("raiz-a");

r.a_antes = a.ler();

// O pedido da issue, literal: "para ativar tera um icone de um papelzinho".
a.clicarNoPapelzinho();
r.a_apos_papelzinho = a.ler();

// Segundo clique: o papelzinho e um INTERRUPTOR, nao um botao de so ligar. Sem
// este, um handler que escrevesse "ligado" fixo passaria na assercao de cima.
a.clicarNoPapelzinho();
r.a_apos_segundo_clique = a.ler();

// E agora pelo OUTRO controle -- "e tambem em configuracoes". O estado que ele
// le e o estado que o papelzinho acabou de deixar, porque os dois dividem um
// provider.
a.clicarNoSwitch();
r.a_apos_switch = a.ler();

// E de volta, pelo Switch. Os quatro gestos cobrem liga/desliga nos dois
// controles.
a.clicarNoSwitch();
r.a_apos_switch_de_volta = a.ler();

a.desmontar();

// =============================================================================
// CASO B -- A PREFERENCIA JA SALVA: a tela abre no modo, sem clique nenhum
// =============================================================================
// O que o PAPEL_INIT_SCRIPT faz no <head> de verdade, o provider tem de refazer
// depois de hidratar -- senao o React remove a classe que o script pos, e a pele
// cai no meio da navegacao.

limpar({ preferencia: "ligado" });
const b = montar("raiz-b");
r.b = b.ler();

// Valor sujo no storage NAO liga o modo (o par negativo do caso acima).
b.desmontar();
limpar({ preferencia: "true" });
const b2 = montar("raiz-b");
r.b_sujo = b2.ler();
b2.desmontar();

// =============================================================================
// CASO C -- PAPEL + ESCURO: os dois modos convivem
// =============================================================================
// A razao de existirem DUAS paletas de papel. Se ligar papel de pao apagasse a
// classe \`dark\`, o botao de Claro/Escuro pararia de ter efeito dentro do modo --
// e interruptor que nao faz nada e pior que interruptor nenhum.

limpar({ escuro: true });
const c = montar("raiz-c");
r.c_antes = c.ler();

c.clicarNoPapelzinho();
r.c_com_papel = c.ler();

c.clicarNoPapelzinho();
r.c_sem_papel = c.ler();

c.desmontar();

// =============================================================================
// CASO D -- O PAINEL: os rotulos dos dois cartoes, lidos do DOM
// =============================================================================
// O \`PainelDePapel\` nao depende do provider nem do modo: ele e a tela que o
// portao de /dashboard devolve QUANDO o modo esta ligado, e por dentro nao
// consulta o modo para nada. Entao aqui ele e montado solto, e o que se mede e
// so o que ele escreve.
//
// A leitura e o \`data-rotulo\` de cada cartao -- o atributo que o
// \`NumeroGrande\` ja emitia antes da HMO-294 -- e o texto do container inteiro.

limpar();
const caixaD = document.getElementById("raiz-d");
ReactDOM.render(React.createElement(PainelDePapel), caixaD);
assentar();

r.d = {
  rotulos: Array.from(caixaD.querySelectorAll("[data-rotulo]")).map((el) =>
    el.getAttribute("data-rotulo")
  ),
  // CONTROLE POSITIVO da montagem: o cartao de producao, e nao um esboco.
  // \`font-papel\` sai do \`className\` do \`NumeroGrande\`, e \`rounded-lg\` do
  // \`Card\`. Sem este par, "nenhum data-rotulo diz Salario Previsto" ficaria
  // verde num container VAZIO -- que e a aparencia de um render que estourou.
  cartoes: caixaD.querySelectorAll("[data-rotulo].font-papel").length,
  comCard: caixaD.querySelectorAll(".rounded-lg").length,
  texto: caixaD.textContent,
  // O pedido que a montagem disparou: ele JA tem de trazer o parametro do mes,
  // senao a rota responde o corrente e a moldura da tela nunca e verificavel.
  pedido: pedidos[pedidos.length - 1] || null,
};

ReactDOM.unmountComponentAtNode(caixaD);

// =============================================================================
// CASOS E e F -- O PASSO DE MES (HMO-295). ASSINCRONOS, e esse e o ponto.
// =============================================================================
// Os casos acima medem a fase \`carregando\`, que e sincrona. Daqui para baixo a
// resposta da rota RESOLVE, e a continuacao dela e um microtask: com
// \`ReactDOM.flushSync\` sozinho -- que e sincrono -- a sonda fotografaria sempre
// o estado anterior a resposta, e "a tela nao pintou o mes errado" ficaria verde
// porque a tela nao pintou nada.
//
// So microtask, nunca \`setTimeout\`: a fila de microtasks drena no fim da tarefa
// atual, muito antes de o \`--dump-dom\` fotografar; um temporizador seria uma
// corrida contra o momento da foto.
(async () => {
try {

/** Drena os microtasks E as camadas de efeito, intercalados. */
const assentarAsync = async () => {
  for (let volta = 0; volta < 8; volta++) {
    await Promise.resolve();
    ReactDOM.flushSync(() => {});
  }
};

/** Monta o painel solto e devolve as leituras do passo de mes. */
const montarPainel = async (raiz) => {
  const caixa = document.getElementById(raiz);
  ReactDOM.render(React.createElement(PainelDePapel), caixa);
  await assentarAsync();

  const achar = (id) => caixa.querySelector("[id='" + id + "']");

  return {
    desmontar: () => ReactDOM.unmountComponentAtNode(caixa),
    ler: () => ({
      // O rotulo entre as setas -- o unico lugar da tela que diz QUAL mes os
      // numeros abaixo respondem.
      rotulo: achar("papel-mes-rotulo").textContent,
      // O mes que a tela acha que esta mostrando.
      mesNaTela: achar("papel-mes-rotulo").getAttribute("data-mes"),
      // O mes que ela PEDIU. Os dois podem divergir, e e disso que o caso F
      // trata.
      mesPedido: mesDoPedido(pedidos[pedidos.length - 1]),
      pedidos: pedidos.length,
      // O "Hoje" existe? (criterio 2: so fora do mes corrente)
      temHoje: Boolean(achar("papel-mes-hoje")),
      texto: caixa.textContent,
    }),
    clicar: async (id) => {
      achar(id).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await assentarAsync();
    },
  };
};

// --- CASO E: as setas, o rotulo e o "Hoje" -----------------------------------
// A rota de mentira ECOA o mes pedido, que e o que a de verdade faz. Assim
// todas as leituras caem na fase \`pronto\` e o que varia e so o mes.

pedidos.length = 0;
respondeFetch = (url) =>
  Promise.resolve(respostaDaRota(mesDoPedido(url), 7000, 2000));

const e = await montarPainel("raiz-e");
r.e_inicio = e.ler();

await e.clicar("papel-mes-seguinte");
r.e_mais_um = e.ler();

await e.clicar("papel-mes-seguinte");
r.e_mais_dois = e.ler();

// O "Hoje" volta para o mes corrente de qualquer distancia -- nao um passo
// para tras.
await e.clicar("papel-mes-hoje");
r.e_hoje = e.ler();

// E a seta da esquerda anda para TRAS, que e a outra metade do pedido ("quanto
// eu tinha de contas no mes passado").
await e.clicar("papel-mes-anterior");
r.e_menos_um = e.ler();

e.desmontar();

// --- CASO F: a tela nao pinta resposta de OUTRO mes --------------------------
// Criterio 5. A rota de mentira responde sempre o mes ANTERIOR ao pedido: e o
// que acontece quando o cache do PWA (24h nas rotas /api/) devolve a resposta de
// outro mes, e tambem o que aconteceria se a rota ignorasse o \`?month=\`.
//
// O par e o que torna isto mensuravel. Sem o controle positivo logo abaixo,
// "nao pintou o valor" ficaria verde num painel que nao pinta valor nenhum --
// um \`fetch\` quebrado, um esboco faltando, um \`json()\` que estourou.

pedidos.length = 0;
respondeFetch = (url) => {
  const pedido = mesDoPedido(url);
  const ano = Number(pedido.slice(0, 4));
  const mes = Number(pedido.slice(5, 7));
  const anterior = mes === 1 ? (ano - 1) + "-12" : ano + "-" + String(mes - 1).padStart(2, "0");
  return Promise.resolve(respostaDaRota(anterior, 7000, 2000));
};

const f = await montarPainel("raiz-f");
r.f_descartado = f.ler();
f.desmontar();

// O CONTROLE POSITIVO: a MESMA resposta, com o mes certo, PINTA.
pedidos.length = 0;
respondeFetch = (url) =>
  Promise.resolve(respostaDaRota(mesDoPedido(url), 7000, 2000));

const f2 = await montarPainel("raiz-f");
r.f_pintado = f2.ler();
f2.desmontar();

alvoResultado();
} catch (e) {
  document.getElementById("resultado").textContent =
    "ERRO NA PAGINA: " + (e && (e.stack || e.message));
}
})();

function alvoResultado() {
  document.getElementById("resultado").textContent =
    "RESULTADO" + JSON.stringify(r) + "FIM";
}
} catch (e) {
  // Sem isto, um erro aqui dentro vira "a pagina nao reportou nada" e o motivo
  // real fica dentro do navegador, invisivel.
  document.getElementById("resultado").textContent =
    "ERRO NA PAGINA: " + (e && (e.stack || e.message));
}
</script></body></html>`;

// =============================================================================
// A SEGUNDA PAGINA: A PELE -- o CSS de verdade, medido pelo navegador
// =============================================================================
// Esta metade existe porque as assercoes de cima provam que a CLASSE chega no
// `<html>` e param ali. "A classe esta no lugar" nao e "o app ficou marrom e
// manuscrito": o CSS pode nao casar, a paleta pode ser vencida por outra regra,
// e a fonte pode nunca se aplicar -- sem nada reclamar em tsc, em lint, na
// guarda de cores nem nas assercoes de cima.
//
// E ja aconteceu, neste PR, exatamente com a fonte. A primeira versao punha
// `font-family` dentro do bloco `.papel`, que mora no `<html>`. O
// `inter.className` do next/font mora no `<body>`, e declaracao feita
// DIRETAMENTE num elemento vence valor HERDADO do pai -- qualquer que seja a
// especificidade. O modo ficava bege com a letra de sempre. O conserto e
// `.papel body`, que declara no mesmo elemento.
//
// COMO O CSS DE PRODUCAO E O NEXT/FONT CHEGAM AQUI
// -----------------------------------------------
// O CSS e compilado pelo proprio Tailwind, a partir do `app/globals.css` do
// repositorio -- nao e uma copia das regras. O que entra "a mao" e so o par de
// classes que o next/font gera, e o formato delas foi COPIADO DO BUILD DE
// VERDADE (`.next/static/css/*.css` de um `npm run build`):
//
//   .__className_f367f3{font-family:__Inter_f367f3,__Inter_Fallback_f367f3;...}
//   .__variable_e71c01{--font-papel:"__Patrick_Hand_e71c01",...}
//
// Os nomes trazem um hash que muda a cada build, entao eles nao podem ser
// afirmados; o que importa e a FORMA -- uma classe no `<body>` declarando
// `font-family`, e outra declarando a variavel. E essa forma que a regra do
// globals.css tem de vencer.
//
// `@font-face` nenhum e baixado: a sonda nao mede qual desenho de letra
// apareceu, mede QUAL FAMILIA o navegador escolheu para o `<body>`.

const CSS_COMPILADO = (() => {
  const saida = join(SAIDA, "pele.css");
  execFileSync(
    process.execPath,
    [
      join("node_modules", "tailwindcss", "lib", "cli.js"),
      "-i",
      "app/globals.css",
      "-o",
      saida,
      // O `content` do tailwind.config.js varre app/ e components/ inteiros, o
      // que aqui seria trabalho jogado fora: nenhuma assercao desta sonda fala
      // de classe utilitaria, so dos blocos de token e da familia.
      "--content",
      "app/globals.css",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const css = readFileSync(saida, "utf8");

  // Se o bloco que esta sonda existe para medir nao estiver no CSS compilado, o
  // navegador acharia "nenhum papel de pao" e TODAS as assercoes de pele
  // passariam a medir a ausencia dele.
  for (const esperado of [".papel", ".dark.papel", ".papel body"]) {
    if (!css.includes(esperado)) {
      throw new Error(
        `o CSS compilado nao tem o bloco ${esperado} -- a sonda de pele mediria nada`
      );
    }
  }
  return css;
})();

const PAGINA_DA_PELE = `<!doctype html>
<html id="raiz-html"><head><meta charset="utf-8">
<style>${CSS_COMPILADO}</style>
<style>
/* O par de classes do next/font, na forma do build de verdade (ver acima). */
.classe-do-app { font-family: InterDeMentira, sans-serif; font-style: normal; }
.variavel-da-manuscrita { --font-papel: "PatrickHandDeMentira"; }
</style>
</head>
<body id="corpo" class="classe-do-app variavel-da-manuscrita">
<div id="resultado">a pagina nao rodou</div>
<script>
try {
const html = document.getElementById("raiz-html");
const corpo = document.getElementById("corpo");
const r = {};

const medir = () => {
  const c = getComputedStyle(corpo);
  return {
    fundo: c.backgroundColor,
    texto: c.color,
    // Primeira familia da lista: e a que o navegador usaria se ela existisse, e
    // e nela que a briga entre o globals.css e o next/font se decide.
    fonte: c.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, ""),
  };
};

html.className = "";
r.normal = medir();

html.className = "dark";
r.escuro = medir();

html.className = "papel";
r.papel = medir();

html.className = "dark papel";
r.papelEscuro = medir();

document.getElementById("resultado").textContent =
  "RESULTADO" + JSON.stringify(r) + "FIM";
} catch (e) {
  document.getElementById("resultado").textContent =
    "ERRO NA PAGINA: " + (e && (e.stack || e.message));
}
</script></body></html>`;

// --- roda o navegador --------------------------------------------------------

const chromium = acharChromium();
let resultado = null;
let pele = null;
let erroDeExecucao = null;

/** Roda uma pagina no Chromium e devolve o JSON que ela escreveu na div. */
function rodarPagina(nomeDoArquivo, html) {
  const dir = mkdtempSync(join(tmpdir(), "papel-na-tela-"));
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
  const achado = dump.match(/id="resultado">([^<]*)</);
  if (!achado) {
    throw new Error(`${nomeDoArquivo} nao carregou:\n${dump.slice(0, 1500)}`);
  }

  const relato = achado[1];
  if (relato.startsWith("ERRO NA PAGINA")) throw new Error(relato);

  const bruto = relato.match(/^RESULTADO(\{[\s\S]*\})FIM$/);
  if (!bruto) {
    throw new Error(`${nomeDoArquivo} nao reportou resultado, e sim: ${relato}`);
  }
  return JSON.parse(bruto[1]);
}

try {
  if (!chromium) throw new Error(SEM_NAVEGADOR);
  resultado = rodarPagina("papel.html", PAGINA);
  pele = rodarPagina("pele.html", PAGINA_DA_PELE);
} catch (e) {
  erroDeExecucao = e;
}

// -----------------------------------------------------------------------------

// As duas cores de barra de status do modo, lidas do proprio modulo -- a suite
// test:modo-papel ja prova que elas espelham o globals.css.
const PAPEL_CLARO = "#eee4d3";
const PAPEL_ESCURO = "#231810";

test("o navegador rodou e reportou as duas paginas", () => {
  if (erroDeExecucao) throw erroDeExecucao;
  assert.ok(resultado, "sem resultado da pagina do interruptor");
  assert.ok(pele, "sem resultado da pagina da pele");
});

test("A: a conta nova abre SEM papel de pao", () => {
  // O controle que da sentido a todos os de baixo: se a classe estivesse ali
  // desde o inicio, "clicar liga" seria verde sem o clique fazer nada.
  assert.deepEqual(resultado.a_antes.classesDoHtml, []);
  assert.equal(resultado.a_antes.gravado, null);
  assert.equal(resultado.a_antes.pressionado, "false");
  assert.equal(resultado.a_antes.switchMarcado, "false");
  assert.match(resultado.a_antes.estado, /^Desligado/);
});

test("A: clicar no papelzinho troca a classe do <html>", () => {
  // O pedido da issue, e a medida dele: a mesma classe que faz o app ficar
  // marrom.
  assert.deepEqual(
    resultado.a_apos_papelzinho.classesDoHtml,
    ["papel"],
    "o clique no papelzinho nao chegou no <html>"
  );
  // E a escolha fica salva -- sem isso ela morre no proximo F5.
  assert.equal(resultado.a_apos_papelzinho.gravado, "ligado");
  // E a barra de status do app instalado acompanha a tela.
  assert.equal(resultado.a_apos_papelzinho.barraDeStatus, PAPEL_CLARO);
});

test("A: o papelzinho e um interruptor -- o segundo clique desliga", () => {
  assert.deepEqual(resultado.a_apos_segundo_clique.classesDoHtml, []);
  assert.equal(resultado.a_apos_segundo_clique.gravado, "desligado");
  assert.equal(resultado.a_apos_segundo_clique.barraDeStatus, "#ffffff");
});

test("A: o Switch de Configuracoes faz a MESMA coisa", () => {
  // A outra metade do que a issue pede. Medir so o papelzinho deixaria um
  // `onCheckedChange` esquecido passando verde.
  assert.deepEqual(
    resultado.a_apos_switch.classesDoHtml,
    ["papel"],
    "o clique em Configuracoes nao chegou no <html>"
  );
  assert.equal(resultado.a_apos_switch.gravado, "ligado");

  // E ele tambem desliga.
  assert.deepEqual(resultado.a_apos_switch_de_volta.classesDoHtml, []);
  assert.equal(resultado.a_apos_switch_de_volta.gravado, "desligado");
});

test("A: um controle e espelho do outro, nao um segundo estado", () => {
  // "Tambem em configuracoes" so e verdade se os dois contarem a MESMA coisa.
  // Dois provedores separados -- o erro facil de cometer no layout -- passariam
  // em todas as assercoes de cima e falhariam nesta.
  assert.equal(resultado.a_apos_papelzinho.switchMarcado, "true");
  assert.match(resultado.a_apos_papelzinho.estado, /^Ligado/);

  assert.equal(resultado.a_apos_switch.pressionado, "true");
  assert.match(resultado.a_apos_switch.rotulo, /Desligar/);

  // E no caminho de volta os dois voltam juntos.
  assert.equal(resultado.a_apos_switch_de_volta.switchMarcado, "false");
  assert.equal(resultado.a_apos_switch_de_volta.pressionado, "false");
  assert.match(resultado.a_apos_switch_de_volta.rotulo, /Ligar/);
});

test("B: preferencia salva abre a tela no modo, sem clique", () => {
  // Se o provider nao reaplicasse a classe depois de hidratar, o React
  // removeria a que o PAPEL_INIT_SCRIPT pos no <head> e a pele cairia no meio
  // da navegacao.
  assert.deepEqual(resultado.b.classesDoHtml, ["papel"]);
  assert.equal(resultado.b.pressionado, "true");
  assert.equal(resultado.b.switchMarcado, "true");
  assert.equal(resultado.b.barraDeStatus, PAPEL_CLARO);
});

test("B: valor sujo no storage NAO liga o modo", () => {
  // O par negativo do de cima. Sem ele, "abre ligado" ficaria verde num
  // provider que liga o modo para qualquer coisa que esteja na chave.
  assert.deepEqual(resultado.b_sujo.classesDoHtml, []);
  assert.equal(resultado.b_sujo.pressionado, "false");
  assert.equal(resultado.b_sujo.switchMarcado, "false");
});

test("C: papel de pao e modo escuro convivem no <html>", () => {
  // A razao de `.papel` e `.dark.papel` serem dois blocos em globals.css. Se
  // ligar papel apagasse `dark`, o botao de Claro/Escuro pararia de ter efeito
  // dentro do modo, sem dizer por que.
  assert.deepEqual(resultado.c_antes.classesDoHtml, ["dark"]);

  assert.deepEqual(
    resultado.c_com_papel.classesDoHtml,
    ["dark", "papel"],
    "ligar papel de pao derrubou (ou ignorou) o modo escuro"
  );
  // E a barra de status e a do PAPEL ESCURO -- nem a do papel claro, nem a do
  // escuro normal.
  assert.equal(resultado.c_com_papel.barraDeStatus, PAPEL_ESCURO);

  // Desligar o papel devolve o escuro inteiro, e nao a tela clara.
  assert.deepEqual(resultado.c_sem_papel.classesDoHtml, ["dark"]);
  assert.equal(resultado.c_sem_papel.barraDeStatus, "#020817");
});

// -----------------------------------------------------------------------------
// O PAINEL: o rotulo do primeiro cartao (HMO-294)
// -----------------------------------------------------------------------------

test("D: o painel montou de verdade -- dois cartoes de producao", () => {
  // O controle que da sentido aos dois de baixo. "Salario Previsto nao aparece"
  // e verdade tambem num container vazio, que e a aparencia de um render que
  // estourou, de um esboco faltando ou de um seletor escrito errado.
  assert.equal(resultado.d.cartoes, 2, "os dois <p> do NumeroGrande nao chegaram no DOM");
  assert.equal(resultado.d.comCard, 2, "os dois Card de producao nao chegaram no DOM");
  assert.equal(resultado.d.rotulos.length, 2);
});

test("D: o primeiro cartao diz Salário, e nao Salário Previsto", () => {
  // AS DUAS METADES. So a primeira passaria verde com o texto velho intacto,
  // porque "Salário" e substring de "Salário Previsto" -- e a assercao de
  // presenca sozinha e exatamente o teste que a HMO-294 nao pode ter.
  assert.deepEqual(
    resultado.d.rotulos,
    ["Salário", "Total de contas"],
    "o rotulo do painel nao e o que a HMO-294 pediu"
  );

  // A segunda metade, sobre o TEXTO da tela e nao so sobre o atributo: o
  // rotulo e renderizado duas vezes pelo `NumeroGrande` (no `<p>` de cima e no
  // `data-rotulo`), e um conserto feito so num dos dois deixaria o titulo
  // velho visivel com o atributo certo.
  assert.ok(
    !resultado.d.texto.includes("Salário Previsto"),
    `"Salário Previsto" ainda esta na tela do modulo: ${resultado.d.texto}`
  );
  assert.ok(resultado.d.texto.includes("Salário"));
});

test("D: a leitura e da fase `carregando` -- nenhum esboco na tela", () => {
  // O controle dos tres esbocos do painel (`formatCurrency`,
  // `FRASE_SEM_SALARIO`, `FRASE_SEM_CONTAS`). Eles vao para a pagina como
  // marcadores justamente para que isto seja mensuravel: se alguem mover esta
  // medida para a fase do valor ou da frase vazia, o texto de mentira aparece
  // aqui com o nome do esboco, em vez de passar por tela de verdade.
  assert.ok(
    !resultado.d.texto.includes("ESBOCO"),
    `um esboco do painel renderizou: ${resultado.d.texto}`
  );
  // E a fase e a que se diz: o `Valor` de `carregando` e um `…` e so.
  assert.match(resultado.d.texto, /…/);
});

// -----------------------------------------------------------------------------
// O PASSO DE MES (HMO-295)
// -----------------------------------------------------------------------------
// OS ORACULOS DESTA SECAO SAO ESCRITOS AQUI, A MAO, e isso e deliberado: eles
// tem de ser INDEPENDENTES de `lib/periodo-do-painel.ts`, que e o codigo medido.
// Importar `passoDeMes` para conferir o resultado de `passoDeMes` seria a sonda
// se medindo a si mesma -- a aritmetica de mes daquela biblioteca ja tem a
// propria suite (`npm run test:periodo-painel`), e o que falta provar aqui e que
// a SETA chega nela e que o mes resultante vai para a rota.

/** Soma meses a 'AAAA-MM'. Aritmetica inteira, sem `Date`, sem a lib. */
const somaMes = (mes, n) => {
  const total = Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1 + n;
  const ano = Math.floor(total / 12);
  const m = total - ano * 12 + 1;
  return `${String(ano).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
};

/** Os nomes dos meses, para conferir o rotulo. Copia de oraculo, de proposito. */
const NOMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const rotuloEsperado = (mes) =>
  `${NOMES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;

/**
 * O mes corrente em America/Sao_Paulo -- a mesma conta de `today()`, escrita
 * aqui pela razao acima.
 *
 * E a UNICA assercao desta secao que depende do relogio, e ela e a que importa:
 * o painel tem de ABRIR no mes corrente, e no fuso certo. `new Date()
 * .toISOString().slice(0, 7)` e UTC, e nas tres ultimas horas do ultimo dia do
 * mes em Sao Paulo ele ja aponta para o mes SEGUINTE -- foi assim que o painel
 * mostrou as contas de outubro no dia 30 de setembro (HMO-173).
 */
const MES_DE_HOJE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
})
  .format(new Date())
  .slice(0, 7);

test("o oraculo de mes desta secao esta certo (controle do proprio teste)", () => {
  // Sem este caso, um `somaMes` quebrado faria TODA assercao abaixo comparar
  // dois valores errados -- e a virada de ano e exatamente onde ele quebraria.
  assert.equal(somaMes("2026-10", 1), "2026-11");
  assert.equal(somaMes("2026-12", 1), "2027-01");
  assert.equal(somaMes("2026-01", -1), "2025-12");
  assert.equal(somaMes("2026-10", 0), "2026-10");
  assert.equal(rotuloEsperado("2026-10"), "outubro de 2026");
  assert.equal(rotuloEsperado("2027-01"), "janeiro de 2027");
  assert.match(MES_DE_HOJE, /^\d{4}-\d{2}$/);
});

test("E: o painel abre no mes corrente de Sao Paulo, e JA pede esse mes", () => {
  // Criterio 1 e 3: o rotulo e `outubro de 2026`, e a rota recebe
  // `?month=2026-10` desde a montagem. Sem o parametro no primeiro pedido, a
  // rota responde o mes corrente por conta propria e a moldura da tela nunca
  // passa a ser verificavel.
  assert.equal(resultado.e_inicio.mesNaTela, MES_DE_HOJE);
  assert.equal(resultado.e_inicio.mesPedido, MES_DE_HOJE);
  assert.equal(resultado.e_inicio.rotulo, rotuloEsperado(MES_DE_HOJE));

  // E o painel na fase `carregando` do caso D tambem ja pedia o mes -- a mesma
  // montagem, antes de qualquer clique.
  assert.match(
    String(resultado.d.pedido),
    /\/api\/papel-de-pao\/painel\?month=\d{4}-\d{2}$/,
    `a montagem do painel nao pediu um mes: ${resultado.d.pedido}`
  );
});

test("E: o Hoje aparece SO fora do mes corrente", () => {
  // Criterio 2, nos dois sentidos -- e o par e o que mede: "o botao existe"
  // sozinho passaria verde com ele sempre na tela, e "nao existe" sozinho
  // passaria verde com ele nunca.
  assert.equal(
    resultado.e_inicio.temHoje,
    false,
    "o `Hoje` esta na tela no mes corrente, onde ele nao teria para onde levar"
  );
  assert.equal(resultado.e_mais_um.temHoje, true);
  assert.equal(resultado.e_mais_dois.temHoje, true);
  assert.equal(
    resultado.e_hoje.temHoje,
    false,
    "o `Hoje` continuou na tela depois de voltar para o mes corrente"
  );
  assert.equal(resultado.e_menos_um.temHoje, true);
});

test("E: cada clique na seta anda UM mes -- no rotulo e no `?month=`", () => {
  // O criterio 1 e o 6 juntos. As duas leituras importam e por razoes
  // diferentes: `mesNaTela` e a moldura que a pessoa ve, e `mesPedido` e o que
  // de fato foi perguntado a rota. Um `fetch` que ignorasse o mes passaria na
  // primeira e falharia na segunda -- a tela diria "novembro" sobre os numeros
  // de outubro, que e esta issue de cabeca para baixo.
  const mais1 = somaMes(MES_DE_HOJE, 1);
  const mais2 = somaMes(MES_DE_HOJE, 2);

  assert.equal(resultado.e_mais_um.mesNaTela, mais1);
  assert.equal(resultado.e_mais_um.mesPedido, mais1);
  assert.equal(resultado.e_mais_um.rotulo, rotuloEsperado(mais1));

  // DOIS cliques andam DOIS meses. Sem este, um handler que trocasse o mes por
  // um valor fixo ("o mes seguinte ao de hoje") passaria no caso de cima.
  assert.equal(resultado.e_mais_dois.mesNaTela, mais2);
  assert.equal(resultado.e_mais_dois.mesPedido, mais2);
  assert.equal(resultado.e_mais_dois.rotulo, rotuloEsperado(mais2));

  // E a seta da esquerda anda para TRAS, a partir do mes corrente.
  const menos1 = somaMes(MES_DE_HOJE, -1);
  assert.equal(resultado.e_menos_um.mesNaTela, menos1);
  assert.equal(resultado.e_menos_um.mesPedido, menos1);
});

test("E: o `Hoje` volta ao mes corrente de qualquer distancia", () => {
  // Ele e clicado a DOIS meses de distancia de proposito: um "Hoje" implementado
  // como um passo de -1 mes passaria verde se a sonda o clicasse a um mes so.
  assert.equal(resultado.e_hoje.mesNaTela, MES_DE_HOJE);
  assert.equal(resultado.e_hoje.mesPedido, MES_DE_HOJE);
  assert.equal(resultado.e_hoje.rotulo, rotuloEsperado(MES_DE_HOJE));
});

test("E: cada mes novo e UM pedido novo -- a tela nao reusa a resposta velha", () => {
  // Cinco leituras, cinco pedidos: montagem + 2 setas + Hoje + 1 seta. Se o
  // efeito nao dependesse do mes, a contagem ficaria em 1 e os numeros do mes
  // corrente apareceriam debaixo do rotulo de novembro.
  assert.equal(resultado.e_inicio.pedidos, 1);
  assert.equal(resultado.e_mais_um.pedidos, 2);
  assert.equal(resultado.e_mais_dois.pedidos, 3);
  assert.equal(resultado.e_hoje.pedidos, 4);
  assert.equal(resultado.e_menos_um.pedidos, 5);
});

test("E: a fase `pronto` pinta o valor -- a resposta de mentira chegou", () => {
  // O controle positivo de toda a secao E: sem ele, as assercoes de rotulo
  // acima estariam medindo uma tela que nunca saiu de `carregando`, e "o mes
  // mudou" seria verdade sobre um painel que nao mostra numero nenhum.
  assert.match(
    resultado.e_inicio.texto,
    /ESBOCO-VALOR:7000/,
    `o painel nao chegou na fase pronto: ${resultado.e_inicio.texto}`
  );
  assert.match(resultado.e_mais_dois.texto, /ESBOCO-VALOR:7000/);
});

test("F: a tela NAO pinta resposta cujo `month` nao e o pedido", () => {
  // Criterio 5. A resposta vem com o mes ANTERIOR ao pedido -- o que o cache do
  // PWA (24h nas rotas /api/) devolve, e tambem o que a rota devolveria se
  // ignorasse o `?month=`. Os numeros seriam plausiveis e estariam debaixo do
  // rotulo errado, que e a familia de defeito que custou a HMO-173.
  assert.notEqual(
    resultado.f_descartado.mesPedido,
    null,
    "o caso F nao chegou a pedir mes nenhum"
  );
  assert.ok(
    !/ESBOCO-VALOR/.test(resultado.f_descartado.texto),
    `a tela pintou o valor de outro mes: ${resultado.f_descartado.texto}`
  );
  assert.match(resultado.f_descartado.texto, /indispon/);

  // E a moldura continua dizendo o mes PEDIDO, e nao o que veio na resposta: o
  // rotulo nao pode ser puxado pela resposta errada.
  assert.equal(
    resultado.f_descartado.mesNaTela,
    resultado.f_descartado.mesPedido
  );
});

test("F: o CONTROLE POSITIVO -- a mesma resposta, com o mes certo, pinta", () => {
  // Sem este, "nao pintou o valor" ficaria verde num painel que nao pinta valor
  // nenhum: um `fetch` quebrado, um esboco faltando, um `json()` que estourou.
  // As duas respostas do caso F sao identicas menos no campo `month`.
  assert.match(
    resultado.f_pintado.texto,
    /ESBOCO-VALOR:7000/,
    `a resposta do mes certo tambem nao pintou: ${resultado.f_pintado.texto}`
  );
  assert.ok(!/indispon/.test(resultado.f_pintado.texto));
  assert.equal(resultado.f_pintado.mesNaTela, resultado.f_pintado.mesPedido);
});

// -----------------------------------------------------------------------------
// A PELE: o que o navegador de fato pinta
// -----------------------------------------------------------------------------
// As cores sao as dos blocos de app/globals.css, convertidas de HSL para o rgb
// que o `getComputedStyle` devolve. Nao e um numero inventado: `.papel` declara
// `--background: 38 44% 88%`, e e esse o bege que tem de chegar na tela.

const BEGE = "rgb(238, 228, 211)"; // .papel        --background 38 44% 88%
const MARROM = "rgb(35, 24, 16)"; // .dark.papel   --background 25 36% 10%
const BRANCO = "rgb(255, 255, 255)"; // :root         --background 0 0% 100%
const AZUL_ESCURO = "rgb(2, 8, 23)"; // .dark         --background 222.2 84% 4.9%

test("a pele: sem papel de pao, o app e o de sempre", () => {
  // O controle que da sentido aos de baixo. Sem ele, "fica bege" passaria verde
  // numa folha em que TODO estado e bege.
  assert.equal(pele.normal.fundo, BRANCO);
  assert.equal(pele.escuro.fundo, AZUL_ESCURO);
});

test("a pele: a classe papel deixa o app bege", () => {
  assert.equal(
    pele.papel.fundo,
    BEGE,
    "a classe `papel` esta no <html> mas a paleta de papel nao chega na tela"
  );
  // E o texto nao e o mesmo do tema claro -- paleta trocada pela metade deixa
  // texto escuro de um tema sobre o fundo do outro.
  assert.notEqual(pele.papel.texto, pele.normal.texto);
});

test("a pele: papel + escuro da a QUARTA paleta, nao uma das outras tres", () => {
  // A razao de `.dark.papel` existir. Os tres `notEqual` sao o que impede o
  // empate silencioso: um seletor escrito errado faria este caso cair em
  // `.papel`, em `.dark` ou em `:root`, e um `equal` contra o marrom escrito a
  // mao nao distinguiria isso de uma paleta que nao existe.
  assert.equal(pele.papelEscuro.fundo, MARROM);
  assert.notEqual(pele.papelEscuro.fundo, pele.papel.fundo);
  assert.notEqual(pele.papelEscuro.fundo, pele.escuro.fundo);
  assert.notEqual(pele.papelEscuro.fundo, pele.normal.fundo);
});

test("a pele: a letra manuscrita vence o next/font no <body>", () => {
  // O DEFEITO REAL que esta assercao fechou, achado no codigo intacto deste PR
  // e nao num mutante: com `font-family` dentro do bloco `.papel` (que vive no
  // <html>), o `inter.className` do next/font (que vive no <body>) ganhava
  // sempre -- declaracao direta no elemento vence valor herdado do pai, por mais
  // especifico que o pai seja. O modo ficava bege com a letra de sempre, e nada
  // em tsc, lint, check-color-tokens ou nas assercoes de classe acima via isso.
  assert.match(
    pele.normal.fonte,
    /Inter/,
    "o controle quebrou: fora do modo a fonte deveria ser a do app"
  );
  assert.match(
    pele.papel.fonte,
    /PatrickHand/,
    "a letra manuscrita nao chegou no <body> -- o next/font esta vencendo a regra do globals.css"
  );
  // E no papel escuro tambem: a familia sai de `.papel body`, que vale nos dois.
  assert.match(pele.papelEscuro.fonte, /PatrickHand/);
  // E sair do modo devolve a fonte do app.
  assert.match(pele.escuro.fonte, /Inter/);
});
