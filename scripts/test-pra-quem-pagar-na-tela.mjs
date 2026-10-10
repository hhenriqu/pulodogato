#!/usr/bin/env node
// =====================================================
// PULODOGATO - "pra quem pagar" NA TELA (HMO-365, F2 da HMO-360)
// =====================================================
// A issue pede, para o caso em que a Leticia lancou a conta do grupo:
//
//   > em Despesas exibe o quanto tenho que pagar pra ela referente ao total do
//   > grupo e **pra quem pagar**, com **chevron que expande** e mostra detalhado
//   > qual valor de cada coisa (assim como no dashboard)
//
// E a medicao exigida e de TELA, nao assercao textual sobre o fonte: "assercao
// de rotulo casa com comentario e com o dado rotulado". Entao esta sonda roda o
// componente de PRODUCAO num Chromium e LE O DOM.
//
// AS QUATRO COISAS QUE SO O DOM DENUNCIA
// --------------------------------------
//   1. O ROTULO SEM A PESSOA. Com `full_name` ilegivel, um `{destino.nome}`
//      solto renderiza NADA -- e uma linha de pagamento sem destinatario nao se
//      le como "nao sei o nome": se le como conta minha, e o usuario conclui que
//      a divida e dele. "Nao aparece" e propriedade da marcacao; nenhum teste de
//      funcao pura alcanca.
//   2. O CHEVRON DESLIGADO. `aria-expanded` que nao troca, ou lista que ja esta
//      no DOM escondida com `hidden` -- e `hidden` NAO tira o texto do
//      `textContent`, entao uma sonda ingenua ficaria verde com a seta inerte.
//   3. OS DOIS CHEVRONS ACOPLADOS. Com `aria-controls` repetido entre
//      destinatarios, abrir o da Leticia abre o da Ana: os dois valores certos,
//      nos lugares trocados.
//   4. O TOTAL NO LUGAR ERRADO. A aritmetica tem 24 assercoes em
//      `test:pra-quem-pagar` e TODAS passariam verdes com o JSX imprimindo o
//      total de um destinatario na linha do outro.
//
// O ROTULO E CALCULADO POR PRODUCAO, E ISSO NAO E DETALHE
// ------------------------------------------------------
// `rotuloDoDestino` e extraida do .tmp da suite irma por regex (`funcaoDaLib`,
// o precedente da HMO-311) em vez de o fixture trazer o texto pronto. Se a
// pagina recebesse `rotulo: { texto: "Pagar para outro membro de Casa" }`
// literal, o caso 1 mediria o PROPRIO FIXTURE -- verde com o fallback de
// producao inteiramente quebrado, que e exatamente o caso que a issue manda
// provar.
//
// `formatCurrency` E MARCADOR, DE PROPOSITO: "ESBOCO-VALOR:300" diz QUAL valor
// chegou naquele span, o que torna o item 4 mensuravel sem arrastar
// `lib/utils` (e o `clsx`/`tailwind-merge` atras dele) para um script classico.
// A formatacao em si ja e medida em outras suites.
//
// Sem navegador esta suite FALHA -- de proposito, e nao com `skip`. Uma suite
// que se desliga sozinha quando falta o binario e indistinguivel de uma que
// passou. (Neste ambiente o Chromium do Playwright pode estar numa versao que a
// lista abaixo nao preve: aponte CHROMIUM_BIN.)
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SAIDA = ".tmp-pra-quem-pagar-na-tela";
/** O .tmp da suite de aritmetica -- e so de onde `rotuloDoDestino` sai. */
const SAIDA_DA_LIB = ".tmp-pra-quem-pagar";

/**
 * Acha um Chromium: o do `CHROMIUM_BIN`, o que o Playwright baixou, ou o Chrome
 * do sistema (o runner do Actions ja vem com um).
 *
 * A VERSAO DO PLAYWRIGHT NAO E FIXA AQUI, ao contrario das sondas mais antigas
 * deste repositorio: elas tem "chromium-1243" escrito no fonte, e no dia em que
 * o ambiente subiu para 1248 as quatro ficaram 100% vermelhas numa arvore
 * intocada -- com o sintoma deslocado ("Cannot read properties of null"),
 * porque a mensagem verdadeira aparece uma vez no meio de 47 TypeError. A
 * varredura por prefixo custa um `readdirSync` e nao tem esse modo de falha.
 */
function acharChromium() {
  const candidatos = [process.env.CHROMIUM_BIN];

  for (const base of [
    `${process.env.HOME}/.cache/ms-playwright`,
    "/paperclip/.cache/ms-playwright",
  ]) {
    if (!existsSync(base)) continue;

    let entradas = [];
    try {
      entradas = readdirSync(base);
    } catch {
      continue;
    }

    for (const dir of entradas) {
      if (!/^chromium(_headless_shell)?-/.test(dir)) continue;
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

// --- o componente, ja compilado ---------------------------------------------
//
// Quem compila e o script `test:pra-quem-pagar-na-tela` do package.json. Isso
// tambem e o que faz a segunda peneira do check-tests-in-ci.mjs enxergar os
// arquivos desta suite -- ela le os caminhos citados NO COMANDO.

if (!existsSync(join(SAIDA, "components/movimentacoes/PainelPraQuemPagar.js"))) {
  throw new Error(
    `${SAIDA}/ nao existe. Rode por \`npm run test:pra-quem-pagar-na-tela\`, ` +
      "que e quem compila o componente antes do teste."
  );
}

/** Tira so a fiacao de modulo, deixando o corpo das funcoes intacto. */
const paraScriptClassico = (fonte) =>
  fonte
    // O re-export de barril (`export { A, B, };`) sai INTEIRO e antes da regra
    // da palavra: tirar so a palavra deixaria `{ A, B, };`, cuja virgula final
    // e SyntaxError -- e a peneira de "sobrou export" passaria limpa, porque a
    // palavra sumiu. `[^}]*` nao atravessa chave, entao corpo de funcao fica
    // fora do alcance. Medido na HMO-294 com components/ui/card.tsx.
    .replace(/^export\s*\{[^}]*\}\s*;$/gm, "")
    // O `import` emitido pelo tsc pode ocupar mais de uma linha quando a lista
    // de nomes e longa, entao o recorte e do `import` ate o `;`.
    .replace(/^import\s[\s\S]*?;$/gm, "")
    .replace(/^export /gm, "");

const PARTES = [
  // Ordem de dependencia -- obrigatoria para `const` de modulo.
  "components/ui/button.js",
  "components/ui/card.js",
  // A LINHA DO DETALHE, a MESMA do painel do dashboard (HMO-300, extraida na
  // HMO-365). Esbocar seria medir a propria copia justamente nas assercoes que
  // leem o rotulo de grupo e a data.
  "components/papel-de-pao/LinhaDeDetalhe.js",
  "components/movimentacoes/PainelPraQuemPagar.js",
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

  // Um check de sintaxe POR PARTE, que custa nada e estoura com o NOME do
  // arquivo. Sem ele, dois `const` de mesmo nome em partes diferentes (ou uma
  // virgula solta) viram "a pagina nao reportou nada", vinte linhas depois.
  try {
    new Function(fonte);
  } catch (e) {
    throw new Error(`${parte} nao parseia como script classico: ${e.message}`);
  }

  return fonte;
}).join("\n");

/**
 * Uma funcao AUTO-CONTIDA da lib, extraida do .js compilado por regex.
 *
 * O precedente e o `daLib` da HMO-311, e o motivo e o mesmo: `rotuloDoDestino`
 * nao tem import proprio (so operacoes de string), entao ela cabe num script
 * classico -- enquanto carregar `lib/pra-quem-pagar.js` inteiro arrastaria
 * `telas-de-movimentacao` e meia duzia de modulos atras dele.
 *
 * ESTOURA quando o regex nao casa, com o nome da funcao. Sem isso o nome ficaria
 * `undefined` na pagina e o sintoma voltaria a ser "a sonda nao reportou nada".
 */
const funcaoDaLib = (nome) => {
  const fonte = readFileSync(
    join(SAIDA_DA_LIB, "lib/pra-quem-pagar.js"),
    "utf8"
  );
  const achado = fonte.match(
    new RegExp(`^export function ${nome}\\([\\s\\S]*?^\\}`, "m")
  );
  if (!achado) {
    throw new Error(
      `nao achei ${nome} em ${SAIDA_DA_LIB}/lib/pra-quem-pagar.js -- ` +
        "a funcao foi renomeada, ou deixou de ser declaracao de topo"
    );
  }
  return achado[0].replace(/^export /, "");
};

const FONTE_DO_ROTULO = funcaoDaLib("rotuloDoDestino");

/**
 * Uma constante de TEXTO do componente, lida do .js compilado.
 *
 * As assercoes leem o titulo e a nota, entao eles NAO podem ser copia escrita
 * aqui: uma copia passaria verde depois de alguem trocar o texto em producao.
 */
const constanteDoComponente = (nome) => {
  const fonte = readFileSync(
    join(SAIDA, "components/movimentacoes/PainelPraQuemPagar.js"),
    "utf8"
  );
  const achado = fonte.match(
    new RegExp(`^export const ${nome} =\\s*([\\s\\S]*?);$`, "m")
  );
  if (!achado) throw new Error(`nao achei a constante ${nome} no componente`);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${achado[1]});`)();
};

const TITULO = constanteDoComponente("TITULO_PRA_QUEM_PAGAR");
const NOTA = constanteDoComponente("NOTA_PRA_QUEM_PAGAR");

/** O React UMD, inline: `<script src>` entre arquivos file:// e outra briga. */
const umd = (pacote, arquivo) =>
  readFileSync(join("node_modules", pacote, "umd", arquivo), "utf8");

// --- os fixtures -------------------------------------------------------------

const LETICIA = "22222222-0000-0000-0000-000000000002";
const ANA = "33333333-0000-0000-0000-000000000003";

const PAGINA = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<div id="raiz-a"></div><div id="raiz-b"></div><div id="raiz-c"></div>
<div id="raiz-d"></div>
<div id="resultado">a pagina nao rodou</div>
<script>${umd("react", "react.development.js")}</script>
<script>${umd("react-dom", "react-dom.development.js")}</script>
<script>
// Os hooks por nome, do React global, no TOPO do script -- nunca dentro de uma
// funcao: ali eles virariam locais e nenhuma funcao de producao os alcancaria
// por escopo, com o erro estourando no primeiro render como
// "useState is not defined".
const { useState } = React;

// Os ids dos fixtures, INJETADOS do lado node para os dois lados usarem o MESMO
// literal: eles sao const do .mjs, e la fora a pagina nao os alcanca (foi um
// ReferenceError: LETICIA is not defined na primeira volta). As assercoes do
// lado node montam os ids do DOM com estes mesmos valores, entao uma divergencia
// aqui apareceria como elemento nao encontrado -- nao como id errado.
const LETICIA = ${JSON.stringify(LETICIA)};
const ANA = ${JSON.stringify(ANA)};

// --- os esbocos -------------------------------------------------------------
//
// MARCADORES e nao valores plausiveis: assim um esboco que vaze para dentro de
// uma assercao de texto aparece com o nome dele na mensagem, em vez de medir uma
// mentira parecida com a verdade.

/** cn/cva/Slot: o que button.js e card.js pedem de lib/utils e das libs de classe. */
const cn = (...xs) => xs.filter(Boolean).join(" ");
const cva = () => () => "ESBOCO-CLASSE";
const Slot = "div";

/** O valor MARCADO: ele diz QUAL numero chegou naquele span. */
const formatCurrency = (valor) => "ESBOCO-VALOR:" + valor;

/** Icone: sem esboco, React.createElement(undefined) derruba o render inteiro. */
const ChevronDown = () => React.createElement("span", null, "v");

/** Nunca montados nesta pagina: nenhuma linha daqui tem fatura nem elo. */
const Link = () => React.createElement("span", null, "ESBOCO-LINK");
const EloDaFatura = () => React.createElement("span", null, "ESBOCO-ELO");
const caminhoDoCartaoNoMes = (c, m) => "ESBOCO-CAMINHO:" + c + ":" + m;

// --- o rotulo, CALCULADO POR PRODUCAO ---------------------------------------
${FONTE_DO_ROTULO}

${producao}

// --- utilitarios da sonda ---------------------------------------------------

const alvo = (id) => document.getElementById(id);

/**
 * Monta um painel e devolve acessos ESCOPADOS nele.
 *
 * O escopo e obrigatorio: os ids levam o user_id, e dois paineis desta pagina
 * tem os MESMOS destinatarios. getElementById devolveria o primeiro do
 * DOCUMENTO, e uma assercao sobre o caso D leria a arvore do caso A.
 */
const montar = (raiz, destinos) => {
  const caixa = alvo(raiz);
  // ReactDOM.render (legado) e nao createRoot: o legado renderiza sincrono e
  // descarrega a atualizacao no fim do evento, entao ler o DOM logo depois do
  // dispatchEvent ja ve o estado novo. Com createRoot a sonda leria o estado
  // ANTERIOR -- falso negativo que se disfarca de handler quebrado.
  ReactDOM.render(
    React.createElement(PainelPraQuemPagar, { destinos: destinos }),
    caixa
  );

  const achar = (id) => caixa.querySelector("[id='" + id + "']");

  return {
    caixa,
    achar,
    texto: (id) => {
      const el = achar(id);
      return el ? el.textContent : null;
    },
    /** Um atributo de dado, ou null quando o elemento nao existe. */
    attr: (seletor, nome) => {
      const el = caixa.querySelector(seletor);
      return el ? el.getAttribute(nome) : null;
    },
    clicar: (id) => {
      achar(id).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    },
  };
};

/** Uma linha do detalhe, no contrato de LinhaDoDetalhe (HMO-300). */
const linha = (id, descricao, valor, data) => ({
  id: id,
  gravada: true,
  descricao: descricao,
  valor: valor,
  data: data,
  de_grupo: true,
  posso_editar: false,
  fatura: null,
  fatura_suspeita: null,
  elo_da_fatura: null,
});

/**
 * Um destinatario. O ROTULO SAI DE PRODUCAO -- e o ponto do exercicio: passar
 * um texto literal aqui faria o caso C medir o proprio fixture.
 */
const destino = (user_id, nome, grupos, detalhe) => ({
  user_id: user_id,
  nome: nome,
  rotulo: rotuloDoDestino(nome, grupos[0] || null),
  grupos: grupos,
  total: Number(detalhe.reduce((s, l) => s + l.valor, 0).toFixed(2)),
  quantidade: detalhe.length,
  detalhe: detalhe,
});

const r = {};

try {
// =============================================================================
// CASO A -- A LETICIA LANCOU: o rotulo nomeia, o total aparece, e esta FECHADO
// =============================================================================
const DETALHE_A = [
  linha("a1", "Aluguel", 300, "2026-10-15"),
  linha("a2", "Internet", 53.3, "2026-10-20"),
];
const a = montar("raiz-a", [destino(LETICIA, "Letícia", ["Casa"], DETALHE_A)]);
const ID_A = "pra-quem-pagar-" + LETICIA;

r.a = {
  titulo: a.caixa.textContent.indexOf(${JSON.stringify(TITULO)}) >= 0,
  nota: a.caixa.textContent.indexOf(${JSON.stringify(NOTA)}) >= 0,
  rotulo_texto: (function () {
    const el = a.caixa.querySelector("[data-rotulo-do-destino]");
    return el ? el.textContent : null;
  })(),
  tem_nome: a.attr("[data-tem-nome]", "data-tem-nome"),
  total_attr: a.attr("[data-total-do-destino]", "data-total-do-destino"),
  total_texto: a.caixa.querySelector("[data-total-do-destino]").textContent,
  // FECHADO POR PADRAO, e a lista NAO esta no DOM (nem escondida).
  expandido: a.achar(ID_A + "-chevron").getAttribute("aria-expanded"),
  controla: a.achar(ID_A + "-chevron").getAttribute("aria-controls"),
  rotulo_do_botao: a.achar(ID_A + "-chevron").getAttribute("aria-label"),
  lista_no_dom: a.achar(ID_A + "-detalhe") !== null,
  quantas_linhas: a.caixa.querySelectorAll("[data-linha-do-detalhe]").length,
};

// =============================================================================
// CASO B -- O CHEVRON ABRE: aria-expanded troca e as linhas entram no DOM
// =============================================================================
const DETALHE_B = [
  linha("b1", "Aluguel", 300, "2026-10-15"),
  linha("b2", "Internet", 53.3, "2026-10-20"),
  linha("b3", "Gás", 12.45, "2026-10-25"),
];
const b = montar("raiz-b", [destino(LETICIA, "Letícia", ["Casa"], DETALHE_B)]);
const ID_B = "pra-quem-pagar-" + LETICIA;

b.clicar(ID_B + "-chevron");

const linhasB = Array.prototype.slice.call(
  b.caixa.querySelectorAll("[data-linha-do-detalhe]")
);

r.b = {
  expandido: b.achar(ID_B + "-chevron").getAttribute("aria-expanded"),
  rotulo_do_botao: b.achar(ID_B + "-chevron").getAttribute("aria-label"),
  lista_no_dom: b.achar(ID_B + "-detalhe") !== null,
  quantas_linhas: linhasB.length,
  // A INVARIANTE, LIDA DA TELA: a soma dos valores das linhas tem de dar o
  // total mostrado em cima. Os valores saem do atributo que o renderizador
  // escreve, e o total do span do destinatario.
  valores: linhasB.map(function (el) {
    return Number(el.querySelector("[data-valor-do-detalhe]")
      .getAttribute("data-valor-do-detalhe"));
  }),
  total_attr: Number(
    b.caixa.querySelector("[data-total-do-destino]")
      .getAttribute("data-total-do-destino")
  ),
  // O texto de cada linha: a data, a descricao e o rotulo de grupo.
  textos: linhasB.map(function (el) { return el.textContent; }),
  de_grupo: linhasB.map(function (el) {
    return el.getAttribute("data-de-grupo");
  }),
  // Fechar de novo tira a lista do DOM.
  fechou: (function () {
    b.clicar(ID_B + "-chevron");
    return {
      expandido: b.achar(ID_B + "-chevron").getAttribute("aria-expanded"),
      lista_no_dom: b.achar(ID_B + "-detalhe") !== null,
      quantas_linhas: b.caixa.querySelectorAll("[data-linha-do-detalhe]").length,
    };
  })(),
};

// =============================================================================
// CASO C -- SEM full_name: a linha CONTINUA mencionando a outra pessoa
// =============================================================================
// O controle que a issue exige. nome: null e o perfil que a RLS nao me deixa
// ler -- e rotuloDoDestino, que e PRODUCAO, e quem escreve o texto.
const c = montar("raiz-c", [
  destino(LETICIA, null, ["Casa"], [linha("c1", "Aluguel", 300, "2026-10-15")]),
]);

const rotuloC = c.caixa.querySelector("[data-rotulo-do-destino]");

r.c = {
  texto: rotuloC ? rotuloC.textContent : null,
  // A marca e o texto, LIDOS OS DOIS: so a marca passaria verde sobre um selo
  // em branco.
  tem_nome: c.attr("[data-tem-nome]", "data-tem-nome"),
  // E o elemento existe mesmo? "Escondido" seria indistinguivel de "vazio".
  existe: rotuloC !== null,
};

// =============================================================================
// CASO D -- DOIS DESTINATARIOS: abrir um NAO abre o outro
// =============================================================================
const d = montar("raiz-d", [
  destino(LETICIA, "Letícia", ["Casa"], [linha("d1", "Aluguel", 300, "2026-10-15")]),
  destino(ANA, "Ana", ["Viagem"], [linha("d2", "Hotel", 150, "2026-10-18")]),
]);

const ID_L = "pra-quem-pagar-" + LETICIA;
const ID_A2 = "pra-quem-pagar-" + ANA;

d.clicar(ID_L + "-chevron");

r.d = {
  // A ordem na tela, e os dois rotulos: o total de um nao pode sair na linha
  // do outro.
  rotulos: Array.prototype.slice
    .call(d.caixa.querySelectorAll("[data-rotulo-do-destino]"))
    .map(function (el) { return el.textContent; }),
  totais: Array.prototype.slice
    .call(d.caixa.querySelectorAll("[data-total-do-destino]"))
    .map(function (el) { return Number(el.getAttribute("data-total-do-destino")); }),
  leticia_expandida: d.achar(ID_L + "-chevron").getAttribute("aria-expanded"),
  ana_expandida: d.achar(ID_A2 + "-chevron").getAttribute("aria-expanded"),
  leticia_lista: d.achar(ID_L + "-detalhe") !== null,
  ana_lista: d.achar(ID_A2 + "-detalhe") !== null,
  // Os aria-controls tem de ser DIFERENTES, senao um chevron abre a lista do
  // outro com os dois valores certos nos lugares trocados.
  controles_diferentes:
    d.achar(ID_L + "-chevron").getAttribute("aria-controls") !==
    d.achar(ID_A2 + "-chevron").getAttribute("aria-controls"),
  // So UMA linha de detalhe no DOM: a da Leticia.
  quantas_linhas: d.caixa.querySelectorAll("[data-linha-do-detalhe]").length,
  linha_aberta: (function () {
    const el = d.caixa.querySelector("[data-linha-do-detalhe]");
    return el ? el.getAttribute("data-linha-do-detalhe") : null;
  })(),
};

// =============================================================================
// CASO E -- LISTA VAZIA: painel NENHUM, e nao um painel com R$ 0,00
// =============================================================================
const caixaE = document.createElement("div");
document.body.appendChild(caixaE);
ReactDOM.render(
  React.createElement(PainelPraQuemPagar, { destinos: [] }),
  caixaE
);

r.e = {
  html: caixaE.innerHTML,
  texto: caixaE.textContent,
};

document.getElementById("resultado").textContent =
  "RESULTADO" + JSON.stringify(r) + "FIM";
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
let paginaEscrita = null;

try {
  if (!chromium) throw new Error(SEM_NAVEGADOR);

  const dir = mkdtempSync(join(tmpdir(), "pra-quem-pagar-"));
  paginaEscrita = join(dir, "pra-quem-pagar.html");
  writeFileSync(paginaEscrita, PAGINA);

  const dump = execFileSync(
    chromium,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--window-size=390,844", // iPhone: e onde esta tela e usada
      "--dump-dom",
      `file://${paginaEscrita}`,
    ],
    {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024, // o dump carrega o React inline junto
      stdio: ["ignore", "pipe", "ignore"], // o Chromium enche a stderr de dbus
    }
  );

  // O recorte vai ate `</div>`, e nao `([^<]*)<`: o JSON do relato tem `<`
  // dentro (o `html` do caso E), e o `[^<]*` truncaria no primeiro.
  const achado = dump.match(/id="resultado">([\s\S]*?)<\/div>/);
  if (!achado) {
    throw new Error(`a pagina nao carregou:\n${dump.slice(0, 1500)}`);
  }

  // O `--dump-dom` serializa o textContent como HTML, entao todo `&` do JSON
  // volta `&amp;`. Desescapar com `&amp;` por ULTIMO, senao `&amp;lt;` viraria
  // `<`.
  const relato = achado[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

  if (relato.startsWith("ERRO NA PAGINA")) throw new Error(relato);

  const bruto = relato.match(/^RESULTADO([\s\S]*)FIM$/);
  if (!bruto) {
    throw new Error(`a pagina nao reportou resultado, e sim: ${relato}`);
  }
  resultado = JSON.parse(bruto[1]);
} catch (e) {
  erroDeExecucao = e;
}

// -----------------------------------------------------------------------------

test("o navegador rodou e reportou a pagina", () => {
  if (erroDeExecucao) throw erroDeExecucao;
  assert.ok(resultado, "sem resultado do navegador");
});

// =============================================================================
// A -- O ROTULO, O TOTAL E O ESTADO FECHADO
// =============================================================================

test("A: o painel montou, com titulo e a nota que diz que o valor NAO e extra", () => {
  assert.equal(resultado.a.titulo, true, "o titulo do painel nao esta na tela");
  // A nota e entrega: sem ela a pessoa soma este total ao «Previsto» de cima e
  // conclui que deve o dobro.
  assert.equal(resultado.a.nota, true, "a nota do painel nao esta na tela");
});

test("A: o rotulo NOMEIA a pessoa, e a marca concorda", () => {
  assert.equal(resultado.a.rotulo_texto, "Pagar para Letícia");
  assert.equal(resultado.a.tem_nome, "sim");
});

test("A: o total do destinatario sai no span dele, e e a soma das partes", () => {
  // 300 + 53,30. O atributo e o numero cru; o texto prova que o MESMO numero
  // chegou ao formatador, e nao outro.
  assert.equal(resultado.a.total_attr, "353.3");
  assert.equal(resultado.a.total_texto, "ESBOCO-VALOR:353.3");
});

test("A: FECHADO por padrao -- e a lista nao esta no DOM, nem escondida", () => {
  assert.equal(resultado.a.expandido, "false");
  // `aria-controls` aponta para o `<ul>` que so existe quando aberto.
  assert.equal(
    resultado.a.controla,
    `pra-quem-pagar-${LETICIA}-detalhe`
  );
  // A diferenca entre "nao esta no DOM" e "esta com hidden" e a sonda inteira:
  // `hidden` NAO tira o texto do textContent, e uma assercao de texto ficaria
  // verde com o chevron desligado.
  assert.equal(resultado.a.lista_no_dom, false);
  assert.equal(resultado.a.quantas_linhas, 0);
});

test("A: o rotulo do botao diz o que o clique VAI fazer, e nomeia o destino", () => {
  // "Ver os detalhes" num botao ja aberto manda o leitor de tela para o lado
  // errado -- e sem o nome do destino, dois chevrons na mesma tela tem o mesmo
  // nome acessivel.
  assert.equal(
    resultado.a.rotulo_do_botao,
    "Ver os detalhes de Pagar para Letícia"
  );
});

// =============================================================================
// B -- O CHEVRON, E A INVARIANTE LIDA DA TELA
// =============================================================================

test("B: clicar ABRE -- aria-expanded vira true e as linhas entram no DOM", () => {
  assert.equal(resultado.b.expandido, "true");
  assert.equal(resultado.b.lista_no_dom, true);
  assert.equal(resultado.b.quantas_linhas, 3);
  assert.equal(
    resultado.b.rotulo_do_botao,
    "Esconder os detalhes de Pagar para Letícia"
  );
});

test("B: A INVARIANTE -- soma(detalhe) === total, medida NA TELA", () => {
  // A entrega da HMO-300 repetida aqui: um chevron que abre uma lista que nao
  // fecha com o numero de cima transforma um numero conferivel num numero
  // desmentido pela propria tela.
  const soma = Number(
    resultado.b.valores.reduce((s, v) => s + v, 0).toFixed(2)
  );

  assert.deepEqual(resultado.b.valores, [300, 53.3, 12.45]);
  assert.equal(soma, resultado.b.total_attr);
  // E o literal tambem, para a assercao nao passar com as duas pontas zeradas.
  assert.equal(resultado.b.total_attr, 365.75);
});

test("B: cada linha vem ROTULADA como parte de grupo, com data e descricao", () => {
  // Sem o rotulo, metade do aluguel debaixo do nome do aluguel inteiro se le
  // como erro de digitacao.
  assert.deepEqual(resultado.b.de_grupo, ["sim", "sim", "sim"]);

  for (const texto of resultado.b.textos) {
    assert.match(texto, /minha parte do grupo/);
  }

  // A data sai dos COMPONENTES da string ISO (15/10, nunca 14/10): `new Date`
  // em America/Sao_Paulo imprimiria o dia anterior.
  assert.match(resultado.b.textos[0], /15\/10/);
  assert.match(resultado.b.textos[0], /Aluguel/);
  assert.match(resultado.b.textos[0], /ESBOCO-VALOR:300/);

  // E nenhuma linha ganhou o elo da fatura: sem `aoConcluirElo` ele nem e
  // montado, e um `UPDATE` aqui seria recusado pela RLS devolvendo 200.
  for (const texto of resultado.b.textos) {
    assert.doesNotMatch(texto, /ESBOCO-ELO/);
  }
});

test("B: clicar de novo FECHA, e a lista sai do DOM", () => {
  assert.equal(resultado.b.fechou.expandido, "false");
  assert.equal(resultado.b.fechou.lista_no_dom, false);
  assert.equal(resultado.b.fechou.quantas_linhas, 0);
});

// =============================================================================
// C -- O CONTROLE DO ROTULO DE FALLBACK (a medicao que a issue exige)
// =============================================================================

test("C: sem `full_name`, a linha CONTINUA mencionando a outra pessoa", () => {
  assert.equal(resultado.c.existe, true, "o rotulo desapareceu da tela");

  // A exigencia, afirmada sobre o TEXTO que o navegador pintou.
  assert.equal(resultado.c.texto, "Pagar para outro membro de Casa");
  assert.match(resultado.c.texto, /outro membro/);
  assert.ok(
    resultado.c.texto.includes("Casa"),
    "o nome do grupo ancora a divida quando o da pessoa nao e legivel"
  );

  // E os dois controles do selo em branco: o texto nao e vazio e nao termina no
  // verbo. Sem eles, um `{destino.nome}` solto (que renderiza NADA) passaria.
  assert.notEqual(resultado.c.texto.trim(), "");
  assert.doesNotMatch(resultado.c.texto, /Pagar para\s*$/);

  // A marca concorda com o texto -- as duas saem da MESMA decisao.
  assert.equal(resultado.c.tem_nome, "nao");
});

// =============================================================================
// D -- OS DOIS CHEVRONS SAO INDEPENDENTES
// =============================================================================

test("D: dois destinatarios, cada um com o SEU total", () => {
  assert.deepEqual(resultado.d.rotulos, [
    "Pagar para Letícia",
    "Pagar para Ana",
  ]);
  // O total de um na linha do outro e o defeito que a aritmetica nao pega.
  assert.deepEqual(resultado.d.totais, [300, 150]);
});

test("D: abrir a Leticia NAO abre a Ana", () => {
  assert.equal(resultado.d.leticia_expandida, "true");
  assert.equal(resultado.d.ana_expandida, "false");
  assert.equal(resultado.d.leticia_lista, true);
  assert.equal(resultado.d.ana_lista, false);

  // So a linha da Leticia esta no DOM.
  assert.equal(resultado.d.quantas_linhas, 1);
  assert.equal(resultado.d.linha_aberta, "d1");
});

test("D: os `aria-controls` dos dois chevrons sao DIFERENTES", () => {
  // Com o id repetido, um chevron abriria a lista do outro: os dois valores
  // certos, nos lugares trocados.
  assert.equal(resultado.d.controles_diferentes, true);
});

// =============================================================================
// E -- SEM DESTINATARIO, SEM PAINEL
// =============================================================================

test("E: lista vazia nao desenha painel nenhum", () => {
  // `null` e nao "R$ 0,00 a pagar": na tela de quem nao participa de grupo isso
  // e ruido que parece recurso quebrado.
  assert.equal(resultado.e.html, "");
  assert.equal(resultado.e.texto, "");
});

test("E: e o titulo do painel NAO aparece na tela de quem nao deve nada", () => {
  // O controle negativo do caso A: sem ele, uma assercao de "o titulo esta na
  // tela" poderia passar sobre um painel que aparece sempre.
  assert.ok(!resultado.e.texto.includes(TITULO));
});

// =============================================================================
// O CONTROLE DA PROPRIA SONDA
// =============================================================================

test("nenhum ESBOCO vazou para o rotulo nem para o total do destinatario", () => {
  // Os marcadores existem para serem auditaveis: se um deles aparecer onde uma
  // assercao de texto le, e a sonda medindo a propria mentira. (O
  // `ESBOCO-VALOR` do total e esperado -- ele e o formatador --, entao a
  // peneira aqui e sobre os OUTROS tres.)
  for (const proibido of ["ESBOCO-LINK", "ESBOCO-ELO", "ESBOCO-CAMINHO"]) {
    assert.ok(
      !resultado.a.rotulo_texto.includes(proibido),
      `${proibido} vazou para o rotulo`
    );
    assert.ok(
      !resultado.c.texto.includes(proibido),
      `${proibido} vazou para o rotulo de fallback`
    );
  }
});
