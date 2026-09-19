#!/usr/bin/env bash
# =====================================================
# Restaura um backup gerado por scripts/db-backup.sh
# =====================================================
#   export RESTORE_DB_URL='postgresql://...'     # banco DE DESTINO (vazio)
#   export BACKUP_PASSPHRASE='...'               # se o backup estiver .gpg
#   ./scripts/db-restore.sh ./backups            # usa o backup mais recente
#   ./scripts/db-restore.sh ./backups 2026-09-18T155210Z
#
# APAGA o schema `public` do destino antes de restaurar. Por isso recusa rodar
# contra o projeto de producao, a nao ser com a variavel de escape explicita.
#
# Por que existe um script em vez de "so rodar o psql": o dump de public traz
# `CREATE SCHEMA public`, que colide em qualquer banco recem-criado; e os dados
# so fazem sentido depois de auth.users. A ordem importa.
# =====================================================
set -euo pipefail

DEST="${1:-./backups}"
STAMP="${2:-}"
PROD_REF='odxqjvtxsioksguuevqm'

if [ -z "${RESTORE_DB_URL:-}" ]; then
  echo "ERRO: defina RESTORE_DB_URL com o banco de DESTINO." >&2
  exit 2
fi

# Guarda-corpo: este script comeca com DROP SCHEMA public CASCADE.
if [[ "$RESTORE_DB_URL" == *"$PROD_REF"* ]] \
   && [ "${FORCE_PRODUCTION_RESTORE:-}" != 'sim-eu-sei-o-que-estou-fazendo' ]; then
  cat >&2 <<EOF
ERRO: RESTORE_DB_URL aponta para o projeto de producao ($PROD_REF).

Este script APAGA o schema public do destino. Se a intencao e mesmo restaurar
producao por cima de um desastre, repita com:

  FORCE_PRODUCTION_RESTORE=sim-eu-sei-o-que-estou-fazendo $0 $DEST $STAMP
EOF
  exit 2
fi

if [ -z "$STAMP" ]; then
  STAMP="$(basename "$(ls -1 "$DEST"/*-schema.sql | sort | tail -1)" -schema.sql)"
fi
echo "==> backup: $STAMP  (de $DEST)"

SCHEMA_SQL="$DEST/$STAMP-schema.sql"
[ -f "$SCHEMA_SQL" ] || { echo "ERRO: $SCHEMA_SQL nao existe." >&2; exit 2; }

PSQL=(psql "$RESTORE_DB_URL" --no-psqlrc -q -v ON_ERROR_STOP=1)
# Mesmo comando, descartando o resultado: os dumps do pg_dump comecam com um
# SELECT set_config() cuja tabela de saida so polui o log.
PSQL_MUDO=("${PSQL[@]}" -o /dev/null)

# Le um dump que pode estar .gz ou .gz.gpg.
abrir() {
  local base="$1"
  if [ -f "$base.gz.gpg" ]; then
    [ -n "${BACKUP_PASSPHRASE:-}" ] || { echo "ERRO: backup criptografado e BACKUP_PASSPHRASE vazia." >&2; exit 2; }
    gpg --batch --quiet --decrypt --passphrase-fd 3 "$base.gz.gpg" 3<<< "$BACKUP_PASSPHRASE" | gunzip -c
  elif [ -f "$base.gz" ]; then
    gunzip -c "$base.gz"
  else
    return 1
  fi
}

echo "==> limpando o schema public do destino"
"${PSQL[@]}" -c 'DROP SCHEMA IF EXISTS public CASCADE;'

# Num Postgres cru nao existe auth.uid() nem as roles do Supabase; num projeto
# Supabase existem, e o shim se recusa a rodar.
if ! "${PSQL[@]}" -tAc "SELECT to_regprocedure('auth.uid()') IS NOT NULL" | grep -q '^t$'; then
  echo "==> destino sem schema auth: aplicando o shim do Supabase"
  "${PSQL[@]}" -f "$(dirname "$0")/../database/tests/00_supabase_shim.sql"
fi

echo "==> estrutura"
"${PSQL_MUDO[@]}" -f "$SCHEMA_SQL"

# Antes dos dados: todo user_id de public referencia auth.users.
if abrir "$DEST/$STAMP-auth-users.sql" > /dev/null 2>&1; then
  echo "==> contas (auth.users)"
  abrir "$DEST/$STAMP-auth-users.sql" | "${PSQL_MUDO[@]}"
else
  echo "AVISO: backup sem auth.users -- as linhas de public vao ficar sem dono." >&2
fi

echo "==> dados"
abrir "$DEST/$STAMP-data.sql" | "${PSQL_MUDO[@]}"

echo
echo "==> conferencia"
"${PSQL[@]}" -tA <<'SQL'
SELECT 'contas em auth.users: ' || count(*) FROM auth.users;
SELECT 'profiles: '            || count(*) FROM public.profiles;
SELECT 'financial_accounts: '  || count(*) FROM public.financial_accounts;
SELECT 'financial_transactions: ' || count(*) FROM public.financial_transactions;
SELECT 'seed transaction_categories: ' || count(*) FROM public.transaction_categories;
SELECT 'tabelas de public SEM RLS: ' || count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
SQL

echo
echo "Restaurado. Se 'tabelas de public SEM RLS' for > 0, rode tambem"
echo "database/migrations/002_rls_lockdown.sql antes de expor este banco."
