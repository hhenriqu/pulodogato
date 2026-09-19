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
--     recria, a SECAO 3.1 do 002 vai remover - e precisamos conferir antes se
--     alguma delas cobre um acesso legitimo que o 002 esqueceu.
--   - Q3 mostra se alguma policy atual e permissiva demais (USING true).
--   - Q4 confirma o que `anon` pode fazer hoje - a causa raiz do vazamento.
--   - Q5 aponta tabela em producao que nao esta no 001_baseline.sql.
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
SELECT
  p.proname                          AS funcao,
  p.prosecdef                        AS security_definer,
  pg_get_userbyid(p.proowner)        AS dono,
  array_to_string(p.proacl, ' | ')   AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;
