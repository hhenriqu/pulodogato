-- =====================================================
-- Teste do cambio do grupo (026)
-- =====================================================
-- HMO-138, item 3. Roda no db-verify, contra o banco que as migrations
-- constroem do zero.
--
-- "A coluna existe" nao prova nada aqui. O que a 026 entrega e a promessa de
-- que nenhum numero de GRUPO mistura moedas -- e essa promessa vive em duas
-- views, nao nas colunas. Um `ALTER TABLE ADD COLUMN` que passasse verde com
-- as views intactas seria o pior resultado possivel: o app ganharia moeda de
-- viagem e o acerto de contas passaria a cobrar um quinto da divida, calado.
--
-- O CENARIO, E POR QUE OS NUMEROS SAO ESTES
-- -----------------------------------------
-- Viagem em dolar, dois membros, tres despesas -- e a ANA tem despesa nas duas
-- moedas, que e o detalhe que faz um dos mutantes morrer (ver o comentario do
-- taxi, mais abaixo):
--
--   jantar    US$ 180,00  pago por Ana, PTAX 5,35  ->  R$    963,00
--   mercado   R$ 1.000,00 pago por Bia, PTAX 1     ->  R$  1.000,00
--   taxi      R$   200,00 pago por Ana, PTAX 1     ->  R$    200,00
--
-- Dividido igualmente, em BRL:
--
--   Ana:  pagou 1.163,00  deve 481,50 + 500 + 100 = 1.081,50  ->  net  +81,50
--   Bia:  pagou 1.000,00  deve 481,50 + 500 + 100 = 1.081,50  ->  net  -81,50
--
-- Com a soma cega de moedas -- a versao do 007 -- sai outra coisa inteira:
--
--   Ana:  pagou 380       deve  90 + 500 + 100 = 690          ->  net -310,00
--   Bia:  pagou 1.000     deve  90 + 500 + 100 = 690          ->  net +310,00
--
-- A soma cega nao erra so o tamanho: ela erra o SINAL. Ana, que e credora de
-- R$ 81,50, apareceria devendo R$ 310 -- a tela de acerto mandaria o dinheiro
-- na direcao contraria. Note que a conta cega FECHA: os dois saldos somam zero,
-- o residual e zero. Uma assercao de consistencia passa verde nas duas versoes,
-- e e por isso que a SECAO 3 existe.
--
-- OS CONTROLES
-- ------------
--   * SECAO 3 e CONTROLE POSITIVO: reproduz a formula cega do 007 sobre os
--     mesmos dados e exige -410. Sem ela, este arquivo poderia estar provando
--     que uma conta de uma moeda so continua certa -- e passaria verde num
--     banco onde a 026 nem tivesse sido aplicada.
--   * Cada assercao de valor tem a NEGACAO explicita do numero cego ao lado.
--     "net_balance = -18,50" sozinho fica vermelho se alguem trocar a cotacao;
--     "e nao e -410" diz qual defeito voltou.
--   * SECAO 6 e a contrapartida do CHECK novo: ele nao pode ser uma trava larga
--     que recusa dolar com cotacao legitima.
--
-- Rodar num banco limpo, depois de 001 -> ... -> 026:
--   psql "$DB_URL" -f database/tests/026_cambio_do_grupo_test.sql
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

-- A negacao. `expect_num` sozinho fica vermelho quando o numero muda, mas nao
-- diz QUAL numero errado apareceu, e o numero errado desta feature e sempre o
-- mesmo: o da soma cega de moedas.
CREATE OR REPLACE FUNCTION pg_temp.refute_num(label TEXT, got NUMERIC, forbidden NUMERIC)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM forbidden THEN
    RAISE EXCEPTION 'FALHA: % -> obtido % , que e exatamente o resultado da soma CEGA de moedas', label, forbidden;
  END IF;
  RAISE NOTICE 'ok: % (nao e %)', label, forbidden;
END $$;

-- --- cenario ---------------------------------------------------------------

INSERT INTO auth.users (id, email) VALUES
  ('a6000000-0000-0000-0000-0000000000a1', 'ana-cambio@teste.local'),
  ('a6000000-0000-0000-0000-0000000000b1', 'bia-cambio@teste.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name) VALUES
  ('a6000000-0000-0000-0000-0000000000a1', 'ana-cambio@teste.local', 'Ana Cambio'),
  ('a6000000-0000-0000-0000-0000000000b1', 'bia-cambio@teste.local', 'Bia Cambio')
ON CONFLICT (id) DO NOTHING;

-- A viagem, em dolar. E um segundo grupo em real, sem movimento nenhum, que
-- existe para a SECAO 5.
INSERT INTO public.expense_groups (id, name, created_by, currency) VALUES
  ('96000000-0000-0000-0000-000000000001', 'Viagem NY', 'a6000000-0000-0000-0000-0000000000a1', 'USD'),
  ('96000000-0000-0000-0000-000000000002', 'Casa',      'a6000000-0000-0000-0000-0000000000a1', 'BRL');

-- Exatamente dois membros ativos na viagem: a divisao igual tem que dar metade
-- redonda, senao o maior resto do 007 entra na conta e o numero que este
-- arquivo compara deixa de ser obvio de conferir a mao.
--
-- A Ana nao aparece aqui porque ela ja e membro: quem cria o grupo entra como
-- admin por trigger (`unique_user_per_group` recusaria a segunda linha). A
-- assercao seguinte e o que garante que o cenario tem os dois membros ativos --
-- confiar no trigger sem conferir deixaria a divisao ser feita entre uma pessoa
-- so, e ai 90 dolares seriam 180 e o numero -18,50 viraria outro sem aviso.
INSERT INTO public.group_members (group_id, user_id, role, status) VALUES
  ('96000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-0000000000b1', 'member', 'active');

SELECT pg_temp.expect('a viagem tem 2 membros ativos antes da primeira despesa',
  (SELECT COUNT(*) FROM public.group_members
    WHERE group_id = '96000000-0000-0000-0000-000000000001' AND status = 'active'), 2);

SELECT pg_temp.expect('e o grupo Casa tem 1',
  (SELECT COUNT(*) FROM public.group_members
    WHERE group_id = '96000000-0000-0000-0000-000000000002' AND status = 'active'), 1);

INSERT INTO public.financial_accounts (id, user_id, name, account_type, current_balance, currency) VALUES
  ('f6000000-0000-0000-0000-0000000000a1', 'a6000000-0000-0000-0000-0000000000a1', 'Conta Ana', 'checking', 5000, 'BRL'),
  ('f6000000-0000-0000-0000-0000000000b1', 'a6000000-0000-0000-0000-0000000000b1', 'Conta Bia', 'checking', 5000, 'BRL');

-- Duas categorias DIFERENTES, e nao uma: a SECAO 4 poe um teto de grupo na
-- categoria do jantar. Com as duas despesas na mesma categoria o teto somaria
-- 963 + 1000 e o numero deixaria de isolar a conversao.
CREATE TEMP TABLE cat_do_teste AS
  SELECT id, service_id, row_number() OVER (ORDER BY id) AS n
    FROM public.transaction_categories WHERE is_expense LIMIT 2;

SELECT pg_temp.expect('o banco tem duas categorias de despesa para o cenario',
  (SELECT COUNT(*) FROM cat_do_teste), 2);

-- Jantar de US$ 180 pago pela Ana, cotacao 5,35 do dia da compra.
-- amount NEGATIVO, como o app grava despesa.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type, currency, exchange_rate)
SELECT '76000000-0000-0000-0000-0000000000a1',
       'a6000000-0000-0000-0000-0000000000a1',
       'f6000000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, '96000000-0000-0000-0000-000000000001',
       'Jantar em NY', -180.00, CURRENT_DATE, 'expense', 'USD', 5.35
  FROM cat_do_teste c WHERE c.n = 1;

-- Mercado de R$ 1.000 pago pela Bia, na mesma viagem. BRL, cotacao 1.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type, currency, exchange_rate)
SELECT '76000000-0000-0000-0000-0000000000b1',
       'a6000000-0000-0000-0000-0000000000b1',
       'f6000000-0000-0000-0000-0000000000b1',
       c.service_id, c.id, '96000000-0000-0000-0000-000000000001',
       'Mercado antes de viajar', -1000.00, CURRENT_DATE, 'expense', 'BRL', 1
  FROM cat_do_teste c WHERE c.n = 2;

-- Taxi de R$ 200 pago tambem pela ANA. Esta terceira despesa nao esta aqui pelo
-- valor: ela existe para que UMA pessoa tenha despesa em DUAS moedas.
--
-- Sem ela, cada pagador tinha uma moeda so, e a cotacao aplicada ao TOTAL em vez
-- de linha por linha -- `SUM(ABS(amount)) * MAX(exchange_rate)` -- devolvia
-- exatamente o mesmo numero que a versao correta. Medido: o mutante sobreviveu a
-- todas as outras 39 assercoes deste arquivo. Ele e um erro classico de quem
-- mexe numa view assim depois, porque le igual e da certo em todo teste de uma
-- moeda por pessoa.
--
-- Com o taxi, o mutante sai 2.033,00 (380 x 5,35) contra 1.163,00.
INSERT INTO public.financial_transactions
  (id, user_id, account_id, service_id, category_id, group_id, description,
   amount, transaction_date, transaction_type, currency, exchange_rate)
SELECT '76000000-0000-0000-0000-0000000000a2',
       'a6000000-0000-0000-0000-0000000000a1',
       'f6000000-0000-0000-0000-0000000000a1',
       c.service_id, c.id, '96000000-0000-0000-0000-000000000001',
       'Taxi para o aeroporto', -200.00, CURRENT_DATE, 'expense', 'BRL', 1
  FROM cat_do_teste c WHERE c.n = 2;

-- =====================================================
-- SECAO 1: a divisao e feita na moeda da despesa
-- =====================================================
-- O trigger de grupo do 007 divide na hora do INSERT. A parte de cada um tem
-- que estar na moeda DA DESPESA -- 90 dolares, nao 481,50 reais. Se o trigger
-- convertesse aqui, a conversao aconteceria duas vezes (uma no trigger, outra
-- na view) e a divida de cada um sairia multiplicada por 5,35 de novo.
--
-- Esta e tambem a prova de que o cenario e o que eu digo que e: duas despesas
-- de grupo, quatro divisoes, duas pessoas.

SELECT pg_temp.expect('a viagem tem 3 despesas ligadas ao grupo',
  (SELECT COUNT(*) FROM public.group_transactions
    WHERE group_id = '96000000-0000-0000-0000-000000000001'), 3);

SELECT pg_temp.expect('e 6 divisoes (3 despesas x 2 membros)',
  (SELECT COUNT(*) FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
    WHERE gt.group_id = '96000000-0000-0000-0000-000000000001'), 6);

-- A precondicao do mutante da SECAO 2: sem DUAS moedas na mao da MESMA pessoa,
-- a cotacao aplicada ao total passa despercebida.
SELECT pg_temp.expect('a Ana pagou em 2 moedas diferentes',
  (SELECT COUNT(DISTINCT t.currency) FROM public.group_transactions gt
     JOIN public.financial_transactions t ON t.id = gt.transaction_id
    WHERE gt.group_id = '96000000-0000-0000-0000-000000000001'
      AND t.user_id = 'a6000000-0000-0000-0000-0000000000a1'), 2);

SELECT pg_temp.expect_num('a parte do jantar esta em DOLAR (90), nao convertida',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     JOIN public.group_members gm ON gm.id = es.member_id
    WHERE gt.transaction_id = '76000000-0000-0000-0000-0000000000a1'
      AND gm.user_id = 'a6000000-0000-0000-0000-0000000000b1'), 90.00);

SELECT pg_temp.refute_num('a parte do jantar nao foi convertida duas vezes',
  (SELECT es.amount FROM public.group_expense_splits es
     JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
     JOIN public.group_members gm ON gm.id = es.member_id
    WHERE gt.transaction_id = '76000000-0000-0000-0000-0000000000a1'
      AND gm.user_id = 'a6000000-0000-0000-0000-0000000000b1'), 481.50);

-- =====================================================
-- SECAO 2: o saldo do grupo, em BRL
-- =====================================================

SELECT pg_temp.expect_text('a view declara em que moeda ela devolve dinheiro',
  (SELECT DISTINCT amount_currency FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'), 'BRL');

SELECT pg_temp.expect_text('e declara a moeda da viagem, para a tela apresentar',
  (SELECT DISTINCT group_currency FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'), 'USD');

-- o lado do PAGO: 180 dolares a 5,35, mais 200 reais
SELECT pg_temp.expect_num('Ana pagou R$ 1.163,00 (US$ 180 x 5,35 + R$ 200)',
  (SELECT total_paid FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'
      AND user_id = 'a6000000-0000-0000-0000-0000000000a1'), 1163.00);

SELECT pg_temp.refute_num('e nao os 380 da soma cega',
  (SELECT total_paid FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'
      AND user_id = 'a6000000-0000-0000-0000-0000000000a1'), 380.00);

-- A conversao tem que ser por LINHA, dentro do SUM. Aplicada ao total -- com a
-- cotacao de uma das linhas valendo para todas -- daria 380 x 5,35 = 2.033,00, e
-- so um pagador com duas moedas separa esse caso do correto.
SELECT pg_temp.refute_num('e nao 2.033,00, que e a cotacao aplicada ao TOTAL em vez de por linha',
  (SELECT total_paid FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'
      AND user_id = 'a6000000-0000-0000-0000-0000000000a1'), 2033.00);

-- o lado do DEVIDO: a conversao passa pela despesa que originou a divisao.
-- 481,50 (metade do jantar) + 500,00 (mercado) + 100,00 (taxi).
SELECT pg_temp.expect_num('Ana deve R$ 1.081,50, com a metade do jantar convertida',
  (SELECT total_owed FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'
      AND user_id = 'a6000000-0000-0000-0000-0000000000a1'), 1081.50);

SELECT pg_temp.refute_num('e nao os 690 da soma cega',
  (SELECT total_owed FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'
      AND user_id = 'a6000000-0000-0000-0000-0000000000a1'), 690.00);

-- o numero que a tela de acerto usa. Ana e CREDORA de 81,50.
SELECT pg_temp.expect_num('o saldo da Ana e +81,50',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'
      AND user_id = 'a6000000-0000-0000-0000-0000000000a1'), 81.50);

-- A negacao mais importante do arquivo: a soma cega nao erra so o tamanho, erra
-- o LADO. Ana, credora, apareceria devendo 310 -- o acerto mandaria o dinheiro
-- na direcao contraria.
SELECT pg_temp.refute_num('e nao -310,00, que poria a credora Ana pagando',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'
      AND user_id = 'a6000000-0000-0000-0000-0000000000a1'), -310.00);

SELECT pg_temp.expect_num('o saldo da Bia e -81,50',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'
      AND user_id = 'a6000000-0000-0000-0000-0000000000b1'), -81.50);

-- Conservacao. Esta assercao NAO distingue as duas versoes -- a soma cega
-- tambem fecha em zero -- e esta aqui so para pegar erro de arredondamento na
-- conversao. Registrado para ninguem a confundir com prova de corretude.
SELECT pg_temp.expect_num('os saldos da viagem somam zero (nao distingue as duas versoes)',
  (SELECT SUM(net_balance) FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'), 0.00);

-- =====================================================
-- SECAO 3: CONTROLE POSITIVO -- a formula cega, sobre os mesmos dados
-- =====================================================
-- Reproduz o que o 007 calculava e exige o numero errado. Se um dia isto parar
-- de dar -310, o cenario deixou de ter duas moedas de verdade e a SECAO 2
-- passou a provar que uma conta de moeda unica continua certa -- verde, e sem
-- valor nenhum.

SELECT pg_temp.expect_num('CONTROLE POSITIVO: a formula do 007 da -310 nestes dados',
  (
    SELECT (COALESCE(p.paid, 0) - COALESCE(o.owed, 0))::numeric(15,2)
      FROM public.group_members m
      LEFT JOIN LATERAL (
        SELECT SUM(ABS(t.amount)) AS paid
          FROM public.group_transactions gt
          JOIN public.financial_transactions t ON t.id = gt.transaction_id
         WHERE gt.group_id = m.group_id AND t.user_id = m.user_id
           AND t.transaction_type = 'expense'
      ) AS p ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(es.amount) AS owed
          FROM public.group_expense_splits es
          JOIN public.group_members em ON em.id = es.member_id
          JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
         WHERE gt.group_id = m.group_id AND em.user_id = m.user_id
           AND es.status NOT IN ('rejected', 'expired')
      ) AS o ON TRUE
     WHERE m.group_id = '96000000-0000-0000-0000-000000000001'
       AND m.user_id  = 'a6000000-0000-0000-0000-0000000000a1'
  ), -310.00);

-- =====================================================
-- SECAO 4: a barra do orcamento da viagem
-- =====================================================
-- Teto de grupo de R$ 1.000 na categoria do jantar. O jantar de US$ 180 consome
-- R$ 963 dele: 96,3%, acima do limiar de 80%, portanto 'alert'.
--
-- Na soma cega o consumo seria 180 -- 18% -- e o status 'ok'. E o caso mais
-- traicoeiro da feature: a barra ficaria VERDE durante a viagem inteira, e so
-- no extrato do cartao alguem descobriria que o teto estourou.

INSERT INTO public.budgets (id, user_id, category_id, group_id, month, amount_limit)
SELECT 'b6000000-0000-0000-0000-000000000001',
       'a6000000-0000-0000-0000-0000000000a1',
       c.id,
       '96000000-0000-0000-0000-000000000001',
       date_trunc('month', CURRENT_DATE)::date,
       1000.00
  FROM cat_do_teste c WHERE c.n = 1;

SELECT pg_temp.expect_num('o teto da viagem consumiu R$ 963,00',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b6000000-0000-0000-0000-000000000001'), 963.00);

SELECT pg_temp.refute_num('e nao os 180 da soma cega',
  (SELECT spent FROM public.budget_consumption
    WHERE id = 'b6000000-0000-0000-0000-000000000001'), 180.00);

SELECT pg_temp.expect_text('portanto a barra esta em alerta, e nao verde',
  (SELECT consumption_status FROM public.budget_consumption
    WHERE id = 'b6000000-0000-0000-0000-000000000001'), 'alert');

SELECT pg_temp.expect_num('e o que resta do teto e R$ 37,00',
  (SELECT remaining FROM public.budget_consumption
    WHERE id = 'b6000000-0000-0000-0000-000000000001'), 37.00);

-- =====================================================
-- SECAO 5: o JOIN novo nao pode perder membro
-- =====================================================
-- A view passou a fazer JOIN com expense_groups para trazer a moeda da viagem.
-- Um JOIN a mais e um filtro a mais: se ele estivesse errado, o membro sem
-- movimento nenhum -- ou o grupo inteiro -- sumiria da tela, e sumir e o
-- sintoma mais facil de nao notar num saldo que ja era zero.

SELECT pg_temp.expect('o grupo sem movimento continua na view, com 1 membro',
  (SELECT COUNT(*) FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000002'), 1);

SELECT pg_temp.expect_num('e o saldo dele e zero, nao NULL',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000002'), 0.00);

SELECT pg_temp.expect('a viagem devolve os 2 membros ativos',
  (SELECT COUNT(*) FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'), 2);

-- =====================================================
-- SECAO 6: os CHECKs de cotacao
-- =====================================================
-- O CHECK `(currency = 'BRL') = (exchange_rate = 1)` fecha o caminho de perda
-- silenciosa: lancamento em dolar gravado com a cotacao DEFAULT de 1 vale um
-- quinto do que deveria, e nao ha sintoma nenhum -- a tela mostra "US$ 180,00"
-- corretamente e o saldo do grupo fecha.
--
-- As duas metades importam. Um CHECK que so recusasse o caso proibido e
-- aceitasse dolar a 5,35 e o produto; um que recusasse os dois seria uma trava
-- larga que passa em toda assercao de bloqueio e quebra o uso legitimo.

DO $$
DECLARE v_recusou BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.financial_transactions
      (user_id, account_id, service_id, category_id, description,
       amount, transaction_date, transaction_type, currency)
    SELECT 'a6000000-0000-0000-0000-0000000000a1',
           'f6000000-0000-0000-0000-0000000000a1',
           c.service_id, c.id, 'Dolar sem cotacao',
           -50.00, CURRENT_DATE, 'expense', 'USD'
      FROM cat_do_teste c WHERE c.n = 1;
  EXCEPTION WHEN check_violation THEN
    v_recusou := TRUE;
  END;

  IF NOT v_recusou THEN
    RAISE EXCEPTION 'FALHA: lancamento em USD com a cotacao DEFAULT (1) foi aceito -- e o caminho de gravar um quinto do valor sem sintoma';
  END IF;
  RAISE NOTICE 'ok: USD com cotacao 1 e recusado';
END $$;

DO $$
DECLARE v_recusou BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.financial_transactions
      (user_id, account_id, service_id, category_id, description,
       amount, transaction_date, transaction_type, currency, exchange_rate)
    SELECT 'a6000000-0000-0000-0000-0000000000a1',
           'f6000000-0000-0000-0000-0000000000a1',
           c.service_id, c.id, 'Real com cotacao inventada',
           -50.00, CURRENT_DATE, 'expense', 'BRL', 5.35
      FROM cat_do_teste c WHERE c.n = 1;
  EXCEPTION WHEN check_violation THEN
    v_recusou := TRUE;
  END;

  IF NOT v_recusou THEN
    RAISE EXCEPTION 'FALHA: lancamento em BRL com cotacao 5,35 foi aceito -- multiplicaria por cinco um gasto em reais';
  END IF;
  RAISE NOTICE 'ok: BRL com cotacao diferente de 1 e recusado';
END $$;

DO $$
DECLARE v_recusou BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.financial_transactions
      (user_id, account_id, service_id, category_id, description,
       amount, transaction_date, transaction_type, currency, exchange_rate)
    SELECT 'a6000000-0000-0000-0000-0000000000a1',
           'f6000000-0000-0000-0000-0000000000a1',
           c.service_id, c.id, 'Cotacao zero',
           -50.00, CURRENT_DATE, 'expense', 'USD', 0
      FROM cat_do_teste c WHERE c.n = 1;
  EXCEPTION WHEN check_violation THEN
    v_recusou := TRUE;
  END;

  IF NOT v_recusou THEN
    RAISE EXCEPTION 'FALHA: cotacao zero foi aceita -- a despesa desapareceria do saldo do grupo em vez de dar erro';
  END IF;
  RAISE NOTICE 'ok: cotacao zero e recusada';
END $$;

-- A OUTRA METADE: cotacao legitima passa. Sem esta assercao, o CHECK poderia
-- estar recusando toda moeda estrangeira e todas as tres de cima ficariam
-- verdes.
DO $$
BEGIN
  INSERT INTO public.financial_transactions
    (id, user_id, account_id, service_id, category_id, description,
     amount, transaction_date, transaction_type, currency, exchange_rate)
  SELECT '76000000-0000-0000-0000-0000000000c1',
         'a6000000-0000-0000-0000-0000000000a1',
         'f6000000-0000-0000-0000-0000000000a1',
         c.service_id, c.id, 'Cafe em NY',
         -5.00, CURRENT_DATE, 'expense', 'USD', 5.35
    FROM cat_do_teste c WHERE c.n = 1;
  RAISE NOTICE 'ok: USD com cotacao 5,35 e aceito';
END $$;

SELECT pg_temp.expect('o lancamento legitimo em dolar existe',
  (SELECT COUNT(*) FROM public.financial_transactions
    WHERE id = '76000000-0000-0000-0000-0000000000c1'), 1);

-- =====================================================
-- SECAO 7: o acerto pago em moeda estrangeira
-- =====================================================
-- Um acerto entra na MESMA soma que as despesas. US$ 10 pagos a 5,35 abatem
-- R$ 53,50 de divida; lidos como R$ 10, abateriam um quinto -- e a tela
-- continuaria pedindo o resto DEPOIS de o dinheiro ter sido pago, que e a pior
-- cara possivel deste defeito.
--
-- Bia devia 81,50. Pagando US$ 10 (R$ 53,50) ela vai para -28,00.

INSERT INTO public.group_settlements
  (group_id, from_user_id, to_user_id, amount, settled_on, created_by, currency, exchange_rate)
VALUES ('96000000-0000-0000-0000-000000000001',
        'a6000000-0000-0000-0000-0000000000b1',
        'a6000000-0000-0000-0000-0000000000a1',
        10.00, CURRENT_DATE,
        'a6000000-0000-0000-0000-0000000000b1', 'USD', 5.35);

SELECT pg_temp.expect_num('o acerto de US$ 10 abateu R$ 53,50',
  (SELECT settlements_paid FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'
      AND user_id = 'a6000000-0000-0000-0000-0000000000b1'), 53.50);

SELECT pg_temp.expect_num('e o saldo da Bia virou -28,00',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'
      AND user_id = 'a6000000-0000-0000-0000-0000000000b1'), -28.00);

SELECT pg_temp.refute_num('e nao -71,50, que e o acerto lido como se fosse real',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'
      AND user_id = 'a6000000-0000-0000-0000-0000000000b1'), -71.50);

-- O sinal do acerto continua sendo o do 007: quem PAGA tem o saldo AUMENTADO
-- (anda do negativo para o zero). Somar no receptor e subtrair no pagador -- o
-- erro simetrico -- faria a divida DOBRAR a cada pagamento, e a conversao nao
-- muda isso.
SELECT pg_temp.expect_num('e o da Ana caiu para +28,00 (o sinal do 007 sobreviveu)',
  (SELECT net_balance FROM public.group_member_balances
    WHERE group_id = '96000000-0000-0000-0000-000000000001'
      AND user_id = 'a6000000-0000-0000-0000-0000000000a1'), 28.00);

DO $$
DECLARE v_recusou BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.group_settlements
      (group_id, from_user_id, to_user_id, amount, settled_on, created_by, currency)
    VALUES ('96000000-0000-0000-0000-000000000001',
            'a6000000-0000-0000-0000-0000000000b1',
            'a6000000-0000-0000-0000-0000000000a1',
            10.00, CURRENT_DATE,
            'a6000000-0000-0000-0000-0000000000b1', 'USD');
  EXCEPTION WHEN check_violation THEN
    v_recusou := TRUE;
  END;

  IF NOT v_recusou THEN
    RAISE EXCEPTION 'FALHA: acerto em USD com a cotacao DEFAULT (1) foi aceito -- abateria um quinto da divida';
  END IF;
  RAISE NOTICE 'ok: acerto em USD sem cotacao e recusado';
END $$;

-- =====================================================
-- SECAO 8: as duas views continuam SECURITY INVOKER
-- =====================================================
-- `CREATE OR REPLACE VIEW` preserva reloptions, entao isto deveria ser
-- automatico. Nao e barato o suficiente para confiar: sem security_invoker a
-- view roda como o DONO, a RLS nao se aplica, e `group_member_balances`
-- devolve o saldo de todos os grupos do app para qualquer um logado.

SELECT pg_temp.expect('group_member_balances tem security_invoker',
  (SELECT COUNT(*) FROM pg_class
    WHERE relname = 'group_member_balances'
      AND relnamespace = 'public'::regnamespace
      AND reloptions @> ARRAY['security_invoker=true']), 1);

SELECT pg_temp.expect('budget_consumption tem security_invoker',
  (SELECT COUNT(*) FROM pg_class
    WHERE relname = 'budget_consumption'
      AND relnamespace = 'public'::regnamespace
      AND reloptions @> ARRAY['security_invoker=true']), 1);

SELECT pg_temp.expect('e nenhuma das duas e legivel por anon',
  (SELECT COUNT(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('group_member_balances', 'budget_consumption')
      AND grantee = 'anon'), 0);

-- =====================================================
-- SECAO 9: a migration se registrou
-- =====================================================

SELECT pg_temp.expect('a 026 esta em schema_migrations',
  (SELECT COUNT(*) FROM public.schema_migrations WHERE version = '026'), 1);

ROLLBACK;
