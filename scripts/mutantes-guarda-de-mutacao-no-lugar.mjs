#!/usr/bin/env node
// Os mutantes do `check-mutacao-no-lugar.mjs`: a guarda sabe reprovar?
//
// POR QUE (HMO-327)
// -----------------
// A guarda passou verde na primeira execucao, e verde de primeira nao prova
// nada: uma guarda que nunca reprovou pode estar medindo o conjunto vazio.
// Cada peneira dela ganha aqui um mutante que ela TEM de pegar.
//
// O mutante mais importante e o do COMENTARIO. A guarda e textual, e os runners
// FALAM do proprio defeito em prosa -- `mutantes-pagador-da-parte.mjs` avisa no
// cabecalho que "MUTA OS ARQUIVOS NO DISCO", e `mutantes-moeda.mjs` cita SIGTERM
// tres vezes, todas em comentario explicando o problema. Uma versao que lesse
// comentario acusaria runner seguro e, pior, poderia ser "satisfeita" com prosa.
//
// A ARVORE DE PRODUCAO NUNCA E TOCADA
// -----------------------------------
// Seria incoerente: esta e a medicao da guarda que proibe mutar a arvore no
// lugar. Tudo roda numa COPIA em diretorio temporario, com um repositorio git
// de mentira so para o `git ls-files` ter o que responder. O pior caso de uma
// interrupcao e um diretorio orfao em /tmp, nao um mutante em `lib/`.
//
// AS FIXTURES SAO SINTETICAS, DE PROPOSITO
// ----------------------------------------
// Os mutantes sao medidos contra runners de mentira, um por idioma, em vez de
// contra a arvore de verdade. Medir contra a arvore faria mutante sobreviver por
// REDUNDANCIA: `mutantes-transferencia-recorrente-app.mjs` e pego por DOIS
// caminhos (o `Object.entries` e o `m.alvo`), entao apagar um dos dois deixaria
// o placar identico e o mutante vivo sem que nada estivesse coberto. Uma fixture
// por idioma isola a peneira que cada mutante ataca.

import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const GUARDA = "scripts/check-mutacao-no-lugar.mjs";

/**
 * Cada fixture e um runner de mentira que exercita UM idioma, com o veredito
 * esperado. `flagrado: true` = a guarda tem de ver mutacao no lugar.
 */
const FIXTURES = [
  {
    nome: "mutantes-fx-direto.mjs",
    flagrado: true,
    porque: "o caso cru: const com caminho rastreado, escrito direto",
    fonte: `import { writeFileSync, readFileSync } from "node:fs";
const ALVO = "lib/fx.ts";
const original = readFileSync(ALVO, "utf8");
writeFileSync(ALVO, original.replace("a", "b"));
`,
  },
  {
    nome: "mutantes-fx-comentario.mjs",
    flagrado: false,
    porque:
      "O MUTANTE QUE IMPORTA: o idioma aparece so em COMENTARIO. Runner seguro que FALA do defeito nao pode ser acusado",
    fonte: `import { writeFileSync } from "node:fs";
// Este runner NAO muta a arvore. O jeito proibido seria:
//   const ALVO = "lib/fx.ts";
//   writeFileSync(ALVO, mutado);
// e e exatamente o que nao se faz aqui.
const seguro = "/tmp/fora-do-repo.ts";
writeFileSync(seguro, "x");
`,
  },
  {
    nome: "mutantes-fx-mapa.mjs",
    flagrado: true,
    porque: "o Map de originais desamarrado num for..of e escrito pela variavel do laco",
    fonte: `import { writeFileSync, readFileSync } from "node:fs";
const UM = "lib/fx.ts";
const DOIS = "lib/fx2.ts";
const fontes = new Map([
  [UM, readFileSync(UM, "utf8")],
  [DOIS, readFileSync(DOIS, "utf8")],
]);
for (const [alvo, original] of fontes) writeFileSync(alvo, original);
`,
  },
  {
    nome: "mutantes-fx-propriedade.mjs",
    flagrado: true,
    porque:
      "o alvo chega por PROPRIEDADE, com o caminho CRU -- sem const, nenhuma outra peneira pega",
    // De proposito sem `const ALVO`: com a const, o objeto literal viraria
    // container ligado e a variavel do `for..of` seria pega por OUTRA peneira --
    // o mutante `propriedade_ignorada` sobreviveria por redundancia, e foi
    // exatamente o que aconteceu na primeira versao desta medicao.
    fonte: `import { writeFileSync } from "node:fs";
const MUTACOES = [{ alvo: "lib/fx.ts", de: "a", para: "b" }];
for (const m of MUTACOES) writeFileSync(m.alvo, "x");
`,
  },
  {
    nome: "mutantes-fx-rename.mjs",
    flagrado: true,
    porque:
      "mover a fonte para o .bak e o passo que deixou lib/crivos.ts mutado; o alvo e o 2o argumento",
    fonte: `import { renameSync } from "node:fs";
const BAK = "lib/fx.ts.bak";
const ALVO = "lib/fx.ts";
renameSync(BAK, ALVO);
`,
  },
  {
    nome: "mutantes-fx-embrulhado.mjs",
    flagrado: true,
    porque:
      "o caminho rastreado vai EMBRULHADO em join(RAIZ, ALVO) -- olhar so o identificador da raiz veria `join` e absolveria",
    fonte: `import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const RAIZ = "/qualquer/lugar";
const ALVO = "lib/fx.ts";
const original = readFileSync(ALVO, "utf8");
writeFileSync(join(RAIZ, ALVO), original.replace("a", "b"));
`,
  },
  {
    nome: "mutantes-fx-sandbox-de-fabrica.mjs",
    flagrado: false,
    porque:
      "a raiz temporaria vem de uma FUNCAO que a monta (o desenho deste proprio runner): escreve em /tmp citando um caminho rastreado, e nao pode ser acusado",
    fonte: `import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const GUARDA = "lib/fx.ts";
let sandbox = null;
function montar() {
  const dir = mkdtempSync(join(tmpdir(), "fx-"));
  return dir;
}
sandbox = montar();
writeFileSync(join(sandbox, GUARDA), "x");
`,
  },
  {
    nome: "mutantes-fx-tmp.mjs",
    flagrado: false,
    porque: "o padrao seguro: le a fonte rastreada, mas escreve so no diretorio temporario",
    fonte: `import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const ALVO = "lib/fx.ts";
const original = readFileSync(ALVO, "utf8");
const dir = mkdtempSync(join(tmpdir(), "fx-"));
const copia = join(dir, "fx.ts");
writeFileSync(copia, original.replace("a", "b"));
`,
  },
];

/**
 * Peneiras da guarda, uma por mutante. Cada `de` tem de aparecer EXATAMENTE uma
 * vez -- `String.replace` troca a primeira ocorrencia, e um trecho que aparece
 * duas vezes mutaria um lugar que nao e o anunciado.
 */
const MUTANTES = [
  {
    nome: "comentario_conta_como_codigo",
    porque: "a guarda passa a ler comentario: runner seguro que EXPLICA o idioma proibido vira culpado",
    de: "function semComentarios(fonte) {",
    para: "function semComentarios(fonte) {\n  return fonte;",
  },
  {
    nome: "nada_e_rastreado",
    porque: "o `git ls-files` deixa de valer: nenhum caminho e rastreado e TODO runner fica limpo",
    de: '  return new Set(saida.split("\\n").filter(Boolean));',
    para: "  return new Set();",
  },
  {
    nome: "container_nao_desamarra",
    porque: "o Map de originais deixa de ligar a variavel do laco: quem escreve por `alvo` escapa",
    de: "    for (const re of padroes) {",
    para: "    for (const re of []) {",
  },
  {
    nome: "propriedade_ignorada",
    porque: "a propriedade `.alvo` deixa de carregar o caminho: `writeFileSync(m.alvo, ..)` escapa",
    de: "    if (rastreados.has(m[2])) propriedades.add(m[1]);",
    para: "    void m;",
  },
  {
    nome: "alvo_do_rename_no_argumento_errado",
    porque: "`renameSync` passa a ser lido no 1o argumento, e o destino some da medicao",
    de: '  { nome: "renameSync", alvo: 1 },',
    para: '  { nome: "renameSync", alvo: 0 },',
  },
  {
    nome: "so_a_raiz_da_expressao_conta",
    porque:
      "a guarda volta a olhar so o identificador da raiz: `join(RAIZ, ALVO)` ve `join` e escapa",
    de: "          embrulhado);",
    para: "          false);",
  },
  {
    nome: "temporario_absolve_qualquer_coisa",
    porque:
      "a absolvicao por /tmp deixa de exigir raiz temporaria de verdade e passa a absolver TODA escrita",
    de: "      const temRaizTemporaria = nomesNaExpr.some((n) => temporarios.has(n));",
    para: "      const temRaizTemporaria = true;",
  },
  {
    nome: "fabrica_de_temporario_ignorada",
    porque:
      "a raiz temporaria devolvida por funcao deixa de contar, e quem escreve em /tmp citando caminho rastreado vira culpado",
    de: "    if (/mkdtempSync\\s*\\(/.test(m[2]) && /\\breturn\\b/.test(m[2])) fabricas.add(m[1]);",
    para: "    void m;",
  },
  {
    nome: "const_com_caminho_ignorada",
    porque: "a ligacao `const ALVO = \"lib/x.ts\"` deixa de ser feita, e o caso cru escapa",
    de: "    if (rastreados.has(m[2])) ligados.add(m[1]);",
    para: "    void m;",
  },
];

let sandbox = null;
process.on("exit", () => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

/** Monta a copia: a guarda, as fixtures e um repo git de mentira. */
function montar() {
  const dir = mkdtempSync(join(tmpdir(), "mut-hmo327-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "lib"), { recursive: true });
  cpSync(join(RAIZ, GUARDA), join(dir, GUARDA));
  for (const f of FIXTURES) writeFileSync(join(dir, "scripts", f.nome), f.fonte);
  // Os arquivos que as fixtures citam tem de estar RASTREADOS, senao a guarda
  // nao tem o que achar e todo mutante "morre" sem nada ter sido medido.
  for (const n of ["fx.ts", "fx2.ts"]) writeFileSync(join(dir, "lib", n), "export const a = 1;\n");
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "x@y.z");
  git("config", "user.name", "x");
  git("add", "-A");
  git("commit", "-qm", "fixture");
  return dir;
}

/** O veredito da guarda sobre as fixtures, lido de dentro da copia. */
async function vereditos(dir) {
  const mod = await import(`file://${join(dir, GUARDA)}?v=${Math.random()}`);
  const relatorio = mod.auditar(join(dir, "scripts"), dir);
  const mapa = new Map();
  for (const f of FIXTURES) {
    const achado = relatorio.find((r) => r.nome === f.nome);
    mapa.set(f.nome, achado ? achado.escritas.length > 0 : null);
  }
  return mapa;
}

function conferir(mapa) {
  const erradas = FIXTURES.filter((f) => mapa.get(f.nome) !== f.flagrado);
  return { ok: erradas.length === 0, erradas: erradas.map((f) => f.nome) };
}

async function principal() {
  sandbox = montar();
  const original = readFileSync(join(sandbox, GUARDA), "utf8");

  // CONTROLE POSITIVO: a guarda INTACTA tem de acertar todas as fixtures. Sem
  // isto, todo mutante "morre" por motivo nenhum e o placar sai 6/6 ficticio.
  const base = conferir(await vereditos(sandbox));
  if (!base.ok) {
    console.error("CONTROLE POSITIVO FALHOU: a guarda intacta errou as fixtures:");
    for (const n of base.erradas) {
      const f = FIXTURES.find((x) => x.nome === n);
      console.error(`  ${n}: esperado flagrado=${f.flagrado} (${f.porque})`);
    }
    return 1;
  }
  console.log(`controle positivo OK -- a guarda intacta acerta as ${FIXTURES.length} fixtures\n`);

  let vivos = 0;
  for (const m of MUTANTES) {
    const ocorrencias = original.split(m.de).length - 1;
    if (ocorrencias !== 1) {
      console.error(`ERRO DE ANCORA  ${m.nome}: o trecho aparece ${ocorrencias}x (tem de ser 1)`);
      vivos++;
      continue;
    }
    writeFileSync(join(sandbox, GUARDA), original.replace(m.de, m.para));
    let veredito = null;
    let quebrou = null;
    try {
      veredito = conferir(await vereditos(sandbox));
    } catch (e) {
      quebrou = String(e.message).slice(0, 60);
    }
    writeFileSync(join(sandbox, GUARDA), original);
    if (quebrou !== null) {
      console.log(`OK    ${m.nome}  (a guarda mutada nem carrega: ${quebrou})`);
      continue;
    }
    if (veredito.ok) {
      console.log(`VIVO  ${m.nome}`);
      console.log(`        ${m.porque}`);
      vivos++;
    } else {
      console.log(`OK    ${m.nome}  (pego em: ${veredito.erradas.join(", ")})`);
    }
  }

  console.log(`\n${MUTANTES.length - vivos}/${MUTANTES.length} mutantes mortos`);
  if (vivos > 0) {
    console.error(
      `\n${vivos} mutante(s) sobreviveram: a guarda tem peneira que nenhuma fixture mede.\n` +
        `Ou a peneira e codigo morto, ou falta fixture para o idioma dela.\n`
    );
  }
  return vivos === 0 ? 0 : 1;
}

principal().then((c) => process.exit(c));
