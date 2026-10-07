#!/usr/bin/env node
// Quebra o build quando um runner de mutante NOVO muta no lugar um arquivo
// RASTREADO pelo git -- o jeito de deixar um mutante gravado em `lib/`.
//
// POR QUE ISTO EXISTE (HMO-327)
// -----------------------------
// Um runner que muta a fonte, roda a suite e restaura no fim deixa o mutante no
// disco quando morre no meio. Dali em diante TODA medicao le o arquivo errado,
// e nada no placar diz isso. Aconteceu tres vezes neste repositorio: duas no
// mesmo run da HMO-322 (`lib/crivos.ts` mutado, restaurado, e mutado DE NOVO
// vinte minutos depois por um runner orfao que seguia em laco `mutar -> testar
// -> restaurar`), e uma num run anterior, que deixou stash no workspace
// compartilhado com o nome "crivos orfao (run morto ~17:10)".
//
// O custo e pior que um teste vermelho. O mutante que ficou aplicado era:
//
//     -  const razao = linha ? numeroOuNulo(linha[crivo.campo]) : null;
//     -  if (razao === null) {
//     +  const razao = linha ? numeroOuNulo(linha[crivo.campo]) ?? 0 : 0;
//     +  if (false) {
//
// Um `if (false)` em `lib/crivos.ts` desliga a guarda de dado ausente e faz
// crivo sem dado virar APROVACAO. Verde, e errado.
//
// POR QUE A REGRA NAO E "INSTALE UM HANDLER DE SIGTERM"
// ----------------------------------------------------
// Era o remedio obvio, e esta MEDIDO que nao funciona nestes runners. O laco
// deles e sincrono (`execSync` por mutante), e um handler de sinal em JS so roda
// quando o event loop recebe o controle -- o que num script sincrono nunca
// acontece. Medicao, com `node` e `kill -TERM` de verdade:
//
//     [0ms]    entra no execSync bloqueante (6s)
//     >>> kill -TERM em ~1000ms
//     [6012ms] execSync voltou
//     [9026ms] fim do script sincrono
//     [9027ms] exit handler        <-- o handler de SIGTERM NUNCA rodou
//     exit code: 0
//
// O handler nao restaura nada E ainda ENGOLE o sinal: sem ele o processo morre
// na hora (arvore suja, mas morto); com ele o processo sobrevive ao SIGTERM e
// segue mutando. Isto e exatamente o runner orfao da HMO-322, cujo laco faz
// `git status` PISCAR -- ora limpo, ora sujo -- e por isso uma leitura isolada
// de `git status` nao prova nada. Instalar o handler teria piorado o defeito
// enquanto parecia conserta-lo.
//
// O unico remedio que vale e nao mutar a arvore: mutar uma COPIA em diretorio
// temporario. Sobrevive a SIGTERM e tambem a SIGKILL, que handler nenhum pega.
// `criarBlocoDeMutantes` (scripts/mutantes-em-bloco.mjs) ja da esse aparelho
// pronto, e e para onde a HMO-319/HMO-335 estao levando os runners de todo
// jeito -- por tempo de CI. Ver tambem o cabecalho de
// `mutantes-guarda-dos-mutantes.mjs`: ele roda inteiro numa copia em /tmp, e por
// isso nao tem `trap` nem nada para restaurar.
//
// O QUE ESTA GUARDA DECIDE, E O QUE ELA NAO DECIDE
// -----------------------------------------------
// Ela acha o caso REAL: uma primitiva de escrita cujo alvo e um caminho
// rastreado pelo git, direto (`writeFileSync(ALVO, ...)` com
// `const ALVO = "lib/x.ts"`) ou pelas tres indirecoes que a arvore usa -- o
// `Map`/objeto de originais iterado para dentro da escrita
// (`for (const [alvo, original] of fontes) writeFileSync(alvo, original)`), a
// propriedade do mutante com caminho cru (`writeFileSync(m.alvo, ...)`) e o
// caminho EMBRULHADO (`writeFileSync(join(RAIZ, ALVO), ...)`, onde olhar so o
// identificador da raiz veria `join` e absolveria).
//
// Absolve quem escreve em raiz temporaria, transitivamente: `const dir =
// mkdtempSync(...)` e `const dirLib = join(dir, "lib")` valem os dois. Sem
// exigir `const` na frente -- `mutantes-guarda-dos-mutantes.mjs` declara
// `let sandbox = null` no topo e so ATRIBUI o `mkdtempSync` dentro da funcao,
// e exigir a declaracao junto dava falso positivo justamente nele.
//
// Ela NAO e um rastreador de fluxo de dados. Um runner que esconda a escrita
// atras de mais camadas de indirecao passa -- e isso e deliberado: o alvo aqui e
// o padrao que os sete runners de hoje usam e que um runner novo copiaria, nao
// um adversario. Em troca, zero falso positivo, que e o que faz guarda textual
// sobreviver: os onze runners que escrevem so em /tmp passam sem declaracao
// nenhuma, e passam pelo CODIGO, nao por lista a mao.
//
// LER VIA NODE, SEM COMENTARIO, E SEM `grep`
// ------------------------------------------
// A analise roda sobre o fonte com comentario e string removidos. Sem isso a
// guarda seria vacua nos dois sentidos, e os dois casos existem na arvore:
// `mutantes-pagador-da-parte.mjs` AVISA no cabecalho que "MUTA OS ARQUIVOS NO
// DISCO" (prosa casaria com a deteccao), e `mutantes-moeda.mjs` cita "SIGTERM"
// tres vezes, todas em comentario que explica o problema.
//
// E via Node, nunca `grep`: `mutantes-guarda-dos-mutantes.mjs` tem byte NUL no
// meio, e `grep` o trata como binario e devolve ZERO linha sem `-a`. Uma guarda
// em shell daria por limpo justamente o arquivo que serve de referencia.

import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const DIR = join(RAIZ, "scripts");

/**
 * Runners que HOJE mutam a arvore no lugar, com o motivo escrito. A guarda
 * existe para impedir o PROXIMO, nao para fingir que estes nao existem --
 * migrar os sete para `criarBlocoDeMutantes` e trabalho de outra issue
 * (HMO-337), e uma guarda que reprovasse a main inteira seria desligada antes
 * de pegar o primeiro runner novo.
 *
 * Esta lista so pode ENCOLHER. Nao e lista de excecao permanente: cada entrada
 * e divida registrada, e o `mutantes-guarda-de-mutacao-no-lugar.mjs` tem um
 * mutante que prova que acrescentar nome aqui nao escapa da medicao.
 */
export const DIVIDA_CONHECIDA = new Map([
  ["mutantes-divisao-configurada.mjs", "HMO-337: muta lib/divisao-configurada.ts no lugar"],
  ["mutantes-divisao-do-grupo.mjs", "HMO-337: muta lib/divisao-do-grupo.ts no lugar"],
  ["mutantes-lancamentos-completos.mjs", "HMO-337: muta dois arquivos de lib/ no lugar"],
  ["mutantes-pagador-da-parte.mjs", "HMO-337: muta lib/ e components/ no lugar"],
  ["mutantes-parte-do-grupo.mjs", "HMO-337: muta lib/parte-do-grupo.ts no lugar"],
  ["mutantes-transferencia.mjs", "HMO-337: muta lib/transferencia.ts no lugar"],
  ["mutantes-transferencia-recorrente-app.mjs", "HMO-337: muta dois arquivos de lib/ no lugar"],
]);

/**
 * Primitivas de escrita, e em que argumento mora o ALVO (0-indexado).
 * `renameSync` entra porque mover a fonte para o `.bak` e o passo exato que
 * deixou `lib/crivos.ts` mutado; `readFileSync` nao entra porque ler nao suja.
 */
const ESCRITAS = [
  { nome: "writeFileSync", alvo: 0 },
  { nome: "writeFile", alvo: 0 },
  { nome: "appendFileSync", alvo: 0 },
  { nome: "appendFile", alvo: 0 },
  { nome: "cpSync", alvo: 1 },
  { nome: "copyFileSync", alvo: 1 },
  { nome: "renameSync", alvo: 1 },
];

/**
 * Remove comentario e literal de string, trocando cada byte retirado por espaco
 * para que o numero de linha relatado seja o do arquivo de verdade.
 *
 * Literal de regex nao e tratado (distinguir `/.../` de divisao exige parser).
 * Nenhum runner da arvore tem regex com `//` dentro; se tivesse, o resto da
 * linha viraria comentario e a guarda deixaria de ver uma escrita ALI. E o unico
 * jeito conhecido de escapar sem ser notado, e esta escrito aqui de proposito --
 * o mutante `comentario_conta_como_codigo` cobre o lado oposto (ler comentario
 * como codigo), que e o que daria falso positivo.
 */
export function semComentariosNemStrings(fonte) {
  const saida = Array.from(fonte);
  const apagar = (i) => {
    if (saida[i] !== "\n") saida[i] = " ";
  };
  let i = 0;
  while (i < fonte.length) {
    const c = fonte[i];
    const d = fonte[i + 1];
    if (c === "/" && d === "/") {
      while (i < fonte.length && fonte[i] !== "\n") apagar(i++);
      continue;
    }
    if (c === "/" && d === "*") {
      apagar(i++);
      apagar(i++);
      while (i < fonte.length && !(fonte[i] === "*" && fonte[i + 1] === "/")) apagar(i++);
      apagar(i++);
      apagar(i++);
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const abre = c;
      apagar(i++);
      while (i < fonte.length) {
        if (fonte[i] === "\\") {
          apagar(i++);
          apagar(i++);
          continue;
        }
        if (fonte[i] === abre) break;
        apagar(i++);
      }
      apagar(i++);
      continue;
    }
    i++;
  }
  return saida.join("");
}

/** Mesma remocao, mas devolvendo o fonte com as STRINGS preservadas. */
function semComentarios(fonte) {
  const marcado = semComentariosNemStrings(fonte);
  // Onde `marcado` virou espaco mas o original tinha aspas, era string: devolve.
  // Onde virou espaco sem aspas por perto, era comentario: fica espaco.
  const saida = Array.from(fonte);
  let dentroDeString = false;
  for (let i = 0; i < fonte.length; i++) {
    const c = fonte[i];
    if (c === '"' || c === "'" || c === "`") {
      if (marcado[i] === " ") dentroDeString = !dentroDeString;
      continue;
    }
    if (marcado[i] === " " && c !== " " && c !== "\n" && !dentroDeString) saida[i] = " ";
  }
  return saida.join("");
}

/** Caminhos rastreados pelo git, como conjunto de strings relativas a raiz. */
export function arquivosRastreados(raiz = RAIZ) {
  const saida = execFileSync("git", ["ls-files"], { cwd: raiz, encoding: "utf8" });
  return new Set(saida.split("\n").filter(Boolean));
}

/**
 * Identificadores ligados a um caminho RASTREADO, pelas formas que a arvore usa:
 *
 *   const ALVO = "lib/x.ts";                         -> ALVO
 *   const fontes = new Map([[ALVO, readFileSync..]]) -> fontes, e o `alvo` de
 *                                                       `for (const [alvo, _] of fontes)`
 *   const originais = { [ALVO]: readFileSync(..) }   -> originais, e o `arquivo`
 *                                                       de `Object.entries(originais)`
 *   { alvo: ALVO, de: .., para: .. }                 -> a propriedade `.alvo`
 */
export function identificadoresDeArquivoRastreado(fonte, rastreados) {
  const codigo = semComentarios(fonte);
  const ligados = new Set();
  const propriedades = new Set();

  // const NOME = "<caminho rastreado>";
  for (const m of codigo.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["']([^"']+)["']/g)) {
    if (rastreados.has(m[2])) ligados.add(m[1]);
  }

  // Containers (Map/objeto) cujas CHAVES sao esses identificadores, e as
  // variaveis que um `for ... of <container>` / `Object.entries` desamarra.
  const nomesLigados = () => [...ligados].join("|");
  if (ligados.size > 0) {
    for (const m of codigo.matchAll(
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(new Map\(|\{|\[)([\s\S]{0,2000})/g
    )) {
      const corpo = m[3];
      if (new RegExp(`\\[?\\b(${nomesLigados()})\\b\\]?\\s*[,:\\]]`).test(corpo)) ligados.add(m[1]);
    }
  }

  // { alvo: "lib/x.ts", ... } -- o caminho CRU na propriedade. Esta e a unica
  // peneira que pega esse idioma, e so ela: com uma const no meio
  // (`{ alvo: ALVO }`) o objeto literal ja vira container ligado pela regra de
  // cima, e a variavel do `for..of` sobre ele e desamarrada junto. Uma peneira
  // para `alvo: ALVO` existiu aqui e era CODIGO MORTO -- o mutante
  // `propriedade_ignorada` sobreviveu a ela por redundancia, e e por isso que
  // ela saiu.
  for (const m of codigo.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*["']([^"']+)["']/g)) {
    if (rastreados.has(m[2])) propriedades.add(m[1]);
  }

  // Desamarrar loops/destructuring sobre container ligado.
  let cresceu = true;
  while (cresceu) {
    cresceu = false;
    const alvos = nomesLigados();
    if (!alvos) break;
    const padroes = [
      new RegExp(`for\\s*\\(\\s*(?:const|let|var)\\s*\\[\\s*([A-Za-z_$][\\w$]*)[^\\]]*\\]\\s*of\\s*(?:Object\\.entries\\(\\s*)?(${alvos})\\b`, "g"),
      new RegExp(`for\\s*\\(\\s*(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s+of\\s*(?:Object\\.keys\\(\\s*)?(${alvos})\\b`, "g"),
    ];
    for (const re of padroes) {
      for (const m of codigo.matchAll(re)) {
        if (!ligados.has(m[1])) {
          ligados.add(m[1]);
          cresceu = true;
        }
      }
    }
  }

  return { ligados, propriedades };
}

/**
 * Identificadores enraizados em diretorio TEMPORARIO, transitivamente:
 *
 *   const dir = mkdtempSync(join(tmpdir(), "x-"));   -> dir
 *   const dirLib = join(dir, "lib");                 -> dirLib
 *
 * Servem de absolvicao: uma escrita que cita um deles vai para /tmp, nao para a
 * arvore. E o padrao dos onze runners seguros de hoje.
 */
export function raizesTemporarias(fonte) {
  const codigo = semComentarios(fonte);
  const temporarios = new Set();
  // Sem exigir `const`/`let`: `mutantes-guarda-dos-mutantes.mjs` declara
  // `let sandbox = null` no topo e so ATRIBUI o mkdtempSync dentro da funcao.
  // Exigir a declaracao junto dava falso positivo justamente nele.
  for (const m of codigo.matchAll(
    /([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*(?:mkdtempSync|tmpdir)\s*\()/g
  )) {
    temporarios.add(m[1]);
  }

  // A raiz temporaria tambem pode vir de uma FUNCAO que a monta:
  //
  //     let sandbox = null;
  //     function montar() { const dir = mkdtempSync(...); ...; return dir; }
  //     sandbox = montar();
  //
  // e o desenho de `mutantes-guarda-de-mutacao-no-lugar.mjs`. Sem isto, uma
  // escrita em `join(sandbox, GUARDA)` -- toda dentro de /tmp -- vira culpada,
  // porque `GUARDA` e um caminho rastreado. Entao: funcao cujo corpo monta
  // diretorio temporario e DEVOLVE algo contamina quem recebe o retorno dela.
  const fabricas = new Set();
  for (const m of codigo.matchAll(
    /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{([\s\S]{0,4000}?)\n\}/g
  )) {
    if (/mkdtempSync\s*\(/.test(m[2]) && /\breturn\b/.test(m[2])) fabricas.add(m[1]);
  }
  if (fabricas.size > 0) {
    const nomes = [...fabricas].join("|");
    for (const m of codigo.matchAll(new RegExp(`([A-Za-z_$][\\w$]*)\\s*=\\s*(?:await\\s+)?(?:${nomes})\\s*\\(`, "g"))) {
      temporarios.add(m[1]);
    }
  }
  let cresceu = true;
  while (cresceu) {
    cresceu = false;
    for (const m of codigo.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)) {
      if (temporarios.has(m[1])) continue;
      const nomes = [...m[2].matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0]);
      if (nomes.some((n) => temporarios.has(n))) {
        temporarios.add(m[1]);
        cresceu = true;
      }
    }
  }
  return temporarios;
}

/** Escritas cujo alvo e (ou carrega) um caminho rastreado. */
export function escritasNoLugar(fonte, rastreados) {
  const codigo = semComentarios(fonte);
  const { ligados, propriedades } = identificadoresDeArquivoRastreado(fonte, rastreados);
  const temporarios = raizesTemporarias(fonte);
  const achados = [];

  for (const { nome, alvo: posicao } of ESCRITAS) {
    const re = new RegExp(`\\b${nome}\\s*\\(`, "g");
    for (const m of codigo.matchAll(re)) {
      const args = argumentos(codigo, m.index + m[0].length);
      const expr = (args[posicao] ?? "").trim();
      if (!expr) continue;
      const raizDoAlvo = expr.match(/^([A-Za-z_$][\w$]*)/)?.[1];
      const prop = expr.match(/^[A-Za-z_$][\w$]*\s*\.\s*([A-Za-z_$][\w$]*)/)?.[1];
      const literal = expr.match(/^["']([^"']+)["']$/)?.[1];
      // O caminho rastreado tambem pode vir EMBRULHADO:
      // `writeFileSync(join(RAIZ, ALVO), ...)`. Olhar so o identificador da
      // raiz veria `join` e absolveria. Entao qualquer mencao a um nome ligado
      // ou a um literal rastreado DENTRO da expressao conta -- a nao ser que a
      // expressao tambem cite um diretorio temporario, que e como os onze
      // runners seguros escrevem (`join(dir, ...)`).
      const nomesNaExpr = [...expr.matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0]);
      const embrulhado =
        nomesNaExpr.some((n) => ligados.has(n)) ||
        [...expr.matchAll(/["']([^"']+)["']/g)].some((x) => rastreados.has(x[1]));
      const temRaizTemporaria = nomesNaExpr.some((n) => temporarios.has(n));
      const culpa =
        !temRaizTemporaria &&
        ((literal && rastreados.has(literal)) ||
          (raizDoAlvo && ligados.has(raizDoAlvo)) ||
          (prop && propriedades.has(prop)) ||
          embrulhado);
      if (culpa) {
        achados.push({
          linha: codigo.slice(0, m.index).split("\n").length,
          chamada: `${nome}(${expr}, ...)`,
        });
      }
    }
  }
  return achados;
}

/** Os argumentos de uma chamada, em texto, a partir do `(`. */
function argumentos(codigo, inicio) {
  let nivel = 0;
  let atual = "";
  const args = [];
  for (let i = inicio; i < codigo.length; i++) {
    const c = codigo[i];
    if ("([{".includes(c)) nivel++;
    if (")]}".includes(c)) {
      if (nivel === 0) break;
      nivel--;
    }
    if (c === "," && nivel === 0) {
      args.push(atual);
      atual = "";
      continue;
    }
    atual += c;
  }
  args.push(atual);
  return args;
}

export function auditar(dir = DIR, raiz = RAIZ) {
  const rastreados = arquivosRastreados(raiz);
  return readdirSync(dir)
    .filter((n) => /^mutantes-.*\.(mjs|sh)$/.test(n))
    .sort()
    .map((nome) => {
      const escritas = nome.endsWith(".sh")
        ? []
        : escritasNoLugar(readFileSync(join(dir, nome), "utf8"), rastreados);
      return {
        nome,
        escritas,
        declarado: DIVIDA_CONHECIDA.has(nome),
        culpado: escritas.length > 0 && !DIVIDA_CONHECIDA.has(nome),
      };
    });
}

function principal() {
  const relatorio = auditar();
  const culpados = relatorio.filter((r) => r.culpado);
  const noLugar = relatorio.filter((r) => r.escritas.length > 0);
  const divididaMorta = [...DIVIDA_CONHECIDA.keys()].filter(
    (n) => !relatorio.some((r) => r.nome === n && r.escritas.length > 0)
  );

  console.log(
    `${relatorio.length} runners de mutante; ${noLugar.length} mutam arquivo rastreado no lugar ` +
      `(${DIVIDA_CONHECIDA.size} declarados como divida da HMO-337).`
  );

  // Entrada de divida que nao corresponde mais a nada e lista apodrecendo: ou o
  // runner foi migrado (e a entrada tem de sair, para a lista so encolher) ou
  // foi apagado. Reprova, senao a lista vira folclore.
  if (divididaMorta.length > 0) {
    console.error(
      `\nFALHA: ${divididaMorta.length} entrada(s) de DIVIDA_CONHECIDA nao correspondem a ` +
        `nenhum runner que muta no lugar:\n` +
        divididaMorta.map((n) => `  ${n}`).join("\n") +
        `\n\nSe o runner foi migrado para /tmp ou apagado, TIRE o nome da lista.\n`
    );
    return 1;
  }

  if (culpados.length === 0) {
    console.log("OK: nenhum runner novo muta arquivo rastreado no lugar.");
    return 0;
  }

  console.error(
    `\nFALHA: ${culpados.length} runner(s) mutam no lugar um arquivo RASTREADO e nao estao declarados.\n` +
      `Morto por timeout ou cancelamento, um deles deixa o mutante GRAVADO na arvore --\n` +
      `e dali em diante toda medicao le o arquivo errado, sem nada no placar dizendo isso.\n`
  );
  for (const c of culpados) {
    console.error(`  ${c.nome}`);
    for (const e of c.escritas.slice(0, 3)) console.error(`      linha ${e.linha}: ${e.chamada}`);
    if (c.escritas.length > 3) console.error(`      (+${c.escritas.length - 3} outras)`);
  }
  console.error(
    `\nComo consertar: mute uma COPIA, nao a arvore.\n` +
      `\n  import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";\n` +
      `  const bloco = criarBlocoDeMutantes({ rotulo: "x", suites: ["test:x"] });\n` +
      `  process.on("exit", () => bloco.fechar());\n` +
      `\nA mutacao vai para uma sombra em /tmp e a arvore nunca e tocada -- veja\n` +
      `scripts/mutantes-moeda.mjs, que foi migrado por este motivo.\n` +
      `\nNAO resolve instalar \`process.on("SIGTERM", ...)\`: num runner de laco\n` +
      `sincrono o handler nunca roda (o event loop nao recebe o controle) e ainda\n` +
      `ENGOLE o sinal, deixando o runner vivo e mutando. Esta medido no cabecalho\n` +
      `deste arquivo.\n`
  );
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-mutacao-no-lugar.mjs")) {
  process.exit(principal());
}
