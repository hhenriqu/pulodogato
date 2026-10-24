-- ===========================================================================
-- 072 -- O CARTAO ENTRA NO RESULTADO PELA FATURA (RN017.3, RN017.4, fase 6)
-- ===========================================================================
-- Ultima fase do modelo novo das movimentacoes (PRD 2.1, decisao D1). A
-- compra no cartao deixa de entrar sozinha em Despesas, no dia da compra. Ela
-- e uma linha da fatura, e a fatura e que conta: no mes do VENCIMENTO dela,
-- realizada quando foi paga.
--
-- Exemplo: o Helio compra R$ 300 no mercado e R$ 90 na farmacia no cartao, em
-- outubro. A fatura de outubro vence em 05/11 e ele a paga em 03/11. O
-- Resultado de outubro nao tem nada do cartao. O de novembro tem R$ 390 de
-- Despesas: R$ 300 em Alimentacao e R$ 90 em Saude, as categorias das compras.
-- Pagar em 30/10 ou em 06/11 nao muda o mes: a fatura e de novembro.
--
-- O QUE JA ESTAVA ASSIM, E O QUE FALTAVA
-- --------------------------------------
--   * a aba Despesas e o painel ja contavam o cartao pela fatura, na data do
--     PAGAMENTO e pelo valor pago (HMO-260, HMO-264, HMO-265);
--   * Financas Pessoais e os relatorios contavam a COMPRA, no dia da compra
--     (HMO-266). As duas leituras davam numeros diferentes para o mesmo mes,
--     e a RN016.4 pede uma so.
--
-- Esta migration da a todas o mesmo numero: `personal_category_monthly_totals`
-- passa a ler o cartao pela fatura paga, no mes do vencimento, aberta nas
-- categorias das compras. As telas leem a mesma view desta migration no modo
-- intervalo e na aba Despesas.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
--   SECAO 1  preflight
--   SECAO 2  `card_invoice_paid_entries`: cada linha de uma fatura PAGA, com o
--            vencimento da fatura
--   SECAO 3  `personal_category_monthly_totals`: a perna 1 sem o cartao, e a
--            quinta perna com a fatura paga
--   SECAO 4  security_invoker e grants
--
-- O MES E O DO VENCIMENTO (RN017.4)
-- --------------------------------
-- O vencimento e o da conta a pagar que o fechamento da fatura gravou
-- (`POST /api/card-invoices/close`), a mesma linha que o previsto da aba
-- Despesas mostra enquanto a fatura esta em aberto. A fatura sai do previsto e
-- entra no realizado no MESMO mes, e o total do mes nao muda com o pagamento.
-- Pela data do pagamento, a fatura paga com atraso mudaria de mes ao ser paga.
--
-- REALIZADA QUANDO E PAGA, PELO TOTAL DAS COMPRAS
-- ----------------------------------------------
-- A fatura e realizada quando a conta a pagar dela esta `paid`. O valor e a
-- soma das linhas dela (`card_invoice_lines`): compra soma, estorno e ajuste
-- negativo abatem. Pagar um valor diferente do total nao muda a despesa: a
-- diferenca fica no saldo do cartao, como divida ou credito, e entra na fatura
-- seguinte quando a pessoa a lanca. Enquanto a fatura nao e paga ela fica no
-- previsto, pelo total, como ja ficava.
--
-- O ESTORNO NO CARTAO E LINHA DA FATURA
-- ------------------------------------
-- O estorno e gravado `income` na conta do cartao, e ate aqui contava como
-- Receita no dia dele. Ele e uma linha da fatura e abate a fatura: a perna 5
-- soma `invoice_amount`, que e positivo na compra e negativo no estorno, e
-- grava o resultado em `expense`. Uma categoria so com estorno numa fatura fica
-- com despesa negativa naquele mes, e o total de Despesas fecha com a fatura.
--
-- A LINHA FORA DOS TOTAIS CONTINUA FORA (060, 061)
-- -----------------------------------------------
-- A fatura do cartao soma a linha desmarcada, para bater com a do banco
-- (Opcao A da HMO-455). O Resultado nao: a perna 5 filtra `include_in_total`,
-- como a perna 1 filtra. Por isso a fatura paga entra no Resultado pelo total
-- das linhas que contam, que pode ser menor que o boleto.
--
-- O QUE NAO MUDA
-- --------------
--   * `category_monthly_totals` e `monthly_cash_flow`: o painel do grupo conta
--     a despesa do grupo no mes em que ela aconteceu, pelo valor cheio;
--   * `card_invoice_lines` e o total da fatura;
--   * o orcamento (`budget_consumption`), que conta a compra no dia dela;
--   * as duas pernas `transfer` do pagamento (015), que movem o saldo.
--
-- O PASSO HUMANO
-- --------------
-- Colar no SQL Editor do Supabase depois do merge, DEPOIS da 071.
-- Re-executavel. So views: nada e gravado, e nenhum lancamento muda.
-- ===========================================================================

BEGIN;

-- ===========================================================================
-- SECAO 1: PREFLIGHT
-- ===========================================================================
DO $$
DECLARE
  v_faltando text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'card_invoice_lines'
       AND column_name = 'include_in_total'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna card_invoice_lines.include_in_total (vem da 061)';
  END IF;

  IF to_regclass('public.group_closing_entries') IS NULL THEN
    v_faltando := v_faltando || E'\n  - view public.group_closing_entries (vem da 069)';
  END IF;

  IF to_regclass('public.mybank_interest_entries') IS NULL THEN
    v_faltando := v_faltando || E'\n  - view public.mybank_interest_entries (vem da 071)';
  END IF;

  IF v_faltando <> '' THEN
    RAISE EXCEPTION E'072 nao pode ser aplicado neste banco. Faltando:%\n\nRode 001 -> ... -> 071 antes.', v_faltando;
  END IF;
END $$;

-- ===========================================================================
-- SECAO 2: CADA LINHA DE UMA FATURA PAGA
-- ===========================================================================
-- Uma linha por linha da fatura (`card_invoice_lines`), so das faturas cuja
-- conta a pagar foi paga. A conta a pagar e achada pela chave canonica que o
-- fechamento grava em `notes` (`fatura:AAAA-MM-01:<cartao>`, lib/chave-da-fatura.ts),
-- do mesmo dono. `lower` porque a chave e montada com o id do banco, que sai
-- minusculo, e a regex do app aceita as duas caixas.
--
-- O LATERAL com LIMIT 1 garante uma conta por fatura. O app nao grava duas
-- contas com a mesma chave (o fechamento e idempotente e o elo da HMO-305
-- recusa a fatura ja fechada), mas a tabela nao tem indice que o impeca, e um
-- JOIN comum contaria a fatura duas vezes. Com duas, vale a que vence antes.
--
-- `currency` vem do lancamento: `card_invoice_lines` nao a publica, e a soma
-- por moeda da SECAO 3 precisa dela na linha.
CREATE OR REPLACE VIEW public.card_invoice_paid_entries AS
  SELECT
    l.transaction_id                        AS id,
    l.user_id,
    l.account_id,
    l.account_name,
    l.invoice_month,
    f.scheduled_id,
    f.invoice_description,
    f.due_date,
    date_trunc('month', f.due_date)::date   AS month,
    f.paid_date,
    l.category_id,
    l.description,
    l.transaction_date,
    l.transaction_type,
    l.invoice_amount,
    t.currency,
    l.include_in_total
  FROM public.card_invoice_lines l
  JOIN public.financial_transactions t ON t.id = l.transaction_id
  JOIN LATERAL (
    SELECT s.id          AS scheduled_id,
           s.description AS invoice_description,
           s.due_date,
           s.paid_date
      FROM public.scheduled_transactions s
     WHERE s.user_id = l.user_id
       AND s.status = 'paid'
       AND lower(s.notes) = 'fatura:' || to_char(l.invoice_month, 'YYYY-MM-DD')
                            || ':' || l.account_id::text
     ORDER BY s.due_date, s.id
     LIMIT 1
  ) f ON TRUE;

COMMENT ON VIEW public.card_invoice_paid_entries IS
  'Cada linha de uma fatura de cartao PAGA (072, RN017.4): a linha de card_invoice_lines com o vencimento (due_date, month) e a baixa (paid_date) da conta a pagar que o fechamento gravou com a chave fatura:AAAA-MM-01:<cartao>. invoice_amount e positivo na compra e negativo no estorno. include_in_total e o do lancamento, sem filtro: quem soma no Resultado filtra. Fatura em aberto nao tem linha aqui. Quem le PRECISA filtrar user_id. security_invoker.';

-- ===========================================================================
-- SECAO 3: O CARTAO NO CUSTO PESSOAL PELA FATURA PAGA
-- ===========================================================================
-- A perna 1 lia `category_monthly_totals`, que soma a compra no cartao no mes
-- da compra. Ela passa a ler `financial_transactions` direto, com os mesmos
-- dois filtros daquela view (`expense`/`income` e `include_in_total`) e sem as
-- linhas da fatura: as `expense`/`income` de conta `credit_card`, o mesmo
-- criterio do WHERE de `card_invoice_lines`. As linhas da fatura voltam pela
-- perna 5, no mes do vencimento, quando a fatura foi paga.
--
-- As pernas 2, 3 e 4 ficam byte a byte.
CREATE OR REPLACE VIEW public.personal_category_monthly_totals AS
  WITH tudo AS (
    -- PERNA 1 -- TUDO O QUE EU LANCEI FORA DO CARTAO, pelo valor CHEIO (046,
    -- 072). Inclui a despesa de grupo que eu paguei.
    SELECT
      t.user_id,
      date_trunc('month', t.transaction_date)::date AS month,
      t.category_id,
      COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'expense'), 0)::numeric(15,2) AS expense,
      COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'income'), 0)::numeric(15,2)  AS income,
      COUNT(*) AS transaction_count,
      t.currency
    FROM public.financial_transactions t
    WHERE t.transaction_type IN ('expense', 'income')
      AND t.include_in_total
      AND NOT EXISTS (
        SELECT 1 FROM public.financial_accounts a
         WHERE a.id = t.account_id
           AND a.account_type = 'credit_card'
      )
    GROUP BY t.user_id, date_trunc('month', t.transaction_date)::date, t.category_id, t.currency

    UNION ALL

    -- PERNA 2 -- A MINHA PARTE DO QUE OUTRO PAGOU (046). Desde a 069 ela nao
    -- traz mais nada de grupo que fecha: ver a SECAO 2 da 069.
    SELECT
      g.user_id, g.month, g.category_id,
      g.expense, g.income, g.transaction_count, g.currency
    FROM public.group_share_category_monthly_totals g
    WHERE NOT g.paguei_eu

    UNION ALL

    -- PERNA 3 (069) -- A CONTA DO FECHAMENTO QUITADA: o que eu paguei ao
    -- grupo em Despesas, o que recebi dele em Receitas.
    SELECT
      f.user_id, f.month, f.category_id,
      CASE WHEN f.transaction_type = 'expense' THEN f.amount ELSE 0 END::numeric(15,2),
      CASE WHEN f.transaction_type = 'income'  THEN f.amount ELSE 0 END::numeric(15,2),
      1::bigint,
      f.currency
    FROM public.group_closing_entries f

    UNION ALL

    -- PERNA 4 (071) -- O JURO QUE EU PAGUEI NO MYBANK, em Despesas.
    SELECT
      j.user_id, j.month, j.category_id,
      j.amount::numeric(15,2),
      0::numeric(15,2),
      1::bigint,
      j.currency
    FROM public.mybank_interest_entries j

    UNION ALL

    -- PERNA 5 (072) -- A FATURA PAGA, no mes do vencimento, aberta nas
    -- categorias das compras. Tudo em Despesas: o estorno abate.
    SELECT
      e.user_id, e.month, e.category_id,
      SUM(e.invoice_amount)::numeric(15,2),
      0::numeric(15,2),
      COUNT(*),
      e.currency
    FROM public.card_invoice_paid_entries e
    WHERE e.include_in_total
    GROUP BY e.user_id, e.month, e.category_id, e.currency
  )
  SELECT
    tudo.user_id,
    tudo.month,
    tudo.category_id,
    SUM(tudo.expense)::numeric(15,2) AS expense,
    SUM(tudo.income)::numeric(15,2)  AS income,
    (SUM(tudo.income) - SUM(tudo.expense))::numeric(15,2) AS net,
    SUM(tudo.transaction_count)      AS transaction_count,
    tudo.currency
  FROM tudo
  GROUP BY tudo.user_id, tudo.month, tudo.category_id, tudo.currency;

COMMENT ON VIEW public.personal_category_monthly_totals IS
  'CUSTO PESSOAL por categoria, mes e MOEDA: tudo o que EU lancei fora do cartao pelo valor cheio (inclusive despesa de grupo que eu paguei), mais A MINHA PARTE do que OUTRO pagou nos grupos que nao fecham, mais a conta do fechamento do grupo ja quitada (069): Pagamento ao grupo em expense, A receber do grupo em income, mais o juro que eu paguei no MyBank em expense (071), mais a fatura do cartao paga, no mes do vencimento, aberta nas categorias das compras, em expense e com o estorno abatendo (072). Criterio da HMO-258 (046) com o modelo novo da RN017 a RN021. Ignora transfer e o lancamento fora dos totais. Quem le PRECISA filtrar user_id: sem isso a RLS de grupo devolve tambem as despesas de grupo dos OUTROS membros, cada uma no user_id de quem pagou.';

-- ===========================================================================
-- SECAO 4: SECURITY_INVOKER E GRANTS
-- ===========================================================================
-- `CREATE OR REPLACE VIEW` APAGA os reloptions (medido na 047 e na 064). Sem
-- estas linhas as views rodariam com o privilegio do dono, e
-- `card_invoice_paid_entries` devolveria a fatura de todo mundo.
ALTER VIEW public.card_invoice_paid_entries        SET (security_invoker = true);
ALTER VIEW public.personal_category_monthly_totals SET (security_invoker = true);

REVOKE ALL ON public.card_invoice_paid_entries        FROM anon;
REVOKE ALL ON public.personal_category_monthly_totals FROM anon;

GRANT SELECT ON public.card_invoice_paid_entries        TO authenticated;
GRANT SELECT ON public.personal_category_monthly_totals TO authenticated;

COMMIT;
