#!/usr/bin/env node
// Quebra o build quando existe um script `test:*` que nenhum workflow roda.
//
// Por que isto existe (HMO-145): o `test:recurrence-detector` -- 31 testes, 26
// descricoes reais de extrato -- entrou na main pelo PR #20 e ficou DIAS sem
// rodar em CI nenhum. O script estava no package.json, ninguem o chamava, e
// nada nessa situacao parece errado: os workflows ficam verdes, o package.json
// lista a suite, e quem abre o repositorio conclui que ha cobertura.
//
// Uma suite que ninguem executa e pior que suite nenhuma. Suite nenhuma se ve;
// esta da a sensacao de cobertura enquanto a regressao passa verde.
//
// E o mesmo desenho do check-migrations-in-ci.mjs, pela mesma razao: o
// db-verify enumera cada teste A MAO, um step por vez, e todo passo enumerado a
// mao e um passo que alguem vai esquecer. Comentario pedindo para lembrar nao
// resolve; verificacao resolve.
//
// Textual de proposito: nao interpreta YAML, nao precisa de dependencia nova e
// roda em milissegundos, entao cabe no code-schema-drift -- o job sem filtro de
// path, obrigatorio em todo PR.
//
// O que ela NAO cobre: um step que chama o script e ignora o codigo de saida,
// ou um teste que nao afirma nada. Isto e um piso, nao uma garantia.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const DIR_WORKFLOWS = join(RAIZ, ".github/workflows");

const pkg = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"));
const testes = Object.keys(pkg.scripts ?? {}).filter((n) => n.startsWith("test:")).sort();

if (testes.length === 0) {
  console.error("Nenhum script test:* no package.json -- a verificacao perdeu o alvo.");
  process.exit(1);
}

const workflows = readdirSync(DIR_WORKFLOWS)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .map((f) => readFileSync(join(DIR_WORKFLOWS, f), "utf8"))
  .join("\n");

const ausentes = testes.filter((n) => !workflows.includes(`npm run ${n}`));

if (ausentes.length === 0) {
  console.log(`Nenhuma suite fora do CI: os ${testes.length} scripts test:* rodam em algum workflow.`);
  process.exit(0);
}

console.error("Suite de teste que nenhum workflow roda -- verde por ausencia, nao por acerto:\n");
for (const n of ausentes) console.error(`  npm run ${n}`);
console.error(
  `\nAdicione em .github/workflows/db-verify.yml um step\n` +
    `  - name: <o que este teste prova, em uma linha>\n` +
    `    run: npm run ${ausentes[0]}\n` +
    `ou, se a suite foi aposentada, tire o script do package.json.`,
);
process.exit(1);
