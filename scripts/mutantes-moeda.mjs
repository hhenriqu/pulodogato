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
// artificial. Ver `scripts/mutantes-investments.mjs`, mesmo desenho.
//
// Roda com: node scripts/mutantes-moeda.mjs
// =====================================================

import { execSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ALVO = fileURLToPath(new URL("../lib/moeda.ts", import.meta.url));
const BACKUP = `${ALVO}.mutantes.bak`;

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
    de: `  const blocos = [...porMoeda.values()].filter(
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
copyFileSync(ALVO, BACKUP);

let mortos = 0;
const sobreviventes = [];

try {
  for (const mutante of MUTANTES) {
    if (!original.includes(mutante.de)) {
      console.log(`SKIP  ${mutante.nome}`);
      console.log("      o trecho nao existe mais no arquivo -- atualize o mutante");
      sobreviventes.push(`${mutante.nome} (trecho ausente)`);
      continue;
    }

    writeFileSync(ALVO, original.replace(mutante.de, mutante.para));

    let reprovou = false;
    let motivo = "";
    try {
      execSync("npm run test:moeda", { stdio: "pipe", encoding: "utf8" });
    } catch (erro) {
      reprovou = true;
      const saida = `${erro.stdout ?? ""}${erro.stderr ?? ""}`;
      // O tsc reprovando tambem conta como morto -- um mutante que nao compila
      // nao chega em producao. Mas vale distinguir na saida: um erro de tipo nao
      // diz que a SUITE pegou a regra.
      motivo = /error TS\d+/.test(saida) ? "tsc" : "asercao";
    }

    if (reprovou) {
      mortos++;
      console.log(`MORTO ${mutante.nome}  (${motivo})`);
    } else {
      console.log(`VIVO  ${mutante.nome}`);
      sobreviventes.push(mutante.nome);
    }
  }
} finally {
  copyFileSync(BACKUP, ALVO);
  unlinkSync(BACKUP);
}

console.log(`\n${mortos}/${MUTANTES.length} mortos.`);

if (sobreviventes.length > 0) {
  console.log("\nSOBREVIVENTES:");
  for (const nome of sobreviventes) console.log(`  - ${nome}`);
  process.exit(1);
}
