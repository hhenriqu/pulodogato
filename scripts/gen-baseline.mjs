#!/usr/bin/env node
// =====================================================
// PULODOGATO - GERADOR DO 001_baseline.sql
// =====================================================
// Reescreve database/migrations/001_baseline.sql a partir de um `pg_dump
// --schema-only` do banco de producao. Substitui a reconstrucao manual pela
// API PostgREST que existia ate 2026-09-21 e que, por nao enxergar o catalogo,
// tinha deixado de fora 2 tabelas, 35 colunas, 23 funcoes, 13 triggers,
// 1 view, 57 indices e 2 valores de ENUM.
//
//   SUPABASE_DB_URL_RO=... node scripts/gen-baseline.mjs
//
// Ou, sem tocar em producao, a partir de um dump ja salvo:
//   node scripts/gen-baseline.mjs --from-dump caminho/do/dump.sql
//
// A credencial vem SEMPRE do ambiente (segredo `supabase_db_url_ro` com
// binding `env` no Paperclip). Nunca passe a URI por argumento: ela iria
// parar no historico do shell e na lista de processos.
//
// COMO A DIVISAO ENTRE 001 E 002 E MANTIDA
// ----------------------------------------
// O dump de producao ja contem o resultado do 002_rls_lockdown.sql, porque o
// 002 foi aplicado la. Copiar o dump inteiro para o 001 duplicaria essa camada
// e faria o 002 virar letra morta. Entao o gerador remove do dump exatamente
// o que o 002 cria, e nada alem disso:
//
//   * os 40 CREATE POLICY            -> SECAO 4 do 002
//   * os 18 ENABLE ROW LEVEL SECURITY -> SECAO 3 do 002
//   * as 5 funcoes auxiliares de RLS  -> SECAO 1 do 002
//
// O resultado e que `001 -> 002 -> 003` num banco vazio reproduz producao.
// Se um dia o 002 passar a criar outra funcao auxiliar, ela precisa entrar na
// lista RLS_HELPERS abaixo, senao o 001 vai cria-la primeiro e o 002 vai
// encontrar uma funcao preexistente.
// =====================================================

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, 'database/migrations/001_baseline.sql');
const SEED = join(REPO, 'database/seed/reference_data.sql');

// As funcoes auxiliares que o 002_rls_lockdown.sql cria (SECAO 1). Mantida em
// sincronia com aquele arquivo -- ver checagem em assertSyncWith002().
const RLS_HELPERS = new Set([
  'has_pending_invitation',
  'is_group_admin',
  'is_group_member',
  'join_group_by_code',
  'owns_group_member',
]);

function dumpFromProduction() {
  const raw = process.env.SUPABASE_DB_URL_RO;
  if (!raw) {
    console.error('ERRO: SUPABASE_DB_URL_RO nao esta no ambiente.');
    console.error('      O segredo existe no cofre mas com binding? Ver HMO-123, passo B3.');
    console.error('      Sem credencial, use: --from-dump <arquivo>');
    process.exit(1);
  }
  // O cofre ja devolveu a URI com quebra de linha no fim uma vez (2026-09-21).
  // O psql nao trima, e o `\n` vira `invalid sslmode value: "require\n"` -- um
  // erro que parece de sintaxe da URI. Uma URI valida nao tem espaco em branco.
  const uri = raw.replace(/\s/g, '');
  return execFileSync(
    'pg_dump',
    [
      uri,
      '--schema-only',
      '--schema=public',
      '--no-owner',
      '--no-privileges',
      '--no-acl',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

// -----------------------------------------------------
// Fatiamento do dump em blocos
// -----------------------------------------------------
// O pg_dump separa cada objeto com um cabecalho de tres linhas:
//
//   --
//   -- Name: <nome>; Type: <TIPO>; Schema: public; Owner: -
//   --
//
// Filtrar por esse cabecalho e muito mais seguro do que casar regex contra os
// statements: o corpo de uma funcao pode conter a palavra CREATE POLICY num
// comentario, e uma policy multilinha nao casa com um regex de uma linha so.
function splitBlocks(dump) {
  const lines = dump.split('\n');
  const blocks = [];
  let current = { header: null, lines: [] };

  for (let i = 0; i < lines.length; i++) {
    const isHeader =
      lines[i] === '--' &&
      /^-- Name: .*; Type: .*; Schema: /.test(lines[i + 1] ?? '') &&
      lines[i + 2] === '--';

    if (isHeader) {
      blocks.push(current);
      const m = lines[i + 1].match(/^-- Name: (.*); Type: ([A-Z ]+); Schema: ([^;]*);/);
      current = {
        header: { name: m[1], type: m[2], schema: m[3] },
        lines: [lines[i], lines[i + 1], lines[i + 2]],
      };
      i += 2;
      continue;
    }
    current.lines.push(lines[i]);
  }
  blocks.push(current);
  return blocks;
}

function keepBlock(b) {
  if (!b.header) return false; // preambulo do pg_dump: montamos o nosso
  const { name, type } = b.header;

  // Criados pelo 002_rls_lockdown.sql.
  if (type === 'POLICY') return false;
  if (type === 'ROW SECURITY') return false;
  if (type === 'FUNCTION') {
    const fn = name.replace(/^public\./, '').replace(/\(.*$/, '');
    if (RLS_HELPERS.has(fn)) return false;
  }

  // O schema public ja existe em qualquer projeto Supabase; recria-lo aborta.
  if (type === 'SCHEMA') return false;
  if (type === 'COMMENT' && /^SCHEMA /.test(name)) return false;

  return true;
}

// Confere que a lista RLS_HELPERS nao saiu de sincronia com o 002.
function assertSyncWith002() {
  const sql = readFileSync(join(REPO, 'database/migrations/002_rls_lockdown.sql'), 'utf8');
  const declared = new Set(
    [...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_]+)/gi)].map(
      (m) => m[1],
    ),
  );
  const missing = [...declared].filter((f) => !RLS_HELPERS.has(f));
  if (missing.length) {
    console.error(
      `ERRO: o 002 cria funcao(oes) que nao estao em RLS_HELPERS: ${missing.join(', ')}.\n` +
        '      Sem isso o 001 criaria a funcao antes, e o 002 acharia um objeto preexistente.',
    );
    process.exit(1);
  }
}

// -----------------------------------------------------
// Montagem
// -----------------------------------------------------
function build(dump, seed, stats) {
  const hoje = new Date().toISOString().slice(0, 10);
  return `-- =====================================================
-- PULODOGATO - BASELINE SCHEMA (public)
-- =====================================================
-- Migration: 001_baseline
-- Gerado em: ${hoje}
-- Projeto de origem: Supabase odxqjvtxsioksguuevqm
--
-- NAO EDITE ESTE ARQUIVO A MAO.
-- Ele e gerado por \`node scripts/gen-baseline.mjs\` a partir de um
-- \`pg_dump --schema-only\` do banco de producao. Edicao manual se perde na
-- proxima geracao -- e, pior, volta a abrir a distancia entre o arquivo e o
-- banco que a HMO-117 existiu para fechar.
--
-- PROVENIENCIA
-- ------------
-- Extraido com pg_dump de producao, pela role de leitura \`paperclip_ro\`
-- via Session Pooler (HMO-123). Ate 2026-09-21 este arquivo era uma
-- reconstrucao pela API PostgREST, que nao enxerga o catalogo do Postgres:
-- faltavam 2 tabelas, 35 colunas, 23 funcoes, 13 triggers, 1 view, 57 indices
-- e 2 valores do ENUM account_type (\`debit_card\` e \`other\`).
--
-- CONTEUDO (${stats.total} objetos)
--   ${String(stats.TYPE ?? 0).padStart(3)} tipos ENUM
--   ${String(stats.TABLE ?? 0).padStart(3)} tabelas
--   ${String(stats.VIEW ?? 0).padStart(3)} view
--   ${String(stats.FUNCTION ?? 0).padStart(3)} funcoes
--   ${String(stats.TRIGGER ?? 0).padStart(3)} triggers
--   ${String(stats.INDEX ?? 0).padStart(3)} indices
--   ${String(stats.CONSTRAINT ?? 0).padStart(3)} constraints
--   ${String(stats['FK CONSTRAINT'] ?? 0).padStart(3)} foreign keys
--   + o seed de referencia (database/seed/reference_data.sql)
--
-- O QUE NAO ESTA AQUI, DE PROPOSITO
-- ---------------------------------
-- RLS, policies e as 5 funcoes auxiliares de RLS ficam em
-- 002_rls_lockdown.sql; a correcao de privilegio dos triggers, em
-- 003_fix_trigger_privileges.sql. Aplicar so o 001 deixa o banco SEM RLS.
-- A ordem obrigatoria e 001 -> 002 -> 003. Ver database/README.md.
--
-- NUM POSTGRES CRU (CI, docker local)
-- -----------------------------------
-- Rode antes database/tests/00_supabase_shim.sql, que cria o schema \`auth\`,
-- \`auth.uid()\` e as roles anon/authenticated de que este arquivo depende.
-- Num projeto Supabase de verdade o shim NAO deve ser rodado.
-- =====================================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- O pg_dump qualifica tudo com \`public.\`, entao zerar o search_path elimina
-- qualquer ambiguidade com objeto de mesmo nome em outro schema.
SELECT pg_catalog.set_config('search_path', '', false);

BEGIN;

-- =====================================================
-- EXTENSOES
-- =====================================================
-- O Supabase instala as extensoes no schema \`extensions\`, e duas colunas
-- (group_invitations.id e schema_migrations.id) tem
-- \`DEFAULT extensions.uuid_generate_v4()\` gravado no catalogo. Num Postgres
-- cru esse schema nao existe e o CREATE TABLE falha com 3F000.
-- O \`WITH SCHEMA\` nas duas nao e enfeite: com search_path vazio (acima), um
-- CREATE EXTENSION sem destino explicito para em "no schema has been selected
-- to create in". E e tambem onde o Supabase as instala.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

${dump.trim()}

-- =====================================================
-- SEED - DADOS DE REFERENCIA
-- =====================================================
${seed.trim()}

COMMIT;

-- =====================================================
-- PROXIMO PASSO OBRIGATORIO: rodar 002_rls_lockdown.sql
-- Sem ele o schema fica sem RLS e qualquer portador da chave anon le e
-- escreve tudo. Depois, 003_fix_trigger_privileges.sql.
-- =====================================================
`;
}

// -----------------------------------------------------
function main() {
  const argv = process.argv.slice(2);
  const fromIdx = argv.indexOf('--from-dump');
  const raw =
    fromIdx !== -1 ? readFileSync(argv[fromIdx + 1], 'utf8') : dumpFromProduction();

  assertSyncWith002();

  const blocks = splitBlocks(raw);
  const kept = blocks.filter(keepBlock);

  const stats = { total: kept.length };
  for (const b of kept) stats[b.header.type] = (stats[b.header.type] ?? 0) + 1;

  // Apenas trim nas pontas de cada bloco. Nada de normalizar espaco em branco
  // no miolo: o corpo de uma funcao entra no catalogo literalmente, e colapsar
  // linhas em branco ali faria o arquivo divergir do `prosrc` de producao --
  // justamente o que o diff de round-trip existe para detectar.
  const body = kept.map((b) => b.lines.join('\n').trim()).join('\n\n');

  // `\restrict` / `\unrestrict` sao meta-comandos do psql 17 que so servem ao
  // proprio pg_dump; em cliente mais antigo ou em qualquer runner que nao seja
  // psql eles viram erro de sintaxe.
  const clean = body
    .split('\n')
    .filter((l) => !/^\\(un)?restrict\b/.test(l))
    .join('\n');

  writeFileSync(OUT, build(clean, readFileSync(SEED, 'utf8'), stats));

  const resumo = Object.entries(stats)
    .filter(([k]) => k !== 'total')
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.log(`001_baseline.sql gerado: ${stats.total} objetos (${resumo})`);
  console.log(`removidos do dump: ${blocks.length - kept.length - 1} blocos do 002 + preambulo`);
}

main();
