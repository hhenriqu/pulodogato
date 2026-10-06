#!/usr/bin/env node
// =====================================================
// MUTANTES DE lib/moeda.ts (HMO-171)
// =====================================================
// Uma suite de 31 asercoes que nunca viu vermelho nao e evidencia de nada. Este
// script estraga lib/moeda.ts de um jeito por vez, roda `npm run test:moeda` e
// EXIGE que a suite reprove. Mutante que sobrevive aponta uma regra que o codigo
// afirma e o teste nao verifica.
//
// Cada mutacao e um defeito que alguem escreveria de verdade -- a ordem de dois
// `if`, um `!!` no lugar de `=== true`, um `+` sobre string -- e nao uma quebra
// artificial. A LISTA segue o mesmo espirito da de
// `scripts/mutantes-investments.mjs`; o APARELHO que a roda, nao mais -- ver
// abaixo.
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-320)
// --------------------------------------------------------
// Antes, cada mutante era escrito em `lib/moeda.ts` -- o arquivo que o git
// rastreia -- com uma copia de seguranca em `lib/moeda.ts.mutantes.bak` ao lado,
// e um `npm run test:moeda` inteiro era disparado por cima.
//
// O `.bak` e o `finally` nao bastavam, e nao por descuido: `finally` NAO roda em
// SIGTERM, que e exatamente o sinal que o `timeout` do shell e o cancelamento de
// job mandam. Este runner ja deixou `lib/moeda.ts` mutado com o `.bak` ao lado no
// meio de uma medicao (HMO-319) -- e dali em diante os blocos seguintes mediram o
// arquivo errado, sem nada no placar dizendo isso.
//
// `criarBlocoDeMutantes` tira o problema da raiz em vez de melhorar a restauracao:
// a mutacao vai para uma SOMBRA em diretorio temporario e `lib/moeda.ts` nunca e
// tocado, entao nao existe mais o estado "mutante na arvore" para restaurar. De
// quebra, a compilacao e em processo e as voltas dividem o AST de tudo que nao e
// o arquivo mutado.
//
// O PIPELINE VEM DO `test:moeda` no package.json em vez de repetido aqui -- e ele
// tem um passo que este runner nunca soube que existia (`resolve-aliases`).
//
// O CONTROLE POSITIVO passou a existir, e era o que faltava: sem ele uma sombra
// mal montada reprova TODO mutante e o placar sai "14/14 mortos" sobre zero
// assercoes executadas.
//
// Roda com: node scripts/mutantes-moeda.mjs
// =====================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const FONTE = "lib/moeda.ts";
const ALVO = fileURLToPath(new URL("../lib/moeda.ts", import.meta.url));
const SUITE = "test:moeda";

const MUTANTES = [
  {
    nome: "moedaSugerida: a conta ganha do lancamento (ordem invertida)",
    de: `  if (moedaConhecida(entrada.doLancamento)) {
    return String(entrada.doLancamento).trim().toUpperCase();
  }
  if (moedaConhecida(entrada.daConta)) {
    return String(entrada.daConta).trim().toUpperCase();
  }`,
    para: `  if (moedaConhecida(entrada.daConta)) {
    return String(entrada.daConta).trim().toUpperCase();
  }
  if (moedaConhecida(entrada.doLancamento)) {
    return String(entrada.doLancamento).trim().toUpperCase();
  }`,
  },
  {
    nome: "porLancamento: truthy no lugar de === true",
    de: "porLancamento: bloco.porLancamento === true,",
    para: "porLancamento: Boolean(bloco.porLancamento),",
  },
  {
    nome: "resumirPorMoeda: nao filtra moeda sem movimento",
    de: `  const blocos = Array.from(porMoeda.values()).filter(
    (b) => b.transacoes > 0 || b.income !== 0 || b.expense !== 0
  );`,
    para: "  const blocos = [...porMoeda.values()];",
  },
  {
    nome: "resumirPorMoeda: esconde a moeda cujos lancamentos se anulam",
    de: "(b) => b.transacoes > 0 || b.income !== 0 || b.expense !== 0",
    para: "(b) => b.income !== 0 || b.expense !== 0",
  },
  {
    nome: "numero(): numeric do Postgres (string) nao e convertido",
    de: `  if (typeof valor === "string") {
    const n = Number.parseFloat(valor);
    return Number.isFinite(n) ? n : 0;
  }`,
    para: `  if (typeof valor === "string") {
    return valor as unknown as number;
  }`,
  },
  {
    nome: "ordem: por net em vez de por volume",
    de: "    const volume = b.income + b.expense - (a.income + a.expense);",
    para: "    const volume = b.net - a.net;",
  },
  {
    nome: "ordem: a moeda oficial nao vem primeiro",
    de: `    if (a.moeda === oficial && b.moeda !== oficial) return -1;
    if (b.moeda === oficial && a.moeda !== oficial) return 1;`,
    para: "",
  },
  {
    nome: "mesclar: troca o bloco de moeda inteiro (apaga chave desconhecida)",
    de: "[CHAVE_DE_MOEDA]: { ...bloco, oficial: nova.oficial, porLancamento: nova.porLancamento },",
    para: "[CHAVE_DE_MOEDA]: { oficial: nova.oficial, porLancamento: nova.porLancamento },",
  },
  {
    nome: "mesclar: escreve so a moeda (apaga o resto do jsonb do perfil)",
    de: `  return {
    ...raiz,
    [CHAVE_DE_MOEDA]: { ...bloco, oficial: nova.oficial, porLancamento: nova.porLancamento },
  };`,
    para: `  return {
    [CHAVE_DE_MOEDA]: { ...bloco, oficial: nova.oficial, porLancamento: nova.porLancamento },
  };`,
  },
  {
    nome: "validar: aceita porLancamento nao booleano",
    de: `  if (typeof bloco.porLancamento !== "boolean") {
    return { ok: false, erro: "Envie \`porLancamento\` como booleano" };
  }`,
    para: "",
  },
  {
    nome: "validar: corrige moeda desconhecida em vez de recusar",
    de: `  if (!moedaConhecida(bloco.oficial)) {
    return { ok: false, erro: "Escolha uma moeda da lista" };
  }`,
    para: "",
  },
  {
    nome: "resumirPorMoeda: descarta a linha sem moeda",
    de: "    const codigo = moedaSugerida({ doLancamento: linha.currency });",
    para: `    if (!linha.currency) continue;
    const codigo = moedaSugerida({ doLancamento: linha.currency });`,
  },
  {
    nome: "periodoTemVariasMoedas: conta linhas em vez de blocos com movimento",
    de: "  return resumirPorMoeda(linhas, moedaOficial).length > 1;",
    para: "  return new Set((linhas ?? []).map((l) => l.currency ?? \"BRL\")).size > 1;",
  },
  {
    nome: "opcoesDeMoeda: rotulo so com o simbolo",
    de: "    rotulo: `${m.codigo} - ${m.nome} (${m.simbolo})`,",
    para: "    rotulo: m.simbolo,",
  },
];

const original = readFileSync(ALVO, "utf8");
const bloco = criarBlocoDeMutantes({ rotulo: "moeda", suites: [SUITE] });
// A sombra vive em diretorio temporario e sai junto com o processo. No pior caso
// (SIGTERM) sobra um diretorio orfao em /tmp -- e nao um `lib/moeda.ts` mutado
// com um `.bak` ao lado, que era o que acontecia.
process.on("exit", () => bloco.fechar());

// CONTROLE POSITIVO: a arvore INTACTA tem de passar antes de qualquer mutante.
// `rodar` com `{}` compila e roda a sombra sem sobrescrita nenhuma, pelo mesmo
// aparelho que os mutantes vao usar -- e por isso ele pega erro NO APARELHO.
const controle = bloco.rodar("controle", {}, SUITE);
if (!controle.verde) {
  console.error(`CONTROLE FALHOU: ${FONTE} intacto reprova na suite (${controle.como})`);
  console.error(`  ${controle.saida}`);
  console.error("O placar abaixo nao valeria: todo mutante 'morreria' sem ter sido medido.");
  process.exit(1);
}
console.log(`CTRL  ${FONTE} intacto passa na suite\n`);

let mortos = 0;
const sobreviventes = [];

for (const mutante of MUTANTES) {
  if (!original.includes(mutante.de)) {
    console.log(`SKIP  ${mutante.nome}`);
    console.log("      o trecho nao existe mais no arquivo -- atualize o mutante");
    sobreviventes.push(`${mutante.nome} (trecho ausente)`);
    continue;
  }

  const r = bloco.rodar(
    mutante.nome,
    { [FONTE]: original.replace(mutante.de, mutante.para) },
    SUITE
  );

  if (!r.verde) {
    mortos++;
    // O tsc reprovando tambem conta como morto -- um mutante que nao compila nao
    // chega em producao. Mas vale distinguir na saida: um erro de tipo nao diz
    // que a SUITE pegou a regra. A distincao vem do bloco agora, e nao de um
    // grep por `error TS` na saida misturada do npm.
    console.log(`MORTO ${mutante.nome}  (${r.como === "tsc" ? "tsc" : "asercao"})`);
  } else {
    console.log(
      `VIVO  ${mutante.nome}` +
        (r.mudouASaida === false
          ? "  (saida compilada identica a da arvore limpa: EQUIVALENTE)"
          : "")
    );
    sobreviventes.push(mutante.nome);
  }
}

console.log(`\n${mortos}/${MUTANTES.length} mortos.`);

if (sobreviventes.length > 0) {
  console.log("\nSOBREVIVENTES:");
  for (const nome of sobreviventes) console.log(`  - ${nome}`);
  process.exit(1);
}
