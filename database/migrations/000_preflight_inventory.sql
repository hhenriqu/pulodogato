-- =====================================================
-- PULODOGATO - INVENTARIO PRE-APLICACAO (SOMENTE LEITURA)
-- =====================================================
-- Gerado em: 2026-09-19
--
-- PARA QUE SERVE
-- --------------
-- O 002_rls_lockdown.sql foi escrito deduzindo as policies a partir dos
-- padroes de acesso do codigo, porque nao havia credencial de Postgres para
-- ler as policies reais de producao. Esse e o unico ponto cego que sobrou
-- antes de aplicar.
--
-- Este arquivo fecha o ponto cego. Ele NAO altera nada: so SELECT em catalogo.
-- E seguro rodar em producao a qualquer hora, inclusive com o app no ar.
--
-- COMO RODAR
-- ----------
-- 1. Supabase Dashboard > SQL Editor > New query
-- 2. Cole este arquivo inteiro e rode
-- 3. Cole o resultado das 5 consultas de volta no HMO-120
--
-- O que fazemos com o resultado:
--   - Q2 lista as policies que existem hoje. Se aparecer policy que o 002 nao
--     recria, a SECAO 0.1 do 002 vai remover - e precisamos conferir antes se
--     alguma delas cobre um acesso legitimo que o 002 esqueceu.
--   - Q3 mostra se alguma policy atual e permissiva demais (USING true).
--   - Q4 confirma o que `anon` pode fazer hoje - a causa raiz do vazamento.
--   - Q5 aponta tabela em producao que nao esta no 001_baseline.sql.
--   - Q6 responde "o 002 cabe neste banco?". 0 linhas = cabe. Qualquer linha e
--     uma deriva que faria o 002 abortar - mande a lista antes de tentar.
-- =====================================================

-- Q1: RLS ligada ou desligada, tabela por tabela -------------------
SELECT
  c.relname                        AS tabela,
  c.relrowsecurity                 AS rls_ligada,
  c.relforcerowsecurity            AS rls_forcada_no_dono,
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS qtd_policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relrowsecurity ASC, c.relname;

-- Q2: texto integral de cada policy existente ----------------------
-- Esta e a consulta que responde "quais sao as policies reais".
SELECT
  tablename   AS tabela,
  policyname  AS policy,
  permissive,
  roles,
  cmd         AS comando,
  qual        AS using_expr,
  with_check  AS with_check_expr
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Q3: policies perigosamente abertas -------------------------------
-- Qualquer linha aqui e um vazamento entre usuarios logados, mesmo com RLS
-- ligada. A auditoria anonima do extract-schema.mjs nao detecta este caso,
-- porque ela testa sem login.
--
-- A coluna que manda muda conforme o comando: INSERT so tem WITH CHECK (qual e
-- sempre NULL nela, o que nao quer dizer nada); os demais sao regidos pelo
-- USING. Olhar so para `qual` produziria falso positivo em toda policy de
-- INSERT.
SELECT
  tablename  AS tabela,
  policyname AS policy,
  permissive,
  roles,
  cmd        AS comando,
  qual       AS using_expr,
  with_check AS with_check_expr
FROM pg_policies
WHERE schemaname = 'public'
  AND permissive = 'PERMISSIVE'
  AND CASE
        WHEN cmd = 'INSERT'
          THEN with_check IS NULL OR btrim(lower(with_check)) IN ('true', '(true)')
        ELSE qual IS NULL OR btrim(lower(qual)) IN ('true', '(true)')
      END
ORDER BY tablename, policyname;

-- Q4: privilegios de tabela das roles anon / authenticated ---------
-- Hoje esperamos ver `anon` com SELECT/INSERT/UPDATE/DELETE espalhado - e
-- exatamente isso que a SECAO 2 do 002 revoga.
SELECT
  table_name  AS tabela,
  grantee     AS role,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privilegios
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
GROUP BY table_name, grantee
ORDER BY grantee, table_name;

-- Q5: funcoes do schema public e quem pode executar ----------------
-- Confere se `join_group_by_code` ja existe (nao deve existir ainda) e se ha
-- SECURITY DEFINER inesperada, que ignora RLS por definicao.
--
-- A assinatura completa (nao so o nome) esta aqui de proposito: em 2026-09-21 a
-- aplicacao do 002 parou porque producao tinha uma `is_group_member` com um
-- parametro a mais, que o CREATE OR REPLACE nao substituiu. Duas linhas com o
-- mesmo nome e aridade diferente = a SECAO 0.2 do 002 vai remover as duas e
-- recriar a canonica.
SELECT
  p.oid::regprocedure::TEXT          AS assinatura,
  p.prosecdef                        AS security_definer,
  pg_get_userbyid(p.proowner)        AS dono,
  array_to_string(p.proacl, ' | ')   AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname, assinatura;

-- Q6: o 002 cabe no schema deste banco? ----------------------------
-- 0 linhas = cabe, pode seguir para o Passo 3.
-- Qualquer linha aqui e exatamente o que faria o 002 abortar na SECAO 0.0.
-- Esta consulta e a mesma verificacao daquele bloco, so que em forma de SELECT:
-- cobre tabela, coluna, role e o indice unico de que o ON CONFLICT depende.
-- As colunas citadas apenas dentro do corpo das funcoes entram na lista de
-- proposito - corpo de funcao nao registra dependencia, entao a funcao seria
-- criada sem erro e quebraria depois, no uso.
SELECT msg AS faltando
FROM (
  SELECT CASE
           WHEN to_regclass('public.' || quote_ident(r.tabela)) IS NULL
             THEN format('  - tabela public.%s nao existe', r.tabela)
           WHEN NOT EXISTS (
                  SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = to_regclass('public.' || quote_ident(r.tabela))
                    AND a.attname = r.coluna
                    AND a.attnum > 0
                    AND NOT a.attisdropped)
             THEN format('  - coluna public.%s.%s nao existe', r.tabela, r.coluna)
         END AS msg
  FROM (VALUES
    ('profiles', 'id'), ('profiles', 'is_public'),
    ('financial_services', 'is_active'),
    ('transaction_categories', 'is_active'),
    ('financial_accounts', 'user_id'),
    ('financial_transactions', 'id'), ('financial_transactions', 'user_id'),
    ('financial_transactions', 'group_id'),
    ('transaction_installments', 'user_id'),
    ('expense_groups', 'id'), ('expense_groups', 'name'),
    ('expense_groups', 'created_by'), ('expense_groups', 'group_code'),
    ('expense_groups', 'group_type'), ('expense_groups', 'is_active'),
    ('group_members', 'id'), ('group_members', 'group_id'),
    ('group_members', 'user_id'), ('group_members', 'role'),
    ('group_members', 'status'), ('group_members', 'updated_at'),
    ('group_transactions', 'id'), ('group_transactions', 'group_id'),
    ('group_transactions', 'created_by'),
    ('group_expense_splits', 'member_id'),
    ('group_expense_splits', 'group_transaction_id'),
    ('group_member_proportions', 'group_id'),
    ('group_invitations', 'group_id'), ('group_invitations', 'invited_by'),
    ('group_invitations', 'invited_user_id'), ('group_invitations', 'status'),
    ('group_invitations', 'expires_at'),
    ('expense_splits', 'participant_id'), ('expense_splits', 'transaction_id'),
    ('user_balances', 'creditor_id'), ('user_balances', 'debtor_id'),
    ('user_subscriptions', 'user_id'),
    ('user_usage_limits', 'user_id')
  ) AS r(tabela, coluna)

  UNION ALL

  SELECT format('  - role %s nao existe neste banco', r.rolname)
  FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolname = r.rolname)

  UNION ALL

  SELECT '  - falta indice/constraint UNIQUE em public.group_members (group_id, user_id), '
         'que o ON CONFLICT de join_group_by_code exige'
  WHERE to_regclass('public.group_members') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indrelid = to_regclass('public.group_members')
        AND i.indisunique
        AND i.indnkeyatts = 2
        AND (SELECT array_agg(a.attname::TEXT ORDER BY a.attname)
               FROM unnest(i.indkey::SMALLINT[]) k
               JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k)
            = ARRAY['group_id', 'user_id'])
) x
WHERE msg IS NOT NULL
GROUP BY msg
ORDER BY msg;
