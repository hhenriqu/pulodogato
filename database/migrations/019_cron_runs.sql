-- =====================================================
-- PULODOGATO - O LIVRO-RAZAO DAS EXECUCOES DE CRON
-- =====================================================
-- Migration: 019_cron_runs
-- Gerado em: 2026-09-25  (HMO-156)
--
-- A PERGUNTA QUE HOJE NAO TEM RESPOSTA
-- ------------------------------------
-- "Os crons dispararam?" Ninguem consegue responder isso pelo banco.
--
-- A HMO-152 terminou com os quatro crons ARMADOS: chamada anonima devolve 401,
-- o que prova que `CRON_SECRET` existe no escopo Production. E so isso que
-- prova. O guard de Authorization vem ANTES de qualquer acesso ao banco, entao
-- a sonda para no 401 sem nunca executar o corpo da rota -- migration
-- faltando, RLS errada e erro de runtime sao todos invisiveis para ela.
--
-- O plano de verificacao da HMO-156 era olhar o EFEITO COLATERAL de cada job:
--
--   bill-alerts        -> linhas novas em bill_notifications
--   recurrence-alerts  -> bill_notifications com recurrence_id preenchido
--   recurrence-scan    -> linhas novas em detected_recurrences
--
-- Esse plano nao funciona, e da para mostrar por que com o estado fisico das
-- tabelas em producao hoje (25/09/2026), lido do catalogo -- que a RLS nao
-- filtra, ao contrario de um `count(*)` com a credencial de leitura:
--
--   relname                 relpages   bytes
--   detected_recurrences    0          0
--   bill_notifications      0          0
--   scheduled_transactions  0          0
--
-- Zero paginas: nenhuma linha jamais foi escrita em nenhuma das tres. E com o
-- dado que existe hoje elas CONTINUARAO vazias mesmo que os quatro crons
-- disparem perfeitamente -- `financial_transactions` tem uma pagina (~4 linhas)
-- e o detector exige 3 cobrancas do mesmo lojista em intervalo regular para
-- formar uma recorrencia; `scheduled_transactions` esta vazia, entao nao ha
-- vencimento para avisar.
--
-- Ou seja: os tres checks da HMO-156 voltam VAZIOS nos dois mundos -- no mundo
-- em que os crons rodaram direitinho e no mundo em que nenhum deles rodou. Um
-- teste que da o mesmo resultado nos dois casos nao e um teste. A propria
-- HMO-156 ja avisava disso na secao "a armadilha": presenca de linha prova que
-- rodou, ausencia NAO prova que falhou.
--
-- E EXATAMENTE A FALHA DA HMO-152 DE NOVO
-- ---------------------------------------
-- Tres crons responderam 503 desde que nasceram e ninguem percebeu por semanas.
-- O motivo nao foi desatencao: e que um cron MORTO e um cron OCIOSO produzem o
-- mesmo registro no banco -- nenhum. Enquanto a unica evidencia for efeito
-- colateral, essa confusao volta toda vez, porque o dia normal de um job de
-- aviso e justamente o dia em que ele nao tem nada a avisar.
--
-- Esta tabela quebra o empate. Cada execucao que passa do guard de auth grava
-- UMA linha, com o resultado que a rota devolveu -- inclusive, e principalmente,
-- quando o resultado e "nao havia nada a fazer". A partir daqui:
--
--   linha com status 'ok'  e contadores zerados -> rodou, nao tinha trabalho
--   nenhuma linha no dia                        -> a Vercel nao chamou a rota
--
-- Duas causas diferentes, dois registros diferentes. E a unica coisa que esta
-- migration faz.
--
-- =====================================================
-- O QUE ESTA TABELA NAO COBRE, E POR QUE NAO DA
-- =====================================================
-- O caminho 503 (falta variavel de ambiente) NAO e registrado aqui, e nao ha
-- como registrar: escrever nesta tabela exige SUPABASE_SERVICE_ROLE_KEY, que e
-- uma das variaveis cuja ausencia produz o 503. Um 503 por falta da chave de
-- servico nao teria com o que gravar que faltou a chave de servico.
--
-- Isso nao deixa buraco, porque esse caso ja tem deteccao propria e barata:
-- `npm run verify:crons -- <url>` pega o 503 de fora, sem precisar do segredo.
-- As duas verificacoes sao complementares e e assim que devem ser lidas:
--
--   verify:crons  -> a rota esta ARMADA? (variaveis existem, guard responde)
--   cron_runs     -> a rota FOI CHAMADA, e como terminou?
--
-- O 401 tambem nao e registrado, e aqui e de proposito: qualquer um na internet
-- bate em /api/cron/* sem header e levaria 401. Gravar isso transformaria a
-- tabela num log de varredura de porta e, pior, encheria o livro-razao de
-- linhas que nao sao execucoes de cron -- inclusive as sondas do proprio
-- verify:crons, que rodam justamente para conferir o 401.
--
-- =====================================================
-- POR QUE A LEITURA PRECISA DE UMA POLICY EXPLICITA
-- =====================================================
-- Quem vai ler esta tabela para responder a HMO-156 e a credencial de leitura
-- de producao (`paperclip_ro`). Ela NAO e dona da tabela, NAO e superuser e NAO
-- tem BYPASSRLS -- conferido no catalogo:
--
--   current_user=paperclip_ro  rolsuper=f  rolbypassrls=f
--
-- Nessa configuracao, RLS ligada com zero policies nao devolve erro: devolve
-- ZERO LINHAS, em silencio. A tabela ficaria com o livro-razao cheio e a
-- verificacao leria "nenhuma execucao" -- exatamente a conclusao errada que
-- esta migration existe para impedir, e agora com uma aparencia de prova.
-- Ja aconteceu neste projeto com `public.schema_migrations`: passei semanas
-- afirmando que o ledger estava vazio; ele sempre teve 11 linhas.
--
-- Por isso a SECAO 3 cria uma policy de SELECT nomeando o papel. E seguro dar
-- essa leitura: a tabela nao tem dado pessoal nenhum -- nome do job, horario,
-- status, duracao e contadores agregados. Nao ha user_id aqui, e isso tambem e
-- deliberado (ver SECAO 1).
--
-- A policy e condicional: o papel `paperclip_ro` existe em producao e NAO no
-- banco de validacao (sao projetos Supabase diferentes). Sem o DO/IF a
-- migration falharia com "role does not exist" no banco onde ela e testada
-- primeiro.
--
-- SEM META-COMANDO DE psql AQUI -- ESTE ARQUIVO E COLADO NO SQL EDITOR
-- ---------------------------------------------------------------------
-- Producao nao tem runner de migration: quem aplica e uma pessoa, colando o
-- arquivo no SQL Editor do Supabase, que fala Postgres e NAO e o psql. Uma
-- unica linha comecando com barra invertida vira `syntax error at or near "\"`
-- e, por estar ANTES do primeiro comando executavel, faz o arquivo INTEIRO ser
-- recusado -- nada e aplicado e o banco nao muda. Aconteceu com a 015 e a 016.
-- Ha guard no CI para isso desde entao (scripts/check-migrations-in-ci.mjs).
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 1: a tabela
-- =====================================================
-- NAO ha user_id nesta tabela, e a ausencia e o desenho.
--
-- Uma execucao de cron nao pertence a um usuario: ela varre todos. Uma linha
-- por usuario por dia transformaria o livro-razao no maior objeto do banco --
-- e, com RLS por usuario, a leitura de auditoria voltaria a enxergar zero. O
-- grao certo aqui e a EXECUCAO, e o detalhe por usuario continua onde ja esta
-- (bill_notifications, detected_recurrences), agora com uma linha de execucao
-- para ancorar a leitura.
CREATE TABLE IF NOT EXISTS public.cron_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Nome do job, igual ao ultimo segmento de `crons[].path` do vercel.json.
  job          text NOT NULL,

  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,

  -- 'ok'    -> a rota devolveu 2xx (inclusive "nao havia nada a fazer")
  -- 'error' -> a rota devolveu 5xx, ou estourou uma excecao
  status       text NOT NULL,

  -- O status HTTP que a rota devolveu. Guardado alem do `status` porque 500 por
  -- "falha ao ler" e 500 por excecao inesperada sao bugs diferentes, e a
  -- distincao se perde se so restar 'error'.
  http_status  integer,

  duration_ms  integer,

  -- O corpo que a rota devolveu, como veio. Sao contadores agregados
  -- (usuarios, avisos, detectadas, push) -- e o que responde "rodou e fez o
  -- que?" sem precisar cruzar com outra tabela. Fica jsonb e nao colunas
  -- porque cada job devolve um conjunto diferente, e acrescentar contador novo
  -- nao pode exigir migration.
  result       jsonb,

  -- Mensagem de erro quando status='error'. Texto, nao jsonb: o que interessa
  -- aqui e ser legivel numa consulta de auditoria.
  error        text,

  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cron_runs IS
  'Uma linha por execucao de cron que passou do guard de auth -- inclusive as que nao tinham nada a fazer. Existe para distinguir "rodou e estava ocioso" de "nunca foi chamado", que ate a HMO-156 produziam o mesmo registro no banco: nenhum.';

COMMENT ON COLUMN public.cron_runs.result IS
  'O corpo JSON que a rota devolveu. Contadores agregados, sem dado pessoal.';

-- O dominio de `job` segue a lista de `crons[].path` do vercel.json. Um CHECK e
-- nao uma FK porque nao ha tabela de jobs -- e o valor errado aqui e sempre
-- typo, nunca dado do usuario. Sem o CHECK, um job renomeado no vercel.json e
-- esquecido no codigo grava sob o nome antigo e a consulta de auditoria procura
-- por um nome que nunca aparece: de novo, ausencia lida como falha.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cron_runs'::regclass
      AND conname = 'cron_runs_job_check'
  ) THEN
    ALTER TABLE public.cron_runs
      ADD CONSTRAINT cron_runs_job_check
      CHECK (job IN (
        'recurrence-scan',
        'recurrence-alerts',
        'bill-alerts',
        'monthly-summary'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cron_runs'::regclass
      AND conname = 'cron_runs_status_check'
  ) THEN
    ALTER TABLE public.cron_runs
      ADD CONSTRAINT cron_runs_status_check
      CHECK (status IN ('ok', 'error'));
  END IF;
END $$;

-- Uma execucao que terminou nao pode ter terminado antes de comecar. Barato de
-- checar e, sem isso, um relogio errado produz duracao negativa que passa
-- despercebida numa media.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cron_runs'::regclass
      AND conname = 'cron_runs_finished_after_started_check'
  ) THEN
    ALTER TABLE public.cron_runs
      ADD CONSTRAINT cron_runs_finished_after_started_check
      CHECK (finished_at IS NULL OR finished_at >= started_at);
  END IF;
END $$;

-- =====================================================
-- SECAO 2: o indice da consulta de auditoria
-- =====================================================
-- Toda pergunta util aqui e "qual foi a ultima execucao deste job?" ou "o que
-- rodou nas ultimas 24h?". As duas sao (job, started_at DESC).
--
-- NAO ha indice unico nesta tabela, e isso tambem e escolha. Duas execucoes do
-- mesmo job no mesmo dia sao um EVENTO REAL no plano Hobby (+-59min de folga na
-- virada), e o livro-razao tem que registrar as duas -- e a deduplicacao do
-- efeito colateral ja mora nos indices unicos da 016 e da 017. Um indice unico
-- aqui apagaria justamente a evidencia da execucao dupla.
CREATE INDEX IF NOT EXISTS cron_runs_job_started_idx
  ON public.cron_runs (job, started_at DESC);

-- =====================================================
-- SECAO 3: RLS
-- =====================================================
-- Ligada, e sem policy para anon nem para authenticated: nenhum usuario do app
-- tem o que fazer com esta tabela. Quem escreve e o cron, com service_role, que
-- tem BYPASSRLS -- por isso a escrita nao precisa de policy.
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

-- FORCE para que nem o dono da tabela escape da RLS numa consulta futura. Sem
-- isto, "a tabela esta protegida" so vale ate alguem consultar como owner.
ALTER TABLE public.cron_runs FORCE ROW LEVEL SECURITY;

-- A leitura de auditoria. Ver o cabecalho: sem esta policy, `paperclip_ro` le
-- zero linhas SEM ERRO e a verificacao da HMO-156 conclui "nenhuma execucao"
-- com o livro-razao cheio.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paperclip_ro') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'cron_runs'
        AND policyname = 'cron_runs_auditoria_leitura'
    ) THEN
      EXECUTE 'CREATE POLICY cron_runs_auditoria_leitura ON public.cron_runs
                 FOR SELECT TO paperclip_ro USING (true)';
    END IF;

    EXECUTE 'GRANT SELECT ON public.cron_runs TO paperclip_ro';
  ELSE
    RAISE NOTICE '019: papel paperclip_ro ausente -- policy de auditoria NAO criada (esperado no banco de validacao).';
  END IF;
END $$;

COMMIT;

-- =====================================================
-- COMO CONFERIR DEPOIS DE APLICAR
-- =====================================================
-- scripts/hmo156-prove-crons.sql responde as duas perguntas separadas:
-- "a 019 esta no banco?" e "os crons dispararam?".
