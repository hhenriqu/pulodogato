-- =====================================================
-- PULODOGATO - IMPORTACAO DO CSV DO C6 BANK (conta e fatura)
-- =====================================================
-- Migration: 087_importacao_do_c6
-- Spec: issue #447
--
-- O QUE MUDA
-- ----------
-- A area de espera do 009 (statement_imports / statement_entries) passa a
-- guardar o que o CSV do C6 traz alem de data, valor e descricao:
--
--   statement_imports.source         'auto' (OFX/CSV generico, o de sempre),
--                                    'c6_conta' ou 'c6_cartao' -- o usuario diz
--                                    qual arquivo esta mandando
--   statement_imports.invoice_month  o mes da fatura (dia 1), so no cartao
--
--   statement_entries.installment_number / installment_total   a parcela k/N
--   statement_entries.purchase_date   a data da compra original, quando a
--                                     parcela 2+ foi levada para o mes da fatura
--   statement_entries.card_last4      o "Final do Cartão"
--   statement_entries.bank_category   a "Categoria" do C6, so informativa
--   statement_entries.suggested_action  'ignore' no pagamento da fatura
--
-- So ACRESCENTA: todas as colunas sao nullable ou tem default, entao as linhas
-- de importacoes antigas continuam validas sem UPDATE nenhum.
--
-- POR QUE A PARCELA PRECISA DE COLUNA
-- -----------------------------------
-- A deduplicacao entre importacoes (lib/statement.ts,
-- duplicadasEntreImportacoes) compara valor e data. A 5/12 da fatura passada e
-- a 6/12 de agora tem o MESMO valor e, no dia 1 de meses vizinhos, cairiam
-- fora da folga -- mas a parcela 1/2 de uma compra e a 1/3 de outra no mesmo
-- dia, mesmo valor, nao. A parcela na coluna e o que permite dizer "nao e a
-- mesma" sem depender da descricao.
--
-- Idempotente: pode ser colada duas vezes.
-- =====================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.statement_entries') IS NULL OR to_regclass('public.statement_imports') IS NULL THEN
    RAISE EXCEPTION 'A migration 087 nao pode ser aplicada neste banco:%',
      E'\n  - public.statement_imports / statement_entries nao existem (009)';
  END IF;
END $$;

-- -----------------------------------------------------
-- statement_imports
-- -----------------------------------------------------
ALTER TABLE public.statement_imports
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'auto';
ALTER TABLE public.statement_imports
  ADD COLUMN IF NOT EXISTS invoice_month date;

ALTER TABLE public.statement_imports
  DROP CONSTRAINT IF EXISTS statement_imports_source_check;
ALTER TABLE public.statement_imports
  ADD CONSTRAINT statement_imports_source_check
  CHECK (source IN ('auto', 'c6_conta', 'c6_cartao'));

-- Mes da fatura e dia 1, como invoice_month_override (041): e o valor que vai
-- para la quando a linha vira lancamento. E so existe no cartao.
ALTER TABLE public.statement_imports
  DROP CONSTRAINT IF EXISTS statement_imports_invoice_month_check;
ALTER TABLE public.statement_imports
  ADD CONSTRAINT statement_imports_invoice_month_check
  CHECK (
    invoice_month IS NULL
    OR (source = 'c6_cartao' AND invoice_month = date_trunc('month', invoice_month)::date)
  );

COMMENT ON COLUMN public.statement_imports.source IS
  'De onde e o arquivo (087): auto (OFX/CSV generico), c6_conta ou c6_cartao.';
COMMENT ON COLUMN public.statement_imports.invoice_month IS
  'Mes da fatura (dia 1), so em c6_cartao. Vira invoice_month_override do lancamento.';

-- -----------------------------------------------------
-- statement_entries
-- -----------------------------------------------------
ALTER TABLE public.statement_entries
  ADD COLUMN IF NOT EXISTS installment_number integer;
ALTER TABLE public.statement_entries
  ADD COLUMN IF NOT EXISTS installment_total integer;
ALTER TABLE public.statement_entries
  ADD COLUMN IF NOT EXISTS purchase_date date;
ALTER TABLE public.statement_entries
  ADD COLUMN IF NOT EXISTS card_last4 text;
ALTER TABLE public.statement_entries
  ADD COLUMN IF NOT EXISTS bank_category text;
ALTER TABLE public.statement_entries
  ADD COLUMN IF NOT EXISTS suggested_action text;

-- Parcela vem inteira (k e N juntos) e coerente, ou nao vem.
ALTER TABLE public.statement_entries
  DROP CONSTRAINT IF EXISTS statement_entries_installment_check;
ALTER TABLE public.statement_entries
  ADD CONSTRAINT statement_entries_installment_check
  CHECK (
    (installment_number IS NULL AND installment_total IS NULL)
    -- os IS NOT NULL sao explicitos: `3 BETWEEN 1 AND NULL` e NULL, e um CHECK
    -- que da NULL PASSA -- a parcela "3 de nada" entraria.
    OR (installment_number IS NOT NULL AND installment_total IS NOT NULL
        AND installment_number BETWEEN 1 AND installment_total AND installment_total <= 999)
  );

ALTER TABLE public.statement_entries
  DROP CONSTRAINT IF EXISTS statement_entries_suggested_action_check;
ALTER TABLE public.statement_entries
  ADD CONSTRAINT statement_entries_suggested_action_check
  CHECK (suggested_action IS NULL OR suggested_action = 'ignore');

COMMENT ON COLUMN public.statement_entries.installment_number IS
  'k da parcela k/N lida da fatura (087). NULL fora do cartao ou em compra a vista.';
COMMENT ON COLUMN public.statement_entries.purchase_date IS
  'Data da compra original quando a parcela 2+ foi levada para o dia 1 do mes da fatura (087).';
COMMENT ON COLUMN public.statement_entries.suggested_action IS
  'ignore = a linha chega sugerida para cancelar (pagamento da fatura). So sugestao: quem decide e o usuario.';

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('087', '087_importacao_do_c6',
        'Importacao do CSV do C6: origem do arquivo, mes da fatura e parcela/cartao nas linhas do extrato', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
