#!/usr/bin/env node
// =====================================================
// PULODOGATO - os tiles do painel LEVAM A JANELA DA TELA no clique (HMO-408)
// =====================================================
//   npm run test:painel-clicavel
//
// O QUE SO ESTA SUITE PROVA
// -------------------------
// `npm run test:periodo-painel` prova a FUNCAO: `rotaDaTelaDoLado("receita",
// agosto)` devolve `/dashboard/receitas?de=2026-08-01&ate=2026-08-31`, e o
// `lerPeriodo` do destino devolve agosto de volta. `npm run test:tres-numeros`
// prova o TILE: qual numero aparece debaixo de qual rotulo.
//
// As duas juntas passam verde com o painel passando o MES CORRENTE para o link.
// Nada nelas alcanca a fiacao: quem escolhe o periodo que vai no endereco e
// `app/(dashboard)/dashboard/page.tsx`, e o periodo errado ali nao quebra
// build, nao quebra tipo, nao deixa a tela vazia e nao muda um pixel do painel
// -- so manda quem clicou num numero de agosto para outubro.
//
// Por isso esta suite monta A PAGINA INTEIRA em navegador de verdade, com
// `?de=&ate=` na URL, e le o atributo `href` dos dois anchors.
//
// A ARMADILHA QUE A ISSUE MANDOU MEDIR
// ------------------------------------
// Montar o `href` esperado a mao, num template literal, PASSA VERDE com o
// periodo errado -- basta a sonda usar o mes corrente como periodo de teste.
// A assercao fica indistinguivel entre "o link levou a janela da tela" e "o
// link nao levou nada e o destino caiu na rede do `lerPeriodo`".
//
// Dai os tres casos, e dai o caso C existir:
//
//   A. agosto de 2026 (`?de=2026-08-01&ate=2026-08-31`) -- um mes FECHADO, que
//      nao e o mes corrente;
//   B. 15/07 a 10/09 -- um INTERVALO, que nem comeca nem termina em mes
//      inteiro. Mata o mutante que normaliza o periodo para o mes;
//   C. /dashboard NU, sem parametro nenhum -- o unico caso em que o link deve
//      carregar o mes corrente, porque e nele que a tela esta.
//
// E a vacuidade do A e do B nao e vigiada por relogio escrito no fonte: os
// casos exigem `href(A) !== href(C)` e `href(B) !== href(C)`. Se algum dia o
// periodo da sonda COINCIDIR com o mes corrente, ou se o link parar de levar a
// janela, os dois lados ficam iguais e a suite reprova dizendo isso. Um
// `assert` contra a data de hoje escrita aqui envelheceria calado.
//
// COMO O CODIGO DE PRODUCAO CHEGA NA PAGINA
// -----------------------------------------
// `file://` + script CLASSICO + `--dump-dom`, React pelo UMD inline: a receita
// de [testar-dom-em-chromium-aqui], igual as outras sondas de navegador daqui.
//
// A DIFERENCA DESTA: CADA PARTE NUM ESCOPO PROPRIO (e nao concatenada)
// -------------------------------------------------------------------
// As sondas irmas concatenam os `.js` compilados num escopo so, tirando a
// fiacao de modulo. Aqui isso MENTIRIA, e esta medido: as quinze partes que a
// pagina arrasta tem SETE nomes repetidos entre si, e dois deles divergem --
// `addDays` existe em `lib/recurrence.js` e em `lib/recurrence-detector.js` com
// corpos diferentes (`toUtc`/`toIso` contra `paraUtc`/`paraIso`), e `numero`
// existe em `lib/moeda.js`, `lib/realizado-e-previsao.js` e
// `lib/previsto-x-realizado.js`. Num escopo plano a ultima declaracao ganha e
// as outras duas libs passam a chamar a funcao da vizinha -- sem erro, porque
// as assinaturas batem. `const` repetido nem parseia; `var` repetido parseia e
// e pior.
//
// Entao cada parte vira um IIFE que devolve os `export` dela, e cada `import`
// vira uma busca no registro `MODULOS` -- um modulo de dez linhas, com a
// propriedade que importa aqui: modulo ou nome que faltar ESTOURA NOMEANDO O
// QUE FALTOU (`__exige`), em vez de deixar um `undefined` para explodir vinte
// linhas depois como "Cannot read properties of undefined", que se le como "o
// meu import derrubou a pagina" e manda investigar a arvore errada.
//
// O QUE E PRODUCAO AQUI (nada no caminho do `href` e esboco)
// ----------------------------------------------------------
// Real, compilado, intacto (ver `PARTES`, em ordem de dependencia):
//
//   lib/recurrence, lib/dinheiro, lib/moeda, lib/recurrence-detector,
//   lib/periodo-do-painel      -- `lerPeriodo`, `periodoParaQuery` e
//                                 `rotaDaTelaDoLado`: o endereco medido sai
//                                 DAQUI, nao da sonda;
//   lib/realizado-e-previsao   -- as janelas e o `montarPainel` dos tiles;
//   lib/previsto-x-realizado, lib/dashboard-layout (quais blocos aparecem),
//   lib/criterio-do-cartao, lib/legenda-do-bruto-e-do-liquido,
//   components/ui/card|button|badge,
//   components/dashboard/RealizadoEPrevisao -- o tile. E ELE A ANCORA: a sonda
//                                 acha cada anchor pelo texto que o tile
//                                 imprime ("Receitas" + "Total esperado"), e
//                                 nao por `data-*` posto para o teste;
//   app/(dashboard)/dashboard/page.js -- o painel. E o alvo.
//
// Esboco (cada um imprime um marcador `[ESBOCO-...]`, auditavel -- os colchetes
// existem porque `textContent` concatena sem espaco e `ESBOCO-SELETOR` emendaria
// na primeira letra do vizinho):
//
//   `next/link`          -- um `<a>` com os mesmos atributos, menos o
//     `prefetch`. E o que o `next/link` renderiza; o `href` MEDIDO continua
//     vindo da pagina;
//   `next/navigation`    -- `useSearchParams` devolve os parametros do caso (e
//     a URL que esta sonda nao tem como ter em `file://`) e `useRouter`
//     registra o `push` sem navegar;
//   `lucide-react`       -- os icones, por Proxy: lista escrita a mao aqui
//     viraria divida a cada icone novo na pagina. Icone sem esboco e
//     `React.createElement(undefined)`, que derruba o render INTEIRO;
//   `ModoPapelProvider`  -- `{papel:false, mounted:true}`: o portao dos dois
//     paineis le `localStorage`, que `file://` nega. O ramo medido e o do
//     painel completo;
//   `PainelDePapel`, `SeletorDePeriodo`, `PrevistoXRealizado`,
//   `NumeroIndisponivel`, `ui/progress` -- nenhuma assercao daqui os le, e o
//     seletor arrasta o Radix e a mascara de digitacao;
//   `cn`, `cva`, `Slot`  -- a fiacao de classe dos componentes de ui.
//
// E A REDE E ESBOCO, COM UMA RESSALVA ESCRITA: as oito rotas respondem corpo
// montado aqui. Nenhuma assercao desta suite le NUMERO -- o corpo existe porque
// `if (carregando) return <Girando />` esconde o painel inteiro ate as oito
// respostas chegarem, e sem elas nao haveria tile para ter `href`. A lista
// `naoModeladas` e conferida vazia em todos os casos: uma rota nova na pagina
// aparece como falha nomeada, e nao como um painel meio carregado.
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

const SAIDA = ".tmp-painel-clicavel";

/** O caminho da pagina compilada. Os parenteses do grupo de rotas vao junto. */
const PAGINA_COMPILADA = "app/(dashboard)/dashboard/page.js";

/**
 * Acha um Chromium: o do `CHROMIUM_BIN`, o que o Playwright baixou, ou o Chrome
 * do sistema (o runner do Actions ja vem com um).
 *
 * A VERSAO DO PLAYWRIGHT NAO ESTA FIXA AQUI. As sondas de navegador deste
 * repositorio tinham `chromium-1243` escrito no fonte, e o bump do ambiente
 * para `chromium-1248` as deixou 100% vermelhas numa arvore intocada; o sintoma
 * de superficie e dezenas de `Cannot read properties of null`, que se le como
 * "o meu import derrubou a pagina". A pasta e LISTADA em vez de adivinhada.
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
// Quem compila e o script `test:painel-clicavel` do package.json. Isso tambem e
// o que faz a segunda peneira do check-tests-in-ci.mjs enxergar os arquivos
// desta suite -- ela le os caminhos citados NO COMANDO.

if (!existsSync(join(SAIDA, PAGINA_COMPILADA))) {
  throw new Error(
    `${SAIDA}/ nao existe. Rode por \`npm run test:painel-clicavel\`, ` +
      "que e quem compila a pagina antes do teste."
  );
}

/** O especificador com que a pagina importa cada parte: `@/lib/x`. */
const especificador = (parte) => "@/" + parte.replace(/\.js$/, "");

/**
 * UMA PARTE COMPILADA VIRA UM MODULO COM ESCOPO PROPRIO.
 *
 * Nao e um empacotador de verdade e nao tenta ser: ele cobre exatamente as tres
 * formas de `import` e as cinco de `export` que o tsc emite para estas quinze
 * partes, e ESTOURA em qualquer outra. Falhar na forma nova e o ponto -- uma
 * forma que passasse batida sairia como `undefined` no meio da pagina.
 */
function paraModulo(parte, fonte) {
  const nomes = new Map();
  let corpo = fonte;

  // 1. OS IMPORTS viram busca no registro.
  //
  // O recorte vai do `import` ate o `;` e nao de uma linha so: o tsc quebra a
  // lista de nomes em varias linhas quando ela e longa, e um recorte por linha
  // deixaria metade dos nomes solta no meio do script.
  corpo = corpo.replace(
    /^import\s+(?:\{([\s\S]*?)\}|\*\s+as\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*))\s+from\s+"([^"]+)";$/gm,
    (todo, nomeados, namespace, padrao, origem) => {
      const alvo = JSON.stringify(origem);

      if (nomeados !== undefined) {
        const lista = nomeados
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean);
        for (const nome of lista) {
          if (!/^[A-Za-z_$][\w$]*$/.test(nome)) {
            throw new Error(
              `forma de import que esta sonda nao conhece, em ${parte}: ` +
                `${todo.trim()}\najuste paraModulo()`
            );
          }
        }
        return `const { ${lista.join(", ")} } = __exige(${alvo}, ${JSON.stringify(
          lista
        )});`;
      }

      if (namespace !== undefined) {
        return `const ${namespace} = __exige(${alvo}, []);`;
      }

      return `const ${padrao} = __exige(${alvo}, ["default"]).default;`;
    }
  );

  const importSolto = corpo.match(/^\s*import\s.*$/m);
  if (importSolto) {
    throw new Error(
      `sobrou import em ${parte}: ${importSolto[0].trim()}\najuste paraModulo()`
    );
  }

  // 2. OS EXPORTS viram declaracao comum, e os nomes vao para o `return`.
  //    `export default function` ANTES da generica: tirar so a palavra
  //    `export` deixaria `default function DashboardPage() {`, que e
  //    SyntaxError -- e um que a peneira de "sobrou export" nao pega, porque a
  //    palavra `export` sumiu.
  corpo = corpo.replace(
    /^export default function ([A-Za-z_$][\w$]*)/gm,
    (todo, nome) => {
      nomes.set("default", nome);
      return `function ${nome}`;
    }
  );

  corpo = corpo.replace(
    /^export (async function|function|const|let|var|class) ([A-Za-z_$][\w$]*)/gm,
    (todo, tipo, nome) => {
      nomes.set(nome, nome);
      return `${tipo} ${nome}`;
    }
  );

  // O `export { A, B };` de fim de arquivo (card.js, button.js, badge.js) e o
  // `export {};` dos modulos que so tinham tipo: apagados INTEIROS. `[^}]*` nao
  // atravessa chave, entao corpo de funcao fica fora do alcance.
  corpo = corpo.replace(/^export\s*\{([^}]*)\}\s*;$/gm, (todo, lista) => {
    for (const nome of lista
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)) {
      nomes.set(nome, nome);
    }
    return "";
  });

  const exportSolto = corpo.match(/^\s*export\s.*$/m);
  if (exportSolto) {
    throw new Error(
      `sobrou export em ${parte}: ${exportSolto[0].trim()}\najuste paraModulo()`
    );
  }

  if (nomes.size === 0) {
    throw new Error(
      `${parte} nao exporta nada depois do recorte: a ancora de paraModulo() mudou`
    );
  }

  const devolve = Array.from(nomes.entries())
    .map(([fora, dentro]) => `${JSON.stringify(fora)}: ${dentro}`)
    .join(", ");

  const montado =
    `MODULOS[${JSON.stringify(especificador(parte))}] = (function () {\n` +
    `${corpo}\n` +
    `return { ${devolve} };\n` +
    `})();`;

  try {
    new Function(montado);
  } catch (e) {
    throw new Error(
      `${parte} nao parseia depois do recorte: ${e.message}\najuste paraModulo()`
    );
  }

  return montado;
}

const PARTES = [
  // ORDEM DE DEPENDENCIA: cada IIFE roda na hora, e `__exige` de um modulo que
  // ainda nao montou estoura nomeando-o.
  "lib/recurrence.js",
  "lib/dinheiro.js",
  "lib/moeda.js",
  "lib/recurrence-detector.js",
  "lib/periodo-do-painel.js",
  "lib/realizado-e-previsao.js",
  "lib/previsto-x-realizado.js",
  "lib/dashboard-layout.js",
  "lib/criterio-do-cartao.js",
  "lib/legenda-do-bruto-e-do-liquido.js",
  "components/ui/card.js",
  "components/ui/button.js",
  "components/ui/badge.js",
  "components/dashboard/RealizadoEPrevisao.js",
  PAGINA_COMPILADA,
];

const producao = PARTES.map((parte) =>
  paraModulo(parte, readFileSync(join(SAIDA, parte), "utf8"))
).join("\n");

const ENTRADA = especificador(PAGINA_COMPILADA);

/** O React UMD, inline: `<script src>` entre arquivos file:// e outra briga. */
const umd = (pacote, arquivo) =>
  readFileSync(join("node_modules", pacote, "umd", arquivo), "utf8");

// --- os periodos dos casos ----------------------------------------------------
//
// Escritos aqui porque e a URL do caso -- o que a pessoa esta olhando --, e nao
// um numero da feature. O que NAO esta escrito em lugar nenhum e o `href`
// esperado: ele e montado abaixo a partir destes dois campos, com o mesmo
// formato que `periodoParaQuery` promete e que `test:periodo-painel` fixa.

/** Um mes FECHADO, que nao e o mes corrente. */
const AGOSTO = { de: "2026-08-01", ate: "2026-08-31" };
/** Nem comeca nem termina em mes inteiro: modo intervalo. */
const INTERVALO = { de: "2026-07-15", ate: "2026-09-10" };

const enderecoEsperado = (tela, janela) =>
  `/dashboard/${tela}?de=${janela.de}&ate=${janela.ate}`;

// A pagina e montada com template literal, e NUNCA com `String.replace`: o
// bundle do React tem `$$typeof` dentro, e numa string de substituicao `$$`
// vira `$` -- o bundle chega corrompido e o erro e "React is not defined", que
// nao se le como o que e.
const PAGINA = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<div id="raiz-a"></div><div id="raiz-b"></div><div id="raiz-c"></div>
<div id="resultado"></div>
<script>${umd("react", "react.development.js")}</script>
<script>${umd("react-dom", "react-dom.development.js")}</script>
<script>
(async function () {
try {

// --- o registro de modulos ---------------------------------------------------

const MODULOS = Object.create(null);

/**
 * Busca um modulo e CONFERE os nomes pedidos.
 *
 * A conferencia e o motivo de a funcao existir. Sem ela, um esboco que faltasse
 * deixaria o nome \`undefined\` e o sintoma seria um "Cannot read properties of
 * undefined" vinte linhas adiante, dentro do codigo de producao -- que se le
 * como defeito do app.
 */
function __exige(origem, nomes) {
  const mod = MODULOS[origem];
  if (!mod) {
    throw new Error(
      "a sonda nao montou o modulo " + origem +
      ": ponha uma PARTE real ou um esboco em MODULOS"
    );
  }
  for (var i = 0; i < nomes.length; i++) {
    if (!(nomes[i] in mod)) {
      throw new Error(
        "o modulo " + origem + " nao tem " + nomes[i] + " nesta sonda"
      );
    }
  }
  return mod;
}

// --- os esbocos --------------------------------------------------------------
//
// Todo esboco imprime um marcador \`[ESBOCO-...]\`, e o inventario deles e
// conferido nos tres casos: assim um esboco NOVO, aparecendo onde as assercoes
// leem, nao passa calado.

const esboco = (nome) => function Esboco() {
  return React.createElement("span", null, "[ESBOCO-" + nome + "]");
};

MODULOS["react"] = React;

// O \`next/link\` renderiza um \`<a>\` com os atributos que recebeu. O \`href\`
// que esta suite mede continua sendo o da PAGINA: o esboco e o papel, nao a
// tinta.
MODULOS["next/link"] = {
  default: React.forwardRef(function Link(props, ref) {
    const resto = Object.assign({ ref: ref }, props);
    delete resto.prefetch;
    return React.createElement("a", resto);
  }),
};

// A URL do caso. Em \`file://\` nao ha querystring de verdade para o
// \`useSearchParams\` ler, e e isto que a substitui.
let PARAMS = {};
let EMPURRADOS = [];

MODULOS["next/navigation"] = {
  useSearchParams: () => ({
    get: (chave) =>
      Object.prototype.hasOwnProperty.call(PARAMS, chave) ? PARAMS[chave] : null,
  }),
  useRouter: () => ({
    push: (url) => { EMPURRADOS.push(String(url)); },
    replace: (url) => { EMPURRADOS.push(String(url)); },
  }),
};

// Os icones por Proxy, e nao por lista: a pagina importa doze e o tile dois, e
// uma lista escrita aqui viraria divida a cada icone novo.
MODULOS["lucide-react"] = new Proxy({}, {
  has: () => true,
  get: (alvo, nome) => (props) =>
    React.createElement("span", { "data-icone": String(nome), "aria-hidden": "true" }),
});

MODULOS["@/lib/utils"] = {
  cn: (...partes) => partes.filter(Boolean).join(" "),
};
MODULOS["class-variance-authority"] = { cva: (base) => () => base };
MODULOS["@radix-ui/react-slot"] = {
  Slot: React.forwardRef(function Slot(props, ref) {
    return React.createElement("span", Object.assign({ ref: ref }, props));
  }),
};

MODULOS["@/components/ui/progress"] = { Progress: esboco("PROGRESSO") };
MODULOS["@/components/dashboard/SeletorDePeriodo"] = {
  SeletorDePeriodo: esboco("SELETOR-DE-PERIODO"),
};
MODULOS["@/components/dashboard/PrevistoXRealizado"] = {
  PrevistoXRealizado: esboco("PREVISTO-X-REALIZADO"),
};
MODULOS["@/components/SemRede"] = {
  NumeroIndisponivel: esboco("NUMERO-INDISPONIVEL"),
};
MODULOS["@/components/papel-de-pao/PainelDePapel"] = {
  PainelDePapel: esboco("PAINEL-DE-PAPEL"),
};
// O portao dos dois paineis le o \`localStorage\`, que \`file://\` nega. O ramo
// medido e o do painel completo, e \`mounted:false\` mostraria so o giro.
MODULOS["@/components/ModoPapelProvider"] = {
  useModoPapel: () => ({ papel: false, mounted: true }),
};

// --- o codigo de producao ----------------------------------------------------

${producao}

const DashboardPage = __exige(${JSON.stringify(ENTRADA)}, ["default"]).default;

// --- a rede ------------------------------------------------------------------
//
// NENHUMA ASSERCAO DESTA SUITE LE NUMERO. O corpo existe por um motivo so:
// \`if (carregando) return <Girando />\` esconde o painel inteiro ate as oito
// respostas chegarem, e sem painel nao ha tile para ter \`href\`.
//
// A conta tem UM saldo de proposito: com a lista vazia a pagina mostra o cartao
// de boas-vindas, que e outro estado -- e o tile continuaria la, mas o caso
// deixaria de ser o painel de quem usa o app.

let CHAMADAS = [];
let NAO_MODELADAS = [];

const RESPOSTAS = [
  [/^\\/api\\/financial-accounts/, () => ({
    accounts: [{ id: "c-1", name: "Conta corrente", current_balance: 4200 }],
  })],
  [/^\\/api\\/reports\\/cash-flow\\?/, () => ({
    summary: { total_income: 4000, total_expense: 2500, net: 1500 },
  })],
  [/^\\/api\\/scheduled-transactions\\/summary\\?/, () => ({
    summary: [],
    fixed_monthly_cost: 0,
  })],
  [/^\\/api\\/dashboard\\/previsao\\?/, () => ({
    previsao: { receita: 1200, despesa: 800 },
    variable_spend: null,
    recorrencias_indisponiveis: false,
  })],
  [/^\\/api\\/goals\\?/, () => ({ goals: [] })],
  [/^\\/api\\/safe-to-spend/, () => ({ safe_to_spend: null })],
  [/^\\/api\\/settings\\/dashboard/, () => ({ layout: null })],
  [/^\\/api\\/reports\\/net-worth\\?/, () => ({ months: [] })],
];

window.fetch = async function (url) {
  const alvo = String(url);
  CHAMADAS.push(alvo);
  for (var i = 0; i < RESPOSTAS.length; i++) {
    if (RESPOSTAS[i][0].test(alvo)) {
      return { ok: true, status: 200, json: async () => RESPOSTAS[i][1]() };
    }
  }
  // Rota que a sonda nao modelou: registrada para o caso reprovar NOMEANDO-A.
  // Silenciosa, ela sairia como um painel meio carregado.
  NAO_MODELADAS.push(alvo);
  return {
    ok: false,
    status: 404,
    json: async () => ({ error: "a sonda nao modelou esta rota" }),
  };
};

// --- o arnes -----------------------------------------------------------------

/**
 * DRENA A FILA DE MICROTASKS, intercalado com \`flushSync\`.
 *
 * A continuacao de um \`await\` e um microtask, e a fila so drena no fim da
 * tarefa atual -- ou seja, depois que este \`<script>\` inteiro terminar.
 * \`flushSync\` e sincrono e nao a drena. Sem drenar intercalado, toda medicao
 * cairia na fase \`carregando\`, em que a pagina mostra o giro e nada mais.
 *
 * O \`carregar\` desta pagina e o mais fundo das sondas daqui: um
 * \`Promise.all\` de oito \`fetch\` e depois sete \`resposta.json()\` em
 * sequencia, cada um um \`await\` proprio.
 *
 * E NUNCA \`setTimeout\`: a fila de microtasks drena muito antes de o
 * \`--dump-dom\` fotografar; um temporizador seria uma corrida contra a foto.
 */
async function assentar() {
  for (let i = 0; i < 96; i++) {
    await Promise.resolve();
    ReactDOM.flushSync(function () {});
  }
}

/**
 * O tile de um lado, achado pelo TEXTO QUE PRODUCAO IMPRIME.
 *
 * Nao por \`data-*\` posto para o teste: ancora inventada muda de nome num
 * refactor e a busca passa a devolver lista vazia -- e "o href nao tem o
 * periodo" e verdade numa lista vazia. O par (titulo do tile + "Total
 * esperado") e o que o RealizadoEPrevisao escreve, e so os dois tiles tem os
 * dois.
 *
 * Devolve \`quantos\` sempre, e o caso afirma \`quantos === 1\`: e esse o
 * controle positivo de que a pagina montou.
 */
function tileDe(anchors, titulo) {
  const achados = anchors.filter(function (a) {
    const t = a.textContent.replace(/\\s+/g, " ").trim();
    return t.indexOf(titulo) === 0 && t.indexOf("Total esperado") >= 0;
  });
  if (achados.length !== 1) {
    return { quantos: achados.length, href: null, texto: null };
  }
  return {
    quantos: 1,
    // \`getAttribute\` e nao \`.href\`: a propriedade resolve contra o
    // \`file://\` da sonda e devolveria \`file:///tmp/.../dashboard/receitas\`.
    href: achados[0].getAttribute("href"),
    texto: achados[0].textContent.replace(/\\s+/g, " ").trim(),
  };
}

const retrato = (raiz) => {
  const anchors = Array.prototype.slice.call(raiz.querySelectorAll("a"));
  const texto = raiz.textContent.replace(/\\s+/g, " ").trim();
  return {
    receitas: tileDe(anchors, "Receitas"),
    despesas: tileDe(anchors, "Despesas"),
    hrefs: anchors.map((a) => a.getAttribute("href")),
    esbocos: (texto.match(/\\[ESBOCO-[^\\]]+\\]/g) || [])
      .filter((v, i, t) => t.indexOf(v) === i)
      .sort(),
    trecho: texto.slice(0, 400),
    naoModeladas: NAO_MODELADAS.slice(),
    chamadas: CHAMADAS.slice(),
  };
};

/** Monta o painel num container, com os parametros de URL do caso. */
async function montar(idDaRaiz, params) {
  PARAMS = params;
  CHAMADAS = [];
  NAO_MODELADAS = [];
  EMPURRADOS = [];

  const raiz = document.getElementById(idDaRaiz);
  ReactDOM.render(React.createElement(DashboardPage), raiz);
  await assentar();
  return retrato(raiz);
}

const out = {};

// =========================================================================
// A. UM MES FECHADO NA URL: os dois tiles levam AQUELA janela
// =========================================================================
out.a = await montar("raiz-a", ${JSON.stringify(AGOSTO)});

// =========================================================================
// B. UM INTERVALO que nao e mes inteiro: a janela vai como esta, sem arredondar
// =========================================================================
// Mata o mutante que monta o endereco a partir do MES do periodo em vez do
// periodo -- com o caso A sozinho, 01/08..31/08 e o mes dele proprio e os dois
// enderecos sao identicos.
out.b = await montar("raiz-b", ${JSON.stringify(INTERVALO)});

// =========================================================================
// C. /dashboard NU: o link leva o mes corrente, que e onde a tela esta
// =========================================================================
// O gemeo que tira a vacuidade dos outros dois. Se o link parar de levar
// janela, ou se o periodo da sonda virar o mes corrente, o \`href\` daqui fica
// IGUAL ao do A -- e os casos exigem que seja diferente.
out.c = await montar("raiz-c", {});

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
  const dir = mkdtempSync(join(tmpdir(), "painel-clicavel-"));
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
      timeout: 180_000,
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
  // volta como `&amp;` -- e TODO href desta sonda tem um (`?de=...&ate=...`).
  // Sem desescapar, a assercao compara `&amp;ate=` com `&ate=` e reprova sem
  // nada estar errado no app. `&amp;` por ULTIMO, senao `&amp;lt;` viraria `<`.
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
  resultado = rodarPagina("painel.html", PAGINA);
} catch (e) {
  erroDeExecucao = e;
}

// FALHA, e nunca `skip`, sem navegador: um canal opcional fica desligado sem
// sintoma, e a suite verde sem ter rodado nada e pior que a suite vermelha.
test("o navegador rodou e o painel reportou os tres casos", () => {
  if (erroDeExecucao) throw erroDeExecucao;
  assert.ok(resultado, "a pagina nao reportou resultado");
  assert.deepEqual(Object.keys(resultado).sort(), ["a", "b", "c"]);
});

/** Os tres casos, com o nome que o relato usa. */
const CASOS = [
  ["a", "mes fechado na URL", AGOSTO],
  ["b", "intervalo na URL", INTERVALO],
  ["c", "/dashboard nu", null],
];

// ---------------------------------------------------------------------------
// CONTROLE POSITIVO: a pagina montou, e cada tile e UM anchor
// ---------------------------------------------------------------------------
// Sem este caso, todas as assercoes de `href` abaixo falariam de `null` e a
// mensagem seria sobre o periodo -- quando o que houve foi a pagina nao montar.
// `quantos === 1` tambem recusa o oposto: o tile dentro de dois anchors
// aninhados, que o navegador desaninha e o React nem avisa.

for (const [chave, nome] of CASOS) {
  test(`${nome}: os dois tiles sao exatamente UM anchor cada`, () => {
    if (erroDeExecucao) throw erroDeExecucao;
    const caso = resultado[chave];

    assert.equal(
      caso.receitas.quantos,
      1,
      `tile de Receitas: ${caso.receitas.quantos} anchors.\n` +
        `hrefs na tela: ${JSON.stringify(caso.hrefs)}\n` +
        `trecho: ${caso.trecho}`
    );
    assert.equal(
      caso.despesas.quantos,
      1,
      `tile de Despesas: ${caso.despesas.quantos} anchors.\n` +
        `hrefs na tela: ${JSON.stringify(caso.hrefs)}\n` +
        `trecho: ${caso.trecho}`
    );

    // O tile continua inteiro dentro do link: o numero grande, as duas
    // parcelas e o rotulo. Um link que envolvesse so o titulo passaria nas
    // assercoes de `href` e deixaria o resto do cartao morto ao clique.
    for (const tile of [caso.receitas, caso.despesas]) {
      for (const pedaco of ["Total esperado", "Realizado", "Previsão"]) {
        assert.ok(
          tile.texto.includes(pedaco),
          `"${pedaco}" ficou fora do link: ${tile.texto}`
        );
      }
    }
  });

  test(`${nome}: a sonda modelou todas as rotas que a pagina pediu`, () => {
    if (erroDeExecucao) throw erroDeExecucao;
    assert.deepEqual(
      resultado[chave].naoModeladas,
      [],
      "a pagina pediu rota que esta sonda nao modela -- o painel carregou pela metade"
    );
  });

  test(`${nome}: nenhum esboco novo apareceu na tela`, () => {
    if (erroDeExecucao) throw erroDeExecucao;
    // Inventario, e nao "nenhum ESBOCO": os declarados sao legitimos. O que
    // este caso pega e o esboco NOVO, de um componente que a pagina passou a
    // importar e que a sonda esbocou calada -- e que pode estar justamente no
    // caminho do que as outras assercoes leem.
    //
    // SAO DOIS, e nao os cinco declarados em MODULOS: `Progress` so desenha
    // dentro de uma meta (a rota devolve lista vazia), `NumeroIndisponivel` so
    // quando uma rota falha em ler, e `PainelDePapel` e o outro ramo do portao.
    // Esboco declarado e esboco RENDERIZADO sao coisas diferentes, e e o
    // segundo que pode encostar numa assercao.
    assert.deepEqual(resultado[chave].esbocos, [
      "[ESBOCO-PREVISTO-X-REALIZADO]",
      "[ESBOCO-SELETOR-DE-PERIODO]",
    ]);
  });
}

// ---------------------------------------------------------------------------
// A AFIRMACAO DA ISSUE: o clique leva a tela cheia COM a janela da tela
// ---------------------------------------------------------------------------

test("mes fechado na URL: os dois tiles levam AQUELA janela, nao o mes corrente", () => {
  if (erroDeExecucao) throw erroDeExecucao;
  const caso = resultado.a;

  assert.equal(
    caso.receitas.href,
    enderecoEsperado("receitas", AGOSTO),
    "o tile de Receitas nao levou a janela da tela"
  );
  assert.equal(
    caso.despesas.href,
    enderecoEsperado("despesas", AGOSTO),
    "o tile de Despesas nao levou a janela da tela"
  );
});

test("intervalo na URL: a janela vai como esta, sem virar mes inteiro", () => {
  if (erroDeExecucao) throw erroDeExecucao;
  const caso = resultado.b;

  assert.equal(caso.receitas.href, enderecoEsperado("receitas", INTERVALO));
  assert.equal(caso.despesas.href, enderecoEsperado("despesas", INTERVALO));
});

test("/dashboard nu: o link leva o mes corrente -- e ele e OUTRO periodo", () => {
  if (erroDeExecucao) throw erroDeExecucao;
  const nu = resultado.c;

  // Formato, e nao valor: o mes corrente depende do dia em que o CI roda, e um
  // literal aqui envelheceria calado em menos de um mes.
  for (const [tela, tile] of [
    ["receitas", nu.receitas],
    ["despesas", nu.despesas],
  ]) {
    assert.match(
      tile.href,
      new RegExp(`^/dashboard/${tela}\\?de=\\d{4}-\\d{2}-01&ate=\\d{4}-\\d{2}-\\d{2}$`),
      `o link do painel nu nao leva uma janela de mes: ${tile.href}`
    );
  }

  // O QUE TIRA A VACUIDADE DOS CASOS A E B. Se o `href` parasse de carregar a
  // janela da tela, os tres casos devolveriam o mesmo endereco -- e as duas
  // assercoes de cima continuariam verdes.
  assert.notEqual(
    resultado.a.receitas.href,
    nu.receitas.href,
    "o periodo da URL nao chegou no link: agosto e o painel nu deram o mesmo endereco"
  );
  assert.notEqual(
    resultado.b.receitas.href,
    nu.receitas.href,
    "o periodo da URL nao chegou no link: o intervalo e o painel nu deram o mesmo endereco"
  );
  assert.notEqual(
    resultado.a.receitas.href,
    resultado.b.receitas.href,
    "os dois periodos da sonda deram o mesmo endereco"
  );
});

test("cada tile aponta para a tela DELE", () => {
  if (erroDeExecucao) throw erroDeExecucao;
  // Os dois tiles apontando para a mesma tela compilam, rendem e passam em
  // qualquer assercao que leia um lado so: o tile de Receitas abriria Despesas
  // com o periodo certo, e a unica pista seria o titulo da tela de destino.
  for (const [chave] of CASOS) {
    const caso = resultado[chave];
    assert.ok(
      caso.receitas.href.startsWith("/dashboard/receitas?"),
      `${chave}: Receitas aponta para ${caso.receitas.href}`
    );
    assert.ok(
      caso.despesas.href.startsWith("/dashboard/despesas?"),
      `${chave}: Despesas aponta para ${caso.despesas.href}`
    );
  }
});
