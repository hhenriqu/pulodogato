-- =====================================================
-- Fixture da 071: uma parcela do MyBank paga ANTES da migration
-- =====================================================
-- Roda no db-verify ANTES da 071, e fica gravada (COMMIT). A suite
-- database/tests/071_juros_do_mybank_no_resultado_test.sql confere, depois
-- da colagem, que a 071 gravou o juro desta parcela (SECAO 9 da migration):
-- e o estado de producao, onde ja ha parcela paga sem a coluna.
--
--   Helio a1 empresta R$ 1.000 para a Lais b1 em 2x de R$ 550 (10% de juros).
--   A parcela 1 foi paga em 10/09/2026, e a confirmacao gravou as duas pernas
--   de quem emprestou: R$ 500 de principal (transfer) e R$ 50 de juro
--   (income), como a rota de /api/mybank/installments/[id] grava.
--   A parcela 2 vence em 10/10/2026 e esta em aberto.
--
-- Rodar num banco com 001 -> ... -> 070 e SEM a 071:
--   psql "$DB_URL" -f database/tests/071_parcela_paga_antes_da_071.sql
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

-- A fixture e de antes da 071. Num banco que ja a tem, a parcela paga nasceria
-- com o juro pelo trigger, e a suite nao mediria a SECAO 9.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mybank_installments'
       AND column_name = 'interest_paid'
  ) THEN
    RAISE EXCEPTION 'Esta fixture e de ANTES da 071: o banco ja tem mybank_installments.interest_paid';
  END IF;
END $$;

INSERT INTO auth.users (id, email) VALUES
  ('a0710000-0000-0000-0000-0000000000a1', 'helio@mybank71.local'),
  ('a0710000-0000-0000-0000-0000000000b1', 'lais@mybank71.local'),
  ('a0710000-0000-0000-0000-0000000000e1', 'leticia@mybank71.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a0710000-0000-0000-0000-0000000000a1', 'Helio', FALSE),
  ('a0710000-0000-0000-0000-0000000000b1', 'Lais', FALSE),
  ('a0710000-0000-0000-0000-0000000000e1', 'Leticia', FALSE);

INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  ('a0710000-0000-0000-0000-0000000000c1', 'a0710000-0000-0000-0000-0000000000a1', 'Investimento do Helio', 'investment'),
  ('a0710000-0000-0000-0000-0000000000c2', 'a0710000-0000-0000-0000-0000000000a1', 'Corrente do Helio', 'checking');

INSERT INTO public.user_connections (requester_id, requested_id, status, responded_at) VALUES
  ('a0710000-0000-0000-0000-0000000000a1', 'a0710000-0000-0000-0000-0000000000b1', 'accepted', now());

INSERT INTO public.mybank_loans
  (id, lender_user_id, lender_account_id, borrower_user_id,
   description, principal, installment_count, first_due_date, interest_rate)
VALUES
  ('a0710000-0000-0000-0000-000000000d01',
   'a0710000-0000-0000-0000-0000000000a1',
   'a0710000-0000-0000-0000-0000000000c1',
   'a0710000-0000-0000-0000-0000000000b1',
   'Moto', 1000.00, 2, DATE '2026-09-10', 0.1);

INSERT INTO public.mybank_installments
  (id, loan_id, installment_number, installment_total, amount, due_date, status, paid_date)
VALUES
  ('a0710000-0000-0000-0000-000000000e01', 'a0710000-0000-0000-0000-000000000d01',
   1, 2, 550.00, DATE '2026-09-10', 'paid', DATE '2026-09-10'),
  ('a0710000-0000-0000-0000-000000000e02', 'a0710000-0000-0000-0000-000000000d01',
   2, 2, 550.00, DATE '2026-10-10', 'pending', NULL);

-- As duas pernas que a confirmacao gravou na conta de investimento do Helio,
-- nas categorias que a rota usa (pelo nome, como ela as acha).
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, notes)
SELECT
  v.id::uuid, 'a0710000-0000-0000-0000-0000000000a1',
  '8730cd96-d656-4c48-863e-673e1016a832', c.id,
  'a0710000-0000-0000-0000-0000000000c1', v.descricao, v.valor,
  DATE '2026-09-10', v.tipo::transaction_financial_type, 'mybank:a0710000-0000-0000-0000-000000000e01'
FROM (VALUES
  ('a0710000-0000-0000-0000-000000000f01', 'Moto (1/2)', 500.00, 'transfer', 'Transferência entre contas'),
  ('a0710000-0000-0000-0000-000000000f02', 'Juros: Moto (1/2)', 50.00, 'income', 'Investimentos')
) AS v(id, descricao, valor, tipo, categoria)
JOIN public.transaction_categories c
  ON c.service_id = '8730cd96-d656-4c48-863e-673e1016a832'
 AND c.name = v.categoria;

COMMIT;
