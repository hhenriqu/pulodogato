#!/usr/bin/env node
// =====================================================
// MUTANTES DE lib/mercado.ts (HMO-193)
// =====================================================
// Uma suite de 30 asercoes que nunca viu vermelho nao e evidencia de nada. Este
// script estraga `lib/mercado.ts` de um jeito por vez, roda `npm run
// test:mercado` e EXIGE que a suite reprove. Mutante que sobrevive aponta uma
// regra que o codigo afirma e o teste nao verifica.
//
// Aqui isso importa mais que o normal por causa do jeito ESPECIFICO como esta
// entrega falha. O enunciado da HMO-193 escreveu os dois modos:
//
//   1. filtro desligado  -> a tela publica IGTI4F subindo 16,82% sobre 3 acoes,
//                           com 200 e sem excecao nenhuma para logar;
//   2. filtro largo demais -> o ranking esvazia, e um ranking vazio PASSA em
//                           toda assercao de "fulano nao aparece".
//
// Os dois estao na lista abaixo (`o filtro de liquidez esta desligado` e `o
// piso sobe para R$ 1 bilhao`). Se qualquer um dos dois sobrevivesse, a suite
// estaria decorando a captura de 2026-09-30 em vez de verificar a regra.
//
// Cada mutacao e um defeito que alguem escreveria de verdade -- confiar no
// `type=stock` da brapi, traduzir "piso de volume" para quantidade de acoes,
// escrever o regex esperto de ticker fracionario, cortar em 10 antes de
// filtrar -- e nao uma quebra artificial. Ver `scripts/mutantes-fundamento-cvm.mjs`,
// mesmo desenho.
//
// Roda com: node scripts/mutantes-mercado.mjs
// =====================================================

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ALVO = fileURLToPath(new URL("../lib/mercado.ts", import.meta.url));
const BACKUP = `${ALVO}.mutantes.bak`;

const MUTANTES = [
  // ---------------------------------------------------------------- o defeito
  {
    nome: "o filtro de liquidez esta desligado (o defeito da issue)",
    de: `  if (reais === null || reais < PISO_DE_LIQUIDEZ_EM_REAIS) return "abaixo_do_piso";

  return null;`,
    para: `  return null;`,
  },
  {
    nome: "o sufixo fracionario nao e olhado (IGTI4F volta ao ranking)",
    de: `  if (ehFracionario(ticker)) return "fracionario";`,
    para: ``,
  },
  {
    nome: "confia no type=stock da brapi no lugar do filtro proprio",
    de: `  if (ehFracionario(ticker)) return "fracionario";`,
    para: `  if (String(linha.type ?? "") !== "stock") return "fracionario";`,
  },

  // ------------------------------------------------- o filtro largo demais
  {
    nome: "o piso sobe para R$ 1 bilhao e esvazia o ranking",
    de: `export const PISO_DE_LIQUIDEZ_EM_REAIS = 1_000_000;`,
    para: `export const PISO_DE_LIQUIDEZ_EM_REAIS = 1_000_000_000;`,
  },
  {
    // Este e o mutante da armadilha 4 na sua forma mais crua: um filtro que
    // recusa TUDO. Ele passa em cada assercao de "fulano nao aparece" desta
    // suite. Escrito como `if (true) return ...` ele morreria no tsc (codigo
    // seguinte fica inalcancavel) -- e morte por tsc nao diz que a SUITE pegou
    // a regra. Escrito assim ele compila limpo, e so a secao 4 o mata.
    nome: "tudo e recusado (o mutante que passa em toda assercao de bloqueio)",
    de: `  return t.length >= 5 && t.endsWith("F");`,
    para: `  return t.length >= 0;`,
  },

  // ----------------------------------------------------- a calibracao do piso
  {
    nome: "o piso vira 100.000 ACOES (apaga Bradespar e Santander)",
    de: `  const reais = reaisNegociados(linha);
  if (reais === null || reais < PISO_DE_LIQUIDEZ_EM_REAIS) return "abaixo_do_piso";`,
    para: `  if (acoes < 100_000) return "abaixo_do_piso";`,
  },
  {
    nome: "o piso cai para R$ 1.000 (MSPA3F com R$ 1.668 volta ao ranking)",
    de: `export const PISO_DE_LIQUIDEZ_EM_REAIS = 1_000_000;`,
    para: `export const PISO_DE_LIQUIDEZ_EM_REAIS = 1_000;`,
  },

  // -------------------------------------------- o regex esperto que vaza
  {
    nome: "o sufixo usa o regex de 4 letras (vaza B1003F e B3SA3F)",
    de: `  return t.length >= 5 && t.endsWith("F");`,
    para: `  return /^[A-Z]{4}\\d+[A-Z]*F$/.test(t);`,
  },
  {
    nome: "o sufixo exige digito imediatamente antes do F (vaza MRSA5BF)",
    de: `  return t.length >= 5 && t.endsWith("F");`,
    para: `  return /\\dF$/.test(t);`,
  },

  // ------------------------------------------------- linha sem dado utilizavel
  {
    nome: "linha sem preco passa (liquidez desconhecida vira liquidez ok)",
    de: `  const preco = numero(linha.close);
  if (preco === null || preco <= 0) return "sem_preco";`,
    para: ``,
    extra: [{ de: `  const reais = reaisNegociados(linha);`, para: `  const reais = reaisNegociados(linha) ?? Infinity;` }],
  },
  {
    nome: "Number(null) vira 0 e a linha sem variacao passa como 'variou 0%'",
    de: `function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}`,
    para: `function numero(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}`,
  },
  {
    nome: "volume zero passa (papel que nao negociou entra no ranking)",
    de: `  if (acoes === null || acoes <= 0) return "sem_acoes";`,
    para: `  if (acoes === null) return "sem_acoes";`,
  },

  // ---------------------------------------------------- a montagem do ranking
  {
    nome: "corta em 10 ANTES de filtrar (ranking curto feito do lixo removido)",
    de: `  for (const linha of linhas) {`,
    para: `  for (const linha of linhas.slice(0, quantos)) {`,
  },
  {
    nome: "nao confere a direcao ('maior baixa' de +2%)",
    de: `    if (direcao === "altas" ? variacao <= 0 : variacao >= 0) continue;`,
    para: ``,
  },
  {
    nome: "a direcao aceita variacao zero (papel que nao variou vira 'maior alta')",
    de: `    if (direcao === "altas" ? variacao <= 0 : variacao >= 0) continue;`,
    para: `    if (direcao === "altas" ? variacao < 0 : variacao > 0) continue;`,
  },
  {
    nome: "as baixas saem ordenadas da menor queda para a maior",
    de: `  aprovadas.sort((a, b) => (direcao === "altas" ? b.variacao - a.variacao : a.variacao - b.variacao));`,
    para: `  aprovadas.sort((a, b) => b.variacao - a.variacao);`,
  },

  // ------------------------------------------------------ a consulta e as frases
  {
    nome: "o 401 da brapi vira 'ticker nao encontrado'",
    de: `  if (status === 401 || status === 403) return { tipo: "precisa_de_token", ticker };`,
    para: `  if (status === 401 || status === 403) return { tipo: "nao_encontrado", ticker };`,
  },
  {
    nome: "a frase do token nao diz que os rankings continuam de pe",
    de: `      return \`A consulta de \${falha.ticker} precisa de uma chave da brapi, que ainda não está configurada neste app. As maiores altas e baixas continuam funcionando.\`;`,
    para: `      return \`A consulta de \${falha.ticker} precisa de uma chave da brapi.\`;`,
  },
  {
    nome: "normalizarTicker 'corrige' ITUB para ITUB4",
    de: `  return /^[A-Z0-9]{4,8}$/.test(t) ? t : null;`,
    para: `  if (/^[A-Z]{4}$/.test(t)) return \`\${t}4\`;
  return /^[A-Z0-9]{4,8}$/.test(t) ? t : null;`,
  },
  {
    nome: "lerCotacao devolve objeto mesmo sem preco (R$ NaN na tela)",
    de: `  if (!ticker || !Number.isFinite(preco) || preco <= 0) return null;`,
    para: `  if (!ticker) return null;`,
  },
  {
    nome: "o aviso de atraso some da cotacao",
    de: `export const AVISO_DE_ATRASO =
  "Cotação do plano gratuito da brapi, com atraso de cerca de 30 minutos. Não é preço ao vivo.";`,
    para: `export const AVISO_DE_ATRASO = "Cotação da brapi.";`,
  },
  {
    nome: "o rodape do ranking vira vocabulario de recomendacao",
    de: `export const AVISO_NAO_E_RECOMENDACAO =
  "Lista informativa das maiores variações do dia. Não é recomendação de compra ou venda.";`,
    para: `export const AVISO_NAO_E_RECOMENDACAO = "As melhores oportunidades do dia. Aproveite.";`,
  },
];

// Uma rodada anterior interrompida no meio deixa o alvo MUTADO no disco, e a
// rodada seguinte leria o codigo estragado como se fosse o original -- os
// mutantes seguintes passariam a ser medidos contra uma base errada e
// reportariam MORTO por comparar defeito com defeito. Por isso o .bak presente
// e tratado como estado sujo, e todo caminho de saida passa por `abortar()`,
// que restaura ANTES de sair.
if (existsSync(BACKUP)) {
  console.error(
    `ERRO: ${BACKUP} existe -- uma rodada anterior morreu antes de restaurar.\n` +
      `lib/mercado.ts pode estar mutado. Confira o arquivo (e o diff do git) antes de rodar de novo.`,
  );
  process.exit(1);
}

const original = readFileSync(ALVO, "utf8");
copyFileSync(ALVO, BACKUP);

let mortos = 0;
const sobreviventes = [];

/** Restaura o alvo e so entao sai -- ver o comentario acima. */
function abortar(mensagem) {
  copyFileSync(BACKUP, ALVO);
  unlinkSync(BACKUP);
  console.error(`\nERRO: ${mensagem}`);
  process.exit(1);
}

try {
  for (const mutante of MUTANTES) {
    const trocas = [{ de: mutante.de, para: mutante.para }, ...(mutante.extra ?? [])];

    let mutado = original;
    for (const { de, para } of trocas) {
      if (!mutado.includes(de)) {
        // Mutante que nao encontra o alvo nao aplica nada, e ai a suite passa --
        // o que se leria como "sobreviveu". Um controle negativo que nasce falso
        // e pior que nenhum: por isso isto e erro, nao aviso.
        abortar(
          `o trecho do mutante "${mutante.nome}" nao existe mais em lib/mercado.ts:\n  ${de.split("\n")[0]}`,
        );
      }
      mutado = mutado.replace(de, para);
    }
    if (mutado === original) abortar(`o mutante "${mutante.nome}" nao mudou nada.`);
    writeFileSync(ALVO, mutado);

    let reprovou = false;
    let motivo = "";
    try {
      execSync("npm run test:mercado", { stdio: "pipe", encoding: "utf8" });
    } catch (erro) {
      reprovou = true;
      const saida = `${erro.stdout ?? ""}${erro.stderr ?? ""}`;
      // O tsc reprovando tambem conta como morto -- mutante que nao compila nao
      // chega em producao. Mas vale distinguir: erro de tipo nao diz que a SUITE
      // pegou a regra.
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
