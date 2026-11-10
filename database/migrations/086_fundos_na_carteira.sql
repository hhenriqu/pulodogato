-- 086_fundos_na_carteira.sql
--
-- O quinto tipo de ativo: FUNDO de investimento (`fund`).
--
-- Ate aqui o CHECK `investment_assets_type_check` (021) aceitava acao, FII,
-- renda fixa e internacional. Um fundo multimercado ou DI -- a linha "Fundos" do
-- extrato do C6 -- nao cabia em nenhum: cadastrado como renda fixa, ele ganharia
-- a projecao do CDI por cima do valor que a pessoa informa (rendimento contado
-- duas vezes); como acao, entraria nos crivos de fundamento e na cotacao da
-- brapi, que nao o conhecem.
--
-- COMO O FUNDO E LANCADO
-- ----------------------
-- Em reais, como a renda fixa (HMO-439): `quantity` = valor aplicado,
-- `unit_price` = 1. O valor de hoje vem do `current_price` informado a mao,
-- que para estes dois tipos e o FATOR sobre o aplicado (valor de hoje / valor
-- aplicado). Ver `lancadoEmReais` em lib/investments.ts. Nenhuma coluna nova.
--
-- O que NAO muda: o cron de cotacao (074) so cota `stock` e `fii`; os seis
-- campos da 031 continuam so em `fixed_income` (CHECK
-- `renda_fixa_so_em_fixed_income`, intocado).
--
-- Idempotente: pode ser colada duas vezes. Cola como lote unico no SQL Editor
-- (nenhum meta-comando de psql aqui).

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.investment_assets') IS NULL THEN
    RAISE EXCEPTION 'A migration 086 nao pode ser aplicada neste banco:%',
      E'\n  - public.investment_assets nao existe (021); e a tabela cujo CHECK esta migration refaz';
  END IF;
END $$;

-- CHECK nao se edita: e refeito com a lista inteira. Tirar um nome daqui faria
-- o primeiro UPDATE de uma linha daquele tipo falhar com 23514.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_type_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_type_check
  CHECK (type IN ('stock', 'fii', 'fixed_income', 'fund', 'international'));

COMMENT ON COLUMN public.investment_assets.type IS
  'stock, fii, fixed_income, fund (086) ou international. fixed_income e fund sao lancados em reais (quantity = valor, unit_price = 1); ver lancadoEmReais em lib/investments.ts.';

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('086', '086_fundos_na_carteira',
        'Abre investment_assets.type para fund (fundos de investimento)', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
