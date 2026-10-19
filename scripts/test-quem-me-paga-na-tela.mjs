#!/usr/bin/env node
// =====================================================
// PULODOGATO - "quem te paga" NA TELA (HMO-422)
// =====================================================
// A issue, olhando a aba Receitas:
//
//   > Previsto / R$ 508,42 / inclui R$ 508,42 de reembolso previsto de 2 pessoas
//   > em 1 grupo -- ainda nao recebido
//   > Previsto no periodo (0) / Nenhum lancamento previsto neste periodo.
//   >
//   > os 508,42 nao deveria estar aparecendo?
//
// O numero estava certo e a tela estava MUDA: QUEM sao as duas pessoas e QUAL e
// o grupo nao apareciam em lugar nenhum daquela aba. `PainelQuemMePaga` e o
// espelho de `PainelPraQuemPagar` (que a aba Despesas tem desde a HMO-365), e a
// medicao exigida e de TELA e nao assercao textual sobre o fonte: esta sonda
// roda o componente de PRODUCAO num Chromium e LE O DOM.
//
// AS QUATRO COISAS QUE SO O DOM DENUNCIA
// --------------------------------------
//   1. O ROTULO SEM A PESSOA. `devedor` e `null` quando o perfil nao e legivel,
//      e esse caminho e NORMAL (nenhuma policy de SELECT de `profiles` olha
//      `group_members`). Um `{linha.devedor}` solto renderiza NADA -- e uma
//      linha "R$ 53,30 · Casa" sem mencao a outra pessoa nao se le como "nao sei
//      o nome": se le como receita propria, e PIOR, como receita ja recebida.
//      "Nao aparece" e propriedade da marcacao; nenhum teste de funcao pura
//      alcanca.
//   2. A MARCA QUE MENTE. `full_name` de espacos em branco e VERDADEIRO em
//      JavaScript: um `data-tem-nome` calculado no JSX diria "sim" com o texto
//      saindo vazio, e uma assercao que lesse so a marca passaria verde sobre o
//      rotulo em branco. Por isso o caso C existe e le OS DOIS.
//   3. AS DUAS LINHAS COLAPSADAS. `creditoAReceber` agrega uma linha por
//      (grupo, devedor), entao a MESMA pessoa pode me dever em DOIS grupos. Com
//      a `key` do React so no `devedor_user_id`, o React junta as duas e uma
//      delas desaparece da tela -- com o total do cartao continuando a conta-la.
//      Nenhuma assercao de aritmetica alcanca isso.
//   4. O SALDO SEM DEVEDOR DESAPARECENDO. `total` e a soma das LINHAS, de
//      proposito (HMO-245), e o resto do saldo positivo vira `sem_devedor`. Sem
//      a linha final do painel a soma visivel fica ABAIXO do numero que a
//      legenda do cartao cita, e a unica forma de achar a diferenca seria somar
//      a lista a mao.
//
// O ROTULO E CALCULADO POR PRODUCAO, E ISSO NAO E DETALHE
// ------------------------------------------------------
// `devedorNaLinha` e `DEVEDOR_SEM_NOME` sao extraidas do .js compilado por
// regex (`daCreditoDeGrupo`, o precedente de `funcaoDaLib` da HMO-365 e de
// `daLib` da HMO-311) em vez de o fixture trazer o texto pronto. Se a pagina
// recebesse `"alguém do grupo"` literal, os casos B e C mediriam o PROPRIO
// FIXTURE -- verdes com o fallback de producao inteiramente quebrado, que e
// exatamente o caso que a issue manda provar.
//
// `formatCurrency` E MARCADOR, DE PROPOSITO: "ESBOCO-VALOR:508.42" diz QUAL
// valor chegou naquele span, o que torna o item 3 mensuravel sem arrastar
// `lib/utils` (e o `clsx`/`tailwind-merge` atras dele) para um script classico.
// A formatacao em si ja e medida em outras suites.
//
// Sem navegador esta suite FALHA -- de proposito, e nao com `skip`. Uma suite
// que se desliga sozinha quando falta o binario e indistinguivel de uma que
// passou. (Neste ambiente o Chromium do Playwright pode estar numa versao que a
// varredura abaixo nao preve: aponte CHROMIUM_BIN.)
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SAIDA = ".tmp-quem-me-paga-na-tela";

/**
 * Acha um Chromium: o do `CHROMIUM_BIN`, o que o Playwright baixou, ou o Chrome
 * do sistema (o runner do Actions ja vem com um).
 *
 * A VERSAO DO PLAYWRIGHT NAO E FIXA AQUI, e isso e cicatriz: as sondas mais
 * antigas deste repositorio tinham "chromium-1243" escrito no fonte, e no dia
 * em que o ambiente subiu para 1248 as quatro ficaram 100% vermelhas numa
 * arvore intocada -- com o sintoma deslocado ("Cannot read properties of
 * null"), porque a mensagem verdadeira aparece uma vez no meio de 47
 * TypeError. A varredura por prefixo custa um `readdirSync` e nao tem esse modo
 * de falha.
 */
function acharChromium() {
  const candidatos = [process.env.CHROMIUM_BIN];

  for (const base of [
    `${process.env.HOME}/.cache/ms-playwright`,
    "/paperclip/.cache/ms-playwright",
  ]) {
    if (!existsSync(base)) continue;

    let entradas = [];
    try {
      entradas = readdirSync(base);
    } catch {
      continue;
    }

    for (const dir of entradas) {
      if (!/^chromium(_headless_shell)?-/.test(dir)) continue;
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

// --- o componente, ja compilado ---------------------------------------------
//
// Quem compila e o script `test:quem-me-paga-na-tela` do package.json. Isso
// tambem e o que faz a segunda peneira do check-tests-in-ci.mjs enxergar os
// arquivos desta suite -- ela le os caminhos citados NO COMANDO.

if (!existsSync(join(SAIDA, "components/movimentacoes/PainelQuemMePaga.js"))) {
  throw new Error(
    `${SAIDA}/ nao existe. Rode por \`npm run test:quem-me-paga-na-tela\`, ` +
      "que e quem compila o componente antes do teste."
  );
}

/** Tira so a fiacao de modulo, deixando o corpo das funcoes intacto. */
const paraScriptClassico = (fonte) =>
  fonte
    // O re-export de barril (`export { A, B, };`) sai INTEIRO e antes da regra
    // da palavra: tirar so a palavra deixaria `{ A, B, };`, cuja virgula final
    // e SyntaxError -- e a peneira de "sobrou export" passaria limpa, porque a
    // palavra sumiu. `[^}]*` nao atravessa chave, entao corpo de funcao fica
    // fora do alcance. Medido na HMO-294 com components/ui/card.tsx.
    .replace(/^export\s*\{[^}]*\}\s*;$/gm, "")
    // O `import` emitido pelo tsc pode ocupar mais de uma linha quando a lista
    // de nomes e longa, entao o recorte e do `import` ate o `;`.
    .replace(/^import\s[\s\S]*?;$/gm, "")
    .replace(/^export /gm, "");

const PARTES = [
  // Ordem de dependencia -- obrigatoria para `const` de modulo.
  "components/ui/card.js",
  "components/movimentacoes/PainelQuemMePaga.js",
];

const producao = PARTES.map((parte) => {
  const fonte = paraScriptClassico(readFileSync(join(SAIDA, parte), "utf8"));

  // Sobra de `import`/`export` e erro de sintaxe DENTRO da pagina, e o sintoma
  // disso e a pagina nao reportar nada -- indistinguivel de codigo quebrado.
  const sobra = fonte.match(/^\s*(import|export)\s.*$/m);
  if (sobra) {
    throw new Error(
      `sobrou fiacao de modulo em ${parte}: ${sobra[0].trim()}\n` +
        "ajuste paraScriptClassico()"
    );
  }

  // Um check de sintaxe POR PARTE, que custa nada e estoura com o NOME do
  // arquivo. Sem ele, dois `const` de mesmo nome em partes diferentes viram "a
  // pagina nao reportou nada", vinte linhas depois.
  try {
    new Function(fonte);
  } catch (e) {
    throw new Error(`${parte} nao parseia como script classico: ${e.message}`);
  }

  return fonte;
}).join("\n");

/**
 * Uma declaracao AUTO-CONTIDA de `lib/credito-de-grupo`, extraida do .js
 * compilado por regex.
 *
 * O precedente e o `funcaoDaLib` da HMO-365, e o motivo e o mesmo: carregar
 * `lib/credito-de-grupo.js` inteiro arrastaria `lib/settlement` atras dele,
 * enquanto `devedorNaLinha` e `DEVEDOR_SEM_NOME` nao usam import nenhum e cabem
 * num script classico.
 *
 * ESTOURA quando o regex nao casa, com o nome. Sem isso o nome ficaria
 * `undefined` na pagina e o sintoma voltaria a ser "a sonda nao reportou nada".
 */
const daCreditoDeGrupo = (regex, nome) => {
  const fonte = readFileSync(join(SAIDA, "lib/credito-de-grupo.js"), "utf8");
  const achado = fonte.match(regex);
  if (!achado) {
    throw new Error(
      `nao achei ${nome} em ${SAIDA}/lib/credito-de-grupo.js -- ` +
        "foi renomeada, ou deixou de ser declaracao de topo"
    );
  }
  return achado[0].replace(/^export /, "");
};

const FONTE_DO_FALLBACK = daCreditoDeGrupo(
  /^export const DEVEDOR_SEM_NOME = [\s\S]*?;$/m,
  "DEVEDOR_SEM_NOME"
);
const FONTE_DO_ROTULO = daCreditoDeGrupo(
  /^export function devedorNaLinha\([\s\S]*?^\}/m,
  "devedorNaLinha"
);
// AS DUAS DECISOES DO "JA PAGOU" (HMO-422, 2a volta), pelo mesmo caminho e pelo
// mesmo motivo: e `jaPagouNaLinha` quem decide se a frase sai, e `algumJaPagou`
// quem decide se a nota do painel sai. Reescrever qualquer uma das duas aqui
// faria a sonda medir a propria copia -- verde com producao escrevendo "ja te
// pagou R$ 0,00" embaixo de todo devedor do app.
const FONTE_DO_JA_PAGOU = daCreditoDeGrupo(
  /^export function jaPagouNaLinha\([\s\S]*?^\}/m,
  "jaPagouNaLinha"
);
const FONTE_DO_ALGUM_JA_PAGOU = daCreditoDeGrupo(
  /^export function algumJaPagou\([\s\S]*?^\}/m,
  "algumJaPagou"
);

/**
 * Uma constante de TEXTO do componente, lida do .js compilado.
 *
 * As assercoes leem o titulo e a nota, entao eles NAO podem ser copia escrita
 * aqui: uma copia passaria verde depois de alguem trocar o texto em producao --
 * e a nota e justamente a frase que impede a pessoa de somar este total ao
 * «Previsto» de cima.
 */
const constanteDoComponente = (nome) => {
  const fonte = readFileSync(
    join(SAIDA, "components/movimentacoes/PainelQuemMePaga.js"),
    "utf8"
  );
  const achado = fonte.match(
    new RegExp(`^export const ${nome} =\\s*([\\s\\S]*?);$`, "m")
  );
  if (!achado) throw new Error(`nao achei a constante ${nome} no componente`);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${achado[1]});`)();
};

const TITULO = constanteDoComponente("TITULO_QUEM_ME_PAGA");
const NOTA = constanteDoComponente("NOTA_QUEM_ME_PAGA");
/**
 * As tres frases da 2a volta. As duas primeiras sao FUNCOES, e por isso elas
 * chegam aqui pelo mesmo caminho das constantes: o regex de
 * `constanteDoComponente` casa com a seta inteira e o `new Function` devolve a
 * funcao, que as assercoes chamam com o MESMO valor que a pagina usou.
 *
 * Afirmar sobre um texto escrito aqui mediria a copia: trocar "neste grupo" por
 * "neste período" em producao -- o defeito de rotulo que a issue reportou --
 * passaria verde.
 */
const NOTA_DO_ACERTO = constanteDoComponente("NOTA_DO_ACERTO_NO_PERIODO");
const FRASE_DO_PERIODO = constanteDoComponente("FRASE_DO_PERIODO");
const FRASE_JA_PAGOU = constanteDoComponente("FRASE_JA_PAGOU");

/**
 * O fallback do devedor ilegivel, LIDO DE PRODUCAO para as assercoes.
 *
 * Escrever `"alguém do grupo"` aqui faria os casos B e C medirem a propria
 * copia -- o defeito que o cabecalho descreve. Vem do mesmo .js de onde a
 * pagina tira a funcao.
 */
// eslint-disable-next-line no-new-func
const SEM_NOME = new Function(
  `${FONTE_DO_FALLBACK.replace(/^const /, "var ")}; return DEVEDOR_SEM_NOME;`
)();

/** O React UMD, inline: `<script src>` entre arquivos file:// e outra briga. */
const umd = (pacote, arquivo) =>
  readFileSync(join("node_modules", pacote, "umd", arquivo), "utf8");

// --- os fixtures -------------------------------------------------------------

const LAIS = "22222222-0000-0000-0000-000000000002";
const BIA = "33333333-0000-0000-0000-000000000003";
const CASA = "aaaaaaaa-0000-0000-0000-00000000000a";
const VIAGEM = "bbbbbbbb-0000-0000-0000-00000000000b";

const PAGINA = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<div id="raiz-a"></div><div id="raiz-b"></div><div id="raiz-c"></div>
<div id="raiz-d"></div><div id="raiz-e"></div>
<div id="raiz-g"></div><div id="raiz-h"></div><div id="raiz-i"></div>
<div id="resultado">a pagina nao rodou</div>
<script>
// O AVISO DO REACT E ASSERCAO, E A CAPTURA TEM DE VIR ANTES DO UMD.
//
// Cicatriz do caso D. Com a \`key\` so no \`devedor_user_id\`, a mesma pessoa em
// dois grupos vira DUAS linhas com a MESMA chave -- e o DOM da PRIMEIRA pintura
// fica identico ao certo: o React renderiza os dois nos e so AVISA. Entao o
// mutante \`chave_so_do_devedor\` sobrevivia a todas as assercoes de marcacao
// (\`quantas === 2\` passava verde), e o defeito e real: a releitura do periodo
// re-renderiza a lista com dados novos, e com chave repetida a reconciliacao
// leva o valor de um grupo para a linha do outro.
//
// "Nao da sintoma na primeira pintura" e exatamente o caso em que o aviso do
// React E a unica evidencia observavel. Por isso a sonda o COLETA em vez de
// deixa-lo na stderr do Chromium (que este arnes descarta, \`stdio: ignore\`).
//
// ANTES do UMD e obrigatorio: \`react-dom.development.js\` guarda a referencia de
// \`console.error\` no carregamento, e um patch aplicado depois nao e visto.
window.AVISOS = [];
(function () {
  const original = console.error;
  console.error = function () {
    try {
      window.AVISOS.push(
        Array.prototype.slice.call(arguments).map(String).join(" ")
      );
    } catch (e) {
      window.AVISOS.push("aviso ilegivel: " + e);
    }
    return original.apply(console, arguments);
  };
})();
</script>
<script>${umd("react", "react.development.js")}</script>
<script>${umd("react-dom", "react-dom.development.js")}</script>
<script>
// Os ids dos fixtures, INJETADOS do lado node para os dois lados usarem o MESMO
// literal: eles sao const do .mjs, e la fora a pagina nao os alcanca. As
// assercoes do lado node montam os seletores com estes mesmos valores, entao uma
// divergencia aqui apareceria como elemento nao encontrado -- nao como id errado.
const LAIS = ${JSON.stringify(LAIS)};
const BIA = ${JSON.stringify(BIA)};
const CASA = ${JSON.stringify(CASA)};
const VIAGEM = ${JSON.stringify(VIAGEM)};

// --- os esbocos -------------------------------------------------------------
//
// MARCADORES e nao valores plausiveis: assim um esboco que vaze para dentro de
// uma assercao de texto aparece com o nome dele na mensagem, em vez de medir uma
// mentira parecida com a verdade.

/** cn: o que card.js pede de lib/utils. */
const cn = (...xs) => xs.filter(Boolean).join(" ");

/** O valor MARCADO: ele diz QUAL numero chegou naquele span. */
const formatCurrency = (valor) => "ESBOCO-VALOR:" + valor;

// --- o rotulo, CALCULADO POR PRODUCAO ---------------------------------------
${FONTE_DO_FALLBACK}
${FONTE_DO_ROTULO}
${FONTE_DO_JA_PAGOU}
${FONTE_DO_ALGUM_JA_PAGOU}

${producao}

// --- utilitarios da sonda ---------------------------------------------------

/**
 * Monta um painel e devolve acessos ESCOPADOS nele.
 *
 * O escopo e obrigatorio: dois paineis desta pagina tem os MESMOS devedores, e
 * um \`document.querySelector\` devolveria o do PRIMEIRO painel -- uma assercao
 * sobre o caso D leria a arvore do caso A.
 */
const montar = (raiz, credito, rotuloDoPeriodo) => {
  const caixa = document.getElementById(raiz);
  // ReactDOM.render (legado) e nao createRoot: o legado renderiza sincrono,
  // entao ler o DOM na linha seguinte ja ve a arvore. Com createRoot a sonda
  // leria uma caixa VAZIA -- e "painel nenhum" e justamente a assercao do caso
  // E, que ficaria verde por acidente para todos os outros.
  //
  // \`rotuloDoPeriodo\` e OMITIDO quando nao vem: passar \`undefined\` e nao
  // passar a prop sao a mesma coisa em React, e os casos A-F foram escritos
  // antes de a prop existir -- eles continuam medindo o painel sem ela, que e
  // tambem o controle negativo do caso H.
  ReactDOM.render(
    React.createElement(PainelQuemMePaga, {
      credito: credito,
      rotuloDoPeriodo: rotuloDoPeriodo
    }),
    caixa
  );

  const todos = (seletor) =>
    Array.prototype.slice.call(caixa.querySelectorAll(seletor));

  return {
    caixa: caixa,
    todos: todos,
    /** Um atributo de dado do PRIMEIRO casamento, ou null. */
    attr: (seletor, nome) => {
      const el = caixa.querySelector(seletor);
      return el ? el.getAttribute(nome) : null;
    },
  };
};

/**
 * Uma linha de credito, no contrato de \`CreditoDeGrupo\`.
 *
 * \`ja_pago\` NASCE \`null\` -- o estado de quem nao passou pelo teto
 * (\`creditoAReceber\` nao le \`group_settlements\`). E com isso os casos A-F,
 * escritos antes da 2a volta, viram o controle negativo dela: nenhum deles pode
 * ganhar frase de recibo.
 */
const credito = (group_id, grupo, devedor_user_id, devedor, valor, ja_pago) => ({
  group_id: group_id,
  grupo: grupo,
  devedor_user_id: devedor_user_id,
  devedor: devedor,
  valor: valor,
  ja_pago: ja_pago === undefined ? null : ja_pago,
});

/** A leitura inteira, no contrato de \`CreditoAReceber\`. */
const leitura = (linhas, sem_devedor) => ({
  linhas: linhas,
  // O total E A SOMA DAS LINHAS, de proposito (HMO-245) -- calculado aqui pela
  // mesma regra, para o caso A poder comparar a soma lida da TELA com ele.
  total: Number(linhas.reduce((s, l) => s + l.valor, 0).toFixed(2)),
  sem_devedor: sem_devedor || 0,
});

const r = {};

try {
// =============================================================================
// CASO A -- OS 508,42 DA ISSUE: duas pessoas, um grupo, com nome e valor
// =============================================================================
// O numero da issue, decomposto: a Lais deve 300,00 e a Bia 208,42 na Casa.
const CREDITO_A = leitura([
  credito(CASA, "Casa", LAIS, "Laís", 300),
  credito(CASA, "Casa", BIA, "Bia", 208.42),
]);
const a = montar("raiz-a", CREDITO_A);

r.a = {
  painel_existe: a.caixa.querySelector("[data-painel='quem-me-paga']") !== null,
  titulo: a.caixa.textContent.indexOf(${JSON.stringify(TITULO)}) >= 0,
  nota: a.caixa.textContent.indexOf(${JSON.stringify(NOTA)}) >= 0,
  // UMA linha por devedor, na ordem em que a lib as entregou.
  quantas: a.todos("[data-devedor]").length,
  devedores: a.todos("[data-devedor]").map(function (el) {
    return el.getAttribute("data-devedor");
  }),
  // O rotulo e o valor LIDOS DA MESMA LINHA, e nao dois querySelectorAll
  // independentes: o item 3 do cabecalho e exatamente "o valor de um saiu na
  // linha do outro", e duas listas paralelas nao distinguem isso.
  por_linha: a.todos("[data-devedor]").map(function (el) {
    const valor = el.querySelector("[data-valor-do-devedor]");
    return {
      devedor: el.getAttribute("data-devedor"),
      nome: el.querySelector("p").textContent,
      grupo: el.querySelector("[data-tem-nome]").textContent,
      tem_nome: el.querySelector("[data-tem-nome]").getAttribute("data-tem-nome"),
      valor_attr: Number(valor.getAttribute("data-valor-do-devedor")),
      valor_texto: valor.textContent
    };
  }),
  // A INVARIANTE DA HMO-245, LIDA DA TELA: a soma dos valores que a pessoa
  // consegue apontar tem de dar o total que a legenda do cartao cita.
  soma_da_tela: Number(
    a.todos("[data-valor-do-devedor]").reduce(function (s, el) {
      return s + Number(el.getAttribute("data-valor-do-devedor"));
    }, 0).toFixed(2)
  ),
  total_da_lib: CREDITO_A.total,
  // Sem saldo orfao, a linha final NAO pode existir: "mais R$ 0,00 sem devedor"
  // e ruido que parece recurso quebrado.
  tem_sem_devedor: a.caixa.querySelector("[data-sem-devedor]") !== null,

  // OS TRES CONTROLES NEGATIVOS DA 2a VOLTA, no caso que a issue nomeia:
  // \`ja_pago\` nulo e nenhum rotulo de periodo, entao NENHUMA das frases novas
  // pode aparecer. Sem eles, um painel que escrevesse recibo para todo mundo
  // passaria verde em G e H -- e "ja te pagou R$ 0,00" embaixo de quem nunca
  // pagou e pior que a omissao que esta issue veio consertar.
  tem_ja_pago: a.caixa.querySelector("[data-ja-pago]") !== null,
  tem_nota_do_acerto: a.caixa.querySelector("[data-nota-do-acerto]") !== null,
  tem_periodo: a.caixa.querySelector("[data-periodo]") !== null
};

// =============================================================================
// CASO B -- PERFIL ILEGIVEL (devedor null): a linha CONTINUA mencionando alguem
// =============================================================================
// O controle que a classe (1) do cabecalho exige. \`devedor: null\` e o perfil que
// a RLS nao me deixa ler -- e \`devedorNaLinha\`, que e PRODUCAO, e quem escreve
// o texto.
const b = montar("raiz-b", leitura([credito(CASA, "Casa", LAIS, null, 300)]));
const linhaB = b.caixa.querySelector("[data-devedor]");

r.b = {
  // E o elemento existe mesmo? "Escondido" seria indistinguivel de "vazio".
  existe: linhaB !== null,
  texto: linhaB ? linhaB.querySelector("p").textContent : null,
  // A marca E o texto, LIDOS OS DOIS: so a marca passaria verde sobre um selo
  // em branco.
  tem_nome: b.attr("[data-tem-nome]", "data-tem-nome"),
  // O GRUPO continua dito, e e ele que da contexto quando o nome falta.
  grupo: b.caixa.querySelector("[data-tem-nome]").textContent,
  valor_texto: b.caixa.querySelector("[data-valor-do-devedor]").textContent
};

// =============================================================================
// CASO C -- full_name DE ESPACOS: o trim de producao decide, nao a verdade do JS
// =============================================================================
// A classe (2) do cabecalho. "   " e verdadeiro em JavaScript: uma marca
// calculada no JSX diria "sim" e o texto sairia vazio.
const c = montar("raiz-c", leitura([credito(CASA, "Casa", BIA, "   ", 208.42)]));

r.c = {
  texto: c.caixa.querySelector("[data-devedor] p").textContent,
  tem_nome: c.attr("[data-tem-nome]", "data-tem-nome")
};

// =============================================================================
// CASO D -- A MESMA PESSOA EM DOIS GRUPOS: duas linhas, e nenhuma colapsa
// =============================================================================
// A classe (3) do cabecalho. \`creditoAReceber\` agrega por (grupo, devedor),
// entao isto NAO e duplicata: sao duas dividas legitimas da mesma pessoa.
const d = montar("raiz-d", leitura([
  credito(CASA, "Casa", LAIS, "Laís", 300),
  credito(VIAGEM, "Viagem", LAIS, "Laís", 150)
]));

r.d = {
  quantas: d.todos("[data-devedor]").length,
  // A CHAVE REPETIDA, QUE O DOM DA PRIMEIRA PINTURA NAO MOSTRA. Ver o patch de
  // \`console.error\` no topo da pagina: o React renderiza os dois nos e so
  // AVISA, entao sem esta leitura o mutante da chave sobrevive a tudo.
  avisos_de_chave: window.AVISOS.filter(function (a) {
    return /same key/.test(a) || /mesma chave/.test(a);
  }),
  // Os DOIS grupos aparecem, e com o valor de cada um na linha dele.
  por_linha: d.todos("[data-devedor]").map(function (el) {
    return {
      grupo: el.querySelector("[data-tem-nome]").textContent,
      valor: Number(
        el.querySelector("[data-valor-do-devedor]")
          .getAttribute("data-valor-do-devedor")
      )
    };
  })
};

// =============================================================================
// CASO E -- SALDO SEM DEVEDOR NOMEADO: escrito, e nao desaparecido
// =============================================================================
// A classe (4) do cabecalho. O centavo de tolerancia de \`simplifySettlements\`
// deixa saldo meu sem a quem cobrar, e o total do cartao continua sendo a soma
// das linhas.
const e = montar("raiz-e", leitura(
  [credito(CASA, "Casa", LAIS, "Laís", 300)],
  0.01
));

r.e = {
  attr: e.attr("[data-sem-devedor]", "data-sem-devedor"),
  texto: e.caixa.querySelector("[data-sem-devedor]").textContent
};

// =============================================================================
// CASO F -- NADA A RECEBER: painel NENHUM, e nao um painel com R$ 0,00
// =============================================================================
// Os DOIS caminhos de ausencia, e eles chegam por portas diferentes: \`null\` e a
// resposta que nao fala de credito (outras abas, ou corpo guardado no aparelho
// de antes desta issue) e \`linhas: []\` e a de quem nao participa de grupo.
const caixaNulo = document.createElement("div");
document.body.appendChild(caixaNulo);
ReactDOM.render(
  React.createElement(PainelQuemMePaga, { credito: null }),
  caixaNulo
);

const caixaVazio = document.createElement("div");
document.body.appendChild(caixaVazio);
ReactDOM.render(
  React.createElement(PainelQuemMePaga, { credito: leitura([], 0) }),
  caixaVazio
);

// E o controle NEGATIVO do caso E: sem saldo orfao a linha nao sai, mesmo com
// linhas na lista. Sem ele, um \`sem_devedor >= 0\` passaria verde no caso E.
const caixaSemOrfao = document.createElement("div");
document.body.appendChild(caixaSemOrfao);
ReactDOM.render(
  React.createElement(PainelQuemMePaga, {
    credito: leitura([credito(CASA, "Casa", LAIS, "Laís", 300)], 0)
  }),
  caixaSemOrfao
);

// =============================================================================
// CASO G -- ELA JA ME PAGOU: a linha dela diz quanto, e a do lado NAO diz nada
// =============================================================================
// O print que reabriu a HMO-422: "Letícia me pagou (Casa)" num bloco e
// "Letícia · Casa · R$ 270,62" no outro, sem nada ligando os dois. Aqui a Lais
// pagou R$ 150,00 do que devia e a Bia nao pagou nada -- os DOIS estados no
// MESMO painel, que e o que distingue "escreve o recibo certo" de "escreve
// recibo para todo mundo".
const g = montar("raiz-g", leitura([
  credito(CASA, "Casa", LAIS, "Laís", 300, 150),
  credito(CASA, "Casa", BIA, "Bia", 208.42, 0)
]), "outubro de 2026");

r.g = {
  // O RECIBO ESTA NA LINHA DELA, e lido de DENTRO da linha: um
  // \`querySelectorAll\` solto nao distingue "na linha certa" de "na outra".
  por_linha: g.todos("[data-devedor]").map(function (el) {
    const recibo = el.querySelector("[data-ja-pago]");
    return {
      devedor: el.getAttribute("data-devedor"),
      // O valor que o span marca -- e e ele que diz se a linha imprimiu o
      // proprio \`ja_pago\` ou o de outra pessoa.
      attr: recibo ? recibo.getAttribute("data-ja-pago") : null,
      texto: recibo ? recibo.textContent : null,
      // O valor a receber CONTINUA na linha: o recibo e um acrescimo, nao um
      // substituto. Trocar um pelo outro apagaria o numero da issue.
      valor: el.querySelector("[data-valor-do-devedor]").textContent
    };
  }),
  // A NOTA DO PAINEL, que explica por que um pagamento ja feito pode nao ter
  // baixado o numero do lado.
  nota_do_acerto: g.caixa.querySelector("[data-nota-do-acerto]") !== null,
  texto_do_painel: g.caixa.textContent
};

// =============================================================================
// CASO H -- DE QUANDO SAO ESTES VALORES
// =============================================================================
// A outra metade da 2a volta: "a Laís te deve R$ 300,00" sem data se le como a
// divida INTEIRA dela, e o acerto pago ontem parece nao ter entrado.
const h = montar(
  "raiz-h",
  leitura([credito(CASA, "Casa", LAIS, "Laís", 300)]),
  "outubro de 2026"
);

// E O CONTROLE DO ROTULO EM BRANCO: \`"   "\` e verdadeiro em JavaScript, e sem
// o \`trim()\` de producao a tela escreveria "valores de " com nada depois --
// a mesma classe de defeito do \`full_name\` de espacos do caso C.
const i = montar(
  "raiz-i",
  leitura([credito(CASA, "Casa", LAIS, "Laís", 300)]),
  "   "
);

r.h = {
  attr: h.attr("[data-periodo]", "data-periodo"),
  texto: h.caixa.querySelector("[data-periodo]")
    ? h.caixa.querySelector("[data-periodo]").textContent
    : null,
  // Sem acerto nenhum neste painel, a nota do acerto NAO sai -- o controle
  // negativo de G dentro de um painel que TEM a frase de periodo.
  tem_nota_do_acerto: h.caixa.querySelector("[data-nota-do-acerto]") !== null,
  branco_tem_periodo: i.caixa.querySelector("[data-periodo]") !== null,
  branco_tem_painel:
    i.caixa.querySelector("[data-painel='quem-me-paga']") !== null,
  branco_texto: i.caixa.textContent
};

r.f = {
  nulo_html: caixaNulo.innerHTML,
  nulo_texto: caixaNulo.textContent,
  vazio_html: caixaVazio.innerHTML,
  vazio_texto: caixaVazio.textContent,
  sem_orfao_tem_linha:
    caixaSemOrfao.querySelector("[data-sem-devedor]") !== null,
  sem_orfao_tem_painel:
    caixaSemOrfao.querySelector("[data-painel='quem-me-paga']") !== null
};

document.getElementById("resultado").textContent =
  "RESULTADO" + JSON.stringify(r) + "FIM";
} catch (e) {
  // Sem isto, um erro aqui dentro vira "a pagina nao reportou nada" e o motivo
  // real fica dentro do navegador, invisivel.
  document.getElementById("resultado").textContent =
    "ERRO NA PAGINA: " + (e && (e.stack || e.message));
}
</script></body></html>`;

// --- roda o navegador --------------------------------------------------------

const chromium = acharChromium();
let resultado = null;
let erroDeExecucao = null;

try {
  if (!chromium) throw new Error(SEM_NAVEGADOR);

  const dir = mkdtempSync(join(tmpdir(), "quem-me-paga-"));
  const paginaEscrita = join(dir, "quem-me-paga.html");
  writeFileSync(paginaEscrita, PAGINA);

  const dump = execFileSync(
    chromium,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--window-size=390,844", // iPhone: e onde esta tela e usada
      "--dump-dom",
      `file://${paginaEscrita}`,
    ],
    {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024, // o dump carrega o React inline junto
      stdio: ["ignore", "pipe", "ignore"], // o Chromium enche a stderr de dbus
    }
  );

  // O recorte vai ate `</div>`, e nao `([^<]*)<`: o JSON do relato tem `<`
  // dentro (o `html` do caso F), e o `[^<]*` truncaria no primeiro.
  const achado = dump.match(/id="resultado">([\s\S]*?)<\/div>/);
  if (!achado) {
    throw new Error(`a pagina nao carregou:\n${dump.slice(0, 1500)}`);
  }

  // O `--dump-dom` serializa o textContent como HTML, entao todo `&` do JSON
  // volta `&amp;`. Desescapar com `&amp;` por ULTIMO, senao `&amp;lt;` viraria
  // `<`.
  const relato = achado[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

  if (relato.startsWith("ERRO NA PAGINA")) throw new Error(relato);

  const bruto = relato.match(/^RESULTADO([\s\S]*)FIM$/);
  if (!bruto) {
    throw new Error(`a pagina nao reportou resultado, e sim: ${relato}`);
  }
  resultado = JSON.parse(bruto[1]);
} catch (e) {
  erroDeExecucao = e;
}

// -----------------------------------------------------------------------------

test("o navegador rodou e reportou a pagina", () => {
  if (erroDeExecucao) throw erroDeExecucao;
  assert.ok(resultado, "sem resultado do navegador");
});

// =============================================================================
// A -- OS 508,42 DA ISSUE, COM NOME E GRUPO
// =============================================================================

test("A: o painel montou, com titulo e a nota que diz que o valor NAO e extra", () => {
  assert.equal(resultado.a.painel_existe, true, "o painel nao esta na tela");
  assert.equal(resultado.a.titulo, true, "o titulo do painel nao esta na tela");
  // A nota e entrega: sem ela a pessoa soma este total ao «Previsto» de cima e
  // conclui que vai receber o dobro.
  assert.equal(resultado.a.nota, true, "a nota do painel nao esta na tela");
});

test("A: UMA linha por devedor, nomeada, com o grupo e o valor DELA", () => {
  assert.equal(resultado.a.quantas, 2);
  assert.deepEqual(resultado.a.devedores, [LAIS, BIA]);

  // Lido linha a linha: o valor de um na linha do outro passaria em qualquer
  // assercao de aritmetica e e justamente o que a tela denuncia.
  assert.deepEqual(resultado.a.por_linha, [
    {
      devedor: LAIS,
      nome: "Laís",
      grupo: "Casa",
      tem_nome: "sim",
      valor_attr: 300,
      valor_texto: "ESBOCO-VALOR:300",
    },
    {
      devedor: BIA,
      nome: "Bia",
      grupo: "Casa",
      tem_nome: "sim",
      valor_attr: 208.42,
      valor_texto: "ESBOCO-VALOR:208.42",
    },
  ]);
});

test("A: a soma das linhas DA TELA e o total da lib -- os 508,42 da issue", () => {
  // A invariante da HMO-275/HMO-245: o numero grande tem de bater com a soma
  // das linhas que a pessoa consegue apontar na tela.
  assert.equal(resultado.a.soma_da_tela, 508.42);
  assert.equal(resultado.a.total_da_lib, 508.42);
  assert.equal(resultado.a.soma_da_tela, resultado.a.total_da_lib);
});

test("A: sem saldo orfao, a linha de «sem devedor» NAO sai", () => {
  assert.equal(resultado.a.tem_sem_devedor, false);
});

// =============================================================================
// B -- O PERFIL ILEGIVEL (a classe 1)
// =============================================================================

test("B: sem full_name a linha EXISTE e menciona outra pessoa", () => {
  assert.equal(resultado.b.existe, true, "a linha do devedor desapareceu");
  // O texto sai de `devedorNaLinha`, que e PRODUCAO: um fixture com o texto
  // pronto mediria a si mesmo.
  assert.equal(resultado.b.texto, SEM_NOME);
  // E a marca concorda com o texto. As duas, sempre.
  assert.equal(resultado.b.tem_nome, "nao");
});

test("B: o grupo continua dito, e e ele que da o contexto que falta", () => {
  assert.equal(resultado.b.grupo, "Casa");
  assert.equal(resultado.b.valor_texto, "ESBOCO-VALOR:300");
});

// =============================================================================
// C -- full_name DE ESPACOS (a classe 2)
// =============================================================================

test("C: full_name de espacos cai no fallback, e a marca NAO mente", () => {
  // `"   "` e verdadeiro em JavaScript. Uma marca calculada no JSX diria "sim"
  // com o texto saindo em branco, e uma assercao que lesse so a marca passaria
  // verde sobre o rotulo vazio.
  assert.equal(resultado.c.texto, SEM_NOME);
  assert.equal(resultado.c.tem_nome, "nao");
});

// =============================================================================
// D -- A MESMA PESSOA EM DOIS GRUPOS (a classe 3)
// =============================================================================

test("D: a mesma pessoa em dois grupos da DUAS linhas, e nenhuma colapsa", () => {
  // Com a `key` do React so no `devedor_user_id`, o React junta as duas e uma
  // desaparece da tela -- com o cartao «Previsto» continuando a soma-las.
  assert.equal(
    resultado.d.quantas,
    2,
    "duas dividas da mesma pessoa colapsaram numa linha so"
  );
  assert.deepEqual(resultado.d.por_linha, [
    { grupo: "Casa", valor: 300 },
    { grupo: "Viagem", valor: 150 },
  ]);
});

test("D: a `key` do React distingue os dois grupos -- sem aviso de chave repetida", () => {
  // A ASSERCAO QUE O DOM NAO ALCANCA, e ela e a razao de a pagina capturar
  // `console.error`. Com a chave so no `devedor_user_id` as duas linhas ficam
  // com a MESMA chave: a primeira pintura sai identica (os dois nos existem, e
  // o teste acima passa verde), e o estrago aparece na RELEITURA -- o React
  // reconcilia pelas chaves, e o valor de um grupo vai para a linha do outro.
  //
  // `deepEqual` com `[]` e nao `.length === 0`: a mensagem de falha mostra O
  // AVISO, que diz qual chave duplicou.
  assert.deepEqual(
    resultado.d.avisos_de_chave,
    [],
    "o React avisou chave repetida: a `key` nao distingue os dois grupos"
  );
});

// =============================================================================
// E -- O SALDO SEM DEVEDOR (a classe 4)
// =============================================================================

test("E: o saldo sem devedor nomeado e ESCRITO, nao desaparecido", () => {
  assert.equal(resultado.e.attr, "0.01");
  assert.match(resultado.e.texto, /ESBOCO-VALOR:0\.01/);
  // A frase tem de dizer o que aquele numero e. "mais R$ 0,01" sozinho se le
  // como erro de arredondamento do painel.
  assert.match(resultado.e.texto, /sem devedor identificado no acerto/);
});

// =============================================================================
// F -- NADA A RECEBER, E O CONTROLE NEGATIVO DO CASO E
// =============================================================================

test("F: `credito` nulo nao desenha painel nenhum", () => {
  // `null` e a resposta que NAO FALA de credito: outras abas, ou corpo guardado
  // no aparelho de antes desta issue.
  assert.equal(resultado.f.nulo_html, "");
  assert.equal(resultado.f.nulo_texto, "");
});

test("F: lista vazia nao desenha painel com R$ 0,00", () => {
  // "R$ 0,00 a receber de grupos" na tela de quem nao tem grupo e ruido que
  // parece recurso quebrado -- a mesma escolha de `notaDoCreditoAReceber`.
  assert.equal(resultado.f.vazio_html, "");
  assert.equal(resultado.f.vazio_texto, "");
});

// =============================================================================
// G -- O RECIBO NA LINHA DE QUEM PAGOU (HMO-422, 2a volta)
// =============================================================================

test("G: a linha de quem pagou diz QUANTO -- e a de quem nao pagou fica calada", () => {
  // O defeito que esta assercao fecha e o print da issue: a aba dizia "Letícia
  // me pagou (Casa)" num bloco e "Letícia · Casa · R$ 270,62" no outro, as duas
  // frases certas, nenhuma dizendo de que mes falava.
  //
  // A FRASE VEM DE PRODUCAO, chamada com o MESMO marcador que a pagina usou:
  // uma copia escrita aqui ficaria verde depois de alguem trocar "neste grupo"
  // por "neste período" -- que e o rotulo que mente sobre o recorte.
  assert.deepEqual(resultado.g.por_linha, [
    {
      devedor: LAIS,
      attr: "150",
      texto: FRASE_JA_PAGOU("ESBOCO-VALOR:150"),
      valor: "ESBOCO-VALOR:300",
    },
    // `ja_pago: 0` NAO escreve nada. "A Bia já te pagou R$ 0,00" embaixo do
    // nome de quem nunca pagou e um recibo inventado.
    { devedor: BIA, attr: null, texto: null, valor: "ESBOCO-VALOR:208.42" },
  ]);
});

test("G: o painel explica POR QUE o pagamento pode nao ter baixado o valor", () => {
  assert.equal(
    resultado.g.nota_do_acerto,
    true,
    "a nota do acerto nao esta na tela"
  );
  // O TEXTO, e nao so a marca: o `data-nota-do-acerto` sobreviveria a um
  // paragrafo vazio, e e a frase que faz a tela parar de se contradizer.
  assert.ok(
    resultado.g.texto_do_painel.indexOf(NOTA_DO_ACERTO) >= 0,
    "a nota do acerto esta marcada mas o texto dela nao saiu"
  );
  // E a nota tem de dizer que o abate e do GRUPO INTEIRO, que e o limite
  // declarado de `aplicarTetoDoAcerto` -- sem isso ela nao explica nada.
  assert.match(NOTA_DO_ACERTO, /todos os meses/);
});

// =============================================================================
// H -- DE QUANDO SAO OS VALORES
// =============================================================================

test("H: o painel diz o periodo, com o MESMO rotulo do resto da tela", () => {
  assert.equal(resultado.h.attr, "outubro de 2026");
  assert.equal(resultado.h.texto, FRASE_DO_PERIODO("outubro de 2026"));
  // Sem acerto nenhum aqui, a nota do acerto NAO sai: as duas frases novas sao
  // independentes, e um painel que escrevesse as duas sempre passaria verde em
  // G sem distinguir nada.
  assert.equal(resultado.h.tem_nota_do_acerto, false);
});

test("H: rotulo em BRANCO nao vira 'valores de ' -- o painel cala", () => {
  // `"   "` e verdadeiro em JavaScript: sem o `trim()` de producao a frase sai
  // pela metade. A mesma classe do `full_name` de espacos do caso C, e aqui ela
  // nao tem fallback -- a frase simplesmente nao e dita.
  assert.equal(resultado.h.branco_tem_periodo, false);
  // E o painel CONTINUA de pe: perder o rotulo nao pode apagar as linhas.
  assert.equal(resultado.h.branco_tem_painel, true);
  assert.ok(
    resultado.h.branco_texto.indexOf("valores de") < 0,
    "sobrou um 'valores de' sem periodo nenhum depois"
  );
});

test("A: sem acerto e sem periodo, NENHUMA das frases novas aparece", () => {
  // O CONTROLE NEGATIVO dos dois casos acima, no fixture da issue. `ja_pago`
  // nulo e a leitura que nao olhou acertos (`creditoAReceber` nao le
  // `group_settlements`), e ela nao pode produzir recibo nenhum.
  assert.equal(resultado.a.tem_ja_pago, false);
  assert.equal(resultado.a.tem_nota_do_acerto, false);
  assert.equal(resultado.a.tem_periodo, false);
});

test("F: o CONTROLE NEGATIVO do caso E -- `sem_devedor` zero nao escreve linha", () => {
  // Sem este bloco, trocar `> 0` por `>= 0` em producao continuaria verde no
  // caso E, e a tela escreveria "mais R$ 0,00 sem devedor identificado no
  // acerto" para todo mundo que tem grupo.
  assert.equal(resultado.f.sem_orfao_tem_painel, true, "o painel sumiu");
  assert.equal(resultado.f.sem_orfao_tem_linha, false);
});
