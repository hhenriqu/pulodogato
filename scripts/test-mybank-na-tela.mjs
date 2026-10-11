// =====================================================
// A TELA DO MYBANK, EM CHROMIUM -- HMO-371 (F3 da HMO-368)
// =====================================================
//   npm run test:mybank-na-tela
//
// O QUE ESTA SUITE PROVA, E POR QUE CADA UMA PRECISA DE NAVEGADOR
// ---------------------------------------------------------------
// Os tres itens que a issue nomeia, e nenhum deles e verificavel sem render:
//
//   A. O SELETOR DO CABECALHO LISTA SO CONTA DE INVESTIMENTO. A rota recusa
//      conta corrente (`conta_credora_nao_e_investimento`) e a trigger da 053
//      recusa depois dela -- entao o defeito nao e dinheiro errado, e um
//      formulario que OFERECE uma opcao que sempre falha. Nada compila errado,
//      nada responde 500: a pessoa escolhe a conta corrente, aperta e leva uma
//      recusa que nao sabia que ia levar. Contar as `<option>` do DOM e a unica
//      forma de medir isso.
//
//   B. O FORMULARIO RECUSA CONEXAO NAO ACEITA, pelos DOIS lados: quem esta
//      `pending` nao aparece como opcao, e apertar "Emprestar" sem conexao
//      aceita escolhida devolve a frase de `mensagemDoProblema` e NAO chama a
//      rota. O caso tem controle positivo ao lado (a conexao ACEITA e aceita, e
//      o POST sai com o `devedor_id` dela) -- sem ele, um formulario que
//      recusasse TODO mundo passaria a assercao de recusa.
//
//   C. A LINHA DE "A RECEBER" MOSTRA OS TRES CAMPOS: valor, `n de m` e quem
//      deve pagar. Uma linha com dois deles fica com aparencia perfeita, e e
//      por isso que a assercao e sobre cada ancora (`data-quem-deve`,
//      `data-parcela-rotulo`, `data-valor`) e nao sobre o texto da linha: "Você
//      mesmo" e o nome da conexao aparecem em outros lugares da tela, e uma
//      assercao sobre o texto todo continuaria verde com o campo apagado.
//
//   D. (o lado do devedor) O SELO "MyBank — <quem emprestou>" em Contas a
//      Pagar, com o caso do nome ILEGIVEL ao lado -- ali o selo diz so "MyBank"
//      e a parcela CONTINUA na lista. E o botao de avisar que pagou mandando
//      `status: "reported"`, nunca `paid`.
//
// COMO A PAGINA E MONTADA (e os quatro becos que ela evita)
// --------------------------------------------------------
// A receita e a de `testar-dom-em-chromium-aqui`, a mesma das sondas irmas:
// `file://` + `<script>` CLASSICO + `--dump-dom`, React pelo UMD INLINE,
// `ReactDOM.render` legado (o `createRoot` nao renderiza sincrono o suficiente
// para a foto), e a leitura ancorada numa `<div id="resultado">`.
//
// A PAGINA INTEIRA E UMA IIFE `async` com `try/catch` PROPRIO: os componentes
// leem a rede, a continuacao de um `await` e um microtask, e `flushSync` sozinho
// fotografa a tela ANTES da resposta. E a rejeicao de uma IIFE async nao cai em
// try de fora nenhum.
//
// O QUE E CODIGO DE PRODUCAO E O QUE E ESBOCO
// -------------------------------------------
// PRODUCAO, compilado e intacto (ver `PARTES`): `lib/dinheiro`, `lib/moeda`,
// `lib/lancamento`, `lib/transferencia`, `lib/emprestimo-do-mybank`,
// `lib/contas`, `lib/mybank-na-tela`, `lib/data-digitada`, `lib/data-na-tela`,
// os cinco primitivos de `components/ui`, `PerguntaDaBaseDoValor`,
// `PainelDoMyBank` e `ParcelasDoMyBankQueEuDevo`.
//
// PRODUCAO EXTRAIDA por regex: `formatCurrency` de `lib/utils.js`. Ela e
// AUTO-CONTIDA (so usa `Intl`), e a lib inteira nao entra porque importa `clsx`
// e `tailwind-merge`. Ela NAO podia ser esboco: a issue exige que o `R$` saia
// com NBSP, e um esboco com espaco comum (ou um marcador) faria a assercao do
// NBSP medir a propria sonda.
//
// ESBOCO, cada um com motivo e limite:
//   - `cn`: clsx + tailwind-merge. Calculo de string, sem comportamento.
//   - `cva` e `Slot`: o `button`/`badge` e o `asChild`. Idem.
//   - os sete icones: SVG com `data-icone`. Icone novo no componente estoura
//     como `ReferenceError` -- e isso e BOM, e o alarme de
//     `import-novo-no-componente-derruba-a-sonda-de-navegador`.
//   - `toast`: um registrador. Nenhuma assercao daqui le o texto do toast; o
//     que elas leem e a CHAMADA que saiu (`CHAMADAS`).
//   - `CampoDeValor` e `CampoDeData`: inputs controlados que devolvem o valor
//     CRU. E uma concessao de verdade, e vale dizer o limite: as mascaras tem
//     suite propria (`npm run test:campos-lancamento`, `npm run check-campo-de-
//     data`, as suites de `lib/dinheiro`), e nenhuma assercao desta sonda le
//     mascara. O contrato esta respeitado -- os dois componentes de verdade
//     emitem o valor PLANO pelo `onChange`, que e exatamente o que o esboco
//     emite --, entao o corpo do POST medido aqui e o corpo de verdade.
//
// O QUE ESTA SUITE NAO PROVA
// --------------------------
// Que a rota grava. Isso e `npm run test:emprestimo-do-mybank` (F2), com duble
// de client, e e lá que o Caso B nao escrever linha minha esta medido. Aqui o
// que se mede e o que SAI do aparelho e o que aparece na tela.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SAIDA = ".tmp-mybank-na-tela";

/**
 * Acha um Chromium: o do `CHROMIUM_BIN`, o que o Playwright baixou, ou o Chrome
 * do sistema (o runner do Actions ja vem com um).
 *
 * A VERSAO DO PLAYWRIGHT NAO ESTA FIXA AQUI, de proposito. As quatro sondas
 * antigas tem `chromium-1243` escrito no fonte, e o dia em que a maquina subiu
 * para a 1248 as quatro ficaram 100% vermelhas numa arvore intocada -- com a
 * mensagem verdadeira ("Nenhum Chromium encontrado") aparecendo UMA vez no meio
 * de dezenas de `TypeError` identicos. Aqui a pasta e VARRIDA: qualquer
 * `chromium-*` serve, e o proximo bump nao derruba esta suite.
 */
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

if (!existsSync(join(SAIDA, "components/mybank/PainelDoMyBank.js"))) {
  throw new Error(
    `${SAIDA}/ nao existe. Rode por \`npm run test:mybank-na-tela\`, ` +
      "que e quem compila os componentes antes do teste."
  );
}

/** Tira so a fiacao de modulo, deixando o corpo das funcoes intacto. */
const paraScriptClassico = (fonte) =>
  fonte
    // O `import` emitido pelo tsc ocupa mais de uma linha quando a lista de
    // nomes e longa: o recorte e do `import` ate o `;`, nao de uma linha so.
    .replace(/^import\s[\s\S]*?;$/gm, "")
    // O `export { A, B };` de fim de arquivo, INTEIRO e antes da regra de
    // baixo: tirar so a palavra deixaria `{ A, B };`, que e SyntaxError.
    .replace(/^export\s*\{[^}]*\}\s*;$/gm, "")
    .replace(/^export /gm, "")
    // O `"use client";` de topo. Inofensivo num script, mas tira-lo mantem o
    // relatorio de "sobrou fiacao" legivel.
    .replace(/^"use client";$/gm, "");

/**
 * UM PEDACO AUTO-CONTIDO DE UMA LIB QUE A PAGINA NAO CARREGA INTEIRA.
 *
 * `rotulo` entra na mensagem porque uma extracao que nao casa e o modo de falha
 * caro: ela deixaria o nome `undefined` na pagina, e o sintoma seria um
 * `TypeError` vinte linhas depois, sem dizer que a ancora mudou.
 */
function daLib(arquivo, fonte, regex, rotulo) {
  const achado = regex.exec(fonte);
  if (!achado) {
    throw new Error(
      `nao achei ${rotulo} em ${arquivo}: a ancora da extracao mudou.\n` +
        "ou ajuste o regex, ou ponha a lib inteira em PARTES"
    );
  }
  return achado[0].replace(/^export /m, "");
}

/**
 * `formatCurrency` DE PRODUCAO, e nao esboco -- ver o cabecalho.
 *
 * `lib/utils.js` inteira nao entra: ela importa `clsx` e `tailwind-merge`. A
 * funcao e auto-contida (so `Intl`), entao vem extraida.
 */
const FORMAT_CURRENCY = daLib(
  "lib/utils.js",
  readFileSync(join(SAIDA, "lib/utils.js"), "utf8"),
  /^export function formatCurrency\([\s\S]*?^\}/m,
  "formatCurrency"
);

const PARTES = [
  // ORDEM DE DEPENDENCIA. Nao e exigencia do JavaScript para funcao declarada
  // (ela e iceada), mas e para `const` de modulo -- e quase todos tem varios.
  "lib/dinheiro.js",
  "lib/moeda.js",
  "lib/lancamento.js",
  "lib/transferencia.js",
  "lib/emprestimo-do-mybank.js",
  "lib/contas.js",
  "lib/mybank-na-tela.js",
  "lib/data-digitada.js",
  "lib/data-na-tela.js",
  "components/ui/button.js",
  "components/ui/card.js",
  "components/ui/badge.js",
  "components/ui/input.js",
  "components/ui/label.js",
  "components/movimentacoes/PerguntaDaBaseDoValor.js",
  "components/mybank/PainelDoMyBank.js",
  "components/mybank/ParcelasDoMyBankQueEuDevo.js",
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
    throw new Error(
      `${parte} nao parseia depois do strip: ${e.message}\n` +
        "ajuste paraScriptClassico()"
    );
  }

  return fonte;
}).join("\n");

try {
  new Function(producao);
} catch (e) {
  throw new Error(
    `as partes juntas nao parseiam: ${e.message}\n` +
      "provavelmente duas delas declaram o mesmo nome no topo"
  );
}

/** O React UMD, inline: `<script src>` entre arquivos file:// e outra briga. */
const umd = (pacote, arquivo) =>
  readFileSync(join("node_modules", pacote, "umd", arquivo), "utf8");

// --- os ids do fixture, do lado do node --------------------------------------
//
// Eles existem AQUI e nao so dentro da pagina de proposito: a assercao do corpo
// do POST compara o `devedor_id` que saiu com o id que entrou, e um literal
// escrito nos dois lugares e o que torna essa comparacao real.
const CARTEIRA = "c1111111-1111-4111-b111-111111111111";
const TESOURO = "c2222222-2222-4222-b222-222222222222";
const CORRENTE = "c3333333-3333-4333-b333-333333333333";
const LAIS = "d1111111-1111-4111-b111-111111111111";
const BRUNO = "d2222222-2222-4222-b222-222222222222";
const CARLA = "d3333333-3333-4333-b333-333333333333";
const EU = "e0000000-0000-4000-b000-000000000000";
const PARCELA_QUE_EU_DEVO = "f1111111-1111-4111-b111-111111111111";

// A pagina e montada com template literal, e NUNCA com `String.replace`: o
// bundle do React tem `$$typeof` dentro, e numa string de substituicao `$$`
// vira `$` -- o bundle chega corrompido e o erro e "React is not defined", que
// nao se le como o que e.
const PAGINA = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<div id="raiz-a"></div><div id="raiz-b"></div><div id="raiz-c"></div>
<div id="raiz-e"></div><div id="raiz-f"></div>
<div id="resultado">a pagina nao rodou</div>
<script>${umd("react", "react.development.js")}</script>
<script>${umd("react-dom", "react-dom.development.js")}</script>
<script>
// UM UNICO <script>, E ISSO NAO E ARRUMACAO
// -----------------------------------------
// Os esbocos e os hooks sao \`const\` de TOPO DE SCRIPT, e o codigo de producao os
// resolve por NOME no momento da chamada. Dentro de uma funcao (a IIFE \`async\`
// abaixo) eles passam a ser locais DELA, e nenhuma funcao de producao os
// alcanca: o erro e \`ReferenceError: useState is not defined\`, estourado la
// dentro do primeiro render -- e ele nao se le como um problema de escopo.
const { useCallback, useEffect, useMemo, useRef, useState } = React;

// --- os esbocos (ver o cabecalho do .mjs) ------------------------------------

/** clsx + tailwind-merge: junta o que nao e falso. Calculo de string. */
const cn = (...partes) => partes.filter(Boolean).join(" ");

/** class-variance-authority: so devolve a base. Calculo de string. */
const cva = (base) => () => base;

/** O Slot do Radix: o \`asChild\` do Button. Clona o filho com as props dele. */
const Slot = React.forwardRef(function Slot(props, ref) {
  const { children, ...resto } = props;
  return React.cloneElement(children, { ...resto, ref });
});

/** Os sete icones. Icone novo estoura como ReferenceError, e isso e bom. */
const icone = (nome) => (props) =>
  React.createElement("svg", { "data-icone": nome, className: props.className });
const AlertCircle = icone("AlertCircle");
const HandCoins = icone("HandCoins");
const Landmark = icone("Landmark");
const Loader2 = icone("Loader2");
const PiggyBank = icone("PiggyBank");
const Plus = icone("Plus");
const Users = icone("Users");

/** sonner: um registrador. O que as assercoes leem e a CHAMADA, nao o toast. */
const TOASTS = [];
const toast = {
  success: (m) => TOASTS.push({ tipo: "success", texto: String(m) }),
  error: (m) => TOASTS.push({ tipo: "error", texto: String(m) }),
};

/**
 * OS DOIS CAMPOS MASCARADOS: inputs controlados que devolvem o valor CRU.
 *
 * Ver o cabecalho: e uma concessao, e o limite esta declarado la. O CONTRATO e
 * respeitado -- os dois componentes de verdade emitem o valor PLANO pelo
 * \`onChange\` --, entao o corpo do POST medido aqui e o corpo de verdade.
 */
const CampoDeValor = (props) =>
  React.createElement("input", {
    id: props.id,
    "data-esboco": "campo-de-valor",
    value: props.value,
    onChange: (e) => props.onChange(e.target.value),
  });
const CampoDeData = (props) =>
  React.createElement("input", {
    id: props.id,
    "data-esboco": "campo-de-data",
    value: props.value,
    onChange: (e) => props.onChange(e.target.value),
  });

// --- formatCurrency, DE PRODUCAO (extraido) ----------------------------------
${FORMAT_CURRENCY}

// --- o codigo de producao, no MESMO escopo dos esbocos acima -----------------
${producao}

// --- a sonda, numa IIFE async ------------------------------------------------
(async function () {
try {

// --- a rede, interceptada ----------------------------------------------------
//
// AS REQUISICOES SAO A MEDIDA de "o gesto chegou na rota": o texto da tela muda
// mesmo com o \`fetch\` pedindo a URL errada, e o estado interno do componente
// nao prova nada sobre o que saiu do aparelho.

let CHAMADAS = [];

const resposta = (corpo, ok) => ({
  ok: ok === undefined ? true : ok,
  status: ok === false ? 400 : 200,
  headers: { get: () => null },
  json: async () => corpo,
});

const CONTAS = [
  // DUAS de investimento e DUAS que nao sao. O caso A conta as \`<option>\`:
  // com quatro, o filtro de \`contasQueEmprestam\` nao esta agindo.
  { id: ${JSON.stringify(CARTEIRA)}, name: "Carteira XP", account_type: "investment", is_active: true },
  // \`is_active: null\` DE PROPOSITO: a coluna e anulavel, e um filtro escrito
  // como \`is_active === true\` sumiria com esta conta sem sintoma nenhum.
  { id: ${JSON.stringify(TESOURO)}, name: "Tesouro Direto", account_type: "investment", is_active: null },
  { id: ${JSON.stringify(CORRENTE)}, name: "Itau corrente", account_type: "checking", is_active: true },
  { id: "c4444444-4444-4444-b444-444444444444", name: "Nubank cartao", account_type: "credit_card", is_active: true },
];

const PARCELAS_DA_MOTO = [
  { id: "p-1", valor: 1000, numero: 1, total: 24, rotulo: "1 de 24", vencimento: "2026-09-10", status: "paid", a_confirmar: false },
  { id: "p-2", valor: 1000, numero: 2, total: 24, rotulo: "2 de 24", vencimento: "2026-10-10", status: "pending", a_confirmar: false },
  { id: "p-3", valor: 1000, numero: 3, total: 24, rotulo: "3 de 24", vencimento: "2026-11-10", status: "reported", a_confirmar: true },
];

const LOANS = [
  {
    id: "l-moto",
    descricao: "Moto eletrica",
    conta_credora_id: ${JSON.stringify(CARTEIRA)},
    caso: "conexao",
    status: "active",
    principal: 24000,
    total_de_parcelas: 24,
    primeiro_vencimento: "2026-09-10",
    quem_deve_pagar: "Lais",
    devedor_id: ${JSON.stringify(LAIS)},
    parcelas: PARCELAS_DA_MOTO,
  },
  {
    id: "l-auto",
    descricao: "Notebook para mim",
    conta_credora_id: ${JSON.stringify(CARTEIRA)},
    caso: "auto",
    status: "active",
    principal: 6000,
    total_de_parcelas: 6,
    primeiro_vencimento: "2026-10-05",
    quem_deve_pagar: "Voce mesmo",
    devedor_id: ${JSON.stringify(EU)},
    parcelas: [
      { id: "p-a1", valor: 1000, numero: 1, total: 6, rotulo: "1 de 6", vencimento: "2026-10-05", status: "pending", a_confirmar: false },
    ],
  },
  {
    // UM EMPRESTIMO QUITADO, na MESMA conta. Ele nao tem nada a receber, e
    // contar o principal dele no "emprestado" diria que a conta emprestou um
    // dinheiro que ja voltou. Sem esta linha, um total que ignorasse
    // \`status === "active"\` passaria verde.
    id: "l-quitado",
    descricao: "Celular quitado",
    conta_credora_id: ${JSON.stringify(CARTEIRA)},
    caso: "conexao",
    status: "settled",
    principal: 2000,
    total_de_parcelas: 2,
    primeiro_vencimento: "2026-05-10",
    quem_deve_pagar: "Lais",
    devedor_id: ${JSON.stringify(LAIS)},
    parcelas: [
      { id: "p-q1", valor: 1000, numero: 1, total: 2, rotulo: "1 de 2", vencimento: "2026-05-10", status: "paid", a_confirmar: false },
      { id: "p-q2", valor: 1000, numero: 2, total: 2, rotulo: "2 de 2", vencimento: "2026-06-10", status: "paid", a_confirmar: false },
    ],
  },
  {
    // UM EMPRESTIMO CANCELADO COM PARCELA EM ABERTO -- a combinacao que ninguem
    // escreve de proposito e que o banco permite (\`status\` e coluna de texto na
    // 053, e cancelar nao mexe nas parcelas). Ela e o que torna o filtro de
    // \`status\` em \`linhasAReceber\` MENSURAVEL: sem ela, "A receber" ignorando o
    // status do emprestimo daria exatamente a mesma lista.
    id: "l-cancelado",
    descricao: "Bicicleta cancelada",
    conta_credora_id: ${JSON.stringify(CARTEIRA)},
    caso: "conexao",
    status: "cancelled",
    principal: 999,
    total_de_parcelas: 1,
    primeiro_vencimento: "2026-08-10",
    quem_deve_pagar: "Bruno",
    devedor_id: ${JSON.stringify(BRUNO)},
    parcelas: [
      { id: "p-c1", valor: 999, numero: 1, total: 1, rotulo: "1 de 1", vencimento: "2026-08-10", status: "pending", a_confirmar: false },
    ],
  },
  {
    // OUTRA CONTA: o cabecalho tem de somar SO a conta escolhida. Sem esta
    // linha, um total que ignorasse \`conta_credora_id\` passaria verde.
    id: "l-outra-conta",
    descricao: "Emprestimo do Tesouro",
    conta_credora_id: ${JSON.stringify(TESOURO)},
    caso: "conexao",
    status: "active",
    principal: 500,
    total_de_parcelas: 2,
    primeiro_vencimento: "2026-10-20",
    quem_deve_pagar: "Bruno",
    devedor_id: ${JSON.stringify(BRUNO)},
    parcelas: [
      { id: "p-o1", valor: 250, numero: 1, total: 2, rotulo: "1 de 2", vencimento: "2026-10-20", status: "pending", a_confirmar: false },
    ],
  },
];

/**
 * AS CONEXOES, NA FORMA CRUA DE \`/api/connections\`: a lista NUA, com
 * \`requester\`/\`requested\` e \`status\`.
 *
 * A do Bruno esta \`pending\`, e e ela o assunto do caso B. A da Lais vem com o
 * MEU lado no \`requested\` e o dela no \`requester\` -- invertido em relacao a
 * do Bruno -- porque o pedido pode ter partido de qualquer um dos dois, e uma
 * leitura que olhasse so um lado perderia metade das conexoes.
 */
const CONEXOES = [
  {
    id: "x-1",
    requester_id: ${JSON.stringify(LAIS)},
    requested_id: ${JSON.stringify(EU)},
    status: "accepted",
    requester: { id: ${JSON.stringify(LAIS)}, full_name: "Lais Bernucio", nickname: "Lais" },
    requested: { id: ${JSON.stringify(EU)}, full_name: "Eu", nickname: null },
  },
  {
    id: "x-2",
    requester_id: ${JSON.stringify(EU)},
    requested_id: ${JSON.stringify(BRUNO)},
    status: "pending",
    requester: { id: ${JSON.stringify(EU)}, full_name: "Eu", nickname: null },
    requested: { id: ${JSON.stringify(BRUNO)}, full_name: "Bruno Lima", nickname: "Bruno" },
  },
  {
    // O MEU EMBED VEM NULO, E EU SOU O \`requester\`.
    //
    // E o caso que a RLS de \`profiles\` produz de verdade, e e ele que torna
    // "decidir o lado por \`requester_id\` e nao pelo embed" MENSURAVEL: uma
    // leitura escrita como \`conexao.requester?.id === meuId\` concluiria que eu
    // NAO sou o pedinte (meu embed e nulo), escolheria o \`requester_id\` -- que
    // sou eu -- e descartaria a linha pelo \`outroId === meuId\`. A Carla sumiria
    // do seletor em silencio.
    //
    // Sem esta linha no fixture, a troca passa verde: nas outras duas o embed do
    // meu lado existe, e as duas formas dao o mesmo resultado.
    id: "x-3",
    requester_id: ${JSON.stringify(EU)},
    requested_id: ${JSON.stringify(CARLA)},
    status: "accepted",
    requester: null,
    requested: { id: ${JSON.stringify(CARLA)}, full_name: "Carla Souza", nickname: null },
  },
];

/** As parcelas que EU devo -- a forma de \`GET /api/mybank/due\`. */
const QUE_EU_DEVO = [
  {
    id: ${JSON.stringify(PARCELA_QUE_EU_DEVO)},
    loan_id: "l-do-marcos",
    descricao: "Geladeira",
    valor: 450,
    vencimento: "2026-10-15",
    status: "pending",
    numero: 3,
    total: 12,
    rotulo: "3 de 12",
    quem_emprestou: "Marcos",
  },
  {
    // O NOME ILEGIVEL: conexao desfeita depois do emprestimo. O selo diz so
    // "MyBank" e a parcela CONTINUA na lista.
    id: "f-2",
    loan_id: "l-sem-nome",
    descricao: "Curso de ingles",
    valor: 200,
    vencimento: "2026-10-20",
    status: "pending",
    numero: 1,
    total: 4,
    rotulo: "1 de 4",
    quem_emprestou: null,
  },
  {
    // JA AVISEI: o botao vira estado, e nao desaparece.
    id: "f-3",
    loan_id: "l-do-marcos",
    descricao: "Geladeira",
    valor: 450,
    vencimento: "2026-09-15",
    status: "reported",
    numero: 2,
    total: 12,
    rotulo: "2 de 12",
    quem_emprestou: "Marcos",
  },
];

// ---------------------------------------------------------------------------
// A DIVIDA COMPRIDA -- o caso que a HMO-381 mediu em producao
// ---------------------------------------------------------------------------
// 25 parcelas mensais, de 10/2026 a 10/2028 -- o que a devedora tinha na tela:
// dois emprestimos abertos, 25 linhas ate 15/10/2028, e o resto da pagina 3.000
// pixels abaixo.
//
// SEIS MESES NAO BASTARIAM. Com seis parcelas o colapso esconde UMA, e um
// mutante que trocasse \`PARCELAS_VISIVEIS_FECHADO\` por 6 (ou que mandasse a
// lista inteira) sobreviveria -- a diferenca entre 5 visiveis e 6 nao se
// distingue de "cabe inteiro". Com 25 a assercao e sobre 5 contra 25.
const DIVIDA_COMPRIDA = Array.from({ length: 25 }, function (_, i) {
  // 10/2026 + i meses, por aritmetica de inteiro e com \`padStart\` -- nunca
  // \`new Date(...).setMonth()\`, que no fuso daqui devolve o mes anterior para
  // o dia 1. \`9\` e outubro em base zero, e a 25a parcela cai em 10/2028, a
  // mesma do print da issue.
  const mesCorrido = 9 + i;
  const ano = 2026 + Math.floor(mesCorrido / 12);
  const mes = String((mesCorrido % 12) + 1).padStart(2, "0");

  return {
    id: "longa-" + i,
    loan_id: i < 12 ? "l-comprido-1" : "l-comprido-2",
    descricao: "Reforma",
    valor: 100,
    vencimento: ano + "-" + mes + "-15",
    status: "pending",
    numero: i + 1,
    total: 25,
    rotulo: i + 1 + " de 25",
    quem_emprestou: "Marcos",
  };
});

/**
 * O QUE \`/api/mybank/due\` RESPONDE AGORA -- trocado entre os casos.
 *
 * \`let\` e nao parametro: o componente nao recebe as parcelas, ele as BUSCA, e
 * e justamente isso que a HMO-381 mede (a busca sai sem parametro de data). Um
 * fixture passado por prop provaria outra coisa.
 */
let DEVIDO_AGORA = QUE_EU_DEVO;

window.fetch = async (url, init) => {
  const metodo = (init && init.method) || "GET";
  const corpo = init && init.body ? JSON.parse(init.body) : null;
  const alvo = String(url);
  CHAMADAS.push({ metodo, url: alvo, corpo });

  if (alvo.startsWith("/api/financial-accounts")) {
    // A forma e \`{ accounts: [...] }\`. Um \`{ data: [...] }\` aqui deixaria o
    // seletor vazio e o caso A passaria verde sobre uma tela sem opcao nenhuma.
    return resposta({ accounts: CONTAS });
  }
  if (alvo.startsWith("/api/mybank/loans") && metodo === "GET") {
    return resposta({ loans: LOANS });
  }
  if (alvo.startsWith("/api/mybank/due")) {
    return resposta({ parcelas: DEVIDO_AGORA });
  }
  if (alvo.startsWith("/api/connections")) {
    // A LISTA NUA, nao \`{ connections: [...] }\`. As duas formas existem no
    // app, e trocar uma pela outra deixaria o seletor de devedor vazio.
    return resposta(CONEXOES);
  }

  return resposta({ success: true, message: "ok" });
};

// --- o arnes ---------------------------------------------------------------

/**
 * DRENA A FILA DE MICROTASKS E AS CAMADAS DE EFEITO, INTERCALADO.
 *
 * So \`flushSync\` nao serve: a continuacao do \`await\` dentro de \`carregar\` e um
 * microtask, e \`flushSync\` e sincrono. So \`await\` tambem nao: o \`setState\` do
 * \`ReactDOM.render\` legado so aparece no DOM depois da descarga. As duas, varias
 * voltas -- aqui \`carregar\` faz TRES \`fetch\` em paralelo, e cada um e quatro
 * saltos.
 *
 * E NUNCA \`setTimeout\`: a fila de microtasks drena muito antes de o
 * \`--dump-dom\` fotografar; um temporizador seria uma corrida contra a foto.
 */
async function assentar() {
  for (let i = 0; i < 32; i++) {
    await Promise.resolve();
    ReactDOM.flushSync(function () {});
  }
}

async function montarPainel(idDaRaiz) {
  CHAMADAS = [];
  const raiz = document.getElementById(idDaRaiz);
  ReactDOM.render(
    React.createElement(PainelDoMyBank, { meuId: ${JSON.stringify(EU)} }),
    raiz
  );
  await assentar();
  return raiz;
}

/**
 * Dispara o evento que o React escuta, pelo setter NATIVO do input.
 *
 * \`el.value = x\` sozinho nao chega ao \`onChange\`: o React guarda o valor
 * anterior no node e descarta o evento quando os dois batem. Sem o setter
 * nativo, digitar no campo nao muda estado nenhum e o formulario fica vazio --
 * com a tela parecendo certa.
 */
function digitar(el, valor) {
  const proto = el.tagName === "SELECT"
    ? window.HTMLSelectElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, valor);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function clicar(el) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/**
 * O RECORTE DO IPHONE, EM PIXELS -- e nao em classes.
 *
 * \`scrollWidth > clientWidth\` e o criterio de \`scripts/probe-mobile-overflow.mjs\`:
 * se o conteudo e mais largo do que a caixa, a tela anda para o lado. Aquela
 * sonda mede em PRODUCAO, com credencial, e por isso nao roda em CI; a guarda
 * que roda em todo PR (\`npm run test:mobile-overflow\`) afirma sobre CLASSES, e o
 * cabecalho dela diz o limite: "se alguem adicionar uma terceira acao no
 * cabecalho e estourar 320px de novo, este teste continua verde".
 *
 * Aqui ha navegador, e a janela ja e 390x844 -- entao o recorte da tela NOVA e
 * medido de verdade, uma vez, em CI. A medida e da RAIZ e nao do
 * \`documentElement\`: as tres montagens vivem no mesmo documento, e a
 * \`<div id="resultado">\` guarda um JSON de milhares de caracteres que estouraria
 * a largura e reprovaria tudo por causa da propria sonda.
 *
 * E a medida tem de sair ANTES do relatorio, pelo mesmo motivo.
 */
function recorteDe(raiz) {
  return {
    scrollWidth: raiz.scrollWidth,
    clientWidth: raiz.clientWidth,
    // O mais largo que passar da borda, com o nome -- transforma "a tela esta
    // torta" em um alvo, como a sonda de producao faz.
    estourando: Array.from(raiz.querySelectorAll("*"))
      .filter((el) => el.getBoundingClientRect().right > raiz.clientWidth + 1)
      .slice(0, 5)
      .map((el) => el.tagName + "." + String(el.className).slice(0, 60)),
  };
}

const out = {};

// =============================================================================
// A -- o cabecalho: o seletor e os dois totais
// =============================================================================
{
  const raiz = await montarPainel("raiz-a");
  // \`querySelector\` ESCOPADO na raiz, e nao \`getElementById\`: as tres paginas
  // vivem no MESMO documento, e o global devolveria o primeiro do documento.
  const achar = (id) => raiz.querySelector("[id='" + id + "']");

  const seletor = achar("mybank-conta");
  out.a = {
    opcoes: Array.from(seletor.options).map((o) => ({
      valor: o.value,
      texto: o.textContent,
    })),
    escolhida: seletor.value,
    emprestado: achar("mybank-total-emprestado").textContent,
    aReceber: achar("mybank-a-receber").textContent,
    // Os emprestimos e as linhas de "A receber" da conta escolhida.
    emprestimos: Array.from(raiz.querySelectorAll("[data-emprestimo]")).map(
      (el) => ({
        id: el.getAttribute("data-emprestimo"),
        progresso: el.querySelector("[data-progresso]").textContent,
        devedor: el.querySelector("[data-devedor-do-emprestimo]").textContent,
        texto: el.textContent,
      })
    ),
    receber: Array.from(raiz.querySelectorAll("[data-receber]")).map((el) => ({
      id: el.getAttribute("data-receber"),
      quemDeve: el.querySelector("[data-quem-deve]").textContent,
      rotulo: el.querySelector("[data-parcela-rotulo]").textContent,
      valor: el.querySelector("[data-valor]").textContent,
    })),
    // A palavra ESBOCO nao pode aparecer nos blocos que as assercoes leem.
    textoDaTela: raiz.textContent,
    // O bloco "a confirmar" (a forma da HMO-366): a parcela \`reported\`.
    aConfirmar: Array.from(raiz.querySelectorAll("[data-confirmar]")).map((el) =>
      el.getAttribute("data-confirmar")
    ),
    recorte: recorteDe(raiz),
  };

  // TROCAR DE CONTA muda os dois totais e as duas listas. Sem este gesto, um
  // cabecalho que somasse TODAS as contas passaria o caso de cima.
  digitar(seletor, ${JSON.stringify(TESOURO)});
  await assentar();
  out.a_tesouro = {
    escolhida: achar("mybank-conta").value,
    emprestado: achar("mybank-total-emprestado").textContent,
    aReceber: achar("mybank-a-receber").textContent,
    emprestimos: Array.from(raiz.querySelectorAll("[data-emprestimo]")).map(
      (el) => el.getAttribute("data-emprestimo")
    ),
  };
}

// =============================================================================
// B -- o formulario: a recusa da conexao nao aceita, e o controle positivo
// =============================================================================
{
  const raiz = await montarPainel("raiz-b");
  const achar = (id) => raiz.querySelector("[id='" + id + "']");

  // (0) A CONTA DE PAGAMENTO E ESCOLHIDA PRIMEIRO, NO RAMO "eu mesmo", E ESSA
  //     ORDEM E A PROVA.
  //
  // O corpo do POST do Caso B tem de levar \`conta_de_pagamento_id: null\`. Se a
  // sonda nunca tocasse neste campo, o estado ja estaria \`null\` e a assercao
  // seria VACUA: um \`conta_de_pagamento_id: contaDePagamentoId\` sem o ternario
  // passaria verde. Escolhendo a conta aqui e trocando o radio depois, o estado
  // fica preenchido -- e so o ternario mantem o corpo correto.
  //
  // E o lado da tela do que a F2 mede na rota: mandar uma conta junto com o
  // \`devedor_id\` satisfaz as DUAS guardas de \`previsoesDoEmprestimo\` e cria 24
  // contas a pagar no meu nome por um dinheiro que a Lais paga.
  digitar(achar("mybank-conta-de-pagamento"), ${JSON.stringify(CORRENTE)});
  await assentar();
  out.b_conta_de_pagamento = achar("mybank-conta-de-pagamento").value;

  // (1) "uma conexao": o seletor de devedor aparece, e SO com quem foi aceito.
  clicar(achar("mybank-quem-conexao"));
  digitar(achar("mybank-quem-conexao"), "conexao");
  await assentar();

  const seletorDeDevedor = achar("mybank-devedor");
  out.b_devedores = seletorDeDevedor
    ? Array.from(seletorDeDevedor.options).map((o) => ({
        valor: o.value,
        texto: o.textContent,
      }))
    : null;

  // (2) A RECUSA: sem escolher ninguem, "Emprestar" nao chama rota nenhuma.
  CHAMADAS = [];
  digitar(achar("mybank-descricao"), "Moto eletrica");
  digitar(achar("mybank-valor"), "1000.00");
  digitar(achar("mybank-parcelas"), "24");
  digitar(achar("mybank-vencimento"), "2026-11-10");
  await assentar();
  clicar(achar("mybank-emprestar"));
  await assentar();

  out.b_recusa = {
    erro: achar("mybank-erro") ? achar("mybank-erro").textContent : null,
    posts: CHAMADAS.filter((c) => c.metodo === "POST"),
    // O resumo da serie vem de \`resumoDaSerie\`, codigo de producao: ele prova
    // que o valor digitado chegou a aritmetica mesmo com o pedido recusado.
    resumo: achar("mybank-resumo") ? achar("mybank-resumo").textContent : null,
  };

  // (3) CONTROLE POSITIVO: com a conexao ACEITA escolhida, o POST sai.
  CHAMADAS = [];
  digitar(seletorDeDevedor, ${JSON.stringify(LAIS)});
  await assentar();
  clicar(achar("mybank-emprestar"));
  await assentar();

  out.b_aceita = {
    erro: achar("mybank-erro") ? achar("mybank-erro").textContent : null,
    posts: CHAMADAS.filter((c) => c.metodo === "POST"),
  };
}

// =============================================================================
// C -- o lado do devedor, em Contas a Pagar
// =============================================================================
{
  CHAMADAS = [];
  const raiz = document.getElementById("raiz-c");
  ReactDOM.render(React.createElement(ParcelasDoMyBankQueEuDevo), raiz);
  await assentar();

  out.c = {
    linhas: Array.from(raiz.querySelectorAll("[data-devo]")).map((el) => ({
      id: el.getAttribute("data-devo"),
      selo: el.querySelector("[data-selo]").textContent,
      rotulo: el.querySelector("[data-parcela-rotulo]").textContent,
      valor: el.querySelector("[data-valor]").textContent,
      temBotao: Boolean(el.querySelector("[data-avisar]")),
      avisado: el.querySelector("[data-avisado]")
        ? el.querySelector("[data-avisado]").textContent
        : null,
    })),
    leituras: CHAMADAS.map((c) => c.url),
    escopo: raiz.querySelector("[data-escopo]")
      ? raiz.querySelector("[data-escopo]").textContent
      : null,
    // TRES parcelas CABEM: nao pode haver botao de colapso aqui. E o controle
    // que separa "o botao aparece quando precisa" de "o botao aparece sempre".
    temBotaoDeExpandir: Boolean(raiz.querySelector("[data-expandir]")),
    recorte: recorteDe(raiz),
  };

  CHAMADAS = [];
  clicar(raiz.querySelector("[data-avisar]"));
  await assentar();
  out.c_aviso = CHAMADAS.filter((c) => c.metodo === "PATCH");
}

// =============================================================================
// E -- a divida comprida: o escopo dito na tela, e o colapso (HMO-381)
// =============================================================================
{
  DEVIDO_AGORA = DIVIDA_COMPRIDA;
  CHAMADAS = [];
  const raiz = document.getElementById("raiz-e");
  ReactDOM.render(React.createElement(ParcelasDoMyBankQueEuDevo), raiz);
  await assentar();

  const ler = () => ({
    linhas: Array.from(raiz.querySelectorAll("[data-devo]")).map((el) =>
      el.getAttribute("data-devo")
    ),
    escopo: raiz.querySelector("[data-escopo]")
      ? raiz.querySelector("[data-escopo]").textContent
      : null,
    botao: raiz.querySelector("[data-expandir]")
      ? raiz.querySelector("[data-expandir]").textContent
      : null,
    escondidas: raiz.querySelector("[data-expandir]")
      ? raiz.querySelector("[data-expandir]").getAttribute("data-escondidas")
      : null,
    // A ALTURA DO BLOCO, em pixels: e o sintoma da issue medido em vez de
    // descrito. "Nao empurra mais a pagina" nao se prova contando linhas --
    // um colapso que escondesse as linhas com CSS daria a mesma contagem.
    altura: raiz.getBoundingClientRect().height,
  });

  out.e_fechado = ler();

  clicar(raiz.querySelector("[data-expandir]"));
  await assentar();
  out.e_aberto = ler();

  // E DE VOLTA: o botao aberto tem de fechar. Sem este terceiro retrato, um
  // botao que so abre passaria verde -- e o bloco aberto e o que a issue veio
  // encurtar.
  clicar(raiz.querySelector("[data-expandir]"));
  await assentar();
  out.e_refechado = ler();

  out.e_recorte = recorteDe(raiz);
}

// =============================================================================
// F -- controle negativo: devedor sem parcela nenhuma nao ve o bloco
// =============================================================================
// A issue pede este controle por nome. Sem ele, um componente que montasse o
// card SEMPRE (so com a lista vazia) passaria todas as assercoes de E: o
// subtitulo de escopo estaria la, o botao nao estaria, e nada falharia.
{
  DEVIDO_AGORA = [];
  CHAMADAS = [];
  const raiz = document.getElementById("raiz-f");
  ReactDOM.render(React.createElement(ParcelasDoMyBankQueEuDevo), raiz);
  await assentar();

  out.f = {
    // O CARD INTEIRO, pelo id -- e nao as linhas. Um card vazio com titulo e
    // subtitulo de escopo tambem tem zero linhas.
    card: Boolean(raiz.querySelector("[id='mybank-que-eu-devo']")),
    escopo: Boolean(raiz.querySelector("[data-escopo]")),
    texto: raiz.textContent,
    leituras: CHAMADAS.map((c) => c.url),
  };
}

document.getElementById("resultado").textContent =
  "RESULTADO" + JSON.stringify(out) + "FIM";
} catch (e) {
  document.getElementById("resultado").textContent =
    "ERRO NA PAGINA: " + (e && e.stack ? e.stack : e);
}
})();
</script></body></html>`;

// --- roda o navegador --------------------------------------------------------

const chromium = acharChromium();
let resultado = null;
let erroDeExecucao = null;

function rodarPagina(nomeDoArquivo, html) {
  const dir = mkdtempSync(join(tmpdir(), "mybank-na-tela-"));
  const pagina = join(dir, nomeDoArquivo);
  writeFileSync(pagina, html);

  const dump = execFileSync(
    chromium,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      // iPhone: e onde este app e usado, e e o recorte que a issue pede.
      "--window-size=390,844",
      "--dump-dom",
      `file://${pagina}`,
    ],
    {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024, // o dump carrega o React inline junto
      stdio: ["ignore", "pipe", "ignore"], // o Chromium enche a stderr de dbus
    }
  );

  // Ancorado na DIV, e nao no dump solto: o `--dump-dom` devolve tambem o FONTE
  // do script, e procurar o marcador no dump inteiro acha a string literal do
  // proprio codigo -- um falso positivo que se disfarca de erro de pagina.
  const achado = dump.match(/id="resultado">([\s\S]*?)<\/div>/);
  if (!achado) {
    throw new Error(`${nomeDoArquivo} nao carregou:\n${dump.slice(0, 2000)}`);
  }

  // O `--dump-dom` SERIALIZA o textContent como HTML, entao todo `&` do JSON
  // volta como `&amp;`. `&amp;` por ULTIMO, senao `&amp;lt;` viraria `<`.
  // E o `&nbsp;` do `R$` do pt-BR volta como entidade -- desescapa-lo para o
  // caractere de verdade (U+00A0) e o que permite a assercao do NBSP falar do
  // byte que a tela tem, e nao do texto que o dump escreveu.
  const relato = achado[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  if (relato.startsWith("ERRO NA PAGINA")) throw new Error(relato);

  const bruto = relato.match(/^RESULTADO([\s\S]*)FIM$/);
  if (!bruto) {
    throw new Error(
      `${nomeDoArquivo} nao reportou resultado, e sim: ${relato.slice(0, 1200)}`
    );
  }
  return JSON.parse(bruto[1]);
}

try {
  if (!chromium) throw new Error(SEM_NAVEGADOR);
  resultado = rodarPagina("mybank.html", PAGINA);
} catch (e) {
  erroDeExecucao = e;
}

// =============================================================================

test("o navegador rodou e a pagina reportou as tres montagens", () => {
  // ESTE CASO FALHA PRIMEIRO quando a pagina nao parseia ou o render morre, e e
  // ele que separa "a sonda esta quebrada" de "o componente esta errado". Um
  // import novo em `PainelDoMyBank` que a pagina nao declare vira
  // `ReferenceError` aqui, e nao numa assercao de texto vinte linhas abaixo.
  if (erroDeExecucao) throw erroDeExecucao;
  assert.ok(resultado, "sem resultado da pagina");
  assert.ok(resultado.a, "o painel nao montou");
  assert.ok(resultado.b_devedores !== undefined, "o formulario nao montou");
  assert.ok(resultado.c, "o bloco do devedor nao montou");
});

// ---------------------------------------------------------------------------
// A -- o seletor lista SO conta de investimento
// ---------------------------------------------------------------------------

test("A1: o seletor da conta credora tem SO as duas de investimento", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // O fixture tem QUATRO contas: duas `investment`, uma `checking` e um
  // `credit_card`. Se o filtro de `contasQueEmprestam` cair, aqui saem quatro.
  assert.equal(
    resultado.a.opcoes.length,
    2,
    JSON.stringify(resultado.a.opcoes)
  );
  assert.deepEqual(
    resultado.a.opcoes.map((o) => o.valor),
    [CARTEIRA, TESOURO]
  );

  // E NAO E SO CONTAGEM: o NOME da conta corrente nao pode estar em opcao
  // nenhuma. Trocar uma conta de investimento pela corrente manteria o 2.
  for (const opcao of resultado.a.opcoes) {
    assert.ok(
      !opcao.texto.includes("Itau"),
      `a conta corrente entrou no seletor: ${opcao.texto}`
    );
    assert.ok(
      !opcao.texto.includes("Nubank"),
      `o cartao entrou no seletor: ${opcao.texto}`
    );
  }
});

test("A2: a conta com is_active NULL continua no seletor", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // `Tesouro Direto` tem `is_active: null` no fixture. Um filtro escrito como
  // `is_active === true` a sumiria do seletor sem sintoma nenhum -- a lista
  // viria mais curta, e quem olha concluiria que nao tem a conta cadastrada.
  const tesouro = resultado.a.opcoes.find((o) => o.valor === TESOURO);
  assert.ok(tesouro, JSON.stringify(resultado.a.opcoes));
  assert.match(tesouro.texto, /Tesouro Direto/);
});

test("A3: o rotulo da opcao traz o TIPO da conta, de lib/contas", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // "Investimento" e o rotulo que `TIPOS_DE_CONTA` define para
  // `account_type = 'investment'`. Ele e dado INDEPENDENTE do filtro: um
  // seletor que listasse as contas certas com o rotulo errado passaria A1.
  for (const opcao of resultado.a.opcoes) {
    assert.match(opcao.texto, /· Investimento$/, opcao.texto);
  }
});

test("A4: os dois totais somam SO a conta escolhida, e com NBSP no R$", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // A Carteira XP tem R$ 24.000 (moto, conexao) + R$ 6.000 (notebook, auto) =
  // R$ 30.000 emprestados. O emprestimo do Tesouro (R$ 500) NAO entra.
  //
  // O ` ` e o separador que o `Intl` do pt-BR poe entre `R$` e o numero.
  // Uma assercao escrita com espaco comum reprova codigo certo, e e por isso
  // que ela esta escrita com o caractere e com `\s` NENHUM: `\s` casaria os
  // dois e a assercao deixaria de distinguir.
  assert.equal(resultado.a.emprestado, "R$ 30.000,00");

  // A receber: a moto tem 2 parcelas em aberto (R$ 1.000 cada; a 1 esta paga) e
  // o notebook tem 1 -> R$ 3.000. O principal nao muda com a parcela paga, o a
  // receber muda: sao dois numeros diferentes e os dois estao certos.
  assert.equal(resultado.a.aReceber, "R$ 3.000,00");
});

test("A5: trocar de conta troca os dois totais e a lista", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  assert.equal(resultado.a_tesouro.escolhida, TESOURO);
  assert.equal(resultado.a_tesouro.emprestado, "R$ 500,00");
  assert.equal(resultado.a_tesouro.aReceber, "R$ 250,00");
  assert.deepEqual(resultado.a_tesouro.emprestimos, ["l-outra-conta"]);
});

test("A6: a lista de emprestimos traz o progresso n/m e o devedor", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  const moto = resultado.a.emprestimos.find((e) => e.id === "l-moto");
  assert.ok(moto, JSON.stringify(resultado.a.emprestimos));
  // 1 de 24 paga.
  assert.equal(moto.progresso, "1/24");
  assert.equal(moto.devedor, "Lais");

  const notebook = resultado.a.emprestimos.find((e) => e.id === "l-auto");
  assert.ok(notebook);
  assert.equal(notebook.progresso, "0/6");
  assert.equal(notebook.devedor, "Voce mesmo");
});

// ---------------------------------------------------------------------------
// C (da ordem da issue) -- a linha de "A receber" com os TRES campos
// ---------------------------------------------------------------------------

test("C1: cada linha de A receber tem os TRES campos, nao vazios", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // Tres parcelas em aberto na Carteira XP: 2/24 e 3/24 da moto, 1/6 do
  // notebook. A paga (1/24) nao entra.
  assert.equal(resultado.a.receber.length, 3, JSON.stringify(resultado.a.receber));

  for (const linha of resultado.a.receber) {
    assert.ok(linha.quemDeve.trim().length > 0, `sem quem deve: ${linha.id}`);
    assert.ok(linha.rotulo.trim().length > 0, `sem n de m: ${linha.id}`);
    assert.ok(linha.valor.trim().length > 0, `sem valor: ${linha.id}`);
  }
});

test("C2: os tres campos sao os CERTOS, e nao so presentes", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // Presenca sozinha nao distingue uma linha certa de uma que imprime o mesmo
  // nome em toda parcela -- que e exatamente o que um `quem_deve_pagar` lido do
  // emprestimo errado produziria.
  const porRotulo = {};
  for (const linha of resultado.a.receber) porRotulo[linha.rotulo] = linha;

  assert.deepEqual(Object.keys(porRotulo).sort(), ["1 de 6", "2 de 24", "3 de 24"]);

  assert.equal(porRotulo["2 de 24"].quemDeve, "Lais");
  assert.equal(porRotulo["2 de 24"].valor, "R$ 1.000,00");
  assert.equal(porRotulo["3 de 24"].quemDeve, "Lais");

  // O AUTO-EMPRESTIMO NA MESMA LISTA, com a frase dele. Sem este par a lista
  // nao distinguiria "emprestei para a Lais" de "emprestei para mim".
  assert.equal(porRotulo["1 de 6"].quemDeve, "Voce mesmo");
  assert.equal(porRotulo["1 de 6"].valor, "R$ 1.000,00");
});

test("C3: a ordem e por vencimento", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // 05/10 (notebook), 10/10 (moto 2), 10/11 (moto 3).
  assert.deepEqual(
    resultado.a.receber.map((l) => l.rotulo),
    ["1 de 6", "2 de 24", "3 de 24"]
  );
});

test("C4: a parcela `reported` ganha o bloco de confirmar", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // A forma da HMO-366: "alguem registrou que me pagou e eu ainda nao lancei" e
  // um estado DERIVADO (`a_confirmar`), nao coluna nova. So a 3/24 esta
  // `reported` no fixture.
  assert.deepEqual(resultado.a.aConfirmar, ["p-3"]);
});

test("C5: nenhum esboco aparece no texto da tela", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // E o que impede um esboco de participar de assercao de texto: se algum dia
  // um marcador entrar nos blocos acima, este caso reprova antes de os outros
  // passarem a medir a propria sonda.
  assert.ok(
    !resultado.a.textoDaTela.includes("ESBOCO"),
    resultado.a.textoDaTela.slice(0, 400)
  );
});

test("C6: o recorte do iPhone -- nada estoura a largura de 390px", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // A JANELA DO CHROMIUM E 390x844 (`--window-size`), que e o iPhone onde este
  // app e usado. O criterio e o da sonda de producao
  // (`scripts/probe-mobile-overflow.mjs`): se o conteudo e mais largo do que a
  // caixa, a tela anda para o lado.
  //
  // E isto e PIXEL, nao classe. A guarda que roda em todo PR
  // (`npm run test:mobile-overflow`) afirma sobre as classes que PRODUZEM a
  // geometria, e o cabecalho dela diz o limite: uma acao a mais no cabecalho
  // estoura 320px de novo e ela continua verde. Aqui ha navegador, entao a tela
  // nova e medida de verdade.
  for (const [nome, recorte] of [
    ["a tela do MyBank", resultado.a.recorte],
    ["o bloco do devedor", resultado.c.recorte],
    // ABERTO, com 25 linhas: o botao do colapso e o `w-full` dele sao largura
    // nova no bloco, e e o estado aberto que tem mais conteudo para estourar.
    ["o bloco do devedor com a divida comprida", resultado.e_recorte],
  ]) {
    // CONTROLE: a caixa tem largura de verdade. Com `clientWidth` 0 (raiz
    // oculta, render que nao aconteceu) a comparacao de baixo passaria vacua.
    assert.ok(
      recorte.clientWidth > 300,
      `${nome}: a raiz nao tem largura (${recorte.clientWidth}px) -- a medida seria vacua`
    );
    assert.ok(
      recorte.scrollWidth <= recorte.clientWidth,
      `${nome} anda para o lado: scrollWidth ${recorte.scrollWidth} > ` +
        `clientWidth ${recorte.clientWidth}. Estourando: ${JSON.stringify(
          recorte.estourando
        )}`
    );
  }
});

// ---------------------------------------------------------------------------
// B -- a recusa da conexao nao aceita
// ---------------------------------------------------------------------------

test("B1: o seletor de devedor oferece SO a conexao aceita", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  assert.ok(resultado.b_devedores, "o seletor de devedor nao apareceu");

  // Uma opcao de placeholder (valor vazio) + as DUAS aceitas. O Bruno esta
  // `pending` no fixture e NAO pode estar aqui.
  //
  // A ordem e alfabetica (`localeCompare` em pt-BR): Carla antes de Lais.
  const comValor = resultado.b_devedores.filter((o) => o.valor !== "");
  assert.deepEqual(
    comValor,
    [
      { valor: CARLA, texto: "Carla Souza" },
      { valor: LAIS, texto: "Lais" },
    ],
    JSON.stringify(resultado.b_devedores)
  );

  // A CARLA E O CASO DO EMBED NULO: a conexao dela vem com o MEU lado
  // (`requester`) nulo, e so uma leitura que decide o lado por `requester_id`
  // a encontra. Uma que olhasse `conexao.requester?.id` a descartaria em
  // silencio -- e a assercao acima e quem mede isso.
  assert.ok(
    comValor.some((o) => o.valor === CARLA),
    "a conexao com o meu embed nulo sumiu do seletor"
  );

  // E o APELIDO vence o nome completo quando existe: "Lais" (nickname) e
  // "Carla Souza" (sem nickname, cai no full_name).
  assert.equal(comValor.find((o) => o.valor === LAIS).texto, "Lais");

  for (const opcao of resultado.b_devedores) {
    assert.ok(
      !opcao.texto.includes("Bruno"),
      `a conexao pendente entrou no seletor: ${opcao.texto}`
    );
  }
});

test("B2: sem conexao aceita escolhida, Emprestar RECUSA e nao chama a rota", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // A FRASE vem de `mensagemDoProblema("devedor_sem_conexao")`, que roda na
  // pagina como codigo de producao. O literal abaixo esta escrito AQUI, do lado
  // do node, de proposito: comparar a saida da funcao com ela mesma passaria
  // verde sobre qualquer texto.
  assert.ok(resultado.b_recusa.erro, "a tela nao mostrou recusa nenhuma");
  assert.match(
    resultado.b_recusa.erro,
    /Só é possível emprestar para si mesmo ou para uma conexão aceita/
  );

  // E A PARTE QUE IMPORTA: nenhum POST saiu. Uma tela que mostrasse a frase e
  // chamasse a rota de qualquer jeito passaria a assercao de cima.
  assert.deepEqual(
    resultado.b_recusa.posts,
    [],
    JSON.stringify(resultado.b_recusa.posts)
  );

  // E o pedido estava completo em todo o resto: o resumo da serie saiu, o que
  // prova que o valor, as parcelas e o vencimento chegaram a `serieDeParcelas`.
  // Sem isto, a recusa poderia ser de um campo vazio qualquer.
  assert.ok(resultado.b_recusa.resumo, "o resumo da serie nao apareceu");
  assert.match(resultado.b_recusa.resumo, /24x de R\$\s?1\.000,00/);
});

test("B3: controle positivo -- com a conexao ACEITA o POST sai, e com o id dela", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  assert.equal(resultado.b_aceita.posts.length, 1, JSON.stringify(resultado.b_aceita.posts));
  const [post] = resultado.b_aceita.posts;
  assert.equal(post.url, "/api/mybank/loans");

  // O `devedor_id` que saiu e o id que entrou no fixture -- a comparacao e real
  // porque o literal esta escrito nos dois lados.
  assert.equal(post.corpo.devedor_id, LAIS);
  assert.equal(post.corpo.conta_credora_id, CARTEIRA);

  // `conta_de_pagamento_id` NULO no Caso B -- e a assercao NAO E VACUA: o passo
  // (0) da sonda escolheu uma conta de pagamento de verdade no ramo "eu mesmo"
  // antes de trocar o radio, entao o estado esta PREENCHIDO aqui. Sem o
  // ternario do componente, o corpo levaria a conta corrente, as duas guardas de
  // `previsoesDoEmprestimo` seriam satisfeitas, e emprestar para a Lais criaria
  // 24 contas a pagar no meu nome.
  assert.equal(
    resultado.b_conta_de_pagamento,
    CORRENTE,
    "o passo (0) nao preencheu a conta de pagamento -- a assercao abaixo seria vacua"
  );
  assert.equal(post.corpo.conta_de_pagamento_id, null);

  // O VALOR VAI CRU, COM A BASE AO LADO (HMO-211): quem faz a conta e o
  // servidor. Um corpo com o total ja multiplicado poria a aritmetica do
  // dinheiro no cliente.
  assert.equal(post.corpo.valor, "1000.00");
  assert.equal(post.corpo.base, "parcela");
  assert.equal(post.corpo.parcelas, 24);
  assert.equal(post.corpo.primeiro_vencimento, "2026-11-10");
  // Juro zero na fase 1 -- a trava `mybank_loans_interest_rate_fase_1`.
  assert.equal(post.corpo.juros, 0);
});

// ---------------------------------------------------------------------------
// D -- o lado do devedor, em Contas a Pagar
// ---------------------------------------------------------------------------

test("D1: o selo diz 'MyBank — <quem emprestou>'", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  const geladeira = resultado.c.linhas.find((l) => l.id === PARCELA_QUE_EU_DEVO);
  assert.ok(geladeira, JSON.stringify(resultado.c.linhas));
  // O travessao e o do portugues (—), nao um hifen.
  assert.equal(geladeira.selo, "MyBank — Marcos");
  assert.equal(geladeira.rotulo, "parcela 3 de 12");
  assert.equal(geladeira.valor, "R$ 450,00");
});

test("D2: sem o nome legivel o selo diz so 'MyBank', e a parcela FICA", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // Conexao desfeita depois do emprestimo deixa o perfil do credor ilegivel
  // (`profiles_select_connected`, 010). Esconder a parcela nesse caso seria o
  // app dizendo que a divida acabou porque o contato saiu.
  const curso = resultado.c.linhas.find((l) => l.id === "f-2");
  assert.ok(curso, "a parcela sem nome de credor desapareceu da lista");
  assert.equal(curso.selo, "MyBank");
});

test("D3: quem ja avisou nao tem botao, tem estado", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  const pendente = resultado.c.linhas.find((l) => l.id === PARCELA_QUE_EU_DEVO);
  assert.equal(pendente.temBotao, true);
  assert.equal(pendente.avisado, null);

  const avisada = resultado.c.linhas.find((l) => l.id === "f-3");
  assert.ok(avisada, JSON.stringify(resultado.c.linhas));
  assert.equal(avisada.temBotao, false, "a parcela ja avisada manteve o botao");
  assert.match(avisada.avisado, /Avisei que paguei/);
  // A frase diz O QUE FALTA e de quem -- sem isso a linha se le como aviso
  // informativo e quem avisou fica esperando sem saber o que falta.
  assert.match(avisada.avisado, /falta quem emprestou confirmar/);
});

test("D4: o bloco le a view pela rota do devedor", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // `/api/mybank/due` e so ela: a rota dos emprestimos (`/api/mybank/loans`) e
  // o que ME devem, e ler aquela aqui mostraria a divida do outro lado.
  assert.deepEqual(resultado.c.leituras, ["/api/mybank/due"]);
});

test("D5: avisar que paguei manda `reported`, e NUNCA `paid`", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  assert.equal(resultado.c_aviso.length, 1, JSON.stringify(resultado.c_aviso));
  const [patch] = resultado.c_aviso;
  assert.equal(patch.url, `/api/mybank/installments/${PARCELA_QUE_EU_DEVO}`);
  // Quem leva a parcela a paga e quem RECEBE o dinheiro: so ele sabe se
  // recebeu. A rota recusa `paid` do devedor com 403, e esta assercao e o lado
  // da tela da mesma regra -- um `paid` aqui deixaria o emprestimo quitado sem
  // nada ter se movido.
  assert.equal(patch.corpo.status, "reported");
  assert.notEqual(patch.corpo.status, "paid");
  // E a rota nunca le valor do corpo: a tela tambem nao o manda.
  assert.equal(patch.corpo.amount, undefined);
  assert.equal(patch.corpo.valor, undefined);
});

// ---------------------------------------------------------------------------
// E e F -- o ESCOPO do bloco dito na tela, e o colapso (HMO-381)
// ---------------------------------------------------------------------------
// A HMO-381 mediu em producao dois escopos na mesma tela sem rotulo: o card
// "Total a pagar" falava da janela da pagina (R$ 160,00, 2026-10-01 a
// 2027-01-01) e este bloco mostrava 25 linhas ate 15/10/2028. A escolha da
// issue foi a saida (2) -- o bloco fica FORA da janela e diz que fica --, e o
// porque esta no cabecalho de `ParcelasDoMyBankQueEuDevo.tsx`.
//
// POR QUE A PROVA NAO E "o numero de linhas MUDA entre duas janelas"
// -----------------------------------------------------------------
// Era a prova da saida (1). Na (2) o componente nao tem janela para variar: ele
// nao recebe data nenhuma e a busca dele sai sem parametro. O que substitui
// aquela medida sao tres fatos, e os tres sao mensuraveis:
//
//   * a busca NAO leva recorte de data (E1), que e a forma mecanica de "fora da
//     janela, de proposito";
//   * o subtitulo NOMEIA o periodo que o bloco cobre (E2) -- e o periodo sai do
//     dado, nao de um literal, senao as duas metades do bloco poderiam
//     discordar sem que nada falhasse;
//   * o bloco deixa de ser comprido (E3/E4), que e o sintoma que a issue abriu.

test("E1: a busca do bloco NAO leva recorte de data -- o escopo e deliberado", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // A rota nua, sem `?`. Esta e a assercao que distingue a saida (2) da (1):
  // com `?de=&ate=` a resposta passaria a depender da janela da pagina, e o
  // subtitulo de escopo passaria a mentir.
  assert.deepEqual(resultado.c.leituras, ["/api/mybank/due"]);
  for (const url of resultado.c.leituras) {
    assert.ok(
      !url.includes("?"),
      `a busca saiu com parametro (${url}) -- o bloco passou a seguir uma janela ` +
        "e o subtitulo de escopo ficou falso"
    );
  }
});

test("E2: o subtitulo diz o PERIODO do bloco, medido nas parcelas", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  const escopo = resultado.e_fechado.escopo;
  assert.ok(escopo, "o bloco nao tem a frase de escopo");

  // A FRASE DE NEGACAO sozinha nao bastaria -- ver o cabecalho de
  // `escopoDoBlocoDoDevedor`. Ela e necessaria, e e a primeira metade.
  assert.match(escopo, /não segue o período da página/);

  // E AS DUAS PONTAS MEDIDAS: 10/2026 e 10/2028, a segunda a do print da
  // issue. Sao elas que impedem a frase de ser um literal -- a primeira e a
  // ultima das 25 parcelas do fixture, e mudam quando a divida muda.
  assert.match(escopo, /de 10\/2026 a 10\/2028/);

  // CONTROLE: a frase do caso C (tres parcelas, 09/2026 a 10/2026) e DIFERENTE.
  // Sem isto, um `escopoDoBlocoDoDevedor` que devolvesse o literal
  // "de 10/2026 a 10/2028" para qualquer lista passaria a assercao de cima.
  assert.match(resultado.c.escopo, /de 09\/2026 a 10\/2026/);
  assert.notEqual(resultado.c.escopo, escopo);
});

test("E3: fechado, o bloco mostra 5 de 25 e o botao diz quantas faltam", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  const fechado = resultado.e_fechado;
  assert.equal(
    fechado.linhas.length,
    5,
    `fechado mostrou ${fechado.linhas.length} linhas: ${JSON.stringify(fechado.linhas)}`
  );
  // AS CINCO PRIMEIRAS, e nao cinco quaisquer: o fixture esta em ordem de
  // vencimento, e um `slice` do fim esconderia justamente o que vence antes.
  assert.deepEqual(fechado.linhas, [
    "longa-0",
    "longa-1",
    "longa-2",
    "longa-3",
    "longa-4",
  ]);

  // O BOTAO DIZ O NUMERO. "Ver mais" esconde o que a pessoa precisa para
  // decidir se vale o toque -- cinco de 25 e um bloco que esconde 80% da
  // divida, e cinco de seis nao e.
  assert.ok(fechado.botao, "fechado nao tem botao de expandir");
  assert.match(fechado.botao, /20/);
  assert.equal(fechado.escondidas, "20");
  assert.match(fechado.botao, /parcelas/);

  // E O CONTROLE DO COLAPSO: tres parcelas CABEM, e ali nao ha botao nenhum.
  // Sem ele, um botao que aparecesse sempre passaria a assercao de cima.
  assert.equal(
    resultado.c.temBotaoDeExpandir,
    false,
    "o bloco de tres parcelas ganhou botao de colapso -- ele cabe inteiro"
  );
});

test("E4: o colapso encurta o bloco DE VERDADE, em pixels, e volta", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  const { e_fechado: fechado, e_aberto: aberto, e_refechado: refechado } = resultado;

  // ABERTO: as 25, e o botao vira "Mostrar menos" em vez de desaparecer.
  assert.equal(aberto.linhas.length, 25, JSON.stringify(aberto.linhas.length));
  assert.ok(aberto.botao, "aberto perdeu o botao -- nao ha caminho de volta");
  assert.match(aberto.botao, /Mostrar menos/);
  assert.equal(aberto.escondidas, "0");

  // O SINTOMA DA ISSUE, EM PIXELS. Contar linhas nao prova isto: um colapso
  // que escondesse as 20 com CSS daria 5 na contagem e a mesma altura. O
  // criterio e folgado de proposito (metade) -- o que ele barra e "a altura
  // nao mudou", nao um limite de pixel especifico.
  assert.ok(
    fechado.altura > 0 && aberto.altura > 0,
    `altura zero (${fechado.altura}/${aberto.altura}) -- a medida seria vacua`
  );
  assert.ok(
    fechado.altura < aberto.altura / 2,
    `o bloco fechado (${fechado.altura}px) nao e nem metade do aberto ` +
      `(${aberto.altura}px) -- o colapso nao encurtou nada`
  );

  // E FECHA DE NOVO: o segundo toque volta ao retrato de antes.
  assert.equal(refechado.linhas.length, 5);
  assert.deepEqual(refechado.linhas, fechado.linhas);
  assert.equal(refechado.altura, fechado.altura);
});

test("F: controle negativo -- devedor sem parcela nao ve o bloco", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // O CARD INTEIRO AUSENTE, e nao so sem linhas: um card com titulo e frase de
  // escopo sobre uma lista vazia diria "Toda a dívida em aberto" a quem nao
  // deve nada.
  assert.equal(
    resultado.f.card,
    false,
    "o bloco apareceu para quem nao deve nada: " + resultado.f.texto
  );
  assert.equal(resultado.f.escopo, false);
  assert.equal(resultado.f.texto, "");

  // A BUSCA SAIU. Sem esta linha o caso passaria verde se o componente nao
  // tivesse montado -- e "nao montou" nao e "montou e decidiu nao mostrar".
  assert.deepEqual(resultado.f.leituras, ["/api/mybank/due"]);
});
