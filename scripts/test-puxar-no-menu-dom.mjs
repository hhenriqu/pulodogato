// A metade de DOM do puxar-para-atualizar, em navegador de verdade -- HMO-206.
//
// POR QUE ESTE TESTE EXISTE
// -------------------------
// scripts/test-puxar-para-atualizar.mjs prova a REGRA: dado um caminho de
// toque, quando o puxao vale. Ele nao prova a LEITURA -- que a lista do menu
// mobile e de fato reconhecida como area que rola sozinha. E a leitura era o
// bug: `window.scrollY` so descreve a pagina, e a pagina atras da gaveta esta
// sempre em 0, entao rolar a lista do menu era lido como puxao no topo.
//
// Essa metade depende de layout: `overflow-y` computado, `scrollHeight` contra
// `clientHeight`, e o encadeamento de `parentElement` ate o `body`. Nada disso
// existe fora de um navegador, entao aqui roda Chromium de verdade, e as
// assercoes chamam a FUNCAO DE PRODUCAO (lib/puxar-para-atualizar-dom.ts),
// nao uma copia dela.
//
// COMO O MODULO DE PRODUCAO CHEGA NA PAGINA
// -----------------------------------------
// Inline, num `<script>` CLASSICO. Tres caminhos mais limpos foram tentados
// antes e nenhum funciona neste ambiente:
//
//   - servidor HTTP local: o Chromium daqui nao alcanca 127.0.0.1, nem com
//     `--no-proxy-server` nem com `--proxy-bypass-list=*`;
//   - `import` entre arquivos `file://`: barrado pelo CORS mesmo com
//     `--allow-file-access-from-files`;
//   - `<script type="module">` inline: modulo e DEFERIDO, e o `--dump-dom`
//     fotografa o DOM antes de ele rodar -- a pagina saia sem resposta
//     nenhuma, do mesmo jeito que sairia se o codigo estivesse quebrado.
//
// Sobrou o script classico, e ele exige duas cirurgias de texto nos .js
// compilados: tirar a LINHA de `import` entre os dois e o prefixo `export `
// das declaracoes (ilegais fora de modulo). As duas mexem so na fiacao -- o
// corpo das funcoes vai intacto, que e o que mantem este teste falando do
// codigo de producao e nao de uma reescrita dele. Se alguma das duas deixar
// sobra, o teste para na hora em vez de seguir com codigo pela metade.
//
// O QUE ESTE TESTE ASSUME, E QUEM COBRE A FALTA
// ---------------------------------------------
// A pagina abaixo escreve em CSS o que as classes do Tailwind produzem
// (`overflow-y-auto` -> `overflow-y: auto`), porque montar o CSS do projeto
// exigiria o build inteiro. A ponte entre esta copia e o componente real e a
// ultima secao: ela le components/Sidebar.tsx e exige que a gaveta continue
// com as duas marcas que esta pagina assume.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SAIDA = ".tmp-puxar-dom";

/**
 * Acha um Chromium: o do `CHROMIUM_BIN`, o que o Playwright baixou, ou o
 * Chrome do sistema (o runner do Actions ja vem com um).
 *
 * Quando nao ha nenhum, este teste FALHA -- de proposito, e nao com `skip`.
 * Uma suite que se desliga sozinha quando falta o navegador e indistinguivel
 * de uma suite que passou, e a metade de DOM desta issue voltaria a nao ter
 * cobertura nenhuma sem ninguem notar.
 */
function acharChromium() {
  const candidatos = [process.env.CHROMIUM_BIN];

  const base = `${process.env.HOME}/.cache/ms-playwright`;
  for (const dir of ["chromium-1243", "chromium_headless_shell-1243"]) {
    for (const sufixo of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      candidatos.push(join(base, dir, sufixo));
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

// --- le o modulo de producao ja compilado ------------------------------------
//
// Quem compila e o script `test:puxar-no-menu-dom` do package.json, como nas
// outras suites do repositorio. Isso tambem e o que faz o `paths:` do CI
// enxergar os dois `lib/*.ts` como exercitados por esta suite -- a segunda
// peneira do check-tests-in-ci.mjs le os arquivos citados NO COMANDO.

if (!existsSync(join(SAIDA, "puxar-para-atualizar-dom.js"))) {
  throw new Error(
    `${SAIDA}/ nao existe. Rode por \`npm run test:puxar-no-menu-dom\`, ` +
      "que e quem compila os dois modulos antes do teste."
  );
}

/** Tira so a fiacao de modulo, deixando o corpo das funcoes intacto. */
const paraScriptClassico = (fonte) =>
  fonte
    .replace(/^import .* from "\.\/puxar-para-atualizar";$/m, "")
    .replace(/^export /gm, "");

const regra = paraScriptClassico(
  readFileSync(join(SAIDA, "puxar-para-atualizar.js"), "utf8")
);
const leitura = paraScriptClassico(
  readFileSync(join(SAIDA, "puxar-para-atualizar-dom.js"), "utf8")
);

// Sobra de `import`/`export` e erro de sintaxe dentro da pagina, e o sintoma
// disso e a pagina nao reportar NADA -- indistinguivel de codigo quebrado.
// Melhor estourar aqui, dizendo o que aconteceu.
for (const [nome, fonte] of [
  ["regra", regra],
  ["leitura", leitura],
]) {
  const sobra = fonte.match(/^\s*(import|export)\s.*$/m);
  if (sobra) {
    throw new Error(
      `sobrou fiacao de modulo em ${nome}: ${sobra[0].trim()}\n` +
        "ajuste paraScriptClassico()"
    );
  }
}

// --- a pagina: a gaveta do menu como o Sidebar a monta -----------------------

const paginaCom = (cssExtra) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { height: 3000px; }           /* a PAGINA rola: o caso que deve puxar */
  ${cssExtra}
  .wrap   { position: fixed; inset: 0; display: flex; z-index: 40; }
  .fechado{ pointer-events: none; }
  .aberto { pointer-events: auto; }
  .veu    { position: fixed; inset: 0; background: rgba(0,0,0,.6); }
  .painel { position: relative; flex: 1 1 0%; display: flex;
            flex-direction: column; max-width: 20rem; width: 100%; }
  .lista  { flex: 1 1 0%; height: 0; overflow-y: auto; } /* flex-1 h-0 overflow-y-auto */
  .item   { display: block; padding: .5rem .75rem; }
  .rodape { flex-shrink: 0; padding: 1rem; }
  .caixa-folgada { overflow-y: auto; height: 400px; }
  .caixa-cheia   { overflow-y: auto; height: 100px; }
  /* Transborda, mas com overflow VISIBLE: nao rola, logo nao segura nada. */
  .caixa-visivel { overflow: visible; height: 100px; }
  .conteudo-alto { height: 2000px; }
</style></head><body>

<main id="pagina"><p id="texto-da-pagina">conteudo</p></main>

<!-- conteudo que transborda uma caixa de overflow visible: a caixa nao rola,
     entao tocar aqui dentro tem que continuar puxando -->
<div class="caixa-visivel"><div class="conteudo-alto"><p id="dentro-da-visivel">x</p></div></div>

<!-- overflow-y-auto que NAO transborda: tem que continuar puxando -->
<div class="caixa-folgada"><p id="dentro-da-folgada">cabe</p></div>

<!-- overflow-y-auto que transborda, fora do menu (modal, tabela alta) -->
<div class="caixa-cheia"><div class="conteudo-alto"><p id="dentro-da-cheia">x</p></div></div>

<!-- A gaveta, aberta -->
<div class="wrap aberto" data-sem-puxar-para-atualizar id="gaveta">
  <div class="veu" id="veu"></div>
  <div class="painel" id="menu-mobile">
    <button id="fechar">X</button>
    <div class="lista" id="lista">
      <nav id="nav">${Array.from(
        { length: 24 },
        (_, i) => `<a class="item" id="item-${i}" href="#">Item ${i}</a>`
      ).join("")}</nav>
    </div>
    <div class="rodape"><button id="sair">Sair</button></div>
  </div>
</div>

<div id="resultado">a pagina nao rodou</div>
<script>
try {
${regra}
${leitura}

const alvo = (id) => document.getElementById(id);
const r = {};

// A lista do menu precisa REALMENTE transbordar, senao o caso principal deste
// teste estaria sendo provado por engano -- seria o marcador sozinho
// segurando, e a leitura de overflow ficaria sem prova nenhuma.
const lista = alvo("lista");
r.listaTransborda = lista.scrollHeight > lista.clientHeight;
r.listaOverflowY = getComputedStyle(lista).overflowY;

r.itemDoMenu   = toqueComecouNaPagina(alvo("item-0"));
r.rodapeDoMenu = toqueComecouNaPagina(alvo("sair"));
r.xDoMenu      = toqueComecouNaPagina(alvo("fechar"));
r.veu          = toqueComecouNaPagina(alvo("veu"));
r.paginaNormal = toqueComecouNaPagina(alvo("texto-da-pagina"));
r.caixaFolgada = toqueComecouNaPagina(alvo("dentro-da-folgada"));
r.caixaCheia   = toqueComecouNaPagina(alvo("dentro-da-cheia"));
r.caixaVisivel = toqueComecouNaPagina(alvo("dentro-da-visivel"));
r.alvoNulo     = toqueComecouNaPagina(null);

// A premissa do caso acima: a caixa de overflow visible REALMENTE transborda.
// Sem conferir, "deixa puxar" poderia estar passando porque nao ha transbordo.
const visivel = document.querySelector(".caixa-visivel");
r.visivelTransborda = visivel.scrollHeight > visivel.clientHeight;
r.visivelOverflowY  = getComputedStyle(visivel).overflowY;

// O caminho do item do menu tem que acusar as DUAS coisas, nao uma so.
const caminho = lerCaminhoDoToque(alvo("item-0"));
r.caminhoTemCaixaQueRola = caminho.some((a) => a.rolaOProprioConteudo);
r.caminhoTemMarcador     = caminho.some((a) => a.dispensaOPuxao);

// Com a gaveta FECHADA, o dedo no mesmo ponto acerta a pagina: o
// pointer-events:none tira a subarvore inteira do teste de toque. Por isso a
// leitura usa elementFromPoint, que respeita pointer-events como o dedo faz.
alvo("gaveta").className = "wrap fechado";
const noPonto = document.elementFromPoint(40, 300);
r.fechadoNaoPegaAGaveta = !alvo("gaveta").contains(noPonto);
r.fechadoDeixaPuxar = toqueComecouNaPagina(noPonto);

alvo("resultado").textContent = "RESULTADO" + JSON.stringify(r) + "FIM";
} catch (e) {
  // Sem isto, um erro aqui dentro vira "a pagina nao reportou nada" e o
  // motivo real fica dentro do navegador, invisivel.
  document.getElementById("resultado").textContent =
    "ERRO NA PAGINA: " + (e && e.message);
}
</script></body></html>`;

// --- roda o navegador --------------------------------------------------------

const chromium = acharChromium();

/** Roda uma variante da pagina no navegador e devolve o relato dela. */
function rodar(nome, cssExtra) {
  if (!chromium) throw new Error(SEM_NAVEGADOR);

  const dir = mkdtempSync(join(tmpdir(), "puxar-dom-"));
  const pagina = join(dir, `${nome}.html`);
  writeFileSync(pagina, paginaCom(cssExtra));

  const dump = execFileSync(
    chromium,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--window-size=390,844", // iPhone: a lista do menu tem que transbordar
      "--dump-dom",
      `file://${pagina}`,
    ],
    {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"], // o Chromium enche a stderr de dbus
    }
  );

  // A leitura e ancorada na DIV, nao no dump solto: o `--dump-dom` devolve
  // tambem o FONTE do script, e procurar os marcadores no dump inteiro acha a
  // string literal do proprio codigo -- um falso positivo que se disfarca
  // perfeitamente de erro de pagina.
  const divs = dump.match(/id="resultado">([^<]*)</);
  if (!divs) {
    throw new Error(`a pagina nao carregou:\n${dump.slice(0, 1200)}`);
  }

  const relato = divs[1];
  if (relato.startsWith("ERRO NA PAGINA")) throw new Error(relato);

  const bruto = relato.match(/^RESULTADO(\{.*\})FIM$/);
  if (!bruto) {
    throw new Error(`a pagina nao reportou resultado, e sim: ${relato}`);
  }
  return JSON.parse(bruto[1]);
}

let resultado = null;
let comRaizRolavel = null;
let erroDeExecucao = null;

try {
  resultado = rodar("padrao", "");

  // SEGUNDA VARIANTE: `overflow-y: auto` na RAIZ.
  //
  // Hoje o app nao poe overflow em html/body -- conferido em app/globals.css
  // --, entao a parada da leitura em `body` e defensiva. Ela fica porque o
  // dia em que alguem puser (um layout de altura fixa, um `overscroll`
  // qualquer) a raiz passaria a contar como "area que rola sozinha" e o
  // puxao morreria no app INTEIRO, calado. Esta variante e o que prova que a
  // parada funciona, em vez de so afirmar isso num comentario.
  comRaizRolavel = rodar("raiz-rolavel", "html, body { overflow-y: auto; }");
} catch (e) {
  erroDeExecucao = e;
}

// ---------------------------------------------------------------------------

test("o navegador rodou e reportou", () => {
  if (erroDeExecucao) throw erroDeExecucao;
  assert.ok(resultado, "sem resultado do navegador");
});

test("a lista do menu de fato transborda (premissa do teste)", () => {
  // Se ela nao transbordasse, o caso principal passaria por engano: seria o
  // marcador sozinho segurando, e a leitura de overflow ficaria sem prova.
  assert.equal(resultado.listaOverflowY, "auto");
  assert.equal(
    resultado.listaTransborda,
    true,
    "a lista precisa ter mais conteudo que caixa para o teste valer"
  );
});

test("tocar um item do menu NAO e toque de pagina", () => {
  // O caso da issue: rolar a lista do menu recarregava o app.
  assert.equal(resultado.itemDoMenu, false);
});

test("o caminho acusa a caixa que rola E o marcador", () => {
  // As duas travas tem que estar valendo de verdade no caso real; se so uma
  // estivesse, a outra seria codigo morto se passando por protecao.
  assert.equal(resultado.caminhoTemCaixaQueRola, true);
  assert.equal(resultado.caminhoTemMarcador, true);
});

test("o resto da gaveta tambem nao puxa", () => {
  // Rodape, X e veu ficam FORA da lista que rola: so o marcador os cobre.
  assert.equal(resultado.rodapeDoMenu, false);
  assert.equal(resultado.xDoMenu, false);
  assert.equal(resultado.veu, false);
});

test("a pagina normal continua puxando", () => {
  // CONTROLE POSITIVO, e o mais importante daqui: o body desta pagina tem
  // 3000px e rola. Se a leitura subisse ate o html/body, TODA tela alta do app
  // viraria "area que rola sozinha" e o puxao morreria no app inteiro.
  assert.equal(resultado.paginaNormal, true);
  assert.equal(resultado.alvoNulo, true);
});

test("overflow-y-auto que nao transborda deixa puxar", () => {
  // Varias telas envolvem tabela num `overflow-y-auto` que raramente
  // transborda; sem o "tem conteudo sobrando" o puxao morreria nelas.
  assert.equal(resultado.caixaFolgada, true);
});

test("overflow-y-auto que transborda segura, mesmo fora do menu", () => {
  assert.equal(resultado.caixaCheia, false);
});

test("caixa que transborda SEM rolar deixa puxar", () => {
  // `overflow: visible` que transborda nao rola nada -- e a forma mais comum
  // de caixa no app. Se a leitura aceitasse qualquer overflow, e nao so os
  // que rolam, o puxao morreria em quase toda tela.
  assert.equal(resultado.visivelOverflowY, "visible");
  assert.equal(
    resultado.visivelTransborda,
    true,
    "a caixa precisa transbordar para o caso valer"
  );
  assert.equal(resultado.caixaVisivel, true);
});

test("com overflow-y na RAIZ, a pagina ainda puxa", () => {
  // A leitura para em body/html. Sem essa parada, uma regra de CSS global
  // transformaria a raiz em "area que rola sozinha" e desligaria o gesto no
  // app inteiro -- sem erro, sem teste vermelho, so a feature sumindo.
  assert.equal(comRaizRolavel.paginaNormal, true);
  assert.equal(comRaizRolavel.caixaFolgada, true);
  // E o menu continua travado nessa variante, nao e um "tudo liberado".
  assert.equal(comRaizRolavel.itemDoMenu, false);
  assert.equal(comRaizRolavel.rodapeDoMenu, false);
});

test("com a gaveta fechada o puxao volta a valer", () => {
  // A gaveta fica montada o tempo todo. Se o marcador valesse com ela fechada,
  // esta issue teria DESLIGADO o puxar-para-atualizar do app inteiro.
  assert.equal(
    resultado.fechadoNaoPegaAGaveta,
    true,
    "fechada, a gaveta nao pode receber o toque"
  );
  assert.equal(resultado.fechadoDeixaPuxar, true);
});

// ---------------------------------------------------------------------------
// A PONTE COM O COMPONENTE REAL
// ---------------------------------------------------------------------------
// A pagina acima e uma copia da marcacao. Estas assercoes sao o que impede a
// copia de virar ficcao: se a gaveta perder qualquer uma das duas marcas, o
// teste de cima continuaria verde sobre uma pagina que nao representa mais
// nada, e so o celular do usuario contaria a verdade.

test("o Sidebar continua marcando a gaveta e rolando a lista", () => {
  const fonte = readFileSync("components/Sidebar.tsx", "utf8");
  assert.match(
    fonte,
    /\{\.\.\.propsSemPuxao\(\)\}/,
    "a raiz da gaveta perdeu o marcador propsSemPuxao()"
  );
  assert.match(
    fonte,
    /flex-1 h-0[^"]*overflow-y-auto/,
    "a lista do menu perdeu o overflow-y-auto que este teste assume"
  );
});

test("o componente pergunta a leitura no touchstart", () => {
  // A terceira ponta: regra provada, leitura provada, e o componente de fato
  // LIGANDO uma na outra. Sem esta, as duas metades poderiam estar corretas e
  // ninguem as chamando -- verde dos dois lados, bug intacto no celular.
  const fonte = readFileSync("components/PuxarParaAtualizar.tsx", "utf8");
  assert.match(fonte, /toqueComecouNaPagina\(e\.target\)/);
  assert.match(fonte, /toqueNaPagina: toqueNaPagina\.current/);
});
