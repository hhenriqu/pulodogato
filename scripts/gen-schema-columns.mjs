#!/usr/bin/env node
// Gera database/schema-columns.json -- relacao -> colunas -- lendo um Postgres
// que ACABOU de receber a cadeia de migrations.
//
//   node scripts/gen-schema-columns.mjs            # escreve o arquivo
//   node scripts/gen-schema-columns.mjs --check    # falha se sair diferente
//
// Por que existe um arquivo gerado no meio do caminho, em vez do guard falar
// direto com o banco: `scripts/check-column-drift.mjs` roda no job
// `code-schema-drift`, que de proposito NAO tem Postgres e NAO tem filtro de
// path (ver o cabecalho daquele workflow). A deriva que ele pega nasce do lado
// do codigo -- um `.select()` com coluna inventada nao toca em `database/`, e
// passaria por baixo do filtro do db-verify. Para valer em todo PR, a
// verificacao precisa ser estatica.
//
// O RISCO desse desenho e a copia envelhecer. Por isso o `--check` roda no
// db-verify DEPOIS da cadeia inteira: ali ele compara com a FONTE -- um banco
// de verdade construido a partir das migrations -- e nao com outra copia. Uma
// coluna nova numa migration sem regenerar este arquivo deixa o db-verify
// vermelho. (Foi exatamente esse o defeito do bundle de validacao na HMO-154:
// os dois lados do diff saiam do mesmo script, e o teste so provava que o
// script era deterministico.)
//
// Views entram junto com as tabelas, e isso importa: metade do que o app le sao
// views do 006/008 (`monthly_cash_flow`, `category_monthly_totals`,
// `goal_progress`). Extrair coluna de view por regex sobre o `CREATE VIEW ... AS
// SELECT` nao e confiavel; pedir ao Postgres e exato.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DESTINO = fileURLToPath(new URL("../database/schema-columns.json", import.meta.url));

const CONSULTA = `
select c.relname, a.attname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
 where n.nspname = 'public'
   and c.relkind in ('r', 'v', 'm', 'p')
   and a.attnum > 0
   and not a.attisdropped
 order by c.relname, a.attname
`;

function lerDoBanco() {
  // Sem --no-psqlrc o .psqlrc de quem roda pode ligar formatacao e quebrar o
  // parse. Sem ON_ERROR_STOP um erro sai com codigo 0 e a saida vazia viraria
  // um schema vazio -- que e o pior resultado possivel aqui.
  const saida = execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-At", "-F", "\t", "-c", CONSULTA],
    { encoding: "utf8" }
  );

  const schema = {};
  for (const linha of saida.split("\n")) {
    if (!linha.trim()) continue;
    const [relacao, coluna] = linha.split("\t");
    (schema[relacao] ??= []).push(coluna);
  }
  return schema;
}

function serializar(schema) {
  const ordenado = {};
  for (const relacao of Object.keys(schema).sort()) {
    ordenado[relacao] = [...schema[relacao]].sort();
  }
  return JSON.stringify(ordenado, null, 2) + "\n";
}

const schema = lerDoBanco();
const relacoes = Object.keys(schema).length;

if (relacoes === 0) {
  console.error("Nenhuma relacao em public. O banco apontado por PG* esta vazio?");
  console.error("Escrever um schema vazio deixaria o check-column-drift verde sobre nada.");
  process.exit(1);
}

const conteudo = serializar(schema);

if (process.argv.includes("--check")) {
  let commitado;
  try {
    commitado = readFileSync(DESTINO, "utf8");
  } catch {
    console.error("database/schema-columns.json nao existe.");
    console.error("Rode: node scripts/gen-schema-columns.mjs");
    process.exit(1);
  }
  if (commitado !== conteudo) {
    console.error("database/schema-columns.json esta fora de sincronia com as migrations.");
    console.error("Rode `node scripts/gen-schema-columns.mjs` e comite o resultado.");
    process.exit(1);
  }
  console.log(`schema-columns.json em dia: ${relacoes} relacoes.`);
} else {
  writeFileSync(DESTINO, conteudo);
  const colunas = Object.values(schema).reduce((n, c) => n + c.length, 0);
  console.log(`database/schema-columns.json: ${relacoes} relacoes, ${colunas} colunas.`);
}
