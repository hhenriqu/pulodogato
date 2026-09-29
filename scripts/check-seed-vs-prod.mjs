#!/usr/bin/env node
// Confere os VALORES de database/seed/reference_data.sql contra producao.
//
//   node scripts/check-seed-vs-prod.mjs              # leitura anonima
//   node scripts/check-seed-vs-prod.mjs --login      # + linhas inativas (sessao)
//   node scripts/check-seed-vs-prod.mjs --seed X.sql # confere outro arquivo
//
// HMO-127. O gerador do baseline (`scripts/gen-baseline.mjs`) roda como
// `paperclip_ro`, que e role comum e portanto sujeita a RLS: as policies das
// duas tabelas de referencia sao `TO anon, authenticated`, entao para o
// `paperclip_ro` as duas voltam VAZIAS e o `pg_dump --data-only` recusa. Por
// isso o seed vive num arquivo a mao -- e por isso ninguem estava conferindo
// se os valores dele ainda batem com o que esta la.
//
// Este script fecha a lacuna pelo unico caminho que le essas tabelas sem DDL
// novo: a API PostgREST com a chave anon, a mesma origem de onde o seed foi
// extraido em 2026-09-18.
//
// LIMITE, de proposito explicito: a policy anonima e `USING (is_active = TRUE)`.
// Linha inativa nao aparece. Com `--login` uma segunda leitura entra com a
// conta de teste e pega tambem o que a policy `..._read_reservada` do 023
// libera para `authenticated` (a categoria de transferencia). Uma linha inativa
// que nao caia em nenhuma das duas policies continua invisivel aqui -- so a
// opcao 1 da HMO-127 (policy `TO paperclip_ro`) cobre esse resto.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const f of [".env.local", ".env.production"]) {
  try {
    for (const line of readFileSync(join(REPO, f), "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}

const args = process.argv.slice(2);
const COM_LOGIN = args.includes("--login");
const SEED = (() => {
  const i = args.indexOf("--seed");
  return i >= 0 ? args[i + 1] : join(REPO, "database/seed/reference_data.sql");
})();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !KEY) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Leitor do seed
// ---------------------------------------------------------------------------
// Le so o que este arquivo usa: INSERT ... VALUES (...), (...); com literais
// de texto, TRUE/FALSE e NULL. Qualquer coisa fora disso vira erro em vez de
// virar valor errado -- um parser que engole o que nao entende devolveria
// "bate" para um seed que ele nao leu.

function partirEmTermos(sql) {
  // Divide a lista de VALUES em tuplas respeitando aspas. Nao da para usar
  // split(',') aqui: ha virgula dentro de quase toda descricao.
  const tuplas = [];
  let atual = null;
  let aspas = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (aspas) {
      if (c === "'") {
        if (sql[i + 1] === "'") { atual.push("'"); i++; continue; }
        aspas = false;
      }
      atual.push(c);
      continue;
    }
    if (c === "'") { aspas = true; atual.push(c); continue; }
    if (c === "(") { atual = []; continue; }
    if (c === ")") {
      if (atual === null) throw new Error("')' sem '(' na lista de VALUES");
      tuplas.push(atual.join(""));
      atual = null;
      continue;
    }
    if (atual !== null) atual.push(c);
  }
  return tuplas;
}

function campos(tupla) {
  // Um campo ou e literal de texto (e ai o valor sai de dentro das aspas, com
  // virgula e acento incluidos) ou e uma palavra solta. O tipo e decidido na
  // varredura: marcar o texto com um sentinela e procura-lo de volta depois
  // confunde texto com palavra-chave assim que o dado contiver o sentinela.
  const out = [];
  let buf = [];
  let texto = false; // este campo comecou com aspas
  let aspas = false; // estou dentro das aspas agora
  const fechar = () => {
    if (texto) { out.push(buf.join("")); return; }
    const t = buf.join("").trim();
    if (/^TRUE$/i.test(t)) out.push(true);
    else if (/^FALSE$/i.test(t)) out.push(false);
    else if (/^NULL$/i.test(t)) out.push(null);
    else if (/^-?\d+(\.\d+)?$/.test(t)) out.push(Number(t));
    else throw new Error(`literal nao suportado no seed: ${JSON.stringify(t)}`);
  };
  for (let i = 0; i < tupla.length; i++) {
    const c = tupla[i];
    if (aspas) {
      if (c === "'") { aspas = false; continue; }
      buf.push(c);
      continue;
    }
    if (c === "'") {
      if (texto) { buf.push("'"); aspas = true; continue; } // '' escapado
      if (buf.join("").trim() !== "") {
        throw new Error(`aspas no meio de campo: ${JSON.stringify(buf.join(""))}`);
      }
      texto = true;
      buf = [];
      aspas = true;
      continue;
    }
    if (c === ",") { fechar(); buf = []; texto = false; continue; }
    buf.push(c);
  }
  fechar();
  return out;
}

function lerSeed(caminho) {
  const bruto = readFileSync(caminho, "utf8");
  // Tira comentarios de linha inteira; os literais do seed nao contem "--".
  const sql = bruto
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  const blocos = [];
  const re = /INSERT\s+INTO\s+public\.(\w+)\s*\(([^)]*)\)\s*VALUES\s*([\s\S]*?);/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const tabela = m[1];
    const colunas = m[2].split(",").map((c) => c.trim());
    const corpo = m[3].replace(/ON\s+CONFLICT[\s\S]*$/i, "");
    const linhas = partirEmTermos(corpo).map((t) => {
      const vals = campos(t);
      if (vals.length !== colunas.length) {
        throw new Error(
          `${tabela}: tupla com ${vals.length} valores para ${colunas.length} colunas`
        );
      }
      return Object.fromEntries(colunas.map((c, i) => [c, vals[i]]));
    });
    blocos.push({ tabela, colunas, linhas });
  }
  if (blocos.length === 0) throw new Error(`nenhum INSERT encontrado em ${caminho}`);
  return blocos;
}

// ---------------------------------------------------------------------------
// Producao
// ---------------------------------------------------------------------------

async function token() {
  const email = process.env.PULODOGATO_TEST_EMAIL
    || "teste-hmo161-1790379476@hmoraes.com.br";
  const senha = process.env.PULODOGATO_TEST_PASSWORD || "PuloGato!1790379476";
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: senha }),
  });
  if (!res.ok) {
    throw new Error(`login falhou: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()).access_token;
}

async function buscar(tabela, colunas, bearer) {
  const res = await fetch(
    `${URL_}/rest/v1/${tabela}?select=${colunas.join(",")}&order=id`,
    { headers: { apikey: KEY, Authorization: `Bearer ${bearer}` } }
  );
  const corpo = await res.text();
  // Um 2xx vazio e resposta legitima (tabela vazia); qualquer outra coisa nao
  // e veredito. Sem esta guarda, 401 por chave trocada viraria "prod perdeu
  // todas as linhas", que e um alarme falso caro.
  if (!res.ok) throw new Error(`GET ${tabela}: HTTP ${res.status} ${corpo.slice(0, 200)}`);
  return JSON.parse(corpo);
}

function iguais(a, b) {
  if (a === null || b === null) return a === b;
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  return String(a) === String(b);
}

// ---------------------------------------------------------------------------

const blocos = lerSeed(SEED);
let bearer = KEY;
if (COM_LOGIN) {
  bearer = await token();
  console.log("sessao: conta de teste em producao (le tambem linha reservada)\n");
} else {
  console.log("sessao: nenhuma (chave anon -- so linhas com is_active = TRUE)\n");
}

let divergencias = 0;
const extras = [];

for (const { tabela, colunas, linhas } of blocos) {
  const prod = await buscar(tabela, colunas, bearer);
  const porId = new Map(prod.map((r) => [String(r.id), r]));
  console.log(`${tabela}: seed ${linhas.length} linha(s), producao ${prod.length}`);

  for (const linha of linhas) {
    const real = porId.get(String(linha.id));
    if (!real) {
      divergencias++;
      console.log(`  FALTA  ${linha.id}  "${linha.name}" nao voltou de producao`);
      continue;
    }
    porId.delete(String(linha.id));
    for (const col of colunas) {
      if (!iguais(linha[col], real[col])) {
        divergencias++;
        console.log(
          `  DIFERE ${linha.id}  ${col}: seed ${JSON.stringify(linha[col])}` +
          ` != prod ${JSON.stringify(real[col])}`
        );
      }
    }
  }
  for (const [id, r] of porId) extras.push({ tabela, id, name: r.name });
}

// Linha em producao que nao esta no seed nao e erro por si: o seed retrata o
// 001_baseline, e migrations posteriores inserem linhas de referencia novas
// (o 023 insere a categoria de transferencia). Fica como aviso, para nao
// passar despercebida uma linha que ninguem sabe de onde veio.
if (extras.length) {
  console.log("\nEm producao e fora do seed (esperado para linha criada por migration):");
  for (const e of extras) console.log(`  ${e.tabela}  ${e.id}  "${e.name}"`);
}

console.log(
  divergencias === 0
    ? "\nOK: todos os valores do seed batem com producao."
    : `\nFALHA: ${divergencias} divergencia(s).`
);
process.exit(divergencias === 0 ? 0 : 1);
