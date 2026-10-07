#!/usr/bin/env node
// =====================================================
// CONVERSOR MECANICO: runner da familia HMO-246 -> bloco da HMO-319
// =====================================================
// Roda com:  node scripts/converte-mutantes-em-bloco.mjs <runner.mjs> [...]
//            node scripts/converte-mutantes-em-bloco.mjs --conferir <runner.mjs>
//
// POR QUE UM CONVERSOR, E NAO 44 EDICOES A MAO (HMO-318)
// ------------------------------------------------------
// A HMO-319/320 converteram 15 runners para `criarBlocoDeMutantes`. Sobraram
// ~44, e cinco deles sao a mesma familia byte a byte, modulo DOIS nomes (o
// arquivo mutado e a suite): o driver nasceu copiado da HMO-246.
//
// O risco de converter isso a mao nao e errar o driver -- e errar a LISTA. A
// lista de mutantes e a unica parte do arquivo que carrega conhecimento que nao
// esta em nenhum outro lugar: cada `de`/`para`/`porque` e um defeito que alguem
// mediu. Reescrever 118 entradas a mao e como as listas divergem em silencio.
//
// Por isso este conversor NUNCA REESCREVE A LISTA. Ele recorta o texto do
// arquivo entre `const FONTE` e o `];` que fecha `MUTANTES` e o cola INTACTO no
// arquivo novo; o que ele gera e so o driver em volta. O modo `--conferir`
// prova isso depois: ele extrai o miolo dos dois arquivos (o do git e o novo) e
// exige que sejam identicos byte a byte, fora as declaracoes que o desenho novo
// tornou mortas.
//
// O QUE O DESENHO NOVO APAGA, E POR QUE ISSO E O PONTO
// ----------------------------------------------------
// 1. `DEPENDENCIAS` -- a lista a mao dos arquivos que o alvo importa. Era o
//    maior defeito do desenho antigo: `mutantes-realizado-do-caixa` passou
//    MESES abortando no controle positivo porque a HMO-285 e a HMO-305 criaram
//    `lib/chave-da-fatura.ts` e `lib/elo-da-fatura.ts` e ninguem acrescentou as
//    duas aqui. A sombra do bloco espelha a arvore INTEIRA: nao existe mais
//    lista para envelhecer.
//
// 2. O `tsconfig` sintetizado a mao. O bloco le as etapas do proprio
//    `scripts[suite]` do package.json -- o comando que o CI roda --, entao o
//    runner nao pode mais medir um pipeline que a suite ja abandonou.
//    (`realizado-do-caixa` repetia `tsc` + `resolve-aliases` + `node --test` a
//    mao; um passo a mais no alvo e o runner nao saberia.)
//
// 3. O `finally` que recompilava `.tmp-X` no fim. Ele existia porque o desenho
//    antigo emitia a saida MUTADA dentro do repositorio (`outDir:
//    resolve(SAIDA)`), e o proximo `npm run test:X` leria o artefato mutado. O
//    bloco emite dentro da sombra: o `.tmp-X` do repositorio nao e tocado, e o
//    passo de reparo deixa de ter o que reparar.
//
// O QUE ELE PRESERVA DE PROPOSITO
// --------------------------------
// - A checagem de OCORRENCIA UNICA (`ocorrencias > 1` e mutante invalido).
//   `String.replace` troca a primeira ocorrencia; um trecho que aparece duas
//   vezes muta o lugar errado e morre verde com o rotulo mentindo. Os runners
//   desta familia tem essa trava e os da HMO-320 nao -- converter nao pode
//   perde-la.
// - O campo `porque`, impresso quando o mutante sobrevive.
// - O CONTROLE POSITIVO, que aqui ganha forca: no desenho antigo ele compilava
//   a arvore montada a mao; agora ele passa pelo MESMO `rodar` dos mutantes,
//   entao pega erro no proprio aparelho.
// - O handler de SIGINT/SIGTERM. A sombra do bloco ja tira o pior modo de falha
//   (a fonte do repositorio nunca e mutada), mas um `exit` explicito garante
//   que o diretorio temporario saia junto em vez de vazar em /tmp.
// =====================================================

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// SECOES DO CABECALHO QUE O DESENHO NOVO TORNOU FALSAS.
//
// Nao e faxina: um comentario que descreve um mecanismo que nao existe mais e
// pior que comentario nenhum neste repositorio, porque ha guard e assercao que
// LEEM o texto da fonte. Todas as secoes abaixo explicam a mesma coisa -- "o
// runner monta uma arvore temporaria com uma lista de copias ao lado e escreve
// um tsconfig a mao" --, e nenhuma delas descreve o que o arquivo passa a
// fazer. A `NOTA` as substitui, dizendo o que vale agora e por que mudou.
const SECOES_MORTAS = [
  /DEPENDENCIA/,
  /ARVORE E COPIADA/,
  /COMPLICA O BUILD/,
  /O BUILD E O QUE COMPLICA/,
  /A FONTE NUNCA E MUTADA NO DISCO/,
];

/** Titulo de secao do cabecalho: linha de comentario toda em maiusculas. */
const TITULO = /^\/\/ [A-Z][A-Z0-9 ,.\-@/`()]*$/;

// PARAGRAFO MORTO SEM TITULO (HMO-328).
//
// A familia do painel nao guarda o mecanismo obsoleto numa SECAO com titulo em
// maiusculas -- ela guarda num paragrafo solto no fim do cabecalho:
//
//   // Nao usa `git checkout` para restaurar: ele restauraria a partir do
//   // INDICE, e num worktree compartilhado isso ja apagou trabalho nao
//   // commitado aqui. A copia original vai para a memoria e volta de la, sempre.
//
// Esse paragrafo esta nos tres runners desta familia, e o bloco o torna falso
// por uma razao mais forte do que a que ele descreve: nao ha mais restauracao
// nenhuma a fazer, porque a arvore rastreada nunca e mutada. Deixa-lo seria pior
// que faxina pendente -- ele descreve uma escrita no worktree COMPARTILHADO que
// o arquivo passa a NAO fazer, e e exatamente a frase que alguem leria para
// decidir se e seguro rodar este runner com outro run em curso.
//
// Por que um mecanismo separado do `SECOES_MORTAS`: `podarCabecalho` corta de um
// TITULO ate o titulo seguinte, e aqui nao ha titulo -- casar por `SECOES_MORTAS`
// cortaria da secao anterior (`POR QUE UM RUNNER NOVO`, que continua valendo)
// ate o fim do cabecalho.
const PARAGRAFOS_MORTOS = [/Nao usa `git checkout` para restaurar/];

/**
 * Tira do cabecalho as secoes cujo titulo casa com `SECOES_MORTAS`, e os
 * paragrafos SEM titulo que casam com `paragrafosMortos`.
 *
 * Uma secao vai do seu titulo ate o titulo seguinte (ou o fim). Os titulos sao
 * detectados por MAIUSCULAS e nao pela linha de tracinhos, porque nem toda
 * secao deste repositorio tem a linha de tracinhos -- `COMO RODAR` nao tem, e
 * cortar por tracinho a engoliria junto com a secao anterior.
 *
 * Um paragrafo, por sua vez, vai de uma linha `//` vazia a outra (ou ao fim): e
 * o recorte mais apertado que existe sem titulo, e por isso o unico honesto para
 * tirar um paragrafo do MEIO de uma secao que continua verdadeira.
 *
 * `paragrafosMortos` e parametro, e nao constante de modulo como `SECOES_MORTAS`,
 * para que a conversao de uma familia nao mexa no texto gerado para a outra: o
 * conferidor compara MIOLO, nao cabecalho, e nao denunciaria uma poda a mais
 * aplicada por engano aos runners da familia HMO-246.
 */
function podarCabecalho(cabecalho, paragrafosMortos = []) {
  const linhas = cabecalho.split("\n");
  const inicios = [];
  for (let i = 0; i < linhas.length; i++) if (TITULO.test(linhas[i])) inicios.push(i);

  const cortar = new Set();
  for (let k = 0; k < inicios.length; k++) {
    const titulo = linhas[inicios[k]];
    if (!SECOES_MORTAS.some((re) => re.test(titulo))) continue;
    const fim = k + 1 < inicios.length ? inicios[k + 1] : linhas.length;
    for (let i = inicios[k]; i < fim; i++) cortar.add(i);
  }

  for (const re of paragrafosMortos) {
    const alvo = linhas.findIndex((l) => re.test(l));
    if (alvo === -1) continue;
    let inicio = alvo;
    while (inicio > 0 && linhas[inicio - 1].trim() !== "//") inicio--;
    let fim = alvo;
    while (fim + 1 < linhas.length && linhas[fim + 1].trim() !== "//") fim++;
    // Come tambem a linha `//` que separava este paragrafo do anterior, senao
    // sobra um `//` pendurado no fim do cabecalho.
    if (inicio > 0) inicio--;
    for (let i = inicio; i <= fim; i++) cortar.add(i);
  }

  const restantes = linhas.filter((_, i) => !cortar.has(i));
  // Duas linhas `//` seguidas sobram onde uma secao saiu do meio.
  return restantes
    .filter((l, i) => !(l.trim() === "//" && restantes[i + 1]?.trim() === "//"))
    .join("\n")
    .trimEnd();
}

/** Acha o `];` na coluna 0 que fecha a lista aberta em `aberturaIdx`. */
function fimDaLista(texto, aberturaIdx) {
  const fim = texto.indexOf("\n];", aberturaIdx);
  if (fim === -1) throw new Error("nao achei o `];` que fecha a lista");
  return fim + "\n];".length;
}

/**
 * Tira uma declaracao `const NOME = ...;` do texto, incluindo o bloco de
 * comentarios colado nela. Devolve o texto sem ela.
 *
 * Para `const NOME = [` multilinha, corta ate o `];` na coluna 0.
 */
function removerDeclaracao(texto, nome) {
  const re = new RegExp(`^const ${nome} = `, "m");
  const m = re.exec(texto);
  if (!m) return texto;
  const inicio = m.index;
  // O CORTE E DECIDIDO PELA PRIMEIRA LINHA, e esta e a parte que ja deu errado:
  // `const DEPENDENCIAS = [...];` cabe numa linha em alguns runners e ocupa
  // varias em outros. Cortar sempre ate o `\n];` apagou a LISTA DE MUTANTES
  // inteira de `mutantes-periodo-do-grupo` (o proximo `\n];` do arquivo era o
  // dela), e o conferidor nao viu porque comparava duas extracoes igualmente
  // truncadas. Dai a regra ser "a declaracao fecha nesta linha?" e o conferidor
  // ter passado a exigir um PISO de tamanho e a contagem de mutantes.
  const fimDaLinha = texto.indexOf("\n", inicio);
  const primeiraLinha = texto.slice(inicio, fimDaLinha === -1 ? undefined : fimDaLinha);
  let fim;
  if (primeiraLinha.trimEnd().endsWith(";")) {
    fim = inicio + primeiraLinha.lastIndexOf(";") + 1;
  } else {
    const fecha = texto.indexOf("\n];", inicio);
    if (fecha === -1) throw new Error(`${nome}: declaracao multilinha sem fechamento`);
    fim = fecha + "\n];".length;
  }
  // Come a quebra de linha seguinte, para nao deixar linha em branco dupla.
  let depois = fim;
  if (texto[depois] === "\n") depois++;
  return texto.slice(0, inicio) + texto.slice(depois);
}

/**
 * Recorta o runner antigo nas tres partes que importam.
 *
 * `miolo` e o que vai ser copiado INTACTO: do `const FONTE` ate o fim da lista
 * de mutantes, menos as declaracoes que o bloco tornou mortas.
 */
export function recortar(fonte) {
  const mFonte = /^const FONTE = "(.+?)";$/m.exec(fonte);
  if (!mFonte) throw new Error("nao achei `const FONTE = \"...\";`");

  const mLista = /^const MUTANTES = \[$/m.exec(fonte);
  if (!mLista) throw new Error("nao achei `const MUTANTES = [`");

  const mSuite = /execFileSync\("npm", \["run", "(test:[a-z0-9:-]+)"\]/.exec(fonte);
  if (!mSuite) throw new Error("nao achei a suite no `finally` (`npm run test:...`)");

  const mImport = /^import \{$/m.exec(fonte);
  if (!mImport) throw new Error("nao achei o bloco de imports");

  const cabecalho = podarCabecalho(fonte.slice(0, mImport.index).trimEnd());
  let miolo = fonte.slice(mFonte.index, fimDaLista(fonte, mLista.index));

  // `DEPENDENCIA` NO SINGULAR ESTAVA FALTANDO, e o estrago foi silencioso ate o
  // lint (HMO-328): `mutantes-fechamento-do-grupo.mjs` declara UMA dependencia e
  // chamou a constante de `DEPENDENCIA`. `removerDeclaracao` casa por
  // `^const <nome> = `, entao a entrada no plural nao a alcancou, a constante
  // ficou no arquivo convertido sem ninguem para ler, e `npm run lint-tudo`
  // passou a reprovar na main com `'DEPENDENCIA' is assigned a value but never
  // used` -- um aviso num arquivo que o autor da conversao nao tinha motivo para
  // reabrir.
  //
  // A ordem importa menos do que parece (`^const DEPENDENCIA = ` nao casa com
  // `const DEPENDENCIAS = `, porque o que vem depois do nome e um `S`), mas o
  // plural vem primeiro de proposito: e a forma comum.
  for (const morta of ["DEPENDENCIAS", "DEPENDENCIA", "SAIDA", "TESTE"]) {
    miolo = removerDeclaracao(miolo, morta);
  }

  return {
    cabecalho,
    miolo: miolo.trimEnd(),
    arquivoFonte: mFonte[1],
    suite: mSuite[1],
  };
}

// ===========================================================================
// A SEGUNDA FAMILIA: "do painel" (HMO-328)
// ===========================================================================
// Tres runners -- `painel-na-tela`, `sobra-ou-falta` e `detalhe-do-painel` --
// sao entre si o mesmo driver byte a byte, modulo os arquivos mutados e a lista
// de suites. Nao sao a familia HMO-246, e `recortar` os recusa com razao:
//
//   HMO-246              | do painel
//   ---------------------+-------------------------------------------------
//   const FONTE = "x"    | varias constantes de arquivo (LIB, ROTA, PAINEL)
//   const MUTANTES = [   | const mutantes = [   (minuscula)
//   um arquivo mutado    | `arquivo` POR MUTANTE, multi-arquivo de verdade
//   uma suite            | uma OU DUAS suites, todas rodadas por mutante
//   trava de ocorrencia  | NAO tem -- `replace` cru (ver OCORRENCIA UNICA)
//   muta em /tmp (depois)| muta A ARVORE RASTREADA
//
// POR QUE ESTES TRES PRIMEIRO
// ---------------------------
// Porque sao os unicos runners nao convertidos que o CI PAGA. Medido na arvore
// apos a HMO-318, lendo apenas os `run:` DE VERDADE dos tres workflows -- os
// workflows citam dezenas de runners dentro de COMENTARIOS, e contar comentario
// como step infla a conta (e o que o `check-mutantes-in-ci.mjs` da HMO-322
// explica): 19 runners tem step, 16 ja estao no bloco, um e o proprio
// `guarda-dos-mutantes` e um esta reservado pela HMO-321. Sobram estes tres.
//
// A issue supunha oito. Cinco dos oito -- `crivos`, `lancamentos-completos`,
// `renda-fixa`, `orcamento-de-grupo`, `transferencia-recorrente-app` -- chamam
// `npm run test:X` mas NENHUM workflow os invoca: converte-los nao devolve
// minuto de CI nenhum (e o `check-mutantes-in-ci.mjs` e que cobra a declaracao
// de "fora do CI" deles).
//
// E SAO OS MAIS CAROS QUE EXISTEM POR VOLTA
// -----------------------------------------
// Duas das tres suites sao de NAVEGADOR (Chromium de verdade, ~8s por volta), e
// `detalhe-do-painel` roda DUAS suites por mutante. Sao 48 mutantes nos tres.
//
// E sao, pela mesma razao, os que mais ja plantaram mutante nesta arvore: um
// runner de 17 voltas de ~8s estoura qualquer timeout de ferramenta, o sinal que
// chega e SIGTERM, e `execSync` BLOQUEIA a thread do JS -- entao o gancho de
// restauracao nao roda a tempo e o arquivo de producao fica com o mutante
// GRAVADO. Nao e hipotese: aconteceu com `mutantes-painel-na-tela.mjs` (HMO-296,
// `PainelDePapel.tsx` ficou mutado) e a HMO-263 herdou um worktree com
// `DivisaoDoGrupo.tsx` mutado por outro runner do mesmo desenho. Convertido, o
// pior caso passa a ser um diretorio orfao em /tmp.
//
// OCORRENCIA UNICA: A UNICA TRAVA QUE A CONVERSAO ACRESCENTA
// ---------------------------------------------------------
// Esta familia tem duas travas de ancora (`includes(de)` e `depois !== antes`) e
// nao tem a terceira, que a familia HMO-246 tem: `de` que aparece DUAS vezes.
// `String.replace` troca a primeira, entao o mutante muta um lugar que o rotulo
// nao descreve e, se aquele lugar nao for medido, SOBREVIVE com o rotulo
// mentindo sobre o que foi medido.
//
// Acrescentar trava muda o placar, e por isso foi medido antes de escrever:
// `scripts/mede-ancora-ambigua.mjs` conta as ocorrencias de cada `de` nos 48
// mutantes dos tres runners. Nenhum e ambiguo hoje -- a trava entra sem mudar
// nenhum veredito, e passa a valer para o mutante que vier depois.
// ===========================================================================

/**
 * Este runner e da familia do painel?
 *
 * `const mutantes = [` SOZINHO NAO SERVE, e isto foi medido: a familia "tupla"
 * (~11 runners, `cash-flow`, `cartao-orcamento-grupo`, `tres-numeros`, ...) usa
 * exatamente a mesma declaracao, com `[nome, de, para]` dentro em vez de um
 * objeto. Reconhecer so pela declaracao fazia o conversor aceitar um runner da
 * tupla e produzir um arquivo que nem carrega -- o miolo da tupla referencia
 * `readFileSync` no topo, que o driver novo nao importa ali.
 *
 * O que separa as duas e o campo `arquivo` POR MUTANTE, que e justamente o que
 * torna esta familia multi-arquivo e que a tupla nao tem (ela muta um `ALVO` so).
 */
export const ehDoPainel = (fonte) =>
  /^const mutantes = \[$/m.test(fonte) && /^ {4}arquivo: /m.test(fonte);

/** As suites de um runner da familia do painel, na ORDEM em que ele as roda. */
function suitesDoPainel(fonte) {
  // JA CONVERTIDO: `const SUITES = ["a", "b"];`. Reconhecer esta forma e o que
  // deixa `recortarPainel` servir tambem para LER um runner convertido -- e o
  // que o `mede-ancora-ambigua.mjs` precisa para carregar a lista de mutantes
  // sem executar o driver.
  const convertido = /^const SUITES = \[([^\]]+)\];$/m.exec(fonte);
  if (convertido) {
    return [...convertido[1].matchAll(/"(test:[a-z0-9:-]+)"/g)].map((m) => m[1]);
  }
  // Duas suites: `for (const suite of ["a", "b"])` com `npm run ${suite}` dentro.
  const lista = /for \(const suite of \[([^\]]+)\]\)/.exec(fonte);
  if (lista) {
    const quais = [...lista[1].matchAll(/"(test:[a-z0-9:-]+)"/g)].map((m) => m[1]);
    if (quais.length === 0) {
      throw new Error("o `for (const suite of [...])` nao lista suite nenhuma");
    }
    return quais;
  }
  // Uma suite: `execSync("npm run test:x", ...)`.
  const unica = /execSync\("npm run (test:[a-z0-9:-]+)"/.exec(fonte);
  if (!unica) {
    throw new Error('nao achei a suite (nem `execSync("npm run test:...")` nem a lista)');
  }
  return [unica[1]];
}

/**
 * Recorta um runner da familia do painel.
 *
 * O `miolo` -- copiado INTACTO, como na outra familia -- vai da PRIMEIRA
 * constante de arquivo ate o `];` que fecha `mutantes`. Nao ha declaracao morta
 * a remover: esta familia nunca teve `DEPENDENCIAS`, `SAIDA` nem `TESTE`, porque
 * ela nao montava arvore nenhuma -- ela mutava a arvore rastreada e chamava
 * `npm run` ali mesmo. E esse o defeito que a conversao fecha.
 */
export function mioloDoPainel(fonte) {
  const mLista = /^const mutantes = \[$/m.exec(fonte);
  if (!mLista) throw new Error("nao achei `const mutantes = [`");

  // As constantes de arquivo: `const PAINEL = "components/...";` antes da lista.
  //
  // O FILTRO DO `test:` NAO E ZELO: um runner JA convertido declara
  // `const SUITE = "test:menu-papel";` na mesma forma, e sem o filtro ele seria
  // lido como "o primeiro arquivo mutado" -- o miolo passaria a comecar na linha
  // da suite. `menu-papel` e `mes-do-painel`, convertidos pela HMO-319/320, sao
  // desta familia e estao exatamente nesse caso.
  const antesDaLista = fonte.slice(0, mLista.index);
  const constantes = [...antesDaLista.matchAll(/^const ([A-Z][A-Z_0-9]*) = "([^"]+)";$/gm)].filter(
    (m) => !m[2].startsWith("test:"),
  );
  if (constantes.length === 0) {
    throw new Error('nao achei nenhuma `const NOME = "caminho";` antes da lista');
  }

  return {
    miolo: fonte.slice(constantes[0].index, fimDaLista(fonte, mLista.index)).trimEnd(),
    arquivos: constantes.map((m) => m[2]),
  };
}

export function recortarPainel(fonte) {
  // O import desta familia cabe numa linha (`import { readFileSync, writeFileSync }
  // from "node:fs";`), ao contrario do da HMO-246, que e multilinha -- por isso a
  // ancora aqui e "a primeira linha que comeca com `import `", e nao `^import \{$`.
  const mImport = /^import /m.exec(fonte);
  if (!mImport) throw new Error("nao achei o bloco de imports");

  return {
    cabecalho: podarCabecalho(fonte.slice(0, mImport.index).trimEnd(), PARAGRAFOS_MORTOS),
    ...mioloDoPainel(fonte),
    suites: suitesDoPainel(fonte),
  };
}

const NOTA_PAINEL = (arquivos, suites, quantos) => `//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-328)
// --------------------------------------------------------
// Este runner MUTAVA A ARVORE RASTREADA: guardava o texto original em memoria,
// escrevia o mutante ${arquivos.length === 1 ? `em \`${arquivos[0]}\`` : `num dos ${arquivos.length} arquivos de producao da lista`},
// chamava \`npm run\` ali mesmo e restaurava depois. Dois defeitos nisso, e o
// segundo e o que doia:
//
//   1. cada volta recompilava o programa INTEIRO, mesmo mudando UM arquivo. Sao
//      ${quantos} mutantes${suites.length === 1 ? ` em \`${suites[0]}\`` : `, e cada um roda AS DUAS suites (${suites.join(", ")})`},
//      e era um dos passos mais caros do job de verificacao;
//
//   2. o mutante ficava GRAVADO no arquivo de producao quando o processo morria
//      no meio. O gancho de restauracao e \`process.on("exit")\`, que NAO roda em
//      SIGTERM -- e SIGTERM e o que um timeout manda. Pior: \`execSync\` bloqueia
//      a thread do JS, entao nem um handler de SIGTERM resolve; o processo
//      termina a volta em curso e aplica A SEGUINTE. Aconteceu nesta arvore duas
//      vezes (\`PainelDePapel.tsx\` na HMO-296, \`DivisaoDoGrupo.tsx\` herdado
//      mutado pela HMO-263), e nas duas o \`git status\` mostrava UM arquivo
//      modificado -- a cara de trabalho em andamento.
//
// Agora as voltas dividem um processo e um cache de AST
// (\`criarBlocoDeMutantes\`, HMO-319): so o arquivo mutado e reparseado, e a
// mutacao vai para uma SOMBRA em diretorio temporario. A arvore rastreada e o
// \`.tmp-*\` do repositorio nao sao tocados em momento nenhum, entao o pior caso
// de um processo morto e um diretorio orfao em /tmp.
//
// As etapas de cada suite saem do proprio \`scripts[...]\` do package.json -- o
// comando que o CI roda --, e nao de uma receita repetida a mao aqui.
//
// A lista de mutantes abaixo NAO foi reescrita: ela veio byte a byte do arquivo
// anterior, pelo \`scripts/converte-mutantes-em-bloco.mjs\`.`;

function driverPainel(suites, rotulo) {
  const varias = suites.length > 1;
  return `
const SUITES = ${JSON.stringify(suites)};

const bloco = criarBlocoDeMutantes({ rotulo: "${rotulo}", suites: SUITES });

// A sombra vive em diretorio temporario, e a arvore rastreada nunca e mutada --
// era esse o modo de falha deste runner. O handler de sinal existe so para que
// nem o diretorio orfao sobre: \`finally\` nao roda em SIGTERM, mas
// \`process.exit\` dispara o \`exit\` abaixo.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// O texto de cada arquivo que algum mutante toca. Lido da arvore de verdade, que
// e o original por construcao: nada mais aqui escreve nela.
const original = new Map();
for (const arquivo of new Set(mutantes.map((m) => m.arquivo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO, primeiro e obrigatorio: ${varias ? "as DUAS suites tem" : "a suite tem"} de passar com a
// arvore INTACTA, e pelo MESMO \`rodar\` que os mutantes usam -- por isso ele pega
// erro no proprio aparelho. Sem ele, uma sombra mal montada reprova TODO mutante
// e o placar fecha "N/N mortos" sobre zero assercoes executadas.
for (const suite of SUITES) {
  const controle = bloco.rodar("controle", {}, suite);
  if (!controle.verde) {
    console.error(\`ABORTADO: a arvore INTACTA reprova em \${suite} (\${controle.como}).\`);
    console.error(\`  \${controle.saida}\`);
    console.error("O placar nao valeria: todo mutante 'morreria' sem ter sido medido.");
    process.exit(1);
  }
}
console.log(\`controle positivo: a arvore intacta passa em \${SUITES.join(" e ")}\\n\`);

let sobreviventes = 0;

for (const m of mutantes) {
  const antes = original.get(m.arquivo);

  // AS TRES TRAVAS DE ANCORA. As duas das pontas ja existiam neste runner; a do
  // meio e a que a conversao acrescenta (ver OCORRENCIA UNICA, no conversor).
  const ocorrencias = antes.split(m.de).length - 1;
  if (ocorrencias === 0) {
    console.error(\`SOBREVIVEU (ancora nao casou) :: \${m.nome}\`);
    console.error(\`  o texto buscado nao existe em \${m.arquivo}: \${m.de}\`);
    sobreviventes++;
    continue;
  }
  if (ocorrencias > 1) {
    console.error(\`SOBREVIVEU (ancora ambigua) :: \${m.nome}\`);
    console.error(\`  o texto aparece \${ocorrencias}x em \${m.arquivo} -- o replace muta so a 1a\`);
    sobreviventes++;
    continue;
  }
  const depois = antes.replace(m.de, m.para);
  if (depois === antes) {
    console.error(\`SOBREVIVEU (replace nao mudou nada) :: \${m.nome}\`);
    sobreviventes++;
    continue;
  }

  // TODAS as suites, parando na primeira que mata -- e a ordem e a do arquivo
  // anterior, que importa: a suite barata vem primeiro justamente para que o
  // mutante que ela mata nao pague a de navegador.
  let r;
  for (const suite of SUITES) {
    r = bloco.rodar(m.nome, { [m.arquivo]: depois }, suite);
    if (!r.verde) break;
  }

  if (r.verde) {
    console.error(\`SOBREVIVEU :: \${m.nome}\`);${
      varias
        ? `
    // A NOTA DE MUTANTE EQUIVALENTE NAO E IMPRIMIDA AQUI, e isto e deliberado.
    // \`criarBlocoDeMutantes\` guarda UMA saida de controle por BLOCO, preenchida
    // na primeira volta sem sobrescritas -- nao uma por suite. Com duas suites, o
    // \`mudouASaida\` do mutante compara o que ESTA suite emitiu com a linha de
    // base da OUTRA, e as duas emitem conjuntos diferentes de arquivos: a
    // resposta seria "mudou" sempre, inclusive para um mutante de fato
    // equivalente. Imprimir a nota a partir dela seria um rotulo que nao mede o
    // que diz; omiti-la perde uma dica e nao afirma nada falso.
    //
    // Quem quiser a nota de volta: a linha de base precisa ser por alvo dentro do
    // bloco. Nao foi mexido aqui porque \`mutantes-em-bloco.mjs\` e compartilhado
    // por outros runners e a nota nao muda veredito nenhum.`
        : `
    if (r.mudouASaida === false) {
      console.error("  (saida compilada identica a da arvore limpa: EQUIVALENTE)");
    }`
    }
    sobreviventes++;
  } else {
    // Morrer no tsc tambem e morrer -- mutante que nao compila nao chega em
    // producao --, mas a distincao importa: um erro de tipo nao diz que a SUITE
    // pegou a regra.
    console.log(\`morreu     :: \${m.nome}  (\${r.como === "tsc" ? "tsc" : "asercao"})\`);
  }
}

console.log(\`\\n\${mutantes.length - sobreviventes}/\${mutantes.length} mortos\`);
process.exit(sobreviventes === 0 ? 0 : 1);
`;
}

export function converterPainel(fonte, rotulo) {
  const { cabecalho, miolo, arquivos, suites } = recortarPainel(fonte);
  const quantos = (miolo.match(/^ {4}nome: /gm) ?? []).length;
  return (
    `${cabecalho}\n${NOTA_PAINEL(arquivos, suites, quantos)}\n\n` +
    `import { readFileSync } from "node:fs";\n\n` +
    `import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";\n\n` +
    `${miolo}\n` +
    driverPainel(suites, rotulo)
  );
}

const NOTA = (arquivoFonte, suite) => `//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-318)
// --------------------------------------------------------
// Este runner era da familia da HMO-246: montava uma arvore temporaria com uma
// lista de DEPENDENCIAS escrita a mao, sintetizava um tsconfig e disparava
// \`npx tsc\` + \`resolve-aliases\` + \`node --test\` UMA VEZ POR MUTANTE. Entre
// duas voltas mudava UM arquivo, e o programa inteiro era reparseado do zero.
//
// Agora as voltas dividem um processo e um cache de AST (\`criarBlocoDeMutantes\`,
// HMO-319): so o arquivo mutado e reparseado. Tres coisas sairam junto, e as
// tres eram defeito:
//
//   - a lista de DEPENDENCIAS a mao, que envelhecia em silencio e ja deixou
//     runner desta familia abortando por meses (ver o conversor);
//   - o tsconfig repetido a mao, que podia divergir do alvo \`${suite}\`
//     -- agora as etapas saem do proprio package.json;
//   - a saida MUTADA emitida dentro do repositorio, que o \`finally\` tinha de
//     recompilar depois. A sombra emite em /tmp; \`${arquivoFonte}\`
//     e o \`.tmp-*\` do repositorio nao sao tocados em momento nenhum.
//
// A lista de mutantes abaixo nao foi reescrita: ela veio byte a byte do arquivo
// anterior, pelo \`scripts/converte-mutantes-em-bloco.mjs\`.`;

function driver(suite, rotulo) {
  return `
const SUITE = "${suite}";

const bloco = criarBlocoDeMutantes({ rotulo: "${rotulo}", suites: [SUITE] });

// A sombra vive em diretorio temporario. No pior caso sobra um diretorio orfao
// em /tmp -- e nao uma fonte mutada na arvore, que era o modo de falha do
// desenho anterior. O handler de sinal existe para que nem o orfao sobre:
// \`finally\` nao roda em SIGTERM, mas \`process.exit\` dispara o \`exit\` abaixo.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// CONTROLE POSITIVO: a arvore INTACTA tem de passar antes de qualquer mutante,
// e pelo MESMO \`rodar\` que os mutantes usam -- por isso ele pega erro no
// aparelho. Sem ele, uma sombra mal montada reprova TODO mutante e o placar sai
// "N/N mortos" sobre zero assercoes executadas.
const controle = bloco.rodar("controle", {}, SUITE);
if (!controle.verde) {
  console.error(\`ABORTADO: \${FONTE} INTACTO reprova em \${SUITE} (\${controle.como}).\`);
  console.error(\`  \${controle.saida}\`);
  console.error("O placar nao valeria: todo mutante 'morreria' sem ter sido medido.");
  process.exit(1);
}
console.log(\`controle positivo: \${FONTE} intacto passa em \${SUITE}\\n\`);

let falhas = 0;

for (const m of MUTANTES) {
  // \`String.replace\` troca a PRIMEIRA ocorrencia. Um trecho que aparece duas
  // vezes produz um mutante que muta o lugar errado e morre verde com o rotulo
  // mentindo sobre o que foi medido -- por isso o trecho tem de ser UNICO, e
  // nao apenas existir.
  const ocorrencias = original.split(m.de).length - 1;
  if (ocorrencias === 0) {
    console.log(\`  !! \${m.nome}: o trecho a mutar NAO EXISTE MAIS -- mutante invalido\`);
    falhas++;
    continue;
  }
  if (ocorrencias > 1) {
    console.log(\`  !! \${m.nome}: o trecho aparece \${ocorrencias}x -- mutante ambiguo, invalido\`);
    falhas++;
    continue;
  }

  const r = bloco.rodar(m.nome, { [FONTE]: original.replace(m.de, m.para) }, SUITE);

  if (r.verde) {
    console.log(\`  SOBREVIVEU  \${m.nome}  <-- nenhuma assercao protege isto\`);
    console.log(\`              (\${m.porque})\`);
    if (r.mudouASaida === false) {
      console.log("              (saida compilada identica a da arvore limpa: EQUIVALENTE)");
    }
    falhas++;
  } else {
    // Morrer no tsc tambem e morrer -- mutante que nao compila nao chega em
    // producao --, mas a distincao importa: um erro de tipo nao diz que a SUITE
    // pegou a regra.
    console.log(\`  morreu      \${m.nome}  (\${r.como === "tsc" ? "tsc" : "asercao"})\`);
  }
}

console.log();
if (falhas === 0) {
  console.log(\`todos os \${MUTANTES.length} mutantes morreram\`);
} else {
  console.log(\`\${falhas} mutante(s) sobreviveu/sobreviveram ou sao invalidos\`);
  process.exit(1);
}
`;
}

export function converter(fonte, rotulo) {
  const { cabecalho, miolo, arquivoFonte, suite } = recortar(fonte);
  return (
    `${cabecalho}\n${NOTA(arquivoFonte, suite)}\n\n` +
    `import { readFileSync } from "node:fs";\n\n` +
    `import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";\n\n` +
    `${miolo}\n` +
    driver(suite, rotulo)
  );
}

// --- as familias -----------------------------------------------------------
//
// Cada familia traz, alem do seu `recortar`/`converter`, o par de ancoras que
// delimita o miolo DENTRO DO ARQUIVO JA CONVERTIDO. Esse par e o que o
// `--conferir` usa do lado "depois", e ele tem de ser independente do
// `recortar`: se os dois lados da comparacao saissem do MESMO extrator, um
// extrator quebrado truncaria os dois igual e o conferidor passaria vacuo --
// que e, literalmente, o defeito que a HMO-318 cometeu e consertou.

const FAMILIAS = {
  // A ordem importa: `reconhece` e avaliado de cima para baixo.
  painel: {
    reconhece: ehDoPainel,
    recortar: recortarPainel,
    converter: converterPainel,
    // O miolo do convertido comeca na primeira `const NOME = "caminho";` e
    // termina onde o driver comeca.
    mioloDoConvertido: (t) => {
      const m = /^const [A-Z][A-Z_0-9]* = "[^"]+";$/m.exec(t);
      const fim = t.indexOf("\nconst SUITES = ");
      if (!m || fim === -1) return null;
      return t.slice(m.index, fim).trimEnd();
    },
  },
  hmo246: {
    reconhece: (t) => /^const MUTANTES = \[$/m.test(t),
    recortar,
    converter,
    mioloDoConvertido: (t) => {
      const inicio = t.indexOf("const FONTE = ");
      const fim = t.indexOf("\nconst SUITE = ");
      if (inicio === -1 || fim === -1) return null;
      return t.slice(inicio, fim).trimEnd();
    },
  },
};

/** Qual familia e este runner. Lanca se nenhuma reconhecer. */
export function familiaDe(fonte) {
  for (const [nome, familia] of Object.entries(FAMILIAS)) {
    if (familia.reconhece(fonte)) return nome;
  }
  throw new Error(
    "nao reconheci a familia deste runner (nem `const mutantes = [` nem `const MUTANTES = [`)",
  );
}

/**
 * Confere uma conversao: o miolo do convertido tem de ser identico ao miolo do
 * arquivo de ANTES. Devolve a lista de problemas (vazia = passou).
 *
 * AS TRAVAS CONTRA O CONFERIDOR VACUO, e por que sao estas. Comparar duas
 * extracoes e suficiente so enquanto a extracao estiver certa: a primeira versao
 * disto apagou os 14 mutantes de um runner e imprimiu "miolo identico (40
 * bytes)", porque os dois lados foram truncados igual.
 *
 *   1. a CONTAGEM DE MUTANTES e lida do TEXTO FINAL dos dois arquivos, nunca da
 *      extracao. E a trava que pega truncamento simetrico: o arquivo convertido
 *      e escrito A PARTIR da extracao, entao uma extracao truncada produz um
 *      arquivo com menos `nome:` -- e isso aparece aqui mesmo que `a === b`.
 *   2. um PISO por mutante no tamanho do miolo. Pega o caso em que a contagem
 *      sobrevive mas o conteudo de cada entrada nao (uma extracao que guardasse
 *      so a primeira linha de cada mutante, por exemplo).
 *   3. "o arquivo de antes nao tinha mutante nenhum", que pega o alvo errado na
 *      linha de comando antes que ele seja lido como "nada divergiu".
 */
export function conferir(antes, depois, familia = FAMILIAS[familiaDe(antes)]) {
  const a = familia.recortar(antes).miolo;
  const b = familia.mioloDoConvertido(depois);

  const entradas = (t) => (t.match(/^ {2}\{$/gm) ?? []).length;
  const nomes = (t) => (t.match(/^ {4}nome: /gm) ?? []).length;
  const antesN = nomes(antes);
  const depoisN = nomes(depois);

  const problemas = [];
  if (b === null) {
    problemas.push("nao achei o miolo no arquivo convertido (ancoras do driver ausentes)");
  } else if (a !== b) {
    problemas.push(`miolo diferente (${a.length}B antes, ${b.length}B depois)`);
  }
  if (antesN === 0) {
    problemas.push("o arquivo de antes nao tinha mutante nenhum -- extracao suspeita");
  }
  if (antesN !== depoisN) problemas.push(`${antesN} mutantes antes, ${depoisN} depois`);
  if (b !== null && entradas(a) !== entradas(b)) {
    problemas.push("numero de entradas da lista mudou");
  }
  // O PISO. 100 bytes por mutante e folgado de proposito -- o menor miolo real
  // deste repositorio passa de 1 KB para 11 mutantes --, e o que ele precisa
  // pegar e a ordem de grandeza errada, nao um byte a menos.
  if (depoisN > 0 && a.length < 100 * depoisN) {
    problemas.push(`miolo curto demais: ${a.length}B para ${depoisN} mutantes (piso ${100 * depoisN}B)`);
  }
  return problemas;
}

// --- linha de comando ------------------------------------------------------
//
// Importado como modulo (pelo controle negativo), `process.argv` nao tem alvo e
// nada abaixo roda -- e por isso o `conferir`/`converter` sao exportados.

const args = process.argv.slice(2);
const soConferir = args[0] === "--conferir";
const alvos = soConferir ? args.slice(1) : args;

if (alvos.length > 0) {
  let ruim = 0;
  for (const alvo of alvos) {
    const rotulo = path.basename(alvo).replace(/^mutantes-/, "").replace(/\.mjs$/, "");
    const atual = readFileSync(alvo, "utf8");

    if (soConferir) {
      // O arquivo de ANTES (pre-conversao) vem pelo ambiente, extraido do git.
      const antes = readFileSync(process.env.ANTES, "utf8");
      const familia = FAMILIAS[familiaDe(antes)];
      const problemas = conferir(antes, atual, familia);
      const quantos = (atual.match(/^ {4}nome: /gm) ?? []).length;

      if (problemas.length === 0) {
        console.log(`OK    ${alvo}: ${quantos} mutantes, miolo identico`);
      } else {
        console.log(`DIFERE ${alvo}: ${problemas.join("; ")}`);
        ruim++;
      }
      continue;
    }

    const nomeDaFamilia = familiaDe(atual);
    writeFileSync(alvo, FAMILIAS[nomeDaFamilia].converter(atual, rotulo));
    console.log(`convertido  ${alvo}  (familia ${nomeDaFamilia})`);
  }
  process.exit(ruim === 0 ? 0 : 1);
} else if (process.argv[1]?.endsWith("converte-mutantes-em-bloco.mjs")) {
  console.error("uso: node scripts/converte-mutantes-em-bloco.mjs [--conferir] <runner.mjs> ...");
  process.exit(2);
}
