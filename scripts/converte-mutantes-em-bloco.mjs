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

/**
 * Tira do cabecalho as secoes cujo titulo casa com `SECOES_MORTAS`.
 *
 * Uma secao vai do seu titulo ate o titulo seguinte (ou o fim). Os titulos sao
 * detectados por MAIUSCULAS e nao pela linha de tracinhos, porque nem toda
 * secao deste repositorio tem a linha de tracinhos -- `COMO RODAR` nao tem, e
 * cortar por tracinho a engoliria junto com a secao anterior.
 */
function podarCabecalho(cabecalho) {
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

  for (const morta of ["DEPENDENCIAS", "SAIDA", "TESTE"]) {
    miolo = removerDeclaracao(miolo, morta);
  }

  return {
    cabecalho,
    miolo: miolo.trimEnd(),
    arquivoFonte: mFonte[1],
    suite: mSuite[1],
  };
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

// --- linha de comando ------------------------------------------------------

const args = process.argv.slice(2);
const conferir = args[0] === "--conferir";
const alvos = conferir ? args.slice(1) : args;

if (alvos.length === 0) {
  console.error("uso: node scripts/converte-mutantes-em-bloco.mjs [--conferir] <runner.mjs> ...");
  process.exit(2);
}

let ruim = 0;
for (const alvo of alvos) {
  const rotulo = path.basename(alvo).replace(/^mutantes-/, "").replace(/\.mjs$/, "");
  const atual = readFileSync(alvo, "utf8");

  if (conferir) {
    // PROVA DE QUE A LISTA NAO DIVERGIU: o miolo do arquivo convertido tem de
    // ser identico ao miolo do arquivo de ANTES (passado pelo stdin do git).
    const antes = readFileSync(process.env.ANTES, "utf8");
    const a = recortar(antes).miolo;
    const b = atual.slice(atual.indexOf("const FONTE = "), atual.indexOf("\nconst SUITE = ")).trimEnd();

    // AS DUAS TRAVAS CONTRA O CONFERIDOR VACUO. Comparar duas extracoes e
    // suficiente so enquanto a extracao estiver certa: a primeira versao disto
    // apagou os 14 mutantes de um runner e imprimiu "miolo identico (40 bytes)",
    // porque os dois lados foram truncados igual. O numero de mutantes e
    // contado no TEXTO FINAL do arquivo convertido -- nao na extracao -- e
    // comparado com o do arquivo de antes.
    const contar = (t) => (t.match(/^ {2}\{$/gm) ?? []).length;
    const nomes = (t) => (t.match(/^ {4}nome: /gm) ?? []).length;
    const antesN = nomes(antes);
    const depoisN = nomes(atual);

    const problemas = [];
    if (a !== b) problemas.push(`miolo diferente (${a.length}B antes, ${b.length}B depois)`);
    if (antesN === 0) problemas.push("o arquivo de antes nao tinha mutante nenhum -- extracao suspeita");
    if (antesN !== depoisN) problemas.push(`${antesN} mutantes antes, ${depoisN} depois`);
    if (contar(a) !== contar(b)) problemas.push("numero de entradas da lista mudou");

    if (problemas.length === 0) {
      console.log(`OK    ${alvo}: ${depoisN} mutantes, miolo identico (${a.length} bytes)`);
    } else {
      console.log(`DIFERE ${alvo}: ${problemas.join("; ")}`);
      ruim++;
    }
    continue;
  }

  writeFileSync(alvo, converter(atual, rotulo));
  console.log(`convertido  ${alvo}`);
}

process.exit(ruim === 0 ? 0 : 1);
