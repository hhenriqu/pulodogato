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
//   lib/data-digitada.js    -- `aoDigitarData`, a MASCARA do vencimento. Ela e a
//                              assercao do caso G4 ("20/11/2026" digitado ->
//                              `2026-11-20` no PATCH): esbocada, a sonda mediria
//                              a propria sonda (HMO-324);
//   components/ui/button.js, components/ui/card.js -- `id`, `aria-label`,
//                              `disabled` e `onClick` atravessando ate o DOM;
//   components/ui/input.js, components/ui/campo-de-data.js -- o campo de data
//                              que SUBSTITUIU o `<input type="date">` nativo. O
//                              componente guarda o rascunho da digitacao em
//                              `useState` proprio, entao nao da para esboca-lo e
//                              continuar medindo a mascara (HMO-324);
//   components/movimentacoes/SecaoDaTela.js, ListaDeMovimentacao.js.
//
// E os esbocos, cada um com motivo e limite:
//
//   - `cn`, `cva`, `Slot`: a fiacao de CLASSE do Button. Calculo de string
//     (clsx + tailwind-merge + cva), nao comportamento, e nenhuma assercao daqui
//     fala de classe -- quem cobra cor e `npm run check-color-tokens`. Com eles
//     o Button de PRODUCAO entra de verdade;
//   - os onze icones do lucide: viram `<svg>` vazio. Icone novo num dos
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
//      partes declarando o mesmo `const` de MODULO. Com quatorze modulos de
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

/**
 * UM PEDACO AUTO-CONTIDO DE UMA LIB QUE A PAGINA NAO CARREGA INTEIRA.
 *
 * `lib/pagamento-da-fatura.js` nao entra em `PARTES`: ela importa
 * `lib/agenda-do-cartao` e `lib/card-invoice` -> `lib/transferencia`, quatro
 * modulos de aritmetica de fatura por duas declaracoes. Mas as duas sao
 * AUTO-CONTIDAS (nao usam nenhum dos imports no corpo), entao elas entram pelo
 * CODIGO DE PRODUCAO extraido -- nao como esboco.
 *
 * E ISSO NAO E ZELO: `linhaParaPagarDaTela` e quem decide que a chave sintetica
 * da fatura ABERTA (`fatura:2026-10-01:<uuid>`) NAO vai como id de banco. Um
 * esboco dela faria o caso H medir a propria sonda -- e justamente a assercao
 * `linha.id === null` perderia o sentido.
 *
 * `rotulo` entra na mensagem de erro porque uma extracao que nao casa e o modo
 * de falha caro: ela deixaria o nome `undefined` na pagina, e o sintoma seria
 * "ReferenceError" vinte linhas depois, sem dizer que a ancora do regex mudou.
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

const fontePagamento = readFileSync(
  join(SAIDA, "lib/pagamento-da-fatura.js"),
  "utf8"
);

const DA_LIB_DO_PAGAMENTO = [
  // A funcao: do `export function` ate o `}` na COLUNA ZERO.
  daLib(
    "lib/pagamento-da-fatura.js",
    fontePagamento,
    /^export function linhaParaPagarDaTela\([\s\S]*?^\}/m,
    "linhaParaPagarDaTela"
  ),
  // A frase da fatura sem vencimento: uma linha, do `export const` ao `;`.
  daLib(
    "lib/pagamento-da-fatura.js",
    fontePagamento,
    /^export const FATURA_SEM_VENCIMENTO_NAO_TEM_PAGAR = [\s\S]*?;$/m,
    "FATURA_SEM_VENCIMENTO_NAO_TEM_PAGAR"
  ),
  // `today()` pelo MESMO caminho, por um motivo proprio: `lib/recurrence.js` e
  // aritmetica de recorrencia que nada tem a ver com esta sonda, e `today` e
  // uma linha sem import nenhum. E ela precisa ser a DE PRODUCAO -- o caso H
  // afirma que o `hoje` que chega ao dialogo e a data de SAO PAULO, e um esboco
  // faria a sonda comparar o proprio relogio consigo mesma.
  daLib(
    "lib/recurrence.js",
    readFileSync(join(SAIDA, "lib/recurrence.js"), "utf8"),
    /^export function today\([\s\S]*?^\}/m,
    "today"
  ),
].join("\n");

/**
 * AS CINCO FRASES DO ACERTO DE GRUPO NA ABA RECEITAS (HMO-366).
 *
 * `lib/acerto-na-aba-receitas.js` NAO entra em `PARTES`: ela importa
 * `lib/dinheiro`, `lib/acerto-em-lancamento` e `lib/perna-da-contraparte` --
 * tres modulos a mais na pagina (e os que eles arrastam) por cinco strings, e
 * cada um deles declara `const` de topo que pode colidir com os que ja estao la.
 *
 * As cinco constantes sao AUTO-CONTIDAS (string literal, sem usar nenhum dos
 * imports), entao entram pelo CODIGO DE PRODUCAO extraido -- e e isso que
 * importa aqui: as assercoes do caso M leem O TEXTO QUE A LIB DEFINE. Escritas
 * a mao na sonda, elas casariam com qualquer coisa que o componente imprimisse,
 * e a suite mediria a propria sonda.
 */
const DAS_FRASES_DO_ACERTO = (() => {
  const arquivo = "lib/acerto-na-aba-receitas.js";
  const fonte = readFileSync(join(SAIDA, arquivo), "utf8");

  return [
    "TITULO_A_CONFIRMAR",
    "SUBTITULO_A_CONFIRMAR",
    "TITULO_CONFIRMADO",
    "ACERTO_FORA_DO_REALIZADO",
    "ACERTO_FORA_DO_PREVISTO",
  ]
    .map((nome) =>
      daLib(
        arquivo,
        fonte,
        // Do `export const <NOME> =` ate o `;` no fim da linha. O tsc emite as
        // cinco numa linha so (medido), e `[^\n]*` garante que a extracao nao
        // atravesse para a declaracao seguinte se isso mudar.
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
  "lib/movimentacoes.js",
  "lib/destino-do-lancamento.js",
  "lib/chave-da-fatura.js",
  "lib/telas-de-movimentacao.js",
  "lib/retorno-do-lancamento.js",
  "lib/acoes-da-linha.js",
  // A mascara do campo de vencimento (HMO-324). Ela entra como PRODUCAO pelo
  // mesmo motivo que `secoesDaTela`: o caso G4 afirma que digitar "20/11/2026"
  // grava `2026-11-20`, e e `aoDigitarData` quem faz essa traducao. Esbocada, a
  // sonda mediria a propria sonda.
  "lib/data-digitada.js",
  "components/ui/button.js",
  "components/ui/card.js",
  "components/ui/input.js",
  // `CampoDeData` depende de `Input` (acima) e de `lib/data-digitada`. Ele
  // guarda o rascunho da digitacao em `useState` proprio, entao e o COMPONENTE
  // que tem de entrar: nao ha como esbocar o campo e continuar medindo a
  // mascara, que e o que esta issue trocou.
  "components/ui/campo-de-data.js",
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
<div id="raiz-g"></div><div id="raiz-h"></div><div id="raiz-i"></div>
<div id="raiz-j"></div><div id="raiz-k"></div><div id="raiz-l"></div>
<div id="raiz-m"></div>
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
// \`useRef\` entrou com \`CampoDeData\` (HMO-324): ele guarda o input do
// calendario nativo escondido para poder chamar \`showPicker()\` nele.
const { useCallback, useEffect, useMemo, useRef, useState } = React;

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

/** Os onze icones. Icone novo estoura como ReferenceError, e isso e bom. */
const icone = (nome) => (props) =>
  React.createElement("svg", { "data-icone": nome, className: props.className });
const AlertCircle = icone("AlertCircle");
const CalendarClock = icone("CalendarClock");
/** O do botao de calendario de \`CampoDeData\` (HMO-324). */
const CalendarDays = icone("CalendarDays");
const Check = icone("Check");
const CheckCircle2 = icone("CheckCircle2");
const CreditCard = icone("CreditCard");
const Loader2 = icone("Loader2");
const Pencil = icone("Pencil");
const Repeat = icone("Repeat");
const Trash2 = icone("Trash2");
const Wallet = icone("Wallet");

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
// A MOEDA ENTRA NO MARCADOR (HMO-366): \`formatCurrency\` recebe DOIS argumentos,
// e o segundo e load-bearing nos blocos de acerto de grupo -- a 026 deixa a
// quitacao ser em USD, e um \`formatCurrency(valor)\` sem a moeda imprimiria
// R$ 50,00 em cima de US$ 50,00, que e um numero certo com o simbolo errado.
// Sem o segundo campo aqui, nenhuma assercao desta sonda distinguiria os dois.
const formatCurrency = (v, moeda) => "ESBOCO-VALOR:" + v + ":" + moeda;

/**
 * O ELO DA FATURA (HMO-305): MARCADOR, COM A GUARDA DA PRODUCAO COPIADA.
 *
 * \`EloDaFatura\` real arrastaria \`lib/elo-da-fatura\` e \`lib/fatura-do-cartao\`
 * -- e esta ultima e justamente a que a pagina deixa de fora (ver
 * \`caminhoDoCartaoNoMes\`). Ele nao e assunto desta suite: os cliques dele sao
 * medidos no caso J da sonda do painel do modo papel de pao, e a marcacao em
 * \`npm run test:secao-da-tela\`, que renderiza o componente DE VERDADE.
 *
 * A GUARDA ("sem suspeita e sem elo, nao desenha nada") E COPIADA DE PROPOSITO,
 * e e o unico jeito: \`SecaoDaTela\` monta este componente em TODA linha que tem
 * id, entao um marcador sem guarda escreveria "ESBOCO" dentro das duas secoes --
 * e o controle da suite proibe exatamente isso (e com razao: ele e o que impede
 * um esboco de participar de uma assercao de texto).
 */
const EloDaFatura = (props) =>
  props.suspeita || props.elo
    ? React.createElement("span", null, "ESBOCO-ELO")
    : null;

/**
 * O PAINEL "PRA QUEM PAGAR" (HMO-365): MARCADOR, COM A GUARDA DA PRODUCAO
 * COPIADA -- pela MESMA razao do \`EloDaFatura\` logo acima.
 *
 * Ele nao e assunto desta suite: a marcacao dele, o chevron e o rotulo honesto
 * sao medidos em \`npm run test:pra-quem-pagar-na-tela\`, que renderiza o
 * componente DE VERDADE num Chromium, e a aritmetica em
 * \`npm run test:pra-quem-pagar\`. Aqui ele existe porque
 * \`ListaDeMovimentacao\` passou a importa-lo, e um nome que a pagina nao declara
 * vira \`ReferenceError\` no render -- com o sintoma deslocado: \`ReactDOM.render\`
 * relanca o erro numa MACROTASK, este arnes drena so microtasks, e o que chega
 * nao e o \`ReferenceError\` mas "secao ausente: Previsto no período", que se le
 * como arnes quebrado. Foi exatamente o que aconteceu na primeira volta da
 * HMO-365 (24 de 24 vermelhos).
 *
 * A GUARDA ("lista vazia nao desenha painel nenhum") E COPIADA DE PROPOSITO: os
 * corpos de resposta desta suite nao tem \`pra_quem_pagar\`, entao o estado chega
 * \`[]\` e o componente de verdade devolve \`null\`. Um marcador sem guarda
 * escreveria "ESBOCO" na tela em TODO caso -- e, embora este painel fique FORA
 * das duas secoes, o controle da suite que proibe a palavra existe justamente
 * para impedir um esboco de participar de assercao de texto, e um marcador que
 * aparece onde a producao nao desenha nada e uma divergencia a toa.
 */
const PainelPraQuemPagar = (props) =>
  props.destinos && props.destinos.length > 0
    ? React.createElement("div", null, "ESBOCO-PRA-QUEM-PAGAR")
    : null;

/**
 * O DIALOGO DA CONTA PAGADORA (HMO-310): REGISTRADOR, e nao marcador de texto.
 *
 * Ele e \`@radix-ui/react-dialog\` + \`sonner\` + \`@/components/ui/select\`, e nada
 * disso tem build UMD -- a pagina nao tem empacotador. O conteudo dele ja esta
 * provado onde pode ser: \`npm run test:pagamento-da-fatura\` cobre a decisao e a
 * sequencia das escritas, e a prova ponta a ponta do dialogo em PRODUCAO esta no
 * comentario da HMO-310.
 *
 * O QUE ESTA SUITE MEDE E O FIO: que o clique no botao da linha chegue aqui, com
 * a linha CONVERTIDA (\`linhaParaPagarDaTela\`, codigo de producao extraido) e com
 * \`hoje\` e o vencimento que a tela formatou. Por isso ele GUARDA AS PROPS em vez
 * de escrever um marcador: o estado do dialogo nao e texto da lista, e as
 * assercoes leem o objeto.
 *
 * \`ABERTO\` e sobrescrito a cada render, e nao empilhado: um array mediria
 * quantas vezes o React renderizou, que nao e assercao de nada.
 */
let ABERTO = null;
const DialogoDePagamentoDaFatura = (props) => {
  ABERTO = props.linha
    ? {
        linha: props.linha,
        valorFormatado: props.valorFormatado,
        vencimentoFormatado: props.vencimentoFormatado,
        hoje: props.hoje,
      }
    : null;
  return null;
};

/**
 * O DIALOGO DA CONTA DO ACERTO (HMO-366): REGISTRADOR, e ele tambem DRIVE.
 *
 * Ele e \`@radix-ui/react-dialog\` + \`@/components/ui/select\`, e nada disso tem
 * build UMD -- a pagina nao tem empacotador. O conteudo dele esta provado onde
 * pode ser: \`npm run test:acerto-em-lancamento\` cobre quais contas servem, a
 * conversao e as frases, e e o MESMO dialogo que a tela do grupo usa desde a
 * HMO-245 fase 12.
 *
 * O que o caso M mede e o FIO, e em dois sentidos:
 *
 *   * para DENTRO: que o clique em Confirmar chegue aqui com o acerto certo --
 *     valor, moeda, cotacao, nome de quem pagou, e \`direcao: "recebi"\`, que e o
 *     que decide o SINAL da perna;
 *   * para FORA: a sonda CHAMA \`ACERTO_ABERTO.aoConfirmar("<id de conta>")\`,
 *     que e exatamente o que o botao do dialogo real faz com a conta escolhida.
 *     E so assim que o POST da perna sai do aparelho de verdade e a releitura
 *     acontece -- um esboco que so guardasse props mediria metade do gesto.
 *
 * E ELE DEIXA UMA MARCA NO DOM, que e como "fechou" se mede. A alternativa
 * tentada primeiro -- zerar \`ACERTO_ABERTO\` antes de confirmar e exigir que ele
 * continue nulo -- NAO FUNCIONA, e o porque vale escrito: \`lancarMinhaPerna\`
 * comeca com \`setAcertoSalvando\`, que re-renderiza o dialogo AINDA ABERTO (e
 * certo: ele mostra "Lançando..."). O registro reaparece, e a assercao reprova
 * uma tela que esta correta. Com a marca, o criterio e o que a pessoa ve: o
 * dialogo esta montado ou nao.
 */
let ACERTO_ABERTO = null;
const DialogoDeAcerto = (props) => {
  ACERTO_ABERTO = props.aberto
    ? {
        direcao: props.direcao,
        nomeDaContraparte: props.nomeDaContraparte,
        valor: props.valor,
        moeda: props.moeda,
        cotacao: props.cotacao,
        contas: props.contas,
        titulo: props.titulo,
        rotuloDoBotao: props.rotuloDoBotao,
        salvando: props.salvando,
        aoConfirmar: props.aoConfirmar,
      }
    : null;
  return props.aberto
    ? React.createElement("div", { "data-esboco": "dialogo-do-acerto" })
    : null;
};

// --- o codigo de producao EXTRAIDO (ver \`daLib\` no .mjs) ---------------------
${DA_LIB_DO_PAGAMENTO}
${DAS_FRASES_DO_ACERTO}

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

  // AS CONTAS DO DIALOGO DO ACERTO (HMO-366). A forma e a de
  // \`GET /api/financial-accounts\`: \`{ accounts: [...] }\`. Ela importa porque o
  // componente le \`dados.accounts\` -- um \`{ data: [...] }\` aqui deixaria o
  // dialogo abrir com a lista vazia, e o caso M passaria verde sobre um dialogo
  // que nao oferece conta nenhuma.
  if (String(url).startsWith("/api/financial-accounts")) {
    return resposta({ accounts: CONTAS });
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

/** As contas que \`GET /api/financial-accounts\` devolve no caso M. */
const CONTAS = [
  {
    id: "conta-nubank",
    name: "Nubank",
    account_type: "checking",
    currency: "BRL",
  },
];

const GRUPO = "77777777-7777-4777-b777-777777777777";
const ACERTO_ID = "5e111111-1111-4111-b111-111111111111";

/**
 * Um acerto da aba Receitas, na forma que \`acertosNaAbaReceitas\` devolve.
 *
 * A sonda monta o OBJETO porque o que esta sendo medido e o componente: quem
 * decide qual acerto vai para qual lado e a lib pura, e ela tem suite e 12
 * mutantes proprios (\`npm run test:acerto-na-aba-receitas\`). Repetir aquela
 * decisao aqui seria a sonda medindo a propria sonda.
 */
const acerto = (extra) =>
  Object.assign(
    {
      id: "acerto:" + ACERTO_ID,
      settlementId: ACERTO_ID,
      groupId: GRUPO,
      descricao: "Acerto de grupo — Letícia me pagou (Casa)",
      valor: 300,
      moeda: "BRL",
      cotacao: 1,
      data: "2026-10-08",
      nomeDaContraparte: "Letícia",
    },
    extra
  );

/** O corpo da aba RECEITAS, com os dois lados do acerto. */
const corpoDeReceita = (acertos) =>
  Object.assign(corpo([]), {
    acertos_do_grupo: acertos,
  });

const TELA_DE_RECEITA = {
  tipo: "income",
  rota: "/dashboard/receitas",
  titulo: "Receitas",
  oQueOPrevistoE: "o que ainda entra no período",
  oQueORealizadoE: "o que já entrou na sua conta",
};

const APARENCIA_DE_RECEITA = {
  Icone: icone("TrendingUp"),
  cor: "text-success",
  rotaDeLancar: "/dashboard/movimentacoes/receita",
  textoDeLancar: "Nova Receita",
  palavraDaLinha: "Receita",
};

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

/**
 * Monta a lista num container, com a fila de respostas do resumo.
 *
 * \`extras\` SOBRESCREVE as props (HMO-366): o caso M monta a aba RECEITAS, que e
 * o mesmo componente com outro \`tipo\` e outros rotulos. Um segundo \`montar\`
 * copiado seria a segunda definicao do arnes, e ela envelheceria calada --
 * o default continua sendo Despesas, entao nenhum dos doze casos anteriores
 * muda uma letra.
 */
async function montar(idDaRaiz, respostas, extras) {
  CHAMADAS = [];
  PERGUNTAS = [];
  ABERTO = null;
  ACERTO_ABERTO = null;
  FILA_DO_RESUMO = respostas;

  const raiz = document.getElementById(idDaRaiz);
  ReactDOM.render(
    React.createElement(
      ListaDeMovimentacao,
      Object.assign(
        {
          tipo: "expense",
          tela: TELA,
          aparencia: APARENCIA,
          queryDoPeriodo: "de=2026-10-01&ate=2026-10-31",
          rotuloDoPeriodo: "outubro de 2026",
          origem: "/dashboard/despesas?de=2026-10-01&ate=2026-10-31",
          rodape: null,
        },
        extras || {}
      )
    ),
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
    // O vencimento e o TEXTO EXIBIDO, e desde a HMO-324 ele e dd/mm/aaaa: o
    // campo e \`CampoDeData\`, que mostra mascarado e emite AAAA-MM-DD por baixo.
    // Era aqui que o \`type="date"\` nativo aparecia como "2026-10-15".
    vencimento: campoVencimento ? campoVencimento.value : null,
    // O \`type\` do campo e a assercao que impede a VOLTA do controle nativo por
    // esta porta: \`check-campo-de-data\` varre o fonte, mas so esta sonda diz o
    // que o navegador recebeu de fato.
    tipoDoVencimento: campoVencimento ? campoVencimento.type : null,
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

// =========================================================================
// G4. DIGITAR o vencimento: dd/mm/aaaa na tela, AAAA-MM-DD no PATCH (HMO-324)
// =========================================================================
// O caso G acima edita descricao e valor e deixa o vencimento COMO VEIO -- ele
// prova que a data que ja existia sobrevive a edicao. Este caso prova a outra
// metade, que e a que a troca do campo nativo poe em risco: uma data que a
// PESSOA DIGITA chega ao banco no formato que o banco espera.
//
// E e esta a assercao que o controle nativo nao conseguia ter. Num
// \`<input type="date">\` a ordem dos tres segmentos sai do APARELHO, entao
// digitar 20/11/2026 gravava 2026-11-20 em um aparelho e 2026-08-11 em outro
// (11 de agosto: o dia virou mes) -- com o teste verde nos dois, porque o
// navegador do CI tem uma ordem so. Com \`CampoDeData\` a ordem e dd/mm/aaaa em
// todo aparelho, porque e a MASCARA que a define, e a mascara e codigo.
//
// Por que 20/11: dia 20 e mes 11 sao AMBIGUOS ao contrario de um jeito util --
// "20" nao e mes valido, entao uma leitura mm/dd do que foi digitado nao
// produziria data nenhuma e o PATCH sairia sem \`due_date\`. Ja um 05/06 passaria
// pelas duas leituras e esta assercao ficaria sem medir nada.
{
  const antes = corpo([
    linha({ id: "s-dig", descricao: "Aluguel", valor: 2500, natureza: "fixa" }),
  ]);
  const depois = corpo([
    linha({ id: "s-dig", descricao: "Aluguel", valor: 2500, natureza: "fixa" }),
  ]);
  const raiz = await montar("raiz-l", [antes, depois]);

  await clicar(raiz, PREVISTO, "Editar");

  const campoVencimento = raiz.querySelector("#edicao-vencimento");

  // A digitacao da data INTEIRA de uma vez. \`aoDigitarData\` trata isso como
  // data nova (o campo estava completo e o texto nao cresceu), que e o mesmo
  // caminho de quem seleciona tudo e redigita.
  if (campoVencimento) digitar(campoVencimento, "20/11/2026");
  await assentar();

  out.g_digitado = {
    // O que ficou NA TELA depois da mascara.
    exibicao: campoVencimento ? campoVencimento.value : null,
  };

  const salvar = raiz.querySelector("#edicao-salvar");
  if (salvar) {
    salvar.click();
    await assentar();
  }

  out.g_digitado.chamadas = CHAMADAS.slice();
}

// =========================================================================
// H. PAGAR A FATURA ABERTA: o botao, o dialogo, e o clique QUE NAO NAVEGA
// =========================================================================
// "Precisa colocar o botao de pagar tbm na fatura do cartao em despesas."
//
// A fatura ABERTA e \`gravada: false\` e o \`id\` dela e a CHAVE SINTETICA. As duas
// coisas que esta caso mede e nenhuma outra suite alcanca:
//
//   1. O CLIQUE NO BOTAO NAO NAVEGA. Ate esta fase a linha inteira era um \`<a>\`
//      para a tela do cartao, e e por isso que ela nao podia ter botao: o clique
//      faria as duas coisas, e "funcionou" seria indistinguivel do defeito. A
//      medida e \`botao.closest("a")\` no DOM de verdade;
//   2. A LINHA CHEGA CONVERTIDA no dialogo -- \`id: null\`. Sem a conversao,
//      \`pagarAFatura\` montaria
//      \`POST /api/scheduled-transactions/fatura:2026-10-01:<uuid>/pay\`.
{
  const aberta = linha({
    id: "fatura:2026-10-01:" + CARTAO,
    gravada: false,
    descricao: "Fatura Nubank",
    valor: 1234.56,
    data: "2026-10-28",
    natureza: "fatura",
    fatura: { accountId: CARTAO, mes: "2026-10-01" },
  });
  const raiz = await montar("raiz-h", [corpo([aberta])]);

  const secaoDoPrevisto = secao(raiz, PREVISTO);
  const botao = secaoDoPrevisto.querySelector('[aria-label="Pagar"]');
  const ancoras = Array.prototype.slice
    .call(secaoDoPrevisto.querySelectorAll("a[href]"))
    .map((a) => a.getAttribute("href"));

  out.h_antes = {
    previsto: retrato(raiz, PREVISTO),
    dialogo: ABERTO,
    temBotao: !!botao,
    tagDoBotao: botao ? botao.tagName : null,
    // A MEDIDA DO ANINHAMENTO, no DOM e nao no HTML: \`closest\` sobe a arvore de
    // verdade. \`null\` e o que esta fase existe para conseguir.
    botaoDentroDeAncora: botao ? botao.closest("a") !== null : null,
    // E os DOIS ALVOS: o nome do cartao continua levando ao cartao. O caminho e
    // marcador (\`caminhoDoCartaoNoMes\` e esboco) -- o \`?mes=\` de verdade esta em
    // \`npm run test:secao-da-tela\`.
    ancoras,
    // O texto do link e o NOME, e nao a linha inteira.
    textoDaAncora: secaoDoPrevisto.querySelector("a[href]")
      ? secaoDoPrevisto.querySelector("a[href]").textContent.trim()
      : null,
  };

  await clicar(raiz, PREVISTO, "Pagar");

  out.h_depois = {
    dialogo: ABERTO,
    chamadas: CHAMADAS.slice(),
    // A linha NAO SAIU da tela: o clique abre uma pergunta, nao escreve.
    previsto: retrato(raiz, PREVISTO),
  };
}

// =========================================================================
// I. A FATURA FECHADA: o mesmo botao, e o id DE BANCO chegando no dialogo
// =========================================================================
{
  const fechada = linha({
    id: "s-fatura",
    gravada: true,
    descricao: "Fatura Nubank 10/2026",
    valor: 980.4,
    data: "2026-10-28",
    natureza: "fatura",
    fatura: { accountId: CARTAO, mes: "2026-10-01" },
  });
  const raiz = await montar("raiz-i", [corpo([fechada])]);

  await clicar(raiz, PREVISTO, "Pagar");
  out.i = { dialogo: ABERTO, chamadas: CHAMADAS.slice() };
}

// =========================================================================
// J. A PREVISAO LIGADA AO ELO: DUAS acoes na mesma linha, e NENHUM link
// =========================================================================
// O sabor 3 (HMO-305). "Duas acoes na mesma linha e um estado a DESENHAR, nao a
// descobrir": o desfazer do elo vive dentro da linha (no rodape de texto) e o
// Pagar fica a direita, onde as outras linhas tem Editar/Excluir.
//
// E ela NAO leva o nome do cartao como link: ela e uma previsao na conta
// corrente, nao a fatura em si -- a decisao da HMO-305, preservada.
{
  const ligada = linha({
    id: "s-previsao",
    gravada: true,
    descricao: "Cartão Nubank",
    valor: 1234.56,
    data: "2026-10-28",
    natureza: "fatura",
    fatura: { accountId: CARTAO, mes: "2026-10-01" },
    elo_da_fatura: { accountId: CARTAO, mes: "2026-10-01" },
  });
  const raiz = await montar("raiz-j", [corpo([ligada])]);

  const secaoDoPrevisto = secao(raiz, PREVISTO);
  await clicar(raiz, PREVISTO, "Pagar");

  out.j = {
    previsto: retrato(raiz, PREVISTO),
    dialogo: ABERTO,
    // O marcador do elo PRESENTE e o link do cartao AUSENTE, na mesma linha.
    temElo: secaoDoPrevisto.textContent.indexOf("ESBOCO-ELO") !== -1,
    ancoras: Array.prototype.slice
      .call(secaoDoPrevisto.querySelectorAll("a[href]"))
      .map((a) => a.getAttribute("href")),
  };
}

// =========================================================================
// K. A FATURA SEM DIA DE VENCIMENTO: nenhum botao, e a frase que explica
// =========================================================================
// Ela nao e linha da lista: vem num bloco a parte com so
// \`{ account_name, total }\` -- sem id e sem \`accountId\`. "A fatura do Nubank tem
// botão e a do C6 não" se lê como tela quebrada, e a reacao e recarregar a
// pagina em vez de cadastrar o dia de vencimento, que e o caminho.
{
  const comVencimento = linha({
    id: "fatura:2026-10-01:" + CARTAO,
    gravada: false,
    descricao: "Fatura Nubank",
    natureza: "fatura",
    fatura: { accountId: CARTAO, mes: "2026-10-01" },
  });
  const raiz = await montar("raiz-k", [
    {
      resumo: { total: 0, previsto: 0, realizado: 0, quantidade: 1 },
      vencido: { total: 0, quantidade: 0 },
      linhas: [comVencimento],
      fatura_sem_vencimento: [{ account_name: "C6", total: 512.3 }],
    },
  ]);

  // O BLOCO do cartao sem vencimento: ele e irmao das secoes, e nao esta dentro
  // delas. Achado pelo titulo, pela mesma regra de \`secao\`.
  const bloco = Array.prototype.slice
    .call(raiz.children)
    .find((el) => el.textContent.indexOf("fora do previsto") !== -1);

  out.k = {
    texto: bloco ? bloco.textContent.replace(/\\s+/g, " ").trim() : null,
    // NENHUM "Pagar" no bloco -- e um "Pagar" na SECAO, que e o contraste que
    // torna a frase necessaria.
    pagarNoBloco: bloco
      ? !!bloco.querySelector('[aria-label="Pagar"]')
      : null,
    pagarNaSecao: !!secao(raiz, PREVISTO).querySelector('[aria-label="Pagar"]'),
  };
}

// =========================================================================
// M. "ELA PAGOU; EU CONFIRMO": o bloco aparece, o POST sai, E A LINHA MUDA DE
//    LADO -- HMO-366, fase F4 da HMO-360
// =========================================================================
// O controle que a issue exige, inteiro e em UMA montagem: ANTES de confirmar a
// linha esta no lado a confirmar; DEPOIS ela sai de la e aparece ROTULADA no
// lado recebido, FORA do total. Medir so a primeira metade deixaria passar o
// defeito que esta fase existe para resolver -- a perna e \`transfer\`, nao entra
// em Receitas realizadas, e sem o segundo bloco confirmar faz a linha
// DESAPARECER da tela.
//
// E o POST tem de sair com a CONTA: sem \`account_id\` a rota responde 400, e um
// "Confirmar" que abre dialogo e nao escreve nada passaria por qualquer assercao
// de DOM.
{
  const antes = corpoDeReceita({ a_confirmar: [acerto()], confirmados: [] });
  const depois = corpoDeReceita({ a_confirmar: [], confirmados: [acerto()] });

  const raiz = await montar("raiz-m", [antes, depois], {
    tipo: "income",
    tela: TELA_DE_RECEITA,
    aparencia: APARENCIA_DE_RECEITA,
    origem: "/dashboard/receitas?de=2026-10-01&ate=2026-10-31",
  });

  // OS BLOCOS SAO IRMAOS DAS SECOES, e nao estao dentro delas: achados pelo
  // TITULO que a lib define, pela mesma regra de \`secao\`.
  const bloco = (titulo) =>
    Array.prototype.slice
      .call(raiz.children)
      .find(function (el) {
        return el.textContent.indexOf(titulo) !== -1;
      }) || null;

  const retratoDoBloco = (titulo) => {
    const el = bloco(titulo);
    if (!el) return null;
    return {
      texto: el.textContent.replace(/\\s+/g, " ").trim(),
      // O botao pelo \`id\` que o componente da a ele: \`aria-label\` e a chave das
      // acoes de LINHA (\`SecaoDaTela\`), e este botao nao e uma delas.
      temConfirmar: !!el.querySelector("#confirmar-acerto-" + ACERTO_ID),
      confirmarDesabilitado: el.querySelector("#confirmar-acerto-" + ACERTO_ID)
        ? el.querySelector("#confirmar-acerto-" + ACERTO_ID).disabled === true
        : null,
    };
  };

  out.m_antes = {
    aConfirmar: retratoDoBloco(TITULO_A_CONFIRMAR),
    recebido: retratoDoBloco(TITULO_CONFIRMADO),
    // As duas secoes normais continuam na tela, e VAZIAS: o acerto nao e linha
    // da lista, e ninguem o somou em cartao nenhum.
    previsto: retrato(raiz, PREVISTO),
    realizado: retrato(raiz, REALIZADO),
    chamadas: CHAMADAS.slice(),
  };

  // 1. O clique abre o dialogo e LE AS CONTAS -- nenhuma escrita ainda.
  raiz.querySelector("#confirmar-acerto-" + ACERTO_ID).click();
  await assentar();

  out.m_dialogo = {
    // O CONTROLE DA ASSERCAO DE "FECHOU" la embaixo: aqui a marca TEM de estar
    // no DOM. Sem este par, um esboco que nunca montasse nada faria
    // \`dialogoNoDom: false\` passar verde nos DOIS momentos.
    noDom: !!raiz.querySelector('[data-esboco="dialogo-do-acerto"]'),
    aberto: ACERTO_ABERTO
      ? {
          direcao: ACERTO_ABERTO.direcao,
          nomeDaContraparte: ACERTO_ABERTO.nomeDaContraparte,
          valor: ACERTO_ABERTO.valor,
          moeda: ACERTO_ABERTO.moeda,
          cotacao: ACERTO_ABERTO.cotacao,
          contas: ACERTO_ABERTO.contas,
          titulo: ACERTO_ABERTO.titulo,
          rotuloDoBotao: ACERTO_ABERTO.rotuloDoBotao,
        }
      : null,
    chamadas: CHAMADAS.slice(),
  };

  // 2. A conta escolhida no dialogo -- o mesmo que o botao real faz.
  if (ACERTO_ABERTO) await ACERTO_ABERTO.aoConfirmar("conta-nubank");
  await assentar();

  out.m_depois = {
    aConfirmar: retratoDoBloco(TITULO_A_CONFIRMAR),
    recebido: retratoDoBloco(TITULO_CONFIRMADO),
    previsto: retrato(raiz, PREVISTO),
    realizado: retrato(raiz, REALIZADO),
    chamadas: CHAMADAS.slice(),
    // FECHOU? Pela MARCA NO DOM, e nao pelo registro de props: ver o esboco.
    dialogoNoDom: !!raiz.querySelector('[data-esboco="dialogo-do-acerto"]'),
    toasts: TOASTS.slice(),
  };

  // As frases de producao, para a assercao comparar com o que esta na tela.
  out.m_frases = {
    tituloAConfirmar: TITULO_A_CONFIRMAR,
    subtitulo: SUBTITULO_A_CONFIRMAR,
    tituloConfirmado: TITULO_CONFIRMADO,
    foraDoPrevisto: ACERTO_FORA_DO_PREVISTO,
    foraDoRealizado: ACERTO_FORA_DO_REALIZADO,
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

  // O VENCIMENTO ABRE MASCARADO (HMO-324). Ate a troca do campo este valor era
  // "2026-10-15" -- o texto que o `<input type="date">` nativo guarda e que o
  // navegador reordena na exibicao conforme o APARELHO. Agora o que esta na
  // tela e o que a pessoa le em portugues, e o ISO vive por baixo (caso G2).
  assert.equal(resultado.g_aberto.vencimento, "15/10/2026");

  // E o campo NAO e o controle nativo. `check-campo-de-data` varre o fonte;
  // esta linha afirma o que o navegador recebeu -- as duas peneiras falham por
  // motivos diferentes e nenhuma cobre a outra.
  assert.equal(
    resultado.g_aberto.tipoDoVencimento,
    "text",
    "o campo de vencimento voltou a ser `type=date`: a ordem dos segmentos " +
      "passa a sair do aparelho e 10/03 vira 3 de outubro sem erro nenhum"
  );

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

test("G4: vencimento DIGITADO em dd/mm/aaaa vira AAAA-MM-DD no PATCH", () => {
  // A mascara na tela: oito digitos com as duas barras, na ordem que a pessoa
  // digitou. Sem esta linha, um campo que ENGOLISSE a digitacao (o que o nativo
  // faz em parte das posicoes de clique: oito teclas, nada gravado) deixaria a
  // assercao de baixo medindo a data PREENCHIDA, nao a digitada.
  assert.equal(resultado.g_digitado.exibicao, "20/11/2026");

  const patches = resultado.g_digitado.chamadas.filter((c) => c.metodo === "PATCH");
  assert.equal(patches.length, 1, JSON.stringify(resultado.g_digitado.chamadas));

  // E O QUE IMPORTA: o banco recebe ISO. `due_date` e `date` no Postgres, e
  // "20/11/2026" seria recusado -- ou, pior, aceito ao contrario.
  assert.equal(
    patches[0].corpo.due_date,
    "2026-11-20",
    "a data digitada nao chegou em AAAA-MM-DD: " + JSON.stringify(patches[0].corpo)
  );

  // Os outros dois campos nao foram tocados neste caso, e por isso vao com o
  // valor que abriu: a prova de que mexer na data nao zera o resto do
  // formulario.
  assert.equal(patches[0].corpo.description, "Aluguel");
  assert.equal(patches[0].corpo.amount, 2500);
});

// =============================================================================
// O BOTAO PAGAR NA LINHA DA FATURA (HMO-311, fase 14)
// =============================================================================

test("H1: CONTROLE: a fatura ABERTA minha TEM o botao Pagar, e ele e <button>", () => {
  // O controle positivo de tudo abaixo. A fatura aberta e `gravada: false`: um
  // botao gateado por `gravada` (que e o criterio da baixa generica, regra 3)
  // deixaria de fora justamente a maior fonte do «Previsto» desta tela, e os
  // blocos negativos daqui para baixo passariam verde.
  assert.ok(resultado.h_antes.previsto, "a secao Previsto nao pintou");
  assert.match(resultado.h_antes.previsto.texto, /Fatura Nubank/);
  assert.equal(resultado.h_antes.temBotao, true, "a fatura aberta ficou sem Pagar");
  assert.equal(resultado.h_antes.tagDoBotao, "BUTTON");
  assert.deepEqual(resultado.h_antes.previsto.acoes.map((a) => a.rotulo), [
    "Pagar",
  ]);
  // E o dialogo nasce FECHADO: sem isto, "o clique abriu o dialogo" passaria
  // verde num dialogo que ja estava aberto desde a montagem.
  assert.equal(resultado.h_antes.dialogo, null, "o dialogo abriu sem clique");
});

test("H2: O ANINHAMENTO: o botao Pagar NAO esta dentro de nenhuma <a>", () => {
  // A ASSERCAO QUE FECHA A RAZAO PELA QUAL ESTE BOTAO NAO EXISTIA. Enquanto a
  // linha era um `<a>` para a tela do cartao, o clique no botao faria as DUAS
  // coisas -- abrir o dialogo e navegar -- e o "funcionou" seria indistinguivel
  // do bug. `closest("a")` sobe a arvore do DOM de verdade.
  assert.equal(resultado.h_antes.botaoDentroDeAncora, false);

  // E OS DOIS ALVOS CONTINUAM EXISTINDO: o nome do cartao ainda leva ao cartao.
  // O caminho e marcador aqui (`caminhoDoCartaoNoMes` e esboco); o `?mes=` de
  // verdade esta em `npm run test:secao-da-tela`.
  assert.deepEqual(resultado.h_antes.ancoras, [
    "ESBOCO-CAMINHO:" + "33333333-3333-4333-b333-333333333333" + ":2026-10-01",
  ]);
  // O LINK E O NOME, e nao a linha: se a ancora engolisse a linha inteira, o
  // texto dela traria tambem o valor e o rotulo da natureza.
  assert.equal(resultado.h_antes.textoDaAncora, "Fatura Nubank");
});

test("H3: o clique ABRE o dialogo com a linha CONVERTIDA -- `id: null`", () => {
  // A chave sintetica da fatura aberta NAO e id de banco. Sem
  // `linhaParaPagarDaTela` (codigo de producao extraido, ver `daLib`), a
  // sequencia montaria
  // `POST /api/scheduled-transactions/fatura:2026-10-01:<uuid>/pay` -- 404, que
  // para quem clicou se le como "o app nao conseguiu".
  const d = resultado.h_depois.dialogo;

  assert.ok(d, "o clique em Pagar nao abriu o dialogo");
  assert.equal(d.linha.id, null, `a chave sintetica virou id: ${d.linha.id}`);
  assert.equal(d.linha.gravada, false);
  assert.equal(d.linha.natureza, "fatura");
  assert.deepEqual(d.linha.fatura, {
    accountId: "33333333-3333-4333-b333-333333333333",
    mes: "2026-10-01",
  });
  assert.equal(d.linha.description, "Fatura Nubank");

  // O VENCIMENTO VAI JA FORMATADO pela tela (`dataLonga`, producao): o
  // componente nao tem formatador proprio.
  assert.equal(d.vencimentoFormatado, "28/10/2026");

  // E `hoje` E A DATA DE SAO PAULO, nao a do navegador. O oraculo e calculado
  // AQUI, do lado do node, e nao copiado do que a pagina devolveu -- comparar a
  // resposta consigo mesma e o que faria esta assercao vacua.
  //
  // O `paid_date` da fatura decide em qual MES a baixa cai, e na Vercel (UTC) o
  // dia vira tres horas antes do dia de Sao Paulo: um `toISOString().slice(0,10)`
  // mandaria a fatura de outubro para novembro entre 21h e meia-noite, sem nada
  // na tela parecendo errado.
  //
  // RESSALVA HONESTA: esta assercao so SEPARA as duas implementacoes quando o
  // relogio esta na janela em que as datas diferem. Fora dela ela e verdadeira e
  // nao distingue -- a prova de que `today()` nao depende do fuso do processo
  // esta na suite dela, que roda nos dois fusos.
  assert.match(d.hoje, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(
    d.hoje,
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
    }).format(new Date()),
    "o `hoje` que chegou ao dialogo nao e a data de Sao Paulo"
  );
});

test("H4: o clique NAO ESCREVE NADA -- ele abre uma pergunta", () => {
  // O `close` e o `/pay` acontecem no Confirmar DO DIALOGO, depois da escolha da
  // conta. Materializar a fatura na abertura deixaria uma fatura fechada para
  // tras cada vez que alguem abrisse e desistisse -- e fechar nao e reversivel
  // pela tela.
  const escritas = resultado.h_depois.chamadas.filter((c) => c.metodo !== "GET");
  assert.deepEqual(escritas, [], JSON.stringify(escritas));

  // E UMA leitura so: sem escrita, sem releitura. A linha fica onde estava.
  assert.equal(resultado.h_depois.chamadas.length, 1);
  assert.match(resultado.h_depois.previsto.texto, /Fatura Nubank/);
});

test("I: a fatura FECHADA manda o id DE BANCO, e nao `null`", () => {
  // O PAR de H3. Sem este bloco, um `id: null` incondicional passaria lá e a
  // fatura fechada cairia em "Não foi possível registrar a fatura" sem rede
  // nenhuma -- sobre uma fatura que ja esta registrada.
  const d = resultado.i.dialogo;

  assert.ok(d, "o clique em Pagar nao abriu o dialogo na fatura fechada");
  assert.equal(d.linha.id, "s-fatura");
  assert.equal(d.linha.gravada, true);
  assert.equal(d.linha.description, "Fatura Nubank 10/2026");

  const escritas = resultado.i.chamadas.filter((c) => c.metodo !== "GET");
  assert.deepEqual(escritas, [], JSON.stringify(escritas));
});

test("J: a previsao LIGADA AO ELO tem as DUAS acoes, e NENHUM link do cartao", () => {
  // "Duas acoes na mesma linha e um estado a DESENHAR, nao a descobrir": o
  // desfazer do elo (marcador aqui) no rodape de texto da linha, e o Pagar a
  // direita, onde as outras linhas tem Editar/Excluir.
  assert.deepEqual(resultado.j.previsto.acoes.map((a) => a.rotulo), ["Pagar"]);
  assert.equal(resultado.j.temElo, true, "o elo da HMO-305 desapareceu da linha");

  // E ELA NAO LEVA AO CARTAO -- a decisao da HMO-305, preservada: ela e uma
  // previsao na conta corrente, nao a fatura em si.
  assert.deepEqual(resultado.j.ancoras, [], JSON.stringify(resultado.j.ancoras));

  // E O PAGAR DELA FUNCIONA: gravada, com id de banco, UMA escrita so (a
  // previsao ligada NAO leva `close` -- medido em `test:pagamento-da-fatura`).
  assert.ok(resultado.j.dialogo, "a previsao ligada nao abriu o dialogo");
  assert.equal(resultado.j.dialogo.linha.id, "s-previsao");
  assert.equal(resultado.j.dialogo.linha.gravada, true);
});

test("K: a fatura SEM DIA DE VENCIMENTO nao tem Pagar -- e a tela diz por que", () => {
  // O CONTRASTE E O QUE TORNA A FRASE NECESSARIA, e e por isso que as duas
  // metades estao no mesmo bloco: na MESMA tela, uma fatura tem botao e a outra
  // nao. Sem a frase, isso se le como tela quebrada e manda recarregar a pagina.
  assert.ok(resultado.k.texto, "o bloco da fatura sem vencimento nao pintou");
  assert.equal(resultado.k.pagarNaSecao, true, "o contraste nao vale: ninguem tem Pagar");
  assert.equal(resultado.k.pagarNoBloco, false, "a fatura sem vencimento ganhou Pagar");

  assert.match(resultado.k.texto, /C6/);
  assert.match(resultado.k.texto, /não tem o botão Pagar/);
  assert.match(resultado.k.texto, /dia de vencimento/);
  assert.match(resultado.k.texto, /passa a aparecer na lista/);
});

// =============================================================================
// M. "ELA PAGOU; EU CONFIRMO" NA ABA RECEITAS -- HMO-366, fase F4 da HMO-360
// =============================================================================

test("M: CONTROLE -- a aba Receitas pintou, e o bloco a confirmar esta nela", () => {
  // O controle que da sentido a toda assercao negativa deste caso. Sem ele,
  // "a linha nao esta mais no bloco a confirmar" ficaria verde por a pagina nao
  // ter pintado nada -- indistinguivel de uma feature que funciona.
  assert.ok(resultado.m_antes.previsto, "a secao Previsto nao existe na aba Receitas");
  assert.ok(resultado.m_antes.realizado, "a secao Realizado nao existe na aba Receitas");

  const b = resultado.m_antes.aConfirmar;
  assert.ok(b, "o bloco de acerto a confirmar nao pintou");
  assert.match(b.texto, /Letícia/, "a linha nao nomeia quem pagou");
  // O VALOR E A MOEDA chegaram ao formatador, que nesta sonda e MARCADOR (ver
  // `formatCurrency` no cabecalho). A moeda e load-bearing: a 026 deixa a
  // quitacao ser em USD, e um `formatCurrency(valor)` sem o segundo argumento
  // imprimiria R$ em cima de dolar -- numero certo, simbolo errado. Quem prova
  // o FORMATO e `npm run test:dinheiro`; o que se mede aqui e o fio.
  assert.match(b.texto, /ESBOCO-VALOR:300:BRL/);
  assert.equal(b.temConfirmar, true, "a linha a confirmar nao ganhou botao");
  assert.equal(
    b.confirmarDesabilitado,
    false,
    "o botao nasceu desabilitado com a leitura fresca"
  );

  // A LEITURA E A DA ABA RECEITAS: com `?tipo=expense` a rota nao devolveria
  // acerto nenhum (a guarda esta na lib, com mutante), e este caso inteiro
  // estaria medindo outra tela.
  const [primeira] = resultado.m_antes.chamadas;
  assert.equal(
    primeira.url,
    "/api/movimentacoes/resumo?tipo=income&de=2026-10-01&ate=2026-10-31"
  );
});

test("M: o acerto a confirmar NAO entra nas duas secoes nem nos cartoes", () => {
  // As duas razoes estao no cabecalho de lib/acerto-na-aba-receitas.ts: o
  // «Previsto» de Receitas JA conta este dinheiro como reembolso previsto (F3),
  // e a perna e `transfer`. A tela mostra o valor FORA dos tres cartoes, e isto
  // afirma que ele nao vazou para a lista -- onde `resumoDaTela` o somaria.
  assert.ok(
    !resultado.m_antes.previsto.texto.includes("Letícia"),
    resultado.m_antes.previsto.texto
  );
  assert.ok(
    !resultado.m_antes.realizado.texto.includes("Letícia"),
    resultado.m_antes.realizado.texto
  );

  // E a frase DIZ que ele esta fora, com as palavras da lib -- nao com uma
  // copia escrita nesta sonda.
  assert.ok(
    resultado.m_antes.aConfirmar.texto.includes(resultado.m_frases.foraDoPrevisto),
    resultado.m_antes.aConfirmar.texto
  );
  assert.ok(
    resultado.m_antes.aConfirmar.texto.includes(resultado.m_frases.subtitulo),
    resultado.m_antes.aConfirmar.texto
  );
});

test("M: o clique ABRE o dialogo com a conta a escolher, e NAO escreve nada", () => {
  const d = resultado.m_dialogo.aberto;
  assert.ok(d, "o clique em Confirmar nao abriu o dialogo do acerto");
  assert.equal(
    resultado.m_dialogo.noDom,
    true,
    "o dialogo nao foi montado: a assercao de 'fechou' la embaixo seria vacua"
  );

  // `direcao` e o que decide o SINAL da perna: com "paguei" o Pix de R$ 300
  // SAIRIA da conta de quem recebeu.
  assert.equal(d.direcao, "recebi");
  assert.equal(d.valor, 300);
  assert.equal(d.moeda, "BRL");
  assert.equal(d.cotacao, 1);
  assert.equal(d.nomeDaContraparte, "Letícia");
  // O titulo e o botao sao os da CONTRAPARTE (fase 12), e nao os de registrar:
  // o acerto ja existe, e "Registrar acerto" sugeriria um segundo pagamento.
  assert.equal(d.titulo, "Lançar o que recebi");
  assert.equal(d.rotuloDoBotao, "Lançar na minha conta");

  // As contas chegaram, e vieram da rota -- `GET /api/financial-accounts`.
  assert.deepEqual(d.contas.map((c) => c.id), ["conta-nubank"]);
  const leituras = resultado.m_dialogo.chamadas.filter((c) => c.metodo === "GET");
  assert.ok(
    leituras.some((c) => c.url === "/api/financial-accounts"),
    JSON.stringify(leituras)
  );

  // NENHUMA ESCRITA ate aqui: a pergunta "de qual conta?" nao tem resposta
  // padrao, e um POST disparado no clique do botao da linha lancaria o dinheiro
  // numa conta que a pessoa nao escolheu.
  const escritas = resultado.m_dialogo.chamadas.filter((c) => c.metodo !== "GET");
  assert.deepEqual(escritas, [], JSON.stringify(escritas));
});

test("M: confirmar chama o POST da PERNA, com o grupo, o acerto e a conta", () => {
  const escritas = resultado.m_depois.chamadas.filter((c) => c.metodo !== "GET");
  assert.equal(escritas.length, 1, JSON.stringify(escritas));

  const [post] = escritas;
  assert.equal(post.metodo, "POST");
  // A ROTA QUE JA EXISTE (HMO-245 fase 12), e e ela quem grava a perna como
  // `transfer` com `group_id: null` literal -- as duas regras com medicao
  // atras. Qualquer outra URL aqui significaria insert novo em outro lugar.
  assert.equal(
    post.url,
    "/api/expense-groups/77777777-7777-4777-b777-777777777777" +
      "/settlements/5e111111-1111-4111-b111-111111111111/perna"
  );
  // `account_id` E A ENTREGA DO DIALOGO: sem ele a rota responde 400, e o
  // "Confirmar" viraria um botao que abre dialogo e nao lanca nada.
  assert.deepEqual(post.corpo, { account_id: "conta-nubank" });
});

test("M: depois de confirmar a linha SAI do a confirmar e APARECE no recebido", () => {
  // AS DUAS METADES, no mesmo bloco. Esta e a assercao da issue, e a segunda e
  // a que importa: a perna e `transfer` e nao entra em Receitas realizadas,
  // entao sem o bloco de recebidos a linha DESAPARECERIA da tela depois do
  // clique -- indistinguivel de bug, e o caminho dessa estranheza termina em
  // alguem lancando a receita a mao.
  assert.equal(
    resultado.m_depois.aConfirmar,
    null,
    "o bloco a confirmar continuou na tela depois de confirmar"
  );

  const r = resultado.m_depois.recebido;
  assert.ok(r, "a linha confirmada DESAPARECEU: e o defeito que a F4 resolve");
  assert.match(r.texto, /Letícia/);
  assert.match(r.texto, /ESBOCO-VALOR:300:BRL/);
  assert.equal(r.temConfirmar, false, "a linha ja lancada ganhou Confirmar de novo");

  // E O ROTULO DIZ POR QUE O CARTAO «Realizado» NAO SUBIU. Sem a frase, o
  // bloco seria um valor a mais ao lado de um numero que nao se mexeu.
  assert.ok(
    r.texto.includes(resultado.m_frases.foraDoRealizado),
    r.texto
  );
  assert.ok(
    !resultado.m_depois.realizado.texto.includes("Letícia"),
    resultado.m_depois.realizado.texto
  );

  // A RELEITURA ACONTECEU -- e e ela que move a linha de lado. Sem ela a rota
  // responderia 200 e o bloco ficaria onde estava, com o segundo clique caindo
  // no 409 de uma operacao que deu certo.
  const leituras = resultado.m_depois.chamadas.filter(
    (c) => c.metodo === "GET" && c.url.startsWith("/api/movimentacoes/resumo")
  );
  assert.equal(leituras.length, 2, JSON.stringify(leituras));

  // O dialogo fechou, e o toast confirma pela palavra que o app escolheu.
  assert.equal(resultado.m_depois.dialogoNoDom, false, "o dialogo ficou aberto");
  const ultimo = resultado.m_depois.toasts[resultado.m_depois.toasts.length - 1];
  assert.equal(ultimo.tipo, "success", JSON.stringify(ultimo));
  assert.match(ultimo.texto, /conta/);
});
