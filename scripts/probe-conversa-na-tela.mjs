#!/usr/bin/env node
// =============================================================================
// SONDA: A CONVERSA FECHA OS TRES NUMEROS NO CELULAR? (HMO-468, F4 da HMO-462)
// =============================================================================
//   node scripts/probe-conversa-na-tela.mjs
//
// O teste de aceitacao da issue-mae, literal:
//
//   entrar no modo, Gastei 1000, Ganhei 2000 -> a tela mostra
//   `Ganhei 2000`, `Gastei 1000`, `Saldo 1000`, os tres juntos, fechando de
//   cabeca.
//
// Ela roda o COMPONENTE DE PRODUCAO (`components/papel-de-pao/ConversaDePapel.tsx`,
// compilado) num Chromium headless, numa viewport de iPhone (390x844), e CLICA:
// Gastei, seis teclas, Pronto, Sim-anotar; Ganhei, seis teclas, Pronto,
// Sim-anotar; Saldo. Depois LE O TEXTO que ficou no DOM.
//
// -----------------------------------------------------------------------------
// POR QUE "LER O TEXTO", E NAO "o elemento existe"
// -----------------------------------------------------------------------------
// "Sumido da tela" pode ser so indistinguivel, e o contrario tambem: um `<li>`
// presente com o numero errado passa em qualquer assercao de presenca. Entao as
// assercoes desta sonda comparam STRINGS INTEIRAS -- "R$ 2.000,00", nao
// "contem 2000" --, e a leitura que importa e o MAPA dos tres rotulos:
// `{Ganhei, Gastei, Saldo}`. Um `Saldo` que nao seja `Ganhei - Gastei` reprova
// aqui mesmo com os outros dois certos, que e o defeito que o plano-mae nomeia.
//
// MIL REAIS SAO SEIS TECLAS, e isso nao e detalhe de sonda: `aoDigitarValor`
// (lib/dinheiro.ts) e o teclado de dinheiro de todo campo deste app e a
// convencao dele e CENTAVOS -- 1-0-0-0 da "R$ 10,00". O cabecalho de
// `lib/conversa-do-papel.ts` declara essa consequencia. Digitar quatro teclas
// aqui mediria R$ 10,00 e o `Saldo` ainda fecharia -- verde medindo a conta
// errada.
//
// -----------------------------------------------------------------------------
// O QUE E DE PRODUCAO NESTA PAGINA, E O QUE E ESBOCO
// -----------------------------------------------------------------------------
// DE PRODUCAO, compilado e intacto: `ConversaDePapel`, o motor da conversa
// (`lib/conversa-do-papel.js`), as TRES SOMAS (`lib/saldo-da-conversa.js`), o
// dinheiro (`lib/dinheiro.js`, `lib/moeda.js`), o calendario
// (`lib/periodo-do-painel.js`, `lib/recurrence.js`) e os dois primitivos de
// interface (`button.js`, `card.js`).
//
// Ou seja: as frases, a ordem das teclas, a mascara do valor, os rotulos dos
// tres numeros, a janela do mes e a ARITMETICA sao os do app. Nada disso esta
// escrito aqui.
//
// ESBOCO, e so isto:
//
//   * `cn`, `cva`, `Slot` -- a fiacao de CLASSE do Button. Calculo de string
//     (clsx + tailwind-merge + cva), e nenhuma assercao daqui fala de classe de
//     Tailwind. Mesmo esboco da sonda irma `test-papel-na-tela.mjs`;
//   * `fetch` -- O SERVIDOR. Ver a secao abaixo.
//
// -----------------------------------------------------------------------------
// O `fetch` ESBOCADO E UM BANCO DE MENTIRA -- MAS NAO UMA ARITMETICA DE MENTIRA
// -----------------------------------------------------------------------------
// O que o esboco substitui e o que so o servidor tem: autenticacao, a escada da
// conta, a categoria reservada e o `insert`. O que ele NAO substitui sao as
// somas: depois de guardar a linha, ele chama `tresNumerosDaConversa` e
// `mesCorrenteDaConversa` DE PRODUCAO, os mesmos que `tresNumerosDoMes` chama
// dentro de `app/api/papel-de-pao/conversa/route.ts`. Por isso o "Saldo 1000"
// que esta sonda mede e a conta do app, e nao um numero que eu escrevi.
//
// A UNICA linha da rota que o esboco REPETE e o SINAL (`-valor` para "gastei"),
// porque e ela que transforma o corpo de dois campos numa linha de
// `financial_transactions`. Copia que ninguem confere e copia que diverge:
// `CONFERE_A_ROTA` abaixo exige, no fonte da rota, os cinco pedacos de que esta
// reproducao depende -- entre eles a propria linha do sinal. Mudou a rota, a
// sonda ABORTA em vez de medir uma rota que nao existe mais.
//
// O que esta sonda NAO prova, e esta dito: que o banco aceite o insert, que a
// RLS deixe, que a conta padrao exista. Isso e `npm run test:rota-da-conversa`
// (duble de rota) e, depois, producao.
//
// -----------------------------------------------------------------------------
// NAO EXPORTE `CHROMIUM_BIN`
// -----------------------------------------------------------------------------
// A busca LISTA a pasta do Playwright em vez de fixar a versao -- a licao da
// HMO-365/HMO-406, em que `chromium-1243` cravado no fonte deixou quatro sondas
// 100% vermelhas numa arvore intocada. Sem navegador esta sonda ABORTA com
// codigo 2 e a causa na mensagem; ela nao se desliga sozinha, porque sonda que
// se desliga e indistinguivel de sonda que passou.
// =============================================================================

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SAIDA = ".tmp-conversa-na-tela";
const TSCONFIG = "scripts/tsconfig.conversa-na-tela-probe.json";
const ROTA = "app/api/papel-de-pao/conversa/route.ts";

/**
 * A frase do 409 da rota -- "nao ha conta onde lancar".
 *
 * As DUAS METADES dela estao em `CONFERE_A_ROTA`, entao esta nao e uma copia
 * que envelhece calada: mudou a frase na rota, a sonda aborta pedindo que esta
 * linha mude junto.
 */
const FRASE_DA_RECUSA =
  "Você ainda não tem uma conta onde lançar. Cadastre uma conta " +
  "corrente ou dinheiro em Contas.";

/** O nome que o `/api/profile` esbocado devolve. Tres palavras de proposito. */
const NOME_COMPLETO = "Letícia Moraes de Souza";
/** O que `primeiroNome` tem de fazer com ele. */
const PRIMEIRO_NOME = "Letícia";

let falhou = false;

function ok(descricao, condicao, detalhe = "") {
  console.log(
    `  ${condicao ? "OK" : "XX"} ${descricao}${detalhe ? "  -- " + detalhe : ""}`
  );
  if (!condicao) falhou = true;
}

function abortar(mensagem) {
  console.error(`ABORTADO: ${mensagem}`);
  process.exit(2);
}

/** Espaco fino/duro do Intl vira espaco comum: "R$ 1.000,00" tem NBSP depois do R$. */
const normalizar = (texto) =>
  String(texto ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// -----------------------------------------------------------------------------
// 0. A GUARDA DE FIDELIDADE DO ESBOCO DA ROTA
// -----------------------------------------------------------------------------
// Os cinco pedacos de `app/api/papel-de-pao/conversa/route.ts` de que a
// reproducao do servidor (o `fetch` esbocado) depende. Sumindo um, o esboco
// passa a descrever uma rota que nao existe e o verde desta sonda nao vale
// nada -- entao ela ABORTA em vez de medir.
const CONFERE_A_ROTA = [
  // o corpo lido: DOIS campos, e sao estes dois que a sonda manda
  "const direcao = direcaoDoCorpo(corpo.direcao);",
  "const valor = valorDoCorpo(corpo.valor);",
  // O SINAL -- a unica linha da rota que o esboco repete
  'amount: direcao === "gastei" ? -valor : valor,',
  // sem isto a linha nasce com tipo nulo e as somas nao a veem
  "transaction_type: TIPO_POR_DIRECAO[direcao],",
  // as somas, que o esboco NAO repete: ele chama as mesmas
  "numeros: tresNumerosDaConversa(doBanco, mes),",
  // as duas metades da frase do 409 que o caso K mede na tela
  '"Você ainda não tem uma conta onde lançar. Cadastre uma conta " +',
  '"corrente ou dinheiro em Contas.",',
];

{
  let fonteDaRota;
  try {
    fonteDaRota = readFileSync(ROTA, "utf8");
  } catch (erro) {
    abortar(`nao li ${ROTA}: ${erro.message}`);
  }
  const faltando = CONFERE_A_ROTA.filter((p) => !fonteDaRota.includes(p));
  if (faltando.length > 0) {
    abortar(
      `${ROTA} mudou -- o servidor esbocado desta sonda nao a descreve mais.\n` +
        faltando.map((p) => `  faltou: ${p}`).join("\n") +
        "\nAtualize CONFERE_A_ROTA e o esboco JUNTOS, ou a sonda mede uma rota " +
        "que nao existe."
    );
  }
}

// -----------------------------------------------------------------------------
// 1. COMPILAR
// -----------------------------------------------------------------------------
// A sonda compila sozinha: nao ha `npm run test:conversa-na-tela` (ver o
// cabecalho do tsconfig). `stdio: inherit` porque o erro do tsc e a informacao.
try {
  execFileSync(
    process.execPath,
    [join("scripts", "compila.mjs"), "-p", TSCONFIG],
    { stdio: "inherit" }
  );
} catch (erro) {
  abortar(`a compilacao falhou: ${erro.message}`);
}

/**
 * Acha um Chromium: o do `CHROMIUM_BIN`, o que o Playwright baixou, ou o Chrome
 * do sistema. A pasta e LISTADA, nunca com a versao fixa no fonte.
 */
function acharChromium() {
  const candidatos = [process.env.CHROMIUM_BIN];

  for (const base of [
    `${process.env.HOME}/.cache/ms-playwright`,
    "/paperclip/.cache/ms-playwright",
    "/root/.cache/ms-playwright",
    "/ms-playwright",
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

// -----------------------------------------------------------------------------
// 2. A PAGINA
// -----------------------------------------------------------------------------

/** Tira so a fiacao de modulo, deixando o corpo das funcoes intacto. */
const paraScriptClassico = (fonte) =>
  fonte
    .replace(/^import\s[\s\S]*?;$/gm, "")
    .replace(/^export\s*\{[^}]*\}\s*;$/gm, "")
    .replace(/^export /gm, "");

/**
 * OS MODULOS DA PAGINA, EM ORDEM DE DEPENDENCIA.
 *
 * Esta lista e montada A MAO e NAO e o `include` do tsconfig: o tsc alcanca os
 * imports por transitividade, esta pagina nao. Um import novo em
 * `ConversaDePapel.tsx` compila sem estar aqui, e o sintoma e um
 * `ReferenceError` de NIVEL DE MODULO -- a pagina nao reporta nada e TODOS os
 * casos reprovam de uma vez, com cara de sonda quebrada.
 *
 * A ordem importa: vira script classico, e `const` de modulo nao e icado.
 */
const PARTES = [
  "lib/recurrence.js",
  "lib/dinheiro.js",
  "lib/moeda.js",
  "lib/periodo-do-painel.js",
  "lib/saldo-da-conversa.js",
  "lib/conversa-do-papel.js",
  "components/ui/button.js",
  "components/ui/card.js",
  "components/papel-de-pao/ConversaDePapel.js",
];

for (const parte of PARTES) {
  if (!existsSync(join(SAIDA, parte))) {
    abortar(`${SAIDA}/${parte} nao existe depois da compilacao.`);
  }
}

const producao = PARTES.map((parte) => {
  const fonte = paraScriptClassico(readFileSync(join(SAIDA, parte), "utf8"));

  const sobra = fonte.match(/^\s*(import|export)\s.*$/m);
  if (sobra) {
    abortar(
      `sobrou fiacao de modulo em ${parte}: ${sobra[0].trim()}\n` +
        "ajuste paraScriptClassico()"
    );
  }
  try {
    new Function(fonte);
  } catch (e) {
    abortar(`${parte} nao parseia depois do strip: ${e.message}`);
  }
  return fonte;
}).join("\n");

// A terceira peneira: cada parte parseia sozinha e o CONCATENADO ainda pode ser
// invalido (duas delas declarando o mesmo `const` de topo). O sintoma disso e
// "a pagina nao reportou nada", que nao se le como o que e.
try {
  new Function(producao);
} catch (e) {
  abortar(
    `as partes juntas nao parseiam: ${e.message}\n` +
      "provavelmente duas delas declaram o mesmo nome no topo"
  );
}

/** O React UMD, inline: `<script src>` entre arquivos file:// e outra briga. */
const umd = (pacote, arquivo) =>
  readFileSync(join("node_modules", pacote, "umd", arquivo), "utf8");

// A pagina e montada com template literal, e NUNCA com `String.replace`: o
// bundle do React tem `$$typeof` dentro, e numa string de substituicao `$$`
// vira `$` -- o bundle chega corrompido e o erro e "React is not defined".
const PAGINA = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head><body style="margin:0">
<div id="raiz"></div>
<div id="resultado">a pagina nao rodou</div>
<script>${umd("react", "react.development.js")}</script>
<script>${umd("react-dom", "react-dom.development.js")}</script>
<script>
try {

const { useCallback, useEffect, useRef, useState } = React;

// --- os esbocos de CLASSE (ver o cabecalho do .mjs) --------------------------

/** clsx + tailwind-merge: junta o que nao e falso. Calculo de string. */
const cn = (...partes) => partes.filter(Boolean).join(" ");
/** class-variance-authority: devolve a classe base. Nenhuma assercao le classe. */
const cva = (base) => () => base;
/** Nao usado: a conversa nao passa \`asChild\`. Existe para o import sumir. */
const Slot = "span";

// --- o codigo de producao ----------------------------------------------------
${producao}

// --- o SERVIDOR esbocado (ver a secao do banco de mentira no .mjs) -----------

const NOME_COMPLETO = ${JSON.stringify(NOME_COMPLETO)};
const ROTA_DA_CONVERSA = "/api/papel-de-pao/conversa";

// \`today()\` de producao, uma vez: a linha gravada e a janela somada tem de
// nascer do MESMO relogio, que e o que a rota faz.
const HOJE = today();

/** As linhas que o "banco" guardou, na forma que \`financial_transactions\` tem. */
const LINHAS = [];

/**
 * A ROTA PASSA A RECUSAR quando isto vira verdade -- o caso K.
 *
 * A frase e a de verdade: e o 409 que \`app/api/papel-de-pao/conversa/route.ts\`
 * devolve quando nao ha conta elegivel para lancar. Sem um caminho de recusa
 * nesta sonda, um esboco que SEMPRE responde 201 nao distingue a tela que
 * espera a rota da tela que pinta "Anotado." na hora -- medido: o mutante que
 * move o \`setConversa(proxima)\` para ANTES do \`fetch\` sobrevivia aos casos
 * A..J inteiros.
 */
let RECUSAR = false;
const FRASE_DA_RECUSA = ${JSON.stringify(FRASE_DA_RECUSA)};
/** Tudo o que a tela pediu pela rede, para a sonda conferir o contrato. */
const PEDIDOS = [];

const responder = (status, corpo) =>
  Promise.resolve({
    ok: status < 400,
    status: status,
    json: () => Promise.resolve(corpo),
  });

window.fetch = (url, opcoes) => {
  const metodo = (opcoes && opcoes.method) || "GET";
  const corpo = opcoes && opcoes.body ? JSON.parse(opcoes.body) : null;
  PEDIDOS.push({ url: String(url), metodo: metodo, corpo: corpo });

  if (String(url) === "/api/profile") {
    return responder(200, { full_name: NOME_COMPLETO });
  }

  if (String(url) === ROTA_DA_CONVERSA) {
    // A JANELA, pela funcao de producao -- nao por um recorte escrito aqui.
    const mes = mesCorrenteDaConversa(HOJE);

    if (metodo === "POST") {
      // A RECUSA acontece ANTES de qualquer escrita, como na rota de verdade.
      if (RECUSAR) return responder(409, { error: FRASE_DA_RECUSA });

      const valor = Number(corpo.valor);
      // A UNICA linha da rota repetida aqui: o SINAL. \`CONFERE_A_ROTA\` no
      // .mjs exige que ela continue existindo la.
      LINHAS.push({
        transaction_type: corpo.direcao === "gastei" ? "expense" : "income",
        amount: corpo.direcao === "gastei" ? -valor : valor,
        transaction_date: HOJE,
      });
      return responder(201, {
        lancamento: { id: "linha-" + LINHAS.length },
        mes: mes,
        // AS SOMAS SAO AS DE PRODUCAO.
        numeros: tresNumerosDaConversa(LINHAS, mes),
      });
    }

    return responder(200, {
      mes: mes,
      numeros: tresNumerosDaConversa(LINHAS, mes),
      linhas: linhasDaConversa(LINHAS, mes),
    });
  }

  return responder(404, { error: "rota nao esbocada: " + String(url) });
};

// --- a montagem e os gestos --------------------------------------------------

const caixa = document.getElementById("raiz");

/**
 * Drena microtasks E camadas de efeito, intercalados.
 *
 * Os handlers desta tela sao \`async\` e esperam o \`fetch\`: so \`flushSync\`
 * (que e sincrono) fotografaria sempre o estado ANTERIOR a resposta. So
 * microtask, nunca \`setTimeout\`: a fila drena no fim da tarefa atual, muito
 * antes de o --dump-dom fotografar.
 */
const assentar = async () => {
  for (let volta = 0; volta < 48; volta++) {
    await Promise.resolve();
    ReactDOM.flushSync(() => {});
  }
};

const achar = (seletor) => caixa.querySelector(seletor);
const texto = (seletor) => {
  const e = achar(seletor);
  return e ? e.textContent : null;
};

/**
 * Clica, e DEVOLVE se achou -- nao lanca.
 *
 * Um \`throw\` aqui sobe para a IIFE e derruba TODOS os casos de uma vez, com o
 * relato virando "ERRO NA PAGINA"; a assercao que importa ficaria enterrada.
 * Quem decide se nao ter achado e defeito e a assercao, no node.
 */
const tocar = async (seletor) => {
  const alvo = achar(seletor);
  if (!alvo) return false;
  alvo.click();
  await assentar();
  return true;
};

/** Os tres numeros, como MAPA de rotulo -> valor, lidos do DOM. */
const tresNumeros = () => {
  const lista = achar("#conversa-tres-numeros");
  if (!lista) return null;
  const mapa = {};
  const itens = lista.querySelectorAll("li[data-saldo]");
  for (const li of itens) {
    const spans = li.querySelectorAll("span");
    mapa[li.getAttribute("data-saldo")] =
      spans.length === 2 ? spans[1].textContent : li.textContent;
  }
  // A ORDEM tambem, separada: um mapa perde "os tres juntos, nesta ordem".
  return { mapa: mapa, ordem: Array.from(itens).map((li) => li.getAttribute("data-saldo")) };
};

/** O documento anda para o lado nesta viewport? */
const recorte = () => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
});

/** Digita um valor tecla a tecla, pelos \`data-tecla\` que a tela pintou. */
const digitar = async (digitos) => {
  for (const d of digitos.split("")) {
    const achou = await tocar("[data-tecla='" + d + "']");
    if (!achou) return false;
  }
  return true;
};

const out = {};

(async () => {
try {

ReactDOM.render(React.createElement(ConversaDePapel), caixa);
await assentar();

// --- A: a saudacao, com o nome do perfil -------------------------------------
out.a = {
  pergunta: texto("#conversa-pergunta"),
  botoes: Array.from(caixa.querySelectorAll("[data-gesto]")).map((b) => ({
    gesto: b.getAttribute("data-gesto"),
    rotulo: b.textContent,
  })),
  temTeclado: !!achar("[data-teclado]"),
  temTresNumeros: !!achar("#conversa-tres-numeros"),
  recorte: recorte(),
};

// --- B: Gastei -> o teclado, na ordem do motor -------------------------------
out.b = { clicou: await tocar("#conversa-gastei") };
out.b.pergunta = texto("#conversa-pergunta");
out.b.teclas = Array.from(caixa.querySelectorAll("[data-tecla]")).map((t) =>
  t.getAttribute("data-tecla")
);
out.b.valorInicial = texto("#conversa-valor");
out.b.recorte = recorte();

// --- C: mil reais sao SEIS teclas --------------------------------------------
out.c = { digitou: await digitar("100000") };
out.c.valor = texto("#conversa-valor");

// o apagar e o limpar existem e sao gestos do motor
out.c.temApagar = !!achar("#conversa-apagar");
out.c.temLimpar = !!achar("#conversa-limpar");

// --- D: a confirmacao em uma frase -------------------------------------------
out.d = { clicou: await tocar("#conversa-confirmar") };
out.d.pergunta = texto("#conversa-pergunta");
out.d.botoes = Array.from(caixa.querySelectorAll("[data-gesto]")).map((b) => ({
  gesto: b.getAttribute("data-gesto"),
  rotulo: b.textContent,
}));

// --- E: anotar -> o resultado em uma frase, e os tres numeros ----------------
out.e = { clicou: await tocar("#conversa-confirmar") };
out.e.pergunta = texto("#conversa-pergunta");
out.e.resultado = texto("#conversa-resultado");
out.e.tres = tresNumeros();
out.e.erro = texto("#conversa-erro");

// --- F: Ganhei 2000, pelo mesmo caminho --------------------------------------
out.f = { clicouGanhei: await tocar("#conversa-ganhei") };
out.f.pergunta = texto("#conversa-pergunta");
out.f.digitou = await digitar("200000");
out.f.valor = texto("#conversa-valor");
out.f.clicouPronto = await tocar("#conversa-confirmar");
out.f.confirmacao = texto("#conversa-pergunta");
out.f.clicouAnotar = await tocar("#conversa-confirmar");
out.f.resultado = texto("#conversa-resultado");

// --- G: O TESTE DE ACEITACAO -- os tres juntos, fechando ---------------------
out.g = {
  tres: tresNumeros(),
  erro: texto("#conversa-erro"),
  recorte: recorte(),
  // O texto da tela inteira, para o controle negativo do node.
  tudo: caixa.textContent,
};

// --- H: o botao Saldo -> os tres de novo, e o MES dito na tela ---------------
out.h = { clicou: await tocar("#conversa-saldo") };
out.h.pergunta = texto("#conversa-pergunta");
out.h.tres = tresNumeros();
out.h.temTeclado = !!achar("[data-teclado]");
out.h.recorte = recorte();
out.h.botoes = Array.from(caixa.querySelectorAll("[data-gesto]")).map((b) => ({
  gesto: b.getAttribute("data-gesto"),
  rotulo: b.textContent,
}));

// --- K: a rota RECUSA -- a tela nao pode dizer que anotou --------------------
// Este caso tem de vir depois de H, porque ele suja o estado da rota.
RECUSAR = true;
out.k = { clicouGastei: await tocar("#conversa-gastei") };
out.k.digitou = await digitar("500");
out.k.valor = texto("#conversa-valor");
out.k.clicouPronto = await tocar("#conversa-confirmar");
out.k.clicouAnotar = await tocar("#conversa-confirmar");
// O QUE IMPORTA: a pergunta continua sendo a da confirmacao, nao ha frase de
// "Anotado.", o erro da rota esta na tela e o banco nao ganhou linha nenhuma.
out.k.pergunta = texto("#conversa-pergunta");
out.k.resultado = texto("#conversa-resultado");
out.k.erro = texto("#conversa-erro");
out.k.linhasDepois = LINHAS.length;
out.k.botoes = Array.from(caixa.querySelectorAll("[data-gesto]")).map((b) => ({
  gesto: b.getAttribute("data-gesto"),
  rotulo: b.textContent,
}));

// --- I: o contrato de rede ---------------------------------------------------
out.i = { pedidos: PEDIDOS, linhas: LINHAS };

document.getElementById("resultado").textContent =
  "RESULTADO" + JSON.stringify(out) + "FIM";
} catch (e) {
  document.getElementById("resultado").textContent =
    "ERRO NA PAGINA: " + (e && e.stack ? e.stack : e);
}
})();

} catch (e) {
  document.getElementById("resultado").textContent =
    "ERRO NA PAGINA (nivel de modulo): " + (e && e.stack ? e.stack : e);
}
</script>
</body></html>`;

// -----------------------------------------------------------------------------
// 3. RODAR
// -----------------------------------------------------------------------------

const chromium = acharChromium();
if (!chromium) {
  abortar(
    "Nenhum Chromium encontrado. Instale com `npx playwright install chromium`.\n" +
      "NAO exporte CHROMIUM_BIN: a busca lista a pasta do Playwright sozinha."
  );
}
console.log(`chromium: ${chromium}`);

const dir = mkdtempSync(join(tmpdir(), "conversa-na-tela-"));
const arquivo = join(dir, "conversa.html");
writeFileSync(arquivo, PAGINA);

let dump;
try {
  dump = execFileSync(
    chromium,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      // iPhone 12/13/14: e onde este app e usado, e e o que a issue pede.
      "--window-size=390,844",
      "--virtual-time-budget=10000",
      "--dump-dom",
      `file://${arquivo}`,
    ],
    {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"], // o Chromium enche a stderr de dbus
    }
  );
} catch (erro) {
  abortar(`o Chromium nao rodou: ${erro.message}`);
}

// Ancorado na DIV, e nao no dump solto: o --dump-dom devolve tambem o FONTE do
// script, e procurar o marcador no dump inteiro acha a string literal do
// proprio codigo -- um falso positivo disfarcado de erro de pagina.
const achado = dump.match(/id="resultado">([\s\S]*?)<\/div>/);
if (!achado) abortar(`a pagina nao carregou:\n${dump.slice(0, 2000)}`);

const relato = achado[1];
if (relato.startsWith("ERRO NA PAGINA")) abortar(relato.slice(0, 3000));

const bruto = relato.match(/^RESULTADO([\s\S]*)FIM$/);
if (!bruto) abortar(`a pagina nao reportou resultado, e sim: ${relato.slice(0, 2000)}`);

const r = JSON.parse(bruto[1]);

// -----------------------------------------------------------------------------
// 4. AS ASSERCOES
// -----------------------------------------------------------------------------

const GASTEI = "R$ 1.000,00";
const GANHEI = "R$ 2.000,00";
const SALDO = "R$ 1.000,00";

console.log("\n=== A. a saudacao ===");
ok(
  "a pergunta e a saudacao com o PRIMEIRO nome",
  normalizar(r.a.pergunta) === `Olá ${PRIMEIRO_NOME}, o que deseja?`,
  JSON.stringify(normalizar(r.a.pergunta))
);
ok(
  "o nome completo NAO aparece (primeiroNome recortou)",
  !normalizar(r.a.pergunta).includes("Moraes"),
  "um cadastro falando nao e uma conversa"
);
ok(
  "tres botoes grandes: Gastei, Ganhei, Saldo",
  JSON.stringify(r.a.botoes.map((b) => b.rotulo)) ===
    JSON.stringify(["Gastei", "Ganhei", "Saldo"]),
  JSON.stringify(r.a.botoes.map((b) => b.rotulo))
);
ok("sem teclado na saudacao", r.a.temTeclado === false);
ok("sem os tres numeros na saudacao", r.a.temTresNumeros === false);

console.log("\n=== B. Gastei abre o teclado ===");
ok("clicou em Gastei", r.b.clicou === true);
ok(
  "a pergunta virou a do gasto",
  normalizar(r.b.pergunta) === "Quanto você gastou?",
  JSON.stringify(normalizar(r.b.pergunta))
);
ok(
  "as dez teclas, na ordem do motor (zero DEPOIS do nove)",
  r.b.teclas.join("") === "1234567890",
  r.b.teclas.join("")
);
ok(
  "o campo comeca em zero formatado",
  normalizar(r.b.valorInicial) === "R$ 0,00",
  JSON.stringify(normalizar(r.b.valorInicial))
);

console.log("\n=== C. mil reais, SEIS teclas (convencao de centavos) ===");
ok("digitou as seis teclas", r.c.digitou === true);
ok(
  `1-0-0-0-0-0 mostra ${GASTEI}`,
  normalizar(r.c.valor) === GASTEI,
  JSON.stringify(normalizar(r.c.valor))
);
ok("o teclado tem apagar", r.c.temApagar === true);
ok("o teclado tem limpar", r.c.temLimpar === true);

console.log("\n=== D. a confirmacao em UMA frase ===");
ok("clicou em Pronto", r.d.clicou === true);
ok(
  "a frase nomeia a direcao e o valor",
  normalizar(r.d.pergunta) === `Gastei ${GASTEI}, certo?`,
  JSON.stringify(normalizar(r.d.pergunta))
);
ok(
  "os dois botoes da confirmacao",
  JSON.stringify(r.d.botoes.map((b) => b.rotulo)) ===
    JSON.stringify(["Sim, anotar", "Não, corrigir"]),
  JSON.stringify(r.d.botoes.map((b) => b.rotulo))
);

console.log("\n=== E. anotar: o resultado em UMA frase ===");
ok("clicou em Sim, anotar", r.e.clicou === true);
ok("nenhum erro na tela", r.e.erro === null, String(r.e.erro));
ok(
  "a frase do resultado nomeia a direcao e o valor",
  normalizar(r.e.resultado) === `Gastei ${GASTEI}. Anotado.`,
  JSON.stringify(normalizar(r.e.resultado))
);
ok(
  "a pergunta voltou a ser a saudacao",
  normalizar(r.e.pergunta) === `Olá ${PRIMEIRO_NOME}, o que deseja?`,
  JSON.stringify(normalizar(r.e.pergunta))
);
ok(
  "ja com os tres numeros, e o Saldo e NEGATIVO depois de so um gasto",
  r.e.tres !== null && normalizar(r.e.tres.mapa.Saldo) === "-R$ 1.000,00",
  r.e.tres ? JSON.stringify(normalizar(r.e.tres.mapa.Saldo)) : "sem bloco"
);

console.log("\n=== F. Ganhei 2000 ===");
ok("clicou em Ganhei", r.f.clicouGanhei === true);
ok(
  "a pergunta virou a do ganho",
  normalizar(r.f.pergunta) === "Quanto você ganhou?",
  JSON.stringify(normalizar(r.f.pergunta))
);
ok(
  "o teclado abriu DO ZERO (nao herdou os mil do gasto)",
  normalizar(r.f.valor) === GANHEI,
  JSON.stringify(normalizar(r.f.valor))
);
ok(
  "a confirmacao do ganho",
  normalizar(r.f.confirmacao) === `Ganhei ${GANHEI}, certo?`,
  JSON.stringify(normalizar(r.f.confirmacao))
);
ok(
  "o resultado do ganho",
  normalizar(r.f.resultado) === `Ganhei ${GANHEI}. Anotado.`,
  JSON.stringify(normalizar(r.f.resultado))
);

console.log("\n=== G. O TESTE DE ACEITACAO: os tres juntos, fechando ===");
const g = r.g.tres;
ok("o bloco dos tres numeros existe", g !== null);
if (g) {
  ok(
    "os TRES, nesta ordem",
    JSON.stringify(g.ordem) === JSON.stringify(["Ganhei", "Gastei", "Saldo"]),
    JSON.stringify(g.ordem)
  );
  ok(`Ganhei ${GANHEI}`, normalizar(g.mapa.Ganhei) === GANHEI, JSON.stringify(normalizar(g.mapa.Ganhei)));
  ok(`Gastei ${GASTEI}`, normalizar(g.mapa.Gastei) === GASTEI, JSON.stringify(normalizar(g.mapa.Gastei)));
  ok(`Saldo ${SALDO}`, normalizar(g.mapa.Saldo) === SALDO, JSON.stringify(normalizar(g.mapa.Saldo)));
}
ok("nenhum erro na tela", r.g.erro === null, String(r.g.erro));

// O CONTROLE NEGATIVO: a sonda sabe dizer que NAO esta na tela? Sem isto, um
// seletor errado daria "null !== X" em tudo e o relato pareceria defeito.
ok(
  "controle -: uma palavra que nunca existiu nesta tela NAO aparece",
  !r.g.tudo.includes("Total de contas"),
  "o rotulo do PainelDePapel, que a conversa substituiu"
);
ok(
  "controle +: a sonda LE o texto da tela (acha o rotulo Saldo)",
  r.g.tudo.includes("Saldo"),
  "se este falhar, nenhuma linha acima vale"
);

console.log("\n=== H. o botao Saldo: os tres, e o MES dito ===");
ok("clicou em Saldo", r.h.clicou === true);
ok(
  "a pergunta diz de que periodo e o saldo",
  /^Seu saldo de \S/.test(normalizar(r.h.pergunta)),
  JSON.stringify(normalizar(r.h.pergunta))
);
if (r.h.tres) {
  ok(
    "os mesmos tres numeros depois do GET",
    normalizar(r.h.tres.mapa.Ganhei) === GANHEI &&
      normalizar(r.h.tres.mapa.Gastei) === GASTEI &&
      normalizar(r.h.tres.mapa.Saldo) === SALDO,
    JSON.stringify(r.h.tres.mapa)
  );
} else {
  ok("os mesmos tres numeros depois do GET", false, "sem bloco");
}
ok("sem teclado na tela de saldo", r.h.temTeclado === false);
ok(
  "do saldo da para anotar direto (Gastei, Ganhei, Voltar)",
  JSON.stringify(r.h.botoes.map((b) => b.rotulo)) ===
    JSON.stringify(["Gastei", "Ganhei", "Voltar"]),
  JSON.stringify(r.h.botoes.map((b) => b.rotulo))
);

console.log("\n=== K. a rota RECUSA: a tela NAO pode dizer que anotou ===");
ok("chegou a confirmacao do terceiro gasto", r.k.clicouAnotar === true);
ok(
  "cinco reais no teclado",
  normalizar(r.k.valor) === "R$ 5,00",
  JSON.stringify(normalizar(r.k.valor))
);
ok(
  "a tela ficou NA CONFIRMACAO (nao foi para o `pronto`)",
  normalizar(r.k.pergunta) === "Gastei R$ 5,00, certo?",
  JSON.stringify(normalizar(r.k.pergunta))
);
ok(
  'nenhuma frase de "Anotado." para um lancamento recusado',
  r.k.resultado === null,
  String(r.k.resultado)
);
ok(
  "a frase do 409 da rota esta na tela",
  normalizar(r.k.erro) === normalizar(FRASE_DA_RECUSA),
  JSON.stringify(normalizar(r.k.erro))
);
ok(
  "o botao de tentar de novo continua la, sem redigitar",
  JSON.stringify(r.k.botoes.map((b) => b.rotulo)) ===
    JSON.stringify(["Sim, anotar", "Não, corrigir"]),
  JSON.stringify(r.k.botoes.map((b) => b.rotulo))
);
ok(
  "o banco continua com DUAS linhas -- a recusada nao entrou",
  r.k.linhasDepois === 2,
  String(r.k.linhasDepois)
);

console.log("\n=== I. nenhum seletor foi parar no fio ===");
const posts = r.i.pedidos.filter((p) => p.metodo === "POST");
ok(
  "tres POST: os dois lancamentos e a tentativa recusada do caso K",
  posts.length === 3,
  String(posts.length)
);
for (const p of posts) {
  const chaves = Object.keys(p.corpo ?? {}).sort();
  ok(
    `o corpo do POST tem DOIS campos e sao direcao/valor (${p.corpo?.direcao})`,
    JSON.stringify(chaves) === JSON.stringify(["direcao", "valor"]),
    JSON.stringify(chaves)
  );
}
ok(
  "nenhum POST carrega categoria, conta ou data",
  posts.every(
    (p) =>
      !("category_id" in (p.corpo ?? {})) &&
      !("account_id" in (p.corpo ?? {})) &&
      !("data" in (p.corpo ?? {})) &&
      !("transaction_date" in (p.corpo ?? {}))
  )
);
ok(
  "o perfil foi lido UMA vez",
  r.i.pedidos.filter((p) => p.url === "/api/profile").length === 1,
  String(r.i.pedidos.filter((p) => p.url === "/api/profile").length)
);
ok(
  "o GET do saldo aconteceu",
  r.i.pedidos.some(
    (p) => p.metodo === "GET" && p.url === "/api/papel-de-pao/conversa"
  )
);
ok(
  "a despesa foi gravada NEGATIVA e a receita positiva",
  r.i.linhas.length === 2 &&
    r.i.linhas[0].amount === -1000 &&
    r.i.linhas[0].transaction_type === "expense" &&
    r.i.linhas[1].amount === 2000 &&
    r.i.linhas[1].transaction_type === "income",
  JSON.stringify(r.i.linhas)
);

console.log("\n=== J. o celular: a tela nao anda para o lado ===");
for (const [nome, med] of [
  ["saudacao", r.a.recorte],
  ["teclado", r.b.recorte],
  ["os tres numeros", r.g.recorte],
  ["saldo", r.h.recorte],
]) {
  ok(
    `${nome}: scrollWidth <= clientWidth em 390px`,
    med.scrollWidth <= med.clientWidth,
    `${med.scrollWidth} x ${med.clientWidth}`
  );
}

console.log(
  falhou
    ? "\nXX REPROVADO"
    : "\nOK: Gastei 1000, Ganhei 2000, e a tela mostra os tres fechando."
);
process.exit(falhou ? 1 : 0);
