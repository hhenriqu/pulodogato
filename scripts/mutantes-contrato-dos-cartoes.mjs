#!/usr/bin/env node
// Controle negativo das assercoes que o `test:contrato-das-telas-de-movimentacao`
// faz sobre `components/movimentacoes/CartoesDaTela.tsx` (HMO-250).
//
// POR QUE ESTE RUNNER EXISTE
//
// Aquele guard existe porque `await res.json()` e `any`: um campo renomeado
// entre `app/api/movimentacoes/resumo/route.ts` e o cartao chega `undefined`,
// o `?? 0` o pinta como R$ 0,00 e nada reclama. O guard e textual, e um guard
// textual tem duas mortes silenciosas:
//
//   1. ele fica VERMELHO por motivo errado (foi o que a HMO-250 achou: os tres
//      numeros sairam para CartoesDaTela.tsx na HMO-246 e as assercoes ficaram
//      apontadas para TelaDeMovimentacao.tsx). Vermelho, ele nao guarda nada --
//      e treina quem o ve a ignorar a suite inteira;
//   2. ele fica VERDE POR AUSENCIA -- casa com a prosa de um comentario, ou se
//      contenta com um de dois pontos de uso.
//
// A (1) o proprio `npm test` acusa. A (2) so este runner acusa: cada mutante
// abaixo apaga UM campo ou UM pedagio do cartao e exige que a suite fique
// VERMELHA. Mutante que sobrevive = assercao que nao mede o que diz medir.
//
// O caso que motivou o runner: os DOIS pedagios. `podeMostrarNumero(estado) &&
// resumo` aparece duas vezes em CartoesDaTela.tsx e guarda coisas diferentes --
// um dentro de `numero()` (os tres valores em dinheiro) e um na contagem
// embaixo do Total, que nao passa por `numero()`. Um `assert.match` solto pelo
// trecho se contentava com QUALQUER um dos dois: matar o de dentro de
// `numero()` pintava os tres cartoes de R$ 0,00 sem dado e a suite seguia
// verde. Cada pedagio passou a ser ancorado no seu ponto de uso, e os dois
// mutantes "SOZINHO" abaixo sao o que prova isso.
//
// O BLOCO: A MUTACAO VAI PARA UMA SOMBRA, NUNCA PARA A ARVORE (HMO-348)
// -----------------------------------------------------------------------
// Este runner mutava CartoesDaTela.tsx NO LUGAR -- escrevia o mutante no
// arquivo rastreado, rodava a suite com `execFileSync` e restaurava no
// `finally`. `scripts/check-mutacao-no-lugar.mjs` (HMO-327) passou a reprovar
// todo runner NOVO que faca isso: o `finally` nao roda em SIGTERM, que e
// exatamente o sinal que o `timeout` do shell e o cancelamento de job mandam, e
// o mutante fica GRAVADO na arvore quando o processo morre no meio.
//
// A suite aqui NAO COMPILA NADA -- ela le o TEXTO de CartoesDaTela.tsx, nao um
// artefato emitido. Por isso ela entra em `oraculos`, e nao em `suites`:
// `criarBlocoDeMutantes` recusa um oraculo que compila e recusa uma suite sem
// etapa de compilacao, e a razao de valer para este caso e que a sombra ja
// materializa o arquivo mutado EM DISCO (fora da arvore rastreada) para que o
// `readFileSync` do guard leia o mutante sem a arvore de verdade ser tocada.
//
// Para um oraculo, `mudouASaida` vem `null` de proposito -- nao ha artefato
// compilado para comparar com o controle --, entao quem responde "a mutacao
// aconteceu de verdade?" e a trava de `original.includes(de)` abaixo, nao essa
// resposta do bloco.
//
//   npm run mutantes:contrato-dos-cartoes

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const ALVO = "components/movimentacoes/CartoesDaTela.tsx";
const ORACULO = "contrato";

const original = readFileSync(ALVO, "utf8");

/**
 * `esperado` e sempre "morre": todo mutante daqui apaga uma leitura ou um
 * pedagio de verdade, e a suite tem de acusar cada um deles.
 */
const MUTANTES = [
  {
    nome: "o Total deixa de ler resumo?.total",
    de: "{numero(resumo?.total)}",
    para: "{numero(resumo?.soma)}",
  },
  {
    nome: "o Previsto deixa de ler resumo?.previsto",
    de: "{numero(resumo?.previsto)}",
    para: "{numero(resumo?.soma)}",
  },
  {
    nome: "o Realizado deixa de ler resumo?.realizado",
    de: "{numero(resumo?.realizado)}",
    para: "{numero(resumo?.soma)}",
  },
  {
    nome: "a contagem deixa de ler resumo.quantidade",
    de: "${resumo.quantidade} lan",
    para: "${resumo.contagem} lan",
  },
  {
    // Os tres valores em dinheiro perdem o travessao: sem dado eles pintam
    // R$ 0,00, que e exatamente a mentira que o pedagio existe para evitar.
    nome: "o pedagio de dentro de `numero()`, SOZINHO",
    de: "podeMostrarNumero(estado) && resumo ? (",
    para: "true ? (",
  },
  {
    // A contagem perde o travessao: sem dado ela afirma "0 lançamento(s)".
    nome: "o pedagio da contagem, SOZINHO",
    de: "{podeMostrarNumero(estado) && resumo\n              ? `${resumo.quantidade}",
    para: "{true\n              ? `${resumo.quantidade}",
  },
  {
    nome: "os DOIS pedagios de uma vez",
    de: "podeMostrarNumero(estado) && resumo",
    para: "true",
    todas: true,
  },
  {
    nome: "o travessao em si desaparece",
    de: "<NumeroIndisponivel />",
    para: "<span />",
  },
];

const bloco = criarBlocoDeMutantes({
  rotulo: "contrato-dos-cartoes",
  oraculos: { [ORACULO]: "npm run test:contrato-das-telas-de-movimentacao" },
});
// A sombra vive em diretorio temporario e sai junto com o processo. No pior
// caso (SIGTERM) sobra um diretorio orfao em /tmp -- e nao um
// `CartoesDaTela.tsx` mutado na arvore rastreada, que era o modo de falhar que
// esta conversao fecha.
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
