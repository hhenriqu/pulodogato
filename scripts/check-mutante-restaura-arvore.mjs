#!/usr/bin/env node
// Todo runner de mutante tem um mecanismo que devolve a arvore ao lugar.
//
// POR QUE (HMO-326)
// -----------------
// Consertar os 8 runners que mutavam a arvore rastreada nao fecha o buraco: o
// nono se escreve amanha, copiado de um dos 8 de antes, e nada da sintoma. O
// sintoma de verdade aparece dias depois, num worktree herdado com um arquivo
// sujo que ninguem reconhece -- e ja foi commitado num PR aqui (HMO-263).
//
// Esta guarda exige que cada `scripts/mutantes-*` declare, por CONSTRUCAO, por
// qual dos tres caminhos a arvore volta ao lugar:
//
//   SOMBRA     importa `mutantes-em-bloco.mjs` -- muta uma sombra em /tmp e a
//              arvore rastreada nunca e tocada. O mais seguro: nao ha o que
//              restaurar.
//   CURADO     importa `auto-cura-de-mutante.mjs` -- muta a arvore, mas a
//              invocacao SEGUINTE desfaz o que um `SIGKILL` deixou.
//   DECLARADO  declarado aqui embaixo, com motivo escrito e um `como` do
//              vocabulario fechado: `temporario` (so escreve em diretorio
//              temporario) ou `sem-escrita` (nao escreve arquivo nenhum -- a
//              mutacao vive numa variavel e vai ao psql por `-c`).
//
// Um runner novo que nao caia em nenhum dos tres REPROVA. E isso e de proposito:
// o default tem de ser "pare e diga como voce restaura", e nao "passe".
//
// A DECLARACAO NAO E UMA PROMESSA, E CONFERIDA
// --------------------------------------------
// A declaracao seria a porta dos fundos se bastasse escrever o nome aqui. Duas
// conferencias a fecham:
//
//   1. cada `como` tem o seu falsificador, e e o proprio texto da declaracao
//      que escolhe qual se aplica: `temporario` exige marca de diretorio
//      temporario (`mkdtempSync`, `tmpdir()`, `mktemp`); `sem-escrita` exige o
//      contrario -- que NAO haja escrita de arquivo nenhuma, nem redirecao de
//      shell para um caminho. Declarar o `como` errado reprova;
//   2. o runner NAO pode escrever num caminho de fonte rastreada. A peneira
//      procura `writeFileSync(X, ...)` onde `X` e uma constante de modulo cujo
//      valor e um caminho relativo em `lib/`, `components/`, `app/`,
//      `database/` ou `scripts/` -- que e exatamente a forma que os 8 runners
//      consertados usavam.
//
// A peneira 2 vale para TODO runner, declarado ou nao: um runner `CURADO` que
// passe a mutar um arquivo FORA da lista que ele deu ao `protegerArvore`
// tambem fica sem cura para aquele arquivo, e nada diria.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCRIPTS = path.join(RAIZ, "scripts");

/**
 * Os runners que so escrevem em diretorio temporario, com o porque de cada um.
 *
 * Nao e divida: para estes a arvore rastreada nunca corre risco, e passar a
 * usar o helper seria cerimonia sem ganho. O que a lista impede e um runner
 * que muta `lib/` entrar aqui de carona -- ver as duas conferencias no
 * cabecalho.
 */
const DECLARADOS = {
  "mutantes-chave-pix.mjs": {
    como: "temporario",
    porque: "escreve o TEXTO mutado da migration 032 num arquivo em /tmp e o manda ao psql",
  },
  "mutantes-moeda-da-conta-prevista.mjs": {
    como: "temporario",
    porque: "escreve o TEXTO mutado da migration em /tmp e o manda ao psql",
  },
  "mutantes-parcela-n-de-m.mjs": {
    como: "temporario",
    porque: "escreve o TEXTO mutado da migration em /tmp e o manda ao psql",
  },
  "mutantes-transferencia-recorrente.mjs": {
    como: "temporario",
    porque: "escreve o TEXTO mutado da migration em /tmp e o manda ao psql",
  },
  "mutantes-trava-de-membro.mjs": {
    como: "temporario",
    porque: "escreve o TEXTO mutado da migration em /tmp e o manda ao psql",
  },
  "mutantes-edicao-de-grupo.mjs": {
    como: "temporario",
    porque: "copia a arvore para um diretorio temporario e muta a copia",
  },
  "mutantes-minha-parte-no-realizado.mjs": {
    como: "temporario",
    porque: "copia a arvore para um diretorio temporario e muta a copia",
  },
  "mutantes-fatura-do-periodo.mjs": {
    como: "temporario",
    porque: "copia os fontes para um diretorio temporario e muta a copia",
  },
  "mutantes-realizado-do-caixa.mjs": {
    como: "temporario",
    porque: "copia os fontes para um diretorio temporario e muta a copia",
  },
  "mutantes-guarda-dos-mutantes.mjs": {
    como: "temporario",
    porque: "roda inteiro dentro de uma COPIA em diretorio temporario",
  },
  "mutantes-conferidor-da-conversao.mjs": {
    como: "temporario",
    porque:
      "importa copias mutadas do conversor de uma sombra em /tmp; o trecho que muta a arvore vive DENTRO de um template literal, como fixture",
  },
  "mutantes-auto-cura.mjs": {
    como: "temporario",
    porque: "monta um repositorio git novo em /tmp e muta a copia de la",
  },
  "mutantes-categorias.sh": {
    como: "sem-escrita",
    porque: "a mutacao vive numa variavel do shell e vai ao psql por `-c`: nenhum arquivo e escrito",
  },
  "mutantes-convite-sem-conta.sh": {
    como: "sem-escrita",
    porque: "a mutacao vive numa variavel do shell e vai ao psql por `-c`: nenhum arquivo e escrito",
  },
};

const COMO_ACEITO = new Set(["temporario", "sem-escrita"]);
const MARCA_DE_TEMPORARIO = /mkdtempSync|tmpdir\(\)|mktemp/;
const FONTE_RASTREADA = /^(lib|components|app|database|scripts)\//;

/** Escrita de arquivo em JS, ou pelos comandos de shell que gravam. */
const ESCRITA_EM_JS = /\b(?:writeFileSync|appendFileSync|cpSync|copyFileSync|renameSync|mkdirSync)\s*\(/;
const ESCRITA_EM_SHELL = /(?:^|[\s;&|])(?:cp|mv|tee|dd)\s|sed\s+-i/;

/**
 * Uma redirecao de shell que grava em ARQUIVO (e nao em /dev/null nem num
 * descritor). O alvo tem de parecer caminho: assim o `>` de comparacao de SQL
 * (`expires_at > NOW()`), que aparece dentro das strings destes runners, nao
 * conta como escrita.
 */
const REDIRECAO_PARA_ARQUIVO =
  />>?\s*(?!\/dev\/)(?!&)(?:"[^"]+"|'[^']+'|[\w./$~-]+)\s*(?:$|[;&|)])/m;

const runners = readdirSync(SCRIPTS)
  .filter((f) => /^mutantes-.*\.(mjs|sh)$/.test(f))
  .sort();

// Sem isto, um glob que parasse de casar deixaria a guarda verde sobre o
// conjunto vazio -- o modo de falhar que este repositorio ja teve.
if (runners.length === 0) {
  console.error("Nenhum scripts/mutantes-* na arvore -- a verificacao perdeu o alvo.");
  process.exit(1);
}

const erros = [];
const censo = { SOMBRA: 0, CURADO: 0, temporario: 0, "sem-escrita": 0 };

/** As linhas que nao sao comentario, para as peneiras de shell. */
function semComentarios(fonte) {
  return fonte
    .split("\n")
    .filter((l) => !/^\s*(#|\/\/)/.test(l))
    .join("\n");
}

/**
 * Os `writeFileSync(X, ...)` cujo X e uma constante de modulo que aponta para
 * fonte rastreada. Devolve os nomes das constantes.
 */
function escritasEmFonteRastreada(fonte) {
  const constantes = new Map();
  for (const m of fonte.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*"([^"]+)"\s*;/gm)) {
    if (FONTE_RASTREADA.test(m[2])) constantes.set(m[1], m[2]);
  }
  const achadas = new Map();
  for (const m of fonte.matchAll(/writeFileSync\(\s*([A-Za-z_$][\w$]*)\s*,/g)) {
    if (constantes.has(m[1])) achadas.set(m[1], constantes.get(m[1]));
  }
  return achadas;
}

for (const runner of runners) {
  const fonte = readFileSync(path.join(SCRIPTS, runner), "utf8");

  const usaBloco = /from\s+"\.\/mutantes-em-bloco\.mjs"/.test(fonte);
  const usaCura = /from\s+"\.\/auto-cura-de-mutante\.mjs"/.test(fonte);
  const declaracao = Object.prototype.hasOwnProperty.call(DECLARADOS, runner)
    ? DECLARADOS[runner]
    : null;
  const declarado = declaracao !== null;

  if (usaBloco && usaCura) {
    erros.push(
      `${runner}: importa os DOIS mecanismos. O bloco nao toca a arvore rastreada, ` +
        `entao a auto-cura ali guardaria o original de um arquivo que ninguem muta -- escolha um.`,
    );
    continue;
  }

  if (usaBloco) censo.SOMBRA++;
  else if (usaCura) censo.CURADO++;
  else if (declarado) {
    if (!COMO_ACEITO.has(declaracao.como)) {
      erros.push(
        `${runner}: \`como: "${declaracao.como}"\` nao esta no vocabulario ` +
          `(${[...COMO_ACEITO].join(", ")}). Vocabulario aberto viraria "porque sim".`,
      );
      continue;
    }
    if (!declaracao.porque?.trim()) {
      erros.push(`${runner}: declarado sem \`porque\` -- a declaracao tem de dizer o motivo.`);
      continue;
    }
    censo[declaracao.como]++;
  } else {
    erros.push(
      `${runner}: nao diz como a arvore volta ao lugar.\n` +
        `    Um runner que muta a arvore rastreada e morto por SIGKILL deixa o mutante GRAVADO,\n` +
        `    e ele atravessa o run seguinte como se fosse trabalho legitimo (ja foi commitado aqui).\n` +
        `    Escolha um dos tres:\n` +
        `      - \`criarBlocoDeMutantes\` de ./mutantes-em-bloco.mjs  (nao toca a arvore: o melhor)\n` +
        `      - \`protegerArvore\` de ./auto-cura-de-mutante.mjs     (muta, e a proxima invocacao cura)\n` +
        `      - declare em DECLARADOS dentro de ${path.basename(fileURLToPath(import.meta.url))},\n` +
        `        com \`como\` (temporario | sem-escrita) e \`porque\`.`,
    );
    continue;
  }

  // Peneira 1: cada `como` tem o seu falsificador, e sao OPOSTOS -- declarar o
  // `como` errado reprova, entao a declaracao nao e so uma promessa.
  if (declarado && !usaBloco && !usaCura) {
    const util = semComentarios(fonte);
    if (declaracao.como === "temporario" && !MARCA_DE_TEMPORARIO.test(fonte)) {
      erros.push(
        `${runner}: declarado \`temporario\` ("${declaracao.porque}"), mas nao ha marca de ` +
          `diretorio temporario (mkdtempSync / tmpdir() / mktemp). A declaracao se auto-refuta -- ` +
          `se ele nao escreve arquivo nenhum, o \`como\` certo e \`sem-escrita\`.`,
      );
    }
    if (declaracao.como === "sem-escrita") {
      const comoEscreve = [
        ESCRITA_EM_JS.test(util) && "chamada de escrita em JS",
        ESCRITA_EM_SHELL.test(util) && "comando de shell que grava (cp/mv/tee/dd/sed -i)",
        REDIRECAO_PARA_ARQUIVO.test(util) && "redirecao para arquivo",
      ].filter(Boolean);
      if (comoEscreve.length > 0) {
        erros.push(
          `${runner}: declarado \`sem-escrita\` ("${declaracao.porque}"), mas o arquivo tem ` +
            `${comoEscreve.join(" e ")}. A declaracao se auto-refuta.`,
        );
      }
    }
  }

  // Peneira 2: vale para todos. Um runner que escreve em fonte rastreada por
  // uma constante de modulo esta mutando a arvore, diga ele o que disser.
  if (!usaCura) {
    const escritas = escritasEmFonteRastreada(fonte);
    for (const [nome, caminho] of escritas) {
      erros.push(
        `${runner}: escreve em \`${caminho}\` (pela constante \`${nome}\`), que e fonte rastreada, ` +
          `sem usar \`protegerArvore\`. Um SIGKILL aqui deixa o mutante gravado na arvore.`,
      );
    }
  }
}

if (erros.length > 0) {
  console.error("Runner de mutante sem mecanismo de restauracao:\n");
  for (const e of erros) console.error(`  ${e}\n`);
  process.exit(1);
}

console.log(
  `Os ${runners.length} runners de mutante dizem como a arvore volta ao lugar: ` +
    `${censo.SOMBRA} por sombra em /tmp, ${censo.CURADO} com auto-cura na partida, ` +
    `${censo.temporario} que so escrevem em diretorio temporario, ` +
    `${censo["sem-escrita"]} que nao escrevem arquivo nenhum.`,
);
