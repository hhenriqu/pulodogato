// Testes de lib/puxar-para-atualizar.ts -- HMO-201, parte 4.
//
// O gesto tem dois jeitos de estar errado, e eles puxam para lados opostos:
// recarregar quando a pessoa so queria rolar (perde o que ela estava vendo,
// e acontece o tempo todo), e nao recarregar quando ela puxou de verdade (a
// feature simplesmente nao existe). As assercoes abaixo fixam os dois.

import test from "node:test";
import assert from "node:assert/strict";

const {
  lerGesto,
  deveAtualizar,
  LIMIAR_EM_PIXELS,
  DESLOCAMENTO_MAXIMO,
  RESISTENCIA,
} = await import("../.tmp-puxar-para-atualizar/puxar-para-atualizar.js");

/** O deltaY necessario para chegar a um deslocamento dado. */
const deltaPara = (deslocamento) => deslocamento / RESISTENCIA;

test("parado no topo, sem arrastar, nao acontece nada", () => {
  const r = lerGesto({ scrollTopNoInicio: 0, deltaY: 0 });
  assert.equal(r.estado, "inerte");
  assert.equal(r.deslocamento, 0);
  assert.equal(deveAtualizar(r), false);
});

test("puxao curto mostra o indicador mas nao atualiza", () => {
  const r = lerGesto({ scrollTopNoInicio: 0, deltaY: deltaPara(20) });
  assert.equal(r.estado, "puxando");
  assert.equal(r.deslocamento, 20);
  assert.equal(deveAtualizar(r), false);
});

test("passando do limiar, soltar atualiza", () => {
  const r = lerGesto({
    scrollTopNoInicio: 0,
    deltaY: deltaPara(LIMIAR_EM_PIXELS + 1),
  });
  assert.equal(r.estado, "solte");
  assert.equal(deveAtualizar(r), true);
});

test("exatamente no limiar ja conta", () => {
  // A borda esta escrita `>=`. Se alguem trocar por `>`, o indicador chega a
  // dizer "solte para atualizar" num pixel em que soltar nao faz nada.
  const r = lerGesto({
    scrollTopNoInicio: 0,
    deltaY: deltaPara(LIMIAR_EM_PIXELS),
  });
  assert.equal(r.estado, "solte");
  assert.equal(deveAtualizar(r), true);
});

// ---------------------------------------------------------------------------
// O QUE NAO PODE VIRAR REFRESH
// ---------------------------------------------------------------------------

test("gesto que comecou com a pagina rolada NUNCA atualiza", () => {
  // O caso que estraga tudo: a pessoa esta no meio de uma lista longa, rola
  // para cima com um movimento amplo, a pagina chega ao topo no meio do
  // caminho e o dedo continua subindo. Se o gesto fosse avaliado pelo
  // scrollTop de AGORA, isso recarregaria a pagina e ela perderia o lugar.
  for (const scrollTopNoInicio of [0.5, 1, 40, 2000]) {
    const r = lerGesto({ scrollTopNoInicio, deltaY: deltaPara(300) });
    assert.equal(r.estado, "inerte", `scrollTop ${scrollTopNoInicio}`);
    assert.equal(deveAtualizar(r), false);
  }
});

test("dedo subindo e rolagem normal, nao puxao", () => {
  const r = lerGesto({ scrollTopNoInicio: 0, deltaY: -300 });
  assert.equal(r.estado, "inerte");
  assert.equal(r.deslocamento, 0);
});

test("com atualizacao em curso, um segundo puxao nao faz nada", () => {
  // Sem isto, tres puxadas seguidas viram tres recargas.
  const r = lerGesto({
    scrollTopNoInicio: 0,
    deltaY: deltaPara(300),
    atualizando: true,
  });
  assert.equal(r.estado, "inerte");
  assert.equal(deveAtualizar(r), false);
});

// ---------------------------------------------------------------------------
// A ARITMETICA DO INDICADOR
// ---------------------------------------------------------------------------

test("o indicador anda menos que o dedo", () => {
  // A resistencia e o que faz o gesto precisar de intencao. Sem ela, uma
  // deslizada curta de 70px ja cruzaria o limiar.
  const r = lerGesto({ scrollTopNoInicio: 0, deltaY: 100 });
  assert.ok(
    r.deslocamento < 100,
    `o indicador (${r.deslocamento}) nao pode acompanhar o dedo 1:1`
  );
});

test("o indicador para no teto por mais que o dedo desca", () => {
  const r = lerGesto({ scrollTopNoInicio: 0, deltaY: 100000 });
  assert.equal(r.deslocamento, DESLOCAMENTO_MAXIMO);
  assert.equal(r.estado, "solte");
});

test("o deslocamento nunca e negativo", () => {
  for (const deltaY of [-1, -0.5, 0]) {
    assert.equal(lerGesto({ scrollTopNoInicio: 0, deltaY }).deslocamento, 0);
  }
});

test("o limiar e medido no deslocamento desenhado, nao no dedo", () => {
  // Um deltaY igual ao limiar ainda NAO basta: depois da resistencia ele vira
  // metade disso. Se alguem comparar o limiar com o deltaY cru, o gesto passa
  // a disparar na metade do caminho que o indicador mostra.
  const r = lerGesto({ scrollTopNoInicio: 0, deltaY: LIMIAR_EM_PIXELS });
  assert.equal(r.estado, "puxando");
  assert.ok(r.deslocamento < LIMIAR_EM_PIXELS);
});
