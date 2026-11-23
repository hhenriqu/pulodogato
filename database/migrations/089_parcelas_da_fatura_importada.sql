-- =====================================================
-- PULODOGATO - AS PARCELAS QUE A FATURA IMPORTADA NAO TROUXE
-- =====================================================
-- Migration: 089_parcelas_da_fatura_importada
--
-- O DEFEITO
-- ---------
-- A fatura do C6 traz a compra parcelada como UMA linha: a parcela do mes
-- ("PLACA SOLAR (3/10)"). O import (087) gravava so essa linha. As parcelas
-- seguintes nao existiam em lugar nenhum: a fatura dos meses seguintes nao as
-- mostrava, o saldo do cartao nao as contava, e o TOTAL para quitar os cartoes
-- (docs/COMPOSICAO-DA-FATURA.md, RN004.13) saiu com R$ 10 mil quando so uma
-- placa solar parcelada no cartao passava de R$ 22 mil.
--
-- Desde esta versao, importar a parcela k/N cria junto as k+1..N
-- (app/api/statements/entries/[id]/route.ts, lib/parcelas-da-fatura-importada.ts),
-- como a compra parcelada lancada a mao ja fazia (POST /api/financial-installments).
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
-- Completa as compras parceladas JA importadas. Para cada serie importada da
-- fatura do C6 -- mesma conta, mesma descricao sem o " (k/N)", mesmo N, mesmo
-- valor e mesma data de compra original -- pega a parcela de numero mais alto
-- e cria as que faltam ate N:
--
--   * uma linha por mes de fatura, no dia 1, com invoice_month_override;
--   * a mesma categoria, subcategoria, valor e include_in_total da parcela;
--   * installment_parent_id apontando para a parcela importada.
--
-- Nao cria a parcela que ja existe (a serie lancada a mao, ou uma importacao
-- seguinte), nem preenche buraco ANTES da ultima parcela conhecida: essas sao
-- faturas passadas, ja pagas fora do app.
--
-- O SALDO DO CARTAO desce pelo valor das parcelas criadas (o trigger de saldo
-- soma cada INSERT), como na compra parcelada lancada a mao: no cartao, o saldo
-- e a divida inteira.
--
-- Idempotente: colada duas vezes, a segunda nao acha nada para criar.
-- Para ver ANTES o que vai ser criado, rode so o SELECT da secao 1.
-- =====================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'statement_entries' AND column_name = 'purchase_date'
  ) THEN
    RAISE EXCEPTION 'A migration 089 nao pode ser aplicada neste banco:%',
      E'\n  - public.statement_entries.purchase_date nao existe (aplique a 087 antes)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- SECAO 1: as series importadas e a ultima parcela conhecida de cada uma
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _089_ultimas ON COMMIT DROP AS
WITH importadas AS (
  SELECT
    t.id,
    t.user_id,
    t.service_id,
    t.account_id,
    t.category_id,
    t.subcategory_id,
    t.include_in_total,
    t.description,
    t.amount,
    t.transaction_type,
    t.installment_number AS k,
    t.installment_total  AS n,
    COALESCE(t.invoice_month_override,
             public.card_invoice_month(t.transaction_date, a.closing_day)) AS mes,
    COALESCE(e.purchase_date, e.posted_at)                               AS compra,
    lower(regexp_replace(t.description, '\s*\(\s*\d+\s*/\s*\d+\s*\)\s*$', ''))   AS serie
  FROM public.financial_transactions t
  JOIN public.financial_accounts a ON a.id = t.account_id AND a.account_type = 'credit_card'
  JOIN public.statement_entries e  ON e.transaction_id = t.id
  JOIN public.statement_imports i  ON i.id = e.import_id AND i.source = 'c6_cartao'
  WHERE t.installment_total > 1
    AND t.installment_number BETWEEN 1 AND t.installment_total
    AND t.transaction_type IN ('expense', 'income')
)
SELECT DISTINCT ON (account_id, serie, n, amount, compra) *
  FROM importadas
 ORDER BY account_id, serie, n, amount, compra, k DESC;

-- ---------------------------------------------------------------------------
-- SECAO 2: as parcelas que faltam
-- ---------------------------------------------------------------------------
INSERT INTO public.financial_transactions (
  user_id, service_id, account_id, category_id, subcategory_id, include_in_total,
  description, amount, transaction_date, transaction_type,
  installment_number, installment_total, invoice_month_override, installment_parent_id
)
SELECT
  u.user_id, u.service_id, u.account_id, u.category_id, u.subcategory_id,
  COALESCE(u.include_in_total, true),
  regexp_replace(u.description, '\s*\(\s*\d+\s*/\s*\d+\s*\)\s*$', '') || ' (' || g.j || '/' || u.n || ')',
  u.amount,
  (u.mes + make_interval(months => g.j - u.k))::date,
  u.transaction_type,
  g.j,
  u.n,
  (u.mes + make_interval(months => g.j - u.k))::date,
  u.id
FROM _089_ultimas u
CROSS JOIN LATERAL generate_series(u.k + 1, u.n) AS g(j)
WHERE u.k < u.n
  AND NOT EXISTS (
    SELECT 1
      FROM public.financial_transactions x
     WHERE x.account_id = u.account_id
       AND x.installment_total = u.n
       AND x.installment_number = g.j
       AND x.amount = u.amount
       AND lower(regexp_replace(x.description, '\s*\(\s*\d+\s*/\s*\d+\s*\)\s*$', '')) = u.serie
  );

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('089', '089_parcelas_da_fatura_importada',
        'Completa as compras parceladas importadas da fatura do C6 com as parcelas que faltam', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
