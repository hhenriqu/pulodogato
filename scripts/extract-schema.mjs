#!/usr/bin/env node
// Extrai o que da pra saber do schema de producao usando so a API PostgREST,
// e audita a RLS a partir da posicao de um visitante anonimo.
//
//   node scripts/extract-schema.mjs           # extrai colunas, enums e FKs
//   node scripts/extract-schema.mjs --audit   # so a auditoria de RLS
//
// Le NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY do ambiente.
// Usa a chave ANON de proposito: a pergunta que a auditoria responde e
// "o que um visitante sem login consegue ver e escrever?".
//
// Isto NAO substitui `pg_dump`. Nao captura tipos exatos, defaults, NOT NULL,
// indices, triggers nem as policies em si. Ver database/README.md.

import { readFileSync } from "node:fs";

for (const f of [".env.local", ".env.production"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !KEY) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const TABLES = [
  "profiles", "financial_services", "transaction_categories",
  "financial_accounts", "financial_transactions", "transaction_installments",
  "expense_groups", "group_members", "group_transactions",
  "group_expense_splits", "group_member_proportions", "group_invitations",
  "expense_splits", "user_balances", "user_subscriptions", "user_usage_limits",
];

// Tabelas de referencia: leitura anonima e intencional, nao e vazamento.
const PUBLIC_BY_DESIGN = new Set(["financial_services", "transaction_categories"]);

async function anonRowCount(table) {
  const res = await fetch(`${URL_}/rest/v1/${table}?select=*`, {
    headers: { ...H, Prefer: "count=exact", Range: "0-0" },
  });
  if (res.status === 404) return { missing: true };
  const cr = res.headers.get("content-range") || "";
  const total = cr.split("/")[1];
  return { count: total === "*" ? 0 : Number(total) };
}

async function audit() {
  console.log("Auditoria de RLS - requisicoes ANONIMAS (sem login)\n");
  let leaks = 0;
  for (const t of TABLES) {
    const r = await anonRowCount(t);
    if (r.missing) {
      console.log(`  ${t.padEnd(26)} tabela nao existe`);
      continue;
    }
    const expected = PUBLIC_BY_DESIGN.has(t);
    const bad = r.count > 0 && !expected;
    if (bad) leaks++;
    const tag = bad ? "VAZAMENTO" : expected ? "ok (publica de proposito)" : "ok";
    console.log(`  ${t.padEnd(26)} ${String(r.count).padStart(5)} linhas  ${tag}`);
  }
  console.log(
    leaks === 0
      ? "\nOK: nenhuma tabela de dados legivel sem autenticacao."
      : `\nFALHA: ${leaks} tabela(s) legiveis sem autenticacao.`
  );
  console.log(
    "\nRessalva: uma tabela vazia aparece como 'ok' mesmo sem RLS - 0 linhas\n" +
    "pode significar protegida OU so vazia. Este teste prova vazamento,\n" +
    "nao prova protecao. A prova de protecao e a query de pg_class no fim\n" +
    "de database/migrations/002_rls_lockdown.sql."
  );
  return leaks === 0 ? 0 : 1;
}

async function columnsFromRows(table) {
  const res = await fetch(`${URL_}/rest/v1/${table}?select=*&limit=1`, { headers: H });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length ? Object.keys(rows[0]) : null;
}

async function foreignKeys(table) {
  const hits = [];
  for (const other of TABLES) {
    if (other === table) continue;
    const res = await fetch(`${URL_}/rest/v1/${table}?select=${other}(*)&limit=0`, { headers: H });
    if (res.ok) hits.push(other);
    else {
      const j = await res.json().catch(() => ({}));
      if (/more than one relationship/i.test(j.message || "")) hits.push(`${other}(multi)`);
    }
  }
  return hits;
}

async function enumType(table, column) {
  const res = await fetch(`${URL_}/rest/v1/${table}?${column}=eq.__zzz__&limit=0`, { headers: H });
  if (res.ok) return null;
  const j = await res.json().catch(() => ({}));
  const m = (j.message || "").match(/invalid input value for enum ([a-z_0-9]+)/i);
  return m ? m[1] : null;
}

async function extract() {
  console.log("# Schema extraido de producao via PostgREST\n");
  for (const t of TABLES) {
    const cols = await columnsFromRows(t);
    console.log(`## ${t}`);
    console.log(cols ? `colunas: ${cols.join(", ")}` : "colunas: (sem linhas visiveis - use o probe de candidatos)");
    const fks = await foreignKeys(t);
    console.log(`relacoes: ${fks.join(", ") || "-"}`);
    for (const c of cols || []) {
      if (!/_type$|^status$|^plan$|^role$/.test(c)) continue;
      const e = await enumType(t, c);
      if (e) console.log(`enum: ${c} -> ${e}`);
    }
    console.log("");
  }
  console.log("\n--- auditoria de RLS ---\n");
  return audit();
}

process.exit(await (process.argv.includes("--audit") ? audit() : extract()));
