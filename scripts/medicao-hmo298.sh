#!/usr/bin/env bash
# =============================================================================
# HMO-298 -- A MEDICAO DAS TRES LEITURAS, DO ZERO, NUM COMANDO
# =============================================================================
#   bash scripts/medicao-hmo298.sh
#
# Constroi um Postgres local a partir das MIGRATIONS REAIS (shim + 001 -> 041),
# carrega o fixture da medicao, compila as tres leituras de lib/ e imprime a
# tabela. Producao nao e tocada -- ela e somente-leitura aqui, e nenhum dado de
# usuario entra nesta conta.
#
# O banco e DERRUBADO E RECRIADO a cada execucao, de proposito: uma medicao que
# depende do estado deixado pela anterior nao e reproduzivel, e o numero que ela
# imprime nao prova nada sobre o fixture que esta no repositorio.
#
# Variaveis: PGUSER/PGPASSWORD/PGHOST (default postgres/postgres/localhost) e
# HMO298_DB (default hmo298).
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
export PGHOST="${PGHOST:-localhost}"
DB="${HMO298_DB:-hmo298}"
export HMO298_DB="$DB"

PSQL="psql -v ON_ERROR_STOP=1 --no-psqlrc -q -d $DB"

echo "==> Recriando o banco $DB"
dropdb --if-exists "$DB"
createdb "$DB"

echo "==> Shim do Supabase (schema auth, roles, auth.uid())"
$PSQL -f database/tests/00_supabase_shim.sql > /dev/null

echo "==> Migrations reais"
for f in database/migrations/*.sql; do
  $PSQL -f "$f" > /dev/null
done
echo "    $(ls database/migrations/*.sql | wc -l) migrations aplicadas"

echo "==> Fixture da medicao"
$PSQL -f database/tests/hmo298_fixture_tres_leituras.sql > /dev/null

echo "==> Compilando as tres leituras de lib/"
rm -rf .tmp-medicao-hmo298
npx tsc -p scripts/tsconfig.medicao-hmo298-test.json
node scripts/resolve-aliases.mjs .tmp-medicao-hmo298 lib --espelha-raiz > /dev/null

echo "==> Medindo"
node scripts/medicao-hmo298.mjs
