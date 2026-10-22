#!/usr/bin/env node
// =====================================================
// O TETO DE BYTES DOS WORKFLOWS: nenhum arquivo de `.github/workflows/` chega
// perto dos 512.000 bytes em que o GitHub PARA DE DAR PARTIDA
// =====================================================
// Roda com:  npm run check-tamanho-dos-workflows
//
// POR QUE ISTO EXISTE (HMO-473, medida pela HMO-491)
// --------------------------------------------------
// Um workflow acima de 512.000 bytes nao reprova um step: ele NAO ABRE JOB
// NENHUM. A API devolve o run com `jobs: 0`, `conclusion: failure` e nenhum log
// para ler -- e, na lista de workflows, o `name:` do arquivo e substituido pelo
// CAMINHO dele, porque o GitHub nem chegou a parsear o YAML para achar o nome.
//
// O custo medido, e e o pior tipo de custo porque ele se disfarca de verde:
//
//   * `verificacao.yml` passou dos 512.000 em 2026-10-20 (commit def4b80,
//     514.256 bytes) e chegou a 529.779;
//   * dai em diante, as 163 assercoes e os 98 controles negativos desse
//     workflow -- a verificacao INTEIRA deste repositorio, 12 dias de main --
//     nao rodaram NENHUMA VEZ. Os 40 runs seguintes da main saem com `jobs=0`;
//   * a ultima execucao de verdade foi 2026-10-10.
//
// Ninguem percebeu porque o sintoma e indistinguivel de "o CI esta vermelho por
// alguma coisa", e este repositorio tem historico de main vermelha (HMO-199
// contou 57 runs vermelhos seguidos). Um vermelho a mais nao chama atencao; o
// que chama atencao e um vermelho que NOMEIA a causa, e e isso que esta guarda
// faz, no PR que cria o problema, em vez de dias depois.
//
// O QUE ELA AFIRMA
// ----------------
// Que todo arquivo de `.github/workflows/` esta abaixo do TETO PROPRIO, que e
// deliberadamente MENOR que o teto do GitHub. A margem nao e decoracao: a
// medicao da HMO-491 mostrou o `verificacao.yml` crescendo ~10.000 bytes/dia no
// ritmo de entrega de outubro. Um teto cravado em 512.000 reprovaria no commit
// que ESTOURA -- e ai o conserto e urgente e grande. O teto proprio reprova com
// semanas de antecedencia, quando mover a prosa de um step ainda e um PR calmo.
//
// POR QUE ELA RODA NO `build.yml`
// -------------------------------
// Porque o `build.yml` e o unico workflow deste repositorio que NAO tem filtro
// de `paths:` e que esta verde -- ou seja, o unico que sempre da partida. Pôr
// esta guarda dentro do `verificacao.yml` seria pedir que o arquivo doente
// diagnosticasse a propria doenca: acima do teto ele nao abre job, e a guarda
// nao rodaria exatamente na hora em que ela e necessaria.
//
// E ela e o PRIMEIRO step do job, antes do `npm ci`: nao depende de
// `node_modules` (le `fs` e mais nada) e custa milissegundos. Num job de steps
// em serie, step que nasce no fim so roda quando tudo antes dele passa -- e a
// noticia "o CI nao esta dando partida" nao pode depender de uma instalacao.
//
// COMO CONSERTAR QUANDO ELA REPROVAR
// ----------------------------------
// Nao partindo o workflow em dois. O cabecalho do `verificacao.yml` explica por
// que (HMO-261): o custo do Actions esta no JOB, nao no teste -- cada job novo
// paga ~30s de partida mais o arredondamento do minuto, e foi assim que 21
// workflows queimaram 34 min por push. Partir resolve bytes e reabre a conta.
//
// O conserto e tirar PROSA, nao step: 66% dos 529.779 bytes do `verificacao.yml`
// eram comentario. A prosa de step mora em `.github/workflows/verificacao-notas.md`,
// e no YAML fica uma linha de ponteiro. Nenhuma palavra se perde e o arquivo
// cresce ~100 bytes por step novo em vez de ~1.500.
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 512.000, e nao 524.288: o numero esta MEDIDO, nao lido da documentacao. Na
// main, 507.521 bytes ainda abriam job (commit 80ed42a, 2026-10-19) e 514.256
// ja saiam com `jobs: 0` (commit def4b80, 2026-10-20). O teto real esta nesse
// intervalo, e 512.000 e o unico redondo que cabe nele.
export const TETO_DO_GITHUB = 512_000;

// A margem de 62.000 bytes vale ~6 dias no ritmo medido de outubro (~10.000
// bytes/dia) se a prosa voltar para o YAML, e anos se ela ficar no .md -- o
// ponteiro de um step novo custa ~100 bytes.
export const TETO_PROPRIO = 450_000;

// Acima disto a guarda ainda PASSA, mas avisa: o arquivo entrou na faixa em que
// vale mover prosa antes que vire urgencia.
export const FAIXA_DE_AVISO = 360_000;

/** Como encolher cada arquivo, por nome. O recado generico nao serve: o que faz
 *  o `db-verify.yml` crescer e a lista de `paths:` repetida nos dois gatilhos,
 *  e o que faz o `verificacao.yml` crescer e a prosa dos steps. */
function comoEncolher(nome) {
  if (nome === "verificacao.yml") {
    return (
      "mova a prosa dos steps para .github/workflows/verificacao-notas.md e\n" +
      "       deixe no YAML a linha `# nota: verificacao-notas.md -> \"<step>\"`"
    );
  }
  if (nome === "db-verify.yml") {
    return (
      "a lista de `paths:` esta escrita DUAS vezes (push e pull_request) e cresce\n" +
      "       a cada lib nova. Troque nomes de arquivo por globs de pasta -- e cuidado:\n" +
      "       o scripts/check-tests-in-ci.mjs le o `paths:` com /paths:\\s*\\[([^\\]]*)\\]/,\n" +
      "       entao nenhum padrao pode conter `]`"
    );
  }
  return "tire a prosa do YAML para um .md ao lado e deixe um ponteiro de uma linha";
}

function alvo() {
  const i = process.argv.indexOf("--dir");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return join(dirname(dirname(fileURLToPath(import.meta.url))), ".github/workflows");
}

/** Os workflows de uma pasta, medidos e em ordem. Pasta vazia devolve `[]`, e
 *  quem chama tem de recusar esse caso -- medir zero arquivo e o jeito calado
 *  desta guarda morrer, e o controle negativo tem caso para isso. */
export function medir(dir) {
  return readdirSync(dir)
    .filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"))
    .sort()
    .map((nome) => ({ nome, bytes: statSync(join(dir, nome)).size }));
}

// O corpo abaixo so roda quando ESTE arquivo e o programa. O controle negativo
// importa `TETO_PROPRIO` e companhia daqui, e sem esta trava o `import` do teste
// executaria a guarda -- que sai 1 na arvore doente e levaria a suite com ela.
const souOPrograma =
  process.argv[1] &&
  fileURLToPath(new URL(`file://${process.argv[1]}`)).endsWith("check-tamanho-dos-workflows.mjs");

if (souOPrograma) {
const DIR = alvo();
const medidos = medir(DIR);

if (medidos.length === 0) {
  console.error(`Nenhum workflow em ${DIR} -- a verificacao perdeu o alvo.`);
  process.exit(1);
}

const largura = Math.max(...medidos.map((m) => m.nome.length));
for (const m of medidos) {
  const pct = ((m.bytes / TETO_DO_GITHUB) * 100).toFixed(1);
  const folga = TETO_PROPRIO - m.bytes;
  console.log(
    `  ${m.nome.padEnd(largura)}  ${String(m.bytes).padStart(7)} bytes` +
      `  ${pct.padStart(5)}% do teto do GitHub` +
      `  folga ate o teto proprio: ${folga.toLocaleString("pt-BR")}`,
  );
}
console.log();

const estourados = medidos.filter((m) => m.bytes >= TETO_PROPRIO);
if (estourados.length > 0) {
  console.error(
    `Workflow acima do teto proprio de ${TETO_PROPRIO.toLocaleString("pt-BR")} bytes.\n`,
  );
  for (const m of estourados) {
    const passouDoGitHub = m.bytes >= TETO_DO_GITHUB;
    console.error(
      `  ${m.nome}: ${m.bytes.toLocaleString("pt-BR")} bytes` +
        (passouDoGitHub
          ? `  <- JA PASSOU dos ${TETO_DO_GITHUB.toLocaleString("pt-BR")} do GitHub:\n` +
            `       este workflow NAO ESTA DANDO PARTIDA. Os runs dele saem com\n` +
            `       jobs: 0 e nenhum step roda -- a verificacao esta desligada, nao vermelha.`
          : `  (ainda abaixo dos ${TETO_DO_GITHUB.toLocaleString("pt-BR")} do GitHub, mas a margem acabou)`),
    );
    console.error(`       Conserto: ${comoEncolher(m.nome)}\n`);
  }
  console.error(
    "NAO parta o workflow em dois para resolver isto: o custo do Actions esta no\n" +
      "JOB (~30s de partida + arredondamento do minuto), e foi assim que a HMO-261\n" +
      "achou 34 min por push em 21 workflows. Tire PROSA, nao step.",
  );
  process.exit(1);
}

const avisados = medidos.filter((m) => m.bytes >= FAIXA_DE_AVISO);
for (const m of avisados) {
  console.warn(
    `AVISO: ${m.nome} esta em ${m.bytes.toLocaleString("pt-BR")} bytes, ja na faixa de ` +
      `${FAIXA_DE_AVISO.toLocaleString("pt-BR")}+.\n` +
      `       Ainda passa, mas o conserto calmo e agora: ${comoEncolher(m.nome)}.`,
  );
}
if (avisados.length > 0) console.log();

console.log(
  `Nenhum workflow perto do teto: os ${medidos.length} arquivos de .github/workflows/ ` +
    `estao abaixo dos ${TETO_PROPRIO.toLocaleString("pt-BR")} bytes ` +
    `(o GitHub para de dar partida em ${TETO_DO_GITHUB.toLocaleString("pt-BR")}).`,
);
}
