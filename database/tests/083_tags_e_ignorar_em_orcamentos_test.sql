-- =====================================================
-- 083 -- TAGS E "IGNORAR EM ORCAMENTOS"
-- =====================================================
-- Prende:
--   * as colunas novas existem com o default que nao muda linha antiga;
--   * o CHECK de no maximo 20 tags;
--   * budget_consumption NAO soma o lancamento com ignorar_em_orcamentos, e
--     continua somando o resto (e continua ignorando o include_in_total = false
--     da 063);
--   * o security_invoker que o CREATE OR REPLACE VIEW apaga.
-- Roda num BEGIN com ROLLBACK.
-- =====================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect(label TEXT, got NUMERIC, want NUMERIC)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

INSERT INTO auth.users (id, email) VALUES
  ('d8300000-0000-0000-0000-0000000000a1', 'ana-083@teste.local');
INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d8300000-0000-0000-0000-0000000000a1', 'Ana 083', FALSE);
INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance)
VALUES ('a8300000-0000-0000-0000-0000000000a1', 'd8300000-0000-0000-0000-0000000000a1',
        'Conta 083', 'checking', 1000);

CREATE TEMP TABLE cat AS
  SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1;

INSERT INTO public.budgets (user_id, category_id, month, amount_limit, alert_threshold)
VALUES ('d8300000-0000-0000-0000-0000000000a1', (SELECT id FROM cat),
        DATE '2026-11-01', 1000, 0.8);

INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, tags, ignorar_em_orcamentos, include_in_total)
VALUES
  ('d8300000-0000-0000-0000-0000000000a1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM cat), 'a8300000-0000-0000-0000-0000000000a1',
   'Mercado', -100, DATE '2026-11-05', 'expense', '{}', FALSE, TRUE),
  ('d8300000-0000-0000-0000-0000000000a1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM cat), 'a8300000-0000-0000-0000-0000000000a1',
   'Presente', -300, DATE '2026-11-06', 'expense', ARRAY['presente','natal'], TRUE, TRUE),
  ('d8300000-0000-0000-0000-0000000000a1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM cat), 'a8300000-0000-0000-0000-0000000000a1',
   'Fora dos totais', -50, DATE '2026-11-07', 'expense', '{}', FALSE, FALSE);

-- Linha sem os campos novos: o default nao muda nada.
INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
VALUES
  ('d8300000-0000-0000-0000-0000000000a1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM cat), 'a8300000-0000-0000-0000-0000000000a1',
   'Antiga', -20, DATE '2026-11-08', 'expense');

SELECT pg_temp.expect('linha sem os campos novos nasce sem tags e contando no orcamento',
  (SELECT count(*) FROM public.financial_transactions
    WHERE description = 'Antiga' AND tags = '{}' AND NOT ignorar_em_orcamentos), 1);

SELECT pg_temp.expect('o orcamento soma 100 + 20 e ignora o presente (083) e o fora dos totais (063)',
  (SELECT spent FROM public.budget_consumption
    WHERE user_id = 'd8300000-0000-0000-0000-0000000000a1'
      AND month = DATE '2026-11-01'), 120);

SELECT pg_temp.expect('o filtro por tag acha o presente',
  (SELECT count(*) FROM public.financial_transactions
    WHERE tags @> ARRAY['natal']), 1);

DO $$
BEGIN
  BEGIN
    UPDATE public.financial_transactions
       SET tags = (SELECT array_agg('t' || g) FROM generate_series(1, 21) g)
     WHERE description = 'Mercado';
    RAISE EXCEPTION 'FALHA: 21 tags passaram pelo CHECK';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: 21 tags recusadas pelo CHECK';
  END;
END $$;

SELECT pg_temp.expect('budget_consumption tem security_invoker depois da 083',
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'budget_consumption'
      AND EXISTS (SELECT 1 FROM unnest(coalesce(c.reloptions, '{}')) AS o(opt)
                   WHERE o.opt ILIKE 'security_invoker=%true%')), 1);

ROLLBACK;
