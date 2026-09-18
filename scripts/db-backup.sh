#!/usr/bin/env bash
# =====================================================
# Backup do banco de producao (schema + dados)
# =====================================================
# Roda igual na mao e no CI (.github/workflows/db-backup.yml).
#
#   export SUPABASE_DB_URL='postgresql://postgres.<ref>:<senha>@aws-0-<regiao>.pooler.supabase.com:5432/postgres'
#   export BACKUP_PASSPHRASE='...'          # opcional na mao, obrigatorio no CI
#   ./scripts/db-backup.sh ./backups
#
# Gera em $DESTINO:
#   <data>-schema.sql        estrutura (sem dados) - serve para conferir drift
#   <data>-data.sql.gz[.gpg] dados
#   <data>-roles-rls.txt     inventario de RLS, policies e privilegios da anon
#
# IMPORTANTE sobre a connection string: use o **Session Pooler** (porta 5432).
# O Transaction Pooler (6543) nao aguenta pg_dump, e a conexao direta
# (db.<ref>.supabase.co) e IPv6 -- runner do GitHub nao tem IPv6.
# Supabase -> Settings -> Database -> Connection string -> Session pooler.
#
# O dump de dados contem PII e dados financeiros reais. Nao versionar.
# =====================================================
set -euo pipefail

DEST="${1:-./backups}"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  cat >&2 <<'EOF'
ERRO: SUPABASE_DB_URL nao esta definida.

Sem ela nao ha backup nenhum -- a unica copia do banco continua sendo a
producao. Pegue a string em Supabase -> Settings -> Database ->
Connection string -> Session pooler (porta 5432).
EOF
  exit 2
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERRO: pg_dump nao encontrado no PATH." >&2
  exit 2
fi

# Checado antes de qualquer dump: falhar depois deixaria o arquivo com os dados
# reais em claro no disco.
if [ -n "${BACKUP_PASSPHRASE:-}" ] && ! command -v gpg >/dev/null 2>&1; then
  echo "ERRO: BACKUP_PASSPHRASE definida mas gpg nao esta instalado." >&2
  exit 2
fi

mkdir -p "$DEST"

echo "==> pg_dump $(pg_dump --version)"

# --- estrutura -------------------------------------------------------------
# Sem --no-owner/--no-privileges de proposito: e justamente o GRANT/REVOKE que
# precisamos enxergar para auditar a exposicao da role anon.
echo "==> schema"
pg_dump "$SUPABASE_DB_URL" \
  --schema=public --schema-only --no-tablespaces \
  > "$DEST/$STAMP-schema.sql"

# --- dados -----------------------------------------------------------------
echo "==> dados"
pg_dump "$SUPABASE_DB_URL" \
  --schema=public --data-only --no-tablespaces --column-inserts \
  | gzip -9 > "$DEST/$STAMP-data.sql.gz"

# --- contas -----------------------------------------------------------------
# Todo user_id de public aponta para auth.users, que NAO esta no dump acima
# (--schema=public). Sem este arquivo, restaurar so o public deixa cada linha
# orfa: dados existem, ninguem consegue logar neles.
# O GoTrue guarda a senha em auth.users.encrypted_password, entao este arquivo e
# tao sensivel quanto o dump de dados.
echo "==> contas (auth.users)"
if pg_dump "$SUPABASE_DB_URL" \
     --table=auth.users --data-only --no-tablespaces --column-inserts \
     2>"$DEST/.auth-users.err" \
     | gzip -9 > "$DEST/$STAMP-auth-users.sql.gz"; then
  rm -f "$DEST/.auth-users.err"
else
  echo "AVISO: nao foi possivel dumpar auth.users -- as contas NAO estao neste backup." >&2
  sed 's/^/    /' "$DEST/.auth-users.err" >&2 || true
  rm -f "$DEST/.auth-users.err" "$DEST/$STAMP-auth-users.sql.gz"
fi

# --- inventario de seguranca ----------------------------------------------
# Snapshot do estado real de RLS. E a unica forma de saber, depois, se a
# producao estava protegida naquela data.
echo "==> inventario de RLS"
psql "$SUPABASE_DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 -tA > "$DEST/$STAMP-roles-rls.txt" <<'SQL'
SELECT 'TABELA_SEM_RLS: ' || c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
 ORDER BY 1;
SELECT 'POLICY: ' || tablename || '.' || policyname || ' [' || cmd || ']'
  FROM pg_policies WHERE schemaname = 'public' ORDER BY 1;
SELECT 'GRANT_ANON: ' || table_name || ' ' || privilege_type
  FROM information_schema.role_table_grants
 WHERE grantee = 'anon' AND table_schema = 'public' ORDER BY 1;
SQL

# --- criptografia ----------------------------------------------------------
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  echo "==> criptografando os dumps com dados"
  for alvo in "$DEST/$STAMP-data.sql.gz" "$DEST/$STAMP-auth-users.sql.gz"; do
    [ -f "$alvo" ] || continue
    gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase-fd 0 --output "$alvo.gpg" "$alvo" <<< "$BACKUP_PASSPHRASE"
    rm -f "$alvo"
  done
else
  echo "AVISO: BACKUP_PASSPHRASE vazia -- os dumps com dados ficaram em claro." >&2
fi

echo
echo "Backup em $DEST:"
ls -lh "$DEST" | grep "$STAMP"
echo
echo "Lembrete: backup que nunca foi restaurado nao e backup."
echo "Restaurar num banco limpo: gunzip -c <data>.sql.gz | psql \"\$DB_URL_TESTE\""
