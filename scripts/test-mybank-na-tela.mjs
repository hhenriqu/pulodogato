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
 * antigas tinham `chromium-1243` escrito no fonte, e o dia em que a maquina
 * subiu para a 1248 as quatro ficaram 100% vermelhas numa arvore intocada --
 * com a mensagem verdadeira ("Nenhum Chromium encontrado") aparecendo UMA vez
 * no meio de dezenas de `TypeError` identicos. Aqui a pasta e VARRIDA: qualquer
 * `chromium-*` serve, e o proximo bump nao derruba esta suite. A HMO-406
 * portou a varredura para aquelas quatro -- nenhuma sonda adivinha mais.
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
  // A CHAVE DO PEDIDO (HMO-390). Sem esta linha o `PainelDoMyBank` compila e a
  // pagina CARREGA, e `emprestar()` morre em `ReferenceError:
  // assinaturaDoPedido is not defined` -- dentro do `try` dele, entao o sintoma
  // nao se le como erro de sonda: e o POST que simplesmente nao sai, e o
  // controle positivo de B3 caindo de 1 para 0. Familia
  // `import-novo-no-componente-derruba-a-sonda-de-navegador`.
  "lib/pedido-de-emprestimo.js",
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
  // A LINHA DA AGENDA (HMO-386). Ela e a dona da parcela em `/dashboard/bills`
  // desde que o bloco saiu daquela tela: sem esta parte o mount da secao J
  // morre em `ReferenceError: LinhaDaParcelaDoMyBank is not defined`.
  "components/mybank/LinhaDaParcelaDoMyBank.js",
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
// A parcela da LINHA DA AGENDA (HMO-386). Id PROPRIO, e nao o do bloco: a
// assercao do PATCH compara a URL que saiu com o id que entrou, e um id
// compartilhado com o bloco deixaria de distinguir qual dos dois gestos a
// chamada veio -- os dois mandam o mesmo corpo para a mesma rota.
const PARCELA_NA_AGENDA = "f2222222-2222-4222-b222-222222222222";
const PARCELA_NA_AGENDA_AVISADA = "f3333333-3333-4333-b333-333333333333";

// A pagina e montada com template literal, e NUNCA com `String.replace`: o
// bundle do React tem `$$typeof` dentro, e numa string de substituicao `$$`
// vira `$` -- o bundle chega corrompido e o erro e "React is not defined", que
// nao se le como o que e.
const PAGINA = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<div id="raiz-a"></div><div id="raiz-b"></div><div id="raiz-c"></div>
<div id="raiz-e"></div><div id="raiz-f"></div>
<div id="raiz-g1"></div><div id="raiz-g2"></div><div id="raiz-g3"></div>
<div id="raiz-g1-controle"></div><div id="raiz-g1-controle-2"></div>
<div id="raiz-h"></div><div id="raiz-h2"></div><div id="raiz-h3"></div>
<div id="raiz-g4"></div><div id="raiz-g4b"></div>
<div id="raiz-i"></div><div id="raiz-i2"></div><div id="raiz-i3"></div>
<div id="raiz-i4"></div><div id="raiz-i5"></div>
<div id="raiz-j1"></div><div id="raiz-j2"></div><div id="raiz-j3"></div>
<div id="raiz-k"></div><div id="raiz-k2"></div><div id="raiz-k3"></div>
<div id="raiz-k4"></div><div id="raiz-k5"></div><div id="raiz-k6"></div>
<div id="raiz-l-singular"></div>
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

/**
 * next/link: uma ancora (HMO-386).
 *
 * \`LinhaDaParcelaDoMyBank\` leva o selo do MyBank para \`/dashboard/mybank\`, que
 * e onde a divida inteira (e o nome de quem emprestou) mora. Sem este esboco a
 * linha morre em \`ReferenceError: Link is not defined\` no primeiro render --
 * familia \`import-novo-no-componente-derruba-a-sonda-de-navegador\`. O \`href\`
 * e repassado de proposito: a secao J o afirma.
 */
const Link = (props) =>
  React.createElement("a", { href: props.href, className: props.className }, props.children);

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

// O \`status\` EXPLICITO entrou na HMO-390: o componente ramifica em
// \`resposta.status === 409\` (o id colidiu com linha alheia), e um duble
// que so soubesse devolver 400 faria aquele ramo ser INALCANCAVEL -- o caso G4
// passaria medindo o ramo de erro genérico e o mutante do 409 sobreviveria.
const resposta = (corpo, ok, status) => ({
  ok: ok === undefined ? true : ok,
  status: status ?? (ok === false ? 400 : 200),
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

/**
 * O que \`/api/mybank/loans\` (GET) responde AGORA -- trocado pela secao H.
 *
 * \`let\` pelo mesmo motivo de \`DEVIDO_AGORA\`: a secao H precisa de DUAS parcelas
 * \`reported\` para medir que a trava de confirmacao e por id (um \`Set\`) e nao um
 * booleano global. Acrescenta-las a \`PARCELAS_DA_MOTO\` mudaria a contagem que C4
 * afirma -- a sonda passaria a medir um fixture diferente do que o caso diz.
 */
let LOANS = [
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

/**
 * O POST DE EMPRESTIMO FALHA? -- usado por G2/G3 (HMO-390).
 *
 * A chave de pedido so SOBREVIVE ao caminho de erro: no sucesso a tela faz
 * \`removeItem\`, de proposito (emprestar o mesmo valor de novo e legitimo). Entao
 * para medir o reaproveitamento do id e preciso um primeiro POST que FALHE --
 * que e tambem o caso real da issue: quem viu "Emprestando..." e achou que
 * travou.
 *
 * O \`throw\` imita queda de REDE, e nao um 500: e o ramo em que a tela nao
 * recebeu resposta nenhuma, o unico em que a pessoa genuinamente nao sabe se a
 * divida foi criada.
 */
let POST_DE_EMPRESTIMO_FALHA = false;

/**
 * A BAIXA DA PARCELA FALHA? -- usado por H3 (HMO-390).
 *
 * E o que permite medir o \`delete\` do \`Set\`: sem ele, a parcela cuja baixa
 * falhou fica em voo PARA SEMPRE, e como o botao Confirmar nao tem \`disabled\`,
 * a pessoa segue clicando num botao que nao chama rota nenhuma e nao diz nada.
 */
let PATCH_DE_PARCELA_FALHA = false;

/**
 * O PATCH do CANCELAMENTO caindo na rede (HMO-391).
 *
 * Existe para medir o \`delete\` do \`finally\`: sem ele o emprestimo fica em voo
 * para sempre, e o botao Cancelar -- que nao tem \`disabled\` -- continua
 * clicavel sem chamar rota nenhuma e sem dizer nada. Um clique que nao faz nada
 * e nao avisa e pior que o erro.
 */
let PATCH_DE_EMPRESTIMO_FALHA = false;

/**
 * O POST DE EMPRESTIMO RESPONDE 409? -- usado por G4 (HMO-390).
 *
 * 409 e "o id que voce escolheu e de uma linha que nao e sua". O par guardado
 * TEM de ser esquecido nesse ramo, senao o reenvio manda o mesmo id, colide com
 * a mesma linha e volta 409 para sempre -- e a frase "tente de novo" vira
 * mentira num botao que nunca mais funciona.
 */
let POST_DE_EMPRESTIMO_409 = false;

/**
 * O POST DA ANTECIPACAO CAINDO NA REDE (HMO-397) -- usado por K10.
 *
 * Existe para medir o \`delete\` do \`finally\` de \`antecipar\`: sem ele o
 * emprestimo fica em voo PARA SEMPRE, e o botao -- que volta habilitado quando o
 * estado de "em voo" e limpo, e nunca e -- ficaria preso em "Antecipando…" sem
 * chamar rota nenhuma e sem dizer nada.
 */
let POST_DE_ANTECIPACAO_FALHA = false;

/**
 * O POST DA ANTECIPACAO DE QUAL EMPRESTIMO FICA PENDURADO -- usado por K9.
 *
 * \`null\` = nenhum. Com o id de um emprestimo, o \`fetch\` daquela antecipacao
 * devolve uma promessa que NUNCA resolve: e o unico jeito de ter a primeira
 * antecipacao EM VOO enquanto a segunda e pedida, que e o estado em que o
 * \`Set\` de ids se distingue de um booleano global. Com a primeira ja respondida
 * as duas formas dao o mesmo resultado, e o controle nao mediria nada.
 */
let POST_DE_ANTECIPACAO_PENDURA = null;

window.fetch = async (url, init) => {
  const metodo = (init && init.method) || "GET";
  const corpo = init && init.body ? JSON.parse(init.body) : null;
  const alvo = String(url);
  CHAMADAS.push({ metodo, url: alvo, corpo });

  if (
    POST_DE_EMPRESTIMO_FALHA &&
    alvo.startsWith("/api/mybank/loans") &&
    metodo === "POST"
  ) {
    // Registrado em CHAMADAS acima: o POST SAIU, e e o id dele que G2 compara.
    throw new TypeError("Failed to fetch");
  }

  if (
    POST_DE_EMPRESTIMO_409 &&
    alvo.startsWith("/api/mybank/loans") &&
    metodo === "POST"
  ) {
    return resposta(
      { error: "Esse pedido nao pode ser confirmado. Tente de novo." },
      false,
      409
    );
  }

  if (
    PATCH_DE_PARCELA_FALHA &&
    alvo.startsWith("/api/mybank/installments/") &&
    metodo === "PATCH"
  ) {
    throw new TypeError("Failed to fetch");
  }

  if (
    PATCH_DE_EMPRESTIMO_FALHA &&
    alvo.startsWith("/api/mybank/loans/") &&
    metodo === "PATCH"
  ) {
    // Registrado em CHAMADAS acima: o PATCH SAIU, e e por isso que I7 sabe
    // distinguir "a primeira tentativa nao aconteceu" de "a segunda nao saiu".
    throw new TypeError("Failed to fetch");
  }

  if (
    POST_DE_ANTECIPACAO_PENDURA &&
    alvo === "/api/mybank/loans/" + POST_DE_ANTECIPACAO_PENDURA + "/antecipacao" &&
    metodo === "POST"
  ) {
    // Registrado em CHAMADAS acima: o POST SAIU. A promessa nunca resolve, e e
    // por isso que o \`finally\` de \`antecipar\` nao roda -- o emprestimo fica no
    // conjunto, que e exatamente o estado que K9 precisa medir.
    return new Promise(function () {});
  }

  if (
    POST_DE_ANTECIPACAO_FALHA &&
    /\\/api\\/mybank\\/loans\\/[^/]+\\/antecipacao$/.test(alvo) &&
    metodo === "POST"
  ) {
    // Registrado em CHAMADAS acima: o POST SAIU, e e por isso que K10 sabe
    // distinguir "a primeira tentativa nao aconteceu" de "a segunda nao saiu".
    throw new TypeError("Failed to fetch");
  }

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
    // HMO-398: a conta SEM nenhum encerrado nao ganha botao de colapso -- o
    // estado de abertura nao pode produzir duas telas para a mesma conta.
    resumo: raiz.querySelector("[data-resumo-da-lista]").textContent,
    temBotaoDeEncerrados:
      raiz.querySelector("[data-encerrados-do-mybank]") !== null,
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

// =============================================================================
// G -- o segundo clique nao cria a segunda divida (HMO-390, F1 da HMO-383)
// =============================================================================
// Tres montagens, e cada uma mede uma coisa que a outra nao mede:
//
//   G1  dois cliques no MESMO tick -> UM POST. E a trava de \`useRef\`.
//   G2  a tela REMONTADA (o F5) refazendo o mesmo formulario -> o MESMO id no
//       corpo. E a chave de pedido em \`sessionStorage\`.
//   G3  formulario DIFERENTE -> id DIFERENTE. E o controle que impede G2 de
//       passar com um id constante.
//
// POR QUE OS DOIS CLIQUES VAO DENTRO DE \`unstable_batchedUpdates\`
// --------------------------------------------------------------
// \`dispatchEvent\` e sincrono, mas o \`ReactDOM.render\` legado DESCARREGA o
// \`setSalvando(true)\` no fim de cada evento discreto. Dois \`clicar()\` soltos,
// um depois do outro, dariam ao React a chance de re-renderizar no meio -- e o
// segundo clique cairia no \`disabled={salvando}\` do botao.
//
// A sonda passaria VERDE, e pelo motivo errado: ela estaria medindo o
// \`disabled\`, que ja existia antes desta issue, e o mutante que troca o
// \`useRef\` por \`useState\` SOBREVIVERIA. \`unstable_batchedUpdates\` mantem as
// duas entregas na mesma descarga, que e o toque duplo de celular.
//
// E para isso nao ficar sendo uma afirmacao de comentario, G1 LE o
// \`disabled\` do botao no instante do segundo clique e o reporta. A assercao
// exige \`false\` ali: se um dia o React passar a descarregar no meio, a sonda
// falha em vez de virar vacua. Familia
// \`mutante-de-ramo-de-passagem-exige-fixture-do-outro-ramo\`.
{
  const raiz = await montarPainel("raiz-g1");
  const achar = (id) => raiz.querySelector("[id='" + id + "']");

  // O FORMULARIO VALIDO DO CASO A ("eu mesmo paga"): sem isto o \`problema\`
  // barraria o envio e o POST nao sairia por motivo nenhum ligado a trava --
  // zero POST passaria a assercao "um POST" de G1 ao contrario.
  digitar(achar("mybank-conta"), ${JSON.stringify(TESOURO)});
  digitar(achar("mybank-conta-de-pagamento"), ${JSON.stringify(CORRENTE)});
  digitar(achar("mybank-descricao"), "Bicicleta");
  digitar(achar("mybank-valor"), "2400.00");
  digitar(achar("mybank-parcelas"), "24");
  digitar(achar("mybank-vencimento"), "2026-11-10");
  await assentar();

  CHAMADAS = [];
  const botao = achar("mybank-emprestar");

  let desabilitadoNoSegundo = null;
  ReactDOM.unstable_batchedUpdates(function () {
    clicar(botao);
    // Lido ANTES do segundo clique, e dentro do mesmo lote: e o estado do DOM
    // que o segundo toque encontraria.
    desabilitadoNoSegundo = botao.disabled;
    clicar(botao);
  });
  await assentar();

  out.g1 = {
    posts: CHAMADAS.filter((c) => c.metodo === "POST"),
    desabilitadoNoSegundo,
    erro: achar("mybank-erro") ? achar("mybank-erro").textContent : null,
  };
}

/**
 * Preenche o formulario de emprestimo do Caso A ("eu mesmo pago").
 *
 * G2 e G3 precisam preencher DUAS vezes cada uma (antes e depois do "F5"), e a
 * assinatura do pedido e feita do conteudo dos campos: um campo digitado numa
 * das voltas e esquecido na outra mudaria a assinatura e faria G2 reprovar por
 * erro da sonda, com a cara de defeito de producao.
 */
async function preencherEmprestimo(achar, valor) {
  digitar(achar("mybank-conta"), ${JSON.stringify(TESOURO)});
  digitar(achar("mybank-conta-de-pagamento"), ${JSON.stringify(CORRENTE)});
  digitar(achar("mybank-descricao"), "Bicicleta");
  digitar(achar("mybank-valor"), valor);
  digitar(achar("mybank-parcelas"), "24");
  digitar(achar("mybank-vencimento"), "2026-11-10");
  await assentar();
}

// G2 e G3 -- O F5, E O CONTROLE QUE O IMPEDE DE SER VACUO.
//
// O "F5" aqui e uma MONTAGEM NOVA em outra raiz: \`emprestandoRef\`,
// \`parcelasEmVooRef\` e todo o \`useState\` nascem limpos, exatamente como depois
// de recarregar a pagina. O que atravessa e o \`sessionStorage\` -- que e o ponto
// inteiro desta metade da issue.
//
// POR QUE O PRIMEIRO POST TEM DE FALHAR
// -------------------------------------
// No SUCESSO a tela faz \`removeItem\` de proposito (emprestar o mesmo valor de
// novo e um pedido legitimo). Entao o reaproveitamento so e observavel depois de
// um POST que falhou -- que e exatamente o caso relatado na issue: a pessoa viu
// "Emprestando...", achou que travou, e recarregou.
//
// O id NAO E SEMEADO A MAO, e isso e deliberado: a assinatura e montada do
// conteudo dos campos (inclusive do \`valor\`, que passa por campo mascarado), e
// uma assinatura escrita a mao aqui mediria a minha copia da regra em vez da
// regra. G2 compara dois ids que a TELA produziu.
//
// G3 e o controle: mesmo par guardado, formulario DIFERENTE (outro valor), id
// DIFERENTE. Sem ele, uma tela que mandasse um id constante -- ou que
// reaproveitasse o id para QUALQUER formulario -- passaria G2 limpa, e seria um
// defeito pior do que o que a issue conserta: o segundo emprestimo voltaria 200
// com a divida do primeiro, sem nunca ter sido gravado.
{
  // (1) A PRIMEIRA TENTATIVA, QUE FALHA NA REDE.
  POST_DE_EMPRESTIMO_FALHA = true;

  const raiz = await montarPainel("raiz-g2");
  await preencherEmprestimo((id) => raiz.querySelector("[id='" + id + "']"), "2400.00");

  CHAMADAS = [];
  clicar(raiz.querySelector("[id='mybank-emprestar']"));
  await assentar();
  const primeiro = CHAMADAS.filter((c) => c.metodo === "POST")[0] || null;

  // (2) O F5: montagem nova, e agora a rede funciona.
  POST_DE_EMPRESTIMO_FALHA = false;

  const raiz2 = await montarPainel("raiz-g3");
  const achar2 = (id) => raiz2.querySelector("[id='" + id + "']");
  await preencherEmprestimo(achar2, "2400.00");

  CHAMADAS = [];
  clicar(achar2("mybank-emprestar"));
  await assentar();
  const segundo = CHAMADAS.filter((c) => c.metodo === "POST")[0] || null;

  out.g2 = {
    primeiroId: primeiro ? primeiro.corpo.id : null,
    segundoId: segundo ? segundo.corpo.id : null,
    // O par e esquecido no SUCESSO: depois de (2) o armazenamento tem de estar
    // limpo. Sem esta leitura, um \`removeItem\` apagado passaria a sonda e o
    // PROXIMO emprestimo igual voltaria 200 sem gravar nada.
    guardadoDepoisDoSucesso: sessionStorage.getItem(
      "pulodogato:mybank:pedido-de-emprestimo"
    ),
  };

  // (3) O CONTROLE: outro formulario depois de outra falha -> outro id.
  POST_DE_EMPRESTIMO_FALHA = true;

  const raiz3 = await montarPainel("raiz-g1-controle");
  await preencherEmprestimo((id) => raiz3.querySelector("[id='" + id + "']"), "2400.00");
  CHAMADAS = [];
  clicar(raiz3.querySelector("[id='mybank-emprestar']"));
  await assentar();
  const base = CHAMADAS.filter((c) => c.metodo === "POST")[0] || null;

  const raiz4 = await montarPainel("raiz-g1-controle-2");
  const achar4 = (id) => raiz4.querySelector("[id='" + id + "']");
  // O VALOR e o unico campo trocado: assinatura diferente, id diferente.
  await preencherEmprestimo(achar4, "999.00");
  CHAMADAS = [];
  clicar(achar4("mybank-emprestar"));
  await assentar();
  const outro = CHAMADAS.filter((c) => c.metodo === "POST")[0] || null;

  POST_DE_EMPRESTIMO_FALHA = false;

  out.g3 = {
    baseId: base ? base.corpo.id : null,
    outroId: outro ? outro.corpo.id : null,
  };
}

// =============================================================================
// H -- confirmar a MESMA parcela duas vezes da UMA baixa, e as DIFERENTES nao
//      se atrapalham (HMO-390)
// =============================================================================
// \`confirmarRecebimento\` nao tinha guarda NENHUMA antes desta issue -- nem
// \`salvando\`, nem \`disabled\`, nem latch --, entao dois toques na mesma linha
// mandavam duas baixas da mesma parcela.
//
// E POR QUE A TRAVA E UM \`Set\` E NAO UM BOOLEANO
// ---------------------------------------------
// Um booleano global consertaria H1 e QUEBRARIA H2: confirmar a parcela 3 e logo
// depois a 4 sao duas baixas legitimas, e a segunda cairia calada. H2 e o
// controle que impede o conserto de virar uma regressao de produto -- sem ele, o
// mutante que troca o \`Set\` por um booleano sobreviveria.
{
  // DUAS parcelas \`reported\`, que o fixture padrao nao tem (ver \`LOANS\`).
  LOANS = [
    {
      id: "l-duas",
      descricao: "Moto eletrica",
      conta_credora_id: ${JSON.stringify(CARTEIRA)},
      caso: "conexao",
      status: "active",
      principal: 24000,
      total_de_parcelas: 24,
      primeiro_vencimento: "2026-09-10",
      quem_deve_pagar: "Lais",
      devedor_id: ${JSON.stringify(LAIS)},
      parcelas: [
        { id: "p-x", valor: 1000, numero: 3, total: 24, rotulo: "3 de 24", vencimento: "2026-11-10", status: "reported", a_confirmar: true },
        { id: "p-y", valor: 1000, numero: 4, total: 24, rotulo: "4 de 24", vencimento: "2026-12-10", status: "reported", a_confirmar: true },
      ],
    },
  ];

  const raiz = await montarPainel("raiz-h");
  const botaoDe = (id) =>
    raiz.querySelector('[data-confirmar="' + id + '"] button');

  // CONTROLE: as duas linhas existem. Sem isto, \`botaoDe\` devolvendo \`null\`
  // faria as duas assercoes de baixo medirem zero clique.
  out.h_linhas = Array.from(raiz.querySelectorAll("[data-confirmar]")).map((el) =>
    el.getAttribute("data-confirmar")
  );

  // H1: A MESMA PARCELA, DOIS TOQUES NO MESMO TICK.
  CHAMADAS = [];
  ReactDOM.unstable_batchedUpdates(function () {
    clicar(botaoDe("p-x"));
    clicar(botaoDe("p-x"));
  });
  await assentar();
  out.h_mesma = CHAMADAS.filter((c) => c.metodo === "PATCH").map((c) => c.url);

  // H2: DUAS PARCELAS DIFERENTES, tambem no mesmo tick -- as duas passam.
  const raiz2 = await montarPainel("raiz-h2");
  const botaoDe2 = (id) =>
    raiz2.querySelector('[data-confirmar="' + id + '"] button');

  CHAMADAS = [];
  ReactDOM.unstable_batchedUpdates(function () {
    clicar(botaoDe2("p-x"));
    clicar(botaoDe2("p-y"));
  });
  await assentar();
  out.h_diferentes = CHAMADAS.filter((c) => c.metodo === "PATCH").map(
    (c) => c.url
  );

  // H3: A BAIXA QUE FALHOU TEM SEGUNDA TENTATIVA.
  //
  // O \`delete\` do \`finally\` e o que faz esta linha existir. Sem ele a parcela
  // fica em voo para sempre -- e, como o botao Confirmar NAO tem \`disabled\`, a
  // pessoa continua podendo clicar num botao que nao chama rota nenhuma e nao
  // diz nada. Um clique que nao faz nada e nao avisa e pior que o erro.
  const raiz3 = await montarPainel("raiz-h3");
  const botaoDe3 = (id) =>
    raiz3.querySelector('[data-confirmar="' + id + '"] button');

  CHAMADAS = [];
  PATCH_DE_PARCELA_FALHA = true;
  clicar(botaoDe3("p-x"));
  await assentar();
  const primeiraTentativa = CHAMADAS.filter((c) => c.metodo === "PATCH").length;

  // A rede volta, e a pessoa tenta DE NOVO a mesma parcela.
  PATCH_DE_PARCELA_FALHA = false;
  clicar(botaoDe3("p-x"));
  await assentar();

  out.h_retentativa = {
    primeira: primeiraTentativa,
    total: CHAMADAS.filter((c) => c.metodo === "PATCH").length,
  };
}

// G4 -- O 409 ESQUECE O PEDIDO, E E ISSO QUE FAZ O "tente de novo" SER VERDADE
//
// 409 quer dizer "o id que voce escolheu e de uma linha que nao e sua". O par
// guardado continuaria casando com este formulario, entao sem o \`removeItem\`
// deste ramo o reenvio mandaria o MESMO id, colidiria com a MESMA linha e
// voltaria 409 -- para sempre. A frase que a rota manda ("Tente de novo") seria
// mentira num botao que nunca mais funciona.
//
// O controle e o id: depois do 409 o proximo POST tem de sair com um id
// DIFERENTE. Afirmar so "saiu um segundo POST" passaria verde com o id repetido
// -- e e o id repetido que condena a pessoa ao 409 eterno.
{
  POST_DE_EMPRESTIMO_409 = true;

  const raiz = await montarPainel("raiz-g4");
  const achar = (id) => raiz.querySelector("[id='" + id + "']");
  await preencherEmprestimo(achar, "2400.00");

  CHAMADAS = [];
  clicar(achar("mybank-emprestar"));
  await assentar();
  const recusado = CHAMADAS.filter((c) => c.metodo === "POST")[0] || null;

  // A FRASE E LIDA AQUI, e nao depois da retentativa: o segundo envio da
  // certo e o \`setErro(null)\` dele apaga o aviso. Lido no fim, o campo vem
  // \`null\` -- que se le como "a rota nao avisou nada", e nao como "o aviso
  // ja saiu da tela".
  const erroDo409 = achar("mybank-erro")
    ? achar("mybank-erro").textContent
    : null;

  // A pessoa le a frase e tenta de novo, no mesmo formulario.
  POST_DE_EMPRESTIMO_409 = false;
  CHAMADAS = [];
  clicar(achar("mybank-emprestar"));
  await assentar();
  const retentativa = CHAMADAS.filter((c) => c.metodo === "POST")[0] || null;

  out.g4 = {
    erro: erroDo409,
    idRecusado: recusado ? recusado.corpo.id : null,
    idDaRetentativa: retentativa ? retentativa.corpo.id : null,
  };

  // CONTROLE DO CONTROLE: num erro que NAO e 409 (a rede caiu) o par FICA --
  // e ele que faz o reenvio depois do F5 nao criar a segunda divida. Sem este
  // caso, um \`removeItem\` posto no caminho de erro INTEIRO passaria G4 e
  // desfaria G2 em silencio.
  POST_DE_EMPRESTIMO_FALHA = true;

  const raizB = await montarPainel("raiz-g4b");
  const acharB = (id) => raizB.querySelector("[id='" + id + "']");
  await preencherEmprestimo(acharB, "2400.00");

  CHAMADAS = [];
  clicar(acharB("mybank-emprestar"));
  await assentar();
  const caiu = CHAMADAS.filter((c) => c.metodo === "POST")[0] || null;

  CHAMADAS = [];
  clicar(acharB("mybank-emprestar"));
  await assentar();
  const depoisDaQueda = CHAMADAS.filter((c) => c.metodo === "POST")[0] || null;

  POST_DE_EMPRESTIMO_FALHA = false;

  out.g4b = {
    idDaQueda: caiu ? caiu.corpo.id : null,
    idDepois: depoisDaQueda ? depoisDaQueda.corpo.id : null,
  };
}

// =============================================================================
// I -- o botao «Cancelar»: so em \`active\`, com pergunta, e a pergunta DECIDE
//      (HMO-391)
// =============================================================================
// Tres coisas que nao aparecem em \`tsc\`, \`lint\` nem \`build\`, e as tres sao a
// feature:
//
//   * O BOTAO NAO EXISTIR em emprestimo \`settled\` nem \`cancelled\`. Os dois ja
//     estao encerrados e a rota recusa os dois com frase propria -- oferecer o
//     clique ali e oferecer uma operacao cujo unico resultado possivel e um
//     toast de erro. O fixture padrao tem os TRES estados na MESMA conta, entao
//     "o botao aparece" e "o botao aparece onde deve" sao perguntas diferentes;
//   * A PERGUNTA SER BLOQUEANTE E DECIDIR. \`confirm()\` devolvendo \`false\` tem de
//     deixar a tela exatamente como estava: zero PATCH. Uma acao destrutiva cujo
//     cancelar nao cancela e pior que nao ter a pergunta, porque a pessoa confia
//     nela;
//   * O TEXTO DA PERGUNTA, lido do que o app PASSOU para \`window.confirm\` -- e a
//     unica forma de medir o texto de um dialogo nativo, e a razao pela qual esta
//     tela usa \`confirm()\` e nao um dialogo de componente.
{
  // A pergunta e substituida, como em \`ListaDeMovimentacao\`: a sonda guarda o
  // texto e DECIDE a resposta.
  let PERGUNTAS = [];
  let RESPOSTA_DA_PERGUNTA = false;
  window.confirm = function (texto) {
    PERGUNTAS.push(texto);
    return RESPOSTA_DA_PERGUNTA;
  };

  // O fixture volta ao padrao (a secao H o trocou): os tres estados na conta
  // CARTEIRA, mais o emprestimo da outra conta.
  LOANS = [
    {
      id: "l-ativo",
      descricao: "Moto eletrica",
      conta_credora_id: ${JSON.stringify(CARTEIRA)},
      caso: "conexao",
      status: "active",
      principal: 24000,
      total_de_parcelas: 24,
      primeiro_vencimento: "2026-09-10",
      quem_deve_pagar: "Lais",
      devedor_id: ${JSON.stringify(LAIS)},
      parcelas: [
        { id: "p-i1", valor: 1000, numero: 1, total: 24, rotulo: "1 de 24", vencimento: "2026-09-10", status: "pending", a_confirmar: false },
      ],
    },
    {
      id: "l-auto-ativo",
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
        { id: "p-i2", valor: 1000, numero: 1, total: 6, rotulo: "1 de 6", vencimento: "2026-10-05", status: "pending", a_confirmar: false },
      ],
    },
    {
      id: "l-ja-quitado",
      descricao: "Celular quitado",
      conta_credora_id: ${JSON.stringify(CARTEIRA)},
      caso: "conexao",
      status: "settled",
      principal: 2000,
      total_de_parcelas: 2,
      primeiro_vencimento: "2026-05-10",
      quem_deve_pagar: "Lais",
      devedor_id: ${JSON.stringify(LAIS)},
      parcelas: [],
    },
    {
      id: "l-ja-cancelado",
      descricao: "Bicicleta cancelada",
      conta_credora_id: ${JSON.stringify(CARTEIRA)},
      caso: "conexao",
      status: "cancelled",
      principal: 999,
      total_de_parcelas: 1,
      primeiro_vencimento: "2026-08-10",
      quem_deve_pagar: "Bruno",
      devedor_id: ${JSON.stringify(BRUNO)},
      parcelas: [],
    },
  ];

  const raiz = await montarPainel("raiz-i");
  const botaoDe = (id) =>
    raiz.querySelector('[data-cancelar-emprestimo="' + id + '"]');

  // O RECORTE DA HMO-398 ABRE O PAINEL COM OS ENCERRADOS FECHADOS, e esta secao
  // mede o botao Cancelar nos DOIS grupos -- entao ela ABRE a secao antes de
  // ler. O estado fechado vai medido junto (\`i_fechadas\`): sem ele, abrir aqui
  // esconderia o recorte desta sonda, e I1 passaria a falar de uma tela que
  // ninguem ve ao chegar no painel.
  out.i_fechadas = Array.from(raiz.querySelectorAll("[data-emprestimo]")).map(
    (el) => el.getAttribute("data-emprestimo")
  );
  clicar(raiz.querySelector("[data-encerrados-do-mybank]"));
  await assentar();

  // I1: QUAIS LINHAS TEM BOTAO. A lista das linhas vem junto, para a assercao
  // poder separar "o botao nao esta ali" de "a linha nao esta ali".
  out.i_linhas = Array.from(raiz.querySelectorAll("[data-emprestimo]")).map(
    (el) => el.getAttribute("data-emprestimo")
  );
  out.i_com_botao = Array.from(
    raiz.querySelectorAll("[data-cancelar-emprestimo]")
  ).map((el) => el.getAttribute("data-cancelar-emprestimo"));

  // I2: A PERGUNTA RECUSADA NAO MANDA NADA.
  PERGUNTAS = [];
  CHAMADAS = [];
  RESPOSTA_DA_PERGUNTA = false;
  clicar(botaoDe("l-ativo"));
  await assentar();
  out.i_recusada = {
    perguntas: PERGUNTAS.slice(),
    patches: CHAMADAS.filter((c) => c.metodo === "PATCH").length,
  };

  // I3: A PERGUNTA ACEITA MANDA UM PATCH, com \`status: cancelled\` no corpo.
  PERGUNTAS = [];
  CHAMADAS = [];
  RESPOSTA_DA_PERGUNTA = true;
  clicar(botaoDe("l-ativo"));
  await assentar();
  out.i_aceita = CHAMADAS.filter((c) => c.metodo === "PATCH").map((c) => ({
    url: c.url,
    corpo: c.corpo,
  }));

  // I4: O TEXTO DO CASO A diz Contas a Pagar; o do CASO B nomeia a outra pessoa.
  const raiz2 = await montarPainel("raiz-i2");
  const botaoDe2 = (id) =>
    raiz2.querySelector('[data-cancelar-emprestimo="' + id + '"]');

  PERGUNTAS = [];
  RESPOSTA_DA_PERGUNTA = false;
  clicar(botaoDe2("l-auto-ativo"));
  await assentar();
  out.i_texto_do_auto = PERGUNTAS[0] || null;

  // I5: DOIS TOQUES NO MESMO TICK dao UM PATCH -- o latch por emprestimo.
  //
  // Dentro de \`unstable_batchedUpdates\`, como a secao H: fora dele o React
  // legado descarrega entre os dois cliques e o teste mediria o re-render em vez
  // do latch (\`latch-de-dois-cliques-so-mede-dentro-de-batchedupdates\`).
  const raiz3 = await montarPainel("raiz-i3");
  const botaoDe3 = (id) =>
    raiz3.querySelector('[data-cancelar-emprestimo="' + id + '"]');

  PERGUNTAS = [];
  CHAMADAS = [];
  RESPOSTA_DA_PERGUNTA = true;
  ReactDOM.unstable_batchedUpdates(function () {
    clicar(botaoDe3("l-ativo"));
    clicar(botaoDe3("l-ativo"));
  });
  await assentar();
  out.i_dois_toques = {
    perguntas: PERGUNTAS.length,
    patches: CHAMADAS.filter((c) => c.metodo === "PATCH").length,
  };

  // I6: CONTROLE DO I5 -- DUAS dividas DIFERENTES no mesmo tick passam as duas.
  //
  // Sem este caso, um booleano global no lugar do \`Set\` passaria I5 e seria uma
  // regressao de produto: cancelar duas dividas erradas em sequencia (que e o
  // caso que abriu a HMO-383 -- duas, lancadas sem querer) perderia a segunda,
  // calada.
  const raiz4 = await montarPainel("raiz-i4");
  const botaoDe4 = (id) =>
    raiz4.querySelector('[data-cancelar-emprestimo="' + id + '"]');

  PERGUNTAS = [];
  CHAMADAS = [];
  RESPOSTA_DA_PERGUNTA = true;
  ReactDOM.unstable_batchedUpdates(function () {
    clicar(botaoDe4("l-ativo"));
    clicar(botaoDe4("l-auto-ativo"));
  });
  await assentar();
  out.i_duas_dividas = CHAMADAS.filter((c) => c.metodo === "PATCH").map(
    (c) => c.url
  );

  // I7: O CANCELAMENTO QUE FALHOU TEM SEGUNDA TENTATIVA (o \`delete\` do
  // \`finally\`).
  const raiz5 = await montarPainel("raiz-i5");
  const botaoDe5 = (id) =>
    raiz5.querySelector('[data-cancelar-emprestimo="' + id + '"]');

  PERGUNTAS = [];
  CHAMADAS = [];
  RESPOSTA_DA_PERGUNTA = true;
  PATCH_DE_EMPRESTIMO_FALHA = true;
  clicar(botaoDe5("l-ativo"));
  await assentar();
  const primeiroCancelamento = CHAMADAS.filter(
    (c) => c.metodo === "PATCH"
  ).length;

  // A rede volta, e a pessoa tenta DE NOVO a mesma divida.
  PATCH_DE_EMPRESTIMO_FALHA = false;
  clicar(botaoDe5("l-ativo"));
  await assentar();

  out.i_retentativa = {
    primeira: primeiroCancelamento,
    total: CHAMADAS.filter((c) => c.metodo === "PATCH").length,
  };
}

// =============================================================================
// J -- A LINHA DA AGENDA: a parcela desenhada UMA vez, em Contas a Pagar
//      (HMO-386)
// =============================================================================
// A mesma parcela aparecia em DUAS linhas de \`/dashboard/bills\`: uma na agenda
// (a HMO-372 fundiu a divida na rota) e uma no bloco do devedor (HMO-371). A
// saida escolhida tirou o BLOCO daquela tela -- ele foi para
// \`/dashboard/mybank\` -- e deu a LINHA o gesto que so o bloco tinha.
//
// O QUE ESTA SECAO MEDE, E QUE O SOURCE-LEVEL NAO ALCANCA: a linha faz o gesto
// certo (\`reported\`, na rota do MyBank, com o id que esta em
// \`mybank_installment_id\`), le o estado certo (\`mybank_status\`, e nao \`status\`)
// e NAO oferece nenhuma das quatro acoes da agenda -- todas montariam a URL com
// o \`id: null\` que esta linha tem por construcao.
{
  /** A linha no formato de \`parcelasDevidasNaAgenda\` (lib/leituras-do-mybank). */
  const naAgenda = (id, mybankStatus) => ({
    id: null,
    parcela_do_mybank: true,
    mybank_installment_id: id,
    mybank_loan_id: "l-moto",
    lender_user_id: ${JSON.stringify(LAIS)},
    user_id: ${JSON.stringify(EU)},
    description: "Moto eletrica",
    amount: 1000,
    due_date: "2026-11-10",
    // \`status\` E SEMPRE 'pending' AQUI, INCLUSIVE NA PARCELA AVISADA, e e isso
    // que da sentido ao caso J3: aquele campo e de DINHEIRO (\`reported\` ainda e
    // divida), e quem diz o estado da TELA e \`mybank_status\`. Um componente que
    // lesse \`status\` passaria J1 e falharia J3.
    status: "pending",
    mybank_status: mybankStatus,
    effective_status: "pending",
    days_until_due: 30,
    direction: "expense",
    notes: "mybank:" + id,
    group_id: null,
    recurring_rule_id: null,
    selo: "MyBank",
    installment_number: 2,
    installment_total: 24,
  });

  const ler = (raiz) => {
    const el = raiz.querySelector("[data-parcela-do-mybank]");
    if (!el) return { linha: null };
    return {
      linha: el.getAttribute("data-parcela-do-mybank"),
      selo: el.querySelector("[data-selo-do-mybank]")
        ? el.querySelector("[data-selo-do-mybank]").textContent
        : null,
      // O ENDERECO do selo: e por ele que o nome de quem emprestou continua
      // alcancavel depois de o bloco sair desta tela.
      href: el.querySelector("a") ? el.querySelector("a").getAttribute("href") : null,
      rotulo: el.querySelector("[data-parcela-rotulo]")
        ? el.querySelector("[data-parcela-rotulo]").textContent
        : null,
      avisar: el.querySelector("[data-avisar]")
        ? el.querySelector("[data-avisar]").getAttribute("data-avisar")
        : null,
      avisarDesabilitado: el.querySelector("[data-avisar]")
        ? el.querySelector("[data-avisar]").disabled
        : null,
      // O ATRIBUTO e nao o texto: e ele que diz de QUAL parcela este estado e
      // -- duas linhas avisadas na mesma secao tem o mesmo texto, e a sonda de
      // producao conta por id.
      avisado: el.querySelector("[data-avisado]")
        ? el.querySelector("[data-avisado]").getAttribute("data-avisado")
        : null,
      // TODOS os botoes da linha. A medida de "ela nao herdou as acoes da
      // agenda" e a CONTAGEM: procurar por titulo daria verde se o botao
      // mudasse de rotulo, e a linha da agenda tem quatro deles (baixa,
      // alterar, pular, comprovante).
      botoes: el.querySelectorAll("button").length,
      texto: el.textContent,
    };
  };

  // J1/J2: a parcela PENDENTE -- tem o botao, e o clique manda \`reported\`.
  let avisos = 0;
  const raiz1 = document.getElementById("raiz-j1");
  CHAMADAS = [];
  ReactDOM.render(
    React.createElement(LinhaDaParcelaDoMyBank, {
      parcela: naAgenda(${JSON.stringify(PARCELA_NA_AGENDA)}, "pending"),
      valor: "R$ 1.000,00",
      aoAvisar: () => {
        avisos += 1;
      },
      online: true,
    }),
    raiz1
  );
  await assentar();
  out.j_pendente = ler(raiz1);
  // A LINHA NAO BUSCA NADA SOZINHA: a agenda ja veio na leitura da tela, e um
  // \`fetch\` no mount seria a divida lida duas vezes por pagina.
  out.j_leituras_no_mount = CHAMADAS.map((c) => c.url);

  CHAMADAS = [];
  clicar(raiz1.querySelector("[data-avisar]"));
  await assentar();
  out.j_aviso = {
    patches: CHAMADAS.filter((c) => c.metodo === "PATCH"),
    // O \`aoAvisar\` e o que recarrega a agenda da tela. Sem ele o rotulo da
    // linha ficaria dizendo "Avisar que paguei" depois do aviso ter saido.
    recarregou: avisos,
  };

  // J3: a parcela JA AVISADA -- o botao virou estado, e nao desapareceu.
  const raiz2 = document.getElementById("raiz-j2");
  ReactDOM.render(
    React.createElement(LinhaDaParcelaDoMyBank, {
      parcela: naAgenda(${JSON.stringify(PARCELA_NA_AGENDA_AVISADA)}, "reported"),
      valor: "R$ 1.000,00",
      aoAvisar: () => {},
      online: true,
    }),
    raiz2
  );
  await assentar();
  out.j_avisada = ler(raiz2);

  // J4: SEM REDE o botao fica desabilitado -- as outras linhas desta tela usam
  // o mesmo \`online\`, e um gesto que sai offline morre no \`catch\`.
  const raiz3 = document.getElementById("raiz-j3");
  ReactDOM.render(
    React.createElement(LinhaDaParcelaDoMyBank, {
      parcela: naAgenda(${JSON.stringify(PARCELA_NA_AGENDA)}, "pending"),
      valor: "R$ 1.000,00",
      aoAvisar: () => {},
      online: false,
    }),
    raiz3
  );
  await assentar();
  out.j_offline = ler(raiz3);
}

// =============================================================================
// K -- o gesto «Antecipar»: o dialogo diz os tres numeros ANTES do clique
//      (HMO-397, F4 da HMO-393)
// =============================================================================
// O que esta secao mede, e nenhum item aparece em \`tsc\`, \`lint\` nem \`build\`:
//
//   * O GESTO APARECER SO ONDE SERVE, e a condicao e DIFERENTE da do Cancelar:
//     \`active\` **E** com parcela em aberto. O emprestimo \`active\` com a serie
//     inteira paga -- alcancavel, sao os que quitaram antes da HMO-394 -- tem
//     Cancelar e NAO tem Antecipar. Os dois botoes na mesma linha e o que torna
//     essa diferenca mensuravel: uma condicao copiada do Cancelar daria duas
//     listas identicas;
//
//   * OS TRES NUMEROS ANTES DO CLIQUE, e com zero POST. Depois do clique o
//     dinheiro ja saiu da conta de quem paga e nao existe "desantecipar" -- a
//     previa e a unica chance de a pessoa ver o que vai acontecer. A assercao le
//     o TEXTO do \`data-previa-antecipacao\` e conta as chamadas: uma previa que
//     consultasse a rota para montar o numero seria outra feature;
//
//   * A TERCEIRA FRASE ("as que sobram mantem o valor"), que e a que impede a
//     leitura errada. Sem ela a tela fica PLAUSIVEL e a pessoa le "minha parcela
//     baixou" -- a variante de produto REJEITADA no cartao \`ae436b4a\`. E o
//     mutante nomeado da issue;
//
//   * O LATCH DE DOIS CLIQUES, dentro de \`unstable_batchedUpdates\` e LENDO o
//     \`disabled\` no instante do segundo (como G1). Aqui o segundo clique custa
//     DINHEIRO: a rota de antecipacao nao tem idempotencia por id, entao dois
//     POST pagam a cauda duas vezes -- duas pernas de entrada por parcela e o
//     dobro no extrato;
//
//   * A PARCELA ANTECIPADA SE DISTINGUINDO na lista do credor, sem coluna nova.
{
  // O fixture da secao: QUATRO estados na MESMA conta, e cada um existe para
  // separar uma pergunta da outra.
  LOANS = [
    {
      // 6 parcelas, a 1 PAGA EM DIA (\`paid_date\` = \`vencimento\`: ela NAO e
      // antecipada, e e isso que impede o rotulo de antecipada de aparecer em
      // toda parcela paga) e 5 em aberto, de 11/2026 a 03/2027.
      id: "l-k-ativo",
      descricao: "Moto eletrica",
      conta_credora_id: ${JSON.stringify(CARTEIRA)},
      caso: "conexao",
      status: "active",
      principal: 600,
      total_de_parcelas: 6,
      primeiro_vencimento: "2026-10-10",
      quem_deve_pagar: "Lais",
      devedor_id: ${JSON.stringify(LAIS)},
      parcelas: [
        { id: "p-k1", valor: 100, numero: 1, total: 6, rotulo: "1 de 6", vencimento: "2026-10-10", status: "paid", a_confirmar: false, paid_date: "2026-10-10" },
        { id: "p-k2", valor: 100, numero: 2, total: 6, rotulo: "2 de 6", vencimento: "2026-11-10", status: "pending", a_confirmar: false, paid_date: null },
        { id: "p-k3", valor: 100, numero: 3, total: 6, rotulo: "3 de 6", vencimento: "2026-12-10", status: "pending", a_confirmar: false, paid_date: null },
        { id: "p-k4", valor: 100, numero: 4, total: 6, rotulo: "4 de 6", vencimento: "2027-01-10", status: "pending", a_confirmar: false, paid_date: null },
        { id: "p-k5", valor: 100, numero: 5, total: 6, rotulo: "5 de 6", vencimento: "2027-02-10", status: "pending", a_confirmar: false, paid_date: null },
        { id: "p-k6", valor: 100, numero: 6, total: 6, rotulo: "6 de 6", vencimento: "2027-03-10", status: "pending", a_confirmar: false, paid_date: null },
      ],
    },
    {
      // O AUTO-EMPRESTIMO: a previa dele tem a frase de onde o dinheiro sai, e
      // ele e o segundo emprestimo do controle do latch (K7).
      id: "l-k-auto",
      descricao: "Notebook para mim",
      conta_credora_id: ${JSON.stringify(CARTEIRA)},
      caso: "auto",
      status: "active",
      principal: 300,
      total_de_parcelas: 3,
      primeiro_vencimento: "2026-11-05",
      quem_deve_pagar: "Voce mesmo",
      devedor_id: ${JSON.stringify(EU)},
      parcelas: [
        { id: "p-ka1", valor: 100, numero: 1, total: 3, rotulo: "1 de 3", vencimento: "2026-11-05", status: "pending", a_confirmar: false, paid_date: null },
        { id: "p-ka2", valor: 100, numero: 2, total: 3, rotulo: "2 de 3", vencimento: "2026-12-05", status: "pending", a_confirmar: false, paid_date: null },
        { id: "p-ka3", valor: 100, numero: 3, total: 3, rotulo: "3 de 3", vencimento: "2027-01-05", status: "pending", a_confirmar: false, paid_date: null },
      ],
    },
    {
      // \`active\` COM A SERIE INTEIRA PAGA -- o estado que separa as duas
      // condicoes. Sem esta linha, "antecipar aparece onde o cancelar aparece"
      // passaria verde, e o gesto ficaria oferecido num emprestimo em que a rota
      // so pode responder \`mais_do_que_em_aberto\`.
      id: "l-k-pago",
      descricao: "Celular pago sem settled",
      conta_credora_id: ${JSON.stringify(CARTEIRA)},
      caso: "conexao",
      status: "active",
      principal: 200,
      total_de_parcelas: 2,
      primeiro_vencimento: "2026-05-10",
      quem_deve_pagar: "Lais",
      devedor_id: ${JSON.stringify(LAIS)},
      parcelas: [
        { id: "p-kp1", valor: 100, numero: 1, total: 2, rotulo: "1 de 2", vencimento: "2026-05-10", status: "paid", a_confirmar: false, paid_date: "2026-05-10" },
        { id: "p-kp2", valor: 100, numero: 2, total: 2, rotulo: "2 de 2", vencimento: "2026-06-10", status: "paid", a_confirmar: false, paid_date: "2026-06-10" },
      ],
    },
    {
      // A SERIE COM PARCELA ANTECIPADA: a 4 paga em 10/2026 vencendo em 01/2027.
      // O badge diz \`2/4\` com a 2 e a 3 pendentes, e e o rotulo de antecipada que
      // explica a diferenca.
      id: "l-k-antecipada",
      descricao: "Geladeira",
      conta_credora_id: ${JSON.stringify(CARTEIRA)},
      caso: "conexao",
      status: "active",
      principal: 400,
      total_de_parcelas: 4,
      primeiro_vencimento: "2026-10-10",
      quem_deve_pagar: "Bruno",
      devedor_id: ${JSON.stringify(BRUNO)},
      parcelas: [
        { id: "p-kn1", valor: 100, numero: 1, total: 4, rotulo: "1 de 4", vencimento: "2026-10-10", status: "paid", a_confirmar: false, paid_date: "2026-10-10" },
        { id: "p-kn2", valor: 100, numero: 2, total: 4, rotulo: "2 de 4", vencimento: "2026-11-10", status: "pending", a_confirmar: false, paid_date: null },
        { id: "p-kn3", valor: 100, numero: 3, total: 4, rotulo: "3 de 4", vencimento: "2026-12-10", status: "pending", a_confirmar: false, paid_date: null },
        { id: "p-kn4", valor: 100, numero: 4, total: 4, rotulo: "4 de 4", vencimento: "2027-01-10", status: "paid", a_confirmar: false, paid_date: "2026-10-11" },
      ],
    },
    {
      // \`cancelled\` COM PARCELA EM ABERTO -- a combinacao que ninguem escreve de
      // proposito e que o banco PERMITE (\`status\` e coluna de texto na 053, e
      // cancelar o emprestimo nao renumera nem apaga as parcelas). E ela que
      // torna a pergunta de STATUS do \`podeAntecipar\` MENSURAVEL: sem esta
      // linha, um \`podeAntecipar\` que so olhasse "tem parcela em aberto" daria
      // exatamente a mesma lista de botoes -- medido, aquele mutante sobreviveu
      // ate este fixture existir.
      //
      // E o defeito seria real: a rota recusa com \`emprestimo_nao_esta_ativo\`, e
      // a tela estaria oferecendo o gesto num emprestimo encerrado.
      id: "l-k-cancelado",
      descricao: "Bicicleta cancelada",
      conta_credora_id: ${JSON.stringify(CARTEIRA)},
      caso: "conexao",
      status: "cancelled",
      principal: 100,
      total_de_parcelas: 1,
      primeiro_vencimento: "2026-08-10",
      quem_deve_pagar: "Bruno",
      devedor_id: ${JSON.stringify(BRUNO)},
      parcelas: [
        { id: "p-kc1", valor: 100, numero: 1, total: 1, rotulo: "1 de 1", vencimento: "2026-08-10", status: "pending", a_confirmar: false, paid_date: null },
      ],
    },
    {
      id: "l-k-quitado",
      descricao: "Bicicleta quitada",
      conta_credora_id: ${JSON.stringify(CARTEIRA)},
      caso: "conexao",
      status: "settled",
      principal: 100,
      total_de_parcelas: 1,
      primeiro_vencimento: "2026-04-10",
      quem_deve_pagar: "Lais",
      devedor_id: ${JSON.stringify(LAIS)},
      parcelas: [
        { id: "p-kq1", valor: 100, numero: 1, total: 1, rotulo: "1 de 1", vencimento: "2026-04-10", status: "paid", a_confirmar: false, paid_date: "2026-04-10" },
      ],
    },
  ];

  const raiz = await montarPainel("raiz-k");
  const anteciparDe = (id) =>
    raiz.querySelector('[data-antecipar-emprestimo="' + id + '"]');
  const previaDe = (raizDoCaso, id) => {
    const el = raizDoCaso.querySelector(
      '[data-previa-antecipacao="' + id + '"]'
    );
    return el ? el.textContent : null;
  };

  // =========================================================================
  // L (HMO-398) -- O RECORTE DA LISTA, medido NESTE fixture de proposito
  // =========================================================================
  // Ele e o unico que tem os DOIS lados do controle negativo na mesma conta:
  //
  //   * \`l-k-pago\` -- \`active\` com a serie INTEIRA paga (2/2). E o emprestimo
  //     LEGADO, o que quitou antes da HMO-394, e ele tem de ficar EM ANDAMENTO:
  //     e de lá que vem a saida dele (o botao Cancelar);
  //   * \`l-k-quitado\` -- \`settled\`, tambem com tudo pago (1/1).
  //
  // Os dois tem a MESMA forma de parcelas ("nada em aberto") e status
  // diferentes. Um recorte que lesse as parcelas em vez do status mandaria os
  // dois para a secao escondida -- e e esse o recorte que parece certo.
  const idsDe = (seletor) =>
    Array.from(raiz.querySelectorAll(seletor)).map((el) =>
      el.getAttribute("data-emprestimo")
    );
  const botaoDosEncerrados = () =>
    raiz.querySelector("[data-encerrados-do-mybank]");
  const fotoDaLista = () => ({
    linhas: idsDe("[data-emprestimo]"),
    encerradas: idsDe("[data-emprestimo][data-encerrado]"),
    resumo: raiz.querySelector("[data-resumo-da-lista]").textContent,
    rotuloDoBotao: botaoDosEncerrados()
      ? botaoDosEncerrados().textContent
      : null,
    // O status de cada linha, pela ancora propria: e ele que distingue o
    // quitado do cancelado DENTRO da secao dos encerrados.
    status: Array.from(raiz.querySelectorAll("[data-emprestimo]")).map((el) => ({
      id: el.getAttribute("data-emprestimo"),
      texto: el.querySelector("[data-status-do-emprestimo]").textContent,
    })),
  });

  out.l_fechada = fotoDaLista();

  clicar(botaoDosEncerrados());
  await assentar();
  out.l_aberta = fotoDaLista();

  // E VOLTA. Um botao que so abre deixa a pessoa sem caminho de volta, e a
  // secao aberta e exatamente o que esta issue veio encurtar.
  clicar(botaoDosEncerrados());
  await assentar();
  out.l_fechada_de_novo = fotoDaLista();

  // A ALTURA EM PIXELS, nos dois estados: o colapso tem de encurtar o card DE
  // VERDADE. Sem esta medida, "a linha saiu do DOM" poderia conviver com um
  // card do mesmo tamanho -- a forma de E4, para o bloco do devedor.
  const cardDaLista = raiz.querySelector("[data-card-da-lista]");
  out.l_altura_fechada = cardDaLista.getBoundingClientRect().height;

  // O ULTIMO CLIQUE DEIXA A SECAO ABERTA DE PROPOSITO: K1 em diante mede o
  // botao Cancelar e o Antecipar nos DOIS grupos, e fosse so no grupo em
  // andamento "o encerrado nao tem botao" passaria vacuo -- a linha dele nem
  // estaria na tela.
  clicar(botaoDosEncerrados());
  await assentar();
  out.l_altura_aberta = cardDaLista.getBoundingClientRect().height;

  // K1: QUAIS LINHAS TEM CADA BOTAO. As duas listas saem juntas porque a
  // assercao e sobre a DIFERENCA entre elas -- uma condicao copiada do Cancelar
  // daria duas listas iguais e nenhum numero errado.
  out.k_linhas = Array.from(raiz.querySelectorAll("[data-emprestimo]")).map(
    (el) => el.getAttribute("data-emprestimo")
  );
  out.k_com_antecipar = Array.from(
    raiz.querySelectorAll("[data-antecipar-emprestimo]")
  ).map((el) => el.getAttribute("data-antecipar-emprestimo"));
  out.k_com_cancelar = Array.from(
    raiz.querySelectorAll("[data-cancelar-emprestimo]")
  ).map((el) => el.getAttribute("data-cancelar-emprestimo"));

  // K2: O ROTULO DA PARCELA ANTECIPADA, ao lado do progresso que ele explica.
  out.k_antecipada = Array.from(raiz.querySelectorAll("[data-emprestimo]")).map(
    (el) => ({
      id: el.getAttribute("data-emprestimo"),
      progresso: el.querySelector("[data-progresso]").textContent,
      antecipadas: el.querySelector("[data-antecipadas]")
        ? el.querySelector("[data-antecipadas]").textContent
        : null,
    })
  );

  // K3: O DIALOGO ABRE SEM CHAMAR ROTA NENHUMA, e a previa de 1 parcela diz o
  // valor, o vencimento novo e a terceira frase.
  CHAMADAS = [];
  clicar(anteciparDe("l-k-ativo"));
  await assentar();

  const dialogo = raiz.querySelector(
    '[data-dialogo-antecipacao="l-k-ativo"]'
  );
  const seletorDeQuantas = raiz.querySelector(
    '[data-antecipar-quantas="l-k-ativo"]'
  );

  out.k_abertura = {
    chamadas: CHAMADAS.map((c) => c.metodo + " " + c.url),
    temDialogo: Boolean(dialogo),
    // AS OPCOES: no maximo as em aberto (5), e nunca as 6 da serie. E a recusa
    // de \`mais_do_que_em_aberto\` escrita na FORMA do campo.
    opcoes: seletorDeQuantas
      ? Array.from(seletorDeQuantas.options).map((o) => o.value)
      : null,
    previa: previaDe(raiz, "l-k-ativo"),
    // O dialogo e de UM emprestimo so: nenhum outro pode ter aberto junto.
    quantosDialogos: raiz.querySelectorAll("[data-dialogo-antecipacao]").length,
  };

  // K4: TROCAR A QUANTIDADE REFAZ A PREVIA -- 2 parcelas custam o dobro e o
  // ultimo vencimento anda DOIS meses. Sem este gesto, uma previa fixa em 1
  // passaria K3.
  digitar(seletorDeQuantas, "2");
  await assentar();
  out.k_previa_de_duas = previaDe(raiz, "l-k-ativo");

  // K5: ANTECIPAR TODAS AS EM ABERTO -- a previa diz que QUITA, e a terceira
  // frase SAI (promessa sobre conjunto vazio).
  digitar(seletorDeQuantas, "5");
  await assentar();
  out.k_previa_que_quita = previaDe(raiz, "l-k-ativo");

  // K6: O CASO A diz de onde o dinheiro sai e o que muda em Contas a Pagar.
  const raiz2 = await montarPainel("raiz-k2");
  clicar(raiz2.querySelector('[data-antecipar-emprestimo="l-k-auto"]'));
  await assentar();
  out.k_previa_do_auto = previaDe(raiz2, "l-k-auto");

  // K7: O CLIQUE MANDA UM POST, na rota da antecipacao, com \`parcelas: N\` --
  // e \`valor\` NAO existe no corpo (a decisao (a) da secao 4 do plano).
  const raiz3 = await montarPainel("raiz-k3");
  clicar(raiz3.querySelector('[data-antecipar-emprestimo="l-k-ativo"]'));
  await assentar();
  digitar(raiz3.querySelector('[data-antecipar-quantas="l-k-ativo"]'), "3");
  await assentar();

  CHAMADAS = [];
  clicar(raiz3.querySelector('[data-confirmar-antecipacao="l-k-ativo"]'));
  await assentar();
  out.k_post = CHAMADAS.filter((c) => c.metodo === "POST").map((c) => ({
    url: c.url,
    corpo: c.corpo,
  }));
  // O DIALOGO FECHA NO SUCESSO: deixado aberto, o proximo clique antecipa de
  // novo sobre uma serie que a tela acabou de recarregar.
  out.k_dialogo_depois = Boolean(
    raiz3.querySelector('[data-dialogo-antecipacao="l-k-ativo"]')
  );

  // K8: DOIS CLIQUES NO MESMO TICK -> UM POST, e o \`disabled\` ainda era \`false\`
  // no segundo.
  //
  // Dentro de \`unstable_batchedUpdates\` e lendo o \`disabled\` no instante do
  // segundo clique, como G1: fora dele o React legado descarrega entre os dois,
  // o botao ja estaria desabilitado e o que o caso mediria seria o \`disabled\` --
  // com o mutante que troca o \`useRef\` por \`useState\` SOBREVIVENDO
  // (\`latch-de-dois-cliques-so-mede-dentro-de-batchedupdates\`).
  const raiz4 = await montarPainel("raiz-k4");
  clicar(raiz4.querySelector('[data-antecipar-emprestimo="l-k-ativo"]'));
  await assentar();

  CHAMADAS = [];
  let desabilitadoNoSegundo = null;
  ReactDOM.unstable_batchedUpdates(function () {
    const botao = raiz4.querySelector(
      '[data-confirmar-antecipacao="l-k-ativo"]'
    );
    clicar(botao);
    desabilitadoNoSegundo = botao.disabled;
    clicar(botao);
  });
  await assentar();
  out.k_dois_cliques = {
    desabilitadoNoSegundo,
    posts: CHAMADAS.filter((c) => c.metodo === "POST").length,
  };

  // K9: CONTROLE DO K8 -- a SEGUNDA divida passa COM A PRIMEIRA EM VOO.
  //
  // E PRECISO PENDURAR O PRIMEIRO POST, e nao so antecipar duas em sequencia:
  // com a primeira ja respondida o \`Set\` esta vazio, e um booleano global daria
  // o MESMO resultado -- o caso nao mediria nada (medido: aquele mutante
  // sobreviveu ate este POST passar a pendurar).
  //
  // E o estado e ALCANCAVEL pela tela, nao fabricado: o dialogo fecha so na
  // resposta, e o botao «Antecipar» das OUTRAS linhas continua clicavel durante
  // o POST. Abrir o dialogo da segunda divida fecha o da primeira e deixa as
  // duas na mesma janela -- com um booleano global, a segunda cairia calada.
  const raiz5 = await montarPainel("raiz-k5");
  CHAMADAS = [];
  POST_DE_ANTECIPACAO_PENDURA = "l-k-ativo";

  clicar(raiz5.querySelector('[data-antecipar-emprestimo="l-k-ativo"]'));
  await assentar();
  clicar(raiz5.querySelector('[data-confirmar-antecipacao="l-k-ativo"]'));
  await assentar();

  // A PRIMEIRA CONTINUA EM VOO AQUI -- o \`fetch\` dela nunca resolve, entao o
  // \`finally\` de \`antecipar\` nao rodou e o id dela segue no conjunto.
  clicar(raiz5.querySelector('[data-antecipar-emprestimo="l-k-auto"]'));
  await assentar();
  clicar(raiz5.querySelector('[data-confirmar-antecipacao="l-k-auto"]'));
  await assentar();

  POST_DE_ANTECIPACAO_PENDURA = null;

  out.k_duas_dividas = CHAMADAS.filter((c) => c.metodo === "POST").map(
    (c) => c.url
  );

  // K10: A ANTECIPACAO QUE FALHOU TEM SEGUNDA TENTATIVA (o \`delete\` do
  // \`finally\`). Sem ele o emprestimo fica em voo para sempre e o botao volta
  // habilitado sem chamar rota nenhuma -- um clique que nao faz nada e nao diz
  // nada.
  const raiz6 = await montarPainel("raiz-k6");
  clicar(raiz6.querySelector('[data-antecipar-emprestimo="l-k-ativo"]'));
  await assentar();

  CHAMADAS = [];
  POST_DE_ANTECIPACAO_FALHA = true;
  clicar(raiz6.querySelector('[data-confirmar-antecipacao="l-k-ativo"]'));
  await assentar();
  const primeiraAntecipacao = CHAMADAS.filter((c) => c.metodo === "POST").length;

  POST_DE_ANTECIPACAO_FALHA = false;
  clicar(raiz6.querySelector('[data-confirmar-antecipacao="l-k-ativo"]'));
  await assentar();

  out.k_retentativa = {
    primeira: primeiraAntecipacao,
    total: CHAMADAS.filter((c) => c.metodo === "POST").length,
  };
}

// =============================================================================
// L-SINGULAR (HMO-398) -- UM encerrado so, que e o fixture de PRODUCAO
// =============================================================================
// A conta de teste em producao tem UM emprestimo \`settled\` (\`75620507\`), e a
// primeira versao deste recorte publicou "Mostrar os 1 encerrado" por causa
// disso: o artigo nao concordava com o numero. Nenhum fixture da secao K pegava
// isso -- os dois tem DOIS encerrados, onde singular e plural dao o mesmo texto.
//
// O CONTROLE DO OUTRO LADO E A CONTA SEM NENHUM ENCERRADO, medido no
// \`a_tesouro\` da secao A: lá o botao nao existe (\`rotuloDoBotao === null\`).
{
  LOANS = [
    {
      id: "l-s-ativo",
      descricao: "Moto eletrica",
      conta_credora_id: ${JSON.stringify(CARTEIRA)},
      caso: "conexao",
      status: "active",
      principal: 200,
      total_de_parcelas: 2,
      primeiro_vencimento: "2026-11-10",
      quem_deve_pagar: "Lais",
      devedor_id: ${JSON.stringify(LAIS)},
      parcelas: [
        { id: "p-s1", valor: 100, numero: 1, total: 2, rotulo: "1 de 2", vencimento: "2026-11-10", status: "pending", a_confirmar: false, paid_date: null },
        { id: "p-s2", valor: 100, numero: 2, total: 2, rotulo: "2 de 2", vencimento: "2026-12-10", status: "pending", a_confirmar: false, paid_date: null },
      ],
    },
    {
      // O RETRATO DO \`75620507\` DE PRODUCAO: \`settled\`, 2 de 2 pagas.
      id: "l-s-quitado",
      descricao: "HMO394 depois (quitacao)",
      conta_credora_id: ${JSON.stringify(CARTEIRA)},
      caso: "conexao",
      status: "settled",
      principal: 100,
      total_de_parcelas: 2,
      primeiro_vencimento: "2026-05-10",
      quem_deve_pagar: "Lais",
      devedor_id: ${JSON.stringify(LAIS)},
      parcelas: [
        { id: "p-sq1", valor: 50, numero: 1, total: 2, rotulo: "1 de 2", vencimento: "2026-05-10", status: "paid", a_confirmar: false, paid_date: "2026-05-10" },
        { id: "p-sq2", valor: 50, numero: 2, total: 2, rotulo: "2 de 2", vencimento: "2026-06-10", status: "paid", a_confirmar: false, paid_date: "2026-06-10" },
      ],
    },
  ];

  const raiz = await montarPainel("raiz-l-singular");
  const botao = () => raiz.querySelector("[data-encerrados-do-mybank]");

  out.l_singular_fechada = {
    linhas: Array.from(raiz.querySelectorAll("[data-emprestimo]")).map((el) =>
      el.getAttribute("data-emprestimo")
    ),
    resumo: raiz.querySelector("[data-resumo-da-lista]").textContent,
    rotuloDoBotao: botao() ? botao().textContent : null,
  };

  clicar(botao());
  await assentar();
  out.l_singular_aberta = {
    linhas: Array.from(raiz.querySelectorAll("[data-emprestimo]")).map((el) =>
      el.getAttribute("data-emprestimo")
    ),
    rotuloDoBotao: botao() ? botao().textContent : null,
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

// =============================================================================
// G -- o segundo clique nao cria a segunda divida (HMO-390, F1 da HMO-383)
// =============================================================================

test("G1: dois cliques no MESMO tick -> UM unico POST", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // O CONTROLE DE VACUIDADE VEM PRIMEIRO, e ele e o que faz este caso medir a
  // trava de `useRef` em vez do `disabled={salvando}` que ja existia.
  //
  // Se o React tivesse descarregado o re-render entre os dois `dispatchEvent`,
  // o botao estaria `disabled` e o segundo clique nao chegaria ao handler --
  // zero POST a mais, assercao verde, e o mutante `useRef -> useState`
  // SOBREVIVENDO. Exigir `false` aqui prende a sonda no cenario que ela diz
  // medir: os dois cliques entraram em `emprestar()`.
  assert.equal(
    resultado.g1.desabilitadoNoSegundo,
    false,
    "o botao ja estava desabilitado no segundo clique: a sonda mediria o " +
      "`disabled`, nao o latch, e o mutante de `useState` sobreviveria"
  );

  // CONTROLE POSITIVO: o POST saiu. Com zero POST (formulario invalido, esboco
  // faltando) a assercao de "um" passaria pelo lado errado.
  assert.equal(
    resultado.g1.posts.length,
    1,
    `saiu(ram) ${resultado.g1.posts.length} POST(s) de emprestimo, esperado 1. ` +
      `erro na tela: ${JSON.stringify(resultado.g1.erro)}`
  );

  // E o corpo leva a chave do pedido -- sem ela o servidor nao tem como
  // recusar o reenvio depois de um F5.
  assert.match(
    String(resultado.g1.posts[0].corpo.id),
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "o POST saiu sem `id` de pedido: " +
      JSON.stringify(resultado.g1.posts[0].corpo)
  );
});

test("G2: o F5 reenvia o MESMO formulario com o MESMO id de pedido", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // Os dois POSTs sairam: sem isto, `null === null` passaria verde sobre uma
  // tela que nao mandou nada.
  assert.ok(
    resultado.g2.primeiroId,
    "o primeiro POST (o que falha na rede) nao saiu"
  );
  assert.ok(resultado.g2.segundoId, "o POST depois do F5 nao saiu");

  // O MESMO id. E isto que faz a PK da 053 recusar a segunda divida: a rota
  // responde 200 com o emprestimo que ja existe, em vez de criar o segundo.
  assert.equal(
    resultado.g2.segundoId,
    resultado.g2.primeiroId,
    "depois do F5 a tela mandou um id NOVO -- o reenvio criaria a segunda divida"
  );

  // E no SUCESSO o par e esquecido, senao o proximo emprestimo igual voltaria
  // 200 sem gravar nada.
  assert.equal(
    resultado.g2.guardadoDepoisDoSucesso,
    null,
    "o pedido ficou guardado depois do sucesso: o proximo emprestimo igual " +
      "reaproveitaria o id e voltaria 200 sem gravar"
  );
});

test("G3: controle -- formulario DIFERENTE recebe id DIFERENTE", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  assert.ok(resultado.g3.baseId, "o POST da base do controle nao saiu");
  assert.ok(resultado.g3.outroId, "o POST do formulario trocado nao saiu");

  // Sem este caso, um id CONSTANTE passaria G1 e G2 limpas -- e o segundo
  // emprestimo de verdade voltaria 200 com a divida do primeiro.
  assert.notEqual(
    resultado.g3.outroId,
    resultado.g3.baseId,
    "um formulario com outro valor reaproveitou o id do anterior: o segundo " +
      "emprestimo voltaria 200 com a divida do primeiro, sem gravar nada"
  );
});

test("H1: confirmar a MESMA parcela duas vezes manda UMA baixa", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // CONTROLE: as duas linhas `reported` renderizaram. Com zero linha os
  // cliques nao aconteceriam e "uma baixa" passaria medindo nada.
  assert.deepEqual(resultado.h_linhas, ["p-x", "p-y"]);

  assert.deepEqual(
    resultado.h_mesma,
    ["/api/mybank/installments/p-x"],
    "a mesma parcela foi baixada mais de uma vez: " +
      JSON.stringify(resultado.h_mesma)
  );
});

test("H2: controle -- parcelas DIFERENTES continuam baixaveis no mesmo tick", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // O QUE IMPEDE O CONSERTO DE VIRAR REGRESSAO. Com um booleano global no lugar
  // do `Set`, a segunda parcela cairia calada -- e H1 continuaria verde.
  assert.deepEqual(
    resultado.h_diferentes,
    ["/api/mybank/installments/p-x", "/api/mybank/installments/p-y"],
    "duas parcelas diferentes nao foram as duas confirmadas (a trava virou " +
      "booleano global?): " + JSON.stringify(resultado.h_diferentes)
  );
});

test("H3: a baixa que FALHOU tem segunda tentativa (a parcela sai do conjunto)", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // CONTROLE: a primeira tentativa saiu de verdade. Com zero PATCH aqui, "duas
  // no total" nunca seria alcancado e o caso mediria outra coisa.
  assert.equal(
    resultado.h_retentativa.primeira,
    1,
    "a primeira tentativa (a que falha na rede) nao saiu"
  );

  // A SEGUNDA TENTATIVA SAIU. Sem o `delete` do `finally` a parcela fica em voo
  // para sempre: o botao continua clicavel (ele nao tem `disabled`) e nunca
  // mais chama a rota.
  assert.equal(
    resultado.h_retentativa.total,
    2,
    "a parcela nao saiu do conjunto depois da falha: a baixa ficou sem " +
      "segunda tentativa e o botao virou um clique que nao faz nada"
  );
});

test("G4: depois do 409 o reenvio sai com um id NOVO (o `tente de novo` funciona)", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // A frase da rota chegou a tela: sem ela o caso mediria um ramo que a pessoa
  // nao ve.
  assert.match(String(resultado.g4.erro), /Tente de novo/i);

  // CONTROLE POSITIVO: os dois POSTs sairam.
  assert.ok(resultado.g4.idRecusado, "o POST recusado com 409 nao saiu");
  assert.ok(resultado.g4.idDaRetentativa, "a retentativa nao mandou POST");

  // O id TROCOU. Com o par guardado intacto, o reenvio repetiria o id,
  // colidiria com a MESMA linha alheia e voltaria 409 para sempre -- "tente de
  // novo" num botao que nunca mais funciona.
  assert.notEqual(
    resultado.g4.idDaRetentativa,
    resultado.g4.idRecusado,
    "depois do 409 a tela reenviou o MESMO id: a pessoa fica presa no 409"
  );
});

test("G4b: controle -- num erro que NAO e 409 o pedido FICA guardado", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  assert.ok(resultado.g4b.idDaQueda, "o POST que cai na rede nao saiu");
  assert.ok(resultado.g4b.idDepois, "o reenvio depois da queda nao saiu");

  // O MESMO id. Este e o caso que a issue existe para consertar, e ele e o
  // oposto de G4: aqui a dívida PODE ter sido gravada, e repetir o id e o que
  // faz a rota responder 200 com ela em vez de criar a segunda.
  //
  // Sem este caso, um `removeItem` posto no caminho de erro INTEIRO passaria G4
  // e desfaria G2 em silencio.
  assert.equal(
    resultado.g4b.idDepois,
    resultado.g4b.idDaQueda,
    "a queda de rede esqueceu o pedido: o reenvio criaria a SEGUNDA divida"
  );
});

// ---------------------------------------------------------------------------
// I -- o botao «Cancelar» (HMO-391)
// ---------------------------------------------------------------------------

test("I1: o botao Cancelar existe SO nos emprestimos `active`", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // O RECORTE DA HMO-398 ESCONDE OS DOIS ENCERRADOS ao abrir o painel, e esta
  // secao SO pode medir "o encerrado nao tem botao" com a linha dele na tela --
  // dai ela clicar no botao dos encerrados antes de ler. As duas fotos vao
  // juntas: a fechada prova que o recorte aconteceu, a aberta prova que a
  // ausencia do botao e uma CONDICAO e nao um markup sem botao.
  assert.deepEqual(
    resultado.i_fechadas.sort(),
    ["l-ativo", "l-auto-ativo"],
    JSON.stringify(resultado.i_fechadas)
  );

  // CONTROLE POSITIVO: as quatro linhas estao na tela. Sem ele, uma lista vazia
  // faria "nenhum botao no quitado" passar verde sobre uma tela sem linha
  // nenhuma -- a assercao de ausencia mais facil de mentir que existe.
  assert.deepEqual(
    resultado.i_linhas.sort(),
    ["l-ativo", "l-auto-ativo", "l-ja-cancelado", "l-ja-quitado"],
    JSON.stringify(resultado.i_linhas)
  );

  // E O BOTAO esta nos DOIS ativos e em nenhum dos dois encerrados: a rota
  // recusa `settled` e `cancelled` com frase propria, e oferecer o clique ali
  // seria oferecer uma operacao cujo unico resultado possivel e um erro.
  assert.deepEqual(
    resultado.i_com_botao.sort(),
    ["l-ativo", "l-auto-ativo"],
    JSON.stringify(resultado.i_com_botao)
  );
});

test("I2: a pergunta RECUSADA nao manda PATCH nenhum", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // A pergunta ACONTECEU -- sem esta assercao, um botao que nao faz nada
  // passaria o `patches === 0` de baixo.
  assert.equal(resultado.i_recusada.perguntas.length, 1);

  // E o texto diz as tres coisas: o que e, o que acontece, e o que NAO
  // acontece. A ultima e a que importa: quem cancela achando que esta quitando
  // ve a divida desaparecer e conclui que pagou.
  const pergunta = resultado.i_recusada.perguntas[0];
  assert.match(pergunta, /Moto eletrica|Moto elétrica/);
  assert.match(pergunta, /NÃO registra pagamento/);
  assert.match(pergunta, /NÃO amortiza/);
  assert.match(pergunta, /já pagas continuam pagas/i);
  // No Caso B a tela que muda e DE OUTRA PESSOA, e a pergunta a nomeia.
  assert.match(pergunta, /tela de Lais|tela de Laís/);

  // Uma acao destrutiva cujo "cancelar" nao cancela e pior que nao ter a
  // pergunta, porque a pessoa confia nela.
  assert.equal(resultado.i_recusada.patches, 0);
});

test("I3: a pergunta ACEITA manda UM PATCH, com `status: cancelled` no corpo", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  assert.equal(resultado.i_aceita.length, 1, JSON.stringify(resultado.i_aceita));

  const [patch] = resultado.i_aceita;
  assert.equal(patch.url, "/api/mybank/loans/l-ativo");
  // O corpo INTEIRO: a rota recusa qualquer outro `status`, e um corpo com
  // campos a mais seria um PATCH que tenta editar a divida.
  assert.deepEqual(patch.corpo, { status: "cancelled" });
});

test("I4: no CASO A a pergunta fala de Contas a Pagar, e nao de outra pessoa", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  const pergunta = resultado.i_texto_do_auto;
  assert.ok(pergunta, "a pergunta do auto-emprestimo nao aconteceu");
  assert.match(pergunta, /Contas a Pagar/i);
  // Dizer "a divida sai da tela de Voce mesmo" seria o texto do Caso B vazando
  // para o caso em que nao ha segunda pessoa nenhuma.
  assert.doesNotMatch(pergunta, /tela de/i);
  assert.match(pergunta, /NÃO registra pagamento/);
});

test("I5: dois toques no MESMO emprestimo dao UMA pergunta e UM PATCH", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // A trava e lida ANTES do `confirm()`: um segundo clique no mesmo tick nao
  // abre uma segunda pergunta sobre uma divida que esta sendo encerrada.
  assert.equal(resultado.i_dois_toques.perguntas, 1);
  assert.equal(resultado.i_dois_toques.patches, 1);
});

test("I6: controle -- cancelar DUAS dividas diferentes no mesmo tick passa as duas", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // O par de I5: um booleano global no lugar do `Set` passaria I5 e perderia a
  // segunda divida, calada. E duas dividas erradas em sequencia e exatamente o
  // caso que abriu a HMO-383.
  assert.deepEqual(
    resultado.i_duas_dividas.sort(),
    ["/api/mybank/loans/l-ativo", "/api/mybank/loans/l-auto-ativo"],
    JSON.stringify(resultado.i_duas_dividas)
  );
});

test("I7: o cancelamento que FALHOU tem segunda tentativa", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // CONTROLE POSITIVO: o primeiro PATCH saiu (e caiu na rede).
  assert.equal(resultado.i_retentativa.primeira, 1);

  // E a segunda tentativa TAMBEM sai. Sem o `delete` do `finally` o emprestimo
  // fica em voo para sempre, e o botao -- que nao tem `disabled` -- continua
  // clicavel sem chamar rota nenhuma e sem dizer nada.
  assert.equal(resultado.i_retentativa.total, 2);
});

// ---------------------------------------------------------------------------
// J -- a linha da agenda em Contas a Pagar (HMO-386)
// ---------------------------------------------------------------------------
// A parcela aparecia em DUAS linhas da mesma tela. O bloco saiu de
// `/dashboard/bills` (ele e de `/dashboard/mybank`) e a linha da agenda ganhou
// o gesto. Estas cinco medidas sao a segunda metade: sem elas o PR seria
// "apagar o bloco", e o devedor perderia o unico botao que tinha.
//
// A CONTAGEM DE 2 PARA 1 NA PAGINA nao se mede aqui -- ela e composicao de
// tela, e a sonda dela e `scripts/probe-linha-dobrada-do-mybank.mjs`, em
// producao, com «Total a pagar» de controle negativo.

test("J1: a linha carrega o id da parcela, o selo e o rotulo n de m", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  const linha = resultado.j_pendente;
  // O ID NO DOM e a ancora da contagem da sonda de producao: a descricao nao
  // serve, porque ela e do EMPRESTIMO e as parcelas dele a repetem.
  assert.equal(linha.linha, PARCELA_NA_AGENDA);
  assert.equal(linha.selo, "MyBank");
  // O ENDERECO DA DIVIDA INTEIRA. O nome de quem emprestou sai de `profiles` e
  // nao vem nesta leitura (ela alimenta quatro rotas de dinheiro); o caminho
  // para ele e este link.
  assert.equal(linha.href, "/dashboard/mybank");
  assert.match(linha.rotulo, /parcela 2 de 24/);
  // O VALOR vem da tela JA FORMATADO: a linha nao reimplementa `moeda()`, senao
  // duas linhas vizinhas da mesma lista poderiam formatar diferente.
  assert.match(linha.texto, /R\$ 1\.000,00/);
});

test("J2: a linha NAO oferece nenhuma das quatro acoes da agenda", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // UM botao, e e o de avisar. A linha da agenda tem quatro (baixa, alterar,
  // pular, comprovante) e as quatro montariam a URL com `id: null` -- a baixa
  // hoje sai pelo `if (conta.id === null) return` da tela, ou seja um botao de
  // pagar que nao faz nada.
  assert.equal(resultado.j_pendente.botoes, 1);
  assert.equal(resultado.j_pendente.avisar, PARCELA_NA_AGENDA);

  // E ela nao busca nada no mount: a agenda ja veio na leitura da tela.
  assert.deepEqual(resultado.j_leituras_no_mount, []);
});

test("J3: avisar que paguei manda `reported` na rota do MyBank, e recarrega", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  assert.equal(
    resultado.j_aviso.patches.length,
    1,
    JSON.stringify(resultado.j_aviso)
  );
  const [patch] = resultado.j_aviso.patches;
  // A ROTA DO MYBANK com o id de `mybank_installment_id`, e NAO
  // `/api/scheduled-transactions/<id>/pay`: esta linha nao esta naquela tabela,
  // e o `id` dela e `null`.
  assert.equal(patch.url, `/api/mybank/installments/${PARCELA_NA_AGENDA}`);
  // `reported`, e NUNCA `paid`: quem leva a parcela a paga e quem recebe o
  // dinheiro. A rota recusa `paid` do devedor com 403.
  assert.equal(patch.corpo.status, "reported");
  assert.notEqual(patch.corpo.status, "paid");
  // A agenda da tela e recarregada: o rotulo desta linha depende do
  // `mybank_status`, que acabou de mudar no servidor.
  assert.equal(resultado.j_aviso.recarregou, 1);
});

test("J4: quem JA avisou le o estado, e o estado sai de `mybank_status`", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  const linha = resultado.j_avisada;

  // ESTE E O CASO QUE SEPARA OS DOIS CAMPOS. O fixture tem `status: 'pending'`
  // (o campo de DINHEIRO, que e `pending` tambem quando a parcela esta avisada,
  // senao o «A vencer» desceria no clique do devedor) e
  // `mybank_status: 'reported'`. Um componente que lesse `status` ofereceria o
  // botao aqui -- e o segundo PATCH responde 200 sem mudar nada, entao o
  // sintoma seria um botao que parece funcionar e nao faz diferenca nenhuma.
  assert.equal(linha.avisar, null, JSON.stringify(linha));
  assert.equal(linha.botoes, 0);
  assert.equal(linha.avisado, PARCELA_NA_AGENDA_AVISADA);
  // O botao VIRA ESTADO e nao desaparece: a frase diz o que falta, e de quem.
  assert.match(linha.texto, /Avisei que paguei/);
  assert.match(linha.texto, /falta quem emprestou confirmar/);
});

test("J5: sem rede o gesto fica desabilitado", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // O mesmo `online` das outras linhas desta tela. Sem ele o toque offline vai
  // para o `catch` e o toast diz "nao foi possivel" depois do gesto, em vez de
  // o botao dizer antes.
  assert.equal(resultado.j_offline.avisar, PARCELA_NA_AGENDA);
  assert.equal(resultado.j_offline.avisarDesabilitado, true);
});

// =============================================================================
// K -- o gesto «Antecipar» (HMO-397, F4 da HMO-393)
// =============================================================================

test("K1: «Antecipar» exige `active` E parcela em aberto -- e o Cancelar nao", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // AS SEIS LINHAS ESTAO NA TELA. A lista vem junto para a assercao poder
  // separar "o botao nao esta ali" de "a linha nao esta ali".
  assert.deepEqual(
    resultado.k_linhas.sort(),
    [
      "l-k-antecipada",
      "l-k-ativo",
      "l-k-auto",
      "l-k-cancelado",
      "l-k-pago",
      "l-k-quitado",
    ],
    JSON.stringify(resultado.k_linhas)
  );

  // ANTECIPAR: os tres `active` COM parcela em aberto, e so eles. Os dois que
  // ficam FORA cobrem uma metade da condicao cada:
  //
  //   * `l-k-pago` e `active` SEM nada em aberto -- a rota so poderia responder
  //     `mais_do_que_em_aberto`;
  //   * `l-k-cancelado` TEM parcela em aberto e NAO e `active` -- a rota recusa
  //     com `emprestimo_nao_esta_ativo`.
  //
  // Sem o segundo, um `podeAntecipar` que esquecesse o status daria esta mesma
  // lista (medido: o mutante sobreviveu).
  assert.deepEqual(
    resultado.k_com_antecipar.sort(),
    ["l-k-antecipada", "l-k-ativo", "l-k-auto"],
    JSON.stringify(resultado.k_com_antecipar)
  );

  // CANCELAR: os QUATRO `active`, inclusive o que nao tem nada em aberto --
  // encerrar aquele emprestimo ainda faz sentido, e e o caso que abriu a
  // HMO-383. ESTA e a assercao que prova que as duas condicoes sao DIFERENTES:
  // uma condicao copiada daria as duas listas iguais.
  assert.deepEqual(
    resultado.k_com_cancelar.sort(),
    ["l-k-antecipada", "l-k-ativo", "l-k-auto", "l-k-pago"],
    JSON.stringify(resultado.k_com_cancelar)
  );
  assert.notDeepEqual(
    resultado.k_com_antecipar.sort(),
    resultado.k_com_cancelar.sort(),
    "as duas listas ficaram iguais: a condicao do Antecipar foi copiada do Cancelar"
  );
});

test("K2: a parcela antecipada se distingue, e e ela que explica o `2/4`", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  const porId = {};
  for (const linha of resultado.k_antecipada) porId[linha.id] = linha;

  // A SERIE COM A 4 ANTECIPADA: `2/4` com a 2 e a 3 pendentes. O progresso esta
  // CERTO (secao 0 do plano, oito leituras medidas) -- o que faltava era a tela
  // dizer POR QUE duas estao pagas se a terceira ainda vence.
  assert.equal(porId["l-k-antecipada"].progresso, "2/4");
  assert.equal(porId["l-k-antecipada"].antecipadas, "1 antecipada (4)");

  // CONTROLE: a parcela paga EM DIA (`paid_date` = `vencimento`) nao e
  // antecipada. Com `<=` no criterio, as duas linhas abaixo teriam rotulo -- e
  // ele perderia o sentido justamente onde serve.
  assert.equal(porId["l-k-ativo"].progresso, "1/6");
  assert.equal(
    porId["l-k-ativo"].antecipadas,
    null,
    "a parcela paga EM DIA apareceu como antecipada: o criterio virou `<=`?"
  );
  assert.equal(porId["l-k-pago"].antecipadas, null);
});

test("K3: o dialogo mostra o valor e o novo ultimo vencimento ANTES do clique", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  const abertura = resultado.k_abertura;

  assert.ok(abertura.temDialogo, "o dialogo nao abriu");
  // UM dialogo, e nao um por emprestimo: a quantidade e um estado so, e duas
  // previas na tela leriam o valor de um com a quantidade do outro.
  assert.equal(abertura.quantosDialogos, 1);

  // ZERO CHAMADA: a previa sai da serie que a tela ja tem. Uma previa que
  // consultasse a rota para montar o numero seria outra feature -- e um gesto
  // que escreve antes de a pessoa confirmar seria a pior versao desta.
  assert.deepEqual(
    abertura.chamadas,
    [],
    "abrir o dialogo chamou a rede: " + JSON.stringify(abertura.chamadas)
  );

  // AS OPCOES SAO 1..5 (as em aberto), e NUNCA 6 (a serie inteira): a recusa de
  // `mais_do_que_em_aberto` esta na FORMA do campo.
  assert.deepEqual(abertura.opcoes, ["1", "2", "3", "4", "5"]);

  const previa = abertura.previa;
  assert.ok(previa, "a previa nao apareceu");

  // (1) O VALOR TOTAL, com o NBSP do `formatCurrency` de producao.
  assert.match(previa, /R\$\s?100,00/);
  // (2) QUAL PASSA A SER O ULTIMO VENCIMENTO: era 03/2027, passa a 02/2027.
  assert.match(previa, /03\/2027/);
  assert.match(previa, /02\/2027/);
  // (3) QUE O VALOR DAS QUE SOBRAM NAO MUDA -- a frase que impede "baixaram
  // minha parcela?", que e a variante de produto REJEITADA no cartao
  // `ae436b4a`. Sem ela a tela fica plausivel e a leitura errada e a natural.
  assert.match(previa, /continuam com o valor de sempre/);
  assert.match(previa, /não baixa a prestação/);
  // E a parcela nomeada e a DO FIM (a 6), nao a proxima a vencer (a 2).
  assert.match(previa, /\b6\b/);
});

test("K4: trocar a quantidade refaz a previa -- 2 custam o dobro e tiram 2 meses", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  const previa = resultado.k_previa_de_duas;
  assert.ok(previa, "a previa de 2 parcelas nao apareceu");

  // O DOBRO, e os DOIS numeros da cauda (5 e 6) -- na ordem da SERIE, e nao na
  // ordem em que `parcelasDaAntecipacao` as escolheu (6 e 5).
  assert.match(previa, /R\$\s?200,00/);
  assert.match(previa, /5 e 6/);
  // O ultimo vencimento anda DOIS meses: 03/2027 -> 01/2027.
  assert.match(previa, /01\/2027/);
  // E a terceira frase continua: sobram tres parcelas, e elas mantem o valor.
  assert.match(previa, /continuam com o valor de sempre/);
});

test("K5: antecipar TODAS as em aberto diz que quita, e a terceira frase SAI", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  const previa = resultado.k_previa_que_quita;
  assert.ok(previa, "a previa de 5 parcelas nao apareceu");

  assert.match(previa, /R\$\s?500,00/);
  assert.match(previa, /fica quitado/);
  assert.match(previa, /sai da lista A receber/);

  // A TERCEIRA FRASE SAI, e isso nao e economia de texto: "as que sobram mantem
  // o valor" sobre ZERO parcelas e uma promessa de cobranca futura que nao vai
  // existir. A mesma regra de `mensagemDaAntecipacao`.
  assert.ok(
    !/continuam com o valor de sempre/.test(previa),
    "a frase sobre as que sobram apareceu numa antecipacao que QUITA: " + previa
  );
});

test("K6: no CASO A a previa diz de onde o dinheiro sai, e o que muda em Contas a Pagar", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  const previa = resultado.k_previa_do_auto;
  assert.ok(previa, "a previa do auto-emprestimo nao apareceu");

  // No auto-emprestimo e a conta corrente da PROPRIA pessoa que e debitada, e a
  // antecipacao muda uma tela que nao esta na frente de quem clica: as contas a
  // pagar daquelas parcelas sao BAIXADAS (HMO-396), nao removidas. Quem aperta
  // sem ler isso descobre o debito pelo extrato.
  assert.match(previa, /conta corrente/);
  assert.match(previa, /Contas a Pagar/);
  assert.match(previa, /não removida/);
});

test("K7: confirmar manda UM POST na rota da antecipacao, com `parcelas` e sem `valor`", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  assert.equal(resultado.k_post.length, 1, JSON.stringify(resultado.k_post));
  const [post] = resultado.k_post;

  // A ROTA IRMA, e nao o `PATCH` de `loans/[id]`: aquele `if` recusa todo corpo
  // que nao seja `{status:"cancelled"}`, e abri-lo para um segundo verbo e
  // desmontar uma defesa medida (cabecalho da rota da F2).
  assert.equal(post.url, "/api/mybank/loans/l-k-ativo/antecipacao");
  assert.equal(post.corpo.parcelas, 3);
  // `valor` NAO EXISTE no contrato -- decisao (a) da secao 4 do plano. A recusa
  // de "R$ 150 contra parcelas de R$ 200" esta na FORMA do corpo.
  assert.equal(
    post.corpo.valor,
    undefined,
    "a tela mandou um valor em reais: " + JSON.stringify(post.corpo)
  );
  // E o dialogo FECHA no sucesso: aberto, o proximo clique antecipa de novo
  // sobre uma serie que a tela acabou de recarregar.
  assert.equal(resultado.k_dialogo_depois, false);
});

test("K8: dois cliques no MESMO tick dao UM POST (e o `disabled` nao foi quem segurou)", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // A PRE-CONDICAO DO CASO: o botao ainda estava HABILITADO no segundo clique.
  // Sem ela o que estaria medido e o `disabled`, e o mutante que troca o
  // `useRef` por `useState` sobreviveria -- a trava do estado so chega ao DOM
  // depois do re-render, e o toque duplo de celular acontece antes dele.
  assert.equal(
    resultado.k_dois_cliques.desabilitadoNoSegundo,
    false,
    "o botao ja estava desabilitado no 2o clique: o caso mediria o `disabled`, nao o latch"
  );

  // UM POST. Dois pagariam a cauda DUAS vezes: a rota de antecipacao nao tem
  // idempotencia por id, entao sairiam duas pernas de entrada por parcela, o
  // dobro no extrato, e as parcelas seguintes da serie pagas sem pedido.
  assert.equal(
    resultado.k_dois_cliques.posts,
    1,
    `sairam ${resultado.k_dois_cliques.posts} POST(s) de antecipacao, esperado 1`
  );
});

test("K9: controle -- a segunda divida passa COM A PRIMEIRA EM VOO", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // Sem este caso, um booleano global no lugar do `Set` passaria K8 e seria uma
  // regressao calada: o dialogo fecha so na resposta, e o botao «Antecipar» das
  // outras linhas continua clicavel durante o POST -- com um booleano, a segunda
  // antecipacao (legitima, em outra divida) nao sairia e nada diria por que.
  //
  // O POST da primeira fica PENDURADO de proposito: com ela ja respondida as
  // duas formas dariam o mesmo resultado e o controle seria vacuo.
  assert.deepEqual(
    resultado.k_duas_dividas.sort(),
    [
      "/api/mybank/loans/l-k-ativo/antecipacao",
      "/api/mybank/loans/l-k-auto/antecipacao",
    ],
    JSON.stringify(resultado.k_duas_dividas)
  );
});

test("K10: a antecipacao que FALHOU tem segunda tentativa", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // A primeira SAIU (e caiu na rede).
  assert.equal(resultado.k_retentativa.primeira, 1);
  // E a segunda tambem: sem o `delete` do `finally` o emprestimo ficaria em voo
  // para sempre, com o botao preso em "Antecipando…" sem chamar rota nenhuma.
  assert.equal(
    resultado.k_retentativa.total,
    2,
    "a segunda tentativa nao saiu: o emprestimo ficou em voo (falta o `delete` do `finally`?)"
  );
});

// ---------------------------------------------------------------------------
// L (HMO-398) -- O RECORTE DA LISTA: o emprestimo encerrado sai de cima
// ---------------------------------------------------------------------------
// A HMO-394 fez o ciclo de pagamento escrever `status = 'settled'`, afirmando
// que "nenhuma leitura muda de codigo". Tres leituras filtravam `active` e a
// quarta -- a LISTA "Emprestimos desta conta" -- nao filtrava nada: medido em
// producao, um emprestimo de 2 x R$ 50 integralmente pago continuava listado
// enquanto o "a receber" daquela conta nao o contava mais.
//
// O RECORTE E UMA SEPARACAO, NAO UM FILTRO. Filtrar `active` como as outras tres
// apagaria a unica coisa que a HMO-394 existe para mostrar -- quem acaba de
// pagar a ultima parcela veria a linha SUMIR, e `mybank_loans_delete` recusa
// emprestimo com parcela `paid` de proposito: nao ha outra tela onde procurar.

const EM_ANDAMENTO_DO_K = [
  "l-k-antecipada",
  "l-k-ativo",
  "l-k-auto",
  "l-k-pago",
];
const ENCERRADOS_DO_K = ["l-k-cancelado", "l-k-quitado"];

test("L1: o painel abre com os encerrados FORA da lista, e o resumo conta os dois", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  assert.deepEqual(
    resultado.l_fechada.linhas.sort(),
    EM_ANDAMENTO_DO_K,
    JSON.stringify(resultado.l_fechada.linhas)
  );
  assert.deepEqual(resultado.l_fechada.encerradas, []);

  // O RESUMO CONTA OS DOIS GRUPOS mesmo com a secao fechada. Sem ele a unica
  // leitura disponivel para quem acabou de quitar seria "a linha desapareceu",
  // e o card ficaria com a aparencia de mostrar tudo o que tem -- a familia
  // `sumido-da-tela-pode-ser-so-indistinguivel`.
  assert.equal(resultado.l_fechada.resumo, "4 em andamento · 2 encerrados");

  // E O ROTULO DO BOTAO DIZ QUANTOS, nao "Ver mais": e o numero que separa o
  // colapso de "o resto nao existe".
  assert.equal(resultado.l_fechada.rotuloDoBotao, "Mostrar os 2 encerrados");
});

test("L2: controle negativo -- `active` com a serie TODA paga fica EM ANDAMENTO", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // OS DOIS LADOS, e eles tem a MESMA forma de parcelas: `l-k-pago` e 2/2 e
  // `l-k-quitado` e 1/1 -- nenhum dos dois tem nada em aberto. O que os separa
  // e SO o status, e e isso que esta assercao prende.
  const progresso = new Map(
    resultado.k_antecipada.map((l) => [l.id, l.progresso])
  );
  assert.equal(progresso.get("l-k-pago"), "2/2");
  assert.equal(progresso.get("l-k-quitado"), "1/1");

  // O LEGADO FICA: ele e o emprestimo que quitou ANTES da HMO-394 (que nao tem
  // migration de backfill), e e da secao em andamento que vem a saida dele --
  // o botao Cancelar, que K1 mede ao lado. Um recorte que lesse "nao tem
  // parcela em aberto" o esconderia e o deixaria sem caminho nenhum.
  assert.ok(
    resultado.l_fechada.linhas.includes("l-k-pago"),
    "o emprestimo `active` com tudo pago foi escondido: o recorte leu as parcelas, nao o status"
  );
  assert.ok(
    !resultado.l_fechada.linhas.includes("l-k-quitado"),
    "o `settled` continuou na lista: o recorte nao aconteceu"
  );
});

test("L3: o botao revela os dois encerrados, e cada um vem MARCADO", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  assert.deepEqual(
    resultado.l_aberta.linhas.sort(),
    [...EM_ANDAMENTO_DO_K, ...ENCERRADOS_DO_K].sort(),
    JSON.stringify(resultado.l_aberta.linhas)
  );

  // A MARCA E O ATRIBUTO e nao a posicao: aberta, os encerrados vem depois dos
  // em andamento, e uma assercao por indice continuaria passando com os dois
  // grupos embaralhados.
  assert.deepEqual(resultado.l_aberta.encerradas.sort(), ENCERRADOS_DO_K);

  assert.equal(resultado.l_aberta.rotuloDoBotao, "Esconder os encerrados");
  // O RESUMO NAO MUDA com a abertura: ele conta o que a conta TEM, e nao o que
  // a tela mostra agora.
  assert.equal(resultado.l_aberta.resumo, resultado.l_fechada.resumo);
});

test("L4: o status sai em portugues, e distingue o quitado do cancelado", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  const texto = new Map(resultado.l_aberta.status.map((s) => [s.id, s.texto]));
  assert.equal(texto.get("l-k-ativo"), "em andamento");
  assert.equal(texto.get("l-k-pago"), "em andamento");
  // OS DOIS ENCERRADOS NAO SAO A MESMA COISA, e e dentro desta secao que a
  // diferenca importa: um foi honrado, o outro foi desfeito.
  assert.equal(texto.get("l-k-quitado"), "quitado");
  assert.equal(texto.get("l-k-cancelado"), "cancelado");

  // E NENHUM VALOR CRU DO CHECK DA 053 SOBROU na tela em portugues.
  for (const { id, texto: t } of resultado.l_aberta.status) {
    assert.ok(
      !["active", "settled", "cancelled"].includes(t),
      `${id} imprimiu o status cru do banco: ${t}`
    );
  }
});

test("L5: fechar devolve a lista curta, e o colapso encurta o card EM PIXELS", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // O BOTAO VOLTA. Um colapso que so abre deixa a pessoa sem caminho de volta,
  // e a lista comprida e exatamente o que esta issue veio encurtar.
  assert.deepEqual(
    resultado.l_fechada_de_novo.linhas.sort(),
    EM_ANDAMENTO_DO_K,
    JSON.stringify(resultado.l_fechada_de_novo.linhas)
  );

  // E ENCURTA DE VERDADE: sem esta medida, "a linha saiu do DOM" poderia
  // conviver com um card do mesmo tamanho. A forma de E4, para o bloco do
  // devedor.
  assert.ok(
    resultado.l_altura_aberta > resultado.l_altura_fechada + 40,
    `o card nao encurtou: ${resultado.l_altura_fechada} fechado vs ${resultado.l_altura_aberta} aberto`
  );
});

test("L6: UM encerrado so -- o artigo concorda com o numero (o fixture de producao)", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // A conta de teste em PRODUCAO tem exatamente este retrato: um `active` e um
  // `settled`. A primeira versao deste recorte publicou "Mostrar os 1
  // encerrado", e nenhum fixture da secao K pegava isso -- os dois tem DOIS
  // encerrados, onde singular e plural dao o mesmo texto.
  assert.deepEqual(resultado.l_singular_fechada.linhas, ["l-s-ativo"]);
  assert.equal(
    resultado.l_singular_fechada.resumo,
    "1 em andamento · 1 encerrado"
  );
  assert.equal(
    resultado.l_singular_fechada.rotuloDoBotao,
    "Mostrar o 1 encerrado"
  );

  // E O ROTULO DE FECHAR CONCORDA TAMBEM: "Esconder os encerrados" com um
  // encerrado so e o mesmo erro, no outro estado do botao.
  assert.deepEqual(resultado.l_singular_aberta.linhas.sort(), [
    "l-s-ativo",
    "l-s-quitado",
  ]);
  assert.equal(
    resultado.l_singular_aberta.rotuloDoBotao,
    "Esconder o encerrado"
  );
});

test("L7: controle do outro lado -- conta SEM encerrado nao tem botao nenhum", () => {
  if (erroDeExecucao) throw erroDeExecucao;

  // A conta Tesouro tem um emprestimo `active` e nada mais. Sem este caso, um
  // botao que aparecesse sempre (dizendo "Mostrar os 0 encerrados") passaria
  // todas as assercoes de L1 a L6.
  assert.deepEqual(resultado.a_tesouro.emprestimos, ["l-outra-conta"]);
  assert.equal(resultado.a_tesouro.resumo, "1 em andamento · 0 encerrados");
  assert.equal(
    resultado.a_tesouro.temBotaoDeEncerrados,
    false,
    "a conta sem divida encerrada ganhou botao de colapso"
  );
});
