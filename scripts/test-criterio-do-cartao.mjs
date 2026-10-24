// =====================================================
// PULODOGATO - as duas legendas do criterio do cartao (HMO-266)
// =====================================================
//   npm run test:criterio-do-cartao
//
// O QUE ESTA SUITE AFIRMA, QUE NAO E "A FRASE ESTA ESCRITA"
// ---------------------------------------------------------
// `lib/criterio-do-cartao.ts` nao calcula dinheiro -- ele devolve texto. Uma
// suite que so comparasse a string com ela mesma nao afirmaria nada: passaria
// verde com as duas legendas IGUAIS, com as duas TROCADAS de lugar, e com uma
// delas descrevendo apenas a propria regra.
//
// DESDE A FASE 6 O PAR E OUTRO. Ate a fase 5 eram o painel (a fatura paga) e a
// tela de relatorios (a compra). Desde a 072 as duas telas pessoais contam a
// fatura paga, no mes do vencimento, e o que ainda conta a compra e o GRUPO.
// Entao as assercoes sao sobre as PROPRIEDADES que fazem o par novo funcionar:
//
//   1. cada legenda NOMEIA A OUTRA REGRA: a do pessoal fala do grupo, e a do
//      grupo fala do painel pessoal;
//   2. a PRIMEIRA FRASE de cada uma e a propria regra. Esta e a assercao que
//      mata a troca: copiar uma legenda para o lugar da outra poe a regra do
//      grupo na primeira frase da tela pessoal;
//   3. cada legenda cita os DOIS eixos (compra e fatura);
//   4. a legenda do pessoal diz as tres partes da RN017.4: o mes do
//      VENCIMENTO, o TOTAL das compras, e que a fatura EM ABERTO ainda nao e
//      realizado. Sem a terceira, quem lancou a compra de ontem le "sumiu";
//   5. valor desconhecido NAO recebe legenda;
//   6. e a ultima, que e a unica que nao e sobre texto: os valores que a ROTA
//      emite sao criterios que este modulo conhece, nos dois sentidos. Ela sai
//      do fonte de /api/reports/cash-flow, porque o contrato entre os dois e um
//      string que atravessa `await res.json()` -- `any` na fronteira, invisivel
//      no tsc.
//
// A comparacao e sempre em minusculas e sem acento: o que esta sob teste e se a
// legenda DIZ a coisa, nao a grafia dela. Exigir "Relatórios" com maiuscula e
// acento transformaria qualquer revisao de texto em suite vermelha, e o sintoma
// disso e a proxima pessoa afrouxar a assercao inteira para parar o vermelho.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { LEGENDA_DO_CARTAO, legendaDoCartao } = await import(
  "../.tmp-criterio-do-cartao/criterio-do-cartao.js"
);

/** Minusculas e sem acento, para a assercao medir o conteudo e nao a grafia. */
const normal = (texto) =>
  texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const COMPRA = normal(LEGENDA_DO_CARTAO.compra);
const FATURA = normal(LEGENDA_DO_CARTAO.fatura);

// ---------------------------------------------------------------------------
// 1. Cada legenda nomeia a OUTRA tela
// ---------------------------------------------------------------------------

test("a legenda do pessoal nomeia o grupo, que e a outra regra", () => {
  assert.ok(
    FATURA.includes("grupo"),
    "a legenda do painel e dos relatórios tem de dizer que o GRUPO conta a compra — " +
      "sem nomear a outra regra, ela não explica a divergência com o painel do grupo"
  );
});

test("a legenda do grupo nomeia o painel pessoal, que e a outra regra", () => {
  assert.ok(
    COMPRA.includes("pessoal"),
    "a legenda do grupo tem de dizer que o painel PESSOAL conta pela fatura"
  );
});

// ---------------------------------------------------------------------------
// 2. A primeira frase e a PROPRIA regra -- a assercao que mata a troca
// ---------------------------------------------------------------------------

const primeiraFrase = (texto) => texto.split(".")[0];

test("a primeira frase do pessoal e a regra da fatura", () => {
  const frase = primeiraFrase(FATURA);
  assert.ok(
    frase.includes("vence"),
    "a primeira frase da legenda do pessoal tem de dizer que o cartão conta no mês em que a fatura VENCE"
  );
  assert.ok(
    !frase.includes("foi feita"),
    "a primeira frase da legenda do pessoal diz 'foi feita': ou as duas legendas foram " +
      "trocadas de lugar, ou ela voltou à regra da compra"
  );
});

test("a primeira frase do grupo e a regra da compra", () => {
  const frase = primeiraFrase(COMPRA);
  assert.ok(
    frase.includes("foi feita"),
    "a primeira frase da legenda do grupo tem de dizer que a compra conta no mês em que FOI FEITA"
  );
  assert.ok(
    !frase.includes("vence"),
    "a primeira frase da legenda do grupo diz 'vence': ou as duas legendas foram trocadas de lugar"
  );
});

// ---------------------------------------------------------------------------
// 3. Cada legenda cita os DOIS eixos
// ---------------------------------------------------------------------------

test("as duas legendas citam a compra E a fatura", () => {
  for (const [criterio, texto] of [
    ["compra", COMPRA],
    ["fatura", FATURA],
  ]) {
    assert.ok(
      texto.includes("compra"),
      `a legenda de \`${criterio}\` não cita a compra — sem os dois eixos a frase não diz em que as regras diferem`
    );
    assert.ok(
      texto.includes("fatura"),
      `a legenda de \`${criterio}\` não cita a fatura — sem os dois eixos a frase não diz em que as regras diferem`
    );
  }
});

test("a legenda do pessoal diz as tres partes da RN017.4", () => {
  // O mes do vencimento esta na assercao da primeira frase. Aqui ficam as
  // outras duas: o valor (o TOTAL das compras, e nao o que foi pago) e o
  // momento (a fatura em aberto ainda nao e realizado). Sem a ultima, a compra
  // de ontem que nao aparece no Realizado se le como dinheiro perdido.
  assert.ok(
    FATURA.includes("total das compras"),
    "a legenda do pessoal não diz que a fatura conta pelo TOTAL das compras"
  );
  assert.ok(
    FATURA.includes("em aberto"),
    "a legenda do pessoal não diz que a fatura EM ABERTO ainda não conta — " +
      "quem lançou a compra de ontem e não a vê no Realizado lê 'sumiu'"
  );
});

// ---------------------------------------------------------------------------
// 4. `legendaDoCartao` escolhe pelo campo, e nao chuta
// ---------------------------------------------------------------------------

test("legendaDoCartao devolve a legenda do criterio que recebeu", () => {
  assert.equal(legendaDoCartao("compra"), LEGENDA_DO_CARTAO.compra);
  assert.equal(legendaDoCartao("fatura"), LEGENDA_DO_CARTAO.fatura);
});

test("as duas legendas sao textos DIFERENTES", () => {
  // A assercao acima passa verde com `LEGENDA_DO_CARTAO.compra ===
  // LEGENDA_DO_CARTAO.fatura`, porque ela compara cada lado com ele mesmo.
  assert.notEqual(
    LEGENDA_DO_CARTAO.compra,
    LEGENDA_DO_CARTAO.fatura,
    "as duas entradas do mapa têm o mesmo texto: uma das telas está exibindo a legenda da outra"
  );
});

test("criterio desconhecido nao recebe legenda nenhuma", () => {
  // O caso real: resposta antiga servida do cache do navegador, de antes de o
  // ramo mensal da rota passar a emitir `cartao` (era so o ramo de intervalo
  // ate esta issue). Afirmar "conta na compra" ali seria afirmar um critério
  // que ninguem leu.
  for (const entrada of [undefined, null, "", "mes", "intervalo", "COMPRA"]) {
    assert.equal(
      legendaDoCartao(entrada),
      null,
      `\`${String(entrada)}\` não é um critério conhecido e não pode render legenda`
    );
  }
});

// ---------------------------------------------------------------------------
// 5. OS VALORES QUE A ROTA EMITE SAO CRITERIOS QUE A LEGENDA CONHECE
// ---------------------------------------------------------------------------
// A unica ligacao entre /api/reports/cash-flow e este modulo e um STRING que
// atravessa `await res.json()` -- `any` na fronteira, invisivel no `tsc`. Se a
// rota passar a emitir `cartao: "consumo"` (que e como a HMO-266 chama este
// criterio em prosa, e por isso o renomeio e plausivel), `legendaDoCartao`
// devolve `null`, as duas telas voltam a mostrar numeros divergentes sem
// explicacao, e NADA fica vermelho: nem o tsc, nem a suite acima, nem o
// check-cartao-pela-fatura -- que exige o campo, nao o valor dele.
//
// Entao esta assercao vai buscar os literais no FONTE da rota e passa cada um
// pela funcao de verdade. Nao e assercao sobre texto: e a prova de que os dois
// lados do contrato usam o mesmo vocabulario.
//
// O fonte e lido sem comentario pelo mesmo helper do guard de fiacao, pela mesma
// razao: o cabecalho daquela rota EXPLICA os dois criterios em prosa, e varrer o
// fonte cru colheria os literais dos comentarios junto dos de verdade.
const { semComentarios } = await import("./varredura-de-fonte.mjs");

const ROTA = "app/api/reports/cash-flow/route.ts";

test("todo criterio que a rota emite tem legenda", () => {
  const fonte = semComentarios(readFileSync(ROTA, "utf8"));

  // Os dois ramos da rota escrevem o campo pela mesma condicional,
  // `cartao: groupId ? "compra" : "fatura"`. Esta regex colhe o campo e os
  // literais que vierem na expressao dele, ate a virgula do fim -- e aceita
  // tambem um literal cravado, que era como o ramo mensal o escrevia ate a
  // fase 6.
  const atribuicoes = [...fonte.matchAll(/[^\w.]cartao:([^,\n]*(?:\n[^,]*)?),/g)];

  assert.ok(
    atribuicoes.length >= 2,
    `achei ${atribuicoes.length} atribuição(ões) de \`cartao\` em ${ROTA}, esperava ao menos 2 ` +
      "(o ramo mensal e o de intervalo). Menos que isso e um dos ramos parou de dizer qual " +
      "critério usou, e a legenda da tela correspondente não tem de onde sair"
  );

  const emitidos = new Set();
  for (const [, expressao] of atribuicoes) {
    for (const [, literal] of expressao.matchAll(/"([^"]*)"/g)) {
      emitidos.add(literal);
    }
  }

  assert.ok(
    emitidos.size > 0,
    "nenhum literal de critério nas atribuições de `cartao`: a regex desta asserção " +
      "deixou de casar o que a rota escreve, e ela passaria verde sem medir nada"
  );

  for (const valor of emitidos) {
    assert.notEqual(
      legendaDoCartao(valor),
      null,
      `a rota emite \`cartao: "${valor}"\` e este módulo não tem legenda para esse valor. ` +
        "A tela recebe o campo, não reconhece, e não renderiza legenda nenhuma — " +
        "a divergência entre o painel pessoal e o do grupo volta a ser muda"
    );
  }

  // E o caminho inverso: os dois criterios do modulo tem de ser EMITIDOS por
  // alguem. Legenda que a rota nunca pede e legenda que ninguem nunca ve.
  for (const criterio of Object.keys(LEGENDA_DO_CARTAO)) {
    assert.ok(
      emitidos.has(criterio),
      `o módulo tem legenda para \`${criterio}\` e ${ROTA} nunca emite esse valor: ` +
        "ou a rota deixou de oferecer esse critério, ou a legenda é letra morta"
    );
  }
});
