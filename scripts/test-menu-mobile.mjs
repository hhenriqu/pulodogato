#!/usr/bin/env node
// =====================================================
// PULODOGATO - o cromo do menu mobile (HMO-161)
// =====================================================
// A queixa: no celular, o hamburguer e o X apareciam ao mesmo tempo, um em
// cima do outro. A regra que o usuario pediu e uma linha: "o X deve aparecer
// apenas com menu aberto".
//
// POR QUE ESTE TESTE RENDERIZA O COMPONENTE, E NAO UMA FUNCAO PURA
// ---------------------------------------------------------------
// O defeito era JSX: um botao renderizado sempre, posicionado fora dos limites
// do painel. Uma funcao pura `deveMostrarX(aberto)` passaria verde com o bug
// intacto, porque o bug nunca esteve na decisao -- esteve na arvore. Entao aqui
// o `react-dom/server` renderiza os DOIS botoes de verdade, do mesmo arquivo
// que o app importa, e o teste conta icones no HTML que sai.
//
// O QUE ELE NAO COBRE
// -------------------
// Geometria. Nenhum teste deste repositorio aplica CSS, entao "o X esta dentro
// do painel" nao e verificavel aqui de forma direta -- o que da para exigir, e
// o que o caso 4 exige, e que o botao nao volte a usar deslocamento NEGATIVO,
// que era o mecanismo exato pelo qual ele saia do painel e caia em cima do
// hamburguer. E um piso, nao uma prova.
//
// A trava de verdade contra a volta do bug e o botao morar dentro do painel
// (components/MobileMenuChrome.tsx explica por que). Este arquivo existe para
// que a regressao apareca em CI, e nao no celular de quem usa o app.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ID_MENU_MOBILE,
  MobileMenuToggle,
  MobileMenuClose,
} from "../.tmp-menu-mobile/components/MobileMenuChrome.js";

const naoFazNada = () => {};

/** Como o app compoe o cromo: o hamburguer no header, o X dentro da gaveta. */
function cromoRenderizado(aberto) {
  return {
    hamburguer: renderToStaticMarkup(
      h(MobileMenuToggle, { aberto, onToggle: naoFazNada }),
    ),
    fechar: renderToStaticMarkup(
      h(MobileMenuClose, { aberto, onClose: naoFazNada }),
    ),
  };
}

/** Quantas vezes o icone aparece no HTML. O lucide marca cada svg com a classe. */
function quantosIcones(html, nome) {
  return html.split(`lucide-${nome}`).length - 1;
}

function telaInteira(aberto) {
  const { hamburguer, fechar } = cromoRenderizado(aberto);
  return hamburguer + fechar;
}

test("menu fechado: um hamburguer na tela e nenhum X", () => {
  const html = telaInteira(false);

  assert.equal(
    quantosIcones(html, "x"),
    0,
    "com o menu fechado nao pode existir X nenhum na arvore -- era exatamente " +
      "este o bug: o X da gaveta reaparecia sobre o hamburguer do header",
  );
  assert.equal(quantosIcones(html, "menu"), 1);
});

test("menu aberto: exatamente um X, e ele e o da gaveta", () => {
  const { hamburguer, fechar } = cromoRenderizado(true);

  assert.equal(
    quantosIcones(hamburguer + fechar, "x"),
    1,
    "dois lugares capazes de desenhar o X e o que transforma um erro de " +
      "posicionamento em sobreposicao",
  );
  assert.equal(quantosIcones(fechar, "x"), 1, "o X tem que vir da gaveta");
  assert.equal(
    quantosIcones(hamburguer, "x"),
    0,
    "o botao do header nao troca de icone: ele fica coberto pelo painel quando " +
      "o menu abre, entao trocar so criava um segundo X invisivel",
  );
});

test("o X e o unico controle que depende do estado", () => {
  // O hamburguer fica montado nos dois estados de proposito: tirar ele da
  // arvore faria o titulo do header pular para a esquerda durante a animacao.
  const fechado = cromoRenderizado(false);
  const aberto = cromoRenderizado(true);

  assert.equal(
    fechado.hamburguer,
    aberto.hamburguer.replace('aria-expanded="true"', 'aria-expanded="false"'),
    "o hamburguer so muda de `aria-expanded` entre os dois estados",
  );
  assert.equal(fechado.fechar, "", "a gaveta fechada nao renderiza nada");
});

test("o X nao volta a ser posicionado para fora do painel", () => {
  const { fechar } = cromoRenderizado(true);

  // Deslocamento negativo foi o mecanismo do bug: empurrado para depois da
  // borda direita do painel, o botao ficava fora dos limites que a translacao
  // leva embora quando a gaveta fecha.
  const negativos = fechar.match(/(?:^|[\s"])-(?:m[rltbxy]|right|left|inset)-/g);

  assert.equal(
    negativos,
    null,
    `o X voltou a usar deslocamento negativo (${negativos}) -- fora dos ` +
      `limites do painel ele reaparece na tela com o menu fechado`,
  );
});

test("os dois botoes se anunciam para leitor de tela", () => {
  const { hamburguer, fechar } = cromoRenderizado(true);

  // Antes da HMO-161 nenhum dos dois tinha nome acessivel: eram dois botoes
  // com um svg `aria-hidden` dentro, anunciados como "botao" e nada mais.
  assert.match(hamburguer, /aria-label="Abrir menu"/);
  assert.match(fechar, /aria-label="Fechar menu"/);

  assert.match(
    hamburguer,
    new RegExp(`aria-controls="${ID_MENU_MOBILE}"`),
    "sem `aria-controls` o `aria-expanded` anuncia que algo expandiu sem dizer o que",
  );
  assert.match(hamburguer, /aria-expanded="true"/);
});
