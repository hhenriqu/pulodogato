#!/usr/bin/env node
// Quebra o build quando o codigo da aplicacao consulta uma tabela ou view que
// as migrations nao criam.
//
// Por que isto existe (HMO-124): quatro rotas em producao consultavam tabelas
// que nunca existiram no banco -- `transactions`, `dividends`, `user_groups` e
// `user_connections`. Nada disso aparece no `tsc`, no `next build` nem no
// lint: o cliente do Supabase aceita qualquer string em `.from()`, e o erro so
// nasce em runtime, como um PGRST205 dentro de um `catch` que devolve 500. O
// usuario ve uma tela vazia; o CI segue verde. E a mesma deriva codigo-x-banco
// que a HMO-117 encontrou no schema.
//
// A verificacao e estatica de proposito: nao precisa de banco, roda em
// milissegundos e por isso pode entrar em qualquer job sem custo.
//
// Duas passadas, porque ha duas formas de citar uma tabela pelo PostgREST:
//
//   1. `.from("nome")` -- a obvia.
//   2. o embed dentro de `.select()`, `nome ( colunas )`. Esta e a que
//      escapa da leitura humana: em `app/api/groups/route.ts` a rota partia de
//      `.from("group_members")`, que existe, e so entao embutia
//      `user_groups (...)`, que nao existe. A linha do `.from()` estava certa.
//
// Nao cobre: SQL cru dentro de `.rpc()` e nomes de tabela montados em tempo de
// execucao. Nenhum dos dois aparece no codigo hoje; se aparecerem, esta
// verificacao passa a ser um piso, nao uma garantia.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

const DIR_MIGRATIONS = join(RAIZ, "database/migrations");
const DIRS_CODIGO = ["app", "components", "lib", "utils", "worker"];
const EXTENSOES = [".ts", ".tsx"];

// Tabelas que o codigo cita de proposito e que as migrations nao criam.
//
// Cada entrada e uma divida aberta, nao uma excecao permanente -- por isso a
// verificacao abaixo tambem falha quando uma entrada fica obsoleta (a tabela
// passou a existir, ou o codigo parou de cita-la). Sem isso a lista so cresce
// e a verificacao vira decoracao.
const PENDENTES = new Map([
  [
    "user_connections",
    "HMO-124: falta decidir com o dono do produto se 'conexoes entre usuarios' " +
      "e feature pretendida (ai precisa de migration + RLS) ou se as rotas e a " +
      "pagina saem. Ate la, /dashboard/connections responde 500 em producao.",
  ],
]);

// Palavras que aparecem seguidas de `(` dentro de um `.select()` sem serem
// embed de tabela.
const NAO_SAO_EMBED = new Set(["count", "sum", "avg", "min", "max"]);

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

// Troca comentario por espaco em vez de remover: o numero da linha e a coluna
// continuam valendo, e e isso que faz a mensagem de erro ser clicavel.
function mascararComentarios(texto, comLinha) {
  let saida = "";
  let i = 0;
  while (i < texto.length) {
    const dois = texto.slice(i, i + 2);
    if (comLinha && dois === "--") {
      while (i < texto.length && texto[i] !== "\n") {
        saida += " ";
        i++;
      }
      continue;
    }
    if (!comLinha && dois === "//") {
      while (i < texto.length && texto[i] !== "\n") {
        saida += " ";
        i++;
      }
      continue;
    }
    if (dois === "/*") {
      while (i < texto.length && texto.slice(i, i + 2) !== "*/") {
        saida += texto[i] === "\n" ? "\n" : " ";
        i++;
      }
      saida += "  ";
      i += 2;
      continue;
    }
    saida += texto[i];
    i++;
  }
  return saida;
}

function arquivosDe(dir, acc = []) {
  let entradas;
  try {
    entradas = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entrada of entradas) {
    if (entrada === "node_modules" || entrada.startsWith(".")) continue;
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) arquivosDe(caminho, acc);
    else if (EXTENSOES.some((e) => entrada.endsWith(e))) acc.push(caminho);
  }
  return acc;
}

function linhaDe(texto, indice) {
  let linha = 1;
  for (let i = 0; i < indice; i++) if (texto[i] === "\n") linha++;
  return linha;
}

// ---------------------------------------------------------------------------
// O que o banco tem
// ---------------------------------------------------------------------------

function tabelasDasMigrations() {
  const tabelas = new Set();
  const arquivos = readdirSync(DIR_MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // O `public.` e opcional porque uma migration futura pode rodar com
  // search_path ja em public; o mascaramento de comentario acima e o que
  // impede um "-- ... o CREATE TABLE falha com 3F000" virar uma tabela
  // chamada `falha`.
  const ddl =
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;

  for (const arquivo of arquivos) {
    const sql = mascararComentarios(
      readFileSync(join(DIR_MIGRATIONS, arquivo), "utf8"),
      true
    );
    for (const m of sql.matchAll(ddl)) tabelas.add(m[1].toLowerCase());
  }
  return tabelas;
}

// ---------------------------------------------------------------------------
// O que o codigo pede
// ---------------------------------------------------------------------------

// Le o literal de string que comeca em `inicio`. Devolve o conteudo e o
// deslocamento dele, para a linha do achado sair certa.
function lerLiteral(texto, inicio) {
  const aspas = texto[inicio];
  if (aspas !== '"' && aspas !== "'" && aspas !== "`") return null;
  let i = inicio + 1;
  let conteudo = "";
  while (i < texto.length) {
    if (texto[i] === "\\") {
      conteudo += texto[i] + texto[i + 1];
      i += 2;
      continue;
    }
    if (texto[i] === aspas) return { conteudo, deslocamento: inicio + 1 };
    conteudo += texto[i];
    i++;
  }
  return null;
}

function referenciasDe(texto) {
  const achados = [];

  // Passada 1: .from("nome")
  for (const m of texto.matchAll(/\.from\(\s*(["'`])([a-zA-Z0-9_]+)\1/g)) {
    achados.push({
      tabela: m[2].toLowerCase(),
      indice: m.index,
      via: ".from()",
    });
  }

  // Passada 2: embeds dentro de .select("...")
  for (const m of texto.matchAll(/\.select\(\s*/g)) {
    const literal = lerLiteral(texto, m.index + m[0].length);
    if (!literal) continue;

    // `alias:tabela!dica(colunas)` -- o que importa e `tabela`. O `(?<![.\w])`
    // evita casar o `sum` de `amount.sum()` e o miolo de um identificador.
    const embed =
      /(?<![.\w])(?:[a-z_][a-z0-9_]*\s*:\s*)?([a-z_][a-z0-9_]*)\s*(?:!\s*[a-z_][a-z0-9_]*\s*)?\(/gi;

    for (const e of literal.conteudo.matchAll(embed)) {
      const nome = e[1].toLowerCase();
      if (NAO_SAO_EMBED.has(nome)) continue;
      achados.push({
        tabela: nome,
        indice: literal.deslocamento + e.index,
        via: "embed em .select()",
      });
    }
  }

  return achados;
}

// ---------------------------------------------------------------------------

function main() {
  const existentes = tabelasDasMigrations();
  if (existentes.size === 0) {
    console.error("Nenhum CREATE TABLE encontrado em database/migrations/.");
    console.error("A verificacao passaria vazia, o que e pior que nao existir.");
    process.exit(1);
  }

  // tabela -> [{ arquivo, linha, via }]
  const ausentes = new Map();
  const pendentesVistas = new Set();

  for (const dir of DIRS_CODIGO) {
    for (const arquivo of arquivosDe(join(RAIZ, dir))) {
      const bruto = readFileSync(arquivo, "utf8");
      const texto = mascararComentarios(bruto, false);

      for (const ref of referenciasDe(texto)) {
        if (existentes.has(ref.tabela)) continue;

        if (PENDENTES.has(ref.tabela)) {
          pendentesVistas.add(ref.tabela);
          continue;
        }

        if (!ausentes.has(ref.tabela)) ausentes.set(ref.tabela, []);
        ausentes.get(ref.tabela).push({
          arquivo: relative(RAIZ, arquivo),
          linha: linhaDe(texto, ref.indice),
          via: ref.via,
        });
      }
    }
  }

  const erros = [];

  for (const [tabela, usos] of [...ausentes].sort()) {
    erros.push(
      `Tabela "${tabela}" e consultada pelo codigo e nao existe em ` +
        `database/migrations/. Em producao isso e PGRST205 em runtime:\n` +
        usos
          .sort((a, b) => a.arquivo.localeCompare(b.arquivo) || a.linha - b.linha)
          .map((u) => `    ${u.arquivo}:${u.linha}  (${u.via})`)
          .join("\n")
    );
  }

  // Entrada de PENDENTES que virou obsoleta. Sem esta metade a lista de
  // excecoes so cresce e a verificacao deixa de significar qualquer coisa.
  for (const [tabela, motivo] of PENDENTES) {
    if (existentes.has(tabela)) {
      erros.push(
        `"${tabela}" esta em PENDENTES mas as migrations JA a criam. ` +
          `Remova a entrada de scripts/check-table-drift.mjs.\n    motivo registrado: ${motivo}`
      );
    } else if (!pendentesVistas.has(tabela)) {
      erros.push(
        `"${tabela}" esta em PENDENTES mas o codigo nao a cita mais. ` +
          `Remova a entrada de scripts/check-table-drift.mjs.\n    motivo registrado: ${motivo}`
      );
    }
  }

  if (erros.length > 0) {
    console.error("\nDeriva entre o codigo e o schema versionado:\n");
    for (const e of erros) console.error("  " + e + "\n");
    console.error(
      `${existentes.size} tabelas/views em database/migrations/. ` +
        `Se a tabela devia existir, falta a migration; se nao devia, a rota e ` +
        `codigo morto e sai.\n`
    );
    process.exit(1);
  }

  const pendentes = [...PENDENTES.keys()].sort();
  console.log(
    `Nenhuma deriva: todas as tabelas citadas pelo codigo existem nas ` +
      `migrations (${existentes.size} tabelas/views).`
  );
  if (pendentes.length > 0) {
    console.log(`Pendencias registradas: ${pendentes.join(", ")}.`);
  }
}

main();
