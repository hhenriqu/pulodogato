#!/usr/bin/env node
// =====================================================
// O CARTAO DESLIGADO SAI DE "FATURAS EM ABERTO"? (HMO-434)
// =====================================================
//   node scripts/check-cartao-fora-dos-totais.mjs
//
// POR QUE ISTO EXISTE, SE O CRITERIO JA TEM 13 ASSERCOES E 5 MUTANTES
// -------------------------------------------------------------------
// Porque `npm run test:contas` prova o CRITERIO, e o criterio pode estar
// perfeito e nao estar LIGADO. Esta issue nasceu exatamente desse estado: o
// checkbox "Somar nos totais" existia desde a 058, `contasQueSomam` existia e
// tinha teste, o formulario do cartao mostrava o campo e gravava certo no
// banco -- e "Faturas em aberto" somava os cartoes todos, porque NINGUEM
// chamava o criterio naquele caminho. Zero erro, zero log, `tsc` verde.
//
// E A TELA DE CARTOES E O PIOR LUGAR POSSIVEL PARA ESSE DEFEITO VOLTAR, porque
// ela e a unica peca desta feature que NENHUMA suite alcanca:
// `cartoes/page.tsx` e componente de cliente com tres hooks de dados
// (`useContas`, `useEstaOnline`, `usePreferenciaDeMoeda`) e nao renderiza em
// `react-dom/server`. O criterio esta em lib/contas.ts e o selo esta em
// CartaoDaLista.tsx justamente para CABEREM em teste -- mas a linha que liga os
// dois mora na pagina, e essa linha e invisivel para todo o resto da bateria.
// E a familia de
// `formulario-de-lancamento-grava-direto-e-escapa-da-suite-de-rota`.
//
// OS QUATRO DEFEITOS DE FIACAO QUE ESTE GUARD PEGA, e nenhum deles aparece no
// `tsc` -- os quatro compilam e os quatro sao plausiveis na tela:
//
//   1. a pagina volta a `ativas.map((c) => c.id)` -> o total soma o cartao
//      desligado. E o defeito original desta issue, de volta inteiro;
//   2. a pagina recorta o total e NAO as parcelas futuras (ou o contrario) ->
//      a nota "+ R$ X nos meses seguintes" promete comprometimento de um cartao
//      que o numero de cima nao conta, uma linha abaixo dele;
//   3. a frase desaparece -> o total nao fecha com os cards embaixo e nada na
//      tela diz por que. A pessoa conclui "o total esta errado" e lanca um
//      ajuste para consertar um numero que esta certo;
//   4. o selo sai do card -> o cartao desligado fica indistinguivel do que
//      soma (`sumido-da-tela-pode-ser-so-indistinguivel`).
//
// O 4 TEM ASSERCAO DE HTML em test-tela-do-cartao.mjs e esta aqui de qualquer
// forma, por ser de graca: o selo e o unico pedaco que as duas provas cobrem, e
// e o controle de que este guard mede codigo vivo.
//
// POR QUE A ROTA TAMBEM ENTRA
// ---------------------------
// `GET /api/card-invoices` publica um `total` no topo da resposta. Hoje
// ninguem o le -- os tres consumidores pegam so `invoices` --, e e por isso que
// ele precisa continuar honrando o flag: um campo chamado `total`, cego ao
// criterio, e a proxima pessoa somando `dados.total` em vez de `invoices`, com
// o numero dela discordando da tela do lado e nada entre os dois para denunciar
// qual esta certo. O `select` que traz o flag e a soma que o aplica sao uma so
// mudanca, e meia e pior que nenhuma: o campo publicado `include_in_total` em
// toda fatura, com o `total` cego, afirma por omissao que o total o respeita.
//
// COMENTARIO E IMPORT SAIEM ANTES DA VARREDURA, E OS DOIS SAO LOAD-BEARING
// -----------------------------------------------------------------------
// Os arquivos medidos aqui EXPLICAM esta decisao em prosa, e a prosa cita os
// nomes das funcoes -- varrendo o fonte cru, este guard passaria verde lendo os
// proprios comentarios que descrevem o defeito, e continuaria verde depois de
// alguem apagar o codigo e deixar o comentario. E a lista de `import` mede se a
// dependencia foi DECLARADA, nao se ela e usada: trocar
// `idsDasContasQueSomam(ativas)` por `ativas.map((c) => c.id)` deixa o import
// intacto e o nome continua "aparecendo" no arquivo. Com os dois fora, a unica
// forma de satisfazer a exigencia e CHAMAR. Mesma correcao que o
// check-cartao-pela-fatura levou no proprio guard dele.
// =====================================================

import { readFileSync } from "node:fs";
import { semComentarios } from "./varredura-de-fonte.mjs";

/** O fonte sem comentario e sem a lista de imports. Ver o cabecalho. */
function semComentariosNemImports(fonte) {
  return semComentarios(fonte).replace(
    /^\s*import\s[\s\S]*?from\s*["'][^"']*["'];?\s*$/gm,
    ""
  );
}

const TELA = "app/(dashboard)/dashboard/cartoes/page.tsx";
const CARD = "components/cartoes/CartaoDaLista.tsx";
const ROTA = "app/api/card-invoices/route.ts";
const CRITERIO = "lib/contas.ts";

const EXIGE = [
  {
    arquivo: TELA,
    trechos: [
      // A CHAMADA, e nao o nome solto: e isto que distingue "o criterio esta
      // ligado" de "o criterio foi importado e esquecido".
      "idsDasContasQueSomam(ativas)",
      // AS DUAS SOMAS PELA MESMA LISTA. Recortar uma e nao a outra e o defeito
      // 2 do cabecalho, e ele e silencioso: os dois numeros ficam plausiveis,
      // um em cima do outro.
      "somaDasFaturas(faturas, idsQueSomam)",
      "somaDasParcelasFuturas(faturas, idsQueSomam)",
      // A FRASE, com o pedagio dela. `avisoDosCartoesForaDosTotais(ativas)`
      // sem o `{avisoForaDosTotais}` no JSX e uma variavel calculada e nao
      // impressa -- que o `tsc` nao reclama e o lint tambem nao, porque ela e
      // "usada" pelo `useMemo`.
      "avisoDosCartoesForaDosTotais(ativas)",
      "{avisoForaDosTotais}",
    ],
    porque:
      "o total de «Faturas em aberto» e somado NESTA pagina, que nenhuma suite renderiza. Sem a chamada de `idsDasContasQueSomam`, o cartao com «Somar nos totais» desmarcado volta a entrar no total -- o defeito original da HMO-434, com os 5 mutantes de lib/contas.ts verdes.",
  },
  {
    arquivo: TELA,
    trechos: [
      // O recorte do total NAO pode levar embora o pedagio do `null` que ja
      // existia: a soma parcial sob o rotulo "Faturas em aberto" e um numero
      // menor que o certo, plausivel, e sem nada na tela avisando.
      "fatura !== null",
    ],
    porque:
      "`mostraTotal` perdeu o pedagio do `null`. O recorte da lista de ids muda QUEM entra na soma e nao pode mudar a politica de «faltou a fatura de um cartao, o total inteiro e indisponivel» -- ver o cabecalho de lib/fatura-do-periodo.ts.",
  },
  {
    arquivo: CARD,
    trechos: [
      // O SELO, e com o `=== false` dentro: ver o PROIBE abaixo para a outra
      // metade desta exigencia.
      "conta.include_in_total === false",
      "fora dos totais",
    ],
    porque:
      "sem o selo, o cartao fora dos totais fica indistinguivel do que soma -- a fatura dele aparece inteira no card e nao esta no total de cima, e nada no card explica a diferenca.",
  },
  {
    arquivo: ROTA,
    trechos: [
      // A aplicacao. O `select` que traz o campo e exigido por PADRAO logo
      // abaixo (`EXIGE_PADRAO`), porque literal nao serve ali -- ver o
      // comentario de lá.
      "contasQueSomam(faturas)",
    ],
    porque:
      "o `total` do topo de `GET /api/card-invoices` tem de honrar o flag. Sem `contasQueSomam(faturas)` o campo chega e nao e aplicado, e a rota publica um total cego com o flag ao lado dele em cada fatura.",
  },
  {
    arquivo: CRITERIO,
    trechos: [
      // O criterio e UM. As tres funcoes da tela de Cartoes derivam de
      // `contasQueSomam` em vez de repetir o predicado -- se alguem reescrever
      // qualquer uma com um `!== false` proprio, este trecho desaparece.
      "return contasQueSomam(contas).map((conta) => conta.id);",
      "return contas.length - contasQueSomam(contas).length;",
    ],
    porque:
      "`idsDasContasQueSomam` e `quantasForaDosTotais` tem de DERIVAR de `contasQueSomam`, e nao reescrever o predicado. Uma segunda copia de `include_in_total !== false` e o que faria a tela de Cartoes ficar para tras no dia em que a regra ganhar um segundo criterio -- e o sintoma seria o total dela discordando do de Contas, sem nada na tela confrontando os dois.",
  },
];

/**
 * O que se exige por PADRAO, e nao por literal.
 *
 * O `select` da rota e o unico caso aqui em que o literal nao serve, e as duas
 * tentativas erradas custaram um controle negativo cada:
 *
 *   * pedir o nome `include_in_total` solto SOBREVIVE a remocao da coluna do
 *     `select` -- o nome continua aparecendo tres linhas abaixo, no
 *     `jaMontada.include_in_total =` e no campo da fatura montada a mao. O
 *     guard passaria verde lendo os LEITORES de um campo que a consulta parou
 *     de trazer, que e exatamente o estado em que toda fatura chega
 *     `undefined` e o `total` volta a somar o cartao desligado;
 *   * pedir a string inteira `"id, name, closing_day, due_day,
 *     include_in_total"` mata aquele mutante mas reprova um REORDENAMENTO das
 *     colunas, que e refatoracao legitima e nao mexe em comportamento nenhum.
 *     Guard que reprova o certo e guard que a proxima pessoa desliga.
 *
 * Entao o que se exige e a propriedade de verdade: existe um `.select(...)`
 * cujo ARGUMENTO nomeia a coluna. Ordem, espaco e as outras colunas ficam
 * livres.
 */
const EXIGE_PADRAO = [
  {
    arquivo: ROTA,
    padrao: /\.select\(\s*"[^"]*\binclude_in_total\b[^"]*"\s*\)/,
    oQue: "um `.select(...)` que nomeie `include_in_total`",
    porque:
      "sem a coluna no `select` o campo nunca chega da consulta de `financial_accounts` -- e a view `card_invoice_lines` nao a publica, entao nao ha segunda fonte. Toda fatura chega `undefined`, que `!== false` conta pelo lado seguro, e o `total` da rota volta a somar o cartao desligado sem nenhum erro visivel.",
  },
];

/**
 * O que NAO pode aparecer.
 *
 * `=== true` e `!conta.include_in_total` sao as duas formas erradas de escrever
 * o mesmo predicado, e as duas falham do lado que ESVAZIA -- com elas o cartao
 * vindo do cache offline de antes da 058 (sem o campo) sai dos totais, e a tela
 * imprime "Faturas de outubro: R$ 0,00" com fatura em todo cartao, sem rede
 * para conferir. Ver o bloco homonimo em lib/contas.ts e
 * `coluna-booleana-anulavel-not-is-false`.
 */
const PROIBE = [
  {
    arquivo: CARD,
    trechos: ["!conta.include_in_total", "conta.include_in_total === true"],
    porque:
      "o selo tem de ser `=== false`. `!conta.include_in_total` marca como «fora dos totais» TODO cartao vindo do cache offline de antes da 058, justamente quando a tela nao tem rede para conferir.",
  },
  {
    arquivo: TELA,
    trechos: [
      // A copia do predicado na pagina -- o jeito mais provavel de alguem
      // "consertar" isto sem passar pelo criterio.
      "include_in_total !== false",
      "include_in_total === false",
      "ativas.map((c) => c.id)",
    ],
    porque:
      "a pagina nao escreve o criterio nem a lista crua de ids: ela chama `idsDasContasQueSomam`. `ativas.map((c) => c.id)` e literalmente o defeito desta issue, e um `include_in_total !== false` aqui e a segunda copia do predicado, longe do comentario que explica por que ele e `!== false`.",
  },
];

let falhas = 0;

for (const { arquivo, trechos, porque } of EXIGE) {
  const fonte = semComentariosNemImports(readFileSync(arquivo, "utf8"));
  for (const trecho of trechos) {
    if (!fonte.includes(trecho)) {
      falhas += 1;
      console.error(`\n✖ ${arquivo}\n  falta: ${trecho}\n  porque: ${porque}`);
    }
  }
}

for (const { arquivo, padrao, oQue, porque } of EXIGE_PADRAO) {
  const fonte = semComentariosNemImports(readFileSync(arquivo, "utf8"));
  if (!padrao.test(fonte)) {
    falhas += 1;
    console.error(`\n✖ ${arquivo}\n  falta: ${oQue}\n  porque: ${porque}`);
  }
}

for (const { arquivo, trechos, porque } of PROIBE) {
  const fonte = semComentariosNemImports(readFileSync(arquivo, "utf8"));
  for (const trecho of trechos) {
    if (fonte.includes(trecho)) {
      falhas += 1;
      console.error(
        `\n✖ ${arquivo}\n  nao pode ter: ${trecho}\n  porque: ${porque}`
      );
    }
  }
}

// O CONTROLE DO PROPRIO GUARD, e ele e requisito e nao zelo: um
// `semComentariosNemImports` que apagasse DEMAIS deixaria toda exigencia do
// EXIGE falhando (sintoma alto, se descobre na hora) -- mas tambem faria todo
// trecho do PROIBE passar, medindo o vazio, e esse lado e MUDO. Estes arquivos
// sao de comentario denso: a tela tem mais prosa que codigo. A contagem minima
// prova que sobrou codigo para medir.
for (const [arquivo, minimo] of [
  [TELA, 4000],
  [CARD, 1500],
  [ROTA, 2500],
  [CRITERIO, 4000],
]) {
  const corpo = semComentariosNemImports(readFileSync(arquivo, "utf8"));
  if (corpo.length < minimo) {
    falhas += 1;
    console.error(
      `\n✖ ${arquivo}\n  sobraram so ${corpo.length} chars (minimo ${minimo}) depois de ` +
        "tirar comentario e import: o filtro do guard comeu o codigo, e as " +
        "proibicoes acima estariam medindo o vazio."
    );
  }
}

if (falhas) {
  console.error(`\n${falhas} verificacao(oes) falharam.`);
  process.exit(1);
}

console.log(
  "✔ o cartao fora dos totais sai do total e das parcelas futuras, a tela diz " +
    "por que, o card leva o selo, e a rota nao publica total cego."
);
