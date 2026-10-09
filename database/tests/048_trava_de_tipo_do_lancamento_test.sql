-- =====================================================
-- Teste da trava de tipo do lancamento (048)
-- =====================================================
-- HMO-232. Roda no db-verify, na POSICAO dela da cadeia -- contra o banco que
-- 001 -> ... -> 048 constroem do zero.
--
-- O QUE ESTE ARQUIVO AFIRMA, E POR QUE NAO BASTA UMA ASSERCAO
-- -----------------------------------------------------------
-- A 048 tem UMA linha de efeito (`ALTER COLUMN transaction_type SET NOT NULL`).
-- Um arquivo de teste com uma assercao so pareceria suficiente, e as duas
-- assercoes obvias tem cada uma um ponto cego DIFERENTE:
--
--   * so o CATALOGO (`is_nullable = 'NO'`) nao prova que o banco RECUSA nada --
--     ele prova que uma coluna do `information_schema` tem um valor. A relacao
--     entre as duas coisas e obvia aqui e nao e obvia em geral: `convalidated`
--     de CHECK e o precedente da casa de catalogo que mente;
--
--   * so o COMPORTAMENTO (o INSERT sem a coluna e recusado) fica verde para um
--     `CHECK (transaction_type IS NOT NULL)` posto no lugar do NOT NULL. Esse
--     CHECK barra o nulo de verdade -- com 23514 em vez de 23502 -- e deixa
--     `is_nullable` em 'YES' no catalogo. Toda ferramenta que le a coluna pelo
--     catalogo (o `\d`, o Supabase Studio, o gerador de tipos,
--     `scripts/gen-schema-columns.mjs`) continuaria dizendo "aceita nulo", e o
--     proximo a mexer aqui acreditaria nela.
--
-- Por isso as duas estao presentes, e por isso a SECAO 2 exige o SQLSTATE
-- **23502** e nao "deu erro": o mecanismo e parte da afirmacao. Os dois CHECKs
-- plausiveis estao em `scripts/mutantes-trava-de-tipo.mjs` como mutantes
-- (`check_que_aceita_nulo` e `check_explicito_em_vez_de_not_null`), e cada um
-- deles e morto por UMA das duas secoes -- nenhuma das duas e redundante.
--
-- AS SECOES
-- ---------
--   1. o catalogo: a coluna e NOT NULL, e nao ha CHECK fazendo as vezes dela
--   2. a recusa, com 23502, nas TRES formas de chegar ao nulo
--   3. CONTROLE POSITIVO: os tres valores do ENUM continuam entrando
--   4. a ferramenta de reparo da 037 sobreviveu, e agora e sempre 0
--
-- Rodar num banco limpo, depois de 001 -> ... -> 048:
--   psql "$DB_URL" -f database/tests/048_trava_de_tipo_do_lancamento_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_text(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- O que ERRA: roda uma escrita que o banco tem de recusar, e falha se ela
-- passar. Sem o SQLSTATE no contrato a assercao viraria "o INSERT deu erro?",
-- que um BEGIN/EXCEPTION engole sem dizer qual erro -- e aqui a diferenca entre
-- 23502 (NOT NULL) e 23514 (CHECK) e exatamente a decisao que a migration tomou.
CREATE OR REPLACE FUNCTION pg_temp.expect_recusa(label TEXT, sql TEXT, sqlstate_esperado TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> sqlstate_esperado THEN
      RAISE EXCEPTION 'FALHA: % -> recusou com % e nao com %', label, SQLSTATE, sqlstate_esperado;
    END IF;
    RAISE NOTICE 'ok: % (recusado com %)', label, sqlstate_esperado;
    RETURN;
  END;
  RAISE EXCEPTION 'FALHA: % -> o banco ACEITOU, e devia recusar com %', label, sqlstate_esperado;
END $$;

-- =====================================================
-- Fixture: um dono, uma conta corrente, as duas categorias
-- =====================================================
-- Conta CORRENTE e nao cartao: nada aqui mede fatura, e `credit_card` arrastaria
-- `closing_day`/`due_day` para dentro de um teste que nao fala deles.
--
-- As duas categorias (despesa e receita) existem porque a SECAO 3 insere um
-- 'income' e um 'expense', e usar a categoria de despesa para os dois faria o
-- controle positivo passar com uma linha que o app nunca produziria.
INSERT INTO auth.users (id, email) VALUES
  ('d2320000-0000-0000-0000-000000000001', 'tina-232@teste.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d2320000-0000-0000-0000-000000000001', 'Tina 232', FALSE);

INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, current_balance)
VALUES
  ('a2320000-0000-0000-0000-000000000001', 'd2320000-0000-0000-0000-000000000001',
   'Conta Tina', 'checking', 0),
  ('a2320000-0000-0000-0000-000000000002', 'd2320000-0000-0000-0000-000000000001',
   'Poupanca Tina', 'savings', 0);

-- =====================================================
-- SECAO 1 -- O CATALOGO
-- =====================================================
-- `is_nullable` e a unica coisa que distingue a 048 de um CHECK posto no lugar
-- dela, e e o que o resto do mundo le sobre esta coluna.
SELECT pg_temp.expect_text(
  'transaction_type e NOT NULL no catalogo',
  (SELECT is_nullable
     FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'financial_transactions'
      AND column_name  = 'transaction_type'),
  'NO');

-- E a coluna continua SEM DEFAULT. Um `SET DEFAULT 'expense'` junto do NOT NULL
-- faria o INSERT sem a coluna PASSAR -- a linha nasceria 'expense' em silencio,
-- inclusive a perna de transferencia e a receita -- e as assercoes da SECAO 2
-- ficariam vermelhas, mas por um motivo que o leitor leria como "a trava nao
-- entrou". Esta assercao nomeia o outro motivo.
SELECT pg_temp.expect(
  'e continua sem DEFAULT: o tipo e de quem escreve, nunca do banco',
  (SELECT count(*)
     FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'financial_transactions'
      AND column_name  = 'transaction_type'
      AND column_default IS NOT NULL),
  0);

-- A NEGACAO DA ESCOLHA DA MIGRATION. Nao basta "o nulo e barrado": a 048 decidiu
-- que quem barra e o NOT NULL, e um CHECK sobre esta coluna seria ou inerte
-- (`IN (...)`, que NULL atravessa) ou um segundo mecanismo dizendo a mesma coisa
-- com outro SQLSTATE. As duas situacoes sao estados que alguem pode criar
-- querendo "reforcar" a trava, e as duas tornam o 23502 da SECAO 2 instavel.
SELECT pg_temp.expect(
  'e nenhum CHECK da tabela fala de transaction_type',
  (SELECT count(*)
     FROM pg_constraint c
    WHERE c.conrelid = 'public.financial_transactions'::regclass
      AND c.contype  = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%transaction_type%'),
  0);

-- =====================================================
-- SECAO 2 -- A RECUSA, COM O SQLSTATE DO NOT NULL
-- =====================================================
-- As TRES formas de chegar ao nulo, porque nao sao o mesmo caminho de codigo:
-- omitir a coluna e o que a rota fazia antes do PR #139 (o defeito da HMO-181
-- em pessoa), mandar NULL explicito e a forma que um `.insert({...})` do
-- supabase-js produz quando a variavel chega `null`, e o UPDATE e o que um PATCH
-- faria. Omitir e mandar NULL coincidem SO porque a coluna nao tem DEFAULT --
-- com um DEFAULT os dois divergem, e e por isso que a SECAO 1 o prende.

SELECT pg_temp.expect_recusa(
  'INSERT SEM a coluna e recusado (o defeito da HMO-181)',
  $sql$
    INSERT INTO public.financial_transactions
      (user_id, service_id, category_id, account_id, description, amount,
       transaction_date)
    VALUES
      ('d2320000-0000-0000-0000-000000000001',
       (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
       (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
       'a2320000-0000-0000-0000-000000000001',
       'sem tipo nenhum', -42.00, DATE '2026-10-08')
  $sql$,
  '23502');

SELECT pg_temp.expect_recusa(
  'INSERT com NULL explicito e recusado',
  $sql$
    INSERT INTO public.financial_transactions
      (user_id, service_id, category_id, account_id, description, amount,
       transaction_date, transaction_type)
    VALUES
      ('d2320000-0000-0000-0000-000000000001',
       (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
       (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
       'a2320000-0000-0000-0000-000000000001',
       'tipo nulo de proposito', -42.00, DATE '2026-10-08', NULL)
  $sql$,
  '23502');

-- A linha boa que o UPDATE vai tentar apagar o tipo. Ela tambem e o controle
-- positivo do INSERT -- se a 048 estivesse barrando mais do que devia, o teste
-- morreria AQUI, antes das assercoes, e com o erro do Postgres em vez de um
-- 'FALHA:' nosso.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
VALUES
  ('b2320000-0000-0000-0000-000000000001',
   'd2320000-0000-0000-0000-000000000001',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a2320000-0000-0000-0000-000000000001',
   'despesa com tipo', -42.00, DATE '2026-10-08', 'expense');

SELECT pg_temp.expect_recusa(
  'UPDATE que apaga o tipo de uma linha boa e recusado',
  $sql$
    UPDATE public.financial_transactions
       SET transaction_type = NULL
     WHERE id = 'b2320000-0000-0000-0000-000000000001'
  $sql$,
  '23502');

-- E a linha continua la, com o tipo dela. `UPDATE` recusado por RLS volta
-- SUCESSO com zero linhas neste banco (e o falso verde que a 040 documentou),
-- entao vale dizer que o que aconteceu acima foi recusa e nao "nao achou a
-- linha".
SELECT pg_temp.expect(
  'a linha boa sobreviveu ao UPDATE recusado, com o tipo intacto',
  (SELECT count(*) FROM public.financial_transactions
    WHERE id = 'b2320000-0000-0000-0000-000000000001'
      AND transaction_type = 'expense'),
  1);

-- =====================================================
-- SECAO 3 -- CONTROLE POSITIVO: OS TRES VALORES DO ENUM
-- =====================================================
-- Sem esta secao, um `CHECK (false)` na tabela -- que recusa o INSERT sem tipo,
-- recusa o NULL explicito, recusa o UPDATE e recusa TODO lancamento do app
-- junto -- passaria pela SECAO 2 inteira.
--
-- Os tres valores e nao um: 'transfer' e o que
-- /api/movimentacoes/transferencia grava nas DUAS pernas, e 'income' e o que
-- `register_payroll` grava. Uma trava que tivesse se tornado
-- `CHECK (transaction_type = 'expense')` -- a forma mais plausivel de errar
-- isto, porque despesa e o caso comum -- derrubaria a transferencia e o salario
-- em producao, e passaria por um controle positivo que so inserisse despesa.

INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
VALUES
  ('d2320000-0000-0000-0000-000000000001',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = FALSE LIMIT 1),
   'a2320000-0000-0000-0000-000000000001',
   'receita com tipo', 3000.00, DATE '2026-10-08', 'income');

-- As duas pernas da transferencia, com o elo de uma via que a 015 definiu: quem
-- grava `counterpart_transaction_id` e a perna de ENTRADA.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
VALUES
  ('b2320000-0000-0000-0000-000000000002',
   'd2320000-0000-0000-0000-000000000001',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a2320000-0000-0000-0000-000000000001',
   'saida da transferencia', -500.00, DATE '2026-10-08', 'transfer');

INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, counterpart_transaction_id)
VALUES
  ('b2320000-0000-0000-0000-000000000003',
   'd2320000-0000-0000-0000-000000000001',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a2320000-0000-0000-0000-000000000002',
   'entrada da transferencia', 500.00, DATE '2026-10-08', 'transfer',
   'b2320000-0000-0000-0000-000000000002');

SELECT pg_temp.expect(
  'os tres valores do ENUM entraram: 2 transfer, 1 income, 1 expense',
  (SELECT count(*) FROM public.financial_transactions
    WHERE user_id = 'd2320000-0000-0000-0000-000000000001'),
  4);

SELECT pg_temp.expect(
  'e cada um pelo valor dele, nao quatro vezes o mesmo',
  (SELECT count(DISTINCT transaction_type) FROM public.financial_transactions
    WHERE user_id = 'd2320000-0000-0000-0000-000000000001'),
  3);

-- O valor fora do ENUM continua sendo recusado pelo TIPO da coluna, e nao por
-- esta migration -- 22P02 e erro de entrada de texto, nao violacao de
-- restricao. Esta assercao esta aqui para dizer que a 048 nao precisou de CHECK
-- de dominio nenhum: ele existe desde o 001, no `CREATE TYPE`.
SELECT pg_temp.expect_recusa(
  'valor fora do ENUM continua barrado pelo tipo (22P02, nao 23502)',
  $sql$
    INSERT INTO public.financial_transactions
      (user_id, service_id, category_id, account_id, description, amount,
       transaction_date, transaction_type)
    VALUES
      ('d2320000-0000-0000-0000-000000000001',
       (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
       (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
       'a2320000-0000-0000-0000-000000000001',
       'tipo inventado', -42.00, DATE '2026-10-08', 'expence')
  $sql$,
  '22P02');

-- =====================================================
-- SECAO 4 -- A FERRAMENTA DE REPARO DA 037
-- =====================================================
-- A 048 chama `public.backfill_tipo_do_lancamento()` antes de travar, e e a
-- UNICA chamada dela que sobra no repositorio depois que a 037 passou. Se
-- alguem apagar a funcao por achar que ela cumpriu o papel, a 048 para de ser
-- colavel num banco que tenha linha nula -- e o sintoma aparece no SQL Editor
-- do Helio, em producao, e em nenhum CI.
--
-- O retorno agora e 0 por construcao: com NOT NULL na coluna nao existe mais
-- linha para ela consertar. Um numero diferente de 0 aqui significaria que o
-- NOT NULL nao esta valendo.
SELECT pg_temp.expect(
  'a funcao de reparo da 037 continua existindo',
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'backfill_tipo_do_lancamento'),
  1);

SELECT pg_temp.expect(
  'e ela nao tem mais nada para consertar',
  public.backfill_tipo_do_lancamento()::BIGINT,
  0);

-- =====================================================
ROLLBACK;
