#!/usr/bin/env bash
# =====================================================
# PULODOGATO - OS CRONS ESTAO ARMADOS EM PRODUCAO?
# =====================================================
#
#   ./scripts/verify-crons.sh https://<projeto>.vercel.app
#
# Responde UMA pergunta: `CRON_SECRET` existe no escopo Production?
#
# Da para responder isso sem ter o segredo em maos, porque as tres rotas de
# cron checam as variaveis ANTES de checar o header Authorization. Uma chamada
# anonima, sem header nenhum, atravessa a primeira porta e para na segunda:
#
#   503  -> falta variavel. O corpo diz QUAL. O cron nunca rodou.
#   401  -> variaveis no lugar, a rota so recusou a chamada anonima. ESTE E O
#           RESULTADO CERTO: a Vercel manda `Authorization: Bearer <segredo>`
#           e passa; a internet inteira nao.
#   200  -> a rota rodou de verdade SEM autenticacao. Alarme: qualquer um na
#           internet dispara a varredura.
#   500  -> segredo configurado, mas a rota quebrou por outro motivo -- o mais
#           provavel aqui e migration pendente no Supabase (o deploy publica
#           codigo, nao schema).
#   404  -> a rota nao existe no deploy. O cron da Vercel bate e nao acha nada.
#
# Foi assim que a HMO-152 apareceu: os tres crons responderam 503 desde que
# nasceram (o de vencimento desde a HMO-141), entao nenhum deles jamais avisou
# ninguem -- e nada no painel gritava, porque uma rota que nunca e chamada com
# sucesso nao gera erro nenhum.
#
# A LISTA DE ROTAS VEM DO vercel.json, NAO DAQUI
# ----------------------------------------------
# Escrever os caminhos a mao neste script repetiria o bug que ele procura: um
# caminho errado da 404 e o 404 seria lido como "rota removida" em vez de
# "olhei no lugar errado". Entao o script le `crons[].path` do vercel.json --
# a mesma lista que a Vercel usa para agendar -- e, quando roda dentro do
# repositorio, confere que cada caminho tem um `route.ts` correspondente.
#
# PRECISAO NO PLANO HOBBY
# -----------------------
# No Hobby o disparo e "por hora, +-59 min": `30 9 * * *` sai entre 09:30 e
# 10:29. Com a varredura as 09:00 e o aviso as 09:30 isso significa que, em
# alguns dias, o aviso roda ANTES da varredura do mesmo dia -- nao quebra nada
# (o aviso pega as assinaturas ja conhecidas), so atrasa em um dia o aviso de
# uma assinatura detectada naquela manha. Ordem garantida so no plano Pro.
#
# Sai com codigo 1 se qualquer rota nao estiver em 401.

set -uo pipefail

BASE="${1:-}"
if [[ -z "$BASE" ]]; then
  echo "uso: $0 https://<projeto>.vercel.app" >&2
  echo "     VERCEL_BYPASS_TOKEN=<token> $0 https://<preview>.vercel.app" >&2
  exit 2
fi
BASE="${BASE%/}"

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Mesmo header de bypass do verify-deploy.sh: preview fica atras da Deployment
# Protection mesmo com producao aberta.
BYPASS_ARGS=()
if [[ -n "${VERCEL_BYPASS_TOKEN:-}" ]]; then
  BYPASS_ARGS=(
    -H "x-vercel-protection-bypass: $VERCEL_BYPASS_TOKEN"
    -H "x-vercel-set-bypass-cookie: false"
  )
  echo "(usando VERCEL_BYPASS_TOKEN para atravessar a Deployment Protection)"
fi

curl_args() {
  curl -s --max-time 20 ${BYPASS_ARGS[@]+"${BYPASS_ARGS[@]}"} "$@"
}

status_of() { curl_args -o /dev/null -w '%{http_code}' "$1"; }
body_of()   { curl_args "$1"; }

# ${arr[@]+"${arr[@]}"} sobrevive a `set -u` com array vazio em bash antigo.
mapfile -t CRON_PATHS < <(
  node -e '
    const j = require(process.argv[1] + "/vercel.json");
    for (const c of j.crons || []) console.log(c.path);
  ' "$RAIZ" 2>/dev/null
)

if [[ "${#CRON_PATHS[@]}" -eq 0 ]]; then
  echo "NAO VERIFICADO -- nao consegui ler crons[] de $RAIZ/vercel.json." >&2
  echo "Sem essa lista o script nao sabe o que sondar (e inventar caminho aqui" >&2
  echo "produziria 404 falso). Rode de dentro do repositorio." >&2
  exit 2
fi

failures=0

echo "== $BASE =="
echo

# -------- PROTECAO DE DEPLOY --------
# Ligada, tudo vira 302 para vercel.com/sso-api antes de chegar na app: os
# crons "nao dariam 401" por um motivo que nao tem nada a ver com a variavel.
redirect="$(curl_args -o /dev/null -w '%{redirect_url}' "$BASE/api/health")"
if [[ "$redirect" == *"vercel.com/sso"* ]]; then
  echo "NAO VERIFICADO -- Deployment Protection esta LIGADA neste deploy."
  echo "Tudo e redirecionado para vercel.com/sso-api antes da aplicacao."
  echo "Saida: Settings > Deployment Protection, ou VERCEL_BYPASS_TOKEN=<token>."
  exit 1
fi

# -------- ANCORA --------
# Duas provas, porque cada uma sozinha mente:
#   /api/health 200      -> e a NOSSA app servindo neste hostname;
#   /api/cron/<inventado> -> 404, entao 404 aqui significa mesmo "rota ausente"
#                            e nao "a Vercel devolve 404 para tudo".
echo "-- ancora --"
anchored=1
health_code="$(status_of "$BASE/api/health")"
if [[ "$health_code" == "200" ]]; then
  echo "OK   200  /api/health -- e a nossa app respondendo aqui"
else
  echo "FALHA $health_code  /api/health (esperado 200)"
  anchored=0
  failures=$((failures + 1))
fi

inventada="$(status_of "$BASE/api/cron/rota-que-nao-existe-$$")"
if [[ "$inventada" == "404" ]]; then
  echo "OK   404  /api/cron/<inventada> -- 404 aqui significa rota ausente"
else
  echo "AVISO $inventada  /api/cron/<inventada> (esperado 404) -- o host responde"
  echo "      o mesmo para caminho inexistente; um 404 abaixo nao prova nada."
  anchored=0
fi
echo

# -------- AS ROTAS DE CRON --------
echo "-- crons do vercel.json (esperado 401 em chamada anonima) --"
for path in "${CRON_PATHS[@]}"; do
  # A rota existe no codigo? Um caminho typo'd no vercel.json agenda um cron
  # que bate em 404 todo dia, para sempre, sem erro nenhum no painel.
  if [[ -d "$RAIZ/app" && ! -f "$RAIZ/app${path}/route.ts" ]]; then
    echo "FALHA --   $path -- vercel.json agenda um caminho SEM route.ts no repo"
    failures=$((failures + 1))
    continue
  fi

  code="$(status_of "$BASE$path")"
  case "$code" in
    401)
      echo "OK   401  $path -- variaveis configuradas, chamada anonima recusada"
      ;;
    503)
      corpo="$(body_of "$BASE$path")"
      faltam="$(sed -n 's/.*Faltam: \([^"]*\)\..*/\1/p' <<<"$corpo")"
      echo "FALHA 503  $path -- variavel de ambiente AUSENTE: ${faltam:-ver corpo}"
      echo "          este cron nunca rodou e nao vai rodar ate a variavel existir"
      failures=$((failures + 1))
      ;;
    200)
      echo "ALARME 200 $path -- a rota RODOU sem autenticacao nenhuma"
      echo "          qualquer um na internet dispara este job; revise o guard"
      failures=$((failures + 1))
      ;;
    500)
      echo "FALHA 500  $path -- segredo no lugar, mas a rota quebrou"
      echo "          suspeita numero 1: migration pendente no Supabase"
      echo "          corpo: $(body_of "$BASE$path" | head -c 200)"
      failures=$((failures + 1))
      ;;
    404)
      if [[ "$anchored" -eq 1 ]]; then
        echo "FALHA 404  $path -- agendado no vercel.json e ausente no deploy"
        failures=$((failures + 1))
      else
        echo "?    404  $path -- inconclusivo (ancora falhou)"
      fi
      ;;
    000)
      echo "ERRO 000  $path -- sem resposta (host? TLS? timeout?)"
      failures=$((failures + 1))
      ;;
    *)
      echo "FALHA $code  $path -- resposta inesperada"
      failures=$((failures + 1))
      ;;
  esac
done
echo

if [[ "$anchored" -eq 0 ]]; then
  echo "NAO VERIFICADO -- a ancora nao passou; confirme a URL do deploy."
  exit 1
fi

if [[ "$failures" -eq 0 ]]; then
  echo "TUDO OK -- os ${#CRON_PATHS[@]} crons estao armados (401 para anonimo)."
  echo "Isso prova que as variaveis existem. Que a Vercel DISPAROU o job so o"
  echo "painel (Project > Cron Jobs) e o log da funcao mostram."
else
  echo "$failures checagem(ns) falharam."
fi
exit $(( failures > 0 ? 1 : 0 ))
