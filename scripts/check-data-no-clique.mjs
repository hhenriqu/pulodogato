#!/usr/bin/env node
// =====================================================
// PULODOGATO - NENHUMA TELA GUARDA A DATA DE HOJE NO MODULO (HMO-315)
// =====================================================
//   npm run check-data-no-clique
//
// O DEFEITO QUE ISTO EXISTE PARA PEGAR
// ------------------------------------
// `app/(dashboard)/dashboard/bills/page.tsx` tinha isto no topo do arquivo:
//
//     const HOJE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
//
// Num componente `"use client"` aquilo e avaliado UMA vez -- quando o navegador
// avalia o chunk, e nao quando a pessoa clica. Numa aba que atravessa a
// meia-noite `HOJE` continua sendo a data de ONTEM. Este app e PWA com service
// worker: aba aberta por dias no celular e o caso normal, nao o raro.
//
// Tres dos quatro usos gravavam dinheiro ou data de dinheiro -- o `paid_date`
// da baixa, o `paid_date` da FATURA, o vencimento sugerido. No dia 1o a data de
// ontem cai no MES ANTERIOR: o lancamento troca de mes no fluxo de caixa, no
// teto da categoria e no "quanto este mes cobra". A baixa responde 200, a data
// gravada e plausivel, a linha sai do previsto como esperado, e NADA na tela
// acusa. Quem descobre e quem fecha o mes e acha o valor num mes e falta no
// outro.
//
// POR QUE UM GUARD DE CI E NAO SO O CONSERTO
// -------------------------------------------
// Porque a forma errada e a que se escreve sem pensar. `const HOJE = ...` no
// topo do arquivo nao quebra build, nao quebra teste, nao deixa a tela vazia e
// LE BEM -- parece ate cuidado com performance. A HMO-315 achou o mesmo defeito
// em QUATRO arquivos (bills, budgets, goals, payroll) escritos por caminhos
// diferentes, o que diz que o conserto pontual nao segura: a quinta tela vai
// nascer igual.
//
// AS TRES PENEIRAS
// ----------------
//   1. nenhuma declaracao de ESCOPO DE MODULO em `app/` ou `components/` le o
//      relogio na hora da avaliacao. Ler dentro de uma funcao e o certo e passa:
//      `const mesCorrente = () => today().slice(0, 7)` e justamente o conserto.
//   2. a prop `hoje` de `DialogoDePagamentoDaFatura` continua sendo
//      `() => string`, e os chamadores continuam passando a FUNCAO. E o tipo que
//      impede a volta pela porta do meio -- `hoje={today()}` nao congela no
//      modulo, mas congela no render, e o `paid_date` que o dialogo grava e do
//      clique em Confirmar. O `tsc` tambem pega isto, mas so no `next build`;
//      aqui custa milissegundos e cabe no job sem filtro de path.
//   3. nao-vacuidade, em duas formas: a varredura precisa ter visto arquivo
//      suficiente, e o DETECTOR precisa provar que ainda sabe acusar -- ver
//      `AUTO_TESTE` abaixo.
//
// A PENEIRA 3 MERECE O PARAGRAFO DELA
// ------------------------------------
// Um guard textual cujo detector apodreceu sai VERDE: zero achados e
// exatamente o que ele imprime quando tudo esta certo, e tambem quando ele
// parou de olhar. Aqui o detector e rodado contra a linha original da HMO-315,
// embutida neste arquivo, e contra o conserto dela: se ele deixar de acusar a
// primeira, ou passar a acusar a segunda, este script reprova ANTES de varrer a
// arvore. O zero achados da peneira 1 so vale depois disso.
//
// Os comentarios do fonte sao removidos antes da varredura (ver
// scripts/varredura-de-fonte.mjs). Nao e refinamento: os quatro arquivos
// CORRIGIDOS sao justamente os que citam `const HOJE = ... new Date()` em prosa,
// para explicar o que saiu dali -- um guard que leia comentario acusa o avesso
// do que mede.
//
// O QUE ELE NAO COBRE, DITO EM VOZ ALTA
// --------------------------------------
//   * `lib/` fica de fora de proposito: `today()` (lib/recurrence.ts) e quem LE
//     o relogio, e e a resposta certa, nao o defeito. Varrer lib/ acusaria o
//     proprio conserto.
//   * declaracao de modulo ESCRITA INDENTADA. A peneira 1 ancora na coluna 0, que
//     e onde o prettier poe todo statement de topo neste repositorio -- e onde as
//     quatro ocorrencias reais estavam. Uma declaracao de topo indentada a mao
//     escapa; em troca, nenhum `const` de dentro de componente da falso positivo.
//   * `let HOJE;` no topo com a atribuicao em outra linha.
//   * data congelada em `useState(today())` sem re-semear no gesto de abrir. Isso
//     e render e nao modulo -- quem mede e `scripts/test-data-no-clique.mjs`, com
//     o relogio andando entre a montagem e o clique.
//
// Isto e um piso, nao uma garantia.
// =====================================================

import { readFileSync, existsSync } from "node:fs";

import { arquivosDeFonte, semComentarios } from "./varredura-de-fonte.mjs";

const RAIZES = ["app", "components"];

/**
 * Ler o relogio AGORA. As tres formas que apareceram na arvore.
 *
 * `new Date(iso)` e `new Date(ano, mes)` NAO entram: construir uma data a
 * partir de um valor e outra coisa, e e o que metade das telas faz para
 * formatar. So o construtor sem argumento le o relogio.
 *
 * `new Intl.DateTimeFormat` tambem NAO entra, de proposito, embora a linha
 * original da HMO-315 comecasse com ele. Um formatador guardado no modulo e
 * idioma legitimo e comum (criar `Intl.DateTimeFormat` e caro); quem le o
 * relogio e o argumento que vai no `.format(...)`, e na linha original aquele
 * argumento era `new Date()` -- ja coberto pela primeira alternativa. Incluir o
 * construtor do formatador acusaria o idioma inocente e treinaria quem le a
 * ignorar o guard.
 */
const LE_O_RELOGIO =
  /new\s+Date\s*\(\s*\)|Date\s*\.\s*now\s*\(\s*\)|(?<![\w.$])today\s*\(\s*\)/;

/**
 * Uma fronteira de funcao: daqui para dentro, o corpo so roda quando chamado.
 *
 * `=>` cobre a arrow e tambem o inicializador preguicoso do `useState`;
 * `function` cobre a forma classica. E a ORDEM que decide (ver `eager`): o que
 * importa nao e haver funcao no inicializador, e sim o relogio estar DENTRO de
 * uma.
 */
const FRONTEIRA_DE_FUNCAO = /=>|(?<![\w.$])function(?![\w$])/;

/**
 * O inicializador le o relogio na hora em que o modulo e avaliado?
 *
 * Sim quando ha leitura de relogio e ela vem ANTES de qualquer fronteira de
 * funcao -- isto e, ela nao esta no corpo de nada, entao roda junto com o
 * `import`. Esta e a regra inteira, e ela e deliberadamente simples: o par de
 * casos que ela separa e o par real desta issue.
 *
 *   const HOJE = new Intl.DateTimeFormat(...).format(new Date());  <- acusa
 *   const mesCorrente = () => today().slice(0, 7);                 <- passa
 */
export function leORelogioNaAvaliacao(inicializador) {
  const relogio = inicializador.search(LE_O_RELOGIO);
  if (relogio < 0) return false;
  const funcao = inicializador.search(FRONTEIRA_DE_FUNCAO);
  return funcao < 0 || funcao > relogio;
}

/** Abre um statement de topo: coluna 0, `const`/`let`/`var`, com ou sem `export`. */
const DECLARACAO_DE_TOPO = /^(?:export\s+)?(?:const|let|var)\s+[\w$]+/gm;

/**
 * Onde acaba o inicializador que comeca em `inicio`: no `;` de profundidade
 * zero, fora de string.
 *
 * A primeira versao disto procurava o proximo statement de COLUNA 0, e o
 * auto-teste a reprovou na hora -- com razao, e a lição vale ficar escrita: o
 * prettier quebra uma chamada multilinha deixando o fecho na coluna 0
 * (`}).format(new Date());`), entao "coluna 0" aparece no MEIO do
 * inicializador. O detector cortava em `=` e nao via relogio nenhum nas quatro
 * ocorrencias reais da issue, que eram justamente as multilinha.
 *
 * Contar profundidade e rastrear string e o que faz o `;` dentro de
 * `new Intl.DateTimeFormat("a;b", { ... })` nao terminar nada.
 */
function fimDoInicializador(texto, inicio) {
  let profundidade = 0;
  let aspas = null; // " | ' | `
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === "\\") i++;
      else if (c === aspas) aspas = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") aspas = c;
    else if (c === "(" || c === "[" || c === "{") profundidade++;
    else if (c === ")" || c === "]" || c === "}") {
      // Profundidade negativa = o statement nao tinha `;` e ja saiu do escopo.
      if (--profundidade < 0) return i;
    } else if (c === ";" && profundidade === 0) return i;
  }
  return texto.length;
}

/**
 * As declaracoes de escopo de modulo que leem o relogio na avaliacao.
 */
export function achadosNoFonte(limpo) {
  const achados = [];
  for (const m of limpo.matchAll(DECLARACAO_DE_TOPO)) {
    const depoisDoNome = m.index + m[0].length;
    const resto = limpo.slice(depoisDoNome);
    // Declaracao sem valor (`let HOJE;`) e desestruturacao (`const [a] = ...`,
    // que o DECLARACAO_DE_TOPO nem casa) nao tem inicializador para medir.
    if (!resto.trimStart().startsWith("=")) continue;
    const inicializador = limpo.slice(
      depoisDoNome,
      fimDoInicializador(limpo, depoisDoNome)
    );
    if (!leORelogioNaAvaliacao(inicializador)) continue;
    achados.push({
      linha: limpo.slice(0, m.index).split("\n").length,
      trecho: m[0].replace(/\s+/g, " "),
    });
  }
  return achados;
}

// ---------------------------------------------------------------------------
// PENEIRA 3a: o detector ainda sabe acusar? (o auto-teste)
// ---------------------------------------------------------------------------
// Roda ANTES da varredura. Cada caso e uma linha que existiu de verdade neste
// repositorio -- a esquerda como ela era na main antes da HMO-315, a direita
// como ficou. Se o detector parar de separar as duas, o "0 achados" da peneira 1
// deixa de significar qualquer coisa, e e por isso que a reprovacao aqui e dura.
const AUTO_TESTE = [
  {
    deveAcusar: true,
    nome: "bills: o HOJE original, multilinha",
    fonte:
      'const HOJE = new Intl.DateTimeFormat("en-CA", {\n' +
      '  timeZone: "America/Sao_Paulo",\n' +
      "}).format(new Date());\n",
  },
  {
    deveAcusar: true,
    nome: "budgets: o mes corrente derivado de uma constante de relogio",
    fonte: 'const MES_CORRENTE = new Date().toISOString().slice(0, 7);\n',
  },
  {
    deveAcusar: true,
    nome: "a forma com today() congelada no modulo",
    fonte: "const HOJE = today();\n",
  },
  {
    deveAcusar: true,
    nome: "export nao e disfarce",
    fonte: "export const AGORA = Date.now();\n",
  },
  {
    deveAcusar: false,
    nome: "budgets consertado: a leitura mora dentro da funcao",
    fonte: "const mesCorrente = () => today().slice(0, 7);\n",
  },
  {
    deveAcusar: false,
    nome: "payroll consertado: a mesma coisa, com o slice do mes",
    fonte: "const mesAtual = () => today().slice(0, 7);\n",
  },
  {
    deveAcusar: false,
    nome: "funcao classica de topo que formata uma data RECEBIDA",
    fonte:
      "function dataCurta(iso) {\n" +
      "  const d = new Date(iso);\n" +
      "  return d.toLocaleDateString();\n" +
      "}\n",
  },
  {
    deveAcusar: false,
    nome: "const de dentro de um componente (indentado) nao e escopo de modulo",
    fonte:
      "export default function Tela() {\n" +
      "  const hoje = today();\n" +
      "  return hoje;\n" +
      "}\n",
  },
];

const falhasDoAutoTeste = AUTO_TESTE.filter(
  (c) => achadosNoFonte(c.fonte).length > 0 !== c.deveAcusar
);

if (falhasDoAutoTeste.length > 0) {
  console.error(
    `XX o DETECTOR deste guard esta quebrado: ${falhasDoAutoTeste.length} de ` +
      `${AUTO_TESTE.length} casos do auto-teste nao se comportam.\n` +
      falhasDoAutoTeste
        .map(
          (c) =>
            `   ${c.deveAcusar ? "deveria acusar e nao acusou" : "acusou e nao deveria"}: ${c.nome}`
        )
        .join("\n") +
      "\n\n   A varredura NAO foi feita. Um detector apodrecido imprime zero\n" +
      "   achados, que e identico ao verde legitimo -- por isso ele para aqui."
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// PENEIRA 1: a arvore
// ---------------------------------------------------------------------------

const achados = [];
let arquivosVistos = 0;

for (const raiz of RAIZES) {
  for (const arquivo of arquivosDeFonte(raiz)) {
    arquivosVistos++;
    const limpo = semComentarios(readFileSync(arquivo, "utf8"));
    for (const a of achadosNoFonte(limpo)) {
      achados.push(`${arquivo}:${a.linha}  ${a.trecho}`);
    }
  }
}

let falhou = false;

// Nao-vacuidade da varredura: raiz renomeada ou walker quebrado sai verde sem
// ter medido nada, que e o modo de falha mais perigoso de um guard de CI.
if (arquivosVistos < 50) {
  console.error(
    `XX a varredura viu so ${arquivosVistos} arquivos em ${RAIZES.join(", ")}.\n` +
      "   Isso e pouco demais para este repositorio: o guard nao mediu nada."
  );
  falhou = true;
}

if (achados.length > 0) {
  console.error(
    `XX ${achados.length} declaracao(oes) de modulo congelando o relogio:\n` +
      achados.map((a) => `   ${a}`).join("\n") +
      "\n\n   Num componente `\"use client\"` isto e avaliado UMA vez, quando o\n" +
      "   navegador avalia o chunk -- nao quando a pessoa clica. Este app e PWA:\n" +
      "   a aba atravessa a meia-noite e a data continua sendo a de ONTEM. No\n" +
      "   dia 1o ela cai no MES ANTERIOR, e o lancamento muda de mes no fluxo de\n" +
      "   caixa e no teto da categoria sem nada na tela acusar.\n\n" +
      "   Troque por uma FUNCAO chamada no gesto: `const hojeNaTela = () =>\n" +
      "   today()` (`@/lib/recurrence`, com `America/Sao_Paulo` explicito).\n" +
      "   Nunca `new Date().toISOString()`: as 21h de Sao Paulo o UTC ja esta no\n" +
      "   dia seguinte e o erro so troca de direcao."
  );
  falhou = true;
}

// ---------------------------------------------------------------------------
// PENEIRA 2: a prop `hoje` continua sendo a FUNCAO
// ---------------------------------------------------------------------------
// O meio-termo que o conserto da peneira 1 nao pega: a tela nao congela no
// modulo, congela no RENDER (`hoje={today()}`) e manda a string. O dialogo grava
// o `paid_date` no clique de Confirmar, que pode ser de outro dia -- e no dia 1o
// de outro MES. Foi assim que `ListaDeMovimentacao.tsx` estava escrito, e o que
// o achou foi o tipo da prop deixando de compilar.

const DIALOGO = "components/fatura/DialogoDePagamentoDaFatura.tsx";

if (!existsSync(DIALOGO)) {
  console.error(
    `XX ${DIALOGO} nao existe.\n` +
      "   A peneira 2 nao mede mais nada. Se o dialogo mudou de lugar, aponte o\n" +
      "   caminho novo NESTE arquivo."
  );
  falhou = true;
} else {
  const doDialogo = semComentarios(readFileSync(DIALOGO, "utf8"));

  if (!/hoje\s*:\s*\(\s*\)\s*=>\s*string/.test(doDialogo)) {
    console.error(
      `XX ${DIALOGO}: a prop \`hoje\` nao e mais \`() => string\`.\n` +
        "   Era o tipo que impedia a volta: com `hoje: string` a tela pode\n" +
        "   mandar uma data lida no render, e o `paid_date` da fatura passa a ser\n" +
        "   o dia em que a aba abriu, nao o do clique em Confirmar."
    );
    falhou = true;
  }

  if (!/pagoEm\s*:\s*hoje\s*\(\s*\)/.test(doDialogo)) {
    console.error(
      `XX ${DIALOGO}: \`pagoEm\` nao sai mais de \`hoje()\` chamada no handler.\n` +
        "   Chamar a prop na montagem (ou guardar o resultado num `const` do\n" +
        "   componente) desfaz o conserto sem mudar o tipo: a data volta a ser a\n" +
        "   do render."
    );
    falhou = true;
  }
}

// E os chamadores DO DIALOGO: a prop recebe o NOME da funcao, nunca uma chamada.
//
// O recorte e deliberado, e custou um falso positivo para ser achado. A versao
// anterior varria `hoje={...(...)}` em toda a arvore e acusou
// `app/(dashboard)/dashboard/investments/page.tsx` (`hoje={hojeISO()}`, para
// `ModalDeMovimentacao`). Aquilo NAO e este defeito, e a diferenca e o que esta
// issue inteira mede:
//
//   * o modal de investimentos e montado CONDICIONALMENTE, no gesto de abrir --
//     entao a leitura do render e a leitura do gesto;
//   * e o que ele faz com `hoje` e semear um `CampoDeData` VISIVEL e o `max` do
//     calendario. A pessoa ve a data antes de salvar.
//
// `DialogoDePagamentoDaFatura` e o caso oposto, e e por isso que so ele tem
// guard: o `paid_date` nunca aparece na tela. Ninguem confere o que nao ve.
const CHAMADA_NA_PROP = /hoje\s*=\s*\{[^}]*\([^)]*\)[^}]*\}/g;
const chamadores = [];

for (const raiz of RAIZES) {
  for (const arquivo of arquivosDeFonte(raiz)) {
    if (!arquivo.endsWith(".tsx")) continue;
    const limpo = semComentarios(readFileSync(arquivo, "utf8"));
    if (!limpo.includes("<DialogoDePagamentoDaFatura")) continue;
    for (const m of limpo.matchAll(CHAMADA_NA_PROP)) {
      const linha = limpo.slice(0, m.index).split("\n").length;
      chamadores.push(`${arquivo}:${linha}  ${m[0].replace(/\s+/g, " ")}`);
    }
  }
}

if (chamadores.length > 0) {
  console.error(
    `XX ${chamadores.length} chamador(es) passando a prop \`hoje\` JA RESOLVIDA:\n` +
      chamadores.map((c) => `   ${c}`).join("\n") +
      "\n\n   Passe a funcao (`hoje={today}`), nao o resultado dela\n" +
      "   (`hoje={today()}`). A segunda forma le o relogio neste render; o\n" +
      "   `paid_date` que o dialogo grava e do clique em Confirmar."
  );
  falhou = true;
}

// Nao-vacuidade da peneira 2: sem chamador nenhum ela nao mede nada. As duas
// telas que pagam fatura sao `bills/page.tsx` e `ListaDeMovimentacao.tsx`, e o
// numero esta aqui para que uma terceira passe por esta decisao.
const CHAMADORES_ESPERADOS = 2;
let montagens = 0;
for (const raiz of RAIZES) {
  for (const arquivo of arquivosDeFonte(raiz)) {
    if (!arquivo.endsWith(".tsx") || arquivo === DIALOGO) continue;
    const limpo = semComentarios(readFileSync(arquivo, "utf8"));
    montagens += (limpo.match(/<DialogoDePagamentoDaFatura[\s/>]/g) ?? []).length;
  }
}

if (montagens !== CHAMADORES_ESPERADOS) {
  console.error(
    `XX ${montagens} tela(s) montam <DialogoDePagamentoDaFatura, e o esperado e ` +
      `${CHAMADORES_ESPERADOS}.\n` +
      "   Menos: a peneira 2 passa verde por falta de assunto -- e pagar fatura\n" +
      "   pode ter saido da tela. Mais: a tela nova nao passou por esta decisao.\n" +
      "   Nos dois casos, ajuste o numero NESTE arquivo, com o motivo."
  );
  falhou = true;
}

if (falhou) process.exit(1);

console.log(
  `OK: nenhuma tela congela o relogio em constante de modulo ` +
    `(${arquivosVistos} arquivos em ${RAIZES.join(", ")}), ` +
    `a prop \`hoje\` continua sendo \`() => string\` e os chamadores passam a funcao ` +
    `(detector conferido em ${AUTO_TESTE.length} casos de auto-teste).`
);
