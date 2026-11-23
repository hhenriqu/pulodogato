-- =====================================================
-- 089 -- As parcelas que a fatura importada nao trouxe
-- =====================================================
-- Roda no db-verify. NAO roda num BEGIN com ROLLBACK, como as outras: a 089
-- tem o BEGIN/COMMIT dela, e e ela mesma que o teste aplica (duas vezes) sobre
-- os dados montados aqui. Os dados sao apagados no fim.

\set ON_ERROR_STOP on

INSERT INTO auth.users (id, email) VALUES
  ('89898989-0000-0000-0000-000000000089', 'parcelas-089@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name) VALUES
  ('89898989-0000-0000-0000-000000000089', 'parcelas-089@teste.local', 'Parcelas 089')
ON CONFLICT (id) DO NOTHING;

-- O cartao C6: fecha 13, vence 20.
INSERT INTO public.financial_accounts (id, user_id, name, account_type, closing_day, due_day) VALUES
  ('89000000-0000-0000-0000-000000000891', '89898989-0000-0000-0000-000000000089', 'C6 089', 'credit_card', 13, 20);

CREATE TEMP TABLE _089_ctx AS
SELECT
  (SELECT id FROM public.financial_services WHERE name = 'personal_finance') AS service_id,
  (SELECT id FROM public.transaction_categories LIMIT 1)                    AS category_id;

-- Duas faturas importadas (outubro e novembro). A placa solar aparece nas
-- duas: 2/10 e 3/10, compra original de 05/09.
INSERT INTO public.statement_imports (id, user_id, account_id, file_name, file_format, source, invoice_month, entry_count, duplicate_count) VALUES
  ('89000000-0000-0000-0000-0000000010aa', '89898989-0000-0000-0000-000000000089', '89000000-0000-0000-0000-000000000891',
   'Fatura_2026-10-20.csv', 'csv', 'c6_cartao', '2026-10-01', 3, 0),
  ('89000000-0000-0000-0000-0000000011aa', '89898989-0000-0000-0000-000000000089', '89000000-0000-0000-0000-000000000891',
   'Fatura_2026-11-20.csv', 'csv', 'c6_cartao', '2026-11-01', 3, 0);

INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type,
   installment_number, installment_total, invoice_month_override)
SELECT v.id::uuid, '89898989-0000-0000-0000-000000000089', c.service_id, c.category_id,
       '89000000-0000-0000-0000-000000000891', v.descricao, v.valor, v.data::date, 'expense',
       v.k, v.n, v.mes::date
  FROM _089_ctx c,
  (VALUES
    -- a placa solar, 2/10 e 3/10
    ('89000000-0000-0000-0000-00000000a002', 'PLACA SOLAR (2/10)', -2200.00, '2026-10-01', 2, 10, '2026-10-01'),
    ('89000000-0000-0000-0000-00000000a003', 'PLACA SOLAR (3/10)', -2200.00, '2026-11-01', 3, 10, '2026-11-01'),
    -- um fone em 3x que acabou em novembro (3/3): nada a criar
    ('89000000-0000-0000-0000-00000000b003', 'FONE (3/3)', -100.00, '2026-11-01', 3, 3, '2026-11-01'),
    -- uma geladeira 5/6, cuja 6/6 ja existe (lancada a mao): nada a criar
    ('89000000-0000-0000-0000-00000000c005', 'GELADEIRA (5/6)', -500.00, '2026-11-01', 5, 6, '2026-11-01')
  ) AS v(id, descricao, valor, data, k, n, mes);

-- A 6/6 da geladeira, lancada a mao (sem linha de extrato).
INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount, transaction_date, transaction_type,
   installment_number, installment_total)
SELECT '89898989-0000-0000-0000-000000000089', c.service_id, c.category_id,
       '89000000-0000-0000-0000-000000000891', 'Geladeira (6/6)', -500.00, '2026-12-01', 'expense', 6, 6
  FROM _089_ctx c;

INSERT INTO public.statement_entries
  (import_id, user_id, account_id, fingerprint, posted_at, amount, description, status, transaction_id,
   installment_number, installment_total, purchase_date)
VALUES
  ('89000000-0000-0000-0000-0000000010aa', '89898989-0000-0000-0000-000000000089', '89000000-0000-0000-0000-000000000891',
   'f-solar-2', '2026-10-01', -2200.00, 'PLACA SOLAR (2/10)', 'imported', '89000000-0000-0000-0000-00000000a002', 2, 10, '2026-09-05'),
  ('89000000-0000-0000-0000-0000000011aa', '89898989-0000-0000-0000-000000000089', '89000000-0000-0000-0000-000000000891',
   'f-solar-3', '2026-11-01', -2200.00, 'PLACA SOLAR (3/10)', 'imported', '89000000-0000-0000-0000-00000000a003', 3, 10, '2026-09-05'),
  ('89000000-0000-0000-0000-0000000011aa', '89898989-0000-0000-0000-000000000089', '89000000-0000-0000-0000-000000000891',
   'f-fone-3', '2026-11-01', -100.00, 'FONE (3/3)', 'imported', '89000000-0000-0000-0000-00000000b003', 3, 3, '2026-08-10'),
  ('89000000-0000-0000-0000-0000000011aa', '89898989-0000-0000-0000-000000000089', '89000000-0000-0000-0000-000000000891',
   'f-gel-5', '2026-11-01', -500.00, 'GELADEIRA (5/6)', 'imported', '89000000-0000-0000-0000-00000000c005', 5, 6, '2026-06-15');

-- A migration, pela primeira vez.
\ir ../migrations/089_parcelas_da_fatura_importada.sql

DO $$
DECLARE
  v_solar int;
  v_meses text;
  v_pai int;
  v_fone int;
  v_gel int;
  v_aberto numeric;
BEGIN
  SELECT count(*), string_agg(to_char(invoice_month, 'YYYY-MM') || '=' || installment_number, ',' ORDER BY installment_number)
    INTO v_solar, v_meses
    FROM public.card_invoice_lines
   WHERE account_id = '89000000-0000-0000-0000-000000000891'
     AND description LIKE 'PLACA SOLAR%' AND installment_number > 3;
  IF v_solar <> 7 THEN
    RAISE EXCEPTION 'FALHA: a placa solar devia ganhar as parcelas 4 a 10 (7), ganhou %', v_solar;
  END IF;
  IF v_meses <> '2026-12=4,2027-01=5,2027-02=6,2027-03=7,2027-04=8,2027-05=9,2027-06=10' THEN
    RAISE EXCEPTION 'FALHA: parcelas nos meses errados: %', v_meses;
  END IF;
  RAISE NOTICE 'ok: 4/10 a 10/10 da placa solar, uma por fatura, de dezembro a junho';

  SELECT count(*) INTO v_pai FROM public.financial_transactions
   WHERE account_id = '89000000-0000-0000-0000-000000000891'
     AND installment_parent_id = '89000000-0000-0000-0000-00000000a003';
  IF v_pai <> 7 THEN
    RAISE EXCEPTION 'FALHA: as parcelas novas deviam apontar para a 3/10 importada (%)', v_pai;
  END IF;
  RAISE NOTICE 'ok: as parcelas novas amarradas a parcela importada';

  SELECT count(*) INTO v_fone FROM public.financial_transactions
   WHERE account_id = '89000000-0000-0000-0000-000000000891' AND description ILIKE 'fone%';
  IF v_fone <> 1 THEN
    RAISE EXCEPTION 'FALHA: a compra que acabou (3/3) ganhou parcela';
  END IF;
  RAISE NOTICE 'ok: a compra na ultima parcela nao ganha nada';

  SELECT count(*) INTO v_gel FROM public.financial_transactions
   WHERE account_id = '89000000-0000-0000-0000-000000000891' AND description ILIKE 'geladeira%';
  IF v_gel <> 2 THEN
    RAISE EXCEPTION 'FALHA: a 6/6 da geladeira ja existia e foi criada de novo (% linhas)', v_gel;
  END IF;
  RAISE NOTICE 'ok: a parcela que ja existe nao se repete';

  -- O TOTAL para quitar le as faturas de dezembro em diante: 7 x 2.200 da
  -- placa + 500 da geladeira.
  SELECT sum(invoice_amount) INTO v_aberto FROM public.card_invoice_lines
   WHERE account_id = '89000000-0000-0000-0000-000000000891' AND invoice_month >= '2026-12-01';
  IF v_aberto <> 15900.00 THEN
    RAISE EXCEPTION 'FALHA: as faturas em aberto deviam somar 15.900,00, somam %', v_aberto;
  END IF;
  RAISE NOTICE 'ok: as faturas de dezembro em diante somam 15.900,00';
END $$;

-- A migration, de novo: nada a criar.
\ir ../migrations/089_parcelas_da_fatura_importada.sql

DO $$
BEGIN
  IF (SELECT count(*) FROM public.financial_transactions
       WHERE account_id = '89000000-0000-0000-0000-000000000891') <> 12 THEN
    RAISE EXCEPTION 'FALHA: a 089 nao e idempotente';
  END IF;
  RAISE NOTICE 'ok: a segunda aplicacao nao cria nada';
END $$;

-- Limpeza.
DELETE FROM public.statement_entries WHERE account_id = '89000000-0000-0000-0000-000000000891';
DELETE FROM public.statement_imports WHERE account_id = '89000000-0000-0000-0000-000000000891';
UPDATE public.financial_transactions SET installment_parent_id = NULL
 WHERE account_id = '89000000-0000-0000-0000-000000000891';
DELETE FROM public.financial_transactions WHERE account_id = '89000000-0000-0000-0000-000000000891';
DELETE FROM public.financial_accounts WHERE id = '89000000-0000-0000-0000-000000000891';
DROP TABLE _089_ctx;
