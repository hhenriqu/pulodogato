#!/usr/bin/env node
// Quebra o build quando existe um runner de mutante que nenhum workflow roda
// E que ninguem declarou como intencionalmente fora do CI.
//
// POR QUE ISTO EXISTE (HMO-322)
// -----------------------------
// Medido ao escrever este arquivo: 62 runners `scripts/mutantes-*` na arvore,
// 19 invocados por algum step de workflow, 43 que nenhum job executa. Entre os
// 43 estava o `mutantes-crivos.mjs`, que tem alvo proprio no package.json
// (`mutantes:crivos`) e mesmo assim nao era chamado por workflow nenhum.
//
// Runner de mutante e o aparelho que prova que uma suite MEDE o que ela diz
// medir. Um runner que ninguem roda nao prova nada -- e nao da sintoma: o
// arquivo esta no repositorio, tem o nome certo, aparece no `ls`, e ler a
// arvore da a impressao de que aquela afirmacao esta protegida por controle
// negativo. Mesma familia de "tabela sem leitor parece feature pronta", e o
// mesmo desenho do `check-tests-in-ci.mjs`, pela mesma razao: 43 puderam
// acumular justamente porque nada contava.
//
// Pior que a aparencia de cobertura: os 43 nunca rodaram em CI, entao a taxa de
// apodrecimento deles e a priori pior que a dos 19 (a HMO-319 achou cinco dos
// 19 reprovando na main por copia de arvore defasada ou ancora morta -- e esses
// pelo menos tinham step para eventualmente denunciar).
//
// O QUE ESTA VERIFICACAO NAO E
// ----------------------------
// Nao e "ligue os 43". Cada job do Actions custa a partida (~30s) mais o
// arredondamento para o minuto cheio, e a franquia e de 2.000 min/mes -- foi
// essa restricao que originou a HMO-261. Botar 43 runners no CI aumenta a
// conta. O que esta verificacao exige e mais barato e mais honesto: que "fora
// do CI" seja uma DECLARACAO com motivo escrito
// (`declaracao-de-mutantes-fora-do-ci.mjs`) em vez de um acidente silencioso.
//
// TEXTUAL, E SEM OS COMENTARIOS
// -----------------------------
// Textual de proposito, igual ao `check-tests-in-ci.mjs`: nao interpreta YAML,
// nao precisa de dependencia nova (o `yaml` que o `medir-controles-negativos`
// importa nem esta no package.json -- vem de dependencia transitiva) e roda em
// milissegundos, entao cabe no job sem filtro de path, obrigatorio em todo PR.
//
// Mas textual CRU mentiria, e isto foi medido: os workflows citam runners
// dentro de comentarios ("A prova de mutacao completa e `npm run
// mutantes:retorno-lancamento`"), e uma busca que le comentario conta a mencao
// como step -- o runner pareceria vigiado sem ter um unico job. Com a regex
// deste arquivo isso inflava 19 para 21 (`mutantes-convite-sem-conta.sh` e
// `mutantes-trava-de-membro.mjs`); com uma regex de borda mais frouxa inflaria
// para 26, porque as cinco mencoes de "ferramenta de quem escreve o teste"
// estao em comentario. Por isso toda linha cujo primeiro caractere nao-branco e
// `#` sai antes da busca -- e ela e comentario de YAML ou de shell, e nos dois
// casos nao executa nada.
//
// O erro residual desse recorte e CONSERVADOR: se algum dia um `run:` de
// verdade for descartado por parecer comentario, a verificacao ACUSA um runner
// que esta no CI (alarme falso, visivel) em vez de absolver um que nao esta
// (buraco calado). Esse e o lado certo para errar.
//
// O NOME DO STEP NAO E O NOME DO ARQUIVO
// --------------------------------------
// Casar arquivo com step pelo nome do arquivo daria falso positivo: o alvo
// `mutantes:parte-de-grupo-na-lista` roda `scripts/mutantes-ancora-da-parte-de-
// grupo.mjs`. Entao toda invocacao e resolvida ATE O ARQUIVO -- a direta
// (`node scripts/mutantes-x.mjs`) pelo proprio caminho, e a indireta
// (`npm run mutantes:y`) pelo package.json, inclusive quando um alvo npm chama
// outro.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORA_DO_CI, MOTIVOS } from "./declaracao-de-mutantes-fora-do-ci.mjs";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const DIR_WORKFLOWS = join(RAIZ, ".github/workflows");
const DECLARACAO = "scripts/declaracao-de-mutantes-fora-do-ci.mjs";

/**
 * O TETO da divida herdada: quantos runners podem estar `nao-triado`.
 *
 * Ele so desce. Sem o teto, a declaracao seria o jeito educado de arquivar o
 * problema -- bastaria marcar o runner novo como `nao-triado` e os 43 voltariam
 * a crescer calados, que e o que a HMO-322 foi aberta para impedir. Com o teto,
 * triar um runner OBRIGA a baixar o numero aqui, e o numero e o placar da
 * divida.
 */
const TETO_NAO_TRIADO = 34;

const erros = [];
const avisos = [];

// ---------------------------------------------------------------------------
// 1. Os runners que existem na arvore
// ---------------------------------------------------------------------------
const naArvore = readdirSync(join(RAIZ, "scripts"))
  .filter((f) => /^mutantes-.*\.(mjs|sh)$/.test(f))
  .map((f) => `scripts/${f}`)
  .sort();

if (naArvore.length === 0) {
  console.error(
    `Nenhum scripts/mutantes-* na arvore -- a verificacao perdeu o alvo.\n` +
      `Ou o padrao do nome mudou, ou este arquivo esta rodando da raiz errada.`,
  );
  process.exit(1);
}

// A declaracao NAO pode entrar na propria lista que ela descreve. Ela se chamou
// `scripts/mutantes-fora-do-ci.mjs` por um instante enquanto a HMO-322 era
// escrita, e nesse nome ela casava com `^mutantes-` e se contava como runner --
// uma sonda que se mede a si mesma. O nome atual nao casa; esta linha e que
// impede a volta.
if (naArvore.includes(DECLARACAO)) {
  erros.push(
    `${DECLARACAO} esta sendo contado como RUNNER de mutante.\n` +
      `    A declaracao nao pode casar com o padrao \`scripts/mutantes-*\` que ela descreve.\n` +
      `    Renomeie-a para fora desse espaco de nomes.`,
  );
}

const pkg = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"));

// ---------------------------------------------------------------------------
// 2. Resolver invocacao -> ARQUIVO
// ---------------------------------------------------------------------------
const DIRETA = /(?:^|[\s;&|(])(?:node|bash|sh)\s+(scripts\/mutantes-[a-z0-9-]+\.(?:mjs|sh))/g;
const POR_NPM = /(?:^|[\s;&|(])npm\s+run\s+(mutantes:[a-z0-9:-]+)/g;

/** Os arquivos de runner que um alvo npm invoca, seguindo alvo que chama alvo. */
function arquivosDoAlvo(nome, vistos = new Set()) {
  if (vistos.has(nome)) return []; // alvo que chama a si mesmo nao travaria aqui
  vistos.add(nome);
  const comando = pkg.scripts?.[nome];
  if (comando === undefined) {
    erros.push(
      `\`npm run ${nome}\` e invocado, mas nao existe script com esse nome no package.json.\n` +
        `    O step morre em runtime, ou -- pior -- esta num bloco que engole o codigo de saida.`,
    );
    return [];
  }
  const arquivos = [...comando.matchAll(DIRETA)].map((m) => m[1]);
  for (const m of comando.matchAll(POR_NPM)) arquivos.push(...arquivosDoAlvo(m[1], vistos));
  return arquivos;
}

/** Tira as linhas de comentario -- de YAML e de shell -- antes de procurar invocacao. */
function semComentarios(texto) {
  return texto
    .split("\n")
    .filter((linha) => !/^\s*#/.test(linha))
    .join("\n");
}

/**
 * Os nomes dos steps ATIVOS, exatos, para conferir `coberto_por`.
 *
 * Por que exato e nao `includes`: todo bloco de mutante deste repositorio tem
 * um step companheiro chamado `A arvore voltou ao lugar depois de "<nome do
 * bloco>"`, e o nome do bloco esta DENTRO dele. Com busca por substring, apagar
 * o bloco de verdade deixava o `coberto_por` casando com o step de restauracao
 * -- que nao exercita nada -- e a cobertura morta passava por viva. Foi um
 * sobrevivente real do `mutantes-guarda-dos-mutantes.mjs`, nao hipotese.
 */
function nomesDeStep(texto) {
  return new Set(
    texto
      .split("\n")
      .map((l) => l.match(/^\s*-\s*name:\s*(.+?)\s*$/))
      .filter(Boolean)
      .map((m) => m[1].replace(/^['"]|['"]$/g, "")),
  );
}

// ---------------------------------------------------------------------------
// 3. Quem os workflows invocam de verdade
// ---------------------------------------------------------------------------
/** arquivo de runner -> [workflows que o invocam] */
const invocadoPor = new Map();
/** Os nomes de step ativos em todos os workflows, para conferir `coberto_por`. */
const stepsAtivos = new Set();

for (const arquivo of readdirSync(DIR_WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort()) {
  const texto = semComentarios(readFileSync(join(DIR_WORKFLOWS, arquivo), "utf8"));
  for (const nome of nomesDeStep(texto)) stepsAtivos.add(nome);
  const achados = [
    ...[...texto.matchAll(DIRETA)].map((m) => m[1]),
    ...[...texto.matchAll(POR_NPM)].flatMap((m) => arquivosDoAlvo(m[1])),
  ];
  for (const f of new Set(achados)) {
    if (!invocadoPor.has(f)) invocadoPor.set(f, []);
    invocadoPor.get(f).push(arquivo);
  }
}

// Step que chama runner que nao existe: nao e "fora do CI", e step morto.
for (const [arquivo, workflows] of invocadoPor) {
  if (!naArvore.includes(arquivo)) {
    erros.push(
      `${workflows.join(", ")} invoca ${arquivo}, que nao existe na arvore.\n` +
        `    Ou o runner foi apagado e o step ficou, ou o caminho esta escrito errado.`,
    );
  }
}

// Alvo npm que aponta para runner inexistente -- ninguem descobre ate chamar.
for (const nome of Object.keys(pkg.scripts ?? {}).filter((n) => n.startsWith("mutantes:"))) {
  for (const arquivo of [...(pkg.scripts[nome].matchAll(DIRETA) ?? [])].map((m) => m[1])) {
    if (!naArvore.includes(arquivo)) {
      erros.push(`O alvo \`npm run ${nome}\` aponta para ${arquivo}, que nao existe na arvore.`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. A declaracao esta coerente com a arvore e com os workflows?
// ---------------------------------------------------------------------------
for (const [arquivo, entrada] of Object.entries(FORA_DO_CI)) {
  if (!naArvore.includes(arquivo)) {
    erros.push(
      `${DECLARACAO} declara ${arquivo}, que nao existe na arvore.\n` +
        `    Se o runner foi apagado, tire a linha da declaracao junto.`,
    );
    continue;
  }
  if (!MOTIVOS.includes(entrada.motivo)) {
    erros.push(
      `${arquivo} tem motivo \`${entrada.motivo}\`, que nao esta no vocabulario.\n` +
        `    Aceitos: ${MOTIVOS.join(", ")}.`,
    );
  }
  if (!entrada.porque || entrada.porque.trim().length < 5) {
    erros.push(`${arquivo} esta declarado fora do CI sem explicar por que (campo \`porque\`).`);
  }
  // Declaracao que sobreviveu ao step: o runner ENTROU no CI e a linha ficou.
  // Deixar passar faria o censo por motivo mentir, e e o censo que mede a divida.
  if (invocadoPor.has(arquivo)) {
    erros.push(
      `${arquivo} esta declarado fora do CI, mas ${invocadoPor
        .get(arquivo)
        .join(", ")} o invoca.\n` +
        `    A declaracao ficou para tras -- tire a linha de ${DECLARACAO}.`,
    );
  }
  // "Outro cobre isso" tem de ser falsificavel: o alvo citado precisa rodar.
  const exigeCobertura = ["ferramenta-de-autor", "coberto-por-outro"].includes(entrada.motivo);
  if (exigeCobertura) {
    if (!entrada.coberto_por) {
      erros.push(
        `${arquivo} tem motivo \`${entrada.motivo}\` e nao diz \`coberto_por\`.\n` +
          `    Sem nomear quem cobre a afirmacao, o motivo e so uma promessa.`,
      );
    } else if (!stepsAtivos.has(entrada.coberto_por) && !invocadoPor.has(entrada.coberto_por)) {
      erros.push(
        `${arquivo} diz ser coberto por "${entrada.coberto_por}", que nao e nenhum step ativo\n` +
          `    nem nenhum runner invocado.\n` +
          `    O bloco que cobria a afirmacao foi renomeado ou sumiu, e a cobertura acabou com ele.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 5. A peneira principal: runner que ninguem roda e ninguem declarou
// ---------------------------------------------------------------------------
const orfaos = naArvore.filter((f) => !invocadoPor.has(f) && !(f in FORA_DO_CI));

if (orfaos.length > 0) {
  erros.push(
    `Runner de mutante que nenhum workflow roda e ninguem declarou:\n` +
      orfaos.map((f) => `      ${f}`).join("\n") +
      `\n    Ele parece controle negativo e nao e: ler a arvore sugere que aquela\n` +
      `    afirmacao esta protegida, e nenhum job a protege.\n\n` +
      `    Escolha um dos tres (nenhum deles e "deixa como esta"):\n` +
      `      1. vale e passa  -> step num workflow. Se e TypeScript, o\n` +
      `         .github/workflows/verificacao.yml; se precisa de Postgres, o\n` +
      `         .github/workflows/db-verify.yml, que ja tem banco de pe e a cadeia\n` +
      `         subida -- la o custo e tempo de step e nao partida de maquina.\n` +
      `      2. vale e nao passa -> issue propria, e entrada \`nao-triado\` na declaracao\n` +
      `      3. nao vale mais -> \`git rm\`, dizendo no commit por que.\n` +
      `         Decisao do Helio em 2026-10-07: para o que esta sem veredito, o 3 e o\n` +
      `         DEFAULT. O 1 e a excecao, e quem o escolhe defende a afirmacao medida.`,
  );
}

// ---------------------------------------------------------------------------
// 6. O teto da divida, que so desce
// ---------------------------------------------------------------------------
const naoTriados = Object.entries(FORA_DO_CI).filter(([, e]) => e.motivo === "nao-triado");

if (naoTriados.length > TETO_NAO_TRIADO) {
  erros.push(
    `${naoTriados.length} runners estao \`nao-triado\`, e o teto e ${TETO_NAO_TRIADO}.\n` +
      `    \`nao-triado\` e divida herdada da HMO-322, nao uma decisao: nao se cria\n` +
      `    entrada nova com esse motivo. Para um runner NOVO, escolha entre dar-lhe um\n` +
      `    step, apontar quem cobre a mesma afirmacao, ou nao escrever o runner.`,
  );
} else if (naoTriados.length < TETO_NAO_TRIADO) {
  erros.push(
    `${naoTriados.length} runners \`nao-triado\`, abaixo do teto de ${TETO_NAO_TRIADO}: ` +
      `baixe TETO_NAO_TRIADO para ${naoTriados.length} em scripts/check-mutantes-in-ci.mjs.\n` +
      `    O teto e uma catraca -- se ele nao acompanhar a triagem, para de medir.`,
  );
}

// ---------------------------------------------------------------------------
// Veredito
// ---------------------------------------------------------------------------
if (erros.length > 0) {
  console.error(`Controle negativo sem vigilancia (${erros.length}):\n`);
  for (const e of erros) console.error(`  - ${e}\n`);
  process.exit(1);
}

for (const a of avisos) console.warn(`aviso: ${a}`);

const censo = MOTIVOS.map(
  (m) => `${Object.values(FORA_DO_CI).filter((e) => e.motivo === m).length} ${m}`,
).join(", ");

console.log(
  `${naArvore.length} runners de mutante na arvore: ${invocadoPor.size} invocados por algum ` +
    `workflow, ${Object.keys(FORA_DO_CI).length} declarados fora do CI (${censo}).\n` +
    `Nenhum runner passa por controle negativo sem ser nem rodado nem declarado.`,
);
process.exit(0);
