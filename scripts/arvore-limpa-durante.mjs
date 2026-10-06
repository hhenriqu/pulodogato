#!/usr/bin/env node
// =====================================================
// PULODOGATO - a arvore ficou limpa DURANTE o comando? (HMO-323)
// =====================================================
//   node scripts/arvore-limpa-durante.mjs npm run mutantes:fatura-escolhida -- --so-typescript
//   node scripts/arvore-limpa-durante.mjs --intervalo=50 node scripts/mutantes-moeda.mjs
//
// POR QUE ISTO EXISTE
// -------------------
// Um runner de mutante que muta a fonte no disco e restaura depois deixa a
// arvore limpa no fim -- e e exatamente por isso que conferir no fim nao prova
// nada. `finally` e `process.on("exit")` NAO rodam em SIGTERM, que e o sinal que
// o `timeout` do shell e o cancelamento de job do Actions mandam. O
// `mutantes-moeda` deixou `lib/moeda.ts` mutado com um `.bak` ao lado no meio da
// medicao da HMO-319 desse jeito, e o bloco seguinte mediu o arquivo errado.
//
// `medir-controles-negativos.mjs` ja compara a arvore ANTES e DEPOIS de cada
// bloco. Isso pega o runner que morreu; nao pega o runner que viveu. A pergunta
// que falta e outra: enquanto ele roda, existe algum instante em que um
// `git status` mostraria mutante na arvore? Se existe, existe uma janela em que
// um kill deixa a mutacao commitavel.
//
// A SONDA QUE NUNCA VIU NADA NAO VALE NADA
// -----------------------------------------
// Uma sonda que so sabe dizer "nao vi sujeira" fica verde tambem quando ela
// esta quebrada -- `git status` com o cwd errado, filtro que descarta tudo,
// laco que nunca roda. Por isso o PRIMEIRO passo e um CONTROLE POSITIVO DA
// PROPRIA SONDA: este script suja a arvore de proposito (um arquivo nao
// rastreado na raiz), por uma janela curta, e EXIGE ter visto. Se nao viu, sai
// com erro e nao chega a rodar o comando: o veredito "limpo" seria vacuo.
//
// O QUE ELE NAO PROVA
// -------------------
// Amostragem e amostragem. Uma janela de sujeira mais curta que o intervalo
// pode passar entre dois ticks. Ele prova que a janela e MENOR que o intervalo,
// nao que ela nao existe -- e e por isso que o controle positivo acima tambem
// mede com uma janela curta, para o numero nao ser so otimismo. A prova forte
// continua sendo estrutural (mutar em diretorio temporario, nunca na arvore);
// esta sonda e o que confere que a estrutura e o que o codigo diz que e.
// =====================================================

import { spawn, spawnSync } from "node:child_process";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const argv = process.argv.slice(2);
const intervalo = Number(argv.find((a) => a.startsWith("--intervalo="))?.slice("--intervalo=".length) ?? 100);
const comando = argv.filter((a) => !a.startsWith("--intervalo="));

if (comando.length === 0) {
  console.error("uso: node scripts/arvore-limpa-durante.mjs [--intervalo=ms] <comando...>");
  process.exit(2);
}

/** As linhas do `git status --porcelain`, como conjunto. */
function fotografar() {
  const r = spawnSync("git", ["status", "--porcelain"], {
    cwd: RAIZ,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return new Set(String(r.stdout ?? "").split("\n").filter((l) => l.trim()));
}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Roda `fn` enquanto fotografa a arvore a cada `intervalo`, e devolve as linhas
 * que apareceram e nao estavam na fotografia inicial.
 *
 * A fotografia inicial e a referencia, e nao "vazio": uma arvore com trabalho
 * nao commitado e o caso normal de quem roda isto a mao, e so o que o COMANDO
 * acrescentou e sujeira dele.
 */
async function vigiar(fn) {
  const base = fotografar();
  const vistas = new Map();
  let rodando = true;

  const laco = (async () => {
    while (rodando) {
      for (const linha of fotografar()) {
        if (!base.has(linha) && !vistas.has(linha)) vistas.set(linha, Date.now());
      }
      await esperar(intervalo);
    }
  })();

  try {
    return { resultado: await fn(), vistas: [...vistas.keys()] };
  } finally {
    rodando = false;
    await laco;
  }
}

// ---------------------------------------------------------------------------
// CONTROLE POSITIVO DA SONDA: ela enxerga sujeira que existiu e sumiu?
// ---------------------------------------------------------------------------
const ISCA = ".prova-de-sonda-da-arvore";
const caminhoDaIsca = path.join(RAIZ, ISCA);

const controle = await vigiar(async () => {
  writeFileSync(caminhoDaIsca, "HMO-323: isca do controle positivo da sonda\n");
  await esperar(Math.max(intervalo * 4, 400));
  unlinkSync(caminhoDaIsca);
  await esperar(intervalo);
});

if (existsSync(caminhoDaIsca)) unlinkSync(caminhoDaIsca);

if (!controle.vistas.some((l) => l.includes(ISCA))) {
  console.error(`CONTROLE DA SONDA FALHOU: sujei a arvore com \`${ISCA}\` e a sonda nao viu.`);
  console.error("Um veredito 'limpo' desta sonda nao valeria nada. Nada foi rodado.");
  console.error(`(o que ela viu: ${controle.vistas.join(", ") || "nada"})`);
  process.exit(2);
}
console.log(`controle da sonda: ela ve \`?? ${ISCA}\` aparecer e sumir  OK`);
console.log(`vigiando \`${comando.join(" ")}\` a cada ${intervalo}ms\n`);

// ---------------------------------------------------------------------------
// O comando de verdade
// ---------------------------------------------------------------------------
const { resultado, vistas } = await vigiar(
  () =>
    new Promise((ok) => {
      const filho = spawn(comando[0], comando.slice(1), { cwd: RAIZ, stdio: "inherit" });
      filho.on("close", (codigo, sinal) => ok({ codigo, sinal }));
    }),
);

console.log("");
if (vistas.length === 0) {
  console.log(`arvore LIMPA durante todo o comando (${comando.join(" ")})`);
} else {
  console.error(`A ARVORE FICOU SUJA DURANTE O COMANDO -- ${vistas.length} caminho(s):`);
  for (const linha of vistas) console.error(`  ${linha}`);
  console.error(
    "\nCada um deles e uma janela em que um SIGTERM (timeout, cancelamento de job) deixa a mutacao commitavel na arvore.",
  );
}
console.log(`comando: ${resultado.codigo === 0 ? "ok" : `reprova (codigo ${resultado.codigo}${resultado.sinal ? `, sinal ${resultado.sinal}` : ""})`}`);

process.exit(vistas.length === 0 && resultado.codigo === 0 ? 0 : 1);
