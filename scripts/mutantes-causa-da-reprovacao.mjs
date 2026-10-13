#!/usr/bin/env node
// =====================================================
// OS MUTANTES DA CAUSA NA LINHA DO `ABORTADO` (HMO-405)
// =====================================================
//   npm run mutantes:causa-da-reprovacao
//
// O ALVO E O MOTOR DE BLOCO, E ISSO E DELIBERADO
// ----------------------------------------------
// `resumoDaReprovacao` mora em `scripts/mutantes-em-bloco.mjs`, que e o motor
// que 45 runners convertidos importam. A linha que ela devolve e a UNICA coisa
// que o preflight desses 45 imprime quando o controle positivo reprova -- isto
// e, no momento em que o placar de mutantes nao vale e alguem precisa descobrir
// por que. Um refator que a simplifique de volta para "os nomes dos casos"
// deixa `test:causa-da-reprovacao` verde se nenhum caso dela depender da linha
// mutada, e o defeito da HMO-405 volta sem sintoma.
//
// POR QUE ORACULO, E NAO SUITE
// ----------------------------
// `test:causa-da-reprovacao` nao compila nada: ela importa um `.mjs` e passa
// texto para ele. `criarBlocoDeMutantes` recusa uma SUITE sem etapa de
// compilacao (seria placar sobre codigo que ninguem compilou) e recusa um
// ORACULO que compila -- as duas recusas sao a imagem espelhada uma da outra.
// Este caso e de oraculo com todas as letras: a sombra materializa o
// `mutantes-em-bloco.mjs` mutado EM DISCO, fora da arvore rastreada, e o
// `import` da suite na sombra le o mutante sem a arvore de verdade ser tocada.
//
// Para oraculo, `mudouASaida` vem `null` de proposito -- nao ha artefato
// compilado a comparar com o controle. Quem responde "a mutacao aconteceu de
// verdade?" e a trava de `original.includes(de)` abaixo.
//
// A IRONIA, QUE E A MESMA DA `guarda-do-sed-dos-workflows`
// --------------------------------------------------------
// Este runner mede o aparelho de que ele mesmo depende. Se o `de` de um mutante
// parar de casar, `String.replace` nao troca nada, o oraculo roda sobre o motor
// INTACTO, sai verde -- e o mutante seria dado por vivo medindo nada. Por isso
// cada `de` e conferido antes de mutar.
//
// O QUE NAO ESTA AQUI, E POR QUE
// ------------------------------
// Nao ha mutante que troque `slice(0, 2)` por `slice(0, 3)` nas causas: com as
// duas familias do fixture, a terceira vaga sai vazia e a linha e identica.
// Mutante que emite saida byte a byte igual e mutante EQUIVALENTE, nao furo de
// assercao -- nenhuma assercao do mundo o mataria.
//
// E nao ha mutante do `.filter((n) => n !== "failing tests:")` que havia nesta
// cadeia porque o filtro NAO EXISTE MAIS, e foi este runner que o derrubou: o
// mutante que o desligava sobreviveu, e a investigacao mostrou que ele nunca
// disparava (o regex dos nomes exige ` (` depois do nome, e o cabecalho `✖
// failing tests:` termina a linha nos dois-pontos). Sobrevivente que esta certo
// -- filtro que nao filtra -- e divida, nao furo de assercao. Saiu do motor na
// HMO-405, junto com o mutante.
// =====================================================

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const ALVO = "scripts/mutantes-em-bloco.mjs";
const ORACULO = "causa-da-reprovacao";

const original = readFileSync(ALVO, "utf8");

/**
 * Todo mutante daqui apaga uma decisao de verdade da linha do `ABORTADO`, e
 * `test:causa-da-reprovacao` tem de acusar cada um: `esperado` e sempre "morre".
 */
const MUTANTES = [
  {
    // O DEFEITO ORIGINAL DA HMO-405, replantado: a causa volta a ser descartada
    // e so os nomes dos casos saem. Era este o estado da main em 0542622.
    nome: "a causa nao e extraida -- o regex de erro nao casa com nada",
    de: '/^ *([A-Za-z]*Error\\b[^:\\n]*: .+)$/gm',
    para: '/^ *([A-Za-z]*Error\\b[^:\\n]*: .+)$ZZNUNCA/gm',
  },
  {
    // A VAGA DA CAUSA EXISTE MAS NINGUEM A OCUPA.
    nome: "as causas sao extraidas e jogadas fora",
    de: "partes.push(`causa: ${causas.slice(0, 2).map((c) => c.slice(0, 200)).join(\" | \")}`);",
    para: "partes.push(`causa: ${causas.slice(0, 0).map((c) => c.slice(0, 200)).join(\" | \")}`);",
  },
  {
    // O MUTANTE QUE JUSTIFICA `formaDaCausa`. Sem colapsar por forma, as duas
    // vagas de causa saem ocupadas por dois `Cannot read properties of null` --
    // a contagem continua certa, os nomes continuam certos, e `CHROMIUM_BIN`
    // desaparece da linha. E o defeito da HMO-405 de volta, disfarcado.
    nome: "`formaDaCausa` para de colapsar: as derivadas afogam a que resolve",
    de: '  return causa.replace(/\'[^\']*\'/g, "\'~\'").replace(/"[^"]*"/g, \'"~"\');',
    para: "  return causa;",
  },
  {
    // So UMA causa sai. Com o colapso, a 1a e a do Chromium, entao a linha ainda
    // diria CHROMIUM_BIN -- quem mata este e a assercao de que a familia
    // DERIVADA tambem aparece, que e o que diz "ha erro em cascata atras".
    nome: "so a primeira familia de causa sai",
    de: "causas.slice(0, 2)",
    para: "causas.slice(0, 1)",
  },
  {
    // A forma `AssertionError [ERR_ASSERTION]: ...` deixa de casar, e com ela a
    // reprovacao por assercao -- o caso de longe mais frequente deste motor.
    nome: "o sufixo entre colchetes para de casar (AssertionError [ERR_ASSERTION])",
    de: "/^ *([A-Za-z]*Error\\b[^:\\n]*: .+)$/gm",
    para: "/^ *([A-Za-z]*Error\\b: .+)$/gm",
  },
  {
    nome: "a contagem de casos desaparece",
    de: 'if (nomes.length) partes.push(`${nomes.length} caso(s) reprovaram`);',
    para: 'if (nomes.length) partes.push("alguns caso(s) reprovaram");',
  },
  {
    // Cada nome de caso aparece DUAS vezes na saida do `node --test` (na lista
    // corrida e na secao `failing tests:`). Sem o `Set`, 47 falhas viram 94.
    nome: "os nomes nao sao deduplicados -- a contagem dobra",
    de: "[...new Set([...saida.matchAll(/✖ (.+?) \\(/g)].map((m) => m[1]))]",
    para: "[...[...saida.matchAll(/✖ (.+?) \\(/g)].map((m) => m[1])]",
  },
  {
    // A ORDEM. Se um consumidor truncar a linha, o que sobra tem de ser a parte
    // que diagnostica -- nao o nome do caso, que e a parte que mente.
    nome: "os nomes dos casos voltam para a frente da causa",
    de: "  if (nomes.length) partes.push(`${nomes.length} caso(s) reprovaram`);\n  if (causas.length) {",
    para: "  if (nomes.length) partes.push(`casos: ${nomes.slice(0, 3).join(\"; \")}`);\n  if (causas.length) {",
  },
  {
    nome: "saida irreconhecivel vira linha VAZIA em vez de `reprovou`",
    de: 'return partes.join(" -- ") || "reprovou";',
    para: 'return partes.join(" -- ");',
  },
];

const bloco = criarBlocoDeMutantes({
  rotulo: "causa-da-reprovacao",
  oraculos: { [ORACULO]: "npm run test:causa-da-reprovacao" },
});
// A sombra vive em diretorio temporario e sai junto com o processo. No pior caso
// (SIGTERM) sobra um diretorio orfao em /tmp -- e nao um `mutantes-em-bloco.mjs`
// mutado na arvore rastreada, que deixaria os outros 45 runners medindo um motor
// defeituoso sem ninguem saber.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// CONTROLE POSITIVO, antes de tudo. Sem ele, um erro neste script ou uma sombra
// mal montada que deixasse o oraculo sempre vermelho faria TODO mutante
// "morrer" e o placar mentiria verde do lado errado.
const controle = bloco.rodar("controle", {}, ORACULO);
if (!controle.verde) {
  console.log("RUIM  controle positivo: a arvore INTACTA ja esta vermelha");
  console.log(`      ${controle.saida}`);
  console.log("\nconserte a suite antes de medir mutante -- com ela vermelha,");
  console.log("todo mutante morre por motivo errado e este placar nao vale nada.");
  process.exit(1);
}
console.log("OK    controle positivo: a arvore intacta esta verde\n");

let falhas = 0;

for (const { nome, de, para, todas } of MUTANTES) {
  if (!original.includes(de)) {
    console.log(`RUIM  ANCORA MORTA   ${nome}`);
    console.log(`      \`${de.slice(0, 60)}\` nao existe mais em ${ALVO}`);
    falhas++;
    continue;
  }

  const mutado = todas ? original.replaceAll(de, para) : original.replace(de, para);
  if (mutado === original) {
    console.log(`RUIM  REPLACE NO-OP  ${nome}`);
    falhas++;
    continue;
  }

  const r = bloco.rodar(nome, { [ALVO]: mutado }, ORACULO);

  if (!r.verde) {
    console.log(`OK    morre          ${nome}`);
  } else {
    console.log(`RUIM  SOBREVIVE      ${nome}`);
    falhas++;
  }
}

console.log(
  falhas === 0
    ? `\n${MUTANTES.length}/${MUTANTES.length} mutantes mortos.`
    : `\n${falhas} mutante(s) SOBREVIVERAM -- a assercao nao mede o que diz medir.`
);
process.exit(falhas === 0 ? 0 : 1);
