#!/usr/bin/env node
// =====================================================
// CONTROLE DO MAPA DE COBERTURA E DA QUARTA PENEIRA (HMO-491)
// =====================================================
// Roda com:  npm run test:suite-inerte
//
// O que esta sendo medido aqui e um DETECTOR, e detector tem o mesmo modo de
// morte silenciosa da guarda de `sed` (ver test-sed-dos-workflows.mjs): o
// predicado para de casar, o detector mede o conjunto vazio, e "0 suites
// paradas" imprime quase o mesmo que "nao achei suite nenhuma". A diferenca
// importa porque este detector e quem autoriza a frase "a suite roda no CI".
//
// As quatro formas de ele mentir, uma por caso:
//
//   1. contar step COMENTADO como execucao. E o caso mais caro: as seis mencoes
//      de `check-tests-in-ci` no `db-verify.yml` sao todas `#`, e sem o
//      `semComentarios` o detector conclui que aquela guarda roda -- quando ela
//      e exatamente uma das 80 que nao rodam.
//   2. NAO contar `node scripts/x.mjs` como execucao. A primeira medicao da
//      HMO-491 errou assim e reportou 33 orfaos, 24 deles falsos: varios steps
//      chamam o caminho na mao, sem passar pelo `npm run`.
//   3. casar nome que e PREFIXO de outro (`test:moeda` dentro de
//      `test:moeda-do-grupo`), o que atribui execucao a suite errada.
//   4. perder a cadeia transitiva: nove `check-*` so sao alcancados via
//      `npm run pre-commit`, e sem a cadeia cada um apareceria como orfao.
//
// TUDO EM mkdtempSync, E DE PROPOSITO
// -----------------------------------
// Nenhum caso escreve na arvore de verdade. O `package.json` e os workflows
// sinteticos nascem num diretorio temporario, e por isso nao ha `trap` nem
// restauracao: morrer no meio (SIGTERM, timeout do runner) nao deixa workflow
// mutante em `.github/`. E a regra que o `check-mutacao-no-lugar.mjs` cobra.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mapaDeCobertura,
  semComentarios,
  invocaPorNpm,
  arquivoDoComando,
  TETO_DE_BYTES_DO_WORKFLOW,
} from "./mapa-de-cobertura.mjs";

let reprovados = 0;
let passaram = 0;

function afirma(descricao, condicao, detalhe = "") {
  if (condicao) {
    passaram++;
    console.log(`  ok   ${descricao}`);
  } else {
    reprovados++;
    console.error(`  FALHA ${descricao}${detalhe ? `\n        ${detalhe}` : ""}`);
  }
}

/** Monta uma arvore sintetica: package.json + .github/workflows/*.yml. */
function arvore({ scripts, workflows }) {
  const raiz = mkdtempSync(join(tmpdir(), "mapa-cobertura-"));
  mkdirSync(join(raiz, ".github/workflows"), { recursive: true });
  writeFileSync(join(raiz, "package.json"), JSON.stringify({ scripts }, null, 2));
  for (const [nome, texto] of Object.entries(workflows)) {
    writeFileSync(join(raiz, ".github/workflows", nome), texto);
  }
  return raiz;
}

/**
 * Enche um workflow ate EXATAMENTE `bytes`, sem mexer nos steps.
 *
 * Byte-exato de proposito: o caso 6 cerca a borda em 512.000 e 512.001, e com
 * enchimento aproximado ele mede outra coisa. A primeira versao repetia uma
 * linha de 13 bytes dividindo por 14 e errava ~7% -- pedia 512.200 e entregava
 * 475.630, com o que os dois casos de borda passavam a medir arquivos pequenos
 * e a afirmacao ficava vacua nos dois lados.
 *
 * Comentario e nao step: foi assim que o teto foi cercado na HMO-459 (tres
 * branches de sonda com o conteudo da main e so comentario removido).
 */
function comTamanho(texto, bytes) {
  const base = texto.endsWith("\n") ? texto : texto + "\n";
  const falta = bytes - Buffer.byteLength(base, "utf8");
  if (falta <= 0) return base;
  // Uma linha de comentario de exatamente `falta` bytes: (falta-1) '#' + '\n'.
  return base + "#".repeat(falta - 1) + "\n";
}

const STEPS_VIVO = `name: vivo
on: [push]
jobs:
  v:
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:alfa
`;

console.log("\n-- CASO 1: step COMENTADO nao conta como execucao --\n");
{
  const raiz = arvore({
    scripts: { "test:alfa": "node --test scripts/test-alfa.mjs" },
    workflows: {
      "a.yml": `name: a
on: [push]
jobs:
  v:
    steps:
      # - run: npm run test:alfa
      - run: echo nada
`,
    },
  });
  const mapa = mapaDeCobertura(raiz);
  const alfa = mapa.alvos.find((a) => a.nome === "test:alfa");
  afirma(
    "suite citada SO em linha de comentario e ORFAO, nao RODA",
    alfa.estado === "ORFAO",
    `estado medido: ${alfa.estado}; invocadoPor=[${alfa.invocadoPor}]`,
  );
  afirma(
    "semComentarios tira a linha `#` e deixa a de verdade",
    semComentarios("# npm run test:alfa\n  - run: npm run test:beta").includes("test:beta") &&
      !semComentarios("# npm run test:alfa\n  - run: npm run test:beta").includes("test:alfa"),
  );
  rmSync(raiz, { recursive: true, force: true });
}

console.log("\n-- CASO 2: `node scripts/x.mjs` conta como execucao --\n");
{
  const raiz = arvore({
    scripts: { "check-gama": "node scripts/check-gama.mjs" },
    workflows: {
      "a.yml": `name: a
on: [push]
jobs:
  v:
    steps:
      - run: node scripts/check-gama.mjs
`,
    },
  });
  const mapa = mapaDeCobertura(raiz);
  const gama = mapa.alvos.find((a) => a.nome === "check-gama");
  afirma(
    "alvo chamado pelo caminho, sem `npm run`, conta como RODA",
    gama.estado === "RODA",
    `estado medido: ${gama.estado}`,
  );
  afirma(
    "arquivoDoComando acha o .mjs, o .js e o .sh",
    arquivoDoComando("node scripts/a.mjs") === "scripts/a.mjs" &&
      arquivoDoComando("bash scripts/b.sh") === "scripts/b.sh" &&
      arquivoDoComando("node scripts/c.js") === "scripts/c.js" &&
      arquivoDoComando("next build") === null,
  );
  rmSync(raiz, { recursive: true, force: true });
}

console.log("\n-- CASO 3: nome que e PREFIXO de outro nao casa --\n");
{
  afirma(
    "`npm run test:moeda-do-grupo` NAO satisfaz `test:moeda`",
    !invocaPorNpm("- run: npm run test:moeda-do-grupo", "test:moeda"),
  );
  afirma(
    "`npm run test:moeda` no fim da linha satisfaz `test:moeda`",
    invocaPorNpm("- run: npm run test:moeda", "test:moeda"),
  );
  const raiz = arvore({
    scripts: { "test:moeda": "node --test a.mjs", "test:moeda-do-grupo": "node --test b.mjs" },
    workflows: { "a.yml": STEPS_VIVO.replace("test:alfa", "test:moeda-do-grupo") },
  });
  const mapa = mapaDeCobertura(raiz);
  afirma(
    "so a suite de nome longo roda; a de nome curto fica ORFA",
    mapa.alvos.find((a) => a.nome === "test:moeda").estado === "ORFAO" &&
      mapa.alvos.find((a) => a.nome === "test:moeda-do-grupo").estado === "RODA",
  );
  rmSync(raiz, { recursive: true, force: true });
}

console.log("\n-- CASO 4: cadeia transitiva pelo `npm run` de outro alvo --\n");
{
  const raiz = arvore({
    scripts: {
      "check-um": "node scripts/check-um.mjs",
      "check-dois": "node scripts/check-dois.mjs",
      "pre-commit": "npm run check-um && npm run check-dois",
    },
    workflows: { "a.yml": STEPS_VIVO.replace("npm run test:alfa", "npm run pre-commit") },
  });
  const mapa = mapaDeCobertura(raiz);
  afirma(
    "os dois `check-*` alcancados so via `pre-commit` contam como RODA",
    mapa.alvos.find((a) => a.nome === "check-um").estado === "RODA" &&
      mapa.alvos.find((a) => a.nome === "check-dois").estado === "RODA",
  );
  rmSync(raiz, { recursive: true, force: true });
}

console.log("\n-- CASO 5: o TETO de bytes separa INERTE de RODA --\n");
{
  // A MESMA declaracao nos dois workflows; a UNICA diferenca e o tamanho.
  // E isto que distingue esta peneira do `check-tests-in-ci`: ele veria os dois
  // como cobertura igual.
  const acima = comTamanho(STEPS_VIVO, TETO_DE_BYTES_DO_WORKFLOW + 200);
  const abaixo = comTamanho(STEPS_VIVO, TETO_DE_BYTES_DO_WORKFLOW - 5_000);

  const morto = arvore({
    scripts: { "test:alfa": "node --test a.mjs" },
    workflows: { "grande.yml": acima },
  });
  const vivo = arvore({
    scripts: { "test:alfa": "node --test a.mjs" },
    workflows: { "grande.yml": abaixo },
  });

  const mMorto = mapaDeCobertura(morto);
  const mVivo = mapaDeCobertura(vivo);

  afirma(
    `workflow com ${Buffer.byteLength(acima)} bytes nao da partida, e a suite fica INERTE`,
    mMorto.workflows[0].daPartida === false &&
      mMorto.alvos.find((a) => a.nome === "test:alfa").estado === "INERTE",
    `daPartida=${mMorto.workflows[0].daPartida} estado=${mMorto.alvos[0].estado}`,
  );
  afirma(
    `o MESMO arquivo com ${Buffer.byteLength(abaixo)} bytes da partida, e a suite RODA`,
    mVivo.workflows[0].daPartida === true &&
      mVivo.alvos.find((a) => a.nome === "test:alfa").estado === "RODA",
    `daPartida=${mVivo.workflows[0].daPartida} estado=${mVivo.alvos[0].estado}`,
  );
  afirma(
    "INERTE e distinto de ORFAO: o inerte E citado, o orfao nao",
    mMorto.alvos.find((a) => a.nome === "test:alfa").invocadoPor.length === 1,
  );
  afirma(
    "o teto e o numero MEDIDO de 512.000, nao 500.000 nem 524.288",
    TETO_DE_BYTES_DO_WORKFLOW === 512_000,
    `valor: ${TETO_DE_BYTES_DO_WORKFLOW}`,
  );

  rmSync(morto, { recursive: true, force: true });
  rmSync(vivo, { recursive: true, force: true });
}

console.log("\n-- CASO 6: a borda exata do teto, cercada --\n");
{
  // 511.821 bytes o GitHub LE; 512.136 nao. Entao o teto esta em 512.000, e a
  // comparacao tem de ser `<=`: um arquivo de exatamente 512.000 ainda roda.
  const naBorda = comTamanho(STEPS_VIVO, TETO_DE_BYTES_DO_WORKFLOW);
  const umAcima = naBorda + "#";
  for (const [rotulo, texto, esperado] of [
    ["exatamente 512.000", naBorda, true],
    ["512.001", umAcima, false],
  ]) {
    const raiz = arvore({
      scripts: { "test:alfa": "node --test a.mjs" },
      workflows: { "g.yml": texto },
    });
    const m = mapaDeCobertura(raiz);
    afirma(
      `${rotulo} bytes -> daPartida=${esperado}`,
      m.workflows[0].daPartida === esperado,
      `bytes reais=${m.workflows[0].bytes} daPartida=${m.workflows[0].daPartida}`,
    );
    rmSync(raiz, { recursive: true, force: true });
  }
}

console.log("\n-- CASO 7: controle POSITIVO -- arvore sem defeito nao acusa nada --\n");
{
  const raiz = arvore({
    scripts: { "test:alfa": "node --test a.mjs", "test:beta": "node --test b.mjs" },
    workflows: {
      "a.yml": `name: a
on: [push]
jobs:
  v:
    steps:
      - run: npm run test:alfa
      - run: npm run test:beta
`,
    },
  });
  const mapa = mapaDeCobertura(raiz);
  afirma(
    "nenhum alvo parado numa arvore sadia",
    mapa.alvos.every((a) => a.estado === "RODA"),
    JSON.stringify(mapa.alvos.map((a) => [a.nome, a.estado])),
  );
  afirma("e o detector achou os dois alvos, nao o conjunto vazio", mapa.alvos.length === 2);
  rmSync(raiz, { recursive: true, force: true });
}

console.log("\n-- CASO 8: a arvore DE VERDADE -- o detector nao mede o vazio --\n");
{
  // Sem este caso os sete de cima passariam sobre um detector que nao enxerga o
  // repositorio real (RAIZ errada, readdir vazio). Aqui a afirmacao e de FORMA,
  // nao de numero: o numero muda a cada PR e cravar 87 aqui faria esta suite
  // reprovar por motivo alheio (ver `suite-de-view-com-valor-cravado`).
  const mapa = mapaDeCobertura();
  afirma(
    "o mapa real tem os tres workflows do repositorio",
    mapa.workflows.length >= 3 && mapa.workflows.some((w) => w.nome === "db-verify.yml"),
    JSON.stringify(mapa.workflows.map((w) => w.nome)),
  );
  afirma(
    "o mapa real tem mais de 200 alvos de verificacao",
    mapa.alvos.length > 200,
    `alvos: ${mapa.alvos.length}`,
  );
  afirma(
    "pelo menos um alvo RODA e pelo menos um esta parado (nenhum dos dois lados e vazio)",
    mapa.alvos.some((a) => a.estado === "RODA") && mapa.alvos.some((a) => a.estado !== "RODA"),
  );
}

console.log(
  `\n${passaram} afirmacoes passaram, ${reprovados} reprovaram.\n` +
    (reprovados === 0
      ? "O detector distingue execucao de declaracao, e o teto de bytes esta cercado nos dois lados.\n"
      : "O detector esta medindo a coisa errada -- NAO confie em nenhum veredito de cobertura dele.\n"),
);
process.exit(reprovados === 0 ? 0 : 1);
