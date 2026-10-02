-- =====================================================
-- Teste do backfill de transaction_type (037)
-- =====================================================
-- HMO-181. Roda no db-verify, contra o banco que as migrations constroem do
-- zero.
--
-- O PROBLEMA DE TESTAR BACKFILL, E COMO ELE E CONTORNADO AQUI
-- -----------------------------------------------------------
-- O db-verify constroi o banco DO ZERO. Quando a 037 roda, nao existe nenhuma
-- linha antiga para ela preencher: um teste que so conferisse "sobrou linha
-- sem tipo?" depois da migration responderia 0 de 0 e passaria verde mesmo se
-- o UPDATE nunca tivesse rodado. E a verificacao vazia de sempre -- a resposta
-- certa e a resposta de quem nao olhou nada sao o mesmo numero.
--
-- Por isso a regra da 037 mora numa FUNCAO (`backfill_tipo_do_lancamento`).
-- Este arquivo PLANTA as linhas ruins -- com `transaction_type` nulo, como o
-- POST de /api/personal-finance/transactions as gravou em producao -- e chama
-- a MESMA funcao que a migration chama. Nao ha copia da regra aqui.
--
-- O QUE ESTA SENDO AFIRMADO
-- -------------------------
-- Nao e "a coluna ficou preenchida". E que a linha VOLTA para as tres views da
-- 008, que e o estrago que a issue descreve: sem tipo, o lancamento aparece na
-- lista e desaparece do fluxo de caixa, dos relatorios e do orcamento. A
-- SECAO 2 mede a view ANTES e DEPOIS, no mesmo arquivo -- medir so o depois
-- deixaria passar um banco onde a linha ja estivesse visivel por outro motivo.
--
-- AS SECOES
-- ---------
--   1. plantio: 5 linhas sem tipo, e a prova de que elas estao sem tipo
--   2. a view ANTES: monthly_cash_flow nao ve nenhuma delas
--   3. o backfill: cada degrau acerta o tipo que lhe cabe
--  3b. a linha orfa, FABRICADA, que e o unico jeito de alcancar o degrau 3
--   4. a view DEPOIS: as linhas de despesa/receita voltaram, com os valores
--   5. NEGACAO: a perna de transferencia NAO virou despesa nem receita
--   6. idempotencia: a segunda chamada conserta 0
--   7. a funcao nao esta aberta para `authenticated`
--
-- Rodar num banco limpo, depois de 001 -> ... -> 037:
--   psql "$DB_URL" -f database/tests/037_tipo_do_lancamento_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect(label TEXT, got BIGINT, want BIGINT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_num(label TEXT, got NUMERIC, want NUMERIC)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_text(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
-- Um dono, uma conta, e as duas categorias de seed que o 001 ja traz. As
-- categorias saem de `is_expense` e nao do nome: o seed pode mudar de rotulo,
-- e o que este teste precisa e de uma de cada lado.

INSERT INTO auth.users (id, email) VALUES
  ('d7000000-0000-0000-0000-000000000181', 'helio-181@teste.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d7000000-0000-0000-0000-000000000181', 'Helio 181', FALSE);

INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, current_balance)
VALUES
  ('a7000000-0000-0000-0000-000000000181',
   'd7000000-0000-0000-0000-000000000181', 'Corrente 181', 'checking', 0);

-- =====================================================
-- 1. Plantio: as cinco linhas como o POST velho as gravava
-- =====================================================
-- Todas com `transaction_type` NULO EXPLICITO. A coluna e nullable (001), e e
-- essa permissividade que deixou o defeito existir por meses.
--
--   sonda-despesa    categoria de despesa, valor negativo  -> degrau 2
--   sonda-receita    categoria de receita,  valor positivo -> degrau 2
--   sonda-estorno    categoria de despesa, valor POSITIVO  -> degrau 2 tambem,
--                    e e o caso em que o degrau 3 erraria: pelo sinal ele
--                    seria receita
--   sonda-orfa       categoria que nao existe (fabricada)   -> degrau 3
--   sonda-transf-*   as duas pernas de uma transferencia   -> degrau 1
--
-- A perna de SAIDA nao grava `counterpart_transaction_id` (o elo e de uma via
-- so, 015): ela so e reconhecivel pelo lado de la. E exatamente a linha que um
-- backfill ingenuo classificaria como despesa.

INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
VALUES
  ('b7000000-0000-0000-0000-000000000001',
   'd7000000-0000-0000-0000-000000000181',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE ORDER BY name LIMIT 1),
   'a7000000-0000-0000-0000-000000000181', 'sonda-despesa', -12.34,
   DATE '2026-09-29', NULL),

  ('b7000000-0000-0000-0000-000000000002',
   'd7000000-0000-0000-0000-000000000181',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = FALSE ORDER BY name LIMIT 1),
   'a7000000-0000-0000-0000-000000000181', 'sonda-receita', 7000.00,
   DATE '2026-09-29', NULL),

  ('b7000000-0000-0000-0000-000000000003',
   'd7000000-0000-0000-0000-000000000181',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE ORDER BY name LIMIT 1),
   'a7000000-0000-0000-0000-000000000181', 'sonda-estorno', 80.00,
   DATE '2026-09-29', NULL),

  ('b7000000-0000-0000-0000-000000000005',
   'd7000000-0000-0000-0000-000000000181',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE ORDER BY name LIMIT 1),
   'a7000000-0000-0000-0000-000000000181', 'sonda-transf-saida', -1000.00,
   DATE '2026-09-29', NULL);

INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, counterpart_transaction_id)
VALUES
  ('b7000000-0000-0000-0000-000000000006',
   'd7000000-0000-0000-0000-000000000181',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE ORDER BY name LIMIT 1),
   'a7000000-0000-0000-0000-000000000181', 'sonda-transf-entrada', 1000.00,
   DATE '2026-09-29', NULL, 'b7000000-0000-0000-0000-000000000005');

-- A SEXTA LINHA TEM DE SER FABRICADA, PORQUE O BANCO NAO A DEIXA EXISTIR
-- -----------------------------------------------------------------------
-- O degrau 3 (o sinal) so e alcancado quando a categoria da linha nao diz
-- nada. Hoje isso e IMPOSSIVEL por tres constraints somadas:
--
--   financial_transactions.category_id       NOT NULL
--   financial_transactions_category_id_fkey  FK sem ON DELETE (RESTRICT)
--   transaction_categories.is_expense        NOT NULL
--
-- Ou seja: toda linha tem categoria, toda categoria existe, e toda categoria
-- diz de que lado esta. Um degrau que nenhum teste consegue alcancar e um
-- degrau que ninguem sabe se funciona -- e a tentacao e apagar o `ELSE`, o que
-- faria a funcao gravar NULL em cima de NULL em silencio no dia em que uma
-- dessas tres constraints relaxar (a 036 ja mexeu nesta tabela uma vez).
--
-- Ela e fabricada na SECAO 3b, com `session_replication_role = replica`, e
-- DEPOIS do backfill principal -- a ordem nao e estetica: enquanto a linha
-- orfa existe, qualquer UPDATE sobre ela reabre a checagem da FK (o Postgres
-- nao pula a checagem quando a linha foi inserida na MESMA transacao, mesmo
-- com a chave inalterada), e o backfill inteiro morreria em 23503.
--
-- A prova de que a fabricacao era necessaria: as tres constraints estao de
-- pe. No dia em que uma delas cair, esta assercao fica vermelha e manda rever
-- o paragrafo acima em vez de deixa-lo envelhecer calado.
SELECT pg_temp.expect(
  'as 3 constraints que tornam o degrau 3 inalcancavel continuam de pe',
  (SELECT
     (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'financial_transactions'
         AND column_name = 'category_id' AND is_nullable = 'NO')
   + (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.financial_transactions'::regclass
         AND conname = 'financial_transactions_category_id_fkey'
         AND contype = 'f' AND convalidated)
   + (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'transaction_categories'
         AND column_name = 'is_expense' AND is_nullable = 'NO')),
  3);

-- O denominador junto do numerador, sempre: "6 de 6 estao sem tipo" e
-- diferente de "0 linhas erradas", que tambem e o que responde um banco vazio.
SELECT pg_temp.expect(
  'plantio: as 5 sondas validas existem',
  (SELECT count(*) FROM public.financial_transactions
    WHERE description LIKE 'sonda-%'),
  5);

SELECT pg_temp.expect(
  'plantio: as 5 estao sem transaction_type',
  (SELECT count(*) FROM public.financial_transactions
    WHERE description LIKE 'sonda-%' AND transaction_type IS NULL),
  5);

-- =====================================================
-- 2. A view ANTES: nenhuma das 5 existe para o fluxo de caixa
-- =====================================================
-- Esta e a metade da prova que so vale medida ANTES. Sem ela, a SECAO 4
-- afirmaria "a linha esta na view" sem nunca ter mostrado que ela podia nao
-- estar -- e e justamente o "podia nao estar" que e o defeito da issue.

SELECT pg_temp.expect(
  'antes do backfill: monthly_cash_flow nao conta nenhuma sonda',
  (SELECT COALESCE(SUM(transaction_count), 0)::bigint
     FROM public.monthly_cash_flow
    WHERE user_id = 'd7000000-0000-0000-0000-000000000181'),
  0);

SELECT pg_temp.expect(
  'antes do backfill: category_monthly_totals esta vazia para o dono',
  (SELECT count(*) FROM public.category_monthly_totals
    WHERE user_id = 'd7000000-0000-0000-0000-000000000181'),
  0);

-- =====================================================
-- 3. O backfill: cada degrau acerta o que lhe cabe
-- =====================================================

SELECT pg_temp.expect(
  'o backfill consertou as 5 linhas',
  public.backfill_tipo_do_lancamento()::bigint,
  5);

SELECT pg_temp.expect_text(
  'degrau 2: categoria de despesa, valor negativo -> expense',
  (SELECT transaction_type::text FROM public.financial_transactions
    WHERE description = 'sonda-despesa'),
  'expense');

SELECT pg_temp.expect_text(
  'degrau 2: categoria de receita -> income',
  (SELECT transaction_type::text FROM public.financial_transactions
    WHERE description = 'sonda-receita'),
  'income');

-- O caso que separa o degrau 2 do degrau 3. Pelo SINAL o estorno seria receita
-- -- e um backfill que olhasse so o sinal passaria em todas as outras
-- assercoes deste arquivo.
SELECT pg_temp.expect_text(
  'degrau 2 vence o 3: estorno POSITIVO em categoria de despesa -> expense',
  (SELECT transaction_type::text FROM public.financial_transactions
    WHERE description = 'sonda-estorno'),
  'expense');

-- =====================================================
-- 3b. A linha orfa: o unico jeito de alcancar o degrau 3
-- =====================================================
-- Ver o bloco "A SEXTA LINHA TEM DE SER FABRICADA" na SECAO 1 para o porque.
-- Aqui so o como:
--
--   * `session_replication_role = replica` desliga os triggers, inclusive os
--     internos que implementam a FK. A NOT NULL de `category_id` e de coluna e
--     continua valendo -- por isso o uuid e inventado, e nao nulo.
--
--   * o backfill desta linha roda com os triggers AINDA desligados. Nao e
--     conveniencia: o Postgres nao pula a checagem de FK num UPDATE quando a
--     linha foi inserida na MESMA transacao, nem com a chave inalterada, e o
--     UPDATE morreria em 23503 sobre uma linha que so existe para o teste.
--     O backfill com os triggers LIGADOS -- que e o caso que importa em
--     producao, por causa das travas de PDG01 da 024 -- e o da SECAO 3, que
--     acabou de rodar sobre as cinco linhas validas.
--
-- `SET LOCAL` morre no ROLLBACK do fim do arquivo.
SET LOCAL session_replication_role = replica;

INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
VALUES
  ('b7000000-0000-0000-0000-000000000004',
   'd7000000-0000-0000-0000-000000000181',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   'cc000000-0000-0000-0000-00000000dead',
   'a7000000-0000-0000-0000-000000000181', 'sonda-orfa', -50.00,
   DATE '2026-09-29', NULL);

SELECT pg_temp.expect(
  'a linha orfa chegou sem tipo, e o backfill alcanca so ela',
  public.backfill_tipo_do_lancamento()::bigint,
  1);

SET LOCAL session_replication_role = origin;

SELECT pg_temp.expect_text(
  'degrau 3: categoria que nao existe, valor negativo -> expense',
  (SELECT transaction_type::text FROM public.financial_transactions
    WHERE description = 'sonda-orfa'),
  'expense');

SELECT pg_temp.expect(
  'nao sobrou linha sem tipo (de 6 que havia)',
  (SELECT count(*) FROM public.financial_transactions
    WHERE description LIKE 'sonda-%' AND transaction_type IS NULL),
  0);

-- =====================================================
-- 4. A view DEPOIS: as linhas voltaram, com os valores
-- =====================================================
-- As views somam com ABS() e filtram por tipo (008). Entram no mes de setembro
-- de 2026: despesa 12,34 + estorno 80,00 + orfa 50,00 = 142,34 de
-- despesa, e 7.000 de receita. As duas pernas da transferencia ficam de fora.

SELECT pg_temp.expect_num(
  'depois do backfill: despesas do mes',
  (SELECT expense FROM public.monthly_cash_flow
    WHERE user_id = 'd7000000-0000-0000-0000-000000000181'
      AND month = DATE '2026-09-01'),
  142.34);

SELECT pg_temp.expect_num(
  'depois do backfill: receitas do mes',
  (SELECT income FROM public.monthly_cash_flow
    WHERE user_id = 'd7000000-0000-0000-0000-000000000181'
      AND month = DATE '2026-09-01'),
  7000.00);

SELECT pg_temp.expect(
  'depois do backfill: 4 lancamentos contados (as 2 pernas ficam fora)',
  (SELECT transaction_count::bigint FROM public.monthly_cash_flow
    WHERE user_id = 'd7000000-0000-0000-0000-000000000181'
      AND month = DATE '2026-09-01'),
  4);

-- =====================================================
-- 5. NEGACAO: a perna de transferencia nao virou despesa nem receita
-- =====================================================
-- O erro caro deste backfill, e o unico que nao teria sintoma. As duas pernas
-- se anulam: classificar as duas como despesa/receita infla Receitas em 1.000
-- E Despesas em 1.000 ao mesmo tempo, e o SALDO continua certo. Nao haveria
-- numero errado para ninguem procurar -- so um mes que pareceu mais
-- movimentado do que foi.
--
-- A perna de SAIDA e a que importa aqui: ela nao grava o elo (via unica, 015),
-- tem valor negativo e categoria de despesa. Pelos degraus 2 e 3 ela seria
-- 'expense'. So o degrau 1, olhando o elo pelo OUTRO lado, a salva.

SELECT pg_temp.expect_text(
  'degrau 1: a perna de SAIDA (sem elo proprio) -> transfer',
  (SELECT transaction_type::text FROM public.financial_transactions
    WHERE description = 'sonda-transf-saida'),
  'transfer');

SELECT pg_temp.expect_text(
  'degrau 1: a perna de ENTRADA -> transfer',
  (SELECT transaction_type::text FROM public.financial_transactions
    WHERE description = 'sonda-transf-entrada'),
  'transfer');

SELECT pg_temp.expect(
  'nenhuma perna de transferencia entrou no fluxo de caixa',
  (SELECT count(*) FROM public.financial_transactions
    WHERE description LIKE 'sonda-transf-%'
      AND transaction_type IN ('expense', 'income')),
  0);

-- =====================================================
-- 6. Idempotencia
-- =====================================================
-- A segunda aplicacao da 037 chama a funcao de novo. Consertar 0 e o resultado
-- certo; consertar qualquer coisa aqui significaria que o primeiro passe
-- deixou linha para tras ou que a funcao esta reescrevendo linha ja tipada.

SELECT pg_temp.expect(
  'a segunda chamada conserta 0 linhas',
  public.backfill_tipo_do_lancamento()::bigint,
  0);

SELECT pg_temp.expect_num(
  'e as despesas do mes nao mudaram',
  (SELECT expense FROM public.monthly_cash_flow
    WHERE user_id = 'd7000000-0000-0000-0000-000000000181'
      AND month = DATE '2026-09-01'),
  142.34);

-- =====================================================
-- 7. A funcao nao esta aberta para quem tem sessao
-- =====================================================
-- EXECUTE em funcao nova e dado a PUBLIC pelo Postgres sem ninguem pedir, e
-- `authenticated` herda de PUBLIC. Uma funcao que reescreve `transaction_type`
-- em massa, exposta assim, seria um botao de "reclassifique meus lancamentos
-- todos" para qualquer portador de sessao -- limitado pela RLS da tabela, e
-- ainda assim nao e um botao que o app oferece.

SELECT pg_temp.expect(
  'authenticated NAO pode executar o backfill',
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'backfill_tipo_do_lancamento'
      AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE'))),
  0);

ROLLBACK;
