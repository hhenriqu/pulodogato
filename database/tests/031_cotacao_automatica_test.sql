-- =====================================================
-- HMO-191 -- o par preco/data recusa a metade, e o cron cabe no livro-razao
-- =====================================================
--
-- Roda no db-verify, contra o banco que as migrations constroem do zero.
--
-- A ORDEM DESTE ARQUIVO E A TESE DELE
-- -----------------------------------
-- O caminho feliz esta por ultimo de proposito. O que pode quebrar a entrega da
-- HMO-191 nao e "o UPDATE com os dois campos funciona" -- isso qualquer escrita
-- prova. E o oposto: um UPDATE que mande so `current_price` levanta `23514` e
-- NAO ESCREVE NADA, e como o cliente do Supabase devolve isso como `error` e
-- nao como excecao, um cron que nao olhe o retorno responde 200 dizendo que
-- atualizou N precos enquanto o banco recusou os N.
--
-- Entao o 23514 e exercitado ANTES, e com controle negativo: o bloco 2 derruba
-- a constraint dentro de um savepoint e mostra que o MESMO UPDATE passa sem
-- ela. Sem esse bloco, um teste que so espera excecao continuaria verde se a
-- excecao viesse de outra coisa -- coluna com nome errado, por exemplo, tambem
-- levanta erro e tambem pinta de verde.
--
-- O BLOCO 4 AFIRMA UMA COISA QUE O BANCO **NAO** GARANTE
-- ------------------------------------------------------
-- "Ticker desconhecido nao pode zerar o preco que ja estava la" e requisito da
-- issue, e ele NAO tem protecao no schema: `SET current_price = NULL,
-- current_price_at = NULL` e um par valido e o banco aceita, com razao (e assim
-- que o usuario apaga um preco que ele mesmo digitou). O bloco 4 prova que o
-- banco aceita justamente para deixar registrado que a protecao mora no codigo
-- -- em lib/cotacao-brapi.ts, que so constroi atualizacao a partir de resposta
-- boa, e na rota, que nao emite UPDATE nenhum quando a cotacao falha. Quem
-- cobre isso e scripts/test-cotacao-brapi.mjs.
--
-- Afirmar aqui "o banco protege" seria a pior saida possivel: daria cobertura
-- aparente a um requisito que ninguem esta guardando.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect(label TEXT, got BIGINT, want BIGINT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_bool(label TEXT, got BOOLEAN, want BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- --- cenario ---------------------------------------------------------------
-- Dois usuarios com o MESMO ticker (PETR4). E esse o caso que a entrega
-- otimiza: uma chamada na brapi, duas linhas escritas. O terceiro ativo e um
-- CDB, que fica de fora da cotacao automatica (entrega 2) e serve de controle:
-- ele tem que sair desta suite com o preco que entrou.

INSERT INTO auth.users (id, email) VALUES
  ('91910000-0000-0000-0000-000000000001', 'cot-a@teste.local'),
  ('91910000-0000-0000-0000-000000000002', 'cot-b@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name) VALUES
  ('91910000-0000-0000-0000-000000000001', 'cot-a@teste.local', 'Cotacao A'),
  ('91910000-0000-0000-0000-000000000002', 'cot-b@teste.local', 'Cotacao B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.investment_assets
  (id, user_id, symbol, name, type, currency, current_price, current_price_at) VALUES
  -- Nunca cotada: os dois campos nulos. E a linha do bloco 1.
  ('91910000-0000-0000-0000-0000000000a1', '91910000-0000-0000-0000-000000000001',
   'PETR4', 'Petrobras PN', 'stock', 'BRL', NULL, NULL),
  -- Ja tem preco velho. E a linha do bloco 4.
  ('91910000-0000-0000-0000-0000000000a2', '91910000-0000-0000-0000-000000000002',
   'PETR4', 'Petrobras PN', 'stock', 'BRL', 30.00, '2026-01-02 12:00:00+00'),
  -- Renda fixa: fora do escopo da entrega 1.
  ('91910000-0000-0000-0000-0000000000a3', '91910000-0000-0000-0000-000000000001',
   'CDB2028', 'CDB Banco X 2028', 'fixed_income', 'BRL', 1200.00, '2026-01-02 12:00:00+00');

SELECT pg_temp.expect('cenario montado',
  (SELECT count(*) FROM public.investment_assets
    WHERE user_id IN ('91910000-0000-0000-0000-000000000001',
                      '91910000-0000-0000-0000-000000000002')), 3);

-- O bloco 3 filtra por SIMBOLO (e o que a rota faz), entao uma PETR4 deixada
-- por outra suite mudaria a contagem la e a falha apareceria no lugar errado.
-- As duas PETR4 desta suite sao as unicas do banco -- conferido aqui, onde a
-- mensagem ainda diz o que de fato aconteceu.
SELECT pg_temp.expect('PETR4 so existe nesta suite',
  (SELECT count(*) FROM public.investment_assets WHERE symbol = 'PETR4'), 2);

-- =====================================================
-- 1. Gravar SO o preco e recusado -- nas duas direcoes
-- =====================================================
-- Esta e a armadilha nomeada na issue. `investment_assets_preco_par_check` e
-- uma equivalencia, nao uma implicacao: as duas metades sao proibidas.

DO $$
BEGIN
  BEGIN
    UPDATE public.investment_assets
       SET current_price = 38.42
     WHERE id = '91910000-0000-0000-0000-0000000000a1';
    RAISE EXCEPTION 'FALHA: gravou current_price sem current_price_at';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: preco sem data recusado (23514)';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    UPDATE public.investment_assets
       SET current_price_at = now()
     WHERE id = '91910000-0000-0000-0000-0000000000a1';
    RAISE EXCEPTION 'FALHA: gravou current_price_at sem current_price';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: data sem preco recusada (23514)';
  END;
END $$;

-- A linha nao pode ter sido tocada: o CHECK recusa a LINHA INTEIRA, nao o
-- campo. Afirmar isso e o que separa "o UPDATE deu erro" de "o UPDATE nao
-- escreveu" -- e e a segunda coisa que importa para o cron, porque e dela que
-- vem o "200 com a carteira intacta".
SELECT pg_temp.expect('a linha continua sem preco depois das duas recusas',
  (SELECT count(*) FROM public.investment_assets
    WHERE id = '91910000-0000-0000-0000-0000000000a1'
      AND current_price IS NULL AND current_price_at IS NULL), 1);

-- =====================================================
-- 2. CONTROLE NEGATIVO: sem a constraint, o mesmo UPDATE passa
-- =====================================================
-- Prova que o bloco 1 esta medindo ESTA constraint, e nao qualquer erro.
-- Se este bloco falhasse -- isto e, se o UPDATE continuasse sendo recusado com
-- a constraint fora --, o bloco 1 seria verde por outro motivo e nao estaria
-- guardando nada.
--
-- O savepoint devolve a constraint ao lugar. Se este bloco FALHAR, o
-- `\set ON_ERROR_STOP on` derruba o script inteiro e o `BEGIN` do topo nunca
-- chega ao fim -- entao nao existe caminho em que a constraint fique derrubada
-- e os blocos seguintes passem em falso: ou o rollback do savepoint a devolve,
-- ou nao ha blocos seguintes. A assercao logo abaixo confere a devolucao em vez
-- de supo-la.

SAVEPOINT sem_constraint;

DO $$
DECLARE
  gravou numeric;
BEGIN
  ALTER TABLE public.investment_assets
    DROP CONSTRAINT investment_assets_preco_par_check;

  UPDATE public.investment_assets
     SET current_price = 38.42
   WHERE id = '91910000-0000-0000-0000-0000000000a1';

  SELECT current_price INTO gravou
    FROM public.investment_assets
   WHERE id = '91910000-0000-0000-0000-0000000000a1';

  IF gravou IS DISTINCT FROM 38.42 THEN
    RAISE EXCEPTION
      'FALHA (controle negativo): sem a constraint o UPDATE ainda nao gravou (% ) -- o bloco 1 estava verde por outro motivo',
      gravou;
  END IF;

  RAISE NOTICE 'ok: controle negativo -- sem a constraint o mesmo UPDATE grava 38.42';
END $$;

ROLLBACK TO SAVEPOINT sem_constraint;
RELEASE SAVEPOINT sem_constraint;

-- Depois do rollback a constraint voltou E a linha voltou a ser nula.
SELECT pg_temp.expect_bool('a constraint voltou depois do controle negativo',
  (SELECT EXISTS (
     SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.investment_assets'::regclass
        AND conname = 'investment_assets_preco_par_check')), true);

SELECT pg_temp.expect('a linha voltou a nao ter preco',
  (SELECT count(*) FROM public.investment_assets
    WHERE id = '91910000-0000-0000-0000-0000000000a1'
      AND current_price IS NULL), 1);

-- =====================================================
-- 3. O par completo passa, para os DOIS donos de PETR4
-- =====================================================
-- Um UPDATE por SIMBOLO, nao por usuario: e assim que a rota escreve, e e o que
-- torna uma chamada na brapi suficiente para N carteiras.

UPDATE public.investment_assets
   SET current_price = 38.42,
       current_price_at = '2026-09-30 21:00:00+00'
 WHERE symbol = 'PETR4'
   AND currency = 'BRL'
   AND type IN ('stock', 'fii');

SELECT pg_temp.expect('as duas linhas de PETR4 receberam o par completo',
  (SELECT count(*) FROM public.investment_assets
    WHERE symbol = 'PETR4'
      AND current_price = 38.42
      AND current_price_at = '2026-09-30 21:00:00+00'), 2);

-- O CDB nao foi tocado pelo filtro de `type`. Sem esse filtro na rota, a
-- renda fixa da entrega 2 receberia o preco de uma acao.
SELECT pg_temp.expect('a renda fixa ficou com o preco que tinha',
  (SELECT count(*) FROM public.investment_assets
    WHERE id = '91910000-0000-0000-0000-0000000000a3'
      AND current_price = 1200.00
      AND current_price_at = '2026-01-02 12:00:00+00'), 1);

-- Preco zerado tambem e recusado -- `investment_assets_current_price_positivo`.
-- Papel suspenso na B3 as vezes responde `regularMarketPrice: 0`, e essa e a
-- segunda linha de defesa (a primeira esta em `precoDaResposta`).
DO $$
BEGIN
  BEGIN
    UPDATE public.investment_assets
       SET current_price = 0, current_price_at = now()
     WHERE id = '91910000-0000-0000-0000-0000000000a1';
    RAISE EXCEPTION 'FALHA: gravou preco zero';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: preco zero recusado mesmo com a data junto';
  END;
END $$;

-- =====================================================
-- 4. O banco NAO impede apagar o preco -- por isso o codigo tem que impedir
-- =====================================================
-- Ver o cabecalho. Esta assercao existe para que ninguem conclua, lendo os
-- blocos 1 a 3, que "o schema protege o preco antigo". Ele nao protege.

UPDATE public.investment_assets
   SET current_price = NULL, current_price_at = NULL
 WHERE id = '91910000-0000-0000-0000-0000000000a2';

SELECT pg_temp.expect('o banco ACEITA apagar o par inteiro (a guarda e do codigo)',
  (SELECT count(*) FROM public.investment_assets
    WHERE id = '91910000-0000-0000-0000-0000000000a2'
      AND current_price IS NULL AND current_price_at IS NULL), 1);

-- =====================================================
-- 5. O livro-razao aceita o quinto job -- e so ele
-- =====================================================
-- A 031 ampliou `cron_runs_job_check`. Sem ela o cron roda, grava preco e
-- devolve 200, mas nao deixa registro nenhum -- o silencio que a 019 fechou.

INSERT INTO public.cron_runs
  (job, started_at, finished_at, status, http_status, duration_ms, result, error)
VALUES ('cotacoes', now() - interval '2 seconds', now(), 'ok', 200, 2000,
        '{"ok":true,"simbolos":1,"cotados":1,"atualizados":2}'::jsonb, NULL);

SELECT pg_temp.expect('cron_runs aceita job = cotacoes',
  (SELECT count(*) FROM public.cron_runs WHERE job = 'cotacoes'), 1);

-- Os quatro antigos continuam valendo: a 031 AMPLIOU o dominio, nao o trocou.
-- Um CHECK reescrito que esquecesse um valor antigo faria o job daquele nome
-- parar de registrar -- e, de novo, so se veria pela ausencia.
INSERT INTO public.cron_runs
  (job, started_at, finished_at, status, http_status, duration_ms, result, error)
VALUES
  ('recurrence-scan',   now(), now(), 'ok', 200, 1, '{}'::jsonb, NULL),
  ('recurrence-alerts', now(), now(), 'ok', 200, 1, '{}'::jsonb, NULL),
  ('bill-alerts',       now(), now(), 'ok', 200, 1, '{}'::jsonb, NULL),
  ('monthly-summary',   now(), now(), 'ok', 200, 1, '{}'::jsonb, NULL);

SELECT pg_temp.expect('os quatro jobs anteriores continuam aceitos',
  (SELECT count(*) FROM public.cron_runs
    WHERE job IN ('recurrence-scan','recurrence-alerts','bill-alerts','monthly-summary')), 4);

-- E o dominio continua FECHADO: um typo no nome do job e recusado. Sem esta
-- assercao, a 031 poderia ter trocado o CHECK por nada e tudo acima passaria.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.cron_runs
      (job, started_at, finished_at, status, http_status, duration_ms, result, error)
    VALUES ('cotacao', now(), now(), 'ok', 200, 1, '{}'::jsonb, NULL);
    RAISE EXCEPTION 'FALHA: cron_runs aceitou job com typo (cotacao, no singular)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: dominio de job continua fechado (typo recusado)';
  END;
END $$;

ROLLBACK;
