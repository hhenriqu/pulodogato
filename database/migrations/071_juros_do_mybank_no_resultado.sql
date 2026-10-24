-- ===========================================================================
-- 071 -- SO OS JUROS DO MYBANK ENTRAM NO RESULTADO (RN021, fase 5 do modelo novo)
-- ===========================================================================
-- Metade de BANCO do MyBank no modelo novo das movimentacoes (PRD 2.1, RN021,
-- decisao D5). Emprestar nao e gastar, e receber de volta nao e ganhar: o
-- principal de cada parcela e transferencia nos dois lados. So os juros entram
-- no Resultado, receita de quem emprestou e despesa de quem pegou.
--
-- Exemplo: o Helio empresta R$ 1.000 para a Lais em 2x, com 10% de juros. As
-- parcelas sao de R$ 550. Em cada uma, R$ 500 sao principal voltando e R$ 50
-- sao juro. O Resultado do Helio ganha R$ 50 de receita por parcela, e o da
-- Lais ganha R$ 50 de despesa. Os R$ 1.000 nao entram em nenhum dos dois.
--
-- O QUE JA ESTAVA CERTO, E O QUE FALTAVA
-- --------------------------------------
--   * quem EMPRESTOU ja tinha o juro realizado: a confirmacao da parcela grava
--     uma perna `transfer` do principal e uma `income` so do juro, na
--     categoria Investimentos (rota de /api/mybank/installments/[id]);
--   * quem PEGOU nao tinha nada: o dinheiro sai da conta dele para a de outra
--     pessoa, e o app nao grava linha na conta de ninguem por outra pessoa.
--     O juro que ele pagou nao aparecia no Resultado dele;
--   * as previsoes contavam a parcela INTEIRA: o "a receber do MyBank" no
--     previsto de Receitas de quem emprestou, e a parcela devida no previsto
--     de Despesas de quem pegou.
--
-- As previsoes mudam na tela (lib/services/divida-do-mybank.ts). Esta
-- migration da a elas o numero, e da a quem pegou o lado realizado.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
--   SECAO 1  preflight
--   SECAO 2  a categoria reservada "Juros do MyBank"
--   SECAO 3  `mybank_installments.interest_paid`, o juro gravado na baixa
--   SECAO 4  `mybank_installment_interest`: o principal e o juro de cada
--            parcela, pela serie inteira
--   SECAO 5  o trigger que grava o juro quando a parcela e paga
--   SECAO 6  `mybank_interest_entries`: o juro pago por quem pegou, o lado
--            realizado
--   SECAO 7  `personal_category_monthly_totals` ganha a quarta perna
--   SECAO 8  security_invoker e grants
--   SECAO 9  o juro das parcelas que ja foram pagas
--
-- O RATEIO E O MESMO DA CONFIRMACAO
-- --------------------------------
-- A parcela e repartida em principal e juro pela proporcao da serie: a parte
-- do principal e `parcela x principal / soma das parcelas`, arredondada ao
-- centavo, e a ULTIMA parcela fecha a soma (`principal - o que ja foi
-- rateado`). E a conta de `rateioDaSerie` (lib/juros-do-emprestimo.ts), que a
-- rota de confirmacao usa para gravar a perna de juro de quem emprestou. A
-- serie e a do emprestimo inteiro, em todo status, como a rota a le. Sem juro
-- (soma <= principal) a parcela e toda principal. Se a ultima parcela nao
-- couber a sobra, a rota recusa ratear, e a view devolve o juro nulo.
--
-- POR QUE O JURO DA PARCELA PAGA FICA GRAVADO (SECAO 3)
-- ----------------------------------------------------
-- O ajuste do emprestimo (`PATCH /api/mybank/loans/[id]`) muda o valor das
-- parcelas que faltam, e com ele a soma da serie. Recalculado sobre a serie
-- nova, o juro de uma parcela paga mudaria depois de paga: o Resultado de
-- quem pegou mudaria num mes ja fechado, e deixaria de bater com a perna de
-- juro que quem emprestou gravou no dia. Gravado na baixa, ele fica.
--
-- A DATA DO JURO PAGO E A DA BAIXA
-- -------------------------------
-- O realizado entra na data do pagamento e o previsto no vencimento (RN016.3).
-- A data do pagamento e a que quem emprestou confirma (`paid_date`), a mesma
-- da perna de juro dele: os dois lados contam o juro no mesmo dia.
--
-- O EMPRESTIMO A SI MESMO NAO TEM JURO NO RESULTADO (RN021.4)
-- ----------------------------------------------------------
-- O dinheiro nao sai de casa. A view da SECAO 6 o exclui, e quem emprestou a
-- si mesmo nunca teve perna de juro.
--
-- O PASSO HUMANO
-- --------------
-- Colar no SQL Editor do Supabase depois do merge, DEPOIS da 070.
-- Re-executavel. Ela grava o juro das parcelas ja pagas (SECAO 9), e com isso
-- o juro que quem pegou ja pagou passa a aparecer nas Despesas dele, no mes do
-- pagamento.
-- ===========================================================================

BEGIN;

-- ===========================================================================
-- SECAO 1: PREFLIGHT
-- ===========================================================================
DO $$
DECLARE
  v_faltando text := '';
BEGIN
  IF to_regclass('public.mybank_installments') IS NULL THEN
    v_faltando := v_faltando || E'\n  - tabela public.mybank_installments (vem da 053)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mybank_loans'
       AND column_name = 'interest_kind'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna mybank_loans.interest_kind (vem da 062)';
  END IF;

  IF to_regclass('public.group_closing_entries') IS NULL THEN
    v_faltando := v_faltando || E'\n  - view public.group_closing_entries (vem da 069)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'scheduled_transactions'
       AND column_name = 'expense_split_id'
  ) THEN
    v_faltando := v_faltando || E'\n  - coluna scheduled_transactions.expense_split_id (vem da 070)';
  END IF;

  IF v_faltando <> '' THEN
    RAISE EXCEPTION E'071 nao pode ser aplicado neste banco. Faltando:%\n\nRode 001 -> ... -> 070 antes.', v_faltando;
  END IF;
END $$;

-- ===========================================================================
-- SECAO 2: A CATEGORIA RESERVADA DO JURO PAGO
-- ===========================================================================
-- A linha de juro de quem pegou nao e lancamento, e e por esta categoria que o
-- relatorio por categoria a mostra. Inativa para nao aparecer nos seletores,
-- como as reservadas da 067 e da 070.
INSERT INTO public.transaction_categories
  (id, service_id, name, description, icon, color_hex, is_expense, is_active)
SELECT
  '6d9b6e69-43bc-485c-9bbb-d343286d1172',
  '8730cd96-d656-4c48-863e-673e1016a832',
  'Juros do MyBank',
  'Reservada para o juro que quem pegou um empréstimo no MyBank pagou. Não aparece nos seletores.',
  'wallet',
  '#6B7280',
  TRUE,
  FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM public.transaction_categories
   WHERE service_id = '8730cd96-d656-4c48-863e-673e1016a832'
     AND name = 'Juros do MyBank'
);

-- A policy das ativas nao alcanca esta. Sem esta, o relatorio por categoria
-- de quem pegou mostraria o juro sem nome.
DROP POLICY IF EXISTS transaction_categories_read_reservada_do_mybank
  ON public.transaction_categories;
CREATE POLICY transaction_categories_read_reservada_do_mybank
  ON public.transaction_categories
  FOR SELECT TO authenticated
  USING (
    is_active = FALSE
    AND id = '6d9b6e69-43bc-485c-9bbb-d343286d1172'
  );

-- ===========================================================================
-- SECAO 3: O JURO DA PARCELA PAGA, GRAVADO
-- ===========================================================================
-- Nulo enquanto a parcela nao foi paga. Quem escreve e o trigger da SECAO 5,
-- e so ele: ele reescreve a coluna em todo INSERT e UPDATE, entao nenhum
-- cliente consegue gravar um juro. Por isso ela nao entra na lista da trava
-- do devedor (053): ela ja nasce fechada para todo mundo, nao so para ele.
ALTER TABLE public.mybank_installments
  ADD COLUMN IF NOT EXISTS interest_paid numeric(15,2);

COMMENT ON COLUMN public.mybank_installments.interest_paid IS
  'O juro desta parcela, gravado quando ela e paga (071): o mesmo rateio da serie que a confirmacao usa para a perna de juro de quem emprestou. Nulo enquanto nao paga. So o trigger mybank_installments_juro_da_baixa escreve aqui.';

-- ===========================================================================
-- SECAO 4: O PRINCIPAL E O JURO DE CADA PARCELA
-- ===========================================================================
-- Uma linha por parcela, dos DOIS lados do emprestimo: a RLS das duas tabelas
-- entrega a parcela a quem emprestou e a quem pegou, e quem le filtra o lado
-- (`lender_user_id` ou `borrower_user_id`). Os valores em centavos inteiros,
-- como `rateioDaSerie` faz, para o arredondamento ser o mesmo.
--
-- `interest_amount` e o que as leituras somam: o gravado na baixa, na parcela
-- paga, e o da serie de hoje nas outras. `interest_by_series` e o da serie de
-- hoje em todas -- e o que o trigger grava.
--
-- Sem JOIN com financial_accounts nem profiles, pela razao da
-- `mybank_due_entries` (053): a conta credora e de quem emprestou, e a RLS
-- descartaria a linha para quem pegou.
CREATE OR REPLACE VIEW public.mybank_installment_interest AS
  WITH serie AS (
    SELECT
      i.id, i.loan_id, i.installment_number, i.installment_total,
      i.amount, i.due_date, i.status, i.paid_date, i.interest_paid,
      l.lender_user_id, l.borrower_user_id, l.status AS loan_status,
      l.description,
      round(i.amount * 100)::bigint    AS c_parcela,
      round(l.principal * 100)::bigint AS c_principal,
      SUM(round(i.amount * 100)::bigint) OVER (PARTITION BY i.loan_id) AS c_total,
      row_number() OVER (
        PARTITION BY i.loan_id ORDER BY i.installment_number DESC
      ) AS do_fim
    FROM public.mybank_installments i
    JOIN public.mybank_loans l ON l.id = i.loan_id
  ),
  proporcional AS (
    -- A parte do principal de cada parcela que nao e a ultima. A ultima entra
    -- com zero aqui e e calculada no passo seguinte.
    SELECT s.*,
      CASE
        WHEN s.do_fim = 1 THEN 0::bigint
        ELSE round(s.c_parcela::numeric * s.c_principal / s.c_total)::bigint
      END AS c_proporcional
    FROM serie s
  ),
  rateio AS (
    SELECT p.*,
      CASE
        -- Sem juro na serie: a parcela e toda principal.
        WHEN p.c_total <= p.c_principal THEN p.c_parcela
        -- A ultima fecha a soma do principal.
        WHEN p.do_fim = 1 THEN
          p.c_principal - SUM(p.c_proporcional) OVER (PARTITION BY p.loan_id)
        ELSE p.c_proporcional
      END AS c_do_principal
    FROM proporcional p
  ),
  conferido AS (
    -- A ultima pode nao caber a sobra (uma cauda de centavos). A rota recusa
    -- ratear a serie inteira nesse caso, e aqui o juro da serie fica nulo.
    SELECT r.*,
      bool_and(r.c_do_principal BETWEEN 0 AND r.c_parcela)
        OVER (PARTITION BY r.loan_id) AS cabe
    FROM rateio r
  )
  SELECT
    c.id                                              AS id,
    c.loan_id                                         AS loan_id,
    c.lender_user_id                                  AS lender_user_id,
    c.borrower_user_id                                AS borrower_user_id,
    c.loan_status                                     AS loan_status,
    c.description                                     AS description,
    c.installment_number                              AS installment_number,
    c.installment_total                               AS installment_total,
    c.amount                                          AS amount,
    c.due_date                                        AS due_date,
    c.status                                          AS status,
    c.paid_date                                       AS paid_date,
    CASE WHEN c.cabe THEN (c.c_do_principal / 100.0)::numeric(15,2) END
                                                      AS principal_by_series,
    CASE WHEN c.cabe THEN ((c.c_parcela - c.c_do_principal) / 100.0)::numeric(15,2) END
                                                      AS interest_by_series,
    CASE
      WHEN c.status = 'paid' AND c.interest_paid IS NOT NULL THEN c.interest_paid
      WHEN c.cabe THEN ((c.c_parcela - c.c_do_principal) / 100.0)::numeric(15,2)
    END                                               AS interest_amount
  FROM conferido c;

COMMENT ON VIEW public.mybank_installment_interest IS
  'O principal e o juro de cada parcela do MyBank (071), pelo rateio da serie inteira que a confirmacao usa (rateioDaSerie): a parte do principal e parcela x principal / soma das parcelas, ao centavo, e a ultima fecha a soma. interest_amount e o que as leituras somam: o juro gravado na baixa (interest_paid) na parcela paga, o da serie de hoje nas outras. Nulo quando a ultima parcela nao cabe a sobra. Os DOIS lados leem pela RLS das tabelas: quem le filtra lender_user_id ou borrower_user_id. security_invoker.';

-- ===========================================================================
-- SECAO 5: O JURO GRAVADO NA BAIXA
-- ===========================================================================
-- Na passagem para `paid`, o juro da serie de hoje fica na parcela. Paga, ela
-- mantem o que tinha. Fora de `paid`, nulo. No INSERT, nulo tambem: uma
-- parcela que ja nasce paga le o juro da serie pela view.
--
-- BEFORE UPDATE le a serie ANTES da escrita. O juro depende do valor das
-- parcelas e nao do status, e nenhuma rota do app muda o valor e o status da
-- mesma parcela no mesmo UPDATE: a confirmacao e a antecipacao so mexem no
-- status, na data e no elo do pagamento.
--
-- SECURITY DEFINER porque o juro e da serie inteira, e a serie tem de ser lida
-- inteira mesmo que uma policy futura esconda parte dela de quem escreve.
CREATE OR REPLACE FUNCTION public.mybank_installments_juro_da_baixa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM 'paid' THEN
    NEW.interest_paid := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status = 'paid' AND OLD.interest_paid IS NOT NULL THEN
    NEW.interest_paid := OLD.interest_paid;
    RETURN NEW;
  END IF;

  SELECT v.interest_by_series
    INTO NEW.interest_paid
    FROM public.mybank_installment_interest v
   WHERE v.id = NEW.id;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.mybank_installments_juro_da_baixa() IS
  'Grava em mybank_installments.interest_paid o juro da serie no momento em que a parcela vira paid (071), e o mantem enquanto ela continua paga. Fora de paid, e em todo INSERT, nulo. E o unico escritor da coluna: o valor que um cliente mandar e sempre reescrito.';

REVOKE ALL ON FUNCTION public.mybank_installments_juro_da_baixa() FROM PUBLIC;

DROP TRIGGER IF EXISTS mybank_installments_juro_da_baixa ON public.mybank_installments;
CREATE TRIGGER mybank_installments_juro_da_baixa
  BEFORE INSERT OR UPDATE ON public.mybank_installments
  FOR EACH ROW EXECUTE FUNCTION public.mybank_installments_juro_da_baixa();

-- ===========================================================================
-- SECAO 6: O JURO QUE QUEM PEGOU JA PAGOU
-- ===========================================================================
-- O lado realizado de quem pegou, no formato de `group_closing_entries` (069):
-- `amount` POSITIVO, o sinal em `transaction_type`. So a divida da propria
-- sessao (`borrower_user_id = auth.uid()`, como a `mybank_due_entries`): a RLS
-- das tabelas entrega a parcela tambem a quem emprestou, e sem o filtro o juro
-- da Lais entraria na leitura do Helio com o `user_id` dela.
--
-- Sem filtro de status do emprestimo: a parcela paga de um emprestimo
-- quitado, ou cancelado depois, foi dinheiro pago de verdade.
CREATE OR REPLACE VIEW public.mybank_interest_entries AS
  SELECT
    v.id                                              AS id,
    v.borrower_user_id                                AS user_id,
    v.loan_id                                         AS loan_id,
    v.paid_date                                       AS transaction_date,
    date_trunc('month', v.paid_date)::date            AS month,
    '6d9b6e69-43bc-485c-9bbb-d343286d1172'::uuid      AS category_id,
    'expense'::text                                   AS transaction_type,
    'BRL'::text                                       AS currency,
    v.interest_amount                                 AS amount,
    ('Juros: ' || v.description || ' (' || v.installment_number || '/'
      || v.installment_total || ')')                  AS descricao
  FROM public.mybank_installment_interest v
  WHERE v.status = 'paid'
    AND v.borrower_user_id = auth.uid()
    AND v.borrower_user_id IS DISTINCT FROM v.lender_user_id
    AND v.interest_amount > 0;

COMMENT ON VIEW public.mybank_interest_entries IS
  'O juro que EU paguei no MyBank, uma linha por parcela paga (071): o lado REALIZADO da despesa de quem pegou o emprestimo (RN021.3). amount POSITIVO, sinal em transaction_type, data e mes do pagamento (paid_date, a data que quem emprestou confirmou). Exclui o emprestimo a si mesmo e a parcela sem juro. So a divida da sessao (borrower_user_id = auth.uid()). security_invoker.';

-- ===========================================================================
-- SECAO 7: A QUARTA PERNA DO CUSTO PESSOAL
-- ===========================================================================
-- As tres pernas da 069 ficam byte a byte. A quarta e o juro pago do MyBank,
-- por mes, na categoria reservada da SECAO 2. Quem emprestou nao precisa de
-- perna: o juro dele ja e um lancamento `income` (perna 1).
CREATE OR REPLACE VIEW public.personal_category_monthly_totals AS
  WITH tudo AS (
    -- PERNA 1 -- TUDO O QUE EU LANCEI, pelo valor CHEIO (046).
    SELECT
      c.user_id, c.month, c.category_id,
      c.expense, c.income, c.transaction_count, c.currency
    FROM public.category_monthly_totals c

    UNION ALL

    -- PERNA 2 -- A MINHA PARTE DO QUE OUTRO PAGOU (046). Desde a 069 ela nao
    -- traz mais nada de grupo que fecha: ver a SECAO 2.
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
  'CUSTO PESSOAL por categoria, mes e MOEDA: tudo o que EU lancei pelo valor cheio (inclusive despesa de grupo que eu paguei), mais A MINHA PARTE do que OUTRO pagou nos grupos que nao fecham, mais a conta do fechamento do grupo ja quitada (069): Pagamento ao grupo em expense, A receber do grupo em income, mais o juro que eu paguei no MyBank em expense (071). Criterio da HMO-258 (046) com o modelo novo da RN018 e da RN021. Ignora transfer. Quem le PRECISA filtrar user_id: sem isso a RLS de grupo devolve tambem as despesas de grupo dos OUTROS membros, cada uma no user_id de quem pagou.';

-- ===========================================================================
-- SECAO 8: SECURITY_INVOKER E GRANTS
-- ===========================================================================
-- `CREATE OR REPLACE VIEW` APAGA os reloptions (medido na 047 e na 064). Sem
-- estas linhas as views rodariam com o privilegio do dono, e
-- `mybank_installment_interest` devolveria o emprestimo de todo mundo.
ALTER VIEW public.mybank_installment_interest      SET (security_invoker = true);
ALTER VIEW public.mybank_interest_entries          SET (security_invoker = true);
ALTER VIEW public.personal_category_monthly_totals SET (security_invoker = true);

REVOKE ALL ON public.mybank_installment_interest      FROM anon;
REVOKE ALL ON public.mybank_interest_entries          FROM anon;
REVOKE ALL ON public.personal_category_monthly_totals FROM anon;

GRANT SELECT ON public.mybank_installment_interest      TO authenticated;
GRANT SELECT ON public.mybank_interest_entries          TO authenticated;
GRANT SELECT ON public.personal_category_monthly_totals TO authenticated;

-- ===========================================================================
-- SECAO 9: O JURO DAS PARCELAS QUE JA FORAM PAGAS
-- ===========================================================================
-- O trigger da SECAO 5 grava o juro de toda parcela paga que ainda nao o tem.
-- Na segunda colagem nao ha parcela sem o juro, e nada muda. O juro e o da
-- serie de hoje: se um ajuste mudou a serie depois de uma parcela paga, o juro
-- dela pode diferir em centavos da perna que quem emprestou gravou no dia.
UPDATE public.mybank_installments
   SET interest_paid = NULL
 WHERE status = 'paid'
   AND interest_paid IS NULL;

COMMIT;
