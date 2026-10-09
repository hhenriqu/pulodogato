#!/usr/bin/env node
// =====================================================
// PULODOGATO - COLUNA `date` CONVERTIDA COM `new Date` NA TELA (HMO-353)
// =====================================================
//   npm run check-data-na-tela
//
// O DEFEITO QUE ISTO EXISTE PARA PEGAR
// ------------------------------------
// `transaction_date`, `due_date`, `settled_on` e companhia sao colunas `date`.
// Elas chegam como a string `"2026-10-09"` -- um dia do calendario, sem hora e
// sem fuso. `new Date("2026-10-09")` nao le isso como um dia: le como um
// INSTANTE em meia-noite UTC. Em `America/Sao_Paulo` (UTC-3) esse instante e
// 2026-10-08 as 21h, e `toLocaleDateString("pt-BR")` imprime **08/10/2026**.
//
// Medido em producao em 2026-10-09, com a conta de teste e Chromium headless:
// um lancamento gravado com `transaction_date = 2026-10-09` apareceu na lista
// como 08/10/2026. TODA data da tela estava um dia mais cedo, para todo usuario
// -- o fuso de todos eles e UTC-3.
//
// POR QUE ISTO MERECE GUARD DE CI, E NAO SO O CONSERTO
// ---------------------------------------------------
//   1. NAO HA SINTOMA. Nenhum erro, nenhum log, nenhuma tela vazia, e o que
//      aparece e uma data plausivel. `tsc`, `next build` e lint passam verdes.
//   2. `new Date(iso).toLocaleDateString("pt-BR")` E O QUE O EDITOR COMPLETA
//      SOZINHO, e e o que estava escrito em 5 lugares de 4 arquivos. A tela
//      NOVA e que traz o defeito de volta -- e tela nova nao esta em nenhuma
//      lista de `paths` escrita hoje, que e por que este guard roda sem filtro.
//   3. O CONSERTO PARCIAL E PIOR QUE NENHUM: duas telas passam a discordar
//      sobre a data da MESMA linha, e nao ha como quem olha saber qual mente.
//
// AS CINCO PENEIRAS
// -----------------
//   1. nenhum `new Date(...)` cujo argumento mencione uma coluna `date` do
//      schema, em `app/` e `components/`;
//   2. a CONTAGEM EXATA de chamadas das funcoes de lib/data-na-tela.ts, porque a
//      peneira 1 sozinha passa verde quando a data e simplesmente APAGADA da
//      tela -- data que sumiu nao e data errada, e tambem nao e a informacao.
//      Igualdade e nao piso, e a razao esta em CHAMADAS_ESPERADAS: piso com
//      folga desarma justamente o controle negativo que o justifica (HMO-316);
//   3. nao-vacuidade: a varredura tem de ver arquivos de verdade, e os nomes de
//      coluna da lista tem de AINDA aparecer no fonte. Uma coluna renomeada
//      deixaria a peneira 1 sem alvo e verde por falta de assunto;
//   4. `formatDate` de lib/utils.ts continua delegando -- ela mora fora das
//      raizes da peneira 1 e era UMA linha defeituosa servindo tres telas;
//   5. o npm script da suite roda nos DOIS fusos. Tres dos quatro mutantes
//      desta feature SOBREVIVEM em UTC, que e o fuso do runner do GitHub: uma
//      suite rodando so la aprova o defeito. Ver o comentario de SUITE.
//
// Os comentarios do fonte sao removidos antes da varredura (ver
// scripts/varredura-de-fonte.mjs). Sem isso o guard acusaria justamente os
// arquivos CORRIGIDOS: e neles que o comentario cita `new Date(transaction_date)`
// em prosa, para explicar o que foi consertado.
//
// O QUE ELE NAO COBRE
// -------------------
// Coluna `timestamptz` (`created_at`, `archived_at`, `current_price_at`) E um
// instante, e `new Date(valor)` nela esta CERTO -- o fuso local e o que a pessoa
// quer ver. Por isso a lista de nomes e fechada e sai do schema, nao de um
// padrao como `/_date|_at$/`: `_at` e exatamente a convencao do caso legitimo.
// =====================================================

import { readFileSync } from "node:fs";

import { arquivosDeFonte, semComentarios } from "./varredura-de-fonte.mjs";

const RAIZES = ["app", "components"];

/**
 * As colunas `date` do schema que a tela EXIBE, mais os nomes em camelCase com
 * que elas viajam dentro dos componentes (`parte.transactionDate`).
 *
 * Fechada de proposito, e conferida pela peneira 3: um padrao amplo
 * (`/_date$/`) acusaria `new Date()` sem argumento e o caso legitimo da
 * `timestamptz`, e guard que reprova codigo certo e desligado no mes seguinte.
 *
 * Saiu de `grep -E '^\s+[a-z_]+\s+date\b' database/migrations/*.sql`, filtrado
 * para as que chegam a alguma tela. Coluna `date` nova que a tela mostre entra
 * AQUI -- e so isso faz o guard passar a defende-la.
 */
const COLUNAS_DE_DIA = [
  "transaction_date",
  "transactionDate",
  "due_date",
  "dueDate",
  "settled_on",
  "settledOn",
  "trade_date",
  "tradeDate",
  "paid_date",
  "paidDate",
  "start_date",
  "end_date",
  "target_date",
  "reference_date",
  "next_expected_date",
  "last_charge_date",
  "period_start",
  "period_end",
  "today_rate_date",
  "data_base",
];

/** As funcoes que a tela deve usar no lugar. A peneira 2 conta as chamadas. */
const FUNCOES_CERTAS = ["dataNaTela", "dataCurtaNaTela"];

/**
 * Quantas chamadas das funcoes acima existem em `app/` e `components/`. CINCO,
 * da HMO-353: a linha da lista de lancamentos, a despesa e o vencimento da tela
 * do grupo, a linha da minha parte do grupo, o eixo do grafico de evolucao.
 *
 * IGUALDADE, E NAO PISO -- E ISSO E UMA LICAO MEDIDA, NAO PREFERENCIA
 * -------------------------------------------------------------------
 * O controle negativo deste guard apaga UMA chamada e exige vermelho. Um piso
 * com folga de N e, ao pe da letra, "quantos itens podem desaparecer com o
 * guard verde": o controle de remocao de UM item so morde com folga ZERO.
 *
 * `scripts/check-campo-de-data.mjs` aprendeu isso da pior forma (HMO-316): o
 * piso dele era 10, a arvore chegou a 13 chamadas, o controle negativo apagava
 * uma (13 - 1 = 12 >= 10) e passava VERDE. O step ficou o unico vermelho da main
 * meses depois, numa issue que nao tinha nada a ver. E o comentario do piso
 * dizia, em prosa, "tela nova sobe o numero e nao tem por que mexer aqui" -- o
 * defeito foi autorado pelo proprio comentario que documentava o design.
 *
 * Entao: tela nova que mostre uma data **sobe este numero**, aqui, com o motivo.
 * Falhar alto nos dois sentidos e o preco de o controle negativo continuar
 * medindo algo.
 */
const CHAMADAS_ESPERADAS = 5;

/**
 * `formatDate` de lib/utils.ts, que recebe `settled_on` e `today_rate_date`
 * (colunas `date`) e tambem `current_price_at` (`timestamptz`).
 *
 * Ela tem regra propria porque mora em `lib/`, fora das raizes varridas pela
 * peneira 1 -- e porque o `new Date(date)` que estava nela era o defeito em
 * UMA linha servindo tres telas. A delegacao e o que a peneira exige: a decisao
 * de "dia ou instante" tem de continuar num lugar com teste.
 */
const UTILS = "lib/utils.ts";

/**
 * O npm script da suite tem de rodar nos DOIS fusos, e esta peneira existe
 * porque a medida abaixo e o fato mais importante desta issue.
 *
 * Quatro mutantes de lib/data-na-tela.ts, medidos em 2026-10-09:
 *
 *   mutante                                       Sao_Paulo   UTC
 *   dataNaTela volta a passar por `new Date`       MORTO       MORTO
 *   dataCurtaNaTela perde `timeZone: "UTC"`        MORTO       VIVO
 *   dataOuMomentoNaTela manda tudo por `new Date`  MORTO       VIVO
 *   dataOuMomentoNaTela textualiza o instante      MORTO       VIVO
 *
 * TRES DE QUATRO SOBREVIVEM EM UTC -- e UTC e o fuso do runner do GitHub
 * Actions. Uma suite rodando so la passa verde com o defeito intacto, e passa
 * justamente no ambiente que decide se o PR entra (ja aconteceu na HMO-210).
 *
 * Tirar um dos dois `TZ=` do npm script nao quebra teste nenhum -- a suite
 * continua passando, com menos da metade do poder. E por isso que a exigencia
 * mora num guard e nao num comentario.
 */
const SUITE = "test:data-na-tela";
const FUSOS_EXIGIDOS = ["TZ=America/Sao_Paulo", "TZ=UTC"];

/**
 * `new Date(` ... e o que vem depois dele, ate o primeiro `)`.
 *
 * A janela para no `)` porque a chamada pode estar quebrada em varias linhas (e
 * estava, em 3 dos 5 casos): um regex de uma linha nao veria
 *
 *     new Date(
 *       transaction.transaction_date
 *     ).toLocaleDateString("pt-BR")
 *
 * que e exatamente a forma que o prettier deu ao defeito.
 */
const CONSTRUTOR = /new\s+Date\s*\(([^)]*)\)/g;

const achados = [];
let chamadas = 0;
let arquivosVistos = 0;
const nomesVistos = new Set();

for (const raiz of RAIZES) {
  for (const arquivo of arquivosDeFonte(raiz)) {
    arquivosVistos++;

    const limpo = semComentarios(readFileSync(arquivo, "utf8"));

    for (const f of FUNCOES_CERTAS) {
      chamadas += (limpo.match(new RegExp(`\\b${f}\\s*\\(`, "g")) ?? []).length;
    }

    for (const coluna of COLUNAS_DE_DIA) {
      if (new RegExp(`\\b${coluna}\\b`).test(limpo)) nomesVistos.add(coluna);
    }

    for (const m of limpo.matchAll(CONSTRUTOR)) {
      const argumento = m[1];
      const coluna = COLUNAS_DE_DIA.find((c) =>
        new RegExp(`\\b${c}\\b`).test(argumento)
      );
      if (!coluna) continue;

      const linha = limpo.slice(0, m.index).split("\n").length;
      achados.push(`${arquivo}:${linha}  (${coluna})`);
    }
  }
}

let falhou = false;

// Peneira 3a: a varredura viu arquivos de verdade. Uma varredura que nao achou
// nada sai verde sem ter medido nada, que e o modo de falha mais perigoso de um
// guard textual.
if (arquivosVistos < 50) {
  console.error(
    `XX a varredura viu so ${arquivosVistos} arquivos em ${RAIZES.join(", ")}.\n` +
      "   Isso e pouco demais para este repositorio: o guard nao mediu nada."
  );
  falhou = true;
}

// Peneira 3b: os nomes de coluna ainda existem no fonte. Um `transaction_date`
// renomeado deixa a peneira 1 sem alvo, e ela passaria a aprovar qualquer
// `new Date` sobre a coluna nova.
const sumidos = COLUNAS_DE_DIA.filter((c) => !nomesVistos.has(c));
if (sumidos.length > COLUNAS_DE_DIA.length / 2) {
  console.error(
    `XX ${sumidos.length} de ${COLUNAS_DE_DIA.length} nomes da lista nao\n` +
      `   aparecem mais em ${RAIZES.join(", ")}: ${sumidos.join(", ")}\n` +
      "   A peneira 1 esta sem alvo. Se uma coluna foi renomeada, troque o nome\n" +
      "   NESTE arquivo -- senao o guard aprova `new Date` sobre o nome novo."
  );
  falhou = true;
}

if (achados.length > 0) {
  console.error(
    `XX ${achados.length} coluna(s) \`date\` convertida(s) com \`new Date\`:\n` +
      achados.map((a) => `   ${a}`).join("\n") +
      "\n\n   Use `dataNaTela` (dd/mm/aaaa) ou `dataCurtaNaTela` de\n" +
      "   lib/data-na-tela.ts. Coluna `date` chega como \"2026-10-09\" e\n" +
      "   `new Date` a le como meia-noite UTC: em America/Sao_Paulo, que e o\n" +
      "   fuso de todo usuario deste app, a tela escreve 08/10/2026. Toda data\n" +
      "   um dia mais cedo, sem erro nenhum no caminho e com um numero\n" +
      "   plausivel na tela (medido em producao na HMO-353).\n" +
      "   Para `timestamptz` (`created_at`, `archived_at`) `new Date` esta\n" +
      "   certo -- aquilo e um instante, e o fuso local e o que se quer ver."
  );
  falhou = true;
}

// Peneira 2: a contagem exata. Ver o comentario de CHAMADAS_ESPERADAS para a
// razao de ser igualdade e nao piso.
if (chamadas !== CHAMADAS_ESPERADAS) {
  const direcao =
    chamadas < CHAMADAS_ESPERADAS
      ? "Uma data SAIU da tela -- e data que sumiu deixa a peneira 1 verde por\n" +
        "   nao ter mais nada para acusar."
      : "Uma data ENTROU na tela. Isso e bem-vindo: ajuste o numero aqui, com\n" +
        "   o motivo, para o controle negativo continuar mordendo.";
  console.error(
    `XX ${chamadas} chamada(s) de ${FUNCOES_CERTAS.join("/")} em ` +
      `${RAIZES.join(", ")}, e o esperado e ${CHAMADAS_ESPERADAS}.\n` +
      `   ${direcao}`
  );
  falhou = true;
}

// Peneira 4: `formatDate` de lib/utils.ts continua delegando a decisao de
// "dia ou instante". Ela mora fora das raizes da peneira 1, e era um `new Date`
// unico servindo tres telas.
const deUtils = semComentarios(readFileSync(UTILS, "utf8"));
if (!/\bdataOuMomentoNaTela\s*\(/.test(deUtils)) {
  console.error(
    `XX ${UTILS} nao chama mais \`dataOuMomentoNaTela\`.\n` +
      "   `formatDate` recebe coluna `date` (settled_on, today_rate_date) E\n" +
      "   `timestamptz` (current_price_at). Um `new Date` para os dois conserta\n" +
      "   um caso e estraga o outro, e aqui nao ha teste possivel: este arquivo\n" +
      "   importa clsx/tailwind-merge e nao roda em `node --test`."
  );
  falhou = true;
}

// Peneira 5: a suite roda nos dois fusos. Ver o comentario de SUITE: tres dos
// quatro mutantes desta feature SOBREVIVEM em UTC, que e o fuso do CI.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const comando = pkg.scripts?.[SUITE];
if (!comando) {
  console.error(
    `XX nao existe o script \`${SUITE}\` no package.json.\n` +
      "   A suite de fuso desta feature desapareceu."
  );
  falhou = true;
} else {
  const faltando = FUSOS_EXIGIDOS.filter((tz) => !comando.includes(tz));
  if (faltando.length > 0) {
    console.error(
      `XX o script \`${SUITE}\` nao roda em ${faltando.join(" nem em ")}.\n` +
        "   Em UTC o codigo defeituoso e o consertado dao o MESMO dia: tres dos\n" +
        "   quatro mutantes desta feature sobrevivem la. Em America/Sao_Paulo\n" +
        "   morrem todos. Rodar so um dos dois nao e meia cobertura -- e verde\n" +
        "   sobre o defeito, no fuso em que o CI decide o PR."
    );
    falhou = true;
  }
}

if (falhou) process.exit(1);

console.log(
  `OK: nenhuma coluna \`date\` convertida com \`new Date\` ` +
    `(${arquivosVistos} arquivos, ${COLUNAS_DE_DIA.length - sumidos.length} ` +
    `nomes de coluna vistos), ${chamadas} chamadas de exibicao ` +
    `(esperado ${CHAMADAS_ESPERADAS}), formatDate delegando em ${UTILS}, e ` +
    `${SUITE} rodando nos dois fusos.`
);
