-- =====================================================
-- 073 -- o peso e o setor do ativo, para o rebalanceamento da carteira
-- =====================================================
-- Roda no db-verify contra o banco que as migrations constroem do zero, com a
-- 073 ja aplicada DUAS vezes (a segunda e o step de idempotencia).
--
-- O que ele fixa, na ordem:
--
--   (1) A FORMA NO CATALOGO: as duas colunas NULAVEIS e sem DEFAULT. Um
--       `DEFAULT 0` no peso poria a carteira inteira no "aguardar" no dia da
--       colagem, e passaria numa assercao de "a coluna existe";
--   (2) AS RECUSAS: peso negativo, peso acima do teto, setor vazio e setor com
--       espaco na ponta -- todos com `23514`;
--   (3) AS ACEITACOES: peso 0 (quero zerar, o OIBR3 da planilha), peso com
--       decimal, NULL nos dois, e o INSERT que nao menciona as colunas novas,
--       que e o que o cadastro de ativo faz hoje;
--   (4) UMA so constraint de cada, para a segunda colagem nao duplicar;
--   (5) o COMMENT das colunas, que e a sonda de colagem em producao.
--
-- Tudo dentro de uma transacao que termina em ROLLBACK.
--
--   psql "$DB_URL" -f database/tests/073_rebalanceamento_da_carteira_test.sql
-- =====================================================

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

CREATE OR REPLACE FUNCTION pg_temp.expect_txt(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado "%", obtido "%"', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_recusa(label TEXT, sql TEXT, sqlstate_esperado TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> sqlstate_esperado THEN
      RAISE EXCEPTION 'FALHA: % -> recusou com % e nao com % (%)', label, SQLSTATE, sqlstate_esperado, SQLERRM;
    END IF;
    RAISE NOTICE 'ok: % (recusado com %)', label, sqlstate_esperado;
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o banco ACEITOU, e devia recusar com %', label, sqlstate_esperado;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_aceita(label TEXT, sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RAISE NOTICE 'ok: % (aceito)', label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FALHA: % -> o banco RECUSOU (% %), e devia aceitar', label, SQLSTATE, SQLERRM;
END $$;

-- =====================================================
-- 1. A FORMA NO CATALOGO
-- =====================================================
SELECT pg_temp.expect_txt('target_weight: tipo, nulabilidade e default',
  (SELECT data_type || '(' || numeric_precision || ',' || numeric_scale || ') / '
            || CASE WHEN is_nullable = 'NO' THEN 'NOT NULL' ELSE 'NULAVEL' END
            || ' / ' || coalesce(column_default, 'sem default')
     FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'investment_assets'
      AND column_name = 'target_weight'),
  'numeric(8,2) / NULAVEL / sem default');

SELECT pg_temp.expect_txt('sector: tipo, nulabilidade e default',
  (SELECT data_type || ' / '
            || CASE WHEN is_nullable = 'NO' THEN 'NOT NULL' ELSE 'NULAVEL' END
            || ' / ' || coalesce(column_default, 'sem default')
     FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'investment_assets'
      AND column_name = 'sector'),
  'text / NULAVEL / sem default');

-- =====================================================
-- Fixture (dentro da transacao -- some no ROLLBACK)
-- =====================================================
INSERT INTO auth.users (id, email) VALUES
  ('b0730000-0000-0000-0000-0000000073aa', 'x073@ci.local');

INSERT INTO public.profiles (id, email, full_name, is_public) VALUES
  ('b0730000-0000-0000-0000-0000000073aa', 'x073@ci.local', 'X, quem rebalanceia', FALSE);

INSERT INTO public.investment_assets (id, user_id, symbol, name, type) VALUES
  ('d0730000-0000-0000-0000-0000000073a1',
   'b0730000-0000-0000-0000-0000000073aa', 'BPAN4', 'Banco Pan', 'stock');

-- =====================================================
-- 2. AS RECUSAS
-- =====================================================
DO $$ BEGIN PERFORM pg_temp.expect_recusa('peso NEGATIVO e recusado', $sql$
  UPDATE public.investment_assets SET target_weight = -1
   WHERE id = 'd0730000-0000-0000-0000-0000000073a1'
$sql$, '23514'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_recusa('peso acima do teto (erro de digitacao) e recusado', $sql$
  UPDATE public.investment_assets SET target_weight = 1000.01
   WHERE id = 'd0730000-0000-0000-0000-0000000073a1'
$sql$, '23514'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_recusa('setor VAZIO e recusado', $sql$
  UPDATE public.investment_assets SET sector = ''
   WHERE id = 'd0730000-0000-0000-0000-0000000073a1'
$sql$, '23514'); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_recusa('setor com espaco na ponta e recusado', $sql$
  UPDATE public.investment_assets SET sector = 'Financeiro '
   WHERE id = 'd0730000-0000-0000-0000-0000000073a1'
$sql$, '23514'); END $$;

-- =====================================================
-- 3. AS ACEITACOES
-- =====================================================
DO $$ BEGIN PERFORM pg_temp.expect_aceita('peso 0 (quero zerar) e setor sao aceitos', $sql$
  UPDATE public.investment_assets SET target_weight = 0, sector = 'Financeiro'
   WHERE id = 'd0730000-0000-0000-0000-0000000073a1'
$sql$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_aceita('peso com decimal e aceito', $sql$
  UPDATE public.investment_assets SET target_weight = 7.5
   WHERE id = 'd0730000-0000-0000-0000-0000000073a1'
$sql$); END $$;

SELECT pg_temp.expect_txt('o peso gravado e o digitado',
  (SELECT target_weight::text FROM public.investment_assets
    WHERE id = 'd0730000-0000-0000-0000-0000000073a1'),
  '7.50');

DO $$ BEGIN PERFORM pg_temp.expect_aceita('voltar os dois para NULL (fora do rebalanceamento) e aceito', $sql$
  UPDATE public.investment_assets SET target_weight = NULL, sector = NULL
   WHERE id = 'd0730000-0000-0000-0000-0000000073a1'
$sql$); END $$;

DO $$ BEGIN PERFORM pg_temp.expect_aceita('INSERT que NAO menciona as colunas novas e aceito', $sql$
  INSERT INTO public.investment_assets (user_id, symbol, name, type)
  VALUES ('b0730000-0000-0000-0000-0000000073aa', 'TAEE4', 'Taesa', 'stock')
$sql$); END $$;

SELECT pg_temp.expect_txt('o ativo novo nasce FORA do rebalanceamento (peso e setor NULL)',
  (SELECT coalesce(target_weight::text, 'NULL') || ' / ' || coalesce(sector, 'NULL')
     FROM public.investment_assets
    WHERE user_id = 'b0730000-0000-0000-0000-0000000073aa' AND symbol = 'TAEE4'),
  'NULL / NULL');

-- =====================================================
-- 4. UMA SO CONSTRAINT DE CADA, DEPOIS DE DUAS COLAGENS
-- =====================================================
SELECT pg_temp.expect('UMA so constraint de faixa do peso',
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.investment_assets'::regclass
      AND conname = 'investment_assets_target_weight_faixa'), 1);

SELECT pg_temp.expect('UMA so constraint de texto do setor',
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.investment_assets'::regclass
      AND conname = 'investment_assets_sector_texto'), 1);

-- =====================================================
-- 5. O COMMENT, QUE E A SONDA DE COLAGEM EM PRODUCAO
-- =====================================================
SELECT pg_temp.expect('o COMMENT das duas colunas existe e cita a 073',
  (SELECT count(*) FROM pg_description d
     JOIN pg_class c      ON c.oid = d.objoid
     JOIN pg_attribute a  ON a.attrelid = c.oid AND a.attnum = d.objsubid
    WHERE c.relname = 'investment_assets'
      AND a.attname IN ('target_weight', 'sector')
      AND d.description LIKE '%073%'), 2);

SELECT pg_temp.expect('a 073 esta registrada em schema_migrations',
  (SELECT count(*) FROM public.schema_migrations WHERE version = '073'), 1);

ROLLBACK;
