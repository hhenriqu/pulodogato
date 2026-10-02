// Sonda do campo de data (HMO-235 / HMO-238).
//
// Mede o comportamento REAL de digitar uma data em Chromium, que e a queixa do
// usuario: "nao da para digitar dia mes e ano sem ficar pulando pro ano". Nao e
// teste de regressao da mascara (isso e `npm run test:data-digitada`) -- e a
// medida que separa "o controle nativo atrapalha" de "o nativo esta bem e o bug
// e nosso", e a prova de que a troca resolveu o GESTO, e nao so a funcao pura.
//
//   ATO 1 (ANTES)  o `<input type="date">` nativo, varrido por posicao de clique.
//   ATO 2 (DEPOIS) o campo mascarado, nas MESMAS posicoes, agora afirmando.
//
// POR QUE A VARREDURA POR POSICAO, E NAO UM "CLIQUE NO CENTRO"
// -----------------------------------------------------------
// A primeira versao desta sonda media um clique no centro de um campo de largura
// DEFAULT (123px) e registrou "32026-10-02". O numero esta certo e continua
// reproduzido abaixo, mas a conclusao estava estreita: naquela largura o texto
// ocupa o campo inteiro, entao o centro cai sobre o segmento do ANO. O campo da
// tela de lancamento e `w-full` -- 343px num celular -- e ali o centro cai no
// VAZIO a direita do texto, onde o Chromium foca o PRIMEIRO segmento.
//
// Trocar a largura mudou o resultado, e isso por si ja condena a medida antiga:
// o que a pessoa obtem depende de onde o dedo caiu. Por isso aqui a sonda varre
// a largura de verdade e imprime a tabela inteira.
//
// O QUE A VARREDURA MOSTROU (e e pior que a queixa original)
// ----------------------------------------------------------
// Em NENHUMA das posicoes o campo nativo grava a data que a pessoa digitou. Os
// tres modos de errar:
//
//   - ORDEM: na maioria das posicoes sai "2026-10-03" -- a ordem do aparelho e
//     mm/dd, entao "10032026" (10 de marco) e lido como 3 de OUTUBRO. Data
//     errada, plausivel, gravada sem erro nenhum. Num app de dinheiro este e o
//     pior dos tres, porque nada na tela denuncia.
//   - ANO CORROMPIDO: sobre o segmento do ano saem "32026-10-02" e "32026-10-10".
//   - NADA: no icone do calendario, e no campo VAZIO em varias posicoes, as oito
//     teclas nao gravam nada e `value` fica "". E o "nao esta indo" literal.
//
// A ordem dos segmentos nao e controlavel daqui: `locale: "pt-BR"` e
// `--lang=pt-BR` nao a mudam (a sonda roda nos dois e imprime os dois). Ou seja,
// hoje o mesmo app mostra dd/mm para um usuario e mm/dd para outro, sem nada na
// tela dizendo qual. A mascara resolve isso de graca -- a ordem passa a ser
// nossa -- e e por isso que o ato 2 exige o mesmo resultado nos dois idiomas.
//
// O ato 2 chama as funcoes de lib/data-digitada.ts COMPILADAS --
// `aoDigitarData`, `aplicarMascaraNoCampo`, `exibicaoDoCampo` -- e nao uma
// reimplementacao em JavaScript solto. Sonda que exercita uma copia da regra
// mede a si mesma: fica verde enquanto o codigo que a tela roda ja quebrou.
//
// O que ela NAO cobre: o JSX de components/ui/campo-de-data.tsx. Montar React
// aqui exigiria um bundler; o que o componente adiciona sobre o que esta medido
// e a ligacao dos eventos. Por isso a regra que importa -- "digitar sobre uma
// data completa comeca uma data nova" -- mora na MASCARA e nao num handler de
// foco: assim ela cai dentro desta medida.
//
// Rode do RAIZ do repo (o Playwright vive no scratch do run, fora do repo, para
// nao mexer no package.json do projeto):
//   PLAYWRIGHT_MODULE=$PAPERCLIP_RUN_SCRATCH_DIR/node_modules/playwright/index.mjs \
//   PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright \
//   node scripts/probe-campo-de-data.mjs
//
// A pagina e montada por `setContent` de proposito: a pergunta e sobre o
// CONTROLE, nao sobre a nossa tela. Misturar o app aqui trocaria uma medida
// limpa por uma que depende de hidratacao, rota e sessao.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const HOJE = "2026-10-02";
const DIGITADO = "10032026";
const ESPERADO = "2026-03-10";

/** A largura real do campo na tela de lancamento: `w-full` num celular. */
const LARGURA = 343;
/** A largura default do controle nativo, onde o texto ocupa o campo inteiro. */
const LARGURA_ESTREITA = 123;

/**
 * Onde o dedo cai, em px a partir da borda esquerda. Cobre o primeiro segmento
 * (6, 20), o miolo do texto (40, 60, 80), o vazio a direita -- que e o centro de
 * um campo `w-full` (171, 250, 320) -- e o icone do calendario (337).
 */
const POSICOES = [6, 20, 40, 60, 80, 171, 250, 320, 337];

// ---------------------------------------------------------------------------
// A MASCARA DE VERDADE, COMPILADA NA HORA
// ---------------------------------------------------------------------------
// Compila para um diretorio FORA do repo. Um `.tmp-*` dentro dele que escape do
// .gitignore chega a ser commitado em cima de arquivo de fonte, e uma sonda nao
// precisa correr esse risco para rodar.
//
// O `export` sai por regex para o arquivo poder entrar como script CLASSICO: em
// `about:blank` um script de modulo nao expoe nada, e importar por URL nao
// funciona numa pagina montada por `setContent`. A transformacao mexe so na
// palavra `export` no inicio da linha -- os CORPOS das funcoes sao os compilados.
const saida = mkdtempSync(join(tmpdir(), "sonda-campo-de-data-"));
let mascaraJs;
try {
  execFileSync(
    join(RAIZ, "node_modules/.bin/tsc"),
    [
      join(RAIZ, "lib/data-digitada.ts"),
      "--outDir", saida,
      "--module", "es2020",
      "--target", "es2020",
      "--moduleResolution", "node",
      "--skipLibCheck",
    ],
    { stdio: "pipe" }
  );
  mascaraJs = readFileSync(join(saida, "data-digitada.js"), "utf8").replace(
    /^export /gm,
    ""
  );
} finally {
  rmSync(saida, { recursive: true, force: true });
}

const CENARIOS = [
  { nome: "sem --lang", args: [], locale: undefined },
  { nome: "com --lang=pt-BR", args: ["--lang=pt-BR"], locale: "pt-BR" },
];

const falhas = [];
function exigir(condicao, descricao, obtido) {
  if (condicao) {
    console.log(`  ok   ${descricao}`);
  } else {
    console.log(`  FALHOU ${descricao}\n         obtive ${JSON.stringify(obtido)}`);
    falhas.push(descricao);
  }
}

/**
 * Monta uma pagina com um campo, clica em `x`, digita, e devolve o que o campo
 * emitiu e o que ele mostra.
 *
 * `tipo: "nativo"` usa `<input type="date">` cru. `tipo: "mascarado"` liga o
 * campo as funcoes compiladas, no mesmo arranjo do componente: o formulario
 * guarda `valor` (AAAA-MM-DD), o campo guarda `rascunho`, e a exibicao sai de
 * `exibicaoDoCampo`.
 */
async function medir(pagina, opcoes) {
  const {
    tipo,
    x,
    valorInicial = "",
    teclas = DIGITADO,
    largura = LARGURA,
    selecionarAoFocar = true,
  } = opcoes;

  const nativo = tipo === "nativo";
  await pagina.setContent(`
    <style>input { font: 14px sans-serif; width: ${largura}px; }</style>
    <input id="campo" type="${nativo ? "date" : "text"}"
           inputmode="numeric" placeholder="dd/mm/aaaa"
           ${nativo && valorInicial ? `value="${valorInicial}"` : ""}>
  `);

  if (!nativo) {
    await pagina.addScriptTag({ content: mascaraJs });
    await pagina.evaluate(
      ({ valorInicial, selecionarAoFocar }) => {
        const campo = document.getElementById("campo");
        let rascunho = null;
        let valor = valorInicial;

        campo.value = exibicaoDoCampo(rascunho, valor);
        window.__emitido = valor;

        campo.addEventListener("input", () => {
          // A exibicao ANTERIOR a esta tecla, exatamente como o componente a
          // tem: derivada do rascunho da ultima edicao e do valor do pai.
          const anterior = exibicaoDoCampo(rascunho, valor);
          const entrada = aplicarMascaraNoCampo(campo, anterior);
          rascunho = { texto: entrada.exibicao, valor: entrada.valor };
          valor = entrada.valor;
          window.__emitido = valor;
        });

        // Selecionar tudo ao focar e um ATALHO, nao a correcao. Desligar isto e
        // o jeito de medir o aparelho em que a selecao nao sobrevive ao toque.
        if (selecionarAoFocar) {
          campo.addEventListener("focus", () => campo.select());
        }
      },
      { valorInicial, selecionarAoFocar }
    );
  }

  const caixa = await pagina.locator("#campo").boundingBox();
  await pagina.mouse.click(caixa.x + x, caixa.y + caixa.height / 2);
  await pagina.keyboard.type(teclas, { delay: 15 });

  return {
    emitido: nativo
      ? await pagina.$eval("#campo", (e) => e.value)
      : await pagina.evaluate(() => window.__emitido),
    mostrado: await pagina.$eval("#campo", (e) => e.value),
  };
}

/** Como o resultado errou, para a tabela do ato 1 dizer o que aconteceu. */
function diagnostico(emitido) {
  if (emitido === ESPERADO) return "a data digitada";
  if (emitido === "") return "NADA -- 8 teclas, nada gravado";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(emitido)) return "ANO CORROMPIDO";
  if (emitido === HOJE) return "NADA -- continua a data de antes";
  return "ORDEM -- data errada, plausivel, sem erro";
}

const porCenario = new Map();

for (const cenario of CENARIOS) {
  console.log(`\n${"=".repeat(68)}\n=== ${cenario.nome}\n${"=".repeat(68)}`);

  const navegador = await chromium.launch({ args: cenario.args });
  const contexto = await navegador.newContext(
    cenario.locale ? { locale: cenario.locale } : {}
  );
  const pagina = await contexto.newPage();

  // -------------------------------------------------------------------------
  // ATO 1: O CONTROLE NATIVO (o ANTES)
  // -------------------------------------------------------------------------
  console.log(
    `\n  ANTES -- <input type="date"> de ${LARGURA}px (o w-full da tela), ` +
      `HOJE=${HOJE}, digitando ${DIGITADO}\n`
  );
  console.log("  x    | preenchido       | vazio            | o que aconteceu");
  console.log(`  ${"-".repeat(64)}`);

  const nativos = [];
  for (const x of POSICOES) {
    const cheio = await medir(pagina, { tipo: "nativo", x, valorInicial: HOJE });
    const vazio = await medir(pagina, { tipo: "nativo", x });
    nativos.push({ x, cheio: cheio.emitido, vazio: vazio.emitido });
    console.log(
      `  ${String(x).padEnd(4)} | ${cheio.emitido.padEnd(16)} | ` +
        `${(vazio.emitido || '""').padEnd(16)} | ${diagnostico(cheio.emitido)}`
    );
  }

  // O defeito precisa estar DE PE para o ato 2 significar algo. Se um Chromium
  // futuro consertar o controle nativo, esta sonda tem que dizer isso em voz
  // alta em vez de seguir provando a troca com um argumento que venceu.
  const acertos = nativos.filter((r) => r.cheio === ESPERADO);
  exigir(
    acertos.length === 0,
    `nenhuma das ${POSICOES.length} posicoes do campo nativo grava a data digitada`,
    acertos
  );

  // O numero da issue, reproduzido onde ele de fato aparece: sobre o segmento do
  // ANO. Num campo de largura DEFAULT e o centro; num campo w-full e o miolo do
  // texto, a ~60px da borda.
  const estreito = await medir(pagina, {
    tipo: "nativo",
    x: Math.round(LARGURA_ESTREITA / 2),
    valorInicial: HOJE,
    largura: LARGURA_ESTREITA,
  });
  console.log(
    `\n  centro de um campo estreito (${LARGURA_ESTREITA}px) -> ` +
      `${JSON.stringify(estreito.emitido)}`
  );
  exigir(
    estreito.emitido === "32026-10-02",
    `o centro de um campo de ${LARGURA_ESTREITA}px reproduz 32026-10-02 (o numero da issue)`,
    estreito.emitido
  );

  // -------------------------------------------------------------------------
  // ATO 2: O CAMPO MASCARADO (o DEPOIS)
  // -------------------------------------------------------------------------
  console.log(
    `\n  DEPOIS -- campo mascarado (lib/data-digitada.ts), mesmas posicoes\n`
  );
  console.log("  x    | preenchido       | vazio            | mostra");
  console.log(`  ${"-".repeat(64)}`);

  const mascarados = [];
  for (const x of POSICOES) {
    const cheio = await medir(pagina, { tipo: "mascarado", x, valorInicial: HOJE });
    const vazio = await medir(pagina, { tipo: "mascarado", x });
    mascarados.push({ x, cheio: cheio.emitido, vazio: vazio.emitido, mostra: cheio.mostrado });
    console.log(
      `  ${String(x).padEnd(4)} | ${cheio.emitido.padEnd(16)} | ` +
        `${(vazio.emitido || '""').padEnd(16)} | ${cheio.mostrado}`
    );
  }

  // O CRITERIO PRINCIPAL, em todas as posicoes -- incluindo a que devolvia
  // "32026-10-02" e as que gravavam 3 de outubro em silencio.
  const erradas = mascarados.filter((r) => r.cheio !== ESPERADO);
  exigir(
    erradas.length === 0,
    `campo preenchido + ${DIGITADO} emite ${ESPERADO} nas ${POSICOES.length} posicoes`,
    erradas
  );

  const vaziasErradas = mascarados.filter((r) => r.vazio !== ESPERADO);
  exigir(
    vaziasErradas.length === 0,
    `campo vazio + ${DIGITADO} emite ${ESPERADO} nas ${POSICOES.length} posicoes (nao "")`,
    vaziasErradas
  );

  const exibicoes = [...new Set(mascarados.map((r) => r.mostra))];
  exigir(
    exibicoes.length === 1 && exibicoes[0] === "10/03/2026",
    "a exibicao e dd/mm/aaaa em toda posicao (a ordem agora e nossa, nao do aparelho)",
    exibicoes
  );
  // A data velha nao sobrou em pedaco nenhum -- era assim que as duas se
  // misturavam ("02/10/1202").
  exigir(
    !exibicoes[0].includes("1202") && !exibicoes[0].startsWith("02/10"),
    "a data de hoje nao sobrou misturada na data digitada",
    exibicoes
  );

  // ENTRADA INCOMPLETA emite vazio, e nao uma data parcial. A pessoa continua
  // vendo o que digitou, e a validacao continua podendo recusar.
  const parcial = await medir(pagina, {
    tipo: "mascarado",
    x: 171,
    valorInicial: HOJE,
    teclas: "101",
  });
  console.log(
    `\n  incompleto ("101") -> emite ${JSON.stringify(parcial.emitido)}, ` +
      `mostra ${JSON.stringify(parcial.mostrado)}`
  );
  exigir(
    parcial.emitido === "",
    'entrada incompleta emite vazio (o formulario recusa com "Informe a data.")',
    parcial.emitido
  );
  exigir(
    parcial.mostrado === "10/1",
    "a digitacao incompleta continua na tela, para a pessoa poder terminar",
    parcial.mostrado
  );

  // O MESMO GESTO SEM `select()` AO FOCAR, com o clique DENTRO do texto. Prova
  // que quem conserta o caso e a MASCARA, e nao o atalho de selecao: num
  // aparelho onde a selecao nao sobrevive ao toque, o campo continua certo.
  const semSelect = await medir(pagina, {
    tipo: "mascarado",
    x: 40,
    valorInicial: HOJE,
    selecionarAoFocar: false,
  });
  console.log(
    `  sem selecionar-ao-focar, clique no MEIO do texto -> ` +
      `${JSON.stringify(semSelect.emitido)}`
  );
  exigir(
    semSelect.emitido === ESPERADO,
    `sem selecionar-ao-focar, clique no meio do texto emite ${ESPERADO} (so a mascara)`,
    semSelect.emitido
  );

  porCenario.set(cenario.nome, { mascarados, parcial, semSelect });

  await navegador.close();
}

// ---------------------------------------------------------------------------
// O IDIOMA DO APARELHO NAO MUDA MAIS NADA
// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(68)}\n=== o resultado nao depende do idioma\n${"=".repeat(68)}`);
const [primeiro, ...resto] = [...porCenario.entries()];
for (const [nome, r] of resto) {
  exigir(
    JSON.stringify(r) === JSON.stringify(primeiro[1]),
    `"${nome}" da o mesmo resultado que "${primeiro[0]}"`,
    { [nome]: r, [primeiro[0]]: primeiro[1] }
  );
}

if (falhas.length > 0) {
  console.error(`\n${falhas.length} medida(s) fora do esperado:`);
  for (const f of falhas) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `\nO campo nativo erra nas ${POSICOES.length} posicoes; o mascarado acerta em ` +
    `todas, nos ${CENARIOS.length} idiomas.\n`
);
