#!/usr/bin/env node
// Prova de mutacao da calculadora dos tres campos -- HMO-446 (F2 da HMO-444).
//
//   node scripts/mutantes-juros-do-emprestimo.mjs
//
// Cada entrada estraga UMA decisao de aritmetica; `npm run
// test:juros-do-emprestimo` tem de ficar VERMELHA em todas. Mutante que
// sobrevive e um trecho que nenhuma assercao distingue.
//
// OS DOIS QUE A ISSUE NOMEIA SAO OS DOIS PRIMEIROS DA LISTA
// ---------------------------------------------------------
//   1. `(1 + taxa)` -> `(1 - taxa)`
//   2. o rateio sem a ULTIMA PARCELA ABSORVENDO O CENTAVO
//
// Se qualquer um dos dois sobrevive, nenhum outro compensa -- a suite nao
// estaria medindo a feature.
//
// POR QUE ESTES DOIS, E POR QUE ELES NAO DAO ERRO EM LUGAR NENHUM
// ---------------------------------------------------------------
// O primeiro inverte o sinal do juro: "emprestei R$ 1.000 a 20%" passa a dizer
// "vou receber R$ 800". Nada compila errado e nada responde 500 -- a serie e
// montada sobre esse total, as 12 parcelas somam R$ 800 exatos, e o banco
// aceita tudo (`amount > 0`, `principal > 0`). O que acontece e que o MyBank
// empresta a juros e DEVOLVE MENOS do que saiu da conta de investimento, com
// todas as somas fechando.
//
// O segundo nao erra nenhuma linha: ele erra o TOTAL. 12 parcelas de R$ 100 num
// 1000/1200 rateiam 83,33 de principal cada, e 12 x 83,33 = 999,96. Cada perna
// `transfer` fica plausivel, cada perna `income` fica plausivel, e 4 centavos de
// principal viram juro sem que nenhuma das 24 linhas explique por que. Por isso
// a assercao que o mata e de SOMA -- uma assercao por parcela o absolveria.
//
// A FORMA DA LISTA E A DA FAMILIA TUPLA DE ARIDADE 4
// -------------------------------------------------
// `scripts/mede-ancora-ambigua.mjs` -- a guarda que reprova ancora morta,
// ambigua ou de arquivo inexistente em TODO runner do repo -- le a lista de
// verdade usando o recorte de `converte-mutantes-em-bloco.mjs`. Ele exige a
// tupla `[ALVO, rotulo, de, para]` e que nenhuma `const` MULTILINHA seja
// declarada antes da lista: o recorte corta ate o proximo `\n];`, e um `const
// original = new Map(...)` multilinha ali levaria a lista inteira embora. Por
// isso o `original` e montado DEPOIS da lista, e so a `const LIB` de uma linha
// vem antes. Ver `runner-fora-da-forma-canonica-derruba-a-guarda-de-ancora`.
//
// AS ANCORAS SAO LINHAS INTEIRAS, COM INDENTACAO
// ----------------------------------------------
// O cabecalho da lib CITA a propria aritmetica na prosa (`total = principal x
// (1 + taxa)`, `taxa = total / principal - 1`), e uma ancora curta mutaria o
// COMENTARIO e deixaria o codigo intacto -- com o placar dizendo "sobreviveu"
// sobre um mutante que nunca existiu. A trava de ocorrencia unica abaixo pega
// isso, mas a defesa barata e a ancora carregar `params.`, o `return` e a
// margem, que a prosa nao tem.
//
// E DUAS LINHAS DA LIB SAO IDENTICAS DE PROPOSITO
// -----------------------------------------------
// `return Math.round(bruta * fator) / fator;` aparece DUAS vezes (em
// `taxaDoEmprestimo` e em `taxaMensalEquivalente`). As ancoras dos dois levam a
// linha do `fator` junto, que e o que as distingue -- `CASAS_DA_TAXA` contra
// `CASAS_DA_TAXA_MENSAL`.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const LIB = "lib/juros-do-emprestimo.ts";

/** [alvo, rotulo, de, para] */
const mutantes = [
  // =========================================================================
  // OS DOIS QUE A ISSUE NOMEIA
  // =========================================================================

  [
    LIB,
    "(1 + taxa) VIRA (1 - taxa): emprestar a juros devolve MENOS",
    "  return reais(Math.round(principalEmCentavos * (1 + params.taxa)));",
    "  return reais(Math.round(principalEmCentavos * (1 - params.taxa)));",
  ],

  [
    LIB,
    "O RATEIO PERDE A ABSORCAO DO CENTAVO (a soma do principal nao fecha)",
    "      i === ultima\n        ? principalEmCentavos - principalJaRateado\n        : Math.round(",
    "      false\n        ? principalEmCentavos - principalJaRateado\n        : Math.round(",
  ],

  // =========================================================================
  // O SENTIDO DIRETO E O INVERSO
  // =========================================================================

  [
    LIB,
    "a inversa esquece o `- 1`: devolve o FATOR (1,2) no lugar da taxa (0,2)",
    "  const bruta = totalEmCentavos / principalEmCentavos - 1;",
    "  const bruta = totalEmCentavos / principalEmCentavos;",
  ],

  [
    LIB,
    "a inversa divide ao contrario (principal / total)",
    "  const bruta = totalEmCentavos / principalEmCentavos - 1;",
    "  const bruta = principalEmCentavos / totalEmCentavos - 1;",
  ],

  [
    LIB,
    "CASAS_DA_TAXA sobe para 6: o ida-e-volta deixa de fechar",
    "export const CASAS_DA_TAXA = 4;",
    "export const CASAS_DA_TAXA = 6;",
  ],

  [
    LIB,
    "a taxa recuperada NAO e arredondada: o ida-e-volta nao fecha em nenhum par",
    "  const fator = Math.pow(10, CASAS_DA_TAXA);\n  return Math.round(bruta * fator) / fator;",
    "  const fator = Math.pow(10, CASAS_DA_TAXA);\n  return bruta;",
  ],

  // =========================================================================
  // O JURO EM REAIS
  // =========================================================================

  [
    LIB,
    "o juro troca de sinal (principal - total)",
    "  return reais(totalEmCentavos - principalEmCentavos);",
    "  return reais(principalEmCentavos - totalEmCentavos);",
  ],

  // =========================================================================
  // A TAXA MENSAL EQUIVALENTE
  // =========================================================================

  [
    LIB,
    "a mensal vira taxa/parcelas (1,67% em vez de 1,53%: emprestimo mais caro)",
    "  const bruta = Math.pow(1 + params.taxa, 1 / params.parcelas) - 1;",
    "  const bruta = params.taxa / params.parcelas;",
  ],

  [
    LIB,
    "a mensal nao e arredondada (20% em 1x mostra 19,999999999999996%)",
    "  const fator = Math.pow(10, CASAS_DA_TAXA_MENSAL);\n  return Math.round(bruta * fator) / fator;",
    "  const fator = Math.pow(10, CASAS_DA_TAXA_MENSAL);\n  return bruta;",
  ],

  // =========================================================================
  // O RATEIO -- os outros jeitos de ele errar
  // =========================================================================

  [
    LIB,
    "a parcela inteira vira PRINCIPAL (cobrar juros nunca aparece em Receitas)",
    "  const parteDoPrincipal = Math.round(\n    (amountEmCentavos * principalEmCentavos) / totalEmCentavos\n  );",
    "  const parteDoPrincipal = amountEmCentavos;",
  ],

  [
    LIB,
    "a parcela inteira vira JURO (o principal conta como salario 12 vezes)",
    "  const parteDoPrincipal = Math.round(\n    (amountEmCentavos * principalEmCentavos) / totalEmCentavos\n  );",
    "  const parteDoPrincipal = 0;",
  ],

  [
    LIB,
    "o rateio aceita serie que NAO soma o total",
    "  if (somaDasParcelas !== totalEmCentavos) return null;",
    "  if (false) return null;",
  ],

  [
    LIB,
    "o rateio deixa passar parte-principal NEGATIVA (perna de sinal trocado)",
    "    if (parteDoPrincipal < 0 || parteDoPrincipal > amountEmCentavos) {",
    "    if (false) {",
  ],

  // =========================================================================
  // AS RECUSAS
  // =========================================================================

  [
    LIB,
    "principal ZERO passa (a inversa viraria divisao por zero)",
    "  if (principalEmCentavos <= 0) return \"principal_nao_positivo\";",
    "  if (principalEmCentavos < 0) return \"principal_nao_positivo\";",
  ],

  [
    LIB,
    "TAXA NEGATIVA passa (a perna de income da F5 gravaria receita negativa)",
    "    if (taxa < 0) return \"taxa_negativa\";",
    "    if (taxa < -1) return \"taxa_negativa\";",
  ],

  [
    LIB,
    "TOTAL MENOR QUE O PRINCIPAL passa (emprestar 1.000 para receber 900)",
    "    if (totalEmCentavos < principalEmCentavos) {",
    "    if (totalEmCentavos < 0) {",
  ],

  [
    LIB,
    "a taxa absurda passa (1000% deixa de ter teto, e a 060 responde 23514)",
    "    if (taxa > TAXA_MAXIMA) return \"taxa_absurda\";",
    "    if (taxa > 1e9) return \"taxa_absurda\";",
  ],

  // =========================================================================
  // OS DOIS SENTIDOS JUNTOS
  // =========================================================================

  [
    LIB,
    "a previa aceita taxa E total juntos (e escolhe um calado quando discordam)",
    "  if (temTaxa && temTotal) return null;",
    "  if (false) return null;",
  ],

  [
    LIB,
    "os centavos truncam em vez de arredondar (R$ 0,10 vira 9 centavos)",
    "  return Math.round(valor * 100);",
    "  return Math.trunc(valor * 100);",
  ],
];

const SUITE = "test:juros-do-emprestimo";

const bloco = criarBlocoDeMutantes({
  suites: [SUITE],
  rotulo: "juros-do-emprestimo",
});

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela. Montado DEPOIS da lista -- ver A FORMA DA LISTA, no cabecalho.
const original = new Map();
for (const arquivo of new Set(mutantes.map(([alvo]) => alvo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO: a arvore limpa tem de passar. Sem ele, uma suite ja
// vermelha deixaria TODO mutante aparecendo como morto e o placar sairia cheio
// sem medir nada -- `suite-vermelha-faz-todo-controle-negativo-passar-vacuo`.
const limpo = bloco.rodar("<arvore limpa>", {}, SUITE);
if (!limpo.verde) {
  console.error(
    "controle positivo REPROVOU: a suite ja esta vermelha sem mutante nenhum. " +
      "Todo mutante abaixo apareceria como MORTO sem medir nada."
  );
  bloco.fechar();
  process.exit(1);
}
console.log("controle positivo: arvore limpa VERDE.\n");

let mortos = 0;
const sobreviventes = [];

for (const [arquivo, rotulo, de, para] of mutantes) {
  const fonte = original.get(arquivo);
  const ocorrencias = fonte.split(de).length - 1;

  if (ocorrencias === 0) {
    console.error(
      `ANCORA MORTA  ${rotulo}\n  ${arquivo} nao contem o trecho procurado. ` +
        "Isto e erro do runner, nao mutante morto -- conserte a ancora."
    );
    bloco.fechar();
    process.exit(1);
  }

  // A TRAVA DE OCORRENCIA UNICA. `String.replace` troca a PRIMEIRA ocorrencia:
  // um `de` que aparece duas vezes muta um lugar que o rotulo nao descreve. O
  // risco e concreto neste arquivo -- o cabecalho CITA a aritmetica na prosa, e
  // `return Math.round(bruta * fator) / fator;` existe duas vezes no codigo.
  if (ocorrencias > 1) {
    console.error(
      `ANCORA AMBIGUA  ${rotulo}\n  o trecho aparece ${ocorrencias}x em ${arquivo} ` +
        "-- o replace muta so a 1a. Isto e erro do runner; estreite a ancora."
    );
    bloco.fechar();
    process.exit(1);
  }

  const mutado = fonte.replace(de, para);

  if (mutado === fonte) {
    console.error(
      `MUTACAO NO-OP  ${rotulo}\n  o replace nao mudou o texto de ${arquivo}.`
    );
    bloco.fechar();
    process.exit(1);
  }

  const r = bloco.rodar(rotulo, { [arquivo]: mutado }, SUITE);

  if (!r.verde) {
    mortos += 1;
    console.log(`MORTO      ${rotulo}`);
  } else {
    sobreviventes.push(rotulo);
    console.log(`SOBREVIVEU ${rotulo}`);
    if (r.mudouASaida === false) {
      console.log(
        "           (saida compilada identica a da arvore limpa: EQUIVALENTE)"
      );
    }
  }
}

bloco.fechar();

console.log(`\n${mortos}/${mutantes.length} mortos.`);
if (sobreviventes.length > 0) {
  console.log("\nsobreviventes:");
  for (const s of sobreviventes) console.log(`  - ${s}`);
}

// Sai 1 com sobrevivente: um runner que saisse 0 deixaria o step de CI verde
// para sempre e provaria o mesmo que step nenhum.
process.exit(sobreviventes.length === 0 ? 0 : 1);
