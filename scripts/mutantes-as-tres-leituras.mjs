#!/usr/bin/env node
// =====================================================
// OS MUTANTES DA GUARDA DAS LEITURAS DA AGENDA (HMO-416)
// =====================================================
//   npm run mutantes:as-tres-leituras
//
// `test-as-tres-leituras.mjs` tem 12 casos e prova que a guarda SABE reprovar.
// Ele nao prova que cada decisao da guarda esta MEDIDA por algum caso -- sao
// perguntas diferentes, e a segunda e a que apodrece. Um refator que troque o
// extrator de colunas, ou que pare de olhar o `select` na metade (b), deixa os
// 12 casos verdes se nenhum deles depender daquela linha.
//
// Este runner responde a segunda. Para cada decisao load-bearing da guarda ele
// planta o defeito NO FONTE DELA e exige que o controle negativo fique
// VERMELHO. Mutante que sobrevive e decisao sem assercao -- ou decisao que nao
// precisava existir.
//
// O QUE ELE JA PAGOU, NA PRIMEIRA RODADA
// --------------------------------------
// As metades (a) e (b) do laco das excecoes sao mortas por casos DIFERENTES:
// (a) pelos casos de troca e de omissao de `status`, (b) SO pelos tres casos de
// «acrescentou `my_status` ao lado de `status`». Era a duvida que motivou medir
// -- duas guardas redundantes fazem os DOIS mutantes sobreviverem, e aqui
// nenhuma das duas cobre a outra. Ver
// `duas-guardas-redundantes-fazem-os-dois-mutantes-sobreviverem`.
//
// A SOMBRA, E POR QUE ELA LEVA `app/` INTEIRO
// -------------------------------------------
// A mutacao acontece num `mkdtempSync`, nunca na arvore rastreada: morrer no
// meio -- SIGTERM, SIGKILL, timeout -- nao deixa mutante gravado em `scripts/`.
// A sombra leva a guarda, o controle negativo, `varredura-de-fonte.mjs` e `app/`
// inteiro. `app/` inteiro porque o controle negativo extrai a lista de rotas DO
// FONTE DA GUARDA e abre cada uma: copiar so as doze de hoje faria o runner
// mentir no dia em que a guarda ganhasse a decima terceira.
//
// A IRONIA DELIBERADA, E A RAZAO DE O PLACAR VALER
// ------------------------------------------------
// Se o `de` de um mutante parar de casar no fonte da guarda, `String.replace`
// nao troca nada, o controle negativo roda sobre a guarda INTACTA, sai verde --
// e o mutante seria dado por VIVO medindo nada. Por isso o laco CONFERE cada
// `de` antes de mutar e exige que apareca EXATAMENTE UMA vez: zero e ancora
// morta, mais de uma e ancora ambigua.
//
// E O CONTROLE POSITIVO E O PRIMEIRO: a sombra NAO MUTADA tem de rodar o
// controle negativo e sair 0. Se ela sair vermelha, TODO mutante "morre", o
// placar sai perfeito e nao mediu nada -- um placar perfeito e o disfarce mais
// confortavel desse estado.
// =====================================================

import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ALVO = "scripts/check-as-oito-leituras.mjs";

const mutantes = [
  // -------------------------------------------------------------------------
  // O LACO DAS EXCECOES, metade por metade. As duas assercoes sao o que a
  // HMO-416 acrescentou, e a (b) e a que parecia redundante.
  // -------------------------------------------------------------------------
  [
    "(a) desligada: a coluna da CONTA deixa de ser exigida no lugar declarado",
    "  if (!ondeEsta.some((c) => DO_DONO.includes(c))) {",
    "  if (false) {",
  ],
  [
    "(b) desligada: a coluna da PESSOA passa a ser tolerada na cadeia",
    "  if (daPessoaNaCadeia.length > 0) {",
    "  if (false) {",
  ],
  [
    "(b) olha so o `filtro` -- as duas excecoes da HMO-416 usam o `select`",
    "  const daPessoaNaCadeia = [...filtradas, ...pedidas].filter((c) =>",
    "  const daPessoaNaCadeia = [...filtradas].filter((c) =>",
  ],
  [
    "o laco das excecoes nao roda (a lista vira decoracao)",
    "for (const [arquivo, apelido, onde] of EXCECOES) {",
    "for (const [arquivo, apelido, onde] of []) {",
  ],
  [
    "o `onde` das excecoes e ignorado: o filtro serve pelo select e vice-versa",
    "  const ondeEsta = onde === \"filtro\" ? filtradas : pedidas;\n\n  // (a) a coluna da CONTA, no lugar declarado.",
    "  const ondeEsta = [...filtradas, ...pedidas];\n\n  // (a) a coluna da CONTA, no lugar declarado.",
  ],

  // -------------------------------------------------------------------------
  // O EXTRATOR COMPARTILHADO. Ele serve as duas direcoes desde a HMO-416, e e
  // por isso que estragar um lado aparece nos dois.
  // -------------------------------------------------------------------------
  [
    "o extrator do `select` devolve vazio (`pedidas` sempre [])",
    "  const pedidas = (select?.[1] ?? select?.[2] ?? \"\")",
    "  const pedidas = (\"\")",
  ],
  [
    "o extrator de filtros perde `neq` (o recorte da tela do grupo sai da conta)",
    "  const filtradas = [...cadeia.matchAll(/\\.(?:eq|neq|in|gte|lte)\\(\\s*\"([^\"]+)\"/g)].map(",
    "  const filtradas = [...cadeia.matchAll(/\\.(?:eq|in|gte|lte)\\(\\s*\"([^\"]+)\"/g)].map(",
  ],

  // -------------------------------------------------------------------------
  // A NONA LEITURA e a trava da cadeia ilegivel.
  // -------------------------------------------------------------------------
  [
    "a nona leitura sai de LEITURAS (a troca da HMO-416 deixa de ser medida)",
    "  [\n    \"app/api/card-invoices/route.ts\",\n    \"as previsoes pendentes do cartao\",\n    \"filtro\",\n  ],",
    "",
  ],
  [
    "a cadeia ilegivel de uma EXCECAO passa calada em vez de pedir olho humano",
    "    console.error(\n      `\\n✖ ${arquivo} (${apelido})\\n` +\n        `  nao achei um \\`.from(\"${VIEW}\")\\` legivel.\\n` +\n        \"  ou a excecao saiu da view, ou a forma da cadeia mudou e esta metade \" +\n        \"do guard parou de medir -- as duas pedem olho humano.\"\n    );\n    continue;",
    "    continue;",
  ],
  [
    "`DO_DONO` perde `status` (sobra `effective_status`, e a coluna que doi escapa)",
    'const DO_DONO = ["status", "effective_status"];',
    'const DO_DONO = ["effective_status"];',
  ],
];

const CONTROLE = "scripts/test-as-tres-leituras.mjs";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const original = readFileSync(join(RAIZ, ALVO), "utf8");

/** Roda o controle negativo numa sombra com o fonte da guarda substituido. */
function rodar(fonteDaGuarda) {
  const dir = mkdtempSync(join(tmpdir(), "mut-as-tres-leituras-"));
  try {
    for (const rel of [ALVO, CONTROLE, "scripts/varredura-de-fonte.mjs"]) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      cpSync(join(RAIZ, rel), join(dir, rel));
    }
    cpSync(join(RAIZ, "app"), join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, ALVO), fonteDaGuarda);

    // O reporter TAP e pedido de proposito: o `spec` (o padrao) imprime o nome
    // do caso com a duracao colada e sem marca estavel, e a linha "por: ..."
    // abaixo -- que e o que mostra a metade (b) sendo morta por casos que a (a)
    // nao alcanca -- sairia vazia. Ver `medidor-que-imprime-o-defeito-e-sai-zero`.
    const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", CONTROLE], {
      cwd: dir,
      encoding: "utf8",
    });

    return { verde: r.status === 0, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const controle = rodar(original);
if (!controle.verde) {
  console.error(`ABORTADO: a sombra INTACTA reprova em ${CONTROLE}.`);
  console.error(controle.saida);
  console.error("O placar nao valeria: todo mutante 'morreria' sem ter sido medido.");
  process.exit(1);
}
console.log(`controle positivo: a sombra intacta passa em ${CONTROLE}\n`);

let sobreviventes = 0;

for (const [nome, de, para] of mutantes) {
  const ocorrencias = original.split(de).length - 1;
  if (ocorrencias === 0) {
    console.error(`SOBREVIVEU (ancora nao casou) :: ${nome}`);
    console.error(`  o texto buscado nao existe em ${ALVO}: ${de}`);
    sobreviventes++;
    continue;
  }
  if (ocorrencias > 1) {
    console.error(`SOBREVIVEU (ancora ambigua) :: ${nome}`);
    console.error(`  o texto aparece ${ocorrencias}x em ${ALVO} -- o replace muta so a 1a`);
    sobreviventes++;
    continue;
  }

  const depois = original.replace(de, para);
  if (depois === original) {
    console.error(`SOBREVIVEU (replace nao mudou nada) :: ${nome}`);
    sobreviventes++;
    continue;
  }

  const r = rodar(depois);
  if (r.verde) {
    console.error(`SOBREVIVEU :: ${nome}`);
    sobreviventes++;
  } else {
    // QUAIS casos ficaram vermelhos, e nao so "ficou vermelho": e o que mostra
    // que a metade (b) e morta por casos que a (a) nao alcanca.
    const quais = [...r.saida.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
    console.log(`morreu     :: ${nome}`);
    if (quais.length) console.log(`              por: ${quais.join(" | ")}`);
  }
}

console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mortos`);
process.exit(sobreviventes === 0 ? 0 : 1);
