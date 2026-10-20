-- ===========================================================================
-- 060 -- O LANCAMENTO QUE NAO SOMA NOS TOTAIS (HMO-443)
-- ===========================================================================
-- "escolher uma despesa e uma receita pra nao aparecer nos totais, exemplo
-- adicionei um ajuste na minha conta investimento, ela entrou como uma receita
-- de ajuste mas nao quero que ela fique somando nos totais."
--
-- O CASO REAL: o ajuste de saldo. A pessoa corrige o valor de uma conta de
-- investimento, o app grava uma RECEITA de ajuste para que o saldo feche, e
-- essa receita -- que nao e renda nenhuma -- entra no "quanto eu ganhei este
-- mes" junto com o salario. O mesmo vale do outro lado: uma despesa que e
-- remanejamento, nao gasto. Hoje nao ha escolha: todo lancamento de
-- `expense`/`income` entra em todo relatorio.
--
-- ESTA MIGRATION E A MESMA PERGUNTA DA 058, UM NIVEL ABAIXO. A 058 perguntou
-- "esta CONTA entra nos totais?"; esta pergunta "este LANCAMENTO entra?". Por
-- isso a coluna tem o MESMO NOME (`include_in_total`), o mesmo tipo e o mesmo
-- default: duas perguntas iguais com nomes diferentes seriam duas convencoes
-- para a mesma coisa, e quem lesse uma suporia a outra. As tres razoes do
-- cabecalho da 058 -- POSITIVA, `NOT NULL`, DEFAULT `true` -- valem aqui
-- palavra por palavra e nao sao repetidas em extenso; o que segue e so o que
-- MUDA de uma para a outra.
--
-- NENHUM SELECT JUNTA AS DUAS SEM QUALIFICAR A TABELA. As duas colunas
-- homonimas so se encontram num JOIN entre `financial_transactions` e
-- `financial_accounts`, e ali `include_in_total` cru seria ambiguo -- o
-- Postgres recusa com "column reference is ambiguous", que e um erro em vez de
-- um numero errado. Nao ha caminho em que a ambiguidade passe calada.
--
-- ===========================================================================
-- O QUE MUDA EM RELACAO A 058: AQUI UMA VIEW E RECOLADA
-- ===========================================================================
-- A 058 so criou coluna. Esta cria a coluna E recola UMA view, porque sem o
-- filtro a coluna nao faria nada: quem soma receita e despesa neste app nao le
-- `financial_transactions` direto -- le uma cadeia de cinco views, e todas as
-- cinco passam por `category_monthly_totals`.
--
--   financial_transactions
--     |- category_monthly_totals              (022)   <-- o WHERE entra AQUI
--          |- monthly_cash_flow               (022)
--          |- personal_category_monthly_totals (046)
--               |- personal_monthly_cash_flow  (033)
--                    |- planned_vs_actual      (054, perna do REALIZADO)
--
-- UM so `WHERE`, e as outras quatro herdam por construcao -- elas sao rollup
-- de `category_monthly_totals`, nao consultas novas a tabela. Recolar as cinco
-- seria cinco vezes mais superficie para a reloption se perder (secao 3) e
-- cinco lugares para o filtro divergir na proxima vez que alguem mexer numa
-- delas. O teste desta migration MEDE cada uma das quatro assim mesmo
-- (`teste-de-migration-roda-na-posicao-dele`): herdar por construcao e um
-- argumento, nao uma medida.
--
-- Quem le essa cadeia, e portanto muda de numero quando a pessoa desmarcar um
-- lancamento: `lib/services/monthly-summary.ts` (painel + e-mail),
-- `app/api/reports/cash-flow/route.ts` (ramo mensal),
-- `app/api/reports/categories/route.ts` (ramo mensal),
-- `app/api/reports/planned-vs-actual/route.ts` e
-- `app/api/reports/export/route.ts` (os quatro CSVs).
--
-- ===========================================================================
-- OS TRES LUGARES QUE O FILTRO **NAO** ALCANCA, DE PROPOSITO
-- ===========================================================================
-- Escrever "as views herdam o filtro" sem estas tres ressalvas seria uma
-- afirmacao mais larga do que a verdade. As tres foram medidas, nao inferidas.
--
-- 1. `net_worth_history` (008) CONTA AS DUAS LINHAS, e tem de contar. Ela le
--    `financial_transactions` direto (`WHERE t.account_id IS NOT NULL`) e nao
--    passa por `category_monthly_totals`. Isso NAO e um esquecimento: este
--    flag e de RELATORIO, nao de SALDO. O dinheiro do ajuste entrou mesmo na
--    conta, o `update_account_balance_trigger` ja mexeu no
--    `current_balance`, e tirar a linha do patrimonio faria o saldo da tela
--    de Contas discordar do patrimonio -- duas telas, o mesmo dinheiro, dois
--    numeros. A secao 5 do teste e exatamente a prova disto, e ela reprova se
--    alguem "consertar" a omissao.
--
-- 2. `planned_vs_actual` (054) continua CRIANDO A CHAVE do mes. O CTE
--    `chaves` le `financial_transactions` direto para saber quais (usuario,
--    mes, moeda) existem; o LATERAL do realizado e que sai da cadeia
--    filtrada. Consequencia: um mes cuja UNICA movimentacao foi desmarcada
--    aparece na view como uma linha de ZEROS em vez de nao aparecer. E uma
--    linha zerada, nao um numero errado (`linha-zerada-nas-views-do-008`), e
--    mexer no `chaves` mudaria o conjunto de meses que o relatorio enumera --
--    outra mudanca, com outro risco, que esta migration nao faz. A secao 4.4
--    do teste fixa `actual_expense`/`actual_income` filtrados E a existencia
--    da chave, para que a escolha fique medida e nao suposta.
--
-- 3. A PERNA DE GRUPO do custo pessoal NAO HERDA. A perna 2 de
--    `personal_category_monthly_totals` (046) sai de
--    `group_share_category_monthly_totals`, que le a TABELA
--    `group_share_entries` -- escrita por trigger -- e nao a view filtrada.
--    Entao: desmarcar uma despesa de grupo que EU paguei funciona (ela entra
--    pela perna 1, que e filtrada); desmarcar uma que OUTRO membro pagou NAO
--    tira a minha parte do meu relatorio pessoal. Isto esta fora do escopo
--    desta fase de proposito -- fechar o buraco exige decidir se o flag e do
--    pagador ou de cada participante, e isso e pergunta para o Helio, nao
--    escolha de migration. Registrado aqui para que a proxima pessoa ache a
--    ressalva antes de achar o sintoma.
--
-- ===========================================================================
-- `security_invoker`: O ALTER DA SECAO 3 NAO E REDUNDANTE
-- ===========================================================================
-- `CREATE OR REPLACE VIEW` **APAGA as reloptions** da view, e `security_invoker`
-- e uma reloption (`create-or-replace-view-apaga-reloptions`). Sem o ALTER
-- logo abaixo, `category_monthly_totals` volta a rodar com os direitos do
-- DONO, a RLS de `financial_transactions` deixa de se aplicar, e a view passa
-- a devolver O GASTO POR CATEGORIA DE TODOS OS USUARIOS do app para qualquer
-- um logado -- e, pela cadeia acima, as outras quatro views junto.
--
-- A falha e SILENCIOSA e nao aparece em teste de valor nenhum: num banco de um
-- usuario so, uma view DEFINER devolve exatamente os mesmos numeros que uma
-- view INVOKER. Por isso a secao 6 do teste mede a reloption no catalogo, e
-- nao o resultado da consulta.
--
-- ===========================================================================
-- IDEMPOTENTE, E SEM BACKFILL
-- ===========================================================================
-- `ADD COLUMN IF NOT EXISTS` com default e NOT NULL na propria instrucao;
-- `CREATE OR REPLACE VIEW`, `ALTER VIEW ... SET`, `REVOKE` e `GRANT` sao todos
-- re-aplicaveis. Re-rodar o arquivo inteiro e no-op.
--
-- NAO HA `UPDATE` de backfill, e isso e uma decisao, nao um esquecimento: o
-- `ADD COLUMN ... DEFAULT true` ja grava `true` em toda linha existente sem
-- reescrever a tabela (Postgres 11+ guarda o default no catalogo). Um
-- `UPDATE ... SET include_in_total = true` seria um no-op caro numa tabela
-- grande E -- pior -- RELIGARIA, calado, todo lancamento que o usuario tivesse
-- desmarcado, na proxima vez que alguem recolasse este arquivo. A secao 7 do
-- teste e o que impede esse UPDATE de voltar.
--
-- ===========================================================================
-- ADITIVA: COLAR ESTE ARQUIVO COM O CODIGO DE HOJE NO AR E INOFENSIVO
-- ===========================================================================
-- Nenhum arquivo do repositorio le `financial_transactions.include_in_total` no
-- momento em que esta migration vai para a `main` -- ela vai SOZINHA, na frente
-- do codigo (`migration-tem-que-ir-para-main-sozinha`). Consequencias de colar
-- antes do codigo:
--
--   - todo lancamento, velho e novo, nasce e permanece `true`, que e "soma nos
--     relatorios" -- o comportamento identico ao de hoje. O `WHERE
--     t.include_in_total` da secao 2 nao descarta nenhuma linha enquanto
--     ninguem desmarcar nada, entao NENHUM NUMERO DE NENHUMA TELA MUDA DE
--     VALOR pela colagem;
--   - `SELECT *` passa a devolver um campo a mais, que o cliente ignora;
--   - a assinatura de `category_monthly_totals` (nomes, tipos e ordem das
--     colunas) e identica a da 022 -- so o `WHERE` mudou --, entao nenhum
--     `.select()` do app precisa saber desta migration.
--
-- A RLS nao precisa de nada: `financial_transactions` ja tem policy por
-- `user_id`, e policy vale para a linha inteira, nao por coluna
-- (`policy-rls-nao-trava-coluna`).
--
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A coluna
-- ---------------------------------------------------------------------------

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS include_in_total boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.financial_transactions.include_in_total IS
  'HMO-443: este lancamento entra nos totais de relatorio (fluxo de caixa, total por categoria, previsto x realizado, painel e os CSVs)? FALSE tira a linha das SOMAS e nao da existencia dela: ela continua no extrato, continua na lista de lancamentos e continua mexendo no saldo da conta e no patrimonio (net_worth_history) -- o flag e de RELATORIO, nao de SALDO. O caso que originou a coluna e o ajuste de saldo, que vira receita sem ser renda. Positiva de proposito, igual a homonima de financial_accounts (058): todo leitor e uma soma, e a negacao dupla inverteria o total. Ver o cabecalho da migration 060.';

-- ---------------------------------------------------------------------------
-- 2. `category_monthly_totals`, recolada a partir da 022 com UMA linha a mais
-- ---------------------------------------------------------------------------
-- Recolada LINHA POR LINHA a partir da 022 -- que e a ultima a tocar esta view
-- (conferido: 008 e 022, nesta ordem) -- com `AND t.include_in_total` e NADA
-- MAIS. O resto e identico de proposito: o `ABS()` com FILTER por
-- `transaction_type` (despesa e gravada NEGATIVA, e um SUM cru devolveria -800
-- para quem gastou 800), o `transfer` de fora, o grao por (user_id, group_id,
-- mes, categoria, moeda). Mudar duas coisas aqui ao mesmo tempo seria nao
-- saber qual delas moveu o numero.
--
-- O filtro entra no `WHERE` e nao em cada `FILTER (WHERE ...)`: assim a linha
-- desmarcada sai TAMBEM do `transaction_count`. Um lancamento que nao soma e
-- que mesmo assim fosse contado deixaria a tela dizendo "3 lancamentos" ao lado
-- de um total de dois -- a contradicao visivel que nao se explica.
--
-- `t.include_in_total` cru, sem `= true` e sem `IS TRUE`: a coluna e NOT NULL,
-- entao os tres sao equivalentes aqui. A forma nua e a que a 058 ja usa no
-- COMMENT dela para descrever o criterio.

CREATE OR REPLACE VIEW public.category_monthly_totals AS
  SELECT
    t.user_id,
    t.group_id,
    date_trunc('month', t.transaction_date)::date AS month,
    t.category_id,
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'expense'), 0)::numeric(15,2) AS expense,
    COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'income'), 0)::numeric(15,2) AS income,
    (COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'income'), 0)
     - COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.transaction_type = 'expense'), 0))::numeric(15,2) AS net,
    COUNT(*) FILTER (WHERE t.transaction_type IN ('expense', 'income')) AS transaction_count,
    t.currency
  FROM public.financial_transactions t
  WHERE t.transaction_type IN ('expense', 'income')
    AND t.include_in_total
  GROUP BY t.user_id, t.group_id, date_trunc('month', t.transaction_date)::date, t.category_id, t.currency;

COMMENT ON VIEW public.category_monthly_totals IS
  'Entrada e saida por categoria, mes e MOEDA. Ignora transfer e ignora o lancamento desmarcado (financial_transactions.include_in_total = false, HMO-443/060). Cada linha esta em uma moeda so: somar linhas de moedas diferentes nao da numero nenhum. E o UNICO ponto em que o filtro de include_in_total entra -- monthly_cash_flow, personal_category_monthly_totals, personal_monthly_cash_flow e planned_vs_actual herdam dela por serem rollup, e net_worth_history NAO herda de proposito (o flag e de relatorio, nao de saldo).';

-- ---------------------------------------------------------------------------
-- 3. `security_invoker` DE VOLTA -- o passo que se esquece
-- ---------------------------------------------------------------------------
-- Ver o bloco homonimo no cabecalho. `CREATE OR REPLACE VIEW` apaga as
-- reloptions; sem este ALTER a view acima vira DEFINER e vaza o gasto por
-- categoria de todos os usuarios, calado, sem mudar numero nenhum num banco de
-- teste de um usuario so.
--
-- So `category_monthly_totals` precisa: ela e a unica view que este arquivo
-- recola. As outras quatro nao foram tocadas e mantem as reloptions delas.

ALTER VIEW public.category_monthly_totals SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 4. GRANTs reafirmados
-- ---------------------------------------------------------------------------
-- Mesma razao da secao 3: a 008 e a 022 ja concederam e `CREATE OR REPLACE`
-- preserva os privilegios -- mas "preserva" e o que separa este arquivo de uma
-- view ilegivel para o app (ou legivel para `anon`). Repetir e barato.

REVOKE ALL ON public.category_monthly_totals FROM anon;
GRANT SELECT ON public.category_monthly_totals TO authenticated;

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('060', '060_lancamento_fora_dos_totais',
        'Coluna include_in_total em financial_transactions e o filtro em category_monthly_totals - HMO-443', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
