#!/usr/bin/env node
// =====================================================
// PULODOGATO - a tela do celular (HMO-168, HMO-185)
// =====================================================
//   npm run test:mobile-overflow
//
// Duas familias, as duas medidas em producao com navegador antes de virarem
// caso aqui: o scroll horizontal (HMO-168, a maior parte do arquivo) e a area
// util da tela no iPhone (HMO-185, no fim).
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

// A medicao pos-deploy do primeiro conserto deixou este de fora: com o
// cabecalho ja quebrando e a barra de abas ja rolando, /dashboard/reports ainda
// vazava 6px em 320px. O seletor de janela (`w-36`) + "Salvar em PDF" + gap dao
// 310px contra 288px uteis. Seis pixels nao chamam atencao e mexem a pagina do
// mesmo jeito -- o valor do numero medido e justamente pegar esse tamanho.
test("Relatorios: a linha de janela + PDF quebra no celular", () => {
  const fonte = ler("app/(dashboard)/dashboard/reports/page.tsx");
  const linha = linhaDeAcao(fonte, "window.print()");

  assert.ok(
    linha,
    "nao achei a linha de acao dos relatorios (ancorada em `window.print()`)",
  );
  assert.match(linha, /\bflex-wrap\b/);
  assert.doesNotMatch(linha, /\bspace-x-/);
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

// -----------------------------------------------------------------
// Padrao 4: a linha de lista que nao encolhe (HMO-185)
// -----------------------------------------------------------------
// Medido em producao: /dashboard/personal-finance -- a lista de lancamentos,
// que e a tela que o Helio chamou de "lancamentos de receitas e despesas" --
// tinha `documentElement.scrollWidth` de 693px no iPhone de 390px E no de
// 320px. O MESMO 693 nas duas larguras.
//
// Largura que nao muda com a viewport nao e "por pouco nao coube": e piso de
// min-content. Um item flex nao encolhe abaixo do min-content do conteudo
// dele, a menos que alguem diga `min-width: 0`. Com um `<p>` levando a
// descricao inteira numa linha so e, embaixo, uma fila de selo + categoria +
// data que tambem nao quebrava, o piso ficou em 693px e a pagina inteira
// passou a andar para o lado -- em todo celular, com qualquer largura.
//
// E por que isto e um padrao e nao um caso: a mesma forma
// (`flex items-center justify-between` com texto livre de um lado e valor do
// outro) aparece em tres telas. `truncate` resolve onde o texto e um rotulo;
// `flex-wrap` resolve onde o texto e uma frase que perde sentido cortada.
//
// AS TELAS DE CADASTRO estao fora desta lista de proposito:
// /movimentacoes/receita e /despesa foram medidas na mesma rodada e nao
// vazam. O defeito era da lista.

/**
 * Os ultimos `className` que aparecem ANTES de um marcador -- a cadeia de
 * ancestrais e irmaos que envolve o alvo.
 *
 * Devolve a cadeia inteira, e nao um elemento so, porque o que estes casos
 * afirmam e distribuido: o `min-w-0` mora no pai, o `truncate` no filho, e
 * exigir os dois na mesma string reprovaria codigo correto.
 */
function linhaDeLista(fonte, marcador) {
  const i = fonte.indexOf(marcador);
  if (i === -1) return null;

  const antes = fonte.slice(0, i);
  const aberturas = [...antes.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
  return aberturas.slice(-6);
}

test("lancamentos: a linha nao empurra a pagina (min-w-0 + truncate)", () => {
  const fonte = ler("app/(dashboard)/dashboard/personal-finance/page.tsx");
  const cadeia = linhaDeLista(fonte, "{transaction.description}");

  assert.ok(
    cadeia,
    "nao achei a linha do lancamento em personal-finance -- se a lista foi " +
      "reescrita, este caso precisa ser reescrito com ela em vez de continuar verde",
  );

  const juntas = cadeia.join(" | ");

  // AS DUAS CAIXAS, separadamente -- e nao "min-w-0 aparece em algum lugar da
  // cadeia".
  //
  // Sao dois `min-w-0` em elementos diferentes e os dois sao necessarios: o
  // bloco da esquerda (o que tem `flex-1`) e o embrulho do texto. A primeira
  // versao deste caso procurava o `min-w-0` na cadeia inteira, e ficou VERDE
  // com o do bloco da esquerda removido, porque o do embrulho ainda casava.
  // O mutante foi medido em navegador: sem o do bloco da esquerda a pagina
  // volta a 614px numa viewport de 390. Um so dos dois nao resolve.
  assert.ok(
    cadeia.some((c) => /\bflex-1\b/.test(c) && /\bmin-w-0\b/.test(c)),
    "o bloco da esquerda (`flex-1`) precisa do proprio `min-w-0`. Um item " +
      "flex tem min-content como largura minima automatica; enquanto ele se " +
      "recusar a encolher, o `truncate` la dentro nunca chega a ser " +
      `acionado. Cadeia encontrada: ${juntas}`,
  );
  assert.ok(
    cadeia.some((c) => c.trim() === "min-w-0"),
    "falta o `min-w-0` no embrulho do texto (descricao + metadados), que e " +
      "quem repassa a permissao de encolher para o `truncate`",
  );
  assert.match(
    juntas,
    /\btruncate\b/,
    "a descricao e texto livre do usuario -- sem corte, uma unica linha de " +
      "compra define a largura da pagina inteira (693px medidos)",
  );
});

test("lancamentos: a fila de categoria/data quebra, e com gap vertical", () => {
  const fonte = ler("app/(dashboard)/dashboard/personal-finance/page.tsx");
  const cadeia = linhaDeLista(fonte, "classificarMovimentacao(transaction)");
  assert.ok(cadeia, "nao achei a fila de metadados do lancamento");

  // A cadeia inteira, e nao o ultimo elemento: o marcador cai dentro do selo
  // de tipo, entao o className mais proximo dele e o do PROPRIO selo
  // (`shrink-0`) -- a fila que interessa e o pai dele.
  const fila = cadeia.join(" | ");

  assert.match(
    fila,
    /\bflex-wrap\b/,
    "selo + categoria + data + selo do grupo numa linha que nao quebra somam " +
      "bem mais que 320px, e `truncate` no pai nao ajuda: cada filho tem o " +
      "proprio min-content",
  );
  assert.match(
    fila,
    /\bgap-y-\d/,
    "quebrou em duas linhas sem `gap-y` elas ficam coladas -- a mesma " +
      "armadilha do `space-x-*` da HMO-160, por outro caminho",
  );
});

test("patrimonio: o nome da conta corta e o saldo nao encolhe", () => {
  const fonte = ler("app/(dashboard)/dashboard/net-worth/page.tsx");
  const cadeia = linhaDeLista(fonte, "{conta.name}");

  assert.ok(cadeia, "nao achei a linha da conta em net-worth");
  const juntas = cadeia.join(" | ");

  assert.match(juntas, /\bmin-w-0\b/);
  assert.match(
    juntas,
    /\btruncate\b/,
    "esta linha vazava 11px em 320px (medido). Onze pixels nao chamam " +
      "atencao e movem a pagina igual -- e o nome da conta e livre, entao o " +
      "piso cresce junto com ele.",
  );
});

test("acertos do grupo: 'Fulano pagou Beltrano' quebra em vez de cortar", () => {
  const fonte = ler(
    "app/(dashboard)/dashboard/expense-groups/[groupId]/page.tsx",
  );
  const cadeia = linhaDeLista(fonte, ">pagou<");

  assert.ok(cadeia, "nao achei a linha de acerto do grupo");
  const juntas = cadeia.join(" | ");

  assert.match(
    juntas,
    /\bflex-wrap\b/,
    "dois avatares + dois nomes livres + a data nao cabem em 320px. Aqui a " +
      "saida e quebrar, nao cortar: `Fulan... pagou Belt...` tira justamente " +
      "a informacao da frase.",
  );
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

// -----------------------------------------------------------------
// A ALTURA UTIL DA TELA NO IPHONE (HMO-185)
// -----------------------------------------------------------------
// A outra metade da HMO-185, e a que o Helio viu primeiro: "o header fica
// vazando pra cima".
//
// O app declara `viewport-fit=cover` junto com um status bar translucido. O
// par e deliberado -- e o que faz o app instalado ocupar a tela toda -- mas
// ele move a origem da webview para y=0, POR BAIXO do relogio e do notch. O
// header e `fixed top-0` e nao descontava nada, entao o hamburguer e o titulo
// saiam desenhados em cima do relogio. Medido em producao: `padding-top: 0px`
// com `viewport-fit=cover` ligado.
//
// POR QUE ISTO NUNCA FICOU VERMELHO EM LUGAR NENHUM
// -------------------------------------------------
// `env(safe-area-inset-top)` vale 0 em todo navegador sem notch -- todo
// navegador de teste, todo desktop, o Chromium do CI. O defeito e invisivel
// em qualquer ambiente que nao seja um iPhone de verdade. Por isso o recorte
// passou a ser lido para dentro de VARIAVEIS CSS (`--safe-top` e irmas): uma
// variavel pode ser sobrescrita de fora, e `scripts/probe-mobile-overflow.mjs`
// injeta 47px num Chromium comum e mede o header descer.
//
// O que os casos abaixo travam e o mecanismo: as variaveis existem, quem
// precisa delas as usa, e -- o mais facil de perder num refactor -- a altura
// do header e a do espacador que reserva o lugar dele continuam saindo da
// MESMA fonte.

const CSS = "app/globals.css";
const HEADER = "components/DashboardHeader.tsx";
const LAYOUT = "app/(dashboard)/layout.tsx";

test("as quatro medidas do recorte saem de env(), no :root", () => {
  const css = ler(CSS);

  for (const lado of ["top", "right", "bottom", "left"]) {
    assert.match(
      css,
      new RegExp(
        `--safe-${lado}:\\s*env\\(safe-area-inset-${lado},\\s*0px\\)`,
      ),
      `--safe-${lado} tem que sair de env(safe-area-inset-${lado}) com 0px de ` +
        "fallback. O fallback importa: sem ele, um navegador que nao conhece " +
        "`env()` deixa a variavel vazia e todo `calc()` que a usa vira " +
        "invalido -- o espacamento some INTEIRO, em vez de so nao crescer.",
    );
  }
});

test("viewport-fit=cover continua declarado", () => {
  const raiz = ler("app/layout.tsx");

  assert.match(
    raiz,
    /viewportFit:\s*"cover"/,
    "sem `viewport-fit=cover` o iOS nao entrega recorte nenhum: `env()` passa " +
      "a valer 0 e TODO o conserto da HMO-185 vira no-op, sem que nada " +
      "quebre, nem aqui nem na tela. E a peca cuja remocao e mais silenciosa.",
  );
});

test("a meta viewport nao e reescrita em runtime (e o zoom volta)", () => {
  const hook = ler("lib/hooks/useDeviceDetection.tsx");

  assert.doesNotMatch(
    hook,
    /user-scalable=no|maximum-scale=1/,
    "havia aqui uma reescrita da meta viewport que so acontecia no iPhone e " +
      "apagava o que `export const viewport` de app/layout.tsx declara. Duas " +
      "fontes para o mesmo valor, e vencia a que nao esta no arquivo onde se " +
      "vai procurar. O efeito era proibir zoom no app instalado (WCAG 1.4.4), " +
      "para resolver o zoom automatico de input -- que `.device-ios input " +
      "{ font-size: 16px }` ja resolvia sem tirar nada de ninguem.",
  );

  const raiz = ler("app/layout.tsx");
  assert.match(raiz, /userScalable:\s*true/);
});

test("o header fixo desconta o recorte do topo", () => {
  const header = ler(HEADER);
  const fixos = [...header.matchAll(/className="([^"]*\bfixed\b[^"]*)"/g)].map(
    (m) => m[1],
  );

  assert.equal(
    fixos.length,
    2,
    `esperava os dois headers fixos (celular e desktop) e achei ${fixos.length}` +
      " -- se o componente foi reescrito, este caso precisa ser reescrito com ele",
  );

  for (const classes of fixos) {
    assert.match(
      classes,
      /\bpt-safe\b/,
      `"${classes}" e \`fixed top-0\` sem descontar o recorte. Elemento fixo ` +
        "se posiciona pela viewport, entao ele comeca em y=0 -- debaixo do " +
        "relogio do iPhone. Era exatamente o defeito relatado.",
    );
  }
});

test("o espacador e o header medem a mesma coisa, da mesma fonte", () => {
  const css = ler(CSS);
  const header = ler(HEADER);
  const layout = ler(LAYOUT);

  // 1. o espacador sai da variavel, nao de um numero escrito a mao
  assert.match(
    layout,
    /className="app-header-offset/,
    "o espacador do header tinha `h-16 lg:h-12` escrito a mao, e os dois " +
      "numeros estavam errados: o header mede 65px nos dois tamanhos (medido " +
      "em producao), entao o celular reservava 1px a menos e o desktop 17px. " +
      "Numero solto nao tem como saber que o header mudou.",
  );
  assert.doesNotMatch(
    layout,
    /className="h-16 lg:h-12/,
    "voltou o espacador de altura fixa",
  );

  assert.match(
    css,
    /\.app-header-offset\s*\{[^}]*calc\(var\(--app-header\)\s*\+\s*var\(--safe-top\)\)/,
    "o espacador tem que ser a altura do header MAIS o recorte -- e as duas " +
      "parcelas tem que ser as mesmas variaveis que o header usa, senao volta " +
      "a ser possivel mexer em um e esquecer o outro",
  );

  // 2. a altura declarada do header bate com a variavel
  const m = css.match(/--app-header:\s*calc\((\d+(?:\.\d+)?)rem\s*\+\s*1px\)/);
  assert.ok(
    m,
    "nao achei `--app-header: calc(<N>rem + 1px)` -- o `+ 1px` e a `border-b` " +
      "do header, e esquecer dela devolve a sobreposicao de um pixel",
  );

  const rem = Number(m[1]);
  const esperado = `h-${rem * 4}`; // 4rem -> h-16, na escala do Tailwind

  const barras = [...header.matchAll(/className="([^"]*\bh-\d+\b[^"]*)"/g)].map(
    (x) => x[1],
  );
  assert.equal(
    barras.length,
    2,
    `esperava as duas barras internas com altura declarada e achei ${barras.length}`,
  );
  for (const classes of barras) {
    assert.match(
      classes,
      new RegExp(`\\b${esperado}\\b`),
      `a barra "${classes}" nao mede ${esperado}, mas --app-header diz ${rem}rem. ` +
        "As duas alturas TEM que andar juntas: o espacador reserva o que a " +
        "variavel diz, e quem pinta e a barra. Discordaram, o conteudo volta " +
        "para debaixo do header.",
    );
    assert.doesNotMatch(
      classes,
      /\bpy-\d/,
      `a barra "${classes}" voltou a ter altura por padding. Com \`py-3\` a ` +
        "altura e 24px mais o que estiver dentro, e o que esta dentro muda " +
        "(`.device-mobile button` pede 44px de minimo) -- o espacador nao " +
        "fica sabendo. Foi assim que o header virou 65px com 64 reservados.",
    );
  }
});

test("a altura util usa dvh, com vh de piso", () => {
  const css = ler(CSS);

  assert.match(
    css,
    /\.min-h-app\s*\{\s*min-height:\s*100vh;\s*min-height:\s*100dvh;/,
    "as duas declaracoes, nesta ordem: `100vh` no Safari do iPhone e a altura " +
      "COM a barra de endereco recolhida -- uma altura que a pagina so tem " +
      "depois de rolar. `100dvh` e a util. A linha do `vh` fica para o " +
      "navegador que nao conhece `dvh` nao acabar sem `min-height` nenhum.",
  );

  // A NEGACAO, e nao so a presenca. O layout tem DUAS caixas de altura cheia
  // -- a do spinner de carregamento e a do painel -- e `match(/min-h-app/)`
  // ficava verde com uma das duas revertida para `min-h-screen`, porque a
  // outra ainda casava. Um mutante que troca so o painel (a que importa)
  // passava batido.
  assert.doesNotMatch(
    ler(LAYOUT),
    /\bmin-h-screen\b/,
    "alguma caixa do painel voltou a `min-h-screen` (100vh). No Safari do " +
      "iPhone isso e a altura da tela COM a barra de endereco recolhida, que " +
      "a pagina so tem depois de rolar -- ate la o rodape fica atras da barra.",
  );
});

test("nao sobrou a classe que zerava o padding dos banners", () => {
  const css = ler(CSS);

  assert.doesNotMatch(
    css,
    /\.safe-area-padding\s*\{/,
    "`.safe-area-padding` escrevia padding nos QUATRO lados e vivia em " +
      "`@layer utilities`, entao vencia o `p-4` do Tailwind na mesma caixa. " +
      "Em aparelho sem recorte -- o caso comum -- os quatro valores davam " +
      "zero e os banners de instalacao do PWA ficavam com o texto colado na " +
      "borda. Tinha cara de estar ajudando.",
  );

  assert.doesNotMatch(
    ler("components/PWAWrapper.tsx"),
    /\bsafe-area-padding\b/,
    "os banners voltaram a usar a classe que zera o proprio padding deles",
  );
});
