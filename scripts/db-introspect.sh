#!/usr/bin/env bash
# =====================================================
# PULODOGATO - INTROSPECCAO DO POSTGRES DE PRODUCAO
# =====================================================
# Roda a lista da Parte C do HMO-123 de uma vez so, assim que a credencial
# de leitura estiver disponivel no ambiente.
#
#   SUPABASE_DB_URL_RO=... ./scripts/db-introspect.sh [DIR_DE_SAIDA]
#
# A credencial vem SEMPRE do ambiente (segredo `supabase_db_url_ro` com
# binding `env` no Paperclip). Nunca passe a URI por argumento -- ela iria
# parar no historico do shell e na lista de processos.
#
# Host correto do pooler (confirmado em 2026-09-21 a partir deste runtime):
#   aws-1-sa-east-1.pooler.supabase.com:5432
# O host direto `db.<ref>.supabase.co` e IPv6-only e NAO tem rota daqui.

set -euo pipefail

if [[ -z "${SUPABASE_DB_URL_RO:-}" ]]; then
  echo "ERRO: SUPABASE_DB_URL_RO nao esta no ambiente." >&2
  echo "      O segredo existe no cofre mas com binding? Ver HMO-123, passo B3." >&2
  exit 1
fi

OUT="${1:-${PAPERCLIP_SCRATCH_DIR:-.}/db-introspect}"
mkdir -p "$OUT"
export PGCONNECT_TIMEOUT=15

# `-v ON_ERROR_STOP=1` para que uma falha de permissao vire exit code, nao um
# arquivo de saida vazio que passa despercebido no diff.
psql_ro() { psql "$SUPABASE_DB_URL_RO" -v ON_ERROR_STOP=1 "$@"; }

echo "==> 1/6 smoke test"
psql_ro -Atc 'select current_user, current_database(), version()'

echo "==> 2/6 tabelas sem RLS (verificacao do 002; deve vir vazio)"
psql_ro -Atc "
  SELECT relname FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  ORDER BY relname;" | tee "$OUT/rls-missing.txt"
if [[ -s "$OUT/rls-missing.txt" ]]; then
  echo "    ATENCAO: $(wc -l < "$OUT/rls-missing.txt") tabela(s) sem RLS." >&2
else
  echo "    ok: nenhuma tabela sem RLS"
fi

echo "==> 3/6 policies reais de public"
psql_ro -c "
  SELECT tablename, policyname, cmd, roles, qual, with_check
  FROM pg_policies WHERE schemaname = 'public'
  ORDER BY tablename, policyname;" > "$OUT/pg_policies.txt"

# Versao normalizada, uma policy por linha, para diff estavel entre execucoes.
psql_ro -Atc "
  SELECT tablename || '|' || policyname || '|' || cmd || '|' ||
         array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' ||
         coalesce(with_check, '')
  FROM pg_policies WHERE schemaname = 'public'
  ORDER BY tablename, policyname;" > "$OUT/pg_policies.tsv"
echo "    $(wc -l < "$OUT/pg_policies.tsv") policies"

echo "==> 4/6 grants de authenticated/anon"
psql_ro -c "
  SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
  GROUP BY table_name, grantee
  ORDER BY table_name, grantee;" > "$OUT/grants.txt"

echo "==> 5/6 policies de storage/auth (escopo mais_auth do HMO-123)"
# pg_policies vem do pg_catalog e e legivel por qualquer papel -- esta secao
# funciona mesmo sem nenhum grant em storage/auth. E por isso que auditar as
# policies de storage NAO exigia ampliar o escopo.
psql_ro -c "
  SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
  FROM pg_policies WHERE schemaname IN ('storage', 'auth')
  ORDER BY schemaname, tablename, policyname;" > "$OUT/pg_policies-storage-auth.txt"
psql_ro -Atc "
  SELECT count(*) FROM pg_policies WHERE schemaname IN ('storage', 'auth');" \
  | xargs -I{} echo "    {} policies em storage/auth"

echo "==> 6/6 pg_dump --schema-only"
# --no-owner/--no-acl: o paperclip_ro nao e dono de nada, entao as linhas de
# ownership sairiam erradas e poluiriam o diff contra o 001_baseline.sql.
pg_dump "$SUPABASE_DB_URL_RO" \
  --schema-only --schema=public --no-owner --no-acl --no-comments \
  > "$OUT/schema-real.sql"
echo "    $(wc -l < "$OUT/schema-real.sql") linhas em $OUT/schema-real.sql"

# O dump do storage e separado e best-effort: e material de auditoria, nao
# entra no diff contra o 001_baseline.sql (que so descreve o public).
if pg_dump "$SUPABASE_DB_URL_RO" \
     --schema-only --schema=storage --no-owner --no-acl --no-comments \
     > "$OUT/schema-storage.sql" 2> "$OUT/schema-storage.err"; then
  echo "    $(wc -l < "$OUT/schema-storage.sql") linhas em $OUT/schema-storage.sql"
else
  echo "    storage: pg_dump recusado (ver $OUT/schema-storage.err) -- esperado se o grant nao passou" >&2
fi

echo
echo "Saida em: $OUT"
echo "Proximo passo: diff contra database/migrations/001_baseline.sql (HMO-123 Parte C item 5)."
