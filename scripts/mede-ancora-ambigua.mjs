#!/usr/bin/env node
// =====================================================
// A ANCORA AMBIGUA: quantas vezes cada `de` aparece no arquivo que ele muta
// =====================================================
// Roda com:  node scripts/mede-ancora-ambigua.mjs [runner.mjs ...]
//            (sem argumento: todos os runners da familia do painel)
//
// POR QUE ISTO EXISTE (HMO-328)
// -----------------------------
// A conversao dos runners da familia do painel para o bloco ACRESCENTOU uma
// trava que a familia nao tinha: `de` que aparece mais de uma vez no arquivo e
// mutante invalido. A familia HMO-246 ja tinha essa trava; esta so checava se o
// trecho EXISTE.
//
// A razao da trava: `String.replace(de, para)` troca a PRIMEIRA ocorrencia. Se o
// trecho aparece duas vezes, o mutante muta um lugar que o seu proprio `nome` nao
// descreve. Quando esse outro lugar nao e medido pela suite, o mutante SOBREVIVE
// -- e o placar passa a dizer "nenhuma assercao protege X" sobre um X que nunca
// foi mutado.
//
// MAS ACRESCENTAR TRAVA MUDA O PLACAR, e um placar que muda junto com o
// encanamento e um placar que ninguem consegue comparar com o de ontem. Por isso
// a pergunta "algum `de` de hoje e ambiguo?" foi MEDIDA antes de a trava entrar,
// e nao suposta -- e e isto que mede.
//
// A resposta esta logo abaixo: nenhuma. A trava entrou sem mexer em veredito
// nenhum, e passa a valer para o mutante que vier depois.
//
// POR QUE ELE LE A LISTA EM VEZ DE A REESCREVER
// ---------------------------------------------
// A lista de mutantes e a unica parte de um runner que carrega conhecimento que
// nao esta em nenhum outro lugar. Este arquivo nao copia nenhuma entrada: ele
// recorta o miolo do runner (`mioloDoPainel`, o mesmo recorte que o conversor
// usa) e o IMPORTA como modulo de dados, entao o que ele mede e a lista de
// verdade, e ele nao pode divergir dela.
//
// Medido em 2026-10-07: 72 mutantes nos cinco runners desta familia, nenhum com
// ancora ambigua -- e NOVE com ancora MORTA (seis em `detalhe-do-painel`, dois em
// `sobra-ou-falta`, um em `painel-na-tela`), que e outro assunto e tem issue
// propria. Os vereditos dos tres runners convertidos pela HMO-328 sao identicos
// antes e depois da conversao, com esses nove inclusive.
//
// O CONTROLE POSITIVO DELE
// ------------------------
// Um medidor que nao acha mutante nenhum imprime "0 ambiguas" e parece um boletim
// limpo -- e a forma mais facil de isto mentir. Por isso ele SAI COM ERRO se um
// runner rendeu zero mutantes, e imprime o total lido por runner: o numero tem de
// casar com o que o proprio runner imprime no fim ("N/N mortos").
// =====================================================

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ehDoPainel, mioloDoPainel } from "./converte-mutantes-em-bloco.mjs";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/** A lista `mutantes` de um runner, carregada do proprio arquivo. */
async function lerMutantes(runner) {
  const fonte = readFileSync(runner, "utf8");
  const { miolo } = mioloDoPainel(fonte);
  // O miolo e so declaracoes `const` -- as constantes de arquivo e a lista --,
  // entao importa-lo como modulo de dados nao executa driver nenhum.
  const url = `data:text/javascript,${encodeURIComponent(`${miolo}\nexport { mutantes };`)}`;
  return (await import(url)).mutantes;
}

// O ARQUIVO QUE CONTEM UM RUNNER DE MENTIRA DENTRO DE UMA STRING.
//
// `mutantes-conferidor-da-conversao.mjs` carrega o FIXTURE dele -- um runner
// completo da familia do painel -- num template literal. Visto de fora, ele casa
// com `ehDoPainel` como qualquer runner de verdade, e a varredura tentava medir
// as ancoras do fixture contra `lib/exemplo.ts`, que nao existe (ENOENT).
//
// E a familia de "sonda que se mede a si mesma": o aparelho entrou no proprio
// censo. Excluir pelo NOME e deliberado -- excluir "todo runner cujo arquivo nao
// existe" calaria justamente o defeito que vale reportar (runner que aponta para
// arquivo apagado).
const APARELHO = new Set(["scripts/mutantes-conferidor-da-conversao.mjs"]);

const alvos = process.argv.slice(2);
const runners = alvos.length
  ? alvos
  : readdirSync(path.join(RAIZ, "scripts"))
      .filter((f) => /^mutantes-.*\.mjs$/.test(f))
      .map((f) => path.join("scripts", f))
      .filter((f) => !APARELHO.has(f))
      // O MESMO predicado que o conversor usa para escolher a familia. Escrever
      // o criterio a mao aqui ja deu errado uma vez neste arquivo: `const
      // mutantes = [` sozinho arrasta os runners da familia "tupla", cujo miolo
      // nem carrega como modulo de dados.
      .filter((f) => ehDoPainel(readFileSync(path.join(RAIZ, f), "utf8")));

let ambiguas = 0;
let ausentes = 0;
let total = 0;

for (const runner of runners) {
  const mutantes = await lerMutantes(path.resolve(RAIZ, runner));
  if (mutantes.length === 0) {
    console.error(`ABORTADO: ${runner} rendeu ZERO mutantes -- a leitura da lista quebrou.`);
    process.exit(1);
  }
  total += mutantes.length;

  const achados = [];
  for (const m of mutantes) {
    // Arquivo apagado e um defeito a RELATAR, nao uma excecao a propagar: um
    // runner que aponta para um arquivo que nao existe mais nunca mede nada, e o
    // stack trace do ENOENT esconde de qual runner e qual mutante se trata.
    let texto;
    try {
      texto = readFileSync(path.join(RAIZ, m.arquivo), "utf8");
    } catch {
      achados.push({ nome: m.nome, arquivo: m.arquivo, n: null });
      continue;
    }
    const n = texto.split(m.de).length - 1;
    if (n !== 1) achados.push({ nome: m.nome, arquivo: m.arquivo, n });
  }

  console.log(`${runner}: ${mutantes.length} mutantes`);
  for (const a of achados) {
    // Zero e "ancora morta" (a feature apagou o trecho) e e outro assunto; o que
    // esta medicao persegue e o >1, que e o que a trava nova recusa.
    const rotulo =
      a.n === null
        ? "ARQUIVO AUSENTE"
        : a.n === 0
          ? "ancora MORTA"
          : `ancora AMBIGUA (${a.n}x)`;
    console.log(`   ${rotulo}  ${a.nome}  [${a.arquivo}]`);
    if (a.n !== null && a.n > 1) ambiguas++;
    if (a.n === null) ausentes++;
  }
}

console.log(
  `\n${total} mutantes lidos, ${ambiguas} com ancora ambigua (>1 ocorrencia)` +
    (ausentes > 0 ? `, ${ausentes} apontando para arquivo AUSENTE` : ""),
);
process.exit(ambiguas === 0 && ausentes === 0 ? 0 : 1);
