#!/usr/bin/env node
// =========================================================
// CONTROLE NEGATIVO de `lib/ajuste-do-emprestimo-na-tela.ts` (HMO-480, F8 da HMO-444)
// =========================================================
//   node scripts/mutantes-ajuste-do-emprestimo-na-tela.mjs
//
// Cada mutante abaixo e um defeito PLAUSIVEL deste modulo, e a suite
// `test:ajuste-do-emprestimo-na-tela` tem de reprovar com ele aplicado. Um mutante que
// sobrevive e um defeito que a suite nao ve.
//
// AS DUAS FAMILIAS QUE ESTE RUNNER EXISTE PARA CERCAR
// ---------------------------------------------------
//   A. O CAMPO QUE VIAJA SEM TER SIDO TOCADO. Os mutantes que trocam a guarda
//      de presenca por `true` nao mudam valor nenhum na tela -- o pedido fica
//      certo em todos os numeros e tem uma chave a mais. So assercao de
//      PRESENCA os mata, e e por isso que a suite tem `!("x" in pedido)` em
//      quase todo caso.
//
//   B. A GRANDEZA LIDA DO LUGAR ERRADO. `total` e `falta_receber` coincidem no
//      emprestimo sem nada pago, entao trocar uma pela outra passaria verde
//      para sempre num fixture ingenuo. Os mutantes 13 a 18 so morrem porque
//      TODO fixture de previa da suite tem parcela paga.
//
// O MUTANTE QUE NAO ESTA NA LISTA, E O PORQUE
// -------------------------------------------
// Falta de proposito o mais obvio de todos:
//
//     const emprestado = juro ? juro.principal : Number(emprestimo.principal);
//  -> const emprestado = Number(emprestimo.principal);
//
// Ele e EQUIVALENTE hoje, e nao por descuido da suite: `juroDepoisDoAjuste`
// devolve o `principal` que recebeu, intacto e por decisao (HMO-478, opcao A).
// As duas leituras dao o mesmo numero em TODO estado alcancavel, entao nenhum
// fixture pode distingui-las -- e inventar um teste que "o mate" exigiria
// inventar uma funcao que move o principal, que e justamente o que ela nao faz.
//
// A razao de preferir `juro.principal` e OUTRA, e esta escrita no cabecalho do
// modulo: ela e de MEDICAO FUTURA. No dia em que alguem fizer o ajuste mover o
// principal, a previa lendo a resposta da funcao mostra o numero movido (e um
// teste pega), e a previa lendo o fixture continua dizendo "parado" (e nada
// pega). Poe-lo na lista como se morresse seria
// `guarda-de-ancora-verde-nao-prova-que-o-mutante-morre` ao contrario: um
// SOBREVIVEU permanente que alguem "consertaria" afrouxando a suite.
//
// O que a lista TEM no lugar dele sao os mutantes 13 e 14, que leem a grandeza
// errada do MESMO objeto (`juro.total`, `juro.juros`) -- esses mudam numero e
// morrem.
//
// A FORMA DA LISTA: tupla `[ALVO, rotulo, de, para]`, com `de` sempre
// contendo codigo e nunca so texto que tambem existe em comentario -- este
// arquivo e o modulo-alvo sao os dois muito comentados, e
// `ancora-de-mutante-casa-no-comentario-e-o-cmp-nao-ve` nasceu assim. A trava
// de ocorrencia unica do laco pega o caso e sai 1.
// =========================================================

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const LIB = "lib/ajuste-do-emprestimo-na-tela.ts";

/** [alvo, rotulo, de, para] */
const mutantes = [
  // =========================================================================
  // A -- A PRESENCA DO CAMPO (familia A do cabecalho)
  // =========================================================================

  [
    LIB,
    "01 A DESCRICAO VIAJA SEMPRE: o typo nao corrigido vira ajuste",
    '  if (form.descricao.trim() !== "") {\n    pedido.descricao = form.descricao;',
    "  if (true) {\n    pedido.descricao = form.descricao;",
  ],

  [
    LIB,
    "02 A DESCRICAO NUNCA VIAJA: o botao acende e o texto nao muda",
    '  if (form.descricao.trim() !== "") {\n    pedido.descricao = form.descricao;',
    "  if (false) {\n    pedido.descricao = form.descricao;",
  ],

  [
    LIB,
    "03 A TAXA IGNORA O MODO: os dois campos de juro viajam juntos",
    '  if (form.modoDoJuro === "taxa" && form.taxa.trim() !== "") {',
    '  if (form.taxa.trim() !== "") {',
  ],

  [
    LIB,
    "04 O TOTAL IGNORA O MODO: os dois campos de juro viajam juntos",
    '  if (form.modoDoJuro === "total" && form.total.trim() !== "") {',
    '  if (form.total.trim() !== "") {',
  ],

  [
    LIB,
    "05 A TAXA ZERO SOME: perdoar o juro deixa de ser pedivel",
    '  if (form.modoDoJuro === "taxa" && form.taxa.trim() !== "") {',
    '  if (form.modoDoJuro === "taxa" && Number(form.taxa) !== 0) {',
  ],

  [
    LIB,
    "06 A DATA VIAJA SEMPRE: o dialogo recem-aberto adia a cauda",
    '  if (form.primeiroVencimentoDaCauda.trim() !== "") {',
    "  if (true) {",
  ],

  [
    LIB,
    "07 A DATA NUNCA VIAJA: a data digitada e descartada calada",
    '  if (form.primeiroVencimentoDaCauda.trim() !== "") {',
    "  if (false) {",
  ],

  [
    LIB,
    "08 O TOTAL VIAJA COMO TAXA: o alternador troca o campo de lugar",
    "    pedido.total = form.total;",
    "    pedido.taxa = form.total;",
  ],

  // =========================================================================
  // B -- O CRITERIO DO BOTAO (`pedidoAjustaAlgumCampo`)
  // =========================================================================

  [
    LIB,
    "09 O CRITERIO PERDE A DESCRICAO: o typo nao habilita o botao",
    "    pedido.descricao !== undefined ||",
    "    false ||",
  ],

  [
    LIB,
    "10 O CRITERIO PERDE A DATA: adiar a cauda nao habilita o botao",
    "    pedido.primeiroVencimentoDaCauda !== undefined",
    "    false",
  ],

  [
    LIB,
    "11 O CRITERIO PERDE A TAXA: trocar a taxa nao habilita o botao",
    "    pedido.taxa !== undefined ||",
    "    false ||",
  ],

  [
    LIB,
    "12 O CRITERIO E SEMPRE VERDADE: o dialogo vazio manda `{}` e leva recusa",
    "    pedido.descricao !== undefined ||",
    "    true ||",
  ],

  // =========================================================================
  // C -- A PREVIA LE A GRANDEZA ERRADA (familia B do cabecalho)
  // =========================================================================

  [
    LIB,
    "13 O EMPRESTADO MOSTRA A DIVIDA: o `principal` parado desaparece da tela",
    "  const emprestado = juro ? juro.principal : Number(emprestimo.principal);",
    "  const emprestado = juro ? juro.total : Number(emprestimo.principal);",
  ],

  [
    LIB,
    "14 O EMPRESTADO MOSTRA O JURO: o numero grande vira o pequeno",
    "  const emprestado = juro ? juro.principal : Number(emprestimo.principal);",
    "  const emprestado = juro ? juro.juros : Number(emprestimo.principal);",
  ],

  [
    LIB,
    "15 FALTA RECEBER MOSTRA O TOTAL: a divida inteira no lugar do que sobra",
    "    valor: emReaisDaPrevia(faltaReceber),",
    "    valor: emReaisDaPrevia(total),",
  ],

  [
    LIB,
    "16 O TOTAL MOSTRA O QUE FALTA: a parcela paga desaparece da divida",
    '    chave: "total",\n    rotulo: "Passa a valer",\n    valor: emReaisDaPrevia(total),',
    '    chave: "total",\n    rotulo: "Passa a valer",\n    valor: emReaisDaPrevia(faltaReceber),',
  ],

  [
    LIB,
    "17 O JA RECEBIDO VIRA ZERO: falta receber conta a parcela ja paga",
    "    jaRecebido: jaRecebidoDaSerie(parcelas),",
    "    jaRecebido: 0,",
  ],

  [
    LIB,
    "18 AS PENDENTES VIRAM A SERIE INTEIRA: a cauda soma o que ja foi pago",
    "    pendentes: pendentesDaSerie(parcelas),",
    "    pendentes: parcelas,",
  ],

  [
    LIB,
    "19 O TOTAL NAO SABE DO JURO: a taxa nova nao chega ao total",
    "  const total = totalDepoisDoAjuste({ emprestimo, pedido, juro });",
    "  const total = totalDepoisDoAjuste({ emprestimo, pedido, juro: null });",
  ],

  [
    LIB,
    "20 FALTA RECEBER NAO SABE DO JURO: a taxa nova nao chega a cauda",
    "    pedido,\n    juro,\n  });",
    "    pedido,\n    juro: null,\n  });",
  ],

  // =========================================================================
  // D -- A PREVIA APARECE QUANDO NAO DEVE
  // =========================================================================

  [
    LIB,
    "21 A PREVIA DO DIALOGO VAZIO: quatro grandezas de 'nada mudou' ja calculadas",
    "  if (!pedidoAjustaAlgumCampo(pedido)) return null;",
    "  if (false) return null;",
  ],

  [
    LIB,
    "22 A TAXA SAI DA PREVIA: o modo `total` deixa de dizer quanto se cobra",
    '      chave: "taxa",\n      rotulo: "Taxa do empréstimo",\n      valor: emPercentoDaPrevia(juro.taxa),\n    });',
    '      chave: "emprestado",\n      rotulo: "Taxa do empréstimo",\n      valor: emPercentoDaPrevia(juro.taxa),\n    });',
  ],

  // =========================================================================
  // E -- A TRADUCAO DAS DUAS FORMAS DA PARCELA
  // =========================================================================

  [
    LIB,
    "23 O VALOR DA PARCELA VIRA O NUMERO DE PARCELAS (o 24 de '3 de 24')",
    "    amount: parcela.valor,",
    "    amount: parcela.total,",
  ],

  [
    LIB,
    "24 A PARCELA PERDE O STATUS: toda parcela vira pendente e nada foi recebido",
    "    status: parcela.status,",
    '    status: "pending",',
  ],

  [
    LIB,
    "25 O NUMERO DA PARCELA VIRA O TOTAL DELAS: a ordem da cauda se embaralha",
    "    installment_number: parcela.numero,",
    "    installment_number: parcela.total,",
  ],

  // =========================================================================
  // F -- OS ROTULOS E O ESTADO DE ABERTURA
  // =========================================================================

  [
    LIB,
    "26 O MODO INICIAL DIZ 'SEM JUROS': a frase promete zerar o juro e nao zera",
    '      return "Não mexer nos juros";',
    '      return "Sem juros";',
  ],

  [
    LIB,
    "27 O FORMULARIO ABRE NO MODO TAXA: o campo de juro nasce oferecido",
    '  modoDoJuro: "sem_juros",',
    '  modoDoJuro: "taxa",',
  ],

  [
    LIB,
    "28 O FORMULARIO ABRE COM DESCRICAO: o dialogo nasce com um ajuste dentro",
    '  descricao: "",',
    '  descricao: "Empréstimo",',
  ],
];

const SUITE = "test:ajuste-do-emprestimo-na-tela";

const bloco = criarBlocoDeMutantes({
  suites: [SUITE],
  rotulo: "ajuste-do-emprestimo-na-tela",
});

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela. Montado DEPOIS da lista.
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
  // risco e concreto aqui -- o modulo-alvo cita `pedido.descricao` e
  // `juro.principal` na prosa do cabecalho.
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
