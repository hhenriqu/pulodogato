-- =====================================================
-- 041: a fatura ESCOLHIDA no lancamento
-- =====================================================
-- HMO-281 / HMO-288. PR 1 de 3: SO SCHEMA. Nada de TypeScript, nada de tela.
--
-- O QUE MUDA
-- ----------
-- `financial_transactions` ganha `invoice_month_override date`. Quando ela esta
-- preenchida, a linha cai NAQUELA fatura; quando esta NULA -- que e todo o
-- historico e todo lancamento de hoje -- ela continua caindo pela
-- `card_invoice_month(transaction_date, closing_day)` da 006. NULL significa
-- "cai pela data", entao NAO HA BACKFILL: o comportamento de hoje ja e o
-- default.
--
-- POR QUE ESTA MIGRATION VAI SOZINHA, E ANTES DO CODIGO
-- -----------------------------------------------------
-- `components/movimentacoes/FormularioDeLancamento.tsx` escreve em
-- `financial_transactions` DIRETO pelo supabase-js, do navegador. Se o codigo
-- da PR 2 subir antes de a coluna existir em producao, a ordem invertida nao
-- degrada: o PostgREST responde PGRST204 ("column not found") e DERRUBA TODA
-- despesa no cartao -- inclusive a de quem nunca tocou no campo novo. Deploy
-- leva codigo, nao schema; quem cola esta migration no SQL Editor e uma pessoa.
-- Por isso ela vai primeiro, e sozinha.
--
-- O QUE DELIBERADAMENTE NAO ESTA AQUI
-- -----------------------------------
--   * SEM CHECK CRUZADO com `financial_accounts.account_type`. A regra "so
--     cartao aceita override" so se escreve em SQL como trigger (CHECK nao
--     enxerga outra tabela), e um trigger novo sobre a tabela de dinheiro
--     quebra o app NO AR durante a janela entre a colagem e o deploy da PR 2.
--     Quem recusa override fora do cartao e o formulario e a validacao da rota,
--     na PR 2. O custo de nao ter a trava aqui e uma coluna preenchida que
--     nenhuma view le (a `card_invoice_lines` filtra
--     `account_type = 'credit_card'`) -- inerte, nao errado.
--   * SEM policy nova de RLS. A coluna entra numa tabela que ja e protegida
--     linha a linha pelas policies da 002; coluna nova nao abre linha nova.
--     (Ver a nota do item 3 abaixo, que e sobre a VIEW e e outra historia.)
--   * SEM indice. A view filtra por conta e por mes de fatura, nao por esta
--     coluna; um indice aqui seria peso sem leitor.
--
-- RE-EXECUTAVEL
-- -------------
-- A coluna entra por `ADD COLUMN IF NOT EXISTS`, o CHECK so e criado quando
-- `pg_constraint` nao o tem, e a view entra por `CREATE OR REPLACE`.
--
-- COMO APLICAR EM PRODUCAO
-- ------------------------
-- Colar o arquivo INTEIRO no SQL Editor do Supabase. Nao ha meta-comando de
-- psql aqui de proposito (`\i`, `\set` e afins nao colam no SQL Editor).
-- =====================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A coluna
-- ---------------------------------------------------------------------------
-- `date` e nao `integer`+`integer`: o mes da fatura ja e um `date` no primeiro
-- dia do mes em toda a 006 (`card_invoice_month` devolve exatamente isso, e
-- `card_invoice_due_date` recebe exatamente isso). Guardar ano e mes separados
-- obrigaria a remontar a data em todo lugar que compara, e a primeira
-- remontagem errada seria invisivel.

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS invoice_month_override date;

COMMENT ON COLUMN public.financial_transactions.invoice_month_override IS
  'Fatura ESCOLHIDA pelo usuario para esta compra, como o PRIMEIRO DIA do mes da fatura. NULO = cai pela data (card_invoice_month), que e o comportamento historico. So tem efeito em conta credit_card: a card_invoice_lines filtra por account_type.';

-- ---------------------------------------------------------------------------
-- 2. O dia 1, cravado
-- ---------------------------------------------------------------------------
-- A coluna e um MES, e um `date` nao sabe disso. Sem a trava, '2026-10-15'
-- entra: ele sobrevive ao COALESCE, vira `invoice_month` na view, e a tela
-- passa a ter DUAS faturas de outubro -- a de dia 1 e a de dia 15 --, cada uma
-- com parte das compras e um total que nao e o da fatura. Nada erra; a conta
-- so passa a estar partida em dois numeros plausiveis.
--
-- `IS NULL OR ...` e load-bearing: sem o primeiro ramo o CHECK resultaria NULL
-- para toda linha sem override, e CHECK que resulta NULL ACEITA a linha -- o
-- que aqui seria inofensivo, mas a forma errada e a que se copia depois. A
-- trava vale para o caso em que o override EXISTE.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'financial_transactions_invoice_month_override_dia_1'
       AND conrelid = 'public.financial_transactions'::regclass
  ) THEN
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_invoice_month_override_dia_1
      CHECK (invoice_month_override IS NULL
             OR invoice_month_override = date_trunc('month', invoice_month_override)::date);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. A view passa a respeitar a escolha -- NAS DUAS OCORRENCIAS
-- ---------------------------------------------------------------------------
-- O COALESCE tem de entrar em `invoice_month` E em `invoice_due_date`. Esquecer
-- a segunda e o defeito silencioso do par: a linha aparece na fatura ESCOLHIDA
-- com o vencimento da fatura da DATA. A tela mostra a compra no mes certo, e o
-- "fechar fatura" do 015 gera a conta a pagar com vencimento errado -- um
-- boleto com data de outro mes, sem erro em lugar nenhum.
--
-- O corpo abaixo e o da 035 palavra por palavra, mais os dois COALESCE. Ele e
-- repetido inteiro porque `CREATE OR REPLACE VIEW` nao tem forma incremental, e
-- nenhuma coluna muda de nome, de tipo ou de posicao -- qualquer um dos tres
-- faria o REPLACE falhar com "cannot change name of view column", e a mensagem
-- nao diz qual coluna.

CREATE OR REPLACE VIEW public.card_invoice_lines AS
  SELECT
    t.id                AS transaction_id,
    t.user_id,
    t.account_id,
    a.name              AS account_name,
    a.closing_day,
    a.due_day,
    t.category_id,
    t.description,
    t.amount,
    -- O total da fatura e SUM(invoice_amount), nao SUM(amount). Despesa e
    -- gravada negativa e estorno/pagamento positivo, entao inverter o sinal
    -- aqui faz a compra somar e o estorno abater. Ver a 006.
    (-t.amount) AS invoice_amount,
    t.transaction_date,
    t.transaction_type,
    t.group_id,
    -- 041: a fatura escolhida vence a fatura da data. NULO cai na regra da 006.
    COALESCE(t.invoice_month_override,
             public.card_invoice_month(t.transaction_date, a.closing_day)) AS invoice_month,
    -- 041: e o vencimento acompanha a MESMA fatura. Deixar
    -- `card_invoice_month(...)` cru aqui poe a compra na fatura escolhida com o
    -- vencimento da outra.
    public.card_invoice_due_date(
      COALESCE(t.invoice_month_override,
               public.card_invoice_month(t.transaction_date, a.closing_day)),
      a.closing_day, a.due_day)                                  AS invoice_due_date,
    -- 035: o rotulo "parcela N de M". NULL nas duas em toda compra avulsa.
    t.installment_number,
    t.installment_total
  FROM public.financial_transactions t
  JOIN public.financial_accounts a ON a.id = t.account_id
  WHERE a.account_type = 'credit_card'
    AND t.transaction_type IN ('expense', 'income');

COMMENT ON VIEW public.card_invoice_lines IS
  'Lancamentos de cartao com o mes e o vencimento da fatura em que caem (respeitando invoice_month_override, 041), e o rotulo de parcela (035).';

-- SEM ESTA LINHA A MIGRATION ABRE A FATURA DE TODO MUNDO.
--
-- Ela NAO e defensiva, e LOAD-BEARING -- e isso ja foi MEDIDO (Postgres 17.11,
-- registrado na 035 e em database/validation/01_migrations.sql):
--
--   CREATE TABLE t (a int, b int);
--   CREATE VIEW v AS SELECT a FROM t;
--   ALTER VIEW v SET (security_invoker = true);  -- reloptions {security_invoker=true}
--   CREATE OR REPLACE VIEW v AS SELECT a, b FROM t;
--   SELECT reloptions FROM pg_class WHERE relname = 'v';          -- VAZIO
--
-- `CREATE OR REPLACE VIEW` APAGA as reloptions da view. Sem o ALTER abaixo esta
-- migration -- que tem toda a cara de aditiva e nao fala de permissao em lugar
-- nenhum -- faria `card_invoice_lines` voltar a rodar com o privilegio do DONO:
-- a RLS das tabelas base deixa de se aplicar e a fatura de qualquer usuario vai
-- para qualquer usuario logado, sem erro, so com linhas a mais.
--
-- Quem mexer nesta view de novo: o ALTER tem de vir DEPOIS de todo
-- `CREATE OR REPLACE VIEW`, e nao pode ser apagado por "isso e redundante" --
-- nao e. O mutante `sem_reafirmar_invoker` de
-- scripts/mutantes-fatura-escolhida.mjs existe para que apagar esta linha fique
-- vermelho. Ver a SECAO 7 da 006 e a SECAO 4 da 035.
ALTER VIEW public.card_invoice_lines SET (security_invoker = true);

REVOKE ALL ON public.card_invoice_lines FROM anon;
GRANT SELECT ON public.card_invoice_lines TO authenticated;

COMMIT;
