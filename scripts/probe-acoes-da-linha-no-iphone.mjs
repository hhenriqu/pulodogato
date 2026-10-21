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

const APP_EM_PRODUCAO =
  process.env.APP_EM_PRODUCAO || "https://pulodogato.hmoraes.com.br";

/**
 * O CSS de producao, DESCOBERTO e nao cravado.
 *
 * A primeira versao desta sonda trazia o hash no fonte
 * (`.../css/97b55be9d5264b0a.css`), e ele durou um deploy: na HMO-475 a sonda
 * abortou com 404 porque `main` tinha andado e o hash do bundle anda com ela
 * (`hash-de-chunk-local-nao-bate-com-a-vercel`). Um hash cravado transforma
 * "a tela mudou" e "alguem publicou" no MESMO sintoma, e o segundo acontece
 * toda semana.
 *
 * `/login` e nao `/dashboard`: a tela de dentro exige sessao e devolveria o
 * HTML do redirecionamento, sem `<link>` nenhum. O bundle de CSS do Next e
 * UNICO para o app (um arquivo por build, nao por rota), entao o de `/login`
 * carrega as mesmas regras que decidem esta medicao -- e a guarda do
 * `min-width:44px` logo abaixo e o que prova isso em vez de supor.
 */
function acharCssDeProducao() {
  if (process.env.CSS_DE_PRODUCAO) return process.env.CSS_DE_PRODUCAO;

  let html;
  try {
    html = execFileSync("curl", ["-sS", "--fail", "-L", `${APP_EM_PRODUCAO}/login`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (erro) {
    console.error(
      `ABORTADO: nao abri ${APP_EM_PRODUCAO}/login para descobrir o CSS.\n` +
        "Passe CSS_DE_PRODUCAO=<url> se o app estiver fora do ar.\n" +
        `causa: ${erro.message}`,
    );
    process.exit(2);
  }

  const achado = /\/_next\/static\/css\/[a-z0-9]+\.css/.exec(html);
  if (!achado) {
    console.error(
      `ABORTADO: ${APP_EM_PRODUCAO}/login nao tem <link> para /_next/static/css/.\n` +
        "Sem o CSS de producao esta sonda mediria os paddings e o min-width de\n" +
        "44px que EU escrevi, nao os que estao no ar.",
    );
    process.exit(2);
  }

  return `${APP_EM_PRODUCAO}${achado[0]}`;
}

const CSS_DE_PRODUCAO = acharCssDeProducao();

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
  // -------------------------------------------------------------------------
  // A FIACAO DO MOTIVO -- HMO-475
  // -------------------------------------------------------------------------
  // Sem estes quatro pedacos a sonda mediria `title` que ela mesma escreveu:
  // o DOM abaixo e uma reproducao A MAO, e um `title` hard-coded nele passaria
  // verde com o JSX de producao mandando o rotulo pelado. (QUE O COMPONENTE
  // de fato use estas funcoes e `npm run test:secao-da-tela`, que renderiza o
  // arquivo compilado; aqui a guarda e textual de proposito.)
  'const motivoTravado = motivoDoBotaoTravado({',
  'title={tituloDoBotao(',
  'aria-disabled={travado || undefined}',
  // o motivo na CAIXA das acoes: e dele que sai a dica alcancavel pelo mouse,
  // porque o botao travado tem `pointer-events: none`
  'title={motivoTravado ?? undefined}',
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
// AS FRASES, LIDAS DE `lib/acoes-da-linha.ts` -- HMO-475
// -----------------------------------------------------------------------------
// Copiadas para ca, elas seriam a sonda conferindo a propria copia. O fonte e a
// fonte: se a frase mudar la, esta sonda passa a medir a frase nova, e se a
// constante SAIR ela aborta.
function fraseDaLib(nome) {
  const fonte = readFileSync("lib/acoes-da-linha.ts", "utf8");
  const achado = new RegExp(
    `export const ${nome}\\s*=\\s*\\n?\\s*"([^"]+)"`,
  ).exec(fonte);
  if (!achado) {
    console.error(
      `ABORTADO: nao achei \`export const ${nome} = "..."\` em\n` +
        "lib/acoes-da-linha.ts. Ou a constante mudou de nome, ou ela saiu -- nos\n" +
        "dois casos esta sonda mediria uma explicacao que o app nao da.",
    );
    process.exit(2);
  }
  // `title="..."` monta com aspas duplas; uma aspa dentro da frase quebraria o
  // atributo e a sonda mediria um DOM diferente do que ela pensa ter escrito.
  if (achado[1].includes('"')) {
    console.error(`ABORTADO: ${nome} tem aspa dupla -- ver o comentario acima.`);
    process.exit(2);
  }
  return achado[1];
}

const MOTIVO_SEM_REDE = fraseDaLib("MOTIVO_SEM_REDE");
const MOTIVO_ACAO_NESTA_LINHA = fraseDaLib("MOTIVO_ACAO_NESTA_LINHA");

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

/**
 * OS DOIS ESTADOS DA LISTA -- HMO-475.
 *
 * `fresco` e a leitura que veio da rota; `do-aparelho` e a que veio do cache do
 * service worker (`x-pulodogato-do-aparelho: 1`, `/api/*` NetworkFirst com 10s
 * de paciencia). `ListaDeMovimentacao` faz `online = estado === "fresco"`, e
 * `SecaoDaTela` deriva `travado = acoes.agindo !== null || !acoes.online` -- os
 * quatro botoes recebem aquele `travado` no `disabled`.
 *
 * Desligar a acao sem rede e DELIBERADO e continua certo: escrita sem rede neste
 * caminho nao fica pendente, ela FALHA. O que esta sonda mede e se o cinza vem
 * com explicacao ALCANCAVEL.
 */
const ESTADOS = [
  { nome: "fresco", travado: false, motivo: null },
  { nome: "do-aparelho", travado: true, motivo: MOTIVO_SEM_REDE },
];

// -----------------------------------------------------------------------------
// A CLASSE DO BOTAO, LIDA DE `components/ui/button.tsx`
// -----------------------------------------------------------------------------
// A versao anterior desta sonda copiava a classe base a mao -- e a copia tinha
// PERDIDO justamente `disabled:pointer-events-none disabled:opacity-50`, que sao
// as duas regras que decidem esta issue. Com a copia, o estado `do-aparelho`
// desenharia opaco e clicavel e a sonda diria que esta tudo bem.
const fonteDoBotao = readFileSync("components/ui/button.tsx", "utf8");
const BASE_DO_BOTAO = /cva\(\s*\n?\s*"([^"]+)"/.exec(fonteDoBotao)?.[1];
if (!BASE_DO_BOTAO || !/disabled:opacity-50/.test(BASE_DO_BOTAO)) {
  console.error(
    "ABORTADO: nao extrai a classe base de components/ui/button.tsx (ou ela\n" +
      "perdeu `disabled:opacity-50`). Sao essas regras que fazem o botao travado\n" +
      "ficar cinza; sem elas esta sonda mediria outro botao.",
  );
  process.exit(2);
}
const OUTLINE = /outline:\s*\n?\s*"([^"]+)"/.exec(fonteDoBotao)?.[1] ?? "";
const TAMANHO_SM = /sm:\s*"([^"]+)"/.exec(fonteDoBotao)?.[1] ?? "";

const classeDoBotao = (override) =>
  `${BASE_DO_BOTAO} ${OUTLINE} ${TAMANHO_SM} ${override}`;

/** O `title` de producao: `tituloDoBotao(rotulo, motivo)`. */
const tituloDoBotao = (rotulo, motivo) =>
  motivo ? `${rotulo} — ${motivo}` : rotulo;

/** Os atributos que o estado travado acrescenta -- os mesmos do JSX. */
const atributosDeTravamento = (rotulo, estado) =>
  estado.travado
    ? ` disabled aria-disabled="true" title="${tituloDoBotao(rotulo, estado.motivo)}"`
    : ` title="${rotulo}"`;

/** Um botao de icone, com as classes exatas de `Button size="sm"` + override. */
function botaoDeIcone(rotulo, estado) {
  return (
    `<button data-botao="${rotulo}" aria-label="${rotulo}"` +
    atributosDeTravamento(rotulo, estado) +
    ` class="${classeDoBotao("h-8 w-8 p-0")}">` +
    `<svg class="h-4 w-4" viewBox="0 0 24 24"><path d="M3 3h18v18H3z"/></svg>` +
    `</button>`
  );
}

/** O botao "Pagar" -- o unico com TEXTO (`h-8 px-2`). */
function botaoDePagar(estado) {
  return (
    `<button data-botao="Pagar" aria-label="Pagar"` +
    atributosDeTravamento("Pagar", estado) +
    ` class="${classeDoBotao("h-8 px-2")}">` +
    `<svg class="mr-1 h-4 w-4" viewBox="0 0 24 24"><path d="M3 3h18v18H3z"/></svg>` +
    `Pagar</button>`
  );
}

function linha(caso, indice, estado) {
  const botoes = caso.botoes
    .map((b) => (b === "pagar" ? botaoDePagar(estado) : botaoDeIcone(
      b === "confirmar" ? "Confirmar pagamento" : b === "editar" ? "Editar" : "Excluir",
      estado,
    )))
    .join("");

  // O `title` NA CAIXA das acoes, e nao so nos botoes: o botao travado tem
  // `pointer-events: none`, entao e esta caixa que recebe o mouse. A sonda mede
  // a travessia com `elementFromPoint` em vez de supor.
  const tituloDaCaixa = estado.motivo ? ` title="${estado.motivo}"` : "";

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
      <div data-acoes="${indice}" class="flex shrink-0 items-center gap-1"${tituloDaCaixa}>${botoes}</div>
    </div>`;
}

// A CADEIA DE CAIXAS ATE A LINHA, igual a de producao:
//   main px-4 (app/(dashboard)/layout.tsx:137)
//     -> div.container mx-auto (TelaDeMovimentacao.tsx:183)
//       -> Card -> CardContent p-6 pt-0 (components/ui/card.tsx)
//         -> div.space-y-1 -> a linha
function pagina(largura, estado) {
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
                ${CASOS.map((c, i) => linha(c, i, estado)).join("")}
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

      // -------------------------------------------------------------------
      // A EXPLICACAO DO CINZA -- HMO-475
      // -------------------------------------------------------------------
      // SEM ACENTO GRAVE AQUI DENTRO: este script inteiro e o corpo de um
      // template literal do Node, e um acento grave num comentario FECHA o
      // literal -- o erro que sai e "Unexpected identifier" na linha do
      // comentario, que se le como erro de JS da pagina.
      //
      // opacidade/ponteiro sao o cinza MEDIDO com o CSS de producao, e nao a
      // classe suposta. E dicaAlcancavel e a pergunta que decide se o title
      // serve para alguem: com pointer-events none o botao nao recebe mouse,
      // entao quem responde o hover e o elemento que elementFromPoint devolve
      // no centro dele.
      var estilo = getComputedStyle(nos[j]);
      var centroX = Math.min(r.left + r.width / 2, window.innerWidth - 1);
      var centroY = r.top + r.height / 2;
      var sob = document.elementFromPoint(centroX, centroY);
      var alvoComTitulo = sob;
      while (alvoComTitulo && !alvoComTitulo.getAttribute('title')) {
        alvoComTitulo = alvoComTitulo.parentElement;
      }

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
        desabilitado: nos[j].disabled,
        ariaDisabled: nos[j].getAttribute('aria-disabled'),
        title: nos[j].getAttribute('title'),
        opacidade: estilo.opacity,
        ponteiro: estilo.pointerEvents,
        sobOCentro: sob ? (sob.getAttribute('data-botao') ? 'o proprio botao' : (sob.getAttribute('data-acoes') !== null ? 'a caixa das acoes' : (sob.className || sob.tagName).toString().slice(0, 40))) : 'nada',
        // A dica que o navegador mostraria ao passar o mouse no centro do
        // botao: o primeiro title subindo de elementFromPoint.
        dicaAlcancavel: alvoComTitulo ? alvoComTitulo.getAttribute('title') : null,
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

/** Os desvios da explicacao do cinza -- HMO-475. Vazio = a explicacao chega. */
const semExplicacao = [];
/** O que foi MEDIDO do cinza, para o relatorio nao depender de suposicao. */
const cinzaMedido = [];

for (const estado of ESTADOS) {
  for (const largura of LARGURAS) {
    const arquivo = join(pasta, `tela-${estado.nome}-${largura}.html`);
    writeFileSync(arquivo, pagina(largura, estado));

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
        `ABORTADO em ${estado.nome}/${largura}px: o script da pagina nao deixou\n` +
          "medicao no DOM. Sem isso o resto desta execucao mediria o nada e\n" +
          "sairia verde.",
      );
      process.exit(2);
    }

    // O `--dump-dom` serializa o textContent como HTML: todo `&` do JSON volta
    // como `&amp;`. (A armadilha que `test-lista-na-tela.mjs` ja documenta.)
    const medido = JSON.parse(
      bruto[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
    );

    console.log(`${"=".repeat(70)}`);
    console.log(
      `ESTADO ${estado.nome.toUpperCase()}   ` +
        `VIEWPORT ${medido.viewport}px   (declarado ${largura}px)`,
    );
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

        // ---------------------------------------------------------------
        // A EXPLICACAO DO CINZA -- HMO-475
        // ---------------------------------------------------------------
        const onde = `${estado.nome}/${largura}px/${l.caso}/${b.rotulo}`;

        if (!estado.travado) {
          // O CONTROLE NEGATIVO: com rede o botao nao esta cinza, e nao pode
          // ter motivo nenhum pendurado. Sem este ramo, um `title` que
          // dissesse "sem rede" SEMPRE passaria no ramo de baixo.
          if (b.desabilitado) {
            semExplicacao.push(`${onde}: botao DESABILITADO no estado fresco`);
          }
          if (b.ariaDisabled !== null) {
            semExplicacao.push(`${onde}: aria-disabled com rede (${b.ariaDisabled})`);
          }
          if (b.title !== b.rotulo) {
            semExplicacao.push(
              `${onde}: title com rede deveria ser o rotulo pelado, e e "${b.title}"`,
            );
          }
          if (Number(b.opacidade) !== 1) {
            semExplicacao.push(`${onde}: opacidade ${b.opacidade} com rede`);
          }
          continue;
        }

        // O estado `do-aparelho`: o botao TEM de estar cinza (senao a sonda
        // mediria o estado errado) e TEM de explicar.
        if (!b.desabilitado) {
          semExplicacao.push(`${onde}: nao esta desabilitado no estado do-aparelho`);
        }
        if (b.ariaDisabled !== "true") {
          semExplicacao.push(`${onde}: aria-disabled=${JSON.stringify(b.ariaDisabled)}`);
        }
        if (!b.title || !b.title.includes(MOTIVO_SEM_REDE)) {
          semExplicacao.push(`${onde}: o title nao diz o motivo (${JSON.stringify(b.title)})`);
        }
        if (!b.title || !b.title.startsWith(b.rotulo)) {
          semExplicacao.push(`${onde}: o title perdeu o rotulo (${JSON.stringify(b.title)})`);
        }
        // E A FRASE DO OUTRO ESTADO NAO PODE APARECER AQUI: uma explicacao
        // unica para os tres estados passaria em todo `includes` acima e diria
        // "aguarde o fim da acao" para quem so esta sem rede.
        if (b.title && b.title.includes(MOTIVO_ACAO_NESTA_LINHA)) {
          semExplicacao.push(`${onde}: o title diz a frase do \`agindo\` sem haver acao`);
        }
        // A DICA ALCANCAVEL: esta e a assercao que nao se adivinha. Se o botao
        // travado tem `pointer-events: none`, o `title` dele nunca aparece no
        // hover -- quem responde e a caixa das acoes.
        if (!b.dicaAlcancavel || !b.dicaAlcancavel.includes(MOTIVO_SEM_REDE)) {
          semExplicacao.push(
            `${onde}: passar o mouse no centro nao alcanca motivo nenhum ` +
              `(sob o centro: ${b.sobOCentro}, dica: ${JSON.stringify(b.dicaAlcancavel)})`,
          );
        }

        cinzaMedido.push({
          onde,
          opacidade: b.opacidade,
          ponteiro: b.ponteiro,
          sobOCentro: b.sobOCentro,
        });

        console.log(
          `               ^ cinza medido: opacity=${b.opacidade} ` +
            `pointer-events=${b.ponteiro}; sob o centro esta ${b.sobOCentro}`,
        );
        console.log(`               ^ title: ${JSON.stringify(b.title)}`);
        console.log(
          `               ^ dica alcancavel pelo mouse: ${JSON.stringify(b.dicaAlcancavel)}`,
        );
      }
    }
    console.log("");
  }
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

// -----------------------------------------------------------------------------
// O BOTAO CINZA EXPLICA POR QUE ESTA CINZA? -- HMO-475
// -----------------------------------------------------------------------------
console.log("");
console.log("=".repeat(70));
console.log("HMO-475: o cinza vem com explicacao ALCANCAVEL?");
console.log("=".repeat(70));

if (!cinzaMedido.length) {
  console.error(
    "ABORTADO: nenhum botao cinza foi medido. O estado `do-aparelho` nao\n" +
      "produziu botao desabilitado nenhum, entao as assercoes acima passaram\n" +
      "por vacuidade -- que e exatamente o modo de falha que esta secao existe\n" +
      "para nao ter.",
  );
  process.exit(2);
}

// O CINZA MEDIDO, e nao a classe suposta: os dois numeros abaixo sao de onde
// sai a pergunta "cinza ou ausente?" que custou 6h na HMO-457.
const opacidades = [...new Set(cinzaMedido.map((c) => c.opacidade))];
const ponteiros = [...new Set(cinzaMedido.map((c) => c.ponteiro))];
const centros = [...new Set(cinzaMedido.map((c) => c.sobOCentro))];
console.log(`botoes cinzas medidos: ${cinzaMedido.length}`);
console.log(`  opacity:        ${opacidades.join(", ")}`);
console.log(`  pointer-events: ${ponteiros.join(", ")}`);
console.log(`  sob o centro:   ${centros.join(", ")}`);

if (ponteiros.includes("none")) {
  console.log(
    "\nNOTA (medida, nao suposta): `disabled:pointer-events-none` deixa o botao\n" +
      "travado transparente ao mouse, entao o `title` DELE nunca abre a dica no\n" +
      "hover -- o ponteiro para na caixa das acoes. Por isso o mesmo motivo vai\n" +
      "nos DOIS lugares: no botao (onde e a descricao acessivel que o leitor de\n" +
      "tela anuncia depois do nome) e na caixa (onde o mouse o alcanca).",
  );
}

if (semExplicacao.length) {
  console.error(
    `\nREPROVADO: ${semExplicacao.length} desvio(s) -- o cinza nao se explica:\n` +
      semExplicacao.map((d) => `  - ${d}`).join("\n") +
      "\n\nE este e o defeito inteiro da HMO-475: desligar a acao sem rede esta\n" +
      "CERTO (escrita sem rede neste caminho FALHA, nao fica pendente), e o que\n" +
      "falta e a explicacao. Sem ela, 'cinza' e indistinguivel de 'nunca\n" +
      "desenhado' para quem olha a linha -- e foi essa ambiguidade que deixou a\n" +
      "HMO-457 parada 6h esperando a resposta de uma pergunta so.",
  );
  process.exit(1);
}

console.log(
  "\nAPROVADO: nos dois estados o botao diz o que precisa dizer.\n" +
    `  fresco       -- nenhum botao cinza; o title de cada um e o rotulo pelado,\n` +
    `                  sem aria-disabled e com opacity 1;\n` +
    `  do-aparelho  -- todos cinzas, com aria-disabled="true", o title levando\n` +
    `                  rotulo + motivo, e a dica do motivo alcancavel pelo mouse\n` +
    `                  no centro de cada botao.\n` +
    `  a frase medida: ${JSON.stringify(MOTIVO_SEM_REDE)}`,
);
console.log("=".repeat(70));
