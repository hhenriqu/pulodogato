#!/usr/bin/env node
// Quebra o build quando existe uma migration que o db-verify nao roda.
//
// Por que isto existe (HMO-145): o db-verify enumera as migrations A MAO, um
// step por arquivo. Toda vez que alguem adiciona uma migration e esquece do
// workflow, o CI passa a validar uma cadeia que NAO e a de producao -- e o job
// fica verde justamente porque nao exercita o arquivo novo.
//
// Ja aconteceu tres vezes, e o proprio db-verify.yml registra duas delas em
// comentario: a 004 ficou de fora ate 2026-09-22, a 011 entrou na main pelo
// PR #20 e nunca foi exercitada, e a 013 seria a terceira. Um comentario
// pedindo para lembrar nao resolve isso; uma verificacao resolve.
//
// A checagem e textual de proposito: nao interpreta YAML, nao precisa de
// dependencia nova e roda em milissegundos, entao cabe no code-schema-drift,
// que e o job sem filtro de path e obrigatorio em todo PR.
//
// O que ela NAO cobre: se o step existe mas roda o arquivo errado, ou se o
// `ON_ERROR_STOP` sair do $PSQL. Isto e um piso, nao uma garantia.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const DIR_MIGRATIONS = join(RAIZ, "database/migrations");

// O 000 e inventario de preflight, nao muda schema: nunca entrou na cadeia do
// db-verify e nao deve entrar. Fica explicito aqui para que a excecao seja uma
// decisao visivel, e nao um filtro esperto escondido na leitura.
const FORA_DA_CADEIA = new Set(["000_preflight_inventory.sql"]);

const workflow = readFileSync(join(RAIZ, ".github/workflows/db-verify.yml"), "utf8");

const migrations = readdirSync(DIR_MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => !FORA_DA_CADEIA.has(f))
  .sort();

const ausentes = migrations.filter(
  (f) => !workflow.includes(`database/migrations/${f}`),
);

// A verificacao tambem falha no sentido contrario: um step que aponta para um
// arquivo que nao existe mais quebraria o job com "No such file", mas so
// depois de subir um Postgres. Pegar aqui custa milissegundos.
const citadas = [...workflow.matchAll(/database\/migrations\/([0-9A-Za-z_]+\.sql)/g)].map(
  (m) => m[1],
);
const existentes = new Set(readdirSync(DIR_MIGRATIONS));
const fantasmas = [...new Set(citadas)].filter((f) => !existentes.has(f));

if (ausentes.length === 0 && fantasmas.length === 0) {
  console.log(
    `Nenhuma migration fora do CI: as ${migrations.length} da cadeia aparecem no db-verify.yml.`,
  );
  process.exit(0);
}

if (ausentes.length > 0) {
  console.error(
    "Migration que o db-verify nao roda -- o CI validaria uma cadeia diferente da de producao:\n",
  );
  for (const f of ausentes) {
    console.error(`  database/migrations/${f}`);
  }
  console.error(
    `\nAdicione em .github/workflows/db-verify.yml, na ordem, um step\n` +
      `  - name: ${ausentes[0].replace(/\.sql$/, "")}\n` +
      `    run: $PSQL -f database/migrations/${ausentes[0]}\n` +
      `e, se o arquivo for re-executavel, o step de idempotencia logo depois.`,
  );
}

if (fantasmas.length > 0) {
  console.error(
    "\nO db-verify aponta para migration que nao existe mais:\n",
  );
  for (const f of fantasmas) console.error(`  database/migrations/${f}`);
}

process.exit(1);
