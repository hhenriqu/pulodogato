#!/usr/bin/env node
// =====================================================
// PULODOGATO - a linha da lista das telas de movimentacao (HMO-287)
// =====================================================
//   npm run test:secao-da-tela
//
// POR QUE ESTE TESTE RENDERIZA O COMPONENTE
// -----------------------------------------
// A HMO-285 fez `LinhaDaTela.natureza` e `LinhaDaTela.fatura` EXISTIREM, e tem
// 50 blocos de unidade e 40 mutantes provando que os dois campos sao calculados
// certo. Toda aquela suite passa verde com a marcacao ignorando os dois campos
// -- com a linha de fatura desenhada exatamente igual a uma despesa comum. O
// dado certo chegando num JSX que nao o le nao quebra build, nao fica vazio e
// nao muda numero nenhum.
//
// Aqui o `react-dom/server` renderiza o mesmo arquivo que o app importa, e o
// teste afirma sobre o HTML que sai.
//
// AS QUATRO CLASSES DE DEFEITO QUE SO A MARCACAO DENUNCIA
// -------------------------------------------------------
//   1. O ROTULO TROCADO. "fixo" numa fatura e "fatura de cartão" numa conta
//      fixa sao os dois plausiveis -- as duas linhas existem, as duas tem
//      vencimento, e o valor ao lado esta certo nas duas. Nenhum teste de
//      funcao pura distingue, porque a funcao pura nao escolhe a palavra.
//
//   2. O MES ERRADO NO `href`. A chave da fatura e 'AAAA-MM-01' (10 chars) e o
//      que a tela do cartao le e 'AAAA-MM' (7). O link sem a fatia aponta para
//      um destino que EXISTE e que abre no mes corrente -- o valor certo, o mes
//      errado, e nada dizendo que o mes trocou. A unica coisa que pega isso e
//      ler a string do `href`.
//
//   3. A LINHA QUE PARECE CLICAVEL E NAO E. Tornar toda linha um `<a>` custa
//      mais que nenhuma: a pessoa toca na despesa comum, nada acontece, e a
//      conclusao natural e que o app travou. A assercao aqui e NEGATIVA.
//
//   4. O SUBTOTAL QUE NAO FECHA COM A LISTA. Ele e recalculado das linhas que a
//      secao desenha, de proposito (ver `SecaoDaTela`). Receber o numero de
//      cima esconderia a divergencia que ele existe para mostrar.
//
// O QUE ELE NAO COBRE
// -------------------
// Cor, espacamento e a forma do `<path>` do icone. A cor sai de classe de
// token, que tem guarda propria (check-color-tokens); a forma do path e do
// lucide e mudaria num upgrade do pacote sem nada estar errado. O que se afirma
// do icone e o `aria-label`, que e o que leitor de tela le e o que o rotulo
// visivel repete.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreditCard, Repeat, TrendingDown, TrendingUp } from "lucide-react";

import { SecaoDaTela } from "../.tmp-secao-da-tela/components/movimentacoes/SecaoDaTela.js";

const CARTAO = "11111111-2222-3333-4444-555555555555";

/** A aparencia da tela de Despesas, como `APARENCIA` em TelaDeMovimentacao. */
const DESPESAS = {
  Icone: TrendingDown,
  cor: "text-destructive",
  rotaDeLancar: "/dashboard/movimentacoes/despesa",
  textoDeLancar: "Nova Despesa",
  palavraDaLinha: "Despesa",
};

/** A de Receitas, para provar que a palavra do caso comum e da TELA. */
const RECEITAS = {
  Icone: TrendingUp,
  cor: "text-success",
  rotaDeLancar: "/dashboard/movimentacoes/receita",
  textoDeLancar: "Nova Receita",
  palavraDaLinha: "Receita",
};

/** O esqueleto de uma linha; cada teste troca so o que lhe interessa. */
const linha = (extra) => ({
  id: "l1",
  gravada: true,
  descricao: "Mercado",
  valor: 159.9,
  data: "2026-08-14",
  origem: "previsto",
  tipo: "expense",
  status: "pending",
  situacao: "pending",
  categoria: "Alimentação",
  conta: "de Itaú",
  moeda: null,
  natureza: "despesa",
  fatura: null,
  ...extra,
});

/** A fatura de AGOSTO, com a tela aberta em agosto -- ver o teste do `href`. */
const FATURA = linha({
  id: "fatura:2026-08-01:" + CARTAO,
  gravada: false,
  descricao: "Fatura Nubank",
  valor: 1234.56,
  categoria: null,
  conta: "Nubank",
  natureza: "fatura",
  fatura: { accountId: CARTAO, mes: "2026-08-01" },
});

const FIXA = linha({
  id: "l2",
  descricao: "Aluguel",
  valor: 2500,
  natureza: "fixa",
});

const render = (props) =>
  renderToStaticMarkup(
    h(SecaoDaTela, {
      titulo: "Previsto para o período",
      subtitulo: "o que ainda vence no período",
      icone: null,
      linhas: [linha({})],
      carregando: false,
      vazio: "Nada previsto neste período.",
      aparencia: DESPESAS,
      ...props,
    })
  );

/**
 * O HTML sem tag nenhuma, com os espacos normalizados.
 *
 * Tirar as TAGS tira tambem os ATRIBUTOS, e isso e o que faz as assercoes de
 * texto desta suite valerem alguma coisa: o `aria-label` do icone tem as mesmas
 * palavras do rotulo visivel, entao procurar "fatura de cartão" no HTML cru
 * acharia o atributo e passaria verde com o rotulo visivel apagado. Aqui so
 * sobra o que esta ESCRITO na tela.
 */
const texto = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;| /g, " ")
    .replace(/&#x27;|&quot;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** O `href` da unica `<a>` do HTML, ou `null` quando nao ha nenhuma. */
const href = (html) => {
  const m = /<a\b[^>]*\bhref="([^"]*)"/.exec(html);
  return m ? m[1].replace(/&amp;/g, "&") : null;
};

// ---------------------------------------------------------------------------
// 1. O rotulo de cada natureza
// ---------------------------------------------------------------------------

test("a fatura de cartao diz que e fatura de cartao, com o vocabulario de Contas a Pagar", () => {
  // A MESMA palavra que `bills/page.tsx` usa na lista dele. Duas telas que
  // mostram linhas da MESMA tabela com dois nomes para a mesma coisa fazem a
  // pessoa procurar a diferenca que nao existe.
  const t = texto(render({ linhas: [FATURA] }));
  assert.ok(t.includes("fatura de cartão"), t);
});

test("a conta fixa diz que e fixa", () => {
  const t = texto(render({ linhas: [FIXA] }));
  assert.ok(t.includes("fixo"), t);
});

test("a despesa comum NAO ganha rotulo -- so o icone", () => {
  // Omitido de proposito: "Despesa" e o padrao da tela de Despesas, e
  // repeti-lo em toda linha e o ruido que faz as duas naturezas que IMPORTAM
  // sumirem no meio. O icone continua la, com `aria-label`.
  const html = render({ linhas: [linha({})] });
  const t = texto(html);

  assert.ok(!t.includes("Despesa"), t);
  assert.ok(!t.includes("fatura"), t);
  assert.ok(!t.includes("fixo"), t);
  assert.ok(html.includes('aria-label="Despesa"'), "o icone perdeu o aria-label");
});

test("os tres rotulos saem na MESMA secao, cada um na sua linha", () => {
  // O controle que pega o rotulo escolhido uma vez para a secao inteira: com
  // as tres naturezas juntas, um rotulo por natureza tem de aparecer uma vez
  // so cada, e nao tres vezes o mesmo.
  const t = texto(render({ linhas: [FATURA, FIXA, linha({})] }));

  const vezes = (agulha) => t.split(agulha).length - 1;
  assert.equal(vezes("fatura de cartão"), 1, t);
  assert.equal(vezes("fixo"), 1, t);
});

test("a palavra do caso comum e da TELA, nao da natureza", () => {
  // `natureza: "despesa"` e o nome do caso COMUM nas tres telas (ver
  // `NaturezaDaLinha`): "Despesa" no aria-label de um salario previsto seria um
  // rotulo errado sobre um numero certo.
  const html = render({
    linhas: [linha({ tipo: "income", descricao: "Salário" })],
    aparencia: RECEITAS,
  });

  assert.ok(html.includes('aria-label="Receita"'), html);
  assert.ok(!html.includes('aria-label="Despesa"'), html);
});

test("a fatura ABERTA continua se distinguindo da fechada -- e sem dizer 'fatura' duas vezes", () => {
  // A fatura aberta recebe compras ate o fechamento: o numero de hoje nao e o
  // numero final. Antes da HMO-287 a linha dizia "fatura aberta do cartão"; o
  // rotulo novo ja diz "fatura", e repetir a palavra na mesma linha e o que
  // esta issue proibiu.
  const aberta = texto(render({ linhas: [FATURA] }));
  assert.ok(aberta.includes("· ainda em aberto"), aberta);
  // A palavra "fatura" aparece UMA vez no rotulo -- "fatura aberta do cartão"
  // ao lado de "fatura de cartão" seria a mesma linha dizendo duas vezes.
  assert.ok(!aberta.includes("fatura aberta"), aberta);
  assert.equal(aberta.split("fatura de cartão").length - 1, 1, aberta);

  const fechada = texto(
    render({ linhas: [{ ...FATURA, gravada: true, id: "sched-1" }] })
  );
  assert.ok(fechada.includes("fatura de cartão"), fechada);
  assert.ok(!fechada.includes("ainda em aberto"), fechada);
});

// ---------------------------------------------------------------------------
// 2. O icone de cada natureza
// ---------------------------------------------------------------------------

test("cada natureza desenha um icone DIFERENTE", () => {
  // A assercao nao e sobre a forma do `<path>` (ela muda num upgrade do lucide
  // sem nada estar errado): e sobre os tres HTMLs serem distintos entre si. Um
  // `marcaDaLinha` que devolvesse sempre o mesmo icone passaria por toda
  // assercao de TEXTO desta suite.
  const svg = (l) => {
    const m = /<svg[\s\S]*?<\/svg>/.exec(render({ linhas: [l] }));
    assert.ok(m, "a linha nao desenhou icone nenhum");
    return m[0];
  };

  const daFatura = svg(FATURA);
  const daFixa = svg(FIXA);
  const daComum = svg(linha({}));

  assert.notEqual(daFatura, daFixa);
  assert.notEqual(daFatura, daComum);
  assert.notEqual(daFixa, daComum);

  // E os dois que tem icone PROPRIO sao os do catalogo, nao o da tela: um
  // `CreditCard` que na verdade fosse o `TrendingDown` da tela passaria no
  // bloco acima se a fixa tambem mudasse.
  const soIcone = (Componente, props) =>
    renderToStaticMarkup(h(Componente, { className: "h-3 w-3", ...props }));

  assert.equal(daFatura, soIcone(CreditCard, { "aria-label": "fatura de cartão" }));
  assert.equal(daFixa, soIcone(Repeat, { "aria-label": "fixo" }));
  assert.equal(daComum, soIcone(TrendingDown, { "aria-label": "Despesa" }));
});

// ---------------------------------------------------------------------------
// 3. O clique da fatura, e o mes que ele leva
// ---------------------------------------------------------------------------

test("a linha de fatura vira <a> para o cartao DELA", () => {
  const html = render({ linhas: [FATURA] });
  const destino = href(html);

  assert.ok(destino, "a linha de fatura nao virou link");
  assert.ok(destino.startsWith(`/dashboard/cartoes/${CARTAO}`), destino);
});

test("o href leva 'AAAA-MM', e NAO 'AAAA-MM-01'", () => {
  // Os dois formatos convivem no app: a chave da fatura e `invoice_month` sao
  // de 10 chars; o estado da tela do cartao e o `&month=` da rota sao de 7. Com
  // os 10, a rota recebe um mes que ela nao reconhece -- e a tela abre no mes
  // corrente, que e exatamente o que ela faria sem parametro nenhum. Destino
  // plausivel, mes errado, nada vermelho.
  const destino = href(render({ linhas: [FATURA] }));

  assert.equal(destino, `/dashboard/cartoes/${CARTAO}?mes=2026-08`);
  assert.ok(!destino.includes("2026-08-01"), destino);
});

test("o mes do href e o da LINHA, nao o de alguma outra", () => {
  // Duas faturas na mesma secao: um `href` montado com um mes fixo (ou com o
  // da primeira linha) passa no teste de uma linha so.
  const setembro = {
    ...FATURA,
    id: "fatura:2026-09-01:" + CARTAO,
    fatura: { accountId: CARTAO, mes: "2026-09-01" },
  };
  const html = render({ linhas: [FATURA, setembro] });
  const todos = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) =>
    m[1].replace(/&amp;/g, "&")
  );

  assert.deepEqual(todos, [
    `/dashboard/cartoes/${CARTAO}?mes=2026-08`,
    `/dashboard/cartoes/${CARTAO}?mes=2026-09`,
  ]);
});

test("a despesa comum NAO e link", () => {
  // Linha que PARECE clicavel e nao e custa mais que linha que nao parece: a
  // pessoa toca, nada acontece, e a conclusao natural e que o app travou.
  const html = render({ linhas: [linha({}), FIXA] });

  assert.equal(href(html), null, html);
  assert.ok(!html.includes("<a "), html);
});

test("a fatura sem cartao nem mes nao inventa link", () => {
  // `fatura: null` com `natureza: "fatura"` nao acontece hoje (o tipo liga os
  // dois em `linhaPrevista`), e a linha tem de degradar para rotulo sem clique
  // em vez de montar um `/dashboard/cartoes/undefined`.
  const html = render({
    linhas: [{ ...FATURA, fatura: null }],
  });

  assert.equal(href(html), null, html);
  assert.ok(texto(html).includes("fatura de cartão"));
});

// ---------------------------------------------------------------------------
// 4. O que a Fase 3 NAO podia mexer
// ---------------------------------------------------------------------------

test("o subtotal continua sendo a soma das linhas DESENHADAS", () => {
  // Nenhuma aritmetica muda nesta issue. O subtotal e recalculado das linhas da
  // secao de proposito: e a unica forma de a tela denunciar divergencia entre o
  // numero e a lista.
  const t = texto(render({ linhas: [FATURA, FIXA, linha({})] }));

  // 1234,56 + 2500,00 + 159,90
  assert.ok(t.includes("R$ 3.894,46"), t);
});

test("a ordem das linhas e a que a secao recebeu", () => {
  // As duas secoes tem ordem deliberadamente OPOSTA (`secoesDaTela`), e
  // reagrupar por categoria quebraria isso para ganhar o que o icone ja da.
  const t = texto(
    render({
      linhas: [
        linha({ id: "a", descricao: "Primeira" }),
        linha({ id: "b", descricao: "Segunda" }),
        linha({ id: "c", descricao: "Terceira" }),
      ],
    })
  );

  assert.ok(
    t.indexOf("Primeira") < t.indexOf("Segunda") &&
      t.indexOf("Segunda") < t.indexOf("Terceira"),
    t
  );
});

test("os outros rotulos da linha continuam la", () => {
  const t = texto(
    render({
      linhas: [
        linha({ moeda: "USD", situacao: "overdue", descricao: "Assinatura" }),
      ],
    })
  );

  assert.ok(t.includes("Assinatura"), t);
  assert.ok(t.includes("· 14/08"), t);
  assert.ok(t.includes("· Alimentação"), t);
  assert.ok(t.includes("· de Itaú"), t);
  assert.ok(t.includes("· USD"), t);
  assert.ok(t.includes("vencida"), t);
});

test("carregando, a lista sai da tela -- e nenhum rotulo de natureza fica", () => {
  // O vazio nao pode piscar como lista, e a lista nao pode piscar como vazio.
  const t = texto(render({ linhas: [FATURA], carregando: true }));

  assert.ok(!t.includes("fatura de cartão"), t);
  assert.ok(t.includes("Carregando"), t);
});

test("secao vazia diz a frase que recebeu, e nao R$ 0,00", () => {
  const t = texto(render({ linhas: [] }));

  assert.ok(t.includes("Nada previsto neste período."), t);
  assert.ok(!t.includes("R$ 0,00"), t);
});
