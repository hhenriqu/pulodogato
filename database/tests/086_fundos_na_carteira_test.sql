-- =====================================================
-- 086 -- Fundos na carteira: `fund` passa, tipo inventado continua barrado
-- =====================================================
-- Roda no db-verify, num BEGIN com ROLLBACK.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('c6c6c6c6-0000-0000-0000-000000000086', 'fundo-086@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name) VALUES
  ('c6c6c6c6-0000-0000-0000-000000000086', 'fundo-086@teste.local', 'Investidor 086')
ON CONFLICT (id) DO NOTHING;

-- O fundo passa, lancado em reais (quantity = valor, unit_price = 1) e com o
-- fator do valor de hoje no preco.
INSERT INTO public.investment_assets
  (id, user_id, symbol, name, type, current_price, current_price_at) VALUES
  ('d6000000-0000-0000-0000-000000000086', 'c6c6c6c6-0000-0000-0000-000000000086',
   'C6-FUNDOS', 'Fundos C6', 'fund', 1.00039322, now());

INSERT INTO public.investment_transactions
  (user_id, asset_id, kind, quantity, unit_price, trade_date) VALUES
  ('c6c6c6c6-0000-0000-0000-000000000086', 'd6000000-0000-0000-0000-000000000086',
   'buy', 5213.46, 1, CURRENT_DATE);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.investment_assets WHERE symbol = 'C6-FUNDOS' AND type = 'fund') <> 1 THEN
    RAISE EXCEPTION 'FALHA: o fundo nao foi gravado';
  END IF;
  RAISE NOTICE 'ok: fund aceito';
END $$;

-- Tipo fora da lista continua recusado.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.investment_assets (user_id, symbol, name, type)
    VALUES ('c6c6c6c6-0000-0000-0000-000000000086', 'CRIPTO', 'Cripto', 'crypto');
    RAISE EXCEPTION 'FALHA: tipo crypto passou pelo CHECK';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: tipo inventado recusado';
  END;
END $$;

-- Fundo nao carrega os campos de renda fixa (031 intocada).
DO $$
BEGIN
  BEGIN
    UPDATE public.investment_assets SET index_kind = 'cdi', index_percentage = 100
     WHERE id = 'd6000000-0000-0000-0000-000000000086';
    RAISE EXCEPTION 'FALHA: fundo aceitou indexador';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: fundo sem indexador';
  END;
END $$;

ROLLBACK;
