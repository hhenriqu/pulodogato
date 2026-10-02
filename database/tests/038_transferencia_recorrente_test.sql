-- =====================================================
-- HMO-172: a transferencia recorrente nao pode nascer com uma perna
-- =====================================================
-- A 038 abre `transaction_type = 'transfer'` em `scheduled_transactions` (que a
-- 027 havia fechado de proposito) e acrescenta `destination_account_id` nas duas
-- tabelas da agenda. Este teste e o que impede as tres formas de gravar meia
-- transferencia.
--
-- O QUE ESTA EM JOGO
-- ------------------
-- Transferencia sao DUAS pernas (`transfer`, sinais opostos, ligadas por
-- `counterpart_transaction_id`). Uma regra que materialize UMA perna deixa o
-- saldo das duas contas errado em direcoes OPOSTAS -- e o total geral continua
-- certo. Nenhum agregado acusa: `net_worth_history` soma os dois tipos e fecha
-- em zero, `monthly_cash_flow` e `category_monthly_totals` filtram
-- income/expense e nem olham a linha. Por isso a trava e no banco: o sintoma
-- nao aparece em nenhum numero que alguem confira.
--
-- O que este teste fixa:
--
--   (1) CONTROLE POSITIVO, PRIMEIRO: a despesa fixa de sempre -- regra
--       `expense` sem destino -- continua passando. E a ocorrencia normal, com
--       `transaction_type` NULL (herda a direcao da regra) e sem destino,
--       tambem. Se a trava quebrasse este caminho o app pararia de criar conta
--       prevista nenhuma, e estas duas assercoes vem antes das de recusa
--       exatamente para dizer que o cadeado nao trancou a casa inteira;
--   (2) `transfer` SEM destino e recusado (23514). E a regra que materializa
--       UMA perna -- o defeito inteiro da issue, se o banco deixasse gravar;
--   (3) `transfer` com destino IGUAL a origem e recusado (23514). As duas
--       pernas cairiam na mesma conta, -total e +total se anulariam, e a tela
--       diria "transferido" sem nada ter se movido;
--   (4) `expense` COM destino e recusado (23514) -- a transferencia disfarcada:
--       a baixa le o TIPO, nao a coluna, entao ela gravaria uma perna so e a
--       coluna ficaria ali dizendo que havia um destino que ninguem honrou. E o
--       estado que a forma permissiva do CHECK (`destino IS NULL OR tipo =
--       transfer`) deixaria passar;
--   (5) CONTROLE POSITIVO: `transfer` com destino valido e diferente da origem
--       PASSA, nas duas tabelas. Sem esta assercao um mutante `CHECK (false)`
--       -- a trava larga demais, que recusa TUDO -- passaria em (2), (3) e (4)
--       e seria dado como morto sem ser;
--   (6) a prova de que o CHECK do 027 foi REALMENTE alargado, e nao apenas
--       recriado: 'transfer' e aceito em `scheduled_transactions.transaction_type`
--       E 'income'/'expense'/NULL continuam aceitos. Um DROP sem o ADD passaria
--       em (6a) e morreria em (4);
--   (7) a FK do destino nao tem ON DELETE: apagar uma conta que e destino de
--       uma regra e recusado (23503). Um SET NULL ali transformaria a regra em
--       transferencia sem destino -- o estado (2) -- numa linha que ninguem
--       tocou;
--   (8) a view `scheduled_transactions_effective` entrega `direction =
--       'transfer'` sozinha, SEM ter sido recriada: `security_invoker` continua
--       ligado. `CREATE OR REPLACE VIEW` apaga `reloptions` e reabriria o furo
--       de RLS que a 004 fechou, para consertar uma coluna que nao precisava de
--       conserto.
--
-- Rodar num banco limpo, depois das migrations ate 038:
--   psql "$DB_URL" -f database/tests/038_transferencia_recorrente_test.sql
--
-- Qualquer FALHA lanca excecao e aborta.
-- =====================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_txt(label TEXT, got TEXT, want TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- Roda um comando e devolve o SQLSTATE, ou '00000' se ele passou. E a sonda das
-- assercoes de recusa E das de aceitacao: as duas chamam a MESMA funcao e
-- comparam com valores diferentes, entao nao existe o caso "a assercao de
-- aceitacao usa um caminho mais frouxo que a de recusa".
CREATE OR REPLACE FUNCTION pg_temp.sqlstate_de(cmd TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE cmd;
  RETURN '00000';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;

-- =====================================================
-- Fixture
-- =====================================================
INSERT INTO auth.users (id, email) VALUES
  ('a1720000-0000-0000-0000-000000000001', 'transf@recorrente.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('a1720000-0000-0000-0000-000000000001', 'Usuario 172', FALSE);

-- Origem e destino. A poupanca e o destino do caso real da issue: "todo dia 5
-- mando mil para a poupanca".
INSERT INTO public.financial_accounts (id, user_id, name, account_type) VALUES
  ('a1720000-0000-0000-0000-0000000000c1', 'a1720000-0000-0000-0000-000000000001', 'Corrente 172', 'checking'),
  ('a1720000-0000-0000-0000-0000000000c2', 'a1720000-0000-0000-0000-000000000001', 'Poupanca 172', 'savings');

-- b9db286c-... e a categoria do seed de referencia do 001_baseline.sql, a mesma
-- usada pelo scheduled_rls_test. Repetida por extenso em vez de um \set porque
-- o bundle do SQL Editor so traduz o \set ON_ERROR_STOP.

-- =====================================================
-- (1) CONTROLE POSITIVO: o caminho que o app ja fazia continua passando
-- =====================================================
-- Primeiro, e de proposito. Estas duas assercoes sao as que dizem que a trava
-- nao trancou a casa: a despesa fixa e a ocorrencia que herda a direcao da
-- regra sao 100% do trafego de hoje.
SELECT pg_temp.expect_txt(
  'regra expense SEM destino passa (a despesa fixa de sempre)',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.recurring_rules
      (id, user_id, category_id, account_id, description, amount, transaction_type, due_day)
    VALUES
      ('a1720000-0000-0000-0000-0000000000e1', 'a1720000-0000-0000-0000-000000000001',
       'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a1720000-0000-0000-0000-0000000000c1',
       'Aluguel', 2500.00, 'expense', 5)
  $cmd$),
  '00000'
);

-- `transaction_type` NULL = "pergunte a regra" (027). E a forma de TODA
-- ocorrencia gerada por `materializarAgenda` hoje, e ela cai no ramo ELSE do
-- CHECK novo -- que exige destino NULL. Esta assercao e a que prova que o ramo
-- ELSE nao quebrou a materializacao.
SELECT pg_temp.expect_txt(
  'ocorrencia com transaction_type NULL e sem destino passa (materializacao de hoje)',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.scheduled_transactions
      (id, user_id, recurring_rule_id, category_id, account_id, description, amount, due_date)
    VALUES
      ('a1720000-0000-0000-0000-0000000000f1', 'a1720000-0000-0000-0000-000000000001',
       'a1720000-0000-0000-0000-0000000000e1',
       'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a1720000-0000-0000-0000-0000000000c1',
       'Aluguel', 2500.00, CURRENT_DATE + 5)
  $cmd$),
  '00000'
);

-- =====================================================
-- (6a) 'transfer' e ACEITO em scheduled_transactions.transaction_type
-- =====================================================
-- A 027 recusava este valor de proposito. Esta e a assercao que prova que a 038
-- alargou o CHECK de verdade -- e nao que alguem o recriou com o mesmo texto.
SELECT pg_temp.expect_txt(
  'ocorrencia transfer com destino valido passa (o CHECK do 027 foi alargado)',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.scheduled_transactions
      (id, user_id, category_id, account_id, destination_account_id,
       description, amount, due_date, transaction_type)
    VALUES
      ('a1720000-0000-0000-0000-0000000000f2', 'a1720000-0000-0000-0000-000000000001',
       'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
       'a1720000-0000-0000-0000-0000000000c1', 'a1720000-0000-0000-0000-0000000000c2',
       'Reserva mensal', 1000.00, CURRENT_DATE + 5, 'transfer')
  $cmd$),
  '00000'
);

-- (6c) ...e o CHECK CONTINUA EXISTINDO, nomeando 'transfer'.
--
-- Esta assercao parece redundante com (6a) e nao e. `transaction_type` e o enum
-- `transaction_financial_type`, que tem exatamente income/expense/transfer: um
-- DROP do CHECK sem o ADD de volta aceitaria os MESMOS tres valores que a lista
-- nova aceita, e seria indistinguivel por qualquer assercao de INSERT. Era um
-- mutante que sobrevivia (`drop_sem_add`) por equivalencia, nao por sorte.
--
-- O que se perde no DROP so aparece no futuro, e e concreto: no dia em que um
-- quarto valor entrar no enum (um 'refund', por exemplo), a constraint e o que
-- forca alguem a DECIDIR se ele cabe na agenda, em vez de ele passar a existir
-- em `scheduled_transactions` sem que ninguem tenha olhado. A promessa da 038 e
-- alargar a lista, nao abrir mao dela -- e e isso que esta linha fixa.
SELECT pg_temp.expect_txt(
  'o CHECK de transaction_type continua existindo e nomeia transfer',
  (SELECT CASE
            WHEN pg_get_constraintdef(oid) LIKE '%transfer%' THEN 'nomeia transfer'
            ELSE 'SEM transfer: ' || pg_get_constraintdef(oid)
          END
     FROM pg_constraint
    WHERE conname = 'scheduled_transactions_transaction_type_check'),
  'nomeia transfer'
);

-- (6b) ...e income/expense CONTINUAM aceitos. Um mutante que troque a lista por
-- `IN ('transfer')` passaria em (6a) e morreria aqui.
SELECT pg_temp.expect_txt(
  'ocorrencia income continua aceita',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.scheduled_transactions
      (id, user_id, category_id, account_id, description, amount, due_date, transaction_type)
    VALUES
      ('a1720000-0000-0000-0000-0000000000f3', 'a1720000-0000-0000-0000-000000000001',
       'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a1720000-0000-0000-0000-0000000000c1',
       'Salario', 7000.00, CURRENT_DATE + 5, 'income')
  $cmd$),
  '00000'
);

-- (5) CONTROLE POSITIVO da regra: transfer com destino valido PASSA.
SELECT pg_temp.expect_txt(
  'regra transfer com destino valido passa',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.recurring_rules
      (id, user_id, category_id, account_id, destination_account_id,
       description, amount, transaction_type, due_day)
    VALUES
      ('a1720000-0000-0000-0000-0000000000e2', 'a1720000-0000-0000-0000-000000000001',
       'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
       'a1720000-0000-0000-0000-0000000000c1', 'a1720000-0000-0000-0000-0000000000c2',
       'Reserva mensal', 1000.00, 'transfer', 5)
  $cmd$),
  '00000'
);

-- =====================================================
-- (2) transfer SEM destino: a regra de meia transferencia
-- =====================================================
-- 23514 = check_violation. Conferir o SQLSTATE, e nao "deu erro", importa: um
-- not_null_violation ou um foreign_key_violation por fixture errada tambem "da
-- erro", e passaria por uma assercao frouxa dizendo que a trava funciona quando
-- quem recusou foi outra coisa.
SELECT pg_temp.expect_txt(
  'regra transfer SEM destino e recusada com 23514',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.recurring_rules
      (id, user_id, category_id, account_id, description, amount, transaction_type, due_day)
    VALUES
      ('a1720000-0000-0000-0000-0000000000e3', 'a1720000-0000-0000-0000-000000000001',
       'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a1720000-0000-0000-0000-0000000000c1',
       'Reserva sem destino', 1000.00, 'transfer', 5)
  $cmd$),
  '23514'
);

SELECT pg_temp.expect_txt(
  'ocorrencia transfer SEM destino e recusada com 23514',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.scheduled_transactions
      (id, user_id, category_id, account_id, description, amount, due_date, transaction_type)
    VALUES
      ('a1720000-0000-0000-0000-0000000000f4', 'a1720000-0000-0000-0000-000000000001',
       'b9db286c-ce4f-4fbe-b0bf-f3133185f90f', 'a1720000-0000-0000-0000-0000000000c1',
       'Reserva sem destino', 1000.00, CURRENT_DATE + 5, 'transfer')
  $cmd$),
  '23514'
);

-- =====================================================
-- (3) transfer com destino IGUAL a origem: as pernas se anulam
-- =====================================================
SELECT pg_temp.expect_txt(
  'regra transfer com destino = origem e recusada com 23514',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.recurring_rules
      (id, user_id, category_id, account_id, destination_account_id,
       description, amount, transaction_type, due_day)
    VALUES
      ('a1720000-0000-0000-0000-0000000000e4', 'a1720000-0000-0000-0000-000000000001',
       'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
       'a1720000-0000-0000-0000-0000000000c1', 'a1720000-0000-0000-0000-0000000000c1',
       'Reserva circular', 1000.00, 'transfer', 5)
  $cmd$),
  '23514'
);

SELECT pg_temp.expect_txt(
  'ocorrencia transfer com destino = origem e recusada com 23514',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.scheduled_transactions
      (id, user_id, category_id, account_id, destination_account_id,
       description, amount, due_date, transaction_type)
    VALUES
      ('a1720000-0000-0000-0000-0000000000f5', 'a1720000-0000-0000-0000-000000000001',
       'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
       'a1720000-0000-0000-0000-0000000000c1', 'a1720000-0000-0000-0000-0000000000c1',
       'Reserva circular', 1000.00, CURRENT_DATE + 5, 'transfer')
  $cmd$),
  '23514'
);

-- =====================================================
-- (4) expense COM destino: a transferencia disfarcada
-- =====================================================
-- Este e o caso que a forma permissiva do CHECK deixaria passar, e o motivo pelo
-- qual ele e um CASE e nao um OR. A baixa le o TIPO: ela gravaria UMA perna
-- negativa e o destino ficaria na linha sem ninguem honrar.
SELECT pg_temp.expect_txt(
  'regra expense COM destino e recusada com 23514',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.recurring_rules
      (id, user_id, category_id, account_id, destination_account_id,
       description, amount, transaction_type, due_day)
    VALUES
      ('a1720000-0000-0000-0000-0000000000e5', 'a1720000-0000-0000-0000-000000000001',
       'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
       'a1720000-0000-0000-0000-0000000000c1', 'a1720000-0000-0000-0000-0000000000c2',
       'Aluguel com destino', 2500.00, 'expense', 5)
  $cmd$),
  '23514'
);

-- E o mesmo com `transaction_type` NULL, que e o ramo ELSE puro: uma ocorrencia
-- que herda a direcao da regra NAO pode carregar destino, porque o banco nao
-- teria como saber que aquele destino e legitimo sem ir ler outra tabela. E a
-- razao pela qual a materializacao grava 'transfer' explicito na ocorrencia.
SELECT pg_temp.expect_txt(
  'ocorrencia com tipo NULL e destino preenchido e recusada com 23514',
  pg_temp.sqlstate_de($cmd$
    INSERT INTO public.scheduled_transactions
      (id, user_id, category_id, account_id, destination_account_id,
       description, amount, due_date)
    VALUES
      ('a1720000-0000-0000-0000-0000000000f6', 'a1720000-0000-0000-0000-000000000001',
       'b9db286c-ce4f-4fbe-b0bf-f3133185f90f',
       'a1720000-0000-0000-0000-0000000000c1', 'a1720000-0000-0000-0000-0000000000c2',
       'Heranca com destino', 1000.00, CURRENT_DATE + 5)
  $cmd$),
  '23514'
);

-- =====================================================
-- (7) a FK do destino nao tem ON DELETE SET NULL
-- =====================================================
-- A regra r2 (criada em (5)) tem a poupanca como destino. Apagar a poupanca tem
-- de ser RECUSADO: um SET NULL transformaria r2 numa transferencia sem destino
-- -- o estado (2) -- numa linha que ninguem tocou, e a violacao do CHECK so
-- apareceria na escrita seguinte.
SELECT pg_temp.expect_txt(
  'apagar a conta de destino de uma regra e recusado com 23503',
  pg_temp.sqlstate_de($cmd$
    DELETE FROM public.financial_accounts
     WHERE id = 'a1720000-0000-0000-0000-0000000000c2'
  $cmd$),
  '23503'
);

-- =====================================================
-- (8) a view entrega direction='transfer' e NAO foi recriada
-- =====================================================
-- s2 e a ocorrencia transfer de (6a). `direction` e
-- COALESCE(s.transaction_type, r.transaction_type, 'expense') -- ela ja era do
-- tipo transaction_financial_type, que tem 'transfer' desde o 001_baseline,
-- entao a view passa a entregar o valor novo sem uma linha de DDL.
SELECT pg_temp.expect_txt(
  'a view entrega direction = transfer para a ocorrencia transfer',
  (SELECT direction::text FROM public.scheduled_transactions_effective
    WHERE id = 'a1720000-0000-0000-0000-0000000000f2'),
  'transfer'
);

-- E a prova de que ela NAO foi recriada: `CREATE OR REPLACE VIEW` apaga
-- `reloptions`, e com ele o `security_invoker = true` da 004. Se alguem
-- "consertar" a view nesta migration, a RLS de TODO usuario volta a ser furada
-- por ela -- a view passa a rodar como o dono. Esta assercao e barata e e a
-- unica que pega isso.
SELECT pg_temp.expect_txt(
  'security_invoker continua ligado na view (ela nao foi recriada)',
  (SELECT CASE WHEN 'security_invoker=true' = ANY (c.reloptions)
            THEN 'ligado' ELSE 'DESLIGADO' END
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'scheduled_transactions_effective'),
  'ligado'
);

ROLLBACK;
