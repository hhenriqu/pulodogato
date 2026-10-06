#!/usr/bin/env node
// PULODOGATO - nenhum .tmp-* rastreado, e todo .tmp-* ignorado.
//
// As suites deste repositorio compilam TypeScript para `.tmp-<nome>/` e cada
// uma comeca com `rm -rf .tmp-<nome>`. Isso e seguro enquanto o diretorio
// estiver no .gitignore. Quando um deles escapa, o estrago nao aparece como
// erro em lugar nenhum:
//
//   1. o .js compilado entra na main como se fosse codigo-fonte, e envelhece
//      la dentro sem nunca mais ser lido por ninguem;
//   2. quem rodar aquela suite APAGA um arquivo rastreado, e fica com uma
//      delecao fantasma no worktree que ele nao pediu -- pronta para ser
//      varrida para dentro do proximo commit de outra pessoa.
//
// Foi exatamente o que a HMO-166 fez com o `.tmp-recorrencia-edicao/` da
// HMO-170: o diretorio era o unico dos 35 fora do .gitignore, e o commit levou
// junto um .js compilado de um modulo que nem era daquela issue.
//
// As duas metades sao necessarias. A primeira pega o que ja vazou; a segunda
// pega a lacuna ANTES de alguem rodar a suite e commitar o resultado.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const erros = [];

// ---------------------------------------------------------------------------
// 1. Nada em .tmp-* pode estar rastreado.
// ---------------------------------------------------------------------------

const rastreados = git(["ls-files"])
  .split("\n")
  .filter((p) => p.startsWith(".tmp-"));

if (rastreados.length > 0) {
  erros.push(
    `Ha ${rastreados.length} arquivo(s) de build rastreado(s) pelo git:\n` +
      rastreados.map((p) => `    ${p}`).join("\n") +
      `\n  Saida de compilacao nao e codigo-fonte. Tire do indice com\n` +
      `    git rm -r --cached <diretorio>\n` +
      `  e acrescente o diretorio ao .gitignore.`
  );
}

// ---------------------------------------------------------------------------
// 2. Todo .tmp-* que alguma suite cria precisa estar ignorado.
// ---------------------------------------------------------------------------

// Os nomes saem do package.json, e nao de uma lista escrita a mao aqui: uma
// lista a mao envelhece calada, e a suite nova -- justamente a que ainda nao
// tem entrada no .gitignore -- seria a unica que ela nao conhece.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const scripts = Object.values(pkg.scripts ?? {}).join("\n");

const citadosNoComando = scripts.match(/\.tmp-[A-Za-z0-9_-]+/g) ?? [];

// Alem dos nomes citados no comando, os `outDir` dos tsconfig de teste.
//
// Por que as duas fontes (HMO-263): o comando de um alvo nem sempre nomeia o
// proprio diretorio de saida. Quando ele e `compila.mjs -p tsconfig.x-test.json`
// e a suite nao chama o resolve-aliases, o `.tmp-x` aparece SO dentro do
// tsconfig -- e o alvo ficava invisivel aqui. Seis diretorios sumiram desta
// verificacao desse jeito ao tirar o `rm -rf` dos comandos, e o sintoma seria o
// de sempre: verde por nao ter mais o que conferir.
//
// O `outDir` do tsconfig e a fonte autoritativa de para onde a suite compila;
// o comando e so onde o nome costuma aparecer de novo.
const dosTsconfigs = [];
const dirScripts = new URL("../scripts/", import.meta.url);
for (const nome of readdirSync(dirScripts)) {
  if (!/^tsconfig\..*-test\.json$/.test(nome)) continue;
  let cfg;
  try {
    // Sem dependencia de parser de JSONC: estes arquivos sao JSON puro, e um
    // que nao for cai no catch e e reportado em vez de ignorado.
    cfg = JSON.parse(readFileSync(new URL(nome, dirScripts), "utf8"));
  } catch (erro) {
    erros.push(`scripts/${nome} nao e JSON legivel (${erro.message}): o outDir dele nao foi conferido.`);
    continue;
  }
  const outDir = cfg.compilerOptions?.outDir;
  if (!outDir) continue;
  const limpo = outDir.replace(/^\.\.\//, "").replace(/\/$/, "");
  if (limpo.startsWith(".tmp-")) dosTsconfigs.push(limpo);
}

const diretorios = [...new Set([...citadosNoComando, ...dosTsconfigs])].sort();

if (diretorios.length === 0) {
  // Controle interno: se a regex parar de casar, os dois lacos abaixo passam
  // verde por nao terem o que conferir -- indistinguivel de estar tudo certo.
  erros.push(
    "Nenhum diretorio .tmp-* encontrado no package.json. A regex quebrou, " +
      "ou os scripts mudaram de forma: esta verificacao nao esta mais vendo nada."
  );
}

const naoIgnorados = diretorios.filter((dir) => {
  // `git check-ignore` sai 0 quando o caminho E ignorado, 1 quando nao e.
  try {
    git(["check-ignore", "-q", "--no-index", `${dir}/`]);
    return false;
  } catch {
    return true;
  }
});

if (naoIgnorados.length > 0) {
  erros.push(
    `Estas suites compilam para um diretorio que NAO esta no .gitignore:\n` +
      naoIgnorados.map((d) => `    ${d}/`).join("\n") +
      `\n  A compilacao das suites apaga e reescreve esse caminho. Enquanto ele\n` +
      `  estiver fora\n` +
      `  do .gitignore, o resultado da compilacao pode ser commitado por engano --\n` +
      `  e a partir dai rodar a suite apaga um arquivo rastreado.`
  );
}

// ---------------------------------------------------------------------------

if (erros.length > 0) {
  console.error("\nArtefatos de build no lugar errado:\n");
  for (const e of erros) console.error(`  - ${e}\n`);
  process.exit(1);
}

console.log(
  `Nenhum .tmp-* rastreado; os ${diretorios.length} diretorios de compilacao estao ignorados.`
);
