#!/usr/bin/env bash
# =====================================================
# PULODOGATO - VERIFICACAO POS-DEPLOY
# =====================================================
# Roda o passo 5 do docs/DEPLOY_VERCEL.md de uma vez so, contra um deploy
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
# A ANCORA VEM PRIMEIRO, e o resto so vale se ela passar. Duas maneiras de um
# 404 mentir, as duas ja aconteceram de verdade aqui:
#
#   a) o deploy nao existe -- a Vercel devolve 404 para qualquer subdominio
#      desconhecido, entao as 10 rotas "passam" contra um host morto;
#   b) o hostname serve OUTRA app -- foi o caso em 22/09, quando
#      pulodogato.vercel.app respondia 200 com um SPA estatico do Lovable.
#      Checar so "a raiz responde 200" nao separa isso: provava que *alguma*
#      app servia ali, nao que era a nossa.
#
# Por isso a ancora e /api/health dar 200: e rota nossa e so responde se a
# camada de API do Next estiver no ar. Sem ela, os 404 viram "?" em vez de
# "OK" e o script diz NAO VERIFICADO -- nunca "tudo certo".
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

redirect_of() {
  curl -s -o /dev/null -w '%{redirect_url}' --max-time 20 "$1"
}

echo "== $BASE =="
echo

# -------- PROTECAO DE DEPLOY --------
# A Vercel Deployment Protection intercepta as requisicoes ANTES da aplicacao:
# tudo vira 302 para vercel.com/sso-api. Nesse estado nada abaixo significa
# nada -- a ancora "falha" com a URL certa, e as 10 rotas dao 302 em vez de 404.
# Sem esta checagem o script mandava "confirme a URL do deploy", que e a pista
# errada: a URL esta certa, o que falta e liberar o acesso publico.
if [[ "$(redirect_of "$BASE/api/health")" == *"vercel.com/sso"* ]]; then
  echo "NAO VERIFICADO -- Deployment Protection esta LIGADA neste deploy."
  echo
  echo "Toda requisicao e redirecionada (302) para vercel.com/sso-api antes de"
  echo "chegar na aplicacao, entao nao da para verificar nada daqui -- e nenhum"
  echo "usuario final consegue entrar. A URL nao e o problema."
  echo
  echo "Saida: Vercel > o projeto > Settings > Deployment Protection e desligar"
  echo "a Vercel Authentication para Production (ou restringi-la a preview)."
  echo "Depois rode este script de novo."
  exit 1
fi

# -------- ANCORA --------
# Tem que passar antes de qualquer 404 valer como prova. Ver o cabecalho.
echo "-- ancora: e a NOSSA app que responde aqui? --"
anchored=1

health_body="$(curl -s --max-time 20 "$BASE/api/health")"
health_code="$(status_of "$BASE/api/health")"
if [[ "$health_code" == "200" ]]; then
  echo "OK   200  /api/health"
elif [[ "$health_code" == "000" ]]; then
  echo "ERRO 000  /api/health -- sem resposta (host nao resolve? TLS? timeout?)"
  anchored=0
  failures=$((failures + 1))
else
  echo "FALHA $health_code  /api/health (esperado 200)"
  anchored=0
  failures=$((failures + 1))
fi
[[ -n "$health_body" ]] && echo "     corpo: ${health_body:0:200}"

# Se a ancora caiu, dizer o que esta servindo ali ajuda a distinguir
# "deploy inexistente" de "outra app ocupando o hostname".
if [[ "$anchored" -eq 0 ]]; then
  root_html="$(curl -s -L --max-time 20 "$BASE/")"
  root_code="$(status_of "$BASE/")"
  if [[ "$root_code" == "200" ]] && ! grep -q '/_next/' <<<"$root_html"; then
    titulo="$(grep -o '<title>[^<]*</title>' <<<"$root_html" | head -1)"
    echo "AVISO     / responde 200 mas nao parece Next.js -- outra app no hostname?"
    [[ -n "$titulo" ]] && echo "          $titulo"
  fi
fi
echo

echo "-- rotas removidas na Fase 1 (esperado 404) --"
for route in "${REMOVED_ROUTES[@]}"; do
  code="$(status_of "$BASE$route")"
  if [[ "$code" != "404" && "$code" != "000" ]]; then
    # Um 200/500 aqui e conclusivo mesmo sem ancora: a rota respondeu.
    echo "FALHA $code  $route -- AINDA RESPONDE"
    failures=$((failures + 1))
  elif [[ "$anchored" -eq 0 ]]; then
    # Sem ancora, 404 nao prova remocao: um host morto ou uma app estranha
    # devolve 404 para tudo. Nao conta como OK nem soma falha -- e indefinido.
    echo "?    $code  $route -- inconclusivo (ancora falhou)"
  elif [[ "$code" == "404" ]]; then
    echo "OK   404  $route"
  else
    echo "ERRO 000  $route -- sem resposta (conexao falhou, nao e conclusivo)"
    failures=$((failures + 1))
  fi
done
echo

if [[ "$anchored" -eq 0 ]]; then
  echo "NAO VERIFICADO -- a ancora (/api/health) nao respondeu 200, entao os 404"
  echo "acima nao provam que a Fase 1 chegou ao ar. Confirme a URL do deploy."
elif [[ "$failures" -eq 0 ]]; then
  echo "TUDO OK -- health de pe e as 10 rotas da Fase 1 fora do ar."
else
  echo "$failures checagem(ns) falharam."
fi
exit $(( failures > 0 ? 1 : 0 ))
