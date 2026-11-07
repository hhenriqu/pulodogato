-- =====================================================
-- 085 -- acesso pelo Claude (tokens do servidor MCP)
-- =====================================================
-- Roda no db-verify contra o banco que as migrations constroem do zero, com a
-- 085 ja aplicada. Tudo num BEGIN com ROLLBACK.
--
-- O que ele fixa:
--   (1) a service role cria o token;
--   (2) a dona le as proprias conexoes, e um terceiro nao ve nada;
--   (3) ninguem autenticado cria, apaga nem troca dono/hash de um token;
--   (4) a dona revoga, um terceiro nao revoga, e revogado nao "desrevoga";
--   (5) as travas: hash precisa ser SHA-256 em hex e e unico, e o mesmo
--       codigo de autorizacao nao vira dois tokens.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_text(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, veio %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_erro_com(label TEXT, sql TEXT, trecho TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(trecho IN SQLSTATE || ' ' || SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FALHA: % -> barrado, mas por outro motivo: % %', label, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'ok: % (barrado: %)', label, left(SQLERRM, 80);
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o comando PASSOU e deveria ter sido barrado', label;
END $$;

-- Quantas linhas um UPDATE alcancou. A RLS de UPDATE nao da erro quando o
-- USING esconde a linha: ela so nao e alcancada. Medir zero e o que prova.
CREATE OR REPLACE FUNCTION pg_temp.linhas_do_update(sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  EXECUTE sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n::text;
END $$;

-- A dona (Ana) e um terceiro (Caio).
INSERT INTO auth.users (id, email) VALUES
  ('a0850000-0000-0000-0000-0000000000a1', 'ana-085@teste.local'),
  ('a0850000-0000-0000-0000-0000000000c1', 'caio-085@teste.local');

-- =====================================================
-- SECAO 1: a service role cria
-- =====================================================
SET LOCAL ROLE service_role;
INSERT INTO public.tokens_do_claude (id, user_id, nome, prefixo, token_hash, codigo_hash) VALUES
  ('a0850000-0000-0000-0000-0000000000e1',
   'a0850000-0000-0000-0000-0000000000a1',
   'Claude', 'pdg_abcd',
   repeat('a', 64), repeat('d', 64));
SELECT pg_temp.expect_text('a service role cria o token',
  (SELECT count(*)::text FROM public.tokens_do_claude
    WHERE user_id = 'a0850000-0000-0000-0000-0000000000a1'),
  '1');
RESET ROLE;

-- =====================================================
-- SECAO 2: quem le
-- =====================================================
SET LOCAL ROLE authenticated;

SET LOCAL request.jwt.claim.sub = 'a0850000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_text('a dona le a propria conexao',
  (SELECT count(*)::text FROM public.tokens_do_claude), '1');

SET LOCAL request.jwt.claim.sub = 'a0850000-0000-0000-0000-0000000000c1';
SELECT pg_temp.expect_text('um terceiro nao ve nada',
  (SELECT count(*)::text FROM public.tokens_do_claude), '0');

-- =====================================================
-- SECAO 3: ninguem autenticado cria, apaga ou troca dono/hash
-- =====================================================
SET LOCAL request.jwt.claim.sub = 'a0850000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_erro_com('a dona nao cria token pela API',
  $sql$INSERT INTO public.tokens_do_claude (user_id, nome, prefixo, token_hash)
       VALUES ('a0850000-0000-0000-0000-0000000000a1', 'x', 'pdg_x', repeat('b', 64))$sql$,
  '42501');
SELECT pg_temp.expect_erro_com('a dona nao troca o hash',
  $sql$UPDATE public.tokens_do_claude SET token_hash = repeat('c', 64)$sql$,
  '42501');
SELECT pg_temp.expect_erro_com('a dona nao passa o token para outra pessoa',
  $sql$UPDATE public.tokens_do_claude SET user_id = 'a0850000-0000-0000-0000-0000000000c1'$sql$,
  '42501');
SELECT pg_temp.expect_erro_com('a dona nao apaga a linha',
  $sql$DELETE FROM public.tokens_do_claude$sql$,
  '42501');

-- =====================================================
-- SECAO 4: revogar
-- =====================================================
SET LOCAL request.jwt.claim.sub = 'a0850000-0000-0000-0000-0000000000c1';
SELECT pg_temp.expect_text('um terceiro nao alcanca o token alheio para revogar',
  pg_temp.linhas_do_update(
    $sql$UPDATE public.tokens_do_claude SET revogado_em = now()$sql$),
  '0');

SET LOCAL request.jwt.claim.sub = 'a0850000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_text('a dona revoga a propria conexao',
  pg_temp.linhas_do_update(
    $sql$UPDATE public.tokens_do_claude SET revogado_em = now()
         WHERE id = 'a0850000-0000-0000-0000-0000000000e1'$sql$),
  '1');
SELECT pg_temp.expect_text('revogado nao volta a valer pela API',
  pg_temp.linhas_do_update(
    $sql$UPDATE public.tokens_do_claude SET revogado_em = NULL
         WHERE id = 'a0850000-0000-0000-0000-0000000000e1'$sql$),
  '0');

RESET ROLE;

SELECT pg_temp.expect_text('a revogacao ficou gravada',
  (SELECT (revogado_em IS NOT NULL)::text FROM public.tokens_do_claude
    WHERE id = 'a0850000-0000-0000-0000-0000000000e1'),
  'true');

-- =====================================================
-- SECAO 5: as travas
-- =====================================================
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_erro_com('o token em claro nao cabe na coluna do hash',
  $sql$INSERT INTO public.tokens_do_claude (user_id, nome, prefixo, token_hash)
       VALUES ('a0850000-0000-0000-0000-0000000000a1', 'x', 'pdg_x', 'pdg_token_em_claro')$sql$,
  'tokens_do_claude_hash_sha256');
SELECT pg_temp.expect_erro_com('o mesmo hash nao vale para duas linhas',
  $sql$INSERT INTO public.tokens_do_claude (user_id, nome, prefixo, token_hash)
       VALUES ('a0850000-0000-0000-0000-0000000000c1', 'x', 'pdg_x', repeat('a', 64))$sql$,
  'tokens_do_claude_hash_unico');
SELECT pg_temp.expect_erro_com('o mesmo codigo de autorizacao nao vira dois tokens',
  $sql$INSERT INTO public.tokens_do_claude (user_id, nome, prefixo, token_hash, codigo_hash)
       VALUES ('a0850000-0000-0000-0000-0000000000a1', 'x', 'pdg_x', repeat('e', 64), repeat('d', 64))$sql$,
  'tokens_do_claude_codigo_unico');
-- Dois tokens gerados a mao (sem codigo) convivem.
INSERT INTO public.tokens_do_claude (user_id, nome, prefixo, token_hash) VALUES
  ('a0850000-0000-0000-0000-0000000000a1', 'manual 1', 'pdg_m1', repeat('1', 64)),
  ('a0850000-0000-0000-0000-0000000000a1', 'manual 2', 'pdg_m2', repeat('2', 64));
SELECT pg_temp.expect_text('tokens sem codigo convivem',
  (SELECT count(*)::text FROM public.tokens_do_claude WHERE codigo_hash IS NULL), '2');
RESET ROLE;

ROLLBACK;
