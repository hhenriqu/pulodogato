#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# CONTROLE NEGATIVO DA HMO-197
# ---------------------------------------------------------------------------
# `hmo197_convite_sem_conta_test.sql` passa. Isso, sozinho, nao diz nada: um
# teste que nunca reprova e indistinguivel de um teste que nao roda.
#
# Este script desfaz, uma por vez, cada decisao load-bearing da 039 e exige que
# o teste REPROVE. Um mutante "SOBREVIVEU" e um pedaco da migration que nenhuma
# assercao protege -- ou seja, algo que a proxima pessoa pode remover por
# "simplificacao" sem que o CI diga uma palavra.
#
# Cada mutante corresponde a uma simplificacao plausivel, nao a um estrago
# aleatorio:
#
#   casa_por_profiles_email -> "o trigger ja tem NEW.email na mao, por que ir em
#                               auth.users?" -- e o roubo de convite: profiles.email
#                               e escrito pelo proprio usuario (policy de RLS trava
#                               linha, nao coluna)
#   sem_gate_confirmado     -> "quem se cadastrou existe; conferir confirmacao e
#                               paranoia" -- quebra a simetria com get_user_by_email
#   sem_dono_nulo           -> "o LOWER(email) ja identifica a linha certa"
#   sem_metodo_email        -> "invite_target de convite de telefone nunca vai
#                               parecer email"
#   sem_prazo               -> "convite expirado e pendente mesmo, entrega"
#   sem_pendente            -> "o status nao muda quem e o dono"
#   comparacao_crua         -> "email ja vem normalizado do formulario"
#   ignora_p_user_id        -> "reclamar tudo de uma vez e mais simples"
#   as_duas_invoker         -> "SECURITY DEFINER aqui e exagero"
#   sem_revoke              -> "deixa authenticated chamar, a funcao e inofensiva"
#   sem_backfill            -> "banco novo nasce certo pelo trigger"
#
# POR QUE A MUTACAO E SQL, E NAO EDICAO DO ARQUIVO
# ------------------------------------------------
# Mesma escolha do mutantes-categorias.sh, e por um motivo pratico medido: um
# runner que edita database/migrations/*.sql e restaura no fim deixa a migration
# MUTADA no disco se for interrompido no meio (timeout, Ctrl-C). Aqui o arquivo
# nunca e tocado -- cada mutante e um CREATE OR REPLACE aplicado a um clone
# descartavel, e o pior caso de uma interrupcao e um banco orfao.
#
# Uso (com PGHOST/PGUSER/PGPASSWORD apontando para um Postgres 17):
#   BANCO_BASE=pdg197 bash scripts/mutantes-convite-sem-conta.sh
#
# O banco base tem de estar no estado "cadeia completa + 039", COM o historico
# plantado antes da 039 (senao o mutante sem_backfill nao tem o que desfazer):
#
#   createdb pdg197
#   psql -d pdg197 -f database/tests/00_supabase_shim.sql
#   for f in database/migrations/0*.sql; do
#     case "$f" in *000_preflight*) continue;; esac
#     case "$f" in *039_*) psql -d pdg197 -f database/tests/039_historico_antes_da_039.sql;; esac
#     psql -v ON_ERROR_STOP=1 -d pdg197 -f "$f"
#   done
#
# O script nunca escreve no banco base: cada mutante roda num clone TEMPLATE.
# ---------------------------------------------------------------------------
set -uo pipefail

BASE="${BANCO_BASE:-pdg197}"
TESTE="database/tests/hmo197_convite_sem_conta_test.sql"
PSQL="psql -v ON_ERROR_STOP=1 --no-psqlrc -q"

# O corpo da funcao de casamento, com um buraco para cada clausula. Cada mutante
# monta o CREATE OR REPLACE com uma clausula de menos -- assim a mutacao e
# exatamente "esta linha foi removida", e nao uma reescrita que pode errar outra
# coisa de passagem.
funcao_casamento() {
  local dono_nulo="$1" metodo="$2" pendente="$3" prazo="$4" confirmado="$5" \
        comparacao="$6" por_usuario="$7" seguranca="$8" tabela="$9"
  cat <<SQL
CREATE OR REPLACE FUNCTION public.reclamar_convites_orfaos(p_user_id UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql $seguranca SET search_path = public AS \$fn\$
DECLARE v_reclamados INTEGER;
BEGIN
  UPDATE public.group_invitations gi
     SET invited_user_id = u.id, updated_at = NOW()
    FROM $tabela u
   WHERE TRUE
     $dono_nulo
     $metodo
     $pendente
     $prazo
     $confirmado
     $comparacao
     $por_usuario;
  GET DIAGNOSTICS v_reclamados = ROW_COUNT;
  RETURN v_reclamados;
END \$fn\$;
SQL
}

D="AND gi.invited_user_id IS NULL"
M="AND gi.invite_method = 'email'"
P="AND gi.status = 'pending'"
Z="AND gi.expires_at > NOW()"
C="AND u.email_confirmed_at IS NOT NULL"
Q="AND LOWER(btrim(u.email)) = LOWER(btrim(gi.invite_target))"
U="AND (p_user_id IS NULL OR u.id = p_user_id)"
SD="SECURITY DEFINER"
TB="auth.users"

# Primeiro o CONTROLE POSITIVO: no banco intacto o teste tem de PASSAR. Sem
# isto, um "todos os mutantes morreram" poderia significar apenas que o teste
# reprova sempre -- inclusive sem mutacao.
if ! $PSQL -d "$BASE" -f "$TESTE" >/dev/null 2>&1; then
  echo "ABORTADO: o teste reprova no banco INTACTO. Nada abaixo significaria nada."
  $PSQL -d "$BASE" -f "$TESTE" 2>&1 | grep -E "FALHA|ERROR" | head -3
  exit 1
fi
echo "controle positivo: o teste passa no banco intacto"
echo

FALHAS=0

mutante() {
  local nome="$1" sql="$2"
  local db="${BASE}_mut"

  psql -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1
  if ! psql -q -c "CREATE DATABASE $db TEMPLATE $BASE" >/dev/null 2>&1; then
    echo "  !! nao consegui clonar $BASE (conexao aberta?) -- mutante $nome NAO FOI MEDIDO"
    FALHAS=$((FALHAS + 1))
    return
  fi

  # A mutacao PRECISA aplicar. Um mutante que nao aplica aparece como
  # "sobreviveu" e manda investigar a assercao certa pelo motivo errado.
  #
  # "o psql saiu com 0" NAO e prova de que aplicou -- medido na HMO-197: o
  # `sem_prazo` apareceu como SOBREVIVEU numa execucao e morreu em todas as
  # outras, e a diferenca era a mutacao nao ter entrado naquela rodada. Por isso
  # aqui se compara a IMPRESSAO DIGITAL do estado antes e depois: o corpo das
  # duas funcoes, a existencia do trigger, o ACL de execucao e a linha do
  # backfill. Se nada disso mudou, o mutante nao foi medido e o placar diria
  # ficcao.
  local impressao="
    SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
      SELECT p.proname || p.prosecdef || md5(p.prosrc) ||
             coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE')::text, '?') AS x
        FROM pg_proc p
       WHERE p.proname IN ('reclamar_convites_orfaos','reclamar_convites_do_novo_perfil')
      UNION ALL
      SELECT 'trg' || count(*)::text FROM pg_trigger
       WHERE tgname = 'hmo197_reclamar_convites_trg'
      UNION ALL
      SELECT 'bf' || coalesce(invited_user_id::text,'nulo') FROM public.group_invitations
       WHERE id = '91111111-9197-0000-0000-000000000001'
    ) t"
  local antes depois
  antes=$($PSQL -d "$db" -tAc "$impressao" 2>/dev/null)

  if ! $PSQL -d "$db" -c "$sql" >/dev/null 2>&1; then
    echo "  !! a mutacao $nome NAO APLICOU (erro de SQL) -- resultado invalido"
    $PSQL -d "$db" -c "$sql" 2>&1 | grep -E "ERROR" | head -2
    FALHAS=$((FALHAS + 1))
    psql -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1
    return
  fi

  depois=$($PSQL -d "$db" -tAc "$impressao" 2>/dev/null)
  if [ -z "$antes" ] || [ "$antes" = "$depois" ]; then
    echo "  !! a mutacao $nome RODOU MAS NAO MUDOU NADA -- resultado invalido"
    FALHAS=$((FALHAS + 1))
    psql -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1
    return
  fi

  if $PSQL -d "$db" -f "$TESTE" >/dev/null 2>&1; then
    echo "  SOBREVIVEU  $nome   <-- nenhuma assercao protege isto"
    FALHAS=$((FALHAS + 1))
  else
    local qual
    qual=$($PSQL -d "$db" -f "$TESTE" 2>&1 | grep -oE 'FALHA: [^-]+' | head -1)
    echo "  morreu      $nome   (${qual:-reprovou})"
  fi

  psql -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1
}

# --- a regra de casamento, uma clausula de menos por vez --------------------
mutante casa_por_profiles_email "$(funcao_casamento "$D" "$M" "$P" "$Z" "" "$Q" "$U" "$SD" "public.profiles")"
mutante sem_gate_confirmado     "$(funcao_casamento "$D" "$M" "$P" "$Z" ""  "$Q" "$U" "$SD" "$TB")"
mutante sem_dono_nulo           "$(funcao_casamento ""  "$M" "$P" "$Z" "$C" "$Q" "$U" "$SD" "$TB")"
mutante sem_metodo_email        "$(funcao_casamento "$D" ""  "$P" "$Z" "$C" "$Q" "$U" "$SD" "$TB")"
mutante sem_pendente            "$(funcao_casamento "$D" "$M" ""  "$Z" "$C" "$Q" "$U" "$SD" "$TB")"
mutante sem_prazo               "$(funcao_casamento "$D" "$M" "$P" ""  "$C" "$Q" "$U" "$SD" "$TB")"
mutante ignora_p_user_id        "$(funcao_casamento "$D" "$M" "$P" "$Z" "$C" "$Q" ""  "$SD" "$TB")"
mutante comparacao_crua         "$(funcao_casamento "$D" "$M" "$P" "$Z" "$C" \
                                   "AND u.email = gi.invite_target" "$U" "$SD" "$TB")"

# --- privilegio ------------------------------------------------------------
# As DUAS funcoes INVOKER. Uma so nao e mutante valido: numa funcao DEFINER o
# current_user passa a ser o dono, e a chamada aninhada herda isso -- entao
# qualquer uma das duas sozinha ainda resolve, e trocar so uma e EQUIVALENTE.
mutante as_duas_invoker "
$(funcao_casamento "$D" "$M" "$P" "$Z" "$C" "$Q" "$U" "SECURITY INVOKER" "$TB")
CREATE OR REPLACE FUNCTION public.reclamar_convites_do_novo_perfil()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS \$fn\$
DECLARE v_reclamados INTEGER;
BEGIN
  v_reclamados := public.reclamar_convites_orfaos(NEW.id);
  RETURN NULL;
END \$fn\$;
GRANT EXECUTE ON FUNCTION public.reclamar_convites_orfaos(UUID) TO authenticated;"

mutante sem_revoke "
  GRANT EXECUTE ON FUNCTION public.reclamar_convites_orfaos(UUID) TO authenticated;"

# --- entrega e reparo ------------------------------------------------------
mutante sem_trigger "
  DROP TRIGGER hmo197_reclamar_convites_trg ON public.profiles;"

# Desfaz o efeito do backfill sobre a linha plantada por
# 039_historico_antes_da_039.sql: e o equivalente a "a SECAO 3 da migration nao
# existe". Sem o historico plantado no banco base este mutante nao mede nada --
# e por isso o controle positivo roda antes e o cabecalho cobra o fixture.
mutante sem_backfill "
  UPDATE public.group_invitations SET invited_user_id = NULL
   WHERE id = '91111111-9197-0000-0000-000000000001';"

echo
if [ "$FALHAS" -eq 0 ]; then
  echo "todos os mutantes morreram"
else
  echo "$FALHAS mutante(s) sobreviveu/sobreviveram ou nao foram medidos"
  exit 1
fi
