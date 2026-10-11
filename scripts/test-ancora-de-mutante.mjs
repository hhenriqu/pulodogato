#!/usr/bin/env node
// =====================================================
// A GUARDA DE ANCORA SABE REPROVAR? (HMO-262)
// =====================================================
// Roda com:  npm run test:ancora-de-mutante
//
// POR QUE ISTO EXISTE
// -------------------
// `scripts/mede-ancora-ambigua.mjs` passou a REPROVAR ancora morta (`de` com
// zero ocorrencia no arquivo que ele muta). Verde de primeira nao prova nada: a
// guarda le runners por predicado de forma (`ehDoPainel`, `ehTupla`), e um
// predicado que para de casar faz a varredura medir o CONJUNTO VAZIO e imprimir
// um boletim limpo. Este repositorio ja teve placar de mutante ficticio
// sobrevivendo a um run inteiro.
//
// Entao cada um dos tres estados que a guarda recusa ganha aqui um controle
// negativo, e o estado intacto ganha o positivo.
//
// O DEFEITO QUE O CASO 2 REPRESENTA e literalmente a HMO-262: o mutante
// `parcelamento_volta_para_toda_despesa` procurava
// `parcelamento: !editando && ehNoCartao,` e a HMO-254 reescreveu o trecho para
// `parcelamento: !editando && natureza === "card",`. O `sed` parou de casar, a
// suite seguiu rodando sobre o codigo correto, e a checkbox de parcelamento
// ficou meses sem controle negativo nenhum.
//
// POR QUE O FIXTURE E ESCRITO AQUI E NAO E UM RUNNER DE VERDADE
// -------------------------------------------------------------
// Apontar este controle para um runner real amarraria a assercao a uma lista de
// mutantes que muda toda semana -- e um `de` que some por motivo legitimo faria
// ESTE teste ficar vermelho acusando a guarda. O fixture e um runner minimo da
// familia do painel, escrito byte a byte abaixo, com UM mutante cuja ancora eu
// controlo.
//
// Ele tambem nunca entra no censo da guarda: vive em diretorio temporario e e
// passado por ARGUMENTO explicito, que e o modo em que a varredura por
// `readdirSync` nao roda. E a lacuna oposta da que o `APARELHO` fecha la --
// aparelho que se mede a si mesmo.
//
// A ARVORE DE PRODUCAO NUNCA E TOCADA
// -----------------------------------
// Nada aqui escreve no repositorio: o fixture e as quatro variacoes dele moram
// num `mkdtemp`. O pior caso de uma interrupcao e um diretorio orfao em /tmp.

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUARDA = "scripts/mede-ancora-ambigua.mjs";

// A LINHA QUE E A ANCORA. Aparece UMA vez no alvo intacto.
const ANCORA = "  if (saldo < 0) return 0;";

const ALVO_INTACTO = `export function sobra(saldo: number): number {
${ANCORA}
  return saldo;
}
`;

// Runner minimo da familia do painel: `ehDoPainel` exige `const mutantes = [` em
// comeco de linha E uma chave `arquivo: ` com quatro espacos; `mioloDoPainel`
// exige uma `const NOME = "caminho";` antes da lista.
const RUNNER_FIXTURE = `#!/usr/bin/env node
import { readFileSync } from "node:fs";

const ALVO = "lib/exemplo-da-ancora.ts";
const SUITES = ["test:exemplo-da-ancora"];

const mutantes = [
  {
    nome: "guarda_do_saldo_negativo",
    arquivo: ALVO,
    de: ${JSON.stringify(ANCORA)},
    para: "  if (false) return 0;",
  },
];

console.log(readFileSync(ALVO, "utf8").length);
`;

// =====================================================
// OS FIXTURES DA VARREDURA (HMO-389)
// =====================================================
// Os casos 1-6 passam o runner por ARGUMENTO. O defeito da HMO-389 vivia no
// OUTRO modo -- a varredura por `readdirSync` --, e so nele: era um
// `.filter((f) => familiaDoArquivo(f))` que jogava fora, sem imprimir nada,
// todo runner que nao fosse `painel` nem `tupla`. A familia HMO-246 (a de
// `const MUTANTES = [` em caixa alta) nao estava na tabela da guarda, e com ela
// foram 39 dos 73 runners -- incluindo `telas-de-movimentacao` (75 mutantes, o
// maior do repositorio) e `realizado-do-caixa`.
//
// Por isso estes fixtures vem em TRIO: um runner de cada familia. Um fixture so
// nao distingue "a guarda le as tres" de "a guarda le a minha e descarta as
// outras duas em silencio" -- que e exatamente o estado que passou meses.

const RUNNER_TUPLA = `#!/usr/bin/env node
const ALVO = "lib/exemplo-da-ancora.ts";

const mutantes = [
  [
    "tupla_guarda_do_saldo",
    ${JSON.stringify(ANCORA)},
    "  if (false) return 0;",
  ],
];

console.log(mutantes.length);
`;

// A familia HMO-246: `const FONTE` e a lista em CAIXA ALTA. O `const ALVO`
// derivado e o `const original` entram de proposito -- sao as declaracoes que
// chamam funcao (`join`, `readFileSync`) e que faziam o miolo ESTOURAR no
// import antes de `mioloDoHmo246` passar a remove-las. Sem elas aqui, o fixture
// nao exercitaria o pedaco do conserto que mais custou a achar.
const RUNNER_HMO246 = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FONTE = "lib/exemplo-da-ancora.ts";
const ALVO = join(RAIZ, FONTE);
const SUITE = "test:exemplo-da-ancora";
const original = readFileSync(ALVO, "utf8");

const MUTANTES = [
  {
    nome: "hmo246_guarda_do_saldo",
    de: ${JSON.stringify(ANCORA)},
    para: "  if (false) return 0;",
  },
];

console.log(MUTANTES.length, original.length, SUITE);
`;

// FORMA QUE NENHUM PREDICADO RECONHECE: a lista se chama `MUTACOES`. E a forma
// real de `mutantes-transferencia.mjs` e `mutantes-transferencia-recorrente-app.mjs`,
// dois dos 39 calados.
const RUNNER_SEM_FAMILIA = `#!/usr/bin/env node
const ALVO = "lib/exemplo-da-ancora.ts";

const MUTACOES = [
  {
    nome: "forma_que_a_guarda_nao_le",
    de: ${JSON.stringify(ANCORA)},
    para: "  if (false) return 0;",
  },
];

console.log(MUTACOES.length);
`;

const raizTmp = mkdtempSync(path.join(tmpdir(), "ancora-de-mutante-"));

/**
 * Uma arvore para a VARREDURA (sem argumento): um runner de cada familia, mais
 * os extras que o caso pedir. `extras` e um objeto `{ nomeDoArquivo: fonte }`.
 */
function arvoreDaVarredura(nome, alvo, extras = {}) {
  const raiz = path.join(raizTmp, nome);
  mkdirSync(path.join(raiz, "scripts"), { recursive: true });
  mkdirSync(path.join(raiz, "lib"), { recursive: true });

  for (const f of [GUARDA, "scripts/converte-mutantes-em-bloco.mjs"]) {
    copyFileSync(path.join(RAIZ, f), path.join(raiz, f));
  }
  const runners = {
    "mutantes-exemplo-da-ancora.mjs": RUNNER_FIXTURE,
    "mutantes-exemplo-da-tupla.mjs": RUNNER_TUPLA,
    "mutantes-exemplo-do-hmo246.mjs": RUNNER_HMO246,
    ...extras,
  };
  for (const [arquivo, fonte] of Object.entries(runners)) {
    writeFileSync(path.join(raiz, "scripts", arquivo), fonte);
  }
  writeFileSync(path.join(raiz, "lib/exemplo-da-ancora.ts"), alvo);

  return raiz;
}

/** Roda a guarda no modo VARREDURA -- sem argumento nenhum. */
function varrer(raiz) {
  const r = spawnSync(process.execPath, [GUARDA], { cwd: raiz, encoding: "utf8" });
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
}

/**
 * Monta uma arvore minima: a guarda, o conversor de onde ela importa os
 * predicados, o runner fixture e o alvo.
 *
 * So isso basta porque a guarda NAO EXECUTA o runner -- ela recorta o miolo
 * (as declaracoes `const`) e o importa como modulo de dados. Os imports do
 * runner nunca precisam resolver.
 */
function arvore(nome, alvo) {
  const raiz = path.join(raizTmp, nome);
  mkdirSync(path.join(raiz, "scripts"), { recursive: true });
  mkdirSync(path.join(raiz, "lib"), { recursive: true });

  for (const f of [GUARDA, "scripts/converte-mutantes-em-bloco.mjs"]) {
    copyFileSync(path.join(RAIZ, f), path.join(raiz, f));
  }
  writeFileSync(path.join(raiz, "scripts/mutantes-exemplo-da-ancora.mjs"), RUNNER_FIXTURE);
  if (alvo !== null) writeFileSync(path.join(raiz, "lib/exemplo-da-ancora.ts"), alvo);

  return raiz;
}

function rodarGuarda(raiz) {
  const r = spawnSync(
    process.execPath,
    [GUARDA, "scripts/mutantes-exemplo-da-ancora.mjs"],
    { cwd: raiz, encoding: "utf8" },
  );
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
}

let falhas = 0;

function afirmar(rotulo, condicao, detalhe) {
  if (condicao) {
    console.log(`  OK    ${rotulo}`);
  } else {
    console.log(`  FALHA ${rotulo}\n        ${detalhe}`);
    falhas++;
  }
}

// =====================================================
// 1. CONTROLE POSITIVO: arvore intacta, a guarda aprova
// =====================================================
// E ele que pega o modo de falha mais perigoso desta familia: se `ehDoPainel`
// deixasse de reconhecer o fixture, a guarda sairia 1 ("nao e de familia nenhuma
// que eu saiba ler") e TODOS os controles negativos abaixo passariam -- vermelho
// pelo motivo errado. Aqui o unico resultado aceitavel e zero.
console.log("1. a arvore intacta passa");
{
  const { codigo, saida } = rodarGuarda(arvore("intacto", ALVO_INTACTO));
  afirmar("sai 0", codigo === 0, `saiu ${codigo}:\n${saida}`);
  afirmar(
    "le o fixture como 1 mutante",
    /1 mutantes/.test(saida),
    `nao contou o mutante:\n${saida}`,
  );
  afirmar(
    "nao acusa ancora morta",
    /0 com ancora MORTA/.test(saida),
    `o placar nao diz 0 mortas:\n${saida}`,
  );
}

// =====================================================
// 2. CONTROLE NEGATIVO: a ancora MORREU (o caso da HMO-262)
// =====================================================
// O rename que a feature faz no ALVO, nao no runner: `saldo` virou `valor`. O
// `de` do mutante passa a casar com nada.
console.log("2. ancora morta reprova (o defeito da HMO-262)");
{
  const renomeado = ALVO_INTACTO.replace("saldo < 0", "valor < 0");
  afirmar(
    "o fixture renomeado realmente perdeu a ancora",
    !renomeado.includes(ANCORA),
    "a mutacao do fixture nao mudou nada -- este caso seria vacuo",
  );

  const { codigo, saida } = rodarGuarda(arvore("morta", renomeado));
  afirmar("sai != 0", codigo !== 0, `saiu ${codigo}, deveria reprovar:\n${saida}`);
  afirmar(
    "diz ancora MORTA",
    /ancora MORTA/.test(saida),
    `nao nomeou o estado:\n${saida}`,
  );
  afirmar(
    "nomeia o mutante desarmado",
    /guarda_do_saldo_negativo/.test(saida),
    `nao disse QUAL mutante parou de aplicar:\n${saida}`,
  );
}

// =====================================================
// 3. CONTROLE NEGATIVO: a ancora ficou AMBIGUA
// =====================================================
// A trava que a HMO-328 instalou. Ela ja existia; o controle negativo dela, nao
// -- e uma trava sem controle negativo e indistinguivel de uma trava apagada.
console.log("3. ancora ambigua reprova");
{
  const duplicado = `${ALVO_INTACTO}\nexport function outra(saldo: number): number {\n${ANCORA}\n  return saldo;\n}\n`;
  const { codigo, saida } = rodarGuarda(arvore("ambigua", duplicado));
  afirmar("sai != 0", codigo !== 0, `saiu ${codigo}, deveria reprovar:\n${saida}`);
  afirmar(
    "diz ancora AMBIGUA com a contagem",
    /ancora AMBIGUA \(2x\)/.test(saida),
    `nao nomeou o estado nem quantas vezes:\n${saida}`,
  );
}

// =====================================================
// 4. CONTROLE NEGATIVO: o arquivo alvo nao existe mais
// =====================================================
console.log("4. arquivo alvo ausente reprova");
{
  const { codigo, saida } = rodarGuarda(arvore("ausente", null));
  afirmar("sai != 0", codigo !== 0, `saiu ${codigo}, deveria reprovar:\n${saida}`);
  afirmar(
    "diz ARQUIVO AUSENTE",
    /ARQUIVO AUSENTE/.test(saida),
    `nao nomeou o estado:\n${saida}`,
  );
}

// =====================================================
// 5. A GUARDA ESTA NO pre-commit
// =====================================================
// Uma guarda que ninguem invoca e exatamente o estado em que o
// `mede-ancora-ambigua.mjs` passou a HMO-328 inteira: ele media, ninguem o
// rodava. Esta assercao le o CAMPO do package.json ja parseado -- nao o texto do
// arquivo --, entao ela nao pode ser satisfeita por mencao em comentario.
console.log("5. o pre-commit roda a guarda");
{
  const pkg = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8"));
  afirmar(
    "existe o alvo npm check-ancora-de-mutante",
    pkg.scripts?.["check-ancora-de-mutante"]?.includes("mede-ancora-ambigua.mjs"),
    `o alvo npm nao aponta para a guarda: ${pkg.scripts?.["check-ancora-de-mutante"]}`,
  );
  afirmar(
    "o pre-commit o invoca",
    /(^|&&\s*)npm run check-ancora-de-mutante(\s|$|&)/.test(pkg.scripts?.["pre-commit"] ?? ""),
    `pre-commit nao chama a guarda: ${pkg.scripts?.["pre-commit"]}`,
  );
}

// =====================================================
// 6. O MODO POR ARGUMENTO NAO REESCREVE O RUNNER
// =====================================================
// O driver de linha de comando de `converte-mutantes-em-bloco.mjs` disparava por
// "tem argumento" em vez de "eu sou o programa". Como `process.argv` e do
// PROCESSO, passar um runner para a guarda fazia o CONVERSOR reescrever esse
// runner em disco -- e a medicao pedida nunca rodava, porque o `process.exit`
// dele matava o processo primeiro. Medido na main (d995511):
//
//     convertido  scripts/mutantes-parte-do-grupo.mjs  (familia tupla)
//
// Este caso e o unico lugar do repositorio que exercita o modo por argumento com
// um arquivo que ele pode estragar, entao e aqui que a regressao tem de doer.
console.log("6. o modo por argumento nao reescreve o runner em disco");
{
  const raiz = arvore("sem-reescrita", ALVO_INTACTO);
  const runner = path.join(raiz, "scripts/mutantes-exemplo-da-ancora.mjs");
  const antes = readFileSync(runner, "utf8");

  const { codigo, saida } = rodarGuarda(raiz);

  afirmar(
    "o runner no disco esta byte a byte igual",
    readFileSync(runner, "utf8") === antes,
    "o conversor reescreveu o runner -- o driver dele voltou a disparar por argumento",
  );
  afirmar(
    "a medicao rodou de verdade",
    codigo === 0 && /1 mutantes/.test(saida),
    `a guarda nao chegou a medir (saiu ${codigo}):\n${saida}`,
  );
  afirmar(
    "o conversor nao se anunciou",
    !/^convertido /m.test(saida),
    `o driver do conversor rodou:\n${saida}`,
  );
}

// =====================================================
// 7. A VARREDURA LE AS TRES FAMILIAS (o lado de COBERTURA da HMO-389)
// =====================================================
// O controle positivo da varredura, e ele precisa olhar o PLACAR POR FAMILIA e
// nao so o exit code: uma guarda que lesse duas das tres familias e descartasse
// a terceira em silencio sairia 0 aqui tambem -- foi literalmente o estado da
// main por meses. O que distingue os dois mundos e o `hmo246:1`.
console.log("7. a varredura le as tres familias e diz quantas de cada");
{
  const { codigo, saida } = varrer(arvoreDaVarredura("tres-familias", ALVO_INTACTO));
  afirmar("sai 0", codigo === 0, `saiu ${codigo}:\n${saida}`);
  afirmar(
    "conta 1 runner de cada familia (painel:1 tupla:1 hmo246:1)",
    /painel:1 tupla:1 hmo246:1/.test(saida),
    `o placar por familia nao viu as tres:\n${saida}`,
  );
  afirmar(
    "mede os 3 mutantes, um por runner",
    /3 mutantes lidos em 3 runners/.test(saida),
    `nao somou os tres:\n${saida}`,
  );
}

// =====================================================
// 8. ANCORA MORTA NUM RUNNER DA FAMILIA HMO-246 REPROVA
// =====================================================
// O caso 2 prova isto na familia do painel. Repetir na HMO-246 nao e redundante:
// era a familia AUSENTE da tabela, e o defeito que a HMO-389 mediu foi
// exatamente este -- `npm run check-ancora-de-mutante` saindo 0 e dizendo
// `0 com ancora MORTA` com sete ancoras quebradas, porque os runners que as
// tinham nunca entravam no censo.
//
// Medido na HMO-389 plantando uma ancora morta em
// `mutantes-telas-de-movimentacao.mjs`, na main (8f5b79c) e com o conserto:
//
//     guarda ANTES:   exit 0   "616 mutantes em 29 runners, 0 com ancora MORTA"
//     guarda DEPOIS:  exit 1   "ancora MORTA  sem_abs  [lib/telas-de-movimentacao.ts]"
console.log("8. ancora morta na familia HMO-246 reprova");
{
  const renomeado = ALVO_INTACTO.replace("saldo < 0", "valor < 0");
  afirmar(
    "o alvo renomeado realmente perdeu a ancora",
    !renomeado.includes(ANCORA),
    "o fixture nao mudou nada -- este caso seria vacuo",
  );

  const { codigo, saida } = varrer(arvoreDaVarredura("hmo246-morta", renomeado));
  afirmar("sai != 0", codigo !== 0, `saiu ${codigo}, deveria reprovar:\n${saida}`);
  afirmar(
    "nomeia o mutante da familia HMO-246",
    /ancora MORTA {2}hmo246_guarda_do_saldo/.test(saida),
    `nao acusou o mutante do runner HMO-246:\n${saida}`,
  );
}

// =====================================================
// 9. RUNNER DE FORMA DESCONHECIDA ABORTA -- NAO E DESCARTADO (a HMO-389)
// =====================================================
// ESTE E O CONTROLE NEGATIVO DO DEFEITO. Na main, o `.filter` tirava o runner de
// forma desconhecida da lista antes do laco, e a varredura seguia e SAIA 0 --
// com um boletim limpo que nao mencionava o arquivo em lugar nenhum. O
// `console.error("nao e de familia nenhuma")` existia dentro do laco e era
// inalcancavel.
//
// A arvore tem as tres familias legiveis DE PROPOSITO: sem elas, a guarda antiga
// sairia 1 de todo modo (pela trava de "familia sem nenhum runner lido") e este
// caso passaria vacuo, sem distinguir o conserto do defeito. Com elas, a guarda
// antiga sai 0 e a consertada sai 1 -- e o que a assercao mede e o NOME do
// arquivo aparecer na saida.
console.log("9. runner de forma desconhecida aborta a varredura (o defeito da HMO-389)");
{
  const raiz = arvoreDaVarredura("sem-familia", ALVO_INTACTO, {
    "mutantes-de-forma-desconhecida.mjs": RUNNER_SEM_FAMILIA,
  });
  const { codigo, saida } = varrer(raiz);

  afirmar("sai != 0", codigo !== 0, `saiu ${codigo}, deveria abortar:\n${saida}`);
  afirmar(
    "nomeia O ARQUIVO que nao soube ler",
    /mutantes-de-forma-desconhecida\.mjs/.test(saida),
    `descartou em silencio -- o nome nao aparece na saida:\n${saida}`,
  );
  afirmar(
    "diz que a familia e que nao foi reconhecida",
    /nao e de familia nenhuma/.test(saida),
    `abortou por outro motivo:\n${saida}`,
  );
}

rmSync(raizTmp, { recursive: true, force: true });

if (falhas > 0) {
  console.error(`\n${falhas} assercao(oes) falharam.`);
  process.exit(1);
}
console.log("\ntodas as assercoes passaram -- a guarda de ancora sabe reprovar.");
