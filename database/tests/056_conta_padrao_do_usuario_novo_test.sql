-- =====================================================
-- HMO-412 -- a conta padrao do usuario novo (056)
-- =====================================================
-- Roda no db-verify contra o banco que as migrations constroem do zero, com a
-- 056 ja aplicada.
--
-- O QUE A 056 ENTREGA
-- -------------------
-- `create_default_accounts` criava QUATRO contas no primeiro acesso de quem
-- ainda nao tinha nenhuma (Conta Corrente, Cartao de Credito, Dinheiro e PIX).
-- A decisao D2 da HMO-407 deixa DUAS: Conta Corrente e Dinheiro.
--
-- POR QUE "O PIX SUMIU" NAO PROVA ESTA MIGRATION
-- ----------------------------------------------
-- Esta e a armadilha deste arquivo, e e o motivo de a secao 1 afirmar o
-- CONJUNTO inteiro em vez de uma ausencia. `SELECT count(*) ... WHERE name =
-- 'PIX'` da zero por pelo menos quatro razoes diferentes, e so uma delas e a
-- feature:
--
--   - a 056 tirou o PIX                        <- o que queremos
--   - a funcao nao rodou (erro engolido, usuario errado, FK diferente)
--   - a funcao rodou e nao inseriu nada
--   - a guarda de "ja tem conta" disparou e abortou cedo
--
-- As quatro passam numa assercao de ausencia. Nenhuma delas passa numa
-- assercao que exige DUAS linhas com estes DOIS nomes. Por isso a secao 1 e a
-- unica que vale o step, e as outras existem para fechar os lados dela.
--
-- O que ele fixa, na ordem:
--
--   (1) o usuario novo recebe EXATAMENTE duas contas, e elas sao
--       'Conta Corrente' e 'Dinheiro' -- o conjunto, nao a contagem sozinha;
--   (2) CONTROLE POSITIVO DOS ATRIBUTOS: as duas nascem com o tipo, o icone e
--       a cor que o seletor de lancamento espera. Sem esta secao, uma funcao
--       que inserisse duas linhas com os nomes certos e `account_type`
--       trocado passaria a (1) inteira -- e `account_type` e o que decide se a
--       conta entra no patrimonio como ativo ou como divida;
--   (3) as duas contas que SAIRAM nao sao criadas sob NENHUM nome: a assercao
--       e por `account_type` (`credit_card` e `digital`), e nao pelo texto
--       'PIX'. Renomear o PIX para "Pix" no INSERT nao e o conserto pedido, e
--       uma assercao textual deixaria isso passar;
--   (4) A GUARDA DE "JA TEM CONTA" CONTINUA DE PE. Chamar a funcao de novo num
--       usuario que ja tem conta nao insere nada. Sem esta secao, apagar o
--       `IF EXISTS ... RETURN` da 056 sobrevive: a (1) roda num usuario limpo
--       e continuaria verde, enquanto no app toda visita ao painel passaria a
--       empilhar mais duas contas;
--   (5) NAO HA BACKFILL. O cartao e o PIX que `056_contas_antes_da_056.sql`
--       plantou e COMITOU no passo anterior continuam no banco depois da 056,
--       inteiros, com o lancamento de R$ 150,00 ainda amarrado no cartao -- e
--       a funcao tampouco "completa" o conjunto de quem ja tem conta. Esta
--       secao LE dado de antes da migration de proposito: um backfill dentro
--       da 056 roda antes desta transacao existir, e so dado pre-existente o
--       alcanca. Medido: com a fixture inserida dentro desta transacao, o
--       mutante `backfill_apaga_pix_e_cartao` sobrevivia a suite inteira;
--   (6) existe UMA unica `create_default_accounts` em `pg_proc`. A 056 e um
--       `CREATE OR REPLACE`, e ele so substitui a funcao de assinatura
--       IDENTICA: um parametro a mais, ou um `DEFAULT`, deixaria a versao de
--       quatro contas viva ao lado da nova e o `rpc` do app escolheria por
--       resolucao de sobrecarga. E exatamente a deriva que o
--       `legacy_function_drift_test.sql` documenta, aplicada a esta funcao;
--   (7) ela continua `SECURITY DEFINER` e `RETURNS void`. O chamador e o
--       `supabase.rpc` numa sessao `authenticated`, e a funcao escreve em
--       `financial_accounts`, que tem RLS -- sem `SECURITY DEFINER` o INSERT
--       passa a depender da policy e o cadastro quebra em silencio.
--
-- CONTROLE NEGATIVO (fora deste arquivo, e medido): num banco que para na 054
-- este teste fica VERMELHO na secao 1, com "esperado 2, obtido 4". E o que
-- prova que ele mede a 056 e nao o estado basal do banco.
--
-- A SECAO 3 E IMPLICADA PELA SECAO 1 e esta aqui para nomear a regressao, nao
-- porque algum mutante morra so nela: se o conjunto da (1) e exatamente
-- {Conta Corrente, Dinheiro}, nao sobra linha para ser `credit_card` ou
-- `digital`. Ela fica porque e ela que registra POR QUE a assercao e por
-- `account_type` e nao pelo texto 'PIX'. Todas as outras secoes tem mutante
-- proprio (ver o cabecalho do PR).
--
-- Rodar num banco limpo, depois das migrations ate a 056 -- e DEPOIS de
-- `056_contas_antes_da_056.sql`, de que a secao 5 depende:
--   psql "$DB_URL" -f database/tests/056_contas_antes_da_056.sql
--   psql "$DB_URL" -f database/migrations/056_conta_padrao_do_usuario_novo.sql
--   psql "$DB_URL" -f database/tests/056_conta_padrao_do_usuario_novo_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_txt(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado "%", obtido "%"', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- O usuario novo das secoes 1-4. O da secao 5 nao nasce aqui: ele vem
-- COMITADO de `056_contas_antes_da_056.sql`, que roda antes da migration.
INSERT INTO auth.users (id, email) VALUES
  ('c0120000-0000-0000-0000-000000000001', 'novo@test.local');

-- =====================================================
-- 1. O usuario novo recebe EXATAMENTE duas contas, e sao ESTAS duas
-- =====================================================
SELECT public.create_default_accounts('c0120000-0000-0000-0000-000000000001');

SELECT pg_temp.expect('o usuario novo recebe exatamente 2 contas',
  (SELECT count(*) FROM public.financial_accounts
    WHERE user_id = 'c0120000-0000-0000-0000-000000000001'), 2);

-- O conjunto, e nao a contagem: duas linhas com os nomes trocados tambem dao 2.
SELECT pg_temp.expect_txt('e as duas sao Conta Corrente e Dinheiro',
  (SELECT string_agg(name, ' | ' ORDER BY name) FROM public.financial_accounts
    WHERE user_id = 'c0120000-0000-0000-0000-000000000001'),
  'Conta Corrente | Dinheiro');

-- =====================================================
-- 2. CONTROLE POSITIVO: as duas nascem com tipo, icone e cor
-- =====================================================
-- Sem esta secao, inserir duas linhas com os nomes certos e `account_type`
-- trocado passa a secao 1 inteira -- e e `account_type` que decide se a conta
-- entra no patrimonio como ativo ou como divida (ver `lib/net-worth.ts`).
SELECT pg_temp.expect_txt('Conta Corrente: tipo, icone e cor',
  (SELECT account_type || ' / ' || icon || ' / ' || color_hex
     FROM public.financial_accounts
    WHERE user_id = 'c0120000-0000-0000-0000-000000000001'
      AND name = 'Conta Corrente'),
  'checking / building / #10B981');

SELECT pg_temp.expect_txt('Dinheiro: tipo, icone e cor',
  (SELECT account_type || ' / ' || icon || ' / ' || color_hex
     FROM public.financial_accounts
    WHERE user_id = 'c0120000-0000-0000-0000-000000000001'
      AND name = 'Dinheiro'),
  'cash / banknote / #84CC16');

-- As duas nascem zeradas e ativas: e o estado que `lib/net-worth.ts` e
-- `lib/safe-to-spend.ts` tratam como "usuario novo".
SELECT pg_temp.expect('as duas nascem com saldo zero e ativas',
  (SELECT count(*) FROM public.financial_accounts
    WHERE user_id = 'c0120000-0000-0000-0000-000000000001'
      AND current_balance = 0 AND is_active), 2);

-- =====================================================
-- 3. As duas que SAIRAM nao sao criadas sob nome nenhum
-- =====================================================
-- A assercao e por `account_type`, e nao pelo texto 'PIX': renomear a linha no
-- INSERT nao e o conserto pedido, e uma assercao textual deixaria passar.
SELECT pg_temp.expect('nenhum cartao de credito e criado no cadastro',
  (SELECT count(*) FROM public.financial_accounts
    WHERE user_id = 'c0120000-0000-0000-0000-000000000001'
      AND account_type = 'credit_card'), 0);

SELECT pg_temp.expect('nenhuma conta digital (PIX) e criada no cadastro',
  (SELECT count(*) FROM public.financial_accounts
    WHERE user_id = 'c0120000-0000-0000-0000-000000000001'
      AND account_type = 'digital'), 0);

-- =====================================================
-- 4. A guarda de "ja tem conta" continua de pe
-- =====================================================
-- Sem esta secao, apagar o `IF EXISTS ... RETURN` da 056 SOBREVIVE a suite: a
-- secao 1 roda num usuario limpo e fica verde, enquanto no app cada visita ao
-- painel empilharia mais duas contas.
SELECT public.create_default_accounts('c0120000-0000-0000-0000-000000000001');

SELECT pg_temp.expect('chamar de novo nao insere nada (continua 2)',
  (SELECT count(*) FROM public.financial_accounts
    WHERE user_id = 'c0120000-0000-0000-0000-000000000001'), 2);

-- =====================================================
-- 5. NAO HA BACKFILL: o cartao e o PIX de ANTES da 056 continuam la
-- =====================================================
-- Esta secao le as contas que `056_contas_antes_da_056.sql` plantou e COMITOU
-- no passo ANTERIOR da cadeia, e nao contas inseridas aqui dentro. A diferenca
-- e a secao inteira: um `DELETE FROM financial_accounts WHERE account_type IN
-- ('credit_card','digital')` dentro da 056 roda ANTES desta transacao comecar,
-- entao ele so pode ser pego por dado que ja estava no banco.
--
-- MEDIDO: com a fixture inserida AQUI DENTRO, como estava na primeira versao
-- deste arquivo, o mutante `backfill_apaga_pix_e_cartao` SOBREVIVEU a suite
-- inteira. Com ela plantada antes, ele morre aqui.
SELECT pg_temp.expect('o cartao e o PIX de antes da 056 continuam no banco',
  (SELECT count(*) FROM public.financial_accounts
    WHERE user_id = 'a0560000-0000-0000-0000-000000000099'), 2);

SELECT pg_temp.expect_txt('o cartao antigo sobrevive inteiro, com saldo e limite',
  (SELECT name || ' / ' || account_type || ' / ' || current_balance || ' / ' || credit_limit
     FROM public.financial_accounts
    WHERE id = 'f0560000-0000-0000-0000-000000000001'),
  'Cartão de Crédito / credit_card / -150.00 / 3000.00');

-- E o lancamento continua AMARRADO no cartao. E este o dinheiro que um
-- backfill de limpeza levaria junto, e e por isso que ele nao existe.
SELECT pg_temp.expect_txt('o lancamento de R$ 150,00 continua preso ao cartao',
  (SELECT t.description || ' / ' || t.amount
     FROM public.financial_transactions t
    WHERE t.id = '70560000-0000-0000-0000-000000000001'
      AND t.account_id = 'f0560000-0000-0000-0000-000000000001'),
  'Compra no cartao anterior a 056 / -150.00');

-- E a funcao tambem nao "completa" o conjunto de quem ja tem conta: o usuario
-- plantado tem cartao e PIX, e nao ganha Conta Corrente nem Dinheiro.
SELECT public.create_default_accounts('a0560000-0000-0000-0000-000000000099');

SELECT pg_temp.expect('quem ja tem conta nao ganha as padrao depois',
  (SELECT count(*) FROM public.financial_accounts
    WHERE user_id = 'a0560000-0000-0000-0000-000000000099'), 2);

-- =====================================================
-- 6. UMA unica create_default_accounts em pg_proc
-- =====================================================
-- `CREATE OR REPLACE FUNCTION` so substitui a funcao de assinatura IDENTICA.
-- Um parametro a mais, ou um DEFAULT, deixaria a versao de QUATRO contas viva
-- ao lado da nova, e o `rpc` do app escolheria por resolucao de sobrecarga --
-- a mesma deriva que o `legacy_function_drift_test.sql` documenta para a
-- `is_group_member`, aplicada a esta funcao.
SELECT pg_temp.expect('existe exatamente UMA create_default_accounts',
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_default_accounts'), 1);

-- =====================================================
-- 7. Ela continua SECURITY DEFINER e RETURNS void
-- =====================================================
-- O chamador e o `supabase.rpc` numa sessao `authenticated`, e a funcao
-- escreve em `financial_accounts`, que tem RLS. Sem `SECURITY DEFINER` o
-- INSERT passa a depender da policy e o cadastro quebra em silencio.
SELECT pg_temp.expect_txt('assinatura, SECURITY DEFINER e retorno',
  (SELECT pg_get_function_identity_arguments(p.oid)
            || ' -> ' || pg_catalog.format_type(p.prorettype, NULL)
            || CASE WHEN p.prosecdef THEN ' / definer' ELSE ' / invoker' END
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_default_accounts'),
  'p_user_id uuid -> void / definer');

DO $$ BEGIN RAISE NOTICE '056: todas as assercoes passaram'; END $$;

ROLLBACK;

-- =====================================================
-- Nada acima escreve fora da transacao: o ROLLBACK devolve o banco ao estado
-- em que ele entrou, inclusive os dois usuarios de auth.users.
-- =====================================================
