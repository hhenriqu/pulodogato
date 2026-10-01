-- =====================================================
-- Teste da parcela N de M (035)
-- =====================================================
-- HMO-211. Roda no db-verify, contra o banco que as migrations constroem do
-- zero.
--
-- "A coluna existe" nao prova nada aqui. O que esta sendo afirmado e que a
-- parcela aparece NA FATURA DO MES CERTO -- e esse e um numero que erra calado
-- de varios jeitos, todos plausiveis:
--
--   * duas parcelas na MESMA fatura (o mes fecha com o dobro e a ultima vazia);
--   * a serie comecando na parcela 1 quando a pessoa lancou "3 de 10" (duas
--     linhas de dinheiro que ninguem digitou);
--   * o par (installment_number, installment_total) meio preenchido, que a tela
--     mostraria como "parcela 3 de ";
--   * a fatura somando com o sinal trocado (a compra ABATENDO em vez de somar).
--
-- O DEFEITO QUE ESTE ARQUIVO EXISTE PARA PRENDER
-- ----------------------------------------------
-- Antes da 035 o parcelamento ia para `transaction_installments`, uma tabela
-- sem leitor nenhum no app: a compra em 10x era gravada e desaparecia de
-- Lancamentos, de Contas a Pagar e da fatura do cartao. A SECAO 1 e a prova de
-- que ela aparece; a SECAO 5 e o controle que mostra que a tabela antiga
-- continua invisivel, para que ninguem construa em cima dela de novo.
--
-- AS SECOES
-- ---------
--   1. a parcela 3 de 10 esta na fatura do mes certo, com valor e rotulo
--   2. NEGACAO DA OPCAO (B): as parcelas 1 e 2 nao existem em lugar nenhum
--   3. as 8 parcelas caem em 8 faturas DISTINTAS e consecutivas
--   4. o CHECK recusa o par meio preenchido e o N > M
--   5. a borda do fechamento, que e onde "somar um mes a data" erra
--   6. RLS: a fatura de um e invisivel para o outro (a view e security_invoker)
--
-- Rodar num banco limpo, depois de 001 -> ... -> 035:
--   psql "$DB_URL" -f database/tests/035_parcela_n_de_m_test.sql
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

CREATE OR REPLACE FUNCTION pg_temp.expect_date(label TEXT, got DATE, want DATE)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FALHA: % -> esperado %, obtido %', label, want, got;
  END IF;
  RAISE NOTICE 'ok: % (%)', label, got;
END $$;

-- A negacao. `expect` fica vermelho quando o numero muda, mas nao diz QUAL
-- numero errado apareceu -- e os numeros errados desta feature sao conhecidos.
CREATE OR REPLACE FUNCTION pg_temp.refute(label TEXT, got BIGINT, forbidden BIGINT, porque TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM forbidden THEN
    RAISE EXCEPTION 'FALHA: % -> obtido %, que e exatamente %', label, forbidden, porque;
  END IF;
  RAISE NOTICE 'ok: % (nao e %)', label, forbidden;
END $$;

-- O que ERRA: roda uma escrita que o banco tem de recusar, e falha se ela
-- passar. Sem este helper a assercao viraria "o INSERT deu erro?", que um
-- `BEGIN/EXCEPTION` engole sem dizer qual erro.
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
-- Fixture: dois donos, um cartao cada
-- =====================================================
-- O cartao do Davi existe para o controle de RLS da SECAO 6: sem um segundo
-- dono nao da para saber se `card_invoice_lines` respeita a RLS ou se esta
-- rodando como o dono da view (furo que a 006 fecha com `security_invoker`).
--
-- `closing_day = 20` e `due_day = 5`: o vencimento vem ANTES do fechamento, que
-- e o caso em que `card_invoice_due_date` empurra para o mes seguinte. Escolhido
-- de proposito -- um cartao que fecha dia 1 e vence dia 28 nao exercita isso.
INSERT INTO auth.users (id, email) VALUES
  ('d5000000-0000-0000-0000-0000000000c1', 'cris-211@teste.local'),
  ('d5000000-0000-0000-0000-0000000000d1', 'davi-211@teste.local');

INSERT INTO public.profiles (id, full_name, is_public) VALUES
  ('d5000000-0000-0000-0000-0000000000c1', 'Cris 211', FALSE),
  ('d5000000-0000-0000-0000-0000000000d1', 'Davi 211', FALSE);

INSERT INTO public.financial_accounts
  (id, user_id, name, account_type, current_balance, closing_day, due_day)
VALUES
  ('a5000000-0000-0000-0000-0000000000c1', 'd5000000-0000-0000-0000-0000000000c1',
   'Cartao Cris', 'credit_card', 0, 20, 5),
  ('a5000000-0000-0000-0000-0000000000d1', 'd5000000-0000-0000-0000-0000000000d1',
   'Cartao Davi', 'credit_card', 0, 20, 5);

-- O NOTEBOOK: R$ 1.000 em 10x de R$ 100, lancado como "parcela 3 de 10".
--
-- As linhas sao as que a rota /api/financial-installments monta: a parcela 3
-- fica com a data REAL da compra e as seguintes com o primeiro dia do mes da
-- fatura delas. `amount` NEGATIVO, como o app grava (despesa e negativa neste
-- banco, e a fatura e SUM(-amount)).
--
-- 2026-10-15: dia 15 <= fechamento 20 -> fatura de OUTUBRO.
INSERT INTO public.financial_transactions
  (id, user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, installment_number, installment_total,
   installment_parent_id)
SELECT
  ('b5000000-0000-0000-0000-00000000000' || to_hex(n))::uuid,
  'd5000000-0000-0000-0000-0000000000c1',
  (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
  (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
  'a5000000-0000-0000-0000-0000000000c1',
  'Notebook (' || n || '/10)',
  -100.00,
  CASE WHEN n = 3
    THEN DATE '2026-10-15'
    ELSE (DATE '2026-10-01' + ((n - 3) || ' months')::interval)::date
  END,
  'expense',
  n,
  10,
  'b5000000-0000-0000-0000-000000000003'
FROM generate_series(3, 10) AS g(n);

-- Uma compra AVULSA no mesmo cartao e na mesma fatura. Ela e o controle que
-- distingue "a view traz parcela" de "a view traz tudo": sem ela, uma consulta
-- que ignorasse as colunas de parcela pareceria certa.
INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
VALUES
  ('d5000000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a5000000-0000-0000-0000-0000000000c1',
   'Cafe', -30.00, DATE '2026-10-16', 'expense');

-- E uma compra no cartao do DAVI, para a SECAO 6.
INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type, installment_number, installment_total)
VALUES
  ('d5000000-0000-0000-0000-0000000000d1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a5000000-0000-0000-0000-0000000000d1',
   'Geladeira (1/5)', -500.00, DATE '2026-10-10', 'expense', 1, 5);

-- =====================================================
-- SECAO 1: a parcela 3 esta na fatura de outubro, com valor e rotulo
-- =====================================================

SELECT pg_temp.expect_date('a parcela 3 cai na fatura de outubro/2026',
  (SELECT invoice_month FROM public.card_invoice_lines
    WHERE transaction_id = 'b5000000-0000-0000-0000-000000000003'),
  DATE '2026-10-01');

-- O vencimento: fecha dia 20, vence dia 5 -> o 5 vem antes do 20, entao a
-- fatura de outubro vence em 05/NOVEMBRO. Se isto virar 05/10 o app cobraria a
-- fatura antes de ela fechar.
SELECT pg_temp.expect_date('a fatura de outubro vence em 05/11/2026',
  (SELECT invoice_due_date FROM public.card_invoice_lines
    WHERE transaction_id = 'b5000000-0000-0000-0000-000000000003'),
  DATE '2026-11-05');

-- O ROTULO, que e o que a 035 acrescentou. A tela le DESTAS colunas e nao da
-- descricao -- a descricao e editavel pelo usuario.
SELECT pg_temp.expect('a view expoe installment_number da parcela 3',
  (SELECT installment_number FROM public.card_invoice_lines
    WHERE transaction_id = 'b5000000-0000-0000-0000-000000000003'), 3);
SELECT pg_temp.expect('a view expoe installment_total da parcela 3',
  (SELECT installment_total FROM public.card_invoice_lines
    WHERE transaction_id = 'b5000000-0000-0000-0000-000000000003'), 10);

-- O SINAL. A fatura soma `invoice_amount`, que a view inverte: a compra soma e
-- o estorno abate. Somar `amount` cru daria -130 e a tela mostraria a fatura
-- negativa.
SELECT pg_temp.expect_num('a fatura de outubro soma a parcela + o cafe',
  (SELECT COALESCE(SUM(invoice_amount), 0) FROM public.card_invoice_lines
    WHERE account_id = 'a5000000-0000-0000-0000-0000000000c1'
      AND invoice_month = DATE '2026-10-01'), 130.00);

SELECT pg_temp.expect_num('o valor da parcela na fatura e POSITIVO (100, nao -100)',
  (SELECT invoice_amount FROM public.card_invoice_lines
    WHERE transaction_id = 'b5000000-0000-0000-0000-000000000003'), 100.00);

-- Duas linhas em outubro: a parcela 3 e o cafe. Tres significaria que uma
-- parcela de outro mes caiu aqui.
SELECT pg_temp.expect('outubro tem exatamente 2 linhas',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE account_id = 'a5000000-0000-0000-0000-0000000000c1'
      AND invoice_month = DATE '2026-10-01'), 2);

-- =====================================================
-- SECAO 2: NEGACAO DA OPCAO (B)
-- =====================================================
-- A decisao da HMO-208: lancar "parcela 3 de 10" registra SO as 8 que faltam.
-- A alternativa (B) -- gravar a serie toda marcando as 2 anteriores como pagas
-- -- faria o app afirmar pagamentos que ninguem registrou.
--
-- Esta secao e a unica que distingue (A) de (B), e ela e EXPLICITA de proposito:
-- um `count(*) = 8` sozinho ficaria verde se as parcelas 1 e 2 existissem e
-- duas do fim faltassem.

SELECT pg_temp.expect('a serie do notebook tem 8 linhas',
  (SELECT count(*) FROM public.financial_transactions
    WHERE installment_parent_id = 'b5000000-0000-0000-0000-000000000003'), 8);

SELECT pg_temp.expect('NENHUMA linha com installment_number < 3',
  (SELECT count(*) FROM public.financial_transactions
    WHERE installment_total = 10
      AND installment_number < 3), 0);

SELECT pg_temp.refute('a serie NAO tem as 10 parcelas',
  (SELECT count(*) FROM public.financial_transactions
    WHERE installment_total = 10),
  10, 'a opcao (B): a serie inteira gravada, inclusive as 2 que ninguem lancou');

-- E a prova de que (B) nao entrou por outra porta: `paid_date` sem transacao
-- por tras era o jeito como (B) marcaria as anteriores. Em
-- `financial_transactions` nao existe `paid_date` -- entao a checagem e sobre a
-- unica tabela onde ela existe, e la nao pode ter aparecido nada.
SELECT pg_temp.expect('nenhuma parcela paga apareceu em transaction_installments',
  (SELECT count(*) FROM public.transaction_installments), 0);

-- A primeira parcela da serie e a 3, e a ultima e a 10.
SELECT pg_temp.expect('a menor parcela gravada e a 3',
  (SELECT min(installment_number) FROM public.financial_transactions
    WHERE installment_parent_id = 'b5000000-0000-0000-0000-000000000003'), 3);
SELECT pg_temp.expect('a maior parcela gravada e a 10',
  (SELECT max(installment_number) FROM public.financial_transactions
    WHERE installment_parent_id = 'b5000000-0000-0000-0000-000000000003'), 10);

-- =====================================================
-- SECAO 3: 8 parcelas, 8 faturas DISTINTAS e consecutivas
-- =====================================================
-- A assercao que pega "somar um mes a data nao soma um mes a fatura". Duas
-- parcelas na mesma fatura e o defeito, e ele nao da erro: um mes fecha com o
-- dobro e o ultimo fica vazio.

SELECT pg_temp.expect('as 8 parcelas estao em 8 faturas distintas',
  (SELECT count(DISTINCT invoice_month) FROM public.card_invoice_lines
    WHERE account_id = 'a5000000-0000-0000-0000-0000000000c1'
      AND installment_total = 10), 8);

SELECT pg_temp.expect_date('a parcela 10 cai na fatura de maio/2027',
  (SELECT invoice_month FROM public.card_invoice_lines
    WHERE installment_number = 10 AND installment_total = 10),
  DATE '2027-05-01');

-- CONSECUTIVAS: sem buraco e sem repeticao. A diferenca entre o maior e o menor
-- mes tem de ser exatamente 7 meses para 8 faturas.
SELECT pg_temp.expect('do primeiro ao ultimo mes de fatura sao 7 meses',
  (SELECT (EXTRACT(YEAR FROM max(invoice_month)) * 12 + EXTRACT(MONTH FROM max(invoice_month)))
        - (EXTRACT(YEAR FROM min(invoice_month)) * 12 + EXTRACT(MONTH FROM min(invoice_month)))
   FROM public.card_invoice_lines
    WHERE account_id = 'a5000000-0000-0000-0000-0000000000c1'
      AND installment_total = 10)::bigint, 7);

-- Cada fatura da serie tem exatamente UMA parcela do notebook.
SELECT pg_temp.expect('nenhuma fatura tem duas parcelas do mesmo notebook',
  (SELECT count(*) FROM (
     SELECT invoice_month FROM public.card_invoice_lines
      WHERE account_id = 'a5000000-0000-0000-0000-0000000000c1'
        AND installment_total = 10
      GROUP BY invoice_month HAVING count(*) > 1
   ) AS repetidas), 0);

-- E o total da serie fecha os R$ 800 das 8 parcelas (as 2 anteriores, R$ 200,
-- nao estao em fatura nenhuma -- e e isso que a decisao (A) significa).
SELECT pg_temp.expect_num('as 8 parcelas somam 800 nas faturas',
  (SELECT COALESCE(SUM(invoice_amount), 0) FROM public.card_invoice_lines
    WHERE account_id = 'a5000000-0000-0000-0000-0000000000c1'
      AND installment_total = 10), 800.00);

-- =====================================================
-- SECAO 4: o CHECK recusa o par incoerente
-- =====================================================
-- A forma INTUITIVA deste CHECK aceita `(3, NULL)`, porque `FALSE OR NULL` e
-- NULL e um CHECK que resulta NULL ACEITA a linha. A 035 esta escrita para que
-- nenhum caso possa resultar NULL -- e estas quatro recusas sao a prova.
--
-- 23514 = check_violation.

SELECT pg_temp.expect_recusa('numero sem total e recusado',
  $$INSERT INTO public.financial_transactions
      (user_id, service_id, category_id, account_id, description, amount,
       transaction_date, transaction_type, installment_number)
    VALUES ('d5000000-0000-0000-0000-0000000000c1',
      (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
      (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
      'a5000000-0000-0000-0000-0000000000c1', 'meia parcela', -10,
      DATE '2026-10-15', 'expense', 3)$$,
  '23514');

SELECT pg_temp.expect_recusa('total sem numero e recusado',
  $$INSERT INTO public.financial_transactions
      (user_id, service_id, category_id, account_id, description, amount,
       transaction_date, transaction_type, installment_total)
    VALUES ('d5000000-0000-0000-0000-0000000000c1',
      (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
      (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
      'a5000000-0000-0000-0000-0000000000c1', 'meia parcela', -10,
      DATE '2026-10-15', 'expense', 10)$$,
  '23514');

SELECT pg_temp.expect_recusa('parcela 12 de 10 e recusada',
  $$INSERT INTO public.financial_transactions
      (user_id, service_id, category_id, account_id, description, amount,
       transaction_date, transaction_type, installment_number, installment_total)
    VALUES ('d5000000-0000-0000-0000-0000000000c1',
      (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
      (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
      'a5000000-0000-0000-0000-0000000000c1', 'invertida', -10,
      DATE '2026-10-15', 'expense', 12, 10)$$,
  '23514');

SELECT pg_temp.expect_recusa('parcela 1 de 1 e recusada',
  $$INSERT INTO public.financial_transactions
      (user_id, service_id, category_id, account_id, description, amount,
       transaction_date, transaction_type, installment_number, installment_total)
    VALUES ('d5000000-0000-0000-0000-0000000000c1',
      (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
      (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
      'a5000000-0000-0000-0000-0000000000c1', 'uma de uma', -10,
      DATE '2026-10-15', 'expense', 1, 1)$$,
  '23514');

-- CONTROLE POSITIVO DO CHECK: uma compra avulsa (as duas NULL) continua
-- entrando. Sem este controle, um CHECK escrito como `CHECK (FALSE)` passaria
-- nas quatro recusas acima e teria quebrado TODO lancamento do app.
INSERT INTO public.financial_transactions
  (user_id, service_id, category_id, account_id, description, amount,
   transaction_date, transaction_type)
VALUES
  ('d5000000-0000-0000-0000-0000000000c1',
   (SELECT id FROM public.financial_services WHERE name = 'personal_finance'),
   (SELECT id FROM public.transaction_categories WHERE is_expense = TRUE LIMIT 1),
   'a5000000-0000-0000-0000-0000000000c1', 'avulsa, sem parcela', -5,
   DATE '2026-10-17', 'expense');

SELECT pg_temp.expect('compra avulsa (as duas colunas NULL) continua entrando',
  (SELECT count(*) FROM public.financial_transactions
    WHERE description = 'avulsa, sem parcela'), 1);

-- E a constraint esta VALIDADA, nao apenas declarada. `convalidated = false`
-- deixaria as linhas existentes fora da checagem, e o CHECK pareceria estar la
-- sem estar -- ver `check-aceita-null-e-convalidated-prova`.
SELECT pg_temp.expect('o CHECK da 035 existe e esta validado',
  (SELECT count(*) FROM pg_constraint
    WHERE conname = 'financial_transactions_installment_coerente'
      AND conrelid = 'public.financial_transactions'::regclass
      AND convalidated), 1);

-- =====================================================
-- SECAO 4b: o indice da serie existe, e e PARCIAL
-- =====================================================
-- Sem esta secao o mutante `indice_nao_parcial` sobrevive: um indice CHEIO
-- responde as mesmas perguntas que o parcial, entao nenhuma assercao de
-- comportamento das SECOES 1 a 3 muda de cor quando o `WHERE` cai. O que muda e
-- so o tamanho -- indexar o `installment_parent_id` NULL de todo lancamento
-- avulso do historico -- e tamanho nao aparece em `count(*)`.
--
-- `indpred IS NOT NULL` e o que distingue parcial de cheio. A leitura inversa
-- (`indpred IS NULL` = indice cheio) e a que importa quando alguem for usar este
-- indice como arbitro de `ON CONFLICT`: indice parcial nunca serve de arbitro.

SELECT pg_temp.expect('o indice da serie de parcelas existe',
  (SELECT count(*) FROM pg_class WHERE relname = 'idx_financial_transactions_installment_parent'), 1);

SELECT pg_temp.expect('e e PARCIAL (indpred preenchido), nao um indice cheio',
  (SELECT count(*) FROM pg_index
    WHERE indexrelid = 'public.idx_financial_transactions_installment_parent'::regclass
      AND indpred IS NOT NULL), 1);

-- E ele indexa a coluna CERTA. Um indice parcial na coluna errada passaria nas
-- duas assercoes acima.
SELECT pg_temp.expect_text('o indice e sobre installment_parent_id',
  (SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indexrelid = 'public.idx_financial_transactions_installment_parent'::regclass),
  'installment_parent_id');

-- =====================================================
-- SECAO 5: a borda do fechamento
-- =====================================================
-- AQUI MORA O DEFEITO QUE A ROTA EVITA, e esta secao prova que ele e real --
-- nao uma preocupacao teorica.
--
-- Cartao que fecha dia 20. Uma compra em 31/01:
--   31/01 -> dia 31 > 20                      -> fatura de FEVEREIRO
--   28/02 (31/01 + 1 mes, grampeado no mes)   -> dia 28 > 20 -> fatura de MARCO
--
-- Com fechamento dia 30 o mesmo par colide:
--   31/01 -> 31 > 30        -> FEVEREIRO
--   28/02 -> 28 <= 28       -> FEVEREIRO     <-- as duas na mesma fatura
--
-- E por isso que a rota NAO soma meses a `transaction_date` para colocar as
-- parcelas: ela usa o primeiro dia do mes da fatura, que `card_invoice_month`
-- nunca empurra.

SELECT pg_temp.expect_date('somar 1 mes a 31/01 colide com fechamento 30 (o defeito)',
  public.card_invoice_month(DATE '2026-02-28', 30),
  public.card_invoice_month(DATE '2026-01-31', 30));

-- E a solucao: o primeiro dia de cada mes cai sempre na fatura do proprio mes,
-- para QUALQUER dia de fechamento. E o que torna a colocacao exata.
SELECT pg_temp.expect('o dia 1 cai na fatura do proprio mes para todo fechamento de 1 a 31',
  (SELECT count(*) FROM generate_series(1, 31) AS g(fechamento)
    WHERE public.card_invoice_month(DATE '2026-02-01', g.fechamento)
          <> DATE '2026-02-01'), 0);

-- E com `closing_day` NULL tambem, que e o cartao sem fechamento configurado.
SELECT pg_temp.expect_date('sem closing_day o dia 1 ainda cai no proprio mes',
  public.card_invoice_month(DATE '2026-02-01', NULL), DATE '2026-02-01');

-- =====================================================
-- SECAO 6: a fatura de um nao e a fatura do outro
-- =====================================================
-- `card_invoice_lines` e `security_invoker`. Sem isso ela roda com o privilegio
-- do DONO, a RLS das tabelas base nao se aplica, e a fatura de todo mundo fica
-- legivel para qualquer usuario logado -- sem erro, so com linhas a mais. A 035
-- faz `CREATE OR REPLACE VIEW`, entao esta secao e o que prova que a opcao
-- sobreviveu ao REPLACE.

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'd5000000-0000-0000-0000-0000000000c1';

SELECT pg_temp.expect('a Cris ve as 8 parcelas dela',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE installment_total = 10), 8);

SELECT pg_temp.expect('a Cris NAO ve a parcela da geladeira do Davi',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE description LIKE 'Geladeira%'), 0);

SET LOCAL request.jwt.claim.sub = 'd5000000-0000-0000-0000-0000000000d1';

SELECT pg_temp.expect('o Davi ve a parcela dele',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE description LIKE 'Geladeira%'), 1);

SELECT pg_temp.expect('o Davi NAO ve nenhuma parcela do notebook da Cris',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE installment_total = 10), 0);

-- CONTROLE POSITIVO DA RLS: sem filtro de dono, o superusuario ve as duas
-- series. Sem este controle, uma view QUEBRADA (que nao devolve nada para
-- ninguem) passaria nas duas negacoes acima.
RESET ROLE;
SET LOCAL request.jwt.claim.sub = '';

SELECT pg_temp.expect('sem RLS as duas series aparecem (a negacao acima e load-bearing)',
  (SELECT count(*) FROM public.card_invoice_lines
    WHERE installment_number IS NOT NULL), 9);

-- =====================================================
ROLLBACK;
