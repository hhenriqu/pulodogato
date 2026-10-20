#!/usr/bin/env node
// =====================================================
// PULODOGATO - O APORTE DE RENDA FIXA NA TELA (HMO-439)
// =====================================================
//   npm run test:aporte-de-renda-fixa
//
// Renderiza `CamposDaMovimentacao` -- o componente de PRODUCAO, nao uma copia
// dele -- com `react-dom/server`, e mede quais campos aparecem para cada tipo de
// ativo. Mesmo desenho de `test-campos-da-conta.mjs`.
//
// O DEFEITO QUE ISTO EXISTE PARA PEGAR
// ------------------------------------
// O formulario pedia QUANTIDADE e PRECO UNITARIO para tudo. Para um CDB isso e
// absurdo na tela e perigoso no dado: o preco medio e DERIVADO das movimentacoes
// (lib/investments.ts), entao um aporte digitado na coluna errada nao aparece
// como linha estranha -- ele move a media, e com ela o lucro e a rentabilidade
// exibidos.
//
// POR QUE O COMPONENTE DOS CAMPOS E SEPARADO DO MODAL
// ---------------------------------------------------
// MEDIDO aqui, e e a razao de o componente existir: o corpo do modal mora dentro
// de um `Dialog` do Radix, que renderiza por PORTAL, e portal nao sai no
// `react-dom/server` -- `renderToStaticMarkup(<ModalDeMovimentacao>)` devolve
// string de comprimento ZERO. Uma suite escrita sobre aquele markup afirmaria
// "mostra o campo em reais" e "esconde a quantidade" ao mesmo tempo, verde, para
// qualquer codigo -- inclusive para o de antes desta issue. O caso 1 abaixo
// mantem essa medicao viva.
//
// CADA CASO TRAZ O CONTROLE: o mesmo componente com um ativo de OUTRO tipo.
// "o markup contem 'Valor do aporte'" e uma assercao que passaria sozinha num
// componente que mostrasse os dois campos de cota TAMBEM; o par de leituras e o
// que prova a substituicao.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { CamposDaMovimentacao, ModalDeMovimentacao, valoresDaMovimentacaoVazios } =
  await import(
    "../.tmp-aporte-de-renda-fixa/components/investments/ModalDeMovimentacao.js"
  );

/** Um CDB e uma acao na mesma carteira -- o par de controle de todos os casos. */
const ATIVOS = [
  { id: "cdb", symbol: "CDB-XP", name: "CDB XP 110% CDI", type: "fixed_income" },
  { id: "petr", symbol: "PETR4", name: "Petrobras PN", type: "stock" },
];

const HOJE = "2026-10-20";

/**
 * Renderiza os campos com um ativo escolhido.
 *
 * Os valores sao DISTINTOS entre si de proposito (aporte 10000.00, quantidade
 * 100, preco 31.50, taxas 4.90): valor default colapsa campos que a feature
 * separa, e com dois campos no mesmo valor uma troca entre eles sairia verde.
 */
function renderizar({ assetId, kind = "buy" }) {
  const valores = {
    ...valoresDaMovimentacaoVazios(HOJE, assetId),
    kind,
    quantidade: "100",
    preco: "31.50",
    taxas: "4.90",
    valorDoAporte: "10000.00",
  };

  return renderToStaticMarkup(
    React.createElement(CamposDaMovimentacao, {
      ativos: ATIVOS,
      valores,
      hoje: HOJE,
      aoMudar: () => {},
    })
  );
}

// ---------------------------------------------------------
// 1. A medicao que justifica o componente separado
// ---------------------------------------------------------

test("o MODAL inteiro nao sai no react-dom/server -- por isso os campos sao um componente", () => {
  const html = renderToStaticMarkup(
    React.createElement(ModalDeMovimentacao, {
      ativos: ATIVOS,
      ativoInicial: "cdb",
      hoje: HOJE,
      salvando: false,
      aoFechar: () => {},
      aoSalvar: async () => null,
    })
  );

  // O portal do Radix engole TUDO. Se um dia isto deixar de ser verdade, este
  // caso fica vermelho e a separacao pode ser revista -- mas enquanto ele passa,
  // nenhuma assercao de markup sobre o modal inteiro significa coisa alguma.
  assert.equal(
    html.length,
    0,
    "o modal passou a renderizar no servidor: reveja por que os campos sao um componente separado"
  );

  // E o CONTROLE de que a sonda deste arquivo nao e vacua: o mesmo estado, pelos
  // campos, sai com markup de verdade.
  assert.ok(renderizar({ assetId: "cdb" }).length > 500);
});

// ---------------------------------------------------------
// 2. Renda fixa: valor em reais e data do aporte
// ---------------------------------------------------------

test("CDB mostra 'Valor do aporte (R$)' e 'Data do aporte'", () => {
  const html = renderizar({ assetId: "cdb" });

  assert.ok(html.includes("Valor do aporte (R$)"), "o rotulo que a issue pede");
  assert.ok(html.includes("Data do aporte"), "o outro rotulo que a issue pede");
  assert.ok(html.includes('id="lanc-valor-aporte"'), "o campo existe de fato");

  // CONTROLE: a mesma tela com uma acao NAO tem nenhum dos dois. Sem este par,
  // as tres assercoes de cima passariam num componente que mostrasse o campo em
  // reais para todo ativo -- o defeito oposto, e igualmente errado.
  const acao = renderizar({ assetId: "petr" });
  assert.ok(!acao.includes("Valor do aporte"), "acao nao tem aporte em reais");
  assert.ok(!acao.includes("Data do aporte"));
  assert.ok(!acao.includes('id="lanc-valor-aporte"'));
});

test("CDB NAO mostra quantidade nem preco unitario -- eles saem da tela", () => {
  const html = renderizar({ assetId: "cdb" });

  // `id=` e nao o rotulo: "Quantidade" aparece em outros textos da tela, e um
  // `includes("Quantidade")` falso-positivo deixaria o campo ligado sem ninguem
  // ver. O `id` e do proprio `<input>`.
  assert.ok(!html.includes('id="lanc-quantidade"'), "sem campo de quantidade");
  assert.ok(!html.includes('id="lanc-preco"'), "sem campo de preco unitario");
  assert.ok(!html.includes("Preço unitário"));

  // E eles saem por MONTAGEM, nao por `hidden`: um `required` escondido barra o
  // submit sem dizer onde, e o sintoma e o botao que parece nao fazer nada.
  //
  // A assercao e sobre `hidden=""` -- o atributo booleano, como o React o emite
  // -- e NAO sobre a substring "hidden": esta tela tem dez `aria-hidden` (os
  // icones, o `<select>` nativo do Radix, o calendario do CampoDeData) e um
  // `overflow:hidden` em CSS, entao um `includes("hidden")` ficaria vermelho
  // para sempre sem nada a ver com o campo escondido.
  assert.ok(!html.includes('hidden=""'), "nenhum campo escondido por atributo");

  // CONTROLE: na acao os dois estao la. Sem isto, as assercoes de cima passariam
  // num componente que nao mostrasse campo nenhum.
  const acao = renderizar({ assetId: "petr" });
  assert.ok(acao.includes('id="lanc-quantidade"'));
  assert.ok(acao.includes('id="lanc-preco"'));
  assert.ok(acao.includes("Preço unitário"));
});

// ---------------------------------------------------------
// 3. O campo de dinheiro nao pode ser `type="number"`
// ---------------------------------------------------------

test("o campo do aporte e texto com inputMode decimal, nunca `type=number`", () => {
  const html = renderizar({ assetId: "cdb" });

  // `type="number"` DESCARTA a virgula: em "10000,50" o navegador devolve string
  // vazia em `e.target.value`, e em pt-BR isso apaga os centavos de quem digita
  // como se fala -- sem erro nenhum no caminho. Ver lib/dinheiro.ts.
  assert.ok(
    !html.includes('type="number"'),
    "nenhum campo numerico cru na tela de renda fixa"
  );
  // `inputMode` com M maiusculo: e assim que este React emite a prop no markup
  // estatico. Escrito em minuscula, o caso fica vermelho sem nada de errado na
  // tela -- e quem for consertar vai mexer no componente.
  assert.ok(html.includes('inputMode="decimal"'), "o teclado numerico do celular");

  // CONTROLE: a acao TEM `type="number"`, e com razao -- cota e cripto tem oito
  // casas e nao cabem na mascara de duas da moeda (HMO-171). A assercao de cima
  // so diz algo porque esta aqui.
  assert.ok(renderizar({ assetId: "petr" }).includes('type="number"'));
});

test("o valor digitado chega ao campo mascarado como R$ em pt-BR", () => {
  const html = renderizar({ assetId: "cdb" });

  // O estado guarda "10000.00" (notacao plana) e a tela mostra "R$ 10.000,00".
  // A medicao e sobre o VALOR exibido, nao sobre o rotulo: um campo que
  // mostrasse o estado cru estaria pedindo para a pessoa reler um numero em
  // formato de outro pais -- e `parseFloat("1.000,00")` e 1.
  assert.ok(
    html.includes("10.000,00"),
    "o campo mostra o valor mascarado em pt-BR"
  );
  assert.ok(!html.includes('value="10000.00"'), "o cru nao vai para a tela");
});

// ---------------------------------------------------------
// 4. Venda e provento nao se chamam "aporte"
// ---------------------------------------------------------

test("resgate e recebimento tem rotulo proprio -- 'aporte' seria mentira na tela", () => {
  const resgate = renderizar({ assetId: "cdb", kind: "sell" });
  assert.ok(resgate.includes("Valor do resgate (R$)"));
  assert.ok(resgate.includes("Data do resgate"));
  assert.ok(!resgate.includes("Valor do aporte"), "um resgate nao e um aporte");

  const provento = renderizar({ assetId: "cdb", kind: "dividend" });
  assert.ok(provento.includes("Valor recebido (R$)"));
  assert.ok(provento.includes("Data do recebimento"));
  assert.ok(!provento.includes("Valor do aporte"));

  // Os tres rotulos sao DIFERENTES entre si: um `Record` preenchido com o mesmo
  // texto nos tres passaria em cada assercao isolada.
  const aporte = renderizar({ assetId: "cdb", kind: "buy" });
  assert.ok(aporte.includes("Valor do aporte (R$)"));
  assert.ok(!aporte.includes("Valor do resgate"));
  assert.ok(!aporte.includes("Valor recebido"));
});

// ---------------------------------------------------------
// 5. Sem ativo escolhido a tela abre no caso comum
// ---------------------------------------------------------

test("sem ativo escolhido, a tela abre com quantidade e preco", () => {
  // O botao do cabecalho abre o modal sem ativo. Abrir no modo renda fixa ali
  // seria pedir "valor do aporte" para quem vai lancar uma compra de PETR4.
  const html = renderizar({ assetId: "" });

  assert.ok(html.includes('id="lanc-quantidade"'));
  assert.ok(!html.includes('id="lanc-valor-aporte"'));

  // E um id que NAO esta na lista tambem cai no caso comum, em vez de escolher
  // pelo que vier: `find` em lista sem o id devolve undefined, e um
  // `?.type !== "stock"` aqui ligaria a renda fixa para o ativo desconhecido.
  const inexistente = renderizar({ assetId: "nao-existe" });
  assert.ok(inexistente.includes('id="lanc-quantidade"'));
  assert.ok(!inexistente.includes('id="lanc-valor-aporte"'));
});
