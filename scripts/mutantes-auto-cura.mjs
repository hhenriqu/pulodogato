#!/usr/bin/env node
// Os mutantes da auto-cura (HMO-326): a suite `test:auto-cura` sabe reprovar?
//
// POR QUE
// -------
// `test:auto-cura` ficou verde na primeira execucao, e verde de primeira nao
// prova nada -- neste repositorio ja houve `10/10 mutantes mortos` ficticio
// sobrevivendo a um run inteiro. Pior aqui do que em outros lugares: a suite
// mede uma AUSENCIA de sujeira, e os dois primeiros testes dela passariam
// identicos se `protegerArvore` fosse um `return` vazio, porque o fixture
// restaura no caminho normal. E justamente por isso que a suite tem os dois
// controles negativos -- e e este runner que prova que os quatro testes
// dependem do codigo da cura, peneira por peneira.
//
// A ARVORE DE PRODUCAO NUNCA E TOCADA
// -----------------------------------
// E teria sido ironico: um runner que planta mutante na arvore ao medir o
// modulo que existe para despoluir a arvore de mutantes plantados.
//
// A medicao roda num REPOSITORIO GIT NOVO em diretorio temporario, com as
// quatro pecas copiadas para dentro. Precisa ser um git de verdade, e nao uma
// arvore qualquer, porque a suite afirma sobre `git status` -- e esse e o
// criterio de aceite da issue, nao um detalhe. O pior caso de uma interrupcao
// aqui e um diretorio orfao em /tmp.
//
// Nao se usa `criarBlocoDeMutantes` por este motivo: a sombra dele exclui
// `.git` de proposito, entao as assercoes de `git status` da suite nao teriam
// repositorio para consultar.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const ALVO = "scripts/auto-cura-de-mutante.mjs";

/** As quatro pecas: o alvo, o fixture, o texto mutado pelo fixture, e a suite. */
const PECAS = [
  ALVO,
  "scripts/fixture-runner-de-auto-cura.mjs",
  "scripts/fixture-auto-cura.txt",
  "scripts/test-auto-cura-de-mutante.mjs",
];

const MUTACOES = [
  {
    nome: "sem_curar",
    porque: "a partida nao desfaz o que o run morto deixou: o mutante atravessa o run",
    de: "    curar(runner);",
    para: "    void runner;",
  },
  {
    nome: "sem_travar",
    porque: "sem lock, a segunda copia mede junto e a medicao nao vale",
    de: "    travar(runner);",
    para: "    void runner;",
  },
  {
    nome: "cura_ao_contrario",
    porque: "a cura so age no arquivo que JA esta igual ao original -- ou seja, nunca",
    de: "    if (agora === original) continue;",
    para: "    if (agora !== original) continue;",
  },
  {
    nome: "recusa_sai_zero",
    porque: "a segunda copia avisa e segue em frente: o chamador le sucesso",
    de: "      process.exit(9);",
    para: "      process.exit(0);",
  },
  {
    nome: "dono_sempre_morto",
    porque: "o lock de um processo VIVO e tratado como velho e assumido",
    de: "    process.kill(pid, 0);",
    para: '    throw new Error("finge que morreu");',
  },
  {
    nome: "cura_calada",
    porque: "restaura, mas nao diz -- a causa fica invisivel, que era metade do defeito",
    de: "      `auto-cura: um run morto deixou ${restaurados.length} arquivo(s) mutado(s) -- RESTAURADO: ${restaurados.join(\", \")}`,",
    para: "      `auto-cura: tudo em ordem`,",
  },
  {
    nome: "sem_sentinel",
    porque: "nada e gravado, entao a invocacao seguinte nao tem original para devolver",
    de: '    writeFileSync(sentinelDe(runner), JSON.stringify({ runner, pid: process.pid, originais }));',
    para: "    void originais;",
  },
  {
    nome: "descarta_sem_guardar",
    porque: "sobrescreve o texto de quem trabalhou sem guardar copia: um checkout calado",
    de: "      writeFileSync(guardado, agora);",
    para: "      void guardado;",
  },
];

// ---------------------------------------------------------------------------
// O repositorio de medicao
// ---------------------------------------------------------------------------
const dir = mkdtempSync(path.join(tmpdir(), "mutantes-auto-cura-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

const git = (...args) =>
  spawnSync("git", ["-c", "user.email=m@m", "-c", "user.name=medicao", ...args], {
    cwd: dir,
    encoding: "utf8",
  });

mkdirSync(path.join(dir, "scripts"), { recursive: true });
for (const peca of PECAS) cpSync(path.join(RAIZ, peca), path.join(dir, peca));
git("init", "-q");
git("add", "-A");
const commit = git("commit", "-q", "-m", "base");
if (commit.status !== 0) {
  console.error(`nao consegui commitar a base da medicao: ${commit.stderr}`);
  process.exit(1);
}

const fonte = readFileSync(path.join(RAIZ, ALVO), "utf8");
const arquivoNaMedicao = path.join(dir, ALVO);

/** Roda a suite no repositorio de medicao. */
function rodarSuite() {
  const r = spawnSync(process.execPath, ["--test", "scripts/test-auto-cura-de-mutante.mjs"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 180000,
    env: { ...process.env, MUTANTES_SEM_AUTO_CURA: "" },
  });
  const saida = String(r.stdout ?? "") + String(r.stderr ?? "");
  return { verde: r.status === 0, saida };
}

/** Os nomes dos testes que reprovaram, do formato do `node --test`. */
function quemReprovou(saida) {
  const quais = [...saida.matchAll(/✖ (.+?) \(/g)]
    .map((m) => m[1])
    .filter((n) => n !== "failing tests:");
  return [...new Set(quais)].join("; ") || "reprovou sem nomear teste";
}

// ---------------------------------------------------------------------------
// CONTROLE POSITIVO: a arvore intacta tem de ficar verde.
// ---------------------------------------------------------------------------
// E o unico que pega erro no proprio aparelho. Um `rodarSuite` quebrado (git
// sem identidade, peca que faltou copiar, timeout curto) reprova TODO mutante
// e o placar sai "8/8 mortos" sobre zero assercoes executadas -- o resultado
// mais convincente e mais errado que esta medicao poderia imprimir.
writeFileSync(arquivoNaMedicao, fonte);
const positivo = rodarSuite();
if (!positivo.verde) {
  console.error("CONTROLE POSITIVO REPROVOU: a suite nao passa nem com a arvore intacta.");
  console.error("O aparelho de medicao esta quebrado; nenhum placar abaixo valeria.");
  console.error(positivo.saida.slice(-3000));
  process.exit(1);
}
console.log("controle positivo: suite verde com a arvore intacta\n");

// ---------------------------------------------------------------------------
// Os mutantes
// ---------------------------------------------------------------------------
let mortos = 0;
const sobreviventes = [];

for (const m of MUTACOES) {
  // Mutante que nao aplica e o pior resultado possivel: ele conta como morto
  // sem nunca ter existido, e a peneira fica sem medida nenhuma. Para alto.
  if (!fonte.includes(m.de)) {
    console.error(`ANCORA AUSENTE em ${m.nome}: o trecho mudou em ${ALVO}`);
    console.error(`  procurado: ${m.de}`);
    process.exit(9);
  }
  const mutado = fonte.replace(m.de, m.para);
  if (mutado === fonte) {
    console.error(`MUTACAO VAZIA em ${m.nome}: \`de\` e \`para\` produzem o mesmo texto`);
    process.exit(9);
  }
  writeFileSync(arquivoNaMedicao, mutado);

  const { verde, saida } = rodarSuite();
  if (verde) {
    sobreviventes.push(m);
    console.log(`SOBREVIVEU  ${m.nome}`);
    console.log(`            ${m.porque}`);
  } else {
    mortos++;
    console.log(`morto       ${m.nome}  (${quemReprovou(saida)})`);
  }
}

writeFileSync(arquivoNaMedicao, fonte);

console.log(`\n${mortos}/${MUTACOES.length} mutantes mortos`);
if (sobreviventes.length > 0) {
  console.log("\nSobreviventes -- cada um e uma peneira da suite que nao mede nada:");
  for (const m of sobreviventes) console.log(`  - ${m.nome}: ${m.porque}`);
  process.exit(1);
}
