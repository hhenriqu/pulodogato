-- =====================================================
-- 087 -- Importacao do C6: origem, mes da fatura e parcela nas linhas
-- =====================================================
-- Roda no db-verify, num BEGIN com ROLLBACK.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('c6c6c6c6-0000-0000-0000-000000000087', 'c6-087@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name) VALUES
  ('c6c6c6c6-0000-0000-0000-000000000087', 'c6-087@teste.local', 'Importador 087')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  ('c6000000-0000-0000-0000-000000000871', 'c6c6c6c6-0000-0000-0000-000000000087', 'C6 Cartao 087', 'credit_card');

-- Um import antigo, sem as colunas novas, continua valido: source cai em 'auto'.
INSERT INTO public.statement_imports (id, user_id, account_id, file_name, file_format) VALUES
  ('c6000000-0000-0000-0000-000000000872', 'c6c6c6c6-0000-0000-0000-000000000087',
   'c6000000-0000-0000-0000-000000000871', 'antigo.ofx', 'ofx');

DO $$
BEGIN
  IF (SELECT source FROM public.statement_imports WHERE id = 'c6000000-0000-0000-0000-000000000872') <> 'auto' THEN
    RAISE EXCEPTION 'FALHA: import sem origem nao virou auto';
  END IF;
  RAISE NOTICE 'ok: import antigo vira auto';
END $$;

-- A fatura do C6 com o mes no dia 1.
INSERT INTO public.statement_imports (id, user_id, account_id, file_name, file_format, source, invoice_month) VALUES
  ('c6000000-0000-0000-0000-000000000873', 'c6c6c6c6-0000-0000-0000-000000000087',
   'c6000000-0000-0000-0000-000000000871', 'Fatura_2026-11-20.csv', 'csv', 'c6_cartao', '2026-11-01');

-- A parcela 6/12 com a data da compra original guardada, e o pagamento sugerido
-- para cancelar.
INSERT INTO public.statement_entries
  (import_id, user_id, account_id, fingerprint, posted_at, amount, description,
   installment_number, installment_total, purchase_date, card_last4, bank_category, suggested_action) VALUES
  ('c6000000-0000-0000-0000-000000000873', 'c6c6c6c6-0000-0000-0000-000000000087',
   'c6000000-0000-0000-0000-000000000871', 'h|parcela', '2026-11-01', -50.82, 'LOJA (6/12)',
   6, 12, '2026-05-26', '1111', 'Servicos', NULL),
  ('c6000000-0000-0000-0000-000000000873', 'c6c6c6c6-0000-0000-0000-000000000087',
   'c6000000-0000-0000-0000-000000000871', 'h|pagamento', '2026-10-19', 9063.51, 'Inclusao de Pagamento',
   NULL, NULL, NULL, '2222', NULL, 'ignore');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.statement_entries
       WHERE import_id = 'c6000000-0000-0000-0000-000000000873') <> 2 THEN
    RAISE EXCEPTION 'FALHA: as duas linhas da fatura nao foram gravadas';
  END IF;
  RAISE NOTICE 'ok: parcela e pagamento gravados';
END $$;

-- Origem inventada: recusada.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.statement_imports (user_id, account_id, file_name, file_format, source)
    VALUES ('c6c6c6c6-0000-0000-0000-000000000087', 'c6000000-0000-0000-0000-000000000871', 'x.csv', 'csv', 'nubank');
    RAISE EXCEPTION 'FALHA: origem inventada passou';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: origem inventada recusada';
  END;
END $$;

-- Mes da fatura fora do dia 1: recusado (vira invoice_month_override, que exige dia 1).
DO $$
BEGIN
  BEGIN
    INSERT INTO public.statement_imports (user_id, account_id, file_name, file_format, source, invoice_month)
    VALUES ('c6c6c6c6-0000-0000-0000-000000000087', 'c6000000-0000-0000-0000-000000000871', 'x.csv', 'csv', 'c6_cartao', '2026-11-20');
    RAISE EXCEPTION 'FALHA: mes da fatura no dia 20 passou';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: mes da fatura so no dia 1';
  END;
END $$;

-- Mes da fatura no extrato da conta: recusado.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.statement_imports (user_id, account_id, file_name, file_format, source, invoice_month)
    VALUES ('c6c6c6c6-0000-0000-0000-000000000087', 'c6000000-0000-0000-0000-000000000871', 'x.csv', 'csv', 'c6_conta', '2026-11-01');
    RAISE EXCEPTION 'FALHA: conta corrente aceitou mes da fatura';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: mes da fatura so no cartao';
  END;
END $$;

-- Parcela pela metade ou impossivel: recusada.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.statement_entries (import_id, user_id, account_id, fingerprint, posted_at, amount, description, installment_number)
    VALUES ('c6000000-0000-0000-0000-000000000873', 'c6c6c6c6-0000-0000-0000-000000000087',
            'c6000000-0000-0000-0000-000000000871', 'h|meia', '2026-11-01', -10, 'X', 3);
    RAISE EXCEPTION 'FALHA: parcela sem total passou';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: parcela sem total recusada';
  END;

  BEGIN
    INSERT INTO public.statement_entries (import_id, user_id, account_id, fingerprint, posted_at, amount, description, installment_number, installment_total)
    VALUES ('c6000000-0000-0000-0000-000000000873', 'c6c6c6c6-0000-0000-0000-000000000087',
            'c6000000-0000-0000-0000-000000000871', 'h|13de12', '2026-11-01', -10, 'X', 13, 12);
    RAISE EXCEPTION 'FALHA: parcela 13/12 passou';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: parcela 13/12 recusada';
  END;
END $$;

-- Acao sugerida so pode ser 'ignore'.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.statement_entries (import_id, user_id, account_id, fingerprint, posted_at, amount, description, suggested_action)
    VALUES ('c6000000-0000-0000-0000-000000000873', 'c6c6c6c6-0000-0000-0000-000000000087',
            'c6000000-0000-0000-0000-000000000871', 'h|acao', '2026-11-01', -10, 'X', 'import');
    RAISE EXCEPTION 'FALHA: acao sugerida import passou';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: so ignore como acao sugerida';
  END;
END $$;

ROLLBACK;
