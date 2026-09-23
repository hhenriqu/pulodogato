#!/usr/bin/env node
// =====================================================
// PULODOGATO - reescrita de alias no build dos testes
// =====================================================
//   node scripts/resolve-aliases.mjs .tmp-reports lib
//
// O tsc RESOLVE o alias `@/` (por causa de `paths` no tsconfig) mas nao o
// REESCREVE no JavaScript emitido -- e um comportamento documentado dele, nao
// um bug de configuracao. O node entao recebe `import ... from "@/lib/..."`,
// que nao e nem caminho relativo nem pacote instalado, e morre com
// ERR_MODULE_NOT_FOUND.
//
// Os testes de lib/ rodam o JS compilado direto no node (o mesmo desenho do
// test-recurrence e do test-settlement: sem runner de teste novo no
// package.json). Este passo e o que torna isso possivel para um modulo que
// importa outro -- reports.ts puxa budget.ts, que puxa recurrence.ts.
//
// Nao entra no build do Next: la o proprio bundler resolve o alias.
// =====================================================

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";

const [destino, raizAlias] = process.argv.slice(2);

if (!destino || !raizAlias) {
  console.error("uso: node scripts/resolve-aliases.mjs <dir-compilado> <raiz-do-alias>");
  process.exit(1);
}

function arquivosJs(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosJs(caminho);
    return caminho.endsWith(".js") ? [caminho] : [];
  });
}

let reescritos = 0;

for (const arquivo of arquivosJs(destino)) {
  const original = readFileSync(arquivo, "utf8");

  // `@/lib/services/budget` -> caminho relativo a partir deste arquivo, com a
  // extensao .js que o ESM do node exige e o TypeScript omite.
  const novo = original.replace(
    new RegExp(`(["'])@/${raizAlias}/([^"']+)\\1`, "g"),
    (_todo, aspas, alvo) => {
      let rel = relative(dirname(arquivo), join(destino, alvo));
      if (!rel.startsWith(".")) rel = `./${rel}`;
      return `${aspas}${rel}.js${aspas}`;
    },
  );

  if (novo !== original) {
    writeFileSync(arquivo, novo);
    reescritos++;
  }
}

console.log(`alias resolvido em ${reescritos} arquivo(s) de ${destino}/`);
