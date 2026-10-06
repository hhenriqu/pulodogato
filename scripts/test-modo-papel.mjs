// A PREFERENCIA do modo papel de pao -- HMO-283 (plano da HMO-279).
//
// O QUE ESTA SUITE PROVA, E POR QUE CADA PEDACO ESTA AQUI
// ------------------------------------------------------
// 1. `lerModoPapel` cai no padrao em tudo que nao e um dos dois valores. Valor
//    sujo no storage e o caso comum, nao o exotico: outra aba, uma versao
//    antiga do app, ou um dedo no console do navegador.
// 2. `aplicarModoPapel` liga e desliga a classe CERTA no `<html>`, e mexe na
//    barra de status do PWA sem mexer na classe `dark` de ninguem.
// 3. O `PAPEL_INIT_SCRIPT` faz, EXECUTADO, a mesma coisa que o modulo.
//
// SOBRE O ITEM 3, QUE E O DELICADO
// --------------------------------
// A issue pedia uma assercao TEXTUAL -- que o script "cite a mesma chave e a
// mesma classe" que o modulo usa. Ela seria vacua aqui: as constantes entram no
// script por `JSON.stringify(MODO_PAPEL_STORAGE_KEY)`, como em `lib/theme.ts`,
// entao chave e classe nao TEM como divergir, e uma assercao sobre algo
// impossivel passa verde para sempre sem olhar nada.
//
// O risco real que sobra e outro, e e maior: o script e texto, nao compila, e
// ninguem o executa em teste nenhum. Um erro de JavaScript dentro dele -- um
// parentese, um `classList` escrito errado, a leitura da classe `dark` invertida
// -- seria engolido pelo proprio `try/catch` que ele tem que ter, e o sintoma
// seria apenas o flash voltando para quem usa o modo. Ninguem abre um bug para
// isso.
//
// Entao a suite EXECUTA o script, com `new Function`, contra um DOM de mentira
// que registra o que foi pedido: a chave consultada, a classe alternada, a meta
// reescrita. Isso cobre a assercao textual (uma chave errada aparece como
// consulta a chave errada) e mais o corpo do script.
//
// O DOM de mentira e deliberadamente burro -- ele nao e um navegador. O que ele
// prova e o que o script PEDE; que o navegador atende ao pedido e assunto da
// suite de Chromium (`npm run test:papel-na-tela`).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  DEFAULT_MODO_PAPEL,
  MODOS_PAPEL,
  MODO_PAPEL_LABELS,
  MODO_PAPEL_STORAGE_KEY,
  PAPEL_CLASS,
  PAPEL_INIT_SCRIPT,
  PAPEL_THEME_COLOR,
  alternarModoPapel,
  aplicarModoPapel,
  gravarModoPapel,
  isModoPapel,
  lerModoPapel,
  papelAtivo,
} = await import("../.tmp-modo-papel/lib/modo-papel.js");

const { THEME_COLOR } = await import("../.tmp-modo-papel/lib/theme.js");

// ---------------------------------------------------------------------------
// O DOM de mentira
// ---------------------------------------------------------------------------

/**
 * `<html>` com classList e uma meta de theme-color, mais um localStorage que
 * ANOTA cada chave consultada.
 *
 * As anotacoes sao o que faz a assercao sobre o script ter dentes: sem elas,
 * "o DOM ficou com a classe papel" nao distingue um script que leu a chave
 * certa de um que leu a errada e caiu no padrao por acaso.
 */
function domFalso({ armazenado, classes = [], temMeta = true } = {}) {
  const consultas = [];
  const gravacoes = [];

  const lista = new Set(classes);
  const classList = {
    add: (c) => lista.add(c),
    remove: (c) => lista.delete(c),
    contains: (c) => lista.has(c),
    toggle: (c, forcar) => {
      const ativo = forcar === undefined ? !lista.has(c) : forcar;
      if (ativo) lista.add(c);
      else lista.delete(c);
      return ativo;
    },
  };

  const meta = { content: null, setAttribute: (_, v) => (meta.content = v) };

  const documentElement = { classList, style: {} };

  const janela = {
    localStorage: {
      getItem: (chave) => {
        consultas.push(chave);
        return chave === MODO_PAPEL_STORAGE_KEY && armazenado !== undefined
          ? armazenado
          : null;
      },
      setItem: (chave, valor) => gravacoes.push([chave, valor]),
    },
    document: {
      documentElement,
      querySelector: (seletor) => {
        if (seletor !== 'meta[name="theme-color"]') return null;
        return temMeta ? meta : null;
      },
    },
  };

  return {
    janela,
    consultas,
    gravacoes,
    meta,
    classes: () => [...lista].sort(),
    temClasse: (c) => lista.has(c),
  };
}

/** Roda uma funcao com `window`/`document` globais apontando para o DOM falso. */
function comDom(dom, corpo) {
  const anteriores = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
  };
  globalThis.window = dom.janela;
  globalThis.document = dom.janela.document;
  globalThis.localStorage = dom.janela.localStorage;
  try {
    return corpo();
  } finally {
    globalThis.window = anteriores.window;
    globalThis.document = anteriores.document;
    globalThis.localStorage = anteriores.localStorage;
  }
}

/**
 * Executa o PAPEL_INIT_SCRIPT de verdade.
 *
 * `new Function` com os tres nomes como PARAMETRO, e nao por global: o script
 * usa `localStorage`, `document` e `window` sem prefixo, e passar cada um
 * explicitamente deixa o teste reprovar na hora se o script comecar a depender
 * de algo que o `<head>` nao tem naquele instante.
 */
function rodarScriptInline(dom) {
  const fn = new Function(
    "localStorage",
    "document",
    "window",
    PAPEL_INIT_SCRIPT
  );
  fn(dom.janela.localStorage, dom.janela.document, dom.janela);
}

// ---------------------------------------------------------------------------
// 1. A leitura da preferencia
// ---------------------------------------------------------------------------

test("o padrao e desligado -- papel de pao nao se liga sozinho", () => {
  assert.equal(DEFAULT_MODO_PAPEL, "desligado");
  assert.deepEqual([...MODOS_PAPEL], ["desligado", "ligado"]);
  assert.equal(MODO_PAPEL_LABELS.ligado, "Ligado");
  assert.equal(MODO_PAPEL_LABELS.desligado, "Desligado");
});

test("isModoPapel aceita os dois valores e recusa o resto", () => {
  assert.equal(isModoPapel("ligado"), true);
  assert.equal(isModoPapel("desligado"), true);

  // O que ja apareceu em chave de preferencia deste app, e o que apareceria se
  // alguem resolvesse guardar booleano aqui.
  for (const sujo of [
    "true",
    "false",
    "1",
    "0",
    "on",
    "papel",
    "LIGADO",
    " ligado",
    "",
    null,
    undefined,
    0,
    1,
    true,
    {},
    [],
  ]) {
    assert.equal(isModoPapel(sujo), false, `aceitou ${JSON.stringify(sujo)}`);
  }
});

test("valor sujo no storage cai no padrao, e nao numa pele quebrada", () => {
  for (const sujo of ["true", "1", "papel", "LIGADO", "", "{}"]) {
    const dom = domFalso({ armazenado: sujo });
    assert.equal(
      comDom(dom, lerModoPapel),
      DEFAULT_MODO_PAPEL,
      `"${sujo}" nao caiu no padrao`
    );
  }

  // Chave ausente tambem -- o caso de toda primeira visita.
  const virgem = domFalso();
  assert.equal(comDom(virgem, lerModoPapel), DEFAULT_MODO_PAPEL);
  assert.deepEqual(virgem.consultas, [MODO_PAPEL_STORAGE_KEY]);
});

test("valor bom no storage e lido como esta", () => {
  for (const bom of ["ligado", "desligado"]) {
    const dom = domFalso({ armazenado: bom });
    assert.equal(comDom(dom, lerModoPapel), bom);
  }
});

test("storage bloqueado nao derruba a tela -- cai no padrao", () => {
  // Navegador em modo privado, cookies de terceiros bloqueados, iframe sem
  // permissao: nos tres `localStorage` LANCA em vez de devolver null.
  const dom = domFalso();
  dom.janela.localStorage.getItem = () => {
    throw new Error("SecurityError");
  };
  assert.equal(comDom(dom, lerModoPapel), DEFAULT_MODO_PAPEL);

  // E gravar tambem nao pode lancar: o modo vale so nesta sessao.
  dom.janela.localStorage.setItem = () => {
    throw new Error("SecurityError");
  };
  assert.doesNotThrow(() => comDom(dom, () => gravarModoPapel("ligado")));
});

test("sem window (SSR) a leitura devolve o padrao em vez de estourar", () => {
  // O modulo e importado por `app/layout.tsx`, que roda no servidor.
  const anterior = globalThis.window;
  // Apagar `window` e exatamente o estado do servidor que esta sendo simulado.
  // Sem diretiva de tipo: o `include` do tsconfig e `**/*.ts` e `**/*.tsx`,
  // entao nenhum `.mjs` de `scripts/` passa pelo tsc e a diretiva nao suprimia
  // nada -- era um dos dois erros de lint que a HMO-179 encontrou.
  delete globalThis.window;
  try {
    assert.equal(lerModoPapel(), DEFAULT_MODO_PAPEL);
    assert.doesNotThrow(() => gravarModoPapel("ligado"));
  } finally {
    globalThis.window = anterior;
  }
});

test("gravar escreve na chave do modo, e so nela", () => {
  const dom = domFalso();
  comDom(dom, () => gravarModoPapel("ligado"));
  assert.deepEqual(dom.gravacoes, [[MODO_PAPEL_STORAGE_KEY, "ligado"]]);

  // A chave e separada da do tema de proposito: papel de pao e um modo
  // ORTOGONAL, nao um terceiro tema (ver o cabecalho de lib/modo-papel.ts).
  assert.notEqual(MODO_PAPEL_STORAGE_KEY, "pulodogato-theme");
});

test("papelAtivo e alternarModoPapel", () => {
  assert.equal(papelAtivo("ligado"), true);
  assert.equal(papelAtivo("desligado"), false);
  assert.equal(alternarModoPapel("desligado"), "ligado");
  assert.equal(alternarModoPapel("ligado"), "desligado");
  // Alternar duas vezes volta ao inicio -- o papelzinho e um interruptor.
  assert.equal(alternarModoPapel(alternarModoPapel("ligado")), "ligado");
});

// ---------------------------------------------------------------------------
// 2. aplicarModoPapel: a classe no <html>
// ---------------------------------------------------------------------------

test("ligar poe a classe papel; desligar tira", () => {
  const dom = domFalso();
  comDom(dom, () => aplicarModoPapel("ligado"));
  assert.deepEqual(dom.classes(), [PAPEL_CLASS]);

  comDom(dom, () => aplicarModoPapel("desligado"));
  assert.deepEqual(dom.classes(), []);
});

test("a classe e `papel`, e nao `dark` -- os dois modos sao independentes", () => {
  // O erro que esta assercao impede: reusar a classe do tema faria ligar papel
  // de pao escurecer o app, e o seletor de tema passaria a brigar com o
  // papelzinho pela mesma classe.
  assert.equal(PAPEL_CLASS, "papel");

  const escuro = domFalso({ classes: ["dark"] });
  comDom(escuro, () => aplicarModoPapel("ligado"));
  assert.deepEqual(escuro.classes(), ["dark", "papel"]);

  // E desligar o papel NAO desliga o tema escuro de quem o escolheu.
  comDom(escuro, () => aplicarModoPapel("desligado"));
  assert.deepEqual(escuro.classes(), ["dark"]);
});

test("ligar duas vezes nao duplica nem derruba a classe", () => {
  // `toggle(classe, true)` e idempotente; `toggle(classe)` sem o segundo
  // argumento nao seria, e o segundo clique tiraria a pele.
  const dom = domFalso();
  comDom(dom, () => aplicarModoPapel("ligado"));
  comDom(dom, () => aplicarModoPapel("ligado"));
  assert.deepEqual(dom.classes(), [PAPEL_CLASS]);
});

test("a barra de status do PWA acompanha a pele, nos quatro casos", () => {
  // Sem isto o app instalado abre com uma faixa branca (ou azul-escura) em
  // cima de uma tela bege. Os quatro casos sao as quatro paletas de
  // app/globals.css.
  const casos = [
    { classes: [], modo: "ligado", esperado: PAPEL_THEME_COLOR.light },
    { classes: ["dark"], modo: "ligado", esperado: PAPEL_THEME_COLOR.dark },
    { classes: [], modo: "desligado", esperado: THEME_COLOR.light },
    { classes: ["dark"], modo: "desligado", esperado: THEME_COLOR.dark },
  ];

  for (const { classes, modo, esperado } of casos) {
    const dom = domFalso({ classes });
    comDom(dom, () => aplicarModoPapel(modo));
    assert.equal(
      dom.meta.content,
      esperado,
      `classes=[${classes}] modo=${modo}`
    );
  }

  // E as quatro cores sao de fato quatro -- um copiar-e-colar que deixasse
  // duas iguais passaria nas assercoes de cima se elas comparassem com a
  // propria constante errada.
  const cores = new Set([
    PAPEL_THEME_COLOR.light,
    PAPEL_THEME_COLOR.dark,
    THEME_COLOR.light,
    THEME_COLOR.dark,
  ]);
  assert.equal(cores.size, 4);
});

test("a cor de papel espelha o --background de globals.css", () => {
  // O par que some sem sintoma: mexer no HSL do CSS e esquecer o hex daqui
  // deixa a faixa de uma cor e a tela de outra, so no app instalado.
  const css = readFileSync("app/globals.css", "utf8");

  // hsl -> hex, a mesma conta do scripts/check-color-tokens.mjs.
  const hex = (h, s, l) => {
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) =>
      l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return (
      "#" +
      [f(0), f(8), f(4)]
        .map((v) => Math.round(v * 255).toString(16).padStart(2, "0"))
        .join("")
    );
  };

  const bloco = (seletor) => {
    const sem = css.replace(/\/\*[\s\S]*?\*\//g, " ");
    const m = sem.match(
      new RegExp(
        `(?<![\\w.#:-])${seletor.replace(/[.]/g, "\\.")}\\s*\\{[^}]*?--background:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`
      )
    );
    assert.ok(m, `nao achei --background em ${seletor}`);
    return hex(Number(m[1]), Number(m[2]), Number(m[3]));
  };

  assert.equal(bloco(".papel"), PAPEL_THEME_COLOR.light);
  assert.equal(bloco(".dark.papel"), PAPEL_THEME_COLOR.dark);
});

test("sem a meta de theme-color nada estoura", () => {
  // O `<head>` tem a meta, mas um teste de componente ou uma pagina de erro
  // podem nao ter -- e uma excecao aqui mataria a aplicacao da classe.
  const dom = domFalso({ temMeta: false });
  assert.doesNotThrow(() => comDom(dom, () => aplicarModoPapel("ligado")));
  assert.deepEqual(dom.classes(), [PAPEL_CLASS]);
});

test("sem document (SSR) aplicar nao faz nada e nao estoura", () => {
  const anterior = globalThis.document;
  // O estado do servidor; sem diretiva de tipo, pelo mesmo motivo de cima.
  delete globalThis.document;
  try {
    assert.doesNotThrow(() => aplicarModoPapel("ligado"));
  } finally {
    globalThis.document = anterior;
  }
});

// ---------------------------------------------------------------------------
// 3. O script inline, EXECUTADO
// ---------------------------------------------------------------------------

test("o script inline consulta exatamente a chave do modulo", () => {
  const dom = domFalso({ armazenado: "ligado" });
  rodarScriptInline(dom);
  assert.deepEqual(
    dom.consultas,
    [MODO_PAPEL_STORAGE_KEY],
    "o script le uma chave que nao e a que o modulo grava"
  );
});

test("o script inline liga a mesma classe que aplicarModoPapel", () => {
  const pelosDois = (opcoes) => {
    const viaScript = domFalso(opcoes);
    rodarScriptInline(viaScript);

    const viaModulo = domFalso(opcoes);
    const modo = opcoes.armazenado === "ligado" ? "ligado" : "desligado";
    comDom(viaModulo, () => aplicarModoPapel(modo));

    return [viaScript, viaModulo];
  };

  // Ligado, tema claro.
  let [s, m] = pelosDois({ armazenado: "ligado" });
  assert.deepEqual(s.classes(), [PAPEL_CLASS]);
  assert.deepEqual(s.classes(), m.classes());
  assert.equal(s.meta.content, m.meta.content);
  assert.equal(s.meta.content, PAPEL_THEME_COLOR.light);

  // Ligado, tema escuro -- o script le a classe `dark` que o THEME_INIT_SCRIPT
  // escreveu logo antes dele no <head>. Invertida a leitura, a faixa sairia
  // bege sobre a tela marrom.
  [s, m] = pelosDois({ armazenado: "ligado", classes: ["dark"] });
  assert.deepEqual(s.classes(), ["dark", "papel"]);
  assert.deepEqual(s.classes(), m.classes());
  assert.equal(s.meta.content, PAPEL_THEME_COLOR.dark);

  // Desligado: o script NAO pode mexer na meta. Quem a preencheu foi o
  // THEME_INIT_SCRIPT, que roda antes; sobrescrever aqui com a cor de papel
  // pintaria a faixa de bege no app de quem nunca ligou o modo.
  [s] = pelosDois({ armazenado: "desligado" });
  assert.deepEqual(s.classes(), []);
  assert.equal(s.meta.content, null);

  // Valor sujo: cai no padrao, igual ao modulo.
  [s] = pelosDois({ armazenado: "true" });
  assert.deepEqual(s.classes(), []);
});

test("o script inline nao estoura com storage bloqueado", () => {
  // O caso que o `try/catch` dele existe para cobrir. Sem o catch, a excecao
  // mata o script inline do <head> -- e junto com ele a primeira pintura.
  const dom = domFalso();
  dom.janela.localStorage.getItem = () => {
    throw new Error("SecurityError");
  };
  assert.doesNotThrow(() => rodarScriptInline(dom));
  assert.deepEqual(dom.classes(), []);
});

test("o script inline e auto-contido e sincrono", () => {
  // Ele roda no <head>, antes de qualquer modulo existir, e tem que terminar
  // ANTES da primeira pintura. Qualquer uma destas tres palavras significa que
  // ele deixou de valer para a pintura -- e o sintoma seria so o flash
  // voltando, que ninguem abre bug para reportar.
  for (const proibida of ["import", "require", "addEventListener"]) {
    assert.ok(
      !PAPEL_INIT_SCRIPT.includes(proibida),
      `o script passou a usar ${proibida}`
    );
  }
  // Uma IIFE, para nao deixar variavel solta no escopo global da pagina.
  assert.match(PAPEL_INIT_SCRIPT, /^\(function\(\)\{/);
  assert.match(PAPEL_INIT_SCRIPT, /\}\)\(\);$/);
});
