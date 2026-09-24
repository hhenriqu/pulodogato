#!/usr/bin/env node
// Quebra o build quando existe uma migration que o db-verify nao roda.
//
// Por que isto existe (HMO-145): o db-verify enumera as migrations A MAO, um
// step por arquivo. Toda vez que alguem adiciona uma migration e esquece do
// workflow, o CI passa a validar uma cadeia que NAO e a de producao -- e o job
// fica verde justamente porque nao exercita o arquivo novo.
//
// Ja aconteceu tres vezes, e o proprio db-verify.yml registra duas delas em
// comentario: a 004 ficou de fora ate 2026-09-22, a 011 entrou na main pelo
// PR #20 e nunca foi exercitada, e a 013 seria a terceira. Um comentario
// pedindo para lembrar nao resolve isso; uma verificacao resolve.
//
// A checagem e textual de proposito: nao interpreta YAML, nao precisa de
// dependencia nova e roda em milissegundos, entao cabe no code-schema-drift,
// que e o job sem filtro de path e obrigatorio em todo PR.
//
// O que ela NAO cobre: se o step existe mas roda o arquivo errado, ou se o
// `ON_ERROR_STOP` sair do $PSQL. Isto e um piso, nao uma garantia.
//
// A SEGUNDA verificacao daqui (HMO-149) e sobre o outro lado: o CI roda as
// migrations com psql, mas PRODUCAO nao. Producao nao tem runner de migration
// -- quem aplica e uma pessoa, colando o arquivo no SQL Editor do Supabase.
// Ver a nota no topo de database/migrations/015 e /016.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const DIR_MIGRATIONS = join(RAIZ, "database/migrations");
const DIR_MAINTENANCE = join(RAIZ, "database/maintenance");

// O 000 e inventario de preflight, nao muda schema: nunca entrou na cadeia do
// db-verify e nao deve entrar. Fica explicito aqui para que a excecao seja uma
// decisao visivel, e nao um filtro esperto escondido na leitura.
const FORA_DA_CADEIA = new Set(["000_preflight_inventory.sql"]);

const workflow = readFileSync(join(RAIZ, ".github/workflows/db-verify.yml"), "utf8");

const migrations = readdirSync(DIR_MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => !FORA_DA_CADEIA.has(f))
  .sort();

const ausentes = migrations.filter(
  (f) => !workflow.includes(`database/migrations/${f}`),
);

// A verificacao tambem falha no sentido contrario: um step que aponta para um
// arquivo que nao existe mais quebraria o job com "No such file", mas so
// depois de subir um Postgres. Pegar aqui custa milissegundos.
const citadas = [...workflow.matchAll(/database\/migrations\/([0-9A-Za-z_]+\.sql)/g)].map(
  (m) => m[1],
);
const existentes = new Set(readdirSync(DIR_MIGRATIONS));
const fantasmas = [...new Set(citadas)].filter((f) => !existentes.has(f));

// -----------------------------------------------------------------------------
// Meta-comando de psql num arquivo que uma PESSOA cola no SQL Editor
// -----------------------------------------------------------------------------
// O SQL Editor do Supabase manda o texto inteiro como um lote unico de SQL: ele
// fala Postgres, nao psql. Uma linha comecando com barra invertida vira
//
//   ERROR:  42601: syntax error at or near "\"
//
// e -- porque o lote e um so -- o arquivo INTEIRO e recusado. Nada e aplicado,
// nem o que vinha antes da linha. Quem colou ve um erro de sintaxe, fecha, e o
// banco continua exatamente como estava.
//
// O CI nunca ve isso: ele roda `psql -f`, onde a linha e valida. Foi assim que
// o defeito chegou em producao duas vezes -- a 015 (HMO-149) e a 016, que tinha
// a mesma linha e ainda nao tinha sido aplicada.
//
// Cobre database/maintenance/ tambem: aqueles scripts existem justamente para
// serem colados no mesmo lugar.
//
// A checagem e textual: "primeiro caractere nao-branco da linha e barra
// invertida". Ela nao sabe distinguir uma barra invertida dentro de corpo
// dollar-quoted (onde seria inofensiva); se algum dia reprovar por isso, a saida
// e reescrever a linha para nao comecar com a barra -- nunca afrouxar a
// verificacao, porque o custo do falso negativo e uma migration que parece
// aplicada e nao esta.
const COLADOS = [
  ...readdirSync(DIR_MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => [`database/migrations/${f}`, join(DIR_MIGRATIONS, f)]),
  ...readdirSync(DIR_MAINTENANCE)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => [`database/maintenance/${f}`, join(DIR_MAINTENANCE, f)]),
];

const metaComandos = [];
for (const [rotulo, caminho] of COLADOS) {
  const linhas = readFileSync(caminho, "utf8").split("\n");
  linhas.forEach((linha, i) => {
    if (/^\s*\\/.test(linha)) {
      metaComandos.push({ rotulo, linha: i + 1, texto: linha.trim() });
    }
  });
}

if (ausentes.length === 0 && fantasmas.length === 0 && metaComandos.length === 0) {
  console.log(
    `Nenhuma migration fora do CI: as ${migrations.length} da cadeia aparecem no db-verify.yml.`,
  );
  console.log(
    `Nenhum meta-comando de psql nos ${COLADOS.length} arquivos que sao colados no SQL Editor.`,
  );
  process.exit(0);
}

if (ausentes.length > 0) {
  console.error(
    "Migration que o db-verify nao roda -- o CI validaria uma cadeia diferente da de producao:\n",
  );
  for (const f of ausentes) {
    console.error(`  database/migrations/${f}`);
  }
  console.error(
    `\nAdicione em .github/workflows/db-verify.yml, na ordem, um step\n` +
      `  - name: ${ausentes[0].replace(/\.sql$/, "")}\n` +
      `    run: $PSQL -f database/migrations/${ausentes[0]}\n` +
      `e, se o arquivo for re-executavel, o step de idempotencia logo depois.`,
  );
}

if (fantasmas.length > 0) {
  console.error(
    "\nO db-verify aponta para migration que nao existe mais:\n",
  );
  for (const f of fantasmas) console.error(`  database/migrations/${f}`);
}

if (metaComandos.length > 0) {
  console.error(
    "\nMeta-comando de psql em arquivo que uma PESSOA cola no SQL Editor do\n" +
      "Supabase. La isso vira `syntax error at or near \"\\\"` e o arquivo\n" +
      "INTEIRO e recusado -- nada e aplicado, e parece que rodou:\n",
  );
  for (const m of metaComandos) {
    console.error(`  ${m.rotulo}:${m.linha}  ${m.texto}`);
  }
  console.error(
    "\nApague a linha. O ON_ERROR_STOP do CI vem da linha de comando\n" +
      "(`psql -v ON_ERROR_STOP=1` no db-verify.yml), e o BEGIN/COMMIT do proprio\n" +
      "arquivo e que garante que nao se aplica pela metade.",
  );
}

process.exit(1);
