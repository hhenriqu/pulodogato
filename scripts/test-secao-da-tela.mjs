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
import {
  ArrowRightLeft,
  CreditCard,
  Repeat,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { SecaoDaTela } from "../.tmp-secao-da-tela/components/movimentacoes/SecaoDaTela.js";
// A FUNCAO DE PRODUCAO, e nao um esboco de `hrefDeEdicao` escrito aqui: e ela
// que decide que a linha realizada vira link e a prevista nao, e um esboco faria
// as assercoes do `href` medirem a propria sonda.
import {
  ROTULO_DE_PAGAR,
  caminhoDeEdicao,
  rotuloDeConfirmar,
} from "../.tmp-secao-da-tela/lib/acoes-da-linha.js";

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
  // A linha e MINHA no caso base (HMO-301). Sem isto, a secao desenharia sem
  // botao nenhum em toda assercao desta suite -- que e o estado de antes da
  // issue, e deixaria os blocos novos passando por vacuidade.
  posso_editar: true,
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
  posso_editar: false,
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

/**
 * As acoes, com as FUNCOES de producao onde elas decidem algo.
 *
 * `hrefDeEdicao` chama `caminhoDeEdicao` de verdade; os tres `on*` sao vazios
 * porque `react-dom/server` nunca os chama -- o clique e medido em Chromium
 * (`npm run test:lista-na-tela`). O que ESTA suite mede e QUAIS botoes saem no
 * HTML, e para onde o unico que tem destino aponta.
 */
const ACOES = (extra = {}) => ({
  hrefDeEdicao: (l) => caminhoDeEdicao(l, "/dashboard/movimentacoes/despesa", null),
  aoEditar: () => {},
  aoExcluir: () => {},
  aoConfirmar: () => {},
  aoPagarFatura: () => {},
  agindo: null,
  online: true,
  ...extra,
});

/** A fatura ABERTA, mas MINHA -- o caso do botao Pagar (HMO-311). */
const FATURA_MINHA = { ...FATURA, posso_editar: true };

/** A fatura FECHADA da agenda: gravada, minha, com id de banco. */
const FATURA_FECHADA = {
  ...FATURA,
  id: "s-fatura",
  gravada: true,
  posso_editar: true,
};

/**
 * Sabor 3: a previsao DIGITADA que alguem ligou a fatura (o elo da HMO-305).
 *
 * `elo_da_fatura` preenchido e o que a distingue da fechada, e e so por ele que
 * esta suite pode medir a diferenca que importa na marcacao: ela NAO leva o nome
 * do cartao como link -- ela e uma previsao na conta corrente, nao a fatura.
 */
const PREVISAO_COM_ELO = {
  ...FATURA_FECHADA,
  id: "s-previsao",
  descricao: "Cartão Nubank",
  elo_da_fatura: { accountId: CARTAO, mes: "2026-08-01" },
};

/**
 * ALGUM `<button>` ESTA DENTRO DE UM `<a>`? -- o controle do aninhamento (HMO-311).
 *
 * Ate esta fase a linha de fatura era uma ancora INTEIRA, e era essa ancora uma
 * das duas razoes pelas quais ela nao ganhava botao: botao dentro de `<a>` e
 * aninhamento interativo invalido, e o clique faria AS DUAS COISAS -- abriria o
 * dialogo E navegaria para a tela do cartao. Com as duas acontecendo,
 * "funcionou" e indistinguivel do defeito.
 *
 * E A ASSERCAO NAO PODE SER "nao ha `<a>` na linha": o nome do cartao CONTINUA
 * sendo um link, de proposito. O que nao pode e o botao estar dentro dele. Daí
 * a contagem de profundidade, e nao um `includes`.
 */
const botaoDentroDeAncora = (html) => {
  let profundidade = 0;
  for (const [, fecha, tag] of html.matchAll(/<(\/?)(a|button)\b[^>]*>/g)) {
    if (tag === "a") profundidade += fecha ? -1 : 1;
    else if (!fecha && profundidade > 0) return true;
  }
  return false;
};

/** A de Transferencias -- o TERCEIRO verbo da baixa (HMO-301). */
const TRANSFERENCIAS = {
  Icone: ArrowRightLeft,
  cor: "text-info",
  rotaDeLancar: "/dashboard/movimentacoes/transferencia",
  textoDeLancar: "Nova Transferência",
  palavraDaLinha: "Transferência",
};

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
      acoes: ACOES(),
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

test("o NOME DO CARTAO e o link para o cartao DELA -- e a linha nao e mais <a>", () => {
  // ATE A HMO-311 A LINHA INTEIRA ERA A ANCORA. A troca e por dois alvos
  // explicitos no lugar de um implicito, porque e a ancora da linha que impedia
  // o botao Pagar de existir (aninhamento interativo invalido).
  const html = render({ linhas: [FATURA] });
  const destino = href(html);

  assert.ok(destino, "o nome do cartao nao virou link");
  assert.ok(destino.startsWith(`/dashboard/cartoes/${CARTAO}`), destino);

  // O LINK ESTA NO NOME, e nao na linha: a ancora envolve o texto da descricao
  // e NAO o valor da linha, que e o ultimo elemento dela. Sem esta metade, a
  // assercao de cima continuaria verde com a linha inteira sendo `<a>`.
  const ancora = /<a\b[^>]*>([\s\S]*?)<\/a>/.exec(html);
  assert.ok(ancora, html);
  assert.equal(texto(ancora[1]), "Fatura Nubank");
  assert.ok(
    !ancora[1].includes("1.234,56"),
    `a ancora engoliu o valor da linha: ${ancora[1]}`
  );
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
  // A sequencia inteira, e nao quatro `includes` soltos: na linha comum o
  // icone e o unico vizinho a esquerda da data, e por isso a data NAO leva o
  // `·` ali -- um separador pendurado se le como campo que faltou carregar.
  assert.ok(t.includes("14/08 · Alimentação · de Itaú · USD"), t);
  assert.ok(!t.includes("· 14/08"), t);
  assert.ok(t.includes("vencida"), t);
});

test("com rotulo, a data leva o separador; sem rotulo, nao", () => {
  const comRotulo = texto(render({ linhas: [FIXA] }));
  assert.ok(comRotulo.includes("fixo · 14/08"), comRotulo);

  const semRotulo = texto(render({ linhas: [linha({})] }));
  assert.ok(semRotulo.includes("14/08 · Alimentação"), semRotulo);
  assert.ok(!semRotulo.includes("· 14/08"), semRotulo);
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

// ---------------------------------------------------------------------------
// 5. OS TRES BOTOES, POR ESTADO DE LINHA (HMO-301)
// ---------------------------------------------------------------------------
// "E em ambos os modos verificar pois todos lancamentos devem ter botoes de
// editar, excluir ou confirmar pra validar que foi pago ou recebido."
//
// A regra de QUAIS botoes mora em `lib/acoes-da-linha.ts`, e tem suite propria
// (`npm run test:acoes-da-linha`) com 34 blocos. O que NAO esta provado la e que
// a marcacao LEIA a regra: `podeConfirmar` pode devolver `true` para toda conta
// prevista e a linha sair sem botao nenhum -- sem erro, sem build vermelho e sem
// mexer um centavo. E a mesma familia da HMO-287: dado certo chegando num JSX
// que nao o le.
//
// O que se afirma aqui e o `aria-label` de cada botao, e ele NAO e uma
// concessao: os tres botoes sao de icone so (como em Contas a Pagar e na lista
// de Financas Pessoais), entao o `aria-label` E o rotulo -- e o unico texto que
// existe deles na tela.

/** Os `aria-label` de todos os `<button>`/`<a>` de acao do HTML, na ordem. */
const rotulosDeAcao = (html) =>
  [...html.matchAll(/<(?:button|a)\b[^>]*\baria-label="([^"]*)"/g)].map(
    (m) => m[1]
  );

/**
 * Os `aria-label` dos botoes DESABILITADOS.
 *
 * O FILTRO E PELO ATRIBUTO `disabled=""`, e nao por `tag.includes("disabled")`.
 * Medido: a classe que `components/ui/button.tsx` emite em TODO botao contem
 * `disabled:pointer-events-none disabled:opacity-50` -- entao o `includes`
 * casava com o nome da variante do Tailwind e devolvia TODOS os botoes como
 * desabilitados. Duas assercoes desta suite passaram verde por isso, inclusive
 * uma que afirmava o CONTRARIO do que media.
 *
 * E o mesmo defeito que a funcao `texto` acima existe para evitar, do outro
 * lado: uma assercao que casa com o enfeite em volta do que ela diz medir.
 */
const desabilitados = (html) =>
  [...html.matchAll(/<button\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => / disabled=""/.test(tag))
    .map((tag) => /aria-label="([^"]*)"/.exec(tag)?.[1] ?? "(sem rotulo)");

test("CONTROLE da sonda: botao habilitado nao conta como desabilitado", () => {
  // A classe de TODO botao deste app contem `disabled:pointer-events-none` --
  // uma peneira por `includes("disabled")` devolveria a lista inteira, e as duas
  // assercoes de travamento abaixo passariam verde medindo o nome de uma
  // variante do Tailwind. Este bloco e o que mantem `desabilitados` honesta.
  const html = render({ linhas: [linha({})] });

  assert.ok(html.includes("disabled:"), "a classe do Button mudou -- rever a sonda");
  assert.deepEqual(desabilitados(html), []);
  assert.equal(rotulosDeAcao(html).length, 3, "o caso base precisa dos tres botoes");
});

test("a conta prevista minha ganha os TRES botoes", () => {
  // O CONTROLE POSITIVO de todo bloco negativo abaixo. Sem ele, uma secao que
  // nunca desenhasse botao nenhum passaria em cada `deepEqual([])` seguinte.
  const html = render({ linhas: [linha({})] });

  assert.deepEqual(rotulosDeAcao(html), [
    "Confirmar pagamento",
    "Editar",
    "Excluir",
  ]);
});

test("'pago ou recebido' sao DOIS rotulos, e cada tela usa o seu", () => {
  // A rota da baixa e a mesma; o texto segue a direcao da linha. Um rotulo so
  // faria metade das telas mentir -- "Confirmar pagamento" embaixo de um
  // salario previsto e um verbo errado sobre um numero certo.
  const daDespesa = rotulosDeAcao(render({ linhas: [linha({})] }));
  const daReceita = rotulosDeAcao(
    render({
      linhas: [linha({ tipo: "income", descricao: "Salário" })],
      aparencia: RECEITAS,
    })
  );

  assert.ok(daDespesa.includes("Confirmar pagamento"), daDespesa.join(" | "));
  assert.ok(daReceita.includes("Confirmar recebimento"), daReceita.join(" | "));

  // AS DUAS METADES: o texto certo PRESENTE e o da outra tela AUSENTE. So a
  // primeira passaria verde com um rotulo unico escrito nos dois lugares.
  assert.ok(!daDespesa.includes("Confirmar recebimento"));
  assert.ok(!daReceita.includes("Confirmar pagamento"));

  // E o texto vem da LIB, nao de uma string escrita neste teste: igual aos dois
  // lados, a assercao sobreviveria a um rotulo trocado nos dois de uma vez.
  assert.ok(daDespesa.includes(rotuloDeConfirmar("expense")));
  assert.ok(daReceita.includes(rotuloDeConfirmar("income")));
});

test("a tela de Transferencias tambem tem o seu verbo", () => {
  const rotulos = rotulosDeAcao(
    render({
      linhas: [linha({ tipo: "transfer", descricao: "Itaú → Nubank" })],
      aparencia: TRANSFERENCIAS,
    })
  );

  assert.ok(rotulos.includes("Confirmar transferência"), rotulos.join(" | "));
  assert.ok(!rotulos.includes("Confirmar pagamento"));
});

test("a linha REALIZADA nao tem Confirmar -- e continua com os outros dois", () => {
  // Confirmar o que ja aconteceu gravaria a SEGUNDA PERNA do mesmo dinheiro.
  // A segunda metade importa igual: tirar os tres botoes da realizada deixaria
  // metade da tela sem acao, e passaria no `!includes("Confirmar")`.
  const rotulos = rotulosDeAcao(
    render({ linhas: [linha({ origem: "realizado", status: null })] })
  );

  assert.deepEqual(rotulos, ["Editar", "Excluir"]);
});

test("a fatura aberta de OUTRO MEMBRO nao tem botao NENHUM", () => {
  // `FATURA` e de outro membro (`posso_editar: false`). Nem a baixa generica
  // (ela nao tem `scheduled_transactions.id`, e a baixa com id inventado
  // responde 404) nem o Pagar da HMO-311: a RLS recusaria a escrita, e **UPDATE
  // filtrado pela RLS volta 200 sem alterar nada**.
  const html = render({ linhas: [FATURA] });

  assert.deepEqual(rotulosDeAcao(html), []);
  assert.ok(!html.includes("<button"), "a fatura alheia desenhou botao");
  // E ela CONTINUA levando ao cartao pelo nome -- ler nao e escrever.
  assert.ok(href(html), "a fatura perdeu o link para o cartao");
});

// ---------------------------------------------------------------------------
// 5b. O BOTAO PAGAR NA LINHA DA FATURA (HMO-311, fase 14)
// ---------------------------------------------------------------------------
// "Precisa colocar o botao de pagar tbm na fatura do cartao em despesas."
//
// `npm run test:acoes-da-linha` prova a REGRA (`podePagarAFatura`). O que esta
// secao mede e que a MARCACAO a leia -- e sobretudo o aninhamento: enquanto a
// linha fosse `<a>`, o clique no botao faria as duas coisas.

test("a fatura ABERTA minha ganha o botao Pagar -- e so ele", () => {
  // O CONTROLE POSITIVO desta secao. E a fatura aberta e `gravada: false`: um
  // botao gateado por `gravada` deixaria justamente a maior fonte do «Previsto»
  // de fora, e todos os blocos negativos abaixo passariam verde.
  const html = render({ linhas: [FATURA_MINHA] });

  assert.deepEqual(rotulosDeAcao(html).filter((r) => r !== ""), [
    ROTULO_DE_PAGAR,
  ]);
  // E o rotulo esta ESCRITO na tela, nao so no `aria-label`: este e o unico
  // botao da linha com texto, porque o verbo e o que diz que o clique abre uma
  // pergunta em vez de ja resolver.
  assert.ok(texto(html).includes("Pagar"), texto(html));
  assert.deepEqual(desabilitados(html), []);
});

test("O ANINHAMENTO: o botao Pagar NAO esta dentro do link do cartao", () => {
  // A assercao que fecha a razao pela qual este botao nao existia. Com a linha
  // sendo `<a>`, o clique abriria o dialogo E navegaria para a tela do cartao --
  // e "funcionou" seria indistinguivel do defeito.
  const html = render({ linhas: [FATURA_MINHA] });

  assert.ok(href(html), "o controle nao vale: nao ha link nenhum na linha");
  assert.ok(html.includes("<button"), "o controle nao vale: nao ha botao");
  assert.equal(botaoDentroDeAncora(html), false, html);
});

test("CONTROLE da sonda do aninhamento: ela SABE achar botao dentro de <a>", () => {
  // Sem este bloco, `botaoDentroDeAncora` poderia devolver `false` sempre -- e a
  // assercao acima passaria verde medindo nada. A entrada e HTML escrito a mao,
  // de proposito: o que esta sob teste aqui e a sonda, nao o componente.
  assert.equal(botaoDentroDeAncora('<a href="/x"><button>Pagar</button></a>'), true);
  assert.equal(botaoDentroDeAncora('<a href="/x">nome</a><button>Pagar</button>'), false);
});

test("a fatura FECHADA da agenda tambem ganha Pagar, e leva ao cartao pelo nome", () => {
  const html = render({ linhas: [FATURA_FECHADA] });

  assert.deepEqual(rotulosDeAcao(html).filter((r) => r !== ""), [
    ROTULO_DE_PAGAR,
  ]);
  // Editar e Excluir continuam FORA (regra 5 de acoes-da-linha): a fatura nao se
  // edita nem se apaga por aqui.
  assert.ok(!rotulosDeAcao(html).includes("Editar"), html);
  assert.ok(!rotulosDeAcao(html).includes("Excluir"), html);
  assert.equal(href(html), `/dashboard/cartoes/${CARTAO}?mes=2026-08`);
  assert.equal(botaoDentroDeAncora(html), false, html);
});

test("a previsao LIGADA AO ELO ganha Pagar e NAO ganha o link do cartao", () => {
  // O sabor 3, e a unica diferenca de marcacao entre ele e a fatura fechada. A
  // razao e da HMO-305: ela e uma previsao na CONTA CORRENTE, nao a fatura em si
  // -- o link mora na linha DA fatura, que esta na mesma lista.
  const html = render({ linhas: [PREVISAO_COM_ELO] });

  assert.deepEqual(rotulosDeAcao(html).filter((r) => r !== ""), [
    ROTULO_DE_PAGAR,
  ]);
  assert.equal(href(html), null, `a previsao ligada virou link: ${html}`);
  // E A LINHA CONTINUA LA, com o nome: perder o link nao e perder a linha.
  assert.ok(texto(html).includes("Cartão Nubank"), texto(html));
});

test("Pagar NAO brota em Receitas nem em Transferencias", () => {
  // A mesma `SecaoDaTela` serve as tres telas. Nenhuma linha de receita carrega
  // a chave canonica da fatura, entao o criterio (`natureza`) ja as exclui -- e
  // este bloco e o que denuncia um criterio trocado por "a linha tem rotulo",
  // que pegaria tambem a conta fixa das tres telas.
  for (const [aparencia, tipo] of [
    [RECEITAS, "income"],
    [TRANSFERENCIAS, "transfer"],
  ]) {
    const html = render({
      linhas: [linha({ tipo, natureza: "fixa", descricao: "Salário" }), FIXA],
      aparencia,
    });
    assert.ok(
      !rotulosDeAcao(html).includes(ROTULO_DE_PAGAR),
      `${tipo} ganhou Pagar: ${rotulosDeAcao(html).join(" | ")}`
    );
    assert.ok(!texto(html).includes("Pagar"), texto(html));
  }
});

test("durante uma acao o Pagar da fatura TRAVA junto", () => {
  // Dois cliques seriam duas baixas, e a segunda volta 409 depois de a primeira
  // ter dado certo: a tela mostraria um erro em cima de uma operacao que
  // funcionou. O `agindo` e o id da linha -- aqui ele e de OUTRA linha, e o
  // travamento vale para a secao inteira de proposito.
  const html = render({
    linhas: [FATURA_MINHA],
    acoes: ACOES({ agindo: "outra-linha" }),
  });

  assert.deepEqual(desabilitados(html), [ROTULO_DE_PAGAR]);
});

test("sem rede o Pagar da fatura trava -- a baixa e escrita", () => {
  const html = render({
    linhas: [FATURA_MINHA],
    acoes: ACOES({ online: false }),
  });

  assert.deepEqual(desabilitados(html), [ROTULO_DE_PAGAR]);
});

test("a linha de OUTRO membro do grupo nao tem Excluir -- nem os outros dois", () => {
  // A RLS recusaria a escrita, e `UPDATE` recusado pela RLS volta **200 sem
  // alterar nada**: o app diria "pronto" e a linha ficaria. Botao que aparece e
  // nao funciona e pior que botao ausente.
  const html = render({ linhas: [linha({ posso_editar: false })] });

  assert.deepEqual(rotulosDeAcao(html), []);
  assert.ok(!html.includes("Excluir"), html);
  // A LINHA FICA, com o valor: `posso_editar` decide botao, nao soma.
  assert.ok(texto(html).includes("Mercado"), texto(html));
  assert.ok(texto(html).includes("R$ 159,90"), texto(html));
});

test("a fatura FECHADA nao tem Confirmar, Editar nem Excluir -- so o Pagar", () => {
  // Os dois motivos da regra 5 continuam valendo para a baixa GENERICA: ela
  // exige a conta pagadora no corpo, e um "Confirmar pagamento" reaproveitado
  // erraria em todo clique. O que a HMO-311 acrescentou foi um destino PROPRIO,
  // nao uma excecao dentro de `podeAgirNaLinha` -- e e por isso que os tres
  // rotulos de la continuam ausentes aqui.
  const html = render({ linhas: [FATURA_FECHADA] });
  const rotulos = rotulosDeAcao(html).filter((r) => r !== "");

  assert.ok(!rotulos.includes("Confirmar pagamento"), rotulos.join(" | "));
  assert.ok(!rotulos.includes("Editar"), rotulos.join(" | "));
  assert.ok(!rotulos.includes("Excluir"), rotulos.join(" | "));
  assert.deepEqual(rotulos, [ROTULO_DE_PAGAR]);
});

test("a transferencia REALIZADA tem o Editar APAGADO, com o motivo no title", () => {
  // Abrir uma perna na tela de despesa deixaria a outra ORFA: o saldo passaria a
  // somar sozinho pelo valor inteiro, sem nada parecendo errado. Botao cinza sem
  // explicacao e indistinguivel de tela quebrada, e a pessoa tenta de novo.
  const html = render({
    linhas: [
      linha({ origem: "realizado", tipo: "transfer", descricao: "Itaú → Nubank" }),
    ],
    aparencia: TRANSFERENCIAS,
  });

  assert.deepEqual(rotulosDeAcao(html), ["Editar", "Excluir"]);
  assert.deepEqual(desabilitados(html), ["Editar"]);
  assert.match(html, /title="[^"]*duas pernas[^"]*"/);

  // E a PREVISTA da mesma tela NAO fica apagada: ela e UMA linha com as duas
  // contas dentro, e o PATCH mexe nessa linha so.
  const prevista = render({
    linhas: [linha({ tipo: "transfer" })],
    aparencia: TRANSFERENCIAS,
  });
  assert.deepEqual(desabilitados(prevista), []);
});

test("o Editar da linha realizada e um <a> com o `?id=` dela", () => {
  // `caminhoDeEdicao` de producao monta o destino; a secao so tem de usa-lo.
  // Um `<button>` ali nao navegaria para lugar nenhum.
  const html = render({
    linhas: [linha({ id: "t7", origem: "realizado", status: null })],
  });

  const destino = href(html);
  assert.ok(destino, "o Editar da realizada nao virou link");
  assert.equal(destino, "/dashboard/movimentacoes/despesa?id=t7");
});

test("o Editar da conta PREVISTA e botao, nao link -- ela nao tem tela de edicao", () => {
  // `?id=` do formulario completo le `financial_transactions`; uma conta
  // prevista nao esta la, e o link abriria um formulario VAZIO cujo Salvar
  // criaria um lancamento novo.
  const html = render({ linhas: [linha({})] });

  assert.equal(href(html), null, "o Editar da prevista virou link");
  assert.ok(rotulosDeAcao(html).includes("Editar"));
});

test("durante uma acao os tres botoes DAQUELA secao travam, e o da linha gira", () => {
  // Dois cliques em Confirmar seriam duas baixas, e a segunda volta 409 DEPOIS
  // de a primeira ter dado certo: a tela mostraria um erro em cima de uma
  // operacao que funcionou.
  const html = render({
    linhas: [linha({ id: "l1" }), linha({ id: "l2", descricao: "Luz" })],
    acoes: ACOES({ agindo: "l1" }),
  });

  // Seis botoes (tres por linha), todos travados: a segunda linha tambem, porque
  // uma segunda acao em paralelo chegaria no meio da releitura da primeira.
  assert.equal(desabilitados(html).length, 6, desabilitados(html).join(" | "));

  // E a linha que esta agindo mostra o giro. `animate-spin` e a unica marca do
  // Loader2 que sobrevive ao HTML (a forma do `<path>` do lucide muda num
  // upgrade do pacote sem nada estar errado).
  assert.match(html, /animate-spin/);
});

test("sem rede os botoes travam -- escrita offline FALHA, nao fica pendente", () => {
  const html = render({ linhas: [linha({})], acoes: ACOES({ online: false }) });

  assert.deepEqual(desabilitados(html), [
    "Confirmar pagamento",
    "Editar",
    "Excluir",
  ]);
  // O giro NAO aparece: nada esta em curso. Um spinner aqui prometeria que o
  // app esta tentando.
  assert.ok(!html.includes("animate-spin"), html);
});

test("a secao carregando nao desenha botao nenhum", () => {
  const html = render({ linhas: [linha({})], carregando: true });

  assert.deepEqual(rotulosDeAcao(html), []);
  assert.ok(!html.includes("<button"), html);
});

test("cada linha ganha os botoes DELA -- nao os da primeira", () => {
  // Tres estados na MESMA secao. Um `podeConfirmar` avaliado uma vez para a
  // secao inteira (ou sobre a primeira linha) passaria em cada bloco de uma
  // linha so acima.
  const html = render({
    linhas: [
      linha({ id: "a", descricao: "Prevista" }),
      linha({ id: "b", descricao: "Realizada", origem: "realizado", status: null }),
      linha({ id: "c", descricao: "Alheia", posso_editar: false }),
      FATURA,
    ],
  });

  assert.deepEqual(rotulosDeAcao(html), [
    // a: prevista minha -- os tres
    "Confirmar pagamento",
    "Editar",
    "Excluir",
    // b: realizada minha -- dois
    "Editar",
    "Excluir",
    // c e a fatura -- nenhum
  ]);
});
