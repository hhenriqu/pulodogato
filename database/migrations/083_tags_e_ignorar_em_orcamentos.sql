-- ===========================================================================
-- 083 -- TAGS E "IGNORAR EM ORCAMENTOS" NO LANCAMENTO
-- ===========================================================================
-- O pedido (Helio, 06/11/2026, comparando com o app Minhas Financas): o
-- formulario de despesa do Minhas Financas tem "Observacoes e hashtags" (com uma
-- tela de Tags) e os interruptores "Ignorar nos graficos", "Ignorar em
-- Orcamentos", "Ignorar em Economia Mensal", "Ignorar nos totais" e "Ignorar no
-- limite do cartao". O Pulo do Gato ja tinha o "ignorar nos totais"
-- (`include_in_total`, 060). Esta migration traz:
--
--   * `financial_transactions.tags text[]` -- as etiquetas do lancamento, em
--     minusculas e sem `#` (quem normaliza e lib/tags.ts). NOT NULL DEFAULT
--     '{}': o vazio e o caso comum, e um NULL obrigaria todo leitor a um
--     COALESCE. Indice GIN para o filtro `tags @> ARRAY['viagem']`.
--   * `financial_transactions.ignorar_em_orcamentos boolean` -- o lancamento
--     continua nos relatorios e no saldo, mas nao consome o teto da categoria.
--     NOT NULL DEFAULT false: nenhuma linha antiga muda de orcamento.
--   * `budget_consumption` recriada IGUAL a da 063, com uma linha a mais na
--     perna 1: `AND NOT t.ignorar_em_orcamentos`. A perna 2 (o reembolso do que
--     outro pagou) nao ganha o filtro, pelo mesmo motivo do `include_in_total`
--     na 063: o flag e de quem lancou.
--
-- `CREATE OR REPLACE VIEW` apaga as reloptions: o `security_invoker` e
-- reafirmado no fim, como na 063.
--
-- IDEMPOTENTE: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
-- `CREATE OR REPLACE VIEW`.
-- ===========================================================================

BEGIN;

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS ignorar_em_orcamentos boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'financial_transactions_tags_no_maximo_20'
  ) THEN
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_tags_no_maximo_20
      CHECK (cardinality(tags) <= 20);
  END IF;
END $$;

COMMENT ON COLUMN public.financial_transactions.tags IS
  'Etiquetas do lancamento (083), em minusculas e sem #. Normalizadas por lib/tags.ts. No maximo 20.';
COMMENT ON COLUMN public.financial_transactions.ignorar_em_orcamentos IS
  'Ignorar em orcamentos (083): o lancamento nao consome o teto da categoria em budget_consumption, mas continua nos relatorios e no saldo.';

CREATE INDEX IF NOT EXISTS financial_transactions_tags_gin
  ON public.financial_transactions USING gin (tags);

CREATE OR REPLACE VIEW public.budget_consumption AS
  SELECT
    b.id,
    b.user_id,
    b.category_id,
    b.group_id,
    b.month,
    b.amount_limit,
    b.alert_threshold,
    b.carry_forward,
    b.notes,
    b.created_at,
    b.updated_at,
    COALESCE(g.spent, 0)::numeric(15,2) AS spent,
    (b.amount_limit - COALESCE(g.spent, 0))::numeric(15,2) AS remaining,
    ROUND(COALESCE(g.spent, 0) / b.amount_limit, 4) AS consumed_ratio,
    CASE
      WHEN COALESCE(g.spent, 0) >= b.amount_limit THEN 'exceeded'
      WHEN COALESCE(g.spent, 0) >= b.amount_limit * b.alert_threshold THEN 'alert'
      ELSE 'ok'
    END AS consumption_status
  FROM public.budgets b
  LEFT JOIN LATERAL (
    SELECT COALESCE(cheio.v, 0) + COALESCE(reembolso.v, 0) AS spent
    FROM
      -- PERNA 1 -- TUDO O QUE EU LANCEI, pelo valor CHEIO, inclusive a despesa
      -- de grupo que eu paguei. A janela de mes, o ABS() da despesa negativa e
      -- a conversao pela cotacao da propria linha sao os da 026, intocados.
      --
      -- O `AND t.group_id IS NULL` do ramo pessoal SAIU (049): era ele que
      -- apagava do meu teto o que eu mesma paguei pelo grupo. Isto so esta
      -- correto porque a perna 2 descarta `paguei_eu`.
      --
      -- 063: `AND t.include_in_total` -- o lancamento que a pessoa tirou dos
      -- relatorios tambem nao consome o teto da categoria (decisao B da
      -- HMO-443). E a perna 2 NAO ganha o mesmo filtro, de proposito: ver o
      -- bloco "A PERNA 2 NAO E FILTRADA" no cabecalho.
      (
        SELECT SUM(ABS(t.amount) * t.exchange_rate) AS v
        FROM public.financial_transactions t
        WHERE t.category_id = b.category_id
          AND t.transaction_type = 'expense'
          AND t.include_in_total
          -- 083: "Ignorar em orcamentos", como no Minhas Financas.
          AND NOT t.ignorar_em_orcamentos
          AND t.transaction_date >= b.month
          AND t.transaction_date < (b.month + INTERVAL '1 month')::date
          AND CASE
                WHEN b.group_id IS NOT NULL THEN t.group_id = b.group_id
                ELSE t.user_id = b.user_id
              END
      ) AS cheio,

      -- PERNA 2 -- O REEMBOLSO QUE EU DEVO: a minha parte do que OUTRO pagou.
      --
      -- `b.group_id IS NULL` desliga a perna inteira no teto de GRUPO, onde a
      -- perna 1 ja somou a viagem inteira. `NOT e.paguei_eu` tira o que eu
      -- paguei, que a perna 1 ja trouxe cheio.
      --
      -- `e.month` e `date_trunc('month', transaction_date)` desde a 033, e
      -- `b.month` e sempre dia 1 (CHECK do 006): a igualdade recorta o mesmo mes
      -- que a janela da perna 1.
      --
      -- `e.amount` e POSITIVO por construcao (a 033 e explicita: "quem le isto
      -- NAO deve aplicar ABS de novo nem inverter o sinal"), entao aqui nao ha
      -- ABS -- um ABS inofensivo esconderia o dia em que aquela convencao
      -- mudasse.
      --
      -- SEM `t.include_in_total` AQUI (063). O JOIN com
      -- `financial_transactions` existe para pegar a COTACAO da linha, e nao
      -- para herdar o flag dela: o flag e de quem LANCOU, e a minha parte
      -- continua sendo dinheiro que eu devo. Decisao D / secao 3c da HMO-443,
      -- e a secao 3 do teste e quem prende isto.
      (
        SELECT SUM(e.amount * t.exchange_rate) AS v
        FROM public.group_share_entries e
        JOIN public.financial_transactions t ON t.id = e.transaction_id
        WHERE b.group_id IS NULL
          AND e.user_id = b.user_id
          AND e.category_id = b.category_id
          AND e.month = b.month
          AND NOT e.paguei_eu
      ) AS reembolso
  ) AS g ON TRUE;

COMMENT ON VIEW public.budget_consumption IS
  'budgets com o consumido, o que resta e o status (ok/alert/exceeded) calculados na leitura. Criterio de custo da HMO-258 (bruto + minha parte do que outro pagou). A perna do valor cheio ignora o lancamento com include_in_total = false (063) e o com ignorar_em_orcamentos = true (083); a perna do reembolso nao honra nenhum dos dois flags, que sao de quem lancou.';

ALTER VIEW public.budget_consumption SET (security_invoker = true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.budget_consumption FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON public.budget_consumption TO authenticated';
  END IF;
END $$;

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('083', '083_tags_e_ignorar_em_orcamentos',
        'financial_transactions.tags e ignorar_em_orcamentos; budget_consumption ignora o lancamento marcado', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
