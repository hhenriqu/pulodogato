#!/usr/bin/env node
// =====================================================
// PULODOGATO - as tres acoes da linha, em navegador de verdade (HMO-301)
// =====================================================
//   npm run test:lista-na-tela
//
// "E em ambos os modos verificar pois todos lancamentos devem ter botoes de
// editar, excluir ou confirmar pra validar que foi pago ou recebido."
//
// O QUE SO ESTA SUITE PROVA
// -------------------------
// `npm run test:acoes-da-linha` cobre a REGRA (quais botoes, para onde vao, e o
// texto de cada pergunta) com 34 blocos. `npm run test:secao-da-tela` cobre a
// MARCACAO (quais botoes saem no HTML, por estado de linha) com `react-dom/server`.
// As duas juntas passam verde com o `onClick` VAZIO: `onClick` nao sai no HTML e
// nunca e chamado por um render de servidor, e a tela sai identica.
//
// O que falta e o GESTO, e ele tem duas metades que se parecem e nao sao:
//
//   1. o clique chegou na rota certa, com o id certo;
//   2. o APP REFLETIU O RESULTADO -- a linha saiu de "Previsto no período" e
//      apareceu em "Realizado no período".
//
// A (2) e a assercao que importa, e e a unica que distingue "chamou a rota" de
// "funcionou". Um `aoConfirmar` que chamasse a baixa e esquecesse a releitura
// passaria na (1) inteira: a rota responde 200, o dinheiro anda no banco, e a
// linha fica onde estava ate alguem trocar de mes e voltar. O app teria feito a
// coisa certa e dito o contrario -- que e pior que nao ter feito, porque a
// pessoa clica de novo e a segunda baixa volta 409 em cima de uma operacao que
// deu certo.
//
// E e por isso que esta suite monta `ListaDeMovimentacao` e nao `SecaoDaTela`:
// a releitura mora no componente que e dono do `fetch`. Ate a HMO-301 ela morava
// em `TelaDeMovimentacao.tsx`, que importa `next/navigation` -- e `next/navigation`
// nao roda no node, entao nada neste repositorio alcancava este gesto.
//
// A RECEITA DO AMBIENTE
// ---------------------
// A base e a de scripts/test-divisao-ui-dom.mjs e scripts/test-papel-na-tela.mjs
// (`file://` + script CLASSICO + `--dump-dom`; React pelo UMD INLINE;
// `ReactDOM.render` legado e nao `createRoot`, porque o legado renderiza
// sincrono e descarrega a atualizacao no fim do evento). O que esta suite
// acrescenta e o que a HMO-295 descobriu e esta aqui levado ao limite:
//
//   O COMPONENTE LE A REDE, ENTAO `flushSync` SOZINHO NAO BASTA. A continuacao
//   de um `await` e um MICROTASK, e a fila de microtasks so drena no fim da
//   tarefa atual -- ou seja, depois que o `<script>` inteiro terminar.
//   `flushSync` e sincrono e nao a drena. Sem drenar intercalado
//   (`await Promise.resolve()` + `flushSync`, varias voltas), toda leitura cai
//   na fase `carregando`: a lista nao pinta NADA, e uma assercao negativa do
//   tipo "a linha nao esta mais no Previsto" fica VERDE porque nao ha linha
//   nenhuma na tela. Indistinguivel de uma feature que funciona.
//
//   Por isso a pagina inteira e uma IIFE `async`, com `try/catch` proprio (a
//   rejeicao dela nao cai no `try` de fora), e cada passo drena ANTES de medir.
//   O caso A tem DUAS drenagens: uma depois do render e outra depois do clique.
//
// `setTimeout` NAO entra em lugar nenhum: a fila de microtasks drena muito antes
// de o `--dump-dom` fotografar, e um temporizador seria uma corrida contra o
// momento da foto.
//
// O QUE E MEDIDO, E O QUE NAO PODE SER
// ------------------------------------
// A medida da (1) sao as REQUISICOES INTERCEPTADAS -- url, metodo e corpo --, e
// nao estado interno do componente. A medida da (2) e em QUAL SECAO o nome da
// linha aparece, lido do DOM.
//
// E as duas secoes sao achadas por ESTRUTURA, nao por classe nem por atributo
// inventado para o teste: `ListaDeMovimentacao` devolve um fragmento, entao os
// dois `Card` de secao sao FILHOS DIRETOS do container de montagem. A sonda
// pega `[...container.children]` e escolhe pelo titulo exato ("Previsto no
// período" / "Realizado no período"). Os SUBTITULOS das duas secoes tambem
// contem "no período" -- e por isso a comparacao e com o titulo inteiro, e nao
// com um pedaco dele.
//
// COMO O CODIGO DE PRODUCAO CHEGA NA PAGINA, E O QUE E ESBOCO
// ----------------------------------------------------------
// Vao compilados e INTACTOS no corpo (ver `PARTES`, em ordem de dependencia):
//
//   lib/offline-leitura.js  -- `buscarLeitura`, que e O CAMINHO DE REDE do app.
//                              Esbocar isso seria esbocar a feature;
//   lib/movimentacoes.js, lib/destino-do-lancamento.js, lib/chave-da-fatura.js,
//   lib/telas-de-movimentacao.js -- `secoesDaTela` e quem separa Previsto de
//                              Realizado por `origem`. ELA E A ASSERCAO (2):
//                              esbocada, a sonda mediria a propria sonda;
//   lib/retorno-do-lancamento.js, lib/acoes-da-linha.js -- a regra e as URLs;
//   components/ui/button.js, components/ui/card.js -- `id`, `aria-label`,
//                              `disabled` e `onClick` atravessando ate o DOM;
//   components/movimentacoes/SecaoDaTela.js, ListaDeMovimentacao.js.
//
// E os esbocos, cada um com motivo e limite:
//
//   - `cn`, `cva`, `Slot`: a fiacao de CLASSE do Button. Calculo de string
//     (clsx + tailwind-merge + cva), nao comportamento, e nenhuma assercao daqui
//     fala de classe -- quem cobra cor e `npm run check-color-tokens`. Com eles
//     o Button de PRODUCAO entra de verdade;
//   - os nove icones do lucide: viram `<svg>` vazio. Icone novo num dos dois
//     componentes estoura alto e claro ("ReferenceError: X is not defined"),
//     pelo `try/catch` que a pagina tem;
//   - `Link`: respeita o contrato do next/link (um `<a href>` que envolve os
//     filhos). O que fica provado e o MEU lado do fio -- que o href montado por
//     `caminhoDeEdicao` chega no DOM; que o Next intercepte o clique, nao;
//   - `toast` (sonner): um registrador. O texto do toast NAO e assercao de
//     ninguem aqui -- o que se mede e a REQUISICAO e o DOM. Ele existe para o
//     caminho de erro nao estourar;
//   - `CartoesDaTela` e os tres paineis de `components/SemRede`: MARCADORES
//     ("ESBOCO-CARTOES", "ESBOCO-SEM-REDE"...). Eles nao participam de nenhuma
//     assercao desta suite (os tres numeros tem `npm run test:cartoes-da-tela`),
//     e marcados eles sao auditaveis: ha uma assercao exigindo que a palavra
//     ESBOCO nao apareca DENTRO das duas secoes;
//   - `caminhoDoCartaoNoMes` e `formatCurrency`: marcadores. O primeiro
//     arrastaria `lib/periodo-do-painel` -> `recurrence`, `dinheiro`, `moeda`
//     por um `href` que `npm run test:secao-da-tela` ja afirma; o segundo so
//     formata o cartao sem vencimento, que nao aparece em caso nenhum daqui.
//     `moeda` -- o formatador que escreve o VALOR da linha -- e de producao.
//
// AS TRES PENEIRAS DE SINTAXE, e nenhuma substitui as outras
// ----------------------------------------------------------
//   1. sobrou `import`/`export` numa parte -> estoura com o nome do arquivo;
//   2. `new Function(parte)` por parte -> pega o que a (1) nao pega (um
//      `export { A, B, };` de barril perde a PALAVRA e deixa virgula sobrando);
//   3. `new Function(concatenado)` -> pega o que nenhuma das duas pega: duas
//      partes declarando o mesmo `const` de MODULO. Com onze modulos de
//      producao na pagina isso nao e hipotetico -- foi por isso que
//      `ListaDeMovimentacao` passou a usar `formatCurrency` em vez de declarar
//      um `moeda` proprio, igual ao de `SecaoDaTela`. O sintoma seria "a pagina
//      nao reportou nada", sem o nome de arquivo nenhum.
//
// E SEM NAVEGADOR ESTA SUITE FALHA, nunca `skip`: uma suite que se desliga
// sozinha quando falta o binario e indistinguivel de uma que passou, e a unica
// prova do gesto desta issue sumiria sem ninguem notar.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SAIDA = ".tmp-lista-na-tela";

/**
 * Acha um Chromium: o do `CHROMIUM_BIN`, o que o Playwright baixou, ou o Chrome
 * do sistema (o runner do Actions ja vem com um). Mesma busca das outras duas
 * sondas de navegador deste repositorio.
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
// Quem compila e o script `test:lista-na-tela` do package.json. Isso tambem e o
// que faz a segunda peneira do check-tests-in-ci.mjs enxergar os arquivos desta
// suite -- ela le os caminhos citados NO COMANDO.

if (!existsSync(join(SAIDA, "components/movimentacoes/ListaDeMovimentacao.js"))) {
  throw new Error(
    `${SAIDA}/ nao existe. Rode por \`npm run test:lista-na-tela\`, ` +
      "que e quem compila os componentes antes do teste."
  );
}

/** Tira so a fiacao de modulo, deixando o corpo das funcoes intacto. */
const paraScriptClassico = (fonte) =>
  fonte
    // O `import` emitido pelo tsc ocupa mais de uma linha quando a lista de
    // nomes e longa (e o caso dos dois componentes), entao o recorte e do
    // `import` ate o `;` -- nao de uma linha so, que deixaria metade da lista
    // de nomes solta no meio do script.
    .replace(/^import\s[\s\S]*?;$/gm, "")
    // O `export { A, B, ... };` de fim de arquivo (card.js): apagado INTEIRO, e
    // ANTES da regra de baixo. Tirar so a palavra deixaria `{ A, B, };`, que e
    // SyntaxError -- e um que a peneira de "sobrou export" nao pega, porque a
    // palavra sumiu. `[^}]*` nao atravessa chave, entao corpo de funcao e
    // `export { ... } from "..."` ficam fora do alcance.
    .replace(/^export\s*\{[^}]*\}\s*;$/gm, "")
    .replace(/^export /gm, "");

const PARTES = [
  // ORDEM DE DEPENDENCIA. Nao e exigencia do JavaScript para funcao declarada
  // (ela e iceada), mas e para `const` de modulo -- e quase todos tem varios.
  "lib/offline-leitura.js",
  "lib/movimentacoes.js",
  "lib/destino-do-lancamento.js",
  "lib/chave-da-fatura.js",
  "lib/telas-de-movimentacao.js",
  "lib/retorno-do-lancamento.js",
  "lib/acoes-da-linha.js",
  "components/ui/button.js",
  "components/ui/card.js",
  "components/movimentacoes/SecaoDaTela.js",
  "components/movimentacoes/ListaDeMovimentacao.js",
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

// A pagina e montada com template literal, e NUNCA com `String.replace`: o
// bundle do React tem `$$typeof` dentro, e numa string de substituicao `$$`
// vira `$` -- o bundle chega corrompido e o erro e "React is not defined", que
// nao se le como o que e.
const PAGINA = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<div id="raiz-a"></div><div id="raiz-b"></div><div id="raiz-c"></div>
<div id="raiz-d"></div><div id="raiz-e"></div><div id="raiz-f"></div>
<div id="raiz-g"></div>
<div id="resultado">a pagina nao rodou</div>
<script>${umd("react", "react.development.js")}</script>
<script>${umd("react-dom", "react-dom.development.js")}</script>
<script>
// UM UNICO <script>, E ISSO NAO E ARRUMACAO
// -----------------------------------------
// Os esbocos e os hooks sao \`const\` de TOPO DE SCRIPT, e o codigo de producao os
// resolve por NOME no momento da chamada. Dentro de uma funcao (a IIFE \`async\`
// abaixo) eles passam a ser locais DELA, e nenhuma funcao de producao os
// alcanca: o erro e \`ReferenceError: useState is not defined\`, estourado la
// dentro do primeiro render -- medido, e nao se le como um problema de escopo.
//
// Por isso a ordem e: hooks e esbocos no topo, producao em seguida (ela precisa
// que os nomes existam quando ela RODA, nao quando e definida), e a IIFE por
// ultimo.
const { useCallback, useEffect, useMemo, useState } = React;

// --- os esbocos (ver o cabecalho do .mjs) ------------------------------------

/** clsx + tailwind-merge: junta o que nao e falso. Calculo de string. */
const cn = (...partes) => partes.filter(Boolean).join(" ");

/** class-variance-authority: so devolve a base. Calculo de string. */
const cva = (base) => () => base;

/** O Slot do Radix: o \`asChild\` do Button. Clona o filho com as props dele. */
const Slot = React.forwardRef(function Slot(props, ref) {
  const { children, ...resto } = props;
  return React.cloneElement(children, { ...resto, ref });
});

/** Os nove icones. Icone novo estoura como ReferenceError, e isso e bom. */
const icone = (nome) => (props) =>
  React.createElement("svg", { "data-icone": nome, className: props.className });
const AlertCircle = icone("AlertCircle");
const CalendarClock = icone("CalendarClock");
const Check = icone("Check");
const CheckCircle2 = icone("CheckCircle2");
const CreditCard = icone("CreditCard");
const Loader2 = icone("Loader2");
const Pencil = icone("Pencil");
const Repeat = icone("Repeat");
const Trash2 = icone("Trash2");

/** next/link: o contrato e um \`<a href>\` que envolve os filhos. */
const Link = React.forwardRef(function Link(props, ref) {
  const { href, children, ...resto } = props;
  return React.createElement("a", { href, ref, ...resto }, children);
});

/** sonner: um registrador. Nenhuma assercao desta suite le o texto do toast. */
const TOASTS = [];
const toast = {
  success: (m) => TOASTS.push({ tipo: "success", texto: String(m) }),
  error: (m) => TOASTS.push({ tipo: "error", texto: String(m) }),
};

/** Os tres cartoes e os paineis de rede: marcadores, fora de toda assercao. */
const CartoesDaTela = () =>
  React.createElement("div", null, "ESBOCO-CARTOES");
const FaixaDadoDoAparelho = () =>
  React.createElement("div", null, "ESBOCO-DO-APARELHO");
const PainelSemRede = () =>
  React.createElement("div", null, "ESBOCO-SEM-REDE");
const PainelErroDoServidor = () =>
  React.createElement("div", null, "ESBOCO-ERRO-DO-SERVIDOR");

/** Marcadores: o href do cartao e a moeda do cartao sem vencimento. */
const caminhoDoCartaoNoMes = (conta, mes) =>
  "ESBOCO-CAMINHO:" + conta + ":" + mes;
const formatCurrency = (v) => "ESBOCO-VALOR:" + v;

// --- o codigo de producao, no MESMO escopo dos esbocos acima -----------------
${producao}

// --- a sonda, numa IIFE async ------------------------------------------------
//
// \`async\` porque os componentes leem a rede: a continuacao de um \`await\` e um
// microtask, e \`flushSync\` sozinho fotografa a tela ANTES da resposta. O
// \`try/catch\` e PROPRIO porque a rejeicao de uma IIFE async nao cai em try de
// fora nenhum.
(async function () {
try {

// --- a rede, interceptada ----------------------------------------------------
//
// AS REQUISICOES SAO A MEDIDA de "o gesto chegou na rota": o rotulo da tela
// muda mesmo com o \`fetch\` pedindo a URL errada, e o estado interno do
// componente nao prova nada sobre o que saiu do aparelho.

/** Toda chamada que saiu, na ordem: metodo, url e corpo. */
let CHAMADAS = [];
/** As respostas do \`/api/movimentacoes/resumo\`, em fila. A ultima repete. */
let FILA_DO_RESUMO = [];

const resposta = (corpo) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => corpo,
});

window.fetch = async (url, init) => {
  const metodo = (init && init.method) || "GET";
  const corpo = init && init.body ? JSON.parse(init.body) : null;
  CHAMADAS.push({ metodo, url: String(url), corpo });

  if (String(url).startsWith("/api/movimentacoes/resumo")) {
    // \`shift\` enquanto houver mais de uma: a ultima resposta vale para toda
    // releitura seguinte, e assim um caso que relê duas vezes nao estoura.
    const atual =
      FILA_DO_RESUMO.length > 1 ? FILA_DO_RESUMO.shift() : FILA_DO_RESUMO[0];
    return resposta(atual);
  }

  // A acao sempre da certo: o caminho de ERRO nao e o assunto desta suite (ele
  // e o \`toast.error\`, e nao muda o DOM da lista).
  return resposta({ message: "ok" });
};

/** As perguntas de \`confirm()\`, e a resposta que a sonda da para cada uma. */
let PERGUNTAS = [];
let RESPOSTA_DO_CONFIRM = true;
window.confirm = (mensagem) => {
  PERGUNTAS.push(String(mensagem));
  return RESPOSTA_DO_CONFIRM;
};

// --- as linhas -------------------------------------------------------------

const EU = "a1b2c3d4-e5f6-4789-abcd-ef0123456789";
const OUTRO = "99999999-8888-4777-b666-555544443333";
const CARTAO = "33333333-3333-4333-b333-333333333333";

const linha = (extra) =>
  Object.assign(
    {
      id: "s-1",
      gravada: true,
      posso_editar: true,
      descricao: "Aluguel",
      valor: 2500,
      data: "2026-10-15",
      origem: "previsto",
      tipo: "expense",
      status: "pending",
      situacao: "pending",
      categoria: "Moradia",
      conta: "de Itaú",
      moeda: null,
      natureza: "despesa",
      fatura: null,
    },
    extra
  );

const corpo = (linhas) => ({
  resumo: { total: 0, previsto: 0, realizado: 0, quantidade: linhas.length },
  vencido: { total: 0, quantidade: 0 },
  linhas,
  fatura_sem_vencimento: [],
});

const TELA = {
  tipo: "expense",
  rota: "/dashboard/despesas",
  titulo: "Despesas",
  oQueOPrevistoE: "o que ainda vence no período",
  oQueORealizadoE: "o que já saiu da sua conta",
};

const APARENCIA = {
  Icone: icone("TrendingDown"),
  cor: "text-destructive",
  rotaDeLancar: "/dashboard/movimentacoes/despesa",
  textoDeLancar: "Nova Despesa",
  palavraDaLinha: "Despesa",
};

// --- o arnes ---------------------------------------------------------------

/**
 * DRENA A FILA DE MICROTASKS E AS CAMADAS DE EFEITO, INTERCALADO.
 *
 * So \`flushSync\` nao serve: a continuacao do \`await\` dentro de \`carregar\` e um
 * microtask, e \`flushSync\` e sincrono. So \`await\` tambem nao: o \`setState\` do
 * \`ReactDOM.render\` legado so aparece no DOM depois da descarga. As duas, varias
 * voltas -- \`carregar\` -> \`buscarLeitura\` -> \`fetch\` -> \`json\` sao quatro saltos,
 * e a releitura depois da acao dobra isso.
 *
 * E NUNCA \`setTimeout\`: a fila de microtasks drena muito antes de o
 * \`--dump-dom\` fotografar; um temporizador seria uma corrida contra a foto.
 */
async function assentar() {
  for (let i = 0; i < 24; i++) {
    await Promise.resolve();
    ReactDOM.flushSync(function () {});
  }
}

/** Monta a lista num container, com a fila de respostas do resumo. */
async function montar(idDaRaiz, respostas) {
  CHAMADAS = [];
  PERGUNTAS = [];
  FILA_DO_RESUMO = respostas;

  const raiz = document.getElementById(idDaRaiz);
  ReactDOM.render(
    React.createElement(ListaDeMovimentacao, {
      tipo: "expense",
      tela: TELA,
      aparencia: APARENCIA,
      queryDoPeriodo: "de=2026-10-01&ate=2026-10-31",
      rotuloDoPeriodo: "outubro de 2026",
      origem: "/dashboard/despesas?de=2026-10-01&ate=2026-10-31",
      rodape: null,
    }),
    raiz
  );
  await assentar();
  return raiz;
}

/**
 * A SECAO, POR ESTRUTURA e nao por classe nem atributo inventado.
 *
 * \`ListaDeMovimentacao\` devolve um fragmento, entao os dois \`Card\` de secao sao
 * FILHOS DIRETOS do container. O titulo e comparado INTEIRO ("Previsto no
 * período") porque os SUBTITULOS das duas secoes tambem contem "no período" --
 * um pedaco do titulo casaria com a secao errada.
 */
const secao = (raiz, titulo) =>
  Array.prototype.slice
    .call(raiz.children)
    .find((el) => el.textContent.indexOf(titulo) !== -1) || null;

const PREVISTO = "Previsto no período";
const REALIZADO = "Realizado no período";

/** O que uma secao mostra, reduzido ao que as assercoes leem. */
function retrato(raiz, titulo) {
  const el = secao(raiz, titulo);
  if (!el) return null;
  return {
    texto: el.textContent.replace(/\\s+/g, " ").trim(),
    acoes: Array.prototype.slice
      .call(el.querySelectorAll("[aria-label]"))
      .filter((b) => b.tagName === "BUTTON" || b.tagName === "A")
      .map((b) => ({
        rotulo: b.getAttribute("aria-label"),
        tag: b.tagName,
        href: b.getAttribute("href"),
        desabilitado: b.disabled === true,
      })),
  };
}

/** Clica num botao pelo \`aria-label\`, dentro de UMA secao. */
async function clicar(raiz, titulo, rotulo) {
  const el = secao(raiz, titulo);
  if (!el) throw new Error("secao ausente: " + titulo);
  const botao = el.querySelector('[aria-label="' + rotulo + '"]');
  if (!botao) {
    throw new Error(
      "botao ausente: " + rotulo + " em " + titulo + " -- " + el.textContent
    );
  }
  botao.click();
  await assentar();
}

/**
 * Escreve num input pelo SETTER NATIVO.
 *
 * \`el.value = x\` direto NAO dispara \`onChange\`: o React guarda o ultimo valor
 * que ELE escreveu e compara com o atual, e atribuir direto atualiza esse cache
 * tambem -- a sonda passaria verde sem nunca ter chamado o handler.
 */
function digitar(el, valor) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const out = {};

// =========================================================================
// A. CONFIRMAR: a rota certa, o id certo, E A LINHA MUDA DE SECAO
// =========================================================================
// A releitura devolve a MESMA conta como linha REALIZADA -- que e o que a baixa
// de verdade produz: uma \`financial_transaction\` nova, com outro id, outra data
// e \`origem: "realizado"\`. Nao e a mesma linha com um campo trocado, e e por
// isso que a tela nao pode remendar o array local: ela tem de reler.
{
  const previsto = corpo([linha({ id: "s-1", descricao: "Aluguel" })]);
  const depois = corpo([
    linha({
      id: "t-9",
      descricao: "Aluguel",
      origem: "realizado",
      status: null,
      situacao: null,
      data: "2026-10-16",
    }),
  ]);

  const raiz = await montar("raiz-a", [previsto, depois]);

  out.a_antes = {
    previsto: retrato(raiz, PREVISTO),
    realizado: retrato(raiz, REALIZADO),
    chamadas: CHAMADAS.slice(),
  };

  await clicar(raiz, PREVISTO, "Confirmar pagamento");

  out.a_depois = {
    previsto: retrato(raiz, PREVISTO),
    realizado: retrato(raiz, REALIZADO),
    chamadas: CHAMADAS.slice(),
    toasts: TOASTS.slice(),
  };
}

// =========================================================================
// B. A LINHA REALIZADA nao tem Confirmar
// =========================================================================
{
  const raiz = await montar("raiz-b", [
    corpo([
      linha({ id: "t-1", origem: "realizado", status: null, situacao: null }),
    ]),
  ]);
  out.b = {
    realizado: retrato(raiz, REALIZADO),
    previsto: retrato(raiz, PREVISTO),
  };
}

// =========================================================================
// C. A FATURA ABERTA (gravada: false) nao tem botao nenhum
// =========================================================================
{
  const raiz = await montar("raiz-c", [
    corpo([
      linha({
        id: "fatura:2026-10-01:" + CARTAO,
        gravada: false,
        posso_editar: false,
        descricao: "Fatura Nubank",
        natureza: "fatura",
        fatura: { accountId: CARTAO, mes: "2026-10-01" },
      }),
    ]),
  ]);
  out.c = { previsto: retrato(raiz, PREVISTO) };
}

// =========================================================================
// D. A LINHA DE OUTRO MEMBRO (posso_editar: false) nao tem Excluir
// =========================================================================
{
  const raiz = await montar("raiz-d", [
    corpo([
      linha({ id: "s-2", descricao: "Mercado do grupo", posso_editar: false }),
    ]),
  ]);
  out.d = { previsto: retrato(raiz, PREVISTO) };
}

// =========================================================================
// E. EXCLUIR uma conta FIXA: a pergunta, o alcance, e a linha saindo
// =========================================================================
{
  const antes = corpo([
    linha({ id: "s-fixa", descricao: "Aluguel", natureza: "fixa" }),
  ]);
  const raiz = await montar("raiz-e", [antes, corpo([])]);

  RESPOSTA_DO_CONFIRM = true;
  await clicar(raiz, PREVISTO, "Excluir");

  out.e = {
    perguntas: PERGUNTAS.slice(),
    chamadas: CHAMADAS.slice(),
    previsto: retrato(raiz, PREVISTO),
  };
}

// =========================================================================
// F. EXCLUIR RECUSADO no confirm: NADA sai, e a linha fica
// =========================================================================
{
  const antes = corpo([
    linha({ id: "s-avulsa", descricao: "Boleto", natureza: "despesa" }),
  ]);
  const raiz = await montar("raiz-f", [antes, corpo([])]);

  RESPOSTA_DO_CONFIRM = false;
  await clicar(raiz, PREVISTO, "Excluir");
  RESPOSTA_DO_CONFIRM = true;

  out.f = {
    perguntas: PERGUNTAS.slice(),
    chamadas: CHAMADAS.slice(),
    previsto: retrato(raiz, PREVISTO),
  };
}

// =========================================================================
// G. EDITAR a conta prevista: o formulario em linha e o PATCH
// =========================================================================
{
  const antes = corpo([
    linha({ id: "s-edit", descricao: "Aluguel", valor: 2500, natureza: "fixa" }),
  ]);
  const depois = corpo([
    linha({ id: "s-edit", descricao: "Aluguel novo", valor: 2700, natureza: "fixa" }),
  ]);
  const raiz = await montar("raiz-g", [antes, depois]);

  out.g_antes = { temFormulario: !!raiz.querySelector("#edicao-valor") };

  await clicar(raiz, PREVISTO, "Editar");

  const campoDescricao = raiz.querySelector("#edicao-descricao");
  const campoValor = raiz.querySelector("#edicao-valor");
  const campoVencimento = raiz.querySelector("#edicao-vencimento");

  out.g_aberto = {
    temFormulario: !!campoValor,
    // OS CAMPOS ABREM COM O VALOR DE HOJE: um formulario vazio cujo Salvar
    // mandasse o vazio seria perda de dado em cada edicao.
    descricao: campoDescricao ? campoDescricao.value : null,
    valor: campoValor ? campoValor.value : null,
    vencimento: campoVencimento ? campoVencimento.value : null,
    // A frase que distingue ocorrencia de serie.
    texto: raiz.textContent.replace(/\\s+/g, " ").trim(),
  };

  if (campoDescricao) digitar(campoDescricao, "Aluguel novo");
  if (campoValor) digitar(campoValor, "2.700,50");
  await assentar();

  const salvar = raiz.querySelector("#edicao-salvar");
  if (salvar) {
    salvar.click();
    await assentar();
  }

  out.g_salvo = {
    chamadas: CHAMADAS.slice(),
    temFormulario: !!raiz.querySelector("#edicao-valor"),
    previsto: retrato(raiz, PREVISTO),
  };
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
  const dir = mkdtempSync(join(tmpdir(), "lista-na-tela-"));
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
  // volta como `&amp;` -- e as URLs desta sonda sao cheias de `&`
  // (`?tipo=expense&de=...`). Sem desescapar, a assercao da URL compara
  // `&amp;de=` com `&de=` e reprova sem nada estar errado no app; e pior, uma
  // assercao escrita com `includes` passaria a nunca casar e viraria vacua.
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
  resultado = rodarPagina("lista.html", PAGINA);
} catch (e) {
  erroDeExecucao = e;
}

// =============================================================================

test("o navegador rodou e a pagina reportou", () => {
  if (erroDeExecucao) throw erroDeExecucao;
  assert.ok(resultado, "sem resultado da pagina");
});

test("CONTROLE: a lista PINTOU as duas secoes, com a linha dentro", () => {
  // O controle que da sentido a toda assercao negativa desta suite. Sem drenar
  // os microtasks a leitura fica na fase `carregando` e a lista nao pinta NADA
  // -- e aí "a linha nao esta mais no Previsto" fica verde por nao haver linha
  // nenhuma, indistinguivel de uma feature que funciona.
  assert.ok(resultado.a_antes.previsto, "a secao Previsto nao existe");
  assert.ok(resultado.a_antes.realizado, "a secao Realizado nao existe");
  assert.match(resultado.a_antes.previsto.texto, /Aluguel/);
  // E o VALOR saiu formatado pelo `moeda` de PRODUCAO -- nao por um esboco.
  assert.match(resultado.a_antes.previsto.texto, /R\$\s?2\.500,00/);
  // Nenhum marcador de esboco dentro das duas secoes: os esbocos desta pagina
  // moram todos FORA delas (cartoes, paineis de rede, o href do cartao).
  assert.ok(
    !resultado.a_antes.previsto.texto.includes("ESBOCO"),
    resultado.a_antes.previsto.texto
  );
  assert.ok(
    !resultado.a_antes.realizado.texto.includes("ESBOCO"),
    resultado.a_antes.realizado.texto
  );
});

test("CONTROLE: a leitura saiu com `?tipo=` e o periodo que o container passou", () => {
  // Se a tela pedisse outra querystring, o restante desta suite continuaria
  // verde -- a sonda responde a mesma coisa para qualquer URL de resumo.
  const [primeira] = resultado.a_antes.chamadas;
  assert.ok(primeira, "a lista nao chamou a rota do resumo");
  assert.equal(primeira.metodo, "GET");
  assert.equal(
    primeira.url,
    "/api/movimentacoes/resumo?tipo=expense&de=2026-10-01&ate=2026-10-31"
  );
});

test("A1: o clique em Confirmar chama /pay com o ID DA LINHA", () => {
  // A requisicao interceptada, e nao estado interno: o rotulo da tela muda
  // igual com o `fetch` pedindo o id errado.
  const acoes = resultado.a_depois.chamadas.filter((c) => c.metodo === "POST");

  assert.equal(acoes.length, 1, JSON.stringify(resultado.a_depois.chamadas));
  assert.equal(acoes[0].url, "/api/scheduled-transactions/s-1/pay");
});

test("A2: a linha SAIU do Previsto e APARECEU no Realizado", () => {
  // ESTA E A ASSERCAO QUE IMPORTA. Ela e a unica que distingue "chamou a rota"
  // de "o app refletiu o resultado": um `aoConfirmar` que chamasse a baixa e
  // esquecesse a releitura passa em A1 inteira, e a linha fica onde estava.
  //
  // E as DUAS metades sao obrigatorias. "Saiu do Previsto" sozinha fica verde
  // com a lista vazia (uma releitura que perdesse as linhas, ou um erro que
  // zerasse o array); "entrou no Realizado" sozinha fica verde se a linha
  // aparecer nas DUAS secoes.
  assert.match(resultado.a_antes.previsto.texto, /Aluguel/, "o antes nao vale");
  assert.ok(
    !resultado.a_antes.realizado.texto.includes("Aluguel"),
    "a linha ja estava no Realizado ANTES do clique: o antes nao vale"
  );

  assert.ok(
    !resultado.a_depois.previsto.texto.includes("Aluguel"),
    `a linha ficou no Previsto depois da baixa: ${resultado.a_depois.previsto.texto}`
  );
  assert.match(
    resultado.a_depois.realizado.texto,
    /Aluguel/,
    `a linha nao chegou no Realizado: ${resultado.a_depois.realizado.texto}`
  );
});

test("A3: a releitura ACONTECEU -- duas leituras do resumo, nao uma", () => {
  // O mecanismo por tras de A2, medido separado: sem a segunda leitura, A2 so
  // poderia passar se a tela tivesse remendado o array local -- que seria uma
  // SEGUNDA definicao do que a baixa produz, divergente da rota.
  const leituras = resultado.a_depois.chamadas.filter((c) =>
    c.url.startsWith("/api/movimentacoes/resumo")
  );
  assert.equal(leituras.length, 2, JSON.stringify(leituras));
});

test("A4: a linha confirmada perde o Confirmar e mantem os outros dois", () => {
  // O estado DEPOIS, pelos botoes: a linha realizada nao tem o que confirmar.
  const rotulos = resultado.a_depois.realizado.acoes.map((a) => a.rotulo);
  assert.deepEqual(rotulos, ["Editar", "Excluir"], JSON.stringify(rotulos));
});

test("B: a linha realizada nao tem Confirmar -- e tem os outros dois", () => {
  const rotulos = resultado.b.realizado.acoes.map((a) => a.rotulo);

  assert.deepEqual(rotulos, ["Editar", "Excluir"]);
  // O Editar dela e um `<a href>` com o `?id=` e a origem de volta.
  const editar = resultado.b.realizado.acoes.find((a) => a.rotulo === "Editar");
  assert.equal(editar.tag, "A");
  assert.match(editar.href, /^\/dashboard\/movimentacoes\/despesa\?id=t-1&origem=/);
  assert.ok(
    decodeURIComponent(editar.href).includes("de=2026-10-01&ate=2026-10-31"),
    editar.href
  );
});

test("C: a fatura ABERTA nao tem botao nenhum -- e continua sendo o link do cartao", () => {
  const acoes = resultado.c.previsto.acoes;

  assert.deepEqual(acoes.map((a) => a.rotulo), []);
  assert.match(resultado.c.previsto.texto, /Fatura Nubank/, "a linha sumiu");
  // O link do cartao continua la -- a acao da fatura e abrir o cartao. O
  // caminho e MARCADOR (`caminhoDoCartaoNoMes` e esboco), e a assercao sobre o
  // `?mes=` de verdade mora em `npm run test:secao-da-tela`.
  assert.match(resultado.c.previsto.texto, /ainda em aberto/);
});

test("D: a linha de outro membro do grupo nao tem Excluir -- nem os outros", () => {
  const acoes = resultado.d.previsto.acoes;

  assert.deepEqual(acoes.map((a) => a.rotulo), []);
  // A LINHA FICA, com o nome: `posso_editar` decide botao, nao soma.
  assert.match(resultado.d.previsto.texto, /Mercado do grupo/);
});

test("E1: Excluir PERGUNTA antes, e a pergunta distingue ocorrencia de serie", () => {
  assert.equal(resultado.e.perguntas.length, 1, JSON.stringify(resultado.e.perguntas));

  const pergunta = resultado.e.perguntas[0];
  assert.match(pergunta, /Aluguel/);
  assert.match(pergunta, /ocorrência/);
  assert.match(pergunta, /continua ativo/);
  assert.match(pergunta, /gerar as próximas/);
});

test("E2: aceita, a exclusao sai com `alcance: apenas_esta` -- e a linha sai da lista", () => {
  const deletes = resultado.e.chamadas.filter((c) => c.metodo === "DELETE");

  assert.equal(deletes.length, 1, JSON.stringify(resultado.e.chamadas));
  assert.equal(deletes[0].url, "/api/scheduled-transactions/s-fixa");
  assert.deepEqual(deletes[0].corpo, { alcance: "apenas_esta" });

  assert.ok(
    !resultado.e.previsto.texto.includes("Aluguel"),
    resultado.e.previsto.texto
  );
});

test("F: RECUSADA a pergunta, NADA sai -- e a linha fica onde estava", () => {
  // A prova de que `confirm()` e bloqueante de verdade neste caminho. Um
  // `confirm` cujo retorno fosse ignorado deixaria a exclusao acontecer, e o
  // unico sintoma seria a linha sumindo depois de alguem clicar em "Cancelar".
  assert.equal(resultado.f.perguntas.length, 1);

  const escritas = resultado.f.chamadas.filter((c) => c.metodo !== "GET");
  assert.deepEqual(escritas, [], JSON.stringify(escritas));

  // E UMA leitura so: sem acao, sem releitura.
  assert.equal(resultado.f.chamadas.length, 1, JSON.stringify(resultado.f.chamadas));
  assert.match(resultado.f.previsto.texto, /Boleto/);
});

test("G1: o Editar da prevista ABRE o formulario, com os valores de hoje", () => {
  // Antes do clique o formulario nao existe: sem este controle, "o campo tem o
  // valor certo" passaria verde num formulario sempre aberto.
  assert.equal(resultado.g_antes.temFormulario, false);

  assert.equal(resultado.g_aberto.temFormulario, true, "o Editar nao abriu nada");
  assert.equal(resultado.g_aberto.descricao, "Aluguel");
  assert.equal(resultado.g_aberto.valor, "2500,00");
  assert.equal(resultado.g_aberto.vencimento, "2026-10-15");

  // E a frase que diz O QUE a edicao alcanca -- a ocorrencia, nao a serie.
  assert.match(resultado.g_aberto.texto, /Vale só para a ocorrência de/);
  assert.match(resultado.g_aberto.texto, /15\/10\/2026/);
  assert.match(resultado.g_aberto.texto, /as próximas ocorrências continuam/);
});

test("G2: Salvar manda PATCH com os tres campos, e o valor com VIRGULA vira numero", () => {
  const patches = resultado.g_salvo.chamadas.filter((c) => c.metodo === "PATCH");

  assert.equal(patches.length, 1, JSON.stringify(resultado.g_salvo.chamadas));
  assert.equal(patches[0].url, "/api/scheduled-transactions/s-edit");
  assert.deepEqual(patches[0].corpo, {
    description: "Aluguel novo",
    // "2.700,50" digitado. `Number("2.700,50")` e NaN, e `type="number"`
    // descartaria a virgula no caminho -- por isso o campo e `text` e quem
    // converte e `pedidoDeEdicaoDaPrevista`. Um 2700 redondo aqui nao provaria
    // nada sobre os centavos.
    amount: 2700.5,
    due_date: "2026-10-15",
    alcance: "apenas_esta",
  });
});

test("G3: salvo, o formulario FECHA e a lista relê", () => {
  assert.equal(resultado.g_salvo.temFormulario, false, "o formulario ficou aberto");
  assert.match(resultado.g_salvo.previsto.texto, /Aluguel novo/);

  const leituras = resultado.g_salvo.chamadas.filter((c) =>
    c.url.startsWith("/api/movimentacoes/resumo")
  );
  assert.equal(leituras.length, 2, JSON.stringify(leituras));
});
