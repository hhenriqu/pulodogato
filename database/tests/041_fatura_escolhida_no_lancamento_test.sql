-- =====================================================
-- Teste da fatura escolhida no lancamento (041)
-- =====================================================
-- HMO-281 / HMO-288. Roda no db-verify, na POSICAO dela da cadeia -- contra o
-- banco que 001 -> ... -> 041 constroem do zero.
--
-- "A coluna existe" nao prova nada aqui. O que esta sendo afirmado e que a
-- compra aparece NA FATURA ESCOLHIDA, com o VENCIMENTO daquela fatura -- e que
-- todo o resto do app, que nao conhece o campo novo, continua caindo pela data.
--
-- OS DEFEITOS QUE ESTE ARQUIVO EXISTE PARA PRENDER
-- -------------------------------------------------
--   * o COALESCE so em `invoice_month`. A linha vai para a fatura escolhida
--     COM O VENCIMENTO DA FATURA DA DATA: a tela mostra a compra no mes certo e
--     o "fechar fatura" do 015 gera a conta a pagar com data de outro mes. E o
--     defeito silencioso do par, e e por isso que as SECOES 1 e 2 medem as DUAS
--     colunas sobre a MESMA linha;
--   * o override com dia diferente de 1. Ele sobrevive ao COALESCE e vira um
--     `invoice_month` que nao e mes nenhum: a tela passa a ter duas faturas de
--     outubro, cada uma com parte das compras, as duas com total plausivel;
--   * um DEFAULT na coluna nova. `ADD COLUMN ... DEFAULT` PREENCHE as linhas
--     que ja existem: todo o historico de cartao do banco mudaria de fatura de
--     uma vez. A SECAO 3 pega isso pelo catalogo E pelo comportamento (ver o
--     comentario la: a assercao de comportamento sozinha tem um ponto cego);
--   * e o `security_invoker` que o `CREATE OR REPLACE VIEW` APAGA. Esta
--     migration tem cara de aditiva e nao fala de permissao em lugar nenhum;
--     sem reafirmar a opcao, ela entrega a fatura de qualquer usuario a
--     qualquer usuario logado -- sem erro, so com linhas a mais. SECAO 5.
--
-- AS SECOES
-- ---------
--   1. o override manda: mes E vencimento vao para a fatura escolhida
--   2. sem override nada muda: a regra da 006 continua valendo
--   3. a coluna nasce NULA e sem DEFAULT (o historico nao se mexe)
--   4. o CHECK recusa o dia != 1, e aceita o dia 1 e o NULO
--   5. a view continua security_invoker depois do REPLACE
--   6. fora do cartao o override e inerte (por que nao ha CHECK cruzado)
--
-- Rodar num banco limpo, depois de 001 -> ... -> 041:
--   psql "$DB_URL" -f database/tests/041_fatura_escolhida_no_lancamento_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_date(label TEXT, got DATE, want DATE)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- A negacao. `expect_date` fica vermelho quando a data muda, mas nao diz QUAL
-- data errada apareceu -- e as datas erradas desta feature sao conhecidas e
-- plausiveis (a fatura da DATA, em vez da escolhida).
CREATE OR REPLACE FUNCTION pg_temp.refute_date(label TEXT, got DATE, proibida DATE, porque TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM proibida THEN
    RAISE EXCEPTION 'FALHA: % -> obtido %, que e exatamente %', label, proibida, porque;
  END IF;
  RAISE NOTICE 'ok: % (nao e %)', label, proibida;
END $$;

-- O que ERRA: roda uma escrita que o banco tem de recusar, e falha se ela
-- passar. Sem este helper a assercao viraria "o INSERT deu erro?", que um
-- BEGIN/EXCEPTION engole sem dizer qual erro.
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
-- Fixture: dois donos, um cartao cada, e uma conta corrente
-- =====================================================
-- `closing_day = 20` e `due_day = 5` nos dois cartoes, de proposito: o
-- vencimento vem ANTES do fechamento, que e o caso em que
-- `card_invoice_due_date` empurra para o mes SEGUINTE. E o que faz o vencimento
-- da fatura escolhida (05/01/2027) ser diferente do vencimento da fatura da
-- data (05/11/2026) -- sem essa diferenca, o mutante que tira o COALESCE so do
-- `invoice_due_date` sobreviveria.
--
-- O cartao do Davi existe para o controle de RLS da SECAO 5. A conta corrente
-- da Cris existe para a SECAO 6.
INSERT INTO auth.users (id, email) VALUES
  ('d8100000-0000-0000-0000-0000000000c1', 'cris-281@teste.local'),
  ('d8100000-0000-0000-0000-0000000000d1', 'davi-281@teste.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d8100000-0000-0000-0000-0000000000c1', 'Cris 281', FALSE),
  ('d8100000-0000-0000-0000-0000000000d1', 'Davi 281', FALSE);

INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, current_balance, closing_day, due_day)
VALUES
  ('a8100000-0000-0000-0000-0000000000c1', 'd8100000-0000-0000-0000-0000000000c1',
   'Cartao Cris', 'credit_card', 0, 20, 5),
  ('a8100000-0000-0000-0000-0000000000d1', 'd8100000-0000-0000-0000-0000000000d1',
   'Cartao Davi', 'credit_card', 0, 20, 5),
  ('a8100000-0000-0000-0000-0000000000c2', 'd8100000-0000-0000-0000-0000000000c1',
   'Conta Cris', 'checking', 0, NULL, NULL);

-- A GELADEIRA: comprada em 15/10 (dia 15 <= fechamento 20 -> cairia na fatura
-- de OUTUBRO pela regra da 006), e a pessoa ESCOLHEU jogar para a fatura de
-- DEZEMBRO. As duas datas da SECAO 1 saem daqui.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, invoice_month_override)
VALUES
  ('b8100000-0000-0000-0000-000000000001',
   'd8100000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a8100000-0000-0000-0000-0000000000c1',
   'Geladeira escolhida', -1200.00, DATE '2026-10-15', 'expense', DATE '2026-12-01');

-- O CAFE: mesmo cartao, mesma fatura de origem, SEM override. E o controle que
-- distingue "o override manda" de "a view inteira foi para dezembro".
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
VALUES
  ('b8100000-0000-0000-0000-000000000002',
   'd8100000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a8100000-0000-0000-0000-0000000000c1',
   'Cafe sem override', -30.00, DATE '2026-10-16', 'expense');

-- O MERCADO DE JUNHO: sem override, e num mes que NAO e o mes em que o teste
-- roda. A SECAO 3 explica por que esta linha e necessaria e o Cafe nao basta.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
VALUES
  ('b8100000-0000-0000-0000-000000000003',
   'd8100000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a8100000-0000-0000-0000-0000000000c1',
   'Mercado de junho', -80.00, DATE '2026-06-10', 'expense');

-- O PNEU DO DAVI: outro dono, tambem com override, para a SECAO 5.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, invoice_month_override)
VALUES
  ('b8100000-0000-0000-0000-000000000004',
   'd8100000-0000-0000-0000-0000000000d1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a8100000-0000-0000-0000-0000000000d1',
   'Pneu do Davi', -600.00, DATE '2026-10-10', 'expense', DATE '2026-12-01');

-- O ALUGUEL: override preenchido numa conta CORRENTE, para a SECAO 6.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, invoice_month_override)
VALUES
  ('b8100000-0000-0000-0000-000000000005',
   'd8100000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a8100000-0000-0000-0000-0000000000c2',
   'Aluguel fora do cartao', -2000.00, DATE '2026-10-05', 'expense', DATE '2026-12-01');

-- =====================================================
-- SECAO 1: o override manda -- no mes E no vencimento
-- =====================================================
-- As duas assercoes abaixo sao sobre a MESMA linha, e e isso que separa o
-- COALESCE completo do COALESCE pela metade. Com o COALESCE so no
-- `invoice_month`, a primeira passa e a segunda reprova.

SELECT pg_temp.expect_date('a geladeira cai na fatura ESCOLHIDA (dezembro/2026)',
  (SELECT invoice_month FROM public.card_invoice_lines
    WHERE transaction_id = 'b8100000-0000-0000-0000-000000000001'),
  DATE '2026-12-01');

-- A negacao nomeia o numero errado: outubro e a fatura que a DATA daria.
SELECT pg_temp.refute_date('e NAO na fatura da data',
  (SELECT invoice_month FROM public.card_invoice_lines
    WHERE transaction_id = 'b8100000-0000-0000-0000-000000000001'),
  DATE '2026-10-01', 'a fatura que a transaction_date daria -- o COALESCE nao entrou');

-- O VENCIMENTO. Fecha dia 20, vence dia 5: o 5 vem antes do 20, entao a fatura
-- de DEZEMBRO vence em 05/JANEIRO/2027.
SELECT pg_temp.expect_date('e vence com a fatura de dezembro: 05/01/2027',
  (SELECT invoice_due_date FROM public.card_invoice_lines
    WHERE transaction_id = 'b8100000-0000-0000-0000-000000000001'),
  DATE '2027-01-05');

-- ESTA E A ASSERCAO QUE PRENDE O DEFEITO SILENCIOSO DO PAR.
-- 05/11/2026 e o vencimento da fatura de OUTUBRO -- exatamente o que sai quando
-- o COALESCE entra no `invoice_month` e NAO entra no `invoice_due_date`. A tela
-- mostraria a compra em dezembro e o "fechar fatura" geraria a conta a pagar
-- para 5 de novembro.
SELECT pg_temp.refute_date('e NAO com o vencimento da fatura da data',
  (SELECT invoice_due_date FROM public.card_invoice_lines
    WHERE transaction_id = 'b8100000-0000-0000-0000-000000000001'),
  DATE '2026-11-05',
  'o vencimento da fatura de OUTUBRO -- o COALESCE ficou so no invoice_month');

-- =====================================================
-- SECAO 2: sem override, a regra da 006 continua inteira
-- =====================================================
-- Controle do lado oposto. Sem ele, um `invoice_month` cravado em dezembro --
-- ou um COALESCE com os argumentos trocados de lugar -- passaria na SECAO 1.

SELECT pg_temp.expect_date('o cafe (sem override) continua na fatura de outubro',
  (SELECT invoice_month FROM public.card_invoice_lines
    WHERE transaction_id = 'b8100000-0000-0000-0000-000000000002'),
  DATE '2026-10-01');

SELECT pg_temp.expect_date('e vence em 05/11/2026, como antes da 041',
  (SELECT invoice_due_date FROM public.card_invoice_lines
    WHERE transaction_id = 'b8100000-0000-0000-0000-000000000002'),
  DATE '2026-11-05');

-- A fatura de outubro da Cris tem UMA linha, nao duas: a geladeira saiu dela.
-- Mover para outra fatura e tirar da fatura de origem -- um override que
-- ACRESCENTASSE (a mesma compra nos dois meses) passaria em tudo acima.
SELECT pg_temp.expect('a fatura de outubro/2026 da Cris ficou com 1 linha',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE account_id = 'a8100000-0000-0000-0000-0000000000c1'
      AND invoice_month = DATE '2026-10-01'), 1);

SELECT pg_temp.expect('e a de dezembro/2026 tem a geladeira, so ela',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE account_id = 'a8100000-0000-0000-0000-0000000000c1'
      AND invoice_month = DATE '2026-12-01'), 1);

-- =====================================================
-- SECAO 3: a coluna nasce NULA, e sem DEFAULT
-- =====================================================
-- `ALTER TABLE ... ADD COLUMN ... DEFAULT x` nao e aditivo: ele PREENCHE as
-- linhas que ja existem. Um default qualquer aqui (CURRENT_DATE truncado, por
-- exemplo) moveria TODO o historico de cartao do banco para a mesma fatura, de
-- uma vez, sem erro nenhum.
--
-- A assercao de comportamento sozinha tem um ponto cego: um default de
-- `date_trunc('month', CURRENT_DATE)` cai no mes em que o teste roda, e se esse
-- mes coincidir com a fatura esperada de uma linha, aquela linha nao distingue
-- nada. Por isso ha DUAS defesas, e e de proposito:
--   - o catalogo (`atthasdef`), que nao depende de data nenhuma;
--   - e o 'Mercado de junho', uma linha cuja fatura correta (junho/2026) nao e
--     o mes corrente em nenhuma execucao plausivel deste teste.

SELECT pg_temp.expect('a coluna invoice_month_override existe e e date',
  (SELECT count(*) FROM pg_attribute a
     JOIN pg_type ty ON ty.oid = a.atttypid
    WHERE a.attrelid = 'public.financial_transactions'::regclass
      AND a.attname = 'invoice_month_override'
      AND a.attnum > 0 AND NOT a.attisdropped
      AND ty.typname = 'date'), 1);

SELECT pg_temp.expect('e NAO tem DEFAULT (ADD COLUMN com default reescreveria o historico)',
  (SELECT count(*) FROM pg_attribute
    WHERE attrelid = 'public.financial_transactions'::regclass
      AND attname = 'invoice_month_override'
      AND atthasdef), 0);

SELECT pg_temp.expect('e e NULA -- um INSERT sem a coluna (todo o codigo de hoje) nao escolhe fatura',
  (SELECT count(*) FROM public.financial_transactions
    WHERE id = 'b8100000-0000-0000-0000-000000000002'
      AND invoice_month_override IS NULL), 1);

SELECT pg_temp.expect_date('e o mercado de junho segue na fatura de junho/2026',
  (SELECT invoice_month FROM public.card_invoice_lines
    WHERE transaction_id = 'b8100000-0000-0000-0000-000000000003'),
  DATE '2026-06-01');

-- =====================================================
-- SECAO 4: o CHECK do dia 1
-- =====================================================
-- A coluna e um MES e o tipo `date` nao sabe disso. 15/12 sobrevive ao COALESCE
-- e vira um `invoice_month` que nao e mes nenhum: a tela passa a listar duas
-- "faturas de dezembro", cada uma com parte das compras, as duas com total
-- plausivel e nenhum erro em lugar nenhum.

SELECT pg_temp.expect_recusa(
  'override com dia 15 e recusado',
  $sql$
    INSERT INTO public.financial_transactions
      (user_id, service_id, category_id, account_id, description, amount,
       transaction_date, transaction_type, invoice_month_override)
    VALUES
      ('d8100000-0000-0000-0000-0000000000c1',
       (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
       (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
       'a8100000-0000-0000-0000-0000000000c1',
       'dia 15 no override', -10, DATE '2026-10-15', 'expense', DATE '2026-12-15')
  $sql$,
  '23514');

-- O ultimo dia do mes e o outro extremo, e e o que um "fim da fatura" escrito
-- a mao produziria.
SELECT pg_temp.expect_recusa(
  'override no ultimo dia do mes tambem e recusado',
  $sql$
    INSERT INTO public.financial_transactions
      (user_id, service_id, category_id, account_id, description, amount,
       transaction_date, transaction_type, invoice_month_override)
    VALUES
      ('d8100000-0000-0000-0000-0000000000c1',
       (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
       (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
       'a8100000-0000-0000-0000-0000000000c1',
       'dia 31 no override', -10, DATE '2026-10-15', 'expense', DATE '2026-12-31')
  $sql$,
  '23514');

-- CONTROLE POSITIVO. Sem ele, um `CHECK (false)` -- que recusa o dia 15, recusa
-- o dia 31 e recusa TODO lancamento do app junto -- passaria pelas duas
-- assercoes acima.
INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, invoice_month_override)
VALUES
  ('d8100000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a8100000-0000-0000-0000-0000000000c1',
   'dia 1 no override', -10, DATE '2026-10-15', 'expense', DATE '2027-03-01');

SELECT pg_temp.expect('o dia 1 e aceito',
  (SELECT count(*) FROM public.financial_transactions
    WHERE description = 'dia 1 no override'), 1);

-- E o NULO, que e o caminho de 100% do app de hoje. Um CHECK sem o ramo
-- `IS NULL` -- ou escrito como `= date_trunc(...)` sozinho -- resultaria NULL
-- aqui, e CHECK que resulta NULL aceita; mas a forma errada que importa e a que
-- recusa, e e essa que esta assercao pega junto com o controle acima.
SELECT pg_temp.expect('o NULO continua aceito (o INSERT de todo o codigo anterior a 041)',
  (SELECT count(*) FROM public.financial_transactions
    WHERE id = 'b8100000-0000-0000-0000-000000000002'), 1);

-- E a constraint esta VALIDADA, nao apenas declarada. `convalidated = false`
-- deixaria as linhas existentes fora da checagem, e o CHECK apareceria em
-- pg_constraint sem estar valendo para o historico.
SELECT pg_temp.expect('o CHECK da 041 existe e esta validado',
  (SELECT count(*) FROM pg_constraint
    WHERE conname = 'financial_transactions_invoice_month_override_dia_1'
      AND conrelid = 'public.financial_transactions'::regclass
      AND convalidated), 1);

-- =====================================================
-- SECAO 5: a view continua security_invoker DEPOIS do REPLACE
-- =====================================================
-- MEDIDO (Postgres 17.11, registrado na 035): `CREATE OR REPLACE VIEW` APAGA as
-- reloptions. A 041 faz um REPLACE da `card_invoice_lines` e nao fala de
-- permissao em lugar nenhum -- sem o `ALTER VIEW ... SET (security_invoker)` no
-- fim do arquivo, ela devolve a fatura de todo mundo para qualquer usuario
-- logado.
--
-- Ha as duas metades, como no database/tests/view_security_invoker_test.sql: a
-- OPCAO no catalogo e a LINHA que volta. A opcao sozinha nao prova o
-- comportamento; o comportamento sozinho nao distingue "a RLS pegou" de "a view
-- quebrou e nao devolve nada para ninguem" -- por isso o controle no fim.

SELECT pg_temp.expect('card_invoice_lines tem security_invoker depois do REPLACE da 041',
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'card_invoice_lines'
      AND EXISTS (SELECT 1 FROM unnest(coalesce(c.reloptions, '{}')) AS o(opt)
                   WHERE o.opt ILIKE 'security_invoker=%true%')), 1);

-- E o `anon` continua sem ler a view. O REVOKE/GRANT do fim da 041 e
-- declarativo, mas um REPLACE que mexesse no ACL nao daria sintoma nenhum.
SELECT pg_temp.expect('anon nao tem privilegio sobre card_invoice_lines',
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'card_invoice_lines'
      AND grantee = 'anon'), 0);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd8100000-0000-0000-0000-0000000000c1';

SELECT pg_temp.expect('a Cris ve a geladeira dela na fatura de dezembro',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE description = 'Geladeira escolhida'), 1);

SELECT pg_temp.expect('a Cris NAO ve o pneu do Davi, que tambem foi para dezembro',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE description = 'Pneu do Davi'), 0);

SET LOCAL request.jwt.claim.sub = 'd8100000-0000-0000-0000-0000000000d1';

SELECT pg_temp.expect('o Davi ve o pneu dele',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE description = 'Pneu do Davi'), 1);

SELECT pg_temp.expect('o Davi NAO ve a geladeira da Cris',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE description = 'Geladeira escolhida'), 0);

RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

-- CONTROLE POSITIVO DA RLS: sem filtro de dono, as duas linhas aparecem na
-- fatura de dezembro. Sem ele, uma view quebrada -- que nao devolve nada para
-- ninguem -- passaria nas duas negacoes acima.
SELECT pg_temp.expect('sem RLS, dezembro/2026 tem as DUAS linhas (as negacoes acima sao load-bearing)',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE invoice_month = DATE '2026-12-01'
      AND description IN ('Geladeira escolhida', 'Pneu do Davi')), 2);

-- =====================================================
-- SECAO 6: fora do cartao, o override e inerte
-- =====================================================
-- Esta secao documenta, em codigo, a decisao de NAO por um CHECK cruzado com
-- `financial_accounts.account_type` nesta migration: a regra so se escreveria
-- como trigger, e um trigger novo sobre a tabela de dinheiro quebraria o app no
-- ar na janela entre colar a migration e publicar a PR 2.
--
-- O que ela afirma e que o custo dessa decisao e ZERO no banco: a
-- `card_invoice_lines` filtra `account_type = 'credit_card'`, entao um override
-- gravado numa conta corrente nao muda numero nenhum em lugar nenhum. Quem
-- recusa o campo fora do cartao e a PR 2 -- e se um dia esta assercao reprovar,
-- a decisao mudou de custo e precisa ser revista.

SELECT pg_temp.expect('a coluna aceita o valor na conta corrente (nao ha trava de schema)',
  (SELECT count(*) FROM public.financial_transactions
    WHERE id = 'b8100000-0000-0000-0000-000000000005'
      AND invoice_month_override = DATE '2026-12-01'), 1);

SELECT pg_temp.expect('e ele nao entra na fatura: a view so olha credit_card',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE transaction_id = 'b8100000-0000-0000-0000-000000000005'), 0);

SELECT pg_temp.expect('dezembro/2026 continua tendo so as duas linhas de cartao',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE invoice_month = DATE '2026-12-01'), 2);

-- =====================================================
ROLLBACK;
