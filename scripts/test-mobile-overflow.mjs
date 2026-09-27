#!/usr/bin/env node
// =====================================================
// PULODOGATO - scroll horizontal no celular (HMO-168)
// =====================================================
//   npm run test:mobile-overflow
//
// O QUE FOI MEDIDO
// ----------------
// Em producao, logado, com Chromium headless em viewport de celular (390x780 e
// 320x780), oito das vinte e tres rotas do painel tinham
// `document.documentElement.scrollWidth > clientWidth` -- a pagina inteira
// andava para o lado. Era a mesma familia do que o Helio achou a mao na HMO-160
// (os dois botoes da home) e na HMO-161 (o X do menu).
//
// Nao eram oito bugs, eram DOIS, e e por isso que este arquivo tem tao poucos
// casos para tanta rota:
//
//   1. linha de acao no cabecalho que nao quebra -- transactions,
//      personal-finance, expense-groups, investments, trading, reports;
//   2. `TabsList` que nao rola nem quebra -- reports, budgets, calculators.
//
// POR QUE ESTE TESTE LE CLASSES E NAO PIXELS
// ------------------------------------------
// Nao ha navegador no CI deste repositorio, e a medicao que achou o defeito
// depende de credencial de producao. Entao aqui nao se afirma geometria: se
// afirma o MECANISMO que produz a geometria -- as classes que fazem a linha
// quebrar e a barra de abas rolar. E um piso contra a regressao exata, nao uma
// prova de que a tela cabe.
//
// A consequencia pratica: se alguem adicionar uma terceira acao no cabecalho e
// estourar 320px de novo, este teste continua verde. O que ele impede e o
// caminho de volta -- alguem "limpar" as classes e reintroduzir o vazamento sem
// que nada apareca, que e exatamente o que aconteceu por meses.
//
// A ARMADILHA DO `space-x-*`
// --------------------------
// `space-x-2` parece espacamento e nao e: vira `> * + * { margin-left }`. Na
// quebra de linha o item que desce leva a margem presa nele (bordas esquerdas
// desalinhadas) e entre as duas linhas nao sobra espaco nenhum. Foi o defeito
// literal da HMO-160. Por isso as linhas de acao aqui sao exigidas com `gap-*`,
// e `space-x-*` nelas e reprovado.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.join(import.meta.dirname, "..");

const TABS = "components/ui/tabs.tsx";
const GUARD_PREMIUM = "components/subscription/SoftFeatureGuard.tsx";
const FINANCAS = "app/(dashboard)/dashboard/personal-finance/page.tsx";
const GRUPOS = "app/(dashboard)/dashboard/expense-groups/page.tsx";

/**
 * Le o arquivo SEM comentarios.
 *
 * Isto nao e higiene, e correcao: os alvos aqui sao achados por marcador de
 * texto ("Entrar no Grupo", "Ver Planos Premium"), e o conserto da HMO-168
 * deixou em cada lugar um comentario que CITA esses mesmos textos. Lendo o
 * arquivo cru, o marcador casava dentro do comentario -- varias linhas acima do
 * `<div>` de verdade -- e o teste media a caixa errada. Reprovou codigo correto
 * na primeira execucao.
 *
 * Os comentarios saem substituidos por espacos para nao juntar linhas que eram
 * separadas.
 */
function ler(relativo) {
  const cru = fs.readFileSync(path.join(RAIZ, relativo), "utf8");

  return cru
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (bloco) => " ".repeat(bloco.length))
    .replace(/\/\*[\s\S]*?\*\//g, (bloco) => " ".repeat(bloco.length))
    .replace(/^[ \t]*\/\/.*$/gm, (linha) => " ".repeat(linha.length));
}

/**
 * As classes base do `TabsList`: o primeiro literal dentro do `cn(` que vem
 * depois da definicao do componente.
 *
 * Ancorado em `TabsPrimitive.List` de proposito -- se o componente for
 * reescrito com outra primitiva, isto devolve null e o caso fica vermelho, em
 * vez de passar verde por nao ter achado nada.
 */
function classesBaseDoTabsList(fonte) {
  const inicio = fonte.indexOf("const TabsList");
  if (inicio === -1) return null;

  const trecho = fonte.slice(inicio);
  if (!trecho.includes("TabsPrimitive.List")) return null;

  const m = trecho.match(/cn\(\s*"([^"]*)"/);
  return m ? m[1] : null;
}

/** Todo `<TabsList ...>` do app, com o className que ele passa (ou ""). */
function chamadasDeTabsList() {
  const alvos = [];
  const raizes = ["app", "components"];

  const anda = (dir) => {
    for (const nome of fs.readdirSync(dir, { withFileTypes: true })) {
      const caminho = path.join(dir, nome.name);
      if (nome.isDirectory()) anda(caminho);
      else if (/\.tsx$/.test(nome.name)) {
        const fonte = fs.readFileSync(caminho, "utf8");
        for (const m of fonte.matchAll(/<TabsList([^>]*)>/g)) {
          const cls = m[1].match(/className="([^"]*)"/);
          alvos.push({
            arquivo: path.relative(RAIZ, caminho),
            classes: cls ? cls[1] : "",
          });
        }
      }
    }
  };

  for (const r of raizes) anda(path.join(RAIZ, r));
  return alvos;
}

/**
 * O `<div className="...">` que ENVOLVE o cabecalho de uma tela: o penultimo
 * div aberto antes do `<h1>` do titulo.
 *
 * A forma do cabecalho nas duas telas e sempre a mesma:
 *
 *     <div className="...">            <- o container (o que interessa)
 *       <div className="space-y-1">    <- titulo + subtitulo
 *         <h1 ...>Titulo</h1>
 *
 * Devolve null se o titulo nao existir, para que a falta do alvo apareca como
 * caso vermelho.
 */
function containerDoCabecalho(fonte, titulo) {
  const fimTitulo = fonte.indexOf(titulo);
  if (fimTitulo === -1) return null;

  const antes = fonte.slice(0, fimTitulo);
  const aberturas = [...antes.matchAll(/<div className="([^"]*)"/g)];
  if (aberturas.length < 2) return null;

  return aberturas[aberturas.length - 2][1];
}

/**
 * A linha de acao: o `<div className="...">` mais proximo ANTES de um marcador
 * que so existe dentro dela (o texto de um dos botoes, por exemplo).
 */
function linhaDeAcao(fonte, marcador) {
  const i = fonte.indexOf(marcador);
  if (i === -1) return null;

  const aberturas = [...fonte.slice(0, i).matchAll(/<div className="([^"]*)"/g)];
  return aberturas.length ? aberturas[aberturas.length - 1][1] : null;
}

// -----------------------------------------------------------------
// Padrao 2: a barra de abas
// -----------------------------------------------------------------

test("TabsList fica presa na largura do pai e rola por dentro", () => {
  const base = classesBaseDoTabsList(ler(TABS));

  assert.ok(
    base,
    "nao achei as classes base do TabsList em " +
      TABS +
      " -- o componente foi reescrito e este teste precisa ser reescrito com ele",
  );

  assert.match(
    base,
    /\bmax-w-full\b/,
    "sem `max-w-full` a barra de abas tem a largura do CONTEUDO (cinco abas de " +
      "relatorio = 496px) e vaza para fora da viewport, levando a pagina com ela",
  );
  assert.match(
    base,
    /\boverflow-x-auto\b/,
    "`max-w-full` sozinho corta as abas de fora; `overflow-x-auto` e o que move " +
      "a rolagem para DENTRO da barra, em vez da pagina",
  );
});

test("TabsList alinha as abas a esquerda, senao a primeira fica inalcancavel", () => {
  const base = classesBaseDoTabsList(ler(TABS));

  assert.doesNotMatch(
    base,
    /\bjustify-center\b/,
    "com `justify-center` o conteudo que estoura sobra dos DOIS lados e a parte " +
      "da esquerda nao tem como ser alcancada -- nao existe scroll negativo. " +
      "Enquanto a barra cabe, `justify-start` e indistinguivel dela.",
  );
  assert.match(base, /\bjustify-start\b/);
});

test("nenhuma tela passa overflow proprio para o TabsList", () => {
  const chamadas = chamadasDeTabsList();

  assert.ok(
    chamadas.length >= 8,
    `esperava achar as barras de abas do painel e achei ${chamadas.length} -- ` +
      "se a busca parou de encontrar os call sites, os casos abaixo passam sem olhar nada",
  );

  for (const { arquivo, classes } of chamadas) {
    assert.doesNotMatch(
      classes,
      /\boverflow-/,
      `${arquivo} passa uma classe de overflow para o TabsList. O cn() usa ` +
        "tailwind-merge: a classe da chamada VENCE a da base, e o conserto da " +
        "HMO-168 fica desligado so nessa tela, sem aviso nenhum.",
    );
  }
});

// -----------------------------------------------------------------
// Padrao 1: a linha de acao do cabecalho
// -----------------------------------------------------------------

test("Financas Pessoais: cabecalho empilha no celular", () => {
  const fonte = ler(FINANCAS);
  const container = containerDoCabecalho(fonte, "Finanças Pessoais");

  assert.ok(container, "nao achei o cabecalho de " + FINANCAS);
  assert.match(
    container,
    /\bflex-col\b/,
    "o selo do plano + `Novo Lançamento` medem 257px: ao lado do titulo nao " +
      "existe largura de celular que caiba. Abaixo de `sm` eles tem que descer.",
  );
  assert.match(
    container,
    /\bsm:flex-row\b/,
    "e de `sm` para cima tem que voltar para a mesma linha -- a tela larga nao " +
      "tinha defeito nenhum",
  );
});

test("Financas Pessoais: a linha de acao quebra, e com gap", () => {
  const fonte = ler(FINANCAS);
  // `<PlanBadge` com o sinal de menor: o nome sozinho casa primeiro no import,
  // que fica antes de qualquer <div> do arquivo.
  const linha = linhaDeAcao(fonte, "<PlanBadge");

  assert.ok(linha, "nao achei a linha de acao de " + FINANCAS);
  assert.match(linha, /\bflex-wrap\b/);
  assert.match(linha, /\bgap-\d/);
  assert.doesNotMatch(
    linha,
    /\bspace-x-/,
    "`space-x-*` nao e gap: na quebra de linha ele desalinha as bordas e nao " +
      "deixa espaco vertical (foi o defeito da HMO-160)",
  );
});

test("Grupos de Despesas: cabecalho empilha e os dois botoes quebram", () => {
  const fonte = ler(GRUPOS);
  const container = containerDoCabecalho(fonte, "Grupos de Despesas");
  const linha = linhaDeAcao(fonte, "Entrar no Grupo");

  assert.ok(container, "nao achei o cabecalho de " + GRUPOS);
  assert.ok(linha, "nao achei a linha de acao de " + GRUPOS);

  assert.match(container, /\bflex-col\b/);
  assert.match(container, /\bsm:flex-row\b/);
  assert.match(
    linha,
    /\bflex-wrap\b/,
    '"Entrar no Grupo" + "Criar Grupo" somam 312px -- praticamente a largura ' +
      "inteira de um aparelho de 320px",
  );
  assert.doesNotMatch(linha, /\bspace-x-/);
});

// -----------------------------------------------------------------
// Padrao 3: o trilho de grid que cresce em vez de apertar
// -----------------------------------------------------------------
// Achado ao medir o conserto dos outros dois: as calculadoras vazavam em 320px
// e nao era nem cabecalho nem aba.
//
// `grid` sem nenhum `grid-cols-*` de base cria uma coluna implicita `auto`, e
// trilho `auto` tem o min-content do conteudo como PISO. Dois campos lado a
// lado ("Taxa de juros" + "Periodo da taxa") tem min-content de 364px, entao o
// trilho ficava com 364px dentro de um container de 288px -- medido no
// navegador, em producao. `grid-cols-1` e `repeat(1, minmax(0,1fr))`, e o
// `minmax(0, ...)` e exatamente a remocao desse piso.
//
// Este caso cobre as telas onde isso foi MEDIDO. Existem ~30 grids no app sem
// `grid-cols-*` de base e a maioria nao vaza, porque depende do min-content do
// que esta dentro -- reprovar todas elas seria trocar um defeito real por
// trinta mudancas sem sintoma.
test("calculadoras: o grid de cada calculadora aperta em vez de crescer", () => {
  const fonte = ler("app/(dashboard)/dashboard/calculators/page.tsx");
  const grids = [...fonte.matchAll(/className="([^"]*\bgrid\b[^"]*)"/g)].map(
    (m) => m[1],
  );

  const deDuasColunas = grids.filter((c) => /\blg:grid-cols-2\b/.test(c));

  assert.equal(
    deDuasColunas.length,
    4,
    "esperava os quatro grids das quatro calculadoras (juros, 13o, ferias, " +
      `FGTS) e achei ${deDuasColunas.length} -- se a tela foi reescrita, este ` +
      "caso precisa ser reescrito com ela em vez de continuar verde",
  );

  for (const classes of deDuasColunas) {
    assert.match(
      classes,
      /(^|\s)grid-cols-1(\s|$)/,
      `"${classes}" nao declara coluna de base. Sem \`grid-cols-1\`, o trilho ` +
        "implicito e `auto` e cresce ate o min-content dos campos (364px " +
        "medidos), empurrando a pagina para o lado em qualquer celular.",
    );
  }
});

test("cartao Premium: os dois botoes quebram (vale por tres telas)", () => {
  const fonte = ler(GUARD_PREMIUM);
  const linha = linhaDeAcao(fonte, "Ver Planos Premium");

  assert.ok(linha, "nao achei a linha de acao de " + GUARD_PREMIUM);
  assert.match(
    linha,
    /\bflex-wrap\b/,
    "este cartao e o que /dashboard/investments, /dashboard/trading e " +
      "/dashboard/reports mostram para quem esta no plano gratuito -- isto e, " +
      "para o usuario padrao. Um defeito aqui vazava em TRES rotas.",
  );
  assert.doesNotMatch(linha, /\bspace-x-/);
});
