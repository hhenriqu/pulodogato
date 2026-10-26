-- 073_rebalanceamento_da_carteira.sql
--
-- O rebalanceamento da carteira, no mesmo desenho da planilha "Rebalanceamento
-- de Carteira" que o Helio usa hoje (aba Controle + aba Setores).
--
-- A CONTA DA PLANILHA, QUE O APP PASSA A FAZER
-- --------------------------------------------
--   % ideal   = peso do ativo / soma dos pesos
--   Quero     = % ideal * (valor da carteira + aporte)
--   Falta     = Quero - Tenho
--   Falta > 0 = "aportar"; senao "aguardar"
--   Cotas     = Falta / preco atual
--
-- A conta mora em lib/rebalanceamento.ts (pura, com suite propria). O que falta
-- no banco sao DOIS dados que so o usuario sabe e que a planilha guarda numa
-- coluna dela:
--
--   target_weight  o peso que ele da ao ativo (a coluna "Nota" da planilha);
--   sector         o setor do ativo (a aba "Setores").
--
-- POR QUE AS DUAS SAO NULAVEIS, SEM DEFAULT E SEM BACKFILL
-- -------------------------------------------------------
-- NULL e "este ativo nao entra no rebalanceamento", e e um estado legitimo e
-- permanente: renda fixa de reserva, um papel que a pessoa esta so
-- acompanhando. Isso e DIFERENTE de peso 0, que e "quero zerar este ativo" -- o
-- OIBR3 da planilha, com nota 0 e quero R$ 0,00. Um DEFAULT 0 apagaria essa
-- diferenca e poria toda a carteira de hoje no "aguardar" no dia da colagem.
--
-- Setor e texto livre, e nao catalogo, pelo mesmo motivo de `investment_assets`
-- ser por usuario (ver o cabecalho da 021): a lista de setores da planilha e a
-- do Helio, e um catalogo fechado deixaria o primeiro setor que faltasse sem
-- jeito de ser escrito.
--
-- RLS: nada a fazer. As quatro policies de `investment_assets` (021) ja prendem
-- leitura e escrita ao dono, e valem para colunas novas.
--
-- Idempotente: pode ser colada duas vezes seguidas sem erro e sem mexer no que
-- a pessoa ja gravou. Cola como lote unico no SQL Editor (nenhum meta-comando de
-- psql aqui).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. PREFLIGHT
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.investment_assets') IS NULL THEN
    RAISE EXCEPTION 'A migration 073 nao pode ser aplicada neste banco:%',
      E'\n  - public.investment_assets nao existe (021); e a tabela que recebe as colunas';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. AS COLUNAS
-- ---------------------------------------------------------------------------
ALTER TABLE public.investment_assets
  ADD COLUMN IF NOT EXISTS target_weight numeric(8,2);

ALTER TABLE public.investment_assets
  ADD COLUMN IF NOT EXISTS sector text;

-- O peso nao e percentual: e a "nota" da planilha, que vai de 0 a 10 la mas
-- nao precisa parar em 10 (o % ideal sai da divisao pela soma). O teto existe
-- para pegar erro de digitacao -- 70000 no lugar de 7,0 -- e nao como regra.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_target_weight_faixa;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_target_weight_faixa
  CHECK (target_weight IS NULL OR (target_weight >= 0 AND target_weight <= 1000));

-- Setor vazio ou com espaco nas pontas viraria uma fatia "" no grafico, ou duas
-- fatias "Saude" e "Saude " com metade do valor em cada.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_sector_texto;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_sector_texto
  CHECK (sector IS NULL OR (btrim(sector) = sector AND length(sector) BETWEEN 1 AND 60));

COMMENT ON COLUMN public.investment_assets.target_weight IS
  'Rebalanceamento (073): peso que o usuario da ao ativo, a coluna "Nota" da planilha. % ideal = peso / soma dos pesos. NULL = fora do rebalanceamento; 0 = quero zerar. Ver o cabecalho da migration 073.';
COMMENT ON COLUMN public.investment_assets.sector IS
  'Rebalanceamento (073): setor do ativo, texto livre do usuario (aba Setores da planilha). NULL = sem setor.';

-- ---------------------------------------------------------------------------
-- 3. REGISTRO
-- ---------------------------------------------------------------------------
INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('073', '073_rebalanceamento_da_carteira',
        'Rebalanceamento da carteira: peso (target_weight) e setor por ativo', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
