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
// AS TRES PENEIRAS
// ----------------
//   1. nenhum `type="date"` fora do allow-list -- um so, o picker escondido que
//      vive DENTRO de `CampoDeData` e onde ninguem digita;
//   2. a CONTAGEM EXATA de chamadas de `<CampoDeData`, porque a peneira 1 sozinha passa
//      verde quando o campo e simplesmente APAGADO da tela. Campo que sumiu nao
//      e campo nativo, e tambem nao e a feature;
//   3. o par do seletor de periodo tem de ser ALCANCAVEL pelo menu (HMO-243).
//      Esta e a peneira 2 levada a serio: lá o campo desaparecia do fonte, aqui
//      ele esta no fonte e nao ha gesto na tela que o mostre. Para a peneira 2 a
//      contagem fecha, para a 1 nao ha nada a acusar, e para o usuario o campo
//      nao existe -- foi exatamente o estado em que a 243 foi medida em
//      producao.
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
 * A contagem esperada de chamadas de `<CampoDeData`: 2 da HMO-238 (tela de lancamento) + 8
 * da HMO-240 (seletor de periodo x2, metas x2, transferencia, conta avulsa,
 * lancamento de investimento, despesa de grupo) + 2 da HMO-192 (renda fixa da
 * carteira) + 1 da HMO-324 (linha de edicao da lista).
 *
 * O numero ACOMPANHA a arvore, e campo novo obriga a subir ele aqui.
 * A versao anterior dizia o contrario -- "tela nova sobe o numero e nao tem por
 * que mexer aqui" -- e foi assim que ele parou de pegar a queda que justifica a
 * existencia dele: a HMO-192 (+2) e a HMO-324 (+1) entraram sem tocar no piso,
 * a arvore chegou a 13 chamadas contra um piso de 10, e essa folga de 3 era
 * exatamente quantos campos de data podiam desaparecer da tela com o guard
 * verde. A sonda de controle de `verificacao` apaga UM campo e exige vermelho:
 * com folga ela nao tinha como passar, e so nao acusou antes porque o Actions
 * estava travado na cobranca (HMO-242) e o workflow nunca rodou.
 *
 * Folga zero e o que torna a sonda honesta, e por isso aqui e IGUALDADE e nao
 * piso: com piso, a folga volta no primeiro campo novo que entrar sem mexer
 * neste arquivo, e a sonda volta a passar verde sobre um campo apagado -- em
 * silencio, do mesmo jeito. Igualdade falha ALTO nas duas direcoes e obriga a
 * decisao a passar por aqui, com o motivo, sempre.
 */
const CHAMADAS_ESPERADAS = 13;

const ATRIBUTO_DE_DATA = /type\s*=\s*(?:["']date["']|\{\s*["']date["']\s*\})/gi;

/**
 * O seletor de periodo, cujo par de datas e o unico do app que NAO alimenta
 * formulario: ele alimenta o filtro do painel, por tras de um item de menu.
 */
const SELETOR = "components/dashboard/SeletorDePeriodo.tsx";

/**
 * A peneira 3: o par do seletor tem de ser alcancavel pelo menu (HMO-243).
 *
 * Cada regra abaixo e uma forma do MESMO defeito -- campo que existe no fonte e
 * que gesto nenhum na tela mostra. As duas primeiras sao o defeito literal como
 * ele foi escrito em `45eb575`; as duas ultimas exigem que a decisao continue
 * nas funcoes puras, que e o que torna a coisa testavel sem navegador.
 *
 * Tudo isto roda sobre o fonte SEM COMENTARIO (ver semComentarios). Nao e
 * refinamento: o comentario que estava neste arquivo AFIRMAVA que escolher o
 * item "so abre os dois campos", que era o oposto do que o codigo fazia, e e
 * exatamente a frase que uma assercao textual ingenua teria casado -- passando
 * verde sobre o defeito, pelo texto que o descreve ao contrario.
 */
const REGRAS_DO_SELETOR = [
  {
    proibido: /===\s*(?:VALOR_)?PERSONALIZADO\s*\)\s*return\s*;/,
    erro:
      "o handler do item volta a ter o `return` seco. Escolher " +
      '"Personalizado" nao muda o periodo, entao o preset continua sendo\n' +
      "   `este-mes` e os campos nunca aparecem: o item fica decorativo.",
  },
  {
    proibido: /\{\s*preset\s*===\s*null\s*&&\s*\(/,
    erro:
      "os campos voltaram a sair SO de `preset === null`. Essa condicao\n" +
      "   nunca e verdadeira depois de escolher o item, porque escolher o item\n" +
      "   nao mexe no periodo. Use `camposAbertos(preset, personalizado)`.",
  },
  {
    exigido: /camposAbertos\s*\(/,
    erro:
      "`camposAbertos` saiu do seletor. A condicao dos campos tem duas\n" +
      "   razoes independentes, e ela e a unica forma testavel delas.",
  },
  {
    exigido: /escolhaDoSeletor\s*\(/,
    erro:
      "`escolhaDoSeletor` saiu do seletor. Decisao escrita dentro de um\n" +
      "   `onValueChange` nao tem teste possivel neste repositorio:\n" +
      "   `react-dom/server` nao chama handler nenhum. Foi por essa porta que\n" +
      "   a HMO-243 atravessou revisao.",
  },
];

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

// Peneira 3: o par do seletor de periodo e alcancavel pelo menu (HMO-243).
if (!existsSync(SELETOR)) {
  console.error(
    `XX ${SELETOR} nao existe.\n` +
      "   A peneira 3 nao mede mais nada. Se o seletor mudou de lugar, aponte\n" +
      "   o caminho novo NESTE arquivo."
  );
  falhou = true;
} else {
  const doSeletor = semComentarios(readFileSync(SELETOR, "utf8"));

  // Nao-vacuidade: sem o par de campos no fonte nao ha o que a peneira 3
  // defenda, e as regras de baixo passariam todas por falta de assunto.
  if (!/<CampoDeData/.test(doSeletor)) {
    console.error(
      `XX ${SELETOR} nao tem mais nenhum <CampoDeData.\n` +
        "   O par de datas do modo personalizado saiu da tela -- a peneira 3\n" +
        "   nao tem mais nada para medir."
    );
    falhou = true;
  }

  for (const regra of REGRAS_DO_SELETOR) {
    const quebrou = regra.proibido
      ? regra.proibido.test(doSeletor)
      : !regra.exigido.test(doSeletor);
    if (quebrou) {
      console.error(`XX ${SELETOR}: ${regra.erro}`);
      falhou = true;
    }
  }
}

if (chamadas < CHAMADAS_ESPERADAS) {
  console.error(
    `XX so ${chamadas} chamada(s) de <CampoDeData, e o esperado e ${CHAMADAS_ESPERADAS}.\n` +
      "   Um campo de data saiu da tela. Se a remocao e intencional, baixe o\n" +
      "   numero NESTE arquivo, com o motivo -- e nao em silencio: sem ele a\n" +
      "   peneira de cima passa verde justamente quando nao ha mais campo."
  );
  falhou = true;
} else if (chamadas > CHAMADAS_ESPERADAS) {
  console.error(
    `XX ${chamadas} chamadas de <CampoDeData, e o esperado e ${CHAMADAS_ESPERADAS}.\n` +
      "   Campo de data novo e bem-vindo -- mas SOBE o numero NESTE arquivo,\n" +
      "   com o motivo. Deixar a folga crescer e o que desarma a peneira de\n" +
      "   cima: com folga de N, N campos podem desaparecer da tela com este\n" +
      "   guard verde, e a sonda de controle de `verificacao` para de pegar."
  );
  falhou = true;
}

if (falhou) process.exit(1);

console.log(
  `OK: nenhum campo de data nativo na tela (${arquivosVistos} arquivos .tsx), ` +
    `${chamadas} chamadas de <CampoDeData (esperado ${CHAMADAS_ESPERADAS}), ` +
    `e o par do seletor alcancavel pelo menu (${REGRAS_DO_SELETOR.length} regras).`
);
