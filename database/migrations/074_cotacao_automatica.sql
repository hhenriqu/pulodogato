-- 074_cotacao_automatica.sql
--
-- A cotacao da carteira para de ser so digitada na mao: o cron
-- /api/cron/cotacoes (app/api/cron/cotacoes/route.ts) busca na brapi o preco
-- de cada acao e FII em BRL, uma vez por dia util, e grava em
-- `investment_assets.current_price` + `current_price_at` -- as mesmas duas
-- colunas que a tela, a carteira e o rebalanceamento (073) ja leem. Nenhuma
-- coluna nova, nenhuma tela mudada: so outro preenchedor.
--
-- Este arquivo e a retomada da HMO-191 (PR #117, setembro), que tinha o numero
-- 031 e ficou para tras quando a 031 virou a renda fixa indexada. A conta e a
-- leitura da resposta da brapi sao as daquele PR, em lib/cotacao-brapi.ts.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
--   1. Abre o CHECK `cron_runs_job_check` (019, refeito pela 067) para o sexto
--      job, `cotacoes`. Sem isso o cron funciona e responde 200, mas a linha do
--      livro-razao e recusada com 23514 -- e a auditoria leria "nunca rodou",
--      que e exatamente o silencio que a 019 existe para acabar. CHECK nao se
--      edita: e refeito com a lista inteira.
--   2. Atualiza o COMMENT de `investment_assets.current_price`, que desde a 021
--      dizia que nao ha fonte de cotacao.
--
-- Idempotente: pode ser colada duas vezes. Cola como lote unico no SQL Editor
-- (nenhum meta-comando de psql aqui).

BEGIN;

DO $$
DECLARE
  problemas text := '';
BEGIN
  IF to_regclass('public.cron_runs') IS NULL THEN
    problemas := problemas || E'\n  - public.cron_runs nao existe (019); e a tabela cujo CHECK esta migration refaz';
  END IF;
  IF to_regclass('public.investment_assets') IS NULL THEN
    problemas := problemas || E'\n  - public.investment_assets nao existe (021); e a tabela que o cron escreve';
  END IF;
  IF problemas <> '' THEN
    RAISE EXCEPTION 'A migration 074 nao pode ser aplicada neste banco:%', problemas;
  END IF;
END $$;

-- A lista inteira: os cinco da 067 mais `cotacoes`. Tirar um nome daqui faria o
-- job dele perder o registro em silencio.
ALTER TABLE public.cron_runs DROP CONSTRAINT IF EXISTS cron_runs_job_check;
ALTER TABLE public.cron_runs
  ADD CONSTRAINT cron_runs_job_check
  CHECK (job IN (
    'recurrence-scan',
    'recurrence-alerts',
    'bill-alerts',
    'monthly-summary',
    'group-closings',
    'cotacoes'
  ));

COMMENT ON COLUMN public.investment_assets.current_price IS
  'Preco atual do ativo. Desde a 074 o cron /api/cron/cotacoes preenche stock e fii em BRL pela brapi, uma vez por dia util; renda fixa e internacional continuam informados A MAO. NULL = sem preco: a tela mostra a posicao pelo custo e avisa, em vez de fingir lucro zero.';

COMMENT ON COLUMN public.investment_assets.current_price_at IS
  'Quando o preco foi apurado - pelo cron de cotacao (074) ou pela mao do usuario. Anda em par com current_price (CHECK investment_assets_preco_par_check): gravar so um dos dois levanta 23514 e a linha INTEIRA e recusada.';

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('074', '074_cotacao_automatica',
        'Abre cron_runs.job para o job cotacoes (brapi) e atualiza o comentario de investment_assets.current_price', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
