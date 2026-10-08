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
//   npm run mutantes:contrato-dos-cartoes

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ALVO = "components/movimentacoes/CartoesDaTela.tsx";
const SUITE = "scripts/test-contrato-das-telas-de-movimentacao.mjs";

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

/** Roda a suite e devolve true se ela ficou VERMELHA. */
function suiteVermelha() {
  try {
    execFileSync("node", ["--test", SUITE], { stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
}

let falhas = 0;

// CONTROLE POSITIVO, antes de tudo. Sem ele, um erro neste script que deixasse
// a suite sempre vermelha faria TODO mutante "morrer" e o placar mentiria
// verde do lado errado.
if (suiteVermelha()) {
  console.log("RUIM  controle positivo: a arvore INTACTA ja esta vermelha");
  console.log("\nconserte a suite antes de medir mutante -- com ela vermelha,");
  console.log("todo mutante morre por motivo errado e este placar nao vale nada.");
  process.exit(1);
}
console.log("OK    controle positivo: a arvore intacta esta verde\n");

for (const { nome, de, para, todas } of MUTANTES) {
  if (!original.includes(de)) {
    console.log(`RUIM  ANCORA MORTA   ${nome}`);
    console.log(`      \`${de.slice(0, 60)}\` nao existe mais em ${ALVO}`);
    falhas++;
    continue;
  }

  const mutado = todas
    ? original.replaceAll(de, para)
    : original.replace(de, para);

  writeFileSync(ALVO, mutado);
  let vermelha;
  try {
    vermelha = suiteVermelha();
  } finally {
    writeFileSync(ALVO, original);
  }

  if (vermelha) {
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
