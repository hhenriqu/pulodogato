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

const argumentos = process.argv.slice(2);
const espelhaRaiz = argumentos.includes("--espelha-raiz");
const [destino, raizAlias] = argumentos.filter((a) => !a.startsWith("--"));

if (!destino || !raizAlias) {
  console.error(
    "uso: node scripts/resolve-aliases.mjs <dir-compilado> <raiz-do-alias> [--espelha-raiz]",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// ONDE A RAIZ DO ALIAS CAI DENTRO DO DIRETORIO COMPILADO
// ---------------------------------------------------------------------------
// Sem a flag: o tsc recebeu apenas arquivos de UMA raiz (todos os testes de
// lib/ sao assim), entao ele calcula o rootDir como essa propria raiz e emite
// `.tmp-x/services/reports.js` para `lib/services/reports.ts`. O prefixo `lib/`
// desaparece na emissao, e o alias tem que perde-lo tambem.
//
// Com a flag: a suite compila arquivos de DUAS raizes -- o teste do menu mobile
// puxa components/ e lib/ juntos, porque components/ui/button.tsx importa
// lib/utils.ts. O rootDir comum passa a ser a raiz do repositorio, a emissao
// vira `.tmp-x/components/...` e `.tmp-x/lib/...`, e agora o prefixo PRECISA
// ser mantido.
//
// A flag e explicita de proposito: adivinhar o layout olhando se o diretorio
// existe daria uma resposta plausivel e errada no dia em que as duas formas
// coexistirem, e o sintoma seria ERR_MODULE_NOT_FOUND num teste que passou a
// vida inteira verde.
// ---------------------------------------------------------------------------
const prefixoEmitido = espelhaRaiz ? raizAlias : "";

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
      let rel = relative(dirname(arquivo), join(destino, prefixoEmitido, alvo));
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
