#!/usr/bin/env node
// =====================================================
// LINT DE TUDO QUE ESTA NO GIT, COM ZERO DE TOLERANCIA
// =====================================================
// Isto e a HMO-179. O backlog de warnings foi zerado (eram 142), e sem um
// guard ele volta a crescer na primeira semana -- a HMO-119 ja tinha zerado
// coisa parecida e o numero voltou a subir porque nada cobrava.
//
// POR QUE NAO `next lint`
// -----------------------
// `next lint` so olha `app/`, `components/`, `lib/`, `pages/` e `src/`. Ele
// NAO olha `next.config.js`, `tailwind.config.js`, `middleware.ts`, `utils/`
// nem `scripts/` -- e tinha 7 avisos escondidos nesse ponto cego quando a
// HMO-179 comecou, invisiveis para o `npm run lint` que a propria issue usava
// para contar. Qualquer guard construido sobre ele herdaria o mesmo buraco.
//
// Aqui a lista de arquivos sai do `git ls-files`: o que esta versionado e
// conferido, e arquivo novo entra na conferencia sozinho, sem ninguem ter que
// lembrar de atualizar um glob. Arquivo nao rastreado fica de fora de
// proposito -- trabalho em andamento de outra branch nao reprova este PR.
//
// POR QUE `--max-warnings 0`
// --------------------------
// As regras deste projeto sao `warn`, nao `error`, e `eslint` sai 0 com
// qualquer numero de warnings. Sem este flag o job ficaria verde para sempre,
// o que e pior que nao existir: viraria um check que ninguem questiona.
// =====================================================

import { execFileSync } from "node:child_process";

const EXTENSOES = /\.(ts|tsx|js|mjs)$/;

function rastreados() {
  const saida = execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // `-z` separa por NUL: nome com espaco (ou com quebra de linha) nao se
  // parte no meio, que e o que aconteceria com split("\n").
  return saida.split("\0").filter((f) => f && EXTENSOES.test(f));
}

const arquivos = rastreados();

if (arquivos.length === 0) {
  console.error(
    "Nenhum arquivo .ts/.tsx/.js/.mjs rastreado pelo git. Isto nao e um " +
      "repositorio limpo -- e uma lista vazia, e uma lista vazia faria o " +
      "eslint sair 0 sem conferir nada."
  );
  process.exit(1);
}

console.log(`Conferindo ${arquivos.length} arquivos rastreados pelo git.`);

try {
  execFileSync(
    "npx",
    ["eslint", "--max-warnings", "0", "--no-error-on-unmatched-pattern", ...arquivos],
    { stdio: "inherit" }
  );
} catch {
  console.error(
    "\nO lint acusou. A HMO-179 zerou este backlog: o esperado aqui e ZERO " +
      "aviso.\n" +
      "Se o aviso novo for inevitavel, a saida nao e silenciar a linha -- e " +
      "uma excecao explicita em .eslintrc.json, com o motivo escrito (foi o " +
      "que se fez com os require() dos arquivos CommonJS)."
  );
  process.exit(1);
}

console.log("OK: zero aviso de lint em todo arquivo versionado.");
