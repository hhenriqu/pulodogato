#!/usr/bin/env bash
# =====================================================
# Restaura um backup gerado por scripts/db-backup.sh
# =====================================================
#   export RESTORE_DB_URL='postgresql://...'     # banco DE DESTINO (vazio)
#   export BACKUP_PASSPHRASE='...'               # se o backup estiver .gpg
#   ./scripts/db-restore.sh ./backups            # usa o backup mais recente
#   ./scripts/db-restore.sh ./backups 2026-09-18T155210Z
#
# Se o destino ja tiver contas em auth.users, o script para antes de apagar
# nada e pede RESTORE_AUTH_MODE=merge (mantem as contas existentes) ou
# =so-public (nao toca em auth.users). Ver o bloco na SECAO das contas.
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

# ---------------------------------------------------------------------------
# Contas que ja existem no destino: conferir ANTES de destruir o public
# ---------------------------------------------------------------------------
# Descoberto em 2026-09-21, restaurando num Supabase de verdade. O dump de
# auth.users e `--column-inserts` puro: se o destino ja tiver uma conta com o
# mesmo id, o INSERT estoura `duplicate key ... users_pkey` e, com
# ON_ERROR_STOP, a restauracao morre ali. So que o `DROP SCHEMA public CASCADE`
# ja rodou -- o destino fica com a estrutura, sem dados e sem contas. A
# restauracao deixou o banco PIOR do que antes de comecar.
#
# O CI nunca pegaria isso: la o destino e um `CREATE DATABASE` novinho, com
# auth.users vazio. O caso real e o oposto -- restaurar por cima de um projeto
# que ainda tem os usuarios (rollback no lugar, ou um projeto onde alguem ja
# se cadastrou).
#
# Entao a checagem vem antes de qualquer comando destrutivo, e o default e
# recusar: quem restaura backup esta num dia ruim e nao deveria ter que
# adivinhar por que o banco ficou vazio.
CONTAS_NO_DESTINO="$("${PSQL[@]}" -tAc 'SELECT count(*) FROM auth.users' 2>/dev/null || echo 0)"
MODO_AUTH="${RESTORE_AUTH_MODE:-recusar}"

if [ "${CONTAS_NO_DESTINO:-0}" != '0' ] && [ "$MODO_AUTH" = 'recusar' ]; then
  cat >&2 <<EOF
ERRO: o destino ja tem $CONTAS_NO_DESTINO conta(s) em auth.users.

Carregar o dump de contas por cima estouraria em "duplicate key ... users_pkey"
DEPOIS de este script ja ter apagado o schema public -- o banco terminaria sem
dados e sem contas. Por isso paramos agora, antes de mexer em qualquer coisa.

Escolha:

  RESTORE_AUTH_MODE=merge $0 $DEST $STAMP
      Restaura o public normalmente e carrega as contas do backup com
      ON CONFLICT (id) DO NOTHING: as contas que ja existem no destino ficam
      como estao, as que so existem no backup entram.

  RESTORE_AUTH_MODE=so-public $0 $DEST $STAMP
      Nao toca em auth.users. Use quando as contas do destino ja sao as certas
      e o que se quer recuperar e so o conteudo de public.

Se o destino era para estar vazio, provavelmente e o projeto errado: confira a
RESTORE_DB_URL.
EOF
  exit 2
fi

case "$MODO_AUTH" in
  recusar|merge|so-public) ;;
  *) echo "ERRO: RESTORE_AUTH_MODE='$MODO_AUTH' -- use merge ou so-public." >&2; exit 2 ;;
esac

echo "==> limpando o schema public do destino"
"${PSQL[@]}" -c 'DROP SCHEMA IF EXISTS public CASCADE;'

# Num Postgres cru nao existe auth.uid() nem as roles do Supabase; num projeto
# Supabase existem, e o shim se recusa a rodar.
if ! "${PSQL[@]}" -tAc "SELECT to_regprocedure('auth.uid()') IS NOT NULL" | grep -q '^t$'; then
  echo "==> destino sem schema auth: aplicando o shim do Supabase"
  "${PSQL[@]}" -f "$(dirname "$0")/../database/tests/00_supabase_shim.sql"
fi

# O Supabase instala as extensoes num schema `extensions`, e duas colunas
# (group_invitations.id e schema_migrations.id) tem
# `DEFAULT extensions.uuid_generate_v4()` gravado no catalogo -- ou seja, o
# dump de producao vem com essa referencia dentro do CREATE TABLE. Num destino
# limpo esse schema nao existe e a restauracao para em 3F000 logo na primeira
# das duas tabelas. Fica fora do `if` do shim de proposito: um destino pode ter
# `auth` (e pular o shim) e mesmo assim nao ter `extensions`.
echo "==> extensoes"
"${PSQL[@]}" -c 'CREATE SCHEMA IF NOT EXISTS extensions;' \
             -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;' \
             -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;'

echo "==> estrutura"
"${PSQL_MUDO[@]}" -f "$SCHEMA_SQL"

# Antes dos dados: todo user_id de public referencia auth.users.
if [ "$MODO_AUTH" = 'so-public' ]; then
  echo "==> contas (auth.users): puladas (RESTORE_AUTH_MODE=so-public)"
  echo "    As $CONTAS_NO_DESTINO conta(s) do destino ficam como estao." >&2
elif abrir "$DEST/$STAMP-auth-users.sql" > /dev/null 2>&1; then
  echo "==> contas (auth.users)"
  if [ "$MODO_AUTH" = 'merge' ]; then
    # O ON CONFLICT nao da para colar no dump por regex: uma linha de
    # `--column-inserts` pode quebrar no meio se algum valor tiver \n, e o
    # `);` final cairia noutra linha. Redirecionar o INSERT para uma tabela
    # temporaria so depende do INICIO da linha, que e estavel, e o
    # `INSERT ... SELECT` final resolve o conflito de uma vez.
    #
    # A lista de colunas sai do proprio dump, e nao de `SELECT *`: o
    # auth.users do Supabase tem `confirmed_at` GERADA, que o pg_dump ja omite
    # do INSERT. Um `SELECT *` a traria de volta e o INSERT morreria em
    # "cannot insert a non-DEFAULT value into column confirmed_at".
    COLUNAS="$(abrir "$DEST/$STAMP-auth-users.sql" \
      | sed -n 's/^INSERT INTO auth\.users (\([^)]*\)).*/\1/p' | head -1)"
    if [ -z "$COLUNAS" ]; then
      echo "    backup sem nenhuma conta -- nada a carregar."
    else
      { echo 'CREATE TEMP TABLE _contas_do_backup (LIKE auth.users);'
        abrir "$DEST/$STAMP-auth-users.sql" \
          | sed 's/^INSERT INTO auth\.users /INSERT INTO _contas_do_backup /'
        echo "INSERT INTO auth.users ($COLUNAS)"
        echo "SELECT $COLUNAS FROM _contas_do_backup ON CONFLICT (id) DO NOTHING;"
        echo 'DROP TABLE _contas_do_backup;'
      } | "${PSQL_MUDO[@]}"
    fi
  else
    abrir "$DEST/$STAMP-auth-users.sql" | "${PSQL_MUDO[@]}"
  fi
else
  echo "AVISO: backup sem auth.users -- as linhas de public vao ficar sem dono." >&2
fi

# `session_replication_role = replica` desliga os triggers de usuario durante a
# carga. Nao e otimizacao, e correcao -- por dois motivos:
#
#  1. As tabelas derivadas (user_balances, financial_accounts.current_balance,
#     user_subscriptions, user_usage_limits) JA VEM no dump, com o valor certo.
#     Com os triggers ligados, reinserir as transacoes recalcularia tudo POR
#     CIMA do que acabou de ser restaurado: saldo dobrado, assinatura duplicada.
#  2. O dump do pg_dump roda com `search_path = ''`, e ha funcao de trigger que
#     referencia tabela sem qualificar (update_account_balance -> UPDATE
#     financial_accounts). Com o trigger ativo a carga para em 42P01.
#
# O `SET` entra no mesmo fluxo do psql de proposito: precisa ser a mesma sessao
# que carrega os dados. Volta para `origin` logo depois, no mesmo processo.
echo "==> dados (triggers desligados durante a carga)"
{ echo 'SET session_replication_role = replica;'
  abrir "$DEST/$STAMP-data.sql"
  echo 'SET session_replication_role = origin;'
} | "${PSQL_MUDO[@]}"

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
