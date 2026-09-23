-- =====================================================
-- PULODOGATO - REGRAS DE CATEGORIZACAO
-- =====================================================
-- Migration: 014_categorization_rules
-- Gerado em: 2026-09-23  (HMO-145)
--
-- O QUE ESTE ARQUIVO ADICIONA
-- ---------------------------
--   public.categorization_rules   "toda vez que aparecer ESTE estabelecimento,
--                                  a categoria e ESTA"
--
-- Como o 010 e o 011, este arquivo so ACRESCENTA: nenhuma funcao, tabela,
-- policy ou trigger de producao e alterada.
--
-- O PROBLEMA QUE ELA RESOLVE
-- ---------------------------
-- `financial_transactions.category_id` e NOT NULL, e a rota de importacao do
-- extrato (app/api/statements/entries/[id]/route.ts) recusa a linha sem
-- categoria com um 400. Ou seja: hoje o usuario escolhe a categoria A MAO,
-- uma linha de cada vez, para cada linha de cada extrato. Um OFX de mes cheio
-- sao dezenas de cliques, e o ifood do dia 3 recebe a mesma escolha que o
-- ifood do dia 17.
--
-- Esta tabela guarda essa escolha UMA vez por estabelecimento.
--
-- POR QUE A CHAVE E `merchant_key` E NAO O TEXTO DO EXTRATO
-- ----------------------------------------------------------
-- Casar pelo texto cru nao funciona: o mesmo lojista chega como "IFD*IFOOD
-- 3947", "IFOOD .COM AG" e "PAG*IFOOD". Uma regra por variacao nunca termina
-- -- o adquirente inventa uma nova no mes seguinte.
--
-- A chave aqui e a saida de `normalizeMerchant()` de lib/recurrence-detector.ts,
-- a MESMA funcao que o detector de assinaturas usa para agrupar. E o principal
-- motivo desta feature ter vindo depois do detector: a normalizacao ja existe,
-- ja tem 31 testes com descricao real de extrato, e reaproveita-la significa
-- que "netflix" quer dizer a mesma coisa nas duas telas.
--
-- CONSEQUENCIA QUE PRECISA ESTAR ESCRITA: mudar a normalizacao muda o
-- casamento das regras JA gravadas. Uma regra gravada como "ifood" para de
-- pegar no dia em que a funcao passar a devolver "ifood com". E o mesmo
-- acoplamento que o `merchant_key` da detected_recurrences tem, e vale o mesmo
-- aviso -- por isso os dois saem da mesma funcao e nao de duas copias.
--
-- POR QUE `learned` E `manual` SAO A MESMA TABELA
-- ------------------------------------------------
-- A regra nasce de dois jeitos: o usuario cadastra na tela ('manual'), ou ele
-- importa uma linha escolhendo a categoria e o app grava o que ele fez
-- ('learned'). Sao a mesma coisa no momento de aplicar -- a diferenca so serve
-- para a tela poder dizer "isto aqui eu aprendi sozinho, confere?" e para o
-- aprendizado nunca sobrescrever o que a pessoa digitou (SECAO 2).
--
-- POR QUE NAO HA COLUNA DE CONFIANCA
-- -----------------------------------
-- Uma regra ou casa ou nao casa: a chave normalizada e igual, ou e diferente.
-- Um numero de confianca aqui seria inventado -- e pior, daria a impressao de
-- que existe um limiar ajustavel que na verdade nao existe. O que existe de
-- incerto (o palpite do catalogo embutido, quando NAO ha regra) mora no
-- codigo, em lib/categorization.ts, e nunca e gravado sem o usuario confirmar.
-- =====================================================

BEGIN;

-- =====================================================
-- SECAO 0: pre-requisitos
-- =====================================================
-- Sem isto a tabela nasce e so o USO descobre que falta a categoria para
-- apontar. O FK abaixo ja falharia, mas com a mensagem do Postgres sobre
-- relacao inexistente, que nao diz qual migration ficou faltando.
DO $$
DECLARE
  faltando text;
BEGIN
  SELECT string_agg(msg, E'\n') INTO faltando
  FROM (
    SELECT CASE
             WHEN to_regclass('public.transaction_categories') IS NULL
               THEN '  - tabela public.transaction_categories nao existe (rode o 001_baseline)'
           END AS msg
    UNION ALL
    SELECT CASE
             WHEN to_regclass('public.financial_transactions') IS NULL
               THEN '  - tabela public.financial_transactions nao existe (rode o 001_baseline)'
           END
  ) t
  WHERE msg IS NOT NULL;

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION E'014 nao pode ser aplicado neste banco:\n%', faltando;
  END IF;
END $$;

-- =====================================================
-- SECAO 1: a tabela
-- =====================================================
CREATE TABLE IF NOT EXISTS public.categorization_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,

    -- Chave normalizada do estabelecimento ("ifood"). E o que CASA, e sai de
    -- normalizeMerchant() em lib/recurrence-detector.ts. Nao e para a tela.
    merchant_key text NOT NULL,
    -- O que a tela mostra ("iFood"). Vem da descricao original que originou a
    -- regra -- a pessoa reconhece "IFD*IFOOD 3947", nao "ifood".
    display_name text NOT NULL,

    category_id uuid NOT NULL,

    -- 'manual'  = o usuario cadastrou na tela de regras
    -- 'learned' = o app gravou o que ele escolheu ao importar uma linha
    source text NOT NULL DEFAULT 'manual',

    -- Desligar em vez de apagar. Apagar perde a informacao de que a pessoa ja
    -- decidiu sobre este estabelecimento, e o aprendizado (SECAO 2) recriaria
    -- a regra na proxima importacao -- exatamente a regra que ela removeu.
    is_active boolean NOT NULL DEFAULT true,

    -- Quantas linhas esta regra ja categorizou. E o que a tela usa para
    -- ordenar por utilidade e para o usuario ver que a regra esta trabalhando.
    times_applied integer NOT NULL DEFAULT 0,
    last_applied_at timestamp with time zone,

    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),

    CONSTRAINT categorization_rules_pkey PRIMARY KEY (id),

    CONSTRAINT categorization_rules_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,

    -- RESTRICT, e nao CASCADE: apagar uma categoria que tem regra apontando
    -- para ela nao pode levar a regra junto em silencio. A categoria some, as
    -- importacoes seguintes voltam a pedir escolha manual, e ninguem entende
    -- por que. Com RESTRICT o DELETE falha e a pessoa decide.
    CONSTRAINT categorization_rules_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.transaction_categories(id)
      ON DELETE RESTRICT,

    CONSTRAINT categorization_rules_source_check
      CHECK (source IN ('manual', 'learned')),

    -- Chave vazia casaria com toda descricao que normaliza para nada -- e
    -- normalizeMerchant() devolve "" para uma linha so de digitos, que existe
    -- em extrato. Uma regra assim categorizaria lixo com a cara de acerto.
    CONSTRAINT categorization_rules_merchant_key_check
      CHECK (length(trim(merchant_key)) > 0),

    CONSTRAINT categorization_rules_display_name_check
      CHECK (length(trim(display_name)) > 0),

    CONSTRAINT categorization_rules_times_applied_check
      CHECK (times_applied >= 0),

    -- Contador e carimbo andam juntos: `times_applied > 0` sem data deixa a
    -- tela sem ter o que mostrar em "ultima vez", e data sem contador e uma
    -- aplicacao que ninguem contou.
    CONSTRAINT categorization_rules_applied_check
      CHECK ((times_applied = 0) = (last_applied_at IS NULL))
);

COMMENT ON TABLE public.categorization_rules IS
  'Regra "este estabelecimento vai nesta categoria", aplicada na importacao do extrato. Casa por merchant_key normalizada, nao pelo texto cru do banco.';
COMMENT ON COLUMN public.categorization_rules.merchant_key IS
  'Chave normalizada. Sai de normalizeMerchant() em lib/recurrence-detector.ts, a mesma do detector de assinaturas -- mudar a normalizacao muda o casamento das regras ja gravadas.';
COMMENT ON COLUMN public.categorization_rules.source IS
  'manual = cadastrada na tela; learned = o app gravou a escolha feita numa importacao. O aprendizado nunca sobrescreve uma regra manual.';
COMMENT ON COLUMN public.categorization_rules.is_active IS
  'Regra desligada nao casa, mas continua existindo -- e o que impede o aprendizado de recriar na proxima importacao a regra que o usuario acabou de remover.';

-- =====================================================
-- SECAO 2: uma regra por estabelecimento por usuario
-- =====================================================
-- E o que torna o aprendizado idempotente e o que da sentido ao `ON CONFLICT`
-- da rota de importacao: importar dez linhas do iFood grava UMA regra, nao dez.
--
-- E e tambem a amarra que protege a escolha manual. O aprendizado grava com
-- `ON CONFLICT (user_id, merchant_key) DO UPDATE ... WHERE source = 'learned'`:
-- se ja existe regra 'manual' para o estabelecimento, o UPDATE nao acontece e a
-- categoria que a pessoa escolheu na tela sobrevive a importacao. Sem o indice
-- nao ha `ON CONFLICT` possivel e essa protecao nao tem onde se apoiar.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_categorization_rules_user_merchant
  ON public.categorization_rules (user_id, merchant_key);

COMMENT ON INDEX public.uniq_categorization_rules_user_merchant IS
  'Alvo do ON CONFLICT do aprendizado. Importar dez linhas do mesmo lojista grava uma regra, nao dez.';

-- =====================================================
-- SECAO 3: indice de leitura
-- =====================================================
-- A tela de regras abre em uma consulta: as regras do usuario, da mais usada
-- para a menos usada.
CREATE INDEX IF NOT EXISTS idx_categorization_rules_user_usage
  ON public.categorization_rules (user_id, times_applied DESC);

-- =====================================================
-- SECAO 4: RLS
-- =====================================================
ALTER TABLE public.categorization_rules ENABLE ROW LEVEL SECURITY;

-- Ver: so o dono.
DROP POLICY IF EXISTS categorization_rules_select ON public.categorization_rules;
CREATE POLICY categorization_rules_select ON public.categorization_rules
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Gravar: so em nome proprio.
DROP POLICY IF EXISTS categorization_rules_insert ON public.categorization_rules;
CREATE POLICY categorization_rules_insert ON public.categorization_rules
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Atualizar: so o dono, e sem trocar de dono nem de estabelecimento.
--
-- O `merchant_key` preso pela trigger da SECAO 5 (e nao aqui) porque a policy
-- so enxerga a linha NOVA -- `WITH CHECK` nao tem como comparar com o valor
-- anterior. A RLS garante o dono; a trigger garante a chave.
DROP POLICY IF EXISTS categorization_rules_update ON public.categorization_rules;
CREATE POLICY categorization_rules_update ON public.categorization_rules
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Apagar: so o dono. A tela oferece desligar (is_active) em vez de apagar,
-- pelo motivo do comentario da coluna, mas apagar de fato continua sendo
-- direito do dono.
DROP POLICY IF EXISTS categorization_rules_delete ON public.categorization_rules;
CREATE POLICY categorization_rules_delete ON public.categorization_rules
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =====================================================
-- SECAO 5: carimbo do updated_at + chave imutavel
-- =====================================================
-- Funcao propria, e nao a `update_updated_at_column()` legada do 001, pelo
-- mesmo motivo do 011: as migrations 003 e 004 existiram inteiras para
-- consertar trigger que gravava sem privilegio suficiente sob a RLS do 002.
-- Esta nasce com SECURITY INVOKER explicito e search_path fixo.
--
-- Ela tambem congela `merchant_key` e `user_id`. Trocar a chave de uma regra
-- existente a faz casar com OUTRO estabelecimento mantendo o display_name
-- antigo: a tela continuaria escrito "iFood" e a regra passaria a categorizar
-- Uber. Nada falharia -- os lancamentos so nasceriam na categoria errada.
CREATE OR REPLACE FUNCTION public.categorization_rules_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.merchant_key IS DISTINCT FROM OLD.merchant_key THEN
    RAISE EXCEPTION 'merchant_key de uma regra nao muda: apague a regra e crie outra (era %, veio %)',
      OLD.merchant_key, NEW.merchant_key;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'regra de categorizacao nao troca de dono';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_categorization_rules_guard ON public.categorization_rules;
CREATE TRIGGER trg_categorization_rules_guard
  BEFORE UPDATE ON public.categorization_rules
  FOR EACH ROW EXECUTE FUNCTION public.categorization_rules_guard();

-- =====================================================
-- SECAO 6: GRANTS
-- =====================================================
-- O 002 rodou GRANT ... ON ALL TABLES antes desta tabela existir, e ALL TABLES
-- e uma fotografia do momento -- nao alcanca objeto criado depois.
REVOKE ALL ON public.categorization_rules FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categorization_rules TO authenticated;

-- =====================================================
-- SECAO 7: prova
-- =====================================================
-- O arquivo aborta se nao tiver pegado. Sem isto, rodar a migration num banco
-- onde algo falhou em silencio sai verde e o problema aparece semanas depois,
-- como leitura de regra de outro usuario.
DO $$
DECLARE
  problemas text := '';
BEGIN
  IF to_regclass('public.categorization_rules') IS NULL THEN
    RAISE EXCEPTION '014 nao criou public.categorization_rules';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = to_regclass('public.categorization_rules') AND relrowsecurity
  ) THEN
    problemas := problemas || E'\n  - RLS nao ficou habilitada';
  END IF;

  -- Quatro policies: select, insert, update, delete.
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'categorization_rules') <> 4 THEN
    problemas := problemas || E'\n  - esperava 4 policies em categorization_rules';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'uniq_categorization_rules_user_merchant'
  ) THEN
    problemas := problemas || E'\n  - falta o UNIQUE (user_id, merchant_key): o aprendizado duplicaria regra';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = to_regclass('public.categorization_rules')
      AND tgname = 'trg_categorization_rules_guard'
      AND NOT tgisinternal
  ) THEN
    problemas := problemas || E'\n  - falta a trigger que congela merchant_key';
  END IF;

  -- `has_table_privilege` de anon: a leitura precisa estar fechada.
  IF has_table_privilege('anon', 'public.categorization_rules', 'SELECT') THEN
    problemas := problemas || E'\n  - anon ainda le categorization_rules';
  END IF;

  IF problemas <> '' THEN
    RAISE EXCEPTION E'014 aplicou parcialmente:%', problemas;
  END IF;

  RAISE NOTICE '014 conferido: tabela, RLS, 4 policies, UNIQUE, trigger e anon fechado.';
END $$;

-- =====================================================
-- SECAO 8: registro
-- =====================================================
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('014', '014_categorization_rules',
        'Tabela categorization_rules: categoria automatica por estabelecimento na importacao - HMO-145', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
