-- =====================================================
-- PULODOGATO - FECHA O VAZAMENTO DA user_subscription_details
-- =====================================================
-- Migration: 013_fix_user_subscription_details_leak
-- Gerado em: 2026-09-23  (HMO-145)
--
-- O QUE ESTE ARQUIVO CORRIGE
-- --------------------------
-- `public.user_subscription_details` e a unica view do schema que ficou sem
-- `security_invoker`. Ela nasceu no 001_baseline, antes de a 002 ligar RLS, e
-- nenhuma migration posterior passou por ela: a 006, a 008 e a 012 ligaram
-- security_invoker nas views que ELAS criaram, e esta sobrou.
--
-- O EFEITO, MEDIDO
-- ----------------
-- Sem `security_invoker`, a leitura das tabelas de baixo e checada com o
-- privilegio do DONO da view (`postgres`), nao de quem consulta. `profiles`,
-- `user_subscriptions` e `user_usage_limits` tambem pertencem ao `postgres` e
-- estao com `relforcerowsecurity = false` -- e RLS nao se aplica ao dono da
-- tabela quando FORCE esta desligado. Resultado: a RLS simplesmente nao roda.
--
-- Reproduzido num Postgres 17 com a cadeia 001->012 aplicada, com dois
-- usuarios e `is_public = false` nos dois (nenhum publico, nenhuma conexao
-- aceita entre eles), consultando como `authenticated` com o JWT do primeiro:
--
--     SELECT count(*) FROM public.profiles                   -> 1   (RLS vale)
--     SELECT count(*) FROM public.user_subscription_details  -> 2   (RLS nao vale)
--
-- A view devolve `full_name`, `email`, plano, status da assinatura e os
-- contadores de uso de TODOS os usuarios. `authenticated` tem GRANT SELECT
-- nela, e o PostgREST expoe todo objeto do schema `public` em que o papel tem
-- grant -- em producao a view responde 401 para `anon` (que nao tem grant) e
-- 404 para relacao inexistente, ou seja: ela existe e esta publicada. Qualquer
-- usuario logado alcanca `/rest/v1/user_subscription_details` com a chave anon
-- publica mais o proprio JWT.
--
-- Nenhuma tela usa esta view -- nao ha uma citacao dela em `app/`,
-- `components/`, `lib/`, `utils/` ou `worker/`. Isso e o que torna a correcao
-- barata, e tambem e por que ninguem percebeu: o vazamento nao depende de o
-- app chamar a view, so de ela estar publicada.
--
-- POR QUE `security_invoker` E NAO `REVOKE`
-- -----------------------------------------
-- Revogar de `authenticated` fecharia o vazamento e deixaria a view morta --
-- ela passaria a nao servir para nada, e a proxima pessoa que precisasse do
-- dado daria o GRANT de volta sem saber por que ele tinha sumido. Com
-- `security_invoker` a view passa a valer o que ela sempre deveria ter valido:
-- cada um enxerga por ela exatamente as linhas que enxergaria consultando as
-- tabelas direto. O comportamento fica igual ao das outras 11 views.
--
-- IDEMPOTENTE
-- -----------
-- `ALTER VIEW ... SET` pode rodar quantas vezes for. A SECAO 2 aborta a
-- transacao se, no fim, a opcao nao estiver valendo -- ou seja, este arquivo
-- nao consegue terminar com sucesso deixando o vazamento aberto.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: pre-requisitos
-- =====================================================
DO $$
BEGIN
  IF to_regclass('public.user_subscription_details') IS NULL THEN
    RAISE EXCEPTION
      'Faltando: a view public.user_subscription_details nao existe. Rode o 001_baseline antes deste arquivo.';
  END IF;
END $$;

-- =====================================================
-- SECAO 1: a correcao
-- =====================================================
ALTER VIEW public.user_subscription_details SET (security_invoker = true);

COMMENT ON VIEW public.user_subscription_details IS
  'Assinatura, limites de uso e dados do perfil do usuario. security_invoker: a RLS de profiles, user_subscriptions e user_usage_limits e quem filtra as linhas -- sem ele a view roda com o privilegio do dono e devolve todos os usuarios.';

-- =====================================================
-- SECAO 2: prova
-- =====================================================
-- A migration nao termina se a opcao nao estiver valendo no fim. Sem isto,
-- este arquivo poderia "rodar com sucesso" sem ter mudado nada -- que e a
-- forma como um conserto de privilegio costuma falhar em silencio.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN LATERAL unnest(coalesce(c.reloptions, '{}')) AS o(opt)
     WHERE n.nspname = 'public'
       AND c.relname = 'user_subscription_details'
       AND o.opt ILIKE 'security_invoker=%true%'
  ) THEN
    RAISE EXCEPTION
      'security_invoker nao ficou ativo em public.user_subscription_details -- a view continuaria devolvendo todos os usuarios.';
  END IF;
END $$;

-- =====================================================
-- SECAO 3: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('013', '013_fix_user_subscription_details_leak',
        'security_invoker na user_subscription_details: a view expunha nome, email e plano de todos os usuarios a qualquer usuario logado - HMO-145', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
