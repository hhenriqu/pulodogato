#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DA CONFIGURACAO DO PAINEL
// =====================================================
//   npm run test:dashboard-layout
//
// Exercita lib/dashboard-layout.ts -- o modulo que decide o que a tela inicial
// mostra e em que ordem (HMO-159).
//
// -----------------------------------------------------------------------
// O que estes testes existem para pegar
// -----------------------------------------------------------------------
// Nenhum defeito desta familia levanta excecao. Todos produzem uma tela que
// carrega, responde 200 e mostra MENOS do que devia -- e a pessoa que olha
// para ela nao tem como distinguir "o app escondeu o bloco" de "eu nao tenho
// esse dado". Os quatro que importam:
//
//   - o bloco novo que nasce invisivel. No dia em que o painel ganhar uma
//     secao, todo usuario que ja salvou um layout tem no banco uma lista que
//     nao a menciona. Se a tela renderizasse so o que esta salvo, a feature
//     nova ficaria escondida exatamente de quem mais usa o app, e apareceria
//     normalmente para quem nunca abriu as configuracoes -- o relato seria
//     "funciona no seu, nao funciona no meu";
//
//   - o bloco removido que derruba a tela. O caminho inverso: um id que saiu
//     do catalogo continua no banco de quem ja salvou;
//
//   - o jsonb que nao e o que se espera. `preferences` nao tem schema: o que
//     volta de la e `unknown` de verdade -- null, objeto de outra versao,
//     lixo. Uma unica leitura confiante vira erro de runtime na primeira tela
//     depois do login;
//
//   - o arrastar que erra por um. Mover um item para baixo lendo o indice do
//     alvo ANTES de remover o arrastado deixa tudo uma posicao curta. Nada
//     quebra: a lista fica valida e salva sem reclamar. O usuario so sente que
//     "o arrastar nao pega direito", e isso nao vira chamado.
//
// As listas esperadas abaixo foram escritas a mao a partir da regra, nao
// coladas da saida das funcoes: um teste gravado a partir do proprio codigo
// prova apenas que ele continua fazendo o que ja faz.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  SECOES_DO_PAINEL,
  SECOES_DE_MEIA_LARGURA,
  agruparEmLinhas,
  alternarVisibilidade,
  layoutPadrao,
  moverSecao,
  normalizarLayout,
  reordenarPorArrasto,
  secoesVisiveis,
  tituloDaSecao,
} = await import("../.tmp-dashboard-layout/dashboard-layout.js");

const IDS = SECOES_DO_PAINEL.map((s) => s.id);

/** Atalho: so os ids, na ordem, para comparar listas sem ruido. */
const ids = (layout) => layout.map((i) => i.id);

// ---------------------------------------------------------------------------
// O catalogo
// ---------------------------------------------------------------------------

test("o catalogo nao tem id repetido", () => {
  // Um id duplicado aqui faria `normalizarLayout` devolver duas entradas para
  // a mesma secao, e a tela renderizaria o bloco duas vezes -- com a mesma
  // chave de React, que avisa no console e em mais lugar nenhum.
  assert.equal(new Set(IDS).size, IDS.length);
});

test("toda secao tem titulo e descricao", () => {
  for (const secao of SECOES_DO_PAINEL) {
    assert.ok(secao.titulo.length > 0, `${secao.id} sem titulo`);
    assert.ok(secao.descricao.length > 0, `${secao.id} sem descricao`);
  }
});

test("o padrao mostra tudo, na ordem do catalogo", () => {
  assert.deepEqual(ids(layoutPadrao()), IDS);
  assert.ok(layoutPadrao().every((i) => i.visivel));
});

// ---------------------------------------------------------------------------
// normalizarLayout: a porta de entrada do que veio do banco
// ---------------------------------------------------------------------------

test("o que nao e lista vira o padrao", () => {
  // Os quatro jeitos de o jsonb nao ser uma lista. `undefined` e o caso do
  // usuario que nunca salvou nada -- de longe o mais comum.
  for (const entrada of [undefined, null, {}, "layout", 42]) {
    assert.deepEqual(
      ids(normalizarLayout(entrada)),
      IDS,
      `entrada ${JSON.stringify(entrada) ?? "undefined"}`
    );
  }
});

test("secao que o catalogo ganhou depois entra no fim, VISIVEL", () => {
  // O layout salvo por quem configurou o painel antes de a secao existir.
  const salvoAntigo = [
    { id: IDS[2], visivel: true },
    { id: IDS[0], visivel: false },
  ];

  const normalizado = normalizarLayout(salvoAntigo);

  // A ordem que ele escolheu e preservada na frente...
  assert.deepEqual(ids(normalizado).slice(0, 2), [IDS[2], IDS[0]]);
  // ...e a escolha de esconder tambem.
  assert.equal(normalizado[1].visivel, false);

  // O que ele nunca viu aparece no fim, e aparece LIGADO. Este e o teste que
  // impede a feature nova de nascer invisivel.
  const resto = ids(normalizado).slice(2);
  assert.deepEqual(
    resto,
    IDS.filter((id) => id !== IDS[2] && id !== IDS[0])
  );
  for (const item of normalizado.slice(2)) {
    assert.equal(item.visivel, true, `${item.id} deveria nascer visivel`);
  }
});

test("secao que saiu do catalogo e descartada", () => {
  const normalizado = normalizarLayout([
    { id: "grafico-de-performance", visivel: true },
    { id: IDS[0], visivel: true },
  ]);

  assert.ok(!ids(normalizado).includes("grafico-de-performance"));
  assert.equal(normalizado.length, IDS.length);
});

test("id repetido no salvo vale uma vez so", () => {
  const normalizado = normalizarLayout([
    { id: IDS[0], visivel: false },
    { id: IDS[0], visivel: true },
  ]);

  assert.equal(normalizado.length, IDS.length);
  // Vale a PRIMEIRA: e a que o usuario ve no topo da lista de configuracao.
  assert.equal(normalizado[0].visivel, false);
});

test("entrada sem forma de item e ignorada sem derrubar o resto", () => {
  const normalizado = normalizarLayout([
    null,
    "resumo",
    42,
    { visivel: true },
    { id: 7, visivel: true },
    { id: IDS[1], visivel: false },
  ]);

  assert.equal(normalizado.length, IDS.length);
  assert.equal(normalizado[0].id, IDS[1]);
  assert.equal(normalizado[0].visivel, false);
});

test("`visivel` que nao e boolean conta como visivel", () => {
  // Na duvida, MOSTRAR. Um bloco que aparece sem ser pedido se resolve em dois
  // cliques; um bloco que some sozinho e dinheiro que a pessoa deixa de ver
  // sem saber que deixou.
  for (const valor of [undefined, null, 1, "sim"]) {
    const [primeiro] = normalizarLayout([{ id: IDS[0], visivel: valor }]);
    assert.equal(primeiro.visivel, true, `visivel=${String(valor)}`);
  }

  // So o `false` literal esconde.
  const [escondido] = normalizarLayout([{ id: IDS[0], visivel: false }]);
  assert.equal(escondido.visivel, false);
});

test("normalizar e idempotente", () => {
  // A tela normaliza o que a rota ja normalizou. Se a segunda passada mudasse
  // alguma coisa, o cliente e o servidor discordariam sobre o layout salvo e o
  // aviso de "ha mudancas nao salvas" ficaria aceso sem mudanca nenhuma.
  const uma = normalizarLayout([{ id: IDS[3], visivel: false }]);
  assert.deepEqual(normalizarLayout(uma), uma);
});

// ---------------------------------------------------------------------------
// Reordenar
// ---------------------------------------------------------------------------

test("mover para cima e para baixo troca com o vizinho", () => {
  const layout = layoutPadrao();

  assert.deepEqual(ids(moverSecao(layout, IDS[1], -1)), [
    IDS[1],
    IDS[0],
    ...IDS.slice(2),
  ]);

  assert.deepEqual(ids(moverSecao(layout, IDS[0], 1)), [
    IDS[1],
    IDS[0],
    ...IDS.slice(2),
  ]);
});

test("mover nos limites nao da a volta", () => {
  // Quem clica "subir" no primeiro item espera que nada aconteca. Dar a volta
  // mandaria o bloco para o rodape da tela inicial -- um movimento de sete
  // posicoes a partir de um clique que pedia uma.
  const layout = layoutPadrao();
  assert.deepEqual(ids(moverSecao(layout, IDS[0], -1)), IDS);
  assert.deepEqual(ids(moverSecao(layout, IDS[IDS.length - 1], 1)), IDS);
});

test("mover id desconhecido nao mexe na lista", () => {
  const layout = layoutPadrao();
  assert.deepEqual(ids(moverSecao(layout, "nao-existe", 1)), IDS);
});

test("mover nao muda a lista original", () => {
  const layout = layoutPadrao();
  moverSecao(layout, IDS[0], 1);
  assert.deepEqual(ids(layout), IDS);
});

test("arrastar para baixo poe o item NA posicao do alvo", () => {
  // O erro de um: lendo o indice do alvo antes de remover o arrastado, o item
  // pararia ANTES do alvo em vez de no lugar dele.
  const layout = layoutPadrao();
  const resultado = reordenarPorArrasto(layout, IDS[0], IDS[2]);

  assert.equal(
    resultado.findIndex((i) => i.id === IDS[0]),
    2,
    "o arrastado tem que ocupar a posicao onde o alvo estava"
  );
  assert.deepEqual(ids(resultado), [IDS[1], IDS[2], IDS[0], ...IDS.slice(3)]);
});

test("arrastar para cima poe o item na posicao do alvo", () => {
  const layout = layoutPadrao();
  const resultado = reordenarPorArrasto(layout, IDS[3], IDS[1]);
  assert.deepEqual(ids(resultado), [
    IDS[0],
    IDS[3],
    IDS[1],
    IDS[2],
    ...IDS.slice(4),
  ]);
});

test("arrastar sobre si mesmo nao muda nada", () => {
  const layout = layoutPadrao();
  assert.deepEqual(ids(reordenarPorArrasto(layout, IDS[0], IDS[0])), IDS);
});

test("arrastar preserva a visibilidade de quem se moveu", () => {
  // O arrastar mexe em ORDEM. Um bloco desligado que volta ligado depois de
  // ser arrastado e a preferencia do usuario sendo desfeita pelo gesto que
  // deveria so mover.
  const layout = alternarVisibilidade(layoutPadrao(), IDS[0]);
  const resultado = reordenarPorArrasto(layout, IDS[0], IDS[3]);
  const movido = resultado.find((i) => i.id === IDS[0]);
  assert.equal(movido.visivel, false);
});

// ---------------------------------------------------------------------------
// Visibilidade
// ---------------------------------------------------------------------------

test("alternar liga e desliga sem mexer na ordem", () => {
  const layout = layoutPadrao();
  const desligado = alternarVisibilidade(layout, IDS[2]);

  assert.deepEqual(ids(desligado), IDS);
  assert.equal(desligado.find((i) => i.id === IDS[2]).visivel, false);
  assert.equal(
    alternarVisibilidade(desligado, IDS[2]).find((i) => i.id === IDS[2])
      .visivel,
    true
  );
});

test("secoesVisiveis devolve so as ligadas, na ordem", () => {
  const layout = alternarVisibilidade(
    alternarVisibilidade(layoutPadrao(), IDS[1]),
    IDS[3]
  );
  assert.deepEqual(
    secoesVisiveis(layout),
    IDS.filter((id) => id !== IDS[1] && id !== IDS[3])
  );
});

test("esconder tudo devolve lista vazia, nao o padrao", () => {
  // Um `||` a mais no caminho -- `visiveis.length ? visiveis : padrao` -- faria
  // o painel ressuscitar inteiro quando o usuario desligasse o ultimo bloco.
  // A escolha dele tem que ser respeitada ate o fim; quem cuida da tela em
  // branco e a propria tela, com um aviso e um atalho de volta.
  const tudoOculto = layoutPadrao().map((i) => ({ ...i, visivel: false }));
  assert.deepEqual(secoesVisiveis(tudoOculto), []);
});

// ---------------------------------------------------------------------------
// Agrupar em linhas
// ---------------------------------------------------------------------------

test("a ordem de fabrica mantem 'A vencer' e 'Metas' lado a lado", () => {
  // E como a tela sempre foi. Se esta linha quebrar, a alteracao mudou o
  // desenho do painel de todo mundo que nunca configurou nada.
  const linhas = agruparEmLinhas(secoesVisiveis(layoutPadrao()));
  const pares = linhas.filter((l) => l.length === 2);
  assert.equal(pares.length, 1);
  assert.deepEqual(pares[0], ["a-vencer", "metas"]);
});

test("meia largura separada por um bloco largo ocupa linha propria", () => {
  const linhas = agruparEmLinhas(["a-vencer", "contas", "metas"]);
  assert.deepEqual(linhas, [["a-vencer"], ["contas"], ["metas"]]);
});

test("nenhuma linha passa de dois blocos", () => {
  // A grade da tela tem duas colunas. Uma linha de tres sairia espremida, e o
  // sintoma apareceria so no desktop largo.
  const todasMeias = [...SECOES_DE_MEIA_LARGURA];
  for (const linha of agruparEmLinhas([...todasMeias, ...todasMeias])) {
    assert.ok(linha.length <= 2, `linha com ${linha.length} blocos`);
  }
});

test("agrupar nao perde nem duplica bloco", () => {
  const ordem = secoesVisiveis(layoutPadrao());
  assert.deepEqual(agruparEmLinhas(ordem).flat(), ordem);
  assert.deepEqual(agruparEmLinhas([]), []);
});

// ---------------------------------------------------------------------------
// Rotulo
// ---------------------------------------------------------------------------

test("tituloDaSecao devolve o id quando nao conhece a secao", () => {
  assert.equal(tituloDaSecao(IDS[0]), SECOES_DO_PAINEL[0].titulo);
  assert.equal(tituloDaSecao("inventado"), "inventado");
});
