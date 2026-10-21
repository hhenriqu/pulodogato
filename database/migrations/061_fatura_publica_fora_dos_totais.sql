-- ===========================================================================
-- 061 -- A FATURA PUBLICA `include_in_total` (HMO-459, filha da HMO-455)
-- ===========================================================================
-- SO SQL. Nenhum TypeScript, nenhuma tela -- o selo "fora dos totais" e o
-- botao de alternar na linha da fatura vem na F2b, DEPOIS desta colagem.
--
-- O QUE MUDA
-- ----------
-- Uma coluna a mais na PROJECAO da view `public.card_invoice_lines`:
-- `t.include_in_total`, a coluna que a 060 criou em
-- `financial_transactions`. Nada mais. Nenhuma tabela e tocada, nenhum
-- filtro muda, nenhum numero muda.
--
-- POR QUE PRECISA DE MIGRATION PARA ISSO
-- --------------------------------------
-- A tela `/dashboard/cartoes/[id]` le as linhas da fatura pela view, nao pela
-- tabela. A view nao publica `include_in_total`, entao a tela nao tem como
-- saber quais linhas estao desmarcadas: nem para pintar o selo, nem para
-- decidir se o botao de alternar mostra "tirar dos totais" ou "voltar para os
-- totais". A F2b nao tem o que renderizar sem esta colagem.
--
-- ===========================================================================
-- O TOTAL DA FATURA CONTINUA INTEIRO -- E ISSO E A DECISAO, NAO UM ESQUECIMENTO
-- ===========================================================================
-- ESTA MIGRATION **NAO** ACRESCENTA `AND t.include_in_total` AO `WHERE` DA
-- VIEW. Quem ler o diff ao lado do da 060 vai estranhar: la a mesma coluna
-- entrou como FILTRO em `category_monthly_totals`, aqui ela entra so como
-- COLUNA. A diferenca e deliberada e foi decidida pelo Helio -- Opcao A do
-- cartao de decisao da HMO-455 (interaction `1a40529a`, respondida em
-- 2026-10-21):
--
--   desconsiderar uma compra do cartao tira a linha **so dos relatorios**;
--   o total da FATURA continua somando a linha.
--
-- A razao e que a fatura do app tem de bater com a fatura do BANCO. O dinheiro
-- da compra vai ser cobrado pela operadora de qualquer jeito -- desmarcar um
-- lancamento e dizer "isto nao e gasto meu para efeito de relatorio", nao
-- "isto nao vou pagar". Uma fatura que esconde a linha desmarcada mostra um
-- total menor do que o boleto, e a pessoa paga confiando no numero errado.
--
-- Onde o desmarcado JA sai de verdade: a cadeia de cinco views que a 060
-- filtrou (`category_monthly_totals` e os quatro rollups dela). Essa parte ja
-- esta em producao e nao e mexida aqui.
--
-- **Para quem mexer nesta view no futuro:** acrescentar o filtro aqui e uma
-- mudanca de PRODUTO, nao um conserto -- e ela reprova a SECAO 3 do
-- `061_*_test.sql`, que mede o total da fatura com a linha desmarcada dentro.
-- Se a decisao mudar, muda-se o teste junto e com a issue na mao.
--
-- ===========================================================================
-- A COLUNA ENTRA NO FIM DA PROJECAO, E NAO PODE SER EM OUTRO LUGAR
-- ===========================================================================
-- `CREATE OR REPLACE VIEW` so sabe ACRESCENTAR coluna no fim. Mover
-- `include_in_total` para o meio do SELECT -- ao lado de `amount`, que e onde
-- ela faria sentido para quem le -- faz o REPLACE falhar com "cannot change
-- name of view column", e a mensagem nao diz qual coluna. Por isso ela vai
-- depois de `installment_total`, que era a ultima desde a 035.
--
-- O corpo abaixo e o da 041 palavra por palavra (os dois COALESCE do
-- `invoice_month`/`invoice_due_date`, o `-t.amount` do `invoice_amount`, o
-- rotulo de parcela da 035), mais a linha nova no fim. Ele e repetido inteiro
-- porque `CREATE OR REPLACE VIEW` nao tem forma incremental -- e e justamente
-- essa obrigacao que faz migration de view REVERTER migration de view sem
-- sintoma (`create-or-replace-view-de-pr-aberto-reverte-migration-mergeada`).
-- Por isso o db-verify re-roda o teste da 041 DEPOIS deste arquivo: se alguem
-- recolar este corpo a partir da versao da 035, os dois COALESCE somem e a
-- compra volta a vencer no mes errado, calada.
--
-- ===========================================================================
-- `security_invoker`: O ALTER DO FIM NAO E REDUNDANTE
-- ===========================================================================
-- `CREATE OR REPLACE VIEW` **APAGA as reloptions** da view -- MEDIDO no
-- Postgres 17.11 e registrado na 035, na 041 e na 060
-- (`create-or-replace-view-apaga-reloptions`):
--
--   CREATE TABLE t (a int, b int);
--   CREATE VIEW v AS SELECT a FROM t;
--   ALTER VIEW v SET (security_invoker = true);  -- reloptions {security_invoker=true}
--   CREATE OR REPLACE VIEW v AS SELECT a, b FROM t;
--   SELECT reloptions FROM pg_class WHERE relname = 'v';          -- VAZIO
--
-- Sem o `ALTER VIEW ... SET (security_invoker = true)` do fim deste arquivo, a
-- `card_invoice_lines` volta a rodar com o privilegio do DONO, a RLS de
-- `financial_transactions` deixa de se aplicar, e **a fatura de qualquer
-- usuario vai para qualquer usuario logado**. A falha e CALADA: num banco de
-- um usuario so, uma view DEFINER devolve exatamente as mesmas linhas que uma
-- view INVOKER, nenhum numero muda e nenhuma suite fica vermelha por conta
-- propria. E o diff desta migration tem toda a cara de aditiva -- ela nao fala
-- de permissao em lugar nenhum a nao ser aqui.
--
-- Esta e a terceira vez que a mesma linha e reafirmada nesta mesma view (006,
-- 035, 041, 060 na sua, e agora a 061). Ela NAO e precaucao, e load-bearing, e
-- quem a apagar por "isso ja esta ligado" reabre o furo.
--
-- **O ALTER E A ULTIMA INSTRUCAO DO ARQUIVO, DE PROPOSITO.** Como o REPLACE
-- apaga a opcao, ler `security_invoker=true` **junto com** a coluna nova na
-- view so e possivel se a execucao passou da ultima linha: se a colagem tiver
-- parado no meio, a view existe completa e *sem* a opcao. Um sinal, dois
-- fatos -- "chegou ao fim" e "o furo nao esta aberto" -- e mais forte que
-- sondar um COMMENT, que se faltar e so cosmetico
-- (`migration-colada-pela-metade-e-invisivel`).
--
-- ===========================================================================
-- IDEMPOTENTE
-- ===========================================================================
-- `CREATE OR REPLACE VIEW`, `COMMENT`, `REVOKE`, `GRANT` e
-- `ALTER VIEW ... SET` sao todos re-aplicaveis. Re-rodar o arquivo inteiro e
-- no-op -- e o risco proprio da segunda passada e o REPLACE, que nao pode
-- quebrar por a coluna ja estar no fim do SELECT nem derrubar a reloption. O
-- db-verify cola este arquivo duas vezes antes de rodar o teste, e e por isso
-- que a medida de `security_invoker` do teste vale para o re-run tambem.
--
-- ===========================================================================
-- ORDEM: ESTA COLAGEM VEM ANTES DO DEPLOY DA F2b
-- ===========================================================================
-- O codigo da F2b NOMEIA `include_in_total` no `.select()` da tela do cartao.
-- Rodar esse codigo contra um banco sem a coluna na view responde 42703 pelo
-- PostgREST e DERRUBA a tela inteira -- nao so o selo
-- (`select-que-nomeia-coluna-nova-derruba-a-rota-antes-da-colagem`). Deploy
-- leva codigo, nao schema. Entao: cola isto primeiro, publica a F2b depois.
--
-- A ordem inversa (esta colagem ANTES do codigo) e inofensiva: o codigo em
-- producao hoje nao le a coluna, e nenhum numero muda com ela publicada.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A view, com `include_in_total` no fim da projecao
-- ---------------------------------------------------------------------------
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
    t.installment_total,
    -- 061: a linha diz se ela entra nos RELATORIOS (060). Ela e publicada para
    -- a tela poder pintar o selo e saber o estado do botao -- e NAO entra no
    -- `WHERE` abaixo: o total da fatura soma a linha desmarcada do mesmo jeito,
    -- para a fatura do app continuar batendo com a do banco (Opcao A da
    -- HMO-455). Ver o cabecalho.
    t.include_in_total
  FROM public.financial_transactions t
  JOIN public.financial_accounts a ON a.id = t.account_id
  WHERE a.account_type = 'credit_card'
    AND t.transaction_type IN ('expense', 'income');

COMMENT ON VIEW public.card_invoice_lines IS
  'Lancamentos de cartao com o mes e o vencimento da fatura em que caem (respeitando invoice_month_override, 041), o rotulo de parcela (035) e o include_in_total da linha (061). O include_in_total e PUBLICADO e nao FILTRADO: o total da fatura soma a linha desmarcada, porque a fatura do app tem de bater com a do banco -- quem tira o desmarcado das somas e a cadeia de category_monthly_totals (060).';

COMMENT ON COLUMN public.card_invoice_lines.include_in_total IS
  'HMO-459: o include_in_total do proprio lancamento (060), repassado sem filtro. FALSE = a pessoa tirou esta compra dos relatorios; a linha continua na fatura e continua somando no total dela.';

-- Declarativos, e re-aplicaveis. Estao aqui porque um REPLACE que mexesse no
-- ACL da view nao daria sintoma nenhum -- e a secao 4 do teste mede o `anon`.
REVOKE ALL ON public.card_invoice_lines FROM anon;
GRANT SELECT ON public.card_invoice_lines TO authenticated;

-- SEM A LINHA ABAIXO ESTA MIGRATION ABRE A FATURA DE TODO MUNDO. Ela e a
-- ULTIMA instrucao do arquivo de proposito -- ver a secao `security_invoker`
-- do cabecalho, que explica por que isso vale como sonda de colagem inteira.
ALTER VIEW public.card_invoice_lines SET (security_invoker = true);

COMMIT;
