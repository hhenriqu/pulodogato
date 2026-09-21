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

# O cofre devolveu a URI com uma quebra de linha no fim na primeira credencial
# cadastrada (2026-09-21). O psql nao trima: o `\n` entra no ultimo parametro da
# query string e vira `invalid sslmode value: "require\n"` -- erro que parece de
# sintaxe da URI e manda a gente procurar no lugar errado. Uma URI valida nao
# tem espaco em branco em lugar nenhum, entao da para remover todos.
DB_URL="${SUPABASE_DB_URL_RO//[$'\t\r\n ']/}"

# Falha cedo se a URI ainda estiver com o placeholder da descricao do HMO-123.
# Sem isto o erro que aparece e `password authentication failed`, que e o mesmo
# erro de senha trocada e de papel inexistente -- tres causas, uma mensagem so.
DB_PW="${DB_URL#*://*:}"; DB_PW="${DB_PW%%@*}"
if [[ "$DB_PW" =~ ^(SENHA|TROQUE_POR_UMA_SENHA_FORTE)$ ]]; then
  echo "ERRO: a URI ainda esta com o placeholder de senha (\"$DB_PW\")." >&2
  echo "      Troque pelo valor real usado no \`create role paperclip_ro\`" >&2
  echo "      e regrave o segredo \`supabase_db_url_ro\`. Ver HMO-123, Parte A3." >&2
  exit 1
fi

OUT="${1:-${PAPERCLIP_SCRATCH_DIR:-.}/db-introspect}"
mkdir -p "$OUT"
export PGCONNECT_TIMEOUT=15

# `-v ON_ERROR_STOP=1` para que uma falha de permissao vire exit code, nao um
# arquivo de saida vazio que passa despercebido no diff.
psql_ro() { psql "$DB_URL" -v ON_ERROR_STOP=1 "$@"; }

echo "==> 1/7 smoke test"
psql_ro -Atc 'select current_user, current_database(), version()'

echo "==> 2/7 tabelas sem RLS (verificacao do 002; deve vir vazio)"
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

echo "==> 3/7 policies reais de public"
psql_ro -c "
  SELECT tablename, policyname, cmd, roles, qual, with_check
  FROM pg_policies WHERE schemaname = 'public'
  ORDER BY tablename, policyname;" > "$OUT/pg_policies.txt"

# Versao normalizada, uma policy por linha, para diff estavel entre execucoes.
# `qual` e `with_check` vem do pg_get_expr com quebras de linha e indentacao
# (um EXISTS(...) ocupa 3 linhas), entao e preciso achatar: sem isso uma policy
# ocupa varias linhas e `wc -l` deixa de contar policies. Na primeira execucao
# real isso reportou "60 policies" onde existiam 40.
psql_ro -Atc "
  SELECT tablename || '|' || policyname || '|' || cmd || '|' ||
         array_to_string(roles, ',') || '|' ||
         regexp_replace(coalesce(qual, ''), '\s+', ' ', 'g') || '|' ||
         regexp_replace(coalesce(with_check, ''), '\s+', ' ', 'g')
  FROM pg_policies WHERE schemaname = 'public'
  ORDER BY tablename, policyname;" > "$OUT/pg_policies.tsv"
echo "    $(psql_ro -Atc "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'") policies"

echo "==> 4/7 grants de authenticated/anon"
# NAO usar information_schema.role_table_grants aqui. Essa view so mostra as
# linhas em que o usuario atual e o grantor, o grantee, ou membro do grantee.
# O paperclip_ro nao e nada disso em relacao a anon/authenticated, entao a view
# volta VAZIA -- e um arquivo vazio aqui nao parece erro, parece resposta
# ("nenhum grant"), que e a conclusao oposta da verdade. Aconteceu na primeira
# execucao real (2026-09-21). O pg_class.relacl nao tem esse filtro.
psql_ro -c "
  SELECT c.relname AS table_name, a.grantee::regrole::text AS grantee,
         string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privs
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND a.grantee::regrole::text IN ('anon', 'authenticated')
  GROUP BY 1, 2 ORDER BY 1, 2;" > "$OUT/grants.txt"
if ! grep -q 'authenticated' "$OUT/grants.txt"; then
  echo "    ATENCAO: nenhum grant de authenticated encontrado -- suspeite da query," >&2
  echo "             nao do banco. O app nao funcionaria sem esses grants." >&2
fi

echo "==> 5/7 policies de storage/auth (escopo mais_auth do HMO-123)"
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

echo "==> 6/7 pg_dump --schema-only"
# --no-owner/--no-acl: o paperclip_ro nao e dono de nada, entao as linhas de
# ownership sairiam erradas e poluiriam o diff contra o 001_baseline.sql.
pg_dump "$DB_URL" \
  --schema-only --schema=public --no-owner --no-acl --no-comments \
  > "$OUT/schema-real.sql"
echo "    $(wc -l < "$OUT/schema-real.sql") linhas em $OUT/schema-real.sql"

# O dump do storage e separado e best-effort: e material de auditoria, nao
# entra no diff contra o 001_baseline.sql (que so descreve o public).
if pg_dump "$DB_URL" \
     --schema-only --schema=storage --no-owner --no-acl --no-comments \
     > "$OUT/schema-storage.sql" 2> "$OUT/schema-storage.err"; then
  echo "    $(wc -l < "$OUT/schema-storage.sql") linhas em $OUT/schema-storage.sql"
else
  echo "    storage: pg_dump recusado (ver $OUT/schema-storage.err) -- esperado se o grant nao passou" >&2
fi

echo "==> 7/7 triggers que escrevem em tabela sem policy de escrita"
# Esta secao existe por causa do que a primeira execucao real encontrou.
#
# O 002 ligou RLS nas tabelas derivadas (user_balances, user_subscriptions,
# user_usage_limits, subscription_history) e deu a elas SO policy de SELECT --
# correto, porque quem escreve nelas e o sistema, nao o usuario. So que os
# triggers que fazem essa escrita NAO sao SECURITY DEFINER: eles rodam como
# `authenticated`, batem na propria RLS e derrubam a transacao inteira.
#
# O modo de falha e traicoeiro: nada disso aparece em `pg_policies`, nem no
# diff de schema, nem numa leitura do 002 isolado. So aparece cruzando trigger
# + secdef + policies da tabela escrita. Por isso virou passo fixo.
psql_ro -Atc "
  SELECT p.proname || ' (trigger em ' || c.relname || ') escreve sem SECURITY DEFINER'
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE n.nspname = 'public' AND NOT t.tgisinternal AND NOT p.prosecdef
    AND EXISTS (
      SELECT 1 FROM pg_class w
      JOIN pg_namespace wn ON wn.oid = w.relnamespace
      WHERE wn.nspname = 'public' AND w.relkind = 'r' AND w.relrowsecurity
        AND p.prosrc ~* ('(insert into|update|delete from)\\s+' || w.relname)
        AND NOT EXISTS (
          SELECT 1 FROM pg_policies pol
          WHERE pol.schemaname = 'public' AND pol.tablename = w.relname
            AND pol.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
        )
    )
  ORDER BY 1;" | tee "$OUT/trigger-rls-conflicts.txt"
if [[ -s "$OUT/trigger-rls-conflicts.txt" ]]; then
  echo "    ATENCAO: $(wc -l < "$OUT/trigger-rls-conflicts.txt") trigger(s) quebram sob RLS. Ver HMO-123." >&2
else
  echo "    ok: nenhum trigger escrevendo em tabela sem policy de escrita"
fi

echo "==> 7b/7 triggers em SECURITY INVOKER que encostam em tabela com RLS"
# O passo 7 acima so pega um caso: escrita em tabela que nao tem NENHUMA policy
# de escrita. O HMO-125 mostrou, rodando os fluxos de verdade, que ele da "ok"
# com dois bugs vivos -- porque duas outras formas de quebrar nao aparecem ali:
#
#   1. LEITURA bloqueada. `calculate_split_amount` nao escreve em tabela
#      fechada: ele LE `financial_transactions`, que o participante nao enxerga.
#      O SELECT ... INTO volta vazio, deixa NEW.amount NULL e a transacao morre
#      no NOT NULL. O passo 7 so olha INSERT/UPDATE/DELETE, entao nao ve.
#
#   2. Policy que EXISTE mas nao passa. `add_group_creator` escreve em
#      `group_members`, que tem policy de INSERT -- o passo 7 considera isso
#      resolvido. So que a policy exige `is_group_admin(group_id)`, que consulta
#      a propria `group_members`: quando o trigger roda o criador ainda nao e
#      membro, e a checagem e circular.
#
# Nao da para decidir isso por catalogo -- se a policy passa ou nao depende de
# quem chamou e do estado da linha. Entao aqui o criterio e mais grosso de
# proposito: lista toda funcao de trigger em SECURITY INVOKER que mencione
# qualquer tabela com RLS, tirando as que ja foram exercitadas como
# `authenticated` e passaram (HMO-125, scripts/hmo125-audit-triggers.sql).
# Serve como lista de revisao: o que aparecer aqui e trigger novo ou alterado
# que ainda nao foi testado sob RLS.
psql_ro -Atc "
  SELECT DISTINCT p.proname || ' (trigger em ' || c.relname || ') menciona ' || w.relname
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_class w ON w.relkind = 'r' AND w.relrowsecurity
  JOIN pg_namespace wn ON wn.oid = w.relnamespace AND wn.nspname = 'public'
  WHERE n.nspname = 'public' AND NOT t.tgisinternal AND NOT p.prosecdef
    AND p.prosrc ~* ('\\m' || w.relname || '\\M')
    AND p.proname NOT IN (
      -- verificadas sob RLS no HMO-125: passam como \`authenticated\`
      'update_updated_at_column',      -- so seta NEW.updated_at
      'set_group_code',                -- le expense_groups so para achar codigo livre
      'auto_create_group_transaction', -- escreve em tabelas do proprio grupo
      'sync_transaction_with_group',   -- idem
      'calculate_equal_split',         -- le group_members/financial_transactions do grupo
      'update_account_balance'         -- atualiza conta do proprio usuario
    )
  ORDER BY 1;" | tee "$OUT/trigger-rls-invoker-review.txt"
if [[ -s "$OUT/trigger-rls-invoker-review.txt" ]]; then
  echo "    ATENCAO: $(wc -l < "$OUT/trigger-rls-invoker-review.txt") trigger(s) em SECURITY INVOKER nunca testados sob RLS. Ver HMO-125." >&2
else
  echo "    ok: nenhum trigger em SECURITY INVOKER pendente de revisao"
fi

echo
echo "Saida em: $OUT"
echo "Proximo passo: diff contra database/migrations/001_baseline.sql (HMO-123 Parte C item 5)."
