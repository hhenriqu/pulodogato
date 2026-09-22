#!/usr/bin/env bash
# =====================================================
# PULODOGATO - VERIFICACAO POS-DEPLOY
# =====================================================
# Roda o passo 4 do docs/DEPLOY_VERCEL.md de uma vez so, contra um deploy
# que acabou de subir:
#
#   ./scripts/verify-deploy.sh https://<projeto>.vercel.app
#
# Prova duas coisas:
#
#   1. /api/health responde 200 -- a app alcanca o Supabase de verdade.
#   2. As 10 rotas removidas na Fase 1 (HMO-121) dao 404 -- a remocao
#      chegou ao ar, nao ficou so na `main`.
#
# A lista de rotas abaixo veio do `git log --diff-filter=D`, nao de memoria.
# Isso importa: um caminho escrito errado da 404 porque nunca existiu, e a
# verificacao passaria sem provar nada. Se mexer na lista, confira contra o
# historico.
#
# Sai com codigo 1 se qualquer checagem falhar.

set -uo pipefail

BASE="${1:-}"
if [[ -z "$BASE" ]]; then
  echo "uso: $0 https://<projeto>.vercel.app" >&2
  exit 2
fi
BASE="${BASE%/}"

# Rotas apagadas no PR #1 (HMO-121). Conferidas contra o historico do git.
REMOVED_ROUTES=(
  /api/debug/database-check
  /api/debug/group-sync
  /api/debug/groups-check
  /api/debug/group-management/database-analysis
  /api/debug/group-management/enum-values
  /api/debug/group-management/status-validation
  /api/debug/group-management/test-leave-functionality
  /api/debug/archive-group/abc
  /api/debug/leave-group/abc
  /api/test/create-transaction
)

failures=0

status_of() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1"
}

echo "== $BASE =="
echo

echo "-- health --"
health_body="$(curl -s --max-time 20 "$BASE/api/health")"
health_code="$(status_of "$BASE/api/health")"
if [[ "$health_code" == "200" ]]; then
  echo "OK   200  /api/health"
elif [[ "$health_code" == "000" ]]; then
  echo "ERRO 000  /api/health -- sem resposta (host nao resolve? TLS? timeout?)"
  failures=$((failures + 1))
else
  echo "FALHA $health_code  /api/health (esperado 200)"
  failures=$((failures + 1))
fi
[[ -n "$health_body" ]] && echo "     corpo: ${health_body:0:200}"
echo

echo "-- rotas removidas na Fase 1 (esperado 404) --"
for route in "${REMOVED_ROUTES[@]}"; do
  code="$(status_of "$BASE$route")"
  if [[ "$code" == "404" ]]; then
    echo "OK   404  $route"
  elif [[ "$code" == "000" ]]; then
    # 000 = o curl nao completou (DNS, TLS, timeout). Nao e um 200 nem um 404;
    # nao da para concluir nada sobre a rota.
    echo "ERRO 000  $route -- sem resposta (conexao falhou, nao e conclusivo)"
    failures=$((failures + 1))
  else
    echo "FALHA $code  $route -- AINDA RESPONDE"
    failures=$((failures + 1))
  fi
done
echo

# As rotas com [groupId] sao dinamicas: mesmo removidas, um 404 podia vir do
# segmento e nao da rota. Checar a raiz sem o parametro separa os dois casos.
echo "-- sanidade: a app esta servindo mesmo? --"
root_code="$(status_of "$BASE/")"
if [[ "$root_code" =~ ^(200|302|307)$ ]]; then
  echo "OK   $root_code  / (a app responde, entao os 404 acima sao reais)"
else
  echo "FALHA $root_code  / -- se a app nao serve nada, os 404 acima nao provam nada"
  failures=$((failures + 1))
fi
echo

if [[ "$failures" -eq 0 ]]; then
  echo "TUDO OK -- health de pe e as 10 rotas da Fase 1 fora do ar."
else
  echo "$failures checagem(ns) falharam."
fi
exit $(( failures > 0 ? 1 : 0 ))
