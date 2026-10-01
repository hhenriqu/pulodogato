-- 035_parcela_n_de_m.sql
--
-- HMO-211 / HMO-208 Fase 4. "Sobre parcelar, deve ser um checkbox abaixo do
-- valor do cartao e ao clicar perguntar se o valor que esta no input e o da
-- parcela ou total, e em qual parcela aquela se refere de quantas no total."
--
-- Esta migration faz UMA coisa: da ao banco as duas colunas que sustentam o
-- rotulo "parcela 3 de 10", e as expoe na fatura. Ela nao cria tabela, nao
-- mexe em dinheiro gravado e nao toca em trigger nenhum.
--
-- ===========================================================================
-- POR QUE NAO E A `create_installments` QUE MUDA
-- ===========================================================================
-- O plano aprovado da HMO-208 previa "estender a RPC `create_installments` para
-- comecar a serie em N". Ler o codigo mudou a conclusao, e vale registrar o
-- porque -- quem vier depois vai achar a RPC e se perguntar por que ela ficou
-- parada.
--
-- `create_installments` (001) grava em `transaction_installments`, e
-- **`transaction_installments` nao tem leitor nenhum no app**. O unico
-- consumidor da tabela em todo o repositorio era o POST do formulario de
-- lancamento. Parcelar gravava linhas que nao apareciam em Lancamentos, nem em
-- Contas a Pagar, nem na fatura do cartao: a tela salvava e a compra sumia.
-- Fazer aquela RPC comecar em N resolveria a aritmetica e deixaria o defeito de
-- pe -- oito parcelas invisiveis em vez de dez.
--
-- O repositorio ja tinha a resposta escrita em dois lugares:
--
--   lib/offline-queue.ts:183   "Parcelamento vira N transacoes amarradas por
--                               `installment_parent_id`"
--   financial_transactions     a coluna `installment_parent_id` existe desde a
--                              001, e ninguem nunca escreveu nela
--
-- Entao a serie passa a ser materializada onde cada tipo de dinheiro JA tem
-- leitor:
--
--   cartao       -> N linhas em `financial_transactions`. A view
--                   `card_invoice_lines` (006) ja decide o `invoice_month` de
--                   cada linha pelo `transaction_date`, entao as parcelas
--                   aparecem na tela do cartao (HMO-210), na fatura de cada mes
--                   e na lista de Lancamentos sem um leitor novo e sem uma
--                   segunda fonte de verdade para o total da fatura.
--   fora do cartao -> N linhas em `scheduled_transactions` (Contas a Pagar),
--                   que e o lugar honesto para "vou pagar R$ X no dia D". Nao
--                   colide com a HMO-209, que exclui da agenda apenas a
--                   previsao de CARTAO.
--
-- `transaction_installments` fica como esta: cheia de linhas de producao que
-- ninguem le, e sem leitor novo. Apagar a tabela ou migrar aquelas linhas e
-- decisao sobre dinheiro gravado e nao cabe nesta migration -- mas o
-- COMMENT da SECAO 3 passa a dizer isso em voz alta, para que a proxima pessoa
-- nao construa em cima dela de novo.
--
-- ===========================================================================
-- O QUE ESTE ARQUIVO ADICIONA
-- ===========================================================================
--   financial_transactions.installment_number   o N de "parcela N de M"
--   financial_transactions.installment_total    o M
--   CHECK financial_transactions_installment_coerente
--   indice parcial em installment_parent_id
--   card_invoice_lines: as duas colunas, para a tela poder rotular
--   COMMENT em transaction_installments (o aviso de tabela sem leitor)
--
-- IDEMPOTENTE: pode ser colada duas vezes.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. As duas colunas
-- ---------------------------------------------------------------------------
-- NULLABLE, e e isso que torna esta migration segura de colar com o app no ar.
-- Toda linha que existe hoje fica com (NULL, NULL) -- "nao e parcela" -- e todo
-- INSERT que o app faz hoje omite as duas colunas e continua valendo. Nao ha
-- backfill: nao existe informacao de parcelamento em `financial_transactions`
-- para recuperar, e inventar `(1, 1)` para o historico faria toda compra avulsa
-- do passado passar a se chamar "parcela 1 de 1" na tela.

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS installment_number integer;

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS installment_total integer;

COMMENT ON COLUMN public.financial_transactions.installment_number IS
  'O N de "parcela N de M". NULL = nao e parcela. Quem escreve: app/api/financial-installments (HMO-211).';
COMMENT ON COLUMN public.financial_transactions.installment_total IS
  'O M de "parcela N de M". NULL = nao e parcela. Sempre NULL ou NOT NULL junto com installment_number (CHECK).';

-- ---------------------------------------------------------------------------
-- 2. O CHECK, e a razao de ele estar escrito desse jeito exato
-- ---------------------------------------------------------------------------
-- A escrita INTUITIVA deste CHECK esta errada, e erra em silencio:
--
--   CHECK ((installment_number IS NULL AND installment_total IS NULL)
--          OR (installment_number >= 1 AND installment_total >= 2
--              AND installment_number <= installment_total))
--
-- Com `installment_number = 3` e `installment_total = NULL`, o primeiro ramo e
-- FALSE e o segundo contem `NULL >= 2`, que e NULL. `FALSE OR NULL` e NULL --
-- e **um CHECK que resulta NULL ACEITA a linha**. Ou seja: a versao obvia deixa
-- passar exatamente a linha meio-preenchida que ela existe para barrar, e a
-- tela mostraria "parcela 3 de " sem numero nenhum depois do "de".
--
-- A forma abaixo nao tem como resultar NULL: a primeira conjuncao compara dois
-- `IS NULL`, que sao sempre TRUE ou FALSE, e a segunda so avalia a aritmetica
-- quando ja se sabe que as duas colunas estao preenchidas.
--
--   (NULL, NULL)  -> TRUE  = TRUE  -> TRUE  AND (TRUE OR ...)        -> aceita
--   (3, NULL)     -> FALSE = TRUE  -> FALSE                          -> recusa
--   (NULL, 10)    -> TRUE  = FALSE -> FALSE                          -> recusa
--   (3, 10)       -> FALSE = FALSE -> TRUE  AND (FALSE OR TRUE)      -> aceita
--   (12, 10)      -> TRUE AND (FALSE OR FALSE)                       -> recusa
--   (0, 10)       -> TRUE AND (FALSE OR FALSE)                       -> recusa
--
-- `installment_total >= 2` e nao `>= 1`: uma "parcela 1 de 1" e uma compra
-- avulsa com um rotulo a mais, e deixar as duas formas gravaveis criaria duas
-- maneiras de dizer a mesma coisa -- a tela rotularia metade das compras.
--
-- O `DO $$` em volta e porque `ADD CONSTRAINT` nao tem `IF NOT EXISTS`, e sem
-- ele colar a migration de novo aborta a transacao inteira (42710). Mesma forma
-- da 034.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'financial_transactions_installment_coerente'
      AND conrelid = 'public.financial_transactions'::regclass
  ) THEN
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_installment_coerente
      CHECK (
        (installment_number IS NULL) = (installment_total IS NULL)
        AND (
          installment_number IS NULL
          OR (
            installment_number >= 1
            AND installment_total >= 2
            AND installment_number <= installment_total
          )
        )
      );
  END IF;
END $$;

-- O indice que faz a serie ser consultavel. Parcial porque a esmagadora
-- maioria das linhas tem `installment_parent_id` NULL -- indexar o NULL de todo
-- lancamento avulso do historico custaria tamanho sem responder pergunta
-- nenhuma. Ele NAO serve de arbitro de `ON CONFLICT` (indice parcial nunca
-- serve), e nao ha `ON CONFLICT` nenhum neste caminho.
CREATE INDEX IF NOT EXISTS idx_financial_transactions_installment_parent
  ON public.financial_transactions (installment_parent_id)
  WHERE installment_parent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. O aviso na tabela que nao tem leitor
-- ---------------------------------------------------------------------------
-- Escrito como COMMENT e nao como comentario de arquivo de proposito: o
-- COMMENT viaja com o schema e aparece para quem inspeciona o banco, que e
-- onde a proxima pessoa vai olhar antes de construir em cima dela.

COMMENT ON TABLE public.transaction_installments IS
  'SEM LEITOR NO APP. Nenhuma tela, rota ou view le esta tabela: as linhas aqui nao aparecem em Lancamentos, nem em Contas a Pagar, nem na fatura do cartao. A partir da 035 o parcelamento e materializado em financial_transactions (cartao, com installment_number/installment_total) ou em scheduled_transactions (fora do cartao) -- ver app/api/financial-installments. As linhas que ja estao aqui sao dados de producao e nao foram migradas nem apagadas; quem for decidir o que fazer com elas esta mexendo em dinheiro gravado. A RPC create_installments escreve aqui e nao e mais chamada por nada.';

-- ---------------------------------------------------------------------------
-- 4. A fatura passa a carregar o rotulo
-- ---------------------------------------------------------------------------
-- As duas colunas entram no FIM da lista, que e a unica posicao que
-- `CREATE OR REPLACE VIEW` aceita: trocar a ordem ou o tipo de uma coluna que
-- ja existe faz o REPLACE falhar ("cannot change name of view column"), e a
-- mensagem nao diz qual coluna.
--
-- Por que a tela precisa das COLUNAS, e nao da descricao: a descricao gravada e
-- "Notebook (3/10)", e ela e editavel pelo usuario. Tirar o rotulo dali seria
-- parsing de um texto que a pessoa pode reescrever -- e o sintoma de uma
-- descricao renomeada seria o rotulo desaparecer de uma parcela e ficar na
-- vizinha, na mesma fatura.
--
-- O corpo abaixo e o da 006 palavra por palavra, mais as duas colunas. Ele e
-- repetido inteiro porque `CREATE OR REPLACE VIEW` nao tem forma incremental.

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
    public.card_invoice_month(t.transaction_date, a.closing_day) AS invoice_month,
    public.card_invoice_due_date(
      public.card_invoice_month(t.transaction_date, a.closing_day),
      a.closing_day, a.due_day)                                  AS invoice_due_date,
    -- 035: o rotulo "parcela N de M". NULL nas duas em toda compra avulsa.
    t.installment_number,
    t.installment_total
  FROM public.financial_transactions t
  JOIN public.financial_accounts a ON a.id = t.account_id
  WHERE a.account_type = 'credit_card'
    AND t.transaction_type IN ('expense', 'income');

COMMENT ON VIEW public.card_invoice_lines IS
  'Lancamentos de cartao com o mes e o vencimento da fatura em que caem, e o rotulo de parcela (035).';

-- SEM ESTA LINHA A MIGRATION ABRE A FATURA DE TODO MUNDO.
--
-- Ela NAO e defensiva, e LOAD-BEARING -- e isso foi MEDIDO, nao suposto:
--
--   CREATE TABLE t (a int, b int);
--   CREATE VIEW v AS SELECT a FROM t;
--   ALTER VIEW v SET (security_invoker = true);  -- reloptions {security_invoker=true}
--   CREATE OR REPLACE VIEW v AS SELECT a, b FROM t;
--   SELECT reloptions FROM pg_class WHERE relname = 'v';          -- VAZIO
--
-- `CREATE OR REPLACE VIEW` **APAGA as reloptions da view** (medido no Postgres
-- 17.11, e conferido tambem sobre a `card_invoice_lines` de verdade: ela sai da
-- 006 com `{security_invoker=true}` e o REPLACE da SECAO 4 acima a deixa sem
-- opcao nenhuma). Ou seja, sem o ALTER abaixo esta migration -- que nao fala de
-- permissao em lugar nenhum e tem toda a cara de aditiva -- faria
-- `card_invoice_lines` voltar a rodar com o privilegio do DONO: a RLS das
-- tabelas base deixa de se aplicar e a fatura de qualquer usuario vai para
-- qualquer usuario logado, sem erro, so com linhas a mais.
--
-- Quem mexer nesta view de novo: o ALTER tem de vir DEPOIS de todo
-- `CREATE OR REPLACE VIEW`, e nao pode ser apagado por "isso e redundante" --
-- nao e. O mutante `sem_reafirmar_invoker` de
-- scripts/mutantes-parcela-n-de-m.mjs existe para que apagar esta linha fique
-- vermelho. Ver a SECAO 7 da 006.
ALTER VIEW public.card_invoice_lines SET (security_invoker = true);

REVOKE ALL ON public.card_invoice_lines FROM anon;
GRANT SELECT ON public.card_invoice_lines TO authenticated;

COMMIT;
