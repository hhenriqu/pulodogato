-- =====================================================
-- PULODOGATO - O LIVRO-RAZAO DE CRON (HMO-156 / migration 019)
-- =====================================================
-- Roda no db-verify, depois do 019. Prova no Postgres o que nenhum teste de
-- TypeScript com cliente dublado alcanca.
--
-- O ASSERT QUE JUSTIFICA O ARQUIVO
-- --------------------------------
-- A linha da execucao OCIOSA tem que ENTRAR. E ela que da sentido a tabela
-- inteira: com ela, "rodou e nao tinha trabalho" grava status ok com
-- contadores zerados, e "nunca foi chamado" nao grava nada -- duas causas, dois
-- registros. Sem ela, volta o estado da HMO-152, em que tres crons mortos e
-- tres crons ociosos eram indistinguiveis no banco.
--
-- Uma constraint escrita com a mao pesada (um NOT NULL em `result`, um CHECK
-- exigindo contador maior que zero) recusaria exatamente essa linha -- e como
-- a gravacao NAO derruba a rota, de proposito, a recusa nao apareceria em
-- lugar nenhum: a rota responderia 200 e o livro-razao ficaria vazio. O modo
-- de falha e silencioso nos dois lados, por isso o assert mora aqui.
--
-- E os CONTROLES NEGATIVOS, que sao metade do valor do teste:
--   - o dominio de `job` tem que bater com os `crons[].path` do vercel.json --
--     cinco desde a 031, que abriu a lista para `cotacoes` (HMO-191). Um job
--     renomeado la e esquecido aqui gravaria sob um nome que a consulta de
--     auditoria nunca procura, e a ausencia seria lida como "nao rodou";
--   - `finished_at >= started_at` tem que recusar a linha do relogio para tras
--     (Date.now() nao e monotonico: um ajuste de NTP entre as duas leituras
--     produz fim < inicio);
--   - NAO pode existir indice unico. Duas execucoes do mesmo job no mesmo dia
--     sao evento REAL no plano Hobby, que tem +-59min de folga no disparo. Um
--     unique aqui apagaria justamente a evidencia da execucao dupla -- e este
--     e o assert que impede alguem de "consertar" a tabela adicionando um.
-- =====================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A EXECUCAO OCIOSA ENTRA -- o assert que da nome ao arquivo
-- ---------------------------------------------------------------------------
INSERT INTO public.cron_runs (job, started_at, finished_at, status, http_status, duration_ms, result)
VALUES ('bill-alerts', now(), now(), 'ok', 200, 12, '{"ok":true,"avisos":0,"push":0}'::jsonb);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.cron_runs
     WHERE job = 'bill-alerts' AND status = 'ok' AND (result->>'avisos') = '0'
  ) THEN
    RAISE EXCEPTION 'A execucao OCIOSA nao foi registrada -- a tabela perdeu a razao de existir.';
  END IF;
END $$;

-- Os jobs de aviso, com o corpo real do early-return de cada rota. Se o dominio
-- de `job` sair de sincronia com o vercel.json, isto quebra aqui e nao em
-- producao as 09:00.
--
-- `cotacoes` (o quinto, da 031) nao entra nesta lista: ele tem suite propria em
-- database/tests/031_cotacao_automatica_test.sql, junto do CHECK do par
-- preco/data que a rota dele existe para nao violar. O que ESTE arquivo
-- continua garantindo para ele e o controle negativo la embaixo -- o dominio
-- segue FECHADO, entao um typo em `cotacoes` e recusado como qualquer outro.
INSERT INTO public.cron_runs (job, status, http_status, result) VALUES
  ('recurrence-scan',   'ok', 200, '{"ok":true,"usuarios":0,"detectadas":0}'::jsonb),
  ('recurrence-alerts', 'ok', 200, '{"ok":true,"avisos":0,"push":0,"usuarios":0}'::jsonb),
  ('monthly-summary',   'ok', 200, '{"ok":true,"resumos":0,"push":0,"usuarios":0}'::jsonb);

-- ---------------------------------------------------------------------------
-- 2. A EXECUCAO DUPLA CABE -- +-59min de folga no Hobby
-- ---------------------------------------------------------------------------
INSERT INTO public.cron_runs (job, status, http_status) VALUES ('bill-alerts', 'ok', 200);
INSERT INTO public.cron_runs (job, status, http_status) VALUES ('bill-alerts', 'ok', 200);

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.cron_runs WHERE job = 'bill-alerts';
  IF n < 3 THEN
    RAISE EXCEPTION 'Execucao dupla do mesmo job foi recusada -- ha indice unico onde nao pode haver (esperado >=3, veio %).', n;
  END IF;
END $$;

-- E o assert estrutural, que pega o unique ANTES de ele custar uma execucao:
-- um indice unico so falharia no dia em que dois disparos caissem no mesmo
-- ciclo, que pode demorar semanas para acontecer.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE i.indrelid = 'public.cron_runs'::regclass
       AND i.indisunique
       AND NOT i.indisprimary
  ) THEN
    RAISE EXCEPTION 'Ha indice UNICO em cron_runs alem da PK -- ele apagaria a evidencia da execucao dupla.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. OS CONTROLES NEGATIVOS
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO public.cron_runs (job, status) VALUES ('job-que-nao-existe', 'ok');
    RAISE EXCEPTION 'cron_runs aceitou um job fora do dominio do vercel.json.';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.cron_runs (job, status) VALUES ('bill-alerts', 'talvez');
    RAISE EXCEPTION 'cron_runs aceitou um status fora de (ok, error).';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.cron_runs (job, started_at, finished_at, status)
    VALUES ('bill-alerts', now(), now() - interval '5 seconds', 'ok');
    RAISE EXCEPTION 'cron_runs aceitou uma execucao que terminou antes de comecar.';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.cron_runs (job, status) VALUES (NULL, 'ok');
    RAISE EXCEPTION 'cron_runs aceitou job nulo.';
  EXCEPTION WHEN not_null_violation THEN
    NULL;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 4. A RLS ESTA LIGADA, E FORCADA
-- ---------------------------------------------------------------------------
-- Sem FORCE, "a tabela esta protegida" so vale ate alguem consultar como dono.
DO $$
DECLARE
  r record;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity INTO r
    FROM pg_class WHERE oid = 'public.cron_runs'::regclass;

  IF NOT r.relrowsecurity THEN
    RAISE EXCEPTION 'cron_runs esta sem RLS.';
  END IF;

  IF NOT r.relforcerowsecurity THEN
    RAISE EXCEPTION 'cron_runs esta sem FORCE ROW LEVEL SECURITY.';
  END IF;
END $$;

-- Nenhuma policy para anon nem para authenticated: usuario do app nao tem o que
-- fazer aqui. A unica policy prevista nomeia `paperclip_ro`, que NAO existe
-- neste banco -- entao no CI o esperado e zero policies.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'cron_runs'
     AND ('anon' = ANY(roles) OR 'authenticated' = ANY(roles) OR 'public' = ANY(roles));

  IF n > 0 THEN
    RAISE EXCEPTION 'cron_runs tem % policy(s) para anon/authenticated/public -- o livro-razao nao e do usuario.', n;
  END IF;
END $$;

ROLLBACK;
