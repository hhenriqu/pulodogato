#!/usr/bin/env node
// =====================================================
// PULODOGATO - uma compilacao compartilhada para as suites
// =====================================================
//   node scripts/compila.mjs --todas                       (modo lote, no CI)
//   node scripts/compila.mjs -p scripts/tsconfig.x-test.json   (um alvo)
//   node scripts/compila.mjs lib/x.ts --outDir .tmp-x --module es2020 ...
//
// POR QUE ISTO EXISTE (HMO-263)
// -----------------------------
// Os alvos `test:*` disparavam uma invocacao de `tsc` por suite -- 98 hoje.
// Cada uma pagava a partida do compilador e, principalmente, o reparse dos
// MESMOS arquivos de lib/: 573 arquivos distintos lidos 18.368 vezes no total.
//
// Em um processo unico, com o AST de cada arquivo lido uma vez e reaproveitado
// entre os 98 programas, os mesmos 98 alvos compilam em ~28s contra 209s das
// 98 invocacoes separadas. A saida foi comparada byte a byte: 98 diretorios,
// 470 arquivos emitidos, zero diferencas, zero faltando, zero a mais.
//
// ONDE ISTO **NAO** AJUDA, E POR QUE
// ----------------------------------
// O ganho e do LOTE, e o lote so existe onde ha muitos alvos num processo. Os
// blocos de controle negativo rodam a suite numa COPIA da arvore, uma vez por
// mutante: um alvo, um processo, nada a compartilhar. La o caminho em processo
// era 20% MAIS LENTO que o `tsc` -- travessia sem lote para pagar a conta. Por
// isso o alvo frio e sozinho e delegado ao `tsc`; ver `compilarComTsc`.
//
// O QUE **NAO** FOI FEITO, DE PROPOSITO
// -------------------------------------
// Nao existe um tsconfig unico com a uniao dos `include`. Varios dos
// tsconfig.*-test.json sao estreitos de PROPOSITO: existem para provar que um
// modulo compila SEM um certo import. Unir os `include` destruiria exatamente
// essa prova, e o sintoma seria uma suite verde que nao afirma mais nada.
//
// Aqui cada alvo continua sendo seu PROPRIO programa, com o seu proprio
// tsconfig, os seus proprios rootNames e o seu proprio outDir. O unico
// compartilhamento e o cache de arquivos-fonte JA PARSEADOS, que e neutro em
// relacao ao grafo de modulos de cada programa: um arquivo que o alvo nao
// importa nao entra no programa dele so por estar no cache.
//
// COMO O MUTANTE CONTINUA MORRENDO (o requisito mais delicado)
// ------------------------------------------------------------
// Os controles negativos mutam um arquivo de producao e exigem que a suite
// REPROVE. Um cache que devolvesse o artefato velho faria o mutante "morrer
// verde" -- o rotulo dizendo que matou, sem ter compilado a mutacao. Isso ja
// aconteceu neste repositorio (um `.tmp-*` compilado guardou o mutante depois
// do restore da fonte).
//
// Por isso o reaproveitamento aqui e por CONTEUDO, nao por data: o manifesto
// guarda o sha256 de cada arquivo de entrada do programa. Mutar um arquivo
// muda o hash dele, o manifesto deixa de casar, e o alvo recompila de verdade
// -- nao ha janela em que a mutacao seja ignorada. E o caminho inverso vale
// igual: quando a fonte volta ao original, o hash deixa de casar com o
// manifesto que o mutante escreveu, e o alvo recompila outra vez. Isto e mais
// forte que o `rm -rf .tmp-x` de antes, que dependia de o comando estar certo.
//
// E ha uma segunda trava, independente desta: manifesto so nasce de quem
// semeia (o lote, e o `--semeia`). Na copia da arvore de um mutante nunca ha
// manifesto, entao nem a decisao de reaproveitar e tomada ali -- compila-se
// sempre. As duas travas protegem o mesmo mutante por caminhos diferentes.
//
// Mudanca de dependencia (os .d.ts de node_modules) nao entra arquivo por
// arquivo: entra pelo hash do package-lock.json e pela versao do proprio tsc,
// os dois dentro da impressao digital.
// =====================================================

import ts from "typescript";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const NOME_DO_MANIFESTO = ".compilado.json";
const VERSAO_DO_FORMATO = 1;

// ---------------------------------------------------------------------------
// Cache de arquivos-fonte parseados, compartilhado por todos os programas.
// ---------------------------------------------------------------------------
// A chave inclui o languageVersion porque o parser depende dele. O `jsx` NAO
// entra na chave: quem decide se `<div>` e JSX ou asercao de tipo e a extensao
// do arquivo (.tsx), nao a opcao -- a opcao governa a EMISSAO. A comparacao
// byte a byte com os 97 `tsc` separados e o que sustenta essa afirmacao.
const cacheDeFontes = new Map();
let fontesLidas = 0;
let fontesReaproveitadas = 0;

function versaoDeLinguagem(versaoOuOpcoes) {
  return typeof versaoOuOpcoes === "object" ? versaoOuOpcoes.languageVersion : versaoOuOpcoes;
}

function lerFonteCompartilhada(nomeDoArquivo, versaoOuOpcoes, aoErrar) {
  const chave = `${path.resolve(nomeDoArquivo)}::${versaoDeLinguagem(versaoOuOpcoes)}`;
  const guardado = cacheDeFontes.get(chave);
  if (guardado) {
    fontesReaproveitadas++;
    return guardado;
  }
  let texto;
  try {
    texto = readFileSync(nomeDoArquivo, "utf8");
  } catch (erro) {
    if (aoErrar) aoErrar(String(erro));
    return undefined;
  }
  // `setParentNodes: false` -- o ultimo argumento. Isto nao e detalhe: com
  // `true`, o parser preenche o ponteiro de pai em CADA no da arvore, e medido
  // aqui isso custa 667ms dos 1.649ms de um alvo tipico (40%). Nada neste
  // arquivo caminha a arvore para cima: so emitimos e pedimos diagnosticos, e
  // os dois usam a arvore de cima para baixo. A saida emitida com `true` e com
  // `false` foi comparada byte a byte: identica.
  //
  // Quem mexer aqui: `true` volta a ser necessario so se alguem passar a usar
  // `node.parent` neste arquivo, o que nao e o caso.
  const fonte = ts.createSourceFile(nomeDoArquivo, texto, versaoOuOpcoes, false);
  cacheDeFontes.set(chave, fonte);
  fontesLidas++;
  return fonte;
}

// ---------------------------------------------------------------------------
// Resolver um alvo: dos argumentos de `tsc` para { opcoes, raizes, outDir }
// ---------------------------------------------------------------------------
function resolverInvocacao(argumentos) {
  const linha = ts.parseCommandLine(argumentos);
  if (linha.options.project) {
    const caminho = path.resolve(linha.options.project);
    let problema;
    const lido = ts.getParsedCommandLineOfConfigFile(caminho, {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        problema = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      },
    });
    if (!lido) throw new Error(`nao consegui ler ${linha.options.project}: ${problema ?? "motivo desconhecido"}`);
    return { opcoes: lido.options, raizes: lido.fileNames, tsconfig: caminho, argumentos };
  }
  if (linha.fileNames.length === 0) throw new Error("nenhum arquivo e nenhum -p na linha de comando");

  // Toda raiz tem que ser codigo TypeScript. Sem isto, um `-p` perdido no corte
  // dos argumentos faz o tsconfig.json entrar como ARQUIVO-FONTE: o alvo emite
  // nada e sai com sucesso, e a suite roda sobre a saida de ontem.
  const estranhas = linha.fileNames.filter((f) => !/\.tsx?$/.test(f));
  if (estranhas.length > 0) {
    throw new Error(`raiz que nao e .ts/.tsx: ${estranhas.join(", ")} -- faltou o -p?`);
  }

  return { opcoes: linha.options, raizes: linha.fileNames, tsconfig: undefined, argumentos };
}

function sha(conteudo) {
  return createHash("sha256").update(conteudo).digest("hex").slice(0, 32);
}

const hashDoLock = (() => {
  for (const nome of ["package-lock.json", "package.json"]) {
    const caminho = path.join(RAIZ, nome);
    if (existsSync(caminho)) return sha(readFileSync(caminho));
  }
  return "sem-lock";
})();

/**
 * A impressao digital do alvo: tudo que muda a saida sem ser o CONTEUDO de um
 * arquivo de entrada. Se qualquer coisa aqui muda, o reaproveitamento cai.
 */
function impressaoDigital(opcoes, raizes, tsconfig) {
  return sha(
    JSON.stringify({
      formato: VERSAO_DO_FORMATO,
      tsc: ts.version,
      lock: hashDoLock,
      opcoes: Object.fromEntries(Object.entries(opcoes).sort(([a], [b]) => a.localeCompare(b))),
      raizes: [...raizes].map((r) => path.relative(RAIZ, r)).sort(),
      tsconfig: tsconfig ? path.relative(RAIZ, tsconfig) : null,
    }),
  );
}

function caminhoDoManifesto(outDir) {
  return path.join(outDir, NOME_DO_MANIFESTO);
}

/**
 * O alvo pode reaproveitar o que ja esta em outDir?
 *
 * Exige, nesta ordem: manifesto legivel e do formato de hoje; mesma impressao
 * digital; TODO arquivo de entrada ainda com o mesmo sha256; e todo arquivo
 * emitido ainda no lugar. Qualquer duvida responde "nao" -- o custo de um
 * falso negativo e uma compilacao a mais, e o de um falso positivo e um
 * mutante morrendo verde.
 */
function podeAproveitar(outDir, impressao) {
  const manifesto = caminhoDoManifesto(outDir);
  if (!existsSync(manifesto)) return false;
  let dados;
  try {
    dados = JSON.parse(readFileSync(manifesto, "utf8"));
  } catch {
    return false;
  }
  if (dados.versaoDoFormato !== VERSAO_DO_FORMATO) return false;
  if (dados.impressao !== impressao) return false;
  if (!dados.entradas || !dados.emitidos) return false;

  for (const [relativo, esperado] of Object.entries(dados.entradas)) {
    const absoluto = path.join(RAIZ, relativo);
    if (!existsSync(absoluto)) return false;
    if (sha(readFileSync(absoluto)) !== esperado) return false;
  }
  for (const relativo of dados.emitidos) {
    if (!existsSync(path.join(RAIZ, relativo))) return false;
  }
  return true;
}

/** Os arquivos de entrada que valem hashear: os do repositorio, fora de node_modules. */
function entradasDoPrograma(programa) {
  const entradas = {};
  for (const fonte of programa.getSourceFiles()) {
    const absoluto = path.resolve(fonte.fileName);
    if (!absoluto.startsWith(RAIZ + path.sep)) continue;
    const relativo = path.relative(RAIZ, absoluto);
    if (relativo.split(path.sep).includes("node_modules")) continue;
    entradas[relativo] = sha(readFileSync(absoluto));
  }
  return entradas;
}

const hostDeFormatacao = {
  getCanonicalFileName: (f) => f,
  getCurrentDirectory: () => RAIZ,
  getNewLine: () => ts.sys.newLine,
};

/** O `tsc` deste repositorio, nao o que estiver no PATH de quem chamou. */
const TSC = path.join(RAIZ, "node_modules", "typescript", "bin", "tsc");

/**
 * Delega ao `tsc` de verdade, com os MESMOS argumentos que o alvo sempre usou.
 *
 * E o caminho do alvo frio e sozinho. Os diagnosticos saem pelo stdio herdado,
 * entao a mensagem de erro que a pessoa le e exatamente a de antes da HMO-263.
 */
function compilarComTsc({ argumentos, rotulo }) {
  if (!argumentos) throw new Error(`${rotulo}: sem os argumentos originais para repassar ao tsc`);
  const r = spawnSync(process.execPath, [TSC, ...argumentos], { cwd: RAIZ, stdio: "inherit" });
  if (r.error) throw r.error;
  return { erros: r.status === 0 ? 0 : 1, aproveitado: false, viaTsc: true };
}

/**
 * Compila um alvo de verdade. Devolve o numero de erros.
 *
 * Apaga o outDir antes de emitir: se o `include` de um alvo encolheu, um .js
 * orfao de ontem continuaria ali e um teste poderia importa-lo sem ninguem
 * notar.
 *
 * `semear` diz se esta compilacao deve deixar manifesto. Quem semeia e o lote
 * (`--todas`), que e o unico que tem o que compartilhar: num processo com 98
 * programas, o AST de cada arquivo de lib/ e parseado uma vez e reaproveitado.
 *
 * Um alvo sozinho e frio (sem manifesto para conferir) NAO passa por aqui --
 * ele e delegado ao `tsc`, veja `compilarComTsc`. Medido: o caminho em processo
 * leva ~1,9s contra ~1,6s do `tsc` num alvo tipico, porque sem o lote nao ha
 * reaproveitamento de parse nenhum para pagar a conta -- so uma travessia a
 * mais. Isso importa num lugar especifico: os controles negativos rodam a
 * suite numa COPIA da arvore, em diretorio temporario, uma vez por mutante.
 * La nunca ha manifesto, entao eram 24 blocos pagando a travessia e nao
 * recebendo nada -- medido, 20% mais lentos que antes da HMO-263.
 */
function compilarAlvo({ opcoes, raizes, tsconfig, rotulo, argumentos, semear = false }) {
  const outDir = opcoes.outDir
    ? path.resolve(opcoes.outDir)
    : (() => {
        throw new Error(`${rotulo}: sem outDir -- nao sei onde a saida cai`);
      })();

  const impressao = impressaoDigital(opcoes, raizes, tsconfig);

  if (podeAproveitar(outDir, impressao)) {
    return { erros: 0, aproveitado: true };
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // Frio e fora do lote: o `tsc` faz o mesmo mais rapido. A saida dos dois
  // caminhos foi comparada byte a byte nos 98 alvos (470 arquivos, zero
  // diferencas), e e por isso que alternar entre eles e seguro.
  //
  // Nao deixa manifesto de proposito: o outDir acabou de ser apagado, entao
  // nao sobra artefato de antes, e a proxima chamada recompila em vez de
  // confiar num manifesto que este caminho nao sabe preencher. Errar para o
  // lado de recompilar e o unico erro aceitavel aqui.
  if (!semear) {
    return compilarComTsc({ argumentos, rotulo });
  }

  const host = ts.createCompilerHost(opcoes);
  host.getSourceFile = lerFonteCompartilhada;

  const emitidos = [];
  const escreverOriginal = host.writeFile.bind(host);
  host.writeFile = (nome, texto, bom, aoErrar, fontes, dados) => {
    emitidos.push(path.relative(RAIZ, path.resolve(nome)));
    escreverOriginal(nome, texto, bom, aoErrar, fontes, dados);
  };

  const programa = ts.createProgram(raizes, opcoes, host);
  const entradas = entradasDoPrograma(programa);
  const resultado = programa.emit();

  const diagnosticos = ts
    .getPreEmitDiagnostics(programa)
    .concat(resultado.diagnostics)
    .filter((d) => d.category === ts.DiagnosticCategory.Error);

  if (diagnosticos.length > 0) {
    // Nao grava manifesto: compilacao com erro nao e estado aproveitavel.
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnosticos, hostDeFormatacao));
    return { erros: diagnosticos.length, aproveitado: false };
  }

  writeFileSync(
    caminhoDoManifesto(outDir),
    JSON.stringify({ versaoDoFormato: VERSAO_DO_FORMATO, impressao, entradas, emitidos }),
  );
  return { erros: 0, aproveitado: false };
}

// ---------------------------------------------------------------------------
// Descoberta dos alvos, para o modo --todas
// ---------------------------------------------------------------------------
// Sai do package.json, nao de uma lista a mao: suite nova entra no lote sozinha.
// O `check-tests-in-ci.mjs` ja garante que todo `test:*` tem step no CI; aqui a
// garantia complementar e que todo `test:*` que compila esta no lote.
function alvosDoPackageJson() {
  const pkg = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8"));
  const alvos = [];
  const naoEntendidos = [];

  for (const [nome, comando] of Object.entries(pkg.scripts ?? {})) {
    if (!nome.startsWith("test:")) continue;
    for (const parte of comando.split("&&").map((s) => s.trim())) {
      // Tanto `tsc ...` (como era) quanto `node scripts/compila.mjs ...` (como e).
      //
      // O corte e pelo numero de palavras do PREFIXO: 1 para `tsc`, 2 para
      // `node scripts/compila.mjs`. Cortar uma palavra a mais nao da erro --
      // com `-p x.json` ele deixa `x.json` sozinho, que o parseCommandLine
      // aceita como ARQUIVO-FONTE. O alvo entao "compila" um JSON, emite nada,
      // e sai com sucesso. Foi o que aconteceu ao escrever isto.
      let argumentos;
      if (/^tsc\s/.test(parte)) argumentos = parte.split(/\s+/).slice(1);
      else if (/^node\s+scripts\/compila\.mjs\s/.test(parte)) argumentos = parte.split(/\s+/).slice(2);
      else continue;

      try {
        alvos.push({ rotulo: nome, ...resolverInvocacao(argumentos) });
      } catch (erro) {
        naoEntendidos.push(`${nome}: ${erro.message}`);
      }
    }
  }
  return { alvos, naoEntendidos };
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);

if (argv.length === 0) {
  console.error("uso: node scripts/compila.mjs --todas | <os mesmos argumentos do tsc>");
  process.exit(1);
}

const inicio = Date.now();

if (argv[0] === "--todas") {
  const { alvos, naoEntendidos } = alvosDoPackageJson();

  // Um alvo que o lote nao entende nao fica QUEBRADO -- ele so volta a compilar
  // sozinho, devagar. Mas a erosao seria silenciosa, entao ela reprova aqui.
  if (naoEntendidos.length > 0) {
    console.error("O lote nao entendeu a invocacao de compilacao destes alvos:\n");
    for (const linha of naoEntendidos) console.error(`  ${linha}`);
    console.error("\nAjuste scripts/compila.mjs ou o comando do alvo no package.json.");
    process.exit(1);
  }

  // Dois alvos no mesmo outDir: o segundo apagaria a saida do primeiro, e a
  // suite do primeiro rodaria sobre arquivo que nao e dela -- ou sobre
  // diretorio vazio. Hoje nao acontece; se passar a acontecer, para aqui em vez
  // de virar uma suite verde sem conteudo.
  const porSaida = new Map();
  for (const alvo of alvos) {
    const saida = path.resolve(alvo.opcoes.outDir ?? "");
    if (!porSaida.has(saida)) porSaida.set(saida, []);
    porSaida.get(saida).push(alvo.rotulo);
  }
  const colisoes = [...porSaida].filter(([, nomes]) => new Set(nomes).size > 1);
  if (colisoes.length > 0) {
    console.error("Mais de um alvo compila para o mesmo diretorio de saida:\n");
    for (const [saida, nomes] of colisoes) {
      console.error(`  ${path.relative(RAIZ, saida)}/ <- ${[...new Set(nomes)].join(", ")}`);
    }
    process.exit(1);
  }

  let erros = 0;
  let aproveitados = 0;
  for (const alvo of alvos) {
    let r;
    try {
      r = compilarAlvo({ ...alvo, semear: true });
    } catch (erro) {
      // Um alvo que estoura nao pode derrubar o lote calado: os outros 96
      // ficariam sem compilar e cada suite acharia que so precisava recompilar
      // a sua. Conta como erro e segue.
      console.error(`ERRO ao compilar ${alvo.rotulo}: ${erro.message}`);
      erros++;
      continue;
    }
    erros += r.erros;
    if (r.aproveitado) aproveitados++;
    if (r.erros > 0) console.error(`ERRO ao compilar ${alvo.rotulo}`);
  }

  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  if (erros > 0) {
    console.error(`\n${erros} erro(s) de compilacao em ${alvos.length} alvos.`);
    process.exit(1);
  }
  console.log(
    `${alvos.length} alvos compilados em ${segundos}s ` +
      `(${aproveitados} aproveitados, ${fontesLidas} arquivos lidos, ` +
      `${fontesReaproveitadas} reaproveitamentos de parse).`,
  );
  process.exit(0);
}

// Modo de um alvo: os mesmos argumentos que o `tsc` recebia.
//
// Com `--semeia` na frente, este alvo compila em processo e DEIXA manifesto --
// e o que o lote faz com cada um dos 98. Fora do lote isto so serve para
// aquecer um alvo de proposito, e e como a suite do proprio compila.mjs monta
// o estado "ja compilado" que ela precisa para conferir o reaproveitamento.
// Sem a flag, um alvo frio e delegado ao `tsc` e nao deixa manifesto.
//
// A linha de saida diz qual dos dois caminhos foi tomado. Nao e enfeite: e o
// que permite ler num log de CI se o lote esta sendo aproveitado, e e o que
// mostra, dentro de um bloco de controle negativo, que a mutacao FORCOU
// recompilacao em vez de rodar sobre o artefato de antes.
try {
  const semear = argv[0] === "--semeia";
  const resto = semear ? argv.slice(1) : argv;
  const alvo = { rotulo: "alvo", ...resolverInvocacao(resto), semear };
  const saida = path.relative(RAIZ, path.resolve(alvo.opcoes.outDir ?? "."));
  const r = compilarAlvo(alvo);
  if (r.erros > 0) process.exit(1);
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(
    r.aproveitado
      ? `${saida}/ aproveitado do lote (entradas inalteradas), ${segundos}s`
      : `${saida}/ compilado agora (entrada mudou ou nao havia lote), ${segundos}s`,
  );
  process.exit(0);
} catch (erro) {
  console.error(`compila.mjs: ${erro.message}`);
  process.exit(1);
}
