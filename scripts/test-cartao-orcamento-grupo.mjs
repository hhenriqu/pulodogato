#!/usr/bin/env node
// =====================================================
// PULODOGATO - a barra da viagem, desenhada num lugar so (HMO-180)
// =====================================================
// A barra "quanto ja gastamos da viagem" nasceu na tela de Orcamento, aba
// Grupo (HMO-138). A HMO-180 a levou tambem para DENTRO da tela do grupo, que
// e onde a pergunta e feita.
//
// POR QUE ESTE TESTE RENDERIZA O COMPONENTE
// -----------------------------------------
// `separarOrcamentos` e `orcamentoDoGrupo` ja tem teste proprio
// (test-orcamento-de-grupo.mjs), e ele passaria VERDE com o JSX quebrado: a
// conta estaria certa e a tela mostrando outra coisa. As duas telas agora
// importam o mesmo arquivo, e e esse arquivo que aparece na tela -- entao e
// sobre o HTML dele que o teste afirma.
//
// O QUE ELE COBRA
// ---------------
//   - o percentual e a frase saem da conta, e nao de um `reduce` do JSX. Se
//     alguem reescrever a soma aqui, os numeros deixam de bater com a aba de
//     Orcamento -- duas telas com percentuais diferentes para a mesma viagem,
//     sem erro nenhum aparecer. E o "nao fazer" literal da issue;
//   - a barra para em 100 quando estourou. Acima disso o `Progress` empurra o
//     indicador para fora do trilho: some a barra e fica o numero;
//   - o estouro sai com a palavra "Estourou" e SEM sinal de menos. "Restam
//     R$ 300" e "Estourou R$ 300" sao o mesmo numero com sentidos opostos;
//   - a acao por linha e um slot. A tela de Orcamento passa o botao de remover;
//     a do grupo NAO passa nada, porque ela nao gerencia teto. Se o botao
//     vazasse para la, a pessoa apagaria da tela do grupo um teto que ela nem
//     sabia estar editando;
//   - o mes. Uma barra sem eixo de tempo mostra o numero de um mes debaixo do
//     nome de outro sem dar erro -- e a tela do grupo nao tem seletor de mes
//     para desmentir o rotulo.
//
// O QUE ELE NAO COBRE
// -------------------
// A cor do percentual. Ela sai de classe de token (`text-destructive`,
// `text-warning`, `text-success`), e afirmar sobre nome de classe no HTML
// testaria o Tailwind, nao a decisao. O status que ESCOLHE a cor tem assercao
// em test-orcamento-de-grupo.mjs.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CartaoOrcamentoGrupo,
  LinhaDeTeto,
} from "../.tmp-cartao-orcamento-grupo/components/financial/CartaoOrcamentoGrupo.js";
import { orcamentoDoGrupo } from "../.tmp-cartao-orcamento-grupo/lib/orcamento-de-grupo.js";

// Uma linha de `budget_consumption` como a rota entrega. `spent` ja vem
// POSITIVO da view (a SECAO 5 do 006 aplica ABS porque despesa e gravada
// negativa neste banco), e os numericos chegam como STRING do PostgREST --
// `numeric(15,2)` nao cabe em double sem perda, entao o driver nao converte.
// Passar number aqui testaria um dado que a rota nao produz.
let seq = 0;
const teto = ({
  limite,
  gasto,
  status = "ok",
  categoria = "Hotel",
  grupo = "g1",
  nomeDoGrupo = "Bariloche",
}) => ({
  id: `b${++seq}`,
  group_id: grupo,
  amount_limit: String(limite.toFixed(2)),
  spent: String(gasto.toFixed(2)),
  remaining: String((limite - gasto).toFixed(2)),
  consumed_ratio: String((limite > 0 ? gasto / limite : 0).toFixed(4)),
  consumption_status: status,
  category: { name: categoria },
  group: { id: grupo, name: nomeDoGrupo },
});

/**
 * Renderiza o cartao pelo MESMO caminho da tela do grupo: a lista crua passa
 * por `orcamentoDoGrupo` e o resultado vai para o componente. Montar o
 * `GrupoOrcado` a mao aqui deixaria a soma de fora justamente do teste que
 * existe para nao deixar a soma de fora.
 */
const render = (linhas, props = {}) => {
  const grupo = orcamentoDoGrupo(linhas, "g1");
  assert.ok(grupo, "a fixture nao produziu grupo nenhum");
  return renderToStaticMarkup(h(CartaoOrcamentoGrupo, { grupo, ...props }));
};

/** O HTML sai com entidades; comparar texto exige desfazer as que aparecem. */
const texto = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    // O espaco estreito sem quebra que o Intl usa entre "R$" e o numero: sem
    // isto, procurar por "R$ 750,00" no HTML nao acha nada e o teste reprova
    // uma tela que esta certa.
    .replace(/ | /g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ---------------------------------------------------------------------------
// A CONTA APARECE NA TELA -- e vem da funcao, nao do JSX
// ---------------------------------------------------------------------------
test("a barra do grupo mostra a soma dos tetos da viagem, nao um deles", () => {
  // Os percentuais sao DIFERENTES de proposito: Hotel 20%, Comida 35%, total
  // 25%. Com duas categorias que dessem o mesmo percentual do total, um cartao
  // que copiasse o numero da primeira linha para o cabecalho passaria verde.
  const html = texto(
    render([
      teto({ limite: 2000, gasto: 400, categoria: "Hotel" }),
      teto({ limite: 1000, gasto: 350, categoria: "Comida" }),
    ])
  );

  // O cabecalho e a barra do grupo: tudo antes da frase de apoio.
  const cabecalho = html.split("soma o gasto")[0];

  // 750 de 3000 = 25%.
  assert.match(
    cabecalho,
    /R\$ 750,00 de R\$ 3\.000,00/,
    "o cartao nao somou os dois tetos"
  );
  assert.match(html, /Restam R\$ 2\.250,00/);

  // A negacao explicita: sem ela, um cabecalho que repetisse o teto de MAIOR
  // valor (400 de 2000) passaria todo assert que fala do que DEVE aparecer.
  assert.doesNotMatch(cabecalho, /R\$ 400,00|R\$ 2\.000,00/);

  // E as duas linhas por categoria continuam embaixo, cada uma com o SEU
  // percentual -- nao o do grupo.
  assert.match(html, /Hotel R\$ 400,00 de R\$ 2\.000,00 20%/);
  assert.match(html, /Comida R\$ 350,00 de R\$ 1\.000,00 35%/);
  assert.match(html, /25%/, "o percentual do grupo nao apareceu");
});

test("o nome da viagem sai no titulo, e nao o uuid", () => {
  const html = texto(render([teto({ limite: 1000, gasto: 100 })]));

  assert.match(html, /Bariloche/);
  assert.doesNotMatch(html, /g1/);
});

test("a frase diz que a soma e de todos os membros", () => {
  // Sem esta frase o numero parece alto demais para quem lembra so do que
  // pagou -- o teto de grupo soma o gasto do grupo inteiro.
  const html = texto(render([teto({ limite: 1000, gasto: 100 })]));

  assert.match(html, /soma o gasto de todos os membros/);
});

// ---------------------------------------------------------------------------
// O ESTOURO: a palavra muda, o sinal nao aparece, e a barra para em 100
// ---------------------------------------------------------------------------
test("estouro sai como 'Estourou', sem sinal de menos", () => {
  const html = texto(render([teto({ limite: 1000, gasto: 1300, status: "exceeded" })]));

  assert.match(html, /Estourou R\$ 300,00/);
  assert.doesNotMatch(html, /Restam/, "anunciou estouro como sobra");
  assert.doesNotMatch(html, /-R\$ 300,00/, "'Estourou -R$ 300' se le como dois estouros");
  // O percentual e quem conta o TAMANHO do estouro.
  assert.match(html, /130%/);
});

test("a barra para em 100 mesmo com 130% gastos", () => {
  const html = render([teto({ limite: 1000, gasto: 1300, status: "exceeded" })]);

  // O Progress do radix posiciona o indicador por translateX(-(100 - value)%).
  // Com value acima de 100 o translate fica POSITIVO e o indicador sai do
  // trilho: a barra desaparece da tela e fica so o numero.
  const translates = [...html.matchAll(/translateX\(-?([\d.]+)%\)/g)].map((m) =>
    Number(m[1])
  );
  assert.ok(translates.length > 0, "nenhuma barra foi renderizada");
  assert.doesNotMatch(html, /translateX\(\d/, "o indicador saiu do trilho (value > 100)");
  // 100% de largura = translateX(-0%).
  assert.ok(
    translates.includes(0),
    `a barra nao encheu: translates=${JSON.stringify(translates)}`
  );
});

test("viagem sem teto nenhum nao rende barra NaN", () => {
  // 0/0 e NaN, e NaN no Progress rende uma barra que some sem erro no console.
  const html = render([teto({ limite: 0, gasto: 0 })]);

  assert.doesNotMatch(html, /NaN/);
  assert.match(texto(html), /0%/);
});

// ---------------------------------------------------------------------------
// A ACAO POR LINHA E UM SLOT: a tela do grupo nao gerencia teto
// ---------------------------------------------------------------------------
test("sem acaoDaLinha nao aparece botao nenhum (a tela do grupo)", () => {
  const html = render([teto({ limite: 1000, gasto: 100 })]);

  assert.doesNotMatch(html, /<button/, "a tela do grupo ganhou um botao que nao pediu");
  assert.doesNotMatch(html, /Remover/);
});

test("com acaoDaLinha o botao aparece em CADA linha (a tela de Orcamento)", () => {
  const html = render(
    [
      teto({ limite: 2000, gasto: 500, categoria: "Hotel" }),
      teto({ limite: 1000, gasto: 250, categoria: "Comida" }),
    ],
    {
      acaoDaLinha: (b) =>
        h("button", { type: "button", "aria-label": `Remover ${b.category.name}` }),
    }
  );

  // Duas linhas, dois botoes: um slot chamado uma vez so fora do `.map`
  // deixaria a segunda categoria sem como ser removida.
  assert.equal((html.match(/<button/g) ?? []).length, 2);
  assert.match(html, /Remover Hotel/);
  assert.match(html, /Remover Comida/);
});

// ---------------------------------------------------------------------------
// O MES: sem eixo de tempo o rotulo mente sem dar erro
// ---------------------------------------------------------------------------
test("o mes recebido aparece por extenso", () => {
  const html = texto(
    render([teto({ limite: 1000, gasto: 100 })], { mes: "2026-09-01" })
  );

  assert.match(html, /em setembro de 2026/);
});

test("o primeiro dia do mes nao volta um mes (a ISO lida como UTC)", () => {
  // 'AAAA-MM-01' passado por new Date() no fuso de Sao Paulo cai no ultimo dia
  // do mes anterior: a barra de janeiro sairia rotulada como dezembro.
  const html = texto(
    render([teto({ limite: 1000, gasto: 100 })], { mes: "2026-01-01" })
  );

  assert.match(html, /em janeiro de 2026/);
  assert.doesNotMatch(html, /dezembro/);
});

test("sem mes o cartao nao inventa um", () => {
  // A tela de Orcamento tem seletor de mes no cabecalho e nao passa nada aqui.
  const html = texto(render([teto({ limite: 1000, gasto: 100 })]));

  assert.doesNotMatch(html, / em (janeiro|fevereiro|dezembro|undefined)/);
  assert.doesNotMatch(html, /undefined/);
});

test("titulo substitui o nome do grupo quando a tela ja tem o nome no cabecalho", () => {
  const html = texto(
    render([teto({ limite: 1000, gasto: 100 })], { titulo: "Orçamento do grupo" })
  );

  assert.match(html, /Orçamento do grupo/);
  assert.doesNotMatch(html, /Bariloche/);
});

// ---------------------------------------------------------------------------
// A LINHA POR CATEGORIA, sozinha: e ela que a aba "Por categoria" desenha
// ---------------------------------------------------------------------------
test("a linha mostra gasto, teto e sobra da propria categoria", () => {
  const html = texto(
    renderToStaticMarkup(
      h(LinhaDeTeto, { budget: teto({ limite: 800, gasto: 200, categoria: "Mercado" }) })
    )
  );

  assert.match(html, /Mercado/);
  assert.match(html, /R\$ 200,00 de R\$ 800,00/);
  assert.match(html, /25%/);
  assert.match(html, /Restam R\$ 600,00/);
});

test("a linha sem categoria resolvida nao sai vazia", () => {
  const budget = teto({ limite: 800, gasto: 200 });
  const html = texto(renderToStaticMarkup(h(LinhaDeTeto, { budget: { ...budget, category: null } })));

  assert.match(html, /Categoria/);
});
