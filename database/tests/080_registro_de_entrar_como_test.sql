-- =====================================================
-- 080 -- o registro do "Entrar como"
-- =====================================================
-- Roda no db-verify contra o banco que as migrations constroem do zero, com a
-- 080 ja aplicada. Tudo num BEGIN com ROLLBACK.
--
-- O que ele fixa:
--   (1) a service role grava a entrada e fecha a saida;
--   (2) o admin le as proprias entradas;
--   (3) a pessoa cuja conta foi usada TAMBEM le a entrada -- e o motivo da
--       policy ter duas metades;
--   (4) um terceiro nao ve nada;
--   (5) nenhum usuario autenticado grava, fecha ou apaga entrada, nem a
--       propria (nao ha policy nem GRANT de escrita);
--   (6) as travas: ninguem "entra como" si mesmo, e a saida nao vem antes da
--       entrada.
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

-- Admin (Ana), a pessoa cuja conta e usada (Beto) e um terceiro (Caio).
INSERT INTO auth.users (id, email) VALUES
  ('a0800000-0000-0000-0000-0000000000a1', 'ana-080@teste.local'),
  ('a0800000-0000-0000-0000-0000000000b1', 'beto-080@teste.local'),
  ('a0800000-0000-0000-0000-0000000000c1', 'caio-080@teste.local');

-- =====================================================
-- SECAO 1: a service role grava e fecha
-- =====================================================
SET LOCAL ROLE service_role;
INSERT INTO public.registro_entrar_como (id, admin_id, alvo_id, user_agent) VALUES
  ('a0800000-0000-0000-0000-0000000000e1',
   'a0800000-0000-0000-0000-0000000000a1',
   'a0800000-0000-0000-0000-0000000000b1',
   'teste');
UPDATE public.registro_entrar_como
   SET saiu_em = entrou_em + interval '5 minutes'
 WHERE id = 'a0800000-0000-0000-0000-0000000000e1';
SELECT pg_temp.expect_text('a service role grava a entrada e fecha a saida',
  (SELECT (saiu_em IS NOT NULL)::text FROM public.registro_entrar_como
    WHERE id = 'a0800000-0000-0000-0000-0000000000e1'),
  'true');
RESET ROLE;

-- =====================================================
-- SECAO 2/3/4: quem le
-- =====================================================
SET LOCAL ROLE authenticated;

SET LOCAL request.jwt.claim.sub = 'a0800000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_text('o admin le a propria entrada',
  (SELECT count(*)::text FROM public.registro_entrar_como), '1');

SET LOCAL request.jwt.claim.sub = 'a0800000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_text('quem teve a conta usada tambem le a entrada',
  (SELECT count(*)::text FROM public.registro_entrar_como), '1');

SET LOCAL request.jwt.claim.sub = 'a0800000-0000-0000-0000-0000000000c1';
SELECT pg_temp.expect_text('um terceiro nao ve nada',
  (SELECT count(*)::text FROM public.registro_entrar_como), '0');

-- =====================================================
-- SECAO 5: ninguem autenticado escreve
-- =====================================================
SET LOCAL request.jwt.claim.sub = 'a0800000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect_erro_com('o admin nao forja entrada',
  $sql$INSERT INTO public.registro_entrar_como (admin_id, alvo_id)
       VALUES ('a0800000-0000-0000-0000-0000000000a1', 'a0800000-0000-0000-0000-0000000000c1')$sql$,
  '42501');
SELECT pg_temp.expect_erro_com('o admin nao reescreve a saida',
  $sql$UPDATE public.registro_entrar_como SET saiu_em = NULL$sql$,
  '42501');
SELECT pg_temp.expect_erro_com('o admin nao apaga o registro',
  $sql$DELETE FROM public.registro_entrar_como$sql$,
  '42501');

SET LOCAL request.jwt.claim.sub = 'a0800000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect_erro_com('quem teve a conta usada nao apaga o registro',
  $sql$DELETE FROM public.registro_entrar_como$sql$,
  '42501');

RESET ROLE;

-- =====================================================
-- SECAO 6: as travas
-- =====================================================
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_erro_com('ninguem entra como si mesmo',
  $sql$INSERT INTO public.registro_entrar_como (admin_id, alvo_id)
       VALUES ('a0800000-0000-0000-0000-0000000000a1', 'a0800000-0000-0000-0000-0000000000a1')$sql$,
  'registro_entrar_como_alvo_e_outro');
SELECT pg_temp.expect_erro_com('a saida nao vem antes da entrada',
  $sql$UPDATE public.registro_entrar_como SET saiu_em = entrou_em - interval '1 minute'
        WHERE id = 'a0800000-0000-0000-0000-0000000000e1'$sql$,
  'registro_entrar_como_saida_depois');
RESET ROLE;

ROLLBACK;
