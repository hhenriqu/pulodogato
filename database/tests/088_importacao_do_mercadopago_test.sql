-- =====================================================
-- 088 -- Importacao do Mercado Pago: nova origem do arquivo
-- =====================================================
-- Roda no db-verify, num BEGIN com ROLLBACK.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('88888888-0000-0000-0000-000000000088', 'mp-088@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name) VALUES
  ('88888888-0000-0000-0000-000000000088', 'mp-088@teste.local', 'Importador 088')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  ('88000000-0000-0000-0000-000000000881', '88888888-0000-0000-0000-000000000088', 'Mercado Pago 088', 'digital');

-- O extrato do Mercado Pago entra.
INSERT INTO public.statement_imports (user_id, account_id, file_name, file_format, source) VALUES
  ('88888888-0000-0000-0000-000000000088', '88000000-0000-0000-0000-000000000881',
   'mercadopago.csv', 'csv', 'mercadopago_conta');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.statement_imports
       WHERE account_id = '88000000-0000-0000-0000-000000000881' AND source = 'mercadopago_conta') <> 1 THEN
    RAISE EXCEPTION 'FALHA: o extrato do Mercado Pago nao foi gravado';
  END IF;
  RAISE NOTICE 'ok: origem mercadopago_conta aceita';
END $$;

-- As origens do 087 continuam valendo.
INSERT INTO public.statement_imports (user_id, account_id, file_name, file_format, source) VALUES
  ('88888888-0000-0000-0000-000000000088', '88000000-0000-0000-0000-000000000881', 'c6.csv', 'csv', 'c6_conta'),
  ('88888888-0000-0000-0000-000000000088', '88000000-0000-0000-0000-000000000881', 'x.ofx', 'ofx', 'auto');

-- Origem inventada continua recusada.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.statement_imports (user_id, account_id, file_name, file_format, source)
    VALUES ('88888888-0000-0000-0000-000000000088', '88000000-0000-0000-0000-000000000881', 'x.csv', 'csv', 'mercadopago_cartao');
    RAISE EXCEPTION 'FALHA: origem inventada passou';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: origem inventada recusada';
  END;
END $$;

-- Mes da fatura no extrato do Mercado Pago: recusado pelo CHECK do 087.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.statement_imports (user_id, account_id, file_name, file_format, source, invoice_month)
    VALUES ('88888888-0000-0000-0000-000000000088', '88000000-0000-0000-0000-000000000881', 'x.csv', 'csv', 'mercadopago_conta', '2026-09-01');
    RAISE EXCEPTION 'FALHA: Mercado Pago aceitou mes da fatura';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: mes da fatura so no cartao do C6';
  END;
END $$;

ROLLBACK;
