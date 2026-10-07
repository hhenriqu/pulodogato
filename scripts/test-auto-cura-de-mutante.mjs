#!/usr/bin/env node
// Os criterios de aceite da HMO-326, cada um com o seu CONTROLE NEGATIVO.
//
// O que esta suite prova:
//
//   1. Um runner morto com `kill -KILL` no meio de um mutante deixa a arvore
//      suja; a invocacao SEGUINTE do mesmo runner comeca restaurando, e o
//      arquivo volta ao original sem intervencao manual.
//   2. Duas copias simultaneas do mesmo runner no mesmo worktree: a segunda
//      RECUSA em vez de medir.
//   3. Com `MUTANTES_SEM_AUTO_CURA=1`, os dois casos acima REPROVAM -- que e o
//      que impede esta suite de ficar verde sobre uma auto-cura que nao faz
//      nada. Sem o item 3, os dois primeiros testes passariam identicos se
//      `protegerArvore` fosse um `return` vazio: o fixture restaura no caminho
//      normal, e e so o caminho normal que eles exercitariam.
//
// O alvo e `scripts/fixture-auto-cura.txt`, um arquivo RASTREADO -- entao a
// afirmacao "git status volta limpo" e sobre o git de verdade, e nao sobre uma
// copia em /tmp. Nenhum arquivo de producao e tocado.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const ALVO_REL = "scripts/fixture-auto-cura.txt";
const ALVO = path.join(RAIZ, ALVO_REL);
const FIXTURE = path.join(RAIZ, "scripts/fixture-runner-de-auto-cura.mjs");
const CASA = path.join(RAIZ, ".tmp-mutantes");

const ler = () => readFileSync(ALVO, "utf8");
const estaMutado = () => ler().includes("MUTANTE");

/** O que o `git status --short` diz deste arquivo. Vazio = limpo. */
function gitStatusDoAlvo() {
  const r = spawnSync("git", ["status", "--short", "--", ALVO_REL], {
    cwd: RAIZ,
    encoding: "utf8",
  });
  return String(r.stdout ?? "").trim();
}

/**
 * Dispara o fixture e espera a linha `MUTANTE APLICADO`.
 *
 * `detached` para o processo virar lider de grupo: quando a suite o mata com
 * `SIGKILL`, o `sleep` neto morre no mesmo sinal. Sem isto o `sleep` ficaria
 * orfao com PPID 1 -- que e justamente o sintoma que esta issue descreve, e
 * deixa-lo aqui vazaria um processo por teste.
 */
function dispararTravado(env = {}) {
  const filho = spawn(process.execPath, [FIXTURE], {
    cwd: RAIZ,
    detached: true,
    env: { ...process.env, FIXTURE_TRAVA: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let saida = "";
  filho.stdout.on("data", (d) => (saida += d));
  filho.stderr.on("data", (d) => (saida += d));
  return {
    filho,
    pronto: new Promise((resolve, reject) => {
      const prazo = setTimeout(() => reject(new Error(`fixture nao aplicou o mutante: ${saida}`)), 20000);
      const olhar = setInterval(() => {
        if (saida.includes("MUTANTE APLICADO")) {
          clearInterval(olhar);
          clearTimeout(prazo);
          resolve(saida);
        }
      }, 50);
      filho.on("exit", () => {
        if (!saida.includes("MUTANTE APLICADO")) {
          clearInterval(olhar);
          clearTimeout(prazo);
          reject(new Error(`fixture saiu antes de aplicar: ${saida}`));
        }
      });
    }),
  };
}

/** Mata o grupo do processo, como um `timeout` faria -- sem dar chance a gancho. */
function matarGrupo(filho) {
  try {
    process.kill(-filho.pid, "SIGKILL");
  } catch {
    /* ja morreu */
  }
}

/** Roda o fixture ate o fim (sem travar) e devolve o que ele imprimiu. */
function rodarAteOFim(env = {}) {
  const r = spawnSync(process.execPath, [FIXTURE], {
    cwd: RAIZ,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status, saida: String(r.stdout ?? "") + String(r.stderr ?? "") };
}

/** Volta o mundo ao estado limpo entre dois testes. */
function limpar() {
  rmSync(path.join(CASA, "fixture-auto-cura.json"), { force: true });
  rmSync(path.join(CASA, "fixture-auto-cura.lock"), { force: true });
  rmSync(path.join(CASA, "fixture-auto-cura.descartado"), { recursive: true, force: true });
  spawnSync("git", ["checkout", "--", ALVO_REL], { cwd: RAIZ });
}

test("o alvo do fixture comeca limpo e rastreado", () => {
  limpar();
  assert.equal(gitStatusDoAlvo(), "", "o fixture tem de estar commitado e limpo antes de medir");
  assert.ok(ler().includes("ORIGINAL"), "o fixture tem de conter a palavra ORIGINAL");
});

test("ACEITE 1: morto com SIGKILL suja a arvore, e a invocacao seguinte cura", async () => {
  limpar();

  const { filho, pronto } = dispararTravado();
  await pronto;

  // O mutante esta gravado na arvore rastreada, com o processo vivo.
  assert.ok(estaMutado(), "o fixture tinha de ter aplicado o mutante no arquivo");

  matarGrupo(filho);
  await new Promise((r) => filho.on("exit", r));

  // SIGKILL nao roda gancho nenhum: a arvore fica suja. Este e o estado que um
  // run morto deixa, e o que ate aqui atravessava para o run seguinte.
  assert.ok(estaMutado(), "SIGKILL tinha de deixar o mutante gravado");
  assert.notEqual(gitStatusDoAlvo(), "", "o git tinha de ver o arquivo como modificado");
  assert.ok(
    existsSync(path.join(CASA, "fixture-auto-cura.json")),
    "o sentinel tinha de ter sobrevivido ao SIGKILL -- e ele que carrega o original",
  );

  // A invocacao SEGUINTE do mesmo runner, sem intervencao manual nenhuma.
  const { status, saida } = rodarAteOFim();
  assert.equal(status, 0, `a segunda invocacao tinha de rodar: ${saida}`);
  assert.match(saida, /auto-cura:.*RESTAURADO/, "a cura tinha de aparecer no stdout, nao ser calada");
  assert.match(saida, /FIM NORMAL/, "a segunda invocacao tinha de chegar ao fim");

  assert.ok(!estaMutado(), "o arquivo tinha de ter voltado ao original");
  assert.equal(gitStatusDoAlvo(), "", "`git status` tinha de voltar limpo sem intervencao manual");

  // O que foi descartado nao se perde: fica guardado, e o stdout diz onde.
  assert.ok(
    existsSync(path.join(CASA, "fixture-auto-cura.descartado", ALVO_REL)),
    "o texto descartado tinha de ter sido guardado antes de ser sobrescrito",
  );
});

test("ACEITE 2: a segunda copia simultanea RECUSA em vez de medir", async () => {
  limpar();

  const { filho, pronto } = dispararTravado();
  await pronto;

  const segunda = rodarAteOFim();
  assert.equal(segunda.status, 9, `a segunda copia tinha de recusar: ${segunda.saida}`);
  assert.match(segunda.saida, /RECUSADO/, "a recusa tinha de dizer o motivo");
  assert.match(segunda.saida, new RegExp(`pid ${filho.pid}`), "a recusa tinha de nomear o pid do dono");
  assert.doesNotMatch(
    segunda.saida,
    /FIM NORMAL/,
    "a segunda copia nao podia ter medido nada",
  );

  matarGrupo(filho);
  await new Promise((r) => filho.on("exit", r));
  limpar();
});

test("CONTROLE NEGATIVO: com a cura desligada, o ACEITE 1 reprova", async () => {
  limpar();
  const semCura = { MUTANTES_SEM_AUTO_CURA: "1" };

  const { filho, pronto } = dispararTravado(semCura);
  await pronto;
  matarGrupo(filho);
  await new Promise((r) => filho.on("exit", r));

  assert.ok(estaMutado(), "o mutante tinha de ficar gravado");
  assert.ok(
    !existsSync(path.join(CASA, "fixture-auto-cura.json")),
    "com a cura desligada nao existe sentinel para a invocacao seguinte ler",
  );

  // A invocacao seguinte NAO cura. Pior: ela adota o mutante como "original",
  // mede contra ele e o devolve ao disco no fim -- a arvore continua suja, e
  // nada no placar diz por que.
  const { saida } = rodarAteOFim(semCura);
  assert.doesNotMatch(saida, /auto-cura/, "desligada, a cura nao podia nem falar");
  assert.ok(estaMutado(), "desligada, a arvore tinha de CONTINUAR suja -- o criterio 1 reprova");
  assert.notEqual(gitStatusDoAlvo(), "", "desligada, o `git status` tinha de continuar sujo");

  limpar();
});

test("CONTROLE NEGATIVO: com a cura desligada, o ACEITE 2 reprova", async () => {
  limpar();
  const semCura = { MUTANTES_SEM_AUTO_CURA: "1" };

  const { filho, pronto } = dispararTravado(semCura);
  await pronto;

  // Sem lock, a segunda copia MEDE junto com a primeira: as duas restauram "o
  // original" a partir de duas copias em memoria, e foi isso que invalidou a
  // primeira medicao da HMO-321.
  const segunda = rodarAteOFim(semCura);
  assert.notEqual(segunda.status, 9, "desligada, nao podia haver recusa -- o criterio 2 reprova");
  assert.doesNotMatch(segunda.saida, /RECUSADO/, "desligada, nao existe lock para recusar");
  assert.match(segunda.saida, /FIM NORMAL/, "desligada, a segunda copia mediu junto com a primeira");

  matarGrupo(filho);
  await new Promise((r) => filho.on("exit", r));
  limpar();

  // A arvore so volta ao original aqui porque o `limpar()` fez `git checkout`
  // -- exatamente a "intervencao manual" que o criterio de aceite proibe.
  assert.ok(!estaMutado());
});
