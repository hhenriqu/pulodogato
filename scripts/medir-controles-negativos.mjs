#!/usr/bin/env node
// =====================================================
// PULODOGATO - o placar e o cronometro dos controles negativos
// =====================================================
//   node scripts/medir-controles-negativos.mjs --listar
//   node scripts/medir-controles-negativos.mjs --rodar --json placar.json
//   node scripts/medir-controles-negativos.mjs --rodar --filtro=parcela
//   node scripts/medir-controles-negativos.mjs --comparar antes.json depois.json
//
// POR QUE ISTO EXISTE (HMO-319)
// -----------------------------
// A HMO-263 mediu os blocos de controle negativo em 556s -- o maior item
// isolado de um push -- e registrou o veredito de cada um lado a lado contra
// `origin/main`. Essas duas medidas foram feitas a mao, e o criterio de aceite
// da HMO-319 ("menos da metade do tempo, com os MESMOS vereditos") depende de
// poder refaze-las em qualquer arvore.
//
// A LISTA DE BLOCOS NAO E ESCRITA A MAO, de proposito. Ela sai dos workflows:
// todo step cujo `run` invoca um runner de mutante e um bloco. Uma lista a mao
// envelheceria calada -- runner novo entraria no CI sem entrar na medida, e o
// numero publicado passaria a cobrir menos do que diz cobrir. O custo real e o
// tempo de step do Actions, e e exatamente esse conjunto que este arquivo
// enumera.
//
// O QUE ELE CONFERE ALEM DO TEMPO
// -------------------------------
// Depois de cada bloco ele compara a arvore com a fotografia tirada no inicio.
// Runner de mutante morto antes de restaurar deixa o mutante GRAVADO na fonte,
// e nesse estado o bloco SEGUINTE mede o arquivo errado. Aqui isso vira uma
// linha "deixou a arvore suja" no placar em vez de contaminacao silenciosa --
// e a arvore e restaurada antes do bloco seguinte.
// =====================================================

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import YAML from "yaml";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIR_DE_WORKFLOWS = path.join(RAIZ, ".github", "workflows");

// Um `run:` invoca um runner de mutante de duas formas neste repositorio:
// direto (`node scripts/mutantes-x.mjs`) ou pelo npm (`npm run mutantes:x`).
// As duas contam, e o nome do bloco e o nome do runner nas duas.
const INVOCACAO_DIRETA = /(?:^|\s)(?:node|bash)\s+scripts\/mutantes-([a-z0-9-]+)\.(?:mjs|sh)/;
const INVOCACAO_POR_NPM = /(?:^|\s)npm\s+run\s+mutantes:([a-z0-9-]+)/;

/**
 * Os blocos de controle negativo, lidos dos workflows.
 *
 * Com parser YAML de verdade, e nao por regex de linha: um `run:` de bloco
 * literal (`run: |`) tem o comando em outra linha que o `name:`, e e o `name:`
 * que o Actions cobra como step.
 */
function blocosDosWorkflows() {
  const blocos = [];
  for (const arquivo of readdirSync(DIR_DE_WORKFLOWS).sort()) {
    if (!/\.ya?ml$/.test(arquivo)) continue;
    const doc = YAML.parse(readFileSync(path.join(DIR_DE_WORKFLOWS, arquivo), "utf8"));
    for (const [idDoJob, job] of Object.entries(doc?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        const comando = typeof step?.run === "string" ? step.run : null;
        if (!comando) continue;
        const nome =
          comando.match(INVOCACAO_DIRETA)?.[1] ?? comando.match(INVOCACAO_POR_NPM)?.[1] ?? null;
        if (!nome) continue;
        blocos.push({
          runner: nome,
          workflow: arquivo,
          job: idDoJob,
          step: step.name ?? comando.split("\n")[0],
          comando: comando.trim(),
        });
      }
    }
  }
  return blocos;
}

function fotografarArvore() {
  const r = spawnSync("git", ["status", "--porcelain"], { cwd: RAIZ, encoding: "utf8" });
  return r.stdout ?? "";
}

/**
 * Restaura o que o bloco deixou modificado -- SO com `--restaurar`, e por isso.
 *
 * A primeira versao disto restaurava sempre, e apagou uma edicao minha no meio
 * da propria medicao: `scripts/compila.mjs` passou a aparecer como modificado
 * entre a fotografia e o fim de um bloco de 186s, e o restore nao tem como
 * saber que aquilo era trabalho e nao mutante largado. E a mesma faca que ja
 * cortou neste repositorio tres vezes (o `trap ... EXIT` dos controles
 * negativos, o `git checkout -- app` de um laco de mutacao, o
 * `git checkout <ref> -- .`), agora com um nome novo.
 *
 * Por padrao, portanto, a medicao NAO escreve no worktree: ela PARA e nomeia
 * os arquivos. Parar e o comportamento certo mesmo em CI -- um bloco que deixou
 * mutante na arvore faz o bloco seguinte medir o arquivo errado, e seguir
 * adiante produziria um placar que parece completo e nao vale.
 *
 * `--restaurar` existe para quem roda a medicao numa arvore propria e
 * descartavel, onde o unico conteudo nao commitado possivel e o mutante.
 */
function restaurar(sujos) {
  if (sujos.length === 0) return;
  spawnSync("git", ["checkout", "--", ...sujos], { cwd: RAIZ, encoding: "utf8" });
}

function sujeira(antes, depois) {
  const deAntes = new Set(antes.split("\n"));
  return depois
    .split("\n")
    .filter((linha) => linha.trim() && !deAntes.has(linha))
    .map((linha) => ({ estado: linha.slice(0, 2), caminho: linha.slice(3).trim() }));
}

/**
 * A frase curta que explica o veredito, para o placar caber numa tela.
 *
 * A ordem das tentativas e a ordem em que elas sao informativas: um controle
 * reprovado invalida o placar inteiro daquele bloco e tem de aparecer no lugar
 * do numero (foi assim que um `10/10 mutantes mortos` ficticio sobreviveu a um
 * run inteiro neste repositorio).
 */
function resumirSaida(saida) {
  const linhas = saida.split("\n").map((l) => l.trim()).filter(Boolean);
  const controle = linhas.find((l) => /^CONTROLE( POSITIVO)? (FALHOU|NAO)/i.test(l));
  if (controle) return controle.slice(0, 160);
  const naoAplicou = linhas.find((l) => /^(NAO APLICOU|AMBIGUO|ANCORA AUSENTE)/.test(l));
  if (naoAplicou) return naoAplicou.slice(0, 160);
  const sobreviveu = linhas.filter((l) => /^SOBREVIVEU/.test(l));
  if (sobreviveu.length > 0) {
    return `${sobreviveu.length} sobreviveu(ram): ${sobreviveu
      .map((l) => l.replace(/^SOBREVIVEU:?\s*/, ""))
      .slice(0, 3)
      .join("; ")}`.slice(0, 160);
  }
  const placar = [...saida.matchAll(/(\d+)\/(\d+) mutantes mortos[^\n]*/g)].pop();
  if (placar) return placar[0].slice(0, 160);
  const ultima = linhas[linhas.length - 1];
  return (ultima ?? "sem saida").slice(0, 160);
}

function rodarBloco(bloco, { tempoLimite, podeRestaurar }) {
  const antes = fotografarArvore();
  const inicio = Date.now();
  const r = spawnSync("bash", ["-lc", bloco.comando], {
    cwd: RAIZ,
    encoding: "utf8",
    timeout: tempoLimite,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: process.env.CI ?? "1", FORCE_COLOR: "0" },
  });
  const segundos = (Date.now() - inicio) / 1000;
  const saida = String(r.stdout ?? "") + String(r.stderr ?? "");
  const suja = sujeira(antes, fotografarArvore());
  if (podeRestaurar) restaurar(suja.filter((s) => s.estado.includes("M")).map((s) => s.caminho));

  return {
    ...bloco,
    segundos: Number(segundos.toFixed(1)),
    saida: r.status === 0 ? "ok" : "reprova",
    codigo: r.status,
    sinal: r.signal ?? null,
    porque: resumirSaida(saida),
    sujou: suja.map((s) => `${s.estado} ${s.caminho}`),
    cauda: saida.split("\n").slice(-25).join("\n"),
  };
}

function imprimirPlacar(resultados) {
  const largura = Math.max(...resultados.map((r) => r.runner.length), 7);
  console.log("");
  console.log(`${"runner".padEnd(largura)}  ${"tempo".padStart(7)}  veredito  porque`);
  console.log("-".repeat(largura + 2 + 7 + 2 + 8 + 2 + 40));
  for (const r of resultados) {
    const marca = r.saida === "ok" ? "OK      " : "REPROVA ";
    console.log(
      `${r.runner.padEnd(largura)}  ${`${r.segundos.toFixed(1)}s`.padStart(7)}  ${marca}  ${r.porque}`,
    );
    if (r.sujou.length > 0) {
      console.log(`${" ".repeat(largura)}  ${" ".repeat(7)}  !! deixou a arvore suja: ${r.sujou.join(", ")}`);
    }
  }
  const total = resultados.reduce((s, r) => s + r.segundos, 0);
  const ok = resultados.filter((r) => r.saida === "ok").length;
  console.log("-".repeat(largura + 2 + 7 + 2 + 8 + 2 + 40));
  console.log(
    `${resultados.length} blocos  ${total.toFixed(1)}s (${(total / 60).toFixed(1)} min)  ${ok} OK  ${
      resultados.length - ok
    } REPROVA`,
  );
}

function comparar(caminhoA, caminhoB) {
  const a = JSON.parse(readFileSync(caminhoA, "utf8"));
  const b = JSON.parse(readFileSync(caminhoB, "utf8"));
  const porRunner = (lista) => new Map(lista.resultados.map((r) => [r.runner, r]));
  const mapaA = porRunner(a);
  const mapaB = porRunner(b);
  const runners = [...new Set([...mapaA.keys(), ...mapaB.keys()])].sort();
  const largura = Math.max(...runners.map((r) => r.length), 7);

  console.log(`\nA = ${a.rotulo ?? caminhoA}\nB = ${b.rotulo ?? caminhoB}\n`);
  console.log(
    `${"runner".padEnd(largura)}  ${"A".padStart(8)}  ${"B".padStart(8)}  ${"A".padStart(8)}  ${"B".padStart(8)}  veredito`,
  );
  let divergentes = 0;
  let somaA = 0;
  let somaB = 0;
  for (const nome of runners) {
    const ra = mapaA.get(nome);
    const rb = mapaB.get(nome);
    somaA += ra?.segundos ?? 0;
    somaB += rb?.segundos ?? 0;
    // Passa/reprova NAO e o veredito inteiro. Um bloco que ia 13/13 e passa a
    // 11/11 continua `ok` nos dois lados -- dois mutantes sumiram da lista e o
    // placar nao reclamaria. O criterio de aceite da HMO-319 fala em "os MESMOS
    // vereditos", e o veredito e o placar: as duas coisas tem que casar.
    const mesmoDesfecho = (ra?.saida ?? "ausente") === (rb?.saida ?? "ausente");
    const mesmoPlacar = (ra?.porque ?? "ausente") === (rb?.porque ?? "ausente");
    const igual = mesmoDesfecho && mesmoPlacar;
    if (!igual) divergentes++;
    console.log(
      `${nome.padEnd(largura)}  ${`${(ra?.segundos ?? 0).toFixed(1)}s`.padStart(8)}  ${`${(
        rb?.segundos ?? 0
      ).toFixed(1)}s`.padStart(8)}  ${(ra?.saida ?? "ausente").padStart(8)}  ${(
        rb?.saida ?? "ausente"
      ).padStart(8)}  ${
        igual ? "igual" : mesmoDesfecho ? "** PLACAR DIVERGIU **" : "** DIVERGIU **"
      }`,
    );
    if (!mesmoPlacar) {
      console.log(`${" ".repeat(largura)}  A: ${ra?.porque ?? "ausente"}`);
      console.log(`${" ".repeat(largura)}  B: ${rb?.porque ?? "ausente"}`);
    }
  }
  console.log(
    `\ntotal: ${somaA.toFixed(1)}s -> ${somaB.toFixed(1)}s  (${
      somaA > 0 ? (((somaA - somaB) / somaA) * 100).toFixed(0) : "0"
    }% menos)`,
  );
  console.log(`vereditos divergentes: ${divergentes}`);

  // Divergir e o unico resultado inaceitavel: tempo a mais e so tempo a mais,
  // mas um veredito diferente significa que a medida deixou de ser a mesma.
  process.exit(divergentes === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);

if (argv[0] === "--comparar") {
  if (argv.length !== 3) {
    console.error("uso: --comparar <antes.json> <depois.json>");
    process.exit(1);
  }
  comparar(argv[1], argv[2]);
}

const blocos = blocosDosWorkflows();
const filtro = argv.find((a) => a.startsWith("--filtro="))?.slice("--filtro=".length);
const selecionados = filtro ? blocos.filter((b) => new RegExp(filtro).test(b.runner)) : blocos;

if (argv.includes("--listar") || argv.length === 0) {
  console.log(`${selecionados.length} blocos de controle negativo nos workflows:\n`);
  for (const b of selecionados) {
    console.log(`  ${b.runner.padEnd(26)} ${b.workflow}  ${b.step}`);
  }
  process.exit(0);
}

if (!argv.includes("--rodar")) {
  console.error("uso: --listar | --rodar [--filtro=re] [--json <arquivo>] | --comparar a.json b.json");
  process.exit(1);
}

const rotulo =
  argv.find((a) => a.startsWith("--rotulo="))?.slice("--rotulo=".length) ??
  spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: RAIZ, encoding: "utf8" }).stdout?.trim();
const tempoLimite = Number(argv.find((a) => a.startsWith("--limite="))?.slice("--limite=".length) ?? 600) * 1000;

const podeRestaurar = argv.includes("--restaurar");

const resultados = [];
for (const [i, bloco] of selecionados.entries()) {
  process.stderr.write(`[${i + 1}/${selecionados.length}] ${bloco.runner} ... `);
  const r = rodarBloco(bloco, { tempoLimite, podeRestaurar });
  process.stderr.write(`${r.segundos.toFixed(1)}s ${r.saida}\n`);
  resultados.push(r);

  // Parar aqui, e nao no fim: do bloco seguinte em diante o placar mediria uma
  // arvore que nao e a desta medicao, e um placar assim se le como completo.
  if (r.sujou.length > 0 && !podeRestaurar) {
    imprimirPlacar(resultados);
    console.error(
      `\nO bloco \`${bloco.runner}\` deixou a arvore suja e a medicao parou:\n  ${r.sujou.join(
        "\n  ",
      )}\n\nRestaure a mao (ou rode com --restaurar numa arvore descartavel) antes de seguir.`,
    );
    process.exit(2);
  }
}

imprimirPlacar(resultados);

const destino = argv[argv.indexOf("--json") + 1];
if (argv.includes("--json") && destino) {
  writeFileSync(destino, JSON.stringify({ rotulo, gerado: new Date().toISOString(), resultados }, null, 2));
  console.log(`\nplacar em ${destino}`);
}
