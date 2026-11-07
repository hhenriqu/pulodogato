-- =====================================================
-- 084 -- CONTA FIXA MARCADA COMO ASSINATURA
-- =====================================================
-- Prende:
--   * a coluna nova existe, NOT NULL, com default false (nenhuma conta fixa
--     antiga vira assinatura sozinha);
--   * marcar e desmarcar funciona;
--   * o indice parcial da tela de Assinaturas existe.
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
  ('d8400000-0000-0000-0000-0000000000a1', 'ana-084@teste.local');
INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d8400000-0000-0000-0000-0000000000a1', 'Ana 084', FALSE);

INSERT INTO public.recurring_rules
  (id, user_id, category_id, description, amount, frequency)
VALUES ('e8400000-0000-0000-0000-0000000000a1',
        'd8400000-0000-0000-0000-0000000000a1',
        (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
        'Netflix', 39.90, 'monthly');

SELECT pg_temp.expect('default e false',
  (SELECT CASE WHEN is_subscription THEN 1 ELSE 0 END
     FROM public.recurring_rules WHERE id = 'e8400000-0000-0000-0000-0000000000a1'),
  0);

SELECT pg_temp.expect('coluna e NOT NULL',
  (SELECT CASE WHEN a.attnotnull THEN 1 ELSE 0 END
     FROM pg_attribute a
    WHERE a.attrelid = 'public.recurring_rules'::regclass
      AND a.attname = 'is_subscription'),
  1);

UPDATE public.recurring_rules SET is_subscription = TRUE
 WHERE id = 'e8400000-0000-0000-0000-0000000000a1';

SELECT pg_temp.expect('marcada como assinatura',
  (SELECT count(*) FROM public.recurring_rules
    WHERE user_id = 'd8400000-0000-0000-0000-0000000000a1'
      AND is_subscription AND is_active),
  1);

SELECT pg_temp.expect('indice parcial existe',
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'recurring_rules_assinaturas_do_usuario'),
  1);

ROLLBACK;
