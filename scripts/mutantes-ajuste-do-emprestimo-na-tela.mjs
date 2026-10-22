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
// O MUTANTE QUE "NAO ESTAVA NA LISTA" -- E A RAZAO ERA FALSA (HMO-479)
// --------------------------------------------------------------------
// Ate a HMO-479 este cabecalho dizia que o mais obvio de todos faltava de
// proposito:
//
//     const emprestado = juro ? juro.principal : Number(emprestimo.principal);
//  -> const emprestado = Number(emprestimo.principal);
//
// ...por ser "EQUIVALENTE hoje", com o argumento de que `juroDepoisDoAjuste`
// devolve o `principal` intacto (HMO-478, opcao A) e que portanto "as duas
// leituras dao o mesmo numero em TODO estado alcancavel".
//
// A SEGUNDA METADE DAQUELA FRASE ERA FALSA, e e por ela que o defeito passou.
// O ramo em que as duas DISCORDAM nao era futuro: era alcancavel desde a F4.
// Num emprestimo SEM juro, `{total}` faz `ajusteMexeNoJuro` devolver `false`
// (logo `juro === null`) e a rota gravar `principal = total` no
// `patchDoEmprestimo`. Ali `Number(emprestimo.principal)` e o valor ANTIGO, e o
// emprestado e justamente o que se move. Medido no cenario do caso D7 (4x250,00
// sem juro, novo total 1.200,00): a tela dizia "Você emprestou R$ 1.000,00" e o
// patch levava `{principal: 1200}`.
//
// O raciocinio errou por olhar so a funcao do juro: ela de fato nunca move o
// principal, mas ela NAO E o unico caminho que grava a coluna. "Equivalente"
// foi concluido do ramo com juro e aplicado aos tres.
//
// Entao o mutante 29 e exatamente aquele codigo, agora na lista e MORTO pelo
// caso E1 -- que nao crava so um R$ escolhido a mao: ele pergunta ao
// `patchDoEmprestimo` o que vai ser gravado. A licao fica anotada aqui porque o
// cheiro era bom e a conclusao nao: um mutante declarado equivalente POR
// ARGUMENTO, e nao por medicao, e um defeito com justificativa escrita.
//
// A lista TEM TAMBEM os mutantes 13 e 14, que leem a grandeza errada do MESMO
// objeto (`juro.total`, `juro.juros`) -- esses mudam numero e morrem.
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

  // OS DOIS PROXIMOS ANCORAM NO TERNARIO DE TRES RAMOS, e a ancora e as DUAS
  // primeiras linhas dele: a HMO-479 trocou aquele `const` de uma linha por
  // cinco, e um `de` com a forma antiga sairia 1 em ANCORA NAO ENCONTRADA
  // (`ancora-de-mutante-casa-no-comentario-e-o-cmp-nao-ve`). `? juro.principal`
  // sozinho nao serve de ancora: a string aparece tambem no JSDoc da funcao.
  [
    LIB,
    "13 O EMPRESTADO MOSTRA A DIVIDA: o `principal` parado desaparece da tela",
    "  const emprestado = juro\n    ? juro.principal",
    "  const emprestado = juro\n    ? juro.total",
  ],

  [
    LIB,
    "14 O EMPRESTADO MOSTRA O JURO: o numero grande vira o pequeno",
    "  const emprestado = juro\n    ? juro.principal",
    "  const emprestado = juro\n    ? juro.juros",
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

  // =========================================================================
  // G -- O EMPRESTADO QUE MUDA, E A FRASE QUE O EXPLICA (HMO-479)
  // =========================================================================

  // O MUTANTE QUE ESTE CABECALHO CHAMAVA DE EQUIVALENTE. Ele e o codigo que
  // estava em producao ate a HMO-479; morre no caso E1, que compara a previa com
  // o `patchDoEmprestimo` da rota em vez de confiar no ramo com juro.
  [
    LIB,
    "29 O EMPRESTADO IGNORA O CONSERTO: sem juro, {total} mostra o valor ANTIGO",
    "  const emprestado = juro\n    ? juro.principal\n    : pedido.total !== undefined\n      ? total\n      : Number(emprestimo.principal);",
    "  const emprestado = Number(emprestimo.principal);",
  ],

  [
    LIB,
    "30 A FRASE DIZ 'CONTINUA' SEMPRE: ela mente no ramo em que o emprestado muda",
    "  if (params.pedido.total !== undefined) {\n    return `Isto corrige o valor emprestado para ${emprestado.valor}.`;",
    "  if (false) {\n    return `Isto corrige o valor emprestado para ${emprestado.valor}.`;",
  ],

  [
    LIB,
    "31 A FRASE TROCA OS RAMOS: o conserto promete taxa e o juro promete conserto",
    "  if (juro) {\n    return `Você continua tendo emprestado",
    "  if (!juro) {\n    return `Você continua tendo emprestado",
  ],

  [
    LIB,
    "32 A FRASE PERDE O 'CONTINUA': sobra um fato, sem a noticia de que ele NAO muda",
    "    return `Você continua tendo emprestado ${emprestado.valor}",
    "    return `Você tem emprestado ${emprestado.valor}",
  ],

  // A FRASE LENDO UMA SEGUNDA FONTE -- o defeito de `previa-na-tela-tem-que-usar-
  // o-peso-do-fechamento` na sua forma menor: a frase e a linha `emprestado` tem
  // de dizer o MESMO R$, e aqui a frase passa a falar da divida.
  [
    LIB,
    "33 A FRASE LE O TOTAL: o numero da frase discorda da linha logo acima dela",
    '  const emprestado = grandezas.find((g) => g.chave === "emprestado");',
    '  const emprestado = grandezas.find((g) => g.chave === "total");',
  ],

  [
    LIB,
    "34 A FRASE APARECE NO PEDIDO SEM NOTICIA: a descricao nova 'move a taxa'",
    "  // frase, e o preco disso se paga nos dois ramos acima.\n  return null;",
    "  // frase, e o preco disso se paga nos dois ramos acima.\n  return `Você continua tendo emprestado ${emprestado.valor}.`;",
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
