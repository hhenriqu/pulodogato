// A LIGACAO do painel de divisao do grupo, em navegador de verdade -- HMO-271
// (HMO-245, fase 5).
//
// POR QUE ESTE TESTE EXISTE, E O QUE ELE NAO TENTA PROVAR
// -------------------------------------------------------
// A aritmetica da divisao ja tem teste e mutante proprios: `rebalancear` e
// `igualitario` em `npm run test:divisao-configurada`, `ratearPorPeso` em
// `npm run test:fechamento-do-grupo`. Repetir aqui "70 e 30 somam 100" nao
// provaria nada que ja nao esteja provado.
//
// O que NAO estava coberto e so o navegador responde: a FIACAO. Mexer no numero
// de um membro faz o do outro mudar na tela? O R$ ao lado acompanha? O botao de
// modo reescreve os percentuais?
//
// E ela nao da para provar com `react-dom/server`, que e como as outras suites
// de componente deste repo rodam: `onChange` nao sai no HTML e nunca e chamado
// pelo render. Uma assercao de markup sobre esta tela seria cega exatamente para
// o codigo que esta issue escreveu -- o estado exibido seria escolhido pelo
// teste, nao produzido pelo handler.
//
// A MEDIDA E O VALOR, ANTES -> DEPOIS
// -----------------------------------
// Toda assercao daqui compara o CONTEUDO do elemento do numero antes e depois do
// gesto. Afirmar que a palavra "Proporcional" aparece, ou que existe um
// `<input type=range>`, passaria verde com o `onChange` vazio.
//
// Por isso o % e o R$ de cada membro saem em SPAN com id, e nao no `value` do
// campo: o React escreve `value` como PROPRIEDADE, e o atributo que aparece num
// dump de DOM e o inicial. Uma sonda que medisse o atributo nunca veria a
// mudanca que ela foi escrita para provar.
//
// E a sonda dirige o CAMPO NUMERICO, nao o `range`. O `range` tem o mesmo
// `onChange`, e o caso F abaixo prova isso -- mas acertar "exatamente 70" nele
// depende de aritmetica de pixel do navegador, que e uma premissa frageil para
// um numero que decide dinheiro.
//
// COMO O COMPONENTE DE PRODUCAO CHEGA NA PAGINA
// ---------------------------------------------
// Num `<script>` CLASSICO, com o React UMD antes dele. Os caminhos mais limpos
// nao funcionam neste ambiente (medido na HMO-206, e revalidado aqui):
//
//   - servidor HTTP local: o Chromium daqui nao alcanca 127.0.0.1;
//   - `import` entre arquivos `file://`: barrado pelo CORS;
//   - `<script type="module">`: modulo e DEFERIDO, e o `--dump-dom` fotografa o
//     DOM ANTES de ele rodar -- a pagina sai sem resposta nenhuma, igualzinho a
//     codigo quebrado.
//
// O script classico exige duas cirurgias de texto nos `.js` compilados: tirar a
// LINHA de `import` e o prefixo `export ` das declaracoes, as duas ilegais fora
// de modulo. As duas mexem so na fiacao -- o corpo vai intacto, que e o que
// mantem este teste falando do codigo de producao. Se alguma deixar sobra, o
// teste estoura aqui em vez de seguir com codigo pela metade.
//
// E por isso o tsconfig desta suite usa `jsx: "react"` e nao `jsx: "react-jsx"`:
// `react-jsx` emite `import ... from "react/jsx-runtime"`, uma dependencia de
// modulo a mais para costurar; `react` emite `React.createElement`, que acha o
// UMD no global.
//
// `ReactDOM.render` (legado) e nao `createRoot`, de proposito: o legado renderiza
// SINCRONO e descarrega a atualizacao no fim do evento, entao a leitura logo
// depois do `dispatchEvent` ja ve o DOM novo. Com `createRoot` a renderizacao e
// agendada, e a sonda leria o estado anterior -- um falso negativo que se
// disfarca de handler quebrado.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SAIDA = ".tmp-divisao-ui";

/**
 * Acha um Chromium: o do `CHROMIUM_BIN`, o que o Playwright baixou, ou o Chrome
 * do sistema (o runner do Actions ja vem com um).
 *
 * Sem navegador este teste FALHA -- de proposito, e nao com `skip`. Uma suite
 * que se desliga sozinha quando falta o binario e indistinguivel de uma suite
 * que passou, e a unica prova de fiacao desta tela sumiria sem ninguem notar.
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

// --- o componente e as bibliotecas dele, ja compilados -----------------------
//
// Quem compila e o script `test:divisao-ui-dom` do package.json, como nas outras
// suites. Isso tambem e o que faz a segunda peneira do check-tests-in-ci.mjs
// enxergar os arquivos desta suite -- ela le os caminhos citados NO COMANDO.

if (!existsSync(join(SAIDA, "components/grupos/DivisaoDoGrupo.js"))) {
  throw new Error(
    `${SAIDA}/ nao existe. Rode por \`npm run test:divisao-ui-dom\`, ` +
      "que e quem compila o componente antes do teste."
  );
}

/** Tira so a fiacao de modulo, deixando o corpo das funcoes intacto. */
const paraScriptClassico = (fonte) =>
  fonte
    // O `import` emitido pelo tsc pode ocupar mais de uma linha quando a lista
    // de nomes e longa (foi o caso de `divisao-configurada`), entao o recorte e
    // do `import` ate o `;` -- e nao de uma linha so, que deixaria metade da
    // lista de nomes solta no meio do script.
    .replace(/^import\s[\s\S]*?;$/gm, "")
    .replace(/^export /gm, "");

const PARTES = [
  // Ordem de dependencia. Nao e exigencia do JavaScript para funcao declarada
  // (ela e iceada), mas e para `const` de modulo -- e `dinheiro.js` tem varios.
  "lib/dinheiro.js",
  "lib/settlement.js",
  "lib/divisao-configurada.js",
  "lib/fechamento-do-grupo.js",
  "components/grupos/DivisaoDoGrupo.js",
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

  return fonte;
}).join("\n");

/** O React UMD, inline: `<script src>` entre arquivos file:// e outra briga. */
const umd = (pacote, arquivo) =>
  readFileSync(join("node_modules", pacote, "umd", arquivo), "utf8");

// --- os casos ----------------------------------------------------------------
//
// Cada caso tem os proprios `member_id` para os ids do DOM nao colidirem entre
// as arvores montadas na mesma pagina (`getElementById` devolveria a primeira, e
// a sonda mediria o caso errado reportando o nome do certo).

const ID = (caso, n) =>
  `${caso}${caso}${caso}${caso}${caso}${caso}${caso}${caso}-${caso}${caso}${caso}${caso}-4${caso}${caso}${caso}-8${caso}${caso}${caso}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;

const PAGINA = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<div id="raiz-a"></div><div id="raiz-b"></div><div id="raiz-c"></div>
<div id="raiz-d"></div><div id="raiz-e"></div>
<div id="resultado">a pagina nao rodou</div>
<script>${umd("react", "react.development.js")}</script>
<script>${umd("react-dom", "react-dom.development.js")}</script>
<script>
try {
// Os hooks que o componente usa por nome, do React global -- o \`import\` deles
// foi removido junto com o resto da fiacao de modulo.
const { useCallback, useEffect, useMemo, useState } = React;

${producao}

// --- utilitarios da sonda ---------------------------------------------------

const alvo = (id) => document.getElementById(id);

/**
 * Monta um painel e devolve acessos ESCOPADOS nele.
 *
 * O escopo e o detalhe que custou um susto: os ids de painel
 * (\`divisao-modo-equal\`, \`divisao-gravar\`, \`divisao-aviso-retroativo\`) sao os
 * MESMOS nos cinco paineis desta pagina, e \`getElementById\` devolve o primeiro
 * do documento -- o do caso A. Com ele, "o botao Igual do caso C" lia o botao do
 * caso A, e tres assercoes falavam de uma arvore que nao era a medida.
 *
 * Isso nao e defeito do componente: num app, um painel por tela. Quem tem de se
 * ajustar e a sonda, por \`container.querySelector\`, que respeita a subarvore.
 */
const painel = (raiz, props) => {
  const caixa = alvo(raiz);
  ReactDOM.render(React.createElement(DivisaoDoGrupo, props), caixa);

  const achar = (id) => caixa.querySelector("[id='" + id + "']");

  return {
    caixa,
    achar,
    /** O texto de um elemento, ou null quando ele nao existe (nao ""). */
    texto: (id) => {
      const el = achar(id);
      return el ? el.textContent : null;
    },
    /**
     * Digita num campo, como um dedo digitaria.
     *
     * O setter nativo e obrigatorio: o React guarda o ultimo valor que ELE
     * escreveu e compara com o atual para decidir se houve mudanca. Atribuir
     * \`el.value\` direto atualiza o cache do React tambem, e o \`onChange\` NAO
     * dispara -- a sonda passaria verde sem nunca ter chamado o handler.
     */
    digitar: (id, valor) => {
      const el = achar(id);
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(el, String(valor));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
  };
};

const r = {};

// =============================================================================
// CASO A -- DOIS MEMBROS: mexer em um muda o outro, e o R$ acompanha
// =============================================================================
// O pedido do Helio, literal: "se eu mexer em um, automaticamente o outro se
// ajustar".

const A1 = "${ID("a", 1)}";
const A2 = "${ID("a", 2)}";

const a = painel("raiz-a", {
  groupId: "grupo-a",
  mes: "2026-10",
  ehAdmin: true,
  modoGravado: "percentage",
  totalDoMes: 2000,
  membros: [
    { member_id: A1, nome: "Hélio", percentage: 50 },
    { member_id: A2, nome: "Ana", percentage: 50 },
  ],
});

const leA = () => ({
  pct1: a.texto("divisao-pct-" + A1),
  pct2: a.texto("divisao-pct-" + A2),
  valor1: a.texto("divisao-valor-" + A1),
  valor2: a.texto("divisao-valor-" + A2),
});

r.a_antes = leA();

// "7000" e "exatamente 70", porque a unidade do campo e o CENTESIMO de ponto --
// as duas ultimas casas sao a fracao, como em todo campo numerico deste app
// (\`aoDigitarValor\`). Um handler que lesse o texto como PONTO percentual poria
// este membro em 100% (o teto) e o outro em zero.
a.digitar("divisao-campo-" + A1, "7000");
r.a_depois = leA();

// Um segundo gesto, para a tela nao estar apenas ecoando o primeiro: 70 -> 25
// tem de levar o outro de 30 para 75, e nao "de volta ao que era".
a.digitar("divisao-campo-" + A1, "2500");
r.a_terceiro = leA();

// VIRGULA, e e o caso que mais custou: o campo EXIBE "25,00", entao todo texto
// que sai dele daqui para frente tem virgula dentro. O teclado numerico do
// telefone em pt-BR tambem entrega virgula.
//
// Era um \`input type="number"\`, e nele isto nao funciona: texto com virgula e um
// campo INVALIDO, e o navegador devolve \`value === ""\` em vez do que foi
// digitado. O membro caia para 0,00% e o OUTRO saltava para 100% -- a conta da
// casa inteira no nome de uma pessoa, por causa de uma tecla. A sonda pegou isso
// no codigo intacto, nao num mutante.
a.digitar("divisao-campo-" + A1, "70,50");
r.a_virgula = leA();

// E a volta: apagar um digito anda a virgula uma casa, em vez de travar. Sem a
// poda de zero a esquerda o campo teria um ponto fixo e nao daria para limpar.
a.digitar("divisao-campo-" + A1, "70,5");
r.a_backspace = leA();

// =============================================================================
// CASO B -- O \`range\` chama o MESMO handler do campo
// =============================================================================
// Os dois existem porque o \`range\` nao acerta "exatamente 70" no telefone. Se
// so o campo rebalanceasse, arrastar o slider mostraria um numero que a tela
// nao grava -- e o caso A continuaria verde.

const B1 = "${ID("b", 1)}";
const B2 = "${ID("b", 2)}";

const b = painel("raiz-b", {
  groupId: "grupo-b",
  mes: "2026-10",
  ehAdmin: true,
  modoGravado: "percentage",
  totalDoMes: 2000,
  membros: [
    { member_id: B1, nome: "Hélio", percentage: 50 },
    { member_id: B2, nome: "Ana", percentage: 50 },
  ],
});

const leB = () => ({
  pct1: b.texto("divisao-pct-" + B1),
  pct2: b.texto("divisao-pct-" + B2),
});

r.b_antes = leB();
b.digitar("divisao-slider-" + B1, "80");
r.b_depois = leB();

// =============================================================================
// CASO C -- TRES MEMBROS EM "IGUAL": o R$ e o do fechamento, nao o do percentual
// =============================================================================
// A divisao igual de tres nao cabe em numeric(5,2). A coluna fica com 33,34 /
// 33,33 / 33,33 (somando 100% cravado), mas o fechamento em modo \`equal\` usa
// peso 1 e produz 666,67 / 666,67 / 666,66. Ratear a previa pelos PERCENTUAIS
// daria 666,80 / 666,60 / 666,60 -- treze centavos de distancia entre esta tela
// e o extrato, todo mes.

const C1 = "${ID("c", 1)}";
const C2 = "${ID("c", 2)}";
const C3 = "${ID("c", 3)}";

const c = painel("raiz-c", {
  groupId: "grupo-c",
  mes: "2026-10",
  ehAdmin: true,
  modoGravado: "equal",
  totalDoMes: 2000,
  membros: [
    { member_id: C1, nome: "Hélio", percentage: 0 },
    { member_id: C2, nome: "Ana", percentage: 0 },
    { member_id: C3, nome: null, percentage: 0 },
  ],
});

const leC = () => ({
  pct: [C1, C2, C3].map((id) => c.texto("divisao-pct-" + id)),
  valor: [C1, C2, C3].map((id) => c.texto("divisao-valor-" + id)),
});

r.c = Object.assign(leC(), {
  // Em "Igual" nao ha o que arrastar: o numero de cada um e consequencia de
  // quantos sao.
  sliderTravado: c.achar("divisao-slider-" + C1).disabled,
  campoTravado: c.achar("divisao-campo-" + C1).disabled,
  modoIgualMarcado: c.achar("divisao-modo-equal").getAttribute("aria-pressed"),
  // Nome ausente e caminho normal (nenhuma policy de \`profiles\` olha
  // \`group_members\`), e sem rotulo a linha ficaria com um slider sem dono.
  semNome: c.texto("divisao-nome-" + C3),
});

// Trocar para "Proporcional" tem de LIBERAR, e voltar para "Igual" tem de
// reescrever os percentuais -- senao "Igual" ficaria marcado sobre 80/10/10.
c.achar("divisao-modo-percentage").click();
r.c_proporcional = {
  sliderTravado: c.achar("divisao-slider-" + C1).disabled,
  modoMarcado: c.achar("divisao-modo-percentage").getAttribute("aria-pressed"),
};

c.digitar("divisao-campo-" + C1, "8000");
r.c_apos_arrastar = leC();

c.achar("divisao-modo-equal").click();
r.c_de_volta = leC();

// =============================================================================
// CASO D -- CONFIG GRAVADA QUE NAO FECHA 100% ABRE EM "IGUAL"
// =============================================================================
// Todo grupo que existe hoje tem os quatro zeros do DEFAULT 0.00 na coluna. Um
// grupo gravado como \`percentage\` nesse estado tem o fechamento rateando IGUAL
// (\`divisaoDoPeriodo\`). Se esta tela abrisse em "Proporcional" mostrando 0%
// para todos, ela estaria descrevendo um mes que nao existe.

const D1 = "${ID("d", 1)}";
const D2 = "${ID("d", 2)}";

const d = painel("raiz-d", {
  groupId: "grupo-d",
  mes: "2026-10",
  ehAdmin: true,
  modoGravado: "percentage",
  totalDoMes: 1000,
  membros: [
    { member_id: D1, nome: "Hélio", percentage: 0 },
    { member_id: D2, nome: "Ana", percentage: 0 },
  ],
});

r.d = {
  modoIgual: d.achar("divisao-modo-equal").getAttribute("aria-pressed"),
  modoProporcional: d
    .achar("divisao-modo-percentage")
    .getAttribute("aria-pressed"),
  pct: [D1, D2].map((id) => d.texto("divisao-pct-" + id)),
  valor: [D1, D2].map((id) => d.texto("divisao-valor-" + id)),
};

// =============================================================================
// CASO E -- QUEM NAO E ADMIN VE, MAS NAO MEXE
// =============================================================================
// O PUT da fase 3 responde 403 para membro comum. A tela abre em leitura, e nao
// escondida: com que divisao o mes fecha e informacao de quem paga a conta.

const E1 = "${ID("e", 1)}";
const E2 = "${ID("e", 2)}";

const e = painel("raiz-e", {
  groupId: "grupo-e",
  mes: "2026-10",
  ehAdmin: false,
  modoGravado: "percentage",
  totalDoMes: 2000,
  membros: [
    { member_id: E1, nome: "Hélio", percentage: 70 },
    { member_id: E2, nome: "Ana", percentage: 30 },
  ],
});

r.e = {
  pct: [E1, E2].map((id) => e.texto("divisao-pct-" + id)),
  valor: [E1, E2].map((id) => e.texto("divisao-valor-" + id)),
  campoTravado: e.achar("divisao-campo-" + E1).disabled,
  sliderTravado: e.achar("divisao-slider-" + E1).disabled,
  modoTravado: e.achar("divisao-modo-equal").disabled,
  temBotaoGravar: e.achar("divisao-gravar") !== null,
};

// Admin TEM o botao. Sem este par, "membro comum nao tem botao" passaria verde
// num painel que nunca tem botao nenhum.
r.adminTemBotaoGravar = a.achar("divisao-gravar") !== null;

// A linha da 025, uma vez por painel.
r.avisoRetroativo = a.caixa.querySelectorAll(
  "[id='divisao-aviso-retroativo']"
).length;
r.textoDoAviso = a.texto("divisao-aviso-retroativo");

alvo("resultado").textContent = "RESULTADO" + JSON.stringify(r) + "FIM";
} catch (e) {
  // Sem isto, um erro aqui dentro vira "a pagina nao reportou nada" e o motivo
  // real fica dentro do navegador, invisivel.
  document.getElementById("resultado").textContent =
    "ERRO NA PAGINA: " + (e && (e.stack || e.message));
}
</script></body></html>`;

// --- roda o navegador --------------------------------------------------------

const chromium = acharChromium();
let resultado = null;
let erroDeExecucao = null;

try {
  if (!chromium) throw new Error(SEM_NAVEGADOR);

  const dir = mkdtempSync(join(tmpdir(), "divisao-ui-"));
  const pagina = join(dir, "divisao.html");
  writeFileSync(pagina, PAGINA);

  const dump = execFileSync(
    chromium,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--window-size=390,844", // iPhone: e onde esta tela e usada
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
    throw new Error(`a pagina nao carregou:\n${dump.slice(0, 1500)}`);
  }

  const relato = achado[1];
  if (relato.startsWith("ERRO NA PAGINA")) throw new Error(relato);

  const bruto = relato.match(/^RESULTADO(\{[\s\S]*\})FIM$/);
  if (!bruto) {
    throw new Error(`a pagina nao reportou resultado, e sim: ${relato}`);
  }
  resultado = JSON.parse(bruto[1]);
} catch (e) {
  erroDeExecucao = e;
}

// -----------------------------------------------------------------------------

test("o navegador rodou e reportou", () => {
  if (erroDeExecucao) throw erroDeExecucao;
  assert.ok(resultado, "sem resultado do navegador");
});

test("A: mexer no numero de um membro muda o do OUTRO", () => {
  // O caso da issue. A medida e o valor ANTES -> DEPOIS no elemento do numero:
  // o segundo membro saiu de 50 sem ninguem toca-lo.
  assert.equal(resultado.a_antes.pct1, "50,00%");
  assert.equal(resultado.a_antes.pct2, "50,00%");

  assert.equal(resultado.a_depois.pct1, "70,00%");
  assert.equal(
    resultado.a_depois.pct2,
    "30,00%",
    "o outro membro nao se ajustou: o rebalanceamento nao esta ligado na tela"
  );
});

test("A: o R$ de cada um acompanha o percentual", () => {
  // A coluna da direita e a razao de a tela existir -- "cada um vai pagar um x
  // de valor". Um % que muda ao lado de um R$ parado sao duas respostas na
  // mesma linha.
  assert.match(resultado.a_antes.valor1, /1\.000,00/);
  assert.match(resultado.a_antes.valor2, /1\.000,00/);

  assert.match(resultado.a_depois.valor1, /1\.400,00/);
  assert.match(resultado.a_depois.valor2, /600,00/);
});

test("A: o segundo gesto tambem rebalanceia (nao e eco do primeiro)", () => {
  // Sem este, um handler que escrevesse 70/30 fixo passaria nos dois de cima.
  assert.equal(resultado.a_terceiro.pct1, "25,00%");
  assert.equal(resultado.a_terceiro.pct2, "75,00%");
});

test("A: o campo le a virgula que ele mesmo exibe", () => {
  // O defeito real que esta assercao fechou: com `input type="number"`, texto
  // com virgula e campo invalido e o navegador devolve "". O membro ia a 0,00% e
  // o outro a 100%. E o campo EXIBE virgula, entao o caso nao e exotico -- e
  // todo backspace e toda digitacao em telefone pt-BR.
  assert.equal(
    resultado.a_virgula.pct1,
    "70,50%",
    "a virgula do proprio campo esta zerando a parte do membro"
  );
  assert.equal(resultado.a_virgula.pct2, "29,50%");
  assert.match(resultado.a_virgula.valor1, /1\.410,00/);
  assert.match(resultado.a_virgula.valor2, /590,00/);

  // Apagar um digito anda a virgula uma casa: "70,5" -> 705 centesimos -> 7,05%.
  // Sem a poda de zero a esquerda o campo travaria em vez de limpar.
  assert.equal(resultado.a_backspace.pct1, "7,05%");
  assert.equal(resultado.a_backspace.pct2, "92,95%");
});

test("B: arrastar o slider rebalanceia igual ao campo", () => {
  assert.equal(resultado.b_antes.pct1, "50,00%");
  assert.equal(resultado.b_depois.pct1, "80,00%");
  assert.equal(
    resultado.b_depois.pct2,
    "20,00%",
    "o range nao esta ligado no mesmo handler do campo numerico"
  );
});

test("C: em Igual, o R$ e o que o fechamento cobra -- nao o do percentual", () => {
  // O percentual gravado soma 100% cravado...
  assert.deepEqual(resultado.c.pct, ["33,34%", "33,33%", "33,33%"]);

  // ...e o R$ e o do peso 1, que e o que `divisaoDoPeriodo` manda o fechamento
  // usar em `equal`. Ratear pelos percentuais daria 666,80 / 666,60 / 666,60.
  assert.match(resultado.c.valor[0], /666,67/);
  assert.match(resultado.c.valor[1], /666,67/);
  assert.match(resultado.c.valor[2], /666,66/);
});

test("C: em Igual nao ha o que arrastar", () => {
  assert.equal(resultado.c.modoIgualMarcado, "true");
  assert.equal(resultado.c.sliderTravado, true);
  assert.equal(resultado.c.campoTravado, true);
});

test("C: membro sem nome ganha rotulo, nao um slider sem dono", () => {
  assert.equal(resultado.c.semNome, "Membro do grupo");
});

test("C: Proporcional libera, e voltar para Igual reescreve os percentuais", () => {
  assert.equal(resultado.c_proporcional.modoMarcado, "true");
  assert.equal(resultado.c_proporcional.sliderTravado, false);

  // 80 para um, e os outros dois dividem a sobra na proporcao que tinham
  // (iguais) -- 10 e 10.
  assert.deepEqual(resultado.c_apos_arrastar.pct, [
    "80,00%",
    "10,00%",
    "10,00%",
  ]);
  assert.match(resultado.c_apos_arrastar.valor[0], /1\.600,00/);
  assert.match(resultado.c_apos_arrastar.valor[1], /200,00/);

  // E "Igual" tem de desfazer o 80/10/10: deixa-lo na coluna gravaria uma tela
  // que diz "Igual" sobre numeros que nao sao iguais.
  assert.deepEqual(resultado.c_de_volta.pct, ["33,34%", "33,33%", "33,33%"]);
  assert.match(resultado.c_de_volta.valor[0], /666,67/);
});

test("D: config gravada que nao fecha 100% abre em Igual", () => {
  // Os quatro zeros do DEFAULT 0.00, que e o estado de TODO grupo que existe
  // hoje. A tela abre concordando com o fechamento, nao com a coluna.
  assert.equal(resultado.d.modoIgual, "true");
  assert.equal(resultado.d.modoProporcional, "false");
  assert.deepEqual(resultado.d.pct, ["50,00%", "50,00%"]);
  assert.match(resultado.d.valor[0], /500,00/);
  assert.match(resultado.d.valor[1], /500,00/);
});

test("E: quem nao e admin ve os numeros e nao muda nada", () => {
  assert.deepEqual(resultado.e.pct, ["70,00%", "30,00%"]);
  assert.match(resultado.e.valor[0], /1\.400,00/);
  assert.match(resultado.e.valor[1], /600,00/);

  assert.equal(resultado.e.campoTravado, true);
  assert.equal(resultado.e.sliderTravado, true);
  assert.equal(resultado.e.modoTravado, true);
  assert.equal(
    resultado.e.temBotaoGravar,
    false,
    "membro comum nao pode ter um botao que a rota recusa com 403"
  );

  // O controle positivo do par acima: o admin TEM o botao. Sem ele, "membro
  // comum nao tem botao" ficaria verde num painel que nunca tem botao nenhum.
  assert.equal(resultado.adminTemBotaoGravar, true);
});

test("a linha sobre despesa ja lancada esta na tela", () => {
  // A 025 trancou repontamento de divisao. Sem esta frase o primeiro uso real e
  // "mudei para 70/30 e a conta do mes passado nao mudou".
  //
  // Exatamente UMA por painel, e nao "pelo menos uma": duas copias da mesma
  // frase lado a lado e o sintoma de um bloco duplicado num refactor.
  assert.equal(
    resultado.avisoRetroativo,
    1,
    "o painel perdeu (ou duplicou) a linha sobre despesa ja lancada"
  );
  assert.match(resultado.textoDoAviso, /já lançadas/);
});
