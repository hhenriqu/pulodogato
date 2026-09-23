-- =====================================================
-- Teste: nenhuma view do schema public escapa da RLS
-- =====================================================
-- Responde a pergunta que a HMO-145 encontrou aberta: "uma view devolve linha
-- de outro usuario?". A `user_subscription_details` devolvia -- nome, email,
-- plano e contadores de uso de TODOS os usuarios, para qualquer usuario
-- logado, porque era a unica view do schema sem `security_invoker`.
--
-- Por que uma view sem a opcao fura a RLS: a leitura das tabelas de baixo e
-- checada com o privilegio do DONO da view (`postgres`). As tabelas tambem
-- pertencem ao `postgres` e estao com `relforcerowsecurity = false`, e RLS nao
-- se aplica ao dono da tabela quando FORCE esta desligado. A policy existe, o
-- `pg_policies` mostra ela, e ela simplesmente nao roda.
--
-- Rodar num banco limpo, depois da cadeia 001 -> 013:
--   psql "$DB_URL" -f database/tests/view_security_invoker_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

-- =====================================================
-- PARTE 1: a verificacao estrutural, que vale para o schema inteiro
-- =====================================================
-- Deliberadamente NAO e uma lista de views conhecidas. Uma view criada amanha
-- sem `security_invoker` reprova aqui sem ninguem precisar lembrar de
-- atualizar este teste -- que e exatamente o esquecimento que deixou a
-- `user_subscription_details` passar por 12 migrations.
DO $$
DECLARE
  faltando text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO faltando
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('v', 'm')
     AND NOT EXISTS (
       SELECT 1 FROM unnest(coalesce(c.reloptions, '{}')) AS o(opt)
        WHERE o.opt ILIKE 'security_invoker=%true%'
     );

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION
      'View(s) sem security_invoker: %. Sem a opcao a view roda com o privilegio do dono e devolve linha de todo mundo. Adicione ALTER VIEW ... SET (security_invoker = true).',
      faltando;
  END IF;
END $$;

-- =====================================================
-- PARTE 2: a prova de comportamento, com dois usuarios de verdade
-- =====================================================
-- A PARTE 1 sozinha nao bastaria: ela confere uma OPCAO, e o que importa e a
-- LINHA que volta. Aqui o teste pergunta ao banco o que o usuario logado
-- realmente enxerga.
INSERT INTO auth.users (id, email) VALUES
  ('cccccccc-0000-0000-0000-00000000000c', 'c@test.local'),
  ('dddddddd-0000-0000-0000-00000000000d', 'd@test.local');

-- is_public = FALSE nos dois, e nenhuma conexao aceita entre eles: sem isso a
-- policy `profiles_select_own_or_public` deixaria o C ver o D por um motivo
-- legitimo, e o teste passaria a verde sem provar nada sobre a view.
INSERT INTO public.profiles (id, full_name, email, is_public) VALUES
  ('cccccccc-0000-0000-0000-00000000000c', 'Usuario C', 'c@test.local', FALSE),
  ('dddddddd-0000-0000-0000-00000000000d', 'Usuario D', 'd@test.local', FALSE);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}';

DO $$
DECLARE
  v_tabela  integer;
  v_view    integer;
  v_alheio  integer;
BEGIN
  -- Controle: a RLS da tabela funciona. Se este numero nao for 1, o problema
  -- nao e a view e a comparacao abaixo nao significaria nada.
  SELECT count(*) INTO v_tabela FROM public.profiles;
  IF v_tabela <> 1 THEN
    RAISE EXCEPTION
      'Controle falhou: profiles devolveu % linha(s) para o usuario C, esperado 1. A RLS da tabela mudou, entao este teste nao consegue isolar o comportamento da view.',
      v_tabela;
  END IF;

  SELECT count(*) INTO v_view FROM public.user_subscription_details;
  IF v_view <> 1 THEN
    RAISE EXCEPTION
      'user_subscription_details devolveu % linha(s) para o usuario C, esperado 1. A view esta furando a RLS.',
      v_view;
  END IF;

  -- E a linha que voltou e a DELE. Um count = 1 tambem sairia se a view
  -- devolvesse so a linha do OUTRO usuario -- improvavel, e barato de excluir.
  SELECT count(*) INTO v_alheio
    FROM public.user_subscription_details
   WHERE user_id <> 'cccccccc-0000-0000-0000-00000000000c'::uuid;
  IF v_alheio <> 0 THEN
    RAISE EXCEPTION
      'user_subscription_details devolveu % linha(s) de OUTRO usuario para o C.',
      v_alheio;
  END IF;

  RAISE NOTICE 'OK: todas as views tem security_invoker, e user_subscription_details devolve so a linha do proprio usuario.';
END $$;

ROLLBACK;
