#!/usr/bin/env node
// =====================================================
// A GUARDA DE ANCORA SABE REPROVAR? (HMO-262)
// =====================================================
// Roda com:  npm run test:ancora-de-mutante
//
// POR QUE ISTO EXISTE
// -------------------
// `scripts/mede-ancora-ambigua.mjs` passou a REPROVAR ancora morta (`de` com
// zero ocorrencia no arquivo que ele muta). Verde de primeira nao prova nada: a
// guarda le runners por predicado de forma (`ehDoPainel`, `ehTupla`), e um
// predicado que para de casar faz a varredura medir o CONJUNTO VAZIO e imprimir
// um boletim limpo. Este repositorio ja teve placar de mutante ficticio
// sobrevivendo a um run inteiro.
//
// Entao cada um dos tres estados que a guarda recusa ganha aqui um controle
// negativo, e o estado intacto ganha o positivo.
//
// O DEFEITO QUE O CASO 2 REPRESENTA e literalmente a HMO-262: o mutante
// `parcelamento_volta_para_toda_despesa` procurava
// `parcelamento: !editando && ehNoCartao,` e a HMO-254 reescreveu o trecho para
// `parcelamento: !editando && natureza === "card",`. O `sed` parou de casar, a
// suite seguiu rodando sobre o codigo correto, e a checkbox de parcelamento
// ficou meses sem controle negativo nenhum.
//
// POR QUE O FIXTURE E ESCRITO AQUI E NAO E UM RUNNER DE VERDADE
// -------------------------------------------------------------
// Apontar este controle para um runner real amarraria a assercao a uma lista de
// mutantes que muda toda semana -- e um `de` que some por motivo legitimo faria
// ESTE teste ficar vermelho acusando a guarda. O fixture e um runner minimo da
// familia do painel, escrito byte a byte abaixo, com UM mutante cuja ancora eu
// controlo.
//
// Ele tambem nunca entra no censo da guarda: vive em diretorio temporario e e
// passado por ARGUMENTO explicito, que e o modo em que a varredura por
// `readdirSync` nao roda. E a lacuna oposta da que o `APARELHO` fecha la --
// aparelho que se mede a si mesmo.
//
// A ARVORE DE PRODUCAO NUNCA E TOCADA
// -----------------------------------
// Nada aqui escreve no repositorio: o fixture e as quatro variacoes dele moram
// num `mkdtemp`. O pior caso de uma interrupcao e um diretorio orfao em /tmp.

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUARDA = "scripts/mede-ancora-ambigua.mjs";

// A LINHA QUE E A ANCORA. Aparece UMA vez no alvo intacto.
const ANCORA = "  if (saldo < 0) return 0;";

const ALVO_INTACTO = `export function sobra(saldo: number): number {
${ANCORA}
  return saldo;
}
`;

// Runner minimo da familia do painel: `ehDoPainel` exige `const mutantes = [` em
// comeco de linha E uma chave `arquivo: ` com quatro espacos; `mioloDoPainel`
// exige uma `const NOME = "caminho";` antes da lista.
const RUNNER_FIXTURE = `#!/usr/bin/env node
import { readFileSync } from "node:fs";

const ALVO = "lib/exemplo-da-ancora.ts";
const SUITES = ["test:exemplo-da-ancora"];

const mutantes = [
  {
    nome: "guarda_do_saldo_negativo",
    arquivo: ALVO,
    de: ${JSON.stringify(ANCORA)},
    para: "  if (false) return 0;",
  },
];

console.log(readFileSync(ALVO, "utf8").length);
`;

const raizTmp = mkdtempSync(path.join(tmpdir(), "ancora-de-mutante-"));

/**
 * Monta uma arvore minima: a guarda, o conversor de onde ela importa os
 * predicados, o runner fixture e o alvo.
 *
 * So isso basta porque a guarda NAO EXECUTA o runner -- ela recorta o miolo
 * (as declaracoes `const`) e o importa como modulo de dados. Os imports do
 * runner nunca precisam resolver.
 */
function arvore(nome, alvo) {
  const raiz = path.join(raizTmp, nome);
  mkdirSync(path.join(raiz, "scripts"), { recursive: true });
  mkdirSync(path.join(raiz, "lib"), { recursive: true });

  for (const f of [GUARDA, "scripts/converte-mutantes-em-bloco.mjs"]) {
    copyFileSync(path.join(RAIZ, f), path.join(raiz, f));
  }
  writeFileSync(path.join(raiz, "scripts/mutantes-exemplo-da-ancora.mjs"), RUNNER_FIXTURE);
  if (alvo !== null) writeFileSync(path.join(raiz, "lib/exemplo-da-ancora.ts"), alvo);

  return raiz;
}

function rodarGuarda(raiz) {
  const r = spawnSync(
    process.execPath,
    [GUARDA, "scripts/mutantes-exemplo-da-ancora.mjs"],
    { cwd: raiz, encoding: "utf8" },
  );
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
}

let falhas = 0;

function afirmar(rotulo, condicao, detalhe) {
  if (condicao) {
    console.log(`  OK    ${rotulo}`);
  } else {
    console.log(`  FALHA ${rotulo}\n        ${detalhe}`);
    falhas++;
  }
}

// =====================================================
// 1. CONTROLE POSITIVO: arvore intacta, a guarda aprova
// =====================================================
// E ele que pega o modo de falha mais perigoso desta familia: se `ehDoPainel`
// deixasse de reconhecer o fixture, a guarda sairia 1 ("nao e de familia nenhuma
// que eu saiba ler") e TODOS os controles negativos abaixo passariam -- vermelho
// pelo motivo errado. Aqui o unico resultado aceitavel e zero.
console.log("1. a arvore intacta passa");
{
  const { codigo, saida } = rodarGuarda(arvore("intacto", ALVO_INTACTO));
  afirmar("sai 0", codigo === 0, `saiu ${codigo}:\n${saida}`);
  afirmar(
    "le o fixture como 1 mutante",
    /1 mutantes/.test(saida),
    `nao contou o mutante:\n${saida}`,
  );
  afirmar(
    "nao acusa ancora morta",
    /0 com ancora MORTA/.test(saida),
    `o placar nao diz 0 mortas:\n${saida}`,
  );
}

// =====================================================
// 2. CONTROLE NEGATIVO: a ancora MORREU (o caso da HMO-262)
// =====================================================
// O rename que a feature faz no ALVO, nao no runner: `saldo` virou `valor`. O
// `de` do mutante passa a casar com nada.
console.log("2. ancora morta reprova (o defeito da HMO-262)");
{
  const renomeado = ALVO_INTACTO.replace("saldo < 0", "valor < 0");
  afirmar(
    "o fixture renomeado realmente perdeu a ancora",
    !renomeado.includes(ANCORA),
    "a mutacao do fixture nao mudou nada -- este caso seria vacuo",
  );

  const { codigo, saida } = rodarGuarda(arvore("morta", renomeado));
  afirmar("sai != 0", codigo !== 0, `saiu ${codigo}, deveria reprovar:\n${saida}`);
  afirmar(
    "diz ancora MORTA",
    /ancora MORTA/.test(saida),
    `nao nomeou o estado:\n${saida}`,
  );
  afirmar(
    "nomeia o mutante desarmado",
    /guarda_do_saldo_negativo/.test(saida),
    `nao disse QUAL mutante parou de aplicar:\n${saida}`,
  );
}

// =====================================================
// 3. CONTROLE NEGATIVO: a ancora ficou AMBIGUA
// =====================================================
// A trava que a HMO-328 instalou. Ela ja existia; o controle negativo dela, nao
// -- e uma trava sem controle negativo e indistinguivel de uma trava apagada.
console.log("3. ancora ambigua reprova");
{
  const duplicado = `${ALVO_INTACTO}\nexport function outra(saldo: number): number {\n${ANCORA}\n  return saldo;\n}\n`;
  const { codigo, saida } = rodarGuarda(arvore("ambigua", duplicado));
  afirmar("sai != 0", codigo !== 0, `saiu ${codigo}, deveria reprovar:\n${saida}`);
  afirmar(
    "diz ancora AMBIGUA com a contagem",
    /ancora AMBIGUA \(2x\)/.test(saida),
    `nao nomeou o estado nem quantas vezes:\n${saida}`,
  );
}

// =====================================================
// 4. CONTROLE NEGATIVO: o arquivo alvo nao existe mais
// =====================================================
console.log("4. arquivo alvo ausente reprova");
{
  const { codigo, saida } = rodarGuarda(arvore("ausente", null));
  afirmar("sai != 0", codigo !== 0, `saiu ${codigo}, deveria reprovar:\n${saida}`);
  afirmar(
    "diz ARQUIVO AUSENTE",
    /ARQUIVO AUSENTE/.test(saida),
    `nao nomeou o estado:\n${saida}`,
  );
}

// =====================================================
// 5. A GUARDA ESTA NO pre-commit
// =====================================================
// Uma guarda que ninguem invoca e exatamente o estado em que o
// `mede-ancora-ambigua.mjs` passou a HMO-328 inteira: ele media, ninguem o
// rodava. Esta assercao le o CAMPO do package.json ja parseado -- nao o texto do
// arquivo --, entao ela nao pode ser satisfeita por mencao em comentario.
console.log("5. o pre-commit roda a guarda");
{
  const pkg = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8"));
  afirmar(
    "existe o alvo npm check-ancora-de-mutante",
    pkg.scripts?.["check-ancora-de-mutante"]?.includes("mede-ancora-ambigua.mjs"),
    `o alvo npm nao aponta para a guarda: ${pkg.scripts?.["check-ancora-de-mutante"]}`,
  );
  afirmar(
    "o pre-commit o invoca",
    /(^|&&\s*)npm run check-ancora-de-mutante(\s|$|&)/.test(pkg.scripts?.["pre-commit"] ?? ""),
    `pre-commit nao chama a guarda: ${pkg.scripts?.["pre-commit"]}`,
  );
}

// =====================================================
// 6. O MODO POR ARGUMENTO NAO REESCREVE O RUNNER
// =====================================================
// O driver de linha de comando de `converte-mutantes-em-bloco.mjs` disparava por
// "tem argumento" em vez de "eu sou o programa". Como `process.argv` e do
// PROCESSO, passar um runner para a guarda fazia o CONVERSOR reescrever esse
// runner em disco -- e a medicao pedida nunca rodava, porque o `process.exit`
// dele matava o processo primeiro. Medido na main (d995511):
//
//     convertido  scripts/mutantes-parte-do-grupo.mjs  (familia tupla)
//
// Este caso e o unico lugar do repositorio que exercita o modo por argumento com
// um arquivo que ele pode estragar, entao e aqui que a regressao tem de doer.
console.log("6. o modo por argumento nao reescreve o runner em disco");
{
  const raiz = arvore("sem-reescrita", ALVO_INTACTO);
  const runner = path.join(raiz, "scripts/mutantes-exemplo-da-ancora.mjs");
  const antes = readFileSync(runner, "utf8");

  const { codigo, saida } = rodarGuarda(raiz);

  afirmar(
    "o runner no disco esta byte a byte igual",
    readFileSync(runner, "utf8") === antes,
    "o conversor reescreveu o runner -- o driver dele voltou a disparar por argumento",
  );
  afirmar(
    "a medicao rodou de verdade",
    codigo === 0 && /1 mutantes/.test(saida),
    `a guarda nao chegou a medir (saiu ${codigo}):\n${saida}`,
  );
  afirmar(
    "o conversor nao se anunciou",
    !/^convertido /m.test(saida),
    `o driver do conversor rodou:\n${saida}`,
  );
}

rmSync(raizTmp, { recursive: true, force: true });

if (falhas > 0) {
  console.error(`\n${falhas} assercao(oes) falharam.`);
  process.exit(1);
}
console.log("\ntodas as assercoes passaram -- a guarda de ancora sabe reprovar.");
