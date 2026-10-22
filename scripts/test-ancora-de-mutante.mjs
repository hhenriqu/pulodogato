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

// =====================================================
// OS FIXTURES DA VARREDURA (HMO-389)
// =====================================================
// Os casos 1-6 passam o runner por ARGUMENTO. O defeito da HMO-389 vivia no
// OUTRO modo -- a varredura por `readdirSync` --, e so nele: era um
// `.filter((f) => familiaDoArquivo(f))` que jogava fora, sem imprimir nada,
// todo runner que nao fosse `painel` nem `tupla`. A familia HMO-246 (a de
// `const MUTANTES = [` em caixa alta) nao estava na tabela da guarda, e com ela
// foram 39 dos 73 runners -- incluindo `telas-de-movimentacao` (75 mutantes, o
// maior do repositorio) e `realizado-do-caixa`.
//
// Por isso estes fixtures vem em TRIO: um runner de cada familia. Um fixture so
// nao distingue "a guarda le as tres" de "a guarda le a minha e descarta as
// outras duas em silencio" -- que e exatamente o estado que passou meses.

const RUNNER_TUPLA = `#!/usr/bin/env node
const ALVO = "lib/exemplo-da-ancora.ts";

const mutantes = [
  [
    "tupla_guarda_do_saldo",
    ${JSON.stringify(ANCORA)},
    "  if (false) return 0;",
  ],
];

console.log(mutantes.length);
`;

// A familia HMO-246: `const FONTE` e a lista em CAIXA ALTA. O `const ALVO`
// derivado e o `const original` entram de proposito -- sao as declaracoes que
// chamam funcao (`join`, `readFileSync`) e que faziam o miolo ESTOURAR no
// import antes de `mioloDoHmo246` passar a remove-las. Sem elas aqui, o fixture
// nao exercitaria o pedaco do conserto que mais custou a achar.
const RUNNER_HMO246 = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FONTE = "lib/exemplo-da-ancora.ts";
const ALVO = join(RAIZ, FONTE);
const SUITE = "test:exemplo-da-ancora";
const original = readFileSync(ALVO, "utf8");

const MUTANTES = [
  {
    nome: "hmo246_guarda_do_saldo",
    de: ${JSON.stringify(ANCORA)},
    para: "  if (false) return 0;",
  },
];

console.log(MUTANTES.length, original.length, SUITE);
`;

// FORMA QUE NENHUM PREDICADO RECONHECE: a lista se chama `MUTACOES`. E a forma
// real de `mutantes-transferencia.mjs` e `mutantes-transferencia-recorrente-app.mjs`,
// dois dos 39 calados.
const RUNNER_SEM_FAMILIA = `#!/usr/bin/env node
const ALVO = "lib/exemplo-da-ancora.ts";

const MUTACOES = [
  {
    nome: "forma_que_a_guarda_nao_le",
    de: ${JSON.stringify(ANCORA)},
    para: "  if (false) return 0;",
  },
];

console.log(MUTACOES.length);
`;

// =====================================================
// OS FIXTURES DAS QUATRO FORMAS SEM `const FONTE` (HMO-392)
// =====================================================
// A HMO-389 deixou 20 runners em `FORMA_PROPRIA` com a forma de cada um
// escrita. Os 17 que a HMO-392 ensinou sao lidos por `mioloDeVariosAlvos`, e os
// fixtures abaixo sao a forma de cada grupo reduzida ao minimo que ainda
// exercita a parte que pode falhar em silencio.
//
// POR QUE ELES NAO ENTRAM NA ARVORE PADRAO DA VARREDURA
// -----------------------------------------------------
// Os casos 7-9 afirmam `3 mutantes lidos em 3 runners` e `painel:1 tupla:1
// hmo246:1`. Somar fixture na arvore padrao mudaria esses numeros e eu
// consertaria a assercao -- que e como um controle negativo deixa de medir sem
// ninguem notar. Os novos entram por `extras`, nos casos que os pedem.

const ANCORA_DO_OUTRO = "  return 1;";
const OUTRO_ALVO = `export function um(): number {
${ANCORA_DO_OUTRO}
}
`;

// O trecho que aparece DUAS vezes -- o alvo do `todas: true`.
const PEDAGIO = "podeMostrarNumero(estado) && resumo";
const ALVO_REPETIDO = `export const a = ${PEDAGIO} ? 1 : 0;
export const b = ${PEDAGIO} ? 2 : 0;
`;

const MIGRACAO = "database/migrations/exemplo_da_ancora.sql";
const ANCORA_SQL = "ALTER TABLE public.exemplo\n  ALTER COLUMN tipo SET NOT NULL;";
const A_VIEW = "CREATE OR REPLACE VIEW public.exemplo_view AS SELECT 1;";
const SQL_INTACTO = `-- a migration de exemplo
${A_VIEW}

${ANCORA_SQL}
`;

// 1. MIGRATION SQL, E COM AS DUAS LISTAS (o lote de 8 + `fatura-escolhida`).
//
// Tres coisas que nenhum fixture anterior tinha, e as tres sao parte do
// conserto:
//
//   - o alvo e `const MIGRATION`, e NAO existe `const FONTE`;
//   - `const VIEW_INTEIRA` e recortado do PROPRIO arquivo (`original.slice`).
//     `mioloDoHmo246` APAGA o `const original` por nao precisar dele; aqui
//     apagar deixa o miolo sem carregar, e e por isso que a leitura nova
//     importa o miolo com um `readFileSync` resolvido contra a RAIZ;
//   - uma SEGUNDA lista (`MUTANTES_TS`), cujo mutante tem `arquivo:` E `alvo:`
//     -- e o `alvo:` dali e o nome de uma SUITE, nao um caminho. Lido como
//     caminho, sairia `ARQUIVO AUSENTE`.
//
// `const psql` fica no recorte de proposito: ele chama `execFileSync` e
// referencia `PG`, que esta FORA do recorte. Definir a funcao e inofensivo --
// chamar e que nao seria --, e e esse o unico motivo de os oito runners de
// migration poderem ser lidos sem driver nenhum.
const RUNNER_MIGRACAO = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const PG = process.env.PG_URL_BASE ?? "postgresql://postgres:postgres@127.0.0.1:5432";
const TEMPLATE = process.env.PG_TEMPLATE ?? "exemplo_base";
const MIGRATION = ${JSON.stringify(MIGRACAO)};
const TESTE = "database/tests/exemplo_da_ancora_test.sql";

const psql = (db, args) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", \`\${PG}/\${db}\`, ...args], {
    encoding: "utf8",
  });

const original = readFileSync(MIGRATION, "utf8");

const A_TRAVA = ${JSON.stringify(ANCORA_SQL)};

const VIEW_INTEIRA = original.slice(
  original.indexOf("CREATE OR REPLACE VIEW"),
  original.indexOf("SELECT 1;") + "SELECT 1;".length,
);

const MUTANTES = [
  { nome: "migracao_sem_a_trava", de: A_TRAVA, para: "-- (mutado) sem a trava" },
  { nome: "migracao_sem_a_view", de: VIEW_INTEIRA, para: "-- (mutado) sem a view" },
];

const ARQUIVO_TS = "lib/exemplo-da-ancora.ts";

const MUTANTES_TS = [
  {
    nome: "segunda_lista_guarda_do_saldo",
    arquivo: ARQUIVO_TS,
    alvo: "test:exemplo-da-ancora",
    de: ${JSON.stringify(ANCORA)},
    para: "  if (false) return 0;",
  },
];

console.log(MUTANTES.length, MUTANTES_TS.length, TESTE, TEMPLATE, psql.length);
`;

// 2. MULTI-ARQUIVO SEM ALVO DE MODULO (`alcance-da-serie` e os outros tres).
//
// `const MARCACAO` vem ANTES das constantes de caminho de proposito: e a forma
// de `mutantes-fiacao-do-bruto.mjs`, cujo campo `medida:` fez a primeira versao
// desta leitura abortar com `MARCACAO is not defined` -- porque a coleta de
// identificadores era uma LISTA de campos conhecidos e `medida` era o setimo.
// O `const originais` com `readFileSync` por alvo e a outra metade da forma.
const RUNNER_MULTI_ALVO = `#!/usr/bin/env node
import { readFileSync } from "node:fs";

const MARCACAO = "test:exemplo-da-ancora";

const UM = "lib/exemplo-da-ancora.ts";
const OUTRO = "lib/exemplo-do-outro-alvo.ts";

const originais = {
  [UM]: readFileSync(UM, "utf8"),
  [OUTRO]: readFileSync(OUTRO, "utf8"),
};

const MUTANTES = [
  {
    nome: "multi_no_primeiro",
    fonte: UM,
    de: ${JSON.stringify(ANCORA)},
    para: "  if (false) return 0;",
    medida: MARCACAO,
  },
  {
    nome: "multi_no_segundo",
    alvo: OUTRO,
    de: ${JSON.stringify(ANCORA_DO_OUTRO)},
    para: "  return 2;",
    medida: MARCACAO,
  },
];

console.log(MUTANTES.length, Object.keys(originais).length);
`;

// 3. O ALVO CHAMADO `ALVO`, com `todas: true` (`contrato-dos-cartoes`).
//
// O `todas: true` esta aqui porque foi ele que produziu as SEIS primeiras
// "ancoras ambiguas" da leitura nova, e as seis eram FALSAS: o driver destes
// runners usa `replaceAll`, e as duas ocorrencias SAO o mutante. O driver do
// fixture repete esse `replaceAll` para que o campo nao seja decoracao.
const RUNNER_ALVO_NOMEADO = `#!/usr/bin/env node
import { readFileSync } from "node:fs";

const ALVO = "lib/exemplo-do-repetido.ts";
const ORACULO = "contrato";

const original = readFileSync(ALVO, "utf8");

const MUTANTES = [
  {
    nome: "as_duas_ocorrencias_de_uma_vez",
    de: ${JSON.stringify(PEDAGIO)},
    para: "true",
    todas: true,
  },
];

for (const { de, para, todas } of MUTANTES) {
  console.log(todas ? original.replaceAll(de, para) : original.replace(de, para), ORACULO);
}
`;

// 4. O ALVO POR APELIDO (`fatura-do-periodo`).
//
// `alvo: "apelido-do-alvo"` nao e caminho nenhum: quem sabe o caminho e o
// `const ALVOS`. Sem ler o mapa, os mutantes sairiam todos como
// `ARQUIVO AUSENTE` -- alto e errado.
const RUNNER_APELIDO = `#!/usr/bin/env node
const ALVOS = {
  "apelido-do-alvo": {
    fonte: "lib/exemplo-da-ancora.ts",
    dependencias: [],
    saida: ".tmp-exemplo-da-ancora",
  },
};

const MUTANTES = [
  {
    alvo: "apelido-do-alvo",
    nome: "apelido_guarda_do_saldo",
    de: ${JSON.stringify(ANCORA)},
    para: "  if (false) return 0;",
  },
];

console.log(Object.keys(ALVOS).length, MUTANTES.length);
`;

// 5. O CASO QUE TEM DE ABORTAR: `const FONTE` E DUAS LISTAS.
//
// `mioloDoHmo246` recorta do `const FONTE` ao `];` da PRIMEIRA lista -- ele nao
// tem como saber que ha outra. Nenhum runner de verdade esta nesse estado hoje
// (o unico de duas listas nao declara `FONTE`), e esta forma existe so para que
// o caminho antigo NAO possa medir metade de um runner em silencio no dia em que
// alguem acrescentar uma segunda lista a um runner com `FONTE`.
const RUNNER_FONTE_COM_DUAS_LISTAS = `#!/usr/bin/env node
const FONTE = "lib/exemplo-da-ancora.ts";

const MUTANTES = [
  {
    nome: "fonte_primeira_lista",
    de: ${JSON.stringify(ANCORA)},
    para: "  if (false) return 0;",
  },
];

const MUTANTES_DEPOIS = [
  {
    nome: "fonte_segunda_lista",
    de: ${JSON.stringify(ANCORA)},
    para: "  if (0) return 0;",
  },
];

console.log(FONTE, MUTANTES.length, MUTANTES_DEPOIS.length);
`;

/** Os quatro fixtures da HMO-392, prontos para entrar como `extras`. */
const FORMAS_SEM_FONTE = {
  "mutantes-exemplo-da-migracao.mjs": RUNNER_MIGRACAO,
  "mutantes-exemplo-multi-alvo.mjs": RUNNER_MULTI_ALVO,
  "mutantes-exemplo-do-alvo-nomeado.mjs": RUNNER_ALVO_NOMEADO,
  "mutantes-exemplo-do-apelido.mjs": RUNNER_APELIDO,
};

const raizTmp = mkdtempSync(path.join(tmpdir(), "ancora-de-mutante-"));

/**
 * Uma arvore para a VARREDURA (sem argumento): um runner de cada familia, mais
 * os extras que o caso pedir. `extras` e um objeto `{ nomeDoArquivo: fonte }`.
 *
 * `alvos` sao os arquivos MUTADOS alem de `lib/exemplo-da-ancora.ts` --
 * `{ "caminho/relativo.ts": conteudo }`. Os fixtures da HMO-392 medem quatro
 * arquivos diferentes (um `.sql` entre eles), e o caso que mata UMA ancora
 * precisa deixar as outras tres vivas: sem isso a assercao nao distinguiria
 * "acusou o mutante certo" de "acusou todos".
 */
function arvoreDaVarredura(nome, alvo, extras = {}, alvos = {}) {
  const raiz = path.join(raizTmp, nome);
  mkdirSync(path.join(raiz, "scripts"), { recursive: true });
  mkdirSync(path.join(raiz, "lib"), { recursive: true });

  for (const f of [GUARDA, "scripts/converte-mutantes-em-bloco.mjs"]) {
    copyFileSync(path.join(RAIZ, f), path.join(raiz, f));
  }
  const runners = {
    "mutantes-exemplo-da-ancora.mjs": RUNNER_FIXTURE,
    "mutantes-exemplo-da-tupla.mjs": RUNNER_TUPLA,
    "mutantes-exemplo-do-hmo246.mjs": RUNNER_HMO246,
    ...extras,
  };
  for (const [arquivo, fonte] of Object.entries(runners)) {
    writeFileSync(path.join(raiz, "scripts", arquivo), fonte);
  }
  writeFileSync(path.join(raiz, "lib/exemplo-da-ancora.ts"), alvo);
  for (const [caminho, conteudo] of Object.entries(alvos)) {
    mkdirSync(path.join(raiz, path.dirname(caminho)), { recursive: true });
    writeFileSync(path.join(raiz, caminho), conteudo);
  }

  return raiz;
}

/** Os alvos que os quatro fixtures da HMO-392 mutam, todos intactos. */
const ALVOS_SEM_FONTE = {
  "lib/exemplo-do-outro-alvo.ts": OUTRO_ALVO,
  "lib/exemplo-do-repetido.ts": ALVO_REPETIDO,
  [MIGRACAO]: SQL_INTACTO,
};

/** Roda a guarda no modo VARREDURA -- sem argumento nenhum. */
function varrer(raiz) {
  const r = spawnSync(process.execPath, [GUARDA], { cwd: raiz, encoding: "utf8" });
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
}

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

// =====================================================
// 7. A VARREDURA LE AS TRES FAMILIAS (o lado de COBERTURA da HMO-389)
// =====================================================
// O controle positivo da varredura, e ele precisa olhar o PLACAR POR FAMILIA e
// nao so o exit code: uma guarda que lesse duas das tres familias e descartasse
// a terceira em silencio sairia 0 aqui tambem -- foi literalmente o estado da
// main por meses. O que distingue os dois mundos e o `hmo246:1`.
console.log("7. a varredura le as tres familias e diz quantas de cada");
{
  const { codigo, saida } = varrer(arvoreDaVarredura("tres-familias", ALVO_INTACTO));
  afirmar("sai 0", codigo === 0, `saiu ${codigo}:\n${saida}`);
  afirmar(
    "conta 1 runner de cada familia (painel:1 tupla:1 hmo246:1)",
    /painel:1 tupla:1 hmo246:1/.test(saida),
    `o placar por familia nao viu as tres:\n${saida}`,
  );
  afirmar(
    "mede os 3 mutantes, um por runner",
    /3 mutantes lidos em 3 runners/.test(saida),
    `nao somou os tres:\n${saida}`,
  );
}

// =====================================================
// 8. ANCORA MORTA NUM RUNNER DA FAMILIA HMO-246 REPROVA
// =====================================================
// O caso 2 prova isto na familia do painel. Repetir na HMO-246 nao e redundante:
// era a familia AUSENTE da tabela, e o defeito que a HMO-389 mediu foi
// exatamente este -- `npm run check-ancora-de-mutante` saindo 0 e dizendo
// `0 com ancora MORTA` com sete ancoras quebradas, porque os runners que as
// tinham nunca entravam no censo.
//
// Medido na HMO-389 plantando uma ancora morta em
// `mutantes-telas-de-movimentacao.mjs`, na main (8f5b79c) e com o conserto:
//
//     guarda ANTES:   exit 0   "616 mutantes em 29 runners, 0 com ancora MORTA"
//     guarda DEPOIS:  exit 1   "ancora MORTA  sem_abs  [lib/telas-de-movimentacao.ts]"
console.log("8. ancora morta na familia HMO-246 reprova");
{
  const renomeado = ALVO_INTACTO.replace("saldo < 0", "valor < 0");
  afirmar(
    "o alvo renomeado realmente perdeu a ancora",
    !renomeado.includes(ANCORA),
    "o fixture nao mudou nada -- este caso seria vacuo",
  );

  const { codigo, saida } = varrer(arvoreDaVarredura("hmo246-morta", renomeado));
  afirmar("sai != 0", codigo !== 0, `saiu ${codigo}, deveria reprovar:\n${saida}`);
  afirmar(
    "nomeia o mutante da familia HMO-246",
    /ancora MORTA {2}hmo246_guarda_do_saldo/.test(saida),
    `nao acusou o mutante do runner HMO-246:\n${saida}`,
  );
}

// =====================================================
// 9. RUNNER DE FORMA DESCONHECIDA ABORTA -- NAO E DESCARTADO (a HMO-389)
// =====================================================
// ESTE E O CONTROLE NEGATIVO DO DEFEITO. Na main, o `.filter` tirava o runner de
// forma desconhecida da lista antes do laco, e a varredura seguia e SAIA 0 --
// com um boletim limpo que nao mencionava o arquivo em lugar nenhum. O
// `console.error("nao e de familia nenhuma")` existia dentro do laco e era
// inalcancavel.
//
// A arvore tem as tres familias legiveis DE PROPOSITO: sem elas, a guarda antiga
// sairia 1 de todo modo (pela trava de "familia sem nenhum runner lido") e este
// caso passaria vacuo, sem distinguir o conserto do defeito. Com elas, a guarda
// antiga sai 0 e a consertada sai 1 -- e o que a assercao mede e o NOME do
// arquivo aparecer na saida.
console.log("9. runner de forma desconhecida aborta a varredura (o defeito da HMO-389)");
{
  const raiz = arvoreDaVarredura("sem-familia", ALVO_INTACTO, {
    "mutantes-de-forma-desconhecida.mjs": RUNNER_SEM_FAMILIA,
  });
  const { codigo, saida } = varrer(raiz);

  afirmar("sai != 0", codigo !== 0, `saiu ${codigo}, deveria abortar:\n${saida}`);
  afirmar(
    "nomeia O ARQUIVO que nao soube ler",
    /mutantes-de-forma-desconhecida\.mjs/.test(saida),
    `descartou em silencio -- o nome nao aparece na saida:\n${saida}`,
  );
  afirmar(
    "diz que a familia e que nao foi reconhecida",
    /nao e de familia nenhuma/.test(saida),
    `abortou por outro motivo:\n${saida}`,
  );
}

// =====================================================
// 10. AS QUATRO FORMAS SEM `const FONTE` SAO LIDAS (HMO-392)
// =====================================================
// O CONTROLE POSITIVO DA ISSUE. Na main os quatro fixtures casam com `ehHmo246`
// (o predicado e a CAIXA ALTA da lista, e eles a tem) e `mioloDoHmo246` os
// recusa no primeiro `if` -- era isso que mantinha 17 runners de verdade em
// `FORMA_PROPRIA`. Medido com estes fixtures na main (5739b26):
//
//     guarda ANTES:  exit 1  Error: nao achei `const FONTE = "...";`
//     guarda DEPOIS: exit 0  10 mutantes lidos em 7 runners
//
// A assercao olha o TOTAL e cada nome de mutante, nao so o exit code: um
// normalizador que lesse a primeira lista de `exemplo-da-migracao` e parasse
// sairia 0 tambem, com 9 mutantes em vez de 10 -- e a diferenca de UM e o lote
// inteiro de `MUTANTES_TS` em `mutantes-fatura-escolhida.mjs`.
console.log("10. a varredura le as quatro formas sem `const FONTE`");
{
  const { codigo, saida } = varrer(
    arvoreDaVarredura("sem-fonte", ALVO_INTACTO, FORMAS_SEM_FONTE, ALVOS_SEM_FONTE),
  );
  afirmar("sai 0", codigo === 0, `saiu ${codigo}:\n${saida}`);
  afirmar(
    "le os 7 runners e soma os 10 mutantes",
    /10 mutantes lidos em 7 runners/.test(saida),
    `o total nao fecha -- alguma lista ficou sem ser lida:\n${saida}`,
  );
  afirmar(
    "a familia hmo246 passa a contar os 5 (1 com FONTE + 4 sem)",
    /hmo246:5/.test(saida),
    `o placar por familia nao viu os quatro novos:\n${saida}`,
  );
  afirmar(
    "le AS DUAS listas do fixture de migration (2 + 1)",
    /mutantes-exemplo-da-migracao\.mjs: 3 mutantes/.test(saida),
    `leu metade do runner de duas listas e disse que leu o runner:\n${saida}`,
  );
  afirmar(
    "nenhuma ancora morta nem ambigua nos quatro",
    /0 com ancora ambigua[^\n]*0 com ancora MORTA/.test(saida),
    `a leitura nova inventou achado em arvore intacta:\n${saida}`,
  );
  afirmar(
    "nao sobra nenhum dos quatro na lista de `sem medir`",
    !/sem medir {2}scripts\/mutantes-exemplo-(da-migracao|multi-alvo|do-alvo-nomeado|do-apelido)/.test(
      saida,
    ),
    `um fixture entrou como excluido pelo nome:\n${saida}`,
  );
}

// =====================================================
// 11. ANCORA MORTA NA SEGUNDA LISTA REPROVA (a armadilha das DUAS listas)
// =====================================================
// `mutantes-fatura-escolhida.mjs` muta a migration 041 (`MUTANTES`, 10) E a
// fiacao de TypeScript que a le (`MUTANTES_TS`, 8). Um leitor que parasse na
// primeira lista imprimiria `10 mutantes`, entraria no censo como runner MEDIDO
// e deixaria 8 ancoras sem medida -- com nada na saida dizendo isso. E a mentira
// da HMO-389 uma camada mais para dentro: um numero verdadeiro sobre um recorte
// que a linha nao menciona.
//
// Este caso mata a ancora da SEGUNDA lista e deixa a primeira (o `.sql`)
// intacta. Um leitor de uma lista so sai 0 aqui.
console.log("11. ancora morta na SEGUNDA lista do mesmo runner reprova");
{
  const renomeado = ALVO_INTACTO.replace("saldo < 0", "valor < 0");
  afirmar(
    "o alvo da segunda lista realmente perdeu a ancora",
    !renomeado.includes(ANCORA),
    "o fixture nao mudou nada -- este caso seria vacuo",
  );
  afirmar(
    "a primeira lista (o .sql) segue intacta",
    SQL_INTACTO.includes(ANCORA_SQL),
    "o .sql do fixture perdeu a ancora -- o caso nao isolaria a segunda lista",
  );

  const { codigo, saida } = varrer(
    arvoreDaVarredura("segunda-lista-morta", renomeado, FORMAS_SEM_FONTE, ALVOS_SEM_FONTE),
  );
  afirmar("sai != 0", codigo !== 0, `saiu ${codigo}, deveria reprovar:\n${saida}`);
  afirmar(
    "nomeia o mutante da SEGUNDA lista",
    /ancora MORTA {2}segunda_lista_guarda_do_saldo/.test(saida),
    `a segunda lista nao foi medida:\n${saida}`,
  );
  afirmar(
    "nao acusa os mutantes da PRIMEIRA lista, que estao vivos",
    !/migracao_sem_a_(trava|view)/.test(saida),
    `acusou a lista intacta junto -- o alvo das duas listas se misturou:\n${saida}`,
  );

  // A OUTRA METADE: o caminho ANTIGO (o do `const FONTE`) nao pode medir
  // metade de um runner em silencio. Ele recorta do `FONTE` ao `];` da primeira
  // lista, entao a unica saida honesta e ABORTAR nomeando o arquivo.
  const comFonte = varrer(
    arvoreDaVarredura("fonte-com-duas-listas", ALVO_INTACTO, {
      "mutantes-exemplo-de-duas-com-fonte.mjs": RUNNER_FONTE_COM_DUAS_LISTAS,
    }),
  );
  afirmar(
    "`const FONTE` com duas listas ABORTA",
    comFonte.codigo !== 0,
    `saiu ${comFonte.codigo} -- mediu so a primeira lista e passou:\n${comFonte.saida}`,
  );
  afirmar(
    "a mensagem nomeia o arquivo e as duas listas",
    /mutantes-exemplo-de-duas-com-fonte\.mjs/.test(comFonte.saida) &&
      /MUTANTES, MUTANTES_DEPOIS/.test(comFonte.saida),
    `abortou sem dizer qual runner nem quais listas:\n${comFonte.saida}`,
  );
}

// =====================================================
// 12. O ALVO DE CADA MUTANTE E O CERTO, NAO "o primeiro arquivo do runner"
// =====================================================
// O MODO DE FALHA MAIS CARO DESTA FAMILIA, e o que a HMO-389 pagou tres vezes:
// atribuir o arquivo errado produz `ancora MORTA` FALSA, que reprova a main
// acusando codigo CORRETO. A primeira reacao de quem ve isso e desligar o step,
// e ai a guarda inteira para de valer.
//
// O caso mata a ancora SO de `lib/exemplo-do-outro-alvo.ts` -- o SEGUNDO alvo
// do fixture multi-arquivo, nomeado por `alvo:` -- e deixa
// `lib/exemplo-da-ancora.ts` intacto. Uma leitura que medisse tudo contra o
// primeiro arquivo declarado acusaria `multi_no_primeiro` (que esta vivo) e
// calaria `multi_no_segundo` (que morreu): os dois erros de uma vez, e o exit
// code seria o mesmo.
console.log("12. a ancora morta e atribuida ao arquivo CERTO entre os varios alvos");
{
  const outroMorto = OUTRO_ALVO.replace("return 1;", "return 42;");
  afirmar(
    "o segundo alvo realmente perdeu a ancora",
    !outroMorto.includes(ANCORA_DO_OUTRO),
    "o fixture nao mudou nada -- este caso seria vacuo",
  );

  const { codigo, saida } = varrer(
    arvoreDaVarredura("alvo-certo", ALVO_INTACTO, FORMAS_SEM_FONTE, {
      ...ALVOS_SEM_FONTE,
      "lib/exemplo-do-outro-alvo.ts": outroMorto,
    }),
  );
  afirmar("sai != 0", codigo !== 0, `saiu ${codigo}, deveria reprovar:\n${saida}`);
  afirmar(
    "acusa `multi_no_segundo`, e no arquivo dele",
    /ancora MORTA {2}multi_no_segundo {2}\[lib\/exemplo-do-outro-alvo\.ts\]/.test(saida),
    `nao mediu o mutante contra o alvo que ele nomeia:\n${saida}`,
  );
  afirmar(
    "NAO acusa `multi_no_primeiro`, cuja ancora esta viva",
    !/multi_no_primeiro/.test(saida),
    `MORTA FALSA: mediu o primeiro mutante contra o arquivo do segundo:\n${saida}`,
  );
  afirmar(
    "NAO acusa o mutante do apelido, que aponta para o alvo intacto",
    !/apelido_guarda_do_saldo/.test(saida),
    `o mapa de apelidos resolveu para o arquivo errado:\n${saida}`,
  );
}

// =====================================================
// 13. `todas: true` DISPENSA A OCORRENCIA UNICA -- MAS NAO O ZERO
// =====================================================
// AS SEIS PRIMEIRAS "ANCORAS AMBIGUAS" DA LEITURA NOVA ERAM FALSAS: cinco em
// `mutantes-transferencia-recorrente.mjs` e uma em
// `mutantes-contrato-dos-cartoes.mjs`, todas em mutantes com `todas: true`, cujo
// driver usa `replaceAll` -- ali as DUAS ocorrencias sao o mutante, e o
// comentario do `CORPO_DO_CHECK` diz isso em voz alta.
//
// O risco de respeitar o campo e transformar `todas: true` em escotilha: um
// mutante que nao mede nada ficaria verde so por declarar o campo. Por isso o
// caso tem as DUAS metades, e a segunda e a que importa -- `replaceAll` de um
// trecho que nao existe tambem nao muta nada.
console.log("13. `todas: true` passa com 2 ocorrencias e REPROVA com zero");
{
  afirmar(
    "o alvo do `todas` realmente tem o trecho DUAS vezes",
    ALVO_REPETIDO.split(PEDAGIO).length - 1 === 2,
    "o fixture nao repete o trecho -- a metade positiva seria vacua",
  );

  const { codigo, saida } = varrer(
    arvoreDaVarredura("todas-duas", ALVO_INTACTO, FORMAS_SEM_FONTE, ALVOS_SEM_FONTE),
  );
  afirmar("2 ocorrencias com `todas: true` sai 0", codigo === 0, `saiu ${codigo}:\n${saida}`);
  afirmar(
    "nao acusa AMBIGUA no mutante que quer as duas",
    !/as_duas_ocorrencias_de_uma_vez/.test(saida),
    `AMBIGUA FALSA: o campo \`todas\` nao foi lido:\n${saida}`,
  );

  // A SEGUNDA METADE: o mesmo mutante, com o trecho apagado do alvo.
  const semOPedagio = ALVO_REPETIDO.replaceAll(PEDAGIO, "sempre");
  afirmar(
    "o alvo sem o pedagio realmente perdeu o trecho",
    !semOPedagio.includes(PEDAGIO),
    "o fixture nao mudou nada -- a metade negativa seria vacua",
  );

  const zero = varrer(
    arvoreDaVarredura("todas-zero", ALVO_INTACTO, FORMAS_SEM_FONTE, {
      ...ALVOS_SEM_FONTE,
      "lib/exemplo-do-repetido.ts": semOPedagio,
    }),
  );
  afirmar("zero ocorrencia com `todas: true` sai != 0", zero.codigo !== 0, `saiu ${zero.codigo}`);
  afirmar(
    "diz ancora MORTA e nomeia o mutante",
    /ancora MORTA {2}as_duas_ocorrencias_de_uma_vez/.test(zero.saida),
    `\`todas: true\` virou escotilha -- zero ocorrencia passou:\n${zero.saida}`,
  );
}

// =====================================================
// 14. O RUNNER ILEGIVEL NAO ESCONDE A ANCORA MORTA DOS OUTROS (HMO-483)
// =====================================================
// ESTE E O CONTROLE NEGATIVO DO DEFEITO QUE DEIXOU A PRE-COMMIT DA MAIN
// VERMELHA E CEGA AO MESMO TEMPO.
//
// `mutantes-fora-dos-totais-nas-somas.mjs` nao carregava (`MOVIMENTACOES is not
// defined`), e a guarda SUBIA A EXCECAO ali mesmo, no meio da varredura. Todo
// runner depois dele nunca era medido. Na main isso escondia duas ancoras mortas
// de verdade -- `select_sem_o_embed_da_conta` e `select_sem_notes`, as duas em
// `lib/realizado-do-caixa.ts`.
//
// A ARVORE TEM OS DOIS DEFEITOS DE UMA VEZ, e e disso que o caso vive: um runner
// que NAO CARREGA (familia reconhecida, miolo com constante nao declarada) e um
// OUTRO runner, separado, cuja ancora esta morta. A guarda consertada tem de
// relatar OS DOIS NA MESMA VARREDURA.
//
// A ASSERCAO NAO DEPENDE DA ORDEM DO `readdirSync`, de proposito: `exigir os dois`
// e verdade em qualquer ordem com o acumulo, e e falsa em ALGUMA ordem sem ele.
// Amarrar o teste a uma ordem que o SO nao promete seria um verde que viaja.
console.log("14. runner ilegivel nao esconde a ancora morta dos outros (HMO-483)");
{
  // Familia tupla (tem `const mutantes = [` e entrada que abre em `  [`), mas o
  // miolo referencia uma constante que nao existe -- exatamente a forma do
  // defeito: a leitura quebra no import do miolo, nao no predicado de familia.
  const RUNNER_ILEGIVEL = `#!/usr/bin/env node
const ALVO = "lib/exemplo-da-ancora.ts";

const mutantes = [
  [
    "tupla_que_nao_carrega",
    NAO_DECLARADA_EM_LUGAR_NENHUM,
    "  if (false) return 0;",
  ],
];

console.log(mutantes.length);
`;

  // O SEGUNDO DEFEITO, em runner proprio: ancora que nao casa com o alvo.
  const RUNNER_COM_ANCORA_MORTA = `#!/usr/bin/env node
const ALVO = "lib/exemplo-da-ancora.ts";

const mutantes = [
  [
    "a_morta_que_vinha_depois",
    "  if (saldo < -999999) return 0;",
    "  if (false) return 0;",
  ],
];

console.log(mutantes.length);
`;

  const raiz = arvoreDaVarredura("ilegivel-nao-esconde", ALVO_INTACTO, {
    "mutantes-aaa-ilegivel.mjs": RUNNER_ILEGIVEL,
    "mutantes-zzz-ancora-morta.mjs": RUNNER_COM_ANCORA_MORTA,
  });
  const { codigo, saida } = varrer(raiz);

  afirmar("sai != 0", codigo !== 0, `saiu ${codigo}, deveria reprovar:\n${saida}`);
  afirmar(
    "nomeia o runner que nao soube LER",
    /mutantes-aaa-ilegivel\.mjs/.test(saida),
    `o runner ilegivel nao aparece na saida:\n${saida}`,
  );
  afirmar(
    "diz que o motivo foi a LEITURA, com a causa",
    /NAO LIDO {2}scripts\/mutantes-aaa-ilegivel\.mjs: .*NAO_DECLARADA_EM_LUGAR_NENHUM/.test(saida),
    `nao disse POR QUE nao leu:\n${saida}`,
  );
  // A ASSERCAO QUE SO O CONSERTO SATISFAZ. Com o `throw`, a varredura morria no
  // runner ilegivel e esta linha nunca era impressa.
  afirmar(
    "AINDA mede o outro runner e acha a ancora morta dele",
    /ancora MORTA {2}a_morta_que_vinha_depois/.test(saida),
    `O DEFEITO DA HMO-483: o runner ilegivel levou embora a medicao dos outros:\n${saida}`,
  );
  // O boletim nao pode contar o ilegivel como medido -- `assercao que mente`.
  // A arvore tem CINCO runners (os tres fixtures de familia mais os dois deste
  // caso) e um deles nao le: o censo honesto e "4 medidos, 1 nao lido", nunca 5.
  afirmar(
    "o boletim conta os MEDIDOS, nao os tentados",
    /mutantes lidos em 4 runners/.test(saida) &&
      /1 NAO LIDOS/.test(saida) &&
      /5 runners no disco, 4 medidos/.test(saida),
    `o censo somou o runner que nao leu (5 em vez de 4):\n${saida}`,
  );
}

// =====================================================
// 15. SUITE COM NOME PROPRIO ANTES DOS ARQUIVOS SOBREVIVE AO RECORTE (HMO-483)
// =====================================================
// A CAUSA do caso 14, medida sozinha. `mioloDaTupla` escolhia o inicio do
// recorte pela primeira constante de ARQUIVO, filtrando as de `test:`. Um runner
// que declare as suites ANTES dos arquivos -- e use cada uma como 5o elemento
// das entradas, porque seus mutantes caem em suites diferentes -- tinha o miolo
// comecando DEPOIS delas, e nao carregava.
//
// A aridade 5 e a 4 com a suite no fim; as tres primeiras posicoes, que e de
// onde a ancora sai, sao as mesmas.
console.log("15. suite com nome proprio antes dos arquivos sobrevive ao recorte (HMO-483)");
{
  const RUNNER_ARIDADE_5 = `#!/usr/bin/env node
const UMA = "test:uma-suite";
const OUTRA = "test:outra-suite";

const ALVO = "lib/exemplo-da-ancora.ts";

const mutantes = [
  [
    ALVO,
    "aridade5_guarda_do_saldo",
    ${JSON.stringify(ANCORA)},
    "  if (false) return 0;",
    UMA,
  ],
  [
    ALVO,
    "aridade5_segunda_suite",
    ${JSON.stringify(ANCORA)},
    "  if (true) return 0;",
    OUTRA,
  ],
];

console.log(mutantes.length);
`;

  const raiz = arvoreDaVarredura("aridade-5", ALVO_INTACTO, {
    "mutantes-exemplo-da-aridade-5.mjs": RUNNER_ARIDADE_5,
  });
  const { codigo, saida } = varrer(raiz);

  afirmar(
    "le o runner em vez de morrer com `UMA is not defined`",
    !/NAO LIDO/.test(saida) && !/is not defined/.test(saida),
    `o recorte levou as suites embora:\n${saida}`,
  );
  afirmar(
    "le os DOIS mutantes da aridade 5",
    /mutantes-exemplo-da-aridade-5\.mjs: 2 mutantes/.test(saida),
    `a lista nao foi lida inteira:\n${saida}`,
  );
  afirmar("arvore intacta sai 0", codigo === 0, `saiu ${codigo}:\n${saida}`);

  // A METADE NEGATIVA: a ancora da aridade 5 e MEDIDA de verdade, nao so lida.
  // Sem isto, "2 mutantes" passaria igual com a medicao desligada.
  const semAncora = varrer(
    arvoreDaVarredura("aridade-5-morta", ALVO_INTACTO.replace(ANCORA, "  return saldo * 2;"), {
      "mutantes-exemplo-da-aridade-5.mjs": RUNNER_ARIDADE_5,
    }),
  );
  afirmar(
    "a ancora da aridade 5 reprova quando morre",
    semAncora.codigo !== 0 &&
      /ancora MORTA {2}aridade5_guarda_do_saldo/.test(semAncora.saida),
    `a aridade 5 foi lida mas nao medida:\n${semAncora.saida}`,
  );
}

// =====================================================
// 16. A LISTA CONSTRUIDA POR `push` E LIDA -- E MEDIDA (HMO-483)
// =====================================================
// A QUARTA FAMILIA. `mutantes-atualizar-nas-cinco-telas.mjs` declara
// `const mutantes = [];` VAZIA e a enche com `mutantes.push([...])`, parte em
// laco sobre uma tabela de telas. Nenhum dos tres recortes anteriores a achava,
// e ela era `NAO LIDO` na varredura -- 29 ancoras sem medicao nenhuma.
//
// AS DUAS METADES IMPORTAM, e a segunda e a que o repo aprendeu a cobrar: ler a
// lista nao prova que a ancora foi MEDIDA
// (`guarda-de-ancora-verde-nao-prova-que-o-mutante-morre`). O caso roda a
// varredura DUAS vezes -- arvore intacta e arvore com a ancora removida -- e
// exige verde na primeira e vermelho NOMEADO na segunda.
//
// A ENTRADA VINDA DO LACO E A QUE SE CONFERE, nao a escrita a mao: e o laco que
// monta o `de` por TEMPLATE, e e a forma em que uma ancora morre sem o placar
// mudar de tamanho (renomear o leitor de UMA tela mata a ancora daquela tela e
// deixa as outras vivas).
console.log("16. a lista construida por `push` e lida -- e medida (HMO-483)");
{
  const RUNNER_POR_PUSH = `#!/usr/bin/env node
import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const SUITE = "test:exemplo";

const TELAS = [
  ["uma tela", "lib/exemplo-da-ancora.ts"],
];

/** \`[nome, arquivo, de, para]\` */
const mutantes = [];

for (const [rotulo, arquivo] of TELAS) {
  mutantes.push([
    \`push_do_laco: \${rotulo}\`,
    arquivo,
    ${JSON.stringify(ANCORA)},
    "  if (false) return 0;",
  ]);
}

mutantes.push([
  "push_escrito_a_mao",
  "lib/exemplo-da-ancora.ts",
  ${JSON.stringify(ANCORA)},
  "  if (true) return 0;",
]);

const bloco = criarBlocoDeMutantes({
  rotulo: "exemplo",
  suites: [SUITE],
});

for (const [nome, arquivo, de, para] of mutantes) {
  console.log(nome, arquivo, de, para);
}
`;

  const raiz = arvoreDaVarredura("lista-por-push", ALVO_INTACTO, {
    "mutantes-exemplo-por-push.mjs": RUNNER_POR_PUSH,
  });
  const { codigo, saida } = varrer(raiz);

  afirmar(
    "le o runner em vez de o reportar como ilegivel",
    !/NAO LIDO/.test(saida),
    `a familia por push nao foi reconhecida:\n${saida}`,
  );
  afirmar(
    "le os DOIS mutantes (o do laco e o escrito a mao)",
    /mutantes-exemplo-por-push\.mjs: 2 mutantes/.test(saida),
    `a lista nao foi lida inteira -- o recorte provavelmente perdeu os push:\n${saida}`,
  );
  afirmar("arvore intacta sai 0", codigo === 0, `saiu ${codigo}:\n${saida}`);
  afirmar(
    "a familia `push` aparece no boletim com a contagem dela",
    /push:1/.test(saida),
    `a familia nova nao entrou no censo por familia:\n${saida}`,
  );

  // A METADE NEGATIVA: sem ela, "2 mutantes" passaria igual com a medicao
  // desligada. A ancora que morre e a que o LACO montou.
  const semAncora = varrer(
    arvoreDaVarredura("lista-por-push-morta", ALVO_INTACTO.replace(ANCORA, "  return saldo * 2;"), {
      "mutantes-exemplo-por-push.mjs": RUNNER_POR_PUSH,
    }),
  );
  afirmar(
    "a ancora montada pelo laco reprova quando morre",
    semAncora.codigo !== 0 && /ancora MORTA {2}push_do_laco: uma tela/.test(semAncora.saida),
    `a lista por push foi lida mas nao medida:\n${semAncora.saida}`,
  );
}

// =====================================================
// 17. O MUTANTE DE VARIAS EDICOES RENDE UMA ANCORA POR EDICAO (HMO-483)
// =====================================================
// `edicoes: [[de, para], ...]` e a forma dos runners de migration SQL que
// plantam o defeito em mais de um lugar do mesmo arquivo (as duas pontas de um
// `FILTER`). Antes desta medicao a leitura pegava `m.de`, que nestes mutantes e
// `undefined` -- e `mutantes-patrimonio-fora-dos-totais.mjs` nem chegava la,
// porque a lista dele em minuscula nao casava com familia nenhuma.
//
// O CASO QUE DA NOME A ISTO: a SEGUNDA edicao morta, a primeira viva. O mutante
// ainda muda o arquivo, a suite ainda fica vermelha, e ele entra no placar como
// MORTO medindo metade do que o `porque` dele afirma
// (`mutante-de-varias-edicoes-sobrevive-falso-quando-uma-delas-nao-casa`). Uma
// ancora por mutante nao ve isso; uma por edicao ve, e diz QUAL.
console.log("17. o mutante de varias edicoes rende uma ancora por edicao (HMO-483)");
{
  const SEGUNDA = "  if (saldo > 1000) return saldo;";
  const ALVO_DE_DUAS = `export function sobra(saldo: number): number {
${ANCORA}
${SEGUNDA}
  return saldo;
}
`;

  const RUNNER_EDICOES = `#!/usr/bin/env node
const ALVO = "lib/exemplo-da-ancora.ts";

const PRIMEIRA_PONTA = ${JSON.stringify(ANCORA)};
const SEGUNDA_PONTA = ${JSON.stringify(SEGUNDA)};

const MUTANTES = [
  {
    nome: "as_duas_pontas",
    edicoes: [
      [PRIMEIRA_PONTA, "  if (false) return 0;"],
      [SEGUNDA_PONTA, "  if (false) return saldo;"],
    ],
  },
];

console.log(MUTANTES.length);
`;

  const raiz = arvoreDaVarredura("edicoes", ALVO_DE_DUAS, {
    "mutantes-exemplo-das-edicoes.mjs": RUNNER_EDICOES,
  });
  const { codigo, saida } = varrer(raiz);

  afirmar(
    "conta DUAS ancoras para UM mutante de duas edicoes",
    /mutantes-exemplo-das-edicoes\.mjs: 2 mutantes/.test(saida),
    `as edicoes nao renderam uma ancora cada:\n${saida}`,
  );
  afirmar("as duas vivas saem 0", codigo === 0, `saiu ${codigo}:\n${saida}`);

  // A METADE QUE DA NOME AO CASO: so a SEGUNDA ponta morre.
  const soASegunda = varrer(
    arvoreDaVarredura("edicoes-segunda-morta", ALVO_DE_DUAS.replace(SEGUNDA, "  if (saldo > 2000) return saldo;"), {
      "mutantes-exemplo-das-edicoes.mjs": RUNNER_EDICOES,
    }),
  );
  afirmar(
    "a SEGUNDA edicao morta reprova",
    soASegunda.codigo !== 0,
    `a edicao morta passou:\n${soASegunda.saida}`,
  );
  afirmar(
    "e a saida diz QUAL edicao morreu",
    /ancora MORTA {2}as_duas_pontas \[edicao 2\/2\]/.test(soASegunda.saida),
    `nao disse qual das pontas morreu:\n${soASegunda.saida}`,
  );
  afirmar(
    "e NAO acusa a primeira, que esta viva",
    !/as_duas_pontas \[edicao 1\/2\]/.test(soASegunda.saida),
    `acusou a ponta viva tambem:\n${soASegunda.saida}`,
  );
}

rmSync(raizTmp, { recursive: true, force: true });

if (falhas > 0) {
  console.error(`\n${falhas} assercao(oes) falharam.`);
  process.exit(1);
}
console.log("\ntodas as assercoes passaram -- a guarda de ancora sabe reprovar.");
