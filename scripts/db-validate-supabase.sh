#!/usr/bin/env bash
# =====================================================
# PULODOGATO - VALIDACAO NUM PROJETO SUPABASE LIMPO
# =====================================================
# Fecha o ultimo item do escopo do HMO-117: "validar restaurando num projeto
# Supabase limpo".
#
#   VALIDATION_DB_URL='postgresql://postgres.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres' \
#     ./scripts/db-validate-supabase.sh
#
# Opcional, para exercitar tambem o ciclo de desastre:
#   BACKUP_DIR=./backups BACKUP_PASSPHRASE=... ./scripts/db-validate-supabase.sh
#
# ---------------------------------------------------------------------------
# Por que este script existe, se o db-verify ja roda no CI
# ---------------------------------------------------------------------------
# O CI valida num Postgres 17 cru mais o `00_supabase_shim.sql`. O shim e uma
# imitacao: cria `auth.uid()`, as roles e o minimo de `auth.users` para os
# testes rodarem. O que ele NAO reproduz e exatamente onde um restore de
# verdade costuma quebrar:
#
#   - as extensoes que o Supabase instala no schema `extensions`;
#   - o `auth.users` real do GoTrue, com as colunas e constraints dele;
#   - as roles de servico (`supabase_auth_admin`, `authenticator`, ...) e o
#     fato de que, pelo pooler, voce conecta como `postgres.<ref>` -- que NAO
#     e superusuario;
#   - os defaults e os event triggers que o proprio Supabase instala.
#
# Um backup que restaura no CI e falha aqui continua sendo um backup que nao
# restaura. Este script e a diferenca entre "provado" e "provado no lugar certo".
#
# ---------------------------------------------------------------------------
# O script nao para no primeiro erro de propria vontade
# ---------------------------------------------------------------------------
# So o dono do projeto Supabase consegue criar o ambiente e passar a credencial.
# Se cada falha custar uma ida e volta, cada item custa um dia. Por isso as
# verificacoes independentes rodam todas e o relatorio sai junto no fim -- mesma
# escolha da SECAO 0.0 do 002_rls_lockdown.sql. As migrations, essas sim, param
# na primeira: o 002 nao significa nada se o 001 nao subiu.
# =====================================================
set -uo pipefail

PROD_REF='odxqjvtxsioksguuevqm'
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"

# ---------------------------------------------------------------------------
# Credencial
# ---------------------------------------------------------------------------
if [[ -z "${VALIDATION_DB_URL:-}" ]]; then
  cat >&2 <<'EOF'
ERRO: VALIDATION_DB_URL nao esta no ambiente.

Precisa ser a connection string do *Session Pooler* de um projeto Supabase
descartavel (nao o de producao). No painel do projeto novo:

  Connect -> Session pooler -> URI

A credencial vem SEMPRE do ambiente. Nunca passe a URI por argumento: ela iria
parar no historico do shell e na lista de processos.
EOF
  exit 2
fi

# O cofre ja devolveu URI com quebra de linha no fim (HMO-123, 2026-09-21). O
# psql nao trima: o `\n` entra no ultimo parametro e vira
# `invalid sslmode value: "require\n"` -- erro que parece de sintaxe da URI.
DB_URL="${VALIDATION_DB_URL//[$'\t\r\n ']/}"

DB_PW="${DB_URL#*://*:}"; DB_PW="${DB_PW%%@*}"
if [[ "$DB_PW" =~ ^(SENHA|SUA_SENHA|TROQUE_POR_UMA_SENHA_FORTE|\[YOUR-PASSWORD\])$ ]]; then
  echo "ERRO: a URI ainda esta com o placeholder de senha (\"$DB_PW\")." >&2
  echo "      Troque pela senha real do projeto descartavel." >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Guarda-corpo: este script cria e apaga objetos. Producao esta fora.
# ---------------------------------------------------------------------------
if [[ "$DB_URL" == *"$PROD_REF"* ]]; then
  cat >&2 <<EOF
ERRO: VALIDATION_DB_URL aponta para o projeto de PRODUCAO ($PROD_REF).

Este script aplica migrations e (com BACKUP_DIR) apaga o schema public. Ele nao
tem variavel de escape de proposito: a validacao so tem valor num projeto
descartavel. Crie um projeto novo no plano Free e use a URI dele.
EOF
  exit 2
fi

export PGCONNECT_TIMEOUT=20
PSQL=(psql "$DB_URL" --no-psqlrc -v ON_ERROR_STOP=1)
q() { psql "$DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 -tAc "$1"; }

FALHAS=()
OKS=()
ok()    { OKS+=("$1");    printf '    ok: %s\n' "$1"; }
falha() { FALHAS+=("$1"); printf '    FALHA: %s\n' "$1" >&2; }

# Varias assercoes abaixo sao da forma "a consulta tem que voltar vazio" (nenhuma
# tabela sem RLS, nenhum grant sobrando para anon). O psql tambem devolve vazio
# quando a consulta FALHA -- conexao caida, permissao negada, tabela que nao
# existe. Sem conferir o codigo de saida, um erro de infraestrutura viraria
# "ok: todas as tabelas com RLS ligada": a resposta errada com cara de aprovada,
# que e pior do que nao ter verificacao nenhuma.
#
# `qv NOME VAR <sql>` roda a consulta, guarda o resultado em VAR e devolve
# falso se o psql falhou -- ja registrando a falha com o erro real.
qv() {
  local nome="$1" destino="$2" sql="$3" saida rc
  saida="$(psql "$DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 -tAc "$sql" 2>&1)"; rc=$?
  if (( rc != 0 )); then
    falha "$nome: a consulta nao rodou -- $(tr '\n' ' ' <<< "$saida" | cut -c1-160)"
    return 1
  fi
  printf -v "$destino" '%s' "$saida"
  return 0
}

echo "=============================================="
echo " Validacao em projeto Supabase limpo"
echo "=============================================="

# ---------------------------------------------------------------------------
# 0. Alvo
# ---------------------------------------------------------------------------
echo
echo "==> 0/5 identificando o alvo"
IDENT_SQL="select current_user || ' @ ' || current_database() || ' / ' || substring(version() from 'PostgreSQL [0-9.]+')"
if ! IDENT="$(psql "$DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 -tAc "$IDENT_SQL" 2>&1)"; then
  # "nao consegui conectar" sozinho custa uma ida e volta com o dono do projeto,
  # que e quem tem o painel. O Supavisor distingue os dois casos no texto do
  # erro, e a acao de correcao e diferente em cada um -- entao vale classificar
  # aqui em vez de deixar para a proxima conversa.
  #
  # Cuidado com a ordem: o pooler relata a role como "postgres", sem o sufixo
  # `.<ref>` do tenant. Ler isso como "o usuario esta errado" manda consertar o
  # que ja esta certo.
  echo "    $IDENT" | head -2 >&2
  echo >&2
  if [[ "$IDENT" == *'password authentication failed'* ]]; then
    cat >&2 <<EOF
ERRO: o projeto existe e o pooler reconheceu o tenant -- a SENHA e que nao bate.

Se o tenant nao existisse, o erro seria "(ENOTFOUND) tenant/user ... not found".
Ele nao foi esse: host, porta e ref do projeto estao corretos. Falta so a senha.

No painel do projeto descartavel: Settings -> Database -> Reset database password.
Copie a senha nova e troque APENAS essa parte da URI (entre os ':' e o '@').

Se a senha tiver caractere fora de [A-Za-z0-9], ela precisa ir percent-encoded
na URI (@ vira %40, / vira %2F, : vira %3A) -- senao o psql corta a URI no lugar
errado e o erro que aparece e este mesmo.
EOF
  elif [[ "$IDENT" == *'tenant'*'not found'* || "$IDENT" == *ENOTFOUND* ]]; then
    cat >&2 <<EOF
ERRO: o pooler nao conhece este tenant -- a senha nem chegou a ser conferida.

Quase sempre e regiao errada no hostname: a URI tem de vir do painel DO PROJETO
descartavel (Connect -> Session pooler -> URI), nao adaptada de outra. O trecho
aws-<n>-<regiao> muda de projeto para projeto.

Confira tambem se o ref depois de "postgres." e o do projeto novo.
EOF
  else
    echo "ERRO: nao consegui conectar. Confira a URI e se o projeto terminou de subir." >&2
  fi
  exit 2
fi
echo "    $IDENT"

# Este e o ponto do exercicio: se o alvo nao for um Supabase de verdade, a
# validacao vira uma copia da que ja roda no CI, so que mais lenta -- e passaria
# verde dando a impressao errada de que o item do escopo foi fechado.
#
# Nao basta procurar `auth.uid()` e as roles: o proprio 00_supabase_shim.sql
# cria as duas coisas. Um Postgres cru + shim passaria neste teste e o relatorio
# sairia "VALIDACAO OK" justamente para o item que o script existe para fechar.
# O que o shim nao tem e o `auth.users` do GoTrue -- ele declara 3 colunas
# (id, email, created_at) contra as ~30 do Supabase real. Checar duas delas
# separa um ambiente do outro.
FALTANDO=()
[[ "$(q "select to_regprocedure('auth.uid()') is not null")"        == t ]] || FALTANDO+=('funcao auth.uid()')
[[ "$(q "select to_regclass('auth.users') is not null")"            == t ]] || FALTANDO+=('tabela auth.users')
[[ "$(q "select count(*) = 3 from pg_roles where rolname in ('anon','authenticated','service_role')")" == t ]] || FALTANDO+=('roles anon/authenticated/service_role')
[[ "$(q "select count(*) = 2 from information_schema.columns
          where table_schema='auth' and table_name='users'
            and column_name in ('encrypted_password','raw_app_meta_data')")" == t ]] \
  || FALTANDO+=('auth.users do GoTrue (parece o 00_supabase_shim.sql, nao o Supabase)')
[[ "$(q "select count(*) = 1 from pg_roles where rolname = 'supabase_auth_admin'")" == t ]] || FALTANDO+=('role supabase_auth_admin')
if (( ${#FALTANDO[@]} )); then
  cat >&2 <<EOF

ERRO: o alvo nao parece um projeto Supabase. Faltou: ${FALTANDO[*]}

Rodar aqui com o 00_supabase_shim.sql apenas repetiria a validacao que o CI ja
faz num Postgres cru, e o item "validar num Supabase limpo" continuaria aberto
enquanto o relatorio dissesse que passou. Abortando de proposito.
EOF
  exit 2
fi
ok "alvo e um Supabase de verdade (auth.users, auth.uid(), roles de servico)"

# Projeto recem-criado tem `public` vazio. Se ja houver tabela nossa, ou a URI
# esta apontando para o lugar errado, ou uma execucao anterior deixou rastro --
# e dai o "do zero" desta validacao seria mentira.
JA_EXISTE="$(q "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")"
if [[ "$JA_EXISTE" != 0 ]]; then
  if [[ "${RESET_PUBLIC:-}" == 'sim' ]]; then
    echo "    public tem $JA_EXISTE tabela(s); RESET_PUBLIC=sim -> recriando o schema"
    "${PSQL[@]}" -q -c 'DROP SCHEMA IF EXISTS public CASCADE' -c 'CREATE SCHEMA public' \
      || { echo "ERRO: nao consegui recriar o schema public." >&2; exit 2; }
  else
    cat >&2 <<EOF

ERRO: o schema public do alvo ja tem $JA_EXISTE tabela(s); a validacao precisa
comecar do zero. Se este e mesmo o projeto descartavel, repita com:

  RESET_PUBLIC=sim $0
EOF
    exit 2
  fi
fi
ok "schema public vazio -- da para validar do zero"

# ---------------------------------------------------------------------------
# 1. As migrations, na ordem
# ---------------------------------------------------------------------------
# Aqui a parada no primeiro erro e proposital: as tres sao encadeadas.
echo
echo "==> 1/5 aplicando as migrations"
for m in 001_baseline 002_rls_lockdown 003_fix_trigger_privileges; do
  printf '    %s ... ' "$m"
  if saida="$("${PSQL[@]}" -q -f "$RAIZ/database/migrations/$m.sql" 2>&1)"; then
    echo 'ok'
  else
    echo 'FALHOU'
    echo "$saida" | tail -25 >&2
    cat >&2 <<EOF

A migration $m nao aplicou num Supabase limpo. Este e exatamente o defeito que
esta validacao existe para achar -- o CI passa porque o shim esconde a diferenca.
Nao adianta seguir: as proximas dependem desta.
EOF
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# 2. As mesmas assercoes do db-verify, agora no ambiente real
# ---------------------------------------------------------------------------
echo
echo "==> 2/5 conferindo o resultado"

if qv 'RLS ligada' SEMRLS "select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
               from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relkind='r' and not c.relrowsecurity"; then
  [[ -z "$SEMRLS" ]] && ok "todas as tabelas de public com RLS ligada" \
                     || falha "tabelas de public sem RLS: $SEMRLS"
fi

# A chave anon vai embutida no bundle JS publico: qualquer privilegio alem das
# duas tabelas de referencia e dado aberto na internet.
if qv 'grants de anon' EXTRA "select coalesce(string_agg(distinct table_name, ', '), '')
              from information_schema.role_table_grants
             where grantee='anon' and table_schema='public'
               and table_name not in ('financial_services','transaction_categories')"; then
  [[ -z "$EXTRA" ]] && ok "anon limitada a financial_services e transaction_categories" \
                    || falha "anon com privilegio em: $EXTRA"
fi

qv 'seed financial_services'     SERV "select count(*) from public.financial_services" \
  && { [[ "$SERV" == 3  ]] && ok "seed financial_services = 3"      || falha "financial_services = $SERV (esperado 3)"; }
qv 'seed transaction_categories' CATS "select count(*) from public.transaction_categories" \
  && { [[ "$CATS" == 12 ]] && ok "seed transaction_categories = 12" || falha "transaction_categories = $CATS (esperado 12)"; }

# As tres funcoes de trigger que o 003 conserta. Num Supabase real o
# `authenticated` e uma role de verdade, entao esta e a primeira vez que o
# SECURITY DEFINER e exercitado fora do shim.
if qv 'SECURITY DEFINER' SEMDEF "select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
               from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and not p.prosecdef
                and p.proname in ('create_free_subscription','update_user_balances',
                                  'update_usage_limits_on_plan_change')"; then
  [[ -z "$SEMDEF" ]] && ok "as 3 funcoes de trigger estao SECURITY DEFINER (003 aplicado)" \
                     || falha "funcoes sem SECURITY DEFINER: $SEMDEF"
fi

# ---------------------------------------------------------------------------
# 3. Isolamento de RLS
# ---------------------------------------------------------------------------
# O teste roda inteiro dentro de BEGIN/ROLLBACK: nao deixa rastro, nem mesmo os
# dois usuarios de fixture em auth.users.
echo
echo "==> 3/5 teste de isolamento de RLS (21 assercoes)"
if saida="$("${PSQL[@]}" -q -f "$RAIZ/database/tests/rls_isolation_test.sql" 2>&1)"; then
  ok "usuario B nao le nem escreve dados do A; anon so le as tabelas de referencia"
else
  falha "teste de isolamento de RLS"
  echo "$saida" | tail -20 >&2
fi

# ---------------------------------------------------------------------------
# 4. Fidelidade: o que subiu daqui bate com o baseline?
# ---------------------------------------------------------------------------
echo
echo "==> 4/5 inventario do que subiu"
q "select '    ' || count(*) || ' tabelas'   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'"
q "select '    ' || count(*) || ' policies'  from pg_policies where schemaname='public'"
q "select '    ' || count(*) || ' funcoes'   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"
q "select '    ' || count(*) || ' triggers'  from pg_trigger where not tgisinternal"

# ---------------------------------------------------------------------------
# 5. O drill de desastre, se houver backup a mao
# ---------------------------------------------------------------------------
echo
if [[ -n "${BACKUP_DIR:-}" ]]; then
  echo "==> 5/5 restaurando um backup real por cima (drill de desastre)"
  echo "    (apaga o schema public do alvo e restaura de $BACKUP_DIR)"
  if RESTORE_DB_URL="$DB_URL" BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-}" \
       "$RAIZ/scripts/db-restore.sh" "$BACKUP_DIR" 2>&1 | sed 's/^/    /'; then
    ok "backup de producao restaurou num Supabase limpo"

    # Depois de restaurar, o banco tem que voltar a passar nas mesmas checagens.
    if qv 'RLS apos o restore' SEMRLS2 "select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
                    from pg_class c join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relkind='r' and not c.relrowsecurity"; then
      [[ -z "$SEMRLS2" ]] && ok "apos o restore, todas as tabelas seguem com RLS" \
                          || falha "apos o restore, tabelas sem RLS: $SEMRLS2 (rode o 002)"
    fi
  else
    falha "restauracao do backup num Supabase limpo"
  fi
else
  echo "==> 5/5 drill de desastre: pulado (BACKUP_DIR nao definido)"
  echo "    Para exercitar tambem a restauracao, gere um backup com"
  echo "    scripts/db-backup.sh e repita com BACKUP_DIR=./backups."
fi

# ---------------------------------------------------------------------------
# Relatorio
# ---------------------------------------------------------------------------
echo
echo "=============================================="
if (( ${#FALHAS[@]} == 0 )); then
  echo " VALIDACAO OK -- ${#OKS[@]} verificacoes passaram"
  echo "=============================================="
  echo
  echo "O schema versionado sobe do zero num Supabase de verdade e a RLS isola."
  echo "Pode apagar o projeto descartavel."
  exit 0
fi
echo " VALIDACAO FALHOU -- ${#FALHAS[@]} de $(( ${#FALHAS[@]} + ${#OKS[@]} )) verificacoes"
echo "=============================================="
for f in "${FALHAS[@]}"; do echo "  - $f"; done
echo
echo "Todas as falhas acima sairam numa execucao so, de proposito: criar o"
echo "projeto e passar a credencial depende do dono, entao uma ida e volta por"
echo "defeito custaria caro."
exit 1
