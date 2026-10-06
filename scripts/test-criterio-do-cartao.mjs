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
// delas descrevendo apenas a propria tela. E esses tres sao exatamente os
// defeitos que importam, porque a legenda e a UNICA coisa que separa "duas
// telas com criterios diferentes" de "uma das duas telas esta com bug".
//
// Entao as assercoes sao sobre as PROPRIEDADES que fazem o par funcionar:
//
//   1. cada legenda NOMEIA A OUTRA TELA. Legenda que descreve so a propria tela
//      nao resolve o problema: quem comparou os dois numeros e chegou nela ja
//      sabe o que aquela tela mostra -- o que ele nao sabe e qual das duas esta
//      errada;
//   2. a DIRECAO da diferenca e oposta nas duas. Esta e a assercao que mata a
//      troca: o consumo e sempre >= o caixa, entao visto dos Relatorios o total
//      do painel e MENOR, e visto do painel o dos Relatorios e MAIOR. Copiar uma
//      legenda para o lugar da outra inverte as duas frases, e uma tela passaria
//      a prometer uma diferenca com o sinal trocado;
//   3. cada legenda cita os DOIS eixos de data (compra e fatura). Uma frase que
//      diz so "conta na compra" e verdadeira e inutil aqui;
//   4. valor desconhecido NAO recebe legenda. Sem isto, uma funcao que devolve
//      LEGENDA_DO_CARTAO.compra para qualquer entrada passa na assercao (1) do
//      criterio `compra` e afirma "conta na compra" debaixo de um total que
//      pode ter sido calculado pela fatura;
//   5. e a ultima, que e a unica que nao e sobre texto: os valores que a ROTA
//      emite sao criterios que este modulo conhece, nos dois sentidos. Ela sai
//      do fonte de /api/reports/cash-flow, porque o contrato entre os dois e um
//      string que atravessa `await res.json()` -- `any` na fronteira, invisivel
//      no tsc. A rota emitir `cartao: "consumo"` (que e como a HMO-266 chama
//      este criterio em PROSA) deixa a tela sem legenda sem nada ficar vermelho.
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

test("a legenda do consumo nomeia o painel, que e a outra tela", () => {
  assert.ok(
    COMPRA.includes("painel"),
    "a legenda da tela de relatorios tem de dizer que o PAINEL usa outro critério — " +
      "sem nomear a outra tela, ela não explica a divergência que a pessoa está vendo"
  );
});

test("a legenda do caixa nomeia a tela de relatorios, que e a outra tela", () => {
  assert.ok(
    FATURA.includes("relatorios"),
    "a legenda do painel tem de dizer que a tela de RELATÓRIOS usa outro critério"
  );
});

test("nenhuma das duas nomeia so a si mesma", () => {
  // O par e cruzado: a do painel fala de Relatorios e a de Relatorios fala do
  // painel. Se uma delas citasse a PROPRIA tela no lugar da outra, a assercao
  // acima continuaria verde para a sua gemea e esta pega a metade que sobra.
  assert.ok(
    !COMPRA.includes("relatorios"),
    "a legenda da tela de relatórios está se nomeando a si mesma em vez de nomear o painel"
  );
  assert.ok(
    !FATURA.includes("painel"),
    "a legenda do painel está se nomeando a si mesma em vez de nomear a tela de relatórios"
  );
});

// ---------------------------------------------------------------------------
// 2. A direcao da diferenca e OPOSTA nas duas -- a assercao que mata a troca
// ---------------------------------------------------------------------------

test("vista dos relatorios, a outra tela mostra um total MENOR", () => {
  // O consumo soma a compra no dia em que ela aconteceu; o caixa espera a
  // fatura ser paga. Toda compra ainda nao faturada esta no primeiro e nao no
  // segundo, entao consumo >= caixa SEMPRE -- a diferenca e zero apenas para
  // quem nao tem cartao, e nunca negativa.
  assert.ok(
    COMPRA.includes("menor"),
    "a legenda dos relatórios tem de dizer que o total do painel é MENOR"
  );
  assert.ok(
    !COMPRA.includes("maior"),
    "a legenda dos relatórios diz 'maior': ou as duas legendas foram trocadas de lugar, " +
      "ou ela está prometendo uma diferença com o sinal invertido"
  );
});

test("visto do painel, a outra tela mostra um total MAIOR", () => {
  assert.ok(
    FATURA.includes("maior"),
    "a legenda do painel tem de dizer que o total dos relatórios é MAIOR"
  );
  assert.ok(
    !FATURA.includes("menor"),
    "a legenda do painel diz 'menor': ou as duas legendas foram trocadas de lugar, " +
      "ou ela está prometendo uma diferença com o sinal invertido"
  );
});

// ---------------------------------------------------------------------------
// 3. Cada legenda cita os DOIS eixos de data
// ---------------------------------------------------------------------------

test("as duas legendas citam a compra E a fatura", () => {
  for (const [criterio, texto] of [
    ["compra", COMPRA],
    ["fatura", FATURA],
  ]) {
    assert.ok(
      texto.includes("compra"),
      `a legenda de \`${criterio}\` não cita a compra — sem os dois eixos de data a frase não diz em que elas diferem`
    );
    assert.ok(
      texto.includes("fatura"),
      `a legenda de \`${criterio}\` não cita a fatura — sem os dois eixos de data a frase não diz em que elas diferem`
    );
  }
});

test("as duas legendas dizem que os DOIS numeros estao certos", () => {
  // Sem esta parte a legenda explica a diferenca e deixa a pergunta de pe. O
  // que a pessoa foi buscar ao comparar as telas e se precisa consertar algo.
  for (const [criterio, texto] of [
    ["compra", COMPRA],
    ["fatura", FATURA],
  ]) {
    assert.ok(
      texto.includes("os dois estao certos"),
      `a legenda de \`${criterio}\` não afirma que os dois totais estão certos — ` +
        "explicar a divergência sem dizer isso deixa a pessoa procurando o bug que não existe"
    );
  }
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

  // Os dois ramos da rota escrevem o campo de formas diferentes: o mensal
  // crava `cartao: "compra"` e o de intervalo usa a condicional
  // `cartao: cartaoPelaFatura ? "fatura" : "compra"`. Esta regex colhe o campo
  // e os literais que vierem na expressao dele, ate a virgula do fim.
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
        "a divergência entre o painel e os relatórios volta a ser muda"
    );
  }

  // E o caminho inverso: os dois criterios do modulo tem de ser EMITIDOS por
  // alguem. Legenda que a rota nunca pede e legenda que ninguem nunca ve, e o
  // par da HMO-266 so funciona com os dois lados vivos.
  for (const criterio of Object.keys(LEGENDA_DO_CARTAO)) {
    assert.ok(
      emitidos.has(criterio),
      `o módulo tem legenda para \`${criterio}\` e ${ROTA} nunca emite esse valor: ` +
        "ou a rota deixou de oferecer esse critério, ou a legenda é letra morta"
    );
  }
});
