#!/usr/bin/env node
// =====================================================
// SONDA: os botoes da linha de Despesas CABEM no iPhone? (HMO-457)
// =====================================================
//   node scripts/probe-acoes-da-linha-no-iphone.mjs
//
// "Despesas no IOs nao esta mostrando opcao de editar, pagar ou excluir."
//
// O QUE ESTA SONDA MEDE, E POR QUE ELA NAO E `test:mobile-overflow`
// ----------------------------------------------------------------
// `test:mobile-overflow` afirma sobre CLASSES, e `probe-mobile-overflow.mjs`
// afirma sobre `documentElement.scrollWidth > clientWidth` -- o documento
// INTEIRO andar para o lado. Nenhuma das duas olha DENTRO da linha, e a lista
// de rotas de `probe-mobile-overflow.mjs` ainda nao tinha
// `/dashboard/despesas` (nem receitas, nem transferencias): as tres telas
// nasceram na HMO-246, depois da varredura da HMO-168, e ninguem as
// acrescentou. Elas nunca foram medidas.
//
// O CRITERIO, EM TRES NIVEIS -- E A DIFERENCA ENTRE ELES E O ERRO QUE EU JA
// COMETI AQUI
// -------------------------------------------------------------------------
// A primeira versao desta sonda comparava a borda direita do botao com a
// borda de CONTEUDO da `CardContent` e, quando passava, concluia "o botao
// esta invisivel". **Isso estava errado, e o proprio numero provava:**
// `documentElement.scrollWidth === clientWidth` e a borda do botao caia DENTRO
// da viewport. Passar da borda de conteudo e so entrar no PADDING -- e padding
// nao recorta nada. Nao ha `overflow` em `Card`, em `CardContent`, nem em
// nenhum ancestral (`git grep overflow` nos tres arquivos = vazio), entao nada
// desaparece.
//
// Dai os tres niveis, que a sonda mede em vez de supor:
//
//   ok         -- dentro da area de conteudo da caixa;
//   no-padding -- passou da area de conteudo mas continua na viewport E nenhum
//                 ancestral recorta: FICA VISIVEL. Defeito cosmetico (o botao
//                 encosta na borda do cartao), nao causa de "nao aparece";
//   invisivel  -- fora da viewport, ou dentro de um ancestral que recorta de
//                 verdade. SO ESTE justifica "nao esta mostrando".
//
// A sonda procura o ancestral que recorta (`overflow` != `visible`) em vez de
// cravar que a `CardContent` recorta. Foi exatamente essa suposicao que me fez
// afirmar um mecanismo que nao existe.
//
// A FIDELIDADE, E O QUE ELA NAO COBRE
// -----------------------------------
// O CSS e o DE PRODUCAO, baixado de `/_next/static/css/`: as regras que
// decidem este defeito (`.device-mobile button{min-width:44px}`, os paddings
// de `main`/`container`/`CardContent`) sao as que estao no ar, e nao as que eu
// acho que estao.
//
// O DOM e uma REPRODUCAO FIEL da marcacao de `LinhaDaSecao` +
// `BotoesDaLinha` (components/movimentacoes/SecaoDaTela.tsx) e das classes de
// `Button` (components/ui/button.tsx), escrita a mao. Ela NAO e o componente
// compilado -- entao esta sonda mede LAYOUT, e nao a decisao de quais botoes
// existem (isso e `test:acoes-da-linha`, que roda sem navegador). Se a
// marcacao daqueles dois arquivos mudar, esta sonda passa a medir uma tela que
// nao existe mais; o `CONFERE_A_MARCACAO` abaixo e a guarda contra isso.
//
// A FONTE nao e a de producao (woff2 via next/font). Isso move a largura dos
// TEXTOS alguns pixels, e nao a dos botoes -- que e o que decide aqui, porque
// `min-width:44px` nao depende de fonte nenhuma.
// =====================================================

import { execFileSync } from "node:child_process";
import {
  readdirSync,
  existsSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CSS_DE_PRODUCAO =
  process.env.CSS_DE_PRODUCAO ||
  "https://pulodogato.hmoraes.com.br/_next/static/css/97b55be9d5264b0a.css";

/**
 * Acha um Chromium: o do `CHROMIUM_BIN`, o que o Playwright baixou, ou o
 * Chrome do sistema. Mesma busca das outras sondas de navegador deste
 * repositorio -- a pasta e LISTADA, nunca com a versao fixa no fonte (a
 * licao da HMO-365/HMO-406).
 */
function acharChromium() {
  const candidatos = [process.env.CHROMIUM_BIN];

  for (const base of [
    join(process.env.HOME || "/root", ".cache/ms-playwright"),
    "/root/.cache/ms-playwright",
    "/ms-playwright",
  ]) {
    if (!existsSync(base)) continue;
    for (const dir of readdirSync(base).sort().reverse()) {
      if (!/^chromium(_headless_shell)?-\d+$/.test(dir)) continue;
      for (const sufixo of [
        "chrome-linux64/chrome",
        "chrome-linux/chrome",
        "chrome-headless-shell-linux64/chrome-headless-shell",
      ]) {
        candidatos.push(join(base, dir, sufixo));
      }
    }
  }

  candidatos.push(
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  );

  return candidatos.find((c) => c && existsSync(c));
}

// -----------------------------------------------------------------------------
// A GUARDA DE FIDELIDADE
// -----------------------------------------------------------------------------
// Se a marcacao de SecaoDaTela.tsx mudar, esta sonda mede uma tela que nao
// existe mais e o verde dela nao vale nada. Estes sao os pedacos de que a
// reproducao abaixo depende; sumindo um, a sonda ABORTA em vez de medir.
const CONFERE_A_MARCACAO = [
  // a classe da linha
  'flex items-start justify-between gap-3 border-b border-border py-2 last:border-0',
  // a caixa dos botoes
  'flex shrink-0 items-center gap-1',
  // o botao de icone (Editar/Excluir/Confirmar)
  'h-8 w-8 p-0',
  // a coluna do texto e o valor
  'min-w-0 space-y-0.5',
  'shrink-0 font-semibold',
];

const fonteDaSecao = readFileSync(
  "components/movimentacoes/SecaoDaTela.tsx",
  "utf8",
);
const faltando = CONFERE_A_MARCACAO.filter((c) => !fonteDaSecao.includes(c));
if (faltando.length) {
  console.error(
    "ABORTADO: a marcacao de components/movimentacoes/SecaoDaTela.tsx mudou.\n" +
      "Esta sonda reproduz aquele DOM a mao, e sem estes pedacos ela mediria\n" +
      "uma tela que nao existe mais:\n" +
      faltando.map((c) => `  - ausente: ${c}`).join("\n"),
  );
  process.exit(2);
}

// -----------------------------------------------------------------------------
// O CSS DE PRODUCAO
// -----------------------------------------------------------------------------
let css;
try {
  css = execFileSync(
    "curl",
    ["-sS", "--fail", "-L", CSS_DE_PRODUCAO],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
} catch (erro) {
  console.error(
    `ABORTADO: nao baixei o CSS de producao (${CSS_DE_PRODUCAO}).\n` +
      "Sem ele esta sonda mediria paddings e o min-width de 44px que EU escrevi,\n" +
      "nao os que estao no ar -- e e exatamente essa a pergunta.\n" +
      `causa: ${erro.message}`,
  );
  process.exit(2);
}

// A regra que decide o defeito. Se ela nao estiver no CSS baixado, a medicao
// abaixo nao e sobre o iPhone de producao.
if (!/\.device-mobile[^{]*button\{[^}]*min-width:44px/.test(css)) {
  console.error(
    "ABORTADO: o CSS baixado nao tem `.device-mobile button{...min-width:44px}`.\n" +
      "Ou o arquivo mudou de hash, ou a regra saiu de producao. Nos dois casos\n" +
      "esta sonda mediria outra tela.",
  );
  process.exit(2);
}

// -----------------------------------------------------------------------------
// OS CASOS
// -----------------------------------------------------------------------------
// Cada caso e uma LINHA da lista de Despesas, com os botoes que
// `lib/acoes-da-linha.ts` daria a ela.
const CASOS = [
  {
    nome: "prevista comum (Confirmar + Editar + Excluir)",
    descricao: "Aluguel do apartamento",
    detalhe: "· 14/10 · Moradia · Conta corrente",
    valor: "R$ 3.500,00",
    botoes: ["confirmar", "editar", "excluir"],
  },
  {
    nome: "prevista de valor pequeno (Confirmar + Editar + Excluir)",
    descricao: "SONDA HMO-235",
    detalhe: "· 01/10 · Outros",
    valor: "R$ 0,37",
    botoes: ["confirmar", "editar", "excluir"],
  },
  {
    nome: "realizada (Editar + Excluir)",
    descricao: "Mercado do bairro",
    detalhe: "· 12/10 · Alimentacao · Nubank",
    valor: "R$ 412,90",
    botoes: ["editar", "excluir"],
  },
  {
    nome: "fatura do cartao (Pagar, com texto)",
    descricao: "Nubank",
    detalhe: "· 10/10 · fatura · ainda em aberto",
    valor: "R$ 1.842,55",
    botoes: ["pagar"],
  },
];

const LARGURAS = [320, 390, 430];

/** Um botao de icone, com as classes exatas de `Button size="sm"` + override. */
function botaoDeIcone(rotulo) {
  return (
    `<button data-botao="${rotulo}" aria-label="${rotulo}" ` +
    `class="inline-flex items-center justify-center whitespace-nowrap rounded-md ` +
    `text-sm font-medium ring-offset-background transition-colors h-9 px-3 ` +
    `border border-input bg-background h-8 w-8 p-0">` +
    `<svg class="h-4 w-4" viewBox="0 0 24 24"><path d="M3 3h18v18H3z"/></svg>` +
    `</button>`
  );
}

/** O botao "Pagar" -- o unico com TEXTO (`h-8 px-2`). */
function botaoDePagar() {
  return (
    `<button data-botao="Pagar" aria-label="Pagar" ` +
    `class="inline-flex items-center justify-center whitespace-nowrap rounded-md ` +
    `text-sm font-medium ring-offset-background transition-colors h-9 px-3 ` +
    `border border-input bg-background h-8 px-2">` +
    `<svg class="mr-1 h-4 w-4" viewBox="0 0 24 24"><path d="M3 3h18v18H3z"/></svg>` +
    `Pagar</button>`
  );
}

function linha(caso, indice) {
  const botoes = caso.botoes
    .map((b) => (b === "pagar" ? botaoDePagar() : botaoDeIcone(
      b === "confirmar" ? "Confirmar pagamento" : b === "editar" ? "Editar" : "Excluir",
    )))
    .join("");

  return `
    <div data-caso="${indice}" class="flex items-start justify-between gap-3 border-b border-border py-2 last:border-0">
      <div class="min-w-0 space-y-0.5">
        <p class="truncate font-medium text-foreground">${caso.descricao}</p>
        <p class="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span class="inline-flex items-center gap-1"><svg class="h-3 w-3" viewBox="0 0 24 24"><path d="M3 3h18v18H3z"/></svg></span>
          <span>${caso.detalhe}</span>
        </p>
      </div>
      <p class="shrink-0 font-semibold">${caso.valor}</p>
      <div data-acoes="${indice}" class="flex shrink-0 items-center gap-1">${botoes}</div>
    </div>`;
}

// A CADEIA DE CAIXAS ATE A LINHA, igual a de producao:
//   main px-4 (app/(dashboard)/layout.tsx:137)
//     -> div.container mx-auto (TelaDeMovimentacao.tsx:183)
//       -> Card -> CardContent p-6 pt-0 (components/ui/card.tsx)
//         -> div.space-y-1 -> a linha
function pagina(largura) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=${largura}">
<style>${css}</style>
</head>
<body class="device-ios device-mobile device-portrait">
  <div class="min-h-app bg-background">
    <div class="lg:pl-64">
      <main class="pt-6 px-4 sm:px-6 lg:px-8">
        <div class="container mx-auto py-6 space-y-6">
          <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
            <div class="p-6 pt-0">
              <div class="space-y-1">
                ${CASOS.map(linha).join("")}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
<pre id="medido"></pre>
<script>
(function () {
  var casos = ${JSON.stringify(CASOS.map((c) => ({ nome: c.nome, botoes: c.botoes })))};
  var saida = [];

  for (var i = 0; i < casos.length; i++) {
    var acoes = document.querySelector('[data-acoes="' + i + '"]');

    var caixa = acoes.closest('.p-6');
    var rCaixa = caixa.getBoundingClientRect();
    var pad = parseFloat(getComputedStyle(caixa).paddingRight) || 0;
    var limite = rCaixa.right - pad;

    // QUEM RECORTA DE VERDADE, se alguem recorta. Procurado, e nao suposto:
    // supor que a CardContent recortava foi o erro da primeira versao desta
    // sonda. Sem ancestral de overflow != visible, nada desaparece por aqui.
    var recorta = null;
    for (var a = acoes.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      var ov = getComputedStyle(a);
      if (ov.overflowX !== 'visible' || ov.overflowY !== 'visible') {
        var ra = a.getBoundingClientRect();
        recorta = {
          classe: (a.className || a.tagName).toString().slice(0, 60),
          overflowX: ov.overflowX,
          direita: Math.round(ra.right),
        };
        break;
      }
    }

    var botoes = [];
    var nos = acoes.querySelectorAll('[data-botao]');
    for (var j = 0; j < nos.length; j++) {
      var r = nos[j].getBoundingClientRect();
      var foraDaViewport = r.right > window.innerWidth;
      var recortado = recorta !== null && r.right > recorta.direita;
      botoes.push({
        rotulo: nos[j].getAttribute('data-botao'),
        esquerda: Math.round(r.left),
        direita: Math.round(r.right),
        largura: Math.round(r.width),
        estouro: Math.round(r.right - limite),
        // Os tres niveis do cabecalho:
        nivel:
          foraDaViewport || recortado
            ? 'invisivel'
            : r.right > limite
              ? 'no-padding'
              : 'ok',
      });
    }

    saida.push({
      caso: casos[i].nome,
      limiteDireito: Math.round(limite),
      larguraDaCaixa: Math.round(rCaixa.width - 2 * pad),
      recorta: recorta,
      botoes: botoes,
    });
  }

  document.getElementById('medido').textContent =
    'INICIO_JSON' + JSON.stringify({
      viewport: window.innerWidth,
      documentoEstoura:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      linhas: saida,
    }) + 'FIM_JSON';
})();
</script>
</body></html>`;
}

// -----------------------------------------------------------------------------
const chromium = acharChromium();
if (!chromium) {
  console.error(
    "ABORTADO: nenhum Chromium encontrado. Defina CHROMIUM_BIN ou instale com\n" +
      "`npx playwright install chromium`.",
  );
  process.exit(2);
}

const pasta = mkdtempSync(join(tmpdir(), "acoes-no-iphone-"));
console.log(`chromium: ${chromium}`);
console.log(`css de producao: ${CSS_DE_PRODUCAO} (${css.length} bytes)\n`);

let houveInvisivel = false;
let houvePadding = false;

for (const largura of LARGURAS) {
  const arquivo = join(pasta, `tela-${largura}.html`);
  writeFileSync(arquivo, pagina(largura));

  const dump = execFileSync(
    chromium,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      `--window-size=${largura},800`,
      "--virtual-time-budget=2000",
      "--dump-dom",
      `file://${arquivo}`,
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );

  const bruto = dump.match(/INICIO_JSON([\s\S]*?)FIM_JSON/);
  if (!bruto) {
    console.error(
      `ABORTADO em ${largura}px: o script da pagina nao deixou medicao no DOM.\n` +
        "Sem isso o resto desta execucao mediria o nada e sairia verde.",
    );
    process.exit(2);
  }

  // O `--dump-dom` serializa o textContent como HTML: todo `&` do JSON volta
  // como `&amp;`. (A armadilha que `test-lista-na-tela.mjs` ja documenta.)
  const medido = JSON.parse(
    bruto[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
  );

  console.log(`${"=".repeat(70)}`);
  console.log(`VIEWPORT ${medido.viewport}px   (declarado ${largura}px)`);
  console.log(
    `documento estoura? ${medido.documentoEstoura ? "SIM" : "NAO"} ` +
      `(scrollWidth ${medido.scrollWidth} vs clientWidth ${medido.clientWidth})`,
  );
  console.log(`${"=".repeat(70)}`);

  for (const l of medido.linhas) {
    console.log(`\n  ${l.caso}`);
    console.log(
      `    area util da CardContent: ${l.larguraDaCaixa}px, ` +
        `borda de conteudo em x=${l.limiteDireito}`,
    );
    console.log(
      `    ancestral que RECORTA: ` +
        (l.recorta
          ? `${l.recorta.classe} (overflow-x: ${l.recorta.overflowX}, direita x=${l.recorta.direita})`
          : "nenhum -- nada aqui pode desaparecer por recorte"),
    );
    for (const b of l.botoes) {
      if (b.nivel === "invisivel") houveInvisivel = true;
      if (b.nivel === "no-padding") houvePadding = true;
      const marca =
        b.nivel === "invisivel" ? "INVISIVEL" : b.nivel === "no-padding" ? "no-padding" : "ok";
      console.log(
        `    ${marca.padEnd(10)} ${b.rotulo.padEnd(22)} ` +
          `x=${String(b.esquerda).padStart(4)}..${String(b.direita).padStart(4)} ` +
          `larg=${String(b.largura).padStart(3)}px` +
          (b.estouro > 0 ? `   (+${b.estouro}px da borda de conteudo)` : ""),
      );
    }
  }
  console.log("");
}

console.log("=".repeat(70));
if (houveInvisivel) {
  console.log(
    "RESULTADO: ha botao FORA DA VIEWPORT ou dentro de ancestral que recorta.\n" +
      "Este si justifica 'nao esta mostrando'.",
  );
} else if (houvePadding) {
  console.log(
    "RESULTADO: nenhum botao invisivel. O que ha e botao entrando no PADDING\n" +
      "do cartao nas larguras estreitas -- ele encosta na borda e fica feio,\n" +
      "mas CONTINUA VISIVEL E CLICAVEL (nenhum ancestral recorta, e a borda\n" +
      "direita dele cai dentro da viewport).\n" +
      "\n" +
      "Ou seja: o LAYOUT NAO E a causa de 'Despesas no iOS nao mostra editar,\n" +
      "pagar ou excluir'. Os proximos suspeitos, nesta ordem:\n" +
      "  1. os botoes existem mas vem DESABILITADOS -- `online = estado ===\n" +
      "     \"fresco\"` em ListaDeMovimentacao.tsx desliga as tres acoes quando\n" +
      "     a leitura veio do cache do service worker (`do-aparelho`), e\n" +
      "     `disabled:opacity-50` as deixa meio transparentes. E o caso do\n" +
      "     PWA instalado no iPhone com rede ruim (NetworkFirst, 10s);\n" +
      "  2. os botoes nao existem -- `podeAgirNaLinha` recusa a linha por\n" +
      "     `gravada: false` ou `posso_editar: false` (lib/acoes-da-linha.ts).\n" +
      "     Isso e DADO, nao plataforma: medir com a conta de quem reclamou.",
  );
} else {
  console.log(
    "RESULTADO: todo botao dentro da area de conteudo, em todas as larguras.\n" +
      "O layout esta limpo; a causa esta em quais botoes existem ou no estado\n" +
      "`disabled`, nao na geometria.",
  );
}
console.log("=".repeat(70));
