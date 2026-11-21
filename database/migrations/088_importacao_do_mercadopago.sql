-- =====================================================
-- PULODOGATO - IMPORTACAO DO CSV DO MERCADO PAGO
-- =====================================================
-- Migration: 088_importacao_do_mercadopago
--
-- O QUE MUDA
-- ----------
-- statement_imports.source (087) passa a aceitar 'mercadopago_conta': o
-- extrato da conta do Mercado Pago, lido por lib/extrato-mercadopago.ts.
--
-- So troca o CHECK. Nenhuma linha existente muda, e as origens do 087
-- continuam valendo. O mes da fatura continua so no 'c6_cartao' -- o CHECK
-- statement_imports_invoice_month_check do 087 ja barra o resto.
--
-- Idempotente: pode ser colada duas vezes.
-- =====================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'statement_imports' AND column_name = 'source'
  ) THEN
    RAISE EXCEPTION 'A migration 088 nao pode ser aplicada neste banco:%',
      E'\n  - public.statement_imports.source nao existe (aplique a 087 antes)';
  END IF;
END $$;

ALTER TABLE public.statement_imports
  DROP CONSTRAINT IF EXISTS statement_imports_source_check;
ALTER TABLE public.statement_imports
  ADD CONSTRAINT statement_imports_source_check
  CHECK (source IN ('auto', 'c6_conta', 'c6_cartao', 'mercadopago_conta'));

COMMENT ON COLUMN public.statement_imports.source IS
  'De onde e o arquivo (087/088): auto (OFX/CSV generico), c6_conta, c6_cartao ou mercadopago_conta.';

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('088', '088_importacao_do_mercadopago',
        'Importacao do CSV do Mercado Pago: nova origem do arquivo', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
