// ---------------------------------------------------------------------------
// OS DOIS SENTIDOS DO JURO, NA TELA (HMO-448, F3 da HMO-444)
// ---------------------------------------------------------------------------
// A medicao que a issue pede com estas palavras:
//
//   "digitar 1000 + 20% mostra 1.200, e digitar 1000 + total 1.200 mostra 20%
//    -- os dois sentidos, que sao o pedido da issue"
//
// E ela SO da para fazer num navegador. Sem handler nao ha tela: o React
// renderiza identico com o `onChange` vazio, e um teste de funcao pura passa
// verde porque o estado exibido e escolhido pelo teste em vez de produzido pelo
// gesto. A receita e `provar-handler-react-em-chromium-commitado`: React UMD
// inline, `jsx: react`, `ReactDOM.render` legado (sincrono -- com `createRoot` a
// leitura veria o estado ANTERIOR) e o SETTER NATIVO do input (atribuir
// `el.value` direto nao dispara `onChange`, e a sonda passaria sem nunca ter
// chamado o handler).
//
// O QUE ESTA SONDA MEDE, E O QUE ELA NAO MEDE -- A FRONTEIRA ESTA ESCRITA
// ---------------------------------------------------------------------
// MEDE: que digitar nos campos de `CamposDeJuros` chega na aritmetica, e que o
// numero resolvido aparece em `PreviaDoEmprestimo` -- os dois componentes de
// PRODUCAO, com a fiacao de producao entre eles (`juroDoPedido`,
// `valorQueMontaASerie`, `baseQueMontaASerie`, `serieDoEmprestimo`,
// `previaDoEmprestimo`, todas importadas, nenhuma reescrita aqui).
//
// NAO MEDE: que `PainelDoMyBank` passa estas props. Aquele componente arrasta
// Card, Button, Input, Label, lucide, toast e `fetch`, e cada um deles viraria
// um esboco -- e cada esboco e um lugar onde a sonda deixa de falar do codigo de
// producao. O que cobre aquela ponta e o `tsc` (os tipos das props) e a suite de
// `test:emprestimo-do-mybank`, que mede as MESMAS funcoes puras e a rota.
// Dizer isso aqui e mais honesto do que uma sonda que parece medir a tela
// inteira: `mesmo-alvo-nao-prova-coberto`.
//
// O ARRANJO DE ESTADO DESTA PAGINA E O DO PAINEL, E ELE E CURTO DE PROPOSITO
// --------------------------------------------------------------------------
// `Formulario` abaixo tem as mesmas cinco linhas de `PainelDoMyBank`: o estado
// dos tres campos, e a cadeia `juroDoPedido -> serieDoEmprestimo ->
// previaDoEmprestimo`. Ele e curto porque a decisao toda vive nas funcoes puras
// -- e e justamente isso que esta sonda confirma: se houvesse um `if` de dois
// sentidos dentro do componente, ele NAO estaria aqui e a sonda nao o veria.
// ---------------------------------------------------------------------------

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SAIDA = ".tmp-previa-do-emprestimo";

/**
 * Acha um Chromium: o do `CHROMIUM_BIN`, o que o Playwright baixou, ou o Chrome
 * do sistema.
 *
 * Sem navegador este teste FALHA -- de proposito, e nao com `skip`. Uma suite
 * que se desliga sozinha quando falta o binario e indistinguivel de uma que
 * passou (`canal-opcional-fica-desligado-sem-sintoma`).
 *
 * A VERSAO DO PLAYWRIGHT NAO ESTA FIXA: a pasta e LISTADA em vez de adivinhada.
 * Com `chromium-1243` escrito no fonte, o bump do ambiente para `chromium-1248`
 * deixou a sonda irma 100% vermelha numa arvore intocada.
 */
function acharChromium() {
  const candidatos = [process.env.CHROMIUM_BIN];

  for (const base of [
    `${process.env.HOME}/.cache/ms-playwright`,
    "/paperclip/.cache/ms-playwright",
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
    "/usr/bin/chromium-browser"
  );

  return candidatos.find((c) => c && existsSync(c)) ?? null;
}

const SEM_NAVEGADOR =
  "Nenhum Chromium encontrado. Aponte CHROMIUM_BIN para um binario, " +
  "ou instale com `npx playwright install chromium`.";

if (!existsSync(join(SAIDA, "components/mybank/CamposDeJuros.js"))) {
  throw new Error(
    `${SAIDA}/ nao existe. Rode por \`npm run test:previa-do-emprestimo\`, ` +
      "que e quem compila os componentes antes do teste."
  );
}

/** Tira so a fiacao de modulo, deixando o corpo das funcoes intacto. */
const paraScriptClassico = (fonte) =>
  fonte
    // O recorte e do `import` ate o `;`, e nao de uma linha so: o tsc quebra a
    // lista de nomes em varias linhas quando ela e longa, e metade dela ficaria
    // solta no meio do script.
    .replace(/^import\s[\s\S]*?;$/gm, "")
    // O re-export de barril (`export { A, B, };`) INTEIRO, antes da regra da
    // palavra: tirar so a palavra deixa `{ A, B, };`, cuja virgula final e
    // SyntaxError -- e a peneira de "sobrou export" passa limpa, porque a
    // palavra sumiu. `[^}]*` nao atravessa chave, entao corpo de funcao e
    // `export {...} from "..."` ficam fora do alcance.
    .replace(/^export\s*\{[^}]*\}\s*;$/gm, "")
    .replace(/^export /gm, "");

const PARTES = [
  // ORDEM DE DEPENDENCIA. Nao e exigencia do JavaScript para funcao declarada
  // (ela e icada), mas e para `const` de modulo -- e os quatro `lib/` tem
  // varios.
  "lib/dinheiro.js",
  "lib/lancamento.js",
  "lib/juros-do-emprestimo.js",
  "lib/transferencia.js",
  "lib/emprestimo-do-mybank.js",
  "components/mybank/PreviaDoEmprestimo.js",
  "components/mybank/CamposDeJuros.js",
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

  // UM CHECK DE SINTAXE POR PARTE: custa nada e estoura COM O NOME DO ARQUIVO.
  // Sem ele, o sintoma de um strip incompleto e "a pagina nao reportou
  // resultado", vinte linhas depois e sem dizer onde.
  new Function(fonte);

  return fonte;
}).join("\n");

// A PENEIRA SOBRE O CONCATENADO, que as duas de cima nao pegam: dois `const` de
// modulo com o MESMO nome em partes diferentes e SyntaxError do script inteiro.
// Com sete modulos de producao na pagina isso deixa de ser hipotetico.
try {
  new Function(producao);
} catch (e) {
  throw new Error(
    `o concatenado nao compila (provavelmente dois modulos declaram o mesmo ` +
      `nome de topo): ${e.message}`
  );
}

/** O React UMD, inline: `<script src>` entre arquivos file:// e outra briga. */
const umd = (pacote, arquivo) =>
  readFileSync(join("node_modules", pacote, "umd", arquivo), "utf8");

const PAGINA = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<div id="raiz-taxa"></div><div id="raiz-total"></div><div id="raiz-sem"></div>
<div id="resultado">a pagina nao rodou</div>
<script>${umd("react", "react.development.js")}</script>
<script>${umd("react-dom", "react-dom.development.js")}</script>
<script>
try {
// Os hooks por nome, do React global -- o \`import\` deles foi removido junto
// com o resto da fiacao de modulo. E eles sao \`const\` de TOPO DE SCRIPT: postos
// dentro de uma funcao, viram locais dela e nenhuma funcao de producao os
// alcanca por escopo (o erro seria \`useState is not defined\` no primeiro
// render, que nao se le como problema de escopo).
const { useCallback, useEffect, useMemo, useRef, useState } = React;

${producao}

// --- o arranjo de estado, que e o do PainelDoMyBank -------------------------
//
// As mesmas cinco linhas do painel. Ver o cabecalho: ele e curto porque a
// decisao vive toda nas funcoes puras, e e isso que esta sonda confirma.

function Formulario(props) {
  const [modo, setModo] = useState(props.modoInicial);
  const [taxa, setTaxa] = useState("");
  const [total, setTotal] = useState("");

  // O VALOR EMPRESTADO vem como prop ja no formato plano ("1000.00"), que e o
  // que o \`CampoDeValor\` do painel EMITE. O campo em si fica de fora desta
  // pagina de proposito: ele arrasta a CalculadoraDeValor e o Input de ui/, e a
  // convencao dele (exibir mascarado, emitir plano) e a mesma do campo de total
  // que ESTA aqui -- as duas saem de \`lib/dinheiro.ts\`, que esta compilado.
  const valor = props.emprestado;

  const juro = juroDoPedido({
    modo,
    emprestado: valor,
    taxaPercentual: taxa,
    totalARceber: total,
  });

  const serie = serieDoEmprestimo({
    valor: valorQueMontaASerie({ modo, digitado: valor, juro }),
    // \`daTela: "total"\` no modo sem juro, e a escolha e da LEITURA da sonda:
    // com "parcela" o emprestimo sem juro de "1000" seria 12x de R$ 1.000 (um
    // principal de R$ 12.000), e o ponto de partida da comparacao viraria
    // R$ 12.000 -> R$ 1.000, que nao se le. Com "total" o modo sem juro e um
    // emprestimo de R$ 1.000 redondo, e o gesto de 20% move exatamente um
    // numero: o total, de R$ 1.000 para R$ 1.200.
    base: baseQueMontaASerie({ modo, daTela: "total" }),
    parcelas: props.parcelas,
    primeiroVencimento: "2026-11-10",
  });

  const previa = previaDoEmprestimo({ modo, juro, serie });

  return React.createElement(
    "div",
    null,
    React.createElement(CamposDeJuros, {
      modo,
      aoEscolherModo: setModo,
      taxa,
      aoDigitarTaxa: setTaxa,
      total,
      aoDigitarTotal: setTotal,
      idPrefixo: props.idPrefixo,
    }),
    React.createElement(PreviaDoEmprestimo, { grandezas: previa })
  );
}

// --- utilitarios da sonda ---------------------------------------------------

const alvo = (id) => document.getElementById(id);

/**
 * Monta um formulario e devolve acessos ESCOPADOS nele.
 *
 * O escopo importa: \`data-grandeza="total"\` existe nas TRES arvores desta
 * pagina, e um \`document.querySelector\` devolveria o da primeira -- a sonda
 * mediria um caso reportando o nome de outro.
 */
const montar = (raiz, props) => {
  const caixa = alvo(raiz);
  ReactDOM.render(React.createElement(Formulario, props), caixa);

  return {
    caixa,
    /**
     * O valor de uma grandeza da previa, pela CHAVE e nao pelo rotulo: rotulo
     * e texto de produto e muda sem nada estar errado.
     */
    grandeza: (chave) => {
      const linha = caixa.querySelector("[data-grandeza='" + chave + "']");
      if (!linha) return null;
      const valor = linha.querySelector("[data-valor]");
      return valor ? valor.textContent : null;
    },
    /**
     * Digita num campo, como um dedo digitaria.
     *
     * O SETTER NATIVO E OBRIGATORIO: o React guarda o ultimo valor que ELE
     * escreveu e compara com o atual para decidir se houve mudanca. Atribuir
     * \`el.value\` direto atualiza esse cache tambem, e o \`onChange\` NAO dispara
     * -- a sonda passaria verde sem nunca ter chamado o handler.
     */
    digitar: (id, texto) => {
      const campo = caixa.querySelector("[id='" + id + "']");
      if (!campo) throw new Error("campo nao existe na arvore: " + id);
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    },
    /** Marca um radio -- o gesto do seletor de modo. */
    escolher: (id) => {
      const radio = caixa.querySelector("[id='" + id + "']");
      if (!radio) throw new Error("radio nao existe na arvore: " + id);
      radio.click();
    },
    existe: (id) => caixa.querySelector("[id='" + id + "']") !== null,
  };
};

const r = {};

// =============================================================================
// SENTIDO 1 -- 1000 + 20% tem de mostrar 1.200
// =============================================================================
const t = montar("raiz-taxa", {
  modoInicial: "sem_juros",
  emprestado: "1000.00",
  parcelas: 12,
  idPrefixo: "t_",
});

// ANTES do gesto: no modo sem juro, emprestado == total e a taxa e 0. E o
// terceiro ponto de comparacao, e sem ele "1.200 aparece" poderia ser um 1.200
// que ja estava la.
r.taxa_antes = {
  emprestado: t.grandeza("emprestado"),
  total: t.grandeza("total"),
  juros: t.grandeza("juros"),
  // O campo da taxa NAO existe no modo sem juro -- a tela nao oferece os dois.
  temCampoDaTaxa: t.existe("t_taxa"),
};

t.escolher("t_modo_taxa");
r.taxa_depois_do_modo = { temCampoDaTaxa: t.existe("t_taxa") };

t.digitar("t_taxa", "20");

r.taxa_depois = {
  emprestado: t.grandeza("emprestado"),
  juros: t.grandeza("juros"),
  total: t.grandeza("total"),
  taxa: t.grandeza("taxa"),
  parcela: t.grandeza("parcela"),
  // O campo do TOTAL nao existe neste modo: a F2 recusa os dois juntos, e a
  // tela honra isso nao oferecendo o outro.
  temCampoDoTotal: t.existe("t_total"),
};

// =============================================================================
// SENTIDO 2 -- 1000 + total 1.200 tem de mostrar 20%
// =============================================================================
const o = montar("raiz-total", {
  modoInicial: "sem_juros",
  emprestado: "1000.00",
  parcelas: 12,
  idPrefixo: "o_",
});

// O PONTO DE PARTIDA E LIDO ANTES DE TROCAR DE MODO, e a razao e um achado
// desta propria sonda: no modo \`total\` com o campo AINDA VAZIO nao ha previa
// nenhuma -- \`juroDoPedido\` devolve null, a serie e null e
// \`PreviaDoEmprestimo\` nao desenha nada. Lido depois do gesto de modo, o
// \`grandeza("taxa")\` voltava \`null\` e a assercao parecia um defeito de
// renderizacao. Esta ordem mede o que ela diz medir.
r.total_antes = { taxa: o.grandeza("taxa"), total: o.grandeza("total") };

o.escolher("o_modo_total");

// E A PREVIA SOME ENQUANTO O TOTAL NAO FOI DIGITADO -- correto, e afirmado:
// quatro grandezas calculadas sobre um total vazio seriam um emprestimo de
// valor zero exibido como se estivesse pronto.
r.total_sem_digitar = {
  temPrevia: o.caixa.querySelector("[data-previa]") !== null,
};

// O CAMPO DO TOTAL E MASCARADO (a convencao de \`lib/dinheiro.ts\`): ele MOSTRA
// "R$ 1.200,00" e EMITE "1200.00". A digitacao e por CENTAVOS -- os digitos
// entram pelos centavos e empurram os anteriores para a esquerda --, entao
// R$ 1.200,00 sao SEIS teclas: 1-2-0-0-0-0. Digitar "1200" daria R$ 12,00, e
// digitar "1200.00" com ponto daria dez vezes o valor
// (\`preencher-campo-de-valor-com-ponto-vira-dez-vezes\`).
//
// A mascara e total: toda sequencia de teclas tem uma saida canonica, entao
// mandar a string inteira de uma vez e equivalente a teclar digito a digito.
o.digitar("o_total", "120000");

r.total_depois = {
  emprestado: o.grandeza("emprestado"),
  juros: o.grandeza("juros"),
  total: o.grandeza("total"),
  taxa: o.grandeza("taxa"),
  parcela: o.grandeza("parcela"),
  temCampoDaTaxa: o.existe("o_taxa"),
  // O que o campo EXIBE, para provar que a mascara esta ligada: o estado
  // guarda "1200.00" e a pessoa le "R$ 1.200,00".
  exibicao: o.caixa.querySelector("[id='o_total']").value,
};

// =============================================================================
// CONTROLE NEGATIVO -- o total menor que o emprestado nao vira previa bonita
// =============================================================================
const n = montar("raiz-sem", {
  modoInicial: "sem_juros",
  emprestado: "1000.00",
  parcelas: 12,
  idPrefixo: "n_",
});

n.escolher("n_modo_total");
n.digitar("n_total", "90000"); // R$ 900,00 -- menos do que foi emprestado

r.recusa = {
  // \`juroDoPedido\` devolve null, \`valorQueMontaASerie\` devolve "", a serie e
  // null e a previa NAO e desenhada. A tela nao pode mostrar um emprestimo que
  // a rota vai recusar com 400.
  temPrevia: n.caixa.querySelector("[data-previa]") !== null,
};

alvo("resultado").textContent = "RESULTADO" + JSON.stringify(r) + "FIM";
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

  const dir = mkdtempSync(join(tmpdir(), "previa-emprestimo-"));
  const pagina = join(dir, "previa.html");
  writeFileSync(pagina, PAGINA);

  const dump = execFileSync(
    chromium,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--window-size=390,844", // iPhone: e onde este app roda instalado
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
    throw new Error(`a pagina nao carregou:\n${dump.slice(0, 1500)}`);
  }

  // O `--dump-dom` serializa o textContent como HTML. `&amp;` por ULTIMO,
  // senao `&amp;lt;` viraria `<`.
  const relato = achado[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

  if (relato.startsWith("ERRO NA PAGINA")) throw new Error(relato);

  const bruto = relato.match(/^RESULTADO(\{[\s\S]*\})FIM$/);
  if (!bruto) {
    throw new Error(`a pagina nao reportou resultado, e sim: ${relato}`);
  }
  resultado = JSON.parse(bruto[1]);
} catch (e) {
  erroDeExecucao = e;
}

// -----------------------------------------------------------------------------

test("o navegador rodou e reportou", () => {
  if (erroDeExecucao) throw erroDeExecucao;
  assert.ok(resultado, "sem resultado do navegador");
});

test("CONTROLE: sem juro, emprestado == total e nao ha campo de taxa", () => {
  // O ponto de partida. Sem ele, "1.200 apareceu" poderia ser um 1.200 que ja
  // estava na tela antes do gesto -- e a sonda nao mediria gesto nenhum.
  assert.equal(resultado.taxa_antes.emprestado, "R$ 1.000,00");
  assert.equal(resultado.taxa_antes.total, "R$ 1.000,00");
  assert.equal(resultado.taxa_antes.juros, "R$ 0,00");
  assert.equal(
    resultado.taxa_antes.temCampoDaTaxa,
    false,
    "o campo da taxa nao pode existir no modo sem juro"
  );
});

test("o seletor de modo FAZ o campo da taxa aparecer (o handler esta ligado)", () => {
  assert.equal(resultado.taxa_depois_do_modo.temCampoDaTaxa, true);
});

test("SENTIDO 1 -- digitar 1000 + 20% mostra 1.200 na tela", () => {
  // O pedido literal da issue, metade um.
  assert.equal(resultado.taxa_depois.emprestado, "R$ 1.000,00");
  assert.equal(
    resultado.taxa_depois.total,
    "R$ 1.200,00",
    "digitar 20% tem de mostrar o total de R$ 1.200,00"
  );
  assert.equal(resultado.taxa_depois.juros, "R$ 200,00");
  assert.equal(resultado.taxa_depois.taxa, "20,00%");

  // E A PARCELA, que e a quarta grandeza: 12x de R$ 100. Ela sai da SERIE, e e
  // ela que prova que a serie foi montada sobre o TOTAL -- sobre o principal, a
  // parcela seria R$ 83,33.
  assert.equal(
    resultado.taxa_depois.parcela,
    "R$ 100,00",
    "12x de R$ 1.200 e R$ 100; se a serie saisse do principal seria R$ 83,33"
  );

  // A F2 recusa taxa e total juntos, e a tela honra isso NAO OFERECENDO o
  // outro campo -- esconder com CSS deixaria o estado preenchido e os dois
  // viajariam no corpo do POST.
  assert.equal(resultado.taxa_depois.temCampoDoTotal, false);
});

test("SENTIDO 2 -- digitar 1000 + total 1.200 mostra 20%", () => {
  // O pedido literal da issue, metade dois: "se eu colocar valor total vejo
  // quanto de juros estou cobrando".
  assert.equal(
    resultado.total_antes.taxa,
    "0,00%",
    "no modo sem juro, a taxa de partida e zero"
  );
  assert.equal(resultado.total_antes.total, "R$ 1.000,00");

  // E ENQUANTO O TOTAL NAO FOI DIGITADO A PREVIA NAO EXISTE -- e e isso que
  // torna o "20,00%" abaixo um resultado do GESTO, e nao um numero que estava
  // na tela desde o comeco.
  assert.equal(resultado.total_sem_digitar.temPrevia, false);

  assert.equal(
    resultado.total_depois.taxa,
    "20,00%",
    "digitar o total de R$ 1.200 tem de mostrar que estou cobrando 20%"
  );
  assert.equal(resultado.total_depois.juros, "R$ 200,00");
  assert.equal(resultado.total_depois.emprestado, "R$ 1.000,00");
  assert.equal(resultado.total_depois.total, "R$ 1.200,00");
  assert.equal(resultado.total_depois.parcela, "R$ 100,00");
  assert.equal(resultado.total_depois.temCampoDaTaxa, false);
});

test("o campo do total e MASCARADO: seis teclas viram R$ 1.200,00", () => {
  // A convencao de `lib/dinheiro.ts`, e ela e dinheiro de verdade: o campo
  // mostra "R$ 1.200,00" e emite "1200.00", porque `parseFloat("1.200,00")` e
  // 1 -- mil e duzentos reais entrariam como um real, sem erro no caminho.
  assert.match(resultado.total_depois.exibicao, /R\$\s*1\.200,00/);
});

test("CONTROLE NEGATIVO: total menor que o emprestado NAO desenha previa", () => {
  // A tela nao pode mostrar um emprestimo bonito que a rota vai recusar com
  // 400 -- e um `?? 0` em qualquer ponto da cadeia faria exatamente isso,
  // exibindo um juro negativo com as quatro grandezas fechando.
  assert.equal(resultado.recusa.temPrevia, false);
});
