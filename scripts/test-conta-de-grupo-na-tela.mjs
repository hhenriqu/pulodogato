#!/usr/bin/env node
// =====================================================
// A LINHA DA CONTA DE GRUPO EM CONTAS A PAGAR -- sonda de navegador (HMO-411)
// =====================================================
//   npm run test:conta-de-grupo-na-tela
//
// A receita e a de `testar-dom-em-chromium-aqui`, a mesma das sondas irmas: o
// JS emitido dos componentes e colado numa pagina `file://`, o React vem do
// UMD inline, e as assercoes leem o DOM de verdade depois do render.
//
// O QUE ESTA SONDA MEDE, E O QUE ELA DELIBERADAMENTE NAO MEDE
// -----------------------------------------------------------
// A issue pede "o botao unico presente E os quatro ausentes NAQUELA LINHA". A
// segunda metade nao e uma propriedade DESTE componente -- ele nao tem como
// desenhar os quatro, entao afirmar a ausencia deles aqui seria exatamente a
// assercao vazia contra a qual a issue avisa ("o botao de pagar sumiu" passa
// verde numa conta vazia).
//
// Os quatro botoes sao da `Linha` de `app/(dashboard)/dashboard/bills/page.tsx`,
// que e um fechamento DENTRO de uma pagina de 1.600 linhas: ela nao se monta
// numa sonda de navegador, e foi a essa mesma conclusao que a HMO-386 chegou
// nesta mesma tela. Entao a prova esta partida em duas, e as duas sao
// obrigatorias:
//
//   1. AQUI: a linha desenha UM gesto, ele e o certo, ele chama a URL certa e
//      vira estado depois do toque. Tudo assercao de PRESENCA e de
//      COMPORTAMENTO -- nenhuma passa numa tela vazia;
//   2. scripts/check-conta-de-grupo-na-agenda.mjs: a `Secao` manda a conta de
//      grupo de outro dono para ESTA linha ANTES de cair na `Linha` comum. E
//      esse galho que faz os quatro nao aparecerem, e e la que a ausencia
//      deles e uma afirmacao com conteudo.
//
// A SECAO 3 AINDA ASSIM CONFERE OS QUATRO TITULOS, e por um motivo que nao e
// a ausencia: ela le os `title` reais do fonte da pagina e exige que a linha
// nao tenha NENHUM deles. Se amanha alguem renomear um dos quatro, o guard
// textual do item 2 continuaria casando com o nome velho; esta assercao
// quebra, e aponta para o lugar certo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const SAIDA = ".tmp-conta-de-grupo-na-tela";
const PAGINA_DE_CONTAS = "app/(dashboard)/dashboard/bills/page.tsx";

/** Ver o cabecalho identico em scripts/test-mybank-na-tela.mjs (HMO-406). */
function acharChromium() {
  const candidatos = [process.env.CHROMIUM_BIN];

  for (const base of [
    `${process.env.HOME}/.cache/ms-playwright`,
    "/paperclip/.cache/ms-playwright",
  ]) {
    if (!existsSync(base)) continue;
    let pastas = [];
    try {
      pastas = readdirSync(base);
    } catch {
      pastas = [];
    }
    for (const dir of pastas) {
      if (!/^chromium/.test(dir)) continue;
      for (const sufixo of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
        candidatos.push(join(base, dir, sufixo));
      }
    }
  }

  candidatos.push(
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  );

  return candidatos.find((c) => c && existsSync(c)) ?? null;
}

const SEM_NAVEGADOR =
  "Nenhum Chromium encontrado. Aponte CHROMIUM_BIN para um binario, " +
  "ou instale com `npx playwright install chromium`.";

if (!existsSync(join(SAIDA, "components/grupos/LinhaDaContaDoGrupo.js"))) {
  throw new Error(
    `${SAIDA}/ nao existe. Rode por \`npm run test:conta-de-grupo-na-tela\`, ` +
      "que e quem compila os componentes antes do teste."
  );
}

/** Tira so a fiacao de modulo, deixando o corpo das funcoes intacto. */
const paraScriptClassico = (fonte) =>
  fonte
    .replace(/^import\s[\s\S]*?;$/gm, "")
    .replace(/^export\s*\{[^}]*\}\s*;$/gm, "")
    .replace(/^export /gm, "")
    .replace(/^"use client";$/gm, "");

const PARTES = [
  // ORDEM DE DEPENDENCIA. `data-na-tela` chama `dataParaExibicao`, que mora em
  // `data-digitada`: sem esta primeira linha a linha morre em
  // `ReferenceError: dataParaExibicao is not defined` no primeiro render --
  // familia `import-novo-no-componente-derruba-a-sonda-de-navegador`.
  "lib/data-digitada.js",
  "lib/data-na-tela.js",
  "lib/conta-de-grupo-na-agenda.js",
  "components/ui/button.js",
  "components/ui/badge.js",
  "components/grupos/LinhaDaContaDoGrupo.js",
];

const producao = PARTES.map((parte) => {
  const fonte = paraScriptClassico(readFileSync(join(SAIDA, parte), "utf8"));

  const sobra = fonte.match(/^\s*(import|export)\s.*$/m);
  if (sobra) {
    throw new Error(
      `sobrou fiacao de modulo em ${parte}: ${sobra[0].trim()}\n` +
        "ajuste paraScriptClassico()"
    );
  }

  try {
    new Function(fonte);
  } catch (e) {
    throw new Error(`${parte} nao parseia depois do strip: ${e.message}`);
  }

  return fonte;
}).join("\n");

const umd = (pacote, arquivo) =>
  readFileSync(join("node_modules", pacote, "umd", arquivo), "utf8");

// --- os ids do fixture, do lado do node --------------------------------------
//
// Eles existem AQUI e nao so dentro da pagina de proposito: a assercao da URL
// do POST compara o id que saiu com o id que entrou, e um literal escrito nos
// dois lugares e o que torna essa comparacao real.
const O_ALUGUEL = "aaaaaaaa-0000-4000-b000-000000000001";
const O_ALUGUEL_AVISADO = "aaaaaaaa-0000-4000-b000-000000000002";
const O_ALUGUEL_CONFIRMADO = "aaaaaaaa-0000-4000-b000-000000000003";

// A pagina e montada com template literal, e NUNCA com `String.replace`: o
// bundle do React tem `$$typeof` dentro, e numa string de substituicao `$$`
// vira `$` -- o bundle chega corrompido e o erro e "React is not defined".
const PAGINA = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<div id="raiz-a"></div><div id="raiz-b"></div><div id="raiz-c"></div>
<div id="resultado">a pagina nao rodou</div>
<script>${umd("react", "react.development.js")}</script>
<script>${umd("react-dom", "react-dom.development.js")}</script>
<script>
// UM UNICO <script>: os esbocos e os hooks sao \`const\` de TOPO DE SCRIPT, e o
// codigo de producao os resolve por NOME na hora da chamada.
const { useCallback, useEffect, useMemo, useRef, useState } = React;

/** clsx + tailwind-merge: junta o que nao e falso. Calculo de string. */
const cn = (...partes) => partes.filter(Boolean).join(" ");

/** class-variance-authority: so devolve a base. Calculo de string. */
const cva = (base) => () => base;

/** O Slot do Radix: o \`asChild\` do Button. */
const Slot = React.forwardRef(function Slot(props, ref) {
  const { children, ...resto } = props;
  return React.cloneElement(children, { ...resto, ref });
});

/** sonner: um registrador. O que as assercoes leem e a CHAMADA, nao o toast. */
const TOASTS = [];
const toast = {
  success: (m) => TOASTS.push(["success", String(m)]),
  error: (m) => TOASTS.push(["error", String(m)]),
};

/** O \`fetch\` que a sonda escuta. Guarda URL e metodo de cada chamada. */
const CHAMADAS = [];
window.fetch = async (url, opcoes) => {
  CHAMADAS.push({ url: String(url), method: (opcoes && opcoes.method) || "GET" });
  return {
    ok: true,
    json: async () => ({ success: true, message: "Avisamos quem criou a conta." }),
  };
};

let RECARGAS = 0;

${producao}

const BASE = {
  id: ${JSON.stringify(O_ALUGUEL)},
  user_id: "do-helio",
  group_id: "grupo-casa",
  description: "Aluguel",
  due_date: "2026-03-10",
  days_until_due: 5,
  my_status: "pending",
  my_effective_status: "pending",
  group: { name: "Casa" },
};

function montar(idDaRaiz, conta) {
  const raiz = document.createElement("div");
  raiz.id = idDaRaiz;
  document.body.appendChild(raiz);
  // \`ReactDOM.render\` (legado, SINCRONO) e nao \`createRoot\`, e e a mesma
  // escolha das sondas irmas: com o root concorrente um erro de render e
  // lancado FORA deste \`try\`, e a sonda termina com \`ok: true\` e a pagina
  // vazia -- todo caso abaixo falha com "nao desenhou", que nao se le como o
  // que e.
  ReactDOM.render(
    React.createElement(LinhaDaContaDoGrupo, {
      conta,
      valor: "R$ 3.000,00",
      aoAvisar: () => { RECARGAS += 1; },
    }),
    raiz
  );
  return raiz;
}

const espera = () => new Promise((r) => setTimeout(r, 30));

(async () => {
  const saida = {};
  try {
    // --- A: pendente -- o gesto existe e e UM so ---------------------------
    const a = montar("m-a", BASE);
    await espera();

    const linhaA = a.querySelector("[data-conta-de-grupo]");
    saida.a_tem_linha = Boolean(linhaA);
    saida.a_id_no_dom = linhaA && linhaA.getAttribute("data-conta-de-grupo");
    saida.a_botoes = linhaA ? linhaA.querySelectorAll("button").length : -1;
    saida.a_rotulo = linhaA
      ? (linhaA.querySelector("[data-avisar-parte]") || {}).textContent
      : null;
    saida.a_selo = linhaA
      ? (linhaA.querySelector("[data-selo-do-grupo]") || {}).textContent
      : null;
    saida.a_titulos = linhaA
      ? Array.from(linhaA.querySelectorAll("[title]")).map((e) => e.getAttribute("title"))
      : [];
    saida.a_texto = linhaA ? linhaA.textContent : "";

    // --- o toque -----------------------------------------------------------
    const botao = linhaA && linhaA.querySelector("[data-avisar-parte]");
    if (botao) botao.click();
    await espera();

    saida.chamadas = CHAMADAS.slice();
    saida.recargas = RECARGAS;
    saida.toasts = TOASTS.slice();

    // --- B: ja avisou -- o botao virou estado, e ha o desfazer -------------
    const b = montar("m-b", {
      ...BASE,
      id: ${JSON.stringify(O_ALUGUEL_AVISADO)},
      my_status: "reported",
    });
    await espera();

    const linhaB = b.querySelector("[data-conta-de-grupo]");
    saida.b_avisado = Boolean(linhaB && linhaB.querySelector("[data-parte-avisada]"));
    saida.b_ainda_oferece_avisar = Boolean(
      linhaB && linhaB.querySelector("[data-avisar-parte]")
    );
    saida.b_desfazer = Boolean(linhaB && linhaB.querySelector("[data-desfazer-parte]"));
    saida.b_texto = linhaB ? linhaB.textContent : "";

    // O DESFAZER CHAMA DELETE na mesma URL.
    const desfazer = linhaB && linhaB.querySelector("[data-desfazer-parte]");
    if (desfazer) desfazer.click();
    await espera();
    saida.chamada_do_desfazer = CHAMADAS[CHAMADAS.length - 1];

    // --- C: confirmado pelo dono -- nao ha gesto nenhum --------------------
    const c = montar("m-c", {
      ...BASE,
      id: ${JSON.stringify(O_ALUGUEL_CONFIRMADO)},
      my_status: "paid",
    });
    await espera();

    const linhaC = c.querySelector("[data-conta-de-grupo]");
    saida.c_confirmada = Boolean(
      linhaC && linhaC.querySelector("[data-parte-confirmada]")
    );
    saida.c_botoes = linhaC ? linhaC.querySelectorAll("button").length : -1;

    // --- D: vencida -- a tarja sai de \`my_effective_status\` ----------------
    const d = montar("m-d", {
      ...BASE,
      id: "vencida",
      my_effective_status: "overdue",
      days_until_due: -4,
      // O \`effective_status\` DO DONO diz que ele ja pagou. Se a linha lesse
      // essa coluna, esta conta apareceria "em dia" para quem ainda deve.
      effective_status: "paid",
    });
    await espera();
    const linhaD = d.querySelector("[data-conta-de-grupo]");
    saida.d_texto = linhaD ? linhaD.textContent : "";

    saida.ok = true;
  } catch (e) {
    saida.ok = false;
    saida.erro = String((e && e.stack) || e);
  }
  document.getElementById("resultado").textContent = JSON.stringify(saida);
})();
</script></body></html>`;

const arquivo = join(tmpdir(), `conta-de-grupo-na-tela-${process.pid}.html`);
writeFileSync(arquivo, PAGINA);

const chromium = acharChromium();

async function rodar() {
  if (!chromium) throw new Error(SEM_NAVEGADOR);

  return new Promise((resolve, reject) => {
    const proc = spawn(chromium, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--virtual-time-budget=6000",
      "--dump-dom",
      `file://${arquivo}`,
    ]);

    let saida = "";
    let erro = "";
    proc.stdout.on("data", (d) => (saida += d));
    proc.stderr.on("data", (d) => (erro += d));
    proc.on("error", reject);
    proc.on("close", () => {
      const casa = saida.match(
        /<div id="resultado">([\s\S]*?)<\/div>/
      );
      if (!casa) {
        reject(
          new Error(
            `a pagina nao devolveu resultado.\nstderr: ${erro.slice(0, 800)}`
          )
        );
        return;
      }
      const texto = casa[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'");
      try {
        resolve(JSON.parse(texto));
      } catch {
        reject(new Error(`resultado nao e JSON: ${texto.slice(0, 500)}`));
      }
    });
  });
}

const r = await rodar();

test("a pagina rodou -- sem isto todo caso abaixo e vacuo", () => {
  assert.equal(r.ok, true, `a pagina estourou: ${r.erro}`);
});

// ---------------------------------------------------------------------------
// SECAO 1: A LINHA DESENHA UM GESTO, E ELE E O CERTO
// ---------------------------------------------------------------------------

test("a conta de grupo de outro dono desenha UM botao, e e o de avisar", () => {
  assert.equal(r.a_tem_linha, true, "a linha nao foi desenhada");
  assert.equal(r.a_id_no_dom, O_ALUGUEL, "o marcador do DOM nao leva o id");
  // UM, e o numero e exato: `>= 1` passaria com os quatro da agenda do lado.
  assert.equal(r.a_botoes, 1, `a linha desenhou ${r.a_botoes} botoes`);
  assert.match(r.a_rotulo ?? "", /paguei minha parte/i);
});

test("o selo diz que a conta e do grupo, e nomeia qual", () => {
  // SEM O SELO a linha e INDISTINGUIVEL de uma conta de luz: mesmo formato,
  // mesmo vencimento, mesmo valor -- e as duas se pagam de formas diferentes.
  assert.match(r.a_selo ?? "", /Casa/);
});

test("o toque chama a rota nova, com o metodo e o id certos", () => {
  // A URL E COMPARADA COM O ID QUE ENTROU, e nao com um regex frouxo: e isso
  // que separa "chamou alguma coisa" de "chamou a baixa DESTA conta".
  assert.equal(r.chamadas.length, 1, "o toque nao chamou a rota (ou chamou duas vezes)");
  assert.equal(r.chamadas[0].method, "POST");
  assert.equal(
    r.chamadas[0].url,
    `/api/scheduled-transactions/${O_ALUGUEL}/minha-baixa`
  );
});

test("o toque NAO chama a rota de baixa -- era ela que respondia 404", () => {
  // O DEFEITO DESTA ISSUE, medido: a `Linha` comum monta `.../pay`, que filtra
  // `user_id` e responde 404 "Conta prevista nao encontrada" para quem nao e o
  // dono. A pessoa aperta o botao e leva um erro dizendo que a conta que ela
  // esta VENDO nao existe.
  for (const c of r.chamadas) {
    assert.ok(!/\/pay\b/.test(c.url), `a linha chamou a baixa do dono: ${c.url}`);
  }
});

test("depois do toque a tela recarrega e o toast fala", () => {
  // Sem a recarga o rotulo nao muda, e a pessoa toca de novo achando que nao
  // pegou. Sem o toast ela nao tem nenhum sinal de que pegou.
  assert.equal(r.recargas, 1);
  assert.deepEqual(r.toasts, [["success", "Avisamos quem criou a conta."]]);
});

// ---------------------------------------------------------------------------
// SECAO 2: OS TRES ESTADOS
// ---------------------------------------------------------------------------

test("quem ja avisou ve ESTADO no lugar do botao, e pode desfazer", () => {
  assert.equal(r.b_avisado, true, "o estado `avisou` nao apareceu");
  assert.equal(
    r.b_ainda_oferece_avisar,
    false,
    "a linha ofereceu `avisar` a quem ja avisou -- o segundo toque nao muda nada"
  );
  assert.equal(r.b_desfazer, true, "sem o desfazer, o toque por engano e definitivo");
  // A FRASE DIZ O QUE FALTA, E DE QUEM. "Avisado" sozinho nao diz se acabou.
  assert.match(r.b_texto, /falta quem criou a conta confirmar/i);
});

test("o desfazer manda DELETE na mesma rota", () => {
  assert.equal(r.chamada_do_desfazer.method, "DELETE");
  assert.equal(
    r.chamada_do_desfazer.url,
    `/api/scheduled-transactions/${O_ALUGUEL_AVISADO}/minha-baixa`
  );
});

test("depois de o dono confirmar nao sobra gesto nenhum", () => {
  // A policy de DELETE da 055 tem `status <> 'paid'`: um desfazer aqui so
  // poderia falhar.
  assert.equal(r.c_confirmada, true);
  assert.equal(r.c_botoes, 0, "sobrou botao depois do `paid`");
});

test("a tarja de atraso sai de `my_effective_status`, e nao do estado do DONO", () => {
  // O fixture D tem `effective_status: "paid"` (o dono pagou) e
  // `my_effective_status: "overdue"` (eu nao). Lendo a coluna errada, a conta
  // apareceria "em dia" para quem ainda deve a parte dela -- vencida ha
  // quatro dias e sem tarja vermelha.
  assert.match(r.d_texto, /4 dia\(s\) em atraso/);
});

// ---------------------------------------------------------------------------
// SECAO 3: OS QUATRO TITULOS DA AGENDA, LIDOS DO FONTE DA PAGINA
// ---------------------------------------------------------------------------

test("nenhum dos `title` das quatro acoes da agenda aparece nesta linha", () => {
  // VER O CABECALHO: a ausencia dos quatro e propriedade do DESPACHO, nao
  // deste componente, e quem a mede e
  // scripts/check-conta-de-grupo-na-agenda.mjs. O que esta assercao acrescenta
  // e a ANCORA: os titulos sao lidos do fonte de verdade da pagina, entao
  // renomear um deles quebra aqui em vez de deixar o guard textual casando com
  // o nome velho para sempre.
  // A ANCORA E A CONTAGEM, E NAO OS TEXTOS: tres dos quatro `title` da agenda
  // sao EXPRESSOES (`title={conta.recurring_rule_id ? ... : ...}`), nao
  // literais, e extrair os textos daqui seria um regex que casa com uma das
  // pontas do ternario -- `guard-que-acha-o-alvo-por-regex-cega-quando-o-
  // comando-muda`. O que se afirma e que a pagina AINDA tem quatro controles
  // titulados; o dia em que ela tiver menos, esta mensagem manda olhar para
  // la em vez de deixar o guard textual casando com um nome que ja morreu.
  const fonte = readFileSync(PAGINA_DE_CONTAS, "utf8");
  const quantosTitulos = (fonte.match(/\stitle=/g) ?? []).length;

  assert.ok(
    quantosTitulos >= 4,
    `so achei ${quantosTitulos} controles titulados em ${PAGINA_DE_CONTAS}: ` +
      "as quatro acoes da agenda mudaram de forma, e a divisao de trabalho " +
      "desta sonda com o check-conta-de-grupo-na-agenda.mjs precisa ser revista"
  );

  // E A LINHA NAO TEM NENHUM. Os quatro controles da agenda sao os unicos
  // titulados nas linhas desta tela, e esta aqui nao carrega nenhum deles.
  assert.deepEqual(
    r.a_titulos,
    [],
    `a linha da conta de grupo carrega acao titulada da agenda: ${r.a_titulos.join(", ")}`
  );
});
