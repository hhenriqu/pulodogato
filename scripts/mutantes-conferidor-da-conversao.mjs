#!/usr/bin/env node
// =====================================================
// CONTROLE NEGATIVO DO CONFERIDOR DA CONVERSAO -- HMO-328
// =====================================================
// Roda com:  node scripts/mutantes-conferidor-da-conversao.mjs
//
// O QUE ESTE ARQUIVO VIGIA
// ------------------------
// `converte-mutantes-em-bloco.mjs --conferir` e a unica coisa que garante que a
// conversao de um runner de mutante NAO PERDEU NENHUMA ENTRADA DA LISTA. E a
// lista e a parte que importa: o driver em volta e mecanico e intercambiavel,
// mas cada `de`/`para`/`nome` e um defeito que alguem mediu, e que nao esta
// escrito em nenhum outro lugar do repositorio.
//
// POR QUE O CONFERIDOR PRECISA DE UM CONTROLE PROPRIO (HMO-318)
// -------------------------------------------------------------
// Porque ele ja passou vacuo, e o estrago foi exatamente o que ele existe para
// impedir. A primeira versao do conversor apagou os 14 mutantes de um runner --
// `removerDeclaracao` cortou ate o `\n];` errado e levou a lista inteira -- e o
// conferidor imprimiu:
//
//     OK  scripts/mutantes-periodo-do-grupo.mjs: miolo identico (40 bytes)
//
// "Identico" era verdade e nao significava nada: ele comparava o miolo extraido
// do arquivo de ANTES com o miolo extraido do arquivo DEPOIS, e o mesmo extrator
// quebrado truncou os dois do mesmo jeito. Duas leituras erradas iguais passam
// por uma leitura certa -- a familia de
// "conferidor-que-usa-o-mesmo-extrator-nos-dois-lados-passa-vacuo".
//
// A LICAO, QUE E O DESENHO DESTE ARQUIVO
// --------------------------------------
// Nao basta afirmar que o conferidor ACUSA uma conversao ruim (parte 2 abaixo):
// um conferidor que acusa tudo tambem passaria nisso. O que precisa de prova e
// que ele acusa o caso em que OS DOIS LADOS ESTAO IGUALMENTE ERRADOS, que e o
// unico caso que ele deixou passar de verdade. Essa e a parte 3, e ela MUTA O
// CONVERSOR -- porque o defeito mora no extrator, nao no texto convertido.
//
// POR QUE UM FIXTURE, E NAO OS RUNNERS DE VERDADE
// -----------------------------------------------
// Este controle nao le `scripts/mutantes-painel-na-tela.mjs`. Dois motivos:
//
//   1. o `--conferir` precisa do texto de ANTES da conversao, que depois do
//      commit so existe no historico do git. Um controle que faz arqueologia de
//      commit apodrece na primeira vez que alguem reescreve a historia, e falha
//      por um motivo que nada tem a ver com o que ele mede;
//   2. o que esta sob medicao e o CONFERIDOR, nao as listas. Um fixture pequeno
//      com contagem conhecida (tres mutantes) torna cada cenario legivel: "tres
//      antes, dois depois" e uma frase que se confere a olho.
//
// O fixture abaixo e um runner da familia do painel de verdade, nao um esqueleto:
// multi-arquivo (duas constantes), duas suites, o paragrafo morto do `git
// checkout` que a conversao tem de podar, e a lista no formato de objeto. Se a
// familia mudar de forma, ele para de ser convertido e este controle reprova --
// que e o aviso certo.
//
// O CONTROLE POSITIVO DELE
// ------------------------
// A parte 1. Se o fixture nao converter limpo, todo cenario da parte 2 "passa"
// por reprovar pelo motivo errado, e o placar fecha cheio sobre nada -- o mesmo
// modo de falha que o controle positivo de um runner de mutante existe para
// pegar. Ele roda primeiro e aborta.
// =====================================================

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { conferir, converterPainel } from "./converte-mutantes-em-bloco.mjs";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CONVERSOR = path.join(RAIZ, "scripts", "converte-mutantes-em-bloco.mjs");

// ---------------------------------------------------------------------------
// O FIXTURE: um runner da familia do painel, com TRES mutantes
// ---------------------------------------------------------------------------
const ANTES = `// CONTROLE NEGATIVO de alguma coisa -- HMO-000.
//
// POR QUE ESTE RUNNER EXISTE
// --------------------------
// Para o controle negativo do conferidor da conversao. Esta secao continua
// verdadeira depois da conversao, e tem de SOBREVIVER a poda.
//
// Nao usa \`git checkout\` para restaurar: ele restauraria a partir do INDICE, e
// num worktree compartilhado isso ja apagou trabalho nao commitado aqui. A
// copia original vai para a memoria e volta de la, sempre.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const LIB = "lib/exemplo.ts";
const TELA = "components/Exemplo.tsx";

const mutantes = [
  {
    // O primeiro, com comentario -- que tambem tem de vir intacto.
    nome: "o primeiro mutante",
    arquivo: LIB,
    de: "const a = 1;",
    para: "const a = 2;",
  },
  {
    nome: "o segundo mutante",
    arquivo: LIB,
    de: "const b = somar(x, y);",
    para: "const b = somar(y, x);",
  },
  {
    nome: "o terceiro mutante, na tela",
    arquivo: TELA,
    de: "<span>{valor}</span>",
    para: "<span>{0}</span>",
  },
];

const original = new Map();
for (const arquivo of new Set(mutantes.map((m) => m.arquivo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}
const restaurar = () => {
  for (const [arquivo, texto] of original) writeFileSync(arquivo, texto);
};
process.on("exit", restaurar);
process.on("SIGINT", () => process.exit(130));

const roda = () => {
  for (const suite of ["test:exemplo-puro", "test:exemplo-na-tela"]) {
    try {
      execSync(\`npm run \${suite}\`, { stdio: "pipe" });
    } catch {
      return false;
    }
  }
  return true;
};

console.log("controle positivo (codigo intacto): as duas suites devem PASSAR");
if (!roda()) {
  console.error("  REPROVOU -- conserte a suite antes de medir mutante");
  process.exit(1);
}

let sobreviventes = 0;
for (const m of mutantes) {
  const antes = original.get(m.arquivo);
  if (!antes.includes(m.de)) {
    console.error(\`SOBREVIVEU (ancora nao casou) :: \${m.nome}\`);
    sobreviventes++;
    continue;
  }
  const depois = antes.replace(m.de, m.para);
  writeFileSync(m.arquivo, depois);
  const passou = roda();
  restaurar();
  if (passou) sobreviventes++;
}
process.exit(sobreviventes === 0 ? 0 : 1);
`;

const QUANTOS = 3;

// ---------------------------------------------------------------------------
// PARTE 1 -- CONTROLE POSITIVO: o fixture converte limpo
// ---------------------------------------------------------------------------
let falhas = 0;

const CONVERTIDO = converterPainel(ANTES, "fixture");
const problemasDoControle = conferir(ANTES, CONVERTIDO);

if (problemasDoControle.length > 0) {
  console.error("ABORTADO: o fixture INTACTO nao confere limpo.");
  for (const p of problemasDoControle) console.error(`  ${p}`);
  console.error("Todo cenario abaixo 'reprovaria' pelo motivo errado.");
  process.exit(1);
}

// E as duas coisas que a conversao tem de ter feito com o cabecalho. Sem isto, o
// controle positivo acima passaria com um conversor que nao poda nada.
if (CONVERTIDO.includes("git checkout")) {
  console.error("ABORTADO: o paragrafo morto do `git checkout` sobreviveu a poda.");
  process.exit(1);
}
if (!CONVERTIDO.includes("POR QUE ESTE RUNNER EXISTE")) {
  console.error("ABORTADO: a poda levou a secao VIVA junto.");
  process.exit(1);
}
console.log(`controle positivo: o fixture de ${QUANTOS} mutantes converte e confere limpo\n`);

// ---------------------------------------------------------------------------
// PARTE 2 -- OS CENARIOS: cada conversao ruim tem de ser ACUSADA
// ---------------------------------------------------------------------------
// Cada cenario estraga o TEXTO CONVERTIDO de um jeito diferente. O `espera` e a
// trava que tem de disparar: casar a mensagem, e nao so "deu algum problema",
// impede que um cenario passe pela trava do cenario vizinho.
const cenarios = [
  {
    nome: "um mutante apagado da lista",
    estraga: (t) =>
      t.replace(
        /  \{\n    nome: "o segundo mutante",[\s\S]*?\n  \},\n/,
        "",
      ),
    espera: /3 mutantes antes, 2 depois/,
  },
  {
    nome: "a lista inteira apagada",
    estraga: (t) => t.replace(/const mutantes = \[[\s\S]*?\n\];/, "const mutantes = [];"),
    espera: /3 mutantes antes, 0 depois/,
  },
  {
    nome: "o `de` de um mutante reescrito (a lista 'parece' inteira)",
    estraga: (t) => t.replace('de: "const a = 1;"', 'de: "const a = 999;"'),
    espera: /miolo diferente/,
  },
  {
    nome: "o `para` de um mutante reescrito",
    estraga: (t) => t.replace('para: "const a = 2;"', 'para: "const a = 3;"'),
    espera: /miolo diferente/,
  },
  {
    nome: "o comentario de um mutante apagado",
    estraga: (t) => t.replace("    // O primeiro, com comentario -- que tambem tem de vir intacto.\n", ""),
    espera: /miolo diferente/,
  },
  {
    nome: "uma constante de arquivo apagada",
    estraga: (t) => t.replace('const TELA = "components/Exemplo.tsx";\n', ""),
    espera: /miolo diferente/,
  },
  {
    nome: "as ancoras do driver somem (o miolo nao se acha)",
    estraga: (t) => t.replace("\nconst SUITES = ", "\nconst OUTRA_COISA = "),
    espera: /nao achei o miolo/,
  },
  {
    nome: "o miolo colapsa mas a CONTAGEM se mantem (o piso)",
    // Cada entrada fica so com o `nome:`, entao `nome:` continua aparecendo tres
    // vezes e a trava de contagem NAO dispara. Quem pega e o piso de tamanho.
    estraga: (t) =>
      t.replace(/const mutantes = \[[\s\S]*?\n\];/, () =>
        [
          "const mutantes = [",
          ...["o primeiro mutante", "o segundo mutante", "o terceiro mutante, na tela"].map(
            (n) => `  {\n    nome: "${n}",\n  },`,
          ),
          "];",
        ].join("\n"),
      ),
    espera: /miolo (diferente|curto demais)/,
  },
];

for (const c of cenarios) {
  const estragado = c.estraga(CONVERTIDO);
  if (estragado === CONVERTIDO) {
    console.error(`SOBREVIVEU (o cenario nao mudou nada) :: ${c.nome}`);
    falhas++;
    continue;
  }
  const problemas = conferir(ANTES, estragado);
  if (problemas.length === 0) {
    console.error(`SOBREVIVEU :: ${c.nome}`);
    console.error("  o conferidor disse OK para uma conversao estragada");
    falhas++;
  } else if (!problemas.some((p) => c.espera.test(p))) {
    // Acusar pelo motivo errado conta como furo: a mensagem e o que diz a quem
    // le o log o que foi perdido.
    console.error(`ACUSOU ERRADO :: ${c.nome}`);
    console.error(`  esperava ${c.espera}, veio: ${problemas.join("; ")}`);
    falhas++;
  } else {
    console.log(`acusado    :: ${c.nome}`);
  }
}

// ---------------------------------------------------------------------------
// PARTE 3 -- O CASO QUE JA PASSOU VACUO: os DOIS lados truncados igual
// ---------------------------------------------------------------------------
// Aqui o texto convertido nao e estragado a mao. Quem e mutado e o CONVERSOR: o
// recorte do miolo passa a cortar logo depois de `const mutantes = [`. Entao:
//
//   - o arquivo convertido nasce SEM os mutantes (foi escrito a partir do
//     recorte truncado);
//   - o lado "antes" do conferidor usa O MESMO recorte truncado;
//   - os dois miolos ficam identicos, e `a === b` nao acusa nada.
//
// E a reproducao do defeito da HMO-318. Quem tem de pegar e a contagem lida do
// TEXTO FINAL dos dois arquivos, que nao passa pelo extrator.
//
// O conversor mutado roda de uma COPIA em /tmp -- `scripts/` do repositorio nao
// e tocado em momento nenhum, nem num processo morto no meio.
const MUTACOES_DO_CONVERSOR = [
  {
    nome: "o recorte do miolo trunca logo depois de `const mutantes = [`",
    de: "miolo: fonte.slice(constantes[0].index, fimDaLista(fonte, mLista.index)).trimEnd(),",
    para: "miolo: fonte.slice(constantes[0].index, mLista.index + 20).trimEnd(),",
  },
  {
    nome: "o recorte do miolo comeca DEPOIS das constantes de arquivo",
    de: "miolo: fonte.slice(constantes[0].index, fimDaLista(fonte, mLista.index)).trimEnd(),",
    para: "miolo: fonte.slice(mLista.index, fimDaLista(fonte, mLista.index)).trimEnd(),",
  },
];

const fonteDoConversor = readFileSync(CONVERSOR, "utf8");
const sombra = mkdtempSync(path.join(tmpdir(), "conferidor-"));
process.on("exit", () => rmSync(sombra, { recursive: true, force: true }));
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

for (const m of MUTACOES_DO_CONVERSOR) {
  const ocorrencias = fonteDoConversor.split(m.de).length - 1;
  if (ocorrencias !== 1) {
    console.error(`SOBREVIVEU (ancora ${ocorrencias === 0 ? "morta" : "ambigua"}) :: ${m.nome}`);
    falhas++;
    continue;
  }

  const copia = path.join(sombra, `conversor-${MUTACOES_DO_CONVERSOR.indexOf(m)}.mjs`);
  writeFileSync(copia, fonteDoConversor.replace(m.de, m.para));
  const mutado = await import(`file://${copia}`);

  // A conversao e a conferencia AMBAS pelo conversor mutado -- e esse o ponto:
  // os dois lados compartilham o extrator quebrado.
  const convertidoMal = mutado.converterPainel(ANTES, "fixture");
  const problemas = mutado.conferir(ANTES, convertidoMal);

  if (problemas.length === 0) {
    console.error(`SOBREVIVEU :: ${m.nome}`);
    console.error("  o conferidor disse OK comparando duas extracoes igualmente truncadas");
    console.error("  -- e exatamente o furo da HMO-318");
    falhas++;
  } else {
    console.log(`acusado    :: ${m.nome}`);
    console.log(`             (${problemas[0]})`);
  }
}

console.log();
if (falhas === 0) {
  console.log(
    `todos os ${cenarios.length + MUTACOES_DO_CONVERSOR.length} cenarios foram acusados`,
  );
} else {
  console.log(`${falhas} cenario(s) passou/passaram sem ser acusado(s)`);
  process.exit(1);
}
