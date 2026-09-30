#!/usr/bin/env node
// =====================================================
// PULODOGATO - os TILES de Realizado, Previsao e Total esperado (HMO-174)
// =====================================================
//   npm run test:tres-numeros
//
// POR QUE ESTE TESTE RENDERIZA O COMPONENTE
// -----------------------------------------
// `montarPainel` ja tem suite propria (test-realizado-e-previsao), e ela
// passaria verde com o JSX imprimindo a Previsao debaixo do rotulo "Realizado".
// Os dois numeros estariam certos, nas posicoes trocadas: nao quebra build, nao
// quebra teste puro, nao deixa a tela vazia. O usuario le "ja gastei R$ 855" no
// dia 15 e conclui que sobrou muito mais mes do que sobrou.
//
// Aqui o `react-dom/server` renderiza o mesmo arquivo que o painel importa, e o
// teste afirma sobre o HTML que sai.
//
// O QUE ELE GUARDA, ALEM DA ORDEM DOS ROTULOS
// --------------------------------------------
//   * a linha de gasto variavel diz, na propria tela, que NAO esta somada. A
//     decisao de produto (HMO-145, opcao "separado") so funciona se a tela
//     disser isso: sem a frase, alguem soma os dois numeros e conclui que o app
//     se contradiz;
//   * periodo encerrado e periodo futuro NAO escondem a linha que vale zero. Um
//     tile com um numero so, sem eixo de tempo, e exatamente o defeito que esta
//     issue veio consertar -- zero explicado e informacao, linha ausente e
//     ambiguidade;
//   * a falha de leitura das assinaturas vira aviso. Sem ele a Previsao aparece
//     menor que a verdade sem nada na tela indicando isso, que e o pior lado do
//     erro aqui.
//
// O QUE ELE NAO COBRE
// -------------------
// Cor e icone: saem de classe de token, que tem guarda propria
// (check-color-tokens). O que este teste cobre e QUAL numero aparece debaixo de
// QUAL rotulo, e o que a tela afirma em palavras.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  LinhaDeGastoVariavel,
  TileRealizadoEPrevisao,
} from "../.tmp-tres-numeros/components/dashboard/RealizadoEPrevisao.js";

/** Os tres numeros da despesa no exemplo do mes corrente. */
const DESPESA = { realizado: 1920, previsao: 855, total: 2775 };
const RECEITA = { realizado: 7000, previsao: 1200, total: 8200 };

const renderTile = (props) =>
  renderToStaticMarkup(
    h(TileRealizadoEPrevisao, {
      lado: "despesa",
      numeros: DESPESA,
      rotulo: "setembro de 2026",
      periodoEncerrado: false,
      periodoFuturo: false,
      ...props,
    })
  );

/** O HTML sem tag nenhuma, com os espacos normalizados. */
const texto = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;| /g, " ")
    .replace(/&#x27;|&quot;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// ---------------------------------------------------------------------------
// 1. Os tres numeros, cada um debaixo do rotulo dele
// ---------------------------------------------------------------------------

test("o tile imprime os tres numeros, e o grande e o total esperado", () => {
  const t = texto(renderTile());

  assert.ok(t.includes("Total esperado"), "falta o rotulo do total");
  assert.ok(t.includes("Realizado"), "falta o rotulo do realizado");
  assert.ok(t.includes("Previsão"), "falta o rotulo da previsao");

  for (const valor of ["2.775,00", "1.920,00", "855,00"]) {
    assert.ok(t.includes(valor), `falta o valor ${valor}`);
  }
});

test("Realizado e Previsao nao trocam de lugar", () => {
  // A assercao e sobre a ORDEM no HTML, e nao sobre a presenca: os dois numeros
  // certos debaixo do rotulo um do outro nao faltam na tela, e nenhuma
  // assercao de `includes` os separa.
  //
  // A fatia comeca DEPOIS do total: o numero grande aparece antes dos dois
  // rotulos, e uma fatia que o inclua acharia "2.775,00" em qualquer ordem.
  const html = renderTile();
  const depoisDoTotal = html.slice(html.indexOf("Total esperado"));

  const posRealizado = depoisDoTotal.indexOf("Realizado");
  const pos1920 = depoisDoTotal.indexOf("1.920,00");
  const posPrevisao = depoisDoTotal.indexOf("Previsão");
  const pos855 = depoisDoTotal.indexOf("855,00");

  assert.ok(posRealizado >= 0 && pos1920 > posRealizado, "1.920 nao segue 'Realizado'");
  assert.ok(posPrevisao > pos1920, "'Previsão' nao vem depois do realizado");
  assert.ok(pos855 > posPrevisao, "855 nao segue 'Previsão'");
});

test("o lado de receita nomeia receita, e nao despesa", () => {
  const t = texto(renderTile({ lado: "receita", numeros: RECEITA }));

  assert.ok(t.includes("Receitas"), "o tile de receita nao se nomeia");
  assert.ok(!t.includes("Despesas"), "o tile de receita se diz despesa");
  assert.ok(t.includes("8.200,00"));
});

// ---------------------------------------------------------------------------
// 2. Os dois extremos do periodo: a linha que vale zero continua na tela
// ---------------------------------------------------------------------------

test("periodo encerrado: a Previsao aparece zerada, com o motivo escrito", () => {
  const html = renderTile({
    numeros: { realizado: 4100, previsao: 0, total: 4100 },
    periodoEncerrado: true,
  });
  const t = texto(html);

  assert.ok(t.includes("Previsão"), "a linha de previsao sumiu");
  assert.ok(t.includes("O período já terminou"), "falta o motivo do zero");
  assert.ok(t.includes("4.100,00"));

  // "Presente no HTML" nao e "visivel na tela", e a diferenca aqui e um
  // atributo. Um `hidden` no bloco da Previsao some com a linha no navegador e
  // NAO some com o texto -- `texto()` tira as tags e continua achando tudo, e
  // as tres assercoes acima passam verdes sobre um tile que mostra um numero
  // so. Foi o unico mutante que sobreviveu a primeira versao desta suite.
  //
  // O padrao exige espaco antes de `hidden`: os icones do lucide saem com
  // `aria-hidden="true"`, e um `includes("hidden")` cru reprova o tile por
  // causa do icone -- um teste que falha pela razao errada some na primeira vez
  // que alguem o marca como instavel.
  assert.ok(
    !/\shidden[=>\s]/.test(html),
    "alguma linha do tile esta escondida por atributo"
  );
});

test("periodo futuro: o Realizado aparece zerado, com o motivo escrito", () => {
  const t = texto(
    renderTile({
      numeros: { realizado: 0, previsao: 800, total: 800 },
      periodoFuturo: true,
    })
  );

  assert.ok(t.includes("Realizado"), "a linha de realizado sumiu");
  assert.ok(
    t.includes("O período ainda não começou"),
    "falta o motivo do zero"
  );
});

test("no periodo corrente nenhum dos dois motivos aparece", () => {
  // Controle negativo dos dois testes acima: sem ele eles passariam verde com
  // as frases impressas SEMPRE, e a tela diria "o período já terminou" em
  // setembro.
  const t = texto(renderTile());

  assert.ok(!t.includes("O período já terminou"));
  assert.ok(!t.includes("O período ainda não começou"));
});

test("a falha de leitura das assinaturas vira aviso na tela", () => {
  const semAviso = texto(renderTile());
  assert.ok(!semAviso.includes("previsão pode estar baixa"));

  const comAviso = texto(renderTile({ previsaoIncompleta: true }));
  assert.ok(
    comAviso.includes("previsão pode estar baixa"),
    "a previsao otimista passa sem aviso"
  );
});

// ---------------------------------------------------------------------------
// 3. A linha do gasto variavel: ela tem que DIZER que esta de fora
// ---------------------------------------------------------------------------

const renderVariavel = (props) =>
  renderToStaticMarkup(
    h(LinhaDeGastoVariavel, {
      total: 900,
      porDia: 60,
      dias: 15,
      temBase: true,
      mesesBase: 4,
      ajustado: false,
      onMudar: () => {},
      onRestaurar: () => {},
      ...props,
    })
  );

test("a linha de gasto variavel afirma que NAO esta somada", () => {
  // Sem esta frase a decisao de produto nao chega ao usuario: ele ve dois
  // numeros de despesa na mesma tela, soma os dois de cabeca e conclui que o
  // app se contradiz.
  const t = texto(renderVariavel());

  assert.ok(t.includes("Não está somado"), "a tela nao diz que fica de fora");
  assert.ok(t.includes("previsão"), "a frase nao nomeia o que ela nao integra");
  assert.ok(t.includes("total esperado"));
});

test("a linha mostra o valor por dia num campo editavel", () => {
  const html = renderVariavel();

  assert.ok(html.includes('type="number"'), "nao ha campo de numero");
  assert.ok(html.includes('value="60"'), "o campo nao traz o valor atual");
  assert.ok(html.includes("900,00"), "falta o total da estimativa");
  assert.ok(texto(html).includes("15 dias que faltam"));
});

test("sem base historica a linha diz isso, em vez de justificar um zero", () => {
  const t = texto(renderVariavel({ temBase: false, mesesBase: 0, total: 0, porDia: 0 }));

  assert.ok(
    t.includes("Ainda não há meses fechados suficientes"),
    "o zero aparece sem explicacao"
  );
  assert.ok(!t.includes("A média sai de"));
});

test("o botao de voltar a media so aparece depois de o usuario mexer", () => {
  assert.ok(!texto(renderVariavel()).includes("Voltar à média"));
  assert.ok(texto(renderVariavel({ ajustado: true })).includes("Voltar à média"));
});
