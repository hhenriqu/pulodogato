#!/usr/bin/env node
// =====================================================
// CONTROLE NEGATIVO DO CONFERIDOR DA CONVERSAO: FAMILIA TUPLA -- HMO-334
// =====================================================
// Roda com:  node scripts/mutantes-conferidor-da-conversao-tupla.mjs
//
// POR QUE UM SEGUNDO CONTROLE, E NAO MAIS CENARIOS NO PRIMEIRO
// ------------------------------------------------------------
// `mutantes-conferidor-da-conversao.mjs` (HMO-328) vigia o conferidor pela
// familia DO PAINEL: o fixture dele e uma lista de OBJETOS, e os cenarios
// estragam `nome:`, `arquivo:`, `de:`. Nenhum deles passa perto das travas que
// a familia tupla usa -- que sao outras funcoes, porque a lista tem outra forma:
//
//   do painel                     | tupla
//   ------------------------------+--------------------------------------------
//   conta mutantes por `nome:`    | conta por `[` na coluna 2
//   entradas por `{` na coluna 2  | entradas pelo `],` que FECHA
//   um extrator de miolo          | outro, com quatro declaracoes mortas a tirar
//   uma aridade                   | DUAS (3 e 4 elementos por tupla)
//
// Rodar o controle do painel com a familia tupla no repositorio nao mede nada
// disto: `conferir` escolhe as contagens pela familia do arquivo de ANTES, e o
// fixture do painel nunca passa pelas da tupla. Um controle por familia e o
// recorte mais apertado que ainda prova algo.
//
// O QUE ESTE ARQUIVO PROVA, EM QUATRO PARTES
// ------------------------------------------
//   0. os TRES predicados de familia sao mutuamente exclusivos -- varrendo os
//      runners de verdade do repositorio, nao fixtures. A HMO-328 mediu o que
//      custa errar isso: reconhecer a tupla so por `const mutantes = [` fez o
//      conversor aceitar um runner da outra familia e cuspir um arquivo que nem
//      carregava;
//   1. CONTROLE POSITIVO: os dois fixtures (aridade 3 e 4) convertem e conferem
//      limpo. Sem ele, todo cenario abaixo "passa" por reprovar pelo motivo
//      errado e o placar fecha cheio sobre nada;
//   2. cada conversao estragada e ACUSADA, e pela mensagem certa;
//   3. os dois casos que o `a === b` NAO pega: o conversor mutado, truncando os
//      dois lados igual (o furo da HMO-318), e as contagens trocadas pelas da
//      outra familia -- que e o jeito de provar que elas sao load-bearing.
//
// POR QUE FIXTURE, E NAO OS RUNNERS DE VERDADE (parte 1 em diante)
// ----------------------------------------------------------------
// A mesma razao da HMO-328: o `--conferir` precisa do texto de ANTES, que depois
// do commit so existe no historico do git, e um controle que faz arqueologia de
// commit apodrece na primeira reescrita de historia. A parte 0 e a excecao de
// proposito -- ela mede PREDICADO, que se le do arquivo atual.
//
// O FIXTURE DE ARIDADE 4 E O PRINCIPAL, e isso e deliberado: ele e o caso
// difIcil (multi-arquivo, `const fontes = new Map`, `function suiteVermelha`) e
// carrega de proposito UMA ENTRADA FECHADA COM QUATRO ESPACOS em vez de dois --
// que nao e capricho, e a forma que `mutantes-lancamentos-completos` tem de
// verdade na linha 138. E ela que obriga a contagem de `entradas` a aceitar
// indentacao frouxa, e o cenario 3d prova que o fixture a exercita.
// =====================================================

import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  conferir,
  converterTupla,
  ehTupla,
  ehDoPainel,
  familiaDe,
} from "./converte-mutantes-em-bloco.mjs";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CONVERSOR = path.join(RAIZ, "scripts", "converte-mutantes-em-bloco.mjs");

let falhas = 0;

// ---------------------------------------------------------------------------
// PARTE 0 -- OS TRES PREDICADOS NAO SE SOBREPOEM, NOS RUNNERS DE VERDADE
// ---------------------------------------------------------------------------
// A varredura e por `readdirSync` e nao por uma lista de nomes a mao, e a razao
// e medida: uma lista a mao de runners quebra o controle na primeira vez que
// alguem apaga um runner (foi o que a HMO-330 fez com oito deles), e falha por
// um motivo que nada tem a ver com o que ela mede.
//
// A trava do "ao menos um de cada" e o que impede esta parte de ficar VACUA: sem
// ela, um predicado que devolvesse `false` sempre passaria com zero conflitos.
const PREDICADOS = {
  painel: ehDoPainel,
  tupla: ehTupla,
  hmo246: (t) => /^const MUTANTES = \[$/m.test(t),
};

const porFamilia = { painel: 0, tupla: 0, hmo246: 0 };
const conflitos = [];
for (const arquivo of readdirSync(path.join(RAIZ, "scripts"))) {
  if (!/^mutantes-.*\.mjs$/.test(arquivo)) continue;
  const texto = readFileSync(path.join(RAIZ, "scripts", arquivo), "utf8");
  const quais = Object.entries(PREDICADOS)
    .filter(([, p]) => p(texto))
    .map(([n]) => n);
  if (quais.length > 1) conflitos.push(`${arquivo}: ${quais.join(" E ")}`);
  else if (quais.length === 1) porFamilia[quais[0]]++;
}

if (conflitos.length > 0) {
  console.error("ABORTADO: dois predicados de familia reconhecem o mesmo runner.");
  for (const c of conflitos) console.error(`  ${c}`);
  console.error("`familiaDe` decide pela ORDEM da tabela, e o segundo conversor");
  console.error("produziria um arquivo que nao carrega (o estrago da HMO-328).");
  process.exit(1);
}
const vazias = Object.entries(porFamilia).filter(([, n]) => n === 0);
if (vazias.length > 0) {
  console.error(
    `ABORTADO: nenhum runner reconhecido como ${vazias.map(([n]) => n).join(", ")} -- ` +
      "a varredura nao mediu nada.",
  );
  process.exit(1);
}
console.log(
  `parte 0: predicados exclusivos em ${Object.values(porFamilia).reduce((a, b) => a + b)} runners ` +
    `(${Object.entries(porFamilia).map(([n, q]) => `${n}:${q}`).join(" ")})`,
);

// ---------------------------------------------------------------------------
// OS FIXTURES
// ---------------------------------------------------------------------------
const ANTES_4 = `// CONTROLE NEGATIVO de alguma coisa -- HMO-000.
//
// POR QUE ESTE RUNNER EXISTE
// --------------------------
// Para o controle negativo do conferidor da conversao. Esta secao continua
// verdadeira depois da conversao, e tem de SOBREVIVER a poda.
//
// Nao usa \`git checkout\` para restaurar: ele restauraria a partir do INDICE, e
// num worktree compartilhado isso ja apagou trabalho nao commitado aqui. A
// copia original vai para a memoria e volta de la, sempre.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const LIB = "lib/exemplo.ts";
const TELA = "components/Exemplo.tsx";

const fontes = new Map([
  [LIB, readFileSync(LIB, "utf8")],
  [TELA, readFileSync(TELA, "utf8")],
]);

const SUITE = "npm run test:exemplo-puro";

/** Roda a suite. \`true\` = vermelha. */
function suiteVermelha() {
  try {
    execSync(SUITE, { stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
}

const mutantes = [
  [
    LIB,
    // O primeiro, com comentario -- que tambem tem de vir intacto.
    "o primeiro mutante",
    "const a = 1;",
    "const a = 2;",
    ],
  [
    LIB,
    "o segundo mutante",
    "const b = somar(x, y);",
    "const b = somar(y, x);",
  ],
  [
    TELA,
    "o terceiro mutante, na tela",
    "<span>{valor}</span>",
    "<span>{0}</span>",
  ],
];

let sobreviventes = 0;

for (const [alvo, nome, de, para] of mutantes) {
  const original = fontes.get(alvo);
  if (!original.includes(de)) {
    console.log(\`??  \${nome}: o trecho nao existe mais\`);
    sobreviventes++;
    continue;
  }
  writeFileSync(alvo, original.replace(de, para));
  const vermelho = suiteVermelha();
  writeFileSync(alvo, original);
  console.log(\`\${vermelho ? "OK  " : "VIVO"} \${nome}\`);
  if (!vermelho) sobreviventes++;
}

for (const [alvo, original] of fontes) writeFileSync(alvo, original);
process.exit(sobreviventes === 0 ? 0 : 1);
`;

// O fixture de aridade 3: alvo unico, `const original = readFileSync(ALVO)`, e a
// suite INLINE no `execSync` em vez de numa constante -- as duas formas que
// `suiteDaTupla` tem de aceitar, uma em cada fixture.
const ANTES_3 = `// CONTROLE NEGATIVO de alguma coisa -- HMO-000.
//
// POR QUE ESTE RUNNER EXISTE
// --------------------------
// Para o controle negativo do conferidor da conversao, na aridade 3.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVO = "lib/exemplo.ts";
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  [
    "o primeiro mutante",
    "const a = 1;",
    "const a = 2;",
  ],
  [
    "o segundo mutante",
    "const b = somar(x, y);",
    "const b = somar(y, x);",
  ],
];

let sobreviventes = 0;

for (const [nome, de, para] of mutantes) {
  if (!original.includes(de)) {
    sobreviventes++;
    continue;
  }
  writeFileSync(ALVO, original.replace(de, para));
  let vermelho = false;
  try {
    execSync("npm run test:exemplo-puro", { stdio: "pipe" });
  } catch {
    vermelho = true;
  }
  console.log(\`\${vermelho ? "OK  " : "VIVO"} \${nome}\`);
  if (!vermelho) sobreviventes++;
}

writeFileSync(ALVO, original);
process.exit(sobreviventes === 0 ? 0 : 1);
`;

const QUANTOS_4 = 3;

// ---------------------------------------------------------------------------
// PARTE 1 -- CONTROLE POSITIVO: os dois fixtures convertem limpo
// ---------------------------------------------------------------------------
function abortar(...linhas) {
  for (const l of linhas) console.error(l);
  process.exit(1);
}

for (const [rotulo, fonte, aridade] of [
  ["aridade 3", ANTES_3, 3],
  ["aridade 4", ANTES_4, 4],
]) {
  if (familiaDe(fonte) !== "tupla") {
    abortar(`ABORTADO: o fixture de ${rotulo} nao e reconhecido como tupla.`);
  }
  let convertido;
  try {
    convertido = converterTupla(fonte, "fixture");
  } catch (e) {
    abortar(`ABORTADO: o fixture de ${rotulo} nao converteu: ${e.message}`);
  }
  const problemas = conferir(fonte, convertido);
  if (problemas.length > 0) {
    abortar(
      `ABORTADO: o fixture de ${rotulo} nao confere limpo.`,
      ...problemas.map((p) => `  ${p}`),
      "Todo cenario abaixo 'reprovaria' pelo motivo errado.",
    );
  }
  // A ARIDADE CHEGOU AO DRIVER. `conferir` nao mede isto -- ele compara MIOLO, e
  // o miolo e o mesmo nas duas aridades. Um driver que desempacota a tupla
  // errada confere OK e mede zero (ver `elementosDaPrimeiraEntrada`).
  const esperado =
    aridade === 4
      ? "for (const [alvo, nome, de, para] of mutantes) {"
      : "for (const [nome, de, para] of mutantes) {";
  if (!convertido.includes(esperado)) {
    abortar(`ABORTADO: o driver de ${rotulo} nao desempacota \`${esperado}\`.`);
  }
  // E as declaracoes mortas sairam de verdade. Sem isto o controle positivo
  // passaria com um conversor que nao remove nada: elas nao mudam o miolo
  // comparado (os dois lados o leem igual), so deixam codigo morto que roda
  // `npm run` de verdade se alguem o chamar.
  for (const morta of ["const fontes = new Map(", "function suiteVermelha(", "npm run test:"]) {
    const corpo = convertido.slice(convertido.indexOf("\nimport "));
    if (corpo.includes(morta)) {
      abortar(`ABORTADO: \`${morta}\` sobreviveu a conversao de ${rotulo} (codigo morto).`);
    }
  }
}

const CONVERTIDO = converterTupla(ANTES_4, "fixture");

if (CONVERTIDO.includes("git checkout")) {
  abortar("ABORTADO: o paragrafo morto do `git checkout` sobreviveu a poda.");
}
if (!CONVERTIDO.includes("POR QUE ESTE RUNNER EXISTE")) {
  abortar("ABORTADO: a poda levou a secao VIVA junto.");
}
console.log(`parte 1: os fixtures de aridade 3 e 4 convertem e conferem limpo\n`);

// ---------------------------------------------------------------------------
// PARTE 2 -- OS CENARIOS: cada conversao ruim tem de ser ACUSADA
// ---------------------------------------------------------------------------
// O `espera` casa a MENSAGEM, e nao so "deu algum problema": sem isso um cenario
// passa pela trava do cenario vizinho e nenhum dos dois esta medido.
const cenarios = [
  {
    nome: "um mutante apagado da lista",
    estraga: (t) => t.replace(/ {2}\[\n {4}LIB,\n {4}"o segundo mutante",[\s\S]*?\n {2,6}\],\n/, ""),
    espera: /3 mutantes antes, 2 depois/,
  },
  {
    nome: "a lista inteira apagada",
    estraga: (t) => t.replace(/const mutantes = \[[\s\S]*?\n\];/, "const mutantes = [];"),
    espera: /3 mutantes antes, 0 depois/,
  },
  {
    nome: "o `de` de um mutante reescrito (a lista 'parece' inteira)",
    estraga: (t) => t.replace('"const a = 1;"', '"const a = 999;"'),
    espera: /miolo diferente/,
  },
  {
    nome: "o `para` de um mutante reescrito",
    estraga: (t) => t.replace('"const a = 2;"', '"const a = 3;"'),
    espera: /miolo diferente/,
  },
  {
    nome: "o rotulo de um mutante reescrito",
    estraga: (t) => t.replace('"o terceiro mutante, na tela"', '"o terceiro mutante"'),
    espera: /miolo diferente/,
  },
  {
    nome: "o comentario DENTRO de uma entrada apagado",
    estraga: (t) =>
      t.replace("    // O primeiro, com comentario -- que tambem tem de vir intacto.\n", ""),
    espera: /miolo diferente/,
  },
  {
    nome: "uma constante de arquivo apagada",
    estraga: (t) => t.replace('const TELA = "components/Exemplo.tsx";\n', ""),
    espera: /miolo diferente/,
  },
  {
    // ESPECIFICO DA ARIDADE 4, e o unico defeito desta lista que nao existe na
    // familia do painel: trocar o ALVO de uma entrada move o mutante de arquivo
    // sem mudar mais nada. O rotulo continua descrevendo o arquivo antigo.
    nome: "o ALVO de uma entrada trocado (o mutante muda de arquivo)",
    estraga: (t) => t.replace('    TELA,\n    "o terceiro mutante, na tela",', '    LIB,\n    "o terceiro mutante, na tela",'),
    espera: /miolo diferente/,
  },
  {
    nome: "as ancoras do driver somem (o miolo nao se acha)",
    estraga: (t) => t.replace("\nconst SUITE = ", "\nconst OUTRA_COISA = "),
    espera: /nao achei o miolo/,
  },
  {
    nome: "o miolo colapsa mas a CONTAGEM se mantem (o piso)",
    // Cada entrada fica so com o rotulo, entao `[` na coluna 2 continua
    // aparecendo tres vezes e a trava de contagem NAO dispara. Quem pega e o
    // piso de tamanho -- ou o `a !== b`, e os dois contam como acusacao certa.
    estraga: (t) =>
      t.replace(/const mutantes = \[[\s\S]*?\n\];/, () =>
        [
          "const mutantes = [",
          ...["um", "dois", "tres"].map((n) => `  [\n    "${n}",\n  ],`),
          "];",
        ].join("\n"),
      ),
    espera: /miolo (diferente|curto demais)/,
  },
];

for (const c of cenarios) {
  const estragado = c.estraga(CONVERTIDO);
  if (estragado === CONVERTIDO) {
    console.error(`SOBREVIVEU (o cenario nao mudou nada) :: ${c.nome}`);
    falhas++;
    continue;
  }
  const problemas = conferir(ANTES_4, estragado);
  if (problemas.length === 0) {
    console.error(`SOBREVIVEU :: ${c.nome}`);
    console.error("  o conferidor disse OK para uma conversao estragada");
    falhas++;
  } else if (!problemas.some((p) => c.espera.test(p))) {
    console.error(`ACUSOU ERRADO :: ${c.nome}`);
    console.error(`  esperava ${c.espera}, veio: ${problemas.join("; ")}`);
    falhas++;
  } else {
    console.log(`acusado    :: ${c.nome}`);
  }
}

// ---------------------------------------------------------------------------
// PARTE 3 -- O CONVERSOR MUTADO: os dois lados errados do mesmo jeito
// ---------------------------------------------------------------------------
// Aqui o texto convertido nao e estragado a mao. Quem e mutado e o CONVERSOR, e
// e a unica forma de medir as travas que existem contra o conferidor VACUO: um
// extrator quebrado trunca os dois lados igual, `a === b` continua verdade, e
// quem tem de acusar e a contagem lida do TEXTO FINAL.
//
// Os dois grupos abaixo provam coisas DIFERENTES e estao separados por isso:
//
//   - `vacuo`: o conversor mutado produz uma conversao RUIM, e o conferidor tem
//     de acusar mesmo com os dois lados iguais;
//   - `falso-alarme`: o conversor mutado produz a conversao CERTA, e o
//     conferidor tem de acusar porque a TRAVA foi trocada pela da outra familia.
//     Nao e o furo da HMO-318 -- e a prova de que a trava e load-bearing: se o
//     conferidor ficasse calado com a contagem errada, ela nao estaria medindo.
const MUTACOES_DO_CONVERSOR = [
  {
    tipo: "vacuo",
    // O TRUNCAMENTO PARA DEPOIS DA PRIMEIRA ENTRADA, e nao logo depois de
    // `const mutantes = [`. A diferenca e o que este cenario mede.
    //
    // Cortar na abertura da lista tambem e acusado, mas por
    // `elementosDaPrimeiraEntrada`, que LANCA antes de o conferidor rodar --
    // entao a trava que este cenario existe para medir (a contagem lida do
    // TEXTO FINAL, a que pegou o furo da HMO-318) nunca seria exercitada. E o
    // caso canonico barrado por outra guarda na frente. Deixando a primeira
    // entrada inteira, o conversor passa, o arquivo convertido nasce com UM
    // mutante em vez de tres, os dois lados leem o mesmo miolo truncado
    // (`a === b`), e so a contagem do texto final tem como acusar.
    nome: "o recorte do miolo trunca depois da PRIMEIRA entrada",
    de: "let miolo = fonte.slice(constantes[0].index, fimDaLista(fonte, mLista.index));",
    para:
      "let miolo = fonte.slice(constantes[0].index, " +
      'fonte.indexOf("\\n    ],", mLista.index) + 7) + "\\n];";',
    espera: /3 mutantes antes, 1 depois/,
  },
  {
    tipo: "vacuo",
    nome: "o recorte do miolo comeca DEPOIS das constantes de arquivo",
    de: "let miolo = fonte.slice(constantes[0].index, fimDaLista(fonte, mLista.index));",
    para: "let miolo = fonte.slice(mLista.index, fimDaLista(fonte, mLista.index));",
    espera: /nao achei o miolo|miolo diferente/,
  },
  {
    tipo: "falso-alarme",
    // A CONTAGEM DA FAMILIA ERRADA. `^    nome: ` e zero numa lista de tuplas,
    // nos DOIS lados -- entao a trava de divergencia (`antesN !== depoisN`) e o
    // piso (`100 * depoisN`) somem juntos, e sobra `a !== b`: o conferidor de
    // UMA trava que a HMO-318 provou insuficiente. Quem acusa e a trava 3.
    nome: "`contar` da tupla trocado pela contagem de OBJETO (`nome:`)",
    de: 'contar: (t) => (t.match(/^ {2}\\[$/gm) ?? []).length,',
    para: 'contar: (t) => (t.match(/^ {4}nome: /gm) ?? []).length,',
    espera: /nao tinha mutante nenhum/,
  },
  {
    tipo: "falso-alarme",
    // A INDENTACAO RIGIDA DO FECHO, onde ela de fato decide algo.
    //
    // O fixture fecha a PRIMEIRA entrada com quatro espacos em vez de dois --
    // como `mutantes-lancamentos-completos` faz de verdade na linha 138. Com o
    // fecho rigido, `primeiraEntradaDaLista` nao acha o fim da entrada e o
    // conversor se recusa a converter um runner PERFEITAMENTE BOM.
    //
    // (Com a regex solta que esta funcao tinha antes, esta mutacao SOBREVIVIA: o
    // `/m` e o quantificador preguicoso pulavam a entrada malformatada e casavam
    // a SEGUNDA, devolvendo a aridade certa pelo caminho errado. Foi este
    // cenario que achou isso.)
    //
    // (Esta mutacao existe aqui, e nao em `entradas`, porque em `entradas` a
    // indentacao nao muda veredito nenhum: `conferir` compara `entradas(a)` com
    // `entradas(b)`, e os dois lados leem o mesmo texto -- um fecho rigido conta
    // errado igual nos dois e nada divergiria. Quem precisa da forma frouxa e
    // quem le a lista para DECIDIR, nao quem a conta dos dois lados.)
    nome: "a leitura da 1a entrada exige o fecho com DOIS espacos exatos",
    de: "  const m = /^ {2}\\[\\n((?: {4}.*\\n)+?) {2,6}\\],?$/m.exec(daLista.slice(abre.index));",
    para: "  const m = /^ {2}\\[\\n((?: {4}.*\\n)+?) {2}\\],?$/m.exec(daLista.slice(abre.index));",
    lanca: /nao consegui ler a primeira entrada/,
  },
  {
    tipo: "falso-alarme",
    // A ARIDADE. `aridadeDaTupla` fixada em 3 gera, para o fixture de 4, um
    // driver que desempacota `[nome, de, para]` de entradas com quatro
    // elementos: `nome` recebe `LIB`, `de` recebe o rotulo, e todo mutante
    // "morre" por ancora inexistente -- placar cheio, zero medido. `conferir`
    // NAO ve isso (o miolo e o mesmo), e por isso o cruzamento esta no
    // conversor: ele tem de LANCAR.
    nome: "`aridadeDaTupla` fixada em 3 (o driver desempacota a tupla errada)",
    de: "  return temFontes ? 4 : 3;",
    para: "  return 3;",
    lanca: /aridade 3 mas a 1a entrada tem 4 elementos/,
  },
];

const fonteDoConversor = readFileSync(CONVERSOR, "utf8");
const sombra = mkdtempSync(path.join(tmpdir(), "conferidor-tupla-"));
process.on("exit", () => rmSync(sombra, { recursive: true, force: true }));
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

for (const m of MUTACOES_DO_CONVERSOR) {
  const ocorrencias = fonteDoConversor.split(m.de).length - 1;
  if (ocorrencias !== 1) {
    console.error(`SOBREVIVEU (ancora ${ocorrencias === 0 ? "morta" : "ambigua"}) :: ${m.nome}`);
    console.error(`  o trecho aparece ${ocorrencias}x no conversor: ${m.de}`);
    falhas++;
    continue;
  }

  const copia = path.join(sombra, `conversor-${MUTACOES_DO_CONVERSOR.indexOf(m)}.mjs`);
  writeFileSync(copia, fonteDoConversor.replace(m.de, m.para));
  const mutado = await import(`file://${copia}`);

  // A MUTACAO QUE TEM DE LANCAR: o estrago nao chega ao conferidor, porque o
  // conversor se recusa a escrever o arquivo errado.
  if (m.lanca) {
    let erro = null;
    try {
      mutado.converterTupla(ANTES_4, "fixture");
    } catch (e) {
      erro = e;
    }
    if (!erro) {
      console.error(`SOBREVIVEU :: ${m.nome}`);
      console.error("  o conversor produziu o arquivo errado sem reclamar");
      falhas++;
    } else if (!m.lanca.test(erro.message)) {
      console.error(`ACUSOU ERRADO :: ${m.nome}`);
      console.error(`  esperava ${m.lanca}, veio: ${erro.message}`);
      falhas++;
    } else {
      console.log(`acusado    :: ${m.nome}`);
      console.log(`             (lancou: ${erro.message})`);
    }
    continue;
  }

  // A conversao e a conferencia AMBAS pelo conversor mutado -- e esse o ponto:
  // os dois lados compartilham a leitura quebrada.
  let problemas;
  try {
    problemas = mutado.conferir(ANTES_4, mutado.converterTupla(ANTES_4, "fixture"));
  } catch (e) {
    // Lancar tambem e acusar, desde que a mensagem diga do que se trata.
    problemas = [e.message];
  }

  if (problemas.length === 0) {
    console.error(`SOBREVIVEU :: ${m.nome}`);
    console.error(
      m.tipo === "vacuo"
        ? "  o conferidor disse OK comparando duas leituras igualmente quebradas"
        : "  o conferidor ficou calado com a trava trocada -- ela nao mede nada",
    );
    falhas++;
  } else if (!m.espera.test(problemas.join("; "))) {
    console.error(`ACUSOU ERRADO :: ${m.nome}`);
    console.error(`  esperava ${m.espera}, veio: ${problemas.join("; ")}`);
    falhas++;
  } else {
    console.log(`acusado    :: ${m.nome}`);
    console.log(`             (${problemas[0]})`);
  }
}

console.log();
if (falhas === 0) {
  console.log(`todos os ${cenarios.length + MUTACOES_DO_CONVERSOR.length} cenarios foram acusados`);
} else {
  console.log(`${falhas} cenario(s) passou/passaram sem ser acusado(s)`);
  process.exit(1);
}
