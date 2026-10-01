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
  toqueEhNaPagina,
  propsSemPuxao,
  ATRIBUTO_SEM_PUXAO,
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
// DE QUEM E O PUXAO -- HMO-206
// ---------------------------------------------------------------------------
// A queixa: rolar a lista do menu mobile recarregava a pagina. A pagina atras
// da gaveta esta sempre em scroll 0, entao o dedo descendo dentro da lista era
// indistinguivel de um puxao no topo do app.

/** Um ancestral comum, que nao interfere em nada. */
const ANCESTRAL_NEUTRO = {
  rolaOProprioConteudo: false,
  dispensaOPuxao: false,
};
const CAIXA_QUE_ROLA = { rolaOProprioConteudo: true, dispensaOPuxao: false };
const AREA_SEM_PUXAO = { rolaOProprioConteudo: false, dispensaOPuxao: true };

/** O puxao perfeito: no topo da pagina, bem passado do limiar. */
const puxaoCompleto = (extra) =>
  lerGesto({
    scrollTopNoInicio: 0,
    deltaY: deltaPara(DESLOCAMENTO_MAXIMO),
    ...extra,
  });

test("toque so na pagina: o caminho vazio e o caminho neutro puxam", () => {
  // CONTROLE POSITIVO. Sem ele, uma trava larga demais -- `toqueEhNaPagina`
  // devolvendo sempre `false`, ou `lerGesto` sempre inerte -- passaria em
  // todas as assercoes de bloqueio abaixo e desligaria a feature inteira.
  assert.equal(toqueEhNaPagina([]), true);
  assert.equal(toqueEhNaPagina([ANCESTRAL_NEUTRO, ANCESTRAL_NEUTRO]), true);

  const r = puxaoCompleto({ toqueNaPagina: true });
  assert.equal(r.estado, "solte");
  assert.equal(deveAtualizar(r), true);
});

test("rolar a lista do menu NAO recarrega a pagina", () => {
  // O caminho real do toque: um item dentro da lista que rola, dentro do
  // painel, dentro da raiz marcada do menu.
  const caminho = [ANCESTRAL_NEUTRO, CAIXA_QUE_ROLA, AREA_SEM_PUXAO];
  assert.equal(toqueEhNaPagina(caminho), false);

  const r = puxaoCompleto({ toqueNaPagina: toqueEhNaPagina(caminho) });
  assert.equal(r.estado, "inerte");
  assert.equal(r.deslocamento, 0, "o indicador nao pode nem aparecer");
  assert.equal(deveAtualizar(r), false);
});

test("caixa que rola sozinha segura o puxao, mesmo fora do menu", () => {
  // Vale para modal e tabela alta tambem, nao so para o menu.
  assert.equal(toqueEhNaPagina([CAIXA_QUE_ROLA]), false);
  assert.equal(puxaoCompleto({ toqueNaPagina: false }).estado, "inerte");
});

test("area marcada segura o puxao mesmo sem nada rolando", () => {
  // O X, o veu e o rodape "Sair" da gaveta ficam FORA da lista que rola, e
  // numa tela alta a lista pode nem transbordar. Se a unica trava fosse
  // "rola o proprio conteudo", o menu aberto continuaria recarregando.
  assert.equal(toqueEhNaPagina([AREA_SEM_PUXAO]), false);
});

test("a trava vale em QUALQUER altura do caminho, nao so no alvo", () => {
  // O dedo encosta num <span> de rotulo, nao na caixa que rola: se a leitura
  // olhasse so o elemento tocado, a trava nunca pegaria o caso real.
  for (const bloqueio of [CAIXA_QUE_ROLA, AREA_SEM_PUXAO]) {
    assert.equal(
      toqueEhNaPagina([ANCESTRAL_NEUTRO, ANCESTRAL_NEUTRO, bloqueio]),
      false
    );
  }
});

test("caixa que declara overflow mas nao transborda deixa puxar", () => {
  // Varias telas envolvem tabela num `overflow-y-auto` que raramente
  // transborda. Se a trava ignorasse o "tem conteudo sobrando", o puxao
  // morreria em metade do app -- e a HMO-206 teria trocado um bug por outro.
  const caixaFolgada = {
    rolaOProprioConteudo: false,
    dispensaOPuxao: false,
  };
  assert.equal(toqueEhNaPagina([caixaFolgada]), true);
  assert.equal(deveAtualizar(puxaoCompleto({ toqueNaPagina: true })), true);
});

test("sem a pergunta respondida, o puxao continua valendo", () => {
  // O default de `toqueNaPagina` e `true`. Um default `false` desligaria o
  // gesto em toda chamada que ainda nao passa o campo.
  const r = puxaoCompleto({});
  assert.equal(r.estado, "solte");
  assert.equal(deveAtualizar(r), true);
});

test("o marcador do menu e o atributo que a leitura procura", () => {
  // A ponte entre o Sidebar (que marca) e o componente (que le). Escritos a
  // mao nos dois lados, um erro de digitacao nao reprovaria nada.
  assert.equal(ATRIBUTO_SEM_PUXAO, "data-sem-puxar-para-atualizar");
  assert.deepEqual(propsSemPuxao(), { [ATRIBUTO_SEM_PUXAO]: "" });
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
