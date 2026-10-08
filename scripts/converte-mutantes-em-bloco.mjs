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
 * Para `const NOME = [` multilinha, corta ate o `];` na coluna 0 -- ou ate o
 * `fecho` que o chamador passar.
 *
 * `fecho` E PARAMETRO POR UM MOTIVO MEDIDO, NAO POR GENERALIDADE. A familia
 * tupla (HMO-334) declara `const fontes = new Map([`, que fecha em `\n]);` e
 * NAO em `\n];`. Com o fecho fixo, o primeiro `\n];` depois dela e o que fecha
 * a LISTA DE MUTANTES -- e o corte levaria a lista inteira. E, byte a byte, o
 * mesmo estrago que a HMO-318 cometeu em `mutantes-periodo-do-grupo` e que o
 * comentario abaixo descreve; a diferenca e que aqui ele era garantido, nao
 * acidental.
 */
function removerDeclaracao(texto, nome, fecho = "\n];") {
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
    const fecha = texto.indexOf(fecho, inicio);
    if (fecha === -1) throw new Error(`${nome}: declaracao multilinha sem fechamento`);
    fim = fecha + fecho.length;
  }
  // Come a quebra de linha seguinte, para nao deixar linha em branco dupla.
  let depois = fim;
  if (texto[depois] === "\n") depois++;
  return texto.slice(0, inicio) + texto.slice(depois);
}

/**
 * Tira uma declaracao `function NOME(...) { ... }` do texto, junto com o bloco
 * de comentarios colado acima dela. Devolve o texto sem ela.
 *
 * O fim e o primeiro `^}` na coluna 0 -- o que basta porque a funcao esta no
 * topo do modulo e nada dentro dela e indentado a zero.
 *
 * Existe para a familia tupla, onde o "roda a suite e diz se ficou vermelha" e
 * uma FUNCAO (`vermelha`, `suiteVermelha`) e nao uma constante. O bloco a
 * substitui por `bloco.rodar`, entao deixa-la no arquivo convertido seria um
 * `execSync("npm run ...")` orfao -- codigo morto que ainda roda a suite de
 * verdade se alguem o chamar, e um aviso de lint garantido.
 */
function removerFuncao(texto, nome) {
  const m = new RegExp(`^function ${nome}\\(`, "m").exec(texto);
  if (!m) return texto;
  let inicio = m.index;
  // O bloco de comentario colado acima: sobe enquanto as linhas anteriores
  // forem `//` ou `/** ... */` sem linha em branco no meio.
  const antes = texto.slice(0, inicio).split("\n");
  antes.pop(); // a linha vazia que o split deixa no fim
  let quantas = 0;
  for (let i = antes.length - 1; i >= 0; i--) {
    if (/^\s*(\/\/|\/\*\*|\*|\*\/)/.test(antes[i])) quantas++;
    else break;
  }
  for (let i = 0; i < quantas; i++) inicio -= antes[antes.length - 1 - i].length + 1;

  const fecha = texto.indexOf("\n}", m.index);
  if (fecha === -1) throw new Error(`${nome}: funcao sem fechamento na coluna 0`);
  let fim = fecha + "\n}".length;
  if (texto[fim] === "\n") fim++;
  return texto.slice(0, inicio) + texto.slice(fim);
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

// ===========================================================================
// A TERCEIRA FAMILIA: "tupla" (HMO-334)
// ===========================================================================
// Cinco runners -- `parte-do-grupo`, `divisao-do-grupo`, `divisao-configurada`,
// `lancamentos-completos` e `pagador-da-parte` -- declaram os mutantes como
// TUPLA (`[nome, de, para]`) e nao como objeto. E so isso que os separa da
// familia do painel, e e o bastante para que o conversor dela os estrague:
//
//   do painel                        | tupla
//   ---------------------------------+------------------------------------------
//   `const mutantes = [`             | `const mutantes = [`   (igual!)
//   entradas `{ nome:, arquivo:, }`  | entradas `[nome, de, para]`
//   `arquivo:` POR MUTANTE           | o alvo vem de uma `const` do modulo
//   `readFileSync` no driver gerado  | `const original = readFileSync(ALVO)` no MIOLO
//
// A terceira linha e a que o `ehDoPainel` usa para recusa-los, e a HMO-328 ja
// mediu o que acontece sem ela: reconhecer so por `const mutantes = [` fez o
// conversor aceitar `cartao-orcamento-grupo` e cuspir um arquivo que nem
// carregava. Por isso `ehTupla` exige a ENTRADA EM FORMA DE LISTA (`^ {2}\[$`),
// que e zero nos cinco runners do painel e nos da HMO-246.
//
// AS DUAS ARIDADES, E POR QUE A ISSUE ERRAVA NISTO
// -----------------------------------------------
// A HMO-334 supunha "um ALVO so por runner (nao e multi-arquivo)". Dois dos
// cinco desmentem: `lancamentos-completos` e `pagador-da-parte` mutam DOIS
// arquivos cada, por um `const fontes = new Map([...])` e uma tupla de QUATRO
// (`[alvo, nome, de, para]`). Converter os dois como se fossem de alvo unico
// produziria um runner que muta sempre o primeiro arquivo -- e os mutantes do
// segundo "morreriam" medindo outra coisa.
//
// A aridade e lida de DUAS fontes independentes (a `const fontes` e a forma da
// primeira entrada) e o conversor EXIGE que concordem. Uma so bastaria para
// converter; duas e o que transforma um erro de leitura em uma excecao em vez
// de um arquivo errado.
//
// O QUE SAI DO MIOLO, ALEM DO QUE JA SAIA
// ---------------------------------------
// `const original = readFileSync(ALVO, "utf8")` e `const fontes = new Map(...)`
// sao MORTAS no desenho de bloco, do mesmo jeito que `DEPENDENCIAS` e morta na
// familia HMO-246: o driver novo le o original por conta propria. Sai tambem o
// `const SUITE = "npm run test:x"` (o bloco quer o NOME da suite, `test:x`, nao
// a linha de comando) e a funcao que rodava a suite (`vermelha`,
// `suiteVermelha`), que `bloco.rodar` substitui.
//
// A TRAVA DE OCORRENCIA UNICA, QUE AQUI MUDOU O PLACAR
// ----------------------------------------------------
// Como na familia do painel, tres destes cinco so tinham `includes(de)` -- quem
// ja tinha a trava de ambiguidade era `divisao-configurada` e `pagador-da-parte`.
// Acrescenta-la aos outros tres muda o placar se algum `de` aparecer duas vezes,
// e na HMO-328 a medida deu zero e a trava entrou de graca.
//
// AQUI NAO DEU ZERO. `scripts/mede-ancora-ambigua.mjs`, estendido a esta
// familia, leu 292 mutantes em 14 runners das duas e achou TRES ambiguos, os
// tres em `mutantes-parte-do-grupo` -- porque `lib/parte-do-grupo.ts` tem dois
// pares de trechos identicos em funcoes diferentes:
//
//   `if (!groupId) return cheio;`                     -> parteConfiguradaDoMembro
//                                                        E parteDoMembro
//   `if (linha.status && ... !== "active") continue;` -> montarParticipantesPorGrupo
//                                                        E contarMembrosAtivos
//
// O runner antigo mutava a PRIMEIRA ocorrencia e a suite ficava vermelha, entao
// os tres apareciam como mortos. O que ninguem sabia e QUAL das duas funcoes
// estava sendo medida -- e as outras duas seguiam sem mutante nenhum. A trava
// nao criou o defeito; ela o tornou visivel.
//
// Os tres `de` foram desambiguados num commit SEPARADO do da conversao,
// estendidos com a linha seguinte de cada funcao, de modo a casar exatamente o
// trecho que o runner antigo ja mutava. Veredito final identico ao de antes
// (12/12), agora com o rotulo dizendo a verdade sobre onde mediu.
// ===========================================================================

/**
 * Este runner e da familia tupla?
 *
 * `^ {2}\[$` -- uma entrada da lista que ABRE COM `[` na coluna 2 -- e o que
 * separa esta familia das outras duas. Medido nas tres: zero nos cinco runners
 * do painel (entradas em `{`) e zero nos da HMO-246 (que ainda por cima usam
 * `MUTANTES` em maiuscula).
 */
export const ehTupla = (fonte) =>
  /^const mutantes = \[$/m.test(fonte) && /^ {2}\[$/m.test(fonte);

/**
 * 3 (`[nome, de, para]`, um alvo) ou 4 (`[alvo, nome, de, para]`, multi-alvo).
 *
 * Lanca se as duas leituras discordarem -- ver a secao da familia acima.
 */
export function aridadeDaTupla(fonte) {
  const temFontes = /^const fontes = new Map\(\[$/m.test(fonte);
  // A primeira entrada comeca com uma REFERENCIA A CONSTANTE (`DESTINO,`) e nao
  // com o rotulo entre aspas. Lida pela entrada ANCORADA, e nao por `/m` sobre o
  // arquivo -- ver `primeiraEntradaDaLista`.
  const entradaComAlvo = /^ {4}[A-Z][A-Z_0-9]*,$/m.test(primeiraEntradaDaLista(fonte));
  if (temFontes !== entradaComAlvo) {
    throw new Error(
      `aridade ambigua: \`const fontes = new Map([\` ${temFontes ? "existe" : "nao existe"}, ` +
        `mas a 1a entrada ${entradaComAlvo ? "" : "nao "}comeca por uma constante de arquivo`,
    );
  }
  return temFontes ? 4 : 3;
}

/** A suite deste runner, pelo NOME (`test:x`) -- nunca pela linha de comando. */
function suiteDaTupla(fonte) {
  // `const SUITE = "npm run test:x";` (com ou sem o `npm run`, que o bloco nao
  // quer: ele resolve as etapas pelo `scripts[...]` do package.json).
  const constante = /^const SUITE = "(?:npm run )?(test:[a-z0-9:-]+)";$/m.exec(fonte);
  if (constante) return constante[1];
  // Ou a suite esta inline no `execSync` do driver.
  const inline = /execSync\("npm run (test:[a-z0-9:-]+)"/.exec(fonte);
  if (inline) return inline[1];
  throw new Error('nao achei a suite (nem `const SUITE = "..."` nem `execSync("npm run ...")`)');
}

/**
 * Recorta o miolo de um runner da familia tupla: da PRIMEIRA constante de
 * arquivo ate o `];` que fecha `mutantes`, menos as declaracoes mortas.
 *
 * As constantes de arquivo PRECISAM sobreviver ao corte, e nao por elegancia: na
 * aridade 4 a propria lista as referencia por nome (`[DESTINO, "...", ...]`), e
 * um miolo sem elas nao carrega.
 */
export function mioloDaTupla(fonte) {
  const mLista = /^const mutantes = \[$/m.exec(fonte);
  if (!mLista) throw new Error("nao achei `const mutantes = [`");

  const antesDaLista = fonte.slice(0, mLista.index);
  // O filtro do `test:` cobre as duas formas em que a suite aparece como
  // constante de string: `"test:x"` e `"npm run test:x"`. Sem ele, um runner com
  // `const SUITE` declarada ANTES do `const ALVO` teria o miolo comecando na
  // linha da suite -- e `divisao-configurada` declara exatamente nessa ordem.
  const constantes = [...antesDaLista.matchAll(/^const ([A-Z][A-Z_0-9]*) = "([^"]+)";$/gm)].filter(
    (m) => !/^(npm run )?test:/.test(m[2]),
  );
  if (constantes.length === 0) {
    throw new Error('nao achei nenhuma `const NOME = "caminho";` antes da lista');
  }

  let miolo = fonte.slice(constantes[0].index, fimDaLista(fonte, mLista.index));

  miolo = removerDeclaracao(miolo, "SUITE");
  miolo = removerDeclaracao(miolo, "original");
  // `fontes` fecha em `]);`, nao em `];` -- ver `removerDeclaracao`.
  miolo = removerDeclaracao(miolo, "fontes", "\n]);");
  for (const morta of ["vermelha", "suiteVermelha"]) miolo = removerFuncao(miolo, morta);

  // AS LINHAS EM BRANCO QUE AS REMOCOES DEIXARAM, e o recorte apertado em volta
  // delas. Tirar `const fontes = new Map([...])` do meio de duas linhas vazias
  // deixa duas vazias seguidas -- em `lancamentos-completos`, `pagador-da-parte`
  // (tres!) e `divisao-configurada`. E so cosmetico, mas a cosmetica aqui e o
  // que faz `npm run lint-tudo` passar sem aviso.
  //
  // O COLAPSO PARA ANTES DA LISTA, de proposito. Aplicado ao miolo inteiro ele
  // seria SIMETRICO -- os dois lados do `conferir` leem o mesmo texto colapsado
  // --, e por isso invisivel: um runner futuro desta familia com duas linhas
  // vazias dentro da lista as perderia em silencio, e "a lista vem byte a byte"
  // deixaria de ser verdade sem nada acusar. Limitado as declaracoes, a promessa
  // vale sem clausula. (Medido: nenhum dos cinco tem blanco duplo em lugar
  // nenhum, entao hoje o recorte nao muda o resultado -- ele muda o que o
  // conversor garante ao PROXIMO.)
  const abre = miolo.indexOf("const mutantes = [");
  if (abre === -1) throw new Error("o miolo recortado perdeu o `const mutantes = [`");
  miolo = miolo.slice(0, abre).replace(/\n{3,}/g, "\n\n") + miolo.slice(abre);

  return {
    miolo: miolo.trimEnd(),
    arquivos: constantes.map((m) => m[2]),
  };
}

export function recortarTupla(fonte) {
  const mImport = /^import /m.exec(fonte);
  if (!mImport) throw new Error("nao achei o bloco de imports");

  return {
    cabecalho: podarCabecalho(fonte.slice(0, mImport.index).trimEnd(), PARAGRAFOS_MORTOS),
    ...mioloDaTupla(fonte),
    suite: suiteDaTupla(fonte),
    aridade: aridadeDaTupla(fonte),
  };
}

const NOTA_TUPLA = (arquivos, suite, quantos, aridade) => `//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-334)
// --------------------------------------------------------
// Este runner MUTAVA A ARVORE RASTREADA: guardava o texto original em memoria,
// escrevia o mutante ${aridade === 4 ? `num dos ${arquivos.length} arquivos de producao da lista` : `em \`${arquivos[0]}\``},
// chamava \`npm run ${suite}\` ali mesmo e restaurava depois. Dois defeitos
// nisso, e o segundo e o que doia:
//
//   1. cada uma das ${quantos} voltas recompilava o programa INTEIRO, mesmo
//      mudando UM arquivo;
//
//   2. o mutante ficava GRAVADO no arquivo de producao quando o processo morria
//      no meio. A restauracao era um \`writeFileSync\` depois do laco -- que nao
//      roda em SIGTERM, e SIGTERM e o que um timeout manda. Pior: \`execSync\`
//      bloqueia a thread do JS, entao nem um handler de SIGTERM resolveria; o
//      processo termina a volta em curso e aplica A SEGUINTE. Aconteceu nesta
//      arvore duas vezes (\`PainelDePapel.tsx\` na HMO-296, e \`DivisaoDoGrupo.tsx\`
//      herdado mutado pela HMO-263 -- por um runner DESTA familia), e nas duas
//      o \`git status\` mostrava UM arquivo modificado: a cara de trabalho em
//      andamento.
//
// Agora as voltas dividem um processo e um cache de AST
// (\`criarBlocoDeMutantes\`, HMO-319): so o arquivo mutado e reparseado, e a
// mutacao vai para uma SOMBRA em diretorio temporario. A arvore rastreada e o
// \`.tmp-*\` do repositorio nao sao tocados em momento nenhum, entao o pior caso
// de um processo morto e um diretorio orfao em /tmp.
//
// As etapas da suite saem do proprio \`scripts["${suite}"]\` do package.json -- o
// comando que o CI roda --, e nao de uma receita repetida a mao aqui.
//
// A lista de mutantes abaixo NAO foi reescrita: ela veio byte a byte do arquivo
// anterior, pelo \`scripts/converte-mutantes-em-bloco.mjs\`.`;

function driverTupla(suite, rotulo, aridade) {
  const quatro = aridade === 4;
  return `
const SUITE = "${suite}";

const bloco = criarBlocoDeMutantes({ rotulo: "${rotulo}", suites: [SUITE] });

// A sombra vive em diretorio temporario, e a arvore rastreada nunca e mutada --
// era esse o modo de falha deste runner. O handler de sinal existe so para que
// nem o diretorio orfao sobre: o fim do laco nao roda em SIGTERM, mas
// \`process.exit\` dispara o \`exit\` abaixo.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// O texto de cada arquivo que algum mutante toca. Lido da arvore de verdade, que
// e o original por construcao: nada mais aqui escreve nela.
const original = new Map();
for (const arquivo of ${quatro ? "new Set(mutantes.map(([alvo]) => alvo))" : "[ALVO]"}) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO: a arvore INTACTA tem de passar antes de qualquer mutante,
// e pelo MESMO \`rodar\` que os mutantes usam -- por isso ele pega erro no
// aparelho. Sem ele, uma sombra mal montada reprova TODO mutante e o placar sai
// "N/N mortos" sobre zero assercoes executadas.
const controle = bloco.rodar("controle", {}, SUITE);
if (!controle.verde) {
  console.error(\`ABORTADO: a arvore INTACTA reprova em \${SUITE} (\${controle.como}).\`);
  console.error(\`  \${controle.saida}\`);
  console.error("O placar nao valeria: todo mutante 'morreria' sem ter sido medido.");
  process.exit(1);
}
console.log(\`controle positivo: a arvore intacta passa em \${SUITE}\\n\`);

let sobreviventes = 0;

for (const [${quatro ? "alvo, nome, de, para" : "nome, de, para"}] of mutantes) {${
    quatro
      ? ""
      : `
  const alvo = ALVO;`
  }
  const antes = original.get(alvo);

  // AS TRES TRAVAS DE ANCORA. A primeira e a terceira ja existiam neste runner;
  // a do meio e a que a conversao acrescenta (ver OCORRENCIA UNICA, no
  // conversor): \`String.replace\` troca a PRIMEIRA ocorrencia, e um \`de\` que
  // aparece duas vezes muta um lugar que o rotulo nao descreve.
  const ocorrencias = antes.split(de).length - 1;
  if (ocorrencias === 0) {
    console.error(\`SOBREVIVEU (ancora nao casou) :: \${nome}\`);
    console.error(\`  o texto buscado nao existe em \${alvo}: \${de}\`);
    sobreviventes++;
    continue;
  }
  if (ocorrencias > 1) {
    console.error(\`SOBREVIVEU (ancora ambigua) :: \${nome}\`);
    console.error(\`  o texto aparece \${ocorrencias}x em \${alvo} -- o replace muta so a 1a\`);
    sobreviventes++;
    continue;
  }
  const depois = antes.replace(de, para);
  if (depois === antes) {
    console.error(\`SOBREVIVEU (replace nao mudou nada) :: \${nome}\`);
    sobreviventes++;
    continue;
  }

  const r = bloco.rodar(nome, { [alvo]: depois }, SUITE);

  if (r.verde) {
    console.error(\`SOBREVIVEU :: \${nome}\`);
    if (r.mudouASaida === false) {
      console.error("  (saida compilada identica a da arvore limpa: EQUIVALENTE)");
    }
    sobreviventes++;
  } else {
    // Morrer no tsc tambem e morrer -- mutante que nao compila nao chega em
    // producao --, mas a distincao importa: um erro de tipo nao diz que a SUITE
    // pegou a regra.
    console.log(\`morreu     :: \${nome}  (\${r.como === "tsc" ? "tsc" : "asercao"})\`);
  }
}

console.log(\`\\n\${mutantes.length - sobreviventes}/\${mutantes.length} mortos\`);
process.exit(sobreviventes === 0 ? 0 : 1);
`;
}

/**
 * As linhas de dentro da PRIMEIRA entrada da lista de mutantes.
 *
 * ANCORADA NA PRIMEIRA ENTRADA DE VERDADE, e isto foi medido: com a regex solta
 * (`/m` sobre o texto todo) e o quantificador preguicoso, uma primeira entrada
 * que o fecho nao casasse era SALTADA em silencio -- a regex seguia e casava a
 * SEGUNDA. Funciona por acidente enquanto todas as entradas tem a mesma
 * aridade, e e exatamente o tipo de leitura que mente quando uma nao tem.
 * Cortando o texto no primeiro `[` da lista, "nao casou" passa a ser erro em vez
 * de resposta sobre outra entrada.
 */
function primeiraEntradaDaLista(miolo) {
  const mLista = /^const mutantes = \[$/m.exec(miolo);
  const daLista = mLista ? miolo.slice(mLista.index) : miolo;
  const abre = /^ {2}\[$/m.exec(daLista);
  if (!abre) throw new Error("a lista de mutantes nao tem entrada nenhuma em forma de tupla");
  // `^ {2,6}\],?$` -- o fecho aceita indentacao frouxa porque ela existe:
  // `mutantes-lancamentos-completos` fecha uma entrada com quatro espacos. Aqui
  // isso decide algo, ao contrario da contagem de `entradas`: sem a folga, o
  // conversor recusaria um runner bom.
  //
  // `m.index !== 0` E A ANCORA, e e ela que o `/m` obriga a escrever. Sem `/m` o
  // `$` so casa no fim da STRING e nenhuma entrada casa; com `/m` o `^` volta a
  // poder casar em qualquer linha, e e assim que a versao anterior desta leitura
  // pulava a primeira entrada e respondia sobre a segunda. Exigir que o casamento
  // comece no byte zero do recorte e o que torna "a primeira entrada nao casou"
  // um erro, e nao uma resposta sobre outra.
  const m = /^ {2}\[\n((?: {4}.*\n)+?) {2,6}\],?$/m.exec(daLista.slice(abre.index));
  if (!m || m.index !== 0) {
    throw new Error("nao consegui ler a primeira entrada da lista de mutantes");
  }
  return m[1];
}

/**
 * Quantos elementos tem a PRIMEIRA entrada da lista, contados na lista mesmo.
 *
 * A TERCEIRA LEITURA DA ARIDADE, e a que fecha um furo que o `conferir` nao
 * fecha. `conferir` compara MIOLO, e o miolo nao muda com a aridade: um runner
 * de tupla-4 convertido como se fosse de 3 confere OK byte a byte e gera um
 * driver que faz `for (const [nome, de, para] of mutantes)` sobre entradas de
 * quatro -- `nome` recebe a constante do arquivo, `de` recebe o rotulo, e todo
 * mutante "morre" por ancora inexistente. Placar cheio, zero medido.
 *
 * Por isso a aridade e conferida contra a lista antes de escrever o arquivo, e
 * nao contra as duas pistas que `aridadeDaTupla` ja cruzou: se as tres
 * discordarem, o conversor lanca em vez de produzir o driver errado.
 *
 * E A UNICA DAS TRES LEITURAS QUE FUNCIONA DEPOIS DA CONVERSAO, e por isso ela e
 * exportada. As outras duas se apoiam em coisas que a conversao APAGA -- a
 * `const fontes = new Map` sai do miolo --, entao `aridadeDaTupla` lanca num
 * runner ja convertido. Quem precisa ler a aridade de um runner qualquer, no
 * estado em que ele esta (o `mede-ancora-ambigua.mjs`), tem de ler a FORMA DA
 * LISTA, que a conversao preserva byte a byte.
 */
export function elementosDaPrimeiraEntrada(miolo) {
  // Os elementos sao as linhas de nivel 4 que NAO sao comentario: o rotulo e os
  // textos sao strings de uma linha so, e o alvo (na aridade 4) e um identificador.
  return primeiraEntradaDaLista(miolo)
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("//")).length;
}

export function converterTupla(fonte, rotulo) {
  const { cabecalho, miolo, arquivos, suite, aridade } = recortarTupla(fonte);
  const quantos = (miolo.match(/^ {2}\[$/gm) ?? []).length;

  const elementos = elementosDaPrimeiraEntrada(miolo);
  if (elementos !== aridade) {
    throw new Error(
      `aridade ${aridade} mas a 1a entrada tem ${elementos} elementos -- ` +
        "o driver gerado desempacotaria a tupla errada",
    );
  }

  return (
    `${cabecalho}\n${NOTA_TUPLA(arquivos, suite, quantos, aridade)}\n\n` +
    `import { readFileSync } from "node:fs";\n\n` +
    `import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";\n\n` +
    `${miolo}\n` +
    driverTupla(suite, rotulo, aridade)
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

// AS DUAS CONTAGENS SAO POR FAMILIA, E NAO HA COMO NAO SEREM (HMO-334). As
// travas do `conferir` contam mutantes pelo texto final: `^    nome: ` numa
// lista de OBJETOS e `^  [` numa lista de TUPLAS. Com a contagem do objeto
// aplicada a uma tupla, `antesN` e `depoisN` dao ZERO nos dois lados -- a trava
// de contagem some, o piso de tamanho some com ela (ele e `100 * depoisN`), e
// sobra so `a !== b`: exatamente o conferidor de UMA trava que a HMO-318
// mostrou ser insuficiente. A unica coisa que acusaria seria a trava 3 ("o
// arquivo de antes nao tinha mutante nenhum"), e ela acusaria TODA conversao
// desta familia, inclusive a certa.
//
// `contar` E A TRAVA FORTE, E `entradas` NAO E. Vale dizer qual e qual, porque
// as duas parecem simetricas na lista de problemas e nao sao: `contar` le o
// TEXTO FINAL dos dois arquivos, que e assimetrico (o convertido foi escrito A
// PARTIR da extracao, o de antes nao), e e so por isso que ele pega truncamento
// igual nos dois lados. `entradas` compara `entradas(a)` com `entradas(b)`, e os
// dois saem de miolos que, numa conversao certa, sao o mesmo texto -- ele nunca
// divergir sozinho, e o que ele acrescenta ao `a !== b` e uma mensagem mais
// especifica, nao uma deteccao a mais. Medido: trocar a forma do fecho aqui nao
// muda veredito nenhum (o controle negativo da familia registra a mutacao).
//
// A indentacao frouxa (2 a 6) e por um caso real -- `mutantes-lancamentos-
// completos` fecha UMA entrada com quatro espacos em vez de dois, na linha 138
// --, mas o lugar onde ela decide algo e `elementosDaPrimeiraEntrada`, que le a
// lista para ESCOLHER a aridade. La um fecho rigido faz o conversor recusar um
// runner bom, e e la que o controle negativo mede.
const CONTA_OBJETO = {
  contar: (t) => (t.match(/^ {4}nome: /gm) ?? []).length,
  entradas: (t) => (t.match(/^ {2}\{$/gm) ?? []).length,
};

const FAMILIAS = {
  // A ordem importa: `reconhece` e avaliado de cima para baixo.
  painel: {
    reconhece: ehDoPainel,
    recortar: recortarPainel,
    converter: converterPainel,
    ...CONTA_OBJETO,
    // O miolo do convertido comeca na primeira `const NOME = "caminho";` e
    // termina onde o driver comeca.
    mioloDoConvertido: (t) => {
      const m = /^const [A-Z][A-Z_0-9]* = "[^"]+";$/m.exec(t);
      const fim = t.indexOf("\nconst SUITES = ");
      if (!m || fim === -1) return null;
      return t.slice(m.index, fim).trimEnd();
    },
  },
  // ANTES da `hmo246` e DEPOIS da `painel`, mas a ordem nao e o que a protege:
  // os tres predicados sao mutuamente exclusivos por construcao (objeto com
  // `arquivo:` / tupla em `[` / `MUTANTES` em maiuscula), e e o controle
  // negativo da familia que cobra isso dos tres, nos dois sentidos.
  tupla: {
    reconhece: ehTupla,
    recortar: recortarTupla,
    converter: converterTupla,
    contar: (t) => (t.match(/^ {2}\[$/gm) ?? []).length,
    entradas: (t) => (t.match(/^ {2,6}\],?$/gm) ?? []).length,
    // Comeca na primeira constante de arquivo -- a mesma ancora da familia do
    // painel, e pela mesma razao: o `const SUITE = ` que o driver gera vem
    // DEPOIS da lista, entao serve de fim.
    mioloDoConvertido: (t) => {
      const m = /^const [A-Z][A-Z_0-9]* = "[^"]+";$/m.exec(t);
      const fim = t.indexOf("\nconst SUITE = ");
      if (!m || fim === -1) return null;
      return t.slice(m.index, fim).trimEnd();
    },
  },
  hmo246: {
    reconhece: (t) => /^const MUTANTES = \[$/m.test(t),
    recortar,
    converter,
    ...CONTA_OBJETO,
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

  const { contar, entradas } = familia;
  const antesN = contar(antes);
  const depoisN = contar(depois);

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
// A CONDICAO E "EU SOU O PROGRAMA", NAO "TEM ARGUMENTO" (HMO-262).
//
// Era `if (alvos.length > 0)`, com o comentario "importado como modulo,
// `process.argv` nao tem alvo e nada abaixo roda". Isso valia para o unico
// importador de entao, que rodava sem argumento alis. Mas `process.argv` e do
// PROCESSO, nao do modulo: quando o importador recebe argumentos proprios, este
// driver os le como se fossem dele.
//
// O estrago medido na main (d995511), com arquivos intactos:
//
//     $ node scripts/mede-ancora-ambigua.mjs scripts/mutantes-parte-do-grupo.mjs
//     convertido  scripts/mutantes-parte-do-grupo.mjs  (familia tupla)
//
// O runner foi REESCRITO EM DISCO e a medicao pedida nunca rodou -- o
// `process.exit` daqui mata o processo antes. O modo por argumento que o
// `mede-ancora-ambigua.mjs` documenta ("[runner.mjs ...]") portanto nao media
// nada e editava arquivo rastreado pelo git, calado.
const args = process.argv.slice(2);
const soConferir = args[0] === "--conferir";
const alvos = soConferir ? args.slice(1) : args;

const souOPrograma = process.argv[1]?.endsWith("converte-mutantes-em-bloco.mjs");

if (souOPrograma && alvos.length > 0) {
  let ruim = 0;
  for (const alvo of alvos) {
    const rotulo = path.basename(alvo).replace(/^mutantes-/, "").replace(/\.mjs$/, "");
    const atual = readFileSync(alvo, "utf8");

    if (soConferir) {
      // O arquivo de ANTES (pre-conversao) vem pelo ambiente, extraido do git.
      const antes = readFileSync(process.env.ANTES, "utf8");
      const familia = FAMILIAS[familiaDe(antes)];
      const problemas = conferir(antes, atual, familia);
      const quantos = familia.contar(atual);

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
} else if (souOPrograma) {
  console.error("uso: node scripts/converte-mutantes-em-bloco.mjs [--conferir] <runner.mjs> ...");
  process.exit(2);
}
