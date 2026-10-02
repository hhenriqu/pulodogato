#!/usr/bin/env node
// =====================================================
// PULODOGATO - CAMPO DE DATA NATIVO NA TELA (HMO-240)
// =====================================================
//   npm run check-campo-de-data
//
// O DEFEITO QUE ISTO EXISTE PARA PEGAR
// ------------------------------------
// O controle de data nativo le os tres segmentos na ordem do APARELHO, e essa
// ordem nao se forca pelo codigo: nem `locale: "pt-BR"` no contexto nem
// `--lang=pt-BR` no navegador a mudam (medido em Chromium na HMO-238). O mesmo
// app mostra dd/mm para um usuario e mm/dd para outro, sem nada na tela dizendo
// qual.
//
// Varrendo as 9 posicoes de clique na largura real de um celular (343px),
// NENHUMA grava a data que a pessoa digitou. Os tres modos de errar:
//
//   "2026-10-03"  a ordem: quem digitou 10 de MARCO gravou 3 de OUTUBRO
//   "32026-..."   o ano corrompido
//   ""            oito teclas, nada gravado
//
// O primeiro e o que justifica um guard de CI em vez de um comentario: data
// valida, plausivel, gravada sem erro nenhum no caminho. O ano corrompido e o
// campo vazio pelo menos batem na validacao; a data de ORDEM errada atravessa
// tudo e so aparece meses depois, num extrato que nao fecha.
//
// A HMO-238 trocou os 2 campos da tela de lancamento e a HMO-240 os outros 8,
// em 6 telas. O que este guard impede e a VOLTA: o controle nativo e o que o
// editor completa sozinho, e um campo novo escrito assim nao quebra build, nao
// quebra teste e nao deixa a tela vazia.
//
// AS DUAS PENEIRAS
// ----------------
//   1. nenhum `type="date"` fora do allow-list -- um so, o picker escondido que
//      vive DENTRO de `CampoDeData` e onde ninguem digita;
//   2. um PISO de chamadas de `<CampoDeData`, porque a peneira 1 sozinha passa
//      verde quando o campo e simplesmente APAGADO da tela. Campo que sumiu nao
//      e campo nativo, e tambem nao e a feature.
//
// Os comentarios do fonte sao removidos antes da varredura (ver
// scripts/varredura-de-fonte.mjs): sem isso o guard acusaria justamente os seis
// arquivos CORRIGIDOS, que e onde o comentario cita o controle nativo em prosa.
//
// O que ele NAO cobre: `type="month"` e `type="datetime-local"` (tres campos no
// app), que ficaram nativos de proposito -- a queixa do usuario e sobre
// dia/mes/ano, e um seletor de mes nao tem os tres segmentos que embaralham.
// =====================================================

import { readFileSync, existsSync } from "node:fs";

import { arquivosDeFonte, semComentarios } from "./varredura-de-fonte.mjs";

const RAIZES = ["app", "components"];

/**
 * O unico `type="date"` legitimo do app.
 *
 * Ele e o picker escondido atras do botao de calendario de `CampoDeData`: sem
 * foco de teclado, sem receber clique proprio e com `aria-hidden`. Ninguem
 * DIGITA nele, entao o salto de segmento nao volta por esta porta -- e quem
 * prefere apontar continua tendo calendario.
 */
const PERMITIDO = "components/ui/campo-de-data.tsx";

/**
 * O piso de chamadas de `<CampoDeData`: 2 da HMO-238 (tela de lancamento) + 8
 * da HMO-240 (seletor de periodo, metas x2, transferencia, conta avulsa,
 * lancamento de investimento, despesa de grupo).
 *
 * Piso e nao igualdade: tela nova com campo de data sobe o numero e nao tem por
 * que mexer aqui. O que ele pega e a queda -- um campo que desaparece da tela
 * deixaria a peneira 1 verde por nao ter mais nada para acusar.
 */
const PISO_DE_CHAMADAS = 10;

const ATRIBUTO_DE_DATA = /type\s*=\s*(?:["']date["']|\{\s*["']date["']\s*\})/gi;

if (!existsSync(PERMITIDO)) {
  console.error(
    `XX ${PERMITIDO} nao existe.\n` +
      "   O allow-list desta verificacao nao protege mais nada, e o campo\n" +
      "   mascarado que ela existe para defender pode ter sido removido."
  );
  process.exit(1);
}

const achados = [];
let chamadas = 0;
let arquivosVistos = 0;

for (const raiz of RAIZES) {
  for (const arquivo of arquivosDeFonte(raiz)) {
    if (!arquivo.endsWith(".tsx")) continue;
    arquivosVistos++;

    const limpo = semComentarios(readFileSync(arquivo, "utf8"));
    chamadas += (limpo.match(/<CampoDeData[\s/>]/g) ?? []).length;

    if (arquivo === PERMITIDO) continue;

    for (const m of limpo.matchAll(ATRIBUTO_DE_DATA)) {
      const linha = limpo.slice(0, m.index).split("\n").length;
      achados.push(`${arquivo}:${linha}`);
    }
  }
}

// Controle de nao-vacuidade. Uma varredura que nao achou arquivo nenhum -- raiz
// renomeada, walker quebrado -- sai verde sem ter medido nada, que e o modo de
// falha mais perigoso de um guard de CI.
if (arquivosVistos < 50) {
  console.error(
    `XX a varredura viu so ${arquivosVistos} arquivos .tsx em ${RAIZES.join(", ")}.\n` +
      "   Isso e pouco demais para este repositorio: o guard nao mediu nada."
  );
  process.exit(1);
}

let falhou = false;

if (achados.length > 0) {
  console.error(
    `XX ${achados.length} campo(s) de data NATIVO na tela:\n` +
      achados.map((a) => `   ${a}`).join("\n") +
      "\n\n   Use `CampoDeData` (components/ui/campo-de-data.tsx). Ele mostra\n" +
      "   dd/mm/aaaa, emite AAAA-MM-DD, emite VAZIO enquanto a data esta pela\n" +
      "   metade, e traz o botao de calendario para quem prefere apontar.\n" +
      "   A ordem dos segmentos do controle nativo sai do APARELHO, e uma data\n" +
      "   lida na ordem errada e valida, plausivel e nao da erro nenhum."
  );
  falhou = true;
}

if (chamadas < PISO_DE_CHAMADAS) {
  console.error(
    `XX so ${chamadas} chamada(s) de <CampoDeData, e o piso e ${PISO_DE_CHAMADAS}.\n` +
      "   Um campo de data saiu da tela. Se a remocao e intencional, baixe o\n" +
      "   piso NESTE arquivo, com o motivo -- e nao em silencio: sem o piso a\n" +
      "   peneira de cima passa verde justamente quando nao ha mais campo."
  );
  falhou = true;
}

if (falhou) process.exit(1);

console.log(
  `OK: nenhum campo de data nativo na tela (${arquivosVistos} arquivos .tsx), ` +
    `e ${chamadas} chamadas de <CampoDeData (piso ${PISO_DE_CHAMADAS}).`
);
